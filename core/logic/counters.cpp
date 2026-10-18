#include "core/logic/counters.hpp"

#include <algorithm>
#include <cstdlib>

namespace mat::logic {

namespace {

// ^[0-9]{1,19}$, capped at INT64 max (as the TS bigint).
std::optional<int64_t> parseDecimal(const std::string& s) {
    if (s.empty() || s.size() > 19) return std::nullopt;
    unsigned long long v = 0;
    for (char c : s) {
        if (c < '0' || c > '9') return std::nullopt;
        v = v * 10 + static_cast<unsigned long long>(c - '0');  // 19 digits fit in 64 bits
    }
    if (v > static_cast<unsigned long long>(kInt64Max)) return kInt64Max;
    return static_cast<int64_t>(v);
}

}  // namespace

CounterBlock::CounterBlock(const nlohmann::json& def, Expr up, std::optional<Expr> down,
                           std::optional<Expr> reset, const RetainMap* store)
    : id_(blockId(def)),
      valueTag_(stringOf(def, "value").value_or("")),
      reachedTag_(stringOf(def, "reached").value_or("")),
      retained_(!isFalse(def, "retain")) {
    if (const auto p = numberOf(def, "preset")) preset_ = static_cast<int64_t>(*p);
    exprs_[0] = std::move(up);
    exprs_[1] = std::move(down);
    exprs_[2] = std::move(reset);
    if (store && retained_) {
        const auto it = store->find("logic/" + id_ + "/value");
        if (it != store->end()) {
            const nlohmann::json& v = it->second;
            if (v.is_string()) {
                if (const auto d = parseDecimal(v.get<std::string>())) value_ = *d;
            } else if (v.is_number()) {
                // Number.isSafeInteger(v) && v >= 0
                const double d = v.get<double>();
                if (d >= 0 && d <= 9007199254740991.0 &&
                    static_cast<double>(static_cast<int64_t>(d)) == d)
                    value_ = static_cast<int64_t>(d);
            }
        }
        const auto o = store->find("logic/" + id_ + "/overflow");
        overflow_ = o != store->end() && o->second.is_boolean() && o->second.get<bool>();
    }
}

void CounterBlock::bind(const SlotOf& slotOf) {
    for (auto& e : exprs_)
        if (e) e->bind(slotOf);
    valueSlot_ = slotOf(valueTag_);
    reachedSlot_ = optionalSlot(slotOf, reachedTag_);
}

bool CounterBlock::step(ScanCtx& ctx) {
    bool edges[3] = {false, false, false};
    for (int i = 0; i < 3; ++i) {
        if (!exprs_[i]) continue;
        const std::optional<bool> v = exprs_[i]->evalBool(ctx);
        if (!v) continue;
        edges[i] = prev_[i] && !*prev_[i] && *v;
        prev_[i] = *v;
    }
    if (edges[2]) {
        value_ = 0;
        overflow_ = false;
    } else {
        if (edges[0]) {
            if (value_ >= kInt64Max)
                overflow_ = true;
            else
                ++value_;
        }
        if (edges[1] && value_ > 0) --value_;
    }
    publish(ctx.out());
    return false;  // edges only: the same inputs again make none
}

void CounterBlock::stepInputs(std::vector<uint32_t>& out) const {
    for (const auto& e : exprs_)
        if (e) out.insert(out.end(), e->slots().begin(), e->slots().end());
}

void CounterBlock::publish(const SetOut& setOut) const {
    setOut(valueSlot_, TagScalar{value_});
    if (reachedSlot_ != kNoSlot) setOut(reachedSlot_, TagScalar{preset_ && value_ >= *preset_});
}

bool CounterBlock::reset(double value, const SetOut& setOut) {
    // T062: within 2^53 before the cast (a larger double is undefined behaviour as int64)
    constexpr double kMaxSafe = 9007199254740992.0;
    value_ = !(value > 0) ? 0 : static_cast<int64_t>(std::min(value, kMaxSafe));
    overflow_ = false;
    publish(setOut);
    return true;
}

BlockState CounterBlock::state(int64_t) const {
    BlockState s;
    s.kind = "counter";
    s.state = "OK";
    s.hasOverflow = true;
    s.overflow = overflow_;
    return s;
}

void CounterBlock::retain(RetainMap& out) const {
    if (!retained_) return;
    out["logic/" + id_ + "/value"] = std::to_string(value_);
    out["logic/" + id_ + "/overflow"] = overflow_;
}

}  // namespace mat::logic
