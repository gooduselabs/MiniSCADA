// TCP transport over a non-blocking socket (feature 006 T098; contracts/modbus-driver.md §5).
// Every wait is a poll() on the socket and on a self-pipe, so a time limit holds and interrupt()
// (another thread) ends it at once. Descriptors are close-on-exec. SIGPIPE never fires
// (MSG_NOSIGNAL).
#pragma once
#include <atomic>
#include <string>

#include "drivers/sdk/transport.hpp"

namespace mat::drv {

// The class of a failed connect(): ECONNREFUSED, ETIMEDOUT, ENETUNREACH/EHOSTUNREACH/ENETDOWN/
// EHOSTDOWN, anything else.
ConnectCode classifyConnectErrno(int err);

class TcpSocket : public Transport {
   public:
    TcpSocket();
    ~TcpSocket() override;
    TcpSocket(const TcpSocket&) = delete;
    TcpSocket& operator=(const TcpSocket&) = delete;

    // A numeric address connects at once; a name goes through getaddrinfo (which cannot be
    // interrupted: it ends by itself, normally within a second). Dns: the name did not resolve.
    ConnectCode connect(const std::string& host, int port, int timeoutMs) override;
    bool isOpen() const override { return fd_ >= 0; }
    void close() override;
    bool peerClosed() override;
    size_t discardInput() override;
    bool writeAll(const uint8_t* data, size_t n, int timeoutMs) override;
    ReadResult read(uint8_t* buf, size_t max, int timeoutMs) override;
    void interrupt() override;
    void clearInterrupt() override;
    uint64_t bytesSent() const override { return sent_.load(); }
    uint64_t bytesReceived() const override { return received_.load(); }

    int fd() const { return fd_; }           // for tests
    int wakeFd() const { return wake_[0]; }  // for tests

   private:
    // poll() for `events` on the socket and the wake pipe, up to timeoutMs. >0 socket ready,
    // 0 time is up, -1 interrupted, -2 failed.
    int waitFor(short events, int timeoutMs);

    int fd_ = -1;
    int wake_[2] = {-1, -1};
    std::atomic<bool> interrupted_{false};
    std::atomic<uint64_t> sent_{0};
    std::atomic<uint64_t> received_{0};
};

}  // namespace mat::drv
