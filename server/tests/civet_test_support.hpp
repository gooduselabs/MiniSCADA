// In-process CivetWeb for x64 tests: a server on 127.0.0.1 with a random port, a plain HTTP GET,
// and a minimal WebSocket client on a raw socket, so that a test can stop reading, announce an
// oversized frame or never answer a close frame (things a real client library would not do).
#pragma once
#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <chrono>
#include <cstdint>
#include <cstring>
#include <functional>
#include <string>
#include <thread>
#include <vector>

#include "civetweb.h"

namespace mat::test {

// Waits until `done()` or the timeout; returns done().
inline bool waitFor(const std::function<bool()>& done, int timeoutMs) {
    const auto end = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
    while (!done()) {
        if (std::chrono::steady_clock::now() >= end) return done();
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    return true;
}

class TestServer {
   public:
    // `options`: extra CivetWeb options as name/value pairs.
    explicit TestServer(const std::vector<std::string>& options = {}) {
        mg_init_library(0);
        std::vector<const char*> o = {"listening_ports", "127.0.0.1:0", "num_threads", "24"};
        for (const auto& s : options) o.push_back(s.c_str());
        o.push_back(nullptr);
        mg_callbacks cb{};
        ctx = mg_start(&cb, nullptr, o.data());
        mg_server_port ports[1];
        if (ctx && mg_get_server_ports(ctx, 1, ports) == 1) port = ports[0].port;
    }
    ~TestServer() { stop(); }
    TestServer(const TestServer&) = delete;
    TestServer& operator=(const TestServer&) = delete;

    // Stops CivetWeb: close handlers run before this returns.
    void stop() {
        if (!ctx) return;
        mg_stop(ctx);
        ctx = nullptr;
        mg_exit_library();
    }

    mg_context* ctx = nullptr;
    int port = 0;
};

inline int connectLocal(int port, int rcvbuf = 0) {
    const int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    if (rcvbuf > 0) ::setsockopt(fd, SOL_SOCKET, SO_RCVBUF, &rcvbuf, sizeof rcvbuf);
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_port = htons(static_cast<uint16_t>(port));
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (::connect(fd, reinterpret_cast<sockaddr*>(&a), sizeof a) != 0) {
        ::close(fd);
        return -1;
    }
    return fd;
}

inline bool sendAll(int fd, const std::string& data) {
    size_t off = 0;
    while (off < data.size()) {
        const ssize_t n = ::send(fd, data.data() + off, data.size() - off, MSG_NOSIGNAL);
        if (n <= 0) return false;
        off += static_cast<size_t>(n);
    }
    return true;
}

// Reads up to `n` bytes before the deadline. Returns bytes read, 0 at EOF, -1 on error/timeout.
inline ssize_t recvSome(int fd, char* buf, size_t n, int timeoutMs) {
    pollfd p{fd, POLLIN, 0};
    if (::poll(&p, 1, timeoutMs) <= 0) return -1;
    return ::recv(fd, buf, n, 0);
}

struct HttpResponse {
    int status = 0;
    std::string body;
};

// GET with "Connection: close": reads until the server closes.
inline HttpResponse httpGet(int port, const std::string& path) {
    HttpResponse r;
    const int fd = connectLocal(port);
    if (fd < 0) return r;
    sendAll(fd, "GET " + path + " HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    std::string all;
    char buf[4096];
    ssize_t n;
    while ((n = recvSome(fd, buf, sizeof buf, 5000)) > 0) all.append(buf, static_cast<size_t>(n));
    ::close(fd);
    if (all.compare(0, 9, "HTTP/1.1 ") == 0) r.status = std::atoi(all.c_str() + 9);
    const size_t head = all.find("\r\n\r\n");
    if (head != std::string::npos) r.body = all.substr(head + 4);
    return r;
}

class WsClient {
   public:
    struct Frame {
        int opcode = -1;  // -1: nothing before the timeout, -2: connection closed
        std::string payload;
        int closeCode() const {
            return payload.size() >= 2 ? (static_cast<unsigned char>(payload[0]) << 8) |
                                             static_cast<unsigned char>(payload[1])
                                       : -1;
        }
    };

    ~WsClient() { close(); }

    // Opening handshake on /api/v1/live; `rcvbuf` > 0 shrinks the receive buffer (slow client).
    bool connect(int port, int rcvbuf = 0, const std::string& path = "/api/v1/live") {
        fd_ = connectLocal(port, rcvbuf);
        if (fd_ < 0) return false;
        if (!sendAll(fd_,
                     "GET " + path +
                         " HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n"
                         "Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
                         "Sec-WebSocket-Version: 13\r\n\r\n"))
            return false;
        std::string head;  // byte by byte: the first frame may follow right after the headers
        char c;
        while (head.find("\r\n\r\n") == std::string::npos)
            if (recvSome(fd_, &c, 1, 3000) != 1)
                return false;
            else
                head += c;
        return head.compare(0, 12, "HTTP/1.1 101") == 0;
    }

    // Takes over a connection whose handshake the test made by hand (extra request headers).
    void adopt(int fd) {
        close();
        fd_ = fd;
    }

    // Next frame from the server (server frames are not masked).
    Frame read(int timeoutMs) {
        Frame f;
        unsigned char h[2];
        const ssize_t got = readExact(reinterpret_cast<char*>(h), 2, timeoutMs);
        if (got == 0) f.opcode = -2;
        if (got != 2) return f;
        uint64_t len = h[1] & 0x7F;
        if (len >= 126) {
            unsigned char ext[8];
            const size_t n = len == 126 ? 2 : 8;
            if (readExact(reinterpret_cast<char*>(ext), n, timeoutMs) != static_cast<ssize_t>(n)) {
                f.opcode = -2;
                return f;
            }
            len = 0;
            for (size_t i = 0; i < n; ++i) len = (len << 8) | ext[i];
        }
        f.payload.resize(static_cast<size_t>(len));
        if (len && readExact(&f.payload[0], f.payload.size(), timeoutMs) !=
                       static_cast<ssize_t>(f.payload.size())) {
            f.opcode = -2;
            return f;
        }
        f.opcode = h[0] & 0x0F;
        return f;
    }

    // Masked text frame (any size).
    bool sendText(const std::string& s) { return sendFrame(0x1, s); }
    bool sendClose(int code) {
        std::string p;
        p.push_back(static_cast<char>((code >> 8) & 0xFF));
        p.push_back(static_cast<char>(code & 0xFF));
        return sendFrame(0x8, p);
    }
    // Only the header of a masked frame announcing `len` bytes (oversized-frame test).
    bool sendHeader(int opcode, uint64_t len) { return sendAll(fd_, header(opcode, len)); }

    // True when the server ended the connection within the timeout (data still queued is drained).
    bool closedWithin(int timeoutMs) {
        const auto end = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
        char buf[65536];
        for (;;) {
            const int left = static_cast<int>(std::chrono::duration_cast<std::chrono::milliseconds>(
                                                  end - std::chrono::steady_clock::now())
                                                  .count());
            if (left <= 0) return false;
            pollfd p{fd_, POLLIN, 0};
            if (::poll(&p, 1, left) <= 0) return false;
            if (::recv(fd_, buf, sizeof buf, 0) <= 0) return true;  // EOF or reset
        }
    }

    void close() {
        if (fd_ >= 0) ::close(fd_);
        fd_ = -1;
    }

   private:
    static std::string header(int opcode, uint64_t len) {
        std::string h;
        h.push_back(static_cast<char>(0x80 | opcode));
        if (len < 126) {
            h.push_back(static_cast<char>(0x80 | len));
        } else if (len <= 0xFFFF) {
            h.push_back(static_cast<char>(0x80 | 126));
            for (int i = 1; i >= 0; --i) h.push_back(static_cast<char>((len >> (8 * i)) & 0xFF));
        } else {
            h.push_back(static_cast<char>(0x80 | 127));
            for (int i = 7; i >= 0; --i) h.push_back(static_cast<char>((len >> (8 * i)) & 0xFF));
        }
        h.append(kMask, 4);
        return h;
    }
    bool sendFrame(int opcode, const std::string& payload) {
        std::string f = header(opcode, payload.size());
        for (size_t i = 0; i < payload.size(); ++i)
            f.push_back(static_cast<char>(payload[i] ^ kMask[i & 3]));
        return sendAll(fd_, f);
    }
    ssize_t readExact(char* buf, size_t n, int timeoutMs) {
        size_t off = 0;
        while (off < n) {
            const ssize_t r = recvSome(fd_, buf + off, n - off, timeoutMs);
            if (r == 0) return 0;
            if (r < 0) return -1;
            off += static_cast<size_t>(r);
        }
        return static_cast<ssize_t>(n);
    }

    static constexpr char kMask[4] = {0x11, 0x22, 0x33, 0x44};
    int fd_ = -1;
};

}  // namespace mat::test
