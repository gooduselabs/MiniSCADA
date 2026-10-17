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

Expr::Result Expr::eval(const ReadTag& read, const expr::TableSet& tables) const {
    std::vector<expr::InputValue> vals;
    vals.reserve(program_.inputs.size());
    for (const std::string& id : program_.inputs) vals.push_back(read(id));
    const expr::EvalResult r = expr::evaluate(
        program_, [&](size_t i) { return vals[i]; }, tables);
    Result out;
    if (r.quality == Quality::GOOD && !std::holds_alternative<std::monostate>(r.value)) {
        out.ok = true;
        out.value = r.value;
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

std::optional<bool> Expr::evalBool(const ReadTag& read, const expr::TableSet& tables) const {
    const Result r = eval(read, tables);
    if (!r.ok) return std::nullopt;
    const bool* b = std::get_if<bool>(&r.value);
    return b != nullptr && *b;
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
