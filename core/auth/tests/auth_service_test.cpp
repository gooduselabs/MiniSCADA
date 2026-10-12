// T031 (feature 005; research R7–R10, contracts/device-api.md §1.3, §3, data-model §4–5,
// FR-010–FR-015, SC-005): the sign-in flow, sessions and roles behind the HTTPS API.
// - Wrong name and wrong password: the same AUTH_FAILED after the same one hash (a fixed dummy
//   salt with the same parameters for names that cannot sign in: unknown, disabled, damaged, no
//   account at all).
// - Hash queue: one at a time, at most 4 waiting, then AUTH_BUSY; an injected hash function that
//   waits on the test, not on time.
// - Lockout per name and per address; auth.login ok/failed, auth.lockout, auth.locked written
//   before the answer; no audit, no token (AUDIT_UNAVAILABLE).
// - A typed name that cannot be an account (maybe a password in the wrong field) stays out of the
//   audit and the log: user empty, detail {"userInvalid":true}.
// - The test passwords, made at run time, appear in no audit record, log line, stderr byte,
//   audit.db byte or auth-state.json byte.
// - Sessions: address, rev, enabled flag, role read at every request, idle time restarted only by
//   granted requests a person makes; logout; across execv through auth-state.json.
#include "core/auth/auth_service.hpp"

#include <gtest/gtest.h>
#include <sys/stat.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/auth/session_store.hpp"
#include "core/auth/tests/auth_test_support.hpp"
#include "core/crypto/hex.hpp"
#include "core/crypto/random.hpp"
#include "core/crypto/sha256.hpp"
#include "nlohmann/json.hpp"

using namespace mat;
using mat::test::TempDir;
using mat::test::TestAccount;

namespace {

constexpr int64_t kT0 = 7000000;  // CLOCK_BOOTTIME ms
constexpr int64_t kMin = 60 * 1000;
const std::string kIp = "192.168.1.20";
const std::string kBoot = "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0";

PasswordHash refWithSalt(const std::string& salt) {
    PasswordHash r;
    r.salt = salt;
    return r;
}

struct Gate {
    std::mutex mu;
    std::condition_variable cv;
    bool open = false;
    int entered = 0;
    void pass() {
        std::unique_lock<std::mutex> l(mu);
        ++entered;
        cv.notify_all();
        cv.wait(l, [&] { return open; });
    }
    bool waitEntered(int n) {
        std::unique_lock<std::mutex> l(mu);
        return cv.wait_for(l, std::chrono::seconds(10), [&] { return entered >= n; });
    }
    void release() {
        {
            std::lock_guard<std::mutex> l(mu);
            open = true;
        }
        cv.notify_all();
    }
};

std::string eventText(const AuditEvent& e) {
    auto opt = [](const std::optional<std::string>& s) { return s ? *s : std::string("-"); };
    return std::string(auditActionName(e.action)) + " " + auditResultName(e.result) + " " +
           auditChannelName(e.channel) + " " + e.source + " user=" + opt(e.user) +
           " role=" + opt(e.role) + " target=" + opt(e.target) + " code=" + opt(e.code) +
           " detail=" + e.detail;
}

struct Fixture {
    TempDir dir;
    std::string usersFile = dir.file("users.json");
    std::atomic<int64_t> now{kT0};
    std::atomic<bool> auditFails{false};
    std::string bootId = kBoot;
    std::function<void()> beforeHash;  // runs on the hash thread before each hash
    std::function<void(const AuditEvent&)> onAudit;
    bool withAudit = true;
    PasswordHasher::HashFn realHash;  // set: Argon2id instead of fakeHash

    std::mutex mu;
    std::vector<AuditEvent> events;
    std::vector<std::string> logs;
    struct HashCall {
        std::string salt;
        Argon2Params params;
    };
    std::vector<HashCall> hashCalls;

    std::map<std::string, std::string> pw;    // account → its password (random, this run)
    std::map<std::string, std::string> salt;  // account → salt of its hash
    std::unique_ptr<AuthService> auth;

    ~Fixture() { auth.reset(); }

    AuthOptions options() {
        AuthOptions o;
        o.usersFile = usersFile;
        if (withAudit)
            o.audit = [this](const AuditEvent& e) {
                if (onAudit) onAudit(e);
                if (auditFails) throw AuditUnavailable("test: audit.db read-only");
                std::lock_guard<std::mutex> l(mu);
                events.push_back(e);
            };
        o.log = [this](const std::string& line) {
            std::lock_guard<std::mutex> l(mu);
            logs.push_back(line);
        };
        o.monoMs = [this] { return now.load(); };
        o.hash = [this](std::string_view password, const PasswordHash& ref) {
            {
                std::lock_guard<std::mutex> l(mu);
                hashCalls.push_back({ref.salt, ref.params});
            }
            if (beforeHash) beforeHash();
            return realHash ? realHash(password, ref) : mat::test::fakeHash(password, ref);
        };
        o.bootId = [this] { return bootId; };
        return o;
    }
    void start() { auth = std::make_unique<AuthService>(options()); }
    void advance(int64_t ms) { now += ms; }

    // An account whose hash fakeHash accepts for a fresh random password.
    TestAccount account(const std::string& name, const std::string& role, bool enabled = true,
                        int64_t rev = 1, int64_t unlockSeq = 0) {
        if (!pw.count(name)) {
            pw[name] = mat::test::randomPassword();
            salt[name] = randomBytes(kSaltBytes);
        }
        const std::string phc =
            mat::test::phcText(kArgon2Default.mKiB, kArgon2Default.t, kArgon2Default.p, salt[name],
                               mat::test::fakeHash(pw[name], refWithSalt(salt[name])));
        return {name, role, phc, enabled, rev, unlockSeq};
    }
    std::vector<TestAccount> standard() {
        return {account("admin", "administrator"), account("kysu1", "engineer"),
                account("xem1", "viewer"), account("tat1", "engineer", false)};
    }
    // Through a temporary file and rename, as the device commands write it.
    void writeUsers(const std::vector<TestAccount>& accounts, mode_t mode = 0640) {
        mat::test::writeFile(dir.file("users.tmp"), mat::test::usersText(accounts), mode);
        ::rename(dir.file("users.tmp").c_str(), usersFile.c_str());
    }

    LoginResult login(const std::string& user, std::string password, const std::string& ip = kIp,
                      int port = 50000) {
        return auth->login(user, password, ClientAddress{ip, port});
    }
    LoginResult loginAs(const std::string& user, const std::string& ip = kIp) {
        return login(user, pw.at(user), ip);
    }

    std::vector<AuditEvent> audit() {
        std::lock_guard<std::mutex> l(mu);
        return events;
    }
    std::vector<AuditEvent> audit(AuditAction a) {
        std::vector<AuditEvent> out;
        for (const auto& e : audit())
            if (e.action == a) out.push_back(e);
        return out;
    }
    size_t hashes() {
        std::lock_guard<std::mutex> l(mu);
        return hashCalls.size();
    }
    HashCall lastHash() {
        std::lock_guard<std::mutex> l(mu);
        return hashCalls.empty() ? HashCall{} : hashCalls.back();
    }
    // Everything this run has logged or audited, as text.
    std::string transcript() {
        std::lock_guard<std::mutex> l(mu);
        std::string s;
        for (const auto& e : events) s += eventText(e) + "\n";
        for (const auto& line : logs) s += line + "\n";
        return s;
    }
};

}  // namespace

// --- Sign-in

TEST(AuthLogin, RightPasswordGivesATokenAfterItsAuditRecord) {
    Fixture f;
    f.writeUsers(f.standard());
    f.start();
    size_t sessionsWhenAudited = 99;
    f.onAudit = [&](const AuditEvent& e) {
        if (e.action == AuditAction::AuthLogin && e.result == AuditResult::Ok)
            sessionsWhenAudited = f.auth->activeSessions();
    };
    std::string password = f.pw["kysu1"];
    const LoginResult r = f.auth->login("kysu1", password, {kIp, 50123});
    ASSERT_EQ(r.status, LoginStatus::Ok) << loginErrorCode(r.status);
    EXPECT_TRUE(password.empty()) << "wiped";
    EXPECT_TRUE(isTokenFormat(r.token)) << r.token;
    EXPECT_EQ(r.user, "kysu1");
    EXPECT_EQ(r.role, Role::Engineer);
    EXPECT_STREQ(loginErrorCode(r.status), "");
    EXPECT_EQ(sessionsWhenAudited, 0u) << "the record is committed before the session exists";
    EXPECT_EQ(f.auth->activeSessions(), 1u);
    const auto ok = f.audit(AuditAction::AuthLogin);
    ASSERT_EQ(ok.size(), 1u);
    EXPECT_EQ(ok[0].result, AuditResult::Ok);
    EXPECT_EQ(ok[0].channel, AuditChannel::Https);
    EXPECT_EQ(ok[0].source, kIp + ":50123");
    EXPECT_EQ(ok[0].user, std::optional<std::string>("kysu1"));
    EXPECT_EQ(ok[0].role, std::optional<std::string>("engineer"));
    EXPECT_EQ(f.hashes(), 1u);
    EXPECT_EQ(f.lastHash().salt, f.salt["kysu1"]);
    EXPECT_EQ(f.lastHash().params, kArgon2Default);
    EXPECT_EQ(kIdleTimeoutS, 1800);
    EXPECT_EQ(kMaxLifetimeS, 43200);
}

TEST(AuthLogin, WrongNameAndWrongPasswordLookTheSame) {
    Fixture f;
    f.writeUsers(f.standard());
    f.start();
    const LoginResult unknown = f.login("nobody", f.pw["kysu1"]);
    const Fixture::HashCall dummy = f.lastHash();
    const LoginResult wrong = f.login("kysu1", mat::test::randomPassword());
    const Fixture::HashCall real = f.lastHash();
    const LoginResult disabled = f.loginAs("tat1");  // the right password of a disabled account
    const Fixture::HashCall disabledHash = f.lastHash();
    const LoginResult unknown2 = f.login("nobody2", "x");
    for (const LoginResult* r : {&unknown, &wrong, &disabled, &unknown2}) {
        EXPECT_EQ(r->status, LoginStatus::Failed);
        EXPECT_STREQ(loginErrorCode(r->status), "AUTH_FAILED");
        EXPECT_TRUE(r->token.empty());
    }
    EXPECT_EQ(f.hashes(), 4u) << "one hash for each, whatever the case";
    EXPECT_EQ(real.salt, f.salt["kysu1"]);
    EXPECT_EQ(dummy.params, kArgon2Default) << "the dummy costs what a real hash costs";
    EXPECT_EQ(dummy.salt.size(), kSaltBytes);
    for (const auto& s : f.salt) EXPECT_NE(dummy.salt, s.second);
    EXPECT_EQ(f.lastHash().salt, dummy.salt) << "one fixed dummy salt";
    EXPECT_EQ(disabledHash.salt, dummy.salt) << "a disabled account gets the dummy too";
    EXPECT_EQ(disabledHash.params, kArgon2Default);
    const auto failed = f.audit(AuditAction::AuthLogin);
    ASSERT_EQ(failed.size(), 4u);
    for (const auto& e : failed) {
        EXPECT_EQ(e.result, AuditResult::Failed);
        EXPECT_EQ(e.code, std::optional<std::string>("AUTH_FAILED"));
    }
    EXPECT_EQ(failed[0].user, std::optional<std::string>("nobody"))
        << "a name an account could have";
    EXPECT_EQ(failed[2].user, std::optional<std::string>("tat1"));
}

TEST(AuthLogin, NoAccountAtAllStillHashes) {
    for (const bool emptyFile : {false, true}) {
        Fixture f;
        if (emptyFile) f.writeUsers({});
        f.start();
        EXPECT_TRUE(f.auth->setupRequired()) << emptyFile;
        EXPECT_EQ(f.login("admin", mat::test::randomPassword()).status, LoginStatus::Failed);
        EXPECT_EQ(f.hashes(), 1u);
        EXPECT_EQ(f.lastHash().params, kArgon2Default);
    }
}

TEST(AuthLogin, DamagedAccountUsesTheDummyAndIsLoggedWithoutItsHash) {
    Fixture f;
    std::vector<TestAccount> a = f.standard();
    const std::string badSalt(16, 'b');
    a[1].phc = mat::test::phcText(1048576, 2, 1, badSalt, std::string(32, 'h'));  // 1 GiB
    f.writeUsers(a);
    f.start();
    EXPECT_EQ(f.loginAs("kysu1").status, LoginStatus::Failed);
    EXPECT_EQ(f.hashes(), 1u);
    EXPECT_NE(f.lastHash().salt, badSalt);
    EXPECT_EQ(f.lastHash().params, kArgon2Default);
    EXPECT_EQ(f.loginAs("admin").status, LoginStatus::Ok) << "other accounts still work";
    const std::string t = f.transcript();
    EXPECT_NE(t.find("kysu1"), std::string::npos) << t;
    EXPECT_EQ(t.find(mat::test::b64(badSalt)), std::string::npos) << t;
    EXPECT_EQ(t.find(a[1].phc), std::string::npos) << t;
}

TEST(AuthLogin, ANameThatCannotBeAnAccountStaysOutOfAuditAndLog) {
    Fixture f;
    f.writeUsers(f.standard());
    f.start();
    const std::string typed = f.pw["admin"];  // the password, typed in the name field
    for (int i = 0; i < 5; ++i) {
        const LoginResult r = f.login(typed, f.pw["admin"], "10.0.0.66");
        EXPECT_EQ(r.status, LoginStatus::Failed) << i;
    }
    const LoginResult locked = f.loginAs("admin", "10.0.0.66");
    EXPECT_EQ(locked.status, LoginStatus::Locked) << "it still counts for the address";
    for (const auto& e : f.audit()) {
        if (e.action == AuditAction::AuthLogin || e.action == AuditAction::AuthLockout) {
            EXPECT_FALSE(e.user.has_value()) << eventText(e);
            ASSERT_FALSE(e.detail.empty()) << eventText(e);
            const nlohmann::json d = nlohmann::json::parse(e.detail, nullptr, false);
            EXPECT_TRUE(d.is_object() && d.value("userInvalid", false)) << e.detail;
        }
    }
    EXPECT_EQ(f.audit(AuditAction::AuthLockout).size(), 1u);
    EXPECT_EQ(f.transcript().find(typed), std::string::npos);
    std::string err;
    ASSERT_TRUE(f.auth->saveState(f.dir.file("state.json"), err)) << err;
    EXPECT_EQ(mat::test::readFile(f.dir.file("state.json")).find(typed), std::string::npos)
        << "nor in auth-state.json";
}

TEST(AuthLogin, OverlongInputsFailAtOnce) {
    Fixture f;
    f.writeUsers(f.standard());
    f.start();
    std::string password(kPasswordMaxBytes + 1, 'p');
    EXPECT_EQ(f.auth->login("kysu1", password, {kIp, 1}).status, LoginStatus::Failed);
    EXPECT_TRUE(password.empty()) << "wiped as well";
    std::string ok = f.pw["kysu1"];
    EXPECT_EQ(f.auth->login(std::string(kLoginMaxUserBytes + 1, 'a'), ok, {kIp, 1}).status,
              LoginStatus::Failed);
    EXPECT_EQ(f.hashes(), 0u);
    EXPECT_TRUE(f.audit().empty());
}

// --- Lockout

TEST(AuthLockout, FiveFailuresLockEvenTheRightPassword) {
    Fixture f;
    f.writeUsers(f.standard());
    f.start();
    for (int i = 1; i <= 5; ++i)
        EXPECT_EQ(f.login("kysu1", "wrong-" + std::to_string(i)).status, LoginStatus::Failed);
    const auto lockouts = f.audit(AuditAction::AuthLockout);
    ASSERT_EQ(lockouts.size(), 1u);
    EXPECT_EQ(lockouts[0].user, std::optional<std::string>("kysu1"));
    EXPECT_EQ(lockouts[0].code, std::optional<std::string>("AUTH_LOCKED"));
    const size_t hashesBefore = f.hashes();
    const LoginResult r = f.loginAs("kysu1");
    EXPECT_EQ(r.status, LoginStatus::Locked);
    EXPECT_STREQ(loginErrorCode(r.status), "AUTH_LOCKED");
    EXPECT_EQ(r.retryAfterS, 300);
    EXPECT_TRUE(r.token.empty());
    EXPECT_EQ(f.hashes(), hashesBefore) << "no password check while locked";
    const auto locked = f.audit(AuditAction::AuthLocked);
    ASSERT_EQ(locked.size(), 1u);
    EXPECT_EQ(locked[0].result, AuditResult::Denied);
    EXPECT_EQ(locked[0].code, std::optional<std::string>("AUTH_LOCKED"));
    EXPECT_EQ(locked[0].user, std::optional<std::string>("kysu1"));
    f.advance(299 * 1000);
    EXPECT_EQ(f.loginAs("kysu1").retryAfterS, 1);
    f.advance(1000);
    EXPECT_EQ(f.loginAs("kysu1").status, LoginStatus::Ok);
}

TEST(AuthLockout, PerAccountFromManyAddresses) {
    Fixture f;
    f.writeUsers(f.standard());
    f.start();
    for (int i = 1; i <= 5; ++i) f.login("kysu1", "wrong", "10.0.0." + std::to_string(i));
    EXPECT_EQ(f.loginAs("kysu1", "10.0.0.99").status, LoginStatus::Locked);
    EXPECT_EQ(f.loginAs("admin", "10.0.0.1").status, LoginStatus::Ok) << "addresses not locked";
}

TEST(AuthLockout, PerAddressWithManyNames) {
    Fixture f;
    f.writeUsers(f.standard());
    f.start();
    for (int i = 1; i <= 5; ++i) f.login("name" + std::to_string(i), "wrong", "10.0.0.7");
    EXPECT_EQ(f.loginAs("kysu1", "10.0.0.7").status, LoginStatus::Locked);
    EXPECT_EQ(f.loginAs("kysu1", "10.0.0.8").status, LoginStatus::Ok);
}

TEST(AuthLockout, ARightPasswordClearsTheCount) {
    Fixture f;
    f.writeUsers(f.standard());
    f.start();
    for (int i = 0; i < 4; ++i) f.login("kysu1", "wrong");
    ASSERT_EQ(f.loginAs("kysu1").status, LoginStatus::Ok);
    for (int i = 0; i < 4; ++i) EXPECT_EQ(f.login("kysu1", "wrong").status, LoginStatus::Failed);
    EXPECT_EQ(f.loginAs("kysu1").status, LoginStatus::Ok);
}

TEST(AuthLockout, UnlockSeqChangeLiftsIt) {
    Fixture f;
    f.writeUsers(f.standard());
    f.start();
    for (int i = 1; i <= 5; ++i) f.login("kysu1", "wrong", "10.0.0." + std::to_string(i));
    ASSERT_EQ(f.loginAs("kysu1", "10.0.0.9").status, LoginStatus::Locked);
    std::vector<TestAccount> a = f.standard();
    a[1].unlockSeq = 1;  // --user-unlock kysu1
    f.writeUsers(a);
    f.advance(kUsersRecheckMs);
    EXPECT_EQ(f.loginAs("kysu1", "10.0.0.9").status, LoginStatus::Ok);
}

// --- Hash queue

TEST(AuthLogin, HashQueueRefusesWhenFourWait) {
    Fixture f;
    std::vector<TestAccount> a;
    for (int i = 1; i <= 6; ++i) a.push_back(f.account("user" + std::to_string(i), "engineer"));
    f.writeUsers(a);
    Gate gate;
    f.beforeHash = [&] { gate.pass(); };
    f.start();
    std::vector<LoginResult> results(5);
    std::vector<std::thread> threads;
    struct Cleanup {
        Gate& gate;
        std::vector<std::thread>& threads;
        ~Cleanup() {
            gate.release();
            for (auto& t : threads)
                if (t.joinable()) t.join();
        }
    } cleanup{gate, threads};
    auto signIn = [&](int i) {
        results[i] = f.loginAs("user" + std::to_string(i + 1), "10.0.0." + std::to_string(i + 1));
    };
    threads.emplace_back(signIn, 0);
    ASSERT_TRUE(gate.waitEntered(1));
    for (int i = 1; i <= 4; ++i) threads.emplace_back(signIn, i);
    const auto until = std::chrono::steady_clock::now() + std::chrono::seconds(10);
    while (f.auth->hashesWaiting() < 4 && std::chrono::steady_clock::now() < until)
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    ASSERT_EQ(f.auth->hashesWaiting(), 4u);
    const size_t auditBefore = f.audit().size();
    const LoginResult busy = f.loginAs("user6", "10.0.0.6");
    EXPECT_EQ(busy.status, LoginStatus::Busy);
    EXPECT_STREQ(loginErrorCode(busy.status), "AUTH_BUSY");
    EXPECT_EQ(f.hashes(), 1u) << "only the first one is hashing";
    EXPECT_EQ(f.audit().size(), auditBefore) << "a refusal for load is not a sign-in";
    gate.release();
    for (auto& t : threads) t.join();
    for (int i = 0; i < 5; ++i) EXPECT_EQ(results[i].status, LoginStatus::Ok) << i;
    EXPECT_EQ(f.hashes(), 5u);
    EXPECT_EQ(f.loginAs("user6", "10.0.0.6").status, LoginStatus::Ok) << "room again";
}

TEST(AuthLogin, AHashFailureIsAnErrorAndLogged) {
    Fixture f;
    f.writeUsers(f.standard());
    f.realHash = [](std::string_view, const PasswordHash&) -> std::string {
        throw std::runtime_error("argon2id: Memory allocation error");
    };
    f.start();
    const LoginResult r = f.loginAs("kysu1");
    EXPECT_EQ(r.status, LoginStatus::Error);
    EXPECT_STREQ(loginErrorCode(r.status), "INTERNAL_ERROR");
    EXPECT_TRUE(r.token.empty());
    EXPECT_NE(f.transcript().find("Memory allocation error"), std::string::npos);
}

// --- Audit first

TEST(AuthAudit, NoRecordNoToken) {
    Fixture f;
    f.writeUsers(f.standard());
    f.start();
    f.auditFails = true;
    const LoginResult r = f.loginAs("kysu1");
    EXPECT_EQ(r.status, LoginStatus::AuditUnavailable);
    EXPECT_STREQ(loginErrorCode(r.status), "AUDIT_UNAVAILABLE");
    EXPECT_TRUE(r.token.empty());
    EXPECT_EQ(f.auth->activeSessions(), 0u);
    EXPECT_EQ(f.login("kysu1", "wrong").status, LoginStatus::AuditUnavailable);
    f.auditFails = false;
    EXPECT_EQ(f.loginAs("kysu1").status, LoginStatus::Ok);
}

TEST(AuthAudit, FailuresCountEvenWhenTheAuditFails) {
    Fixture f;
    f.writeUsers(f.standard());
    f.start();
    f.auditFails = true;
    for (int i = 0; i < 5; ++i)
        EXPECT_EQ(f.login("kysu1", "wrong").status, LoginStatus::AuditUnavailable);
    EXPECT_EQ(f.loginAs("kysu1").status, LoginStatus::AuditUnavailable)
        << "locked, but auth.locked cannot be written either";
    f.auditFails = false;
    EXPECT_EQ(f.loginAs("kysu1").status, LoginStatus::Locked);
}

TEST(AuthAudit, WithoutAnAuditLogNobodySignsIn) {
    Fixture f;
    f.withAudit = false;
    f.writeUsers(f.standard());
    f.start();
    EXPECT_EQ(f.loginAs("admin").status, LoginStatus::AuditUnavailable);
    EXPECT_EQ(f.auth->activeSessions(), 0u);
}

// --- Secrets (SC-005)

TEST(AuthSecrets, PasswordsAndTokensAppearNowhere) {
    Fixture f;
    std::vector<TestAccount> a = f.standard();
    a.push_back(f.account("hong1", "viewer"));
    a.back().phc = mat::test::phcText(19456, 99, 1, std::string(16, 'q'), std::string(32, 'r'));
    f.writeUsers(a);
    mat::test::StderrToFile err(f.dir.file("stderr.txt"));
    f.start();
    std::vector<std::string> secrets;
    for (const auto& p : f.pw) secrets.push_back(p.second);

    const LoginResult ok = f.loginAs("kysu1");
    ASSERT_EQ(ok.status, LoginStatus::Ok);
    secrets.push_back(ok.token);
    const std::string wrong = mat::test::randomPassword();
    secrets.push_back(wrong);
    f.login("kysu1", wrong);
    f.login(f.pw["xem1"], f.pw["xem1"]);  // the password in the name field
    f.loginAs("hong1");                   // damaged account
    f.loginAs("tat1");                    // disabled account
    f.login("ghost", f.pw["admin"]);
    for (int i = 0; i < 6; ++i) f.login("admin", wrong, "10.0.0.50");   // lockout, then locked
    f.auth->authorize(ok.token, {"10.0.0.51", 1}, Role::Viewer, true);  // another address
    f.auth->logout(ok.token, {kIp, 2});
    std::string saveErr;
    ASSERT_TRUE(f.auth->saveState(f.dir.file("state.json"), saveErr)) << saveErr;

    const std::string all =
        f.transcript() + err.text() + mat::test::readFile(f.dir.file("state.json"));
    ASSERT_FALSE(f.audit().empty());
    for (const auto& s : secrets) EXPECT_EQ(all.find(s), std::string::npos) << "found a secret";
}

TEST(AuthSecrets, RealArgon2AndRealAuditLog) {
    TempDir data;
    AuditOptions ao;
    ao.dataDir = data.path();
    AuditLog log(ao);
    std::string err;
    ASSERT_TRUE(log.open(err)) << err;

    Fixture f;
    f.realHash = [](std::string_view password, const PasswordHash& ref) {
        return argon2idHash(password, ref.salt, ref.params);
    };
    f.onAudit = [&](const AuditEvent& e) { log.append(e); };
    const std::string pwK = mat::test::randomPassword(), pwA = mat::test::randomPassword();
    // Small parameters inside the bounds: still the real Argon2id through mmap.
    f.writeUsers({{"admin", "administrator", hashPassword(pwA, {8192, 1, 1})},
                  {"kysu1", "engineer", hashPassword(pwK, {8192, 1, 1})}});
    f.start();
    const LoginResult ok = f.login("kysu1", pwK);
    ASSERT_EQ(ok.status, LoginStatus::Ok);
    EXPECT_EQ(f.lastHash().params, (Argon2Params{8192, 1, 1}));
    EXPECT_EQ(f.login("kysu1", pwA).status, LoginStatus::Failed);
    EXPECT_EQ(f.login(pwA, pwA).status, LoginStatus::Failed);
    EXPECT_EQ(f.login("nobody", pwK).status, LoginStatus::Failed);
    const AuditPage page = log.query({});
    bool sawOk = false;
    for (const auto& r : page.records)
        sawOk = sawOk || (r.action == "auth.login" && r.result == "ok" && r.user == "kysu1");
    EXPECT_TRUE(sawOk);
    log.close();
    std::string bytes;
    for (const auto& name : data.names()) bytes += mat::test::readFile(data.file(name));
    ASSERT_FALSE(bytes.empty());
    for (const auto& s : {pwK, pwA, ok.token})
        EXPECT_EQ(bytes.find(s), std::string::npos) << "found a secret in audit.db*";
    EXPECT_EQ(f.transcript().find(pwK), std::string::npos);
}

// --- Sessions and roles

TEST(AuthAccess, AddressAccountAndRole) {
    Fixture f;
    f.writeUsers(f.standard());
    f.start();
    const LoginResult r = f.loginAs("kysu1");
    ASSERT_EQ(r.status, LoginStatus::Ok);
    Access a = f.auth->authorize(r.token, {kIp, 2}, Role::Engineer, true);
    EXPECT_EQ(a.status, AccessStatus::Ok);
    EXPECT_EQ(a.user, "kysu1");
    EXPECT_EQ(a.role, std::optional<Role>(Role::Engineer));
    EXPECT_STREQ(accessErrorCode(a.status), "");
    a = f.auth->authorize(r.token, {"192.168.1.21", 2}, Role::Viewer, false);
    EXPECT_EQ(a.status, AccessStatus::SessionInvalid);
    EXPECT_STREQ(accessErrorCode(a.status), "SESSION_INVALID");
    EXPECT_EQ(a.user, "kysu1");
    a = f.auth->authorize(r.token, {kIp, 3}, Role::Administrator, true);
    EXPECT_EQ(a.status, AccessStatus::Forbidden);
    EXPECT_STREQ(accessErrorCode(a.status), "FORBIDDEN");
    EXPECT_EQ(a.role, std::optional<Role>(Role::Engineer));
    a = f.auth->authorize("mats_garbage", {kIp, 4}, Role::Viewer, false);
    EXPECT_EQ(a.status, AccessStatus::SessionExpired);
    EXPECT_STREQ(accessErrorCode(a.status), "SESSION_EXPIRED");
    EXPECT_EQ(f.auth->authorize(r.token, {kIp, 5}, Role::Viewer, false).status, AccessStatus::Ok)
        << "the owner still has it";
}

TEST(AuthAccess, IdleTimeRestartsOnlyOnGrantedRequestsAPersonMakes) {
    Fixture f;
    f.writeUsers(f.standard());
    f.start();
    const std::string polled = f.loginAs("kysu1").token;
    const std::string used = f.loginAs("kysu1").token;
    const std::string viewer = f.loginAs("xem1").token;
    f.advance(20 * kMin);
    const Access poll = f.auth->authorize(polled, {kIp, 1}, Role::Viewer, false);
    ASSERT_EQ(poll.status, AccessStatus::Ok);
    EXPECT_EQ(poll.idleRemainingS, 600);
    EXPECT_EQ(poll.lifetimeRemainingS, 43200 - 1200);
    EXPECT_EQ(f.auth->authorize(used, {kIp, 1}, Role::Engineer, true).status, AccessStatus::Ok);
    EXPECT_EQ(f.auth->authorize(viewer, {kIp, 1}, Role::Engineer, true).status,
              AccessStatus::Forbidden);
    f.advance(20 * kMin);
    EXPECT_EQ(f.auth->authorize(polled, {kIp, 1}, Role::Viewer, false).status,
              AccessStatus::SessionExpired);
    EXPECT_EQ(f.auth->authorize(used, {kIp, 1}, Role::Viewer, false).status, AccessStatus::Ok);
    EXPECT_EQ(f.auth->authorize(viewer, {kIp, 1}, Role::Viewer, false).status,
              AccessStatus::SessionExpired)
        << "a refused request does not keep the session alive";
}

TEST(AuthAccess, AccountChangesEndSessions) {
    Fixture f;
    f.writeUsers(f.standard());
    f.start();
    const std::string k = f.loginAs("kysu1").token, x = f.loginAs("xem1").token;
    std::vector<TestAccount> a = f.standard();
    a[1].rev = 2;  // --user-passwd kysu1
    f.writeUsers(a);
    f.advance(kUsersRecheckMs);
    EXPECT_EQ(f.auth->authorize(k, {kIp, 1}, Role::Viewer, false).status,
              AccessStatus::SessionExpired)
        << "ended when the change was seen";
    EXPECT_EQ(f.auth->authorize(x, {kIp, 1}, Role::Viewer, false).status, AccessStatus::Ok);
    const auto revoked = f.audit(AuditAction::AuthSessionRevoked);
    ASSERT_EQ(revoked.size(), 1u);
    EXPECT_EQ(revoked[0].user, std::optional<std::string>("kysu1"));
    EXPECT_EQ(revoked[0].channel, AuditChannel::System);
    a[2].enabled = false;  // xem1 disabled by a hand edit, rev unchanged
    f.writeUsers(a);
    f.advance(kUsersRecheckMs);
    EXPECT_EQ(f.auth->authorize(x, {kIp, 1}, Role::Viewer, false).status,
              AccessStatus::SessionInvalid);
}

TEST(AuthAccess, RoleIsReadAtEveryRequest) {
    Fixture f;
    f.writeUsers(f.standard());
    f.start();
    const std::string k = f.loginAs("kysu1").token;
    std::vector<TestAccount> a = f.standard();
    a[1].role = "viewer";  // a hand edit that keeps rev
    f.writeUsers(a);
    f.advance(kUsersRecheckMs);
    const Access r = f.auth->authorize(k, {kIp, 1}, Role::Engineer, true);
    EXPECT_EQ(r.status, AccessStatus::Forbidden);
    EXPECT_EQ(r.role, std::optional<Role>(Role::Viewer));
}

TEST(AuthAccess, Logout) {
    Fixture f;
    f.writeUsers(f.standard());
    f.start();
    const std::string t = f.loginAs("kysu1").token;
    EXPECT_EQ(f.auth->logout(t, {"10.9.9.9", 1}), AccessStatus::SessionInvalid);
    EXPECT_EQ(f.auth->authorize(t, {kIp, 1}, Role::Viewer, false).status, AccessStatus::Ok);
    EXPECT_EQ(f.auth->logout(t, {kIp, 1}), AccessStatus::Ok);
    const auto out = f.audit(AuditAction::AuthLogout);
    ASSERT_EQ(out.size(), 1u);
    EXPECT_EQ(out[0].user, std::optional<std::string>("kysu1"));
    EXPECT_EQ(out[0].role, std::optional<std::string>("engineer"));
    EXPECT_EQ(out[0].result, AuditResult::Ok);
    EXPECT_EQ(f.auth->authorize(t, {kIp, 1}, Role::Viewer, false).status,
              AccessStatus::SessionExpired);
    EXPECT_EQ(f.auth->logout(t, {kIp, 1}), AccessStatus::SessionExpired);
    // Signing out works even when the audit cannot be written; that is logged.
    const std::string u = f.loginAs("kysu1").token;
    f.auditFails = true;
    EXPECT_EQ(f.auth->logout(u, {kIp, 1}), AccessStatus::Ok);
    EXPECT_EQ(f.auth->authorize(u, {kIp, 1}, Role::Viewer, false).status,
              AccessStatus::SessionExpired);
    EXPECT_EQ(f.audit(AuditAction::AuthLogout).size(), 1u);
    bool logged = false;
    for (const auto& l : f.logs) logged = logged || l.find("auth.logout") != std::string::npos;
    EXPECT_TRUE(logged) << f.transcript();
}

TEST(AuthAccounts, SetupRequiredAndStatus) {
    Fixture f;
    f.start();
    EXPECT_TRUE(f.auth->setupRequired());
    EXPECT_EQ(f.auth->accountsStatus(), UsersStatus::Missing);
    f.writeUsers({});
    f.advance(kUsersRecheckMs);
    EXPECT_TRUE(f.auth->setupRequired());
    EXPECT_EQ(f.auth->accountsStatus(), UsersStatus::Ok);
    f.writeUsers(f.standard());
    f.advance(kUsersRecheckMs);
    EXPECT_FALSE(f.auth->setupRequired());
    f.writeUsers(f.standard(), 0644);
    f.advance(kUsersRecheckMs);
    EXPECT_EQ(f.auth->accountsStatus(), UsersStatus::Error);
    EXPECT_FALSE(f.auth->setupRequired()) << "accounts exist; the file needs fixing";
    EXPECT_EQ(f.loginAs("admin").status, LoginStatus::Failed) << "no account while unusable";
}

TEST(AuthAccounts, OldParametersAreLoggedOnce) {
    Fixture f;
    std::vector<TestAccount> a = f.standard();
    const std::string s(16, 'o');
    a[1].phc =
        mat::test::phcText(8192, 1, 1, s, mat::test::fakeHash(f.pw["kysu1"], refWithSalt(s)));
    f.writeUsers(a);
    f.start();
    ASSERT_EQ(f.loginAs("kysu1").status, LoginStatus::Ok);
    ASSERT_EQ(f.loginAs("kysu1").status, LoginStatus::Ok);
    size_t lines = 0;
    for (const auto& l : f.logs) lines += l.find("kysu1") != std::string::npos ? 1 : 0;
    EXPECT_EQ(lines, 1u) << f.transcript();
}

// --- Across execv

TEST(AuthExecv, SessionsAndCountersSurviveExecv) {
    Fixture f;
    f.writeUsers(f.standard());
    f.start();
    const std::string t = f.loginAs("kysu1").token;
    for (int i = 0; i < 3; ++i) f.login("admin", "wrong", "10.0.0.30");
    const std::string path = f.dir.file("auth-state.json");
    std::string err;
    ASSERT_TRUE(f.auth->saveState(path, err)) << err;
    EXPECT_EQ(mat::test::fileMode(path), 0600u);
    const std::string text = mat::test::readFile(path);
    EXPECT_EQ(text.find(t), std::string::npos);
    EXPECT_NE(text.find(toHex(sha256(t))), std::string::npos);

    f.start();  // the new process image
    f.auth->loadState(path);
    EXPECT_FALSE(mat::test::fileExists(path));
    EXPECT_EQ(f.auth->authorize(t, {kIp, 1}, Role::Engineer, false).status, AccessStatus::Ok);
    f.login("admin", "wrong", "10.0.0.30");
    f.login("admin", "wrong", "10.0.0.30");  // 3 + 2
    EXPECT_EQ(f.loginAs("admin", "10.0.0.30").status, LoginStatus::Locked);

    ASSERT_TRUE(f.auth->saveState(path, err)) << err;
    f.bootId = "ffffffff-0000-1111-2222-333333333333";  // the device was restarted instead
    f.start();
    f.auth->loadState(path);
    EXPECT_EQ(f.auth->authorize(t, {kIp, 1}, Role::Viewer, false).status,
              AccessStatus::SessionExpired);
    EXPECT_EQ(f.loginAs("admin", "10.0.0.30").status, LoginStatus::Ok);
}

// --- Small things

TEST(AuthService, ClientAddressAndCodes) {
    EXPECT_EQ((ClientAddress{"192.168.1.20", 50123}.text()), "192.168.1.20:50123");
    EXPECT_EQ((ClientAddress{"fe80::1", 8443}.text()), "[fe80::1]:8443");
    EXPECT_STREQ(loginErrorCode(LoginStatus::Ok), "");
    EXPECT_STREQ(loginErrorCode(LoginStatus::Failed), "AUTH_FAILED");
    EXPECT_STREQ(loginErrorCode(LoginStatus::Locked), "AUTH_LOCKED");
    EXPECT_STREQ(loginErrorCode(LoginStatus::Busy), "AUTH_BUSY");
    EXPECT_STREQ(loginErrorCode(LoginStatus::AuditUnavailable), "AUDIT_UNAVAILABLE");
    EXPECT_STREQ(loginErrorCode(LoginStatus::Error), "INTERNAL_ERROR");
    EXPECT_STREQ(accessErrorCode(AccessStatus::Ok), "");
    EXPECT_STREQ(accessErrorCode(AccessStatus::SessionExpired), "SESSION_EXPIRED");
    EXPECT_STREQ(accessErrorCode(AccessStatus::SessionInvalid), "SESSION_INVALID");
    EXPECT_STREQ(accessErrorCode(AccessStatus::Forbidden), "FORBIDDEN");
}
