// T109 (feature 011; FR-066; device-api-011 §7; contracts/update-package.md §3, release-signing
// §6): `mat-runtime --trust-key add <file.pem> | remove <keyId> | list` (root) on the trusted-keys
// directory, and what the runtime does with a changed key set at its next start (audit
// system.keys.updated with the keys added and removed), and `--update-status` (last.json).
// - list: one line per key, keyId and label; the directory as loadTrustedKeys reads it;
// - add: only ECDSA P-256 public keys, written <label>.pem 0644 (directory 0755), at most 4 keys,
//   the same key twice refused; remove by keyId; not root: refused, nothing written.
#include <gtest/gtest.h>
#include <stdlib.h>
#include <sys/stat.h>

#include <filesystem>
#include <fstream>
#include <sstream>

#include "core/update/signature.hpp"
#include "core/update/tests/update_test_support.hpp"
#include "server/cli/trust_key.hpp"
#include "server/cli/update_status.hpp"
#include "server/update_service.hpp"

namespace fs = std::filesystem;
using namespace mat;

namespace {

struct Cli {
    test::UpdTempDir d;
    std::string keys = d.file("trusted-keys");
    std::string out;
    int run(std::vector<std::string> args, bool root = true) {
        std::vector<std::string> all = {"mat-runtime", "--trust-key"};
        all.insert(all.end(), args.begin(), args.end());
        all.push_back("--keys-dir");
        all.push_back(keys);
        std::vector<char*> argv;
        for (auto& a : all) argv.push_back(a.data());
        std::ostringstream o, e;
        DeviceCliEnv env;
        env.isRoot = root;
        const int rc = runTrustKeyCli(static_cast<int>(argv.size()), argv.data(), env, o, e);
        out = o.str() + e.str();
        return rc;
    }
};

std::string vec(const std::string& rel) { return test::vectorPath(rel); }
mode_t modeOf(const std::string& p) {
    struct stat st {};
    return ::stat(p.c_str(), &st) == 0 ? (st.st_mode & 07777) : 0;
}

TEST(TrustKeyCli, AddListRemove) {
    Cli c;
    EXPECT_EQ(c.run({"list"}), 0) << c.out;
    EXPECT_NE(c.out.find("không có khóa"), std::string::npos) << c.out;
    ASSERT_EQ(c.run({"add", vec("keys-trusted/test-ec-p256.pem"), "--label", "release-primary"}), 0)
        << c.out;
    const std::string file = c.keys + "/release-primary.pem";
    ASSERT_TRUE(test::exists(file));
    EXPECT_EQ(modeOf(file), 0644u);
    EXPECT_EQ(modeOf(c.keys), 0755u);
    const std::string id = test::vectorCases()["valid"]["keyId"];
    EXPECT_EQ(c.run({"list"}), 0);
    EXPECT_NE(c.out.find(id), std::string::npos) << c.out;
    EXPECT_NE(c.out.find("release-primary"), std::string::npos) << c.out;
    // the same key again, under another name
    EXPECT_NE(c.run({"add", vec("keys-trusted/test-ec-p256.pem"), "--label", "again"}), 0);
    EXPECT_FALSE(test::exists(c.keys + "/again.pem"));
    // a second key, then remove the first by its keyId
    ASSERT_EQ(c.run({"add", vec("keys/test-ec-p256-other.pub.pem")}), 0) << c.out;
    EXPECT_EQ(update::loadTrustedKeys(c.keys).keys.size(), 2u);
    ASSERT_EQ(c.run({"remove", id}), 0) << c.out;
    EXPECT_FALSE(test::exists(file));
    EXPECT_EQ(update::loadTrustedKeys(c.keys).keys.size(), 1u);
    EXPECT_NE(c.run({"remove", id}), 0) << "an unknown keyId";
}

TEST(TrustKeyCli, OnlyP256PublicKeysAndAtMostFour) {
    Cli c;
    EXPECT_NE(c.run({"add", vec("keys/test-rsa.pub.pem")}), 0);
    EXPECT_NE(c.run({"add", vec("keys/test-ec-p256.pem")}), 0) << "a private key";
    EXPECT_NE(c.run({"add", c.d.file("missing.pem")}), 0);
    EXPECT_NE(c.run({"add", vec("keys-trusted/test-ec-p256.pem"), "--label", "../escape"}), 0);
    EXPECT_FALSE(test::exists(c.d.file("escape.pem")));
    // four distinct keys fill the directory (two test keys + two made-up files would not parse):
    // the limit is checked on the count of keys that load
    ::mkdir(c.keys.c_str(), 0755);
    for (const char* n : {"a.pem", "b.pem", "c.pem", "d.pem"})
        test::writeBytes(c.keys + "/" + n, test::readBytes(vec("keys/test-ec-p256-other.pub.pem")));
    EXPECT_NE(c.run({"add", vec("keys-trusted/test-ec-p256.pem")}), 0) << c.out;
    EXPECT_NE(c.out.find("4"), std::string::npos) << c.out;
}

TEST(TrustKeyCli, NotRootWritesNothing) {
    Cli c;
    EXPECT_NE(c.run({"add", vec("keys-trusted/test-ec-p256.pem")}, false), 0);
    EXPECT_FALSE(test::exists(c.keys));
    EXPECT_EQ(c.run({"list"}, false), 0) << "list is a read";
}

TEST(TrustKeyCli, TheRuntimeAuditsAChangedKeySetAtStart) {
    test::UpdTempDir d;
    const std::string keys = d.dir("keys");
    const std::string data = d.dir("data");
    std::vector<AuditEvent> rows;
    auto svc = [&] {
        UpdateServiceOptions o;
        o.enabled = true;
        o.trustedKeysDir = keys;
        o.dataDir = data;
        o.installRoot = d.file("opt");
        o.version = "1.0.0";
        o.audit = [&](const AuditEvent& e) {
            rows.push_back(e);
            return true;
        };
        o.log = [](const std::string&) {};
        return std::make_unique<UpdateService>(o);
    };
    svc()->start();  // first start: the set is recorded, no audit (nothing changed)
    size_t keyRows = 0;
    for (const auto& e : rows) keyRows += e.action == AuditAction::KeysUpdated;
    EXPECT_EQ(keyRows, 0u);
    test::writeBytes(keys + "/release-primary.pem",
                     test::readBytes(vec("keys-trusted/test-ec-p256.pem")));
    svc()->start();
    ASSERT_FALSE(rows.empty());
    const AuditEvent& e = rows.back();
    EXPECT_EQ(e.action, AuditAction::KeysUpdated);
    EXPECT_NE(e.detail.find(test::vectorCases()["valid"]["keyId"].get<std::string>()),
              std::string::npos)
        << e.detail;
    EXPECT_NE(e.detail.find("added"), std::string::npos);
    svc()->start();  // unchanged: no new row
    EXPECT_EQ(rows.back().action, AuditAction::KeysUpdated);
    const size_t n = rows.size();
    svc()->start();
    EXPECT_EQ(rows.size(), n);
}

TEST(UpdateStatusCli, PrintsLastJson) {
    test::UpdTempDir d;
    const std::string data = d.dir("data");
    std::ostringstream o, e;
    std::vector<std::string> a = {"mat-runtime", "--update-status", "--data-dir", data};
    std::vector<char*> argv;
    for (auto& s : a) argv.push_back(s.data());
    EXPECT_EQ(runUpdateStatusCli(static_cast<int>(argv.size()), argv.data(), DeviceCliEnv{}, o, e),
              0);
    EXPECT_NE(o.str().find("chưa có"), std::string::npos) << o.str();
    ::mkdir((data + "/update").c_str(), 0700);
    test::writeBytes(
        data + "/update/last.json",
        R"({"updateId":"upd_0123456789abcdef","op":"apply","result":"rolled-back","from":"1.0.0","to":"1.0.1","reason":"health"})");
    std::ostringstream o2, e2;
    EXPECT_EQ(
        runUpdateStatusCli(static_cast<int>(argv.size()), argv.data(), DeviceCliEnv{}, o2, e2), 0);
    EXPECT_NE(o2.str().find("rolled-back"), std::string::npos) << o2.str();
    EXPECT_NE(o2.str().find("upd_0123456789abcdef"), std::string::npos);
}

}  // namespace
