#include "drivers/bacnet/udp_port.hpp"

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

namespace mat::bacnet {

using drv::ConnectCode;
using drv::ReadCode;

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

bool resolveIpv4(const std::string& host, uint32_t& ip) {
    in_addr a{};
    if (::inet_pton(AF_INET, host.c_str(), &a) == 1) {
        ip = ntohl(a.s_addr);
        return true;
    }
    if (host.empty() || host.size() > 253) return false;
    addrinfo hints{};
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_DGRAM;
    addrinfo* list = nullptr;
    if (::getaddrinfo(host.c_str(), nullptr, &hints, &list) != 0 || !list) return false;
    ip = ntohl(reinterpret_cast<const sockaddr_in*>(list->ai_addr)->sin_addr.s_addr);
    ::freeaddrinfo(list);
    return true;
}

std::string ipText(uint32_t ip) {
    return std::to_string(ip >> 24) + "." + std::to_string((ip >> 16) & 255) + "." +
           std::to_string((ip >> 8) & 255) + "." + std::to_string(ip & 255);
}

UdpPort::UdpPort() {
    if (::pipe2(wake_, O_CLOEXEC | O_NONBLOCK) != 0) wake_[0] = wake_[1] = -1;
}

UdpPort::~UdpPort() {
    closeFd(fd_);
    closeFd(wake_[0]);
    closeFd(wake_[1]);
}

void UdpPort::close() { closeFd(fd_); }

void UdpPort::interrupt() {
    interrupted_ = true;
    if (wake_[1] >= 0) {
        const char b = 1;
        const ssize_t n = ::write(wake_[1], &b, 1);
        (void)n;
    }
}

void UdpPort::clearInterrupt() {
    interrupted_ = false;
    if (wake_[0] < 0) return;
    char buf[16];
    while (::read(wake_[0], buf, sizeof buf) > 0) {
    }
}

int UdpPort::waitFor(int timeoutMs) {
    const int64_t end = monoMs() + std::max(0, timeoutMs);
    for (;;) {
        if (interrupted_) return -1;
        pollfd p[2] = {{fd_, POLLIN, 0}, {wake_[0], POLLIN, 0}};
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

ConnectCode UdpPort::open(int localPort, const std::string& bindAddress) {
    close();
    if (interrupted_) return ConnectCode::Interrupted;
    sockaddr_in local{};
    local.sin_family = AF_INET;
    local.sin_port = htons(static_cast<uint16_t>(std::max(0, localPort)));
    local.sin_addr.s_addr = htonl(INADDR_ANY);
    if (!bindAddress.empty() && ::inet_pton(AF_INET, bindAddress.c_str(), &local.sin_addr) != 1)
        return ConnectCode::Dns;
    const int fd = ::socket(AF_INET, SOCK_DGRAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
    if (fd < 0) return ConnectCode::Error;
    fd_ = fd;
    const int one = 1;
    ::setsockopt(fd, SOL_SOCKET, SO_BROADCAST, &one, sizeof one);
    // the connection test may listen on the port of a running channel for I-Am broadcasts
    ::setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    if (::bind(fd, reinterpret_cast<sockaddr*>(&local), sizeof local) != 0) {
        const int err = errno;
        closeFd(fd_);
        return err == EADDRINUSE ? ConnectCode::PortBusy : ConnectCode::Error;
    }
    return ConnectCode::Ok;
}

bool UdpPort::sendTo(uint32_t ip, uint16_t port, const uint8_t* data, size_t n) {
    if (fd_ < 0) return false;
    sockaddr_in to{};
    to.sin_family = AF_INET;
    to.sin_port = htons(port);
    to.sin_addr.s_addr = htonl(ip);
    for (int attempt = 0; attempt < 4; ++attempt) {
        const ssize_t w =
            ::sendto(fd_, data, n, MSG_NOSIGNAL, reinterpret_cast<sockaddr*>(&to), sizeof to);
        if (w == static_cast<ssize_t>(n)) {
            sent_ += static_cast<uint64_t>(w);
            return true;
        }
        if (w < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK ||
                      errno == ENOBUFS || errno == ECONNREFUSED))
            continue;
        return false;
    }
    return false;
}

ReadCode UdpPort::recvFrom(uint8_t* buf, size_t max, int timeoutMs, size_t& n, uint32_t& ip,
                           uint16_t& port) {
    n = 0;
    if (fd_ < 0) return ReadCode::Closed;
    const int64_t end = monoMs() + std::max(0, timeoutMs);
    for (;;) {
        const int w = waitFor(static_cast<int>(std::max<int64_t>(0, end - monoMs())));
        if (w == 0) return ReadCode::Timeout;
        if (w == -1) return ReadCode::Interrupted;
        if (w < 0) return ReadCode::Error;
        sockaddr_in from{};
        socklen_t len = sizeof from;
        const ssize_t r =
            ::recvfrom(fd_, buf, max, MSG_DONTWAIT, reinterpret_cast<sockaddr*>(&from), &len);
        if (r >= 0) {
            received_ += static_cast<uint64_t>(r);
            n = static_cast<size_t>(r);
            ip = ntohl(from.sin_addr.s_addr);
            port = ntohs(from.sin_port);
            return ReadCode::Data;
        }
        // an ICMP error of an earlier datagram (ECONNREFUSED) is not ours to report here
        if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK || errno == ECONNREFUSED)
            continue;
        return ReadCode::Error;
    }
}

}  // namespace mat::bacnet
