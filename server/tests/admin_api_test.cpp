// T014 (feature 013, contracts/admin-api.md §1 to §5): the admin API and the page's access routes,
// called without a socket (AdminApi::call) over the real sign-in service, store and access model:
// users and groups, the re-entered password, LAST_ADMIN, IN_USE, CONFLICT, 413/400, 429, the
// sessions ended at once, the audit (before/after, never a password).
#include "server/http/admin_api.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "core/auth/tests/auth_test_support.hpp"
#include "core/crypto/random.hpp"
#include "server/device_admin.hpp"
#include "server/tls/server_cert.hpp"

namespace mat {
namespace {

using mat::test::TempDir;
using mat::test::TestAccount;
using nlohmann::json;

const std::string kIp = "192.168.1.20";

struct Rig {
    TempDir dir;
    std::string seed = dir.file("seed-users.json");
    int64_t now = 5000000;
    std::mutex mu;
    std::vector<AuditEvent> events;
    std::map<std::string, std::string> pw;
    std::unique_ptr<AuthStore> store;
    std::unique_ptr<AuthService> auth;
    std::unique_ptr<AccessService> access;
    std::unique_ptr<AdminApi> api;
    std::string viewerLogin = "required";
    DeviceAdmin* device = nullptr;  // feature 027

    TestAccount account(const std::string& name, const std::string& role) {
        pw[name] = mat::test::randomPassword();
        return {name, role, mat::test::fakePhc(pw[name]), true, 1, 0};
    }

    Rig() {
        mat::test::writeFile(
            seed,
            mat::test::usersText({account("admin", "administrator"), account("vh1", "operator"),
                                  account("xem1", "viewer")}),
            0640);
        AuthStoreOptions so;
        so.dir = dir.file("auth");
        so.seedUsersFile = seed;
        so.ownerUser = "no-such-user-mat";
        store = std::make_unique<AuthStore>(so);
        std::string err;
        EXPECT_TRUE(store->prepare(err)) << err;
        AuthOptions ao;
        ao.usersFile = store->usersPath();
        ao.audit = [this](const AuditEvent& e) {
            std::lock_guard<std::mutex> l(mu);
            events.push_back(e);
        };
        ao.log = [](const std::string&) {};
        ao.monoMs = [this] { return now; };
        ao.hash = [](std::string_view password, const PasswordHash& ref) {
            return mat::test::fakeHash(password, ref);
        };
        ao.bootId = [] { return std::string("0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0"); };
        auth = std::make_unique<AuthService>(ao);
        AccessServiceOptions xo;
        CatalogScreen tq;
        tq.id = "tong-quan";
        CatalogItem run;
        run.id = "chay-bom";
        run.operable = true;
        run.tags = {"PUMP01.RUN_CMD"};
        CatalogItem cost;
        cost.id = "chi-phi";
        cost.tags = {"E1.COST"};
        tq.items = {run, cost};
        CatalogScreen bt;
        bt.id = "bao-tri";
        xo.catalog.screens = {tq, bt};
        xo.accessFile = store->accessPath();
        xo.monoMs = [this] { return now; };
        xo.log = [](const std::string&) {};
        access = std::make_unique<AccessService>(xo);
        build();
    }

    void build() {
        AdminBackend b;
        b.auth = auth.get();
        b.store = store.get();
        b.access = access.get();
        b.audit = [this](const AuditEvent& e) {
            std::lock_guard<std::mutex> l(mu);
            events.push_back(e);
        };
        b.viewerLogin = viewerLogin;
        b.device = device;
        b.monoMs = [this] { return now; };
        b.hash = [](const std::string& p) { return mat::test::fakePhc(p); };
        api = std::make_unique<AdminApi>(b);
    }

    // A web session of `name` and the caller the gate would make of it.
    AdminCaller signIn(const std::string& name, int port = 40000) {
        std::string p = pw.at(name);
        const LoginResult r = auth->loginWeb(name, p, {kIp, port});
        EXPECT_EQ(r.status, LoginStatus::Ok) << name;
        const WebAccess w = auth->authorizeWeb(r.token, {kIp, port}, Role::Viewer, false);
        AdminCaller c;
        c.user = w.user;
        c.role = w.role.value_or(Role::Viewer);
        c.groups = w.groups;
        c.accountRev = w.accountRev;
        c.usersRev = w.usersRev;
        c.from = {kIp, port};
        c.viaCookie = true;
        c.webToken = r.token;
        c.sessionKey = "key-" + name + "-" + std::to_string(port);
        return c;
    }
    // Feature 027: the Bearer session of Studio (POST /api/v1/auth/login) and the caller the gate
    // makes of it: no cookie, no web token; the session key is the hash of the Bearer token.
    AdminCaller bearer(const std::string& name, int port = 41000) {
        std::string p = pw.at(name);
        const LoginResult r = auth->login(name, p, {kIp, port});
        EXPECT_EQ(r.status, LoginStatus::Ok) << name;
        const Access a = auth->authorize(r.token, {kIp, port}, Role::Viewer, true);
        EXPECT_EQ(a.status, AccessStatus::Ok) << name;
        AdminCaller c;
        c.user = a.user;
        c.role = a.role.value_or(Role::Viewer);
        c.groups = a.groups;
        c.accountRev = a.accountRev;
        c.usersRev = a.usersRev;
        c.from = {kIp, port};
        c.viaCookie = false;
        c.sessionKey = "bearer-" + name;
        return c;
    }
    bool alive(const AdminCaller& c) {
        return auth->authorizeWeb(c.webToken, c.from, Role::Viewer, false).status ==
               AccessStatus::Ok;
    }

    AdminReply post(const std::string& path, const json& body, const AdminCaller& who) {
        return api->call("POST", path, {}, body.dump(), who);
    }
    AdminReply get(const std::string& path, const AdminCaller& who,
                   std::map<std::string, std::string> q = {}) {
        return api->call("GET", path, q, "", who);
    }
    int64_t usersRev() { return store->read().users.file.rev; }
    int64_t accessRev() { return store->read().access.rev; }
    // The rows of `a` that are not refusals (the refusals of the same action are on record too).
    std::vector<AuditEvent> audit(AuditAction a, bool withDenied = false) {
        std::lock_guard<std::mutex> l(mu);
        std::vector<AuditEvent> out;
        for (const auto& e : events)
            if (e.action == a && (withDenied || e.result != AuditResult::Denied)) out.push_back(e);
        return out;
    }
    std::string transcript() {
        std::lock_guard<std::mutex> l(mu);
        std::string s;
        for (const auto& e : events)
            s += std::string(auditActionName(e.action)) + " " + e.detail + " " +
                 e.code.value_or("") + "\n";
        return s;
    }
    AdminReply makeGroup(const std::string& id, const AdminCaller& admin) {
        return post("/api/v1/admin/groups",
                    {{"rev", accessRev()}, {"id", id}, {"name", "Nhóm " + id}}, admin);
    }
};

TEST(AdminApi, OnlyAdministratorsAndTheListHasNoSecret) {
    Rig r;
    const AdminCaller op = r.signIn("vh1");
    EXPECT_EQ(r.get("/api/v1/admin/users", op).status, 403);
    const AdminCaller admin = r.signIn("admin");
    const AdminReply list = r.get("/api/v1/admin/users", admin);
    ASSERT_EQ(list.status, 200) << list.body.dump();
    EXPECT_EQ(list.body["rev"], 1);
    ASSERT_EQ(list.body["users"].size(), 3u);
    const json& vh1 = list.body["users"][1];
    EXPECT_EQ(vh1["name"], "vh1");
    EXPECT_EQ(vh1["role"], "operator");
    EXPECT_EQ(vh1["sessions"], 1);
    EXPECT_TRUE(vh1["locked"].is_null());
    EXPECT_TRUE(vh1["createdAt"].is_number());
    EXPECT_EQ(list.body.dump().find("argon2"), std::string::npos) << "never a hash";
    EXPECT_EQ(r.audit(AuditAction::AdminRead).size(), 1u);
    r.get("/api/v1/admin/users", admin);
    EXPECT_EQ(r.audit(AuditAction::AdminRead).size(), 1u) << "not again within 60 s";
    r.now += 61000;
    r.get("/api/v1/admin/users", admin);
    EXPECT_EQ(r.audit(AuditAction::AdminRead).size(), 2u);
}

TEST(AdminApi, CreateAUserWhoSignsInAtOnce) {
    Rig r;
    const AdminCaller admin = r.signIn("admin");
    const std::string pw = mat::test::randomPassword(20);
    json body = {
        {"rev", 1}, {"name", "vh3"}, {"role", "operator"}, {"groups", {"ca-a"}}, {"password", pw}};
    AdminReply a = r.post("/api/v1/admin/users", body, admin);
    EXPECT_EQ(a.status, 400) << "no such group yet";
    EXPECT_EQ(a.body["error"], "NOT_FOUND");
    ASSERT_EQ(r.makeGroup("ca-a", admin).status, 201);
    a = r.post("/api/v1/admin/users", body, admin);
    ASSERT_EQ(a.status, 201) << a.body.dump();
    EXPECT_EQ(a.body["rev"], 2);
    EXPECT_FALSE(a.body.contains("password"));
    std::string p = pw;
    EXPECT_EQ(r.auth->loginWeb("vh3", p, {kIp, 1}).status, LoginStatus::Ok);
    EXPECT_EQ(r.store->read().users.file.find("vh3")->groups, std::vector<std::string>{"ca-a"});
    const auto created = r.audit(AuditAction::AccountCreate);
    ASSERT_EQ(created.size(), 1u);
    EXPECT_EQ(created[0].target, std::optional<std::string>("vh3"));
    EXPECT_EQ(created[0].channel, AuditChannel::Web);
    EXPECT_NE(created[0].detail.find("\"after\""), std::string::npos);
    // generated: shown once
    a = r.post("/api/v1/admin/users",
               {{"rev", 2}, {"name", "vh4"}, {"role", "viewer"}, {"generate", true}}, admin);
    ASSERT_EQ(a.status, 201) << a.body.dump();
    ASSERT_TRUE(a.body["password"].is_string());
    std::string gen = a.body["password"].get<std::string>();
    EXPECT_GE(gen.size(), 15u);
    const std::string genCopy = gen;
    EXPECT_EQ(r.auth->loginWeb("vh4", gen, {kIp, 2}).status, LoginStatus::Ok);
    // refusals
    EXPECT_EQ(r.post("/api/v1/admin/users",
                     {{"rev", 3}, {"name", "vh4"}, {"role", "viewer"}, {"generate", true}}, admin)
                  .body["error"],
              "EXISTS");
    a = r.post("/api/v1/admin/users",
               {{"rev", 1}, {"name", "vh5"}, {"role", "viewer"}, {"generate", true}}, admin);
    EXPECT_EQ(a.status, 409);
    EXPECT_EQ(a.body["error"], "CONFLICT");
    EXPECT_EQ(a.body["rev"], 3);
    a = r.post("/api/v1/admin/users",
               {{"rev", 3}, {"name", "vh5"}, {"role", "viewer"}, {"password", "short"}}, admin);
    EXPECT_EQ(a.status, 400);
    EXPECT_EQ(a.body["error"], "WEAK_PASSWORD");
    EXPECT_EQ(a.body["reason"], "TOO_SHORT");
    EXPECT_EQ(
        r.post("/api/v1/admin/users",
               {{"rev", 3}, {"name", "Bad Name"}, {"role", "viewer"}, {"generate", true}}, admin)
            .status,
        400);
    EXPECT_EQ(r.post("/api/v1/admin/users",
                     {{"rev", 3},
                      {"name", "vh6"},
                      {"role", "viewer"},
                      {"generate", true},
                      {"password", pw}},
                     admin)
                  .status,
              400)
        << "exactly one of password, generate";
    // no password in the audit
    const std::string all = r.transcript();
    EXPECT_EQ(all.find(pw), std::string::npos);
    EXPECT_EQ(all.find(genCopy), std::string::npos);
}

TEST(AdminApi, AChangeEndsTheSessionsOfThatAccountAtOnce) {
    Rig r;
    const AdminCaller admin = r.signIn("admin");
    const AdminCaller vh1 = r.signIn("vh1", 40001);
    const AdminCaller xem = r.signIn("xem1", 40002);
    ASSERT_EQ(r.makeGroup("ca-a", admin).status, 201);
    AdminReply a = r.post("/api/v1/admin/users/vh1", {{"rev", 1}, {"groups", {"ca-a"}}}, admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(a.body["rev"], 2);
    EXPECT_FALSE(r.alive(vh1)) << "D23: groups changed";
    EXPECT_TRUE(r.alive(xem));
    EXPECT_TRUE(r.alive(admin));
    const auto g = r.audit(AuditAction::AccountGroups);
    ASSERT_EQ(g.size(), 1u);
    EXPECT_NE(g[0].detail.find("before"), std::string::npos);
    // a demotion asks for the password again
    a = r.post("/api/v1/admin/users/xem1", {{"rev", 2}, {"role", "operator"}}, admin);
    EXPECT_EQ(a.status, 200) << "a promotion does not";
    a = r.post("/api/v1/admin/users/xem1", {{"rev", 3}, {"role", "viewer"}}, admin);
    EXPECT_EQ(a.status, 403);
    EXPECT_EQ(a.body["error"], "REAUTH_REQUIRED");
    a = r.post("/api/v1/admin/users/xem1",
               {{"rev", 3}, {"role", "viewer"}, {"reauth", mat::test::randomPassword()}}, admin);
    EXPECT_EQ(a.body["error"], "REAUTH_REQUIRED") << "a wrong password";
    a = r.post("/api/v1/admin/users/xem1",
               {{"rev", 3}, {"role", "viewer"}, {"reauth", r.pw["admin"]}}, admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(r.audit(AuditAction::AuthReauth, true).size(), 2u) << "the failure and the success";
    // disable: reauth, then the sessions go
    const AdminCaller xem2 = r.signIn("xem1", 40003);
    a = r.post("/api/v1/admin/users/xem1",
               {{"rev", 4}, {"enabled", false}, {"reauth", r.pw["admin"]}}, admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_FALSE(r.alive(xem2));
    std::string p = r.pw["xem1"];
    EXPECT_EQ(r.auth->loginWeb("xem1", p, {kIp, 9}).status, LoginStatus::Failed);
    a = r.post("/api/v1/admin/users/xem1", {{"rev", 5}, {"enabled", true}}, admin);
    EXPECT_EQ(a.status, 200);
    // the same value: nothing written
    a = r.post("/api/v1/admin/users/xem1", {{"rev", 6}, {"enabled", true}}, admin);
    EXPECT_EQ(a.status, 200);
    EXPECT_EQ(a.body["rev"], 6);
    EXPECT_EQ(r.usersRev(), 6);
    // unknown key, unknown account
    EXPECT_EQ(r.post("/api/v1/admin/users/xem1", {{"rev", 6}, {"admin", true}}, admin).status, 400);
    EXPECT_EQ(r.post("/api/v1/admin/users/nobody", {{"rev", 6}, {"unlock", true}}, admin).status,
              404);
}

TEST(AdminApi, TheLastAdministratorStays) {
    Rig r;
    const AdminCaller admin = r.signIn("admin");
    const std::string re = r.pw["admin"];
    AdminReply a = r.post("/api/v1/admin/users/admin",
                          {{"rev", 1}, {"enabled", false}, {"reauth", re}}, admin);
    EXPECT_EQ(a.status, 409);
    EXPECT_EQ(a.body["error"], "LAST_ADMIN");
    a = r.post("/api/v1/admin/users/admin", {{"rev", 1}, {"role", "engineer"}, {"reauth", re}},
               admin);
    EXPECT_EQ(a.body["error"], "LAST_ADMIN");
    a = r.post("/api/v1/admin/users/admin/delete", {{"rev", 1}, {"reauth", re}}, admin);
    EXPECT_EQ(a.body["error"], "LAST_ADMIN");
    EXPECT_EQ(r.usersRev(), 1);
    EXPECT_TRUE(r.alive(admin));
    // with a second administrator the first may step down, and is signed out
    ASSERT_EQ(
        r.post("/api/v1/admin/users/vh1", {{"rev", 1}, {"role", "administrator"}}, admin).status,
        200);
    a = r.post("/api/v1/admin/users/admin", {{"rev", 2}, {"role", "engineer"}, {"reauth", re}},
               admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(a.body["signedOut"], true);
    EXPECT_FALSE(r.alive(admin));
}

TEST(AdminApi, DeletingAUserTakesItOutOfTheRules) {
    Rig r;
    const AdminCaller admin = r.signIn("admin");
    AdminReply a = r.post("/api/v1/admin/access",
                          {{"rev", 0},
                           {"set",
                            {{{"resource", "screen:bao-tri"},
                              {"level", "view"},
                              {"grantees", {"user:vh1", "role:engineer"}}}}}},
                          admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(a.body["rev"], 1);
    const AdminCaller vh1 = r.signIn("vh1", 40001);
    a = r.post("/api/v1/admin/users/vh1/delete", {{"rev", 1}}, admin);
    EXPECT_EQ(a.body["error"], "REAUTH_REQUIRED");
    a = r.post("/api/v1/admin/users/vh1/delete", {{"rev", 1}, {"reauth", r.pw["admin"]}}, admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(a.body["rev"], 2);
    EXPECT_EQ(a.body["accessRev"], 2);
    EXPECT_FALSE(r.alive(vh1));
    const AuthFiles f = r.store->read();
    EXPECT_EQ(f.users.file.find("vh1"), nullptr);
    ASSERT_EQ(f.access.rules.size(), 1u);
    EXPECT_EQ(f.access.rules[0].grantees, std::vector<std::string>{"role:engineer"});
    EXPECT_EQ(r.audit(AuditAction::AccountDelete).size(), 1u);
}

TEST(AdminApi, GroupsInUseCannotGo) {
    Rig r;
    const AdminCaller admin = r.signIn("admin");
    ASSERT_EQ(r.makeGroup("ca-a", admin).status, 201);
    EXPECT_EQ(r.makeGroup("ca-a", admin).body["error"], "EXISTS");
    EXPECT_EQ(
        r.post("/api/v1/admin/groups", {{"rev", 1}, {"id", "A"}, {"name", "x"}}, admin).status,
        400);
    ASSERT_EQ(r.post("/api/v1/admin/users/vh1", {{"rev", 1}, {"groups", {"ca-a"}}}, admin).status,
              200);
    ASSERT_EQ(r.post("/api/v1/admin/access",
                     {{"rev", 1},
                      {"set",
                       {{{"resource", "screen:tong-quan"},
                         {"level", "view"},
                         {"grantees", {"group:ca-a"}}}}}},
                     admin)
                  .status,
              200);
    AdminReply a = r.get("/api/v1/admin/groups", admin);
    ASSERT_EQ(a.status, 200);
    EXPECT_EQ(a.body["groups"][0]["members"], json::array({"vh1"}));
    EXPECT_EQ(a.body["groups"][0]["rules"], 1);
    a = r.post("/api/v1/admin/groups/ca-a/delete", {{"rev", 2}, {"reauth", r.pw["admin"]}}, admin);
    EXPECT_EQ(a.status, 409);
    EXPECT_EQ(a.body["error"], "IN_USE");
    EXPECT_EQ(a.body["usedBy"]["users"], json::array({"vh1"}));
    EXPECT_EQ(a.body["usedBy"]["rules"][0]["resource"], "screen:tong-quan");
    a = r.post("/api/v1/admin/groups/ca-a", {{"rev", 2}, {"name", "Ca A (mới)"}}, admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(r.store->read().access.groups[0].name, "Ca A (mới)");
    ASSERT_EQ(
        r.post("/api/v1/admin/users/vh1", {{"rev", 2}, {"groups", json::array()}}, admin).status,
        200);
    ASSERT_EQ(
        r.post("/api/v1/admin/access",
               {{"rev", 3},
                {"set",
                 {{{"resource", "screen:tong-quan"}, {"level", "view"}, {"grantees", nullptr}}}}},
               admin)
            .status,
        200);
    a = r.post("/api/v1/admin/groups/ca-a/delete", {{"rev", 4}}, admin);
    EXPECT_EQ(a.body["error"], "REAUTH_REQUIRED");
    a = r.post("/api/v1/admin/groups/ca-a/delete", {{"rev", 4}, {"reauth", r.pw["admin"]}}, admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_TRUE(r.store->read().access.groups.empty());
    EXPECT_EQ(
        r.post("/api/v1/admin/groups/zz/delete", {{"rev", 5}, {"reauth", r.pw["admin"]}}, admin)
            .status,
        404);
}

TEST(AdminApi, RulesAreCheckedAgainstTheRunningProject) {
    Rig r;
    const AdminCaller admin = r.signIn("admin");
    const auto set = [&](json item, int64_t rev) {
        return r.post("/api/v1/admin/access", {{"rev", rev}, {"set", json::array({item})}}, admin);
    };
    AdminReply a =
        set({{"resource", "screen:nope"}, {"level", "view"}, {"grantees", json::array()}}, 0);
    EXPECT_EQ(a.status, 400);
    EXPECT_EQ(a.body["error"], "NOT_FOUND");
    EXPECT_EQ(a.body["resource"], "screen:nope");
    EXPECT_EQ(
        set({{"resource", "item:tong-quan/chi-phi"}, {"level", "operate"}, {"grantees", {"*"}}}, 0)
            .body["error"],
        "NOT_FOUND")
        << "a display component has no operate level";
    EXPECT_EQ(set({{"resource", "page:admin"}, {"level", "view"}, {"grantees", {"*"}}}, 0).status,
              400);
    EXPECT_EQ(
        set({{"resource", "screen:bao-tri"}, {"level", "view"}, {"grantees", {"group:zz"}}}, 0)
            .body["error"],
        "NOT_FOUND");
    EXPECT_EQ(
        set({{"resource", "screen:bao-tri"}, {"level", "view"}, {"grantees", {"user:nobody"}}}, 0)
            .body["error"],
        "NOT_FOUND");
    EXPECT_EQ(set({{"resource", "screen:bao-tri"}, {"level", "view"}, {"grantees", {"*", "*"}}}, 0)
                  .status,
              400);
    a = set(
        {{"resource", "item:tong-quan/chay-bom"}, {"level", "operate"}, {"grantees", {"user:vh1"}}},
        0);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(a.body["rev"], 1);
    EXPECT_EQ(
        set({{"resource", "screen:bao-tri"}, {"level", "view"}, {"grantees", json::array()}}, 0)
            .body["error"],
        "CONFLICT");
    const auto rows = r.audit(AuditAction::AccessRule);
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].target, std::optional<std::string>("item:tong-quan/chay-bom"));
    EXPECT_NE(rows[0].detail.find("\"before\":null"), std::string::npos) << rows[0].detail;
    // the rules apply to the next request of every session
    const AdminCaller vh1 = r.signIn("vh1", 40001);
    const AdminCaller xem = r.signIn("xem1", 40002);
    EXPECT_EQ(r.get("/api/v1/web/access", vh1).body["lockedItems"], json::object());
    a = r.get("/api/v1/web/access", xem);
    EXPECT_EQ(a.body["lockedItems"]["tong-quan"], json::array({"chay-bom"}));
    EXPECT_EQ(a.body["storeRev"], 1);
    // GET access: resources, rules, orphans; cleanup
    std::string err;
    ASSERT_EQ(r.store->transact(
                  [](AuthTxn& t) {
                      t.access.rules.push_back({"screen:da-xoa", AccessLevel::View, {"*"}});
                      t.accessChanged = true;
                      return true;
                  },
                  err),
              TxnStatus::Ok);
    a = r.get("/api/v1/admin/access", admin);
    ASSERT_EQ(a.status, 200);
    EXPECT_EQ(a.body["rev"], 2);
    EXPECT_EQ(a.body["storeState"], "ok");
    EXPECT_EQ(a.body["viewerLogin"], "required");
    EXPECT_EQ(a.body["orphans"], json::array({{{"resource", "screen:da-xoa"}, {"level", "view"}}}));
    bool hasItem = false;
    for (const auto& res : a.body["resources"])
        if (res["id"] == "item:tong-quan/chay-bom") {
            hasItem = true;
            EXPECT_EQ(res["levels"], json::array({"view", "operate"}));
            EXPECT_EQ(res["defaults"]["operate"], "operator");
        }
    EXPECT_TRUE(hasItem);
    a = r.post("/api/v1/admin/access/cleanup", {{"rev", 2}}, admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(a.body["removed"], 1);
    EXPECT_EQ(r.store->read().access.rules.size(), 1u);
}

TEST(AdminApi, ADamagedStoreIsRestoredFromItsBackup) {
    Rig r;
    const AdminCaller admin = r.signIn("admin");
    ASSERT_EQ(r.makeGroup("ca-a", admin).status, 201);
    ASSERT_EQ(r.makeGroup("ca-b", admin).status, 201);
    mat::test::writeFile(r.store->accessPath(), "{broken", 0600);
    r.access->reloadNow();
    AdminReply a = r.get("/api/v1/admin/access", admin);
    EXPECT_EQ(a.body["storeState"], "invalid");
    EXPECT_EQ(r.makeGroup("ca-c", admin).body["error"], "STORE_INVALID");
    const AdminCaller vh1 = r.signIn("vh1", 40001);
    EXPECT_EQ(r.get("/api/v1/web/access", vh1).body["screens"], json::array()) << "FR-036";
    EXPECT_EQ(r.post("/api/v1/admin/access/restore", json::object(), admin).body["error"],
              "REAUTH_REQUIRED");
    a = r.post("/api/v1/admin/access/restore", {{"reauth", r.pw["admin"]}}, admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    const AuthFiles f = r.store->read();
    ASSERT_EQ(f.accessState, AccessFileState::Ok);
    EXPECT_EQ(f.access.groups.size(), 1u) << "the file before the last write";
    EXPECT_EQ(r.get("/api/v1/web/access", vh1).body["screens"].size(), 2u);
    EXPECT_EQ(r.audit(AuditAction::AccessRestore).size(), 2u) << "started, ok";
}

TEST(AdminApi, BodiesAndTheRateLimit) {
    Rig r;
    const AdminCaller admin = r.signIn("admin");
    EXPECT_EQ(r.api->call("POST", "/api/v1/admin/groups", {}, "{not json", admin).status, 400);
    EXPECT_EQ(r.api->call("POST", "/api/v1/admin/groups", {}, "[1]", admin).status, 400);
    EXPECT_EQ(r.api
                  ->call("POST", "/api/v1/admin/groups", {},
                         std::string(kAdminBodyMaxBytes + 1, ' '), admin)
                  .status,
              413);
    std::string deep;
    for (int i = 0; i < 20; ++i) deep += "{\"a\":";
    deep += "1";
    for (int i = 0; i < 20; ++i) deep += "}";
    EXPECT_EQ(r.api->call("POST", "/api/v1/admin/groups", {}, deep, admin).status, 400);
    int limited = 0;
    for (int i = 0; i < 40; ++i)
        if (r.post("/api/v1/admin/groups", {{"rev", 999}, {"id", "g1"}, {"name", "x"}}, admin)
                .status == 429)
            ++limited;
    EXPECT_GE(limited, 6);  // 30 a minute (the first 4 above count too)
    r.now += 61000;
    EXPECT_NE(
        r.post("/api/v1/admin/groups", {{"rev", 999}, {"id", "g1"}, {"name", "x"}}, admin).status,
        429);
}

TEST(AdminApi, TheOwnPasswordKeepsThisSessionAndEndsTheOthers) {
    Rig r;
    const AdminCaller here = r.signIn("vh1", 40001);
    const AdminCaller there = r.signIn("vh1", 40002);
    const std::string fresh = mat::test::randomPassword(18);
    AdminReply a = r.post("/api/v1/web/password",
                          {{"old", mat::test::randomPassword()}, {"new", fresh}}, here);
    EXPECT_EQ(a.status, 403);
    EXPECT_EQ(a.body["error"], "REAUTH_REQUIRED");
    a = r.post("/api/v1/web/password", {{"old", r.pw["vh1"]}, {"new", "vh1"}}, here);
    EXPECT_EQ(a.body["error"], "WEAK_PASSWORD");
    a = r.post("/api/v1/web/password", {{"old", r.pw["vh1"]}, {"new", fresh}}, here);
    ASSERT_EQ(a.status, 204) << a.body.dump();
    EXPECT_TRUE(r.alive(here));
    EXPECT_FALSE(r.alive(there));
    std::string p = fresh;
    EXPECT_EQ(r.auth->loginWeb("vh1", p, {kIp, 3}).status, LoginStatus::Ok);
    EXPECT_EQ(r.transcript().find(fresh), std::string::npos);
    const auto rows = r.audit(AuditAction::AccountPassword);
    ASSERT_FALSE(rows.empty());
    EXPECT_EQ(rows.back().result, AuditResult::Ok);
    EXPECT_EQ(rows.back().channel, AuditChannel::Web);
}

TEST(AdminApi, TheAccessOfThePageAndViewAs) {
    Rig r;
    AdminCaller anon;
    anon.from = {kIp, 1};
    EXPECT_EQ(r.get("/api/v1/web/access", anon).status, 401) << "viewerLogin required";
    r.viewerLogin = "off";
    r.build();
    AdminReply a = r.get("/api/v1/web/access", anon);
    ASSERT_EQ(a.status, 200);
    EXPECT_EQ(a.body["anonymous"], true);
    EXPECT_TRUE(a.body["user"].is_null());
    const AdminCaller admin = r.signIn("admin");
    const AdminCaller xem = r.signIn("xem1", 40002);
    a = r.get("/api/v1/web/access", xem);
    EXPECT_EQ(a.body["user"], "xem1");
    EXPECT_EQ(a.body["lockedItems"]["tong-quan"], json::array({"chay-bom"}));
    EXPECT_EQ(r.get("/api/v1/admin/effective", xem, {{"user", "vh1"}}).status, 403);
    a = r.get("/api/v1/admin/effective", admin, {{"user", "xem1"}});
    ASSERT_EQ(a.status, 200);
    EXPECT_EQ(a.body["user"], "xem1");
    EXPECT_EQ(a.body["lockedItems"]["tong-quan"], json::array({"chay-bom"}));
    EXPECT_EQ(r.audit(AuditAction::AdminViewAs).size(), 1u);
    EXPECT_EQ(r.get("/api/v1/admin/effective", admin, {{"user", "nobody"}}).status, 404);
    // in one go, for the page's "who sees, who operates" (no view-as row)
    a = r.get("/api/v1/admin/effective", admin, {{"users", "xem1,vh1,nobody"}});
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(a.body["effective"]["xem1"]["lockedItems"]["tong-quan"], json::array({"chay-bom"}));
    EXPECT_EQ(a.body["effective"]["vh1"]["lockedItems"], json::object());
    EXPECT_FALSE(a.body["effective"].contains("nobody"));
    EXPECT_EQ(r.audit(AuditAction::AdminViewAs).size(), 1u);
    EXPECT_EQ(r.get("/api/v1/admin/effective", admin, {{"users", "Bad"}}).status, 400);
}

TEST(AdminApi, TheAdminPasswordReset) {
    Rig r;
    const AdminCaller admin = r.signIn("admin");
    const AdminCaller vh1 = r.signIn("vh1", 40001);
    AdminReply a =
        r.post("/api/v1/admin/users/vh1/password", {{"rev", 1}, {"generate", true}}, admin);
    EXPECT_EQ(a.body["error"], "REAUTH_REQUIRED");
    a = r.post("/api/v1/admin/users/vh1/password",
               {{"rev", 1}, {"generate", true}, {"reauth", r.pw["admin"]}}, admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    std::string gen = a.body["password"].get<std::string>();
    EXPECT_FALSE(r.alive(vh1));
    EXPECT_EQ(r.auth->loginWeb("vh1", gen, {kIp, 5}).status, LoginStatus::Ok);
    std::string old = r.pw["vh1"];
    EXPECT_EQ(r.auth->loginWeb("vh1", old, {kIp, 6}).status, LoginStatus::Failed);
}

// Feature 023 (device-api 1.6.0 mở rộng, apiVersion không đổi): the email of an account (no
// sign-out), the alarm email settings (strict check, groups that exist, rev, audit before the file)
// and the test email.
TEST(AdminApi, AlarmEmailSettingsAndAccountEmail) {
    Rig r;
    const AdminCaller admin = r.signIn("admin");
    const AdminCaller vh1 = r.signIn("vh1", 40001);
    const AdminCaller xem = r.signIn("xem1", 40002);
    EXPECT_EQ(r.get("/api/v1/admin/email", admin).status, 501) << "no email service";

    std::vector<std::string> sentTo;
    notify::EmailServiceOptions eo;
    eo.dir = r.dir.file("notify");
    eo.send = [&](const notify::SmtpOptions& o, const std::string&,
                  const std::vector<std::string>& to, const std::string& data) {
        notify::SmtpResult res;
        res.ok = o.host == "smtp.example.com" && data.find("Subject:") != std::string::npos;
        res.stage = "done";
        sentTo.insert(sentTo.end(), to.begin(), to.end());
        return res;
    };
    eo.password = []() -> std::optional<std::string> { return std::string("app-pass-123"); };
    notify::EmailService svc(eo);
    std::string err;
    ASSERT_TRUE(svc.start(err, false)) << err;
    AdminBackend b;
    b.auth = r.auth.get();
    b.store = r.store.get();
    b.access = r.access.get();
    b.audit = [&r](const AuditEvent& e) {
        std::lock_guard<std::mutex> l(r.mu);
        r.events.push_back(e);
    };
    b.monoMs = [&r] { return r.now; };
    b.email = &svc;
    r.api = std::make_unique<AdminApi>(b);

    EXPECT_EQ(r.get("/api/v1/admin/email", xem).status, 403);
    AdminReply a = r.get("/api/v1/admin/email", admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(a.body["rev"], 0);
    EXPECT_EQ(a.body["passwordSet"], true);
    EXPECT_EQ(a.body.dump().find("app-pass-123"), std::string::npos);

    json cfg = {{"enabled", true},
                {"siteName", "Trạm 1"},
                {"smtp",
                 {{"host", "smtp.example.com"},
                  {"port", 587},
                  {"username", "u"},
                  {"from", "scada@example.com"}}},
                {"rules", {{{"id", "r1"}, {"to", {"a@example.com"}}, {"groups", {"ca-a"}}}}}};
    a = r.post("/api/v1/admin/email", {{"rev", 0}, {"config", cfg}}, admin);
    EXPECT_EQ(a.status, 400) << "group ca-a does not exist yet";
    ASSERT_EQ(r.makeGroup("ca-a", admin).status, 201);
    json bad = cfg;
    bad["smtp"]["password"] = "x";
    EXPECT_EQ(r.post("/api/v1/admin/email", {{"rev", 0}, {"config", bad}}, admin).status, 400)
        << "no password through the API";
    a = r.post("/api/v1/admin/email", {{"rev", 0}, {"config", cfg}}, admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(a.body["rev"], 1);
    EXPECT_EQ(r.audit(AuditAction::EmailConfig).size(), 1u);
    a = r.post("/api/v1/admin/email", {{"rev", 0}, {"config", cfg}}, admin);
    EXPECT_EQ(a.status, 409);
    EXPECT_EQ(a.body["rev"], 1);
    EXPECT_EQ(svc.config().smtp.host, "smtp.example.com");

    EXPECT_EQ(r.post("/api/v1/admin/email/test", {{"to", "bad address"}}, admin).status, 400);
    a = r.post("/api/v1/admin/email/test", {{"to", "t@example.com"}}, admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(a.body["ok"], true);
    EXPECT_EQ(sentTo, std::vector<std::string>{"t@example.com"});
    EXPECT_EQ(r.audit(AuditAction::EmailTest).size(), 1u);

    // The email of an account: kept, listed, audited, no sign-out.
    const int64_t rev = r.usersRev();
    EXPECT_EQ(
        r.post("/api/v1/admin/users/vh1", {{"rev", rev}, {"email", "not valid"}}, admin).status,
        400);
    a = r.post("/api/v1/admin/users/vh1", {{"rev", rev}, {"email", "vh1@example.com"}}, admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_TRUE(r.alive(vh1)) << "an email change does not end the sessions";
    EXPECT_EQ(r.audit(AuditAction::AccountEmail).size(), 1u);
    a = r.get("/api/v1/admin/users", admin);
    bool seen = false;
    for (const auto& u : a.body["users"]) {
        if (u["name"] == "vh1") {
            EXPECT_EQ(u["email"], "vh1@example.com");
            seen = true;
        } else {
            EXPECT_TRUE(u["email"].is_null());
        }
    }
    EXPECT_TRUE(seen);
    a = r.post("/api/v1/admin/users/vh1", {{"rev", r.usersRev()}, {"email", nullptr}}, admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(r.store->read().users.file.find("vh1")->email, "");
}

// ---- feature 027 (specs/027-device-settings): settings.json and the certificate from the API

struct DeviceRig {
    Rig r;
    std::string dataDir = r.dir.file("data");
    int restarts = 0;
    std::unique_ptr<DeviceAdmin> dev;
    AdminCaller admin;

    DeviceRig() {
        DeviceAdminOptions o;
        o.dataDir = dataDir;
        o.base.viewerLogin = "required";
        o.base.deviceName = "BL335-01";
        o.running = o.base;
        o.hostname = [] { return std::string("bl335"); };
        o.cardIps = [] { return std::vector<std::string>{"192.0.2.10"}; };
        o.nowIso = [] { return std::string("2026-10-26T03:00:00Z"); };
        o.requestRestart = [this] { ++restarts; };
        o.updaterPath = dataDir + "/no-updater";
        dev = std::make_unique<DeviceAdmin>(o);
        r.device = dev.get();
        r.build();
        admin = r.signIn("admin");
    }
    AdminReply set(const json& settings, int64_t rev, const std::string& reauth = "") {
        json b = {{"rev", rev}, {"settings", settings}};
        if (!reauth.empty()) b["reauth"] = reauth;
        return r.post("/api/v1/admin/device-settings", b, admin);
    }
};

TEST(AdminDevice, GetShowsLayersAndCertificate) {
    DeviceRig d;
    EXPECT_EQ(d.r.get("/api/v1/admin/device-settings", d.r.signIn("vh1")).status, 403);
    const AdminReply g = d.r.get("/api/v1/admin/device-settings", d.admin);
    ASSERT_EQ(g.status, 200) << g.body.dump();
    EXPECT_EQ(g.body["rev"], 0);
    EXPECT_EQ(g.body["settings"], json::object());
    EXPECT_EQ(g.body["effective"]["viewerLogin"], "required");
    EXPECT_EQ(g.body["base"]["deviceName"], "BL335-01");
    EXPECT_FALSE(g.body["restartPending"].get<bool>());
    EXPECT_FALSE(g.body["update"]["updaterInstalled"].get<bool>());
    EXPECT_FALSE(g.body["cert"]["ok"].get<bool>()) << "no server.pem yet";
}

TEST(AdminDevice, SaveMergesKeepsBakAndAsksARestart) {
    DeviceRig d;
    AdminReply a = d.set({{"deviceName", "Trạm 1"}, {"maxLiveClientsPerSource", 4}}, 0);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(a.body["rev"], 1);
    EXPECT_TRUE(a.body["restart"].get<bool>());
    EXPECT_EQ(a.body["effective"]["deviceName"], "Trạm 1");
    EXPECT_EQ(d.restarts, 1);
    // the file is what loadConfig reads at the next start
    const auto text = readTextFile(deviceSettingsPath(d.dataDir));
    ASSERT_TRUE(text);
    const json f = json::parse(*text);
    EXPECT_EQ(f["rev"], 1);
    EXPECT_EQ(f["values"]["deviceName"], "Trạm 1");
    EXPECT_EQ(f["updatedBy"], "admin");
    // the second save keeps the first as .bak; a stale rev is 409
    EXPECT_EQ(d.set({{"deviceName", "Trạm 2"}}, 0).status, 409);
    ASSERT_EQ(d.set({{"deviceName", "Trạm 2"}}, 1).status, 200);
    const auto bak = readTextFile(deviceSettingsPath(d.dataDir) + ".bak");
    ASSERT_TRUE(bak);
    EXPECT_EQ(json::parse(*bak)["rev"], 1);
    // back to what runs: no restart
    const int before = d.restarts;
    a = d.set(json::object(), 2);
    ASSERT_EQ(a.status, 200);
    EXPECT_FALSE(a.body["restart"].get<bool>());
    EXPECT_EQ(d.restarts, before);
    // audit: before/after, never the password
    const auto rows = d.r.audit(AuditAction::DeviceSettings);
    ASSERT_EQ(rows.size(), 3u);
    const json detail = json::parse(rows[0].detail);
    EXPECT_EQ(detail["before"]["deviceName"], "BL335-01");
    EXPECT_EQ(detail["after"]["deviceName"], "Trạm 1");
}

TEST(AdminDevice, BadValuesAndOtherKeysAre400) {
    DeviceRig d;
    EXPECT_EQ(d.set({{"viewerLogin", "maybe"}}, 0).status, 400);
    EXPECT_EQ(d.set({{"httpsPort", 9443}}, 0).status, 400);
    EXPECT_EQ(d.r.post("/api/v1/admin/device-settings", {{"rev", 0}}, d.admin).status, 400);
    EXPECT_EQ(d.r.post("/api/v1/admin/device-settings",
                       {{"rev", 0}, {"settings", json::object()}, {"x", 1}}, d.admin)
                  .status,
              400);
    EXPECT_EQ(d.restarts, 0);
}

TEST(AdminDevice, LoweringTheProtectionNeedsTheReenteredPassword) {
    DeviceRig d;
    for (const json& s : {json{{"viewerLogin", "off"}}, json{{"viewerAccess", "any"}},
                          json{{"updateEnabled", true}}, json{{"allowedHosts", {"scada.local"}}}}) {
        const AdminReply a = d.set(s, 0);
        EXPECT_EQ(a.status, 403) << s.dump();
        EXPECT_EQ(a.body["error"], "REAUTH_REQUIRED");
        EXPECT_FALSE(a.body["lowered"].empty());
    }
    EXPECT_EQ(d.set({{"viewerLogin", "off"}}, 0, "wrong-password").status, 403);
    const AdminReply ok = d.set({{"viewerLogin", "off"}}, 0, d.r.pw.at("admin"));
    ASSERT_EQ(ok.status, 200) << ok.body.dump();
    // raising it again needs no password
    EXPECT_EQ(d.set({{"viewerLogin", "required"}}, 1).status, 200);
    EXPECT_EQ(d.r.transcript().find(d.r.pw.at("admin")), std::string::npos);
}

TEST(AdminDevice, RegenerateAddsTheCardAddressesAndExtraNames) {
    DeviceRig d;
    EXPECT_EQ(d.r.post("/api/v1/admin/cert/regen", json::object(), d.admin).status, 403);
    EXPECT_EQ(d.r.post("/api/v1/admin/cert/regen",
                       {{"reauth", d.r.pw.at("admin")}, {"san", {"*.bad"}}}, d.admin)
                  .status,
              400);
    const AdminReply a =
        d.r.post("/api/v1/admin/cert/regen",
                 {{"reauth", d.r.pw.at("admin")}, {"san", {"10.0.0.5", "scada.local"}}}, d.admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(a.body["fingerprint"].get<std::string>().size(), 64u);
    const json ips = a.body["sanIps"];
    EXPECT_NE(std::find(ips.begin(), ips.end(), "192.0.2.10"), ips.end());
    EXPECT_NE(std::find(ips.begin(), ips.end(), "10.0.0.5"), ips.end());
    const json dns = a.body["sanDns"];
    EXPECT_NE(std::find(dns.begin(), dns.end(), "scada.local"), dns.end());
    EXPECT_TRUE(a.body["restart"].get<bool>());
    EXPECT_EQ(d.restarts, 1);
    const AdminReply g = d.r.get("/api/v1/admin/device-settings", d.admin);
    EXPECT_EQ(g.body["cert"]["fingerprint"], a.body["fingerprint"]);
    EXPECT_TRUE(g.body["cert"]["warnings"].empty()) << "no TLS_NO_IP_SAN";
    EXPECT_FALSE(d.r.audit(AuditAction::CertRegenerate).empty());
    // a second one changes the fingerprint
    const AdminReply b =
        d.r.post("/api/v1/admin/cert/regen", {{"reauth", d.r.pw.at("admin")}}, d.admin);
    ASSERT_EQ(b.status, 200);
    EXPECT_NE(b.body["fingerprint"], a.body["fingerprint"]);
}

TEST(AdminDevice, CsrAndImportRefuseAForeignKeyOrAPrivateKey) {
    DeviceRig d;
    const std::string pw = d.r.pw.at("admin");
    ASSERT_EQ(d.r.post("/api/v1/admin/cert/regen", {{"reauth", pw}}, d.admin).status, 200);
    const AdminReply c = d.r.post("/api/v1/admin/cert/csr", {{"san", {"scada.local"}}}, d.admin);
    ASSERT_EQ(c.status, 200) << c.body.dump();
    EXPECT_NE(c.body["csrPem"].get<std::string>().find("CERTIFICATE REQUEST"), std::string::npos);
    // a certificate of another device: no key of this one fits
    mat::test::TempDir other;
    const ServerCert foreign = loadOrCreateServerCert({other.file("d"), "X"});
    ASSERT_TRUE(foreign.ok) << foreign.error;
    const std::string foreignPem =
        publicCertificatePem(*readTextFile(serverCertPath(other.file("d"))));
    AdminReply a = d.r.post("/api/v1/admin/cert/import", {{"pem", foreignPem}}, d.admin);
    EXPECT_EQ(a.status, 403) << "re-entered password first";
    a = d.r.post("/api/v1/admin/cert/import", {{"pem", foreignPem}, {"reauth", pw}}, d.admin);
    EXPECT_EQ(a.status, 400);
    EXPECT_EQ(a.body["error"], "CERT_KEY_MISMATCH");
    a = d.r.post("/api/v1/admin/cert/import",
                 {{"pem", *readTextFile(serverCertPath(other.file("d")))}, {"reauth", pw}},
                 d.admin);
    EXPECT_EQ(a.body["error"], "CERT_FILE_INVALID") << "a private key is never sent";
    a = d.r.post("/api/v1/admin/cert/import", {{"pem", "garbage"}, {"reauth", pw}}, d.admin);
    EXPECT_EQ(a.body["error"], "CERT_FILE_INVALID");
    // its own certificate again: accepted, fingerprint back
    const std::string own = publicCertificatePem(*readTextFile(serverCertPath(d.dataDir)));
    a = d.r.post("/api/v1/admin/cert/import", {{"pem", own}, {"reauth", pw}}, d.admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(a.body["fingerprint"].get<std::string>().size(), 64u);
    EXPECT_EQ(d.r.audit(AuditAction::TlsImport).size(), 8u) << "started + result, four times";
}

// Feature 027: Studio manages users with its Bearer session (no cookie, no CSRF): an administrator
// creates a user and a group, sets a rule, re-enters the password to demote; a wrong re-entered
// password is 403 REAUTH_REQUIRED; another role is 403 FORBIDDEN; the audit says channel https.
TEST(AdminApi, StudioManagesUsersWithItsBearerSession) {
    Rig r;
    const AdminCaller op = r.bearer("vh1", 41001);
    EXPECT_EQ(r.get("/api/v1/admin/users", op).status, 403);
    const AdminCaller admin = r.bearer("admin");
    ASSERT_EQ(r.get("/api/v1/admin/users", admin).status, 200);
    ASSERT_EQ(r.makeGroup("ca-a", admin).status, 201);
    AdminReply a = r.post("/api/v1/admin/users",
                          {{"rev", r.usersRev()},
                           {"name", "vh3"},
                           {"role", "operator"},
                           {"groups", {"ca-a"}},
                           {"generate", true}},
                          admin);
    ASSERT_EQ(a.status, 201) << a.body.dump();
    EXPECT_TRUE(a.body["password"].is_string());
    a = r.post(
        "/api/v1/admin/access",
        {{"rev", r.accessRev()},
         {"set",
          {{{"resource", "screen:bao-tri"}, {"level", "view"}, {"grantees", {"group:ca-a"}}}}}},
        admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    a = r.post("/api/v1/admin/users/vh3",
               {{"rev", r.usersRev()}, {"role", "viewer"}, {"reauth", "sai-mat-khau-dai-15"}},
               admin);
    EXPECT_EQ(a.status, 403);
    EXPECT_EQ(a.body["error"], "REAUTH_REQUIRED");
    a = r.post("/api/v1/admin/users/vh3",
               {{"rev", r.usersRev()}, {"role", "viewer"}, {"reauth", r.pw.at("admin")}}, admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(r.store->read().users.file.find("vh3")->role, Role::Viewer);
    const auto created = r.audit(AuditAction::AccountCreate);
    ASSERT_EQ(created.size(), 1u);
    EXPECT_EQ(created[0].channel, AuditChannel::Https);
    EXPECT_EQ(created[0].user, std::optional<std::string>("admin"));
}

}  // namespace
}  // namespace mat
