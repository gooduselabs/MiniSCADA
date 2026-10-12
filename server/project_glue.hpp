// What mat-runtime and the tests of the project routes put into the project store and the deploy
// pipeline (specs/005-device-online T108, T110; research R13): the verify-package and validate
// steps, the packer of the adoption of the project installed the old way, and the "operation"
// block of system/info. Small functions over mat_package and the project validator, so that
// core/project-store stays free of both (its steps are injected).
#pragma once
#include <functional>
#include <optional>
#include <string>

#include "core/package/manifest.hpp"
#include "core/project-manager/project_validator.hpp"
#include "core/project-store/boot_decision.hpp"
#include "core/project-store/deploy_pipeline.hpp"
#include "nlohmann/json.hpp"

namespace mat {

// Step verify-package: extractPackage (check and unpack in one pass) of req.packagePath into
// req.projectDir; the identity of the package on success, E_PKG_* / NO_SPACE / STORE_IO otherwise.
VerifyOutcome verifyPackageStep(const VerifyRequest& req, const PackageSchema& schema);

// Step validate: validateProject on the unpacked directory, the errors only (warnings never block).
// `serial`: the rule E_SERIAL_NOT_ALLOWED of the device (null: not run). A project that asks for a
// port out of `serialPorts` is refused when it is deployed, not when it is started.
ValidateOutcome validateStep(const std::string& projectDir, const std::string& schemasDir,
                             const SerialPolicy* serial = nullptr);

// Adoption: the project's files as a stored, deterministic package written to the descriptor
// (writeStoredPackage). `wallMs` gives createdAt (UTC ms).
PackFn storedPackFn(std::function<int64_t()> wallMs);

// The project of projectDir as the store sees it (FR-027): Valid with its files and identity;
// Empty when there is no project.json; Invalid otherwise, `reason` naming the first error.
LegacyProject legacyProjectOf(const ProjectValidation& validation, const std::string& dir);

// system/info "operation": {kind, step, since} of the operation running, or null.
nlohmann::json operationInfoJson(const std::optional<DeployOperation>& running);

}  // namespace mat
