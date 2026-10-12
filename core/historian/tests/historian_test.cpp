// The historian pass: sample → buffer → commit (specs/003-data-logging research R3, data-model §3).
// Driven by runOnce() with fake clocks; no thread.
#include "core/historian/historian.hpp"

#include <dirent.h>
#include <fcntl.h>
#include <gtest/gtest.h>
#include <unistd.h>

#include <map>
#include <mutex>

#include "sqlite3.h"

using namespace mat;

namespace {
constexpr int64_t kT0 = 1791594000000;

std::string tempDir() {
    char tmpl[] = "/tmp/mat-hist-XXXXXX";
    const char* d = mkdtemp(tmpl);
    return d ? d : "";
}

struct Fixture {
    TagStore store;
    int64_t wall = kT0;
    int64_t mono = 0;
    std::string dir;
    std::unique_ptr<Historian> h;

    explicit Fixture(HistorianOptions opt = {}, int64_t start = kT0,
                     std::vector<ConnectionModel> conns = {},
                     std::vector<std::string> destinations = {}, std::string useDir = "")
        : wall(start), dir(useDir.empty() ? tempDir() : useDir) {
        store.add({"T.V", TagType::FLOAT64, ""});
        store.set(0, 1.5, Quality::GOOD, 0, 0);
        LoggingModel m;
        LoggingGroupModel g;
        g.id = "g";
        g.name = "G";
        g.table = "g";
        g.mode = LogMode::Cyclic;
        g.periodMs = 1000;
        g.retentionDays = 7;
        g.columns.push_back({"T.V", 0, TagType::FLOAT64, "V", 0, 255});
        g.destinations = destinations;
        m.groups.push_back(g);
        m.connections = conns;
        opt.dataDir = dir;
        opt.clockFloorMs = kT0 - 86400000;  // kT0 is valid, 1970 is not (build time is later)
        h = std::make_unique<Historian>(
            m, store, opt, [this] { return wall; }, [this] { return mono; });
        std::string err;
        EXPECT_TRUE(h->open(err)) << err;
    }
    // `ms` of passes every 100 ms
    void run(int64_t ms) {
        for (int64_t t = 0; t < ms; t += 100) {
            h->runOnce();
            wall += 100;
            mono += 100;
        }
    }
    int64_t rowsInDb() {
        HistoryReader r;
        std::string err;
        if (!r.open(dir + "/history.db", err)) return -1;
        std::vector<StoredRow> out;
        r.readAfter("g", {"V"}, 0, 100000, out, err);
        return static_cast<int64_t>(out.size());
    }
};
}  // namespace

TEST(Historian, CommitsEveryCommitInterval) {
    HistorianOptions o;
    o.commitMs = 5000;
    Fixture f(o);
    f.run(4900);
    EXPECT_EQ(f.h->status().rowsWritten, 0u);  // rows at 1 s … 4 s are buffered
    EXPECT_EQ(f.rowsInDb(), 0);
    f.run(200);  // the pass at 5.0 s samples and commits
    EXPECT_EQ(f.h->status().rowsWritten, 5u);
    EXPECT_EQ(f.rowsInDb(), 5);
    EXPECT_GT(f.h->status().lastCommitAt, 0);
    f.run(5000);
    EXPECT_EQ(f.rowsInDb(), 10);
    EXPECT_EQ(f.h->status().state, HistorianState::Running);
}

TEST(Historian, CommitsEarlyWhenTheBufferIsFull) {
    HistorianOptions o;
    o.commitMs = 60000;
    o.commitRows = 2;
    Fixture f(o);
    f.run(2100);
    EXPECT_EQ(f.rowsInDb(), 2);
}

TEST(Historian, StopCommitsWhatIsBuffered) {
    HistorianOptions o;
    o.commitMs = 60000;
    Fixture f(o);
    f.run(3100);
    EXPECT_EQ(f.rowsInDb(), 0);
    f.h->stop();
    EXPECT_EQ(f.rowsInDb(), 3);
}

TEST(Historian, WriteErrorsKeepTheNewestRowsAndRetry) {
    HistorianOptions o;
    o.commitMs = 1000;
    o.maxBufferedRows = 5;
    o.retryMs = 10000;
    Fixture f(o);
    std::string err;
    ASSERT_TRUE(f.h->storeForTest().exec("PRAGMA query_only=1", err)) << err;
    f.run(10100);  // 10 rows produced, none written
    auto s = f.h->status();
    EXPECT_EQ(s.state, HistorianState::Error);
    EXPECT_EQ(s.lastErrorCode, "io");
    EXPECT_EQ(s.rowsWritten, 0u);
    EXPECT_EQ(s.rowsDropped, 5u);
    ASSERT_TRUE(f.h->storeForTest().exec("PRAGMA query_only=0", err)) << err;
    f.run(10100);  // retry after retryMs; then normal commits
    s = f.h->status();
    EXPECT_EQ(s.state, HistorianState::Running);
    EXPECT_GE(f.rowsInDb(), 15);  // the 5 newest buffered rows + the following ones
    EXPECT_EQ(s.rowsDropped, 5u);
}

// ---- US2: maintenance (research R4)

namespace {
constexpr int64_t kDay = 86400000;
}

TEST(HistorianMaintenance, RetentionRunsAtStartThenHourlyOneBatchPerPass) {
    HistorianOptions o;
    o.commitMs = 1000;
    o.batchRows = 2000;
    Fixture f(o);
    std::string err;
    std::vector<PendingRow> old(5000, PendingRow{0, kT0 - 10 * kDay, {1.0}});
    old.push_back({0, kT0 - kDay, {2.0}});
    ASSERT_TRUE(f.h->storeForTest().commit(old, err)) << err;
    f.run(100);  // first pass: one batch only
    EXPECT_EQ(f.rowsInDb(), 3001);
    EXPECT_EQ(f.h->status().lastRetentionAt, 0);  // not finished yet
    f.run(200);
    EXPECT_EQ(f.rowsInDb(), 1);
    f.run(100);
    auto s = f.h->status();
    EXPECT_GT(s.lastRetentionAt, 0);
    EXPECT_EQ(s.lastRetentionRows, 5000u);
    // the next run comes an hour later
    ASSERT_TRUE(f.h->storeForTest().commit({{0, kT0 - 20 * kDay, {3.0}}}, err));
    auto oldRows = [&] {
        HistoryReader r;
        std::string e;
        int64_t n = 0;
        if (r.open(f.dir + "/history.db", e))
            r.readRange(
                "g", {"V"}, 0, kT0 - 10 * kDay,
                [&](const StoredRow&) {
                    ++n;
                    return true;
                },
                e);
        return n;
    };
    f.run(3000 * 1000 - 400);
    EXPECT_EQ(oldRows(), 1);  // still there after 50 minutes
    f.run(700 * 1000);        // past one hour since the first run
    EXPECT_EQ(oldRows(), 0);
    EXPECT_EQ(f.h->status().lastRetentionRows, 1u);
}

TEST(HistorianMaintenance, SizeCapPurgesTheOldestRows) {
    HistorianOptions o;
    o.commitMs = 1000;
    o.maxDbBytes = 256 * 1024;
    Fixture f(o);
    std::string err;
    std::vector<PendingRow> rows;
    for (int i = 0; i < 30000; ++i) rows.push_back({0, kT0 - 30000 + i, {1.0 * i}});
    ASSERT_TRUE(f.h->storeForTest().commit(rows, err)) << err;
    EXPECT_GT(f.h->storeForTest().usedBytes(), o.maxDbBytes);
    f.run(2000);  // first check at start, then one purge batch per pass
    auto s = f.h->status();
    EXPECT_EQ(s.capPurges, 1u);
    EXPECT_GT(s.capRowsDeleted, 0u);
    EXPECT_LE(s.dbBytes, o.maxDbBytes);
    EXPECT_EQ(s.dbMaxBytes, o.maxDbBytes);
    HistoryReader r;
    ASSERT_TRUE(r.open(f.dir + "/history.db", err));
    EXPECT_GT(*r.minSeq("g"), 1);  // the oldest rows went first
}

TEST(HistorianMaintenance, LowDiskPausesWritingWithHysteresis) {
    HistorianOptions o;
    o.commitMs = 1000;
    o.minFreeBytes = 500LL << 20;
    int64_t freeNow = 100LL << 20;
    o.freeBytes = [&freeNow](const std::string&) { return freeNow; };
    Fixture f(o);
    f.run(5000);
    auto s = f.h->status();
    EXPECT_EQ(s.state, HistorianState::PausedLowDisk);
    EXPECT_EQ(s.freeBytes, 100LL << 20);
    EXPECT_EQ(f.rowsInDb(), 0);
    freeNow = 540LL << 20;  // above the threshold but within the 50 MB hysteresis
    f.run(61000);
    EXPECT_EQ(f.h->status().state, HistorianState::PausedLowDisk);
    freeNow = 560LL << 20;
    f.run(61000);
    EXPECT_EQ(f.h->status().state, HistorianState::Running);
    EXPECT_GT(f.rowsInDb(), 0);
}

TEST(Historian, InvalidClockWritesNothing) {
    HistorianOptions o;
    o.commitMs = 1000;
    Fixture f(o, /*start=*/0);  // RTC lost: 1970
    f.run(5000);
    auto s = f.h->status();
    EXPECT_EQ(s.state, HistorianState::ClockInvalid);
    EXPECT_FALSE(s.clockValid);
    EXPECT_EQ(f.rowsInDb(), 0);
    f.wall = kT0;  // NTP sets the clock
    f.run(3100);
    s = f.h->status();
    EXPECT_EQ(s.state, HistorianState::Running);
    EXPECT_TRUE(s.clockValid);
    EXPECT_EQ(s.clockJumps, 1u);
    EXPECT_GE(f.rowsInDb(), 2);
}

// ---- US3: forwarding (research R8, R12)

namespace {

struct MemDb {
    std::mutex mu;
    std::vector<StoredRow> rows;
    std::vector<std::string> types;  // connection type of every destination made
    bool transactional = false;      // true: keeps its cursor, like a SQL destination
    std::map<std::string, int64_t> cursor;
    std::vector<int64_t> cursorOnly;  // lastSeq of batches without rows
};

class MemDestination : public Destination {
   public:
    explicit MemDestination(std::shared_ptr<MemDb> db) : db_(std::move(db)) {}
    bool transactional() const override { return db_->transactional; }
    size_t batchRows(const DestTable&) const override { return 100; }
    bool connect(const std::string&, DestError&) override { return true; }
    bool syncSchema(const std::string&, const std::vector<DestTable>&, DestError&) override {
        return true;
    }
    bool readCursor(const std::string&, const std::string& table, int64_t& seq,
                    DestError&) override {
        std::lock_guard<std::mutex> g(db_->mu);
        seq = db_->cursor[table];
        return true;
    }
    bool writeBatch(const std::string&, const DestTable& t, const std::vector<StoredRow>& rows,
                    int64_t /*prevSeq*/, int64_t lastSeq, DestError&) override {
        std::lock_guard<std::mutex> g(db_->mu);
        db_->rows.insert(db_->rows.end(), rows.begin(), rows.end());
        if (rows.empty()) db_->cursorOnly.push_back(lastSeq);
        if (db_->transactional) db_->cursor[t.name] = lastSeq;
        return true;
    }
    void close() override {}

   private:
    std::shared_ptr<MemDb> db_;
};

ConnectionModel influx(const std::string& id) {
    ConnectionModel c;
    c.id = id;
    c.type = DbType::InfluxDb;
    c.url = "http://influx:8086";
    c.org = "o";
    c.bucket = "b";
    c.tls = TlsMode::Disable;
    c.offsetMin = 0;
    return c;
}

HistorianOptions forwardingOptions(std::shared_ptr<MemDb> db) {
    HistorianOptions o;
    o.commitMs = 1000;
    o.secret = [](const std::string&) {
        SecretResult r;
        r.ok = true;
        r.secret = "token";
        return r;
    };
    o.makeDestination = [db](const ConnectionModel& c) -> std::unique_ptr<Destination> {
        db->types.push_back(dbTypeName(c.type));
        return std::make_unique<MemDestination>(db);
    };
    return o;
}

}  // namespace

TEST(HistorianForwarding, OnlyConnectionsUsedByAGroupGetAForwarder) {
    auto db = std::make_shared<MemDb>();
    Fixture f(forwardingOptions(db), kT0, {influx("in1"), influx("spare")}, {"in1"});
    ASSERT_EQ(f.h->forwardersForTest().size(), 1u);
    EXPECT_EQ(f.h->forwardersForTest()[0]->connection().id, "in1");
    EXPECT_EQ(db->types, std::vector<std::string>{"influxdb"});
    const auto s = f.h->status();
    ASSERT_EQ(s.destinations.size(), 1u);
    EXPECT_EQ(s.destinations[0].id, "in1");
    EXPECT_EQ(s.destinations[0].type, "influxdb");
}

TEST(HistorianForwarding, CommittedRowsAreSentAndTheDeviceCursorSavedAtTheNextCommit) {
    auto db = std::make_shared<MemDb>();
    Fixture f(forwardingOptions(db), kT0, {influx("in1")}, {"in1"});
    f.run(3100);  // rows at 1, 2, 3 s, committed every second
    ASSERT_EQ(f.rowsInDb(), 3);
    Forwarder& fw = *f.h->forwardersForTest()[0];
    for (int i = 0; i < 100 && fw.runOnce(); ++i) {
    }
    EXPECT_EQ(db->rows.size(), 3u);
    EXPECT_EQ(f.h->status().destinations[0].sentRows, 3u);
    f.run(1000);  // the historian saves the cursor the forwarder reached
    HistoryReader r;
    std::string err;
    ASSERT_TRUE(r.open(f.dir + "/history.db", err)) << err;
    EXPECT_EQ(r.forwardCursors(forwardCursorKey(influx("in1")))["g"], 3);
}

TEST(HistorianForwarding, StopSavesTheLastCursor) {
    auto db = std::make_shared<MemDb>();
    HistorianOptions o = forwardingOptions(db);
    o.commitMs = 60000;
    Fixture f(o, kT0, {influx("in1")}, {"in1"});
    f.run(2100);
    f.h->stop();  // commits rows 1 and 2
    Forwarder& fw = *f.h->forwardersForTest()[0];
    for (int i = 0; i < 100 && fw.runOnce(); ++i) {
    }
    ASSERT_EQ(db->rows.size(), 2u);
    f.h->stop();  // stopping again: nothing to commit, the cursor is saved
    HistoryReader r;
    std::string err;
    ASSERT_TRUE(r.open(f.dir + "/history.db", err)) << err;
    EXPECT_EQ(r.forwardCursors(forwardCursorKey(influx("in1")))["g"], 2);
}

// Review S8: a cursor goes to the eMMC with the next rows; without rows to commit, alone at most
// once a minute (not one more fsync every commit interval).
TEST(HistorianForwarding, CursorsWithoutRowsAreSavedAtMostOnceAMinute) {
    auto db = std::make_shared<MemDb>();
    HistorianOptions o = forwardingOptions(db);
    o.cursorSaveMs = 60000;
    Fixture f(o, kT0, {influx("in1")}, {"in1"});
    f.run(3100);  // rows at 1, 2, 3 s, committed every second
    Forwarder& fw = *f.h->forwardersForTest()[0];
    for (int i = 0; i < 100 && fw.runOnce(); ++i) {
    }
    ASSERT_EQ(db->rows.size(), 3u);
    f.wall = 0;  // no more rows (clock lost)
    const std::string key = forwardCursorKey(influx("in1"));
    auto saved = [&] {
        HistoryReader r;
        std::string err;
        return r.open(f.dir + "/history.db", err) ? r.forwardCursors(key)["g"] : -1;
    };
    f.run(50000);
    EXPECT_EQ(saved(), 0);
    f.run(10000);
    EXPECT_EQ(saved(), 3);
}

// Review I6: a damaged page found by a commit. The file is kept for investigation, a new one is
// started with a new instance id, and the buffered rows go there (data-model §3).
TEST(Historian, ADamagedPageFoundByACommitStartsANewFile) {
    HistorianOptions o;
    o.commitMs = 1000;
    o.retryMs = 1000;
    Fixture f(o);
    f.run(3100);
    ASSERT_EQ(f.rowsInDb(), 3);
    const std::string oldId = f.h->storeForTest().instanceId();
    LocalStore& st = f.h->storeForTest();
    st.close();  // checkpoints the WAL into the file
    {
        sqlite3* db = nullptr;
        ASSERT_EQ(
            sqlite3_open_v2((f.dir + "/history.db").c_str(), &db, SQLITE_OPEN_READONLY, nullptr),
            SQLITE_OK);
        sqlite3_stmt* q = nullptr;
        ASSERT_EQ(sqlite3_prepare_v2(db, "SELECT rootpage FROM sqlite_master WHERE name='log_g'",
                                     -1, &q, nullptr),
                  SQLITE_OK);
        ASSERT_EQ(sqlite3_step(q), SQLITE_ROW);
        const int64_t page = sqlite3_column_int64(q, 0);
        sqlite3_finalize(q);
        sqlite3_close(db);
        const int fd = ::open((f.dir + "/history.db").c_str(), O_WRONLY);
        ASSERT_GE(fd, 0);
        const std::string junk(4096, '\xff');
        ASSERT_EQ(::pwrite(fd, junk.data(), junk.size(), static_cast<off_t>((page - 1) * 4096)),
                  4096);
        ::close(fd);
    }
    std::string err;
    ASSERT_TRUE(st.open(err)) << err;
    ASSERT_TRUE(st.ensureTables({{"g", "g", 7, {{"V", "REAL"}}}}, err)) << err;
    f.run(1100);  // the next commit hits the damaged page
    auto s = f.h->status();
    EXPECT_EQ(s.lastErrorCode, "corrupt_recovered");
    EXPECT_NE(st.instanceId(), oldId);
    bool kept = false;
    if (DIR* d = ::opendir(f.dir.c_str())) {
        while (const dirent* e = ::readdir(d))
            kept = kept || std::string(e->d_name).rfind("history.db.corrupt-", 0) == 0;
        ::closedir(d);
    }
    EXPECT_TRUE(kept);
    f.run(3000);  // the buffered rows and the next ones go to the new file
    EXPECT_GE(f.rowsInDb(), 3);
    EXPECT_EQ(f.h->status().state, HistorianState::Running);
}

// ---- review of the fixes: C1 mark kept in history.db, I3 damaged pages found outside a commit

namespace {

// Runs one statement on history.db through a connection of its own (the historian's stays open).
bool exec(const std::string& dir, const std::string& sql) {
    sqlite3* db = nullptr;
    bool ok = sqlite3_open((dir + "/history.db").c_str(), &db) == SQLITE_OK &&
              sqlite3_exec(db, sql.c_str(), nullptr, nullptr, nullptr) == SQLITE_OK;
    sqlite3_close(db);
    return ok;
}

int64_t count(const std::string& dir, const std::string& sql) {
    sqlite3* db = nullptr;
    int64_t n = -1;
    if (sqlite3_open_v2((dir + "/history.db").c_str(), &db, SQLITE_OPEN_READONLY, nullptr) ==
        SQLITE_OK) {
        sqlite3_stmt* q = nullptr;
        if (sqlite3_prepare_v2(db, sql.c_str(), -1, &q, nullptr) == SQLITE_OK &&
            sqlite3_step(q) == SQLITE_ROW)
            n = sqlite3_column_int64(q, 0);
        sqlite3_finalize(q);
    }
    sqlite3_close(db);
    return n;
}

// Overwrites the root page of a table with junk; the historian's store is closed (its WAL goes
// into the file) and opened again around it.
void damagePage(const std::string& dir, LocalStore& st, const std::string& table) {
    int64_t page = 0;
    {
        sqlite3* db = nullptr;
        ASSERT_EQ(
            sqlite3_open_v2((dir + "/history.db").c_str(), &db, SQLITE_OPEN_READONLY, nullptr),
            SQLITE_OK);
        sqlite3_stmt* q = nullptr;
        ASSERT_EQ(sqlite3_prepare_v2(db, "SELECT rootpage FROM sqlite_master WHERE name = ?", -1,
                                     &q, nullptr),
                  SQLITE_OK);
        sqlite3_bind_text(q, 1, table.c_str(), -1, SQLITE_TRANSIENT);
        ASSERT_EQ(sqlite3_step(q), SQLITE_ROW);
        page = sqlite3_column_int64(q, 0);
        sqlite3_finalize(q);
        sqlite3_close(db);
    }
    st.close();
    const int fd = ::open((dir + "/history.db").c_str(), O_WRONLY);
    ASSERT_GE(fd, 0);
    const std::string junk(4096, '\xff');
    ASSERT_EQ(::pwrite(fd, junk.data(), junk.size(), static_cast<off_t>((page - 1) * 4096)), 4096);
    ::close(fd);
    std::string err;
    ASSERT_TRUE(st.open(err)) << err;
    ASSERT_TRUE(st.ensureTables({{"g", "g", 7, {{"V", "REAL"}}}}, err)) << err;
}

}  // namespace

// Review C1 (follow-up): a SQL destination keeps its cursor. The historian keeps a mark of what
// history.db had at open until the forwarder compared that cursor with it, and removes it for good
// before the forwarder sends anything.
TEST(HistorianForwarding, TheMarkStaysUntilTheForwarderCheckedItsDestination) {
    auto db = std::make_shared<MemDb>();
    db->transactional = true;
    Fixture f(forwardingOptions(db), kT0, {influx("in1")}, {"in1"});
    f.run(3100);  // rows 1 … 3
    EXPECT_EQ(count(f.dir, "SELECT count(*) FROM mat_forward_mark"), 1);
    Forwarder& fw = *f.h->forwardersForTest()[0];
    for (int i = 0; i < 100 && fw.runOnce(); ++i) {
    }
    EXPECT_TRUE(db->rows.empty());  // waits for the mark to be off the device
    f.run(100);                     // the historian removes it
    EXPECT_EQ(count(f.dir, "SELECT count(*) FROM mat_forward_mark"), 0);
    for (int i = 0; i < 100 && fw.runOnce(); ++i) {
    }
    EXPECT_GE(db->rows.size(), 3u);
}

// The case of the review: the destination holds rows 1 … 100 of this file, which the device lost
// (power cut); the runtime wrote rows 1 … 3 again, then restarted before reaching the destination.
// The mark of the first start (0) stays: the destination cursor goes back to it and rows 1 … 3 go.
TEST(HistorianForwarding, AMarkSurvivesARestartBeforeTheDestinationWasReached) {
    auto db = std::make_shared<MemDb>();
    db->transactional = true;
    db->cursor["g"] = 100;
    const HistorianOptions o = forwardingOptions(db);
    std::string dir;
    {
        Fixture first(o, kT0, {influx("in1")}, {"in1"});
        first.run(3100);  // rows 1 … 3; the destination is never reached
        dir = first.dir;
    }
    Fixture second(o, kT0 + 10000, {influx("in1")}, {"in1"}, dir);
    Forwarder& fw = *second.h->forwardersForTest()[0];
    for (int i = 0; i < 100 && fw.runOnce(); ++i) {
    }
    ASSERT_FALSE(db->cursorOnly.empty());
    EXPECT_EQ(db->cursorOnly[0], 0);  // back to the mark of the first start
    second.run(100);
    for (int i = 0; i < 100 && fw.runOnce(); ++i) {
    }
    ASSERT_GE(db->rows.size(), 3u);
    EXPECT_EQ(db->rows[0].seq, 1);
}

// Review of the fixes (Important 3): at a start where the mark cannot be stored (disk full, I/O
// error), a SQL destination waits instead of skipping the check; once the file takes writes
// again, the older mark of the earlier run, still in the file, decides.
TEST(HistorianForwarding, AMarkThatCannotBeStoredKeepsTheGroupsWaiting) {
    auto db = std::make_shared<MemDb>();
    db->transactional = true;
    db->cursor["g"] = 100;  // rows 1 … 100 of this file, lost on the device by a power cut
    HistorianOptions o = forwardingOptions(db);
    o.retryMs = 1000;
    std::string dir;
    {
        Fixture first(o, kT0, {influx("in1")}, {"in1"});
        first.run(3100);  // rows 1 … 3, mark 0 kept; the destination is never reached
        dir = first.dir;
    }
    ASSERT_TRUE(exec(dir,
                     "CREATE TRIGGER no_mark BEFORE INSERT ON mat_forward_mark BEGIN "
                     "SELECT RAISE(ABORT, 'test: the mark cannot be stored'); END"));
    Fixture second(o, kT0 + 10000, {influx("in1")}, {"in1"}, dir);
    second.run(3100);  // rows 4 … 6
    Forwarder& fw = *second.h->forwardersForTest()[0];
    for (int i = 0; i < 100 && fw.runOnce(); ++i) {
    }
    EXPECT_TRUE(db->rows.empty());
    EXPECT_TRUE(db->cursorOnly.empty());  // the cursor of the destination is not touched either
    EXPECT_EQ(second.h->status().destinations[0].state, DestState::Error);
    ASSERT_TRUE(exec(dir, "DROP TRIGGER no_mark"));
    second.run(5000);  // stored at the next try
    for (int i = 0; i < 100 && fw.runOnce(); ++i) {
    }
    ASSERT_FALSE(db->cursorOnly.empty());
    EXPECT_EQ(db->cursorOnly[0], 0);  // the mark of the first start, not what the file has now
    second.run(100);                  // cleared for good
    for (int i = 0; i < 100 && fw.runOnce(); ++i) {
    }
    ASSERT_GE(db->rows.size(), 6u);
    EXPECT_EQ(db->rows[0].seq, 1);
}

// Review of the fixes (minor 7): a mark that cannot be cleared (disk full, read-only remount) is
// tried again less and less often, not on every pass with one journal line each time.
TEST(HistorianForwarding, AMarkThatCannotBeClearedIsTriedLessAndLessOften) {
    auto db = std::make_shared<MemDb>();
    db->transactional = true;
    HistorianOptions o = forwardingOptions(db);
    o.retryMs = 1000;
    Fixture f(o, kT0, {influx("in1")}, {"in1"});
    f.run(1100);
    ASSERT_TRUE(exec(f.dir,
                     "CREATE TRIGGER keep_mark BEFORE DELETE ON mat_forward_mark BEGIN "
                     "SELECT RAISE(ABORT, 'test: the mark cannot be cleared'); END"));
    Forwarder& fw = *f.h->forwardersForTest()[0];
    for (int i = 0; i < 100 && fw.runOnce(); ++i) {
    }
    testing::internal::CaptureStderr();
    f.run(30000);
    const std::string log = testing::internal::GetCapturedStderr();
    size_t tries = 0;
    for (size_t at = log.find("mat_forward_mark"); at != std::string::npos;
         at = log.find("mat_forward_mark", at + 1))
        ++tries;
    EXPECT_GE(tries, 1u);
    EXPECT_LE(tries, 6u);  // 1, 2, 4, 8, 16 s apart, not 300 times
    for (int i = 0; i < 100 && fw.runOnce(); ++i) {
    }
    EXPECT_TRUE(db->rows.empty());  // still waiting for the mark to be off the device
    ASSERT_TRUE(exec(f.dir, "DROP TRIGGER keep_mark"));
    f.run(40000);
    for (int i = 0; i < 100 && fw.runOnce(); ++i) {
    }
    EXPECT_FALSE(db->rows.empty());
}

// Review I3: a damaged page the forwarder finds while reading: the historian replaces the file.
TEST(Historian, ADamagedPageFoundByAForwarderStartsANewFile) {
    auto db = std::make_shared<MemDb>();
    HistorianOptions o = forwardingOptions(db);
    o.commitMs = 60000;  // no commit of the historian touches the page
    Fixture f(o, kT0, {influx("in1")}, {"in1"});
    LocalStore& st = f.h->storeForTest();
    std::string err;
    ASSERT_TRUE(st.commit({{0, kT0 - 5000, {1.0}}, {0, kT0 - 4000, {2.0}}}, err)) << err;
    const std::string oldId = st.instanceId();
    damagePage(f.dir, st, "log_g");
    Forwarder& fw = *f.h->forwardersForTest()[0];
    for (int i = 0; i < 100 && fw.runOnce(); ++i) {
    }
    EXPECT_TRUE(db->rows.empty());
    f.run(100);
    EXPECT_EQ(f.h->status().lastErrorCode, "corrupt_recovered");
    EXPECT_NE(st.instanceId(), oldId);
}

// Review I3: a damaged page found by the retention pass also starts a new file.
TEST(HistorianMaintenance, ADamagedPageFoundByRetentionStartsANewFile) {
    HistorianOptions o;
    o.commitMs = 60000;
    Fixture f(o);
    LocalStore& st = f.h->storeForTest();
    std::string err;
    std::vector<PendingRow> old;
    for (int i = 0; i < 5; ++i) old.push_back({0, kT0 - 30 * kDay + i, {1.0 * i}});
    ASSERT_TRUE(st.commit(old, err)) << err;
    const std::string oldId = st.instanceId();
    damagePage(f.dir, st, "log_g");
    f.run(100);  // retention runs at start; its DELETE hits the page
    EXPECT_EQ(f.h->status().lastErrorCode, "corrupt_recovered");
    EXPECT_NE(st.instanceId(), oldId);
}
