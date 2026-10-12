// Forwarder of one connection (specs/003-data-logging research R8, R12; data-model §3
// Destination) against an in-memory destination.
#include "core/historian/forward/forwarder.hpp"

#include <fcntl.h>
#include <gtest/gtest.h>
#include <stdlib.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <map>
#include <memory>
#include <thread>

#include "sqlite3.h"

using namespace mat;

namespace {

constexpr int64_t kT0 = 1791594000000;

std::string tempDir() {
    char tmpl[] = "/tmp/mat-fwd-XXXXXX";
    const char* d = mkdtemp(tmpl);
    return d ? d : "";
}

// What the fake external database holds; outlives the destination objects.
struct FakeDb {
    bool transactional = true;
    size_t batchRows = 2;
    std::map<std::string, std::vector<StoredRow>> rows;  // table → rows in arrival order
    std::map<std::string, int64_t> cursor;               // mat_forward_state (transactional)
    std::vector<std::vector<DestTable>> synced;          // tables of every syncSchema call
    std::map<std::string, int> attempts;                 // writeBatch calls per table
    int connects = 0;
    int closes = 0;
    std::atomic<int> batches{0};
    int cursorReads = 0;
    std::string secretSeen;
    ErrorClass failConnect = ErrorClass::None;
    int failBatches = 0;  // the next N writeBatch calls (of failTable, or any) fail, nothing stored
    ErrorClass failBatchClass = ErrorClass::Sql;
    std::string failTable;
    std::string failSyncTable;  // syncSchema of this table fails (permission)
    int failAfterCommit = 0;    // the next N batches commit, then the connection is lost
    int blockMs = 0;            // every writeBatch takes this long (slow or stuck server)
    std::vector<int64_t> cursorOnlyBatches;   // lastSeq of batches without rows
    DestCounters counters;                    // what the destination reports
    ErrorClass softError = ErrorClass::None;  // batches go, but the server refuses a part
    std::vector<std::string> sources;         // source id of every batch
    // Cursors of other files than the first one seen (`cursor` holds the first file's).
    std::string mainSource;
    std::map<std::string, std::map<std::string, int64_t>> otherCursors;
    int refusedMoves = 0;  // batches refused: the cursor was not the one the forwarder sent from
};

class FakeDestination : public Destination {
   public:
    explicit FakeDestination(std::shared_ptr<FakeDb> db) : db_(std::move(db)) {}
    bool transactional() const override { return db_->transactional; }
    size_t batchRows(const DestTable&) const override { return db_->batchRows; }
    bool connect(const std::string& secret, DestError& err) override {
        ++db_->connects;
        db_->secretSeen = secret;
        if (db_->failConnect == ErrorClass::None) return true;
        err.cls = db_->failConnect;
        err.dbCode = "2003";
        err.detail = "fake: cannot reach db.example:3306 as scada";
        return false;
    }
    bool syncSchema(const std::string&, const std::vector<DestTable>& tables,
                    DestError& err) override {
        db_->synced.push_back(tables);
        for (const auto& t : tables)
            if (t.name == db_->failSyncTable) {
                err.cls = ErrorClass::Permission;
                err.dbCode = "1142";
                return false;
            }
        return true;
    }
    bool readCursor(const std::string& source, const std::string& table, int64_t& lastSeq,
                    DestError&) override {
        ++db_->cursorReads;
        const auto& m = cursorsOf(source);
        const auto it = m.find(table);
        lastSeq = it == m.end() ? 0 : it->second;
        return true;
    }
    bool writeBatch(const std::string& source, const DestTable& t,
                    const std::vector<StoredRow>& rows, int64_t prevSeq, int64_t lastSeq,
                    DestError& err) override {
        ++db_->batches;
        db_->sources.push_back(source);
        ++db_->attempts[t.name];
        if (db_->blockMs > 0) std::this_thread::sleep_for(std::chrono::milliseconds(db_->blockMs));
        if (rows.empty()) db_->cursorOnlyBatches.push_back(lastSeq);
        if (db_->failBatches > 0 && (db_->failTable.empty() || db_->failTable == t.name)) {
            --db_->failBatches;
            err.cls = db_->failBatchClass;
            err.dbCode = "1064";
            return false;
        }
        if (db_->transactional) {  // like the SQL destinations: moved only from what was read
            const auto& m = cursorsOf(source);
            const auto it = m.find(t.name);
            if ((it == m.end() ? 0 : it->second) != prevSeq) {
                ++db_->refusedMoves;
                err.cls = ErrorClass::Sql;
                err.dbCode = "40001";
                err.detail = "fake: the cursor at the destination moved";
                return false;
            }
        }
        auto& dst = db_->rows[t.name];
        dst.insert(dst.end(), rows.begin(), rows.end());
        if (db_->transactional) cursorsOf(source)[t.name] = lastSeq;
        if (db_->failAfterCommit > 0) {  // committed, but the answer never arrives
            --db_->failAfterCommit;
            err.cls = ErrorClass::Connect;
            err.dbCode = "2013";
            return false;
        }
        if (db_->softError != ErrorClass::None) {  // taken, but a part was refused
            err.cls = db_->softError;
            err.dbCode = "422";
        }
        return true;
    }
    void close() override { ++db_->closes; }
    DestCounters counters() const override { return db_->counters; }

   private:
    std::map<std::string, int64_t>& cursorsOf(const std::string& source) {
        if (db_->mainSource.empty()) db_->mainSource = source;
        return source == db_->mainSource ? db_->cursor : db_->otherCursors[source];
    }

    std::shared_ptr<FakeDb> db_;
};

// seq values of the rows a destination holds for a table, in arrival order
std::vector<int64_t> seqs(const FakeDb& db, const std::string& table) {
    std::vector<int64_t> out;
    const auto it = db.rows.find(table);
    if (it != db.rows.end())
        for (const auto& r : it->second) out.push_back(r.seq);
    return out;
}

std::vector<int64_t> range(int64_t from, int64_t to) {
    std::vector<int64_t> v;
    for (int64_t s = from; s <= to; ++s) v.push_back(s);
    return v;
}

class ForwarderTest : public ::testing::Test {
   protected:
    void SetUp() override {
        dir_ = tempDir();
        store_ = std::make_unique<LocalStore>(dir_, [this] { return utc_; });
        std::string err;
        ASSERT_TRUE(store_->open(err)) << err;
        ASSERT_TRUE(store_->ensureTables(specs(false), err)) << err;
    }

    static std::vector<TableSpec> specs(bool note) {
        TableSpec a{"van_hanh", "van-hanh", 30, {{"LEVEL", "REAL"}, {"RUN", "INTEGER"}}};
        if (note) a.columns.push_back({"NOTE", "TEXT"});
        TableSpec b{"bao_cao_ca", "bao-cao-ca", 365, {{"LEVEL", "REAL"}}};
        return {a, b};
    }
    static std::vector<ForwardGroup> groups(bool note) {
        ForwardGroup a{
            "van-hanh",
            {"van_hanh", {{"LEVEL", TagType::FLOAT32, 255}, {"RUN", TagType::BOOL, 255}}}};
        if (note) a.table.columns.push_back({"NOTE", TagType::STRING, 64});
        ForwardGroup b{"bao-cao-ca", {"bao_cao_ca", {{"LEVEL", TagType::FLOAT32, 255}}}};
        return {a, b};
    }

    // n rows in table `spec` (0 = van_hanh, 1 = bao_cao_ca), ts = now + i.
    void addRows(size_t spec, int n, bool note = false) {
        std::vector<PendingRow> rows;
        for (int i = 0; i < n; ++i) {
            PendingRow r{spec, utc_ + i, {}};
            r.cells.push_back(1.5 * (next_ + i));
            if (spec == 0) r.cells.push_back(int64_t{(next_ + i) % 2});
            if (spec == 0 && note) r.cells.push_back(std::string("n") + std::to_string(next_ + i));
            rows.push_back(std::move(r));
        }
        next_ += n;
        std::string err;
        ASSERT_TRUE(store_->commit(rows, err)) << err;
    }

    std::unique_ptr<Forwarder> make(std::shared_ptr<FakeDb> db, bool note = false,
                                    bool hasSecret = true, DbType type = DbType::MySql,
                                    int64_t seqAtOpen = -1) {
        ConnectionModel c;
        c.id = "db1";
        c.type = type;
        if (type == DbType::InfluxDb) {
            c.url = "http://influx:8086";
            c.org = "o";
            c.bucket = "b";
        }
        ForwarderOptions o;
        o.dbPath = dir_ + "/history.db";
        o.lowerPriority = false;
        o.secret = [hasSecret](const std::string& id) {
            SecretResult r;
            r.ok = hasSecret && id == "db1";
            r.secret = r.ok ? "pw" : "";
            r.reason = r.ok ? "" : "no_entry";
            return r;
        };
        auto gs = groups(note);
        for (auto& g : gs) g.seqAtOpen = seqAtOpen;
        return std::make_unique<Forwarder>(
            c, gs, std::make_unique<FakeDestination>(db), o, [this] { return utc_; },
            [this] { return mono_; });
    }

    // Steps until the forwarder has nothing more to do right now.
    static void drain(Forwarder& f) {
        for (int i = 0; i < 1000 && f.runOnce(); ++i) {
        }
    }
    // What the historian does once the marks are off the device (review C1).
    static void releaseMarks(Forwarder& f) { f.marksCleared(f.takeCheckedMarks()); }
    // Overwrites the root page of a table with junk; the store is closed (its WAL goes into the
    // file) and opened again around it.
    void damageTable(const std::string& name) {
        int64_t page = 0;
        {
            sqlite3* db = nullptr;
            ASSERT_EQ(
                sqlite3_open_v2((dir_ + "/history.db").c_str(), &db, SQLITE_OPEN_READONLY, nullptr),
                SQLITE_OK);
            sqlite3_stmt* q = nullptr;
            ASSERT_EQ(sqlite3_prepare_v2(db, "SELECT rootpage FROM sqlite_master WHERE name = ?",
                                         -1, &q, nullptr),
                      SQLITE_OK);
            sqlite3_bind_text(q, 1, name.c_str(), -1, SQLITE_TRANSIENT);
            ASSERT_EQ(sqlite3_step(q), SQLITE_ROW);
            page = sqlite3_column_int64(q, 0);
            sqlite3_finalize(q);
            sqlite3_close(db);
        }
        store_->close();
        const int fd = ::open((dir_ + "/history.db").c_str(), O_WRONLY);
        ASSERT_GE(fd, 0);
        const std::string junk(4096, '\xff');
        ASSERT_EQ(::pwrite(fd, junk.data(), junk.size(), static_cast<off_t>((page - 1) * 4096)),
                  4096);
        ::close(fd);
        std::string err;
        ASSERT_TRUE(store_->open(err)) << err;
        ASSERT_TRUE(store_->ensureTables(specs(false), err)) << err;
    }
    void advance(int64_t ms) {
        utc_ += ms;
        mono_ += ms;
    }
    std::string deleteRows(int64_t upToSeq) {
        std::string err;
        store_->exec("DELETE FROM log_van_hanh WHERE seq <= " + std::to_string(upToSeq), err);
        return err;
    }

    std::string dir_;
    int64_t utc_ = kT0;
    int64_t mono_ = 5000000;
    std::unique_ptr<LocalStore> store_;
    int next_ = 0;
};

}  // namespace

// Review of the fixes (Important 2): a batch of an earlier session that committed after its client
// gave up moved the cursor at the destination. The next batch, sent from the cursor this forwarder
// read, is refused; the group reads the cursor again and nothing is stored twice.
TEST_F(ForwarderTest, ACursorMovedByALateCommitIsReadAgainAndNothingIsStoredTwice) {
    addRows(0, 10);
    auto db = std::make_shared<FakeDb>();
    db->batchRows = 5;
    auto f = make(db);
    ASSERT_TRUE(f->runOnce());  // connects, reads the cursors (none)
    ASSERT_TRUE(f->runOnce());  // rows 1 … 5
    ASSERT_EQ(seqs(*db, "van_hanh"), range(1, 5));
    for (int64_t s = 6; s <= 10; ++s)  // the late commit: rows 6 … 10 and the cursor 10
        db->rows["van_hanh"].push_back(StoredRow{s, kT0 + s, {}});
    db->cursor["van_hanh"] = 10;
    f->runOnce();  // rows 6 … 10 from cursor 5: refused
    EXPECT_EQ(db->refusedMoves, 1);
    advance(2000);  // the group waits its backoff, then reads the cursor again
    drain(*f);
    EXPECT_EQ(seqs(*db, "van_hanh"), range(1, 10));  // each row once
    EXPECT_EQ(db->refusedMoves, 1);
    EXPECT_EQ(f->status().state, DestState::Ok);
}

TEST_F(ForwarderTest, SendsEveryGroupInSeqOrderAfterTheDestinationCursor) {
    addRows(0, 7);
    addRows(1, 3);
    auto db = std::make_shared<FakeDb>();
    db->cursor["van_hanh"] = 2;  // rows 1..2 are already there
    auto f = make(db);
    drain(*f);
    ASSERT_EQ(db->rows["van_hanh"].size(), 5u);
    for (size_t i = 0; i < 5; ++i)
        EXPECT_EQ(db->rows["van_hanh"][i].seq, static_cast<int64_t>(i + 3));
    ASSERT_EQ(db->rows["bao_cao_ca"].size(), 3u);
    EXPECT_EQ(db->rows["bao_cao_ca"][2].seq, 3);
    EXPECT_EQ(db->cursor["van_hanh"], 7);
    EXPECT_EQ(db->cursor["bao_cao_ca"], 3);
    EXPECT_EQ(db->secretSeen, "pw");
    EXPECT_EQ(db->batches, 5);  // 2 + 2 + 1 and 2 + 1 rows: batchRows() of the destination
    // cells come from SQLite in the column order of the group
    EXPECT_DOUBLE_EQ(std::get<double>(db->rows["van_hanh"][0].cells[0]), 1.5 * 2);
    EXPECT_EQ(std::get<int64_t>(db->rows["van_hanh"][0].cells[1]), 0);
    auto s = f->status();
    EXPECT_EQ(s.id, "db1");
    EXPECT_EQ(s.type, "mysql");
    EXPECT_EQ(s.state, DestState::Ok);
    EXPECT_EQ(s.sentRows, 8u);
    EXPECT_EQ(s.pendingRows, 0);
    EXPECT_EQ(s.lagS, 0);
    EXPECT_EQ(s.lastOkAt, kT0);
    EXPECT_EQ(s.lastError, ErrorClass::None);
    // the SQL cursor is copied to mat_forward for the status after a restart, tagged with the file
    auto up = f->takeCursorUpdates();
    ASSERT_EQ(up.size(), 2u);
    EXPECT_EQ(up[0].sourceId, store_->instanceId());
    EXPECT_TRUE(f->takeCursorUpdates().empty());  // handed over once

    advance(5000);  // new rows after the next commit
    addRows(1, 2);
    drain(*f);
    EXPECT_EQ(db->cursor["bao_cao_ca"], 5);
    EXPECT_EQ(f->status().lastOkAt, kT0 + 5000);
    EXPECT_EQ(db->connects, 1);
}

TEST_F(ForwarderTest, ReportsPendingRowsAndLagWhileTheDestinationIsDown) {
    addRows(0, 4);  // ts kT0 … kT0 + 3
    advance(10000);
    addRows(1, 1);  // ts kT0 + 10 s
    std::string err;
    ASSERT_TRUE(store_->saveCursors({{"db1", "van_hanh", 1, ""}}, err)) << err;  // last copy
    advance(80000);                                                              // now kT0 + 90 s
    auto db = std::make_shared<FakeDb>();
    db->failConnect = ErrorClass::Connect;
    auto f = make(db);
    f->runOnce();
    const auto s = f->status();
    EXPECT_EQ(s.state, DestState::Error);
    EXPECT_EQ(s.pendingRows, 3 + 1);
    EXPECT_EQ(s.lagS, 89);  // oldest unsent row: seq 2 of van_hanh at kT0 + 1
    EXPECT_EQ(s.sentRows, 0u);
    EXPECT_EQ(s.lastOkAt, 0);
}

TEST_F(ForwarderTest, SyncsEachGroupOnEveryConnectAndSendsNewColumns) {
    addRows(0, 3);
    auto db = std::make_shared<FakeDb>();
    db->failBatches = 1;  // statement error (sql): the connection stays
    auto f = make(db);
    f->runOnce();  // connect: one schema sync per group
    ASSERT_EQ(db->synced.size(), 2u);
    EXPECT_EQ(db->synced[0][0].name, "van_hanh");
    EXPECT_EQ(db->synced[0][0].columns.size(), 2u);
    EXPECT_EQ(db->synced[1][0].name, "bao_cao_ca");
    drain(*f);  // the first batch fails
    auto s = f->status();
    EXPECT_EQ(s.state, DestState::Error);
    EXPECT_EQ(s.lastError, ErrorClass::Sql);
    EXPECT_EQ(s.lastErrorDbCode, "1064");
    EXPECT_EQ(db->closes, 0);
    advance(1000);
    drain(*f);  // that group syncs again and reads its cursor again, then sends
    EXPECT_EQ(db->connects, 1);
    EXPECT_EQ(db->synced.size(), 3u);
    EXPECT_EQ(db->cursorReads, 3);
    EXPECT_EQ(db->rows["van_hanh"].size(), 3u);
    s = f->status();
    EXPECT_EQ(s.state, DestState::Ok);
    EXPECT_EQ(s.lastError, ErrorClass::None);  // cleared once the destination is ok again

    // The project adds a Tag: the new forwarder syncs the new column and sends it.
    std::string err;
    ASSERT_TRUE(store_->ensureTables(specs(true), err)) << err;
    addRows(0, 2, /*note=*/true);
    f.reset();
    auto g = make(db, /*note=*/true);
    drain(*g);
    ASSERT_EQ(db->synced.size(), 5u);
    EXPECT_EQ(db->synced[3][0].columns.size(), 3u);
    ASSERT_EQ(db->rows["van_hanh"].size(), 5u);
    EXPECT_EQ(std::get<std::string>(db->rows["van_hanh"][4].cells[2]), "n4");
}

TEST_F(ForwarderTest, NonTransactionalCursorStaysOnTheDevice) {
    addRows(0, 6);
    std::string err;
    ASSERT_TRUE(store_->saveCursors({{"db1", "van_hanh", 4, ""}}, err)) << err;
    auto db = std::make_shared<FakeDb>();
    db->transactional = false;
    auto f = make(db);
    drain(*f);
    EXPECT_EQ(db->cursorReads, 0);
    ASSERT_EQ(db->rows["van_hanh"].size(), 2u);
    EXPECT_EQ(db->rows["van_hanh"][0].seq, 5);
    const auto up = f->takeCursorUpdates();
    ASSERT_EQ(up.size(), 1u);
    EXPECT_EQ(up[0].dest, "db1");
    EXPECT_EQ(up[0].table, "van_hanh");
    EXPECT_EQ(up[0].lastSeq, 6);
    ASSERT_TRUE(store_->saveCursors(up, err)) << err;  // what the historian does at its commit
    f.reset();
    auto g = make(db);  // after a restart: continues from the saved cursor
    drain(*g);
    EXPECT_EQ(db->rows["van_hanh"].size(), 2u);
    EXPECT_EQ(g->status().pendingRows, 0);
}

// Review S3: the device cursor of InfluxDB belongs to the server it was reached on, not only to the
// connection id (a new bucket or URL starts from the oldest row).
TEST_F(ForwarderTest, InfluxCursorIsKeyedByTheServer) {
    addRows(0, 3);
    std::string err;
    ASSERT_TRUE(store_->saveCursors({{"db1", "van_hanh", 2, ""}}, err)) << err;
    auto db = std::make_shared<FakeDb>();
    db->transactional = false;
    auto f = make(db, false, true, DbType::InfluxDb);
    drain(*f);
    EXPECT_EQ(seqs(*db, "van_hanh"), range(1, 3));
    const auto up = f->takeCursorUpdates();
    ASSERT_EQ(up.size(), 1u);
    EXPECT_NE(up[0].dest, "db1");
    EXPECT_NE(up[0].dest.find("influx:8086"), std::string::npos);
}

TEST_F(ForwarderTest, ConnectionErrorsBackOffFromOneSecondToOneMinute) {
    auto db = std::make_shared<FakeDb>();
    db->failConnect = ErrorClass::Connect;
    auto f = make(db);
    f->runOnce();
    EXPECT_EQ(db->connects, 1);
    auto s = f->status();
    EXPECT_EQ(s.state, DestState::Error);
    EXPECT_EQ(s.lastError, ErrorClass::Connect);
    EXPECT_EQ(s.lastErrorDbCode, "2003");
    EXPECT_EQ(s.lastErrorAt, kT0);
    int expected = 1;
    for (int64_t wait : {1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000}) {
        advance(wait - 1);
        f->runOnce();
        EXPECT_EQ(db->connects, expected) << "too early, wait " << wait;
        advance(1);
        f->runOnce();
        EXPECT_EQ(db->connects, ++expected) << "wait " << wait;
    }
    db->failConnect = ErrorClass::None;
    advance(60000);
    drain(*f);  // connected, nothing to send: healthy, the backoff starts again from 1 s
    EXPECT_EQ(f->status().state, DestState::Ok);
    db->failBatches = 1;
    db->failBatchClass = ErrorClass::Connect;
    addRows(0, 1);
    drain(*f);
    EXPECT_EQ(f->status().state, DestState::Error);
    EXPECT_EQ(db->closes, 1);
    const int before = db->connects;
    advance(999);
    f->runOnce();
    EXPECT_EQ(db->connects, before);
    advance(1);
    f->runOnce();
    EXPECT_EQ(db->connects, before + 1);
}

// Review I1: a connection that works but whose batches keep failing still backs off (the backoff
// is no longer reset by a successful connect).
TEST_F(ForwarderTest, RepeatedConnectionErrorsAfterConnectStillBackOff) {
    addRows(0, 1);
    auto db = std::make_shared<FakeDb>();
    db->failBatches = 100;
    db->failBatchClass = ErrorClass::Timeout;
    auto f = make(db);
    drain(*f);
    EXPECT_EQ(db->attempts["van_hanh"], 1);
    int expected = 1;
    for (int64_t wait : {1000, 2000, 4000, 8000}) {
        advance(wait - 1);
        drain(*f);
        EXPECT_EQ(db->attempts["van_hanh"], expected) << "too early, wait " << wait;
        advance(1);
        drain(*f);
        EXPECT_EQ(db->attempts["van_hanh"], ++expected) << "wait " << wait;
    }
}

// Security review hardening 5: a wrong password is tried again slowly, not to lock the account.
TEST_F(ForwarderTest, AuthErrorsWaitLongerNotToLockTheAccount) {
    auto db = std::make_shared<FakeDb>();
    db->failConnect = ErrorClass::Auth;
    auto f = make(db);
    f->runOnce();
    int expected = 1;
    for (int64_t wait : {60000, 120000, 240000, 300000, 300000}) {
        advance(wait - 1);
        f->runOnce();
        EXPECT_EQ(db->connects, expected) << "too early, wait " << wait;
        advance(1);
        f->runOnce();
        EXPECT_EQ(db->connects, ++expected) << "wait " << wait;
    }
}

// Review I1: a group whose rows the server refuses waits on its own (1, 2, 4 … s); the other groups
// of the connection go on, and the connection stays open.
TEST_F(ForwarderTest, StatementErrorsOfOneGroupDoNotBlockTheOthers) {
    addRows(0, 4);
    addRows(1, 3);
    auto db = std::make_shared<FakeDb>();
    db->failTable = "van_hanh";
    db->failBatches = 1000;
    db->failBatchClass = ErrorClass::SchemaMismatch;
    auto f = make(db);
    drain(*f);
    EXPECT_EQ(seqs(*db, "bao_cao_ca"), range(1, 3));
    EXPECT_TRUE(seqs(*db, "van_hanh").empty());
    auto s = f->status();
    EXPECT_EQ(s.state, DestState::Error);
    EXPECT_EQ(s.lastError, ErrorClass::SchemaMismatch);
    EXPECT_EQ(db->closes, 0);
    EXPECT_EQ(db->connects, 1);
    EXPECT_EQ(db->attempts["van_hanh"], 1);
    int expected = 1;
    for (int64_t wait : {1000, 2000, 4000}) {
        advance(wait - 1);
        drain(*f);
        EXPECT_EQ(db->attempts["van_hanh"], expected) << "too early, wait " << wait;
        advance(1);
        drain(*f);
        EXPECT_EQ(db->attempts["van_hanh"], ++expected) << "wait " << wait;
    }
    db->failBatches = 0;  // fixed by the database administrator
    advance(8000);
    drain(*f);
    EXPECT_EQ(seqs(*db, "van_hanh"), range(1, 4));
    s = f->status();
    EXPECT_EQ(s.state, DestState::Ok);
    EXPECT_EQ(s.lastError, ErrorClass::None);
}

TEST_F(ForwarderTest, ATableThatCannotBePreparedDoesNotBlockTheOthers) {
    addRows(0, 2);
    addRows(1, 2);
    auto db = std::make_shared<FakeDb>();
    db->failSyncTable = "van_hanh";
    auto f = make(db);
    drain(*f);
    EXPECT_EQ(seqs(*db, "bao_cao_ca"), range(1, 2));
    EXPECT_TRUE(seqs(*db, "van_hanh").empty());
    EXPECT_EQ(f->status().state, DestState::Error);
    EXPECT_EQ(f->status().lastError, ErrorClass::Permission);
    EXPECT_EQ(db->connects, 1);
}

TEST_F(ForwarderTest, MissingSecretOrClientLibrary) {
    auto db = std::make_shared<FakeDb>();
    auto f = make(db, false, /*hasSecret=*/false);
    f->runOnce();
    EXPECT_EQ(db->connects, 0);  // never connects without a secret
    EXPECT_EQ(f->status().state, DestState::NoSecret);
    EXPECT_EQ(f->status().lastError, ErrorClass::NoSecret);

    auto db2 = std::make_shared<FakeDb>();
    db2->failConnect = ErrorClass::NoClient;
    auto g = make(db2);
    g->runOnce();
    EXPECT_EQ(g->status().state, DestState::NoClient);
    EXPECT_EQ(g->status().lastError, ErrorClass::NoClient);
    advance(60000);
    g->runOnce();
    EXPECT_EQ(db2->connects, 1);  // the library is looked for again after 5 minutes only
    advance(240000);
    g->runOnce();
    EXPECT_EQ(db2->connects, 2);
}

TEST_F(ForwarderTest, ThreadSendsAfterNotifyAndStops) {
    auto db = std::make_shared<FakeDb>();
    auto f = make(db);
    std::string err;
    ASSERT_TRUE(f->start(err)) << err;
    addRows(0, 5);
    f->notify();
    for (int i = 0; i < 200 && f->status().sentRows < 5; ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    f->stop();
    EXPECT_EQ(f->status().sentRows, 5u);
    EXPECT_EQ(db->rows["van_hanh"].size(), 5u);
    EXPECT_GE(db->closes, 1);  // stop() closes the connection
}

TEST(DestStateName, MatchesTheContract) {
    EXPECT_STREQ(destStateName(DestState::Connecting), "connecting");
    EXPECT_STREQ(destStateName(DestState::Ok), "ok");
    EXPECT_STREQ(destStateName(DestState::Error), "error");
    EXPECT_STREQ(destStateName(DestState::NoClient), "no_client");
    EXPECT_STREQ(destStateName(DestState::NoSecret), "no_secret");
}

// ---- US4: no row lost, none twice (research R8, R12)

TEST_F(ForwarderTest, UnclearCommitIsSettledByTheDestinationCursor) {
    addRows(0, 6);
    auto db = std::make_shared<FakeDb>();
    db->failAfterCommit = 1;  // batch [1, 2] is committed, the answer is lost
    auto f = make(db);
    drain(*f);
    EXPECT_EQ(f->status().state, DestState::Error);
    EXPECT_EQ(f->status().lastError, ErrorClass::Connect);
    advance(1000);
    drain(*f);  // reconnect: the cursor says 2, so [1, 2] is not sent again
    EXPECT_EQ(seqs(*db, "van_hanh"), range(1, 6));
    EXPECT_EQ(db->cursor["van_hanh"], 6);
    EXPECT_EQ(f->status().sentRows, 4u);  // [1, 2] was never confirmed to this forwarder
}

TEST_F(ForwarderTest, FailedBatchIsSentAgainWholly) {
    addRows(0, 5);
    auto db = std::make_shared<FakeDb>();
    db->failBatches = 2;
    auto f = make(db);
    for (int round = 0; round < 3; ++round) {
        drain(*f);
        advance(60000);
    }
    EXPECT_EQ(seqs(*db, "van_hanh"), range(1, 5));
    EXPECT_EQ(f->status().sentRows, 5u);
    EXPECT_EQ(f->status().state, DestState::Ok);
}

TEST_F(ForwarderTest, RowsDeletedBeforeSendingAreCountedOnceAndSkipped) {
    addRows(0, 10);
    auto db = std::make_shared<FakeDb>();
    db->cursor["van_hanh"] = 2;
    // retention or the size cap removed rows 1 … 6 while the server was away
    ASSERT_EQ(deleteRows(6), "");
    auto f = make(db);
    drain(*f);
    EXPECT_EQ(f->status().lostRows, 4u);  // 3, 4, 5, 6
    EXPECT_EQ(seqs(*db, "van_hanh"), range(7, 10));
    EXPECT_EQ(db->cursor["van_hanh"], 10);
    EXPECT_TRUE(db->cursorOnlyBatches.empty());  // the next batch moves the cursor past the gap
    // a failure and a new attempt do not count them again
    db->failBatches = 1;
    addRows(0, 1);
    drain(*f);
    advance(1000);
    drain(*f);
    EXPECT_EQ(f->status().lostRows, 4u);
    EXPECT_EQ(seqs(*db, "van_hanh"), range(7, 11));
}

// Review S1: a destination that never got a row starts at the oldest row on the device; rows
// deleted before it existed are not "lost".
TEST_F(ForwarderTest, RowsDeletedBeforeANewDestinationGotAnyAreNotLost) {
    addRows(0, 10);
    ASSERT_EQ(deleteRows(6), "");
    auto db = std::make_shared<FakeDb>();
    auto f = make(db);
    drain(*f);
    EXPECT_EQ(f->status().lostRows, 0u);
    EXPECT_EQ(seqs(*db, "van_hanh"), range(7, 10));
}

TEST_F(ForwarderTest, LostRowsOfANonTransactionalDestinationMoveTheDeviceCursor) {
    addRows(0, 5);
    std::string err;
    ASSERT_TRUE(store_->saveCursors({{"db1", "van_hanh", 1, ""}}, err)) << err;
    ASSERT_EQ(deleteRows(3), "");
    auto db = std::make_shared<FakeDb>();
    db->transactional = false;
    auto f = make(db);
    drain(*f);
    EXPECT_EQ(f->status().lostRows, 2u);  // 2, 3
    EXPECT_EQ(seqs(*db, "van_hanh"), range(4, 5));
    EXPECT_TRUE(db->cursorOnlyBatches.empty());  // nothing to tell InfluxDB
}

// Review C1: the destination holds rows the device no longer has (power cut before the data was
// on the eMMC, or an older history.db put back). Without this, new rows reusing those seq values
// would be skipped silently.
TEST_F(ForwarderTest, DestinationCursorAheadOfTheDeviceIsRewound) {
    addRows(0, 5);  // seq 1 … 5
    auto db = std::make_shared<FakeDb>();
    db->cursor["van_hanh"] = 100;
    auto f = make(db);
    drain(*f);
    ASSERT_FALSE(db->cursorOnlyBatches.empty());
    EXPECT_EQ(db->cursorOnlyBatches[0], 5);
    EXPECT_EQ(db->cursor["van_hanh"], 5);
    addRows(0, 2);  // seq 6, 7
    drain(*f);
    EXPECT_EQ(seqs(*db, "van_hanh"), range(6, 7));
}

// Review I4: after history.db was replaced, cursors of the old file are not handed over.
TEST_F(ForwarderTest, ReopenDropsTheCursorsOfTheOldFile) {
    addRows(0, 3);
    auto db = std::make_shared<FakeDb>();
    db->transactional = false;
    auto f = make(db);
    drain(*f);
    f->reopen();
    EXPECT_TRUE(f->takeCursorUpdates().empty());
}

TEST_F(ForwarderTest, AStuckDestinationNeverBlocksTheCaller) {
    addRows(0, 2);
    auto db = std::make_shared<FakeDb>();
    db->blockMs = 1500;
    auto f = make(db);
    std::string err;
    ASSERT_TRUE(f->start(err)) << err;
    std::this_thread::sleep_for(std::chrono::milliseconds(200));  // inside writeBatch now
    const auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < 20; ++i) {  // what the historian and system/info call
        f->notify();
        (void)f->status();
        (void)f->takeCursorUpdates();
    }
    const auto ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count();
    EXPECT_LT(ms, 50);
    // another connection is not held back
    auto other = std::make_shared<FakeDb>();
    auto g = make(other);
    drain(*g);
    EXPECT_EQ(seqs(*other, "van_hanh"), range(1, 2));
    f->stop();
}

TEST(ForwarderPacing, PauseBetweenBatchesRowRateAndDutyCycle) {
    ForwarderOptions o;  // defaults: 20 ms, 5000 rows/s
    EXPECT_EQ(Forwarder::pauseAfter(1, 0, o), 20);
    EXPECT_EQ(Forwarder::pauseAfter(100, 0, o), 20);
    EXPECT_EQ(Forwarder::pauseAfter(500, 0, o), 100);  // 500 rows at 5000 rows/s
    EXPECT_EQ(Forwarder::pauseAfter(5000, 0, o), 1000);
    // review I8: wide rows cost CPU per row; rest at least as long as the work took
    EXPECT_EQ(Forwarder::pauseAfter(10, 300, o), 300);
    o.maxRowsPerSecond = 1000;
    EXPECT_EQ(Forwarder::pauseAfter(500, 0, o), 500);
}

TEST_F(ForwarderTest, CatchingUpIsPaced) {
    addRows(0, 10);
    auto db = std::make_shared<FakeDb>();  // 2 rows per batch: 5 batches
    auto f = make(db);
    std::string err;
    const auto t0 = std::chrono::steady_clock::now();
    ASSERT_TRUE(f->start(err)) << err;
    for (int i = 0; i < 300 && f->status().sentRows < 10; ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    const auto ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count();
    f->stop();
    EXPECT_EQ(f->status().sentRows, 10u);
    EXPECT_GE(ms, 4 * 20);  // at least the pause between the 5 batches
}

// Security review L3: text from the server cannot forge journal lines.
TEST(ForwarderJournal, ControlCharactersAreEscapedAndLengthBounded) {
    EXPECT_EQ(journalSafe("a\nb\x1b[31m"), "a\\x0ab\\x1b[31m");
    EXPECT_EQ(journalSafe(std::string(1000, 'x')).size(), 512u + 3);  // "…" marks the cut
}

// Review S12: the historian asks every forwarder to stop, then waits; a slow destination does not
// make the next one start another batch meanwhile.
TEST_F(ForwarderTest, RequestStopLetsSeveralForwardersEndTogether) {
    addRows(0, 10);
    auto a = std::make_shared<FakeDb>();
    auto b = std::make_shared<FakeDb>();
    for (auto* db : {a.get(), b.get()}) {
        db->batchRows = 1;
        db->blockMs = 400;
    }
    auto f = make(a);
    auto g = make(b);
    std::string err;
    ASSERT_TRUE(f->start(err)) << err;
    ASSERT_TRUE(g->start(err)) << err;
    for (int i = 0; i < 400 && (a->batches < 1 || b->batches < 1); ++i)  // both inside a batch
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    const auto t0 = std::chrono::steady_clock::now();
    f->requestStop();
    g->requestStop();
    f->stop();
    g->stop();
    const auto ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count();
    EXPECT_LT(ms, 550);  // one stop after the other: about 700
    EXPECT_EQ(a->batches, 1);
    EXPECT_EQ(b->batches, 1);
}

// Review S12, security review hardening 8: rows go out tagged with the instance id of history.db;
// without a valid one devices would share their cursors, so nothing is sent.
TEST_F(ForwarderTest, AFileWithoutAValidInstanceIdIsNotSentFrom) {
    addRows(0, 2);
    std::string err;
    ASSERT_TRUE(store_->exec("UPDATE mat_meta SET value = 'x' WHERE key = 'instance_id'", err))
        << err;
    auto db = std::make_shared<FakeDb>();
    auto f = make(db);
    f->runOnce();
    EXPECT_EQ(db->connects, 0);
    EXPECT_EQ(f->status().state, DestState::Error);
}

// Review I2, I3: values a destination had to adjust and rows the server dropped show in the
// status.
TEST_F(ForwarderTest, CountersOfTheDestinationShowInTheStatus) {
    addRows(0, 2);
    auto db = std::make_shared<FakeDb>();
    db->counters.outOfRangeValues = 3;
    db->counters.rejectedRows = 1;
    auto f = make(db);
    drain(*f);
    EXPECT_EQ(f->status().outOfRangeValues, 3u);
    EXPECT_EQ(f->status().rejectedRows, 1u);
}

// Review C1: after a power cut the device lost seq 6 … 100 that the destination holds, and the
// historian kept writing (seq 6, 7, 8 again) before the destination came back. The rewind goes to
// what the file had when the historian opened it, not to what it has now: the new rows go.
TEST_F(ForwarderTest, RowsWrittenSinceTheFileWasOpenedAreNotSkippedByTheRewind) {
    addRows(0, 5);  // seq 1 … 5: what history.db held when the historian opened it
    addRows(0, 3);  // seq 6 … 8: written since, while the destination was away
    auto db = std::make_shared<FakeDb>();
    db->cursor["van_hanh"] = 100;
    auto f = make(db, false, true, DbType::MySql, /*seqAtOpen=*/5);
    drain(*f);
    releaseMarks(*f);
    drain(*f);
    ASSERT_FALSE(db->cursorOnlyBatches.empty());
    EXPECT_EQ(db->cursorOnlyBatches[0], 5);
    EXPECT_EQ(seqs(*db, "van_hanh"), range(6, 8));
}

// The cursor of the destination is checked against the file once: rows this forwarder sent move
// it past that mark, and a reconnection never rewinds (which would send them twice).
TEST_F(ForwarderTest, AReconnectionNeverRewindsTheCursor) {
    addRows(0, 5);
    auto db = std::make_shared<FakeDb>();
    auto f = make(db, false, true, DbType::MySql, /*seqAtOpen=*/5);
    drain(*f);
    releaseMarks(*f);
    drain(*f);
    addRows(0, 5);  // seq 6 … 10, cursor 10 > 5
    drain(*f);
    db->failBatches = 1;
    db->failBatchClass = ErrorClass::Connect;  // the connection drops
    addRows(0, 1);
    drain(*f);
    advance(1000);
    drain(*f);  // reconnects: cursor 10 is read again, nothing rewound
    EXPECT_TRUE(db->cursorOnlyBatches.empty());
    EXPECT_EQ(seqs(*db, "van_hanh"), range(1, 11));
    EXPECT_EQ(db->connects, 2);
}

// ---- review of the fixes (C1 mark kept on the device, I3 damaged file, I4 partly refused)

// Review C1: with a mark kept in history.db, a group sends nothing past it before the historian
// removed the mark from the device for good (else a power cut could bring the mark back after rows
// passed it, and they would be sent twice).
TEST_F(ForwarderTest, AGroupSendsOnlyOnceItsMarkIsOffTheDevice) {
    addRows(0, 3);
    auto db = std::make_shared<FakeDb>();
    auto f = make(db, false, true, DbType::MySql, /*seqAtOpen=*/3);
    drain(*f);
    EXPECT_EQ(db->batches, 0);
    auto checked = f->takeCheckedMarks();
    std::sort(checked.begin(), checked.end());
    EXPECT_EQ(checked, (std::vector<std::string>{"bao_cao_ca", "van_hanh"}));
    EXPECT_TRUE(f->takeCheckedMarks().empty());
    f->marksCleared({"van_hanh"});
    drain(*f);
    EXPECT_EQ(seqs(*db, "van_hanh"), range(1, 3));
}

// Review I3: a damaged page of history.db found while reading: that group shows the error and
// waits, the other groups go on, and the historian is told which file is damaged.
TEST_F(ForwarderTest, ADamagedPageOfTheFileIsAnErrorAndIsReported) {
    addRows(0, 3);
    addRows(1, 2);
    damageTable("log_van_hanh");
    auto db = std::make_shared<FakeDb>();
    auto f = make(db);
    drain(*f);
    EXPECT_EQ(seqs(*db, "bao_cao_ca"), range(1, 2));
    EXPECT_TRUE(seqs(*db, "van_hanh").empty());
    const auto s = f->status();
    EXPECT_EQ(s.state, DestState::Error);
    EXPECT_EQ(s.lastError, ErrorClass::Sql);
    EXPECT_EQ(s.lastErrorDbCode, "sqlite:11");
    EXPECT_EQ(f->takeCorruptFile(), store_->instanceId());
    EXPECT_EQ(f->takeCorruptFile(), "");  // reported once
}

// Review I4: the server took a batch but refused part of it (InfluxDB "field type conflict"): the
// rows count as sent (sending them again fails the same way), and the error shows until a batch
// goes through whole.
TEST_F(ForwarderTest, APartlyRefusedBatchIsSentAndTheErrorShows) {
    addRows(0, 2);
    auto db = std::make_shared<FakeDb>();
    db->softError = ErrorClass::SchemaMismatch;
    auto f = make(db);
    drain(*f);
    EXPECT_EQ(seqs(*db, "van_hanh"), range(1, 2));
    auto s = f->status();
    EXPECT_EQ(s.state, DestState::Error);
    EXPECT_EQ(s.lastError, ErrorClass::SchemaMismatch);
    EXPECT_EQ(s.sentRows, 2u);
    advance(10000);
    drain(*f);  // nothing new: the error stays
    EXPECT_EQ(f->status().state, DestState::Error);
    db->softError = ErrorClass::None;
    addRows(0, 1);
    drain(*f);
    EXPECT_EQ(f->status().state, DestState::Ok);
    EXPECT_EQ(db->attempts["van_hanh"], 2);  // no batch was sent twice
}

// org and bucket may hold '|': the keys of different buckets never collide.
TEST(ForwardCursorKey, DifferentBucketsNeverShareAKey) {
    ConnectionModel a, b;
    a.id = b.id = "in";
    a.type = b.type = DbType::InfluxDb;
    a.url = b.url = "http://influx:8086";
    a.org = "a|b";
    a.bucket = "c";
    b.org = "a";
    b.bucket = "b|c";
    EXPECT_NE(forwardCursorKey(a), forwardCursorKey(b));
    EXPECT_NE(forwardCursorKey(a).find("influx:8086"), std::string::npos);
}

// Review I6: after history.db was replaced the forwarder reads the new file and tags its rows with
// the new instance id, whose cursor at the destination starts at 0.
TEST_F(ForwarderTest, AfterTheFileIsReplacedTheNewRowsGoWithTheNewInstanceId) {
    addRows(0, 3);
    auto db = std::make_shared<FakeDb>();
    auto f = make(db);
    drain(*f);
    const std::string oldId = store_->instanceId();
    std::string err;
    ASSERT_TRUE(store_->replaceCorrupt(err)) << err;
    ASSERT_TRUE(store_->ensureTables(specs(false), err)) << err;
    ASSERT_NE(store_->instanceId(), oldId);
    addRows(0, 2);  // seq 1, 2 of the new file
    f->reopen();
    drain(*f);
    EXPECT_EQ(seqs(*db, "van_hanh"), (std::vector<int64_t>{1, 2, 3, 1, 2}));
    EXPECT_EQ(db->sources.front(), oldId);
    EXPECT_EQ(db->sources.back(), store_->instanceId());
}
