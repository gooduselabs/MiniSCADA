#include "tools/mqtt-sim/broker.hpp"

#include <arpa/inet.h>
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/ecp.h>
#include <mbedtls/entropy.h>
#include <mbedtls/pk.h>
#include <mbedtls/ssl.h>
#include <mbedtls/x509_crt.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <psa/crypto.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>

#include "drivers/mqtt/address.hpp"
#include "drivers/mqtt/link.hpp"

namespace mat::mqttsim {

struct Broker::TlsShared {
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context drbg;
    mbedtls_ssl_config conf;
    mbedtls_x509_crt crt;
    mbedtls_pk_context key;
    TlsShared() {
        mbedtls_entropy_init(&entropy);
        mbedtls_ctr_drbg_init(&drbg);
        mbedtls_ssl_config_init(&conf);
        mbedtls_x509_crt_init(&crt);
        mbedtls_pk_init(&key);
    }
    ~TlsShared() {
        mbedtls_ssl_config_free(&conf);
        mbedtls_x509_crt_free(&crt);
        mbedtls_pk_free(&key);
        mbedtls_ctr_drbg_free(&drbg);
        mbedtls_entropy_free(&entropy);
    }
};

struct Broker::Client {
    int fd = -1;
    bool tls = false;
    mbedtls_ssl_context ssl;
    std::mutex writeMu;
    std::atomic<bool> closed{false};
    bool disconnected = false;  // sent DISCONNECT
    bool connected = false;
    mqtt::ConnectOptions connect;
    std::vector<std::pair<std::string, int>> subs;
    uint16_t nextId = 0;
    Client() { mbedtls_ssl_init(&ssl); }
    ~Client() {
        mbedtls_ssl_free(&ssl);
        if (fd >= 0) ::close(fd);
    }
    bool write(const std::vector<uint8_t>& b) {
        std::lock_guard<std::mutex> g(writeMu);
        if (closed) return false;
        size_t done = 0;
        while (done < b.size()) {
            const ssize_t n = tls ? mbedtls_ssl_write(&ssl, b.data() + done, b.size() - done)
                                  : ::send(fd, b.data() + done, b.size() - done, MSG_NOSIGNAL);
            if (tls && (n == MBEDTLS_ERR_SSL_WANT_READ || n == MBEDTLS_ERR_SSL_WANT_WRITE))
                continue;
            if (n <= 0) return false;
            done += static_cast<size_t>(n);
        }
        return true;
    }
    // >0 bytes, 0 nothing within the slice, -1 closed or failed
    int read(uint8_t* buf, size_t max) {
        if (tls) {
            // One Mbed TLS context must not be read and written at once (route() writes from other
            // threads): wait for bytes without the lock, then read under it.
            if (mbedtls_ssl_get_bytes_avail(&ssl) == 0) {
                pollfd p{fd, POLLIN, 0};
                const int r = ::poll(&p, 1, 100);
                if (r == 0) return 0;
                if (r < 0) return errno == EINTR ? 0 : -1;
            }
            std::lock_guard<std::mutex> g(writeMu);
            const int n = mbedtls_ssl_read(&ssl, buf, max);
            if (n > 0) return n;
            if (n == MBEDTLS_ERR_SSL_TIMEOUT || n == MBEDTLS_ERR_SSL_WANT_READ ||
                n == MBEDTLS_ERR_SSL_WANT_WRITE)
                return 0;
            return -1;
        }
        pollfd p{fd, POLLIN, 0};
        const int r = ::poll(&p, 1, 100);
        if (r == 0) return 0;
        if (r < 0) return errno == EINTR ? 0 : -1;
        const ssize_t n = ::recv(fd, buf, max, 0);
        return n > 0 ? static_cast<int>(n) : -1;
    }
};

namespace {

int netSend(void* ctx, const unsigned char* buf, size_t len) {
    const int fd = *static_cast<int*>(ctx);
    const ssize_t n = ::send(fd, buf, len, MSG_NOSIGNAL);
    return n < 0 ? MBEDTLS_ERR_SSL_INTERNAL_ERROR : static_cast<int>(n);
}

int netRecvTimeout(void* ctx, unsigned char* buf, size_t len, uint32_t timeoutMs) {
    const int fd = *static_cast<int*>(ctx);
    pollfd p{fd, POLLIN, 0};
    const int r = ::poll(&p, 1, static_cast<int>(timeoutMs ? timeoutMs : 100));
    if (r == 0) return MBEDTLS_ERR_SSL_TIMEOUT;
    if (r < 0) return errno == EINTR ? MBEDTLS_ERR_SSL_TIMEOUT : MBEDTLS_ERR_SSL_INTERNAL_ERROR;
    const ssize_t n = ::recv(fd, buf, len, 0);
    if (n == 0) return MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY;
    return n < 0 ? MBEDTLS_ERR_SSL_INTERNAL_ERROR : static_cast<int>(n);
}

bool makeCert(mbedtls_ctr_drbg_context& drbg, std::string& certPem, std::string& keyPem) {
    mbedtls_pk_context key;
    mbedtls_x509write_cert crt;
    mbedtls_pk_init(&key);
    mbedtls_x509write_crt_init(&crt);
    unsigned char keyBuf[1024] = {0};
    unsigned char crtBuf[2048] = {0};
    unsigned char serial[16] = {0};
    const char* name = "CN=mat-mqtt-sim";
    bool ok = mbedtls_pk_setup(&key, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY)) == 0 &&
              mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, mbedtls_pk_ec(key),
                                  mbedtls_ctr_drbg_random, &drbg) == 0 &&
              mbedtls_ctr_drbg_random(&drbg, serial, sizeof serial) == 0;
    if (ok) {
        serial[0] &= 0x7F;
        if (serial[0] == 0) serial[0] = 1;
        mbedtls_x509write_crt_set_version(&crt, MBEDTLS_X509_CRT_VERSION_3);
        mbedtls_x509write_crt_set_md_alg(&crt, MBEDTLS_MD_SHA256);
        mbedtls_x509write_crt_set_subject_key(&crt, &key);
        mbedtls_x509write_crt_set_issuer_key(&crt, &key);
        ok = mbedtls_x509write_crt_set_subject_name(&crt, name) == 0 &&
             mbedtls_x509write_crt_set_issuer_name(&crt, name) == 0 &&
             mbedtls_x509write_crt_set_serial_raw(&crt, serial, sizeof serial) == 0 &&
             mbedtls_x509write_crt_set_basic_constraints(&crt, 1, -1) == 0 &&
             mbedtls_x509write_crt_set_validity(&crt, "20000101000000", "99991231235959") == 0 &&
             mbedtls_x509write_crt_pem(&crt, crtBuf, sizeof crtBuf, mbedtls_ctr_drbg_random,
                                       &drbg) == 0 &&
             mbedtls_pk_write_key_pem(&key, keyBuf, sizeof keyBuf) == 0;
    }
    if (ok) {
        certPem = reinterpret_cast<const char*>(crtBuf);
        keyPem = reinterpret_cast<const char*>(keyBuf);
    }
    mbedtls_x509write_crt_free(&crt);
    mbedtls_pk_free(&key);
    return ok;
}

}  // namespace

Broker::Broker(BrokerOptions o) : o_(std::move(o)) {}
Broker::~Broker() { stop(); }

bool Broker::start() {
    if (running_) return true;
    if (o_.tls && !tls_) {
        psa_crypto_init();
        tls_ = std::make_unique<TlsShared>();
        TlsShared& t = *tls_;
        static const char kPers[] = "mat-mqtt-sim";
        if (mbedtls_ctr_drbg_seed(&t.drbg, mbedtls_entropy_func, &t.entropy,
                                  reinterpret_cast<const unsigned char*>(kPers),
                                  sizeof kPers - 1) != 0 ||
            !makeCert(t.drbg, certPem_, keyPem_) ||
            mbedtls_x509_crt_parse(&t.crt, reinterpret_cast<const unsigned char*>(certPem_.c_str()),
                                   certPem_.size() + 1) != 0 ||
            mbedtls_pk_parse_key(&t.key, reinterpret_cast<const unsigned char*>(keyPem_.c_str()),
                                 keyPem_.size() + 1, nullptr, 0, mbedtls_ctr_drbg_random,
                                 &t.drbg) != 0 ||
            mbedtls_ssl_config_defaults(&t.conf, MBEDTLS_SSL_IS_SERVER,
                                        MBEDTLS_SSL_TRANSPORT_STREAM,
                                        MBEDTLS_SSL_PRESET_DEFAULT) != 0) {
            tls_.reset();
            return false;
        }
        mbedtls_ssl_conf_rng(&t.conf, mbedtls_ctr_drbg_random, &t.drbg);
        mbedtls_ssl_conf_own_cert(&t.conf, &t.crt, &t.key);
        mbedtls_ssl_conf_read_timeout(&t.conf, 100);
        certSha_ = mqtt::sha256Hex(t.crt.raw.p, t.crt.raw.len);
    }
    listenFd_ = ::socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (listenFd_ < 0) return false;
    int one = 1;
    ::setsockopt(listenFd_, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_port = htons(static_cast<uint16_t>(o_.port));
    ::inet_pton(AF_INET, o_.bind.c_str(), &a.sin_addr);
    if (::bind(listenFd_, reinterpret_cast<sockaddr*>(&a), sizeof a) != 0 ||
        ::listen(listenFd_, 16) != 0) {
        ::close(listenFd_);
        listenFd_ = -1;
        return false;
    }
    socklen_t len = sizeof a;
    ::getsockname(listenFd_, reinterpret_cast<sockaddr*>(&a), &len);
    port_ = ntohs(a.sin_port);
    o_.port = port_;  // a restart binds the same port
    running_ = true;
    acceptThread_ = std::thread([this] { acceptLoop(); });
    return true;
}

void Broker::stop() {
    if (!running_) return;
    running_ = false;
    if (listenFd_ >= 0) {
        ::shutdown(listenFd_, SHUT_RDWR);
        ::close(listenFd_);
        listenFd_ = -1;
    }
    if (acceptThread_.joinable()) acceptThread_.join();
    kickAll();
    std::vector<std::thread> ts;
    {
        std::lock_guard<std::mutex> g(mu_);
        ts.swap(threads_);
    }
    for (auto& t : ts)
        if (t.joinable()) t.join();
    std::lock_guard<std::mutex> g(mu_);
    clients_.clear();
}

void Broker::kickAll() {
    std::lock_guard<std::mutex> g(mu_);
    for (auto& c : clients_) {
        c->closed = true;
        if (c->fd >= 0) ::shutdown(c->fd, SHUT_RDWR);
    }
}

void Broker::acceptLoop() {
    while (running_) {
        pollfd p{listenFd_, POLLIN, 0};
        if (::poll(&p, 1, 100) <= 0) continue;
        const int fd = ::accept4(listenFd_, nullptr, nullptr, SOCK_CLOEXEC);
        if (fd < 0) continue;
        int one = 1;
        ::setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
        auto c = std::make_shared<Client>();
        c->fd = fd;
        std::lock_guard<std::mutex> g(mu_);
        clients_.push_back(c);
        threads_.emplace_back([this, c] { serve(c); });
    }
}

size_t Broker::clients() const {
    std::lock_guard<std::mutex> g(mu_);
    size_t n = 0;
    for (const auto& c : clients_)
        if (!c->closed && c->connected) ++n;
    return n;
}

std::vector<mqtt::Publish> Broker::received() const {
    std::lock_guard<std::mutex> g(mu_);
    return received_;
}

void Broker::clearReceived() {
    std::lock_guard<std::mutex> g(mu_);
    received_.clear();
}

mqtt::ConnectOptions Broker::lastConnect() const {
    std::lock_guard<std::mutex> g(mu_);
    return lastConnect_;
}

std::vector<std::string> Broker::subscriptions() const {
    std::lock_guard<std::mutex> g(mu_);
    return subscriptions_;
}

void Broker::publish(const std::string& topic, const std::string& payload, int qos, bool retain) {
    mqtt::Publish m;
    m.topic = topic;
    m.payload = payload;
    m.qos = qos;
    m.retain = retain;
    route(m);
}

void Broker::route(const mqtt::Publish& in) {
    std::vector<std::pair<std::shared_ptr<Client>, int>> to;
    {
        std::lock_guard<std::mutex> g(mu_);
        if (in.retain) {
            retained_.erase(
                std::remove_if(retained_.begin(), retained_.end(),
                               [&](const mqtt::Publish& r) { return r.topic == in.topic; }),
                retained_.end());
            if (!in.payload.empty()) retained_.push_back(in);
        }
        for (auto& c : clients_) {
            if (c->closed || !c->connected) continue;
            int best = -1;
            for (const auto& s : c->subs)
                if (mqtt::topicMatches(s.first, in.topic)) best = std::max(best, s.second);
            if (best >= 0) to.emplace_back(c, best);
        }
    }
    for (auto& [c, q] : to) {
        mqtt::Publish m = in;
        m.retain = false;  // live delivery (section 3.3.1.3)
        m.qos = std::min(in.qos, q);
        if (m.qos > 0) {
            std::lock_guard<std::mutex> g(c->writeMu);
            if (++c->nextId == 0) c->nextId = 1;
            m.packetId = c->nextId;
        }
        c->write(mqtt::encodePublish(m));
    }
}

void Broker::serve(std::shared_ptr<Client> c) {
    if (tls_) {
        c->tls = true;
        if (mbedtls_ssl_setup(&c->ssl, &tls_->conf) != 0) {
            c->closed = true;
            return;
        }
        mbedtls_ssl_set_bio(&c->ssl, &c->fd, netSend, nullptr, netRecvTimeout);
        int rc = 0;
        int rounds = 0;
        while ((rc = mbedtls_ssl_handshake(&c->ssl)) != 0) {
            if ((rc == MBEDTLS_ERR_SSL_WANT_READ || rc == MBEDTLS_ERR_SSL_WANT_WRITE ||
                 rc == MBEDTLS_ERR_SSL_TIMEOUT) &&
                running_ && !c->closed && ++rounds < 100)
                continue;
            c->closed = true;
            return;
        }
    }
    mqtt::Framer framer;
    uint8_t buf[4096];
    while (running_ && !c->closed) {
        const int n = c->read(buf, sizeof buf);
        if (n < 0) break;
        if (n == 0) continue;
        framer.feed(buf, static_cast<size_t>(n));
        mqtt::Packet p;
        bool bad = false;
        while (!bad) {
            const auto r = framer.next(p);
            if (r == mqtt::Framer::Result::Need) break;
            if (r == mqtt::Framer::Result::Error) {
                bad = true;
                break;
            }
            if (!c->connected) {
                mqtt::ConnectOptions o;
                if (p.type != mqtt::PacketType::Connect || !mqtt::parseConnect(p, o)) {
                    bad = true;
                    break;
                }
                connects_++;
                {
                    std::lock_guard<std::mutex> g(mu_);
                    lastConnect_ = o;
                }
                mqtt::Connack ack;
                if (!o_.username.empty() &&
                    (!o.hasUsername || o.username != o_.username || o.password != o_.password))
                    ack.returnCode = 5;
                c->write(mqtt::encodeConnack(ack));
                if (ack.returnCode != 0) {
                    bad = true;
                    break;
                }
                c->connect = o;
                c->connected = true;
                continue;
            }
            switch (p.type) {
                case mqtt::PacketType::Subscribe: {
                    mqtt::Subscribe s;
                    if (!mqtt::parseSubscribe(p, s)) {
                        bad = true;
                        break;
                    }
                    std::vector<uint8_t> codes;
                    std::vector<mqtt::Publish> keep;
                    {
                        std::lock_guard<std::mutex> g(mu_);
                        for (const auto& f : s.filters) {
                            subscriptions_.push_back(f.first);
                            if (!o_.denyPrefix.empty() && f.first.rfind(o_.denyPrefix, 0) == 0) {
                                codes.push_back(0x80);
                                continue;
                            }
                            const int q = std::min(f.second, 1);
                            codes.push_back(static_cast<uint8_t>(q));
                            c->subs.emplace_back(f.first, q);
                            for (const auto& r : retained_)
                                if (mqtt::topicMatches(f.first, r.topic)) keep.push_back(r);
                        }
                    }
                    c->write(mqtt::encodeSuback(s.packetId, codes));
                    for (auto m : keep) {
                        m.qos = 0;
                        m.retain = true;
                        c->write(mqtt::encodePublish(m));
                    }
                    break;
                }
                case mqtt::PacketType::Publish: {
                    mqtt::Publish m;
                    if (!mqtt::parsePublish(p, m)) {
                        bad = true;
                        break;
                    }
                    {
                        std::lock_guard<std::mutex> g(mu_);
                        received_.push_back(m);
                    }
                    if (m.qos == 1 && ackPublish_) c->write(mqtt::encodePuback(m.packetId));
                    route(m);
                    break;
                }
                case mqtt::PacketType::Pingreq:
                    c->write(mqtt::encodePingresp());
                    break;
                case mqtt::PacketType::Disconnect:
                    c->disconnected = true;
                    c->closed = true;
                    break;
                default:
                    break;  // PUBACK of a delivery, others
            }
        }
        if (bad) break;
    }
    const bool will = c->connected && !c->disconnected && c->connect.hasWill;
    {
        std::lock_guard<std::mutex> g(c->writeMu);
        c->closed = true;
    }
    if (c->fd >= 0) ::shutdown(c->fd, SHUT_RDWR);
    if (will && running_) {
        mqtt::Publish m;
        m.topic = c->connect.willTopic;
        m.payload = c->connect.willPayload;
        m.qos = c->connect.willQos;
        m.retain = c->connect.willRetain;
        {
            std::lock_guard<std::mutex> g(mu_);
            received_.push_back(m);  // a will counts as a message of that client
        }
        route(m);
    }
}

}  // namespace mat::mqttsim
