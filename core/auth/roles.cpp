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
        {"GET", "/api/v1/device/identity", false, Role::Viewer, false, false},
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
        {"POST", "/api/v1/tags/write", true, Role::Operator, true, true},
        {"GET", "/api/v1/tags/write/{requestId}", true, Role::Operator, false, false},
        {"GET", "/api/v1/tags/write", true, Role::Operator, false, false},
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
