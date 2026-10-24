#include "core/auth/roles.hpp"

#include <algorithm>

namespace mat {

namespace {

// "{name}" in the pattern matches one non-empty path segment; anything else byte for byte.
bool pathMatches(std::string_view pattern, std::string_view path) {
    size_t i = 0, j = 0;
    while (i < pattern.size()) {
        if (pattern[i] == '{') {
            const size_t close = pattern.find('}', i);
            if (close == std::string_view::npos) return false;
            size_t end = path.find('/', j);
            if (end == std::string_view::npos) end = path.size();
            if (end == j) return false;  // empty segment
            i = close + 1;
            j = end;
        } else {
            if (j >= path.size() || path[j] != pattern[i]) return false;
            ++i;
            ++j;
        }
    }
    return j == path.size();
}

}  // namespace

const char* roleName(Role r) {
    switch (r) {
        case Role::Viewer:
            return "viewer";
        case Role::Operator:
            return "operator";
        case Role::Engineer:
            return "engineer";
        case Role::Administrator:
            return "administrator";
    }
    return "";
}

std::optional<Role> parseRole(std::string_view name) {
    for (Role r : {Role::Viewer, Role::Operator, Role::Engineer, Role::Administrator})
        if (name == roleName(r)) return r;
    return std::nullopt;
}

bool roleAtLeast(Role have, Role need) { return static_cast<int>(have) >= static_cast<int>(need); }

const std::vector<EndpointRule>& endpointRules() {
    // method, path, session, lowest role, restarts the idle time, changes the device
    static const std::vector<EndpointRule> rules = {
        // §3 device and sign-in
        {"GET", "/api/v1/device/identity", false, Role::Viewer, false, false, true},
        {"POST", "/api/v1/auth/login", false, Role::Viewer, false, false},
        {"POST", "/api/v1/auth/logout", true, Role::Viewer, true, false},
        {"GET", "/api/v1/auth/session", true, Role::Viewer, false, false},
        // §4 project
        {"GET", "/api/v1/project/versions", true, Role::Engineer, true, false},
        {"GET", "/api/v1/project/manifest", true, Role::Engineer, true, false},
        {"GET", "/api/v1/project/package", true, Role::Engineer, true, false},
        {"POST", "/api/v1/project/deployments", true, Role::Engineer, true, true},
        {"GET", "/api/v1/project/deployments/{opId}", true, Role::Engineer, false, false},
        {"GET", "/api/v1/project/operation", true, Role::Engineer, false, false},
        {"POST", "/api/v1/project/restore", true, Role::Engineer, true, true},
        // §6 diagnostics
        {"GET", "/api/v1/diagnostics", true, Role::Viewer, false, false},
        // §7 audit
        {"GET", "/api/v1/audit", true, Role::Administrator, true, false},
        // device-api 1.1.0 (feature 006): the connection test and the tag writes. Polling for the
        // result of a write is not a person's request, so it does not restart the idle time.
        {"POST", "/api/v1/drivers/test", true, Role::Engineer, true, true},
        // feature 019 (contracts/opcua.md §4): endpoints and browse of an OPC UA server
        {"POST", "/api/v1/drivers/opcua/browse", true, Role::Engineer, true, false},
        // Polled by Studio: do not restart the idle time. The serial ports are a read of /sys.
        {"GET", "/api/v1/drivers/diagnostics", true, Role::Viewer, false, false},
        {"GET", "/api/v1/serial/ports", true, Role::Engineer, false, false},
        {"POST", "/api/v1/tags/write", true, Role::Operator, true, true, true},
        {"GET", "/api/v1/tags/write/{requestId}", true, Role::Operator, false, false, true},
        {"GET", "/api/v1/tags/write", true, Role::Operator, false, false, true},
        // device-api 1.2.0 (feature 007): the sign-in of the web page and its cookie session.
        // Last two columns: cookie allowed, entry point. Only login and logout are entry points;
        // touch restarts the idle time (a person is there), session does not (the page asks after
        // F5).
        {"POST", "/api/v1/web/login", false, Role::Viewer, false, false, true, true},
        {"POST", "/api/v1/web/logout", false, Role::Viewer, false, false, true, true},
        {"GET", "/api/v1/web/session", true, Role::Viewer, false, false, true},
        {"POST", "/api/v1/web/touch", true, Role::Viewer, true, false, true},
        // device-api 1.3.0 (feature 009, §1.1): alarms. The two reads are open to a viewer by the
        // source filter of the page (like projects/active), not by the session. Acknowledging and
        // shelving are the operator's and ride on the cookie of the page; disabling and enabling an
        // alarm are engineering work: Bearer only (cookieAllowed false, FR-091).
        {"GET", "/api/v1/alarms", false, Role::Viewer, false, false, true},
        {"GET", "/api/v1/alarms/history", false, Role::Viewer, false, false, true},
        {"POST", "/api/v1/alarms/ack", true, Role::Operator, true, true, true},
        {"POST", "/api/v1/alarms/shelve", true, Role::Operator, true, true, true},
        {"POST", "/api/v1/alarms/unshelve", true, Role::Operator, true, true, true},
        {"POST", "/api/v1/alarms/disable", true, Role::Engineer, true, true, false},
        {"POST", "/api/v1/alarms/enable", true, Role::Engineer, true, true, false},
        // device-api 1.4.0 (feature 010, contracts/history-api.md §1.1): reads of the history for
        // the page (cookie) and the tools (Bearer); GET only, viewer, HTTPS only like the rest.
        {"GET", "/api/v1/history/catalog", true, Role::Viewer, false, false, true},
        {"GET", "/api/v1/history/series", true, Role::Viewer, false, false, true},
        {"GET", "/api/v1/history/aggregate", true, Role::Viewer, false, false, true},
        {"GET", "/api/v1/history/rows", true, Role::Viewer, false, false, true},
        {"GET", "/api/v1/history/export.csv", true, Role::Viewer, false, false, true},
        // feature 011 (device-api-011 §4): logic. The state is a read for viewers and the page
        // (cookie, a poll: no idle restart); stopping the writes (administrator) and resetting a
        // block (engineer) change the device: Bearer only, cookieAllowed false.
        {"GET", "/api/v1/logic", true, Role::Viewer, false, false, true},
        // feature 015 (specs/015-reports/plan.md): the writes of logic for the report page (cookie,
        // viewer; page:reports for a person restricted by feature 013), a read: no idle restart.
        {"GET", "/api/v1/logic/events", true, Role::Viewer, false, false, true},
        {"POST", "/api/v1/logic/writes", true, Role::Administrator, true, true, false},
        {"POST", "/api/v1/logic/reset", true, Role::Engineer, true, true, false},
        // feature 011 (device-api-011 §3): OTA. Administrator, Bearer only (cookieAllowed false),
        // HTTPS like every route of the table. The state is polled by Studio during an update:
        // no idle restart.
        {"GET", "/api/v1/system/update", true, Role::Administrator, false, false, false},
        {"POST", "/api/v1/system/update", true, Role::Administrator, true, true, false},
        {"POST", "/api/v1/system/update/apply", true, Role::Administrator, true, true, false},
        {"POST", "/api/v1/system/update/cancel", true, Role::Administrator, true, true, false},
        {"POST", "/api/v1/system/update/rollback", true, Role::Administrator, true, true, false},
        // device-api 1.6.0 (feature 013, contracts/admin-api.md): the access of the page (open:
        // answered for the session it carries, or for an anonymous viewer when viewerLogin is
        // off), the own password, then the admin API: administrator, cookie or Bearer, HTTPS.
        {"GET", "/api/v1/web/access", false, Role::Viewer, false, false, true},
        {"POST", "/api/v1/web/password", true, Role::Viewer, true, true, true},
        {"GET", "/api/v1/admin/users", true, Role::Administrator, true, false, true},
        {"POST", "/api/v1/admin/users", true, Role::Administrator, true, true, true},
        {"POST", "/api/v1/admin/users/{name}", true, Role::Administrator, true, true, true},
        {"POST", "/api/v1/admin/users/{name}/password", true, Role::Administrator, true, true,
         true},
        {"POST", "/api/v1/admin/users/{name}/delete", true, Role::Administrator, true, true, true},
        {"GET", "/api/v1/admin/groups", true, Role::Administrator, true, false, true},
        {"POST", "/api/v1/admin/groups", true, Role::Administrator, true, true, true},
        {"POST", "/api/v1/admin/groups/{id}", true, Role::Administrator, true, true, true},
        {"POST", "/api/v1/admin/groups/{id}/delete", true, Role::Administrator, true, true, true},
        {"GET", "/api/v1/admin/access", true, Role::Administrator, true, false, true},
        {"POST", "/api/v1/admin/access", true, Role::Administrator, true, true, true},
        {"POST", "/api/v1/admin/access/cleanup", true, Role::Administrator, true, true, true},
        {"POST", "/api/v1/admin/access/restore", true, Role::Administrator, true, true, true},
        {"GET", "/api/v1/admin/effective", true, Role::Administrator, true, false, true},
        {"GET", "/api/v1/admin/audit", true, Role::Administrator, true, false, true},
    };
    return rules;
}

const EndpointRule* findEndpointRule(std::string_view method, std::string_view path) {
    for (const auto& r : endpointRules())
        if (method == r.method && pathMatches(r.path, path)) return &r;
    return nullptr;
}

std::string allowedMethods(std::string_view path) {
    std::vector<std::string_view> methods;
    for (const auto& r : endpointRules())
        if (pathMatches(r.path, path) &&
            std::find(methods.begin(), methods.end(), r.method) == methods.end())
            methods.push_back(r.method);
    std::string out;
    for (const auto m : methods) {
        if (!out.empty()) out += ", ";
        out += m;
    }
    return out;
}

}  // namespace mat
