// SQLite storage on the device (specs/003-data-logging research R1–R3, data-model §2).
#include "core/historian/local_store.hpp"

#include <dirent.h>
#include <gtest/gtest.h>
#include <unistd.h>

#include <cstdlib>
#include <fstream>
#include <regex>

using namespace mat;

namespace {
constexpr int64_t kT0 = 1791594000000;

std::string tempDir() {
    char tmpl[] = "/tmp/mat-store-XXXXXX";
    const char* d = mkdtemp(tmpl);
    return d ? d : "";
}

std::vector<std::string> listDir(const std::string& dir) {
    std::vector<std::string> out;
    if (DIR* d = opendir(dir.c_str())) {
        while (dirent* e = readdir(d)) out.push_back(e->d_name);
        closedir(d);
    }
    return out;
}

TableSpec spec(const std::string& table, int retention, std::vector<ColumnSpec> cols) {
    TableSpec s;
    s.table = table;
    s.groupId = table + "-g";
    s.retentionDays = retention;
    s.columns = std::move(cols);
    return s;
}

// COUNT is a UINT64 column: no declared type, like sqliteAffinity(TagType::UINT64).
const std::vector<ColumnSpec> kCols{
    {"TANK01_LEVEL", "REAL"}, {"RUN", "INTEGER"}, {"NAME", "TEXT"}, {"COUNT", ""}};

struct Store {
    std::string dir = tempDir();
    LocalStore s{dir, [] { return kT0; }};
    Store() {
        std::string err;
        EXPECT_TRUE(s.open(err)) << err;
    }
};
}  // namespace

TEST(LocalStore, CreatesDatabaseWithWalAndKeepsInstanceId) {
    Store st;
    EXPECT_EQ(st.s.pragmaText("journal_mode"), "wal");
    // NORMAL (Constitution: SQLite WAL, synchronous=NORMAL); review C1 is handled by the
    // forwarder (cursor ahead of the file is rewound)
    EXPECT_EQ(st.s.pragmaInt("synchronous"), 1);
    EXPECT_EQ(st.s.pragmaInt("cache_size"), -8192);
    const std::string id = st.s.instanceId();
    EXPECT_TRUE(std::regex_match(
        id, std::regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")))
        << id;
    EXPECT_FALSE(st.s.recovered());

    LocalStore again(st.dir, [] { return kT0; });
    std::string err;
    ASSERT_TRUE(again.open(err)) << err;
    EXPECT_EQ(again.instanceId(), id);
}

TEST(LocalStore, CreatesWideTablesWithIndexAndMetadata) {
    Store st;
    std::string err;
    ASSERT_TRUE(st.s.ensureTables({spec("van_hanh", 30, kCols)}, err)) << err;
    EXPECT_EQ(st.s.tableColumns("van_hanh"),
              (std::vector<std::string>{"TANK01_LEVEL", "RUN", "NAME", "COUNT"}));
    EXPECT_TRUE(st.s.hasIndex("log_van_hanh_ts"));
    auto meta = st.s.tableMeta("van_hanh");
    ASSERT_TRUE(meta.has_value());
    EXPECT_EQ(meta->groupId, "van_hanh-g");
    EXPECT_EQ(meta->retentionDays, 30);
}

TEST(LocalStore, CommitsRowsInOneTransactionAndReadsThemBack) {
    Store st;
    std::string err;
    ASSERT_TRUE(st.s.ensureTables({spec("t", 7, kCols)}, err)) << err;
    std::vector<PendingRow> rows;
    rows.push_back({0, kT0, {65.2, true, std::string("a,b"), uint64_t{18446744073709551615ULL}}});
    rows.push_back({0, kT0 + 1000, {Cell{}, false, std::string("ệ"), int64_t{-5}}});
    rows.push_back({0, kT0 + 2000, {1.5, Cell{}, Cell{}, uint64_t{42}}});
    ASSERT_TRUE(st.s.commit(rows, err)) << err;

    HistoryReader r;
    ASSERT_TRUE(r.open(st.s.path(), err)) << err;
    std::vector<StoredRow> out;
    ASSERT_TRUE(r.readAfter("t", r.columns("t"), 0, 10, out, err)) << err;
    ASSERT_EQ(out.size(), 3u);
    EXPECT_EQ(out[0].seq, 1);
    EXPECT_EQ(out[0].ts, kT0);
    EXPECT_DOUBLE_EQ(std::get<double>(out[0].cells[0]), 65.2);
    EXPECT_EQ(std::get<int64_t>(out[0].cells[1]), 1);
    EXPECT_EQ(std::get<std::string>(out[0].cells[2]), "a,b");
    EXPECT_EQ(std::get<std::string>(out[0].cells[3]), "18446744073709551615");  // > INT64_MAX: TEXT
    EXPECT_TRUE(std::holds_alternative<std::monostate>(out[1].cells[0]));
    EXPECT_EQ(std::get<int64_t>(out[1].cells[3]), -5);
    EXPECT_EQ(std::get<int64_t>(out[2].cells[3]), 42);

    out.clear();
    ASSERT_TRUE(r.readAfter("t", r.columns("t"), 2, 10, out, err));
    ASSERT_EQ(out.size(), 1u);
    EXPECT_EQ(out[0].seq, 3);
    EXPECT_EQ(r.minSeq("t"), 1);
    EXPECT_EQ(r.maxSeq("t"), 3);
    EXPECT_EQ(r.instanceId(), st.s.instanceId());
    EXPECT_EQ(r.tableOfGroup("t-g"), std::optional<std::string>("t"));
    EXPECT_FALSE(r.tableOfGroup("nope").has_value());
}

TEST(LocalStore, AddsColumnsAndKeepsRemovedOnes) {
    Store st;
    std::string err;
    ASSERT_TRUE(st.s.ensureTables({spec("t", 7, {{"A", "REAL"}, {"B", "REAL"}})}, err));
    ASSERT_TRUE(st.s.commit({{0, kT0, {1.0, 2.0}}}, err));
    ASSERT_TRUE(
        st.s.ensureTables({spec("t", 7, {{"A", "REAL"}, {"B", "REAL"}, {"C", "TEXT"}})}, err))
        << err;
    ASSERT_TRUE(st.s.commit({{0, kT0 + 1, {3.0, 4.0, std::string("x")}}}, err)) << err;
    // B removed from the group: the column stays, new rows leave it empty
    ASSERT_TRUE(st.s.ensureTables({spec("t", 7, {{"A", "REAL"}, {"C", "TEXT"}})}, err)) << err;
    ASSERT_TRUE(st.s.commit({{0, kT0 + 2, {5.0, std::string("y")}}}, err)) << err;
    EXPECT_EQ(st.s.tableColumns("t"), (std::vector<std::string>{"A", "B", "C"}));

    HistoryReader r;
    ASSERT_TRUE(r.open(st.s.path(), err));
    std::vector<StoredRow> out;
    ASSERT_TRUE(r.readAfter("t", {"A", "B", "C"}, 0, 10, out, err)) << err;
    ASSERT_EQ(out.size(), 3u);
    EXPECT_TRUE(std::holds_alternative<std::monostate>(out[0].cells[2]));  // C did not exist
    EXPECT_TRUE(std::holds_alternative<std::monostate>(out[2].cells[1]));  // B removed
    EXPECT_EQ(std::get<std::string>(out[2].cells[2]), "y");
}

TEST(LocalStore, OrphanTableKeepsItsLastRetention) {
    Store st;
    std::string err;
    ASSERT_TRUE(
        st.s.ensureTables({spec("a", 7, {{"X", "REAL"}}), spec("b", 30, {{"Y", "REAL"}})}, err));
    ASSERT_TRUE(st.s.ensureTables({spec("a", 14, {{"X", "REAL"}})}, err));  // group b removed
    EXPECT_EQ(st.s.tableColumns("b"), (std::vector<std::string>{"Y"}));
    EXPECT_EQ(st.s.tableMeta("b")->retentionDays, 30);
    EXPECT_EQ(st.s.tableMeta("a")->retentionDays, 14);
}

TEST(LocalStore, SeqNeverGoesBackAfterDeletingEverything) {
    Store st;
    std::string err;
    ASSERT_TRUE(st.s.ensureTables({spec("t", 7, {{"X", "REAL"}})}, err));
    ASSERT_TRUE(st.s.commit({{0, kT0, {1.0}}, {0, kT0, {2.0}}, {0, kT0, {3.0}}}, err));
    ASSERT_TRUE(st.s.exec("DELETE FROM \"log_t\"", err)) << err;
    ASSERT_TRUE(st.s.commit({{0, kT0, {4.0}}}, err));
    HistoryReader r;
    ASSERT_TRUE(r.open(st.s.path(), err));
    std::vector<StoredRow> out;
    ASSERT_TRUE(r.readAfter("t", {"X"}, 0, 10, out, err));
    ASSERT_EQ(out.size(), 1u);
    EXPECT_EQ(out[0].seq, 4);
}

// ---- US2: retention and size cap (research R4)

namespace {
constexpr int64_t kDay = 86400000;
int64_t countRows(LocalStore& s, const std::string& table) {
    HistoryReader r;
    std::string err;
    if (!r.open(s.path(), err)) return -1;
    std::vector<StoredRow> out;
    r.readAfter(table, {}, 0, 1000000, out, err);
    return static_cast<int64_t>(out.size());
}
}  // namespace

TEST(LocalStore, RetentionDeletesRowsOlderThanTheCutoff) {
    Store st;
    std::string err;
    ASSERT_TRUE(st.s.ensureTables({spec("t", 7, {{"X", "REAL"}})}, err));
    std::vector<PendingRow> rows;
    for (int d = -10; d <= 0; ++d) rows.push_back({0, kT0 + d * kDay, {1.0 * d}});
    rows.push_back({0, kT0 + kDay, {99.0}});  // clock was ahead once: kept
    ASSERT_TRUE(st.s.commit(rows, err));
    EXPECT_EQ(st.s.deleteExpired("t", kT0 - 7 * kDay, 2000, err), 3) << err;  // -10, -9, -8 days
    EXPECT_EQ(countRows(st.s, "t"), 9);
    EXPECT_EQ(st.s.deleteExpired("t", kT0 - 7 * kDay, 2000, err), 0);
}

TEST(LocalStore, RetentionWorksInBatches) {
    Store st;
    std::string err;
    ASSERT_TRUE(st.s.ensureTables({spec("t", 7, {{"X", "REAL"}})}, err));
    std::vector<PendingRow> rows(5000, PendingRow{0, kT0 - 30 * kDay, {1.0}});
    ASSERT_TRUE(st.s.commit(rows, err));
    EXPECT_EQ(st.s.deleteExpired("t", kT0 - 7 * kDay, 2000, err), 2000);
    EXPECT_EQ(st.s.deleteExpired("t", kT0 - 7 * kDay, 2000, err), 2000);
    EXPECT_EQ(st.s.deleteExpired("t", kT0 - 7 * kDay, 2000, err), 1000);
    EXPECT_EQ(st.s.deleteExpired("t", kT0 - 7 * kDay, 2000, err), 0);
}

TEST(LocalStore, RetentionTargetsIncludeOrphanTables) {
    Store st;
    std::string err;
    ASSERT_TRUE(
        st.s.ensureTables({spec("a", 7, {{"X", "REAL"}}), spec("b", 30, {{"Y", "REAL"}})}, err));
    ASSERT_TRUE(st.s.ensureTables({spec("a", 14, {{"X", "REAL"}})}, err));  // b is an orphan now
    auto t = st.s.retentionTargets();
    ASSERT_EQ(t.size(), 2u);
    EXPECT_EQ(t[0], (std::pair<std::string, int>{"a", 14}));
    EXPECT_EQ(t[1], (std::pair<std::string, int>{"b", 30}));
}

TEST(LocalStore, PurgeOldestTakesTheOldestTableFirstAndFreesSpace) {
    Store st;
    std::string err;
    ASSERT_TRUE(
        st.s.ensureTables({spec("a", 7, {{"S", "TEXT"}}), spec("b", 7, {{"S", "TEXT"}})}, err));
    const std::string big(400, 'x');
    std::vector<PendingRow> rows;
    for (int i = 0; i < 1000; ++i) rows.push_back({0, kT0 - 2000 + i, {big}});  // a: older
    for (int i = 0; i < 1000; ++i) rows.push_back({1, kT0 - 1000 + i, {big}});  // b: newer
    ASSERT_TRUE(st.s.commit(rows, err));
    const int64_t before = st.s.usedBytes();
    EXPECT_GT(before, 2000 * 400);
    EXPECT_EQ(st.s.purgeOldest(600, err), 600);
    EXPECT_EQ(countRows(st.s, "a"), 400);
    EXPECT_EQ(countRows(st.s, "b"), 1000);
    EXPECT_EQ(st.s.purgeOldest(600, err), 400);  // only `a`, the table with the oldest row
    EXPECT_EQ(countRows(st.s, "a"), 0);
    EXPECT_EQ(st.s.purgeOldest(600, err), 600);  // then `b`
    EXPECT_LT(st.s.usedBytes(), before / 2);
}

TEST(LocalStore, CorruptFileIsRenamedAndRecreated) {
    const std::string dir = tempDir();
    {
        std::ofstream f(dir + "/history.db", std::ios::binary);
        for (int i = 0; i < 200; ++i) f << "this is not a sqlite database ";
    }
    LocalStore s(dir, [] { return kT0; });
    std::string err;
    ASSERT_TRUE(s.open(err)) << err;
    EXPECT_TRUE(s.recovered());
    bool renamed = false;
    for (const auto& n : listDir(dir))
        if (n.rfind("history.db.corrupt-", 0) == 0) renamed = true;
    EXPECT_TRUE(renamed);
    ASSERT_TRUE(s.ensureTables({spec("t", 7, {{"X", "REAL"}})}, err)) << err;
    EXPECT_TRUE(s.commit({{0, kT0, {1.0}}}, err)) << err;
}

// ---- review fixes (C1, C2, I4, I6, S8)

// A Tag column named rowid hides the real rowid in SQLite: retention and the size cap must not
// depend on it (review C2).
TEST(LocalStore, ColumnNamedRowidDoesNotChangeWhatIsDeleted) {
    Store st;
    std::string err;
    ASSERT_TRUE(st.s.ensureTables({spec("r", 7, {{"rowid", "INTEGER"}})}, err)) << err;
    std::vector<PendingRow> rows;
    for (int i = 0; i < 6; ++i)  // 3 old rows, 3 recent; the "rowid" column holds 0/1
        rows.push_back({0, i < 3 ? kT0 - 10 * 86400000LL : kT0, {int64_t{i % 2}}});
    ASSERT_TRUE(st.s.commit(rows, err)) << err;
    EXPECT_EQ(st.s.deleteExpired("r", kT0 - 86400000LL, 100, err), 3);
    HistoryReader r;
    ASSERT_TRUE(r.open(st.dir + "/history.db", err)) << err;
    std::vector<StoredRow> left;
    ASSERT_TRUE(r.readAfter("r", {"rowid"}, 0, 100, left, err)) << err;
    ASSERT_EQ(left.size(), 3u);
    EXPECT_EQ(left[0].seq, 4);
    EXPECT_EQ(st.s.purgeOldest(1, err), 1);
    left.clear();
    ASSERT_TRUE(r.readAfter("r", {"rowid"}, 0, 100, left, err)) << err;
    ASSERT_EQ(left.size(), 2u);
    EXPECT_EQ(left[0].seq, 5);
}

// Forwarding cursors go in the same transaction as the rows (no extra eMMC write, review S8),
// and carry the instance id of the file they belong to (review I4).
TEST(LocalStore, CommitCanCarryForwardingCursors) {
    Store st;
    std::string err;
    ASSERT_TRUE(st.s.ensureTables({spec("t", 7, kCols)}, err)) << err;
    ASSERT_TRUE(st.s.commit({{0, kT0, {1.0, int64_t{1}, std::string("a"), int64_t{1}}}}, err,
                            {{"influx", "t", 42, st.s.instanceId()}}))
        << err;
    HistoryReader r;
    ASSERT_TRUE(r.open(st.dir + "/history.db", err)) << err;
    EXPECT_EQ(r.forwardCursors("influx")["t"], 42);
    // cursors alone
    ASSERT_TRUE(st.s.commit({}, err, {{"influx", "t", 43, st.s.instanceId()}})) << err;
    EXPECT_EQ(r.forwardCursors("influx")["t"], 43);
}

// The highest seq ever given stays known after every row was deleted (review C1: a destination
// cursor above it means the device data went back).
TEST(LocalStore, LastSeqEverSurvivesDeletingEveryRow) {
    Store st;
    std::string err;
    ASSERT_TRUE(st.s.ensureTables({spec("t", 7, kCols)}, err)) << err;
    HistoryReader r;
    ASSERT_TRUE(r.open(st.dir + "/history.db", err)) << err;
    EXPECT_EQ(r.lastSeqEver("t"), 0);
    std::vector<PendingRow> rows(5, PendingRow{0, kT0, {Cell{}, Cell{}, Cell{}, Cell{}}});
    ASSERT_TRUE(st.s.commit(rows, err)) << err;
    ASSERT_TRUE(st.s.exec("DELETE FROM log_t", err)) << err;
    EXPECT_EQ(r.lastSeqEver("t"), 5);
    EXPECT_FALSE(r.maxSeq("t").has_value());
}

// A damaged data page found by a commit: the file is kept under a new name and a new one is
// created (data-model §3, review I6).
TEST(LocalStore, ReplaceCorruptKeepsTheOldFileAndStartsANewOne) {
    Store st;
    std::string err;
    ASSERT_TRUE(st.s.ensureTables({spec("t", 7, kCols)}, err)) << err;
    ASSERT_TRUE(st.s.commit({{0, kT0, {1.0, int64_t{1}, std::string("a"), int64_t{1}}}}, err))
        << err;
    const std::string oldId = st.s.instanceId();
    ASSERT_TRUE(st.s.replaceCorrupt(err)) << err;
    EXPECT_TRUE(st.s.recovered());
    EXPECT_NE(st.s.instanceId(), oldId);
    bool kept = false;
    for (const auto& f : listDir(st.dir)) kept = kept || f.rfind("history.db.corrupt-", 0) == 0;
    EXPECT_TRUE(kept);
    ASSERT_TRUE(st.s.ensureTables({spec("t", 7, kCols)}, err)) << err;
    HistoryReader r;
    ASSERT_TRUE(r.open(st.dir + "/history.db", err)) << err;
    EXPECT_FALSE(r.maxSeq("t").has_value());  // a new, empty file
}

// Review I4: a forwarder may still hand over a cursor of the file that was just replaced; it does
// not count in the new one.
TEST(LocalStore, CursorsOfAnotherFileAreIgnored) {
    Store st;
    std::string err;
    ASSERT_TRUE(st.s.ensureTables({spec("t", 7, kCols)}, err)) << err;
    ASSERT_TRUE(st.s.commit({}, err, {{"db1", "t", 9, "an-old-file"}, {"db2", "t", 4, ""}})) << err;
    HistoryReader r;
    ASSERT_TRUE(r.open(st.dir + "/history.db", err)) << err;
    EXPECT_TRUE(r.forwardCursors("db1").empty());
    EXPECT_EQ(r.forwardCursors("db2")["t"], 4);
}

// Review of the fixes (minor 5): a reader that has no use for more rows (the export's output
// failed) stops the scan.
TEST(LocalStore, ReadRangeStopsWhenTheCallbackSaysSo) {
    Store st;
    std::string err;
    ASSERT_TRUE(st.s.ensureTables({spec("t", 7, kCols)}, err)) << err;
    std::vector<PendingRow> rows(5, PendingRow{0, kT0, {Cell{}, Cell{}, Cell{}, Cell{}}});
    ASSERT_TRUE(st.s.commit(rows, err)) << err;
    HistoryReader r;
    ASSERT_TRUE(r.open(st.s.path(), err)) << err;
    int seen = 0;
    EXPECT_TRUE(r.readRange(
        "t", {}, INT64_MIN, INT64_MAX, [&](const StoredRow&) { return ++seen < 2; }, err))
        << err;
    EXPECT_EQ(seen, 2);
}

// The historian hands the highest seq of every table at open to the forwarders (review C1).
TEST(LocalStore, LastSeqEverOfTheWriter) {
    Store st;
    std::string err;
    ASSERT_TRUE(st.s.ensureTables({spec("t", 7, kCols)}, err)) << err;
    EXPECT_EQ(st.s.lastSeqEver("t"), 0);
    std::vector<PendingRow> rows(3, PendingRow{0, kT0, {Cell{}, Cell{}, Cell{}, Cell{}}});
    ASSERT_TRUE(st.s.commit(rows, err)) << err;
    ASSERT_TRUE(st.s.exec("DELETE FROM log_t", err)) << err;
    EXPECT_EQ(st.s.lastSeqEver("t"), 3);
}

// Review C1 (follow-up): the mark of a forwarding key stays, unchanged, until it is cleared: a
// runtime restarted before its forwarder could check the destination keeps the older mark. The
// value is the seq the historian read at open, so that a mark stored only later (the first try
// failed) is still the one of the start (review of the fixes, Important 3).
TEST(LocalStore, ForwardMarksStayUntilCleared) {
    Store st;
    std::string err;
    ASSERT_TRUE(st.s.ensureTables({spec("t", 7, kCols)}, err)) << err;
    std::map<std::pair<std::string, std::string>, int64_t> marks;
    ASSERT_TRUE(st.s.keepForwardMarks({{{"db1", "t"}, 3}}, marks, err)) << err;
    EXPECT_EQ((marks[{"db1", "t"}]), 3);
    ASSERT_TRUE(st.s.keepForwardMarks({{{"db1", "t"}, 6}, {{"db2", "t"}, 6}}, marks, err)) << err;
    EXPECT_EQ((marks[{"db1", "t"}]), 3);  // kept
    EXPECT_EQ((marks[{"db2", "t"}]), 6);
    ASSERT_TRUE(st.s.clearForwardMarks({{"db1", "t"}}, err)) << err;
    EXPECT_EQ(st.s.pragmaInt("synchronous"), 1);  // NORMAL again after the one synced deletion
    ASSERT_TRUE(st.s.keepForwardMarks({{{"db1", "t"}, 6}}, marks, err)) << err;
    EXPECT_EQ((marks[{"db1", "t"}]), 6);  // a new mark
}

// Two damaged files replaced within the same second are both kept.
TEST(LocalStore, DamagedFilesReplacedInTheSameSecondAreAllKept) {
    Store st;  // its clock does not move
    std::string err;
    ASSERT_TRUE(st.s.ensureTables({spec("t", 7, kCols)}, err)) << err;
    ASSERT_TRUE(st.s.replaceCorrupt(err)) << err;
    ASSERT_TRUE(st.s.replaceCorrupt(err)) << err;
    int kept = 0;
    for (const auto& f : listDir(st.dir)) kept += f.rfind("history.db.corrupt-", 0) == 0 ? 1 : 0;
    EXPECT_EQ(kept, 2);
}
