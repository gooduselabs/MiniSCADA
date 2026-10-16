// Timers ton/tof/tp (T126, C++ half; FR-085; contracts/logic-engine.md §3), as
// packages/logic-engine/src/timers.test.ts: truth tables, error <= one scan + 20 ms, an unknown
// input holds the outputs and stops the count, pt below scanMs rounded up.
#include <gtest/gtest.h>

#include "core/logic/tests/test_util.hpp"

using namespace mat;
using namespace mat::logic;
using namespace mat::logic::test;

namespace {

std::unique_ptr<Harness> make(const std::string& kind, int pt, int scanMs = 100) {
    Config c;
    c.scanMs = scanMs;
    return makeHarness(json{{"schemaVersion", "1.0.0"},
                            {"timers", json::array({{{"id", "t"},
                                                     {"kind", kind},
                                                     {"in", "IN"},
                                                     {"pt", pt},
                                                     {"q", "L.Q"},
                                                     {"et", "L.ET"}}})}},
                       {{"IN", tagInfo(TagType::BOOL)}}, c);
}

json qe(Harness& h) { return json::array({value(h, "L.Q"), value(h, "L.ET")}); }
json pair(bool q, int et) { return json::array({q, et}); }

}  // namespace

TEST(Ton, TruthTable) {
    auto h = make("ton", 500);
    setB(*h, "IN", false);
    h->runTo(900);
    EXPECT_EQ(qe(*h), pair(false, 0));
    setB(*h, "IN", true);
    h->runTo(1000);
    EXPECT_EQ(qe(*h), pair(false, 0));
    h->runTo(1400);
    EXPECT_EQ(qe(*h), pair(false, 400));
    h->runTo(1500);
    EXPECT_EQ(qe(*h), pair(true, 500));
    h->runTo(3000);
    EXPECT_EQ(qe(*h), pair(true, 500));
    setB(*h, "IN", false);
    h->runTo(3100);
    EXPECT_EQ(qe(*h), pair(false, 0));
}

TEST(Ton, PulseShorterThanPtNeverSetsQ) {
    auto h = make("ton", 500);
    setB(*h, "IN", true);
    h->runTo(400);
    setB(*h, "IN", false);
    h->runTo(1000);
    EXPECT_EQ(qe(*h), pair(false, 0));
}

TEST(Ton, ErrorAtMostOneScanPlus20Ms) {
    for (int pt : {101, 150, 250, 999, 1001, 4321}) {
        auto h = make("ton", pt);
        setB(*h, "IN", false);
        h->runTo(0);
        setB(*h, "IN", true);
        int64_t t = 100;
        h->runTo(t);
        while (value(*h, "L.Q") != json(true)) h->runTo(t += 100);
        EXPECT_GE(t - 100, pt);
        EXPECT_LE(t - 100 - pt, 100 + 20) << pt;
    }
}

TEST(Ton, UnknownInputHoldsAndStopsThenResumes) {
    auto h = make("ton", 1000);
    setB(*h, "IN", true);
    h->runTo(500);
    EXPECT_EQ(qe(*h), pair(false, 500));
    setBad(*h, "IN");
    h->runTo(5000);
    EXPECT_EQ(qe(*h), pair(false, 500));
    EXPECT_TRUE(h->state("t")->degraded);
    setB(*h, "IN", true);
    h->runTo(5100);
    EXPECT_FALSE(h->state("t")->degraded);
    EXPECT_EQ(qe(*h), pair(false, 500));
    h->runTo(5600);
    EXPECT_EQ(qe(*h), pair(true, 1000));
}

TEST(Ton, PtBelowScanRoundedUp) {
    auto h = make("ton", 30, 100);
    setB(*h, "IN", true);
    h->runTo(0);
    EXPECT_EQ(qe(*h), pair(false, 0));
    h->runTo(100);
    EXPECT_EQ(qe(*h), pair(true, 100));
}

TEST(Ton, BeforeTheFirstScanFalseZeroGood) {
    auto h = make("ton", 500);
    ASSERT_NE(h->output("L.Q"), nullptr);
    EXPECT_TRUE(h->output("L.Q")->good);
    EXPECT_EQ(scalarJson(h->output("L.Q")->value), json(false));
    EXPECT_EQ(scalarJson(h->output("L.ET")->value), json(0));
}

TEST(Tof, TruthTable) {
    auto h = make("tof", 500);
    setB(*h, "IN", false);
    h->runTo(0);
    EXPECT_EQ(qe(*h), pair(false, 0));
    setB(*h, "IN", true);
    h->runTo(1000);
    EXPECT_EQ(qe(*h), pair(true, 0));
    setB(*h, "IN", false);
    h->runTo(1100);
    EXPECT_EQ(qe(*h), pair(true, 0));
    h->runTo(1400);
    EXPECT_EQ(qe(*h), pair(true, 300));
    setB(*h, "IN", true);
    h->runTo(1500);
    EXPECT_EQ(qe(*h), pair(true, 0));
    setB(*h, "IN", false);
    h->runTo(1600);
    h->runTo(2000);
    EXPECT_EQ(qe(*h), pair(true, 400));
    h->runTo(2100);
    EXPECT_EQ(qe(*h), pair(false, 500));
    h->runTo(5000);
    EXPECT_EQ(qe(*h), pair(false, 500));
}

TEST(Tp, FullPulseWhateverTheInputNoRetrigger) {
    auto h = make("tp", 500);
    setB(*h, "IN", false);
    h->runTo(0);
    setB(*h, "IN", true);
    h->runTo(100);
    EXPECT_EQ(qe(*h), pair(true, 0));
    setB(*h, "IN", false);
    h->runTo(200);
    setB(*h, "IN", true);
    h->runTo(300);
    EXPECT_EQ(qe(*h), pair(true, 200));
    h->runTo(500);
    EXPECT_EQ(qe(*h), pair(true, 400));
    h->runTo(600);
    EXPECT_EQ(qe(*h), pair(false, 500));
    h->runTo(1000);
    EXPECT_EQ(qe(*h), pair(false, 500));
    setB(*h, "IN", false);
    h->runTo(1100);
    EXPECT_EQ(qe(*h), pair(false, 0));
    setB(*h, "IN", true);
    h->runTo(1200);
    EXPECT_EQ(qe(*h), pair(true, 0));
}

TEST(Tp, TrueAtTheFirstScanIsARisingEdge) {
    auto h = make("tp", 300);
    setB(*h, "IN", true);
    h->runTo(0);
    EXPECT_EQ(qe(*h), pair(true, 0));
    h->runTo(300);
    EXPECT_EQ(qe(*h), pair(false, 300));
}

TEST(Timers, NotRetained) {
    auto h = make("ton", 500);
    EXPECT_TRUE(h->retainSnapshot().empty());
}
