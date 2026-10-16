// T027 (feature 005; data-model §4, research R8, contracts/device-config.md §4): users.json.
// - Reading: schemaVersion 1.x, name pattern and uniqueness, roles, key types, at most 64
//   accounts, at most 256 KB; a broken file, a file others may read or write, or another MAJOR
//   gives no account at all. A hash outside the bounds damages only its account.
// - The runtime's view: re-read when inode, size or mtime (and mode, ctime) change, at most once
//   per 2 s on a fake clock; rev and unlockSeq changes reported for the sessions and lockouts.
// - Writing for the device commands: temporary file, mode 0640, group owner, rename; edits bump
//   rev or unlockSeq; never without an enabled administrator.
// Nothing logged or returned quotes a password hash.
#include "core/auth/account_store.hpp"

#include <grp.h>
#include <gtest/gtest.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <fstream>
#include <functional>
#include <string>
#include <utility>
#include <vector>

#include "core/auth/tests/auth_test_support.hpp"
#include "nlohmann/json.hpp"

using namespace mat;
using mat::test::phcText;
using mat::test::TempDir;
using mat::test::TestAccount;
using mat::test::usersText;
using mat::test::writeFile;

namespace {

const std::string kSalt(16, 's');
const std::string kHash(32, 'h');

std::string phc() { return phcText(19456, 2, 1, kSalt, kHash); }

std::vector<TestAccount> threeAccounts() {
    return {{"admin", "administrator", phc()},
            {"kysu1", "engineer", phc()},
            {"xem.1", "viewer", phc(), false, 4, 2}};
}

nlohmann::json usersJsonOf(const std::vector<TestAccount>& a) {
    return nlohmann::json::parse(usersText(a));
}

struct Logs {
    std::vector<std::string> lines;
    AuthLogFn fn() {
        return [this](const std::string& l) { lines.push_back(l); };
    }
    std::string all() const {
        std::string s;
        for (const auto& l : lines) s += l + "\n";
        return s;
    }
};

}  // namespace

// --- Reading

TEST(UsersFile, AccountNamePattern) {
    for (const char* ok : {"abc", "admin", "kysu1", "a.b-c_d", "xem.1", "a12",
                           "abcdefghijklmnopqrstuvwxyz012345"})  // 32 characters
        EXPECT_TRUE(validAccountName(ok)) << ok;
    for (const char* bad : {"", "ab", "Admin", "1abc", ".abc", "-abc", "_abc", "a b", "abc!",
                            "abcdefghijklmnopqrstuvwxyz0123456",  // 33
                            "ab\xC3\xA9", "abc\n", "ABC"})
        EXPECT_FALSE(validAccountName(bad)) << bad;
}

TEST(UsersFile, ReadsTheDataModelExample) {
    const UsersRead r = parseUsers(usersText(threeAccounts()));
    ASSERT_EQ(r.status, UsersStatus::Ok) << r.error;
    ASSERT_EQ(r.file.users.size(), 3u);
    EXPECT_EQ(r.file.schemaVersion, "1.0.0");
    const Account* admin = r.file.find("admin");
    ASSERT_NE(admin, nullptr);
    EXPECT_EQ(admin->role, Role::Administrator);
    EXPECT_TRUE(admin->enabled);
    EXPECT_EQ(admin->passwordHash, phc());
    ASSERT_TRUE(admin->hash.has_value());
    EXPECT_EQ(admin->hash->salt, kSalt);
    EXPECT_EQ(admin->hash->hash, kHash);
    EXPECT_EQ(admin->rev, 1);
    EXPECT_EQ(admin->unlockSeq, 0);
    EXPECT_EQ(admin->createdAt, "2026-10-20T03:00:00Z");
    EXPECT_EQ(admin->updatedAt, "2026-10-20T03:00:00Z");
    const Account* viewer = r.file.find("xem.1");
    ASSERT_NE(viewer, nullptr);
    EXPECT_EQ(viewer->role, Role::Viewer);
    EXPECT_FALSE(viewer->enabled);
    EXPECT_EQ(viewer->rev, 4);
    EXPECT_EQ(viewer->unlockSeq, 2);
    EXPECT_EQ(r.file.find("nobody"), nullptr);
    EXPECT_EQ(r.file.find("Admin"), nullptr) << "names are compared exactly";
    EXPECT_TRUE(r.damaged.empty());
}

TEST(UsersFile, LaterMinorVersionsAndUnknownKeys) {
    nlohmann::json j = usersJsonOf(threeAccounts());
    j["schemaVersion"] = "1.4.2";
    j["comment"] = "added by a later 1.x";
    j["users"][0]["lastLoginAt"] = "2026-10-21T00:00:00Z";
    const UsersRead r = parseUsers(j.dump());
    EXPECT_EQ(r.status, UsersStatus::Ok) << r.error;
    EXPECT_EQ(r.file.users.size(), 3u);
    const UsersRead empty = parseUsers(R"({"schemaVersion":"1.0.0","users":[]})");
    EXPECT_EQ(empty.status, UsersStatus::Ok) << empty.error;
    EXPECT_TRUE(empty.file.users.empty());
}

TEST(UsersFile, AnythingWrongGivesNoAccount) {
    const nlohmann::json good = usersJsonOf(threeAccounts());
    auto with = [&](const std::function<void(nlohmann::json&)>& change) {
        nlohmann::json j = good;
        change(j);
        return j.dump();
    };
    std::vector<std::pair<std::string, std::string>> cases = {
        {"not JSON", "{\"schemaVersion\":"},
        {"not an object", "[]"},
        {"no schemaVersion", with([](auto& j) { j.erase("schemaVersion"); })},
        {"MAJOR 2", with([](auto& j) { j["schemaVersion"] = "2.0.0"; })},
        {"MAJOR 0", with([](auto& j) { j["schemaVersion"] = "0.9.0"; })},
        {"not SemVer", with([](auto& j) { j["schemaVersion"] = "1.0"; })},
        {"schemaVersion number", with([](auto& j) { j["schemaVersion"] = 1; })},
        {"no users", with([](auto& j) { j.erase("users"); })},
        {"users not an array", with([](auto& j) { j["users"] = nlohmann::json::object(); })},
        {"account not an object", with([](auto& j) { j["users"][0] = "admin"; })},
        {"duplicate name", with([](auto& j) { j["users"][1]["name"] = "admin"; })},
        {"bad name", with([](auto& j) { j["users"][1]["name"] = "Kysu1"; })},
        {"name missing", with([](auto& j) { j["users"][1].erase("name"); })},
        {"unknown role", with([](auto& j) { j["users"][1]["role"] = "root"; })},
        {"role case", with([](auto& j) { j["users"][1]["role"] = "Engineer"; })},
        {"enabled not bool", with([](auto& j) { j["users"][1]["enabled"] = 1; })},
        {"no passwordHash", with([](auto& j) { j["users"][1].erase("passwordHash"); })},
        {"passwordHash not text", with([](auto& j) { j["users"][1]["passwordHash"] = 5; })},
        {"rev negative", with([](auto& j) { j["users"][1]["rev"] = -1; })},
        {"rev fraction", with([](auto& j) { j["users"][1]["rev"] = 1.5; })},
        {"rev text", with([](auto& j) { j["users"][1]["rev"] = "1"; })},
        {"no unlockSeq", with([](auto& j) { j["users"][1].erase("unlockSeq"); })},
        {"no createdAt", with([](auto& j) { j["users"][1].erase("createdAt"); })},
        {"updatedAt number", with([](auto& j) { j["users"][1]["updatedAt"] = 0; })},
    };
    nlohmann::json many = good;
    for (int i = 0; i < 62; ++i)
        many["users"].push_back({{"name", "user" + std::to_string(i)},
                                 {"role", "viewer"},
                                 {"enabled", true},
                                 {"passwordHash", phc()},
                                 {"rev", 1},
                                 {"unlockSeq", 0},
                                 {"createdAt", "2026-10-20T03:00:00Z"},
                                 {"updatedAt", "2026-10-20T03:00:00Z"}});
    ASSERT_EQ(many["users"].size(), 65u);
    cases.emplace_back("65 accounts", many.dump());
    for (const auto& c : cases) {
        const UsersRead r = parseUsers(c.second);
        EXPECT_EQ(r.status, UsersStatus::Error) << c.first;
        EXPECT_TRUE(r.file.users.empty()) << c.first;
        EXPECT_FALSE(r.error.empty()) << c.first;
        EXPECT_EQ(r.error.find(mat::test::b64(kHash)), std::string::npos) << r.error;
    }
    many["users"].erase(many["users"].size() - 1);  // 64 accounts: fine
    EXPECT_EQ(parseUsers(many.dump()).status, UsersStatus::Ok);
}

TEST(UsersFile, AHashOutOfBoundsDamagesOnlyItsAccount) {
    std::vector<TestAccount> a = threeAccounts();
    const std::string huge = phcText(1048576, 2, 1, kSalt, kHash);  // 1 GiB: never allocated
    a[1].phc = huge;
    a.push_back({"other", "viewer", "not a PHC string"});
    const UsersRead r = parseUsers(usersText(a));
    ASSERT_EQ(r.status, UsersStatus::Ok) << r.error;
    const Account* k = r.file.find("kysu1");
    ASSERT_NE(k, nullptr) << "a damaged account still exists";
    EXPECT_FALSE(k->hash.has_value());
    EXPECT_EQ(k->passwordHash, huge);
    const Account* o = r.file.find("other");
    ASSERT_NE(o, nullptr);
    EXPECT_FALSE(o->hash.has_value());
    ASSERT_NE(r.file.find("admin"), nullptr);
    EXPECT_TRUE(r.file.find("admin")->hash.has_value());
    ASSERT_EQ(r.damaged.size(), 2u);
    for (const auto& d : r.damaged) {
        EXPECT_TRUE(d.rfind("kysu1:", 0) == 0 || d.rfind("other:", 0) == 0) << d;
        EXPECT_EQ(d.find(mat::test::b64(kHash)), std::string::npos) << d;
        EXPECT_EQ(d.find("not a PHC"), std::string::npos) << d;
    }
}

TEST(UsersFile, ModeTypeAndSizeOfTheFile) {
    TempDir dir;
    const std::string f = dir.file("users.json");
    EXPECT_EQ(readUsersFile(f).status, UsersStatus::Missing);
    writeFile(f, usersText(threeAccounts()), 0640);
    EXPECT_EQ(readUsersFile(f).status, UsersStatus::Ok);
    ::chmod(f.c_str(), 0600);
    EXPECT_EQ(readUsersFile(f).status, UsersStatus::Ok);
    for (mode_t m : {0644, 0642, 0641, 0604}) {
        ::chmod(f.c_str(), m);
        const UsersRead r = readUsersFile(f);
        EXPECT_EQ(r.status, UsersStatus::Error) << std::oct << m;
        EXPECT_TRUE(r.file.users.empty());
        EXPECT_EQ(readUsersFile(f, false).status, UsersStatus::Ok) << "the commands read it";
    }
    ::chmod(f.c_str(), 0640);
    std::string big = usersText(threeAccounts());
    big.insert(big.size() - 2, std::string(kUsersFileMaxBytes, ' '));
    writeFile(f, big, 0640);
    EXPECT_EQ(readUsersFile(f).status, UsersStatus::Error);
    EXPECT_EQ(readUsersFile(dir.path()).status, UsersStatus::Error) << "a directory";
}

// T041 (feature 011, FR-026, D32): the runtime also refuses a users.json its group may write, or
// owned by anyone but root: whoever could write it could make an administrator. The commands read
// it anyway (and write it back root:<group> 0640).
TEST(UsersFile, GroupWriteOrAnOwnerOtherThanRootIsRefused) {
    TempDir dir;
    const std::string f = dir.file("users.json");
    writeFile(f, usersText(threeAccounts()), 0640);
    for (mode_t m : {0660, 0620, 0670}) {
        ::chmod(f.c_str(), m);
        const UsersRead r = readUsersFile(f);
        EXPECT_EQ(r.status, UsersStatus::Error) << std::oct << m;
        EXPECT_NE(r.error.find("group"), std::string::npos) << r.error;
        EXPECT_EQ(readUsersFile(f, false).status, UsersStatus::Ok) << "the commands read it";
    }
    ::chmod(f.c_str(), 0640);
    if (::geteuid() != 0) GTEST_SKIP() << "the owner part needs root, as in the container";
    ASSERT_EQ(::chown(f.c_str(), 1, static_cast<gid_t>(-1)), 0);  // daemon
    const UsersRead r = readUsersFile(f);
    EXPECT_EQ(r.status, UsersStatus::Error);
    EXPECT_NE(r.error.find("root"), std::string::npos) << r.error;
    EXPECT_EQ(readUsersFile(f, false).status, UsersStatus::Ok);
    ASSERT_EQ(::chown(f.c_str(), 0, static_cast<gid_t>(-1)), 0);
    EXPECT_EQ(readUsersFile(f).status, UsersStatus::Ok);
}

// --- The runtime's view

TEST(AccountStore, ReReadsWhenTheFileChangesAtMostEveryTwoSeconds) {
    TempDir dir;
    const std::string f = dir.file("users.json");
    writeFile(f, usersText(threeAccounts()), 0640);
    AccountStore store(f);
    int64_t now = 100000;
    store.refresh(now);
    EXPECT_EQ(store.loads(), 1);
    EXPECT_EQ(store.status(), UsersStatus::Ok);
    EXPECT_EQ(store.size(), 3u);
    ASSERT_NE(store.find("kysu1"), nullptr);

    // New content through rename: another inode and size.
    std::vector<TestAccount> v2 = threeAccounts();
    v2.push_back({"kysu2", "engineer", phc()});
    writeFile(dir.file("tmp"), usersText(v2), 0640);
    ASSERT_EQ(::rename(dir.file("tmp").c_str(), f.c_str()), 0);
    store.refresh(now + 1000);
    EXPECT_EQ(store.loads(), 1) << "not looked at within 2 s";
    EXPECT_EQ(store.find("kysu2"), nullptr);
    store.refresh(now + kUsersRecheckMs);
    EXPECT_EQ(store.loads(), 2);
    EXPECT_NE(store.find("kysu2"), nullptr);
    store.refresh(now + 3 * kUsersRecheckMs);
    EXPECT_EQ(store.loads(), 2) << "unchanged file: not read again";

    // Only the modification time.
    struct timespec times[2] = {{0, UTIME_OMIT}, {1000000000, 123}};
    ASSERT_EQ(::utimensat(AT_FDCWD, f.c_str(), times, 0), 0);
    store.refresh(now + 4 * kUsersRecheckMs);
    EXPECT_EQ(store.loads(), 3);

    // Only the size: same inode, rewritten in place.
    std::string text = usersText(v2) + "\n";
    {
        std::ofstream out(f, std::ios::binary | std::ios::trunc);
        out << text;
    }
    ASSERT_EQ(::utimensat(AT_FDCWD, f.c_str(), times, 0), 0);  // the same mtime as before
    store.refresh(now + 5 * kUsersRecheckMs);
    EXPECT_EQ(store.loads(), 4);

    // Only the inode: same bytes, same mtime, through rename.
    writeFile(dir.file("tmp"), text, 0640);
    ASSERT_EQ(::utimensat(AT_FDCWD, dir.file("tmp").c_str(), times, 0), 0);
    ASSERT_EQ(::rename(dir.file("tmp").c_str(), f.c_str()), 0);
    store.refresh(now + 6 * kUsersRecheckMs);
    EXPECT_EQ(store.loads(), 5);
}

TEST(AccountStore, ReportsRevAndUnlockChanges) {
    TempDir dir;
    const std::string f = dir.file("users.json");
    std::vector<TestAccount> v1 = {{"admin", "administrator", phc()},
                                   {"aaa", "engineer", phc(), true, 1, 0},
                                   {"bbb", "engineer", phc(), true, 1, 0},
                                   {"ccc", "viewer", phc(), true, 1, 0},
                                   {"ddd", "viewer", phc(), true, 1, 0}};
    writeFile(f, usersText(v1), 0640);
    AccountStore store(f);
    EXPECT_TRUE(store.refresh(0).empty()) << "the first read reports nothing";
    std::vector<TestAccount> v2 = v1;
    v2[1].rev = 2;             // aaa: new password, role or enabled flag
    v2[2].unlockSeq = 1;       // bbb: --user-unlock
    v2.erase(v2.begin() + 3);  // ccc: gone
    writeFile(dir.file("tmp"), usersText(v2), 0640);
    ASSERT_EQ(::rename(dir.file("tmp").c_str(), f.c_str()), 0);
    AccountChanges ch = store.refresh(kUsersRecheckMs);
    std::sort(ch.revoked.begin(), ch.revoked.end());
    std::sort(ch.unlocked.begin(), ch.unlocked.end());
    EXPECT_EQ(ch.revoked, (std::vector<std::string>{"aaa", "ccc"}));
    EXPECT_EQ(ch.unlocked, (std::vector<std::string>{"aaa", "bbb"}));
}

TEST(AccountStore, AnUnusableFileMeansNoAccountAndIsLoggedOnce) {
    TempDir dir;
    const std::string f = dir.file("users.json");
    writeFile(f, usersText(threeAccounts()), 0640);
    Logs logs;
    AccountStore store(f, logs.fn());
    store.refresh(0);
    ASSERT_EQ(store.status(), UsersStatus::Ok);
    ::chmod(f.c_str(), 0644);  // others may read it now
    AccountChanges ch = store.refresh(kUsersRecheckMs);
    EXPECT_EQ(store.status(), UsersStatus::Error);
    EXPECT_EQ(store.find("admin"), nullptr);
    EXPECT_EQ(store.size(), 0u);
    std::sort(ch.revoked.begin(), ch.revoked.end());
    EXPECT_EQ(ch.revoked, (std::vector<std::string>{"admin", "kysu1", "xem.1"}));
    store.refresh(2 * kUsersRecheckMs);
    store.refresh(3 * kUsersRecheckMs);
    ASSERT_EQ(logs.lines.size(), 1u) << logs.all();
    EXPECT_NE(logs.lines[0].find(f), std::string::npos) << logs.lines[0];
    ::chmod(f.c_str(), 0640);
    store.refresh(4 * kUsersRecheckMs);
    EXPECT_EQ(store.status(), UsersStatus::Ok);
    EXPECT_NE(store.find("admin"), nullptr);
}

TEST(AccountStore, MissingFileAndDamagedAccountsAreLoggedWithoutHashes) {
    TempDir dir;
    const std::string f = dir.file("users.json");
    Logs logs;
    AccountStore store(f, logs.fn());
    store.refresh(0);
    EXPECT_EQ(store.status(), UsersStatus::Missing);
    EXPECT_EQ(store.size(), 0u);
    std::vector<TestAccount> a = threeAccounts();
    a[1].phc = phcText(19456, 99, 1, kSalt, kHash);
    writeFile(f, usersText(a), 0640);
    store.refresh(kUsersRecheckMs);
    EXPECT_EQ(store.status(), UsersStatus::Ok);
    ASSERT_NE(store.find("kysu1"), nullptr);
    EXPECT_FALSE(store.find("kysu1")->hash.has_value());
    const std::string all = logs.all();
    EXPECT_NE(all.find("kysu1"), std::string::npos) << all;
    EXPECT_EQ(all.find(mat::test::b64(kHash)), std::string::npos) << all;
    EXPECT_EQ(all.find(mat::test::b64(kSalt)), std::string::npos) << all;
}

// --- Writing (device commands)

TEST(UsersWrite, TemporaryFileThenRenameWithMode0640) {
    TempDir dir;
    const std::string f = dir.file("users.json");
    UsersFile file = parseUsers(usersText(threeAccounts())).file;
    ASSERT_EQ(file.users.size(), 3u);
    std::string err, warning;
    ASSERT_TRUE(writeUsersFile(f, file, err, &warning, {"no-such-group-mat"})) << err;
    EXPECT_EQ(mat::test::fileMode(f), 0640u);
    EXPECT_EQ(dir.names(), std::vector<std::string>{"users.json"}) << "no temporary file left";
    const UsersRead back = readUsersFile(f);
    ASSERT_EQ(back.status, UsersStatus::Ok) << back.error;
    ASSERT_EQ(back.file.users.size(), 3u);
    EXPECT_EQ(back.file.find("xem.1")->rev, 4);
    EXPECT_EQ(back.file.find("xem.1")->passwordHash, phc());
    EXPECT_EQ(usersJson(back.file), usersJson(file));
    if (::geteuid() == 0) {
        EXPECT_FALSE(warning.empty()) << "no such group: said so";
    }
    writeFile(f, "{}", 0666);  // a replaced file gets 0640 again
    ASSERT_TRUE(writeUsersFile(f, file, err, nullptr, {"no-such-group-mat"})) << err;
    EXPECT_EQ(mat::test::fileMode(f), 0640u);
}

TEST(UsersWrite, GroupOwnerWhenRunningAsRoot) {
    if (::geteuid() != 0) GTEST_SKIP() << "needs root (the test container is)";
    const group* g = ::getgrnam("daemon");
    if (!g) GTEST_SKIP() << "no group daemon in this image";
    const gid_t gid = g->gr_gid;
    TempDir dir;
    const std::string f = dir.file("users.json");
    std::string err, warning;
    ASSERT_TRUE(
        writeUsersFile(f, parseUsers(usersText(threeAccounts())).file, err, &warning, {"daemon"}))
        << err;
    struct stat st {};
    ASSERT_EQ(::stat(f.c_str(), &st), 0);
    EXPECT_EQ(st.st_uid, 0u);
    EXPECT_EQ(st.st_gid, gid);
    EXPECT_TRUE(warning.empty()) << warning;
}

TEST(UsersWrite, ANonExistingDirectoryFails) {
    TempDir dir;
    std::string err;
    EXPECT_FALSE(writeUsersFile(dir.file("no/such/users.json"), UsersFile{}, err));
    EXPECT_FALSE(err.empty());
}

TEST(AccountEdits, AddAndChangeBumpRevOrUnlockSeq) {
    UsersFile f;
    const std::string now = "2026-10-21T08:00:00Z", later = "2026-10-21T09:00:00Z";
    EXPECT_EQ(addAccount(f, "admin", Role::Administrator, phc(), now), AccountEditError::None);
    EXPECT_EQ(addAccount(f, "kysu1", Role::Engineer, phc(), now), AccountEditError::None);
    ASSERT_EQ(f.users.size(), 2u);
    Account* k = f.find("kysu1");
    ASSERT_NE(k, nullptr);
    EXPECT_EQ(k->rev, 1);
    EXPECT_EQ(k->unlockSeq, 0);
    EXPECT_TRUE(k->enabled);
    EXPECT_EQ(k->createdAt, now);
    EXPECT_EQ(k->updatedAt, now);
    ASSERT_TRUE(k->hash.has_value());

    const std::string otherPhc = phcText(19456, 2, 1, std::string(16, 't'), kHash);
    EXPECT_EQ(setAccountPassword(f, "kysu1", otherPhc, later), AccountEditError::None);
    k = f.find("kysu1");
    EXPECT_EQ(k->rev, 2);
    EXPECT_EQ(k->passwordHash, otherPhc);
    EXPECT_EQ(k->updatedAt, later);
    EXPECT_EQ(k->createdAt, now);
    EXPECT_EQ(setAccountRole(f, "kysu1", Role::Viewer, later), AccountEditError::None);
    EXPECT_EQ(f.find("kysu1")->rev, 3);
    EXPECT_EQ(f.find("kysu1")->role, Role::Viewer);
    EXPECT_EQ(setAccountRole(f, "kysu1", Role::Viewer, later), AccountEditError::None);
    EXPECT_EQ(f.find("kysu1")->rev, 3) << "the same role: nothing changes";
    EXPECT_EQ(setAccountEnabled(f, "kysu1", false, later), AccountEditError::None);
    EXPECT_EQ(f.find("kysu1")->rev, 4);
    EXPECT_FALSE(f.find("kysu1")->enabled);
    EXPECT_EQ(setAccountEnabled(f, "kysu1", false, later), AccountEditError::None);
    EXPECT_EQ(f.find("kysu1")->rev, 4);
    EXPECT_EQ(setAccountEnabled(f, "kysu1", true, later), AccountEditError::None);
    EXPECT_EQ(f.find("kysu1")->rev, 5);
    EXPECT_EQ(unlockAccount(f, "kysu1", later), AccountEditError::None);
    EXPECT_EQ(f.find("kysu1")->unlockSeq, 1);
    EXPECT_EQ(f.find("kysu1")->rev, 5) << "unlocking ends no session";
}

TEST(AccountEdits, Refusals) {
    UsersFile f;
    const std::string now = "2026-10-21T08:00:00Z";
    ASSERT_EQ(addAccount(f, "admin", Role::Administrator, phc(), now), AccountEditError::None);
    EXPECT_EQ(addAccount(f, "admin", Role::Viewer, phc(), now), AccountEditError::Exists);
    EXPECT_EQ(addAccount(f, "Admin2", Role::Viewer, phc(), now), AccountEditError::InvalidName);
    EXPECT_EQ(addAccount(f, "ab", Role::Viewer, phc(), now), AccountEditError::InvalidName);
    EXPECT_EQ(addAccount(f, "kysu9", Role::Viewer, "$argon2id$v=19$bad", now),
              AccountEditError::BadHash);
    EXPECT_EQ(setAccountPassword(f, "nobody", phc(), now), AccountEditError::NotFound);
    EXPECT_EQ(setAccountRole(f, "nobody", Role::Viewer, now), AccountEditError::NotFound);
    EXPECT_EQ(setAccountEnabled(f, "nobody", false, now), AccountEditError::NotFound);
    EXPECT_EQ(unlockAccount(f, "nobody", now), AccountEditError::NotFound);
    EXPECT_EQ(removeAccount(f, "nobody"), AccountEditError::NotFound);
    EXPECT_EQ(setAccountPassword(f, "admin", "garbage", now), AccountEditError::BadHash);
    for (int i = 1; i < 64; ++i)
        ASSERT_EQ(addAccount(f, "user" + std::to_string(i), Role::Viewer, phc(), now),
                  AccountEditError::None);
    EXPECT_EQ(f.users.size(), 64u);
    EXPECT_EQ(addAccount(f, "user64", Role::Viewer, phc(), now), AccountEditError::TooMany);
    for (auto e : {AccountEditError::InvalidName, AccountEditError::Exists,
                   AccountEditError::NotFound, AccountEditError::TooMany,
                   AccountEditError::LastAdministrator, AccountEditError::BadHash})
        EXPECT_STRNE(accountEditMessage(e), "");
}

TEST(AccountEdits, NeverWithoutAnEnabledAdministrator) {
    UsersFile f;
    const std::string now = "2026-10-21T08:00:00Z";
    ASSERT_EQ(addAccount(f, "admin", Role::Administrator, phc(), now), AccountEditError::None);
    ASSERT_EQ(addAccount(f, "kysu1", Role::Engineer, phc(), now), AccountEditError::None);
    EXPECT_TRUE(hasEnabledAdministrator(f));
    EXPECT_EQ(setAccountRole(f, "admin", Role::Engineer, now), AccountEditError::LastAdministrator);
    EXPECT_EQ(setAccountEnabled(f, "admin", false, now), AccountEditError::LastAdministrator);
    EXPECT_EQ(removeAccount(f, "admin"), AccountEditError::LastAdministrator);
    ASSERT_NE(f.find("admin"), nullptr);
    EXPECT_EQ(f.find("admin")->role, Role::Administrator);
    EXPECT_TRUE(f.find("admin")->enabled);
    EXPECT_EQ(f.find("admin")->rev, 1) << "a refused change changes nothing";

    // A disabled administrator does not count.
    ASSERT_EQ(addAccount(f, "admin2", Role::Administrator, phc(), now), AccountEditError::None);
    ASSERT_EQ(setAccountEnabled(f, "admin2", false, now), AccountEditError::None);
    EXPECT_EQ(setAccountRole(f, "admin", Role::Viewer, now), AccountEditError::LastAdministrator);
    // Two enabled administrators: one may go.
    ASSERT_EQ(setAccountEnabled(f, "admin2", true, now), AccountEditError::None);
    EXPECT_EQ(setAccountRole(f, "admin", Role::Viewer, now), AccountEditError::None);
    EXPECT_EQ(removeAccount(f, "admin2"), AccountEditError::LastAdministrator);
    EXPECT_EQ(removeAccount(f, "kysu1"), AccountEditError::None);
    EXPECT_EQ(f.find("kysu1"), nullptr);
    EXPECT_TRUE(hasEnabledAdministrator(f));

    // Before the first administrator exists, other accounts may come and go.
    UsersFile g;
    EXPECT_FALSE(hasEnabledAdministrator(g));
    EXPECT_EQ(addAccount(g, "kysu1", Role::Engineer, phc(), now), AccountEditError::None);
    EXPECT_EQ(setAccountEnabled(g, "kysu1", false, now), AccountEditError::None);
    EXPECT_EQ(removeAccount(g, "kysu1"), AccountEditError::None);
}
