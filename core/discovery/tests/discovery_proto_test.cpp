// T056 (feature 005; contracts/discovery.md §2–§5a): the pure discovery functions, on every vector
// of tests/discovery-vectors (shared with the Studio: apps/studio/src-tauri/src/discovery.rs) and
// on unit cases:
// - query: exactly 1024 bytes, magic "MATD", version 1, type 1, flags 0, zero padding;
// - source: on a subnet of the receiving interface ((src & mask) == (ifaddr & mask) for one of its
//   addresses), never 0.0.0.0, 255.255.255.255, a subnet broadcast, multicast or loopback; source
//   port ≥ 1024;
// - rate (fake clock): per source 1 reply/s with a burst of 3, 20 replies/s in all, 64 sources LRU;
// - reply: the 24-byte header (type 2, the nonce), the JSON keys of §3 and their limits, the cuts
//   with the `truncated` flag, never longer than the query, no secret;
// - counters of replies and of drops by reason (subnet, format, rate, port);
// - nothing allocates per datagram.
// The "reply-*" vectors test the Studio's parser. Here their packets are datagrams that must never
// get a reply: a reply never answers a reply, so two devices cannot loop.
#include "core/discovery/discovery_proto.hpp"

#include <arpa/inet.h>
#include <dirent.h>
#include <gtest/gtest.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <new>
#include <random>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "nlohmann/json.hpp"

// NoAllocationPerDatagram counts heap allocations while g_counting is set.
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

using namespace mat::discovery;
using nlohmann::json;
using ojson = nlohmann::ordered_json;

namespace {

const std::string kVectors = std::string(MAT_SOURCE_DIR) + "/tests/discovery-vectors";

std::string readFile(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) ADD_FAILURE() << "cannot read " << path;
    std::stringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

// The vector files (*.json), sorted.
std::vector<std::string> vectorNames() {
    std::vector<std::string> out;
    if (DIR* d = opendir(kVectors.c_str())) {
        while (const dirent* e = readdir(d)) {
            const std::string n = e->d_name;
            if (n.size() > 5 && n.compare(n.size() - 5, 5, ".json") == 0) out.push_back(n);
        }
        closedir(d);
    }
    std::sort(out.begin(), out.end());
    return out;
}

std::vector<std::pair<std::string, json>> vectorsOf(const std::string& kind) {
    std::vector<std::pair<std::string, json>> out;
    for (const auto& n : vectorNames()) {
        json v = json::parse(readFile(kVectors + "/" + n));
        if (v["kind"] == kind) out.emplace_back(n, std::move(v));
    }
    return out;
}

std::vector<uint8_t> unhex(const std::string& s) {
    std::vector<uint8_t> out;
    for (size_t i = 0; i + 1 < s.size(); i += 2)
        out.push_back(static_cast<uint8_t>(std::stoi(s.substr(i, 2), nullptr, 16)));
    return out;
}

uint32_t ip(const std::string& dotted) {
    in_addr a{};
    EXPECT_EQ(inet_pton(AF_INET, dotted.c_str(), &a), 1) << dotted;
    return ntohl(a.s_addr);
}

uint32_t mask(int prefix) { return prefix == 0 ? 0 : ~uint32_t{0} << (32 - prefix); }

// "192.168.1.110/24"
Ipv4Net net(const std::string& cidr) {
    const auto slash = cidr.find('/');
    return {ip(cidr.substr(0, slash)), mask(std::stoi(cidr.substr(slash + 1)))};
}

const Mac kMac{0xC2, 0xD9, 0xCC, 0x52, 0x33, 0x70};

Iface card(std::initializer_list<const char*> cidrs) {
    Iface i;
    i.index = 2;
    i.name = "eth1";
    i.mac = kMac;
    for (const char* c : cidrs) i.addrs.push_back(net(c));
    return i;
}

// The interface of a vector: [{ "ip", "prefix" }, ...].
Iface cardOf(const json& addrs) {
    Iface i = card({});
    for (const auto& a : addrs)
        i.addrs.push_back({ip(a["ip"].get<std::string>()), mask(a["prefix"].get<int>())});
    return i;
}

const Nonce kNonce{0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
                   0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff};

Nonce nonceOf(const std::string& hex) {
    const auto b = unhex(hex);
    Nonce n{};
    std::copy(b.begin(), b.end(), n.begin());
    return n;
}

std::vector<uint8_t> query(const Nonce& n = kNonce) {
    std::vector<uint8_t> q(kQuerySize, 0);
    q[0] = 'M';
    q[1] = 'A';
    q[2] = 'T';
    q[3] = 'D';
    q[4] = 1;
    q[5] = 1;
    std::copy(n.begin(), n.end(), q.begin() + 8);
    return q;
}

Datagram datagram(const std::vector<uint8_t>& p, uint32_t source, int port, const Iface* iface) {
    Datagram d;
    d.data = p.data();
    d.size = p.size();
    d.source = source;
    d.sourcePort = static_cast<uint16_t>(port);
    d.iface = iface;
    return d;
}

std::string dropName(Drop d) {
    switch (d) {
        case Drop::None:
            return "none";
        case Drop::Format:
            return "format";
        case Drop::Subnet:
            return "subnet";
        case Drop::Port:
            return "port";
        case Drop::Rate:
            return "rate";
    }
    return "?";
}

uint64_t counterOf(const Counters& c, const std::string& reason) {
    if (reason == "format") return c.format;
    if (reason == "subnet") return c.subnet;
    if (reason == "port") return c.port;
    if (reason == "rate") return c.rate;
    ADD_FAILURE() << "unknown reason " << reason;
    return 0;
}

uint64_t drops(const Counters& c) { return c.format + c.subnet + c.port + c.rate; }

DeviceStatus statusOf(const std::string& s) {
    if (s == "running") return DeviceStatus::Running;
    if (s == "no-project") return DeviceStatus::NoProject;
    if (s == "project-error") return DeviceStatus::ProjectError;
    if (s == "activating") return DeviceStatus::Activating;
    ADD_FAILURE() << "unknown status " << s;
    return DeviceStatus::NoProject;
}

// "info" of a "build" vector.
DeviceInfo infoOf(const json& j) {
    DeviceInfo d;
    d.deviceId = j["id"].get<std::string>();
    d.name = j["name"].get<std::string>();
    d.model = j["model"].get<std::string>();
    d.runtime = j["runtime"].get<std::string>();
    d.api = j["api"].get<std::string>();
    d.status = statusOf(j["status"].get<std::string>());
    if (!j["project"].is_null()) {
        const json& p = j["project"];
        ProjectInfo pi;
        pi.id = p["id"].get<std::string>();
        pi.name = p["name"].get<std::string>();
        pi.version = p["version"].get<std::string>();
        if (!p["digest"].is_null()) pi.digest = p["digest"].get<std::string>();
        d.project = pi;
    }
    d.httpsPort = j["https"].get<int>();
    d.httpPort = j["http"].get<int>();
    if (!j["fp"].is_null()) d.fingerprint = j["fp"].get<std::string>();
    return d;
}

Mac macOf(const std::string& s) {
    Mac m{};
    for (size_t i = 0; i < m.size(); ++i)
        m[i] = static_cast<uint8_t>(std::stoi(s.substr(i * 3, 2), nullptr, 16));
    return m;
}

LocalAddress localOf(const json& j) {
    LocalAddress l;
    l.net = {ip(j["ip"].get<std::string>()), mask(j["prefix"].get<int>())};
    if (!j["mac"].is_null()) l.mac = macOf(j["mac"].get<std::string>());
    return l;
}

// The reply in `out`: the header is checked, the JSON returned as text ("{}" when there is no
// reply, so that the checks after it fail as assertions, not as exceptions).
struct Reply {
    uint16_t flags = 0;
    std::string json = "{}";
};

Reply readReply(const Packet& out, size_t size, const Nonce& nonce) {
    Reply r;
    EXPECT_GT(size, kHeaderSize);
    EXPECT_LE(size, kQuerySize);
    if (size <= kHeaderSize || size > kQuerySize) return r;
    EXPECT_EQ(std::string(out.begin(), out.begin() + 4), "MATD");
    EXPECT_EQ(out[4], 1);
    EXPECT_EQ(out[5], 2);
    r.flags = static_cast<uint16_t>(out[6] << 8 | out[7]);
    EXPECT_TRUE(std::equal(nonce.begin(), nonce.end(), out.begin() + 8));
    r.json.assign(out.begin() + kHeaderSize, out.begin() + static_cast<std::ptrdiff_t>(size));
    return r;
}

const char* const kFp = "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b";

// INFO() of tests/discovery-vectors/generate.mjs: a device running tank-demo.
DeviceInfo tankDemo() {
    DeviceInfo d;
    d.deviceId = "4f9c2a8e-6d1b-4c3a-9e57-0b2f1d6c8a10";
    d.name = "BL335-01";
    d.model = "BL335";
    d.runtime = "0.4.0";
    d.api = "1.0.0";
    d.status = DeviceStatus::Running;
    d.project = ProjectInfo{
        "tank-demo", "Trạm bơm nước (demo Sprint 1)", "0.1.0",
        std::string("sha256:9f2c8e6d0a4b1c3e5f7a9b0d2c4e6f8a1b3d5e7f9a0c2e4f6a8b0d1c3e5f7a9b")};
    d.httpsPort = 8443;
    d.httpPort = 8080;
    d.fingerprint = std::string(kFp);
    return d;
}

LocalAddress lan() { return {net("192.168.1.110/24"), kMac}; }

std::string dumpReplace(const ojson& j) {
    return j.dump(-1, ' ', false, json::error_handler_t::replace);
}

// What a string becomes in the reply: invalid UTF-8 replaced by U+FFFD as nlohmann does it.
std::string replaced(const std::string& s) {
    return json::parse(dumpReplace(ojson(s))).get<std::string>();
}

size_t chars(const std::string& utf8) {
    size_t n = 0;
    for (unsigned char c : utf8) n += (c & 0xC0) != 0x80;
    return n;
}

// The JSON of contract §3 in its key order, as nlohmann writes it: the oracle for buildReply when
// nothing has to be cut. `withProject`/`withProjectName` describe the cuts of §5a.
ojson expectedJson(const DeviceInfo& i, const LocalAddress& l, bool withProject = true,
                   bool withProjectName = true) {
    ojson o;
    o["v"] = 1;
    o["id"] = i.deviceId;
    o["name"] = i.name;
    o["model"] = i.model;
    if (l.mac) {
        char m[18];
        std::snprintf(m, sizeof m, "%02X:%02X:%02X:%02X:%02X:%02X", (*l.mac)[0], (*l.mac)[1],
                      (*l.mac)[2], (*l.mac)[3], (*l.mac)[4], (*l.mac)[5]);
        o["mac"] = m;
    } else {
        o["mac"] = nullptr;
    }
    in_addr a{};
    a.s_addr = htonl(l.net.addr);
    char dotted[INET_ADDRSTRLEN];
    inet_ntop(AF_INET, &a, dotted, sizeof dotted);
    o["ip"] = dotted;
    int prefix = 0;
    for (uint32_t m = l.net.mask; m & 0x80000000u; m <<= 1) ++prefix;
    o["prefix"] = prefix;
    o["runtime"] = i.runtime;
    o["api"] = i.api;
    o["status"] = statusName(i.status);
    if (withProject) {
        if (i.project) {
            ojson p;
            p["id"] = i.project->id;
            if (withProjectName) p["name"] = i.project->name;
            p["version"] = i.project->version;
            p["digest"] = i.project->digest ? ojson(*i.project->digest) : ojson(nullptr);
            o["project"] = p;
        } else {
            o["project"] = nullptr;
        }
    }
    const bool fpOk = i.fingerprint && i.fingerprint->size() == 64 &&
                      i.fingerprint->find_first_not_of("0123456789abcdef") == std::string::npos;
    const bool https = fpOk && i.httpsPort >= 1 && i.httpsPort <= 65535;
    o["https"] = https ? i.httpsPort : 0;
    o["http"] = i.httpPort;
    o["fp"] = https ? ojson(*i.fingerprint) : ojson(nullptr);
    return o;
}

// The info with `runtime` padded so that the expected JSON (without project.name when
// !withProjectName) is exactly `target` bytes: the generator's way to force a cut.
DeviceInfo withJsonSize(DeviceInfo i, const LocalAddress& l, size_t target, bool withProjectName,
                        bool withProject = true) {
    i.runtime = "0.4.0-";
    const size_t base = dumpReplace(expectedJson(i, l, withProject, withProjectName)).size();
    EXPECT_LE(base, target);
    i.runtime += std::string(target - base, 'x');
    return i;
}

// The worst case of research R2 (worstInfo() of the generator): device name of 32 bytes, project
// name of 64 three-byte characters, 48-character project id, long version.
DeviceInfo worst() {
    DeviceInfo d = tankDemo();
    d.name = "Trạm bơm Bến Lữ số 1234";
    std::string pname;
    const std::string letters = "ẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ";
    for (size_t i = 0; chars(pname) < 64; i = (i + 3) % letters.size())
        pname += letters.substr(i, 3);
    d.status = DeviceStatus::ProjectError;
    d.project = ProjectInfo{"he-thong-xu-ly-nuoc-thai-tap-trung-khu-cong-nghe", pname,
                            "12.345.6789-rc.1.build.20261011.a1b2c3d4e5f6a7b8c9d0e1f2a3b4",
                            "sha256:" + std::string(64, 'a')};
    d.httpsPort = 65535;
    d.httpPort = 65534;
    return d;
}

// ---------------------------------------------------------------------------------------------
// Shared vectors

TEST(DiscoveryVectors, EveryVectorIsRun) {
    // 45 vectors (contract §6, T014): query 18, rate 3, build 5 here; reply 19 for the Studio, and
    // here as datagrams that must get no reply. A new vector changes these counts: run it first.
    std::map<std::string, int> kinds;
    for (const auto& n : vectorNames()) {
        const json v = json::parse(readFile(kVectors + "/" + n));
        const std::string kind = v["kind"];
        EXPECT_EQ(n.rfind(kind + "-", 0), 0u) << n;
        ++kinds[kind];
    }
    const std::map<std::string, int> want{{"build", 5}, {"query", 18}, {"rate", 3}, {"reply", 19}};
    EXPECT_EQ(kinds, want);
}

TEST(DiscoveryVectors, Query) {
    const auto vectors = vectorsOf("query");
    ASSERT_EQ(vectors.size(), 18u);
    for (const auto& [name, v] : vectors) {
        SCOPED_TRACE(name);
        const auto packet = unhex(v["packet"].get<std::string>());
        const Iface iface = cardOf(v["iface"]);
        const uint32_t source = ip(v["source"]["ip"].get<std::string>());
        Responder r;
        const Decision d =
            r.check(datagram(packet, source, v["source"]["port"].get<int>(), &iface), 0);
        const Counters c = r.counters();
        EXPECT_EQ(c.replies, 0u);  // check() sends nothing
        if (v["expect"]["reply"].get<bool>()) {
            EXPECT_EQ(dropName(d.drop), "none");
            EXPECT_EQ(d.nonce, kNonce);
            // The answer leaves from the interface address whose subnet holds the source.
            EXPECT_TRUE(d.local.contains(source));
            EXPECT_TRUE(std::any_of(iface.addrs.begin(), iface.addrs.end(), [&](const Ipv4Net& a) {
                return a.addr == d.local.addr && a.mask == d.local.mask;
            }));
            EXPECT_EQ(drops(c), 0u);
        } else {
            const std::string reason = v["expect"]["reason"].get<std::string>();
            EXPECT_EQ(dropName(d.drop), reason);
            EXPECT_EQ(counterOf(c, reason), 1u);
            EXPECT_EQ(drops(c), 1u);
        }
    }
}

TEST(DiscoveryVectors, SecondAddressAnswersFromThatAddress) {
    const json v = json::parse(readFile(kVectors + "/query-source-second-address.json"));
    const auto packet = unhex(v["packet"].get<std::string>());
    const Iface iface = cardOf(v["iface"]);
    Responder r;
    const Decision d = r.check(datagram(packet, ip("10.10.3.7"), 50000, &iface), 0);
    EXPECT_EQ(dropName(d.drop), "none");
    EXPECT_EQ(d.local.addr, ip("10.10.0.5"));
    EXPECT_EQ(d.local.mask, mask(16));
}

TEST(DiscoveryVectors, Rate) {
    const auto vectors = vectorsOf("rate");
    ASSERT_EQ(vectors.size(), 3u);
    const auto q = query();
    for (const auto& [name, v] : vectors) {
        SCOPED_TRACE(name);
        const Iface iface = cardOf(v["iface"]);
        Responder r;
        std::vector<bool> got;
        uint64_t refused = 0;
        for (const auto& e : v["events"]) {
            const Decision d =
                r.check(datagram(q, ip(e["ip"].get<std::string>()), e["port"].get<int>(), &iface),
                        e["ms"].get<int64_t>());
            got.push_back(d.drop == Drop::None);
            if (d.drop == Drop::Rate) ++refused;
            EXPECT_TRUE(d.drop == Drop::None || d.drop == Drop::Rate) << dropName(d.drop);
        }
        EXPECT_EQ(got, v["expect"].get<std::vector<bool>>());
        EXPECT_EQ(r.counters().rate, refused);
    }
}

TEST(DiscoveryVectors, Build) {
    const auto vectors = vectorsOf("build");
    ASSERT_EQ(vectors.size(), 5u);
    for (const auto& [name, v] : vectors) {
        SCOPED_TRACE(name);
        const Nonce nonce = nonceOf(v["nonce"].get<std::string>());
        Packet out{};
        const size_t size = buildReply(nonce, infoOf(v["info"]), localOf(v["info"]), out);
        const Reply r = readReply(out, size, nonce);
        EXPECT_EQ(r.flags, v["expect"]["flags"].get<int>());
        ASSERT_TRUE(json::accept(r.json)) << r.json;
        EXPECT_EQ(json::parse(r.json), v["expect"]["json"]);
        EXPECT_LE(r.json.size(), kMaxJson);
        EXPECT_LE(size, kQuerySize);  // never longer than the query
        // Keys go in the order of contract §3, like the vector's packet: the same bytes.
        EXPECT_EQ(
            std::vector<uint8_t>(out.begin(), out.begin() + static_cast<std::ptrdiff_t>(size)),
            unhex(v["packet"].get<std::string>()));
    }
}

TEST(DiscoveryVectors, RepliesNeverGetAReply) {
    // A device's reply comes from port 8446 on the same subnet: it must be dropped as format, or
    // two devices could answer each other.
    const auto vectors = vectorsOf("reply");
    ASSERT_EQ(vectors.size(), 19u);
    const Iface iface = card({"192.168.1.110/24"});
    for (const auto& [name, v] : vectors) {
        SCOPED_TRACE(name);
        const auto packet = unhex(v["packet"].get<std::string>());
        Responder r;
        const Decision d = r.check(datagram(packet, ip("192.168.1.111"), 8446, &iface), 0);
        EXPECT_EQ(dropName(d.drop), "format");
        EXPECT_EQ(r.counters().format, 1u);
    }
}

// ---------------------------------------------------------------------------------------------
// Query (contract §2)

TEST(DiscoveryQuery, ExactlyTheLayoutOfTheContract) {
    const Nonce n{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16};
    const auto q = query(n);
    Nonce got{};
    ASSERT_TRUE(parseQuery(q.data(), q.size(), got));
    EXPECT_EQ(got, n);
    // Every byte but the nonce is fixed: magic, version, type, both flag bytes, all of the padding.
    for (size_t i = 0; i < kQuerySize; ++i) {
        if (i >= 8 && i < kHeaderSize) continue;
        auto bad = q;
        bad[i] ^= 0x01;
        EXPECT_FALSE(parseQuery(bad.data(), bad.size(), got)) << "byte " << i;
        bad[i] = q[i] ^ 0x80;
        EXPECT_FALSE(parseQuery(bad.data(), bad.size(), got)) << "byte " << i;
    }
    // Any nonce.
    const Nonce ones{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
                     0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff};
    const auto q2 = query(ones);
    EXPECT_TRUE(parseQuery(q2.data(), q2.size(), got));
    EXPECT_EQ(got, ones);
}

TEST(DiscoveryQuery, OnlyExactly1024Bytes) {
    auto q = query();
    Nonce got{};
    for (size_t size : {0u, 1u, 23u, 24u, 25u, 1000u, 1022u, 1023u})
        EXPECT_FALSE(parseQuery(q.data(), size, got)) << size;
    q.push_back(0);
    EXPECT_FALSE(parseQuery(q.data(), q.size(), got));
    EXPECT_FALSE(parseQuery(nullptr, 0, got));
}

TEST(DiscoveryQuery, ADatagramCutByTheBufferIsFormat) {
    // 1025 bytes or more arrive cut to the 1024-byte buffer, with MSG_TRUNC.
    const auto q = query();
    const Iface iface = card({"192.168.1.110/24"});
    Responder r;
    Datagram d = datagram(q, ip("192.168.1.20"), 50000, &iface);
    d.cut = true;
    EXPECT_EQ(dropName(r.check(d, 0).drop), "format");
    EXPECT_EQ(r.counters().format, 1u);
}

// ---------------------------------------------------------------------------------------------
// Source (contract §2, §5a)

TEST(DiscoverySource, OnASubnetOfTheReceivingInterface) {
    const Iface lan = card({"192.168.1.110/24"});
    auto a = replyAddress(ip("192.168.1.20"), lan);
    ASSERT_TRUE(a);
    EXPECT_EQ(a->addr, ip("192.168.1.110"));
    EXPECT_EQ(a->mask, mask(24));
    EXPECT_TRUE(replyAddress(ip("192.168.1.1"), lan));
    EXPECT_TRUE(replyAddress(ip("192.168.1.254"), lan));
    EXPECT_TRUE(replyAddress(ip("192.168.1.0"), lan));  // not in the list of contract §2
    // The interface's own address: a query looped back on the device (how T059 sends it).
    EXPECT_TRUE(replyAddress(ip("192.168.1.110"), lan));
    EXPECT_FALSE(replyAddress(ip("192.168.2.20"), lan));
    EXPECT_FALSE(replyAddress(ip("10.0.0.1"), lan));
    EXPECT_FALSE(replyAddress(ip("192.168.1.20"), card({})));  // no IPv4 address
}

TEST(DiscoverySource, OnlyTheSubnetsOfTheInterfaceThatReceived) {
    // BL335: a query that arrives on eth1 from the subnet of usb0 gets no reply (research R2).
    const Iface eth1 = card({"192.168.1.110/24"});
    const Iface usb0 = card({"10.64.0.2/30"});
    EXPECT_FALSE(replyAddress(ip("10.64.0.1"), eth1));
    EXPECT_TRUE(replyAddress(ip("10.64.0.1"), usb0));
}

TEST(DiscoverySource, SpecialAddressesNeverGetAReply) {
    // An interface on a /0 subnet would hold any source: the special ones are refused anyway.
    const Iface any = card({"10.0.0.1/0"});
    for (const char* s : {"0.0.0.0", "255.255.255.255", "224.0.0.0", "224.0.0.251",
                          "239.255.255.255", "127.0.0.1", "127.255.255.254"})
        EXPECT_FALSE(replyAddress(ip(s), any)) << s;
    for (const char* s : {"8.8.8.8", "223.255.255.255", "126.255.255.255", "128.0.0.1", "0.0.0.1"})
        EXPECT_TRUE(replyAddress(ip(s), any)) << s;
    // Loopback, also on the loopback interface itself.
    const Iface lo = card({"127.0.0.1/8"});
    EXPECT_FALSE(replyAddress(ip("127.0.0.1"), lo));
    EXPECT_FALSE(replyAddress(ip("127.0.0.2"), lo));
}

TEST(DiscoverySource, SubnetBroadcastNeverGetsAReply) {
    EXPECT_FALSE(replyAddress(ip("192.168.1.255"), card({"192.168.1.110/24"})));
    EXPECT_FALSE(replyAddress(ip("10.0.0.3"), card({"10.0.0.1/30"})));
    EXPECT_TRUE(replyAddress(ip("10.0.0.2"), card({"10.0.0.1/30"})));
    // The broadcast of one subnet of the interface is refused even when another holds it as host.
    const Iface two = card({"192.168.1.110/24", "192.168.0.5/16"});
    EXPECT_FALSE(replyAddress(ip("192.168.1.255"), two));
    EXPECT_FALSE(replyAddress(ip("192.168.255.255"), two));
    EXPECT_TRUE(replyAddress(ip("192.168.7.255"), two));
    // /31 and /32 have no broadcast (RFC 3021): both addresses of a /31 are hosts.
    EXPECT_TRUE(replyAddress(ip("10.0.0.1"), card({"10.0.0.0/31"})));
    EXPECT_TRUE(replyAddress(ip("10.0.0.0"), card({"10.0.0.1/31"})));
    EXPECT_TRUE(replyAddress(ip("10.0.0.7"), card({"10.0.0.7/32"})));
    EXPECT_FALSE(replyAddress(ip("10.0.0.8"), card({"10.0.0.7/32"})));
}

TEST(DiscoverySource, TheMostSpecificAddressAnswers) {
    const Iface iface = card({"10.0.0.1/8", "10.1.0.1/16", "192.168.1.110/24"});
    auto a = replyAddress(ip("10.1.2.3"), iface);
    ASSERT_TRUE(a);
    EXPECT_EQ(a->addr, ip("10.1.0.1"));
    a = replyAddress(ip("10.2.0.1"), iface);
    ASSERT_TRUE(a);
    EXPECT_EQ(a->addr, ip("10.0.0.1"));
}

// ---------------------------------------------------------------------------------------------
// Responder: order of the checks, counters

TEST(DiscoveryResponder, FormatThenSourceThenPortThenRate) {
    const Iface lan = card({"192.168.1.110/24"});
    const auto good = query();
    auto bad = query();
    bad[5] = 2;
    Responder r;
    EXPECT_EQ(dropName(r.check(datagram(bad, ip("10.0.0.1"), 53, &lan), 0).drop), "format");
    EXPECT_EQ(dropName(r.check(datagram(good, ip("10.0.0.1"), 53, &lan), 0).drop), "subnet");
    EXPECT_EQ(dropName(r.check(datagram(good, ip("192.168.1.20"), 53, nullptr), 0).drop), "subnet");
    EXPECT_EQ(dropName(r.check(datagram(good, ip("192.168.1.20"), 53, &lan), 0).drop), "port");
    const Counters c = r.counters();
    EXPECT_EQ(c.format, 1u);
    EXPECT_EQ(c.subnet, 2u);
    EXPECT_EQ(c.port, 1u);
    EXPECT_EQ(c.rate, 0u);
    EXPECT_EQ(c.replies, 0u);
}

TEST(DiscoveryResponder, SourcePortFrom1024) {
    const Iface lan = card({"192.168.1.110/24"});
    const auto q = query();
    Responder r;
    uint32_t host = ip("192.168.1.10");
    for (int port : {0, 1, 53, 123, 1023})
        EXPECT_EQ(dropName(r.check(datagram(q, host++, port, &lan), 0).drop), "port") << port;
    for (int port : {1024, 50000, 65535})
        EXPECT_EQ(dropName(r.check(datagram(q, host++, port, &lan), 0).drop), "none") << port;
    EXPECT_EQ(r.counters().port, 5u);
}

TEST(DiscoveryResponder, OnlyGoodDatagramsTakeTokens) {
    const Iface lan = card({"192.168.1.110/24"});
    const auto good = query();
    auto bad = query();
    bad[1023] = 1;
    const uint32_t a = ip("192.168.1.20");
    Responder r;
    for (int i = 0; i < 10; ++i) {
        r.check(datagram(bad, a, 50000, &lan), 0);
        r.check(datagram(good, a, 80, &lan), 0);
    }
    for (int i = 0; i < 3; ++i)
        EXPECT_EQ(dropName(r.check(datagram(good, a, 50000, &lan), 0).drop), "none") << i;
    EXPECT_EQ(dropName(r.check(datagram(good, a, 50000, &lan), 0).drop), "rate");
    const Counters c = r.counters();
    EXPECT_EQ(c.format, 10u);
    EXPECT_EQ(c.port, 10u);
    EXPECT_EQ(c.rate, 1u);
}

TEST(DiscoveryResponder, CountsReplies) {
    Responder r;
    r.countReply();
    r.countReply();
    EXPECT_EQ(r.counters().replies, 2u);
    EXPECT_EQ(drops(r.counters()), 0u);
}

TEST(DiscoveryResponder, NoAllocationPerDatagram) {
    const Iface iface = card({"192.168.1.110/24", "10.10.0.5/16"});
    const auto good = query();
    auto bad = query();
    bad[0] = 'X';
    std::vector<uint32_t> sources;  // more than the 64 entries of the rate table
    for (uint32_t i = 1; i <= 100; ++i) sources.push_back(ip("192.168.1.0") + i);
    const uint32_t outside = ip("172.16.0.1");
    const DeviceInfo info = worst();
    const LocalAddress local = lan();
    Responder r;
    Packet out{};
    size_t replies = 0;
    auto round = [&](int64_t t) {
        for (uint32_t s : sources) {
            const Decision d = r.check(datagram(good, s, 50000, &iface), t);
            if (d.drop == Drop::None && buildReply(d.nonce, info, local, out) > 0) {
                r.countReply();
                ++replies;
            }
            r.check(datagram(bad, s, 50000, &iface), t);
            r.check(datagram(good, outside, 50000, &iface), t);
            r.check(datagram(good, s, 80, &iface), t);
        }
    };
    round(0);  // first use of every table entry
    g_allocations = 0;
    g_counting = true;
    for (int64_t t = 1; t <= 20; ++t) round(t * 250);
    g_counting = false;
    EXPECT_EQ(g_allocations.load(), 0u);
    EXPECT_GT(replies, 20u);
}

// ---------------------------------------------------------------------------------------------
// Rate (contract §4, §5a), fake clock in ms

TEST(DiscoveryRate, BurstOfThreeThenOnePerSecond) {
    RateLimiter l;
    const uint32_t a = ip("192.168.1.20");
    EXPECT_TRUE(l.allow(a, 0));
    EXPECT_TRUE(l.allow(a, 0));
    EXPECT_TRUE(l.allow(a, 0));
    EXPECT_FALSE(l.allow(a, 0));
    EXPECT_FALSE(l.allow(a, 999));
    EXPECT_TRUE(l.allow(a, 1000));
    EXPECT_FALSE(l.allow(a, 1000));
    EXPECT_TRUE(l.allow(a, 3000));  // two tokens came back in 2 s
    EXPECT_TRUE(l.allow(a, 3000));
    EXPECT_FALSE(l.allow(a, 3000));
    // A long pause gives back at most 3.
    for (int i = 0; i < 3; ++i) EXPECT_TRUE(l.allow(a, 600000)) << i;
    EXPECT_FALSE(l.allow(a, 600000));
}

TEST(DiscoveryRate, TwentyPerSecondInAll) {
    RateLimiter l;
    uint32_t s = ip("192.168.1.1");
    for (int i = 0; i < 20; ++i) EXPECT_TRUE(l.allow(s++, 0)) << i;
    for (int i = 0; i < 5; ++i) EXPECT_FALSE(l.allow(s++, 0)) << i;
    EXPECT_FALSE(l.allow(s++, 49));
    EXPECT_TRUE(l.allow(s++, 50));  // one token per 50 ms
    EXPECT_FALSE(l.allow(s++, 50));
    int n = 0;
    for (int i = 0; i < 40; ++i) n += l.allow(s++, 2000);
    EXPECT_EQ(n, 20);  // the total never holds more than 20
}

TEST(DiscoveryRate, ARefusedSourceTakesNothingFromTheTotal) {
    RateLimiter l;
    const uint32_t a = ip("192.168.1.20");
    for (int i = 0; i < 3; ++i) EXPECT_TRUE(l.allow(a, 0));
    for (int i = 0; i < 10; ++i) EXPECT_FALSE(l.allow(a, 0));
    uint32_t s = ip("192.168.1.100");
    for (int i = 0; i < 17; ++i) EXPECT_TRUE(l.allow(s++, 0)) << i;
    EXPECT_FALSE(l.allow(s++, 0));
}

TEST(DiscoveryRate, AnEmptyTotalTakesNothingFromTheSource) {
    RateLimiter l;
    uint32_t s = ip("192.168.1.100");
    for (int i = 0; i < 20; ++i) EXPECT_TRUE(l.allow(s++, 0));
    const uint32_t a = ip("192.168.1.20");
    EXPECT_FALSE(l.allow(a, 0));  // the total is empty; a keeps its 3 tokens
    EXPECT_TRUE(l.allow(a, 50));
    EXPECT_TRUE(l.allow(a, 100));
    EXPECT_TRUE(l.allow(a, 150));
    EXPECT_FALSE(l.allow(a, 200));  // a is empty now, the total is not
    EXPECT_TRUE(l.allow(s++, 200));
}

TEST(DiscoveryRate, SixtyFourSourcesTheLeastRecentlySeenGoesFirst) {
    const uint32_t a = ip("192.168.1.20");
    for (const int others : {63, 64}) {
        SCOPED_TRACE(others);
        RateLimiter l;
        for (int i = 0; i < 3; ++i) EXPECT_TRUE(l.allow(a, 0));
        uint32_t s = ip("192.168.1.100");
        for (int i = 0; i < others; ++i) l.allow(s++, 1 + i);
        // 63 others: a is still known, with 0.9 tokens. 64 others: a was forgotten (seen least
        // recently), so it starts again with a full bucket.
        EXPECT_EQ(l.allow(a, 900), others == 64);
    }
}

TEST(DiscoveryRate, SeeingASourceKeepsIt) {
    RateLimiter l;
    const uint32_t a = ip("192.168.1.20");
    for (int i = 0; i < 3; ++i) EXPECT_TRUE(l.allow(a, 0));
    uint32_t s = ip("192.168.1.100");
    for (int i = 0; i < 63; ++i) l.allow(s++, 1 + i);
    EXPECT_FALSE(l.allow(a, 100));  // a is now the most recently seen
    l.allow(s++, 101);              // the 65th source pushes out the oldest other one
    EXPECT_FALSE(l.allow(a, 900));
}

TEST(DiscoveryRate, AClockGoingBackGivesNoToken) {
    RateLimiter l;
    const uint32_t a = ip("192.168.1.20");
    for (int i = 0; i < 3; ++i) EXPECT_TRUE(l.allow(a, 5000));
    EXPECT_FALSE(l.allow(a, 1000));
    EXPECT_FALSE(l.allow(a, 5999));
    EXPECT_TRUE(l.allow(a, 6000));
}

// ---------------------------------------------------------------------------------------------
// Reply (contract §3, §5a)

TEST(DiscoveryReply, HeaderAndEveryKeyOfTheContract) {
    const DeviceInfo info = tankDemo();
    Packet out{};
    const size_t size = buildReply(kNonce, info, lan(), out);
    const Reply r = readReply(out, size, kNonce);
    EXPECT_EQ(r.flags, 0);
    EXPECT_EQ(r.json, dumpReplace(expectedJson(info, lan())));
    ASSERT_TRUE(json::accept(r.json));
    ojson j = ojson::parse(r.json);
    std::vector<std::string> keys;
    for (const auto& [k, v] : j.items()) keys.push_back(k);
    EXPECT_EQ(keys, (std::vector<std::string>{"v", "id", "name", "model", "mac", "ip", "prefix",
                                              "runtime", "api", "status", "project", "https",
                                              "http", "fp"}));
    keys.clear();
    for (const auto& [k, v] : j["project"].items()) keys.push_back(k);
    EXPECT_EQ(keys, (std::vector<std::string>{"id", "name", "version", "digest"}));
    EXPECT_EQ(j["v"], 1);
    EXPECT_EQ(j["mac"], "C2:D9:CC:52:33:70");
    EXPECT_EQ(j["ip"], "192.168.1.110");
    EXPECT_EQ(j["prefix"], 24);
    EXPECT_EQ(j["https"], 8443);
    EXPECT_EQ(j["fp"], kFp);
}

TEST(DiscoveryReply, NoSecretCanGoOut) {
    // Whatever the device info holds, the reply has the keys of contract §3 and no other: there is
    // no field for a password, key, token, account, project content or path (Constitution V).
    const std::vector<std::string> allowed{"v",       "id",     "name",    "model", "mac",
                                           "ip",      "prefix", "runtime", "api",   "status",
                                           "project", "https",  "http",    "fp"};
    for (const DeviceInfo& info : {tankDemo(), worst()}) {
        Packet out{};
        const size_t size = buildReply(kNonce, info, lan(), out);
        json j = json::parse(readReply(out, size, kNonce).json);
        for (const auto& [k, v] : j.items())
            EXPECT_NE(std::find(allowed.begin(), allowed.end(), k), allowed.end()) << k;
        for (const auto& [k, v] : j["project"].items())
            EXPECT_TRUE(k == "id" || k == "name" || k == "version" || k == "digest") << k;
        EXPECT_EQ(j.dump().find("/"), std::string::npos);  // no path
    }
}

TEST(DiscoveryReply, StatusNames) {
    EXPECT_STREQ(statusName(DeviceStatus::Running), "running");
    EXPECT_STREQ(statusName(DeviceStatus::NoProject), "no-project");
    EXPECT_STREQ(statusName(DeviceStatus::ProjectError), "project-error");
    EXPECT_STREQ(statusName(DeviceStatus::Activating), "activating");
    for (DeviceStatus s : {DeviceStatus::Running, DeviceStatus::NoProject,
                           DeviceStatus::ProjectError, DeviceStatus::Activating}) {
        DeviceInfo info = tankDemo();
        info.status = s;
        Packet out{};
        const size_t size = buildReply(kNonce, info, lan(), out);
        EXPECT_EQ(json::parse(readReply(out, size, kNonce).json)["status"], statusName(s));
    }
}

TEST(DiscoveryReply, NoProjectAndNoDigestAreNull) {
    DeviceInfo info = tankDemo();
    info.project->digest.reset();  // until the runtime computes the digest of its project (T044)
    Packet out{};
    size_t size = buildReply(kNonce, info, lan(), out);
    json j = json::parse(readReply(out, size, kNonce).json);
    EXPECT_TRUE(j["project"]["digest"].is_null());
    EXPECT_EQ(j["project"]["id"], "tank-demo");
    info.project.reset();
    info.status = DeviceStatus::NoProject;
    size = buildReply(kNonce, info, lan(), out);
    const Reply r = readReply(out, size, kNonce);
    EXPECT_EQ(r.flags, 0);
    j = json::parse(r.json);
    ASSERT_TRUE(j.contains("project"));
    EXPECT_TRUE(j["project"].is_null());
}

TEST(DiscoveryReply, HttpsAndFingerprintOnlyTogether) {
    struct Case {
        int port;
        std::optional<std::string> fp;
        bool https;
    };
    const std::string good = kFp;
    std::string upper = good;
    std::transform(upper.begin(), upper.end(), upper.begin(), ::toupper);
    const std::vector<Case> cases{
        {8443, good, true},
        {1, good, true},
        {65535, good, true},
        {0, good, false},                     // HTTPS off
        {8443, std::nullopt, false},          // certificate error
        {8443, upper, false},                 // not lowercase
        {8443, good.substr(0, 63), false},    // 63 hex
        {8443, good + "0", false},            // 65 hex
        {8443, "g" + good.substr(1), false},  // not hex
        {8443, std::string(""), false},
        {-1, good, false},
        {65536, good, false},
    };
    for (const auto& c : cases) {
        SCOPED_TRACE(std::to_string(c.port) + " " + c.fp.value_or("(none)"));
        DeviceInfo info = tankDemo();
        info.httpsPort = c.port;
        info.fingerprint = c.fp;
        Packet out{};
        const size_t size = buildReply(kNonce, info, lan(), out);
        json j = json::parse(readReply(out, size, kNonce).json);
        EXPECT_EQ(j["https"], c.https ? c.port : 0);
        if (c.https)
            EXPECT_EQ(j["fp"], good);
        else
            EXPECT_TRUE(j["fp"].is_null());
    }
}

TEST(DiscoveryReply, AddressOfTheReceivingInterface) {
    DeviceInfo info = tankDemo();
    Packet out{};
    for (const char* cidr : {"10.10.0.5/16", "172.17.0.2/16", "192.168.100.110/24", "10.0.0.7/32",
                             "1.2.3.4/0", "255.255.255.254/31"}) {
        SCOPED_TRACE(cidr);
        LocalAddress l{net(cidr), kMac};
        const size_t size = buildReply(kNonce, info, l, out);
        const std::string text = readReply(out, size, kNonce).json;
        EXPECT_EQ(text, dumpReplace(expectedJson(info, l)));
    }
    LocalAddress noMac{net("192.168.1.110/24"), std::nullopt};
    const size_t size = buildReply(kNonce, info, noMac, out);
    EXPECT_TRUE(json::parse(readReply(out, size, kNonce).json)["mac"].is_null());
    LocalAddress lower{net("192.168.1.110/24"), Mac{0x0a, 0xbc, 0xde, 0xf0, 0x01, 0x23}};
    const size_t size2 = buildReply(kNonce, info, lower, out);
    EXPECT_EQ(json::parse(readReply(out, size2, kNonce).json)["mac"], "0A:BC:DE:F0:01:23");
}

TEST(DiscoveryReply, NameAndModelAtMost32Bytes) {
    DeviceInfo info = tankDemo();
    Packet out{};
    auto build = [&](const DeviceInfo& i) {
        const size_t size = buildReply(kNonce, i, lan(), out);
        return readReply(out, size, kNonce);
    };
    info.name = std::string(32, 'n');
    info.model = std::string(32, 'm');
    Reply r = build(info);
    EXPECT_EQ(r.flags, 0);
    EXPECT_EQ(json::parse(r.json)["name"], info.name);
    info.name = std::string(33, 'n');
    r = build(info);
    EXPECT_EQ(r.flags, kFlagTruncated);
    EXPECT_EQ(json::parse(r.json)["name"], std::string(32, 'n'));
    // 31 bytes and a 3-byte character: the character goes whole.
    info.name = std::string(31, 'n') + "ữ";
    r = build(info);
    EXPECT_EQ(r.flags, kFlagTruncated);
    EXPECT_EQ(json::parse(r.json)["name"], std::string(31, 'n'));
    info.name = "BL335-01";
    info.model = std::string(30, 'm') + "ữ";
    r = build(info);
    EXPECT_EQ(r.flags, kFlagTruncated);
    EXPECT_EQ(json::parse(r.json)["model"], std::string(30, 'm'));
}

TEST(DiscoveryReply, ProjectNameAtMost64Characters) {
    DeviceInfo info = worst();  // 64 three-byte characters: fits, no flag (vector too)
    Packet out{};
    size_t size = buildReply(kNonce, info, lan(), out);
    Reply r = readReply(out, size, kNonce);
    EXPECT_EQ(r.flags, 0);
    EXPECT_EQ(json::parse(r.json)["project"]["name"], info.project->name);
    const std::string name64 = info.project->name;
    info.project->name += "Ỹ";  // 65 characters (the schema allows 80)
    size = buildReply(kNonce, info, lan(), out);
    r = readReply(out, size, kNonce);
    EXPECT_EQ(r.flags, kFlagTruncated);
    EXPECT_EQ(json::parse(r.json)["project"]["name"], name64);
    info.project->name = std::string(80, 'p');
    size = buildReply(kNonce, info, lan(), out);
    r = readReply(out, size, kNonce);
    EXPECT_EQ(r.flags, kFlagTruncated);
    EXPECT_EQ(json::parse(r.json)["project"]["name"], std::string(64, 'p'));
}

TEST(DiscoveryReply, StringsAreEscapedLikeNlohmann) {
    DeviceInfo info = tankDemo();
    info.name = "a\"b\\c/d\x01\x08\t\n\x0c\r\x1f\x7f";
    info.model = "M\"\\";
    info.runtime = "0.4.0-\x02";
    info.project->name = "Tên \"đặc biệt\" \\ /\x1b";
    info.project->version = "1.0.0\n";
    info.deviceId = "id\t";
    info.api = "\x7f";
    Packet out{};
    const size_t size = buildReply(kNonce, info, lan(), out);
    const Reply r = readReply(out, size, kNonce);
    EXPECT_EQ(r.flags, 0);
    EXPECT_EQ(r.json, dumpReplace(expectedJson(info, lan())));
    json j = json::parse(r.json);
    EXPECT_EQ(j["name"], info.name);
    EXPECT_EQ(j["project"]["name"], info.project->name);
}

TEST(DiscoveryReply, InvalidUtf8BecomesReplacementCharacters) {
    // One U+FFFD per maximal invalid subpart, as nlohmann's error_handler_t::replace: "\xe1\x80"
    // before an ASCII byte is one, a surrogate "\xed\xa0\x80" three, a cut sequence at the end one.
    DeviceInfo info = tankDemo();
    info.name =
        "A\xff"
        "B\xc3"
        "C\xe1\x80"
        "D\xed\xa0\x80";  // 22 bytes once replaced
    info.runtime =
        "E\xc0\xaf"
        "F\xf4\x90\x80\x80"
        "G\xe1";
    info.project->name = "\x80\x80Ọ";
    info.model = "\xf0\x9f\x98";  // a 4-byte sequence cut by the end
    Packet out{};
    const size_t size = buildReply(kNonce, info, lan(), out);
    const Reply r = readReply(out, size, kNonce);
    EXPECT_EQ(r.flags, 0);
    ASSERT_TRUE(json::accept(r.json)) << r.json;  // strict UTF-8
    EXPECT_EQ(r.json, dumpReplace(expectedJson(info, lan())));
    json j = json::parse(r.json);
    const std::string fffd = "\xef\xbf\xbd";
    EXPECT_EQ(j["name"], "A" + fffd + "B" + fffd + "C" + fffd + "D" + fffd + fffd + fffd);
    EXPECT_EQ(j["model"], fffd);
    EXPECT_EQ(j["project"]["name"], fffd + fffd + "Ọ");
}

TEST(DiscoveryReply, CutsInTheOrderOfTheContract) {
    const LocalAddress l = lan();
    Packet out{};
    // (0) exactly 1000 bytes with everything: no cut.
    DeviceInfo info = withJsonSize(worst(), l, kMaxJson, true);
    size_t size = buildReply(kNonce, info, l, out);
    Reply r = readReply(out, size, kNonce);
    EXPECT_EQ(r.flags, 0);
    EXPECT_EQ(r.json.size(), kMaxJson);
    EXPECT_EQ(size, kQuerySize);
    // (1) one byte over: project.name goes, nothing else.
    info = withJsonSize(worst(), l, kMaxJson + 1, true);
    size = buildReply(kNonce, info, l, out);
    r = readReply(out, size, kNonce);
    EXPECT_EQ(r.flags, kFlagTruncated);
    EXPECT_EQ(r.json, dumpReplace(expectedJson(info, l, true, false)));
    // (2) over without project.name too: name is cut to its longest prefix that fits.
    info = withJsonSize(worst(), l, kMaxJson + 1, false);  // name ends with "4": one byte
    size = buildReply(kNonce, info, l, out);
    r = readReply(out, size, kNonce);
    EXPECT_EQ(r.flags, kFlagTruncated);
    json j = json::parse(r.json);
    EXPECT_EQ(j["name"], "Trạm bơm Bến Lữ số 123");
    EXPECT_FALSE(j["project"].contains("name"));
    EXPECT_EQ(r.json.size(), kMaxJson);
    // (3) over even with an empty name: the project block goes, the name comes back whole.
    info = worst();
    info.name.clear();
    info = withJsonSize(info, l, kMaxJson + 1, false);
    info.name = worst().name;
    size = buildReply(kNonce, info, l, out);
    r = readReply(out, size, kNonce);
    EXPECT_EQ(r.flags, kFlagTruncated);
    j = json::parse(r.json);
    EXPECT_FALSE(j.contains("project"));
    EXPECT_EQ(j["name"], worst().name);
    EXPECT_LE(r.json.size(), kMaxJson);
    // (4) over even without the project and with an empty name: no reply at all.
    info = worst();
    info.name.clear();
    info = withJsonSize(info, l, kMaxJson + 1, false, false);
    info.name = "x";
    EXPECT_EQ(buildReply(kNonce, info, l, out), 0u);
}

TEST(DiscoveryReply, TheLongestNamePrefixThatFits) {
    // For each overshoot, name keeps the most characters that fit (characters of 1–3 bytes).
    const LocalAddress l = lan();
    DeviceInfo base = worst();
    base.name = "Trạm bơm Bến Lữ số 1234";  // 23 characters, 32 bytes
    for (size_t over = 1; over <= kMaxNameBytes; ++over) {
        SCOPED_TRACE(over);
        const DeviceInfo info = withJsonSize(base, l, kMaxJson + over, false);
        Packet out{};
        const size_t size = buildReply(kNonce, info, l, out);
        const Reply r = readReply(out, size, kNonce);
        EXPECT_EQ(r.flags, kFlagTruncated);
        ASSERT_LE(r.json.size(), kMaxJson);
        const std::string got = json::parse(r.json).value("name", std::string());
        ASSERT_EQ(base.name.compare(0, got.size(), got), 0) << got;  // a prefix
        if (got.size() < base.name.size()) {
            // One more character would not fit.
            size_t next = got.size() + 1;
            while (next < base.name.size() &&
                   (static_cast<unsigned char>(base.name[next]) & 0xC0) == 0x80)
                ++next;
            EXPECT_GT(r.json.size() + (next - got.size()), kMaxJson);
        }
    }
}

TEST(DiscoveryReply, NeverLongerThanTheQueryWhateverTheInput) {
    // Random device info: lengths up to well over the budget, bytes of every kind (quotes,
    // controls, invalid UTF-8). A reply is 0 bytes (none) or valid and at most 1024 bytes; with
    // no cut it is exactly nlohmann's output.
    std::mt19937 rng(20261011);
    auto randomText = [&](size_t maxLen) {
        std::uniform_int_distribution<size_t> len(0, maxLen);
        std::uniform_int_distribution<int> kind(0, 9);
        std::uniform_int_distribution<int> byte(0, 255);
        const char* const pool[] = {"ạ", "Ữ", "😀", "\"", "\\", "/", "\n", "\x01", "a", "Z"};
        std::string s;
        const size_t n = len(rng);
        while (s.size() < n) {
            const int k = kind(rng);
            if (k < 3)
                s += static_cast<char>(byte(rng));
            else
                s += pool[byte(rng) % 10];
        }
        return s;
    };
    std::uniform_int_distribution<int> coin(0, 9);
    std::uniform_int_distribution<int> port(-2, 65537);
    size_t cut = 0, whole = 0, none = 0;
    for (int iter = 0; iter < 3000; ++iter) {
        DeviceInfo i;
        const size_t scale = coin(rng) < 2 ? 1200 : 60;
        i.deviceId = randomText(scale);
        i.name = randomText(scale);
        i.model = randomText(scale);
        i.runtime = randomText(scale);
        i.api = randomText(scale);
        i.status = static_cast<DeviceStatus>(coin(rng) % 4);
        if (coin(rng) < 7) {
            ProjectInfo p{randomText(scale), randomText(scale), randomText(scale), std::nullopt};
            if (coin(rng) < 7) p.digest = randomText(scale);
            i.project = p;
        }
        i.httpsPort = port(rng);
        i.httpPort = port(rng) & 0xFFFF;
        if (coin(rng) < 5) i.fingerprint = coin(rng) < 5 ? std::string(kFp) : randomText(70);
        LocalAddress l{{static_cast<uint32_t>(rng()), mask(static_cast<int>(rng() % 33))},
                       std::nullopt};
        if (coin(rng) < 7) l.mac = Mac{1, 2, 3, 4, 5, 6};
        Packet out{};
        const size_t size = buildReply(kNonce, i, l, out);
        if (size == 0) {
            ++none;
            continue;
        }
        SCOPED_TRACE(iter);
        const Reply r = readReply(out, size, kNonce);
        ASSERT_TRUE(json::accept(r.json)) << r.json;
        ASSERT_LE(r.json.size(), kMaxJson);
        json j = json::parse(r.json);
        const std::string name = replaced(i.name);
        if (r.flags == 0) {
            ++whole;
            ASSERT_EQ(r.json, dumpReplace(expectedJson(i, l)));
        } else {
            ++cut;
            ASSERT_EQ(r.flags, kFlagTruncated);
            // Whatever was cut is a prefix of what the device has.
            const std::string gotName = j["name"];
            EXPECT_EQ(name.compare(0, gotName.size(), gotName), 0);
            const std::string gotModel = j["model"];
            EXPECT_EQ(replaced(i.model).compare(0, gotModel.size(), gotModel), 0);
            if (j.contains("project") && !j["project"].is_null() && j["project"].contains("name")) {
                const std::string gotProject = j["project"]["name"];
                EXPECT_EQ(replaced(i.project->name).compare(0, gotProject.size(), gotProject), 0);
                EXPECT_LE(chars(gotProject), kMaxProjectNameChars);
            }
            EXPECT_LE(gotName.size(), kMaxNameBytes);
            EXPECT_LE(gotModel.size(), kMaxNameBytes);
        }
    }
    // The run covered all three outcomes.
    EXPECT_GT(whole, 100u);
    EXPECT_GT(cut, 100u);
    EXPECT_GT(none, 10u);
}

}  // namespace
