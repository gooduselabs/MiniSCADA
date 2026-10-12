// Cross-file rules of the 0.2 validator (contracts/project-format-0.2.md §7), the C++ twin of
// packages/project-schema/src/rules-02.ts: the same rules, the same codes on tests/project-vectors
// (cases v02-*). A file that failed to load (parse or schema) is passed as absent and the rules
// that need it are skipped, as in 0.1.
#pragma once
#include <functional>
#include <map>
#include <string>
#include <vector>

#include "core/project-manager/project_validator.hpp"
#include "nlohmann/json.hpp"

namespace mat {

struct Rules02Input {
    struct Doc {
        std::string file;
        nlohmann::json doc;
    };
    struct ScreenDoc {
        std::string id;
        std::string file;
        nlohmann::json screen;
        bool hasBindings = false;
        nlohmann::json bindings;
    };
    const nlohmann::json* project = nullptr;
    const nlohmann::json* tags = nullptr;         // tags.json (null: failed to load)
    const nlohmann::json* connections = nullptr;  // connections.json (null: absent or failed)
    const nlohmann::json* loggingDoc = nullptr;   // logging.json, for its schemaVersion only
    // By name / id as listed in project.json; only the documents that loaded.
    std::map<std::string, Doc> valueTables;
    std::map<std::string, Doc> watchTables;
    std::vector<ScreenDoc> screens;
    // The logging.json rules live with the 0.1 validator; this callback runs them (the argument is
    // the id -> type map of the Tags, null when tags.json failed).
    std::function<void(const std::map<std::string, std::string>*)> logging;
    std::string runtimeVersion;
};

// Limits of D12 (FR-001).
constexpr size_t kLimitTags = 2000;
constexpr size_t kLimitCalculated = 500;
constexpr size_t kLimitRetain = 500;
constexpr size_t kLimitChannels = 16;
constexpr size_t kLimitDevices = 64;
constexpr size_t kLimitDevicesPerChannel = 32;
constexpr size_t kLimitValueTables = 256;
constexpr size_t kLimitEntries = 256;
constexpr size_t kLimitWatchTables = 32;
constexpr size_t kLimitRows = 200;

constexpr const char* kMinRuntime02 = "0.5.0";

void runRules02(const Rules02Input& in, std::vector<ProjectIssue>& errors,
                std::vector<ProjectIssue>& warnings);

// Estimated time of one scan round of the RTU channel (W_RTU_SCAN_TIME): request time in ms.
struct SerialFormat {
    int baud = 9600;
    int dataBits = 8;
    std::string parity = "even";
    int stopBits = 1;
};
double rtuRequestTimeMs(const SerialFormat& f, int dataBytes);

}  // namespace mat
