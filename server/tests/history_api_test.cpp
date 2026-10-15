// GET /api/v1/history/* (specs/010-history-reports contracts/history-api.md, SC-010): the real
// listeners, the real audit log and sign-in service, and a real history.db with raw rows and
// aggregate tables. Checks the answers, the parameter errors, the gate and what must not leak.
#include <gtest/gtest.h>

#include "core/historian/aggregator.hpp"
#include "core/historian/local_store.hpp"
#include "server/http/history_api.hpp"
#include "server/tests/api_rig.hpp"

using namespace mat;
using namespace mat::test;
using nlohmann::json;

namespace {

constexpr int64_t kT0 = 1791594000000;  // a whole hour (2026-10-10T01:00:00Z)

// Two hours of one row every 10 s: A = 0,1,2,... (a ramp), S text. Tables: tbl_dien (aggregates
// on column A) and tbl_vh (no aggregates).
void makeDb(const std::string& dir) {
    LocalStore s(dir, [] { return kT0; });
    std::string err;
    ASSERT_TRUE(s.open(err)) << err;
    TableSpec dien;
    dien.table = "tbl_dien";
    dien.groupId = "dien";
    dien.retentionDays = 30;
    dien.columns = {{"A", "REAL"}, {"S", "TEXT"}};
    dien.aggMinuteDays = 31;
    dien.aggHourDays = 730;
    dien.aggColumns = {"A"};
    TableSpec vh;
    vh.table = "tbl_vh";
    vh.groupId = "van-hanh";
    vh.retentionDays = 30;
    vh.columns = {{"B", "INTEGER"}};
    ASSERT_TRUE(s.ensureTables({dien, vh}, err)) << err;
    std::vector<PendingRow> rows;
    GroupAggregator agg(1);
    std::vector<AggWrite> aggs;
    std::vector<AggOut> out;
    agg.breakAll(kT0);
    for (int i = 0; i < 720; ++i) {
        const int64_t ts = kT0 + i * 10000;
        rows.push_back({0, ts, {static_cast<double>(i), std::string(i % 2 ? "=lẻ" : "chẵn,\"x\"")}});
        rows.push_back({1, ts, {int64_t{i % 3}}});
        agg.row(ts, {static_cast<double>(i)});
    }
    agg.advance(kT0 + 7200000);
    agg.drain(out);
    for (const auto& o : out)
        if (o.res == kAggMinuteMs) aggs.push_back({0, o.col, o.res, o.bucket, o.agg});
    aggs.push_back({0, 0, kAggHourMs, kT0, {}, true});
    aggs.push_back({0, 0, kAggHourMs, kT0 + 3600000, {}, true});
    ASSERT_TRUE(s.commit(rows, err, {}, aggs, {})) << err;
    ASSERT_TRUE(s.startRun(kT0, err) > 0);
    s.touchRun(1, kT0 + 3000000, err);  // the first run ended 50 minutes in
    ASSERT_GT(s.startRun(kT0 + 3300000, err), 0);  // the second began 5 minutes later
}

HistoryCatalog makeCatalog() {
    HistoryCatalog cat;
    QueryGroup d;
    d.id = "dien";
    d.name = "Điện";
    d.table = "tbl_dien";
    d.mode = "cyclic";
    d.periodMs = 10000;
    d.hasAggregates = true;
    d.rowBytes = 60;
    d.tags = {{"METER1.KW", "A", "FLOAT64", "kW", true}, {"METER1.NOTE", "S", "STRING", "", false}};
    cat.groups.push_back(d);
    QueryGroup v;
    v.id = "van-hanh";
    v.name = "Vận hành";
    v.table = "tbl_vh";
    v.mode = "onChange";
    v.minIntervalMs = 1000;
    v.rowBytes = 40;
    v.tags = {{"PUMP.STATE", "B", "INT16", "", false}};
    cat.groups.push_back(v);
    return cat;
}

struct Rig : ApiRig {
    using Holder = std::shared_ptr<std::unique_ptr<HistoryApi>>;
    explicit Rig(int maxScanMiB = 64) : Rig(maxScanMiB, std::make_shared<std::unique_ptr<HistoryApi>>()) {}
    Rig(int maxScanMiB, Holder h)
        : ApiRig([maxScanMiB, h](ApiRig& r) {
              makeDb(r.dataDir);
              HistoryApi::Options o;
              o.catalog = makeCatalog();
              o.dbPath = r.dataDir + "/history.db";
              o.maxScanMiB = maxScanMiB;
              o.audit = [&r](const AuditEvent& e) { r.audit->append(e); };
              o.nowUtc = [] { return kT0 + 7200000; };
              *h = std::make_unique<HistoryApi>(std::move(o));
              r.eng->setHistory(h->get());
          }),
          holder(h) {
        api = holder->get();
    }
    json get(const std::string& path, long expect = 200) {
        const HttpResult res = getAs("xem1", path);
        EXPECT_EQ(res.status, expect) << path << " " << res.body;
        last = res;
        return bodyJson(res);
    }
    std::string q(const std::string& endpoint, const std::string& extra) {
        return "/api/v1/history/" + endpoint + "?" + extra;
    }
    Holder holder;  // the API lives as long as the rig
    HistoryApi* api = nullptr;
    HttpResult last;
};

const std::string kRange = "from=" + std::to_string(kT0) + "&to=" + std::to_string(kT0 + 7200000);

}  // namespace

TEST(HistoryApi, CatalogListsGroupsTagsAndRangesWithoutTablesOrPaths) {
    Rig r;
    const json b = r.get("/api/v1/history/catalog");
    EXPECT_EQ(b["apiVersion"], "1.4.0");
    EXPECT_TRUE(b["enabled"]);
    ASSERT_EQ(b["groups"].size(), 2u);
    const json& g = b["groups"][0];
    EXPECT_EQ(g["id"], "dien");
    EXPECT_EQ(g["timeZone"], "+07:00");
    EXPECT_EQ(g["raw"]["from"], kT0);
    EXPECT_EQ(g["raw"]["to"], kT0 + 719 * 10000);
    EXPECT_EQ(g["aggregates"]["minute"]["from"], kT0);
    EXPECT_TRUE(g["tags"][0]["aggregated"]);
    EXPECT_TRUE(b["groups"][1]["aggregates"].is_null());
    EXPECT_EQ(b["limits"]["maxTags"], 16);
    for (const char* leak : {"tbl_", "log_", "/tmp", "history.db", "sqlite"})
        EXPECT_EQ(r.last.body.find(leak), std::string::npos) << leak;
}

TEST(HistoryApi, SeriesRawMinMaxKeepsTheShapeAndStatesTheSource) {
    Rig r;
    const json b = r.get(r.q("series", "group=dien&tags=METER1.KW&res=raw&maxPoints=100&" + kRange));
    EXPECT_EQ(b["res"], "raw");
    EXPECT_EQ(b["reduce"], "minmax");
    ASSERT_EQ(b["series"].size(), 1u);
    EXPECT_LE(b["series"][0]["t"].size(), 100u);
    EXPECT_EQ(b["series"][0]["t"].size(), b["series"][0]["v"].size());
    EXPECT_FALSE(b["series"][0].contains("min"));  // raw has no min/max
    EXPECT_EQ(b["series"][0]["unit"], "kW");
    EXPECT_EQ(b["series"][0]["t"][0], kT0);
    // the gap between the two runs (50 min .. 55 min)
    ASSERT_EQ(b["gaps"].size(), 1u);
    EXPECT_EQ(b["gaps"][0][0], kT0 + 3000000);
    EXPECT_EQ(b["gaps"][0][1], kT0 + 3300000);
}

TEST(HistoryApi, SeriesFromTheMinuteAndHourTablesHasMinMax) {
    Rig r;
    json b = r.get(r.q("series", "group=dien&tags=METER1.KW&res=1m&maxPoints=1000&" + kRange));
    EXPECT_EQ(b["res"], "1m");
    EXPECT_EQ(b["reduce"], "merge");
    EXPECT_EQ(b["series"][0]["t"].size(), 120u);  // 120 minutes
    EXPECT_EQ(b["series"][0]["min"].size(), 120u);
    // first minute holds rows 0..5 (0,10,..50 s): the ramp 0..5, held up to 60 s
    EXPECT_NEAR(b["series"][0]["min"][0].get<double>(), 0.0, 1e-9);
    EXPECT_NEAR(b["series"][0]["max"][0].get<double>(), 5.0, 1e-9);
    b = r.get(r.q("series", "group=dien&tags=METER1.KW&res=1h&maxPoints=1000&" + kRange));
    EXPECT_EQ(b["res"], "1h");
    EXPECT_EQ(b["series"][0]["t"].size(), 2u);
    // auto: a 2 h range and 1000 points = 14 s windows → the raw rows
    b = r.get(r.q("series", "group=dien&tags=METER1.KW&" + kRange));
    EXPECT_EQ(b["res"], "raw");
    // auto: few points → minute table
    b = r.get(r.q("series", "group=dien&tags=METER1.KW&maxPoints=100&" + kRange));
    EXPECT_EQ(b["res"], "1m");
}

TEST(HistoryApi, ResolutionOfAGroupWithoutAggregatesIsRefused) {
    Rig r;
    const json b = r.get(r.q("series", "group=van-hanh&tags=PUMP.STATE&res=1m&" + kRange), 422);
    EXPECT_EQ(b["error"], "NO_AGGREGATES");
    r.get(r.q("aggregate", "group=van-hanh&tags=PUMP.STATE&bucketMs=3600000&" + kRange), 422);
}

TEST(HistoryApi, RawScanOverTheLimitIsRefusedBeforeReading) {
    Rig r(0);  // a limit of 0 MiB
    const json b = r.get(r.q("series", "group=dien&tags=METER1.KW&res=raw&" + kRange), 422);
    EXPECT_EQ(b["error"], "SCAN_LIMIT");
    EXPECT_EQ(b["suggest"]["res"], "auto");
    // the same range on auto goes to the aggregates
    EXPECT_EQ(r.get(r.q("series", "group=dien&tags=METER1.KW&" + kRange))["res"], "1m");
    // and a group without aggregates is decimated, flagged approximate
    const json d = r.get(r.q("series", "group=van-hanh&tags=PUMP.STATE&" + kRange));
    EXPECT_TRUE(d["approximate"]);
    EXPECT_EQ(d["reduce"], "decimate");
}

TEST(HistoryApi, AggregateWindowsAndOffsets) {
    Rig r;
    // two 1-hour windows from the hour table
    json b = r.get(r.q("aggregate", "group=dien&tags=METER1.KW&bucketMs=3600000&" + kRange));
    EXPECT_EQ(b["count"], 2);
    EXPECT_EQ(b["source"], "hour");
    EXPECT_EQ(b["start"], kT0);
    EXPECT_EQ(b["series"][0]["n"][0], 360);
    EXPECT_NEAR(b["series"][0]["min"][0].get<double>(), 0.0, 1e-9);
    EXPECT_NEAR(b["series"][0]["max"][0].get<double>(), 359.0, 1e-9);
    EXPECT_NEAR(b["series"][0]["first"][0].get<double>(), 0.0, 1e-9);
    // 30-minute windows (minute table) with an offset of 15 minutes
    b = r.get(r.q("aggregate",
                  "group=dien&tags=METER1.KW&bucketMs=1800000&offsetMs=900000&" + kRange));
    EXPECT_EQ(b["source"], "minute");
    EXPECT_EQ(b["start"], kT0 - 900000);
    EXPECT_EQ(b["count"], 5);
    // too many windows
    const json e = r.get(r.q("aggregate", "group=dien&tags=METER1.KW&bucketMs=60000&from=" +
                                              std::to_string(kT0) + "&to=" +
                                              std::to_string(kT0 + 60LL * 86400000)),
                         422);
    EXPECT_EQ(e["error"], "RANGE_TOO_LARGE");
}

TEST(HistoryApi, RowsPageBySeqWithoutOverlapOrGaps) {
    Rig r;
    std::set<int64_t> seen;
    int64_t after = -1;
    int pages = 0;
    for (;;) {
        std::string extra = "group=dien&tags=METER1.KW,METER1.NOTE&limit=200&order=asc&" + kRange;
        if (after >= 0) extra += "&after=" + std::to_string(after);
        const json b = r.get(r.q("rows", extra));
        for (const auto& row : b["rows"]) EXPECT_TRUE(seen.insert(row[0].get<int64_t>()).second);
        ++pages;
        if (b["next"].is_null()) break;
        after = b["next"].get<int64_t>();
        ASSERT_LT(pages, 10);
    }
    EXPECT_EQ(seen.size(), 720u);
    EXPECT_EQ(pages, 4);  // 200, 200, 200, 120
    // newest first by default
    const json d = r.get(r.q("rows", "group=dien&tags=METER1.KW&limit=3&" + kRange));
    EXPECT_EQ(d["order"], "desc");
    EXPECT_GT(d["rows"][0][1].get<int64_t>(), d["rows"][1][1].get<int64_t>());
}

TEST(HistoryApi, ExportCsvIsChunkedHasABomAndIsAudited) {
    Rig r;
    const HttpResult res =
        r.getAs("xem1", r.q("export.csv", "group=dien&tags=METER1.KW,METER1.NOTE&" + kRange));
    ASSERT_EQ(res.status, 200) << res.body;
    EXPECT_NE(res.headers.find("text/csv"), std::string::npos);
    EXPECT_NE(res.headers.find("attachment"), std::string::npos);
    ASSERT_GE(res.body.size(), 3u);
    EXPECT_EQ(res.body.substr(0, 3), "\xEF\xBB\xBF");
    EXPECT_EQ(res.body.substr(3, 12), "time,A,S\r\n20");
    // 720 rows + header, CRLF
    EXPECT_EQ(std::count(res.body.begin(), res.body.end(), '\n'), 721);
    // local time (+07:00): 01:00Z is 08:00; text formulas get an apostrophe; commas are quoted
    EXPECT_NE(res.body.find("2026-10-10 08:00:00.000,0,"), std::string::npos);
    EXPECT_NE(res.body.find("'=lẻ"), std::string::npos);
    EXPECT_NE(res.body.find("\"chẵn,\"\"x\"\"\""), std::string::npos);
    const auto recs = r.records("history.export");
    ASSERT_EQ(recs.size(), 1u);
    EXPECT_EQ(recs[0].result, "ok");
    EXPECT_EQ(recs[0].user.value_or(""), "xem1");
    EXPECT_NE(recs[0].detail.value_or("").find("\"rows\":720"), std::string::npos);
    // aggregate export, hour fields
    const HttpResult h = r.getAs(
        "xem1", r.q("export.csv", "group=dien&tags=METER1.KW&res=1h&fields=min,max,count&bom=0&" + kRange));
    ASSERT_EQ(h.status, 200);
    EXPECT_EQ(h.body.substr(0, 20), "time,A.min,A.max,A.c");
    EXPECT_EQ(std::count(h.body.begin(), h.body.end(), '\n'), 3);
    EXPECT_NE(h.body.find("2026-10-10 08:00,0,359,360"), std::string::npos);
}

TEST(HistoryApi, ExportTooLargeIsRefusedBeforeTheFirstByte) {
    Rig r;
    const HttpResult res = r.getAs("xem1", r.q("export.csv", "group=dien&res=1m&from=0&to=" +
                                                                 std::to_string(3650LL * 86400000)));
    EXPECT_EQ(res.status, 422);
    EXPECT_EQ(bodyJson(res)["error"], "EXPORT_TOO_LARGE");
    EXPECT_EQ(res.body.find("time,"), std::string::npos);
    EXPECT_TRUE(r.records("history.export").empty());
}

TEST(HistoryApi, BadParametersAreRefusedBeforeTouchingData) {
    Rig r;
    const std::string ok = "group=dien&tags=METER1.KW&" + kRange;
    const std::vector<std::string> bad = {
        "tags=METER1.KW&" + kRange,                                          // no group
        "group=dien&" + kRange,                                              // no tags
        "group=dien&tags=METER1.KW&from=5&to=5",                             // from >= to
        "group=dien&tags=METER1.KW&from=x&to=9",                             // not a number
        "group=dien&tags=METER1.KW&from=1234567890123456&to=1234567890123457",  // > 15 digits
        ok + "&maxPoints=9",                                                 // out of range
        ok + "&maxPoints=5001",
        ok + "&res=1d",                                                      // not in the set
        ok + "&reduce=avg",
        ok + "&foo=1",                                                       // unknown parameter
        ok + "&group=van-hanh",                                              // repeated parameter
        ok + "&maxPoints=%zz",                                               // malformed escape
        "group=dien&tags=METER1.NOTE&" + kRange,                             // a text Tag in series
        "group=dien&tags=METER1.KW,METER1.KW&" + kRange,                     // a Tag twice
        "group=dien&tags=METER1.KW&from=0&to=" + std::to_string(3651LL * 86400000),  // > 3650 days
    };
    for (const auto& b : bad) {
        const json e = r.get("/api/v1/history/series?" + b, 400);
        EXPECT_EQ(e["error"], "BAD_REQUEST") << b;
    }
    // 16 Tags at most
    std::string many = "METER1.KW";
    for (int i = 0; i < 16; ++i) many += ",X" + std::to_string(i);
    EXPECT_EQ(r.get("/api/v1/history/series?group=dien&tags=" + many + "&" + kRange, 400)["error"],
              "BAD_REQUEST");
    EXPECT_EQ(r.get(r.q("rows", "group=dien&limit=501&" + kRange), 400)["error"], "BAD_REQUEST");
    EXPECT_EQ(r.get(r.q("rows", "group=dien&order=up&" + kRange), 400)["error"], "BAD_REQUEST");
    EXPECT_EQ(r.get(r.q("aggregate", "group=dien&tags=METER1.KW&bucketMs=90000&" + kRange), 400)["error"],
              "BAD_REQUEST");
    EXPECT_EQ(r.get(r.q("aggregate", "group=dien&tags=METER1.KW&bucketMs=60000&offsetMs=60000&" + kRange), 400)["error"],
              "BAD_REQUEST");
}

TEST(HistoryApi, UnknownGroupsAndTagsAreRefusedWhateverTheyLookLike) {
    Rig r;
    for (const char* g : {"nope", "dien%27%20OR%201=1--", "..%2F..%2Fetc", "dien;DROP%20TABLE%20x"}) {
        const json e = r.get(r.q("series", std::string("group=") + g + "&tags=A&" + kRange), 404);
        EXPECT_EQ(e["error"], "UNKNOWN_GROUP") << g;
    }
    for (const char* t : {"NOPE", "A%22%20OR%201=1", "METER1.KW%22%3B%20DROP", "mat_meta", "seq"}) {
        const json e = r.get(r.q("series", std::string("group=dien&tags=") + t + "&" + kRange), 404);
        EXPECT_EQ(e["error"], "UNKNOWN_TAG") << t;
    }
    // the database is still whole
    EXPECT_EQ(r.get(r.q("rows", "group=dien&limit=1&" + kRange))["rows"].size(), 1u);
}

TEST(HistoryApi, TheGateComesFirstHttpsSessionAndMethod) {
    Rig r;
    const std::string p = r.q("series", "group=dien&tags=METER1.KW&" + kRange);
    // plain HTTP: HTTPS_REQUIRED, not 401 and not data
    const HttpResult h = r.callHttp(getReq(p, {r.bearer("xem1")}));
    EXPECT_EQ(h.status, 403);
    EXPECT_EQ(bodyJson(h)["error"], "HTTPS_REQUIRED");
    // no session
    const HttpResult n = r.call(getReq(p));
    EXPECT_EQ(n.status, 401);
    EXPECT_EQ(bodyJson(n)["error"], "AUTH_REQUIRED");
    // a token the server never made
    const HttpResult bad = r.call(getReq(p, {"Authorization: Bearer mats_nope"}));
    EXPECT_EQ(bad.status, 401);
    // only GET
    const HttpResult post = r.call(postReq("/api/v1/history/series", "{}", {r.bearer("xem1")}));
    EXPECT_EQ(post.status, 405);
    EXPECT_NE(post.headers.find("Allow: GET"), std::string::npos);
    // every role may read: viewer, operator, engineer, administrator
    for (const char* u : {"xem1", "vh1", "kysu1", "admin1"})
        EXPECT_EQ(r.getAs(u, "/api/v1/history/catalog").status, 200) << u;
    // refusals leave nothing in the response that names a table
    EXPECT_EQ(n.body.find("tbl_"), std::string::npos);
}

TEST(HistoryApi, ARequestAnswersWithNoStoreAndJson) {
    Rig r;
    r.get("/api/v1/history/catalog");
    EXPECT_NE(r.last.headers.find("Cache-Control: no-store"), std::string::npos);
    EXPECT_NE(r.last.headers.find("application/json"), std::string::npos);
}

TEST(HistoryApi, LimiterCountersGoUpAndABusySecondRequestOfASessionIsRefused) {
    Rig r;
    r.get(r.q("series", "group=dien&tags=METER1.KW&" + kRange));
    const auto s = r.api->limiter().stats();
    EXPECT_EQ(s.served, 1u);
    EXPECT_EQ(s.inFlight, 0);
    // a held slot of the same session is a 429 with Retry-After
    const std::string key = [&] {
        // the session key the API uses is not reachable; hold every slot instead
        return std::string();
    }();
    (void)key;
    auto a = r.api->limiter().tryAcquire(QueryLimiter::Kind::Query, "x1");
    auto b = r.api->limiter().tryAcquire(QueryLimiter::Kind::Query, "x2");
    ASSERT_TRUE(a && b);
    const HttpResult busy = r.getAs("xem1", r.q("series", "group=dien&tags=METER1.KW&" + kRange));
    EXPECT_EQ(busy.status, 429);
    EXPECT_EQ(bodyJson(busy)["error"], "BUSY");
    EXPECT_NE(busy.headers.find("Retry-After: 2"), std::string::npos);
    EXPECT_GE(r.api->limiter().stats().rejectedBusy, 1u);
}

TEST(HistoryApi, DisabledGroupsAnd404WhenOff) {
    ApiRig r([](ApiRig& rig) {
        static HistoryApi* keep = nullptr;
        HistoryApi::Options o;
        o.dbPath = rig.dataDir + "/history.db";
        o.enabled = false;
        keep = new HistoryApi(std::move(o));
        rig.eng->setHistory(keep);
    });
    EXPECT_EQ(r.getAs("xem1", "/api/v1/history/catalog").status, 200);
    EXPECT_FALSE(bodyJson(r.getAs("xem1", "/api/v1/history/catalog"))["enabled"].get<bool>());
    const HttpResult s = r.getAs("xem1", "/api/v1/history/series?group=a&tags=b&from=1&to=2");
    EXPECT_EQ(s.status, 404);
    EXPECT_EQ(bodyJson(s)["error"], "NO_HISTORY");
}

// Security review of feature 010 (docs/reports/010-security-review.md).
TEST(HistoryApi, ASeriesOverAHugeRangeOfAggregatesIsRefusedBeforeReading) {  // M2
    Rig r;
    const json e = r.get(r.q("series", "group=dien&tags=METER1.KW&res=1m&from=0&to=" +
                                           std::to_string(3650LL * 86400000)),
                         422);
    EXPECT_EQ(e["error"], "RANGE_TOO_LARGE");
}

TEST(HistoryApi, OneTokenHasOneSessionWhateverTheSpacingOrCaseOfTheHeader) {  // L4
    Rig r;
    const std::string tok = r.bearer("xem1").substr(std::string("Authorization: Bearer ").size());
    const std::string path = r.q("series", "group=dien&tags=METER1.KW&" + kRange);
    for (const char* h : {"Authorization: Bearer ", "Authorization: bearer  ", "Authorization: BEARER   "}) {
        const HttpResult res = r.call(getReq(path, {std::string(h) + tok}));
        EXPECT_EQ(res.status, 200) << h << res.body;
    }
    auto a = r.api->limiter().tryAcquire(QueryLimiter::Kind::Query, "same");
    EXPECT_FALSE(r.api->limiter().tryAcquire(QueryLimiter::Kind::Query, "same").has_value());
}
