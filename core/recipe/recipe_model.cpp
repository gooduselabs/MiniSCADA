#include "core/recipe/recipe_model.hpp"

#include <map>

#include "core/project-manager/rules_recipes.hpp"

namespace mat::recipe {

using nlohmann::json;

namespace {

std::string str(const json& o, const char* key) {
    const auto it = o.find(key);
    return it != o.end() && it->is_string() ? it->get<std::string>() : std::string();
}

std::optional<double> num(const json& o, const char* key) {
    const auto it = o.find(key);
    if (it == o.end() || !it->is_number()) return std::nullopt;
    return it->get<double>();
}

}  // namespace

int roleRank(const std::string& role) {
    if (role == "viewer") return 0;
    if (role == "operator") return 1;
    if (role == "engineer") return 2;
    if (role == "administrator") return 3;
    return -1;
}

const ParamDef* TypeDef::param(const std::string& tag) const {
    for (const auto& p : params)
        if (p.tag == tag) return &p;
    return nullptr;
}

json TypeDef::paramsJson() const {
    json out = json::array();
    for (const auto& p : params) {
        json j = {{"tag", p.tag}, {"type", p.type}};
        if (!p.label.empty()) j["label"] = p.label;
        if (!p.unit.empty()) j["unit"] = p.unit;
        if (!p.description.empty()) j["description"] = p.description;
        if (p.min) j["min"] = *p.min;
        if (p.max) j["max"] = *p.max;
        if (p.tagMin) j["tagMin"] = *p.tagMin;
        if (p.tagMax) j["tagMax"] = *p.tagMax;
        if (p.decimals >= 0) j["decimals"] = p.decimals;
        out.push_back(std::move(j));
    }
    return out;
}

const TypeDef* Catalog::find(const std::string& id) const {
    for (const auto& t : types)
        if (t.id == id) return &t;
    return nullptr;
}

Catalog catalogFrom(const json& recipes, const json& tags) {
    Catalog c;
    if (!recipes.is_object() || !recipes.contains("types")) return c;
    std::map<std::string, const json*> byId;
    if (tags.is_object() && tags.contains("tags") && tags["tags"].is_array())
        for (const auto& t : tags["tags"]) byId[str(t, "id")] = &t;
    for (const auto& ty : recipes["types"]) {
        TypeDef d;
        d.id = str(ty, "id");
        d.name = str(ty, "name");
        d.description = str(ty, "description");
        if (const auto s = ty.find("security"); s != ty.end() && s->is_object()) {
            if (s->contains("view")) d.view = str(*s, "view");
            if (s->contains("operate")) d.operate = str(*s, "operate");
            if (s->contains("edit")) d.edit = str(*s, "edit");
        }
        for (const auto& p : ty["params"]) {
            ParamDef pd;
            pd.tag = str(p, "tagId");
            pd.label = str(p, "label");
            pd.unit = str(p, "unit");
            pd.description = str(p, "description");
            pd.min = num(p, "min");
            pd.max = num(p, "max");
            if (const auto dec = num(p, "decimals")) pd.decimals = static_cast<int>(*dec);
            if (const auto t = byId.find(pd.tag); t != byId.end()) {
                pd.type = str(*t->second, "type");
                if (const auto lim = t->second->find("limits");
                    lim != t->second->end() && lim->is_object()) {
                    pd.tagMin = num(*lim, "min");
                    pd.tagMax = num(*lim, "max");
                }
            }
            d.params.push_back(std::move(pd));
        }
        if (ty.contains("recipes")) d.projectRecipes = ty["recipes"];
        c.types.push_back(std::move(d));
    }
    return c;
}

std::vector<ValueIssue> checkValues(const TypeDef& type, const json& values) {
    std::vector<ValueIssue> out;
    if (!values.is_object()) {
        out.push_back({"", "E_RECIPE_VALUE", "values phải là một đối tượng"});
        return out;
    }
    for (auto it = values.begin(); it != values.end(); ++it)
        if (!type.param(it.key()))
            out.push_back({it.key(), "E_RECIPE_VALUE", "không là tham số của loại"});
    for (const auto& p : type.params) {
        const auto it = values.find(p.tag);
        if (it == values.end()) {
            out.push_back({p.tag, "E_RECIPE_VALUE", "thiếu giá trị"});
            continue;
        }
        if (!recipeValueFits(p.type, *it)) {
            out.push_back({p.tag, "E_RECIPE_VALUE", "giá trị không hợp kiểu " + p.type});
            continue;
        }
        if (it->is_string() && it->get<std::string>().size() > 256) {
            out.push_back({p.tag, "E_RECIPE_VALUE", "chuỗi dài hơn 256 byte"});
            continue;
        }
        if (!it->is_number()) continue;
        const double d = it->get<double>();
        if ((p.min && d < *p.min) || (p.tagMin && d < *p.tagMin) || (p.max && d > *p.max) ||
            (p.tagMax && d > *p.tagMax))
            out.push_back({p.tag, "E_RECIPE_LIMIT", "giá trị ngoài giới hạn"});
    }
    return out;
}

json issuesJson(const std::vector<ValueIssue>& issues) {
    json out = json::array();
    for (const auto& i : issues)
        out.push_back({{"tag", i.tag}, {"code", i.code}, {"message", i.message}});
    return out;
}

}  // namespace mat::recipe
