#include "core/expression/value_table_json.hpp"

namespace mat::expr {

namespace {
std::optional<double> numberOf(const nlohmann::json& j, const char* key) {
    auto it = j.find(key);
    if (it == j.end()) return std::nullopt;
    if (it->is_boolean()) return it->get<bool>() ? 1.0 : 0.0;
    if (it->is_number()) return it->get<double>();
    return std::nullopt;
}
}  // namespace

ValueTable valueTableFromJson(const nlohmann::json& j) {
    ValueTable t;
    if (j.contains("name") && j["name"].is_string()) t.name = j["name"].get<std::string>();
    if (j.contains("entries") && j["entries"].is_array()) {
        for (const auto& e : j["entries"]) {
            VtEntry v;
            v.value = numberOf(e, "value");
            v.from = numberOf(e, "from");
            v.to = numberOf(e, "to");
            if (e.contains("text") && e["text"].is_string()) v.text = e["text"].get<std::string>();
            if (e.contains("color") && e["color"].is_string())
                v.color = e["color"].get<std::string>();
            t.entries.push_back(std::move(v));
        }
    }
    if (j.contains("default") && j["default"].is_object()) {
        t.hasDefault = true;
        const auto& d = j["default"];
        if (d.contains("text") && d["text"].is_string())
            t.defaultText = d["text"].get<std::string>();
        if (d.contains("color") && d["color"].is_string())
            t.defaultColor = d["color"].get<std::string>();
    }
    return t;
}

}  // namespace mat::expr
