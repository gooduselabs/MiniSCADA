// T030 (feature 005; research R10, contracts/device-api.md §1.3, §3–7, FR-014): roles and the one
// permission table.
// - Order viewer < operator < engineer < administrator; operator has the rights of viewer in
//   stage 1.
// - Each endpoint of device-api §3–7 has exactly one row: session or not, minimum role, whether it
//   restarts the idle time (§1.3), whether it changes the device (audit first).
// - The tests walk the whole table, so a row added in stage 2 (POST /api/v1/tags/write, operator)
//   is checked like the others; the contract list below changes with the contract.
#include "core/auth/roles.hpp"

#include <gtest/gtest.h>

#include <set>
#include <string>
#include <tuple>
#include <vector>

using namespace mat;

namespace {

struct Expected {
    std::string method, path;
    bool needsSession;
    Role minRole;
    bool refreshes, changes;
};

// device-api 1.0.0 §3–7 and §1.3, written out again by hand.
const std::vector<Expected> kContract = {
    {"GET", "/api/v1/device/identity", false, Role::Viewer, false, false},
    {"POST", "/api/v1/auth/login", false, Role::Viewer, false, false},
    {"POST", "/api/v1/auth/logout", true, Role::Viewer, true, false},
    {"GET", "/api/v1/auth/session", true, Role::Viewer, false, false},
    {"GET", "/api/v1/project/versions", true, Role::Engineer, true, false},
    {"GET", "/api/v1/project/manifest", true, Role::Engineer, true, false},
    {"GET", "/api/v1/project/package", true, Role::Engineer, true, false},
    {"POST", "/api/v1/project/deployments", true, Role::Engineer, true, true},
    {"GET", "/api/v1/project/deployments/{opId}", true, Role::Engineer, false, false},
    {"GET", "/api/v1/project/operation", true, Role::Engineer, false, false},
    {"POST", "/api/v1/project/restore", true, Role::Engineer, true, true},
    {"GET", "/api/v1/diagnostics", true, Role::Viewer, false, false},
    {"GET", "/api/v1/audit", true, Role::Administrator, true, false},
};

// device-api 1.1.0 (feature 006 T105, T144): the connection test and the tag writes (stage 2).
const std::vector<Expected> kContract11 = {
    {"POST", "/api/v1/drivers/test", true, Role::Engineer, true, true},
    {"POST", "/api/v1/tags/write", true, Role::Operator, true, true},
    {"GET", "/api/v1/tags/write/{requestId}", true, Role::Operator, false, false},
    {"GET", "/api/v1/tags/write", true, Role::Operator, false, false},
    {"GET", "/api/v1/drivers/diagnostics", true, Role::Viewer, false, false},
    {"GET", "/api/v1/serial/ports", true, Role::Engineer, false, false},
};

// device-api 1.2.0 (feature 007): the sign-in of the web page and its cookie session.
const std::vector<Expected> kContract12 = {
    {"POST", "/api/v1/web/login", false, Role::Viewer, false, false},
    {"POST", "/api/v1/web/logout", false, Role::Viewer, false, false},
    {"GET", "/api/v1/web/session", true, Role::Viewer, false, false},
    {"POST", "/api/v1/web/touch", true, Role::Viewer, true, false},
};

// device-api 1.3.0 (feature 009): alarms; the cookie column is checked in roles_alarm_test.cpp.
const std::vector<Expected> kContract13 = {
    {"GET", "/api/v1/alarms", false, Role::Viewer, false, false},
    {"GET", "/api/v1/alarms/history", false, Role::Viewer, false, false},
    {"POST", "/api/v1/alarms/ack", true, Role::Operator, true, true},
    {"POST", "/api/v1/alarms/shelve", true, Role::Operator, true, true},
    {"POST", "/api/v1/alarms/unshelve", true, Role::Operator, true, true},
    {"POST", "/api/v1/alarms/disable", true, Role::Engineer, true, true},
    {"POST", "/api/v1/alarms/enable", true, Role::Engineer, true, true},
};

// device-api 1.4.0 (feature 010, contracts/history-api.md §1.1)
const std::vector<Expected> kContract14 = {
    {"GET", "/api/v1/history/catalog", true, Role::Viewer, false, false},
    {"GET", "/api/v1/history/series", true, Role::Viewer, false, false},
    {"GET", "/api/v1/history/aggregate", true, Role::Viewer, false, false},
    {"GET", "/api/v1/history/rows", true, Role::Viewer, false, false},
    {"GET", "/api/v1/history/export.csv", true, Role::Viewer, false, false},
};

const Role kRoles[] = {Role::Viewer, Role::Operator, Role::Engineer, Role::Administrator};

// The path of a request for a row: every {name} segment filled in.
std::string concrete(const std::string& pattern) {
    std::string out;
    for (size_t i = 0; i < pattern.size(); ++i) {
        if (pattern[i] == '{') {
            out += "op-7f3a";
            i = pattern.find('}', i);
        } else {
            out += pattern[i];
        }
    }
    return out;
}

bool allowed(const EndpointRule& r, Role have) {
    return !r.needsSession || roleAtLeast(have, r.minRole);
}

}  // namespace

TEST(Roles, OrderAndNames) {
    for (size_t i = 0; i < 4; ++i)
        for (size_t j = 0; j < 4; ++j)
            EXPECT_EQ(roleAtLeast(kRoles[i], kRoles[j]), i >= j) << i << " " << j;
    const char* names[] = {"viewer", "operator", "engineer", "administrator"};
    for (size_t i = 0; i < 4; ++i) {
        EXPECT_STREQ(roleName(kRoles[i]), names[i]);
        ASSERT_TRUE(parseRole(names[i]).has_value()) << names[i];
        EXPECT_EQ(*parseRole(names[i]), kRoles[i]);
    }
    for (const char* bad : {"", "Viewer", "admin", "root", "operator ", "ADMINISTRATOR"})
        EXPECT_FALSE(parseRole(bad).has_value()) << bad;
}

TEST(Roles, TheTableIsTheContract) {
    std::set<std::tuple<std::string, std::string, bool, Role, bool, bool>> table, contract;
    for (const auto& r : endpointRules())
        table.emplace(r.method, r.path, r.needsSession, r.minRole, r.refreshesSession,
                      r.changesDevice);
    for (const auto& e : kContract)
        contract.emplace(e.method, e.path, e.needsSession, e.minRole, e.refreshes, e.changes);
    for (const auto& e : kContract11)
        contract.emplace(e.method, e.path, e.needsSession, e.minRole, e.refreshes, e.changes);
    for (const auto& e : kContract12)
        contract.emplace(e.method, e.path, e.needsSession, e.minRole, e.refreshes, e.changes);
    for (const auto& e : kContract13)
        contract.emplace(e.method, e.path, e.needsSession, e.minRole, e.refreshes, e.changes);
    for (const auto& e : kContract14)
        contract.emplace(e.method, e.path, e.needsSession, e.minRole, e.refreshes, e.changes);
    EXPECT_EQ(endpointRules().size(), kContract.size() + kContract11.size() + kContract12.size() +
                                          kContract13.size() + kContract14.size());
    EXPECT_EQ(table, contract);
}

TEST(Roles, EveryRowOnceAndConsistent) {
    std::set<std::pair<std::string, std::string>> seen;
    ASSERT_FALSE(endpointRules().empty());
    for (const auto& r : endpointRules()) {
        const std::string method = r.method, path = r.path;
        EXPECT_TRUE(seen.emplace(method, path).second) << "twice: " << method << " " << path;
        EXPECT_TRUE(method == "GET" || method == "POST") << method;
        EXPECT_EQ(path.rfind("/api/v1/", 0), 0u) << path;
        EXPECT_EQ(path.back() == '/', false) << path;
        if (!r.needsSession) {
            EXPECT_FALSE(r.refreshesSession) << path << ": no session to refresh";
            EXPECT_FALSE(r.changesDevice) << path;
        }
        if (method == "POST" && r.needsSession) {
            EXPECT_TRUE(r.refreshesSession) << path << ": every POST is a person's request";
        }
        if (r.changesDevice) {
            EXPECT_EQ(method, "POST") << path;
        }
        // The table answers for each of its rows.
        const EndpointRule* found = findEndpointRule(method, concrete(path));
        ASSERT_NE(found, nullptr) << method << " " << concrete(path);
        EXPECT_EQ(found, &r) << path;
        EXPECT_NE(allowedMethods(concrete(path)).find(method), std::string::npos) << path;
    }
}

TEST(Roles, OperatorHasTheRightsOfViewerInStageOne) {
    for (const auto& r : endpointRules()) {
        if (r.minRole == Role::Operator) continue;  // stage 2 rows (tag writes)
        EXPECT_EQ(allowed(r, Role::Operator), allowed(r, Role::Viewer)) << r.path;
    }
    for (const auto& e : kContract) EXPECT_NE(e.minRole, Role::Operator) << e.path;
}

TEST(Roles, StageTwoRowsOfFeature006) {
    // tag writes: operator and above; the connection test: engineer and above; a viewer none
    const EndpointRule* write = findEndpointRule("POST", "/api/v1/tags/write");
    const EndpointRule* result =
        findEndpointRule("GET", "/api/v1/tags/write/6f1c2a8e-4b7d-4c1e-9a3f-1a2b3c4d5e6f");
    const EndpointRule* many = findEndpointRule("GET", "/api/v1/tags/write");
    const EndpointRule* probe = findEndpointRule("POST", "/api/v1/drivers/test");
    ASSERT_NE(write, nullptr);
    ASSERT_NE(result, nullptr);
    ASSERT_NE(many, nullptr);
    ASSERT_NE(probe, nullptr);
    EXPECT_FALSE(allowed(*write, Role::Viewer));
    EXPECT_TRUE(allowed(*write, Role::Operator));
    EXPECT_FALSE(allowed(*result, Role::Viewer));
    EXPECT_TRUE(allowed(*many, Role::Operator));
    EXPECT_FALSE(allowed(*probe, Role::Operator));
    EXPECT_TRUE(allowed(*probe, Role::Engineer));
    // polling for a result does not keep a session alive (device-api-1.1 §3.2, §7)
    EXPECT_FALSE(result->refreshesSession);
    EXPECT_FALSE(many->refreshesSession);
    EXPECT_TRUE(write->refreshesSession);
    EXPECT_EQ(allowedMethods("/api/v1/tags/write"), "POST, GET");
}

TEST(Roles, WhoMayDoWhat) {
    auto rule = [](const char* m, const char* p) { return findEndpointRule(m, p); };
    const EndpointRule* diag = rule("GET", "/api/v1/diagnostics");
    const EndpointRule* deploy = rule("POST", "/api/v1/project/deployments");
    const EndpointRule* audit = rule("GET", "/api/v1/audit");
    ASSERT_NE(diag, nullptr);
    ASSERT_NE(deploy, nullptr);
    ASSERT_NE(audit, nullptr);
    EXPECT_TRUE(allowed(*diag, Role::Viewer));
    EXPECT_FALSE(allowed(*deploy, Role::Operator));
    EXPECT_TRUE(allowed(*deploy, Role::Engineer));
    EXPECT_FALSE(allowed(*audit, Role::Engineer));
    EXPECT_TRUE(allowed(*audit, Role::Administrator));
}

TEST(Roles, PathMatchingIsExact) {
    EXPECT_NE(findEndpointRule("GET", "/api/v1/project/deployments/abc-123"), nullptr);
    EXPECT_EQ(findEndpointRule("GET", "/api/v1/project/deployments/"), nullptr);
    EXPECT_EQ(findEndpointRule("GET", "/api/v1/project/deployments/a/b"), nullptr);
    EXPECT_EQ(findEndpointRule("GET", "/api/v1/project/deployments"), nullptr) << "POST only";
    EXPECT_EQ(findEndpointRule("POST", "/api/v1/diagnostics"), nullptr);
    EXPECT_EQ(findEndpointRule("GET", "/api/v1/diagnostics/"), nullptr);
    EXPECT_EQ(findEndpointRule("GET", "/api/v1//diagnostics"), nullptr);
    EXPECT_EQ(findEndpointRule("GET", "/API/V1/DIAGNOSTICS"), nullptr);
    EXPECT_EQ(findEndpointRule("get", "/api/v1/diagnostics"), nullptr);
    EXPECT_EQ(findEndpointRule("GET", "/api/v1/project/manifest?seq=3"), nullptr)
        << "the caller strips the query";
    EXPECT_EQ(findEndpointRule("GET", "/api/v1/system/info"), nullptr) << "not an engineering API";
    EXPECT_EQ(findEndpointRule("PUT", "/api/v1/project/restore"), nullptr);
    EXPECT_EQ(findEndpointRule("GET", ""), nullptr);
}

TEST(Roles, AllowedMethodsForA405) {
    EXPECT_EQ(allowedMethods("/api/v1/project/deployments"), "POST");
    EXPECT_EQ(allowedMethods("/api/v1/project/deployments/op-1"), "GET");
    EXPECT_EQ(allowedMethods("/api/v1/auth/login"), "POST");
    EXPECT_EQ(allowedMethods("/api/v1/diagnostics"), "GET");
    EXPECT_EQ(allowedMethods("/api/v1/nothing"), "");
    EXPECT_EQ(allowedMethods("/"), "");
}

// Feature 007 (device-api-1.2 §1.2, T061): the cookie column. A cookie reaches the endpoints of the
// page and nothing else: every other row answers a cookie with SESSION_SCOPE.
TEST(Roles, TheCookieReachesOnlyTheEndpointsOfThePage) {
    const std::set<std::string> cookie = {
        "GET /api/v1/device/identity", "POST /api/v1/web/login", "POST /api/v1/web/logout",
        "GET /api/v1/web/session", "POST /api/v1/web/touch", "POST /api/v1/tags/write",
        "GET /api/v1/tags/write/{requestId}", "GET /api/v1/tags/write",
        // feature 009: alarms (disable and enable: no cookie)
        "GET /api/v1/alarms", "GET /api/v1/alarms/history", "POST /api/v1/alarms/ack",
        "POST /api/v1/alarms/shelve", "POST /api/v1/alarms/unshelve",
        // feature 010: history
        "GET /api/v1/history/catalog", "GET /api/v1/history/series", "GET /api/v1/history/aggregate",
        "GET /api/v1/history/rows", "GET /api/v1/history/export.csv"};
    std::set<std::string> seen;
    for (const auto& r : endpointRules()) {
        const std::string key = std::string(r.method) + " " + r.path;
        if (r.cookieAllowed) seen.insert(key);
        EXPECT_EQ(r.cookieAllowed, cookie.count(key) == 1) << key;
        // an entry point is a POST that needs no session and lets the cookie in
        if (r.webEntry) {
            EXPECT_TRUE(r.cookieAllowed) << key;
            EXPECT_FALSE(r.needsSession) << key;
            EXPECT_STREQ(r.method, "POST") << key;
        }
    }
    EXPECT_EQ(seen, cookie);
    // nothing that changes the device (deploy, restore, the connection test) or reads the audit
    // is open to a cookie
    for (const auto& r : endpointRules()) {
        if (r.cookieAllowed && r.changesDevice)
            EXPECT_TRUE(std::string(r.path) == "/api/v1/tags/write" ||
                        std::string(r.path).rfind("/api/v1/alarms/", 0) == 0)
                << "only the tag write and the alarm acknowledgement change a device: " << r.path;
    }
    const EndpointRule* login = findEndpointRule("POST", "/api/v1/web/login");
    const EndpointRule* logout = findEndpointRule("POST", "/api/v1/web/logout");
    ASSERT_NE(login, nullptr);
    ASSERT_NE(logout, nullptr);
    EXPECT_TRUE(login->webEntry);
    EXPECT_TRUE(logout->webEntry);
    EXPECT_FALSE(findEndpointRule("POST", "/api/v1/web/touch")->webEntry);
    // touch is a person's request; reading the session is not
    EXPECT_TRUE(findEndpointRule("POST", "/api/v1/web/touch")->refreshesSession);
    EXPECT_FALSE(findEndpointRule("GET", "/api/v1/web/session")->refreshesSession);
    EXPECT_EQ(allowedMethods("/api/v1/web/login"), "POST");
    EXPECT_EQ(allowedMethods("/api/v1/web/session"), "GET");
    // there is no registration, no password change and no password reminder on the web (FR-048)
    for (const char* p : {"/api/v1/web/register", "/api/v1/web/password", "/api/v1/web/reset",
                          "/api/v1/web/signup", "/api/v1/web/forgot"})
        EXPECT_EQ(allowedMethods(p), "") << p;
}
