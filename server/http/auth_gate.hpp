// The gate of the engineering API (specs/005-device-online contracts/device-api.md §1.3, research
// R9, R10, ADR-011): every request to an endpoint of the roles table (core/auth/roles.hpp) passes
// here before its handler, in this order:
//   0. the path is an endpoint of the table (404 NOT_FOUND otherwise);
//   1. TLS: the request came over HTTPS (403 HTTPS_REQUIRED, FR-007);
//      then the method is one of the table for that path (405 with the Allow header);
//   2. session, when the endpoint needs one: a bearer token (401 AUTH_REQUIRED), known and alive
//      (401 SESSION_EXPIRED), from the address and account of the sign-in (401 SESSION_INVALID);
//   3. role at least the endpoint's (403 FORBIDDEN);
//   4. an operation that changes the device needs a working audit log (503 AUDIT_UNAVAILABLE).
// Refusals of steps 1–3 are recorded as access.denied (the audit log coalesces them per 60 s); a
// record that cannot be written changes nothing in the answer and is logged at most once a minute.
// The idle time of a session restarts only for the endpoints the table marks (requests a person
// makes), and only when access is granted.
//
// Independent of CivetWeb: the HTTP layer (engineering_api) fills a GateRequest from the
// connection. The path is CivetWeb's local_uri: decoded, without the query string.
#pragma once
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "core/audit/audit_log.hpp"
#include "core/auth/auth_log.hpp"
#include "core/auth/auth_service.hpp"
#include "core/auth/roles.hpp"

namespace mat {

struct GateRequest {
    std::string method;                        // "GET", "POST", …
    std::string path;                          // decoded path without the query string
    bool tls = false;                          // came over the HTTPS listener (is_ssl)
    std::optional<std::string> authorization;  // the Authorization header; nullopt: absent
    ClientAddress from;
};

struct GateDeps {
    // AuthService::authorize: steps 2 and 3. `refresh` is the refreshesSession of the endpoint.
    std::function<Access(std::string_view token, const ClientAddress& from, Role minRole,
                         bool refresh)>
        authorize;
    // Records access.denied (AuditLog::append); throws when it cannot. Empty: nothing recorded.
    AuditFn audit;
    // Step 4: the audit log can take records now. Empty: it cannot.
    std::function<bool()> auditAvailable;
    AuthLogFn log;                    // empty: stderr
    std::function<int64_t()> monoMs;  // throttles the log of audit failures; empty: bootTimeMs
};

struct GateDecision {
    int status = 0;                      // 0: through; otherwise the HTTP status of the refusal
    std::string error;                   // code of the refusal: "HTTPS_REQUIRED", …
    std::string allow;                   // 405: value of the Allow header
    const EndpointRule* rule = nullptr;  // the endpoint; nullptr only for 404
    Access access;  // through, on an endpoint with a session: user, role, remaining times
    bool through() const { return status == 0; }
};

class AuthGate {
   public:
    explicit AuthGate(GateDeps deps);
    AuthGate(const AuthGate&) = delete;
    AuthGate& operator=(const AuthGate&) = delete;

    // Thread-safe: CivetWeb workers call it at once.
    GateDecision check(const GateRequest& request);

   private:
    void recordDenied(const GateRequest& request, const GateDecision& decision);

    GateDeps deps_;
    AuthLogFn log_;
    std::function<int64_t()> mono_;
    struct Throttle;
    std::shared_ptr<Throttle> throttle_;
};

// The token of "Bearer <token>" (scheme in any case, one or more spaces, surrounding white space
// ignored); nullopt when the header holds no bearer credential.
std::optional<std::string_view> bearerToken(std::string_view authorization);

// The Vietnamese sentence of the "message" field for an error code of the gate (and of the
// sign-in endpoints); "" for an unknown code.
const char* gateMessage(std::string_view error);

}  // namespace mat
