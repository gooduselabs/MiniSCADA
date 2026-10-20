// The shared vectors v11-* (tests/project-vectors, feature 012 T011;
// specs/012-screen-grid-layout/contracts/project-format-1.1.md §3, §5; README-012.md): the C++
// validator gives the same verdict as the TypeScript one (packages/project-schema/src/
// vectors-11.test.ts) on every case: the set of error codes, the set of warning codes, the
// {code, file, path} of `issues`, and for a valid case the file list. Each case carries the runtime
// it is checked with (`runtimeVersion`, 1.1.0 by default).
#include <dirent.h>
#include <gtest/gtest.h>
#include <sys/stat.h>

#include <algorithm>
#include <fstream>
#include <set>
#include <sstream>

#include "core/project-manager/project_validator.hpp"
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

std::set<std::string> codesOf(const std::vector<ProjectIssue>& v) {
    std::set<std::string> out;
    for (const auto& e : v) out.insert(e.code);
    return out;
}

}  // namespace

class Vectors11 : public ::testing::TestWithParam<std::string> {};

TEST_P(Vectors11, SameVerdictAsTypeScript) {
    const std::string dir = kVectors + "/" + GetParam();
    const json expected = readJson(dir + "/expected.json");
    const ProjectValidation r =
        validateProject(dir, kSchemas, expected.value("runtimeVersion", "1.1.0"));
    std::set<std::string> want;
    for (const auto& e : expected["errors"]) want.insert(e.get<std::string>());
    EXPECT_EQ(codesOf(r.errors), want) << resultJson(r);
    EXPECT_EQ(r.valid, expected["valid"].get<bool>()) << resultJson(r);
    EXPECT_EQ(r.valid, r.project.has_value());
    if (expected.contains("warnings")) {
        std::set<std::string> wantW;
        for (const auto& w : expected["warnings"]) wantW.insert(w.get<std::string>());
        EXPECT_EQ(codesOf(r.warnings), wantW) << resultJson(r);
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
        EXPECT_TRUE(r.project->is10()) << "1.1 keeps every feature of 1.0";
        EXPECT_TRUE(r.project->is06());
    }
}

INSTANTIATE_TEST_SUITE_P(Small11, Vectors11, ::testing::ValuesIn(list(kVectors, "v11-")), caseName);

TEST(Vectors11Set, HasEnoughCases) { EXPECT_GE(list(kVectors, "v11-").size(), 40u); }

// One E_LAYOUT_SPAN per row for an overflow (README-012 rule 4): v11-span-sum-13 has a single one.
TEST(Vectors11Set, OneOverflowPerRow) {
    const auto r = validateProject(kVectors + "/v11-span-sum-13", kSchemas, "1.1.0");
    size_t n = 0;
    for (const auto& e : r.errors) n += e.code == "E_LAYOUT_SPAN";
    EXPECT_EQ(n, 1u) << resultJson(r);
}

// The default runtime (kRuntimeVersion 1.1.0-alpha.1) runs a 1.1 project; 1.0.0 refuses it.
TEST(Vectors11Set, RuntimeOfTheBuildRunsAProject11) {
    const auto ok = validateProject(kVectors + "/v11-valid-full", kSchemas);
    EXPECT_TRUE(ok.valid) << resultJson(ok);
    const auto old = validateProject(kVectors + "/v11-valid-full", kSchemas, "1.0.0");
    ASSERT_FALSE(old.valid);
    EXPECT_TRUE(codesOf(old.errors).count("E_RUNTIME_TOO_OLD")) << resultJson(old);
}
