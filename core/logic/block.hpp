// Internal interface between the engine and each kind of block (packages/logic-engine/src/block.ts,
// expr.ts). Not for other modules.
#pragma once
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "core/logic/order.hpp"
#include "core/logic/types.hpp"

namespace mat::logic {

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
    Result eval(const ReadTag& read, const expr::TableSet& tables) const;
    // BOOL value; nullopt when unknown.
    std::optional<bool> evalBool(const ReadTag& read, const expr::TableSet& tables) const;
    const std::vector<std::string>& inputs() const { return program_.inputs; }
    const std::string& src() const { return src_; }

   private:
    expr::Program program_;
    std::string src_;
};

struct ScanCtx {
    int64_t now = 0;
    ReadTag read;
    const WallClock* wall = nullptr;
    const expr::TableSet* tables = nullptr;
    const Config* config = nullptr;
    std::function<void(const std::string& tag, TagScalar value, const std::string& bad)> setOut;
    std::function<void(ActionOut&&)> emit;
};
using SetOut = std::function<void(const std::string& tag, TagScalar value, const std::string& bad)>;

class Block {
   public:
    virtual ~Block() = default;
    virtual const std::string& id() const = 0;
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
