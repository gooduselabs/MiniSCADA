#include "core/historian/forward/sql_dialect.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <optional>

#include "core/common/utf8.hpp"
#include "core/historian/clock.hpp"

namespace mat {

namespace {

std::string lower(std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

bool allDigits(const std::string& s) {
    return !s.empty() && s.size() <= 20 &&
           std::all_of(s.begin(), s.end(), [](char c) { return c >= '0' && c <= '9'; });
}

// C APIs (dbcmd, PQexec) stop at the first NUL: such a character never reaches the SQL text.
std::string withoutNul(const std::string& s) {
    if (s.find('\0') == std::string::npos) return s;
    std::string out;
    out.reserve(s.size());
    for (char c : s)
        if (c != '\0') out += c;
    return out;
}

// Integer value of a numeric cell (doubles rounded); nullopt for anything else.
std::optional<int64_t> integerOf(const Cell& c) {
    if (const auto* i = std::get_if<int64_t>(&c)) return *i;
    if (const auto* u = std::get_if<uint64_t>(&c)) {
        if (*u > static_cast<uint64_t>(INT64_MAX)) return std::nullopt;
        return static_cast<int64_t>(*u);
    }
    if (const auto* b = std::get_if<bool>(&c)) return *b ? 1 : 0;
    if (const auto* d = std::get_if<double>(&c)) {
        if (!std::isfinite(*d) || std::fabs(*d) >= 9.2e18) return std::nullopt;
        return static_cast<int64_t>(std::llround(*d));
    }
    return std::nullopt;
}

// Range of the integer column types (contracts/external-schema.md); INT64 takes any int64.
bool fitsColumn(TagType t, int64_t v) {
    switch (t) {
        case TagType::INT16:
            return v >= -32768 && v <= 32767;
        case TagType::UINT16:
            return v >= 0 && v <= 65535;
        case TagType::INT32:
            return v >= INT32_MIN && v <= INT32_MAX;
        case TagType::UINT32:
            return v >= 0 && v <= 4294967295LL;
        default:
            return true;
    }
}

// The longest prefix of valid UTF-8 of at most maxBytes bytes, never inside a character.
std::string bytePrefix(const std::string& s, size_t maxBytes) {
    if (s.size() <= maxBytes) return s;
    size_t n = maxBytes;
    while (n > 0 && (static_cast<unsigned char>(s[n]) & 0xC0) == 0x80) --n;
    return s.substr(0, n);
}

}  // namespace

SqlGen::SqlGen(SqlDialect dialect, int offsetMin, Escape escape)
    : d_(dialect), offsetMin_(offsetMin), escape_(std::move(escape)) {}

std::string SqlGen::ident(const std::string& name) const {
    char open = '"', close = '"';
    std::string n = name;
    if (d_ == SqlDialect::MySql) {
        open = close = '`';
    } else if (d_ == SqlDialect::MsSql) {
        open = '[';
        close = ']';
    } else {
        n = lower(n);  // PostgreSQL: unquoted names fold to lower case, so queries need no quotes
    }
    std::string q(1, open);
    for (char c : n) {
        if (c == close) q += close;
        q += c;
    }
    return q + close;
}

std::string SqlGen::storedName(const std::string& name) const {
    return d_ == SqlDialect::PostgreSql ? lower(name) : name;
}

std::string SqlGen::qualified(const std::string& schema, const std::string& name) const {
    if (d_ == SqlDialect::MySql || schema.empty()) return ident(name);
    return ident(schema) + "." + ident(name);
}

std::string SqlGen::stringLiteral(const std::string& raw) const {
    // A server (or FreeTDS, which cuts the text at the first bad byte) refuses broken UTF-8.
    const std::string s = sanitizeUtf8(withoutNul(raw));
    if (d_ == SqlDialect::MsSql) {
        std::string q = "N'";
        for (char c : s) {
            if (c == '\'') q += '\'';
            q += c;
        }
        return q + "'";
    }
    // MySQL treats a backslash as an escape: only the client's own escaper is safe there.
    if (!escape_) return "NULL";
    std::string q = escape_(s);
    return q.empty() ? "NULL" : q;
}

std::string SqlGen::timeLiteral(int64_t utcMs) const {
    return "'" + formatLocalTime(utcMs, offsetMin_, d_ == SqlDialect::MsSql ? 'T' : ' ') + "'";
}

std::string SqlGen::literal(const Cell& c, const SqlColumn& col) const {
    if (std::holds_alternative<std::monostate>(c)) return "NULL";
    // A value the column cannot hold would make the server refuse the batch every time
    // (review I2): it goes as NULL, text is cut, and both are counted.
    bool cut = false;
    std::string v = value(c, col, cut);
    if (cut || v == "NULL") ++outOfRange_;
    return v;
}

// SQL Server NVARCHAR(n) counts UTF-16 units (a character above U+FFFF takes two), PostgreSQL
// VARCHAR(n) characters, MySQL TEXT 65,535 bytes.
std::string SqlGen::fitText(const std::string& raw, const SqlColumn& col, bool& cut) const {
    const std::string s = sanitizeUtf8(withoutNul(raw));
    const auto n = static_cast<size_t>(std::clamp(col.maxLength, 1, 4000));
    std::string out;
    if (d_ == SqlDialect::MsSql) {
        out = utf16Prefix(s, n);
    } else if (d_ == SqlDialect::PostgreSql) {
        bool truncated = false;
        out = utf8Prefix(s, n, truncated);
    } else {
        out = bytePrefix(s, 65535);
    }
    cut = out.size() != s.size();
    return out;
}

std::string SqlGen::value(const Cell& c, const SqlColumn& col, bool& cut) const {
    switch (col.type) {
        case TagType::BOOL: {
            bool on = false;
            if (const auto* b = std::get_if<bool>(&c)) {
                on = *b;
            } else if (const auto* i = std::get_if<int64_t>(&c)) {
                on = *i != 0;
            } else if (const auto* u = std::get_if<uint64_t>(&c)) {
                on = *u != 0;
            } else if (const auto* d = std::get_if<double>(&c)) {
                if (!std::isfinite(*d)) return "NULL";
                on = *d != 0.0;
            } else {
                return "NULL";
            }
            if (d_ == SqlDialect::PostgreSql) return on ? "TRUE" : "FALSE";
            return on ? "1" : "0";
        }
        case TagType::UINT64: {
            if (const auto* u = std::get_if<uint64_t>(&c)) return std::to_string(*u);
            if (const auto* s = std::get_if<std::string>(&c))  // above INT64_MAX: decimal TEXT
                return allDigits(*s) ? *s : "NULL";
            if (const auto* d = std::get_if<double>(&c)) {
                if (!std::isfinite(*d) || *d < 0 || *d >= 18446744073709551615.0) return "NULL";
                char buf[32];
                std::snprintf(buf, sizeof buf, "%.0f", std::round(*d));
                return buf;
            }
            const auto v = integerOf(c);
            return v && *v >= 0 ? std::to_string(*v) : "NULL";
        }
        case TagType::FLOAT32:
        case TagType::FLOAT64: {
            if (const auto* d = std::get_if<double>(&c)) {
                if (!std::isfinite(*d)) return "NULL";
                // SQL Server (and REAL columns) refuse subnormal numbers: they go as 0, counted
                const double tiny = col.type == TagType::FLOAT32 ? FLT_MIN : DBL_MIN;
                if (*d != 0.0 && std::fabs(*d) < tiny) {
                    cut = true;
                    return "0";
                }
                if (col.type == TagType::FLOAT32)
                    return std::fabs(*d) > FLT_MAX ? "NULL" : shortestFloat(*d);
                return shortestDouble(*d);
            }
            if (const auto* u = std::get_if<uint64_t>(&c)) return std::to_string(*u);
            const auto v = integerOf(c);  // REAL affinity gives integers back as INTEGER
            return v ? std::to_string(*v) : "NULL";
        }
        case TagType::STRING: {
            std::string text;
            if (const auto* s = std::get_if<std::string>(&c)) {
                text = *s;
            } else if (const auto* d = std::get_if<double>(&c)) {
                if (!std::isfinite(*d)) return "NULL";
                text = shortestDouble(*d);
            } else if (const auto* u = std::get_if<uint64_t>(&c)) {
                text = std::to_string(*u);
            } else {
                const auto v = integerOf(c);
                if (!v) return "NULL";
                text = std::to_string(*v);
            }
            return stringLiteral(fitText(text, col, cut));
        }
        default: {  // INT16 … INT64
            if (std::holds_alternative<std::string>(c)) return "NULL";
            const auto v = integerOf(c);
            return v && fitsColumn(col.type, *v) ? std::to_string(*v) : "NULL";
        }
    }
}

std::string SqlGen::columnType(const SqlColumn& c) const {
    const bool my = d_ == SqlDialect::MySql;
    const bool ms = d_ == SqlDialect::MsSql;
    switch (c.type) {
        case TagType::BOOL:
            return my ? "TINYINT(1)" : ms ? "BIT" : "BOOLEAN";
        case TagType::INT16:
            return "SMALLINT";
        case TagType::UINT16:
        case TagType::INT32:
            return my || ms ? "INT" : "INTEGER";
        case TagType::UINT32:
        case TagType::INT64:
            return "BIGINT";
        case TagType::UINT64:
            return my || ms ? "DECIMAL(20,0)" : "NUMERIC(20,0)";
        case TagType::FLOAT32:
            return my ? "FLOAT" : "REAL";
        case TagType::FLOAT64:
            return my ? "DOUBLE" : ms ? "FLOAT(53)" : "DOUBLE PRECISION";
        case TagType::STRING: {
            // MySQL: TEXT, because VARCHAR(n) counts 4n + 2 bytes in the 65,535-byte row limit.
            if (my) return "TEXT";
            const int n = std::clamp(c.maxLength, 1, 4000);
            return (ms ? "NVARCHAR(" : "VARCHAR(") + std::to_string(n) + ")";
        }
    }
    return "TEXT";
}

std::string SqlGen::nullable() const { return d_ == SqlDialect::PostgreSql ? "" : " NULL"; }

// Time of the database server for mat_forward_state.updated_at.
std::string SqlGen::nowFunction() const {
    if (d_ == SqlDialect::MySql) return "NOW(3)";
    return d_ == SqlDialect::MsSql ? "SYSDATETIME()" : "now()";
}

std::vector<std::string> SqlGen::createTable(const SqlTable& t) const {
    const std::string name = qualified(t.schema, t.name);
    const std::string indexName = "ix_" + t.name + "_time";  // MySQL: part of the table
    std::string cols;
    for (const auto& c : t.columns) cols += ", " + ident(c.name) + " " + columnType(c) + nullable();
    switch (d_) {
        case SqlDialect::MySql:
            return {"CREATE TABLE IF NOT EXISTS " + name + " (" + ident("id") +
                    " BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, " + ident("time") +
                    " DATETIME(3) NOT NULL" + cols + ", INDEX " + ident(indexName) + " (" +
                    ident("time") + ")) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"};
        case SqlDialect::MsSql:
            return {"IF OBJECT_ID(" + stringLiteral(name) + ", N'U') IS NULL CREATE TABLE " + name +
                    " (" + ident("id") + " BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY, " +
                    ident("time") + " DATETIME2(3) NOT NULL" + cols + ")"};
        case SqlDialect::PostgreSql:
            break;
    }
    return {"CREATE TABLE IF NOT EXISTS " + name + " (" + ident("id") +
            " BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, " + ident("time") +
            " TIMESTAMP(3) NOT NULL" + cols + ")"};
}

std::string SqlGen::indexQuery(const SqlTable& t) const {
    const std::string ix = "ix_" + t.name + "_time";
    switch (d_) {
        case SqlDialect::MySql:
            return "";
        case SqlDialect::MsSql:
            return "SELECT name FROM sys.indexes WHERE name = " + stringLiteral(ix) +
                   " AND object_id = OBJECT_ID(" + stringLiteral(qualified(t.schema, t.name)) + ")";
        case SqlDialect::PostgreSql:
            break;
    }
    return "SELECT indexname FROM pg_indexes WHERE schemaname = " + stringLiteral(lower(t.schema)) +
           " AND indexname = " + stringLiteral(lower(ix));
}

std::string SqlGen::createIndex(const SqlTable& t) const {
    const std::string ix = "ix_" + t.name + "_time";
    const std::string on = " ON " + qualified(t.schema, t.name) + " (" + ident("time") + ")";
    switch (d_) {
        case SqlDialect::MySql:
            return "";
        case SqlDialect::MsSql:
            return "CREATE INDEX " + ident(ix) + on;
        case SqlDialect::PostgreSql:
            break;
    }
    return "CREATE INDEX IF NOT EXISTS " + ident(ix) + on;  // another device may have made it
}

std::string SqlGen::addColumn(const SqlTable& t, const SqlColumn& c) const {
    const std::string head = "ALTER TABLE " + qualified(t.schema, t.name);
    const std::string def = ident(c.name) + " " + columnType(c) + nullable();
    switch (d_) {
        case SqlDialect::MySql:
            return head + " ADD COLUMN " + def;
        case SqlDialect::MsSql:
            return head + " ADD " + def;
        case SqlDialect::PostgreSql:
            break;
    }
    return head + " ADD COLUMN IF NOT EXISTS " + def;
}

std::vector<std::string> SqlGen::createStateTable(const std::string& schema) const {
    const std::string name = qualified(schema, "mat_forward_state");
    const bool ms = d_ == SqlDialect::MsSql;
    const std::string text = ms ? "NVARCHAR(64)" : "VARCHAR(64)";
    const std::string time =
        d_ == SqlDialect::MySql ? "DATETIME(3)" : ms ? "DATETIME2(3)" : "TIMESTAMP(3)";
    const std::string body =
        " (" + ident("source_id") + " " + text + " NOT NULL, " + ident("table_name") + " " + text +
        " NOT NULL, " + ident("last_seq") + " BIGINT NOT NULL, " + ident("updated_at") + " " +
        time + " NOT NULL, PRIMARY KEY (" + ident("source_id") + ", " + ident("table_name") + "))";
    switch (d_) {
        case SqlDialect::MySql:
            return {"CREATE TABLE IF NOT EXISTS " + name + body +
                    " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"};
        case SqlDialect::MsSql:
            return {"IF OBJECT_ID(" + stringLiteral(name) + ", N'U') IS NULL CREATE TABLE " + name +
                    body};
        case SqlDialect::PostgreSql:
            break;
    }
    return {"CREATE TABLE IF NOT EXISTS " + name + body};
}

std::string SqlGen::listColumns(const SqlTable& t) const {
    switch (d_) {
        case SqlDialect::MySql:
            return "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = "
                   "DATABASE() AND TABLE_NAME = " +
                   stringLiteral(t.name);
        case SqlDialect::MsSql:
            return "SELECT name FROM sys.columns WHERE object_id = OBJECT_ID(" +
                   stringLiteral(qualified(t.schema, t.name)) + ")";
        case SqlDialect::PostgreSql:
            break;
    }
    return "SELECT column_name FROM information_schema.columns WHERE table_schema = " +
           stringLiteral(lower(t.schema)) + " AND table_name = " + stringLiteral(lower(t.name));
}

std::string SqlGen::listStateColumns(const std::string& schema) const {
    return listColumns(SqlTable{schema, "mat_forward_state", {}});
}

std::string SqlGen::readCursor(const std::string& schema, const std::string& sourceId,
                               const std::string& table) const {
    // SQL Server returns BIGINT as binary through db-lib: ask for text like the others give.
    const std::string col = d_ == SqlDialect::MsSql
                                ? "CAST(" + ident("last_seq") + " AS VARCHAR(20))"
                                : ident("last_seq");
    return "SELECT " + col + " FROM " + qualified(schema, "mat_forward_state") + " WHERE " +
           ident("source_id") + " = " + stringLiteral(sourceId) + " AND " + ident("table_name") +
           " = " + stringLiteral(table);
}

std::string SqlGen::insertHead(const SqlTable& t) const {
    std::string sql = "INSERT INTO " + qualified(t.schema, t.name) + " (" + ident("time");
    for (const auto& c : t.columns) sql += ", " + ident(c.name);
    return sql + ") VALUES ";
}

std::string SqlGen::rowValues(const SqlTable& t, const StoredRow& row) const {
    std::string v = "(" + timeLiteral(row.ts);
    for (size_t i = 0; i < t.columns.size(); ++i)
        v += ", " + (i < row.cells.size() ? literal(row.cells[i], t.columns[i]) : "NULL");
    return v + ")";
}

std::string SqlGen::insertRows(const SqlTable& t, const std::vector<StoredRow>& rows) const {
    std::string sql = insertHead(t);
    for (size_t r = 0; r < rows.size(); ++r) {
        if (r) sql += ", ";
        sql += rowValues(t, rows[r]);
    }
    return sql;
}

std::vector<std::string> SqlGen::insertChunks(const SqlTable& t, const std::vector<StoredRow>& rows,
                                              size_t maxBytes) const {
    std::vector<std::string> out;
    const std::string head = insertHead(t);
    std::string cur;
    for (const auto& r : rows) {
        const std::string v = rowValues(t, r);
        if (!cur.empty() && cur.size() + 2 + v.size() > maxBytes) {
            out.push_back(std::move(cur));
            cur.clear();
        }
        if (cur.empty()) {
            cur = head + v;
        } else {
            cur += ", ";
            cur += v;
        }
    }
    if (!cur.empty()) out.push_back(std::move(cur));
    return out;
}

std::string SqlGen::cursorRow(const std::string& sourceId, const std::string& table) const {
    return ident("source_id") + " = " + stringLiteral(sourceId) + " AND " + ident("table_name") +
           " = " + stringLiteral(table);
}

std::string SqlGen::updateCursor(const std::string& schema, const std::string& sourceId,
                                 const std::string& table, int64_t prevSeq, int64_t lastSeq) const {
    return "UPDATE " + qualified(schema, "mat_forward_state") + " SET " + ident("last_seq") +
           " = " + std::to_string(lastSeq) + ", " + ident("updated_at") + " = " + nowFunction() +
           " WHERE " + cursorRow(sourceId, table) + " AND " + ident("last_seq") + " = " +
           std::to_string(prevSeq);
}

std::string SqlGen::lockCursor(const std::string& schema, const std::string& sourceId,
                               const std::string& table) const {
    return readCursor(schema, sourceId, table) + " FOR UPDATE";
}

std::string SqlGen::insertCursor(const std::string& schema, const std::string& sourceId,
                                 const std::string& table, int64_t lastSeq) const {
    return "INSERT INTO " + qualified(schema, "mat_forward_state") + " (" + ident("source_id") +
           ", " + ident("table_name") + ", " + ident("last_seq") + ", " + ident("updated_at") +
           ") VALUES (" + stringLiteral(sourceId) + ", " + stringLiteral(table) + ", " +
           std::to_string(lastSeq) + ", " + nowFunction() + ")";
}

// Review of the fixes (Important 2): the cursor goes first and moves only from the value this
// forwarder read. A batch of an earlier session that committed after its client gave up moved
// it: a row with another value stops the whole batch (nothing stored twice), a first row comes
// only once (SQL Server: range lock; PostgreSQL: primary key). The forwarder reads it again.
std::string SqlGen::oneBatch(const SqlTable& t, const std::vector<StoredRow>& rows,
                             const std::string& sourceId, int64_t prevSeq, int64_t lastSeq) const {
    std::string insert;
    for (const auto& chunk : insertChunks(t, rows)) insert += chunk + "; ";
    const std::string state = qualified(t.schema, "mat_forward_state");
    const std::string move = updateCursor(t.schema, sourceId, t.name, prevSeq, lastSeq);
    const std::string first = insertCursor(t.schema, sourceId, t.name, lastSeq);
    const std::string where = " WHERE " + cursorRow(sourceId, t.name);
    const std::string moved = stringLiteral("mat-runtime: the cursor at the destination moved");
    if (d_ == SqlDialect::MsSql)
        return "SET XACT_ABORT ON; BEGIN TRANSACTION; " + move +
               "; IF @@ROWCOUNT = 0 BEGIN IF EXISTS (SELECT 1 FROM " + state +
               " WITH (UPDLOCK, HOLDLOCK)" + where + ") THROW 51000, " + moved + ", 1; " + first +
               "; END; " + insert + "COMMIT TRANSACTION;";
    if (d_ == SqlDialect::PostgreSql) {
        const std::string body = move + "; IF NOT FOUND THEN IF EXISTS (SELECT 1 FROM " + state +
                                 where + ") THEN RAISE EXCEPTION " + moved +
                                 " USING ERRCODE = '40001'; END IF; " + first + "; END IF;";
        std::string tag = "$mat$";  // a dollar quote nothing in the body can close
        while (body.find(tag) != std::string::npos) tag.insert(tag.size() - 1, "_");
        return "BEGIN; DO " + tag + "BEGIN " + body + " END" + tag + "; " + insert + "COMMIT;";
    }
    return "";  // MySQL sends the statements one by one (MysqlDestination::writeBatch)
}

size_t SqlGen::batchRows(size_t columns) {
    const size_t perRow = columns == 0 ? 1 : columns;
    return std::min<size_t>(500, std::max<size_t>(1, 200000 / perRow));
}

size_t SqlGen::estimatedRowBytes(const std::vector<SqlColumn>& cols) {
    size_t rowBytes = 64;  // time literal and separators
    for (const auto& c : cols)
        rowBytes +=
            c.type == TagType::STRING ? static_cast<size_t>(std::max(c.maxLength, 1)) * 4 + 8 : 16;
    return rowBytes;
}

size_t SqlGen::batchRowsFor(const std::vector<SqlColumn>& cols, size_t maxBytes) {
    return std::max<size_t>(1,
                            std::min(batchRows(cols.size()), maxBytes / estimatedRowBytes(cols)));
}

}  // namespace mat
