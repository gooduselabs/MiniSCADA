// `mat-runtime --set-secret <connectionId>` (specs/003-data-logging/contracts/device.md).
#include "server/cli/set_secret.hpp"

#include <grp.h>
#include <gtest/gtest.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

#include <sstream>

#include "core/historian/secrets.hpp"

using namespace mat;

namespace {

std::string tempFile() {
    char tmpl[] = "/tmp/mat-setsecret-XXXXXX";
    const char* d = mkdtemp(tmpl);
    return std::string(d ? d : "") + "/secrets.json";
}

struct Run {
    int code;
    std::string out;
    std::string err;
};

Run run(std::vector<std::string> args, const std::string& stdinText, bool root = true) {
    args.insert(args.begin(), "mat-runtime");
    std::vector<char*> argv;
    for (auto& a : args) argv.push_back(&a[0]);
    std::istringstream in(stdinText);
    std::ostringstream out, err;
    const int code =
        runSetSecretCli(static_cast<int>(argv.size()), argv.data(), in, out, err, root);
    return {code, out.str(), err.str()};
}

}  // namespace

TEST(SetSecretCli, StoresTheFirstLineOfStdin) {
    const std::string f = tempFile();
    auto r = run({"--set-secret", "db1", "--secrets-file", f}, "s3cret pass\r\nignored\n");
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_EQ(readSecret(f, "db1").secret, "s3cret pass");
    struct stat st {};
    ASSERT_EQ(::stat(f.c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 0777, 0640u);
    // the secret is never echoed
    EXPECT_EQ(r.out.find("s3cret"), std::string::npos);
    EXPECT_EQ(r.err.find("s3cret"), std::string::npos);
    // a second connection keeps the first one
    ASSERT_EQ(run({"--set-secret", "in1", "--secrets-file", f}, "tok").code, 0);
    EXPECT_EQ(readSecret(f, "db1").secret, "s3cret pass");
    EXPECT_EQ(readSecret(f, "in1").secret, "tok");
}

TEST(SetSecretCli, RefusesWithExitCode4) {
    const std::string f = tempFile();
    EXPECT_EQ(run({"--set-secret", "db1", "--secrets-file", f}, "pw", /*root=*/false).code, 4);
    EXPECT_EQ(run({"--set-secret", "BAD ID", "--secrets-file", f}, "pw").code, 4);
    EXPECT_EQ(run({"--set-secret", "--secrets-file", f}, "pw").code, 4);       // no id
    EXPECT_EQ(run({"--set-secret", "db1", "--secrets-file", f}, "").code, 4);  // empty secret
    EXPECT_EQ(run({"--set-secret", "db1", "--secrets-file", "/nonexistent/dir/s.json"}, "pw").code,
              4);
    EXPECT_FALSE(readSecret(f, "db1").ok);
}

// Security review L2: a secret that is not UTF-8 is refused with a message: no crash, and no byte
// of it in the message.
TEST(SetSecretCli, ASecretThatIsNotUtf8IsRefused) {
    const std::string f = tempFile();
    auto r = run({"--set-secret", "db1", "--secrets-file", f}, "p\xE9ss\n");
    EXPECT_EQ(r.code, 4);
    EXPECT_NE(r.err.find("UTF-8"), std::string::npos) << r.err;
    EXPECT_EQ(r.err.find("\xE9"), std::string::npos);
    EXPECT_FALSE(readSecret(f, "db1").ok);
}

// Review S11: run as root before deploy.sh made the service user, the file is readable by root
// only; the command says so instead of a plain success.
TEST(SetSecretCli, SaysWhenTheServiceCannotReadTheFileYet) {
    if (::geteuid() != 0 || ::getgrnam("matscada")) GTEST_SKIP() << "needs root, no matscada group";
    const std::string f = tempFile();
    auto r = run({"--set-secret", "db1", "--secrets-file", f}, "pw\n");
    EXPECT_EQ(r.code, 0) << r.err;
    EXPECT_NE(r.err.find("matscada"), std::string::npos) << r.err;
    EXPECT_TRUE(readSecret(f, "db1").ok);
}
