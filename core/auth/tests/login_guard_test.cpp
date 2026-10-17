// T033 (feature 011; spec FR-014 to FR-016, SC-003, research R5, contracts/device-api-011.md §2):
// the lockout per (name, IP) pair and per IP on a fake CLOCK_BOOTTIME (feature 005's T029 per name
// is gone with it).
// - Pair: 5 failures in a row lock for 5 minutes; a lock again within 24 hours doubles, at most 60
//   minutes, never for good; the same name from another address is not locked.
// - Address: 20 failures (any names) within 10 minutes lock it for 5 minutes.
// - A right password clears its own pair only, and takes back its own provisional failure.
// - LRU of 4,096 pairs that keeps locked pairs; names in NFC form only (valid account names);
//   CLOCK_BOOTTIME, not the wall clock.
// - Distributed attack: 50 failures within 10 minutes on one name from at least 5 addresses is
//   reported once per 10 minutes and locks nobody.
// The concurrent-login limit (LOGIN_BUSY) lives in AuthService: auth_service_test.
#include "core/auth/login_guard.hpp"

#include <gtest/gtest.h>
#include <time.h>

#include <optional>
#include <string>

#include "core/auth/session_store.hpp"

using namespace mat;

namespace {

constexpr int64_t kT0 = 9000000;
constexpr int64_t kSec = 1000;
constexpr int64_t kMin = 60 * kSec;
const std::optional<AccountGeneration> kGen = AccountGeneration{1, 0};
const std::optional<AccountGeneration> kNone = std::nullopt;

// `n` failures for (user, ip) at `at`; returns what the last one locked.
LockoutNow fail(LoginGuard& g, const std::string& user, const std::string& ip, int n,
                int64_t at = kT0, const std::optional<AccountGeneration>& gen = kGen) {
    LockoutNow last;
    for (int i = 0; i < n; ++i) last = g.recordFailure(user, ip, at, gen);
    return last;
}

std::string ip(int i) { return "10.1." + std::to_string(i / 250) + "." + std::to_string(i % 250); }

}  // namespace

TEST(LoginGuard, FiveFailuresLockThePairForFiveMinutes) {
    LoginGuard g;
    const LockoutNow four = fail(g, "kysu1", "10.0.0.1", 4);
    EXPECT_FALSE(four.pair);
    EXPECT_FALSE(four.source);
    EXPECT_FALSE(g.check("kysu1", "10.0.0.1", kT0, kGen).locked);
    const LockoutNow fifth = g.recordFailure("kysu1", "10.0.0.1", kT0, kGen);
    EXPECT_TRUE(fifth.pair);
    EXPECT_FALSE(fifth.source) << "5 of 20 for the address";
    EXPECT_EQ(fifth.pairLockMs, 5 * kMin);
    GuardDecision d = g.check("kysu1", "10.0.0.1", kT0, kGen);
    EXPECT_TRUE(d.locked);
    EXPECT_EQ(d.retryAfterS, 300);
    d = g.check("kysu1", "10.0.0.1", kT0 + 299 * kSec + 1, kGen);
    EXPECT_TRUE(d.locked);
    EXPECT_EQ(d.retryAfterS, 1) << "rounded up";
    EXPECT_FALSE(g.check("kysu1", "10.0.0.1", kT0 + 5 * kMin, kGen).locked);
}

TEST(LoginGuard, TheSameNameFromAnotherAddressIsNotLocked) {  // FR-014, S-M1
    LoginGuard g;
    fail(g, "kysu1", "10.0.0.1", 5);
    ASSERT_TRUE(g.check("kysu1", "10.0.0.1", kT0, kGen).locked);
    EXPECT_FALSE(g.check("kysu1", "10.0.0.2", kT0, kGen).locked) << "IP B";
    EXPECT_FALSE(g.check("admin", "10.0.0.1", kT0, kGen).locked) << "another name from IP A";
    // One name from many addresses: every pair counts alone, nothing locks the name.
    for (int i = 1; i <= 30; ++i) {
        const LockoutNow l = g.recordFailure("admin", ip(i), kT0, kGen);
        EXPECT_FALSE(l.pair) << i;
    }
    EXPECT_FALSE(g.check("admin", ip(99), kT0, kGen).locked);
}

TEST(LoginGuard, RepeatedLocksDoubleUpToSixtyMinutes) {  // never for good
    LoginGuard g;
    int64_t t = kT0;
    for (const int64_t minutes : {5, 10, 20, 40, 60, 60, 60}) {
        const LockoutNow l = fail(g, "kysu1", "10.0.0.1", 5, t);
        ASSERT_TRUE(l.pair) << minutes;
        EXPECT_EQ(l.pairLockMs, minutes * kMin);
        EXPECT_EQ(g.check("kysu1", "10.0.0.1", t, kGen).retryAfterS, minutes * 60);
        t += minutes * kMin;
        EXPECT_FALSE(g.check("kysu1", "10.0.0.1", t, kGen).locked) << "ends after " << minutes;
    }
}

TEST(LoginGuard, ALockMoreThanADayAfterTheLastIsFiveMinutesAgain) {
    LoginGuard g;
    fail(g, "kysu1", "10.0.0.1", 5, kT0);
    const int64_t t1 = kT0 + 5 * kMin;
    EXPECT_EQ(fail(g, "kysu1", "10.0.0.1", 5, t1).pairLockMs, 10 * kMin);
    const int64_t t2 = t1 + 24 * 60 * kMin + 1;
    EXPECT_EQ(fail(g, "kysu1", "10.0.0.1", 5, t2).pairLockMs, 5 * kMin);
}

TEST(LoginGuard, NamesThatDoNotExistAreCountedPerPairToo) {
    LoginGuard g;
    fail(g, "ghost", "10.0.0.1", 5, kT0, kNone);
    const GuardDecision d = g.check("ghost", "10.0.0.1", kT0, kNone);
    EXPECT_TRUE(d.locked) << "the same behaviour as a real name";
    EXPECT_EQ(d.retryAfterS, 300);
    EXPECT_FALSE(g.check("ghost", "10.0.0.2", kT0, kNone).locked);
}

TEST(LoginGuard, TwentyFailuresInTenMinutesLockTheAddress) {  // FR-015
    LoginGuard g;
    for (int i = 1; i <= 20; ++i) {  // five names, four tries each: no pair locks
        const LockoutNow l = g.recordFailure("name" + std::to_string((i - 1) / 4), "10.0.1.1",
                                             kT0 + i * kSec, kNone);
        EXPECT_EQ(l.source, i == 20) << i;
    }
    GuardDecision d = g.check("kysu1", "10.0.1.1", kT0 + 20 * kSec, kGen);
    EXPECT_TRUE(d.locked) << "every name from that address";
    EXPECT_EQ(d.retryAfterS, 300);
    EXPECT_FALSE(g.check("kysu1", "10.0.1.2", kT0 + 20 * kSec, kGen).locked);
    EXPECT_FALSE(g.check("kysu1", "10.0.1.1", kT0 + 20 * kSec + 5 * kMin, kGen).locked);
    // The count starts again after a lock.
    EXPECT_FALSE(g.recordFailure("kysu1", "10.0.1.1", kT0 + 21 * kSec + 5 * kMin, kGen).source);
}

TEST(LoginGuard, TheAddressWindowSlides) {
    LoginGuard g;
    for (int i = 0; i < 19; ++i) g.recordFailure("", "10.0.1.1", kT0, kNone);
    EXPECT_FALSE(g.recordFailure("", "10.0.1.1", kT0 + 10 * kMin, kNone).source)
        << "the 19 are older than 10 minutes";
    EXPECT_FALSE(g.check("", "10.0.1.1", kT0 + 10 * kMin, kNone).locked);
    for (int i = 0; i < 18; ++i) g.recordFailure("", "10.0.1.1", kT0 + 11 * kMin, kNone);
    EXPECT_TRUE(g.recordFailure("", "10.0.1.1", kT0 + 12 * kMin, kNone).source)
        << "1 + 18 + 1 within 10 minutes";
}

TEST(LoginGuard, AnEmptyNameCountsForTheAddressOnly) {
    LoginGuard g;
    for (int i = 1; i <= 20; ++i) {
        const LockoutNow l = g.recordFailure("", "10.0.2.1", kT0, kNone);
        EXPECT_FALSE(l.pair);
        EXPECT_EQ(l.source, i == 20);
    }
    EXPECT_TRUE(g.check("", "10.0.2.1", kT0, kNone).locked);
    EXPECT_FALSE(g.check("", "10.0.2.2", kT0, kNone).locked);
    EXPECT_TRUE(g.state().pairs.empty()) << "no pair for \"\"";
}

TEST(LoginGuard, ARightPasswordClearsOnlyItsOwnPair) {  // FR-015
    LoginGuard g;
    fail(g, "kysu1", "10.0.0.1", 4);
    fail(g, "admin", "10.0.0.1", 4);
    fail(g, "kysu1", "10.0.0.2", 4);
    g.recordFailure("kysu1", "10.0.0.1", kT0 + 1, kGen);  // this attempt is the right password
    g.recordSuccess("kysu1", "10.0.0.1", kT0 + 1);
    EXPECT_FALSE(fail(g, "kysu1", "10.0.0.1", 4).pair) << "its pair counts from 0 again";
    EXPECT_TRUE(fail(g, "admin", "10.0.0.1", 1).pair) << "another name: untouched";
    EXPECT_TRUE(fail(g, "kysu1", "10.0.0.2", 1).pair) << "another address: untouched";
    // The address keeps the failures that were failures: 4 + 4 + 4 + 1 = 13 at 10.0.0.1 (the
    // success took its own back).
    for (int i = 0; i < 6; ++i) EXPECT_FALSE(g.recordFailure("", "10.0.0.1", kT0, kNone).source);
    EXPECT_TRUE(g.recordFailure("", "10.0.0.1", kT0, kNone).source) << "the 20th";
    // A success also lifts a lock of its pair (the 5th attempt counted before its hash).
    fail(g, "eng2", "10.0.0.3", 4);
    ASSERT_TRUE(g.recordFailure("eng2", "10.0.0.3", kT0 + 2, kGen).pair);
    g.recordSuccess("eng2", "10.0.0.3", kT0 + 2);
    EXPECT_FALSE(g.check("eng2", "10.0.0.3", kT0 + 2, kGen).locked);
}

TEST(LoginGuard, SigningInOftenNeverLocksTheAddress) {
    LoginGuard g;
    for (int i = 0; i < 100; ++i) {
        const int64_t t = kT0 + i * kSec;
        ASSERT_FALSE(g.check("kysu1", "10.0.0.1", t, kGen).locked) << i;
        g.recordFailure("kysu1", "10.0.0.1", t, kGen);  // provisional, before the hash
        g.recordSuccess("kysu1", "10.0.0.1", t);
    }
    // A success whose provisional failure was the 20th of the address takes the lock back too.
    for (int i = 0; i < 19; ++i) g.recordFailure("", "10.0.0.5", kT0, kNone);
    ASSERT_TRUE(g.recordFailure("kysu1", "10.0.0.5", kT0 + 7, kGen).source);
    g.recordSuccess("kysu1", "10.0.0.5", kT0 + 7);
    EXPECT_FALSE(g.check("kysu1", "10.0.0.5", kT0 + 7, kGen).locked);
}

TEST(LoginGuard, LongerRemainingLockWins) {
    LoginGuard g;
    fail(g, "kysu1", "10.0.0.1", 5, kT0);  // pair locked until kT0 + 300 s
    for (int i = 0; i < 15; ++i)
        g.recordFailure("", "10.0.0.1", kT0 + 100 * kSec, kNone);  // address until kT0 + 400 s
    GuardDecision d = g.check("kysu1", "10.0.0.1", kT0 + 100 * kSec, kGen);
    EXPECT_TRUE(d.locked);
    EXPECT_EQ(d.retryAfterS, 300) << "the address lock ends later";
    d = g.check("kysu1", "10.0.0.1", kT0 + 350 * kSec, kGen);
    EXPECT_EQ(d.retryAfterS, 50);
}

TEST(LoginGuard, UnlockSeqOrRevChangeClearsThePairs) {
    LoginGuard g;
    fail(g, "kysu1", "10.0.0.1", 5, kT0, AccountGeneration{1, 0});
    fail(g, "kysu1", "10.0.0.2", 5, kT0, AccountGeneration{1, 0});
    ASSERT_TRUE(g.check("kysu1", "10.0.0.1", kT0, AccountGeneration{1, 0}).locked);
    EXPECT_FALSE(g.check("kysu1", "10.0.0.1", kT0, AccountGeneration{1, 1}).locked)
        << "--user-unlock";
    EXPECT_FALSE(fail(g, "kysu1", "10.0.0.1", 4, kT0, AccountGeneration{1, 1}).pair)
        << "the pair was reset";
    EXPECT_FALSE(g.check("kysu1", "10.0.0.2", kT0, AccountGeneration{2, 1}).locked)
        << "a new rev too";
}

TEST(LoginGuard, ClearUserAndClearAll) {
    LoginGuard g;
    fail(g, "kysu1", "10.0.0.1", 5);
    fail(g, "kysu1", "10.0.0.2", 5);
    fail(g, "admin", "10.0.0.3", 5);
    for (int i = 0; i < 20; ++i) g.recordFailure("", "10.0.0.4", kT0, kNone);
    g.clearUser("kysu1");
    EXPECT_FALSE(g.check("kysu1", "10.0.0.1", kT0, kGen).locked);
    EXPECT_FALSE(g.check("kysu1", "10.0.0.2", kT0, kGen).locked);
    EXPECT_TRUE(g.check("admin", "10.0.0.3", kT0, kGen).locked);
    EXPECT_TRUE(g.check("kysu1", "10.0.0.4", kT0, kGen).locked) << "the address lock stays";
    g.clearAll();
    EXPECT_FALSE(g.check("admin", "10.0.0.3", kT0, kGen).locked);
    EXPECT_FALSE(g.check("kysu1", "10.0.0.4", kT0, kGen).locked);
    EXPECT_TRUE(g.state().pairs.empty());
    EXPECT_TRUE(g.state().sources.empty());
}

TEST(LoginGuard, AFullTableKeeps4096PairsAndDropsTheLeastRecentlyUsedUnlockedOne) {
    LoginGuard g;
    fail(g, "victim", "10.9.0.1", 5);  // a locked pair
    fail(g, "first", "10.9.0.2", 1);
    for (int i = 0; i < 5000; ++i)
        g.recordFailure("name" + std::to_string(i), ip(i), kT0 + 1, kNone);
    const GuardState st = g.state();
    EXPECT_EQ(st.pairs.size(), kPairTableSize);
    EXPECT_EQ(kPairTableSize, 4096u);
    EXPECT_LE(st.sources.size(), kSourceTableSize);
    EXPECT_TRUE(g.check("victim", "10.9.0.1", kT0 + 2, kGen).locked)
        << "a flood of pairs cannot unlock a locked one";
    EXPECT_FALSE(fail(g, "first", "10.9.0.2", 4, kT0 + 3).pair)
        << "'first' was dropped: its count started again";
    // A pair used again moves to the recent end and stays.
    LoginGuard h;
    fail(h, "kept", "10.9.1.1", 4);
    for (int i = 0; i < 5000; ++i) {
        h.recordFailure("n" + std::to_string(i), ip(i), kT0 + 1, kNone);
        if (i % 1000 == 0) h.check("kept", "10.9.1.1", kT0 + 1, kGen);
    }
    EXPECT_TRUE(fail(h, "kept", "10.9.1.1", 1, kT0 + 2).pair) << "4 kept + 1";
}

// L5 of the security review of 011: a full table drops first a pair that never locked; a pair whose
// lock has ended keeps its history (the next lock within 24 h doubles), so a flood of new pairs
// cannot bring a repeated lock back to 5 minutes.
TEST(LoginGuard, AFullTableDropsPairsThatNeverLockedFirst) {
    LoginGuard g;
    ASSERT_EQ(fail(g, "repeat", "10.9.0.1", 5).pairLockMs, 5 * kMin);
    const int64_t later = kT0 + 6 * kMin;  // the lock has ended
    ASSERT_FALSE(g.check("repeat", "10.9.0.1", later, kGen).locked);
    for (int i = 0; i < 5000; ++i) g.recordFailure("name" + std::to_string(i), ip(i), later, kNone);
    EXPECT_EQ(g.state().pairs.size(), kPairTableSize);
    EXPECT_EQ(fail(g, "repeat", "10.9.0.1", 5, later + kMin).pairLockMs, 10 * kMin)
        << "the history of the pair was kept: the second lock doubles";
}

// L5: the watch of a distributed attack drops first the names whose failures are older than the
// window, then the name with the fewest failures: a flood of names tried once cannot push out a
// name under attack.
TEST(LoginGuard, AFloodOfNamesDoesNotPushOutANameUnderAttack) {
    LoginGuard g;
    for (int i = 0; i < 40; ++i)
        g.noteFailure("admin", "10.2.0." + std::to_string(i % 10), kT0 + i);
    for (int i = 0; i < 300; ++i)
        EXPECT_FALSE(g.noteFailure("n" + std::to_string(i), "10.4.0.1", kT0 + 100 + i));
    int reports = 0;
    for (int i = 0; i < 10; ++i)
        if (g.noteFailure("admin", "10.2.1." + std::to_string(i % 5), kT0 + 500 + i)) ++reports;
    EXPECT_EQ(reports, 1) << "the 50th failure on admin within 10 minutes is reported";
    // A name whose failures are all older than the window goes before a recent one.
    LoginGuard h;
    for (int i = 0; i < 40; ++i) h.noteFailure("old", "10.2.0." + std::to_string(i % 10), kT0 + i);
    const int64_t t = kT0 + kDistributedWindowMs + kMin;
    for (int i = 0; i < 40; ++i) h.noteFailure("admin", "10.2.0." + std::to_string(i % 10), t + i);
    for (int i = 0; i < static_cast<int>(kWatchTableSize) - 2; ++i)
        for (int k = 0; k < 2; ++k)
            h.noteFailure("m" + std::to_string(i), "10.4.0." + std::to_string(k), t + 100 + i);
    h.noteFailure("one-more", "10.4.0.1", t + 1000);  // the table is full: "old" goes
    int r = 0;
    for (int i = 0; i < 10; ++i)
        if (h.noteFailure("admin", "10.2.1." + std::to_string(i % 5), t + 2000 + i)) ++r;
    EXPECT_EQ(r, 1);
}

TEST(LoginGuard, OnlyNamesInNfcFormAreKept) {
    EXPECT_EQ(guardName("kysu1"), "kysu1");
    EXPECT_EQ(guardName("kysu-truong.ca_1"), "kysu-truong.ca_1");
    EXPECT_EQ(guardName("ky\xC3\xA9u"), "") << "precomposed é: cannot be an account";
    EXPECT_EQ(guardName("kye\xCC\x81u"), "") << "e + combining acute: neither";
    EXPECT_EQ(guardName("KYSU1"), "") << "upper case is another string, not an account";
    EXPECT_EQ(guardName("kysu1 "), "");
    EXPECT_EQ(guardName(std::string(64, 'a')), "") << "too long";
    // Both spellings of a non-ASCII name count for the address only.
    LoginGuard g;
    for (int i = 0; i < 10; ++i) {
        g.recordFailure(guardName("ky\xC3\xA9u"), "10.0.0.1", kT0, kNone);
        g.recordFailure(guardName("kye\xCC\x81u"), "10.0.0.1", kT0, kNone);
    }
    EXPECT_TRUE(g.state().pairs.empty());
    EXPECT_TRUE(g.check("", "10.0.0.1", kT0, kNone).locked) << "20 for the address";
}

TEST(LoginGuard, TimesAreCLOCK_BOOTTIMENotTheWallClock) {
    // AuthService feeds bootTimeMs() (session_store.hpp): CLOCK_BOOTTIME, which a change of the
    // wall clock (CLOCK_REALTIME: NTP, an operator, a dead RTC) does not move.
    timespec boot{}, real{};
    ASSERT_EQ(::clock_gettime(CLOCK_BOOTTIME, &boot), 0);
    ASSERT_EQ(::clock_gettime(CLOCK_REALTIME, &real), 0);
    const int64_t bootMs = int64_t{boot.tv_sec} * 1000 + boot.tv_nsec / 1000000;
    const int64_t realMs = int64_t{real.tv_sec} * 1000 + real.tv_nsec / 1000000;
    const int64_t got = bootTimeMs();
    EXPECT_GE(got, bootMs);
    EXPECT_LT(got - bootMs, 1000);
    EXPECT_GT(realMs - got, 365LL * 24 * 3600 * 1000) << "not the wall clock";
    // The guard only compares the times it is given: a lock set at t lasts 5 minutes of that
    // clock, whatever a wall clock would say meanwhile.
    LoginGuard g;
    fail(g, "kysu1", "10.0.0.1", 5, 1000);
    EXPECT_TRUE(g.check("kysu1", "10.0.0.1", 1000 + 5 * kMin - 1, kGen).locked);
    EXPECT_FALSE(g.check("kysu1", "10.0.0.1", 1000 + 5 * kMin, kGen).locked);
}

TEST(LoginGuard, ADistributedAttackIsReportedOncePerTenMinutesAndLocksNobody) {  // FR-016
    LoginGuard g;
    int reports = 0;
    std::optional<DistributedAttack> first;
    for (int i = 0; i < 100; ++i) {  // 100 failures on "admin" from 10 addresses within 100 s
        const std::string from = "10.2.0." + std::to_string(i % 10);
        const int64_t t = kT0 + i * kSec;
        if (const auto r = g.noteFailure("admin", from, t)) {
            ++reports;
            if (!first) first = r;
            EXPECT_EQ(i, 49) << "at the 50th";
        }
    }
    EXPECT_EQ(reports, 1);
    ASSERT_TRUE(first.has_value());
    EXPECT_EQ(first->failures, 50);
    EXPECT_EQ(first->sources, 10u);
    EXPECT_FALSE(g.check("admin", "10.2.0.99", kT0 + 100 * kSec, kGen).locked)
        << "the name is not locked";
    // 10 minutes after the report, the attack goes on: one more report, then none for 10 minutes.
    int later = 0;
    for (int i = 0; i < 50; ++i)
        if (g.noteFailure("admin", "10.2.1." + std::to_string(i % 5),
                          kT0 + 49 * kSec + 10 * kMin + i))
            ++later;
    EXPECT_EQ(later, 1);
}

TEST(LoginGuard, NoDistributedReportBelowTheThresholds) {
    LoginGuard g;
    for (int i = 0; i < 200; ++i)  // four addresses only
        EXPECT_FALSE(g.noteFailure("admin", "10.3.0." + std::to_string(i % 4), kT0 + i));
    for (int i = 0; i < 49; ++i)  // 49 failures from many addresses
        EXPECT_FALSE(g.noteFailure("kysu1", "10.3.1." + std::to_string(i), kT0 + i));
    for (int i = 0; i < 60; ++i)  // 60 failures spread over more than 10 minutes
        EXPECT_FALSE(g.noteFailure("eng2", "10.3.2." + std::to_string(i % 6), kT0 + i * 13 * kSec));
    for (int i = 0; i < 100; ++i)  // a name that cannot be an account is not watched
        EXPECT_FALSE(g.noteFailure("", "10.3.3." + std::to_string(i % 10), kT0 + i));
}

TEST(LoginGuard, StateRoundTrip) {
    LoginGuard a;
    fail(a, "kysu1", "10.0.0.1", 2, kT0, AccountGeneration{3, 1});
    fail(a, "ghost", "10.0.0.2", 5, kT0, kNone);
    const GuardState st = a.state();
    ASSERT_EQ(st.pairs.size(), 2u);
    ASSERT_EQ(st.sources.size(), 2u);
    EXPECT_EQ(st.pairs[0].user, "kysu1") << "least recently used first";
    EXPECT_EQ(st.pairs[0].ip, "10.0.0.1");
    EXPECT_EQ(st.pairs[0].failures, 2);
    ASSERT_TRUE(st.pairs[0].generation.has_value());
    EXPECT_EQ(*st.pairs[0].generation, (AccountGeneration{3, 1}));
    EXPECT_EQ(st.pairs[1].lockedUntilMono, kT0 + kPairLockMs);
    EXPECT_EQ(st.pairs[1].lockCount, 1);
    EXPECT_FALSE(st.pairs[1].generation.has_value());
    EXPECT_EQ(st.sources[1].failuresMono.size(), 5u);
    LoginGuard b;
    b.restore(st);
    EXPECT_TRUE(b.check("ghost", "10.0.0.2", kT0 + 1, kNone).locked);
    EXPECT_FALSE(b.check("ghost", "10.0.0.7", kT0 + 1, kNone).locked);
    EXPECT_TRUE(fail(b, "kysu1", "10.0.0.1", 3, kT0 + 1, AccountGeneration{3, 1}).pair)
        << "2 restored + 3";
}
