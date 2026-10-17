// The check of `Host` against DNS rebinding (specs/011-pilot-hardening/contracts/device-api-011.md
// §1, research R4; FR-011 to FR-013). A page of evil.example whose name is moved to the device's
// address reaches the runtime with `Host: evil.example` (and a matching Origin): only a name the
// device knows is served. IP literals are always accepted (a page cannot rebind a literal), so NAT
// and port forwarding keep working; other names must be the device's host name (and <name>.local),
// localhost, or be listed in runtime.json `allowedHosts`.
//
// Pure code: the CivetWeb hook (web_contexts.cpp, begin_request) gives it the Host headers of each
// request on both listeners, WebSocket upgrades included, before any handler, the source filter,
// the gate or a file. `hostCheck: "off"` disables the table and raises HOST_CHECK_OFF.
#pragma once
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "nlohmann/json.hpp"
#include "server/system_warnings.hpp"

namespace mat {

constexpr size_t kHostMaxBytes = 255;      // a longer Host header is 400
constexpr size_t kHostAuditMaxBytes = 64;  // detail.host of access.denied
// L1 of the security review of 011: refusals are written once per (source address, code) and
// minute; the others of the minute are counted, then summed in one row.
constexpr int64_t kHostDeniedWindowMs = 60000;
constexpr size_t kHostDeniedWindows = 256;  // windows kept at once (the oldest go first)

enum class HostVerdict {
    Accept,
    NotAllowed,  // 421 HOST_NOT_ALLOWED: a name the device does not serve
    BadRequest,  // 400 BAD_REQUEST: missing (HTTP/1.1), repeated or malformed Host
};

struct HostRequest {
    std::vector<std::string> hosts;  // the value of every Host header, as received
    bool http10 = false;             // HTTP/1.0: a missing Host is accepted from loopback
    bool loopback = false;           // the source is 127.0.0.0/8 or ::1
};

struct HostPolicyOptions {
    bool enabled = true;                    // runtime.json hostCheck: "strict" (true) or "off"
    std::string hostname;                   // gethostname() at start; "" = none
    std::vector<std::string> allowedHosts;  // runtime.json allowedHosts
    std::function<int64_t()> monoMs;        // the windows of the refusals; empty: steady clock
};

class HostPolicy {
   public:
    // Records access.denied; may throw (the audit log is unavailable): the refusal stands anyway.
    using Audit = std::function<void(const AuditEvent&)>;

    explicit HostPolicy(HostPolicyOptions options, Audit audit = {});

    bool enabled() const { return enabled_; }
    HostVerdict check(const HostRequest& request) const;
    // access.denied, target the path, code HOST_NOT_ALLOWED or BAD_REQUEST, detail
    // {"reason": "host", "host": <first Host, at most 64 bytes, printable>}. `source` is "IP:port"
    // or "[IPv6]:port". Thread-safe. Only the first refusal of a (source address, code) in a minute
    // is written; the others are counted, and when the minute is over (the next refusal, or
    // flushDenied) one row sums them: source the address, target "*", detail {"reason": "host",
    // "host": <the last one>, "repeated": n, "windowS": 60}.
    void recordDenied(HostVerdict verdict, const HostRequest& request, const std::string& path,
                      const std::string& source, bool tls) const;
    // Writes the sums of the minutes that are over (every minute with `all`: the runtime stops)
    // and forgets those windows. The runtime calls it every few seconds.
    void flushDenied(bool all = false) const;
    size_t deniedWindows() const;  // windows open now (tests)
    // device/identity.acceptedHosts: {"names": [...], "ips": ["*"]}; names ["*"] while off.
    nlohmann::json acceptedHosts() const;
    // HOST_CHECK_OFF while the check is off; cleared otherwise.
    void publishWarning(SystemWarnings& warnings) const;

    static int status(HostVerdict verdict);            // 421, 400; 0 for Accept
    static std::string body(HostVerdict verdict);      // the JSON body of the refusal
    static bool isIpv4Literal(std::string_view name);  // a.b.c.d, each 0-255, no leading zero

   private:
    struct Denied;  // the windows of the refusals, behind their own lock

    void write(const AuditEvent& e) const;

    bool enabled_;
    std::vector<std::string> names_;  // lower case, without a trailing dot, in listing order
    Audit audit_;
    std::function<int64_t()> mono_;
    std::shared_ptr<Denied> denied_;
};

}  // namespace mat
