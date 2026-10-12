#include "core/tag-engine/calc_graph.hpp"

#include <algorithm>
#include <map>
#include <set>

namespace mat {

namespace {

constexpr size_t kNone = static_cast<size_t>(-1);

// Tarjan on `nodes`, edges i -> deps[i].
std::vector<std::vector<size_t>> stronglyConnected(const std::vector<size_t>& nodes,
                                                   const std::vector<std::vector<size_t>>& deps) {
    std::set<size_t> inSet(nodes.begin(), nodes.end());
    std::map<size_t, size_t> idx, low;
    std::set<size_t> onStack;
    std::vector<size_t> stack;
    std::vector<std::vector<size_t>> out;
    size_t counter = 0;
    // The graphs are small (<= 500 nodes) and the depth is bounded by that, so plain recursion is
    // fine.
    struct Visit {
        const std::vector<std::vector<size_t>>& deps;
        const std::set<size_t>& inSet;
        std::map<size_t, size_t>& idx;
        std::map<size_t, size_t>& low;
        std::set<size_t>& onStack;
        std::vector<size_t>& stack;
        std::vector<std::vector<size_t>>& out;
        size_t& counter;
        void run(size_t v) {
            idx[v] = low[v] = counter++;
            stack.push_back(v);
            onStack.insert(v);
            for (size_t w : deps[v]) {
                if (!inSet.count(w)) continue;
                if (!idx.count(w)) {
                    run(w);
                    low[v] = std::min(low[v], low[w]);
                } else if (onStack.count(w)) {
                    low[v] = std::min(low[v], idx[w]);
                }
            }
            if (low[v] == idx[v]) {
                std::vector<size_t> comp;
                for (;;) {
                    const size_t w = stack.back();
                    stack.pop_back();
                    onStack.erase(w);
                    comp.push_back(w);
                    if (w == v) break;
                }
                out.push_back(std::move(comp));
            }
        }
    } visit{deps, inSet, idx, low, onStack, stack, out, counter};
    for (size_t v : nodes)
        if (!idx.count(v)) visit.run(v);
    return out;
}

// Shortest cycle through `start` (BFS, ties by input order): start -> ... -> start.
std::vector<size_t> cyclePath(size_t start, const std::set<size_t>& members,
                              const std::vector<std::vector<size_t>>& deps) {
    std::map<size_t, size_t> prev;
    std::vector<size_t> queue;
    for (size_t j : deps[start]) {
        if (!members.count(j)) continue;
        if (j == start) return {start, start};
        if (!prev.count(j)) {
            prev[j] = start;
            queue.push_back(j);
        }
    }
    for (size_t q = 0; q < queue.size(); ++q) {
        const size_t v = queue[q];
        for (size_t w : deps[v]) {
            if (!members.count(w)) continue;
            if (w == start) {
                std::vector<size_t> path = {start, v};
                size_t u = v;
                while (prev[u] != start) {
                    u = prev[u];
                    path.insert(path.begin() + 1, u);
                }
                path.push_back(start);
                return path;
            }
            if (!prev.count(w)) {
                prev[w] = v;
                queue.push_back(w);
            }
        }
    }
    return {start, start};
}

}  // namespace

CalcGraph::CalcGraph(const std::vector<CalcInput>& calcs) : calcs_(calcs) {
    const size_t n = calcs_.size();
    for (size_t i = 0; i < n; ++i) index_.emplace(calcs_[i].id, i);
    std::vector<std::vector<size_t>> deps(n);
    users_.assign(n, {});
    for (size_t i = 0; i < n; ++i) {
        std::set<size_t> seen;
        for (const auto& id : calcs_[i].inputs) {
            auto it = index_.find(id);
            if (it != index_.end() && seen.insert(it->second).second) deps[i].push_back(it->second);
        }
    }
    for (size_t i = 0; i < n; ++i)
        for (size_t j : deps[i]) users_[j].push_back(i);

    // Kahn: ties by the smallest index.
    std::vector<size_t> indeg(n);
    for (size_t i = 0; i < n; ++i) indeg[i] = deps[i].size();
    std::vector<size_t> ready;
    for (size_t i = 0; i < n; ++i)
        if (indeg[i] == 0) ready.push_back(i);
    level_.assign(n, 0);
    while (!ready.empty()) {
        size_t k = 0;
        for (size_t q = 1; q < ready.size(); ++q)
            if (ready[q] < ready[k]) k = q;
        const size_t i = ready[k];
        ready.erase(ready.begin() + static_cast<long>(k));
        orderIdx_.push_back(i);
        int lv = 0;
        for (size_t j : deps[i]) lv = std::max(lv, level_[j]);
        level_[i] = 1 + lv;
        for (size_t u : users_[i])
            if (--indeg[u] == 0) ready.push_back(u);
    }

    std::set<size_t> inOrder(orderIdx_.begin(), orderIdx_.end());
    std::vector<size_t> cyclic;
    for (size_t i = 0; i < n; ++i)
        if (!inOrder.count(i)) cyclic.push_back(i);
    if (!cyclic.empty()) {
        std::map<size_t, std::vector<size_t>> byTag;  // member -> path of its cycle
        for (auto comp : stronglyConnected(cyclic, deps)) {
            const bool selfLoop = comp.size() == 1 &&
                                  std::find(deps[comp[0]].begin(), deps[comp[0]].end(), comp[0]) !=
                                      deps[comp[0]].end();
            if (comp.size() == 1 && !selfLoop) continue;
            std::sort(comp.begin(), comp.end());
            const std::set<size_t> members(comp.begin(), comp.end());
            const auto path = cyclePath(comp[0], members, deps);
            for (size_t m : comp) byTag[m] = path;
        }
        for (const auto& [i, path] : byTag) {
            GraphIssue g;
            g.code = "E_EXPR_CYCLE";
            g.id = calcs_[i].id;
            std::string msg = "circular reference: ";
            for (size_t k = 0; k < path.size(); ++k) {
                g.cycle.push_back(calcs_[path[k]].id);
                msg += (k ? " -> " : "") + calcs_[path[k]].id;
            }
            g.message = msg;
            issues_.push_back(std::move(g));
        }
    }
    for (size_t i : orderIdx_) {
        if (level_[i] > kMaxChainDepth) {
            GraphIssue g;
            g.code = "E_EXPR_DEPTH";
            g.id = calcs_[i].id;
            g.message = "dependency chain has " + std::to_string(level_[i]) + " levels (max " +
                        std::to_string(kMaxChainDepth) + ")";
            issues_.push_back(std::move(g));
        }
    }
    pos_.assign(n, kNone);
    for (size_t p = 0; p < orderIdx_.size(); ++p) {
        pos_[orderIdx_[p]] = p;
        order_.push_back(calcs_[orderIdx_[p]].id);
    }
}

int CalcGraph::level(const std::string& id) const {
    auto it = index_.find(id);
    if (it == index_.end() || pos_[it->second] == kNone) return 0;
    return level_[it->second];
}

std::vector<size_t> CalcGraph::downstreamIndex(const std::string& id) const {
    std::vector<size_t> stack;
    for (size_t i = 0; i < calcs_.size(); ++i)
        if (std::find(calcs_[i].inputs.begin(), calcs_[i].inputs.end(), id) !=
            calcs_[i].inputs.end())
            stack.push_back(i);
    std::set<size_t> seen;
    while (!stack.empty()) {
        const size_t i = stack.back();
        stack.pop_back();
        if (!seen.insert(i).second) continue;
        for (size_t u : users_[i]) stack.push_back(u);
    }
    std::vector<size_t> out;
    for (size_t i : seen)
        if (pos_[i] != kNone) out.push_back(i);
    std::sort(out.begin(), out.end(), [&](size_t a, size_t b) { return pos_[a] < pos_[b]; });
    return out;
}

std::vector<std::string> CalcGraph::downstream(const std::string& id) const {
    std::vector<std::string> out;
    for (size_t i : downstreamIndex(id)) out.push_back(calcs_[i].id);
    return out;
}

}  // namespace mat
