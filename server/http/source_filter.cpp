#include "server/http/source_filter.hpp"

#include <arpa/inet.h>

#include <cstdint>
#include <cstring>

#include "nlohmann/json.hpp"

namespace mat {

namespace {

// IPv4 as host-order integer; false when the text is no dotted-quad.
bool parseV4(const std::string& s, uint32_t& out) {
    in_addr a{};
    if (s.empty() || s.find_first_not_of("0123456789.") != std::string::npos) return false;
    if (inet_pton(AF_INET, s.c_str(), &a) != 1) return false;
    out = ntohl(a.s_addr);
    return true;
}

bool privateV4(uint32_t a) {
    const uint32_t b1 = a >> 24, b2 = (a >> 16) & 0xFF;
    if (b1 == 10) return true;                            // 10.0.0.0/8
    if (b1 == 172 && b2 >= 16 && b2 <= 31) return true;   // 172.16.0.0/12
    if (b1 == 192 && b2 == 168) return true;              // 192.168.0.0/16
    if (b1 == 100 && b2 >= 64 && b2 <= 127) return true;  // 100.64.0.0/10
    if (b1 == 169 && b2 == 254) return true;              // 169.254.0.0/16
    if (b1 == 127) return true;                           // 127.0.0.0/8
    return false;
}

struct Parsed {
    bool ok = false;
    bool v6 = false;
    uint32_t v4 = 0;       // IPv4, or the mapped IPv4 of an ::ffff:a.b.c.d
    uint8_t b6[16] = {0};  // IPv6
    bool mapped = false;
};

Parsed parse(std::string s) {
    Parsed p;
    const size_t zone = s.find('%');
    if (zone != std::string::npos) s.erase(zone);  // fe80::1%eth0
    if (parseV4(s, p.v4)) {
        p.ok = true;
        return p;
    }
    if (s.empty() || s.find_first_not_of("0123456789abcdefABCDEF:.") != std::string::npos) return p;
    in6_addr a{};
    if (inet_pton(AF_INET6, s.c_str(), &a) != 1) return p;
    p.ok = true;
    p.v6 = true;
    std::memcpy(p.b6, a.s6_addr, 16);
    static const uint8_t kMapped[12] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0xFF};
    if (std::memcmp(p.b6, kMapped, 12) == 0) {
        p.mapped = true;
        p.v4 = (static_cast<uint32_t>(p.b6[12]) << 24) | (static_cast<uint32_t>(p.b6[13]) << 16) |
               (static_cast<uint32_t>(p.b6[14]) << 8) | p.b6[15];
    }
    return p;
}

}  // namespace

bool isPrivateSource(const std::string& addr) {
    const Parsed p = parse(addr);
    if (!p.ok) return false;
    if (!p.v6) return privateV4(p.v4);
    if (p.mapped) return privateV4(p.v4);
    if ((p.b6[0] & 0xFE) == 0xFC) return true;                     // fc00::/7
    if (p.b6[0] == 0xFE && (p.b6[1] & 0xC0) == 0x80) return true;  // fe80::/10
    static const uint8_t kLoop[16] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1};
    return std::memcmp(p.b6, kLoop, 16) == 0;  // ::1
}

bool isLoopbackSource(const std::string& addr) {
    const Parsed p = parse(addr);
    if (!p.ok) return false;
    if (!p.v6 || p.mapped) return (p.v4 >> 24) == 127;
    static const uint8_t kLoop[16] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1};
    return std::memcmp(p.b6, kLoop, 16) == 0;
}

std::optional<ViewerAccess> parseViewerAccess(const std::string& s) {
    if (s == "private") return ViewerAccess::Private;
    if (s == "any") return ViewerAccess::Any;
    if (s == "off") return ViewerAccess::Off;
    return std::nullopt;
}

const char* viewerAccessName(ViewerAccess a) {
    switch (a) {
        case ViewerAccess::Private:
            return "private";
        case ViewerAccess::Any:
            return "any";
        default:
            return "off";
    }
}

FilteredPath classifyPath(const std::string& u) {
    if (u == "/" || u == "/index.html") return FilteredPath::Page;
    if (u.rfind("/assets/", 0) == 0) return FilteredPath::Asset;
    if (u.rfind("/project/", 0) == 0) return FilteredPath::Project;
    if (u == "/api/v1/system/info") return FilteredPath::SystemInfo;
    if (u == "/api/v1/projects/active") return FilteredPath::ProjectsActive;
    if (u == "/api/v1/live") return FilteredPath::Live;
    return FilteredPath::None;
}

FilterDecision decideFilter(const FilterInput& in) {
    FilterDecision d;
    if (in.path == FilteredPath::None) return d;
    auto refuse = [&](const char* code) {
        d.allow = false;
        d.status = 403;
        d.error = code;
        return d;
    };
    if (in.hasAuthorization && !in.tls)
        return refuse("HTTPS_REQUIRED");  // a token never travels in clear
    if (in.validSession) return d;
    if (in.access == ViewerAccess::Any) return d;
    if (isLoopbackSource(in.remote)) return d;
    const bool priv = isPrivateSource(in.remote);
    if (in.access == ViewerAccess::Private) return priv ? d : refuse("SOURCE_NOT_ALLOWED");
    // off: the system info stays as in `private`, everything else is closed
    if (in.path == FilteredPath::SystemInfo) return priv ? d : refuse("SOURCE_NOT_ALLOWED");
    return refuse("VIEWER_OFF");
}

const char* filterMessage(const std::string& error) {
    if (error == "VIEWER_OFF") return "Trang xem đã bị tắt trên thiết bị này (viewerAccess = off).";
    if (error == "HTTPS_REQUIRED") return "Phiên đăng nhập chỉ dùng qua HTTPS.";
    return "Trang xem chỉ mở trong mạng nội bộ. Hãy kết nối qua VPN, hoặc nhờ quản trị đổi "
           "viewerAccess.";
}

std::string blockedPageHtml(const std::string& error) {
    return std::string(
               "<!doctype html><html lang=\"vi\"><head><meta charset=\"utf-8\">"
               "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
               "<title>Không truy cập được</title></head><body><h1>Không truy cập được</h1><p>") +
           filterMessage(error) + "</p></body></html>";
}

std::string blockedJson(const std::string& error) {
    return nlohmann::json{{"error", error}, {"message", filterMessage(error)}}.dump();
}

}  // namespace mat
