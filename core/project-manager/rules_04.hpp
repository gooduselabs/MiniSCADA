// Binding and event rules of the 0.4 validator (specs/008-svg-import-binding
// contracts/project-format-0.4.md §5-§6, binding-animation.md §2, svg-events.md §2), the C++ twin
// of packages/project-schema/src/rules-04.ts: the same rules, codes and paths on
// tests/project-vectors (cases v04-*). The rest of a 0.4 project is checked by rules_02.cpp
// (Tags, connections, tables) and rules_03.cpp (screens, items, widgets), which call this for the
// binding file of every svg item. SVG files are not parsed (Constitution II): the codes that need
// SVG content (E_SVG_*, W_SVG_HEAVY, W_UID_NOT_IN_SVG, W_BIND_ELEMENT_KIND, W_BIND_CLIP_EXISTS)
// exist only in TypeScript.
#pragma once
#include <functional>
#include <map>
#include <set>
#include <string>
#include <vector>

#include "core/project-manager/rules_02.hpp"
#include "nlohmann/json.hpp"

namespace mat {

// Limits of 0.4 (contract §3, §6).
constexpr size_t kLimit04SvgItems = 64;
constexpr size_t kLimit04Animations = 256;  // infinite animations of one screen
constexpr size_t kLimit04AnimWarn = 64;
constexpr size_t kLimit04Ranges = 64;

struct Binding04Ctx {
    bool hasTags = false;
    const std::map<std::string, std::string>* tagType = nullptr;   // id -> type
    const std::map<std::string, std::string>* tagTable = nullptr;  // id -> valueTable of the Tag
    const std::set<std::string>* tableSet = nullptr;               // names in project.valueTables
    // The Tag document of an id (null: none).
    std::function<const nlohmann::json*(const std::string&)> tagOf;
    const std::vector<std::string>* screens = nullptr;  // ids of the screens of the project
    // "screen" or "popup" of a screen id, "" when the screen is not known.
    std::function<std::string(const std::string&)> kindOf;
    // Format 1.0 (feature 011): the popup action has `args` too (E_POPUP_ARGS of rules_10).
    bool format10 = false;
};

// The rules of one binding file of an svg item: uids, ids, target groups, transforms, parameters,
// rangeMap, Tag types, events. Errors and warnings go to `add` and `warn` with the file `bfile`.
void bindingRules04(const nlohmann::json& bindings, const std::string& bfile,
                    const std::set<std::string>& uids, const Binding04Ctx& ctx,
                    const BindingAdd& add, const BindingAdd& warn);

// Infinite animations of a binding file: spin, effect.blink, effect.flow.
size_t countAnimations04(const nlohmann::json& bindings);

}  // namespace mat
