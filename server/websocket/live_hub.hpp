// Live protocol 1.1.0 (specs/002-vertical-slice/contracts/live-ws.md, plus
// specs/005-device-online/contracts/live-protocol-1.1.md: hello.project.digest, close 1012 before
// the runtime restarts), independent of the web server: the transport only moves text frames.
// `hubMu_` covers both subscribe (snapshot +
// registration) and tick (delta generation + enqueue), so no delta can slip between a snapshot
// and the moment the session starts receiving deltas (Sprint 0 race, FR-020). The hub never
// writes to a socket: LiveTransport::push only enqueues (SendQueue).
#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_set>
#include <vector>

#include "core/common/json_limits.hpp"
#include "core/session-manager/send_queue.hpp"
#include "core/tag-engine/tag_store.hpp"

namespace mat {

// 1.2.0 (feature 006, contracts/live-protocol-1.2.md): the reason of a quality other than GOOD in
// snapshot and delta, the WebSocket upgrade with a session, close 4401.
// 1.3.0 (feature 009, specs/009-alarms/contracts/live-protocol-1.3.md): hello.features,
// subscribeAlarms / unsubscribeAlarms, alarmSnapshot (parts of at most 100 instances) and
// alarmDelta, held back per instance while the send queue of a session is near full.
// 1.4.0 (feature 013, contracts/admin-api.md §6): a Tag the session may not see is answered in the
// `denied` list of the snapshot (no value), and {"type":"access-changed"} tells the page that its
// access changed (the Tags it lost are no longer sent).
constexpr const char* kLiveProtocolVersion = "1.4.0";

class LiveTransport {
   public:
    virtual ~LiveTransport() = default;
    virtual SendQueue::PushResult push(uint64_t sid, std::string text) = 0;
    // Feature 011 (FR-009 liveLagP95Ms): a delta, with the monotonic ms of the Tag Engine round
    // that committed its values. A transport that does not measure sends it as any message.
    virtual SendQueue::PushResult pushDelta(uint64_t sid, std::string text, int64_t commitMono) {
        (void)commitMono;
        return push(sid, std::move(text));
    }
    virtual void close(uint64_t sid, int code, const std::string& reason) = 0;
    // Live 1.3.0 §5: how full the send queue of a session is (0..100). 0 when unknown: the alarm
    // messages are then never held back.
    virtual int queueFillPercent(uint64_t) { return 0; }
    // The size of that queue in bytes, to tell how much a message adds to it.
    virtual size_t queueCapacity(uint64_t) { return SendQueue::kDefaultMaxBytes; }
};

// Live 1.3.0: what the hub reads of the alarm engine, as JSON texts the glue builds
// (server/alarm_glue), so that the hub stays free of core/alarm.
struct AlarmLiveChange {
    std::string id;
    std::string json;  // the whole instance (§3.2); empty: the instance was removed
    // The same without account names and free text, for a connection without a sign-in (M1).
    std::string publicJson;
};
// Feature 013 (contracts/access-model.md §4, alarm(P)): the alarms a session may see, by instance
// id, and the counts (§3.3) over only those, of the same view as the message that carries it.
using AlarmIdFilter = std::function<bool(const std::string& id)>;
using AlarmCountsFn = std::function<std::string(const AlarmIdFilter& allow)>;
struct AlarmLiveBatch {
    int64_t revision = 0;
    std::string counts = "{}";  // §3.3
    std::vector<AlarmLiveChange> changes;
    // The counts for a session that may not see every alarm; empty: such a session gets zeros.
    AlarmCountsFn countsFor;
};
struct AlarmLiveSnapshot {
    bool ready = true;  // false: the engine has not run its first tick (§7)
    int64_t revision = 0;
    std::string counts = "{}";
    std::string classes = "[]";
    std::string areas = "[]";
    std::vector<std::string> instances;  // one JSON object text each
    std::vector<std::string> ids;        // feature 013: the id of each instance (same order)
    AlarmCountsFn countsFor;             // feature 013: as AlarmLiveBatch::countsFor
};

// Feature 013 (live 1.4.0, contracts/admin-api.md §6): what one session may receive. `all`: every
// Tag and alarm (an administrator, or no access control). The hub asks again about once a second;
// a grant with another fingerprint unsubscribes the Tags lost and sends {"type":"access-changed"}.
struct LiveGrant {
    bool all = true;
    std::unordered_set<size_t> tags;  // store indexes, when !all
    AlarmIdFilter alarm;              // empty: every alarm
    std::string fingerprint;
    bool tag(size_t i) const { return all || tags.count(i) > 0; }
    bool alarmOk(const std::string& id) const { return all || !alarm || alarm(id); }
};
using LiveGrantPtr = std::shared_ptr<const LiveGrant>;
// Called under the lock of the hub; must not call the hub. nullptr: no access control.
using LiveGrantFn = std::function<LiveGrantPtr()>;
constexpr int64_t kLiveGrantCheckMs = 1000;
class AlarmLiveSource {
   public:
    virtual ~AlarmLiveSource() = default;
    virtual bool hasAlarms() const = 0;  // hello.features has "alarms"
    // The present set (§3); `full` false: without account names and free text (M1).
    virtual AlarmLiveSnapshot snapshot(bool full) = 0;
    // Once per hub tick: the changes since the last call (the newest per id), and the counts and
    // revision of now. Empty `changes`: nothing to send.
    virtual AlarmLiveBatch takeChanges() = 0;
};

// Live 1.3.0 §3.4, §4, §5 (data-model §4).
constexpr size_t kAlarmChunk = 100;      // instances per alarmSnapshot part / alarmDelta
constexpr int kAlarmHoldHighPct = 50;    // queue above this: changes are held back
constexpr int kAlarmHoldLowPct = 25;     // queue below this: the held changes are sent
constexpr int kAlarmSubscribeLimit = 5;  // subscribeAlarms per 10 s per session
constexpr int64_t kAlarmSubscribeWindowMs = 10000;

struct HubOptions {
    std::string serverVersion;
    size_t maxClients = 10;
    int64_t heartbeatMs = 5000;
    int64_t timeoutMs = 15000;
    size_t maxMessageBytes = 98304;              // 96 KiB: 1000 tags x 64-char ids fit (review I-3)
    int maxMessageDepth = kMaxLiveMessageDepth;  // checked before parsing (review M3)
    size_t maxSubscribeTags = kMaxLiveSubscribeTags;
    int maxConsecutiveErrors = 20;
    std::string projectJson = "null";  // {"projectId","projectVersion","digest"} or null
};

class LiveHub {
   public:
    using Clock = std::function<int64_t()>;  // ms
    // `epoch` stamps messages (ts); `monotonic` schedules heartbeats so that wall-clock jumps
    // (NTP/RTC corrections) cannot stop them (review I-2). Defaults to `epoch` (tests).
    LiveHub(TagStore& store, LiveTransport& tx, HubOptions opt, Clock epoch,
            Clock monotonic = nullptr);

    // `authenticated`: the connection carries a valid sign-in (token or cookie); only then the
    // alarm messages have account names and free text (M1).
    // Feature 013: `grant` gives what the session may receive (asked now and every second).
    void onOpen(uint64_t sid, bool authenticated = false, LiveGrantFn grant = {});
    void onMessage(uint64_t sid, const char* data, size_t len);
    void onClose(uint64_t sid);
    // Called every deltaPeriodMs: deltas for changed subscribed tags, heartbeat when due.
    // `commitMono`: the monotonic ms (the clock of the transport) of the Tag Engine round just
    // before; 0: the hub's monotonic clock at the start of this call (feature 011, FR-009).
    void tick(int64_t commitMono = 0);

    void setProjectJson(std::string json);
    // A {"type":"write"} message gets BAD_MESSAGE (no writes over the live channel, FR-036) and
    // this hook, for the audit record tag.write denied LIVE_WRITE_NOT_ALLOWED. `tag` and `value`
    // are what could be read from the message (empty when absent; value as JSON text).
    using RejectedWriteFn =
        std::function<void(const std::string& tag, const std::string& value, uint64_t sid)>;
    void setRejectedWriteHook(RejectedWriteFn fn);
    uint64_t overflowClosedTotal() const;
    // Live 1.3.0: the alarm engine behind subscribeAlarms (null: no alarms, empty snapshots), and
    // the hook of an {"type":"ack"} / {"type":"alarmAck"} message (refused with BAD_MESSAGE, and
    // audited as alarm.ack denied LIVE_ACK_NOT_ALLOWED). `id` and `occurrence` are what could be
    // read (cut to 64 characters).
    void setAlarmSource(AlarmLiveSource* source);
    using RejectedAckFn =
        std::function<void(const std::string& id, const std::string& occurrence, uint64_t sid)>;
    void setRejectedAckHook(RejectedAckFn fn);
    // Sessions whose alarm changes are held back right now (diagnostics, tests).
    size_t alarmHeldSessions() const;

   private:
    struct Session {
        std::string subscriptionId;
        bool subscribed = false;
        std::vector<size_t> tags;  // store index per position
        // store index -> position, kNoPosition when not subscribed; as long as the highest
        // subscribed index + 1 (a lookup per changed Tag and session in every tick).
        std::vector<uint32_t> positionOf;
        // {"type":"delta","subscriptionId":"…","sequence": (the same in every delta)
        std::string deltaPrefix;
        int64_t sequence = 0;
        int errorStreak = 0;
        bool dead = false;  // overflowed / closing: no more pushes
        // Live 1.3.0: the alarm subscription of the session.
        bool authenticated = false;
        bool alarmSubscribed = false;
        bool alarmWaiting = false;  // subscribed before the engine's first tick
        std::string alarmSubscriptionId;
        int64_t alarmSequence = 0;
        std::vector<int64_t> alarmSubscribeTimes;  // monotonic ms of the last subscribeAlarms
        // The parts of a snapshot not sent yet (sent while the queue is below the high mark).
        struct SnapshotParts {
            std::vector<std::vector<std::string>> chunks;
            std::string classes, areas, counts;
            int64_t revision = 0;
            size_t next = 0;
        };
        std::optional<SnapshotParts> snapshot;
        bool holding = false;
        // Held changes: id -> instance JSON, "" for a removal (§5); at most one per instance.
        std::map<std::string, std::string> alarmPending;
        // Feature 013: the access of the session, asked again every kLiveGrantCheckMs.
        LiveGrantFn grantFn;
        LiveGrantPtr grant;
        int64_t nextGrantCheck = 0;
    };
    void grantTickLocked(int64_t monoNow);
    // Feature 013: `all` (the engine's counts) for a session that sees every alarm, else the
    // counts `fn` gives for its grant (zeros without `fn`).
    static std::string countsForLocked(const Session& s, const std::string& all,
                                       const AlarmCountsFn& fn);

    void subscribeAlarmsLocked(uint64_t sid, Session& s, const std::string& requestId);
    void startSnapshotLocked(uint64_t sid, Session& s, AlarmLiveSnapshot snap);
    void sendSnapshotPartsLocked(uint64_t sid, Session& s);
    void flushAlarmLocked(uint64_t sid, Session& s);
    void alarmTickLocked(int64_t now);

    void sendLocked(uint64_t sid, Session& s, std::string text, int64_t deltaCommitMono = 0);
    void errorLocked(uint64_t sid, Session& s, const char* code, const std::string& message,
                     const std::string& requestId);
    void subscribeLocked(uint64_t sid, Session& s, const std::string& requestId,
                         const std::vector<std::string>& tags);

    TagStore& store_;
    LiveTransport& tx_;
    HubOptions opt_;
    Clock clock_;
    Clock mono_;
    mutable std::mutex hubMu_;
    std::map<uint64_t, Session> sessions_;
    int64_t nextHeartbeat_;
    uint64_t overflowClosed_ = 0;
    RejectedWriteFn onRejectedWrite_;
    AlarmLiveSource* alarms_ = nullptr;
    RejectedAckFn onRejectedAck_;
    int64_t alarmRevision_ = 0;  // of the last batch
    std::string alarmCounts_ = "{}";
    AlarmCountsFn alarmCountsFor_;  // feature 013: of the last batch
    // Buffers of tick(), kept between ticks so that a tick allocates only the texts it enqueues:
    // the part of each changed Tag's entry that is the same for every session (formatted once per
    // tick), its end offsets, and the delta being built.
    std::string deltaTails_;
    std::vector<size_t> deltaTailEnds_;
    std::string deltaOut_;
};

}  // namespace mat
