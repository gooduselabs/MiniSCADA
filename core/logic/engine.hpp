// The logic v2 engine (feature 011, T134; contracts/logic-engine.md; ADR-037; research R20 to R23),
// the C++ twin of packages/logic-engine/src/engine.ts: the same vectors (tests/logic-vectors) give
// the same actions, outputs, states and retained values. Pure: the monotonic clock (`now`) and the
// real-time clock (`wall`) are injected at each scan; no I/O, no threads, no locks (the caller
// serialises). The document must have passed the validator (rules_logic): an expression that does
// not compile, or a cycle, makes the constructor throw std::invalid_argument.
//
// One scan, step(now, read, wall): the blocks run in the stable topological order (logicGraph, ties
// by id); a block reading an output of a block before it sees the value of this same scan; every
// other Tag is read from the snapshot `read` (setTag/toggle are applied by the caller after the
// scan, effective in the next one).
#pragma once
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "core/logic/block.hpp"
#include "core/logic/order.hpp"
#include "core/logic/rules.hpp"
#include "core/logic/types.hpp"

namespace mat::logic {

struct EngineOptions {
    TagInfoMap tags;
    Config config;
    // The retain store read at start; null: none (empty). `retainLost`: the store was damaged:
    // every block starts at 0 and retainLost() is true (LOGIC_RETAIN_LOST, audit
    // logic.retain.lost).
    const RetainMap* retain = nullptr;
    bool retainLost = false;
    const expr::TableSet* tables = nullptr;  // null: no value table
};

class Engine {
   public:
    Engine(const nlohmann::json& doc, const EngineOptions& options);
    ~Engine();
    Engine(const Engine&) = delete;
    Engine& operator=(const Engine&) = delete;

    // One scan at `now` (monotonic ms, increasing). The actions in the order they ran.
    std::vector<ActionOut> step(int64_t now, const ReadTag& read, const WallClock& wall);

    // The current value of a logic Tag; null when `tag` is not one.
    const Output* output(const std::string& tag) const;
    // The logic Tags (the first output of each tag).
    const std::map<std::string, LogicOutput>& outputTags() const { return outputDefs_; }
    // The state of a block (GET /logic) at the last scan; nullopt: no such block.
    std::optional<BlockState> state(const std::string& id) const;
    // The blocks in scan order.
    std::vector<std::string> blockIds() const;
    // The final result of a write (FAILED, REJECTED ...): into the rule's lastError.
    void writeResult(const std::string& rule, const std::string& result);
    // The retained values (keys logic/<id>/<field>), written every logic.flushS and at stop.
    RetainMap retainSnapshot() const;
    bool retainLost() const { return retainLost_; }
    const Config& config() const { return config_; }

    // Runtime: the administrator's stop (writes become SUPPRESSED) or logic.writes off.
    void setWritesOn(bool on) { config_.writesOn = on; }
    // POST /logic/reset: a counter, totalizer or run-hours block back to `value`. false: no such
    // block, or one that cannot be reset.
    bool reset(const std::string& id, double value);
    // The Tags the condition of a rule reads (empty for another block).
    std::vector<std::string> inputsOf(const std::string& rule) const;
    // Commands that went out in the last 60 s.
    int writesLastMinute(int64_t now) { return bucket_->recent(now); }

   private:
    void setOut(const std::string& tag, TagScalar value, const std::string& bad);

    Config config_;
    bool retainLost_ = false;
    expr::TableSet noTables_;
    const expr::TableSet* tables_ = nullptr;
    std::map<std::string, LogicOutput> outputDefs_;
    std::map<std::string, Output> outputs_;
    std::vector<std::unique_ptr<WriteGate>> gates_;
    std::unique_ptr<Bucket> bucket_;
    std::map<std::string, std::unique_ptr<Block>> blocks_;
    std::vector<Block*> order_;
    int64_t now_ = 0;
};

}  // namespace mat::logic
