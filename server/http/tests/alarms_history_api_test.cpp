// T090 (feature 009; FR-053; contracts/device-api-1.3.md §2.2): GET /api/v1/alarms/history on the
// two listeners of mat-runtime in process: the parameters and their 400 BAD_QUERY with the field,
// the paging by nextBeforeId, the rights (a viewer reads, the source filter of ADR-018 applies, a
// session opens the door from anywhere), one query at a time per source (429), a log that cannot be
// read (503 ALARM_LOG_UNAVAILABLE) and a project without alarms (an empty page).
#include <gtest/gtest.h>

#include <cstdio>
#include <set>
#include <thread>

#include "core/alarm/alarm_text.hpp"
#include "server/tests/alarm_rig.hpp"

using namespace mat;
using namespace mat::test;
using nlohmann::json;

namespace {

constexpr int64_t kMin = 60000, kHour = 3600000, kDay = 24 * kHour;

// A closed occurrence of the project of AlarmWorld.
alarm::OccurrenceRow row(int64_t id, const std::string& alarm, int64_t ts, int priority,
                         const std::string& cls, std::optional<std::string> area,
                         const std::string& text, bool closed = true) {
    alarm::OccurrenceRow r;
    r.id = id;
    r.alarmId = alarm;
    r.fingerprint = "0123456789abcdef";
    r.tsActiveMs = ts;
    r.priority = priority;
    r.classId = cls;
    r.area = area;
    r.text = text;
    r.textFold = alarm::foldText(text + " " + alarm + " " + (area ? *area : "Chung"));
    r.valueActive = 91.2;
    r.closed = closed;
    if (closed) {
        r.closedBy = alarm::ClosedBy::Return;
        r.tsReturnMs = ts + kMin;
    }
    return r;
}

// 250 closed occurrences over two days, written before the engine starts.
void fill(const std::string& dir) {
    int64_t now = AlarmWorld::nowMs();
    alarm::AlarmStore store(dir, [&] { return now; });
    std::string err;
    ASSERT_TRUE(store.open(err)) << err;
    std::vector<alarm::OccurrenceRow> rows;
    for (int i = 1; i <= 250; ++i) {
        const bool tank = i % 2 == 0;
        rows.push_back(row(i, tank ? "TANK_LEVEL.HH" : "P1_FAULT", now - 2 * kDay + int64_t(i) * 10 * kMin,
                           tank ? 1 : 2, tank ? "critical" : "minor", tank ? std::optional<std::string>("bon")
                                                                           : std::nullopt,
                           tank ? "Mức bồn rất cao" : "Bơm 1 lỗi"));
    }
    ASSERT_TRUE(store.commit(rows, {}, {}, err)) << err;
    store.close(true);
}

struct Fx : AlarmRig {
    explicit Fx(AlarmWorldOptions o = defaults(), bool publicSource = false) : AlarmRig(o) {
        servePage(publicSource);
    }
    static AlarmWorldOptions defaults() {
        AlarmWorldOptions o;
        o.prepare = fill;
        return o;
    }
    HttpResult history(const std::string& query) {
        return callHttp(getReq("/api/v1/alarms/history" + (query.empty() ? "" : "?" + query)));
    }
    json items(const std::string& query) { return bodyJson(history(query))["items"]; }
    HttpResult ack(const std::string& user, const json& body) {
        return postAs(user, "/api/v1/alarms/ack", body.dump());
    }
};

}  // namespace

TEST(AlarmsHistoryApi, DefaultIsTheLastDayNewestFirstWithTheFieldsOfTheContract) {
    Fx f;
    const HttpResult r = f.history("");
    ASSERT_EQ(r.status, 200) << r.body;
    const json b = bodyJson(r);
    EXPECT_EQ(b["limit"], 100);
    EXPECT_TRUE(b.contains("hasMore"));
    EXPECT_TRUE(b.contains("nextBeforeId"));
    EXPECT_GT(b["ts"].get<int64_t>(), 0);
    ASSERT_FALSE(b["items"].empty());
    const json& i = b["items"][0];
    EXPECT_EQ(i["id"], 250) << "the newest occurrence";
    EXPECT_EQ(i["alarmId"], "TANK_LEVEL.HH");
    EXPECT_EQ(i["name"], "Mức bồn") << "the name of the definition, as the project says now";
    EXPECT_EQ(i["class"], "critical");
    EXPECT_EQ(i["priority"], "critical");
    EXPECT_EQ(i["area"], "bon");
    EXPECT_EQ(i["text"], "Mức bồn rất cao");
    EXPECT_DOUBLE_EQ(i["valueActive"].get<double>(), 91.2);
    EXPECT_EQ(i["qualityActive"], "GOOD");
    EXPECT_TRUE(i["reason"].is_null());
    EXPECT_EQ(i["clockOk"], true);
    EXPECT_TRUE(i["tsAck"].is_null());
    EXPECT_TRUE(i["ackUser"].is_null());
    EXPECT_FALSE(i["tsReturn"].is_null());
    EXPECT_EQ(i["flags"]["startup"], false);
    EXPECT_EQ(i["flags"]["inputBad"], false);
    EXPECT_EQ(i["closedBy"], "return");
    EXPECT_EQ(i["state"], "closed");
    // the last day only: 250 rows over two days, one every ten minutes
    EXPECT_LE(b["items"].size(), 100u);
    for (const json& x : b["items"]) EXPECT_GE(x["tsActive"].get<int64_t>(), AlarmWorld::nowMs() - kDay - kMin);
    // the rows of the first page are newest first
    int64_t prev = INT64_MAX;
    for (const json& x : b["items"]) {
        EXPECT_LT(x["id"].get<int64_t>(), prev);
        prev = x["id"];
    }
}

TEST(AlarmsHistoryApi, PagingByNextBeforeIdHasNoDuplicateAndNoGap) {
    Fx f;
    const int64_t now = AlarmWorld::nowMs();
    std::set<int64_t> seen;
    std::string query = "from=" + std::to_string(now - 3 * kDay) + "&to=" + std::to_string(now + kMin) + "&limit=40";
    int pages = 0;
    for (;;) {
        const json b = bodyJson(f.history(query));
        for (const json& x : b["items"]) EXPECT_TRUE(seen.insert(x["id"].get<int64_t>()).second) << x["id"];
        ++pages;
        if (!b["hasMore"].get<bool>()) {
            EXPECT_TRUE(b["nextBeforeId"].is_null());
            break;
        }
        ASSERT_FALSE(b["nextBeforeId"].is_null());
        query = "from=" + std::to_string(now - 3 * kDay) + "&to=" + std::to_string(now + kMin) +
                "&limit=40&beforeId=" + std::to_string(b["nextBeforeId"].get<int64_t>());
        ASSERT_LT(pages, 20);
    }
    EXPECT_EQ(seen.size(), 250u);
    EXPECT_EQ(pages, 7);
}

TEST(AlarmsHistoryApi, Filters) {
    Fx f;
    const std::string range = "from=" + std::to_string(AlarmWorld::nowMs() - 3 * kDay) + "&to=" +
                              std::to_string(AlarmWorld::nowMs() + kMin) + "&limit=500";
    EXPECT_EQ(f.items(range).size(), 250u);
    EXPECT_EQ(f.items(range + "&alarmId=TANK_LEVEL.HH").size(), 125u);
    EXPECT_EQ(f.items(range + "&alarmId=TANK_LEVEL").size(), 125u) << "a definition matches its thresholds";
    EXPECT_EQ(f.items(range + "&alarmId=P1_FAULT").size(), 125u);
    EXPECT_EQ(f.items(range + "&area=bon").size(), 125u);
    EXPECT_EQ(f.items(range + "&area=-").size(), 125u) << "- is Chung";
    EXPECT_EQ(f.items(range + "&class=critical").size(), 125u);
    EXPECT_EQ(f.items(range + "&priority=critical").size(), 125u);
    EXPECT_EQ(f.items(range + "&priority=major").size(), 250u) << "major or higher: the critical and the major";
    EXPECT_EQ(f.items(range + "&priority=minor").size(), 250u);
    EXPECT_EQ(f.items(range + "&state=closed").size(), 250u);
    EXPECT_EQ(f.items(range + "&state=active").size(), 0u);
    EXPECT_EQ(f.items(range + "&state=acked").size(), 0u);
    EXPECT_EQ(f.items(range + "&q=bon").size(), 125u) << "area name and text, no marks";
    EXPECT_EQ(f.items(range + "&q=B%C6%A1m%201").size(), 125u) << "percent encoded UTF-8 (Bơm 1)";
    EXPECT_EQ(f.items(range + "&q=%25").size(), 0u) << "a percent sign is text";
    EXPECT_EQ(f.items(range + "&q=%27%3B+DROP+TABLE+alarm_occurrence%3B+--").size(), 0u);
    EXPECT_EQ(f.items(range).size(), 250u) << "and the table is still there";
}

TEST(AlarmsHistoryApi, WrongParametersAre400BadQueryWithTheField) {
    Fx f;
    const int64_t now = AlarmWorld::nowMs();
    struct Case {
        std::string query, field;
    };
    const std::vector<Case> cases = {
        {"from=abc", "from"},
        {"to=-5", "to"},
        {"from=" + std::to_string(now) + "&to=" + std::to_string(now), "from"},
        {"from=" + std::to_string(now - 367 * kDay) + "&to=" + std::to_string(now), "from"},
        {"limit=0", "limit"},
        {"limit=501", "limit"},
        {"limit=x", "limit"},
        {"state=open", "state"},
        {"priority=urgent", "priority"},
        {"beforeId=0", "beforeId"},
        {"beforeId=99999", "beforeId"},
        {"beforeId=abc", "beforeId"},
        {"alarmId=bad%20id", "alarmId"},
        {"alarmId=" + std::string(60, 'A'), "alarmId"},
        {"area=a%27b", "area"},
        {"class=", "class"},
        {"q=" + std::string(81, 'a'), "q"},
        {"unsynced=2", "unsynced"},
        {"bogus=1", "bogus"},
        {"limit=5&limit=6", "limit"},
        {"q=%zz", "q"},
        {"q=%FF%FE", "q"},
    };
    for (const auto& c : cases) {
        const HttpResult r = f.history(c.query);
        EXPECT_EQ(r.status, 400) << c.query << " -> " << r.body;
        const json b = bodyJson(r);
        EXPECT_EQ(b["error"], "BAD_QUERY") << c.query;
        EXPECT_EQ(b["field"], c.field) << c.query;
        EXPECT_TRUE(b["message"].is_string()) << c.query;
    }
    EXPECT_EQ(f.history("limit=500").status, 200);
    EXPECT_EQ(f.history("from=" + std::to_string(now - 366 * kDay) + "&to=" + std::to_string(now)).status, 200);
    EXPECT_EQ(f.callHttp(getReq("/api/v1/alarms/history?" + std::string(3000, 'a'))).status, 400);
    EXPECT_EQ(f.callHttp(postReq("/api/v1/alarms/history", "{}")).status, 405);
}

TEST(AlarmsHistoryApi, WhoMayReadItTheSourceFilterAndTheSessions) {
    {
        Fx f;  // a private source, no sign-in: a guest of the LAN reads
        EXPECT_EQ(f.history("limit=1").status, 200);
        EXPECT_EQ(f.getAs("xem1", "/api/v1/alarms/history?limit=1").status, 200) << "a viewer, Bearer over HTTPS";
        const AlarmRig::Session s = f.webSession("vh1");
        EXPECT_EQ(f.getWeb(s, "/api/v1/alarms/history?limit=1").status, 200) << "the cookie of the page";
    }
    {
        Fx f(Fx::defaults(), /*publicSource=*/true);  // the filter sees a source outside the LAN
        const HttpResult r = f.history("limit=1");
        EXPECT_EQ(r.status, 403) << r.body;
        EXPECT_EQ(bodyJson(r)["error"], "SOURCE_NOT_ALLOWED");
        EXPECT_EQ(f.callHttp(getReq("/api/v1/alarms")).status, 403) << "the list as well";
        // a session opens the door from anywhere (ADR-018)
        EXPECT_EQ(f.getAs("xem1", "/api/v1/alarms/history?limit=1").status, 200);
        const AlarmRig::Session s = f.webSession("xem1");
        EXPECT_EQ(f.getWeb(s, "/api/v1/alarms/history?limit=1").status, 200);
    }
}

TEST(AlarmsHistoryApi, OneQueryAtATimeForASourceTheSecondIs429) {
    AlarmWorldOptions o = Fx::defaults();
    o.history.testQueryDelayMs = 700;
    Fx f(o);
    HttpResult slow;
    std::thread t([&] { slow = f.history("limit=5"); });
    std::this_thread::sleep_for(std::chrono::milliseconds(250));
    const HttpResult second = f.history("limit=5");
    EXPECT_EQ(second.status, 429) << second.body;
    EXPECT_EQ(bodyJson(second)["error"], "RATE_LIMITED");
    t.join();
    EXPECT_EQ(slow.status, 200);
    EXPECT_EQ(f.history("limit=5").status, 200) << "free again";
}

TEST(AlarmsHistoryApi, ALogThatCannotBeReadIs503AndAProjectWithoutAlarmsHasAnEmptyHistory) {
    {
        Fx f;
        ASSERT_EQ(f.history("limit=1").status, 200);
        f.world->glue->service()->flush(2000);
        f.world->stopTicker();
        f.world->glue->stop();  // closes alarm.db clean
        for (const char* suffix : {"", "-wal", "-shm"}) std::remove((f.dataDir + "/alarm.db" + suffix).c_str());
        const HttpResult r = f.history("limit=1");
        EXPECT_EQ(r.status, 503) << r.body;
        EXPECT_EQ(bodyJson(r)["error"], "ALARM_LOG_UNAVAILABLE");
    }
    {
        AlarmWorldOptions o;
        o.withAlarms = false;
        Fx f(o);
        const HttpResult r = f.history("");
        ASSERT_EQ(r.status, 200) << r.body;
        EXPECT_TRUE(bodyJson(r)["items"].empty());
        EXPECT_FALSE(bodyJson(r)["hasMore"].get<bool>());
    }
}

TEST(AlarmsHistoryApi, AnOccurrenceTheEngineWritesShowsUpWithItsAcknowledgement) {
    AlarmWorldOptions o;  // an empty alarm.db: the occurrence is the engine's
    Fx f(o);
    ASSERT_TRUE(f.world->raise("P1.FAULT", "P1_FAULT"));
    const int64_t occ = f.world->occurrenceOf("P1_FAULT");
    ASSERT_EQ(f.ack("vh1", json{{"items", json::array({json{{"id", "P1_FAULT"}, {"occurrence", occ}}})}}).status, 200);
    ASSERT_TRUE(f.world->glue->service()->flush(3000));
    const json b = bodyJson(f.history(""));
    ASSERT_EQ(b["items"].size(), 1u) << b.dump();
    const json& i = b["items"][0];
    EXPECT_EQ(i["id"], occ);
    EXPECT_EQ(i["alarmId"], "P1_FAULT");
    EXPECT_EQ(i["ackUser"], "vh1");
    EXPECT_FALSE(i["tsAck"].is_null());
    EXPECT_EQ(i["state"], "active");
    EXPECT_TRUE(i["closedBy"].is_null());
    EXPECT_EQ(bodyJson(f.history("state=acked"))["items"].size(), 1u);
    EXPECT_EQ(bodyJson(f.history("state=closed"))["items"].size(), 0u);
}
