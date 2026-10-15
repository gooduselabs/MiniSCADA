// Rules of alarms.json and alarm-classes.json (specs/009-alarms contracts/project-format-0.5.md §5,
// §6), the C++ twin of packages/project-schema/src/alarm-rules.ts: the same rules, the same codes
// and the same (file, path) on tests/project-vectors (cases v05-*). The structure is checked by
// hand (not by JSON Schema) so that every code and path is the one of the contract;
// schemas/alarms.schema.json describes the files for outside tools. A file that failed to load is
// passed as null and the rules that need it are skipped.
#pragma once
#include <string>
#include <vector>

#include "core/project-manager/project_validator.hpp"
#include "nlohmann/json.hpp"

namespace mat {

// Format of the project that carries alarms (D28, FR-100): never spread the string in the code.
constexpr const char* kProjectFormatAlarms = "0.5.0";

// Limits of the contract (§5).
constexpr size_t kAlarmMaxInstances = 500;
constexpr size_t kAlarmWarnInstances = 200;
constexpr size_t kAlarmMaxAreas = 64;
constexpr size_t kAlarmMaxClasses = 16;
constexpr size_t kAlarmMaxFileBytes = 512 * 1024;
constexpr size_t kAlarmMaxTextChars = 200;

struct AlarmRulesInput {
    const nlohmann::json* project = nullptr;  // project.json (schemaVersion, alarmFile, ...)
    // Parsed documents; null when not declared or when they failed to load (an error is already
    // reported by the loader).
    const nlohmann::json* alarmsDoc = nullptr;
    const nlohmann::json* alarmClassesDoc = nullptr;
    size_t alarmsBytes = 0;                       // size of the alarm file (0: unknown)
    const nlohmann::json* tags = nullptr;         // tags.json; null: it failed to load
    const nlohmann::json* connections = nullptr;  // connections.json; null: absent or failed
    bool connectionsFailed = false;               // declared by connectionFile but not loaded
};

// Number of active alarm instances (enabled alarms; one per threshold of a `limit` alarm) is
// returned. Errors and warnings are appended, sorted by (file, path, code).
size_t runAlarmRules(const AlarmRulesInput& in, std::vector<ProjectIssue>& errors,
                     std::vector<ProjectIssue>& warnings);

// Every {token} of the template is known and the braces match (E_ALARM_TEXT_TOKEN).
bool alarmTextTokensValid(const std::string& text);

}  // namespace mat
