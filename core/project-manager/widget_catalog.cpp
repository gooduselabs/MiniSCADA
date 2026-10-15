#include "core/project-manager/widget_catalog.hpp"

#include <algorithm>
#include <cmath>
#include <fstream>
#include <set>
#include <sstream>

namespace mat {

using nlohmann::json;

namespace {

bool isIntegerNumber(const json& v) {
    if (v.is_number_integer()) return true;
    if (!v.is_number_float()) return false;
    const double d = v.get<double>();
    return std::isfinite(d) && d == std::floor(d);
}

bool isHexColor(const std::string& s) {
    if (s.size() != 7 || s[0] != '#') return false;
    for (size_t i = 1; i < 7; ++i)
        if (!std::isxdigit(static_cast<unsigned char>(s[i]))) return false;
    return true;
}

std::string checkRange(const json& spec, double v) {
    if (spec.contains("min") && v < spec["min"].get<double>()) return "below min";
    if (spec.contains("max") && v > spec["max"].get<double>()) return "above max";
    if (spec.contains("exclusiveMin") && v <= spec["exclusiveMin"].get<double>())
        return "must be greater than limit";
    return "";
}

std::string checkZones(const json& zones) {
    std::vector<std::pair<double, double>> z;
    for (const auto& e : zones) {
        const double from = e["from"].get<double>(), to = e["to"].get<double>();
        if (!(from < to)) return "zone from must be < to";
        z.emplace_back(from, to);
    }
    std::sort(z.begin(), z.end());
    for (size_t i = 1; i < z.size(); ++i)
        if (z[i].first < z[i - 1].second) return "zones overlap";
    return "";
}

}  // namespace

size_t codePointCount(const std::string& s) {
    size_t n = 0;
    for (const unsigned char c : s)
        if ((c & 0xC0) != 0x80) ++n;
    return n;
}

std::string tagClassOf(const std::string& type) {
    if (type == "BOOL") return "bool";
    if (type == "STRING") return "string";
    return "number";
}

std::string checkPropValue(const json& spec, const json& value) {
    const std::string kind = spec.value("kind", "");
    if (kind == "string") {
        if (!value.is_string()) return "expected string";
        if (spec.contains("maxLength") &&
            codePointCount(value.get<std::string>()) > spec["maxLength"].get<size_t>())
            return "too long";
        return "";
    }
    if (kind == "int") {
        if (!value.is_number() || !isIntegerNumber(value)) return "expected integer";
        return checkRange(spec, value.get<double>());
    }
    if (kind == "number") {
        if (!value.is_number() || !std::isfinite(value.get<double>()))
            return "expected finite number";
        return checkRange(spec, value.get<double>());
    }
    if (kind == "bool") return value.is_boolean() ? "" : "expected boolean";
    if (kind == "enum") {
        if (!value.is_string()) return "not an allowed option";
        for (const auto& o : spec.value("options", json::array()))
            if (o == value) return "";
        return "not an allowed option";
    }
    if (kind == "color") {
        if (spec.value("allowAuto", false) && value.is_string() && value == "auto") return "";
        return value.is_string() && isHexColor(value.get<std::string>()) ? "" : "expected #RRGGBB";
    }
    if (kind == "tableRef")
        return value.is_string() && !value.get<std::string>().empty() ? "" : "expected table name";
    if (kind == "array") {
        if (!value.is_array()) return "expected array";
        if (spec.contains("maxItems") && value.size() > spec["maxItems"].get<size_t>())
            return "too many items";
        if (spec.contains("minItems") && value.size() < spec["minItems"].get<size_t>())
            return "too few items";
        const json* item = spec.contains("items") ? &spec["items"] : nullptr;
        if (item)
            for (const auto& v : value) {
                const std::string e = checkPropValue(*item, v);
                if (!e.empty()) return e;
            }
        if (spec.value("unique", false)) {
            std::set<std::string> seen;
            for (const auto& v : value) seen.insert(v.dump());
            if (seen.size() != value.size()) return "duplicate items";
        }
        if (item && item->value("kind", "") == "object" && spec.value("name", "") == "zones")
            return checkZones(value);
        return "";
    }
    if (kind == "object") {
        if (!value.is_object()) return "expected object";
        const json fields = spec.value("fields", json::array());
        for (auto it = value.begin(); it != value.end(); ++it) {
            bool known = false;
            for (const auto& f : fields)
                if (f.value("name", "") == it.key()) known = true;
            if (!known) return "unknown field " + it.key();
        }
        for (const auto& f : fields) {
            const std::string name = f.value("name", "");
            if (!value.contains(name)) {
                // requiredWhen: required when the condition holds, otherwise it may be absent; a
                // field with a default may be absent.
                if (f.contains("requiredWhen")) {
                    bool holds = true;
                    for (auto c = f["requiredWhen"].begin(); c != f["requiredWhen"].end(); ++c)
                        if (!value.contains(c.key()) || value[c.key()] != c.value()) holds = false;
                    if (holds) return "missing field " + name;
                    continue;
                }
                if (f.contains("default")) continue;
                return "missing field " + name;
            }
            const std::string e = checkPropValue(f, value[name]);
            if (!e.empty()) return e;
        }
        return "";
    }
    return "unknown property kind";
}

const SlotSpec* WidgetSpec::slot(const std::string& n) const {
    for (const auto& s : slots)
        if (s.name == n) return &s;
    return nullptr;
}

const json* WidgetSpec::prop(const std::string& n) const {
    for (const auto& p : props)
        if (p.value("name", "") == n) return &p;
    return nullptr;
}

std::unique_ptr<WidgetCatalog> WidgetCatalog::fromJson(const json& doc, std::string& error) {
    if (!doc.is_object() || !doc.contains("widgets") || !doc["widgets"].is_array()) {
        error = "widgets.catalog.json không có danh sách widgets";
        return nullptr;
    }
    auto cat = std::make_unique<WidgetCatalog>();
    cat->version_ = doc.value("catalogVersion", "");
    try {
        for (const auto& w : doc["widgets"]) {
            WidgetSpec s;
            s.id = w.at("id").get<std::string>();
            s.group = w.at("group").get<std::string>();
            s.minWidth = w.at("minSize").at(0).get<int>();
            s.minHeight = w.at("minSize").at(1).get<int>();
            for (const auto& sl : w.at("slots")) {
                SlotSpec x;
                x.name = sl.at("name").get<std::string>();
                x.required = sl.value("required", false);
                x.multi = sl.value("multi", false);
                if (sl.contains("max")) x.max = sl["max"].get<int>();
                for (const auto& t : sl.at("types")) x.types.push_back(t.get<std::string>());
                x.needsWrite = sl.value("needsWrite", false);
                s.slots.push_back(std::move(x));
            }
            for (const auto& p : w.at("props")) s.props.push_back(p);
            for (const auto& e : w.at("events")) {
                EventSpec x;
                x.name = e.at("name").get<std::string>();
                for (const auto& a : e.at("actions")) x.actions.push_back(a.get<std::string>());
                s.events.push_back(std::move(x));
            }
            if (w.contains("security")) {
                s.hasSecurity = true;
                for (const auto& r : w["security"].at("minRole"))
                    s.minRoles.push_back(r.get<std::string>());
            }
            cat->widgets_.push_back(std::move(s));
        }
    } catch (const std::exception& e) {
        error = std::string("widgets.catalog.json không đúng dạng: ") + e.what();
        return nullptr;
    }
    return cat;
}

std::unique_ptr<WidgetCatalog> WidgetCatalog::loadFromDir(const std::string& schemasDir,
                                                          std::string& error) {
    std::ifstream f(schemasDir + "/widgets.catalog.json");
    if (!f) {
        error = "không đọc được widgets.catalog.json";
        return nullptr;
    }
    std::stringstream ss;
    ss << f.rdbuf();
    const json doc = json::parse(ss.str(), nullptr, false);
    if (doc.is_discarded()) {
        error = "widgets.catalog.json hỏng";
        return nullptr;
    }
    return fromJson(doc, error);
}

const WidgetSpec* WidgetCatalog::find(const std::string& id) const {
    for (const auto& w : widgets_)
        if (w.id == id) return &w;
    return nullptr;
}

}  // namespace mat
