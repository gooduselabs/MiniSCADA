// A fake SMTP server for the tests of feature 023: 127.0.0.1, one thread, connections one after
// the other; plain, STARTTLS or implicit TLS with a self-signed ECDSA certificate made by
// server/tls (SAN localhost and 127.0.0.1); AUTH PLAIN/LOGIN; knobs for refusals and silence.
#pragma once
#include <arpa/inet.h>
#include <mbedtls/base64.h>
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/entropy.h>
#include <mbedtls/pk.h>
#include <mbedtls/ssl.h>
#include <mbedtls/x509_crt.h>
#include <netinet/in.h>
#include <poll.h>
#include <psa/crypto.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <cerrno>
#include <cstring>
#include <fstream>
#include <mutex>
#include <set>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "server/tls/server_cert.hpp"

namespace mat::test {

struct FakeMail {
    std::string from;
    std::vector<std::string> to;
    std::string data;  // as received, dot-unstuffed, without the final "."
    std::string authUser, authPass, authMech;
    bool tls = false;
};

enum class FakeTls { None, StartTls, Implicit };

class FakeSmtp {
   public:
    // Knobs (set before start or between connections).
    FakeTls mode = FakeTls::StartTls;
    bool advertiseStartTls = true;
    std::string authMechs = "PLAIN LOGIN";  // "" = no AUTH advertised
    std::string user = "mat", pass = "s3cret-pass";
    std::set<std::string> rejectRcpt;  // 550
    int rcptTempCode = 0;              // e.g. 451 for every RCPT
    int dataCode = 250;                // reply after the message
    bool silent = false;               // accept and never answer
    bool injectAfterStartTls = false;  // send extra text right after 220 of STARTTLS

    explicit FakeSmtp(const std::string& certDir) {
        ServerCertOptions o(certDir, "fake-smtp", "localhost", {"127.0.0.1"});
        cert_ = loadOrCreateServerCert(o);
        std::ifstream f(cert_.pemPath);
        std::stringstream ss;
        ss << f.rdbuf();
        pem_ = ss.str();
        certPem_ = publicCertificatePem(pem_);
    }
    ~FakeSmtp() { stop(); }

    const std::string& certPem() const { return certPem_; }
    const std::string& fingerprint() const { return cert_.fingerprint; }
    bool certOk() const { return cert_.ok; }
    int port() const { return port_; }

    bool start() {
        fd_ = ::socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
        const int one = 1;
        ::setsockopt(fd_, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
        sockaddr_in a{};
        a.sin_family = AF_INET;
        a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        a.sin_port = htons(static_cast<uint16_t>(fixedPort_));
        if (::bind(fd_, reinterpret_cast<sockaddr*>(&a), sizeof a) != 0 || ::listen(fd_, 8) != 0)
            return false;
        socklen_t len = sizeof a;
        ::getsockname(fd_, reinterpret_cast<sockaddr*>(&a), &len);
        port_ = ntohs(a.sin_port);
        stop_ = false;
        th_ = std::thread([this] { serve(); });
        return true;
    }
    // Restart on the same port (the "network back" case).
    void setFixedPort(int p) { fixedPort_ = p; }
    void stop() {
        stop_ = true;
        if (fd_ >= 0) {
            ::shutdown(fd_, SHUT_RDWR);
            ::close(fd_);
            fd_ = -1;
        }
        if (th_.joinable()) th_.join();
    }
    std::vector<FakeMail> mails() {
        std::lock_guard<std::mutex> l(mu_);
        return mails_;
    }
    int connections() const { return connections_.load(); }

   private:
    struct Io {
        int fd = -1;
        bool tls = false;
        mbedtls_ssl_context* ssl = nullptr;
        std::string buf;
        static int sendCb(void* c, const unsigned char* p, size_t n) {
            const ssize_t w = ::send(*static_cast<int*>(c), p, n, MSG_NOSIGNAL);
            return w < 0 ? MBEDTLS_ERR_SSL_INTERNAL_ERROR : static_cast<int>(w);
        }
        static int recvCb(void* c, unsigned char* p, size_t n) {
            pollfd pf{*static_cast<int*>(c), POLLIN, 0};
            if (::poll(&pf, 1, 5000) != 1) return MBEDTLS_ERR_SSL_TIMEOUT;
            const ssize_t r = ::recv(*static_cast<int*>(c), p, n, 0);
            return r < 0 ? MBEDTLS_ERR_SSL_INTERNAL_ERROR : static_cast<int>(r);
        }
        bool write(const std::string& s) {
            size_t at = 0;
            while (at < s.size()) {
                const auto* p = reinterpret_cast<const unsigned char*>(s.data()) + at;
                const int w = tls ? mbedtls_ssl_write(ssl, p, s.size() - at)
                                  : static_cast<int>(::send(fd, p, s.size() - at, MSG_NOSIGNAL));
                if (w == MBEDTLS_ERR_SSL_WANT_WRITE) continue;
                if (w <= 0) return false;
                at += static_cast<size_t>(w);
            }
            return true;
        }
        bool line(std::string& out) {
            for (;;) {
                const size_t nl = buf.find("\r\n");
                if (nl != std::string::npos) {
                    out = buf.substr(0, nl);
                    buf.erase(0, nl + 2);
                    return true;
                }
                unsigned char tmp[4096];
                int r;
                if (tls) {
                    do
                        r = mbedtls_ssl_read(ssl, tmp, sizeof tmp);
                    while (r == MBEDTLS_ERR_SSL_WANT_READ);
                } else {
                    pollfd pf{fd, POLLIN, 0};
                    if (::poll(&pf, 1, 5000) != 1) return false;
                    r = static_cast<int>(::recv(fd, tmp, sizeof tmp, 0));
                }
                if (r <= 0) return false;
                buf.append(reinterpret_cast<char*>(tmp), static_cast<size_t>(r));
            }
        }
    };

    static std::string unb64(const std::string& s) {
        size_t n = 0;
        std::string out(s.size(), '\0');
        if (mbedtls_base64_decode(reinterpret_cast<unsigned char*>(&out[0]), out.size(), &n,
                                  reinterpret_cast<const unsigned char*>(s.data()), s.size()) != 0)
            return {};
        out.resize(n);
        return out;
    }

    void serve() {
        while (!stop_) {
            pollfd pf{fd_, POLLIN, 0};
            if (::poll(&pf, 1, 100) != 1) continue;
            const int c = ::accept4(fd_, nullptr, nullptr, SOCK_CLOEXEC);
            if (c < 0) continue;
            ++connections_;
            session(c);
            ::close(c);
        }
    }

    bool handshake(Io& io, mbedtls_ssl_context& ssl) {
        mbedtls_ssl_set_bio(&ssl, &io.fd, Io::sendCb, Io::recvCb, nullptr);
        int rc;
        while ((rc = mbedtls_ssl_handshake(&ssl)) != 0)
            if (rc != MBEDTLS_ERR_SSL_WANT_READ && rc != MBEDTLS_ERR_SSL_WANT_WRITE) return false;
        io.tls = true;
        io.ssl = &ssl;
        return true;
    }

    void session(int fd) {
        if (silent) {
            pollfd pf{fd, POLLIN, 0};
            ::poll(&pf, 1, 3000);
            return;
        }
        psa_crypto_init();
        mbedtls_ssl_context ssl;
        mbedtls_ssl_config conf;
        mbedtls_x509_crt crt;
        mbedtls_pk_context key;
        mbedtls_entropy_context ent;
        mbedtls_ctr_drbg_context drbg;
        mbedtls_ssl_init(&ssl);
        mbedtls_ssl_config_init(&conf);
        mbedtls_x509_crt_init(&crt);
        mbedtls_pk_init(&key);
        mbedtls_entropy_init(&ent);
        mbedtls_ctr_drbg_init(&drbg);
        mbedtls_ctr_drbg_seed(&drbg, mbedtls_entropy_func, &ent, nullptr, 0);
        mbedtls_x509_crt_parse(&crt, reinterpret_cast<const unsigned char*>(certPem_.c_str()),
                               certPem_.size() + 1);
        mbedtls_pk_parse_key(&key, reinterpret_cast<const unsigned char*>(pem_.c_str()),
                             pem_.size() + 1, nullptr, 0, mbedtls_ctr_drbg_random, &drbg);
        mbedtls_ssl_config_defaults(&conf, MBEDTLS_SSL_IS_SERVER, MBEDTLS_SSL_TRANSPORT_STREAM,
                                    MBEDTLS_SSL_PRESET_DEFAULT);
        mbedtls_ssl_conf_rng(&conf, mbedtls_ctr_drbg_random, &drbg);
        mbedtls_ssl_conf_own_cert(&conf, &crt, &key);
        mbedtls_ssl_setup(&ssl, &conf);

        Io io;
        io.fd = fd;
        FakeMail m;
        bool ok = true;
        if (mode == FakeTls::Implicit) ok = handshake(io, ssl);
        if (ok) dialog(io, ssl, m);
        if (io.tls) mbedtls_ssl_close_notify(&ssl);
        mbedtls_ssl_free(&ssl);
        mbedtls_ssl_config_free(&conf);
        mbedtls_x509_crt_free(&crt);
        mbedtls_pk_free(&key);
        mbedtls_ctr_drbg_free(&drbg);
        mbedtls_entropy_free(&ent);
    }

    void dialog(Io& io, mbedtls_ssl_context& ssl, FakeMail& m) {
        io.write("220 fake.example.com ESMTP\r\n");
        std::string l;
        while (io.line(l)) {
            std::string up = l.substr(0, 10);
            for (char& ch : up)
                ch = static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
            if (up.rfind("EHLO", 0) == 0) {
                std::string r = "250-fake.example.com\r\n250-8BITMIME\r\n";
                if (mode == FakeTls::StartTls && advertiseStartTls && !io.tls)
                    r += "250-STARTTLS\r\n";
                if (!authMechs.empty()) r += "250-AUTH " + authMechs + "\r\n";
                r += "250 SIZE 1000000\r\n";
                io.write(r);
            } else if (up.rfind("STARTTLS", 0) == 0) {
                io.write(injectAfterStartTls ? "220 go\r\n250 injected\r\n" : "220 go ahead\r\n");
                if (!handshake(io, ssl)) return;
                io.buf.clear();
            } else if (up.rfind("AUTH PLAIN", 0) == 0) {
                const std::string raw = unb64(l.substr(11));
                const size_t a = raw.find('\0', 1);
                m.authMech = "PLAIN";
                if (a != std::string::npos) {
                    m.authUser = raw.substr(1, a - 1);
                    m.authPass = raw.substr(a + 1);
                }
                io.write(m.authUser == user && m.authPass == pass
                             ? "235 ok\r\n"
                             : "535 5.7.8 bad credentials\r\n");
            } else if (up.rfind("AUTH LOGIN", 0) == 0) {
                m.authMech = "LOGIN";
                std::string u, p;
                io.write("334 VXNlcm5hbWU6\r\n");
                if (!io.line(u)) return;
                io.write("334 UGFzc3dvcmQ6\r\n");
                if (!io.line(p)) return;
                m.authUser = unb64(u);
                m.authPass = unb64(p);
                io.write(m.authUser == user && m.authPass == pass
                             ? "235 ok\r\n"
                             : "535 5.7.8 bad credentials\r\n");
            } else if (up.rfind("MAIL FROM", 0) == 0) {
                m.from = l.substr(l.find('<') + 1, l.find('>') - l.find('<') - 1);
                io.write("250 ok\r\n");
            } else if (up.rfind("RCPT TO", 0) == 0) {
                const std::string a = l.substr(l.find('<') + 1, l.find('>') - l.find('<') - 1);
                if (rcptTempCode) {
                    io.write(std::to_string(rcptTempCode) + " try later\r\n");
                } else if (rejectRcpt.count(a)) {
                    io.write("550 5.1.1 no such user\r\n");
                } else {
                    m.to.push_back(a);
                    io.write("250 ok\r\n");
                }
            } else if (up.rfind("DATA", 0) == 0) {
                io.write("354 go\r\n");
                std::string d, x;
                while (io.line(x)) {
                    if (x == ".") break;
                    if (!x.empty() && x[0] == '.') x.erase(0, 1);
                    d += x + "\r\n";
                }
                m.data = d;
                m.tls = io.tls;
                io.write(std::to_string(dataCode) + (dataCode == 250 ? " queued\r\n" : " no\r\n"));
                if (dataCode == 250) {
                    std::lock_guard<std::mutex> g(mu_);
                    mails_.push_back(m);
                }
            } else if (up.rfind("QUIT", 0) == 0) {
                io.write("221 bye\r\n");
                return;
            } else {
                io.write("500 unknown\r\n");
            }
        }
    }

    ServerCert cert_;
    std::string pem_, certPem_;
    int fd_ = -1, port_ = 0, fixedPort_ = 0;
    std::atomic<bool> stop_{false};
    std::atomic<int> connections_{0};
    std::thread th_;
    std::mutex mu_;
    std::vector<FakeMail> mails_;
};

}  // namespace mat::test
