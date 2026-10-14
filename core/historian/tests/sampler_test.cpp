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

// ---------------------------------------------------------------------------------------------
// Feature 010 (specs/010-history-reports) US1: `trigger` groups and the combined mode.

namespace {
LoggingGroupModel triggerGroup(TriggerEdge edge, int64_t minMs, int64_t periodMs = 0,
                               TagType type = TagType::BOOL, double threshold = 0) {
    LoggingGroupModel g;
    g.id = "g";
    g.table = "g";
    g.mode = LogMode::Trigger;
    g.minIntervalMs = minMs;
    g.periodMs = periodMs;
    g.trigger = TriggerModel{"T.TRIG", 9, type, edge, threshold};
    g.columns.push_back({"T.WEIGHT", 0, TagType::FLOAT64, "WEIGHT", 0.0, 255});
    return g;
}

// A driver that also feeds the trigger tag; the trigger value is separate from the columns.
struct TDriver {
    GroupSampler s;
    SamplerStats stats;
    int64_t wall;
    int64_t mono = 0;
    uint64_t rev = 1;
    std::vector<LogRow> rows;
    std::vector<TagValue> cols{good(5.0, 1)};
    TagValue trig = good(false, 1);
    TDriver(const LoggingGroupModel& g, int64_t start) : s(g, 0, kVn), wall(start) {}
    void tick() {
        if (auto r = s.tick(wall, mono, cols, &trig, stats)) rows.push_back(*r);
        wall += 100;
        mono += 100;
    }
    void run(int n) {
        for (int i = 0; i < n; ++i) tick();
    }
    void set(TagScalar v, Quality q = Quality::GOOD) {
        trig = good(std::move(v), ++rev);
        trig.quality = q;
    }
};
}  // namespace

TEST(SamplerTrigger, RisingWritesOneRowPerRisingEdgeWithAllColumns) {
    TDriver d(triggerGroup(TriggerEdge::Rising, 1000), kT0);
    d.run(20);  // 2 s off: nothing, and no baseline row
    EXPECT_TRUE(d.rows.empty());
    d.set(true);
    d.cols[0] = good(7.5, 2);
    d.tick();
    ASSERT_EQ(d.rows.size(), 1u);
    EXPECT_DOUBLE_EQ(std::get<double>(d.rows[0].cells[0]), 7.5);
    d.run(30);  // stays on: no more rows
    EXPECT_EQ(d.rows.size(), 1u);
    d.set(false);
    d.run(30);  // falling edge is not a rising edge
    EXPECT_EQ(d.rows.size(), 1u);
    d.set(true);
    d.tick();
    EXPECT_EQ(d.rows.size(), 2u);
}

TEST(SamplerTrigger, FallingAndBoth) {
    {
        TDriver d(triggerGroup(TriggerEdge::Falling, 1000), kT0);
        d.set(true);
        d.run(20);  // starts on: no edge at start
        EXPECT_TRUE(d.rows.empty());
        d.set(false);
        d.tick();
        EXPECT_EQ(d.rows.size(), 1u);
    }
    {
        TDriver d(triggerGroup(TriggerEdge::Both, 1000), kT0);
        d.run(5);
        d.set(true);
        d.run(15);  // 1.5 s later
        d.set(false);
        d.run(15);
        EXPECT_EQ(d.rows.size(), 2u);
    }
}

TEST(SamplerTrigger, NumericTagUsesTheThreshold) {
    TDriver d(triggerGroup(TriggerEdge::Rising, 1000, 0, TagType::FLOAT64, 50.0), kT0);
    d.set(10.0);
    d.run(5);
    d.set(50.0);  // not greater than the threshold
    d.run(5);
    EXPECT_TRUE(d.rows.empty());
    d.set(50.5);
    d.tick();
    EXPECT_EQ(d.rows.size(), 1u);
}

TEST(SamplerTrigger, BadQualityIsOffAndMakesNoEdge) {
    TDriver d(triggerGroup(TriggerEdge::Both, 1000), kT0);
    d.set(true);
    d.run(5);  // starts on
    EXPECT_TRUE(d.rows.empty());
    d.set(true, Quality::BAD);  // on -> off by quality: no falling edge
    d.run(20);
    EXPECT_TRUE(d.rows.empty());
    EXPECT_EQ(d.s.triggerState(), TriggerState::Unknown);
    d.set(true);  // good again and on: a rising edge
    d.tick();
    EXPECT_EQ(d.rows.size(), 1u);
    EXPECT_EQ(d.s.triggerState(), TriggerState::Active);
}

TEST(SamplerTrigger, ActiveWritesEveryPeriodWhileOnAndOnceWhenItEnds) {
    TDriver d(triggerGroup(TriggerEdge::Active, 100, 2000), kT0);
    d.run(5);
    d.set(true);
    d.tick();  // rising edge: first row at once
    ASSERT_EQ(d.rows.size(), 1u);
    d.run(61);  // 6.1 s on: rows at +2 s, +4 s, +6 s
    EXPECT_EQ(d.rows.size(), 4u);
    d.set(false);
    d.tick();
    EXPECT_EQ(d.rows.size(), 5u);  // the falling edge
    d.run(50);
    EXPECT_EQ(d.rows.size(), 5u);
    EXPECT_EQ(d.s.triggerState(), TriggerState::Inactive);
}

TEST(SamplerTrigger, ActiveAlreadyOnAtStartRowsByPeriodWithoutAnEdgeRow) {
    TDriver d(triggerGroup(TriggerEdge::Active, 100, 2000), kT0);
    d.set(true);
    d.run(19);
    EXPECT_TRUE(d.rows.empty());
    d.run(2);  // 2.1 s
    EXPECT_EQ(d.rows.size(), 1u);
}

TEST(SamplerTrigger, MinIntervalDelaysTheEdgeAndCarriesTheNewestValues) {
    TDriver d(triggerGroup(TriggerEdge::Both, 5000), kT0);
    d.run(2);
    d.set(true);
    d.tick();
    ASSERT_EQ(d.rows.size(), 1u);  // first row is never held back
    d.set(false);
    d.cols[0] = good(9.0, 2);
    d.run(10);  // 1 s later: still held
    EXPECT_EQ(d.rows.size(), 1u);
    d.cols[0] = good(11.0, 3);
    d.run(45);  // 5.5 s after the first row
    ASSERT_EQ(d.rows.size(), 2u);
    EXPECT_GE(d.rows[1].tsUtc - d.rows[0].tsUtc, 5000);
    EXPECT_DOUBLE_EQ(std::get<double>(d.rows[1].cells[0]), 11.0);
}

TEST(SamplerTrigger, ShortPulseAlwaysWritesAndFlickerIsLimited) {
    {
        TDriver d(triggerGroup(TriggerEdge::Rising, 1000), kT0);
        d.run(3);
        d.set(true);
        d.run(3);  // 300 ms pulse
        d.set(false);
        d.run(10);
        EXPECT_EQ(d.rows.size(), 1u);
    }
    {
        TDriver d(triggerGroup(TriggerEdge::Both, 1000), kT0);
        for (int i = 0; i < 100; ++i) {  // flickers every 200 ms for 20 s
            d.set(i % 2 == 0);
            d.run(2);
        }
        EXPECT_LE(d.rows.size(), 21u);  // at most one row per minIntervalMs
        EXPECT_GE(d.rows.size(), 15u);
    }
}

TEST(SamplerHybrid, ChangeResetsTheCounterAndSilenceGivesRowsEveryMaxInterval) {
    Driver d(onChange(1000, 5000), kT0);
    std::vector<TagValue> v{good(1.0, 1), good(true, 1), good(std::string("A"), 1)};
    d.tick(v);  // baseline
    d.run(40, v);
    v[0] = good(9.0, 2);  // change at 4.1 s: row at once, counter restarts
    d.tick(v);
    ASSERT_EQ(d.rows.size(), 2u);
    const int64_t changeAt = d.rows[1].tsUtc;
    d.run(5000, v);  // 500 s of silence
    ASSERT_GE(d.rows.size(), 100u);
    EXPECT_NEAR(static_cast<double>(d.rows[2].tsUtc - changeAt), 5000.0, 250.0);
    for (size_t i = 3; i < d.rows.size(); ++i)
        EXPECT_NEAR(static_cast<double>(d.rows[i].tsUtc - d.rows[i - 1].tsUtc), 5000.0, 250.0);
}
