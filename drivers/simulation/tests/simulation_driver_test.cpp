// The simulation driver on the standard driver suite (T048, SC-020) and its own cases (T055):
// generators and `legacy` published through the EngineSink, `manual` writes, the SIM.* load.
#include "drivers/simulation/simulation_driver.hpp"

#include <gtest/gtest.h>

#include "drivers/sdk/tests/driver_conformance.hpp"

using namespace mat;
using namespace mat::drv;
using namespace mat::drv::conformance;

namespace {

class SimHarness : public Harness {
   public:
    SimHarness() {
        std::vector<SimulationDriver::Item> items;
        sim::SimConfig k;
        k.kind = sim::SimKind::Const;
        k.value = 42.5;
        items.push_back({0, TagType::FLOAT64, k});
        k.value = true;
        items.push_back({1, TagType::BOOL, k});
        k.value = std::string("text");
        items.push_back({2, TagType::STRING, k});
        sim::SimConfig m;
        m.kind = sim::SimKind::Manual;
        m.initial = 7.0;
        items.push_back({3, TagType::INT16, m});
        driver_ = std::make_unique<SimulationDriver>(std::move(items));
    }
    Driver& driver() override { return *driver_; }
    size_t tagCount() const override { return 4; }
    TagType tagType(size_t t) const override {
        static const TagType types[] = {TagType::FLOAT64, TagType::BOOL, TagType::STRING,
                                        TagType::INT16};
        return types[t];
    }
    TagScalar backendValue(size_t t) const override {
        switch (t) {
            case 0:
                return 42.5;
            case 1:
                return true;
            case 2:
                return std::string("text");
            default:
                return int64_t{7};
        }
    }
    void advance(int64_t ms) override {
        for (int64_t i = 0; i < ms; i += 250) {
            now_ += 250;
            driver_->step(now_);
        }
    }
    int64_t cycleMs() const override { return 250; }
    std::vector<size_t> writableTags() const override { return {3}; }
    TagScalar writeValue(size_t) const override { return int64_t{9}; }

   private:
    std::unique_ptr<SimulationDriver> driver_;
    int64_t now_ = 1791594000000;
};

struct SimTraits {
    static std::unique_ptr<Harness> make() { return std::make_unique<SimHarness>(); }
};

}  // namespace

INSTANTIATE_TYPED_TEST_SUITE_P(Simulation, DriverConformance, SimTraits);

TEST(SimulationDriver, GeneratorsPublishTheValueAtTheTimeOfTheStep) {
    sim::SimConfig ramp;
    ramp.kind = sim::SimKind::Ramp;
    ramp.from = 0;
    ramp.to = 100;
    ramp.periodMs = 10000;
    SimulationDriver d({{0, TagType::FLOAT32, ramp}});
    RecordingSink sink;
    d.start(sink);
    d.step(2500);
    d.step(7500);
    ASSERT_EQ(sink.all.size(), 2u);
    EXPECT_EQ(std::get<double>(sink.all[0].value), 25.0);
    EXPECT_EQ(std::get<double>(sink.all[1].value), 75.0);
    EXPECT_EQ(sink.all[1].sourceTs, 7500);
}

TEST(SimulationDriver, ManualTagTakesWritesAppliedOnTheNextStep) {
    sim::SimConfig m;
    m.kind = sim::SimKind::Manual;
    m.initial = true;
    SimulationDriver d({{5, TagType::BOOL, m}});
    RecordingSink sink;
    d.start(sink);
    d.step(1000);
    EXPECT_EQ(std::get<bool>(sink.last(5)->value), true);
    WriteCommand c;
    c.id = 77;
    c.tag = 5;
    c.raw = false;
    EXPECT_TRUE(d.enqueueWrite(c));
    d.step(1250);
    EXPECT_EQ(std::get<bool>(sink.last(5)->value), false);
    ASSERT_EQ(sink.results.size(), 1u);
    EXPECT_EQ(sink.results[0].id, 77u);
    EXPECT_EQ(sink.results[0].code, "APPLIED");
    // the value stays after the next steps
    d.step(1500);
    EXPECT_EQ(std::get<bool>(sink.last(5)->value), false);
    // not a manual Tag: refused
    c.tag = 6;
    EXPECT_FALSE(d.enqueueWrite(c));
}

TEST(SimulationDriver, LegacySignalsAndTheSimLoadPassThroughTheSink) {
    SimulationDriver d({}, {{0, "tank.level"}, {1, "motor.run"}, {2, "nonsense"}}, {3, 4, 5});
    RecordingSink sink;
    d.start(sink);
    d.step(1000);
    d.step(1250);
    EXPECT_EQ(sink.last(0)->quality, Quality::GOOD);
    EXPECT_EQ(sink.last(2)->quality, Quality::BAD);
    EXPECT_EQ(sink.last(2)->reason, "NO_SIGNAL");
    EXPECT_TRUE(std::holds_alternative<std::monostate>(sink.last(2)->value));
    EXPECT_TRUE(sink.last(3).has_value());  // SIM.* published at the first step
}

TEST(SimulationDriver, LinkStateAndDiagnosticsAndTest) {
    SimulationDriver d({});
    EXPECT_EQ(d.linkState(0).channel, ChannelState::Connected);
    DriverDiag dd;
    d.diagnostics(dd, 0);
    EXPECT_EQ(dd.channel.state, "connected");
    EXPECT_EQ(d.test({}).code, "OK");
}

TEST(SimulationDriver, StepWithoutStartPublishesNothing) {
    sim::SimConfig k;
    k.kind = sim::SimKind::Const;
    k.value = 1.0;
    SimulationDriver d({{0, TagType::FLOAT64, k}});
    d.step(1000);  // no sink: nothing to publish to, no crash
    SUCCEED();
}

TEST(SimulationDriver, CancelQueuedWritesTakesBackTheCommandsOfTheNextStep) {
    sim::SimConfig m;
    m.kind = sim::SimKind::Manual;
    m.initial = 7.0;
    SimulationDriver d({{3, TagType::INT16, m}});
    conformance::RecordingSink sink;
    d.start(sink);
    WriteCommand a;
    a.id = 5;
    a.tag = 3;
    a.raw = int64_t{9};
    ASSERT_TRUE(d.enqueueWrite(a));
    EXPECT_EQ(d.cancelQueuedWrites(), std::vector<uint64_t>{5});
    d.step(1791594000000);
    d.step(1791594000250);
    EXPECT_EQ(sink.resultCount(), 0u);
    d.stop();
}
