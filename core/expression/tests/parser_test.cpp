// Parser, checker, bytecode (mirror of packages/expression parser.test.ts): precedence and
// associativity, non-associative comparison, nesting counted by recursion depth, spans in code
// points, order of the first error, the lazy jumps.
#include <gtest/gtest.h>

#include <map>

#include "core/expression/expression.hpp"

using namespace mat;
using namespace mat::expr;

namespace {

CompileEnv envFor(TagType target = TagType::FLOAT64) {
    CompileEnv env;
    env.target = target;
    env.tagType = [](const std::string& id) -> std::optional<TagType> {
        static const std::map<std::string, TagType> tags = {{"A", TagType::FLOAT64},
                                                            {"B", TagType::FLOAT64},
                                                            {"C", TagType::FLOAT64},
                                                            {"T", TagType::BOOL},
                                                            {"F", TagType::BOOL},
                                                            {"S", TagType::STRING},
                                                            {"TANK01.LEVEL", TagType::FLOAT32}};
        auto it = tags.find(id);
        if (it == tags.end()) return std::nullopt;
        return it->second;
    };
    env.hasTable = [](const std::string& n) { return n == "Tbl"; };
    return env;
}

using Vals = std::map<std::string, TagScalar>;

EvalResult run(const std::string& src, const Vals& vals = {}, TagType target = TagType::FLOAT64) {
    const CompileResult r = compile(src, envFor(target));
    EXPECT_TRUE(r.ok) << src << (r.ok ? "" : " -> " + r.errors[0].code);
    if (!r.ok) return {};
    return evaluate(
        r.program,
        [&](size_t i) {
            InputValue iv;
            auto it = vals.find(r.program.inputs[i]);
            if (it != vals.end()) iv.value = it->second;
            iv.quality = Quality::GOOD;
            return iv;
        },
        TableSet{});
}

double num(const EvalResult& r) { return std::get<double>(r.value); }
bool bol(const EvalResult& r) { return std::get<bool>(r.value); }

struct Err {
    std::string code;
    size_t s = 0, e = 0;
};
Err err(const std::string& src, TagType target = TagType::FLOAT64) {
    const CompileResult r = compile(src, envFor(target));
    EXPECT_FALSE(r.ok) << src;
    if (r.ok) return {};
    return {r.errors[0].code, r.errors[0].s, r.errors[0].e};
}

std::string rep(const std::string& s, int n) {
    std::string o;
    for (int i = 0; i < n; ++i) o += s;
    return o;
}

}  // namespace

TEST(ExprParser, MultiplicationBindsTighterThanAddition) {
    EXPECT_EQ(num(run("1 + 2 * 3")), 7);
    EXPECT_EQ(num(run("2 * 3 + 4")), 10);
}

TEST(ExprParser, LeftAssociativeMinusAndDivide) {
    EXPECT_EQ(num(run("10 - 4 - 3")), 3);
    EXPECT_EQ(num(run("100 / 10 / 5")), 2);
    EXPECT_EQ(num(run("2 * 3 % 4")), 2);
}

TEST(ExprParser, UnaryBindsTighterThanBinary) {
    EXPECT_EQ(num(run("-2 * 3")), -6);
    EXPECT_FALSE(bol(run("!F && F", {{"F", false}}, TagType::BOOL)));
}

TEST(ExprParser, ComparisonBetweenArithmeticAndEquality) {
    EXPECT_TRUE(bol(run("1 + 1 < 3 == T", {{"T", true}}, TagType::BOOL)));
}

TEST(ExprParser, AndBindsTighterThanOr) {
    const Vals v = {{"T", true}, {"F", false}};
    EXPECT_TRUE(bol(run("T || F && F", v, TagType::BOOL)));
    EXPECT_FALSE(bol(run("(T || F) && F", v, TagType::BOOL)));
}

TEST(ExprParser, TernaryIsRightAssociativeAndLowest) {
    EXPECT_EQ(num(run("F ? 1 : F ? 2 : 3", {{"F", false}})), 3);
    EXPECT_EQ(num(run("T ? 1 : T ? 2 : 3", {{"T", true}})), 1);
    EXPECT_EQ(num(run("F || T ? 1 : 2", {{"F", false}, {"T", true}})), 1);
}

TEST(ExprParser, ComparisonAndEqualityAreNotAssociative) {
    EXPECT_EQ(err("A < B < C").code, "E_EXPR_SYNTAX");
    EXPECT_EQ(err("A == B == C").code, "E_EXPR_SYNTAX");
    EXPECT_EQ(err("A < B > C").code, "E_EXPR_SYNTAX");
    const Err e = err("A != B == C");
    EXPECT_EQ(e.s, 7u);
    EXPECT_EQ(e.e, 9u);
    EXPECT_TRUE(compile("(A < B) == (B < C)", envFor(TagType::BOOL)).ok);
}

TEST(ExprParser, NumberForms) {
    EXPECT_EQ(num(run("1.5e3")), 1500);
    EXPECT_EQ(num(run("2E-1")), 0.2);
    EXPECT_EQ(num(run("1e+2")), 100);
    for (const char* bad : {".5", "5.", "0x10", "1e400"})
        EXPECT_EQ(err(bad).code, "E_EXPR_SYNTAX") << bad;
}

TEST(ExprParser, BinaryChainsAreNotNesting) {
    EXPECT_TRUE(compile("T" + rep("&&T", 332), envFor(TagType::BOOL)).ok);
    const CompileResult r = compile("1" + rep("+1", 499), envFor());
    ASSERT_TRUE(r.ok);
    const EvalResult e = evaluate(
        r.program, [](size_t) { return InputValue{}; }, TableSet{});
    EXPECT_EQ(num(e), 500);
}

TEST(ExprParser, NestingLevels) {
    EXPECT_TRUE(compile(rep("(", 32) + "1" + rep(")", 32), envFor()).ok);
    Err e = err(rep("(", 33) + "1" + rep(")", 33));
    EXPECT_EQ(e.code, "E_EXPR_LIMIT");
    EXPECT_EQ(e.s, 32u);
    EXPECT_EQ(e.e, 33u);
    EXPECT_TRUE(compile(rep("-", 32) + "1", envFor()).ok);
    e = err(rep("!", 33) + "T", TagType::BOOL);
    EXPECT_EQ(e.code, "E_EXPR_LIMIT");
    EXPECT_EQ(e.s, 32u);
    EXPECT_TRUE(compile(rep("abs(", 32) + "1" + rep(")", 32), envFor()).ok);
    EXPECT_EQ(err(rep("abs(", 33) + "1" + rep(")", 33)).code, "E_EXPR_LIMIT");
    EXPECT_EQ(err(rep("T ? ", 33) + "1" + rep(" : 2", 33)).code, "E_EXPR_LIMIT");
}

TEST(ExprParser, VeryDeepExpressionDoesNotOverflowTheStack) {
    EXPECT_EQ(err(rep("(", 900) + "1" + rep(")", 900)).code, "E_EXPR_LIMIT");
    EXPECT_EQ(err(rep("-", 5000) + "1").code, "E_EXPR_LIMIT");
}

TEST(ExprParser, SpansAreInCodePoints) {
    Err e = err("\"\xF0\x9F\x98\x80\" + \xF0\x9F\x98\x80");  // "😀" + 😀
    EXPECT_EQ(e.code, "E_EXPR_SYNTAX");
    EXPECT_EQ(e.s, 6u);
    EXPECT_EQ(e.e, 7u);
    e = err("\"\xF0\x9F\x98\x80\xF0\x9F\x98\x80\" + 1", TagType::STRING);
    EXPECT_EQ(e.s, 0u);
    EXPECT_EQ(e.e, 4u);
    e = err("\"e\xCC\x81\" + 1");  // e + combining acute: two code points
    EXPECT_EQ(e.e, 4u);            // quote, e, U+0301, quote
    e = err("\"\xC3\xA9\" + 1");   // precomposed: one code point
    EXPECT_EQ(e.e, 3u);
}

TEST(ExprParser, EndOfInputIsTheEmptySpan) {
    Err e = err("(A + B");
    EXPECT_EQ(e.code, "E_EXPR_SYNTAX");
    EXPECT_EQ(e.s, 6u);
    EXPECT_EQ(e.e, 6u);
    e = err("");
    EXPECT_EQ(e.s, 0u);
    EXPECT_EQ(e.e, 0u);
}

TEST(ExprParser, ErrorOrderSyntaxNamesArityTypesLimits) {
    EXPECT_EQ(err("Z + ").code, "E_EXPR_SYNTAX");
    EXPECT_EQ(err("abs(Z, 1)").code, "E_EXPR_UNKNOWN_TAG");
    EXPECT_EQ(err("\"a\" + 1 + Z").code, "E_EXPR_UNKNOWN_TAG");
    EXPECT_EQ(err("sqrt(1, 2)").code, "E_EXPR_UNKNOWN_FUNC");
    EXPECT_EQ(err("text(A, Nope)").code, "E_EXPR_UNKNOWN_TABLE");
    EXPECT_EQ(err("Z + sqrt(1)").code, "E_EXPR_UNKNOWN_TAG");
    EXPECT_EQ(err("sqrt(1) + Z").code, "E_EXPR_UNKNOWN_FUNC");
    EXPECT_EQ(err("abs(\"a\", 1)").code, "E_EXPR_ARITY");
    EXPECT_EQ(err("\"a\" + 1 + " + rep("(", 40) + "1" + rep(")", 40)).code, "E_EXPR_TYPE");
    const Err e = err("(\"a\" + 1) && 2");
    EXPECT_EQ(e.code, "E_EXPR_TYPE");
    EXPECT_EQ(e.s, 1u);
    EXPECT_EQ(e.e, 4u);
}

TEST(ExprParser, TheThirtyThirdDistinctTagIsReportedRepeatsDoNotCount) {
    CompileEnv env;
    env.target = TagType::FLOAT64;
    env.tagType = [](const std::string&) { return std::optional<TagType>(TagType::FLOAT64); };
    env.hasTable = [](const std::string&) { return false; };
    std::string joined;
    for (int i = 0; i < 33; ++i) joined += (i ? "+X" : "X") + std::to_string(i);
    const CompileResult r = compile(joined, env);
    ASSERT_FALSE(r.ok);
    EXPECT_EQ(r.errors[0].code, "E_EXPR_LIMIT");
    EXPECT_EQ(joined.substr(r.errors[0].s, r.errors[0].e - r.errors[0].s), "X32");
    std::string rep32;
    for (int i = 0; i < 32; ++i) rep32 += (i ? "+X" : "X") + std::to_string(i);
    EXPECT_TRUE(compile(rep32 + "+X0+X1", env).ok);
}

TEST(ExprParser, LimitsOnLengthAndStack) {
    EXPECT_TRUE(compile(std::string(997, ' ') + "1+1", envFor()).ok);
    EXPECT_EQ(err(std::string(998, ' ') + "1+1").code, "E_EXPR_LIMIT");
    // The language is lazy: bytecode of && and || is a jump, never evaluates the dead side.
    const CompileResult r = compile("F && (1 / 0 > 1)", envFor(TagType::BOOL));
    ASSERT_TRUE(r.ok);
    const EvalResult e = evaluate(
        r.program,
        [](size_t) {
            InputValue iv;
            iv.value = false;
            iv.quality = Quality::GOOD;
            return iv;
        },
        TableSet{});
    EXPECT_EQ(e.quality, Quality::GOOD);
    EXPECT_FALSE(std::get<bool>(e.value));
}

TEST(ExprParser, TagIdsWithDotsAndTrueFalseKeywords) {
    EXPECT_TRUE(compile("TANK01.LEVEL * 12.5", envFor()).ok);
    EXPECT_EQ(num(run("true ? 1 : 2")), 1);
    EXPECT_EQ(err("TANK01.LEVEL.X").code, "E_EXPR_UNKNOWN_TAG");
}
