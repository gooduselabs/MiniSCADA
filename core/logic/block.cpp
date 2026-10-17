#include "core/logic/block.hpp"

#include <cmath>
#include <stdexcept>

namespace mat::logic {

Expr::Expr(const std::string& src, TagType target, const LogicEnv& env, const std::string& where)
    : src_(src) {
    expr::CompileEnv ce;
    ce.tagType = env.tagType;
    ce.hasTable = env.hasTable;
    ce.target = target;
    expr::CompileResult r = expr::compile(src, ce);
    if (!r.ok)
        throw std::invalid_argument("logic: " + where + ": biểu thức '" + src + "' không hợp lệ (" +
                                    r.errors[0].code + ")");
    program_ = std::move(r.program);
}

void Expr::bind(const std::function<uint32_t(const std::string&)>& slotOf) {
    slots_.clear();
    for (const std::string& id : program_.inputs) slots_.push_back(slotOf(id));
    vals_.resize(slots_.size());
    seen_.assign(slots_.size(), 0);
    hasLast_ = false;
}

const Expr::Result& Expr::eval(const ScanCtx& ctx) const {
    // T148: the language has no state and no clock (core/expression) and the value tables do not
    // change while the engine runs, so the same inputs give the same result: when no input slot
    // changed since the last evaluation (Slot::version) the VM does not run (about 1 us per
    // expression on the BL335). A NaN never compares equal: its slot changes at every scan.
    const std::vector<Slot>& slots = *ctx.slots;
    if (hasLast_) {
        bool same = true;
        for (size_t i = 0; i < slots_.size() && same; ++i)
            same = slots[slots_[i]].version == seen_[i];
        if (same) return lastResult_;
    }
    for (size_t i = 0; i < slots_.size(); ++i) {
        const Slot& s = slots[slots_[i]];
        vals_[i] = s.cur;
        seen_[i] = s.version;
    }
    lastResult_ = compute(vals_, *ctx.tables);
    hasLast_ = true;
    return lastResult_;
}

Expr::Result Expr::compute(const std::vector<expr::InputValue>& vals,
                           const expr::TableSet& tables) const {
    expr::EvalResult r = expr::evaluate(program_, vals.data(), tables);
    Result out;
    if (r.quality == Quality::GOOD && !std::holds_alternative<std::monostate>(r.value)) {
        out.ok = true;
        out.value = std::move(r.value);
        return out;
    }
    for (const auto& v : vals)
        if (v.quality == Quality::BAD && v.reason == "TIME_NOT_SYNCED") {
            out.reason = "TIME_NOT_SYNCED";
            return out;
        }
    for (const auto& v : vals)
        if (v.quality != Quality::GOOD || std::holds_alternative<std::monostate>(v.value)) {
            out.reason = "INPUT_BAD";
            return out;
        }
    out.reason = "EXPR_ERROR";
    return out;
}

std::optional<bool> Expr::evalBool(const ScanCtx& ctx) const {
    const Result& r = eval(ctx);
    if (!r.ok) return std::nullopt;
    const bool* b = std::get_if<bool>(&r.value);
    return b != nullptr && *b;
}

void setSlot(Slot& s, TagScalar value, const char* bad) {
    const bool good = bad[0] == 0;
    if (s.set && s.out.good == good && s.out.reason == bad && s.out.value == value) return;
    s.changed = true;
    s.out.value = std::move(value);
    s.out.good = good;
    s.out.reason = bad;
    s.cur.value = s.out.value;
    s.cur.quality = good ? Quality::GOOD : Quality::BAD;
    s.cur.reason = bad;
    ++s.version;
    s.set = true;
}

double retainNum(const RetainMap* store, const std::string& key) {
    if (!store) return 0;
    const auto it = store->find(key);
    if (it == store->end() || !it->second.is_number()) return 0;
    const double d = it->second.get<double>();
    return std::isfinite(d) ? d : 0;
}

const nlohmann::json* member(const nlohmann::json& o, const char* key) {
    if (!o.is_object()) return nullptr;
    const auto it = o.find(key);
    return it == o.end() ? nullptr : &*it;
}

std::optional<double> numberOf(const nlohmann::json& o, const char* key) {
    const nlohmann::json* m = member(o, key);
    if (!m || !m->is_number()) return std::nullopt;
    return m->get<double>();
}

std::optional<std::string> stringOf(const nlohmann::json& o, const char* key) {
    const nlohmann::json* m = member(o, key);
    if (!m || !m->is_string()) return std::nullopt;
    return m->get<std::string>();
}

bool isFalse(const nlohmann::json& o, const char* key) {
    const nlohmann::json* m = member(o, key);
    return m && m->is_boolean() && !m->get<bool>();
}

bool isTrue(const nlohmann::json& o, const char* key) {
    const nlohmann::json* m = member(o, key);
    return m && m->is_boolean() && m->get<bool>();
}

}  // namespace mat::logic
