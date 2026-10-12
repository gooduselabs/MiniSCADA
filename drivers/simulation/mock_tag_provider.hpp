// Mock Tag provider (Sprint 1, research R10). Deterministic for a given clock:
//  - tank + pump: running fills the tank, >= 90 % stops the pump, <= 10 % restarts it (~60 s cycle)
//  - tank.temp goes BAD for 5 s in every 20 s window (shows bad-quality rendering)
//  - optional load: SIM.T0001..SIM.T0500, each changes once per second whatever the step period
#pragma once
#include <cstdint>
#include <vector>

#include "core/tag-engine/tag_provider.hpp"
#include "core/tag-engine/tag_store.hpp"

namespace mat {

class MockTagProvider : public TagProvider {
   public:
    static constexpr size_t kSimTagCount = 500;
    // Binds tags whose `signal` is known; adds SIM.* tags to the store when simLoad is set.
    MockTagProvider(TagStore& store, bool simLoad);
    void step(int64_t nowMs) override;

   private:
    enum class Signal { TankLevel, MotorRun, MotorSpeed, TankInflow, TankTemp, Unknown };
    struct Bound {
        size_t index;
        Signal signal;
    };

    TagStore& store_;
    std::vector<Bound> bound_;
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

}  // namespace mat
