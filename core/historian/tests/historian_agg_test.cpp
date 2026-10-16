// The historian with aggregate tables, trigger groups and the run record (specs/010-history-reports
// contracts/history-db.md §3–§5, FR-009…FR-017). Driven by runOnce() with fake clocks; no thread.
#include <dirent.h>
#include <gtest/gtest.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cmath>
#include <ctime>
#include <fstream>

#include "core/historian/historian.hpp"
#include "sqlite3.h"

using namespace mat;

namespace {
constexpr int64_t kT0 = 1791594000000;  // 2026-10-10T01:00:00Z, a whole hour
constexpr int64_t kMin = 60000;
constexpr int64_t kHour = 3600000;
constexpr int64_t kDay = 86400000;

std::string tempDir() {
    char tmpl[] = "/tmp/mat-hagg-XXXXXX";
    const char* d = mkdtemp(tmpl);
    return d ? d : "";
}

void rawSql(const std::string& path, const std::string& sql) {
    sqlite3* db = nullptr;
    ASSERT_EQ(sqlite3_open(path.c_str(), &db), SQLITE_OK);
    sqlite3_busy_timeout(db, 5000);
    char* msg = nullptr;
    EXPECT_EQ(sqlite3_exec(db, sql.c_str(), nullptr, nullptr, &msg), SQLITE_OK) << (msg ? msg : "");
    sqlite3_free(msg);
    sqlite3_close(db);
}

double rawNum(const std::string& path, const std::string& sql) {
    sqlite3* db = nullptr;
    double v = -1;
    if (sqlite3_open_v2(path.c_str(), &db, SQLITE_OPEN_READONLY, nullptr) == SQLITE_OK) {
        sqlite3_busy_timeout(db, 5000);
        sqlite3_stmt* st = nullptr;
        if (sqlite3_prepare_v2(db, sql.c_str(), -1, &st, nullptr) == SQLITE_OK) {
            if (sqlite3_step(st) == SQLITE_ROW) v = sqlite3_column_double(st, 0);
            sqlite3_finalize(st);
        }
    }
    sqlite3_close(db);
    return v;
}

void copyFile(const std::string& from, const std::string& to) {
    std::ifstream in(from, std::ios::binary);
    std::ofstream out(to, std::ios::binary);
    out << in.rdbuf();
}

enum class Kind { Cyclic1s, OnChange, Trigger };

// One group "g" (table g) with columns A (FLOAT64) and B (BOOL) and a trigger tag T (BOOL).
struct Fx {
    TagStore store;
    int64_t wall = kT0;
    int64_t mono = 0;
    std::string dir;
    LoggingModel model;
    HistorianOptions opt;
    std::unique_ptr<Historian> h;
    bool aggregates = true;

    Fx(Kind kind, bool withAgg, HistorianOptions o = {}, std::string useDir = "",
       int64_t start = kT0)
        : wall(start), dir(useDir.empty() ? tempDir() : useDir), aggregates(withAgg), opt(o) {
        store.add({"T.A", TagType::FLOAT64, ""});
        store.add({"T.B", TagType::BOOL, ""});
        store.add({"T.TRIG", TagType::BOOL, ""});
        store.set(0, 10.0, Quality::GOOD, 0, 0);
        store.set(1, false, Quality::GOOD, 0, 0);
        store.set(2, false, Quality::GOOD, 0, 0);
        LoggingGroupModel g;
        g.id = "g";
        g.name = "G";
        g.table = "g";
        g.retentionDays = 30;
        if (kind == Kind::Cyclic1s) {
            g.mode = LogMode::Cyclic;
            g.periodMs = 1000;
        } else if (kind == Kind::OnChange) {
            g.mode = LogMode::OnChange;
            g.minIntervalMs = 1000;
        } else {
            g.mode = LogMode::Trigger;
            g.minIntervalMs = 1000;
            g.trigger = TriggerModel{"T.TRIG", 2, TagType::BOOL, TriggerEdge::Rising, 0};
        }
        g.columns.push_back({"T.A", 0, TagType::FLOAT64, "A", 0, 255});
        g.columns.push_back({"T.B", 1, TagType::BOOL, "B", 0, 255});
        g.columns.back().aggregate = false;  // one aggregated column keeps the counts simple
        if (withAgg) g.aggregates = AggregatesModel{31, 730};
        model.groups.push_back(g);
        opt.dataDir = dir;
        if (opt.aggFlushMs == HistorianOptions{}.aggFlushMs)
            opt.aggFlushMs = 60000;  // tests look at every minute
        if (opt.aliveEveryMs == HistorianOptions{}.aliveEveryMs) opt.aliveEveryMs = 60000;
        opt.clockFloorMs = kT0 - kDay;
        opt.ioSource = [] { return std::optional<int64_t>(0); };
        open();
    }
    void open() {
        h = std::make_unique<Historian>(
            model, store, opt, [this] { return wall; }, [this] { return mono; });
        std::string err;
        ASSERT_TRUE(h->open(err)) << err;
    }
    void run(int64_t ms) {
        for (int64_t t = 0; t < ms; t += 100) {
            h->runOnce();
            wall += 100;
            mono += 100;
        }
    }
    std::string db() const { return dir + "/history.db"; }
    double n(const std::string& sql) const { return rawNum(db(), sql); }
};
}  // namespace

// ---- trigger groups (US1)

TEST(HistorianTrigger, RowsOnTheEdgeOfATagThatIsNotAColumn) {
    Fx f(Kind::Trigger, false);
    f.run(3000);
    f.store.set(2, true, Quality::GOOD, 0, 0);  // rising edge
    f.run(2000);
    f.store.set(2, false, Quality::GOOD, 0, 0);
    f.run(2000);
    f.store.set(2, true, Quality::GOOD, 0, 0);
    f.run(2000);
    f.h->stop();
    EXPECT_EQ(f.n("SELECT count(*) FROM log_g"), 2);
    const auto s = f.h->status();
    ASSERT_EQ(s.groups.size(), 1u);
    EXPECT_EQ(s.groups[0].mode, "trigger");
    EXPECT_EQ(s.groups[0].triggerState, "active");
    EXPECT_EQ(s.groups[0].rows24h, 2);
}

TEST(HistorianTrigger, StateIsUnknownWhenTheTagQualityIsBad) {
    Fx f(Kind::Trigger, false);
    f.store.set(2, true, Quality::BAD, 0, 0);
    f.run(1500);  // status extras refresh once a second
    EXPECT_EQ(f.h->status().groups[0].triggerState, "unknown");
}

TEST(HistorianGroups, Rows24hCountsTheLastHoursOnly) {
    Fx f(Kind::Cyclic1s, false);
    f.run(10100);
    EXPECT_EQ(f.h->status().groups[0].rows24h, 10);
    f.wall += 25 * kHour;  // a day later (the clock jumps: no matter, the counter follows UTC)
    f.run(2100);
    EXPECT_EQ(f.h->status().groups[0].rows24h, 3);  // the first ten are older than 24 h
    EXPECT_EQ(f.h->status().groups[0].triggerState, "");
}

TEST(HistorianGroups, ProjectsWithoutAggregatesBehaveAsBefore) {
    Fx f(Kind::Cyclic1s, false);
    f.run(70000);
    f.h->stop();
    EXPECT_EQ(f.n("SELECT count(*) FROM mat_agg"), 0);
    EXPECT_EQ(f.n("SELECT count(*) FROM mat_runs"), 0);
    EXPECT_FALSE(f.h->status().aggEnabled);
    EXPECT_EQ(f.n("SELECT count(*) FROM log_g"), 69);  // rows at +1 s … +69 s
}

// ---- aggregates (US2)

TEST(HistorianAgg, MinuteBucketsOfAConstantSignalAndTheHourRow) {
    HistorianOptions o;
    o.commitMs = 5000;
    Fx f(Kind::Cyclic1s, true, o);
    f.run(kHour + 130000);  // a whole hour and two minutes
    f.h->stop();
    // Minute 0 starts at the first row (+1 s aligned): the signal is known from the first row on.
    // Every full minute after it: 60 rows (n counts rows with a value), the signal 10 all through.
    EXPECT_EQ(f.n("SELECT count(*) FROM mat_agg WHERE res=60000"), 62 + 1);
    EXPECT_EQ(
        f.n("SELECT n FROM mat_agg WHERE res=60000 AND bucket=" + std::to_string(kT0 + 5 * kMin)),
        60);
    EXPECT_EQ(f.n("SELECT sumw FROM mat_agg WHERE res=60000 AND bucket=" +
                  std::to_string(kT0 + 5 * kMin)),
              10.0 * kMin);
    EXPECT_EQ(
        f.n("SELECT wms FROM mat_agg WHERE res=60000 AND bucket=" + std::to_string(kT0 + 5 * kMin)),
        kMin);
    // The hour [kT0, kT0+1h) is one row built from its minutes
    EXPECT_EQ(f.n("SELECT count(*) FROM mat_agg WHERE res=3600000"),
              2);  // + the partial 2nd hour at stop
    EXPECT_EQ(f.n("SELECT wms FROM mat_agg WHERE res=3600000 AND bucket=" + std::to_string(kT0)),
              kHour - 1000);  // the first row is at +1 s
    EXPECT_EQ(f.n("SELECT n FROM mat_agg WHERE res=3600000 AND bucket=" + std::to_string(kT0)),
              3599);
    // BOOL column is aggregated too (0/1)
    EXPECT_EQ(f.n("SELECT count(*) FROM mat_agg_cols"), 1);  // B has aggregate:false
}

TEST(HistorianAgg, ClosedWindowsAreInTheSameTransactionAsTheRawRows) {
    HistorianOptions o;
    o.commitMs = 1000;
    o.retryMs = 1000;
    Fx f(Kind::Cyclic1s, true, o);
    std::string err;
    ASSERT_TRUE(f.h->storeForTest().exec("PRAGMA query_only=1", err)) << err;
    f.run(130000);  // two windows close; every commit fails
    EXPECT_EQ(f.n("SELECT count(*) FROM log_g"), 0);
    EXPECT_EQ(f.n("SELECT count(*) FROM mat_agg"), 0);  // neither is there
    EXPECT_EQ(f.h->status().state, HistorianState::Error);
    ASSERT_TRUE(f.h->storeForTest().exec("PRAGMA query_only=0", err)) << err;
    f.run(3000);
    EXPECT_GT(f.n("SELECT count(*) FROM log_g"), 0);
    EXPECT_GT(f.n("SELECT count(*) FROM mat_agg"), 0);
}

TEST(HistorianAgg, BuiltToMovesAtMostOncePerMinuteInsideTheCommit) {
    HistorianOptions o;
    o.commitMs = 5000;
    Fx f(Kind::Cyclic1s, true, o);
    rawSql(f.db(),
           "CREATE TABLE IF NOT EXISTS probe(v INTEGER);"
           "CREATE TRIGGER probe_t AFTER UPDATE OF agg_built_to ON mat_tables BEGIN "
           "INSERT INTO probe VALUES(NEW.agg_built_to); END;");
    f.run(10 * kMin + 500);
    const double updates = f.n("SELECT count(*) FROM probe");
    EXPECT_GE(updates, 9);
    EXPECT_LE(updates, 12);  // one per minute (+ the first pass), never one per commit (~120)
    // The mark is the start of a minute at or before the last closed window
    const double built = f.n("SELECT agg_built_to FROM mat_tables WHERE name='g'");
    EXPECT_EQ(std::fmod(built, kMin), 0);
    EXPECT_GE(built, kT0 + 9 * kMin);
}

TEST(HistorianAgg, ClosedWindowsAndTheMarkGoToTheFileTogetherEveryFlushPeriodOnly) {
    HistorianOptions o;
    o.commitMs = 5000;
    o.aggFlushMs =
        300001;  // the runtime default (the fixture replaces the exact default by 1 minute)
    Fx f(Kind::Cyclic1s, true, o);
    f.run(3 * kMin + 500);
    EXPECT_GT(f.n("SELECT count(*) FROM log_g"), 100);  // raw rows are committed every 5 s
    EXPECT_EQ(f.n("SELECT count(*) FROM mat_agg"), 0);  // the windows wait for the flush
    EXPECT_LT(f.n("SELECT COALESCE(agg_built_to, 0) FROM mat_tables WHERE name='g'"),
              kT0 + 2 * kMin);
    f.run(3 * kMin);  // past 5 minutes
    EXPECT_GT(f.n("SELECT count(*) FROM mat_agg WHERE res=60000"), 3);
    EXPECT_GE(f.n("SELECT agg_built_to FROM mat_tables WHERE name='g'"), kT0 + 4 * kMin);
}

TEST(HistorianAgg, RunsAreRecordedOnceAndKeptAlive) {
    HistorianOptions o;
    o.aliveEveryMs = 60000;
    Fx f(Kind::Cyclic1s, true, o);
    rawSql(
        f.db(),
        "CREATE TABLE IF NOT EXISTS probe(v INTEGER);"
        "CREATE TRIGGER probe_t AFTER UPDATE ON mat_runs BEGIN INSERT INTO probe VALUES(1); END;");
    f.run(5 * kMin + 500);
    EXPECT_EQ(f.n("SELECT count(*) FROM mat_runs"), 1);
    EXPECT_EQ(f.n("SELECT start_ms FROM mat_runs"), kT0);
    EXPECT_LE(f.n("SELECT count(*) FROM probe"), 6);  // at most once a minute
    f.h->stop();
    EXPECT_EQ(f.n("SELECT alive_ms FROM mat_runs"), f.wall);  // the clean stop writes the end
    // A second run (restart) adds a row
    Fx g(Kind::Cyclic1s, true, o, f.dir, f.wall + 60000);
    g.run(2000);
    EXPECT_EQ(g.n("SELECT count(*) FROM mat_runs"), 2);
}

// FR-017: mat_runs costs at most 20 MB/day of eMMC writes. With the runtime's own cadence (alive_ms
// every 15 minutes, in the transaction of the flush) one day is 96 updates of one page: even with a
// page written twice (WAL, checkpoint) that is under 1 MB.
TEST(HistorianAgg, MatRunsCostsLessThanTwentyMegabytesADay) {
    HistorianOptions o;
    o.commitMs = 5000;
    o.aggFlushMs = o.aliveEveryMs = 900001;  // the runtime default of 15 minutes (the fixture maps
                                             // the exact default to 1 minute)
    Fx f(Kind::Cyclic1s, true, o);
    rawSql(
        f.db(),
        "CREATE TABLE IF NOT EXISTS probe(v INTEGER);"
        "CREATE TRIGGER probe_t AFTER UPDATE ON mat_runs BEGIN INSERT INTO probe VALUES(1); END;");
    f.run(2 * kHour);
    const double updates = f.n("SELECT count(*) FROM probe");
    EXPECT_LE(updates, 2 * 4 + 1) << "at most one update per 15 minutes";
    const double perDay = updates / 2.0 * 24.0;  // two hours measured
    const double bytesPerDay = perDay * 4096 * 2;
    EXPECT_LT(bytesPerDay, 20.0 * 1024 * 1024);
    f.h->stop();
}

TEST(HistorianAgg, TheSignalIsBrokenByAClockJump) {
    HistorianOptions o;
    o.commitMs = 1000;
    Fx f(Kind::Cyclic1s, true, o);
    f.run(30000);       // 30 s of 10
    f.wall += 3600000;  // NTP moves the clock an hour ahead
    f.run(95000);
    f.h->stop();
    // Nothing is held across the jump: the hour gap has no buckets
    EXPECT_EQ(f.n("SELECT count(*) FROM mat_agg WHERE res=60000 AND bucket>=" +
                  std::to_string(kT0 + kMin) + " AND bucket<" + std::to_string(kT0 + kHour)),
              0);
    EXPECT_GE(f.n("SELECT count(*) FROM mat_agg WHERE res=60000"), 3);
}

TEST(HistorianAgg, WritingThatPausesBreaksTheSignal) {
    HistorianOptions o;
    o.commitMs = 1000;
    o.checkEveryMs = 1000;
    int64_t freeBytes = 10LL << 30;
    o.freeBytes = [&](const std::string&) { return freeBytes; };
    Fx f(Kind::Cyclic1s, true, o);
    f.run(20000);
    freeBytes = 1000;  // below minFreeBytes: paused
    f.run(200000);
    EXPECT_EQ(f.h->status().state, HistorianState::PausedLowDisk);
    freeBytes = 10LL << 30;
    f.run(120000);
    f.h->stop();
    // No window in the middle of the pause holds a value
    EXPECT_EQ(f.n("SELECT count(*) FROM mat_agg WHERE res=60000 AND bucket>=" +
                  std::to_string(kT0 + 2 * kMin) + " AND bucket<" + std::to_string(kT0 + 3 * kMin)),
              0);
}

TEST(HistorianAgg, ARestartAfterACrashRebuildsTheLastMinutesWithoutDoubleCounting) {
    HistorianOptions o;
    o.commitMs = 5000;
    Fx f(Kind::Cyclic1s, true, o);
    f.run(3 * kMin + 25100);  // in the middle of minute 3
    // "kill -9": copy the files as they are (the WAL included), without a clean stop
    const std::string dir2 = tempDir();
    for (const char* ext : {"", "-wal", "-shm"}) copyFile(f.db() + ext, dir2 + "/history.db" + ext);
    f.h->stop();  // (the original goes on to a clean stop; only the copy matters)
    Fx g(Kind::Cyclic1s, true, o, dir2, kT0 + 3 * kMin + 40000);  // restart 15 s later
    // The window of minute 3 was rebuilt from the raw rows ≥ agg_built_to
    const double rows =
        g.n("SELECT count(*) FROM log_g WHERE ts >= " + std::to_string(kT0 + 3 * kMin));
    EXPECT_GT(rows, 0);
    EXPECT_EQ(
        g.n("SELECT n FROM mat_agg WHERE res=60000 AND bucket=" + std::to_string(kT0 + 3 * kMin)),
        rows);
    g.run(3 * kMin);
    g.h->stop();
    // Over the whole file: Σ n of the minute rows = the raw rows with a value (no minute twice,
    // none lost), and no minute has more than 60 s of signal
    EXPECT_EQ(g.n("SELECT sum(n) FROM mat_agg WHERE res=60000"), g.n("SELECT count(*) FROM log_g"));
    EXPECT_LE(g.n("SELECT max(wms) FROM mat_agg WHERE res=60000"), kMin);
    EXPECT_EQ(g.n("SELECT count(*) FROM (SELECT cid, bucket FROM mat_agg WHERE res=60000 GROUP BY "
                  "cid, bucket HAVING count(*) > 1)"),
              0);
    EXPECT_EQ(g.n("SELECT count(*) FROM mat_runs"), 2);
}

// Code review C1: a clean stop writes the open minute as it stands; the restart rebuilt the same
// minute from the raw rows and the merging upsert added it to the row already there (n, sumw, wms
// doubled).
TEST(HistorianAgg, ACleanStopAndRestartDoesNotCountTheOpenMinuteTwice) {
    HistorianOptions o;
    o.commitMs = 5000;
    Fx f(Kind::Cyclic1s, true, o);
    f.run(3 * kMin + 25100);  // in the middle of minute 3
    f.h->stop();
    Fx g(Kind::Cyclic1s, true, o, f.dir, kT0 + 3 * kMin + 40000);  // restart 15 s later
    g.run(2 * kMin);
    g.h->stop();
    EXPECT_EQ(g.n("SELECT sum(n) FROM mat_agg WHERE res=60000"), g.n("SELECT count(*) FROM log_g"));
    EXPECT_LE(g.n("SELECT max(n) FROM mat_agg WHERE res=60000"), 60);
    EXPECT_LE(g.n("SELECT max(wms) FROM mat_agg WHERE res=60000"), kMin);
    EXPECT_EQ(g.n("SELECT count(*) FROM (SELECT cid, bucket FROM mat_agg WHERE res=60000 GROUP BY "
                  "cid, bucket HAVING count(*) > 1)"),
              0);
}

// With the 15-minute flush a crash can leave up to 15 minutes of closed windows only in the raw
// rows; the restart rebuilds all of them (history-db.md section 2, ADR-031).
TEST(HistorianAgg, ACrashRightBeforeTheFifteenMinuteFlushRebuildsAllTheUnflushedWindows) {
    HistorianOptions o;
    o.commitMs = 5000;
    o.aggFlushMs = 900001;  // the runtime default of 15 minutes (the fixture maps the exact default
                            // to 1 minute)
    o.aliveEveryMs = 900001;
    Fx f(Kind::Cyclic1s, true, o);
    f.run(14 * kMin + 30000);  // 13 closed minutes, none of them flushed
    EXPECT_EQ(f.n("SELECT count(*) FROM mat_agg WHERE res=60000"), 0);
    const std::string dir2 = tempDir();
    for (const char* ext : {"", "-wal", "-shm"}) copyFile(f.db() + ext, dir2 + "/history.db" + ext);
    f.h->stop();
    Fx g(Kind::Cyclic1s, true, o, dir2, kT0 + 14 * kMin + 50000);
    // all of minutes 0..13 are back, each with its 60 raw rows (1 row a second), as at a clean stop
    for (int m = 0; m < 14; ++m) {
        const double n = g.n("SELECT n FROM mat_agg WHERE res=60000 AND bucket=" +
                             std::to_string(kT0 + m * kMin));
        EXPECT_GE(n, 59) << "minute " << m;
        EXPECT_LE(n, 60) << "minute " << m;
    }
    g.run(2 * kMin);
    g.h->stop();
    EXPECT_EQ(g.n("SELECT sum(n) FROM mat_agg WHERE res=60000"), g.n("SELECT count(*) FROM log_g"));
    EXPECT_EQ(g.n("SELECT count(*) FROM (SELECT cid, bucket FROM mat_agg WHERE res=60000 GROUP BY "
                  "cid, bucket HAVING count(*) > 1)"),
              0);
}

TEST(HistorianAgg, BackfillBuildsBucketsOfRowsLoggedBeforeAggregatesWereOn) {
    HistorianOptions o;
    o.commitMs = 5000;
    o.aggBackfillRows = 700;  // several passes per slice
    const std::string dir = tempDir();
    {
        Fx f(Kind::Cyclic1s, false, o, dir);  // two hours of raw rows, no aggregates
        f.run(2 * kHour + 30000);
        f.h->stop();
    }
    const double rawRows = rawNum(dir + "/history.db", "SELECT count(*) FROM log_g");
    EXPECT_GT(rawRows, 7000);
    Fx g(Kind::Cyclic1s, true, o, dir, kT0 + 2 * kHour + 60000);  // aggregates switched on
    g.run(1000);
    EXPECT_FALSE(g.n("SELECT agg_back_to FROM mat_tables WHERE name='g'") <
                 0);  // back-fill pending
    // Each pass builds at most one chunk of 700 rows: run until it ends
    // FR-014: a pass takes at most 20 ms (CPU time of the thread, so a busy machine does not count)
    double worstPassMs = 0;
    for (int i = 0; i < 400 && g.h->status().backfillActive; ++i) {
        timespec a{}, b{};
        clock_gettime(CLOCK_THREAD_CPUTIME_ID, &a);
        g.run(100);  // one runOnce: a back-fill pass of at most 700 rows
        clock_gettime(CLOCK_THREAD_CPUTIME_ID, &b);
        worstPassMs = std::max(worstPassMs, static_cast<double>(b.tv_sec - a.tv_sec) * 1e3 +
                                                static_cast<double>(b.tv_nsec - a.tv_nsec) / 1e6);
    }
    EXPECT_LE(worstPassMs, 20.0) << "worst back-fill pass, ms of CPU";
    EXPECT_FALSE(g.h->status().backfillActive);
    g.run(1000);
    g.h->stop();
    // Everything before the switch is built: Σ n = rows before the first minute of the new run
    const double builtTo = g.n("SELECT min(bucket) FROM mat_agg WHERE res=60000 AND bucket >= " +
                               std::to_string(kT0 + 2 * kHour + 60000));
    (void)builtTo;
    EXPECT_EQ(
        g.n("SELECT sum(n) FROM mat_agg WHERE res=60000 AND bucket < " +
            std::to_string(kT0 + 2 * kHour + 60000)),
        g.n("SELECT count(*) FROM log_g WHERE ts < " + std::to_string(kT0 + 2 * kHour + 60000)));
    // The hours are there too, and each is the merge of its minutes
    EXPECT_GE(g.n("SELECT count(*) FROM mat_agg WHERE res=3600000"), 2);
    EXPECT_EQ(g.n("SELECT n FROM mat_agg WHERE res=3600000 AND bucket=" + std::to_string(kT0)),
              g.n("SELECT sum(n) FROM mat_agg WHERE res=60000 AND bucket >= " +
                  std::to_string(kT0) + " AND bucket < " + std::to_string(kT0 + kHour)));
    EXPECT_TRUE(g.h->status().aggEnabled);
    // The back-fill is over: the mark is cleared
    EXPECT_EQ(g.n("SELECT count(*) FROM mat_tables WHERE name='g' AND agg_back_to IS NULL"), 1);
}

TEST(HistorianAgg, BucketsAreCleanedByTheirOwnRetention) {
    HistorianOptions o;
    o.retentionEveryMs = 1000;
    o.batchRows = 20;
    Fx f(Kind::Cyclic1s, true, o);
    f.model.groups[0].aggregates = AggregatesModel{1, 2};  // minutes 1 day, hours 2 days
    f.open();
    f.run(2 * kMin + 500);
    f.h->stop();
    const double before = f.n("SELECT count(*) FROM mat_agg WHERE res=60000");
    EXPECT_GE(before, 2);
    // Three days later the minute buckets (1 day) and the hour buckets (2 days) are gone
    Fx g(Kind::Cyclic1s, true, o, f.dir, kT0 + 3 * kDay);
    g.model.groups[0].aggregates = AggregatesModel{1, 2};
    g.model.groups[0].retentionDays = 365;  // raw rows are not what this test is about
    g.open();
    g.run(30000);
    EXPECT_EQ(g.n("SELECT count(*) FROM mat_agg WHERE bucket < " + std::to_string(kT0 + kDay)), 0);
}

TEST(HistorianAgg, SizeCapDeletesRawRowsFirstThenMinutesThenHours) {
    HistorianOptions o;
    o.checkEveryMs = 1000;
    o.batchRows = 500;
    Fx f(Kind::Cyclic1s, true, o);  // first without a cap
    f.run(3 * kMin + 500);
    f.h->stop();
    o.maxDbBytes = 1;  // then always over the cap
    const double minutes = f.n("SELECT count(*) FROM mat_agg WHERE res=60000");
    ASSERT_GT(minutes, 2);
    ASSERT_GT(f.n("SELECT count(*) FROM log_g"), 100);
    // Over the cap from the start: step by step, no bucket goes while a raw row is left
    Fx g(Kind::Cyclic1s, true, o, f.dir, kT0 + 10 * kMin);
    bool rawLeft = true;
    for (int i = 0; i < 400 && rawLeft; ++i) {
        g.run(100);
        rawLeft =
            g.n("SELECT count(*) FROM log_g WHERE ts < " + std::to_string(kT0 + 10 * kMin)) > 0;
        if (rawLeft)
            EXPECT_EQ(g.n("SELECT count(*) FROM mat_agg WHERE res=60000 AND bucket < " +
                          std::to_string(kT0 + 4 * kMin)),
                      minutes);
    }
    EXPECT_FALSE(rawLeft);
    g.run(20000);  // then the minute buckets, then the hours
    const auto s = g.h->status();
    EXPECT_GT(s.capRowsDeleted, 0u);
    EXPECT_GT(s.capRowsDeletedMinute, 0u);
    EXPECT_EQ(g.n("SELECT count(*) FROM mat_agg WHERE res=60000 AND bucket < " +
                  std::to_string(kT0 + 4 * kMin)),
              0);
}
