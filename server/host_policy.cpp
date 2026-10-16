#include "server/host_policy.hpp"

#include <arpa/inet.h>

#include <algorithm>
#include <cstdint>
#include <exception>
#include <optional>
#include <utility>

#include "core/common/json_text.hpp"

namespace mat {

namespace {

constexpr const char* kNotAllowedBody =
    R"({"error":{"code":"HOST_NOT_ALLOWED","message":"Tên này chưa được phép. Quản trị viên: thêm vào allowedHosts của runtime.json."}})";
constexpr const char* kBadRequestBody =
    R"({"error":{"code":"BAD_REQUEST","message":"Tiêu đề Host thiếu hoặc không hợp lệ."}})";

bool isSpace(char c) { return c == ' ' || c == '\t'; }
bool isControl(unsigned char c) { return c < 0x20 || c == 0x7F; }

std::string lower(std::string_view s) {
    std::string out(s);
    for (char& c : out)
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    return out;
}

// A name as the table compares it: lower case, one trailing dot dropped.
std::string canonicalName(std::string_view s) {
    std::string n = lower(s);
    if (!n.empty() && n.back() == '.') n.pop_back();
    return n;
}

// Characters of a host name (RFC 1123 plus `_`, which some LANs use): anything else is malformed.
bool nameChar(char c) {
    return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '.' || c == '_';
}

// "" or 1-65535 in decimal (RFC 3986 allows an empty port).
bool validPort(std::string_view p) {
    if (p.empty()) return true;
    if (p.size() > 5) return false;
    uint32_t v = 0;
    for (char c : p) {
        if (c < '0' || c > '9') return false;
        v = v * 10 + static_cast<uint32_t>(c - '0');
    }
    return v >= 1 && v <= 65535;
}

struct Parsed {
    std::string name;  // lower case, without port, brackets or trailing dot
    bool ipv6 = false;
};

// Normalises a Host value (contract §1): trim, lower case, port split off (the last `:` unless in
// the brackets of IPv6), brackets dropped, one trailing dot dropped. nullopt: malformed (400).
std::optional<Parsed> parseHost(std::string_view raw) {
    size_t b = 0, e = raw.size();
    while (b < e && isSpace(raw[b])) ++b;
    while (e > b && isSpace(raw[e - 1])) --e;
    std::string_view v = raw.substr(b, e - b);
    for (char c : v)
        if (isControl(static_cast<unsigned char>(c))) return std::nullopt;
    const std::string s = lower(v);
    Parsed p;
    if (!s.empty() && s[0] == '[') {
        const size_t close = s.find(']');
        if (close == std::string::npos) return std::nullopt;
        const std::string rest = s.substr(close + 1);
        if (!rest.empty() && (rest[0] != ':' || !validPort(std::string_view(rest).substr(1))))
            return std::nullopt;
        p.name = s.substr(1, close - 1);
        in6_addr a{};
        if (p.name.empty() || ::inet_pton(AF_INET6, p.name.c_str(), &a) != 1) return std::nullopt;
        p.ipv6 = true;
        return p;
    }
    std::string_view name = s;
    const size_t colon = name.rfind(':');
    if (colon != std::string_view::npos) {
        if (!validPort(name.substr(colon + 1))) return std::nullopt;
        name = name.substr(0, colon);
        if (name.find(':') != std::string_view::npos) return std::nullopt;  // IPv6 without []
    }
    if (!name.empty() && name.back() == '.') name.remove_suffix(1);
    if (name.empty()) return std::nullopt;
    for (char c : name)
        if (!nameChar(c)) return std::nullopt;
    p.name = std::string(name);
    return p;
}

// detail.host: at most 64 bytes, printable ASCII only (the value is what a client sent).
std::string auditHost(const HostRequest& r) {
    std::string h = r.hosts.empty() ? std::string() : r.hosts.front().substr(0, kHostAuditMaxBytes);
    for (char& c : h) {
        const auto u = static_cast<unsigned char>(c);
        if (u < 0x20 || u >= 0x7F) c = '?';
    }
    return h;
}

}  // namespace

HostPolicy::HostPolicy(HostPolicyOptions o, Audit audit)
    : enabled_(o.enabled), audit_(std::move(audit)) {
    const auto add = [this](const std::string& n) {
        if (!n.empty() && std::find(names_.begin(), names_.end(), n) == names_.end())
            names_.push_back(n);
    };
    add("localhost");
    const std::string host = canonicalName(o.hostname);
    if (!host.empty()) {
        add(host);
        add(host + ".local");
    }
    for (const auto& h : o.allowedHosts) add(canonicalName(h));
}

bool HostPolicy::isIpv4Literal(std::string_view s) {
    int parts = 0;
    size_t i = 0;
    while (i <= s.size()) {
        const size_t dot = std::min(s.find('.', i), s.size());
        const std::string_view part = s.substr(i, dot - i);
        if (part.empty() || part.size() > 3 || (part.size() > 1 && part[0] == '0')) return false;
        int v = 0;
        for (char c : part) {
            if (c < '0' || c > '9') return false;
            v = v * 10 + (c - '0');
        }
        if (v > 255 || ++parts > 4) return false;
        i = dot + 1;
    }
    return parts == 4;
}

HostVerdict HostPolicy::check(const HostRequest& r) const {
    if (!enabled_) return HostVerdict::Accept;
    if (r.hosts.size() > 1) return HostVerdict::BadRequest;
    const bool blank =
        r.hosts.empty() || std::all_of(r.hosts[0].begin(), r.hosts[0].end(), isSpace);
    if (blank)  // a local tool speaking HTTP/1.0 sends no Host
        return r.http10 && r.loopback ? HostVerdict::Accept : HostVerdict::BadRequest;
    if (r.hosts[0].size() > kHostMaxBytes) return HostVerdict::BadRequest;
    const std::optional<Parsed> p = parseHost(r.hosts[0]);
    if (!p) return HostVerdict::BadRequest;
    if (p->ipv6 || isIpv4Literal(p->name)) return HostVerdict::Accept;
    if (std::find(names_.begin(), names_.end(), p->name) != names_.end())
        return HostVerdict::Accept;
    return HostVerdict::NotAllowed;
}

void HostPolicy::recordDenied(HostVerdict verdict, const HostRequest& request,
                              const std::string& path, const std::string& source, bool tls) const {
    if (!audit_ || verdict == HostVerdict::Accept) return;
    AuditEvent e(AuditAction::AccessDenied, AuditResult::Denied,
                 tls ? AuditChannel::Https : AuditChannel::Http, source);
    e.target = path;
    e.code = verdict == HostVerdict::NotAllowed ? "HOST_NOT_ALLOWED" : "BAD_REQUEST";
    e.detail = jsonText(nlohmann::json{{"reason", "host"}, {"host", auditHost(request)}});
    try {
        audit_(e);
    } catch (const std::exception&) {
        // The refusal stands; the audit log reports its own failures (system/info, stderr).
    }
}

nlohmann::json HostPolicy::acceptedHosts() const {
    return nlohmann::json{
        {"names", enabled_ ? nlohmann::json(names_) : nlohmann::json::array({"*"})},
        {"ips", nlohmann::json::array({"*"})}};
}

void HostPolicy::publishWarning(SystemWarnings& warnings) const {
    if (enabled_)
        warnings.clear("HOST_CHECK_OFF");
    else
        warnings.set("HOST_CHECK_OFF", nullptr);
}

int HostPolicy::status(HostVerdict v) {
    switch (v) {
        case HostVerdict::NotAllowed:
            return 421;
        case HostVerdict::BadRequest:
            return 400;
        case HostVerdict::Accept:
            break;
    }
    return 0;
}

std::string HostPolicy::body(HostVerdict v) {
    return v == HostVerdict::NotAllowed ? kNotAllowedBody : kBadRequestBody;
}

}  // namespace mat
