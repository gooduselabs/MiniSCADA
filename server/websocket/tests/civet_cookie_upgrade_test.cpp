// T056 (feature 007; contracts/device-api-1.2.md §7, web-session.md §5 cases A19, A20, ADR-021
// points 6 and 7, FR-043): the live WebSocket opened with the cookie of a web session.
//  - a handshake that carries our session cookie needs an Origin equal to https://<Host>: without
//    one, or with another, it is refused (403) before the handshake and before a slot is taken
//    (cross-site WebSocket hijacking);
//  - the right Origin: 101, the session counts in the limit of 10;
//  - viewerLogin = required: no cookie, 401 AUTH_REQUIRED before a slot; with a valid cookie from a
//    source outside the private networks: not filtered; when the session ends the connection closes
//    4401 at the next look (every recheckMs);
//  - the cookie is for HTTPS only: over plain HTTP it is no session.
#include <curl/curl.h>
#include <gtest/gtest.h>
#include <poll.h>

#include <chrono>
#include <memory>
#include <string>
#include <thread>

#include "core/tag-engine/tag_store.hpp"
#include "server/http/viewer_gate.hpp"
#include "server/tests/api_rig.hpp"
#include "server/websocket/civet_transport.hpp"
#include "server/websocket/live_hub.hpp"

using namespace mat;
using namespace mat::test;
using nlohmann::json;

namespace {

int64_t nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

// WebSocket over TLS with the headers the test chooses.
class Wss {
   public:
    ~Wss() {
        if (curl_) curl_easy_cleanup(curl_);
    }
    // The first line of the response ("HTTP/1.1 101 ..."), "" when nothing came.
    std::string connect(int port, const std::vector<std::string>& headers,
                        const std::string& host) {
        curl_ = curl_easy_init();
        if (!curl_) return "";
        const std::string url = httpsUrl(port) + "/";
        curl_easy_setopt(curl_, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl_, CURLOPT_CONNECT_ONLY, 1L);
        curl_easy_setopt(curl_, CURLOPT_SSL_VERIFYPEER, 0L);
        curl_easy_setopt(curl_, CURLOPT_SSL_VERIFYHOST, 0L);
        curl_easy_setopt(curl_, CURLOPT_NOSIGNAL, 1L);
        curl_easy_setopt(curl_, CURLOPT_PROXY, "");
        curl_easy_setopt(curl_, CURLOPT_TIMEOUT_MS, 5000L);
        if (curl_easy_perform(curl_) != CURLE_OK) return "";
        curl_socket_t s = CURL_SOCKET_BAD;
        curl_easy_getinfo(curl_, CURLINFO_ACTIVESOCKET, &s);
        sock_ = static_cast<int>(s);
        std::string req =
            "GET /api/v1/live HTTP/1.1\r\nHost: " + host +
            "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n";
        for (const auto& h : headers) req += h + "\r\n";
        req += "\r\n";
        if (!sendAll(req)) return "";
        head_.clear();
        char c;
        while (head_.find("\r\n\r\n") == std::string::npos) {
            const int n = recvSome(&c, 1, 3000);
            if (n != 1) break;
            head_ += c;
        }
        if (head_.compare(0, 12, "HTTP/1.1 101") != 0)  // a refusal: its short body too
            while (recvSome(&c, 1, 150) == 1) head_ += c;
        return head_.substr(0, head_.find("\r\n"));
    }
    const std::string& head() const { return head_; }

    // The next frame: opcode (1 text, 8 close), payload; opcode -1 on timeout, -2 on end.
    std::pair<int, std::string> read(int timeoutMs) {
        unsigned char h[2];
        const int got = readExact(reinterpret_cast<char*>(h), 2, timeoutMs);
        if (got == 0) return {-2, ""};
        if (got != 2) return {-1, ""};
        uint64_t len = h[1] & 0x7F;
        if (len >= 126) {
            unsigned char ext[8];
            const int n = len == 126 ? 2 : 8;
            if (readExact(reinterpret_cast<char*>(ext), n, timeoutMs) != n) return {-2, ""};
            len = 0;
            for (int i = 0; i < n; ++i) len = (len << 8) | ext[i];
        }
        std::string payload(static_cast<size_t>(len), '\0');
        if (len && readExact(&payload[0], static_cast<int>(len), timeoutMs) != int(len))
            return {-2, ""};
        return {h[0] & 0x0F, payload};
    }

   private:
    bool sendAll(const std::string& data) {
        size_t off = 0;
        while (off < data.size()) {
            size_t n = 0;
            const CURLcode rc = curl_easy_send(curl_, data.data() + off, data.size() - off, &n);
            if (rc == CURLE_AGAIN) {
                pollfd p{sock_, POLLOUT, 0};
                ::poll(&p, 1, 100);
            } else if (rc != CURLE_OK) {
                return false;
            }
            off += n;
        }
        return true;
    }
    int recvSome(char* buf, size_t n, int timeoutMs) {
        const auto end = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
        for (;;) {
            size_t got = 0;
            const CURLcode rc = curl_easy_recv(curl_, buf, n, &got);
            if (rc == CURLE_OK) return static_cast<int>(got);
            if (rc != CURLE_AGAIN) return -1;
            const auto left = std::chrono::duration_cast<std::chrono::milliseconds>(
                                  end - std::chrono::steady_clock::now())
                                  .count();
            if (left <= 0) return -1;
            pollfd p{sock_, POLLIN, 0};
            ::poll(&p, 1, static_cast<int>(std::min<int64_t>(left, 50)));
        }
    }
    int readExact(char* buf, int n, int timeoutMs) {
        int off = 0;
        while (off < n) {
            const int r = recvSome(buf + off, static_cast<size_t>(n - off), timeoutMs);
            if (r == 0) return 0;
            if (r < 0) return -1;
            off += r;
        }
        return n;
    }
    CURL* curl_ = nullptr;
    int sock_ = -1;
    std::string head_;
};

struct Rig : ApiRig {
    explicit Rig(bool viewerLogin, bool privateSource = true, int64_t recheckMs = 60000)
        : ApiRig() {
        store.set(store.add({"A", TagType::FLOAT64, ""}), 1.0, Quality::GOOD, 1, 1);
        ViewerGate::Hooks hooks;
        // the requests come from the loopback, which is never filtered: the gate sees another
        // source
        hooks.remoteIp = [privateSource](const std::string&) {
            return std::string(privateSource ? "192.168.1.77" : "203.0.113.9");
        };
        gate = std::make_unique<ViewerGate>(
            ViewerAccess::Private,
            [this](const std::string& token, const std::string&, int port) {
                ClientAddress from{"127.0.0.1", port};
                return auth->authorize(token, from, Role::Viewer, false).status == AccessStatus::Ok;
            },
            hooks);
        gate->setWebSessions(
            [this](const std::string& token, const std::string&, int port) {
                ClientAddress from{"127.0.0.1", port};
                return auth->authorizeWeb(token, from, Role::Viewer, false).status ==
                       AccessStatus::Ok;
            },
            viewerLogin);
        CivetLiveTransport::Options to;
        to.maxClients = 10;
        to.gate = gate.get();
        to.recheckMs = recheckMs;
        transport = std::make_unique<CivetLiveTransport>(to, nowMs);
        HubOptions ho;
        ho.serverVersion = "0.6.0";
        ho.maxClients = 10;
        hub = std::make_unique<LiveHub>(store, *transport, ho, nowMs);
        transport->attach(hub.get());
        for (mg_context* ctx : {web.http(), web.https()}) transport->install(ctx, "/api/v1/live");
        origin = "https://127.0.0.1:" + std::to_string(web.httpsPort());
        host = "127.0.0.1:" + std::to_string(web.httpsPort());
    }
    ~Rig() {
        web.stop();  // the close handlers run while the transport and the hub exist
    }

    // The cookie header of a new session of `user`.
    std::string cookieOf(const std::string& user, std::string* csrf = nullptr) {
        const HttpResult r = call(postReq("/api/v1/web/login",
                                          json{{"username", user}, {"password", pw[user]}}.dump(),
                                          {"Origin: " + origin}));
        EXPECT_EQ(r.status, 200) << r.body;
        if (csrf) *csrf = bodyJson(r).value("csrfToken", "");
        const std::string key = "__Host-mat_sid=";
        const size_t at = r.headers.find(key);
        const size_t end = r.headers.find(';', at);
        return "Cookie: " + r.headers.substr(at, end - at);
    }
    bool settled(size_t active) {
        for (int i = 0; i < 200; ++i) {
            if (transport->active() == active) return true;
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        return transport->active() == active;
    }

    TagStore store;
    std::unique_ptr<ViewerGate> gate;
    std::unique_ptr<CivetLiveTransport> transport;
    std::unique_ptr<LiveHub> hub;
    std::string origin, host;
};

}  // namespace

TEST(CookieUpgrade, WithoutAnOriginTheHandshakeIsRefusedBeforeASlot) {  // A19
    Rig r(false);
    const std::string cookie = r.cookieOf("vh1");
    Wss ws;
    const std::string line = ws.connect(r.web.httpsPort(), {cookie}, r.host);
    EXPECT_NE(line.find("403"), std::string::npos) << line;
    EXPECT_EQ(r.transport->active(), 0u);
    EXPECT_EQ(r.transport->originRejectedTotal(), 1u);
    EXPECT_EQ(r.transport->rejectedTotal(), 0u) << "refused before it asked for a slot";
}

TEST(CookieUpgrade, AnotherOriginIsRefused) {  // A20
    Rig r(false);
    const std::string cookie = r.cookieOf("vh1");
    for (const char* origin :
         {"https://evil.example", "null", "http://127.0.0.1", "https://127.0.0.1:1"}) {
        Wss ws;
        const std::string line =
            ws.connect(r.web.httpsPort(), {cookie, std::string("Origin: ") + origin}, r.host);
        EXPECT_NE(line.find("403"), std::string::npos) << origin << " " << line;
    }
    EXPECT_EQ(r.transport->active(), 0u);
}

TEST(CookieUpgrade, TheRightOriginIsAcceptedAndCountsInTheLimit) {
    Rig r(false);
    const std::string cookie = r.cookieOf("vh1");
    Wss ws;
    const std::string line = ws.connect(r.web.httpsPort(), {cookie, "Origin: " + r.origin}, r.host);
    EXPECT_NE(line.find("101"), std::string::npos) << line;
    const auto hello = ws.read(3000);
    EXPECT_EQ(hello.first, 1);
    EXPECT_EQ(json::parse(hello.second)["type"], "hello");
    EXPECT_TRUE(r.settled(1));
}

TEST(CookieUpgrade, ACookieOfAnotherNameIsNoCookieAndOnlyTheOldRulesApply) {
    Rig r(false);
    Wss ws;
    // no cookie of ours, no Origin: a native client as before
    const std::string line = ws.connect(r.web.httpsPort(), {"Cookie: other=1"}, r.host);
    EXPECT_NE(line.find("101"), std::string::npos) << line;
}

TEST(CookieUpgrade, ViewerLoginRequiredRefusesAConnectionWithoutASession) {
    Rig r(true, /*privateSource=*/true);
    Wss ws;
    const std::string line = ws.connect(r.web.httpsPort(), {}, r.host);
    EXPECT_NE(line.find("401"), std::string::npos) << line;
    EXPECT_NE(ws.head().find("AUTH_REQUIRED"), std::string::npos);
    // not even a body of data: nothing was subscribed and no slot taken
    EXPECT_EQ(r.transport->active(), 0u);
    EXPECT_EQ(r.transport->rejectedTotal(), 0u);
}

TEST(CookieUpgrade, ViewerLoginRequiredLetsASignedInPageIn) {
    Rig r(true, true);
    const std::string cookie = r.cookieOf("xem1");
    Wss ws;
    const std::string line = ws.connect(r.web.httpsPort(), {cookie, "Origin: " + r.origin}, r.host);
    EXPECT_NE(line.find("101"), std::string::npos) << line;
    EXPECT_TRUE(r.settled(1));
}

TEST(CookieUpgrade, ASourceOutsideThePrivateNetworksNeedsTheCookie) {
    Rig r(false, /*privateSource=*/false);
    Wss without;
    EXPECT_NE(without.connect(r.web.httpsPort(), {}, r.host).find("403"), std::string::npos);
    EXPECT_NE(without.head().find("SOURCE_NOT_ALLOWED"), std::string::npos);
    const std::string cookie = r.cookieOf("xem1");
    Wss with;
    EXPECT_NE(with.connect(r.web.httpsPort(), {cookie, "Origin: " + r.origin}, r.host).find("101"),
              std::string::npos);
}

TEST(CookieUpgrade, WhenTheSessionEndsTheConnectionClosesWith4401AtTheNextLook) {
    Rig r(true, true, /*recheckMs=*/50);
    const std::string cookie = r.cookieOf("xem1");
    Wss ws;
    ASSERT_NE(ws.connect(r.web.httpsPort(), {cookie, "Origin: " + r.origin}, r.host).find("101"),
              std::string::npos);
    ASSERT_EQ(ws.read(3000).first, 1);  // hello
    r.mono += 31 * 60 * 1000;           // the idle time of the session is over
    // the transport looks again every recheckMs (the ticker of main calls expire())
    int code = 0;
    for (int i = 0; i < 100 && code == 0; ++i) {
        std::this_thread::sleep_for(std::chrono::milliseconds(60));
        r.transport->expire();
        const auto f = ws.read(50);
        if (f.first == 8 && f.second.size() >= 2)
            code = (static_cast<unsigned char>(f.second[0]) << 8) |
                   static_cast<unsigned char>(f.second[1]);
        if (f.first == -2) break;
    }
    EXPECT_EQ(code, 4401);
}
