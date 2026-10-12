// The IPv4 interfaces of the device, for discovery (feature 005; research R2,
// contracts/discovery.md §2): the addresses and netmasks of the interface that received a query
// (IP_PKTINFO gives its index), and its MAC for the reply.
//
// Read with ioctl(2) on an AF_INET datagram socket (SIOCGIFCONF, SIOCGIFNETMASK, SIOCGIFHWADDR,
// SIOCGIFINDEX), not with netlink or getifaddrs() (glibc's uses netlink): the systemd unit keeps
// RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX. IfaceTable reads again at most every 30 s.
#pragma once
#include <array>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace mat::discovery {

// One IPv4 address of an interface with its netmask, both in host byte order.
struct Ipv4Net {
    uint32_t addr = 0;
    uint32_t mask = 0;

    // Leading one bits of the mask (Linux netmasks are contiguous): 0–32.
    int prefix() const;
    bool contains(uint32_t ip) const { return (ip & mask) == (addr & mask); }
    // The directed broadcast address of the subnet; none for /31 and /32, where every address is a
    // host (RFC 3021).
    std::optional<uint32_t> broadcast() const;
};

// The netmask of a prefix length (0–32).
uint32_t maskOfPrefix(int prefix);

using Mac = std::array<uint8_t, 6>;

struct Iface {
    int index = 0;               // interface index, as IP_PKTINFO reports it
    std::string name;            // "eth1"; an alias label such as "eth1:0" counts as eth1
    std::optional<Mac> mac;      // Ethernet address; none for other kinds (lo, ppp, tun) or zeros
    std::vector<Ipv4Net> addrs;  // every IPv4 address, in SIOCGIFCONF order
};

// ioctl(2) on one AF_INET datagram socket; injectable for tests.
using IoctlFn = std::function<int(unsigned long request, void* arg)>;

// Reads the interfaces that have an IPv4 address, one Iface per interface index: a second address,
// or an alias label, adds to its interface. An address whose index or netmask cannot be read is
// left out; a failed SIOCGIFHWADDR leaves the MAC out. Empty when SIOCGIFCONF fails.
std::vector<Iface> readInterfaces(const IoctlFn& ioctlFn);

// readInterfaces(), kept for kMaxAgeMs.
class IfaceTable {
   public:
    static constexpr int64_t kMaxAgeMs = 30000;  // research R2
    using Clock = std::function<int64_t()>;      // monotonic ms

    IfaceTable(IoctlFn ioctlFn, Clock monoMs);

    // The interface with this index, or nullptr. Reads the interfaces first when they have never
    // been read or were read kMaxAgeMs ago or more. The pointer is valid until the next call.
    // Allocates only when it reads.
    const Iface* find(int index);

   private:
    IoctlFn ioctl_;
    Clock now_;
    std::vector<Iface> ifaces_;
    bool loaded_ = false;
    int64_t loadedAtMs_ = 0;
};

}  // namespace mat::discovery
