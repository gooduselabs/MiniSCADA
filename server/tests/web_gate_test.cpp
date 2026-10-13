// T053 (feature 007; contracts/device-api-1.2.md §1.2, §1.3, web-session.md §3, §5, ADR-021 points
// 3, 4, FR-041, FR-042): the cookie branch of the gate of the engineering API, as a function of a
// request description, no CivetWeb. Order: HTTPS, medium (Authorization wins; a web token in it is
// SESSION_SCOPE), session (401), scope (403 SESSION_SCOPE), Origin, CSRF (a change), Sec-Fetch-Site
// (a read), role, audit. Every refusal is access.denied on the channel `web`.
#include <gtest/gtest.h>

#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/auth/roles.hpp"
#include "core/auth/session_store.hpp"
#include "server/http/auth_gate.hpp"

using namespace mat;

namespace {

const ClientAddress kFrom{"192.168.1.20", 50123};
const std::string kHost = "192.168.1.110:8443";
const std::string kOrigin = "https://192.168.1.110:8443";
const std::string kWebToken = "matw_" + std::string(43, 'A');
const std::string kBearerToken = "mats_" + std::string(43, 'A');
const std::string kCsrf = "Zk3" + std::string(40, 'x');
const std::string kCookie = std::string(kSessionCookieName) + "=" + kWebToken;

struct Rig {
    std::mutex mu;
    int webCalls = 0;
    int bearerCalls = 0;
    int touches = 0;
    std::vector<AuditEvent> denied;
    WebAccess web;  // what authorizeWeb answers
    std::atomic<bool> auditOk{true};
    bool skipTagDenied = false;
    std::unique_ptr<AuthGate> gate;

    Rig() {
        web.status = AccessStatus::Ok;
        web.user = "vanhanh1";
        web.role = Role::Operator;
        web.csrf = kCsrf;
        web.idleRemainingS = 1800;
        web.lifetimeRemainingS = 43200;
        GateDeps d;
        d.authorize = [this](std::string_view, const ClientAddress&, Role, bool) {
            std::lock_guard<std::mutex> l(mu);
            ++bearerCalls;
            Access a;
            a.status = AccessStatus::Ok;
            a.user = "kysu1";
            a.role = Role::Engineer;
            return a;
        };
        d.authorizeWeb = [this](std::string_view, const ClientAddress&, Role, bool) {
            std::lock_guard<std::mutex> l(mu);
            ++webCalls;
            return web;
        };
        d.touchWeb = [this](std::string_view) {
            std::lock_guard<std::mutex> l(mu);
            ++touches;
        };
        d.audit = [this](const AuditEvent& e) {
            std::lock_guard<std::mutex> l(mu);
            denied.push_back(e);
        };
        d.auditAvailable = [this] { return auditOk.load(); };
        d.skipDeniedAudit = [this](const GateRequest& r) {
            return skipTagDenied && r.method == "POST" && r.path == "/api/v1/tags/write";
        };
        d.monoMs = [] { return int64_t{5000000}; };
        gate = std::make_unique<AuthGate>(std::move(d));
    }

    // A request as the page sends it: cookie, Origin, X-MAT-CSRF; any of them can be taken away.
    struct Req {
        std::string method = "POST";
        std::string path = "/api/v1/tags/write";
        bool tls = true;
        std::optional<std::string> authorization;
        std::optional<std::string> cookie = kCookie;
        std::optional<std::string> origin = kOrigin;
        std::optional<std::string> host = kHost;
        std::optional<std::string> csrf = kCsrf;
        std::optional<std::string> secFetchSite;
    };

    GateDecision check(const Req& q) {
        GateRequest r;
        r.method = q.method;
        r.path = q.path;
        r.tls = q.tls;
        r.authorization = q.authorization;
        r.from = kFrom;
        r.cookie = q.cookie;
        r.origin = q.origin;
        r.host = q.host;
        r.csrf = q.csrf;
        r.secFetchSite = q.secFetchSite;
        return gate->check(r);
    }
    std::vector<AuditEvent> audit() {
        std::lock_guard<std::mutex> l(mu);
        return denied;
    }
    int webCount() {
        std::lock_guard<std::mutex> l(mu);
        return webCalls;
    }
    int bearerCount() {
        std::lock_guard<std::mutex> l(mu);
        return bearerCalls;
    }
    int touchCount() {
        std::lock_guard<std::mutex> l(mu);
        return touches;
    }
};

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

// --- Step 1: HTTPS (the cookie travels only with it)

TEST(WebGate, ACookieOverHttpIsIgnoredAndTheEndpointNeedsHttps) {  // A8
    Rig r;
    Rig::Req q;
    q.tls = false;
    const GateDecision d = r.check(q);
    EXPECT_EQ(d.status, 403);
    EXPECT_EQ(d.error, "HTTPS_REQUIRED");
    EXPECT_EQ(r.webCount(), 0) << "no session is looked up";
    ASSERT_EQ(r.audit().size(), 1u);
    EXPECT_EQ(r.audit()[0].channel, AuditChannel::Http);
}

// --- Step 3: the medium

TEST(WebGate, TheBearerHeaderWinsOverTheCookie) {
    Rig r;
    Rig::Req q;
    q.path = "/api/v1/diagnostics";
    q.method = "GET";
    q.authorization = "Bearer " + kBearerToken;
    const GateDecision d = r.check(q);
    EXPECT_TRUE(d.through()) << d.error;
    EXPECT_FALSE(d.viaCookie);
    EXPECT_EQ(r.bearerCount(), 1);
    EXPECT_EQ(r.webCount(), 0) << "the cookie is not looked at";
}

TEST(WebGate, AWebTokenInTheAuthorizationHeaderIsOutOfScope) {  // A13
    Rig r;
    for (const char* path : {"/api/v1/diagnostics", "/api/v1/tags/write", "/api/v1/audit"}) {
        Rig::Req q;
        q.method = std::string(path) == "/api/v1/tags/write" ? "POST" : "GET";
        q.path = path;
        q.cookie.reset();
        q.authorization = "Bearer " + kWebToken;
        const GateDecision d = r.check(q);
        EXPECT_EQ(d.status, 403) << path;
        EXPECT_EQ(d.error, "SESSION_SCOPE") << path;
    }
    EXPECT_EQ(r.bearerCount(), 0);
    EXPECT_EQ(r.webCount(), 0);
    ASSERT_EQ(r.audit().size(), 3u);
    for (const auto& e : r.audit()) {
        EXPECT_EQ(e.action, AuditAction::AccessDenied);
        EXPECT_EQ(e.code, std::optional<std::string>("SESSION_SCOPE"));
    }
}

TEST(WebGate, ABearerTokenInTheCookieIsNoCookieAtAll) {  // A14
    Rig r;
    Rig::Req q;
    q.cookie = std::string(kSessionCookieName) + "=" + kBearerToken;
    const GateDecision d = r.check(q);
    EXPECT_EQ(d.status, 401);
    EXPECT_EQ(d.error, "AUTH_REQUIRED");
    EXPECT_EQ(r.webCount(), 0);
}

TEST(WebGate, ACookieOfAnotherNameOrNoCookieIsAuthRequired) {
    Rig r;
    for (const char* cookie : {"sid="
                               "matw_AAAA",
                               "x__Host-mat_sid=matw_AAAA", "", "a=b; c=d", "__Host-mat_sid"}) {
        Rig::Req q;
        q.cookie = cookie;
        const GateDecision d = r.check(q);
        EXPECT_EQ(d.error, "AUTH_REQUIRED") << cookie;
        EXPECT_EQ(d.status, 401) << cookie;
    }
    Rig::Req none;
    none.cookie.reset();
    EXPECT_EQ(r.check(none).error, "AUTH_REQUIRED");
    EXPECT_EQ(r.webCount(), 0);
}

TEST(WebGate, ATokenTheClientMadeUpIsInvalid) {  // A21
    Rig r;
    for (const char* token : {"matw_chosen", "matw_", "matw_AAAA"}) {
        Rig::Req q;
        q.cookie = std::string(kSessionCookieName) + "=" + token;
        const GateDecision d = r.check(q);
        EXPECT_EQ(d.status, 401) << token;
        EXPECT_EQ(d.error, "SESSION_INVALID") << token;
    }
    EXPECT_EQ(r.webCount(), 0) << "not even looked up";
}

TEST(WebGate, TwoCookiesOfTheSameNameAreRefused) {
    Rig r;
    Rig::Req q;
    q.cookie = kCookie + "; " + kSessionCookieName + "=" + "matw_" + std::string(43, 'B');
    EXPECT_EQ(r.check(q).error, "AUTH_REQUIRED") << "ambiguous: as if there were none";
}

// --- Step 4: the session

TEST(WebGate, ExpiredAndInvalidSessionsAre401) {
    for (const auto& [status, code] :
         {std::pair<AccessStatus, const char*>{AccessStatus::SessionExpired, "SESSION_EXPIRED"},
          {AccessStatus::SessionInvalid, "SESSION_INVALID"}}) {
        Rig r;
        r.web.status = status;
        const GateDecision d = r.check({});
        EXPECT_EQ(d.status, 401) << code;
        EXPECT_EQ(d.error, code);
        ASSERT_EQ(r.audit().size(), 1u);
        EXPECT_EQ(r.audit()[0].code, std::optional<std::string>(code));
        EXPECT_EQ(r.audit()[0].channel, AuditChannel::Web);
    }
}

// --- Step 5: scope

TEST(WebGate, EveryEndpointThatIsNotThePagesRefusesTheCookieWithSessionScope) {  // A9 to A12
    Rig r;
    int refused = 0, served = 0;
    for (const auto& rule : endpointRules()) {
        if (!rule.needsSession) continue;
        Rig::Req q;
        q.method = rule.method;
        q.path = concrete(rule.path);
        r.web.role = Role::Administrator;  // even the strongest account
        const GateDecision d = r.check(q);
        if (rule.cookieAllowed) {
            ++served;
            EXPECT_NE(d.error, "SESSION_SCOPE") << rule.path;
        } else {
            ++refused;
            EXPECT_EQ(d.status, 403) << rule.method << " " << rule.path;
            EXPECT_EQ(d.error, "SESSION_SCOPE") << rule.path;
        }
    }
    EXPECT_GE(refused, 10) << "deploy, restore, versions, manifest, package, audit, drivers…";
    EXPECT_GE(served, 3);
    // every refusal is on record with its code, on the channel web
    int scope = 0;
    for (const auto& e : r.audit())
        if (e.code == std::optional<std::string>("SESSION_SCOPE")) {
            ++scope;
            EXPECT_EQ(e.channel, AuditChannel::Web);
            EXPECT_EQ(e.action, AuditAction::AccessDenied);
            EXPECT_EQ(e.result, AuditResult::Denied);
        }
    EXPECT_EQ(scope, refused);
}

TEST(WebGate, ScopeIsCheckedAfterTheSessionAndBeforeTheOrigin) {
    Rig r;
    Rig::Req q;
    q.method = "POST";
    q.path = "/api/v1/project/deployments";
    q.origin = "https://evil.example";
    q.csrf.reset();
    EXPECT_EQ(r.check(q).error, "SESSION_SCOPE");
    r.web.status = AccessStatus::SessionExpired;
    EXPECT_EQ(r.check(q).error, "SESSION_EXPIRED") << "an invalid session is 401 first";
}

// --- Step 6: Origin, then CSRF

TEST(WebGate, OriginMustBeThisDeviceOverHttps) {  // A4 to A7
    Rig r;
    struct Case {
        std::optional<std::string> origin;
        const char* what;
    };
    for (const Case& k : {Case{"https://evil.example", "A4: another site"},
                          {std::nullopt, "A5: none"},
                          {"null", "A6: null"},
                          {"http://192.168.1.110:8080", "A7: HTTP, port 8080"},
                          {"http://192.168.1.110:8443", "http, the right port"},
                          {"https://192.168.1.110", "no port"},
                          {"https://192.168.1.110:8444", "another port"},
                          {"https://192.168.1.110:8443/", "a trailing slash"},
                          {"", "empty"}}) {
        SCOPED_TRACE(k.what);
        Rig::Req q;
        q.origin = k.origin;
        const GateDecision d = r.check(q);
        EXPECT_EQ(d.status, 403);
        EXPECT_EQ(d.error, "ORIGIN_MISMATCH");
    }
    // right, whatever the case of the host
    Rig::Req ok;
    ok.origin = "HTTPS://192.168.1.110:8443";
    EXPECT_TRUE(r.check(ok).through());
    Rig::Req named;
    named.host = "Bl335.Local:8443";
    named.origin = "https://bl335.local:8443";
    EXPECT_TRUE(r.check(named).through());
    // no Host header: nothing to compare to
    Rig::Req noHost;
    noHost.host.reset();
    EXPECT_EQ(r.check(noHost).error, "ORIGIN_MISMATCH");
}

TEST(WebGate, TheCsrfTokenMustBeTheSessionsOwn) {  // A1 to A3
    Rig r;
    Rig::Req missing;
    missing.csrf.reset();
    EXPECT_EQ(r.check(missing).error, "CSRF_FAILED");
    Rig::Req wrong;
    std::string changed = kCsrf;
    changed[5] = changed[5] == 'a' ? 'b' : 'a';
    wrong.csrf = changed;
    EXPECT_EQ(r.check(wrong).error, "CSRF_FAILED");
    Rig::Req other;
    other.csrf = "Q" + kCsrf.substr(1);  // the token of another session
    EXPECT_EQ(r.check(other).error, "CSRF_FAILED");
    Rig::Req shorter;
    shorter.csrf = kCsrf.substr(0, kCsrf.size() - 1);
    EXPECT_EQ(r.check(shorter).error, "CSRF_FAILED");
    Rig::Req longer;
    longer.csrf = kCsrf + "x";
    EXPECT_EQ(r.check(longer).error, "CSRF_FAILED");
    Rig::Req empty;
    empty.csrf = "";
    EXPECT_EQ(r.check(empty).error, "CSRF_FAILED");
    EXPECT_TRUE(r.check({}).through());
    // a session without a CSRF token (it never happens) lets nothing through
    r.web.csrf.clear();
    Rig::Req blank;
    blank.csrf = "";
    EXPECT_EQ(r.check(blank).error, "CSRF_FAILED");
}

TEST(WebGate, OriginIsCheckedBeforeCsrf) {
    Rig r;
    Rig::Req q;
    q.origin = "https://evil.example";
    q.csrf.reset();
    EXPECT_EQ(r.check(q).error, "ORIGIN_MISMATCH");
}

TEST(WebGate, EveryChangeNeedsOriginAndCsrfAReadDoesNot) {
    Rig r;
    for (const auto& rule : endpointRules()) {
        if (!rule.needsSession || !rule.cookieAllowed) continue;
        Rig::Req q;
        q.method = rule.method;
        q.path = concrete(rule.path);
        q.origin.reset();
        q.csrf.reset();
        const GateDecision d = r.check(q);
        if (q.method == "POST")
            EXPECT_EQ(d.error, "ORIGIN_MISMATCH") << rule.path;
        else
            EXPECT_TRUE(d.through()) << rule.path << " " << d.error;
    }
}

// --- Step 7: a read comes from the page itself

TEST(WebGate, AReadOfTheSessionOrAResultComesFromTheSameOrigin) {  // A18
    Rig r;
    for (const char* path : {"/api/v1/web/session", "/api/v1/tags/write/op-1"}) {
        for (const char* site : {"cross-site", "same-site", "none", ""}) {
            Rig::Req q;
            q.method = "GET";
            q.path = path;
            q.secFetchSite = site;
            q.origin.reset();
            q.csrf.reset();
            const GateDecision d = r.check(q);
            EXPECT_EQ(d.status, 403) << path << " " << site;
            EXPECT_EQ(d.error, "FETCH_SITE") << path << " " << site;
        }
        Rig::Req same;
        same.method = "GET";
        same.path = path;
        same.secFetchSite = "same-origin";
        same.origin.reset();
        same.csrf.reset();
        EXPECT_TRUE(r.check(same).through()) << path;
        Rig::Req absent = same;  // an old client sends no Sec-Fetch headers: no reason to refuse
        absent.secFetchSite.reset();
        EXPECT_TRUE(r.check(absent).through()) << path;
    }
}

// --- Step 8: the role

TEST(WebGate, AViewerCannotWriteAndItIsOnRecord) {  // A24
    Rig r;
    r.web.role = Role::Viewer;
    const GateDecision d = r.check({});
    EXPECT_EQ(d.status, 403);
    EXPECT_EQ(d.error, "FORBIDDEN");
    ASSERT_EQ(r.audit().size(), 1u);
    EXPECT_EQ(r.audit()[0].code, std::optional<std::string>("FORBIDDEN"));
    EXPECT_EQ(r.audit()[0].role, std::optional<std::string>("viewer"));
    EXPECT_EQ(r.audit()[0].user, std::optional<std::string>("vanhanh1"));
    EXPECT_EQ(r.audit()[0].channel, AuditChannel::Web);
    EXPECT_EQ(r.touchCount(), 0);
}

TEST(WebGate, ATagWriteRefusalIsLeftToTheHandlerToAudit) {
    Rig r;
    r.skipTagDenied = true;
    r.web.role = Role::Viewer;
    EXPECT_EQ(r.check({}).error, "FORBIDDEN");
    EXPECT_TRUE(r.audit().empty()) << "the handler records tag.write denied with the Tag and value";
}

// --- Step 9 and the granted request

TEST(WebGate, AGrantedChangeFillsTheDecisionAndRestartsTheIdleTime) {
    Rig r;
    const GateDecision d = r.check({});
    ASSERT_TRUE(d.through()) << d.error;
    EXPECT_TRUE(d.viaCookie);
    EXPECT_EQ(d.webToken, kWebToken);
    EXPECT_EQ(d.web.csrf, kCsrf);
    EXPECT_EQ(d.access.user, "vanhanh1");
    EXPECT_EQ(d.access.role, std::optional<Role>(Role::Operator));
    ASSERT_NE(d.rule, nullptr);
    EXPECT_STREQ(d.rule->path, "/api/v1/tags/write");
    EXPECT_EQ(r.touchCount(), 1) << "a POST of a person";
    EXPECT_TRUE(r.audit().empty());
    // a read does not
    Rig::Req read;
    read.method = "GET";
    read.path = "/api/v1/web/session";
    read.secFetchSite = "same-origin";
    EXPECT_TRUE(r.check(read).through());
    EXPECT_EQ(r.touchCount(), 1);
}

TEST(WebGate, ARefusedRequestDoesNotRestartTheIdleTime) {
    Rig r;
    Rig::Req q;
    q.csrf = "wrong";
    EXPECT_FALSE(r.check(q).through());
    Rig::Req scope;
    scope.path = "/api/v1/audit";
    scope.method = "GET";
    EXPECT_FALSE(r.check(scope).through());
    EXPECT_EQ(r.touchCount(), 0);
}

TEST(WebGate, AChangeNeedsAWorkingAuditLogAfterTheCookieChecks) {
    Rig r;
    r.auditOk = false;
    EXPECT_EQ(r.check({}).error, "AUDIT_UNAVAILABLE");
    EXPECT_EQ(r.check({}).status, 503);
    Rig::Req badOrigin;
    badOrigin.origin = "https://evil.example";
    EXPECT_EQ(r.check(badOrigin).error, "ORIGIN_MISMATCH") << "the cookie checks come first";
}

// --- The entry points

TEST(WebGate, LoginNeedsNoSessionButItNeedsTheOrigin) {  // A25
    Rig r;
    Rig::Req q;
    q.path = "/api/v1/web/login";
    q.cookie.reset();
    q.csrf.reset();
    GateDecision d = r.check(q);
    EXPECT_TRUE(d.through()) << d.error;
    EXPECT_FALSE(d.viaCookie);
    EXPECT_EQ(r.webCount(), 0);
    for (const char* origin : {"https://evil.example", "null", "http://192.168.1.110:8443"}) {
        Rig::Req bad = q;
        bad.origin = origin;
        d = r.check(bad);
        EXPECT_EQ(d.status, 403) << origin;
        EXPECT_EQ(d.error, "ORIGIN_MISMATCH") << origin;
    }
    Rig::Req none = q;
    none.origin.reset();
    EXPECT_EQ(r.check(none).error, "ORIGIN_MISMATCH");
    // over HTTP: no cookie, no login
    Rig::Req http = q;
    http.tls = false;
    EXPECT_EQ(r.check(http).error, "HTTPS_REQUIRED");
    // an old or foreign cookie does not stop a sign-in, and no CSRF token is asked for it
    Rig::Req stale = q;
    stale.cookie = kCookie;
    r.web.status = AccessStatus::SessionExpired;
    EXPECT_TRUE(r.check(stale).through());
}

TEST(WebGate, LogoutWithALiveSessionNeedsItsCsrfToken) {
    Rig r;
    Rig::Req q;
    q.path = "/api/v1/web/logout";
    GateDecision d = r.check(q);
    ASSERT_TRUE(d.through()) << d.error;
    EXPECT_TRUE(d.viaCookie);
    EXPECT_EQ(d.webToken, kWebToken);
    Rig::Req noCsrf = q;
    noCsrf.csrf.reset();
    EXPECT_EQ(r.check(noCsrf).error, "CSRF_FAILED");
    Rig::Req badOrigin = q;
    badOrigin.origin = "https://evil.example";
    EXPECT_EQ(r.check(badOrigin).error, "ORIGIN_MISMATCH");
    // no live session (expired cookie, no cookie): the sign-out still goes through to clear the
    // cookie; the Origin is still needed
    r.web.status = AccessStatus::SessionExpired;
    d = r.check(noCsrf);
    EXPECT_TRUE(d.through()) << d.error;
    EXPECT_FALSE(d.viaCookie);
    Rig::Req none = noCsrf;
    none.cookie.reset();
    EXPECT_TRUE(r.check(none).through());
    none.origin.reset();
    EXPECT_EQ(r.check(none).error, "ORIGIN_MISMATCH");
}

TEST(WebGate, ACookieMeansNothingToEndpointsThatNeedNoSession) {
    Rig r;
    for (const char* path : {"/api/v1/device/identity", "/api/v1/auth/login"}) {
        Rig::Req q;
        q.method = std::string(path) == "/api/v1/auth/login" ? "POST" : "GET";
        q.path = path;
        EXPECT_TRUE(r.check(q).through()) << path;
    }
    EXPECT_EQ(r.webCount(), 0);
}

TEST(WebGate, AnotherAuthorizationSchemeLeavesTheCookie) {
    Rig r;
    Rig::Req q;
    q.authorization = "Basic dXNlcjpwYXNz";  // not Bearer: no credential of ours
    EXPECT_TRUE(r.check(q).through());
    EXPECT_EQ(r.webCount(), 1);
}

TEST(WebGate, WithoutTheWebBackendACookieIsNeverAccepted) {
    GateDeps d;
    d.authorize = [](std::string_view, const ClientAddress&, Role, bool) { return Access{}; };
    AuthGate gate(std::move(d));
    GateRequest r;
    r.method = "POST";
    r.path = "/api/v1/tags/write";
    r.tls = true;
    r.cookie = kCookie;
    r.origin = kOrigin;
    r.host = kHost;
    r.csrf = kCsrf;
    const GateDecision out = gate.check(r);
    EXPECT_EQ(out.status, 401);
    EXPECT_EQ(out.error, "AUTH_REQUIRED");
}

// --- The helpers

TEST(WebGate, CookieValue) {
    const std::string n = kSessionCookieName;
    EXPECT_EQ(cookieValue(n + "=abc", n), std::optional<std::string>("abc"));
    EXPECT_EQ(cookieValue("a=1; " + n + "=abc; b=2", n), std::optional<std::string>("abc"));
    EXPECT_EQ(cookieValue("a=1;" + n + "=abc;b=2", n), std::optional<std::string>("abc"));
    EXPECT_EQ(cookieValue("  " + n + " = abc  ", n), std::optional<std::string>("abc"));
    EXPECT_EQ(cookieValue(n + "=", n), std::optional<std::string>(""));
    EXPECT_EQ(cookieValue("a=1", n), std::nullopt);
    EXPECT_EQ(cookieValue("", n), std::nullopt);
    EXPECT_EQ(cookieValue("x" + n + "=abc", n), std::nullopt);
    EXPECT_EQ(cookieValue(n + "x=abc", n), std::nullopt);
    EXPECT_EQ(cookieValue(n, n), std::nullopt) << "no value";
    EXPECT_EQ(cookieValue(n + "=a; " + n + "=b", n), std::nullopt) << "twice";
    EXPECT_EQ(cookieValue(n + "=a==b", n), std::optional<std::string>("a==b"));
}

TEST(WebGate, OriginMatchesHost) {
    const auto m = [](const char* o, const char* h) {
        return originMatchesHost(o ? std::optional<std::string>(o) : std::nullopt,
                                 h ? std::optional<std::string>(h) : std::nullopt);
    };
    EXPECT_TRUE(m("https://192.168.1.110:8443", "192.168.1.110:8443"));
    EXPECT_TRUE(m("https://BL335.local:8443", "bl335.local:8443"));
    EXPECT_TRUE(m("https://bl335.local", "bl335.local"));
    EXPECT_FALSE(m("http://bl335.local", "bl335.local"));
    EXPECT_FALSE(m("https://bl335.local:8443", "bl335.local"));
    EXPECT_FALSE(m("https://bl335.local", "bl335.local:8443"));
    EXPECT_FALSE(m("null", "bl335.local"));
    EXPECT_FALSE(m("", ""));
    EXPECT_FALSE(m("https://", ""));
    EXPECT_FALSE(m(nullptr, "bl335.local"));
    EXPECT_FALSE(m("https://bl335.local", nullptr));
    EXPECT_FALSE(m("https://bl335.local.evil.example", "bl335.local"));
    EXPECT_FALSE(m("https://evil.example/https://bl335.local", "bl335.local"));
}

TEST(WebGate, TheNewCodesHaveAVietnameseMessage) {
    for (const char* code : {"SESSION_SCOPE", "CSRF_FAILED", "ORIGIN_MISMATCH", "FETCH_SITE"})
        EXPECT_NE(std::string(gateMessage(code)), "") << code;
}

TEST(WebGate, ABearerTokenOnTheEndpointsOfTheWebSessionIsOutOfScope) {
    Rig r;
    for (const auto& [method, path] :
         {std::pair<const char*, const char*>{"GET", "/api/v1/web/session"},
          {"POST", "/api/v1/web/touch"}}) {
        Rig::Req q;
        q.method = method;
        q.path = path;
        q.cookie.reset();
        q.authorization = "Bearer " + kBearerToken;
        const GateDecision d = r.check(q);
        EXPECT_EQ(d.status, 403) << path;
        EXPECT_EQ(d.error, "SESSION_SCOPE") << path;
    }
    EXPECT_EQ(r.bearerCount(), 0) << "the Bearer session is not even asked, so not restarted";
}
