// Rules of format 1.1.0 (feature 012 T012;
// specs/012-screen-grid-layout/contracts/project-format-1.1.md §3), the C++ twin of
// packages/project-schema/src/rules-11.ts: the grid layout of a screen (`layout`) and the theme of
// the project (`theme`). Run for the whole 1.x family (1.0 and 1.1 share the schemas at the root of
// schemas/, where `x`, `y`, `width`, `height` of an item are optional: these rules require them on
// a free-layout screen). The same codes and paths on tests/project-vectors (cases v11-*,
// README-012.md).
#pragma once
#include <vector>

#include "core/project-manager/project_validator.hpp"
#include "core/project-manager/rules_03.hpp"
#include "nlohmann/json.hpp"

namespace mat {

constexpr const char* kMinRuntime11 = "1.1.0";  // E_LAYOUT_VERSION of a 1.1 project
constexpr int kGridColumns = 12;
constexpr size_t kGridMaxRows = 100;
constexpr size_t kGridMaxCellsPerRow = 12;

// `project`: project.json (passed its schema); `screens`: the screens and popups that passed
// theirs.
void runRules11(const nlohmann::json& project, const std::vector<Rules03Input::ScreenDoc>& screens,
                std::vector<ProjectIssue>& errors, std::vector<ProjectIssue>& warnings);

}  // namespace mat
