// The source filter at work (feature 006 FR-055a, ADR-018): what a request is (address, listener,
// bearer token), whether its session is valid, and the decision of server/http/source_filter. One
// ViewerGate serves the page handlers (HttpApi) and the live WebSocket (CivetLiveTransport), so
// both refuse the same sources. Counts the refusals for GET /api/v1/diagnostics; never audits one
// (bots scanning the Internet must not wear the eMMC).
#pragma once
#include <atomic>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>

#include "server/http/cookie.hpp"
#include "server/http/source_filter.hpp"

struct mg_connection;

namespace mat {

struct RequestOrigin {
    std::string ip;  // the source address
    int port = 0;
    bool tls = false;
    std::optional<std::string> authorization;  // the Authorization header, nullopt when absent
    // Feature 007: the headers of the cookie session and of the WebSocket upgrade check.
    std::optional<std::string> cookie;  // Cookie
    std::optional<std::string> origin;  // Origin
    std::optional<std::string> host;    // Host
};

class ViewerGate {
   public:
    // True when the session of `token` is alive and was signed in from `ip`; looks only (does not
    // refresh the idle time). In the runtime: AuthService::authorize(token, from, viewer, false).
    using SessionPeek =
        std::function<bool(const std::string& token, const std::string& ip, int port)>;
    // Test hooks: what the request looks like when the real one cannot (an in-process client is
    // always on the loopback).
    struct Hooks {
        std::function<std::string(const std::string& realIp)> remoteIp;
        std::function<bool(bool realTls)> tls;
    };
    using EpochMs = std::function<int64_t()>;

    ViewerGate(ViewerAccess access, SessionPeek peek, Hooks hooks = {}, EpochMs epoch = nullptr);

    ViewerAccess access() const { return access_; }
    // Feature 007 (device-api-1.2 §7): viewerLogin = required, and the check of a cookie session
    // (AuthService::authorizeWeb(token, from, viewer, false), looking only). Set before the
    // contexts start; without them the gate behaves as in 0.5.
    void setWebSessions(SessionPeek peek, bool viewerLoginRequired) {
        webPeek_ = std::move(peek);
        viewerLogin_ = viewerLoginRequired;
    }
    bool viewerLoginRequired() const { return viewerLogin_; }
    // The cookie session of a live connection still lives (looked at again every minute).
    bool webSessionAlive(const std::string& token, const std::string& ip, int port) const {
        return webPeek_ && webPeek_(token, ip, port);
    }
    // HTTPS + the cookie of a web session that checks out (no Authorization header: a Bearer token
    // wins and the cookie is then not looked at).
    bool validWebSession(const RequestOrigin& o) const;
    // From a CivetWeb connection (the callbacks of the page and the WebSocket upgrade).
    RequestOrigin originOf(const mg_connection* c) const;
    // The token of "Bearer <token>"; nullopt when the request has no bearer credential.
    static std::optional<std::string> bearerOf(const RequestOrigin& o);
    // HTTPS + bearer + a session that checks out.
    bool validSession(const RequestOrigin& o) const;
    // The session of a token still lives (for the live connections a token let in).
    bool sessionAlive(const std::string& token, const std::string& ip, int port) const {
        return peek_ && peek_(token, ip, port);
    }
    // Decides and counts a refusal.
    FilterDecision check(FilteredPath path, const RequestOrigin& o);
    // Same decision without a valid session: would this request be refused if it had no token?
    // (a live connection that only a token let in must be checked again every 60 s)
    bool wouldBeRefusedWithoutSession(FilteredPath path, const RequestOrigin& o) const;

    uint64_t blockedTotal() const { return blocked_.load(); }
    int64_t lastBlockedAt() const { return lastBlockedAt_.load(); }

   private:
    ViewerAccess access_;
    SessionPeek peek_;
    SessionPeek webPeek_;
    bool viewerLogin_ = false;
    Hooks hooks_;
    EpochMs epoch_;
    std::atomic<uint64_t> blocked_{0};
    std::atomic<int64_t> lastBlockedAt_{0};
};

}  // namespace mat
