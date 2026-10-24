// UDP port of a BACnet/IP channel (feature 020, spec FR-001; ADR-048). One unconnected socket per
// channel, bound to `localPort` (47808 by default) on every interface or on `bindAddress`, with
// SO_BROADCAST for Who-Is: the field devices of the channel are other IPv4 endpoints of the same
// socket, so a datagram is sent with sendto() and its sender comes with recvfrom(). Every wait is a
// poll() on the socket and a self-pipe, so a time limit holds and interrupt() ends it at once.
// Close-on-exec.
//
// Tests replace it with an in-memory DatagramPort (drivers/bacnet/tests/fake_bacnet.hpp).
#pragma once
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <string>

#include "drivers/sdk/transport.hpp"

namespace mat::bacnet {

class DatagramPort {
   public:
    virtual ~DatagramPort() = default;
    // Ok, PortBusy (the port is taken), Dns (`bindAddress` is not an IPv4 address), Error.
    virtual drv::ConnectCode open(int localPort, const std::string& bindAddress) = 0;
    virtual bool isOpen() const = 0;
    virtual void close() = 0;
    // One datagram to ip:port (host byte order); false: it could not be sent.
    virtual bool sendTo(uint32_t ip, uint16_t port, const uint8_t* data, size_t n) = 0;
    // Waits up to `timeoutMs` for one datagram (cut to `max`): Data with its sender, Timeout,
    // Interrupted, Closed (not open) or Error.
    virtual drv::ReadCode recvFrom(uint8_t* buf, size_t max, int timeoutMs, size_t& n, uint32_t& ip,
                                   uint16_t& port) = 0;
    virtual void interrupt() = 0;
    virtual void clearInterrupt() = 0;
    virtual uint64_t bytesSent() const = 0;
    virtual uint64_t bytesReceived() const = 0;
};

class UdpPort : public DatagramPort {
   public:
    UdpPort();
    ~UdpPort() override;
    UdpPort(const UdpPort&) = delete;
    UdpPort& operator=(const UdpPort&) = delete;

    drv::ConnectCode open(int localPort, const std::string& bindAddress) override;
    bool isOpen() const override { return fd_ >= 0; }
    void close() override;
    bool sendTo(uint32_t ip, uint16_t port, const uint8_t* data, size_t n) override;
    drv::ReadCode recvFrom(uint8_t* buf, size_t max, int timeoutMs, size_t& n, uint32_t& ip,
                           uint16_t& port) override;
    void interrupt() override;
    void clearInterrupt() override;
    uint64_t bytesSent() const override { return sent_.load(); }
    uint64_t bytesReceived() const override { return received_.load(); }

   private:
    int waitFor(int timeoutMs);

    int fd_ = -1;
    int wake_[2] = {-1, -1};
    std::atomic<bool> interrupted_{false};
    std::atomic<uint64_t> sent_{0};
    std::atomic<uint64_t> received_{0};
};

// An IPv4 address or a host name to an address in host byte order; false: not found.
bool resolveIpv4(const std::string& host, uint32_t& ip);
std::string ipText(uint32_t ip);

}  // namespace mat::bacnet
