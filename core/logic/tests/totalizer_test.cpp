// Totalizer (T126, C++ half; FR-087; contracts/logic-engine.md §5), as
// packages/logic-engine/src/totalizer.test.ts: trapezoids, a constant flow for one hour within
// 0.1 %, cutoff, maxGapMs and gapSeconds, rolloverAt, reset; the sums equal the reference formula
// bit for bit (fixed order, no FMA).
#include <gtest/gtest.h>

#include <cmath>

#include "core/logic/tests/test_util.hpp"

using namespace mat;
using namespace mat::logic;
using namespace mat::logic::test;

namespace {

json doc(json o = json::object()) {
    json z = {{"id", "z"},        {"source", "FLOW"},   {"rateUnit", "h"},
              {"maxGapMs", 5000}, {"total", "L.TOTAL"}, {"gapSeconds", "L.GAP"}};
    for (auto it = o.begin(); it != o.end(); ++it) z[it.key()] = it.value();
    return {{"schemaVersion", "1.0.0"}, {"totalizers", json::array({z})}};
}
TagInfoMap tags() { return {{"FLOW", tagInfo(TagType::FLOAT64)}, {"RST", tagInfo(TagType::BOOL)}}; }
std::unique_ptr<Harness> make(json o = json::object(), const RetainMap* r = nullptr) {
    return makeHarness(doc(std::move(o)), tags(), {}, r);
}
// The reference formula of contract §5, in its order.
double inc(double factor, double a, double b, double dtMs, double unit) {
    const double x = factor * ((a + b) / 2);
    const double y = x * (dtMs / 1000);
    return y / unit;
}
double num(Harness& h, const std::string& t) { return value(h, t).get<double>(); }

}  // namespace

TEST(Totalizer, ConstantFlowOneHourWithin0_1PercentAndBitEqual) {
    auto h = make();
    setN(*h, "FLOW", 36);
    h->runTo(3600000);
    const double total = num(*h, "L.TOTAL");
    EXPECT_LE(std::fabs(total - 36) / 36, 0.001);
    double ref = 0;
    for (int k = 1; k <= 36000; ++k) ref = ref + inc(1, 36, 36, 100, 3600);
    EXPECT_EQ(total, ref);
}

TEST(Totalizer, LinearRampIsTheTrapezoidBitForBit) {
    auto h = make({{"rateUnit", "s"}, {"factor", 0.5}});
    double ref = 0, prev = 0;
    for (int k = 0; k <= 600; ++k) {
        const double r = k * 0.1;
        setN(*h, "FLOW", r);
        h->runTo(k * 100);
        if (k > 0) ref = ref + inc(0.5, prev, r, 100, 1);
        prev = r;
    }
    EXPECT_EQ(num(*h, "L.TOTAL"), ref);
    EXPECT_LT(std::fabs(num(*h, "L.TOTAL") - 0.5 * ((60.0 * 60) / 2) * 0.1 * 10), 1e-6);
}

TEST(Totalizer, CutoffCountsBothEndsAsZero) {
    auto h = make({{"rateUnit", "s"}, {"cutoff", 1}});
    setN(*h, "FLOW", 0.5);
    h->runTo(1000);
    EXPECT_EQ(num(*h, "L.TOTAL"), 0);
    setN(*h, "FLOW", 2);
    h->runTo(1100);
    EXPECT_EQ(num(*h, "L.TOTAL"), inc(1, 0, 2, 100, 1));
}

TEST(Totalizer, BadSourceAddsNothingAndCountsTheGap) {
    auto h = make({{"rateUnit", "s"}});
    setN(*h, "FLOW", 10);
    h->runTo(1000);
    const double before = num(*h, "L.TOTAL");
    EXPECT_EQ(before, 10.0);
    setBad(*h, "FLOW");
    h->runTo(2000);
    setN(*h, "FLOW", 10);
    h->runTo(2100);
    EXPECT_EQ(num(*h, "L.TOTAL"), before);
    EXPECT_EQ(num(*h, "L.GAP"), 1.1);
    h->runTo(2200);
    EXPECT_EQ(num(*h, "L.TOTAL"), before + 1);
}

TEST(Totalizer, IntervalAboveMaxGapGoesToTheGap) {
    EngineOptions o;
    o.tags = tags();
    Engine e(doc({{"rateUnit", "s"}, {"maxGapMs", 5000}}), o);
    const ReadTag read = [](const std::string&) {
        expr::InputValue v;
        v.value = 4.0;
        v.quality = Quality::GOOD;
        return v;
    };
    e.step(0, read, {});
    e.step(5000, read, {});
    EXPECT_EQ(std::get<double>(e.output("L.TOTAL")->value), 20);
    e.step(10001, read, {});
    EXPECT_EQ(std::get<double>(e.output("L.TOTAL")->value), 20);
    EXPECT_EQ(std::get<double>(e.output("L.GAP")->value), 5.001);
}

TEST(Totalizer, RolloverSubtracts) {
    auto h = make({{"rateUnit", "s"}, {"rolloverAt", 100}});
    setN(*h, "FLOW", 30);
    h->runTo(3000);
    EXPECT_NEAR(num(*h, "L.TOTAL"), 90, 1e-9);
    h->runTo(3400);
    EXPECT_NEAR(num(*h, "L.TOTAL"), 2, 1e-9);
}

TEST(Totalizer, ResetEdgeClearsTotalAndGap) {
    auto h = make({{"rateUnit", "s"}, {"reset", "RST"}});
    setB(*h, "RST", false);
    setN(*h, "FLOW", 1);
    h->runTo(1000);
    EXPECT_NEAR(num(*h, "L.TOTAL"), 1, 1e-9);
    setB(*h, "RST", true);
    h->runTo(1100);
    EXPECT_EQ(num(*h, "L.TOTAL"), 0);
    h->runTo(1200);
    EXPECT_EQ(num(*h, "L.TOTAL"), 0.1);
}

TEST(Totalizer, RetainRestoresTotalAndGap) {
    const RetainMap r = {{"logic/z/total", 12.5}, {"logic/z/gapSeconds", 3}};
    auto h = make({{"rateUnit", "s"}}, &r);
    setN(*h, "FLOW", 10);
    h->runTo(1000);
    EXPECT_EQ(num(*h, "L.TOTAL"), 22.5);
    EXPECT_EQ(num(*h, "L.GAP"), 3);
    const RetainMap snap = h->retainSnapshot();
    EXPECT_EQ(snap.size(), 2u);
    EXPECT_EQ(snap.at("logic/z/total"), json(22.5));
    EXPECT_EQ(snap.at("logic/z/gapSeconds"), json(3.0));
}
