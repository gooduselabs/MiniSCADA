#include "drivers/mc/udp_socket.hpp"

#include <fcntl.h>
#include <netdb.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <chrono>

#include "drivers/sdk/tcp_socket.hpp"  // classifyConnectErrno

namespace mat::drv {

namespace {

int64_t monoMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

void closeFd(int& fd) {
    if (fd >= 0) ::close(fd);
    fd = -1;
}

}  // namespace

UdpSocket::UdpSocket() {
    if (::pipe2(wake_, O_CLOEXEC | O_NONBLOCK) != 0) wake_[0] = wake_[1] = -1;
}

UdpSocket::~UdpSocket() {
    closeFd(fd_);
    closeFd(wake_[0]);
    closeFd(wake_[1]);
}

void UdpSocket::close() { closeFd(fd_); }

void UdpSocket::interrupt() {
    interrupted_ = true;
    if (wake_[1] >= 0) {
        const char b = 1;
        const ssize_t n = ::write(wake_[1], &b, 1);
        (void)n;
    }
}

void UdpSocket::clearInterrupt() {
    interrupted_ = false;
    if (wake_[0] < 0) return;
    char buf[16];
    while (::read(wake_[0], buf, sizeof buf) > 0) {
    }
}

int UdpSocket::waitFor(short events, int timeoutMs) {
    const int64_t end = monoMs() + std::max(0, timeoutMs);
    for (;;) {
        if (interrupted_) return -1;
        pollfd p[2] = {{fd_, events, 0}, {wake_[0], POLLIN, 0}};
        const int64_t left = end - monoMs();
        const int r =
            ::poll(p, wake_[0] >= 0 ? 2 : 1, static_cast<int>(std::max<int64_t>(0, left)));
        if (r < 0) {
            if (errno == EINTR) continue;
            return -2;
        }
        if (r == 0) return 0;
        if (interrupted_ || (wake_[0] >= 0 && (p[1].revents & POLLIN))) return -1;
        return 1;
    }
}

ConnectCode UdpSocket::connect(const std::string& host, int port, int /*timeoutMs*/) {
    close();
    if (interrupted_) return ConnectCode::Interrupted;
    addrinfo hints{};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_DGRAM;
    hints.ai_flags = AI_NUMERICSERV | AI_NUMERICHOST;
    addrinfo* list = nullptr;
    const std::string service = std::to_string(port);
    int rc = ::getaddrinfo(host.c_str(), service.c_str(), &hints, &list);
    if (rc != 0) {
        hints.ai_flags = AI_NUMERICSERV;
        rc = ::getaddrinfo(host.c_str(), service.c_str(), &hints, &list);
    }
    if (rc != 0 || !list) return ConnectCode::Dns;
    ConnectCode result = ConnectCode::Error;
    for (addrinfo* a = list; a; a = a->ai_next) {
        const int fd =
            ::socket(a->ai_family, a->ai_socktype | SOCK_NONBLOCK | SOCK_CLOEXEC, a->ai_protocol);
        if (fd < 0) {
            result = classifyConnectErrno(errno);
            continue;
        }
        if (::connect(fd, a->ai_addr, a->ai_addrlen) == 0) {
            fd_ = fd;
            ::freeaddrinfo(list);
            return ConnectCode::Ok;
        }
        result = classifyConnectErrno(errno);
        ::close(fd);
    }
    ::freeaddrinfo(list);
    return result;
}

size_t UdpSocket::discardInput() {
    if (fd_ < 0) return 0;
    size_t total = 0;
    uint8_t buf[2048];
    for (;;) {
        const ssize_t n = ::recv(fd_, buf, sizeof buf, MSG_DONTWAIT);
        if (n < 0 && errno == ECONNREFUSED) continue;  // an old ICMP error: drop it too
        if (n <= 0) break;
        total += static_cast<size_t>(n);
        received_ += static_cast<uint64_t>(n);
    }
    return total;
}

bool UdpSocket::writeAll(const uint8_t* data, size_t n, int timeoutMs) {
    if (fd_ < 0) return false;
    for (;;) {
        const ssize_t w = ::send(fd_, data, n, MSG_NOSIGNAL);
        if (w == static_cast<ssize_t>(n)) {
            sent_ += static_cast<uint64_t>(n);
            return true;
        }
        if (w < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            if (waitFor(POLLOUT, timeoutMs) <= 0) return false;
            continue;
        }
        if (w < 0 && errno == EINTR) continue;
        return false;
    }
}

ReadResult UdpSocket::read(uint8_t* buf, size_t max, int timeoutMs) {
    ReadResult r;
    if (fd_ < 0) {
        r.code = ReadCode::Closed;
        return r;
    }
    const int w = waitFor(POLLIN, timeoutMs);
    if (w == -1) {
        r.code = ReadCode::Interrupted;
        return r;
    }
    if (w == 0) {
        r.code = ReadCode::Timeout;
        return r;
    }
    if (w < 0) {
        r.code = ReadCode::Error;
        return r;
    }
    const ssize_t n = ::recv(fd_, buf, max, MSG_DONTWAIT);
    if (n > 0) {
        received_ += static_cast<uint64_t>(n);
        r.code = ReadCode::Data;
        r.n = static_cast<size_t>(n);
        return r;
    }
    if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR)) {
        r.code = ReadCode::Timeout;  // a spurious wake: the caller waits again on its deadline
        r.n = 0;
        return r;
    }
    r.code = ReadCode::Closed;  // ECONNREFUSED (ICMP port unreachable) or another failure
    return r;
}

}  // namespace mat::drv
