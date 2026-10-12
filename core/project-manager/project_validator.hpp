// Project v0 loader + validator, C++ side (contracts/project-format.md). Must report the same set
// of error codes as packages/project-schema on tests/project-vectors (FR-008). Does not parse
// SVG (Constitution II): the data-mat-uid check exists only in the TypeScript validator.
#pragma once
#include <functional>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"

namespace mat {

// 0.5.0: Tag v1, project format 0.2 (feature 006 T040). 0.1.x projects still run (research R3).
constexpr const char* kRuntimeVersion = "0.5.0";

// The rule that only the runtime of a device can run (feature 006 T166): a project may use only the
// serial ports of `serialPorts` in the device's configuration, the console of the system never.
// Not part of the shared vectors; a validator given none does not run it (E_SERIAL_NOT_ALLOWED).
struct SerialPolicy {
    std::vector<std::string> allowPatterns;  // serialPorts
    // true: the port ("ttyAS2" or a /dev/serial path) is the console or has a getty; null: none is
    std::function<bool(const std::string& port)> isConsole;
};

struct ProjectIssue {
    std::string code;
    std::string file;
    std::string path;  // JSON Pointer
    std::string message;
    // Expression errors of 0.2: [start, end) in Unicode code points of the expression; -1: none.
    int spanStart = -1;
    int spanEnd = -1;
};

struct LoadedProject {
    struct Screen {
        std::string id;
        nlohmann::json screen;
        nlohmann::json bindings;
    };
    nlohmann::json project;
    nlohmann::json tags;
    std::vector<Screen> screens;
    // logging.json (feature 003); null when the project has no `loggingFile`.
    nlohmann::json logging;
    // Format 0.2 (feature 006): connections.json (null without `connectionFile`), value tables and
    // watch tables by name / id.
    nlohmann::json connections;
    std::map<std::string, nlohmann::json> valueTables;
    std::map<std::string, nlohmann::json> watchTables;

    // schemaVersion of project.json is 0.2.x.
    bool is02() const;

    // Files that may be served under /project/ (svgFile of every screen).
    std::set<std::string> allowlist() const;
    // The project's files (specs/005-device-online/data-model.md §8): project.json, tagFile,
    // loggingFile when present, and per screen screens/<id>.screen.json, bindingFile, svgFile. No
    // duplicates (screens may share an SVG), sorted by UTF-8 bytes like files[] of a package
    // manifest: the same list as projectFiles() of packages/project-schema. Other files of the
    // directory are not part of the project.
    std::vector<std::string> files() const;
    // Body of GET /api/v1/projects/active.
    std::string activeJson() const;
    // {"projectId","projectVersion"} for the live `hello` message.
    std::string helloJson() const;
};

struct ProjectValidation {
    bool valid = false;
    std::vector<ProjectIssue> errors;
    std::vector<ProjectIssue> warnings;  // never block activation (W_LOG_*, feature 003)
    std::optional<LoadedProject> project;
};

bool isSafeRelPath(const std::string& p);
int compareSemver(const std::string& a, const std::string& b);
// `schemasDir` holds the 0.2 schemas and, in its subdirectory 0.1/, the frozen 0.1 ones; the set is
// chosen by the schemaVersion of project.json. `runtimeVersion` is what minRuntimeVersion is
// compared with (E_RUNTIME_TOO_OLD).
// `serial`: the rule E_SERIAL_NOT_ALLOWED of a 0.2 project (null: not run).
ProjectValidation validateProject(const std::string& projectDir, const std::string& schemasDir,
                                  const std::string& runtimeVersion = kRuntimeVersion,
                                  const SerialPolicy* serial = nullptr);
// {"valid","errors":[{code,file,path,message}],"warnings":[{code,file,path,message}]}
std::string resultJson(const ProjectValidation& r);
nlohmann::json issuesJson(const std::vector<ProjectIssue>& issues);

}  // namespace mat
