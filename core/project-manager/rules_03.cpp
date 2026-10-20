#include "core/project-manager/rules_03.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <optional>
#include <set>

#include "core/project-manager/rules_010.hpp"
#include "core/project-manager/rules_04.hpp"
#include "core/project-manager/rules_11.hpp"

namespace mat {

using nlohmann::json;

namespace {

constexpr double kWidthLo = 64, kWidthHi = 4096, kHeightLo = 64, kHeightHi = 2304;
constexpr double kDurationLo = 100, kDurationHi = 10000;

bool isObj(const json& v) { return v.is_object(); }

bool isItemId(const std::string& s) {
    // ^[a-z][a-z0-9_]{1,31}$
    if (s.size() < 2 || s.size() > 32 || s[0] < 'a' || s[0] > 'z') return false;
    for (size_t i = 1; i < s.size(); ++i) {
        const char c = s[i];
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_')) return false;
    }
    return true;
}

// Format 1.0: the id of an item expanded from a template, <inst>.<rid>
// (^[a-z][a-z0-9-]{0,31}\.[a-z][a-z0-9_]{1,31}$), with or without `tpl`.
bool isInstItemId(const std::string& s) {
    const size_t dot = s.find('.');
    if (dot == std::string::npos || dot == 0 || dot > 32 || s[0] < 'a' || s[0] > 'z') return false;
    for (size_t i = 1; i < dot; ++i) {
        const char c = s[i];
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-')) return false;
    }
    return isItemId(s.substr(dot + 1));
}

// A string (deep, keys too) with `{` or `}`: a value with {param} of a popup with params.
bool hasParamText(const json& v) {
    if (v.is_string()) {
        const auto& t = v.get_ref<const std::string&>();
        return t.find('{') != std::string::npos || t.find('}') != std::string::npos;
    }
    if (v.is_array()) {
        for (const auto& x : v)
            if (hasParamText(x)) return true;
        return false;
    }
    if (v.is_object())
        for (auto it = v.begin(); it != v.end(); ++it)
            if (hasParamText(json(it.key())) || hasParamText(it.value())) return true;
    return false;
}

bool actionUsesTarget(const std::string& a) {
    return a == "write" || a == "toggle" || a == "pulse";
}

struct ActionKeys {
    std::vector<std::string> all, required;
};

const ActionKeys* actionKeys(const std::string& name, bool format10) {
    // Format 1.0: the popup action has `args` too (checked against the params by rules_10)
    static const ActionKeys kPopup10 = {{"screen", "args"}, {"screen"}};
    if (format10 && name == "popup") return &kPopup10;
    static const std::map<std::string, ActionKeys> kKeys = {
        {"write", {{"value"}, {"value"}}},
        {"toggle", {{}, {}}},
        {"pulse", {{"value", "durationMs"}, {"value", "durationMs"}}},
        {"navigate", {{"screen"}, {"screen"}}},
        {"popup", {{"screen"}, {"screen"}}},
        {"closePopup", {{}, {}}},
    };
    const auto it = kKeys.find(name);
    return it == kKeys.end() ? nullptr : &it->second;
}

bool isIntegerValue(const json& v) {
    if (v.is_number_integer()) return true;
    if (!v.is_number_float()) return false;
    const double d = v.get<double>();
    return std::isfinite(d) && d == std::floor(d);
}

// A Tag of tags.json as the rules need it.
struct Tag {
    const json* j = nullptr;
    std::string id() const { return (*j)["id"].get<std::string>(); }
    std::string type() const { return (*j)["type"].get<std::string>(); }
    std::string kind() const { return j->value("kind", "external"); }
    std::string access() const { return j->value("access", "R"); }
    bool writable() const {
        if (access() != "RW" || kind() == "calculated") return false;
        if (kind() == "simulation")
            return j->contains("sim") && (*j)["sim"].is_object() &&
                   (*j)["sim"].value("kind", "") == "manual";
        return true;
    }
    const json* limits() const {
        return j->contains("limits") && (*j)["limits"].is_object() ? &(*j)["limits"] : nullptr;
    }
    std::optional<double> limit(const char* k) const {
        const json* l = limits();
        if (l && l->contains(k) && (*l)[k].is_number()) return (*l)[k].get<double>();
        return std::nullopt;
    }
    bool hasValueTable() const {
        return j->contains("valueTable") && (*j)["valueTable"].is_string();
    }
};

struct Rect {
    double x, y, w, h;
};

// A coordinate of an item; NaN when absent (feature 012: optional in the 1.x schemas, an item of a
// grid screen has none). Every comparison with NaN is false, as with `undefined` in rules-03.ts, so
// E_ITEM_SIZE, W_ITEM_OUTSIDE and W_ITEM_COVERED leave such an item alone.
double coord(const json& item, const char* k) {
    return item.contains(k) && item[k].is_number() ? item[k].get<double>()
                                                   : std::numeric_limits<double>::quiet_NaN();
}

Rect rectOf(const json& item) {
    return {coord(item, "x"), coord(item, "y"), coord(item, "width"), coord(item, "height")};
}

bool isOutside(const Rect& r, double sw, double sh) {
    return r.x + r.w <= 0 || r.y + r.h <= 0 || r.x >= sw || r.y >= sh;
}

bool covers(const Rect& a, const Rect& b) {
    return a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
}

size_t utf8Length(const std::string& s) { return s.size(); }

// Description of what is wrong with the value of a write action, or "".
std::string writeValueError(const Tag& t, const json& v) {
    const std::string cls = tagClassOf(t.type());
    if (cls == "bool") return v.is_boolean() ? "" : "value must be a boolean for a BOOL tag";
    if (cls == "string") {
        if (!v.is_string()) return "value must be a string for a STRING tag";
        if (const json* l = t.limits())
            if (l->contains("maxLength") &&
                utf8Length(v.get<std::string>()) > (*l)["maxLength"].get<size_t>())
                return "value is longer than limits.maxLength";
        return "";
    }
    if (!v.is_number() || !std::isfinite(v.get<double>()))
        return "value must be a number for a numeric tag";
    const double d = v.get<double>();
    if (isIntegerTagTypeName(t.type()) && !isIntegerValue(v))
        return t.type() + " needs an integer value";
    const TypeRange r = typeRangeOf(t.type());
    if (d < r.lo || d > r.hi) return "value is outside the range of " + t.type();
    if (const auto mn = t.limit("min"); mn && d < *mn) return "value is below limits.min";
    if (const auto mx = t.limit("max"); mx && d > *mx) return "value is above limits.max";
    return "";
}

class Rules {
   public:
    Rules(const Rules03Input& in, std::vector<ProjectIssue>& e, std::vector<ProjectIssue>& w)
        : in_(in), errors_(e), warnings_(w), project_(*in.project) {}

    void run() {
        // Tags, connections, value tables, watch tables, logging, project.json: the rules of 0.2
        {
            Rules02Input b;
            b.project = in_.project;
            b.tags = in_.tags;
            b.connections = in_.connections;
            b.loggingDoc = in_.loggingDoc;
            b.valueTables = in_.valueTables;
            b.watchTables = in_.watchTables;
            b.logging = in_.logging;
            b.runtimeVersion = in_.runtimeVersion;
            b.serial = in_.serial;
            b.schema = in_.schema;
            b.reports = in_.reports;
            runRules02(b, errors_, warnings_);
        }
        if (project_.contains("valueTables"))
            for (const auto& n : project_["valueTables"]) tableSet_.insert(n.get<std::string>());
        if (in_.tags)
            for (const auto& t : (*in_.tags)["tags"]) {
                const std::string id = t["id"].get<std::string>();
                if (!tagInfo_.count(id)) tagInfo_[id] = Tag{&t};
            }
        for (const auto& [id, t] : tagInfo_) {
            tagType_[id] = t.type();
            if (t.hasValueTable()) tagTable_[id] = (*t.j)["valueTable"].get<std::string>();
        }
        for (const auto& s : in_.screens) screens_[s.id] = &s;

        projectRules();
        for (const auto& s : in_.screens) {
            screenRules(s);
            tagSets_[s.id] = screenTagIds(s);
        }
        screenTagLimits();
        // format 1.0: the widget items of each popup with params, with one set of args substituted
        if (in_.expansions)
            for (auto& x : *in_.expansions) {
                Rules03Input::ScreenDoc sd;
                sd.id = x.key;
                sd.file = x.file;
                sd.screen = x.screen;
                errSink_ = &x.errors;
                warnSink_ = &x.warnings;
                const json& items = sd.screen["items"];
                for (size_t i : x.items)
                    if (i < items.size() && items[i]["type"] == "widget")
                        widgetItem(sd, items[i], i);
                errSink_ = nullptr;
                warnSink_ = nullptr;
            }
    }

   private:
    void add(const char* code, const std::string& file, const std::string& path,
             const std::string& msg) {
        (errSink_ ? *errSink_ : errors_).push_back({code, file, path, msg});
    }
    void warn(const char* code, const std::string& file, const std::string& path,
              const std::string& msg) {
        (warnSink_ ? *warnSink_ : warnings_).push_back({code, file, path, msg});
    }

    std::string kindOf(const std::string& id) const {
        const auto it = screens_.find(id);
        return it == screens_.end() ? "" : it->second->screen.value("kind", "screen");
    }
    bool projectHasScreen(const std::string& id) const {
        for (const auto& s : project_["screens"])
            if (s == id) return true;
        return false;
    }

    // ---- project.json ----
    void projectRules() {
        if (project_["screens"].size() > kLimit03Screens)
            add("E_LIMIT", "project.json", "/screens", "more than 32 screens");
        const std::string entry = project_["entryScreen"].get<std::string>();
        if (kindOf(entry) == "popup")
            add("E_SCREEN_KIND", "project.json", "/entryScreen",
                "entryScreen must be a screen, not a popup");
        if (project_.contains("navigation")) navigationRules(project_["navigation"]);
        // report templates (feature 010): E_RPT_*; the rules that need logging.json or tags.json
        // are skipped when that file failed
        if (in_.reports && project_.contains("reportsFile")) {
            const std::string file = project_["reportsFile"].get<std::string>();
            const bool format11 = project_["schemaVersion"].is_string() &&
                                  isSchema11(project_["schemaVersion"].get<std::string>());
            reportRules(
                *in_.reports, in_.loggingDoc, project_.contains("loggingFile"),
                in_.tags ? &tagType_ : nullptr,
                [&](const char* code, const std::string& path, const std::string& msg) {
                    add(code, file, path, msg);
                },
                format11);
        }
    }

    void navigationRules(const json& nav) {
        size_t leaves = 0;
        const auto addNav = [&](const std::string& path, const std::string& msg) {
            add("E_NAV", "project.json", path, msg);
        };
        const auto leaf = [&](const json& it, const std::string& path) {
            ++leaves;
            if (it.contains("report")) {
                // feature 010: an entry that opens a report; reports.json that failed: skipped
                bool missing = !project_.contains("reportsFile");
                if (!missing && in_.reports) {
                    missing = true;
                    for (const auto& r : (*in_.reports)["reports"])
                        if (r["id"] == it["report"]) missing = false;
                }
                if (missing)
                    add("E_NAV_REPORT", "project.json", path + "/report",
                        "report '" + it["report"].get<std::string>() + "' does not exist");
                return;
            }
            if (!it.contains("screen")) return addNav(path, "a menu entry needs a screen or items");
            const std::string target = it["screen"].get<std::string>();
            if (!projectHasScreen(target))
                return addNav(path + "/screen", "screen '" + target + "' does not exist");
            if (kindOf(target) == "popup")
                addNav(path + "/screen", "screen '" + target + "' is a popup");
        };
        const json& items = nav["items"];
        for (size_t i = 0; i < items.size(); ++i) {
            const json& it = items[i];
            const std::string p = "/navigation/items/" + std::to_string(i);
            if (!it.contains("items")) {
                leaf(it, p);
                continue;
            }
            if (it.contains("screen")) addNav(p, "a group has no screen");
            if (it["items"].empty()) addNav(p, "a group needs at least one entry");
            for (size_t j = 0; j < it["items"].size(); ++j) {
                const json& c = it["items"][j];
                const std::string cp = p + "/items/" + std::to_string(j);
                if (c.contains("items"))
                    addNav(cp, "a group cannot contain a group");
                else
                    leaf(c, cp);
            }
        }
        if (leaves > kLimit03NavLeaves)
            add("E_LIMIT", "project.json", "/navigation/items", "more than 32 menu entries");
    }

    // ---- Tags used by a screen, popups ----
    std::set<std::string> screenTagIds(const Rules03Input::ScreenDoc& s) const {
        std::set<std::string> out;
        const json& items = s.screen["items"];
        for (size_t i = 0; i < items.size(); ++i) {
            const json& item = items[i];
            if (item.value("hidden", false)) continue;
            if (item["type"] == "widget") {
                // history widgets (catalog 0.5.0) read the history API, not the live stream
                if (const WidgetSpec* ws = in_.catalog->find(item["widget"].get<std::string>());
                    ws && ws->group == "history")
                    continue;
                if (item.contains("tags") && isObj(item["tags"]))
                    for (const auto& kv : item["tags"].items()) {
                        if (kv.value().is_array()) {
                            for (const auto& id : kv.value())
                                if (id.is_string()) out.insert(id.get<std::string>());
                        } else if (kv.value().is_string()) {
                            out.insert(kv.value().get<std::string>());
                        }
                    }
            } else {
                const auto it = s.svg.find(i);
                if (it == s.svg.end() || !it->second.hasBindings) continue;
                for (const auto& e : it->second.bindings["elements"]) {
                    if (e.contains("bindings"))
                        for (const auto& b : e["bindings"])
                            out.insert(b["source"]["tagId"].get<std::string>());
                    // 0.4: the Tag of the click action (write, toggle, pulse)
                    if (e.contains("events") && e["events"].is_object() &&
                        e["events"].contains("click") && e["events"]["click"].is_object() &&
                        e["events"]["click"].contains("tag") &&
                        e["events"]["click"]["tag"].is_string())
                        out.insert(e["events"]["click"]["tag"].get<std::string>());
                }
            }
        }
        return out;
    }

    std::vector<std::string> popupTargets(const Rules03Input::ScreenDoc& s) const {
        std::vector<std::string> out;
        for (const auto& item : s.screen["items"]) {
            if (item["type"] != "widget" || item.value("hidden", false)) continue;
            if (!item.contains("events") || !isObj(item["events"]) ||
                !item["events"].contains("click"))
                continue;
            const json& c = item["events"]["click"];
            if (isObj(c) && c.contains("action") && c["action"].is_string() &&
                c["action"] == "popup" && c.contains("screen") && c["screen"].is_string()) {
                const std::string t = c["screen"].get<std::string>();
                if (std::find(out.begin(), out.end(), t) == out.end()) out.push_back(t);
            }
        }
        return out;
    }

    void screenTagLimits() {
        for (const auto& s : in_.screens) {
            const std::set<std::string>& own = tagSets_[s.id];
            bool over = own.size() > kMaxScreenTagsLimit;
            if (!over)
                for (const std::string& p : popupTargets(s)) {
                    const auto ps = tagSets_.find(p);
                    if (ps == tagSets_.end() || kindOf(p) != "popup") continue;
                    std::set<std::string> uni = own;
                    uni.insert(ps->second.begin(), ps->second.end());
                    if (uni.size() > kMaxScreenTagsLimit) {
                        over = true;
                        break;
                    }
                }
            if (over)
                add("E_SCREEN_TAGS", s.file, "/items",
                    "screen '" + s.id +
                        "' references more than 1000 tags (with the popups it opens)");
            if (own.size() > kWarnScreenTags)
                warn("W_SCREEN_TAGS_MANY", s.file, "/items",
                     "screen '" + s.id + "' references " + std::to_string(own.size()) + " tags");
        }
    }

    // ---- screens ----
    void screenRules(const Rules03Input::ScreenDoc& s) {
        const json& screen = s.screen;
        const std::string& file = s.file;
        const std::string pv = project_["schemaVersion"].get<std::string>();
        const std::string sv = screen["schemaVersion"].get<std::string>();
        if (sv != pv)
            add("E_SCHEMA_VERSION", file, "/schemaVersion",
                "schemaVersion " + sv + " differs from project.json (" + pv +
                    "): every file must match");
        if (screen["id"].get<std::string>() != s.id)
            add("E_SCREEN_ID", file, "/id", "id differs from the file name '" + s.id + "'");
        const std::string kind = screen.value("kind", "screen");
        if (kind != "screen" && kind != "popup")
            add("E_SCREEN_KIND", file, "/kind", "kind must be screen or popup");
        const json& sz = screen["size"];
        const auto badDim = [](const json& v, double lo, double hi) {
            if (!v.is_number() || !isIntegerValue(v)) return true;
            const double d = v.get<double>();
            return d < lo || d > hi;
        };
        if (badDim(sz["width"], kWidthLo, kWidthHi))
            add("E_SCREEN_SIZE", file, "/size/width", "width must be 64-4096");
        if (badDim(sz["height"], kHeightLo, kHeightHi))
            add("E_SCREEN_SIZE", file, "/size/height", "height must be 64-2304");
        const double sw = sz["width"].get<double>(), sh = sz["height"].get<double>();

        const json& items = screen["items"];
        if (items.size() > kLimit03Items) add("E_LIMIT", file, "/items", "more than 250 items");
        size_t svgCount = 0, charts = 0;
        for (const auto& it : items) {
            if (it["type"] == "svg") ++svgCount;
            if (it["type"] == "widget") {
                const WidgetSpec* spec = in_.catalog->find(it["widget"].get<std::string>());
                if (spec && spec->group == "chart") ++charts;
            }
        }
        const size_t svgLimit = schemaIs04Plus(in_.schema) ? kLimit04SvgItems : kLimit03SvgItems;
        if (svgCount > svgLimit)
            add("E_LIMIT", file, "/items", "more than " + std::to_string(svgLimit) + " svg items");
        if (charts > kLimit03Charts) add("E_LIMIT", file, "/items", "more than 16 charts");
        if (items.empty()) warn("W_SCREEN_EMPTY", file, "", "the screen has no item");
        if (screen.value("fitMode", "") == "stretch") {
            bool anyWidget = false;
            for (const auto& it : items)
                if (it["type"] == "widget") anyWidget = true;
            if (anyWidget) warn("W_STRETCH_WIDGETS", file, "/fitMode", "stretch distorts widgets");
        }

        std::set<std::string> ids;
        for (size_t i = 0; i < items.size(); ++i) {
            const json& item = items[i];
            const std::string p = "/items/" + std::to_string(i);
            const std::string id = item["id"].get<std::string>();
            if (!isItemId(id) && !(in_.schema == "1.0" && isInstItemId(id)))
                add("E_ITEM_ID", file, p + "/id", "item id '" + id + "' is invalid");
            else if (ids.count(id))
                add("E_ITEM_ID", file, p + "/id", "item id '" + id + "' is duplicated");
            ids.insert(id);
            if (isOutside(rectOf(item), sw, sh))
                warn("W_ITEM_OUTSIDE", file, p, "the item lies outside the screen");
            if (item["type"] == "svg")
                svgItem(s, item, i);
            else
                widgetItem(s, item, i);
        }

        // 0.4: the infinite animations of the items that are shown
        if (schemaIs04Plus(in_.schema)) {
            size_t anims = 0;
            for (size_t i = 0; i < items.size(); ++i) {
                if (items[i]["type"] != "svg" || items[i].value("hidden", false)) continue;
                const auto d = s.svg.find(i);
                if (d != s.svg.end() && d->second.hasBindings)
                    anims += countAnimations04(d->second.bindings);
            }
            if (anims > kLimit04Animations)
                add("E_LIMIT", file, "/items", "more than 256 infinite animations");
            if (anims > kLimit04AnimWarn)
                warn("W_ANIM_MANY", file, "/items",
                     std::to_string(anims) + " infinite animations on the screen");
        }

        // a widget that an item above it covers completely
        for (size_t i = 0; i < items.size(); ++i) {
            const json& item = items[i];
            if (item["type"] != "widget" || item.value("hidden", false)) continue;
            for (size_t j = i + 1; j < items.size(); ++j) {
                const json& o = items[j];
                if (!o.value("hidden", false) && covers(rectOf(o), rectOf(item))) {
                    warn("W_ITEM_COVERED", file, "/items/" + std::to_string(i),
                         "covered by item '" + o["id"].get<std::string>() + "'");
                    break;
                }
            }
        }
    }

    void svgItem(const Rules03Input::ScreenDoc& s, const json& item, size_t i) {
        const std::string& file = s.file;
        const std::string p = "/items/" + std::to_string(i);
        if (coord(item, "width") <= 0) add("E_ITEM_SIZE", file, p + "/width", "width must be > 0");
        if (coord(item, "height") <= 0)
            add("E_ITEM_SIZE", file, p + "/height", "height must be > 0");
        std::set<std::string> uids;
        const json& els = item["elements"];
        for (size_t j = 0; j < els.size(); ++j) {
            const std::string uid = els[j]["elementUid"].get<std::string>();
            if (uids.count(uid))
                add("E_DUP_UID", file, p + "/elements/" + std::to_string(j) + "/elementUid",
                    "elementUid '" + uid + "' is duplicated");
            uids.insert(uid);
        }
        const std::string bfile = item["bindingFile"].get<std::string>();
        const auto owner = sharedBinding_.find(bfile);
        if (owner != sharedBinding_.end())
            add("E_SCHEMA", file, p + "/bindingFile",
                "binding file '" + bfile + "' is used by " + owner->second + " too");
        else
            sharedBinding_[bfile] = s.id + ":" + item["id"].get<std::string>();

        const auto data = s.svg.find(i);
        if (data == s.svg.end() || !data->second.hasBindings) return;
        const json& b = data->second.bindings;
        if (b["screenId"] != s.screen["id"])
            add("E_SCREEN_ID", bfile, "/screenId",
                "screenId differs from screen '" + s.screen["id"].get<std::string>() + "'");
        if (b.contains("itemId") && b["itemId"] != item["id"])
            add("E_SCHEMA", bfile, "/itemId", "itemId differs from the svg item");
        const std::string pv = project_["schemaVersion"].get<std::string>();
        if (b["schemaVersion"].get<std::string>() != pv)
            add("E_SCHEMA_VERSION", bfile, "/schemaVersion",
                "schemaVersion " + b["schemaVersion"].get<std::string>() +
                    " differs from project.json (" + pv + "): every file must match");
        if (schemaIs04Plus(in_.schema)) {
            Binding04Ctx c4;
            c4.hasTags = in_.tags != nullptr;
            c4.tagType = &tagType_;
            c4.tagTable = &tagTable_;
            c4.tableSet = &tableSet_;
            c4.tagOf = [this](const std::string& id) -> const json* {
                const auto t = tagInfo_.find(id);
                return t == tagInfo_.end() ? nullptr : t->second.j;
            };
            std::vector<std::string> ids;
            for (const auto& sid : project_["screens"]) ids.push_back(sid.get<std::string>());
            c4.screens = &ids;
            c4.kindOf = [this](const std::string& id) { return kindOf(id); };
            c4.format10 = in_.schema == "1.0";
            bindingRules04(
                b, bfile, uids, c4,
                [this](const char* code, const std::string& f, const std::string& path,
                       const std::string& msg) { add(code, f, path, msg); },
                [this](const char* code, const std::string& f, const std::string& path,
                       const std::string& msg) { warn(code, f, path, msg); });
            return;
        }
        BindingCtx ctx;
        ctx.hasTags = in_.tags != nullptr;
        ctx.tagType = &tagType_;
        ctx.tagTable = &tagTable_;
        ctx.tableSet = &tableSet_;
        bindingRules(b, bfile, uids, ctx,
                     [this](const char* code, const std::string& f, const std::string& path,
                            const std::string& msg) { add(code, f, path, msg); });
    }

    void widgetItem(const Rules03Input::ScreenDoc& s, const json& item, size_t i) {
        paramMode_ = in_.paramScreens && in_.paramScreens->count(s.id) > 0;
        const std::string& file = s.file;
        const std::string p = "/items/" + std::to_string(i);
        const std::string widget = item["widget"].get<std::string>();
        const WidgetSpec* spec = in_.catalog->find(widget);
        const double w = coord(item, "width"), h = coord(item, "height");
        if (!spec) {
            add("E_WIDGET_UNKNOWN", file, p + "/widget",
                "widget '" + widget + "' is not in the catalog");
            if (w <= 0) add("E_ITEM_SIZE", file, p + "/width", "width must be > 0");
            if (h <= 0) add("E_ITEM_SIZE", file, p + "/height", "height must be > 0");
            return;
        }
        if (w <= 0 || w < spec->minWidth)
            add("E_ITEM_SIZE", file, p + "/width",
                "width must be >= " + std::to_string(spec->minWidth) + " for " + spec->id);
        if (h <= 0 || h < spec->minHeight)
            add("E_ITEM_SIZE", file, p + "/height",
                "height must be >= " + std::to_string(spec->minHeight) + " for " + spec->id);

        static const json kEmpty = json::object();
        const json& props = item.contains("props") && isObj(item["props"]) ? item["props"] : kEmpty;
        const json& tagsObj = item.contains("tags") && isObj(item["tags"]) ? item["tags"] : kEmpty;

        if (item.contains("security")) {
            // format 1.1 (feature 013): `view`, `operate` are allowed on every widget (rules_11);
            // an empty security or one with `minRole` on a widget without security stays
            // E_WIDGET_PROP
            const json& sec = item["security"];
            bool onlyAccess = sec.is_object() && !sec.empty();
            if (sec.is_object())
                for (auto it = sec.begin(); it != sec.end(); ++it)
                    if (it.key() != "view" && it.key() != "operate") onlyAccess = false;
            if (!spec->hasSecurity && !onlyAccess) {
                add("E_WIDGET_PROP", file, p + "/security",
                    spec->id + " has no security properties");
            } else if (spec->hasSecurity && item["security"].contains("minRole")) {
                const std::string role = item["security"]["minRole"].get<std::string>();
                if (std::find(spec->minRoles.begin(), spec->minRoles.end(), role) ==
                    spec->minRoles.end())
                    add("E_WIDGET_MINROLE", file, p + "/security/minRole",
                        "minRole is not one of the roles the widget allows");
            }
        }

        const EventSpec* click = nullptr;
        for (const auto& e : spec->events)
            if (e.name == "click") click = &e;
        std::string action;
        if (item.contains("events")) {
            if (!click)
                add("E_WIDGET_PROP", file, p + "/events", spec->id + " has no events");
            else if (item["events"].contains("click"))
                action = checkAction(s, item, i, *spec, click->actions);
        }

        const Tag* target = checkSlots(s, item, i, *spec, tagsObj, action);
        checkProps(s, *spec, p, props, tagsObj, target);
        if (spec->group == "alarm") checkAlarmWidget(s, *spec, p, props);
        if (spec->group == "history") {
            HistoryCtx ctx;
            ctx.logging = in_.loggingDoc;
            ctx.hasLoggingFile = project_.contains("loggingFile");
            historyWidgetRules(
                *spec, p, props, tagsObj, ctx,
                [&](const std::string& id) {
                    const auto it = tagInfo_.find(id);
                    return it == tagInfo_.end() ? std::string() : tagClassOf(it->second.type());
                },
                [&](const char* code, const std::string& path, const std::string& msg) {
                    add(code, file, path, msg);
                });
        }

        if (props.contains("confirm") && props["confirm"] == "none" && spec->prop("confirm")) {
            warn("W_CONFIRM_NONE", file, p + "/props/confirm",
                 "confirm none skips the confirmation");
            if (target && tagClassOf(target->type()) != "bool")
                add("E_WIDGET_CONFIRM", file, p + "/props/confirm",
                    "confirm none is only valid for a BOOL tag");
        }
    }

    const Tag* tagRef(const std::string& file, const std::string& id, const SlotSpec& slot,
                      const std::string& path, bool writeNeeded, bool boolOnly) {
        if (!in_.tags || (paramMode_ && hasParamText(json(id)))) return nullptr;
        const auto it = tagInfo_.find(id);
        if (it == tagInfo_.end()) {
            add("E_REF_TAG", file, path, "Tag '" + id + "' does not exist");
            return nullptr;
        }
        const Tag& t = it->second;
        const std::string cls = tagClassOf(t.type());
        if (std::find(slot.types.begin(), slot.types.end(), cls) == slot.types.end())
            add("E_WIDGET_TAG_TYPE", file, path,
                "a " + cls + " tag cannot be used for '" + slot.name + "'");
        else if (boolOnly && cls != "bool")
            add("E_WIDGET_TAG_TYPE", file, path,
                "this action needs a BOOL tag, '" + id + "' is " + t.type());
        if (writeNeeded && !t.writable())
            add("E_TAG_ACCESS", file, path,
                "tag '" + id + "' is not writable (needs a real RW tag, not calculated)");
        return &t;
    }

    const Tag* checkSlots(const Rules03Input::ScreenDoc& s, const json& item, size_t i,
                          const WidgetSpec& spec, const json& tagsObj, const std::string& action) {
        const std::string& file = s.file;
        const std::string p = "/items/" + std::to_string(i) + "/tags";
        const Tag* target = nullptr;
        const bool hasEvents = !spec.events.empty();
        const bool usesTarget = !action.empty() && actionUsesTarget(action);
        const auto slotInUse = [&](const SlotSpec& slot) {
            return !hasEvents || slot.name != "target" || usesTarget;
        };
        const auto requiredByAction = [&](const SlotSpec& slot) {
            return hasEvents && slot.name == "target" && usesTarget;
        };
        for (const auto& slot : spec.slots)
            if ((slot.required || requiredByAction(slot)) && !tagsObj.contains(slot.name))
                add("E_WIDGET_SLOT", file, p, "slot '" + slot.name + "' is required");

        for (auto kv = tagsObj.begin(); kv != tagsObj.end(); ++kv) {
            const std::string name = kv.key();
            const json& value = kv.value();
            const SlotSpec* slot = spec.slot(name);
            if (!slot) {
                add("E_WIDGET_SLOT", file, p + "/" + name,
                    "slot '" + name + "' does not exist for " + spec.id);
                continue;
            }
            const bool inUse = slotInUse(*slot);
            if (!inUse && hasEvents && !action.empty()) {
                add("E_WIDGET_SLOT", file, p + "/" + name,
                    "slot '" + name + "' is not used by action '" + action + "'");
                continue;
            }
            if (!inUse && action.empty() && hasEvents) {
                if (!item.contains("events") || !item["events"].contains("click"))
                    add("E_WIDGET_SLOT", file, p + "/" + name,
                        "slot '" + name + "' needs a click action that writes");
                continue;
            }
            const bool toggleLike = action == "toggle" || action == "pulse";
            if (slot->multi) {
                if (!value.is_array()) {
                    add("E_WIDGET_SLOT", file, p + "/" + name,
                        "slot '" + name + "' takes a list of tags");
                    continue;
                }
                if (value.empty())
                    add("E_WIDGET_SLOT", file, p + "/" + name, "slot '" + name + "' is empty");
                if (slot->max && value.size() > static_cast<size_t>(*slot->max))
                    add("E_LIMIT", file, p + "/" + name,
                        "slot '" + name + "' takes at most " + std::to_string(*slot->max) +
                            " tags");
                std::set<std::string> seen;
                for (size_t k = 0; k < value.size(); ++k) {
                    if (!value[k].is_string()) continue;
                    const std::string id = value[k].get<std::string>();
                    if (seen.count(id))
                        add("E_WIDGET_SLOT", file, p + "/" + name + "/" + std::to_string(k),
                            "tag '" + id + "' is duplicated in '" + name + "'");
                    seen.insert(id);
                    tagRef(file, id, *slot, p + "/" + name + "/" + std::to_string(k),
                           slot->needsWrite, false);
                }
            } else {
                if (!value.is_string()) {
                    add("E_WIDGET_SLOT", file, p + "/" + name, "slot '" + name + "' takes one tag");
                    continue;
                }
                const Tag* t = tagRef(file, value.get<std::string>(), *slot, p + "/" + name,
                                      slot->needsWrite, toggleLike);
                if (slot->needsWrite) target = t;
            }
        }
        return target;
    }

    std::optional<double> numProp(const json& props, const char* n) const {
        if (props.contains(n) && props[n].is_number()) return props[n].get<double>();
        return std::nullopt;
    }

    // Alarm widgets (catalog 0.4.0): areas/classes naming an id the project lacks is a warning;
    // the `screen` target of alarm-count must be a regular screen.
    void checkAlarmWidget(const Rules03Input::ScreenDoc& s, const WidgetSpec& spec,
                          const std::string& p, const json& props) {
        const std::pair<const char*, const std::set<std::string>*> refs[] = {
            {"areas", in_.alarmAreas}, {"classes", in_.alarmClasses}};
        for (const auto& [name, known] : refs) {
            if (!known || !props.contains(name) || !props[name].is_array() || !spec.prop(name))
                continue;
            size_t k = 0;
            for (const auto& v : props[name]) {
                if (v.is_string()) {
                    const std::string id = v.get<std::string>();
                    if (id != "-" && !known->count(id))
                        warn("W_WIDGET_ALARM_REF", s.file,
                             p + "/props/" + name + "/" + std::to_string(k),
                             std::string(name) + " '" + id + "' is not defined in the project");
                }
                ++k;
            }
        }
        if (!props.contains("target") || !props["target"].is_object()) return;
        const json& t = props["target"];
        if (t.value("kind", "") != "screen" || !t.contains("screen") || !t["screen"].is_string())
            return;
        const std::string id = t["screen"].get<std::string>();
        const std::string base = p + "/props/target/screen";
        if (!projectHasScreen(id)) {
            add("E_ACTION_TARGET", s.file, base, "screen '" + id + "' does not exist");
        } else {
            const std::string k = kindOf(id);
            if (!k.empty() && k != "screen")
                add("E_ACTION_TARGET", s.file, base,
                    "target needs a screen, '" + id + "' is a " + k);
        }
    }

    void checkProps(const Rules03Input::ScreenDoc& s, const WidgetSpec& spec, const std::string& p,
                    const json& props, const json& tagsObj, const Tag* target) {
        const std::string& file = s.file;
        bool labelsBad = false;
        for (auto kv = props.begin(); kv != props.end(); ++kv) {
            const std::string name = kv.key();
            const json* ps = spec.prop(name);
            if (!ps) {
                add("E_WIDGET_PROP", file, p + "/props/" + name,
                    "property '" + name + "' does not exist for " + spec.id);
                continue;
            }
            if (paramMode_ && hasParamText(kv.value())) continue;
            const std::string err = checkPropValue(*ps, kv.value());
            if (!err.empty() && name == "labels") labelsBad = true;
            if (!err.empty())
                add("E_WIDGET_PROP", file, p + "/props/" + name, "property '" + name + "': " + err);
            else if (ps->value("kind", "") == "tableRef" && kv.value().is_string() &&
                     !tableSet_.count(kv.value().get<std::string>()))
                add("E_REF_TABLE", file, p + "/props/" + name,
                    "value table '" + kv.value().get<std::string>() + "' does not exist");
        }
        if (spec.prop("yMin") && spec.prop("yMax")) {
            const bool hasMin = props.contains("yMin"), hasMax = props.contains("yMax");
            if (hasMin != hasMax)
                add("E_WIDGET_PROP", file, p + std::string("/props/") + (hasMin ? "yMin" : "yMax"),
                    "yMin and yMax must be given together");
            else if (numProp(props, "yMin") && numProp(props, "yMax") &&
                     *numProp(props, "yMin") >= *numProp(props, "yMax"))
                add("E_WIDGET_PROP", file, p + "/props/yMax", "yMin must be less than yMax");
        }
        if (spec.prop("min") && spec.prop("max") && numProp(props, "min") &&
            numProp(props, "max") && *numProp(props, "min") >= *numProp(props, "max"))
            add("E_WIDGET_LIMITS", file, p + "/props/max", "min must be less than max");
        // no more labels than the Tags of the slot with many Tags
        if (props.contains("labels") && props["labels"].is_array() && !labelsBad) {
            const SlotSpec* multi = nullptr;
            for (const auto& sl : spec.slots)
                if (sl.multi) {
                    multi = &sl;
                    break;
                }
            if (multi && tagsObj.contains(multi->name) && tagsObj[multi->name].is_array() &&
                props["labels"].size() > tagsObj[multi->name].size())
                add("E_WIDGET_PROP", file, p + "/props/labels", "more labels than tags");
        }
        // limits against the limits of the Tag
        bool limited = false;
        for (const auto& pr : spec.props) {
            const std::string ft = pr.value("fromTag", "");
            if (ft.rfind("limits.", 0) == 0) limited = true;
        }
        if (limited && target && target->writable()) {
            for (const char* n : {"min", "max"}) {
                const auto v = numProp(props, n);
                if (!v || !target->limits()) continue;
                const auto lmin = target->limit("min"), lmax = target->limit("max");
                if ((lmin && *v < *lmin) || (lmax && *v > *lmax))
                    add("E_WIDGET_LIMITS", file, p + "/props/" + n,
                        std::string(n) + " is outside the limits of tag '" + target->id() + "'");
            }
            if (isNumericTagTypeName(target->type()) && !target->limit("min") &&
                !target->limit("max") && !numProp(props, "min") && !numProp(props, "max")) {
                std::string slotName = "target";
                for (const auto& sl : spec.slots)
                    if (sl.needsWrite) {
                        slotName = sl.name;
                        break;
                    }
                warn("W_WRITE_NO_LIMITS", file, p + "/tags/" + slotName,
                     "no limits on '" + target->id() + "' or on the widget");
            }
        }
        // a table is needed (select): the property or the table of the Tag
        for (const auto& pr : spec.props) {
            if (pr.value("kind", "") == "tableRef" && pr.value("fromTag", "") == "valueTable") {
                const std::string name = pr.value("name", "");
                if (!props.contains(name) && target && !target->hasValueTable())
                    add("E_WIDGET_PROP", file, p + "/props",
                        "'" + name + "' is needed: the tag has no value table");
                break;
            }
        }
    }

    // The action of the click event; its name (so that the slot `target` is known to be used), or
    // "".
    std::string checkAction(const Rules03Input::ScreenDoc& s, const json& item, size_t i,
                            const WidgetSpec& spec, const std::vector<std::string>& allowed) {
        const std::string& file = s.file;
        const std::string base = "/items/" + std::to_string(i) + "/events/click";
        const json& c = item["events"]["click"];
        if (!isObj(c) || !c.contains("action")) {
            add("E_ACTION", file, base, "the click event needs an action");
            return "";
        }
        if (!c["action"].is_string()) {
            add("E_ACTION", file, base + "/action", "action must be a string");
            return "";
        }
        const std::string name = c["action"].get<std::string>();
        const ActionKeys* keys = actionKeys(name, in_.schema == "1.0");
        if (!keys || std::find(allowed.begin(), allowed.end(), name) == allowed.end()) {
            add("E_ACTION", file, base + "/action",
                "action '" + name + "' is not allowed for " + spec.id);
            return "";
        }
        for (auto kv = c.begin(); kv != c.end(); ++kv)
            if (kv.key() != "action" &&
                std::find(keys->all.begin(), keys->all.end(), kv.key()) == keys->all.end())
                add("E_ACTION", file, base + "/" + kv.key(),
                    "'" + kv.key() + "' is not a parameter of '" + name + "'");
        for (const auto& k : keys->required)
            if (!c.contains(k))
                add("E_ACTION", file, base, "action '" + name + "' needs '" + k + "'");

        const Tag* tag = nullptr;
        if (item.contains("tags") && isObj(item["tags"]) && item["tags"].contains("target") &&
            item["tags"]["target"].is_string()) {
            const auto it = tagInfo_.find(item["tags"]["target"].get<std::string>());
            if (it != tagInfo_.end()) tag = &it->second;
        }
        if (name == "write" && c.contains("value") && tag) {
            const std::string e = writeValueError(*tag, c["value"]);
            if (!e.empty()) add("E_ACTION", file, base + "/value", e);
            if (tag->writable() && isNumericTagTypeName(tag->type()) && !tag->limit("min") &&
                !tag->limit("max"))
                warn("W_WRITE_NO_LIMITS", file, "/items/" + std::to_string(i) + "/tags/target",
                     "no limits on '" + tag->id() + "'");
        }
        if (name == "pulse") {
            if (c.contains("value") && !c["value"].is_boolean())
                add("E_ACTION", file, base + "/value", "pulse value must be a boolean");
            if (c.contains("durationMs")) {
                const json& d = c["durationMs"];
                if (!d.is_number() || !isIntegerValue(d) || d.get<double>() < kDurationLo ||
                    d.get<double>() > kDurationHi)
                    add("E_ACTION", file, base + "/durationMs",
                        "durationMs must be an integer 100-10000");
            }
            if (tag && tag->kind() == "external") {
                const json* src = tag->j->contains("source") ? &(*tag->j)["source"] : nullptr;
                const bool readbackOff =
                    src && src->contains("readback") && (*src)["readback"] == false;
                if (!readbackOff)
                    warn("W_PULSE_READBACK", file, base,
                         "tag '" + tag->id() + "' reads back: the pulse may be seen as a change");
            }
        }
        if ((name == "navigate" || name == "popup") && c.contains("screen") &&
            c["screen"].is_string()) {
            const std::string want = name == "navigate" ? "screen" : "popup";
            const std::string target = c["screen"].get<std::string>();
            if (!projectHasScreen(target)) {
                add("E_ACTION_TARGET", file, base + "/screen",
                    "screen '" + target + "' does not exist");
            } else {
                const std::string k = kindOf(target);
                if (!k.empty() && k != want)
                    add("E_ACTION_TARGET", file, base + "/screen",
                        "'" + name + "' needs a " + want + ", '" + target + "' is a " + k);
            }
        } else if ((name == "navigate" || name == "popup") && c.contains("screen")) {
            add("E_ACTION", file, base + "/screen", "screen must be a string");
        }
        if (name == "closePopup" && s.screen.value("kind", "screen") == "screen")
            warn("W_ACTION_NOOP", file, base, "closePopup on a screen does nothing");
        return name;
    }

    const Rules03Input& in_;
    std::vector<ProjectIssue>& errors_;
    std::vector<ProjectIssue>& warnings_;
    const json& project_;
    std::set<std::string> tableSet_;
    std::map<std::string, Tag> tagInfo_;
    std::map<std::string, std::string> tagType_, tagTable_;
    std::map<std::string, const Rules03Input::ScreenDoc*> screens_;
    std::map<std::string, std::set<std::string>> tagSets_;
    std::map<std::string, std::string> sharedBinding_;
    // format 1.0: where add() and warn() write while an expansion is checked (null: the outputs)
    std::vector<ProjectIssue>* errSink_ = nullptr;
    std::vector<ProjectIssue>* warnSink_ = nullptr;
    // the widget being checked is in a popup with params (format 1.0)
    bool paramMode_ = false;
};

}  // namespace

void runRules03(const Rules03Input& in, std::vector<ProjectIssue>& errors,
                std::vector<ProjectIssue>& warnings) {
    Rules(in, errors, warnings).run();
}

}  // namespace mat
