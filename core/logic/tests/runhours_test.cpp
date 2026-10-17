// Run hours (T126, C++ half; FR-088; contracts/logic-engine.md §6), as
// packages/logic-engine/src/runhours.test.ts: 24 simulated hours within 0.01 h, starts by rising
// edge, due, reset keeps starts, unknown adds nothing.
#include <gtest/gtest.h>

#include <cmath>

#include "core/logic/tests/test_util.hpp"

using namespace mat;
using namespace mat::logic;
using namespace mat::logic::test;

namespace {

std::unique_ptr<Harness> make(json o = json::object(), const RetainMap* r = nullptr) {
    json b = {{"id", "h"},      {"run", "RUN"},    {"reset", "RST"},
              {"hours", "L.H"}, {"starts", "L.S"}, {"due", "L.D"}};
    for (auto it = o.begin(); it != o.end(); ++it) b[it.key()] = it.value();
    return makeHarness(json{{"schemaVersion", "1.0.0"}, {"runhours", json::array({b})}},
                       {{"RUN", tagInfo(TagType::BOOL)}, {"RST", tagInfo(TagType::BOOL)}}, {}, r);
}

}  // namespace

TEST(Runhours, TwentyFourHoursOnOffGives12HoursAnd12Starts) {
    auto h = make({{"serviceEveryHours", 11.5}});
    setB(*h, "RST", false);
    setB(*h, "RUN", false);
    h->runTo(0);
    for (int64_t i = 0; i < 12; ++i) {
        setB(*h, "RUN", true);
        h->runTo(i * 7200000 + 3600000);
        setB(*h, "RUN", false);
        h->runTo((i + 1) * 7200000);
    }
    EXPECT_LE(std::fabs(value(*h, "L.H").get<double>() - 12), 0.01);
    EXPECT_EQ(value(*h, "L.H"), json(12.0));
    EXPECT_EQ(value(*h, "L.S"), json(12));
    EXPECT_EQ(value(*h, "L.D"), json(true));
}

TEST(Runhours, IntervalCountsWhenRunAtItsStartAndBothScansValid) {
    auto h = make();
    setB(*h, "RUN", true);
    h->runTo(0);
    h->runTo(1000);
    EXPECT_EQ(value(*h, "L.H"), json(1000.0 / 3600000));
    setBad(*h, "RUN");
    h->runTo(5000);
    setB(*h, "RUN", true);
    h->runTo(5100);
    EXPECT_EQ(value(*h, "L.H"), json(1000.0 / 3600000));
    h->runTo(5200);
    EXPECT_EQ(value(*h, "L.H"), json(1100.0 / 3600000));
    EXPECT_EQ(value(*h, "L.S"), json(0));
}

TEST(Runhours, ResetClearsHoursAndDueKeepsStarts) {
    auto h = make({{"serviceEveryHours", 0.0001}});
    setB(*h, "RST", false);
    setB(*h, "RUN", false);
    h->runTo(0);
    setB(*h, "RUN", true);
    h->runTo(1000);
    EXPECT_EQ(value(*h, "L.S"), json(1));
    EXPECT_EQ(value(*h, "L.D"), json(true));
    setB(*h, "RST", true);
    h->runTo(1100);
    EXPECT_EQ(value(*h, "L.H"), json(0.0));
    EXPECT_EQ(value(*h, "L.S"), json(1));
    EXPECT_EQ(value(*h, "L.D"), json(false));
}

TEST(Runhours, RetainRestoresHoursStartsAndLastRun) {
    const RetainMap r = {{"logic/h/hours", 2}, {"logic/h/starts", 7}, {"logic/h/lastRun", true}};
    auto h = make({}, &r);
    setB(*h, "RUN", true);
    h->runTo(0);
    EXPECT_EQ(value(*h, "L.H"), json(2.0));
    EXPECT_EQ(value(*h, "L.S"), json(7));
    h->runTo(3600000);
    EXPECT_EQ(value(*h, "L.H"), json(3.0));
    EXPECT_EQ(value(*h, "L.S"), json(7));
    const RetainMap snap = h->retainSnapshot();
    EXPECT_EQ(snap.at("logic/h/hours"), json(3.0));
    EXPECT_EQ(snap.at("logic/h/starts"), json(7));
    EXPECT_EQ(snap.at("logic/h/lastRun"), json(true));
}
