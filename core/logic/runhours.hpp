// Run hours (contracts/logic-engine.md §6; packages/logic-engine/src/runhours.ts). The interval
// (k-1, k] counts when both scans are valid and `run` was true at k-1 (integer ms, hours = runMs /
// 3,600,000). `starts`: a rising edge between two valid values (the first is none, unless the
// retain store has `lastRun`). In one scan: add, count the start, then the rising edge of reset
// (hours = 0, due = false; starts kept). Retained: `hours`, `starts`, `lastRun` (once known).
#pragma once
#include "core/logic/block.hpp"

namespace mat::logic {

class RunhoursBlock : public Block {
   public:
    RunhoursBlock(const nlohmann::json& def, Expr run, std::optional<Expr> reset,
                  const RetainMap* store);
    const std::string& id() const override { return id_; }
    void bind(const SlotOf& slotOf) override;
    void stepInputs(std::vector<uint32_t>& out) const override;
    bool step(ScanCtx& ctx) override;
    BlockState state(int64_t now) const override;
    void retain(RetainMap& out) const override;
    void init(const SetOut& setOut) override { publish(setOut); }
    bool reset(double value, const SetOut& setOut) override;

   private:
    void publish(const SetOut& setOut) const;

    std::string id_;
    std::string hoursTag_, startsTag_, dueTag_;
    uint32_t hoursSlot_ = kNoSlot, startsSlot_ = kNoSlot, dueSlot_ = kNoSlot;
    std::optional<double> serviceEveryHours_;
    bool retained_ = true;
    Expr run_;
    std::optional<Expr> reset_;
    int64_t runMs_ = 0;
    int64_t starts_ = 0;
    std::optional<bool> prevRun_;
    bool lastValid_ = false;  // the last step had a valid `run`
    std::optional<bool> prevReset_;
};

}  // namespace mat::logic
