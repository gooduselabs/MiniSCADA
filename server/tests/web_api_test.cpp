// T055 (feature 007; contracts/device-api-1.2.md §1.3, §2, §3, §5, §7, web-session.md §2, §3,
// FR-038 to FR-044, FR-048, FR-049): the sign-in endpoints of the runtime page on the two listeners
// of mat-runtime in process, over the real audit log and the real sign-in service (fake hash):
//  - POST /api/v1/web/login: the cookie `__Host-mat_sid` with its exact attributes, a new token
//  each
//    time, one answer for a wrong name and a wrong password, the lockout shared with the Bearer
//    sign-in, JSON only, Origin of the page, bodies of at most 4 KiB;
//  - GET /web/session, POST /web/touch, POST /web/logout, and what a cookie may reach;
//  - GET /login, viewerLogin = required (302, 401, the minimal system/info, the HTTP guide page),
//    system/info.web;
//  - a viewer can sign in; nothing to register, to reset or to change a password on the web.
#include <gtest/gtest.h>

#include <cstring>
#include <fstream>
#include <memory>
#include <string>

#include "server/http/http_api.hpp"
#include "server/http/source_filter.hpp"
#include "server/http/viewer_gate.hpp"
#include "server/tests/api_rig.hpp"

using namespace mat;
using namespace mat::test;
using nlohmann::json;

namespace {

std::string lowered(std::string s) {
    for (char& c : s)
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    return s;
}

// The value of a response header (first one, by name without case); "" when missing.
std::string header(const HttpResult& r, const std::string& name) {
    const std::string want = lowered(name) + ":";
    size_t at = 0;
    while (at < r.headers.size()) {
        size_t end = r.headers.find("\r\n", at);
        if (end == std::string::npos) end = r.headers.size();
        const std::string line = r.headers.substr(at, end - at);
        if (lowered(line).rfind(want, 0) == 0) {
            size_t v = want.size();
            while (v < line.size() && line[v] == ' ') ++v;
            return line.substr(v);
        }
        at = end + 2;
    }
    return "";
}

// Every Set-Cookie line.
std::vector<std::string> setCookies(const HttpResult& r) {
    std::vector<std::string> out;
    size_t at = 0;
    while (at < r.headers.size()) {
        size_t end = r.headers.find("\r\n", at);
        if (end == std::string::npos) end = r.headers.size();
        const std::string line = r.headers.substr(at, end - at);
        if (lowered(line).rfind("set-cookie:", 0) == 0) {
            size_t v = 11;
            while (v < line.size() && line[v] == ' ') ++v;
            out.push_back(line.substr(v));
        }
        at = end + 2;
    }
    return out;
}

bool hasAttr(const std::string& cookie, const std::string& attr) {
    // attributes are separated by "; "
    size_t at = cookie.find(';');
    while (at != std::string::npos) {
        size_t next = cookie.find(';', at + 1);
        std::string a = cookie.substr(at + 1, next == std::string::npos ? next : next - at - 1);
        while (!a.empty() && a.front() == ' ') a.erase(a.begin());
        if (lowered(a) == lowered(attr) || lowered(a).rfind(lowered(attr) + "=", 0) == 0)
            return true;
        at = next;
    }
    return false;
}

std::string tokenOfCookie(const std::string& setCookie) {
    const std::string name = "__Host-mat_sid=";
    if (setCookie.rfind(name, 0) != 0) return "";
    return setCookie.substr(name.size(), setCookie.find(';') - name.size());
}

struct Web : ApiRig {
    Web() : ApiRig() {
        // the page's files
        docroot = dir.file("web");
        ::mkdir(docroot.c_str(), 0755);
        ::mkdir((docroot + "/assets").c_str(), 0755);
        write(docroot + "/index.html", "<html><body>runtime page</body></html>");
        write(docroot + "/login.html", "<html><body>login page</body></html>");
        write(docroot + "/assets/login-a1.js", "// login bundle");
        write(docroot + "/assets/index-b2.js", "// main bundle");
        ::mkdir(dir.file("project").c_str(), 0755);
        ::mkdir(dir.file("project/screens").c_str(), 0755);
        write(dir.file("project/screens/main.screen.json"), "{}");
        device->setHttps(HttpsState::Ok, cert.fingerprint);
        origin = "https://127.0.0.1:" + std::to_string(web.httpsPort());
    }

    // The page's own handlers (HttpApi) on both listeners, with a gate; viewerLogin and access as
    // asked. Call once.
    // `privateSource`: the requests of the test come from the loopback, which a required sign-in
    // never turns away; with it the gate sees 192.168.1.77 instead (a test hook) and the sessions
    // are still looked up under the real address.
    void servePage(bool viewerLogin, ViewerAccess access = ViewerAccess::Private,
                   bool privateSource = false) {
        ViewerGate::Hooks hooks;
        if (privateSource) hooks.remoteIp = [](const std::string&) { return "192.168.1.77"; };
        const auto real = [privateSource](const std::string& ip) {
            return privateSource ? std::string("127.0.0.1") : ip;
        };
        gate = std::make_unique<ViewerGate>(
            access,
            [this, real](const std::string& token, const std::string& ip, int port) {
                ClientAddress from;
                from.ip = real(ip);
                from.port = port;
                return auth->authorize(token, from, Role::Viewer, false).status == AccessStatus::Ok;
            },
            hooks);
        gate->setWebSessions(
            [this, real](const std::string& token, const std::string& ip, int port) {
                ClientAddress from;
                from.ip = real(ip);
                from.port = port;
                return auth->authorizeWeb(token, from, Role::Viewer, false).status ==
                       AccessStatus::Ok;
            },
            viewerLogin);
        device->setViewerLogin(viewerLogin ? "required" : "off");
        HttpApi::Options o;
        o.docroot = docroot;
        o.projectDir = dir.file("project");
        o.projectAllowlist = {"screens/main.screen.json"};
        o.activeProjectJson = R"({"project":{"projectName":"x"}})";
        o.device = device.get();
        o.gate = gate.get();
        o.deviceCertPem = publicCertificatePem(readFile(cert.pemPath));
        api = std::make_unique<HttpApi>(o, [] {
            return json{{"runtimeVersion", "0.8.0"}, {"project", {{"status", "running"}}}};
        });
        for (mg_context* ctx : {web.http(), web.https()}) api->install(ctx);
    }

    static void write(const std::string& path, const std::string& text) {
        std::ofstream(path, std::ios::binary) << text;
    }

    HttpRequest loginReq(const std::string& user, const std::string& password,
                         std::vector<std::string> extra = {}) const {
        std::vector<std::string> h = {"Origin: " + origin};
        for (auto& e : extra) h.push_back(e);
        return postReq("/api/v1/web/login", json{{"username", user}, {"password", password}}.dump(),
                       h);
    }
    HttpResult webLogin(const std::string& user) { return call(loginReq(user, pw[user])); }

    // The cookie and CSRF token of a new session of `user`.
    struct Session {
        std::string token, csrf, cookie;
        std::string cookieHeader() const { return "Cookie: __Host-mat_sid=" + token; }
    };
    Session open(const std::string& user) {
        const HttpResult r = webLogin(user);
        EXPECT_EQ(r.status, 200) << r.body;
        Session s;
        const auto cookies = setCookies(r);
        EXPECT_EQ(cookies.size(), 1u);
        if (!cookies.empty()) {
            s.cookie = cookies[0];
            s.token = tokenOfCookie(cookies[0]);
        }
        s.csrf = bodyJson(r).value("csrfToken", "");
        return s;
    }
    // A request the page makes with the session: cookie, Origin, CSRF.
    HttpResult as(const Session& s, const std::string& method, const std::string& path,
                  const std::string& body = "") {
        HttpRequest q;
        q.method = method;
        q.path = path;
        q.body = body;
        q.headers = {s.cookieHeader(), "Origin: " + origin, "X-MAT-CSRF: " + s.csrf,
                     "Content-Type: application/json"};
        return call(q);
    }

    std::string docroot, origin;
    std::unique_ptr<ViewerGate> gate;
    std::unique_ptr<HttpApi> api;
};

}  // namespace

// --- POST /api/v1/web/login

TEST(WebLogin, RightPasswordGivesTheCookieAndTheCsrfToken) {
    Web w;
    const HttpResult r = w.webLogin("vh1");
    ASSERT_EQ(r.status, 200) << r.body;
    const json b = bodyJson(r);
    EXPECT_EQ(b["user"], "vh1");
    EXPECT_EQ(b["role"], "operator");
    EXPECT_EQ(b["csrfToken"].get<std::string>().size(), 43u);
    EXPECT_EQ(b["idleTimeoutS"], 1800);
    EXPECT_EQ(b["maxSessionS"], 43200);
    EXPECT_TRUE(b["expiresAt"].is_string());
    EXPECT_TRUE(b["idleExpiresAt"].is_string());
    EXPECT_FALSE(b.contains("token")) << "the token is only in the cookie";
    EXPECT_EQ(lowered(header(r, "Content-Type")), "application/json; charset=utf-8");
    EXPECT_EQ(header(r, "Cache-Control"), "no-store");
    EXPECT_EQ(header(r, "X-Content-Type-Options"), "nosniff");
    EXPECT_EQ(header(r, "Access-Control-Allow-Origin"), "") << "no CORS on the web endpoints";

    const auto cookies = setCookies(r);
    ASSERT_EQ(cookies.size(), 1u) << r.headers;
    const std::string& c = cookies[0];
    EXPECT_EQ(c.rfind("__Host-mat_sid=matw_", 0), 0u) << c;
    EXPECT_TRUE(hasAttr(c, "Secure")) << c;
    EXPECT_TRUE(hasAttr(c, "HttpOnly")) << c;
    EXPECT_TRUE(hasAttr(c, "SameSite=Strict")) << c;
    EXPECT_TRUE(hasAttr(c, "Path=/")) << c;
    EXPECT_FALSE(hasAttr(c, "Domain")) << "a __Host- cookie has none: " << c;
    EXPECT_FALSE(hasAttr(c, "Max-Age")) << "a session cookie: " << c;
    EXPECT_FALSE(hasAttr(c, "Expires")) << c;
    EXPECT_EQ(tokenOfCookie(c).size(), 48u);
    EXPECT_FALSE(setCookies(r).empty());
    // the audit: auth.login ok on the channel web, source with the port
    const auto rows = w.records("auth.login");
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].channel, "web");
    EXPECT_EQ(rows[0].result, "ok");
    EXPECT_EQ(rows[0].user, std::optional<std::string>("vh1"));
}

TEST(WebLogin, EveryLoginHasANewTokenWhateverTheCookieTheClientSends) {  // A21
    Web w;
    const Web::Session first = w.open("vh1");
    const HttpResult again = w.call(w.loginReq("vh1", w.pw["vh1"], {first.cookieHeader()}));
    ASSERT_EQ(again.status, 200) << again.body;
    const std::string second = tokenOfCookie(setCookies(again).at(0));
    EXPECT_NE(second, first.token);
    EXPECT_EQ(w.as(first, "GET", "/api/v1/web/session").status, 200) << "the first one lives on";
    // a token the client chose is never taken
    const HttpResult chosen = w.call(w.loginReq(
        "vh1", w.pw["vh1"], {"Cookie: __Host-mat_sid=matw_" + std::string(42, 'A') + "A"}));
    ASSERT_EQ(chosen.status, 200);
    EXPECT_NE(tokenOfCookie(setCookies(chosen).at(0)), "matw_" + std::string(42, 'A') + "A");
    EXPECT_EQ(w.call(getReq("/api/v1/web/session",
                            {"Cookie: __Host-mat_sid=matw_" + std::string(42, 'A') + "A",
                             "Sec-Fetch-Site: same-origin"}))
                  .status,
              401);
}

TEST(WebLogin, AWrongNameAndAWrongPasswordGetTheSameAnswerAndSetNoCookie) {
    Web w;
    const HttpResult unknown = w.call(w.loginReq("nobody", "x"));
    const HttpResult wrong = w.call(w.loginReq("vh1", "Not#Right1"));
    for (const HttpResult* r : {&unknown, &wrong}) {
        EXPECT_EQ(r->status, 401);
        EXPECT_EQ(bodyJson(*r)["error"], "AUTH_FAILED");
        EXPECT_TRUE(setCookies(*r).empty());
    }
    EXPECT_EQ(unknown.body, wrong.body) << "one sentence for both";
    const auto rows = w.records("auth.login");
    ASSERT_EQ(rows.size(), 2u);
    for (const auto& row : rows) {
        EXPECT_EQ(row.channel, "web");
        EXPECT_EQ(row.result, "failed");
    }
}

TEST(WebLogin, FiveFailuresLockTheNameForEveryChannel) {  // A26
    Web w;
    for (int i = 0; i < 5; ++i) EXPECT_EQ(w.call(w.loginReq("vh1", "Not#Right1")).status, 401) << i;
    const HttpResult locked = w.call(w.loginReq("vh1", w.pw["vh1"]));
    EXPECT_EQ(locked.status, 429);
    EXPECT_EQ(bodyJson(locked)["error"], "AUTH_LOCKED");
    EXPECT_GT(bodyJson(locked).value("retryAfterS", 0), 0);
    EXPECT_NE(header(locked, "Retry-After"), "");
    EXPECT_TRUE(setCookies(locked).empty());
    EXPECT_EQ(w.login("vh1").status, 429) << "the Bearer sign-in of the same name is locked too";
    w.mono += 5 * 60 * 1000 + 1;
    EXPECT_EQ(w.webLogin("vh1").status, 200) << "after five minutes";
}

TEST(WebLogin, OnlyJsonIsAccepted) {  // A16, A17
    Web w;
    const std::string good = json{{"username", "vh1"}, {"password", w.pw["vh1"]}}.dump();
    for (const char* type : {"text/plain", "application/x-www-form-urlencoded",
                             "multipart/form-data; boundary=x", "text/json", "application/jsonx"}) {
        HttpRequest q;
        q.method = "POST";
        q.path = "/api/v1/web/login";
        q.body = good;
        q.headers = {std::string("Content-Type: ") + type, "Origin: " + w.origin};
        const HttpResult r = w.call(q);
        EXPECT_EQ(r.status, 415) << type;
        EXPECT_EQ(bodyJson(r)["error"], "UNSUPPORTED_MEDIA_TYPE") << type;
        EXPECT_TRUE(setCookies(r).empty()) << type;
    }
    HttpRequest none;
    none.method = "POST";
    none.path = "/api/v1/web/login";
    none.body = good;
    none.headers = {"Origin: " + w.origin};
    EXPECT_EQ(w.call(none).status, 415) << "no Content-Type at all";
    HttpRequest charset = none;
    charset.headers = {"Content-Type: Application/JSON; charset=utf-8", "Origin: " + w.origin};
    EXPECT_EQ(w.call(charset).status, 200) << "parameters and case are fine";
}

TEST(WebLogin, TheRequestMustComeFromThePage) {  // A25
    Web w;
    const std::string body = json{{"username", "vh1"}, {"password", w.pw["vh1"]}}.dump();
    struct Case {
        std::vector<std::string> headers;
        const char* what;
    };
    for (const Case& k :
         {Case{{"Origin: https://evil.example"}, "another site"}, Case{{}, "no Origin"},
          Case{{"Origin: null"}, "null"}, Case{{"Origin: http://127.0.0.1"}, "http"}}) {
        SCOPED_TRACE(k.what);
        const HttpResult r = w.call(postReq("/api/v1/web/login", body, k.headers));
        EXPECT_EQ(r.status, 403);
        EXPECT_EQ(bodyJson(r)["error"], "ORIGIN_MISMATCH");
        EXPECT_TRUE(setCookies(r).empty());
    }
    EXPECT_TRUE(w.records("auth.login").empty()) << "no hash was spent";
    const auto denied = w.records("access.denied");
    ASSERT_FALSE(denied.empty());
    EXPECT_EQ(denied[0].code, std::optional<std::string>("ORIGIN_MISMATCH"));
}

TEST(WebLogin, BadBodies) {
    Web w;
    auto post = [&](const std::string& body) {
        return w.call(postReq("/api/v1/web/login", body, {"Origin: " + w.origin}));
    };
    EXPECT_EQ(post("not json").status, 400);
    EXPECT_EQ(post("[]").status, 400);
    EXPECT_EQ(post(R"({"username":"vh1"})").status, 400);
    EXPECT_EQ(post(R"({"password":"x"})").status, 400);
    EXPECT_EQ(post(R"({"username":1,"password":"x"})").status, 400);
    EXPECT_EQ(post(R"({"user":"vh1","password":"x"})").status, 400) << "the key is `username`";
    EXPECT_EQ(post(json{{"username", std::string(65, 'a')}, {"password", "x"}}.dump()).status, 400);
    EXPECT_EQ(post(json{{"username", "vh1"}, {"password", std::string(513, 'a')}}.dump()).status,
              400);
    // 4 KiB
    const HttpResult big =
        post(json{{"username", "vh1"}, {"password", std::string(5000, 'a')}}.dump());
    EXPECT_EQ(big.status, 413);
    EXPECT_EQ(bodyJson(big)["error"], "BODY_TOO_LARGE");
    EXPECT_TRUE(w.records("auth.login").empty());
}

TEST(WebLogin, OverPlainHttpThereIsNoSignIn) {  // A8
    Web w;
    HttpRequest q =
        postReq("/api/v1/web/login", json{{"username", "vh1"}, {"password", w.pw["vh1"]}}.dump(),
                {"Origin: http://127.0.0.1"});
    const HttpResult r = w.callHttp(q);
    EXPECT_EQ(r.status, 403);
    EXPECT_EQ(bodyJson(r)["error"], "HTTPS_REQUIRED");
    EXPECT_TRUE(setCookies(r).empty());
}

TEST(WebLogin, NoAuditNoSession) {
    Web w;
    w.audit->close();
    const HttpResult r = w.webLogin("vh1");
    EXPECT_EQ(r.status, 503);
    EXPECT_EQ(bodyJson(r)["error"], "AUDIT_UNAVAILABLE");
    EXPECT_TRUE(setCookies(r).empty());
}

TEST(WebLogin, EveryRoleSignsInAndTheAccountsAreStillOnlyManagedByCommand) {  // FR-048
    Web w;
    for (const auto& [user, role] :
         std::vector<std::pair<const char*, const char*>>{{"xem1", "viewer"},
                                                          {"vh1", "operator"},
                                                          {"kysu1", "engineer"},
                                                          {"admin1", "administrator"}}) {
        const HttpResult r = w.webLogin(user);
        ASSERT_EQ(r.status, 200) << user << r.body;
        EXPECT_EQ(bodyJson(r)["role"], role);
    }
    for (const char* path :
         {"/api/v1/web/register", "/api/v1/web/signup", "/api/v1/web/password", "/api/v1/web/reset",
          "/api/v1/web/forgot", "/api/v1/web/account", "/api/v1/web/users"})
        for (const char* method : {"POST", "GET"}) {
            HttpRequest q;
            q.method = method;
            q.path = path;
            q.body = "{}";
            q.headers = {"Origin: " + w.origin, "Content-Type: application/json"};
            const HttpResult r = w.call(q);
            EXPECT_EQ(r.status, 404) << method << " " << path;
        }
}

TEST(WebLogin, ThirteenSessionsPutTheIdlestOneOut) {  // A27 (default quota 12)
    Web w;
    std::vector<Web::Session> s;
    for (int i = 0; i < 13; ++i) {
        s.push_back(w.open("vh1"));
        w.mono += 1000;
    }
    EXPECT_EQ(w.as(s[0], "GET", "/api/v1/web/session").status, 401) << "the first one went";
    EXPECT_EQ(w.as(s[12], "GET", "/api/v1/web/session").status, 200);
    EXPECT_EQ(w.as(s[1], "GET", "/api/v1/web/session").status, 200);
    const auto evicted = w.records("auth.session_evicted");
    ASSERT_EQ(evicted.size(), 1u);
    EXPECT_EQ(evicted[0].user, std::optional<std::string>("vh1"));
}

// --- GET /web/session, POST /web/touch, POST /web/logout

TEST(WebSession, TheSessionAnswersWithTheTokenItWasGiven) {
    Web w;
    const Web::Session s = w.open("vh1");
    HttpRequest q =
        getReq("/api/v1/web/session", {s.cookieHeader(), "Sec-Fetch-Site: same-origin"});
    const HttpResult r = w.call(q);
    ASSERT_EQ(r.status, 200) << r.body;
    const json b = bodyJson(r);
    EXPECT_EQ(b["csrfToken"], s.csrf);
    EXPECT_EQ(b["user"], "vh1");
    EXPECT_EQ(b["role"], "operator");
    EXPECT_TRUE(setCookies(r).empty()) << "no new cookie";
    EXPECT_EQ(header(r, "Cache-Control"), "no-store");
    // no cookie, a made-up one, one of the Studio's kind
    EXPECT_EQ(w.call(getReq("/api/v1/web/session")).status, 401);
    EXPECT_EQ(bodyJson(w.call(getReq("/api/v1/web/session"))).value("error", ""), "AUTH_REQUIRED");
    const std::string bearer = w.bearer("vh1").substr(std::string("Authorization: Bearer ").size());
    EXPECT_EQ(bodyJson(w.call(getReq("/api/v1/web/session", {"Cookie: __Host-mat_sid=" + bearer})))
                  .value("error", ""),
              "AUTH_REQUIRED")
        << "A14: a Studio token in a cookie is not a cookie";
}

TEST(WebSession, ACrossSiteReadIsRefused) {  // A18
    Web w;
    const Web::Session s = w.open("vh1");
    for (const char* site : {"cross-site", "same-site", "none"}) {
        const HttpResult r = w.call(getReq(
            "/api/v1/web/session", {s.cookieHeader(), std::string("Sec-Fetch-Site: ") + site}));
        EXPECT_EQ(r.status, 403) << site;
        EXPECT_EQ(bodyJson(r)["error"], "FETCH_SITE") << site;
    }
    EXPECT_EQ(w.call(getReq("/api/v1/web/session", {s.cookieHeader()})).status, 200)
        << "an old client that sends no Sec-Fetch headers";
}

TEST(WebSession, TheCookieIsDeadAfterLogoutAndLogoutClearsIt) {  // A22
    Web w;
    const Web::Session s = w.open("vh1");
    const HttpResult out = w.as(s, "POST", "/api/v1/web/logout");
    EXPECT_EQ(out.status, 204) << out.body;
    const auto cookies = setCookies(out);
    ASSERT_EQ(cookies.size(), 1u);
    EXPECT_EQ(cookies[0].rfind("__Host-mat_sid=;", 0), 0u) << cookies[0];
    EXPECT_TRUE(hasAttr(cookies[0], "Max-Age=0")) << cookies[0];
    EXPECT_TRUE(hasAttr(cookies[0], "Secure"));
    EXPECT_TRUE(hasAttr(cookies[0], "HttpOnly"));
    EXPECT_TRUE(hasAttr(cookies[0], "Path=/"));
    EXPECT_EQ(w.as(s, "GET", "/api/v1/web/session").status, 401);
    const auto rows = w.records("auth.logout");
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].channel, "web");
    // a dead or missing cookie: still 204 and the cookie is cleared
    const HttpResult again = w.as(s, "POST", "/api/v1/web/logout");
    EXPECT_EQ(again.status, 204);
    EXPECT_EQ(setCookies(again).size(), 1u);
    HttpRequest none = postReq("/api/v1/web/logout", "", {"Origin: " + w.origin});
    EXPECT_EQ(w.call(none).status, 204);
}

// Feature 011 (FR-026, L-13 of 007, S-L2): logout ends the session on the device, not only the
// cookie in the browser: the old cookie, sent again with its own CSRF token, opens nothing.
TEST(WebSession, AfterLogoutTheOldCookieIsDeadOnTheDeviceForEveryUse) {
    Web w;
    const Web::Session s = w.open("vh1");
    const Web::Session other = w.open("vh1");  // a second session of the same account stays
    ASSERT_EQ(w.as(s, "POST", "/api/v1/web/logout").status, 204);
    EXPECT_EQ(w.as(s, "GET", "/api/v1/web/session").status, 401);
    EXPECT_EQ(w.as(s, "POST", "/api/v1/web/touch").status, 401);
    EXPECT_EQ(w.as(s, "POST", "/api/v1/web/logout").status, 204) << "still clears the cookie";
    EXPECT_EQ(w.as(other, "GET", "/api/v1/web/session").status, 200);
}

TEST(WebSession, LogoutOfALiveSessionNeedsItsCsrfTokenAndTheOrigin) {
    Web w;
    const Web::Session s = w.open("vh1");
    HttpRequest q = postReq("/api/v1/web/logout", "", {s.cookieHeader(), "Origin: " + w.origin});
    EXPECT_EQ(bodyJson(w.call(q)).value("error", ""), "CSRF_FAILED");
    q.headers = {s.cookieHeader(), "X-MAT-CSRF: " + s.csrf, "Origin: https://evil.example"};
    EXPECT_EQ(bodyJson(w.call(q)).value("error", ""), "ORIGIN_MISMATCH");
    EXPECT_EQ(w.as(s, "GET", "/api/v1/web/session").status, 200) << "still signed in";
}

TEST(WebSession, TouchRestartsTheIdleTimeAndAReadDoesNot) {
    Web w;
    const Web::Session s = w.open("vh1");
    w.mono += 25 * 60 * 1000;
    EXPECT_EQ(w.as(s, "GET", "/api/v1/web/session").status, 200);
    w.mono += 10 * 60 * 1000;
    EXPECT_EQ(w.as(s, "GET", "/api/v1/web/session").status, 401) << "35 minutes without a touch";
    const Web::Session t = w.open("vh1");
    w.mono += 25 * 60 * 1000;
    EXPECT_EQ(w.as(t, "POST", "/api/v1/web/touch").status, 204);
    w.mono += 25 * 60 * 1000;
    EXPECT_EQ(w.as(t, "GET", "/api/v1/web/session").status, 200);
    // it needs the Origin and the token like any change
    HttpRequest q = postReq("/api/v1/web/touch", "", {t.cookieHeader()});
    EXPECT_EQ(w.call(q).status, 403);
}

TEST(WebSession,
     ABearerTokenCannotUseTheWebEndpointsAndTheCookieReachesNothingTechnical) {  // A9 to A13
    Web w;
    const Web::Session s = w.open("kysu1");  // an engineer's session
    const std::string bearer = w.bearer("kysu1");
    EXPECT_EQ(w.call(getReq("/api/v1/web/session", {bearer})).status, 403);
    EXPECT_EQ(bodyJson(w.call(getReq("/api/v1/web/session", {bearer}))).value("error", ""),
              "SESSION_SCOPE");
    // the web token in the Authorization header
    EXPECT_EQ(bodyJson(w.call(getReq("/api/v1/diagnostics", {"Authorization: Bearer " + s.token})))
                  .value("error", ""),
              "SESSION_SCOPE");
    // the cookie on technical endpoints
    for (const auto& [method, path] :
         {std::pair<const char*, const char*>{"POST", "/api/v1/project/deployments"},
          {"POST", "/api/v1/project/restore"},
          {"GET", "/api/v1/project/versions"},
          {"GET", "/api/v1/audit"},
          {"GET", "/api/v1/diagnostics"},
          {"POST", "/api/v1/drivers/test"},
          {"GET", "/api/v1/drivers/diagnostics"},
          {"GET", "/api/v1/serial/ports"},
          {"GET", "/api/v1/auth/session"},
          {"POST", "/api/v1/auth/logout"}}) {
        const HttpResult r = w.as(s, method, path, method == std::string("POST") ? "{}" : "");
        EXPECT_EQ(r.status, 403) << path;
        EXPECT_EQ(bodyJson(r).value("error", ""), "SESSION_SCOPE") << path;
    }
    const auto denied = w.records("access.denied");
    ASSERT_FALSE(denied.empty());
    bool sawWeb = false;
    for (const auto& row : denied)
        if (row.code == std::optional<std::string>("SESSION_SCOPE") && row.channel == "web")
            sawWeb = true;
    EXPECT_TRUE(sawWeb);
    // the Bearer session of the same account is not touched by any of it
    EXPECT_EQ(w.call(getReq("/api/v1/diagnostics", {bearer})).status, 501)
        << "the Bearer session works (no diagnostics backend in this rig)";
}

// --- GET /login, system/info.web, viewerLogin

TEST(WebPage, LoginPageIsServedOverHttpsToEverySource) {
    Web w;
    w.servePage(false);
    const HttpResult r = w.call(getReq("/login"));
    ASSERT_EQ(r.status, 200) << r.body;
    EXPECT_NE(r.body.find("login page"), std::string::npos);
    EXPECT_NE(lowered(header(r, "Content-Type")).find("text/html"), std::string::npos);
    EXPECT_NE(header(r, "Content-Security-Policy").find("frame-ancestors 'none'"),
              std::string::npos);
    EXPECT_NE(header(r, "Content-Security-Policy").find("script-src 'self'"), std::string::npos);
    EXPECT_EQ(header(r, "Cache-Control"), "no-cache");
    EXPECT_EQ(w.call(getReq("/login/")).status, 404);
}

TEST(WebPage, LoginOverHttpRedirectsToHttps) {
    Web w;
    w.servePage(false);
    const HttpResult r = w.callHttp(getReq("/login"));
    EXPECT_EQ(r.status, 302);
    EXPECT_EQ(header(r, "Location"),
              "https://127.0.0.1:" + std::to_string(w.web.httpsPort()) + "/login");
    // without HTTPS there is nothing to redirect to
    w.device->setHttps(HttpsState::CertError);
    EXPECT_EQ(w.callHttp(getReq("/login")).status, 404);
}

TEST(WebPage, TheHttpRedirectNeverRepeatsAnUnsafeHostHeader) {
    Web w;
    w.servePage(false);
    for (const char* host : {"evil.example/\r\nSet-Cookie: x=y", "a b", "ex'ample", "<x>", ""}) {
        HttpRequest q = getReq("/login");
        q.headers = {std::string("Host: ") + host};
        const HttpResult r = w.callHttp(q);
        EXPECT_NE(r.status, 302) << host;
        EXPECT_EQ(header(r, "Set-Cookie"), "") << host;
    }
}

TEST(WebPage, SystemInfoCarriesTheWebBlockAndTheCertificateWarnings) {
    Web w;
    w.servePage(false);
    w.device->setWarnings({"TLS_NO_IP_SAN"});
    const json info = bodyJson(w.call(getReq("/api/v1/system/info")));
    EXPECT_EQ(info["web"]["https"], true);
    EXPECT_EQ(info["web"]["httpsPort"], w.web.httpsPort());
    EXPECT_EQ(info["web"]["login"], true);
    EXPECT_EQ(info["web"]["viewerLogin"], "off");
    EXPECT_EQ(info["device"]["apiVersion"], "1.4.0");
    bool noIp = false, down = false;
    for (const auto& x : info["warnings"]) {
        noIp = noIp || x == "TLS_NO_IP_SAN";
        down = down || x == "HTTPS_DOWN";
    }
    EXPECT_TRUE(noIp);
    EXPECT_FALSE(down);
    w.device->setHttps(HttpsState::CertError);
    const json broken = bodyJson(w.callHttp(getReq("/api/v1/system/info")));
    EXPECT_EQ(broken["web"]["login"], false);
    bool downNow = false;
    for (const auto& x : broken["warnings"]) downNow = downNow || x == "HTTPS_DOWN";
    EXPECT_TRUE(downNow);
}

TEST(WebPage, ViewerLoginOffChangesNothingForThePageOrTheData) {
    Web w;
    w.servePage(false);
    EXPECT_EQ(w.call(getReq("/")).status, 200);
    EXPECT_EQ(w.callHttp(getReq("/")).status, 200);
    EXPECT_EQ(w.call(getReq("/api/v1/projects/active")).status, 200);
    EXPECT_EQ(w.call(getReq("/assets/index-b2.js")).status, 200);
    EXPECT_EQ(w.call(getReq("/project/screens/main.screen.json")).status, 200);
}

TEST(WebPage, ViewerLoginRequiredSendsTheVisitorToTheLoginPage) {
    Web w;
    w.servePage(true, ViewerAccess::Private, /*privateSource=*/true);
    // the page: 302 to /login
    const HttpResult page = w.call(getReq("/"));
    EXPECT_EQ(page.status, 302);
    EXPECT_EQ(header(page, "Location"), "/login");
    // data and the main bundle: 401
    for (const char* path :
         {"/api/v1/projects/active", "/project/screens/main.screen.json", "/assets/index-b2.js"}) {
        const HttpResult r = w.call(getReq(path));
        EXPECT_EQ(r.status, 401) << path;
        EXPECT_EQ(bodyJson(r)["error"], "AUTH_REQUIRED") << path;
    }
    // over HTTP: no data, and the page is a guide to HTTPS (a cookie does not travel over HTTP)
    EXPECT_EQ(w.callHttp(getReq("/api/v1/projects/active")).status, 401);
    const HttpResult guide = w.callHttp(getReq("/"));
    EXPECT_EQ(guide.status, 200);
    EXPECT_NE(guide.body.find("https://127.0.0.1:" + std::to_string(w.web.httpsPort()) + "/"),
              std::string::npos)
        << guide.body;
    EXPECT_NE(header(guide, "Content-Security-Policy").find("default-src 'none'"),
              std::string::npos);
    EXPECT_EQ(guide.body.find("runtime page"), std::string::npos);
    // the login page, its bundle and the certificate stay open
    EXPECT_EQ(w.call(getReq("/login")).status, 200);
    EXPECT_EQ(w.call(getReq("/assets/login-a1.js")).status, 200);
    EXPECT_EQ(w.call(getReq("/device.crt")).status, 200);
    // system/info: the small form
    const json info = bodyJson(w.call(getReq("/api/v1/system/info")));
    EXPECT_EQ(info["runtimeVersion"], "0.8.0");
    EXPECT_EQ(info["web"]["viewerLogin"], "required");
    EXPECT_FALSE(info.contains("project")) << "nothing about the project without a session";
    EXPECT_FALSE(info.contains("device"));
    // with the session of the page: everything
    const Web::Session s = w.open("xem1");
    auto asPage = [&](const std::string& path) { return w.call(getReq(path, {s.cookieHeader()})); };
    EXPECT_EQ(asPage("/").status, 200);
    EXPECT_EQ(asPage("/api/v1/projects/active").status, 200);
    EXPECT_EQ(asPage("/assets/index-b2.js").status, 200);
    EXPECT_TRUE(bodyJson(asPage("/api/v1/system/info")).contains("project"));
    // the cookie over HTTP counts for nothing
    HttpRequest overHttp = getReq("/api/v1/projects/active", {s.cookieHeader()});
    EXPECT_EQ(w.callHttp(overHttp).status, 401);
    // a session of the Studio opens it too
    EXPECT_EQ(w.call(getReq("/api/v1/projects/active", {w.bearer("xem1")})).status, 200);
    // a cookie that is dead is a visitor again
    w.as(s, "POST", "/api/v1/web/logout");
    EXPECT_EQ(asPage("/").status, 302);
}

// viewerAccess off wins over viewerLogin: a source without a session gets 403 for the page and the
// data, and still reaches the login page; a session opens everything.
TEST(WebPage, ViewerAccessOffIsStrongerThanViewerLogin) {
    Web w;
    w.servePage(true, ViewerAccess::Off, /*privateSource=*/true);
    EXPECT_EQ(w.call(getReq("/")).status, 403);
    EXPECT_EQ(bodyJson(w.call(getReq("/api/v1/projects/active")))["error"], "VIEWER_OFF");
    EXPECT_EQ(w.call(getReq("/login")).status, 200);
    EXPECT_EQ(w.call(getReq("/device.crt")).status, 200);
    const Web::Session s = w.open("xem1");
    EXPECT_EQ(w.call(getReq("/", {s.cookieHeader()})).status, 200)
        << "a valid session still enters";
}

TEST(WebPage, DeviceCertificateIsPublicAndHasNoKey) {
    Web w;
    w.servePage(false);
    const HttpResult r = w.call(getReq("/device.crt"));
    ASSERT_EQ(r.status, 200) << r.body;
    EXPECT_EQ(lowered(header(r, "Content-Type")), "application/x-x509-ca-cert");
    EXPECT_EQ(header(r, "Content-Disposition"), "attachment; filename=\"mat-device.crt\"");
    EXPECT_NE(r.body.find("-----BEGIN CERTIFICATE-----"), std::string::npos);
    EXPECT_EQ(r.body.find("PRIVATE KEY"), std::string::npos);
    EXPECT_EQ(w.callHttp(getReq("/device.crt")).status, 404) << "over HTTPS only";
}
