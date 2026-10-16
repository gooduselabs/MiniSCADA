#include "core/project-manager/rules_10.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <functional>

namespace mat {

using nlohmann::json;

namespace {

bool isLower(char c) { return c >= 'a' && c <= 'z'; }
bool isUpper(char c) { return c >= 'A' && c <= 'Z'; }
bool isDigit(char c) { return c >= '0' && c <= '9'; }
bool isWord(char c) { return isLower(c) || isUpper(c) || isDigit(c) || c == '_'; }

// ^[a-z][A-Za-z0-9]{0,31}$
bool isParamName(const std::string& s) {
    if (s.empty() || s.size() > 32 || !isLower(s[0])) return false;
    for (size_t i = 1; i < s.size(); ++i)
        if (!(isLower(s[i]) || isUpper(s[i]) || isDigit(s[i]))) return false;
    return true;
}

// ^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$
bool isTagPrefix(const std::string& s) {
    if (s.empty() || !(isLower(s[0]) || isUpper(s[0]))) return false;
    bool afterDot = false;
    for (size_t i = 1; i < s.size(); ++i) {
        if (s[i] == '.') {
            if (afterDot) return false;
            afterDot = true;
        } else if (isWord(s[i])) {
            afterDot = false;
        } else {
            return false;
        }
    }
    return !afterDot;
}

// ^(\.[A-Za-z0-9_]+)+$
bool isSuffix(const std::string& s) {
    if (s.empty() || s[0] != '.') return false;
    bool afterDot = false;
    for (char c : s) {
        if (c == '.') {
            if (afterDot) return false;
            afterDot = true;
        } else if (isWord(c)) {
            afterDot = false;
        } else {
            return false;
        }
    }
    return !afterDot;
}

// ^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$
bool isJsonNumber(const std::string& s) {
    size_t i = 0;
    if (i < s.size() && s[i] == '-') ++i;
    if (i >= s.size() || !isDigit(s[i])) return false;
    if (s[i] == '0') {
        ++i;
    } else {
        while (i < s.size() && isDigit(s[i])) ++i;
    }
    if (i < s.size() && s[i] == '.') {
        ++i;
        if (i >= s.size() || !isDigit(s[i])) return false;
        while (i < s.size() && isDigit(s[i])) ++i;
    }
    if (i < s.size() && (s[i] == 'e' || s[i] == 'E')) {
        ++i;
        if (i < s.size() && (s[i] == '+' || s[i] == '-')) ++i;
        if (i >= s.size() || !isDigit(s[i])) return false;
        while (i < s.size() && isDigit(s[i])) ++i;
    }
    return i == s.size();
}

bool isHexColor(const std::string& s) {
    if (s.size() != 7 || s[0] != '#') return false;
    for (size_t i = 1; i < 7; ++i) {
        const char c = s[i];
        if (!(isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false;
    }
    return true;
}

bool hasBraceText(const std::string& s) {
    return s.find('{') != std::string::npos || s.find('}') != std::string::npos;
}

// Any string (key or value, deep) with `{` or `}`.
bool hasBrace(const json& v) {
    if (v.is_string()) return hasBraceText(v.get_ref<const std::string&>());
    if (v.is_array()) {
        for (const auto& x : v)
            if (hasBrace(x)) return true;
        return false;
    }
    if (v.is_object())
        for (auto it = v.begin(); it != v.end(); ++it)
            if (hasBraceText(it.key()) || hasBrace(it.value())) return true;
    return false;
}

std::string escapePointer(const std::string& k) {
    std::string out;
    for (char c : k) {
        if (c == '~')
            out += "~0";
        else if (c == '/')
            out += "~1";
        else
            out += c;
    }
    return out;
}

std::string pointer(const std::vector<std::string>& segs) {
    std::string p;
    for (const auto& s : segs) p += "/" + escapePointer(s);
    return p;
}

std::map<std::string, std::string> kindsOf(const json& params) {
    std::map<std::string, std::string> out;
    if (params.is_array())
        for (const auto& p : params)
            if (p.is_object() && p.contains("name") && p["name"].is_string() &&
                p.contains("kind") && p["kind"].is_string())
                out.emplace(p["name"].get<std::string>(), p["kind"].get<std::string>());
    return out;
}

enum class PlaceKind { None, Tag, Embedded, Whole };
struct Place {
    PlaceKind kind = PlaceKind::None;
    std::vector<std::string> kinds;  // Embedded: the kinds of parameter allowed
    std::string param;               // Whole: the one kind allowed
    bool asNumber = false;           // Whole: substituted as a number
};

// The place of a string by its path in the item (same table as params.ts and
// widgets.catalog.json `params.places`).
Place placeOf(const json& item, const std::vector<std::string>& segs, bool inTemplate,
              const WidgetCatalog& catalog) {
    Place p;
    if (segs.size() >= 2 && segs[0] == "tags" && (segs.size() == 2 || segs.size() == 3)) {
        p.kind = PlaceKind::Tag;
        return p;
    }
    if (segs.size() >= 2 && segs[0] == "props" && item.is_object() && item.contains("widget") &&
        item["widget"].is_string()) {
        const WidgetSpec* spec = catalog.find(item["widget"].get<std::string>());
        const json* ps = spec ? spec->prop(segs[1]) : nullptr;
        if (!ps) return p;
        const std::string kind = ps->value("kind", "");
        if (segs.size() == 2) {
            if (kind == "string") {
                p.kind = PlaceKind::Embedded;
                p.kinds = {"string"};
            } else if (kind == "number" || kind == "int") {
                p.kind = PlaceKind::Whole;
                p.param = "number";
                p.asNumber = true;
            } else if (kind == "color") {
                p.kind = PlaceKind::Whole;
                p.param = "color";
            }
            return p;
        }
        if (segs.size() == 3 && kind == "array" && ps->contains("items") &&
            (*ps)["items"].is_object() && (*ps)["items"].value("kind", "") == "string") {
            p.kind = PlaceKind::Embedded;
            p.kinds = {"string"};
        }
        return p;
    }
    if (inTemplate && segs.size() == 4 && segs[0] == "events" && segs[1] == "click" &&
        segs[2] == "args") {
        p.kind = PlaceKind::Embedded;
        p.kinds = {"tagPrefix", "string", "number", "color"};
    }
    return p;
}

// Walks every string of `item`: checks the placement of {name}; with `values`, returns the
// substituted copy.
json walk(const json& item, const json& params, bool inTemplate, const WidgetCatalog& catalog,
          const std::map<std::string, std::string>* values, std::vector<ParamProblem>& problems) {
    const auto kinds = kindsOf(params);
    static const json kEmpty = json::object();
    const json& root = item.is_object() ? item : kEmpty;
    const auto bad = [&](const std::vector<std::string>& segs, const std::string& msg) {
        problems.push_back({"place", pointer(segs), msg});
    };
    const auto sub = [&](const std::string& name) -> std::string {
        if (!values) return "";
        const auto it = values->find(name);
        return it == values->end() ? "" : it->second;
    };
    const auto str = [&](const std::string& s, const std::vector<std::string>& segs) -> json {
        if (!hasBraceText(s)) return s;
        const auto t = paramTokens(s);
        if (!t) {
            bad(segs, "'{' hoặc '}' lạ hoặc tên tham số sai dạng trong '" + s + "'");
            return s;
        }
        for (const auto& part : *t)
            if (part.param && !kinds.count(part.text)) {
                bad(segs, "tham số '" + part.text + "' không được khai");
                return s;
            }
        const Place place = placeOf(root, segs, inTemplate, catalog);
        switch (place.kind) {
            case PlaceKind::None:
                bad(segs, "không được dùng {tham số} ở đây");
                return s;
            case PlaceKind::Tag: {
                const auto& parts = *t;
                std::string suffix;
                bool restText = true;
                for (size_t i = 1; i < parts.size(); ++i) {
                    if (parts[i].param) restText = false;
                    suffix += parts[i].text;
                }
                if (parts.empty() || !parts[0].param || !restText ||
                    kinds.at(parts[0].text) != "tagPrefix" ||
                    (!suffix.empty() && !isSuffix(suffix))) {
                    bad(segs,
                        "khe Tag chỉ nhận {tiền tố} hoặc {tiền tố}.HẬU_TỐ với tham số kiểu "
                        "tagPrefix");
                    return s;
                }
                return values ? json(sub(parts[0].text) + suffix) : json(s);
            }
            case PlaceKind::Whole: {
                const auto& parts = *t;
                if (parts.size() != 1 || !parts[0].param ||
                    kinds.at(parts[0].text) != place.param) {
                    bad(segs, "thuộc tính này chỉ nhận trọn chuỗi {tham số} kiểu " + place.param);
                    return s;
                }
                if (!values) return s;
                const std::string v = sub(parts[0].text);
                if (place.asNumber) return std::strtod(v.c_str(), nullptr);
                return v;
            }
            case PlaceKind::Embedded: {
                for (const auto& part : *t)
                    if (part.param && std::find(place.kinds.begin(), place.kinds.end(),
                                                kinds.at(part.text)) == place.kinds.end()) {
                        bad(segs, "tham số '" + part.text + "' kiểu " + kinds.at(part.text) +
                                      " không dùng được ở đây");
                        return s;
                    }
                if (!values) return s;
                std::string out;
                for (const auto& part : *t) out += part.param ? sub(part.text) : part.text;
                return out;
            }
        }
        return s;
    };
    std::vector<std::string> segs;
    const std::function<json(const json&)> go = [&](const json& v) -> json {
        if (v.is_string()) return str(v.get_ref<const std::string&>(), segs);
        if (v.is_array()) {
            json out = json::array();
            for (size_t i = 0; i < v.size(); ++i) {
                segs.push_back(std::to_string(i));
                out.push_back(go(v[i]));
                segs.pop_back();
            }
            return out;
        }
        if (v.is_object()) {
            json out = json::object();
            for (auto it = v.begin(); it != v.end(); ++it) {
                segs.push_back(it.key());
                if (hasBraceText(it.key()))
                    bad(segs, "tên khóa '" + it.key() + "' có '{' hoặc '}'");
                out[it.key()] = go(it.value());
                segs.pop_back();
            }
            return out;
        }
        return v;
    };
    return go(item);
}

const json& paramsOf(const json& doc) {
    static const json kNone = json::array();
    return doc.is_object() && doc.contains("params") && doc["params"].is_array() ? doc["params"]
                                                                                 : kNone;
}

bool isItemId(const std::string& s) {
    if (s.size() < 2 || s.size() > 32 || !isLower(s[0])) return false;
    for (size_t i = 1; i < s.size(); ++i)
        if (!(isLower(s[i]) || isDigit(s[i]) || s[i] == '_')) return false;
    return true;
}

// templates/<id>.template.json -> id; "" when the path has another form (refused by the schema).
std::string templateStem(const std::string& file) {
    static const std::string pre = "templates/", post = ".template.json";
    if (file.size() <= pre.size() + post.size() || file.compare(0, pre.size(), pre) != 0 ||
        file.compare(file.size() - post.size(), post.size(), post) != 0)
        return "";
    const std::string id = file.substr(pre.size(), file.size() - pre.size() - post.size());
    if (id.empty() || id.size() > 48 || !isLower(id[0])) return "";
    for (char c : id)
        if (!(isLower(c) || isDigit(c) || c == '-')) return "";
    return id;
}

// The item without the keys that belong to an instance (FR-121).
json ownPart(const json& item) {
    static const std::set<std::string> kOwn = {"id",     "x",   "y",      "width",
                                               "height", "tpl", "locked", "hidden"};
    json out = json::object();
    if (item.is_object())
        for (auto it = item.begin(); it != item.end(); ++it)
            if (!kOwn.count(it.key())) out[it.key()] = it.value();
    return out;
}

std::string argsLabel(const json& params, const std::map<std::string, std::string>& values) {
    // {"name":"value",...} in the order of the params (as JSON.stringify of the TS version)
    std::string out = "{";
    bool first = true;
    for (const auto& p : params) {
        const std::string n = p.value("name", "");
        const auto it = values.find(n);
        if (it == values.end()) continue;
        if (!first) out += ",";
        first = false;
        out += json(n).dump() + ":" + json(it->second).dump();
    }
    return out + "}";
}

bool isTagCode(const std::string& c) { return c == "E_REF_TAG" || c == "E_WIDGET_TAG_TYPE"; }

}  // namespace

std::string paramValueError(const std::string& kind, const json& value) {
    if (!value.is_string()) return "giá trị tham số phải là chuỗi";
    const std::string& v = value.get_ref<const std::string&>();
    if (kind == "tagPrefix") {
        if (!isTagPrefix(v)) return "tiền tố Tag chỉ gồm chữ, số, `_` và `.` (bắt đầu bằng chữ)";
        return v.size() > 64 ? "tiền tố Tag dài hơn 64 byte" : "";
    }
    if (kind == "string") {
        for (unsigned char c : v)
            if (c < 0x20 || c == 0x7f) return "chuỗi có ký tự điều khiển";
        return v.size() > 128 ? "chuỗi dài hơn 128 byte" : "";
    }
    if (kind == "number")
        return isJsonNumber(v) && std::isfinite(std::strtod(v.c_str(), nullptr))
                   ? ""
                   : "không phải số hữu hạn";
    if (kind == "color") return isHexColor(v) ? "" : "màu phải dạng #RRGGBB";
    return "kiểu tham số lạ";
}

std::optional<std::vector<ParamPart>> paramTokens(const std::string& s) {
    std::vector<ParamPart> parts;
    std::string text;
    for (size_t i = 0; i < s.size(); ++i) {
        const char c = s[i];
        if (c == '}') return std::nullopt;
        if (c != '{') {
            text += c;
            continue;
        }
        const size_t end = s.find('}', i + 1);
        if (end == std::string::npos) return std::nullopt;
        const std::string name = s.substr(i + 1, end - i - 1);
        if (!isParamName(name)) return std::nullopt;
        if (!text.empty()) parts.push_back({false, text});
        text.clear();
        parts.push_back({true, name});
        i = end;
    }
    if (!text.empty()) parts.push_back({false, text});
    return parts;
}

std::vector<ParamProblem> checkParamDecls(const json& params) {
    std::vector<ParamProblem> out;
    std::set<std::string> seen;
    if (!params.is_array()) return out;
    for (size_t i = 0; i < params.size(); ++i) {
        const json& p = params[i];
        const std::string name = p.value("name", "");
        if (!seen.insert(name).second)
            out.push_back(
                {"place", "/" + std::to_string(i) + "/name", "tham số '" + name + "' bị trùng"});
        if (p.contains("default")) {
            const std::string e = paramValueError(p.value("kind", ""), p["default"]);
            if (!e.empty())
                out.push_back({"place", "/" + std::to_string(i) + "/default",
                               "default của '" + name + "': " + e});
        }
    }
    return out;
}

ResolvedArgs resolveArgs(const json& params, const json& args) {
    ResolvedArgs r;
    const auto add = [&](const std::string& path, const std::string& msg) {
        r.problems.push_back({"args", path, msg});
    };
    static const json kEmpty = json::object();
    const json* given = &kEmpty;
    if (!args.is_null()) {
        if (!args.is_object()) {
            add("", "args phải là đối tượng tên tham số -> chuỗi");
            return r;
        }
        given = &args;
    }
    std::set<std::string> names;
    if (params.is_array())
        for (const auto& p : params) names.insert(p.value("name", ""));
    for (auto it = given->begin(); it != given->end(); ++it)
        if (!names.count(it.key()))
            add("/" + escapePointer(it.key()), "'" + it.key() + "' không phải tham số");
    if (params.is_array())
        for (const auto& p : params) {
            const std::string name = p.value("name", "");
            if (given->contains(name)) {
                const std::string e = paramValueError(p.value("kind", ""), (*given)[name]);
                if (!e.empty())
                    add("/" + escapePointer(name), "tham số '" + name + "': " + e);
                else
                    r.values[name] = (*given)[name].get<std::string>();
            } else if (p.contains("default") && p["default"].is_string()) {
                r.values[name] = p["default"].get<std::string>();
            } else {
                add("/" + escapePointer(name), "thiếu tham số '" + name + "'");
            }
        }
    r.ok = r.problems.empty();
    return r;
}

std::vector<ParamProblem> checkParamPlaces(const json& item, const json& params, bool inTemplate,
                                           const WidgetCatalog& catalog) {
    std::vector<ParamProblem> problems;
    walk(item, params, inTemplate, catalog, nullptr, problems);
    return problems;
}

Substituted substituteParams(const json& item, const json& params, const json& args,
                             bool inTemplate, const WidgetCatalog& catalog) {
    Substituted s;
    const ResolvedArgs r = resolveArgs(params, args);
    s.value = walk(item, params, inTemplate, catalog, r.ok ? &r.values : nullptr, s.problems);
    for (const auto& p : r.problems) s.problems.push_back(p);
    s.ok = s.problems.empty();
    if (!s.ok) s.value = json();
    return s;
}

namespace {
json valuesJson(const std::map<std::string, std::string>& values) {
    json out = json::object();
    for (const auto& [k, v] : values) out[k] = v;
    return out;
}
}  // namespace

Rules10::Rules10(const Rules10Input& in, const std::vector<Rules03Input::ScreenDoc>& screens)
    : in_(in), screens_(screens) {}

void Rules10::before(Rules03Input& in, std::vector<ProjectIssue>& errors) {
    const auto err = [&](const char* code, const std::string& file, const std::string& path,
                         const std::string& msg) {
        errors.push_back({code, file, path, msg});
    };
    const json& project = *in_.project;
    const std::string version = project["schemaVersion"].get<std::string>();
    const WidgetCatalog& catalog = *in_.catalog;

    // ---- logic.json: only its version (the E_LOGIC_* rules are T135) ----
    if (in_.logic && (*in_.logic)["schemaVersion"].get<std::string>() != version)
        err("E_SCHEMA_VERSION", in_.logicFile, "/schemaVersion",
            "schemaVersion " + (*in_.logic)["schemaVersion"].get<std::string>() +
                " khác project.json (" + version + "): mọi tệp phải cùng phiên bản");

    // ---- 1. templates ----
    for (const auto& t : in_.templates) {
        const std::string stem = templateStem(t.file);
        if (stem.empty() || templates_.count(stem)) continue;
        templates_[stem] = t.doc;
        if (!t.doc) continue;
        const json& doc = *t.doc;
        if (doc["schemaVersion"].get<std::string>() != version)
            err("E_SCHEMA_VERSION", t.file, "/schemaVersion",
                "schemaVersion " + doc["schemaVersion"].get<std::string>() +
                    " khác project.json (" + version + "): mọi tệp phải cùng phiên bản");
        if (doc["id"].get<std::string>() != stem)
            err("E_TEMPLATE_ID", t.file, "/id",
                "id '" + doc["id"].get<std::string>() + "' khác tên tệp '" + stem + "'");
        const json& params = paramsOf(doc);
        for (const auto& d : checkParamDecls(params))
            err("E_TEMPLATE_PARAM", t.file, "/params" + d.path, d.message);
        std::set<std::string> ids;
        const json& items = doc["items"];
        for (size_t i = 0; i < items.size(); ++i) {
            const std::string id = items[i]["id"].get<std::string>();
            const std::string ip = "/items/" + std::to_string(i);
            if (!isItemId(id))
                err("E_TEMPLATE_ID", t.file, ip + "/id", "id item '" + id + "' sai dạng");
            else if (ids.count(id))
                err("E_TEMPLATE_ID", t.file, ip + "/id", "id item '" + id + "' bị trùng");
            ids.insert(id);
            for (const auto& p : checkParamPlaces(items[i], params, true, catalog))
                err("E_TEMPLATE_PARAM", t.file, ip + p.path, p.message);
        }
    }

    // ---- 2. popups with params ----
    std::map<std::string, const Rules03Input::ScreenDoc*> byId;
    for (const auto& s : screens_) byId[s.id] = &s;
    std::map<std::string, std::set<size_t>> badItems;
    for (const auto& s : screens_) {
        if (!s.screen.contains("params")) continue;
        if (s.screen.value("kind", "screen") != "popup") {
            err("E_TEMPLATE_PARAM", s.file, "/params", "params chỉ dùng ở màn hình popup");
            continue;
        }
        const json& params = s.screen["params"];
        for (const auto& d : checkParamDecls(params))
            err("E_TEMPLATE_PARAM", s.file, "/params" + d.path, d.message);
        if (params.empty()) continue;
        paramScreens_.insert(s.id);
        std::set<size_t>& bad = badItems[s.id];
        const json& items = s.screen["items"];
        for (size_t i = 0; i < items.size(); ++i)
            for (const auto& p : checkParamPlaces(items[i], params, false, catalog)) {
                err("E_TEMPLATE_PARAM", s.file, "/items/" + std::to_string(i) + p.path, p.message);
                bad.insert(i);
            }
    }

    // ---- 3. calls of popups ----
    std::map<std::string, std::vector<std::map<std::string, std::string>>> combos;
    std::map<std::string, std::set<std::string>> comboKeys;
    const auto callSite = [&](const std::string& callerId, const json& click,
                              const std::string& file, const std::string& base) {
        if (!click.is_object() || !click.contains("action") || click["action"] != "popup" ||
            !click.contains("screen") || !click["screen"].is_string())
            return;
        const std::string target = click["screen"].get<std::string>();
        const auto t = byId.find(target);
        if (t == byId.end() || t->second->screen.value("kind", "screen") != "popup") return;
        const json args = click.contains("args") ? click["args"] : json();
        if (paramScreens_.count(callerId) && hasBrace(args)) return;
        const json& params = paramsOf(t->second->screen);
        const ResolvedArgs r = resolveArgs(params, args);
        if (!r.ok) {
            for (const auto& p : r.problems)
                err("E_POPUP_ARGS", file, base + "/args" + p.path,
                    "popup '" + target + "': " + p.message);
            return;
        }
        if (params.empty() || !paramScreens_.count(target)) return;
        std::string key;
        for (const auto& p : params) key += r.values.at(p.value("name", "")) + '\x1f';
        if (comboKeys[target].insert(key).second) combos[target].push_back(r.values);
    };
    for (const auto& s : screens_) {
        const json& items = s.screen["items"];
        for (size_t i = 0; i < items.size(); ++i) {
            const json& item = items[i];
            if (item["type"] == "widget") {
                if (item.contains("events") && item["events"].is_object() &&
                    item["events"].contains("click"))
                    callSite(s.id, item["events"]["click"], s.file,
                             "/items/" + std::to_string(i) + "/events/click");
                continue;
            }
            const auto d = s.svg.find(i);
            if (d == s.svg.end() || !d->second.hasBindings) continue;
            const std::string bfile = item["bindingFile"].get<std::string>();
            const json& els = d->second.bindings["elements"];
            for (size_t j = 0; j < els.size(); ++j)
                if (els[j].contains("events") && els[j]["events"].is_object() &&
                    els[j]["events"].contains("click"))
                    callSite(s.id, els[j]["events"]["click"], bfile,
                             "/elements/" + std::to_string(j) + "/events/click");
        }
    }

    // ---- 4. static expansion ----
    for (const auto& s : screens_) {
        if (!paramScreens_.count(s.id)) continue;
        const json& params = s.screen["params"];
        std::vector<std::map<std::string, std::string>> list = combos[s.id];
        if (list.size() > kMaxPopupCombinations) {
            err("E_POPUP_ARGS", s.file, "/params",
                "popup '" + s.id + "' được mở với " + std::to_string(list.size()) +
                    " bộ args khác nhau (tối đa " + std::to_string(kMaxPopupCombinations) + ")");
            list.resize(kMaxPopupCombinations);
        }
        if (list.empty()) {
            bool allDefault = true;
            for (const auto& p : params) allDefault = allDefault && p.contains("default");
            if (allDefault) {
                const ResolvedArgs r = resolveArgs(params, json::object());
                if (r.ok) list.push_back(r.values);
            }
        }
        const std::set<size_t>& bad = badItems[s.id];
        const json& items = s.screen["items"];
        std::vector<size_t> indices;
        for (size_t i = 0; i < items.size(); ++i)
            if (items[i]["type"] == "widget" && !bad.count(i) && hasBrace(items[i]))
                indices.push_back(i);
        if (indices.empty()) continue;
        for (const auto& values : list) {
            Rules03Expansion x;
            x.key = s.id;
            x.file = s.file;
            x.screen = s.screen;
            const json args = valuesJson(values);
            for (size_t i : indices) {
                const Substituted r = substituteParams(items[i], params, args, false, catalog);
                if (!r.ok) continue;
                x.screen["items"][i] = r.value;
                x.items.push_back(i);
            }
            expansions_.push_back(std::move(x));
            expansionValues_.push_back(values);
        }
    }
    in.paramScreens = &paramScreens_;
    in.expansions = &expansions_;
}

void Rules10::after(std::vector<ProjectIssue>& errors, std::vector<ProjectIssue>& warnings) {
    std::vector<ProjectIssue> mine, mineW;
    const auto err = [&](const char* code, const std::string& file, const std::string& path,
                         const std::string& msg) {
        mine.push_back({code, file, path, msg});
    };
    const auto warn = [&](const char* code, const std::string& file, const std::string& path,
                          const std::string& msg) {
        mineW.push_back({code, file, path, msg});
    };
    const WidgetCatalog& catalog = *in_.catalog;

    // ---- 5. instances ----
    std::map<std::string, std::map<size_t, std::string>> tplItems;  // file -> index -> inst
    for (const auto& s : screens_) {
        const json& items = s.screen["items"];
        std::vector<std::string> order;
        std::map<std::string, std::vector<size_t>> groups;
        for (size_t i = 0; i < items.size(); ++i) {
            const json& item = items[i];
            if (!item.contains("tpl") || !item["tpl"].is_object()) continue;
            const std::string inst = item["tpl"]["inst"].get<std::string>();
            if (!groups.count(inst)) order.push_back(inst);
            groups[inst].push_back(i);
        }
        for (const std::string& inst : order) {
            const std::vector<size_t>& idx = groups[inst];
            const std::string tid = items[idx[0]]["tpl"]["tid"].get<std::string>();
            std::vector<size_t> members;
            for (size_t i : idx) {
                const std::string own = items[i]["tpl"]["tid"].get<std::string>();
                if (own == tid) {
                    members.push_back(i);
                    continue;
                }
                err("E_TEMPLATE_REF", s.file, "/items/" + std::to_string(i) + "/tpl/tid",
                    "bản sao '" + inst + "' dùng template '" + tid + "', không phải '" + own + "'");
            }
            const auto tt = templates_.find(tid);
            if (tt == templates_.end()) {
                for (size_t i : members)
                    err("E_TEMPLATE_REF", s.file, "/items/" + std::to_string(i) + "/tpl/tid",
                        "không có template '" + tid + "'");
                continue;
            }
            if (!tt->second) continue;  // the template file failed: already reported
            const json& doc = *tt->second;
            std::map<std::string, const json*> byRid;
            std::vector<std::string> ridOrder;
            for (const auto& t : doc["items"]) {
                const std::string id = t["id"].get<std::string>();
                if (!byRid.count(id)) {
                    byRid[id] = &t;
                    ridOrder.push_back(id);
                }
            }
            for (size_t i : members) {
                const std::string rid = items[i]["tpl"]["rid"].get<std::string>();
                tplItems[s.file][i] = inst;
                const std::string ip = "/items/" + std::to_string(i);
                if (!byRid.count(rid))
                    err("E_TEMPLATE_REF", s.file, ip + "/tpl/rid",
                        "template '" + tid + "' không có item '" + rid + "'");
                if (items[i]["id"].get<std::string>() != inst + "." + rid)
                    err("E_TEMPLATE_REF", s.file, ip + "/id",
                        "id phải là '" + inst + "." + rid + "'");
            }
            std::vector<size_t> carriers;
            for (size_t i : members)
                if (items[i]["tpl"].contains("params")) carriers.push_back(i);
            const json given = carriers.empty() ? json() : items[carriers[0]]["tpl"]["params"];
            for (size_t k = 1; k < carriers.size(); ++k)
                if (items[carriers[k]]["tpl"]["params"] != given)
                    err("E_TEMPLATE_PARAM", s.file,
                        "/items/" + std::to_string(carriers[k]) + "/tpl/params",
                        "mọi item của bản sao '" + inst + "' phải có cùng params");
            const json& params = paramsOf(doc);
            const size_t at = carriers.empty() ? members[0] : carriers[0];
            const ResolvedArgs r = resolveArgs(params, given);
            if (!r.ok) {
                for (const auto& p : r.problems)
                    err("E_TEMPLATE_PARAM", s.file,
                        "/items/" + std::to_string(at) + "/tpl/params" + p.path,
                        "bản sao '" + inst + "': " + p.message);
                continue;
            }
            const json args = valuesJson(r.values);
            std::set<std::string> seen;
            for (size_t i : members) {
                const std::string rid = items[i]["tpl"]["rid"].get<std::string>();
                seen.insert(rid);
                const auto t = byRid.find(rid);
                if (t == byRid.end()) continue;
                const Substituted e = substituteParams(*t->second, params, args, true, catalog);
                if (e.ok && ownPart(e.value) != ownPart(items[i]))
                    warn("W_TEMPLATE_DRIFT", s.file, "/items/" + std::to_string(i),
                         "item khác template '" + tid + "' (bản sao '" + inst + "')");
            }
            for (const auto& rid : ridOrder)
                if (!seen.count(rid))
                    warn("W_TEMPLATE_DRIFT", s.file, "/items/" + std::to_string(members[0]),
                         "bản sao '" + inst + "' thiếu item '" + rid + "' của template '" + tid +
                             "'");
        }
    }

    // ---- merge: tag codes of instances, issues of the expansions (no duplicates) ----
    const auto itemOf = [](const std::string& path) -> std::optional<size_t> {
        static const std::string pre = "/items/";
        if (path.compare(0, pre.size(), pre) != 0) return std::nullopt;
        size_t i = pre.size(), n = 0;
        if (i >= path.size() || !isDigit(path[i])) return std::nullopt;
        while (i < path.size() && isDigit(path[i]))
            n = n * 10 + static_cast<size_t>(path[i++] - '0');
        static const std::string tags = "/tags";
        if (path.compare(i, tags.size(), tags) != 0) return std::nullopt;
        i += tags.size();
        if (i != path.size() && path[i] != '/') return std::nullopt;
        return n;
    };
    for (auto& e : errors) {
        if (!isTagCode(e.code)) continue;
        const auto f = tplItems.find(e.file);
        if (f == tplItems.end()) continue;
        const auto i = itemOf(e.path);
        if (!i) continue;
        const auto inst = f->second.find(*i);
        if (inst == f->second.end()) continue;
        e.code = "E_TEMPLATE_TAG_REF";
        e.message += " (bản sao '" + inst->second + "')";
    }
    const auto key = [](const ProjectIssue& x) { return x.code + "|" + x.file + "|" + x.path; };
    std::set<std::string> seenE, seenW;
    for (const auto& e : errors) seenE.insert(key(e));
    for (const auto& w : warnings) seenW.insert(key(w));
    for (size_t k = 0; k < expansions_.size(); ++k) {
        const Rules03Expansion& x = expansions_[k];
        const std::string label =
            "popup '" + x.key + "' với args " + argsLabel(x.screen["params"], expansionValues_[k]);
        for (ProjectIssue e : x.errors) {
            if (isTagCode(e.code)) e.code = "E_TEMPLATE_TAG_REF";
            e.message = label + ": " + e.message;
            if (!seenE.insert(key(e)).second) continue;
            errors.push_back(std::move(e));
        }
        for (ProjectIssue w : x.warnings) {
            if (!seenW.insert(key(w)).second) continue;
            w.message = label + ": " + w.message;
            warnings.push_back(std::move(w));
        }
    }
    for (auto& e : mine) errors.push_back(std::move(e));
    for (auto& w : mineW) warnings.push_back(std::move(w));
}

}  // namespace mat
