#include "core/project-manager/rules_04.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>

#include "core/expression/expression.hpp"
#include "core/project-manager/widget_catalog.hpp"

namespace mat {

using nlohmann::json;

namespace {

bool isObj(const json& v) { return v.is_object(); }
bool isStr(const json& v) { return v.is_string(); }
bool isNum(const json& v) { return v.is_number(); }
bool isInt(const json& v) {
    if (v.is_number_integer()) return true;
    if (!v.is_number_float()) return false;
    const double d = v.get<double>();
    return std::isfinite(d) && d == std::floor(d);
}
double num(const json& v) { return v.get<double>(); }

// Code points of a UTF-8 string.
size_t cpLen(const std::string& s) {
    size_t n = 0;
    for (const unsigned char c : s)
        if ((c & 0xC0) != 0x80) ++n;
    return n;
}

struct TargetSpec {
    const char* target;
    const char* group;
    std::vector<std::string> kinds;
    std::vector<std::string> params;
};

const std::vector<std::string> kNumericKinds = {"direct", "linearScale", "discreteMap", "rangeMap"};

// Contract §5: groups, allowed transforms and the parameters of each target.
const std::vector<TargetSpec>& targets() {
    static const std::vector<TargetSpec> t = {
        {"text.content", "text", {"direct", "discreteMap", "valueTable", "rangeMap"}, {"format"}},
        {"style.fill", "fill", {"direct", "discreteMap", "valueTable", "rangeMap"}, {}},
        {"style.stroke", "stroke", {"direct", "discreteMap", "valueTable", "rangeMap"}, {}},
        {"style.opacity", "opacity", kNumericKinds, {}},
        {"style.visibility", "visibility", {"direct", "discreteMap", "rangeMap"}, {}},
        {"transform.rotate", "rotate", kNumericKinds, {"pivot", "animation", "reverse"}},
        {"transform.translateX", "translateX", kNumericKinds, {}},
        {"transform.translateY", "translateY", kNumericKinds, {}},
        {"transform.scale", "scale", kNumericKinds, {"axis", "pivot"}},
        {"geometry.levelPercent", "level", {"direct", "linearScale"}, {"direction"}},
        {"geometry.clipLevel", "level", {"direct", "linearScale"}, {"direction"}},
        {"effect.blink",
         "blink",
         {"direct", "discreteMap", "rangeMap"},
         {"period", "mode", "minOpacity", "color"}},
        {"effect.flow", "flow", kNumericKinds, {"dash", "speed", "reverse", "byValueSign"}},
    };
    return t;
}

const TargetSpec* specOf(const std::string& target) {
    for (const auto& t : targets())
        if (target == t.target) return &t;
    return nullptr;
}

bool contains(const std::vector<std::string>& v, const std::string& s) {
    return std::find(v.begin(), v.end(), s) != v.end();
}

const char* const kParamKeys[] = {"animation", "reverse", "pivot",      "axis",       "direction",
                                  "format",    "period",  "mode",       "minOpacity", "color",
                                  "dash",      "speed",   "byValueSign"};

bool stringTarget(const std::string& t) {
    return t == "text.content" || t == "style.fill" || t == "style.stroke" ||
           t == "style.visibility";
}
bool textSource(const std::string& t) {
    return t == "text.content" || t == "style.fill" || t == "style.stroke";
}

bool isHexDigit(char c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}
bool isAlpha(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }

// #RGB, #RRGGBB or a name of 3-20 letters.
bool isBlinkColor(const json& v) {
    if (!isStr(v)) return false;
    const std::string s = v.get<std::string>();
    if (!s.empty() && s[0] == '#') {
        if (s.size() != 4 && s.size() != 7) return false;
        return std::all_of(s.begin() + 1, s.end(), isHexDigit);
    }
    return s.size() >= 3 && s.size() <= 20 && std::all_of(s.begin(), s.end(), isAlpha);
}

// 1-8 non-negative numbers separated by one space, sum > 0, at most 64 characters.
bool isDashPattern(const json& v) {
    if (!isStr(v)) return false;
    const std::string s = v.get<std::string>();
    if (s.empty() || s.size() > 64) return false;
    size_t count = 0, start = 0;
    double sum = 0;
    while (start <= s.size()) {
        size_t end = s.find(' ', start);
        if (end == std::string::npos) end = s.size();
        const std::string p = s.substr(start, end - start);
        ++count;
        if (count > 8 || p.empty()) return false;
        size_t i = 0;
        while (i < p.size() && p[i] >= '0' && p[i] <= '9') ++i;
        if (i == 0) return false;
        if (i < p.size()) {
            if (p[i] != '.' || i + 1 >= p.size()) return false;
            for (size_t k = i + 1; k < p.size(); ++k)
                if (p[k] < '0' || p[k] > '9') return false;
        }
        sum += std::strtod(p.c_str(), nullptr);
        start = end + 1;
    }
    return sum > 0;
}

// What is wrong with the value of parameter `key` (not `format`), or "".
std::string paramError(const std::string& key, const json& v) {
    if (key == "animation") return v == "spin" ? "" : "animation must be 'spin'";
    if (key == "reverse" || key == "byValueSign")
        return v.is_boolean() ? "" : key + " must be a boolean";
    if (key == "pivot")
        return v.is_array() && v.size() == 2 && isNum(v[0]) && isNum(v[1]) && num(v[0]) >= 0 &&
                       num(v[0]) <= 1 && num(v[1]) >= 0 && num(v[1]) <= 1
                   ? ""
                   : "pivot must be [x, y] with both in 0-1";
    if (key == "axis")
        return v == "xy" || v == "x" || v == "y" ? "" : "axis must be 'xy', 'x' or 'y'";
    if (key == "direction")
        return v == "up" || v == "down" || v == "left" || v == "right"
                   ? ""
                   : "direction must be up, down, left or right";
    if (key == "period")
        return isNum(v) && isInt(v) && num(v) >= 400 && num(v) <= 5000
                   ? ""
                   : "period must be an integer 400-5000";
    if (key == "mode")
        return v == "opacity" || v == "fill" || v == "stroke"
                   ? ""
                   : "mode must be 'opacity', 'fill' or 'stroke'";
    if (key == "minOpacity")
        return isNum(v) && num(v) >= 0 && num(v) <= 0.9 ? "" : "minOpacity must be 0-0.9";
    if (key == "color") return isBlinkColor(v) ? "" : "color must be #RGB, #RRGGBB or a color name";
    if (key == "dash")
        return isDashPattern(v) ? "" : "dash must be 1-8 numbers separated by spaces";
    if (key == "speed")
        return isNum(v) && num(v) >= 0 && num(v) <= 300 ? "" : "speed must be 0-300";
    return "unknown parameter '" + key + "'";
}

// The wrong keys of `format` as {key, message}; key "" is the object itself.
std::vector<std::pair<std::string, std::string>> formatErrors(const json& v) {
    std::vector<std::pair<std::string, std::string>> out;
    if (!isObj(v)) return {{"", "format must be an object"}};
    for (auto it = v.begin(); it != v.end(); ++it) {
        const std::string& k = it.key();
        const json& x = it.value();
        if (k == "decimals") {
            if (!(isNum(x) && isInt(x) && num(x) >= 0 && num(x) <= 6))
                out.push_back({k, "decimals must be an integer 0-6"});
        } else if (k == "prefix" || k == "suffix") {
            if (!(isStr(x) && cpLen(x.get<std::string>()) <= 16))
                out.push_back({k, k + " must be a string of at most 16 characters"});
        } else if (k == "unitFromTag") {
            if (!x.is_boolean()) out.push_back({k, "unitFromTag must be a boolean"});
        } else {
            out.push_back({k, "unknown format key '" + k + "'"});
        }
    }
    return out;
}

bool scalarMatches(const std::string& tagType, const json& v) {
    if (tagType == "BOOL") return v.is_boolean();
    if (tagType == "STRING") return v.is_string();
    return v.is_number();
}

// `direct` against the type of the Tag (contract binding-animation §2).
bool directAccepts(const std::string& target, bool spin, const std::string& t) {
    const bool numeric = isNumericTagTypeName(t);
    if (target == "text.content") return true;
    if (target == "style.fill" || target == "style.stroke") return t == "STRING";
    if (target == "style.visibility") return t == "BOOL" || t == "STRING";
    if (target == "transform.rotate") return spin ? numeric || t == "BOOL" : numeric;
    if (target == "effect.blink" || target == "effect.flow") return numeric || t == "BOOL";
    return numeric;
}

// rangeMap: the number of ranges, each range, overlaps (the rule of the value tables).
void rangeErrors(const json& tr, const std::string& bp, const std::string& bfile,
                 const BindingAdd& add) {
    const json empty = json::array();
    const json& ranges = tr.contains("ranges") && tr["ranges"].is_array() ? tr["ranges"] : empty;
    if (ranges.size() < 1 || ranges.size() > kLimit04Ranges)
        add("E_RANGE", bfile, bp + "/transform/ranges", "rangeMap needs 1-64 ranges");
    expr::ValueTable table;
    for (size_t i = 0; i < ranges.size() && i < kLimit04Ranges * 4; ++i) {
        const json& r = ranges[i];
        expr::VtEntry e;
        if (isObj(r)) {
            if (r.contains("from") && isNum(r["from"])) e.from = num(r["from"]);
            if (r.contains("to") && isNum(r["to"])) e.to = num(r["to"]);
        }
        table.entries.push_back(std::move(e));
    }
    for (const auto& i : expr::validateValueTable(table))
        add("E_RANGE", bfile, bp + "/transform/ranges/" + std::to_string(i.entry), i.message);
}

std::string tagClass(const json& tag) { return tagClassOf(tag["type"].get<std::string>()); }

bool tagWritable(const json& t) {
    const std::string access = t.value("access", "R");
    const std::string kind = t.value("kind", "external");
    if (access != "RW" || kind == "calculated") return false;
    if (kind == "simulation")
        return t.contains("sim") && isObj(t["sim"]) && t["sim"].value("kind", "") == "manual";
    return true;
}

// What is wrong with the value of a write action against the Tag, or "".
std::string writeValueError(const json& t, const json& v) {
    const std::string cls = tagClass(t);
    const json* limits = t.contains("limits") && isObj(t["limits"]) ? &t["limits"] : nullptr;
    auto limit = [&](const char* k) -> const json* {
        return limits && limits->contains(k) && isNum((*limits)[k]) ? &(*limits)[k] : nullptr;
    };
    if (cls == "bool") return v.is_boolean() ? "" : "value must be a boolean for a BOOL tag";
    if (cls == "string") {
        if (!isStr(v)) return "value must be a string for a STRING tag";
        if (const json* mx = limit("maxLength"); mx && v.get<std::string>().size() > num(*mx))
            return "value is longer than limits.maxLength";
        return "";
    }
    if (!isNum(v)) return "value must be a number for a numeric tag";
    const std::string type = t["type"].get<std::string>();
    const double d = num(v);
    if (isIntegerTagTypeName(type) && d != std::floor(d)) return type + " needs an integer value";
    const TypeRange r = typeRangeOf(type);
    if (d < r.lo || d > r.hi) return "value is outside the range of " + type;
    if (const json* mn = limit("min"); mn && d < num(*mn)) return "value is below limits.min";
    if (const json* mx = limit("max"); mx && d > num(*mx)) return "value is above limits.max";
    return "";
}

struct ActionKeys {
    std::vector<std::string> all, required;
};

const ActionKeys* actionKeys(const std::string& name) {
    static const std::map<std::string, ActionKeys> k = {
        {"write", {{"tag", "value", "confirm", "minRole", "label"}, {"tag", "value"}}},
        {"toggle", {{"tag", "confirm", "minRole", "label"}, {"tag"}}},
        {"pulse",
         {{"tag", "value", "durationMs", "confirm", "minRole", "label"},
          {"tag", "value", "durationMs"}}},
        {"navigate", {{"screen", "label"}, {"screen"}}},
        {"popup", {{"screen", "label"}, {"screen"}}},
        {"closePopup", {{"label"}, {}}},
    };
    const auto it = k.find(name);
    return it == k.end() ? nullptr : &it->second;
}

// The `events` of one element (contract svg-events §2); `ep` is /elements/<i>/events.
void eventRules(const json& ev, const std::string& ep, const std::string& bfile,
                const Binding04Ctx& ctx, const BindingAdd& add, const BindingAdd& warn) {
    if (!isObj(ev)) return;
    for (auto it = ev.begin(); it != ev.end(); ++it)
        if (it.key() != "click")
            add("E_EVENT_ACTION", bfile, ep + "/" + it.key(),
                "only the click event exists, not '" + it.key() + "'");
    if (!ev.contains("click")) {
        if (ev.empty()) add("E_EVENT_ACTION", bfile, ep, "events needs a click action");
        return;
    }
    const std::string base = ep + "/click";
    auto err = [&](const char* code, const std::string& sub, const std::string& msg) {
        add(code, bfile, base + sub, msg);
    };
    const json& c = ev["click"];
    if (!isObj(c) || !c.contains("action")) {
        err("E_EVENT_ACTION", "", "the click event needs an action");
        return;
    }
    const ActionKeys* keys =
        isStr(c["action"]) ? actionKeys(c["action"].get<std::string>()) : nullptr;
    if (!keys) {
        err("E_EVENT_ACTION", "/action",
            "action must be one of write, toggle, pulse, navigate, popup, closePopup");
        return;
    }
    const std::string name = c["action"].get<std::string>();
    for (auto it = c.begin(); it != c.end(); ++it)
        if (it.key() != "action" && !contains(keys->all, it.key()))
            err("E_EVENT_ACTION", "/" + it.key(),
                "'" + it.key() + "' is not a parameter of '" + name + "'");
    for (const auto& k : keys->required)
        if (!c.contains(k)) err("E_EVENT_ACTION", "", "action '" + name + "' needs '" + k + "'");

    const bool tagOk = c.contains("tag") && isStr(c["tag"]);
    if (c.contains("tag") && !tagOk) err("E_EVENT_ACTION", "/tag", "tag must be a string");
    bool valueOk = false;
    if (c.contains("value")) {
        const json& v = c["value"];
        valueOk = name == "pulse" ? v.is_boolean() : v.is_boolean() || isNum(v) || isStr(v);
        if (!valueOk)
            err("E_EVENT_ACTION", "/value",
                name == "pulse" ? "pulse value must be a boolean"
                                : "value must be a boolean, number or string");
    }
    if (c.contains("durationMs")) {
        const json& d = c["durationMs"];
        if (!(isNum(d) && isInt(d) && num(d) >= 100 && num(d) <= 10000))
            err("E_EVENT_ACTION", "/durationMs", "durationMs must be an integer 100-10000");
    }
    if (c.contains("label") && !(isStr(c["label"]) && cpLen(c["label"].get<std::string>()) <= 80))
        err("E_EVENT_ACTION", "/label", "label must be a string of at most 80 characters");
    const bool confirmOk =
        !c.contains("confirm") || c["confirm"] == "always" || c["confirm"] == "none";
    if (!confirmOk) err("E_EVENT_CONFIRM", "/confirm", "confirm must be 'always' or 'none'");
    if (c.contains("minRole")) {
        const json& r = c["minRole"];
        if (!(r == "operator" || r == "engineer" || r == "administrator"))
            err("E_EVENT_MINROLE", "/minRole",
                "minRole must be operator, engineer or administrator");
    }

    if ((name == "write" || name == "toggle" || name == "pulse") && tagOk && ctx.hasTags) {
        const std::string id = c["tag"].get<std::string>();
        const json* t = ctx.tagOf ? ctx.tagOf(id) : nullptr;
        if (!t) {
            err("E_EVENT_TAG", "/tag", "Tag '" + id + "' does not exist");
        } else {
            if (!tagWritable(*t))
                err("E_EVENT_TAG", "/tag",
                    "tag '" + id + "' is not writable (needs a real RW tag)");
            else if ((name == "toggle" || name == "pulse") && tagClass(*t) != "bool")
                err("E_EVENT_TAG", "/tag",
                    name + " needs a BOOL tag, '" + id + "' is " + (*t)["type"].get<std::string>());
            else if (name == "write" && valueOk) {
                const std::string m = writeValueError(*t, c["value"]);
                if (!m.empty()) err("E_EVENT_TAG", "/value", m);
            }
            if (c.contains("confirm") && c["confirm"] == "none") {
                if (tagClass(*t) != "bool")
                    err("E_EVENT_CONFIRM", "/confirm", "confirm none is only valid for a BOOL tag");
                else
                    warn("W_EVENT_CONFIRM_NONE", bfile, base + "/confirm",
                         "confirm none skips the confirmation");
            }
            if (name == "pulse" && t->value("kind", "external") == "external") {
                const bool readbackOff = t->contains("source") && isObj((*t)["source"]) &&
                                         (*t)["source"].contains("readback") &&
                                         (*t)["source"]["readback"] == false;
                if (!readbackOff)
                    warn("W_EVENT_PULSE_READBACK", bfile, base,
                         "tag '" + id + "' reads back: the pulse may be seen as a change");
            }
        }
    }
    if ((name == "navigate" || name == "popup") && c.contains("screen")) {
        if (!isStr(c["screen"])) {
            err("E_EVENT_ACTION", "/screen", "screen must be a string");
        } else {
            const std::string s = c["screen"].get<std::string>();
            const bool known = ctx.screens && std::find(ctx.screens->begin(), ctx.screens->end(),
                                                        s) != ctx.screens->end();
            if (!known) {
                err("E_EVENT_TARGET", "/screen", "screen '" + s + "' does not exist");
            } else {
                const std::string want = name == "navigate" ? "screen" : "popup";
                const std::string k = ctx.kindOf ? ctx.kindOf(s) : "";
                if (!k.empty() && k != want)
                    err("E_EVENT_TARGET", "/screen",
                        "'" + name + "' needs a " + want + ", '" + s + "' is a " + k);
            }
        }
    }
}

}  // namespace

size_t countAnimations04(const json& bindings) {
    size_t n = 0;
    if (!bindings.is_object() || !bindings.contains("elements")) return 0;
    for (const auto& e : bindings["elements"]) {
        if (!e.contains("bindings")) continue;
        for (const auto& b : e["bindings"]) {
            const std::string target = b["target"].get<std::string>();
            if (target == "effect.blink" || target == "effect.flow")
                ++n;
            else if (target == "transform.rotate" && b.contains("animation") &&
                     b["animation"] == "spin")
                ++n;
        }
    }
    return n;
}

void bindingRules04(const json& bindings, const std::string& bfile,
                    const std::set<std::string>& uids, const Binding04Ctx& ctx,
                    const BindingAdd& add, const BindingAdd& warn) {
    std::set<std::string> bindingIds, boundUids;
    const json& els = bindings["elements"];
    const json noBindings = json::array();
    for (size_t i = 0; i < els.size(); ++i) {
        const json& eb = els[i];
        const std::string ep = "/elements/" + std::to_string(i);
        const std::string uid = eb["elementUid"].get<std::string>();
        if (!boundUids.insert(uid).second)
            add("E_DUP_UID", bfile, ep + "/elementUid", "elementUid repeats in bindings");
        if (!uids.count(uid))
            add("E_REF_UID", bfile, ep + "/elementUid",
                "elementUid '" + uid + "' is not in the item");

        const json& list = eb.contains("bindings") ? eb["bindings"] : noBindings;
        std::set<std::string> groups;
        for (size_t j = 0; j < list.size(); ++j) {
            const json& b = list[j];
            const std::string bp = ep + "/bindings/" + std::to_string(j);
            auto err = [&](const char* code, const std::string& sub, const std::string& msg) {
                add(code, bfile, bp + sub, msg);
            };
            const std::string id = b["id"].get<std::string>();
            if (!bindingIds.insert(id).second)
                err("E_DUP_BINDING", "/id", "binding id '" + id + "' is duplicated");
            const std::string target = b["target"].get<std::string>();
            if (target == "component.state") {
                err("E_TARGET_UNSUPPORTED", "/target", "target '" + target + "' is not supported");
                continue;
            }
            const json& tr = b["transform"];
            const std::string kind = tr["kind"].get<std::string>();
            if (kind == "format" || kind == "expression") {
                err("E_TRANSFORM_UNSUPPORTED", "/transform/kind",
                    "transform '" + kind + "' is not supported");
                continue;
            }
            const TargetSpec* spec = specOf(target);
            if (!spec) continue;  // the schema lists the targets
            if (!groups.insert(spec->group).second)
                err("E_DUP_BINDING", "/target",
                    std::string("two bindings of the same group '") + spec->group +
                        "' on one element");
            const bool kindOk = contains(spec->kinds, kind);
            if (!kindOk)
                err("E_BIND_TRANSFORM", "/transform/kind",
                    "transform '" + kind + "' is not allowed for '" + target + "'");

            for (const char* key : kParamKeys) {
                if (!b.contains(key)) continue;
                const json& v = b[key];
                if (!contains(spec->params, key)) {
                    err("E_BIND_PARAM", std::string("/") + key,
                        std::string("parameter '") + key + "' does not belong to '" + target + "'");
                } else if (std::string(key) == "format") {
                    for (const auto& [k, m] : formatErrors(v))
                        err("E_BIND_PARAM", k.empty() ? "/format" : "/format/" + k, m);
                } else if (std::string(key) == "reverse" && target == "transform.rotate" &&
                           !(b.contains("animation") && b["animation"] == "spin")) {
                    err("E_BIND_PARAM", "/reverse", "reverse needs animation spin");
                } else {
                    const std::string m = paramError(key, v);
                    if (!m.empty()) err("E_BIND_PARAM", std::string("/") + key, m);
                }
            }
            if (target == "effect.blink" && b.contains("mode") &&
                (b["mode"] == "fill" || b["mode"] == "stroke") && !b.contains("color"))
                err("E_BIND_PARAM", "/color",
                    "mode '" + b["mode"].get<std::string>() + "' needs color");

            if (kind == "rangeMap") rangeErrors(tr, bp, bfile, add);

            if (!ctx.hasTags) continue;
            const std::string tagId = b["source"]["tagId"].get<std::string>();
            const auto ti = ctx.tagType->find(tagId);
            if (ti == ctx.tagType->end()) {
                err("E_REF_TAG", "/source/tagId", "Tag '" + tagId + "' does not exist");
                continue;
            }
            if (!kindOk) continue;
            const std::string& t = ti->second;
            if (t == "STRING" && !stringTarget(target)) {
                err("E_TYPE_MISMATCH", "/source/tagId",
                    "a STRING tag cannot be used for '" + target + "'");
                continue;
            }
            if (kind == "valueTable") {
                std::string name;
                bool haveName = false;
                if (tr.contains("table") && isStr(tr["table"])) {
                    name = tr["table"].get<std::string>();
                    haveName = true;
                } else if (const auto tt = ctx.tagTable->find(tagId); tt != ctx.tagTable->end()) {
                    name = tt->second;
                    haveName = true;
                }
                if (!haveName || !ctx.tableSet->count(name))
                    err("E_REF_TABLE", "/transform/table",
                        !haveName ? "no value table (neither table nor the Tag valueTable)"
                                  : "value table '" + name + "' does not exist");
                if (t == "STRING")
                    err("E_TYPE_MISMATCH", "/transform", "valueTable needs a numeric or BOOL tag");
                const std::string output = tr.value("output", "");
                const bool okTarget = output == "text"
                                          ? target == "text.content"
                                          : target == "style.fill" || target == "style.stroke";
                if (!okTarget)
                    err("E_TYPE_MISMATCH", "/transform/output",
                        "output '" + output + "' cannot be applied to '" + target + "'");
            } else if (kind == "linearScale") {
                if (!isNumericTagTypeName(t))
                    err("E_TYPE_MISMATCH", "/transform",
                        "linearScale needs a numeric tag, '" + tagId + "' is " + t);
                if (num(tr["inMin"]) == num(tr["inMax"]))
                    err("E_SCALE_RANGE", "/transform", "inMin must differ from inMax");
            } else if (kind == "rangeMap") {
                if (!isNumericTagTypeName(t))
                    err("E_TYPE_MISMATCH", "/transform",
                        "rangeMap needs a numeric tag, '" + tagId + "' is " + t);
            } else if (kind == "discreteMap") {
                bool bad = false;
                for (const auto& cs : tr["cases"])
                    if (!scalarMatches(t, cs["equals"])) bad = true;
                if (bad)
                    err("E_TYPE_MISMATCH", "/transform/cases",
                        "equals must have the type of tag " + t);
            } else if (!directAccepts(target, b.contains("animation") && b["animation"] == "spin",
                                      t)) {
                err("E_TYPE_MISMATCH", "/source/tagId",
                    "tag " + t + " cannot be used directly for '" + target + "'");
            }
        }

        // W_BLINK_ONLY: the blink is the only signal of its Tag on the element
        for (size_t j = 0; j < list.size(); ++j) {
            if (list[j]["target"] != "effect.blink") continue;
            const std::string tagId = list[j]["source"]["tagId"].get<std::string>();
            bool shown = false;
            for (const auto& o : list)
                if (textSource(o["target"].get<std::string>()) &&
                    o["source"]["tagId"].get<std::string>() == tagId)
                    shown = true;
            if (!shown)
                warn("W_BLINK_ONLY", bfile, ep + "/bindings/" + std::to_string(j),
                     "the blink is the only signal of this tag on the element");
        }

        if (eb.contains("events")) eventRules(eb["events"], ep + "/events", bfile, ctx, add, warn);
    }
}

}  // namespace mat
