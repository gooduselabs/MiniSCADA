// Omron FINS rules of format 1.1 (feature 018, spec FR-011), the C++ twin of
// packages/project-schema/src/rules-fins.ts: the address of a Tag on a FINS field device,
// `source.bcd`, the read and write limits in words; a `fins` channel and `source.bcd` need format
// 1.1 (E_CHANNEL_VERSION). The same codes and paths on tests/project-vectors (cases v11-fins-*,
// README-018.md).
#pragma once
#include <string>
#include <vector>

#include "core/project-manager/project_validator.hpp"
#include "nlohmann/json.hpp"

namespace mat {

constexpr int kFinsMaxWriteWords = 990;
constexpr int kFinsMaxReadWords = 999;

// An external Tag `tag` (at `/tags/<i>` = `p`) on the FINS field device `dev`: errors appended to
// `errors`. true when the address is valid (the common rules after it, W_DETECT_SLOW, still run).
bool finsSourceRules(const nlohmann::json& tag, const std::string& p, const nlohmann::json& dev,
                     const std::string& tagFile, std::vector<ProjectIssue>& errors);

// `source.bcd` of a Tag on a field device that is not a FINS one.
void bcdOutsideFins(const nlohmann::json& tag, const std::string& p, const std::string& tagFile,
                    std::vector<ProjectIssue>& errors);

// E_CHANNEL_VERSION: a `fins` channel or a `source.bcd` in a project below 1.1. `connections` and
// `tags` null when they did not load.
void finsVersionRules(const nlohmann::json& project, const nlohmann::json* connections,
                      const nlohmann::json* tags, std::vector<ProjectIssue>& errors);

}  // namespace mat
