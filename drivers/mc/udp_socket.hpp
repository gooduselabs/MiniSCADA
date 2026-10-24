// UDP transport of the MC driver (feature 017): a connected datagram socket, one request and one
// response per datagram. Every wait is a poll() on the socket and on a self-pipe, like TcpSocket,
// so a time limit holds and interrupt() ends it at once. There is no connection: connect() only
// resolves the address and binds the socket to it; a port that answers ICMP "unreachable" makes the
// next read return Closed (the driver then opens the socket again after its backoff).
#pragma once
#include <atomic>
#include <string>

#include "drivers/sdk/transport.hpp"

namespace mat::drv {

class UdpSocket : public Transport {
   public:
    UdpSocket();
    ~UdpSocket() override;
    UdpSocket(const UdpSocket&) = delete;
    UdpSocket& operator=(const UdpSocket&) = delete;

    ConnectCode connect(const std::string& host, int port, int timeoutMs) override;
    bool isOpen() const override { return fd_ >= 0; }
    void close() override;
    bool peerClosed() override { return fd_ < 0; }
    size_t discardInput() override;
    // One datagram with all `n` bytes.
    bool writeAll(const uint8_t* data, size_t n, int timeoutMs) override;
    // One datagram (cut to `max`).
    ReadResult read(uint8_t* buf, size_t max, int timeoutMs) override;
    void interrupt() override;
    void clearInterrupt() override;
    uint64_t bytesSent() const override { return sent_.load(); }
    uint64_t bytesReceived() const override { return received_.load(); }

   private:
    int waitFor(short events, int timeoutMs);

    int fd_ = -1;
    int wake_[2] = {-1, -1};
    std::atomic<bool> interrupted_{false};
    std::atomic<uint64_t> sent_{0};
    std::atomic<uint64_t> received_{0};
};

}  // namespace mat::drv
