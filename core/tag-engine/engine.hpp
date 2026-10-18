// Tag Engine v1 (ADR-017, research R5, R6): runs on the tick loop of the runtime, right before
// hub.tick(). One round, step(now):
//   1. the stepped drivers (simulation) publish for `now`;
//   2. the inbox is swapped out: updates from the drivers, write results, commands that set
//   internal Tags;
//   3. external Tags: scaling, NaN check, deadband; simulation Tags; internal Tags;
//   4. calculated Tags once, in topological order, only those with an input that changed in this
//   round;
//   5. everything that changed goes into the TagStore in ONE applyBatch (one lock): the live hub
//   and
//      the historian never see a half-applied round, and a calculated Tag always comes in the same
//      delta as its inputs;
//   6. retained Tags that changed are reported, and write results are handed on.
// Quality carries a reason code (data-model §6). A Tag that turns BAD keeps its last value
// (FR-010).
#pragma once
#include <functional>
#include <map>
#include <mutex>
#include <string>
#include <vector>

#include "core/expression/expression.hpp"
#include "core/tag-engine/calc_graph.hpp"
#include "core/tag-engine/tag_model.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "drivers/sdk/driver.hpp"

namespace mat {

// Feature 011 (logic v2, T136; FR-076, FR-084): what the logic sees of one engine round. The values
// are those of this round once the drivers, the internal and the calculated Tags are applied (one
// snapshot, under the engine's single round); publish() sets a logic Tag in the same batch of the
// TagStore, setInternal() an internal Tag in the next round (a setTag/toggle of a rule).
class EngineRound {
   public:
    virtual ~EngineRound() = default;
    virtual expr::InputValue read(size_t tag) const = 0;
    // T148: a number that moves whenever the value, quality or reason of `tag` changes (never
    // otherwise), so a reader that saw it reads the Tag again only when it moved; 0: unknown
    // (read it).
    virtual uint64_t version(size_t tag) const {
        (void)tag;
        return 0;
    }
    virtual void publish(size_t tag, TagScalar value, Quality quality,
                         const std::string& reason) = 0;
    virtual void setInternal(size_t tag, TagScalar value) = 0;
    virtual int64_t now() const = 0;  // the round's time (epoch ms)
};

class Engine : public drv::EngineSink {
   public:
    // `store` already holds the Tags of `model` in model order (store index == model index);
    // see addModelTagsToStore. The model outlives the engine.
    Engine(TagStore& store, const ProjectModel& model);

    // Values read back from the retained store at startup (Tag index -> value); `lost`: the store
    // could not be read, retained Tags start from `initial` as UNCERTAIN RETAIN_LOST. Before
    // step().
    void applyRetained(const std::map<size_t, TagScalar>& values, bool lost);
    // Called from step() for a retained Tag whose value changed.
    void setRetainObserver(std::function<void(size_t tag, const TagScalar& value)> fn) {
        retainObserver_ = std::move(fn);
    }
    // Called from step() for every write result a driver reported.
    void setWriteResultHandler(std::function<void(const drv::WriteResult&)> fn) {
        writeHandler_ = std::move(fn);
    }
    // Feature 011: the logic subsystem, called once per round right after the calculated Tags and
    // before the batch goes to the store; calculated Tags that read a logic Tag the hook changed
    // are evaluated again in the same round. One thread (the tick loop).
    void setRoundHook(std::function<void(EngineRound&)> fn) { roundHook_ = std::move(fn); }
    // Drivers without a thread (simulation): step(now) at the start of every round.
    void addSteppedDriver(drv::Driver* d) { stepped_.push_back(d); }

    // EngineSink: any thread.
    void publish(std::vector<drv::TagUpdate>&& updates) override;
    void writeDone(drv::WriteResult&& result) override;
    // A command that sets an internal Tag (already checked by the caller); applied in the next
    // round.
    // With a non-zero writeId the round that applies it hands a WriteResult on (APPLIED, or
    // FAILED when the value cannot be applied): the answer of a write to an internal Tag (FR-038).
    void setInternal(size_t tag, TagScalar value, uint64_t writeId = 0);

    // The tick loop, one thread. `stepDrivers` false (feature 011 T148: a round of the tick loop
    // for the logic scan only, between two delta rounds): the stepped drivers (simulation) are not
    // stepped, everything else of the round runs.
    void step(int64_t nowMs, bool stepDrivers = true);

    // Compile errors of calculated Tags (none for a validated project): "tag: code".
    const std::vector<std::string>& compileErrors() const { return compileErrors_; }
    size_t calculatedCount() const { return calcs_.size(); }
    // The Tags a calculated Tag reads; null for any other Tag. For the diagnostics.
    const std::vector<size_t>* inputsOf(size_t tag) const {
        for (const Calc& c : calcs_)
            if (c.tag == tag) return &c.inputs;
        return nullptr;
    }
    // Tags that have a retain flag, for the retained store.
    const std::vector<size_t>& retainedTags() const { return retained_; }

   private:
    struct State {
        TagScalar value;
        Quality quality = Quality::BAD;
        std::string reason = "NO_VALUE";
        int64_t sourceTs = 0;
        uint64_t version = 1;  // EngineRound::version: moves with value, quality or reason
    };
    struct Calc {
        size_t tag;
        expr::Program program;
        std::vector<size_t> inputs;  // tag index per program input
    };
    struct Candidate {
        TagScalar value;  // monostate: keep the last value
        Quality quality = Quality::GOOD;
        std::string reason;
        int64_t sourceTs = 0;
        bool force = false;  // publish even inside the deadband (value read back after a write)
    };

    void commit(size_t i, Candidate c, int64_t now);
    void applyUpdate(const drv::TagUpdate& u, int64_t now);
    void evaluate(const Calc& calc, int64_t now);
    static bool sameValue(const TagScalar& a, const TagScalar& b);
    static bool numeric(const TagScalar& v, double& out);

    TagStore& store_;
    const ProjectModel& model_;
    std::vector<State> state_;
    std::vector<uint8_t> changed_;  // changed in this round
    std::vector<uint8_t> inBatch_;  // already in batch_
    std::vector<TagStore::Update> batch_;
    std::vector<Calc> calcs_;  // in calculation order
    std::vector<size_t> retained_;
    std::vector<std::string> compileErrors_;
    bool first_ = true;
    int64_t serverNow_ = 0;

    std::mutex inboxMu_;
    std::vector<drv::TagUpdate> inboxUpdates_;
    std::vector<drv::WriteResult> inboxResults_;
    struct SetCommand {
        size_t tag;
        TagScalar value;
        uint64_t writeId;
    };
    std::vector<SetCommand> inboxSets_;

    std::vector<drv::Driver*> stepped_;
    std::function<void(size_t, const TagScalar&)> retainObserver_;
    std::function<void(const drv::WriteResult&)> writeHandler_;
    std::function<void(EngineRound&)> roundHook_;
    class Round;
};

// Adds the Tags of `model` to `store`, in model order (the index of a Tag is its model index).
// `signal` of a legacy simulation Tag is kept in TagDef::signal.
void addModelTagsToStore(const ProjectModel& model, TagStore& store);

}  // namespace mat
