// The shared vectors v04-* (tests/project-vectors, feature 008): the C++ validator gives the same
// verdict as the TypeScript one on every case: the set of error codes, the set of warning codes,
// the {code, file, path} of `issues`, and for a valid case the file list. The large cases
// (v04-large-*) are generated into tests/project-vectors/out by
// `node tests/project-vectors/generate.mjs --out04`; they are skipped when absent.
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

// Directories of `root` whose name starts with `prefix`.
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

void check(const std::string& dir) {
    const json expected = readJson(dir + "/expected.json");
    const ProjectValidation r = validateProject(dir, kSchemas);
    std::set<std::string> got, want;
    for (const auto& e : r.errors) got.insert(e.code);
    for (const auto& e : expected["errors"]) want.insert(e.get<std::string>());
    EXPECT_EQ(got, want) << resultJson(r);
    EXPECT_EQ(r.valid, expected["valid"].get<bool>()) << resultJson(r);
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
    }
}

std::vector<std::string> largeCases() {
    auto l = list(kVectors + "/out", "v04-");
    if (l.empty()) l.push_back("absent");
    return l;
}

}  // namespace

class Vectors04 : public ::testing::TestWithParam<std::string> {};
TEST_P(Vectors04, SameVerdictAsTypeScript) { check(kVectors + "/" + GetParam()); }
INSTANTIATE_TEST_SUITE_P(Small04, Vectors04, ::testing::ValuesIn(list(kVectors, "v04-")),
                         caseName);

class LargeVectors04 : public ::testing::TestWithParam<std::string> {};
TEST_P(LargeVectors04, SameVerdictAsTypeScript) {
    if (GetParam() == "absent")
        GTEST_SKIP() << "run: node tests/project-vectors/generate.mjs --out04";
    check(kVectors + "/out/" + GetParam());
}
INSTANTIATE_TEST_SUITE_P(Large04, LargeVectors04, ::testing::ValuesIn(largeCases()), caseName);

TEST(Vectors04Set, HasEnoughCases) { EXPECT_GE(list(kVectors, "v04-").size(), 100u); }
