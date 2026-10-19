// T044 (feature 009; FR-028..FR-034, FR-050, FR-051, FR-088, FR-090; contracts/device-api-1.3.md
// §1-§3): the alarm routes on the two listeners of mat-runtime in process, over the real engine,
// the real alarm.db and the real audit log.
// - the table of rights: viewers read, operators acknowledge and shelve (cookie too), engineers
//   disable and enable (Bearer only), HTTPS only for the POST routes;
// - ack: one result per item (ACKED, ALREADY_ACKED, NOT_ACTIVE, STALE, SHELVED, NOT_FOUND), the
//   whole list with upToRevision, ONE audit record per batch, the audit committed BEFORE the state
//   changes (a failing audit: 503 and nothing changed), two requests at once: one wins;
// - shelve, unshelve, disable, enable: ranges, idempotence, the limit of 50;
// - the body: unknown keys, wrong shapes, size, media type; the rate limit; a stalled engine.
#include <gtest/gtest.h>

#include <thread>

#include "server/tests/alarm_rig.hpp"

using namespace mat;
using namespace mat::test;
using nlohmann::json;

namespace {

json item(const std::string& id, int64_t occurrence) {
    return {{"id", id}, {"occurrence", occurrence}};
}
json ackItems(std::vector<json> items) { return {{"items", items}}; }

struct Fx : AlarmRig {
    explicit Fx(AlarmWorldOptions o = {}) : AlarmRig(o) { servePage(); }
    HttpResult ack(const std::string& user, const json& body) {
        return postAs(user, "/api/v1/alarms/ack", body.dump());
    }
    HttpResult act(const std::string& user, const std::string& verb, const json& body) {
        return postAs(user, "/api/v1/alarms/" + verb, body.dump());
    }
    // The occurrence of an instance the engine shows.
    int64_t occ(const std::string& id) { return world->occurrenceOf(id); }
    static json resultOf(const HttpResult& r, size_t i = 0) {
        const json b = bodyJson(r);
        return b.contains("results") && b["results"].size() > i ? b["results"][i] : json::object();
    }
};

}  // namespace

// ---------- reads ----------

TEST(AlarmsApi, ListHasTheCatalogueAndTheInstancesThatAreNotNormal) {
    Fx f;
    HttpResult r = f.callHttp(getReq("/api/v1/alarms"));
    ASSERT_EQ(r.status, 200) << r.body;
    json b = bodyJson(r);
    EXPECT_TRUE(b["instances"].empty());
    EXPECT_EQ(b["classes"].size(), 3u);
    EXPECT_EQ(b["areas"].size(), 2u);
    EXPECT_EQ(b["counts"]["active"], 0);
    EXPECT_EQ(b["revision"], 0);
    ASSERT_TRUE(f.world->raise("P1.FAULT", "P1_FAULT"));
    b = bodyJson(f.callHttp(getReq("/api/v1/alarms")));
    ASSERT_EQ(b["instances"].size(), 1u);
    const json& i = b["instances"][0];
    EXPECT_EQ(i["id"], "P1_FAULT");
    EXPECT_EQ(i["alarmId"], "P1_FAULT");
    EXPECT_EQ(i["type"], "digital");
    EXPECT_EQ(i["state"], "ACTIVE_UNACK");
    EXPECT_EQ(i["class"], "critical");
    EXPECT_EQ(i["priority"], "critical");
    EXPECT_EQ(i["area"], "bom");
    EXPECT_EQ(i["text"], "Bơm 1 lỗi");
    EXPECT_GE(i["occurrence"].get<int>(), 1);
    EXPECT_EQ(i["disabled"], false);
    EXPECT_EQ(b["counts"]["active"], 1);
    EXPECT_EQ(b["counts"]["unack"], 1);
    EXPECT_EQ(b["counts"]["byPriority"]["critical"]["unack"], 1);
    EXPECT_GE(b["revision"].get<int>(), 1);
    EXPECT_EQ(r.status, 200);
}

TEST(AlarmsApi, AProjectWithoutAlarmsAnswersEmpty) {
    AlarmWorldOptions o;
    o.withAlarms = false;
    Fx f(o);
    const json b = bodyJson(f.callHttp(getReq("/api/v1/alarms")));
    EXPECT_TRUE(b["instances"].empty());
    EXPECT_TRUE(b["classes"].empty());
    EXPECT_TRUE(b["areas"].empty());
    EXPECT_EQ(b["revision"], 0);
    EXPECT_EQ(b["counts"]["shelved"], 0);
    // ack finds nothing, and writes no audit record
    const HttpResult r = f.ack("vh1", ackItems({item("XY", 1)}));
    ASSERT_EQ(r.status, 200) << r.body;
    EXPECT_EQ(Fx::resultOf(r)["result"], "NOT_FOUND");
    EXPECT_TRUE(f.alarmAudit().empty());
}

TEST(AlarmsApi, ReadsAreForViewersTheSourceFilterAndTheSessionsHoldTheDoor) {
    Fx f;
    EXPECT_EQ(f.callHttp(getReq("/api/v1/alarms")).status, 200) << "a guest of the private network";
    EXPECT_EQ(f.getAs("xem1", "/api/v1/alarms").status, 200)
        << "a viewer with a Bearer token over HTTPS";
    const HttpResult plain = f.callHttp(getReq("/api/v1/alarms", {"Authorization: Bearer abc"}));
    EXPECT_EQ(plain.status, 403) << "a token never travels in clear";
    EXPECT_EQ(bodyJson(plain)["error"], "HTTPS_REQUIRED");
    // a POST route is not a GET route, and a GET route changes nothing
    EXPECT_EQ(f.call(getReq("/api/v1/alarms/ack")).status, 405);
    EXPECT_EQ(f.call(postReq("/api/v1/alarms", "{}")).status, 405);
    EXPECT_EQ(f.call(getReq("/api/v1/alarms/purge")).status, 404);
}

// M1 (security review 009): who acknowledged and the free-text reasons are for a signed-in source
// only; a guest of the page (viewerAccess any / the private network) gets the instances without
// them.
TEST(AlarmsApi, AGuestDoesNotSeeAccountNamesOrFreeTextReasons) {
    Fx f;
    ASSERT_TRUE(f.world->raise("P1.FAULT", "P1_FAULT"));
    ASSERT_TRUE(f.world->raise("P2.FAULT", "P2_FAULT"));
    HttpResult r = f.ack("vh1", ackItems({item("P1_FAULT", f.occ("P1_FAULT"))}));
    ASSERT_EQ(r.status, 200) << r.body;
    r = f.act("vh1", "shelve",
              {{"id", "P2_FAULT"}, {"reason", "Đang hiệu chuẩn"}, {"durationS", 600}});
    ASSERT_EQ(r.status, 200) << r.body;
    std::this_thread::sleep_for(std::chrono::milliseconds(200));

    auto find = [](const json& list, const std::string& id) {
        for (const json& i : list["instances"])
            if (i["id"] == id) return i;
        return json();
    };
    const json signedIn = bodyJson(f.getAs("xem1", "/api/v1/alarms"));
    EXPECT_EQ(find(signedIn, "P1_FAULT")["ackUser"], "vh1");
    EXPECT_EQ(find(signedIn, "P2_FAULT")["shelved"]["user"], "vh1");
    EXPECT_EQ(find(signedIn, "P2_FAULT")["shelved"]["reason"], "Đang hiệu chuẩn");

    const HttpResult g = f.callHttp(getReq("/api/v1/alarms"));
    ASSERT_EQ(g.status, 200) << g.body;
    const json guest = bodyJson(g);
    const json p1 = find(guest, "P1_FAULT");
    const json p2 = find(guest, "P2_FAULT");
    ASSERT_TRUE(p1.is_object());
    ASSERT_TRUE(p2.is_object());
    EXPECT_FALSE(p1.contains("ackUser"));
    EXPECT_TRUE(p1.contains("tsAck")) << "the state itself stays";
    ASSERT_TRUE(p2.contains("shelved"));
    EXPECT_FALSE(p2["shelved"].contains("user"));
    EXPECT_FALSE(p2["shelved"].contains("reason"));
    EXPECT_TRUE(p2["shelved"].contains("until"));
    EXPECT_EQ(g.body.find("vh1"), std::string::npos) << "no account name anywhere";
    EXPECT_EQ(g.body.find("hiệu chuẩn"), std::string::npos);
}

// ---------- the table of rights ----------

TEST(AlarmsApi, OperatorsAckViewersDoNotGuestsAreRefused) {
    Fx f;
    ASSERT_TRUE(f.world->raise("P1.FAULT", "P1_FAULT"));
    const json body = ackItems({item("P1_FAULT", f.occ("P1_FAULT"))});
    HttpResult r = f.ack("xem1", body);
    EXPECT_EQ(r.status, 403);
    EXPECT_EQ(bodyJson(r)["error"], "FORBIDDEN");
    r = f.call(postReq("/api/v1/alarms/ack", body.dump()));
    EXPECT_EQ(r.status, 401);
    EXPECT_EQ(bodyJson(r)["error"], "AUTH_REQUIRED");
    r = f.callHttp(postReq("/api/v1/alarms/ack", body.dump()));
    EXPECT_EQ(r.status, 403);
    EXPECT_EQ(bodyJson(r)["error"], "HTTPS_REQUIRED");
    EXPECT_EQ(f.world->stateOf("P1_FAULT"), "ACTIVE_UNACK")
        << "nothing of the refusals took effect";
    EXPECT_TRUE(f.alarmAudit().empty());
    r = f.ack("vh1", body);
    EXPECT_EQ(r.status, 200) << r.body;
}

TEST(AlarmsApi, DisableAndEnableAreForEngineersAndBearerOnly) {
    Fx f;
    EXPECT_EQ(f.act("vh1", "disable", {{"id", "P2_FAULT"}, {"reason", "hỏng"}}).status, 403);
    EXPECT_EQ(f.act("xem1", "enable", {{"id", "P2_FAULT"}}).status, 403);
    const HttpResult ok =
        f.act("kysu1", "disable", {{"id", "P2_FAULT"}, {"reason", "Cảm biến hỏng"}});
    ASSERT_EQ(ok.status, 200) << ok.body;
    EXPECT_EQ(bodyJson(ok)["disabled"], true);
    EXPECT_EQ(bodyJson(ok)["changed"], true);
    // the cookie of a page, even an engineer's, does not reach them
    const AlarmRig::Session s = f.webSession("kysu1");
    HttpResult r = f.postWeb(s, "/api/v1/alarms/disable", R"({"id":"P2_FAULT","reason":"x"})");
    EXPECT_EQ(r.status, 403);
    EXPECT_EQ(bodyJson(r)["error"], "SESSION_SCOPE");
    r = f.postWeb(s, "/api/v1/alarms/enable", R"({"id":"P2_FAULT"})");
    EXPECT_EQ(r.status, 403);
    EXPECT_EQ(bodyJson(r)["error"], "SESSION_SCOPE");
    EXPECT_EQ(f.act("kysu1", "enable", {{"id", "P2_FAULT"}}).status, 200);
}

TEST(AlarmsApi, TheCookieOfAnOperatorAcknowledgesWithOriginAndCsrf) {
    Fx f;
    ASSERT_TRUE(f.world->raise("P2.FAULT", "P2_FAULT"));
    const AlarmRig::Session s = f.webSession("vh1");
    const std::string body = ackItems({item("P2_FAULT", f.occ("P2_FAULT"))}).dump();
    // no CSRF token, a wrong one, a foreign Origin, no Origin
    HttpRequest q = postReq("/api/v1/alarms/ack", body, {s.cookieHeader(), "Origin: " + f.origin});
    EXPECT_EQ(bodyJson(f.call(q))["error"], "CSRF_FAILED");
    q = postReq("/api/v1/alarms/ack", body,
                {s.cookieHeader(), "Origin: " + f.origin, "X-MAT-CSRF: wrong"});
    EXPECT_EQ(bodyJson(f.call(q))["error"], "CSRF_FAILED");
    q = postReq("/api/v1/alarms/ack", body,
                {s.cookieHeader(), "Origin: https://evil.example", "X-MAT-CSRF: " + s.csrf});
    EXPECT_EQ(bodyJson(f.call(q))["error"], "ORIGIN_MISMATCH");
    q = postReq("/api/v1/alarms/ack", body, {s.cookieHeader(), "X-MAT-CSRF: " + s.csrf});
    EXPECT_EQ(bodyJson(f.call(q))["error"], "ORIGIN_MISMATCH");
    EXPECT_EQ(f.world->stateOf("P2_FAULT"), "ACTIVE_UNACK");
    const HttpResult r = f.postWeb(s, "/api/v1/alarms/ack", body);
    ASSERT_EQ(r.status, 200) << r.body;
    EXPECT_EQ(Fx::resultOf(r)["result"], "ACKED");
    // the audit says who and over which channel
    const auto rows = f.alarmAudit();
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].action, "alarm.ack");
    EXPECT_EQ(rows[0].channel, "web");
    EXPECT_EQ(rows[0].user, std::optional<std::string>("vh1"));
    EXPECT_EQ(rows[0].role, std::optional<std::string>("operator"));
    EXPECT_EQ(rows[0].result, "ok");
    // a read through the cookie works as well
    EXPECT_EQ(f.getWeb(s, "/api/v1/alarms").status, 200);
}

// ---------- ack: the result of each item ----------

TEST(AlarmsApi, AckGivesOneResultPerItem) {
    Fx f;
    ASSERT_TRUE(f.world->raise("P1.FAULT", "P1_FAULT"));
    ASSERT_TRUE(f.world->raise("P2.FAULT", "P2_FAULT"));
    ASSERT_TRUE(f.world->raise("P3.INFO", "P3_INFO", "ACTIVE_ACK"));  // needs no acknowledgement
    const int64_t o1 = f.occ("P1_FAULT"), o2 = f.occ("P2_FAULT");
    // P2 is shelved first
    ASSERT_EQ(
        f.act("vh1", "shelve", {{"id", "P2_FAULT"}, {"reason", "kiểm tra"}, {"durationS", 600}})
            .status,
        200);

    HttpResult r = f.ack("vh1", ackItems({item("P1_FAULT", o1), item("P2_FAULT", o2),
                                          item("P3_INFO", f.occ("P3_INFO")), item("P1_FAULT_X", 1),
                                          item("TANK_LEVEL.HH", 1)}));
    ASSERT_EQ(r.status, 200) << r.body;
    const json b = bodyJson(r);
    EXPECT_EQ(b["mode"], "items");
    EXPECT_EQ(b["results"][0]["result"], "ACKED");
    EXPECT_EQ(b["results"][1]["result"], "SHELVED");
    EXPECT_EQ(b["results"][2]["result"], "ALREADY_ACKED");
    EXPECT_EQ(b["results"][3]["result"], "NOT_FOUND");
    EXPECT_EQ(b["results"][4]["result"], "NOT_ACTIVE") << "a real instance that is normal";
    EXPECT_EQ(b["acked"], 1);
    EXPECT_EQ(b["skippedNewer"], 0);
    EXPECT_EQ(b["results"][0]["occurrence"], o1);
    EXPECT_GE(b["revision"].get<int>(), 1);
    EXPECT_EQ(b["counts"]["shelved"], 1);
    EXPECT_EQ(f.world->stateOf("P1_FAULT"), "ACTIVE_ACK") << "applied before the answer";
    // a second time: idempotent, no second audit record
    r = f.ack("vh1", ackItems({item("P1_FAULT", o1)}));
    EXPECT_EQ(Fx::resultOf(r)["result"], "ALREADY_ACKED");
    EXPECT_EQ(f.records("alarm.ack").size(), 1u);
    // the occurrence that ended and came back is a new one: the old number is STALE
    f.world->setBool("P1.FAULT", false);
    ASSERT_TRUE(AlarmWorld::waitFor([&] { return f.world->stateOf("P1_FAULT") == "NORMAL"; }));
    ASSERT_TRUE(f.world->raise("P1.FAULT", "P1_FAULT"));
    ASSERT_NE(f.occ("P1_FAULT"), o1);
    r = f.ack("vh1", ackItems({item("P1_FAULT", o1)}));
    EXPECT_EQ(Fx::resultOf(r)["result"], "STALE");
    EXPECT_EQ(f.world->stateOf("P1_FAULT"), "ACTIVE_UNACK") << "the newer one is not acknowledged";
}

TEST(AlarmsApi, AckAllTakesOnlyWhatTheUserSawAndTheFilterOfTheRequest) {
    AlarmWorldOptions o;
    o.extra = 3;
    Fx g(o);
    ASSERT_TRUE(g.world->raise("P1.FAULT", "P1_FAULT"));
    ASSERT_TRUE(g.world->raise("P2.FAULT", "P2_FAULT"));
    ASSERT_TRUE(g.world->raise("X01.FAULT", "X01"));
    const int64_t rev = bodyJson(g.callHttp(getReq("/api/v1/alarms")))["revision"].get<int64_t>();
    ASSERT_TRUE(g.world->raise("X02.FAULT", "X02"));  // after the press: not acknowledged
    HttpResult r = g.ack("vh1", {{"all", true},
                                 {"upToRevision", rev},
                                 {"filter", {{"priorities", {"critical", "minor"}}}}});
    ASSERT_EQ(r.status, 200) << r.body;
    json b = bodyJson(r);
    EXPECT_EQ(b["mode"], "all");
    EXPECT_EQ(b["acked"], 3);
    EXPECT_EQ(b["skippedNewer"], 1);
    EXPECT_EQ(g.world->stateOf("P1_FAULT"), "ACTIVE_ACK");
    EXPECT_EQ(g.world->stateOf("P2_FAULT"), "ACTIVE_ACK");
    EXPECT_EQ(g.world->stateOf("X01"), "ACTIVE_ACK");
    EXPECT_EQ(g.world->stateOf("X02"), "ACTIVE_UNACK");
    // one record for the whole batch
    const auto rows = g.records("alarm.ack");
    ASSERT_EQ(rows.size(), 1u);
    const json d = json::parse(rows[0].detail.value_or("{}"));
    EXPECT_EQ(d["count"], 3);
    EXPECT_EQ(d["upToRevision"], rev);
    EXPECT_LE(d["ids"].size(), 10u);
    EXPECT_EQ(rows[0].target.value_or("").rfind("all", 0), 0u);
    // the filter keys: area (- is "Chung"), class, states, text
    ASSERT_TRUE(g.world->raise("P3.INFO", "P3_INFO", "ACTIVE_ACK"));
    const int64_t rev2 = bodyJson(g.callHttp(getReq("/api/v1/alarms")))["revision"].get<int64_t>();
    r = g.ack("vh1", {{"all", true}, {"upToRevision", rev2}, {"filter", {{"areas", {"bom"}}}}});
    EXPECT_EQ(bodyJson(r)["acked"], 0) << "nothing left in the area";
    r = g.ack("vh1", {{"all", true},
                      {"upToRevision", rev2},
                      {"filter", {{"classes", {"minor"}}, {"q", "phụ 02"}}}});
    EXPECT_EQ(bodyJson(r)["acked"], 1) << r.body;
    EXPECT_EQ(g.world->stateOf("X02"), "ACTIVE_ACK");
}

TEST(AlarmsApi, AckAllWithNothingToDoIsStill200AndWritesNoAudit) {
    Fx f;
    const HttpResult r = f.ack("vh1", {{"all", true}, {"upToRevision", 0}});
    ASSERT_EQ(r.status, 200) << r.body;
    EXPECT_EQ(bodyJson(r)["acked"], 0);
    EXPECT_TRUE(bodyJson(r)["results"].empty());
    EXPECT_TRUE(f.alarmAudit().empty());
}

// ---------- audit first ----------

TEST(AlarmsApi, AFailingAuditChangesNothingAndAnswers503) {
    Fx f;
    ASSERT_TRUE(f.world->raise("P1.FAULT", "P1_FAULT"));
    const int64_t o = f.occ("P1_FAULT");
    f.world->auditFails = true;
    HttpResult r = f.ack("vh1", ackItems({item("P1_FAULT", o)}));
    EXPECT_EQ(r.status, 503) << r.body;
    EXPECT_EQ(bodyJson(r)["error"], "AUDIT_UNAVAILABLE");
    EXPECT_FALSE(bodyJson(r).contains("results"));
    std::this_thread::sleep_for(std::chrono::milliseconds(150));  // some rounds of the engine
    EXPECT_EQ(f.world->stateOf("P1_FAULT"), "ACTIVE_UNACK") << "the state did not change";
    EXPECT_EQ(f.world->glue->reservations(), 0u) << "the reservation is given back";
    // the same for shelve, unshelve and disable
    EXPECT_EQ(
        f.act("vh1", "shelve", {{"id", "P1_FAULT"}, {"reason", "r"}, {"durationS", 60}}).status,
        503);
    EXPECT_EQ(f.act("kysu1", "disable", {{"id", "P2_FAULT"}, {"reason", "r"}}).status, 503);
    f.world->auditFails = false;
    r = f.ack("vh1", ackItems({item("P1_FAULT", o)}));
    EXPECT_EQ(Fx::resultOf(r)["result"], "ACKED") << "and the next one is free to go";
    EXPECT_EQ(f.world->stateOf("P1_FAULT"), "ACTIVE_ACK");
    EXPECT_EQ(f.world->glue->reservations(), 0u);
}

TEST(AlarmsApi, TheAuditRecordIsCommittedBeforeTheStateChanges) {
    Fx f;
    ASSERT_TRUE(f.world->raise("P1.FAULT", "P1_FAULT"));
    const int64_t o = f.occ("P1_FAULT");
    std::thread t([&] {
        const HttpResult r = f.ack("vh1", ackItems({item("P1_FAULT", o)}));
        EXPECT_EQ(r.status, 200) << r.body;
    });
    // poll the audit table and the state together: a state ACTIVE_ACK must never be seen without
    // its record
    bool sawAckWithoutRecord = false;
    const auto end = std::chrono::steady_clock::now() + std::chrono::seconds(3);
    while (std::chrono::steady_clock::now() < end) {
        const bool acked = f.world->stateOf("P1_FAULT") == "ACTIVE_ACK";
        const size_t records = f.records("alarm.ack").size();
        if (acked && records == 0) sawAckWithoutRecord = true;
        if (acked) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    t.join();
    EXPECT_FALSE(sawAckWithoutRecord);
    EXPECT_EQ(f.records("alarm.ack").size(), 1u);
}

TEST(AlarmsApi, TwoRequestsForTheSameOccurrenceAtOnceOneWinsOneAuditRecord) {
    Fx f;
    ASSERT_TRUE(f.world->raise("P1.FAULT", "P1_FAULT"));
    const std::string body = ackItems({item("P1_FAULT", f.occ("P1_FAULT"))}).dump();
    const std::string tokenA = f.bearer("vh1"), tokenB = f.bearer("vh2");
    std::string resA, resB;
    std::thread a([&] {
        resA = Fx::resultOf(f.call(postReq("/api/v1/alarms/ack", body, {tokenA})))["result"];
    });
    std::thread b([&] {
        resB = Fx::resultOf(f.call(postReq("/api/v1/alarms/ack", body, {tokenB})))["result"];
    });
    a.join();
    b.join();
    EXPECT_TRUE((resA == "ACKED" && resB == "ALREADY_ACKED") ||
                (resA == "ALREADY_ACKED" && resB == "ACKED"))
        << resA << " " << resB;
    EXPECT_EQ(f.records("alarm.ack").size(), 1u);
    EXPECT_EQ(f.world->glue->reservations(), 0u);
}

TEST(AlarmsApi, OneAuditRecordForABatchWithAtMostTenIdsAndASmallDetail) {
    AlarmWorldOptions o;
    o.extra = 20;
    Fx f(o);
    std::vector<json> items;
    for (int i = 1; i <= 15; ++i) {
        const std::string id = "X" + AlarmWorld::two(i);
        ASSERT_TRUE(f.world->raise(AlarmWorld::xName(i), id));
        items.push_back(item(id, f.occ(id)));
    }
    const HttpResult r = f.ack("vh1", ackItems(items));
    ASSERT_EQ(r.status, 200) << r.body;
    EXPECT_EQ(bodyJson(r)["acked"], 15);
    const auto rows = f.records("alarm.ack");
    ASSERT_EQ(rows.size(), 1u) << "one line for the batch";
    ASSERT_TRUE(rows[0].detail.has_value());
    EXPECT_LE(rows[0].detail->size(), 1024u);
    const json d = json::parse(*rows[0].detail);
    EXPECT_EQ(d["count"], 15);
    EXPECT_EQ(d["ids"].size(), 10u);
    EXPECT_EQ(rows[0].channel, "https");
    EXPECT_EQ(rows[0].target.value_or("").rfind("items", 0), 0u);
}

TEST(AlarmsApi, ASingleAckNamesTheInstanceTheOccurrenceAndTheStateItLeft) {
    Fx f;
    ASSERT_TRUE(f.world->raise("P1.FAULT", "P1_FAULT"));
    const int64_t o = f.occ("P1_FAULT");
    ASSERT_EQ(f.ack("vh1", ackItems({item("P1_FAULT", o)})).status, 200);
    const auto rows = f.records("alarm.ack");
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].target, std::optional<std::string>("P1_FAULT"));
    const json d = json::parse(rows[0].detail.value_or("{}"));
    EXPECT_EQ(d["occurrence"], o);
    EXPECT_EQ(d["from"], "ACTIVE_UNACK");
    EXPECT_EQ(rows[0].source.rfind("127.0.0.1", 0), 0u);
}

// ---------- the body ----------

TEST(AlarmsApi, WrongBodiesAre400ForTheWholeRequest) {
    Fx f;
    ASSERT_TRUE(f.world->raise("P1.FAULT", "P1_FAULT"));
    const std::string good = ackItems({item("P1_FAULT", f.occ("P1_FAULT"))}).dump();
    std::vector<std::string> bad = {
        "not json",
        "[]",
        R"({"items":[]})",
        R"({"items":[{"id":"P1_FAULT"}]})",
        R"({"items":[{"id":"P1_FAULT","occurrence":0}]})",
        R"({"items":[{"id":"P1_FAULT","occurrence":1.5}]})",
        R"({"items":[{"id":"p 1","occurrence":1}]})",
        R"({"items":[{"id":"P1_FAULT","occurrence":1,"x":1}]})",
        R"({"items":[{"id":"P1_FAULT","occurrence":1},{"id":"P1_FAULT","occurrence":2}]})",
        R"({"items":[{"id":"P1_FAULT","occurrence":1}],"all":true,"upToRevision":1})",
        R"({"items":[{"id":"P1_FAULT","occurrence":1}],"unknown":1})",
        R"({"all":true})",
        R"({"all":false,"upToRevision":1})",
        R"({"all":true,"upToRevision":-1})",
        R"({"all":true,"upToRevision":1,"filter":{"nope":[]}})",
        R"({"all":true,"upToRevision":1,"filter":{"priorities":["urgent"]}})",
        R"({"all":true,"upToRevision":1,"filter":{"states":["NORMAL"]}})",
        R"({"all":true,"upToRevision":1,"items":[]})",
    };
    std::vector<json> many;
    for (int i = 0; i < 101; ++i) many.push_back(item("A" + std::to_string(10 + i), 1));
    bad.push_back(ackItems(many).dump());
    bad.push_back(std::string(R"({"all":true,"upToRevision":1,"filter":{"q":")") +
                  std::string(81, 'a') + "\"}}");
    for (const auto& b : bad) {
        const HttpResult r = f.postAs("vh1", "/api/v1/alarms/ack", b);
        EXPECT_EQ(r.status, 400) << b.substr(0, 80) << " -> " << r.body;
        EXPECT_EQ(bodyJson(r)["error"], "BAD_REQUEST") << b.substr(0, 80);
    }
    EXPECT_EQ(f.world->stateOf("P1_FAULT"), "ACTIVE_UNACK");
    EXPECT_TRUE(f.alarmAudit().empty());
    EXPECT_EQ(f.postAs("vh1", "/api/v1/alarms/ack", good).status, 200);
}

TEST(AlarmsApi, MediaTypeAndSizeAreChecked) {
    Fx f;
    const std::string token = f.bearer("vh1");
    HttpRequest q;
    q.method = "POST";
    q.path = "/api/v1/alarms/ack";
    q.body = R"({"all":true,"upToRevision":0})";
    q.headers = {token, "Content-Type: text/plain"};
    HttpResult r = f.call(q);
    EXPECT_EQ(r.status, 415);
    EXPECT_EQ(bodyJson(r)["error"], "UNSUPPORTED_MEDIA_TYPE");
    q.headers = {token, "Content-Type: application/json; charset=utf-8"};
    EXPECT_EQ(f.call(q).status, 200);
    q.body = std::string(20 * 1024, ' ');
    r = f.call(q);
    EXPECT_EQ(r.status, 413);
    EXPECT_EQ(bodyJson(r)["error"], "BODY_TOO_LARGE");
}

TEST(AlarmsApi, MoreThanTenRequestsASecondForASessionIs429) {
    Fx f;
    const std::string token = f.bearer("vh1");
    int ok = 0, limited = 0;
    json last;
    for (int i = 0; i < 14; ++i) {
        const HttpResult r =
            f.call(postReq("/api/v1/alarms/ack", R"({"all":true,"upToRevision":0})", {token}));
        if (r.status == 200) ++ok;
        if (r.status == 429) {
            ++limited;
            last = bodyJson(r);
        }
    }
    EXPECT_EQ(ok, 10);
    EXPECT_EQ(limited, 4);
    EXPECT_EQ(last["error"], "RATE_LIMITED");
    EXPECT_GT(last["retryAfterMs"].get<int>(), 0);
    // another session is not held back by it, and a second later this one is free again
    EXPECT_EQ(
        f.call(postReq("/api/v1/alarms/ack", R"({"all":true,"upToRevision":0})", {f.bearer("vh2")}))
            .status,
        200);
    f.mono += 2000;
    EXPECT_EQ(
        f.call(postReq("/api/v1/alarms/ack", R"({"all":true,"upToRevision":0})", {token})).status,
        200);
}

TEST(AlarmsApi, AnEngineThatDoesNotRunAnswersAlarmTimeoutAfterTheAudit) {
    AlarmWorldOptions o;
    o.commandWaitMs = 300;
    Fx f(o);
    ASSERT_TRUE(f.world->raise("P1.FAULT", "P1_FAULT"));
    f.world->stopTicker();
    const auto t0 = std::chrono::steady_clock::now();
    const HttpResult r = f.ack("vh1", ackItems({item("P1_FAULT", f.occ("P1_FAULT"))}));
    const auto ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count();
    EXPECT_EQ(r.status, 503);
    EXPECT_EQ(bodyJson(r)["error"], "ALARM_TIMEOUT");
    EXPECT_GE(ms, 250);
    EXPECT_EQ(f.world->glue->reservations(), 0u);
    f.world->startTicker();  // the engine catches up and applies what was handed over
    EXPECT_TRUE(AlarmWorld::waitFor([&] { return f.world->stateOf("P1_FAULT") == "ACTIVE_ACK"; }));
}

// ---------- shelve, unshelve ----------

TEST(AlarmsApi, ShelveRanges) {
    Fx f;
    auto shelve = [&](const json& b) { return f.act("vh1", "shelve", b); };
    auto code = [&](const HttpResult& r) { return bodyJson(r).value("error", ""); };
    auto field = [&](const HttpResult& r) { return bodyJson(r).value("field", ""); };
    HttpResult r = shelve({{"id", "P2_FAULT"}, {"reason", ""}, {"durationS", 600}});
    EXPECT_EQ(r.status, 422);
    EXPECT_EQ(code(r), "SHELVE_RANGE");
    EXPECT_EQ(field(r), "reason");
    r = shelve({{"id", "P2_FAULT"}, {"reason", "   "}, {"durationS", 600}});
    EXPECT_EQ(field(r), "reason") << "spaces only";
    r = shelve({{"id", "P2_FAULT"}, {"reason", std::string(121, 'a')}, {"durationS", 600}});
    EXPECT_EQ(field(r), "reason");
    r = shelve({{"id", "P2_FAULT"}, {"reason", std::string(120, 'a')}, {"durationS", 600}});
    EXPECT_EQ(r.status, 200) << r.body;
    for (int d : {59, 28801, 0, -5}) {
        r = shelve({{"id", "P2_FAULT"}, {"reason", "r"}, {"durationS", d}});
        EXPECT_EQ(r.status, 422) << d;
        EXPECT_EQ(field(r), "durationS") << d;
    }
    for (int d : {60, 28800})
        EXPECT_EQ(shelve({{"id", "P2_FAULT"}, {"reason", "r"}, {"durationS", d}}).status, 200) << d;
    r = shelve({{"id", "NOPE"}, {"reason", "r"}, {"durationS", 60}});
    EXPECT_EQ(r.status, 404);
    EXPECT_EQ(code(r), "ALARM_NOT_FOUND");
    EXPECT_EQ(shelve({{"id", "P2_FAULT"}, {"reason", 5}, {"durationS", 60}}).status, 400);
    EXPECT_EQ(shelve({{"id", "P2_FAULT"}, {"reason", "r"}, {"durationS", "60"}}).status, 400);
    EXPECT_EQ(shelve({{"id", "P2_FAULT"}, {"reason", "r"}, {"durationS", 60}, {"x", 1}}).status,
              400);
}

TEST(AlarmsApi, ShelveHidesRenewsAndUnshelveBringsItBackAsANewOccurrence) {
    Fx f;
    ASSERT_TRUE(f.world->raise("P2.FAULT", "P2_FAULT"));
    const int64_t o = f.occ("P2_FAULT");
    ASSERT_EQ(f.ack("vh1", ackItems({item("P2_FAULT", o)})).status,
              200);  // acknowledged: unshelving makes a new one
    HttpResult r = f.act("vh1", "shelve",
                         {{"id", "P2_FAULT"}, {"reason", "Đang hiệu chuẩn"}, {"durationS", 3600}});
    ASSERT_EQ(r.status, 200) << r.body;
    json b = bodyJson(r);
    EXPECT_EQ(b["id"], "P2_FAULT");
    EXPECT_EQ(b["changed"], true);
    EXPECT_EQ(b["shelved"]["durationS"], 3600);
    EXPECT_EQ(b["shelved"]["reason"], "Đang hiệu chuẩn");
    EXPECT_EQ(b["shelved"]["user"], "vh1");
    EXPECT_EQ(b["shelved"]["system"], false);
    EXPECT_GT(b["shelved"]["until"].get<int64_t>(), AlarmWorld::nowMs());
    EXPECT_EQ(b["counts"]["shelved"], 1);
    EXPECT_EQ(b["counts"]["unack"], 0) << "a shelved instance does not count";
    // renewal: the audit says it replaced one
    r = f.act("vh1", "shelve", {{"id", "P2_FAULT"}, {"reason", "Gia hạn"}, {"durationS", 7200}});
    ASSERT_EQ(r.status, 200);
    auto rows = f.records("alarm.shelve");
    ASSERT_EQ(rows.size(), 2u);
    const json newest = json::parse(rows[0].detail.value_or("{}"));
    EXPECT_EQ(newest["replaced"], true);
    EXPECT_EQ(newest["reason"], "Gia hạn");
    EXPECT_EQ(newest["durationS"], 7200);
    // unshelve: the condition still holds, so it is a NEW occurrence waiting for acknowledgement
    r = f.act("vh1", "unshelve", {{"id", "P2_FAULT"}});
    ASSERT_EQ(r.status, 200) << r.body;
    b = bodyJson(r);
    EXPECT_EQ(b["changed"], true);
    EXPECT_TRUE(b["shelved"].is_null());
    EXPECT_EQ(b["state"], "ACTIVE_UNACK");
    rows = f.records("alarm.unshelve");
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(json::parse(rows[0].detail.value_or("{}"))["cause"], "manual");
    // unshelve of what is not shelved: 200, changed false, no record
    r = f.act("vh1", "unshelve", {{"id", "P2_FAULT"}});
    EXPECT_EQ(r.status, 200);
    EXPECT_EQ(bodyJson(r)["changed"], false);
    EXPECT_EQ(f.records("alarm.unshelve").size(), 1u);
    r = f.act("vh1", "unshelve", {{"id", "NOPE"}});
    EXPECT_EQ(r.status, 404);
}

TEST(AlarmsApi, AnInstanceThatIsNormalCanBeShelvedAheadOfTime) {
    Fx f;
    HttpResult r =
        f.act("vh1", "shelve", {{"id", "P2_FAULT"}, {"reason", "bảo trì"}, {"durationS", 600}});
    ASSERT_EQ(r.status, 200) << r.body;
    EXPECT_EQ(bodyJson(r)["state"], "NORMAL");
    f.world->setBool("P2.FAULT", true);
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    const json list = bodyJson(f.callHttp(getReq("/api/v1/alarms")));
    ASSERT_EQ(list["instances"].size(), 1u);
    EXPECT_TRUE(list["instances"][0].contains("shelved"));
    EXPECT_EQ(list["counts"]["unack"], 0);
    EXPECT_EQ(list["counts"]["shelved"], 1);
}

TEST(AlarmsApi, AtMost50ShelvedAtOnce) {
    AlarmWorldOptions o;
    o.extra = 55;
    o.commandWaitMs = 3000;
    Fx f(o);
    const std::string token = f.bearer("vh1");
    for (int i = 1; i <= 50; ++i) {
        // the rate limit is per session: a second token every ten requests, as a page would not
        if (i % 9 == 0) f.mono += 2000;
        const HttpResult r = f.call(postReq(
            "/api/v1/alarms/shelve",
            json{{"id", "X" + AlarmWorld::two(i)}, {"reason", "r"}, {"durationS", 600}}.dump(),
            {token}));
        ASSERT_EQ(r.status, 200) << i << " " << r.body;
    }
    f.mono += 2000;
    HttpResult r =
        f.call(postReq("/api/v1/alarms/shelve",
                       json{{"id", "X51"}, {"reason", "r"}, {"durationS", 600}}.dump(), {token}));
    EXPECT_EQ(r.status, 422);
    EXPECT_EQ(bodyJson(r)["error"], "SHELVE_RANGE");
    EXPECT_EQ(bodyJson(r)["field"], "limit");
    // renewing one of the 50 is not a new one
    r = f.call(postReq("/api/v1/alarms/shelve",
                       json{{"id", "X01"}, {"reason", "r2"}, {"durationS", 900}}.dump(), {token}));
    EXPECT_EQ(r.status, 200) << r.body;
    // giving one back makes room
    f.mono += 2000;
    EXPECT_EQ(f.call(postReq("/api/v1/alarms/unshelve", R"({"id":"X02"})", {token})).status, 200);
    r = f.call(postReq("/api/v1/alarms/shelve",
                       json{{"id", "X51"}, {"reason", "r"}, {"durationS", 600}}.dump(), {token}));
    EXPECT_EQ(r.status, 200) << r.body;
}

// ---------- disable, enable ----------

TEST(AlarmsApi, DisableClosesTheOpenOccurrenceAndEnableStartsAgain) {
    Fx f;
    ASSERT_TRUE(f.world->raise("P2.FAULT", "P2_FAULT"));
    const int64_t o = f.occ("P2_FAULT");
    HttpResult r =
        f.act("kysu1", "disable", {{"id", "P2_FAULT"}, {"reason", "Cảm biến hỏng, chờ thay"}});
    ASSERT_EQ(r.status, 200) << r.body;
    json b = bodyJson(r);
    EXPECT_EQ(b["disabled"], true);
    EXPECT_EQ(b["state"], "NORMAL");
    EXPECT_EQ(b["changed"], true);
    EXPECT_EQ(b["counts"]["disabled"], 1);
    auto rows = f.records("alarm.disable");
    ASSERT_EQ(rows.size(), 1u);
    const json d = json::parse(rows[0].detail.value_or("{}"));
    EXPECT_EQ(d["reason"], "Cảm biến hỏng, chờ thay");
    EXPECT_EQ(d["closedOccurrence"], o);
    EXPECT_EQ(rows[0].channel, "https");
    // idempotent: no record
    r = f.act("kysu1", "disable", {{"id", "P2_FAULT"}, {"reason", "again"}});
    EXPECT_EQ(r.status, 200);
    EXPECT_EQ(bodyJson(r)["changed"], false);
    EXPECT_EQ(f.records("alarm.disable").size(), 1u);
    // shelving a disabled instance: 409
    r = f.act("vh1", "shelve", {{"id", "P2_FAULT"}, {"reason", "r"}, {"durationS", 60}});
    EXPECT_EQ(r.status, 409);
    EXPECT_EQ(bodyJson(r)["error"], "ALARM_DISABLED");
    // the reason is required
    EXPECT_EQ(f.act("kysu1", "disable", {{"id", "P1_FAULT"}}).status, 400);
    EXPECT_EQ(f.act("kysu1", "disable", {{"id", "P1_FAULT"}, {"reason", ""}}).status, 400);
    EXPECT_EQ(f.act("kysu1", "disable", {{"id", "NOPE"}, {"reason", "r"}}).status, 404);
    // enable
    r = f.act("kysu1", "enable", {{"id", "P2_FAULT"}});
    ASSERT_EQ(r.status, 200) << r.body;
    b = bodyJson(r);
    EXPECT_EQ(b["disabled"], false);
    EXPECT_EQ(b["changed"], true);
    EXPECT_EQ(f.records("alarm.enable").size(), 1u);
    ASSERT_TRUE(AlarmWorld::waitFor([&] { return f.world->stateOf("P2_FAULT") == "ACTIVE_UNACK"; }))
        << "the condition still holds: evaluated afresh";
    r = f.act("kysu1", "enable", {{"id", "P2_FAULT"}});
    EXPECT_EQ(bodyJson(r)["changed"], false);
    EXPECT_EQ(f.records("alarm.enable").size(), 1u);
}

// ---------- system/info and identity ----------

TEST(AlarmsApi, SystemInfoHasTheBlockAndIdentityTheFeature) {
    Fx f;
    ASSERT_TRUE(f.world->raise("P1.FAULT", "P1_FAULT"));
    json info = bodyJson(f.callHttp(getReq("/api/v1/system/info")));
    ASSERT_TRUE(info.contains("alarms")) << info.dump();
    const json& a = info["alarms"];
    EXPECT_EQ(a["instances"], 5);  // TANK_LEVEL.HH, .H, P1_FAULT, P2_FAULT, P3_INFO
    EXPECT_EQ(a["active"], 1);
    EXPECT_EQ(a["unacked"], 1);
    EXPECT_EQ(a["shelved"], 0);
    EXPECT_EQ(a["disabled"], 0);
    EXPECT_TRUE(a["logState"] == "running" || a["logState"] == "paused" ||
                a["logState"] == "error");
    EXPECT_TRUE(a.contains("droppedChanges"));
    EXPECT_TRUE(a.contains("dbBytes"));
    EXPECT_TRUE(a.contains("evalMaxMs"));
    EXPECT_EQ(a["evalWindowS"], 60);
    const json ident = bodyJson(f.call(getReq("/api/v1/device/identity")));
    bool has = false;
    for (const auto& x : ident["features"]) has = has || x == "alarms";
    EXPECT_TRUE(has) << ident.dump();
}

// Feature 013 (contracts/access-model.md §4, alarm(P)): the counts are those of the alarms the
// person may see, wherever they are given: the list, the live snapshot and changes (countsFor), the
// answer of a command and the block of system/info. No filter: the engine's counts.
TEST(AlarmsApi, TheCountsAreOnlyOfTheAlarmsThePersonMaySee) {
    Fx f;
    ASSERT_TRUE(f.world->raise("P1.FAULT", "P1_FAULT"));
    ASSERT_TRUE(f.world->raise("P2.FAULT", "P2_FAULT"));
    const AlarmIdFilter onlyP1 = [](const std::string& id) { return id == "P1_FAULT"; };
    AlarmGlue& g = *f.world->glue;
    const json all = g.listJson(true);
    EXPECT_EQ(all["counts"]["active"], 2);
    EXPECT_EQ(g.listJson(true, [](const std::string&) { return true; })["counts"], all["counts"])
        << "a filter that keeps everything counts as the engine";
    const json mine = g.listJson(true, onlyP1);
    ASSERT_EQ(mine["instances"].size(), 1u);
    EXPECT_EQ(mine["instances"][0]["id"], "P1_FAULT");
    EXPECT_EQ(mine["counts"]["active"], 1);
    EXPECT_EQ(mine["counts"]["unack"], 1);
    EXPECT_EQ(mine["counts"]["byPriority"]["critical"]["active"], 1);
    EXPECT_EQ(mine["counts"]["byPriority"]["minor"]["active"], 0);
    EXPECT_EQ(mine["counts"]["byPriority"]["minor"]["unack"], 0);

    const AlarmLiveSnapshot s = g.snapshot(true);
    ASSERT_TRUE(s.countsFor);
    EXPECT_EQ(json::parse(s.countsFor(onlyP1)), mine["counts"]);
    EXPECT_EQ(json::parse(s.counts), all["counts"]);

    json info = g.infoJson(onlyP1);
    EXPECT_EQ(info["instances"], 1);
    EXPECT_EQ(info["active"], 1);
    EXPECT_EQ(info["unacked"], 1);
    EXPECT_EQ(g.infoJson()["instances"], 5);

    AlarmActor who;
    who.user = "vh1";
    who.role = "operator";
    who.source = "127.0.0.1:1";
    who.allowed = onlyP1;
    AckSpec spec;
    spec.all = true;
    spec.upToRevision = all["revision"].get<int64_t>() + 1000;
    const AlarmApiResult r = g.ack(spec, who);
    ASSERT_EQ(r.status, 200) << r.body.dump();
    EXPECT_EQ(r.body["acked"], 1);
    EXPECT_EQ(r.body["counts"]["active"], 1) << "P2_FAULT is not counted";
    EXPECT_EQ(r.body["counts"]["unack"], 0);
    const AlarmApiResult u = g.unshelve("P1_FAULT", who);
    ASSERT_EQ(u.status, 200) << u.body.dump();
    EXPECT_EQ(u.body["counts"]["active"], 1);
    EXPECT_EQ(u.body["counts"]["byPriority"]["minor"]["active"], 0);

    info = g.infoJson(onlyP1);
    EXPECT_EQ(info["unacked"], 0);
    EXPECT_EQ(g.infoJson()["unacked"], 1);

    g.takeChanges();
    ASSERT_TRUE(f.world->raise("P3.INFO", "P3_INFO", "ACTIVE_ACK"));
    const AlarmLiveBatch b = g.takeChanges();
    ASSERT_FALSE(b.changes.empty());
    ASSERT_TRUE(b.countsFor);
    EXPECT_EQ(json::parse(b.countsFor(onlyP1))["active"], 1);
    EXPECT_EQ(json::parse(b.counts)["active"], 3);
}

TEST(AlarmsApi, SystemInfoOfAProjectWithoutAlarmsStillHasTheBlockWithZeros) {
    AlarmWorldOptions o;
    o.withAlarms = false;
    Fx f(o);
    const json info = bodyJson(f.callHttp(getReq("/api/v1/system/info")));
    ASSERT_TRUE(info.contains("alarms"));
    EXPECT_EQ(info["alarms"]["instances"], 0);
    EXPECT_EQ(info["alarms"]["active"], 0);
}
