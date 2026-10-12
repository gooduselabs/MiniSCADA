// Dependency graph of the calculated Tags (T030/T031): deterministic topological order, cycles,
// depth, downstream lists. Same algorithm and order as packages/expression graph.ts, so both give
// the same result. Pure code (no link dependency: only the standard library).
#pragma once
#include <string>
#include <unordered_map>
#include <vector>

namespace mat {

constexpr int kMaxChainDepth = 16;

struct CalcInput {
    std::string id;  // calculated Tag, in tags.json order
    std::vector<std::string>
        inputs;  // input Tag ids in order of appearance; non-calculated ones are ignored
};

struct GraphIssue {
    std::string code;  // E_EXPR_CYCLE | E_EXPR_DEPTH
    std::string id;    // the Tag at fault
    std::string message;
    std::vector<std::string> cycle;  // E_EXPR_CYCLE: A, B, A
};

class CalcGraph {
   public:
    explicit CalcGraph(const std::vector<CalcInput>& calcs);

    // Calculation order (Kahn; ties go in tags.json order). Tags in a cycle are not in it.
    const std::vector<std::string>& order() const { return order_; }
    // Positions into the `calcs` vector given to the constructor, in calculation order.
    const std::vector<size_t>& orderIndex() const { return orderIdx_; }
    // Level of each Tag in the order (1: depends on no calculated Tag).
    int level(const std::string& id) const;
    const std::vector<GraphIssue>& issues() const { return issues_; }
    // Every calculated Tag that depends, directly or not, on `id`, in calculation order.
    // `id` may be any Tag. Unknown ids give an empty list.
    std::vector<std::string> downstream(const std::string& id) const;
    // Same by position in `calcs` of the calculated Tags (for the engine): positions, calculation
    // order.
    std::vector<size_t> downstreamIndex(const std::string& id) const;

   private:
    std::vector<CalcInput> calcs_;
    std::vector<std::vector<size_t>> users_;  // users_[i]: calculated Tags that read calc i
    std::vector<size_t> orderIdx_;
    std::vector<std::string> order_;
    std::vector<int> level_;
    std::vector<size_t> pos_;  // position in the order, or npos
    std::vector<GraphIssue> issues_;
    std::unordered_map<std::string, size_t> index_;
};

}  // namespace mat
