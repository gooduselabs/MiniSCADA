#include "server/websocket/civet_transport.hpp"

#include <cstdio>
#include <cstring>
#include <limits>
#include <system_error>

#include "civetweb.h"
#include "server/websocket/origin.hpp"

// mAT patch in third_party/civetweb/civetweb.c (see third_party/LICENSES.md).
extern "C" void mg_mat_force_close(struct mg_connection* conn);

namespace mat {

namespace {
// Marker stored as connection user data for connections without a session (server full, or the
// writer thread could not be started).
char kRejected;

const char* const kFullMessage =
    "{\"type\":\"error\",\"code\":\"MAX_CLIENTS_REACHED\",\"message\":\"Hệ thống đã đạt tối đa "
    "10 kết nối. Vui lòng thử lại sau.\"}";

// After our close frame the client has this long to close; then the TCP connection is shut down
// so a client that never answers cannot keep a CivetWeb worker thread (review minor-2).
constexpr int64_t kCloseGraceMs = 5000;
constexpr int64_t kNever = std::numeric_limits<int64_t>::max();
}  // namespace

void sendWebSocketClose(mg_connection* c, int code, const std::string& reason) {
    std::string p;
    p.push_back(static_cast<char>((code >> 8) & 0xFF));
    p.push_back(static_cast<char>(code & 0xFF));
    p += reason.substr(0, 120);
    mg_websocket_write(c, MG_WEBSOCKET_OPCODE_CONNECTION_CLOSE, p.data(), p.size());
}

CivetLiveTransport::CivetLiveTransport(Options opt, Clock monotonic)
    : opt_(std::move(opt)),
      clock_(monotonic),
      sessions_(opt_.maxClients, std::move(monotonic), opt_.heartbeatTimeoutMs) {}

CivetLiveTransport::~CivetLiveTransport() {
    std::map<uint64_t, std::shared_ptr<Session>> all;
    {
        std::lock_guard<std::mutex> g(mu_);
        all.swap(bySid_);
    }
    for (auto& kv : all) {
        kv.second->queue.abort();
        if (kv.second->writer.joinable()) kv.second->writer.join();
    }
}

void CivetLiveTransport::install(mg_context* ctx, const char* uri) {
    mg_set_websocket_handler(ctx, uri, onConnect, onReady, onData, onClose, this);
}

std::shared_ptr<CivetLiveTransport::Session> CivetLiveTransport::find(uint64_t sid) {
    std::lock_guard<std::mutex> g(mu_);
    auto it = bySid_.find(sid);
    return it == bySid_.end() ? nullptr : it->second;
}

SendQueue::PushResult CivetLiveTransport::push(uint64_t sid, std::string text) {
    auto s = find(sid);
    if (!s) return SendQueue::PushResult::Closed;
    auto r = s->queue.push(std::move(text));
    if (r == SendQueue::PushResult::Overflow) {
        sessions_.release(sid);  // free the slot now
        std::fprintf(stderr, "live: session %llu send queue > %zu B: resync_required + 4409\n",
                     static_cast<unsigned long long>(sid), s->queue.maxBytes());
    }
    return r;
}

void CivetLiveTransport::close(uint64_t sid, int code, const std::string& reason) {
    if (auto s = find(sid)) s->queue.requestClose(code, reason);
}

void CivetLiveTransport::expire() {
    for (uint64_t sid : sessions_.expireIds()) {
        ++timeoutClosed_;
        std::fprintf(stderr, "live: session %llu silent > timeout: 4408\n",
                     static_cast<unsigned long long>(sid));
        close(sid, 4408, "HEARTBEAT_TIMEOUT");
    }
    // Connections still open after the grace period of our close frame: shut the socket down.
    // Safe under mu_: a connection stays in these maps until its close handler (which needs
    // mu_) removes it, and CivetWeb frees it only after that handler returns.
    const int64_t now = clock_();
    std::lock_guard<std::mutex> g(mu_);
    for (auto& kv : bySid_) {
        Session& s = *kv.second;
        const int64_t at = s.forceCloseAt.load();
        if (at != 0 && now >= at) {
            s.forceCloseAt = kNever;
            mg_mat_force_close(s.conn);
        }
    }
    for (auto it = rejected_.begin(); it != rejected_.end();) {
        if (now >= it->second) {
            mg_mat_force_close(const_cast<mg_connection*>(it->first));
            it = rejected_.erase(it);
        } else {
            ++it;
        }
    }
}

void CivetLiveTransport::writerLoop(Session* s) {
    SendQueue::Item it;
    while (s->queue.pop(it, -1) == SendQueue::PopStatus::Item) {
        if (it.closeCode != 0) {
            sendWebSocketClose(s->conn, it.closeCode, it.closeReason);
            s->dead = true;
            s->forceCloseAt = s->owner->clock_() + kCloseGraceMs;
            return;
        }
        const int n =
            mg_websocket_write(s->conn, MG_WEBSOCKET_OPCODE_TEXT, it.text.data(), it.text.size());
        // A timeout in the middle of a frame returns the bytes written so far (review I-1): any
        // short write leaves the frame stream corrupt, so it counts as a failure too.
        if (n != static_cast<int>(it.text.size())) {
            ++s->owner->writeFailed_;
            s->owner->sessions_.release(s->sid);  // free the slot now, like an overflow
            std::fprintf(stderr,
                         "live: session %llu write failed/timed out (queued %zu B): dropped\n",
                         static_cast<unsigned long long>(s->sid), s->queue.bytes());
            s->dead = true;
            s->queue.abort();
            mg_mat_force_close(s->conn);  // conn is alive: onClose joins this thread first
            return;
        }
    }
}

int CivetLiveTransport::onConnect(const mg_connection* c, void* self) {
    auto* t = static_cast<CivetLiveTransport*>(self);
    auto* conn = const_cast<mg_connection*>(c);
    if (!isOriginAllowed(mg_get_header(conn, "Origin"), mg_get_header(conn, "Host"),
                         t->opt_.allowedOrigins)) {
        ++t->originRejected_;
        static const char kBody[] = "Origin not allowed";
        mg_printf(conn,
                  "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: %zu\r\n"
                  "X-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n%s",
                  sizeof kBody - 1, kBody);
        return 1;  // no handshake, no slot
    }
    return 0;
}

void CivetLiveTransport::reject(mg_connection* c, int code, const char* reason) {
    mg_set_user_connection_data(c, &kRejected);
    {
        std::lock_guard<std::mutex> g(mu_);
        rejected_[c] = clock_() + kCloseGraceMs;
    }
    sendWebSocketClose(c, code, reason);
}

void CivetLiveTransport::onReady(mg_connection* c, void* self) {
    auto* t = static_cast<CivetLiveTransport*>(self);
    auto id = t->sessions_.tryAcquire();
    if (!id) {
        mg_websocket_write(c, MG_WEBSOCKET_OPCODE_TEXT, kFullMessage, std::strlen(kFullMessage));
        t->reject(c, 4429, "MAX_CLIENTS_REACHED");
        return;
    }
    auto s = std::make_shared<Session>(t->opt_.queueBytes);
    s->sid = *id;
    s->owner = t;
    s->conn = c;
    try {
        s->writer = std::thread(writerLoop, s.get());
    } catch (const std::system_error& e) {
        // Out of threads/memory: refuse this session instead of terminating (review minor-7).
        std::fprintf(stderr, "live: cannot start writer thread: %s\n", e.what());
        t->sessions_.release(*id);
        t->reject(c, 1013, "TRY_AGAIN_LATER");
        return;
    }
    {
        std::lock_guard<std::mutex> g(t->mu_);
        t->bySid_[s->sid] = s;
    }
    mg_set_user_connection_data(c, s.get());
    if (t->hub_) t->hub_->onOpen(s->sid);
}

int CivetLiveTransport::onData(mg_connection* c, int flags, char* data, size_t len, void* self) {
    auto* t = static_cast<CivetLiveTransport*>(self);
    void* ud = mg_get_user_connection_data(c);
    if (ud == nullptr || ud == &kRejected) return 0;  // rejected: end the connection
    auto* s = static_cast<Session*>(ud);
    if (s->dead) return 0;
    const int opcode = flags & 0xF;
    if (opcode == MG_WEBSOCKET_OPCODE_CONNECTION_CLOSE) return 0;
    t->sessions_.heartbeat(s->sid);  // any frame from the client keeps the slot
    if (opcode == MG_WEBSOCKET_OPCODE_TEXT && t->hub_) t->hub_->onMessage(s->sid, data, len);
    return 1;
}

void CivetLiveTransport::onClose(const mg_connection* c, void* self) {
    auto* t = static_cast<CivetLiveTransport*>(self);
    void* ud = mg_get_user_connection_data(c);
    if (ud == &kRejected) {
        std::lock_guard<std::mutex> g(t->mu_);
        t->rejected_.erase(c);
        return;
    }
    if (ud == nullptr) return;
    auto* raw = static_cast<Session*>(ud);
    std::shared_ptr<Session> s;
    {
        std::lock_guard<std::mutex> g(t->mu_);
        auto it = t->bySid_.find(raw->sid);
        if (it != t->bySid_.end()) {
            s = it->second;
            t->bySid_.erase(it);
        }
    }
    if (!s) return;
    t->sessions_.release(s->sid);
    if (t->hub_) t->hub_->onClose(s->sid);
    s->queue.abort();
    if (s->writer.joinable()) s->writer.join();  // writer must not touch conn after this returns
    mg_set_user_connection_data(const_cast<mg_connection*>(c), nullptr);
}

}  // namespace mat
