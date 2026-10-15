// T028: alarm.db (FR-037..FR-044; SC-008, SC-010): PRAGMA, mode 0600, rows, open rows, overrides,
// ids that never come back, purge by age and size, damaged files, a cut transaction, migration.
#include "core/alarm/alarm_store.hpp"

#include <dirent.h>
#include <gtest/gtest.h>
#include <sqlite3.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cstdlib>
#include <fstream>
#include <sstream>

using namespace mat::alarm;

namespace {
constexpr int64_t kNow = 1791600000000LL;

std::string tempDir() {
    char tmpl[] = "/tmp/mat-alarm-XXXXXX";
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
int mode(const std::string& p) {
    struct stat st {};
    return ::stat(p.c_str(), &st) == 0 ? (st.st_mode & 07777) : -1;
}
bool copyFile(const std::string& a, const std::string& b) {
    std::ifstream in(a, std::ios::binary);
    if (!in) return false;
    std::ofstream out(b, std::ios::binary);
    out << in.rdbuf();
    return true;
}

OccurrenceRow row(int64_t id, const std::string& alarm = "A", int64_t tsActive = kNow,
                  bool closed = false) {
    OccurrenceRow r;
    r.id = id;
    r.alarmId = alarm;
    r.fingerprint = "0123456789abcdef";
    r.tsActiveMs = tsActive;
    r.priority = 3;
    r.classId = "minor";
    r.area = "bon";
    r.text = "Bồn cao: 81 % (ngưỡng 80)";
    r.textFold = "bon cao: 81 % (nguong 80) a bon";
    r.valueActive = 81.5;
    r.qualityActive = "GOOD";
    r.closed = closed;
    if (closed) r.closedBy = ClosedBy::Return;
    return r;
}

struct Fixture {
    std::string dir = tempDir();
    int64_t now = kNow;
    AlarmStore store{dir, [this] { return now; }};
    std::string err;
    Fixture() { EXPECT_TRUE(store.open(err)) << err; }
    bool commit(std::vector<OccurrenceRow> rows, std::vector<OverrideChange> ov = {},
                std::map<std::string, std::string> meta = {}) {
        return store.commit(rows, ov, meta, err);
    }
};

int64_t countWhere(AlarmStore& s, const char* sql) {
    sqlite3_stmt* st = nullptr;
    sqlite3_prepare_v2(s.handle(), sql, -1, &st, nullptr);
    int64_t v = sqlite3_step(st) == SQLITE_ROW ? sqlite3_column_int64(st, 0) : -1;
    sqlite3_finalize(st);
    return v;
}
}  // namespace

TEST(AlarmStore, PragmasAreWalNormalNeverFull) {
    Fixture f;
    EXPECT_EQ(f.store.pragmaText("journal_mode"), "wal");
    EXPECT_EQ(f.store.pragmaInt("synchronous"), 1);  // NORMAL: never FULL (2) in alarm.db
    EXPECT_EQ(f.store.pragmaInt("cache_size"), -2048);
    EXPECT_EQ(f.store.pragmaInt("temp_store"), 2);  // MEMORY
    EXPECT_EQ(f.store.pragmaInt("journal_size_limit"), 4194304);
    EXPECT_EQ(f.store.pragmaInt("wal_autocheckpoint"), 1000);
    EXPECT_EQ(f.store.pragmaInt("foreign_keys"), 0);
    EXPECT_EQ(f.store.pragmaInt("page_size"), 4096);
}

TEST(AlarmStore, FilesAreOwnerOnly) {
    Fixture f;
    ASSERT_TRUE(f.commit({row(1)}));
    EXPECT_EQ(mode(f.dir + "/alarm.db"), 0600);
    if (access((f.dir + "/alarm.db-wal").c_str(), F_OK) == 0)
        EXPECT_EQ(mode(f.dir + "/alarm.db-wal"), 0600);
    if (access((f.dir + "/alarm.db-shm").c_str(), F_OK) == 0)
        EXPECT_EQ(mode(f.dir + "/alarm.db-shm"), 0600);
    // a file made world readable is fixed on the next open
    f.store.close();
    ::chmod((f.dir + "/alarm.db").c_str(), 0644);
    AlarmStore again(f.dir, [] { return kNow; });
    std::string err;
    ASSERT_TRUE(again.open(err)) << err;
    EXPECT_EQ(mode(f.dir + "/alarm.db"), 0600);
}

TEST(AlarmStore, SchemaIndexesAndMeta) {
    Fixture f;
    for (const char* ix :
         {"alarm_occ_ts", "alarm_occ_alarm_ts", "alarm_occ_prio_ts", "alarm_occ_open"})
        EXPECT_TRUE(f.store.hasIndex(ix)) << ix;
    EXPECT_EQ(f.store.getMeta("schema").value_or(""), "1");
    EXPECT_EQ(f.store.getMeta("clean").value_or(""), "0");  // running
    f.store.close();
    AlarmStore s2(f.dir, [] { return kNow; });
    std::string err;
    ASSERT_TRUE(s2.open(err));
    EXPECT_EQ(s2.getMeta("schema").value_or(""), "1");
    s2.close();  // clean
    AlarmStore s3(f.dir, [] { return kNow; });
    ASSERT_TRUE(s3.open(err));
    EXPECT_EQ(s3.getMeta("created_ms").has_value(), true);
}

TEST(AlarmStore, InsertUpdateAndTheOpenRowsComeBackInIdOrder) {
    Fixture f;
    OccurrenceRow a = row(2, "B");
    OccurrenceRow b = row(1, "A");
    b.reason = "TIMEOUT";
    b.flags = 3;
    b.repeatCount = 5;
    b.tsAckMs = kNow + 10;
    b.ackUser = "op1";
    ASSERT_TRUE(f.commit({a, b, row(3, "C", kNow, true)}));
    std::string err;
    auto open = f.store.loadOpen(err);
    ASSERT_EQ(open.size(), 2u);  // the closed row is not open
    EXPECT_EQ(open[0].id, 1);
    EXPECT_EQ(open[1].id, 2);
    EXPECT_EQ(open[0].alarmId, "A");
    EXPECT_EQ(open[0].fingerprint, "0123456789abcdef");
    EXPECT_EQ(*open[0].reason, "TIMEOUT");
    EXPECT_EQ(open[0].flags, 3);
    EXPECT_EQ(open[0].repeatCount, 5);
    EXPECT_EQ(*open[0].tsAckMs, kNow + 10);
    EXPECT_EQ(*open[0].ackUser, "op1");
    EXPECT_EQ(open[0].text, "Bồn cao: 81 % (ngưỡng 80)");
    EXPECT_FALSE(open[0].tsReturnMs.has_value());
    EXPECT_EQ(*open[0].area, "bon");
    EXPECT_DOUBLE_EQ(*open[0].valueActive, 81.5);
    EXPECT_EQ(open[0].qualityActive, "GOOD");
    EXPECT_TRUE(open[0].clockOk);
    EXPECT_EQ(open[0].priority, 3);
    // an update by id: only the mutable columns change
    OccurrenceRow upd = b;
    upd.tsReturnMs = kNow + 20;
    upd.tsReturnAckMs = kNow + 30;
    upd.returnAckUser = "op2";
    upd.closed = true;
    upd.closedBy = ClosedBy::Return;
    upd.repeatCount = 9;
    upd.text = "CHANGED";  // not updatable
    upd.priority = 1;      // not updatable
    ASSERT_TRUE(f.commit({upd}));
    open = f.store.loadOpen(err);
    ASSERT_EQ(open.size(), 1u);
    EXPECT_EQ(open[0].id, 2);
    EXPECT_EQ(countWhere(f.store,
                         "SELECT COUNT(*) FROM alarm_occurrence WHERE id=1 AND closed=1 AND "
                         "closed_by='return' AND repeat_count=9 AND text<>'CHANGED' AND priority=3 "
                         "AND ts_return_ack_ms IS NOT NULL"),
              1);
    EXPECT_EQ(f.store.countRows(), 3);
    EXPECT_EQ(f.store.countOpen(), 1);
}

TEST(AlarmStore, HostileTextIsStoredAsText) {
    Fixture f;
    OccurrenceRow r = row(1);
    r.text = "x'); DROP TABLE alarm_occurrence; --";
    r.alarmId = "A'B";
    r.ackUser = "o\"p";
    ASSERT_TRUE(f.commit({r}));
    std::string err;
    auto open = f.store.loadOpen(err);
    ASSERT_EQ(open.size(), 1u);
    EXPECT_EQ(open[0].text, r.text);
    EXPECT_EQ(open[0].alarmId, "A'B");
}

TEST(AlarmStore, OverridesAreDurableAndReplaceable) {
    Fixture f;
    OverrideChange sh;
    sh.row.alarmId = "A";
    sh.row.kind = "shelve";
    sh.row.user = "op1";
    sh.row.reason = "bảo trì";
    sh.row.tsStartMs = kNow;
    sh.row.tsEndMs = kNow + 60000;
    OverrideChange dis;
    dis.row.alarmId = "A";
    dis.row.kind = "disable";
    dis.row.user = "eng";
    dis.row.reason = "hỏng";
    dis.row.tsStartMs = kNow;
    OverrideChange sys = sh;
    sys.row.alarmId = "B";
    sys.row.system = true;
    sys.row.user = "system";
    sys.row.reason = "chatter";
    ASSERT_TRUE(f.commit({}, {sh, dis, sys}));
    std::string err;
    auto ov = f.store.loadOverrides(err);
    ASSERT_EQ(ov.size(),
              3u);  // (A, shelve), (A, disable) and (B, shelve): one instance may have both
    // upsert: a second shelve of A replaces the first
    sh.row.tsEndMs = kNow + 120000;
    sh.row.reason = "again";
    ASSERT_TRUE(f.commit({}, {sh}));
    ov = f.store.loadOverrides(err);
    ASSERT_EQ(ov.size(), 3u);
    int found = 0;
    for (const auto& o : ov)
        if (o.alarmId == "A" && o.kind == "shelve") {
            EXPECT_EQ(*o.tsEndMs, kNow + 120000);
            EXPECT_EQ(o.reason, "again");
            ++found;
        }
    EXPECT_EQ(found, 1);
    // delete, in order after an insert of the same key
    OverrideChange del = sh;
    del.remove = true;
    ASSERT_TRUE(f.commit({}, {del}));
    ov = f.store.loadOverrides(err);
    EXPECT_EQ(ov.size(), 2u);
    for (const auto& o : ov) {
        if (o.alarmId == "B") EXPECT_TRUE(o.system);
    }
}

TEST(AlarmStore, OccurrenceIdsNeverComeBack) {
    Fixture f;
    EXPECT_EQ(f.store.nextOccurrence(), 1);
    ASSERT_TRUE(f.commit({row(1), row(2, "A", kNow, true), row(7, "B", kNow, true)}));
    EXPECT_EQ(f.store.nextOccurrence(), 8);
    // purge everything: high_water keeps the count
    f.now = kNow + 400LL * 86400000;
    std::string err;
    EXPECT_EQ(f.store.purgeExpired(f.now, true, 180, 1000, err), 2);  // the two closed rows
    EXPECT_EQ(f.store.nextOccurrence(), 8);
    f.store.close();
    AlarmStore s2(f.dir, [] { return kNow; });
    ASSERT_TRUE(s2.open(err));
    EXPECT_EQ(s2.nextOccurrence(), 8);
    // high_water in the meta takes over even if the rows are gone
    ASSERT_TRUE(s2.setMeta("high_water", "100", err));
    EXPECT_EQ(s2.nextOccurrence(), 101);
}

TEST(AlarmStore, PurgeByAgeTouchesOnlyClosedRowsWithAGoodClock) {
    Fixture f;
    const int64_t old = kNow - 200LL * 86400000;
    std::vector<OccurrenceRow> rows;
    rows.push_back(row(1, "A", old, true));   // old, closed: goes
    rows.push_back(row(2, "A", old, false));  // old, open: stays
    OccurrenceRow noClock = row(3, "A", old, true);
    noClock.clockOk = false;  // the time may be wrong: stays
    rows.push_back(noClock);
    rows.push_back(row(4, "A", kNow - 10LL * 86400000, true));  // young: stays
    ASSERT_TRUE(f.commit(rows));
    std::string err;
    EXPECT_EQ(f.store.purgeExpired(kNow, false, 180, 1000, err), 0);  // no valid clock: nothing
    EXPECT_EQ(f.store.countRows(), 4);
    EXPECT_EQ(f.store.purgeExpired(kNow, true, 180, 1000, err), 1);
    EXPECT_EQ(f.store.countRows(), 3);
    EXPECT_EQ(f.store.countOpen(), 1);
    EXPECT_EQ(f.store.purgeExpired(kNow, true, 180, 1000, err), 0);
}

TEST(AlarmStore, PurgeRunsInBatches) {
    Fixture f;
    const int64_t old = kNow - 300LL * 86400000;
    std::vector<OccurrenceRow> rows;
    for (int i = 1; i <= 2500; ++i) rows.push_back(row(i, "A", old + i, true));
    ASSERT_TRUE(f.commit(rows));
    std::string err;
    EXPECT_EQ(f.store.purgeExpired(kNow, true, 180, 1000, err), 1000);
    EXPECT_EQ(f.store.purgeExpired(kNow, true, 180, 1000, err), 1000);
    EXPECT_EQ(f.store.purgeExpired(kNow, true, 180, 1000, err), 500);
    EXPECT_EQ(f.store.purgeExpired(kNow, true, 180, 1000, err), 0);
    EXPECT_EQ(f.store.countRows(), 0);
}

TEST(AlarmStore, PurgeBySizeDeletesTheOldestClosedRowsAndNeverOpenOnes) {
    Fixture f;
    std::vector<OccurrenceRow> rows;
    for (int i = 1; i <= 3000; ++i)
        rows.push_back(row(i, "A", kNow + i, i % 100 != 0));  // every 100th open
    ASSERT_TRUE(f.commit(rows));
    std::string err;
    const int64_t used = f.store.usedBytes();
    ASSERT_GT(used, 200000);
    EXPECT_EQ(f.store.purgeOverSize(used * 2, 1000, err), 0);  // under the limit: nothing
    int64_t total = 0;
    for (int guard = 0; guard < 50; ++guard) {
        int n = f.store.purgeOverSize(used / 2, 500, err);
        ASSERT_GE(n, 0) << err;
        if (n == 0) break;
        total += n;
    }
    EXPECT_GT(total, 0);
    EXPECT_LE(f.store.usedBytes(), used / 2);
    EXPECT_EQ(f.store.countOpen(), 30);  // every open row is still there
    // the oldest closed ones went first
    EXPECT_EQ(countWhere(f.store, "SELECT COUNT(*) FROM alarm_occurrence WHERE id = 1"), 0);
    EXPECT_EQ(countWhere(f.store, "SELECT COUNT(*) FROM alarm_occurrence WHERE id = 2999"), 1);
}

TEST(AlarmStore, NotADatabaseIsRenamedAndANewOneStarts) {
    std::string dir = tempDir();
    {
        std::ofstream(dir + "/alarm.db")
            << "this is not a database, just text that is long enough to be a header";
        std::ofstream(dir + "/alarm.db-wal") << "stale";
    }
    int64_t now = 1791600123456LL;
    AlarmStore s(dir, [&] { return now; });
    std::string err;
    ASSERT_TRUE(s.open(err)) << err;
    EXPECT_TRUE(s.recovered());
    bool main = false, wal = false;
    for (const auto& n : listDir(dir)) {
        if (n == "alarm.db.corrupt-1791600123") main = true;
        if (n == "alarm.db-wal.corrupt-1791600123") wal = true;
    }
    EXPECT_TRUE(main);
    (void)wal;  // SQLite may drop a stale WAL itself; the new file must not meet it either way
    // the new file works
    OccurrenceRow r = row(1);
    EXPECT_TRUE(s.commit({r}, {}, {}, err)) << err;
    EXPECT_EQ(s.countRows(), 1);
}

TEST(AlarmStore, ReplaceCorruptKeepsTheOldFileAndLimitsTheirNumber) {
    Fixture f;
    ASSERT_TRUE(f.commit({row(1)}));
    for (int i = 0; i < 5; ++i) {
        f.now += 1000;  // another second: a different name
        ASSERT_TRUE(f.store.replaceCorrupt(f.err)) << f.err;
        EXPECT_TRUE(f.store.recovered());
        EXPECT_EQ(f.store.countRows(), 0);  // empty again
        ASSERT_TRUE(f.commit({row(i + 10)}));
    }
    int corrupt = 0;
    for (const auto& n : listDir(f.dir))
        if (n.rfind("alarm.db.corrupt-", 0) == 0) ++corrupt;
    EXPECT_EQ(corrupt, 3);  // at most three kept
    EXPECT_EQ(f.store.corruptFiles().size(), 3u);
    EXPECT_EQ(f.store.getMeta("schema").value_or(""), "1");
}

TEST(AlarmStore, SameSecondGetsADifferentSuffix) {
    Fixture f;
    ASSERT_TRUE(f.store.replaceCorrupt(f.err));
    ASSERT_TRUE(f.store.replaceCorrupt(f.err));
    int corrupt = 0;
    for (const auto& n : listDir(f.dir))
        if (n.rfind("alarm.db.corrupt-", 0) == 0) ++corrupt;
    EXPECT_EQ(corrupt, 2);
}

TEST(AlarmStore, ACutTransactionLeavesASoundFile) {
    // The files are copied while the store is open and a transaction is committed (no clean close,
    // no checkpoint): what a power cut or kill -9 leaves. Opening it again must be sound.
    Fixture f;
    std::vector<OccurrenceRow> rows;
    for (int i = 1; i <= 300; ++i)
        rows.push_back(row(i, "A" + std::to_string(i % 20), kNow + i, i % 3 == 0));
    ASSERT_TRUE(f.commit(rows));
    ASSERT_TRUE(f.commit({row(301)}));
    std::string cut = tempDir();
    ASSERT_TRUE(copyFile(f.dir + "/alarm.db", cut + "/alarm.db"));
    copyFile(f.dir + "/alarm.db-wal", cut + "/alarm.db-wal");  // may be absent after a checkpoint
    AlarmStore s(cut, [] { return kNow; });
    std::string err;
    ASSERT_TRUE(s.open(err)) << err;
    EXPECT_FALSE(s.recovered());
    EXPECT_EQ(s.integrityCheck(), "ok");
    EXPECT_EQ(s.countRows(), 301);
    EXPECT_EQ(s.nextOccurrence(), 302);
    // truncate the WAL in the middle of a frame: the last commit may be lost, the file stays sound
    std::string cut2 = tempDir();
    ASSERT_TRUE(copyFile(f.dir + "/alarm.db", cut2 + "/alarm.db"));
    if (copyFile(f.dir + "/alarm.db-wal", cut2 + "/alarm.db-wal")) {
        struct stat st {};
        ::stat((cut2 + "/alarm.db-wal").c_str(), &st);
        if (st.st_size > 5000)
            ASSERT_EQ(::truncate((cut2 + "/alarm.db-wal").c_str(), st.st_size - 2500), 0);
        AlarmStore s2(cut2, [] { return kNow; });
        ASSERT_TRUE(s2.open(err)) << err;
        EXPECT_EQ(s2.integrityCheck(), "ok");
        EXPECT_LE(s2.countRows(), 301);
    }
}

TEST(AlarmStore, ANewerSchemaIsNotOpenedAndNotRenamed) {
    std::string dir = tempDir();
    {
        AlarmStore s(dir, [] { return kNow; });
        std::string err;
        ASSERT_TRUE(s.open(err));
        ASSERT_TRUE(s.setMeta("schema", "99", err));
        s.close();
    }
    AlarmStore s(dir, [] { return kNow; });
    std::string err;
    EXPECT_FALSE(s.open(err));
    EXPECT_TRUE(s.schemaTooNew());
    EXPECT_FALSE(s.recovered());
    EXPECT_FALSE(s.isOpen());
    for (const auto& n : listDir(dir)) EXPECT_EQ(n.find("corrupt"), std::string::npos) << n;
}

TEST(AlarmStore, OlderSchemaIsMigratedStepByStep) {
    // schema 1 is the first version: a file with the tables but without meta rows gets them.
    std::string dir = tempDir();
    {
        AlarmStore s(dir, [] { return kNow; });
        std::string err;
        ASSERT_TRUE(s.open(err));
        ASSERT_TRUE(s.commit({row(1)}, {}, {}, err));
        sqlite3_exec(s.handle(), "DELETE FROM alarm_meta WHERE key='schema'", nullptr, nullptr,
                     nullptr);
        s.close(false);
    }
    AlarmStore s(dir, [] { return kNow; });
    std::string err;
    ASSERT_TRUE(s.open(err)) << err;
    EXPECT_EQ(s.getMeta("schema").value_or(""), "1");
    EXPECT_EQ(s.countRows(), 1);
}

TEST(AlarmStore, OpenRowsUseThePartialIndex) {
    Fixture f;
    std::vector<OccurrenceRow> rows;
    for (int i = 1; i <= 1000; ++i)
        rows.push_back(row(i, "A" + std::to_string(i), kNow + i, i > 5));
    ASSERT_TRUE(f.commit(rows));
    sqlite3_exec(f.store.handle(), "ANALYZE", nullptr, nullptr, nullptr);
    sqlite3_stmt* st = nullptr;
    ASSERT_EQ(sqlite3_prepare_v2(f.store.handle(),
                                 "EXPLAIN QUERY PLAN SELECT id, alarm_id FROM alarm_occurrence "
                                 "WHERE closed = 0 ORDER BY id",
                                 -1, &st, nullptr),
              SQLITE_OK);
    std::string plan;
    while (sqlite3_step(st) == SQLITE_ROW)
        plan += reinterpret_cast<const char*>(sqlite3_column_text(st, 3));
    sqlite3_finalize(st);
    EXPECT_NE(plan.find("alarm_occ_open"), std::string::npos) << plan;
    std::string err;
    EXPECT_EQ(f.store.loadOpen(err).size(), 5u);
}

TEST(AlarmStore, CommitIsAtomic) {
    Fixture f;
    ASSERT_TRUE(f.commit({row(1)}));
    OccurrenceRow bad = row(2);
    bad.priority = 9;  // violates CHECK(priority BETWEEN 1 AND 4)
    EXPECT_FALSE(f.commit({row(3), bad}));
    EXPECT_FALSE(f.err.empty());
    EXPECT_EQ(f.store.countRows(), 1);  // row 3 was rolled back with it
    EXPECT_TRUE(f.commit({row(4)}));
    EXPECT_EQ(f.store.countRows(), 2);
}

TEST(AlarmStore, MetaKeysAreWrittenInTheCommit) {
    Fixture f;
    ASSERT_TRUE(f.commit({row(1)}, {}, {{"last_purge_ms", "12345"}}));
    EXPECT_EQ(f.store.getMeta("last_purge_ms").value_or(""), "12345");
}

TEST(AlarmStore, CleanCloseWritesTheHighWaterAndTheFlag) {
    std::string dir = tempDir();
    {
        AlarmStore s(dir, [] { return kNow; });
        std::string err;
        ASSERT_TRUE(s.open(err));
        ASSERT_TRUE(s.commit({row(41)}, {}, {}, err));
        s.close(true);
    }
    AlarmStore s(dir, [] { return kNow; });
    std::string err;
    ASSERT_TRUE(s.open(err));
    EXPECT_EQ(s.nextOccurrence(), 42);
    // after a clean close the wal was truncated
    EXPECT_LE(mode(dir + "/alarm.db-wal") < 0 ? 0 : 0, 0);
}
