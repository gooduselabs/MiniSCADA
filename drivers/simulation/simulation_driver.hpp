// Simulation driver (ADR-014, contracts/modbus-driver.md §1; research R18): the generators of
// contract value-tables-simulation §2 and `legacy` (the Sprint 1 mock) behind the Driver interface.
// No channel and no thread: the engine calls step(now) on every round; it still publishes only
// through the EngineSink. `manual` Tags take write commands: the value is applied on the next step.
#pragma once
#include <map>
#include <mutex>
#include <string>
#include <vector>

#include "drivers/sdk/driver.hpp"
#include "drivers/simulation/mock_tag_provider.hpp"
#include "drivers/simulation/sim_generators.hpp"

namespace mat {

class SimulationDriver : public drv::Driver {
   public:
    struct Item {
        size_t tag = 0;
        TagType type = TagType::FLOAT64;
        sim::SimConfig config;  // any kind but legacy
    };

    // `legacy`: Tags of the mock signals (SimConfig kind legacy); `simLoadTags`: SIM.T0001..
    // indexes.
    SimulationDriver(std::vector<Item> items, std::vector<LegacyMock::Bound> legacy = {},
                     std::vector<size_t> simLoadTags = {});

    void start(drv::EngineSink& sink) override;
    void stop() override;
    void step(int64_t nowMs) override;
    bool enqueueWrite(drv::WriteCommand cmd) override;
    drv::LinkState linkState(uint32_t) const override;
    void diagnostics(drv::DriverDiag& out, int64_t nowMs) const override;
    drv::TestOutcome test(const drv::TestRequest&) override;

   private:
    std::vector<Item> items_;
    std::map<size_t, size_t> manualIndex_;  // tag -> position in items_ (manual only)
    LegacyMock legacy_;
    bool hasLegacy_ = false;

    mutable std::mutex mu_;  // writes arrive from HTTP threads
    drv::EngineSink* sink_ = nullptr;
    std::map<size_t, sim::SimScalar> lastWrite_;
    std::vector<drv::WriteCommand> pending_;
};

}  // namespace mat
