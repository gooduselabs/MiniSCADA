// Mock Tag provider (Sprint 1, research R10), now the `legacy` generator of the simulation driver
// (specs/006 T056, contracts/value-tables-simulation.md §2.4). Same algorithm and constants as
// runtime 0.4; only the place where values go changed: they are published as TagUpdate through an
// EngineSink instead of TagStore::set. Deterministic for a given clock:
//  - tank + pump: running fills the tank, >= 90 % stops the pump, <= 10 % restarts it (~60 s cycle)
//  - tank.temp goes BAD for 5 s in every 20 s window (shows bad-quality rendering)
//  - optional load: SIM.T0001..SIM.T0500, each changes once per second whatever the step period
//  - a signal it does not know: BAD NO_SIGNAL
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "core/tag-engine/tag_provider.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "drivers/sdk/driver.hpp"

namespace mat {

// The algorithm, without a store: step() fills TagUpdates.
class LegacyMock {
   public:
    static constexpr size_t kSimTagCount = 500;
    struct Bound {
        size_t tag;
        std::string
            signal;  // tank.level, motor.run, motor.speed, tank.inflow, tank.temp, other: BAD
    };
    // `bound`: Tags of the mock signals; `simTags`: store indexes of SIM.T0001.. (the load).
    LegacyMock(std::vector<Bound> bound, std::vector<size_t> simTags);
    // Advance to `nowMs` (epoch ms) and append the Tag updates (a Tag that did not change is
    // still published, as in runtime 0.4: the store drops equal values).
    void step(int64_t nowMs, std::vector<drv::TagUpdate>& out);

   private:
    enum class Signal { TankLevel, MotorRun, MotorSpeed, TankInflow, TankTemp, Unknown };
    struct Item {
        size_t tag;
        Signal signal;
    };

    std::vector<Item> bound_;
    std::vector<size_t> sim_;
    std::vector<double> simValue_;
    size_t simCursor_ = 0;
    int64_t simBudgetMs_ = 0;  // SIM changes owed, in tag-milliseconds (1000 = one change)
    uint32_t rng_ = 0x12345678u;
    bool started_ = false;
    int64_t t0_ = 0;
    int64_t last_ = 0;
    double level_ = 50.0;
    bool running_ = true;
};

class MockTagProvider : public TagProvider {
   public:
    static constexpr size_t kSimTagCount = LegacyMock::kSimTagCount;
    // Binds tags whose `signal` is known; adds SIM.* tags to the store when simLoad is set.
    MockTagProvider(TagStore& store, bool simLoad);
    void step(int64_t nowMs) override;

   private:
    // EngineSink that writes the updates straight into a TagStore (Sprint 1 behaviour).
    class StoreSink : public drv::EngineSink {
       public:
        explicit StoreSink(TagStore& s) : store_(s) {}
        void publish(std::vector<drv::TagUpdate>&& updates) override;
        void writeDone(drv::WriteResult&&) override {}

       private:
        TagStore& store_;
    };

    StoreSink sink_;
    LegacyMock mock_;
};

// Builds a LegacyMock for a store the way MockTagProvider does (bindings of known signals).
std::vector<LegacyMock::Bound> legacyBindingsOf(const TagStore& store);

}  // namespace mat
