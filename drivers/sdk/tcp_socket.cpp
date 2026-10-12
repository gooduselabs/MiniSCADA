#include "drivers/sdk/tcp_socket.hpp"

#include <arpa/inet.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstring>

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

ConnectCode classifyConnectErrno(int err) {
    switch (err) {
        case ECONNREFUSED:
            return ConnectCode::Refused;
        case ETIMEDOUT:
            return ConnectCode::Timeout;
        case ENETUNREACH:
        case EHOSTUNREACH:
        case ENETDOWN:
        case EHOSTDOWN:
            return ConnectCode::Unreachable;
        default:
            return ConnectCode::Error;
    }
}

TcpSocket::TcpSocket() {
    if (::pipe2(wake_, O_CLOEXEC | O_NONBLOCK) != 0) wake_[0] = wake_[1] = -1;
}

TcpSocket::~TcpSocket() {
    closeFd(fd_);
    closeFd(wake_[0]);
    closeFd(wake_[1]);
}

void TcpSocket::close() { closeFd(fd_); }

void TcpSocket::interrupt() {
    interrupted_ = true;
    if (wake_[1] >= 0) {
        const char b = 1;
        const ssize_t n = ::write(wake_[1], &b, 1);  // a full pipe already wakes
        (void)n;
    }
}

void TcpSocket::clearInterrupt() {
    interrupted_ = false;
    if (wake_[0] < 0) return;
    char buf[16];
    while (::read(wake_[0], buf, sizeof buf) > 0) {
    }
}

int TcpSocket::waitFor(short events, int timeoutMs) {
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

ConnectCode TcpSocket::connect(const std::string& host, int port, int timeoutMs) {
    close();
    if (interrupted_) return ConnectCode::Interrupted;
    const int64_t end = monoMs() + std::max(0, timeoutMs);

    addrinfo hints{};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    hints.ai_flags = AI_NUMERICSERV | AI_NUMERICHOST;
    addrinfo* list = nullptr;
    const std::string service = std::to_string(port);
    // A numeric address needs no resolver; only a name goes to getaddrinfo.
    int rc = ::getaddrinfo(host.c_str(), service.c_str(), &hints, &list);
    if (rc != 0) {
        hints.ai_flags = AI_NUMERICSERV;
        rc = ::getaddrinfo(host.c_str(), service.c_str(), &hints, &list);
    }
    if (rc != 0 || !list) return ConnectCode::Dns;

    ConnectCode result = ConnectCode::Error;
    for (addrinfo* a = list; a; a = a->ai_next) {
        const int64_t left = end - monoMs();
        if (left <= 0) {
            result = ConnectCode::Timeout;
            break;
        }
        const int fd =
            ::socket(a->ai_family, a->ai_socktype | SOCK_NONBLOCK | SOCK_CLOEXEC, a->ai_protocol);
        if (fd < 0) {
            result = classifyConnectErrno(errno);
            continue;
        }
        fd_ = fd;
        int err = 0;
        if (::connect(fd, a->ai_addr, a->ai_addrlen) != 0) {
            err = errno;
            if (err == EINPROGRESS) {
                const int w = waitFor(POLLOUT, static_cast<int>(left));
                if (w == -1) {
                    closeFd(fd_);
                    result = ConnectCode::Interrupted;
                    break;
                }
                if (w == 0) {
                    closeFd(fd_);
                    result = ConnectCode::Timeout;
                    break;
                }
                socklen_t len = sizeof err;
                if (w < 0 || ::getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &len) != 0)
                    err = errno ? errno : EIO;
            }
        }
        if (err == 0) {
            const int one = 1;
            ::setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
            ::setsockopt(fd, SOL_SOCKET, SO_KEEPALIVE, &one, sizeof one);
            ::freeaddrinfo(list);
            return ConnectCode::Ok;
        }
        closeFd(fd_);
        result = classifyConnectErrno(err);
    }
    ::freeaddrinfo(list);
    return result;
}

bool TcpSocket::peerClosed() {
    if (fd_ < 0) return true;
    pollfd p{fd_, POLLIN, 0};
    if (::poll(&p, 1, 0) <= 0) return false;
    if (p.revents & (POLLERR | POLLHUP | POLLNVAL)) return true;
    if (p.revents & POLLIN) {
        char b;
        const ssize_t n = ::recv(fd_, &b, 1, MSG_PEEK | MSG_DONTWAIT);
        if (n == 0) return true;
        if (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) return true;
    }
    return false;
}

size_t TcpSocket::discardInput() {
    if (fd_ < 0) return 0;
    size_t total = 0;
    char buf[512];
    for (;;) {
        const ssize_t n = ::recv(fd_, buf, sizeof buf, MSG_DONTWAIT);
        if (n <= 0) break;
        total += static_cast<size_t>(n);
        received_ += static_cast<uint64_t>(n);
    }
    return total;
}

bool TcpSocket::writeAll(const uint8_t* data, size_t n, int timeoutMs) {
    if (fd_ < 0) return false;
    const int64_t end = monoMs() + std::max(0, timeoutMs);
    size_t done = 0;
    while (done < n) {
        const ssize_t w = ::send(fd_, data + done, n - done, MSG_NOSIGNAL);
        if (w > 0) {
            done += static_cast<size_t>(w);
            sent_ += static_cast<uint64_t>(w);
            continue;
        }
        if (w < 0 && errno == EINTR) continue;
        if (w < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            const int r = waitFor(POLLOUT, static_cast<int>(std::max<int64_t>(0, end - monoMs())));
            if (r > 0) continue;
        }
        return false;
    }
    return true;
}

ReadResult TcpSocket::read(uint8_t* buf, size_t max, int timeoutMs) {
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
        if (n > 0) {
            received_ += static_cast<uint64_t>(n);
            out.code = ReadCode::Data;
            out.n = static_cast<size_t>(n);
            return out;
        }
        if (n == 0) {
            out.code = ReadCode::Closed;
            return out;
        }
        if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) continue;
        out.code = (errno == ECONNRESET || errno == EPIPE) ? ReadCode::Closed : ReadCode::Error;
        return out;
    }
}

}  // namespace mat::drv
