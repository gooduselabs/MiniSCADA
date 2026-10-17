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
};

inline bool sameInput(const expr::InputValue& a, const expr::InputValue& b) {
    return a.quality == b.quality && a.value == b.value && a.reason == b.reason;
}

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

// Sets a slot as the engine's setOut did (value, GOOD when `bad` is empty, else BAD `bad`).
void setSlot(Slot& s, TagScalar value, const char* bad);

struct ScanCtx {
    int64_t now = 0;
    const WallClock* wall = nullptr;
    const expr::TableSet* tables = nullptr;
    const Config* config = nullptr;
    std::vector<Slot>* slots = nullptr;
    const ReadAt* readAt = nullptr;
    std::vector<ActionOut>* actions = nullptr;

    // A logic Tag a block set (in this scan or an earlier one), else the snapshot.
    const expr::InputValue& read(uint32_t slot) const { return (*slots)[slot].cur; }
    void setOut(uint32_t slot, TagScalar value, const char* bad = "") const {
        setSlot((*slots)[slot], std::move(value), bad);
    }
    void emit(ActionOut&& a) const { actions->push_back(std::move(a)); }
};

// The outputs outside a scan (init, POST /logic/reset).
class SetOut {
   public:
    explicit SetOut(std::vector<Slot>& slots) : slots_(slots) {}
    void operator()(uint32_t slot, TagScalar value, const char* bad = "") const {
        setSlot(slots_[slot], std::move(value), bad);
    }

   private:
    std::vector<Slot>& slots_;
};

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
    virtual void step(ScanCtx& ctx) = 0;
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
