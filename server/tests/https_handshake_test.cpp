// T036 (feature 005, research R4): CivetWeb HTTPS on Mbed TLS 3.6.7 (civetweb_runtime) in process
// on 127.0.0.1, against the libcurl + OpenSSL 1.1.1f of the toolchain image.
//  - mAT patch 3 (third_party/civetweb/mod_mbedtls.inl): the handshake waits in poll() and ends
//    after request_timeout_ms. Upstream retried without waiting: a silent client kept a worker at
//    100 % CPU (T007: 1498 ms CPU in 1500 ms) and mg_stop() waited for it.
//  - mAT patch 4: a client closing properly (close_notify, or TCP close) is a clean end of stream,
//    not an "SSL read failed" line; a failed mbedtls_ssl_setup refuses the connection.
//  - The TLS policy of third_party/mbedtls-config/mat_mbedtls_config.h, from the T007 spike.
// The test never calls psa_crypto_init(): TLS 1.3 must start PSA Crypto by itself (Mbed TLS #9072).
// CPU is the process's own CPU time (getrusage), so other load on the machine does not count.
#include <gtest/gtest.h>
#include <mbedtls/ssl.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "server/tests/civet_test_support.hpp"
#include "server/tests/tls_test_support.hpp"

using namespace mat::test;
using Clock = std::chrono::steady_clock;

// Allocation failure for FailedSslSetupRefusesTheConnection. CMakeLists.txt links this test with
// -Wl,--wrap=calloc: calloc calls of the statically linked code (Mbed TLS, CivetWeb, this file)
// come here. An armed failure makes the next TLS record buffer allocation (mbedtls_ssl_setup) fail.
namespace {
std::atomic<int> g_tlsBufferFailuresArmed{0};
std::atomic<int> g_tlsBufferFailures{0};
}  // namespace

extern "C" void* __real_calloc(size_t n, size_t size);
extern "C" void* __wrap_calloc(size_t n, size_t size) {
    // Record buffers: 16 KiB of content plus header and overhead (MBEDTLS_SSL_IN_BUFFER_LEN).
    if (n == 1 && size >= MBEDTLS_SSL_IN_CONTENT_LEN && size <= MBEDTLS_SSL_IN_CONTENT_LEN + 1024) {
        int armed = g_tlsBufferFailuresArmed.load();
        while (armed > 0) {
            if (g_tlsBufferFailuresArmed.compare_exchange_weak(armed, armed - 1)) {
                ++g_tlsBufferFailures;
                return nullptr;
            }
        }
    }
    return __real_calloc(n, size);
}

namespace {

double secondsSince(Clock::time_point t) {
    return std::chrono::duration<double>(Clock::now() - t).count();
}

struct CpuWindow {
    double cpuMs = 0;
    double wallMs = 0;
    double percent() const { return wallMs > 0 ? 100.0 * cpuMs / wallMs : 0; }
};

// CPU the process uses while the calling thread sleeps `ms`.
CpuWindow measureCpu(int ms) {
    const double cpu0 = processCpuMs();
    const Clock::time_point t0 = Clock::now();
    std::this_thread::sleep_for(std::chrono::milliseconds(ms));
    CpuWindow w;
    w.cpuMs = processCpuMs() - cpu0;
    w.wallMs = std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
    return w;
}

// Seconds from opened[i] until the server closed fds[i] (EOF or reset); -1 if still open after
// `timeoutMs`. Data the server sends is read and ignored.
std::vector<double> waitServerClose(const std::vector<int>& fds,
                                    const std::vector<Clock::time_point>& opened, int timeoutMs) {
    std::vector<double> closedAfter(fds.size(), -1.0);
    const Clock::time_point end = Clock::now() + std::chrono::milliseconds(timeoutMs);
    size_t open = fds.size();
    while (open > 0) {
        const auto left =
            std::chrono::duration_cast<std::chrono::milliseconds>(end - Clock::now()).count();
        if (left <= 0) break;
        std::vector<pollfd> p;
        std::vector<size_t> index;
        for (size_t i = 0; i < fds.size(); ++i)
            if (closedAfter[i] < 0) {
                p.push_back({fds[i], POLLIN, 0});
                index.push_back(i);
            }
        if (::poll(p.data(), p.size(), static_cast<int>(left)) <= 0) continue;
        for (size_t k = 0; k < p.size(); ++k) {
            if (p[k].revents == 0) continue;
            char buf[512];
            if (::recv(p[k].fd, buf, sizeof buf, 0) <= 0) {
                closedAfter[index[k]] = secondsSince(opened[index[k]]);
                --open;
            }
        }
    }
    return closedAfter;
}

std::string describe(const std::vector<double>& seconds) {
    std::string s;
    char buf[32];
    for (double v : seconds) {
        std::snprintf(buf, sizeof buf, "%s%.2f", s.empty() ? "" : " ", v);
        s += buf;
    }
    return s;
}

std::string lines(const std::vector<std::string>& v) {
    std::string s;
    for (const auto& l : v) s += l + "\n";
    return s;
}

}  // namespace

// mAT patch 3 (R4): 8 clients open TCP to the HTTPS port and never send a ClientHello.
TEST(HttpsHandshake, SilentClientsCostNoCpuAndAreClosedAfterRequestTimeout) {
    // The runtime's HTTPS context: request_timeout_ms 10000. Spare workers for the normal client.
    TlsTestServer s({"num_threads", "12", "request_timeout_ms", "10000"});
    ASSERT_NE(s.port, 0) << "HTTPS context did not start";
    const CpuWindow idle = measureCpu(1000);

    std::vector<int> fds;
    std::vector<Clock::time_point> opened;
    for (int i = 0; i < 8; ++i) {
        const int fd = connectLocal(s.port);
        ASSERT_GE(fd, 0);
        fds.push_back(fd);
        opened.push_back(Clock::now());
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(300));  // the workers take them
    const CpuWindow silent = measureCpu(5000);
    std::printf(
        "[https-handshake] CPU idle: %.1f ms in %.0f ms (%.2f %%); 8 silent clients: %.1f ms "
        "in %.0f ms (%.2f %%)\n",
        idle.cpuMs, idle.wallMs, idle.percent(), silent.cpuMs, silent.wallMs, silent.percent());
    RecordProperty("idle_cpu_ms", static_cast<int>(idle.cpuMs));
    RecordProperty("silent_cpu_ms", static_cast<int>(silent.cpuMs));
    EXPECT_LE(silent.percent(), 2.0) << silent.cpuMs << " ms CPU in " << silent.wallMs << " ms";

    // A normal client still gets through meanwhile.
    const HttpResult ok = httpsGet(s.port, "/tls");
    EXPECT_TRUE(ok.ok()) << ok.error;
    EXPECT_EQ(ok.body, "ok-tls");

    // Each silent connection is closed after request_timeout_ms (10 s), at the latest after 11 s.
    const std::vector<double> closedAfter = waitServerClose(fds, opened, 13000);
    std::printf("[https-handshake] silent clients closed after (s): %s\n",
                describe(closedAfter).c_str());
    for (size_t i = 0; i < closedAfter.size(); ++i) {
        EXPECT_GE(closedAfter[i], 9.0) << "connection " << i << " (-1: still open after 13 s)";
        EXPECT_LE(closedAfter[i], 11.0) << "connection " << i;
    }
    for (int fd : fds) ::close(fd);
}

// mAT patch 3: the limit covers the whole handshake, not each wait. A client trickling one byte of
// a ClientHello record every 200 ms is closed at request_timeout_ms all the same.
TEST(HttpsHandshake, TricklingClientIsClosedAtTheDeadline) {
    TlsTestServer s({"request_timeout_ms", "3000"});
    ASSERT_NE(s.port, 0);
    const int fd = connectLocal(s.port);
    ASSERT_GE(fd, 0);
    const Clock::time_point opened = Clock::now();
    // Record header: handshake, TLS 1.0 record version, 512 bytes of body that never all come.
    ASSERT_TRUE(sendAll(fd, std::string("\x16\x03\x01\x02\x00", 5)));
    double closedAfter = -1;
    while (closedAfter < 0 && secondsSince(opened) < 6.0) {
        pollfd p{fd, POLLIN, 0};
        if (::poll(&p, 1, 200) > 0) {
            char buf[512];
            if (::recv(fd, buf, sizeof buf, 0) <= 0) closedAfter = secondsSince(opened);
        } else {
            sendAll(fd, std::string(1, '\0'));
        }
    }
    ::close(fd);
    std::printf("[https-handshake] trickling client closed after %.2f s (-1: still open)\n",
                closedAfter);
    EXPECT_GE(closedAfter, 2.5) << "-1: still open after 6 s";
    EXPECT_LE(closedAfter, 4.0);
}

// mAT patch 3: mg_stop() does not wait for a client that stays silent in the handshake (upstream it
// waited until the client went away; the watchdog closes the client after 8 s).
TEST(HttpsHandshake, StopDoesNotWaitForASilentClient) {
    TlsTestServer s;
    ASSERT_NE(s.port, 0);
    const int fd = connectLocal(s.port);
    ASSERT_GE(fd, 0);
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    std::mutex m;
    std::condition_variable cv;
    bool stopped = false;
    std::thread watchdog([&] {
        std::unique_lock<std::mutex> lock(m);
        if (!cv.wait_for(lock, std::chrono::seconds(8), [&] { return stopped; }))
            ::shutdown(fd, SHUT_RDWR);
    });
    const Clock::time_point t0 = Clock::now();
    s.stop();
    const double stopS = secondsSince(t0);
    {
        std::lock_guard<std::mutex> lock(m);
        stopped = true;
    }
    cv.notify_all();
    watchdog.join();
    ::close(fd);
    std::printf("[https-handshake] mg_stop with a silent client: %.2f s\n", stopS);
    EXPECT_LE(stopS, 5.0);
}

// mAT patch 4: a client that closes properly is a clean end of stream. Upstream printed
// "SSL read failed, error -30848" (close_notify) or "error 0" (TCP close) for each connection.
TEST(HttpsHandshake, ClosingClientsAreNotLoggedAsErrors) {
    TlsTestServer s({"enable_keep_alive", "yes"});
    ASSERT_NE(s.port, 0);
    StderrCapture err;
    {
        CurlClient c(httpsUrl(s.port), {TlsVersion::Tls13});
        EXPECT_TRUE(c.handshake().ok());  // then close_notify, no request
    }
    {
        CurlClient c(httpsUrl(s.port), {TlsVersion::Tls12});
        EXPECT_TRUE(c.handshake().ok());
    }
    {
        CurlClient c(httpsUrl(s.port));
        HttpRequest get;
        get.path = "/tls";
        EXPECT_EQ(c.request(get).status, 200);  // keep-alive: the server waits for the next one
    }
    {
        CurlClient c(httpsUrl(s.port));
        EXPECT_TRUE(c.handshake().ok());
        ::shutdown(c.socket(), SHUT_RDWR);  // TCP close without close_notify
    }
    const bool closed = waitFor([&] { return s.closedConnections() >= 4; }, 5000);
    const std::string text = err.finish();
    EXPECT_TRUE(closed) << s.closedConnections() << " of 4 connections closed";
    EXPECT_EQ(text.find("SSL read failed"), std::string::npos) << text;
    EXPECT_TRUE(s.errorLog().empty()) << lines(s.errorLog());
}

// mAT patch 4: when mbedtls_ssl_setup fails (out of memory), the connection is refused at once and
// the error is printed; the only worker then serves the next client. Upstream ignored the result
// and started the handshake on the broken context (Mbed TLS 3.6 stops it with BAD_INPUT_DATA).
TEST(HttpsHandshake, FailedSslSetupRefusesTheConnection) {
    TlsTestServer s({"num_threads", "1"});
    ASSERT_NE(s.port, 0);
    StderrCapture err;
    g_tlsBufferFailures = 0;
    g_tlsBufferFailuresArmed = 1;
    const int fd = connectLocal(s.port);
    ASSERT_GE(fd, 0);
    const std::vector<double> closedAfter = waitServerClose({fd}, {Clock::now()}, 3000);
    ::close(fd);
    const std::string text = err.finish();
    g_tlsBufferFailuresArmed = 0;
    EXPECT_EQ(g_tlsBufferFailures.load(), 1) << "no TLS buffer allocation failed";
    EXPECT_GE(closedAfter[0], 0.0) << "the connection is still open after 3 s";
    EXPECT_LE(closedAfter[0], 1.0);
    // -32512: MBEDTLS_ERR_SSL_ALLOC_FAILED
    EXPECT_NE(text.find("SSL setup failed, error -32512"), std::string::npos) << text;
    const HttpResult ok = httpsGet(s.port, "/tls");
    EXPECT_TRUE(ok.ok()) << ok.error;
    EXPECT_EQ(ok.body, "ok-tls");
}

// TLS policy (mat_mbedtls_config.h, T007): TLS 1.2 in the server's order, ChaCha20-Poly1305 first
// (no AES instructions on the Cortex-A7); TLS 1.3 in the client's order.
TEST(HttpsTlsPolicy, Tls12PicksChaCha20AndTls13Works) {
    TlsTestServer s;
    ASSERT_NE(s.port, 0);
    const HttpResult t12 = httpsGet(s.port, "/tls", {TlsVersion::Tls12});
    EXPECT_TRUE(t12.ok()) << t12.error;
    EXPECT_NE(t12.info.find("SSL connection using TLSv1.2 / ECDHE-ECDSA-CHACHA20-POLY1305"),
              std::string::npos)
        << t12.info;
    EXPECT_EQ(t12.body, "ok-tls");

    const HttpResult t13 = httpsGet(s.port, "/tls", {TlsVersion::Tls13});
    EXPECT_TRUE(t13.ok()) << t13.error;
    EXPECT_NE(t13.info.find("SSL connection using TLSv1.3 / TLS_"), std::string::npos) << t13.info;
    EXPECT_EQ(t13.body, "ok-tls");
}

// No CBC suite and no RSA key exchange; after refusing, the server still serves.
TEST(HttpsTlsPolicy, CbcAndRsaKeyExchangeAreRefused) {
    TlsTestServer s;
    ASSERT_NE(s.port, 0);
    EXPECT_FALSE(httpsGet(s.port, "/tls", {TlsVersion::Tls12, "ECDHE-ECDSA-AES128-SHA256"}).ok());
    EXPECT_FALSE(httpsGet(s.port, "/tls", {TlsVersion::Tls12, "AES128-GCM-SHA256"}).ok());
    EXPECT_TRUE(httpsGet(s.port, "/tls", {TlsVersion::Tls12}).ok());
}

// Key exchange groups: X25519 and P-256 only, on TLS 1.3 and TLS 1.2. libcurl 7.68 cannot choose
// groups (CURLOPT_SSL_EC_CURVES came in 7.73), so this check uses the image's openssl s_client.
TEST(HttpsTlsPolicy, KeyExchangeGroupsAreX25519AndP256) {
    if (!haveTool("openssl")) GTEST_SKIP() << "openssl is not installed (toolchain image, T008)";
    TlsTestServer s;
    ASSERT_NE(s.port, 0);
    const auto sClient = [&](const std::string& opts) {
        return runCommand("timeout 10 openssl s_client -brief -connect 127.0.0.1:" +
                          std::to_string(s.port) + " " + opts + " </dev/null");
    };
    const auto has = [](const CommandResult& r, const char* text) {
        return r.out.find(text) != std::string::npos;
    };
    const CommandResult x = sClient("-tls1_3");
    EXPECT_TRUE(has(x, "Server Temp Key: X25519")) << x.out;
    const CommandResult p = sClient("-tls1_3 -groups P-256");
    EXPECT_TRUE(has(p, "Server Temp Key: ECDH, P-256")) << p.out;
    const CommandResult p12 = sClient("-tls1_2 -groups P-256");
    EXPECT_TRUE(has(p12, "Protocol version: TLSv1.2")) << p12.out;
    EXPECT_TRUE(has(p12, "Server Temp Key: ECDH, P-256")) << p12.out;
    const CommandResult p384 = sClient("-tls1_3 -groups P-384");
    EXPECT_FALSE(has(p384, "CONNECTION ESTABLISHED")) << p384.out;
}

// 40 clients at once on a context with 4 workers, TLS 1.3 then TLS 1.2: every one is served.
TEST(HttpsTlsPolicy, FortyConcurrentClientsOnFourWorkers) {
    TlsTestServer s({"num_threads", "4"});
    ASSERT_NE(s.port, 0);
    for (const TlsVersion v : {TlsVersion::Tls13, TlsVersion::Tls12}) {
        std::atomic<int> served{0};
        std::vector<std::thread> clients;
        for (int i = 0; i < 40; ++i)
            clients.emplace_back([&] {
                const HttpResult r = httpsGet(s.port, "/tls", {v});
                if (r.ok() && r.body == "ok-tls") ++served;
            });
        for (auto& t : clients) t.join();
        EXPECT_EQ(served.load(), 40) << (v == TlsVersion::Tls13 ? "TLS 1.3" : "TLS 1.2");
    }
}
