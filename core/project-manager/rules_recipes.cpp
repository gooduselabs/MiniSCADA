#include "core/project-manager/rules_recipes.hpp"

#include <cmath>
#include <map>
#include <optional>
#include <set>

#include "core/project-manager/rules_11.hpp"

namespace mat {

using nlohmann::json;

namespace {

struct IntRange {
    const char* type;
    double lo, hi;
};
// The ranges of INT_RANGES (recipes.ts), as doubles like JavaScript compares them.
constexpr IntRange kIntRanges[] = {
    {"INT16", -32768.0, 32767.0},
    {"UINT16", 0.0, 65535.0},
    {"INT32", -2147483648.0, 2147483647.0},
    {"UINT32", 0.0, 4294967295.0},
    {"INT64", -9223372036854775808.0, 9223372036854775807.0},
    {"UINT64", 0.0, 18446744073709551615.0},
};

std::string str(const json& o, const char* key) {
    const auto it = o.find(key);
    return it != o.end() && it->is_string() ? it->get<std::string>() : std::string();
}

std::optional<double> num(const json& o, const char* key) {
    const auto it = o.find(key);
    if (it == o.end() || !it->is_number()) return std::nullopt;
    return it->get<double>();
}

// JSON Pointer of one key (~ -> ~0, / -> ~1).
std::string pointerKey(const std::string& k) {
    std::string out;
    for (const char c : k) {
        if (c == '~')
            out += "~0";
        else if (c == '/')
            out += "~1";
        else
            out += c;
    }
    return out;
}

bool numericType(const std::string& t) { return t != "BOOL" && t != "STRING"; }

}  // namespace

bool recipeValueFits(const std::string& tagType, const json& v) {
    if (tagType == "BOOL") return v.is_boolean();
    if (tagType == "STRING") return v.is_string();
    if (!v.is_number()) return false;
    const double d = v.get<double>();
    if (!std::isfinite(d)) return false;
    for (const auto& r : kIntRanges)
        if (tagType == r.type) return std::floor(d) == d && d >= r.lo && d <= r.hi;
    return true;  // FLOAT32, FLOAT64
}

bool recipeTagWritable(const json& tag) {
    if (str(tag, "access") != "RW") return false;
    const std::string kind = str(tag, "kind");
    if (kind == "calculated") return false;
    if (kind == "simulation") {
        const auto sim = tag.find("sim");
        return sim != tag.end() && sim->is_object() && str(*sim, "kind") == "manual";
    }
    return true;
}

void recipeRules(const json& project, const json* recipes, const json* tags,
                 std::vector<ProjectIssue>& errors) {
    if (!project.contains("recipesFile") || !project["recipesFile"].is_string()) return;
    const std::string file = project["recipesFile"].get<std::string>();
    const std::string version = str(project, "schemaVersion");
    if (!isSchema11(version)) {
        errors.push_back(
            {"E_RECIPE_VERSION", "project.json", "/recipesFile", "recipesFile cần định dạng 1.1"});
        return;
    }
    if (!recipes) return;
    auto add = [&](const char* code, const std::string& path, const std::string& message) {
        errors.push_back({code, file, path, message});
    };
    if (str(*recipes, "schemaVersion") != version)
        add("E_SCHEMA_VERSION", "/schemaVersion",
            "schemaVersion " + str(*recipes, "schemaVersion") + " khác project " + version);

    std::map<std::string, const json*> byId;
    const bool haveTags = tags && tags->contains("tags") && (*tags)["tags"].is_array();
    if (haveTags)
        for (const auto& t : (*tags)["tags"]) byId[str(t, "id")] = &t;

    struct Param {
        const json* tag = nullptr;
        std::optional<double> min, max;
    };
    std::set<std::string> typeIds;
    const json& types = (*recipes)["types"];
    for (size_t i = 0; i < types.size(); ++i) {
        const json& ty = types[i];
        const std::string tp = "/types/" + std::to_string(i);
        const std::string id = str(ty, "id");
        if (!typeIds.insert(id).second)
            add("E_RECIPE_DUP_ID", tp + "/id", "loại '" + id + "' bị trùng");

        // parameters, in the order of the file
        std::vector<std::string> order;
        std::map<std::string, Param> params;
        const json& ps = ty["params"];
        for (size_t j = 0; j < ps.size(); ++j) {
            const json& p = ps[j];
            const std::string pp = tp + "/params/" + std::to_string(j);
            const std::string tagId = str(p, "tagId");
            if (params.count(tagId)) {
                add("E_RECIPE_DUP_ID", pp + "/tagId", "Tag '" + tagId + "' đã là tham số");
                continue;
            }
            Param prm;
            const auto t = byId.find(tagId);
            if (t != byId.end()) prm.tag = t->second;
            prm.min = num(p, "min");
            prm.max = num(p, "max");
            params[tagId] = prm;
            order.push_back(tagId);
            if (!haveTags) continue;
            if (!prm.tag) {
                add("E_RECIPE_TAG", pp + "/tagId", "không có Tag '" + tagId + "'");
                continue;
            }
            if (!recipeTagWritable(*prm.tag)) {
                add("E_RECIPE_TAG_RW", pp + "/tagId", "Tag '" + tagId + "' không ghi được");
                continue;
            }
            if (!numericType(str(*prm.tag, "type"))) {
                if (prm.min)
                    add("E_RECIPE_LIMIT", pp + "/min", "min chỉ dùng cho Tag số");
                else if (prm.max)
                    add("E_RECIPE_LIMIT", pp + "/max", "max chỉ dùng cho Tag số");
            } else if (prm.min && prm.max && *prm.min > *prm.max) {
                add("E_RECIPE_LIMIT", pp + "/max", "max nhỏ hơn min");
            }
        }

        // recipes
        std::set<std::string> recipeIds;
        const json& rs = ty["recipes"];
        for (size_t k = 0; k < rs.size(); ++k) {
            const json& r = rs[k];
            const std::string rp = tp + "/recipes/" + std::to_string(k);
            const std::string rid = str(r, "id");
            if (!recipeIds.insert(rid).second)
                add("E_RECIPE_DUP_ID", rp + "/id", "bản '" + rid + "' bị trùng");
            const json& values = r["values"];
            for (auto it = values.begin(); it != values.end(); ++it)
                if (!params.count(it.key()))
                    add("E_RECIPE_VALUE", rp + "/values/" + pointerKey(it.key()),
                        "'" + it.key() + "' không là tham số");
            for (const auto& tagId : order) {
                const Param& prm = params[tagId];
                if (haveTags && !prm.tag) continue;  // E_RECIPE_TAG already
                if (!values.contains(tagId)) {
                    add("E_RECIPE_VALUE", rp + "/values", "thiếu giá trị của '" + tagId + "'");
                    continue;
                }
                if (!prm.tag) continue;  // tags.json failed: the type is unknown
                const json& v = values[tagId];
                const std::string vp = rp + "/values/" + pointerKey(tagId);
                const std::string type = str(*prm.tag, "type");
                if (!recipeValueFits(type, v)) {
                    add("E_RECIPE_VALUE", vp, "giá trị không hợp kiểu " + type);
                    continue;
                }
                if (!v.is_number()) continue;
                const double d = v.get<double>();
                std::optional<double> tagMin, tagMax;
                if (const auto lim = prm.tag->find("limits");
                    lim != prm.tag->end() && lim->is_object()) {
                    tagMin = num(*lim, "min");
                    tagMax = num(*lim, "max");
                }
                if ((prm.min && d < *prm.min) || (tagMin && d < *tagMin) ||
                    (prm.max && d > *prm.max) || (tagMax && d > *tagMax))
                    add("E_RECIPE_LIMIT", vp, "giá trị ngoài giới hạn");
            }
        }
    }
}

}  // namespace mat
