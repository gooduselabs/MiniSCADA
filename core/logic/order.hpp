// Outputs and scan order of logic.json (contracts/logic-engine.md §1, §10): the C++ twin of
// logicOutputs / logicGraph of packages/project-schema/src/rules-logic.ts, shared by the validator
// (E_LOGIC_CYCLE, E_LOGIC_SELF_TRIGGER) and the engine. A stable topological sort (Kahn, the
// smallest id first among the ready blocks, ASCII byte order) over the graph A -> B when an
// expression of B reads an output of A; the strongly connected components with a cycle (Tarjan).
// An expression that does not compile adds no edge.
#pragma once
#include <functional>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include "core/tag-engine/tag_store.hpp"
#include "nlohmann/json.hpp"

namespace mat::logic {

// The block kinds in the order of the checks and of the outputs.
extern const char* const kBlockKinds[6];  // rules timers counters totalizers runhours schedules

struct LogicOutput {
    std::string tag;
    TagType type = TagType::BOOL;
    std::string block;
    std::string field;
};

struct ExprField {
    std::string field;
    std::string src;
    TagType target = TagType::BOOL;
};

// The compile environment of logic expressions: types of tags.json and of the logic Tags.
struct LogicEnv {
    std::function<std::optional<TagType>(const std::string&)> tagType;
    std::function<bool(const std::string&)> hasTable;
};

// The objects of doc[kind] (an absent or non-array member: none).
std::vector<const nlohmann::json*> blocksOf(const nlohmann::json& doc, const std::string& kind);
// The id of a block as text ("" when it is not a string).
std::string blockId(const nlohmann::json& block);
// Every output declared, by kind, block, field (also the malformed and duplicated ones).
std::vector<LogicOutput> logicOutputs(const nlohmann::json& doc);
// The output fields of a kind: [field, type].
const std::vector<std::pair<std::string, TagType>>& outputFields(const std::string& kind);
// The expression inputs of a block: [field, source, target type] of the fields that are strings.
std::vector<ExprField> logicExpressions(const std::string& kind, const nlohmann::json& block);
// Tag inputs of an expression (empty when it does not compile).
std::vector<std::string> exprRefs(const std::string& src, TagType target, const LogicEnv& env);

// Whether `v` is in the `allowed` of a `writes` entry (same kind; numbers compared as doubles).
bool logicAllowed(const nlohmann::json& allowed, const TagScalar& v);
// A JSON constant as the engine holds it: bool, string, number as double; monostate otherwise.
TagScalar scalarOfJson(const nlohmann::json& v);

struct LogicGraph {
    std::vector<std::string> order;                        // blocks not in or behind a cycle
    std::vector<std::vector<std::string>> cycles;          // each sorted, sorted by first id
    std::map<std::string, std::vector<std::string>> deps;  // block -> blocks it reads (sorted)
};
LogicGraph logicGraph(const nlohmann::json& doc, const LogicEnv& env,
                      const std::map<std::string, LogicOutput>& outs);

}  // namespace mat::logic
