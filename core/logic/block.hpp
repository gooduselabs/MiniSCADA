// Internal interface between the engine and each kind of block (packages/logic-engine/src/block.ts,
// expr.ts). Not for other modules.
//
// T148 (the scan on the BL335): every Tag name the blocks read or set is a slot of the engine,
// resolved once when the engine is built; a scan looks nothing up by name and allocates only for
// the actions it emits.
#pragma once
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "core/logic/order.hpp"
#include "core/logic/types.hpp"

namespace mat::logic {

// A Tag the logic reads or sets. A slot holds the value of a logic Tag once a block set it; a slot
// never set (a Tag of tags.json, or a logic Tag before its first value) is read from the caller's
// snapshot (ReadAt, by the same index).
struct Slot {
    std::string tag;
    Output out;
    bool set = false;      // a block set it
    bool changed = false;  // value, quality or reason changed since Engine::takeChanged
    // What an expression reads: `out` once set, else the caller's snapshot (read once at the start
    // of each scan); `version` grows when it changes (T148: Expr skips the VM when no input moved).
    expr::InputValue cur;
    uint64_t version = 0;
    uint64_t source = 0;  // VersionAt of the snapshot's Tag when `cur` was read (0: none)
};

inline bool sameInput(const expr::InputValue& a, const expr::InputValue& b) {
    return a.quality == b.quality && a.value == b.value && a.reason == b.reason;
}

// T148 (the CPU of the BL335): what the engine keeps beside the slots so that a scan touches only
// what moved. A block is stepped when it is due: a slot its step reads changed (the readers of a
// slot are woken when its version moves), or its last step said its state moves with time
// (Block::step returned true), or it never ran. `changed` lists the slots whose Slot::changed
// went up (Engine::takeChanged reads only those).
struct SlotTracker {
    std::vector<uint32_t> readerStart;  // slot s: readers[readerStart[s] .. readerStart[s + 1])
    std::vector<uint32_t> readers;      // scan positions of the blocks whose step reads the slot
    std::vector<uint8_t> due;           // scan position -> step it at the next scan
    std::vector<uint32_t> changed;      // slots whose `changed` flag went up, in that order
    void wake(uint32_t slot) {
        if (slot + 1 >= readerStart.size()) return;
        for (uint32_t i = readerStart[slot]; i < readerStart[slot + 1]; ++i) due[readers[i]] = 1;
    }
};

struct ScanCtx;

// An expression of logic (ADR-015 through core/expression). A result that is not GOOD is
// "unknown" (contract §2.1) with its reason: TIME_NOT_SYNCED when an input is a schedule output
// without a synced clock, INPUT_BAD when an input is not GOOD or has no value, else EXPR_ERROR.
class Expr {
   public:
    // Throws std::invalid_argument when the expression does not compile.
    Expr(const std::string& src, TagType target, const LogicEnv& env, const std::string& where);
    struct Result {
        bool ok = false;
        TagScalar value;
        std::string reason;  // when !ok
    };
    // The slots of the inputs (engine construction, before any scan).
    void bind(const std::function<uint32_t(const std::string&)>& slotOf);
    // The result stays valid until the next eval of this expression.
    const Result& eval(const ScanCtx& ctx) const;
    // BOOL value; nullopt when unknown.
    std::optional<bool> evalBool(const ScanCtx& ctx) const;
    const std::vector<std::string>& inputs() const { return program_.inputs; }
    const std::string& src() const { return src_; }
    // The slots of the inputs (after bind).
    const std::vector<uint32_t>& slots() const { return slots_; }

   private:
    Result compute(const std::vector<expr::InputValue>& vals, const expr::TableSet& tables) const;

    expr::Program program_;
    std::string src_;
    std::vector<uint32_t> slots_;                 // of program_.inputs
    mutable std::vector<expr::InputValue> vals_;  // the inputs of the last evaluation
    mutable std::vector<uint64_t> seen_;          // the versions of their slots then
    mutable Result lastResult_;
    mutable bool hasLast_ = false;
};

// Sets slot `i` as the engine's setOut did (value, GOOD when `bad` is empty, else BAD `bad`); when
// it changed, its readers are woken and it is listed for takeChanged.
void setSlot(std::vector<Slot>& slots, SlotTracker& track, uint32_t i, TagScalar value,
             const char* bad);

class SetOut;

struct ScanCtx {
    int64_t now = 0;
    // the time of the previous scan of the engine (none: this is the first)
    bool hasPrev = false;
    int64_t prev = 0;
    const WallClock* wall = nullptr;
    const expr::TableSet* tables = nullptr;
    const Config* config = nullptr;
    std::vector<Slot>* slots = nullptr;
    SlotTracker* track = nullptr;
    std::vector<ActionOut>* actions = nullptr;

    // A logic Tag a block set (in this scan or an earlier one), else the snapshot.
    const expr::InputValue& read(uint32_t slot) const { return (*slots)[slot].cur; }
    void setOut(uint32_t slot, TagScalar value, const char* bad = "") const {
        setSlot(*slots, *track, slot, std::move(value), bad);
    }
    inline SetOut out() const;
    void emit(ActionOut&& a) const { actions->push_back(std::move(a)); }
};

// The outputs of a block (a scan, init, POST /logic/reset).
class SetOut {
   public:
    SetOut(std::vector<Slot>& slots, SlotTracker& track) : slots_(slots), track_(track) {}
    void operator()(uint32_t slot, TagScalar value, const char* bad = "") const {
        setSlot(slots_, track_, slot, std::move(value), bad);
    }

   private:
    std::vector<Slot>& slots_;
    SlotTracker& track_;
};

SetOut ScanCtx::out() const { return SetOut(*slots, *track); }

// Resolves a Tag name to its slot (engine construction).
using SlotOf = std::function<uint32_t(const std::string&)>;
constexpr uint32_t kNoSlot = UINT32_MAX;  // an optional output that is not declared
// The slot of an optional output: kNoSlot when `tag` is empty.
inline uint32_t optionalSlot(const SlotOf& slotOf, const std::string& tag) {
    return tag.empty() ? kNoSlot : slotOf(tag);
}

class Block {
   public:
    virtual ~Block() = default;
    virtual const std::string& id() const = 0;
    // The slots of the Tags the block reads and sets (once, before init()).
    virtual void bind(const SlotOf& slotOf) = 0;
    // The slots of the expressions step() evaluates (after bind): a change of one makes the block
    // due (SlotTracker).
    virtual void stepInputs(std::vector<uint32_t>& out) const = 0;
    // One scan. true: the state moves with time (a timer running, a pending hold, a repeat, run
    // hours counting, a totalizer, a schedule), so the block is due at the next scan even when no
    // input changes; false: another step with the same inputs, at any later time, would change
    // nothing (no state, output, action).
    virtual bool step(ScanCtx& ctx) = 0;
    virtual BlockState state(int64_t now) const = 0;
    // The retained fields of the block into `out` (only when the block is retained).
    virtual void retain(RetainMap& out) const = 0;
    // The outputs before the first scan.
    virtual void init(const SetOut& setOut) = 0;
    // POST /logic/reset: counter, totalizer, run hours back to `value` (0). false: not resettable.
    virtual bool reset(double value, const SetOut& setOut) {
        (void)value;
        (void)setOut;
        return false;
    }
};

// A safe number from the retain store (missing or of another type: 0).
double retainNum(const RetainMap* store, const std::string& key);

// Members of a block document.
const nlohmann::json* member(const nlohmann::json& o, const char* key);
std::optional<double> numberOf(const nlohmann::json& o, const char* key);
std::optional<std::string> stringOf(const nlohmann::json& o, const char* key);
bool isFalse(const nlohmann::json& o, const char* key);  // key present and false
bool isTrue(const nlohmann::json& o, const char* key);   // key present and true

}  // namespace mat::logic
