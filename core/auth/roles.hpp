// Roles and the one permission table of the device API (specs/005-device-online research R10,
// contracts/device-api.md §1.3, §3–7, ADR-011). The HTTPS gate (server/http/auth_gate) reads only
// this table: an endpoint missing from it is not served. Stage 2 adds its endpoints (tag writes,
// role operator) as rows here.
#pragma once
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mat {

// Ordered: each role has every right of the roles below it. Operator has the rights of viewer
// until stage 2 (tag writes).
enum class Role { Viewer = 0, Operator = 1, Engineer = 2, Administrator = 3 };

const char* roleName(Role r);  // "viewer", "operator", "engineer", "administrator"
std::optional<Role> parseRole(std::string_view name);
bool roleAtLeast(Role have, Role need);

struct EndpointRule {
    const char* method;  // "GET" or "POST"
    const char* path;    // "{name}" matches one non-empty path segment
    bool needsSession;   // false: open without signing in (device identity, sign-in)
    Role minRole;        // with a session: the lowest role allowed (viewer: any account)
    // §1.3: a request a person makes restarts the idle time of the session; periodic polls
    // (diagnostics, session, operation progress) do not, so an unattended Studio still times out.
    bool refreshesSession;
    // §1.3 step 4: an operation that changes the device; refused with 503 AUDIT_UNAVAILABLE when
    // its audit record cannot be written first.
    bool changesDevice;
    // Feature 007 (device-api-1.2 §1.2, ADR-021 point 4): the page of an operator reaches this
    // endpoint with the cookie of its web session. Everything else answers a cookie with 403
    // SESSION_SCOPE.
    bool cookieAllowed = false;
    // The two entry points of the cookie (web/login, web/logout): no session is needed, but the
    // request must come from the page itself (Origin) and, to sign out of a session, carry its
    // CSRF token.
    bool webEntry = false;
};

// Every endpoint of device-api §3–7, in the order of the contract.
const std::vector<EndpointRule>& endpointRules();
// The rule of a request; `path` without the query string. nullptr: no such endpoint or method.
const EndpointRule* findEndpointRule(std::string_view method, std::string_view path);
// The methods of the table for `path`, "GET, POST" (the Allow header of a 405); "" when none.
std::string allowedMethods(std::string_view path);

}  // namespace mat
