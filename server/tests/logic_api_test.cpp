// T130 (feature 011; FR-083, FR-084; device-api-011 §4): the routes of logic on the two listeners
// of mat-runtime in process, over the real audit log and a logic subsystem fed by a fake round.
// - GET /api/v1/logic: viewer and above (Bearer, and the cookie of the page), the state of every
//   block and the scan; without logic.json {"enabled": false};
// - POST /api/v1/logic/writes: administrator, Bearer only; {"enabled": false} stops at once (audit
//   logic.writes.disabled), {"enabled": true} is refused 403 LOGIC_ENABLE_ROOT_ONLY;
// - POST /api/v1/logic/reset: engineer, Bearer only, audit logic.reset; unknown block 404, a rule
//   409;
// - a write to a logic Tag through POST /tags/write is REJECTED OWNED_BY_LOGIC (audited denied).
#include <gtest/gtest.h>

#include "core/auth/roles.hpp"
#include "server/logic_glue.hpp"
#include "server/tests/api_rig.hpp"
#include "server/tests/logic_fakes.hpp"
#include "server/write_glue.hpp"

using namespace mat;
using namespace mat::test;
using namespace mat::testing;
using nlohmann::json;

namespace {

const json kDoc = {
    {"schemaVersion", "1.0.0"},
    {"rules", json::array({{{"id", "r_low"}, {"when", "LEVEL_R < 20"}}})},
    {"counters", json::array({{{"id", "c_starts"}, {"up", "RUN"}, {"value", "L.C"}}})}};

struct State {
    ProjectModel model = logicModel({{"L.C", TagType::INT64}});
    TagStore store;
    Events ev;
    FakeBackend backend{ev};
    std::unique_ptr<AuditLogWriteAudit> audit;
    std::unique_ptr<WriteCoordinator> coord;
    std::unique_ptr<LogicSubsystem> logic;
    std::unique_ptr<FakeRound> round;

    void init(ApiRig& r, bool withLogic) {
        addModelTagsToStore(model, store);
        audit = std::make_unique<AuditLogWriteAudit>(*r.audit);
        CoordinatorOptions o;
        o.monoMs = [&r] { return r.mono.load(); };
        o.wallMs = [&r] { return r.wall.load(); };
        o.clockSynced = [](int64_t) { return true; };
        o.log = [](const std::string&) {};
        coord = std::make_unique<WriteCoordinator>(model, store, backend, *audit, o);
        if (!withLogic) return;
        LogicOptions lo;
        lo.writes = "on";
        lo.statePath = r.dataDir + "/" + kLogicStateFile;
        lo.monoMs = [&r] { return r.mono.load(); };
        lo.wallMs = [&r] { return r.wall.load(); };
        lo.audit = [&r](const AuditEvent& e) { r.audit->append(e); };
        lo.log = [](const std::string&) {};
        logic = std::make_unique<LogicSubsystem>(model, kDoc, lo, logic::RetainMap{}, false);
        logic->setCoordinator(coord.get());
        round = std::make_unique<FakeRound>(model);
    }
};

struct Rig : ApiRig {
    explicit Rig(bool withLogic = true, std::shared_ptr<State> s = std::make_shared<State>())
        : ApiRig([s, withLogic](ApiRig& rig) {
              s->init(rig, withLogic);
              EngineeringApi::TagsBackend t;
              t.coordinator = s->coord.get();
              rig.eng->setTags(t);
              EngineeringApi::LogicBackend l;
              l.logic = [s] { return s->logic.get(); };
              rig.eng->setLogic(l);
          }),
          st(std::move(s)) {}
    // Counts rising edges of RUN: the counter goes to n.
    void count(int n) {
        for (int i = 0; i < n; ++i) {
            st->round->good(*st->model.tagIndex("RUN"), false);
            scan();
            st->round->good(*st->model.tagIndex("RUN"), true);
            scan();
        }
    }
    void scan() {
        mono += 1000;
        st->logic->round(*st->round);
    }
    std::shared_ptr<State> st;
};

json block(const json& body, const std::string& id) {
    for (const auto& b : body["blocks"])
        if (b["id"] == id) return b;
    return nullptr;
}

}  // namespace

TEST(LogicApi, TheTableHasTheThreeRoutesOnlyTheReadTakesTheCookie) {
    const EndpointRule* get = findEndpointRule("GET", "/api/v1/logic");
    const EndpointRule* writes = findEndpointRule("POST", "/api/v1/logic/writes");
    const EndpointRule* reset = findEndpointRule("POST", "/api/v1/logic/reset");
    ASSERT_NE(get, nullptr);
    ASSERT_NE(writes, nullptr);
    ASSERT_NE(reset, nullptr);
    EXPECT_EQ(get->minRole, Role::Viewer);
    EXPECT_TRUE(get->cookieAllowed) << "device-api-011 §4: viewer (T, C)";
    EXPECT_FALSE(get->changesDevice);
    EXPECT_EQ(writes->minRole, Role::Administrator);
    EXPECT_FALSE(writes->cookieAllowed);
    EXPECT_TRUE(writes->changesDevice);
    EXPECT_EQ(reset->minRole, Role::Engineer);
    EXPECT_FALSE(reset->cookieAllowed);
    EXPECT_TRUE(reset->changesDevice);
}

TEST(LogicApi, AViewerReadsTheStateOfEveryBlockAndTheScan) {
    Rig r;
    r.st->round->good(*r.st->model.tagIndex("LEVEL_R"), 10.0);
    r.count(3);
    const HttpResult res = r.getAs("xem1", "/api/v1/logic");
    ASSERT_EQ(res.status, 200) << res.body;
    const json b = bodyJson(res);
    EXPECT_EQ(b["enabled"], true);
    EXPECT_EQ(b["writes"]["configured"], "on");
    EXPECT_EQ(b["writes"]["runtimeEnabled"], true);
    EXPECT_EQ(b["writes"]["limitPerMinute"], 20);
    EXPECT_EQ(b["scan"]["periodMs"], 100);
    EXPECT_TRUE(b["scan"]["lastMs"].is_number());
    EXPECT_TRUE(b["scan"]["p99Ms"].is_number());
    EXPECT_EQ(block(b, "r_low")["kind"], "rule");
    EXPECT_EQ(block(b, "r_low")["state"], "OK");
    EXPECT_EQ(block(b, "c_starts")["kind"], "counter");
    EXPECT_EQ(block(b, "c_starts")["outputs"]["L.C"], 3);
    EXPECT_TRUE(r.records("access.denied").empty());
    // no session: 401
    EXPECT_EQ(r.call(getReq("/api/v1/logic")).status, 401);
}

TEST(LogicApi, WithoutLogicJsonTheAnswerIsEnabledFalse) {
    Rig r(false);
    const HttpResult res = r.getAs("xem1", "/api/v1/logic");
    ASSERT_EQ(res.status, 200) << res.body;
    EXPECT_EQ(bodyJson(res), json({{"enabled", false}}));
}

TEST(LogicApi, AnAdministratorStopsTheWritesAndCannotStartThemAgain) {
    Rig r;
    EXPECT_EQ(r.postAs("kysu1", "/api/v1/logic/writes", R"({"enabled":false})").status, 403)
        << "an engineer does not stop the writes";
    const HttpResult on = r.postAs("admin1", "/api/v1/logic/writes", R"({"enabled":true})");
    EXPECT_EQ(on.status, 403);
    EXPECT_EQ(bodyJson(on)["error"], "LOGIC_ENABLE_ROOT_ONLY");
    EXPECT_EQ(r.st->logic->writesState(), "on");
    EXPECT_EQ(r.postAs("admin1", "/api/v1/logic/writes", R"({"enabled":"no"})").status, 400);
    const HttpResult off = r.postAs("admin1", "/api/v1/logic/writes", R"({"enabled":false})");
    ASSERT_EQ(off.status, 200) << off.body;
    EXPECT_EQ(bodyJson(off)["writes"], "stopped");
    EXPECT_EQ(r.st->logic->writesState(), "stopped");
    const auto rows = r.records("logic.writes.disabled");
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].user.value_or(""), "admin1");
    EXPECT_EQ(bodyJson(r.getAs("xem1", "/api/v1/logic"))["writes"]["stopped"], true);
    // asking again changes nothing and is still 200
    EXPECT_EQ(r.postAs("admin1", "/api/v1/logic/writes", R"({"enabled":false})").status, 200);
    EXPECT_EQ(r.records("logic.writes.disabled").size(), 1u);
}

TEST(LogicApi, AnEngineerResetsACounterWithAnAuditRecord) {
    Rig r;
    r.count(4);
    EXPECT_EQ(r.postAs("vh1", "/api/v1/logic/reset", R"({"id":"c_starts","value":0})").status, 403);
    const HttpResult ok =
        r.postAs("kysu1", "/api/v1/logic/reset", R"({"id":"c_starts","value":0})");
    ASSERT_EQ(ok.status, 200) << ok.body;
    r.scan();
    EXPECT_EQ(block(bodyJson(r.getAs("xem1", "/api/v1/logic")), "c_starts")["outputs"]["L.C"], 0);
    const auto rows = r.records("logic.reset");
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].user.value_or(""), "kysu1");
    EXPECT_EQ(rows[0].target.value_or(""), "c_starts");
    const HttpResult none = r.postAs("kysu1", "/api/v1/logic/reset", R"({"id":"nope","value":0})");
    EXPECT_EQ(none.status, 404);
    EXPECT_EQ(bodyJson(none)["error"], "NO_SUCH_BLOCK");
    const HttpResult rule = r.postAs("kysu1", "/api/v1/logic/reset", R"({"id":"r_low","value":0})");
    EXPECT_EQ(rule.status, 409);
    EXPECT_EQ(bodyJson(rule)["error"], "NOT_RESETTABLE");
    EXPECT_EQ(r.postAs("kysu1", "/api/v1/logic/reset", R"({"value":0})").status, 400);
    EXPECT_EQ(r.postAs("kysu1", "/api/v1/logic/reset", R"({"id":"c_starts","value":-1})").status,
              400);
}

TEST(LogicApi, AWriteToALogicTagIsRejectedOwnedByLogic) {
    Rig r;
    const json body = {
        {"requests", json::array({{{"requestId", idN(3)}, {"tag", "L.C"}, {"value", 5}}})}};
    const HttpResult res = r.postAs("vh1", "/api/v1/tags/write", body.dump());
    ASSERT_EQ(res.status, 200) << res.body;
    const json first = bodyJson(res)["results"][0];
    EXPECT_EQ(first["status"], "REJECTED");
    EXPECT_EQ(first["reason"], "OWNED_BY_LOGIC");
    const auto denied = r.records("tag.write");
    ASSERT_EQ(denied.size(), 1u);
    EXPECT_EQ(denied[0].code.value_or(""), "OWNED_BY_LOGIC");
    EXPECT_EQ(r.st->backend.count(), 0u);
}
