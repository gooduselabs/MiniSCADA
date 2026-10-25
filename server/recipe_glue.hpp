// The recipe service in the runtime (feature 024, ADR-052): the writer over the tag write
// coordinator, the audit over audit.db, the current values from the TagStore.
#pragma once
#include <memory>
#include <string>

#include "core/audit/audit_log.hpp"
#include "core/project-manager/project_validator.hpp"
#include "core/recipe/recipe_service.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "core/tag-engine/write_coordinator.hpp"

namespace mat {

// recipe::Writer on the coordinator: the caller of the session (its role: writeMinRole; its own
// rate key "recipe:<user>"), the context screen "recipe-<type>" and widget the recipe id.
class CoordinatorRecipeWriter : public recipe::Writer {
   public:
    explicit CoordinatorRecipeWriter(WriteCoordinator& c) : c_(c) {}
    std::string newRequestId() override { return c_.makeRequestId(); }
    recipe::WriteStep submit(const recipe::Caller& who, const std::string& requestId,
                             const std::string& tag, const nlohmann::json& value,
                             const std::string& screen, const std::string& widget) override;
    recipe::WriteStep status(const recipe::Caller& who, const std::string& requestId) override;

   private:
    WriteCoordinator& c_;
};

// The AuditEvent of a recipe record (action recipe.*, channel web for a cookie, https otherwise).
AuditEvent recipeAuditEvent(const recipe::AuditRecord& r);

// A TagScalar as JSON (64-bit integers beyond 2^53 as decimal strings), null for none.
nlohmann::json recipeScalarJson(const TagScalar& v);

// The service of a running project with recipes (nullptr without `recipesFile`). `writer` may be
// null (no coordinator: downloads answer 503). The store is <dataDir>/recipes/<projectId>.json.
std::unique_ptr<recipe::Service> makeRecipeService(const LoadedProject& project,
                                                   const std::string& dataDir, TagStore& store,
                                                   AuditLog& audit, recipe::Writer* writer);

}  // namespace mat
