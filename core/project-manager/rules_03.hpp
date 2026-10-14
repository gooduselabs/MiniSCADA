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
    // Format 0.6 (feature 010): "0.3" (default) or "0.6"; reports.json when it loaded (null:
    // absent or failed, the rules that need it are skipped).
    std::string schema = "0.3";
    const nlohmann::json* reports = nullptr;
};

void runRules03(const Rules03Input& in, std::vector<ProjectIssue>& errors,
                std::vector<ProjectIssue>& warnings);

}  // namespace mat
