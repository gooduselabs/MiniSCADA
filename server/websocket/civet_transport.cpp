#include "server/websocket/civet_transport.hpp"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <limits>
#include <optional>
#include <system_error>
#include <thread>
#include <vector>

#include "civetweb.h"
#include "server/http/viewer_gate.hpp"
#include "server/websocket/origin.hpp"

// mAT patch in third_party/civetweb/civetweb.c (see third_party/LICENSES.md).
extern "C" void mg_mat_force_close(struct mg_connection* conn);

namespace mat {

namespace {
// Marker stored as connection user data for connections without a session (server full, or the
// writer thread could not be started).
char kRejected;

// After our close frame the client has this long to close; then the TCP connection is shut down
// so a client that never answers cannot keep a CivetWeb worker thread (review minor-2).
constexpr int64_t kCloseGraceMs = 5000;
constexpr int64_t kNever = std::numeric_limits<int64_t>::max();

// Live protocol 1.1.0: "Service Restart" (RFC 6455 §7.4.1 registry), before execv.
constexpr int kCloseRestart = 1012;
constexpr const char* kRestartReason = "SERVICE_RESTART";

// True when the whole frame went out.
bool sendWebSocketClose(mg_connection* c, int code, const std::string& reason) {
    std::string p;
    p.push_back(static_cast<char>((code >> 8) & 0xFF));
    p.push_back(static_cast<char>(code & 0xFF));
    p += reason.substr(0, 120);
    return mg_websocket_write(c, MG_WEBSOCKET_OPCODE_CONNECTION_CLOSE, p.data(), p.size()) > 0;
}
}  // namespace

CivetLiveTransport::CivetLiveTransport(Options opt, Clock monotonic)
    : opt_(std::move(opt)),
      clock_(monotonic),
      sessions_(opt_.maxClients, std::move(monotonic), opt_.heartbeatTimeoutMs),
      // Master Plan 10.2 wording with the real limit, min(config, project) (audit C-15).
      fullMessage_(
          "{\"type\":\"error\",\"code\":\"MAX_CLIENTS_REACHED\",\"message\":\"Hệ thống "
          "đã đạt tối đa " +
          std::to_string(sessions_.maxClients()) + " kết nối. Vui lòng thử lại sau.\"}") {}

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

int CivetLiveTransport::queueFillPercent(uint64_t sid) {
    auto s = find(sid);
    if (!s || s->queue.maxBytes() == 0) return 0;
    return static_cast<int>(s->queue.bytes() * 100 / s->queue.maxBytes());
}

size_t CivetLiveTransport::queueCapacity(uint64_t sid) {
    auto s = find(sid);
    return s ? s->queue.maxBytes() : SendQueue::kDefaultMaxBytes;
}

std::string CivetLiveTransport::remoteOf(uint64_t sid) {
    auto s = find(sid);
    return s ? s->remote : std::string();
}

void CivetLiveTransport::expire() {
    for (uint64_t sid : sessions_.expireIds()) {
        ++timeoutClosed_;
        std::fprintf(stderr, "live: session %llu silent > timeout: 4408\n",
                     static_cast<unsigned long long>(sid));
        close(sid, 4408, "HEARTBEAT_TIMEOUT");
    }
    // Live 1.2.0 §3: a connection that only a token let in ends with 4401 when its session ends.
    if (opt_.gate) {
        std::vector<std::pair<uint64_t, std::shared_ptr<Session>>> watched;
        {
            std::lock_guard<std::mutex> g(mu_);
            const int64_t t = clock_();
            if (nextRecheck_ == 0) nextRecheck_ = t + opt_.recheckMs;
            if (t >= nextRecheck_) {
                nextRecheck_ = t + opt_.recheckMs;
                for (auto& kv : bySid_)
                    if (!kv.second->token.empty() && !kv.second->dead)
                        watched.emplace_back(kv.first, kv.second);
            }
        }
        for (auto& [sid, s] : watched) {
            const bool alive =
                s->tokenIsWeb ? opt_.gate->webSessionAlive(s->token, s->remoteIp, s->remotePort)
                              : opt_.gate->sessionAlive(s->token, s->remoteIp, s->remotePort);
            if (!alive) {
                std::fprintf(stderr, "live: session %llu: sign-in ended: 4401\n",
                             static_cast<unsigned long long>(sid));
                close(sid, 4401, "SESSION_ENDED");
            }
        }
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

size_t CivetLiveTransport::closeAllForRestart(int64_t waitMs) {
    restarting_ = true;                         // from now on onReady refuses with 1012
    std::vector<std::shared_ptr<Session>> all;  // sessions whose writer still runs
    {
        std::lock_guard<std::mutex> g(mu_);
        for (auto& kv : bySid_)
            if (!kv.second->writerDone) all.push_back(kv.second);
    }
    // After what each queue already holds; a session already closing keeps its own code.
    for (auto& s : all) s->queue.requestClose(kCloseRestart, kRestartReason);
    // The writers are on their own threads: wait until each has ended (close frame written, or
    // write failed), at most waitMs. The Session objects stay alive through `all`.
    const auto end = std::chrono::steady_clock::now() + std::chrono::milliseconds(waitMs);
    auto pending = [&] {
        return std::any_of(all.begin(), all.end(), [](const auto& s) { return !s->writerDone; });
    };
    while (pending() && std::chrono::steady_clock::now() < end)
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    return static_cast<size_t>(std::count_if(all.begin(), all.end(), [](const auto& s) {
        return s->closeSent.load() == kCloseRestart;
    }));
}

void CivetLiveTransport::writerLoop(Session* s) {
    struct Done {
        Session* s;
        ~Done() { s->writerDone = true; }
    } done{s};
    SendQueue::Item it;
    while (s->queue.pop(it, -1) == SendQueue::PopStatus::Item) {
        if (it.closeCode != 0) {
            // The grace period starts before the write: a client that cannot even take the close
            // frame is cut on time too.
            s->forceCloseAt = s->owner->clock_() + kCloseGraceMs;
            s->dead = true;
            if (sendWebSocketClose(s->conn, it.closeCode, it.closeReason))
                s->closeSent = it.closeCode;
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
                         t->opt_.allowedOrigins, mg_get_request_info(conn)->is_ssl != 0)) {
        ++t->originRejected_;
        static const char kBody[] = "Origin not allowed";
        mg_printf(conn,
                  "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: %zu\r\n"
                  "X-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n%s",
                  sizeof kBody - 1, kBody);
        return 1;  // no handshake, no slot
    }
    // Feature 007 (ADR-021 point 6): a request that carries the cookie of a web session must come
    // from the page itself: Origin present and equal to https://<Host>. A WebSocket handshake is
    // not limited by the same-origin policy, so a page of another site could open one with the
    // cookie of a visitor (cross-site WebSocket hijacking); refused before the handshake and before
    // a slot.
    if (!mg_get_header(conn, "Authorization")) {
        const char* cookie = mg_get_header(conn, "Cookie");
        const char* origin = mg_get_header(conn, "Origin");
        const char* host = mg_get_header(conn, "Host");
        const auto token = sessionCookieToken(cookie ? std::optional<std::string>(cookie)
                                                     : std::optional<std::string>());
        if (token && !originMatchesHost(origin ? std::optional<std::string>(origin) : std::nullopt,
                                        host ? std::optional<std::string>(host) : std::nullopt)) {
            ++t->originRejected_;
            static const char kBody[] = "Origin not allowed";
            mg_printf(
                conn,
                "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: %zu\r\n"
                "X-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n%s",
                sizeof kBody - 1, kBody);
            return 1;
        }
    }
    // FR-055a: the source filter. A token over HTTP is HTTPS_REQUIRED, a source outside the private
    // networks without a valid session is refused, before the handshake and before a slot.
    if (t->opt_.gate) {
        const FilterDecision d =
            t->opt_.gate->check(FilteredPath::Live, t->opt_.gate->originOf(conn));
        if (!d.allow) {
            const std::string body = blockedJson(d.error);
            mg_printf(conn,
                      "HTTP/1.1 %d %s\r\nContent-Type: application/json; charset=utf-8\r\n"
                      "Content-Length: %zu\r\nX-Content-Type-Options: nosniff\r\nConnection: "
                      "close\r\n\r\n%s",
                      d.status, d.status == 401 ? "Unauthorized" : "Forbidden", body.size(),
                      body.c_str());
            return 1;
        }
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
    if (t->restarting_) {  // the runtime restarts: come back in a second (live 1.1.0)
        t->reject(c, kCloseRestart, kRestartReason);
        return;
    }
    auto id = t->sessions_.tryAcquire();
    if (!id) {
        mg_websocket_write(c, MG_WEBSOCKET_OPCODE_TEXT, t->fullMessage_.data(),
                           t->fullMessage_.size());
        t->reject(c, 4429, "MAX_CLIENTS_REACHED");
        return;
    }
    auto s = std::make_shared<Session>(t->opt_.queueBytes);
    s->sid = *id;
    s->owner = t;
    s->conn = c;
    bool authenticated = true;  // no source filter (tests): nothing to hide from
    {
        const mg_request_info* ri = mg_get_request_info(c);
        s->remoteIp = ri->remote_addr;
        s->remotePort = ri->remote_port;
        s->remote = s->remoteIp + ":" + std::to_string(s->remotePort);
        if (t->opt_.gate) {  // only a token let it in: watch the session
            const RequestOrigin o = t->opt_.gate->originOf(c);
            authenticated = t->opt_.gate->validSession(o) || t->opt_.gate->validWebSession(o);
            if (t->opt_.gate->validSession(o) &&
                t->opt_.gate->wouldBeRefusedWithoutSession(FilteredPath::Live, o)) {
                s->token = *ViewerGate::bearerOf(o);
                s->remoteIp = o.ip;
                s->remotePort = o.port;
            } else if (t->opt_.gate->validWebSession(o) &&
                       t->opt_.gate->wouldBeRefusedWithoutSession(FilteredPath::Live, o)) {
                // feature 007: the cookie of a web session let it in (viewerLogin required, or a
                // source outside the private networks): looked at again every minute
                s->token = *sessionCookieToken(o.cookie);
                s->tokenIsWeb = true;
                s->remoteIp = o.ip;
                s->remotePort = o.port;
            }
        }
    }
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
    if (t->hub_) t->hub_->onOpen(s->sid, authenticated);
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
