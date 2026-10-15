// T018 (feature 005, contracts/matscada-package.md §4): the content digest, on the same vectors as
// packages/project-schema/src/package-digest.test.ts and the Studio's Rust code:
// - tests/package-vectors: every vector with `digest` and `files` (digest-*, valid packages).
//   Vectors with only an error `code`, or a digest but no `files` (a generated package), need the
//   package reader (US2);
// - tests/project-vectors: `digest` of every valid vector, from the bytes of its `files` on disk.
#include "core/package/digest.hpp"

#include <dirent.h>
#include <gtest/gtest.h>
#include <sys/stat.h>

#include <algorithm>
#include <fstream>
#include <regex>
#include <sstream>
#include <stdexcept>

#include "nlohmann/json.hpp"

using namespace mat;
using nlohmann::json;

namespace {

const std::string kPackageVectors = std::string(MAT_SOURCE_DIR) + "/tests/package-vectors";
const std::string kProjectVectors = std::string(MAT_SOURCE_DIR) + "/tests/project-vectors";

std::string readFile(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) ADD_FAILURE() << "cannot read " << path;
    std::stringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

bool exists(const std::string& path) {
    struct stat st {};
    return stat(path.c_str(), &st) == 0;
}

// Vector directories are those with an expected.json (out/, of the big generated packages, has
// none).
std::vector<std::string> vectorDirs(const std::string& root) {
    std::vector<std::string> out;
    DIR* d = opendir(root.c_str());
    if (!d) return out;
    while (const dirent* e = readdir(d)) {
        const std::string n = e->d_name;
        if (n != "." && n != ".." && exists(root + "/" + n + "/expected.json")) out.push_back(n);
    }
    closedir(d);
    std::sort(out.begin(), out.end());
    return out;
}

json expectedOf(const std::string& root, const std::string& dir) {
    return json::parse(readFile(root + "/" + dir + "/expected.json"));
}

std::vector<PackageFile> filesOf(const json& list) {
    std::vector<PackageFile> out;
    for (const auto& f : list)
        out.push_back({f["path"].get<std::string>(), f["size"].get<int64_t>(),
                       f["sha256"].get<std::string>()});
    return out;
}

std::vector<std::string> packageDigestVectors() {
    std::vector<std::string> out;
    for (const auto& d : vectorDirs(kPackageVectors)) {
        const json e = expectedOf(kPackageVectors, d);
        if (e.contains("digest") && e["digest"].is_string() && e.contains("files") &&
            e["files"].is_array())
            out.push_back(d);
    }
    return out;
}

std::vector<std::string> validProjectVectors() {
    std::vector<std::string> out;
    for (const auto& d : vectorDirs(kProjectVectors))
        if (expectedOf(kProjectVectors, d).value("valid", false)) out.push_back(d);
    return out;
}

std::string paramName(const ::testing::TestParamInfo<std::string>& i) {
    std::string n = i.param;
    std::replace(n.begin(), n.end(), '-', '_');
    std::replace(n.begin(), n.end(), '.', '_');  // vectors such as v05-ok-min-runtime-0.8.0
    return n;
}

PackageFile file(std::string path, int64_t size, std::string sha256) {
    return {std::move(path), size, std::move(sha256)};
}

// The example of contract §4, also the vector digest-basic.
const std::vector<PackageFile> kBasic = {
    file("project.json", 21, "c2de611dec8c30e06c2e27e6cbf5ea4a95e27c75b88f4791c0ad700b62ac8310"),
    file("screens/main.svg", 42,
         "fb91f9a03c202c5f160eef644da6f2f704b19ac5c5f8b4c124e1b0b485ad57a0"),
    file("tags.json", 36, "b7869ffaa4571f9761542fbb1656a6e75e11bb2cfc4284dc844241dbdc6ba0f2")};
const std::string kBasicDigest =
    "sha256:c337083b40dd7b12f8db0ace06bfb5fb8bb682931ef795cbf030dfcd0e14e119";
const std::string H(64, 'a');

}  // namespace

TEST(PackageDigest, ContractExample) {
    EXPECT_EQ(digestText(kBasic), kBasic[0].sha256 + " 21 project.json\n" + kBasic[1].sha256 +
                                      " 42 screens/main.svg\n" + kBasic[2].sha256 +
                                      " 36 tags.json\n");
    EXPECT_EQ(packageDigest(kBasic), kBasicDigest);
}

TEST(PackageDigest, SizeInDecimalWithoutLeadingZeros) {
    EXPECT_EQ(digestText({file("a.json", 0, H), file("b.json", 7, H), file("c.json", 1000, H)}),
              H + " 0 a.json\n" + H + " 7 b.json\n" + H + " 1000 c.json\n");
    EXPECT_EQ(digestText({file("big.svg", 52428800, H)}), H + " 52428800 big.svg\n");
}

TEST(PackageDigest, SortedByUtf8BytesNotByLocale) {
    const std::vector<std::string> sorted = {
        "Z.json",    // 0x5A: an upper case letter sorts before every lower case one
        "a b.json",  // 0x20
        "a-b.json",  // 0x2D
        "a.json",    // 0x2E
        "a/b.json",  // 0x2F: the whole string compares, not segment by segment
        "screens/10.svg", "screens/9.svg", "screens/z.svg",
        "screens/ơ.svg",   // U+01A1 (C6 A1)
        "screens/ｆ.svg",  // U+FF46 (EF BD 86)
        "screens/😀.svg",   // U+1F600 (F0 9F 98 80); in UTF-16 units it would precede U+FF46
    };
    std::vector<PackageFile> files;
    for (auto it = sorted.rbegin(); it != sorted.rend(); ++it) files.push_back(file(*it, 1, H));
    std::vector<std::string> paths;
    std::istringstream lines(digestText(files));
    for (std::string line; std::getline(lines, line);) paths.push_back(line.substr(64 + 3));
    EXPECT_EQ(paths, sorted);
}

TEST(PackageDigest, CompareUtf8LikeMemcmp) {
    EXPECT_LT(compareUtf8("a", "b"), 0);
    EXPECT_GT(compareUtf8("b", "a"), 0);
    EXPECT_EQ(compareUtf8("ệ", "ệ"), 0);
    EXPECT_LT(compareUtf8("a", "a/"), 0);  // a prefix sorts first
    EXPECT_LT(compareUtf8("Z", "a"), 0);
    EXPECT_LT(compareUtf8("ｆ", "😀"), 0);
    EXPECT_GT(compareUtf8("😀", "ｆ"), 0);
    EXPECT_GT(compareUtf8("\x80", "\x7f"), 0);  // bytes compare unsigned
}

TEST(PackageDigest, IndependentOfInputOrder) {
    const std::vector<PackageFile> reversed(kBasic.rbegin(), kBasic.rend());
    EXPECT_EQ(packageDigest(reversed), kBasicDigest);
    EXPECT_EQ(digestText(reversed), digestText(kBasic));
}

TEST(PackageDigest, PackageFileTakesBytesAsTheyAre) {
    const PackageFile f = packageFile("a.json", "{\"b\":\"ệ\"}\n");
    EXPECT_EQ(f.path, "a.json");
    EXPECT_EQ(f.size, 12);
    EXPECT_EQ(f.sha256, "8084da7e199ff983bee26591af5b5949bc883ab4e47f1429aa09386f1a6119c6");
    const PackageFile bom = packageFile("b.json", "\xEF\xBB\xBF{}");  // a BOM stays
    EXPECT_EQ(bom.size, 5);
    EXPECT_EQ(bom.sha256, "aa25e978046d680ef8740d837e6de5bc1e2a2dc6089dbda1012544b538d53f65");
    const PackageFile raw = packageFile("c.svg", std::string("<s\xEA\xD2", 4));  // not UTF-8
    EXPECT_EQ(raw.size, 4);
    EXPECT_EQ(raw.sha256, "9c4c8cc4c235378af7a25c18e5dc1005c2151a8afb5a04e598bc27f61a181840");
    EXPECT_EQ(packageFile("d.json", "").sha256,
              "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
}

TEST(PackageDigest, RefusesMalformedEntries) {
    const std::vector<std::vector<PackageFile>> bad = {
        {file("a.json", 1, H), file("a.json", 2, H)},  // duplicate path
        {file("a.json", 1, std::string(64, 'A'))},     // upper case hex
        {file("a.json", 1, std::string(63, 'a'))},
        {file("a.json", 1, std::string(65, 'a'))},
        {file("a.json", 1, std::string(64, 'g'))},
        {file("a.json", -1, H)},
        {file("", 1, H)},
        {file("a\n.json", 1, H)},  // a control character would mix up the lines
        {file("a\x7f.json", 1, H)},
        {file(std::string("a\0.json", 7), 1, H)},
        {file("a\xED\xA0\x80.json", 1, H)},  // a lone surrogate (U+D800): not UTF-8
        {file("a\xC3.json", 1, H)},          // cut sequence
    };
    for (const auto& files : bad) {
        EXPECT_THROW(digestText(files), std::invalid_argument) << files[0].path;
        EXPECT_THROW(packageDigest(files), std::invalid_argument) << files[0].path;
    }
}

// --- tests/package-vectors

class PackageDigestVector : public ::testing::TestWithParam<std::string> {};

TEST_P(PackageDigestVector, MatchesExpected) {
    const json e = expectedOf(kPackageVectors, GetParam());
    const std::vector<PackageFile> files = filesOf(e["files"]);
    EXPECT_EQ(packageDigest(files), e["digest"].get<std::string>());
    if (e.contains("text")) {
        EXPECT_EQ(digestText(files), e["text"].get<std::string>());
    }
    if (e.contains("contents")) {  // size and sha256 follow from the contents (UTF-8 bytes)
        for (const auto& f : files) {
            const PackageFile got = packageFile(f.path, e["contents"][f.path].get<std::string>());
            EXPECT_EQ(got.size, f.size) << f.path;
            EXPECT_EQ(got.sha256, f.sha256) << f.path;
        }
    }
}

INSTANTIATE_TEST_SUITE_P(Package, PackageDigestVector, ::testing::ValuesIn(packageDigestVectors()),
                         paramName);

TEST(PackageDigest, VectorsArePresent) {
    const auto v = packageDigestVectors();
    EXPECT_NE(std::find(v.begin(), v.end(), "digest-basic"), v.end());
    EXPECT_NE(std::find(v.begin(), v.end(), "digest-order"), v.end());
    EXPECT_GE(v.size(), 6u);
    EXPECT_EQ(expectedOf(kPackageVectors, "digest-basic")["digest"], kBasicDigest);
}

// One project, packed with deflate, stored, or as a directory: one digest.
TEST(PackageDigest, TankDemoPackagesHaveTheProjectDigest) {
    const std::string project = expectedOf(kProjectVectors, "valid-tank-demo")["digest"];
    EXPECT_TRUE(std::regex_match(project, std::regex("sha256:[0-9a-f]{64}"))) << project;
    EXPECT_EQ(expectedOf(kPackageVectors, "valid-tank-demo-deflate")["digest"], project);
    EXPECT_EQ(expectedOf(kPackageVectors, "valid-tank-demo-stored")["digest"], project);
}

// --- tests/project-vectors

class ProjectDigestVector : public ::testing::TestWithParam<std::string> {};

// The bytes on disk, as the package will hold them (a BOM stays).
TEST_P(ProjectDigestVector, MatchesExpected) {
    const std::string dir = kProjectVectors + "/" + GetParam();
    const json e = expectedOf(kProjectVectors, GetParam());
    std::vector<PackageFile> files;
    for (const auto& rel : e["files"]) {
        const std::string path = rel.get<std::string>();
        files.push_back(packageFile(path, readFile(dir + "/" + path)));
    }
    EXPECT_EQ(packageDigest(files), e["digest"].get<std::string>());
}

INSTANTIATE_TEST_SUITE_P(Project, ProjectDigestVector, ::testing::ValuesIn(validProjectVectors()),
                         paramName);

TEST(ProjectDigest, EveryValidVectorHasFilesAndDigest) {
    const auto v = validProjectVectors();
    EXPECT_GE(v.size(), 13u);
    for (const auto& d : v) {
        const json e = expectedOf(kProjectVectors, d);
        EXPECT_TRUE(e.contains("files") && e["files"].is_array() && !e["files"].empty()) << d;
        EXPECT_TRUE(
            e.contains("digest") && e["digest"].is_string() &&
            std::regex_match(e["digest"].get<std::string>(), std::regex("sha256:[0-9a-f]{64}")))
            << d;
    }
}
