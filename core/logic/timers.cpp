#include "core/logic/timers.hpp"

#include <algorithm>

namespace mat::logic {

TimerBlock::TimerBlock(const nlohmann::json& def, Expr input, int scanMs)
    : id_(blockId(def)),
      kind_(stringOf(def, "kind").value_or("ton")),
      pt_(std::max<int64_t>(static_cast<int64_t>(numberOf(def, "pt").value_or(0)), scanMs)),
      qTag_(stringOf(def, "q").value_or("")),
      etTag_(stringOf(def, "et").value_or("")),
      input_(std::move(input)) {
    k_ = kind_ == "ton" ? Kind::Ton : kind_ == "tof" ? Kind::Tof : Kind::Tp;
}

void TimerBlock::bind(const SlotOf& slotOf) {
    input_.bind(slotOf);
    qSlot_ = slotOf(qTag_);
    etSlot_ = optionalSlot(slotOf, etTag_);
}

void TimerBlock::step(ScanCtx& ctx) {
    const std::optional<bool> cur = input_.evalBool(ctx);
    if (!cur) {
        degraded_ = true;
        lastValid_ = false;
        lastT_ = ctx.now;
        return;
    }
    const int64_t dt = lastValid_ && lastT_ ? ctx.now - *lastT_ : 0;
    const int64_t pt = pt_;
    if (k_ == Kind::Ton) {
        if (*cur) {
            et_ = prevIn_ ? std::min(pt, et_ + dt) : 0;
            q_ = et_ >= pt;
        } else {
            et_ = 0;
            q_ = false;
        }
    } else if (k_ == Kind::Tof) {
        if (*cur) {
            q_ = true;
            et_ = 0;
            running_ = false;
        } else if (prevIn_) {
            running_ = true;
            et_ = 0;
        } else if (running_) {
            et_ = std::min(pt, et_ + dt);
            if (et_ >= pt) {
                q_ = false;
                running_ = false;
            }
        }
    } else if (running_) {  // tp
        et_ = std::min(pt, et_ + dt);
        if (et_ >= pt) {
            q_ = false;
            running_ = false;
        }
    } else if (*cur && !prevIn_) {
        running_ = true;
        q_ = true;
        et_ = 0;
    } else if (!*cur) {
        et_ = 0;
    }
    prevIn_ = *cur;
    lastT_ = ctx.now;
    lastValid_ = true;
    degraded_ = false;
    publish(SetOut(*ctx.slots));
}

void TimerBlock::publish(const SetOut& setOut) const {
    setOut(qSlot_, TagScalar{q_});
    if (etSlot_ != kNoSlot) setOut(etSlot_, TagScalar{et_});
}

BlockState TimerBlock::state(int64_t) const {
    BlockState s;
    s.kind = "timer";
    s.state = "OK";
    s.hasDegraded = true;
    s.degraded = degraded_;
    return s;
}

}  // namespace mat::logic
