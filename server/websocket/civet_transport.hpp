// The only CivetWeb-dependent part of the live protocol (ADR-001: keep the web server swappable).
// One SendQueue + one writer thread per accepted session (research R4): the hub and the ticker
// only enqueue, so a slow client can never block the broadcaster or other clients.
#pragma once
#include <atomic>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "core/session-manager/send_queue.hpp"
#include "core/session-manager/session_manager.hpp"
#include "server/websocket/live_hub.hpp"

struct mg_connection;
struct mg_context;

namespace mat {

class CivetLiveTransport : public LiveTransport {
   public:
    struct Options {
        size_t maxClients = 10;
        size_t queueBytes = SendQueue::kDefaultMaxBytes;
        int64_t heartbeatTimeoutMs = 15000;
        std::vector<std::string> allowedOrigins;
    };
    using Clock = std::function<int64_t()>;  // monotonic ms

    CivetLiveTransport(Options opt, Clock monotonic);
    ~CivetLiveTransport() override;

    void attach(LiveHub* hub) { hub_ = hub; }
    void install(mg_context* ctx, const char* uri);

    SendQueue::PushResult push(uint64_t sid, std::string text) override;
    void close(uint64_t sid, int code, const std::string& reason) override;

    // Called by the ticker: closes sessions silent for longer than the timeout (4408).
    void expire();

    size_t active() const { return sessions_.active(); }
    size_t maxClients() const { return sessions_.maxClients(); }
    uint64_t rejectedTotal() const { return sessions_.rejectedTotal(); }
    uint64_t originRejectedTotal() const { return originRejected_; }
    uint64_t timeoutClosedTotal() const { return timeoutClosed_; }
    uint64_t writeFailedTotal() const { return writeFailed_; }

   private:
    struct Session {
        explicit Session(size_t queueBytes) : queue(queueBytes) {}
        uint64_t sid = 0;
        CivetLiveTransport* owner = nullptr;
        mg_connection* conn = nullptr;
        SendQueue queue;
        std::thread writer;
        std::atomic<bool> dead{false};
        std::atomic<int64_t> forceCloseAt{0};  // monotonic ms; 0 = no deadline
    };

    static int onConnect(const mg_connection* c, void* self);
    static void onReady(mg_connection* c, void* self);
    static int onData(mg_connection* c, int flags, char* data, size_t len, void* self);
    static void onClose(const mg_connection* c, void* self);
    static void writerLoop(Session* s);
    void reject(mg_connection* c, int code, const char* reason);
    std::shared_ptr<Session> find(uint64_t sid);

    Options opt_;
    Clock clock_;  // monotonic
    SessionManager sessions_;
    LiveHub* hub_ = nullptr;
    std::mutex mu_;
    std::map<uint64_t, std::shared_ptr<Session>> bySid_;
    std::map<const mg_connection*, int64_t> rejected_;  // connection -> force-close deadline
    std::atomic<uint64_t> originRejected_{0};
    std::atomic<uint64_t> timeoutClosed_{0};
    std::atomic<uint64_t> writeFailed_{0};
};

void sendWebSocketClose(mg_connection* c, int code, const std::string& reason);

}  // namespace mat
