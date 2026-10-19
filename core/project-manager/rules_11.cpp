// Rules of format 1.1.0 (feature 012 T012): see rules_11.hpp. The order, codes and paths follow
// packages/project-schema/src/rules-11.ts line by line (README-012.md "Luật bộ C++ phải cài giống
// hệt").
#include "core/project-manager/rules_11.hpp"

#include <cmath>
#include <limits>
#include <set>
#include <string>

namespace mat {

using nlohmann::json;

namespace {

const char* const kPosFields[] = {"x", "y", "width", "height"};

// ^1\.1\.\d+$ (SUPPORTED_SCHEMA_11 of codes.ts)
bool is11(const std::string& v) {
    if (v.size() <= 4 || v.compare(0, 4, "1.1.") != 0) return false;
    for (size_t i = 4; i < v.size(); ++i)
        if (v[i] < '0' || v[i] > '9') return false;
    return true;
}

// ^[a-z][a-z0-9_-]{0,31}$ (LAYOUT_ID_RE of rules-11.ts)
bool isLayoutId(const json& id) {
    if (!id.is_string()) return false;
    const std::string& s = id.get_ref<const std::string&>();
    if (s.empty() || s.size() > 32 || s[0] < 'a' || s[0] > 'z') return false;
    for (const char ch : s)
        if (!((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-'))
            return false;
    return true;
}

// A number of the document, NaN when absent or not a number (comparisons are then false, as with
// `undefined` in TS).
double num(const json& o, const char* k) {
    if (o.is_object() && o.contains(k) && o[k].is_number()) return o[k].get<double>();
    return std::numeric_limits<double>::quiet_NaN();
}

bool isInteger(double v) { return std::isfinite(v) && std::floor(v) == v; }

std::string idOf(const json& o) {
    return o.is_object() && o.contains("id") && o["id"].is_string() ? o["id"].get<std::string>()
                                                                    : std::string();
}

const json& arrayOf(const json& o, const char* k) {
    static const json kEmpty = json::array();
    return o.is_object() && o.contains(k) && o[k].is_array() ? o[k] : kEmpty;
}

}  // namespace

void runRules11(const json& project, const std::vector<Rules03Input::ScreenDoc>& screens,
                std::vector<ProjectIssue>& errors, std::vector<ProjectIssue>& warnings) {
    const auto err = [&](const char* code, const std::string& file, const std::string& path,
                         const std::string& message) {
        errors.push_back({code, file, path, message});
    };
    const auto warn = [&](const char* code, const std::string& file, const std::string& path,
                          const std::string& message) {
        warnings.push_back({code, file, path, message});
    };

    const bool v11 = project.contains("schemaVersion") && project["schemaVersion"].is_string() &&
                     is11(project["schemaVersion"].get<std::string>());
    if (!v11 && project.contains("theme"))
        err("E_LAYOUT_VERSION", "project.json", "/theme", "theme needs project format 1.1");
    if (v11 && project.contains("minRuntimeVersion") && project["minRuntimeVersion"].is_string() &&
        compareSemver(project["minRuntimeVersion"].get<std::string>(), kMinRuntime11) < 0)
        err("E_LAYOUT_VERSION", "project.json", "/minRuntimeVersion",
            std::string("a 1.1 project needs minRuntimeVersion >= ") + kMinRuntime11);

    for (const auto& sd : screens) {
        const std::string& file = sd.file;
        const json& screen = sd.screen;
        if (!screen.is_object() || !screen.contains("items") || !screen["items"].is_array())
            continue;
        const json& items = screen["items"];

        if (!screen.contains("layout")) {
            // a free-layout screen: position and size of every item
            for (size_t i = 0; i < items.size(); ++i)
                for (const char* k : kPosFields)
                    if (!items[i].is_object() || !items[i].contains(k)) {
                        err("E_LAYOUT_ITEM_POS", file, "/items/" + std::to_string(i) + "/" + k,
                            std::string("free-layout item needs ") + k);
                        break;
                    }
            continue;
        }
        if (!v11) {
            err("E_LAYOUT_VERSION", file, "/layout", "a grid layout needs project format 1.1");
            continue;
        }

        const json& layout = screen["layout"];
        if (!(layout.is_object() && layout.contains("mode") && layout["mode"] == "grid"))
            err("E_LAYOUT_COLUMNS", file, "/layout/mode", "layout mode must be 'grid'");
        if (!(num(layout, "columns") == kGridColumns))
            err("E_LAYOUT_COLUMNS", file, "/layout/columns", "a grid has 12 columns");
        const json& rows = arrayOf(layout, "rows");
        if (rows.size() > kGridMaxRows)
            err("E_LAYOUT_LIMIT", file, "/layout/rows", "more than 100 rows");

        std::set<std::string> itemIds;
        for (const auto& it : items) itemIds.insert(idOf(it));
        std::set<std::string> layoutIds;
        std::set<std::string> placed;
        const auto checkId = [&](const json& o, const std::string& path) {
            const json& id = o.is_object() && o.contains("id") ? o["id"] : json();
            const std::string s = id.is_string() ? id.get<std::string>() : std::string();
            if (!isLayoutId(id) || layoutIds.count(s))
                err("E_LAYOUT_ID", file, path,
                    "row or cell id '" + s + "' is invalid or duplicated");
            layoutIds.insert(s);
        };

        for (size_t r = 0; r < rows.size(); ++r) {
            const json& row = rows[r];
            const std::string rp = "/layout/rows/" + std::to_string(r);
            checkId(row, rp + "/id");
            const json& cells = arrayOf(row, "cells");
            if (cells.empty() || cells.size() > kGridMaxCellsPerRow)
                err("E_LAYOUT_LIMIT", file, rp + "/cells", "a row has 1 to 12 cells");
            double sum = 0;
            bool overflowReported = false;
            for (size_t c = 0; c < cells.size(); ++c) {
                const json& cell = cells[c];
                const std::string cp = rp + "/cells/" + std::to_string(c);
                checkId(cell, cp + "/id");
                const bool hasOffset =
                    cell.is_object() && cell.contains("offset") && !cell["offset"].is_null();
                const double offset = hasOffset ? num(cell, "offset") : 0;
                const double span = num(cell, "span");
                const bool badRange = !isInteger(span) || span < 1 || span > kGridColumns ||
                                      !isInteger(offset) || offset < 0 || offset > kGridColumns - 1;
                sum += offset + span;
                if (badRange) {
                    err("E_LAYOUT_SPAN", file, cp + "/span", "span 1-12 and offset 0-11");
                } else if (sum > kGridColumns && !overflowReported) {
                    overflowReported = true;
                    err("E_LAYOUT_SPAN", file, cp + "/span", "the row is wider than 12 columns");
                }
                if (!cell.is_object() || !cell.contains("item") || !cell["item"].is_string())
                    continue;
                const std::string item = cell["item"].get<std::string>();
                if (!itemIds.count(item))
                    err("E_LAYOUT_ITEM_REF", file, cp + "/item",
                        "no item '" + item + "' on this screen");
                else if (placed.count(item))
                    err("E_LAYOUT_ITEM_DUP", file, cp + "/item",
                        "item '" + item + "' is in more than one cell");
                else
                    placed.insert(item);
            }
        }

        for (size_t i = 0; i < items.size(); ++i) {
            const json& it = items[i];
            const std::string p = "/items/" + std::to_string(i);
            for (const char* k : kPosFields)
                if (it.is_object() && it.contains(k)) {
                    err("E_LAYOUT_ITEM_POS", file, p + "/" + k, "a grid item has no position");
                    break;
                }
            if (!placed.count(idOf(it)))
                warn("W_LAYOUT_ITEM_ORPHAN", file, p, "item '" + idOf(it) + "' is in no cell");
        }
    }
}

}  // namespace mat
