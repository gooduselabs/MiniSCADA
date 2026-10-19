// The store of feature 013 (contracts/access-model.md §1): the auth directory, users.json 1.1.0
// made once from the seed in /etc, access.json, the lock, rev, the .bak copy, a damaged file,
// limits.
#include "core/auth/access_store.hpp"

#include <gtest/gtest.h>
#include <sys/stat.h>
#include <unistd.h>

#include <thread>
#include <vector>

#include "core/auth/access_service.hpp"
#include "core/auth/tests/auth_test_support.hpp"

namespace mat {
namespace {

using mat::test::fakePhc;
using mat::test::fileExists;
using mat::test::fileMode;
using mat::test::readFile;
using mat::test::TempDir;
using mat::test::TestAccount;
using mat::test::usersText;
using mat::test::writeFile;

struct Rig {
    TempDir tmp;
    std::string seed = tmp.file("etc-users.json");
    std::string dir = tmp.file("auth");
    AuthStoreOptions options() const {
        AuthStoreOptions o;
        o.dir = dir;
        o.seedUsersFile = seed;
        o.ownerUser = "no-such-user-mat";  // keep the files of the process
        return o;
    }
};

std::vector<TestAccount> two() {
    return {{"admin", "administrator", fakePhc("pw-admin-123456789"), true, 1, 0},
            {"vh1", "operator", fakePhc("pw-vh1-1234567890"), true, 3, 0}};
}

TEST(AuthStore, PrepareMakesThePrivateDirectoryAndCopiesTheSeedOnce) {
    Rig r;
    writeFile(r.seed, usersText(two()), 0640);
    AuthStore s(r.options());
    std::string err;
    bool migrated = false;
    ASSERT_TRUE(s.prepare(err, &migrated)) << err;
    EXPECT_TRUE(migrated);
    EXPECT_EQ(fileMode(r.dir), 0700u);
    EXPECT_EQ(fileMode(s.usersPath()), 0600u);
    const UsersRead u = readUsersFile(s.usersPath());
    ASSERT_EQ(u.status, UsersStatus::Ok) << u.error;
    EXPECT_EQ(u.file.schemaVersion, "1.1.0");
    EXPECT_EQ(u.file.rev, 1);
    ASSERT_EQ(u.file.users.size(), 2u);
    EXPECT_EQ(u.file.find("vh1")->rev, 3) << "accounts keep their rev: sessions stay";
    EXPECT_TRUE(u.file.find("vh1")->groups.empty());
    // the seed is not read again
    writeFile(r.seed, usersText({two()[0]}), 0640);
    ASSERT_TRUE(s.prepare(err, &migrated)) << err;
    EXPECT_FALSE(migrated);
    EXPECT_EQ(readUsersFile(s.usersPath()).file.users.size(), 2u);
}

TEST(AuthStore, NoSeedOrABrokenSeedGivesNoAccount) {
    Rig r;
    AuthStore s(r.options());
    std::string err, seedError;
    bool migrated = true;
    ASSERT_TRUE(s.prepare(err, &migrated, &seedError)) << err;
    EXPECT_FALSE(migrated);
    EXPECT_TRUE(seedError.empty());
    EXPECT_FALSE(fileExists(s.usersPath()));
    EXPECT_EQ(s.read().users.status, UsersStatus::Missing);
    writeFile(r.seed, "{broken", 0640);
    ASSERT_TRUE(s.prepare(err, &migrated, &seedError)) << err;
    EXPECT_FALSE(migrated);
    EXPECT_FALSE(seedError.empty());
    EXPECT_FALSE(fileExists(s.usersPath()));
}

TEST(AuthStore, ADirectoryThatIsALinkOrOpenToOthersIsRefused) {
    Rig r;
    ASSERT_EQ(::mkdir(r.tmp.file("elsewhere").c_str(), 0700), 0);
    ASSERT_EQ(::symlink(r.tmp.file("elsewhere").c_str(), r.dir.c_str()), 0);
    AuthStore s(r.options());
    std::string err;
    EXPECT_FALSE(s.prepare(err));
    EXPECT_FALSE(err.empty());
    ::unlink(r.dir.c_str());
    ASSERT_EQ(::mkdir(r.dir.c_str(), 0777), 0);
    ::chmod(r.dir.c_str(), 0777);
    EXPECT_FALSE(s.prepare(err));
    ::chmod(r.dir.c_str(), 0700);
    EXPECT_TRUE(s.prepare(err)) << err;
}

TEST(AuthStore, ATransactionWritesWhatChangedWithTheNextRevAndABackup) {
    Rig r;
    writeFile(r.seed, usersText(two()), 0640);
    AuthStore s(r.options());
    std::string err;
    ASSERT_EQ(s.transact(
                  [](AuthTxn& t) {
                      EXPECT_EQ(t.before.accessState, AccessFileState::Missing);
                      t.access.groups.push_back({"ca-a", "Ca A"});
                      t.accessChanged = true;
                      return true;
                  },
                  err),
              TxnStatus::Ok)
        << err;
    AuthFiles f = s.read();
    ASSERT_EQ(f.accessState, AccessFileState::Ok) << f.accessError;
    EXPECT_EQ(f.access.rev, 1);
    EXPECT_EQ(fileMode(s.accessPath()), 0600u);
    EXPECT_EQ(f.users.file.rev, 1) << "users.json untouched";
    EXPECT_FALSE(fileExists(s.accessPath() + ".bak")) << "nothing before the first write";
    ASSERT_EQ(s.transact(
                  [](AuthTxn& t) {
                      EXPECT_EQ(t.access.rev, 1);
                      t.access.groups[0].name = "Ca A mới";
                      t.accessChanged = true;
                      t.users.find("vh1")->groups = {"ca-a"};
                      t.usersChanged = true;
                      return true;
                  },
                  err),
              TxnStatus::Ok)
        << err;
    f = s.read();
    EXPECT_EQ(f.access.rev, 2);
    EXPECT_EQ(f.access.groups[0].name, "Ca A mới");
    EXPECT_EQ(f.users.file.rev, 2);
    EXPECT_EQ(f.users.file.find("vh1")->groups, std::vector<std::string>{"ca-a"});
    const AccessParse bak = parseAccessFile(readFile(s.accessPath() + ".bak"));
    ASSERT_TRUE(bak.ok) << bak.error;
    EXPECT_EQ(bak.file.rev, 1);
    EXPECT_EQ(bak.file.groups[0].name, "Ca A");
    EXPECT_TRUE(fileExists(s.usersPath() + ".bak"));
    // an edit that gives up writes nothing
    ASSERT_EQ(s.transact(
                  [](AuthTxn& t) {
                      t.access.groups.clear();
                      t.accessChanged = true;
                      return false;
                  },
                  err),
              TxnStatus::Aborted);
    EXPECT_EQ(s.read().access.rev, 2);
    // the last sign-in does not change the rev
    ASSERT_EQ(s.transact(
                  [](AuthTxn& t) {
                      t.users.find("vh1")->lastLoginAt = 1792410000000;
                      t.usersChanged = true;
                      t.keepUsersRev = true;
                      return true;
                  },
                  err),
              TxnStatus::Ok);
    f = s.read();
    EXPECT_EQ(f.users.file.rev, 2);
    EXPECT_EQ(f.users.file.find("vh1")->lastLoginAt, 1792410000000);
    // no temporary file left
    for (const auto& n : r.tmp.names()) EXPECT_EQ(n.find(".tmp"), std::string::npos) << n;
}

TEST(AuthStore, ChangesAtOnceTakeTurns) {
    Rig r;
    writeFile(r.seed, usersText(two()), 0640);
    AuthStore s(r.options());
    std::string err;
    ASSERT_TRUE(s.prepare(err)) << err;
    std::vector<std::thread> workers;
    for (int w = 0; w < 4; ++w)
        workers.emplace_back([&r, w] {
            AuthStore mine(r.options());  // its own open of the directory, like another process
            for (int i = 0; i < 10; ++i) {
                std::string e;
                mine.transact(
                    [&](AuthTxn& t) {
                        t.access.groups.push_back(
                            {"g" + std::to_string(w) + "-" + std::to_string(i), "x"});
                        t.accessChanged = true;
                        return true;
                    },
                    e);
            }
        });
    for (auto& t : workers) t.join();
    const AuthFiles f = s.read();
    ASSERT_EQ(f.accessState, AccessFileState::Ok) << f.accessError;
    EXPECT_EQ(f.access.groups.size(), 40u) << "no change lost";
    EXPECT_EQ(f.access.rev, 40);
}

TEST(AuthStore, ADamagedAccessFileIsReportedAndTheBackupRestores) {
    Rig r;
    AuthStore s(r.options());
    std::string err;
    for (const char* name : {"Một", "Hai"})
        ASSERT_EQ(s.transact(
                      [&](AuthTxn& t) {
                          t.access.groups = {{"ca-a", name}};
                          t.accessChanged = true;
                          return true;
                      },
                      err),
                  TxnStatus::Ok);
    writeFile(s.accessPath(), "{\"schemaVersion\":\"1.0.0\"", 0600);
    AuthFiles f = s.read();
    EXPECT_EQ(f.accessState, AccessFileState::Invalid);
    EXPECT_FALSE(f.accessError.empty());
    int64_t rev = 0;
    ASSERT_TRUE(s.restoreAccessBackup(err, &rev)) << err;
    f = s.read();
    ASSERT_EQ(f.accessState, AccessFileState::Ok) << f.accessError;
    EXPECT_EQ(f.access.groups[0].name, "Một");
    EXPECT_EQ(f.access.rev, rev);
    EXPECT_GT(rev, 1);
    // others may read it: refused like users.json
    ::chmod(s.accessPath().c_str(), 0644);
    EXPECT_EQ(s.read().accessState, AccessFileState::Invalid);
    ::chmod(s.accessPath().c_str(), 0600);
    // too large
    writeFile(s.accessPath(), std::string(kAccessFileMaxBytes + 10, ' '), 0600);
    EXPECT_EQ(s.read().accessState, AccessFileState::Invalid);
}

TEST(AuthStore, NoBackupNothingToRestore) {
    Rig r;
    AuthStore s(r.options());
    std::string err;
    EXPECT_FALSE(s.restoreAccessBackup(err));
    EXPECT_FALSE(err.empty());
}

TEST(AccessStoreView, ReadsAgainWhenTheFileChanges) {
    Rig r;
    AuthStore s(r.options());
    std::string err;
    ASSERT_TRUE(s.prepare(err)) << err;
    AccessStoreView v(s.accessPath());
    int64_t now = 1000;
    v.refresh(now);
    EXPECT_EQ(v.state(), AccessFileState::Missing);
    ASSERT_EQ(s.transact(
                  [](AuthTxn& t) {
                      t.access.groups = {{"ca-a", "A"}};
                      t.accessChanged = true;
                      return true;
                  },
                  err),
              TxnStatus::Ok);
    EXPECT_FALSE(v.refresh(now + 500)) << "at most every 2 s";
    EXPECT_TRUE(v.refresh(now + 2500));
    EXPECT_EQ(v.state(), AccessFileState::Ok);
    EXPECT_EQ(v.file().rev, 1);
    EXPECT_FALSE(v.refresh(now + 5000)) << "same file: not read";
    ASSERT_EQ(s.transact(
                  [](AuthTxn& t) {
                      t.access.groups.clear();
                      t.accessChanged = true;
                      return true;
                  },
                  err),
              TxnStatus::Ok);
    v.recheckNow();
    EXPECT_TRUE(v.refresh(now + 5001));
    EXPECT_EQ(v.file().rev, 2);
}

TEST(UsersFile11, ReadsTheNewKeysAnd200Accounts) {
    nlohmann::json doc = nlohmann::json::parse(usersText(two()));
    doc["schemaVersion"] = "1.1.0";
    doc["rev"] = 12;
    doc["users"][1]["groups"] = {"ca-a", "bao-tri"};
    doc["users"][1]["lastLoginAt"] = 1792410000000;
    const UsersRead r = parseUsers(doc.dump());
    ASSERT_EQ(r.status, UsersStatus::Ok) << r.error;
    EXPECT_EQ(r.file.rev, 12);
    EXPECT_EQ(r.file.find("vh1")->groups, (std::vector<std::string>{"ca-a", "bao-tri"}));
    EXPECT_EQ(r.file.find("vh1")->lastLoginAt, 1792410000000);
    EXPECT_FALSE(r.file.find("admin")->lastLoginAt);
    const UsersRead back = parseUsers(usersJson(r.file));
    ASSERT_EQ(back.status, UsersStatus::Ok) << back.error;
    EXPECT_EQ(back.file.rev, 12);
    EXPECT_EQ(back.file.find("vh1")->groups.size(), 2u);
    for (const auto& bad : {nlohmann::json("x"), nlohmann::json::array({"A"}),
                            nlohmann::json::array({"ca-a", "ca-a"})}) {
        nlohmann::json d = doc;
        d["users"][1]["groups"] = bad;
        EXPECT_EQ(parseUsers(d.dump()).status, UsersStatus::Error) << bad.dump();
    }
    std::vector<TestAccount> many;
    for (int i = 0; i < 200; ++i)
        many.push_back({"user" + std::to_string(100 + i), "viewer", fakePhc("pw"), true, 1, 0});
    EXPECT_EQ(parseUsers(usersText(many)).status, UsersStatus::Ok);
    many.push_back({"user999", "viewer", fakePhc("pw"), true, 1, 0});
    EXPECT_EQ(parseUsers(usersText(many)).status, UsersStatus::Error);
}

// T030 (US5): a new version of the project keeps the rules of the resources that kept their id; a
// rule of a component renamed is an orphan (listed, gives nothing) and the new component has the
// project's default.
TEST(AccessService, RulesLiveThroughANewProject) {
    Rig r;
    AuthStore s(r.options());
    std::string err;
    ASSERT_EQ(s.transact(
                  [](AuthTxn& t) {
                      t.access.groups = {{"bao-tri", "Bảo trì"}};
                      t.access.rules = {
                          {"screen:bao-tri", AccessLevel::View, {"group:bao-tri"}},
                          {"item:tong-quan/chay-bom", AccessLevel::Operate, {"group:bao-tri"}}};
                      t.accessChanged = true;
                      return true;
                  },
                  err),
              TxnStatus::Ok)
        << err;
    const auto catalogWith = [](const std::string& button) {
        ResourceCatalog c;
        CatalogScreen tq;
        tq.id = "tong-quan";
        CatalogItem b;
        b.id = button;
        b.operable = true;
        b.tags = {"PUMP01.RUN_CMD"};
        tq.items = {b};
        CatalogScreen bt;
        bt.id = "bao-tri";
        c.screens = {tq, bt};
        return c;
    };
    Principal op;
    op.user = "vh1";
    op.role = Role::Operator;
    const auto serviceFor = [&](const ResourceCatalog& c) {
        AccessServiceOptions o;
        o.catalog = c;
        o.accessFile = s.accessPath();
        o.log = [](const std::string&) {};
        return std::make_unique<AccessService>(o);
    };
    auto before = serviceFor(catalogWith("chay-bom"));
    EXPECT_FALSE(before->forPrincipal(op, 1, 1)->access.canViewScreen("bao-tri"));
    EXPECT_FALSE(before->forPrincipal(op, 1, 1)->access.canOperate("tong-quan", "chay-bom"));
    EXPECT_TRUE(before->forPrincipal(op, 1, 1)->access.orphans.empty());
    // the deploy starts the process again: a new service over the same store
    auto after = serviceFor(catalogWith("chay-bom-1"));
    const SessionAccessPtr a = after->forPrincipal(op, 1, 1);
    EXPECT_FALSE(a->access.canViewScreen("bao-tri")) << "the rule of the screen still applies";
    EXPECT_TRUE(a->access.canOperate("tong-quan", "chay-bom-1")) << "the project's default";
    ASSERT_EQ(a->access.orphans.size(), 1u);
    EXPECT_EQ(a->access.orphans[0].resource, "item:tong-quan/chay-bom");
    EXPECT_EQ(s.read().access.rules.size(), 2u) << "loading a project removes no rule";
}

// The access of the sessions: kept per account and rev, read again after a write, a damaged store
// refusing all but the administrators (audited once).
TEST(AccessService, KeepsAnswersAndFollowsTheStore) {
    Rig r;
    AuthStore s(r.options());
    std::string err;
    ASSERT_TRUE(s.prepare(err)) << err;
    ResourceCatalog c;
    CatalogScreen bt;
    bt.id = "bao-tri";
    CatalogItem m;
    m.id = "may";
    m.tags = {"M1"};
    bt.items = {m};
    c.screens = {bt};
    std::vector<AuditEvent> audits;
    AccessServiceOptions o;
    o.catalog = c;
    o.accessFile = s.accessPath();
    o.projectHash = "sha256:x";
    o.tagIndex = [](const std::string& t) -> std::optional<size_t> {
        if (t == "M1") return 4;
        return std::nullopt;
    };
    int64_t now = 1000;
    o.monoMs = [&now] { return now; };
    o.log = [](const std::string&) {};
    o.audit = [&audits](const AuditEvent& e) { audits.push_back(e); };
    AccessService svc(o);
    Principal vh1;
    vh1.user = "vh1";
    vh1.role = Role::Operator;
    const SessionAccessPtr a = svc.forPrincipal(vh1, 3, 1);
    EXPECT_TRUE(a->access.canViewScreen("bao-tri"));
    EXPECT_TRUE(a->liveIndex(4));
    EXPECT_FALSE(a->liveIndex(5));
    EXPECT_EQ(a->access.projectHash, "sha256:x");
    EXPECT_EQ(svc.forPrincipal(vh1, 3, 1), a) << "kept";
    EXPECT_NE(svc.forPrincipal(vh1, 4, 1), a) << "another rev of the account";
    ASSERT_EQ(s.transact(
                  [](AuthTxn& t) {
                      t.access.rules.push_back({"screen:bao-tri", AccessLevel::View, {}});
                      t.accessChanged = true;
                      return true;
                  },
                  err),
              TxnStatus::Ok);
    svc.reloadNow();
    const SessionAccessPtr b = svc.forPrincipal(vh1, 3, 1);
    EXPECT_FALSE(b->access.canViewScreen("bao-tri"));
    EXPECT_FALSE(b->liveIndex(4));
    EXPECT_NE(b->fingerprint, a->fingerprint);
    EXPECT_EQ(b->access.storeRev, 1);
    // damaged: only administrators, one audit row
    writeFile(s.accessPath(), "{}", 0600);
    svc.reloadNow();
    EXPECT_EQ(svc.storeState(), AccessFileState::Invalid);
    EXPECT_TRUE(svc.forPrincipal(vh1, 3, 1)->access.screens.empty());
    Principal admin;
    admin.user = "admin";
    admin.role = Role::Administrator;
    EXPECT_TRUE(svc.forPrincipal(admin, 1, 1)->access.canViewScreen("bao-tri"));
    now += 5000;
    svc.forPrincipal(vh1, 3, 1);
    ASSERT_EQ(audits.size(), 1u);
    EXPECT_EQ(audits[0].action, AuditAction::AccessStoreInvalid);
    // anonymous
    EXPECT_TRUE(svc.anonymous()->access.anonymous);
}

}  // namespace
}  // namespace mat
