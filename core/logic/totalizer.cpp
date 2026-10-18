#include "core/logic/totalizer.hpp"

#include <cmath>

namespace mat::logic {

double jsRound(double x) {
    const double f = std::floor(x);
    return x - f >= 0.5 ? f + 1 : f;
}

namespace {

double unitSeconds(const std::string& u) {
    if (u == "min") return 60;
    if (u == "h") return 3600;
    if (u == "d") return 86400;
    return 1;
}

double scalarNumber(const TagScalar& v) {
    if (const double* d = std::get_if<double>(&v)) return *d;
    if (const int64_t* i = std::get_if<int64_t>(&v)) return static_cast<double>(*i);
    if (const uint64_t* u = std::get_if<uint64_t>(&v)) return static_cast<double>(*u);
    if (const bool* b = std::get_if<bool>(&v)) return *b ? 1 : 0;
    return 0;
}

}  // namespace

TotalizerBlock::TotalizerBlock(const nlohmann::json& def, Expr source, std::optional<Expr> reset,
                               const RetainMap* store)
    : id_(blockId(def)),
      totalTag_(stringOf(def, "total").value_or("")),
      gapTag_(stringOf(def, "gapSeconds").value_or("")),
      retained_(!isFalse(def, "retain")),
      source_(std::move(source)),
      reset_(std::move(reset)),
      factor_(numberOf(def, "factor").value_or(1)),
      cutoff_(numberOf(def, "cutoff").value_or(0)),
      unit_(unitSeconds(stringOf(def, "rateUnit").value_or("s"))),
      maxGapMs_(static_cast<int64_t>(numberOf(def, "maxGapMs").value_or(kDefaultMaxGapMs))),
      rolloverAt_(numberOf(def, "rolloverAt")) {
    if (store && retained_) {
        total_ = retainNum(store, "logic/" + id_ + "/total");
        gapMs_ =
            static_cast<int64_t>(jsRound(retainNum(store, "logic/" + id_ + "/gapSeconds") * 1000));
    }
}

void TotalizerBlock::bind(const SlotOf& slotOf) {
    source_.bind(slotOf);
    if (reset_) reset_->bind(slotOf);
    totalSlot_ = slotOf(totalTag_);
    gapSlot_ = optionalSlot(slotOf, gapTag_);
}

bool TotalizerBlock::step(ScanCtx& ctx) {
    const Expr::Result& s = source_.eval(ctx);
    std::optional<double> rate;
    if (s.ok) rate = scalarNumber(s.value);
    if (hasPrev_) {
        const int64_t dtMs = ctx.now - prevT_;
        if (!rate || !prevRate_ || dtMs > maxGapMs_) {
            gapMs_ += dtMs;
        } else {
            const double r0 = cut(*prevRate_);
            const double r1 = cut(*rate);
            const double a = factor_ * ((r0 + r1) / 2);
            const double b = a * (static_cast<double>(dtMs) / 1000);
            const double inc = b / unit_;
            const double next = total_ + inc;
            // Overflow (huge finite rate): not added, counted as a gap (fuzz T142, contract §5).
            if (std::isfinite(next)) {
                total_ = next;
            } else {
                gapMs_ += dtMs;
            }
        }
        if (rolloverAt_ && total_ >= *rolloverAt_) total_ = total_ - *rolloverAt_;
    }
    hasPrev_ = true;
    prevT_ = ctx.now;
    prevRate_ = rate;
    if (reset_) {
        const std::optional<bool> v = reset_->evalBool(ctx);
        if (v) {
            if (prevReset_ && !*prevReset_ && *v) {
                total_ = 0;
                gapMs_ = 0;
            }
            prevReset_ = *v;
        }
    }
    publish(ctx.out());
    return true;  // integrates (or counts the gap) at every scan
}

void TotalizerBlock::stepInputs(std::vector<uint32_t>& out) const {
    out.insert(out.end(), source_.slots().begin(), source_.slots().end());
    if (reset_) out.insert(out.end(), reset_->slots().begin(), reset_->slots().end());
}

void TotalizerBlock::publish(const SetOut& setOut) const {
    setOut(totalSlot_, TagScalar{total_});
    if (gapSlot_ != kNoSlot) setOut(gapSlot_, TagScalar{static_cast<double>(gapMs_) / 1000});
}

bool TotalizerBlock::reset(double value, const SetOut& setOut) {
    total_ = value;
    gapMs_ = 0;
    publish(setOut);
    return true;
}

BlockState TotalizerBlock::state(int64_t) const {
    BlockState s;
    s.kind = "totalizer";
    s.state = "OK";
    return s;
}

void TotalizerBlock::retain(RetainMap& out) const {
    if (!retained_) return;
    out["logic/" + id_ + "/total"] = total_;
    out["logic/" + id_ + "/gapSeconds"] = static_cast<double>(gapMs_) / 1000;
}

}  // namespace mat::logic
