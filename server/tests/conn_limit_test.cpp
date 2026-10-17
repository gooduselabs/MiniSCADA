// Connections at once per source IP (specs/011 T039; FR-025, SC-008; research R10): HTTP, HTTPS
// and WebSocket count together; a connection over the limit is closed at once, before it waits for
// a worker or a TLS handshake; 40 silent TLS connections from one IP do not slow a request from
// another IP beyond 2 s; one source holds at most 60 % of the HTTPS workers with the defaults; the
// place is given back when a connection ends, a failed handshake included.
//
// The two contexts are opened by WebContexts as main opens them. Sources: 127.0.0.1 and 127.0.0.2
// (both loopback on Linux).
#include "server/http/conn_limit.hpp"

#include <arpa/inet.h>
#include <gtest/gtest.h>
#include <netinet/in.h>
#include <poll.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <unistd.h>

#include <chrono>
#include <cstring>
#include <functional>
#include <string>
#include <thread>
#include <vector>

#include "civetweb.h"
#include "server/config.hpp"
#include "server/http/web_contexts.hpp"
#include "server/tests/tls_test_support.hpp"
#include "server/tls/server_cert.hpp"

using namespace mat;

namespace {

using Clock = std::chrono::steady_clock;

int64_t msSince(Clock::time_point t0) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - t0).count();
}

// 8 s: the places come back once the server has processed the connection (a failed TLS handshake
// included); under a loaded ctest -j3 that took more than 3 s once (2026-10-17).
bool waitFor(const std::function<bool()>& cond, int ms = 8000) {
    const auto t0 = Clock::now();
    while (msSince(t0) < ms) {
        if (cond()) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    return cond();
}

// A TCP connection from `from` to 127.0.0.1:port; -1 when connect fails.
int connectFrom(const char* from, int port) {
    const int fd = ::socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
    sockaddr_in src{};
    src.sin_family = AF_INET;
    ::inet_pton(AF_INET, from, &src.sin_addr);
    if (::bind(fd, reinterpret_cast<sockaddr*>(&src), sizeof src) != 0) {
        ::close(fd);
        return -1;
    }
    sockaddr_in dst{};
    dst.sin_family = AF_INET;
    dst.sin_port = htons(static_cast<uint16_t>(port));
    ::inet_pton(AF_INET, "127.0.0.1", &dst.sin_addr);
    if (::connect(fd, reinterpret_cast<sockaddr*>(&dst), sizeof dst) != 0) {
        ::close(fd);
        return -1;
    }
    return fd;
}

// true when the server closed the connection within `ms` (EOF or reset).
bool closedByServer(int fd, int ms) {
    pollfd p{fd, POLLIN, 0};
    if (::poll(&p, 1, ms) <= 0) return false;
    char b[64];
    return ::recv(fd, b, sizeof b, 0) <= 0;
}

std::string roundTrip(int fd, const std::string& request, int ms = 3000) {
    ::send(fd, request.data(), request.size(), MSG_NOSIGNAL);
    std::string out;
    const auto t0 = Clock::now();
    while (msSince(t0) < ms) {
        pollfd p{fd, POLLIN, 0};
        if (::poll(&p, 1, 50) <= 0) {
            if (out.find("\r\n\r\n") != std::string::npos) break;
            continue;
        }
        char b[512];
        const ssize_t n = ::recv(fd, b, sizeof b, 0);
        if (n <= 0) break;
        out.append(b, static_cast<size_t>(n));
    }
    return out;
}

int onPing(mg_connection* c, void*) {
    mg_printf(c,
              "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 4\r\n\r\n"
              "pong");
    return 200;
}
int wsConnect(const mg_connection*, void*) { return 0; }
void wsReady(mg_connection*, void*) {}
int wsData(mg_connection*, int, char*, size_t, void*) { return 1; }
void wsClose(const mg_connection*, void*) {}

struct Server {
    explicit Server(int maxPerSource, int httpsThreads = 40, bool limited = true)
        : limiter(maxPerSource) {
        char tmpl[] = "/tmp/mat-connlimit-XXXXXX";
        dir = ::mkdtemp(tmpl);
        cert = loadOrCreateServerCert({dir, "BL335-thử", "mat-test"});
        EXPECT_TRUE(cert.ok) << cert.error;
        WebOptions o;
        o.httpListen = "127.0.0.1:0";
        o.httpThreads = 16;
        o.httpsListen = "127.0.0.1:0s";
        o.httpsThreads = httpsThreads;
        if (limited) o.connLimiter = &limiter;
        std::string err;
        EXPECT_TRUE(web.startHttp(o, err)) << err;
        EXPECT_EQ(web.startHttps(o, cert, err), HttpsState::Ok) << err;
        for (mg_context* c : {web.http(), web.https()}) {
            mg_set_request_handler(c, "/ping$", onPing, nullptr);
            mg_set_websocket_handler(c, "/ws$", wsConnect, wsReady, wsData, wsClose, nullptr);
        }
    }
    ~Server() {
        for (int fd : fds) ::close(fd);
        web.stop();
        std::string cmd = "rm -rf '" + dir + "'";
        (void)std::system(cmd.c_str());
    }
    int keep(int fd) {
        if (fd >= 0) fds.push_back(fd);
        return fd;
    }
    void closeAll() {
        for (int fd : fds) ::close(fd);
        fds.clear();
    }

    ConnLimiter limiter;
    std::string dir;
    ServerCert cert;
    WebContexts web;
    std::vector<int> fds;
};

}  // namespace

TEST(ConnLimiter, CountsPerSourceRefusesOverTheLimitAndGivesThePlaceBack) {
    ConnLimiter l(3);
    for (int i = 0; i < 3; ++i) EXPECT_TRUE(l.acquire("10.0.0.5"));
    EXPECT_FALSE(l.acquire("10.0.0.5"));
    EXPECT_TRUE(l.acquire("10.0.0.6")) << "another source has its own count";
    EXPECT_EQ(l.count("10.0.0.5"), 3);
    EXPECT_EQ(l.refused(), 1u);
    l.release("10.0.0.5");
    EXPECT_TRUE(l.acquire("10.0.0.5"));
    for (int i = 0; i < 3; ++i) l.release("10.0.0.5");
    l.release("10.0.0.5");  // one too many: ignored, never negative
    EXPECT_EQ(l.count("10.0.0.5"), 0);
    l.release("10.0.0.6");
    EXPECT_EQ(l.sources(), 0u);
}

TEST(ConnLimiter, AnIpv4MappedAddressIsTheSameSourceAsIpv4) {
    sockaddr_in v4{};
    v4.sin_family = AF_INET;
    ::inet_pton(AF_INET, "192.168.1.20", &v4.sin_addr);
    sockaddr_in6 v6{};
    v6.sin6_family = AF_INET6;
    ::inet_pton(AF_INET6, "::ffff:192.168.1.20", &v6.sin6_addr);
    sockaddr_in6 real6{};
    real6.sin6_family = AF_INET6;
    ::inet_pton(AF_INET6, "fe80::1", &real6.sin6_addr);
    EXPECT_EQ(sourceAddress(reinterpret_cast<sockaddr*>(&v4)), "192.168.1.20");
    EXPECT_EQ(sourceAddress(reinterpret_cast<sockaddr*>(&v6)), "192.168.1.20");
    EXPECT_EQ(sourceAddress(reinterpret_cast<sockaddr*>(&real6)), "fe80::1");
    EXPECT_EQ(sourceAddress(nullptr), "");
}

// FR-025: one source never holds more than 75 % of the HTTPS workers. 2026-10-17: 10 pages behind
// one address (NAT, VPN) pressing F5 together held 41 connections, so the defaults are 48 of 64
// (they were 24 of 40, 60 %); 16 workers stay for the other sources.
TEST(ConnLimiter, OneSourceHoldsAtMostThreeQuartersOfTheHttpsWorkers) {
    const RuntimeConfig defaults;
    EXPECT_EQ(defaults.maxConnPerSource, 48);
    EXPECT_EQ(defaults.httpsThreads, 64);
    const int eff = effectiveMaxConnPerSource(defaults.maxConnPerSource, defaults.httpsThreads);
    EXPECT_EQ(eff, 48) << "the defaults keep to 75 %: 48 / 64";
    EXPECT_GE(defaults.httpsThreads - eff, 16) << "workers left for the other sources";
    EXPECT_LE(eff * 100, kMaxSourceSharePercent * defaults.httpsThreads);
    EXPECT_EQ(effectiveMaxConnPerSource(64, 64), 48);
    EXPECT_EQ(effectiveMaxConnPerSource(24, 20), 15);
    EXPECT_EQ(effectiveMaxConnPerSource(4, 64), 4);
    EXPECT_EQ(effectiveMaxConnPerSource(24, 1), 1);
    for (int threads = 4; threads <= 64; ++threads)
        for (int max = 4; max <= 64; ++max)
            EXPECT_LE(effectiveMaxConnPerSource(max, threads) * 100,
                      std::max(100, kMaxSourceSharePercent * threads))
                << max << "/" << threads;
}

TEST(ConnLimit, HttpHttpsAndWebSocketCountTogetherAndTheNextOneIsClosedAtOnce) {
    Server s(4);
    const int http = s.web.httpPort(), https = s.web.httpsPort();
    // a WebSocket on HTTP
    const int ws = s.keep(connectFrom("127.0.0.1", http));
    ASSERT_GE(ws, 0);
    const std::string up = roundTrip(
        ws,
        "GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
    ASSERT_NE(up.find("101"), std::string::npos) << up;
    // an HTTP connection that sends nothing yet, two TLS connections that never shake hands
    ASSERT_GE(s.keep(connectFrom("127.0.0.1", http)), 0);
    ASSERT_GE(s.keep(connectFrom("127.0.0.1", https)), 0);
    ASSERT_GE(s.keep(connectFrom("127.0.0.1", https)), 0);
    ASSERT_TRUE(waitFor([&] { return s.limiter.count("127.0.0.1") == 4; }))
        << s.limiter.count("127.0.0.1");
    // the fifth, on either listener, is closed at once
    for (int port : {https, http}) {
        const int fd = connectFrom("127.0.0.1", port);
        ASSERT_GE(fd, 0);
        const auto t0 = Clock::now();
        EXPECT_TRUE(closedByServer(fd, 1000)) << port;
        EXPECT_LE(msSince(t0), 500) << port;
        ::close(fd);
    }
    EXPECT_EQ(s.limiter.refused(), 2u);
    // another source is not affected
    const int other = connectFrom("127.0.0.2", http);
    ASSERT_GE(other, 0);
    EXPECT_NE(roundTrip(other, "GET /ping HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").find("pong"),
              std::string::npos);
    ::close(other);
}

// SC-008: TLS connections that stay silent from one IP; a request from another IP is answered
// within 2 s (without the limit the handshakes hold every worker for 10 s). 2026-10-17: 60 of them
// against the defaults of 1.0 (48 per source, 64 workers), it was 40 against 24/40.
TEST(ConnLimit, SixtySilentTlsConnectionsFromOneSourceDoNotSlowAnotherSource) {
    const RuntimeConfig defaults;
    Server s(effectiveMaxConnPerSource(defaults.maxConnPerSource, defaults.httpsThreads),
             defaults.httpsThreads);
    for (int i = 0; i < 60; ++i) s.keep(connectFrom("127.0.0.1", s.web.httpsPort()));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    EXPECT_LE(s.limiter.count("127.0.0.1"), 48);
    test::ClientOptions o;
    o.localAddress = "127.0.0.2";
    o.timeoutMs = 15000;
    const auto t0 = Clock::now();
    const test::HttpResult r = test::httpsGet(s.web.httpsPort(), "/ping", o);
    const int64_t took = msSince(t0);
    std::printf("[conn-limit] request from another source with 60 silent TLS: %lld ms\n",
                static_cast<long long>(took));
    RecordProperty("other_source_ms", static_cast<int>(took));
    EXPECT_TRUE(r.ok()) << r.error;
    EXPECT_EQ(r.body, "pong");
    EXPECT_LE(took, 2000);
    EXPECT_GE(s.limiter.refused(), 12u);
}

TEST(ConnLimit, ThePlaceIsGivenBackWhenAConnectionEndsAFailedHandshakeIncluded) {
    Server s(4);
    const int https = s.web.httpsPort(), http = s.web.httpPort();
    // four handshakes that fail: no ClientHello, garbage
    for (int i = 0; i < 4; ++i) {
        const int fd = s.keep(connectFrom("127.0.0.1", https));
        ASSERT_GE(fd, 0);
        const char junk[] = "GET / HTTP/1.1\r\n\r\n";
        ::send(fd, junk, sizeof junk - 1, MSG_NOSIGNAL);
    }
    // The server must have taken them first: a count of 0 seen before its master thread accepted
    // them let the next requests race with these four (an HTTP request refused, 2026-10-17).
    for (int fd : s.fds) EXPECT_TRUE(closedByServer(fd, 8000)) << "the handshake failed";
    EXPECT_TRUE(waitFor([&] { return s.limiter.count("127.0.0.1") == 0; }))
        << "a failed handshake leaks no place: " << s.limiter.count("127.0.0.1");
    s.closeAll();
    // requests that end, over HTTP and HTTPS
    for (int i = 0; i < 6; ++i) {
        const int fd = connectFrom("127.0.0.1", http);
        ASSERT_GE(fd, 0);
        EXPECT_NE(roundTrip(fd, "GET /ping HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
                      .find("pong"),
                  std::string::npos)
            << i;
        ::close(fd);
        const test::HttpResult r = test::httpsGet(https, "/ping");
        EXPECT_EQ(r.body, "pong") << i << " " << r.error;
        EXPECT_TRUE(waitFor([&] { return s.limiter.count("127.0.0.1") == 0; }))
            << i << ": " << s.limiter.count("127.0.0.1");
    }
    EXPECT_TRUE(waitFor([&] { return s.limiter.count("127.0.0.1") == 0; }))
        << s.limiter.count("127.0.0.1");
    // the full share is free again
    for (int i = 0; i < 4; ++i) ASSERT_GE(s.keep(connectFrom("127.0.0.1", https)), 0);
    EXPECT_TRUE(waitFor([&] { return s.limiter.count("127.0.0.1") == 4; }));
    s.closeAll();
    EXPECT_TRUE(waitFor([&] { return s.limiter.count("127.0.0.1") == 0; }, 12000))
        << "closed by the client: given back";
    EXPECT_EQ(s.limiter.refused(), 0u);
}

// Security review of 011 (M1, T062): the limiter is shared by both contexts, but each context has
// its own pool of workers. One source holds at most min(maxConnPerSource, 75 % of the workers) of
// EACH context: with the defaults 18 of the 24 HTTP workers (it could hold all 24 before), and
// still at most maxConnPerSource over both contexts together.
TEST(ConnLimiter, EachContextHasItsOwnShareUnderTheSharedLimit) {
    ConnLimiter l(10);
    l.setContextLimit(kHttpContext, 3);
    for (int i = 0; i < 3; ++i) EXPECT_TRUE(l.acquire("10.0.0.5", kHttpContext)) << i;
    EXPECT_FALSE(l.acquire("10.0.0.5", kHttpContext)) << "the share of the HTTP workers";
    EXPECT_EQ(l.count("10.0.0.5", kHttpContext), 3);
    EXPECT_TRUE(l.acquire("10.0.0.6", kHttpContext)) << "another source has its own share";
    for (int i = 0; i < 7; ++i) EXPECT_TRUE(l.acquire("10.0.0.5", kHttpsContext)) << i;
    EXPECT_FALSE(l.acquire("10.0.0.5", kHttpsContext)) << "10 over both contexts";
    EXPECT_EQ(l.count("10.0.0.5"), 10);
    EXPECT_EQ(l.refused(), 2u);
    l.release("10.0.0.5", kHttpContext);
    EXPECT_EQ(l.count("10.0.0.5", kHttpContext), 2);
    EXPECT_TRUE(l.acquire("10.0.0.5", kHttpContext));
    for (int i = 0; i < 3; ++i) l.release("10.0.0.5", kHttpContext);
    for (int i = 0; i < 7; ++i) l.release("10.0.0.5", kHttpsContext);
    l.release("10.0.0.5", kHttpsContext);  // one too many: ignored
    l.release("10.0.0.6", kHttpContext);
    EXPECT_EQ(l.count("10.0.0.5"), 0);
    EXPECT_EQ(l.sources(), 0u);
}

TEST(ConnLimiter, TheDefaultsLeaveAQuarterOfTheHttpWorkersToTheOthers) {
    const RuntimeConfig defaults;
    EXPECT_EQ(defaults.threads, 24);
    const int shared = effectiveMaxConnPerSource(defaults.maxConnPerSource, defaults.httpsThreads);
    EXPECT_EQ(effectiveMaxConnPerSource(shared, defaults.threads), 18);
}

// M1: 20 HTTP connections that stay silent from one source, 16 HTTP workers: the source gets 12
// (75 %), and a request from another source over HTTP is answered within 2 s (it waited for the
// 10 s request timeout of a worker before).
TEST(ConnLimit, SilentHttpConnectionsFromOneSourceDoNotTakeEveryHttpWorker) {
    Server s(48, 64);  // httpThreads 16
    for (int i = 0; i < 20; ++i) s.keep(connectFrom("127.0.0.1", s.web.httpPort()));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    EXPECT_LE(s.limiter.count("127.0.0.1", kHttpContext), 12);
    const int other = connectFrom("127.0.0.2", s.web.httpPort());
    ASSERT_GE(other, 0);
    const auto t0 = Clock::now();
    const std::string r = roundTrip(
        other, "GET /ping HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n", 5000);
    const int64_t took = msSince(t0);
    ::close(other);
    EXPECT_NE(r.find("pong"), std::string::npos) << r;
    EXPECT_LE(took, 2000);
    EXPECT_GE(s.limiter.refused(), 8u);
}
