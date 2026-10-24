// UDP transport of FINS/UDP (feature 018, spec FR-002). A connected UDP socket: only datagrams of
// the PLC are received, one read() gives one datagram. Every wait is a poll() on the socket and a
// self-pipe, as TcpSocket, so a time limit holds and interrupt() ends it at once. Close-on-exec.
//
// `localPort` 0 takes a port the system picks (the PLC answers to the port the command came from:
// CJ1W-ETN21, CJ2, CP1L-E); 9600 for units that answer to the FINS port only.
#pragma once
#include <atomic>
#include <cstdint>
#include <string>

#include "drivers/sdk/transport.hpp"

namespace mat::fins {

class UdpLink : public drv::Transport {
   public:
    explicit UdpLink(int localPort = 0);
    ~UdpLink() override;
    UdpLink(const UdpLink&) = delete;
    UdpLink& operator=(const UdpLink&) = delete;

    // Resolves `host` (IPv4: a FINS node is derived from the address), opens the socket and
    // connects it; no packet is sent. PortBusy: `localPort` is taken.
    drv::ConnectCode connect(const std::string& host, int port, int timeoutMs) override;
    bool isOpen() const override { return fd_ >= 0; }
    void close() override;
    bool peerClosed() override { return fd_ < 0; }
    size_t discardInput() override;
    bool writeAll(const uint8_t* data, size_t n, int timeoutMs) override;
    // One datagram (cut to `max`). An ICMP "port unreachable" of an earlier datagram is Closed.
    drv::ReadResult read(uint8_t* buf, size_t max, int timeoutMs) override;
    void interrupt() override;
    void clearInterrupt() override;
    uint64_t bytesSent() const override { return sent_.load(); }
    uint64_t bytesReceived() const override { return received_.load(); }

    // The last byte of the local and of the PLC's IPv4 address once connected (the FINS node of the
    // "automatic generation" address conversion); 0 before or for IPv6.
    uint8_t localNode() const { return localNode_; }
    uint8_t peerNode() const { return peerNode_; }

   private:
    int waitFor(short events, int timeoutMs);

    int localPort_ = 0;
    int fd_ = -1;
    int wake_[2] = {-1, -1};
    uint8_t localNode_ = 0;
    uint8_t peerNode_ = 0;
    std::atomic<bool> interrupted_{false};
    std::atomic<uint64_t> sent_{0};
    std::atomic<uint64_t> received_{0};
};

}  // namespace mat::fins
