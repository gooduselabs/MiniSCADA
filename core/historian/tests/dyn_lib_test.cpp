// Client libraries shipped next to the runtime are loaded only from a place nobody but root can
// change (specs/003-data-logging research R7, security review hardening 3 and its review).
#include "core/historian/forward/dyn_lib.hpp"

#include <fcntl.h>
#include <gtest/gtest.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

using namespace mat;

namespace {

constexpr const char* kSo = "libmat-fake-client.so.1";

// A directory under `parent` with a file named like a client library (not a real one: the loader
// refuses it).
std::string libDir(const std::string& parent) {
    std::string tmpl = parent + "/mat-lib-XXXXXX";
    if (!mkdtemp(&tmpl[0])) return "";
    const std::string path = tmpl + "/" + kSo;
    const int fd = ::open(path.c_str(), O_WRONLY | O_CREAT | O_EXCL, 0644);
    if (fd >= 0) {
        (void)!::write(fd, "not a library", 13);
        ::close(fd);
    }
    ::chmod(tmpl.c_str(), 0755);
    return tmpl;
}

bool skipped(const std::string& err) { return err.find("bỏ qua") != std::string::npos; }

}  // namespace

TEST(DynLib, AShippedLibraryIsTriedOnlyFromATrustedPlace) {
    if (::geteuid() != 0) GTEST_SKIP() << "needs root: the trusted place belongs to root";
    const std::string dir = libDir("/root");  // root:root 0700 and its parents
    ASSERT_FALSE(dir.empty());
    std::string err;
    EXPECT_EQ(openClientLib(dir, kSo, err), nullptr);  // tried: the loader refuses the file
    EXPECT_FALSE(skipped(err)) << err;

    ::chmod(dir.c_str(), 0777);  // anyone could swap the library
    err.clear();
    EXPECT_EQ(openClientLib(dir, kSo, err), nullptr);
    EXPECT_TRUE(skipped(err)) << err;

    ::chmod(dir.c_str(), 0755);
    ::chmod((dir + "/" + kSo).c_str(), 0666);
    err.clear();
    EXPECT_EQ(openClientLib(dir, kSo, err), nullptr);
    EXPECT_TRUE(skipped(err)) << err;

    ::chmod((dir + "/" + kSo).c_str(), 0644);
    ASSERT_EQ(::chown((dir + "/" + kSo).c_str(), 1000, 1000), 0);  // not root's
    err.clear();
    EXPECT_EQ(openClientLib(dir, kSo, err), nullptr);
    EXPECT_TRUE(skipped(err)) << err;

    err.clear();  // a relative directory depends on the working directory
    EXPECT_EQ(openClientLib("lib", kSo, err), nullptr);
    EXPECT_TRUE(skipped(err)) << err;
}

// A directory of root under a place others can write to (/tmp): they could rename it away and put
// their own in its place.
TEST(DynLib, AParentOthersCanWriteToIsNotTrusted) {
    if (::geteuid() != 0) GTEST_SKIP() << "needs root";
    const std::string dir = libDir("/tmp");
    ASSERT_FALSE(dir.empty());
    std::string err;
    EXPECT_EQ(openClientLib(dir, kSo, err), nullptr);
    EXPECT_TRUE(skipped(err)) << err;
}
