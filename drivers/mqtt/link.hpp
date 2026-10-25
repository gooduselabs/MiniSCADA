// The byte link of an MQTT channel (feature 022): a TCP connection (drivers/sdk/tcp_socket) and,
// with TLS, an Mbed TLS client session over it (TLS 1.2/1.3, the suites of
// third_party/mbedtls-config). The broker is trusted by the SHA-256 of its certificate (DER of the
// leaf, lower-case hex) or by a CA in PEM; without either the link never opens.
#pragma once
#include <cstdint>
#include <memory>
#include <string>

#include "drivers/sdk/tcp_socket.hpp"

namespace mat::mqtt {

struct TlsOptions {
    bool enabled = false;
    std::string serverCertSha256;  // the pin, "" none
    std::string caCertPem;         // "" none
    std::string serverName;        // SNI and the name checked against a CA; "" the host
};

class Link {
   public:
    Link();
    ~Link();
    Link(const Link&) = delete;
    Link& operator=(const Link&) = delete;

    // "" connected; otherwise REFUSED, TIMEOUT, UNREACHABLE, DNS, INTERRUPTED, ERROR (TCP),
    // MQTT_TLS_FAILED (handshake), MQTT_CERT_UNTRUSTED (pin or CA check).
    std::string open(const std::string& host, int port, int timeoutMs, const TlsOptions& tls);
    void close();
    bool isOpen() const { return tcp_.isOpen(); }
    bool writeAll(const uint8_t* data, size_t n, int timeoutMs);
    drv::ReadResult read(uint8_t* buf, size_t max, int timeoutMs);
    void interrupt() { tcp_.interrupt(); }
    void clearInterrupt() { tcp_.clearInterrupt(); }
    // The SHA-256 of the certificate the broker showed in the last handshake ("" none).
    const std::string& peerCertSha256() const { return peerSha_; }
    uint64_t bytesSent() const { return tcp_.bytesSent(); }
    uint64_t bytesReceived() const { return tcp_.bytesReceived(); }

    // Used by the Mbed TLS I/O callbacks.
    drv::TcpSocket& tcp() { return tcp_; }
    int ioTimeoutMs = 5000;

   private:
    struct Tls;
    drv::TcpSocket tcp_;
    std::unique_ptr<Tls> tls_;
    std::string peerSha_;
};

// Lower-case hex SHA-256 of `der`.
std::string sha256Hex(const uint8_t* der, size_t n);

}  // namespace mat::mqtt
