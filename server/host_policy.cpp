#include "server/host_policy.hpp"

#include <arpa/inet.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <exception>
#include <map>
#include <mutex>
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

// "10.0.0.5:51234" -> "10.0.0.5", "[fe80::1]:8443" -> "fe80::1": a window counts an address,
// whatever the port of each connection.
std::string addressOf(const std::string& source) {
    if (!source.empty() && source[0] == '[') {
        const size_t end = source.find(']');
        std::string a = end == std::string::npos ? source : source.substr(1, end - 1);
        if (a.rfind("::ffff:", 0) == 0 && a.find('.') != std::string::npos)
            a = a.substr(7);  // an IPv4 client of a dual stack listener
        return a;
    }
    const size_t colon = source.find(':');
    if (colon != std::string::npos && source.find(':', colon + 1) == std::string::npos)
        return source.substr(0, colon);
    return source;
}

int64_t steadyMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

}  // namespace

struct HostPolicy::Denied {
    struct Window {
        int64_t openedMono = 0;
        int64_t repeated = 0;  // refusals after the first one, not written yet
        std::string host;      // of the last refusal (detail.host)
        bool tls = false;      // of the last refusal (the channel)
    };
    std::mutex mu;
    std::map<std::pair<std::string, std::string>, Window> windows;  // (address, code)
};

namespace {

AuditEvent summaryOf(const std::pair<std::string, std::string>& key, int64_t repeated,
                     const std::string& host, bool tls) {
    AuditEvent e(AuditAction::AccessDenied, AuditResult::Denied,
                 tls ? AuditChannel::Https : AuditChannel::Http, key.first);
    e.target = "*";
    e.code = key.second;
    e.detail = jsonText(nlohmann::json{{"reason", "host"},
                                       {"host", host},
                                       {"repeated", repeated},
                                       {"windowS", kHostDeniedWindowMs / 1000}});
    e.budget = AuditBudget::HostPolicy;  // T200 of 011: never the budget of failed sign-ins
    return e;
}

}  // namespace

HostPolicy::HostPolicy(HostPolicyOptions o, Audit audit)
    : enabled_(o.enabled),
      audit_(std::move(audit)),
      mono_(o.monoMs ? std::move(o.monoMs) : std::function<int64_t()>(steadyMs)),
      denied_(std::make_shared<Denied>()) {
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

void HostPolicy::write(const AuditEvent& e) const {
    try {
        audit_(e);
    } catch (const std::exception&) {
        // The refusal stands; the audit log reports its own failures (system/info, stderr).
    }
}

void HostPolicy::recordDenied(HostVerdict verdict, const HostRequest& request,
                              const std::string& path, const std::string& source, bool tls) const {
    if (!audit_ || verdict == HostVerdict::Accept) return;
    const std::string code =
        verdict == HostVerdict::NotAllowed ? "HOST_NOT_ALLOWED" : "BAD_REQUEST";
    const std::string host = auditHost(request);
    std::vector<AuditEvent> out;  // written after the lock
    {
        std::lock_guard<std::mutex> l(denied_->mu);
        const int64_t now = mono_();
        auto& windows = denied_->windows;
        const auto key = std::make_pair(addressOf(source), code);
        auto it = windows.find(key);
        if (it != windows.end() && now - it->second.openedMono < kHostDeniedWindowMs) {
            ++it->second.repeated;  // within the minute: counted only
            it->second.host = host;
            it->second.tls = tls;
            return;
        }
        if (it != windows.end()) {  // the minute is over: its sum, then a new minute
            if (it->second.repeated > 0)
                out.push_back(summaryOf(key, it->second.repeated, it->second.host, it->second.tls));
            windows.erase(it);
        }
        if (windows.size() >= kHostDeniedWindows) {  // the oldest window goes, its count written
            auto oldest =
                std::min_element(windows.begin(), windows.end(), [](const auto& a, const auto& b) {
                    return a.second.openedMono < b.second.openedMono;
                });
            if (oldest->second.repeated > 0)
                out.push_back(summaryOf(oldest->first, oldest->second.repeated, oldest->second.host,
                                        oldest->second.tls));
            windows.erase(oldest);
        }
        Denied::Window w;
        w.openedMono = now;
        w.host = host;
        w.tls = tls;
        windows.emplace(key, std::move(w));
        AuditEvent e(AuditAction::AccessDenied, AuditResult::Denied,
                     tls ? AuditChannel::Https : AuditChannel::Http, source);
        e.target = path;
        e.code = code;
        e.detail = jsonText(nlohmann::json{{"reason", "host"}, {"host", host}});
        e.budget = AuditBudget::HostPolicy;
        out.push_back(std::move(e));
    }
    for (const AuditEvent& e : out) write(e);
}

void HostPolicy::flushDenied(bool all) const {
    if (!audit_) return;
    std::vector<AuditEvent> out;
    {
        std::lock_guard<std::mutex> l(denied_->mu);
        const int64_t now = mono_();
        auto& windows = denied_->windows;
        for (auto it = windows.begin(); it != windows.end();) {
            if (!all && now - it->second.openedMono < kHostDeniedWindowMs) {
                ++it;
                continue;
            }
            if (it->second.repeated > 0)
                out.push_back(
                    summaryOf(it->first, it->second.repeated, it->second.host, it->second.tls));
            it = windows.erase(it);
        }
    }
    for (const AuditEvent& e : out) write(e);
}

size_t HostPolicy::deniedWindows() const {
    std::lock_guard<std::mutex> l(denied_->mu);
    return denied_->windows.size();
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
