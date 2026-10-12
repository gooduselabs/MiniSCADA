// Internal pieces of mat::expr: lexer, parser (AST), checker, compiler. Not for other modules.
#pragma once
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "core/expression/expression.hpp"

namespace mat::expr::detail {

using Cps = std::vector<char32_t>;
Cps decodeUtf8(const std::string& s);  // each invalid byte becomes U+FFFD
std::string encodeUtf8(char32_t c);

// ---- lexer ----
enum class TK { Num, Str, Word, Op, End, LexErr };
struct Tok {
    TK k = TK::End;
    size_t s = 0, e = 0;
    double v = 0;      // Num
    std::string text;  // Str (decoded), Word, Op
};
std::vector<Tok> lex(const Cps& cps);

// ---- AST ----
enum class NT { Num, Bool, Str, Tag, Paren, Un, Bin, Cond, Call };
enum class ExprType { Number, Bool, String };
struct Node;
using NodePtr = std::unique_ptr<Node>;
struct Node {
    NT t = NT::Num;
    size_t s = 0, e = 0;
    ExprType ty = ExprType::Number;
    double v = 0;                 // Num
    bool b = false;               // Bool
    std::string str;              // Str text, Tag id, Call name, operator of Un/Bin
    size_t nameS = 0, nameE = 0;  // Call: span of the name
    // Children: Paren/Un: [x]; Bin: [l, r]; Cond: [c, a, b]; Call: the arguments.
    std::vector<NodePtr> k;
};

struct SpanIssue {
    std::string code;
    size_t s = 0, e = 0;
};
struct ParseOut {
    NodePtr root;
    std::optional<SpanIssue> limitIssue;  // first nesting level 33
    std::optional<SpanIssue> error;
};
ParseOut parse(const Cps& cps);

// ---- checker ----
struct CheckOut {
    bool ok = false;
    SpanIssue error;
    std::vector<std::string> inputs;
    std::vector<std::string> warnings;
    int stack = 0;
};
CheckOut check(Node& root, const std::optional<SpanIssue>& limitIssue, size_t chars, size_t bytes,
               const CompileEnv& env);
int stackDepth(const Node& n);
ExprType kindOfTag(TagType t);

// ---- compiler ----
enum Op : int32_t {
    PUSH_NUM = 0,
    PUSH_STR = 1,
    PUSH_BOOL = 2,
    LOAD = 3,
    TONUM = 4,
    NEG = 5,
    NOT = 6,
    ADD = 7,
    SUB = 8,
    MUL = 9,
    DIV = 10,
    MOD = 11,
    LT = 12,
    LE = 13,
    GT = 14,
    GE = 15,
    EQN = 16,
    NEN = 17,
    EQS = 18,
    NES = 19,
    JF_KEEP = 20,
    JT_KEEP = 21,
    POP = 22,
    JF = 23,
    JMP = 24,
    MIN = 25,
    MAX = 26,
    ABS = 27,
    CLAMP = 28,
    ROUND = 29,
    ROUNDN = 30,
    TEXT = 31
};
Program compileNode(const Node& root, const std::vector<std::string>& inputs, TagType target,
                    const std::function<int(const std::string&)>& tagKind);

}  // namespace mat::expr::detail
