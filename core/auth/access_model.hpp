// The access model of feature 013 (specs/013-access-control/contracts/access-model.md §2 to §7):
// the resources of the running project as an abstract catalog, the groups and rules of access.json,
// and computeAccess, which turns them into what one person may see and operate. Pure: no I/O, no
// clock, no lock. The TypeScript twin (packages/access-model) gives the same answers on the shared
// vectors of tests/access-vectors.
#pragma once
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_set>
#include <utility>
#include <vector>

#include "core/auth/roles.hpp"
#include "nlohmann/json.hpp"

namespace mat {

enum class AccessLevel { View, Operate };
const char* accessLevelName(AccessLevel l);  // "view", "operate"
std::optional<AccessLevel> parseAccessLevel(std::string_view s);

// --- The catalog (§7): what the project has, with the defaults of §3 already applied.

struct CatalogItem {
    std::string id;
    bool operable = false;  // a widget of the group "control", or an SVG item with a write event
    Role view = Role::Viewer;
    Role operate = Role::Operator;
    std::vector<std::string> tags;  // the Tags of its bindings (read and write)
    // Not part of the shared vectors: for the admin API and the write check.
    std::string title;
    std::string widget;                    // widget type, "svg" for an SVG item
    std::vector<std::string> elementUids;  // SVG items: their elements (the `widget` of a write)
};

struct CatalogScreen {
    std::string id;
    bool popup = false;
    Role view = Role::Viewer;
    std::vector<CatalogItem> items;
    std::string title;
};

struct CatalogTagSet {  // a logging group or a report template
    std::string id;
    std::vector<std::string> tags;
    std::string title;
};

struct CatalogAlarm {
    std::string id;
    std::string tag;  // "" for an alarm without a Tag (the quality of a device)
};

struct ResourceCatalog {
    std::vector<CatalogScreen> screens;
    std::vector<CatalogTagSet> historyGroups;
    std::vector<CatalogTagSet> reports;
    std::vector<CatalogAlarm> alarms;
    // Not in the shared vectors (§7): the Tags of the watch tables, live for whoever may view
    // page:watch (the page of the watch tables subscribes them).
    std::vector<std::string> watchTags;

    const CatalogScreen* screen(std::string_view id) const;
    const CatalogItem* item(std::string_view screen, std::string_view item) const;
    // The resource exists in the project with that level (§2): screen:, item:, page:, history:,
    // report:. page:admin has no rule and is never a resource here.
    bool hasResource(std::string_view resource, AccessLevel level) const;
    // The project default of a resource and level (§3); nullopt when there is no such resource.
    std::optional<Role> projectDefault(std::string_view resource, AccessLevel level) const;
};

// The four system pages that rules may name (page:<name>), in the order of the answers.
const std::vector<std::string>& systemPages();

// --- The store (access.json, §1.2).

struct AccessGroup {
    std::string id;
    std::string name;
};

struct AccessRule {
    std::string resource;
    AccessLevel level = AccessLevel::View;
    std::vector<std::string> grantees;
};

constexpr const char* kAccessSchemaVersion = "1.0.0";
constexpr size_t kMaxAccessGroups = 50;
constexpr size_t kMaxAccessRules = 5000;
constexpr size_t kMaxRuleGrantees = 64;
constexpr size_t kMaxAccountGroups = 16;
constexpr size_t kAccessFileMaxBytes = 2 * 1024 * 1024;

struct AccessFile {
    std::string schemaVersion = kAccessSchemaVersion;
    int64_t rev = 0;
    std::vector<AccessGroup> groups;
    std::vector<AccessRule> rules;

    const AccessGroup* group(std::string_view id) const;
    const AccessRule* rule(std::string_view resource, AccessLevel level) const;
};

bool validGroupId(std::string_view id);      // ^[a-z][a-z0-9-]{1,31}$
bool validGroupName(std::string_view name);  // 1 to 64 characters, valid UTF-8, no control
// "*", "user:<account name>", "group:<group id>", "role:<role>" (the syntax only).
bool validGrantee(std::string_view g);

// The text of access.json (§1.2); `error` says why it is refused (a damaged store: only the
// administrators may see anything, FR-036). Group ids unique, rules unique per (resource, level),
// grantees unique, "group:" grantees naming groups of the file.
struct AccessParse {
    bool ok = false;
    AccessFile file;
    std::string error;
};
AccessParse parseAccessFile(std::string_view text);
std::string accessFileJson(const AccessFile& f);

// --- The person (§4).

struct Principal {
    std::optional<std::string> user;  // nullopt: anonymous (viewerLogin off, no sign-in)
    Role role = Role::Viewer;
    std::vector<std::string> groups;
};

bool granteeMatches(const Principal& p, std::string_view grantee);

// --- The answer (§5) and the sets the server filters with.

struct ResourceLevel {
    std::string resource;
    AccessLevel level = AccessLevel::View;
    bool operator<(const ResourceLevel& o) const;
    bool operator==(const ResourceLevel& o) const {
        return resource == o.resource && level == o.level;
    }
};

struct EffectiveAccess {
    std::optional<std::string> user;
    Role role = Role::Viewer;
    std::vector<std::string> groups;
    bool anonymous = false;
    int64_t storeRev = 0;
    int64_t usersRev = 0;
    std::string projectHash;
    bool admin = false;
    bool storeValid = true;

    std::vector<std::string> screens;  // viewable screens and popups, in catalog order
    std::map<std::string, std::vector<std::string>> hiddenItems;  // on viewable screens only
    std::map<std::string, std::vector<std::string>> lockedItems;
    std::vector<std::string> pages;        // viewable system pages
    std::vector<std::string> liveTags;     // sorted
    std::vector<std::string> historyTags;  // sorted
    std::vector<std::string> alarms;       // alarm ids, sorted
    std::vector<ResourceLevel> orphans;    // rules on what the project does not have, sorted

    // Lookups (hash sets, SC-006).
    bool canViewScreen(std::string_view screen) const;
    bool canViewItem(std::string_view screen, std::string_view item) const;
    bool canOperate(std::string_view screen, std::string_view item) const;
    bool canViewPage(std::string_view page) const;
    bool liveTag(std::string_view tag) const;
    bool historyTag(std::string_view tag) const;
    // `id` an alarm id or an instance id ("TANK1_LEVEL.HH": the part before the dot).
    bool alarmAllowed(std::string_view id) const;
    // A report template or a logging group this person may read (its page included).
    bool canViewReport(std::string_view id) const;
    bool canViewHistoryGroup(std::string_view id) const;

    // Filled by computeAccess.
    std::unordered_set<std::string> screenSet, viewItemSet, operateItemSet, pageSet, liveSet,
        historySet, alarmSet, reportSet, historyGroupSet;
};

// §4. `storeValid` false: access.json is damaged, every rule refuses everybody but an
// administrator (FR-036). The revisions and the project hash are copied into the answer.
EffectiveAccess computeAccess(const ResourceCatalog& catalog, const AccessFile& store,
                              const Principal& p, bool storeValid = true);

// §5: the body of GET /api/v1/web/access (no Tag list).
nlohmann::json effectiveAccessJson(const EffectiveAccess& a);
// §7: the shape of expected.json of a vector (§5 plus the Tag sets, the alarms and the orphans).
nlohmann::json effectiveAccessVectorJson(const EffectiveAccess& a);

// The rules of `store` that name a resource the catalog does not have with that level, sorted.
std::vector<ResourceLevel> orphanRules(const ResourceCatalog& catalog, const AccessFile& store);

// The catalog as the JSON of §7 (catalog.json of a vector) and back; for the tests and the
// admin API. fromJson: nullopt and `error` for a shape that is not §7.
nlohmann::json catalogJson(const ResourceCatalog& c);
std::optional<ResourceCatalog> catalogFromJson(const nlohmann::json& j, std::string& error);

}  // namespace mat
