#include "drivers/simulation/mock_tag_provider.hpp"

#include <gtest/gtest.h>

#include <map>

using namespace mat;

namespace {
struct Sim : ::testing::Test {
    TagStore store;
    size_t level, run, speed, inflow, temp, unknown;
    void SetUp() override {
        level = store.add({"TANK01.LEVEL", TagType::FLOAT32, "tank.level"});
        run = store.add({"MOTOR01.RUN", TagType::BOOL, "motor.run"});
        speed = store.add({"MOTOR01.SPEED", TagType::FLOAT32, "motor.speed"});
        inflow = store.add({"TANK01.INFLOW", TagType::FLOAT32, "tank.inflow"});
        temp = store.add({"TANK01.TEMP", TagType::FLOAT32, "tank.temp"});
        unknown = store.add({"X.Y", TagType::FLOAT32, "no.such.signal"});
    }
    double num(size_t i) { return std::get<double>(store.get(i).value); }
    bool flag(size_t i) { return std::get<bool>(store.get(i).value); }
};
}  // namespace

TEST_F(Sim, TankAndMotorFollowHysteresisWithAboutOneMinuteCycle) {
    MockTagProvider p(store, false);
    std::vector<int64_t> starts;
    bool prevRun = false;
    double prevLevel = -1;
    for (int64_t t = 0; t <= 240000; t += 250) {
        p.step(t);
        const double l = num(level);
        const bool r = flag(run);
        EXPECT_GE(l, 9.0);
        EXPECT_LE(l, 91.0);
        if (prevLevel >= 0 && r && prevRun) {
            EXPECT_GT(l, prevLevel);  // running: filling
        }
        if (prevLevel >= 0 && !r && !prevRun) {
            EXPECT_LT(l, prevLevel);  // stopped: draining
        }
        if (r && !prevRun && t > 0) starts.push_back(t);
        if (r) {
            EXPECT_NEAR(num(speed), 1450.0, 20.0);
            EXPECT_GT(num(inflow), 0.0);
        } else {
            EXPECT_EQ(num(speed), 0.0);
            EXPECT_EQ(num(inflow), 0.0);
        }
        prevRun = r;
        prevLevel = l;
    }
    ASSERT_GE(starts.size(), 3u);
    for (size_t i = 1; i < starts.size(); ++i) {
        EXPECT_GE(starts[i] - starts[i - 1], 50000);
        EXPECT_LE(starts[i] - starts[i - 1], 70000);
    }
}

TEST_F(Sim, TemperatureIsBadFiveSecondsOutOfTwenty) {
    MockTagProvider p(store, false);
    int bad = 0, good = 0;
    for (int64_t t = 0; t < 80000; t += 250) {
        p.step(t);
        (store.get(temp).quality == Quality::BAD ? bad : good)++;
    }
    EXPECT_EQ(bad, 80);  // 4 windows x 5 s x 4 steps/s
    EXPECT_EQ(good, 240);
}

TEST_F(Sim, UnknownSignalIsBad) {
    MockTagProvider p(store, false);
    p.step(0);
    p.step(250);
    EXPECT_EQ(store.get(unknown).quality, Quality::BAD);
    EXPECT_EQ(store.get(level).quality, Quality::GOOD);
}

TEST_F(Sim, SimLoadAdds500TagsEachChangingOncePerSecond) {
    MockTagProvider p(store, true);
    ASSERT_TRUE(store.indexOf("SIM.T0001").has_value());
    ASSERT_TRUE(store.indexOf("SIM.T0500").has_value());
    EXPECT_FALSE(store.indexOf("SIM.T0501").has_value());
    p.step(0);
    store.takeDirty();
    std::map<size_t, int> changes;
    for (int k = 1; k <= 8; ++k) {  // 2 seconds
        p.step(k * 250);
        for (size_t i : store.takeDirty())
            if (store.def(i).id.rfind("SIM.", 0) == 0) changes[i]++;
    }
    EXPECT_EQ(changes.size(), 500u);
    for (auto& kv : changes) EXPECT_EQ(kv.second, 2) << store.def(kv.first).id;
}

// FR-018(b): the rate follows elapsed time, not the tick: deltaPeriodMs may be 100-250 ms
// (contracts/runtime-config.md), and every SIM tag must still change once per second (audit
// FR-018).
TEST_F(Sim, SimLoadRateFollowsElapsedTimeWith100msSteps) {
    MockTagProvider p(store, true);
    p.step(0);
    store.takeDirty();
    for (int window = 0; window < 3; ++window) {
        std::map<size_t, int> changes;
        for (int k = 1; k <= 10; ++k) {
            p.step(window * 1000 + k * 100);
            for (size_t i : store.takeDirty())
                if (store.def(i).id.rfind("SIM.", 0) == 0) changes[i]++;
        }
        EXPECT_EQ(changes.size(), 500u) << "window " << window;
        for (auto& kv : changes) EXPECT_EQ(kv.second, 1) << store.def(kv.first).id;
    }
}

TEST_F(Sim, DeterministicForSameClock) {
    TagStore other;
    other.add({"TANK01.LEVEL", TagType::FLOAT32, "tank.level"});
    MockTagProvider a(store, false), b(other, false);
    for (int64_t t = 0; t < 30000; t += 250) {
        a.step(t);
        b.step(t);
    }
    EXPECT_DOUBLE_EQ(num(level), std::get<double>(other.get(0).value));
}
