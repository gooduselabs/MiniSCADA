// The catalog of resources of the running project (feature 013, contracts/access-model.md §2, §3,
// §7): built once when the project is loaded (a deploy starts the process again), from the loaded
// documents. The TypeScript twin is catalogFromProject of packages/access-model.
//
// - screen:<id>: every screen and popup of project.json, view default screen.security.view.
// - item:<screen>/<item>: every item; operable when its widget is of the group "control" of the
//   widget catalog or, for an SVG item, when one of its elements has a click event with a Tag (a
//   write); view default item.security.view, operate item.security.operate, then the older
//   item.security.minRole, then operator. Its Tags are those of its bindings: the `tags` of a
//   widget (the {prefix} of a popup resolved with the args of every button that opens it, or with
//   the defaults), the bindings and the click Tag of an SVG item. A project before format 0.3 has
//   one item per screen, "svg", with the Tags of the screen's binding file.
// - history:<group id> (logging.json), report:<id> (reports.json): their Tags.
// - The alarms of alarms.json with their Tag.
#pragma once
#include "core/auth/access_model.hpp"

namespace mat {

struct LoadedProject;
class WidgetCatalog;

// `widgets` null: no widget is operable (only SVG items with a write event).
ResourceCatalog catalogFromProject(const LoadedProject& project, const WidgetCatalog* widgets);

// The item of a screen that a write names (contracts/admin-api.md §6): the item whose id is
// `widget`, or the SVG item that has an element of that uid. nullptr when neither.
const CatalogItem* itemOfWrite(const ResourceCatalog& catalog, const std::string& screen,
                               const std::string& widget);

}  // namespace mat
