// T029 (feature 005; data-model §5, research R9, FR-013): lockout on a fake CLOCK_BOOTTIME.
// - Per typed name (names that do not exist too) and per source address, 256 entries each.
// - failures + 1 per failure; the 5th locks for 5 minutes and the count starts again at 0.
// - While either is locked: AUTH_LOCKED with the longer remaining time, in whole seconds.
// - A right password clears the name and the address; --user-unlock (unlockSeq) or another rev
//   clears the name. A full table drops the least recently used entry that is not locked.
#include "core/auth/login_guard.hpp"

#include <gtest/gtest.h>

#include <optional>
#include <string>

using namespace mat;

namespace {

constexpr int64_t kT0 = 9000000;
constexpr int64_t kSec = 1000;
const std::optional<AccountGeneration> kGen = AccountGeneration{1, 0};
const std::optional<AccountGeneration> kNone = std::nullopt;

// `n` failures for (user, ip) at `at`; returns what the last one locked.
LockoutNow fail(LoginGuard& g, const std::string& user, const std::string& ip, int n,
                int64_t at = kT0, const std::optional<AccountGeneration>& gen = kGen) {
    LockoutNow last;
    for (int i = 0; i < n; ++i) last = g.recordFailure(user, ip, at, gen);
    return last;
}

}  // namespace

TEST(LoginGuard, FiveFailuresLockForFiveMinutes) {
    LoginGuard g;
    const LockoutNow four = fail(g, "kysu1", "10.0.0.1", 4);
    EXPECT_FALSE(four.user);
    EXPECT_FALSE(four.source);
    EXPECT_FALSE(g.check("kysu1", "10.0.0.1", kT0, kGen).locked);
    const LockoutNow fifth = g.recordFailure("kysu1", "10.0.0.1", kT0, kGen);
    EXPECT_TRUE(fifth.user);
    EXPECT_TRUE(fifth.source);
    GuardDecision d = g.check("kysu1", "10.0.0.1", kT0, kGen);
    EXPECT_TRUE(d.locked);
    EXPECT_EQ(d.retryAfterS, 300);
    d = g.check("kysu1", "10.0.0.1", kT0 + 299 * kSec + 1, kGen);
    EXPECT_TRUE(d.locked);
    EXPECT_EQ(d.retryAfterS, 1) << "rounded up";
    EXPECT_FALSE(g.check("kysu1", "10.0.0.1", kT0 + kLockoutMs, kGen).locked);
}

TEST(LoginGuard, TheCountStartsAgainAfterALock) {
    LoginGuard g;
    fail(g, "kysu1", "10.0.0.1", 5);
    const int64_t later = kT0 + kLockoutMs;
    ASSERT_FALSE(g.check("kysu1", "10.0.0.1", later, kGen).locked);
    EXPECT_FALSE(fail(g, "kysu1", "10.0.0.1", 4, later).user);
    EXPECT_FALSE(g.check("kysu1", "10.0.0.1", later, kGen).locked);
    EXPECT_TRUE(fail(g, "kysu1", "10.0.0.1", 1, later).user);
    EXPECT_TRUE(g.check("kysu1", "10.0.0.1", later, kGen).locked);
}

TEST(LoginGuard, CountsPerNameAndPerAddressSeparately) {
    LoginGuard g;
    for (int i = 1; i <= 5; ++i) {  // one name from five addresses
        const LockoutNow l = g.recordFailure("kysu1", "10.0.0." + std::to_string(i), kT0, kGen);
        EXPECT_EQ(l.user, i == 5);
        EXPECT_FALSE(l.source);
    }
    EXPECT_TRUE(g.check("kysu1", "10.0.0.99", kT0, kGen).locked) << "the name is locked";
    EXPECT_FALSE(g.check("admin", "10.0.0.1", kT0, kGen).locked) << "the addresses are not";

    for (int i = 1; i <= 5; ++i) {  // five names from one address
        const LockoutNow l = g.recordFailure("user" + std::to_string(i), "10.0.1.1", kT0, kNone);
        EXPECT_FALSE(l.user);
        EXPECT_EQ(l.source, i == 5);
    }
    EXPECT_TRUE(g.check("admin", "10.0.1.1", kT0, kGen).locked) << "the address is locked";
    EXPECT_FALSE(g.check("user1", "10.0.1.2", kT0, kNone).locked);
}

TEST(LoginGuard, NamesThatDoNotExistAreCountedToo) {
    LoginGuard g;
    fail(g, "ghost", "10.0.0.1", 2, kT0, kNone);
    fail(g, "ghost", "10.0.0.2", 3, kT0, kNone);
    const GuardDecision d = g.check("ghost", "10.0.0.3", kT0, kNone);
    EXPECT_TRUE(d.locked) << "the same behaviour as a real name";
    EXPECT_EQ(d.retryAfterS, 300);
}

TEST(LoginGuard, AnEmptyNameCountsForTheAddressOnly) {
    LoginGuard g;
    for (int i = 1; i <= 5; ++i) {
        const LockoutNow l = g.recordFailure("", "10.0.2.1", kT0, kNone);
        EXPECT_FALSE(l.user);
        EXPECT_EQ(l.source, i == 5);
    }
    EXPECT_TRUE(g.check("", "10.0.2.1", kT0, kNone).locked);
    EXPECT_FALSE(g.check("", "10.0.2.2", kT0, kNone).locked);
    for (const auto& e : g.state().byUser) EXPECT_FALSE(e.key.empty()) << "no entry for \"\"";
}

TEST(LoginGuard, LongerRemainingLockWins) {
    LoginGuard g;
    fail(g, "kysu1", "10.0.0.1", 5, kT0);               // both locked until kT0 + 300 s
    fail(g, "admin", "10.0.0.2", 5, kT0 + 100 * kSec);  // both locked until kT0 + 400 s
    GuardDecision d = g.check("kysu1", "10.0.0.2", kT0 + 100 * kSec, kGen);
    EXPECT_TRUE(d.locked);
    EXPECT_EQ(d.retryAfterS, 300) << "the address lock ends later";
    d = g.check("admin", "10.0.0.1", kT0 + 100 * kSec, kGen);
    EXPECT_EQ(d.retryAfterS, 300) << "the name lock ends later";
    d = g.check("kysu1", "10.0.0.1", kT0 + 100 * kSec, kGen);
    EXPECT_EQ(d.retryAfterS, 200);
}

TEST(LoginGuard, ARightPasswordClearsItsNameAndAddress) {
    LoginGuard g;
    fail(g, "kysu1", "10.0.0.1", 4);
    fail(g, "admin", "10.0.0.2", 4);
    g.recordSuccess("kysu1", "10.0.0.1");
    EXPECT_FALSE(fail(g, "kysu1", "10.0.0.1", 4).user) << "counted from 0 again";
    EXPECT_TRUE(fail(g, "admin", "10.0.0.2", 1).user) << "other counters untouched";
    // A success also lifts a lock (the 5th attempt counted before its hash, research R9).
    fail(g, "eng2", "10.0.0.3", 5);
    ASSERT_TRUE(g.check("eng2", "10.0.0.3", kT0, kGen).locked);
    g.recordSuccess("eng2", "10.0.0.3");
    EXPECT_FALSE(g.check("eng2", "10.0.0.3", kT0, kGen).locked);
}

TEST(LoginGuard, UnlockSeqOrRevChangeClearsTheName) {
    LoginGuard g;
    fail(g, "kysu1", "10.0.0.1", 1, kT0, AccountGeneration{1, 0});
    for (int i = 2; i <= 5; ++i)
        g.recordFailure("kysu1", "10.0.0." + std::to_string(i), kT0, AccountGeneration{1, 0});
    ASSERT_TRUE(g.check("kysu1", "10.0.0.9", kT0, AccountGeneration{1, 0}).locked);
    EXPECT_FALSE(g.check("kysu1", "10.0.0.9", kT0, AccountGeneration{1, 1}).locked)
        << "--user-unlock";
    // The entry was reset: four new failures do not lock.
    EXPECT_FALSE(fail(g, "kysu1", "10.0.0.9", 4, kT0, AccountGeneration{1, 1}).user);
    EXPECT_FALSE(g.check("kysu1", "10.0.0.8", kT0, AccountGeneration{2, 1}).locked)
        << "a new rev too";

    fail(g, "eng2", "10.0.1.1", 5, kT0, AccountGeneration{1, 0});
    EXPECT_FALSE(g.check("eng2", "10.0.1.2", kT0, AccountGeneration{1, 1}).locked);
    EXPECT_TRUE(g.check("other", "10.0.1.1", kT0, kGen).locked) << "the address lock stays";
}

TEST(LoginGuard, ClearUser) {
    LoginGuard g;
    fail(g, "kysu1", "10.0.0.1", 5);
    g.clearUser("kysu1");
    EXPECT_FALSE(g.check("kysu1", "10.0.0.2", kT0, kGen).locked);
    EXPECT_TRUE(g.check("kysu1", "10.0.0.1", kT0, kGen).locked) << "the address keeps its lock";
}

TEST(LoginGuard, AFullTableDropsTheLeastRecentlyUsedUnlockedEntry) {
    LoginGuard g;
    fail(g, "victim", "10.9.0.1", 5);  // locked name (and address)
    fail(g, "first", "10.9.0.2", 1);
    for (int i = 0; i < 300; ++i)
        g.recordFailure("name" + std::to_string(i),
                        "10.1." + std::to_string(i / 250) + "." + std::to_string(i % 250), kT0 + 1,
                        kNone);
    const GuardState st = g.state();
    EXPECT_EQ(st.byUser.size(), kGuardTableSize);
    EXPECT_EQ(st.bySource.size(), kGuardTableSize);
    EXPECT_TRUE(g.check("victim", "10.9.9.9", kT0 + 2, kGen).locked)
        << "a flood of names cannot unlock a locked one";
    EXPECT_FALSE(fail(g, "first", "10.9.0.3", 4, kT0 + 3).user)
        << "'first' was dropped: its count started again";
}

TEST(LoginGuard, StateRoundTrip) {
    LoginGuard a;
    fail(a, "kysu1", "10.0.0.1", 2, kT0, AccountGeneration{3, 1});
    fail(a, "ghost", "10.0.0.2", 5, kT0, kNone);
    const GuardState st = a.state();
    ASSERT_EQ(st.byUser.size(), 2u);
    ASSERT_EQ(st.bySource.size(), 2u);
    EXPECT_EQ(st.byUser[0].key, "kysu1") << "least recently used first";
    EXPECT_EQ(st.byUser[0].failures, 2);
    ASSERT_TRUE(st.byUser[0].generation.has_value());
    EXPECT_EQ(*st.byUser[0].generation, (AccountGeneration{3, 1}));
    EXPECT_EQ(st.byUser[1].lockedUntilMono, kT0 + kLockoutMs);
    EXPECT_FALSE(st.byUser[1].generation.has_value());
    LoginGuard b;
    b.restore(st);
    EXPECT_TRUE(b.check("ghost", "10.0.0.7", kT0 + 1, kNone).locked);
    EXPECT_TRUE(b.check("x.y.z", "10.0.0.2", kT0 + 1, kNone).locked);
    EXPECT_TRUE(fail(b, "kysu1", "10.0.0.5", 3, kT0 + 1, AccountGeneration{3, 1}).user)
        << "2 restored + 3";
}
