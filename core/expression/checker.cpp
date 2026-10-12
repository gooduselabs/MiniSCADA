// Names, arity, types and limits (contracts/expression-language.md §3, §6, §7). The first error by
// order: syntax (parser) -> names -> arity -> types -> limits.
#include <algorithm>
#include <cmath>
#include <set>

#include "core/expression/internal.hpp"

namespace mat::expr::detail {

namespace {

struct FuncArity {
    const char* name;
    size_t lo, hi;
};
constexpr FuncArity kFuncs[] = {{"min", 2, 16},  {"max", 2, 16},  {"abs", 1, 1},
                                {"round", 1, 2}, {"clamp", 3, 3}, {"text", 2, 2}};

const FuncArity* findFunc(const std::string& name) {
    for (const auto& f : kFuncs)
        if (name == f.name) return &f;
    return nullptr;
}

bool isBareWord(const Node& n) { return n.t == NT::Tag && n.str.find('.') == std::string::npos; }

void preorder(const Node& n, std::vector<const Node*>& out) {
    out.push_back(&n);
    for (const auto& c : n.k) preorder(*c, out);
}

bool numOrBool(ExprType t) { return t == ExprType::Number || t == ExprType::Bool; }

class TypeChecker {
   public:
    explicit TypeChecker(const CompileEnv& env) : env_(env) {}
    std::optional<SpanIssue> err;

    ExprType ty(Node& n) {
        if (err) return ExprType::Number;
        switch (n.t) {
            case NT::Num:
                return n.ty = ExprType::Number;
            case NT::Bool:
                return n.ty = ExprType::Bool;
            case NT::Str:
                return n.ty = ExprType::String;
            case NT::Tag:
                return n.ty = kindOfTag(*env_.tagType(n.str));
            case NT::Paren:
                return n.ty = ty(*n.k[0]);
            case NT::Un: {
                const ExprType x = ty(*n.k[0]);
                if (err) return ExprType::Number;
                if (n.str == "-") {
                    if (!numOrBool(x)) typeErr(*n.k[0]);
                    return n.ty = ExprType::Number;
                }
                if (x != ExprType::Bool) typeErr(*n.k[0]);
                return n.ty = ExprType::Bool;
            }
            case NT::Bin: {
                const ExprType l = ty(*n.k[0]);
                if (err) return ExprType::Number;
                const ExprType r = ty(*n.k[1]);
                if (err) return ExprType::Number;
                const std::string& op = n.str;
                if (op == "+" || op == "-" || op == "*" || op == "/" || op == "%") {
                    if (!numOrBool(l))
                        typeErr(*n.k[0]);
                    else if (!numOrBool(r))
                        typeErr(*n.k[1]);
                    return n.ty = ExprType::Number;
                }
                if (op == "<" || op == "<=" || op == ">" || op == ">=") {
                    if (!numOrBool(l))
                        typeErr(*n.k[0]);
                    else if (!numOrBool(r))
                        typeErr(*n.k[1]);
                    return n.ty = ExprType::Bool;
                }
                if (op == "==" || op == "!=") {
                    if ((l == ExprType::String) != (r == ExprType::String)) typeErr(*n.k[1]);
                    return n.ty = ExprType::Bool;
                }
                if (l != ExprType::Bool)
                    typeErr(*n.k[0]);
                else if (r != ExprType::Bool)
                    typeErr(*n.k[1]);
                return n.ty = ExprType::Bool;
            }
            case NT::Cond: {
                const ExprType c = ty(*n.k[0]);
                if (err) return ExprType::Number;
                if (c != ExprType::Bool) {
                    typeErr(*n.k[0]);
                    return ExprType::Number;
                }
                const ExprType a = ty(*n.k[1]);
                if (err) return ExprType::Number;
                const ExprType b = ty(*n.k[2]);
                if (err) return ExprType::Number;
                if ((a == ExprType::String) != (b == ExprType::String)) {
                    typeErr(*n.k[2]);
                    return ExprType::Number;
                }
                return n.ty = (a == b ? a : ExprType::Number);
            }
            case NT::Call: {
                n.ty = n.str == "text" ? ExprType::String : ExprType::Number;
                if (n.str == "text") {
                    const ExprType x = ty(*n.k[0]);
                    if (err) return ExprType::String;
                    if (!numOrBool(x))
                        typeErr(*n.k[0]);
                    else if (!isBareWord(*n.k[1]))
                        typeErr(*n.k[1]);
                    return ExprType::String;
                }
                for (size_t i = 0; i < n.k.size(); ++i) {
                    Node& a = *n.k[i];
                    if (n.str == "round" && i == 1) {
                        const bool ok =
                            a.t == NT::Num && a.v == std::floor(a.v) && a.v >= 0 && a.v <= 9;
                        if (!ok) typeErr(a);
                        continue;
                    }
                    const ExprType x = ty(a);
                    if (err) return ExprType::Number;
                    if (!numOrBool(x)) typeErr(a);
                }
                return ExprType::Number;
            }
        }
        return ExprType::Number;
    }

   private:
    void typeErr(const Node& n) {
        if (!err) err = SpanIssue{"E_EXPR_TYPE", n.s, n.e};
    }
    const CompileEnv& env_;
};

}  // namespace

ExprType kindOfTag(TagType t) {
    if (t == TagType::BOOL) return ExprType::Bool;
    if (t == TagType::STRING) return ExprType::String;
    return ExprType::Number;
}

// Stack depth of the bytecode (fixed formula, contract §7).
int stackDepth(const Node& n) {
    switch (n.t) {
        case NT::Num:
        case NT::Bool:
        case NT::Str:
        case NT::Tag:
            return 1;
        case NT::Paren:
        case NT::Un:
            return stackDepth(*n.k[0]);
        case NT::Bin: {
            const int l = stackDepth(*n.k[0]);
            const int r = stackDepth(*n.k[1]);
            return (n.str == "&&" || n.str == "||") ? std::max(l, r) : std::max(l, 1 + r);
        }
        case NT::Cond:
            return std::max({stackDepth(*n.k[0]), stackDepth(*n.k[1]), stackDepth(*n.k[2])});
        case NT::Call: {
            if (n.str == "text") return stackDepth(*n.k[0]);
            int m = 0, pushed = 0;
            for (size_t i = 0; i < n.k.size(); ++i) {
                if (n.str == "round" && i == 1) continue;
                m = std::max(m, pushed + stackDepth(*n.k[i]));
                ++pushed;
            }
            return m;
        }
    }
    return 1;
}

CheckOut check(Node& root, const std::optional<SpanIssue>& limitIssue, size_t chars, size_t bytes,
               const CompileEnv& env) {
    CheckOut out;
    auto bad = [&](const char* code, size_t s, size_t e) {
        out.ok = false;
        out.error = SpanIssue{code, s, e};
        return out;
    };
    std::vector<const Node*> order;
    preorder(root, order);

    // 1) names
    std::set<const Node*> tableArgs;
    for (const Node* n : order)
        if (n->t == NT::Call && n->str == "text" && n->k.size() == 2 && isBareWord(*n->k[1]))
            tableArgs.insert(n->k[1].get());
    for (const Node* n : order) {
        if (n->t == NT::Call && !findFunc(n->str))
            return bad("E_EXPR_UNKNOWN_FUNC", n->nameS, n->nameE);
        if (n->t == NT::Tag) {
            if (tableArgs.count(n)) {
                if (!env.hasTable(n->str)) return bad("E_EXPR_UNKNOWN_TABLE", n->s, n->e);
            } else {
                if (!env.tagType(n->str)) return bad("E_EXPR_UNKNOWN_TAG", n->s, n->e);
                if (std::find(out.inputs.begin(), out.inputs.end(), n->str) == out.inputs.end())
                    out.inputs.push_back(n->str);
            }
        }
    }
    // 2) arity
    for (const Node* n : order) {
        if (n->t == NT::Call) {
            const FuncArity* f = findFunc(n->str);
            if (n->k.size() < f->lo || n->k.size() > f->hi) return bad("E_EXPR_ARITY", n->s, n->e);
        }
    }
    // 3) types
    TypeChecker tc(env);
    const ExprType rootType = tc.ty(root);
    if (tc.err) return bad(tc.err->code.c_str(), tc.err->s, tc.err->e);
    const TagType target = env.target;
    const bool okAssign =
        (target == TagType::BOOL && rootType == ExprType::Bool) ||
        (target == TagType::STRING && rootType == ExprType::String) ||
        (target != TagType::BOOL && target != TagType::STRING && numOrBool(rootType));
    if (!okAssign) return bad("E_EXPR_TYPE", root.s, root.e);
    // 4) limits
    if (chars > kMaxChars) return bad("E_EXPR_LIMIT", kMaxChars, kMaxChars + 1);
    if (bytes > kMaxBytes) return bad("E_EXPR_LIMIT", kMaxChars, kMaxChars + 1);
    if (limitIssue) return bad(limitIssue->code.c_str(), limitIssue->s, limitIssue->e);
    if (out.inputs.size() > kMaxInputs) {
        const std::string& id = out.inputs[kMaxInputs];
        for (const Node* n : order)
            if (n->t == NT::Tag && n->str == id) return bad("E_EXPR_LIMIT", n->s, n->e);
    }
    const int stack = stackDepth(root);
    if (stack > kMaxStack) return bad("E_EXPR_LIMIT", root.s, root.e);
    for (const auto& id : out.inputs) {
        const TagType t = *env.tagType(id);
        if (t == TagType::INT64 || t == TagType::UINT64) {
            out.warnings.push_back("W_EXPR_INT64");
            break;
        }
    }
    out.ok = true;
    out.stack = stack;
    return out;
}

}  // namespace mat::expr::detail
