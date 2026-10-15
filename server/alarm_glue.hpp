// The alarm engine in the runtime (feature 009, specs/009-alarms research R7; contracts
// device-api-1.3 §3, live-protocol-1.3 §3-§5): owns the engine and its service (alarm.db), runs
// one engine round right after the Tag Engine's on the tick thread, hands the events to the writer
// and to the live hub, and answers the API: the list, the history, and the commands (acknowledge,
// shelve, unshelve, disable, enable) in the order of device-api-1.3 §3.0:
//   1. plan and reserve what will take effect,
//   2. write ONE audit record and wait for its commit (a failure releases everything: 503),
//   3. only then give the commands to the engine, which applies them at the start of its next round.
// So alarm.db never shows an acknowledgement audit.db does not know (SC-008).
//
// The HTTP layer (server/http/alarms_api) only parses and sends; every rule is here.
#pragma once
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <unordered_map>
#include <vector>

#include "core/alarm/alarm_defs.hpp"
#include "core/alarm/alarm_engine.hpp"
#include "core/alarm/alarm_history.hpp"
#include "core/alarm/alarm_service.hpp"
#include "core/audit/audit_log.hpp"
#include "core/project-manager/project_validator.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "nlohmann/json.hpp"
#include "server/websocket/live_hub.hpp"

namespace mat {

// Who does it: the session behind the request (device-api-1.3 §3.1: channel web with a cookie,
// https with a Bearer token).
struct AlarmActor {
    std::string user, role, source;
    AuditChannel channel = AuditChannel::Https;
};

// An answer ready for the HTTP layer: the status and the JSON body ({"error","message",…} on a
// failure).
struct AlarmApiResult {
    int status = 200;
    nlohmann::json body = nlohmann::json::object();
};

// The body of POST alarms/ack, already parsed and checked for shape by the HTTP layer.
struct AckSpec {
    bool all = false;
    std::vector<alarm::AckRequest::Item> items;  // items mode, 1..100
    int64_t upToRevision = 0;                    // all mode
    // all mode: AND of the keys that are present; an empty list is "no filter on this key".
    std::vector<std::string> areas;    // "-" is "Chung"
    std::vector<std::string> classes;
    std::vector<int> priorities;       // 1..4, exactly these (not "at least")
    std::vector<std::string> states;   // ACTIVE_UNACK, RTN_UNACK; empty: both
    std::string q;                     // <= 80 characters
};

struct AlarmGlueOptions {
    std::string dataDir;
    alarm::AlarmOptions engine;
    alarm::ServiceOptions service;  // `dir` and the clocks are filled in here
    int64_t minFreeBytes = 0;       // shared with history.db: below it alarm.db stops writing
    std::function<int64_t()> epochMs;  // UTC ms
    std::function<int64_t()> monoMs;   // monotonic ms
    std::function<bool(int64_t)> clockOk;
    // AuditLog::append; throws AuditUnavailable when the record cannot be committed.
    std::function<void(const AuditEvent&)> audit;
    int commandWaitMs = 1500;  // how long a request waits for the engine to apply (a tick + margin)
    alarm::HistoryOptions history;
};

class AlarmGlue : public AlarmLiveSource {
   public:
    explicit AlarmGlue(AlarmGlueOptions opt);
    ~AlarmGlue() override;
    AlarmGlue(const AlarmGlue&) = delete;
    AlarmGlue& operator=(const AlarmGlue&) = delete;

    // Compiles the alarms of `project` (null or without alarms: none), opens alarm.db when there
    // are alarms or an alarm.db with open occurrences exists (they are closed by the reconcile),
    // loads the engine and runs its first round on `store`. Tick thread, before the live server.
    // false (and `err`) only when the definitions do not compile; a log that cannot open is not an
    // error (logState = error, the engine runs in RAM, FR-043).
    bool start(const LoadedProject* project, TagStore& store, std::string& err);
    // Writes what is queued and closes alarm.db clean. Idempotent.
    void stop();

    // One round, right after the Tag Engine's. Tick thread.
    void tick();

    bool hasAlarms() const override { return hasAlarms_; }
    alarm::AlarmEngine& engine() { return engine_; }
    alarm::AlarmService* service() { return service_.get(); }
    const alarm::AlarmDefs& defs() const { return defs_; }

    // ---- live (AlarmLiveSource) ----
    alarm::AlarmView currentView() const;
    AlarmLiveSnapshot snapshot() override;
    AlarmLiveBatch takeChanges() override;

    // ---- API ----
    // GET /api/v1/alarms
    nlohmann::json listJson();
    // GET /api/v1/alarms/history (the query is checked by the HTTP layer against the contract)
    AlarmApiResult history(const alarm::HistoryQuery& q);
    // POST alarms/ack, shelve, unshelve, disable, enable. 200 with the contract's body, or the
    // error: 404 ALARM_NOT_FOUND, 409 ALARM_DISABLED, 422 SHELVE_RANGE, 503 AUDIT_UNAVAILABLE,
    // 503 ALARM_TIMEOUT.
    AlarmApiResult ack(const AckSpec& spec, const AlarmActor& who);
    AlarmApiResult shelve(const std::string& id, const std::string& reason, int64_t durationS,
                          const AlarmActor& who);
    AlarmApiResult unshelve(const std::string& id, const AlarmActor& who);
    AlarmApiResult disable(const std::string& id, const std::string& reason,
                           const AlarmActor& who);
    AlarmApiResult enable(const std::string& id, const AlarmActor& who);

    // The block "alarms" of system/info (device-api-1.3 §4.1) and its warnings.
    nlohmann::json infoJson();
    std::vector<std::string> warnings();
    // For the CLI check and the tests.
    std::string dbPath() const;
    // The reservations held now (tests: released after every request).
    size_t reservations() const;
    // Tick time, for the test of SC-019 and the diagnostics: the largest round in the last 60 s.
    double evalMaxMs() const;

   private:
    struct Waiter;
    nlohmann::json itemJson(const alarm::AlarmItem& it) const;
    nlohmann::json countsJson(const alarm::Counts& c) const;
    nlohmann::json classesJson() const;
    nlohmann::json areasJson() const;
    // Gives `cmds` to the engine and waits for every result (nullopt on timeout).
    bool runCommands(std::vector<alarm::Command> cmds, std::vector<alarm::CommandResult>& out);
    // The audit record; false when it could not be written.
    bool writeAudit(AuditAction action, const AlarmActor& who, const std::string& target,
                    const nlohmann::json& detail);
    AlarmApiResult auditDown() const;
    AlarmApiResult notFound(const std::string& id) const;
    AlarmApiResult timeout() const;
    nlohmann::json stateBody(const std::string& id) const;  // revision, counts, state of `id`
    void afterEvents(const std::vector<alarm::AlarmEvent>& events);

    AlarmGlueOptions opt_;
    alarm::AlarmEngine engine_;
    alarm::AlarmDefs defs_;
    std::unique_ptr<alarm::AlarmService> service_;
    std::unique_ptr<alarm::AlarmHistoryReader> reader_;
    TagStore* store_ = nullptr;
    std::vector<size_t> tagIdx_;       // store index per watched Tag; SIZE_MAX: not in the store
    std::vector<TagValue> values_;     // reused by tick()
    std::vector<alarm::TagSample> samples_;
    std::unordered_map<std::string, const alarm::InstanceDef*> byId_;
    std::unordered_map<std::string, std::string> areaName_;
    bool hasAlarms_ = false;
    std::atomic<bool> ticked_{false};
    std::atomic<bool> stopped_{false};
    std::string dbDir_;

    mutable std::mutex liveMu_;
    std::set<std::string> changedIds_;  // instances touched by events since takeChanges()

    mutable std::mutex resMu_;
    std::set<std::pair<std::string, int64_t>> reserved_;  // (instance, occurrence) being acknowledged
    std::vector<alarm::AlarmEvent> eventBuf_;

    mutable std::mutex evalMu_;
    std::deque<std::pair<int64_t, double>> evalRing_;  // (mono ms, round ms)
};

}  // namespace mat
