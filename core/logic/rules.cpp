#include "core/logic/rules.hpp"

#include <algorithm>

namespace mat::logic {

namespace {

constexpr int64_t kHourMs = 3600000;
constexpr int64_t kToken = 60000;

}  // namespace

// ---- WriteGate ----

WriteGate::WriteGate(const nlohmann::json& def)
    : id_(blockId(def)),
      tag_(stringOf(def, "tag").value_or("")),
      allowed_(def.value("allowed", nlohmann::json::object())),
      minIntervalMs_(static_cast<int64_t>(numberOf(def, "minIntervalMs").value_or(1000))),
      maxPerHour_(static_cast<int64_t>(numberOf(def, "maxPerHour").value_or(60))) {}

bool WriteGate::allows(int64_t now) {
    if (lastSent_ && now - *lastSent_ < minIntervalMs_) return false;
    while (!sent_.empty() && now - sent_.front() >= kHourMs) sent_.pop_front();
    return static_cast<int64_t>(sent_.size()) < maxPerHour_;
}

void WriteGate::take(int64_t now) {
    lastSent_ = now;
    sent_.push_back(now);
}

// ---- Bucket ----

Bucket::Bucket(int perMin) : level_(static_cast<int64_t>(perMin) * kToken), cap_(perMin) {}

void Bucket::refill(int64_t now) {
    if (last_) level_ = std::min(cap_ * kToken, level_ + (now - *last_) * cap_);
    last_ = now;
}

bool Bucket::allows(int64_t now) {
    refill(now);
    return level_ >= kToken;
}

void Bucket::take() {
    level_ -= kToken;
    const int64_t now = last_.value_or(0);
    taken_.push_back(now);
    // T062: trimmed here too, so that nobody reading GET /logic does not mean a growing deque
    while (!taken_.empty() && now - taken_.front() >= 60000) taken_.pop_front();
}

int Bucket::recent(int64_t now) {
    while (!taken_.empty() && now - taken_.front() >= 60000) taken_.pop_front();
    return static_cast<int>(taken_.size());
}

// ---- RuleBlock ----

RuleBlock::RuleBlock(const nlohmann::json& def, Expr when, std::vector<CompiledAction> onRise,
                     std::vector<CompiledAction> onFall, const RuleEnv& env, const RetainMap* store)
    : id_(blockId(def)),
      enabled_(!isFalse(def, "enabled")),
      fireOnStart_(isTrue(def, "fireOnStart")),
      hold_(static_cast<int64_t>(numberOf(def, "hold").value_or(0))),
      repeatMs_(static_cast<int64_t>(numberOf(def, "repeatMs").value_or(0))),
      when_(std::move(when)),
      onRise_(std::move(onRise)),
      onFall_(std::move(onFall)),
      env_(env) {
    edgeId_ = static_cast<int64_t>(retainNum(store, "logic/" + id_ + "/edgeId"));
}

void RuleBlock::bind(const SlotOf& slotOf) {
    when_.bind(slotOf);
    for (auto* list : {&onRise_, &onFall_})
        for (CompiledAction& a : *list) {
            a.slot = slotOf(a.tag);
            if (a.expr) a.expr->bind(slotOf);
        }
}

void RuleBlock::stepInputs(std::vector<uint32_t>& out) const {
    // the actions' values and toggles are read only when an edge fires, in a scan that runs
    out.insert(out.end(), when_.slots().begin(), when_.slots().end());
}

bool RuleBlock::timed() const {
    // a candidate waiting for its hold, or a repeat: both move with time alone
    return candidate_.has_value() || (stable_ && *stable_ && repeatMs_ > 0 && lastRun_);
}

bool RuleBlock::step(ScanCtx& ctx) {
    if (!enabled_) return false;
    const Expr::Result& r = when_.eval(ctx);
    if (!r.ok) {
        suspended_ = r.reason;
        candidate_.reset();
        return false;
    }
    suspended_.clear();
    const bool* b = std::get_if<bool>(&r.value);
    const bool cond = b != nullptr && *b;
    if (!stable_) {
        stable_ = cond;
        if (cond && fireOnStart_) fire(ctx, true);
        return timed();
    }
    if (cond == *stable_) {
        candidate_.reset();
    } else {
        if (!candidate_ || *candidate_ != cond) {
            candidate_ = cond;
            since_ = ctx.now;
        }
        if (ctx.now - since_ >= hold_) {
            stable_ = cond;
            candidate_.reset();
            fire(ctx, cond);
            if (!cond) lastRun_.reset();
            return timed();
        }
    }
    if (*stable_ && repeatMs_ > 0 && lastRun_ && ctx.now - *lastRun_ >= repeatMs_) fire(ctx, true);
    return timed();
}

void RuleBlock::fire(ScanCtx& ctx, bool rise) {
    ++edgeId_;
    ++fired_;
    lastFired_ = ctx.now;
    if (rise) lastRun_ = ctx.now;
    const std::vector<CompiledAction>& list = rise ? onRise_ : onFall_;
    for (size_t i = 0; i < list.size(); ++i) {
        const CompiledAction& a = list[i];
        ActionOut out;
        out.t = ctx.now;
        out.rule = id_;
        out.edgeId = edgeId_;
        out.edge = rise ? "rise" : "fall";
        out.index = static_cast<int>(i);
        out.doName = a.doName;
        out.tag = a.tag;
        if (a.write) out.write = a.write->id();
        out.ms = a.ms;
        out.result = run(ctx, a, out);
        if (out.result != "OK" && out.result != "QUEUED" && out.result != "SUPPRESSED")
            lastError_ = out.result;
        ctx.emit(std::move(out));
    }
}

std::string RuleBlock::run(ScanCtx& ctx, const CompiledAction& a, ActionOut& out) {
    if (a.doName == "toggle") {
        const expr::InputValue cur = ctx.read(a.slot);
        const bool* b = std::get_if<bool>(&cur.value);
        if (cur.quality != Quality::GOOD || b == nullptr) return "NO_VALUE";
        out.hasValue = true;
        out.value = !*b;
        return "OK";
    }
    TagScalar value;
    if (a.expr) {
        const Expr::Result& r = a.expr->eval(ctx);
        if (!r.ok) return "EXPR_ERROR";
        value = r.value;
    } else {
        value = a.value;
    }
    out.hasValue = true;
    out.value = value;
    if (a.doName == "setTag") return "OK";
    WriteGate& gate = *a.write;
    if (!logicAllowed(gate.allowed(), value)) return "OUT_OF_LIMITS";
    if (!env_.config->writesOn) return "SUPPRESSED";
    if (!gate.allows(ctx.now) || !env_.bucket->allows(ctx.now)) {
        throttledAt_ = ctx.now;
        if (env_.lastThrottledAt) *env_.lastThrottledAt = ctx.now;
        return "RATE_LIMITED";
    }
    gate.take(ctx.now);
    env_.bucket->take();
    return "QUEUED";
}

BlockState RuleBlock::state(int64_t now) const {
    BlockState s;
    s.kind = "rule";
    s.isRule = true;
    s.stable = stable_;
    s.edgeId = edgeId_;
    s.lastError = lastError_;
    s.lastFiredMono = lastFired_;
    s.fired = fired_;
    if (!enabled_)
        s.state = "DISABLED";
    else if (!suspended_.empty()) {
        s.state = "SUSPENDED";
        s.reason = suspended_;
    } else if (throttled(now))
        s.state = "THROTTLED";
    else
        s.state = "OK";
    return s;
}

bool RuleBlock::throttled(int64_t now) const {
    return enabled_ && suspended_.empty() && throttledAt_ && now - *throttledAt_ < kThrottleHoldMs;
}

void RuleBlock::retain(RetainMap& out) const { out["logic/" + id_ + "/edgeId"] = edgeId_; }

}  // namespace mat::logic
