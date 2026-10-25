// Feature 024 (specs/024-recipes/plan.md): the recipe model (checkValues), the device store (rev,
// atomic write, damaged file) and the service without HTTP: rights of the type, sequential writes,
// a failure in the middle, a timeout, limits checked before any write, audit before a change, one
// download at a time.
#include "core/recipe/recipe_service.hpp"

#include <gtest/gtest.h>
#include <sys/stat.h>
#include <unistd.h>

#include <atomic>
#include <fstream>
#include <mutex>
#include <stdexcept>

#include "core/auth/tests/auth_test_support.hpp"

using namespace mat::recipe;
using mat::test::TempDir;
using nlohmann::json;

namespace {

const json kTags = json::parse(R"({"schemaVersion":"1.1.0","tags":[
  {"id":"OVEN.SP","kind":"internal","type":"FLOAT32","access":"RW","limits":{"min":0,"max":300}},
  {"id":"OVEN.RUN","kind":"internal","type":"BOOL","access":"RW"},
  {"id":"OVEN.N","kind":"internal","type":"UINT16","access":"RW"},
  {"id":"OVEN.NOTE","kind":"internal","type":"STRING","access":"RW"}]})");

const json kRecipes = json::parse(R"({"schemaVersion":"1.1.0","types":[
  {"id":"lo","name":"Lò","security":{"operate":"operator","edit":"engineer"},
   "params":[{"tagId":"OVEN.SP","min":100,"max":250,"unit":"°C"},{"tagId":"OVEN.RUN"},
             {"tagId":"OVEN.N"},{"tagId":"OVEN.NOTE"}],
   "recipes":[{"id":"bo","name":"Bơ","values":{"OVEN.SP":180,"OVEN.RUN":true,"OVEN.N":3,"OVEN.NOTE":"b"}},
              {"id":"xau","name":"Xấu","values":{"OVEN.SP":260,"OVEN.RUN":true,"OVEN.N":3,"OVEN.NOTE":"x"}}]},
  {"id":"kin","name":"Kín","security":{"view":"engineer"},"params":[{"tagId":"OVEN.N"}],"recipes":[]}]})");

Caller op() { return {"an", "operator", "10.0.0.2:5000", true}; }
Caller eng() { return {"binh", "engineer", "10.0.0.3:5000", true}; }
Caller viewer() { return {"xem", "viewer", "10.0.0.4:5000", true}; }

// A coordinator: each write is CONFIRMED after `pollsToEnd` status questions, except the Tag of
// `failTag` (FAILED DEVICE_EXCEPTION) and `rejectTag` (REJECTED FORBIDDEN); `hang` never ends.
class FakeWriter : public Writer {
   public:
    std::mutex mu;
    std::vector<std::pair<std::string, json>> submitted;  // tag, value in the order received
    std::vector<std::string> contexts;
    std::map<std::string, int> polls;
    std::string failTag, rejectTag, hangTag, rateTag;
    int rateRefusals = 0;
    int pollsToEnd = 2;
    int ids = 0;

    std::string newRequestId() override { return "rid-" + std::to_string(++ids); }
    WriteStep submit(const Caller&, const std::string& rid, const std::string& tag,
                     const json& value, const std::string& screen,
                     const std::string& widget) override {
        std::lock_guard<std::mutex> l(mu);
        submitted.emplace_back(tag, value);
        contexts.push_back(screen + "|" + widget);
        if (tag == rejectTag) return {"REJECTED", "FORBIDDEN", "Cần vai trò engineer", 0};
        if (tag == rateTag && rateRefusals > 0) {
            --rateRefusals;
            return {"REJECTED", "RATE_LIMITED", "", 3000};
        }
        tags[rid] = tag;
        return {"ACCEPTED", "", ""};
    }
    WriteStep status(const Caller&, const std::string& rid) override {
        std::lock_guard<std::mutex> l(mu);
        const std::string tag = tags[rid];
        if (tag == hangTag) return {"ACCEPTED", "", ""};
        if (++polls[rid] < pollsToEnd) return {"ACCEPTED", "", ""};
        if (tag == failTag) return {"FAILED", "DEVICE_EXCEPTION", "Thiết bị từ chối"};
        return {"CONFIRMED", "CONFIRMED", ""};
    }

   private:
    std::map<std::string, std::string> tags;
};

struct Fixture {
    TempDir dir;
    FakeWriter writer;
    std::vector<AuditRecord> audit;
    bool auditDown = false;
    std::map<std::string, Current> plc;
    std::atomic<int64_t> clock{0};
    std::unique_ptr<Service> svc;

    explicit Fixture(bool withWriter = true) {
        ServiceOptions o;
        o.catalog = catalogFrom(kRecipes, kTags);
        o.storePath = dir.path() + "/recipes/demo.json";
        o.writer = withWriter ? &writer : nullptr;
        o.current = [this](const std::string& t) -> std::optional<Current> {
            const auto it = plc.find(t);
            if (it == plc.end()) return std::nullopt;
            return it->second;
        };
        o.audit = [this](const AuditRecord& a) {
            if (auditDown) throw std::runtime_error("audit down");
            audit.push_back(a);
        };
        o.monoMs = [this] { return clock.load(); };
        o.sleepMs = [this](int64_t ms) { clock += ms; };
        o.nowIso = [] { return std::string("2026-10-25T08:00:00Z"); };
        int n = 0;
        o.newRecipeId = [n]() mutable { return "d-" + std::to_string(++n); };
        o.log = [](const std::string&) {};
        o.writeTimeoutMs = 1000;
        o.pollMs = 50;
        svc = std::make_unique<Service>(std::move(o));
        svc->start();
    }
    Reply get(const std::string& path, const Caller& who,
              std::map<std::string, std::string> q = {}) {
        return svc->call("GET", path, q, "", who);
    }
    Reply post(const std::string& path, const json& body, const Caller& who) {
        return svc->call("POST", "/api/v1/recipes/" + path, {}, body.dump(), who);
    }
    json jobOf(const Reply& r, const Caller& who) {
        svc->waitIdle();
        return get("/api/v1/recipes/jobs/" + r.body["jobId"].get<std::string>(), who).body;
    }
};

}  // namespace

TEST(RecipeModel, CheckValuesTypesLimitsMissingExtra) {
    const Catalog c = catalogFrom(kRecipes, kTags);
    const TypeDef& t = *c.find("lo");
    EXPECT_TRUE(checkValues(t, kRecipes["types"][0]["recipes"][0]["values"]).empty());
    const auto bad = checkValues(t, kRecipes["types"][0]["recipes"][1]["values"]);
    ASSERT_EQ(bad.size(), 1u);
    EXPECT_EQ(bad[0].tag, "OVEN.SP");
    EXPECT_EQ(bad[0].code, "E_RECIPE_LIMIT");
    const auto many =
        checkValues(t, json{{"OVEN.SP", "x"}, {"OVEN.RUN", 1}, {"OVEN.N", 2.5}, {"KHAC", 1}});
    std::set<std::string> codes;
    for (const auto& i : many) codes.insert(i.tag + ":" + i.code);
    EXPECT_EQ(codes, (std::set<std::string>{"KHAC:E_RECIPE_VALUE", "OVEN.SP:E_RECIPE_VALUE",
                                            "OVEN.RUN:E_RECIPE_VALUE", "OVEN.N:E_RECIPE_VALUE",
                                            "OVEN.NOTE:E_RECIPE_VALUE"}));
    // a float with an integral value fits an integer Tag (as in the TS validator)
    EXPECT_TRUE(checkValues(t, json::parse(R"({"OVEN.SP":100.0,"OVEN.RUN":false,"OVEN.N":7.0,
                                               "OVEN.NOTE":""})"))
                    .empty());
}

TEST(RecipeStoreTest, RevAtomicWriteAndDamagedFile) {
    TempDir dir;
    const std::string path = dir.path() + "/r/p.json";
    RecipeStore s(path);
    std::string err;
    ASSERT_TRUE(s.load(err));
    EXPECT_EQ(s.rev(), 0);
    StoredRecipe r{"d-1", "Một", json{{"A", 1}}, "t", "an"};
    EXPECT_EQ(s.put("lo", r, 1, err), RecipeStore::Status::Conflict);
    ASSERT_EQ(s.put("lo", r, 0, err), RecipeStore::Status::Ok);
    EXPECT_EQ(s.rev(), 1);
    struct stat st {};
    ASSERT_EQ(::stat(path.c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 0777, 0600u);
    EXPECT_NE(::access((path + ".tmp").c_str(), F_OK), 0);
    RecipeStore again(path);
    ASSERT_TRUE(again.load(err));
    EXPECT_EQ(again.rev(), 1);
    ASSERT_NE(again.find("lo", "d-1"), nullptr);
    EXPECT_EQ(again.find("lo", "d-1")->values, (json{{"A", 1}}));
    EXPECT_EQ(again.remove("lo", "khong", 1, err), RecipeStore::Status::NotFound);
    ASSERT_EQ(again.remove("lo", "d-1", 1, err), RecipeStore::Status::Ok);
    EXPECT_TRUE(again.list("lo").empty());
    // a damaged file is set aside, the store starts empty
    std::ofstream(path) << "{hong";
    RecipeStore broken(path);
    ASSERT_TRUE(broken.load(err));
    EXPECT_FALSE(err.empty());
    EXPECT_EQ(broken.rev(), 0);
    EXPECT_EQ(::access((path + ".bad").c_str(), F_OK), 0);
}

TEST(RecipeServiceTest, ListShowsViewableTypesWithRights) {
    Fixture f;
    const Reply v = f.get("/api/v1/recipes", viewer());
    ASSERT_EQ(v.status, 200);
    ASSERT_EQ(v.body["types"].size(), 1u);  // "kin" needs engineer to view
    EXPECT_EQ(v.body["types"][0]["can"], (json{{"operate", false}, {"edit", false}}));
    EXPECT_EQ(v.body["types"][0]["params"][0]["unit"], "°C");
    EXPECT_EQ(v.body["types"][0]["params"][0]["type"], "FLOAT32");
    EXPECT_EQ(v.body["types"][0]["recipes"][0]["origin"], "project");
    const Reply e = f.get("/api/v1/recipes", eng());
    EXPECT_EQ(e.body["types"].size(), 2u);
    EXPECT_EQ(e.body["types"][0]["can"], (json{{"operate", true}, {"edit", true}}));
}

TEST(RecipeServiceTest, DownloadWritesInOrderAndAudits) {
    Fixture f;
    const Reply r = f.post("download", {{"type", "lo"}, {"recipe", "bo"}}, op());
    ASSERT_EQ(r.status, 202) << r.body.dump();
    const json j = f.jobOf(r, op());
    EXPECT_EQ(j["state"], "done");
    ASSERT_EQ(f.writer.submitted.size(), 4u);
    EXPECT_EQ(f.writer.submitted[0], (std::pair<std::string, json>{"OVEN.SP", 180}));
    EXPECT_EQ(f.writer.submitted[3].first, "OVEN.NOTE");
    EXPECT_EQ(f.writer.contexts[0], "recipe-lo|bo");
    for (const auto& x : j["results"]) EXPECT_EQ(x["status"], "ok");
    ASSERT_EQ(f.audit.size(), 2u);
    EXPECT_EQ(f.audit[0].action, "recipe.download");
    EXPECT_EQ(f.audit[0].result, "started");
    EXPECT_EQ(f.audit[0].target, "lo/bo");
    EXPECT_EQ(f.audit[1].result, "ok");
    EXPECT_EQ(f.audit[1].detail["written"], 4);
}

TEST(RecipeServiceTest, FailureInTheMiddleStopsAndSkipsTheRest) {
    Fixture f;
    f.writer.failTag = "OVEN.N";
    const Reply r = f.post("download", {{"type", "lo"}, {"recipe", "bo"}}, op());
    ASSERT_EQ(r.status, 202);
    const json j = f.jobOf(r, op());
    EXPECT_EQ(j["state"], "failed");
    EXPECT_EQ(j["results"][0]["status"], "ok");
    EXPECT_EQ(j["results"][1]["status"], "ok");
    EXPECT_EQ(j["results"][2]["status"], "failed");
    EXPECT_EQ(j["results"][2]["code"], "DEVICE_EXCEPTION");
    EXPECT_EQ(j["results"][3]["status"], "skipped");
    EXPECT_EQ(f.writer.submitted.size(), 3u);  // nothing after the failure
    EXPECT_EQ(f.audit.back().result, "failed");
    EXPECT_EQ(f.audit.back().code, "DEVICE_EXCEPTION");
    EXPECT_EQ(f.audit.back().detail["failedTag"], "OVEN.N");
    EXPECT_EQ(f.audit.back().detail["written"], 2);
}

TEST(RecipeServiceTest, RefusalAndTimeoutStopTheRun) {
    Fixture f;
    f.writer.rejectTag = "OVEN.SP";
    json j = f.jobOf(f.post("download", {{"type", "lo"}, {"recipe", "bo"}}, op()), op());
    EXPECT_EQ(j["results"][0]["code"], "FORBIDDEN");
    EXPECT_EQ(f.writer.submitted.size(), 1u);
    Fixture g;
    g.writer.hangTag = "OVEN.RUN";
    j = g.jobOf(g.post("download", {{"type", "lo"}, {"recipe", "bo"}}, op()), op());
    EXPECT_EQ(j["results"][1]["code"], "RECIPE_WRITE_TIMEOUT");
    EXPECT_EQ(j["results"][2]["status"], "skipped");
}

TEST(RecipeServiceTest, RateLimitedWriteIsSentAgain) {
    Fixture f;
    f.writer.rateTag = "OVEN.N";
    f.writer.rateRefusals = 2;
    const json j = f.jobOf(f.post("download", {{"type", "lo"}, {"recipe", "bo"}}, op()), op());
    EXPECT_EQ(j["state"], "done");
    EXPECT_EQ(f.writer.submitted.size(), 6u);  // OVEN.N three times
    EXPECT_GE(f.clock.load(), 6000);
}

TEST(RecipeServiceTest, LimitsAreCheckedBeforeAnyWrite) {
    Fixture f;
    const Reply r = f.post("download", {{"type", "lo"}, {"recipe", "xau"}}, op());
    EXPECT_EQ(r.status, 400);
    EXPECT_EQ(r.body["error"], "RECIPE_INVALID");
    EXPECT_EQ(r.body["issues"][0]["tag"], "OVEN.SP");
    EXPECT_TRUE(f.writer.submitted.empty());
    EXPECT_TRUE(f.audit.empty());
}

TEST(RecipeServiceTest, RightsOfTheType) {
    Fixture f;
    EXPECT_EQ(f.post("download", {{"type", "lo"}, {"recipe", "bo"}}, viewer()).status, 403);
    EXPECT_EQ(f.post("download", {{"type", "kin"}, {"recipe", "x"}}, op()).status, 404);
    // edit needs engineer for "lo"
    EXPECT_EQ(f.post("save",
                     {{"type", "lo"},
                      {"name", "Mới"},
                      {"values", kRecipes["types"][0]["recipes"][0]["values"]},
                      {"rev", 0}},
                     op())
                  .status,
              403);
    EXPECT_TRUE(f.writer.submitted.empty());
}

TEST(RecipeServiceTest, AuditDownMeansNothingIsWritten) {
    Fixture f;
    f.auditDown = true;
    const Reply r = f.post("download", {{"type", "lo"}, {"recipe", "bo"}}, op());
    EXPECT_EQ(r.status, 503);
    EXPECT_EQ(r.body["error"], "AUDIT_UNAVAILABLE");
    EXPECT_TRUE(f.writer.submitted.empty());
    const Reply s = f.post("save",
                           {{"type", "lo"},
                            {"name", "Mới"},
                            {"values", kRecipes["types"][0]["recipes"][0]["values"]},
                            {"rev", 0}},
                           eng());
    EXPECT_EQ(s.status, 503);
    EXPECT_EQ(f.get("/api/v1/recipes", eng()).body["rev"], 0);
}

TEST(RecipeServiceTest, OneDownloadAtATime) {
    Fixture f;
    f.writer.hangTag = "OVEN.SP";
    f.writer.pollsToEnd = 1;
    // the clock only moves when the run sleeps: block it by never answering for a while
    const Reply a = f.post("download", {{"type", "lo"}, {"recipe", "bo"}}, op());
    ASSERT_EQ(a.status, 202);
    const Reply b = f.post("download", {{"type", "lo"}, {"recipe", "bo"}}, op());
    // either still running (busy) or already timed out; both are fine, never two at once
    if (b.status != 202) EXPECT_EQ(b.body["error"], "RECIPE_BUSY");
    f.svc->waitIdle();
}

TEST(RecipeServiceTest, SaveEditDeleteWithRevAndReadOnlyProjectRecipes) {
    Fixture f;
    const json values = kRecipes["types"][0]["recipes"][0]["values"];
    Reply s = f.post("save", {{"type", "lo"}, {"name", "Bản sao"}, {"values", values}, {"rev", 0}},
                     eng());
    ASSERT_EQ(s.status, 200) << s.body.dump();
    EXPECT_EQ(s.body["rev"], 1);
    EXPECT_EQ(s.body["recipe"]["id"], "d-1");
    EXPECT_EQ(s.body["recipe"]["updatedBy"], "binh");
    EXPECT_EQ(f.audit.back().action, "recipe.save");
    // a second person on the old rev: CONFLICT, nothing changed
    Reply c =
        f.post("save", {{"type", "lo"}, {"name", "Khác"}, {"values", values}, {"rev", 0}}, eng());
    EXPECT_EQ(c.status, 409);
    EXPECT_EQ(c.body["error"], "CONFLICT");
    // edit
    json v2 = values;
    v2["OVEN.SP"] = 200;
    s = f.post("save",
               {{"type", "lo"}, {"id", "d-1"}, {"name", "Bản sao 2"}, {"values", v2}, {"rev", 1}},
               eng());
    ASSERT_EQ(s.status, 200);
    EXPECT_EQ(s.body["recipe"]["values"]["OVEN.SP"], 200);
    // a project recipe is read-only
    EXPECT_EQ(
        f.post("save", {{"type", "lo"}, {"id", "bo"}, {"name", "X"}, {"values", v2}, {"rev", 2}},
               eng())
            .body["error"],
        "RECIPE_READONLY");
    EXPECT_EQ(f.post("delete", {{"type", "lo"}, {"id", "bo"}, {"rev", 2}}, eng()).body["error"],
              "RECIPE_READONLY");
    // out of limits: refused, not saved
    v2["OVEN.SP"] = 999;
    EXPECT_EQ(f.post("save", {{"type", "lo"}, {"name", "Y"}, {"values", v2}, {"rev", 2}}, eng())
                  .body["error"],
              "RECIPE_INVALID");
    // delete
    const Reply d = f.post("delete", {{"type", "lo"}, {"id", "d-1"}, {"rev", 2}}, eng());
    ASSERT_EQ(d.status, 200);
    EXPECT_EQ(d.body["rev"], 3);
    EXPECT_EQ(f.audit.back().action, "recipe.delete");
    // the device recipe can be downloaded like a project one
    const json list = f.get("/api/v1/recipes", eng()).body;
    EXPECT_EQ(list["types"][0]["recipes"].size(), 2u);
}

TEST(RecipeServiceTest, CaptureNeedsGoodValues) {
    Fixture f;
    f.plc["OVEN.SP"] = {150.5, "GOOD"};
    f.plc["OVEN.RUN"] = {false, "GOOD"};
    f.plc["OVEN.N"] = {9, "BAD"};
    Reply r = f.post("capture", {{"type", "lo"}, {"name", "Từ PLC"}, {"rev", 0}}, eng());
    EXPECT_EQ(r.status, 409);
    EXPECT_EQ(r.body["error"], "RECIPE_BAD_QUALITY");
    EXPECT_EQ(r.body["tags"], (json{"OVEN.N", "OVEN.NOTE"}));
    f.plc["OVEN.N"] = {9, "GOOD"};
    f.plc["OVEN.NOTE"] = {"plc", "GOOD"};
    r = f.post("capture", {{"type", "lo"}, {"name", "Từ PLC"}, {"rev", 0}}, eng());
    ASSERT_EQ(r.status, 200) << r.body.dump();
    EXPECT_EQ(r.body["recipe"]["values"]["OVEN.SP"], 150.5);
    EXPECT_EQ(f.audit.back().action, "recipe.capture");
    const Reply cur = f.get("/api/v1/recipes/current", op(), {{"type", "lo"}});
    EXPECT_EQ(cur.body["values"]["OVEN.N"]["quality"], "GOOD");
}

TEST(RecipeServiceTest, NoWriterMeansNoDownload) {
    Fixture f(false);
    EXPECT_EQ(f.post("download", {{"type", "lo"}, {"recipe", "bo"}}, op()).body["error"],
              "WRITES_UNAVAILABLE");
}
