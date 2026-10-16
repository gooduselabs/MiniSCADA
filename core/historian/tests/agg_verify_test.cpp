// --verify-aggregates and --history-stats (specs/010-history-reports FR-061, device-010.md §3): the
// buckets are built again from the raw rows and compared with mat_agg.
#include "core/historian/query/agg_verify.hpp"

#include <gtest/gtest.h>
#include <unistd.h>

#include "core/historian/aggregator.hpp"
#include "core/historian/local_store.hpp"
#include "sqlite3.h"

using namespace mat;

namespace {
constexpr int64_t kT0 = 1791594000000;  // a whole hour

std::string tempDir() {
    char tmpl[] = "/tmp/mat-verify-XXXXXX";
    return mkdtemp(tmpl);
}

void sql(const std::string& dir, const std::string& stmt) {
    sqlite3* db = nullptr;
    ASSERT_EQ(sqlite3_open((dir + "/history.db").c_str(), &db), SQLITE_OK);
    char* msg = nullptr;
    EXPECT_EQ(sqlite3_exec(db, stmt.c_str(), nullptr, nullptr, &msg), SQLITE_OK) << (msg ? msg : "");
    sqlite3_free(msg);
    sqlite3_close(db);
}

// Two runs of one hour each with a 30 minute gap; the first ends cleanly, the minute buckets and the
// hour rows are those the runtime writes. One aggregated column A, one plain column S.
std::string makeDb(bool withAgg = true) {
    const std::string dir = tempDir();
    LocalStore s(dir, [] { return kT0; });
    std::string err;
    EXPECT_TRUE(s.open(err)) << err;
    TableSpec t;
    t.table = "t";
    t.groupId = "g";
    t.retentionDays = 30;
    t.columns = {{"A", "REAL"}, {"S", "TEXT"}};
    if (withAgg) {
        t.aggMinuteDays = 31;
        t.aggHourDays = 730;
        t.aggColumns = {"A"};
    }
    EXPECT_TRUE(s.ensureTables({t}, err)) << err;
    std::vector<PendingRow> rows;
    std::vector<AggWrite> aggs;
    std::vector<AggOut> out;
    GroupAggregator agg(1);
    auto take = [&] {
        out.clear();
        agg.drain(out);
        for (const auto& o : out)
            if (o.res == kAggMinuteMs) aggs.push_back({0, o.col, o.res, o.bucket, o.agg});
    };
    int64_t runId = -1;
    auto run = [&](int64_t from, int64_t to) {
        runId = s.startRun(from, err);
        for (int64_t ts = from; ts < to; ts += 10000) {
            rows.push_back({0, ts, {static_cast<double>((ts - kT0) / 10000 % 50), std::string("x")}});
            agg.row(ts, {static_cast<double>((ts - kT0) / 10000 % 50)});
            take();
        }
        agg.breakAll(to - 10000);  // the run ends at its last row
        take();
        s.touchRun(runId, to - 10000, err);
    };
    run(kT0, kT0 + 3600000);
    run(kT0 + 5400000, kT0 + 9000000);
    for (int64_t h = kT0; h < kT0 + 9000000; h += 3600000) aggs.push_back({0, 0, kAggHourMs, h, {}, true});
    if (!withAgg) aggs.clear();
    EXPECT_TRUE(s.commit(rows, err, {}, aggs, withAgg ? std::vector<AggMark>{AggMark{0, true, kT0 + 9000000}}
                                                      : std::vector<AggMark>{}))
        << err;
    return dir;
}
}  // namespace

TEST(AggVerify, ABuiltFileIsConsistent) {
    const std::string dir = makeDb();
    VerifyResult r;
    std::string err;
    ASSERT_TRUE(verifyAggregates(dir + "/history.db", "g", std::nullopt, std::nullopt, r, err)) << err;
    EXPECT_TRUE(r.clean()) << (r.diffs.empty() ? "" : r.diffs[0].kind + " " + std::to_string(r.diffs[0].bucket));
    EXPECT_GT(r.checked, 100);
}

TEST(AggVerify, AMissingBucketIsReported) {
    const std::string dir = makeDb();
    sql(dir, "DELETE FROM mat_agg WHERE res=60000 AND bucket=" + std::to_string(kT0 + 5 * 60000));
    VerifyResult r;
    std::string err;
    ASSERT_TRUE(verifyAggregates(dir + "/history.db", "g", std::nullopt, std::nullopt, r, err)) << err;
    EXPECT_EQ(r.missing, 1);
    EXPECT_EQ(r.extra, 0);
    EXPECT_LE(r.mismatch, 1);  // the hour row still holds the minute that is gone
    ASSERT_FALSE(r.diffs.empty());
    EXPECT_EQ(r.diffs[0].kind, "missing");
    EXPECT_EQ(r.diffs[0].bucket, kT0 + 5 * 60000);
}

TEST(AggVerify, AChangedBucketAndAnExtraBucketAreReported) {
    const std::string dir = makeDb();
    sql(dir, "UPDATE mat_agg SET n = n + 1 WHERE res=60000 AND bucket=" + std::to_string(kT0 + 7 * 60000));
    sql(dir,
        "INSERT INTO mat_agg SELECT cid, 60000, " + std::to_string(kT0 + 3600000 + 1140000) +
            ", 1, 1, 1, 1, 1, 60000, 60000 FROM mat_agg_cols LIMIT 1");  // inside the gap: nothing there
    VerifyResult r;
    std::string err;
    ASSERT_TRUE(verifyAggregates(dir + "/history.db", "g", std::nullopt, std::nullopt, r, err)) << err;
    EXPECT_GE(r.mismatch, 1);  // the minute with n + 1 (and the hours that no longer add up)
    EXPECT_EQ(r.extra, 1);
    EXPECT_FALSE(r.clean());
}

TEST(AggVerify, ADuplicateIsImpossibleByThePrimaryKeyAndAChangedHourIsFound) {
    const std::string dir = makeDb();
    sqlite3* db = nullptr;
    ASSERT_EQ(sqlite3_open((dir + "/history.db").c_str(), &db), SQLITE_OK);
    EXPECT_NE(sqlite3_exec(db,
                           ("INSERT INTO mat_agg SELECT cid, res, bucket, n, min, max, first, last, "
                            "sumw, wms FROM mat_agg LIMIT 1"),
                           nullptr, nullptr, nullptr),
              SQLITE_OK);  // the same key twice: refused
    sqlite3_close(db);
    sql(dir, "UPDATE mat_agg SET sumw = sumw + 1000 WHERE res=3600000 AND bucket=" + std::to_string(kT0));
    VerifyResult r;
    std::string err;
    ASSERT_TRUE(verifyAggregates(dir + "/history.db", "g", std::nullopt, std::nullopt, r, err)) << err;
    EXPECT_EQ(r.mismatch, 1);
}

TEST(AggVerify, NotesInsteadOfFailingWhenThereIsNothingToCheck) {
    VerifyResult r;
    std::string err;
    const std::string plain = makeDb(false);
    ASSERT_TRUE(verifyAggregates(plain + "/history.db", "g", std::nullopt, std::nullopt, r, err)) << err;
    EXPECT_TRUE(r.clean());
    EXPECT_FALSE(r.note.empty());
    EXPECT_FALSE(verifyAggregates(plain + "/history.db", "nope", std::nullopt, std::nullopt, r, err));
    EXPECT_FALSE(err.empty());
    EXPECT_FALSE(verifyAggregates("/nonexistent/history.db", "g", std::nullopt, std::nullopt, r, err));
}

TEST(AggVerify, TheRangeLimitsWhatIsCompared) {
    const std::string dir = makeDb();
    sql(dir, "DELETE FROM mat_agg WHERE res=60000 AND bucket=" + std::to_string(kT0 + 5 * 60000));
    VerifyResult r;
    std::string err;
    // the damage is in the first hour: the second hour alone is clean
    ASSERT_TRUE(verifyAggregates(dir + "/history.db", "g", kT0 + 5400000, kT0 + 9000000, r, err)) << err;
    EXPECT_TRUE(r.clean());
    EXPECT_GT(r.tolerated, 0);  // the window that holds the start of the range is not compared
}

TEST(AggVerify, HistoryStats) {
    const std::string dir = makeDb();
    nlohmann::json j;
    std::string err;
    ASSERT_TRUE(historyStats(dir + "/history.db", j, err)) << err;
    EXPECT_EQ(j["schema"], 2);
    EXPECT_EQ(j["runs"], 2);
    ASSERT_EQ(j["tables"].size(), 1u);
    EXPECT_EQ(j["tables"][0]["group"], "g");
    EXPECT_EQ(j["tables"][0]["rows"], 360 + 360);
    EXPECT_GT(j["aggregates"]["minute"].get<int64_t>(), 100);
    EXPECT_EQ(j["aggregates"]["hour"], 3);
}
