// Same vectors as packages/project-schema/src/vectors.test.ts: the set of error codes must match.
#include "core/project-manager/project_validator.hpp"

#include <dirent.h>
#include <gtest/gtest.h>
#include <sys/stat.h>

#include <algorithm>
#include <filesystem>
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

std::vector<std::string> listValidCases() {
    std::vector<std::string> out;
    for (const auto& c : listCases())
        if (readJson(kVectors + "/" + c + "/expected.json").value("valid", false)) out.push_back(c);
    return out;
}

std::string caseName(const ::testing::TestParamInfo<std::string>& i) {
    std::string n = i.param;
    std::replace(n.begin(), n.end(), '-', '_');
    return n;
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
    if (expected.contains("warnings")) {  // feature 003: W_LOG_* must match too
        std::set<std::string> gotW, wantW;
        for (auto& w : r.warnings) gotW.insert(w.code);
        for (auto& w : expected["warnings"]) wantW.insert(w.get<std::string>());
        EXPECT_EQ(gotW, wantW) << resultJson(r);
    }
    if (expected.contains("warningPaths"))  // the same connections, not only the same code
        for (auto it = expected["warningPaths"].begin(); it != expected["warningPaths"].end();
             ++it) {
            std::multiset<std::string> got, want;
            for (auto& w : r.warnings)
                if (w.code == it.key()) got.insert(w.path);
            for (auto& p : it.value()) want.insert(p.get<std::string>());
            EXPECT_EQ(got, want) << it.key() << " " << resultJson(r);
        }
}

INSTANTIATE_TEST_SUITE_P(ProjectVectors, Vectors, ::testing::ValuesIn(listCases()),
                         [](const ::testing::TestParamInfo<std::string>& i) {
                             std::string n = i.param;
                             std::replace(n.begin(), n.end(), '-', '_');
                             return n;
                         });

TEST(ProjectValidator, HasEnoughVectors) { EXPECT_GE(listCases().size(), 30u); }

// LoadedProject::files() (feature 005, data-model §8): the same list as `files` of every valid
// vector (tests/project-vectors, T015) and as projectFiles() of packages/project-schema.
class ProjectFilesVector : public ::testing::TestWithParam<std::string> {};

TEST_P(ProjectFilesVector, MatchesExpected) {
    const std::string dir = kVectors + "/" + GetParam();
    const auto expected = readJson(dir + "/expected.json");
    auto r = validateProject(dir, kSchemas);
    ASSERT_TRUE(r.valid) << resultJson(r);
    std::vector<std::string> want;
    for (auto& f : expected["files"]) want.push_back(f.get<std::string>());
    EXPECT_EQ(r.project->files(), want);
}

INSTANTIATE_TEST_SUITE_P(ValidVectors, ProjectFilesVector, ::testing::ValuesIn(listValidCases()),
                         caseName);

TEST(ProjectFiles, EveryValidVectorIsChecked) { EXPECT_GE(listValidCases().size(), 13u); }

namespace {
LoadedProject::Screen screenWith(const std::string& id, const std::string& bindingFile,
                                 const std::string& svgFile) {
    return {id, {{"bindingFile", bindingFile}, {"svgFile", svgFile}}, nlohmann::json()};
}
}  // namespace

TEST(ProjectFiles, NoDuplicatesSortedByUtf8Bytes) {
    LoadedProject p;
    p.project = {{"tagFile", "Thẻ Tag.json"},
                 {"loggingFile", "logging.json"},
                 {"screens", nlohmann::json::array({"overview", "pump"})}};
    p.screens.push_back(
        screenWith("overview", "screens/overview.bindings.json", "màn hình/Tổng quan.svg"));
    p.screens.push_back(screenWith("pump", "màn hình/gắn kết.json", "màn hình/Tổng quan.svg"));
    EXPECT_EQ(p.files(), (std::vector<std::string>{
                             "Thẻ Tag.json",  // 'T' (0x54) sorts before every lower case letter
                             "logging.json",
                             "màn hình/Tổng quan.svg",  // shared by both screens, listed once
                             "màn hình/gắn kết.json",
                             "project.json",
                             "screens/overview.bindings.json",
                             "screens/overview.screen.json",
                             "screens/pump.screen.json",
                         }));
}

TEST(ProjectFiles, NoLoggingFileNoLoggingEntry) {
    LoadedProject p;
    p.project = {{"tagFile", "tags.json"}, {"screens", nlohmann::json::array({"main"})}};
    p.screens.push_back(screenWith("main", "screens/main.bindings.json", "screens/main.svg"));
    EXPECT_EQ(p.files(), (std::vector<std::string>{"project.json", "screens/main.bindings.json",
                                                   "screens/main.screen.json", "screens/main.svg",
                                                   "tags.json"}));
}

// As projectFiles() in TypeScript: every listed screen has its .screen.json, even one whose
// documents are not loaded.
TEST(ProjectFiles, ListedScreenWithoutDocuments) {
    LoadedProject p;
    p.project = {{"tagFile", "tags.json"},
                 {"screens", nlohmann::json::array({"main", "constructor"})}};
    EXPECT_EQ(p.files(),
              (std::vector<std::string>{"project.json", "screens/constructor.screen.json",
                                        "screens/main.screen.json", "tags.json"}));
}

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

// The validator only checks that an SVG exists (it never parses SVG, Constitution II): size and
// encoding are not validation errors. Studio reads SVG up to 5 MB (ADR-003) and must report the
// same as this for a bigger one (audit FR-032).
TEST(ProjectValidator, SvgBiggerThanStudioLimitStillCountsAsPresent) {
    namespace fs = std::filesystem;
    const fs::path dir = fs::temp_directory_path() / "mat-validator-big-svg";
    fs::remove_all(dir);
    fs::copy(kVectors + "/valid-minimal", dir, fs::copy_options::recursive);
    {
        std::ofstream svg(dir / "screens/main.svg", std::ios::binary | std::ios::trunc);
        svg << "<svg xmlns=\"http://www.w3.org/2000/svg\">" << std::string(5 * 1024 * 1024, ' ')
            << "\xEA\xD2</svg>";  // > 5 MB and not UTF-8
    }
    auto r = validateProject(dir.string(), kSchemas);
    EXPECT_TRUE(r.valid) << resultJson(r);
    fs::remove_all(dir);
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
