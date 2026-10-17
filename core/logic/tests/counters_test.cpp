// Counter (T126, C++ half; FR-086; contracts/logic-engine.md §4), as
// packages/logic-engine/src/counters.test.ts: 10,000 edges without error, down never below 0, a
// reset drops the up edge of its scan, unknown makes no edge, overflow stops at INT64 max.
#include <gtest/gtest.h>

#include "core/logic/tests/test_util.hpp"

using namespace mat;
using namespace mat::logic;
using namespace mat::logic::test;

namespace {

std::unique_ptr<Harness> make(json o = json::object(), const RetainMap* retain = nullptr) {
    json c = {{"id", "c"},   {"up", "UP"},     {"down", "DOWN"},  {"reset", "RST"},
              {"preset", 5}, {"value", "L.V"}, {"reached", "L.R"}};
    for (auto it = o.begin(); it != o.end(); ++it) c[it.key()] = it.value();
    return makeHarness(json{{"schemaVersion", "1.0.0"}, {"counters", json::array({c})}},
                       {{"UP", tagInfo(TagType::BOOL)},
                        {"DOWN", tagInfo(TagType::BOOL)},
                        {"RST", tagInfo(TagType::BOOL)}},
                       {}, retain);
}

}  // namespace

TEST(Counter, TenThousandEdgesCountedExactly) {
    auto h = make({{"preset", 10000}, {"down", nullptr}, {"reset", nullptr}});
    int64_t t = 0;
    for (int i = 0; i < 10000; ++i) {
        setB(*h, "UP", false);
        h->runTo(t);
        t += 100;
        setB(*h, "UP", true);
        h->runTo(t);
        t += 100;
        if (i == 9998) {
            EXPECT_EQ(value(*h, "L.R"), json(false));
        }
    }
    EXPECT_EQ(value(*h, "L.V"), json(10000));
    EXPECT_EQ(value(*h, "L.R"), json(true));
}

TEST(Counter, DownStopsAtZeroAndUpDownInOneScanCancel) {
    auto h = make();
    setB(*h, "UP", false);
    setB(*h, "DOWN", false);
    setB(*h, "RST", false);
    h->runTo(0);
    setB(*h, "DOWN", true);
    h->runTo(100);
    EXPECT_EQ(value(*h, "L.V"), json(0));
    setB(*h, "UP", true);
    setB(*h, "DOWN", false);
    h->runTo(200);
    EXPECT_EQ(value(*h, "L.V"), json(1));
    setB(*h, "UP", false);
    h->runTo(300);
    setB(*h, "UP", true);
    setB(*h, "DOWN", true);
    h->runTo(400);
    EXPECT_EQ(value(*h, "L.V"), json(1));
}

TEST(Counter, ResetClearsAndDropsTheUpEdgeOfItsScan) {
    auto h = make({{"preset", 2}});
    setB(*h, "UP", false);
    setB(*h, "DOWN", false);
    setB(*h, "RST", false);
    h->runTo(0);
    for (int i = 0; i < 3; ++i) {
        setB(*h, "UP", true);
        h->runTo(100 + i * 200);
        setB(*h, "UP", false);
        h->runTo(200 + i * 200);
    }
    EXPECT_EQ(value(*h, "L.V"), json(3));
    EXPECT_EQ(value(*h, "L.R"), json(true));
    setB(*h, "UP", true);
    setB(*h, "RST", true);
    h->runTo(800);
    EXPECT_EQ(value(*h, "L.V"), json(0));
    EXPECT_EQ(value(*h, "L.R"), json(false));
    h->runTo(900);
    EXPECT_EQ(value(*h, "L.V"), json(0));
}

TEST(Counter, FirstValidValueIsNoEdgeAndUnknownKeepsThePreviousMark) {
    auto h = make({{"down", nullptr}, {"reset", nullptr}});
    setB(*h, "UP", true);
    h->runTo(0);
    EXPECT_EQ(value(*h, "L.V"), json(0));
    setB(*h, "UP", false);
    h->runTo(100);
    setBad(*h, "UP");
    h->runTo(200);
    setB(*h, "UP", true);
    h->runTo(300);
    EXPECT_EQ(value(*h, "L.V"), json(1));
    setBad(*h, "UP", TagScalar{true});
    h->runTo(400);
    setB(*h, "UP", true);
    h->runTo(500);
    EXPECT_EQ(value(*h, "L.V"), json(1));
}

TEST(Counter, OverflowStopsAtInt64MaxNoWrap) {
    const RetainMap r = {{"logic/c/value", "9223372036854775805"}};
    auto h = make({{"down", nullptr}, {"reset", nullptr}}, &r);
    setB(*h, "UP", false);
    h->runTo(0);
    for (int i = 0; i < 4; ++i) {
        setB(*h, "UP", true);
        h->runTo(100 + i * 200);
        setB(*h, "UP", false);
        h->runTo(200 + i * 200);
    }
    EXPECT_EQ(value(*h, "L.V"), json(INT64_MAX));
    EXPECT_TRUE(h->state("c")->overflow);
    EXPECT_EQ(h->retainSnapshot()["logic/c/value"], json("9223372036854775807"));
    EXPECT_EQ(h->retainSnapshot()["logic/c/overflow"], json(true));
}

TEST(Counter, RetainFalseKeepsNothing) {
    auto h = make({{"retain", false}});
    EXPECT_TRUE(h->retainSnapshot().empty());
}

TEST(Counter, ResetByApiBackToZero) {
    const RetainMap r = {{"logic/c/value", "41"}, {"logic/c/overflow", true}};
    auto h = make({}, &r);
    EXPECT_EQ(value(*h, "L.V"), json(41));
    EXPECT_TRUE(h->engine().reset("c", 0));
    EXPECT_EQ(value(*h, "L.V"), json(0));
    EXPECT_EQ(h->retainSnapshot()["logic/c/overflow"], json(false));
    EXPECT_FALSE(h->engine().reset("nope", 0));
}
