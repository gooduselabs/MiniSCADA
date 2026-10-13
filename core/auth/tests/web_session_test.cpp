// T052 (feature 007; contracts/web-session.md §1, §6, device-api-1.2.md §2, ADR-021 points 1, 2,
// 5): the sessions of the web page behind the cookie `__Host-mat_sid`, in AuthService.
// - A web session has its own token (`matw_…`), a CSRF token (32 random bytes, base64url, kept in
//   plain text in RAM and in auth-state.json, never in the audit or the log), the address of the
//   sign-in, and idle and lifetime limits that the configuration sets.
// - Same accounts, same lockout, same hash queue as the Bearer sign-in; the audit channel is `web`.
// - Tokens of the two kinds never work in the other's place; signing out of one kind leaves the
//   other alone.
// - At most `webMaxSessions` web sessions: the idlest one leaves for a new one (audit
//   auth.session_evicted); all kinds together at most 32.
// - Across execv: kind, CSRF and limits survive in auth-state.json (0600).
#include <gtest/gtest.h>
#include <sys/stat.h>

#include <atomic>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/auth/auth_service.hpp"
#include "core/auth/session_store.hpp"
#include "core/auth/tests/auth_test_support.hpp"
#include "core/crypto/random.hpp"
#include "nlohmann/json.hpp"

using namespace mat;
using mat::test::TempDir;
using mat::test::TestAccount;

namespace {

constexpr int64_t kT0 = 9000000;
constexpr int64_t kMin = 60 * 1000;
const std::string kIp = "192.168.1.20";
const std::string kBoot = "5a5a5a5a-4f50-6172-8394-a5b6c7d8e9f0";

PasswordHash refWithSalt(const std::string& salt) {
    PasswordHash r;
    r.salt = salt;
    return r;
}

struct Fx {
    TempDir dir;
    std::string usersFile = dir.file("users.json");
    std::atomic<int64_t> now{kT0};
    int64_t webIdleS = 1800;
    int64_t webMaxS = 43200;
    size_t webMax = 8;

    std::mutex mu;
    std::vector<AuditEvent> events;
    std::vector<std::string> logs;
    std::map<std::string, std::string> pw, salt;
    std::unique_ptr<AuthService> auth;

    ~Fx() { auth.reset(); }

    AuthOptions options() {
        AuthOptions o;
        o.usersFile = usersFile;
        o.audit = [this](const AuditEvent& e) {
            std::lock_guard<std::mutex> l(mu);
            events.push_back(e);
        };
        o.log = [this](const std::string& line) {
            std::lock_guard<std::mutex> l(mu);
            logs.push_back(line);
        };
        o.monoMs = [this] { return now.load(); };
        o.hash = [](std::string_view password, const PasswordHash& ref) {
            return mat::test::fakeHash(password, ref);
        };
        o.bootId = [] { return kBoot; };
        o.webIdleLimitS = webIdleS;
        o.webMaxLifetimeS = webMaxS;
        o.webMaxSessions = webMax;
        return o;
    }
    void start() { auth = std::make_unique<AuthService>(options()); }
    void advance(int64_t ms) { now += ms; }

    TestAccount account(const std::string& name, const std::string& role, bool enabled = true,
                        int64_t rev = 1) {
        if (!pw.count(name)) {
            pw[name] = mat::test::randomPassword();
            salt[name] = randomBytes(kSaltBytes);
        }
        const std::string phc =
            mat::test::phcText(kArgon2Default.mKiB, kArgon2Default.t, kArgon2Default.p, salt[name],
                               mat::test::fakeHash(pw[name], refWithSalt(salt[name])));
        return {name, role, phc, enabled, rev, 0};
    }
    void writeUsers(const std::vector<TestAccount>& accounts) {
        mat::test::writeFile(dir.file("users.tmp"), mat::test::usersText(accounts), 0640);
        ::rename(dir.file("users.tmp").c_str(), usersFile.c_str());
    }
    std::vector<TestAccount> standard() {
        return {account("admin", "administrator"), account("vanhanh1", "operator"),
                account("xem1", "viewer")};
    }

    LoginResult loginWeb(const std::string& user, const std::string& ip = kIp, int port = 50000) {
        std::string password = pw.at(user);
        return auth->loginWeb(user, password, ClientAddress{ip, port});
    }
    LoginResult loginBearer(const std::string& user, const std::string& ip = kIp) {
        std::string password = pw.at(user);
        return auth->login(user, password, ClientAddress{ip, 50001});
    }
    WebAccess web(const std::string& token, Role min = Role::Viewer, bool refresh = false,
                  const std::string& ip = kIp) {
        return auth->authorizeWeb(token, ClientAddress{ip, 50000}, min, refresh);
    }

    std::vector<AuditEvent> audit(AuditAction a) {
        std::lock_guard<std::mutex> l(mu);
        std::vector<AuditEvent> out;
        for (const auto& e : events)
            if (e.action == a) out.push_back(e);
        return out;
    }
    std::string transcript() {
        std::lock_guard<std::mutex> l(mu);
        std::string s;
        for (const auto& e : events)
            s += std::string(auditActionName(e.action)) + " " + auditChannelName(e.channel) + " " +
                 e.source + " " + e.user.value_or("-") + " " + e.detail + " " +
                 e.code.value_or("-") + "\n";
        for (const auto& l : logs) s += l + "\n";
        return s;
    }
};

bool isBase64Url43(const std::string& s) {
    if (s.size() != 43) return false;
    for (const char c : s)
        if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
              c == '-' || c == '_'))
            return false;
    return true;
}

}  // namespace

TEST(WebSession, LoginGivesAMatwTokenAndACsrfToken) {
    Fx f;
    f.writeUsers(f.standard());
    f.start();
    const LoginResult r = f.loginWeb("vanhanh1");
    ASSERT_EQ(r.status, LoginStatus::Ok) << loginErrorCode(r.status);
    EXPECT_EQ(r.token.rfind("matw_", 0), 0u) << r.token;
    EXPECT_TRUE(isWebTokenFormat(r.token));
    EXPECT_FALSE(isTokenFormat(r.token)) << "not a Bearer token";
    EXPECT_EQ(r.token.size(), kTokenLength);
    EXPECT_TRUE(isBase64Url43(r.csrf)) << r.csrf;
    EXPECT_EQ(r.user, "vanhanh1");
    EXPECT_EQ(r.role, Role::Operator);
    EXPECT_EQ(r.idleTimeoutS, 1800);
    EXPECT_EQ(r.maxSessionS, 43200);
    const auto ok = f.audit(AuditAction::AuthLogin);
    ASSERT_EQ(ok.size(), 1u);
    EXPECT_EQ(ok[0].channel, AuditChannel::Web);
    EXPECT_EQ(ok[0].result, AuditResult::Ok);
    EXPECT_EQ(ok[0].user, std::optional<std::string>("vanhanh1"));
    EXPECT_EQ(ok[0].source, kIp + ":50000");

    const WebAccess a = f.web(r.token);
    ASSERT_EQ(a.status, AccessStatus::Ok);
    EXPECT_EQ(a.user, "vanhanh1");
    EXPECT_EQ(a.role, std::optional<Role>(Role::Operator));
    EXPECT_EQ(a.csrf, r.csrf) << "the page gets it back after F5 (GET web/session)";
    EXPECT_EQ(a.idleTimeoutS, 1800);
    EXPECT_EQ(a.maxSessionS, 43200);
}

TEST(WebSession, EveryLoginHasANewTokenAndANewCsrf) {
    Fx f;
    f.writeUsers(f.standard());
    f.start();
    const LoginResult a = f.loginWeb("vanhanh1");
    const LoginResult b = f.loginWeb("vanhanh1");
    ASSERT_EQ(a.status, LoginStatus::Ok);
    ASSERT_EQ(b.status, LoginStatus::Ok);
    EXPECT_NE(a.token, b.token) << "no session fixation: a token is never chosen by the client";
    EXPECT_NE(a.csrf, b.csrf);
    EXPECT_EQ(f.web(a.token).status, AccessStatus::Ok) << "the old session lives on";
    EXPECT_EQ(f.web(a.token).csrf, a.csrf);
    EXPECT_EQ(f.web(b.token).csrf, b.csrf);
}

TEST(WebSession, WrongPasswordsAreTheSameFailureAndLockLikeBearer) {
    Fx f;
    f.writeUsers(f.standard());
    f.start();
    for (int i = 0; i < 5; ++i) {
        std::string wrong = mat::test::randomPassword();
        const LoginResult r = f.auth->loginWeb("vanhanh1", wrong, {kIp, 50000});
        EXPECT_EQ(r.status, LoginStatus::Failed) << i;
        EXPECT_TRUE(r.token.empty());
        EXPECT_TRUE(r.csrf.empty());
    }
    // the sixth, even with the right password: locked (A26), for the Bearer sign-in too
    EXPECT_EQ(f.loginWeb("vanhanh1").status, LoginStatus::Locked);
    EXPECT_EQ(f.loginBearer("vanhanh1").status, LoginStatus::Locked);
    const auto failed = f.audit(AuditAction::AuthLogin);
    ASSERT_FALSE(failed.empty());
    for (const auto& e : failed) EXPECT_EQ(e.channel, AuditChannel::Web);
    EXPECT_FALSE(f.audit(AuditAction::AuthLockout).empty());
}

TEST(WebSession, AViewerCanSignInToo) {
    Fx f;
    f.writeUsers(f.standard());
    f.start();
    const LoginResult r = f.loginWeb("xem1");
    ASSERT_EQ(r.status, LoginStatus::Ok);
    EXPECT_EQ(r.role, Role::Viewer);
    EXPECT_EQ(f.web(r.token, Role::Viewer).status, AccessStatus::Ok);
    EXPECT_EQ(f.web(r.token, Role::Operator).status, AccessStatus::Forbidden);
}

TEST(WebSession, TokensOfTheTwoKindsDoNotWorkInEachOthersPlace) {
    Fx f;
    f.writeUsers(f.standard());
    f.start();
    const LoginResult w = f.loginWeb("vanhanh1");
    const LoginResult b = f.loginBearer("vanhanh1");
    ASSERT_EQ(w.status, LoginStatus::Ok);
    ASSERT_EQ(b.status, LoginStatus::Ok);
    ASSERT_NE(w.token, b.token);
    // the Bearer path never knows a web token, the web path never a Bearer token
    EXPECT_EQ(f.auth->authorize(w.token, {kIp, 1}, Role::Viewer, false).status,
              AccessStatus::SessionExpired);
    EXPECT_EQ(f.web(b.token).status, AccessStatus::SessionExpired);
    EXPECT_EQ(f.auth->logout(w.token, {kIp, 1}), AccessStatus::SessionExpired);
    EXPECT_EQ(f.auth->logoutWeb(b.token, {kIp, 1}), AccessStatus::SessionExpired);
    // and both are still there
    EXPECT_EQ(f.web(w.token).status, AccessStatus::Ok);
    EXPECT_EQ(f.auth->authorize(b.token, {kIp, 1}, Role::Viewer, false).status, AccessStatus::Ok);
}

TEST(WebSession, SigningOutOfOneKindLeavesTheOtherAlone) {  // US3-23
    Fx f;
    f.writeUsers(f.standard());
    f.start();
    const LoginResult w = f.loginWeb("vanhanh1");
    const LoginResult b = f.loginBearer("vanhanh1");
    EXPECT_EQ(f.auth->logoutWeb(w.token, {kIp, 1}), AccessStatus::Ok);
    EXPECT_EQ(f.web(w.token).status, AccessStatus::SessionExpired) << "A22: the cookie is dead";
    EXPECT_EQ(f.auth->authorize(b.token, {kIp, 1}, Role::Viewer, false).status, AccessStatus::Ok);
    const auto out = f.audit(AuditAction::AuthLogout);
    ASSERT_EQ(out.size(), 1u);
    EXPECT_EQ(out[0].channel, AuditChannel::Web);
    EXPECT_EQ(out[0].user, std::optional<std::string>("vanhanh1"));
    // the other way round
    const LoginResult w2 = f.loginWeb("vanhanh1");
    EXPECT_EQ(f.auth->logout(b.token, {kIp, 1}), AccessStatus::Ok);
    EXPECT_EQ(f.web(w2.token).status, AccessStatus::Ok);
}

TEST(WebSession, IdleLimitComesFromTheConfigurationAndOnlyAPersonRestartsIt) {
    Fx f;
    f.webIdleS = 300;  // 5 minutes
    f.writeUsers(f.standard());
    f.start();
    const LoginResult r = f.loginWeb("vanhanh1");
    ASSERT_EQ(r.status, LoginStatus::Ok);
    EXPECT_EQ(r.idleTimeoutS, 300);
    f.advance(4 * kMin);
    // a read (refresh false: GET, live) does not restart the idle time
    WebAccess a = f.web(r.token, Role::Viewer, false);
    ASSERT_EQ(a.status, AccessStatus::Ok);
    EXPECT_EQ(a.idleRemainingS, 60);
    f.advance(2 * kMin);
    EXPECT_EQ(f.web(r.token).status, AccessStatus::SessionExpired) << "idle for 6 minutes";

    // a person's request (POST, touch) does
    const LoginResult s = f.loginWeb("vanhanh1");
    f.advance(4 * kMin);
    a = f.web(s.token, Role::Viewer, true);
    ASSERT_EQ(a.status, AccessStatus::Ok);
    EXPECT_EQ(a.idleRemainingS, 300);
    f.advance(4 * kMin);
    EXPECT_EQ(f.web(s.token).status, AccessStatus::Ok);
    f.auth->touchWeb(s.token);
    f.advance(4 * kMin);
    EXPECT_EQ(f.web(s.token).status, AccessStatus::Ok) << "touch restarted it";
    f.advance(2 * kMin);
    EXPECT_EQ(f.web(s.token).status, AccessStatus::SessionExpired);
}

TEST(WebSession, ALoginThatIsNotGrantedDoesNotRestartAnything) {
    Fx f;
    f.webIdleS = 300;
    f.writeUsers(f.standard());
    f.start();
    const LoginResult r = f.loginWeb("xem1");
    f.advance(4 * kMin);
    // a viewer asking for an operator endpoint is refused: no refresh
    EXPECT_EQ(f.web(r.token, Role::Operator, true).status, AccessStatus::Forbidden);
    f.advance(2 * kMin);
    EXPECT_EQ(f.web(r.token).status, AccessStatus::SessionExpired);
}

TEST(WebSession, LifetimeLimitComesFromTheConfigurationWhateverTheActivity) {
    Fx f;
    f.webMaxS = 3600;  // 1 hour
    f.writeUsers(f.standard());
    f.start();
    const LoginResult r = f.loginWeb("vanhanh1");
    EXPECT_EQ(r.maxSessionS, 3600);
    for (int i = 0; i < 5; ++i) {
        f.advance(10 * kMin);
        ASSERT_EQ(f.web(r.token, Role::Viewer, true).status, AccessStatus::Ok) << i;
    }
    const WebAccess a = f.web(r.token, Role::Viewer, true);
    ASSERT_EQ(a.status, AccessStatus::Ok);
    EXPECT_EQ(a.lifetimeRemainingS, 600);
    f.advance(11 * kMin);
    EXPECT_EQ(f.web(r.token, Role::Viewer, true).status, AccessStatus::SessionExpired);
}

TEST(WebSession, ABearerSessionKeepsItsOwnLimits) {
    Fx f;
    f.webIdleS = 60;
    f.webMaxS = 120;
    f.writeUsers(f.standard());
    f.start();
    const LoginResult b = f.loginBearer("vanhanh1");
    f.advance(10 * kMin);
    EXPECT_EQ(f.auth->authorize(b.token, {kIp, 1}, Role::Viewer, false).status, AccessStatus::Ok);
    f.advance(25 * kMin);
    EXPECT_EQ(f.auth->authorize(b.token, {kIp, 1}, Role::Viewer, false).status,
              AccessStatus::SessionExpired)
        << "30 minutes idle, as before";
}

TEST(WebSession, AnotherAddressIsInvalidAndTheOwnerKeepsTheSession) {
    Fx f;
    f.writeUsers(f.standard());
    f.start();
    const LoginResult r = f.loginWeb("vanhanh1", "192.168.1.20");
    EXPECT_EQ(f.web(r.token, Role::Viewer, false, "192.168.1.21").status,
              AccessStatus::SessionInvalid)
        << "A23";
    EXPECT_EQ(f.web(r.token, Role::Viewer, false, "192.168.1.20").status, AccessStatus::Ok);
    // IPv4 mapped in IPv6 is the same address
    EXPECT_EQ(f.web(r.token, Role::Viewer, false, "::ffff:192.168.1.20").status, AccessStatus::Ok);
    const LoginResult m = f.loginWeb("vanhanh1", "::ffff:10.0.0.7");
    EXPECT_EQ(f.web(m.token, Role::Viewer, false, "10.0.0.7").status, AccessStatus::Ok);
}

TEST(WebSession, ChangingTheAccountEndsItsWebSessions) {  // A28
    Fx f;
    auto accounts = f.standard();
    f.writeUsers(accounts);
    f.start();
    const LoginResult r = f.loginWeb("vanhanh1");
    const LoginResult other = f.loginWeb("xem1");
    ASSERT_EQ(f.web(r.token).status, AccessStatus::Ok);
    accounts[1].rev = 2;  // a new password through the device command
    f.writeUsers(accounts);
    f.advance(kUsersRecheckMs);
    EXPECT_NE(f.web(r.token).status, AccessStatus::Ok);
    EXPECT_NE(f.web(r.token).status, AccessStatus::Forbidden);
    EXPECT_EQ(f.web(other.token).status, AccessStatus::Ok) << "other accounts are not touched";
    EXPECT_FALSE(f.audit(AuditAction::AuthSessionRevoked).empty());
}

TEST(WebSession, ADisabledAccountEndsItsSessionsAndRoleChangesApplyAtOnce) {
    Fx f;
    auto accounts = f.standard();
    f.writeUsers(accounts);
    f.start();
    const LoginResult r = f.loginWeb("vanhanh1");
    ASSERT_EQ(f.web(r.token, Role::Operator).status, AccessStatus::Ok);
    accounts[1].role = "viewer";
    accounts[1].rev = 2;
    f.writeUsers(accounts);
    f.advance(kUsersRecheckMs);
    EXPECT_NE(f.web(r.token, Role::Operator).status, AccessStatus::Ok);
    const LoginResult again = f.loginWeb("vanhanh1");
    ASSERT_EQ(again.status, LoginStatus::Ok);
    EXPECT_EQ(again.role, Role::Viewer);
    accounts[1].enabled = false;
    accounts[1].rev = 3;
    f.writeUsers(accounts);
    f.advance(kUsersRecheckMs);
    EXPECT_NE(f.web(again.token).status, AccessStatus::Ok);
}

TEST(WebSession, TheNinthSessionPutsTheIdlestOneOut) {  // A27
    Fx f;
    f.writeUsers(f.standard());
    f.start();
    std::vector<LoginResult> sessions;
    for (int i = 0; i < 8; ++i) {
        sessions.push_back(f.loginWeb("vanhanh1"));
        ASSERT_EQ(sessions.back().status, LoginStatus::Ok) << i;
        f.advance(1000);
    }
    // session 1 is the idlest, until its owner acts: then session 2 is
    ASSERT_EQ(f.web(sessions[0].token, Role::Viewer, true).status, AccessStatus::Ok);
    f.advance(1000);
    const LoginResult ninth = f.loginWeb("vanhanh1");
    ASSERT_EQ(ninth.status, LoginStatus::Ok);
    EXPECT_EQ(f.web(sessions[1].token).status, AccessStatus::SessionExpired) << "the idlest left";
    EXPECT_EQ(f.web(sessions[0].token).status, AccessStatus::Ok);
    for (int i = 2; i < 8; ++i) EXPECT_EQ(f.web(sessions[i].token).status, AccessStatus::Ok) << i;
    EXPECT_EQ(f.web(ninth.token).status, AccessStatus::Ok);
    const auto evicted = f.audit(AuditAction::AuthSessionEvicted);
    ASSERT_EQ(evicted.size(), 1u);
    EXPECT_EQ(evicted[0].user, std::optional<std::string>("vanhanh1"));
    EXPECT_EQ(evicted[0].channel, AuditChannel::System);
    EXPECT_NE(evicted[0].detail.find("web"), std::string::npos) << evicted[0].detail;
}

TEST(WebSession, TheQuotaIsConfigurable) {
    Fx f;
    f.webMax = 2;
    f.writeUsers(f.standard());
    f.start();
    const LoginResult a = f.loginWeb("vanhanh1");
    f.advance(1000);
    const LoginResult b = f.loginWeb("xem1");
    f.advance(1000);
    const LoginResult c = f.loginWeb("admin");
    EXPECT_EQ(f.web(a.token).status, AccessStatus::SessionExpired);
    EXPECT_EQ(f.web(b.token).status, AccessStatus::Ok);
    EXPECT_EQ(f.web(c.token).status, AccessStatus::Ok);
    EXPECT_EQ(f.auth->activeSessions(), 2u);
}

TEST(WebSession, WebSessionsDoNotPushBearerSessionsOutBelowTheQuota) {
    Fx f;
    f.webMax = 2;
    f.writeUsers(f.standard());
    f.start();
    const LoginResult bearer = f.loginBearer("admin");
    for (int i = 0; i < 5; ++i) {
        f.advance(1000);
        ASSERT_EQ(f.loginWeb("vanhanh1").status, LoginStatus::Ok);
    }
    EXPECT_EQ(f.auth->authorize(bearer.token, {kIp, 1}, Role::Viewer, false).status,
              AccessStatus::Ok);
    EXPECT_EQ(f.auth->activeSessions(), 3u) << "1 Bearer and 2 web";
}

TEST(WebSession, AllKindsTogetherAreAtMost32) {
    Fx f;
    f.writeUsers(f.standard());
    f.start();
    std::vector<LoginResult> bearer;
    for (int i = 0; i < 32; ++i) {
        bearer.push_back(f.loginBearer("admin"));
        ASSERT_EQ(bearer.back().status, LoginStatus::Ok);
        f.advance(1000);
    }
    EXPECT_EQ(f.auth->activeSessions(), 32u);
    const LoginResult w = f.loginWeb("vanhanh1");
    ASSERT_EQ(w.status, LoginStatus::Ok);
    EXPECT_EQ(f.auth->activeSessions(), 32u);
    EXPECT_EQ(f.auth->authorize(bearer[0].token, {kIp, 1}, Role::Viewer, false).status,
              AccessStatus::SessionExpired)
        << "the idlest of all went";
    EXPECT_EQ(f.web(w.token).status, AccessStatus::Ok);
}

TEST(WebSession, KindCsrfAndLimitsGoThroughExecv) {
    Fx f;
    f.webIdleS = 600;
    f.webMaxS = 7200;
    f.writeUsers(f.standard());
    f.start();
    const LoginResult w = f.loginWeb("vanhanh1");
    const LoginResult b = f.loginBearer("admin");
    f.advance(5 * kMin);
    const std::string state = f.dir.file("auth-state.json");
    std::string err;
    ASSERT_TRUE(f.auth->saveState(state, err)) << err;
    EXPECT_EQ(mat::test::fileMode(state), 0600u);
    const std::string text = mat::test::readFile(state);
    const nlohmann::json doc = nlohmann::json::parse(text);
    ASSERT_EQ(doc["sessions"].size(), 2u);
    bool sawWeb = false;
    for (const auto& s : doc["sessions"]) {
        if (s.value("kind", "bearer") == "web") {
            sawWeb = true;
            EXPECT_EQ(s.value("csrf", ""), w.csrf);
            EXPECT_EQ(s.value("idleLimitMs", 0), 600000);
            EXPECT_EQ(s.value("maxLimitMs", 0), 7200000);
        } else {
            EXPECT_FALSE(s.contains("csrf")) << "a Bearer session has none";
        }
    }
    EXPECT_TRUE(sawWeb);
    EXPECT_EQ(text.find(w.token), std::string::npos) << "token hashes only";
    EXPECT_EQ(text.find(b.token), std::string::npos);

    // the new process: no file left, both sessions known, the web one with its CSRF and limits
    f.auth.reset();
    f.start();
    f.auth->loadState(state);
    EXPECT_FALSE(mat::test::fileExists(state)) << "read once, then deleted";
    const WebAccess a = f.web(w.token);
    ASSERT_EQ(a.status, AccessStatus::Ok);
    EXPECT_EQ(a.csrf, w.csrf);
    EXPECT_EQ(a.idleTimeoutS, 600);
    EXPECT_EQ(a.maxSessionS, 7200);
    EXPECT_EQ(f.auth->authorize(b.token, {kIp, 1}, Role::Viewer, false).status, AccessStatus::Ok);
    EXPECT_EQ(f.web(b.token).status, AccessStatus::SessionExpired);
    f.advance(6 * kMin);
    EXPECT_EQ(f.web(w.token).status, AccessStatus::SessionExpired) << "its idle limit came with it";
}

TEST(WebSession, AFileOfFeature005WithoutAKindIsBearer) {
    // what 0.5 writes: no kind, no csrf, no limits
    Fx f;
    f.writeUsers(f.standard());
    f.start();
    const LoginResult b = f.loginBearer("admin");
    f.advance(kMin);
    const std::string state = f.dir.file("auth-state.json");
    std::string err;
    ASSERT_TRUE(f.auth->saveState(state, err)) << err;
    nlohmann::json doc = nlohmann::json::parse(mat::test::readFile(state));
    for (auto& s : doc["sessions"]) {
        s.erase("kind");
        s.erase("csrf");
        s.erase("idleLimitMs");
        s.erase("maxLimitMs");
    }
    mat::test::writeFile(state, doc.dump(), 0600);
    f.auth.reset();
    f.start();
    f.auth->loadState(state);
    EXPECT_EQ(f.auth->authorize(b.token, {kIp, 1}, Role::Viewer, false).status, AccessStatus::Ok);
}

TEST(WebSession, AStateFileWithABadWebSessionIsNotUsed) {
    Fx f;
    f.writeUsers(f.standard());
    f.start();
    const LoginResult w = f.loginWeb("vanhanh1");
    const std::string state = f.dir.file("auth-state.json");
    std::string err;
    ASSERT_TRUE(f.auth->saveState(state, err)) << err;
    nlohmann::json doc = nlohmann::json::parse(mat::test::readFile(state));
    doc["sessions"][0]["csrf"] = "short";  // a web session must have a 43-character CSRF token
    mat::test::writeFile(state, doc.dump(), 0600);
    f.auth.reset();
    f.start();
    f.auth->loadState(state);
    EXPECT_EQ(f.web(w.token).status, AccessStatus::SessionExpired);
}

TEST(WebSession, NeitherTokenNorCsrfIsInTheAuditOrTheLog) {
    Fx f;
    f.writeUsers(f.standard());
    f.start();
    const LoginResult w = f.loginWeb("vanhanh1");
    for (int i = 0; i < 9; ++i) f.loginWeb("vanhanh1");  // an eviction too
    f.auth->logoutWeb(w.token, {kIp, 1});
    std::string wrong = "Not#Right1";
    f.auth->loginWeb("vanhanh1", wrong, {kIp, 1});
    const std::string t = f.transcript();
    EXPECT_EQ(t.find(w.token), std::string::npos) << t;
    EXPECT_EQ(t.find(w.csrf), std::string::npos) << t;
    EXPECT_EQ(t.find(f.pw["vanhanh1"]), std::string::npos) << t;
    EXPECT_EQ(t.find("matw_"), std::string::npos) << t;
}

TEST(WebSession, NoAuditNoSession) {
    Fx f;
    f.writeUsers(f.standard());
    AuthOptions o = f.options();
    o.audit = [](const AuditEvent&) { throw AuditUnavailable("test: audit.db read-only"); };
    AuthService auth(std::move(o));
    std::string password = f.pw["vanhanh1"];
    const LoginResult r = auth.loginWeb("vanhanh1", password, {kIp, 1});
    EXPECT_EQ(r.status, LoginStatus::AuditUnavailable);
    EXPECT_TRUE(r.token.empty());
    EXPECT_TRUE(r.csrf.empty());
    EXPECT_EQ(auth.activeSessions(), 0u);
}

TEST(WebSession, TheWebTokenFormatIsExact) {
    const std::string good = "matw_" + std::string(42, 'A') + "A";
    EXPECT_TRUE(isWebTokenFormat(good));
    EXPECT_FALSE(isTokenFormat(good));
    EXPECT_FALSE(isWebTokenFormat("mats_" + std::string(43, 'A')));
    EXPECT_FALSE(isWebTokenFormat("matw_" + std::string(42, 'A')));
    EXPECT_FALSE(isWebTokenFormat("matw_chosen"));
    EXPECT_FALSE(isWebTokenFormat("matw_" + std::string(42, 'A') + "B")) << "last bits must be 0";
    EXPECT_FALSE(isWebTokenFormat("matw_" + std::string(42, 'A') + "+"));
    EXPECT_FALSE(isWebTokenFormat(""));
}
