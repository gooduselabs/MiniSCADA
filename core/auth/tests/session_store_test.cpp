// T028 (feature 005; data-model §5, research R9, FR-012): sessions on a fake CLOCK_BOOTTIME.
// - Token "mats_" + 43 base64url characters of 32 random bytes; only its SHA-256 is kept.
// - Expiry: idle > 30 min or age > 12 h; only requests a person makes restart the idle time.
// - Bound to the address of the sign-in; a changed rev or a disabled account invalidates.
// - At most 32 sessions, the least recently used goes; sign-out; all sessions of one account.
// - auth-state.json across execv: 0600, token hashes and the two lockout tables only, from the
//   same boot only; a broken or foreign file gives an empty state; read once, then deleted.
#include "core/auth/session_store.hpp"

#include <gtest/gtest.h>
#include <sys/stat.h>
#include <unistd.h>

#include <functional>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "core/auth/auth_state.hpp"
#include "core/auth/tests/auth_test_support.hpp"
#include "core/crypto/base64url.hpp"
#include "core/crypto/hex.hpp"
#include "core/crypto/sha256.hpp"
#include "nlohmann/json.hpp"

using namespace mat;
using mat::test::TempDir;

namespace {

constexpr int64_t kMin = 60 * 1000;
constexpr int64_t kT0 = 5000000;  // CLOCK_BOOTTIME ms of the first sign-in
const std::string kIp = "192.168.1.20";
const std::string kBoot = "6f2d6c4e-5b8a-4c1e-9d3f-0a1b2c3d4e5f";

// Every account at rev 1 and enabled, unless a test says otherwise.
SessionStore::RevOf revs(std::optional<int64_t> rev = 1) {
    return [rev](const std::string&) { return rev; };
}

void expectSameSessions(const std::vector<Session>& a, const std::vector<Session>& b) {
    ASSERT_EQ(a.size(), b.size());
    for (size_t i = 0; i < a.size(); ++i) {
        EXPECT_EQ(a[i].tokenHash, b[i].tokenHash) << i;
        EXPECT_EQ(a[i].user, b[i].user) << i;
        EXPECT_EQ(a[i].rev, b[i].rev) << i;
        EXPECT_EQ(a[i].source, b[i].source) << i;
        EXPECT_EQ(a[i].createdMono, b[i].createdMono) << i;
        EXPECT_EQ(a[i].lastMono, b[i].lastMono) << i;
    }
}

void expectSameEntries(const std::vector<GuardEntry>& a, const std::vector<GuardEntry>& b) {
    ASSERT_EQ(a.size(), b.size());
    for (size_t i = 0; i < a.size(); ++i) {
        EXPECT_EQ(a[i].key, b[i].key) << i;
        EXPECT_EQ(a[i].failures, b[i].failures) << i;
        EXPECT_EQ(a[i].lockedUntilMono, b[i].lockedUntilMono) << i;
        EXPECT_EQ(a[i].generation.has_value(), b[i].generation.has_value()) << i;
        if (a[i].generation && b[i].generation) {
            EXPECT_EQ(*a[i].generation, *b[i].generation) << i;
        }
    }
}

AuthState sampleState(std::string* token = nullptr) {
    SessionStore s;
    const std::string t1 = s.create("kysu1", 3, kIp, kT0);
    s.create("admin", 1, "10.0.0.7", kT0 + 1000);
    if (token) *token = t1;
    AuthState st;
    st.bootId = kBoot;
    st.sessions = s.sessions();
    st.guard.byUser = {{"kysu1", 2, 0, AccountGeneration{3, 0}},
                       {"ghost", 0, kT0 + 2000, std::nullopt}};
    st.guard.bySource = {{"10.0.0.9", 4, 0, std::nullopt}};
    return st;
}

}  // namespace

// --- Tokens

TEST(SessionToken, PrefixThen43Base64urlCharactersOf32Bytes) {
    std::set<std::string> seen;
    for (int i = 0; i < 20; ++i) {
        const std::string t = newSessionToken();
        ASSERT_EQ(t.size(), kTokenLength) << t;
        EXPECT_EQ(t.rfind("mats_", 0), 0u) << t;
        const auto raw = base64urlDecode(t.substr(5));
        ASSERT_TRUE(raw.has_value()) << t;
        EXPECT_EQ(raw->size(), 32u);
        EXPECT_TRUE(isTokenFormat(t)) << t;
        seen.insert(t);
    }
    EXPECT_EQ(seen.size(), 20u);
}

TEST(SessionToken, ShapeCheck) {
    const std::string good = "mats_" + base64urlEncode(std::string(32, '\x7f'));
    ASSERT_EQ(good.size(), kTokenLength);
    EXPECT_TRUE(isTokenFormat(good));
    std::string canonicalBreak = good;  // 32 bytes: the last character keeps 2 unused bits
    canonicalBreak.back() = 'B';
    for (const std::string& bad :
         {std::string(""), std::string("mats_"), good.substr(5), "MATS_" + good.substr(5),
          good.substr(0, kTokenLength - 1), good + "A", good + "=", "mats_" + std::string(43, '+'),
          "mats_" + std::string(43, '/'), canonicalBreak, "Bearer " + good})
        EXPECT_FALSE(isTokenFormat(bad)) << bad;
}

TEST(SessionStore, KeepsOnlyTheHashOfTheToken) {
    SessionStore s;
    const std::string token = s.create("kysu1", 1, kIp, kT0);
    ASSERT_TRUE(isTokenFormat(token)) << token;
    const auto all = s.sessions();
    ASSERT_EQ(all.size(), 1u);
    EXPECT_EQ(all[0].tokenHash, sha256(token));
    EXPECT_EQ(all[0].user, "kysu1");
    EXPECT_EQ(all[0].rev, 1);
    EXPECT_EQ(all[0].source, kIp);
    EXPECT_EQ(all[0].createdMono, kT0);
    EXPECT_EQ(all[0].lastMono, kT0);
}

TEST(SessionStore, InjectedTokensForTests) {
    int n = 0;
    SessionStore s(
        [&] { return "mats_" + base64urlEncode(std::string(31, 'a') + char('0' + n++)); });
    const std::string a = s.create("kysu1", 1, kIp, kT0), b = s.create("kysu1", 1, kIp, kT0);
    EXPECT_NE(a, b);
    EXPECT_EQ(s.check(a, kIp, kT0, revs()).status, SessionStatus::Ok);
    EXPECT_EQ(s.check(b, kIp, kT0, revs()).status, SessionStatus::Ok);
}

// --- Expiry

TEST(SessionStore, IdleLimitIsThirtyMinutes) {
    SessionStore s;
    const std::string t = s.create("kysu1", 1, kIp, kT0);
    const SessionCheck c = s.check(t, kIp, kT0 + 30 * kMin, revs());
    EXPECT_EQ(c.status, SessionStatus::Ok) << "exactly 30 min: still valid";
    EXPECT_EQ(c.user, "kysu1");
    EXPECT_EQ(s.check(t, kIp, kT0 + 30 * kMin + 1, revs()).status, SessionStatus::Expired);
    EXPECT_EQ(s.check(t, kIp, kT0, revs()).status, SessionStatus::Expired) << "removed";
    EXPECT_TRUE(s.sessions().empty());
}

TEST(SessionStore, OnlyTouchRestartsTheIdleTime) {
    SessionStore s;
    const std::string t = s.create("kysu1", 1, kIp, kT0);
    ASSERT_EQ(s.check(t, kIp, kT0 + 20 * kMin, revs()).status, SessionStatus::Ok);  // a poll
    EXPECT_EQ(s.check(t, kIp, kT0 + 31 * kMin, revs()).status, SessionStatus::Expired);

    const std::string u = s.create("kysu1", 1, kIp, kT0);
    ASSERT_EQ(s.check(u, kIp, kT0 + 20 * kMin, revs()).status, SessionStatus::Ok);
    EXPECT_TRUE(s.touch(u, kT0 + 20 * kMin));  // a person's request
    EXPECT_EQ(s.check(u, kIp, kT0 + 49 * kMin, revs()).status, SessionStatus::Ok);
    EXPECT_FALSE(s.touch("mats_unknown", kT0));
}

TEST(SessionStore, LifetimeIsTwelveHoursWhateverTheUse) {
    SessionStore s;
    const std::string t = s.create("kysu1", 1, kIp, kT0);
    for (int64_t at = kT0 + 29 * kMin; at <= kT0 + kSessionMaxMs; at += 29 * kMin) {
        ASSERT_EQ(s.check(t, kIp, at, revs()).status, SessionStatus::Ok) << (at - kT0) / kMin;
        s.touch(t, at);
    }
    EXPECT_EQ(s.check(t, kIp, kT0 + kSessionMaxMs, revs()).status, SessionStatus::Ok)
        << "exactly 12 h";
    EXPECT_EQ(s.check(t, kIp, kT0 + kSessionMaxMs + 1, revs()).status, SessionStatus::Expired);
}

TEST(SessionStore, RemainingTimes) {
    SessionStore s;
    const std::string t = s.create("kysu1", 1, kIp, kT0);
    const SessionCheck c = s.check(t, kIp, kT0 + 10 * 1000, revs());
    ASSERT_EQ(c.status, SessionStatus::Ok);
    EXPECT_EQ(c.idleRemainingS, 1790);
    EXPECT_EQ(c.lifetimeRemainingS, 43190);
    s.touch(t, kT0 + 10 * kMin);
    const SessionCheck d = s.check(t, kIp, kT0 + 10 * kMin, revs());
    EXPECT_EQ(d.idleRemainingS, 1800);
    EXPECT_EQ(d.lifetimeRemainingS, 43200 - 600);
}

// --- Address, account, rev

TEST(SessionStore, BoundToTheAddressOfTheSignIn) {
    SessionStore s;
    const std::string t = s.create("kysu1", 1, kIp, kT0);
    const SessionCheck other = s.check(t, "192.168.1.21", kT0 + 1000, revs());
    EXPECT_EQ(other.status, SessionStatus::Invalid);
    EXPECT_EQ(other.user, "kysu1");
    EXPECT_EQ(s.check(t, kIp, kT0 + 2000, revs()).status, SessionStatus::Ok)
        << "the owner keeps the session";
}

TEST(SessionStore, ChangedRevEndsTheSession) {
    SessionStore s;
    const std::string t = s.create("kysu1", 3, kIp, kT0);
    EXPECT_EQ(s.check(t, kIp, kT0, revs(3)).status, SessionStatus::Ok);
    EXPECT_EQ(s.check(t, kIp, kT0, revs(4)).status, SessionStatus::Invalid);
    EXPECT_EQ(s.check(t, kIp, kT0, revs(3)).status, SessionStatus::Expired) << "removed";
}

TEST(SessionStore, DisabledOrMissingAccountIsInvalid) {
    SessionStore s;
    const std::string t = s.create("kysu1", 3, kIp, kT0);
    EXPECT_EQ(s.check(t, kIp, kT0, revs(std::nullopt)).status, SessionStatus::Invalid);
    EXPECT_EQ(s.check(t, kIp, kT0, revs(3)).status, SessionStatus::Ok)
        << "enabled again with the same rev (a hand edit): valid again";
}

TEST(SessionStore, MalformedOrUnknownTokensAreExpired) {
    SessionStore s;
    s.create("kysu1", 1, kIp, kT0);
    for (const std::string& t :
         {std::string(""), std::string("garbage"), newSessionToken(), std::string(200, 'x')})
        EXPECT_EQ(s.check(t, kIp, kT0, revs()).status, SessionStatus::Expired) << t;
}

// --- Capacity, sign-out

TEST(SessionStore, AtMost32TheLeastRecentlyUsedGoes) {
    SessionStore s;
    std::vector<std::string> tokens;
    for (int i = 0; i < 32; ++i) tokens.push_back(s.create("kysu1", 1, kIp, kT0 + i));
    s.touch(tokens[0], kT0 + 100);  // the oldest is used again: tokens[1] is now the LRU
    EXPECT_EQ(s.activeCount(kT0 + 100), 32u);
    const std::string extra = s.create("admin", 1, kIp, kT0 + 200);
    EXPECT_EQ(s.sessions().size(), 32u);
    EXPECT_EQ(s.check(tokens[1], kIp, kT0 + 200, revs()).status, SessionStatus::Expired);
    EXPECT_EQ(s.check(tokens[0], kIp, kT0 + 200, revs()).status, SessionStatus::Ok);
    EXPECT_EQ(s.check(extra, kIp, kT0 + 200, revs()).status, SessionStatus::Ok);
}

TEST(SessionStore, ExpiredSessionsLeaveRoomFirst) {
    SessionStore s;
    std::vector<std::string> tokens;
    for (int i = 0; i < 32; ++i) tokens.push_back(s.create("kysu1", 1, kIp, kT0 + i * kMin));
    // At kT0 + 40 min the sessions made before kT0 + 10 min are idle for more than 30 min.
    const int64_t now = kT0 + 40 * kMin;
    EXPECT_EQ(s.activeCount(now), 22u);
    s.create("admin", 1, kIp, now);
    EXPECT_EQ(s.check(tokens[10], kIp, now, revs()).status, SessionStatus::Ok)
        << "an expired session made room, not the least recently used live one";
    EXPECT_EQ(s.check(tokens[31], kIp, now, revs()).status, SessionStatus::Ok);
}

TEST(SessionStore, SignOutAndAllSessionsOfAnAccount) {
    SessionStore s;
    const std::string a1 = s.create("aaa", 1, kIp, kT0), a2 = s.create("aaa", 1, "10.0.0.2", kT0);
    const std::string b = s.create("bbb", 1, kIp, kT0);
    EXPECT_TRUE(s.remove(a1));
    EXPECT_FALSE(s.remove(a1));
    EXPECT_EQ(s.check(a1, kIp, kT0, revs()).status, SessionStatus::Expired);
    s.create("aaa", 1, kIp, kT0);
    EXPECT_EQ(s.removeUser("aaa"), 2u);
    EXPECT_EQ(s.check(a2, "10.0.0.2", kT0, revs()).status, SessionStatus::Expired);
    EXPECT_EQ(s.check(b, kIp, kT0, revs()).status, SessionStatus::Ok);
    EXPECT_EQ(s.removeUser("aaa"), 0u);
    EXPECT_EQ(s.activeCount(kT0), 1u);
}

TEST(SessionStore, RestoreDropsExpiredAndDuplicates) {
    SessionStore a;
    const std::string live = a.create("kysu1", 1, kIp, kT0 + 40 * kMin);
    a.create("old", 1, kIp, kT0);  // idle for 40 min at the restore
    std::vector<Session> all = a.sessions();
    ASSERT_EQ(all.size(), 2u);
    all.push_back(all[0]);  // the same token twice
    SessionStore b;
    b.restore(all, kT0 + 40 * kMin);
    EXPECT_EQ(b.sessions().size(), 1u);
    EXPECT_EQ(b.check(live, kIp, kT0 + 40 * kMin, revs()).status, SessionStatus::Ok);
}

// --- auth-state.json

TEST(AuthState, RoundTripThenTheFileIsGone) {
    TempDir dir;
    const std::string f = dir.file("auth-state.json");
    std::string token;
    const AuthState st = sampleState(&token);
    std::string err;
    ASSERT_TRUE(writeAuthState(f, st, err)) << err;
    EXPECT_EQ(mat::test::fileMode(f), 0600u);
    EXPECT_EQ(dir.names(), std::vector<std::string>{"auth-state.json"});
    const std::string text = mat::test::readFile(f);
    EXPECT_EQ(text.find(token), std::string::npos) << "never the token";
    EXPECT_EQ(text.find(token.substr(5)), std::string::npos);
    EXPECT_NE(text.find(toHex(sha256(token))), std::string::npos) << "its hash, in hex";

    std::string why;
    const AuthState back = readAuthState(f, kBoot, kT0 + 5000, &why);
    EXPECT_FALSE(mat::test::fileExists(f)) << "read once, then deleted";
    EXPECT_EQ(back.bootId, kBoot);
    expectSameSessions(back.sessions, st.sessions);
    expectSameEntries(back.guard.byUser, st.guard.byUser);
    expectSameEntries(back.guard.bySource, st.guard.bySource);
    EXPECT_TRUE(why.empty()) << why;
}

TEST(AuthState, OnlyTheExpectedKeys) {
    const nlohmann::json j = nlohmann::json::parse(authStateJson(sampleState()), nullptr, false);
    ASSERT_TRUE(j.is_object());
    ASSERT_TRUE(j.contains("sessions") && j["sessions"].is_array() && !j["sessions"].empty());
    std::set<std::string> top;
    for (auto it = j.begin(); it != j.end(); ++it) top.insert(it.key());
    EXPECT_EQ(top, (std::set<std::string>{"schemaVersion", "bootId", "sessions", "lockouts"}));
    std::set<std::string> session;
    for (auto it = j["sessions"][0].begin(); it != j["sessions"][0].end(); ++it)
        session.insert(it.key());
    EXPECT_EQ(session, (std::set<std::string>{"tokenHash", "user", "rev", "source", "createdMono",
                                              "lastMono"}));
}

TEST(AuthState, AnythingElseGivesAnEmptyStateAndTheFileGoes) {
    TempDir dir;
    const std::string f = dir.file("auth-state.json");
    const std::string good = authStateJson(sampleState());
    ASSERT_FALSE(good.empty());
    auto edited = [&](const std::function<void(nlohmann::json&)>& change) {
        nlohmann::json j = nlohmann::json::parse(good);
        change(j);
        return j.dump();
    };
    struct Case {
        std::string name, text;
        mode_t mode;
        std::string boot;
        int64_t now;
    };
    const std::vector<Case> cases = {
        {"another boot", good, 0600, "11111111-2222-3333-4444-555555555555", kT0 + 5000},
        {"boot id unknown", good, 0600, "", kT0 + 5000},
        {"not JSON", "{\"bootId\":", 0600, kBoot, kT0 + 5000},
        {"group may read", good, 0640, kBoot, kT0 + 5000},
        {"others may read", good, 0604, kBoot, kT0 + 5000},
        {"stamped in the future", good, 0600, kBoot, kT0 - 1},
        {"short token hash", edited([](auto& j) { j["sessions"][0]["tokenHash"] = "abcd"; }), 0600,
         kBoot, kT0 + 5000},
        {"upper-case hash",
         edited([](auto& j) { j["sessions"][0]["tokenHash"] = std::string(64, 'A'); }), 0600, kBoot,
         kT0 + 5000},
        {"bad user", edited([](auto& j) { j["sessions"][0]["user"] = "Not A Name"; }), 0600, kBoot,
         kT0 + 5000},
        {"rev text", edited([](auto& j) { j["sessions"][0]["rev"] = "3"; }), 0600, kBoot,
         kT0 + 5000},
        {"created after last", edited([](auto& j) { j["sessions"][0]["createdMono"] = kT0 + 10; }),
         0600, kBoot, kT0 + 5000},
        {"failures out of range",
         edited([](auto& j) { j["lockouts"]["bySource"][0]["failures"] = 9; }), 0600, kBoot,
         kT0 + 5000},
        {"MAJOR 2", edited([](auto& j) { j["schemaVersion"] = "2.0.0"; }), 0600, kBoot, kT0 + 5000},
    };
    for (const auto& c : cases) {
        mat::test::writeFile(f, c.text, c.mode);
        std::string why;
        const AuthState st = readAuthState(f, c.boot, c.now, &why);
        EXPECT_TRUE(st.sessions.empty()) << c.name;
        EXPECT_TRUE(st.guard.byUser.empty()) << c.name;
        EXPECT_TRUE(st.guard.bySource.empty()) << c.name;
        EXPECT_FALSE(why.empty()) << c.name;
        EXPECT_FALSE(mat::test::fileExists(f)) << c.name << ": deleted all the same";
    }
    std::string why;
    EXPECT_TRUE(readAuthState(f, kBoot, kT0, &why).sessions.empty()) << "missing file";
    ASSERT_EQ(::symlink("/etc/hostname", f.c_str()), 0);
    EXPECT_TRUE(readAuthState(f, kBoot, kT0 + 5000, &why).sessions.empty()) << "a symlink";
}

TEST(AuthState, BootIdOfTheKernel) {
    const std::string id = readBootId();
    EXPECT_EQ(id.size(), 36u) << id;
    EXPECT_EQ(id, readBootId()) << "the same within one boot";
    TempDir dir;
    EXPECT_EQ(readBootId(dir.file("none")), "");
    mat::test::writeFile(dir.file("id"), "abc\n", 0600);
    EXPECT_EQ(readBootId(dir.file("id")), "abc");
}

TEST(AuthState, WriteFailsWithoutTheDirectory) {
    TempDir dir;
    std::string err;
    EXPECT_FALSE(writeAuthState(dir.file("none/auth-state.json"), sampleState(), err));
    EXPECT_FALSE(err.empty());
}
