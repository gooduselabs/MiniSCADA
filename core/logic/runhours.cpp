#include "core/logic/runhours.hpp"

#include <algorithm>

#include "core/logic/totalizer.hpp"  // jsRound

namespace mat::logic {

namespace {
constexpr int64_t kMsPerHour = 3600000;
}

RunhoursBlock::RunhoursBlock(const nlohmann::json& def, Expr run, std::optional<Expr> reset,
                             const RetainMap* store)
    : id_(blockId(def)),
      hoursTag_(stringOf(def, "hours").value_or("")),
      startsTag_(stringOf(def, "starts").value_or("")),
      dueTag_(stringOf(def, "due").value_or("")),
      serviceEveryHours_(numberOf(def, "serviceEveryHours")),
      retained_(!isFalse(def, "retain")),
      run_(std::move(run)),
      reset_(std::move(reset)) {
    if (store && retained_) {
        runMs_ = static_cast<int64_t>(
            jsRound(retainNum(store, "logic/" + id_ + "/hours") * static_cast<double>(kMsPerHour)));
        starts_ = static_cast<int64_t>(retainNum(store, "logic/" + id_ + "/starts"));
        const auto last = store->find("logic/" + id_ + "/lastRun");
        if (last != store->end() && last->second.is_boolean()) prevRun_ = last->second.get<bool>();
    }
}

void RunhoursBlock::bind(const SlotOf& slotOf) {
    run_.bind(slotOf);
    if (reset_) reset_->bind(slotOf);
    hoursSlot_ = slotOf(hoursTag_);
    startsSlot_ = optionalSlot(slotOf, startsTag_);
    dueSlot_ = optionalSlot(slotOf, dueTag_);
}

void RunhoursBlock::step(ScanCtx& ctx) {
    const std::optional<bool> v = run_.evalBool(ctx);
    if (!v) {
        lastValid_ = false;
    } else {
        if (lastValid_ && lastT_ && prevRun_ && *prevRun_) runMs_ += ctx.now - *lastT_;
        if (prevRun_ && !*prevRun_ && *v) ++starts_;
        prevRun_ = *v;
        lastValid_ = true;
    }
    lastT_ = ctx.now;
    if (reset_) {
        const std::optional<bool> r = reset_->evalBool(ctx);
        if (r) {
            if (prevReset_ && !*prevReset_ && *r) runMs_ = 0;
            prevReset_ = *r;
        }
    }
    publish(SetOut(*ctx.slots));
}

void RunhoursBlock::publish(const SetOut& setOut) const {
    const double hours = static_cast<double>(runMs_) / static_cast<double>(kMsPerHour);
    setOut(hoursSlot_, TagScalar{hours});
    if (startsSlot_ != kNoSlot) setOut(startsSlot_, TagScalar{starts_});
    if (dueSlot_ != kNoSlot)
        setOut(dueSlot_, TagScalar{serviceEveryHours_ && hours >= *serviceEveryHours_});
}

bool RunhoursBlock::reset(double value, const SetOut& setOut) {
    // T062: within 2^53 ms before the cast (a larger double is undefined behaviour as int64)
    constexpr double kMaxSafe = 9007199254740992.0;
    const double ms = jsRound(value * static_cast<double>(kMsPerHour));
    runMs_ = !(ms > 0) ? 0 : static_cast<int64_t>(std::min(ms, kMaxSafe));
    starts_ = 0;  // POST /logic/reset also clears the starts (contract §6)
    publish(setOut);
    return true;
}

BlockState RunhoursBlock::state(int64_t) const {
    BlockState s;
    s.kind = "runhours";
    s.state = "OK";
    return s;
}

void RunhoursBlock::retain(RetainMap& out) const {
    if (!retained_) return;
    out["logic/" + id_ + "/hours"] = static_cast<double>(runMs_) / static_cast<double>(kMsPerHour);
    out["logic/" + id_ + "/starts"] = starts_;
    if (prevRun_) out["logic/" + id_ + "/lastRun"] = *prevRun_;
}

}  // namespace mat::logic
