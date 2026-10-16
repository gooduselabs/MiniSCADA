// T045 (feature 005; contracts/device-config.md §4, research R8, FR-011, ADR-011): the account
// commands of the device, `mat-runtime --user-*` (server/cli/users).
//  - Exit codes: 0 ok; 2 bad arguments or a refused password; 4 not root, invalid name, refused
//    change (no such account, already there, last administrator), users.json cannot be written;
//    5 the audit record cannot be written (users.json keeps every byte); 6 users.json damaged.
//  - A password comes only from a terminal (asked twice, echo off, echo back even after Ctrl+C) or
//    one line of stdin (--password-stdin); no argument takes one; 15–128 characters, not the
//    account name; combining marks refused with a hint (ADR-011, 2026-10-11).
//  - The audit record goes first (`started`), written by a child process switched to the service
//    user, then `ok` or `failed`.
//  - rev and unlockSeq; --user-list never prints a hash; the last enabled administrator stays.
// The tests run as root in the toolchain container; `daemon` (uid 1) stands for `matscada`. Every
// file lives in a temporary directory; test passwords are made at run time.
#include <fcntl.h>
#include <gtest/gtest.h>
#include <pwd.h>
#include <signal.h>
#include <stdlib.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/auth/account_store.hpp"
#include "core/auth/password_hash.hpp"
#include "core/crypto/hex.hpp"
#include "core/crypto/random.hpp"
#include "nlohmann/json.hpp"
#include "server/cli/users.hpp"

using namespace mat;
using namespace std::chrono_literals;

namespace {

constexpr const char* kServiceUser = "daemon";  // in the image; the device has matscada
constexpr const char* kNow = "2026-10-20T03:00:00Z";
constexpr const char* kLater = "2026-10-21T08:00:00Z";

// 28 characters, new on every run.
std::string testPassword() { return "thu-" + toHex(randomBytes(12)); }

std::string utf8(char32_t c) {
    std::string s;
    if (c < 0x80) {
        s += static_cast<char>(c);
    } else if (c < 0x800) {
        s += static_cast<char>(0xC0 | (c >> 6));
        s += static_cast<char>(0x80 | (c & 0x3F));
    } else if (c < 0x10000) {
        s += static_cast<char>(0xE0 | (c >> 12));
        s += static_cast<char>(0x80 | ((c >> 6) & 0x3F));
        s += static_cast<char>(0x80 | (c & 0x3F));
    } else {
        s += static_cast<char>(0xF0 | (c >> 18));
        s += static_cast<char>(0x80 | ((c >> 12) & 0x3F));
        s += static_cast<char>(0x80 | ((c >> 6) & 0x3F));
        s += static_cast<char>(0x80 | (c & 0x3F));
    }
    return s;
}

class TempDir {
   public:
    TempDir() {
        char tmpl[] = "/tmp/mat-usercli-XXXXXX";
        if (::mkdtemp(tmpl) != nullptr) path = tmpl;
        ::chmod(path.c_str(), 0755);  // the service user must reach the data directory inside
    }
    ~TempDir() {
        std::error_code ec;
        if (!path.empty()) std::filesystem::remove_all(path, ec);
    }
    TempDir(const TempDir&) = delete;
    TempDir& operator=(const TempDir&) = delete;
    std::string path;
};

bool exists(const std::string& path) {
    struct stat st {};
    return ::lstat(path.c_str(), &st) == 0;
}

std::string readFile(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(f), {});
}

void writeFile(const std::string& path, const std::string& text, mode_t mode) {
    std::ofstream(path, std::ios::binary | std::ios::trunc) << text;
    ::chmod(path.c_str(), mode);
}

std::vector<std::string> lines(const std::string& text) {
    std::vector<std::string> out;
    std::istringstream in(text);
    for (std::string l; std::getline(in, l);)
        if (!l.empty()) out.push_back(l);
    return out;
}

std::vector<std::string> fields(const std::string& line) {
    std::vector<std::string> out;
    std::istringstream in(line);
    for (std::string f; in >> f;) out.push_back(f);
    return out;
}

// The bytes of every file in `dir`.
std::string allBytes(const std::string& dir) {
    std::string all;
    std::error_code ec;
    for (const auto& e : std::filesystem::directory_iterator(dir, ec))
        if (e.is_regular_file()) all += readFile(e.path().string());
    return all;
}

struct Outcome {
    int code = -1;
    std::string out;
    std::string err;
};

// A pseudo-terminal: the command reads the slave side, the test types on the master side and sees
// there what the terminal would show (the echo).
struct Pty {
    int master = -1;
    int slave = -1;
    Pty() {
        master = ::posix_openpt(O_RDWR | O_NOCTTY);
        if (master < 0 || ::grantpt(master) != 0 || ::unlockpt(master) != 0) return;
        const char* name = ::ptsname(master);
        if (name) slave = ::open(name, O_RDWR | O_NOCTTY);
    }
    ~Pty() {
        if (slave >= 0) ::close(slave);
        if (master >= 0) ::close(master);
    }
    Pty(const Pty&) = delete;
    Pty& operator=(const Pty&) = delete;

    bool ok() const { return master >= 0 && slave >= 0; }
    bool echoOn() const {
        termios t{};
        return ::tcgetattr(slave, &t) == 0 && (t.c_lflag & ECHO) != 0;
    }
    bool waitEcho(bool on, std::chrono::milliseconds limit) const {
        const auto end = std::chrono::steady_clock::now() + limit;
        while (std::chrono::steady_clock::now() < end) {
            if (echoOn() == on) return true;
            std::this_thread::sleep_for(1ms);
        }
        return false;
    }
    void type(const std::string& text) const {
        if (::write(master, text.data(), text.size()) < 0) ADD_FAILURE() << "write to the pty";
    }
    // What the terminal showed so far.
    std::string drain() const {
        const int flags = ::fcntl(master, F_GETFL);
        ::fcntl(master, F_SETFL, flags | O_NONBLOCK);
        std::string shown;
        char buf[512];
        ssize_t n;
        while ((n = ::read(master, buf, sizeof buf)) > 0) shown.append(buf, static_cast<size_t>(n));
        ::fcntl(master, F_SETFL, flags);
        return shown;
    }
};

}  // namespace

class UserCli : public ::testing::Test {
   protected:
    void SetUp() override {
        if (::geteuid() != 0) GTEST_SKIP() << "needs root, as in the toolchain container";
        const passwd* pw = ::getpwnam(kServiceUser);
        if (!pw) GTEST_SKIP() << "no user " << kServiceUser;
        svcUid = pw->pw_uid;
        svcGid = pw->pw_gid;
        ASSERT_FALSE(dir.path.empty());
        etc = dir.path + "/etc";
        data = dir.path + "/data";
        ASSERT_EQ(::mkdir(etc.c_str(), 0755), 0);
        ASSERT_EQ(::mkdir(data.c_str(), 0700), 0);
        ASSERT_EQ(::chown(data.c_str(), svcUid, svcGid), 0);  // as systemd's StateDirectory
        users = etc + "/users.json";
    }

    DeviceCliEnv env(int inFd, bool root) {
        DeviceCliEnv e;
        e.isRoot = root;
        e.inFd = inFd;
        e.serviceUser = serviceUser;
        e.nowIso = [this] { return now; };
        e.hostname = [] { return std::string("mat-test"); };
        e.runCommand = [](const std::vector<std::string>&) { return 0; };
        return e;
    }

    Outcome runOnFd(std::vector<std::string> args, int inFd, bool root = true) {
        args.insert(args.begin(), "mat-runtime");
        if (withPaths) args.insert(args.end(), {"--users-file", users, "--data-dir", data});
        std::vector<char*> argv;
        for (auto& a : args) argv.push_back(&a[0]);
        std::ostringstream out, err;
        Outcome r;
        r.code = runUserCli(static_cast<int>(argv.size()), argv.data(), env(inFd, root), out, err);
        r.out = out.str();
        r.err = err.str();
        return r;
    }

    // stdin is a pipe holding `input` (not a terminal).
    Outcome run(std::vector<std::string> args, const std::string& input = "", bool root = true) {
        int p[2];
        if (::pipe(p) != 0) {
            ADD_FAILURE() << "pipe";
            return {};
        }
        if (!input.empty() && ::write(p[1], input.data(), input.size()) < 0)
            ADD_FAILURE() << "write to the pipe";
        ::close(p[1]);
        Outcome r = runOnFd(std::move(args), p[0], root);
        ::close(p[0]);
        return r;
    }

    bool add(const std::string& name, const std::string& role, const std::string& password) {
        const Outcome r =
            run({"--user-add", name, "--role", role, "--password-stdin"}, password + "\n");
        EXPECT_EQ(r.code, 0) << name << ": " << r.err;
        return r.code == 0;
    }

    // users.json as the runtime reads it (mode checked).
    UsersFile accounts() {
        const UsersRead r = readUsersFile(users, true);
        EXPECT_EQ(r.status, UsersStatus::Ok) << r.error;
        return r.file;
    }
    Account account(const std::string& name) {
        const UsersFile f = accounts();
        const Account* a = f.find(name);
        EXPECT_NE(a, nullptr) << name;
        return a ? *a : Account{};
    }

    // Oldest first; none when audit.db is not there (it is not created here).
    std::vector<AuditRecord> auditRows() {
        if (!exists(data + "/audit.db")) return {};
        AuditOptions o;
        o.dataDir = data;
        AuditLog log(o);
        std::string e;
        if (!log.open(e)) {
            ADD_FAILURE() << e;
            return {};
        }
        AuditQuery q;
        q.limit = kAuditQueryMaxLimit;
        auto rows = log.query(q).records;
        std::reverse(rows.begin(), rows.end());
        return rows;
    }

    TempDir dir;
    std::string etc, data, users;
    std::string now = kNow;
    std::string serviceUser = kServiceUser;
    bool withPaths = true;
    uid_t svcUid = 0;
    gid_t svcGid = 0;
};

// --user-add --password-stdin: the account is in users.json (0640, root:<group of the service
// user>), its hash checks the password, rev 1, unlockSeq 0. The password is nowhere else.
TEST_F(UserCli, AddStoresAnAccountFromOneLineOfStdin) {
    const std::string pw = testPassword();
    const Outcome r = run({"--user-add", "kysu1", "--role", "engineer", "--password-stdin"},
                          pw + "\nnot this line\n");
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_NE(r.out.find("kysu1"), std::string::npos) << r.out;
    const Account a = account("kysu1");
    EXPECT_EQ(a.role, Role::Engineer);
    EXPECT_TRUE(a.enabled);
    EXPECT_EQ(a.rev, 1);
    EXPECT_EQ(a.unlockSeq, 0);
    EXPECT_EQ(a.createdAt, kNow);
    EXPECT_EQ(a.updatedAt, kNow);
    ASSERT_TRUE(a.hash.has_value());
    EXPECT_EQ(a.hash->params, kArgon2Default);
    EXPECT_TRUE(verifyPassword(pw, *a.hash));
    EXPECT_FALSE(verifyPassword("not this line", *a.hash));

    struct stat st {};
    ASSERT_EQ(::stat(users.c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 07777, 0640u);
    EXPECT_EQ(st.st_uid, 0u);
    EXPECT_EQ(st.st_gid, svcGid);

    EXPECT_EQ(r.out.find(pw), std::string::npos);
    EXPECT_EQ(r.err.find(pw), std::string::npos);
    EXPECT_EQ(readFile(users).find(pw), std::string::npos);
    EXPECT_EQ(allBytes(data).find(pw), std::string::npos);
}

// The record is committed by a child process switched to the service user: audit.db belongs to
// that user, never to root. `started` before the change, `ok` after; the account is the target.
TEST_F(UserCli, TheServiceUserRecordsTheChangeFirst) {
    ASSERT_TRUE(add("admin", "administrator", testPassword()));
    struct stat st {};
    ASSERT_EQ(::stat((data + "/audit.db").c_str(), &st), 0);
    EXPECT_EQ(st.st_uid, svcUid);
    EXPECT_EQ(st.st_mode & 07777, 0600u);
    for (const char* companion : {"/audit.db-wal", "/audit.db-shm"}) {
        if (::stat((data + companion).c_str(), &st) == 0) {
            EXPECT_EQ(st.st_uid, svcUid) << companion;
        }
    }

    const auto rows = auditRows();
    ASSERT_EQ(rows.size(), 2u);
    EXPECT_EQ(rows[0].result, "started");
    EXPECT_EQ(rows[1].result, "ok");
    for (const auto& row : rows) {
        EXPECT_EQ(row.action, "account.create");
        EXPECT_EQ(row.channel, "cli");
        EXPECT_EQ(row.source, "cli");
        EXPECT_EQ(row.target.value_or(""), "admin");
        EXPECT_FALSE(row.user.has_value());
        ASSERT_TRUE(row.detail.has_value());
        EXPECT_EQ(nlohmann::json::parse(*row.detail).value("role", ""), "administrator");
    }
}

// The record cannot be written (the data directory refuses the service user): exit code 5 and
// users.json keeps every byte, for every command that changes it.
TEST_F(UserCli, NoAuditRecordMeansNoChange) {
    ASSERT_TRUE(add("admin", "administrator", testPassword()));
    ASSERT_TRUE(add("kysu1", "engineer", testPassword()));
    ASSERT_TRUE(add("kysu2", "viewer", testPassword()));
    ASSERT_EQ(run({"--user-disable", "kysu2"}).code, 0);
    const size_t rowsBefore = auditRows().size();
    ASSERT_EQ(::chown(data.c_str(), 0, 0), 0);  // root's, 0700: the service user cannot get in
    const std::string before = readFile(users);
    struct Case {
        std::vector<std::string> args;
        std::string input;
    };
    const Case cases[] = {
        {{"--user-add", "kysu3", "--role", "viewer", "--password-stdin"}, testPassword() + "\n"},
        {{"--user-passwd", "kysu1", "--password-stdin"}, testPassword() + "\n"},
        {{"--user-role", "kysu1", "operator"}, ""},
        {{"--user-disable", "kysu1"}, ""},
        {{"--user-enable", "kysu2"}, ""},
        {{"--user-unlock", "kysu1"}, ""},
    };
    for (const Case& c : cases) {
        const Outcome r = run(c.args, c.input);
        EXPECT_EQ(r.code, 5) << c.args[0] << ": " << r.err;
        EXPECT_NE(r.err.find("audit"), std::string::npos) << c.args[0] << ": " << r.err;
        EXPECT_EQ(readFile(users), before) << c.args[0];
    }
    ASSERT_EQ(::chown(data.c_str(), svcUid, svcGid), 0);
    EXPECT_EQ(auditRows().size(), rowsBefore);
}

TEST_F(UserCli, ExitCodes) {
    const std::string pw = testPassword();
    // not root: 4, before anything is read or asked
    EXPECT_EQ(run({"--user-add", "kysu1", "--role", "viewer", "--password-stdin"}, pw + "\n",
                  /*root=*/false)
                  .code,
              4);
    EXPECT_EQ(run({"--user-list"}, "", /*root=*/false).code, 4);
    EXPECT_EQ(run({"--user-unlock", "kysu1"}, "", /*root=*/false).code, 4);
    // invalid account name: 4
    for (const char* name :
         {"Kysu1", "ab", "1kysu", "ky su", "kysu/1", "a234567890123456789012345678901234"})
        EXPECT_EQ(run({"--user-add", name, "--role", "viewer", "--password-stdin"}, pw + "\n").code,
                  4)
            << name;
    EXPECT_EQ(run({"--user-passwd", "Admin", "--password-stdin"}, pw + "\n").code, 4);
    EXPECT_EQ(run({"--user-disable", "x"}).code, 4);
    // bad arguments: 2
    const std::vector<std::vector<std::string>> bad = {
        {"--user-add", "kysu1", "--password-stdin"},                    // no role
        {"--user-add", "kysu1", "--role", "boss", "--password-stdin"},  // unknown role
        {"--user-add", "--role", "viewer", "--password-stdin"},         // no name
        {"--user-add", "kysu1", "--role"},                              // role without value
        {"--user-role", "kysu1"},                                       // no role
        {"--user-role", "kysu1", "chief"},                              // unknown role
        {"--user-list", "--user-disable", "kysu1"},                     // two commands
        {"--user-disable", "kysu1", "--user-enable", "kysu1"},          // two commands
        {"--user-disable", "kysu1", "--role", "viewer"},                // --role is --user-add's
        {"--user-list", "--password-stdin"},                            // nothing to read
        {"--user-role", "kysu1", "viewer", "--password-stdin"},         // nothing to read
        {"--user-enable", "kysu1", "--frobnicate"},                     // unknown option
        {"--user-unlock"},                                              // no name
        {"--user-add", "kysu1", "--role", "viewer", "--password-stdin", "--users-file"},
        {"--user-add", "kysu1", "--role", "viewer", "--password-stdin", "--config",
         dir.path + "/no-such-runtime.json"},
    };
    for (const auto& args : bad) {
        const Outcome r = run(args, pw + "\n");
        std::string joined;
        for (const auto& a : args) joined += a + " ";
        EXPECT_EQ(r.code, 2) << joined << "→ " << r.err;
        EXPECT_FALSE(r.err.empty()) << joined;
    }
    EXPECT_FALSE(exists(users));
    EXPECT_TRUE(auditRows().empty());
    // damaged users.json: 6, and it stays as it was
    writeFile(users, "{not json", 0640);
    EXPECT_EQ(run({"--user-list"}).code, 6);
    EXPECT_EQ(run({"--user-add", "kysu1", "--role", "viewer", "--password-stdin"}, pw + "\n").code,
              6);
    EXPECT_EQ(run({"--user-unlock", "kysu1"}).code, 6);
    EXPECT_EQ(readFile(users), "{not json");
    EXPECT_TRUE(auditRows().empty());
}

// users.json cannot be written (here the container's read-only /sys): exit code 4; the attempt is
// in the audit log as `started`, then `failed`.
TEST_F(UserCli, AFileThatCannotBeWrittenIsRecordedAsFailed) {
    users = "/sys/mat-usercli-test.json";
    writeFile(users, "x", 0600);  // refused on the read-only sysfs of a container
    if (exists(users)) {
        ::unlink(users.c_str());
        GTEST_SKIP() << "/sys is writable here";
    }
    const Outcome r = run({"--user-add", "admin", "--role", "administrator", "--password-stdin"},
                          testPassword() + "\n");
    EXPECT_EQ(r.code, 4) << r.err;
    EXPECT_FALSE(exists(users));
    const auto rows = auditRows();
    ASSERT_EQ(rows.size(), 2u);
    EXPECT_EQ(rows[0].action, "account.create");
    EXPECT_EQ(rows[0].result, "started");
    EXPECT_EQ(rows[1].action, "account.create");
    EXPECT_EQ(rows[1].result, "failed");
    EXPECT_TRUE(rows[1].code.has_value());
}

// The directory of users.json is missing: exit code 4 before the password is read (the line is
// still in the pipe), and nothing is recorded.
TEST_F(UserCli, AMissingDirectoryStopsTheCommandBeforeThePassword) {
    users = dir.path + "/missing/users.json";
    int p[2];
    ASSERT_EQ(::pipe(p), 0);
    const std::string line = testPassword() + "\n";
    ASSERT_EQ(::write(p[1], line.data(), line.size()), static_cast<ssize_t>(line.size()));
    ::close(p[1]);
    const Outcome r =
        runOnFd({"--user-add", "admin", "--role", "administrator", "--password-stdin"}, p[0]);
    char buf[128];
    const ssize_t left = ::read(p[0], buf, sizeof buf);
    ::close(p[0]);
    EXPECT_EQ(r.code, 4) << r.err;
    EXPECT_NE(r.err.find(dir.path + "/missing"), std::string::npos) << r.err;
    EXPECT_EQ(left, static_cast<ssize_t>(line.size()));
    EXPECT_TRUE(auditRows().empty());
}

// Account commands take turns (flock on the directory of users.json from the read to the write):
// a command waits while another holds the lock, so two at once cannot lose a change.
TEST_F(UserCli, CommandsTakeTurnsOnUsersJson) {
    ASSERT_TRUE(add("admin", "administrator", testPassword()));
    ASSERT_TRUE(add("kysu1", "engineer", testPassword()));
    const int fd = ::open(etc.c_str(), O_RDONLY | O_DIRECTORY);
    ASSERT_GE(fd, 0);
    ASSERT_EQ(::flock(fd, LOCK_EX), 0);  // another command between its read and its write
    std::atomic<bool> done{false};
    Outcome r;
    std::thread other([&] {
        r = run({"--user-disable", "kysu1"});
        done = true;
    });
    std::this_thread::sleep_for(500ms);
    const bool waited = !done;
    const bool stillEnabled = account("kysu1").enabled;
    ::close(fd);  // releases the lock
    other.join();
    EXPECT_TRUE(waited);
    EXPECT_TRUE(stillEnabled);
    EXPECT_EQ(r.code, 0) << r.err;
    EXPECT_FALSE(account("kysu1").enabled);
}

TEST_F(UserCli, ChangesToMissingOrExistingAccountsAreRefused) {
    // no users.json yet: every account is missing
    for (const auto& args :
         std::vector<std::vector<std::string>>{{"--user-passwd", "admin", "--password-stdin"},
                                               {"--user-role", "admin", "viewer"},
                                               {"--user-disable", "admin"},
                                               {"--user-enable", "admin"},
                                               {"--user-unlock", "admin"}}) {
        const Outcome r = run(args, testPassword() + "\n");
        EXPECT_EQ(r.code, 4) << args[0] << ": " << r.err;
    }
    EXPECT_FALSE(exists(users));
    ASSERT_TRUE(add("admin", "administrator", testPassword()));
    const std::string before = readFile(users);
    EXPECT_EQ(
        run({"--user-add", "admin", "--role", "viewer", "--password-stdin"}, testPassword() + "\n")
            .code,
        4);
    EXPECT_EQ(run({"--user-disable", "kysu9"}).code, 4);
    EXPECT_EQ(readFile(users), before);
    EXPECT_EQ(auditRows().size(), 2u);  // only the creation of admin
}

// No argument takes a password, and a password given as one never shows in a message (it would
// end up in a log or on a shared screen).
TEST_F(UserCli, NoArgumentTakesAPassword) {
    const std::string pw = testPassword();
    for (const auto& args : std::vector<std::vector<std::string>>{
             {"--user-add", "kysu1", "--role", "viewer", "--password", pw},
             {"--user-add", "kysu1", "--role", "viewer", "--password=" + pw},
             {"--user-add", "kysu1", "--role", "viewer", pw},
             {"--user-add", "kysu1", "--role", "viewer", "--password-stdin", pw},
             {"--user-passwd", "kysu1", pw},
             {"--user-passwd", "kysu1", "--password-stdin=" + pw}}) {
        const Outcome r = run(args, pw + "\n");
        EXPECT_EQ(r.code, 2) << args[args.size() - 2];
        EXPECT_EQ(r.err.find(pw), std::string::npos) << r.err;
        EXPECT_EQ(r.out.find(pw), std::string::npos) << r.out;
    }
    EXPECT_FALSE(exists(users));
}

// 15–128 characters (not bytes), valid UTF-8, not the account name; one line, its CR dropped.
TEST_F(UserCli, PasswordRules) {
    ASSERT_TRUE(add("kysu-truong-ca1", "engineer", testPassword()));
    int64_t rev = 1;
    auto passwd = [&](const std::string& input) {
        return run({"--user-passwd", "kysu-truong-ca1", "--password-stdin"}, input);
    };
    const std::string hex = toHex(randomBytes(64));  // 128 characters
    const std::string refused[] = {
        hex.substr(0, 14) + "\n",           // 14 characters
        hex + "x\n",                        // 129 characters
        std::string(129, 'a') + "\n",       // 129 again
        "KYSU-TRUONG-CA1\n",                // the account name, ASCII case ignored
        "\xff" + hex.substr(0, 20) + "\n",  // not UTF-8
        "\n",                               // empty line
        "",                                 // nothing at all
    };
    for (const std::string& input : refused) {
        const Outcome r = passwd(input);
        EXPECT_EQ(r.code, 2) << input.size() << " bytes: " << r.err;
        EXPECT_FALSE(r.err.empty());
    }
    EXPECT_EQ(account("kysu-truong-ca1").rev, rev);
    std::string vietnamese;
    for (int i = 0; i < 128; ++i) vietnamese += "ệ";  // 128 characters, 384 bytes
    const std::string accepted[] = {hex.substr(0, 15), hex, vietnamese,
                                    "Mật khẩu dựng sẵn: ăâđêôơư ỨỪỬỮỰ " + hex.substr(0, 4)};
    for (const std::string& pw : accepted) {
        const Outcome r = passwd(pw + "\r\n");  // a CR before the line feed is not part of it
        ASSERT_EQ(r.code, 0) << pw << ": " << r.err;
        const Account a = account("kysu-truong-ca1");
        EXPECT_EQ(a.rev, ++rev);
        ASSERT_TRUE(a.hash.has_value());
        EXPECT_TRUE(verifyPassword(pw, *a.hash)) << pw;
    }
}

// A byte order mark at the start of stdin (PowerShell 5.1 pipes add one) is not part of the
// password.
TEST_F(UserCli, ByteOrderMarkOnStdinIsNotPartOfThePassword) {
    ASSERT_TRUE(add("kysu1", "engineer", testPassword()));
    const std::string pw = "mat-khau-" + toHex(randomBytes(8));
    const Outcome r =
        run({"--user-passwd", "kysu1", "--password-stdin"}, "\xEF\xBB\xBF" + pw + "\n");
    ASSERT_EQ(r.code, 0) << r.err;
    const Account a = account("kysu1");
    ASSERT_TRUE(a.hash.has_value());
    EXPECT_TRUE(verifyPassword(pw, *a.hash));
}

// ADR-011 (2026-10-11): two input methods may give the same "ă" as one precomposed character or as
// "a" + a combining mark. The Studio sends NFC; the device refuses combining marks (every block of
// ADR-011) with exit code 2 and says to set the input method to precomposed Unicode.
TEST_F(UserCli, CombiningMarksAreRefusedWithAHint) {
    ASSERT_TRUE(add("kysu1", "engineer", testPassword()));
    const std::string base = "mat-khau-" + toHex(randomBytes(6));  // 21 characters
    for (char32_t mark : {0x0300, 0x0301, 0x0306, 0x0323, 0x036F, 0x1AB0, 0x1AFF, 0x1DC0, 0x1DFF,
                          0x20D0, 0x20FF, 0xFE20, 0xFE2F}) {
        const std::string pw = base + "a" + utf8(mark);
        const Outcome r = run({"--user-passwd", "kysu1", "--password-stdin"}, pw + "\n");
        EXPECT_EQ(r.code, 2) << std::hex << static_cast<unsigned>(mark) << ": " << r.err;
        EXPECT_NE(r.err.find("Unicode dựng sẵn"), std::string::npos) << r.err;
        EXPECT_EQ(r.err.find(pw), std::string::npos);
    }
    // "Mật khẩu" typed as base letters and combining marks
    const std::string decomposed =
        "Ma" + utf8(0x0323) + utf8(0x0302) + "t kha" + utf8(0x0302) + utf8(0x0309) + "u " + base;
    EXPECT_EQ(run({"--user-passwd", "kysu1", "--password-stdin"}, decomposed + "\n").code, 2);
    EXPECT_EQ(
        run({"--user-add", "kysu2", "--role", "viewer", "--password-stdin"}, decomposed + "\n")
            .code,
        2);
    EXPECT_EQ(account("kysu1").rev, 1);
    EXPECT_EQ(accounts().find("kysu2"), nullptr);
    // the code points next to the blocks are fine
    int64_t rev = 1;
    for (char32_t near :
         {0x02FF, 0x0370, 0x1AAF, 0x1B00, 0x1DBF, 0x1E00, 0x20CF, 0x2100, 0xFE1F, 0xFE30}) {
        const std::string pw = base + utf8(near);
        const Outcome r = run({"--user-passwd", "kysu1", "--password-stdin"}, pw + "\n");
        EXPECT_EQ(r.code, 0) << std::hex << static_cast<unsigned>(near) << ": " << r.err;
        EXPECT_EQ(account("kysu1").rev, ++rev);
    }
}

// On a terminal the password is asked twice with the echo off; the terminal shows none of it and
// gets its echo back.
TEST_F(UserCli, ATerminalAsksTwiceWithEchoOff) {
    Pty t;
    ASSERT_TRUE(t.ok());
    ASSERT_TRUE(t.echoOn());
    const std::string pw = testPassword();
    std::thread typist([&] {
        if (t.waitEcho(false, 10s)) t.type(pw + "\n" + pw + "\n");
    });
    const Outcome r = runOnFd({"--user-add", "admin", "--role", "administrator"}, t.slave);
    typist.join();
    ASSERT_EQ(r.code, 0) << r.err;
    const Account a = account("admin");
    ASSERT_TRUE(a.hash.has_value());
    EXPECT_TRUE(verifyPassword(pw, *a.hash));
    EXPECT_EQ(t.drain().find("thu-"), std::string::npos);  // no echo of any part of it
    EXPECT_TRUE(t.echoOn());
    EXPECT_EQ(r.err.find(pw), std::string::npos);
    EXPECT_EQ(r.out.find(pw), std::string::npos);
}

TEST_F(UserCli, TwoDifferentEntriesOnATerminalAreRefused) {
    Pty t;
    ASSERT_TRUE(t.ok());
    std::thread typist([&] {
        if (t.waitEcho(false, 10s)) t.type(testPassword() + "\n" + testPassword() + "\n");
    });
    const Outcome r = runOnFd({"--user-add", "admin", "--role", "administrator"}, t.slave);
    typist.join();
    EXPECT_EQ(r.code, 2) << r.err;
    EXPECT_TRUE(t.echoOn());
    EXPECT_FALSE(exists(users));
    EXPECT_TRUE(auditRows().empty());
}

// Without a terminal the password comes only from --password-stdin.
TEST_F(UserCli, WithoutATerminalOnlyPasswordStdinReadsAPassword) {
    const Outcome r = run({"--user-add", "kysu1", "--role", "viewer"}, testPassword() + "\n");
    EXPECT_EQ(r.code, 2);
    EXPECT_NE(r.err.find("--password-stdin"), std::string::npos) << r.err;
    EXPECT_FALSE(exists(users));
}

// Ctrl+C at the prompt ends the command, and the terminal gets its echo back.
TEST_F(UserCli, AnInterruptedPromptGivesTheEchoBack) {
    Pty t;
    ASSERT_TRUE(t.ok());
    const pid_t child = ::fork();
    ASSERT_GE(child, 0);
    if (child == 0) {
        Outcome r = runOnFd({"--user-add", "admin", "--role", "administrator"}, t.slave);
        ::_exit(r.code == 0 ? 0 : 1);
    }
    const bool asked = t.waitEcho(false, 10s);
    ::kill(child, SIGINT);
    int status = 0;
    ASSERT_EQ(::waitpid(child, &status, 0), child);
    EXPECT_TRUE(asked);
    EXPECT_TRUE(WIFSIGNALED(status) && WTERMSIG(status) == SIGINT) << status;
    EXPECT_TRUE(t.echoOn());
    EXPECT_FALSE(exists(users));
}

// rev + 1 on a password, role or enabled change; unlockSeq + 1 on an unlock (rev stays). A change
// to what the account already has changes nothing and records nothing.
TEST_F(UserCli, RevAndUnlockSeq) {
    ASSERT_TRUE(add("admin", "administrator", testPassword()));
    const std::string pw1 = testPassword();
    ASSERT_TRUE(add("kysu1", "viewer", pw1));
    now = kLater;
    const std::string pw2 = testPassword();
    ASSERT_EQ(run({"--user-passwd", "kysu1", "--password-stdin"}, pw2 + "\n").code, 0);
    Account a = account("kysu1");
    EXPECT_EQ(a.rev, 2);
    EXPECT_EQ(a.createdAt, kNow);
    EXPECT_EQ(a.updatedAt, kLater);
    ASSERT_TRUE(a.hash.has_value());
    EXPECT_TRUE(verifyPassword(pw2, *a.hash));
    EXPECT_FALSE(verifyPassword(pw1, *a.hash));

    ASSERT_EQ(run({"--user-role", "kysu1", "engineer"}).code, 0);
    a = account("kysu1");
    EXPECT_EQ(a.role, Role::Engineer);
    EXPECT_EQ(a.rev, 3);
    ASSERT_EQ(run({"--user-disable", "kysu1"}).code, 0);
    a = account("kysu1");
    EXPECT_FALSE(a.enabled);
    EXPECT_EQ(a.rev, 4);
    ASSERT_EQ(run({"--user-enable", "kysu1"}).code, 0);
    a = account("kysu1");
    EXPECT_TRUE(a.enabled);
    EXPECT_EQ(a.rev, 5);
    ASSERT_EQ(run({"--user-unlock", "kysu1"}).code, 0);
    ASSERT_EQ(run({"--user-unlock", "kysu1"}).code, 0);
    a = account("kysu1");
    EXPECT_EQ(a.rev, 5);
    EXPECT_EQ(a.unlockSeq, 2);
    EXPECT_EQ(account("admin").rev, 1);

    const auto rows = auditRows();
    const std::string bytes = readFile(users);
    for (const auto& args : std::vector<std::vector<std::string>>{
             {"--user-role", "kysu1", "engineer"}, {"--user-enable", "kysu1"}}) {
        const Outcome r = run(args);
        EXPECT_EQ(r.code, 0) << r.err;
        EXPECT_FALSE(r.out.empty());
    }
    EXPECT_EQ(readFile(users), bytes);
    EXPECT_EQ(auditRows().size(), rows.size());

    // started, then ok, for each change; the account is the target
    const std::vector<std::string> actions = {
        "account.create",  "account.create", "account.password", "account.role",
        "account.disable", "account.enable", "account.unlock",   "account.unlock"};
    ASSERT_EQ(rows.size(), 2 * actions.size());
    for (size_t i = 0; i < actions.size(); ++i) {
        EXPECT_EQ(rows[2 * i].action, actions[i]);
        EXPECT_EQ(rows[2 * i].result, "started");
        EXPECT_EQ(rows[2 * i + 1].action, actions[i]);
        EXPECT_EQ(rows[2 * i + 1].result, "ok");
        EXPECT_EQ(rows[2 * i + 1].target.value_or(""), i == 0 ? "admin" : "kysu1");
    }
    const auto role = nlohmann::json::parse(rows[7].detail.value_or("{}"));
    EXPECT_EQ(role.value("from", ""), "viewer");
    EXPECT_EQ(role.value("to", ""), "engineer");
    for (const auto& row : rows) {
        EXPECT_EQ(row.detail.value_or("").find("$argon2"), std::string::npos);
        EXPECT_EQ(row.detail.value_or("").find(pw2), std::string::npos);
    }
}

// The last enabled administrator can be neither disabled nor given another role; a disabled
// administrator does not count.
TEST_F(UserCli, TheLastEnabledAdministratorStays) {
    ASSERT_TRUE(add("admin", "administrator", testPassword()));
    ASSERT_TRUE(add("kysu1", "engineer", testPassword()));
    const std::string bytes = readFile(users);
    for (const auto& args :
         std::vector<std::vector<std::string>>{{"--user-role", "admin", "engineer"},
                                               {"--user-role", "admin", "viewer"},
                                               {"--user-disable", "admin"}}) {
        const Outcome r = run(args);
        EXPECT_EQ(r.code, 4) << args[0];
        EXPECT_NE(r.err.find("administrator cuối cùng"), std::string::npos) << r.err;
    }
    EXPECT_EQ(readFile(users), bytes);
    ASSERT_TRUE(add("admin2", "administrator", testPassword()));
    ASSERT_EQ(run({"--user-disable", "admin2"}).code, 0);
    EXPECT_EQ(run({"--user-disable", "admin"}).code, 4);
    ASSERT_EQ(run({"--user-enable", "admin2"}).code, 0);
    EXPECT_EQ(run({"--user-role", "admin", "engineer"}).code, 0);
    EXPECT_EQ(run({"--user-disable", "admin2"}).code, 4);
    EXPECT_EQ(account("admin").role, Role::Engineer);
    EXPECT_TRUE(account("admin2").enabled);
}

// --user-list: name, role, "bật"/"tắt", last change; never a hash, a salt or a hash text.
// deploy.sh reads columns 2 and 3 to find an enabled administrator.
TEST_F(UserCli, ListShowsTheAccountsWithoutAnyHash) {
    Outcome r = run({"--user-list"});
    EXPECT_EQ(r.code, 0) << r.err;
    EXPECT_NE(r.out.find("chưa có tài khoản"), std::string::npos) << r.out;
    ASSERT_TRUE(add("admin", "administrator", testPassword()));
    ASSERT_TRUE(add("kysu1", "viewer", testPassword()));
    now = kLater;
    ASSERT_EQ(run({"--user-disable", "kysu1"}).code, 0);

    r = run({"--user-list"});
    ASSERT_EQ(r.code, 0) << r.err;
    const auto ls = lines(r.out);
    ASSERT_EQ(ls.size(), 3u) << r.out;
    EXPECT_EQ(fields(ls[1]), (std::vector<std::string>{"admin", "administrator", "bật", kNow}));
    EXPECT_EQ(fields(ls[2]), (std::vector<std::string>{"kysu1", "viewer", "tắt", kLater}));
    EXPECT_EQ(r.out.find("$argon2"), std::string::npos);
    for (const auto& a : accounts().users) {
        std::istringstream phc(a.passwordHash);
        for (std::string part; std::getline(phc, part, '$');) {
            if (part.size() >= 16) {
                EXPECT_EQ(r.out.find(part), std::string::npos) << part;
            }
        }
    }

    // an account whose hash cannot be used is listed with a note, still without the text
    std::string text = readFile(users);
    const Account k = account("kysu1");
    text.replace(text.find(k.passwordHash), k.passwordHash.size(), "$argon2id$broken");
    writeFile(users, text, 0640);
    r = run({"--user-list"});
    ASSERT_EQ(r.code, 0) << r.err;
    const auto again = lines(r.out);
    ASSERT_EQ(again.size(), 3u);
    EXPECT_GT(fields(again[2]).size(), 4u) << again[2];
    EXPECT_EQ(r.out.find("broken"), std::string::npos);
}

// A development container without the service user: the child keeps the current user (root
// here), and the command says so.
TEST_F(UserCli, WithoutTheServiceUserTheCurrentUserWrites) {
    serviceUser = "mat-no-such-user";
    ASSERT_EQ(::chown(data.c_str(), 0, 0), 0);
    const Outcome r = run({"--user-add", "admin", "--role", "administrator", "--password-stdin"},
                          testPassword() + "\n");
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_NE(r.err.find("mat-no-such-user"), std::string::npos) << r.err;
    struct stat st {};
    ASSERT_EQ(::stat((data + "/audit.db").c_str(), &st), 0);
    EXPECT_EQ(st.st_uid, 0u);
    EXPECT_EQ(auditRows().size(), 2u);
}

// --- T035 (feature 011, FR-017, contracts/device-api-011.md §2, §7)

// --user-unlock-all: the lockouts live in the runtime's memory, so the command leaves a request
// file, <dataDir>/auth-unlock.req (root, 0600), that the runtime reads and deletes within 5 s or at
// its next start (auth_service_test). Audit account.unlock, target "*", started then ok.
TEST_F(UserCli, UnlockAllLeavesARequestFileForTheRuntime) {
    const std::string req = data + "/auth-unlock.req";
    Outcome r = run({"--user-unlock-all"});
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_NE(r.out.find("5 s"), std::string::npos) << r.out;
    struct stat st {};
    ASSERT_EQ(::lstat(req.c_str(), &st), 0);
    EXPECT_TRUE(S_ISREG(st.st_mode));
    EXPECT_EQ(st.st_mode & 07777, 0600u);
    EXPECT_EQ(st.st_uid, 0u);
    const auto rows = auditRows();
    ASSERT_EQ(rows.size(), 2u);
    for (size_t i = 0; i < 2; ++i) {
        EXPECT_EQ(rows[i].action, "account.unlock");
        EXPECT_EQ(rows[i].result, i == 0 ? "started" : "ok");
        EXPECT_EQ(rows[i].channel, "cli");
        EXPECT_EQ(rows[i].target.value_or(""), "*");
        EXPECT_NE(rows[i].detail.value_or("").find("\"all\""), std::string::npos);
    }
    // Again while the runtime has not taken the first one: the same file, one more record.
    r = run({"--user-unlock-all"});
    EXPECT_EQ(r.code, 0) << r.err;
    EXPECT_EQ(auditRows().size(), 4u);
    // A symbolic link in its place is not followed.
    ASSERT_EQ(::unlink(req.c_str()), 0);
    const std::string elsewhere = dir.path + "/elsewhere";
    writeFile(elsewhere, "keep", 0644);
    ASSERT_EQ(::symlink(elsewhere.c_str(), req.c_str()), 0);
    r = run({"--user-unlock-all"});
    EXPECT_EQ(r.code, 0) << r.err;
    EXPECT_EQ(readFile(elsewhere), "keep");
    ASSERT_EQ(::lstat(req.c_str(), &st), 0);
    EXPECT_TRUE(S_ISREG(st.st_mode)) << "the link was replaced by the request file";
}

TEST_F(UserCli, UnlockAllExitCodes) {
    EXPECT_EQ(run({"--user-unlock-all"}, "", /*root=*/false).code, 4);
    EXPECT_EQ(run({"--user-unlock-all", "kysu1"}).code, 2) << "takes no name";
    EXPECT_EQ(run({"--user-unlock-all", "--password-stdin"}).code, 2);
    EXPECT_EQ(run({"--user-unlock-all", "--user-unlock", "kysu1"}).code, 2);
    EXPECT_FALSE(exists(data + "/auth-unlock.req"));
    EXPECT_TRUE(auditRows().empty());
    // No audit record: no request (exit code 5).
    ASSERT_EQ(::chown(data.c_str(), 0, 0), 0);  // root's, 0700: the service user cannot get in
    const Outcome r = run({"--user-unlock-all"});
    EXPECT_EQ(r.code, 5) << r.err;
    EXPECT_FALSE(exists(data + "/auth-unlock.req"));
    ASSERT_EQ(::chown(data.c_str(), svcUid, svcGid), 0);
}

// FR-017: a new password (--user-add, --user-passwd) has at least 10 characters; the device keeps
// its stricter rule of 15 (ADR-011, NIST SP 800-63B-4 for a password alone), so 10 to 14 are
// refused too. Nothing is written, nothing recorded.
TEST_F(UserCli, NewPasswordsShorterThanTenCharactersAreRefused) {
    ASSERT_TRUE(add("admin", "administrator", testPassword()));
    const std::string before = readFile(users);
    const size_t rows = auditRows().size();
    const std::string hex = toHex(randomBytes(8));  // 16 characters
    for (const size_t n : {size_t{1}, size_t{5}, size_t{9}, size_t{10}, size_t{14}}) {
        const std::string pw = hex.substr(0, n);
        Outcome r = run({"--user-add", "kysu1", "--role", "viewer", "--password-stdin"}, pw + "\n");
        EXPECT_EQ(r.code, 2) << n << ": " << r.err;
        EXPECT_NE(r.err.find("15"), std::string::npos) << r.err;
        if (n >= 9) EXPECT_EQ(r.err.find(pw), std::string::npos) << "never quoted";
        r = run({"--user-passwd", "admin", "--password-stdin"}, pw + "\n");
        EXPECT_EQ(r.code, 2) << n << ": " << r.err;
    }
    EXPECT_EQ(readFile(users), before);
    EXPECT_EQ(auditRows().size(), rows);
    EXPECT_TRUE(add("kysu1", "viewer", hex.substr(0, 15)));
}

// An account whose password was set before the rule keeps it: the other commands work on it and
// leave its hash as it is (FR-017, "tài khoản cũ không bị ép").
TEST_F(UserCli, AnOldAccountWithAShortPasswordIsNotForced) {
    ASSERT_TRUE(add("admin", "administrator", testPassword()));
    UsersFile f = accounts();
    const std::string old = toHex(randomBytes(4));  // 8 characters
    ASSERT_EQ(addAccount(f, "cu1", Role::Operator, hashPassword(old), kNow),
              AccountEditError::None);
    std::string e;
    ASSERT_TRUE(writeUsersFile(users, f, e)) << e;
    const std::string phc = account("cu1").passwordHash;
    for (const auto& args :
         std::vector<std::vector<std::string>>{{"--user-role", "cu1", "engineer"},
                                               {"--user-disable", "cu1"},
                                               {"--user-enable", "cu1"},
                                               {"--user-unlock", "cu1"},
                                               {"--user-list"}}) {
        const Outcome r = run(args);
        EXPECT_EQ(r.code, 0) << args[0] << ": " << r.err;
    }
    const Account a = account("cu1");
    EXPECT_EQ(a.passwordHash, phc);
    ASSERT_TRUE(a.hash.has_value());
    EXPECT_TRUE(verifyPassword(old, *a.hash));
}

// The byte order mark of a PowerShell 5.1 pipe is dropped for --user-add as for --user-passwd.
TEST_F(UserCli, ByteOrderMarkIsDroppedForANewAccountToo) {
    const std::string pw = "mat-khau-" + toHex(randomBytes(8));
    const Outcome r = run({"--user-add", "kysu1", "--role", "viewer", "--password-stdin"},
                          "\xEF\xBB\xBF" + pw + "\n");
    ASSERT_EQ(r.code, 0) << r.err;
    const Account a = account("kysu1");
    ASSERT_TRUE(a.hash.has_value());
    EXPECT_TRUE(verifyPassword(pw, *a.hash));
    EXPECT_FALSE(verifyPassword("\xEF\xBB\xBF" + pw, *a.hash));
}

TEST(UserCliCommand, RecognisesTheAccountCommands) {
    auto is = [](std::vector<std::string> args) {
        args.insert(args.begin(), "mat-runtime");
        std::vector<char*> argv;
        for (auto& a : args) argv.push_back(&a[0]);
        return isUserCommand(static_cast<int>(argv.size()), argv.data());
    };
    for (const char* c : {"--user-add", "--user-passwd", "--user-role", "--user-disable",
                          "--user-enable", "--user-unlock", "--user-unlock-all", "--user-list"})
        EXPECT_TRUE(is({c, "x"})) << c;
    EXPECT_FALSE(is({"--users-file", "/etc/mat-runtime/users.json"}));
    EXPECT_FALSE(is({"--check-project"}));
    EXPECT_FALSE(is({}));
}
