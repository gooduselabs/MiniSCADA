// Rules of recipes.json (feature 024; order and paths: specs/024-recipes/plan.md, "Hợp đồng"), the
// C++ twin of packages/project-schema/src/rules-recipes.ts. The same codes and paths on
// tests/project-vectors (cases v11-recipe-*, README-024.md).
#pragma once
#include <string>
#include <vector>

#include "core/project-manager/project_validator.hpp"
#include "nlohmann/json.hpp"

namespace mat {

constexpr size_t kReportLogoMaxBytes = 262144;  // E_RPT_LOGO

// A recipe value fits the type of its Tag (recipeValueFits of recipes.ts): BOOL a boolean, STRING a
// string, an integer type an integer of its range (a float with an integral value counts, as in
// JavaScript), FLOAT32/FLOAT64 a finite number. Shared with the recipe service of the runtime.
bool recipeValueFits(const std::string& tagType, const nlohmann::json& v);

// The Tag can be written by a person (writable() of rules-03.ts): access RW, not calculated, a
// simulation Tag only of the "manual" kind.
bool recipeTagWritable(const nlohmann::json& tag);

// `project`: project.json; `recipes`: recipes.json that passed its schema (null when absent or
// failed, or not read because the project is not 1.1); `tags`: tags.json (null when it failed).
void recipeRules(const nlohmann::json& project, const nlohmann::json* recipes,
                 const nlohmann::json* tags, std::vector<ProjectIssue>& errors);

}  // namespace mat
