// The IPv4 interfaces of the device, read with ioctl(2) only (research R2; see the header).
#include "core/discovery/iface_table.hpp"

#include <arpa/inet.h>
#include <net/if.h>
#include <net/if_arp.h>
#include <netinet/in.h>
#include <sys/ioctl.h>

#include <algorithm>
#include <cstring>
#include <utility>

namespace mat::discovery {

int Ipv4Net::prefix() const {
    int n = 0;
    for (uint32_t m = mask; m & 0x80000000u; m <<= 1) ++n;
    return n;
}

std::optional<uint32_t> Ipv4Net::broadcast() const {
    if (prefix() >= 31) return std::nullopt;
    return (addr & mask) | ~mask;
}

uint32_t maskOfPrefix(int prefix) {
    if (prefix <= 0) return 0;
    if (prefix >= 32) return 0xFFFFFFFFu;
    return ~uint32_t{0} << (32 - prefix);
}

namespace {

// SIOCGIFCONF answers as many entries as fit: start with room for 32 addresses, double while the
// answer fills the buffer, up to 1024.
constexpr size_t kFirstEntries = 32;
constexpr size_t kMaxEntries = 1024;

uint32_t addrOf(const sockaddr& sa) {
    sockaddr_in sin{};
    std::memcpy(&sin, &sa, sizeof sin);
    return ntohl(sin.sin_addr.s_addr);
}

ifreq requestFor(const std::string& name) {
    ifreq r{};
    std::strncpy(r.ifr_name, name.c_str(), IFNAMSIZ - 1);
    return r;
}

std::vector<ifreq> listAddresses(const IoctlFn& ioctlFn) {
    std::vector<ifreq> entries;
    for (size_t room = kFirstEntries;; room *= 2) {
        entries.assign(room, ifreq{});
        ifconf conf{};
        conf.ifc_len = static_cast<int>(room * sizeof(ifreq));
        conf.ifc_req = entries.data();
        if (ioctlFn(SIOCGIFCONF, &conf) != 0) return {};
        const size_t got = std::min(room, static_cast<size_t>(conf.ifc_len) / sizeof(ifreq));
        if (got < room || room >= kMaxEntries) {
            entries.resize(got);
            return entries;
        }
    }
}

// Ethernet hardware address; none for other kinds (loopback, PPP, tun) and for all zeros.
std::optional<Mac> macOf(const IoctlFn& ioctlFn, const std::string& name) {
    ifreq hw = requestFor(name);
    if (ioctlFn(SIOCGIFHWADDR, &hw) != 0 || hw.ifr_hwaddr.sa_family != ARPHRD_ETHER)
        return std::nullopt;
    Mac mac{};
    std::memcpy(mac.data(), hw.ifr_hwaddr.sa_data, mac.size());
    if (mac == Mac{}) return std::nullopt;
    return mac;
}

}  // namespace

std::vector<Iface> readInterfaces(const IoctlFn& ioctlFn) {
    std::vector<Iface> out;
    for (const ifreq& entry : listAddresses(ioctlFn)) {
        if (entry.ifr_addr.sa_family != AF_INET) continue;
        // The label of the address: the interface name, or an alias "eth1:0".
        const std::string label(entry.ifr_name, strnlen(entry.ifr_name, IFNAMSIZ));
        const std::string name = label.substr(0, label.find(':'));
        ifreq index = requestFor(name);
        if (ioctlFn(SIOCGIFINDEX, &index) != 0) continue;
        // Label and address together select this very address (4.4BSD style), so each address
        // of an interface gets its own netmask.
        ifreq netmask = entry;
        if (ioctlFn(SIOCGIFNETMASK, &netmask) != 0) continue;
        auto it = std::find_if(out.begin(), out.end(),
                               [&](const Iface& i) { return i.index == index.ifr_ifindex; });
        if (it == out.end()) {
            Iface iface;
            iface.index = index.ifr_ifindex;
            iface.name = name;
            iface.mac = macOf(ioctlFn, name);
            out.push_back(std::move(iface));
            it = out.end() - 1;
        }
        it->addrs.push_back({addrOf(entry.ifr_addr), addrOf(netmask.ifr_netmask)});
    }
    return out;
}

IfaceTable::IfaceTable(IoctlFn ioctlFn, Clock monoMs)
    : ioctl_(std::move(ioctlFn)), now_(std::move(monoMs)) {}

const Iface* IfaceTable::find(int index) {
    const int64_t now = now_();
    if (!loaded_ || now - loadedAtMs_ >= kMaxAgeMs || now < loadedAtMs_) {
        ifaces_ = readInterfaces(ioctl_);
        loaded_ = true;
        loadedAtMs_ = now;
    }
    for (const Iface& i : ifaces_)
        if (i.index == index) return &i;
    return nullptr;
}

}  // namespace mat::discovery
