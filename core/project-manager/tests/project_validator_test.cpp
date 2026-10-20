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
        if (n == "." || n == ".." || n == "out") continue;  // out/: large 0.2 cases, run separately
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
    std::replace(n.begin(), n.end(), '.', '_');
    return n;
}
}  // namespace

class Vectors : public ::testing::TestWithParam<std::string> {};

TEST_P(Vectors, SameErrorCodesAsTypeScript) {
    const std::string dir = kVectors + "/" + GetParam();
    auto expected = readJson(dir + "/expected.json");
    // Feature 009: a v05-* case carries the runtime it is checked with (0.8.0; kRuntimeVersion is
    // raised at T125).
    const std::string runtime = expected.value("runtimeVersion", std::string(kRuntimeVersion));
    auto r = validateProject(dir, kSchemas, runtime);
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
    if (expected.contains("issues"))  // feature 007: {code, file, path} must be there as well
        for (const auto& want : expected["issues"]) {
            bool found = false;
            for (const auto* list : {&r.errors, &r.warnings})
                for (const auto& e : *list)
                    if (e.code == want["code"].get<std::string>() &&
                        e.file == want["file"].get<std::string>() &&
                        e.path == want["path"].get<std::string>())
                        found = true;
            EXPECT_TRUE(found) << "issue " << want << " " << resultJson(r);
        }
    if (expected.contains("spans"))  // expression errors: the same [start, end) in code points
        for (const auto& sp : expected["spans"]) {
            bool found = false;
            for (const auto& e : r.errors)
                if (e.code == sp["code"].get<std::string>() &&
                    e.spanStart == sp["span"][0].get<int>() &&
                    e.spanEnd == sp["span"][1].get<int>())
                    found = true;
            EXPECT_TRUE(found) << "span of " << sp["code"] << " " << resultJson(r);
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
                             std::replace(n.begin(), n.end(), '.', '_');
                             return n;
                         });

TEST(ProjectValidator, HasEnoughVectors) { EXPECT_GE(listCases().size(), 30u); }

// LoadedProject::files() (feature 005, data-model §8): the same list as `files` of every valid
// vector (tests/project-vectors, T015) and as projectFiles() of packages/project-schema.
class ProjectFilesVector : public ::testing::TestWithParam<std::string> {};

TEST_P(ProjectFilesVector, MatchesExpected) {
    const std::string dir = kVectors + "/" + GetParam();
    const auto expected = readJson(dir + "/expected.json");
    auto r = validateProject(dir, kSchemas,
                             expected.value("runtimeVersion", std::string(kRuntimeVersion)));
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
    return {id, {{"bindingFile", bindingFile}, {"svgFile", svgFile}}, nlohmann::json(), {}};
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

// T062 (security review S2), like check_rel of the Studio and packagePathError: no segment ending
// with '.' or ' ' (Windows drops them, so two names reach one file) and no Windows device name
// (CON, PRN, AUX, NUL, COM1-9, LPT1-9, any case, with or without extension, spaces before it).
TEST(ProjectValidator, SafePathRefusesWindowsTrailingDotSpaceAndDeviceNames) {
    for (const char* bad :
         {"a./b.json", "a /b.json", "screens /s.svg", "a.json.", "a.json ", "screens/CON.json",
          "con.svg", "nul.json", "nul.svg", "Prn.json", "aux/x.json", "Com1.json",
          "screens/lpt9.x.json", "COM9.svg", "con .json", "LPT1 .svg", "Con"})
        EXPECT_FALSE(isSafeRelPath(bad)) << bad;
    for (const char* ok : {"screens/console.json", "console.json", "com10.json", "com0.json",
                           "contact.json", "lpt.json", "nul-x.json", "auxiliary/x.svg",
                           ".mat-editor/autosave/a.svg", "value-tables/TrangThai.json"})
        EXPECT_TRUE(isSafeRelPath(ok)) << ok;
}

// ---- feature 006 (format 0.2) ----

TEST(ProjectValidator02, SchemaSetFollowsTheSchemaVersionOfProjectJson) {
    // The same directory layout validates as 0.1 or 0.2 by project.json alone.
    auto r01 = validateProject(std::string(MAT_SOURCE_DIR) + "/projects/tank-demo", kSchemas);
    ASSERT_TRUE(r01.valid) << resultJson(r01);
    EXPECT_FALSE(r01.project->is02());
    auto r02 = validateProject(kVectors + "/v02-valid-no-connections", kSchemas);
    ASSERT_TRUE(r02.valid) << resultJson(r02);
    EXPECT_TRUE(r02.project->is02());
}

TEST(ProjectValidator02, RuntimeVersionIsAParameter) {
    // v02 projects need 0.5.0 at least: an older runtime reports E_RUNTIME_TOO_OLD
    const std::string dir = kVectors + "/v02-valid-no-connections";
    auto ok = validateProject(dir, kSchemas, "0.5.0");
    EXPECT_TRUE(ok.valid) << resultJson(ok);
    auto old = validateProject(dir, kSchemas, "0.4.0");
    ASSERT_FALSE(old.valid);
    std::set<std::string> codes;
    for (auto& e : old.errors) codes.insert(e.code);
    EXPECT_TRUE(codes.count("E_RUNTIME_TOO_OLD")) << resultJson(old);
}

// T191: build 1.0.0-rc.1; feature 012: 1.1.0-alpha.1. minRuntimeVersion compares the numbers
// only, so 1.0 and 1.1 projects run.
TEST(ProjectValidator02, DefaultRuntimeVersionIs110Alpha1) {
    EXPECT_STREQ(kRuntimeVersion, "1.1.0-alpha.1");  // feature 012: format 1.1
    EXPECT_EQ(compareSemver("1.1.0", kRuntimeVersion), 0);
    EXPECT_LT(compareSemver("1.0.0", kRuntimeVersion), 0);
    EXPECT_GT(compareSemver("1.1.1", kRuntimeVersion), 0);
}

TEST(ProjectValidator02, Files02IncludeConnectionValueTableAndWatchTableFiles) {
    LoadedProject p;
    p.project = {{"schemaVersion", "0.2.0"},
                 {"tagFile", "tags.json"},
                 {"connectionFile", "connections.json"},
                 {"valueTables", nlohmann::json::array({"TrangThaiBom", "Mau"})},
                 {"watchTables", nlohmann::json::array({"van-hanh"})},
                 {"screens", nlohmann::json::array({"main"})}};
    p.screens.push_back(screenWith("main", "screens/main.bindings.json", "screens/main.svg"));
    EXPECT_EQ(p.files(), (std::vector<std::string>{
                             "connections.json", "project.json", "screens/main.bindings.json",
                             "screens/main.screen.json", "screens/main.svg", "tags.json",
                             "value-tables/Mau.json", "value-tables/TrangThaiBom.json",
                             "watch-tables/van-hanh.json"}));
}

// ---- feature 010 (format 0.6, T012, T033, T100) ----

TEST(ProjectValidator06, SchemaSetIsSixAndTheRuntimeRefusesAProjectWithRuleErrors) {
    const auto ok = validateProject(kVectors + "/v06-valid-full", kSchemas);
    ASSERT_TRUE(ok.valid) << resultJson(ok);
    EXPECT_TRUE(ok.project->is06());
    EXPECT_TRUE(ok.project->is03()) << "screens v1 and widgets, like 0.3";
    EXPECT_FALSE(validateProject(kVectors + "/v02-valid-no-connections", kSchemas).project->is06());
    // a 0.6 project with a rule error is neither valid nor handed out (the runtime does not
    // activate it)
    const auto bad =
        validateProject(kVectors + "/v06-logging-010-invalid-trigger-string", kSchemas);
    EXPECT_FALSE(bad.valid);
    EXPECT_FALSE(bad.project.has_value());
}

TEST(ProjectValidator06, AnOlderRuntimeRefusesAProject06) {
    // minRuntimeVersion 0.9.0 against runtime 0.8.0
    const auto r = validateProject(kVectors + "/v06-valid-full", kSchemas, "0.8.0");
    ASSERT_FALSE(r.valid);
    std::set<std::string> codes;
    for (const auto& e : r.errors) codes.insert(e.code);
    EXPECT_TRUE(codes.count("E_RUNTIME_TOO_OLD")) << resultJson(r);
}

TEST(ProjectValidator06, ReportsFileIsPartOfTheFilesAndTheAllowlist) {
    LoadedProject p;
    p.project = {{"schemaVersion", "0.6.0"},
                 {"tagFile", "tags.json"},
                 {"loggingFile", "logging.json"},
                 {"reportsFile", "reports.json"},
                 {"screens", nlohmann::json::array()}};
    EXPECT_EQ(p.files(), (std::vector<std::string>{"logging.json", "project.json", "reports.json",
                                                   "tags.json"}));
    EXPECT_EQ(p.allowlist().count("reports.json"), 1u);
}

// Catalog 0.6.0 (feature 014): the SVG of an image widget belongs to the project like the SVG of an
// svg item (files() of packages/project-schema projectFiles(), allowlist(), E_FILE_MISSING).
TEST(ProjectValidator014, ImageFileIsPartOfTheFilesAndTheAllowlist) {
    LoadedProject p;
    p.project = {{"schemaVersion", "1.1.0"}, {"tagFile", "tags.json"}, {"screens", {"main"}}};
    LoadedProject::Screen s;
    s.id = "main";
    s.screen = nlohmann::json::parse(R"({"items":[
        {"id":"a","type":"widget","widget":"image","props":{"src":"graphics/logo.svg"}},
        {"id":"b","type":"widget","widget":"image","props":{"src":"graphics/logo.svg"}},
        {"id":"c","type":"widget","widget":"image","props":{"src":""}},
        {"id":"d","type":"widget","widget":"image"},
        {"id":"e","type":"widget","widget":"label","props":{"src":"graphics/x.svg"}}]})");
    p.screens.push_back(s);
    EXPECT_EQ(p.files(), (std::vector<std::string>{"graphics/logo.svg", "project.json",
                                                   "screens/main.screen.json", "tags.json"}));
    EXPECT_EQ(p.allowlist().count("graphics/logo.svg"), 1u);
    EXPECT_EQ(p.allowlist().count("graphics/x.svg"), 0u);
    EXPECT_EQ(imageFileOf(s.screen["items"][0]), "graphics/logo.svg");
    EXPECT_EQ(imageFileOf(s.screen["items"][3]), "");
}

TEST(ProjectValidator014, TheSvgOfAnImageWidgetMustExist) {
    namespace fs = std::filesystem;
    const fs::path dir = fs::temp_directory_path() / "mat-validator-image-widget";
    fs::remove_all(dir);
    fs::copy(std::string(MAT_SOURCE_DIR) + "/projects/grid-demo", dir, fs::copy_options::recursive);
    const fs::path screenFile = dir / "screens/bang-dieu-khien.screen.json";
    nlohmann::json screen = readJson(screenFile.string());
    screen["layout"]["rows"].push_back(nlohmann::json::parse(
        R"({"id":"r99","height":200,"cells":[{"id":"c99","span":12,"item":"anh"}]})"));
    screen["items"].push_back(nlohmann::json::parse(
        R"({"id":"anh","type":"widget","widget":"image","props":{"src":"graphics/logo.svg"}})"));
    const size_t index = screen["items"].size() - 1;
    std::ofstream(screenFile, std::ios::trunc) << screen.dump(2);
    auto r = validateProject(dir.string(), kSchemas, "1.1.0");
    ASSERT_FALSE(r.valid);
    bool found = false;
    for (const auto& e : r.errors)
        if (e.code == "E_FILE_MISSING" &&
            e.path == "/items/" + std::to_string(index) + "/props/src")
            found = true;
    EXPECT_TRUE(found) << resultJson(r);
    fs::create_directories(dir / "graphics");
    std::ofstream(dir / "graphics/logo.svg", std::ios::trunc)
        << "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 4 2\"/>";
    r = validateProject(dir.string(), kSchemas, "1.1.0");
    EXPECT_TRUE(r.valid) << resultJson(r);
    ASSERT_TRUE(r.project);
    EXPECT_EQ(r.project->allowlist().count("graphics/logo.svg"), 1u);
    fs::remove_all(dir);
}

TEST(ProjectValidator06, HistoryDemoIsValidWithoutWarnings) {
    const auto r =
        validateProject(std::string(MAT_SOURCE_DIR) + "/projects/history-demo", kSchemas);
    ASSERT_TRUE(r.valid) << resultJson(r);
    EXPECT_TRUE(r.warnings.empty()) << resultJson(r);
    EXPECT_TRUE(r.project->is06());
}

TEST(ProjectValidator06, TheOlderFormatsKeepTheirVerdicts) {
    // 0.3 project vectors still pass with the frozen schemas of schemas/0.3
    const auto r = validateProject(kVectors + "/v03-valid-full", kSchemas, "0.6.0");
    EXPECT_TRUE(r.valid) << resultJson(r);
    EXPECT_FALSE(r.project->is06());
}

// Large cases of the 0.2 vectors (limits D12): generated into tests/project-vectors/out by
// `node tests/project-vectors/generate.mjs --out` on the host; skipped when absent.
namespace {
std::vector<std::string> listOutCases() {
    std::vector<std::string> out;
    const std::string dir = kVectors + "/out";
    if (DIR* d = opendir(dir.c_str())) {
        while (dirent* e = readdir(d)) {
            const std::string n = e->d_name;
            if (n != "." && n != "..") out.push_back(n);
        }
        closedir(d);
    }
    std::sort(out.begin(), out.end());
    if (out.empty()) out.push_back("absent");
    return out;
}
}  // namespace

class OutVectors : public ::testing::TestWithParam<std::string> {};

TEST_P(OutVectors, SameErrorCodesAsTypeScript) {
    if (GetParam() == "absent")
        GTEST_SKIP() << "run: node tests/project-vectors/generate.mjs --out";
    const std::string dir = kVectors + "/out/" + GetParam();
    const auto expected = readJson(dir + "/expected.json");
    auto r = validateProject(dir, kSchemas);
    std::set<std::string> got, want;
    for (auto& e : r.errors) got.insert(e.code);
    for (auto& e : expected["errors"]) want.insert(e.get<std::string>());
    EXPECT_EQ(got, want);
    EXPECT_EQ(r.valid, expected["valid"].get<bool>());
    if (expected.contains("warnings")) {
        std::set<std::string> gotW, wantW;
        for (auto& w : r.warnings) gotW.insert(w.code);
        for (auto& w : expected["warnings"]) wantW.insert(w.get<std::string>());
        EXPECT_EQ(gotW, wantW);
    }
    if (r.valid && expected.contains("files")) {
        std::vector<std::string> files;
        for (auto& f : expected["files"]) files.push_back(f.get<std::string>());
        EXPECT_EQ(r.project->files(), files);
    }
}

INSTANTIATE_TEST_SUITE_P(Large02, OutVectors, ::testing::ValuesIn(listOutCases()), caseName);

// ---- E_SERIAL_NOT_ALLOWED (feature 006 T165): a rule of the runtime, by the `serialPorts` of the
// configuration, after the console is taken out. Not in the shared vectors (it depends on the
// device); the validator runs it only when it is given a SerialPolicy.

namespace {

std::set<std::string> codesOf(const ProjectValidation& r) {
    std::set<std::string> c;
    for (const auto& e : r.errors) c.insert(e.code);
    return c;
}

SerialPolicy policy(std::vector<std::string> patterns, std::set<std::string> consoles = {}) {
    SerialPolicy p;
    p.allowPatterns = std::move(patterns);
    p.isConsole = [consoles](const std::string& port) { return consoles.count(port) != 0; };
    return p;
}

}  // namespace

TEST(ProjectValidator02, SerialPortOutOfTheListIsNotAllowed) {
    const std::string dir = kVectors + "/v02-valid-full";  // an RTU channel on ttyAS2
    ASSERT_TRUE(validateProject(dir, kSchemas).valid);

    const SerialPolicy ok = policy({"ttyAS*"});
    const auto allowed = validateProject(dir, kSchemas, kRuntimeVersion, &ok);
    EXPECT_TRUE(allowed.valid) << resultJson(allowed);

    const SerialPolicy usbOnly = policy({"ttyUSB*"});
    const auto bad = validateProject(dir, kSchemas, kRuntimeVersion, &usbOnly);
    ASSERT_FALSE(bad.valid);
    EXPECT_EQ(codesOf(bad), (std::set<std::string>{"E_SERIAL_NOT_ALLOWED"})) << resultJson(bad);
    ASSERT_EQ(bad.errors.size(), 1u);
    EXPECT_EQ(bad.errors[0].file, "connections.json");
    EXPECT_NE(bad.errors[0].path.find("/serial/port"), std::string::npos) << bad.errors[0].path;
    EXPECT_NE(bad.errors[0].message.find("ttyAS2"), std::string::npos);

    // the same name without the star, and a list that is empty
    const SerialPolicy exact = policy({"ttyAS2"});
    EXPECT_TRUE(validateProject(dir, kSchemas, kRuntimeVersion, &exact).valid);
    const SerialPolicy other = policy({"ttyAS3"});
    EXPECT_FALSE(validateProject(dir, kSchemas, kRuntimeVersion, &other).valid);
    const SerialPolicy none = policy({});
    EXPECT_FALSE(validateProject(dir, kSchemas, kRuntimeVersion, &none).valid);
}

TEST(ProjectValidator02, TheConsoleIsNeverAllowedEvenWhenThePatternMatches) {
    const std::string dir = kVectors + "/v02-valid-full";
    const SerialPolicy p = policy({"ttyAS*"}, {"ttyAS2"});
    const auto r = validateProject(dir, kSchemas, kRuntimeVersion, &p);
    ASSERT_FALSE(r.valid);
    EXPECT_EQ(codesOf(r), (std::set<std::string>{"E_SERIAL_NOT_ALLOWED"}));
    // another port of the same pattern is fine
    const SerialPolicy q = policy({"ttyAS*"}, {"ttyAS0"});
    EXPECT_TRUE(validateProject(dir, kSchemas, kRuntimeVersion, &q).valid);
}

TEST(ProjectValidator02, ByIdAndByPathPortsAreAllowedByTheirExactName) {
    const std::string byId = kVectors + "/v02-valid-serial-by-id";
    const std::string byPath = kVectors + "/v02-valid-serial-by-path";
    const SerialPolicy tty = policy({"ttyAS*", "ttyUSB*"});
    EXPECT_FALSE(validateProject(byId, kSchemas, kRuntimeVersion, &tty).valid)
        << "a tty pattern does not allow a /dev/serial path";
    const SerialPolicy id = policy({"/dev/serial/by-id/usb-FTDI_FT232R-if00-port0"});
    EXPECT_TRUE(validateProject(byId, kSchemas, kRuntimeVersion, &id).valid);
    EXPECT_FALSE(validateProject(byPath, kSchemas, kRuntimeVersion, &id).valid);
    const SerialPolicy path = policy({"/dev/serial/by-path/platform-xhci-hcd.1-usb-0:1:1.0-port0"});
    EXPECT_TRUE(validateProject(byPath, kSchemas, kRuntimeVersion, &path).valid);
    const SerialPolicy near = policy({"/dev/serial/by-id/usb-FTDI_FT232R-if00-port"});
    EXPECT_FALSE(validateProject(byId, kSchemas, kRuntimeVersion, &near).valid);
}

TEST(ProjectValidator02, WithoutAPolicyTheRuleIsNotRun) {
    // the shared vectors never carry it: the validator stays a function of the project files
    EXPECT_TRUE(validateProject(kVectors + "/v02-valid-full", kSchemas).valid);
    EXPECT_TRUE(validateProject(kVectors + "/v02-valid-serial-by-id", kSchemas).valid);
}

TEST(ProjectValidator02, TheRuleAddsToTheOtherErrorsAndKeepsTheWarnings) {
    const SerialPolicy usbOnly = policy({"ttyUSB*"});
    // a project with a warning (W_RTU_SCAN_TIME) and a port out of the list
    const auto r =
        validateProject(kVectors + "/v02-warn-rtu-scan-time", kSchemas, kRuntimeVersion, &usbOnly);
    EXPECT_FALSE(r.valid);
    std::set<std::string> warns;
    for (const auto& w : r.warnings) warns.insert(w.code);
    EXPECT_TRUE(warns.count("W_RTU_SCAN_TIME"));
    // a project that already fails by the shared rules (a port that is not a tty name) does not
    // get a second code for the same port
    const auto bad = validateProject(kVectors + "/v02-invalid-serial-port-windows", kSchemas,
                                     kRuntimeVersion, &usbOnly);
    EXPECT_TRUE(codesOf(bad).count("E_SERIAL_PORT"));
    EXPECT_FALSE(codesOf(bad).count("E_SERIAL_NOT_ALLOWED"));
}

// SAST (feature 011 T055, clang-tidy cert-err34-c): a component wider than int must not wrap. The
// schema allows up to 64 characters; sscanf("%d") wrapped such a component (2147483648 became
// negative on x64), so a project asking for a runtime that large could pass minRuntimeVersion.
TEST(CompareSemver, OrdersEachComponentAsANumber) {
    EXPECT_GT(compareSemver("1.2.10", "1.2.9"), 0);
    EXPECT_LT(compareSemver("0.9.0", "1.0.0"), 0);
    EXPECT_EQ(compareSemver("1.0.0", "1.0.0"), 0);
    EXPECT_EQ(compareSemver("1.0.0-rc.1", "1.0.0"), 0);  // a pre-release tag is not compared
}

TEST(CompareSemver, AComponentWiderThanIntIsStillGreater) {
    EXPECT_GT(compareSemver("99999999999.0.0", "1.0.0"), 0);
    EXPECT_LT(compareSemver("1.0.0", "99999999999.0.0"), 0);
    EXPECT_GT(compareSemver("1.0.99999999999999999999", "1.0.5"), 0);
    EXPECT_GT(compareSemver("2147483648.0.0", "2147483647.0.0"), 0);
}
