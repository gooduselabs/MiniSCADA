// T090 (feature 005, specs/005-device-online/contracts/matscada-package.md §8, device-api §5): the
// device extracts a package into its staging area (staging/<opId>/project/, 0700) while checking
// it. Subdirectories by mkdirat on the parent's descriptor (0700), files with
// O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW (0600), fsync of every file and then of every directory.
// A symlink already in the staging area is never followed; free space below historianMinFreeMB
// (statvfs injected) gives NO_SPACE; on any error the staging area is cleaned.
#include "core/package/extract.hpp"

#include <gtest/gtest.h>
#include <limits.h>
#include <sys/stat.h>
#include <unistd.h>

#include <set>

#include "core/package/tests/package_test_support.hpp"

using namespace mat;
using namespace mat::test;

namespace {

PackageCheck extract(const std::string& bytes, const std::string& dest, ExtractOptions o = {}) {
    MemorySource src(bytes);
    return extractPackage(src, schema(), dest, o);
}

std::string vectorBytes(const std::string& name) { return readFile(vectorNamed(name).file); }

mode_t modeOf(const std::string& path) {
    struct stat st {};
    if (::lstat(path.c_str(), &st) != 0) return 0;
    return st.st_mode;
}

std::string fdPath(int fd) {
    char buf[PATH_MAX];
    const ssize_t n = ::readlink(("/proc/self/fd/" + std::to_string(fd)).c_str(), buf, sizeof buf);
    return n > 0 ? std::string(buf, static_cast<size_t>(n)) : "?";
}

// The project files of a valid vector, from its expected.json.
std::vector<std::string> expectedFiles(const std::string& vector) {
    const Vector v = vectorNamed(vector);  // a temporary would die before the loop
    std::vector<std::string> out;
    for (const auto& f : v.expected["files"]) out.push_back(f["path"]);
    return out;
}

}  // namespace

TEST(Extract, WritesTheProjectFilesIntoANewDirectory) {
    TempDir tmp;
    const std::string dest = tmp / "project";
    const PackageCheck r = extract(vectorBytes("valid-tank-demo-deflate"), dest);
    ASSERT_TRUE(r.ok) << describe(r);
    EXPECT_EQ(r.manifest.digest, vectorNamed("valid-tank-demo-deflate").expected["digest"]);
    EXPECT_EQ(modeOf(dest) & 07777, 0700u);
    EXPECT_TRUE(S_ISDIR(modeOf(dest)));
    std::vector<std::string> want{"screens/"};
    for (const auto& p : expectedFiles("valid-tank-demo-deflate")) want.push_back(p);
    std::sort(want.begin(), want.end());
    EXPECT_EQ(listTree(dest), want);  // no matscada.json: the manifest stays in the package
    const Vector v = vectorNamed("valid-tank-demo-deflate");
    for (const auto& f : v.expected["files"]) {
        const std::string path = dest + "/" + f["path"].get<std::string>();
        EXPECT_EQ(modeOf(path) & 07777, 0600u) << path;
        EXPECT_TRUE(S_ISREG(modeOf(path))) << path;
        EXPECT_EQ(sha256Hex(readFile(path)), f["sha256"].get<std::string>()) << path;
    }
    EXPECT_EQ(modeOf(dest + "/screens") & 07777, 0700u);
}

TEST(Extract, VietnameseNamesAndAnExistingEmptyDirectory) {
    TempDir tmp;
    const std::string dest = tmp / "project";
    ASSERT_EQ(::mkdir(dest.c_str(), 0700), 0);
    const PackageCheck r = extract(vectorBytes("valid-vietnamese-names"), dest);
    ASSERT_TRUE(r.ok) << describe(r);
    for (const auto& p : expectedFiles("valid-vietnamese-names"))
        EXPECT_TRUE(S_ISREG(modeOf(dest + "/" + p))) << p;
}

TEST(Extract, TheDestinationMayNotBeASymlink) {
    TempDir tmp;
    const std::string outside = tmp / "outside";
    ASSERT_EQ(::mkdir(outside.c_str(), 0700), 0);
    const std::string dest = tmp / "project";
    ASSERT_EQ(::symlink(outside.c_str(), dest.c_str()), 0);
    const PackageCheck r = extract(vectorBytes("valid-tank-demo-stored"), dest);
    EXPECT_FALSE(r.ok);
    EXPECT_EQ(r.error.code, "STORE_IO") << describe(r);
    EXPECT_TRUE(listTree(outside).empty());
    EXPECT_TRUE(S_ISLNK(modeOf(dest)));  // not followed, not removed either
}

TEST(Extract, SymlinksAlreadyInsideAreNotFollowed) {
    TempDir tmp;
    const std::string outside = tmp / "outside";
    ASSERT_EQ(::mkdir(outside.c_str(), 0700), 0);
    // A directory symlink where a subdirectory goes, and a file symlink where a file goes.
    for (const auto& planted : std::vector<std::pair<std::string, std::string>>{
             {"screens", outside},
             {"tags.json", outside + "/tags.json"},
             {"logging.json", outside + "/logging.json"}}) {
        const std::string dest = tmp / ("project-" + planted.first);
        ASSERT_EQ(::mkdir(dest.c_str(), 0700), 0);
        ASSERT_EQ(::symlink(planted.second.c_str(), (dest + "/" + planted.first).c_str()), 0);
        const PackageCheck r = extract(vectorBytes("valid-tank-demo-stored"), dest);
        EXPECT_FALSE(r.ok) << planted.first;
        EXPECT_EQ(r.error.code, "STORE_IO") << planted.first << ": " << describe(r);
        EXPECT_TRUE(listTree(outside).empty()) << planted.first;
        EXPECT_FALSE(exists(dest)) << planted.first;  // cleaned, the link removed (not its target)
    }
    EXPECT_TRUE(S_ISDIR(modeOf(outside)));
}

TEST(Extract, AFileAlreadyThereIsNotOverwritten) {
    TempDir tmp;
    const std::string dest = tmp / "project";
    ASSERT_EQ(::mkdir(dest.c_str(), 0700), 0);
    writeFile(dest + "/project.json", "old");
    const PackageCheck r = extract(vectorBytes("valid-tank-demo-stored"), dest);
    EXPECT_EQ(r.error.code, "STORE_IO") << describe(r);
    EXPECT_FALSE(exists(dest));
}

TEST(Extract, DestinationProblems) {
    TempDir tmp;
    EXPECT_EQ(extract(vectorBytes("valid-tank-demo-stored"), tmp / "missing/project").error.code,
              "STORE_IO");
    writeFile(tmp / "file", "x");
    EXPECT_EQ(extract(vectorBytes("valid-tank-demo-stored"), tmp / "file").error.code, "STORE_IO");
    EXPECT_EQ(readFile(tmp / "file"), "x");
}

TEST(Extract, NoSpaceBelowTheMinimum) {
    const std::string bytes = vectorBytes("valid-tank-demo-stored");
    const uint64_t minFree = 64ull << 20;
    // The 3rd file would leave less than minFree.
    TempDir tmp;
    const std::string dest = tmp / "project";
    int calls = 0;
    ExtractOptions o;
    o.minFreeBytes = minFree;
    o.freeBytes = [&](int, uint64_t& free) {
        free = ++calls < 3 ? minFree + (1u << 20) : minFree + 100;
        return true;
    };
    const PackageCheck r = extract(bytes, dest, o);
    EXPECT_EQ(r.error.code, "NO_SPACE") << describe(r);
    EXPECT_GE(calls, 3);
    EXPECT_FALSE(exists(dest));
    EXPECT_TRUE(listTree(tmp.path()).empty());
}

TEST(Extract, FreeSpaceMustCoverTheFileAndTheMinimum) {
    const std::string bytes = vectorBytes("valid-tank-demo-stored");
    const auto files = vectorNamed("valid-tank-demo-stored").expected["files"];
    uint64_t largest = 0;
    for (const auto& f : files) largest = std::max<uint64_t>(largest, f["size"].get<uint64_t>());
    const uint64_t minFree = 1000;
    for (const int64_t slack : {0, -1}) {
        TempDir tmp;
        ExtractOptions o;
        o.minFreeBytes = minFree;
        o.freeBytes = [&](int, uint64_t& free) {
            free = static_cast<uint64_t>(static_cast<int64_t>(largest + minFree) + slack);
            return true;
        };
        const PackageCheck r = extract(bytes, tmp / "project", o);
        if (slack == 0)
            EXPECT_TRUE(r.ok) << describe(r);
        else
            EXPECT_EQ(r.error.code, "NO_SPACE") << describe(r);
    }
}

TEST(Extract, UnknownFreeSpaceStops) {
    TempDir tmp;
    ExtractOptions o;
    o.freeBytes = [](int, uint64_t&) { return false; };
    EXPECT_EQ(extract(vectorBytes("valid-tank-demo-stored"), tmp / "project", o).error.code,
              "STORE_IO");
    EXPECT_TRUE(listTree(tmp.path()).empty());
}

TEST(Extract, FsyncEveryFileThenEveryDirectory) {
    TempDir tmp;
    const std::string dest = tmp / "project";
    std::vector<std::string> synced;
    ExtractOptions o;
    o.fsync = [&](int fd) {
        synced.push_back(fdPath(fd));
        return ::fsync(fd);
    };
    const PackageCheck r = extract(vectorBytes("valid-tank-demo-deflate"), dest, o);
    ASSERT_TRUE(r.ok) << describe(r);
    char real[PATH_MAX];
    ASSERT_NE(::realpath(dest.c_str(), real), nullptr);
    const std::string root = real;
    std::vector<std::string> files;
    for (const auto& p : expectedFiles("valid-tank-demo-deflate")) files.push_back(root + "/" + p);
    // Files first, in the order of the package, each once; then the directories, deepest first,
    // and the parent of the directory this call created.
    std::vector<std::string> want = files;
    want.push_back(root + "/screens");
    want.push_back(root);
    want.push_back(root.substr(0, root.rfind('/')));
    EXPECT_EQ(synced, want);
}

TEST(Extract, FsyncFailureStopsAndCleans) {
    TempDir tmp;
    ExtractOptions o;
    int n = 0;
    o.fsync = [&](int) {
        errno = EIO;
        return ++n == 2 ? -1 : 0;
    };
    const PackageCheck r = extract(vectorBytes("valid-tank-demo-stored"), tmp / "project", o);
    EXPECT_EQ(r.error.code, "STORE_IO") << describe(r);
    EXPECT_TRUE(listTree(tmp.path()).empty());
}

// Files were already written when a later stage fails: the staging area is cleaned.
TEST(Extract, AnErrorOfAnyStageCleansTheStagingArea) {
    for (const char* v : {"content-sha256", "content-unlisted", "content-digest",
                          "content-identity", "secret-pem-svg", "struct-deflate-corrupt",
                          "bomb-declared-size", "path-dotdot", "manifest-bad-json"}) {
        TempDir tmp;
        const PackageCheck r = extract(vectorBytes(v), tmp / "project");
        EXPECT_FALSE(r.ok) << v;
        EXPECT_EQ(r.error.code, vectorNamed(v).expected["code"].get<std::string>()) << v;
        EXPECT_TRUE(listTree(tmp.path()).empty()) << v << ": " << listTree(tmp.path()).size();
    }
}

TEST(Extract, ExpectedDigest) {
    TempDir tmp;
    ExtractOptions o;
    o.expectedDigest = "sha256:" + std::string(64, 'c');
    const PackageCheck r = extract(vectorBytes("valid-tank-demo-stored"), tmp / "project", o);
    EXPECT_EQ(r.error.code, "E_PKG_DIGEST") << describe(r);
    EXPECT_TRUE(listTree(tmp.path()).empty());
    o.expectedDigest = vectorNamed("valid-tank-demo-stored").expected["digest"];
    EXPECT_TRUE(extract(vectorBytes("valid-tank-demo-stored"), tmp / "project", o).ok);
}

// The default free-space probe (fstatvfs) and fsync work on a real file system.
TEST(Extract, DefaultsOnTheRealFileSystem) {
    TempDir tmp;
    ExtractOptions o;
    o.minFreeBytes = 1;
    const PackageCheck r = extract(vectorBytes("valid-tank-demo-stored"), tmp / "project", o);
    EXPECT_TRUE(r.ok) << describe(r);
    o.minFreeBytes = UINT64_MAX / 2;  // no file system has that much free
    const PackageCheck full = extract(vectorBytes("valid-tank-demo-stored"), tmp / "p2", o);
    EXPECT_EQ(full.error.code, "NO_SPACE") << describe(full);
    EXPECT_FALSE(exists(tmp / "p2"));
}
