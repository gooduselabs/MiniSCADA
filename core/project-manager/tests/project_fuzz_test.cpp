// Fuzz of the project loader and validator, C++ side (feature 011 T058; FR-029; the TS twin is
// tools/fuzz/targets/project-json.mjs). Corpus tests/fuzz-corpus/project-json.json (small projects
// of every format 0.1 to 1.0 from tests/project-vectors, valid and not). Each case takes a project,
// changes 1 to 4 of its files (text mutations, JSON structure mutations, a file removed, a file of
// another project copied in, a `schemaVersion` swapped), writes it to a temporary directory and
// runs validateProject as the runtime and --check-package do. Invariants: no crash, no hang, no
// sanitizer report (ASan + UBSan build of tools/fuzz/cpp/run.sh); valid <=> no error; error codes
// E_*, warnings W_*, every issue has a file or a code; deterministic (every 16th case twice: the
// same codes); a valid project has its loaded parts and files() lists project.json.
// MAT_FUZZ_SECONDS (default 5 under ctest), MAT_FUZZ_SEED.
#include <gtest/gtest.h>
#include <unistd.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>

#include "core/common/tests/fuzz_util.hpp"
#include "core/project-manager/project_validator.hpp"
#include "nlohmann/json.hpp"

using nlohmann::json;
using namespace mat;
namespace fs = std::filesystem;

namespace {

struct Project {
    std::string name;
    std::map<std::string, std::string> files;
};

std::vector<Project> loadCorpus() {
    std::ifstream f(std::string(MAT_SOURCE_DIR) + "/tests/fuzz-corpus/project-json.json");
    std::stringstream ss;
    ss << f.rdbuf();
    std::vector<Project> out;
    for (const json& p : json::parse(ss.str())) {
        Project k;
        k.name = p["name"].get<std::string>();
        for (auto it = p["files"].begin(); it != p["files"].end(); ++it)
            k.files[it.key()] = it.value().get<std::string>();
        out.push_back(std::move(k));
    }
    return out;
}

std::string codes(const ProjectValidation& v) {
    std::string s = v.valid ? "valid" : "invalid";
    for (const auto& e : v.errors) s += " " + e.code + ":" + e.file + e.path;
    s += " |";
    for (const auto& w : v.warnings) s += " " + w.code + ":" + w.file + w.path;
    return s;
}

}  // namespace

TEST(ProjectFuzz, MutatedProjectsNeverCrash) {
    const std::vector<Project> corpus = loadCorpus();
    ASSERT_GT(corpus.size(), 20u);
    fuzz::Dict dict;
    for (const Project& p : corpus)
        for (const auto& [rel, text] : p.files)
            if (rel.size() > 5 && rel.compare(rel.size() - 5, 5, ".json") == 0) {
                const json j = json::parse(text, nullptr, false);
                if (!j.is_discarded()) fuzz::collect(j, dict);
            }
    std::vector<std::string> textDict = dict.keys;
    textDict.insert(textDict.end(), dict.strings.begin(), dict.strings.end());
    static const char* kVersions[] = {"0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0",
                                      "0.6.0", "1.0.0", "1.0.9", "1.1.0", "99.0.0"};

    const fs::path work =
        fs::temp_directory_path() / ("mat-project-fuzz-" + std::to_string(::getpid()));
    const std::string schemasDir = std::string(MAT_SOURCE_DIR) + "/schemas";
    const double budget = fuzz::budgetSeconds(5);
    const uint64_t seed = fuzz::baseSeed();
    fuzz::Rng r{seed ^ 0x70726f6aull};  // "proj"
    fuzz::Deadline deadline(budget);
    int64_t cases = 0, valid = 0;
    std::map<std::string, int64_t> byCode, byOp;
    while (!deadline.passed()) {
        ++cases;
        const Project& base = corpus[r.below(corpus.size())];
        std::map<std::string, std::string> files = base.files;
        std::vector<std::string> names;
        for (const auto& [rel, t] : files) names.push_back(rel);
        const int edits = r.chance(70) ? 1 : 2 + static_cast<int>(r.below(3));
        for (int k = 0; k < edits; ++k) {
            std::string rel = (r.chance(40) && files.count("project.json"))
                                  ? std::string("project.json")
                                  : names[r.below(names.size())];
            if (!files.count(rel)) continue;
            std::string& text = files[rel];
            const size_t op = r.below(100);
            if (op < 4) {
                files.erase(rel);
                ++byOp["remove"];
            } else if (op < 8) {  // a file of another project under this name
                const Project& other = corpus[r.below(corpus.size())];
                auto it = other.files.begin();
                std::advance(it, static_cast<long>(r.below(other.files.size())));
                text = it->second;
                ++byOp["swap"];
            } else if (op < 14) {
                json j = json::parse(text, nullptr, false);
                if (j.is_object()) {
                    j["schemaVersion"] = kVersions[r.below(sizeof kVersions / sizeof kVersions[0])];
                    text = j.dump(2, ' ', false, json::error_handler_t::replace);
                }
                ++byOp["version"];
            } else if (op < 60) {
                json j = json::parse(text, nullptr, false);
                if (!j.is_discarded()) {
                    text = fuzz::mutateJson(j, r, dict)
                               .dump(r.chance(50) ? 2 : -1, ' ', false,
                                     json::error_handler_t::replace);
                    ++byOp["json"];
                } else {
                    text = fuzz::mutateText(text, r, textDict);
                    ++byOp["text"];
                }
            } else {
                text = fuzz::mutateText(text, r, textDict);
                ++byOp["text"];
            }
        }
        fs::remove_all(work);
        for (const auto& [rel, text] : files) {
            const fs::path p = work / rel;
            fs::create_directories(p.parent_path());
            std::ofstream f(p, std::ios::binary | std::ios::trunc);
            f << text;
        }
        fs::create_directories(work);
        const std::string where = "case " + std::to_string(cases) + " seed " +
                                  std::to_string(seed) + " (" + base.name + ")";
        ProjectValidation v;
        ASSERT_NO_THROW(v = validateProject(work.string(), schemasDir)) << where;
        ASSERT_EQ(v.valid, v.errors.empty()) << where;
        for (const auto& e : v.errors) {
            ASSERT_EQ(e.code.rfind("E_", 0), 0u) << where << " " << e.code;
            ASSERT_FALSE(e.message.empty()) << where << " " << e.code;
            ++byCode[e.code];
        }
        for (const auto& w : v.warnings)
            ASSERT_EQ(w.code.rfind("W_", 0), 0u) << where << " " << w.code;
        if (v.valid) {
            ++valid;
            ++byCode["valid"];
            ASSERT_TRUE(v.project.has_value()) << where;
            const std::vector<std::string> list = v.project->files();
            ASSERT_TRUE(std::find(list.begin(), list.end(), "project.json") != list.end()) << where;
            (void)v.project->activeJson();
            (void)v.project->helloJson();
        }
        (void)resultJson(v);
        if (cases % 16 == 0) {
            const ProjectValidation again = validateProject(work.string(), schemasDir);
            ASSERT_EQ(codes(v), codes(again)) << where;
        }
    }
    fs::remove_all(work);
    std::cout << "fuzz project-json: " << cases << " inputs, " << valid << " valid, seed " << seed
              << ", " << budget << " s\n[ fuzz     ]";
    for (const auto& [k, n] : byOp) std::cout << " " << k << "=" << n;
    std::cout << "\n[ fuzz     ]";
    for (const auto& [k, n] : byCode) std::cout << " " << k << "=" << n;
    std::cout << "\n";
    EXPECT_GT(valid, 0);
}
