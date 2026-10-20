#include "core/auth/access_catalog.hpp"

#include <algorithm>
#include <map>
#include <set>

#include "core/project-manager/project_validator.hpp"
#include "core/project-manager/widget_catalog.hpp"

namespace mat {

namespace {

using nlohmann::json;

bool isObj(const json& j) { return j.is_object(); }

Role roleOr(const json& obj, const char* key, Role def) {
    if (!isObj(obj) || !obj.contains(key) || !obj[key].is_string()) return def;
    return parseRole(obj[key].get<std::string>()).value_or(def);
}

void addString(const json& v, std::vector<std::string>& out) {
    if (v.is_string()) out.push_back(v.get<std::string>());
}

// The {name} of a Tag text replaced with `values`; nullopt when a name has no value.
std::optional<std::string> substitute(const std::string& s,
                                      const std::map<std::string, std::string>& values) {
    std::string out;
    for (size_t i = 0; i < s.size(); ++i) {
        if (s[i] != '{') {
            out += s[i];
            continue;
        }
        const size_t end = s.find('}', i + 1);
        if (end == std::string::npos) return std::nullopt;
        const auto it = values.find(s.substr(i + 1, end - i - 1));
        if (it == values.end()) return std::nullopt;
        out += it->second;
        i = end;
    }
    return out;
}

// The args sets that open each popup (click events of widgets and of SVG elements, on every
// screen), as name -> value maps.
std::map<std::string, std::vector<std::map<std::string, std::string>>> popupArgs(
    const LoadedProject& p) {
    std::map<std::string, std::vector<std::map<std::string, std::string>>> out;
    const auto take = [&](const json& click) {
        if (!isObj(click) || click.value("action", "") != "popup" || !click.contains("screen") ||
            !click["screen"].is_string())
            return;
        std::map<std::string, std::string> args;
        if (click.contains("args") && isObj(click["args"]))
            for (auto it = click["args"].begin(); it != click["args"].end(); ++it)
                if (it.value().is_string()) args[it.key()] = it.value().get<std::string>();
        out[click["screen"].get<std::string>()].push_back(std::move(args));
    };
    for (const auto& s : p.screens) {
        if (!isObj(s.screen) || !s.screen.contains("items") || !s.screen["items"].is_array())
            continue;
        for (const auto& item : s.screen["items"])
            if (isObj(item) && item.contains("events") && isObj(item["events"]) &&
                item["events"].contains("click"))
                take(item["events"]["click"]);
        for (const auto& [id, b] : s.itemBindings) {
            (void)id;
            if (!isObj(b) || !b.contains("elements") || !b["elements"].is_array()) continue;
            for (const auto& e : b["elements"])
                if (isObj(e) && e.contains("events") && isObj(e["events"]) &&
                    e["events"].contains("click"))
                    take(e["events"]["click"]);
        }
    }
    return out;
}

// The Tags of a binding file (elements[].bindings[].source.tagId, elements[].events.click.tag);
// `writes` is set when a click event has a Tag.
void bindingTags(const json& b, std::vector<std::string>& tags, bool& writes) {
    if (!isObj(b) || !b.contains("elements") || !b["elements"].is_array()) return;
    for (const auto& e : b["elements"]) {
        if (!isObj(e)) continue;
        if (e.contains("bindings") && e["bindings"].is_array())
            for (const auto& bd : e["bindings"])
                if (isObj(bd) && bd.contains("source") && isObj(bd["source"]) &&
                    bd["source"].contains("tagId"))
                    addString(bd["source"]["tagId"], tags);
        if (e.contains("events") && isObj(e["events"]) && e["events"].contains("click")) {
            const json& c = e["events"]["click"];
            if (isObj(c) && c.contains("tag") && c["tag"].is_string()) {
                tags.push_back(c["tag"].get<std::string>());
                writes = true;
            }
        }
    }
}

void sortUnique(std::vector<std::string>& v) {
    std::sort(v.begin(), v.end());
    v.erase(std::unique(v.begin(), v.end()), v.end());
}

}  // namespace

ResourceCatalog catalogFromProject(const LoadedProject& p, const WidgetCatalog* widgets) {
    ResourceCatalog c;
    const bool v03 = p.is03();
    const auto args = v03 ? popupArgs(p) : decltype(popupArgs(p)){};
    std::vector<std::string> order;
    if (isObj(p.project) && p.project.contains("screens") && p.project["screens"].is_array())
        for (const auto& id : p.project["screens"])
            if (id.is_string()) order.push_back(id.get<std::string>());
    for (const std::string& id : order) {
        const auto s = std::find_if(p.screens.begin(), p.screens.end(),
                                    [&](const LoadedProject::Screen& x) { return x.id == id; });
        if (s == p.screens.end()) continue;
        CatalogScreen cs;
        cs.id = id;
        cs.title = s->screen.value("name", id);
        if (!v03) {
            // one item: the drawing with every binding of the screen
            CatalogItem item;
            item.id = "svg";
            item.widget = "svg";
            item.title = cs.title;
            bindingTags(s->bindings, item.tags, item.operable);
            sortUnique(item.tags);
            cs.items.push_back(std::move(item));
            c.screens.push_back(std::move(cs));
            continue;
        }
        cs.popup = s->screen.value("kind", "screen") == "popup";
        if (s->screen.contains("security"))
            cs.view = roleOr(s->screen["security"], "view", Role::Viewer);
        // The values a {name} of this screen can take: the args of each opener, with the defaults
        // of the params; the defaults alone when nothing opens it.
        std::vector<std::map<std::string, std::string>> valueSets;
        std::map<std::string, std::string> defaults;
        if (s->screen.contains("params") && s->screen["params"].is_array())
            for (const auto& prm : s->screen["params"])
                if (isObj(prm) && prm.contains("name") && prm["name"].is_string() &&
                    prm.contains("default") && prm["default"].is_string())
                    defaults[prm["name"].get<std::string>()] = prm["default"].get<std::string>();
        if (const auto a = args.find(id); a != args.end())
            for (const auto& given : a->second) {
                std::map<std::string, std::string> v = defaults;
                for (const auto& kv : given) v[kv.first] = kv.second;
                valueSets.push_back(std::move(v));
            }
        if (valueSets.empty()) valueSets.push_back(defaults);
        const auto addTag = [&](const std::string& t, std::vector<std::string>& out) {
            if (t.find('{') == std::string::npos) {
                out.push_back(t);
                return;
            }
            for (const auto& v : valueSets)
                if (const auto r = substitute(t, v)) out.push_back(*r);
        };
        if (!s->screen.contains("items") || !s->screen["items"].is_array()) {
            c.screens.push_back(std::move(cs));
            continue;
        }
        for (const auto& it : s->screen["items"]) {
            if (!isObj(it) || !it.contains("id") || !it["id"].is_string()) continue;
            CatalogItem item;
            item.id = it["id"].get<std::string>();
            item.title = it.value("name", item.id);
            const std::string type = it.value("type", "");
            if (type == "svg") {
                item.widget = "svg";
                const auto b = s->itemBindings.find(item.id);
                std::vector<std::string> raw;
                if (b != s->itemBindings.end()) bindingTags(b->second, raw, item.operable);
                for (const auto& t : raw) addTag(t, item.tags);
                if (it.contains("elements") && it["elements"].is_array())
                    for (const auto& e : it["elements"])
                        if (isObj(e) && e.contains("elementUid") && e["elementUid"].is_string())
                            item.elementUids.push_back(e["elementUid"].get<std::string>());
            } else {
                item.widget = it.value("widget", "");
                if (widgets)
                    if (const WidgetSpec* w = widgets->find(item.widget))
                        item.operable = w->group == "control";
                if (it.contains("tags") && isObj(it["tags"]))
                    for (auto kv = it["tags"].begin(); kv != it["tags"].end(); ++kv) {
                        if (kv.value().is_string())
                            addTag(kv.value().get<std::string>(), item.tags);
                        if (kv.value().is_array())
                            for (const auto& t : kv.value())
                                if (t.is_string()) addTag(t.get<std::string>(), item.tags);
                    }
            }
            sortUnique(item.tags);
            if (it.contains("security") && isObj(it["security"])) {
                const json& sec = it["security"];
                item.view = roleOr(sec, "view", Role::Viewer);
                item.operate = roleOr(sec, "operate", roleOr(sec, "minRole", Role::Operator));
            }
            cs.items.push_back(std::move(item));
        }
        c.screens.push_back(std::move(cs));
    }
    if (isObj(p.logging) && p.logging.contains("groups") && p.logging["groups"].is_array())
        for (const auto& g : p.logging["groups"]) {
            if (!isObj(g) || !g.contains("id") || !g["id"].is_string()) continue;
            CatalogTagSet set;
            set.id = g["id"].get<std::string>();
            set.title = g.value("name", set.id);
            if (g.contains("tags") && g["tags"].is_array())
                for (const auto& t : g["tags"])
                    if (isObj(t) && t.contains("tagId")) addString(t["tagId"], set.tags);
            sortUnique(set.tags);
            c.historyGroups.push_back(std::move(set));
        }
    if (isObj(p.reports) && p.reports.contains("reports") && p.reports["reports"].is_array())
        for (const auto& r : p.reports["reports"]) {
            if (!isObj(r) || !r.contains("id") || !r["id"].is_string()) continue;
            CatalogTagSet set;
            set.id = r["id"].get<std::string>();
            set.title = r.value("name", set.id);
            if (r.contains("columns") && r["columns"].is_array())
                for (const auto& col : r["columns"])
                    if (isObj(col) && col.contains("tagId")) addString(col["tagId"], set.tags);
            sortUnique(set.tags);
            c.reports.push_back(std::move(set));
        }
    for (const auto& [name, table] : p.watchTables) {
        (void)name;
        if (!isObj(table) || !table.contains("rows") || !table["rows"].is_array()) continue;
        for (const auto& row : table["rows"])
            if (isObj(row) && row.contains("tag")) addString(row["tag"], c.watchTags);
    }
    sortUnique(c.watchTags);
    if (isObj(p.alarms) && p.alarms.contains("alarms") && p.alarms["alarms"].is_array())
        for (const auto& a : p.alarms["alarms"]) {
            if (!isObj(a) || !a.contains("id") || !a["id"].is_string()) continue;
            CatalogAlarm al;
            al.id = a["id"].get<std::string>();
            if (a.contains("tag") && a["tag"].is_string()) al.tag = a["tag"].get<std::string>();
            c.alarms.push_back(std::move(al));
        }
    return c;
}

const CatalogItem* itemOfWrite(const ResourceCatalog& catalog, const std::string& screen,
                               const std::string& widget) {
    const CatalogScreen* s = catalog.screen(screen);
    if (!s || widget.empty()) return nullptr;
    for (const auto& i : s->items)
        if (i.id == widget) return &i;
    for (const auto& i : s->items)
        if (std::find(i.elementUids.begin(), i.elementUids.end(), widget) != i.elementUids.end())
            return &i;
    return nullptr;
}

}  // namespace mat
