// Audit log of the device (specs/005-device-online research R11, data-model §7, ADR-011):
// <dataDir>/audit.db, SQLite in WAL mode with synchronous=FULL (Constitution 2.0.1, second
// exception), so a record that append() has returned survives a power cut.
//
// One object per process, shared by every thread: one SQLite connection behind one mutex. SQLite
// has one writer per file anyway, a FULL commit costs one fsync, and the coalescing state below
// needs the same lock. The device commands run in a child process dropped to `matscada` that opens
// its own AuditLog (never carry an open one across fork); the two connections wait on each other
// through busy_timeout. Call close() before execv, so that the counts still in memory are written.
//
// Failed sign-ins, refusals while locked and refused accesses (auditLimited()) are coalesced per
// (action, result, code, target, source address, user) for 60 s: the first event writes its row
// at once, later ones only count in memory, and the count is written with the next write, by
// flushExpired() once the 60 s are over, by query(), maintain() and close(). At most 10 such rows
// per minute; beyond that events are counted in one audit.suppressed row per minute. A power cut
// can lose only counts still in memory, never a row append() has returned.
#pragma once
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

#include "core/audit/audit_actions.hpp"

namespace mat {

constexpr const char* kAuditFileName = "audit.db";
constexpr int64_t kAuditWindowMs = 60000;       // coalescing window and rate-limit period
constexpr int kAuditLimitedRowsPerWindow = 10;  // rows of auditLimited() kinds per 60 s
constexpr size_t kAuditMaxDetailBytes = 1024;
constexpr int kAuditQueryDefaultLimit = 100;
constexpr int kAuditQueryMaxLimit = 200;

// The record could not be committed (log not open, disk full, file read-only or damaged). The
// caller refuses the operation: 503 AUDIT_UNAVAILABLE, or exit code 5 for a device command.
class AuditUnavailable : public std::runtime_error {
   public:
    explicit AuditUnavailable(const std::string& what, int sqliteCode = 0)
        : std::runtime_error(what), sqliteCode_(sqliteCode) {}
    // Extended SQLite result code (SQLITE_FULL, SQLITE_READONLY, ...); 0 when not from SQLite.
    int sqliteCode() const { return sqliteCode_; }

   private:
    int sqliteCode_;
};

// One event to record. There is no field for a password, a token or a hash: `user` is a name,
// and append() refuses a `detail` with a key that looks like a secret.
struct AuditEvent {
    AuditEvent(AuditAction a, AuditResult r, AuditChannel c, std::string src)
        : action(a), result(r), channel(c), source(std::move(src)) {}

    AuditAction action;
    AuditResult result;
    AuditChannel channel;
    std::string source;                 // "IP:port", "cli" or "system"; required
    std::optional<std::string> user;    // account, or the name typed at a failed sign-in
    std::optional<std::string> role;    // role at the time of the event
    std::optional<std::string> target;  // digest, seq, account name, API path
    std::optional<std::string> code;    // error code: AUTH_FAILED, E_PKG_PATH, ...
    std::string detail;                 // JSON object text (build it with mat::jsonText), "" = none
};

// A stored row. Text columns come back as stored, so rows of a later version read fine.
struct AuditRecord {
    int64_t id = 0;
    int64_t tsMs = 0;      // UTC ms of the event; of the first one for a coalesced row
    bool clockOk = false;  // false: the device clock was not synchronised
    std::optional<std::string> user;
    std::optional<std::string> role;
    std::string source;
    std::string channel;
    std::string action;
    std::optional<std::string> target;
    std::string result;
    std::optional<std::string> code;
    std::optional<std::string> detail;
    int64_t count = 1;  // events in the row (coalesced kinds, audit.suppressed)
};

struct AuditQuery {
    std::optional<int64_t> fromMs;        // ts_ms >= fromMs
    std::optional<int64_t> toMs;          // ts_ms < toMs
    std::optional<std::string> user;      // exact name
    std::string actionPrefix;             // "project." …; "" = every action
    std::optional<std::string> target;    // exact: a Tag id for tag.write (feature 006)
    std::optional<int64_t> beforeId;      // id < beforeId: the next page
    int limit = kAuditQueryDefaultLimit;  // clamped to 1 … kAuditQueryMaxLimit
};

struct AuditPage {
    std::vector<AuditRecord> records;  // newest first (highest id first)
    std::optional<int64_t> next;       // beforeId of the next page; nullopt on the last page
};

struct AuditMaintenance {
    bool retentionRan = false;  // false: device clock not synchronised, rows kept
    int64_t expired = 0;        // rows older than the retention deleted
    int64_t purged = 0;         // oldest rows deleted above the size cap (with audit.purged)
    std::string error;          // first failure, "" when everything ran
};

// Clocks and the "device clock is synchronised" check, injectable for tests.
struct AuditClock {
    std::function<int64_t()> wallMs;             // UTC ms: ts_ms, retention cutoff
    std::function<int64_t()> monoMs;             // CLOCK_BOOTTIME ms: windows, rate limit
    std::function<bool(int64_t wallMs)> synced;  // clock_ok; retention runs only when true
};

constexpr const char* kTimesyncFlag = "/run/systemd/timesync/synchronized";
// systemd-timesyncd has synchronised the clock (the flag file exists) and the time is not before
// the build of the runtime (clockFloorMs() of 003).
bool timesyncSynchronized(const std::string& flagPath, int64_t wallMs);
// system_clock, CLOCK_BOOTTIME and timesyncSynchronized(kTimesyncFlag, ·).
AuditClock systemAuditClock();

struct AuditOptions {
    std::string dataDir;                    // <dataDir>/audit.db
    int retentionDays = 365;                // auditRetentionDays
    int64_t maxBytes = 64LL * 1024 * 1024;  // auditMaxMB × 1 MiB
    AuditClock clock;                       // an empty member takes the system one
    // Feature 006 (audit.db version 2): the boot id of the kernel that stamps the table of write
    // request ids (empty: /proc/sys/kernel/random/boot_id), and how many rows of it are kept.
    std::string bootId;
    size_t tagWriteMaxRows = 4096;
};

// One row of the table of accepted write requests (data-model §9).
struct TagWriteRow {
    std::string requestId;
    int64_t startedId = 0;            // id of the audit record "started"
    std::optional<int64_t> resultId;  // id of the record of the end; nullopt: no result yet
    int64_t tsMs = 0;                 // when it was received (UTC ms; may be wrong)
    std::string boot;                 // the boot id of that run
};

struct TagWriteInfo {
    TagWriteRow row;
    AuditRecord started;  // the audit rows themselves (the detail holds the values)
    std::optional<AuditRecord> result;
};

constexpr int64_t kTagWriteKeepMs =
    15 * 60 * 1000;  // a request id is remembered this long (running time)

class AuditLog {
   public:
    // Throws std::invalid_argument for an empty dataDir, retentionDays < 1 or maxBytes < 1.
    explicit AuditLog(AuditOptions options);
    ~AuditLog();  // close()
    AuditLog(const AuditLog&) = delete;
    AuditLog& operator=(const AuditLog&) = delete;

    // Opens or creates audit.db (files 0600, WAL, synchronous=FULL, cache 256 KiB) and runs
    // maintain() once. false + `err` when the file cannot be opened or set up: every append()
    // then throws AuditUnavailable. A maintenance failure does not fail open().
    bool open(std::string& err, AuditMaintenance* maintenance = nullptr);
    // Writes the counts still in memory (best effort), then closes. open() may follow.
    void close();
    bool isOpen() const;
    const std::string& path() const;

    // Records one event and returns once its row is committed and synced: the id of the row that
    // counts it (its own, the row of its 60 s window, or the audit.suppressed row). Throws
    // AuditUnavailable when that cannot be done (an event that only counts in memory needs no
    // write), std::invalid_argument for an empty source or a `detail` that is not a JSON object
    // or carries a secret-like key. Fields are made valid UTF-8 and cut to their size limits;
    // a `detail` above 1 KiB keeps its keys, with its longest strings cut and "truncated": true.
    int64_t append(const AuditEvent& event);
    // Writes the counts of the windows whose 60 s are over. Cheap when there are none: the runtime
    // may call it every few seconds. Throws AuditUnavailable.
    void flushExpired();
    // Retention and size cap; the runtime calls it every 24 h (open() runs it too). Rows older
    // than retentionDays go only when clock.synced(nowMs) is true. Above maxBytes the oldest 10 %
    // of the rows go, step by step, each step with an audit.purged row. Never throws.
    AuditMaintenance maintain(int64_t nowMs);
    // Newest first, after writing the counts still in memory. Throws AuditUnavailable.
    AuditPage query(const AuditQuery& query);
    // Oldest first: the rows with id > afterId that match the filters of `query` (beforeId, when
    // set, still bounds them above), at most query.limit (clamped like query()). `next` is the
    // afterId of the following page, nullopt on the last one. For --export-audit, which reads the
    // whole log page by page; same writes of counts and same exceptions as query().
    AuditPage queryAscending(const AuditQuery& query, int64_t afterId = 0);

    // ---- tag writes (feature 006 T143; data-model §9, research R15) ----
    // Transaction 1, synced (FULL): the record "started" (action tag.write) and the row of the
    // table of request ids, together. Returns the id of the record. Throws AuditUnavailable when
    // it cannot be committed, and for a request id that is already in the table (nothing is
    // left behind: the whole transaction is rolled back), std::invalid_argument for an event that
    // is not tag.write / started or a detail as append() refuses.
    int64_t appendTagWriteStarted(const AuditEvent& started, const std::string& requestId);
    // Transaction 2, synced: the record of the end (ok, failed or interrupted) and the link from
    // the row. Throws AuditUnavailable when the request is not in the table or already has one.
    int64_t appendTagWriteResult(const AuditEvent& result, const std::string& requestId);
    std::optional<TagWriteInfo> findTagWrite(const std::string& requestId);
    // At start-up, before any write is taken: every row without a result gets a record
    // "interrupted" (code UNKNOWN_OUTCOME, the detail copied from its record of receipt), all in
    // one transaction; the commands are never sent again. Returns how many. Safe to run again.
    size_t recoverTagWrites();
    // Every 10 minutes: removes rows that have a result and are 15 minutes old in running time
    // (rows of an earlier boot count from the start of this run, so a wrong clock after a power cut
    // cannot drop them early), then the oldest finished ones above the limit of rows. One
    // transaction; rows without a result stay. Returns how many rows went.
    size_t pruneTagWrites();
    size_t tagWriteRowCount();

    // Diagnostics and test hooks on the log's own connection.
    std::string pragmaText(const char* name);
    int64_t pragmaInt(const char* name);
    bool execForTest(const std::string& sql, std::string& err);

   private:
    AuditPage run(const AuditQuery& query, int64_t afterId, bool ascending);
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace mat
