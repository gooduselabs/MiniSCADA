// The recipes people made on the device (feature 024, specs/024-recipes/plan.md decision 2):
// <dataDir>/recipes/<projectId>.json, never the project. One `rev` for the whole file, raised by
// each change; a change made on another rev is refused (CONFLICT). Written atomically (a temporary
// file, fsync, rename, fsync of the folder), mode 0600. Not thread-safe: the service holds a lock.
//
// {"schemaVersion": "1.0.0", "rev": 3, "types": {"<type id>": [{"id": "d-1a2b3c4d", "name": ..,
//  "values": {..}, "updatedAt": "2026-10-25T08:00:00Z", "updatedBy": "an"}]}}
#pragma once
#include <cstdint>
#include <map>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"

namespace mat::recipe {

constexpr size_t kStoreMaxBytes = 1024 * 1024;
constexpr size_t kMaxRecipesPerType = 200;  // project and device recipes together

struct StoredRecipe {
    std::string id, name;
    nlohmann::json values = nlohmann::json::object();
    std::string updatedAt, updatedBy;
};

class RecipeStore {
   public:
    explicit RecipeStore(std::string path) : path_(std::move(path)) {}

    // Reads the file. Missing: empty, rev 0. Damaged (not JSON, wrong shape, too large): renamed to
    // <path>.bad, empty, and `err` says why (the caller logs it); true in both cases. false only
    // when the folder cannot be made.
    bool load(std::string& err);

    int64_t rev() const { return rev_; }
    const std::vector<StoredRecipe>& list(const std::string& type) const;
    const StoredRecipe* find(const std::string& type, const std::string& id) const;

    enum class Status { Ok, Conflict, NotFound, IoError };
    // Adds `r` (a new id) or replaces the recipe of that id. Conflict when `expectRev` is not
    // rev().
    Status put(const std::string& type, const StoredRecipe& r, int64_t expectRev, std::string& err);
    Status remove(const std::string& type, const std::string& id, int64_t expectRev,
                  std::string& err);

   private:
    bool write(const std::map<std::string, std::vector<StoredRecipe>>& types, int64_t rev,
               std::string& err);

    std::string path_;
    int64_t rev_ = 0;
    std::map<std::string, std::vector<StoredRecipe>> types_;
};

}  // namespace mat::recipe
