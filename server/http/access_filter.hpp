// What the page's routes give one person (feature 013, contracts/admin-api.md §6): pure functions
// of the documents and of the person's access, used by HttpApi (projects/active, the screen files,
// the report templates) and by the tag write of the page.
#pragma once
#include <string>
#include <vector>

#include "core/auth/access_model.hpp"
#include "core/auth/access_service.hpp"
#include "nlohmann/json.hpp"

namespace mat {

// projects/active: the screens and menu entries viewed (a menu group left empty goes; the entry
// screen becomes the first one viewed), the Tags of history(P) (names and units for the pages).
nlohmann::json filteredActive(const nlohmann::json& doc, const SessionAccess& a);
// A screen file without the hidden items and without the `item` of the grid cells that held them.
nlohmann::json filteredScreen(const nlohmann::json& screen, const std::vector<std::string>& hidden);
// reports.json with the templates viewed.
nlohmann::json filteredReports(const nlohmann::json& doc, const SessionAccess& a);
// POST /api/v1/tags/write from the page: "" when allowed, else why not (Vietnamese). The item
// named by context.screen and context.widget (an item id or an element of an SVG item) must be
// operated by this person and hold the Tag in its bindings.
std::string pageWriteRefusal(const ResourceCatalog& catalog, const SessionAccess& a,
                             const std::string& screen, const std::string& widget,
                             const std::string& tag);

}  // namespace mat
