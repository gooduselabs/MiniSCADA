// T012 (feature 025, specs/025-data-api FR-007): the API keys of the admin page, called without a
// socket (AdminApi::call) over the real sign-in service, store, access model and key service:
// administrators only, the token in the answer of its creation and nowhere else (list, file,
// audit), the re-entered password for a key that may write, `rev`, the groups of access.json, the
// revocation, the audit of every change (before/after) and of the refusals.
#include <gtest/gtest.h>
#include <sys/stat.h>

#include <fstream>
#include <map>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <vector>

#include "core/auth/tests/auth_test_support.hpp"
#include "server/http/admin_api.hpp"

namespace mat {
namespace {

using mat::test::TempDir;
using mat::test::TestAccount;
using nlohmann::json;

const std::string kIp = "192.0.2.20";

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
    std::unique_ptr<ApiKeyService> keys;
    std::unique_ptr<AdminApi> api;

    TestAccount account(const std::string& name, const std::string& role) {
        pw[name] = mat::test::randomPassword();
        return {name, role, mat::test::fakePhc(pw[name]), true, 1, 0};
    }

    Rig() {
        mat::test::writeFile(
            seed,
            mat::test::usersText({account("admin", "administrator"), account("vh1", "operator")}),
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
        ao.audit = [this](const AuditEvent& e) { record(e); };
        ao.log = [](const std::string&) {};
        ao.monoMs = [this] { return now; };
        ao.hash = [](std::string_view password, const PasswordHash& ref) {
            return mat::test::fakeHash(password, ref);
        };
        ao.bootId = [] { return std::string("0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0"); };
        auth = std::make_unique<AuthService>(ao);
        AccessServiceOptions xo;
        xo.accessFile = store->accessPath();
        xo.monoMs = [this] { return now; };
        xo.log = [](const std::string&) {};
        access = std::make_unique<AccessService>(xo);
        ApiKeyService::Options ko;
        ko.dir = dir.file("auth");
        ko.ownerUser = "no-such-user-mat";
        ko.monoMs = [this] { return now; };
        keys = std::make_unique<ApiKeyService>(ko);
        EXPECT_TRUE(keys->load(err)) << err;
        AdminBackend b;
        b.auth = auth.get();
        b.store = store.get();
        b.access = access.get();
        b.audit = [this](const AuditEvent& e) { record(e); };
        b.monoMs = [this] { return now; };
        b.hash = [](const std::string& p) { return mat::test::fakePhc(p); };
        b.keys = keys.get();
        api = std::make_unique<AdminApi>(b);
    }
    void record(const AuditEvent& e) {
        std::lock_guard<std::mutex> l(mu);
        events.push_back(e);
    }
    AdminCaller signIn(const std::string& name) {
        std::string p = pw.at(name);
        const LoginResult r = auth->loginWeb(name, p, {kIp, 40000});
        EXPECT_EQ(r.status, LoginStatus::Ok) << name;
        const WebAccess w = auth->authorizeWeb(r.token, {kIp, 40000}, Role::Viewer, false);
        AdminCaller c;
        c.user = w.user;
        c.role = w.role.value_or(Role::Viewer);
        c.from = {kIp, 40000};
        c.viaCookie = true;
        c.webToken = r.token;
        c.sessionKey = "key-" + name;
        return c;
    }
    AdminReply post(const std::string& path, const json& body, const AdminCaller& who) {
        return api->call("POST", path, {}, body.dump(), who);
    }
    AdminReply list(const AdminCaller& who) {
        return api->call("GET", "/api/v1/admin/apikeys", {}, "", who);
    }
    int64_t rev() { return keys->list().rev; }
    std::vector<AuditEvent> audit(AuditAction a) {
        std::lock_guard<std::mutex> l(mu);
        std::vector<AuditEvent> out;
        for (const auto& e : events)
            if (e.action == a) out.push_back(e);
        return out;
    }
    std::string everything() {
        std::lock_guard<std::mutex> l(mu);
        std::string s;
        for (const auto& e : events)
            s += e.detail + " " + e.target.value_or("") + " " + e.code.value_or("") + "\n";
        return s;
    }
    std::string file() {
        std::ifstream f(dir.file("auth") + "/" + kApiKeysFileName);
        std::stringstream s;
        s << f.rdbuf();
        return s.str();
    }
};

TEST(AdminApiKeys, OnlyAdministrators) {
    Rig r;
    const AdminCaller op = r.signIn("vh1");
    EXPECT_EQ(r.list(op).status, 403);
    EXPECT_EQ(r.post("/api/v1/admin/apikeys", {{"rev", 0}, {"name", "x"}}, op).status, 403);
    const AdminCaller admin = r.signIn("admin");
    const AdminReply l = r.list(admin);
    ASSERT_EQ(l.status, 200) << l.body.dump();
    EXPECT_EQ(l.body["rev"], 0);
    EXPECT_EQ(l.body["keys"], json::array());
    EXPECT_EQ(l.body["storeOk"], true);
    EXPECT_EQ(l.body["limits"]["maxKeys"], 32);
}

TEST(AdminApiKeys, TheTokenComesBackOnceAndIsKeptNowhere) {
    Rig r;
    const AdminCaller admin = r.signIn("admin");
    const AdminReply a = r.post("/api/v1/admin/apikeys",
                                {{"rev", 0},
                                 {"name", "ERP kho"},
                                 {"allowFrom", {"192.0.2.0/24"}},
                                 {"expiresAt", "2099-01-01T00:00:00Z"}},
                                admin);
    ASSERT_EQ(a.status, 201) << a.body.dump();
    const std::string token = a.body.value("token", "");
    ASSERT_TRUE(isApiKeyFormat(token));
    EXPECT_EQ(a.body["rev"], 1);
    EXPECT_EQ(a.body["key"]["role"], "viewer") << "a viewer by default";
    EXPECT_EQ(a.body["key"]["readOnly"], true) << "read-only by default";
    EXPECT_EQ(a.body["key"]["prefix"], token.substr(0, 12));
    const std::string id = a.body["key"]["id"];
    const AdminReply l = r.list(admin);
    ASSERT_EQ(l.body["keys"].size(), 1u);
    EXPECT_EQ(l.body["keys"][0]["id"], id);
    EXPECT_EQ(l.body["keys"][0]["name"], "ERP kho");
    EXPECT_EQ(l.body["keys"][0]["calls"], 0);
    EXPECT_TRUE(l.body["keys"][0]["lastUsedAt"].is_null());
    EXPECT_EQ(l.body["keys"][0]["expiresAt"], "2099-01-01T00:00:00.000Z");
    const std::string secret = token.substr(12);
    EXPECT_EQ(l.body.dump().find(secret), std::string::npos);
    EXPECT_EQ(l.body.dump().find("hash"), std::string::npos) << "not even the hash";
    EXPECT_EQ(r.file().find(secret), std::string::npos);
    EXPECT_EQ(r.everything().find(secret), std::string::npos);
    const auto rows = r.audit(AuditAction::ApiKeyCreate);
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].result, AuditResult::Ok);
    EXPECT_EQ(rows[0].target, id);
    EXPECT_NE(rows[0].detail.find("ERP kho"), std::string::npos);
    // used once: the list says when, from where, how often
    ASSERT_EQ(r.keys->authenticate(token, "192.0.2.7").status, ApiKeyAuthStatus::Ok);
    const AdminReply l2 = r.list(admin);
    EXPECT_EQ(l2.body["keys"][0]["calls"], 1);
    EXPECT_EQ(l2.body["keys"][0]["lastFrom"], "192.0.2.7");
    EXPECT_TRUE(l2.body["keys"][0]["lastUsedAt"].is_string());
}

TEST(AdminApiKeys, AKeyThatMayWriteNeedsThePasswordAgain) {
    Rig r;
    const AdminCaller admin = r.signIn("admin");
    json body = {{"rev", 0}, {"name", "MES"}, {"role", "operator"}, {"readOnly", false}};
    AdminReply a = r.post("/api/v1/admin/apikeys", body, admin);
    EXPECT_EQ(a.status, 403);
    EXPECT_EQ(a.body["error"], "REAUTH_REQUIRED");
    body["reauth"] = "sai-mat-khau";
    EXPECT_EQ(r.post("/api/v1/admin/apikeys", body, admin).body["error"], "REAUTH_REQUIRED");
    EXPECT_EQ(r.rev(), 0) << "nothing made";
    body["reauth"] = r.pw["admin"];
    a = r.post("/api/v1/admin/apikeys", body, admin);
    ASSERT_EQ(a.status, 201) << a.body.dump();
    EXPECT_EQ(r.everything().find(r.pw["admin"]), std::string::npos) << "never the password";
    // a read-only operator key needs no password; turning it into a writer does
    a = r.post("/api/v1/admin/apikeys", {{"rev", 1}, {"name", "BI"}, {"role", "operator"}}, admin);
    ASSERT_EQ(a.status, 201) << a.body.dump();
    const std::string id = a.body["key"]["id"];
    a = r.post("/api/v1/admin/apikeys/" + id, {{"rev", 2}, {"readOnly", false}}, admin);
    EXPECT_EQ(a.body["error"], "REAUTH_REQUIRED");
    a = r.post("/api/v1/admin/apikeys/" + id,
               {{"rev", 2}, {"readOnly", false}, {"reauth", r.pw["admin"]}}, admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(a.body["key"]["readOnly"], false);
    // narrowing needs no password
    a = r.post("/api/v1/admin/apikeys/" + id, {{"rev", 3}, {"readOnly", true}}, admin);
    EXPECT_EQ(a.status, 200) << a.body.dump();
}

TEST(AdminApiKeys, RevGroupsSettingsAndRevocation) {
    Rig r;
    const AdminCaller admin = r.signIn("admin");
    AdminReply a =
        r.post("/api/v1/admin/apikeys", {{"rev", 0}, {"name", "x"}, {"groups", {"ca-a"}}}, admin);
    EXPECT_EQ(a.status, 400);
    EXPECT_EQ(a.body["error"], "NOT_FOUND") << "no such group";
    for (const json& bad : {json{{"rev", 0}}, json{{"rev", 0}, {"name", "x"}, {"role", "engineer"}},
                            json{{"rev", 0}, {"name", "x"}, {"allowFrom", {"192.0.2.0/99"}}},
                            json{{"rev", 0}, {"name", "x"}, {"ratePerMin", 5}},
                            json{{"rev", 0}, {"name", "x"}, {"expiresAt", "2020-01-01T00:00:00Z"}},
                            json{{"rev", 0}, {"name", "x"}, {"hash", "00"}}, json{{"name", "x"}}}) {
        a = r.post("/api/v1/admin/apikeys", bad, admin);
        EXPECT_EQ(a.status, 400) << bad.dump() << a.body.dump();
    }
    EXPECT_EQ(r.rev(), 0);
    a = r.post("/api/v1/admin/apikeys", {{"rev", 0}, {"name", "x"}}, admin);
    ASSERT_EQ(a.status, 201);
    const std::string id = a.body["key"]["id"];
    const std::string token = a.body["token"];
    a = r.post("/api/v1/admin/apikeys/" + id, {{"rev", 0}, {"name", "y"}}, admin);
    EXPECT_EQ(a.status, 409);
    EXPECT_EQ(a.body["rev"], 1);
    a = r.post("/api/v1/admin/apikeys/abcdefabcdef", {{"rev", 1}, {"name", "y"}}, admin);
    EXPECT_EQ(a.status, 404);
    a = r.post("/api/v1/admin/apikeys/" + id,
               {{"rev", 1}, {"name", "y"}, {"allowFrom", {"198.51.100.0/24"}}, {"ratePerMin", 60}},
               admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(r.keys->authenticate(token, "192.0.2.1").status, ApiKeyAuthStatus::Source);
    const auto upd = r.audit(AuditAction::ApiKeyUpdate);
    ASSERT_FALSE(upd.empty());
    EXPECT_NE(upd.back().detail.find("\"before\""), std::string::npos);
    EXPECT_NE(upd.back().detail.find("198.51.100.0/24"), std::string::npos);
    a = r.post("/api/v1/admin/apikeys/" + id + "/revoke", {{"rev", 2}}, admin);
    ASSERT_EQ(a.status, 200) << a.body.dump();
    EXPECT_EQ(a.body["rev"], 3);
    EXPECT_EQ(r.keys->authenticate(token, "198.51.100.1").status, ApiKeyAuthStatus::Invalid);
    EXPECT_EQ(r.list(admin).body["keys"], json::array());
    EXPECT_EQ(r.audit(AuditAction::ApiKeyRevoke).size(), 1u);
    a = r.post("/api/v1/admin/apikeys/" + id + "/revoke", {{"rev", 3}}, admin);
    EXPECT_EQ(a.status, 404);
}

TEST(AdminApiKeys, AnAuditThatCannotBeWrittenChangesNothing) {
    Rig r;
    AdminBackend b;
    b.auth = r.auth.get();
    b.store = r.store.get();
    b.access = r.access.get();
    b.audit = [](const AuditEvent&) { throw std::runtime_error("audit.db full"); };
    b.monoMs = [&r] { return r.now; };
    b.keys = r.keys.get();
    AdminApi api(b);
    const AdminCaller admin = r.signIn("admin");
    const AdminReply a = api.call("POST", "/api/v1/admin/apikeys", {},
                                  json{{"rev", 0}, {"name", "x"}}.dump(), admin);
    EXPECT_EQ(a.status, 503);
    EXPECT_EQ(a.body["error"], "AUDIT_UNAVAILABLE");
    EXPECT_EQ(r.rev(), 0);
}

}  // namespace
}  // namespace mat
