// T010 (feature 025, specs/025-data-api FR-004 to FR-006): the data API on the two listeners of
// mat-runtime in process, over the real audit log, key service, access model and write
// coordinator (fake drivers):
// - only an API key opens it (not a session token, not a cookie), only over HTTPS; every refusal is
//   apikey.denied with the key when known and never the token;
// - what a key reads follows the access model of feature 013 for its role and groups: the Tags
//   list, the values (an unknown Tag and a Tag of another group look the same: 403);
// - writes: a read-only or viewer key refuses the batch, a Tag outside the items the key operates
//   is ACCESS_DENIED, the requestId is the idempotency key (no second command), `expect`, the
//   results by id, tag.write rows of user apikey:<id>;
// - expiry, source, rate (429 + Retry-After), revocation at once.
#include "server/http/data_api.hpp"

#include <gtest/gtest.h>
#include <sys/stat.h>

#include "core/auth/access_store.hpp"
#include "core/tag-engine/tests/write_fakes.hpp"
#include "server/http/tags_write_json.hpp"
#include "server/tests/api_rig.hpp"
#include "server/write_glue.hpp"

using namespace mat;
using namespace mat::test;
using namespace mat::testing;
using nlohmann::json;

namespace {

ResourceCatalog catalog() {
    ResourceCatalog c;
    CatalogScreen tq;
    tq.id = "tong-quan";
    CatalogItem sp;
    sp.id = "dat-sp";
    sp.operable = true;
    sp.tags = {"SP"};
    CatalogItem run;
    run.id = "chay";
    run.operable = true;
    run.tags = {"RUN"};
    CatalogItem level;
    level.id = "muc";
    level.tags = {"LEVEL_R"};
    tq.items = {sp, run, level};
    CatalogScreen bt;
    bt.id = "bao-tri";
    CatalogItem cnt;
    cnt.id = "dem";
    cnt.operable = true;
    cnt.tags = {"CNT"};
    bt.items = {cnt};
    c.screens = {tq, bt};
    return c;
}

struct State {
    ProjectModel model;
    TagStore store;
    Events ev;
    FakeBackend backend{ev};
    std::unique_ptr<AuditLogWriteAudit> waudit;
    std::unique_ptr<WriteCoordinator> coord;
    std::unique_ptr<ApiKeyService> keys;
    std::unique_ptr<AccessService> access;
    std::unique_ptr<DataApi> data;

    void init(ApiRig& r) {
        model = makeModel();
        addModelTagsToStore(model, store);
        store.set(SP, 72.5, Quality::GOOD, 1700000000000, 1700000000001);
        store.set(RUN, false, Quality::GOOD, 1, 1);
        store.set(LEVEL_R, 40.0, Quality::BAD, "COMM_TIMEOUT", 1, 1);
        store.set(CNT, int64_t{3}, Quality::GOOD, 1, 1);
        waudit = std::make_unique<AuditLogWriteAudit>(*r.audit);
        CoordinatorOptions o;
        o.monoMs = [&r] { return r.mono.load(); };
        o.wallMs = [&r] { return r.wall.load(); };
        o.clockSynced = [](int64_t) { return true; };
        o.log = [](const std::string&) {};
        coord = std::make_unique<WriteCoordinator>(model, store, backend, *waudit, o);

        const std::string authDir = r.dataDir + "/auth";
        ::mkdir(authDir.c_str(), 0700);
        AccessFile f;
        f.rev = 1;
        f.groups = {{"bao-tri", "Bảo trì"}};
        f.rules = {{"screen:bao-tri", AccessLevel::View, {"group:bao-tri"}}};
        std::string err;
        EXPECT_TRUE(writeAuthPrivateFile(authDir, kAuthAccessFile, accessFileJson(f),
                                         "no-such-user-mat", err))
            << err;
        AccessServiceOptions xo;
        xo.catalog = catalog();
        xo.accessFile = authDir + "/" + kAuthAccessFile;
        xo.monoMs = [&r] { return r.mono.load(); };
        xo.log = [](const std::string&) {};
        xo.tagIndex = [this](const std::string& t) { return store.indexOf(t); };
        access = std::make_unique<AccessService>(xo);

        ApiKeyService::Options ko;
        ko.dir = authDir;
        ko.ownerUser = "no-such-user-mat";
        ko.wallMs = [&r] { return r.wall.load(); };
        ko.monoMs = [&r] { return r.mono.load(); };
        keys = std::make_unique<ApiKeyService>(ko);
        EXPECT_TRUE(keys->load(err)) << err;

        DataBackend b;
        b.keys = keys.get();
        b.access = access.get();
        b.model = &model;
        b.store = &store;
        b.coordinator = coord.get();
        b.audit = [&r](const AuditEvent& e) { r.audit->append(e); };
        b.auditAvailable = [&r] { return r.audit->isOpen(); };
        data = std::make_unique<DataApi>(b);
        r.eng->setData(data.get());
    }
};

struct Rig : ApiRig {
    explicit Rig(std::shared_ptr<State> s = std::make_shared<State>())
        : ApiRig([s](ApiRig& rig) { s->init(rig); }), st(std::move(s)) {}

    // A key and its token.
    std::string key(Role role, bool readOnly, std::vector<std::string> groups = {},
                    ApiKey* out = nullptr, std::vector<std::string> allowFrom = {},
                    int rate = kApiKeyRateDefault) {
        ApiKey d;
        d.name = "k";
        d.role = role;
        d.readOnly = readOnly;
        d.groups = std::move(groups);
        d.allowFrom = std::move(allowFrom);
        d.ratePerMin = rate;
        std::string token, err;
        ApiKey made;
        int64_t rev = 0;
        EXPECT_EQ(st->keys->create(st->keys->list().rev, d, "admin1", token, made, rev, err),
                  ApiKeyChange::Ok)
            << err;
        if (out) *out = made;
        return token;
    }
    static std::string auth(const std::string& token) { return "Authorization: Bearer " + token; }
    HttpResult get(const std::string& token, const std::string& path) {
        return call(getReq(path, {auth(token)}));
    }
    HttpResult write(const std::string& token, const json& requests) {
        return call(
            postReq("/api/v1/data/write", json{{"requests", requests}}.dump(), {auth(token)}));
    }
    static json req(const std::string& id, const std::string& tag, json value) {
        return {{"requestId", id}, {"tag", tag}, {"value", std::move(value)}};
    }
    std::shared_ptr<State> st;
};

json names(const json& tags) {
    json out = json::array();
    for (const json& t : tags) out.push_back(t["name"]);
    return out;
}

}  // namespace

TEST(DataApi, OnlyAnApiKeyOverHttpsOpensIt) {
    Rig r;
    const std::string token = r.key(Role::Viewer, true);
    HttpResult res = r.call(getReq("/api/v1/data/tags"));
    EXPECT_EQ(res.status, 401);
    EXPECT_EQ(bodyJson(res)["error"], "AUTH_REQUIRED");
    EXPECT_NE(res.headers.find("WWW-Authenticate: Bearer"), std::string::npos);
    // a session of a person is no key
    res = r.call(getReq("/api/v1/data/tags", {r.bearer("admin1")}));
    EXPECT_EQ(res.status, 401);
    EXPECT_EQ(bodyJson(res)["error"], "AUTH_REQUIRED");
    res = r.get(newApiKeyToken(), "/api/v1/data/tags");
    EXPECT_EQ(res.status, 401);
    EXPECT_EQ(bodyJson(res)["error"], "APIKEY_INVALID");
    res = r.callHttp(getReq("/api/v1/data/tags", {Rig::auth(token)}));
    EXPECT_EQ(res.status, 403);
    EXPECT_EQ(bodyJson(res)["error"], "HTTPS_REQUIRED");
    res = r.call(postReq("/api/v1/data/tags", "{}", {Rig::auth(token)}));
    EXPECT_EQ(res.status, 405);
    res = r.get(token, "/api/v1/data/tags");
    EXPECT_EQ(res.status, 200) << res.body;
    const auto denied = r.records("apikey.denied");
    ASSERT_GE(denied.size(), 2u);
    for (const auto& d : denied) {
        EXPECT_EQ(d.result, "denied");
        EXPECT_EQ(d.detail.value_or("").find(token.substr(12)), std::string::npos);
    }
}

TEST(DataApi, TheKeyItselfAndItsTags) {
    Rig r;
    ApiKey k;
    const std::string viewer = r.key(Role::Viewer, true, {}, &k);
    HttpResult res = r.get(viewer, "/api/v1/data/key");
    ASSERT_EQ(res.status, 200) << res.body;
    json b = bodyJson(res);
    EXPECT_EQ(b["id"], k.id);
    EXPECT_EQ(b["role"], "viewer");
    EXPECT_EQ(b["canWrite"], false);
    EXPECT_EQ(b.dump().find(viewer), std::string::npos);

    res = r.get(viewer, "/api/v1/data/tags");
    ASSERT_EQ(res.status, 200) << res.body;
    b = bodyJson(res);
    EXPECT_EQ(names(b["tags"]), json({"SP", "LEVEL_R", "RUN"}))
        << "the bao-tri screen is for its group only: no CNT";
    for (const json& t : b["tags"]) EXPECT_EQ(t["writable"], false) << t.dump();
    EXPECT_EQ(b["tags"][0]["type"], "FLOAT32");

    const std::string writer = r.key(Role::Operator, false, {"bao-tri"});
    b = bodyJson(r.get(writer, "/api/v1/data/tags"));
    EXPECT_EQ(names(b["tags"]), json({"SP", "LEVEL_R", "RUN", "CNT"}));
    std::map<std::string, bool> w;
    for (const json& t : b["tags"]) w[t["name"]] = t["writable"];
    EXPECT_TRUE(w["SP"]);
    EXPECT_TRUE(w["RUN"]);
    EXPECT_TRUE(w["CNT"]);
    EXPECT_FALSE(w["LEVEL_R"]) << "read-only Tag, and no operable item";
}

TEST(DataApi, ValuesOfTheTagsTheKeyMayRead) {
    Rig r;
    const std::string token = r.key(Role::Viewer, true);
    HttpResult res = r.get(token, "/api/v1/data/values?tags=SP,LEVEL_R");
    ASSERT_EQ(res.status, 200) << res.body;
    json b = bodyJson(res);
    ASSERT_EQ(b["values"].size(), 2u);
    EXPECT_EQ(b["values"][0]["name"], "SP");
    EXPECT_DOUBLE_EQ(b["values"][0]["value"].get<double>(), 72.5);
    EXPECT_EQ(b["values"][0]["quality"], "GOOD");
    EXPECT_EQ(b["values"][0]["sourceTs"], "2023-11-14T22:13:20.000Z");
    EXPECT_EQ(b["values"][1]["quality"], "BAD");
    EXPECT_EQ(b["values"][1]["reason"], "COMM_TIMEOUT");
    EXPECT_TRUE(b["time"].is_string());
    // all of them without `tags`
    b = bodyJson(r.get(token, "/api/v1/data/values"));
    EXPECT_EQ(names(b["values"]), json({"SP", "LEVEL_R", "RUN"}));
    for (const char* q : {"tags=CNT", "tags=SP,NO_SUCH", "tags=BIG"}) {
        res = r.get(token, std::string("/api/v1/data/values?") + q);
        EXPECT_EQ(res.status, 403) << q;
        EXPECT_EQ(bodyJson(res)["error"], "ACCESS_DENIED") << q;
    }
    std::string many = "/api/v1/data/values?tags=SP";
    for (int i = 0; i < 200; ++i) many += ",SP";
    EXPECT_EQ(r.get(token, many).status, 400);
    // with the group, CNT too
    const std::string grp = r.key(Role::Viewer, true, {"bao-tri"});
    EXPECT_EQ(r.get(grp, "/api/v1/data/values?tags=CNT").status, 200);
}

TEST(DataApi, AKeyThatMayNotWriteRefusesTheBatch) {
    Rig r;
    for (const auto& token : {r.key(Role::Viewer, true), r.key(Role::Operator, true)}) {
        const HttpResult res = r.write(token, json::array({Rig::req(idN(1), "SP", 75)}));
        EXPECT_EQ(res.status, 403) << res.body;
        const json b = bodyJson(res);
        EXPECT_EQ(b["error"], "FORBIDDEN");
        EXPECT_EQ(b["results"][0]["reason"], "FORBIDDEN");
    }
    EXPECT_EQ(r.st->backend.count(), 0u);
    r.st->coord->waitAuditIdle();
    const auto rows = r.records("tag.write");
    ASSERT_EQ(rows.size(), 2u);
    EXPECT_EQ(rows[0].result, "denied");
    EXPECT_EQ(rows[0].user.value_or("").rfind("apikey:", 0), 0u);
}

TEST(DataApi, WritesAreIdempotentAndFollowTheItemsTheKeyOperates) {
    Rig r;
    ApiKey k;
    const std::string token = r.key(Role::Operator, false, {}, &k);
    HttpResult res =
        r.write(token, json::array({Rig::req(idN(1), "SP", 75), Rig::req(idN(2), "CNT", 5),
                                    Rig::req(idN(3), "LEVEL_R", 1)}));
    ASSERT_EQ(res.status, 200) << res.body;
    json b = bodyJson(res);
    ASSERT_EQ(b["results"].size(), 3u);
    EXPECT_EQ(b["results"][0]["status"], "ACCEPTED");
    EXPECT_EQ(b["results"][0]["tag"], "SP");
    EXPECT_EQ(b["results"][1]["reason"], "ACCESS_DENIED") << "CNT: not its group's screen";
    EXPECT_EQ(b["results"][2]["reason"], "ACCESS_DENIED") << "LEVEL_R: no operable item";
    EXPECT_EQ(r.st->backend.count(), 1u);
    // the same requestId again: the same command, nothing sent twice
    res = r.write(token, json::array({Rig::req(idN(1), "SP", 75)}));
    ASSERT_EQ(res.status, 200) << res.body;
    EXPECT_EQ(bodyJson(res)["results"][0]["duplicate"], true);
    EXPECT_EQ(r.st->backend.count(), 1u);
    // its result by id, for this key only
    res = r.get(token, "/api/v1/data/write?ids=" + idN(1) + "," + idN(9));
    ASSERT_EQ(res.status, 200) << res.body;
    b = bodyJson(res);
    EXPECT_NE(b["results"][0]["status"], "UNKNOWN");
    EXPECT_EQ(b["results"][1]["status"], "UNKNOWN");
    EXPECT_EQ(bodyJson(r.get(token, "/api/v1/data/write/" + idN(1)))["results"][0]["requestId"],
              idN(1));
    const std::string other = r.key(Role::Operator, false);
    EXPECT_EQ(bodyJson(r.get(other, "/api/v1/data/write/" + idN(1)))["results"][0]["status"],
              "UNKNOWN");
    // expect: RUN is false, the caller expects true
    res = r.write(
        token,
        json::array({{{"requestId", idN(4)}, {"tag", "RUN"}, {"value", false}, {"expect", true}}}));
    ASSERT_EQ(res.status, 200) << res.body;
    EXPECT_EQ(bodyJson(res)["results"][0]["reason"], "STALE_EXPECTATION");
    // without a requestId: one is made, the write goes on
    res = r.write(token, json::array({{{"tag", "RUN"}, {"value", true}}}));
    ASSERT_EQ(res.status, 200) << res.body;
    EXPECT_TRUE(isWriteRequestId(bodyJson(res)["results"][0]["requestId"]));
    // a pulse is the page's: dropped
    EXPECT_EQ(r.call(postReq("/api/v1/data/write", "not json", {Rig::auth(token)})).status, 400);
    EXPECT_EQ(r.call(getReq("/api/v1/data/write?ids=", {Rig::auth(token)})).status, 400);
    r.st->coord->waitAuditIdle();
    bool ok = false;
    for (const auto& row : r.records("tag.write"))
        if (row.user == "apikey:" + k.id && row.result == "started") ok = true;
    EXPECT_TRUE(ok);
}

TEST(DataApi, ExpirySourceRateAndRevocation) {
    Rig r;
    ApiKey k;
    const std::string token = r.key(Role::Viewer, true, {}, &k, {"192.0.2.0/24"});
    HttpResult res = r.get(token, "/api/v1/data/key");
    EXPECT_EQ(res.status, 403) << "the rig calls from 127.0.0.1";
    EXPECT_EQ(bodyJson(res)["error"], "APIKEY_SOURCE");
    ApiKey after;
    int64_t rev = 0;
    std::string err;
    ASSERT_EQ(r.st->keys->update(
                  r.st->keys->list().rev, k.id,
                  [&](ApiKey& x) {
                      x.allowFrom = {"127.0.0.0/8"};
                      x.ratePerMin = 10;
                      x.expiresAtMs = r.wall.load() + 3600000;
                  },
                  after, rev, err),
              ApiKeyChange::Ok)
        << err;
    int ok = 0;
    for (int i = 0; i < 12; ++i) {
        res = r.get(token, "/api/v1/data/key");
        if (res.status == 200) ++ok;
    }
    EXPECT_EQ(ok, 10);
    EXPECT_EQ(res.status, 429);
    EXPECT_EQ(bodyJson(res)["error"], "RATE_LIMITED");
    EXPECT_NE(res.headers.find("Retry-After:"), std::string::npos);
    r.mono += 60000;
    r.wall += 3600000;
    res = r.get(token, "/api/v1/data/key");
    EXPECT_EQ(res.status, 401);
    EXPECT_EQ(bodyJson(res)["error"], "APIKEY_EXPIRED");
    ASSERT_EQ(r.st->keys->update(
                  rev, k.id, [](ApiKey& x) { x.expiresAtMs.reset(); }, after, rev, err),
              ApiKeyChange::Ok);
    EXPECT_EQ(r.get(token, "/api/v1/data/key").status, 200);
    ApiKey gone;
    ASSERT_EQ(r.st->keys->revoke(rev, k.id, gone, rev, err), ApiKeyChange::Ok);
    res = r.get(token, "/api/v1/data/key");
    EXPECT_EQ(res.status, 401) << "revoked: refused at the next call";
    EXPECT_EQ(bodyJson(res)["error"], "APIKEY_INVALID");
}

TEST(DataApi, HistoryAndAlarmsWithoutTheirSubsystems) {
    Rig r;
    const std::string token = r.key(Role::Viewer, true);
    HttpResult res = r.get(token, "/api/v1/data/history/series?tags=SP");
    EXPECT_EQ(res.status, 404);
    EXPECT_EQ(bodyJson(res)["error"], "NO_HISTORY");
    res = r.get(token, "/api/v1/data/alarms");
    EXPECT_EQ(res.status, 404);
    EXPECT_EQ(bodyJson(res)["error"], "NO_ALARMS");
}

TEST(DataApi, OperableTagsFollowTheAccessModel) {
    const ResourceCatalog c = catalog();
    AccessFile f;
    f.groups = {{"bao-tri", "Bảo trì"}};
    f.rules = {{"screen:bao-tri", AccessLevel::View, {"group:bao-tri"}},
               {"item:tong-quan/chay", AccessLevel::Operate, {"role:administrator"}}};
    Principal p;
    p.user = "apikey:0123456789ab";
    p.role = Role::Operator;
    SessionAccess a;
    a.access = computeAccess(c, f, p);
    auto tags = operableTags(c, a);
    EXPECT_EQ(tags, (std::unordered_set<std::string>{"SP"}));
    p.groups = {"bao-tri"};
    a.access = computeAccess(c, f, p);
    tags = operableTags(c, a);
    EXPECT_EQ(tags, (std::unordered_set<std::string>{"SP", "CNT"}));
}
