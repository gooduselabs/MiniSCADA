// T040 (feature 005; contracts/device-api.md §1.3, research R9, R10, FR-007, FR-012, FR-014,
// SC-005): the gate of the engineering API as a function of a request description, no CivetWeb.
// - Order: path of the table (404), TLS (403 HTTPS_REQUIRED), method (405 + Allow), session (401
//   AUTH_REQUIRED, SESSION_EXPIRED, SESSION_INVALID), role (403 FORBIDDEN), audit for a change
//   (503 AUDIT_UNAVAILABLE).
// - Refusals of steps 1–3 are recorded as access.denied, coalesced per 60 s by the audit log; the
//   target is the path; a record that cannot be written leaves the refusal as it is.
// - The idle time restarts exactly for the endpoints §1.3 lists, with the real AuthService too.
#include "server/http/auth_gate.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/auth/tests/auth_test_support.hpp"

using namespace mat;
using mat::test::TempDir;

namespace {

const ClientAddress kFrom{"192.168.1.20", 50123};
constexpr int64_t kMin = 60 * 1000;

struct AuthorizeCall {
    std::string token;
    std::string ip;
    Role minRole = Role::Viewer;
    bool refresh = false;
};

// The gate with a fake authorize and an in-memory audit sink.
struct Rig {
    std::mutex mu;
    std::vector<AuthorizeCall> calls;
    std::vector<AuditEvent> denied;
    std::vector<std::string> logs;
    Access answer;  // what authorize returns
    std::atomic<bool> auditOk{true};
    std::atomic<bool> auditThrows{false};
    std::atomic<int64_t> now{5000000};
    std::unique_ptr<AuthGate> gate;

    Rig() {
        answer.status = AccessStatus::Ok;
        answer.user = "kysu1";
        answer.role = Role::Engineer;
        answer.idleRemainingS = 1800;
        answer.lifetimeRemainingS = 43200;
        GateDeps d;
        d.authorize = [this](std::string_view token, const ClientAddress& from, Role minRole,
                             bool refresh) {
            std::lock_guard<std::mutex> l(mu);
            calls.push_back({std::string(token), from.ip, minRole, refresh});
            return answer;
        };
        d.audit = [this](const AuditEvent& e) {
            if (auditThrows) throw AuditUnavailable("test: audit.db read-only");
            std::lock_guard<std::mutex> l(mu);
            denied.push_back(e);
        };
        d.auditAvailable = [this] { return auditOk.load(); };
        d.log = [this](const std::string& line) {
            std::lock_guard<std::mutex> l(mu);
            logs.push_back(line);
        };
        d.monoMs = [this] { return now.load(); };
        gate = std::make_unique<AuthGate>(std::move(d));
    }

    GateDecision check(const std::string& method, const std::string& path, bool tls,
                       std::optional<std::string> authorization = std::nullopt,
                       ClientAddress from = kFrom) {
        GateRequest r;
        r.method = method;
        r.path = path;
        r.tls = tls;
        r.authorization = std::move(authorization);
        r.from = std::move(from);
        return gate->check(r);
    }
    size_t callCount() {
        std::lock_guard<std::mutex> l(mu);
        return calls.size();
    }
    size_t deniedCount() {
        std::lock_guard<std::mutex> l(mu);
        return denied.size();
    }
};

const std::string kToken = "mats_" + std::string(43, 'A');
const std::string kBearer = "Bearer " + kToken;

// A concrete path for a pattern of the table ("{opId}" → "op-1").
std::string concrete(const std::string& pattern) {
    std::string out;
    for (size_t i = 0; i < pattern.size(); ++i) {
        if (pattern[i] == '{') {
            out += "op-1";
            i = pattern.find('}', i);
        } else {
            out += pattern[i];
        }
    }
    return out;
}

}  // namespace

// Step 0: a path the table does not have is not an endpoint; nothing is checked or recorded.
TEST(GateOrder, UnknownPathIs404WithoutSessionOrAudit) {
    Rig r;
    for (bool tls : {false, true})
        for (const char* path :
             {"/api/v1/nothing", "/api/v1/auth/login/", "/api/v1/auth", "/api/v1/project/x",
              "/api/v1/project/deployments/", "/API/v1/auth/login", "/api/v1/diagnosticsX"}) {
            const GateDecision d = r.check("GET", path, tls, kBearer);
            EXPECT_EQ(d.status, 404) << path;
            EXPECT_EQ(d.error, "NOT_FOUND") << path;
            EXPECT_EQ(d.rule, nullptr) << path;
        }
    EXPECT_EQ(r.callCount(), 0u);
    EXPECT_EQ(r.deniedCount(), 0u);
}

// Step 1 (FR-007): over plain HTTP every endpoint of the table answers 403 HTTPS_REQUIRED, whatever
// the method or the token, before the session is looked at; each refusal is recorded.
TEST(GateOrder, PlainHttpIsRefusedFirstWithHttpsRequired) {
    Rig r;
    size_t n = 0;
    for (const auto& rule : endpointRules()) {
        const std::string path = concrete(rule.path);
        for (const char* method : {"GET", "POST", "DELETE"})
            for (const auto& auth :
                 {std::optional<std::string>{}, std::optional<std::string>{kBearer}}) {
                const GateDecision d = r.check(method, path, false, auth);
                EXPECT_EQ(d.status, 403) << method << " " << path;
                EXPECT_EQ(d.error, "HTTPS_REQUIRED") << method << " " << path;
                ++n;
            }
    }
    EXPECT_EQ(r.callCount(), 0u);  // no session check over plain HTTP
    std::lock_guard<std::mutex> l(r.mu);
    ASSERT_EQ(r.denied.size(), n);
    for (const auto& e : r.denied) {
        EXPECT_EQ(e.action, AuditAction::AccessDenied);
        EXPECT_EQ(e.result, AuditResult::Denied);
        EXPECT_EQ(e.channel, AuditChannel::Http);
        EXPECT_EQ(e.source, "192.168.1.20:50123");
        EXPECT_EQ(e.code.value_or(""), "HTTPS_REQUIRED");
        ASSERT_TRUE(e.target.has_value());
        EXPECT_EQ(e.target->rfind("/api/v1/", 0), 0u) << *e.target;
        EXPECT_FALSE(e.user.has_value());
        EXPECT_FALSE(e.role.has_value());
    }
}

// After TLS, a method the table does not have for the path: 405 with the Allow header, no
// session check, nothing recorded.
TEST(GateOrder, WrongMethodIs405WithTheAllowHeader) {
    Rig r;
    struct Case {
        const char* method;
        const char* path;
        const char* allow;
    };
    for (const Case& c :
         {Case{"POST", "/api/v1/auth/session", "GET"}, Case{"GET", "/api/v1/auth/login", "POST"},
          Case{"GET", "/api/v1/auth/logout", "POST"},
          Case{"HEAD", "/api/v1/device/identity", "GET"},
          Case{"OPTIONS", "/api/v1/auth/login", "POST"},
          Case{"GET", "/api/v1/project/deployments", "POST"},
          Case{"PUT", "/api/v1/project/deployments/op-1", "GET"},
          Case{"DELETE", "/api/v1/audit", "GET"}}) {
        const GateDecision d = r.check(c.method, c.path, true, kBearer);
        EXPECT_EQ(d.status, 405) << c.method << " " << c.path;
        EXPECT_EQ(d.error, "METHOD_NOT_ALLOWED") << c.method << " " << c.path;
        EXPECT_EQ(d.allow, c.allow) << c.method << " " << c.path;
    }
    EXPECT_EQ(r.callCount(), 0u);
    EXPECT_EQ(r.deniedCount(), 0u);
}

// The device identity and the sign-in are open on HTTPS: no session, no record.
TEST(GateOrder, IdentityAndSignInNeedNoSession) {
    Rig r;
    const GateDecision identity = r.check("GET", "/api/v1/device/identity", true);
    EXPECT_TRUE(identity.through());
    ASSERT_NE(identity.rule, nullptr);
    EXPECT_STREQ(identity.rule->path, "/api/v1/device/identity");
    EXPECT_TRUE(r.check("POST", "/api/v1/auth/login", true).through());
    EXPECT_TRUE(r.check("POST", "/api/v1/auth/login", true, std::string("Bearer junk")).through());
    EXPECT_EQ(r.callCount(), 0u);
    EXPECT_EQ(r.deniedCount(), 0u);
}

// Step 2: no header, or a header without a bearer credential.
TEST(GateSession, NoBearerCredentialIsAuthRequired) {
    Rig r;
    for (const auto& auth :
         {std::optional<std::string>{}, std::optional<std::string>{""},
          std::optional<std::string>{"Basic a3lzdTE6eA=="}, std::optional<std::string>{"Bearer"},
          std::optional<std::string>{"Bearer   "}, std::optional<std::string>{"Bearer" + kToken}}) {
        const GateDecision d = r.check("GET", "/api/v1/auth/session", true, auth);
        EXPECT_EQ(d.status, 401) << auth.value_or("(none)");
        EXPECT_EQ(d.error, "AUTH_REQUIRED") << auth.value_or("(none)");
    }
    EXPECT_EQ(r.callCount(), 0u);
    std::lock_guard<std::mutex> l(r.mu);
    ASSERT_EQ(r.denied.size(), 6u);
    const AuditEvent& e = r.denied[0];
    EXPECT_EQ(e.action, AuditAction::AccessDenied);
    EXPECT_EQ(e.result, AuditResult::Denied);
    EXPECT_EQ(e.channel, AuditChannel::Https);
    EXPECT_EQ(e.source, "192.168.1.20:50123");
    EXPECT_EQ(e.target.value_or(""), "/api/v1/auth/session");
    EXPECT_EQ(e.code.value_or(""), "AUTH_REQUIRED");
    EXPECT_FALSE(e.user.has_value());
}

// Step 2: the token goes to the session check; unknown or expired → SESSION_EXPIRED, another
// address, a disabled account or a changed rev → SESSION_INVALID (with the account in the record).
TEST(GateSession, SessionCheckDecidesExpiredOrInvalid) {
    Rig r;
    r.answer = Access{};
    r.answer.status = AccessStatus::SessionExpired;
    GateDecision d = r.check("GET", "/api/v1/auth/session", true, kBearer);
    EXPECT_EQ(d.status, 401);
    EXPECT_EQ(d.error, "SESSION_EXPIRED");
    {
        std::lock_guard<std::mutex> l(r.mu);
        ASSERT_EQ(r.calls.size(), 1u);
        EXPECT_EQ(r.calls[0].token, kToken);  // the token alone, without the scheme
        EXPECT_EQ(r.calls[0].ip, "192.168.1.20");
        ASSERT_EQ(r.denied.size(), 1u);
        EXPECT_EQ(r.denied[0].code.value_or(""), "SESSION_EXPIRED");
        EXPECT_FALSE(r.denied[0].user.has_value());
    }
    r.answer.status = AccessStatus::SessionInvalid;
    r.answer.user = "kysu1";
    d = r.check("POST", "/api/v1/auth/logout", true, "bearer   " + kToken + "  ");
    EXPECT_EQ(d.status, 401);
    EXPECT_EQ(d.error, "SESSION_INVALID");
    std::lock_guard<std::mutex> l(r.mu);
    ASSERT_EQ(r.calls.size(), 2u);
    EXPECT_EQ(r.calls[1].token, kToken);
    ASSERT_EQ(r.denied.size(), 2u);
    EXPECT_EQ(r.denied[1].code.value_or(""), "SESSION_INVALID");
    EXPECT_EQ(r.denied[1].user.value_or(""), "kysu1");
    EXPECT_EQ(r.denied[1].target.value_or(""), "/api/v1/auth/logout");
}

// Step 3: the lowest role comes from the table; below it → 403 FORBIDDEN, recorded with the
// account and its role.
TEST(GateRole, TheTableGivesTheLowestRoleAndBelowIsForbidden) {
    Rig r;
    for (const auto& rule : endpointRules()) {
        if (!rule.needsSession) continue;
        const GateDecision d = r.check(rule.method, concrete(rule.path), true, kBearer);
        EXPECT_TRUE(d.through()) << rule.path;
        std::lock_guard<std::mutex> l(r.mu);
        ASSERT_FALSE(r.calls.empty());
        EXPECT_EQ(r.calls.back().minRole, rule.minRole) << rule.path;
    }
    r.answer.status = AccessStatus::Forbidden;
    r.answer.user = "xem1";
    r.answer.role = Role::Viewer;
    const GateDecision d = r.check("GET", "/api/v1/audit", true, kBearer);
    EXPECT_EQ(d.status, 403);
    EXPECT_EQ(d.error, "FORBIDDEN");
    std::lock_guard<std::mutex> l(r.mu);
    ASSERT_EQ(r.denied.size(), 1u);
    EXPECT_EQ(r.denied[0].code.value_or(""), "FORBIDDEN");
    EXPECT_EQ(r.denied[0].user.value_or(""), "xem1");
    EXPECT_EQ(r.denied[0].role.value_or(""), "viewer");
    EXPECT_EQ(r.denied[0].target.value_or(""), "/api/v1/audit");
}

// A granted request carries the access of its session for the handler.
TEST(GateRole, ThroughCarriesTheAccess) {
    Rig r;
    const GateDecision d = r.check("GET", "/api/v1/auth/session", true, kBearer);
    ASSERT_TRUE(d.through());
    ASSERT_NE(d.rule, nullptr);
    EXPECT_EQ(d.access.status, AccessStatus::Ok);
    EXPECT_EQ(d.access.user, "kysu1");
    EXPECT_EQ(d.access.role, Role::Engineer);
    EXPECT_EQ(d.access.lifetimeRemainingS, 43200);
    EXPECT_EQ(r.deniedCount(), 0u);
}

// Step 4: an operation that changes the device needs the audit log; reads do not. Step 3 comes
// first: a viewer gets FORBIDDEN even while the audit log is down.
TEST(GateAudit, ChangeWithoutAuditLogIs503AndRoleComesFirst) {
    Rig r;
    r.auditOk = false;
    for (const char* path : {"/api/v1/project/deployments", "/api/v1/project/restore"}) {
        const GateDecision d = r.check("POST", path, true, kBearer);
        EXPECT_EQ(d.status, 503) << path;
        EXPECT_EQ(d.error, "AUDIT_UNAVAILABLE") << path;
    }
    EXPECT_TRUE(r.check("GET", "/api/v1/project/versions", true, kBearer).through());
    EXPECT_TRUE(r.check("GET", "/api/v1/auth/session", true, kBearer).through());
    EXPECT_TRUE(r.check("POST", "/api/v1/auth/logout", true, kBearer).through());
    EXPECT_EQ(r.deniedCount(), 0u);  // 503 is not an access refusal

    r.answer.status = AccessStatus::Forbidden;
    r.answer.user = "xem1";
    r.answer.role = Role::Viewer;
    const GateDecision d = r.check("POST", "/api/v1/project/deployments", true, kBearer);
    EXPECT_EQ(d.status, 403);
    EXPECT_EQ(d.error, "FORBIDDEN");
}

// §1.3 "Làm mới hạn phiên": every POST, and GET of versions, manifest, package, audit; never the
// polls (diagnostics, auth/session, deployments/{opId}, operation).
TEST(GateRefresh, OnlyTheEndpointsOfSection13RestartTheIdleTime) {
    Rig r;
    const std::map<std::string, bool> expected = {
        {"POST /api/v1/auth/logout", true},
        {"GET /api/v1/auth/session", false},
        {"GET /api/v1/project/versions", true},
        {"GET /api/v1/project/manifest", true},
        {"GET /api/v1/project/package", true},
        {"POST /api/v1/project/deployments", true},
        {"GET /api/v1/project/deployments/op-1", false},
        {"GET /api/v1/project/operation", false},
        {"POST /api/v1/project/restore", true},
        {"GET /api/v1/diagnostics", false},
        {"GET /api/v1/audit", true},
    };
    for (const auto& kv : expected) {
        const size_t space = kv.first.find(' ');
        const GateDecision d =
            r.check(kv.first.substr(0, space), kv.first.substr(space + 1), true, kBearer);
        EXPECT_TRUE(d.through()) << kv.first;
        std::lock_guard<std::mutex> l(r.mu);
        ASSERT_FALSE(r.calls.empty());
        EXPECT_EQ(r.calls.back().refresh, kv.second) << kv.first;
    }
    EXPECT_EQ(r.callCount(), expected.size());
    // Every endpoint with a session is in the list above (stage 2 endpoints must be added there).
    size_t withSession = 0;
    for (const auto& rule : endpointRules()) withSession += rule.needsSession ? 1 : 0;
    EXPECT_EQ(withSession, expected.size());
}

// A record that cannot be written changes nothing in the answer; the log says so at most once a
// minute, with the number of records lost meanwhile.
TEST(GateAuditLog, AFailedRecordKeepsTheRefusalAndIsLoggedOncePerMinute) {
    Rig r;
    r.auditThrows = true;
    for (int i = 0; i < 3; ++i) {
        const GateDecision d = r.check("GET", "/api/v1/diagnostics", true);
        EXPECT_EQ(d.status, 401);
        EXPECT_EQ(d.error, "AUTH_REQUIRED");
    }
    {
        std::lock_guard<std::mutex> l(r.mu);
        ASSERT_EQ(r.logs.size(), 1u);
        EXPECT_NE(r.logs[0].find("access.denied"), std::string::npos) << r.logs[0];
    }
    r.now += kMin + 1;
    EXPECT_EQ(r.check("GET", "/api/v1/diagnostics", true).status, 401);
    std::lock_guard<std::mutex> l(r.mu);
    ASSERT_EQ(r.logs.size(), 2u);
    EXPECT_NE(r.logs[1].find("2"), std::string::npos) << r.logs[1];  // two silenced meanwhile
}

// With the real audit log: refusals of one kind from one address within 60 s share one row
// (count), whatever the client port; another code or another path is another row.
TEST(GateAuditLog, RefusalsAreCoalescedPer60s) {
    TempDir dir;
    std::atomic<int64_t> wall{1791600000000};
    std::atomic<int64_t> mono{9000000};
    AuditOptions ao;
    ao.dataDir = dir.path();
    ao.clock.wallMs = [&] { return wall.load(); };
    ao.clock.monoMs = [&] { return mono.load(); };
    ao.clock.synced = [](int64_t) { return true; };
    AuditLog audit(ao);
    std::string err;
    ASSERT_TRUE(audit.open(err)) << err;

    GateDeps d;
    d.authorize = [](std::string_view, const ClientAddress&, Role, bool) { return Access{}; };
    d.audit = [&](const AuditEvent& e) { audit.append(e); };
    d.auditAvailable = [&] { return audit.isOpen(); };
    d.log = [](const std::string&) {};
    AuthGate gate(std::move(d));
    auto check = [&](bool tls, const std::string& path, int port) {
        GateRequest q;
        q.method = "GET";
        q.path = path;
        q.tls = tls;
        q.from = {"192.168.1.20", port};
        return gate.check(q);
    };
    for (int i = 0; i < 3; ++i) {
        EXPECT_EQ(check(true, "/api/v1/diagnostics", 50000 + i).error, "AUTH_REQUIRED");
        mono += 1000;
        wall += 1000;
    }
    EXPECT_EQ(check(false, "/api/v1/diagnostics", 50100).error, "HTTPS_REQUIRED");
    EXPECT_EQ(check(true, "/api/v1/audit", 50101).error, "AUTH_REQUIRED");

    AuditQuery q;
    q.actionPrefix = "access.";
    const AuditPage page = audit.query(q);
    ASSERT_EQ(page.records.size(), 3u);
    std::map<std::string, int64_t> counts;  // "code target channel" → count
    for (const auto& rec : page.records) {
        counts[rec.code.value_or("") + " " + rec.target.value_or("") + " " + rec.channel] =
            rec.count;
        EXPECT_EQ(rec.result, "denied");
        EXPECT_EQ(rec.source.rfind("192.168.1.20", 0), 0u) << rec.source;
    }
    EXPECT_EQ(counts["AUTH_REQUIRED /api/v1/diagnostics https"], 3);
    EXPECT_EQ(counts["HTTPS_REQUIRED /api/v1/diagnostics http"], 1);
    EXPECT_EQ(counts["AUTH_REQUIRED /api/v1/audit https"], 1);

    // After the 60 s window, the same refusal starts a new row.
    mono += kMin;
    wall += kMin;
    EXPECT_EQ(check(true, "/api/v1/diagnostics", 50200).error, "AUTH_REQUIRED");
    EXPECT_EQ(audit.query(q).records.size(), 4u);
}

// The gate on the real AuthService (fake hash, fake CLOCK_BOOTTIME): sessions bound to the
// address, roles from users.json, and the idle time restarted only by §1.3 requests.
TEST(GateWithAuthService, SessionsAndIdleTimeFollowSection13) {
    TempDir dir;
    std::atomic<int64_t> now{7000000};
    const std::string engineerPw = test::randomPassword();
    const std::string viewerPw = test::randomPassword();
    test::writeFile(dir.file("users.json"),
                    test::usersText({{"kysu1", "engineer", test::fakePhc(engineerPw)},
                                     {"xem1", "viewer", test::fakePhc(viewerPw)}}));
    AuthOptions ao;
    ao.usersFile = dir.file("users.json");
    ao.audit = [](const AuditEvent&) {};
    ao.log = [](const std::string&) {};
    ao.monoMs = [&] { return now.load(); };
    ao.hash = test::fakeHash;
    ao.bootId = [] { return std::string("0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0"); };
    AuthService auth(ao);

    GateDeps d;
    d.authorize = [&](std::string_view token, const ClientAddress& from, Role role, bool refresh) {
        return auth.authorize(token, from, role, refresh);
    };
    d.audit = [](const AuditEvent&) {};
    d.auditAvailable = [] { return true; };
    d.log = [](const std::string&) {};
    d.monoMs = [&] { return now.load(); };
    AuthGate gate(std::move(d));
    auto check = [&](const std::string& method, const std::string& path, const std::string& token,
                     const std::string& ip = "192.168.1.20") {
        GateRequest q;
        q.method = method;
        q.path = path;
        q.tls = true;
        q.authorization = "Bearer " + token;
        q.from = {ip, 40000};
        return gate.check(q);
    };
    auto login = [&](const std::string& user, std::string pw) {
        const LoginResult res = auth.login(user, pw, {"192.168.1.20", 40000});
        EXPECT_EQ(res.status, LoginStatus::Ok) << user;
        return res.token;
    };

    const std::string eng = login("kysu1", engineerPw);
    const std::string view = login("xem1", viewerPw);
    EXPECT_TRUE(check("GET", "/api/v1/project/versions", eng).through());
    EXPECT_EQ(check("GET", "/api/v1/project/versions", view).error, "FORBIDDEN");
    EXPECT_TRUE(check("GET", "/api/v1/diagnostics", view).through());
    EXPECT_EQ(check("GET", "/api/v1/audit", eng).error, "FORBIDDEN");
    EXPECT_EQ(check("GET", "/api/v1/project/versions", eng, "192.168.1.99").error,
              "SESSION_INVALID");
    EXPECT_EQ(check("GET", "/api/v1/project/versions", "mats_" + std::string(43, 'x')).error,
              "SESSION_EXPIRED");

    // 20 min, then polls only (no refresh): 31 min after the last request a person made → expired.
    now += 20 * kMin;
    EXPECT_TRUE(check("GET", "/api/v1/diagnostics", view).through());
    EXPECT_TRUE(check("GET", "/api/v1/auth/session", view).through());
    // The engineer makes a request a person makes at 20 min.
    EXPECT_TRUE(check("GET", "/api/v1/project/versions", eng).through());
    now += 11 * kMin;
    EXPECT_EQ(check("GET", "/api/v1/diagnostics", view).error, "SESSION_EXPIRED");
    const GateDecision s = check("GET", "/api/v1/auth/session", eng);
    ASSERT_TRUE(s.through());
    EXPECT_EQ(s.access.idleRemainingS, 19 * 60);  // 30 min − 11 min since the refresh
}

TEST(Bearer, TokenOfTheHeader) {
    EXPECT_EQ(bearerToken("Bearer abc"), std::optional<std::string_view>("abc"));
    EXPECT_EQ(bearerToken("bearer abc"), std::optional<std::string_view>("abc"));
    EXPECT_EQ(bearerToken("BEARER   abc"), std::optional<std::string_view>("abc"));
    EXPECT_EQ(bearerToken("  Bearer abc \t"), std::optional<std::string_view>("abc"));
    EXPECT_FALSE(bearerToken(""));
    EXPECT_FALSE(bearerToken("Bearer"));
    EXPECT_FALSE(bearerToken("Bearer "));
    EXPECT_FALSE(bearerToken("Bearerabc"));
    EXPECT_FALSE(bearerToken("Basic abc"));
    EXPECT_FALSE(bearerToken("Token abc"));
}

TEST(GateMessage, EveryCodeHasAVietnameseSentence) {
    for (const char* code :
         {"HTTPS_REQUIRED", "AUTH_REQUIRED", "SESSION_EXPIRED", "SESSION_INVALID", "FORBIDDEN",
          "AUDIT_UNAVAILABLE", "NOT_FOUND", "METHOD_NOT_ALLOWED", "AUTH_FAILED", "AUTH_LOCKED",
          "AUTH_BUSY", "BODY_TOO_LARGE", "BAD_REQUEST", "LENGTH_REQUIRED", "NOT_IMPLEMENTED",
          "INTERNAL_ERROR"})
        EXPECT_STRNE(gateMessage(code), "") << code;
    EXPECT_STREQ(gateMessage("NO_SUCH_CODE"), "");
}
