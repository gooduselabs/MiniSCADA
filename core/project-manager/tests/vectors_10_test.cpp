// The shared vectors v10-* (tests/project-vectors, feature 011 T018;
// contracts/project-format-1.0.md §3-§5): the C++ validator gives the same verdict as the
// TypeScript one (packages/project-schema/src/vectors-10.test.ts) on every case: the set of error
// codes, the set of warning codes, the {code, file, path} of `issues`, and for a valid case the
// file list. Each case carries the runtime it is checked with (`runtimeVersion` 1.0.0:
// kRuntimeVersion is still 0.9.0 until the 1.0.0 release). Also: the substitution of parameters
// (rules_10) on the cases of params.test.ts that decide the shared verdicts.
#include <dirent.h>
#include <gtest/gtest.h>
#include <sys/stat.h>

#include <algorithm>
#include <fstream>
#include <set>
#include <sstream>

#include "core/project-manager/project_validator.hpp"
#include "core/project-manager/rules_10.hpp"
#include "core/project-manager/widget_catalog.hpp"
#include "nlohmann/json.hpp"

using namespace mat;
using nlohmann::json;

namespace {

const std::string kVectors = std::string(MAT_SOURCE_DIR) + "/tests/project-vectors";
const std::string kSchemas = std::string(MAT_SOURCE_DIR) + "/schemas";

json readJson(const std::string& path) {
    std::ifstream f(path);
    std::stringstream ss;
    ss << f.rdbuf();
    return json::parse(ss.str());
}

std::vector<std::string> list(const std::string& root, const std::string& prefix) {
    std::vector<std::string> out;
    if (DIR* d = opendir(root.c_str())) {
        while (const dirent* e = readdir(d)) {
            const std::string n = e->d_name;
            if (n.compare(0, prefix.size(), prefix) != 0) continue;
            struct stat st {};
            if (stat((root + "/" + n).c_str(), &st) == 0 && S_ISDIR(st.st_mode)) out.push_back(n);
        }
        closedir(d);
    }
    std::sort(out.begin(), out.end());
    return out;
}

std::string caseName(const ::testing::TestParamInfo<std::string>& i) {
    std::string n = i.param;
    std::replace(n.begin(), n.end(), '-', '_');
    std::replace(n.begin(), n.end(), '.', '_');
    return n;
}

}  // namespace

class Vectors10 : public ::testing::TestWithParam<std::string> {};

TEST_P(Vectors10, SameVerdictAsTypeScript) {
    const std::string dir = kVectors + "/" + GetParam();
    const json expected = readJson(dir + "/expected.json");
    const ProjectValidation r =
        validateProject(dir, kSchemas, expected.value("runtimeVersion", "1.0.0"));
    std::set<std::string> got, want;
    for (const auto& e : r.errors) got.insert(e.code);
    for (const auto& e : expected["errors"]) want.insert(e.get<std::string>());
    EXPECT_EQ(got, want) << resultJson(r);
    EXPECT_EQ(r.valid, expected["valid"].get<bool>()) << resultJson(r);
    EXPECT_EQ(r.valid, r.project.has_value());
    if (expected.contains("warnings")) {
        std::set<std::string> gotW, wantW;
        for (const auto& w : r.warnings) gotW.insert(w.code);
        for (const auto& w : expected["warnings"]) wantW.insert(w.get<std::string>());
        EXPECT_EQ(gotW, wantW) << resultJson(r);
    }
    if (expected.contains("issues"))
        for (const auto& w : expected["issues"]) {
            bool found = false;
            for (const auto* l : {&r.errors, &r.warnings})
                for (const auto& e : *l)
                    found = found || (e.code == w["code"].get<std::string>() &&
                                      e.file == w["file"].get<std::string>() &&
                                      e.path == w["path"].get<std::string>());
            EXPECT_TRUE(found) << "issue " << w << " " << resultJson(r);
        }
    if (r.valid && expected.contains("files")) {
        std::vector<std::string> files;
        for (const auto& f : expected["files"]) files.push_back(f.get<std::string>());
        EXPECT_EQ(r.project->files(), files);
        EXPECT_TRUE(r.project->is10());
        EXPECT_TRUE(r.project->is06()) << "1.0 keeps every feature of 0.6";
    }
}

INSTANTIATE_TEST_SUITE_P(Small10, Vectors10, ::testing::ValuesIn(list(kVectors, "v10-")), caseName);

TEST(Vectors10Set, HasEnoughCases) { EXPECT_GE(list(kVectors, "v10-").size(), 60u); }

TEST(Vectors10Set, AnOlderRuntimeRefusesAProject10) {
    const auto r = validateProject(kVectors + "/v10-valid-full", kSchemas, "0.9.0");
    ASSERT_FALSE(r.valid);
    std::set<std::string> codes;
    for (const auto& e : r.errors) codes.insert(e.code);
    EXPECT_TRUE(codes.count("E_RUNTIME_TOO_OLD")) << resultJson(r);
}

// ---- parameters (params.ts) ----

TEST(Params10, ValueOfEachKind) {
    EXPECT_EQ(paramValueError("tagPrefix", "Plant1.PUMP_07"), "");
    for (const char* v : {"", "7PUMP", "PUMP 07", "PUMP-07", "PUMP.", ".PUMP", "A..B", "P{x}"})
        EXPECT_NE(paramValueError("tagPrefix", v), "") << v;
    EXPECT_EQ(paramValueError("tagPrefix", std::string(64, 'A')), "");
    EXPECT_NE(paramValueError("tagPrefix", std::string(65, 'A')), "");
    EXPECT_EQ(paramValueError("string", "Bơm số 7 {không thay}"), "");
    EXPECT_NE(paramValueError("string", "a\nb"), "");
    EXPECT_NE(paramValueError("string",
                              "a\x7f"
                              "b"),
              "");
    EXPECT_NE(paramValueError("string", std::string(129, 'x')), "");
    for (const char* v : {"0", "-1", "2.5", "1e3", "-0.25E-2"})
        EXPECT_EQ(paramValueError("number", v), "") << v;
    for (const char* v : {"", "1.", ".5", "+1", "0x10", "1e999", "01", " 1"})
        EXPECT_NE(paramValueError("number", v), "") << v;
    EXPECT_EQ(paramValueError("color", "#22C55e"), "");
    EXPECT_NE(paramValueError("color", "#fff"), "");
    EXPECT_NE(paramValueError("color", json(5)), "");
}

TEST(Params10, TokensRefuseNestingAndStrayBraces) {
    EXPECT_TRUE(paramTokens("{title} (lưu lượng)").has_value());
    for (const char* s : {"{{a}}", "{a", "a}", "{}", "{A}", "{a b}", "{a{b}}", "}{", "{1a}"})
        EXPECT_FALSE(paramTokens(s).has_value()) << s;
}

TEST(Params10, SubstituteIsPlainAndSinglePass) {
    std::string err;
    const auto cat = WidgetCatalog::loadFromDir(kSchemas, err);
    ASSERT_TRUE(cat) << err;
    const json params = json::parse(R"([{"name":"prefix","kind":"tagPrefix"},
        {"name":"title","kind":"string","default":"Bơm"},
        {"name":"max","kind":"number","default":"100"}])");
    const json gauge = json::parse(R"({"id":"g","type":"widget","widget":"gauge","x":0,"y":0,
        "width":200,"height":160,"props":{"min":0,"max":"{max}","label":"{title} {prefix}"},
        "tags":{"value":"{prefix}.FLOW"}})");
    // {prefix} (tagPrefix) in a string property: a wrong place
    const auto bad = checkParamPlaces(gauge, params, false, *cat);
    ASSERT_EQ(bad.size(), 1u);
    EXPECT_EQ(bad[0].path, "/props/label");

    json ok = gauge;
    ok["props"]["label"] = "{title}";
    EXPECT_TRUE(checkParamPlaces(ok, params, false, *cat).empty());
    const auto r =
        substituteParams(ok, params, json{{"prefix", "P7"}, {"title", "{prefix}"}}, false, *cat);
    ASSERT_TRUE(r.ok);
    EXPECT_EQ(r.value["tags"]["value"], "P7.FLOW");
    EXPECT_EQ(r.value["props"]["max"], 100);
    EXPECT_EQ(r.value["props"]["label"], "{prefix}") << "one pass only";

    // args of a popup action: {param} only in a template
    const json btn = json::parse(R"({"id":"d","type":"widget","widget":"button","x":0,"y":0,
        "width":120,"height":40,"events":{"click":{"action":"popup","screen":"bom",
        "args":{"prefix":"{prefix}"}}}})");
    EXPECT_TRUE(checkParamPlaces(btn, params, true, *cat).empty());
    EXPECT_EQ(checkParamPlaces(btn, params, false, *cat).size(), 1u);
}

TEST(Params10, ResolveArgsMissingExtraKind) {
    const json params = json::parse(R"([{"name":"prefix","kind":"tagPrefix"},
        {"name":"title","kind":"string","default":"Bơm"}])");
    const auto good = resolveArgs(params, json{{"prefix", "PUMP07"}});
    ASSERT_TRUE(good.ok);
    EXPECT_EQ(good.values.at("title"), "Bơm");
    const auto bad = resolveArgs(params, json{{"title", 7}, {"extra", "x"}});
    ASSERT_FALSE(bad.ok);
    std::set<std::string> paths;
    for (const auto& p : bad.problems) paths.insert(p.path);
    EXPECT_EQ(paths, (std::set<std::string>{"/extra", "/prefix", "/title"}));
    EXPECT_TRUE(resolveArgs(json::array(), json()).ok);
    EXPECT_FALSE(resolveArgs(json::array(), json{{"a", "x"}}).ok);
}
