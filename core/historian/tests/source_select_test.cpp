// Choice of the answering table (specs/010-history-reports contracts/history-api.md §3.1).
#include "core/historian/query/source_select.hpp"

#include <gtest/gtest.h>

using namespace mat;

namespace {
constexpr int64_t kHour = 3600000;
constexpr int64_t kDay = 24 * kHour;

SourceInput in(int64_t span) {
    SourceInput i;
    i.from = 1000 * kDay;
    i.to = i.from + span;
    i.maxPoints = 1000;
    i.groupHasAggregates = true;
    i.hourCoverage = 1;
    i.minuteCoverage = 1;
    i.scanBytes = 10LL << 20;
    return i;
}
}  // namespace

TEST(SourceSelect, WideWindowsUseTheHourTable) {
    // 30 days / 500 = 86 min per window >= 1 h
    const auto c = chooseSource(in(30 * kDay));
    EXPECT_EQ(c.res, SourceRes::Hour);
    EXPECT_TRUE(c.error.empty());
    EXPECT_FALSE(c.approximate);
}

TEST(SourceSelect, MediumWindowsUseTheMinuteTable) {
    EXPECT_EQ(chooseSource(in(kDay)).res, SourceRes::Minute);  // 172 s per window
    EXPECT_EQ(chooseSource(in(10 * kHour)).res, SourceRes::Minute);
}

TEST(SourceSelect, NarrowWindowsUseTheRawRows) {
    // 1 h / 500 = 7.2 s per window < 1 min
    const auto c = chooseSource(in(kHour));
    EXPECT_EQ(c.res, SourceRes::Raw);
    EXPECT_EQ(c.reduce, ReduceParam::MinMax);
}

TEST(SourceSelect, ATableThatCoversLessThanHalfIsNotUsed) {
    auto i = in(30 * kDay);
    i.hourCoverage = 0.49;
    EXPECT_EQ(chooseSource(i).res, SourceRes::Minute);  // the minute table covers
    i.minuteCoverage = 0.3;
    EXPECT_EQ(chooseSource(i).res, SourceRes::Raw);  // raw fits the scan limit
    i.hourCoverage = 0.5;                            // exactly half covers
    EXPECT_EQ(chooseSource(i).res, SourceRes::Hour);
}

TEST(SourceSelect, GroupsWithoutAggregatesNeverUseThem) {
    auto i = in(30 * kDay);
    i.groupHasAggregates = false;
    EXPECT_EQ(chooseSource(i).res, SourceRes::Raw);
}

TEST(SourceSelect, TooMuchRawWithoutAggregatesIsDecimatedAndApproximate) {
    auto i = in(30 * kDay);
    i.groupHasAggregates = false;
    i.scanBytes = 200LL << 20;
    const auto c = chooseSource(i);
    EXPECT_EQ(c.res, SourceRes::Raw);
    EXPECT_EQ(c.reduce, ReduceParam::Decimate);
    EXPECT_TRUE(c.approximate);
    EXPECT_TRUE(c.error.empty());
}

TEST(SourceSelect, TooMuchRawWithAggregatesFallsBackToThem) {
    auto i = in(kHour);  // narrow, would be raw
    i.scanBytes = 200LL << 20;
    EXPECT_EQ(chooseSource(i).res, SourceRes::Minute);
    i.minuteCoverage = 0;
    EXPECT_EQ(chooseSource(i).res, SourceRes::Hour);
}

TEST(SourceSelect, ExplicitResolutionIsHonouredOrRefused) {
    auto i = in(30 * kDay);
    i.res = ResParam::Raw;
    i.scanBytes = 200LL << 20;
    EXPECT_EQ(chooseSource(i).error, "SCAN_LIMIT");
    i.scanBytes = 1;
    EXPECT_TRUE(chooseSource(i).error.empty());
    EXPECT_EQ(chooseSource(i).res, SourceRes::Raw);
    i.res = ResParam::Minute;
    EXPECT_EQ(chooseSource(i).res, SourceRes::Minute);
    i.res = ResParam::Hour;
    EXPECT_EQ(chooseSource(i).res, SourceRes::Hour);
    i.groupHasAggregates = false;
    EXPECT_EQ(chooseSource(i).error, "NO_AGGREGATES");
    i.res = ResParam::Minute;
    EXPECT_EQ(chooseSource(i).error, "NO_AGGREGATES");
}

TEST(SourceSelect, TheScanLimitIsConfigurable) {
    auto i = in(kHour);
    i.res = ResParam::Raw;
    i.scanBytes = 10LL << 20;
    i.scanLimitBytes = 8LL << 20;
    EXPECT_EQ(chooseSource(i).error, "SCAN_LIMIT");
    i.scanLimitBytes = 16LL << 20;
    EXPECT_TRUE(chooseSource(i).error.empty());
}

TEST(SourceSelect, Names) {
    EXPECT_STREQ(sourceResName(SourceRes::Raw), "raw");
    EXPECT_STREQ(sourceResName(SourceRes::Minute), "1m");
    EXPECT_STREQ(sourceResName(SourceRes::Hour), "1h");
}
