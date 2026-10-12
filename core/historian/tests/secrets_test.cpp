// Device secret store (specs/003-data-logging/contracts/device.md, research R11).
#include "core/historian/secrets.hpp"

#include <gtest/gtest.h>
#include <sys/stat.h>
#include <unistd.h>

#include <fstream>

using namespace mat;

namespace {
std::string tempDir() {
    char tmpl[] = "/tmp/mat-secrets-XXXXXX";
    const char* d = mkdtemp(tmpl);
    return d ? d : "";
}
void writeFile(const std::string& path, const std::string& text, mode_t mode) {
    std::ofstream(path) << text;
    ::chmod(path.c_str(), mode);
}
}  // namespace

TEST(Secrets, ReadsTheSecretOfAConnection) {
    const std::string f = tempDir() + "/secrets.json";
    writeFile(f, R"({"schemaVersion":"0.1.0","connections":{"db1":"p@ss w0rd","in1":"tok"}})",
              0640);
    auto r = readSecret(f, "db1");
    ASSERT_TRUE(r.ok) << r.reason;
    EXPECT_EQ(r.secret, "p@ss w0rd");
    EXPECT_EQ(readSecret(f, "in1").secret, "tok");
    auto missing = readSecret(f, "db2");
    EXPECT_FALSE(missing.ok);
    EXPECT_EQ(missing.reason, "no_entry");
    EXPECT_EQ(readSecret("/nonexistent/secrets.json", "db1").reason, "missing_file");
}

TEST(Secrets, RefusesFilesOthersCanRead) {
    const std::string f = tempDir() + "/secrets.json";
    writeFile(f, R"({"schemaVersion":"0.1.0","connections":{"db1":"x"}})", 0644);
    auto r = readSecret(f, "db1");
    EXPECT_FALSE(r.ok);
    EXPECT_EQ(r.reason, "permissions");
    EXPECT_EQ(r.secret, "");
}

TEST(Secrets, RefusesBrokenOrHugeFiles) {
    const std::string d = tempDir();
    writeFile(d + "/a.json", "{broken", 0600);
    EXPECT_EQ(readSecret(d + "/a.json", "db1").reason, "invalid");
    writeFile(d + "/b.json", R"({"connections":{"db1":42}})", 0600);
    EXPECT_EQ(readSecret(d + "/b.json", "db1").reason, "invalid");
    writeFile(d + "/c.json", std::string(70 * 1024, ' ') + "{}", 0600);
    EXPECT_EQ(readSecret(d + "/c.json", "db1").reason, "too_big");
}

TEST(Secrets, WriteIsAtomicWith0640AndKeepsOtherEntries) {
    const std::string d = tempDir();
    const std::string f = d + "/secrets.json";
    std::string err;
    ASSERT_TRUE(writeSecret(f, "db1", "first", err)) << err;
    ASSERT_TRUE(writeSecret(f, "in1", "tok", err)) << err;
    ASSERT_TRUE(writeSecret(f, "db1", "second", err)) << err;
    struct stat st {};
    ASSERT_EQ(::stat(f.c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 0777, 0640u);
    EXPECT_EQ(readSecret(f, "db1").secret, "second");
    EXPECT_EQ(readSecret(f, "in1").secret, "tok");
    // no temporary file left behind
    EXPECT_NE(::access((f + ".tmp").c_str(), F_OK), 0);
    EXPECT_FALSE(writeSecret(f, "BAD ID", "x", err));  // ids follow the connection id pattern
}

TEST(Secrets, WriteRepairsTheModeAndKeepsEveryEntry) {
    const std::string d = tempDir();
    const std::string f = d + "/secrets.json";
    writeFile(f, R"({"schemaVersion":"0.1.0","connections":{"db1":"old"}})", 0644);
    std::string err;
    ASSERT_TRUE(writeSecret(f, "in1", "tok", err)) << err;
    struct stat st {};
    ASSERT_EQ(::stat(f.c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 0777, 0640u);
    EXPECT_EQ(readSecret(f, "db1").secret, "old");
    EXPECT_EQ(readSecret(f, "in1").secret, "tok");
    // a broken file is never overwritten: its other entries would be lost
    writeFile(f, "{broken", 0640);
    EXPECT_FALSE(writeSecret(f, "db1", "x", err));
    EXPECT_FALSE(err.empty());
}

TEST(Secrets, ConnectionIdPattern) {
    EXPECT_TRUE(validConnectionId("mysql-office"));
    EXPECT_TRUE(validConnectionId("db1"));
    EXPECT_FALSE(validConnectionId("-db"));
    EXPECT_FALSE(validConnectionId("Db1"));
    EXPECT_FALSE(validConnectionId("db_1"));
    EXPECT_FALSE(validConnectionId(""));
    EXPECT_FALSE(validConnectionId(std::string(49, 'a')));
    EXPECT_FALSE(validConnectionId("../x"));
}

TEST(Secrets, ErrorsNeverContainTheSecret) {
    const std::string d = tempDir();
    std::string err;
    EXPECT_FALSE(writeSecret("/nonexistent-dir/x/secrets.json", "db1", "TOPSECRET", err));
    EXPECT_EQ(err.find("TOPSECRET"), std::string::npos);
}
