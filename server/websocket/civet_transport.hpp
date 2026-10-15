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

class ViewerGate;

class CivetLiveTransport : public LiveTransport {
   public:
    struct Options {
        size_t maxClients = 10;
        size_t queueBytes = SendQueue::kDefaultMaxBytes;
        int64_t heartbeatTimeoutMs = 15000;
        std::vector<std::string> allowedOrigins;
        // Feature 006 (FR-055a, live-protocol-1.2 §2, §3): the source filter and the sessions that
        // let a connection in. Null: no filter.
        ViewerGate* gate = nullptr;
        // How often the sessions of the connections a token let in are looked at again (4401).
        int64_t recheckMs = 60000;
    };
    using Clock = std::function<int64_t()>;  // monotonic ms

    CivetLiveTransport(Options opt, Clock monotonic);
    ~CivetLiveTransport() override;

    void attach(LiveHub* hub) { hub_ = hub; }
    void install(mg_context* ctx, const char* uri);

    SendQueue::PushResult push(uint64_t sid, std::string text) override;
    void close(uint64_t sid, int code, const std::string& reason) override;
    int queueFillPercent(uint64_t sid) override;
    size_t queueCapacity(uint64_t sid) override;

    // Called by the ticker: closes sessions silent for longer than the timeout (4408).
    void expire();

    // Live protocol 1.1.0 (feature 005, contracts/live-protocol-1.1.md §2): just before the runtime
    // restarts (execv to activate a project or to roll back, US2), every session gets close 1012
    // "Service Restart", after what its queue already holds; a session opened afterwards gets 1012
    // at once. Waits until the writers have sent the close frames, at most `waitMs`, and returns
    // how many went out (DeployOperation.clientsNotified). A writer stuck on a client that stopped
    // reading is not waited for beyond `waitMs`.
    size_t closeAllForRestart(int64_t waitMs = 1000);

    // The address ("ip:port") a live session came from; "" when it is gone.
    std::string remoteOf(uint64_t sid);

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
        std::atomic<int> closeSent{0};         // code of the close frame written, 0 = none
        std::atomic<bool> writerDone{false};   // writerLoop has returned
        // Feature 006: where it came from, and the token that let it in when only a token could
        // (a source outside the private networks): looked at again every recheckMs, 4401 when it
        // ended.
        std::string remote;
        std::string remoteIp;
        int remotePort = 0;
        std::string token;        // empty: no recheck
        bool tokenIsWeb = false;  // the token is the cookie of a web session (feature 007)
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
    const std::string fullMessage_;  // `error` MAX_CLIENTS_REACHED sent before close 4429
    LiveHub* hub_ = nullptr;
    std::mutex mu_;
    std::map<uint64_t, std::shared_ptr<Session>> bySid_;
    std::map<const mg_connection*, int64_t> rejected_;  // connection -> force-close deadline
    std::atomic<uint64_t> originRejected_{0};
    std::atomic<uint64_t> timeoutClosed_{0};
    std::atomic<uint64_t> writeFailed_{0};
    std::atomic<bool> restarting_{false};  // closeAllForRestart() has run: new sessions get 1012
    int64_t nextRecheck_ = 0;              // monotonic ms, under mu_
};

}  // namespace mat
