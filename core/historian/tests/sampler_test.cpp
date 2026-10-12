// When does a logging group write a row (specs/003-data-logging research R5, R6; spec US1).
// Pure functions driven by fake clocks: no thread, no SQLite.
#include "core/historian/sampler.hpp"

#include <gtest/gtest.h>

#include <cmath>
#include <limits>

using namespace mat;

namespace {
constexpr int64_t kT0 = 1791594000000;  // 2026-10-10T01:00:00Z = 08:00 at +07:00
constexpr int kVn = 420;

LoggingGroupModel cyclic(int64_t periodMs) {
    LoggingGroupModel g;
    g.id = "g";
    g.table = "g";
    g.mode = LogMode::Cyclic;
    g.periodMs = periodMs;
    g.columns.push_back({"T.V", 0, TagType::FLOAT64, "V", 0.0, 255});
    return g;
}

LoggingGroupModel onChange(int64_t minMs, int64_t maxMs) {
    LoggingGroupModel g;
    g.id = "g";
    g.table = "g";
    g.mode = LogMode::OnChange;
    g.minIntervalMs = minMs;
    g.maxIntervalMs = maxMs;
    g.columns.push_back({"T.LEVEL", 0, TagType::FLOAT32, "LEVEL", 0.5, 255});
    g.columns.push_back({"T.RUN", 1, TagType::BOOL, "RUN", 0.0, 255});
    g.columns.push_back({"T.NAME", 2, TagType::STRING, "NAME", 0.0, 255});
    return g;
}

TagValue good(TagScalar v, uint64_t rev) {
    TagValue t;
    t.value = std::move(v);
    t.quality = Quality::GOOD;
    t.revision = rev;
    return t;
}

// Drives a sampler with a 100 ms tick; wall and monotonic clocks advance together.
struct Driver {
    GroupSampler s;
    SamplerStats stats;
    int64_t wall;
    int64_t mono = 0;
    std::vector<LogRow> rows;
    Driver(const LoggingGroupModel& g, int64_t start) : s(g, 0, kVn), wall(start) {}
    void tick(const std::vector<TagValue>& v) {
        if (auto r = s.tick(wall, mono, v, stats)) rows.push_back(*r);
        wall += 100;
        mono += 100;
    }
    void run(int ticks, const std::vector<TagValue>& v) {
        for (int i = 0; i < ticks; ++i) tick(v);
    }
};
}  // namespace

TEST(Sampler, CyclicRowsLandOnSecondZero) {
    Driver d(cyclic(60000), kT0 + 30500);  // local 08:00:30.500
    d.run(6000, {good(1.0, 1)});           // 10 minutes
    ASSERT_EQ(d.rows.size(), 10u);
    for (size_t i = 0; i < d.rows.size(); ++i) {
        const int64_t slot = kT0 + 60000 * static_cast<int64_t>(i + 1);
        EXPECT_GE(d.rows[i].tsUtc, slot);
        EXPECT_LT(d.rows[i].tsUtc, slot + 100);
        ASSERT_EQ(d.rows[i].cells.size(), 1u);
        EXPECT_DOUBLE_EQ(std::get<double>(d.rows[i].cells[0]), 1.0);
    }
    EXPECT_EQ(d.stats.clockJumps, 0u);
}

TEST(Sampler, ForwardClockJumpWritesOneRowThenRealigns) {
    Driver d(cyclic(1000), kT0);
    d.run(25, {good(1.0, 1)});  // 2.5 s → rows at +1 s, +2 s
    ASSERT_EQ(d.rows.size(), 2u);
    d.wall += 3600000;  // NTP moves the clock 1 h forward between two ticks
    d.tick({good(1.0, 1)});
    ASSERT_EQ(d.rows.size(), 3u);  // exactly one row, no catch-up burst
    EXPECT_EQ(d.stats.clockJumps, 1u);
    d.run(10, {good(1.0, 1)});  // 1 s later: back on the 1 s grid
    ASSERT_EQ(d.rows.size(), 4u);
    EXPECT_EQ(d.rows[3].tsUtc % 1000, 0);
}

TEST(Sampler, BackwardClockJumpKeepsLoggingOnTheNewTimeline) {
    Driver d(cyclic(1000), kT0);
    d.run(30, {good(1.0, 1)});
    const size_t before = d.rows.size();
    const int64_t lastTs = d.rows.back().tsUtc;
    d.wall -= 3600000;  // clock set back 1 h
    d.run(30, {good(1.0, 1)});
    EXPECT_EQ(d.stats.clockJumps, 1u);
    ASSERT_GE(d.rows.size(), before + 2);
    EXPECT_LT(d.rows.back().tsUtc, lastTs);  // earlier timestamps are allowed
    for (size_t i = before + 1; i < d.rows.size(); ++i)
        EXPECT_EQ(d.rows[i].tsUtc - d.rows[i - 1].tsUtc, 1000);  // one row per second, no burst
}

TEST(Sampler, OnChangeWritesBaselineAtStart) {
    Driver d(onChange(1000, 0), kT0);
    d.tick({good(10.0, 1), good(true, 1), good(std::string("A"), 1)});
    ASSERT_EQ(d.rows.size(), 1u);
    EXPECT_DOUBLE_EQ(std::get<double>(d.rows[0].cells[0]), 10.0);
    EXPECT_EQ(std::get<bool>(d.rows[0].cells[1]), true);
    EXPECT_EQ(std::get<std::string>(d.rows[0].cells[2]), "A");
}

TEST(Sampler, DeadbandComparesWithTheLoggedValue) {
    Driver d(onChange(1000, 0), kT0);
    std::vector<TagValue> v{good(10.0, 1), good(true, 1), good(std::string("A"), 1)};
    d.tick(v);
    d.run(15, v);
    v[0] = good(10.3, 2);  // +0.3: within deadband 0.5
    d.run(15, v);
    EXPECT_EQ(d.rows.size(), 1u);
    v[0] = good(10.5, 3);  // +0.5 exactly: still not greater than the deadband
    d.run(15, v);
    EXPECT_EQ(d.rows.size(), 1u);
    v[0] = good(10.7, 4);  // +0.7 vs the LOGGED 10.0
    d.run(15, v);
    ASSERT_EQ(d.rows.size(), 2u);
    EXPECT_DOUBLE_EQ(std::get<double>(d.rows[1].cells[0]), 10.7);
}

TEST(Sampler, BoolStringAndQualityChangesCount) {
    Driver d(onChange(1000, 0), kT0);
    std::vector<TagValue> v{good(10.0, 1), good(true, 1), good(std::string("A"), 1)};
    d.tick(v);
    d.run(15, v);
    v[1] = good(false, 2);
    d.run(15, v);
    EXPECT_EQ(d.rows.size(), 2u);
    v[2] = good(std::string("B"), 2);
    d.run(15, v);
    EXPECT_EQ(d.rows.size(), 3u);
    v[0].quality = Quality::BAD;  // GOOD → BAD is a change; the cell is empty
    v[0].revision = 5;
    d.run(15, v);
    ASSERT_EQ(d.rows.size(), 4u);
    EXPECT_TRUE(std::holds_alternative<std::monostate>(d.rows[3].cells[0]));
    v[0].value = 99.0;  // value moves while still BAD: no row
    v[0].revision = 6;
    d.run(15, v);
    EXPECT_EQ(d.rows.size(), 4u);
}

TEST(Sampler, MinIntervalKeepsTheLatestValue) {
    Driver d(onChange(1000, 0), kT0);
    std::vector<TagValue> v{good(0.0, 1), good(true, 1), good(std::string("A"), 1)};
    d.tick(v);                       // baseline at t=0
    for (int i = 1; i <= 10; ++i) {  // 10 changes within the next second
        v[0] = good(i * 1.0, 1 + static_cast<uint64_t>(i));
        d.tick(v);
    }
    d.run(5, v);
    ASSERT_EQ(d.rows.size(), 2u);  // baseline + one row
    EXPECT_GE(d.rows[1].tsUtc - d.rows[0].tsUtc, 1000);
    EXPECT_DOUBLE_EQ(std::get<double>(d.rows[1].cells[0]), 10.0);
}

TEST(Sampler, MaxIntervalWritesHeartbeatRows) {
    Driver d(onChange(1000, 60000), kT0);
    d.run(3001, {good(1.0, 1), good(true, 1), good(std::string("A"), 1)});  // 0 … 300 s, no change
    ASSERT_EQ(d.rows.size(), 6u);                                           // baseline + every 60 s
    for (size_t i = 1; i < d.rows.size(); ++i)
        EXPECT_EQ(d.rows[i].tsUtc - d.rows[i - 1].tsUtc, 60000);
}

TEST(Sampler, CellConversion) {
    SamplerStats st;
    LoggedColumn f{"F", 0, TagType::FLOAT32, "F", 0, 255};
    EXPECT_TRUE(std::holds_alternative<std::monostate>(
        toCell(good(std::numeric_limits<double>::quiet_NaN(), 1), f, st)));
    EXPECT_TRUE(std::holds_alternative<std::monostate>(
        toCell(good(std::numeric_limits<double>::infinity(), 1), f, st)));
    TagValue bad = good(1.0, 1);
    bad.quality = Quality::UNCERTAIN;
    EXPECT_TRUE(std::holds_alternative<std::monostate>(toCell(bad, f, st)));

    LoggedColumn i16{"I", 0, TagType::INT16, "I", 0, 255};
    EXPECT_EQ(std::get<int64_t>(toCell(good(12.6, 1), i16, st)), 13);
    LoggedColumn u64{"U", 0, TagType::UINT64, "U", 0, 255};
    EXPECT_EQ(std::get<uint64_t>(toCell(good(uint64_t{18446744073709551615ULL}, 1), u64, st)),
              18446744073709551615ULL);
    LoggedColumn b{"B", 0, TagType::BOOL, "B", 0, 255};
    EXPECT_EQ(std::get<bool>(toCell(good(true, 1), b, st)), true);

    LoggedColumn s{"S", 0, TagType::STRING, "S", 0, 3};
    EXPECT_EQ(std::get<std::string>(toCell(good(std::string("ệệệệ"), 1), s, st)), "ệệệ");
    EXPECT_EQ(st.stringsTruncated, 1u);
    EXPECT_EQ(std::get<std::string>(toCell(good(std::string("abc"), 1), s, st)), "abc");
    EXPECT_EQ(st.stringsTruncated, 1u);
}

// Security review M1: broken UTF-8 is repaired, and stray continuation bytes no longer slip past
// maxLength ("A" + 1 MB of 0x80 used to count as one character).
TEST(Sampler, StringsAreValidUtf8AndBounded) {
    SamplerStats st;
    LoggedColumn s{"S", 0, TagType::STRING, "S", 0, 10};
    const std::string fixed = std::get<std::string>(toCell(good(std::string("OK\xC3"), 1), s, st));
    EXPECT_EQ(fixed, "OK\xEF\xBF\xBD");
    const std::string big =
        std::get<std::string>(toCell(good("A" + std::string(1 << 20, '\x80'), 1), s, st));
    EXPECT_LE(big.size(), 10u * 3);
    EXPECT_EQ(st.stringsTruncated, 1u);
}
