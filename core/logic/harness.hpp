// A simulation around the logic engine (packages/logic-engine/src/harness.ts): a Tag store (value +
// quality), a fake clock, a scan at every multiple of scanMs, setTag/toggle applied after each scan
// (effective in the next), retain (flush, restart). The runner of tests/logic-vectors and of the
// unit tests; the same semantics as the TS one (tests/logic-vectors/README.md).
#pragma once
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "core/logic/engine.hpp"

namespace mat::logic {

class Harness {
   public:
    Harness(nlohmann::json doc, EngineOptions options);

    int scanMs() const { return engine_->config().scanMs; }
    int64_t nextScan() const { return lastScan_ ? *lastScan_ + scanMs() : 0; }

    void set(const std::string& id, const expr::InputValue& v) { store_[id] = v; }
    void setGood(const std::string& id, TagScalar v);
    void setNoValue(const std::string& id);
    // The real-time clock: `epochMs` at the monotonic time `at`, then moving with it.
    void setWall(std::optional<int64_t> epochMs, bool synced, int64_t at);
    void setSynced(bool synced) { synced_ = synced; }

    // Scans at every multiple of scanMs in (last scan, t] / (last scan, t).
    std::vector<ActionOut> runTo(int64_t t);
    std::vector<ActionOut> runBefore(int64_t t);

    void flush() { flushed_ = engine_->retainSnapshot(); }
    // A restart: a new engine (a new document when given: the deploy keeps blocks by id), the Tag
    // store empty, retain = the last flush (default; none yet: empty, not damaged), "lost", or the
    // given store. `at`: the first scan of the new engine.
    enum class RetainFrom { Flushed, Lost, Given };
    void restart(const nlohmann::json* doc, RetainFrom from, const RetainMap* given,
                 std::optional<int64_t> at);

    void writeResult(const std::string& rule, const std::string& result) {
        engine_->writeResult(rule, result);
    }
    const Output* output(const std::string& tag) const { return engine_->output(tag); }
    // The stored value of a Tag that is not a logic Tag (setTag/toggle); null: never set.
    const expr::InputValue* stored(const std::string& tag) const;
    std::optional<BlockState> state(const std::string& id) const { return engine_->state(id); }
    RetainMap retainSnapshot() const { return engine_->retainSnapshot(); }
    Engine& engine() { return *engine_; }

   private:
    std::vector<ActionOut> scan(int64_t t);
    expr::InputValue read(const std::string& id) const;

    nlohmann::json doc_;
    EngineOptions options_;
    RetainMap retainHeld_;
    std::unique_ptr<Engine> engine_;
    std::map<std::string, expr::InputValue> store_;
    std::optional<int64_t> lastScan_;
    std::optional<int64_t> wallBase_;
    int64_t wallAt_ = 0;
    bool synced_ = true;
    std::optional<RetainMap> flushed_;
};

}  // namespace mat::logic
