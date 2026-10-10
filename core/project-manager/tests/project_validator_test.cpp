// Same vectors as packages/project-schema/src/vectors.test.ts: the set of error codes must match.
#include "core/project-manager/project_validator.hpp"

#include <dirent.h>
#include <gtest/gtest.h>
#include <sys/stat.h>

#include <algorithm>
#include <fstream>
#include <set>
#include <sstream>

#include "nlohmann/json.hpp"

using namespace mat;

namespace {
const std::string kVectors = std::string(MAT_SOURCE_DIR) + "/tests/project-vectors";
const std::string kSchemas = std::string(MAT_SOURCE_DIR) + "/schemas";

std::vector<std::string> listCases() {
    std::vector<std::string> out;
    DIR* d = opendir(kVectors.c_str());
    if (!d) return out;
    while (dirent* e = readdir(d)) {
        std::string n = e->d_name;
        if (n == "." || n == "..") continue;
        struct stat st {};
        if (stat((kVectors + "/" + n).c_str(), &st) == 0 && S_ISDIR(st.st_mode)) out.push_back(n);
    }
    closedir(d);
    std::sort(out.begin(), out.end());
    return out;
}

nlohmann::json readJson(const std::string& path) {
    std::ifstream f(path);
    std::stringstream ss;
    ss << f.rdbuf();
    return nlohmann::json::parse(ss.str());
}
}  // namespace

class Vectors : public ::testing::TestWithParam<std::string> {};

TEST_P(Vectors, SameErrorCodesAsTypeScript) {
    const std::string dir = kVectors + "/" + GetParam();
    auto expected = readJson(dir + "/expected.json");
    auto r = validateProject(dir, kSchemas);
    std::set<std::string> got;
    for (auto& e : r.errors) got.insert(e.code);
    std::set<std::string> want;
    for (auto& e : expected["errors"]) want.insert(e.get<std::string>());
    EXPECT_EQ(got, want) << resultJson(r);
    EXPECT_EQ(r.valid, expected["valid"].get<bool>());
    EXPECT_EQ(r.valid, r.project.has_value());
}

INSTANTIATE_TEST_SUITE_P(ProjectVectors, Vectors, ::testing::ValuesIn(listCases()),
                         [](const ::testing::TestParamInfo<std::string>& i) {
                             std::string n = i.param;
                             std::replace(n.begin(), n.end(), '-', '_');
                             return n;
                         });

TEST(ProjectValidator, HasEnoughVectors) { EXPECT_GE(listCases().size(), 30u); }

TEST(ProjectValidator, AllowlistContainsOnlyScreenSvgs) {
    auto r = validateProject(std::string(MAT_SOURCE_DIR) + "/projects/tank-demo", kSchemas);
    ASSERT_TRUE(r.valid) << resultJson(r);
    auto allow = r.project->allowlist();
    ASSERT_EQ(allow.size(), 1u);
    EXPECT_EQ(*allow.begin(), "screens/tank-motor.svg");
    EXPECT_EQ(r.project->project["projectId"], "tank-demo");
    EXPECT_EQ(r.project->tags["tags"].size(), 5u);
}

TEST(ProjectValidator, ActiveJsonCombinesFiles) {
    auto r = validateProject(std::string(MAT_SOURCE_DIR) + "/projects/tank-demo", kSchemas);
    ASSERT_TRUE(r.valid);
    auto j = nlohmann::json::parse(r.project->activeJson());
    EXPECT_EQ(j["project"]["entryScreen"], "tank-motor");
    EXPECT_TRUE(j["screens"]["tank-motor"].contains("screen"));
    EXPECT_TRUE(j["screens"]["tank-motor"].contains("bindings"));
    EXPECT_EQ(j["tags"]["tags"][0]["id"], "TANK01.LEVEL");
}

TEST(ProjectValidator, MissingProjectDirIsFileMissing) {
    auto r = validateProject("/nonexistent/dir", kSchemas);
    EXPECT_FALSE(r.valid);
    ASSERT_FALSE(r.errors.empty());
    EXPECT_EQ(r.errors[0].code, "E_FILE_MISSING");
}

TEST(ProjectValidator, SafePath) {
    EXPECT_TRUE(isSafeRelPath("screens/a.svg"));
    EXPECT_FALSE(isSafeRelPath("../a.svg"));
    EXPECT_FALSE(isSafeRelPath("/etc/a.svg"));
    EXPECT_FALSE(isSafeRelPath("C:\\a.svg"));
    EXPECT_FALSE(isSafeRelPath("a//b.svg"));
    EXPECT_FALSE(isSafeRelPath("./a.svg"));
    EXPECT_FALSE(isSafeRelPath(""));
    EXPECT_FALSE(isSafeRelPath(std::string(129, 'a')));
    EXPECT_FALSE(isSafeRelPath(std::string("a\x01.svg")));
}
