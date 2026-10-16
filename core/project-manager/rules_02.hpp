// Cross-file rules of the 0.2 validator (contracts/project-format-0.2.md §7), the C++ twin of
// packages/project-schema/src/rules-02.ts: the same rules, the same codes on tests/project-vectors
// (cases v02-*). A file that failed to load (parse or schema) is passed as absent and the rules
// that need it are skipped, as in 0.1.
#pragma once
#include <functional>
#include <map>
#include <set>
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
    const SerialPolicy* serial = nullptr;  // null: E_SERIAL_NOT_ALLOWED is not run
    // reports.json of a 0.6 project (null: absent or failed): only its schemaVersion is checked
    // here.
    const nlohmann::json* reports = nullptr;
    // "0.2" (default), "0.3" (feature 007), "0.4" (008), "0.5" (009) or "0.6" (010): the
    // schemaVersion that project.json and every file must carry, and the lowest minRuntimeVersion.
    // The screens of 0.3 and later are not checked here (rules_03): `screens` stays empty then.
    std::string schema = "0.2";
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
constexpr const char* kMinRuntime03 = "0.6.0";
constexpr const char* kMinRuntime04 = "0.7.0";
constexpr const char* kMinRuntime05 = "0.8.0";
constexpr const char* kMinRuntime06 = "0.9.0";  // feature 010
constexpr size_t kMaxScreenTagsLimit = 1000;    // one live subscribe (live-ws.md)

void runRules02(const Rules02Input& in, std::vector<ProjectIssue>& errors,
                std::vector<ProjectIssue>& warnings);

// What the rules of 0.2 and 0.3 share about Tag types and bindings.
struct TypeRange {
    double lo, hi;
};
TypeRange typeRangeOf(const std::string& tagType);
bool isNumericTagTypeName(const std::string& tagType);  // not BOOL, not STRING
bool isIntegerTagTypeName(const std::string& tagType);  // INT16 .. UINT64

// The rules of one binding file (contracts/project-format-0.2.md §8, 0.3 §4): uids, ids, targets,
// transforms, Tag types. `uids`: the elementUid values of the screen (0.2) or of the svg item
// (0.3). hasTags false (tags.json failed to load): references to Tags are not checked.
struct BindingCtx {
    bool hasTags = false;
    const std::map<std::string, std::string>* tagType = nullptr;   // id -> type
    const std::map<std::string, std::string>* tagTable = nullptr;  // id -> valueTable of the Tag
    const std::set<std::string>* tableSet = nullptr;               // names in project.valueTables
};
using BindingAdd = std::function<void(const char* code, const std::string& file,
                                      const std::string& path, const std::string& message)>;
void bindingRules(const nlohmann::json& bindings, const std::string& bfile,
                  const std::set<std::string>& uids, const BindingCtx& ctx, const BindingAdd& add);

// Estimated time of one scan round of the RTU channel (W_RTU_SCAN_TIME): request time in ms.
struct SerialFormat {
    int baud = 9600;
    int dataBits = 8;
    std::string parity = "even";
    int stopBits = 1;
};
double rtuRequestTimeMs(const SerialFormat& f, int dataBytes);

}  // namespace mat
