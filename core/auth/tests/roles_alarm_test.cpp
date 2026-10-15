// T045 (feature 009; contracts/device-api-1.3.md §1.1, FR-051, FR-091): the seven rows of the alarm
// endpoints in the one permission table, column by column, and no /api/v1/alarms path outside it.
#include <gtest/gtest.h>

#include <string>
#include <vector>

#include "core/auth/roles.hpp"

using namespace mat;

namespace {

struct Row {
    const char* method;
    const char* path;
    bool needsSession;
    Role minRole;
    bool refreshes, changes, cookie;
};

// Written out again by hand from device-api-1.3.md §1.1.
const Row kAlarmRows[] = {
    {"GET", "/api/v1/alarms", false, Role::Viewer, false, false, true},
    {"GET", "/api/v1/alarms/history", false, Role::Viewer, false, false, true},
    {"POST", "/api/v1/alarms/ack", true, Role::Operator, true, true, true},
    {"POST", "/api/v1/alarms/shelve", true, Role::Operator, true, true, true},
    {"POST", "/api/v1/alarms/unshelve", true, Role::Operator, true, true, true},
    {"POST", "/api/v1/alarms/disable", true, Role::Engineer, true, true, false},
    {"POST", "/api/v1/alarms/enable", true, Role::Engineer, true, true, false},
};

}  // namespace

TEST(RolesAlarm, EachRowMatchesTheContractColumnByColumn) {
    for (const Row& e : kAlarmRows) {
        const EndpointRule* r = findEndpointRule(e.method, e.path);
        ASSERT_NE(r, nullptr) << e.method << " " << e.path;
        EXPECT_STREQ(r->path, e.path);
        EXPECT_EQ(r->needsSession, e.needsSession) << e.path;
        EXPECT_EQ(r->minRole, e.minRole) << e.path;
        EXPECT_EQ(r->refreshesSession, e.refreshes) << e.path;
        EXPECT_EQ(r->changesDevice, e.changes) << e.path;
        EXPECT_EQ(r->cookieAllowed, e.cookie) << e.path;
        EXPECT_FALSE(r->webEntry) << e.path;
    }
}

TEST(RolesAlarm, NoAlarmPathOutsideTheTable) {
    // Every row of the table under /api/v1/alarms is one of the seven; the table has no implicit
    // default for a sibling path.
    size_t found = 0;
    for (const auto& r : endpointRules()) {
        if (std::string(r.path).rfind("/api/v1/alarms", 0) != 0) continue;
        ++found;
        bool known = false;
        for (const Row& e : kAlarmRows)
            known = known || (std::string(e.method) == r.method && std::string(e.path) == r.path);
        EXPECT_TRUE(known) << r.method << " " << r.path;
    }
    EXPECT_EQ(found, std::size(kAlarmRows));
    for (const char* p : {"/api/v1/alarms/", "/api/v1/alarms/ack/", "/api/v1/alarms/purge",
                          "/api/v1/alarms/history/1", "/api/v1/alarm", "/api/v1/alarmsx"})
        EXPECT_EQ(allowedMethods(p), "") << p;
}

TEST(RolesAlarm, MethodsPerPath) {
    EXPECT_EQ(allowedMethods("/api/v1/alarms"), "GET");
    EXPECT_EQ(allowedMethods("/api/v1/alarms/history"), "GET");
    for (const char* p : {"ack", "shelve", "unshelve", "disable", "enable"})
        EXPECT_EQ(allowedMethods(std::string("/api/v1/alarms/") + p), "POST") << p;
    EXPECT_EQ(findEndpointRule("GET", "/api/v1/alarms/ack"), nullptr);
    EXPECT_EQ(findEndpointRule("POST", "/api/v1/alarms"), nullptr);
}

TEST(RolesAlarm, WhoMayWhat) {
    auto allowed = [](const char* m, const char* p, Role have) {
        const EndpointRule* r = findEndpointRule(m, p);
        return r && (!r->needsSession || roleAtLeast(have, r->minRole));
    };
    EXPECT_TRUE(allowed("GET", "/api/v1/alarms", Role::Viewer));
    EXPECT_TRUE(allowed("GET", "/api/v1/alarms/history", Role::Viewer));
    for (const char* p : {"ack", "shelve", "unshelve"}) {
        const std::string path = std::string("/api/v1/alarms/") + p;
        EXPECT_FALSE(allowed("POST", path.c_str(), Role::Viewer)) << p;
        EXPECT_TRUE(allowed("POST", path.c_str(), Role::Operator)) << p;
    }
    for (const char* p : {"disable", "enable"}) {
        const std::string path = std::string("/api/v1/alarms/") + p;
        EXPECT_FALSE(allowed("POST", path.c_str(), Role::Operator)) << p;
        EXPECT_TRUE(allowed("POST", path.c_str(), Role::Engineer)) << p;
        EXPECT_TRUE(allowed("POST", path.c_str(), Role::Administrator)) << p;
    }
}
