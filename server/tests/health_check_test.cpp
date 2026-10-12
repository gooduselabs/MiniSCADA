// T107 (feature 005; research R13 step 6, contracts/device-api.md §5, device-config.md §7 step 9):
// the health check of a version that has just started, a pure function over probes with a fake
// clock, and the runtime's own call to GET /api/v1/system/info on a real socket.
// - project not active → HEALTH_PROJECT, HTTPS closed → HEALTH_HTTPS, both at once (no waiting);
// - the digest of system/info must be the version's, and the tick loop must have run for 2 s
//   without an error; the deadline (15 s from the read of state.json) → HEALTH_TIMEOUT;
// - fetchSystemInfoDigest: 200 with a digest; refusal, null digest, silence, no listener → nullopt.
#include "core/project-store/health_check.hpp"

#include <arpa/inet.h>
#include <gtest/gtest.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <functional>
#include <string>
#include <thread>

using namespace mat;

namespace {

const std::string kDigest = "sha256:" + std::string(64, 'a');
const std::string kOldDigest = "sha256:" + std::string(64, 'b');

// A virtual clock: sleeping moves it, and the tick loop advances 1 pass per 250 ms of it.
struct Rig {
    int64_t now = 100000;
    int64_t started = 100000;
    int sleeps = 0;
    bool project = true;
    bool https = true;
    bool tickFails = false;
    bool tickRuns = true;
    int64_t tickStopsAt = -1;  // virtual time after which the loop stops counting
    std::function<std::optional<std::string>(int64_t now)> digest = [](int64_t) {
        return std::optional<std::string>(kDigest);
    };

    HealthClock clock() {
        HealthClock c;
        c.monoMs = [this] { return now; };
        c.sleepMs = [this](int ms) {
            now += ms;
            ++sleeps;
        };
        return c;
    }
    HealthProbes probes() {
        HealthProbes p;
        p.projectActive = [this] { return project; };
        p.httpsOpen = [this] { return https; };
        p.reportedDigest = [this] { return digest(now); };
        p.tickCount = [this]() -> int64_t {
            const int64_t t = tickStopsAt >= 0 ? std::min(now, tickStopsAt) : now;
            return tickRuns ? t / 250 : 0;
        };
        p.tickFailed = [this] { return tickFails; };
        return p;
    }
};

}  // namespace

TEST(HealthCheck, PassesAfterTheTickWindow) {
    Rig r;
    const HealthOutcome o = runHealthCheck(r.probes(), kDigest, r.started + 15000, r.clock());
    EXPECT_TRUE(o.ok) << o.code << " " << o.detail;
    EXPECT_EQ(o.code, "");
    EXPECT_GE(r.now - r.started, kHealthTickWindowMs);  // the loop was watched for 2 s
    EXPECT_LT(r.now - r.started, kHealthTickWindowMs + 2 * kHealthPollMs);
}

TEST(HealthCheck, ProjectNotActiveFailsAtOnce) {
    Rig r;
    r.project = false;
    const HealthOutcome o = runHealthCheck(r.probes(), kDigest, r.started + 15000, r.clock());
    EXPECT_FALSE(o.ok);
    EXPECT_EQ(o.code, "HEALTH_PROJECT");
    EXPECT_EQ(r.now, r.started);  // no waiting
    EXPECT_FALSE(o.detail.empty());
}

TEST(HealthCheck, HttpsClosedFailsAtOnce) {
    Rig r;
    r.https = false;
    const HealthOutcome o = runHealthCheck(r.probes(), kDigest, r.started + 15000, r.clock());
    EXPECT_FALSE(o.ok);
    EXPECT_EQ(o.code, "HEALTH_HTTPS");
    EXPECT_EQ(r.now, r.started);
}

TEST(HealthCheck, ProjectComesBeforeHttps) {
    Rig r;
    r.project = false;
    r.https = false;
    EXPECT_EQ(runHealthCheck(r.probes(), kDigest, r.started + 15000, r.clock()).code,
              "HEALTH_PROJECT");
}

TEST(HealthCheck, TickErrorIsAProjectFailure) {
    Rig r;
    r.tickFails = true;
    const HealthOutcome o = runHealthCheck(r.probes(), kDigest, r.started + 15000, r.clock());
    EXPECT_EQ(o.code, "HEALTH_PROJECT");
    EXPECT_FALSE(o.ok);
}

TEST(HealthCheck, TickErrorDuringTheWindowFails) {
    Rig r;
    auto p = r.probes();
    p.tickFailed = [&r] { return r.now - r.started >= 1000; };  // the loop throws after 1 s
    const HealthOutcome o = runHealthCheck(p, kDigest, r.started + 15000, r.clock());
    EXPECT_EQ(o.code, "HEALTH_PROJECT");
    EXPECT_LT(r.now - r.started, kHealthTickWindowMs);
}

TEST(HealthCheck, OtherDigestTimesOutAtTheDeadline) {
    Rig r;
    r.digest = [](int64_t) { return std::optional<std::string>(kOldDigest); };
    const int64_t deadline = r.started + 15000;
    const HealthOutcome o = runHealthCheck(r.probes(), kDigest, deadline, r.clock());
    EXPECT_FALSE(o.ok);
    EXPECT_EQ(o.code, "HEALTH_TIMEOUT");
    EXPECT_GE(r.now, deadline);
    EXPECT_LE(r.now, deadline + kHealthPollMs);
}

TEST(HealthCheck, NoAnswerTimesOut) {
    Rig r;
    r.digest = [](int64_t) { return std::optional<std::string>(); };  // connection refused
    EXPECT_EQ(runHealthCheck(r.probes(), kDigest, r.started + 15000, r.clock()).code,
              "HEALTH_TIMEOUT");
}

TEST(HealthCheck, DigestThatAppearsLaterPasses) {
    Rig r;
    const int64_t t0 = r.started;
    r.digest = [t0](int64_t now) {
        return now - t0 >= 3500 ? std::optional<std::string>(kDigest) : std::nullopt;
    };
    const HealthOutcome o = runHealthCheck(r.probes(), kDigest, r.started + 15000, r.clock());
    EXPECT_TRUE(o.ok) << o.code;
    EXPECT_GE(r.now - r.started, 3500);
}

TEST(HealthCheck, TickLoopThatStopsTimesOut) {
    Rig r;
    r.tickStopsAt = r.started + 300;  // one pass or two, then it hangs
    const HealthOutcome o = runHealthCheck(r.probes(), kDigest, r.started + 15000, r.clock());
    EXPECT_EQ(o.code, "HEALTH_TIMEOUT");
    EXPECT_GE(r.now, r.started + 15000);
}

TEST(HealthCheck, TickLoopThatNeverRunsTimesOut) {
    Rig r;
    r.tickRuns = false;
    EXPECT_EQ(runHealthCheck(r.probes(), kDigest, r.started + 15000, r.clock()).code,
              "HEALTH_TIMEOUT");
}

TEST(HealthCheck, DeadlineAlreadyPassedIsATimeout) {
    Rig r;
    // The process was slow to start: state.json was read 16 s ago.
    const HealthOutcome o = runHealthCheck(r.probes(), kDigest, r.started - 1000, r.clock());
    EXPECT_FALSE(o.ok);
    EXPECT_EQ(o.code, "HEALTH_TIMEOUT");
}

TEST(HealthCheck, DeadlineCutsTheTickWindowShort) {
    Rig r;
    // Only 1 s left: the 2 s window cannot finish.
    const HealthOutcome o = runHealthCheck(r.probes(), kDigest, r.started + 1000, r.clock());
    EXPECT_EQ(o.code, "HEALTH_TIMEOUT");
}

TEST(HealthCheck, ProbesAreNotRunOnceDecided) {
    Rig r;
    int calls = 0;
    auto p = r.probes();
    p.reportedDigest = [&calls] {
        ++calls;
        return std::optional<std::string>(kDigest);
    };
    runHealthCheck(p, kDigest, r.started + 15000, r.clock());
    EXPECT_LE(calls, 40);  // bounded by the polling interval: 2 s / 100 ms + a few
}

// ---------- fetchSystemInfoDigest on a real socket ----------

namespace {

// A listener on 127.0.0.1 that answers one connection with `response` (nothing when empty), then
// closes; records the request text.
class OneShotServer {
   public:
    explicit OneShotServer(std::string response, int holdMs = 0)
        : response_(std::move(response)), holdMs_(holdMs) {
        fd_ = ::socket(AF_INET, SOCK_STREAM, 0);
        sockaddr_in a{};
        a.sin_family = AF_INET;
        a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        socklen_t len = sizeof a;
        if (::bind(fd_, reinterpret_cast<sockaddr*>(&a), sizeof a) == 0 && ::listen(fd_, 2) == 0 &&
            ::getsockname(fd_, reinterpret_cast<sockaddr*>(&a), &len) == 0)
            port_ = ntohs(a.sin_port);
        thread_ = std::thread([this] { serve(); });
    }
    ~OneShotServer() {
        ::shutdown(fd_, SHUT_RDWR);
        ::close(fd_);
        if (thread_.joinable()) thread_.join();
    }
    int port() const { return port_; }
    std::string request() const { return request_; }

   private:
    void serve() {
        const int c = ::accept(fd_, nullptr, nullptr);
        if (c < 0) return;
        char buf[1024];
        std::string in;
        while (in.find("\r\n\r\n") == std::string::npos) {
            const ssize_t n = ::recv(c, buf, sizeof buf, 0);
            if (n <= 0) break;
            in.append(buf, static_cast<size_t>(n));
        }
        request_ = in;
        if (!response_.empty()) ::send(c, response_.data(), response_.size(), MSG_NOSIGNAL);
        if (holdMs_ > 0) std::this_thread::sleep_for(std::chrono::milliseconds(holdMs_));
        ::close(c);
    }
    std::string response_;
    int holdMs_;
    int fd_ = -1;
    int port_ = 0;
    std::string request_;
    std::thread thread_;
};

std::string http(int status, const std::string& body) {
    return "HTTP/1.1 " + std::to_string(status) + " X\r\nContent-Type: application/json\r\n" +
           "Content-Length: " + std::to_string(body.size()) + "\r\nConnection: close\r\n\r\n" +
           body;
}

}  // namespace

TEST(FetchSystemInfoDigest, ReadsTheDigestOfTheProject) {
    OneShotServer s(
        http(200, R"({"runtimeVersion":"0.4.0","project":{"status":"active","digest":")" + kDigest +
                      R"("}})"));
    const auto d = fetchSystemInfoDigest(s.port(), 2000);
    ASSERT_TRUE(d.has_value());
    EXPECT_EQ(*d, kDigest);
    EXPECT_EQ(s.request().rfind("GET /api/v1/system/info HTTP/1.1\r\n", 0), 0u) << s.request();
    EXPECT_NE(s.request().find("Connection: close"), std::string::npos);
}

TEST(FetchSystemInfoDigest, ChunkedAnswerIsRead) {
    const std::string body = R"({"project":{"digest":")" + kDigest + R"("}})";
    char len[16];
    std::snprintf(len, sizeof len, "%zx", body.size());
    OneShotServer s("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n" +
                    std::string(len) + "\r\n" + body + "\r\n0\r\n\r\n");
    const auto d = fetchSystemInfoDigest(s.port(), 2000);
    ASSERT_TRUE(d.has_value());
    EXPECT_EQ(*d, kDigest);
}

TEST(FetchSystemInfoDigest, NoDigestIsNothing) {
    OneShotServer nullDigest(http(200, R"({"project":{"status":"invalid","digest":null}})"));
    EXPECT_FALSE(fetchSystemInfoDigest(nullDigest.port(), 2000).has_value());
    OneShotServer noProject(http(200, R"({"project":null})"));
    EXPECT_FALSE(fetchSystemInfoDigest(noProject.port(), 2000).has_value());
    OneShotServer notJson(http(200, "<html>"));
    EXPECT_FALSE(fetchSystemInfoDigest(notJson.port(), 2000).has_value());
}

TEST(FetchSystemInfoDigest, ErrorStatusIsNothing) {
    OneShotServer s(http(503, R"({"project":{"digest":")" + kDigest + R"("}})"));
    EXPECT_FALSE(fetchSystemInfoDigest(s.port(), 2000).has_value());
}

TEST(FetchSystemInfoDigest, NothingListeningIsNothing) {
    int port = 0;
    {
        OneShotServer s("");
        port = s.port();
    }  // closed again
    EXPECT_FALSE(fetchSystemInfoDigest(port, 2000).has_value());
}

TEST(FetchSystemInfoDigest, SilenceEndsAtTheTimeout) {
    OneShotServer s("", 1000);  // accepts, reads the request, says nothing
    const auto t0 = std::chrono::steady_clock::now();
    EXPECT_FALSE(fetchSystemInfoDigest(s.port(), 400).has_value());
    const auto ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count();
    EXPECT_GE(ms, 300);
    EXPECT_LT(ms, 1500);
}
