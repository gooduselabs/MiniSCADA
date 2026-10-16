// Rules of feature 010 (history, reports) of the 0.6 validator, the C++ twin of
// packages/project-schema/src/rules-010.ts: report templates (E_RPT_*), menu entries that open a
// report (E_NAV_REPORT is in rules_03.cpp), the history widgets of catalog 0.5.0
// (E_WIDGET_HISTORY_*, the bucket/period combinations) and the trigger/aggregate rules of
// logging.json 0.6 (E_LOG_TRIGGER, E_LOG_AGG). Same codes, same paths, same order of evaluation.
#pragma once
#include <functional>
#include <map>
#include <string>
#include <vector>

#include "core/project-manager/widget_catalog.hpp"
#include "nlohmann/json.hpp"

namespace mat {

using Rule010Add =
    std::function<void(const char* code, const std::string& path, const std::string& message)>;

constexpr size_t kReportMaxColumns = 24;
constexpr size_t kReportMaxTags = 24;

// Shifts per working day that a report or a widget may use.
bool isShiftCount(double n);

// Rules of reports.json (`cfg` passed the schema). `logging`: logging.json when it loaded, null
// when the project has none (`hasLoggingFile` false: groups cannot be resolved, E_RPT_REF_GROUP)
// or when that file failed (`hasLoggingFile` true: the rules that need it are skipped).
// `tagTypes`: id -> type, null when tags.json failed.
void reportRules(const nlohmann::json& cfg, const nlohmann::json* logging, bool hasLoggingFile,
                 const std::map<std::string, std::string>* tagTypes, const Rule010Add& add);

struct HistoryCtx {
    const nlohmann::json* logging = nullptr;  // null: failed or absent
    bool hasLoggingFile = false;
};

// Rules of a widget of the group `history`. `p` is "/items/<i>"; `classOf` gives the Tag class
// (number | bool | string) of a Tag id, "" when the Tag does not exist.
void historyWidgetRules(const WidgetSpec& spec, const std::string& p, const nlohmann::json& props,
                        const nlohmann::json& tagsObj, const HistoryCtx& ctx,
                        const std::function<std::string(const std::string&)>& classOf,
                        const Rule010Add& add);

// Logging 0.6 (contracts/logging-config-0.2.md §3). `p` is "/groups/<i>"; `tagType` null when
// tags.json failed.
void loggingTriggerRules(const nlohmann::json& group, const std::string& p,
                         const std::map<std::string, std::string>* tagType, const Rule010Add& add);
void loggingAggregateRules(const nlohmann::json& group, const std::string& p,
                           const std::map<std::string, std::string>* tagType,
                           const Rule010Add& add);

// Number of numeric or BOOL Tags of the group that the aggregates cover (0 without `aggregates`).
size_t aggregatedTagCount(const nlohmann::json& group,
                          const std::map<std::string, std::string>& tagType);

constexpr double kDefaultMinuteRetentionDays = 31;
constexpr double kDefaultHourRetentionDays = 730;

}  // namespace mat
