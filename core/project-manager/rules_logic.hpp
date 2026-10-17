// Rules of logic.json (feature 011, T135; FR-073, FR-075, FR-079, FR-093;
// contracts/logic-engine.md §1-§11): the C++ twin of packages/project-schema/src/rules-logic.ts.
// The same set of codes on tests/logic-vectors (every case's `expectErrors`, `expectWarnings`), in
// the same order of checks:
//  0. `schemaVersion` not 1.0.x: E_LOGIC_VERSION and stop.
//  1. File > 512 KiB, entries per array above the limits: E_LOGIC_LIMIT.
//  2. Ids of every entry (writes and blocks share one space): E_LOGIC_ID.
//  3. Output Tags: Tag id form (E_LOGIC_ID), collision with tags.json or an earlier output
//     (E_LOGIC_TAG_COLLISION). A valid output becomes a logic Tag usable in the expressions.
//  4. writes: E_LOGIC_TAG_REF, E_LOGIC_WRITE_TARGET, E_LOGIC_WRITE_VALUE, E_LOGIC_LIMIT.
//  5. Each block: expressions, parameter ranges, the actions of the rules.
//  6. The block graph: E_LOGIC_CYCLE per strongly connected component with a cycle,
//     E_LOGIC_SELF_TRIGGER.
//  7. Warnings: W_LOGIC_PT_ROUNDED, W_LOGIC_DISABLED, W_LOGIC_NO_HOLD, W_LOGIC_WRITE_CONFLICT,
//     W_LOGIC_RETAIN_IO, W_LOGIC_WRITES_OFF.
#pragma once
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "core/logic/types.hpp"
#include "core/project-manager/project_validator.hpp"
#include "nlohmann/json.hpp"

namespace mat {

struct LogicCheckOptions {
    const logic::TagInfoMap* tags = nullptr;  // Tags of tags.json (required)
    std::string file = "logic.json";
    std::optional<size_t> bytes;                       // size of logic.json when known
    std::function<bool(const std::string&)> hasTable;  // empty: no table
    int scanMs = 100;
    int flushS = 60;
    std::optional<std::string> deviceWrites;  // "on" | "off" of the target device; none: unchecked
};

struct LogicCheck {
    std::vector<ProjectIssue> errors;
    std::vector<ProjectIssue> warnings;
};

LogicCheck checkLogic(const nlohmann::json& doc, const LogicCheckOptions& options);

// Tag id of 006 (schema pattern, at most 64 bytes, not `true` / `false`).
bool isValidLogicTagId(const std::string& id);

// Tag id -> info, from the `tags` of tags.json (the first one of a duplicated id).
logic::TagInfoMap logicTagsFromList(const nlohmann::json& tagsDoc);

// The logic Tags declared as internal read-only Tags (contract §1): every output of the right form,
// not a Tag of tags.json, not an earlier output; as tags.json entries
// {"id", "kind": "internal", "type", "access": "R"} (the 1.0 checker appends them to the Tags).
nlohmann::json logicTagDefs(const nlohmann::json& doc, const logic::TagInfoMap& tags);

}  // namespace mat
