// The shared vectors of the access model (feature 013, contracts/access-model.md §7): every case of
// tests/access-vectors/<name>/ (catalog.json, access.json, principal.json, expected.json) through
// computeAccess, as the Vitest runner of packages/access-model does. MAT_ACCESS_VECTORS names
// another directory. Skipped while the directory does not exist (the generator is another task).
#include <dirent.h>
#include <gtest/gtest.h>
#include <sys/stat.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "core/auth/access_model.hpp"

namespace mat {
namespace {

using nlohmann::json;

std::string vectorsDir() {
    if (const char* d = std::getenv("MAT_ACCESS_VECTORS"); d && *d) return d;
    return std::string(MAT_SOURCE_DIR) + "/tests/access-vectors";
}

bool isDir(const std::string& p) {
    struct stat st {};
    return ::stat(p.c_str(), &st) == 0 && S_ISDIR(st.st_mode);
}

std::vector<std::string> caseNames(const std::string& dir) {
    std::vector<std::string> out;
    if (DIR* d = ::opendir(dir.c_str())) {
        while (dirent* e = ::readdir(d)) {
            const std::string n = e->d_name;
            if (n.empty() || n[0] == '.') continue;
            if (isDir(dir + "/" + n) && std::ifstream(dir + "/" + n + "/expected.json").good())
                out.push_back(n);
        }
        ::closedir(d);
    }
    std::sort(out.begin(), out.end());
    return out;
}

json readJson(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    std::ostringstream s;
    s << in.rdbuf();
    return json::parse(s.str(), nullptr, false);
}

TEST(AccessVectors, EveryCaseGivesTheExpectedAnswer) {
    const std::string dir = vectorsDir();
    if (!isDir(dir))
        GTEST_SKIP() << dir << " does not exist yet (tests/access-vectors/generate.mjs)";
    const std::vector<std::string> names = caseNames(dir);
    ASSERT_FALSE(names.empty()) << "no case in " << dir;
    size_t ran = 0;
    for (const std::string& name : names) {
        SCOPED_TRACE(name);
        const std::string base = dir + "/" + name + "/";
        const json cj = readJson(base + "catalog.json");
        const json aj = readJson(base + "access.json");
        const json pj = readJson(base + "principal.json");
        const json expected = readJson(base + "expected.json");
        ASSERT_FALSE(cj.is_discarded() || aj.is_discarded() || pj.is_discarded() ||
                     expected.is_discarded());
        std::string error;
        const auto catalog = catalogFromJson(cj, error);
        ASSERT_TRUE(catalog) << error;
        const AccessParse store = parseAccessFile(aj.dump());
        ASSERT_TRUE(store.ok) << store.error;
        Principal p;
        if (pj.contains("user") && pj["user"].is_string()) p.user = pj["user"].get<std::string>();
        const auto role = parseRole(pj.value("role", std::string("viewer")));
        ASSERT_TRUE(role);
        p.role = *role;
        if (pj.contains("groups"))
            for (const auto& g : pj["groups"]) p.groups.push_back(g.get<std::string>());
        const bool storeValid = !pj.contains("storeValid") || pj["storeValid"].get<bool>();
        const json got =
            effectiveAccessVectorJson(computeAccess(*catalog, store.file, p, storeValid));
        // The keys of expected.json; an absent key is not checked.
        for (const auto& kv : expected.items()) {
            ASSERT_TRUE(got.contains(kv.key())) << "no key " << kv.key();
            EXPECT_EQ(got[kv.key()], kv.value()) << "key " << kv.key();
        }
        ++ran;
    }
    EXPECT_EQ(ran, names.size());
    std::printf("access vectors: %zu cases from %s\n", ran, dir.c_str());
}

}  // namespace
}  // namespace mat
