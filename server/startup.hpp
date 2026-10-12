// Project activation at startup (FR-025, T063), without CivetWeb so that it can be tested: an
// invalid project is not activated, but the runtime keeps running and the page and system/info
// show its errors.
#pragma once
#include <cstddef>
#include <memory>
#include <optional>
#include <set>
#include <string>

#include "core/project-manager/project_validator.hpp"
#include "core/tag-engine/tag_model.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "nlohmann/json.hpp"

namespace mat {

// Live session limit: the project may only lower the runtime limit (Constitution IV).
size_t effectiveMaxClients(size_t configMax, size_t projectMax);

struct ActiveProject {
    bool active = false;
    size_t maxClients = 0;            // effectiveMaxClients(config, project); config when inactive
    std::string helloJson = "null";   // "project" of the live hello
    std::set<std::string> allowlist;  // files served under /project/
    std::string activeJson;           // body of GET /api/v1/projects/active; empty: 503
    nlohmann::json errors = nlohmann::json::array();  // the validation errors
    nlohmann::json info;  // "project" of GET /api/v1/system/info (contracts/http-api.md)
    // Content digest of the running project ("sha256:…", feature 005): in the live hello (1.1.0),
    // projects/active and system/info; nullopt (null) when no project runs.
    std::optional<std::string> digest;
    // The Tags, channels and value tables of the active project (feature 006): what the engine
    // runs. Null when no project is active.
    std::shared_ptr<const ProjectModel> model;
};

// Adds the tags of a valid project (0.1 or 0.2) to `store`, in the order of tags.json, then the
// SIM.T0001.. load Tags when `simLoad` (a 0.1 Tag is a `legacy` simulation Tag in the model).
// `digest`: the content digest of the project's files (projectDirDigest), shown only when the
// project is activated.
ActiveProject activateProject(const ProjectValidation& v, size_t configMaxClients, TagStore& store,
                              const std::optional<std::string>& digest = std::nullopt,
                              bool simLoad = false);

}  // namespace mat
