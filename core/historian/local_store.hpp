// SQLite storage of logged rows on the device (specs/003-data-logging research R1–R4,
// data-model §2): one wide table `log_<table>` per group, WAL, one writer.
#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <string>
#include <vector>

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
