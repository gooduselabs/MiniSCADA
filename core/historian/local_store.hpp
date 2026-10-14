// SQLite storage of logged rows on the device (specs/003-data-logging research R1–R4,
// data-model §2): one wide table `log_<table>` per group, WAL, one writer.
#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include "core/historian/agg_math.hpp"
#include "core/historian/cell.hpp"

struct sqlite3;
struct sqlite3_stmt;

namespace mat {

struct ColumnSpec {
    std::string name;
    std::string affinity;  // INTEGER / REAL / TEXT
};

struct TableSpec {
    std::string table;  // without the "log_" prefix
    std::string groupId;
    int retentionDays = 1;
    std::vector<ColumnSpec> columns;
    // Schema 2 (specs/010-history-reports): aggregate tables of the group.
    std::optional<int> aggMinuteDays;      // set = the group keeps aggregates
    std::optional<int> aggHourDays;
    std::vector<std::string> aggColumns;   // column names in aggregator order
};

// One closed window to write in the commit of the raw rows (history-db.md §3).
struct AggWrite {
    size_t spec = 0;  // index in the last ensureTables() call
    size_t col = 0;   // index in the spec's aggColumns
    int64_t res = 0;  // 60000 or 3600000
    int64_t bucket = 0;
    AggBucket agg;
    // res = 3600000 only: ignore `agg` and build the hour from the minute rows of the table
    // (inside the transaction, after every minute of the commit is written): the hour is then
    // right whatever order the minutes were made in (live, recovery, back-fill).
    bool rebuildHour = false;
};

// `mat_tables.agg_built_to` / `agg_back_to` of one table, written in the same transaction.
struct AggMark {
    size_t spec = 0;
    bool setBuiltTo = true;
    int64_t builtTo = 0;
    bool setBackTo = false;
    std::optional<int64_t> backTo;  // empty = NULL (back-fill done)
};

struct AggState {
    std::optional<int64_t> builtTo;
    std::optional<int64_t> backTo;
};

struct PendingRow {
    size_t spec = 0;  // index in the last ensureTables() call
    int64_t ts = 0;   // UTC ms
    std::vector<Cell> cells;
};

struct StoredRow {
    int64_t seq = 0;
    int64_t ts = 0;
    std::vector<Cell> cells;  // INTEGER → int64, REAL → double, TEXT → string, NULL → monostate
};

struct TableMeta {
    std::string groupId;
    int retentionDays = 0;
};

// Forwarding cursor kept on the device (mat_forward): the InfluxDB cursor, and a copy of the SQL
// cursors for the status after a restart (data-model §2 ForwardState).
struct ForwardCursor {
    std::string dest;   // connection id (InfluxDB: id plus its URL, org and bucket)
    std::string table;  // group table, without "log_"
    int64_t lastSeq = 0;
    std::string sourceId;  // instance id of the history.db the cursor counts in; "" = this one
};

// The single writer (historian thread). Not thread-safe.
class LocalStore {
   public:
    LocalStore(std::string dir, std::function<int64_t()> nowUtc);
    ~LocalStore();
    LocalStore(const LocalStore&) = delete;
    LocalStore& operator=(const LocalStore&) = delete;

    // Opens or creates `<dir>/history.db`. A file that is not a database is renamed to
    // `history.db.corrupt-<epoch>` (with its -wal/-shm) and a new one is created.
    bool open(std::string& err);
    void close();
    bool isOpen() const { return db_ != nullptr; }
    bool recovered() const { return recovered_; }
    const std::string& instanceId() const { return instanceId_; }
    const std::string& path() const { return path_; }

    // Creates missing tables, indexes and columns; never drops anything; records the group and
    // its retention in mat_tables. Prepares the INSERT of every spec in the given column order.
    bool ensureTables(const std::vector<TableSpec>& specs, std::string& err);
    // All rows, and the given forwarding cursors, in one transaction.
    bool commit(const std::vector<PendingRow>& rows, std::string& err,
                const std::vector<ForwardCursor>& cursors = {});
    bool exec(const std::string& sql, std::string& err);
    // Extended SQLite result code of the last failed commit()/exec() (SQLITE_FULL, ...).
    int lastErrorCode() const { return lastRc_; }

    std::string pragmaText(const char* name);
    int64_t pragmaInt(const char* name);
    std::vector<std::string> tableColumns(const std::string& table);  // without seq, ts
    bool hasIndex(const std::string& name);
    std::optional<TableMeta> tableMeta(const std::string& table);

    // Highest seq ever given to a row of the table (sqlite_sequence); 0 when none; nullopt when
    // it cannot be read. The historian hands it to the forwarders before its first commit.
    std::optional<int64_t> lastSeqEver(const std::string& table);

    // US2 (research R4). Each call is one small transaction; -1 = error.
    // Deletes up to `maxRows` rows with ts < cutoffUtc.
    int deleteExpired(const std::string& table, int64_t cutoffUtc, int maxRows, std::string& err);
    // Every table ever created (orphans included) with its last known retention, by name.
    std::vector<std::pair<std::string, int>> retentionTargets();
    // Bytes in pages that hold data: (page_count − freelist_count) × page_size.
    int64_t usedBytes();
    // Deletes up to `maxRows` oldest rows (by ts) of the table that holds the oldest row.
    int purgeOldest(int maxRows, std::string& err);

    // ---- schema 2: aggregate tables (specs/010-history-reports contracts/history-db.md)
    // 2 once the upgrade of an older file succeeded (or the file is new); 1 when it failed.
    int schema() const { return schema_; }
    bool aggregatesAvailable() const { return schema_ >= 2; }
    const std::string& schemaError() const { return schemaError_; }
    void failSchemaUpgradeForTest(bool fail) { failUpgrade_ = fail; }
    // Like commit(), plus closed aggregate windows (upsert for minutes, replace for hours) and the
    // `agg_built_to` marks, all in the one transaction.
    bool commit(const std::vector<PendingRow>& rows, std::string& err,
                const std::vector<ForwardCursor>& cursors, const std::vector<AggWrite>& aggs,
                const std::vector<AggMark>& marks);
    std::optional<AggState> aggState(const std::string& table);
    // Sets `agg_built_to` to the start of the minute of `nowUtc` when it is NULL (the group has just
    // got aggregates); `agg_back_to` too when raw rows older than that exist (they are built
    // later in the background, §5).
    bool initAggState(const std::string& table, int64_t nowUtc, AggState& out, std::string& err);
    bool setAggBackTo(const std::string& table, std::optional<int64_t> backTo, std::string& err);
    // Rows of the writer connection in ts order (seq order for equal ts), `fromTs <= ts < toTs`.
    bool readRows(const std::string& table, const std::vector<std::string>& cols, int64_t fromTs,
                  int64_t toTs, const std::function<bool(const StoredRow&)>& cb, std::string& err);
    // Up to `limit` rows after the cursor (ts, seq) in (ts, seq) order, ts < toTs; fromTs <= ts for
    // the first call: pass cursorSeq = -1. Used by the time-bounded back-fill.
    bool readRowsAfter(const std::string& table, const std::vector<std::string>& cols,
                       int64_t cursorTs, int64_t cursorSeq, int64_t toTs, int limit,
                       std::vector<StoredRow>& out, std::string& err);
    // The last raw row with ts < `ts` (nullopt = none).
    std::optional<StoredRow> lastRowBefore(const std::string& table,
                                           const std::vector<std::string>& cols, int64_t ts);
    // The newest raw rows with ts < `ts`, newest first, at most `limit` (backfill reads backwards).
    bool readRowsBefore(const std::string& table, const std::vector<std::string>& cols, int64_t ts,
                        int limit, std::vector<StoredRow>& out, std::string& err);
    // Minute buckets of the hour [hourStart, hourStart + 1 h) of every aggregated column of the
    // spec, merged (empty bucket where there is none).
    bool loadHour(size_t spec, int64_t hourStart, std::vector<AggBucket>& perCol, std::string& err);
    bool loadMinute(size_t spec, int64_t minuteStart, std::vector<AggBucket>& perCol,
                    std::string& err);
    // mat_runs: a new run starts / is alive at / ends at `nowUtc` (rows older than 3,650 days go).
    int64_t startRun(int64_t nowUtc, std::string& err);  // id; -1 on error
    bool touchRun(int64_t id, int64_t nowUtc, std::string& err);
    std::vector<int64_t> runStartsBetween(int64_t from, int64_t to);  // from <= start_ms < to
    // alive_ms of the run that was the latest to start at or before `ts`; nullopt without runs.
    std::optional<int64_t> runAliveAt(int64_t ts);
    // Window cleaning, at most `maxRows` per call; -1 = error.
    int deleteExpiredAgg(const std::string& table, int64_t res, int64_t cutoff, int maxRows,
                         std::string& err);
    // Deletes the oldest aggregate rows of resolution `res`; 0 when there are none.
    int purgeOldestAgg(int64_t res, int maxRows, std::string& err);
    // The aggregate retention (minute, hour days) last stored for each table; for cleaning.
    struct AggRetention {
        std::string table;
        int minuteDays = 0;
        int hourDays = 0;
    };
    std::vector<AggRetention> aggRetentionTargets();
    int64_t aggRows(int64_t res);  // COUNT(*) of mat_agg for the resolution; -1 on error
    // Highest and lowest raw ts of the table; nullopt when it has no row.
    std::optional<int64_t> minTs(const std::string& table);
    std::optional<int64_t> maxTs(const std::string& table);

    // US3: upserts forwarding cursors in one transaction.
    bool saveCursors(const std::vector<ForwardCursor>& cursors, std::string& err);
    // A data page is damaged (SQLITE_CORRUPT on commit): keep the file as
    // history.db.corrupt-<epoch> and start a new one with a new instance id (data-model §3).
    bool replaceCorrupt(std::string& err);

    // Review C1 marks: per (forwarding key, table), the highest seq of the table when the runtime
    // opened the file and no forwarder of that key has compared its destination cursor with it
    // since. Adds the mark given in `atOpen` (the seq the historian read at open) for every key
    // that has none; an existing, older mark stays. Returns the marks of the keys.
    using MarkKey = std::pair<std::string, std::string>;
    bool keepForwardMarks(const std::map<MarkKey, int64_t>& atOpen,
                          std::map<MarkKey, int64_t>& marks, std::string& err);
    // Removes marks. On the eMMC when it returns: this one transaction runs with
    // synchronous=FULL, so that a power cut never brings back a mark that rows already passed.
    bool clearForwardMarks(const std::vector<MarkKey>& keys, std::string& err);

   private:
    bool openFile(std::string& err);
    bool renameAndRecreate(std::string& err);
    bool upsertCursors(const std::vector<ForwardCursor>& cursors, std::string& err);
    void finalizeStatements();
    bool run(const std::string& sql, std::string& err);  // exec that records lastRc_
    bool initMeta(std::string& err);                      // instance id, schema row, upgrade to 2
    bool upgradeToSchema2(std::string& err);
    bool ensureAggCols(const std::vector<TableSpec>& specs, std::string& err);
    bool writeAggs(const std::vector<AggWrite>& aggs, const std::vector<AggMark>& marks,
                   std::string& err);
    bool loadRange(size_t spec, int64_t from, int64_t to, std::vector<AggBucket>& perCol,
                   std::string& err);
    bool rebuildHours(const std::vector<AggWrite>& aggs, std::string& err);

    int schema_ = 1;
    std::string schemaError_;
    bool failUpgrade_ = false;
    std::vector<TableSpec> specs_;                   // of the last ensureTables()
    std::vector<std::vector<int64_t>> cids_;         // per spec, per aggColumn
    sqlite3_stmt* aggMinute_ = nullptr;
    sqlite3_stmt* aggHour_ = nullptr;
    sqlite3_stmt* aggMark_ = nullptr;

    std::string dir_;
    std::string path_;
    std::function<int64_t()> nowUtc_;
    sqlite3* db_ = nullptr;
    bool recovered_ = false;
    int lastRc_ = 0;
    std::string instanceId_;
    std::vector<sqlite3_stmt*> inserts_;  // per spec of the last ensureTables()
};

// Read-only connection (forwarder threads, the export command). WAL readers never block the
// writer.
class HistoryReader {
   public:
    HistoryReader() = default;
    ~HistoryReader();
    HistoryReader(const HistoryReader&) = delete;
    HistoryReader& operator=(const HistoryReader&) = delete;

    bool open(const std::string& path, std::string& err);
    std::string instanceId();
    std::optional<std::string> tableOfGroup(const std::string& groupId);
    std::vector<std::string> columns(const std::string& table);  // without seq, ts
    // Rows with seq > afterSeq, ascending, at most `limit`; missing columns read as empty.
    bool readAfter(const std::string& table, const std::vector<std::string>& cols, int64_t afterSeq,
                   int limit, std::vector<StoredRow>& out, std::string& err);
    // Rows with fromUtc <= ts < toUtc in seq order; `cb` returns false to stop (not an error).
    bool readRange(const std::string& table, const std::vector<std::string>& cols, int64_t fromUtc,
                   int64_t toUtc, const std::function<bool(const StoredRow&)>& cb,
                   std::string& err);
    std::optional<int64_t> minSeq(const std::string& table);
    std::optional<int64_t> maxSeq(const std::string& table);
    // (seq, ts) of the first row after `afterSeq`, for the forwarding lag.
    std::optional<std::pair<int64_t, int64_t>> firstAfter(const std::string& table,
                                                          int64_t afterSeq);
    // mat_forward cursors of one connection: table → last_seq.
    std::map<std::string, int64_t> forwardCursors(const std::string& dest);
    // Highest seq ever given to a row of the table (sqlite_sequence), kept after rows are
    // deleted; 0 when the table never had a row; nullopt when it cannot be read.
    std::optional<int64_t> lastSeqEver(const std::string& table);
    // Extended SQLite result code of the last failed readAfter() (SQLITE_CORRUPT, ...).
    int lastErrorCode() const { return lastRc_; }
    // PRAGMA integrity_check: {"ok"} for a sound file, else up to `maxLines` problems (a check
    // that stops on a damaged page adds its error).
    std::vector<std::string> integrityCheck(int maxLines);
    // The tables the runtime made (mat_tables) with their rows; -1 when a table cannot be read.
    std::vector<std::pair<std::string, int64_t>> tableRows();

   private:
    sqlite3* db_ = nullptr;
    int lastRc_ = 0;
};

// Identifier in double quotes for SQLite ("" doubles an embedded quote).
std::string quoteIdent(const std::string& name);

}  // namespace mat
