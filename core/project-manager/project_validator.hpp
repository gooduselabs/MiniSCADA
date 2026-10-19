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

// 0.9.0: history, reports and aggregates, project format 0.6 (feature 010). 0.8.0: alarms, format
// 0.5 (feature 009). 0.7.0: format 0.4 (feature 008: SVG binding targets, animations, events).
// 0.6.0 was screens v1 and widgets, format 0.3 (feature 007). 0.1.x to 0.5.x projects still run
// (research R3). 1.0.0-rc.N (T191): builds before the Go/No-Go carry a pre-release tag;
// compareSemver compares the numbers only, so a project with minRuntimeVersion 1.0.0 runs
// on 1.0.0-rc.1 (ADR 035). 1.1.0-alpha.1 (feature 012): format 1.1 (grid layout, theme).
constexpr const char* kRuntimeVersion = "1.1.0-alpha.1";

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
        // Format 0.3: the binding file of each svg item, by the id of the item (null bindings
        // above)
        std::map<std::string, nlohmann::json> itemBindings;
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
    // Format 0.6 (feature 010): reports.json (null without `reportsFile`).
    nlohmann::json reports;
    // Format 1.0 (feature 011): logic.json (null without `logic`); checked by its schema only here.
    nlohmann::json logic;

    // alarms.json and alarm-classes.json (format 0.5, feature 009); null when the project has no
    // `alarmFile`, `alarmClassFile`.
    nlohmann::json alarms;
    nlohmann::json alarmClasses;

    // The project has the Tag format of 0.2 (schemaVersion 0.2.x to 0.5.x), i.e. it is not a 0.1
    // project that runs its Tags as simulation.
    bool is02() const;
    // schemaVersion of project.json is 0.3.x to 0.6.x (screens v1, widgets).
    bool is03() const;
    // schemaVersion of project.json is 0.5.x or 0.6.x (alarms).
    bool is05() const;
    // schemaVersion of project.json is 0.6.x or 1.0.x (feature 010: history, reports; 1.0 keeps
    // them).
    bool is06() const;
    // schemaVersion of project.json is 1.0.x (feature 011: logic, templates, faceplates).
    bool is10() const;

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
// `schemasDir` holds the 1.0 schemas and, in its subdirectories 0.6/, 0.5/, 0.4/, 0.3/, 0.2/ and
// 0.1/, the frozen older ones, and widgets.catalog.json; the set is chosen by the schemaVersion of
// project.json (0.4 has its own frozen set in 0.4/). `runtimeVersion` is what minRuntimeVersion is
// compared with (E_RUNTIME_TOO_OLD). `serial`: the rule E_SERIAL_NOT_ALLOWED of a 0.2 project
// (null: not run).
ProjectValidation validateProject(const std::string& projectDir, const std::string& schemasDir,
                                  const std::string& runtimeVersion = kRuntimeVersion,
                                  const SerialPolicy* serial = nullptr);
// {"valid","errors":[{code,file,path,message}],"warnings":[{code,file,path,message}]}
std::string resultJson(const ProjectValidation& r);
nlohmann::json issuesJson(const std::vector<ProjectIssue>& issues);

}  // namespace mat
