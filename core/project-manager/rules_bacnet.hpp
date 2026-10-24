// BACnet/IP rules of format 1.1 (feature 020, spec FR-005 to FR-007, FR-011), the C++ twin of
// packages/project-schema/src/rules-bacnet.ts: the address of a Tag on a BACnet device (type,
// property, priority, access); a `bacnet` channel needs format 1.1 (E_CHANNEL_VERSION). The same
// codes and paths on tests/project-vectors (cases v11-bacnet-*, README-020.md).
#pragma once
#include <string>
#include <vector>

#include "core/project-manager/project_validator.hpp"
#include "nlohmann/json.hpp"

namespace mat {

// Defaults of a BACnet device (the driver, the model and W_DETECT_SLOW use the same).
constexpr double kBacnetTimeoutMs = 500;
constexpr double kBacnetRetries = 1;

// An external Tag `tag` (at `/tags/<i>` = `p`) on a BACnet device: errors appended to `errors`.
// true when the address is valid (W_DETECT_SLOW still runs after it).
bool bacnetSourceRules(const nlohmann::json& tag, const std::string& p, const std::string& tagFile,
                       std::vector<ProjectIssue>& errors);

// E_CHANNEL_VERSION: a `bacnet` channel in a project below 1.1. `connections` null when it did not
// load.
void bacnetVersionRules(const nlohmann::json& project, const nlohmann::json* connections,
                        std::vector<ProjectIssue>& errors);

}  // namespace mat
