// Write bytes of the runtime process over 24 hours (specs/010-history-reports
// contracts/device-010.md §1 "io"): a ring of 1,440 one-minute cells fed by an injected source of
// write_bytes.
#include "core/historian/io_meter.hpp"

#include <gtest/gtest.h>

using namespace mat;

namespace {
constexpr int64_t kMin = 60000;

struct Fixture {
    int64_t counter = 1000;
    bool ok = true;
    IoMeter m{[this]() -> std::optional<int64_t> {
        if (!ok) return std::nullopt;
        return counter;
    }};
    void minutes(int n, int64_t bytesPerMinute, int64_t& mono) {
        for (int i = 0; i < n; ++i) {
            mono += kMin;
            counter += bytesPerMinute;
            m.sample(mono);
        }
    }
};
}  // namespace

TEST(IoMeter, NoNumbersBeforeTheFirstFullMinute) {
    Fixture f;
    int64_t mono = 0;
    f.m.sample(mono);
    const auto s = f.m.snapshot();
    EXPECT_TRUE(s.available);
    EXPECT_EQ(s.coverageS, 0);
    EXPECT_EQ(s.writeBytes24h, 0);
    EXPECT_FALSE(s.bytesPerDay.has_value());
}

TEST(IoMeter, HourAndDayWindowsAndExtrapolation) {
    Fixture f;
    int64_t mono = 0;
    f.m.sample(mono);
    f.minutes(30, 1000, mono);
    auto s = f.m.snapshot();
    EXPECT_EQ(s.writeBytes1h, 30000);
    EXPECT_EQ(s.writeBytes24h, 30000);
    EXPECT_EQ(s.coverageS, 1800);
    ASSERT_TRUE(s.bytesPerDay.has_value());
    EXPECT_EQ(*s.bytesPerDay, 30000LL * 86400 / 1800);  // 1000 B/min -> 1,440,000 B/day

    f.minutes(120, 2000, mono);  // 2 h more at 2000 B/min: the hour window holds only these
    s = f.m.snapshot();
    EXPECT_EQ(s.writeBytes1h, 60 * 2000);
    EXPECT_EQ(s.writeBytes24h, 30 * 1000 + 120 * 2000);
    EXPECT_EQ(s.coverageS, 150 * 60);
}

TEST(IoMeter, FewerThanTenMinutesGiveNoDailyFigure) {
    Fixture f;
    int64_t mono = 0;
    f.m.sample(mono);
    f.minutes(9, 500, mono);
    EXPECT_FALSE(f.m.snapshot().bytesPerDay.has_value());
    f.minutes(1, 500, mono);
    EXPECT_TRUE(f.m.snapshot().bytesPerDay.has_value());  // coverage 600 s
}

TEST(IoMeter, RingKeepsOnly1440Cells) {
    Fixture f;
    int64_t mono = 0;
    f.m.sample(mono);
    f.minutes(1440, 10, mono);
    f.minutes(60, 20, mono);  // the oldest 60 cells fall out
    const auto s = f.m.snapshot();
    EXPECT_EQ(s.coverageS, 86400);
    EXPECT_EQ(s.writeBytes24h, 1380 * 10 + 60 * 20);
}

TEST(IoMeter, SamplesOnlyEverySixtySeconds) {
    Fixture f;
    int64_t mono = 0;
    f.m.sample(mono);
    for (int i = 1; i <= 599; ++i) {  // 100 ms passes for 59.9 s
        f.counter += 1;
        f.m.sample(mono + i * 100);
    }
    EXPECT_EQ(f.m.snapshot().coverageS, 0);
    f.m.sample(mono + 60000);
    EXPECT_EQ(f.m.snapshot().coverageS, 60);
}

TEST(IoMeter, UnavailableSourceGivesNoNumbers) {
    Fixture f;
    f.ok = false;
    int64_t mono = 0;
    f.m.sample(mono);
    f.minutes(5, 100, mono);
    const auto s = f.m.snapshot();
    EXPECT_FALSE(s.available);
    EXPECT_EQ(s.coverageS, 0);
    EXPECT_FALSE(s.bytesPerDay.has_value());
}

TEST(IoMeter, CounterThatGoesBackIsRebased) {
    Fixture f;
    int64_t mono = 0;
    f.m.sample(mono);
    f.minutes(2, 1000, mono);
    f.counter = 10;  // the process was replaced / counter reset
    f.minutes(1, 0, mono);
    f.minutes(1, 500, mono);
    EXPECT_EQ(f.m.snapshot().writeBytes24h, 2000 + 0 + 500);
}
