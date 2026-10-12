// Checked syntax tree -> stack machine bytecode. && || ?: become jumps: lazy evaluation.
#include <cstring>

#include "core/expression/internal.hpp"

namespace mat::expr::detail {

namespace {

class Gen {
   public:
    Gen(const std::vector<std::string>& inputs, const std::function<int(const std::string&)>& kind)
        : inputs_(inputs), kind_(kind) {}
    Program prog;

    void gen(const Node& n) {
        auto& ops = prog.ops;
        switch (n.t) {
            case NT::Num:
                ops.push_back(PUSH_NUM);
                ops.push_back(numConst(n.v));
                return;
            case NT::Bool:
                ops.push_back(PUSH_BOOL);
                ops.push_back(n.b ? 1 : 0);
                return;
            case NT::Str:
                ops.push_back(PUSH_STR);
                ops.push_back(strConst(n.str));
                return;
            case NT::Tag: {
                size_t idx = 0;
                while (idx < inputs_.size() && inputs_[idx] != n.str) ++idx;
                ops.push_back(LOAD);
                ops.push_back(static_cast<int32_t>(idx));
                ops.push_back(kind_(n.str));
                return;
            }
            case NT::Paren:
                gen(*n.k[0]);
                return;
            case NT::Un:
                if (n.str == "-") {
                    asNumber(*n.k[0]);
                    ops.push_back(NEG);
                } else {
                    gen(*n.k[0]);
                    ops.push_back(NOT);
                }
                return;
            case NT::Bin: {
                const std::string& op = n.str;
                if (op == "&&" || op == "||") {
                    gen(*n.k[0]);
                    ops.push_back(op == "&&" ? JF_KEEP : JT_KEEP);
                    ops.push_back(0);
                    const size_t hole = ops.size() - 1;
                    ops.push_back(POP);
                    gen(*n.k[1]);
                    ops[hole] = static_cast<int32_t>(ops.size());
                    return;
                }
                if (op == "==" || op == "!=") {
                    if (n.k[0]->ty == ExprType::String) {
                        gen(*n.k[0]);
                        gen(*n.k[1]);
                        ops.push_back(op == "==" ? EQS : NES);
                    } else {
                        asNumber(*n.k[0]);
                        asNumber(*n.k[1]);
                        ops.push_back(op == "==" ? EQN : NEN);
                    }
                    return;
                }
                asNumber(*n.k[0]);
                asNumber(*n.k[1]);
                ops.push_back(binop(op));
                return;
            }
            case NT::Cond: {
                gen(*n.k[0]);
                ops.push_back(JF);
                ops.push_back(0);
                const size_t holeElse = ops.size() - 1;
                gen(*n.k[1]);
                if (n.ty == ExprType::Number && n.k[1]->ty == ExprType::Bool) ops.push_back(TONUM);
                ops.push_back(JMP);
                ops.push_back(0);
                const size_t holeEnd = ops.size() - 1;
                ops[holeElse] = static_cast<int32_t>(ops.size());
                gen(*n.k[2]);
                if (n.ty == ExprType::Number && n.k[2]->ty == ExprType::Bool) ops.push_back(TONUM);
                ops[holeEnd] = static_cast<int32_t>(ops.size());
                return;
            }
            case NT::Call: {
                if (n.str == "text") {
                    asNumber(*n.k[0]);
                    const std::string& name = n.k[1]->str;
                    size_t ti = 0;
                    while (ti < prog.tables.size() && prog.tables[ti] != name) ++ti;
                    if (ti == prog.tables.size()) prog.tables.push_back(name);
                    ops.push_back(TEXT);
                    ops.push_back(static_cast<int32_t>(ti));
                    return;
                }
                if (n.str == "round") {
                    asNumber(*n.k[0]);
                    if (n.k.size() == 1) {
                        ops.push_back(ROUND);
                    } else {
                        ops.push_back(ROUNDN);
                        ops.push_back(static_cast<int32_t>(n.k[1]->v));
                    }
                    return;
                }
                for (const auto& a : n.k) asNumber(*a);
                if (n.str == "min") {
                    ops.push_back(MIN);
                    ops.push_back(static_cast<int32_t>(n.k.size()));
                } else if (n.str == "max") {
                    ops.push_back(MAX);
                    ops.push_back(static_cast<int32_t>(n.k.size()));
                } else if (n.str == "abs") {
                    ops.push_back(ABS);
                } else {
                    ops.push_back(CLAMP);
                }
                return;
            }
        }
    }

   private:
    void asNumber(const Node& n) {
        gen(n);
        if (n.ty == ExprType::Bool) prog.ops.push_back(TONUM);
    }
    static int32_t binop(const std::string& op) {
        if (op == "+") return ADD;
        if (op == "-") return SUB;
        if (op == "*") return MUL;
        if (op == "/") return DIV;
        if (op == "%") return MOD;
        if (op == "<") return LT;
        if (op == "<=") return LE;
        if (op == ">") return GT;
        return GE;
    }
    int32_t numConst(double v) {
        for (size_t i = 0; i < prog.consts.size(); ++i)
            if (const double* d = std::get_if<double>(&prog.consts[i]))
                if (std::memcmp(d, &v, sizeof v) == 0) return static_cast<int32_t>(i);
        prog.consts.emplace_back(v);
        return static_cast<int32_t>(prog.consts.size() - 1);
    }
    int32_t strConst(const std::string& s) {
        for (size_t i = 0; i < prog.consts.size(); ++i)
            if (const std::string* p = std::get_if<std::string>(&prog.consts[i]))
                if (*p == s) return static_cast<int32_t>(i);
        prog.consts.emplace_back(s);
        return static_cast<int32_t>(prog.consts.size() - 1);
    }
    const std::vector<std::string>& inputs_;
    const std::function<int(const std::string&)>& kind_;
};

}  // namespace

Program compileNode(const Node& root, const std::vector<std::string>& inputs, TagType target,
                    const std::function<int(const std::string&)>& tagKind) {
    Gen g(inputs, tagKind);
    g.gen(root);
    g.prog.inputs = inputs;
    g.prog.target = target;
    g.prog.maxStack = stackDepth(root);
    return std::move(g.prog);
}

}  // namespace mat::expr::detail
