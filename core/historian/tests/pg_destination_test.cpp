// PostgreSQL session against a fake server that speaks just enough of protocol 3 for libpq to log
// in, then answers the way no real test server does (review of the fixes: Important 1, minor 6).
// Skipped when libpq.so.5 is missing.
#include <arpa/inet.h>
#include <gtest/gtest.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <cstring>
#include <mutex>
#include <thread>

#include "core/historian/forward/libpq_api.hpp"
#include "core/historian/forward/sql_destination.hpp"

using namespace mat;

namespace {

class FakePg {
   public:
    enum class Mode {
        CopyIn,       // answers the first statement with CopyInResponse
        StopReading,  // never reads anything after the login
    };

    explicit FakePg(Mode mode) : mode_(mode) {
        listen_ = ::socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
        sockaddr_in a{};
        a.sin_family = AF_INET;
        a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        socklen_t n = sizeof a;
        if (::bind(listen_, reinterpret_cast<sockaddr*>(&a), n) == 0 && ::listen(listen_, 1) == 0 &&
            ::getsockname(listen_, reinterpret_cast<sockaddr*>(&a), &n) == 0)
            port_ = ntohs(a.sin_port);
        thread_ = std::thread([this] { serve(); });
    }

    ~FakePg() {
        done_ = true;
        ::shutdown(listen_, SHUT_RDWR);
        {
            std::lock_guard<std::mutex> g(mu_);
            if (conn_ >= 0) ::shutdown(conn_, SHUT_RDWR);
        }
        thread_.join();
        ::close(listen_);
        if (conn_ >= 0) ::close(conn_);
    }

    int port() const { return port_; }

   private:
    static std::string be32(uint32_t v) {
        const uint32_t n = htonl(v);
        return std::string(reinterpret_cast<const char*>(&n), 4);
    }
    static std::string message(char type, const std::string& body) {
        return std::string(1, type) + be32(static_cast<uint32_t>(4 + body.size())) + body;
    }

    bool readAll(void* p, size_t n) {
        char* c = static_cast<char*>(p);
        while (n > 0) {
            const ssize_t r = ::recv(conn_, c, n, 0);
            if (r <= 0) return false;
            c += r;
            n -= static_cast<size_t>(r);
        }
        return true;
    }
    bool writeAll(const std::string& s) {
        size_t done = 0;
        while (done < s.size()) {
            const ssize_t r = ::send(conn_, s.data() + done, s.size() - done, MSG_NOSIGNAL);
            if (r <= 0) return false;
            done += static_cast<size_t>(r);
        }
        return true;
    }
    // A startup packet (no type byte): its request code.
    bool readStartup(uint32_t& code) {
        uint32_t len = 0;
        if (!readAll(&len, 4) || ntohl(len) < 8) return false;
        std::string rest(ntohl(len) - 4, '\0');
        if (!readAll(&rest[0], rest.size())) return false;
        std::memcpy(&code, rest.data(), 4);
        code = ntohl(code);
        return true;
    }
    void waitUntilDone() {
        while (!done_) std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    void serve() {
        const int fd = ::accept(listen_, nullptr, nullptr);
        {
            std::lock_guard<std::mutex> g(mu_);
            conn_ = fd;
        }
        if (fd < 0) return;
        uint32_t code = 0;
        // SSLRequest, GSSENCRequest: "N", then the real startup packet (protocol 3.0)
        while (readStartup(code) && (code == 80877103 || code == 80877104))
            if (!writeAll("N")) return;
        if (code != 196608) return;
        const std::string hello = message('R', be32(0)) +  // AuthenticationOk
                                  message('S', std::string("server_encoding\0UTF8\0", 21)) +
                                  message('S', std::string("client_encoding\0UTF8\0", 21)) +
                                  message('Z', "I");  // ReadyForQuery, idle
        if (!writeAll(hello)) return;
        if (mode_ == Mode::CopyIn) {
            char type = 0;
            uint32_t len = 0;
            if (readAll(&type, 1) && readAll(&len, 4) && ntohl(len) >= 4) {
                std::string query(ntohl(len) - 4, '\0');
                if (readAll(&query[0], query.size()))
                    writeAll(message('G', std::string("\0\0\0", 3)));  // text, no columns
            }
        }
        waitUntilDone();
    }

    Mode mode_;
    int listen_ = -1;
    int conn_ = -1;
    int port_ = 0;
    std::mutex mu_;
    std::atomic<bool> done_{false};
    std::thread thread_;
};

bool libpqPresent() {
    std::string err;
    return capi::loadPqApi("", err) != nullptr;
}

std::unique_ptr<SqlDestination> connectTo(const FakePg& server, SqlLimits limits = {}) {
    ConnectionModel c;
    c.id = "fake";
    c.type = DbType::PostgreSql;
    c.host = "127.0.0.1";
    c.port = server.port();
    c.database = "d";
    c.schema = "public";
    c.user = "u";
    c.tls = TlsMode::Disable;
    auto d = makePgDestination(c, "", limits);
    DestError e;
    EXPECT_TRUE(d->connect("pw", e)) << errorClassCode(e.cls) << " " << e.detail;
    return d;
}

int64_t msSince(std::chrono::steady_clock::time_point t0) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() -
                                                                 t0)
        .count();
}

}  // namespace

// Important 1: libpq returns a COPY result on every PQgetResult and never NULL, without waiting
// for the socket. The call ends at once as a connection error (the forwarder closes the session)
// instead of spinning the CPU forever and blocking Historian::stop().
TEST(PgSession, ACopyAnswerEndsTheCall) {
    if (!libpqPresent()) GTEST_SKIP() << "libpq.so.5 missing";
    FakePg server(FakePg::Mode::CopyIn);
    auto d = connectTo(server);
    DestError e;
    const auto t0 = std::chrono::steady_clock::now();
    EXPECT_FALSE(d->exec("SELECT 1", e));
    EXPECT_EQ(e.cls, ErrorClass::Connect) << errorClassCode(e.cls) << " " << e.detail;
    EXPECT_LT(msSince(t0), 2000);
}

// Minor 6: the deadline also bounds sending. A server that stopped reading fills the socket
// buffers; libpq in blocking mode would wait in send() for as long as the peer acknowledges.
TEST(PgSession, AStatementTheServerDoesNotReadEndsOnTheDeadline) {
    if (!libpqPresent()) GTEST_SKIP() << "libpq.so.5 missing";
    FakePg server(FakePg::Mode::StopReading);
    SqlLimits limits;
    limits.queryTimeoutMs = 1000;
    auto d = connectTo(server, limits);
    const std::string big = "SELECT '" + std::string(32u << 20, 'x') + "'";
    DestError e;
    const auto t0 = std::chrono::steady_clock::now();
    EXPECT_FALSE(d->exec(big, e));
    EXPECT_EQ(e.cls, ErrorClass::Timeout) << errorClassCode(e.cls) << " " << e.detail;
    const int64_t ms = msSince(t0);
    EXPECT_GE(ms, 900);
    EXPECT_LT(ms, 5000);
}
