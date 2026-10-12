// Fixed UTC offsets, local time text and cyclic alignment (specs/003-data-logging research R5).
#include "core/historian/clock.hpp"

#include <gtest/gtest.h>

using namespace mat;

namespace {
// 2026-10-10T01:00:00.000Z
constexpr int64_t kT0 = 1791594000000;
constexpr int kVn = 7 * 60;
}  // namespace

TEST(Clock, ParsesFixedOffsets) {
    EXPECT_EQ(parseUtcOffset("+07:00"), 420);
    EXPECT_EQ(parseUtcOffset("-03:30"), -210);
    EXPECT_EQ(parseUtcOffset("+14:00"), 840);
    EXPECT_EQ(parseUtcOffset("-12:00"), -720);
    EXPECT_EQ(parseUtcOffset("+00:00"), 0);
    for (const char* bad :
         {"7", "+7:00", "+07:60", "+15:00", "-13:00", "", "+07:00x", "07:00", "+14:30", "+0700"})
        EXPECT_FALSE(parseUtcOffset(bad).has_value()) << bad;
    EXPECT_EQ(formatUtcOffset(420), "+07:00");
    EXPECT_EQ(formatUtcOffset(-210), "-03:30");
    EXPECT_EQ(formatUtcOffset(0), "+00:00");
}

TEST(Clock, FormatsLocalTime) {
    EXPECT_EQ(formatLocalTime(kT0 + 123, kVn), "2026-10-10 08:00:00.123");
    EXPECT_EQ(formatLocalTime(kT0 + 123, kVn, 'T'), "2026-10-10T08:00:00.123");
    // 20:30 UTC + 7 h rolls into the next day
    EXPECT_EQ(formatLocalTime(kT0 + 19 * 3600000LL + 1800000, kVn), "2026-10-11 03:30:00.000");
    // 2026-01-01T01:00Z at -03:30 rolls back into the previous year
    EXPECT_EQ(formatLocalTime(1767229200000, -210), "2025-12-31 21:30:00.000");
    // leap day 2028-02-29T12:00Z
    EXPECT_EQ(formatLocalTime(1835438400000, 0), "2028-02-29 12:00:00.000");
}

TEST(Clock, ParsesLocalTimeForTheCli) {
    EXPECT_EQ(parseLocalTime("2026-10-10 08:00", kVn), kT0);
    EXPECT_EQ(parseLocalTime("2026-10-10 08:00:01", kVn), kT0 + 1000);
    EXPECT_EQ(parseLocalTime("2026-10-10", kVn), kT0 - 8 * 3600000LL);
    for (const char* bad : {"2026-13-01", "2026-10-10 25:00", "2026-02-30", "abc",
                            "2026-10-10T08:00", "2026-10-10 08:00:60", ""})
        EXPECT_FALSE(parseLocalTime(bad, kVn).has_value()) << bad;
}

TEST(Clock, AlignsPeriodsThatDivideADayToLocalMidnight) {
    const int64_t now = kT0 + 30500;                                // local 08:00:30.500
    EXPECT_EQ(alignedNext(now, 60000, kVn, now), kT0 + 60000);      // second 0
    EXPECT_EQ(alignedNext(now, 3600000, kVn, now), kT0 + 3600000);  // local 09:00
    EXPECT_EQ(alignedNext(now, 8 * 3600000LL, kVn, now), kT0 + 8 * 3600000LL);  // local 16:00
    // strictly after: exactly on a boundary gives the next one
    EXPECT_EQ(alignedNext(kT0 + 60000, 60000, kVn, now), kT0 + 120000);
    // 100 ms periods line up on the 100 ms grid
    EXPECT_EQ(alignedNext(kT0 + 150, 100, kVn, kT0), kT0 + 200);
}

TEST(Clock, OtherPeriodsCountFromTheAnchor) {
    const int64_t anchor = kT0 + 1234;
    EXPECT_EQ(alignedNext(anchor, 7000, kVn, anchor), anchor + 7000);
    EXPECT_EQ(alignedNext(anchor + 7000, 7000, kVn, anchor), anchor + 14000);
    EXPECT_EQ(alignedNext(anchor + 13999, 7000, kVn, anchor), anchor + 14000);
    EXPECT_EQ(alignedNext(anchor - 5000, 7000, kVn, anchor), anchor);  // before the anchor
}

TEST(Clock, FloorIsTheBuildTime) {
    EXPECT_GT(clockFloorMs(), 1767225600000);  // built after 2026-01-01
    EXPECT_TRUE(clockValid(clockFloorMs()));
    EXPECT_FALSE(clockValid(clockFloorMs() - 1));
    EXPECT_FALSE(clockValid(0));  // RTC lost: 1970
}
