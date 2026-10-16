// The coordinator of tag writes (feature 006 T139; FR-036 to FR-042; research R14; data-model §8).
// One object between the HTTP API and the drivers. For each request, after the sign-in checks of
// the HTTP layer (step 1 of FR-037), it runs steps 2 to 8 in order and stops at the first that
// fails: REJECTED with its reason, and nothing goes to the field. A command that passes is
// recorded durably (audit "started" and the request id) BEFORE it is handed to the driver, then
// follows the state machine of data-model §8 to CONFIRMED, FAILED or TIMEOUT. Whatever the
// session does afterwards, the command runs to its end and its result is audited under the account
// that sent it.
//
// Threads: submit()/status() on HTTP workers; onDriverResult() on the engine's tick thread (it only
// queues); the results go to the audit on a thread of its own, so that no fsync is awaited by the
// engine. quiesce() blocks the caller (the deploy pipeline).
#pragma once
#include <condition_variable>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include "core/tag-engine/pulse_journal.hpp"
#include "core/tag-engine/tag_model.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "core/tag-engine/token_bucket.hpp"
#include "core/tag-engine/write_audit.hpp"
#include "drivers/sdk/driver.hpp"

namespace mat {

// The value of a request as the client wrote it. Numbers keep their kind so that INT64 and UINT64
// stay exact; a decimal string (required for 64-bit values beyond 2^53) is Text.
struct WriteValue {
    enum class Kind { None, Bool, Int, Uint, Float, Text } kind = Kind::None;
    bool b = false;
    int64_t i = 0;
    uint64_t u = 0;
    double d = 0;
    std::string s;

    static WriteValue boolean(bool v) {
        WriteValue w;
        w.kind = Kind::Bool;
        w.b = v;
        return w;
    }
    static WriteValue integer(int64_t v) {
        WriteValue w;
        w.kind = Kind::Int;
        w.i = v;
        return w;
    }
    static WriteValue unsignedInt(uint64_t v) {
        WriteValue w;
        w.kind = Kind::Uint;
        w.u = v;
        return w;
    }
    static WriteValue number(double v) {
        WriteValue w;
        w.kind = Kind::Float;
        w.d = v;
        return w;
    }
    static WriteValue text(std::string v) {
        WriteValue w;
        w.kind = Kind::Text;
        w.s = std::move(v);
        return w;
    }
    // The value as JSON text, and the key that tells two requests have the same content.
    std::string json() const;
    bool operator==(const WriteValue& o) const { return json() == o.json(); }
};

// Feature 007 (device-api-1.2 §6, research R17): which screen and widget sent the command (a hint
// for whoever reads the audit, never used for rights; a field of the wrong shape is dropped).
struct WriteContext {
    std::string screen, widget;
};

constexpr int64_t kPulseMinMs = 100;
constexpr int64_t kPulseMaxMs = 10000;

struct WriteRequest {
    std::string requestId;  // UUID v4, lower case (checked by the HTTP layer)
    std::string tag;
    WriteValue value;
    // Feature 007: `expect` (BOOL Tags: the value the person saw; another current value is
    // STALE_EXPECTATION and nothing goes to the field), `pulseMs` (BOOL Tags: the runtime writes
    // `value`, waits, writes the opposite, whatever the browser does; 100 to 10000), `context`.
    std::optional<bool> expect;
    std::optional<int64_t> pulseMs;
    WriteContext context;
    // Feature 011 (logic v2): the command of a rule (caller channel "logic"): what the audit record
    // carries about the rule (WriteRecord::logicJson); "" otherwise.
    std::string logicJson;
};

// What the API shows for a request: the answer of POST and the answer of GET (device-api-1.1 §3).
struct WriteView {
    std::string requestId;
    // ACCEPTED, REJECTED, CONFIRMED, FAILED, TIMEOUT, or UNKNOWN (no such request for this caller)
    std::string status;
    std::string
        code;  // REJECTED: the reason; otherwise CONFIRMED, NO_READBACK, DEVICE_EXCEPTION ...
    std::string phase;    // ACCEPTED: queued
    std::string message;  // Vietnamese, for a refusal
    int64_t retryAfterMs = 0;
    bool duplicate = false;
    std::string tag;
    bool hasValue = false;
    WriteValue value;
    bool hasOld = false;
    TagScalar oldValue;
    Quality oldQuality = Quality::BAD;
    bool hasRaw = false;
    TagScalar raw;
    bool hasReadback = false;
    TagScalar readback;
    int exception = -1;
    int64_t receivedAtMs = 0;
    int64_t finishedAtMs = 0;
    bool clockOk = false;
    // Feature 007: a pulse. `pulseMs` > 0 for a command with one; `pulseReleased` once it ended
    // (true: the opposite value was written; false: it was not and the bit may still be on).
    int64_t pulseMs = 0;
    bool pulseEnded = false;
    bool pulseReleased = false;
};

// The world behind the coordinator: the drivers and the engine (the runtime), or a fake.
class WriteBackend {
   public:
    virtual ~WriteBackend() = default;
    // Link state of the channel and field device of an external Tag (FR-037 step 5).
    virtual drv::LinkState link(size_t tag) = 0;
    // Hands the command over: the driver of the Tag's channel, the engine for an internal Tag, the
    // simulation driver for a manual one. false: the queue is full.
    virtual bool submit(size_t tag, drv::WriteCommand cmd) = 0;
    // Removes the commands that no driver has begun to send; their internal ids (FR-042).
    virtual std::vector<uint64_t> cancelUnsent() = 0;
    // The longest time a field device waits for an answer, ms (sizes the wait of quiesce).
    virtual int64_t maxTimeoutMs() = 0;
};

struct CoordinatorOptions {
    RateConfig rate;
    int queuePerChannel = 16;
    int queueTotal = 64;
    std::function<int64_t()> monoMs;                  // empty: CLOCK_BOOTTIME
    std::function<int64_t()> wallMs;                  // empty: the system clock
    std::function<bool(int64_t wallMs)> clockSynced;  // empty: true
    int64_t resultTtlMs = 15 * 60 * 1000;             // a result can be asked for this long
    size_t maxResults = 1024;
    int64_t rejectedTtlMs = 10 * 60 * 1000;
    size_t maxRejected = 1024;
    std::function<void(const std::string&)> log;  // empty: stderr
    // Feature 011 (FR-018 to FR-020; research R6): the durable journal of pulses. Null: no journal
    // (the behaviour of 007: a kill -9 in the middle of a pulse leaves the bit on).
    PulseLog* pulseLog = nullptr;
    int64_t pulseRetryMs = 5000;                     // a pulse owed: tried again this often
    int64_t pulseRecoveryWindowMs = 10 * 60 * 1000;  // and for this long, then PULSE_STUCK
    int64_t pulseQueueRetryMs = 100;  // a driver queue that cannot take a release: again after this
    int pulseQueueAttempts = 5;       // ... this many times, then PULSE_RELEASE_FAILED
    // The Tags of the pulses that could not be released (PULSE_STUCK), each time the set changes
    // (empty: the warning ends). Called without the coordinator's lock held.
    std::function<void(const std::vector<std::string>& tags)> pulseStuck;
    std::function<std::string()> newRequestId;  // empty: a random UUID v4
};

class WriteCoordinator {
   public:
    // `model` and `store` outlive the coordinator (the model of the project that runs).
    WriteCoordinator(const ProjectModel& model, const TagStore& store, WriteBackend& backend,
                     WriteAudit& audit, CoordinatorOptions options = {});
    ~WriteCoordinator();  // drains the audit queue
    WriteCoordinator(const WriteCoordinator&) = delete;
    WriteCoordinator& operator=(const WriteCoordinator&) = delete;

    // The requests of one POST, in order; one view each (ACCEPTED or REJECTED). Never throws.
    std::vector<WriteView> submit(const WriteCaller& who,
                                  const std::vector<WriteRequest>& requests);
    // The state of a request for its owner (or an administrator); UNKNOWN otherwise.
    WriteView status(const WriteCaller& who, const std::string& requestId);

    // A write result from a driver (or the engine, for an internal Tag): any thread, returns at
    // once.
    void onDriverResult(const drv::WriteResult& result);

    // FR-042: no new command (PROJECT_CHANGING); commands no driver began become FAILED
    // NOT_SENT_PROJECT_CHANGE; the commands being sent are waited for, at most 2 x the longest
    // device timeout + 1 s and never above 25 s; then the audit queue is emptied. Blocks.
    struct QuiesceReport {
        int cancelled = 0;
        int waited = 0;      // commands that were being sent when it began
        int unfinished = 0;  // still without a result when the wait ended
    };
    QuiesceReport quiesce();
    bool changing() const;

    // A refusal decided outside (the HTTP layer: no session, wrong role, plain HTTP; the live
    // channel): audited as tag.write denied. Never throws.
    void recordDenied(const WriteCaller& who, const std::string& requestId, const std::string& tag,
                      const WriteValue& value, bool hasValue, const std::string& code);

    // The same for a value already in JSON text (the live channel hands over what it read).
    void recordDeniedJson(const WriteCaller& who, const std::string& requestId,
                          const std::string& tag, const std::string& valueJson,
                          const std::string& code);

    // Feature 011 (FR-019): the pulses the journal still holds armed at start (a kill -9 or a power
    // cut between the first write and the release). `enabled` (pulseRecovery "on"): each is
    // released as soon as its channel and field device are connected, tried every pulseRetryMs for
    // pulseRecoveryWindowMs, audited as tag.write with detail.source "pulse-recovery" under the
    // account of the pulse, durably before the write (Constitution V); once the window is over the
    // entry stays in the journal and the Tag is reported stuck (PULSE_STUCK). `enabled` false:
    // nothing is written, every entry is stuck at once. Never blocks.
    void recoverPulses(const std::vector<PulseArm>& armed, bool enabled);
    struct PulseRecoveryState {
        std::vector<std::string> pending;  // Tags of the releases still being tried
        std::vector<std::string> stuck;    // Tags of the entries kept (PULSE_STUCK)
    };
    PulseRecoveryState pulseRecovery() const;

    // Waits until every result handed over so far is in the audit (tests, shutdown).
    void waitAuditIdle();
    // How many commands are waiting for a result (queued or being sent).
    size_t outstanding() const;

   private:
    struct Entry;
    struct Checked;
    struct Recovery;

    // A refusal: audited as denied, and remembered (unless "remember" is false: a conflict must not
    // hide the command that already has this id).
    WriteView reject(const WriteCaller& who, const WriteRequest& req, const std::string& code,
                     const std::string& message, int64_t retryAfterMs = 0, bool remember = true);
    bool check(const TagModel& t, const WriteValue& v, Checked& out, std::string& code,
               std::string& message);
    WriteView viewOf(const Entry& e) const;
    void finish(Entry& e, const drv::WriteResult& r);
    void finishLocked(Entry& e, const std::string& status, const std::string& code, int exception,
                      bool hasReadback, const TagScalar& readback);
    void prune(int64_t now);
    void auditThread();
    void pulseThread();
    void releasePulse(const std::string& requestId);
    // Feature 011: the pulses the runtime owes a release (journal entries still armed).
    bool pulseBusyLocked(size_t tag) const;
    void attemptRecovery(const std::string& rid);
    void addRecoveryLocked(const PulseArm& arm, const WriteCaller* who, int64_t firstTry);
    void closeOwedLocked(size_t tag, std::vector<std::string>& rids);
    void journalDone(std::vector<std::string> rids);
    void notifyStuck();
    WriteRecord recoveryRecordLocked(const Recovery& rc);
    std::string newRequestId();
    void logLine(const std::string& line);
    void postAudit(std::function<void()> job);
    int64_t mono() const;
    int64_t wall() const;

    const ProjectModel& model_;
    const TagStore& store_;
    WriteBackend& backend_;
    WriteAudit& audit_;
    CoordinatorOptions opt_;
    WriteRateLimiter limiter_;

    mutable std::mutex mu_;
    std::condition_variable doneCv_;
    std::map<std::string, std::unique_ptr<Entry>> entries_;  // by request id
    std::unordered_map<uint64_t, std::string> byInternal_;   // internal id -> request id
    std::map<size_t, int> queuedPerChannel_;                 // channel (npos: none) -> commands out
    int queuedTotal_ = 0;
    int submitting_ = 0;  // commands between their audit record and the driver
    uint64_t nextId_ = 1;
    bool changing_ = false;
    // Pulses (feature 007): the commands whose first write is done and whose opposite write waits,
    // by due time on the monotonic clock, and the thread that sends the opposite writes.
    std::multimap<int64_t, std::string> pulseDue_;
    bool releaseNow_ = false;  // quiesce: every pulse ends at once
    bool pulseStop_ = false;
    std::condition_variable pulseCv_;
    std::thread pulseThread_;
    // Feature 011: by the request id of the pulse in the journal; internal id -> that id.
    std::map<std::string, std::unique_ptr<Recovery>> recoveries_;
    std::unordered_map<uint64_t, std::string> recoveryByInternal_;
    std::mutex stuckMu_;  // taken before mu_; orders the calls of pulseStuck
    std::vector<std::string> lastStuck_;

    std::mutex auditMu_;
    std::condition_variable auditCv_;
    std::deque<std::function<void()>> auditQueue_;
    bool auditBusy_ = false;
    bool auditStop_ = false;
    std::thread auditThread_;
};

}  // namespace mat
