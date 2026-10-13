// T028 (feature 007; FR-004, FR-009, SC-012): the widget catalog and the 0.3 rules on the vectors
// shared with TypeScript (tests/widget-catalog-vectors, contract widget-catalog.md §4). Each case
// is one screen `main` plus the standard Tags, connection and value table; the validator runs on
// the project built as the README of the vectors says, and the {code, path} pairs of every error
// and warning in screens/main.screen.json must be exactly those of expect.json (as multisets).
#include "core/project-manager/widget_catalog.hpp"

#include <dirent.h>
#include <gtest/gtest.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <set>
#include <sstream>

#include "core/project-manager/project_validator.hpp"
#include "nlohmann/json.hpp"

using namespace mat;
using nlohmann::json;
namespace fs = std::filesystem;

namespace {

const std::string kVectors = std::string(MAT_SOURCE_DIR) + "/tests/widget-catalog-vectors";
const std::string kSchemas = std::string(MAT_SOURCE_DIR) + "/schemas";

std::string readText(const fs::path& p) {
    std::ifstream f(p, std::ios::binary);
    std::stringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

std::vector<std::string> listCases() {
    std::vector<std::string> out;
    DIR* d = opendir(kVectors.c_str());
    if (!d) return out;
    while (dirent* e = readdir(d)) {
        const std::string n = e->d_name;
        if (n == "." || n == "..") continue;
        struct stat st {};
        if (stat((kVectors + "/" + n).c_str(), &st) == 0 && S_ISDIR(st.st_mode)) out.push_back(n);
    }
    closedir(d);
    std::sort(out.begin(), out.end());
    return out;
}

// A temporary project directory that is removed at the end.
struct TempProject {
    TempProject() {
        char tmpl[] = "/tmp/mat-catvec-XXXXXX";
        path = mkdtemp(tmpl) ? tmpl : "";
    }
    ~TempProject() {
        std::error_code ec;
        if (!path.empty()) fs::remove_all(path, ec);
    }
    std::string path;
};

}  // namespace

class CatalogVectors : public ::testing::TestWithParam<std::string> {};

TEST_P(CatalogVectors, SameCodesAndPathsAsTypeScript) {
    const fs::path dir = fs::path(kVectors) / GetParam();
    TempProject tp;
    ASSERT_FALSE(tp.path.empty());
    const fs::path root = tp.path;
    // every file of the case but screen.json and expect.json keeps its path
    for (const auto& e : fs::recursive_directory_iterator(dir)) {
        if (!e.is_regular_file()) continue;
        const fs::path rel = fs::relative(e.path(), dir);
        if (rel == "screen.json" || rel == "expect.json") continue;
        fs::create_directories((root / rel).parent_path());
        fs::copy_file(e.path(), root / rel, fs::copy_options::overwrite_existing);
    }
    fs::create_directories(root / "screens");
    fs::copy_file(dir / "screen.json", root / "screens/main.screen.json",
                  fs::copy_options::overwrite_existing);
    std::vector<std::string> screens = {"main"};
    if (fs::exists(dir / "screens")) {
        std::vector<std::string> extra;
        for (const auto& e : fs::directory_iterator(dir / "screens")) {
            const std::string n = e.path().filename().string();
            const std::string suffix = ".screen.json";
            if (n.size() > suffix.size() &&
                n.compare(n.size() - suffix.size(), suffix.size(), suffix) == 0)
                extra.push_back(n.substr(0, n.size() - suffix.size()));
        }
        std::sort(extra.begin(), extra.end());
        screens.insert(screens.end(), extra.begin(), extra.end());
    }
    const json project = {{"format", "matscada-project"},    {"schemaVersion", "0.3.0"},
                          {"projectId", "catalog-vector"},   {"projectName", "Catalog vector"},
                          {"projectVersion", "0.1.0"},       {"minRuntimeVersion", "0.6.0"},
                          {"entryScreen", "main"},           {"screens", screens},
                          {"tagFile", "tags.json"},          {"connectionFile", "connections.json"},
                          {"valueTables", {"TrangThaiBom"}}, {"maxClients", 10}};
    std::ofstream(root / "project.json") << project.dump(2);

    const ProjectValidation r = validateProject(root.string(), kSchemas, "0.6.0");
    std::multiset<std::pair<std::string, std::string>> got, want;
    for (const auto& e : r.errors)
        if (e.file == "screens/main.screen.json") got.insert({e.code, e.path});
    for (const auto& w : r.warnings)
        if (w.file == "screens/main.screen.json") got.insert({w.code, w.path});
    for (const auto& x : json::parse(readText(dir / "expect.json")))
        want.insert({x["code"].get<std::string>(), x["path"].get<std::string>()});
    EXPECT_EQ(got, want) << resultJson(r);
}

INSTANTIATE_TEST_SUITE_P(WidgetCatalogVectors, CatalogVectors, ::testing::ValuesIn(listCases()),
                         [](const ::testing::TestParamInfo<std::string>& i) {
                             std::string n = i.param;
                             std::replace(n.begin(), n.end(), '-', '_');
                             return n;
                         });

TEST(WidgetCatalogVectors, EnoughCases) { EXPECT_GE(listCases().size(), 100u); }

// ---- the catalog itself ----

TEST(WidgetCatalog, LoadsTheFifteenWidgetsOnce) {
    std::string err;
    const auto cat = WidgetCatalog::loadFromDir(kSchemas, err);
    ASSERT_TRUE(cat) << err;
    EXPECT_EQ(cat->version(), "0.3.0");
    EXPECT_EQ(cat->widgets().size(), 15u);
    for (const char* id : {"card", "gauge", "lamp", "bar", "level", "pie", "line", "tag-table",
                           "panel", "label", "button", "switch", "setpoint", "slider", "select"})
        EXPECT_NE(cat->find(id), nullptr) << id;
    EXPECT_EQ(cat->find("Card"), nullptr) << "ids are case sensitive";
    EXPECT_EQ(cat->find("nope"), nullptr);
    const WidgetSpec* setpoint = cat->find("setpoint");
    ASSERT_NE(setpoint, nullptr);
    EXPECT_TRUE(setpoint->slot("target"));
    EXPECT_TRUE(setpoint->slot("target")->needsWrite);
    EXPECT_TRUE(setpoint->hasSecurity);
    EXPECT_NE(setpoint->prop("step"), nullptr);
    EXPECT_EQ(cat->find("line")->group, "chart");
}

TEST(WidgetCatalog, AMissingOrDamagedFileGivesNoCatalogAndAReason) {
    std::string err;
    EXPECT_EQ(WidgetCatalog::loadFromDir("/nonexistent", err), nullptr);
    EXPECT_FALSE(err.empty());
    err.clear();
    EXPECT_EQ(WidgetCatalog::fromJson(json::parse("{\"widgets\": 3}"), err), nullptr);
    EXPECT_FALSE(err.empty());
    err.clear();
    EXPECT_EQ(WidgetCatalog::fromJson(json::parse("{\"widgets\":[{\"id\":\"x\"}]}"), err), nullptr);
    EXPECT_FALSE(err.empty());
}

TEST(WidgetCatalog, TagClassesAndLengthsInCodePoints) {
    EXPECT_EQ(tagClassOf("BOOL"), "bool");
    EXPECT_EQ(tagClassOf("STRING"), "string");
    for (const char* t : {"INT16", "UINT64", "FLOAT32", "FLOAT64"})
        EXPECT_EQ(tagClassOf(t), "number");
    EXPECT_EQ(codePointCount("abc"), 3u);
    EXPECT_EQ(codePointCount("Bồn nước"), 8u) << "characters, not bytes";
    EXPECT_EQ(codePointCount(""), 0u);
}

TEST(WidgetCatalog, PropertyValuesByKind) {
    const auto ok = [](const char* spec, const char* v) {
        return checkPropValue(json::parse(spec), json::parse(v)).empty();
    };
    EXPECT_TRUE(ok(R"({"kind":"string","maxLength":4})", "\"abcd\""));
    EXPECT_FALSE(ok(R"({"kind":"string","maxLength":4})", "\"abcde\""));
    EXPECT_FALSE(ok(R"({"kind":"string"})", "1"));
    EXPECT_TRUE(ok(R"({"kind":"int","min":0,"max":6})", "6"));
    EXPECT_TRUE(ok(R"({"kind":"int","min":0,"max":6})", "3.0"))
        << "an integral float is an integer";
    EXPECT_FALSE(ok(R"({"kind":"int","min":0,"max":6})", "7"));
    EXPECT_FALSE(ok(R"({"kind":"int"})", "1.5"));
    EXPECT_FALSE(ok(R"({"kind":"int"})", "\"1\""));
    EXPECT_TRUE(ok(R"({"kind":"number","exclusiveMin":0})", "0.5"));
    EXPECT_FALSE(ok(R"({"kind":"number","exclusiveMin":0})", "0"));
    EXPECT_TRUE(ok(R"({"kind":"bool"})", "true"));
    EXPECT_FALSE(ok(R"({"kind":"bool"})", "1"));
    EXPECT_TRUE(ok(R"({"kind":"enum","options":["s","m"]})", "\"m\""));
    EXPECT_FALSE(ok(R"({"kind":"enum","options":["s","m"]})", "\"xl\""));
    EXPECT_TRUE(ok(R"({"kind":"color","allowAuto":true})", "\"auto\""));
    EXPECT_FALSE(ok(R"({"kind":"color"})", "\"auto\""));
    EXPECT_TRUE(ok(R"({"kind":"color"})", "\"#0aF09b\""));
    EXPECT_FALSE(ok(R"({"kind":"color"})", "\"#0aF09\""));
    EXPECT_FALSE(ok(R"({"kind":"color"})", "\"#0aF09g\""));
    EXPECT_TRUE(ok(R"({"kind":"tableRef"})", "\"T\""));
    EXPECT_FALSE(ok(R"({"kind":"tableRef"})", "\"\""));
    const char* arr = R"({"kind":"array","maxItems":2,"unique":true,"items":{"kind":"string"}})";
    EXPECT_TRUE(ok(arr, R"(["a","b"])"));
    EXPECT_FALSE(ok(arr, R"(["a","a"])"));
    EXPECT_FALSE(ok(arr, R"(["a","b","c"])"));
    EXPECT_FALSE(ok(arr, R"(["a",1])"));
    const char* zones =
        R"({"name":"zones","kind":"array","items":{"kind":"object","fields":[{"name":"from","kind":"number"},{"name":"to","kind":"number"}]}})";
    EXPECT_TRUE(ok(zones, R"([{"from":0,"to":10},{"from":10,"to":20}])"));
    EXPECT_FALSE(ok(zones, R"([{"from":0,"to":10},{"from":5,"to":20}])"));
    EXPECT_FALSE(ok(zones, R"([{"from":5,"to":5}])"));
    EXPECT_FALSE(ok(zones, R"([{"from":0}])"));
    EXPECT_FALSE(ok(zones, R"([{"from":0,"to":1,"x":2}])"));
}
