// T089 (feature 009; FR-044, FR-053, FR-054; SC-013): the history query over alarm.db: each filter,
// keyset paging, limits, the unsynchronised clock (D45), the gate of two queries, text search that
// ignores case and Vietnamese marks, hostile text, a read that does not block the writer, and
// 100,000 rows in a second.
#include "core/alarm/alarm_history.hpp"

#include <gtest/gtest.h>
#include <sqlite3.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <set>
#include <thread>

#include "core/alarm/alarm_store.hpp"
#include "core/alarm/alarm_text.hpp"

using namespace mat::alarm;

namespace {

constexpr int64_t kNow = 1791600000000LL;  // a valid clock
constexpr int64_t kMin = 60000, kHour = 3600000, kDay = 24 * kHour;

std::string tempDir() {
    char tmpl[] = "/tmp/mat-alarm-hist-XXXXXX";
    const char* d = mkdtemp(tmpl);
    return d ? d : "";
}

OccurrenceRow row(int64_t id, const std::string& alarm, int64_t ts, int priority = 3,
                  const std::string& cls = "minor", std::optional<std::string> area = "bon",
                  const std::string& text = "Bồn cao", bool closed = true, bool clockOk = true) {
    OccurrenceRow r;
    r.id = id;
    r.alarmId = alarm;
    r.fingerprint = "0123456789abcdef";
    r.tsActiveMs = ts;
    r.clockOk = clockOk;
    r.priority = priority;
    r.classId = cls;
    r.area = area;
    r.text = text;
    r.textFold = foldText(text + " " + alarm + " " + (area ? *area : "Chung"));
    r.valueActive = 81.5;
    r.closed = closed;
    if (closed) {
        r.closedBy = ClosedBy::Return;
        r.tsReturnMs = ts + kMin;
    }
    return r;
}

struct Fixture {
    std::string dir = tempDir();
    int64_t now = kNow;
    AlarmStore store{dir, [this] { return now; }};
    std::string err;
    Fixture() { EXPECT_TRUE(store.open(err)) << err; }
    void put(std::vector<OccurrenceRow> rows) {
        ASSERT_TRUE(store.commit(rows, {}, {}, err)) << err;
    }
    AlarmHistoryReader reader(HistoryOptions o = {}) { return AlarmHistoryReader(store.path(), o); }
};

HistoryQuery day(int64_t to = kNow + kMin) {
    HistoryQuery q;
    q.toMs = to;
    q.fromMs = to - kDay;
    return q;
}

std::vector<int64_t> ids(const HistoryResult& r) {
    std::vector<int64_t> v;
    for (const auto& x : r.page.rows) v.push_back(x.id);
    return v;
}

}  // namespace

TEST(AlarmHistory, EmptyDatabaseGivesNoRows) {
    Fixture f;
    auto r = f.reader().query(day());
    ASSERT_EQ(r.status, HistoryStatus::Ok);
    EXPECT_TRUE(r.page.rows.empty());
    EXPECT_FALSE(r.page.hasMore);
    EXPECT_FALSE(r.page.nextBeforeId.has_value());
}

TEST(AlarmHistory, RangeIsFromInclusiveToExclusiveNewestFirst) {
    Fixture f;
    f.put({row(1, "A", kNow - 3 * kHour), row(2, "A", kNow - 2 * kHour), row(3, "A", kNow - kHour),
           row(4, "A", kNow)});
    HistoryQuery q;
    q.fromMs = kNow - 2 * kHour;
    q.toMs = kNow;
    auto r = f.reader().query(q);
    ASSERT_EQ(r.status, HistoryStatus::Ok);
    EXPECT_EQ(ids(r), (std::vector<int64_t>{3, 2}));  // 2 is in (from), 4 is out (to)
}

TEST(AlarmHistory, AlarmIdFilterMatchesInstanceOrAllLimitsOfADefinition) {
    Fixture f;
    f.put({row(1, "TANK_B1", kNow - 5 * kMin), row(2, "TANK_B1.HH", kNow - 4 * kMin),
           row(3, "TANK_B1.H", kNow - 3 * kMin), row(4, "TANK_B10.HH", kNow - 2 * kMin),
           row(5, "TANKXB1", kNow - kMin), row(6, "TANK_B1.HH", kNow - 30000)});
    HistoryQuery q = day();
    q.alarmId = "TANK_B1.HH";
    EXPECT_EQ(ids(f.reader().query(q)), (std::vector<int64_t>{6, 2}));
    q.alarmId = "TANK_B1";  // the definition: itself and its thresholds, not TANK_B10 or TANKXB1
    EXPECT_EQ(ids(f.reader().query(q)), (std::vector<int64_t>{6, 3, 2, 1}));
}

TEST(AlarmHistory, AreaClassPriorityStateFilters) {
    Fixture f;
    f.put({row(1, "A", kNow - 9 * kMin, 1, "critical", "bon", "x", true),
           row(2, "B", kNow - 8 * kMin, 2, "major", "dien", "x", false),
           row(3, "C", kNow - 7 * kMin, 3, "minor", std::nullopt, "x", true),
           row(4, "D", kNow - 6 * kMin, 4, "advisory", "bon", "x", false)});
    OccurrenceRow acked = row(5, "E", kNow - 5 * kMin, 2, "major", "bon", "x", false);
    acked.tsAckMs = kNow - 4 * kMin;
    acked.ackUser = "vanhanh1";
    f.put({acked});
    auto rd = f.reader();
    HistoryQuery q = day();
    q.area = "bon";
    EXPECT_EQ(ids(rd.query(q)), (std::vector<int64_t>{5, 4, 1}));
    q.area = "";  // Chung: no area
    EXPECT_EQ(ids(rd.query(q)), (std::vector<int64_t>{3}));
    q = day();
    q.classId = "major";
    EXPECT_EQ(ids(rd.query(q)), (std::vector<int64_t>{5, 2}));
    q = day();
    q.priority = 2;  // major or higher
    EXPECT_EQ(ids(rd.query(q)), (std::vector<int64_t>{5, 2, 1}));
    q = day();
    q.state = "active";
    EXPECT_EQ(ids(rd.query(q)), (std::vector<int64_t>{5, 4, 2}));
    q.state = "closed";
    EXPECT_EQ(ids(rd.query(q)), (std::vector<int64_t>{3, 1}));
    q.state = "acked";
    EXPECT_EQ(ids(rd.query(q)), (std::vector<int64_t>{5}));
    q = day();
    q.area = "bon";
    q.priority = 2;
    q.state = "closed";
    EXPECT_EQ(ids(rd.query(q)), (std::vector<int64_t>{1}));
}

TEST(AlarmHistory, PagingByKeyHasNoDuplicateAndNoGap) {
    Fixture f;
    std::vector<OccurrenceRow> rows;
    for (int i = 1; i <= 250; ++i) rows.push_back(row(i, "A", kNow - (300 - i) * kMin));
    // Two rows with the same start time: the id breaks the tie.
    rows.push_back(row(251, "A", kNow - 50 * kMin));
    rows.push_back(row(252, "A", kNow - 50 * kMin));
    f.put(rows);
    auto rd = f.reader();
    HistoryQuery q;
    q.fromMs = kNow - 400 * kMin;
    q.toMs = kNow + kMin;
    q.limit = 7;
    std::set<int64_t> seen;
    std::vector<int64_t> order;
    int pages = 0;
    for (;;) {
        auto r = rd.query(q);
        ASSERT_EQ(r.status, HistoryStatus::Ok);
        for (auto id : ids(r)) {
            EXPECT_TRUE(seen.insert(id).second) << "twice: " << id;
            order.push_back(id);
        }
        ++pages;
        if (!r.page.hasMore) {
            EXPECT_FALSE(r.page.nextBeforeId.has_value());
            break;
        }
        ASSERT_TRUE(r.page.nextBeforeId.has_value());
        EXPECT_EQ(*r.page.nextBeforeId, r.page.rows.back().id);
        q.beforeId = r.page.nextBeforeId;
    }
    EXPECT_EQ(seen.size(), 252u);
    EXPECT_EQ(pages, 36);  // ceil(252 / 7)
    // Exactly `limit` rows left: no next page.
    HistoryQuery last = q;
    last.limit = 252;
    last.beforeId.reset();
    auto r = rd.query(last);
    EXPECT_EQ(r.page.rows.size(), 252u);
    EXPECT_FALSE(r.page.hasMore);
}

TEST(AlarmHistory, LimitAndRangeBounds) {
    Fixture f;
    auto rd = f.reader();
    HistoryQuery q = day();
    q.limit = 0;
    auto r = rd.query(q);
    EXPECT_EQ(r.status, HistoryStatus::BadQuery);
    EXPECT_EQ(r.field, "limit");
    q.limit = 501;
    EXPECT_EQ(rd.query(q).status, HistoryStatus::BadQuery);
    q.limit = 500;
    EXPECT_EQ(rd.query(q).status, HistoryStatus::Ok);
    q.limit = 1;
    EXPECT_EQ(rd.query(q).status, HistoryStatus::Ok);

    q = day();
    q.fromMs = q.toMs;  // from < to is required
    r = rd.query(q);
    EXPECT_EQ(r.status, HistoryStatus::BadQuery);
    EXPECT_EQ(r.field, "from");
    q = day();
    q.fromMs = q.toMs - 366 * kDay;  // exactly 366 days
    EXPECT_EQ(rd.query(q).status, HistoryStatus::Ok);
    q.fromMs -= 1;  // one millisecond more
    r = rd.query(q);
    EXPECT_EQ(r.status, HistoryStatus::BadQuery);
    EXPECT_EQ(r.field, "from");

    q = day();
    q.state = "bogus";
    r = rd.query(q);
    EXPECT_EQ(r.status, HistoryStatus::BadQuery);
    EXPECT_EQ(r.field, "state");
    q = day();
    q.priority = 5;
    EXPECT_EQ(rd.query(q).field, "priority");
    q = day();
    q.q = std::string(81, 'a');
    r = rd.query(q);
    EXPECT_EQ(r.status, HistoryStatus::BadQuery);
    EXPECT_EQ(r.field, "q");
    q.q = std::string(80, 'a');
    EXPECT_EQ(rd.query(q).status, HistoryStatus::Ok);
    q.q.clear();
    for (int i = 0; i < 80; ++i) q.q += "ồ";  // 80 characters, 240 bytes: the limit is characters
    EXPECT_EQ(rd.query(q).status, HistoryStatus::Ok);
    q.beforeId = 999999;  // not an occurrence
    q.q.clear();
    r = rd.query(q);
    EXPECT_EQ(r.status, HistoryStatus::BadQuery);
    EXPECT_EQ(r.field, "beforeId");
    q.beforeId = 0;
    EXPECT_EQ(rd.query(q).field, "beforeId");
}

TEST(AlarmHistory, UnsyncedClockRowsOnlyWithUnsyncedFlag) {
    Fixture f;
    f.put({row(1, "A", 5000, 3, "minor", "bon", "x", true, false),  // 1970: clock not synchronised
           row(2, "A", kNow - kMin), row(3, "A", 9000, 3, "minor", "bon", "x", true, false)});
    auto rd = f.reader();
    HistoryQuery q;
    q.fromMs = 0;  // a range that holds the 1970 start times: they are not in it
    q.toMs = kMaxHistorySpanMs;
    EXPECT_TRUE(rd.query(q).page.rows.empty());
    EXPECT_EQ(ids(rd.query(day())), (std::vector<int64_t>{2}));
    q = day();
    q.unsynced = true;  // from and to ignored; the unsynchronised ones, newest id first
    EXPECT_EQ(ids(rd.query(q)), (std::vector<int64_t>{3, 1}));
    q.beforeId = 3;
    EXPECT_EQ(ids(rd.query(q)), (std::vector<int64_t>{1}));
}

TEST(AlarmHistory, TextSearchIgnoresCaseAndVietnameseMarks) {
    Fixture f;
    f.put({row(1, "A", kNow - 4 * kMin, 3, "minor", "bon", "Bồn B1 QUÁ ÁP"),
           row(2, "B", kNow - 3 * kMin, 3, "minor", "bon", "bơm 2 dừng"),
           row(3, "C", kNow - 2 * kMin, 3, "minor", "bon", "Đèn báo cháy"),
           row(4, "D", kNow - kMin, 3, "minor", std::nullopt, "Mất tín hiệu")});
    auto rd = f.reader();
    auto find = [&](const std::string& s) {
        HistoryQuery q = day();
        q.q = s;
        auto r = rd.query(q);
        EXPECT_EQ(r.status, HistoryStatus::Ok) << s;
        return ids(r);
    };
    EXPECT_EQ(find("bon"), (std::vector<int64_t>{3, 2, 1}));  // "bon" is also the area of the three
    EXPECT_EQ(find("BỒN"), (std::vector<int64_t>{3, 2, 1}));
    EXPECT_EQ(find("qua ap"), (std::vector<int64_t>{1}));
    EXPECT_EQ(find("QUÁ ÁP"), (std::vector<int64_t>{1}));
    EXPECT_EQ(find("den bao"), (std::vector<int64_t>{3}));
    EXPECT_EQ(find("đèn"), (std::vector<int64_t>{3}));
    EXPECT_EQ(find("mat tin"), (std::vector<int64_t>{4}));
    EXPECT_EQ(find("chung"), (std::vector<int64_t>{4}));  // the area name "Chung" is in the text
    EXPECT_EQ(find("   "),
              (std::vector<int64_t>{4, 3, 2, 1}));  // blank text after folding: no filter
}

TEST(AlarmHistory, WildcardsAndHostileTextAreOnlyText) {
    Fixture f;
    f.put({row(1, "A", kNow - 5 * kMin, 3, "minor", "bon", "tỷ lệ 100%"),
           row(2, "B", kNow - 4 * kMin, 3, "minor", "bon", "tên_gọi dài"),
           row(3, "C", kNow - 3 * kMin, 3, "minor", "bon", "đường C:\\dir"),
           row(4, "D", kNow - 2 * kMin, 3, "minor", "bon", "nội dung bình thường"),
           row(5, "E", kNow - kMin, 3, "minor", "bon", "it's \"quoted\"")});
    auto rd = f.reader();
    auto find = [&](const std::string& s) {
        HistoryQuery q = day();
        q.q = s;
        auto r = rd.query(q);
        EXPECT_EQ(r.status, HistoryStatus::Ok) << s;
        return ids(r);
    };
    EXPECT_EQ(find("%"), (std::vector<int64_t>{1}));  // not "everything"
    EXPECT_EQ(find("_"), (std::vector<int64_t>{2}));  // not "any one character"
    EXPECT_EQ(find("\\"), (std::vector<int64_t>{3}));
    EXPECT_EQ(find("100%"), (std::vector<int64_t>{1}));
    EXPECT_EQ(find("%%").size(), 0u);
    EXPECT_EQ(find("\\%").size(), 0u);
    EXPECT_EQ(find("'"), (std::vector<int64_t>{5}));
    EXPECT_EQ(find("\"quoted\""), (std::vector<int64_t>{5}));
    EXPECT_TRUE(find("'; DROP TABLE alarm_occurrence; --").empty());
    EXPECT_TRUE(find("\"; DROP TABLE alarm_occurrence; --").empty());
    // The table is still there and unchanged.
    HistoryQuery q = day();
    EXPECT_EQ(rd.query(q).page.rows.size(), 5u);
    // The same hostile text as an alarm id and as an area changes nothing else.
    q.alarmId = "x' OR '1'='1";
    EXPECT_TRUE(rd.query(q).page.rows.empty());
    q.alarmId.reset();
    q.area = "bon' OR 1=1 --";
    EXPECT_TRUE(rd.query(q).page.rows.empty());
    q.area.reset();
    q.classId = "minor' OR 1=1 --";
    EXPECT_TRUE(rd.query(q).page.rows.empty());
}

TEST(AlarmHistory, RowFieldsRoundTrip) {
    Fixture f;
    OccurrenceRow r =
        row(7, "TANK.HH", kNow - kMin, 1, "critical", "bon", "Mức bồn rất cao", false);
    r.ackUser = "vanhanh1";
    r.tsAckMs = kNow - 30000;
    r.tsReturnMs = kNow - 10000;
    r.tsReturnAckMs = kNow - 5000;
    r.returnAckUser = "vanhanh2";
    r.valueActive = 91.25;
    r.qualityActive = "UNCERTAIN";
    r.reason = "STALE";
    r.flags = 3;
    r.repeatCount = 4;
    r.closed = true;
    r.closedBy = ClosedBy::Config;
    f.put({r});
    auto res = f.reader().query(day());
    ASSERT_EQ(res.page.rows.size(), 1u);
    const OccurrenceRow& g = res.page.rows[0];
    EXPECT_EQ(g.id, 7);
    EXPECT_EQ(g.alarmId, "TANK.HH");
    EXPECT_EQ(g.priority, 1);
    EXPECT_EQ(g.classId, "critical");
    EXPECT_EQ(g.area.value_or("?"), "bon");
    EXPECT_EQ(g.text, "Mức bồn rất cao");
    EXPECT_EQ(g.tsAckMs.value_or(0), kNow - 30000);
    EXPECT_EQ(g.ackUser.value_or(""), "vanhanh1");
    EXPECT_EQ(g.tsReturnMs.value_or(0), kNow - 10000);
    EXPECT_EQ(g.tsReturnAckMs.value_or(0), kNow - 5000);
    EXPECT_EQ(g.returnAckUser.value_or(""), "vanhanh2");
    EXPECT_DOUBLE_EQ(g.valueActive.value_or(0), 91.25);
    EXPECT_EQ(g.qualityActive, "UNCERTAIN");
    EXPECT_EQ(g.reason.value_or(""), "STALE");
    EXPECT_EQ(g.flags, 3);
    EXPECT_EQ(g.repeatCount, 4);
    EXPECT_TRUE(g.closed);
    EXPECT_EQ(g.closedBy, ClosedBy::Config);
    EXPECT_TRUE(g.clockOk);
}

TEST(AlarmHistory, UnavailableWhenTheFileIsMissingThenRecovers) {
    std::string dir = tempDir();
    AlarmHistoryReader rd(dir + "/alarm.db");
    auto r = rd.query(day());
    EXPECT_EQ(r.status, HistoryStatus::Unavailable);
    int64_t now = kNow;
    AlarmStore store(dir, [&] { return now; });
    std::string err;
    ASSERT_TRUE(store.open(err)) << err;
    EXPECT_EQ(rd.query(day()).status, HistoryStatus::Ok);  // the next query opens it
}

TEST(AlarmHistory, FollowsTheFileWhenTheStoreReplacesADamagedOne) {
    Fixture f;
    f.put({row(1, "A", kNow - kMin)});
    auto rd = f.reader();
    ASSERT_EQ(rd.query(day()).page.rows.size(), 1u);
    ASSERT_TRUE(f.store.replaceCorrupt(f.err)) << f.err;  // renamed away, a new file in its place
    auto r = rd.query(day());
    ASSERT_EQ(r.status, HistoryStatus::Ok);
    EXPECT_TRUE(r.page.rows.empty());  // the new file, not the renamed one
}

TEST(AlarmHistory, GateOfTwoQueriesAnswersBusyAfterTheWait) {
    Fixture f;
    f.put({row(1, "A", kNow - kMin)});
    HistoryOptions o;
    o.maxConcurrent = 2;
    o.waitMs = 100;
    o.testQueryDelayMs = 600;
    auto rd = f.reader(o);
    std::atomic<int> ok{0};
    auto run = [&] {
        if (rd.query(day()).status == HistoryStatus::Ok) ++ok;
    };
    std::thread a(run), b(run);
    std::this_thread::sleep_for(std::chrono::milliseconds(150));  // both hold a slot
    const auto t0 = std::chrono::steady_clock::now();
    auto r = rd.query(day());
    const auto waited =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count();
    EXPECT_EQ(r.status, HistoryStatus::Busy);
    EXPECT_GE(waited, 90);
    EXPECT_LT(waited, 500);
    a.join();
    b.join();
    EXPECT_EQ(ok.load(), 2);
    EXPECT_EQ(rd.busyRefusals(), 1u);
    EXPECT_EQ(rd.query(day()).status, HistoryStatus::Ok);  // the slots are free again
}

TEST(AlarmHistory, ABigReadDoesNotBlockTheWriter) {
    Fixture f;
    std::vector<OccurrenceRow> rows;
    for (int i = 1; i <= 20000; ++i) rows.push_back(row(i, "A", kNow - (30000 - i) * 1000));
    f.put(rows);
    HistoryOptions o;
    o.testQueryDelayMs = 400;  // the read holds its connection (and its snapshot) a while
    auto rd = f.reader(o);
    std::atomic<bool> done{false};
    std::thread t([&] {
        HistoryQuery q;
        q.fromMs = kNow - 40 * kDay;
        q.toMs = kNow + kMin;
        q.limit = 500;
        EXPECT_EQ(rd.query(q).status, HistoryStatus::Ok);
        done = true;
    });
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    const auto t0 = std::chrono::steady_clock::now();
    ASSERT_TRUE(f.store.commit({row(20001, "B", kNow)}, {}, {}, f.err)) << f.err;
    const auto ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count();
    EXPECT_FALSE(done.load()) << "the read should still be running";
    EXPECT_LT(ms, 300);
    t.join();
}

TEST(AlarmHistory, QueryPlanUsesATimeIndex) {
    Fixture f;
    f.put({row(1, "A", kNow - kMin)});
    sqlite3_stmt* st = nullptr;
    ASSERT_EQ(sqlite3_prepare_v2(f.store.handle(),
                                 "EXPLAIN QUERY PLAN SELECT id FROM alarm_occurrence WHERE "
                                 "ts_active_ms >= 1 AND ts_active_ms < 2 AND clock_ok = 1 AND "
                                 "priority <= 2 ORDER BY ts_active_ms DESC, id DESC LIMIT 11",
                                 -1, &st, nullptr),
              SQLITE_OK);
    std::string plan;
    while (sqlite3_step(st) == SQLITE_ROW)
        plan += reinterpret_cast<const char*>(sqlite3_column_text(st, 3));
    sqlite3_finalize(st);
    EXPECT_NE(plan.find("alarm_occ_"), std::string::npos) << plan;
    EXPECT_EQ(plan.find("SCAN alarm_occurrence"), std::string::npos) << plan;
}

TEST(AlarmHistory, HundredThousandRowsWithinASecond) {
    Fixture f;
    // 100,000 rows over 90 days, spread over areas and priorities.
    const char* areas[] = {"bon", "dien", "nuoc", "khi"};
    const int64_t t0 = kNow - 90 * kDay;
    for (int base = 0; base < 100000; base += 5000) {
        std::vector<OccurrenceRow> rows;
        for (int i = base + 1; i <= base + 5000; ++i)
            rows.push_back(row(i, "AL" + std::to_string(i % 200), t0 + int64_t(i) * 77760,
                               1 + (i % 4), "minor", areas[i % 4],
                               "Báo động số " + std::to_string(i)));
        f.put(rows);
    }
    auto rd = f.reader();
    HistoryQuery q;
    q.toMs = kNow;
    q.fromMs = kNow - 60 * kDay;
    q.area = "bon";
    q.priority = 2;
    q.limit = 100;
    const auto s = std::chrono::steady_clock::now();
    auto r = rd.query(q);
    const auto ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - s)
            .count();
    ASSERT_EQ(r.status, HistoryStatus::Ok);
    EXPECT_EQ(r.page.rows.size(), 100u);
    EXPECT_TRUE(r.page.hasMore);
    EXPECT_LE(ms, 1000) << "SC-013";
    // A rare text over the same range, scanning the filtered set.
    q.q = "bao dong so 99999";
    const auto s2 = std::chrono::steady_clock::now();
    r = rd.query(q);
    const auto ms2 =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - s2)
            .count();
    ASSERT_EQ(r.status, HistoryStatus::Ok);
    EXPECT_LE(ms2, 1000) << "SC-013 with text";
}
