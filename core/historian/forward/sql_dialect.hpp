// SQL text for the external databases (specs/003-data-logging/contracts/external-schema.md): wide
// tables, the cursor table mat_forward_state, and the batches that move rows and the cursor in one
// transaction. Pure string generation: identifiers are quoted per dialect, strings go through the
// escaper of the client library (MySQL, PostgreSQL) or the N'…' literal (SQL Server).
#pragma once
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include "core/historian/cell.hpp"
#include "core/historian/local_store.hpp"
#include "core/tag-engine/tag_store.hpp"

namespace mat {

enum class SqlDialect { MySql, MsSql, PostgreSql };

struct SqlColumn {
    std::string name;
    TagType type = TagType::FLOAT64;
    int maxLength = 255;  // STRING only
};

struct SqlTable {
    std::string schema;  // SQL Server / PostgreSQL; MySQL uses the database of the connection
    std::string name;
    std::vector<SqlColumn> columns;  // Tag columns, without id and time
};

class SqlGen {
   public:
    using Escape = std::function<std::string(const std::string&)>;  // → quoted literal
    // `escape` is nullptr for SQL Server, whose literals are built here.
    SqlGen(SqlDialect dialect, int offsetMin, Escape escape);

    // Data table; MySQL with its time index.
    std::vector<std::string> createTable(const SqlTable& t) const;
    // SQL Server, PostgreSQL: one row when the time index exists ("" for MySQL), and the statement
    // that creates it. Looking first avoids the table lock of CREATE INDEX IF NOT EXISTS.
    std::string indexQuery(const SqlTable& t) const;
    std::string createIndex(const SqlTable& t) const;
    std::string addColumn(const SqlTable& t, const SqlColumn& c) const;
    std::vector<std::string> createStateTable(const std::string& schema) const;
    // One text column per row: the column names of the table.
    std::string listColumns(const SqlTable& t) const;
    std::string listStateColumns(const std::string& schema) const;
    // One row, one text column: last_seq of (sourceId, table); no row = 0.
    std::string readCursor(const std::string& schema, const std::string& sourceId,
                           const std::string& table) const;
    // MySQL: the statements of a batch, sent one by one in START TRANSACTION … COMMIT.
    std::string insertRows(const SqlTable& t, const std::vector<StoredRow>& rows) const;
    // The same rows cut into INSERT statements of at most `maxBytes` (a longer row goes alone).
    std::vector<std::string> insertChunks(const SqlTable& t, const std::vector<StoredRow>& rows,
                                          size_t maxBytes = kMaxStatementBytes) const;
    // Moves the cursor to lastSeq only from prevSeq, the value the forwarder read or last wrote
    // (review of the fixes, Important 2); no row changed: the cursor moved, or there is none yet.
    std::string updateCursor(const std::string& schema, const std::string& sourceId,
                             const std::string& table, int64_t prevSeq, int64_t lastSeq) const;
    // MySQL: the cursor row (none: no row), locked until the transaction ends.
    std::string lockCursor(const std::string& schema, const std::string& sourceId,
                           const std::string& table) const;
    // The first cursor row of (sourceId, table); refused by the primary key when there is one.
    std::string insertCursor(const std::string& schema, const std::string& sourceId,
                             const std::string& table, int64_t lastSeq) const;
    // SQL Server, PostgreSQL: rows and cursor in one text sent at once. No rows: cursor only.
    std::string oneBatch(const SqlTable& t, const std::vector<StoredRow>& rows,
                         const std::string& sourceId, int64_t prevSeq, int64_t lastSeq) const;

    std::string timeLiteral(int64_t utcMs) const;
    // NULL for an empty cell or a value the column cannot hold (outside the range of the type);
    // text is valid UTF-8, cut to what the column holds.
    std::string literal(const Cell& c, const SqlColumn& col) const;
    // Values sent as NULL or cut so far (not the empty cells).
    size_t outOfRange() const { return outOfRange_; }
    std::string stringLiteral(const std::string& s) const;
    std::string ident(const std::string& name) const;  // quoted; PostgreSQL in lower case
    std::string qualified(const std::string& schema, const std::string& name) const;
    // Name as the database reports it (PostgreSQL: lower case), for comparing column lists.
    std::string storedName(const std::string& name) const;

    // Rows per batch: min(500, max(1, 200000 / columns)).
    static size_t batchRows(size_t columns);
    // batchRows() further limited to about `maxBytes` of row text (STRING counts maxLength × 4
    // bytes): keeps a batch of long strings small in memory.
    static size_t batchRowsFor(const std::vector<SqlColumn>& cols,
                               size_t maxBytes = kMaxBatchBytes);
    // Worst-case text size of one row (STRING: maxLength × 4 bytes of UTF-8; numbers 16).
    static size_t estimatedRowBytes(const std::vector<SqlColumn>& cols);

    static constexpr size_t kMaxStatementBytes = 1 << 20;  // below MySQL 5.7's 4 MB packet limit
    static constexpr size_t kMaxBatchBytes = 4 << 20;

   private:
    std::string columnType(const SqlColumn& c) const;
    std::string nullable() const;
    std::string nowFunction() const;
    std::string insertHead(const SqlTable& t) const;
    std::string cursorRow(const std::string& sourceId, const std::string& table) const;
    std::string rowValues(const SqlTable& t, const StoredRow& row) const;
    std::string value(const Cell& c, const SqlColumn& col, bool& cut) const;
    std::string fitText(const std::string& s, const SqlColumn& col, bool& cut) const;

    SqlDialect d_;
    int offsetMin_;
    Escape escape_;
    mutable size_t outOfRange_ = 0;
};

}  // namespace mat
