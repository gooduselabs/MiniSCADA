// Shared vectors with TypeScript (tests/expression-vectors, SC-008): value bit for bit, quality,
// reason; compile errors with the same code and span. Mirror of packages/expression
// vectors.test.ts.
#include <gtest/gtest.h>

#include <cmath>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>

#include "core/expression/expression.hpp"
#include "core/expression/value_table_json.hpp"
#include "nlohmann/json.hpp"

using nlohmann::json;
using namespace mat;
using namespace mat::expr;

namespace {

const std::string kDir = std::string(MAT_SOURCE_DIR) + "/tests/expression-vectors";

json readJson(const std::filesystem::path& p) {
    std::ifstream f(p, std::ios::binary);
    return json::parse(f);
}

double specialNumber(const json& v) {
    if (v.is_string()) {
        const std::string s = v.get<std::string>();
        if (s == "NaN") return std::nan("");
        if (s == "Infinity") return INFINITY;
        if (s == "-Infinity") return -INFINITY;
        return std::strtod(s.c_str(), nullptr);
    }
    return v.get<double>();
}

TagScalar scalarOf(const json& v, TagType t) {
    if (v.is_null()) return std::monostate{};
    if (t == TagType::STRING) return v.get<std::string>();
    if (t == TagType::BOOL) return v.get<bool>();
    return specialNumber(v);  // 64-bit integers enter the language as doubles (contract §4)
}

Quality qualityOf(const std::string& s) {
    return s == "GOOD" ? Quality::GOOD : s == "UNCERTAIN" ? Quality::UNCERTAIN : Quality::BAD;
}

uint64_t bits(double d) {
    uint64_t u;
    std::memcpy(&u, &d, sizeof u);
    return u;
}

size_t gCases = 0;

void runGroup(const std::string& file, size_t minCases) {
    const json doc = readJson(kDir + "/" + file);
    const auto& cases = doc["cases"];
    EXPECT_GE(cases.size(), minCases) << file;
    for (const auto& c : cases) {
        const std::string name = c["name"].get<std::string>();
        SCOPED_TRACE(name + ": " + c["expr"].get<std::string>());
        ++gCases;
        std::map<std::string, TagType> types;
        for (const auto& [id, in] : c["inputs"].items()) types[id] = *parseTagType(in["type"]);
        TableSet tables;
        for (const auto& [id, tb] : c["tables"].items()) tables[id] = valueTableFromJson(tb);
        CompileEnv env;
        env.target = *parseTagType(c["target"].get<std::string>());
        env.tagType = [&](const std::string& id) -> std::optional<TagType> {
            auto it = types.find(id);
            if (it == types.end()) return std::nullopt;
            return it->second;
        };
        env.hasTable = [&](const std::string& n) { return tables.count(n) > 0; };
        const CompileResult r = compile(c["expr"].get<std::string>(), env);
        const json& ex = c["expect"];
        if (ex.contains("error")) {
            ASSERT_FALSE(r.ok) << "expected " << ex["error"];
            EXPECT_EQ(r.errors[0].code, ex["error"].get<std::string>());
            EXPECT_EQ(r.errors[0].s, ex["span"][0].get<size_t>());
            EXPECT_EQ(r.errors[0].e, ex["span"][1].get<size_t>());
            continue;
        }
        ASSERT_TRUE(r.ok) << "unexpected compile error "
                          << (r.errors.empty() ? "" : r.errors[0].code);
        const EvalResult res = evaluate(
            r.program,
            [&](size_t i) {
                const std::string& id = r.program.inputs[i];
                const json& in = c["inputs"][id];
                InputValue iv;
                iv.value = scalarOf(in["value"], types[id]);
                iv.quality = qualityOf(in["quality"].get<std::string>());
                if (in.contains("reason")) iv.reason = in["reason"].get<std::string>();
                return iv;
            },
            tables);
        EXPECT_EQ(res.quality, qualityOf(ex["quality"].get<std::string>()));
        EXPECT_EQ(res.reason,
                  ex.contains("reason") ? ex["reason"].get<std::string>() : std::string());
        const json& ev = ex["value"];
        if (ev.is_null()) {
            EXPECT_TRUE(std::holds_alternative<std::monostate>(res.value));
        } else if (env.target == TagType::INT64) {
            ASSERT_TRUE(std::holds_alternative<int64_t>(res.value));
            EXPECT_EQ(std::get<int64_t>(res.value), std::stoll(ev.get<std::string>()));
        } else if (env.target == TagType::UINT64) {
            ASSERT_TRUE(std::holds_alternative<uint64_t>(res.value));
            EXPECT_EQ(std::get<uint64_t>(res.value), std::stoull(ev.get<std::string>()));
        } else if (env.target == TagType::BOOL) {
            ASSERT_TRUE(std::holds_alternative<bool>(res.value));
            EXPECT_EQ(std::get<bool>(res.value), ev.get<bool>());
        } else if (env.target == TagType::STRING) {
            ASSERT_TRUE(std::holds_alternative<std::string>(res.value));
            EXPECT_EQ(std::get<std::string>(res.value), ev.get<std::string>());
        } else if (env.target == TagType::FLOAT32 || env.target == TagType::FLOAT64) {
            ASSERT_TRUE(std::holds_alternative<double>(res.value));
            EXPECT_EQ(bits(std::get<double>(res.value)), bits(specialNumber(ev)));
        } else if (std::holds_alternative<int64_t>(res.value)) {
            EXPECT_EQ(std::get<int64_t>(res.value), static_cast<int64_t>(ev.get<double>()));
        } else {
            ASSERT_TRUE(std::holds_alternative<uint64_t>(res.value));
            EXPECT_EQ(std::get<uint64_t>(res.value), static_cast<uint64_t>(ev.get<double>()));
        }
        if (ex.contains("warnings")) {
            std::vector<std::string> got;
            for (const auto& w : r.warnings) got.push_back(w.code);
            std::vector<std::string> want = ex["warnings"].get<std::vector<std::string>>();
            EXPECT_EQ(got, want);
        }
    }
}

}  // namespace

#define GROUP(test, file, min) \
    TEST(ExpressionVectors, test) { runGroup(file, min); }

GROUP(Arith, "arith.json", 50)
GROUP(ModRound, "mod-round.json", 40)
GROUP(Compare, "compare.json", 30)
GROUP(LogicQuality, "logic-quality.json", 50)
GROUP(Ternary, "ternary.json", 25)
GROUP(Functions, "functions.json", 35)
GROUP(Text, "text.json", 20)
GROUP(Strings, "strings.json", 15)
GROUP(Assign, "assign.json", 25)
GROUP(SyntaxErrors, "syntax-errors.json", 30)
GROUP(TypeErrors, "type-errors.json", 25)
GROUP(Limits, "limits.json", 10)

// Run last (suite order is declaration order): the groups above add up to the cases of SC-008.
TEST(ExpressionVectorsTotal, AtLeast300CasesWereChecked) {
    size_t total = 0;
    for (const char* f : {"arith", "mod-round", "compare", "logic-quality", "ternary", "functions",
                          "text", "strings", "assign", "syntax-errors", "type-errors", "limits"})
        total += readJson(kDir + "/" + f + ".json")["cases"].size();
    EXPECT_GE(total, 300u);
    // When this binary runs the whole suite, every case went through runGroup().
    if (gCases > 0) {
        EXPECT_EQ(gCases, total);
    }
}
