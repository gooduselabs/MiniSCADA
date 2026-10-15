// alarm.db: the occurrences of alarms (specs/009-alarms contracts/alarm-store.md, data-model §3).
// SQLite WAL, synchronous=NORMAL (never FULL: the durable word of a user action is audit.db), file
// mode 0600, every parameter bound. Written by one thread (the service's writer); not thread-safe.
#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include "core/alarm/alarm_types.hpp"

struct sqlite3;

namespace mat::alarm {

inline constexpr int kAlarmSchemaVersion = 1;

struct OverrideChange {
    bool remove = false;  // true: DELETE (alarmId, kind of `row`)
    OverrideRow row;
};

struct PurgeCounts {
    int rows = 0;  // rows deleted by this call
};

class AlarmStore {
   public:
    AlarmStore(std::string dir, std::function<int64_t()> nowEpochMs);
    ~AlarmStore();
    AlarmStore(const AlarmStore&) = delete;
    AlarmStore& operator=(const AlarmStore&) = delete;

    // Opens or creates `<dir>/alarm.db` (contracts §1). A file that is not a database, or fails
    // integrity_check after an unclean stop, is renamed to alarm.db.corrupt-<epoch> (-wal, -shm
    // first) and a new one is created (recovered() is then true). A file of a newer schema is not
    // opened and not renamed: open() returns false with schemaTooNew() true.
    bool open(std::string& err);
    // clean = true: writes high_water, clean='1' and checkpoints (TRUNCATE) before closing.
    void close(bool clean = true);
    bool isOpen() const { return db_ != nullptr; }
    bool recovered() const { return recovered_; }
    bool schemaTooNew() const { return schemaTooNew_; }
    const std::string& path() const { return path_; }
    // A damaged page was met while writing: keep the file as alarm.db.corrupt-<epoch>, start new.
    bool replaceCorrupt(std::string& err);
    // Names of alarm.db.corrupt-* files kept beside the database (at most 3, oldest removed).
    std::vector<std::string> corruptFiles() const;

    // One transaction: rows (upsert by id ascending), overrides in order, meta keys. Nothing is
    // kept on failure (lastErrorCode() has the extended SQLite code).
    bool commit(const std::vector<OccurrenceRow>& rows,
                const std::vector<OverrideChange>& overrides,
                const std::map<std::string, std::string>& meta, std::string& err);
    int lastErrorCode() const { return lastRc_; }
    bool lastErrorIsCorrupt() const;

    // Rebuild data for AlarmEngine::load (contracts §4.1, §4.2).
    std::vector<OccurrenceRow> loadOpen(std::string& err);
    std::vector<OverrideRow> loadOverrides(std::string& err);
    // max(alarm_meta.high_water, MAX(id)) + 1
    int64_t nextOccurrence();

    // Maintenance (contracts §8). One batch per call; -1 on error.
    // Deletes up to `batch` closed rows with clock_ok = 1 older than now - retentionDays; does
    // nothing (0) when the clock is not valid. high_water is raised in the same transaction.
    int purgeExpired(int64_t nowEpochMs, bool clockOk, int retentionDays, int batch,
                     std::string& err);
    // While usedBytes() > maxBytes: deletes up to `batch` oldest closed rows by id; 0 when the size
    // is within 95 % of the limit (the caller loops until 0).
    int purgeOverSize(int64_t maxBytes, int batch, std::string& err);
    // Bytes in pages that hold data: (page_count - freelist_count) * page_size.
    int64_t usedBytes();
    int64_t countRows();
    int64_t countOpen();
    bool setMeta(const std::string& key, const std::string& value, std::string& err);
    std::optional<std::string> getMeta(const std::string& key);

    // For tests and the tools.
    std::string pragmaText(const char* name);
    int64_t pragmaInt(const char* name);
    // First line of PRAGMA integrity_check(n) joined; "ok" when sound.
    std::string integrityCheck(int maxLines = 10);
    bool hasIndex(const std::string& name);
    sqlite3* handle() { return db_; }  // read-only helper for tests (EXPLAIN QUERY PLAN)

   private:
    bool openFile(std::string& err);
    bool createSchema(std::string& err);
    bool run(const char* sql, std::string& err);
    bool renameAndRecreate(std::string& err);
    void makePrivate();
    void pruneCorruptFiles();

    std::string dir_, path_;
    std::function<int64_t()> nowMs_;
    sqlite3* db_ = nullptr;
    bool recovered_ = false;
    bool schemaTooNew_ = false;
    int lastRc_ = 0;
};

// The schema of version 1 (copied from data-model.md §3).
extern const char* const kSchemaV1;

}  // namespace mat::alarm
