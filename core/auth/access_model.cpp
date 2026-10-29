#include "core/auth/access_model.hpp"

#include <algorithm>
#include <set>

#include "core/auth/account_store.hpp"
#include "core/common/utf8.hpp"

namespace mat {

namespace {

using nlohmann::json;

constexpr std::string_view kScreen = "screen:";
constexpr std::string_view kItem = "item:";
constexpr std::string_view kPage = "page:";
constexpr std::string_view kHistory = "history:";
constexpr std::string_view kReport = "report:";

bool startsWith(std::string_view s, std::string_view p) { return s.substr(0, p.size()) == p; }

int rank(Role r) { return static_cast<int>(r); }

Role floorOf(AccessLevel l) { return l == AccessLevel::View ? Role::Viewer : Role::Operator; }

std::string itemKey(std::string_view screen, std::string_view item) {
    std::string k(screen);
    k += '/';
    k.append(item.data(), item.size());
    return k;
}

void sortUnique(std::vector<std::string>& v) {
    std::sort(v.begin(), v.end());
    v.erase(std::unique(v.begin(), v.end()), v.end());
}

// "item:<screen>/<item>" → screen, item; false for anything else.
bool splitItem(std::string_view resource, std::string_view& screen, std::string_view& item) {
    if (!startsWith(resource, kItem)) return false;
    const std::string_view rest = resource.substr(kItem.size());
    const size_t slash = rest.find('/');
    if (slash == std::string_view::npos || slash == 0 || slash + 1 >= rest.size()) return false;
    screen = rest.substr(0, slash);
    item = rest.substr(slash + 1);
    return true;
}

const CatalogTagSet* findSet(const std::vector<CatalogTagSet>& v, std::string_view id) {
    for (const auto& s : v)
        if (s.id == id) return &s;
    return nullptr;
}

bool knownPage(std::string_view name) {
    for (const auto& p : systemPages())
        if (p == name) return true;
    return false;
}

bool controlFree(std::string_view s) {
    for (const unsigned char c : s)
        if (c < 0x20 || c == 0x7f) return false;
    return true;
}

size_t codePoints(std::string_view s) {
    size_t n = 0;
    for (const unsigned char c : s)
        if ((c & 0xC0) != 0x80) ++n;
    return n;
}

}  // namespace

const char* accessLevelName(AccessLevel l) { return l == AccessLevel::View ? "view" : "operate"; }

std::optional<AccessLevel> parseAccessLevel(std::string_view s) {
    if (s == "view") return AccessLevel::View;
    if (s == "operate") return AccessLevel::Operate;
    return std::nullopt;
}

const std::vector<std::string>& systemPages() {
    static const std::vector<std::string> pages = {"alarms", "history", "reports", "watch"};
    return pages;
}

// --- catalog

const CatalogScreen* ResourceCatalog::screen(std::string_view id) const {
    for (const auto& s : screens)
        if (s.id == id) return &s;
    return nullptr;
}

const CatalogItem* ResourceCatalog::item(std::string_view screenId, std::string_view itemId) const {
    const CatalogScreen* s = screen(screenId);
    if (!s) return nullptr;
    for (const auto& i : s->items)
        if (i.id == itemId) return &i;
    return nullptr;
}

std::optional<Role> ResourceCatalog::projectDefault(std::string_view resource,
                                                    AccessLevel level) const {
    if (startsWith(resource, kScreen)) {
        const CatalogScreen* s = screen(resource.substr(kScreen.size()));
        if (!s || level != AccessLevel::View) return std::nullopt;
        return s->view;
    }
    std::string_view sid, iid;
    if (splitItem(resource, sid, iid)) {
        const CatalogItem* i = item(sid, iid);
        if (!i) return std::nullopt;
        if (level == AccessLevel::View) return i->view;
        if (!i->operable) return std::nullopt;
        return i->operate;
    }
    if (level != AccessLevel::View) return std::nullopt;
    if (startsWith(resource, kPage)) {
        const std::string_view name = resource.substr(kPage.size());
        if (!knownPage(name)) return std::nullopt;
        return name == "watch" ? Role::Operator : Role::Viewer;
    }
    if (startsWith(resource, kHistory))
        return findSet(historyGroups, resource.substr(kHistory.size()))
                   ? std::optional(Role::Viewer)
                   : std::nullopt;
    if (startsWith(resource, kReport))
        return findSet(reports, resource.substr(kReport.size())) ? std::optional(Role::Viewer)
                                                                 : std::nullopt;
    return std::nullopt;
}

bool ResourceCatalog::hasResource(std::string_view resource, AccessLevel level) const {
    return projectDefault(resource, level).has_value();
}

// --- store

const AccessGroup* AccessFile::group(std::string_view id) const {
    for (const auto& g : groups)
        if (g.id == id) return &g;
    return nullptr;
}

const AccessRule* AccessFile::rule(std::string_view resource, AccessLevel level) const {
    for (const auto& r : rules)
        if (r.level == level && r.resource == resource) return &r;
    return nullptr;
}

bool validGroupId(std::string_view id) {
    if (id.size() < 2 || id.size() > 32) return false;
    if (id[0] < 'a' || id[0] > 'z') return false;
    for (const char c : id.substr(1))
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-')) return false;
    return true;
}

bool validGroupName(std::string_view name) {
    if (name.empty()) return false;
    const std::string s(name);
    if (!isValidUtf8(s) || !controlFree(name)) return false;
    const size_t n = codePoints(name);
    return n >= 1 && n <= 64;
}

bool validGrantee(std::string_view g) {
    if (g == "*") return true;
    if (startsWith(g, "user:")) return validAccountName(g.substr(5));
    if (startsWith(g, "group:")) return validGroupId(g.substr(6));
    if (startsWith(g, "role:")) return parseRole(g.substr(5)).has_value();
    return false;
}

namespace {

// A resource of a rule in the file: any short text. One the project cannot have (another kind,
// page:admin, a level it has not) is an orphan (§2, tests/access-vectors README rule 5), not a
// damaged store; the admin API refuses such rules before they are written.
bool validRuleResource(std::string_view r) {
    return !r.empty() && r.size() <= 200 && controlFree(r);
}

bool majorOneVersion(const std::string& v) {
    // 1.<minor>.<patch>
    if (v.compare(0, 2, "1.") != 0) return false;
    size_t i = 2, parts = 0;
    while (parts < 2) {
        const size_t start = i;
        while (i < v.size() && v[i] >= '0' && v[i] <= '9') ++i;
        if (i == start || i - start > 9) return false;
        ++parts;
        if (parts == 1) {
            if (i >= v.size() || v[i] != '.') return false;
            ++i;
        }
    }
    return i == v.size();
}

}  // namespace

AccessParse parseAccessFile(std::string_view text) {
    AccessParse out;
    auto fail = [&](const std::string& why) {
        AccessParse e;
        e.error = why;
        return e;
    };
    if (text.size() > kAccessFileMaxBytes) return fail("larger than 2 MiB");
    const json doc = json::parse(text.begin(), text.end(), nullptr, false);
    if (doc.is_discarded() || !doc.is_object()) return fail("not a JSON object");
    if (!doc.contains("schemaVersion") || !doc["schemaVersion"].is_string() ||
        !majorOneVersion(doc["schemaVersion"].get<std::string>()))
        return fail("schemaVersion is not 1.x.y");
    out.file.schemaVersion = doc["schemaVersion"].get<std::string>();
    if (!doc.contains("rev") ||
        !(doc["rev"].is_number_integer() || doc["rev"].is_number_unsigned()) ||
        doc["rev"].get<int64_t>() < 0)
        return fail("rev is not an integer >= 0");
    out.file.rev = doc["rev"].get<int64_t>();
    if (!doc.contains("groups") || !doc["groups"].is_array()) return fail("no groups array");
    if (!doc.contains("rules") || !doc["rules"].is_array()) return fail("no rules array");
    const json& groups = doc["groups"];
    if (groups.size() > kMaxAccessGroups) return fail("more than 50 groups");
    std::set<std::string> ids;
    for (size_t i = 0; i < groups.size(); ++i) {
        const json& g = groups[i];
        const std::string at = "group " + std::to_string(i + 1);
        if (!g.is_object() || !g.contains("id") || !g["id"].is_string() || !g.contains("name") ||
            !g["name"].is_string())
            return fail(at + ": needs id and name");
        AccessGroup grp{g["id"].get<std::string>(), g["name"].get<std::string>()};
        if (!validGroupId(grp.id)) return fail(at + ": id does not match ^[a-z][a-z0-9-]{1,31}$");
        if (!validGroupName(grp.name)) return fail(at + ": name is not 1 to 64 characters");
        if (!ids.insert(grp.id).second) return fail(at + ": " + grp.id + " is there twice");
        out.file.groups.push_back(std::move(grp));
    }
    const json& rules = doc["rules"];
    if (rules.size() > kMaxAccessRules) return fail("more than 5000 rules");
    std::set<std::pair<std::string, int>> keys;
    for (size_t i = 0; i < rules.size(); ++i) {
        const json& r = rules[i];
        const std::string at = "rule " + std::to_string(i + 1);
        if (!r.is_object() || !r.contains("resource") || !r["resource"].is_string() ||
            !r.contains("level") || !r["level"].is_string() || !r.contains("grantees") ||
            !r["grantees"].is_array())
            return fail(at + ": needs resource, level and grantees");
        AccessRule rule;
        rule.resource = r["resource"].get<std::string>();
        if (!validRuleResource(rule.resource)) return fail(at + ": resource is not valid");
        const auto level = parseAccessLevel(r["level"].get<std::string>());
        if (!level) return fail(at + ": level is not view or operate");
        rule.level = *level;
        if (!keys.emplace(rule.resource, static_cast<int>(rule.level)).second)
            return fail(at + ": " + rule.resource + " " + accessLevelName(rule.level) +
                        " is there twice");
        const json& gs = r["grantees"];
        if (gs.size() > kMaxRuleGrantees) return fail(at + ": more than 64 grantees");
        std::set<std::string> seen;
        for (const auto& g : gs) {
            if (!g.is_string()) return fail(at + ": a grantee is not text");
            const std::string s = g.get<std::string>();
            // Any text: one that is not a grantee, or a group that is gone, matches nobody (README
            // rule 2); the admin API checks the grantees it writes.
            if (s.empty() || s.size() > 200 || !controlFree(s))
                return fail(at + ": grantee is not valid text");
            if (!seen.insert(s).second) return fail(at + ": grantee " + s + " is there twice");
            rule.grantees.push_back(s);
        }
        out.file.rules.push_back(std::move(rule));
    }
    out.ok = true;
    return out;
}

std::string accessFileJson(const AccessFile& f) {
    nlohmann::ordered_json groups = nlohmann::ordered_json::array();
    for (const auto& g : f.groups) groups.push_back({{"id", g.id}, {"name", g.name}});
    nlohmann::ordered_json rules = nlohmann::ordered_json::array();
    for (const auto& r : f.rules)
        rules.push_back({{"resource", r.resource},
                         {"level", accessLevelName(r.level)},
                         {"grantees", r.grantees}});
    nlohmann::ordered_json doc;
    doc["schemaVersion"] = f.schemaVersion;
    doc["rev"] = f.rev;
    doc["groups"] = std::move(groups);
    doc["rules"] = std::move(rules);
    return doc.dump(2) + "\n";
}

// --- the person

bool granteeMatches(const Principal& p, std::string_view g) {
    if (g == "*") return p.user.has_value();
    if (startsWith(g, "user:")) return p.user && *p.user == g.substr(5);
    if (startsWith(g, "group:")) {
        const std::string_view id = g.substr(6);
        return !id.empty() && std::find(p.groups.begin(), p.groups.end(), id) != p.groups.end();
    }
    if (startsWith(g, "role:")) {
        const auto r = parseRole(g.substr(5));
        return r && rank(p.role) >= rank(*r);
    }
    return false;
}

bool ResourceLevel::operator<(const ResourceLevel& o) const {
    if (resource != o.resource) return resource < o.resource;
    return static_cast<int>(level) < static_cast<int>(o.level);
}

// --- answers

bool EffectiveAccess::canViewScreen(std::string_view s) const {
    return admin || screenSet.count(std::string(s)) > 0;
}

bool EffectiveAccess::canViewItem(std::string_view s, std::string_view i) const {
    return admin || viewItemSet.count(itemKey(s, i)) > 0;
}

bool EffectiveAccess::canOperate(std::string_view s, std::string_view i) const {
    return admin || operateItemSet.count(itemKey(s, i)) > 0;
}

bool EffectiveAccess::canViewPage(std::string_view p) const {
    return admin || pageSet.count(std::string(p)) > 0;
}

bool EffectiveAccess::liveTag(std::string_view t) const {
    return admin || liveSet.count(std::string(t)) > 0;
}

bool EffectiveAccess::historyTag(std::string_view t) const {
    return admin || historySet.count(std::string(t)) > 0;
}

bool EffectiveAccess::alarmAllowed(std::string_view id) const {
    if (admin) return true;
    const size_t dot = id.find('.');
    return alarmSet.count(std::string(dot == std::string_view::npos ? id : id.substr(0, dot))) > 0;
}

bool EffectiveAccess::canViewReport(std::string_view id) const {
    return admin || reportSet.count(std::string(id)) > 0;
}

bool EffectiveAccess::canViewHistoryGroup(std::string_view id) const {
    return admin || historyGroupSet.count(std::string(id)) > 0;
}

std::vector<ResourceLevel> orphanRules(const ResourceCatalog& catalog, const AccessFile& store) {
    std::vector<ResourceLevel> out;
    for (const auto& r : store.rules)
        if (!catalog.hasResource(r.resource, r.level)) out.push_back({r.resource, r.level});
    std::sort(out.begin(), out.end());
    return out;
}

EffectiveAccess computeAccess(const ResourceCatalog& catalog, const AccessFile& store,
                              const Principal& p, bool storeValid) {
    EffectiveAccess a;
    a.user = p.user;
    a.role = p.role;
    a.groups = p.groups;
    a.anonymous = !p.user.has_value();
    a.storeRev = store.rev;
    a.storeValid = storeValid;
    a.admin = p.role == Role::Administrator;
    a.orphans = orphanRules(catalog, store);

    // allowed(P, res, level) of §4, for a resource the catalog has (`def` its project default).
    const auto allowed = [&](const std::string& res, AccessLevel level, Role def) {
        if (a.admin) return true;
        if (!storeValid) return false;
        if (rank(p.role) < rank(floorOf(level))) return false;
        if (rank(p.role) < rank(def)) return false;
        const AccessRule* r = store.rule(res, level);
        if (!r) return true;
        return std::any_of(r->grantees.begin(), r->grantees.end(),
                           [&](const std::string& g) { return granteeMatches(p, g); });
    };

    std::vector<std::string> live;
    for (const CatalogScreen& s : catalog.screens) {
        if (!allowed(std::string(kScreen) + s.id, AccessLevel::View, s.view)) continue;
        a.screens.push_back(s.id);
        a.screenSet.insert(s.id);
        for (const CatalogItem& i : s.items) {
            const std::string res = std::string(kItem) + itemKey(s.id, i.id);
            if (!allowed(res, AccessLevel::View, i.view)) {
                if (!a.admin) a.hiddenItems[s.id].push_back(i.id);
                continue;
            }
            a.viewItemSet.insert(itemKey(s.id, i.id));
            live.insert(live.end(), i.tags.begin(), i.tags.end());
            if (!i.operable) continue;
            if (allowed(res, AccessLevel::Operate, i.operate))
                a.operateItemSet.insert(itemKey(s.id, i.id));
            else if (!a.admin)
                a.lockedItems[s.id].push_back(i.id);
        }
    }
    for (auto& kv : a.hiddenItems) std::sort(kv.second.begin(), kv.second.end());
    for (auto& kv : a.lockedItems) std::sort(kv.second.begin(), kv.second.end());

    for (const std::string& page : systemPages()) {
        const Role def = page == "watch" ? Role::Operator : Role::Viewer;
        if (!allowed(std::string(kPage) + page, AccessLevel::View, def)) continue;
        a.pages.push_back(page);
        a.pageSet.insert(page);
    }
    // The watch tables are the page's own (not a resource of the shared model).
    if (a.pageSet.count("watch"))
        live.insert(live.end(), catalog.watchTags.begin(), catalog.watchTags.end());

    std::vector<std::string> history = live;
    if (a.admin) {
        // every Tag the catalog knows
        for (const CatalogScreen& s : catalog.screens)
            for (const CatalogItem& i : s.items)
                history.insert(history.end(), i.tags.begin(), i.tags.end());
        history.insert(history.end(), catalog.watchTags.begin(), catalog.watchTags.end());
        live = history;
        for (const auto& g : catalog.historyGroups) {
            history.insert(history.end(), g.tags.begin(), g.tags.end());
            a.historyGroupSet.insert(g.id);
        }
        for (const auto& r : catalog.reports) {
            history.insert(history.end(), r.tags.begin(), r.tags.end());
            a.reportSet.insert(r.id);
        }
    } else {
        if (a.pageSet.count("history"))
            for (const auto& g : catalog.historyGroups)
                if (allowed(std::string(kHistory) + g.id, AccessLevel::View, Role::Viewer)) {
                    history.insert(history.end(), g.tags.begin(), g.tags.end());
                    a.historyGroupSet.insert(g.id);
                }
        if (a.pageSet.count("reports"))
            for (const auto& r : catalog.reports)
                if (allowed(std::string(kReport) + r.id, AccessLevel::View, Role::Viewer)) {
                    history.insert(history.end(), r.tags.begin(), r.tags.end());
                    a.reportSet.insert(r.id);
                }
    }
    sortUnique(live);
    sortUnique(history);
    a.liveTags = std::move(live);
    a.historyTags = std::move(history);
    a.liveSet.insert(a.liveTags.begin(), a.liveTags.end());
    a.historySet.insert(a.historyTags.begin(), a.historyTags.end());

    // D21: the alarms of the live Tags; one without a Tag goes with the page of the alarms, and so
    // does (feature 040) one whose Tag no screen, logging group or report has: no rule restricts it.
    std::set<std::string> shown;
    for (const CatalogScreen& s : catalog.screens)
        for (const CatalogItem& i : s.items) shown.insert(i.tags.begin(), i.tags.end());
    for (const auto& g : catalog.historyGroups) shown.insert(g.tags.begin(), g.tags.end());
    for (const auto& r : catalog.reports) shown.insert(r.tags.begin(), r.tags.end());
    for (const CatalogAlarm& al : catalog.alarms) {
        const bool byPage = al.tag.empty() || shown.count(al.tag) == 0;
        const bool ok = a.admin || (byPage ? a.pageSet.count("alarms") > 0
                                           : a.liveSet.count(al.tag) > 0);
        if (ok) a.alarms.push_back(al.id);
    }
    sortUnique(a.alarms);
    a.alarmSet.insert(a.alarms.begin(), a.alarms.end());
    return a;
}

namespace {

json itemsMap(const std::map<std::string, std::vector<std::string>>& m) {
    json out = json::object();
    for (const auto& kv : m)
        if (!kv.second.empty()) out[kv.first] = kv.second;
    return out;
}

}  // namespace

json effectiveAccessJson(const EffectiveAccess& a) {
    return {{"user", a.user ? json(*a.user) : json(nullptr)},
            {"role", roleName(a.role)},
            {"groups", a.groups},
            {"anonymous", a.anonymous},
            {"storeRev", a.storeRev},
            {"usersRev", a.usersRev},
            {"projectHash", a.projectHash},
            {"screens", a.screens},
            {"hiddenItems", itemsMap(a.hiddenItems)},
            {"lockedItems", itemsMap(a.lockedItems)},
            {"pages", a.pages},
            {"admin", a.admin}};
}

json effectiveAccessVectorJson(const EffectiveAccess& a) {
    json orphans = json::array();
    for (const auto& o : a.orphans)
        orphans.push_back({{"resource", o.resource}, {"level", accessLevelName(o.level)}});
    return {{"screens", a.screens},
            {"hiddenItems", itemsMap(a.hiddenItems)},
            {"lockedItems", itemsMap(a.lockedItems)},
            {"pages", a.pages},
            {"admin", a.admin},
            {"liveTags", a.liveTags},
            {"historyTags", a.historyTags},
            {"alarms", a.alarms},
            {"orphans", orphans}};
}

// --- catalog JSON (§7)

json catalogJson(const ResourceCatalog& c) {
    json screens = json::array();
    for (const auto& s : c.screens) {
        json items = json::array();
        for (const auto& i : s.items)
            items.push_back({{"id", i.id},
                             {"operable", i.operable},
                             {"view", roleName(i.view)},
                             {"operate", roleName(i.operate)},
                             {"tags", i.tags}});
        screens.push_back(
            {{"id", s.id}, {"popup", s.popup}, {"view", roleName(s.view)}, {"items", items}});
    }
    const auto sets = [](const std::vector<CatalogTagSet>& v) {
        json out = json::array();
        for (const auto& s : v) out.push_back({{"id", s.id}, {"tags", s.tags}});
        return out;
    };
    json alarms = json::array();
    for (const auto& a : c.alarms)
        alarms.push_back({{"id", a.id}, {"tag", a.tag.empty() ? json(nullptr) : json(a.tag)}});
    return {{"screens", screens},
            {"historyGroups", sets(c.historyGroups)},
            {"reports", sets(c.reports)},
            {"alarms", alarms}};
}

std::optional<ResourceCatalog> catalogFromJson(const json& j, std::string& error) {
    ResourceCatalog c;
    const auto str = [](const json& o, const char* k) {
        return o.is_object() && o.contains(k) && o[k].is_string();
    };
    const auto strings = [](const json& o, const char* k, std::vector<std::string>& out) {
        if (!o.contains(k)) return true;
        if (!o[k].is_array()) return false;
        for (const auto& t : o[k]) {
            if (!t.is_string()) return false;
            out.push_back(t.get<std::string>());
        }
        return true;
    };
    const auto role = [](const json& o, const char* k, Role def, Role& out) {
        if (!o.contains(k)) {
            out = def;
            return true;
        }
        if (!o[k].is_string()) return false;
        const auto r = parseRole(o[k].get<std::string>());
        if (!r) return false;
        out = *r;
        return true;
    };
    if (!j.is_object()) {
        error = "the catalog is not an object";
        return std::nullopt;
    }
    if (j.contains("screens")) {
        if (!j["screens"].is_array()) {
            error = "screens is not an array";
            return std::nullopt;
        }
        for (const auto& s : j["screens"]) {
            CatalogScreen cs;
            if (!str(s, "id")) {
                error = "a screen without id";
                return std::nullopt;
            }
            cs.id = s["id"].get<std::string>();
            cs.popup = s.value("popup", false);
            if (!role(s, "view", Role::Viewer, cs.view)) {
                error = "screen " + cs.id + ": view is not a role";
                return std::nullopt;
            }
            if (s.contains("items")) {
                if (!s["items"].is_array()) {
                    error = "screen " + cs.id + ": items is not an array";
                    return std::nullopt;
                }
                for (const auto& i : s["items"]) {
                    CatalogItem ci;
                    if (!str(i, "id")) {
                        error = "screen " + cs.id + ": an item without id";
                        return std::nullopt;
                    }
                    ci.id = i["id"].get<std::string>();
                    ci.operable = i.value("operable", false);
                    if (!role(i, "view", Role::Viewer, ci.view) ||
                        !role(i, "operate", Role::Operator, ci.operate) ||
                        !strings(i, "tags", ci.tags)) {
                        error = "item " + cs.id + "/" + ci.id + " is not valid";
                        return std::nullopt;
                    }
                    cs.items.push_back(std::move(ci));
                }
            }
            c.screens.push_back(std::move(cs));
        }
    }
    for (const char* key : {"historyGroups", "reports"}) {
        if (!j.contains(key)) continue;
        if (!j[key].is_array()) {
            error = std::string(key) + " is not an array";
            return std::nullopt;
        }
        for (const auto& s : j[key]) {
            CatalogTagSet t;
            if (!str(s, "id") || !strings(s, "tags", t.tags)) {
                error = std::string(key) + ": an entry is not valid";
                return std::nullopt;
            }
            t.id = s["id"].get<std::string>();
            (std::string(key) == "reports" ? c.reports : c.historyGroups).push_back(std::move(t));
        }
    }
    if (j.contains("alarms")) {
        if (!j["alarms"].is_array()) {
            error = "alarms is not an array";
            return std::nullopt;
        }
        for (const auto& a : j["alarms"]) {
            if (!str(a, "id")) {
                error = "an alarm without id";
                return std::nullopt;
            }
            CatalogAlarm ca;
            ca.id = a["id"].get<std::string>();
            if (a.contains("tag") && a["tag"].is_string()) ca.tag = a["tag"].get<std::string>();
            c.alarms.push_back(std::move(ca));
        }
    }
    return c;
}

}  // namespace mat
