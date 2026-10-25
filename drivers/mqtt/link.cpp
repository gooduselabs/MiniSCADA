#include "drivers/mqtt/link.hpp"

#include <mbedtls/ctr_drbg.h>
#include <mbedtls/entropy.h>
#include <mbedtls/sha256.h>
#include <mbedtls/ssl.h>
#include <mbedtls/x509_crt.h>
#include <psa/crypto.h>

#include <chrono>

namespace mat::mqtt {

struct Link::Tls {
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context drbg;
    mbedtls_ssl_config conf;
    mbedtls_ssl_context ssl;
    mbedtls_x509_crt ca;
    bool haveCa = false;
    Tls() {
        mbedtls_entropy_init(&entropy);
        mbedtls_ctr_drbg_init(&drbg);
        mbedtls_ssl_config_init(&conf);
        mbedtls_ssl_init(&ssl);
        mbedtls_x509_crt_init(&ca);
    }
    ~Tls() {
        mbedtls_ssl_free(&ssl);
        mbedtls_ssl_config_free(&conf);
        mbedtls_x509_crt_free(&ca);
        mbedtls_ctr_drbg_free(&drbg);
        mbedtls_entropy_free(&entropy);
    }
};

namespace {

int sendCb(void* ctx, const unsigned char* buf, size_t len) {
    auto* link = static_cast<Link*>(ctx);
    if (!link->tcp().writeAll(buf, len, link->ioTimeoutMs)) return MBEDTLS_ERR_SSL_INTERNAL_ERROR;
    return static_cast<int>(len);
}

int recvTimeoutCb(void* ctx, unsigned char* buf, size_t len, uint32_t timeoutMs) {
    auto* link = static_cast<Link*>(ctx);
    const drv::ReadResult r = link->tcp().read(buf, len, static_cast<int>(timeoutMs));
    switch (r.code) {
        case drv::ReadCode::Data:
            return static_cast<int>(r.n);
        case drv::ReadCode::Timeout:
            return MBEDTLS_ERR_SSL_TIMEOUT;
        case drv::ReadCode::Interrupted:
            return MBEDTLS_ERR_SSL_WANT_READ;
        case drv::ReadCode::Closed:
            return MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY;
        default:
            return MBEDTLS_ERR_SSL_INTERNAL_ERROR;
    }
}

const char* connectName(drv::ConnectCode c) {
    switch (c) {
        case drv::ConnectCode::Refused:
            return "REFUSED";
        case drv::ConnectCode::Timeout:
            return "TIMEOUT";
        case drv::ConnectCode::Unreachable:
            return "UNREACHABLE";
        case drv::ConnectCode::Dns:
            return "DNS";
        case drv::ConnectCode::Interrupted:
            return "INTERRUPTED";
        default:
            return "ERROR";
    }
}

int64_t monoMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

}  // namespace

std::string sha256Hex(const uint8_t* der, size_t n) {
    unsigned char h[32];
    mbedtls_sha256(der, n, h, 0);
    static const char* const kHex = "0123456789abcdef";
    std::string s;
    for (unsigned char c : h) {
        s.push_back(kHex[c >> 4]);
        s.push_back(kHex[c & 15]);
    }
    return s;
}

Link::Link() = default;
Link::~Link() { close(); }

void Link::close() {
    if (tls_ && tcp_.isOpen()) mbedtls_ssl_close_notify(&tls_->ssl);
    tls_.reset();
    tcp_.close();
}

std::string Link::open(const std::string& host, int port, int timeoutMs, const TlsOptions& tls) {
    close();
    peerSha_.clear();
    const drv::ConnectCode c = tcp_.connect(host, port, timeoutMs);
    if (c != drv::ConnectCode::Ok) return connectName(c);
    if (!tls.enabled) return "";
    if (tls.serverCertSha256.empty() && tls.caCertPem.empty()) {
        tcp_.close();
        return "MQTT_CERT_UNTRUSTED";
    }
    psa_crypto_init();  // TLS 1.3 needs PSA Crypto; a second call does nothing
    tls_ = std::make_unique<Tls>();
    Tls& t = *tls_;
    auto failed = [this](const char* code) {
        tls_.reset();
        tcp_.close();
        return std::string(code);
    };
    static const char kPers[] = "mat-mqtt";
    if (mbedtls_ctr_drbg_seed(&t.drbg, mbedtls_entropy_func, &t.entropy,
                              reinterpret_cast<const unsigned char*>(kPers), sizeof kPers - 1) != 0)
        return failed("MQTT_TLS_FAILED");
    if (mbedtls_ssl_config_defaults(&t.conf, MBEDTLS_SSL_IS_CLIENT, MBEDTLS_SSL_TRANSPORT_STREAM,
                                    MBEDTLS_SSL_PRESET_DEFAULT) != 0)
        return failed("MQTT_TLS_FAILED");
    mbedtls_ssl_conf_rng(&t.conf, mbedtls_ctr_drbg_random, &t.drbg);
    if (!tls.caCertPem.empty()) {
        const std::string pem = tls.caCertPem;
        if (mbedtls_x509_crt_parse(&t.ca, reinterpret_cast<const unsigned char*>(pem.c_str()),
                                   pem.size() + 1) != 0)
            return failed("MQTT_CERT_UNTRUSTED");
        t.haveCa = true;
        mbedtls_ssl_conf_ca_chain(&t.conf, &t.ca, nullptr);
    }
    // The handshake goes on whatever the chain says; the decision is taken below (pin or CA).
    mbedtls_ssl_conf_authmode(&t.conf, MBEDTLS_SSL_VERIFY_OPTIONAL);
    mbedtls_ssl_conf_read_timeout(&t.conf, static_cast<uint32_t>(timeoutMs));
    if (mbedtls_ssl_setup(&t.ssl, &t.conf) != 0) return failed("MQTT_TLS_FAILED");
    const std::string name = tls.serverName.empty() ? host : tls.serverName;
    if (mbedtls_ssl_set_hostname(&t.ssl, name.c_str()) != 0) return failed("MQTT_TLS_FAILED");
    mbedtls_ssl_set_bio(&t.ssl, this, sendCb, nullptr, recvTimeoutCb);
    ioTimeoutMs = timeoutMs;
    const int64_t deadline = monoMs() + timeoutMs;
    int rc = 0;
    while ((rc = mbedtls_ssl_handshake(&t.ssl)) != 0) {
        if ((rc == MBEDTLS_ERR_SSL_WANT_READ || rc == MBEDTLS_ERR_SSL_WANT_WRITE) &&
            monoMs() < deadline)
            continue;
        return failed("MQTT_TLS_FAILED");
    }
    const mbedtls_x509_crt* peer = mbedtls_ssl_get_peer_cert(&t.ssl);
    if (!peer) return failed("MQTT_CERT_UNTRUSTED");
    peerSha_ = sha256Hex(peer->raw.p, peer->raw.len);
    if (!tls.serverCertSha256.empty()) {
        if (peerSha_ != tls.serverCertSha256) return failed("MQTT_CERT_UNTRUSTED");
    } else if (mbedtls_ssl_get_verify_result(&t.ssl) != 0) {
        return failed("MQTT_CERT_UNTRUSTED");
    }
    return "";
}

bool Link::writeAll(const uint8_t* data, size_t n, int timeoutMs) {
    if (!tls_) return tcp_.writeAll(data, n, timeoutMs);
    ioTimeoutMs = timeoutMs;
    size_t done = 0;
    while (done < n) {
        const int rc = mbedtls_ssl_write(&tls_->ssl, data + done, n - done);
        if (rc == MBEDTLS_ERR_SSL_WANT_READ || rc == MBEDTLS_ERR_SSL_WANT_WRITE) continue;
        if (rc <= 0) return false;
        done += static_cast<size_t>(rc);
    }
    return true;
}

drv::ReadResult Link::read(uint8_t* buf, size_t max, int timeoutMs) {
    if (!tls_) return tcp_.read(buf, max, timeoutMs);
    drv::ReadResult r;
    // Bytes already decrypted come first; otherwise one wait of at most timeoutMs.
    mbedtls_ssl_conf_read_timeout(&tls_->conf,
                                  static_cast<uint32_t>(timeoutMs > 0 ? timeoutMs : 1));
    const int rc = mbedtls_ssl_read(&tls_->ssl, buf, max);
    if (rc > 0) {
        r.code = drv::ReadCode::Data;
        r.n = static_cast<size_t>(rc);
    } else if (rc == MBEDTLS_ERR_SSL_TIMEOUT || rc == MBEDTLS_ERR_SSL_WANT_READ ||
               rc == MBEDTLS_ERR_SSL_WANT_WRITE ||
               rc == MBEDTLS_ERR_SSL_RECEIVED_NEW_SESSION_TICKET) {
        r.code = drv::ReadCode::Timeout;
    } else if (rc == 0 || rc == MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY) {
        r.code = drv::ReadCode::Closed;
    } else {
        r.code = drv::ReadCode::Error;
    }
    return r;
}

}  // namespace mat::mqtt
