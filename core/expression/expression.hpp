// Expression language of calculated Tags (ADR-015, contracts/expression-language.md) and value
// tables (contracts/value-tables-simulation.md §1). Same grammar and semantics as
// packages/expression (TypeScript); both run the shared vectors in tests/expression-vectors and
// tests/value-table-vectors. Built with -ffp-contract=off; no std::round, no std::sin.
// Pure code: no I/O, no threads. Spans count Unicode code points, as in the TS version.
#pragma once
#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "core/tag-engine/tag_store.hpp"  // TagType, Quality, TagScalar (types only)

namespace mat::expr {

struct Issue {
    std::string code;
    size_t s = 0;  // [s, e) in code points of the expression text
    size_t e = 0;
    std::string message;
};

struct CompileEnv {
    // nullopt: no such Tag.
    std::function<std::optional<TagType>(const std::string&)> tagType;
    std::function<bool(const std::string&)> hasTable;
    TagType target = TagType::FLOAT64;  // type of the calculated Tag receiving the result
};

using ConstValue = std::variant<double, std::string>;

struct Program {
    std::vector<int32_t> ops;
    std::vector<ConstValue> consts;
    std::vector<std::string> inputs;  // Tag ids, first appearance order (index used by evaluate)
    std::vector<std::string> tables;  // names used by text()
    TagType target = TagType::FLOAT64;
    int maxStack = 0;
};

struct CompileResult {
    bool ok = false;
    Program program;
    std::vector<Issue> warnings;  // when ok
    std::vector<Issue> errors;    // when !ok (one: the first error)
};

CompileResult compile(const std::string& src, const CompileEnv& env);

struct InputValue {
    TagScalar value;  // monostate: no value
    Quality quality = Quality::BAD;
    std::string reason;
};

struct EvalResult {
    Quality quality = Quality::BAD;
    std::string reason;  // when quality is not GOOD
    TagScalar value;     // monostate when BAD (the Tag keeps its last value)
};

// ---- value tables -------------------------------------------------------------------------

struct VtEntry {
    std::optional<double> value;  // BOOL true/false is 1/0
    std::optional<double> from;
    std::optional<double> to;
    std::string text;
    std::optional<std::string> color;
};

struct ValueTable {
    std::string name;
    std::vector<VtEntry> entries;
    bool hasDefault = false;
    std::optional<std::string> defaultText;
    std::optional<std::string> defaultColor;
};

constexpr int kEntryNone = -1;
constexpr int kEntryDefault = -2;

struct LookupResult {
    std::string text;
    std::optional<std::string> color;
    int entry = kEntryNone;  // entry index, kEntryDefault or kEntryNone
};

struct VtIssue {
    std::string code;  // E_SCHEMA, E_VT_RANGE, E_VT_TEXT, E_VT_OVERLAP
    std::string message;
    int entry = 0;  // entry index, -1 for `default`
};

constexpr size_t kVtMaxEntries = 256;
constexpr size_t kVtMaxText = 64;

LookupResult lookupValueTable(const ValueTable& t, double x);
std::vector<VtIssue> validateValueTable(const ValueTable& t);

using TableSet = std::map<std::string, ValueTable>;

EvalResult evaluate(const Program& p, const std::function<InputValue(size_t)>& input,
                    const TableSet& tables);

// ---- numbers (shared with the Tag Engine) -------------------------------------------------

// Half away from zero; x - trunc(x) is exact for every double.
double roundHalfAway(double x);

// Result of a number/bool/string assigned to a Tag of `target` (contract §3 table).
struct Assigned {
    bool ok = false;
    TagScalar value;
    std::string reason;
};
Assigned assignNumber(TagType target, double x);  // x already a number (bool as 1/0)
Assigned assignBool(TagType target, bool b);
Assigned assignString(TagType target, const std::string& s);

constexpr size_t kMaxChars = 1000;
constexpr size_t kMaxBytes = 4096;
constexpr size_t kMaxInputs = 32;
constexpr int kMaxStack = 64;
constexpr size_t kMaxStringBytes = 1024;

}  // namespace mat::expr
