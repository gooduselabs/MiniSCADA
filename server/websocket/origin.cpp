#include "server/websocket/origin.hpp"

#include <algorithm>
#include <cctype>

namespace mat {

namespace {
std::string lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}
}  // namespace

bool isOriginAllowed(const char* origin, const char* hostHeader,
                     const std::vector<std::string>& allowed) {
    if (origin == nullptr || *origin == '\0') return true;
    const std::string o = lower(origin);
    for (const auto& a : allowed)
        if (o == lower(a)) return true;
    if (hostHeader == nullptr || *hostHeader == '\0') return false;
    return o == "http://" + lower(hostHeader);
}

}  // namespace mat
