// Small responses on a kept-alive HTTPS connection (feature 013 T032 follow-up,
// docs/reports/013-perf.md §6): the handlers of the runtime write the header and the body with two
// calls (two TLS records, two send()). Without TCP_NODELAY the second segment waits for the ACK of
// the first, and the client delays that ACK (~40 ms on Linux): every API call of the page took
// ~44 ms on x64 where HTTP took 0.8 ms. The contexts are opened by WebContexts as main opens them.
#include <gtest/gtest.h>
#include <stdlib.h>

#include <algorithm>
#include <chrono>
#include <string>
#include <vector>

#include "civetweb.h"
#include "server/http/web_contexts.hpp"
#include "server/tests/tls_test_support.hpp"
#include "server/tls/server_cert.hpp"

using namespace mat;
using namespace mat::test;

namespace {

// Like the API handlers (sendJson): the header lines, then the body, in two writes.
int onInfo(mg_connection* c, void*) {
    static const std::string body = R"({"runtimeVersion":"test","protocolVersion":"1.4.0"})";
    mg_printf(c,
              "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %zu\r\n"
              "Cache-Control: no-store\r\n\r\n",
              body.size());
    mg_write(c, body.data(), body.size());
    return 200;
}

double medianMs(std::vector<double> v) {
    std::sort(v.begin(), v.end());
    return v[v.size() / 2];
}

}  // namespace

TEST(WebContextsLatency, KeptAliveHttpsCallsAreNotHeldByNagle) {
    char tmpl[] = "/tmp/mat-latency-XXXXXX";
    const std::string dir = ::mkdtemp(tmpl);
    const ServerCert cert = loadOrCreateServerCert({dir, "BL335-thử", "mat-test"});
    ASSERT_TRUE(cert.ok) << cert.error;
    WebContexts web;
    WebOptions o;
    o.httpListen = "127.0.0.1:0";
    o.httpThreads = 4;
    o.httpsListen = "127.0.0.1:0s";
    o.httpsThreads = 4;
    std::string err;
    ASSERT_TRUE(web.startHttp(o, err)) << err;
    ASSERT_EQ(web.startHttps(o, cert, err), HttpsState::Ok) << err;
    mg_set_request_handler(web.https(), "/info$", onInfo, nullptr);

    CurlClient client(httpsUrl(web.httpsPort()));
    HttpRequest req;
    req.path = "/info";
    ASSERT_TRUE(client.request(req).ok());  // handshake, connection kept
    const int fd = client.socket();
    std::vector<double> ms;
    for (int i = 0; i < 20; ++i) {
        const auto t0 = std::chrono::steady_clock::now();
        const HttpResult r = client.request(req);
        ms.push_back(
            std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0)
                .count());
        ASSERT_TRUE(r.ok()) << r.error;
        ASSERT_EQ(r.status, 200);
    }
    EXPECT_EQ(client.socket(), fd) << "the 20 calls must share one connection";
    const double median = medianMs(ms);
    RecordProperty("medianMs", std::to_string(median));
    EXPECT_LT(median, 15.0) << "median of 20 kept-alive HTTPS calls: " << median << " ms";
    client.close();
    web.stop();
    const std::string cmd = "rm -rf '" + dir + "'";
    (void)std::system(cmd.c_str());
}
