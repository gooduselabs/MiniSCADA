// mat-update-verify as mat-updater, deploy.sh and release.ps1 run it (feature 011 T090, T096;
// device-api-011 §7): exit 0 valid, 3 signature, 4 no trusted key, 5 package invalid, 6 refused
// for the installed tree (--installed reads its build-info.json); the lines that mat-updater reads
// (ok, meta, file); --json; SHA256SUMS with --sig; --extract-keyset writes the keys to add.
// x64 only (the armhf build of the tool runs under qemu from test-armhf.sh).
#include <gtest/gtest.h>
#include <sys/stat.h>
#include <sys/wait.h>

#include <cstdio>
#include <string>

#include "core/update/tests/update_test_support.hpp"

namespace mat::update {
namespace {

struct CliRun {
    int exit = -1;
    std::string out;
};

CliRun run(const std::string& args) {
    const std::string cmd = std::string(MAT_UPDATE_VERIFY_BIN) + " " + args + " 2>/dev/null";
    CliRun r;
    FILE* p = ::popen(cmd.c_str(), "r");
    if (!p) return r;
    char buf[4096];
    size_t n;
    while ((n = std::fread(buf, 1, sizeof buf, p)) > 0) r.out.append(buf, n);
    const int st = ::pclose(p);
    r.exit = WIFEXITED(st) ? WEXITSTATUS(st) : -1;
    return r;
}

std::string keys() { return " --keys " + test::vectorPath("keys-trusted"); }
std::string vec(const std::string& rel) { return test::vectorPath(rel); }

TEST(UpdateVerifyCli, ExitCodes) {
    EXPECT_EQ(run(vec("valid.matupdate") + keys()).exit, 0);
    EXPECT_EQ(run(vec("bad/01-sig-byte.matupdate") + keys()).exit, 3);
    EXPECT_EQ(run(vec("bad/02-key-unknown.matupdate") + keys()).exit, 3);
    test::UpdTempDir d;
    EXPECT_EQ(run(vec("valid.matupdate") + " --keys " + d.path()).exit, 4);
    EXPECT_EQ(run(vec("bad/04-payload-byte.matupdate") + keys()).exit, 5);
    EXPECT_EQ(run(vec("bad/21-order.matupdate") + keys()).exit, 5);
    EXPECT_EQ(run(d.file("missing.matupdate") + keys()).exit, 5);
    EXPECT_EQ(run("").exit, 2);
    EXPECT_EQ(run(vec("valid.matupdate") + keys() + " --bogus").exit, 2);
}

TEST(UpdateVerifyCli, InstalledTreeRefusesDowngradeAndOldVersions) {
    test::UpdTempDir d;
    test::writeBytes(d.file("build-info.json"), "{\"version\":\"1.0.0\",\"releaseSeq\":10}");
    const std::string inst = " --installed " + d.path() + " --arch armhf";
    EXPECT_EQ(run(vec("valid.matupdate") + keys() + inst).exit, 0);
    const CliRun down = run(vec("bad/16-downgrade.matupdate") + keys() + inst);
    EXPECT_EQ(down.exit, 6);
    EXPECT_NE(down.out.find("error\tUPDATE_DOWNGRADE"), std::string::npos) << down.out;
    EXPECT_EQ(run(vec("bad/15-arch.matupdate") + keys() + inst).exit, 6);
    EXPECT_EQ(run(vec("bad/17-from-version.matupdate") + keys() + inst).exit, 6);
    EXPECT_EQ(run(vec("bad/23-updater-dir.matupdate") + keys() + inst).exit, 6);
    // no build-info.json: version 0.0.0, releaseSeq 0 (minFromVersion 0.9.0 refuses: manual first)
    test::UpdTempDir empty;
    EXPECT_EQ(
        run(vec("valid.matupdate") + keys() + " --installed " + empty.path() + " --arch armhf")
            .exit,
        6);
}

TEST(UpdateVerifyCli, LinesForTheUpdater) {
    const CliRun r = run(vec("valid.matupdate") + keys());
    ASSERT_EQ(r.exit, 0);
    const auto meta = test::vectorCases();
    EXPECT_EQ(
        r.out.rfind("ok\t" + meta["valid"]["keyId"].get<std::string>() + "\ttest-ec-p256\n", 0), 0u)
        << r.out;
    EXPECT_NE(r.out.find("meta\tkind\truntime\n"), std::string::npos);
    EXPECT_NE(r.out.find("meta\tversion\t1.0.1\n"), std::string::npos);
    EXPECT_NE(r.out.find("meta\treleaseSeq\t11\n"), std::string::npos);
    for (const auto& f : meta["valid"]["files"]) {
        const std::string line =
            "file\t" + f["path"].get<std::string>() + "\t" + f["sha256"].get<std::string>() + "\t" +
            f["mode"].get<std::string>() + "\t" + std::to_string(f["size"].get<uint64_t>()) + "\n";
        EXPECT_NE(r.out.find(line), std::string::npos) << line;
    }
    const CliRun j = run(vec("valid.matupdate") + keys() + " --json");
    ASSERT_EQ(j.exit, 0);
    const auto js = nlohmann::json::parse(j.out, nullptr, false);
    ASSERT_TRUE(js.is_object()) << j.out;
    EXPECT_EQ(js["ok"], true);
    EXPECT_EQ(js["manifest"]["version"], "1.0.1");
    const CliRun bad = run(vec("bad/08-path-traversal.matupdate") + keys() + " --json");
    EXPECT_EQ(bad.exit, 5);
    const auto jb = nlohmann::json::parse(bad.out, nullptr, false);
    EXPECT_EQ(jb["error"]["code"], "UPDATE_PACKAGE_INVALID");
    EXPECT_EQ(jb["error"]["detailCode"], "PATH_TRAVERSAL");
}

TEST(UpdateVerifyCli, Sha256Sums) {
    const std::string s = vec("sums/SHA256SUMS");
    EXPECT_EQ(run(s + " --sig " + s + ".sig" + keys()).exit, 0);
    test::UpdTempDir d;
    test::writeBytes(d.file("SHA256SUMS"), test::readBytes(s) + "\n");
    test::writeBytes(d.file("SHA256SUMS.sig"), test::readBytes(s + ".sig"));
    EXPECT_EQ(run(d.file("SHA256SUMS") + " --sig " + d.file("SHA256SUMS.sig") + keys()).exit, 3);
    const std::string other = " --keys " + d.dir("other");
    test::writeBytes(d.file("other/o.pem"),
                     test::readBytes(vec("keys/test-ec-p256-other.pub.pem")));
    EXPECT_EQ(run(s + " --sig " + s + ".sig" + other).exit, 3);
}

TEST(UpdateVerifyCli, ExtractsTheKeysOfAKeyset) {
    test::UpdTempDir d;
    const CliRun r = run(vec("keyset-add.matupdate") + keys() + " --extract-keyset " + d.path());
    ASSERT_EQ(r.exit, 0) << r.out;
    EXPECT_NE(r.out.find("meta\tkind\tkeyset\n"), std::string::npos);
    const std::string id = test::vectorCases()["keyset"]["adds"][0].get<std::string>();
    EXPECT_NE(r.out.find("keyset-add\t" + id + "\t"), std::string::npos) << r.out;
    const std::string file = d.file(id.substr(7) + ".pem");
    ASSERT_TRUE(test::exists(file));
    EXPECT_EQ(test::readBytes(file), test::readBytes(vec("keys/test-ec-p256-other.pub.pem")));
    // a runtime package has nothing to extract; a keyset revoking its own signer is refused
    EXPECT_EQ(
        run(vec("bad/25-keyset-self-revoke.matupdate") + keys() + " --extract-keyset " + d.path())
            .exit,
        5);
}

}  // namespace
}  // namespace mat::update
