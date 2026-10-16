// The runner of tests/logic-vectors (README there; the TS runner is
// packages/logic-engine/src/vectors.test.ts): the validator's set of codes, then the steps on a
// fake clock with every `expect` compared. Shared by vectors_test and the unit tests that run a
// case written inline in the same format.
#pragma once
#include <string>
#include <vector>

#include "nlohmann/json.hpp"

namespace mat::logic::test {

// The problems of one case (empty: the case passes).
std::vector<std::string> runCase(const nlohmann::json& c);

// Every case of every file of the directory, as {group, case}.
std::vector<std::pair<std::string, nlohmann::json>> loadVectors(const std::string& dir);

// ISO 8601 `YYYY-MM-DDTHH:MM:SS(.fff)?(Z|±HH:MM)` -> UTC ms; throws on another form.
int64_t parseWall(const std::string& s);

}  // namespace mat::logic::test
