// The UDP transport of FINS/UDP on the loopback (feature 018, T013): one datagram per read, the
// nodes from the addresses, time limits, interrupt, an ICMP refusal, a busy local port.
#include <arpa/inet.h>
#include <gtest/gtest.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <thread>

#include "drivers/fins/udp_link.hpp"

namespace {

using mat::drv::ConnectCode;
using mat::drv::ReadCode;

struct Server {
    int fd = -1;
    int port = 0;
    Server() {
        fd = ::socket(AF_INET, SOCK_DGRAM, 0);
        sockaddr_in a{};
        a.sin_family = AF_INET;
        a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        ::bind(fd, reinterpret_cast<sockaddr*>(&a), sizeof a);
        socklen_t len = sizeof a;
        ::getsockname(fd, reinterpret_cast<sockaddr*>(&a), &len);
        port = ntohs(a.sin_port);
    }
    ~Server() { ::close(fd); }
    // Answers each datagram with two: its bytes reversed, then a single byte.
    void echoOnce() {
        uint8_t buf[2048];
        sockaddr_in from{};
        socklen_t len = sizeof from;
        const ssize_t n =
            ::recvfrom(fd, buf, sizeof buf, 0, reinterpret_cast<sockaddr*>(&from), &len);
        if (n <= 0) return;
        std::reverse(buf, buf + n);
        ::sendto(fd, buf, static_cast<size_t>(n), 0, reinterpret_cast<sockaddr*>(&from), len);
        const uint8_t one = 0x55;
        ::sendto(fd, &one, 1, 0, reinterpret_cast<sockaddr*>(&from), len);
    }
};

TEST(UdpLink, OneDatagramPerReadAndTheNodesOfTheAddresses) {
    Server s;
    mat::fins::UdpLink link;
    ASSERT_EQ(link.connect("127.0.0.1", s.port, 1000), ConnectCode::Ok);
    EXPECT_EQ(link.localNode(), 1);
    EXPECT_EQ(link.peerNode(), 1);
    const uint8_t msg[] = {1, 2, 3};
    ASSERT_TRUE(link.writeAll(msg, sizeof msg, 1000));
    s.echoOnce();
    uint8_t buf[64];
    auto r = link.read(buf, sizeof buf, 1000);
    ASSERT_EQ(r.code, ReadCode::Data);
    ASSERT_EQ(r.n, 3u);
    EXPECT_EQ(buf[0], 3);
    r = link.read(buf, sizeof buf, 1000);
    ASSERT_EQ(r.code, ReadCode::Data);
    EXPECT_EQ(r.n, 1u);
    EXPECT_EQ(link.bytesSent(), 3u);
    EXPECT_EQ(link.bytesReceived(), 4u);
}

TEST(UdpLink, ReadTimesOutAndInterruptEndsAWait) {
    Server s;
    mat::fins::UdpLink link;
    ASSERT_EQ(link.connect("127.0.0.1", s.port, 1000), ConnectCode::Ok);
    uint8_t buf[16];
    const auto t0 = std::chrono::steady_clock::now();
    EXPECT_EQ(link.read(buf, sizeof buf, 100).code, ReadCode::Timeout);
    EXPECT_GE(std::chrono::steady_clock::now() - t0, std::chrono::milliseconds(90));
    std::thread th([&] {
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        link.interrupt();
    });
    EXPECT_EQ(link.read(buf, sizeof buf, 5000).code, ReadCode::Interrupted);
    th.join();
    link.clearInterrupt();
    EXPECT_EQ(link.read(buf, sizeof buf, 10).code, ReadCode::Timeout);
}

TEST(UdpLink, NoListenerIsAClosedLinkAndABusyLocalPortIsPortBusy) {
    int port = 0;
    {
        Server s;
        port = s.port;
    }  // nothing listens there now
    mat::fins::UdpLink link;
    ASSERT_EQ(link.connect("127.0.0.1", port, 1000), ConnectCode::Ok);
    const uint8_t msg[] = {9};
    ASSERT_TRUE(link.writeAll(msg, 1, 1000));
    uint8_t buf[16];
    EXPECT_EQ(link.read(buf, sizeof buf, 1000).code, ReadCode::Closed);

    Server busy;
    mat::fins::UdpLink fixed(busy.port);
    EXPECT_EQ(fixed.connect("127.0.0.1", 9600, 1000), ConnectCode::PortBusy);
    EXPECT_EQ(fixed.connect("no-such-host.invalid", 9600, 1000), ConnectCode::Dns);
}

}  // namespace
