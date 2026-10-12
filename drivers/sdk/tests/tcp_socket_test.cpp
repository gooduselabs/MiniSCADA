// The TCP transport of the drivers on a test server at 127.0.0.1 (specs/006 T097): connect with a
// time limit, the failure classes, a peer that closes while idle, a reply that comes in pieces,
// interruption from another thread, close-on-exec.
#include "drivers/sdk/tcp_socket.hpp"

#include <arpa/inet.h>
#include <fcntl.h>
#include <gtest/gtest.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <thread>
#include <vector>

using namespace mat::drv;
using namespace std::chrono;

namespace {

int64_t nowMs() {
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

// A listening socket on 127.0.0.1 and a free port.
struct Listener {
    explicit Listener(int backlog = 8) {
        fd = ::socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
        int one = 1;
        ::setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
        sockaddr_in a{};
        a.sin_family = AF_INET;
        a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        a.sin_port = 0;
        EXPECT_EQ(::bind(fd, reinterpret_cast<sockaddr*>(&a), sizeof a), 0);
        EXPECT_EQ(::listen(fd, backlog), 0);
        socklen_t len = sizeof a;
        ::getsockname(fd, reinterpret_cast<sockaddr*>(&a), &len);
        port = ntohs(a.sin_port);
    }
    ~Listener() {
        if (fd >= 0) ::close(fd);
    }
    int acceptOne() { return ::accept(fd, nullptr, nullptr); }
    int fd = -1;
    int port = 0;
};

}  // namespace

TEST(TcpSocket, ConnectsToAListeningServerAndSetsCloseOnExec) {
    Listener l;
    TcpSocket s;
    EXPECT_FALSE(s.isOpen());
    EXPECT_EQ(s.connect("127.0.0.1", l.port, 1000), ConnectCode::Ok);
    EXPECT_TRUE(s.isOpen());
    const int flags = ::fcntl(s.fd(), F_GETFD);
    EXPECT_NE(flags, -1);
    EXPECT_TRUE(flags & FD_CLOEXEC) << "the socket must not leak into a child process";
    // the self-pipe used to interrupt blocking calls is close-on-exec too
    EXPECT_TRUE(::fcntl(s.wakeFd(), F_GETFD) & FD_CLOEXEC);
    s.close();
    EXPECT_FALSE(s.isOpen());
}

TEST(TcpSocket, RefusedWhenNothingListens) {
    int port;
    {
        Listener l;
        port = l.port;
    }
    TcpSocket s;
    const int64_t t0 = nowMs();
    EXPECT_EQ(s.connect("127.0.0.1", port, 1000), ConnectCode::Refused);
    EXPECT_LT(nowMs() - t0, 500);
    EXPECT_FALSE(s.isOpen());
}

TEST(TcpSocket, TimesOutWithinTheLimitWhenTheServerNeverAccepts) {
    // A backlog of 1 that is already full: the next SYN is dropped, so the connect waits.
    Listener l(1);
    std::vector<int> fillers;
    for (int i = 0; i < 4; ++i) {
        const int f = ::socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
        sockaddr_in a{};
        a.sin_family = AF_INET;
        a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        a.sin_port = htons(static_cast<uint16_t>(l.port));
        ::connect(f, reinterpret_cast<sockaddr*>(&a), sizeof a);
        fillers.push_back(f);
    }
    std::this_thread::sleep_for(milliseconds(50));
    TcpSocket s;
    const int64_t t0 = nowMs();
    EXPECT_EQ(s.connect("127.0.0.1", l.port, 300), ConnectCode::Timeout);
    const int64_t took = nowMs() - t0;
    EXPECT_GE(took, 280);
    EXPECT_LT(took, 700);
    EXPECT_FALSE(s.isOpen());
    for (int f : fillers) ::close(f);
}

TEST(TcpSocket, ANameThatDoesNotResolveIsDns) {
    TcpSocket s;
    EXPECT_EQ(s.connect("no-such-host.invalid", 502, 3000), ConnectCode::Dns);
    EXPECT_FALSE(s.isOpen());
}

TEST(TcpSocket, ErrnoClasses) {
    EXPECT_EQ(classifyConnectErrno(ECONNREFUSED), ConnectCode::Refused);
    EXPECT_EQ(classifyConnectErrno(ETIMEDOUT), ConnectCode::Timeout);
    EXPECT_EQ(classifyConnectErrno(ENETUNREACH), ConnectCode::Unreachable);
    EXPECT_EQ(classifyConnectErrno(EHOSTUNREACH), ConnectCode::Unreachable);
    EXPECT_EQ(classifyConnectErrno(ENETDOWN), ConnectCode::Unreachable);
    EXPECT_EQ(classifyConnectErrno(EACCES), ConnectCode::Error);
    EXPECT_STREQ(connectCodeName(ConnectCode::Ok), "OK");
    EXPECT_STREQ(connectCodeName(ConnectCode::Refused), "REFUSED");
    EXPECT_STREQ(connectCodeName(ConnectCode::Timeout), "TIMEOUT");
    EXPECT_STREQ(connectCodeName(ConnectCode::Unreachable), "UNREACHABLE");
    EXPECT_STREQ(connectCodeName(ConnectCode::Dns), "DNS");
}

TEST(TcpSocket, NoRouteIsUnreachableOrTimeoutNeverAHang) {
    // 203.0.113.1 (documentation range) has no route in a container without a default route and
    // goes nowhere elsewhere: either way the call returns inside the limit.
    TcpSocket s;
    const int64_t t0 = nowMs();
    const ConnectCode c = s.connect("203.0.113.1", 502, 400);
    EXPECT_TRUE(c == ConnectCode::Unreachable || c == ConnectCode::Timeout ||
                c == ConnectCode::Refused)
        << connectCodeName(c);
    EXPECT_LT(nowMs() - t0, 900);
}

TEST(TcpSocket, SeesThatThePeerClosedWhileIdle) {
    Listener l;
    TcpSocket s;
    ASSERT_EQ(s.connect("127.0.0.1", l.port, 1000), ConnectCode::Ok);
    const int peer = l.acceptOne();
    ASSERT_GE(peer, 0);
    EXPECT_FALSE(s.peerClosed());
    ::close(peer);
    std::this_thread::sleep_for(milliseconds(50));
    EXPECT_TRUE(s.peerClosed());
}

TEST(TcpSocket, StrayBytesWhileIdleAreNotAClose) {
    Listener l;
    TcpSocket s;
    ASSERT_EQ(s.connect("127.0.0.1", l.port, 1000), ConnectCode::Ok);
    const int peer = l.acceptOne();
    ASSERT_EQ(::send(peer, "xyz", 3, 0), 3);
    std::this_thread::sleep_for(milliseconds(30));
    EXPECT_FALSE(s.peerClosed());
    EXPECT_EQ(s.discardInput(), 3u);
    uint8_t b[8];
    EXPECT_EQ(s.read(b, sizeof b, 30).code, ReadCode::Timeout);
    ::close(peer);
}

TEST(TcpSocket, ReadsAReplyThatComesInPieces) {
    Listener l;
    TcpSocket s;
    ASSERT_EQ(s.connect("127.0.0.1", l.port, 1000), ConnectCode::Ok);
    const int peer = l.acceptOne();
    std::thread sender([peer] {
        for (const char* piece : {"ab", "cde", "f"}) {
            std::this_thread::sleep_for(milliseconds(40));
            ::send(peer, piece, std::strlen(piece), 0);
        }
    });
    std::string got;
    const int64_t t0 = nowMs();
    while (got.size() < 6 && nowMs() - t0 < 2000) {
        uint8_t b[16];
        const ReadResult r = s.read(b, sizeof b, 500);
        ASSERT_EQ(r.code, ReadCode::Data);
        got.append(reinterpret_cast<char*>(b), r.n);
    }
    sender.join();
    EXPECT_EQ(got, "abcdef");
    EXPECT_EQ(s.bytesReceived(), 6u);
    ::close(peer);
}

TEST(TcpSocket, ReadTimesOutAndReportsAClose) {
    Listener l;
    TcpSocket s;
    ASSERT_EQ(s.connect("127.0.0.1", l.port, 1000), ConnectCode::Ok);
    const int peer = l.acceptOne();
    uint8_t b[4];
    const int64_t t0 = nowMs();
    EXPECT_EQ(s.read(b, sizeof b, 120).code, ReadCode::Timeout);
    EXPECT_GE(nowMs() - t0, 110);
    ::close(peer);
    EXPECT_EQ(s.read(b, sizeof b, 500).code, ReadCode::Closed);
}

TEST(TcpSocket, WritesAndCountsBytes) {
    Listener l;
    TcpSocket s;
    ASSERT_EQ(s.connect("127.0.0.1", l.port, 1000), ConnectCode::Ok);
    const int peer = l.acceptOne();
    const uint8_t frame[] = {0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 1};
    EXPECT_TRUE(s.writeAll(frame, sizeof frame, 500));
    uint8_t in[16];
    EXPECT_EQ(::recv(peer, in, sizeof in, 0), static_cast<ssize_t>(sizeof frame));
    EXPECT_EQ(s.bytesSent(), sizeof frame);
    ::close(peer);
    // writing to a peer that has gone fails (no SIGPIPE) within a few writes
    bool failed = false;
    for (int i = 0; i < 20 && !failed; ++i) {
        std::this_thread::sleep_for(milliseconds(10));
        failed = !s.writeAll(frame, sizeof frame, 200);
    }
    EXPECT_TRUE(failed);
}

TEST(TcpSocket, InterruptWakesABlockedReadAtOnce) {
    Listener l;
    TcpSocket s;
    ASSERT_EQ(s.connect("127.0.0.1", l.port, 1000), ConnectCode::Ok);
    const int peer = l.acceptOne();
    std::thread t([&s] {
        std::this_thread::sleep_for(milliseconds(80));
        s.interrupt();
    });
    uint8_t b[4];
    const int64_t t0 = nowMs();
    EXPECT_EQ(s.read(b, sizeof b, 5000).code, ReadCode::Interrupted);
    EXPECT_LT(nowMs() - t0, 1000);
    t.join();
    // until cleared, every blocking call returns at once
    EXPECT_EQ(s.read(b, sizeof b, 5000).code, ReadCode::Interrupted);
    s.clearInterrupt();
    EXPECT_EQ(s.read(b, sizeof b, 30).code, ReadCode::Timeout);
    ::close(peer);
}

TEST(TcpSocket, InterruptWakesAConnectThatWaits) {
    Listener l(1);
    std::vector<int> fillers;
    for (int i = 0; i < 4; ++i) {
        const int f = ::socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
        sockaddr_in a{};
        a.sin_family = AF_INET;
        a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        a.sin_port = htons(static_cast<uint16_t>(l.port));
        ::connect(f, reinterpret_cast<sockaddr*>(&a), sizeof a);
        fillers.push_back(f);
    }
    std::this_thread::sleep_for(milliseconds(50));
    TcpSocket s;
    std::thread t([&s] {
        std::this_thread::sleep_for(milliseconds(80));
        s.interrupt();
    });
    const int64_t t0 = nowMs();
    EXPECT_EQ(s.connect("127.0.0.1", l.port, 5000), ConnectCode::Interrupted);
    EXPECT_LT(nowMs() - t0, 1000);
    t.join();
    for (int f : fillers) ::close(f);
}

TEST(TcpSocket, CanConnectAgainAfterClose) {
    Listener l;
    TcpSocket s;
    for (int i = 0; i < 3; ++i) {
        ASSERT_EQ(s.connect("127.0.0.1", l.port, 1000), ConnectCode::Ok);
        const int peer = l.acceptOne();
        EXPECT_TRUE(s.isOpen());
        s.close();
        ::close(peer);
    }
}
