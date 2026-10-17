// T057 (feature 005; research R2, contracts/discovery.md §2): the interface table built from a fake
// ioctl (SIOCGIFCONF, SIOCGIFNETMASK, SIOCGIFHWADDR, SIOCGIFINDEX, answered as the Linux kernel
// answers them): addresses, netmasks, broadcast, MAC and prefix per interface; several addresses on
// one interface; the 30 s cache on a fake clock. Then one read of the real interfaces of the test
// machine, through the same ioctl calls.
#include "core/discovery/iface_table.hpp"

#include <arpa/inet.h>
#include <gtest/gtest.h>
#include <net/if.h>
#include <net/if_arp.h>
#include <netinet/in.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>
#include <set>
#include <string>
#include <vector>

using namespace mat::discovery;

namespace {

uint32_t ip(const char* dotted) {
    in_addr a{};
    EXPECT_EQ(inet_pton(AF_INET, dotted, &a), 1) << dotted;
    return ntohl(a.s_addr);
}

uint32_t mask(int prefix) { return prefix == 0 ? 0 : ~uint32_t{0} << (32 - prefix); }

void putAddr(sockaddr& sa, uint32_t addr) {
    sockaddr_in sin{};
    sin.sin_family = AF_INET;
    sin.sin_addr.s_addr = htonl(addr);
    std::memcpy(&sa, &sin, sizeof sin);
}

uint32_t getAddr(const sockaddr& sa) {
    sockaddr_in sin{};
    std::memcpy(&sin, &sa, sizeof sin);
    return ntohl(sin.sin_addr.s_addr);
}

std::string baseName(const std::string& label) { return label.substr(0, label.find(':')); }

// The kernel's side of the ioctl calls (net/ipv4/devinet.c, net/core/dev_ioctl.c): one SIOCGIFCONF
// entry per IPv4 address, named by its label; SIOCGIFNETMASK matches label and address (4.4BSD
// style) and falls back to the label; SIOCGIFINDEX and SIOCGIFHWADDR drop an alias suffix.
struct FakeNet {
    struct Addr {
        std::string label;
        uint32_t addr;
        int prefix;
        int family = AF_INET;
    };
    struct Dev {
        std::string name;
        int index;
        unsigned short hwFamily;
        std::vector<uint8_t> hw;
    };
    std::vector<Addr> addrs;
    std::vector<Dev> devs;
    bool confFails = false;
    std::set<std::string> netmaskFails;  // labels
    std::set<std::string> hwFails;       // device names
    int confCalls = 0;
    int otherCalls = 0;

    const Dev* dev(const std::string& name) const {
        for (const auto& d : devs)
            if (d.name == baseName(name)) return &d;
        return nullptr;
    }

    int operator()(unsigned long request, void* arg) {
        if (request == SIOCGIFCONF) {
            ++confCalls;
            if (confFails) {
                errno = EINVAL;
                return -1;
            }
            auto* c = static_cast<ifconf*>(arg);
            const size_t room = static_cast<size_t>(c->ifc_len) / sizeof(ifreq);
            size_t n = 0;
            for (const auto& a : addrs) {
                if (n == room) break;
                ifreq r{};
                std::strncpy(r.ifr_name, a.label.c_str(), IFNAMSIZ - 1);
                putAddr(r.ifr_addr, a.addr);
                r.ifr_addr.sa_family = static_cast<sa_family_t>(a.family);
                c->ifc_req[n++] = r;
            }
            c->ifc_len = static_cast<int>(n * sizeof(ifreq));
            return 0;
        }
        ++otherCalls;
        auto* r = static_cast<ifreq*>(arg);
        const std::string name(r->ifr_name, strnlen(r->ifr_name, IFNAMSIZ));
        const Dev* d = dev(name);
        if (!d) {
            errno = ENODEV;
            return -1;
        }
        switch (request) {
            case SIOCGIFINDEX:
                r->ifr_ifindex = d->index;
                return 0;
            case SIOCGIFHWADDR:
                if (hwFails.count(d->name)) {
                    errno = EINVAL;
                    return -1;
                }
                r->ifr_hwaddr.sa_family = d->hwFamily;
                std::memset(r->ifr_hwaddr.sa_data, 0, sizeof r->ifr_hwaddr.sa_data);
                if (!d->hw.empty())  // memcpy of a null source is UB even for 0 bytes (UBSan, T059)
                    std::memcpy(r->ifr_hwaddr.sa_data, d->hw.data(), d->hw.size());
                return 0;
            case SIOCGIFNETMASK: {
                if (netmaskFails.count(name)) {
                    errno = EADDRNOTAVAIL;
                    return -1;
                }
                const bool byAddr = r->ifr_addr.sa_family == AF_INET;
                const uint32_t want = getAddr(r->ifr_addr);
                const Addr* hit = nullptr;
                for (const auto& a : addrs)
                    if (a.label == name && byAddr && a.addr == want) {
                        hit = &a;
                        break;
                    }
                if (!hit)
                    for (const auto& a : addrs)
                        if (a.label == name) {
                            hit = &a;
                            break;
                        }
                if (!hit) {
                    errno = EADDRNOTAVAIL;
                    return -1;
                }
                putAddr(r->ifr_netmask, mask(hit->prefix));
                return 0;
            }
            default:
                errno = ENOTTY;
                return -1;
        }
    }
};

const std::vector<uint8_t> kEth1Mac{0xc2, 0xd9, 0xcc, 0x52, 0x33, 0x70};

// The BL335's interfaces (docs/reports/device-profile.md): eth1 (LAN), usb0 (modem), eth2.
FakeNet bl335() {
    FakeNet n;
    n.devs = {{"lo", 1, ARPHRD_LOOPBACK, {0, 0, 0, 0, 0, 0}},
              {"eth1", 3, ARPHRD_ETHER, kEth1Mac},
              {"usb0", 5, ARPHRD_ETHER, {0x02, 0x1e, 0x10, 0x1f, 0x00, 0x00}},
              {"eth2", 4, ARPHRD_ETHER, {0xc2, 0xd9, 0xcc, 0x52, 0x33, 0x71}}};
    n.addrs = {{"lo", ip("127.0.0.1"), 8},
               {"eth1", ip("192.168.1.110"), 24},
               {"usb0", ip("10.64.0.2"), 30},
               {"eth2", ip("192.168.10.1"), 24}};
    return n;
}

IoctlFn fn(FakeNet& n) {
    return [&n](unsigned long request, void* arg) { return n(request, arg); };
}

const Iface* byName(const std::vector<Iface>& list, const std::string& name) {
    for (const auto& i : list)
        if (i.name == name) return &i;
    return nullptr;
}

// ---------------------------------------------------------------------------------------------

TEST(Ipv4Net, PrefixAndBroadcast) {
    EXPECT_EQ((Ipv4Net{ip("192.168.1.110"), mask(24)}).prefix(), 24);
    EXPECT_EQ((Ipv4Net{ip("192.168.1.110"), mask(24)}).broadcast(), ip("192.168.1.255"));
    EXPECT_EQ((Ipv4Net{ip("10.64.0.2"), mask(30)}).broadcast(), ip("10.64.0.3"));
    EXPECT_EQ((Ipv4Net{ip("172.17.0.2"), mask(16)}).broadcast(), ip("172.17.255.255"));
    EXPECT_EQ((Ipv4Net{ip("10.0.0.1"), mask(8)}).prefix(), 8);
    EXPECT_EQ((Ipv4Net{ip("10.0.0.1"), 0}).prefix(), 0);
    EXPECT_EQ((Ipv4Net{ip("10.0.0.1"), 0}).broadcast(), ip("255.255.255.255"));
    EXPECT_EQ((Ipv4Net{ip("10.0.0.1"), mask(32)}).prefix(), 32);
    // /31 and /32: no broadcast (RFC 3021).
    EXPECT_FALSE((Ipv4Net{ip("10.0.0.0"), mask(31)}).broadcast());
    EXPECT_FALSE((Ipv4Net{ip("10.0.0.7"), mask(32)}).broadcast());
    EXPECT_TRUE((Ipv4Net{ip("192.168.1.110"), mask(24)}).contains(ip("192.168.1.1")));
    EXPECT_FALSE((Ipv4Net{ip("192.168.1.110"), mask(24)}).contains(ip("192.168.2.1")));
}

TEST(Ipv4Net, MaskOfPrefix) {
    EXPECT_EQ(maskOfPrefix(0), 0u);
    EXPECT_EQ(maskOfPrefix(8), ip("255.0.0.0"));
    EXPECT_EQ(maskOfPrefix(24), ip("255.255.255.0"));
    EXPECT_EQ(maskOfPrefix(31), ip("255.255.255.254"));
    EXPECT_EQ(maskOfPrefix(32), ip("255.255.255.255"));
    for (int p = 0; p <= 32; ++p) EXPECT_EQ((Ipv4Net{0, maskOfPrefix(p)}).prefix(), p) << p;
}

TEST(IfaceTable, OneEntryPerInterface) {
    FakeNet net = bl335();
    const auto list = readInterfaces(fn(net));
    ASSERT_EQ(list.size(), 4u);
    const Iface* eth1 = byName(list, "eth1");
    ASSERT_NE(eth1, nullptr);
    EXPECT_EQ(eth1->index, 3);
    ASSERT_TRUE(eth1->mac);
    EXPECT_EQ(std::vector<uint8_t>(eth1->mac->begin(), eth1->mac->end()), kEth1Mac);
    ASSERT_EQ(eth1->addrs.size(), 1u);
    EXPECT_EQ(eth1->addrs[0].addr, ip("192.168.1.110"));
    EXPECT_EQ(eth1->addrs[0].mask, mask(24));
    EXPECT_EQ(eth1->addrs[0].prefix(), 24);
    EXPECT_EQ(eth1->addrs[0].broadcast(), ip("192.168.1.255"));
    const Iface* usb0 = byName(list, "usb0");
    ASSERT_NE(usb0, nullptr);
    EXPECT_EQ(usb0->index, 5);
    ASSERT_EQ(usb0->addrs.size(), 1u);
    EXPECT_EQ(usb0->addrs[0].prefix(), 30);
    EXPECT_EQ(usb0->addrs[0].broadcast(), ip("10.64.0.3"));
    const Iface* eth2 = byName(list, "eth2");
    ASSERT_NE(eth2, nullptr);
    EXPECT_EQ(eth2->index, 4);
    ASSERT_TRUE(eth2->mac);
    EXPECT_EQ((*eth2->mac)[5], 0x71);
    // Loopback: an address, no MAC (ARPHRD_LOOPBACK).
    const Iface* lo = byName(list, "lo");
    ASSERT_NE(lo, nullptr);
    EXPECT_EQ(lo->index, 1);
    EXPECT_FALSE(lo->mac);
    ASSERT_EQ(lo->addrs.size(), 1u);
    EXPECT_EQ(lo->addrs[0].addr, ip("127.0.0.1"));
    EXPECT_EQ(lo->addrs[0].prefix(), 8);
}

TEST(IfaceTable, SeveralAddressesOnOneInterface) {
    // A second address (same label) and an alias label "eth1:0" belong to eth1. Each address keeps
    // its own netmask: SIOCGIFNETMASK is asked with label and address.
    FakeNet net = bl335();
    net.addrs.push_back({"eth1", ip("10.10.0.5"), 16});
    net.addrs.push_back({"eth1:0", ip("172.20.1.1"), 28});
    const auto list = readInterfaces(fn(net));
    ASSERT_EQ(list.size(), 4u);
    const Iface* eth1 = byName(list, "eth1");
    ASSERT_NE(eth1, nullptr);
    ASSERT_EQ(eth1->addrs.size(), 3u);
    EXPECT_EQ(eth1->addrs[0].addr, ip("192.168.1.110"));
    EXPECT_EQ(eth1->addrs[0].prefix(), 24);
    EXPECT_EQ(eth1->addrs[1].addr, ip("10.10.0.5"));
    EXPECT_EQ(eth1->addrs[1].prefix(), 16);
    EXPECT_EQ(eth1->addrs[1].broadcast(), ip("10.10.255.255"));
    EXPECT_EQ(eth1->addrs[2].addr, ip("172.20.1.1"));
    EXPECT_EQ(eth1->addrs[2].prefix(), 28);
    EXPECT_EQ(eth1->index, 3);
    ASSERT_TRUE(eth1->mac);
}

TEST(IfaceTable, MacOnlyForEthernet) {
    FakeNet net = bl335();
    net.devs.push_back({"ppp0", 7, 512 /* ARPHRD_PPP */, {1, 2, 3, 4, 5, 6}});
    net.devs.push_back({"tun0", 8, 0xFFFE /* ARPHRD_NONE */, {}});
    net.devs.push_back({"veth0", 9, ARPHRD_ETHER, {0, 0, 0, 0, 0, 0}});
    net.addrs.push_back({"ppp0", ip("100.64.0.9"), 32});
    net.addrs.push_back({"tun0", ip("10.8.0.2"), 24});
    net.addrs.push_back({"veth0", ip("10.9.0.2"), 24});
    net.hwFails.insert("eth2");
    const auto list = readInterfaces(fn(net));
    ASSERT_EQ(list.size(), 7u);
    for (const char* name : {"ppp0", "tun0", "veth0", "eth2"}) {
        const Iface* i = byName(list, name);
        ASSERT_NE(i, nullptr) << name;
        EXPECT_FALSE(i->mac) << name;
        EXPECT_EQ(i->addrs.size(), 1u) << name;  // the address is still there
    }
    EXPECT_TRUE(byName(list, "eth1")->mac);
}

TEST(IfaceTable, AnAddressWithoutNetmaskOrIndexIsLeftOut) {
    FakeNet net = bl335();
    net.netmaskFails.insert("usb0");
    net.addrs.push_back({"gone0", ip("10.99.0.1"), 24});         // no such device: no index
    net.addrs.push_back({"eth1", ip("10.0.0.1"), 8, AF_INET6});  // not IPv4
    const auto list = readInterfaces(fn(net));
    EXPECT_EQ(byName(list, "usb0"), nullptr);
    EXPECT_EQ(byName(list, "gone0"), nullptr);
    ASSERT_NE(byName(list, "eth1"), nullptr);
    EXPECT_EQ(byName(list, "eth1")->addrs.size(), 1u);
    EXPECT_EQ(list.size(), 3u);
}

TEST(IfaceTable, ManyAddressesGrowTheBuffer) {
    FakeNet net = bl335();
    for (int i = 0; i < 100; ++i)
        net.addrs.push_back({"eth2", ip("10.20.0.0") + static_cast<uint32_t>(i) * 4 + 1, 30});
    const auto list = readInterfaces(fn(net));
    const Iface* eth2 = byName(list, "eth2");
    ASSERT_NE(eth2, nullptr);
    EXPECT_EQ(eth2->addrs.size(), 101u);
    EXPECT_EQ(eth2->addrs.back().addr, ip("10.20.0.0") + 99 * 4 + 1);
    EXPECT_GT(net.confCalls, 1);
}

TEST(IfaceTable, NoTableWhenSiocgifconfFails) {
    FakeNet net = bl335();
    net.confFails = true;
    EXPECT_TRUE(readInterfaces(fn(net)).empty());
}

TEST(IfaceTable, ReadAgainAfter30Seconds) {
    FakeNet net = bl335();
    int64_t now = 1000;
    IfaceTable table(fn(net), [&now] { return now; });
    EXPECT_EQ(net.confCalls, 0);  // nothing read before the first query
    const Iface* eth1 = table.find(3);
    ASSERT_NE(eth1, nullptr);
    EXPECT_EQ(eth1->name, "eth1");
    EXPECT_EQ(net.confCalls, 1);
    // The address changes (DHCP renewal); the table keeps the old one for 30 s.
    net.addrs[1].addr = ip("192.168.1.111");
    now += IfaceTable::kMaxAgeMs - 1;
    eth1 = table.find(3);
    ASSERT_NE(eth1, nullptr);
    EXPECT_EQ(eth1->addrs[0].addr, ip("192.168.1.110"));
    EXPECT_EQ(table.find(99), nullptr);  // unknown index: no extra read
    EXPECT_EQ(net.confCalls, 1);
    now += 1;
    eth1 = table.find(3);
    ASSERT_NE(eth1, nullptr);
    EXPECT_EQ(eth1->addrs[0].addr, ip("192.168.1.111"));
    EXPECT_EQ(net.confCalls, 2);
    // An interface that went away.
    net.addrs.erase(net.addrs.begin() + 2);  // usb0
    EXPECT_NE(table.find(5), nullptr);
    now += IfaceTable::kMaxAgeMs;
    EXPECT_EQ(table.find(5), nullptr);
    EXPECT_EQ(net.confCalls, 3);
}

TEST(IfaceTable, AFailedReadIsKeptFor30Seconds) {
    FakeNet net = bl335();
    net.confFails = true;
    int64_t now = 0;
    IfaceTable table(fn(net), [&now] { return now; });
    EXPECT_EQ(table.find(3), nullptr);
    EXPECT_EQ(table.find(3), nullptr);
    EXPECT_EQ(net.confCalls, 1);
    net.confFails = false;
    now += IfaceTable::kMaxAgeMs;
    EXPECT_NE(table.find(3), nullptr);
    EXPECT_EQ(net.confCalls, 2);
}

// The real interfaces of the test machine, read with the same ioctl calls on an AF_INET socket
// (no netlink): at least the loopback interface.
TEST(IfaceTable, ReadsTheInterfacesOfThisMachine) {
    const int fd = ::socket(AF_INET, SOCK_DGRAM | SOCK_CLOEXEC, 0);
    ASSERT_GE(fd, 0);
    const auto list = readInterfaces(
        [fd](unsigned long request, void* arg) { return ::ioctl(fd, request, arg); });
    ::close(fd);
    const Iface* lo = byName(list, "lo");
    ASSERT_NE(lo, nullptr);
    EXPECT_EQ(lo->index, static_cast<int>(if_nametoindex("lo")));
    EXPECT_FALSE(lo->mac);
    ASSERT_FALSE(lo->addrs.empty());
    EXPECT_EQ(lo->addrs[0].addr, ip("127.0.0.1"));
    EXPECT_EQ(lo->addrs[0].prefix(), 8);
    for (const auto& i : list) {
        EXPECT_EQ(i.index, static_cast<int>(if_nametoindex(i.name.c_str()))) << i.name;
        EXPECT_FALSE(i.addrs.empty()) << i.name;
    }
}

}  // namespace
