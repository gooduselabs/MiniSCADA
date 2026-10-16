// Connections at once per source address (feature 011 T048; FR-025, SC-008; research R10;
// contracts/device-api-011.md §6 `maxConnPerSource`). One limiter is shared by the HTTP and the
// HTTPS context, so the HTTP, HTTPS and WebSocket connections of one IP count together (a WebSocket
// is an upgraded HTTP connection: it is the same socket).
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

// The share of the HTTPS workers one source may hold at most (FR-025): 60 %.
constexpr int kMaxSourceSharePercent = 60;

// maxConnPerSource as it applies: the configured value, lowered when it would let one source hold
// more than 60 % of the httpsThreads workers (24 of the default 40), at least 1.
int effectiveMaxConnPerSource(int configured, int httpsThreads);

// "a.b.c.d" for IPv4 and IPv4-mapped IPv6 (the same source on either listener), the textual IPv6
// address otherwise, "" for anything else.
std::string sourceAddress(const sockaddr* peer);

class ConnLimiter {
   public:
    explicit ConnLimiter(int maxPerSource);
    ConnLimiter(const ConnLimiter&) = delete;
    ConnLimiter& operator=(const ConnLimiter&) = delete;

    // A new connection from `ip`: true and counted, or false (over the limit; not counted).
    bool acquire(const std::string& ip);
    // The connection of `ip` ended. A release without an acquire is ignored.
    void release(const std::string& ip);

    int maxPerSource() const { return max_; }
    int count(const std::string& ip) const;  // connections of `ip` now
    size_t sources() const;                  // addresses with at least one connection
    uint64_t refused() const;                // connections closed at once since start

   private:
    const int max_;
    mutable std::mutex mu_;
    std::unordered_map<std::string, int> open_;
    uint64_t refused_ = 0;
};

}  // namespace mat
