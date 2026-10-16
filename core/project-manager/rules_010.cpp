#include "core/project-manager/rules_010.hpp"

#include <algorithm>
#include <cmath>
#include <regex>
#include <set>

namespace mat {

using nlohmann::json;

namespace {

std::string idx(size_t i) { return std::to_string(i); }

// Number or BOOL: the types the aggregates can hold (not STRING; an unknown Tag is neither).
bool numOrBool(const std::map<std::string, std::string>& types, const std::string& id) {
    const auto it = types.find(id);
    return it != types.end() && it->second != "STRING";
}

bool isIntegral(const json& v) {
    if (v.is_number_integer()) return true;
    if (!v.is_number_float()) return false;
    const double d = v.get<double>();
    return std::isfinite(d) && d == std::floor(d);
}

bool inList(const std::vector<std::string>& list, const std::string& v) {
    return std::find(list.begin(), list.end(), v) != list.end();
}

// bucket -> periods that a bar chart accepts (contracts/widget-catalog-010.md §2.1)
const std::vector<std::string>* barPeriods(const std::string& bucket) {
    static const std::vector<std::string> hour{"last24h", "today", "yesterday"};
    static const std::vector<std::string> shift{"last24h",   "last7d",    "today",
                                                "yesterday", "thisShift", "lastShift"};
    static const std::vector<std::string> day{"last7d", "last30d", "thisMonth", "lastMonth"};
    if (bucket == "hour") return &hour;
    if (bucket == "shift") return &shift;
    if (bucket == "day") return &day;
    return nullptr;
}

bool knownPeriod(const std::string& p) {
    static const std::set<std::string> kPeriods{"last24h",   "last7d",    "last30d",
                                                "today",     "yesterday", "thisShift",
                                                "lastShift", "thisMonth", "lastMonth"};
    return kPeriods.count(p) > 0;
}

constexpr double kMaxCategories = 48;

}  // namespace

bool isShiftCount(double n) {
    for (const double c : {2, 3, 4, 6, 8, 12})
        if (n == c) return true;
    return false;
}

void reportRules(const json& cfg, const json* logging, bool hasLoggingFile,
                 const std::map<std::string, std::string>* tagTypes, const Rule010Add& add) {
    static const std::regex kShiftStart(R"(^([01]\d|2[0-3]):[0-5]\d$)");
    std::set<std::string> ids;
    const json& reports = cfg["reports"];
    for (size_t i = 0; i < reports.size(); ++i) {
        const json& r = reports[i];
        const std::string p = "/reports/" + idx(i);
        const std::string id = r["id"].get<std::string>();
        if (!ids.insert(id).second) add("E_RPT_DUP_ID", p + "/id", "id '" + id + "' is duplicated");

        // period and shifts
        const std::string period = r["period"].get<std::string>();
        if (period == "shift") {
            if (!r.contains("shifts")) {
                add("E_RPT_PERIOD", p, "period shift needs shifts");
            } else {
                const json& s = r["shifts"];
                const bool countOk =
                    s["count"].is_number() && isShiftCount(s["count"].get<double>());
                const bool startOk = s["start"].is_string() &&
                                     std::regex_match(s["start"].get<std::string>(), kShiftStart);
                if (!countOk || !startOk)
                    add("E_RPT_SHIFT", p + "/shifts",
                        "count is one of 2, 3, 4, 6, 8, 12 and start is HH:MM");
            }
        } else if (r.contains("shifts")) {
            add("E_RPT_PERIOD", p, "shifts is only for period shift");
        }
        if (r.contains("rowMinutes") && period != "day")
            add("E_RPT_PERIOD", p, "rowMinutes is only for period day");

        // repeated functions, number of columns
        size_t pairs = 0;
        std::set<std::string> tagIds;
        const json& columns = r["columns"];
        for (size_t j = 0; j < columns.size(); ++j) {
            std::set<std::string> seen;
            const json& fns = columns[j]["functions"];
            for (size_t k = 0; k < fns.size(); ++k) {
                const std::string f = fns[k].get<std::string>();
                if (!seen.insert(f).second)
                    add("E_RPT_FN", p + "/columns/" + idx(j) + "/functions/" + idx(k),
                        "function '" + f + "' is repeated");
            }
            pairs += fns.size();
            tagIds.insert(columns[j]["tagId"].get<std::string>());
        }
        if (pairs > kReportMaxColumns || tagIds.size() > kReportMaxTags)
            add("E_RPT_LIMIT", p + "/columns", "more than 24 columns (Tag x function) or 24 Tags");

        // group and Tags
        if (!logging) {
            if (!hasLoggingFile)
                add("E_RPT_REF_GROUP", p + "/group", "the project has no logging.json");
            continue;
        }
        const std::string gid = r["group"].get<std::string>();
        const json* group = nullptr;
        for (const auto& g : (*logging)["groups"])
            if (g["id"] == gid) {
                group = &g;
                break;
            }
        if (!group) {
            add("E_RPT_REF_GROUP", p + "/group", "there is no group '" + gid + "'");
            continue;
        }
        if (!group->contains("aggregates")) {
            add("E_RPT_NO_AGG", p + "/group", "group '" + gid + "' has no aggregates");
            continue;
        }
        for (size_t j = 0; j < columns.size(); ++j) {
            const std::string tagId = columns[j]["tagId"].get<std::string>();
            const std::string cp = p + "/columns/" + idx(j) + "/tagId";
            const json* lt = nullptr;
            for (const auto& t : (*group)["tags"])
                if (t["tagId"] == tagId) {
                    lt = &t;
                    break;
                }
            if (!lt) {
                add("E_RPT_REF_TAG", cp, "Tag '" + tagId + "' is not in group '" + gid + "'");
                continue;
            }
            if ((lt->contains("aggregate") && (*lt)["aggregate"] == false) ||
                (tagTypes && !numOrBool(*tagTypes, tagId)))
                add("E_RPT_NO_AGG", cp, "Tag '" + tagId + "' is not aggregated");
        }
    }
}

void historyWidgetRules(const WidgetSpec& spec, const std::string& p, const json& props,
                        const json& tagsObj, const HistoryCtx& ctx,
                        const std::function<std::string(const std::string&)>& classOf,
                        const Rule010Add& add) {
    const std::string& widget = spec.id;
    // combinations of properties of the bar and pie charts
    if (widget == "history-bar" || widget == "history-pie") {
        if (props.contains("shiftCount") && props["shiftCount"].is_number() &&
            isIntegral(props["shiftCount"])) {
            const double sc = props["shiftCount"].get<double>();
            if (sc >= 2 && sc <= 12 && !isShiftCount(sc))
                add("E_WIDGET_PROP", p + "/props/shiftCount",
                    "shiftCount is one of 2, 3, 4, 6, 8, 12");
        }
    }
    if (widget == "history-bar") {
        const std::string bucket = props.contains("bucket") && props["bucket"].is_string()
                                       ? props["bucket"].get<std::string>()
                                       : (props.contains("bucket") ? "?" : "shift");
        const bool periodIsString = !props.contains("period") || props["period"].is_string();
        const std::string period = props.contains("period") && props["period"].is_string()
                                       ? props["period"].get<std::string>()
                                       : "last7d";
        const std::vector<std::string>* allowed = barPeriods(bucket);
        if (allowed && periodIsString && knownPeriod(period)) {
            const double count = props.contains("shiftCount") && props["shiftCount"].is_number()
                                     ? props["shiftCount"].get<double>()
                                     : 3;
            if (!inList(*allowed, period))
                add("E_WIDGET_PROP", p + "/props/period",
                    "bucket " + bucket + " does not go with period " + period);
            else if (bucket == "shift" && period == "last7d" && count * 7 > kMaxCategories)
                add("E_WIDGET_PROP", p + "/props/period",
                    "more than 48 categories (shiftCount x 7)");
        }
    }

    // the logging group
    if (!props.contains("group")) {
        add("E_WIDGET_HISTORY_GROUP", p + "/props", "the property group is missing");
        return;
    }
    const json& gv = props["group"];
    if (!gv.is_string() || gv.get<std::string>().empty()) return;  // E_WIDGET_PROP by the value
    const std::string gid = gv.get<std::string>();
    const json* group = nullptr;
    if (ctx.logging) {
        for (const auto& g : (*ctx.logging)["groups"])
            if (g["id"] == gid) {
                group = &g;
                break;
            }
    } else if (ctx.hasLoggingFile) {
        return;  // logging.json failed: the rules that need it are skipped
    }
    if (!group) {
        add("E_WIDGET_HISTORY_GROUP", p + "/props/group",
            "there is no logging group '" + gid + "'");
        return;
    }
    // Slots of the widget that carry `inGroup` (read from the catalog json of the slot)
    for (const SlotSpec& slot : spec.slots) {
        if (slot.inGroup != "group") continue;
        if (!tagsObj.contains(slot.name) || !tagsObj[slot.name].is_array()) continue;
        const json& v = tagsObj[slot.name];
        for (size_t k = 0; k < v.size(); ++k) {
            if (!v[k].is_string()) continue;
            const std::string id = v[k].get<std::string>();
            const std::string cls = classOf(id);
            if (cls.empty() || !inList(slot.types, cls)) continue;  // E_REF_TAG, E_WIDGET_TAG_TYPE
            const json* lt = nullptr;
            for (const auto& t : (*group)["tags"])
                if (t["tagId"] == id) {
                    lt = &t;
                    break;
                }
            const std::string path = p + "/tags/" + slot.name + "/" + idx(k);
            if (!lt)
                add("E_WIDGET_HISTORY_TAG", path, "Tag '" + id + "' is not in group '" + gid + "'");
            else if (slot.needsAggregate &&
                     (!group->contains("aggregates") ||
                      (lt->contains("aggregate") && (*lt)["aggregate"] == false)))
                add("E_WIDGET_HISTORY_AGG", path,
                    "Tag '" + id + "' has no aggregates in group '" + gid + "'");
        }
    }
}

size_t aggregatedTagCount(const json& g, const std::map<std::string, std::string>& tagType) {
    if (!g.contains("aggregates")) return 0;
    size_t n = 0;
    for (const auto& t : g["tags"]) {
        if (t.contains("aggregate") && t["aggregate"] == false) continue;
        if (numOrBool(tagType, t["tagId"].get<std::string>())) ++n;
    }
    return n;
}

void loggingTriggerRules(const json& g, const std::string& p,
                         const std::map<std::string, std::string>* tagType, const Rule010Add& add) {
    const std::string mode = g["mode"].get<std::string>();
    if (mode != "trigger") {
        if (g.contains("trigger"))
            add("E_LOG_TRIGGER", p + "/trigger", "trigger is only for mode trigger");
        if (mode == "cyclic" && g.contains("expectedRowsPerDay"))
            add("E_LOG_TRIGGER", p + "/expectedRowsPerDay", "expectedRowsPerDay is not for cyclic");
        return;
    }
    if (!g.contains("trigger")) {
        add("E_LOG_TRIGGER", p, "mode trigger needs the field trigger");
    } else {
        const json& t = g["trigger"];
        const std::string tagId = t["tagId"].get<std::string>();
        if (tagType) {
            const auto it = tagType->find(tagId);
            if (it == tagType->end())
                add("E_LOG_REF_TAG", p + "/trigger/tagId",
                    "Tag '" + tagId + "' is not in tags.json");
            else if (it->second == "STRING")
                add("E_LOG_TRIGGER", p + "/trigger/tagId",
                    "trigger Tag '" + tagId + "' is " + it->second);
            else if (it->second == "BOOL" && t.contains("threshold"))
                add("E_LOG_TRIGGER", p + "/trigger/threshold", "threshold is not for a BOOL Tag");
        }
        const std::string edge = t["edge"].get<std::string>();
        if (edge == "active" && !g.contains("periodMs"))
            add("E_LOG_TRIGGER", p, "edge active needs periodMs");
        if (edge != "active" && g.contains("periodMs"))
            add("E_LOG_TRIGGER", p + "/periodMs", "periodMs is only for edge active");
    }
    if (g.contains("maxIntervalMs"))
        add("E_LOG_TRIGGER", p + "/maxIntervalMs", "maxIntervalMs is not for trigger");
}

void loggingAggregateRules(const json& g, const std::string& p,
                           const std::map<std::string, std::string>* tagType,
                           const Rule010Add& add) {
    const json& tags = g["tags"];
    for (size_t j = 0; j < tags.size(); ++j) {
        const json& t = tags[j];
        if (!t.contains("aggregate") || t["aggregate"] != true || !tagType) continue;
        const auto it = tagType->find(t["tagId"].get<std::string>());
        if (it != tagType->end() && it->second == "STRING")
            add("E_LOG_AGG", p + "/tags/" + idx(j) + "/aggregate",
                "string Tag '" + t["tagId"].get<std::string>() + "' cannot be aggregated");
    }
    if (!g.contains("aggregates")) return;
    const json& a = g["aggregates"];
    if (tagType && aggregatedTagCount(g, *tagType) == 0)
        add("E_LOG_AGG", p + "/aggregates", "no numeric or BOOL Tag of the group is aggregated");
    if (a.value("hourRetentionDays", kDefaultHourRetentionDays) <
        a.value("minuteRetentionDays", kDefaultMinuteRetentionDays))
        add("E_LOG_AGG", p + "/aggregates", "hourRetentionDays must be >= minuteRetentionDays");
}

}  // namespace mat
