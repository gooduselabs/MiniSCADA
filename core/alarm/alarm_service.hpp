// The service around alarm.db (specs/009-alarms contracts/alarm-store.md §5, §6): a one-way queue
// from the tick thread, one writer thread that commits in batches (adaptive window), purges by age
// and size, handles a full disk and a damaged file. The tick thread never waits for SQLite.
// Audit is injected as a function (this module does not depend on core/audit).
#pragma once
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "core/alarm/alarm_store.hpp"
#include "core/alarm/alarm_types.hpp"

namespace mat::alarm {

enum class LogState : uint8_t { Running, Paused, Error };
const char* logStateName(LogState s);

// A system audit line the writer thread asks for after the COMMIT of its changes.
struct SystemAudit {
    std::string action;  // alarm.shelve, alarm.unshelve, alarm.purged
    std::string target;  // instance id or "alarm.db"
    std::string detail;  // JSON object text, <= 1 KiB
    std::string code;    // "" or DB_CORRUPT
};

struct ServiceOptions {
    std::string dir;                  // <dataDir>
    int commitMs = 2000;              // alarmCommitMs
    int commitMaxMs = 60000;          // alarmCommitMaxMs (ADR-028 spike T006)
    int commitRows = 200;             // alarmCommitRows
    size_t bufferMax = 5000;          // alarmBufferMax
    int stormChangesPerS = 5;         // above this for stormWindowMs the window grows to commitMaxMs
    int stormWindowMs = 10000;
    int purgeIntervalS = 3600;        // alarmPurgeIntervalS
    int retentionDays = 180;
    int64_t maxBytes = 67108864;
    int purgeBatch = 1000;
    int64_t minFreeBytes = 0;         // shared with history.db; 0 = never pause
    int retryMs = 10000;              // after a failed write
    int errorAfterFailures = 3;       // consecutive failures -> LogState::Error
    int purgePauseMs = 50;            // between purge batches
    std::function<int64_t()> nowEpochMs;                // default: system clock
    std::function<bool(int64_t)> clockOk;               // default: always true
    std::function<int64_t()> freeBytes;                 // default: statvfs(dir)
    std::function<void(const SystemAudit&)> audit;      // called by the writer thread
    int testCommitDelayMs = 0;        // tests: the writer sleeps inside every commit
    int testFailCommits = 0;          // tests: the first N commit attempts fail (transient error)
};

// What one engine event asks of the store: rows to upsert, an override to write or delete, a
// system audit line (self-shelve and its end only). Pure; the vector runner of the tests uses it
// as its model of alarm.db, so the model and the service cannot drift apart.
struct EventChanges {
    std::vector<OccurrenceRow> rows;
    std::vector<OverrideChange> overrides;
    std::optional<SystemAudit> audit;
};
EventChanges changesOf(const AlarmEvent& e);

class AlarmService {
   public:
    explicit AlarmService(ServiceOptions opt);
    ~AlarmService();
    AlarmService(const AlarmService&) = delete;
    AlarmService& operator=(const AlarmService&) = delete;

    // Opens alarm.db and starts the writer thread. A failed open (schemaTooNew, I/O) leaves the
    // service in LogState::Error with the writer idle: the engine still runs in RAM (FR-043).
    bool start(std::string& err);
    // Writes what is queued, marks the file clean and stops the writer.
    void stop();

    // Rebuild data for AlarmEngine::load, read from alarm.db (empty when the store is not open).
    LoadContext loadContext(int64_t nowMonoMs, int64_t nowEpochMs, bool clockOk, bool processStart);
    // After AlarmEngine::load: rows of the stale overrides to delete.
    void applyLoadReport(const LoadReport& report);

    // Tick thread: events of AlarmEngine::takeEvents(). Short lock, never touches SQLite.
    void push(const std::vector<AlarmEvent>& events);

    // Waits until everything queued is committed (tests, shutdown); false on timeout.
    bool flush(int timeoutMs);

    LogState logState() const { return logState_.load(); }
    uint64_t droppedChanges() const { return dropped_.load(); }
    uint64_t commits() const { return commits_.load(); }
    bool recovered() const { return recovered_.load(); }
    int64_t dbBytes() const { return dbBytes_.load(); }
    size_t queued() const;
    int currentWindowMs() const { return window_.load(); }
    AlarmStore& store() { return store_; }  // tests only, while the writer is stopped or idle

   private:
    struct Queue {
        std::map<int64_t, OccurrenceRow> rows;
        std::vector<OverrideChange> overrides;
        std::map<std::string, std::string> meta;
        std::vector<SystemAudit> audits;
        size_t count() const { return rows.size() + overrides.size() + meta.size(); }
    };
    void writerLoop();
    bool commitQueue(Queue& q);  // q: the batch taken from queue_
    void maintain();
    void resyncOpen();
    void trimBufferLocked();
    int64_t freeBytes() const;

    ServiceOptions opt_;
    AlarmStore store_;
    std::thread writer_;
    mutable std::mutex mu_;
    std::condition_variable cv_;
    Queue queue_;
    std::map<int64_t, OccurrenceRow> liveOpen_;  // open rows by id (resync after a damaged file)
    int64_t firstPendingMs_ = -1;                // steady ms of the first change not written
    std::deque<int64_t> stamps_;                 // steady ms of the last changes (storm detection)
    int64_t maxOccurrence_ = 0;
    bool stop_ = false, flushRequested_ = false, needResync_ = false, inFlight_ = false;
    int64_t retryAtMs_ = 0;
    std::atomic<LogState> logState_{LogState::Running};
    std::atomic<uint64_t> dropped_{0}, commits_{0};
    std::atomic<bool> recovered_{false};
    std::atomic<int64_t> dbBytes_{0};
    std::atomic<int> window_{2000};
    std::atomic<int> failInject_{0};
    int failures_ = 0;
    int64_t lastPurgeSteadyMs_ = 0;
    bool started_ = false;
};

}  // namespace mat::alarm
