// Audit of tag writes: audit.db version 2 (specs/006 T142; data-model §9; research R15): the
// migration, the actions tag.write and driver.test, the two transactions of a write, the table of
// request ids and its clean-up, the recovery of commands the process left open, the filter by Tag.
// Fake clocks and boot ids; the file is a real SQLite file in a temporary directory.
#include <gtest/gtest.h>
#include <unistd.h>

#include <cstdio>
#include <fstream>
#include <map>
#include <sstream>

#include "core/audit/audit_log.hpp"
#include "nlohmann/json.hpp"
#include "sqlite3.h"

using namespace mat;
using nlohmann::json;

namespace {

constexpr int64_t kT0 = 1791594000000;
constexpr int64_t kMinute = 60000;
const std::string kId1 = "6f1c2a8e-4b7d-4c1e-9a3f-1a2b3c4d5e6f";

std::string idN(int n) {
    char b[64];
    std::snprintf(b, sizeof b, "00000000-0000-4000-8000-%012d", n);
    return b;
}

std::string tempDir() {
    char tmpl[] = "/tmp/mat-tw-audit-XXXXXX";
    const char* d = mkdtemp(tmpl);
    return d ? d : "";
}

struct Db {
    sqlite3* db = nullptr;
    explicit Db(const std::string& path) {
        sqlite3_open_v2(path.c_str(), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nullptr);
        sqlite3_busy_timeout(db, 5000);
    }
    ~Db() { sqlite3_close(db); }
    int exec(const std::string& sql) {
        return sqlite3_exec(db, sql.c_str(), nullptr, nullptr, nullptr);
    }
    int64_t integer(const std::string& sql) {
        sqlite3_stmt* st = nullptr;
        int64_t v = -1;
        if (sqlite3_prepare_v2(db, sql.c_str(), -1, &st, nullptr) == SQLITE_OK &&
            sqlite3_step(st) == SQLITE_ROW && sqlite3_column_type(st, 0) != SQLITE_NULL)
            v = sqlite3_column_int64(st, 0);
        sqlite3_finalize(st);
        return v;
    }
    std::string text(const std::string& sql) {
        sqlite3_stmt* st = nullptr;
        std::string v = "<none>";
        if (sqlite3_prepare_v2(db, sql.c_str(), -1, &st, nullptr) == SQLITE_OK &&
            sqlite3_step(st) == SQLITE_ROW && sqlite3_column_type(st, 0) != SQLITE_NULL)
            v = reinterpret_cast<const char*>(sqlite3_column_text(st, 0));
        sqlite3_finalize(st);
        return v;
    }
};

struct Fx {
    std::string dir = tempDir();
    int64_t wall = kT0;
    int64_t mono = 5000000;
    std::string boot = "boot-A";
    int maxRows = 4096;

    AuditOptions opts() {
        AuditOptions o;
        o.dataDir = dir;
        o.clock.wallMs = [this] { return wall; };
        o.clock.monoMs = [this] { return mono; };
        o.clock.synced = [](int64_t) { return true; };
        o.bootId = boot;
        o.tagWriteMaxRows = static_cast<size_t>(maxRows);
        return o;
    }
    std::unique_ptr<AuditLog> open() {
        auto log = std::make_unique<AuditLog>(opts());
        std::string err;
        EXPECT_TRUE(log->open(err)) << err;
        return log;
    }
    std::string file() const { return dir + "/audit.db"; }
    void advance(int64_t ms) {
        wall += ms;
        mono += ms;
    }
};

AuditEvent started(const std::string& tag = "TANK01.SP", const std::string& user = "vh1") {
    AuditEvent e(AuditAction::TagWrite, AuditResult::Started, AuditChannel::Https,
                 "10.0.0.7:51000");
    e.user = user;
    e.role = "operator";
    e.target = tag;
    e.code = "ACCEPTED";
    e.detail =
        R"({"requestId":"x","kind":"external","channel":"plc1","device":"d1","old":{"value":72.5,"quality":"GOOD"},"new":75})";
    return e;
}

AuditEvent result(const char* code, AuditResult r = AuditResult::Ok,
                  const std::string& tag = "TANK01.SP", const std::string& user = "vh1") {
    AuditEvent e(AuditAction::TagWrite, r, AuditChannel::Https, "10.0.0.7:51000");
    e.user = user;
    e.role = "operator";
    e.target = tag;
    e.code = code;
    e.detail = R"({"requestId":"x","readback":75})";
    return e;
}

// A version 1 file as the audit log of feature 005 leaves it, with one row.
void makeVersion1(const std::string& path) {
    Db db(path);
    db.exec("PRAGMA page_size=1024");
    db.exec("PRAGMA journal_mode=WAL");
    db.exec(
        "CREATE TABLE audit(id INTEGER PRIMARY KEY, ts_ms INTEGER NOT NULL, clock_ok INTEGER NOT "
        "NULL CHECK(clock_ok IN (0, 1)), "
        "user TEXT, role TEXT, source TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN "
        "('https', 'http', 'cli', 'system')), "
        "action TEXT NOT NULL, target TEXT, result TEXT NOT NULL CHECK(result IN ('ok', 'failed', "
        "'denied', 'started', 'rolled-back', "
        "'interrupted')), code TEXT, detail TEXT, count INTEGER NOT NULL DEFAULT 1 CHECK(count >= "
        "1));"
        "CREATE INDEX audit_ts ON audit(ts_ms);CREATE INDEX audit_user_ts ON audit(user, ts_ms);"
        "CREATE INDEX audit_action_ts ON audit(action, ts_ms);");
    db.exec("INSERT INTO audit(ts_ms, clock_ok, source, channel, action, result) VALUES(" +
            std::to_string(kT0) + ", 1, 'system', 'system', 'cert.generate', 'ok')");
    db.exec("PRAGMA user_version=1");
}

}  // namespace

// ---------- migration ----------

TEST(TagWriteAudit, AVersion1FileGoesToVersion3WithTheTableAndKeepsItsRows) {
    Fx f;
    makeVersion1(f.file());
    auto log = f.open();
    EXPECT_EQ(log->pragmaInt("user_version"), 3);
    std::string err;
    EXPECT_TRUE(log->execForTest("SELECT count(*) FROM tag_write_request", err)) << err;
    AuditQuery q;
    q.actionPrefix = "cert.";
    EXPECT_EQ(log->query(q).records.size(), 1u) << "the old row is still there";
    log->close();
    // opening again changes nothing
    log = f.open();
    EXPECT_EQ(log->pragmaInt("user_version"), 3);
}

// Version 3 (feature 007): the channel `web`. SQLite cannot change a CHECK, so the table is rebuilt
// once; rows, ids and indexes stay.
TEST(TagWriteAudit, AVersion2FileIsRebuiltToAcceptTheWebChannelAndKeepsItsRows) {
    Fx f;
    makeVersion1(f.file());  // the table of 005 and 006 is the same: only user_version differs
    {
        Db db(f.file());
        db.exec("INSERT INTO audit(ts_ms, clock_ok, source, channel, action, result) VALUES(" +
                std::to_string(kT0 + 1) + ", 1, '10.0.0.7:1', 'https', 'tag.write', 'ok')");
        db.exec("PRAGMA user_version=2");
        EXPECT_NE(db.exec("INSERT INTO audit(ts_ms, clock_ok, source, channel, action, result) "
                          "VALUES(1, 1, 'x', 'web', 'tag.write', 'ok')"),
                  SQLITE_OK)
            << "the old table refuses the channel";
    }
    auto log = f.open();
    EXPECT_EQ(log->pragmaInt("user_version"), 3);
    AuditQuery q;
    q.limit = 100;
    EXPECT_EQ(log->query(q).records.size(), 2u) << "both old rows are still there";
    AuditEvent e(AuditAction::TagWrite, AuditResult::Ok, AuditChannel::Web, "10.0.0.7:51000");
    e.user = "vh1";
    log->append(e);
    log->close();
    Db db(f.file());
    EXPECT_EQ(db.integer("SELECT count(*) FROM audit WHERE channel = 'web'"), 1);
    EXPECT_EQ(db.integer("SELECT count(*) FROM sqlite_master WHERE type = 'index' AND "
                         "name IN ('audit_ts', 'audit_user_ts', 'audit_action_ts')"),
              3);
    EXPECT_EQ(db.integer("SELECT count(*) FROM sqlite_master WHERE name = 'audit_v2'"), 0);
    // read back with the channel
    log = f.open();
    const auto rows = log->query(q).records;
    ASSERT_EQ(rows.size(), 3u);
    EXPECT_EQ(rows.front().channel, "web");
    // opening again rebuilds nothing
    log->close();
    log = f.open();
    EXPECT_EQ(log->query(q).records.size(), 3u);
}

TEST(TagWriteAudit, ANewFileIsVersion3AndEveryCommitIsFull) {
    Fx f;
    auto log = f.open();
    EXPECT_EQ(log->pragmaInt("user_version"), 3);
    EXPECT_EQ(log->pragmaInt("synchronous"), 2) << "FULL (Constitution 2.0.1)";
    EXPECT_EQ(log->pragmaText("journal_mode"), "wal");
}

TEST(TagWriteAudit, TheCodeOfFeature005StillOpensAVersion3File) {
    // what AuditLog::open of feature 005 does: CREATE ... IF NOT EXISTS, and only version 0 is
    // stamped
    Fx f;
    {
        auto log = f.open();
        log->appendTagWriteStarted(started(), kId1);
    }
    Db db(f.file());
    EXPECT_EQ(db.exec("BEGIN IMMEDIATE;"
                      "CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY);"
                      "INSERT INTO audit(ts_ms, clock_ok, source, channel, action, result) "
                      "VALUES(2, 1, 'system', 'system', 'auth.login', 'ok');"
                      "COMMIT;"),
              SQLITE_OK);
    EXPECT_EQ(db.integer("SELECT user_version FROM pragma_user_version"), 3) << "never lowered";
    EXPECT_EQ(db.integer("SELECT count(*) FROM tag_write_request"), 1)
        << "the extra table is left alone";
}

// ---------- actions ----------

TEST(TagWriteAudit, TheActionsExistAndDeniedOnesAreCoalescedOver60Seconds) {
    Fx f;
    auto log = f.open();
    EXPECT_STREQ(auditActionName(AuditAction::TagWrite), "tag.write");
    EXPECT_STREQ(auditActionName(AuditAction::DriverTest), "driver.test");
    EXPECT_EQ(parseAuditAction("tag.write"), AuditAction::TagWrite);
    EXPECT_EQ(parseAuditAction("driver.test"), AuditAction::DriverTest);
    EXPECT_TRUE(auditLimited(AuditAction::TagWrite, AuditResult::Denied));
    EXPECT_TRUE(auditLimited(AuditAction::DriverTest, AuditResult::Denied));
    EXPECT_FALSE(auditLimited(AuditAction::TagWrite, AuditResult::Ok));
    EXPECT_FALSE(auditLimited(AuditAction::TagWrite, AuditResult::Started));
    EXPECT_FALSE(auditLimited(AuditAction::TagWrite, AuditResult::Failed));
    EXPECT_FALSE(auditLimited(AuditAction::TagWrite, AuditResult::Interrupted));

    AuditEvent d(AuditAction::TagWrite, AuditResult::Denied, AuditChannel::Https, "10.0.0.7:51000");
    d.user = "vh1";
    d.target = "TANK01.SP";
    d.code = "OUT_OF_LIMITS";
    d.detail = R"({"requestId":"r","value":500})";
    log->append(d);
    f.advance(5000);
    log->append(d);
    f.advance(5000);
    log->append(d);
    AuditQuery q;
    q.actionPrefix = "tag.";
    const AuditPage page = log->query(q);
    ASSERT_EQ(page.records.size(), 1u) << "one row with a count";
    EXPECT_EQ(page.records[0].count, 3);
    EXPECT_EQ(page.records[0].result, "denied");
    EXPECT_EQ(page.records[0].code.value_or(""), "OUT_OF_LIMITS");
    EXPECT_EQ(page.records[0].target.value_or(""), "TANK01.SP");
    // another Tag or another code is another row
    d.target = "TANK01.LEVEL";
    log->append(d);
    EXPECT_EQ(log->query(q).records.size(), 2u);
}

TEST(TagWriteAudit, EveryResultOfAWriteIsAcceptedAndTheResultColumnKeepsItsCheck) {
    Fx f;
    auto log = f.open();
    log->appendTagWriteStarted(started(), kId1);
    log->appendTagWriteResult(result("CONFIRMED"), kId1);
    log->appendTagWriteStarted(started(), idN(2));
    log->appendTagWriteResult(result("READBACK_MISMATCH", AuditResult::Failed), idN(2));
    AuditEvent driver(AuditAction::DriverTest, AuditResult::Ok, AuditChannel::Https,
                      "10.0.0.7:51000");
    driver.user = "kysu1";
    driver.target = "192.168.10.5:502";
    driver.code = "OK";
    log->append(driver);
    AuditQuery q;
    q.limit = 50;
    std::map<std::string, int> seen;
    for (const auto& r : log->query(q).records) ++seen[r.action + "/" + r.result];
    EXPECT_EQ(seen["tag.write/started"], 2);
    EXPECT_EQ(seen["tag.write/ok"], 1);
    EXPECT_EQ(seen["tag.write/failed"], 1);
    EXPECT_EQ(seen["driver.test/ok"], 1);
    Db db(f.file());
    EXPECT_NE(db.text("SELECT sql FROM sqlite_master WHERE name='audit'").find("'interrupted'"),
              std::string::npos);
    EXPECT_EQ(db.text("SELECT sql FROM sqlite_master WHERE name='audit'").find("'denied'") !=
                  std::string::npos,
              true);
    EXPECT_EQ(db.text("SELECT sql FROM sqlite_master WHERE name='audit'").find("tag.write"),
              std::string::npos)
        << "no new value in a CHECK";
}

// ---------- the two transactions ----------

TEST(TagWriteAudit, Transaction1WritesTheRecordAndTheRowTogether) {
    Fx f;
    auto log = f.open();
    f.wall = kT0 + 123;
    const int64_t id = log->appendTagWriteStarted(started(), kId1);
    EXPECT_GT(id, 0);
    const auto info = log->findTagWrite(kId1);
    ASSERT_TRUE(info.has_value());
    EXPECT_EQ(info->row.requestId, kId1);
    EXPECT_EQ(info->row.startedId, id);
    EXPECT_FALSE(info->row.resultId.has_value());
    EXPECT_EQ(info->row.tsMs, kT0 + 123);
    EXPECT_EQ(info->row.boot, "boot-A");
    EXPECT_EQ(info->started.id, id);
    EXPECT_EQ(info->started.action, "tag.write");
    EXPECT_EQ(info->started.result, "started");
    EXPECT_EQ(info->started.user.value_or(""), "vh1");
    EXPECT_EQ(info->started.target.value_or(""), "TANK01.SP");
    EXPECT_FALSE(info->result.has_value());
    // the file has both, at once, from another connection
    Db db(f.file());
    EXPECT_EQ(db.integer("SELECT count(*) FROM tag_write_request WHERE started_id = " +
                         std::to_string(id)),
              1);
    EXPECT_EQ(db.integer("SELECT count(*) FROM audit WHERE id = " + std::to_string(id)), 1);
}

TEST(TagWriteAudit, ARequestIdThatExistsLeavesNoStartedRecordBehind) {
    Fx f;
    auto log = f.open();
    log->appendTagWriteStarted(started(), kId1);
    Db db(f.file());
    const int64_t before = db.integer("SELECT count(*) FROM audit");
    EXPECT_THROW(log->appendTagWriteStarted(started(), kId1), AuditUnavailable);
    EXPECT_EQ(db.integer("SELECT count(*) FROM audit"), before)
        << "the transaction was rolled back whole";
    EXPECT_EQ(db.integer("SELECT count(*) FROM tag_write_request"), 1);
    // and a command that was not recorded is not sent: the caller got the exception
    EXPECT_THROW(log->appendTagWriteStarted(result("CONFIRMED"), idN(9)), std::invalid_argument)
        << "wrong kind of event";
}

TEST(TagWriteAudit, Transaction2WritesTheResultAndLinksIt) {
    Fx f;
    auto log = f.open();
    const int64_t s = log->appendTagWriteStarted(started(), kId1);
    f.advance(2000);
    const int64_t r = log->appendTagWriteResult(result("CONFIRMED"), kId1);
    EXPECT_GT(r, s);
    const auto info = log->findTagWrite(kId1);
    ASSERT_TRUE(info.has_value());
    ASSERT_TRUE(info->row.resultId.has_value());
    EXPECT_EQ(*info->row.resultId, r);
    ASSERT_TRUE(info->result.has_value());
    EXPECT_EQ(info->result->result, "ok");
    EXPECT_EQ(info->result->code.value_or(""), "CONFIRMED");
    EXPECT_EQ(info->result->tsMs, kT0 + 2000);
    // once: a second result for the same command, or a result for an unknown one, writes nothing
    Db db(f.file());
    const int64_t rows = db.integer("SELECT count(*) FROM audit");
    EXPECT_THROW(log->appendTagWriteResult(result("DEVICE_EXCEPTION", AuditResult::Failed), kId1),
                 AuditUnavailable);
    EXPECT_THROW(log->appendTagWriteResult(result("CONFIRMED"), idN(7)), AuditUnavailable);
    EXPECT_EQ(db.integer("SELECT count(*) FROM audit"), rows);
}

TEST(TagWriteAudit, DetailIsAtMost1KiBAndNeverCarriesASecret) {
    Fx f;
    auto log = f.open();
    AuditEvent big = started();
    big.detail = json{{"requestId", "x"}, {"new", std::string(5000, 'a')}}.dump();
    log->appendTagWriteStarted(big, kId1);
    const auto info = log->findTagWrite(kId1);
    ASSERT_TRUE(info.has_value());
    EXPECT_LE(info->started.detail.value_or("").size(), kAuditMaxDetailBytes);
    EXPECT_NE(info->started.detail.value_or("").find("truncated"), std::string::npos);
    AuditEvent secret = started();
    secret.detail = R"({"requestId":"x","token":"mats_abc"})";
    EXPECT_THROW(log->appendTagWriteStarted(secret, idN(2)), std::invalid_argument);
    Db db(f.file());
    EXPECT_EQ(db.integer("SELECT count(*) FROM tag_write_request"), 1)
        << "nothing of the refused one";
}

// ---------- the table of request ids ----------

TEST(TagWriteAudit, CleanUpRemovesFinishedRowsOlderThan15MinutesOfRunningTimeAndNoOther) {
    Fx f;
    auto log = f.open();
    log->appendTagWriteStarted(started(), idN(1));  // A: finished, received at t0
    log->appendTagWriteResult(result("CONFIRMED"), idN(1));
    log->appendTagWriteStarted(started(), idN(2));  // B: never finished
    f.advance(10 * kMinute);
    log->appendTagWriteStarted(started(), idN(3));  // C: finished, received 10 minutes later
    log->appendTagWriteResult(result("CONFIRMED"), idN(3));
    f.advance(4 * kMinute);  // A is 14 minutes old
    EXPECT_EQ(log->pruneTagWrites(), 0u);
    f.advance(2 * kMinute);  // A 16, C 6
    EXPECT_EQ(log->pruneTagWrites(), 1u);
    EXPECT_FALSE(log->findTagWrite(idN(1)).has_value());
    EXPECT_TRUE(log->findTagWrite(idN(2)).has_value()) << "no result yet: never removed";
    EXPECT_TRUE(log->findTagWrite(idN(3)).has_value());
    f.advance(30 * kMinute);
    EXPECT_EQ(log->pruneTagWrites(), 1u);
    EXPECT_TRUE(log->findTagWrite(idN(2)).has_value());
    // the audit rows themselves stay
    Db db(f.file());
    EXPECT_EQ(db.integer("SELECT count(*) FROM audit WHERE action = 'tag.write'"), 5);
}

TEST(TagWriteAudit, RowsOfAnEarlierBootGoOnlyAfterThisRunHasPassed15Minutes) {
    Fx f;
    {
        auto log = f.open();
        log->appendTagWriteStarted(started(), idN(1));
        log->appendTagWriteResult(result("CONFIRMED"), idN(1));
    }
    f.boot = "boot-B";  // a power cut, and a clock that may be wrong: the wall time says nothing
    f.mono = 1000;      // the clock of the new run starts again
    f.wall += 5 * 24 * 3600 * 1000LL;
    auto log = f.open();
    ASSERT_TRUE(log->findTagWrite(idN(1)).has_value());
    EXPECT_EQ(log->findTagWrite(idN(1))->row.boot, "boot-A");
    f.advance(14 * kMinute);
    EXPECT_EQ(log->pruneTagWrites(), 0u);
    f.advance(2 * kMinute);
    EXPECT_EQ(log->pruneTagWrites(), 1u);
}

TEST(TagWriteAudit, AtMost4096RowsAreKeptTheOldestFinishedGoFirst) {
    Fx f;
    f.maxRows = 20;  // the real limit is 4096; a test does not need 4100 fsyncs
    auto log = f.open();
    for (int i = 1; i <= 26; ++i) {
        log->appendTagWriteStarted(started(), idN(i));
        if (i != 3) log->appendTagWriteResult(result("CONFIRMED"), idN(i));  // 3 stays open
    }
    EXPECT_EQ(log->pruneTagWrites(), 6u) << "26 rows, 20 kept";
    EXPECT_TRUE(log->findTagWrite(idN(3)).has_value()) << "an open command is never dropped";
    EXPECT_FALSE(log->findTagWrite(idN(1)).has_value());
    EXPECT_FALSE(log->findTagWrite(idN(2)).has_value());
    EXPECT_FALSE(log->findTagWrite(idN(4)).has_value());
    EXPECT_FALSE(log->findTagWrite(idN(7)).has_value())
        << "the sixth finished one (1, 2, 4, 5, 6, 7)";
    EXPECT_TRUE(log->findTagWrite(idN(8)).has_value());
    EXPECT_TRUE(log->findTagWrite(idN(26)).has_value());
    EXPECT_EQ(log->tagWriteRowCount(), 20u);
}

// ---------- recovery at start-up ----------

TEST(TagWriteAudit, EveryOpenCommandGetsAnInterruptedRecordOnceAndItsDetailIsCopied) {
    Fx f;
    {
        auto log = f.open();
        log->appendTagWriteStarted(started("TANK01.SP", "vh1"), idN(1));
        log->appendTagWriteResult(result("CONFIRMED"), idN(1));
        log->appendTagWriteStarted(started("TANK01.SP", "vh1"), idN(2));  // the process died here
        log->appendTagWriteStarted(started("PUMP01.RUN_CMD", "vh2"), idN(3));
    }
    f.boot = "boot-B";
    auto log = f.open();
    EXPECT_EQ(log->recoverTagWrites(), 2u);
    for (int n : {2, 3}) {
        const auto info = log->findTagWrite(idN(n));
        ASSERT_TRUE(info.has_value());
        ASSERT_TRUE(info->row.resultId.has_value()) << n;
        ASSERT_TRUE(info->result.has_value());
        EXPECT_EQ(info->result->action, "tag.write");
        EXPECT_EQ(info->result->result, "interrupted");
        EXPECT_EQ(info->result->code.value_or(""), "UNKNOWN_OUTCOME");
        EXPECT_EQ(info->result->target, info->started.target);
        EXPECT_EQ(info->result->user, info->started.user);
        EXPECT_EQ(info->result->detail, info->started.detail)
            << "the detail is copied from the record of receipt";
    }
    EXPECT_EQ(log->recoverTagWrites(), 0u) << "again: nothing to do, nothing doubled";
    AuditQuery q;
    q.actionPrefix = "tag.";
    int interrupted = 0;
    for (const auto& r : log->query(q).records)
        if (r.result == "interrupted") ++interrupted;
    EXPECT_EQ(interrupted, 2);
}

TEST(TagWriteAudit, RecoveryIsOneTransactionSoADeathInTheMiddleIsRedone) {
    Fx f;
    {
        auto log = f.open();
        for (int i = 1; i <= 3; ++i) log->appendTagWriteStarted(started(), idN(i));
    }
    // every row without a result is an `interrupted` after one call; a second process that opened
    // the same file in between sees all or none
    auto log = f.open();
    Db db(f.file());
    EXPECT_EQ(db.integer("SELECT count(*) FROM tag_write_request WHERE result_id IS NULL"), 3);
    EXPECT_EQ(log->recoverTagWrites(), 3u);
    EXPECT_EQ(db.integer("SELECT count(*) FROM tag_write_request WHERE result_id IS NULL"), 0);
    EXPECT_EQ(db.integer("SELECT count(*) FROM audit WHERE result = 'interrupted'"), 3);
}

// ---------- the filter by Tag ----------

TEST(TagWriteAudit, TheQueryFiltersByTargetAndByActionTogether) {
    Fx f;
    auto log = f.open();
    log->appendTagWriteStarted(started("TANK01.SP"), idN(1));
    log->appendTagWriteResult(result("CONFIRMED", AuditResult::Ok, "TANK01.SP"), idN(1));
    log->appendTagWriteStarted(started("PUMP01.RUN_CMD"), idN(2));
    log->appendTagWriteResult(result("CONFIRMED", AuditResult::Ok, "PUMP01.RUN_CMD"), idN(2));
    AuditEvent other(AuditAction::ProjectDeploy, AuditResult::Ok, AuditChannel::Https,
                     "10.0.0.5:1");
    other.target = "TANK01.SP";  // the same text on another action
    log->append(other);
    AuditQuery q;
    q.actionPrefix = "tag.";
    q.target = "TANK01.SP";
    const AuditPage page = log->query(q);
    ASSERT_EQ(page.records.size(), 2u);
    for (const auto& r : page.records) {
        EXPECT_EQ(r.target.value_or(""), "TANK01.SP");
        EXPECT_EQ(r.action, "tag.write");
    }
    q.target = "TANK01";  // exact, not a prefix
    EXPECT_TRUE(log->query(q).records.empty());
    q.actionPrefix = "";
    q.target = "TANK01.SP";
    EXPECT_EQ(log->query(q).records.size(), 3u);
}

// ---------- bytes written per command ----------

namespace {
// Bytes the process asked the storage layer to write (Linux /proc/self/io), -1 when it is not
// there.
int64_t writeBytes() {
    std::ifstream f("/proc/self/io");
    std::string key;
    int64_t v;
    while (f >> key >> v)
        if (key == "write_bytes:") return v;
    return -1;
}
}  // namespace

TEST(TagWriteAudit, BytesWrittenForOneCommandStayInTheBudget) {
    // Research R15: about 24.1 KB per command (two FULL transactions) on ext4 with fdatasync. The
    // container's file system is not the BL335's: the number is recorded, the limit is loose.
    Fx f;
    auto log = f.open();
    for (int i = 0; i < 20; ++i) {  // warm-up: pages, WAL
        log->appendTagWriteStarted(started(), idN(100 + i));
        log->appendTagWriteResult(result("CONFIRMED"), idN(100 + i));
    }
    const int64_t before = writeBytes();
    constexpr int kCommands = 200;
    for (int i = 0; i < kCommands; ++i) {
        log->appendTagWriteStarted(started(), idN(1000 + i));
        log->appendTagWriteResult(result("CONFIRMED"), idN(1000 + i));
    }
    const int64_t after = writeBytes();
    if (before < 0 || after < 0) GTEST_SKIP() << "no /proc/self/io";
    const double perCommand = static_cast<double>(after - before) / kCommands;
    RecordProperty("bytes_per_command", std::to_string(static_cast<int64_t>(perCommand)));
    std::printf("tag write audit: %.0f bytes asked of the storage layer per command\n", perCommand);
    EXPECT_LT(perCommand, 100 * 1024.0);
}
