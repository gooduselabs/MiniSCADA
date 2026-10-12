#include "core/project-store/health_check.hpp"

#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cctype>
#include <cerrno>
#include <chrono>
#include <cstdlib>
#include <thread>

#include "core/project-store/store.hpp"
#include "nlohmann/json.hpp"

namespace mat {

namespace {

constexpr size_t kInfoMaxBytes = 256 * 1024;  // system/info is a few KiB; refuse more

int64_t steadyMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

// Poll one descriptor for `events` until `deadline` (steady ms). >0 ready, 0 timeout, <0 error.
int waitFd(int fd, short events, int64_t deadline) {
    for (;;) {
        const int64_t left = deadline - steadyMs();
        if (left <= 0) return 0;
        pollfd p{fd, events, 0};
        const int r = ::poll(&p, 1, static_cast<int>(left));
        if (r < 0 && errno == EINTR) continue;
        return r;
    }
}

bool sendAll(int fd, const std::string& data, int64_t deadline) {
    size_t off = 0;
    while (off < data.size()) {
        if (waitFd(fd, POLLOUT, deadline) <= 0) return false;
        const ssize_t n = ::send(fd, data.data() + off, data.size() - off, MSG_NOSIGNAL);
        if (n < 0 && (errno == EINTR || errno == EAGAIN)) continue;
        if (n <= 0) return false;
        off += static_cast<size_t>(n);
    }
    return true;
}

// The body of a complete HTTP/1.1 answer whose status is 200; nullopt when it is not one (yet).
// `closed`: the peer has closed, so a body without a length ends here.
std::optional<std::string> bodyOf200(const std::string& raw, bool closed) {
    const size_t end = raw.find("\r\n\r\n");
    if (end == std::string::npos) return std::nullopt;
    const std::string head = raw.substr(0, end);
    if (head.compare(0, 9, "HTTP/1.1 ") != 0 && head.compare(0, 9, "HTTP/1.0 ") != 0)
        return std::nullopt;
    if (head.compare(9, 3, "200") != 0) return std::nullopt;
    std::string lower = head;
    for (auto& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    const std::string body = raw.substr(end + 4);
    if (lower.find("\r\ntransfer-encoding: chunked") != std::string::npos) {
        std::string out;
        size_t at = 0;
        for (;;) {
            const size_t eol = body.find("\r\n", at);
            if (eol == std::string::npos) return std::nullopt;
            const unsigned long n = std::strtoul(body.c_str() + at, nullptr, 16);
            at = eol + 2;
            if (n == 0) return out;
            if (body.size() < at + n + 2) return std::nullopt;
            out.append(body, at, n);
            at += n + 2;
        }
    }
    const size_t cl = lower.find("\r\ncontent-length:");
    if (cl != std::string::npos) {
        const unsigned long n = std::strtoul(lower.c_str() + cl + 17, nullptr, 10);
        if (body.size() < n) return std::nullopt;
        return body.substr(0, n);
    }
    if (closed) return body;
    return std::nullopt;
}

}  // namespace

HealthOutcome runHealthCheck(const HealthProbes& probes, const std::string& expectedDigest,
                             int64_t deadlineMonoMs, const HealthClock& clock) {
    auto now = [&]() -> int64_t { return clock.monoMs ? clock.monoMs() : systemMonoMs(); };
    auto sleep = [&](int ms) {
        if (clock.sleepMs)
            clock.sleepMs(ms);
        else
            std::this_thread::sleep_for(std::chrono::milliseconds(ms));
    };
    auto fail = [](const char* code, std::string detail) {
        HealthOutcome o;
        o.code = code;
        o.detail = std::move(detail);
        return o;
    };

    const int64_t start = now();
    if (probes.projectActive && !probes.projectActive())
        return fail("HEALTH_PROJECT", "project của bản này không kích hoạt được");
    if (probes.tickFailed && probes.tickFailed())
        return fail("HEALTH_PROJECT", "vòng tick báo lỗi");
    if (probes.httpsOpen && !probes.httpsOpen())
        return fail("HEALTH_HTTPS", "context HTTPS không mở được");

    const int64_t baseTicks = probes.tickCount ? probes.tickCount() : 0;
    bool digestSeen = false;
    for (;;) {
        const int64_t t = now();
        if (t >= deadlineMonoMs) {
            std::string why =
                digestSeen ? "vòng tick chưa chạy đủ " : "system/info chưa báo digest ";
            why += digestSeen ? std::to_string(kHealthTickWindowMs) + " ms" : expectedDigest;
            return fail("HEALTH_TIMEOUT", why + " trong hạn 15 s");
        }
        if (probes.tickFailed && probes.tickFailed())
            return fail("HEALTH_PROJECT", "vòng tick báo lỗi");
        if (!digestSeen && probes.reportedDigest) {
            const auto d = probes.reportedDigest();
            digestSeen = d.has_value() && *d == expectedDigest;
        }
        const int64_t ticks = (probes.tickCount ? probes.tickCount() : 0) - baseTicks;
        if (digestSeen && t - start >= kHealthTickWindowMs && ticks >= 2) {
            HealthOutcome ok;
            ok.ok = true;
            return ok;
        }
        sleep(kHealthPollMs);
    }
}

std::optional<std::string> fetchSystemInfoDigest(int port, int timeoutMs) {
    const int64_t deadline = steadyMs() + timeoutMs;
    const int fd = ::socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
    if (fd < 0) return std::nullopt;
    struct Closer {
        int fd;
        ~Closer() { ::close(fd); }
    } closer{fd};

    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_port = htons(static_cast<uint16_t>(port));
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (::connect(fd, reinterpret_cast<sockaddr*>(&a), sizeof a) != 0) {
        if (errno != EINPROGRESS) return std::nullopt;
        if (waitFd(fd, POLLOUT, deadline) <= 0) return std::nullopt;
        int err = 0;
        socklen_t len = sizeof err;
        if (::getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &len) != 0 || err != 0)
            return std::nullopt;
    }
    if (!sendAll(fd,
                 "GET /api/v1/system/info HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: "
                 "application/json\r\nConnection: close\r\n\r\n",
                 deadline))
        return std::nullopt;

    std::string raw;
    bool closed = false;
    std::optional<std::string> body;
    while (!body && raw.size() < kInfoMaxBytes) {
        if (waitFd(fd, POLLIN, deadline) <= 0) return std::nullopt;
        char buf[4096];
        const ssize_t n = ::recv(fd, buf, sizeof buf, 0);
        if (n < 0 && (errno == EINTR || errno == EAGAIN)) continue;
        if (n < 0) return std::nullopt;
        if (n == 0)
            closed = true;
        else
            raw.append(buf, static_cast<size_t>(n));
        body = bodyOf200(raw, closed);
        if (closed) break;
    }
    if (!body) return std::nullopt;
    const nlohmann::json j = nlohmann::json::parse(*body, nullptr, false);
    if (!j.is_object() || !j.contains("project") || !j["project"].is_object()) return std::nullopt;
    const auto& d = j["project"]["digest"];
    if (!d.is_string()) return std::nullopt;
    return d.get<std::string>();
}

}  // namespace mat
