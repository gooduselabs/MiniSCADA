#include "core/notify/smtp_client.hpp"

#include <arpa/inet.h>
#include <fcntl.h>
#include <mbedtls/base64.h>
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/entropy.h>
#include <mbedtls/error.h>
#include <mbedtls/net_sockets.h>
#include <mbedtls/sha256.h>
#include <mbedtls/ssl.h>
#include <mbedtls/x509_crt.h>
#include <netdb.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <psa/crypto.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cctype>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <memory>

namespace mat::notify {

SmtpOptions smtpOptionsOf(const SmtpSettings& s, const std::string& password) {
    SmtpOptions o;
    o.host = s.host;
    o.port = s.port;
    o.security = s.security;
    o.username = s.username;
    o.password = password;
    o.auth = s.auth;
    o.caFile = s.caFile;
    o.pinSha256 = s.pinSha256;
    o.timeoutMs = s.timeoutS * 1000;
    return o;
}

namespace {

int64_t nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

void wipe(std::string& s) {
    volatile char* p = s.empty() ? nullptr : &s[0];
    for (size_t i = 0; i < s.size(); ++i) p[i] = 0;
    s.clear();
}

std::string b64(const std::string& in) {
    size_t n = 0;
    mbedtls_base64_encode(nullptr, 0, &n, reinterpret_cast<const unsigned char*>(in.data()),
                          in.size());
    std::string out(n, '\0');
    if (mbedtls_base64_encode(reinterpret_cast<unsigned char*>(&out[0]), out.size(), &n,
                              reinterpret_cast<const unsigned char*>(in.data()), in.size()) != 0)
        return {};
    out.resize(n);
    return out;
}

std::string hexOf(const unsigned char* p, size_t n) {
    static const char k[] = "0123456789abcdef";
    std::string s;
    for (size_t i = 0; i < n; ++i) {
        s += k[p[i] >> 4];
        s += k[p[i] & 15];
    }
    return s;
}

// The server's words, cut and without control characters, for the page and the audit.
std::string serverText(const std::string& s) {
    std::string o;
    for (unsigned char c : s) {
        if (o.size() >= 200) break;
        o += (c < 0x20 || c == 0x7f) ? ' ' : static_cast<char>(c);
    }
    return o;
}

bool safeAddress(const std::string& a) {
    if (a.empty() || a.size() > 254) return false;
    for (unsigned char c : a)
        if (c <= 0x20 || c >= 0x7f || c == '<' || c == '>') return false;
    return true;
}

struct Conn {
    int fd = -1;
    int64_t deadline = 0;
    int timeoutMs = 20000;
    bool tls = false;
    bool timedOut = false;
    mbedtls_ssl_context ssl;
    mbedtls_ssl_config conf;
    mbedtls_x509_crt ca;
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context drbg;
    std::string buf;  // received, not yet consumed

    Conn() {
        mbedtls_ssl_init(&ssl);
        mbedtls_ssl_config_init(&conf);
        mbedtls_x509_crt_init(&ca);
        mbedtls_entropy_init(&entropy);
        mbedtls_ctr_drbg_init(&drbg);
    }
    ~Conn() {
        if (tls) mbedtls_ssl_close_notify(&ssl);
        mbedtls_ssl_free(&ssl);
        mbedtls_ssl_config_free(&conf);
        mbedtls_x509_crt_free(&ca);
        mbedtls_ctr_drbg_free(&drbg);
        mbedtls_entropy_free(&entropy);
        if (fd >= 0) ::close(fd);
    }
    Conn(const Conn&) = delete;
    Conn& operator=(const Conn&) = delete;

    void step() { deadline = nowMs() + timeoutMs; }
    int remaining() const {
        const int64_t r = deadline - nowMs();
        return r < 0 ? 0 : static_cast<int>(r);
    }
    // Raw socket I/O with the step deadline; also the BIO of Mbed TLS.
    static int rawSend(void* ctx, const unsigned char* p, size_t n) {
        Conn* c = static_cast<Conn*>(ctx);
        pollfd pf{c->fd, POLLOUT, 0};
        const int r = ::poll(&pf, 1, c->remaining());
        if (r == 0) {
            c->timedOut = true;
            return MBEDTLS_ERR_SSL_TIMEOUT;
        }
        if (r < 0) return errno == EINTR ? MBEDTLS_ERR_SSL_WANT_WRITE : MBEDTLS_ERR_NET_SEND_FAILED;
        const ssize_t w = ::send(c->fd, p, n, MSG_NOSIGNAL);
        if (w < 0)
            return errno == EINTR || errno == EAGAIN ? MBEDTLS_ERR_SSL_WANT_WRITE
                                                     : MBEDTLS_ERR_NET_SEND_FAILED;
        return static_cast<int>(w);
    }
    static int rawRecv(void* ctx, unsigned char* p, size_t n) {
        Conn* c = static_cast<Conn*>(ctx);
        pollfd pf{c->fd, POLLIN, 0};
        const int r = ::poll(&pf, 1, c->remaining());
        if (r == 0) {
            c->timedOut = true;
            return MBEDTLS_ERR_SSL_TIMEOUT;
        }
        if (r < 0) return errno == EINTR ? MBEDTLS_ERR_SSL_WANT_READ : MBEDTLS_ERR_NET_RECV_FAILED;
        const ssize_t got = ::recv(c->fd, p, n, 0);
        if (got < 0)
            return errno == EINTR || errno == EAGAIN ? MBEDTLS_ERR_SSL_WANT_READ
                                                     : MBEDTLS_ERR_NET_RECV_FAILED;
        return static_cast<int>(got);  // 0: closed
    }

    bool sendAll(const std::string& s) {
        size_t at = 0;
        while (at < s.size()) {
            const auto* p = reinterpret_cast<const unsigned char*>(s.data()) + at;
            const int w =
                tls ? mbedtls_ssl_write(&ssl, p, s.size() - at) : rawSend(this, p, s.size() - at);
            if (w == MBEDTLS_ERR_SSL_WANT_WRITE || w == MBEDTLS_ERR_SSL_WANT_READ) continue;
            if (w <= 0) return false;
            at += static_cast<size_t>(w);
        }
        return true;
    }
    // One more chunk into buf; false on EOF, error or timeout.
    bool fill() {
        unsigned char tmp[2048];
        for (;;) {
            const int r =
                tls ? mbedtls_ssl_read(&ssl, tmp, sizeof tmp) : rawRecv(this, tmp, sizeof tmp);
            if (r == MBEDTLS_ERR_SSL_WANT_READ || r == MBEDTLS_ERR_SSL_WANT_WRITE) continue;
#if defined(MBEDTLS_ERR_SSL_RECEIVED_NEW_SESSION_TICKET)
            if (r == MBEDTLS_ERR_SSL_RECEIVED_NEW_SESSION_TICKET) continue;
#endif
            if (r <= 0) return false;
            buf.append(reinterpret_cast<char*>(tmp), static_cast<size_t>(r));
            return true;
        }
    }
    bool readLine(std::string& line) {
        for (;;) {
            const size_t nl = buf.find('\n');
            if (nl != std::string::npos) {
                line = buf.substr(0, nl);
                buf.erase(0, nl + 1);
                if (!line.empty() && line.back() == '\r') line.pop_back();
                return true;
            }
            if (buf.size() > 4096) return false;
            if (!fill()) return false;
        }
    }
};

struct Reply {
    int code = 0;
    std::vector<std::string> lines;  // text after "ddd-" / "ddd "
    std::string text() const {
        std::string s;
        for (const auto& l : lines) s += (s.empty() ? "" : " ") + l;
        return s;
    }
};

class Session {
   public:
    Session(const SmtpOptions& o, SmtpResult& r) : o_(o), r_(r) { c_.timeoutMs = o.timeoutMs; }

    bool fail(const char* stage, const char* error, const std::string& message, int code = 0,
              bool permanent = false) {
        r_.ok = false;
        r_.stage = stage;
        r_.error = c_.timedOut ? "TIMEOUT" : error;
        r_.code = code;
        r_.permanent = permanent;
        r_.message =
            c_.timedOut ? std::string("Hết thời gian chờ máy chủ SMTP (") + stage + ")." : message;
        return false;
    }

    bool reply(Reply& rp) {
        rp = Reply{};
        c_.step();
        for (int n = 0; n < 100; ++n) {
            std::string l;
            if (!c_.readLine(l)) return false;
            if (l.size() < 3 || !isdigit(static_cast<unsigned char>(l[0])) ||
                !isdigit(static_cast<unsigned char>(l[1])) ||
                !isdigit(static_cast<unsigned char>(l[2])) ||
                (l.size() > 3 && l[3] != ' ' && l[3] != '-'))
                return false;
            const int code = std::stoi(l.substr(0, 3));
            if (rp.code && code != rp.code) return false;
            rp.code = code;
            rp.lines.push_back(l.size() > 4 ? l.substr(4) : "");
            if (l.size() == 3 || l[3] == ' ') return true;
        }
        return false;
    }
    bool command(const std::string& line, Reply& rp) {
        c_.step();
        if (!c_.sendAll(line + "\r\n")) return false;
        return reply(rp);
    }

    bool connect() {
        addrinfo hints{};
        hints.ai_family = AF_UNSPEC;
        hints.ai_socktype = SOCK_STREAM;
        addrinfo* res = nullptr;
        const std::string port = std::to_string(o_.port);
        if (::getaddrinfo(o_.host.c_str(), port.c_str(), &hints, &res) != 0 || !res)
            return fail("connect", "DNS", "Không phân giải được tên máy chủ SMTP " + o_.host + ".");
        std::unique_ptr<addrinfo, void (*)(addrinfo*)> hold(res, ::freeaddrinfo);
        for (addrinfo* a = res; a; a = a->ai_next) {
            const int fd = ::socket(a->ai_family, a->ai_socktype | SOCK_CLOEXEC, a->ai_protocol);
            if (fd < 0) continue;
            const int fl = ::fcntl(fd, F_GETFL, 0);
            ::fcntl(fd, F_SETFL, fl | O_NONBLOCK);
            int rc = ::connect(fd, a->ai_addr, a->ai_addrlen);
            if (rc != 0 && errno == EINPROGRESS) {
                pollfd pf{fd, POLLOUT, 0};
                c_.step();
                if (::poll(&pf, 1, c_.remaining()) == 1) {
                    int err = 0;
                    socklen_t len = sizeof err;
                    ::getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &len);
                    rc = err == 0 ? 0 : -1;
                } else {
                    rc = -1;
                }
            }
            if (rc == 0) {
                ::fcntl(fd, F_SETFL, fl & ~O_NONBLOCK);
                const int one = 1;
                ::setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
                c_.fd = fd;
                return true;
            }
            ::close(fd);
        }
        return fail("connect", "CONNECT",
                    "Không kết nối được " + o_.host + ":" + port + " (mạng, tường lửa, cổng).");
    }

    bool startTls() {
        psa_crypto_init();
        static const char kPers[] = "mat-smtp";
        if (mbedtls_ctr_drbg_seed(&c_.drbg, mbedtls_entropy_func, &c_.entropy,
                                  reinterpret_cast<const unsigned char*>(kPers),
                                  sizeof kPers) != 0 ||
            mbedtls_ssl_config_defaults(&c_.conf, MBEDTLS_SSL_IS_CLIENT,
                                        MBEDTLS_SSL_TRANSPORT_STREAM,
                                        MBEDTLS_SSL_PRESET_DEFAULT) != 0)
            return fail("tls", "TLS", "Không khởi tạo được TLS.");
        mbedtls_ssl_conf_rng(&c_.conf, mbedtls_ctr_drbg_random, &c_.drbg);
        const bool pinned = !o_.pinSha256.empty();
        if (pinned) {
            mbedtls_ssl_conf_authmode(&c_.conf, MBEDTLS_SSL_VERIFY_NONE);
        } else {
            int rc = 0;
            if (!o_.caPem.empty())
                rc = mbedtls_x509_crt_parse(
                    &c_.ca, reinterpret_cast<const unsigned char*>(o_.caPem.c_str()),
                    o_.caPem.size() + 1);
            else
                rc = mbedtls_x509_crt_parse_file(
                    &c_.ca, (o_.caFile.empty() ? kDefaultCaFile : o_.caFile).c_str());
            // A bundle with a few certificates Mbed TLS cannot read still gives the others (rc >
            // 0).
            if (rc < 0 || c_.ca.version == 0)
                return fail("tls", "CA",
                            "Không đọc được chứng chỉ CA (" +
                                (o_.caFile.empty() ? std::string(kDefaultCaFile) : o_.caFile) +
                                ").");
            mbedtls_ssl_conf_authmode(&c_.conf, MBEDTLS_SSL_VERIFY_REQUIRED);
            mbedtls_ssl_conf_ca_chain(&c_.conf, &c_.ca, nullptr);
        }
        if (mbedtls_ssl_setup(&c_.ssl, &c_.conf) != 0 ||
            mbedtls_ssl_set_hostname(&c_.ssl, o_.host.c_str()) != 0)
            return fail("tls", "TLS", "Không khởi tạo được TLS.");
        mbedtls_ssl_set_bio(&c_.ssl, &c_, Conn::rawSend, Conn::rawRecv, nullptr);
        c_.step();
        int rc;
        while ((rc = mbedtls_ssl_handshake(&c_.ssl)) != 0) {
            if (rc == MBEDTLS_ERR_SSL_WANT_READ || rc == MBEDTLS_ERR_SSL_WANT_WRITE) continue;
            if (rc == MBEDTLS_ERR_X509_CERT_VERIFY_FAILED) {
                const uint32_t flags = mbedtls_ssl_get_verify_result(&c_.ssl);
                const bool name = (flags & MBEDTLS_X509_BADCERT_CN_MISMATCH) != 0;
                return fail(
                    "tls", "CERT",
                    name ? "Chứng chỉ máy chủ SMTP không đúng tên " + o_.host + "."
                         : "Chứng chỉ máy chủ SMTP không tin cậy (CA không biết hoặc tự ký). "
                           "Dùng CA đúng hoặc ghim SHA-256.");
            }
            char e[120];
            mbedtls_strerror(rc, e, sizeof e);
            return fail("tls", "TLS", std::string("Bắt tay TLS thất bại: ") + e + ".");
        }
        c_.tls = true;
        const mbedtls_x509_crt* peer = mbedtls_ssl_get_peer_cert(&c_.ssl);
        if (peer) {
            unsigned char h[32];
            mbedtls_sha256(peer->raw.p, peer->raw.len, h, 0);
            r_.peerSha256 = hexOf(h, sizeof h);
        }
        if (pinned && r_.peerSha256 != o_.pinSha256)
            return fail("tls", "PIN",
                        "SHA-256 chứng chỉ máy chủ (" + r_.peerSha256 + ") khác giá trị đã ghim.");
        return true;
    }

    bool ehlo(std::vector<std::string>& ext) {
        Reply rp;
        if (!command("EHLO " + o_.heloName, rp))
            return fail("ehlo", "PROTOCOL", "Máy chủ SMTP không trả lời EHLO.");
        if (rp.code != 250)
            return fail("ehlo", "PROTOCOL", "EHLO bị từ chối: " + serverText(rp.text()), rp.code);
        ext.clear();
        for (size_t i = 1; i < rp.lines.size(); ++i) {
            std::string up;
            for (char ch : rp.lines[i])
                up += static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
            ext.push_back(up);
        }
        return true;
    }

    bool auth(const std::vector<std::string>& ext) {
        bool plain = false, login = false;
        for (const auto& e : ext)
            if (e.rfind("AUTH", 0) == 0 && e.size() > 4 && (e[4] == ' ' || e[4] == '=')) {
                plain = plain || e.find("PLAIN") != std::string::npos;
                login = login || e.find("LOGIN") != std::string::npos;
            }
        std::string mech = o_.auth == "plain" ? "PLAIN" : o_.auth == "login" ? "LOGIN" : "";
        if (mech.empty()) mech = plain ? "PLAIN" : login ? "LOGIN" : "";
        if (mech.empty())
            return fail("auth", "AUTH_UNSUPPORTED", "Máy chủ SMTP không hỗ trợ AUTH PLAIN/LOGIN.");
        Reply rp;
        bool sent = false;
        if (mech == "PLAIN") {
            std::string raw =
                std::string(1, '\0') + o_.username + std::string(1, '\0') + o_.password;
            std::string line = "AUTH PLAIN " + b64(raw);
            wipe(raw);
            sent = command(line, rp);
            wipe(line);
        } else {
            sent = command("AUTH LOGIN", rp) && rp.code == 334 && command(b64(o_.username), rp) &&
                   rp.code == 334;
            if (sent) {
                std::string p = b64(o_.password);
                sent = command(p, rp);
                wipe(p);
            }
        }
        if (!sent && rp.code == 0)
            return fail("auth", "PROTOCOL", "Máy chủ SMTP ngắt khi xác thực.");
        if (rp.code != 235)
            return fail(
                "auth", "AUTH",
                "Đăng nhập SMTP thất bại (sai tài khoản/mật khẩu, hoặc cần mật khẩu ứng dụng): " +
                    serverText(rp.text()),
                rp.code);
        return true;
    }

    bool run(const std::string& from, const std::vector<std::string>& to, const std::string& data) {
        if (!safeAddress(from))
            return fail("mail", "ADDRESS", "Địa chỉ gửi không hợp lệ.", 0, true);
        for (const auto& t : to)
            if (!safeAddress(t))
                return fail("rcpt", "ADDRESS", "Địa chỉ nhận không hợp lệ.", 0, true);
        if (to.empty()) return fail("rcpt", "ADDRESS", "Không có người nhận.", 0, true);
        if (!o_.username.empty() && o_.security == SmtpSecurity::None)
            return fail(
                "auth", "AUTH_INSECURE",
                "Không gửi mật khẩu SMTP qua kết nối không mã hóa: chọn STARTTLS hoặc SMTPS.");
        if (!connect()) return false;
        if (o_.security == SmtpSecurity::Smtps && !startTls()) return false;
        Reply rp;
        if (!reply(rp)) return fail("greeting", "PROTOCOL", "Máy chủ SMTP không chào (220).");
        if (rp.code != 220)
            return fail("greeting", "REFUSED", "Máy chủ SMTP từ chối: " + serverText(rp.text()),
                        rp.code);
        std::vector<std::string> ext;
        if (!ehlo(ext)) return false;
        if (o_.security == SmtpSecurity::StartTls) {
            bool has = false;
            for (const auto& e : ext) has = has || e == "STARTTLS";
            if (!has)
                return fail("starttls", "STARTTLS_UNSUPPORTED",
                            "Máy chủ SMTP không hỗ trợ STARTTLS trên cổng này (thử SMTPS 465).");
            if (!command("STARTTLS", rp) || rp.code != 220)
                return fail("starttls", "STARTTLS", "STARTTLS bị từ chối: " + serverText(rp.text()),
                            rp.code);
            // Anything the server sent after its 220 in clear text could be injected (RFC 3207 §6).
            if (!c_.buf.empty())
                return fail("starttls", "PROTOCOL", "Máy chủ gửi dữ liệu thừa sau STARTTLS.");
            if (!startTls()) return false;
            if (!ehlo(ext)) return false;
        }
        if (!o_.username.empty() && !auth(ext)) return false;
        if (!command("MAIL FROM:<" + from + ">", rp))
            return fail("mail", "PROTOCOL", "Máy chủ SMTP ngắt ở MAIL FROM.");
        if (rp.code != 250)
            return fail("mail", rp.code >= 500 ? "REJECTED" : "TEMPORARY",
                        "MAIL FROM bị từ chối: " + serverText(rp.text()), rp.code, rp.code >= 500);
        size_t accepted = 0;
        for (const auto& t : to) {
            if (!command("RCPT TO:<" + t + ">", rp))
                return fail("rcpt", "PROTOCOL", "Máy chủ SMTP ngắt ở RCPT TO.");
            if (rp.code == 250 || rp.code == 251) {
                ++accepted;
            } else if (rp.code >= 500) {
                r_.rejected.push_back(t);
            } else {
                return fail("rcpt", "TEMPORARY",
                            "RCPT TO tạm thời bị từ chối: " + serverText(rp.text()), rp.code);
            }
        }
        if (!accepted)
            return fail("rcpt", "REJECTED", "Mọi người nhận bị từ chối: " + serverText(rp.text()),
                        rp.code, true);
        if (!command("DATA", rp)) return fail("data", "PROTOCOL", "Máy chủ SMTP ngắt ở DATA.");
        if (rp.code != 354)
            return fail("data", rp.code >= 500 ? "REJECTED" : "TEMPORARY",
                        "DATA bị từ chối: " + serverText(rp.text()), rp.code, rp.code >= 500);
        c_.step();
        if (!c_.sendAll(data) || !reply(rp))
            return fail("data", "PROTOCOL", "Mất kết nối khi gửi nội dung email.");
        if (rp.code != 250)
            return fail("data", rp.code >= 500 ? "REJECTED" : "TEMPORARY",
                        "Nội dung email bị từ chối: " + serverText(rp.text()), rp.code,
                        rp.code >= 500);
        r_.ok = true;
        r_.code = 250;
        r_.stage = "done";
        r_.message = "Đã gửi.";
        command("QUIT", rp);  // best effort
        return true;
    }

   private:
    const SmtpOptions& o_;
    SmtpResult& r_;
    Conn c_;
};

}  // namespace

SmtpResult smtpSend(const SmtpOptions& o, const std::string& from,
                    const std::vector<std::string>& to, const std::string& data) {
    SmtpResult r;
    if (o.host.empty()) {
        r.stage = "connect";
        r.error = "CONFIG";
        r.message = "Chưa đặt máy chủ SMTP.";
        return r;
    }
    Session s(o, r);
    s.run(from, to, data);
    return r;
}

}  // namespace mat::notify
