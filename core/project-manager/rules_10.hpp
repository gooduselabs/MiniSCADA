// Rules of format 1.0.0 (feature 011 T020;
// specs/011-pilot-hardening/contracts/project-format-1.0.md §3-§5), the C++ twin of
// packages/project-schema/src/{params,rules-10}.ts: templates, instances of a template (`tpl` of an
// item), faceplates (popups with `params`, popup actions with `args`, every call expanded
// statically). The same codes and paths on tests/project-vectors (cases v10-*, README-011.md). The
// rest of a 1.0 project is checked by rules_02/03/04 (schema "1.0") and alarm_rules.
#pragma once
#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "core/project-manager/project_validator.hpp"
#include "core/project-manager/rules_03.hpp"
#include "core/project-manager/widget_catalog.hpp"
#include "nlohmann/json.hpp"

namespace mat {

// At most this many different sets of args per popup (E_POPUP_ARGS).
constexpr size_t kMaxPopupCombinations = 1000;

// "" when `value` is valid for a parameter of `kind` (tagPrefix, string, number, color), otherwise
// a description (Vietnamese).
std::string paramValueError(const std::string& kind, const nlohmann::json& value);

struct ParamPart {
    bool param = false;  // true: `text` is the name of a {name}
    std::string text;
};
// The text and the {name} of `s`; nullopt when it has a stray `{` or `}`, nesting or a bad name.
std::optional<std::vector<ParamPart>> paramTokens(const std::string& s);

struct ParamProblem {
    std::string kind;  // "place" ({name} placement) or "args" (a value of a parameter)
    std::string path;  // JSON Pointer in the item (place) or /<name> (args)
    std::string message;
};

// Duplicated names and defaults that do not fit their kind; paths /<i>/name, /<i>/default.
std::vector<ParamProblem> checkParamDecls(const nlohmann::json& params);

struct ResolvedArgs {
    bool ok = false;
    std::map<std::string, std::string> values;  // every parameter (defaults filled in)
    std::vector<ParamProblem> problems;
};
// `args` null: absent (same as {}).
ResolvedArgs resolveArgs(const nlohmann::json& params, const nlohmann::json& args);

// Placement of every {name} of `item`; `inTemplate`: the args of a popup action may hold {name}.
std::vector<ParamProblem> checkParamPlaces(const nlohmann::json& item, const nlohmann::json& params,
                                           bool inTemplate, const WidgetCatalog& catalog);

struct Substituted {
    bool ok = false;
    nlohmann::json value;
    std::vector<ParamProblem> problems;
};
// The item with every {name} replaced by the value from `args` (defaults for the missing ones): a
// plain string substitution, one pass; a number property gets a number.
Substituted substituteParams(const nlohmann::json& item, const nlohmann::json& params,
                             const nlohmann::json& args, bool inTemplate,
                             const WidgetCatalog& catalog);

struct Rules10Input {
    struct Template {
        std::string file;                     // templates/<id>.template.json
        const nlohmann::json* doc = nullptr;  // null: could not be loaded (already reported)
    };
    const nlohmann::json* project = nullptr;
    std::vector<Template> templates;
    std::string logicFile;
    const nlohmann::json* logic = nullptr;   // null: absent or failed
    std::optional<size_t> logicBytes;        // size of logic.json (E_LOGIC_LIMIT above 512 KiB)
    const WidgetCatalog* catalog = nullptr;  // required
};

// Runs around runRules03: `before` checks templates, popups with params and the calls of popups,
// and sets `in.paramScreens` and `in.expansions` (owned by this object); `after` (once the rules of
// 0.3 to 0.6 and the alarm rules have run) checks the instances, renames the tag codes of the
// instances and of the expansions to E_TEMPLATE_TAG_REF and adds the issues of the expansions.
class Rules10 {
   public:
    Rules10(const Rules10Input& in, const std::vector<Rules03Input::ScreenDoc>& screens);
    void before(Rules03Input& in, std::vector<ProjectIssue>& errors);
    void after(std::vector<ProjectIssue>& errors, std::vector<ProjectIssue>& warnings);

   private:
    const Rules10Input& in_;
    const std::vector<Rules03Input::ScreenDoc>& screens_;
    // id (file name) -> template; null: declared but not loaded
    std::map<std::string, const nlohmann::json*> templates_;
    std::set<std::string> paramScreens_;
    std::vector<Rules03Expansion> expansions_;
    std::vector<std::map<std::string, std::string>> expansionValues_;
    // Feature 011 (T135): tags.json with the logic Tags appended (internal, read-only), what the
    // rules of 0.3 to 0.6 and the alarm rules see; the warnings of rules_logic for after().
    nlohmann::json tagsWithLogic_;
    std::vector<ProjectIssue> logicWarnings_;

   public:
    // The tags document the later rules must use (the logic Tags appended); null: unchanged.
    const nlohmann::json* tagsWithLogic() const {
        return tagsWithLogic_.is_null() ? nullptr : &tagsWithLogic_;
    }
};

}  // namespace mat
