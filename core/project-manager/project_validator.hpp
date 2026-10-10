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

constexpr const char* kRuntimeVersion = "0.2.0";

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

    // Files that may be served under /project/ (svgFile of every screen).
    std::set<std::string> allowlist() const;
    // Body of GET /api/v1/projects/active.
    std::string activeJson() const;
    // {"projectId","projectVersion"} for the live `hello` message.
    std::string helloJson() const;
};

struct ProjectValidation {
    bool valid = false;
    std::vector<ProjectIssue> errors;
    std::optional<LoadedProject> project;
};

bool isSafeRelPath(const std::string& p);
int compareSemver(const std::string& a, const std::string& b);
ProjectValidation validateProject(const std::string& projectDir, const std::string& schemasDir);
// {"valid","errors":[{code,file,path,message}],"warnings":[]}
std::string resultJson(const ProjectValidation& r);
nlohmann::json issuesJson(const std::vector<ProjectIssue>& issues);

}  // namespace mat
