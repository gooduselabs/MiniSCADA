// Rules (contracts/logic-engine.md §2) and the rate limits of logic writes (§8): the C++ twin of
// packages/logic-engine/src/rules.ts.
//
// Each scan: DISABLED does nothing. `cond` unknown => SUSPENDED (frozen: stable unchanged, the
// candidate dropped, no action). The first valid scan sets `stable = cond` at once (no hold) and
// runs onRise only with `fireOnStart` and cond true. Then: cond = stable drops the candidate;
// otherwise a candidate (its mark = the first scan that saw it) that holds >= hold changes stable
// and fires the edge. `repeatMs`: while stable is true and onRise has run, again when now - the
// last run >= repeatMs (never in the scan that fired the edge). Each firing increments edgeId
// (retained).
//
// Actions run in declaration order: the value (constant, or an expression evaluated at the firing
// with the target's type) -> write/pulse: outside `allowed` => OUT_OF_LIMITS; logic.writes off =>
// SUPPRESSED; minIntervalMs, maxPerHour (sliding hour: commands with now - t < 3,600,000) of the
// `writes` entry, then the device-wide token bucket => RATE_LIMITED (the rule THROTTLED until 60 s
// after the last refusal). Only QUEUED commands count against the limits.
#pragma once
#include <deque>

#include "core/logic/block.hpp"

namespace mat::logic {

class WriteGate {
   public:
    explicit WriteGate(const nlohmann::json& def);
    bool allows(int64_t now);
    void take(int64_t now);
    const std::string& id() const { return id_; }
    const std::string& tag() const { return tag_; }
    const nlohmann::json& allowed() const { return allowed_; }

   private:
    std::string id_, tag_;
    nlohmann::json allowed_;
    int64_t minIntervalMs_ = 1000;
    int64_t maxPerHour_ = 60;
    std::optional<int64_t> lastSent_;
    std::deque<int64_t> sent_;
};

// The device-wide token bucket (`logic.maxWritesPerMin`), full at start. One token = 60,000 units;
// `perMin` units come back per ms (integers, exact).
class Bucket {
   public:
    explicit Bucket(int perMin);
    bool allows(int64_t now);
    void take();
    // Commands that went out in the last 60 s (GET /logic writes.perMinute).
    int recent(int64_t now);
    // Tests: the times held (T062: never more than a minute of them, recent() called or not).
    size_t held() const { return taken_.size(); }

   private:
    void refill(int64_t now);
    int64_t level_;
    std::optional<int64_t> last_;
    int64_t cap_;
    std::deque<int64_t> taken_;
};

struct CompiledAction {
    std::string doName;  // setTag toggle write pulse
    std::string tag;
    uint32_t slot = kNoSlot;  // of `tag` (toggle reads it)
    WriteGate* write = nullptr;
    bool hasValue = false;
    TagScalar value;
    std::optional<Expr> expr;
    int64_t ms = -1;
};

struct RuleEnv {
    const expr::TableSet* tables = nullptr;
    const Config* config = nullptr;
    Bucket* bucket = nullptr;
};

class RuleBlock : public Block {
   public:
    RuleBlock(const nlohmann::json& def, Expr when, std::vector<CompiledAction> onRise,
              std::vector<CompiledAction> onFall, const RuleEnv& env, const RetainMap* store);
    const std::string& id() const override { return id_; }
    void bind(const SlotOf& slotOf) override;
    void step(ScanCtx& ctx) override;
    BlockState state(int64_t now) const override;
    // state(now).state == "THROTTLED", without building the state (every scan, T148).
    bool throttled(int64_t now) const;
    void retain(RetainMap& out) const override;
    void init(const SetOut&) override {}
    // The final result of a write (FAILED, REJECTED ...) the WriteCoordinator reported.
    void writeResult(const std::string& result) { lastError_ = result; }
    const Expr& when() const { return when_; }

   private:
    void fire(ScanCtx& ctx, bool rise);
    std::string run(ScanCtx& ctx, const CompiledAction& a, ActionOut& out);

    std::string id_;
    bool enabled_ = true;
    bool fireOnStart_ = false;
    int64_t hold_ = 0;
    int64_t repeatMs_ = 0;
    Expr when_;
    std::vector<CompiledAction> onRise_, onFall_;
    RuleEnv env_;
    std::optional<bool> stable_;
    std::optional<bool> candidate_;
    int64_t since_ = 0;
    std::string suspended_;  // "" none
    int64_t edgeId_ = 0;
    std::optional<int64_t> lastRun_;
    std::optional<int64_t> throttledAt_;
    std::optional<std::string> lastError_;
    std::optional<int64_t> lastFired_;
    int64_t fired_ = 0;
};

}  // namespace mat::logic
