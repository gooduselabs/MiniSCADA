// Fuzz of the expression language, C++ side (feature 011 T058; FR-029; the TS twin is
// tools/fuzz/targets/expression.mjs). Corpus tests/fuzz-corpus/expression.json (the expressions of
// tests/expression-vectors with their Tag types, target and value tables). Each case is one of
//   text      byte mutations of a corpus expression (and of its dictionary of tokens)
//   splice    two corpus expressions joined by a random operator
//   chain     a long operator chain `T op T op ... T` up to 8.192 characters and a bit beyond
//             (left-deep trees: the TS fuzz found a stack overflow there), with parentheses
//   nest      deep parentheses / unary chains / nested calls
// then compile() with the case's Tag types and, when it compiles, evaluate() with random inputs
// (every quality, NaN/Inf/huge numbers, strings, no value). Invariants: no crash, no hang, no
// sanitizer report (ASan + UBSan build of tools/fuzz/cpp/run.sh); compile is deterministic (every
// 16th case compiled twice, the same codes); a failed compile has exactly one error; a GOOD result
// carries a value; finite inputs never give a GOOD/UNCERTAIN non-finite number (the VM reports
// OVERFLOW). MAT_FUZZ_SECONDS (default 5 under ctest), MAT_FUZZ_SEED.
#include <gtest/gtest.h>

#include <chrono>
#include <cmath>
#include <fstream>
#include <iostream>
#include <limits>
#include <map>
#include <sstream>

#include "core/common/tests/fuzz_util.hpp"
#include "core/expression/expression.hpp"
#include "core/expression/value_table_json.hpp"
#include "nlohmann/json.hpp"

using nlohmann::json;
using namespace mat;
using namespace mat::expr;

namespace {

struct Case {
    std::string expr;
    std::map<std::string, TagType> types;
    TagType target = TagType::FLOAT64;
    TableSet tables;
};

std::vector<Case> loadCorpus() {
    std::ifstream f(std::string(MAT_SOURCE_DIR) + "/tests/fuzz-corpus/expression.json");
    std::stringstream ss;
    ss << f.rdbuf();
    std::vector<Case> out;
    for (const json& c : json::parse(ss.str())) {
        Case k;
        k.expr = c["expr"].get<std::string>();
        for (auto it = c["types"].begin(); it != c["types"].end(); ++it)
            if (auto t = parseTagType(it.value().get<std::string>())) k.types[it.key()] = *t;
        if (auto t = parseTagType(c["target"].get<std::string>())) k.target = *t;
        for (auto it = c["tables"].begin(); it != c["tables"].end(); ++it) {
            try {
                ValueTable vt = valueTableFromJson(it.value());
                vt.name = it.key();
                k.tables[it.key()] = vt;
            } catch (const std::exception&) {
                // a table of a vector of errors: not used
            }
        }
        out.push_back(std::move(k));
    }
    return out;
}

const char* kOps[] = {"&&", "||", "+",  "-", "*", "/", "%",  "==", "!=", "<",
                      "<=", ">",  ">=", "&", "|", "^", "<<", ">>", "**", "?",
                      ":",  ",",  "!",  "~", "(", ")", " ",  "\"", "'",  "."};
const TagType kTypes[] = {TagType::BOOL,    TagType::INT16, TagType::UINT16, TagType::INT32,
                          TagType::UINT32,  TagType::INT64, TagType::UINT64, TagType::FLOAT32,
                          TagType::FLOAT64, TagType::STRING};

std::string chain(fuzz::Rng& r, const std::vector<std::string>& atoms) {
    // around the parse cap (8.192 code points), sometimes far below, sometimes past it
    static const size_t kLens[] = {64, 1000, 1001, 4096, 8000, 8191, 8192, 8193, 8300, 12000};
    const size_t want = kLens[r.below(sizeof kLens / sizeof kLens[0])];
    const char* op = kOps[r.below(19)];
    const bool mixed = r.chance(30);
    std::string s;
    s.reserve(want + 64);
    const std::string a = atoms[r.below(atoms.size())];
    s += a;
    while (s.size() < want) {
        s += mixed ? kOps[r.below(19)] : op;
        if (r.chance(3)) s += "(";
        s += mixed ? atoms[r.below(atoms.size())] : a;
        if (r.chance(3)) s += ")";
    }
    return s;
}

std::string nest(fuzz::Rng& r, const std::string& inner) {
    const size_t depth = 1 + r.below(r.chance(50) ? 64 : 3000);
    std::string open, close;
    switch (r.below(4)) {
        case 0:
            open = "(";
            close = ")";
            break;
        case 1:
            open = "!";
            break;
        case 2:
            open = "-";
            break;
        default:
            open = "abs(";
            close = ")";
            break;
    }
    std::string s;
    for (size_t i = 0; i < depth; ++i) s += open;
    s += inner;
    for (size_t i = 0; i < depth; ++i) s += close;
    return s;
}

InputValue randomInput(fuzz::Rng& r, TagType t) {
    InputValue v;
    const size_t q = r.below(10);
    v.quality = q < 7 ? Quality::GOOD : q < 9 ? Quality::UNCERTAIN : Quality::BAD;
    if (v.quality != Quality::GOOD) v.reason = "COMM_FAILURE";
    if (r.chance(5)) {
        v.value = std::monostate{};
        return v;
    }
    static const double kNums[] = {0.0,
                                   -0.0,
                                   1.0,
                                   -1.0,
                                   0.5,
                                   2.5,
                                   1e308,
                                   -1e308,
                                   5e-324,
                                   9007199254740993.0,
                                   std::numeric_limits<double>::infinity(),
                                   -std::numeric_limits<double>::infinity(),
                                   std::numeric_limits<double>::quiet_NaN(),
                                   65535.0,
                                   -32768.0,
                                   4294967295.0};
    switch (t) {
        case TagType::BOOL:
            v.value = r.chance(50);
            break;
        case TagType::STRING:
            v.value = r.chance(50) ? std::string(r.below(2000), 'x') : std::string("Chạy");
            break;
        case TagType::UINT64:
            v.value = r.chance(50) ? static_cast<uint64_t>(r.next()) : uint64_t{0};
            break;
        case TagType::INT64:
        case TagType::INT32:
        case TagType::INT16:
        case TagType::UINT16:
        case TagType::UINT32:
            v.value = r.chance(50) ? static_cast<int64_t>(r.next())
                                   : static_cast<int64_t>(r.below(70000)) - 35000;
            break;
        default:
            v.value = r.chance(70) ? kNums[r.below(sizeof kNums / sizeof kNums[0])]
                                   : (r.unit() - 0.5) * 1e6;
            break;
    }
    // a value of another type than the Tag's (the store never gives one, the VM must not care)
    if (r.chance(3)) v.value = std::string("1");
    return v;
}

std::string codesOf(const CompileResult& c) {
    std::string s = c.ok ? "ok" : "err";
    for (const auto& e : c.errors) s += " " + e.code + "@" + std::to_string(e.s);
    for (const auto& w : c.warnings) s += " " + w.code;
    return s;
}

}  // namespace

TEST(ExpressionFuzz, MutatedExpressionsNeverCrash) {
    const std::vector<Case> corpus = loadCorpus();
    ASSERT_GT(corpus.size(), 100u);
    std::vector<std::string> atoms = {"T", "A", "1", "0.5", "true", "\"s\"", "A.B_C", "x"};
    std::vector<std::string> dict;
    for (const Case& c : corpus) {
        for (const auto& [id, t] : c.types) atoms.push_back(id), dict.push_back(id);
        dict.push_back(c.expr.substr(0, 16));
    }
    for (const char* o : kOps) dict.push_back(o);

    const double budget = fuzz::budgetSeconds(5);
    const uint64_t seed = fuzz::baseSeed();
    fuzz::Rng r{seed ^ 0x65787072ull};  // "expr"
    fuzz::Deadline deadline(budget);
    std::map<std::string, int64_t> byKind, byCode;
    int64_t cases = 0, compiled = 0, evaluated = 0, longest = 0;
    while (!deadline.passed()) {
        const Case& base = corpus[r.below(corpus.size())];
        Case c = base;
        std::string kind;
        switch (r.below(10)) {
            case 0:
            case 1:
                kind = "chain";
                c.expr = chain(r, atoms);
                break;
            case 2:
                kind = "nest";
                c.expr = nest(r, base.expr);
                break;
            case 3:
                kind = "splice";
                c.expr =
                    base.expr + " " + kOps[r.below(19)] + " " + corpus[r.below(corpus.size())].expr;
                break;
            default:
                kind = "text";
                c.expr = fuzz::mutateText(base.expr, r, dict);
                break;
        }
        // Tag ids that the chain uses get a type; sometimes a wrong one
        for (const std::string& a : atoms)
            if (!c.types.count(a) && a.size() > 0 && (a[0] == 'T' || a[0] == 'A' || a[0] == 'x'))
                c.types[a] = kTypes[r.below(10)];
        if (r.chance(10)) c.target = kTypes[r.below(10)];
        ++cases;
        ++byKind[kind];
        longest = std::max<int64_t>(longest, static_cast<int64_t>(c.expr.size()));

        CompileEnv env;
        env.target = c.target;
        env.tagType = [&c](const std::string& id) -> std::optional<TagType> {
            auto it = c.types.find(id);
            if (it == c.types.end()) return std::nullopt;
            return it->second;
        };
        env.hasTable = [&c](const std::string& n) { return c.tables.count(n) > 0; };
        const CompileResult res = compile(c.expr, env);
        if (!res.ok) {
            ASSERT_EQ(res.errors.size(), 1u) << "case " << cases << " seed " << seed;
            ++byCode[res.errors[0].code];
        } else {
            ++byCode["ok"];
        }
        if (cases % 16 == 0) {
            const CompileResult again = compile(c.expr, env);
            ASSERT_EQ(codesOf(res), codesOf(again)) << "case " << cases << " seed " << seed;
        }
        if (!res.ok) continue;
        ++compiled;
        for (int k = 0; k < 4; ++k) {
            std::vector<InputValue> inputs;
            bool finiteInputs = true;
            for (const std::string& id : res.program.inputs) {
                auto it = c.types.find(id);
                inputs.push_back(
                    randomInput(r, it == c.types.end() ? TagType::FLOAT64 : it->second));
                if (const double* d = std::get_if<double>(&inputs.back().value))
                    finiteInputs = finiteInputs && std::isfinite(*d);
            }
            const EvalResult e = evaluate(
                res.program, [&inputs](size_t i) { return inputs.at(i); }, c.tables);
            ++evaluated;
            if (e.quality == Quality::GOOD) {
                ASSERT_FALSE(std::holds_alternative<std::monostate>(e.value))
                    << "case " << cases << " seed " << seed << ": GOOD without a value";
            }
            if (const double* d = std::get_if<double>(&e.value)) {
                ASSERT_TRUE(!finiteInputs || e.quality == Quality::BAD || std::isfinite(*d))
                    << "case " << cases << " seed " << seed << ": non-finite result " << *d
                    << " from finite inputs: " << c.expr.substr(0, 200);
            }
        }
    }
    std::cout << "fuzz expression: " << cases << " inputs, " << compiled << " compiled, "
              << evaluated << " evaluated, longest " << longest << " bytes, seed " << seed << ", "
              << budget << " s\n[ fuzz     ]";
    for (const auto& [k, n] : byKind) std::cout << " " << k << "=" << n;
    std::cout << "\n[ fuzz     ]";
    for (const auto& [k, n] : byCode) std::cout << " " << k << "=" << n;
    std::cout << "\n";
    EXPECT_GT(compiled, 0);
    EXPECT_GT(byKind["chain"], 0);
}
