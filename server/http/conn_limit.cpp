#include "server/http/conn_limit.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>

#include <algorithm>
#include <cstring>

namespace mat {

int effectiveMaxConnPerSource(int configured, int httpsThreads) {
    const int share = httpsThreads * kMaxSourceSharePercent / 100;
    return std::max(1, std::min(configured, share));
}

std::string sourceAddress(const sockaddr* peer) {
    if (peer == nullptr) return "";
    char text[INET6_ADDRSTRLEN] = {0};
    if (peer->sa_family == AF_INET) {
        sockaddr_in a;
        std::memcpy(&a, peer, sizeof a);
        return ::inet_ntop(AF_INET, &a.sin_addr, text, sizeof text) ? text : "";
    }
    if (peer->sa_family == AF_INET6) {
        sockaddr_in6 a;
        std::memcpy(&a, peer, sizeof a);
        if (IN6_IS_ADDR_V4MAPPED(&a.sin6_addr)) {
            in_addr v4;
            std::memcpy(&v4, a.sin6_addr.s6_addr + 12, sizeof v4);
            return ::inet_ntop(AF_INET, &v4, text, sizeof text) ? text : "";
        }
        return ::inet_ntop(AF_INET6, &a.sin6_addr, text, sizeof text) ? text : "";
    }
    return "";
}

ConnLimiter::ConnLimiter(int maxPerSource) : max_(std::max(1, maxPerSource)) {}

bool ConnLimiter::acquire(const std::string& ip) {
    std::lock_guard<std::mutex> g(mu_);
    int& n = open_[ip];
    if (n >= max_) {
        if (n == 0) open_.erase(ip);
        ++refused_;
        return false;
    }
    ++n;
    return true;
}

void ConnLimiter::release(const std::string& ip) {
    std::lock_guard<std::mutex> g(mu_);
    const auto it = open_.find(ip);
    if (it == open_.end()) return;
    if (--it->second <= 0) open_.erase(it);
}

int ConnLimiter::count(const std::string& ip) const {
    std::lock_guard<std::mutex> g(mu_);
    const auto it = open_.find(ip);
    return it == open_.end() ? 0 : it->second;
}

size_t ConnLimiter::sources() const {
    std::lock_guard<std::mutex> g(mu_);
    return open_.size();
}

uint64_t ConnLimiter::refused() const {
    std::lock_guard<std::mutex> g(mu_);
    return refused_;
}

}  // namespace mat
