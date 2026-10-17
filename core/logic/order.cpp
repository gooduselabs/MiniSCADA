#include "core/logic/order.hpp"

#include <algorithm>
#include <deque>
#include <functional>
#include <queue>
#include <set>

#include "core/expression/expression.hpp"
#include "core/logic/types.hpp"

namespace mat::logic {

using nlohmann::json;

namespace {

bool numericScalar(const TagScalar& v, double& out) {
    if (const double* d = std::get_if<double>(&v)) {
        out = *d;
        return true;
    }
    if (const int64_t* i = std::get_if<int64_t>(&v)) {
        out = static_cast<double>(*i);
        return true;
    }
    if (const uint64_t* u = std::get_if<uint64_t>(&v)) {
        out = static_cast<double>(*u);
        return true;
    }
    return false;
}

}  // namespace

TagScalar scalarOfJson(const nlohmann::json& v) {
    if (v.is_boolean()) return v.get<bool>();
    if (v.is_string()) return v.get<std::string>();
    if (v.is_number()) return v.get<double>();
    return {};
}

bool logicAllowed(const nlohmann::json& allowed, const TagScalar& v) {
    if (!allowed.is_object()) return false;
    double x = 0;
    const bool isNum = numericScalar(v, x);
    if (const auto it = allowed.find("values"); it != allowed.end()) {
        if (!it->is_array()) return false;
        for (const auto& a : *it) {
            if (a.is_boolean()) {
                const bool* b = std::get_if<bool>(&v);
                if (b && *b == a.get<bool>()) return true;
            } else if (a.is_string()) {
                const std::string* s = std::get_if<std::string>(&v);
                if (s && *s == a.get<std::string>()) return true;
            } else if (a.is_number()) {
                if (isNum && x == a.get<double>()) return true;
            }
        }
        return false;
    }
    const auto mn = allowed.find("min");
    const auto mx = allowed.find("max");
    if (!isNum || mn == allowed.end() || mx == allowed.end() || !mn->is_number() ||
        !mx->is_number())
        return false;
    return x >= mn->get<double>() && x <= mx->get<double>();
}

const char* const kBlockKinds[6] = {"rules",      "timers",   "counters",
                                    "totalizers", "runhours", "schedules"};

std::vector<const json*> blocksOf(const json& doc, const std::string& kind) {
    std::vector<const json*> out;
    if (!doc.is_object()) return out;
    const auto it = doc.find(kind);
    if (it == doc.end() || !it->is_array()) return out;
    for (const json& b : *it)
        if (b.is_object()) out.push_back(&b);
    return out;
}

std::string blockId(const json& block) {
    const auto it = block.find("id");
    return it != block.end() && it->is_string() ? it->get<std::string>() : std::string();
}

const std::vector<std::pair<std::string, TagType>>& outputFields(const std::string& kind) {
    static const std::map<std::string, std::vector<std::pair<std::string, TagType>>> kFields = {
        {"timers", {{"q", TagType::BOOL}, {"et", TagType::INT64}}},
        {"counters", {{"value", TagType::INT64}, {"reached", TagType::BOOL}}},
        {"totalizers", {{"total", TagType::FLOAT64}, {"gapSeconds", TagType::FLOAT64}}},
        {"runhours",
         {{"hours", TagType::FLOAT64}, {"starts", TagType::INT64}, {"due", TagType::BOOL}}},
        {"schedules", {{"out", TagType::BOOL}}},
    };
    static const std::vector<std::pair<std::string, TagType>> kNone;
    const auto it = kFields.find(kind);
    return it == kFields.end() ? kNone : it->second;
}

std::vector<LogicOutput> logicOutputs(const json& doc) {
    std::vector<LogicOutput> out;
    for (const char* kind : kBlockKinds)
        for (const json* b : blocksOf(doc, kind))
            for (const auto& [field, type] : outputFields(kind)) {
                const auto it = b->find(field);
                if (it != b->end() && it->is_string())
                    out.push_back({it->get<std::string>(), type, blockId(*b), field});
            }
    return out;
}

std::vector<ExprField> logicExpressions(const std::string& kind, const json& block) {
    static const std::map<std::string, std::vector<std::pair<std::string, TagType>>> kFields = {
        {"rules", {{"when", TagType::BOOL}}},
        {"timers", {{"in", TagType::BOOL}}},
        {"counters", {{"up", TagType::BOOL}, {"down", TagType::BOOL}, {"reset", TagType::BOOL}}},
        {"totalizers", {{"source", TagType::FLOAT64}, {"reset", TagType::BOOL}}},
        {"runhours", {{"run", TagType::BOOL}, {"reset", TagType::BOOL}}},
    };
    std::vector<ExprField> out;
    const auto k = kFields.find(kind);
    if (k == kFields.end()) return out;
    for (const auto& [f, t] : k->second) {
        const auto it = block.find(f);
        if (it != block.end() && it->is_string()) out.push_back({f, it->get<std::string>(), t});
    }
    return out;
}

std::vector<std::string> exprRefs(const std::string& src, TagType target, const LogicEnv& env) {
    expr::CompileEnv ce;
    ce.tagType = env.tagType;
    ce.hasTable = env.hasTable;
    ce.target = target;
    const expr::CompileResult r = expr::compile(src, ce);
    return r.ok ? r.program.inputs : std::vector<std::string>{};
}

LogicGraph logicGraph(const json& doc, const LogicEnv& env,
                      const std::map<std::string, LogicOutput>& outs) {
    LogicGraph g;
    std::vector<std::string> ids;
    for (const char* kind : kBlockKinds)
        for (const json* b : blocksOf(doc, kind)) {
            const std::string id = blockId(*b);
            if (g.deps.count(id)) continue;
            ids.push_back(id);
            std::set<std::string> d;
            for (const ExprField& e : logicExpressions(kind, *b))
                for (const std::string& ref : exprRefs(e.src, e.target, env)) {
                    const auto o = outs.find(ref);
                    if (o != outs.end()) d.insert(o->second.block);
                }
            g.deps[id] = std::vector<std::string>(d.begin(), d.end());
        }
    // Kahn
    std::map<std::string, std::vector<std::string>> users;
    std::map<std::string, size_t> missing;
    for (const std::string& id : ids) users[id];
    for (const std::string& id : ids) {
        const auto& d = g.deps[id];
        missing[id] = d.size();
        for (const std::string& x : d) {
            const auto u = users.find(x);
            if (u != users.end()) u->second.push_back(id);
        }
    }
    // the smallest ready id first: a min-heap (T062: no sort of the whole list at every step)
    std::priority_queue<std::string, std::vector<std::string>, std::greater<std::string>> ready;
    for (const std::string& id : ids)
        if (missing[id] == 0) ready.push(id);
    while (!ready.empty()) {
        const std::string id = ready.top();
        ready.pop();
        g.order.push_back(id);
        for (const std::string& u : users[id])
            if (--missing[u] == 0) ready.push(u);
    }
    // Tarjan, only to report the cycles; iterative (T062: a long chain needs no deep stack)
    std::map<std::string, int> index, low;
    std::vector<std::string> stack;
    std::set<std::string> onStack;
    int next = 0;
    struct Frame {
        std::string v;
        size_t edge = 0;
    };
    const auto visit = [&](const std::string& root) {
        std::vector<Frame> call;
        const auto enter = [&](const std::string& v) {
            index[v] = next;
            low[v] = next;
            ++next;
            stack.push_back(v);
            onStack.insert(v);
            call.push_back({v, 0});
        };
        enter(root);
        while (!call.empty()) {
            Frame& f = call.back();
            const std::vector<std::string>& dv = g.deps[f.v];
            if (f.edge < dv.size()) {
                const std::string& w = dv[f.edge++];
                if (!index.count(w)) {
                    enter(w);  // `f` may dangle from here on
                } else if (onStack.count(w)) {
                    low[f.v] = std::min(low[f.v], index[w]);
                }
                continue;
            }
            const std::string v = f.v;
            call.pop_back();
            if (!call.empty()) {
                const std::string& parent = call.back().v;
                low[parent] = std::min(low[parent], low[v]);
            }
            if (low[v] == index[v]) {
                std::vector<std::string> comp;
                std::string w;
                do {
                    w = stack.back();
                    stack.pop_back();
                    onStack.erase(w);
                    comp.push_back(w);
                } while (w != v);
                if (comp.size() > 1 || std::find(dv.begin(), dv.end(), v) != dv.end()) {
                    std::sort(comp.begin(), comp.end());
                    g.cycles.push_back(std::move(comp));
                }
            }
        }
    };
    std::vector<std::string> sorted = ids;
    std::sort(sorted.begin(), sorted.end());
    for (const std::string& id : sorted)
        if (!index.count(id)) visit(id);
    std::stable_sort(g.cycles.begin(), g.cycles.end(),
                     [](const auto& a, const auto& b) { return a[0] < b[0]; });
    return g;
}

std::optional<TagType> tagTypeOf(const std::string& n) {
    static const std::map<std::string, TagType> kTypes = {
        {"BOOL", TagType::BOOL},     {"INT16", TagType::INT16},     {"UINT16", TagType::UINT16},
        {"INT32", TagType::INT32},   {"UINT32", TagType::UINT32},   {"INT64", TagType::INT64},
        {"UINT64", TagType::UINT64}, {"FLOAT32", TagType::FLOAT32}, {"FLOAT64", TagType::FLOAT64},
        {"STRING", TagType::STRING}};
    const auto it = kTypes.find(n);
    if (it == kTypes.end()) return std::nullopt;
    return it->second;
}

}  // namespace mat::logic
