// The discovery server of the runtime (see the header).
#include "server/discovery/discovery_server.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <pthread.h>
#include <sys/eventfd.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>
#include <chrono>
#include <cstring>
#include <system_error>
#include <utility>

namespace mat {

namespace {

// Datagrams read per wake-up of poll(), so that stop() is seen under a flood too.
constexpr int kBatch = 64;

int64_t steadyMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

// "<what>: <strerror(errno)>"; errno is read before anything can change it.
std::string sysError(const char* what) {
    const int e = errno;
    return std::string(what) + ": " + std::strerror(e);
}

}  // namespace

DiscoveryServer::DiscoveryServer(Options options, InfoFn info, Clock monoMs)
    : options_(options),
      infoFn_(std::move(info)),
      now_(monoMs ? std::move(monoMs) : Clock(steadyMs)) {}

DiscoveryServer::~DiscoveryServer() { stop(); }

bool DiscoveryServer::start(std::string& error) {
    if (!options_.enabled) return true;  // FR-004: no socket at all
    if (sock_ >= 0) {
        error = "discovery already started";
        return false;
    }
    if (options_.port < 0 || options_.port > 65535) {
        error = "bad UDP port " + std::to_string(options_.port);
        return false;
    }
    const int fd = ::socket(AF_INET, SOCK_DGRAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
    if (fd < 0) {
        error = sysError("cannot open a UDP socket");
        return false;
    }
    // Every address, so that the directed broadcast of each interface arrives. No SO_BROADCAST:
    // the socket can never send to a broadcast address, and no SO_REUSEADDR: nobody shares the
    // port.
    sockaddr_in sa{};
    sa.sin_family = AF_INET;
    sa.sin_addr.s_addr = htonl(INADDR_ANY);
    sa.sin_port = htons(static_cast<uint16_t>(options_.port));
    socklen_t len = sizeof sa;
    const int on = 1;
    int wake = -1;
    std::string why;
    if (::setsockopt(fd, IPPROTO_IP, IP_PKTINFO, &on, sizeof on) != 0) {
        why = sysError("IP_PKTINFO");
    } else if (::bind(fd, reinterpret_cast<sockaddr*>(&sa), sizeof sa) != 0) {
        why = sysError("cannot bind UDP port");
        why.insert(why.find(':'), " " + std::to_string(options_.port));
    } else if (::getsockname(fd, reinterpret_cast<sockaddr*>(&sa), &len) != 0) {
        why = sysError("getsockname");
    } else if ((wake = ::eventfd(0, EFD_CLOEXEC | EFD_NONBLOCK)) < 0) {
        why = sysError("eventfd");
    }
    if (!why.empty()) {
        ::close(fd);
        error = why;
        return false;
    }
    sock_ = fd;
    wake_ = wake;
    ifaces_ = std::make_unique<discovery::IfaceTable>(
        [fd](unsigned long request, void* arg) { return ::ioctl(fd, request, arg); }, now_);
    stopping_ = false;
    try {
        thread_ = std::thread([this] { run(); });
    } catch (const std::system_error& e) {
        error = std::string("cannot start the discovery thread: ") + e.what();
        ::close(sock_);
        ::close(wake_);
        sock_ = wake_ = -1;
        return false;
    }
    port_ = ntohs(sa.sin_port);
    return true;
}

void DiscoveryServer::stop() {
    port_ = 0;
    if (thread_.joinable()) {
        stopping_ = true;
        const uint64_t one = 1;
        const ssize_t n = ::write(wake_, &one, sizeof one);
        (void)n;  // the counter cannot overflow from one write; the flag is set anyway
        thread_.join();
    }
    if (sock_ >= 0) ::close(sock_);
    if (wake_ >= 0) ::close(wake_);
    sock_ = wake_ = -1;
}

void DiscoveryServer::run() {
    ::pthread_setname_np(::pthread_self(), "mat-discovery");
    pollfd fds[2] = {{sock_, POLLIN, 0}, {wake_, POLLIN, 0}};
    while (!stopping_.load()) {
        fds[0].revents = fds[1].revents = 0;
        if (::poll(fds, 2, -1) < 0) {
            if (errno != EINTR) ::poll(nullptr, 0, 100);  // ENOMEM: wait instead of spinning
            continue;
        }
        if (fds[1].revents != 0) break;
        if (fds[0].revents != 0) receiveBatch();  // POLLERR too: recvmsg reads the error
    }
}

void DiscoveryServer::receiveBatch() {
    for (int k = 0; k < kBatch; ++k) {
        sockaddr_in from{};
        iovec iov{buf_.data(), buf_.size()};
        alignas(cmsghdr) char control[CMSG_SPACE(sizeof(in_pktinfo))];
        msghdr msg{};
        msg.msg_name = &from;
        msg.msg_namelen = sizeof from;
        msg.msg_iov = &iov;
        msg.msg_iovlen = 1;
        msg.msg_control = control;
        msg.msg_controllen = sizeof control;
        const ssize_t n = ::recvmsg(sock_, &msg, MSG_DONTWAIT);
        if (n < 0) {
            if (errno == EINTR) continue;
            return;  // EAGAIN: nothing left
        }
        int ifindex = 0;  // unknown: dropped as "subnet"
        for (cmsghdr* c = CMSG_FIRSTHDR(&msg); c; c = CMSG_NXTHDR(&msg, c)) {
            if (c->cmsg_level == IPPROTO_IP && c->cmsg_type == IP_PKTINFO) {
                in_pktinfo info{};
                std::memcpy(&info, CMSG_DATA(c), sizeof info);
                ifindex = info.ipi_ifindex;
            }
        }
        const bool inet = from.sin_family == AF_INET && msg.msg_namelen >= sizeof from;
        handle(static_cast<size_t>(n), (msg.msg_flags & MSG_TRUNC) != 0,
               inet ? ntohl(from.sin_addr.s_addr) : 0, inet ? ntohs(from.sin_port) : 0, ifindex);
    }
}

void DiscoveryServer::handle(size_t size, bool cut, uint32_t source, uint16_t sourcePort,
                             int ifindex) {
    const int64_t now = now_();
    discovery::Datagram d;
    d.data = buf_.data();
    d.size = size;
    d.cut = cut;
    d.source = source;
    d.sourcePort = sourcePort;
    d.iface = ifindex > 0 ? ifaces_->find(ifindex) : nullptr;
    const discovery::Decision decision = responder_.check(d, now);
    if (decision.drop != discovery::Drop::None) return;
    const discovery::DeviceInfo* self = info(now);
    if (!self) return;
    // The query's nonce is in `decision`: the buffer now takes the reply.
    const size_t n =
        discovery::buildReply(decision.nonce, *self, {decision.local, d.iface->mac}, buf_);
    if (n == 0) return;

    // Unicast to the source, from the address of the receiving interface, out of that interface.
    sockaddr_in to{};
    to.sin_family = AF_INET;
    to.sin_addr.s_addr = htonl(source);
    to.sin_port = htons(sourcePort);
    iovec iov{buf_.data(), n};
    alignas(cmsghdr) char control[CMSG_SPACE(sizeof(in_pktinfo))] = {};
    msghdr msg{};
    msg.msg_name = &to;
    msg.msg_namelen = sizeof to;
    msg.msg_iov = &iov;
    msg.msg_iovlen = 1;
    msg.msg_control = control;
    msg.msg_controllen = sizeof control;
    cmsghdr* c = CMSG_FIRSTHDR(&msg);
    c->cmsg_level = IPPROTO_IP;
    c->cmsg_type = IP_PKTINFO;
    c->cmsg_len = CMSG_LEN(sizeof(in_pktinfo));
    in_pktinfo pktinfo{};
    pktinfo.ipi_ifindex = ifindex;
    pktinfo.ipi_spec_dst.s_addr = htonl(decision.local.addr);
    std::memcpy(CMSG_DATA(c), &pktinfo, sizeof pktinfo);
    if (::sendmsg(sock_, &msg, MSG_DONTWAIT | MSG_NOSIGNAL) == static_cast<ssize_t>(n))
        responder_.countReply();
}

const discovery::DeviceInfo* DiscoveryServer::info(int64_t nowMs) {
    if (!haveInfo_ || nowMs - infoAtMs_ >= kInfoMaxAgeMs || nowMs < infoAtMs_) {
        try {
            info_ = infoFn_();
        } catch (...) {
            return nullptr;  // no reply this time; asked again with the next query
        }
        haveInfo_ = true;
        infoAtMs_ = nowMs;
    }
    return &info_;
}

}  // namespace mat
