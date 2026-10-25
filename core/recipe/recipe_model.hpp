// The recipes of the running project (feature 024, specs/024-recipes/plan.md): the types of
// recipes.json joined with the Tags of tags.json (type and limits of each parameter), and the check
// of a set of values before it is saved or written (the same rules as E_RECIPE_VALUE and
// E_RECIPE_LIMIT of the validators, value by value). Pure: no I/O, no clock, no lock.
#pragma once
#include <optional>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"

namespace mat::recipe {

// "viewer" 0, "operator" 1, "engineer" 2, "administrator" 3; -1 for anything else.
int roleRank(const std::string& role);

struct ParamDef {
    std::string tag;
    std::string label, unit, description;
    std::string type;                      // the Tag type: BOOL, INT16 ... FLOAT64, STRING
    std::optional<double> min, max;        // of the parameter
    std::optional<double> tagMin, tagMax;  // `limits` of the Tag
    int decimals = -1;                     // -1: not given
};

struct TypeDef {
    std::string id, name, description;
    std::string view = "viewer", operate = "operator", edit = "operator";
    std::vector<ParamDef> params;
    nlohmann::json projectRecipes = nlohmann::json::array();  // the `recipes` of the file

    const ParamDef* param(const std::string& tag) const;
    nlohmann::json paramsJson() const;
};

struct Catalog {
    std::vector<TypeDef> types;
    const TypeDef* find(const std::string& id) const;
};

// `recipes`: recipes.json of a valid project (null: no recipes); `tags`: tags.json.
Catalog catalogFrom(const nlohmann::json& recipes, const nlohmann::json& tags);

struct ValueIssue {
    std::string tag;   // "" for the object itself
    std::string code;  // E_RECIPE_VALUE, E_RECIPE_LIMIT
    std::string message;
};

// The values of one recipe for `type`: an object with exactly one value per parameter, of the type
// of its Tag, within the limits of the parameter and of the Tag. Empty: they may be saved and
// written.
std::vector<ValueIssue> checkValues(const TypeDef& type, const nlohmann::json& values);

nlohmann::json issuesJson(const std::vector<ValueIssue>& issues);

}  // namespace mat::recipe
