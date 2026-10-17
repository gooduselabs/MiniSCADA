// The logic v2 engine in the runtime (feature 011 T136, T137, T139; FR-076 to FR-091; ADR-037;
// contracts/logic-engine.md §2, §8, §9; device-api-011 §4). One object per running project with a
// logic.json:
//   - round(): called by the Tag Engine once per round (Engine::setRoundHook), right after the
//     calculated Tags: every logic.scanMs it scans the engine (core/logic) over that round's
//     values, publishes the logic Tags in the same batch, hands setTag/toggle to the engine (next
//     round) and queues write/pulse for the dispatcher. Never blocks on I/O.
//   - the dispatcher thread: each write/pulse of a rule goes to the WriteCoordinator with
//     actor `logic:<ruleId>`, channel `logic`, the inputs of the condition (at most 8): the checks
//     of 006 and the durable audit record BEFORE anything is sent are the coordinator's
//     (Constitution V); a pulse goes through the pulse journal there. The edgeId of the firing is
//     written to logic-state.json before the command, so an edge is never reused after a crash.
//     Refusals and final results reach the rule's lastError; nothing is ever retried.
//   - writes off (runtime.json logic.writes) or stopped by an administrator (persistent in
//     logic-state.json, cleared only by root): every write/pulse is SUPPRESSED, nothing is sent,
//     audit logic.write.suppressed (coalesced), warning LOGIC_WRITES_OFF. The stop also takes the
//     commands already queued (suppressed) and the one being handed over, checked again just
//     before it goes to the coordinator (T062). A logic-state.json that is there but cannot be
//     read starts with the writes stopped (warning reason STATE_UNREADABLE), cleared only by root.
//   - logic-state.json is written outside mu_ (its own mutex, the snapshot taken under mu_): an
//     fsync never holds up the Tag Engine round (T062). A refusal of a limit:
//     audit logic.throttled (coalesced), warning LOGIC_THROTTLED while a rule is THROTTLED.
//   - retain (FR-090): retainDue() gives the logic/<id>/<field> values that changed, every
//     logic.flushS and at stop; a damaged store starts every block at 0 with LOGIC_RETAIN_LOST
//     and one audit logic.retain.lost.
// Thread-safe: round() on the tick thread, the API calls on HTTP workers.
#pragma once
#include <sys/types.h>

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
#include <unordered_map>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/logic/engine.hpp"
#include "core/tag-engine/engine.hpp"
#include "core/tag-engine/retain_store.hpp"
#include "core/tag-engine/tag_model.hpp"
#include "core/tag-engine/write_coordinator.hpp"
#include "nlohmann/json.hpp"
#include "server/system_warnings.hpp"

namespace mat {

constexpr const char* kLogicStateFile = "logic-state.json";
// The request of `mat-runtime --logic-writes-reset` (root): clear an administrator stop.
constexpr const char* kLogicWritesResetFile = "logic-writes-reset.req";
constexpr int64_t kLogicWritesResetPollMs = 5000;  // how often the runtime looks for it
constexpr size_t kLogicMaxInputs = 8;              // inputs of the condition in the audit (FR-080)

struct LogicOptions {
    int scanMs = 100;
    int tzOffsetMin = 420;
    int maxWritesPerMin = 20;
    int flushS = 60;
    std::string writes = "off";  // runtime.json logic.writes
    std::string statePath;       // <dataDir>/logic-state.json; "" = nothing persisted (tests)
    // <dataDir>/logic-writes-reset.req (mat-runtime --logic-writes-reset): taken at start and every
    // kLogicWritesResetPollMs by the dispatcher; "" = none.
    std::string writesResetRequestPath;
    // T062: the owner the request must have (root); the file must be a regular file without any
    // group or other permission, or it is deleted and ignored. Tests: their own uid.
    uid_t writesResetUid = 0;
    // T062 (tests): writes logic-state.json durably; empty: temporary file, fsync, rename.
    std::function<bool(const std::string& path, const std::string& text, std::string& error)>
        writeState;
    std::function<int64_t()> monoMs;     // empty: CLOCK_BOOTTIME
    std::function<int64_t()> wallMs;     // empty: the system clock (UTC ms)
    std::function<bool()> timeSynced;    // empty: true (server/time_sync.hpp in the runtime)
    SystemWarnings* warnings = nullptr;  // LOGIC_WRITES_OFF, LOGIC_THROTTLED, LOGIC_RETAIN_LOST
    // The logic.* audit records (AuditLog::append); empty: none.
    std::function<void(const AuditEvent&)> audit;
    std::function<void(const std::string&)> log;  // empty: stderr
    int64_t resultPollMs = 200;  // how often the dispatcher asks the coordinator for a final result
};

// The retained keys of a document with their types (RetainStore::configure).
std::vector<std::pair<std::string, TagType>> logicRetainKeys(const nlohmann::json& doc);
// RetainStore values (by key) <-> the engine's JSON values.
logic::RetainMap logicRetainFromStore(const std::map<std::string, RetainValue>& values);
RetainValue logicRetainToStore(const std::string& key, const nlohmann::json& v);

class LogicSubsystem {
   public:
    // `model` holds the logic Tags (buildProjectModel); `doc` passed the validator. `retain`: the
    // logic/ values the store read at start; `retainLost`: the store was damaged. Throws
    // std::invalid_argument when the document cannot run.
    LogicSubsystem(const ProjectModel& model, const nlohmann::json& doc, LogicOptions options,
                   const logic::RetainMap& retain, bool retainLost);
    ~LogicSubsystem();
    LogicSubsystem(const LogicSubsystem&) = delete;
    LogicSubsystem& operator=(const LogicSubsystem&) = delete;

    // Where write/pulse go; null: each is refused (lastError WRITER_MISSING). Before the first
    // round that fires one.
    void setCoordinator(WriteCoordinator* coordinator);

    // The tick thread, inside the engine round.
    void round(EngineRound& io);

    // The retained values that changed since the last call: every flushS, or now with `force`
    // (the stop). Empty when nothing changed (nothing is written then).
    std::vector<std::pair<std::string, RetainValue>> retainDue(bool force);

    // GET /api/v1/logic (device-api-011 §4).
    nlohmann::json status();
    // system/info.logic.writes: "off" (configuration), "on", "stopped" (administrator).
    std::string writesState();

    // POST /api/v1/logic/writes {"enabled": false}: stops every write at once, durably (kept over
    // a restart). false with `code` when it could not be made durable (nothing changed).
    bool stopWrites(const WriteCaller& who, std::string& code);
    // The request of `mat-runtime --logic-writes-reset` (root only, the API cannot enable: 403
    // LOGIC_ENABLE_ROOT_ONLY): when the request file is there, the stop is cleared durably
    // (logic-state.json keeps its edges), the file deleted, audit logic.writes.enabled. true when a
    // request was taken. A file that is not a regular file is deleted and ignored. Called at start
    // and by the dispatcher every kLogicWritesResetPollMs.
    bool applyWritesReset();
    // POST /api/v1/logic/reset: a counter, totalizer or run-hours block back to `value`. false with
    // `code` NO_SUCH_BLOCK or NOT_RESETTABLE.
    bool reset(const std::string& id, double value, const WriteCaller& who, std::string& code);

    bool retainLost() const { return retainLost_; }
    // Tests: wait until every queued write was handed over and answered (ACCEPTED or REJECTED).
    void waitIdle();
    // Stops the dispatcher (queued writes that were not handed over are dropped and logged).
    void stop();

   private:
    struct Pending;
    void dispatcherLoop();
    void handOver(Pending& p);
    // mu_ held: logic-state.json as it is, with `stopped` for writesStopped.
    std::string stateTextLocked(bool stopped) const;
    // stateMu_ held, mu_ not: the text on disk, durably.
    bool writeState(const std::string& text, std::string& error);
    void loadState();
    // The queued commands, suppressed (an administrator stop).
    void dropQueued();
    void auditLocked(AuditAction action, AuditResult result, const std::string& user,
                     const std::string& target, const std::string& code, nlohmann::json detail);
    void updateWarningsLocked(int64_t now);
    expr::InputValue readTag(const EngineRound& io, const std::string& id) const;
    int64_t mono() const;
    int64_t wall() const;
    void logLine(const std::string& line);

    const ProjectModel& model_;
    nlohmann::json doc_;
    LogicOptions opt_;
    bool retainLost_ = false;
    std::unordered_map<std::string, size_t> index_;               // Tag id -> model index
    std::vector<std::pair<std::string, size_t>> outputs_;         // logic Tag -> model index
    std::map<std::string, std::vector<std::string>> ruleInputs_;  // rule -> Tags of `when`

    // logic-state.json: taken before mu_ by whoever persists, held while the file is written
    // (mu_ only for the snapshot), so the files are written in the order of their snapshots.
    std::mutex stateMu_;
    mutable std::mutex mu_;  // the engine and everything below
    std::unique_ptr<logic::Engine> engine_;
    WriteCoordinator* coordinator_ = nullptr;
    bool stopped_ = false;  // by an administrator (logic-state.json)
    std::string stoppedBy_;
    int64_t stoppedAt_ = 0;
    std::string stopReason_;  // STATE_UNREADABLE: logic-state.json was there but unreadable
    std::map<std::string, int64_t> edges_;  // rule -> the last edgeId handed to the coordinator
    std::string writesKey_;                 // writes state the warnings were set for
    bool throttledWarn_ = false;
    std::optional<int64_t> nextScan_;
    int64_t lastFlushMono_ = 0;
    logic::RetainMap flushed_;
    double lastScanMs_ = 0;
    std::vector<double> scanMsWindow_;  // last 100 scan durations (p99)
    uint64_t overruns_ = 0;
    std::map<std::string, std::string> lastErrorCode_;  // rule -> code of the last refusal

    // the dispatcher
    std::mutex qMu_;
    std::condition_variable qCv_;
    std::deque<std::unique_ptr<Pending>> queue_;
    size_t inFlight_ = 0;
    bool qStop_ = false;
    std::condition_variable idleCv_;
    struct Outstanding {
        std::string rule, requestId;
        WriteCaller who;
    };
    std::vector<Outstanding> outstanding_;  // accepted, waiting for a final result
    int64_t lastResetPoll_ = 0;             // monotonic time the reset request was last looked for
    std::thread dispatcher_;
};

}  // namespace mat
