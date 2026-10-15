// The historian (specs/003-data-logging data-model §3): every 100 ms it samples each logging group
// from the TagStore, buffers rows and commits them to the local SQLite store in one transaction
// every `commitMs`. The only writer of history.db.
#pragma once
#include <atomic>
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include "core/historian/aggregator.hpp"
#include "core/historian/forward/forwarder.hpp"
#include "core/historian/io_meter.hpp"
#include "core/historian/local_store.hpp"
#include "core/historian/logging_config.hpp"
#include "core/historian/sampler.hpp"
#include "core/tag-engine/tag_store.hpp"

namespace mat {

struct HistorianOptions {
    std::string dataDir = "/var/lib/mat-runtime";
    int64_t commitMs = 5000;
    size_t commitRows = 5000;        // commit early when this many rows wait
    size_t maxBufferedRows = 10000;  // while SQLite fails: keep the newest rows
    int64_t retryMs = 10000;
    int64_t clockFloorMs = 0;  // 0 = build time (clockFloorMs()); tests set their own
    // US2: device protection (research R4)
    int64_t maxDbBytes = 2048LL << 20;
    int64_t minFreeBytes = 500LL << 20;
    int64_t resumeExtraBytes = 50LL << 20;  // hysteresis before writing again
    int64_t retentionEveryMs = 3600000;
    int64_t checkEveryMs = 60000;
    int batchRows = 2000;  // rows deleted per pass (retention, cap)
    // Free bytes of the partition holding dataDir; empty = statvfs. Tests inject their own.
    std::function<int64_t(const std::string&)> freeBytes;
    // US3: forwarding to external databases (research R7, R11, R12)
    std::string secretsFile = "/etc/mat-runtime/secrets.json";
    std::string clientLibDir = "/opt/mat-runtime/lib";
    // Empty = readSecret(secretsFile, id) / makeDestination(c, clientLibDir). Tests inject theirs.
    std::function<SecretResult(const std::string&)> secret;
    std::function<std::unique_ptr<Destination>(const ConnectionModel&)> makeDestination;
    // Cursors the forwarders reached go to the eMMC with the next rows; without rows, alone at
    // most this often (review S8: not one more fsync every commit interval).
    int64_t cursorSaveMs = 60000;
    // specs/010-history-reports (aggregate tables)
    int aggBackfillRows = 500;           // raw rows read by one back-fill pass (keeps it ≤ 20 ms)
    int64_t aliveEveryMs = 900000;       // mat_runs.alive_ms, written with the aggregate flush
    // Closed windows, their agg_built_to mark and the run's alive_ms go to the file together, this
    // often (not at every commit): 200 tags give 200 rows a minute, and the pages those rows and the
    // marks dirty are what an eMMC pays for (x64 measure, ADR-031). A crash loses at most this much
    // of the buckets; the restart rebuilds them from the raw rows (history-db.md §4).
    int64_t aggFlushMs = 900000;
    int64_t aggCountEveryMs = 600000;    // COUNT(*) of mat_agg for the status
    std::function<std::optional<int64_t>()> ioSource;  // IoMeter source; empty = /proc/self/io
};

enum class HistorianState { Running, ClockInvalid, PausedLowDisk, Error };
const char* historianStateName(HistorianState s);

struct HistorianStatus {
    HistorianState state = HistorianState::Running;
    bool clockValid = true;
    uint64_t clockJumps = 0;
    uint64_t rowsWritten = 0;
    uint64_t rowsDropped = 0;
    uint64_t stringsTruncated = 0;
    int64_t lastCommitAt = 0;   // UTC ms; 0 = never
    std::string lastErrorCode;  // disk_full / io / corrupt_recovered; empty = none
    std::string lastErrorMessage;
    int64_t lastErrorAt = 0;
    // US2
    int64_t dbBytes = 0;
    int64_t dbMaxBytes = 0;
    int64_t freeBytes = -1;  // -1 = unknown
    int64_t lastRetentionAt = 0;
    uint64_t lastRetentionRows = 0;
    uint64_t capPurges = 0;
    uint64_t capRowsDeleted = 0;  // raw rows
    // US3: one entry per connection that a group points to
    std::vector<DestStatus> destinations;
    // specs/010-history-reports
    uint64_t capRowsDeletedMinute = 0;
    uint64_t capRowsDeletedHour = 0;
    int schema = 1;  // history.db schema (2 = aggregates available)
    bool aggEnabled = false;
    int aggGroups = 0;
    int64_t aggRowsMinute = -1;  // -1 = not counted yet
    int64_t aggRowsHour = -1;
    bool backfillActive = false;
    std::string backfillGroup;
    double backfillProgress = -1;  // 0..1; -1 = none
    uint64_t aggDropped = 0;       // closed windows lost while the file could not be written
    struct GroupInfo {
        std::string id;
        std::string mode;  // cyclic / onChange / trigger
        int64_t rows24h = 0;
        std::string triggerState;  // active / inactive / unknown; empty = not a trigger group
        bool aggregates = false;
    };
    std::vector<GroupInfo> groups;
    IoSnapshot io;
};

class Historian {
   public:
    Historian(LoggingModel model, const TagStore& store, HistorianOptions opt,
              std::function<int64_t()> nowUtc, std::function<int64_t()> nowMono);
    ~Historian();
    Historian(const Historian&) = delete;
    Historian& operator=(const Historian&) = delete;

    // Opens history.db, creates/extends the tables of every group and prepares one forwarder per
    // connection that a group points to.
    bool open(std::string& err);
    // One pass with the injected clocks (the thread calls this every 100 ms).
    void runOnce();
    bool start(std::string& err);  // open() + thread + forwarder threads
    // Stops the thread, commits what is buffered, then stops every forwarder at once (each ends
    // its current batch, research R12) and saves the cursors they reached.
    void stop();
    HistorianStatus status() const;
    const LoggingModel& model() const { return model_; }
    LocalStore& storeForTest() { return local_; }
    std::vector<std::unique_ptr<Forwarder>>& forwardersForTest() { return forwarders_; }

   private:
    void tryCommit(int64_t nowUtc, int64_t nowMono, bool force);
    void setError(const std::string& code, const std::string& msg, int64_t nowUtc);
    void maintain(int64_t nowUtc, int64_t nowMono, bool clockOk);
    void createForwarders();
    std::vector<TableSpec> tableSpecs() const;
    void collectCursors();
    void flushCursors();                 // cursors alone, in a transaction of their own
    bool reopenStore(std::string& err);  // after a failed replacement of a damaged file
    // Review C1: marks the forwarders compared with their destination go off history.db for good;
    // a failed removal is tried again later and later (review of the fixes, minor 7).
    void processMarks(int64_t nowUtc, int64_t nowMono);
    // Stores the marks of the SQL groups with the seq every table had at open (read once).
    bool storeMarks(std::map<LocalStore::MarkKey, int64_t>& marks, std::string& err);
    // Marks that could not be stored at open (review of the fixes, Important 3): tried again with
    // a growing wait; their groups send nothing until the forwarder gets them.
    void retryMarks(int64_t nowUtc, int64_t nowMono);
    // Review I3, I6: a damaged page (commit, reading, retention, size cap): the file is kept for
    // investigation and a new one started; the forwarders follow it.
    void checkDamage(int64_t nowUtc);
    void replaceDamagedFile(int64_t nowUtc, const std::string& why);
    void followNewFile();

    // ---- aggregate tables (specs/010-history-reports contracts/history-db.md)
    struct AggGroup {
        bool enabled = false;
        std::vector<size_t> cols;            // indexes into the group's columns
        std::vector<std::string> colNames;
        std::unique_ptr<GroupAggregator> agg;
        bool initPending = false;            // agg_built_to is NULL: set it when the clock is valid
        int64_t lastMarkMin = -1;
        // back-fill (§5): backwards from `backTo`, one slice of at most one hour at a time
        bool backfillActive = false;
        int64_t backFrom = 0;
        int64_t backTo = 0;
        int64_t backFloor = 0;               // the oldest ts the back-fill will reach
        bool sliceOpen = false;
        int64_t sliceStart = 0;
        int64_t sliceEnd = 0;
        int64_t curTs = 0;
        int64_t curSeq = -1;
        std::unique_ptr<GroupAggregator> sliceAgg;
        std::vector<AggWrite> sliceOut;
        bool sliceReady = false;             // all rows read, only the commit is left
        std::vector<int64_t> sliceRunStarts;  // runs that begin inside the slice
        size_t sliceRunIdx = 0;
        int64_t sliceLastTs = INT64_MIN;     // last row (or the seeded row) fed to the slice
    };
    struct RowCounter {                       // rows per hour, 24 cells
        int64_t hour[24] = {};
        int64_t count[24] = {};
        void add(int64_t nowUtc);
        int64_t last24h(int64_t nowUtc) const;
    };
    void setupAggregates();
    void recoverGroup(size_t gi, int64_t builtTo);
    void feedAggregators(size_t gi, int64_t ts, const std::vector<Cell>& cells);
    void collectAggregates(size_t gi, int64_t nowUtc);
    void breakAggregates(int64_t t);
    void queueHourRebuild(int64_t hourStart);
    void startRun(int64_t nowUtc);
    bool backfillStep(int64_t nowUtc);
    void refreshStatusExtras(int64_t nowUtc, int64_t nowMono);
    std::vector<std::optional<double>> aggValues(size_t gi, const std::vector<Cell>& cells) const;

    LoggingModel model_;
    const TagStore& tags_;
    HistorianOptions opt_;
    std::function<int64_t()> nowUtc_;
    std::function<int64_t()> nowMono_;
    LocalStore local_;
    std::vector<GroupSampler> samplers_;
    std::vector<std::vector<size_t>> indices_;  // TagStore indexes per group
    std::vector<TagValue> values_;
    SamplerStats samplerStats_;
    std::deque<PendingRow> buffer_;
    bool opened_ = false;
    bool started_ = false;  // a pass has run (for jump detection)
    int64_t lastUtc_ = 0;
    int64_t lastMono_ = 0;
    int64_t lastCommitMono_ = 0;
    int64_t retryAtMono_ = 0;
    bool failing_ = false;
    // maintenance (US2)
    int64_t checkDueMono_ = 0;
    int64_t retentionDueMono_ = 0;
    bool retentionActive_ = false;
    struct RetentionTask {
        int kind = 0;  // 0 raw rows, 1 minute buckets, 2 hour buckets
        std::string table;
        int days = 0;
    };
    std::vector<RetentionTask> retentionQueue_;
    size_t retentionIdx_ = 0;
    uint64_t retentionRows_ = 0;
    bool purging_ = false;
    bool paused_ = false;
    // forwarding (US3)
    std::vector<std::unique_ptr<Forwarder>> forwarders_;
    std::vector<std::string> forwarderKeys_;  // forwardCursorKey of each forwarder
    int64_t cursorDueMono_ = 0;
    std::map<std::pair<std::string, std::string>, ForwardCursor> cursors_;  // (dest, table)
    std::map<size_t, std::set<std::string>> pendingMarks_;  // forwarder → tables checked
    int64_t clearRetryAtMono_ = 0;                          // after a failed removal of marks
    int64_t clearBackoffMs_ = 0;
    std::vector<LocalStore::MarkKey> markKeys_;          // (cursor key, table) of SQL groups
    std::map<LocalStore::MarkKey, int64_t> markAtOpen_;  // seq of each table at open
    bool marksPending_ = false;                          // not stored yet: SQL groups wait
    int64_t marksRetryAtMono_ = 0;
    int64_t marksBackoffMs_ = 0;
    std::string fileId_;              // instance id of the file the forwarders follow
    bool maintenanceDamage_ = false;  // retention or the size cap met a damaged page

    // aggregates and status extras (historian thread only, except status_)
    std::vector<AggGroup> aggGroups_;
    std::vector<AggWrite> aggBuffer_;
    std::vector<AggMark> markBuffer_;
    bool aggOn_ = false;       // schema 2 and at least one group with aggregates
    bool aggActive_ = false;   // the aggregators are being fed (clock valid, writing, no error)
    int64_t aggPrevHour_ = -1;
    int64_t lastAggUtc_ = 0;
    int64_t runId_ = -1;
    bool runStarted_ = false;
    int64_t aliveDueMono_ = 0;
    int64_t aggFlushDueMono_ = 0;
    int64_t aggCountDueMono_ = 0;
    int64_t extrasDueMono_ = 0;
    std::vector<RowCounter> counters_;
    std::vector<std::optional<size_t>> triggerIdx_;  // TagStore index of each trigger tag
    std::vector<TagValue> triggerValue_;
    IoMeter io_;

    mutable std::mutex statusMu_;
    HistorianStatus status_;

    std::atomic<bool> running_{false};
    std::thread thread_;
};

}  // namespace mat
