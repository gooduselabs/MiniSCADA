// Format 0.5 (feature 009 T017, contracts/project-format-0.5.md): the alarm rules of
// alarm_rules.cpp and the loader of project_validator.cpp. The shared vectors v05-* run in
// project_validator_test (with the runtimeVersion of each expected.json); here: the constant, the
// token checker, the version limits (0.5 needs runtime >= 0.8.0; 0.6 is refused) and the files of a
// 0.5 project.
#include "core/project-manager/alarm_rules.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <set>
#include <tuple>

#include "core/project-manager/project_validator.hpp"
#include "core/project-manager/rules_02.hpp"
#include "nlohmann/json.hpp"

using namespace mat;
using nlohmann::json;
namespace fs = std::filesystem;

namespace {
const std::string kVectors = std::string(MAT_SOURCE_DIR) + "/tests/project-vectors";
const std::string kSchemas = std::string(MAT_SOURCE_DIR) + "/schemas";
const std::string kRuntime05 = "0.8.0";

std::set<std::string> codesOf(const std::vector<ProjectIssue>& v) {
    std::set<std::string> out;
    for (const auto& i : v) out.insert(i.code);
    return out;
}

// A copy of a vector in a temporary directory, so that a file can be changed.
fs::path copyOf(const std::string& name, const std::string& tag) {
    const fs::path dir = fs::temp_directory_path() / ("mat-alarm-rules-" + tag);
    fs::remove_all(dir);
    fs::copy(kVectors + "/" + name, dir, fs::copy_options::recursive);
    fs::remove(dir / "expected.json");
    return dir;
}
void rewrite(const fs::path& p, const std::string& from, const std::string& to) {
    std::ifstream in(p);
    std::string s((std::istreambuf_iterator<char>(in)), {});
    in.close();
    for (size_t at = s.find(from); at != std::string::npos; at = s.find(from, at + to.size()))
        s.replace(at, from.size(), to);
    std::ofstream out(p, std::ios::trunc);
    out << s;
}
}  // namespace

TEST(AlarmRules, FormatConstantIs050) {
    EXPECT_STREQ(kProjectFormatAlarms, "0.5.0");
    EXPECT_STREQ(kMinRuntime05, "0.8.0");
}

TEST(AlarmRules, TextTokens) {
    EXPECT_TRUE(alarmTextTokensValid(""));
    EXPECT_TRUE(
        alarmTextTokensValid("{name} {tag} {value} {value:0} {value:6} {unit} {limit} "
                             "{limitName} {area} {reason}"));
    EXPECT_FALSE(alarmTextTokensValid("{value:7}"));
    EXPECT_FALSE(alarmTextTokensValid("{value:}"));
    EXPECT_FALSE(alarmTextTokensValid("{value:10}"));
    EXPECT_FALSE(alarmTextTokensValid("{abc}"));
    EXPECT_FALSE(alarmTextTokensValid("{Name}"));
    EXPECT_FALSE(alarmTextTokensValid("{name"));
    EXPECT_FALSE(alarmTextTokensValid("name}"));
    EXPECT_FALSE(alarmTextTokensValid("{}"));
    EXPECT_FALSE(alarmTextTokensValid("{na{me}}"));
}

TEST(AlarmRules, BaseVectorValidOnRuntime080WithBothFilesLoaded) {
    auto r = validateProject(kVectors + "/v05-ok-base-full", kSchemas, kRuntime05);
    ASSERT_TRUE(r.valid) << resultJson(r);
    EXPECT_TRUE(r.warnings.empty()) << resultJson(r);
    ASSERT_TRUE(r.project.has_value());
    EXPECT_TRUE(r.project->is02());
    EXPECT_TRUE(r.project->is03());
    EXPECT_TRUE(r.project->is05());
    EXPECT_EQ(r.project->alarms["alarms"].size(), 4u);
    EXPECT_EQ(r.project->alarmClasses["classes"].size(), 4u);
    const auto files = r.project->files();
    EXPECT_NE(std::find(files.begin(), files.end(), "alarms.json"), files.end());
    EXPECT_NE(std::find(files.begin(), files.end(), "alarm-classes.json"), files.end());
}

TEST(AlarmRules, ProjectWithoutAlarmFilesIsValid05AndHasNullDocs) {
    auto r = validateProject(kVectors + "/v05-ok-empty-no-alarm-files", kSchemas, kRuntime05);
    ASSERT_TRUE(r.valid) << resultJson(r);
    EXPECT_TRUE(r.project->is05());
    EXPECT_TRUE(r.project->alarms.is_null());
    EXPECT_TRUE(r.project->alarmClasses.is_null());
}

TEST(AlarmRules, Runtime070RefusesA05Project) {
    // the repo's runtime (0.6.0 until T125) and a 0.7 runtime: E_RUNTIME_TOO_OLD, never a crash
    auto r = validateProject(kVectors + "/v05-ok-base-full", kSchemas, "0.7.0");
    EXPECT_FALSE(r.valid);
    EXPECT_TRUE(codesOf(r.errors).count("E_RUNTIME_TOO_OLD")) << resultJson(r);
    auto r6 = validateProject(kVectors + "/v05-ok-base-full", kSchemas);
    EXPECT_FALSE(r6.valid);
}

TEST(AlarmRules, MinRuntimeBelow080IsEMinRuntime) {
    auto r = validateProject(kVectors + "/v05-bad-min-runtime-0.7.0", kSchemas, kRuntime05);
    EXPECT_EQ(codesOf(r.errors), (std::set<std::string>{"E_MIN_RUNTIME"})) << resultJson(r);
}

TEST(AlarmRules, SchemaVersion06IsRefusedAsAWhole) {
    const fs::path dir = copyOf("v05-ok-base-full", "v06");
    for (const auto& e : fs::recursive_directory_iterator(dir))
        if (e.path().extension() == ".json") rewrite(e.path(), "\"0.5.0\"", "\"0.6.0\"");
    auto r = validateProject(dir.string(), kSchemas, "0.9.0");
    EXPECT_FALSE(r.valid);
    EXPECT_FALSE(r.project.has_value());
    // falls into the frozen 0.1 set like every unknown version: E_SCHEMA on project.json
    bool onProject = false;
    for (const auto& e : r.errors)
        if (e.file == "project.json" && e.code == "E_SCHEMA") onProject = true;
    EXPECT_TRUE(onProject) << resultJson(r);
}

TEST(AlarmRules, Format04UsesTheFrozen03SchemasAndNeeds070) {
    // a 0.3 vector renumbered to 0.4 (the minimal 0.4 of this branch) is valid on runtime 0.7
    const fs::path dir = copyOf("v03-valid-full", "v04");
    for (const auto& e : fs::recursive_directory_iterator(dir))
        if (e.path().extension() == ".json") rewrite(e.path(), "\"0.3.0\"", "\"0.4.0\"");
    rewrite(dir / "project.json", "\"minRuntimeVersion\": \"0.6.0\"",
            "\"minRuntimeVersion\": \"0.7.0\"");
    auto r = validateProject(dir.string(), kSchemas, "0.7.0");
    EXPECT_TRUE(r.valid) << resultJson(r);
    EXPECT_TRUE(r.project->is03());
    EXPECT_FALSE(r.project->is05());
    rewrite(dir / "project.json", "\"minRuntimeVersion\": \"0.7.0\"",
            "\"minRuntimeVersion\": \"0.6.0\"");
    auto r2 = validateProject(dir.string(), kSchemas, "0.7.0");
    EXPECT_EQ(codesOf(r2.errors), (std::set<std::string>{"E_MIN_RUNTIME"})) << resultJson(r2);
}

TEST(AlarmRules, IssuesAreSortedByFilePathCode) {
    auto r =
        validateProject(kVectors + "/v05-bad-class-ref-without-class-file", kSchemas, kRuntime05);
    ASSERT_GE(r.errors.size(), 2u);
    for (size_t i = 1; i < r.errors.size(); ++i) {
        const auto& a = r.errors[i - 1];
        const auto& b = r.errors[i];
        EXPECT_LE(std::tie(a.file, a.path, a.code), std::tie(b.file, b.path, b.code));
    }
}
