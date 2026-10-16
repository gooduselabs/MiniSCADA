#include "core/historian/local_store.hpp"

#include <fcntl.h>
#include <unistd.h>

#include <cctype>
#include <cerrno>
#include <climits>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <set>
#include <type_traits>

#include "sqlite3.h"

namespace mat {

namespace {

constexpr const char* kFile = "history.db";
constexpr int64_t kMinuteMs = 60000;

std::string lower(std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

std::string randomUuid() {
    unsigned char b[16] = {0};
    const int fd = ::open("/dev/urandom", O_RDONLY | O_CLOEXEC);
    if (fd >= 0) {
        const ssize_t n = ::read(fd, b, sizeof b);
        (void)n;
        ::close(fd);
    }
    b[6] = static_cast<unsigned char>((b[6] & 0x0F) | 0x40);  // version 4
    b[8] = static_cast<unsigned char>((b[8] & 0x3F) | 0x80);  // RFC 4122 variant
    char out[40];
    std::snprintf(out, sizeof out,
                  "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x", b[0],
                  b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13],
                  b[14], b[15]);
    return out;
}

// max/first/last of a bucket that equals its min is stored as NULL (1 byte, not 8): a held constant
// signal is most buckets, and the page writes of the aggregate rows are what an eMMC pays for.
void bindCopy(sqlite3_stmt* st, int i, double v, double minValue) {
    if (v == minValue)
        sqlite3_bind_null(st, i);
    else
        sqlite3_bind_double(st, i, v);
}

bool execSql(sqlite3* db, const std::string& sql, std::string& err) {
    char* msg = nullptr;
    if (sqlite3_exec(db, sql.c_str(), nullptr, nullptr, &msg) != SQLITE_OK) {
        err = msg ? msg : sqlite3_errmsg(db);
        sqlite3_free(msg);
        return false;
    }
    return true;
}

bool isCorrupt(int rc) {
    rc &= 0xff;
    return rc == SQLITE_CORRUPT || rc == SQLITE_NOTADB;
}

void bindCell(sqlite3_stmt* st, int i, const Cell& c) {
    std::visit(
        [&](const auto& v) {
            using T = std::decay_t<decltype(v)>;
            if constexpr (std::is_same_v<T, std::monostate>) {
                sqlite3_bind_null(st, i);
            } else if constexpr (std::is_same_v<T, bool>) {
                sqlite3_bind_int64(st, i, v ? 1 : 0);
            } else if constexpr (std::is_same_v<T, int64_t>) {
                sqlite3_bind_int64(st, i, v);
            } else if constexpr (std::is_same_v<T, uint64_t>) {
                if (v <= static_cast<uint64_t>(INT64_MAX)) {
                    sqlite3_bind_int64(st, i, static_cast<sqlite3_int64>(v));
                } else {  // research R2: beyond INT64_MAX as decimal text
                    const std::string s = std::to_string(v);
                    sqlite3_bind_text(st, i, s.c_str(), static_cast<int>(s.size()),
                                      SQLITE_TRANSIENT);
                }
            } else if constexpr (std::is_same_v<T, double>) {
                sqlite3_bind_double(st, i, v);
            } else {
                sqlite3_bind_text(st, i, v.c_str(), static_cast<int>(v.size()), SQLITE_TRANSIENT);
            }
        },
        c);
}

Cell readCell(sqlite3_stmt* st, int i) {
    switch (sqlite3_column_type(st, i)) {
        case SQLITE_INTEGER:
            return static_cast<int64_t>(sqlite3_column_int64(st, i));
        case SQLITE_FLOAT:
            return sqlite3_column_double(st, i);
        case SQLITE_TEXT: {
            const auto* t = reinterpret_cast<const char*>(sqlite3_column_text(st, i));
            return std::string(t ? t : "", static_cast<size_t>(sqlite3_column_bytes(st, i)));
        }
        default:
            return Cell{};
    }
}

std::vector<std::string> columnsOf(sqlite3* db, const std::string& table) {
    std::vector<std::string> out;
    sqlite3_stmt* st = nullptr;
    const std::string sql = "PRAGMA table_info(" + quoteIdent("log_" + table) + ")";
    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) return out;
    while (sqlite3_step(st) == SQLITE_ROW) {
        const auto* n = reinterpret_cast<const char*>(sqlite3_column_text(st, 1));
        const std::string name = n ? n : "";
        if (name != "seq" && name != "ts") out.push_back(name);
    }
    sqlite3_finalize(st);
    return out;
}

std::optional<std::string> queryText(sqlite3* db, const std::string& sql,
                                     const std::string& arg = std::string(), bool bindArg = false) {
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) return std::nullopt;
    if (bindArg)
        sqlite3_bind_text(st, 1, arg.c_str(), static_cast<int>(arg.size()), SQLITE_TRANSIENT);
    std::optional<std::string> out;
    if (sqlite3_step(st) == SQLITE_ROW && sqlite3_column_type(st, 0) != SQLITE_NULL) {
        const auto* t = reinterpret_cast<const char*>(sqlite3_column_text(st, 0));
        out = t ? t : "";
    }
    sqlite3_finalize(st);
    return out;
}

std::optional<int64_t> queryInt(sqlite3* db, const std::string& sql) {
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) return std::nullopt;
    std::optional<int64_t> out;
    if (sqlite3_step(st) == SQLITE_ROW && sqlite3_column_type(st, 0) != SQLITE_NULL)
        out = sqlite3_column_int64(st, 0);
    sqlite3_finalize(st);
    return out;
}

// SELECT seq, ts, <cols> … where columns missing from the table read as NULL.
std::string selectList(sqlite3* db, const std::string& table,
                       const std::vector<std::string>& cols) {
    std::set<std::string> have;
    for (const auto& c : columnsOf(db, table)) have.insert(lower(c));
    std::string s = "SELECT seq, ts";
    for (const auto& c : cols) s += have.count(lower(c)) ? ", " + quoteIdent(c) : ", NULL";
    return s + " FROM " + quoteIdent("log_" + table);
}

}  // namespace

std::string quoteIdent(const std::string& name) {
    std::string q = "\"";
    for (char c : name) {
        if (c == '"') q += '"';
        q += c;
    }
    return q + "\"";
}

// ---------------------------------------------------------------- LocalStore

LocalStore::LocalStore(std::string dir, std::function<int64_t()> nowUtc)
    : dir_(std::move(dir)), path_(dir_ + "/" + kFile), nowUtc_(std::move(nowUtc)) {}

LocalStore::~LocalStore() { close(); }

void LocalStore::finalizeStatements() {
    for (auto* s : inserts_) sqlite3_finalize(s);
    inserts_.clear();
    for (auto** s : {&aggMinute_, &aggHour_, &aggMark_}) {
        if (*s) sqlite3_finalize(*s);
        *s = nullptr;
    }
}

void LocalStore::close() {
    finalizeStatements();
    if (db_) {
        sqlite3_close(db_);
        db_ = nullptr;
    }
}

bool LocalStore::openFile(std::string& err) {
    if (sqlite3_open_v2(path_.c_str(), &db_, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nullptr) !=
        SQLITE_OK) {
        err = db_ ? sqlite3_errmsg(db_) : "sqlite3_open_v2 failed";
        return false;
    }
    sqlite3_extended_result_codes(db_, 1);
    sqlite3_busy_timeout(db_, 5000);
    // research R3, Constitution: WAL + NORMAL survives power loss without corruption; the last
    // commits may be lost and their seq given again. The forwarders handle that (review C1: a
    // destination cursor ahead of the file at open is rewound).
    return execSql(db_,
                   "PRAGMA journal_mode=WAL;"
                   "PRAGMA synchronous=NORMAL;"
                   "PRAGMA cache_size=-8192;"
                   "PRAGMA temp_store=MEMORY;"
                   "PRAGMA journal_size_limit=67108864;"
                   "CREATE TABLE IF NOT EXISTS mat_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);"
                   "CREATE TABLE IF NOT EXISTS mat_tables(name TEXT PRIMARY KEY, group_id TEXT "
                   "NOT NULL, retention_days INTEGER NOT NULL, created_ms INTEGER NOT NULL, "
                   "updated_ms INTEGER NOT NULL);"
                   "CREATE TABLE IF NOT EXISTS mat_forward(dest TEXT NOT NULL, tbl TEXT NOT NULL, "
                   "last_seq INTEGER NOT NULL, PRIMARY KEY(dest, tbl));"
                   "CREATE TABLE IF NOT EXISTS mat_forward_mark(dest TEXT NOT NULL, tbl TEXT NOT "
                   "NULL, mark INTEGER NOT NULL, PRIMARY KEY(dest, tbl));",
                   err);
}

bool LocalStore::open(std::string& err) {
    close();
    recovered_ = false;
    instanceId_.clear();
    if (!openFile(err)) {
        const int rc = db_ ? sqlite3_extended_errcode(db_) : 0;
        close();
        if (!isCorrupt(rc)) return false;
        // Not a database (or damaged header): keep the file for investigation, start a new one.
        err.clear();
        if (!renameAndRecreate(err)) return false;
    }
    if (!initMeta(err)) {
        close();
        return false;
    }
    return true;
}

// Instance id and schema row of a file; a file of schema 1 is upgraded to 2 (history-db.md §2).
// A failed upgrade is not fatal: the file stays schema 1 and the runtime logs without aggregates.
bool LocalStore::initMeta(std::string& err) {
    if (auto id = queryText(db_, "SELECT value FROM mat_meta WHERE key='instance_id'")) {
        instanceId_ = *id;
    } else {
        instanceId_ = randomUuid();
        if (!execSql(db_,
                     "INSERT INTO mat_meta(key, value) VALUES('instance_id', '" + instanceId_ +
                         "'), ('schema', '1')",
                     err))
            return false;
    }
    schemaError_.clear();
    const auto sch = queryText(db_, "SELECT value FROM mat_meta WHERE key='schema'");
    if (!sch && !execSql(db_, "INSERT INTO mat_meta(key, value) VALUES('schema', '1')", err))
        return false;
    schema_ = sch ? std::atoi(sch->c_str()) : 1;
    if (schema_ < 2) {
        std::string e;
        if (upgradeToSchema2(e)) {
            schema_ = 2;
        } else {
            schema_ = 1;
            schemaError_ = e;
        }
    }
    return true;
}

bool LocalStore::upgradeToSchema2(std::string& err) {
    if (!execSql(db_, "BEGIN IMMEDIATE", err)) return false;
    auto fail = [&]() {
        std::string ignored;
        execSql(db_, "ROLLBACK", ignored);
        return false;
    };
    std::set<std::string> have;
    {
        sqlite3_stmt* st = nullptr;
        if (sqlite3_prepare_v2(db_, "PRAGMA table_info(mat_tables)", -1, &st, nullptr) ==
            SQLITE_OK) {
            while (sqlite3_step(st) == SQLITE_ROW)
                have.insert(lower(reinterpret_cast<const char*>(sqlite3_column_text(st, 1))));
            sqlite3_finalize(st);
        }
    }
    for (const char* col : {"agg_minute_days", "agg_hour_days", "agg_built_to", "agg_back_to"})
        if (!have.count(col) &&
            !execSql(db_, std::string("ALTER TABLE mat_tables ADD COLUMN ") + col + " INTEGER",
                     err))
            return fail();
    if (!execSql(db_,
                 "CREATE TABLE IF NOT EXISTS mat_agg_cols(cid INTEGER PRIMARY KEY AUTOINCREMENT, "
                 "tbl TEXT NOT NULL, col TEXT NOT NULL, UNIQUE(tbl, col));"
                 "CREATE TABLE IF NOT EXISTS mat_agg(cid INTEGER NOT NULL, res INTEGER NOT NULL, "
                 "bucket INTEGER NOT NULL, n INTEGER NOT NULL, min REAL NOT NULL, max REAL, "
                 "first REAL, last REAL, sumw REAL NOT NULL, wms INTEGER "
                 "NOT NULL, PRIMARY KEY(res, bucket, cid)) WITHOUT ROWID;"
                 "CREATE TABLE IF NOT EXISTS mat_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, "
                 "start_ms INTEGER NOT NULL, alive_ms INTEGER NOT NULL);",
                 err))
        return fail();
    if (failUpgrade_) {
        err = "upgrade failed (test)";
        return fail();
    }
    if (!execSql(db_, "INSERT OR REPLACE INTO mat_meta(key, value) VALUES('schema', '2')", err))
        return fail();
    if (!execSql(db_, "COMMIT", err)) return fail();
    return true;
}

bool LocalStore::renameAndRecreate(std::string& err) {
    close();
    // A name no earlier damaged file has (two replacements may fall in the same second).
    std::string suffix = ".corrupt-" + std::to_string(nowUtc_() / 1000);
    for (int n = 2; ::access((path_ + suffix).c_str(), F_OK) == 0; ++n)
        suffix = ".corrupt-" + std::to_string(nowUtc_() / 1000) + "-" + std::to_string(n);
    // The WAL first: a new history.db must never meet the WAL of the damaged one. Any failure
    // stops here, so the damaged file is never opened again as if it were new.
    for (const char* ext : {"-wal", "-shm", ""}) {
        const std::string from = path_ + ext;
        if (::access(from.c_str(), F_OK) != 0) continue;
        if (std::rename(from.c_str(), (path_ + ext + suffix).c_str()) != 0) {
            err = "cannot rename " + from + ": " + std::strerror(errno);
            return false;
        }
    }
    recovered_ = true;
    if (!openFile(err)) {
        close();
        return false;
    }
    return true;
}

bool LocalStore::replaceCorrupt(std::string& err) {
    instanceId_.clear();
    if (!renameAndRecreate(err)) return false;
    return initMeta(err);  // a new instance id; the new file gets schema 2 at once
}

bool LocalStore::keepForwardMarks(const std::map<MarkKey, int64_t>& atOpen,
                                  std::map<MarkKey, int64_t>& marks, std::string& err) {
    marks.clear();
    if (atOpen.empty()) return true;
    if (!db_) {
        err = "store not open";
        return false;
    }
    if (!run("BEGIN IMMEDIATE", err)) return false;
    sqlite3_stmt* st = nullptr;
    bool ok = sqlite3_prepare_v2(db_,
                                 "INSERT OR IGNORE INTO mat_forward_mark(dest, tbl, mark) "
                                 "VALUES(?, ?, ?)",
                                 -1, &st, nullptr) == SQLITE_OK;
    for (auto it = atOpen.begin(); ok && it != atOpen.end(); ++it) {
        sqlite3_reset(st);
        sqlite3_bind_text(st, 1, it->first.first.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(st, 2, it->first.second.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(st, 3, it->second);
        ok = sqlite3_step(st) == SQLITE_DONE;
    }
    if (!ok) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
    }
    sqlite3_finalize(st);
    if (!ok || !run("COMMIT", err)) {
        std::string ignored;
        execSql(db_, "ROLLBACK", ignored);
        return false;
    }
    if (sqlite3_prepare_v2(db_, "SELECT mark FROM mat_forward_mark WHERE dest = ? AND tbl = ?", -1,
                           &st, nullptr) != SQLITE_OK) {
        err = sqlite3_errmsg(db_);
        return false;
    }
    for (const auto& kv : atOpen) {
        const MarkKey& k = kv.first;
        sqlite3_reset(st);
        sqlite3_bind_text(st, 1, k.first.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(st, 2, k.second.c_str(), -1, SQLITE_TRANSIENT);
        if (sqlite3_step(st) == SQLITE_ROW) marks[k] = sqlite3_column_int64(st, 0);
    }
    sqlite3_finalize(st);
    return true;
}

bool LocalStore::clearForwardMarks(const std::vector<MarkKey>& keys, std::string& err) {
    if (keys.empty()) return true;
    if (!db_) {
        err = "store not open";
        return false;
    }
    if (!run("PRAGMA synchronous=FULL", err)) return false;
    bool ok = run("BEGIN IMMEDIATE", err);
    sqlite3_stmt* st = nullptr;
    if (ok)
        ok = sqlite3_prepare_v2(db_, "DELETE FROM mat_forward_mark WHERE dest = ? AND tbl = ?", -1,
                                &st, nullptr) == SQLITE_OK;
    for (size_t i = 0; ok && i < keys.size(); ++i) {
        sqlite3_reset(st);
        sqlite3_bind_text(st, 1, keys[i].first.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(st, 2, keys[i].second.c_str(), -1, SQLITE_TRANSIENT);
        ok = sqlite3_step(st) == SQLITE_DONE;
    }
    if (!ok && err.empty()) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
    }
    sqlite3_finalize(st);
    ok = ok && run("COMMIT", err);
    std::string ignored;
    if (!ok) execSql(db_, "ROLLBACK", ignored);
    execSql(db_, "PRAGMA synchronous=NORMAL", ignored);  // Constitution: NORMAL for everything else
    return ok;
}

std::optional<int64_t> LocalStore::lastSeqEver(const std::string& table) {
    if (!db_) return std::nullopt;
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, "SELECT seq FROM sqlite_sequence WHERE name = ?", -1, &st,
                           nullptr) != SQLITE_OK)
        return std::nullopt;
    const std::string name = "log_" + table;
    sqlite3_bind_text(st, 1, name.c_str(), -1, SQLITE_TRANSIENT);
    std::optional<int64_t> seq;
    const int rc = sqlite3_step(st);
    if (rc == SQLITE_ROW)
        seq = sqlite3_column_int64(st, 0);
    else if (rc == SQLITE_DONE)
        seq = 0;
    sqlite3_finalize(st);
    return seq;
}

bool LocalStore::ensureTables(const std::vector<TableSpec>& specs, std::string& err) {
    if (!db_) {
        err = "store not open";
        return false;
    }
    finalizeStatements();
    if (!execSql(db_, "BEGIN IMMEDIATE", err)) return false;
    auto fail = [&]() {
        std::string ignored;
        execSql(db_, "ROLLBACK", ignored);
        return false;
    };
    const int64_t now = nowUtc_();
    for (const auto& s : specs) {
        const std::string t = quoteIdent("log_" + s.table);
        std::string create = "CREATE TABLE IF NOT EXISTS " + t +
                             " (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL";
        for (const auto& c : s.columns) create += ", " + quoteIdent(c.name) + " " + c.affinity;
        create += ")";
        if (!execSql(db_, create, err)) return fail();
        if (!execSql(db_,
                     "CREATE INDEX IF NOT EXISTS " + quoteIdent("log_" + s.table + "_ts") + " ON " +
                         t + "(ts)",
                     err))
            return fail();
        std::set<std::string> have;
        for (const auto& c : columnsOf(db_, s.table)) have.insert(lower(c));
        for (const auto& c : s.columns)
            if (!have.count(lower(c.name)) && !execSql(db_,
                                                       "ALTER TABLE " + t + " ADD COLUMN " +
                                                           quoteIdent(c.name) + " " + c.affinity,
                                                       err))
                return fail();

        sqlite3_stmt* up = nullptr;
        if (sqlite3_prepare_v2(
                db_,
                "INSERT INTO mat_tables(name, group_id, retention_days, created_ms, "
                "updated_ms) VALUES(?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET "
                "group_id=excluded.group_id, retention_days=excluded.retention_days, "
                "updated_ms=excluded.updated_ms",
                -1, &up, nullptr) != SQLITE_OK) {
            err = sqlite3_errmsg(db_);
            return fail();
        }
        sqlite3_bind_text(up, 1, s.table.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(up, 2, s.groupId.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(up, 3, s.retentionDays);
        sqlite3_bind_int64(up, 4, now);
        sqlite3_bind_int64(up, 5, now);
        const int rc = sqlite3_step(up);
        sqlite3_finalize(up);
        if (rc != SQLITE_DONE) {
            err = sqlite3_errmsg(db_);
            return fail();
        }
        // Aggregate retention (schema 2). A group that drops its aggregates keeps the last stored
        // values, so that the buckets it made are still cleaned.
        if (schema_ >= 2 && s.aggMinuteDays) {
            sqlite3_stmt* ag = nullptr;
            if (sqlite3_prepare_v2(db_,
                                   "UPDATE mat_tables SET agg_minute_days=?, agg_hour_days=? "
                                   "WHERE name=?",
                                   -1, &ag, nullptr) != SQLITE_OK) {
                err = sqlite3_errmsg(db_);
                return fail();
            }
            sqlite3_bind_int(ag, 1, *s.aggMinuteDays);
            sqlite3_bind_int(ag, 2, s.aggHourDays.value_or(730));
            sqlite3_bind_text(ag, 3, s.table.c_str(), -1, SQLITE_TRANSIENT);
            const int arc = sqlite3_step(ag);
            sqlite3_finalize(ag);
            if (arc != SQLITE_DONE) {
                err = sqlite3_errmsg(db_);
                return fail();
            }
        }
    }
    specs_ = specs;
    if (!ensureAggCols(specs, err)) return fail();
    if (!execSql(db_, "COMMIT", err)) return fail();
    if (schema_ >= 2) {
        const char* kBase =
            "INSERT INTO mat_agg (cid, res, bucket, n, \"min\", \"max\", \"first\", \"last\", "
            "sumw, "
            "wms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        const std::string upsert =
            std::string(kBase) +
            " ON CONFLICT (res, bucket, cid) DO UPDATE SET n = n + excluded.n, "
            "\"min\" = MIN(\"min\", excluded.\"min\"), "
            "\"max\" = MAX(COALESCE(\"max\", \"min\"), COALESCE(excluded.\"max\", "
            "excluded.\"min\")), "
            "\"first\" = COALESCE(\"first\", \"min\"), "
            "\"last\" = COALESCE(excluded.\"last\", excluded.\"min\"), "
            "sumw = sumw + excluded.sumw, wms = wms + excluded.wms";
        std::string replace = kBase;
        replace.replace(0, std::string("INSERT").size(), "INSERT OR REPLACE");
        if (sqlite3_prepare_v3(db_, upsert.c_str(), -1, SQLITE_PREPARE_PERSISTENT, &aggMinute_,
                               nullptr) != SQLITE_OK ||
            sqlite3_prepare_v3(db_, replace.c_str(), -1, SQLITE_PREPARE_PERSISTENT, &aggHour_,
                               nullptr) != SQLITE_OK ||
            sqlite3_prepare_v3(db_, "UPDATE mat_tables SET agg_built_to=? WHERE name=?", -1,
                               SQLITE_PREPARE_PERSISTENT, &aggMark_, nullptr) != SQLITE_OK) {
            err = sqlite3_errmsg(db_);
            finalizeStatements();
            return false;
        }
    }

    for (const auto& s : specs) {
        std::string sql = "INSERT INTO " + quoteIdent("log_" + s.table) + " (ts";
        std::string values = "?";
        for (const auto& c : s.columns) {
            sql += ", " + quoteIdent(c.name);
            values += ", ?";
        }
        sql += ") VALUES (" + values + ")";
        sqlite3_stmt* st = nullptr;
        if (sqlite3_prepare_v3(db_, sql.c_str(), -1, SQLITE_PREPARE_PERSISTENT, &st, nullptr) !=
            SQLITE_OK) {
            err = sqlite3_errmsg(db_);
            finalizeStatements();
            return false;
        }
        inserts_.push_back(st);
    }
    return true;
}

bool LocalStore::run(const std::string& sql, std::string& err) {
    if (execSql(db_, sql, err)) return true;
    lastRc_ = sqlite3_extended_errcode(db_);
    return false;
}

bool LocalStore::commit(const std::vector<PendingRow>& rows, std::string& err,
                        const std::vector<ForwardCursor>& cursors) {
    return commit(rows, err, cursors, {}, {});
}

bool LocalStore::commit(const std::vector<PendingRow>& rows, std::string& err,
                        const std::vector<ForwardCursor>& cursors,
                        const std::vector<AggWrite>& aggs, const std::vector<AggMark>& marks) {
    if (rows.empty() && cursors.empty() && aggs.empty() && marks.empty() && aliveRun_ < 0)
        return true;
    if (!db_) {
        err = "store not open";
        lastRc_ = SQLITE_MISUSE;
        return false;
    }
    if (!run("BEGIN IMMEDIATE", err)) return false;
    for (const auto& r : rows) {
        if (r.spec >= inserts_.size()) {
            err = "row for an unknown table";
            lastRc_ = SQLITE_MISUSE;
            std::string ignored;
            execSql(db_, "ROLLBACK", ignored);
            return false;
        }
        sqlite3_stmt* st = inserts_[r.spec];
        sqlite3_reset(st);
        sqlite3_clear_bindings(st);
        sqlite3_bind_int64(st, 1, r.ts);
        const int n = sqlite3_bind_parameter_count(st) - 1;
        for (int i = 0; i < n; ++i)
            bindCell(st, i + 2, static_cast<size_t>(i) < r.cells.size() ? r.cells[i] : Cell{});
        if (sqlite3_step(st) != SQLITE_DONE) {
            lastRc_ = sqlite3_extended_errcode(db_);
            err = sqlite3_errmsg(db_);
            sqlite3_reset(st);
            std::string ignored;
            execSql(db_, "ROLLBACK", ignored);
            return false;
        }
    }
    if (aliveRun_ >= 0 && schema_ >= 2) {
        if (!run("UPDATE mat_runs SET alive_ms = " + std::to_string(aliveTs_) +
                     " WHERE id = " + std::to_string(aliveRun_),
                 err)) {
            std::string ignored;
            execSql(db_, "ROLLBACK", ignored);
            return false;
        }
    }
    if (!writeAggs(aggs, marks, err) || !upsertCursors(cursors, err)) {
        std::string ignored;
        execSql(db_, "ROLLBACK", ignored);
        return false;
    }
    if (run("COMMIT", err)) {
        aliveRun_ = -1;
        return true;
    }
    std::string ignored;
    execSql(db_, "ROLLBACK", ignored);
    return false;
}

bool LocalStore::exec(const std::string& sql, std::string& err) {
    if (!db_) {
        err = "store not open";
        lastRc_ = SQLITE_MISUSE;
        return false;
    }
    return run(sql, err);
}

std::string LocalStore::pragmaText(const char* name) {
    return db_ ? queryText(db_, std::string("PRAGMA ") + name).value_or("") : "";
}

int64_t LocalStore::pragmaInt(const char* name) {
    return db_ ? queryInt(db_, std::string("PRAGMA ") + name).value_or(0) : 0;
}

std::vector<std::string> LocalStore::tableColumns(const std::string& table) {
    return db_ ? columnsOf(db_, table) : std::vector<std::string>{};
}

bool LocalStore::hasIndex(const std::string& name) {
    return db_ && queryText(db_, "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
                            name, true)
                      .has_value();
}

std::optional<TableMeta> LocalStore::tableMeta(const std::string& table) {
    if (!db_) return std::nullopt;
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, "SELECT group_id, retention_days FROM mat_tables WHERE name=?", -1,
                           &st, nullptr) != SQLITE_OK)
        return std::nullopt;
    sqlite3_bind_text(st, 1, table.c_str(), -1, SQLITE_TRANSIENT);
    std::optional<TableMeta> out;
    if (sqlite3_step(st) == SQLITE_ROW) {
        TableMeta m;
        m.groupId = reinterpret_cast<const char*>(sqlite3_column_text(st, 0));
        m.retentionDays = sqlite3_column_int(st, 1);
        out = m;
    }
    sqlite3_finalize(st);
    return out;
}

int LocalStore::deleteExpired(const std::string& table, int64_t cutoffUtc, int maxRows,
                              std::string& err) {
    if (!db_) {
        err = "store not open";
        return -1;
    }
    const std::string t = quoteIdent("log_" + table);
    const std::string sql =
        "DELETE FROM " + t + " WHERE seq IN (SELECT seq FROM " + t + " WHERE ts < ? LIMIT ?)";
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) {
        err = sqlite3_errmsg(db_);
        return -1;
    }
    sqlite3_bind_int64(st, 1, cutoffUtc);
    sqlite3_bind_int(st, 2, maxRows);
    const int rc = sqlite3_step(st);
    sqlite3_finalize(st);
    if (rc != SQLITE_DONE) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
        return -1;
    }
    return sqlite3_changes(db_);
}

std::vector<std::pair<std::string, int>> LocalStore::retentionTargets() {
    std::vector<std::pair<std::string, int>> out;
    if (!db_) return out;
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, "SELECT name, retention_days FROM mat_tables ORDER BY name", -1,
                           &st, nullptr) != SQLITE_OK)
        return out;
    while (sqlite3_step(st) == SQLITE_ROW)
        out.emplace_back(reinterpret_cast<const char*>(sqlite3_column_text(st, 0)),
                         sqlite3_column_int(st, 1));
    sqlite3_finalize(st);
    return out;
}

int64_t LocalStore::usedBytes() {
    if (!db_) return 0;
    const int64_t pages = queryInt(db_, "PRAGMA page_count").value_or(0);
    const int64_t freePages = queryInt(db_, "PRAGMA freelist_count").value_or(0);
    const int64_t size = queryInt(db_, "PRAGMA page_size").value_or(4096);
    return (pages - freePages) * size;
}

int LocalStore::purgeOldest(int maxRows, std::string& err) {
    if (!db_) {
        err = "store not open";
        return -1;
    }
    std::string oldestTable;
    int64_t oldestTs = INT64_MAX;
    for (const auto& [table, days] : retentionTargets()) {
        (void)days;
        const auto ts = queryInt(db_, "SELECT min(ts) FROM " + quoteIdent("log_" + table));
        if (ts && *ts < oldestTs) {
            oldestTs = *ts;
            oldestTable = table;
        }
    }
    if (oldestTable.empty()) return 0;
    const std::string t = quoteIdent("log_" + oldestTable);
    const std::string sql =
        "DELETE FROM " + t + " WHERE seq IN (SELECT seq FROM " + t + " ORDER BY ts LIMIT ?)";
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) {
        err = sqlite3_errmsg(db_);
        return -1;
    }
    sqlite3_bind_int(st, 1, maxRows);
    const int rc = sqlite3_step(st);
    sqlite3_finalize(st);
    if (rc != SQLITE_DONE) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
        return -1;
    }
    return sqlite3_changes(db_);
}

// ---------------------------------------------------------------- schema 2: aggregates

// Inside the transaction of ensureTables(): one cid per (table, column), given once and kept when
// the column leaves the configuration (history-db.md §1).
bool LocalStore::ensureAggCols(const std::vector<TableSpec>& specs, std::string& err) {
    cids_.assign(specs.size(), {});
    if (schema_ < 2) return true;
    sqlite3_stmt* ins = nullptr;
    sqlite3_stmt* sel = nullptr;
    if (sqlite3_prepare_v2(db_, "INSERT OR IGNORE INTO mat_agg_cols(tbl, col) VALUES(?, ?)", -1,
                           &ins, nullptr) != SQLITE_OK ||
        sqlite3_prepare_v2(db_, "SELECT cid FROM mat_agg_cols WHERE tbl = ? AND col = ?", -1, &sel,
                           nullptr) != SQLITE_OK) {
        err = sqlite3_errmsg(db_);
        sqlite3_finalize(ins);
        sqlite3_finalize(sel);
        return false;
    }
    bool ok = true;
    for (size_t i = 0; ok && i < specs.size(); ++i) {
        if (!specs[i].aggMinuteDays) continue;
        for (const auto& col : specs[i].aggColumns) {
            sqlite3_reset(ins);
            sqlite3_bind_text(ins, 1, specs[i].table.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(ins, 2, col.c_str(), -1, SQLITE_TRANSIENT);
            if (sqlite3_step(ins) != SQLITE_DONE) {
                ok = false;
                break;
            }
            sqlite3_reset(sel);
            sqlite3_bind_text(sel, 1, specs[i].table.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(sel, 2, col.c_str(), -1, SQLITE_TRANSIENT);
            if (sqlite3_step(sel) != SQLITE_ROW) {
                ok = false;
                break;
            }
            cids_[i].push_back(sqlite3_column_int64(sel, 0));
        }
    }
    if (!ok) err = sqlite3_errmsg(db_);
    sqlite3_finalize(ins);
    sqlite3_finalize(sel);
    return ok;
}

bool LocalStore::writeAggs(const std::vector<AggWrite>& aggs, const std::vector<AggMark>& marks,
                           std::string& err) {
    if (schema_ < 2) return true;
    for (const auto& w : aggs) {
        if (w.rebuildHour || w.spec >= cids_.size() || w.col >= cids_[w.spec].size()) continue;
        sqlite3_stmt* st = w.res == 3600000 ? aggHour_ : aggMinute_;
        if (!st) continue;
        // NaN would become NULL, which the NOT NULL columns refuse and so stop every commit.
        if (std::isnan(w.agg.min) || std::isnan(w.agg.max) || std::isnan(w.agg.first) ||
            std::isnan(w.agg.last) || std::isnan(w.agg.sumw))
            continue;
        sqlite3_reset(st);
        sqlite3_bind_int64(st, 1, cids_[w.spec][w.col]);
        sqlite3_bind_int64(st, 2, w.res);
        sqlite3_bind_int64(st, 3, w.bucket);
        sqlite3_bind_int64(st, 4, w.agg.n);
        sqlite3_bind_double(st, 5, w.agg.min);
        bindCopy(st, 6, w.agg.max, w.agg.min);
        bindCopy(st, 7, w.agg.first, w.agg.min);
        bindCopy(st, 8, w.agg.last, w.agg.min);
        sqlite3_bind_double(st, 9, w.agg.sumw);
        sqlite3_bind_int64(st, 10, w.agg.wms);
        if (sqlite3_step(st) != SQLITE_DONE) {
            lastRc_ = sqlite3_extended_errcode(db_);
            err = sqlite3_errmsg(db_);
            sqlite3_reset(st);
            return false;
        }
    }
    if (!rebuildHours(aggs, err)) return false;
    for (const auto& m : marks) {
        if (m.spec >= specs_.size() || !aggMark_) continue;
        if (m.setBuiltTo) {
            sqlite3_reset(aggMark_);
            sqlite3_bind_int64(aggMark_, 1, m.builtTo);
            sqlite3_bind_text(aggMark_, 2, specs_[m.spec].table.c_str(), -1, SQLITE_TRANSIENT);
            if (sqlite3_step(aggMark_) != SQLITE_DONE) {
                lastRc_ = sqlite3_extended_errcode(db_);
                err = sqlite3_errmsg(db_);
                sqlite3_reset(aggMark_);
                return false;
            }
        }
        if (m.setBackTo && !setAggBackTo(specs_[m.spec].table, m.backTo, err)) return false;
    }
    return true;
}

// The hour rows of one commit: built from the minute rows, which the same transaction has
// written by now.
bool LocalStore::rebuildHours(const std::vector<AggWrite>& aggs, std::string& err) {
    sqlite3_stmt* sel = nullptr;
    for (const auto& w : aggs) {
        if (!w.rebuildHour || w.spec >= cids_.size() || w.col >= cids_[w.spec].size() || !aggHour_)
            continue;
        if (!sel &&
            sqlite3_prepare_v2(
                db_,
                "SELECT n, \"min\", COALESCE(\"max\", \"min\"), COALESCE(\"first\", \"min\"), "
                "COALESCE(\"last\", \"min\"), sumw, wms FROM "
                "mat_agg WHERE cid = ? AND res = 60000 AND bucket >= ? AND bucket "
                "< ? ORDER BY bucket",
                -1, &sel, nullptr) != SQLITE_OK) {
            err = sqlite3_errmsg(db_);
            return false;
        }
        sqlite3_reset(sel);
        sqlite3_bind_int64(sel, 1, cids_[w.spec][w.col]);
        sqlite3_bind_int64(sel, 2, w.bucket);
        sqlite3_bind_int64(sel, 3, w.bucket + 3600000);
        AggBucket merged;
        while (sqlite3_step(sel) == SQLITE_ROW) {
            AggBucket b;
            b.n = sqlite3_column_int64(sel, 0);
            b.min = sqlite3_column_double(sel, 1);
            b.max = sqlite3_column_double(sel, 2);
            b.first = sqlite3_column_double(sel, 3);
            b.last = sqlite3_column_double(sel, 4);
            b.sumw = sqlite3_column_double(sel, 5);
            b.wms = sqlite3_column_int64(sel, 6);
            merged = mergeBuckets(merged, b);
        }
        if (merged.empty()) continue;
        sqlite3_reset(aggHour_);
        sqlite3_bind_int64(aggHour_, 1, cids_[w.spec][w.col]);
        sqlite3_bind_int64(aggHour_, 2, 3600000);
        sqlite3_bind_int64(aggHour_, 3, w.bucket);
        sqlite3_bind_int64(aggHour_, 4, merged.n);
        sqlite3_bind_double(aggHour_, 5, merged.min);
        bindCopy(aggHour_, 6, merged.max, merged.min);
        bindCopy(aggHour_, 7, merged.first, merged.min);
        bindCopy(aggHour_, 8, merged.last, merged.min);
        sqlite3_bind_double(aggHour_, 9, merged.sumw);
        sqlite3_bind_int64(aggHour_, 10, merged.wms);
        if (sqlite3_step(aggHour_) != SQLITE_DONE) {
            lastRc_ = sqlite3_extended_errcode(db_);
            err = sqlite3_errmsg(db_);
            sqlite3_reset(aggHour_);
            sqlite3_finalize(sel);
            return false;
        }
    }
    sqlite3_finalize(sel);
    return true;
}

std::optional<AggState> LocalStore::aggState(const std::string& table) {
    if (!db_ || schema_ < 2) return std::nullopt;
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, "SELECT agg_built_to, agg_back_to FROM mat_tables WHERE name = ?",
                           -1, &st, nullptr) != SQLITE_OK)
        return std::nullopt;
    sqlite3_bind_text(st, 1, table.c_str(), -1, SQLITE_TRANSIENT);
    std::optional<AggState> out;
    if (sqlite3_step(st) == SQLITE_ROW) {
        AggState s;
        if (sqlite3_column_type(st, 0) != SQLITE_NULL) s.builtTo = sqlite3_column_int64(st, 0);
        if (sqlite3_column_type(st, 1) != SQLITE_NULL) s.backTo = sqlite3_column_int64(st, 1);
        out = s;
    }
    sqlite3_finalize(st);
    return out;
}

bool LocalStore::initAggState(const std::string& table, int64_t nowUtc, AggState& out,
                              std::string& err) {
    const auto cur = aggState(table);
    if (!cur) {
        err = "aggregate state of " + table + " cannot be read";
        return false;
    }
    out = *cur;
    if (cur->builtTo) return true;
    const int64_t w = nowUtc - ((nowUtc % kMinuteMs) + kMinuteMs) % kMinuteMs;
    const auto older = queryInt(db_, "SELECT ts FROM " + quoteIdent("log_" + table) +
                                         " WHERE ts < " + std::to_string(w) + " LIMIT 1");
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "UPDATE mat_tables SET agg_built_to = ?, agg_back_to = ? WHERE name = ?",
                           -1, &st, nullptr) != SQLITE_OK) {
        err = sqlite3_errmsg(db_);
        return false;
    }
    sqlite3_bind_int64(st, 1, w);
    if (older)
        sqlite3_bind_int64(st, 2, w);
    else
        sqlite3_bind_null(st, 2);
    sqlite3_bind_text(st, 3, table.c_str(), -1, SQLITE_TRANSIENT);
    const int rc = sqlite3_step(st);
    sqlite3_finalize(st);
    if (rc != SQLITE_DONE) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
        return false;
    }
    out.builtTo = w;
    if (older) out.backTo = w;
    return true;
}

bool LocalStore::setAggBackTo(const std::string& table, std::optional<int64_t> backTo,
                              std::string& err) {
    if (!db_ || schema_ < 2) return false;
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, "UPDATE mat_tables SET agg_back_to = ? WHERE name = ?", -1, &st,
                           nullptr) != SQLITE_OK) {
        err = sqlite3_errmsg(db_);
        return false;
    }
    if (backTo)
        sqlite3_bind_int64(st, 1, *backTo);
    else
        sqlite3_bind_null(st, 1);
    sqlite3_bind_text(st, 2, table.c_str(), -1, SQLITE_TRANSIENT);
    const int rc = sqlite3_step(st);
    sqlite3_finalize(st);
    if (rc != SQLITE_DONE) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
        return false;
    }
    return true;
}

bool LocalStore::readRows(const std::string& table, const std::vector<std::string>& cols,
                          int64_t fromTs, int64_t toTs,
                          const std::function<bool(const StoredRow&)>& cb, std::string& err) {
    if (!db_) {
        err = "store not open";
        return false;
    }
    const std::string sql =
        selectList(db_, table, cols) + " WHERE ts >= ? AND ts < ? ORDER BY ts, seq";
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
        return false;
    }
    sqlite3_bind_int64(st, 1, fromTs);
    sqlite3_bind_int64(st, 2, toTs);
    int rc;
    while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
        StoredRow r;
        r.seq = sqlite3_column_int64(st, 0);
        r.ts = sqlite3_column_int64(st, 1);
        for (size_t i = 0; i < cols.size(); ++i)
            r.cells.push_back(readCell(st, static_cast<int>(i) + 2));
        if (!cb(r)) {
            rc = SQLITE_DONE;
            break;
        }
    }
    if (rc != SQLITE_DONE) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
    }
    sqlite3_finalize(st);
    return rc == SQLITE_DONE;
}

bool LocalStore::readRowsBefore(const std::string& table, const std::vector<std::string>& cols,
                                int64_t ts, int limit, std::vector<StoredRow>& out,
                                std::string& err) {
    if (!db_) {
        err = "store not open";
        return false;
    }
    const std::string sql =
        selectList(db_, table, cols) + " WHERE ts < ? ORDER BY ts DESC, seq DESC LIMIT ?";
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
        return false;
    }
    sqlite3_bind_int64(st, 1, ts);
    sqlite3_bind_int(st, 2, limit);
    int rc;
    while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
        StoredRow r;
        r.seq = sqlite3_column_int64(st, 0);
        r.ts = sqlite3_column_int64(st, 1);
        for (size_t i = 0; i < cols.size(); ++i)
            r.cells.push_back(readCell(st, static_cast<int>(i) + 2));
        out.push_back(std::move(r));
    }
    if (rc != SQLITE_DONE) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
    }
    sqlite3_finalize(st);
    return rc == SQLITE_DONE;
}

bool LocalStore::readRowsAfter(const std::string& table, const std::vector<std::string>& cols,
                               int64_t cursorTs, int64_t cursorSeq, int64_t toTs, int limit,
                               std::vector<StoredRow>& out, std::string& err) {
    if (!db_) {
        err = "store not open";
        return false;
    }
    const std::string sql = selectList(db_, table, cols) +
                            " WHERE (ts > ?1 OR (ts = ?1 AND seq > ?2)) AND ts < ?3 ORDER BY ts, "
                            "seq LIMIT ?4";
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
        return false;
    }
    sqlite3_bind_int64(st, 1, cursorTs);
    sqlite3_bind_int64(st, 2, cursorSeq);
    sqlite3_bind_int64(st, 3, toTs);
    sqlite3_bind_int(st, 4, limit);
    int rc;
    while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
        StoredRow r;
        r.seq = sqlite3_column_int64(st, 0);
        r.ts = sqlite3_column_int64(st, 1);
        for (size_t i = 0; i < cols.size(); ++i)
            r.cells.push_back(readCell(st, static_cast<int>(i) + 2));
        out.push_back(std::move(r));
    }
    if (rc != SQLITE_DONE) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
    }
    sqlite3_finalize(st);
    return rc == SQLITE_DONE;
}

std::optional<StoredRow> LocalStore::lastRowBefore(const std::string& table,
                                                   const std::vector<std::string>& cols,
                                                   int64_t ts) {
    std::vector<StoredRow> v;
    std::string err;
    if (!readRowsBefore(table, cols, ts, 1, v, err) || v.empty()) return std::nullopt;
    return v.front();
}

bool LocalStore::loadHour(size_t spec, int64_t hourStart, std::vector<AggBucket>& perCol,
                          std::string& err) {
    return loadRange(spec, hourStart, hourStart + 3600000, perCol, err);
}

bool LocalStore::loadMinute(size_t spec, int64_t minuteStart, std::vector<AggBucket>& perCol,
                            std::string& err) {
    return loadRange(spec, minuteStart, minuteStart + kMinuteMs, perCol, err);
}

bool LocalStore::loadRange(size_t spec, int64_t from, int64_t to, std::vector<AggBucket>& perCol,
                           std::string& err) {
    if (!db_ || schema_ < 2 || spec >= cids_.size()) {
        err = "aggregates not available";
        return false;
    }
    perCol.assign(cids_[spec].size(), AggBucket{});
    std::map<int64_t, size_t> index;
    for (size_t i = 0; i < cids_[spec].size(); ++i) index[cids_[spec][i]] = i;
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(
            db_,
            "SELECT cid, n, \"min\", COALESCE(\"max\", \"min\"), COALESCE(\"first\", \"min\"), "
            "COALESCE(\"last\", \"min\"), sumw, wms FROM "
            "mat_agg WHERE res = 60000 AND bucket >= ? AND bucket < ? AND cid IN "
            "(SELECT cid FROM mat_agg_cols WHERE tbl = ?) ORDER BY bucket",
            -1, &st, nullptr) != SQLITE_OK) {
        err = sqlite3_errmsg(db_);
        return false;
    }
    sqlite3_bind_int64(st, 1, from);
    sqlite3_bind_int64(st, 2, to);
    sqlite3_bind_text(st, 3, specs_[spec].table.c_str(), -1, SQLITE_TRANSIENT);
    int rc;
    while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
        const auto it = index.find(sqlite3_column_int64(st, 0));
        if (it == index.end()) continue;  // a column that left the configuration
        AggBucket b;
        b.n = sqlite3_column_int64(st, 1);
        b.min = sqlite3_column_double(st, 2);
        b.max = sqlite3_column_double(st, 3);
        b.first = sqlite3_column_double(st, 4);
        b.last = sqlite3_column_double(st, 5);
        b.sumw = sqlite3_column_double(st, 6);
        b.wms = sqlite3_column_int64(st, 7);
        perCol[it->second] = mergeBuckets(perCol[it->second], b);
    }
    if (rc != SQLITE_DONE) err = sqlite3_errmsg(db_);
    sqlite3_finalize(st);
    return rc == SQLITE_DONE;
}

int64_t LocalStore::startRun(int64_t nowUtc, std::string& err) {
    if (!db_ || schema_ < 2) return -1;
    sqlite3_stmt* st = nullptr;
    // Old runs go with the 3,650-day limit of history-db.md §1.
    if (!run("DELETE FROM mat_runs WHERE alive_ms < " + std::to_string(nowUtc - 3650LL * 86400000),
             err))
        return -1;
    if (sqlite3_prepare_v2(db_, "INSERT INTO mat_runs(start_ms, alive_ms) VALUES(?, ?)", -1, &st,
                           nullptr) != SQLITE_OK) {
        err = sqlite3_errmsg(db_);
        return -1;
    }
    sqlite3_bind_int64(st, 1, nowUtc);
    sqlite3_bind_int64(st, 2, nowUtc);
    const int rc = sqlite3_step(st);
    sqlite3_finalize(st);
    if (rc != SQLITE_DONE) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
        return -1;
    }
    return sqlite3_last_insert_rowid(db_);
}

bool LocalStore::touchRun(int64_t id, int64_t nowUtc, std::string& err) {
    if (!db_ || schema_ < 2) return false;
    return run("UPDATE mat_runs SET alive_ms = " + std::to_string(nowUtc) +
                   " WHERE id = " + std::to_string(id),
               err);
}

std::vector<int64_t> LocalStore::runStartsBetween(int64_t from, int64_t to) {
    std::vector<int64_t> out;
    if (!db_ || schema_ < 2) return out;
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "SELECT start_ms FROM mat_runs WHERE start_ms >= ? AND start_ms < ? "
                           "ORDER BY start_ms",
                           -1, &st, nullptr) != SQLITE_OK)
        return out;
    sqlite3_bind_int64(st, 1, from);
    sqlite3_bind_int64(st, 2, to);
    while (sqlite3_step(st) == SQLITE_ROW) out.push_back(sqlite3_column_int64(st, 0));
    sqlite3_finalize(st);
    return out;
}

std::optional<int64_t> LocalStore::runAliveAt(int64_t ts) {
    if (!db_ || schema_ < 2) return std::nullopt;
    return queryInt(db_, "SELECT alive_ms FROM mat_runs WHERE start_ms <= " + std::to_string(ts) +
                             " ORDER BY start_ms DESC LIMIT 1");
}

int LocalStore::deleteExpiredAgg(const std::string& table, int64_t res, int64_t cutoff, int maxRows,
                                 std::string& err) {
    if (!db_ || schema_ < 2) {
        err = "aggregates not available";
        return -1;
    }
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "DELETE FROM mat_agg WHERE (cid, res, bucket) IN (SELECT cid, res, "
                           "bucket FROM mat_agg WHERE res = ? AND bucket < ? AND cid IN (SELECT "
                           "cid FROM mat_agg_cols WHERE tbl = ?) LIMIT ?)",
                           -1, &st, nullptr) != SQLITE_OK) {
        err = sqlite3_errmsg(db_);
        return -1;
    }
    sqlite3_bind_int64(st, 1, res);
    sqlite3_bind_int64(st, 2, cutoff);
    sqlite3_bind_text(st, 3, table.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(st, 4, maxRows);
    const int rc = sqlite3_step(st);
    sqlite3_finalize(st);
    if (rc != SQLITE_DONE) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
        return -1;
    }
    return sqlite3_changes(db_);
}

int LocalStore::purgeOldestAgg(int64_t res, int maxRows, std::string& err) {
    if (!db_ || schema_ < 2) return 0;
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "DELETE FROM mat_agg WHERE (cid, res, bucket) IN (SELECT cid, res, "
                           "bucket FROM mat_agg WHERE res = ? ORDER BY bucket LIMIT ?)",
                           -1, &st, nullptr) != SQLITE_OK) {
        err = sqlite3_errmsg(db_);
        return -1;
    }
    sqlite3_bind_int64(st, 1, res);
    sqlite3_bind_int(st, 2, maxRows);
    const int rc = sqlite3_step(st);
    sqlite3_finalize(st);
    if (rc != SQLITE_DONE) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
        return -1;
    }
    return sqlite3_changes(db_);
}

std::vector<LocalStore::AggRetention> LocalStore::aggRetentionTargets() {
    std::vector<AggRetention> out;
    if (!db_ || schema_ < 2) return out;
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "SELECT name, agg_minute_days, agg_hour_days FROM mat_tables WHERE "
                           "agg_minute_days IS NOT NULL ORDER BY name",
                           -1, &st, nullptr) != SQLITE_OK)
        return out;
    while (sqlite3_step(st) == SQLITE_ROW)
        out.push_back({reinterpret_cast<const char*>(sqlite3_column_text(st, 0)),
                       sqlite3_column_int(st, 1), sqlite3_column_int(st, 2)});
    sqlite3_finalize(st);
    return out;
}

int64_t LocalStore::aggRows(int64_t res) {
    if (!db_ || schema_ < 2) return -1;
    return queryInt(db_, "SELECT count(*) FROM mat_agg WHERE res = " + std::to_string(res))
        .value_or(-1);
}

std::optional<int64_t> LocalStore::minTs(const std::string& table) {
    return db_ ? queryInt(db_, "SELECT min(ts) FROM " + quoteIdent("log_" + table)) : std::nullopt;
}

std::optional<int64_t> LocalStore::maxTs(const std::string& table) {
    return db_ ? queryInt(db_, "SELECT max(ts) FROM " + quoteIdent("log_" + table)) : std::nullopt;
}

bool LocalStore::saveCursors(const std::vector<ForwardCursor>& cursors, std::string& err) {
    return commit({}, err, cursors);
}

// Inside the caller's transaction. A cursor of another file (replaced since) is skipped.
bool LocalStore::upsertCursors(const std::vector<ForwardCursor>& cursors, std::string& err) {
    if (cursors.empty()) return true;
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "INSERT INTO mat_forward(dest, tbl, last_seq) VALUES(?, ?, ?) "
                           "ON CONFLICT(dest, tbl) DO UPDATE SET last_seq=excluded.last_seq",
                           -1, &st, nullptr) != SQLITE_OK) {
        err = sqlite3_errmsg(db_);
        return false;
    }
    for (const auto& c : cursors) {
        if (!c.sourceId.empty() && c.sourceId != instanceId_) continue;
        sqlite3_reset(st);
        sqlite3_bind_text(st, 1, c.dest.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(st, 2, c.table.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(st, 3, c.lastSeq);
        if (sqlite3_step(st) != SQLITE_DONE) {
            lastRc_ = sqlite3_extended_errcode(db_);
            err = sqlite3_errmsg(db_);
            sqlite3_finalize(st);
            return false;
        }
    }
    sqlite3_finalize(st);
    return true;
}

// ---------------------------------------------------------------- HistoryReader

HistoryReader::~HistoryReader() {
    if (db_) sqlite3_close(db_);
}

bool HistoryReader::open(const std::string& path, std::string& err) {
    if (db_) {
        sqlite3_close(db_);
        db_ = nullptr;
    }
    if (sqlite3_open_v2(path.c_str(), &db_, SQLITE_OPEN_READONLY, nullptr) != SQLITE_OK) {
        err = db_ ? sqlite3_errmsg(db_) : "sqlite3_open_v2 failed";
        if (db_) sqlite3_close(db_);
        db_ = nullptr;
        return false;
    }
    sqlite3_busy_timeout(db_, 5000);
    sqlite3_stmt* st = nullptr;  // touch the file now: missing / not a database fails here
    if (sqlite3_prepare_v2(db_, "SELECT value FROM mat_meta WHERE key='instance_id'", -1, &st,
                           nullptr) != SQLITE_OK) {
        err = sqlite3_errmsg(db_);
        sqlite3_close(db_);
        db_ = nullptr;
        return false;
    }
    sqlite3_finalize(st);
    return true;
}

std::string HistoryReader::instanceId() {
    return db_ ? queryText(db_, "SELECT value FROM mat_meta WHERE key='instance_id'").value_or("")
               : "";
}

std::optional<std::string> HistoryReader::tableOfGroup(const std::string& groupId) {
    if (!db_) return std::nullopt;
    return queryText(
        db_, "SELECT name FROM mat_tables WHERE group_id=? ORDER BY updated_ms DESC LIMIT 1",
        groupId, true);
}

std::vector<std::string> HistoryReader::columns(const std::string& table) {
    return db_ ? columnsOf(db_, table) : std::vector<std::string>{};
}

bool HistoryReader::readAfter(const std::string& table, const std::vector<std::string>& cols,
                              int64_t afterSeq, int limit, std::vector<StoredRow>& out,
                              std::string& err) {
    if (!db_) {
        err = "reader not open";
        return false;
    }
    const std::string sql = selectList(db_, table, cols) + " WHERE seq > ? ORDER BY seq LIMIT ?";
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
        return false;
    }
    sqlite3_bind_int64(st, 1, afterSeq);
    sqlite3_bind_int(st, 2, limit);
    int rc;
    while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
        StoredRow r;
        r.seq = sqlite3_column_int64(st, 0);
        r.ts = sqlite3_column_int64(st, 1);
        for (size_t i = 0; i < cols.size(); ++i)
            r.cells.push_back(readCell(st, static_cast<int>(i) + 2));
        out.push_back(std::move(r));
    }
    if (rc != SQLITE_DONE) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
        sqlite3_finalize(st);
        return false;
    }
    sqlite3_finalize(st);
    return true;
}

bool HistoryReader::readRange(const std::string& table, const std::vector<std::string>& cols,
                              int64_t fromUtc, int64_t toUtc,
                              const std::function<bool(const StoredRow&)>& cb, std::string& err) {
    if (!db_) {
        err = "reader not open";
        return false;
    }
    const std::string sql = selectList(db_, table, cols) + " WHERE ts >= ? AND ts < ? ORDER BY seq";
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) {
        err = sqlite3_errmsg(db_);
        return false;
    }
    sqlite3_bind_int64(st, 1, fromUtc);
    sqlite3_bind_int64(st, 2, toUtc);
    int rc;
    while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
        StoredRow r;
        r.seq = sqlite3_column_int64(st, 0);
        r.ts = sqlite3_column_int64(st, 1);
        for (size_t i = 0; i < cols.size(); ++i)
            r.cells.push_back(readCell(st, static_cast<int>(i) + 2));
        if (!cb(r)) {  // the caller has what it needs
            rc = SQLITE_DONE;
            break;
        }
    }
    sqlite3_finalize(st);
    if (rc != SQLITE_DONE) {
        err = sqlite3_errmsg(db_);
        return false;
    }
    return true;
}

std::optional<int64_t> HistoryReader::minSeq(const std::string& table) {
    return db_ ? queryInt(db_, "SELECT min(seq) FROM " + quoteIdent("log_" + table)) : std::nullopt;
}

std::optional<int64_t> HistoryReader::maxSeq(const std::string& table) {
    return db_ ? queryInt(db_, "SELECT max(seq) FROM " + quoteIdent("log_" + table)) : std::nullopt;
}

std::optional<std::pair<int64_t, int64_t>> HistoryReader::firstAfter(const std::string& table,
                                                                     int64_t afterSeq) {
    if (!db_) return std::nullopt;
    const std::string sql =
        "SELECT seq, ts FROM " + quoteIdent("log_" + table) + " WHERE seq > ? ORDER BY seq LIMIT 1";
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) return std::nullopt;
    sqlite3_bind_int64(st, 1, afterSeq);
    std::optional<std::pair<int64_t, int64_t>> out;
    if (sqlite3_step(st) == SQLITE_ROW)
        out = std::make_pair(static_cast<int64_t>(sqlite3_column_int64(st, 0)),
                             static_cast<int64_t>(sqlite3_column_int64(st, 1)));
    sqlite3_finalize(st);
    return out;
}

std::optional<int64_t> HistoryReader::lastSeqEver(const std::string& table) {
    if (!db_) return std::nullopt;
    // sqlite_sequence exists as soon as a log_ table does (AUTOINCREMENT)
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, "SELECT seq FROM sqlite_sequence WHERE name = ?", -1, &st,
                           nullptr) != SQLITE_OK)
        return std::nullopt;
    const std::string name = "log_" + table;
    sqlite3_bind_text(st, 1, name.c_str(), -1, SQLITE_TRANSIENT);
    std::optional<int64_t> seq;
    const int rc = sqlite3_step(st);
    if (rc == SQLITE_ROW)
        seq = sqlite3_column_int64(st, 0);
    else if (rc == SQLITE_DONE)
        seq = 0;  // the table never had a row
    sqlite3_finalize(st);
    return seq;
}

std::vector<std::string> HistoryReader::integrityCheck(int maxLines) {
    if (!db_) return {"not open"};
    std::vector<std::string> out;
    sqlite3_stmt* st = nullptr;
    const std::string sql = "PRAGMA integrity_check(" + std::to_string(std::max(1, maxLines)) + ")";
    int rc = sqlite3_prepare_v2(db_, sql.c_str(), -1, &st, nullptr);
    if (rc == SQLITE_OK) {
        while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
            const unsigned char* t = sqlite3_column_text(st, 0);
            out.emplace_back(t ? reinterpret_cast<const char*>(t) : "");
        }
    }
    // A page so damaged that the check itself stops is a problem of the file too.
    if (rc != SQLITE_DONE) out.push_back(std::string("check stopped: ") + sqlite3_errmsg(db_));
    sqlite3_finalize(st);
    return out;
}

std::vector<std::pair<std::string, int64_t>> HistoryReader::tableRows() {
    std::vector<std::pair<std::string, int64_t>> out;
    if (!db_) return out;
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, "SELECT name FROM mat_tables ORDER BY name", -1, &st, nullptr) !=
        SQLITE_OK)
        return out;
    std::vector<std::string> names;
    while (sqlite3_step(st) == SQLITE_ROW)
        names.emplace_back(reinterpret_cast<const char*>(sqlite3_column_text(st, 0)));
    sqlite3_finalize(st);
    for (const auto& n : names)
        out.emplace_back(
            n, queryInt(db_, "SELECT count(*) FROM " + quoteIdent("log_" + n)).value_or(-1));
    return out;
}

std::map<std::string, int64_t> HistoryReader::forwardCursors(const std::string& dest) {
    std::map<std::string, int64_t> out;
    if (!db_) return out;
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, "SELECT tbl, last_seq FROM mat_forward WHERE dest=?", -1, &st,
                           nullptr) != SQLITE_OK)
        return out;
    sqlite3_bind_text(st, 1, dest.c_str(), -1, SQLITE_TRANSIENT);
    while (sqlite3_step(st) == SQLITE_ROW)
        out[reinterpret_cast<const char*>(sqlite3_column_text(st, 0))] =
            sqlite3_column_int64(st, 1);
    sqlite3_finalize(st);
    return out;
}

}  // namespace mat
