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
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include "core/common/json_limits.hpp"
#include "core/session-manager/send_queue.hpp"
#include "core/tag-engine/tag_store.hpp"

namespace mat {

constexpr const char* kLiveProtocolVersion = "1.1.0";

class LiveTransport {
   public:
    virtual ~LiveTransport() = default;
    virtual SendQueue::PushResult push(uint64_t sid, std::string text) = 0;
    virtual void close(uint64_t sid, int code, const std::string& reason) = 0;
};

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

    void onOpen(uint64_t sid);
    void onMessage(uint64_t sid, const char* data, size_t len);
    void onClose(uint64_t sid);
    // Called every deltaPeriodMs: deltas for changed subscribed tags, heartbeat when due.
    void tick();

    void setProjectJson(std::string json);
    uint64_t overflowClosedTotal() const;

   private:
    struct Session {
        std::string subscriptionId;
        bool subscribed = false;
        std::vector<size_t> tags;                       // store index per position
        std::unordered_map<size_t, uint32_t> position;  // store index -> position
        int64_t sequence = 0;
        int errorStreak = 0;
        bool dead = false;  // overflowed / closing: no more pushes
    };

    void sendLocked(uint64_t sid, Session& s, std::string text);
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
};

}  // namespace mat
