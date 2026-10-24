#include "drivers/fins/udp_link.hpp"

#include <arpa/inet.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstring>

#include "drivers/sdk/tcp_socket.hpp"  // classifyConnectErrno

namespace mat::fins {

using drv::ConnectCode;
using drv::ReadCode;
using drv::ReadResult;

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

uint8_t lastOctet(const sockaddr_storage& s) {
    if (s.ss_family != AF_INET) return 0;
    const sockaddr_in* in = reinterpret_cast<const sockaddr_in*>(&s);
    return static_cast<uint8_t>(ntohl(in->sin_addr.s_addr) & 0xFF);
}

}  // namespace

UdpLink::UdpLink(int localPort) : localPort_(localPort) {
    if (::pipe2(wake_, O_CLOEXEC | O_NONBLOCK) != 0) wake_[0] = wake_[1] = -1;
}

UdpLink::~UdpLink() {
    closeFd(fd_);
    closeFd(wake_[0]);
    closeFd(wake_[1]);
}

void UdpLink::close() { closeFd(fd_); }

void UdpLink::interrupt() {
    interrupted_ = true;
    if (wake_[1] >= 0) {
        const char b = 1;
        const ssize_t n = ::write(wake_[1], &b, 1);
        (void)n;
    }
}

void UdpLink::clearInterrupt() {
    interrupted_ = false;
    if (wake_[0] < 0) return;
    char buf[16];
    while (::read(wake_[0], buf, sizeof buf) > 0) {
    }
}

int UdpLink::waitFor(short events, int timeoutMs) {
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

ConnectCode UdpLink::connect(const std::string& host, int port, int /*timeoutMs*/) {
    close();
    localNode_ = peerNode_ = 0;
    if (interrupted_) return ConnectCode::Interrupted;
    addrinfo hints{};
    hints.ai_family = AF_INET;  // FINS nodes come from IPv4 addresses
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
    const int fd = ::socket(list->ai_family, SOCK_DGRAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
    if (fd < 0) {
        ::freeaddrinfo(list);
        return ConnectCode::Error;
    }
    fd_ = fd;
    if (localPort_ > 0) {
        sockaddr_in local{};
        local.sin_family = AF_INET;
        local.sin_port = htons(static_cast<uint16_t>(localPort_));
        local.sin_addr.s_addr = htonl(INADDR_ANY);
        if (::bind(fd, reinterpret_cast<sockaddr*>(&local), sizeof local) != 0) {
            const int err = errno;
            closeFd(fd_);
            ::freeaddrinfo(list);
            return err == EADDRINUSE ? ConnectCode::PortBusy : ConnectCode::Error;
        }
    }
    if (::connect(fd, list->ai_addr, list->ai_addrlen) != 0) {
        const int err = errno;
        closeFd(fd_);
        ::freeaddrinfo(list);
        return drv::classifyConnectErrno(err);
    }
    ::freeaddrinfo(list);
    sockaddr_storage s{};
    socklen_t len = sizeof s;
    if (::getsockname(fd, reinterpret_cast<sockaddr*>(&s), &len) == 0) localNode_ = lastOctet(s);
    len = sizeof s;
    if (::getpeername(fd, reinterpret_cast<sockaddr*>(&s), &len) == 0) peerNode_ = lastOctet(s);
    return ConnectCode::Ok;
}

size_t UdpLink::discardInput() {
    if (fd_ < 0) return 0;
    size_t total = 0;
    uint8_t buf[2048];
    for (int refused = 0;;) {
        const ssize_t n = ::recv(fd_, buf, sizeof buf, MSG_DONTWAIT);
        // an old ICMP error: nothing to read
        if (n < 0 && errno == ECONNREFUSED && ++refused < 4) continue;
        if (n <= 0) break;
        total += static_cast<size_t>(n);
        received_ += static_cast<uint64_t>(n);
    }
    return total;
}

bool UdpLink::writeAll(const uint8_t* data, size_t n, int timeoutMs) {
    if (fd_ < 0) return false;
    const int64_t end = monoMs() + std::max(0, timeoutMs);
    for (int refused = 0;;) {
        const ssize_t w = ::send(fd_, data, n, MSG_NOSIGNAL);
        if (w == static_cast<ssize_t>(n)) {
            sent_ += static_cast<uint64_t>(w);
            return true;
        }
        if (w < 0 && errno == EINTR) continue;
        // an ICMP error of an earlier datagram is reported on this call: the datagram is not sent,
        // try once more (the error is cleared)
        if (w < 0 && errno == ECONNREFUSED && ++refused < 4) continue;
        if (w < 0 && (errno == EAGAIN || errno == EWOULDBLOCK || errno == ENOBUFS)) {
            const int r = waitFor(POLLOUT, static_cast<int>(std::max<int64_t>(0, end - monoMs())));
            if (r > 0) continue;
        }
        return false;
    }
}

ReadResult UdpLink::read(uint8_t* buf, size_t max, int timeoutMs) {
    ReadResult out;
    if (fd_ < 0) {
        out.code = ReadCode::Closed;
        return out;
    }
    const int64_t end = monoMs() + std::max(0, timeoutMs);
    for (;;) {
        const int w = waitFor(POLLIN, static_cast<int>(std::max<int64_t>(0, end - monoMs())));
        if (w == 0) {
            out.code = ReadCode::Timeout;
            return out;
        }
        if (w == -1) {
            out.code = ReadCode::Interrupted;
            return out;
        }
        if (w < 0) {
            out.code = ReadCode::Error;
            return out;
        }
        const ssize_t n = ::recv(fd_, buf, max, MSG_DONTWAIT);
        if (n >= 0) {
            received_ += static_cast<uint64_t>(n);
            out.code = ReadCode::Data;
            out.n = static_cast<size_t>(n);
            return out;
        }
        if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) continue;
        out.code = errno == ECONNREFUSED ? ReadCode::Closed : ReadCode::Error;
        return out;
    }
}

}  // namespace mat::fins
