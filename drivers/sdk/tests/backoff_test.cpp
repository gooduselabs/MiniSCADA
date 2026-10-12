// Reconnect backoff (FR-027, research R9).
#include "drivers/sdk/backoff.hpp"

#include <gtest/gtest.h>

using namespace mat::drv;

TEST(Backoff, FirstWaitIsExactlyOneSecondWhateverTheJitter) {
    for (double u : {0.0, 0.5, 0.999999}) {
        Backoff b(10, [u] { return u; });
        EXPECT_EQ(b.nextDelayMs(), 1000) << u;
    }
}

TEST(Backoff, DoublesWithTheJitterSubtractingUpTo20Percent) {
    Backoff hi(10, [] { return 0.0; });  // no reduction
    Backoff lo(10, [] { return 0.999999; });
    const int64_t full[] = {1000, 2000, 4000, 8000, 10000, 10000, 10000};
    for (int i = 0; i < 7; ++i) {
        const int64_t a = hi.nextDelayMs();
        const int64_t b = lo.nextDelayMs();
        EXPECT_EQ(a, full[i]) << i;
        EXPECT_LE(b, full[i]) << i;
        EXPECT_GE(b, std::max<int64_t>(1000, static_cast<int64_t>(full[i] * 0.8) - 1)) << i;
    }
}

TEST(Backoff, FromTheFifthWaitItIsBetween8And10Seconds) {
    Backoff b(10, [] { return 0.5; });
    for (int i = 0; i < 4; ++i) b.nextDelayMs();
    for (int i = 0; i < 20; ++i) {
        const int64_t d = b.nextDelayMs();
        EXPECT_GE(d, 8000);
        EXPECT_LE(d, 10000);
    }
}

TEST(Backoff, SequenceMatchesTheDocumentedRanges) {
    // 1; 1.6-2; 3.2-4; 6.4-8; 8-10 (R9)
    Backoff b(10, [] { return 0.5; });
    EXPECT_EQ(b.nextDelayMs(), 1000);
    EXPECT_EQ(b.nextDelayMs(), 1800);
    EXPECT_EQ(b.nextDelayMs(), 3600);
    EXPECT_EQ(b.nextDelayMs(), 7200);
    EXPECT_EQ(b.nextDelayMs(), 9000);
}

TEST(Backoff, CapIsConfigurableFrom1To60Seconds) {
    Backoff one(1, [] { return 0.0; });
    for (int i = 0; i < 5; ++i) EXPECT_EQ(one.nextDelayMs(), 1000);
    Backoff sixty(60, [] { return 0.0; });
    int64_t last = 0;
    for (int i = 0; i < 10; ++i) last = sixty.nextDelayMs();
    EXPECT_EQ(last, 60000);
    Backoff clampedLow(0, [] { return 0.0; });
    EXPECT_EQ(clampedLow.nextDelayMs(), 1000);
    Backoff clampedHigh(500, [] { return 0.0; });
    int64_t m = 0;
    for (int i = 0; i < 12; ++i) m = clampedHigh.nextDelayMs();
    EXPECT_EQ(m, 60000);
}

TEST(Backoff, ResetStartsOverAtOneSecond) {
    Backoff b(10, [] { return 0.0; });
    for (int i = 0; i < 4; ++i) b.nextDelayMs();
    b.reset();
    EXPECT_EQ(b.nextDelayMs(), 1000);
    EXPECT_EQ(b.failures(), 1);
}

TEST(Backoff, RealRandomSourceStaysInRange) {
    Backoff b(10);
    for (int i = 0; i < 4; ++i) b.nextDelayMs();
    for (int i = 0; i < 200; ++i) {
        const int64_t d = b.nextDelayMs();
        EXPECT_GE(d, 8000);
        EXPECT_LE(d, 10000);
    }
    for (int i = 0; i < 1000; ++i) {
        const double u = randomUniform();
        EXPECT_GE(u, 0.0);
        EXPECT_LT(u, 1.0);
    }
}
