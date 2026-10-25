// Feature 024 (specs/024-recipes/plan.md): the routes of recipes on the listeners of mat-runtime in
// process, over the real audit log, the real tag write coordinator and fake drivers: a download
// writes the parameters one after the other through the coordinator (a tag.write record each),
// stops at the first failure, is audited as recipe.download; the role of the table and of the
// recipe type; a recipe saved on the device; no service: 404 NO_RECIPES.
#include <gtest/gtest.h>

#include <chrono>
#include <thread>

#include "core/auth/roles.hpp"
#include "core/tag-engine/tests/write_fakes.hpp"
#include "server/recipe_glue.hpp"
#include "server/tests/api_rig.hpp"
#include "server/write_glue.hpp"

using namespace mat;
using namespace mat::test;
using namespace mat::testing;
using nlohmann::json;

namespace {

const json kTags = json::parse(R"({"schemaVersion":"1.1.0","tags":[
  {"id":"SP","kind":"external","type":"FLOAT32","access":"RW","limits":{"min":0,"max":90}},
  {"id":"RUN","kind":"external","type":"BOOL","access":"RW"},
  {"id":"CNT","kind":"external","type":"INT16","access":"RW"}]})");

const json kRecipes = json::parse(R"({"schemaVersion":"1.1.0","types":[
  {"id":"me","name":"Mẻ","security":{"edit":"engineer"},
   "params":[{"tagId":"SP","min":10,"max":80},{"tagId":"RUN"},{"tagId":"CNT"}],
   "recipes":[{"id":"a","name":"A","values":{"SP":42.5,"RUN":true,"CNT":7}}]}]})");

struct State {
    ProjectModel model;
    TagStore store;
    Events ev;
    FakeBackend backend{ev};
    std::unique_ptr<AuditLogWriteAudit> audit;
    std::unique_ptr<WriteCoordinator> coord;
    std::unique_ptr<CoordinatorRecipeWriter> writer;
    std::unique_ptr<recipe::Service> svc;

    void init(ApiRig& r, bool withService) {
        model = makeModel();
        addModelTagsToStore(model, store);
        store.set(SP, 30.0, Quality::GOOD, 1, 1);
        store.set(RUN, false, Quality::GOOD, 1, 1);
        store.set(CNT, int64_t{2}, Quality::GOOD, 1, 1);
        audit = std::make_unique<AuditLogWriteAudit>(*r.audit);
        CoordinatorOptions o;
        o.monoMs = [&r] { return r.mono.load(); };
        o.wallMs = [&r] { return r.wall.load(); };
        o.clockSynced = [](int64_t) { return true; };
        o.log = [](const std::string&) {};
        coord = std::make_unique<WriteCoordinator>(model, store, backend, *audit, o);
        if (!withService) return;
        writer = std::make_unique<CoordinatorRecipeWriter>(*coord);
        recipe::ServiceOptions so;
        so.catalog = recipe::catalogFrom(kRecipes, kTags);
        so.storePath = r.dataDir + "/recipes/vector.json";
        so.writer = writer.get();
        so.current = [this](const std::string& tag) -> std::optional<recipe::Current> {
            const auto i = store.indexOf(tag);
            if (!i) return std::nullopt;
            const TagValue v = store.get(*i);
            return recipe::Current{recipeScalarJson(v.value), qualityName(v.quality)};
        };
        AuditLog* log = r.audit.get();
        so.audit = [log](const recipe::AuditRecord& a) { log->append(recipeAuditEvent(a)); };
        so.log = [](const std::string&) {};
        so.writeTimeoutMs = 5000;
        so.pollMs = 10;
        svc = std::make_unique<recipe::Service>(std::move(so));
        svc->start();
    }
};

struct Rig : ApiRig {
    explicit Rig(bool withService = true, std::shared_ptr<State> s = std::make_shared<State>())
        : ApiRig([s, withService](ApiRig& rig) {
              s->init(rig, withService);
              EngineeringApi::RecipesBackend b;
              b.service = [s] { return s->svc.get(); };
              rig.eng->setRecipes(b);
          }),
          st(std::move(s)) {}
    ~Rig() {
        if (st->svc) st->svc->waitIdle();
    }

    // Waits for the n-th command the drivers got (0-based) and answers it.
    bool answer(size_t n, drv::WriteStatus status, const char* code) {
        for (int i = 0; i < 300 && st->backend.count() <= n; ++i)
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        if (st->backend.count() <= n) return false;
        drv::WriteResult w;
        w.id = st->backend.cmd(n).id;
        w.status = status;
        w.code = code;
        st->coord->onDriverResult(w);
        return true;
    }
    json waitJob(const std::string& user, const std::string& id) {
        json j;
        for (int i = 0; i < 300; ++i) {
            j = bodyJson(getAs(user, "/api/v1/recipes/jobs/" + id));
            if (j.value("state", "") != "running") break;
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        return j;
    }
    std::shared_ptr<State> st;
};

}  // namespace

TEST(RecipesApi, AnOperatorDownloadsARecipeOneTagAfterTheOther) {
    Rig r;
    const HttpResult list = r.getAs("vh1", "/api/v1/recipes");
    ASSERT_EQ(list.status, 200) << list.body;
    EXPECT_EQ(bodyJson(list)["types"][0]["can"]["operate"], true);
    EXPECT_EQ(bodyJson(list)["types"][0]["can"]["edit"], false);
    const HttpResult cur = r.getAs("vh1", "/api/v1/recipes/current?type=me");
    EXPECT_EQ(bodyJson(cur)["values"]["SP"]["value"], 30.0);

    const HttpResult d =
        r.postAs("vh1", "/api/v1/recipes/download", json{{"type", "me"}, {"recipe", "a"}}.dump());
    ASSERT_EQ(d.status, 202) << d.body;
    ASSERT_TRUE(r.answer(0, drv::WriteStatus::Confirmed, "CONFIRMED"));
    ASSERT_TRUE(r.answer(1, drv::WriteStatus::Confirmed, "CONFIRMED"));
    ASSERT_TRUE(r.answer(2, drv::WriteStatus::Confirmed, "CONFIRMED"));
    const json j = r.waitJob("vh1", bodyJson(d)["jobId"]);
    EXPECT_EQ(j["state"], "done") << j.dump();
    // in the order of the type, each its own command
    EXPECT_EQ(r.st->backend.cmd(0).tag, static_cast<size_t>(SP));
    EXPECT_EQ(r.st->backend.cmd(1).tag, static_cast<size_t>(RUN));
    EXPECT_EQ(r.st->backend.cmd(2).tag, static_cast<size_t>(CNT));
    r.st->coord->waitAuditIdle();
    const auto rec = r.records("recipe.download");
    ASSERT_EQ(rec.size(), 2u);  // newest first
    EXPECT_EQ(rec[0].result, "ok");
    EXPECT_EQ(rec[1].result, "started");
    EXPECT_EQ(rec[1].user.value_or(""), "vh1");
    EXPECT_EQ(rec[1].target.value_or(""), "me/a");
    size_t started = 0;
    for (const auto& w : r.records("tag.write"))
        if (w.result == "started") {
            ++started;
            EXPECT_NE(w.detail.value_or("").find("recipe-me"), std::string::npos) << *w.detail;
        }
    EXPECT_EQ(started, 3u);
}

TEST(RecipesApi, AFailureStopsTheRunAndTheRestIsSkipped) {
    Rig r;
    const HttpResult d =
        r.postAs("vh1", "/api/v1/recipes/download", json{{"type", "me"}, {"recipe", "a"}}.dump());
    ASSERT_EQ(d.status, 202) << d.body;
    ASSERT_TRUE(r.answer(0, drv::WriteStatus::Confirmed, "CONFIRMED"));
    ASSERT_TRUE(r.answer(1, drv::WriteStatus::Failed, "DEVICE_EXCEPTION"));
    const json j = r.waitJob("vh1", bodyJson(d)["jobId"]);
    EXPECT_EQ(j["state"], "failed");
    EXPECT_EQ(j["results"][1]["code"], "DEVICE_EXCEPTION");
    EXPECT_EQ(j["results"][2]["status"], "skipped");
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    EXPECT_EQ(r.st->backend.count(), 2u);
    const auto rec = r.records("recipe.download");
    ASSERT_FALSE(rec.empty());
    EXPECT_EQ(rec[0].result, "failed");
    EXPECT_EQ(rec[0].code.value_or(""), "DEVICE_EXCEPTION");
}

TEST(RecipesApi, AViewerCannotDownloadNorAnOperatorEditAnEngineerType) {
    Rig r;
    const HttpResult v =
        r.postAs("xem1", "/api/v1/recipes/download", json{{"type", "me"}, {"recipe", "a"}}.dump());
    EXPECT_EQ(v.status, 403);
    EXPECT_EQ(bodyJson(v)["error"], "FORBIDDEN");
    const json values = kRecipes["types"][0]["recipes"][0]["values"];
    const HttpResult s =
        r.postAs("vh1", "/api/v1/recipes/save",
                 json{{"type", "me"}, {"name", "B"}, {"values", values}, {"rev", 0}}.dump());
    EXPECT_EQ(s.status, 403);
    const HttpResult ok =
        r.postAs("kysu1", "/api/v1/recipes/save",
                 json{{"type", "me"}, {"name", "B"}, {"values", values}, {"rev", 0}}.dump());
    ASSERT_EQ(ok.status, 200) << ok.body;
    EXPECT_EQ(bodyJson(ok)["rev"], 1);
    EXPECT_EQ(r.records("recipe.save").size(), 1u);
    EXPECT_EQ(r.st->backend.count(), 0u);
    // no session
    EXPECT_EQ(r.call(getReq("/api/v1/recipes")).status, 401);
}

TEST(RecipesApi, WithoutRecipesTheRoutesAnswerNoRecipes) {
    Rig r(false);
    const HttpResult res = r.getAs("vh1", "/api/v1/recipes");
    EXPECT_EQ(res.status, 404);
    EXPECT_EQ(bodyJson(res)["error"], "NO_RECIPES");
}
