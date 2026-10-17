// Connections at once per source address (feature 011 T048; FR-025, SC-008; research R10;
// contracts/device-api-011.md §6 `maxConnPerSource`). One limiter is shared by the HTTP and the
// HTTPS context, so the HTTP, HTTPS and WebSocket connections of one IP count together (a WebSocket
// is an upgraded HTTP connection: it is the same socket). Each context has its own pool of workers,
// so a source also holds at most 75 % of the workers of each context (security review of 011, M1:
// with the defaults 18 of the 24 HTTP workers, 48 of the 64 HTTPS workers, 48 over both).
//
// CivetWeb asks the limiter in its master thread as soon as it accepts a socket, before the socket
// waits for a worker and before the TLS handshake (mAT patch 5, third_party/LICENSES.md): a source
// over its limit is closed at once and never holds a worker, not even for the 10 s of a silent
// handshake. The worker gives the place back when the connection ends, whatever the path (request
// done, handshake failed, WebSocket closed, server stopping).
#pragma once
#include <cstdint>
#include <mutex>
#include <string>
#include <unordered_map>

struct sockaddr;

namespace mat {

// The share of the HTTPS workers one source may hold at most (FR-025): 75 % since 2026-10-17 (was
// 60 %).
constexpr int kMaxSourceSharePercent = 75;  // 16 of 64 workers stay for the other sources

// maxConnPerSource as it applies: the configured value, lowered when it would let one source hold
// more than 75 % of the httpsThreads workers (48 of the default 64), at least 1.
int effectiveMaxConnPerSource(int configured, int httpsThreads);

// "a.b.c.d" for IPv4 and IPv4-mapped IPv6 (the same source on either listener), the textual IPv6
// address otherwise, "" for anything else.
std::string sourceAddress(const sockaddr* peer);

// The contexts a connection can come through (WebContexts::Hooks::context).
constexpr int kAnyContext = -1;  // counted only against the shared limit
constexpr int kHttpContext = 0;
constexpr int kHttpsContext = 1;

class ConnLimiter {
   public:
    explicit ConnLimiter(int maxPerSource);
    ConnLimiter(const ConnLimiter&) = delete;
    ConnLimiter& operator=(const ConnLimiter&) = delete;

    // The share of one context: at most `max` connections of one source through it (at least 1),
    // on top of the shared limit. Set by WebContexts before the context accepts anything; a context
    // without one has only the shared limit.
    void setContextLimit(int context, int max);

    // A new connection from `ip` through `context`: true and counted, or false (over the shared
    // limit or the share of the context; not counted).
    bool acquire(const std::string& ip, int context = kAnyContext);
    // The connection of `ip` ended. A release without an acquire is ignored.
    void release(const std::string& ip, int context = kAnyContext);

    int maxPerSource() const { return max_; }
    int count(const std::string& ip) const;               // connections of `ip` now
    int count(const std::string& ip, int context) const;  // of `ip` through `context`
    size_t sources() const;                               // addresses with a connection
    uint64_t refused() const;                             // connections closed at once since start

   private:
    static constexpr int kContexts = 2;
    struct Open {
        int total = 0;
        int byContext[kContexts] = {0, 0};
    };
    static bool known(int context) { return context >= 0 && context < kContexts; }

    const int max_;
    int contextMax_[kContexts] = {0, 0};  // 0: none
    mutable std::mutex mu_;
    std::unordered_map<std::string, Open> open_;
    uint64_t refused_ = 0;
};

}  // namespace mat
