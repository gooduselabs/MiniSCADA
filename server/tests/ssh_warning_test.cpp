// T040 (feature 011; FR-034, contracts/device-api-011.md §5): the warning SSH_ROOT_PASSWORD of
// system/info when sshd lets root sign in with a password. The configuration is read as sshd reads
// it: sshd_config, the files its Include lines name (relative to its folder, globs in lexical
// order, in place), the first value of a keyword wins, a Match block only applies to some
// connections. Read-only: nothing in the folders changes; nothing readable means no warning.
#include <gtest/gtest.h>
#include <sys/stat.h>
#include <unistd.h>

#include <filesystem>
#include <fstream>
#include <map>
#include <string>

#include "server/ssh_audit.hpp"
#include "server/system_warnings.hpp"

using namespace mat;
namespace fs = std::filesystem;

namespace {

// A fixture folder like /etc/ssh: sshd_config and sshd_config.d/.
struct SshDir {
    fs::path root;
    SshDir() {
        std::string t = (fs::temp_directory_path() / "mat-ssh-XXXXXX").string();
        root = mkdtemp(t.data());
        fs::create_directories(root / "sshd_config.d");
    }
    ~SshDir() {
        std::error_code ec;
        fs::permissions(root, fs::perms::owner_all, fs::perm_options::add, ec);
        fs::remove_all(root, ec);
    }
    void write(const std::string& rel, const std::string& text) const {
        std::ofstream(root / rel) << text;
    }
    std::string main() const { return (root / "sshd_config").string(); }
    // Every file with its size and modification time: what "nothing changed" compares.
    std::map<std::string, std::pair<uintmax_t, fs::file_time_type>> snapshot() const {
        std::map<std::string, std::pair<uintmax_t, fs::file_time_type>> out;
        for (const auto& e : fs::recursive_directory_iterator(root))
            out[e.path().string()] = {e.is_regular_file() ? e.file_size() : 0,
                                      fs::last_write_time(e.path())};
        return out;
    }
};

std::string includeLine(const SshDir& d) {
    return "Include " + (d.root / "sshd_config.d" / "*.conf").string() + "\n";
}

}  // namespace

TEST(SshAudit, RootWithPasswordWarns) {
    SshDir d;
    d.write("sshd_config", "Port 22\nPermitRootLogin yes\n");
    const SshAuditResult r = auditSshConfig(d.main());
    EXPECT_TRUE(r.readable);
    EXPECT_EQ(r.permitRootLogin, "yes");
    EXPECT_EQ(r.passwordAuthentication, "yes");  // the default of sshd
    EXPECT_TRUE(r.rootPassword);
}

TEST(SshAudit, DefaultsDoNotWarn) {
    SshDir d;
    d.write("sshd_config", "Port 22\n# PermitRootLogin yes\n");
    const SshAuditResult r = auditSshConfig(d.main());
    EXPECT_TRUE(r.readable);
    EXPECT_EQ(r.permitRootLogin, "prohibit-password");  // the default since OpenSSH 7.0
    EXPECT_FALSE(r.rootPassword);
}

TEST(SshAudit, PasswordAuthenticationNoOrRootKeyOnlyDoesNotWarn) {
    SshDir d;
    d.write("sshd_config", "PermitRootLogin yes\nPasswordAuthentication no\n");
    EXPECT_FALSE(auditSshConfig(d.main()).rootPassword);
    for (const char* v : {"prohibit-password", "without-password", "forced-commands-only", "no"}) {
        d.write("sshd_config", std::string("PermitRootLogin ") + v + "\n");
        EXPECT_FALSE(auditSshConfig(d.main()).rootPassword) << v;
    }
}

TEST(SshAudit, FirstValueWinsAsInOpenSsh) {
    SshDir d;
    d.write("sshd_config", "PermitRootLogin no\nPermitRootLogin yes\n");
    EXPECT_FALSE(auditSshConfig(d.main()).rootPassword);
    d.write("sshd_config",
            "PermitRootLogin yes\nPasswordAuthentication yes\n"
            "PasswordAuthentication no\n");
    EXPECT_TRUE(auditSshConfig(d.main()).rootPassword);
}

TEST(SshAudit, KeywordsAndValuesIgnoreCaseAndAcceptEqualsAndQuotes) {
    SshDir d;
    d.write("sshd_config", "  permitrootlogin=\"YES\"\n\tPASSWORDAUTHENTICATION  Yes  \n");
    const SshAuditResult r = auditSshConfig(d.main());
    EXPECT_EQ(r.permitRootLogin, "yes");
    EXPECT_TRUE(r.rootPassword);
}

TEST(SshAudit, IncludedFilesComeInPlaceInLexicalOrder) {
    SshDir d;
    // Debian: the Include line at the top, so a drop-in file wins over the main file.
    d.write("sshd_config", includeLine(d) + "PermitRootLogin yes\n");
    d.write("sshd_config.d/20-hardening.conf", "PermitRootLogin no\n");
    EXPECT_FALSE(auditSshConfig(d.main()).rootPassword);
    // 10- comes before 20-: its value wins.
    d.write("sshd_config.d/10-vendor.conf", "PermitRootLogin yes\n");
    const SshAuditResult r = auditSshConfig(d.main());
    EXPECT_TRUE(r.rootPassword);
    ASSERT_EQ(r.files.size(), 3u);
    EXPECT_NE(r.files[1].find("10-vendor.conf"), std::string::npos);
    // Only *.conf: another name in the folder is not read.
    fs::remove(d.root / "sshd_config.d/10-vendor.conf");
    d.write("sshd_config.d/10-vendor.conf.bak", "PermitRootLogin yes\n");
    EXPECT_FALSE(auditSshConfig(d.main()).rootPassword);
}

TEST(SshAudit, IncludeAfterTheSettingDoesNotOverrideIt) {
    SshDir d;
    d.write("sshd_config", "PasswordAuthentication no\nPermitRootLogin yes\n" + includeLine(d));
    d.write("sshd_config.d/50-cloud.conf", "PasswordAuthentication yes\n");
    EXPECT_FALSE(auditSshConfig(d.main()).rootPassword);
}

TEST(SshAudit, RelativeIncludeIsResolvedFromTheConfigFolder) {
    SshDir d;
    d.write("sshd_config", "Include sshd_config.d/*.conf\n");
    d.write("sshd_config.d/a.conf", "PermitRootLogin yes\n");
    EXPECT_TRUE(auditSshConfig(d.main()).rootPassword);
}

TEST(SshAudit, NestedIncludeAndLoopsAreBounded) {
    SshDir d;
    d.write("sshd_config", "Include sshd_config.d/a.conf\n");
    d.write("sshd_config.d/a.conf", "Include " + (d.root / "sshd_config.d/b.conf").string() + "\n");
    d.write("sshd_config.d/b.conf", "PermitRootLogin yes\nInclude " + d.main() + "\n");  // loop
    const SshAuditResult r = auditSshConfig(d.main());
    EXPECT_TRUE(r.readable);
    EXPECT_TRUE(r.rootPassword);
}

TEST(SshAudit, MatchBlocksDoNotSetTheGlobalValue) {
    SshDir d;
    d.write("sshd_config", "Match Address 10.0.0.0/8\n  PermitRootLogin yes\nMatch all\n");
    EXPECT_FALSE(auditSshConfig(d.main()).rootPassword);
    d.write("sshd_config", "PermitRootLogin yes\nMatch User backup\n  PasswordAuthentication no\n");
    EXPECT_TRUE(auditSshConfig(d.main()).rootPassword);
}

TEST(SshAudit, UnreadableConfigDoesNotWarn) {
    SshDir d;
    const SshAuditResult missing = auditSshConfig((d.root / "none").string());
    EXPECT_FALSE(missing.readable);
    EXPECT_FALSE(missing.rootPassword);
    if (::geteuid() != 0) {  // root reads a file without permission
        d.write("sshd_config", "PermitRootLogin yes\n");
        fs::permissions(d.main(), fs::perms::none);
        const SshAuditResult r = auditSshConfig(d.main());
        EXPECT_FALSE(r.readable);
        EXPECT_FALSE(r.rootPassword);
    }
    // An included file that cannot be read is left out; what was read still counts.
    d.write("sshd_config", "Include sshd_config.d/missing.conf\nPermitRootLogin yes\n");
    fs::permissions(d.main(), fs::perms::owner_read | fs::perms::owner_write);
    EXPECT_TRUE(auditSshConfig(d.main()).rootPassword);
}

TEST(SshAudit, ReadingChangesNothing) {
    SshDir d;
    d.write("sshd_config", includeLine(d) + "PermitRootLogin yes\n");
    d.write("sshd_config.d/a.conf", "PasswordAuthentication yes\n");
    const auto before = d.snapshot();
    for (int i = 0; i < 3; ++i) auditSshConfig(d.main());
    EXPECT_EQ(d.snapshot(), before);
}

TEST(SshAudit, TheWarningFollowsTheResult) {
    SshDir d;
    SystemWarnings w([] { return int64_t{1000}; });
    d.write("sshd_config", "PermitRootLogin yes\n");
    publishSshWarning(auditSshConfig(d.main()), w);
    ASSERT_EQ(w.list().size(), 1u);
    EXPECT_EQ(w.list()[0].code, "SSH_ROOT_PASSWORD");
    EXPECT_EQ(w.list()[0].detail["permitRootLogin"], "yes");
    // Fixed: cleared. Unreadable: cleared too (no warning without knowing).
    d.write("sshd_config", "PermitRootLogin no\n");
    publishSshWarning(auditSshConfig(d.main()), w);
    EXPECT_TRUE(w.list().empty());
    d.write("sshd_config", "PermitRootLogin yes\n");
    publishSshWarning(auditSshConfig(d.main()), w);
    publishSshWarning(auditSshConfig((d.root / "none").string()), w);
    EXPECT_TRUE(w.list().empty());
}
