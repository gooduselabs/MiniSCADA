// The rate limit of tag writes (specs/006 T137; FR-041; research R14): token buckets on a monotonic
// clock, two tiers (per session, keyed by the hash of the token; the whole device), the wait that
// is told to the client, and the token given back when a command is refused after the check.
#include "core/tag-engine/token_bucket.hpp"

#include <gtest/gtest.h>

using namespace mat;

namespace {

struct Clock {
    int64_t t = 1000000;
    std::function<int64_t()> fn() {
        return [this] { return t; };
    }
};

}  // namespace

TEST(TokenBucket, StartsFullAndRefillsAtTheRate) {
    TokenBucket b(10, 20);  // 10 at once, 20 a minute: one every 3 s
    int64_t wait = 0;
    for (int i = 0; i < 10; ++i) ASSERT_TRUE(b.tryTake(0, &wait)) << i;
    EXPECT_FALSE(b.tryTake(0, &wait));
    EXPECT_EQ(wait, 3000);
    EXPECT_FALSE(b.tryTake(1000, &wait));
    EXPECT_EQ(wait, 2000);
    EXPECT_FALSE(b.tryTake(2999, &wait));
    EXPECT_EQ(wait, 1);
    EXPECT_TRUE(b.tryTake(3000, &wait));
    EXPECT_FALSE(b.tryTake(3000, &wait));
    EXPECT_EQ(wait, 3000);
}

TEST(TokenBucket, NeverHoldsMoreThanTheBurst) {
    TokenBucket b(3, 60);
    for (int i = 0; i < 3; ++i) ASSERT_TRUE(b.tryTake(0));
    EXPECT_TRUE(b.tryTake(10 * 60 * 1000));  // ten minutes idle: still only 3
    EXPECT_TRUE(b.tryTake(10 * 60 * 1000));
    EXPECT_TRUE(b.tryTake(10 * 60 * 1000));
    EXPECT_FALSE(b.tryTake(10 * 60 * 1000));
}

TEST(TokenBucket, ARefundGivesTheTokenBackUpToTheBurst) {
    TokenBucket b(2, 20);
    ASSERT_TRUE(b.tryTake(0));
    ASSERT_TRUE(b.tryTake(0));
    EXPECT_FALSE(b.tryTake(0));
    b.refund(0);
    EXPECT_TRUE(b.tryTake(0));
    b.refund(0);
    b.refund(0);
    b.refund(0);  // more than was taken: the bucket stays at its burst
    EXPECT_TRUE(b.tryTake(0));
    EXPECT_TRUE(b.tryTake(0));
    EXPECT_FALSE(b.tryTake(0));
}

TEST(TokenBucket, ValuesBelowTheMinimumAreRaised) {
    TokenBucket b(0, 0);
    EXPECT_TRUE(b.tryTake(0));
    EXPECT_FALSE(b.tryTake(0));
}

TEST(WriteRateLimiter, DefaultsAre10And20PerMinutePerSessionAnd20And20ForTheDevice) {
    RateConfig c;
    EXPECT_EQ(c.sessionBurst, 10);
    EXPECT_EQ(c.sessionPerMin, 20);
    EXPECT_EQ(c.globalBurst, 20);
    EXPECT_EQ(c.globalPerMin, 20);
}

TEST(WriteRateLimiter, ASessionGetsItsBurstThenTheWaitIsTold) {
    Clock clock;
    WriteRateLimiter l(RateConfig{}, clock.fn());
    for (int i = 0; i < 10; ++i) ASSERT_TRUE(l.take("s1").ok) << i;
    const auto d = l.take("s1");
    EXPECT_FALSE(d.ok);
    EXPECT_EQ(d.retryAfterMs, 3000);
    clock.t += 3000;
    EXPECT_TRUE(l.take("s1").ok);
    EXPECT_FALSE(l.take("s1").ok);
}

TEST(WriteRateLimiter, SessionsAreIndependentButShareTheDeviceTier) {
    Clock clock;
    WriteRateLimiter l(RateConfig{}, clock.fn());
    for (int i = 0; i < 10; ++i) ASSERT_TRUE(l.take("a").ok);
    for (int i = 0; i < 10; ++i)
        ASSERT_TRUE(l.take("b").ok) << "another session has its own bucket";
    // 20 taken on the device: a third session is stopped by the device tier
    const auto d = l.take("c");
    EXPECT_FALSE(d.ok);
    EXPECT_EQ(d.retryAfterMs, 3000);
    clock.t += 3000;
    EXPECT_TRUE(l.take("c").ok);
}

TEST(WriteRateLimiter, ARefusalByTheDeviceTierDoesNotSpendTheSessionToken) {
    Clock clock;
    RateConfig c;
    c.sessionBurst = 2;
    c.sessionPerMin = 1;  // slow: a token that is spent in vain is not made up in the test
    c.globalBurst = 2;
    c.globalPerMin = 20;
    WriteRateLimiter l(c, clock.fn());
    ASSERT_TRUE(l.take("a").ok);
    ASSERT_TRUE(l.take("b").ok);  // the device bucket is empty now
    EXPECT_FALSE(l.take("c").ok);
    EXPECT_FALSE(l.take("c").ok);
    clock.t += 3000;  // one token on the device; "c" still has both of its own
    EXPECT_TRUE(l.take("c").ok);
    clock.t += 3000;
    EXPECT_TRUE(l.take("c").ok) << "its second token was not lost to the refusals";
}

TEST(WriteRateLimiter, WhenBothTiersAreEmptyTheLongerWaitIsTold) {
    Clock clock;
    RateConfig c;
    c.sessionBurst = 1;
    c.sessionPerMin = 1;  // one a minute
    c.globalBurst = 20;
    c.globalPerMin = 20;
    WriteRateLimiter l(c, clock.fn());
    ASSERT_TRUE(l.take("a").ok);
    const auto d = l.take("a");
    EXPECT_FALSE(d.ok);
    EXPECT_EQ(d.retryAfterMs, 60000);
}

TEST(WriteRateLimiter, RefundGivesBackTheTokenOfBothTiers) {
    Clock clock;
    RateConfig c;
    c.sessionBurst = 1;
    c.sessionPerMin = 20;
    c.globalBurst = 1;
    c.globalPerMin = 20;
    WriteRateLimiter l(c, clock.fn());
    ASSERT_TRUE(l.take("a").ok);
    EXPECT_FALSE(l.take("a").ok);
    l.refund("a");
    EXPECT_TRUE(l.take("a").ok) << "the command that was refused after the check cost nothing";
}

TEST(WriteRateLimiter, TheTableOfSessionsDoesNotGrowWithoutBound) {
    Clock clock;
    RateConfig c;
    WriteRateLimiter l(c, clock.fn());
    for (int i = 0; i < 5000; ++i) {
        l.take("session-" + std::to_string(i));
        clock.t += 10;
    }
    EXPECT_LE(l.sessionCount(), 1100u);
}
