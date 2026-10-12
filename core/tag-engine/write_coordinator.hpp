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
#include <set>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

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

struct WriteRequest {
    std::string requestId;  // UUID v4, lower case (checked by the HTTP layer)
    std::string tag;
    WriteValue value;
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

    // Waits until every result handed over so far is in the audit (tests, shutdown).
    void waitAuditIdle();
    // How many commands are waiting for a result (queued or being sent).
    size_t outstanding() const;

   private:
    struct Entry;
    struct Checked;

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

    std::mutex auditMu_;
    std::condition_variable auditCv_;
    std::deque<std::function<void()>> auditQueue_;
    bool auditBusy_ = false;
    bool auditStop_ = false;
    std::thread auditThread_;
};

}  // namespace mat
