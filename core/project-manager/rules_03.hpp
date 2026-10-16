// Cross-file rules of the 0.3 validator (specs/007-screens-widgets contracts/project-format-0.3.md
// §7, widget-catalog.md §3-§4), the C++ twin of packages/project-schema/src/rules-03.ts: the same
// rules, the same codes and paths on tests/project-vectors (cases v03-*) and
// tests/widget-catalog-vectors. The rules of Tags, connections, value tables, watch tables and
// logging are those of 0.2 (rules_02.cpp, run with schema "0.3"). Everything about a widget type
// comes from the catalog. A file that failed to load (parse or schema) is passed as absent and the
// rules that need it are skipped. SVG files are not parsed (Constitution II): W_UID_NOT_IN_SVG
// exists only in TypeScript.
#pragma once
#include <functional>
#include <map>
#include <set>
#include <string>
#include <vector>

#include "core/project-manager/project_validator.hpp"
#include "core/project-manager/rules_02.hpp"
#include "core/project-manager/widget_catalog.hpp"
#include "nlohmann/json.hpp"

namespace mat {

// The limits of FR-010 (data-model §16).
constexpr size_t kLimit03Screens = 32;
constexpr size_t kLimit03Items = 250;
constexpr size_t kLimit03SvgItems = 8;
constexpr size_t kLimit03Charts = 16;
constexpr size_t kLimit03NavLeaves = 32;
constexpr size_t kWarnScreenTags = 500;

// Format 1.0 (rules_10): a popup with params with one set of args substituted. Only the widget
// items `items` are checked, like ordinary items; their issues go to `errors` and `warnings` of
// this entry (rules_10 renames the tag codes and drops duplicates).
struct Rules03Expansion {
    std::string key;   // the id of the popup
    std::string file;  // its screen file
    nlohmann::json screen;
    std::vector<size_t> items;
    std::vector<ProjectIssue> errors;
    std::vector<ProjectIssue> warnings;
};

struct Rules03Input {
    struct SvgData {
        bool hasBindings = false;
        nlohmann::json bindings;
    };
    struct ScreenDoc {
        std::string id;    // the id in project.json (the key of the screen)
        std::string file;  // screens/<id>.screen.json
        nlohmann::json screen;
        std::map<size_t, SvgData> svg;  // by item index: the binding file of an svg item
    };
    const nlohmann::json* project = nullptr;
    const nlohmann::json* tags = nullptr;
    const nlohmann::json* connections = nullptr;
    const nlohmann::json* loggingDoc = nullptr;
    std::map<std::string, Rules02Input::Doc> valueTables;
    std::map<std::string, Rules02Input::Doc> watchTables;
    std::vector<ScreenDoc> screens;
    std::function<void(const std::map<std::string, std::string>*)> logging;
    std::string runtimeVersion;
    const SerialPolicy* serial = nullptr;
    const WidgetCatalog* catalog = nullptr;  // required
    // "0.3" (default), "0.4" (feature 008), "0.5" (feature 009), "0.6" (feature 010) or "1.0"
    // (feature 011): the format
    // being checked; 0.4 and later raise the limit of svg items, check the binding files with
    // rules_04.cpp (events, animations) and count the Tags of events (see schemaIs04Plus); the
    // schemaVersion and the lowest runtime differ.
    std::string schema = "0.3";
    // Format 1.0 (rules_10): ids of the popups with params. In them a Tag slot value or a property
    // value holding `{` or `}` is not checked like a Tag or a value (each substituted set of args
    // is checked through `expansions`).
    const std::set<std::string>* paramScreens = nullptr;
    std::vector<Rules03Expansion>* expansions = nullptr;
    // reports.json of a 0.6 project when it loaded (null: absent or failed, the rules that need it
    // are skipped).
    const nlohmann::json* reports = nullptr;
    // Feature 009 (project 0.5 and later): ids of the areas and classes of the project, for
    // W_WIDGET_ALARM_REF of the alarm widgets; null: not checked. The four default classes are
    // always in `alarmClasses`.
    const std::set<std::string>* alarmAreas = nullptr;
    const std::set<std::string>* alarmClasses = nullptr;
};

// The formats that carry the rules of feature 008 (SVG bindings, events, animations): 0.4 and every
// later one (0.5 adds the alarms on top).
inline bool schemaIs04Plus(const std::string& schema) {
    return schema == "0.4" || schema == "0.5" || schema == "0.6" || schema == "1.0";
}

void runRules03(const Rules03Input& in, std::vector<ProjectIssue>& errors,
                std::vector<ProjectIssue>& warnings);

}  // namespace mat
