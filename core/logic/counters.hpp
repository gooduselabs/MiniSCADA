// Counter (contracts/logic-engine.md §4; packages/logic-engine/src/counters.ts). A rising edge
// between two valid scans (the "previous" mark moves only on a valid value; the first valid value
// is not an edge). In one scan: reset first (up and down dropped), then up, then down. INT64 in an
// int64_t: at the maximum it stops and sets `overflow` (reset clears it). Retained: `value` (a
// decimal string), `overflow`.
#pragma once
#include "core/logic/block.hpp"

namespace mat::logic {

constexpr int64_t kInt64Max = INT64_MAX;

class CounterBlock : public Block {
   public:
    CounterBlock(const nlohmann::json& def, Expr up, std::optional<Expr> down,
                 std::optional<Expr> reset, const RetainMap* store);
    const std::string& id() const override { return id_; }
    void step(ScanCtx& ctx) override;
    BlockState state(int64_t now) const override;
    void retain(RetainMap& out) const override;
    void init(const SetOut& setOut) override { publish(setOut); }
    bool reset(double value, const SetOut& setOut) override;

    int64_t value() const { return value_; }

   private:
    void publish(const SetOut& setOut) const;

    std::string id_;
    std::string valueTag_, reachedTag_;
    std::optional<int64_t> preset_;
    bool retained_ = true;
    std::optional<Expr> exprs_[3];
    std::optional<bool> prev_[3];
    int64_t value_ = 0;
    bool overflow_ = false;
};

}  // namespace mat::logic
