// Totalizer (contracts/logic-engine.md §5; packages/logic-engine/src/totalizer.ts). Trapezoids on
// the monotonic clock, double arithmetic in exactly this order
//   total = total + ((factor * ((r0 + r1) / 2)) * (dtMs / 1000)) / unitSeconds
// (no FMA: the module is built with -ffp-contract=off) so that TS and C++ agree bit for bit. An
// interval with an unknown end or dtMs > maxGapMs adds nothing and goes to the gap (integer ms;
// gapSeconds = gapMs / 1000). In one scan: add, then rolloverAt (one subtraction), then the rising
// edge of reset (total = 0, gap = 0). The first scan only records the mark.
#pragma once
#include "core/logic/block.hpp"

namespace mat::logic {

constexpr int64_t kDefaultMaxGapMs = 5000;

// Math.round of JavaScript (half up).
double jsRound(double x);

class TotalizerBlock : public Block {
   public:
    TotalizerBlock(const nlohmann::json& def, Expr source, std::optional<Expr> reset,
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
    double cut(double r) const { return r < cutoff_ ? 0 : r; }

    std::string id_;
    std::string totalTag_, gapTag_;
    uint32_t totalSlot_ = kNoSlot, gapSlot_ = kNoSlot;
    bool retained_ = true;
    Expr source_;
    std::optional<Expr> reset_;
    double factor_ = 1, cutoff_ = 0, unit_ = 1;
    int64_t maxGapMs_ = kDefaultMaxGapMs;
    std::optional<double> rolloverAt_;
    double total_ = 0;
    int64_t gapMs_ = 0;
    bool hasPrev_ = false;
    int64_t prevT_ = 0;
    std::optional<double> prevRate_;
    std::optional<bool> prevReset_;
};

}  // namespace mat::logic
