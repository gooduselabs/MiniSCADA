// Timers ton/tof/tp (contracts/logic-engine.md §3; packages/logic-engine/src/timers.ts). `et` adds
// up the time between two consecutive valid scans (an unknown input holds the outputs and stops the
// count; an interval with an unknown scan does not count). `in` before the first valid scan counts
// as false (as a PLC). Not retained.
#pragma once
#include "core/logic/block.hpp"

namespace mat::logic {

class TimerBlock : public Block {
   public:
    TimerBlock(const nlohmann::json& def, Expr input, int scanMs);
    const std::string& id() const override { return id_; }
    void step(ScanCtx& ctx) override;
    BlockState state(int64_t now) const override;
    void retain(RetainMap&) const override {}
    void init(const SetOut& setOut) override { publish(setOut); }

   private:
    void publish(const SetOut& setOut) const;

    std::string id_;
    std::string kind_;
    int64_t pt_ = 0;
    std::string qTag_, etTag_;
    Expr input_;
    bool q_ = false;
    int64_t et_ = 0;
    bool prevIn_ = false;
    bool running_ = false;
    std::optional<int64_t> lastT_;
    bool lastValid_ = false;
    bool degraded_ = false;
};

}  // namespace mat::logic
