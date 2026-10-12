// T144 (feature 006, US2; contracts/device-api-1.1.md §3, §1.1, §7): POST /api/v1/tags/write and
// the questions about a result, GET /api/v1/tags/write/{requestId} and ?ids=, on the two listeners
// of mat-runtime in process, over the real audit log (version 2), the real coordinator and a fake
// of the drivers.
// - operator and above write, over HTTPS with a session; every refusal, also the ones of the gate
//   (no session, a viewer, plain HTTP), is audited as tag.write denied with the Tag and the value
//   when the body can be read, and the 401 and 403 of a readable body carry a `results` list;
// - the body: 1-16 requests, a lower-case UUID v4 each, a Tag of at most 64 bytes, a boolean,
//   number or string for the value; anything else is 400 for the whole batch; 413 above 16 KiB;
// - the answer of §3.1: ACCEPTED (phase queued, old, receivedAt, raw), REJECTED (reason, message,
//   retryAfterMs), `duplicate`, REQUEST_ID_CONFLICT;
// - the questions: only the sender or an administrator sees a result, UNKNOWN or 404 for the rest,
//   no audit row, the idle time of the session is not restarted; a POST restarts it;
// - audit: started, ok / failed with the facts of FR-039; the live hook; GET /audit?target=.
#include <gtest/gtest.h>

#include "core/tag-engine/tests/write_fakes.hpp"
#include "server/tests/api_rig.hpp"
#include "server/websocket/live_hub.hpp"
#include "server/write_glue.hpp"

using namespace mat;
using namespace mat::test;
using namespace mat::testing;
using nlohmann::json;

namespace {

constexpr int64_t kMin = 60 * 1000;

struct State {
    ProjectModel model;
    TagStore store;
    Events ev;
    FakeBackend backend{ev};
    std::unique_ptr<AuditLogWriteAudit> audit;
    std::unique_ptr<WriteCoordinator> coord;

    void init(ApiRig& r) {
        model = makeModel();
        addModelTagsToStore(model, store);
        store.set(SP, 72.5, Quality::GOOD, 1, 1);
        store.set(CNT, int64_t{3}, Quality::GOOD, 1, 1);
        audit = std::make_unique<AuditLogWriteAudit>(*r.audit);
        CoordinatorOptions o;
        o.monoMs = [&r] { return r.mono.load(); };
        o.wallMs = [&r] { return r.wall.load(); };
        o.clockSynced = [](int64_t) { return true; };
        o.log = [](const std::string&) {};
        coord = std::make_unique<WriteCoordinator>(model, store, backend, *audit, o);
    }
};

struct Rig : ApiRig {
    explicit Rig(std::shared_ptr<State> s = std::make_shared<State>(), bool withTags = true)
        : ApiRig([s, withTags](ApiRig& rig) {
              s->init(rig);
              EngineeringApi::DiagnosticsBackend diag;  // GET /audit is served with it
              diag.proc = [] { return ProcSnapshot{}; };
              rig.eng->setDiagnostics(diag);
              if (withTags) {
                  EngineeringApi::TagsBackend t;
                  t.coordinator = s->coord.get();
                  rig.eng->setTags(t);
              }
          }),
          st(std::move(s)) {}

    static json req(const std::string& id, const std::string& tag, json value) {
        return {{"requestId", id}, {"tag", tag}, {"value", std::move(value)}};
    }
    static std::string body(std::vector<json> reqs) { return json{{"requests", reqs}}.dump(); }
    HttpResult write(const std::string& user, const std::string& text) {
        return postAs(user, "/api/v1/tags/write", text);
    }
    HttpResult write1(const std::string& user, const std::string& tag, json value,
                      const std::string& id = idN(1)) {
        return write(user, body({req(id, tag, std::move(value))}));
    }
    // The internal id of the n-th command the drivers got.
    void result(uint64_t id, drv::WriteStatus s, const char* code, int exc = -1,
                TagScalar rb = {}) {
        drv::WriteResult w;
        w.id = id;
        w.status = s;
        w.code = code;
        w.exception = exc;
        w.readback = std::move(rb);
        st->coord->onDriverResult(w);
    }
    std::shared_ptr<State> st;
};

json first(const HttpResult& r) {
    const json b = bodyJson(r);
    return b.contains("results") && b["results"].is_array() && !b["results"].empty()
               ? b["results"][0]
               : json::object();
}

}  // namespace

// ---------- who may write, and the refusals of the gate ----------

TEST(TagsApi, OperatorEngineerAndAdministratorWriteAViewerDoesNot) {
    Rig r;
    for (const char* user : {"vh1", "kysu1", "admin1"}) {
        const HttpResult res =
            r.write1(user, "SP", 75, idN(static_cast<int>(std::string(user).size()) + 10));
        EXPECT_EQ(res.status, 200) << user << res.body;
        EXPECT_EQ(first(res)["status"], "ACCEPTED") << user;
    }
    const HttpResult v = r.write1("xem1", "SP", 75, idN(99));
    EXPECT_EQ(v.status, 403);
    EXPECT_EQ(bodyJson(v)["error"], "FORBIDDEN");
    EXPECT_EQ(r.st->backend.count(), 3u) << "nothing of the viewer reached a driver";
}

TEST(TagsApi, ARefusedViewerIsAuditedAsTagWriteDeniedWithTheTagTheValueAndTheAccount) {
    Rig r;
    const HttpResult res = r.write1("xem1", "SP", 75, idN(5));
    ASSERT_EQ(res.status, 403);
    // the body was readable: every request comes back REJECTED with the same code
    const json b = bodyJson(res);
    ASSERT_EQ(b["results"].size(), 1u);
    EXPECT_EQ(b["results"][0]["status"], "REJECTED");
    EXPECT_EQ(b["results"][0]["reason"], "FORBIDDEN");
    EXPECT_EQ(b["results"][0]["requestId"], idN(5));
    const auto denied = r.records("tag.write");
    ASSERT_EQ(denied.size(), 1u);
    EXPECT_EQ(denied[0].result, "denied");
    EXPECT_EQ(denied[0].code.value_or(""), "FORBIDDEN");
    EXPECT_EQ(denied[0].target.value_or(""), "SP");
    EXPECT_EQ(denied[0].user.value_or(""), "xem1");
    EXPECT_EQ(denied[0].channel, "https");
    EXPECT_EQ(json::parse(denied[0].detail.value_or("{}"))["value"], 75);
    EXPECT_TRUE(r.records("access.denied").empty()) << "tag.write denied replaces access.denied";
}

TEST(TagsApi, NoSessionIs401WithResultsAndAnAuditRowForTheTag) {
    Rig r;
    const HttpResult res =
        r.call(postReq("/api/v1/tags/write",
                       Rig::body({Rig::req(idN(1), "SP", 75), Rig::req(idN(2), "RUN", true)})));
    EXPECT_EQ(res.status, 401);
    const json b = bodyJson(res);
    EXPECT_EQ(b["error"], "AUTH_REQUIRED");
    ASSERT_EQ(b["results"].size(), 2u);
    for (const json& x : b["results"]) {
        EXPECT_EQ(x["status"], "REJECTED");
        EXPECT_EQ(x["reason"], "AUTH_REQUIRED");
    }
    const auto denied = r.records("tag.write");
    ASSERT_EQ(denied.size(), 2u);  // one per Tag (newest first)
    EXPECT_EQ(denied[0].target.value_or(""), "RUN");
    EXPECT_EQ(denied[1].target.value_or(""), "SP");
    EXPECT_FALSE(denied[1].user.has_value()) << "no account behind it";
    EXPECT_EQ(r.st->backend.count(), 0u);
}

TEST(TagsApi, PlainHttpIs403HttpsRequiredAndAuditedWithoutResults) {
    Rig r;
    const HttpResult res =
        r.callHttp(postReq("/api/v1/tags/write", Rig::body({Rig::req(idN(1), "SP", 75)})));
    EXPECT_EQ(res.status, 403);
    const json b = bodyJson(res);
    EXPECT_EQ(b["error"], "HTTPS_REQUIRED");
    EXPECT_FALSE(b.contains("results"));
    const auto denied = r.records("tag.write");
    ASSERT_EQ(denied.size(), 1u);
    EXPECT_EQ(denied[0].code.value_or(""), "HTTPS_REQUIRED");
    EXPECT_EQ(denied[0].target.value_or(""), "SP");
    EXPECT_EQ(denied[0].channel, "http");
    EXPECT_EQ(r.st->backend.count(), 0u);
}

TEST(TagsApi, RefusalsOfTheSameKindWithinAMinuteAreOneRowWithACount) {
    Rig r;
    for (int i = 0; i < 4; ++i) {
        r.mono += 1000;
        r.wall += 1000;
        ASSERT_EQ(r.write1("xem1", "SP", 75, idN(10 + i)).status, 403);
    }
    const auto denied = r.records("tag.write");
    ASSERT_EQ(denied.size(), 1u);
    EXPECT_EQ(denied[0].count, 4);
}

TEST(TagsApi, AnUnreadableBodyIsAuditedWithoutATag) {
    Rig r;
    EXPECT_EQ(r.postAs("xem1", "/api/v1/tags/write", "{not json").status, 403);
    const auto denied = r.records("tag.write");
    ASSERT_EQ(denied.size(), 1u);
    EXPECT_FALSE(denied[0].target.has_value());
    EXPECT_EQ(denied[0].code.value_or(""), "FORBIDDEN");
}

TEST(TagsApi, WithoutTheAuditLogNothingIsWrittenAndTheAnswerHasResults) {
    Rig r;
    const std::string auth = r.bearer("vh1");
    r.audit->close();
    const HttpResult res =
        r.call(postReq("/api/v1/tags/write", Rig::body({Rig::req(idN(1), "SP", 75)}), {auth}));
    EXPECT_EQ(res.status, 503);
    const json b = bodyJson(res);
    EXPECT_EQ(b["error"], "AUDIT_UNAVAILABLE");
    ASSERT_EQ(b["results"].size(), 1u);
    EXPECT_EQ(b["results"][0]["status"], "REJECTED");
    EXPECT_EQ(b["results"][0]["reason"], "AUDIT_UNAVAILABLE");
    EXPECT_EQ(r.st->backend.count(), 0u);
}

// ---------- the body ----------

TEST(TagsApi, ABadBodyIs400ForTheWholeBatch) {
    Rig r;
    auto bad = [&](const std::string& text, const char* why) {
        const HttpResult res = r.write("vh1", text);
        EXPECT_EQ(res.status, 400) << why;
        EXPECT_EQ(bodyJson(res)["error"], "BAD_REQUEST") << why;
        EXPECT_FALSE(bodyJson(res).contains("results")) << why;
    };
    bad("{not json", "not json");
    bad("[]", "not an object");
    bad("{}", "no requests");
    bad(R"({"requests":[]})", "empty");
    bad(R"({"requests":"x"})", "not an array");
    std::vector<json> many;
    for (int i = 0; i < 17; ++i) many.push_back(Rig::req(idN(i + 1), "SP", 1));
    bad(Rig::body(many), "17 requests");
    bad(Rig::body({Rig::req(idN(1), "SP", 1), Rig::req("not-a-uuid", "SP", 1)}),
        "a bad id spoils the batch");
    bad(Rig::body({Rig::req("6F1C2A8E-4B7D-4C1E-9A3F-1A2B3C4D5E6F", "SP", 1)}), "upper case");
    bad(Rig::body({Rig::req("6f1c2a8e-4b7d-1c1e-9a3f-1a2b3c4d5e6f", "SP", 1)}), "not version 4");
    bad(Rig::body({Rig::req(idN(1), std::string(65, 'x'), 1)}), "a Tag of 65 bytes");
    bad(Rig::body({Rig::req(idN(1), "", 1)}), "empty tag");
    bad(Rig::body({Rig::req(idN(1), "SP", nullptr)}), "null value");
    bad(Rig::body({Rig::req(idN(1), "SP", json::array({1}))}), "array value");
    bad(Rig::body({Rig::req(idN(1), "SP", json::object())}), "object value");
    bad(R"({"requests":[{"requestId":"00000000-0000-4000-8000-000000000001","tag":"SP"}]})",
        "no value");
    bad(R"({"requests":[{"requestId":"00000000-0000-4000-8000-000000000001","value":1}]})",
        "no tag");
    bad(R"({"requests":[{"tag":"SP","value":1}]})", "no request id");
    EXPECT_EQ(r.st->backend.count(), 0u);
    // 16 are fine
    many.pop_back();
    EXPECT_EQ(r.write("admin1", Rig::body(many)).status, 200);
}

TEST(TagsApi, ABodyOver16KiBIs413) {
    Rig r;
    json b = {{"requests", json::array({Rig::req(idN(1), "SP", 1)})},
              {"pad", std::string(17 * 1024, 'x')}};
    const HttpResult res = r.write("vh1", b.dump());
    EXPECT_EQ(res.status, 413);
    EXPECT_EQ(bodyJson(res)["error"], "BODY_TOO_LARGE");
}

// ---------- the answer ----------

TEST(TagsApi, AcceptedHasPhaseOldValueAndReceiptTime) {
    Rig r;
    r.wall = 1791600123456LL;
    const json x = first(r.write1("vh1", "SP", 75));
    EXPECT_EQ(x["requestId"], idN(1));
    EXPECT_EQ(x["status"], "ACCEPTED");
    EXPECT_EQ(x["phase"], "queued");
    EXPECT_EQ(x["tag"], "SP");
    EXPECT_EQ(x["value"], 75);
    EXPECT_EQ(x["old"]["value"], 72.5);
    EXPECT_EQ(x["old"]["quality"], "GOOD");
    EXPECT_EQ(x["receivedAt"], "2026-10-10T02:42:03.456Z");
    EXPECT_FALSE(x.contains("raw"));
    EXPECT_FALSE(x.contains("duplicate"));
    ASSERT_EQ(r.st->backend.count(), 1u);
    EXPECT_EQ(std::get<double>(r.st->backend.cmd(0).raw), 75.0);
}

TEST(TagsApi, ATagWithScalingShowsTheRawValue) {
    Rig r;
    const json x = first(r.write1("vh1", "SCALED", 50));
    EXPECT_EQ(x["status"], "ACCEPTED");
    EXPECT_EQ(x["raw"], 13824);
}

TEST(TagsApi, SixtyFourBitValuesTravelAsDecimalStringsAndStayExact) {
    Rig r;
    const json x = first(r.write1("vh1", "BIG", "9007199254740993"));
    EXPECT_EQ(x["status"], "ACCEPTED");
    EXPECT_EQ(x["value"], "9007199254740993");
    EXPECT_EQ(std::get<int64_t>(r.st->backend.cmd(0).raw), 9007199254740993LL);
    const json y = first(r.write1("vh1", "UBIG", json(18446744073709551615ULL),
                                  idN(2)));  // a JSON number above int64
    EXPECT_EQ(y["status"], "ACCEPTED");
    EXPECT_EQ(std::get<uint64_t>(r.st->backend.cmd(1).raw), UINT64_MAX);
}

TEST(TagsApi, EachRequestOfAPostIsDecidedAndTheOthersStillGo) {
    Rig r;
    const HttpResult res =
        r.write("vh1", Rig::body({Rig::req(idN(1), "SP", 75), Rig::req(idN(2), "SP", 999),
                                  Rig::req(idN(3), "NOPE", 1), Rig::req(idN(4), "RUN", true)}));
    ASSERT_EQ(res.status, 200);
    const json b = bodyJson(res)["results"];
    ASSERT_EQ(b.size(), 4u);
    EXPECT_EQ(b[0]["status"], "ACCEPTED");
    EXPECT_EQ(b[1]["status"], "REJECTED");
    EXPECT_EQ(b[1]["reason"], "OUT_OF_LIMITS");
    EXPECT_FALSE(b[1]["message"].get<std::string>().empty());
    EXPECT_EQ(b[2]["reason"], "NO_SUCH_TAG");
    EXPECT_EQ(b[3]["status"], "ACCEPTED");
    EXPECT_EQ(r.st->backend.count(), 2u);
}

TEST(TagsApi, RateLimitedTellsRetryAfterMs) {
    Rig r;
    const std::string auth = r.bearer("vh1");
    for (int i = 0; i < 10; ++i) {
        const HttpResult res = r.call(
            postReq("/api/v1/tags/write", Rig::body({Rig::req(idN(i + 1), "CNT", i)}), {auth}));
        ASSERT_EQ(first(res)["status"], "ACCEPTED") << i;
    }
    const json x = first(
        r.call(postReq("/api/v1/tags/write", Rig::body({Rig::req(idN(50), "CNT", 1)}), {auth})));
    EXPECT_EQ(x["status"], "REJECTED");
    EXPECT_EQ(x["reason"], "RATE_LIMITED");
    EXPECT_EQ(x["retryAfterMs"], 3000);
}

TEST(TagsApi, ASameRequestIdIsTheSameAnswerWithDuplicateAndRunsOnce) {
    Rig r;
    const std::string auth = r.bearer("vh1");
    const std::string text = Rig::body({Rig::req(idN(1), "SP", 75)});
    ASSERT_EQ(first(r.call(postReq("/api/v1/tags/write", text, {auth})))["status"], "ACCEPTED");
    const json again = first(r.call(postReq("/api/v1/tags/write", text, {auth})));
    EXPECT_EQ(again["status"], "ACCEPTED");
    EXPECT_EQ(again["duplicate"], true);
    EXPECT_EQ(r.st->backend.count(), 1u);
    const json conflict = first(
        r.call(postReq("/api/v1/tags/write", Rig::body({Rig::req(idN(1), "SP", 80)}), {auth})));
    EXPECT_EQ(conflict["status"], "REJECTED");
    EXPECT_EQ(conflict["reason"], "REQUEST_ID_CONFLICT");
    r.result(1, drv::WriteStatus::Confirmed, "CONFIRMED");
    const json done = first(r.call(postReq("/api/v1/tags/write", text, {auth})));
    EXPECT_EQ(done["status"], "CONFIRMED");
    EXPECT_EQ(done["duplicate"], true);
    EXPECT_EQ(r.st->backend.count(), 1u);
}

// ---------- the questions ----------

TEST(TagsApi, TheResultOfACommandByItsId) {
    Rig r;
    r.wall = 1791600000000LL;
    const std::string auth = r.bearer("vh1");
    ASSERT_EQ(first(r.call(postReq("/api/v1/tags/write", Rig::body({Rig::req(idN(1), "SP", 75)}),
                                   {auth})))["status"],
              "ACCEPTED");
    json x = first(r.call(getReq("/api/v1/tags/write?ids=" + idN(1), {auth})));
    EXPECT_EQ(x["status"], "ACCEPTED");
    EXPECT_EQ(x["phase"], "queued");
    r.wall += 400;
    r.result(1, drv::WriteStatus::Confirmed, "CONFIRMED", -1, 75.0);
    HttpResult res = r.call(getReq("/api/v1/tags/write/" + idN(1), {auth}));
    ASSERT_EQ(res.status, 200) << res.body;
    x = first(res);
    EXPECT_EQ(x["status"], "CONFIRMED");
    EXPECT_EQ(x["code"], "CONFIRMED");
    EXPECT_EQ(x["tag"], "SP");
    EXPECT_EQ(x["value"], 75);
    EXPECT_EQ(x["readback"], 75);
    EXPECT_EQ(x["receivedAt"], "2026-10-10T02:40:00.000Z");
    EXPECT_EQ(x["finishedAt"], "2026-10-10T02:40:00.400Z");
    EXPECT_EQ(x["clockOk"], true);
}

TEST(TagsApi, EveryKindOfEndHasItsShape) {
    Rig r;
    const std::string auth = r.bearer("vh1");
    auto go = [&](int n, drv::WriteStatus s, const char* code, int exc, TagScalar rb) {
        const HttpResult w =
            r.call(postReq("/api/v1/tags/write", Rig::body({Rig::req(idN(n), "CNT", n)}), {auth}));
        EXPECT_EQ(first(w)["status"], "ACCEPTED") << n;
        r.result(static_cast<uint64_t>(n), s, code, exc, std::move(rb));
        r.mono += 3000;
        return first(r.call(getReq("/api/v1/tags/write/" + idN(n), {auth})));
    };
    json x = go(1, drv::WriteStatus::Failed, "DEVICE_EXCEPTION", 2, {});
    EXPECT_EQ(x["status"], "FAILED");
    EXPECT_EQ(x["code"], "DEVICE_EXCEPTION");
    EXPECT_EQ(x["exception"]["code"], "02");
    EXPECT_EQ(x["exception"]["meaning"], "địa chỉ không hợp lệ");
    x = go(2, drv::WriteStatus::Timeout, "WRITE_TIMEOUT", -1, {});
    EXPECT_EQ(x["status"], "TIMEOUT");
    EXPECT_EQ(x["code"], "WRITE_TIMEOUT");
    EXPECT_NE(x["message"].get<std::string>().find("không chắc"), std::string::npos);
    x = go(3, drv::WriteStatus::Failed, "READBACK_MISMATCH", -1, int64_t{4});
    EXPECT_EQ(x["status"], "FAILED");
    EXPECT_EQ(x["readback"], 4);
    x = go(4, drv::WriteStatus::NoReadback, "NO_READBACK", -1, {});
    EXPECT_EQ(x["status"], "CONFIRMED");
    EXPECT_EQ(x["code"], "NO_READBACK");
    EXPECT_FALSE(x.contains("readback"));
}

TEST(TagsApi, ManyIdsAtOnceAtMost16AndUnknownOnesAreSaidNotInvented) {
    Rig r;
    const std::string auth = r.bearer("vh1");
    ASSERT_EQ(first(r.call(postReq("/api/v1/tags/write", Rig::body({Rig::req(idN(1), "SP", 75)}),
                                   {auth})))["status"],
              "ACCEPTED");
    HttpResult res =
        r.call(getReq("/api/v1/tags/write?ids=" + idN(1) + "," + idN(9) + ",garbage", {auth}));
    ASSERT_EQ(res.status, 200) << res.body;
    const json b = bodyJson(res)["results"];
    ASSERT_EQ(b.size(), 3u);
    EXPECT_EQ(b[0]["status"], "ACCEPTED");
    EXPECT_EQ(b[1]["status"], "UNKNOWN");
    EXPECT_EQ(b[1]["requestId"], idN(9));
    EXPECT_EQ(b[2]["status"], "UNKNOWN");
    std::string many = idN(1);
    for (int i = 2; i <= 17; ++i) many += "," + idN(i);
    EXPECT_EQ(r.call(getReq("/api/v1/tags/write?ids=" + many, {auth})).status, 400);
    EXPECT_EQ(r.call(getReq("/api/v1/tags/write", {auth})).status, 400) << "no ids";
    EXPECT_EQ(r.call(getReq("/api/v1/tags/write?ids=", {auth})).status, 400);
}

TEST(TagsApi, OneUnknownIdIs404NoSuchRequest) {
    Rig r;
    const HttpResult res = r.getAs("vh1", "/api/v1/tags/write/" + idN(42));
    EXPECT_EQ(res.status, 404);
    EXPECT_EQ(bodyJson(res)["error"], "NO_SUCH_REQUEST");
    EXPECT_EQ(r.getAs("vh1", "/api/v1/tags/write/not-a-uuid").status, 404);
}

TEST(TagsApi, OnlyTheSenderOrAnAdministratorSeesAResult) {
    Rig r;
    ASSERT_EQ(first(r.write1("vh1", "SP", 75))["status"], "ACCEPTED");
    r.result(1, drv::WriteStatus::Confirmed, "CONFIRMED");
    EXPECT_EQ(first(r.getAs("vh1", "/api/v1/tags/write/" + idN(1)))["status"], "CONFIRMED");
    const HttpResult other = r.getAs("vh2", "/api/v1/tags/write/" + idN(1));
    EXPECT_EQ(other.status, 404) << "another operator";
    EXPECT_EQ(first(r.getAs("vh2", "/api/v1/tags/write?ids=" + idN(1)))["status"], "UNKNOWN");
    EXPECT_EQ(first(r.getAs("admin1", "/api/v1/tags/write/" + idN(1)))["status"], "CONFIRMED")
        << "the administrator sees all";
    EXPECT_EQ(r.getAs("xem1", "/api/v1/tags/write/" + idN(1)).status, 403)
        << "a viewer may not even ask";
}

TEST(TagsApi, AskingWritesNoAuditRowAndDoesNotRestartTheIdleTimeButAPostDoes) {
    Rig r;
    const std::string auth = r.bearer("vh1");
    ASSERT_EQ(first(r.call(postReq("/api/v1/tags/write", Rig::body({Rig::req(idN(1), "SP", 75)}),
                                   {auth})))["status"],
              "ACCEPTED");
    r.result(1, drv::WriteStatus::Confirmed, "CONFIRMED");
    r.st->coord->waitAuditIdle();
    const size_t before = r.records("").size();
    r.mono += 10 * kMin;
    ASSERT_EQ(r.call(getReq("/api/v1/tags/write/" + idN(1), {auth})).status, 200);
    ASSERT_EQ(r.call(getReq("/api/v1/tags/write?ids=" + idN(1), {auth})).status, 200);
    json s = bodyJson(r.call(getReq("/api/v1/auth/session", {auth})));
    EXPECT_EQ(s["idleRemainingS"], 1200)
        << "30 minutes less the 10 that passed: the questions did not restart it";
    EXPECT_EQ(r.records("").size(), before);
    ASSERT_EQ(first(r.call(postReq("/api/v1/tags/write", Rig::body({Rig::req(idN(2), "SP", 70)}),
                                   {auth})))["status"],
              "ACCEPTED");
    s = bodyJson(r.call(getReq("/api/v1/auth/session", {auth})));
    EXPECT_EQ(s["idleRemainingS"], 1800) << "a POST is a person at work";
}

// ---------- audit ----------

TEST(TagsApi, TheAuditHasTheRecordOfReceiptBeforeAnythingIsSentAndTheEnd) {
    Rig r;
    r.wall = 1791600000000LL;
    ASSERT_EQ(first(r.write1("vh1", "SP", 75))["status"], "ACCEPTED");
    // the record of receipt is in the file by the time the answer is back (the driver got it after)
    auto rows = r.records("tag.write");
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].result, "started");
    EXPECT_EQ(rows[0].code.value_or(""), "ACCEPTED");
    EXPECT_EQ(rows[0].user.value_or(""), "vh1");
    EXPECT_EQ(rows[0].role.value_or(""), "operator");
    EXPECT_EQ(rows[0].target.value_or(""), "SP");
    EXPECT_EQ(rows[0].channel, "https");
    EXPECT_FALSE(rows[0].source.empty());
    const json d = json::parse(rows[0].detail.value_or("{}"));
    EXPECT_EQ(d["requestId"], idN(1));
    EXPECT_EQ(d["kind"], "external");
    EXPECT_EQ(d["channel"], "plc1");
    EXPECT_EQ(d["device"], "d1");
    EXPECT_EQ(d["old"]["value"], 72.5);
    EXPECT_EQ(d["old"]["quality"], "GOOD");
    EXPECT_EQ(d["new"], 75);
    r.result(1, drv::WriteStatus::Confirmed, "CONFIRMED", -1, 75.0);
    r.st->coord->waitAuditIdle();
    rows = r.records("tag.write");
    ASSERT_EQ(rows.size(), 2u);
    EXPECT_EQ(rows[0].result, "ok");
    EXPECT_EQ(rows[0].code.value_or(""), "CONFIRMED");
    EXPECT_EQ(rows[0].user.value_or(""), "vh1") << "under the account that sent it";
    EXPECT_EQ(json::parse(rows[0].detail.value_or("{}"))["readback"], 75);
    // the table of request ids knows it
    const auto info = r.audit->findTagWrite(idN(1));
    ASSERT_TRUE(info.has_value());
    EXPECT_TRUE(info->row.resultId.has_value());
}

TEST(TagsApi, AFailedEndIsAFailedRecordWithTheException) {
    Rig r;
    ASSERT_EQ(first(r.write1("vh1", "CNT", 5))["status"], "ACCEPTED");
    r.result(1, drv::WriteStatus::Failed, "DEVICE_EXCEPTION", 3);
    r.st->coord->waitAuditIdle();
    const auto rows = r.records("tag.write");
    ASSERT_EQ(rows.size(), 2u);
    EXPECT_EQ(rows[0].result, "failed");
    EXPECT_EQ(rows[0].code.value_or(""), "DEVICE_EXCEPTION");
    EXPECT_EQ(json::parse(rows[0].detail.value_or("{}"))["exception"], 3);
}

TEST(TagsApi, ACommandThatIsAcceptedIsFoundAfterTheCoordinatorIsGone) {
    // the process restarts (execv): the table of request ids is what remembers
    Rig r;
    ASSERT_EQ(first(r.write1("vh1", "SP", 75))["status"], "ACCEPTED");
    r.result(1, drv::WriteStatus::Confirmed, "CONFIRMED", -1, 75.0);
    r.st->coord->waitAuditIdle();
    // a new coordinator over the same audit log, as after the execv
    State again;
    again.model = makeModel();
    addModelTagsToStore(again.model, again.store);
    again.audit = std::make_unique<AuditLogWriteAudit>(*r.audit);
    CoordinatorOptions o;
    o.monoMs = [&r] { return r.mono.load(); };
    o.wallMs = [&r] { return r.wall.load(); };
    o.log = [](const std::string&) {};
    again.coord = std::make_unique<WriteCoordinator>(again.model, again.store, again.backend,
                                                     *again.audit, o);
    WriteCaller who;
    who.user = "vh1";
    who.sessionKey = "k";
    const auto v = again.coord->submit(who, {{idN(1), "SP", WriteValue::integer(75)}});
    EXPECT_EQ(v[0].status, "CONFIRMED");
    EXPECT_TRUE(v[0].duplicate);
    EXPECT_EQ(again.backend.count(), 0u) << "not run a second time";
    EXPECT_EQ(again.coord->submit(who, {{idN(1), "SP", WriteValue::integer(76)}})[0].code,
              "REQUEST_ID_CONFLICT");
    WriteCaller other;
    other.user = "vh2";
    EXPECT_EQ(again.coord->status(other, idN(1)).status, "UNKNOWN");
    EXPECT_EQ(again.coord->status(who, idN(1)).status, "CONFIRMED");
}

TEST(TagsApi, AdministratorFiltersTheAuditByTag) {
    Rig r;
    ASSERT_EQ(first(r.write1("vh1", "SP", 75, idN(1)))["status"], "ACCEPTED");
    ASSERT_EQ(first(r.write1("vh1", "RUN", true, idN(2)))["status"], "ACCEPTED");
    ASSERT_EQ(first(r.write1("vh1", "CNT", 3, idN(3)))["status"], "ACCEPTED");
    const HttpResult res = r.getAs("admin1", "/api/v1/audit?target=RUN&action=tag.");
    ASSERT_EQ(res.status, 200) << res.body;
    const json recs = bodyJson(res)["records"];
    ASSERT_EQ(recs.size(), 1u);
    EXPECT_EQ(recs[0]["target"], "RUN");
    EXPECT_EQ(recs[0]["action"], "tag.write");
    EXPECT_EQ(r.getAs("admin1", "/api/v1/audit?target=").status, 400);
}

// ---------- the live channel ----------

TEST(TagsApi, AWriteMessageOnTheLiveChannelIsAuditedAsDeniedWithTheTagAndTheValue) {
    Rig r;
    const auto hook = liveRejectedWriteHook(*r.st->coord);
    hook("SP", "75", 7);
    hook("SP", "75", 8);  // the same refusal again: coalesced
    hook("", "", 9);
    r.st->coord->waitAuditIdle();
    const auto rows = r.records("tag.write");
    ASSERT_EQ(rows.size(), 2u);  // newest first
    EXPECT_EQ(rows[0].code.value_or(""), "LIVE_WRITE_NOT_ALLOWED");
    EXPECT_FALSE(rows[0].target.has_value());
    EXPECT_EQ(rows[1].code.value_or(""), "LIVE_WRITE_NOT_ALLOWED");
    EXPECT_EQ(rows[1].target.value_or(""), "SP");
    EXPECT_EQ(rows[1].result, "denied");
    EXPECT_EQ(rows[1].count, 2);
    EXPECT_EQ(json::parse(rows[1].detail.value_or("{}"))["value"], 75);
}

// ---------- features, absence ----------

TEST(TagsApi, TheIdentityListsTagWriteAndWithoutABackendTheRoutesAnswer501AfterTheGate) {
    Rig r;
    const json f = bodyJson(r.call(getReq("/api/v1/device/identity")))["features"];
    EXPECT_NE(std::find(f.begin(), f.end(), json("tag-write")), f.end());

    Rig none(std::make_shared<State>(), false);
    EXPECT_EQ(none.write1("vh1", "SP", 75).status, 501);
    EXPECT_EQ(none.write1("xem1", "SP", 75).status, 403) << "the gate comes first";
    EXPECT_EQ(none.getAs("vh1", "/api/v1/tags/write/" + idN(1)).status, 501);
    const json g = bodyJson(none.call(getReq("/api/v1/device/identity")))["features"];
    EXPECT_EQ(std::find(g.begin(), g.end(), json("tag-write")), g.end());
}

TEST(TagsApi, AMethodThatIsNotInTheTableIs405) {
    Rig r;
    HttpRequest q = getReq("/api/v1/tags/write", {r.bearer("vh1")});
    q.method = "PUT";
    EXPECT_EQ(r.call(q).status, 405);
}
