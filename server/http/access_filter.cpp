#include "server/http/access_filter.hpp"

#include <algorithm>
#include <functional>

#include "core/auth/access_catalog.hpp"

namespace mat {

namespace {

using nlohmann::json;

json filteredNavigation(const json& items, const SessionAccess& a) {
    json out = json::array();
    for (const auto& it : items) {
        if (it.is_object() && it.contains("items") && it["items"].is_array()) {
            json g = it;
            g["items"] = filteredNavigation(it["items"], a);
            if (!g["items"].empty()) out.push_back(std::move(g));
        } else if (it.is_object() && it.contains("screen") && it["screen"].is_string()) {
            if (a.access.canViewScreen(it["screen"].get<std::string>())) out.push_back(it);
        } else {
            out.push_back(it);  // an entry of a system page
        }
    }
    return out;
}

}  // namespace

json filteredActive(const json& doc, const SessionAccess& a) {
    json j = doc;
    if (j.contains("project") && j["project"].is_object()) {
        json& p = j["project"];
        if (p.contains("screens") && p["screens"].is_array()) {
            json kept = json::array();
            for (const auto& s : p["screens"])
                if (s.is_string() && a.access.canViewScreen(s.get<std::string>()))
                    kept.push_back(s);
            p["screens"] = kept;
        }
        if (p.contains("navigation") && p["navigation"].is_object() &&
            p["navigation"].contains("items") && p["navigation"]["items"].is_array())
            p["navigation"]["items"] = filteredNavigation(p["navigation"]["items"], a);
        if (p.contains("navigation") && j.contains("navigation") && j["navigation"].is_object())
            j["navigation"] = p["navigation"];
        if (p.contains("entryScreen") && p["entryScreen"].is_string() &&
            !a.access.canViewScreen(p["entryScreen"].get<std::string>()) &&
            !a.access.screens.empty())
            p["entryScreen"] = a.access.screens.front();
    }
    if (j.contains("screens") && j["screens"].is_array()) {
        json kept = json::array();
        for (const auto& s : j["screens"])
            if (s.is_object() && s.contains("id") && s["id"].is_string() &&
                a.access.canViewScreen(s["id"].get<std::string>()))
                kept.push_back(s);
        j["screens"] = kept;
    } else if (j.contains("screens") && j["screens"].is_object()) {  // before format 0.3
        json kept = json::object();
        for (auto it = j["screens"].begin(); it != j["screens"].end(); ++it)
            if (a.access.canViewScreen(it.key())) kept[it.key()] = it.value();
        j["screens"] = kept;
    }
    if (j.contains("tags") && j["tags"].is_object() && j["tags"].contains("tags") &&
        j["tags"]["tags"].is_array()) {
        json kept = json::array();
        for (const auto& t : j["tags"]["tags"])
            if (t.is_object() && t.contains("id") && t["id"].is_string() &&
                a.access.historyTag(t["id"].get<std::string>()))
                kept.push_back(t);
        j["tags"]["tags"] = kept;
    }
    return j;
}

json filteredScreen(const json& screen, const std::vector<std::string>& hidden) {
    json j = screen;
    const auto isHidden = [&](const json& v) {
        return v.is_string() &&
               std::find(hidden.begin(), hidden.end(), v.get<std::string>()) != hidden.end();
    };
    if (j.contains("items") && j["items"].is_array()) {
        json kept = json::array();
        for (const auto& it : j["items"])
            if (!(it.is_object() && it.contains("id") && isHidden(it["id"]))) kept.push_back(it);
        j["items"] = kept;
    }
    std::function<void(json&)> cells = [&](json& v) {
        if (v.is_object()) {
            if (v.contains("item") && isHidden(v["item"])) v.erase("item");
            for (auto& kv : v.items()) cells(kv.value());
        } else if (v.is_array()) {
            for (auto& x : v) cells(x);
        }
    };
    if (j.contains("layout")) cells(j["layout"]);
    return j;
}

json filteredReports(const json& doc, const SessionAccess& a) {
    json j = doc;
    if (j.contains("reports") && j["reports"].is_array()) {
        json kept = json::array();
        for (const auto& r : j["reports"])
            if (r.is_object() && r.contains("id") && r["id"].is_string() &&
                a.access.canViewReport(r["id"].get<std::string>()))
                kept.push_back(r);
        j["reports"] = kept;
    }
    return j;
}

std::string pageWriteRefusal(const ResourceCatalog& catalog, const SessionAccess& a,
                             const std::string& screen, const std::string& widget,
                             const std::string& tag) {
    if (screen.empty() || widget.empty())
        return "Lệnh ghi của trang phải nêu màn hình và thành phần gửi lệnh.";
    const CatalogItem* item = itemOfWrite(catalog, screen, widget);
    if (!item) return "Không có thành phần này trên màn hình.";
    if (!a.access.canOperate(screen, item->id))
        return "Bạn không có quyền thao tác thành phần này.";
    if (std::find(item->tags.begin(), item->tags.end(), tag) == item->tags.end())
        return "Thành phần này không ghi Tag " + tag + ".";
    return "";
}

}  // namespace mat
