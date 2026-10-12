// T059 (feature 005; contracts/discovery.md §1, §2, §5a; FR-002–FR-004): the discovery server on a
// real UDP socket.
//
// How the test reaches the server: a query is sent unicast from a non-loopback IPv4 address of this
// machine to that same address (in the x64 Docker run, the container's eth0 address, e.g.
// 172.17.0.2/16). A loopback source gets no reply (contract §5a), and adding an address needs
// NET_ADMIN, which the test container does not have. Linux reports such a datagram through
// IP_PKTINFO as received on the interface that owns the address (eth0, not lo), so the server sees
// what a Studio on that subnet would make it see; a directed broadcast (172.17.255.255), as the
// Studio sends it, comes back on eth0 too. Both checked on the WSL2 kernel 6.6 of Docker Desktop.
// Without a non-loopback IPv4 address the end-to-end cases are skipped, saying so:
// discovery_proto_test covers the rules, T061 (tools/device-it.ps1 -Scenario discovery) the Docker
// network with a second subnet.
//
// - a query from the same subnet gets a reply: the query's nonce, never longer than the query,
//   from the receiving interface's address and the discovery port;
// - bad datagrams, a loopback source, a source port below 1024: silence, counted by reason;
// - rate (fake clock): 5 queries from one source → 3 replies;
// - discoveryEnabled = false: no socket at all (FR-004);
// - a taken port is an error, not a crash; stop() is prompt and frees the port;
// - the device info is asked for at most once a second; nothing allocates per datagram.
#include "server/discovery/discovery_server.hpp"

#include <arpa/inet.h>
#include <gtest/gtest.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <net/if_arp.h>
#include <netinet/in.h>
#include <netpacket/packet.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <array>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <new>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "nlohmann/json.hpp"

// NoAllocationPerDatagram counts heap allocations (every thread) while g_counting is set.
namespace {
std::atomic<bool> g_counting{false};
std::atomic<size_t> g_allocations{0};
}  // namespace

void* operator new(std::size_t size) {
    if (g_counting.load(std::memory_order_relaxed)) g_allocations.fetch_add(1);
    if (void* p = std::malloc(size == 0 ? 1 : size)) return p;
    throw std::bad_alloc();
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }

using namespace mat;
using namespace mat::discovery;
using nlohmann::json;

namespace {

const char* const kFp = "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b";

DeviceInfo testInfo() {
    DeviceInfo d;
    d.deviceId = "4f9c2a8e-6d1b-4c3a-9e57-0b2f1d6c8a10";
    d.name = "BL335-thử";
    d.model = "BL335";
    d.runtime = "0.4.0";
    d.api = "1.0.0";
    d.status = DeviceStatus::Running;
    d.project = ProjectInfo{"tank-demo", "Trạm bơm nước", "0.1.0", std::nullopt};
    d.httpsPort = 8443;
    d.httpPort = 8080;
    d.fingerprint = std::string(kFp);
    return d;
}

std::string dotted(uint32_t addr) {
    in_addr a{};
    a.s_addr = htonl(addr);
    char s[INET_ADDRSTRLEN];
    inet_ntop(AF_INET, &a, s, sizeof s);
    return s;
}

int prefixOf(uint32_t mask) {
    int n = 0;
    for (; mask & 0x80000000u; mask <<= 1) ++n;
    return n;
}

// A non-loopback IPv4 address of this machine, found with getifaddrs() (the test may use netlink;
// the runtime may not), with the MAC of its interface.
struct LocalAddr {
    std::string iface;
    uint32_t addr = 0;
    uint32_t mask = 0;
    std::string mac;  // "AA:BB:…", empty when the interface has none
};

std::optional<LocalAddr> findLocal() {
    ifaddrs* list = nullptr;
    if (getifaddrs(&list) != 0) return std::nullopt;
    std::optional<LocalAddr> out;
    for (ifaddrs* a = list; a && !out; a = a->ifa_next) {
        if (!a->ifa_addr || a->ifa_addr->sa_family != AF_INET || !a->ifa_netmask) continue;
        if (!(a->ifa_flags & IFF_UP) || (a->ifa_flags & IFF_LOOPBACK)) continue;
        sockaddr_in sin{};
        std::memcpy(&sin, a->ifa_addr, sizeof sin);
        const uint32_t addr = ntohl(sin.sin_addr.s_addr);
        std::memcpy(&sin, a->ifa_netmask, sizeof sin);
        const uint32_t mask = ntohl(sin.sin_addr.s_addr);
        if ((addr >> 24) == 127 || prefixOf(mask) > 30) continue;
        out = LocalAddr{a->ifa_name, addr, mask, ""};
    }
    for (ifaddrs* a = list; a && out; a = a->ifa_next) {
        if (!a->ifa_addr || a->ifa_addr->sa_family != AF_PACKET || out->iface != a->ifa_name)
            continue;
        sockaddr_ll ll{};
        std::memcpy(&ll, a->ifa_addr, sizeof ll);
        if (ll.sll_hatype != ARPHRD_ETHER || ll.sll_halen != 6) continue;
        char m[18];
        std::snprintf(m, sizeof m, "%02X:%02X:%02X:%02X:%02X:%02X", ll.sll_addr[0], ll.sll_addr[1],
                      ll.sll_addr[2], ll.sll_addr[3], ll.sll_addr[4], ll.sll_addr[5]);
        if (std::string(m) != "00:00:00:00:00:00") out->mac = m;
    }
    freeifaddrs(list);
    return out;
}

// A UDP socket of the test, bound to `addr`:`port` (host byte order).
class Udp {
   public:
    explicit Udp(uint32_t addr, uint16_t port = 0) {
        fd_ = ::socket(AF_INET, SOCK_DGRAM | SOCK_CLOEXEC, 0);
        const int on = 1;
        ::setsockopt(fd_, SOL_SOCKET, SO_BROADCAST, &on, sizeof on);
        sockaddr_in sa{};
        sa.sin_family = AF_INET;
        sa.sin_addr.s_addr = htonl(addr);
        sa.sin_port = htons(port);
        ok_ = fd_ >= 0 && ::bind(fd_, reinterpret_cast<sockaddr*>(&sa), sizeof sa) == 0;
        error_ = ok_ ? 0 : errno;
    }
    ~Udp() {
        if (fd_ >= 0) ::close(fd_);
    }
    Udp(const Udp&) = delete;
    Udp& operator=(const Udp&) = delete;

    bool ok() const { return ok_; }
    int error() const { return error_; }
    uint16_t port() const {
        sockaddr_in sa{};
        socklen_t len = sizeof sa;
        ::getsockname(fd_, reinterpret_cast<sockaddr*>(&sa), &len);
        return ntohs(sa.sin_port);
    }
    void sendTo(const void* data, size_t size, uint32_t addr, uint16_t port) const {
        sockaddr_in to{};
        to.sin_family = AF_INET;
        to.sin_addr.s_addr = htonl(addr);
        to.sin_port = htons(port);
        const ssize_t n =
            ::sendto(fd_, data, size, 0, reinterpret_cast<const sockaddr*>(&to), sizeof to);
        EXPECT_EQ(n, static_cast<ssize_t>(size)) << std::strerror(errno);
    }
    // One datagram within `timeoutMs` into `buf`: its size, or -1.
    ssize_t receive(uint8_t* buf, size_t cap, int timeoutMs, uint32_t* from = nullptr,
                    uint16_t* fromPort = nullptr) const {
        pollfd p{fd_, POLLIN, 0};
        if (::poll(&p, 1, timeoutMs) <= 0) return -1;
        sockaddr_in sa{};
        socklen_t len = sizeof sa;
        const ssize_t n = ::recvfrom(fd_, buf, cap, 0, reinterpret_cast<sockaddr*>(&sa), &len);
        if (from) *from = ntohl(sa.sin_addr.s_addr);
        if (fromPort) *fromPort = ntohs(sa.sin_port);
        return n;
    }

   private:
    int fd_ = -1;
    bool ok_ = false;
    int error_ = 0;
};

std::array<uint8_t, kQuerySize> query(uint8_t tag) {
    std::array<uint8_t, kQuerySize> q{};
    q[0] = 'M';
    q[1] = 'A';
    q[2] = 'T';
    q[3] = 'D';
    q[4] = 1;
    q[5] = 1;
    for (size_t i = 8; i < kHeaderSize; ++i) q[i] = static_cast<uint8_t>(tag + i);
    return q;
}

template <typename F>
bool waitFor(F done, int timeoutMs = 3000) {
    const auto end = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
    while (!done()) {
        if (std::chrono::steady_clock::now() > end) return false;
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    return true;
}

uint64_t drops(const Counters& c) { return c.format + c.subnet + c.port + c.rate; }

uint16_t freeUdpPort() {
    Udp probe(INADDR_ANY);
    return probe.port();
}

const char* const kNoLocal =
    "no non-loopback IPv4 address on this machine: a loopback source gets no reply (contract "
    "§5a); discovery_proto_test covers the rules, T061 the Docker network";

#define SKIP_WITHOUT_LOCAL() \
    if (!local_) GTEST_SKIP() << kNoLocal

class DiscoveryServerTest : public ::testing::Test {
   protected:
    void SetUp() override { local_ = findLocal(); }

    void start(bool enabled = true, int port = 0) {
        server_ = std::make_unique<DiscoveryServer>(
            DiscoveryServer::Options{enabled, port},
            [this] {
                ++infoCalls_;
                return testInfo();
            },
            [this] { return now_.load(); });
        std::string error;
        ASSERT_TRUE(server_->start(error)) << error;
    }

    uint16_t serverPort() const { return static_cast<uint16_t>(server_->port()); }

    // A reply to the query with `tag`, checked: header, nonce, size, source.
    json expectReply(const Udp& client, uint8_t tag, uint32_t from) {
        uint8_t buf[2048];
        uint32_t src = 0;
        uint16_t srcPort = 0;
        const ssize_t n = client.receive(buf, sizeof buf, 3000, &src, &srcPort);
        EXPECT_GT(n, static_cast<ssize_t>(kHeaderSize)) << "no reply";
        if (n <= static_cast<ssize_t>(kHeaderSize)) return nullptr;
        EXPECT_LE(n, static_cast<ssize_t>(kQuerySize));  // never longer than the query
        EXPECT_EQ(dotted(src), dotted(from));            // the receiving interface's address
        EXPECT_EQ(srcPort, serverPort());
        EXPECT_EQ(std::string(buf, buf + 4), "MATD");
        EXPECT_EQ(buf[4], 1);
        EXPECT_EQ(buf[5], 2);
        EXPECT_EQ(buf[6], 0);
        EXPECT_EQ(buf[7], 0);
        const auto q = query(tag);
        EXPECT_TRUE(std::equal(q.begin() + 8, q.begin() + kHeaderSize, buf + 8)) << "nonce";
        EXPECT_TRUE(json::accept(buf + kHeaderSize, buf + n));
        return json::parse(buf + kHeaderSize, buf + n, nullptr, false);
    }

    void expectSilence(const Udp& client, int ms = 300) {
        uint8_t buf[2048];
        EXPECT_EQ(client.receive(buf, sizeof buf, ms), -1) << "unexpected reply";
    }

    std::optional<LocalAddr> local_;
    std::atomic<int64_t> now_{1000};
    std::atomic<int> infoCalls_{0};
    std::unique_ptr<DiscoveryServer> server_;
};

TEST_F(DiscoveryServerTest, AQueryFromTheSameSubnetGetsAReply) {
    SKIP_WITHOUT_LOCAL();
    start();
    ASSERT_TRUE(server_->running());
    ASSERT_GT(server_->port(), 0);
    Udp client(local_->addr);
    ASSERT_TRUE(client.ok()) << std::strerror(client.error());
    const auto q = query(1);
    client.sendTo(q.data(), q.size(), local_->addr, serverPort());
    json j = expectReply(client, 1, local_->addr);
    ASSERT_TRUE(j.is_object());
    // The receiving interface's part, from IP_PKTINFO and the interface table.
    EXPECT_EQ(j["ip"], dotted(local_->addr)) << local_->iface;
    EXPECT_EQ(j["prefix"], prefixOf(local_->mask));
    if (local_->mac.empty())
        EXPECT_TRUE(j["mac"].is_null());
    else
        EXPECT_EQ(j["mac"], local_->mac);
    // The device's part, from the info function.
    const DeviceInfo info = testInfo();
    EXPECT_EQ(j["v"], 1);
    EXPECT_EQ(j["id"], info.deviceId);
    EXPECT_EQ(j["name"], info.name);
    EXPECT_EQ(j["model"], "BL335");
    EXPECT_EQ(j["runtime"], "0.4.0");
    EXPECT_EQ(j["api"], "1.0.0");
    EXPECT_EQ(j["status"], "running");
    EXPECT_EQ(j["project"], json::parse(R"({"id":"tank-demo","name":"Trạm bơm nước",
                                            "version":"0.1.0","digest":null})"));
    EXPECT_EQ(j["https"], 8443);
    EXPECT_EQ(j["http"], 8080);
    EXPECT_EQ(j["fp"], kFp);
    EXPECT_TRUE(waitFor([&] { return server_->counters().replies == 1; }));
    EXPECT_EQ(drops(server_->counters()), 0u);
}

TEST_F(DiscoveryServerTest, ADirectedBroadcastGetsAUnicastReply) {
    // As the Studio sends it (contract §1): to the broadcast address of the subnet.
    SKIP_WITHOUT_LOCAL();
    start();
    Udp client(local_->addr);
    ASSERT_TRUE(client.ok());
    const uint32_t broadcast = (local_->addr & local_->mask) | ~local_->mask;
    const auto q = query(2);
    client.sendTo(q.data(), q.size(), broadcast, serverPort());
    json j = expectReply(client, 2, local_->addr);
    ASSERT_TRUE(j.is_object());
    EXPECT_EQ(j["ip"], dotted(local_->addr));
    EXPECT_TRUE(waitFor([&] { return server_->counters().replies == 1; }));
}

TEST_F(DiscoveryServerTest, BadDatagramsGetNoReply) {
    SKIP_WITHOUT_LOCAL();
    start();
    Udp client(local_->addr);
    ASSERT_TRUE(client.ok());
    const auto good = query(3);
    std::vector<std::vector<uint8_t>> bad;
    bad.emplace_back(good.begin(), good.end() - 1);  // 1023 bytes
    bad.emplace_back(good.begin(), good.end());
    bad.back().push_back(0);                    // 1025 bytes
    for (size_t i : {0u, 4u, 5u, 7u, 1023u}) {  // magic, version, type, flags, padding
        bad.emplace_back(good.begin(), good.end());
        bad.back()[i] ^= 0x01;
    }
    std::vector<uint8_t> big(1500, 0);  // larger than the receive buffer
    std::copy(good.begin(), good.end(), big.begin());
    bad.push_back(big);
    for (const auto& b : bad) client.sendTo(b.data(), b.size(), local_->addr, serverPort());
    expectSilence(client);
    EXPECT_TRUE(waitFor([&] { return server_->counters().format == bad.size(); }))
        << server_->counters().format;
    EXPECT_EQ(server_->counters().replies, 0u);
    // The server is still there for a good query.
    client.sendTo(good.data(), good.size(), local_->addr, serverPort());
    EXPECT_TRUE(expectReply(client, 3, local_->addr).is_object());
}

TEST_F(DiscoveryServerTest, ALoopbackSourceGetsNoReply) {
    // Contract §5a: 127.0.0.1 is on the subnet of lo, and still gets no reply.
    start();
    Udp client(INADDR_LOOPBACK);
    ASSERT_TRUE(client.ok());
    const auto q = query(4);
    client.sendTo(q.data(), q.size(), INADDR_LOOPBACK, serverPort());
    expectSilence(client);
    EXPECT_TRUE(waitFor([&] { return server_->counters().subnet == 1; }));
    EXPECT_EQ(server_->counters().replies, 0u);
}

TEST_F(DiscoveryServerTest, ASourcePortBelow1024GetsNoReply) {
    SKIP_WITHOUT_LOCAL();
    start();
    Udp client(local_->addr, 1023);
    if (!client.ok()) GTEST_SKIP() << "cannot bind port 1023: " << std::strerror(client.error());
    const auto q = query(5);
    client.sendTo(q.data(), q.size(), local_->addr, serverPort());
    expectSilence(client);
    EXPECT_TRUE(waitFor([&] { return server_->counters().port == 1; }));
    EXPECT_EQ(server_->counters().replies, 0u);
}

TEST_F(DiscoveryServerTest, FiveQueriesFromOneSourceGetThreeReplies) {
    // Contract §4, §6; the fake clock stands still, then moves one second.
    SKIP_WITHOUT_LOCAL();
    start();
    Udp client(local_->addr);
    ASSERT_TRUE(client.ok());
    for (uint8_t tag = 10; tag < 15; ++tag) {
        const auto q = query(tag);
        client.sendTo(q.data(), q.size(), local_->addr, serverPort());
    }
    for (uint8_t tag = 10; tag < 13; ++tag)
        EXPECT_TRUE(expectReply(client, tag, local_->addr).is_object());
    expectSilence(client);
    EXPECT_TRUE(waitFor([&] { return server_->counters().rate == 2; }));
    EXPECT_EQ(server_->counters().replies, 3u);
    now_ += 1000;
    const auto q = query(20);
    client.sendTo(q.data(), q.size(), local_->addr, serverPort());
    EXPECT_TRUE(expectReply(client, 20, local_->addr).is_object());
}

TEST_F(DiscoveryServerTest, DisabledOpensNoSocket) {
    // FR-004: discoveryEnabled = false.
    const uint16_t port = freeUdpPort();
    DiscoveryServer server({false, port}, [this] {
        ++infoCalls_;
        return testInfo();
    });
    std::string error;
    EXPECT_TRUE(server.start(error)) << error;
    EXPECT_FALSE(server.enabled());
    EXPECT_FALSE(server.running());
    EXPECT_EQ(server.port(), 0);
    // Nobody holds the port: the test can bind it, and gets its own query back.
    Udp holder(INADDR_ANY, port);
    EXPECT_TRUE(holder.ok()) << "port " << port << " taken: " << std::strerror(holder.error());
    Udp client(INADDR_LOOPBACK);
    const auto q = query(6);
    client.sendTo(q.data(), q.size(), INADDR_LOOPBACK, port);
    uint8_t buf[2048];
    EXPECT_EQ(holder.receive(buf, sizeof buf, 1000), static_cast<ssize_t>(kQuerySize));
    EXPECT_EQ(infoCalls_.load(), 0);
    const Counters c = server.counters();
    EXPECT_EQ(c.replies + drops(c), 0u);
    server.stop();
}

TEST_F(DiscoveryServerTest, ATakenPortIsAnErrorNotACrash) {
    Udp holder(INADDR_ANY);
    ASSERT_TRUE(holder.ok());
    DiscoveryServer server({true, holder.port()}, testInfo);
    std::string error;
    EXPECT_FALSE(server.start(error));
    EXPECT_NE(error.find(std::to_string(holder.port())), std::string::npos) << error;
    EXPECT_FALSE(server.running());
    EXPECT_EQ(server.port(), 0);
    server.stop();
}

TEST_F(DiscoveryServerTest, StopIsPromptAndFreesThePort) {
    start();
    const uint16_t port = serverPort();
    ASSERT_GT(port, 0);
    const auto t0 = std::chrono::steady_clock::now();
    server_->stop();
    const auto ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count();
    EXPECT_LT(ms, 500);  // poll() is woken, not timed out
    EXPECT_FALSE(server_->running());
    EXPECT_EQ(server_->port(), 0);
    Udp again(INADDR_ANY, port);
    EXPECT_TRUE(again.ok()) << std::strerror(again.error());
    server_->stop();  // twice is fine
}

TEST_F(DiscoveryServerTest, AsksForTheDeviceInfoAtMostOncePerSecond) {
    SKIP_WITHOUT_LOCAL();
    start();
    Udp client(local_->addr);
    ASSERT_TRUE(client.ok());
    for (uint8_t tag = 30; tag < 33; ++tag) {
        const auto q = query(tag);
        client.sendTo(q.data(), q.size(), local_->addr, serverPort());
        EXPECT_TRUE(expectReply(client, tag, local_->addr).is_object());
    }
    EXPECT_EQ(infoCalls_.load(), 1);
    now_ += DiscoveryServer::kInfoMaxAgeMs;  // the source has one token again
    const auto q = query(33);
    client.sendTo(q.data(), q.size(), local_->addr, serverPort());
    EXPECT_TRUE(expectReply(client, 33, local_->addr).is_object());
    EXPECT_EQ(infoCalls_.load(), 2);
}

TEST_F(DiscoveryServerTest, NoAllocationPerDatagram) {
    SKIP_WITHOUT_LOCAL();
    start();
    Udp client(local_->addr);
    Udp lo(INADDR_LOOPBACK);
    ASSERT_TRUE(client.ok() && lo.ok());
    const auto warm = query(40);  // reads the interface table and the device info once
    client.sendTo(warm.data(), warm.size(), local_->addr, serverPort());
    ASSERT_TRUE(expectReply(client, 40, local_->addr).is_object());
    auto bad = query(41);
    bad[0] = 'X';
    const auto good = query(42);
    uint8_t buf[2048];
    g_allocations = 0;
    g_counting = true;  // the fake clock stands still: no refresh of the table or the info
    for (int i = 0; i < 10; ++i) {
        client.sendTo(good.data(), good.size(), local_->addr, serverPort());
        client.sendTo(bad.data(), bad.size(), local_->addr, serverPort());
        lo.sendTo(good.data(), good.size(), INADDR_LOOPBACK, serverPort());
    }
    const bool done = waitFor([&] {
        const Counters c = server_->counters();
        return c.replies + drops(c) == 31;
    });
    int replies = 0;
    while (client.receive(buf, sizeof buf, 100) > 0) ++replies;
    g_counting = false;
    EXPECT_TRUE(done);
    EXPECT_EQ(g_allocations.load(), 0u);
    EXPECT_EQ(replies, 2);  // 3 tokens for the source, one taken by the warm-up
    const Counters c = server_->counters();
    EXPECT_EQ(c.replies, 3u);
    EXPECT_EQ(c.rate, 8u);
    EXPECT_EQ(c.format, 10u);
    EXPECT_EQ(c.subnet, 10u);
}

}  // namespace
