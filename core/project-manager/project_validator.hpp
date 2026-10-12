// Project v0 loader + validator, C++ side (contracts/project-format.md). Must report the same set
// of error codes as packages/project-schema on tests/project-vectors (FR-008). Does not parse
// SVG (Constitution II): the data-mat-uid check exists only in the TypeScript validator.
#pragma once
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"

namespace mat {

constexpr const char* kRuntimeVersion = "0.4.0";

struct ProjectIssue {
    std::string code;
    std::string file;
    std::string path;  // JSON Pointer
    std::string message;
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
ProjectValidation validateProject(const std::string& projectDir, const std::string& schemasDir);
// {"valid","errors":[{code,file,path,message}],"warnings":[{code,file,path,message}]}
std::string resultJson(const ProjectValidation& r);
nlohmann::json issuesJson(const std::vector<ProjectIssue>& issues);

}  // namespace mat
