// Audit log of the device (specs/005-device-online T024: data-model §7, research R11): schema,
// files, durability, coalescing, rate limit, retention, size cap, detail, query. Fake clocks.
#include "core/audit/audit_log.hpp"

#include <gtest/gtest.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <fstream>
#include <map>
#include <mutex>
#include <set>
#include <thread>

#include "core/common/json_text.hpp"
#include "core/common/utf8.hpp"
#include "core/historian/clock.hpp"
#include "nlohmann/json.hpp"
#include "sqlite3.h"

using namespace mat;

namespace {

constexpr int64_t kT0 = 1791594000000;  // 2026-10-10T01:00:00Z
constexpr int64_t kDay = 86400000;
constexpr int64_t kMinute = 60000;

std::string tempDir() {
    char tmpl[] = "/tmp/mat-audit-XXXXXX";
    const char* d = mkdtemp(tmpl);
    return d ? d : "";
}

unsigned modeOf(const std::string& path) {  // 0 when the file does not exist
    struct stat st {};
    return ::stat(path.c_str(), &st) == 0 ? static_cast<unsigned>(st.st_mode & 07777) : 0u;
}

// A second connection to the file, as another process would have.
struct Db {
    sqlite3* db = nullptr;
    explicit Db(const std::string& path) {
        sqlite3_open_v2(path.c_str(), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nullptr);
        sqlite3_busy_timeout(db, 5000);
    }
    ~Db() { sqlite3_close(db); }
    Db(const Db&) = delete;
    Db& operator=(const Db&) = delete;

    int exec(const std::string& sql) {
        return sqlite3_exec(db, sql.c_str(), nullptr, nullptr, nullptr);
    }
    // Every column as text, "NULL" for NULL.
    std::vector<std::vector<std::string>> rows(const std::string& sql) {
        std::vector<std::vector<std::string>> out;
        sqlite3_stmt* st = nullptr;
        if (sqlite3_prepare_v2(db, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) return out;
        while (sqlite3_step(st) == SQLITE_ROW) {
            std::vector<std::string> r;
            for (int i = 0; i < sqlite3_column_count(st); ++i) {
                const auto* t = reinterpret_cast<const char*>(sqlite3_column_text(st, i));
                r.push_back(sqlite3_column_type(st, i) == SQLITE_NULL
                                ? "NULL"
                                : std::string(t, static_cast<size_t>(sqlite3_column_bytes(st, i))));
            }
            out.push_back(std::move(r));
        }
        sqlite3_finalize(st);
        return out;
    }
    std::string text(const std::string& sql) {
        auto r = rows(sql);
        return r.empty() || r[0].empty() ? "<none>" : r[0][0];
    }
    int64_t integer(const std::string& sql) {
        auto r = rows(sql);
        return r.empty() || r[0].empty() || r[0][0] == "NULL" ? -1 : std::stoll(r[0][0]);
    }
};

// Fake clocks: wall (UTC ms), mono (CLOCK_BOOTTIME ms), and the sync check.
struct Fixture {
    std::string dir = tempDir();
    int64_t wall = kT0;
    int64_t mono = 7 * kDay;
    bool synced = true;
    int64_t lastSyncArg = -1;

    AuditOptions opts() {
        AuditOptions o;
        o.dataDir = dir;
        o.clock.wallMs = [this] { return wall; };
        o.clock.monoMs = [this] { return mono; };
        o.clock.synced = [this](int64_t w) {
            lastSyncArg = w;
            return synced;
        };
        return o;
    }
    void advance(int64_t ms) {
        wall += ms;
        mono += ms;
    }
};

struct Opened : Fixture {
    std::unique_ptr<AuditLog> log;
    explicit Opened(int64_t maxBytes = 64LL * 1024 * 1024) {
        AuditOptions o = opts();
        o.maxBytes = maxBytes;
        log = std::make_unique<AuditLog>(o);
        std::string err;
        EXPECT_TRUE(log->open(err)) << err;
    }
};

AuditEvent failedLogin(const std::string& user, const std::string& source) {
    AuditEvent e(AuditAction::AuthLogin, AuditResult::Failed, AuditChannel::Https, source);
    e.user = user;
    e.code = "AUTH_FAILED";
    return e;
}

AuditEvent deployStarted() {
    AuditEvent e(AuditAction::ProjectDeploy, AuditResult::Started, AuditChannel::Https,
                 "192.168.1.20:51234");
    e.user = "eng1";
    e.role = "engineer";
    return e;
}

std::map<int64_t, AuditRecord> byId(const AuditPage& page) {
    std::map<int64_t, AuditRecord> out;
    for (const auto& r : page.records) out[r.id] = r;
    return out;
}

std::vector<int64_t> idsOf(const AuditPage& page) {
    std::vector<int64_t> out;
    for (const auto& r : page.records) out.push_back(r.id);
    return out;
}

int64_t usedBytes(AuditLog& log) {
    return (log.pragmaInt("page_count") - log.pragmaInt("freelist_count")) *
           log.pragmaInt("page_size");
}

}  // namespace

// ---- catalogue (data-model §7, table "Danh mục action")

TEST(AuditActions, CatalogueIsTheTableOfTheDataModel) {
    std::vector<std::string> expected = {
        "auth.login",           "auth.locked",      "auth.lockout",   "auth.logout",
        "auth.session-revoked", "access.denied",    "project.deploy", "project.restore",
        "project.read",         "project.adopt",    "cert.generate",  "cert.regenerate",
        "audit.read",           "audit.export",     "audit.purged",   "audit.suppressed",
        "account.create",       "account.password", "account.role",   "account.disable",
        "account.enable",       "account.unlock",   "driver.test",    "tag.write",
        "auth.session_evicted", "tls.csr",          "tls.import",     "alarm.ack",
        "alarm.shelve",         "alarm.unshelve",   "alarm.disable",  "alarm.enable",
        "alarm.purged",         "history.export"};
    expected.push_back("auth.distributed_attack");  // feature 011
    std::vector<std::string> names;
    for (AuditAction a : kAuditActions) {
        names.push_back(auditActionName(a));
        const auto back = parseAuditAction(auditActionName(a));
        ASSERT_TRUE(back.has_value()) << auditActionName(a);
        EXPECT_TRUE(*back == a) << auditActionName(a);
    }
    EXPECT_EQ(names, expected);
    EXPECT_FALSE(parseAuditAction("Auth.Login").has_value());
    EXPECT_FALSE(parseAuditAction("tag.writes").has_value());

    std::vector<std::string> results;
    for (AuditResult r : {AuditResult::Ok, AuditResult::Failed, AuditResult::Denied,
                          AuditResult::Started, AuditResult::RolledBack, AuditResult::Interrupted})
        results.push_back(auditResultName(r));
    EXPECT_EQ(results, (std::vector<std::string>{"ok", "failed", "denied", "started", "rolled-back",
                                                 "interrupted"}));
    std::vector<std::string> channels;
    for (AuditChannel c : {AuditChannel::Https, AuditChannel::Http, AuditChannel::Cli,
                           AuditChannel::System, AuditChannel::Web})
        channels.push_back(auditChannelName(c));
    EXPECT_EQ(channels, (std::vector<std::string>{"https", "http", "cli", "system", "web"}));
}

// Research R11: failed sign-in, refusal while locked and refused access are limited; changes
// and successful sign-ins never are.
TEST(AuditActions, OnlyFailedSignInLockedAndDeniedAreLimited) {
    EXPECT_TRUE(auditLimited(AuditAction::AuthLogin, AuditResult::Failed));
    EXPECT_FALSE(auditLimited(AuditAction::AuthLogin, AuditResult::Ok));
    EXPECT_TRUE(auditLimited(AuditAction::AuthLocked, AuditResult::Denied));
    EXPECT_TRUE(auditLimited(AuditAction::AccessDenied, AuditResult::Denied));
    EXPECT_FALSE(auditLimited(AuditAction::AuthLockout, AuditResult::Denied));
    EXPECT_FALSE(auditLimited(AuditAction::ProjectDeploy, AuditResult::Failed));
    EXPECT_FALSE(auditLimited(AuditAction::AccountPassword, AuditResult::Ok));
    int limited = 0;
    for (AuditAction a : kAuditActions)
        for (AuditResult r :
             {AuditResult::Ok, AuditResult::Failed, AuditResult::Denied, AuditResult::Started,
              AuditResult::RolledBack, AuditResult::Interrupted})
            limited += auditLimited(a, r) ? 1 : 0;
    EXPECT_EQ(limited, 1 + 6 + 6 + 2 + 5);  // auth.login failed; auth.locked, access.denied: any
                                            // result; driver.test, tag.write: denied; the five
                                            // refusable alarm actions: denied
}

// ---- options, schema, files

TEST(AuditLog, OptionsDefaultToTheDeviceConfiguration) {
    AuditOptions o;
    EXPECT_EQ(o.retentionDays, 365);            // auditRetentionDays
    EXPECT_EQ(o.maxBytes, 64LL * 1024 * 1024);  // auditMaxMB
    EXPECT_EQ(kAuditWindowMs, 60000);           // coalescing window
    EXPECT_EQ(kAuditLimitedRowsPerWindow, 10);  // rows per minute
    EXPECT_EQ(kAuditMaxDetailBytes, 1024u);
    EXPECT_EQ(kAuditQueryDefaultLimit, 100);
    EXPECT_EQ(kAuditQueryMaxLimit, 200);
    EXPECT_STREQ(kAuditFileName, "audit.db");

    EXPECT_THROW({ AuditLog l(o); }, std::invalid_argument);  // no dataDir
    o.dataDir = tempDir();
    o.retentionDays = 0;
    EXPECT_THROW({ AuditLog l(o); }, std::invalid_argument);
    o.retentionDays = 365;
    o.maxBytes = 0;
    EXPECT_THROW({ AuditLog l(o); }, std::invalid_argument);
}

TEST(AuditLog, CreatesTheAuditTableWithItsColumnsAndIndexes) {
    Opened f;
    EXPECT_TRUE(f.log->isOpen());
    EXPECT_EQ(f.log->path(), f.dir + "/audit.db");
    Db db(f.log->path());
    const auto cols = db.rows("PRAGMA table_info(audit)");  // cid, name, type, notnull, dflt, pk
    std::vector<std::string> names, types, notNull;
    for (const auto& r : cols) {
        names.push_back(r[1]);
        types.push_back(r[2]);
        notNull.push_back(r[3]);
    }
    EXPECT_EQ(names, (std::vector<std::string>{"id", "ts_ms", "clock_ok", "user", "role", "source",
                                               "channel", "action", "target", "result", "code",
                                               "detail", "count"}));
    EXPECT_EQ(types, (std::vector<std::string>{"INTEGER", "INTEGER", "INTEGER", "TEXT", "TEXT",
                                               "TEXT", "TEXT", "TEXT", "TEXT", "TEXT", "TEXT",
                                               "TEXT", "INTEGER"}));
    // NULL only where the data model allows it: user, role, target, code, detail
    EXPECT_EQ(notNull, (std::vector<std::string>{"0", "1", "1", "0", "0", "1", "1", "1", "0", "1",
                                                 "0", "0", "1"}));
    ASSERT_FALSE(cols.empty());
    EXPECT_EQ(cols[0][5], "1");  // id is the INTEGER PRIMARY KEY

    std::set<std::vector<std::string>> indexes;
    for (const auto& r :
         db.rows("PRAGMA index_list(audit)")) {  // seq, name, unique, origin, partial
        std::vector<std::string> c;
        for (const auto& ir : db.rows("PRAGMA index_info(\"" + r[1] + "\")")) c.push_back(ir[2]);
        indexes.insert(c);
    }
    EXPECT_EQ(indexes, (std::set<std::vector<std::string>>{
                           {"ts_ms"}, {"user", "ts_ms"}, {"action", "ts_ms"}}));
}

TEST(AuditLog, TableTakesOnlyTheChannelsAndResultsOfTheDataModel) {
    Opened f;
    Db db(f.log->path());
    auto insert = [&](const std::string& channel, const std::string& result, int clockOk,
                      int count) {
        return db.exec(
            "INSERT INTO audit(ts_ms, clock_ok, source, channel, action, result, count) "
            "VALUES(1, " +
            std::to_string(clockOk) + ", 'system', '" + channel + "', 'auth.login', '" + result +
            "', " + std::to_string(count) + ")");
    };
    for (const char* c : {"https", "http", "cli", "system"})
        EXPECT_EQ(insert(c, "ok", 1, 1), SQLITE_OK) << c;
    for (const char* r : {"ok", "failed", "denied", "started", "rolled-back", "interrupted"})
        EXPECT_EQ(insert("cli", r, 0, 3), SQLITE_OK) << r;
    EXPECT_EQ(insert("ws", "ok", 1, 1), SQLITE_CONSTRAINT);
    EXPECT_EQ(insert("HTTPS", "ok", 1, 1), SQLITE_CONSTRAINT);
    EXPECT_EQ(insert("https", "success", 1, 1), SQLITE_CONSTRAINT);
    EXPECT_EQ(insert("https", "ok", 2, 1), SQLITE_CONSTRAINT);  // clock_ok is 0 or 1
    EXPECT_EQ(insert("https", "ok", 1, 0), SQLITE_CONSTRAINT);  // count >= 1
}

TEST(AuditLog, UsesWalWithFullSyncAndA256KiBCache) {
    Opened f;
    EXPECT_EQ(f.log->pragmaText("journal_mode"), "wal");
    EXPECT_EQ(f.log->pragmaInt("synchronous"), 2);    // FULL: Constitution 2.0.1, ADR-011
    EXPECT_EQ(f.log->pragmaInt("cache_size"), -256);  // 256 KiB
}

// A row touches four B-tree pages (table, three indexes): 1 KiB pages write about a third of the
// WAL bytes of 4 KiB pages per synced commit (x64 measure in tasks.md T025). A file made before
// keeps its page size.
TEST(AuditLog, NewFilesUse1KiBPages) {
    Opened f;
    EXPECT_EQ(f.log->pragmaInt("page_size"), 1024);

    Fixture g;
    {
        Db db(g.dir + "/audit.db");
        ASSERT_EQ(db.exec("PRAGMA page_size=4096; CREATE TABLE other(a)"), SQLITE_OK);
    }
    AuditLog log(g.opts());
    std::string err;
    ASSERT_TRUE(log.open(err)) << err;
    EXPECT_EQ(log.pragmaInt("page_size"), 4096);
    EXPECT_GT(log.append(deployStarted()), 0);
}

TEST(AuditLog, FilesArePrivateIncludingWalAndShm) {
    const mode_t old = ::umask(022);  // a usual umask: files would be 0644 without the build flag
    {
        Opened f;
        ASSERT_GT(f.log->append(deployStarted()), 0);
        const std::string p = f.log->path();
        EXPECT_EQ(modeOf(p), 0600u);
        EXPECT_EQ(modeOf(p + "-wal"), 0600u);
        EXPECT_EQ(modeOf(p + "-shm"), 0600u);
    }
    ::umask(old);
}

TEST(AuditLog, AnExistingFileIsMadePrivate) {
    Fixture f;
    const std::string p = f.dir + "/audit.db";
    {
        Db db(p);
        ASSERT_EQ(db.exec("CREATE TABLE other(a)"), SQLITE_OK);
    }
    ASSERT_EQ(::chmod(p.c_str(), 0644), 0);
    AuditLog log(f.opts());
    std::string err;
    ASSERT_TRUE(log.open(err)) << err;
    ASSERT_GT(log.append(deployStarted()), 0);
    EXPECT_EQ(modeOf(p), 0600u);
    EXPECT_EQ(modeOf(p + "-wal"), 0600u);
    EXPECT_EQ(modeOf(p + "-shm"), 0600u);
}

// ---- append

TEST(AuditLog, AppendReturnsOnceTheRowIsCommitted) {
    Opened f;
    AuditEvent e = deployStarted();
    e.target = "sha256:00ff";
    e.code = "E_TEST";
    e.detail = R"({"opId":"op-1","from":"sha256:00","to":"sha256:ff"})";
    const int64_t id = f.log->append(e);
    EXPECT_GT(id, 0);
    // another connection sees the row: committed, not waiting in an open transaction
    Db db(f.log->path());
    const auto rows = db.rows(
        "SELECT id, ts_ms, clock_ok, user, role, source, channel, action, target, result, code, "
        "count, detail FROM audit");
    ASSERT_EQ(rows.size(), 1u);
    const std::vector<std::string> head(rows[0].begin(), rows[0].end() - 1);
    EXPECT_EQ(head,
              (std::vector<std::string>{std::to_string(id), std::to_string(kT0), "1", "eng1",
                                        "engineer", "192.168.1.20:51234", "https", "project.deploy",
                                        "sha256:00ff", "started", "E_TEST", "1"}));
    EXPECT_EQ(nlohmann::json::parse(rows[0].back()), nlohmann::json::parse(e.detail));
}

TEST(AuditLog, AbsentFieldsAreStoredAsNull) {
    Opened f;
    const int64_t id = f.log->append(
        AuditEvent(AuditAction::CertGenerate, AuditResult::Ok, AuditChannel::System, "system"));
    Db db(f.log->path());
    const auto rows = db.rows(
        "SELECT user, role, target, code, detail, count, channel, source FROM audit WHERE id = " +
        std::to_string(id));
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0], (std::vector<std::string>{"NULL", "NULL", "NULL", "NULL", "NULL", "1",
                                                 "system", "system"}));
}

// A write that fails (simulated with PRAGMA query_only, as in 003) throws AuditUnavailable and
// stores nothing; the log works again once the file is writable.
TEST(AuditLog, WriteFailureThrowsAuditUnavailable) {
    Opened f;
    std::string err;
    ASSERT_TRUE(f.log->execForTest("PRAGMA query_only=1", err)) << err;
    bool thrown = false;
    try {
        f.log->append(deployStarted());
    } catch (const AuditUnavailable& e) {
        thrown = true;
        EXPECT_EQ(e.sqliteCode() & 0xff, SQLITE_READONLY) << e.what();
    }
    EXPECT_TRUE(thrown);
    EXPECT_THROW(f.log->append(failedLogin("x", "10.0.0.1:1")), AuditUnavailable);
    ASSERT_TRUE(f.log->execForTest("PRAGMA query_only=0", err)) << err;
    EXPECT_GT(f.log->append(deployStarted()), 0);
    EXPECT_GT(f.log->append(failedLogin("x", "10.0.0.1:2")), 0);  // the failed one left no state
    Db db(f.log->path());
    EXPECT_EQ(db.integer("SELECT count(*) FROM audit"), 2);
    EXPECT_EQ(db.integer("SELECT count FROM audit WHERE action = 'auth.login'"), 1);
}

TEST(AuditLog, WithoutAnOpenFileEveryAppendThrows) {
    Fixture f;
    AuditLog never(f.opts());
    EXPECT_FALSE(never.isOpen());
    EXPECT_THROW(never.append(deployStarted()), AuditUnavailable);
    EXPECT_THROW(never.query({}), AuditUnavailable);

    AuditOptions o = f.opts();
    o.dataDir = f.dir + "/missing/dir";
    AuditLog bad(o);
    std::string err;
    EXPECT_FALSE(bad.open(err));
    EXPECT_FALSE(err.empty());
    EXPECT_FALSE(bad.isOpen());
    EXPECT_THROW(bad.append(failedLogin("x", "10.0.0.1:1")), AuditUnavailable);

    Opened g;
    g.log->close();
    EXPECT_FALSE(g.log->isOpen());
    EXPECT_THROW(g.log->append(deployStarted()), AuditUnavailable);
}

TEST(AuditLog, AnEventNeedsASource) {
    Opened f;
    EXPECT_THROW(
        f.log->append(AuditEvent(AuditAction::AuditRead, AuditResult::Ok, AuditChannel::Https, "")),
        std::invalid_argument);
}

// ---- coalescing and rate limit (research R11)

TEST(AuditLog, FailedSignInsAreCoalescedPerAddressAndUserFor60s) {
    Opened f;
    std::vector<int64_t> ids;
    for (int i = 0; i < 5; ++i) {  // 0, 10, 20, 30, 40 s; a new port for each connection
        ids.push_back(f.log->append(failedLogin("admin", "10.0.0.5:" + std::to_string(50000 + i))));
        f.advance(10000);
    }
    for (int64_t id : ids) EXPECT_EQ(id, ids[0]);
    const int64_t otherUser = f.log->append(failedLogin("guest", "10.0.0.5:50010"));
    const int64_t otherAddress = f.log->append(failedLogin("admin", "10.0.0.6:50011"));
    EXPECT_NE(otherUser, ids[0]);
    EXPECT_NE(otherAddress, ids[0]);
    EXPECT_NE(otherUser, otherAddress);
    f.advance(10000);  // 60 s after the first event: a new window
    const int64_t next = f.log->append(failedLogin("admin", "10.0.0.5:50012"));
    EXPECT_NE(next, ids[0]);

    const AuditPage page = f.log->query({});
    EXPECT_EQ(page.records.size(), 4u);
    auto rows = byId(page);
    const AuditRecord& first = rows[ids[0]];
    EXPECT_EQ(first.count, 5);
    EXPECT_EQ(first.source, "10.0.0.5");  // the port differs per connection: address only
    EXPECT_EQ(first.tsMs, kT0);           // time of the first event of the window
    EXPECT_EQ(first.user, std::optional<std::string>("admin"));
    EXPECT_EQ(first.action, "auth.login");
    EXPECT_EQ(first.result, "failed");
    EXPECT_EQ(first.code, std::optional<std::string>("AUTH_FAILED"));
    EXPECT_EQ(rows[otherUser].count, 1);
    EXPECT_EQ(rows[otherAddress].count, 1);
    EXPECT_EQ(rows[next].count, 1);
}

// Later events of a window need no write: they count in memory until the next write.
TEST(AuditLog, CoalescedEventsCountInMemoryUntilWritten) {
    Opened f;
    const int64_t id = f.log->append(failedLogin("admin", "10.0.0.5:1"));
    ASSERT_GT(id, 0);
    std::string err;
    ASSERT_TRUE(f.log->execForTest("PRAGMA query_only=1", err)) << err;
    for (int i = 0; i < 9; ++i) EXPECT_EQ(f.log->append(failedLogin("admin", "10.0.0.5:2")), id);
    f.log->flushExpired();  // the window is still open: nothing to write, no error
    f.advance(kAuditWindowMs);
    EXPECT_THROW(f.log->flushExpired(), AuditUnavailable);  // cannot be written now…
    ASSERT_TRUE(f.log->execForTest("PRAGMA query_only=0", err)) << err;
    f.log->flushExpired();  // …and was kept until it could
    Db db(f.log->path());
    EXPECT_EQ(db.integer("SELECT count FROM audit WHERE id = " + std::to_string(id)), 10);
    f.log->flushExpired();
    EXPECT_EQ(db.integer("SELECT count(*) FROM audit"), 1);
    EXPECT_EQ(db.integer("SELECT count FROM audit WHERE id = " + std::to_string(id)), 10);
}

// The row of an open window went with the size cap: the count is written in a new row, so no
// event is lost. Ids are INTEGER PRIMARY KEY (data-model §7): a deleted newest id is given again,
// and the count must not land in the row that took it.
TEST(AuditLog, ACountWhoseRowWasPurgedIsWrittenAgain) {
    Opened f;
    const int64_t id = f.log->append(failedLogin("admin", "10.0.0.5:1"));
    {
        Db db(f.log->path());
        ASSERT_EQ(db.exec("DELETE FROM audit WHERE id = " + std::to_string(id)), SQLITE_OK);
    }
    const int64_t deploy = f.log->append(deployStarted());
    EXPECT_EQ(deploy, id);  // the id is given again
    f.log->append(failedLogin("admin", "10.0.0.5:2"));
    f.log->append(failedLogin("admin", "10.0.0.5:3"));
    const AuditPage page = f.log->query({});
    ASSERT_EQ(page.records.size(), 2u);
    EXPECT_EQ(page.records[1].id, deploy);
    EXPECT_EQ(page.records[1].action, "project.deploy");
    EXPECT_EQ(page.records[1].count, 1);
    EXPECT_EQ(page.records[0].action, "auth.login");
    EXPECT_EQ(page.records[0].count, 3);
    EXPECT_EQ(page.records[0].tsMs, kT0);
    EXPECT_EQ(page.records[0].user, std::optional<std::string>("admin"));
    EXPECT_EQ(f.log->append(failedLogin("admin", "10.0.0.5:4")), page.records[0].id);
}

TEST(AuditLog, LockedAndDeniedAreCoalescedPerCode) {
    Opened f;
    auto denied = [](const char* code) {
        AuditEvent e(AuditAction::AccessDenied, AuditResult::Denied, AuditChannel::Https,
                     "10.0.0.7:4000");
        e.code = code;
        e.target = "/api/v1/project/deployments";
        return e;
    };
    const int64_t a = f.log->append(denied("AUTH_REQUIRED"));
    EXPECT_EQ(f.log->append(denied("AUTH_REQUIRED")), a);
    EXPECT_EQ(f.log->append(denied("AUTH_REQUIRED")), a);
    const int64_t b = f.log->append(denied("FORBIDDEN"));  // another refusal: its own row
    EXPECT_NE(b, a);
    AuditEvent locked(AuditAction::AuthLocked, AuditResult::Denied, AuditChannel::Https,
                      "10.0.0.7:4001");
    locked.user = "admin";
    locked.code = "AUTH_LOCKED";
    const int64_t c = f.log->append(locked);
    EXPECT_EQ(f.log->append(locked), c);
    auto rows = byId(f.log->query({}));
    EXPECT_EQ(rows.size(), 3u);
    EXPECT_EQ(rows[a].count, 3);
    EXPECT_EQ(rows[a].code, std::optional<std::string>("AUTH_REQUIRED"));
    EXPECT_EQ(rows[b].count, 1);
    EXPECT_EQ(rows[c].count, 2);
    EXPECT_EQ(rows[c].action, "auth.locked");
}

TEST(AuditLog, LimitedKindsWriteAtMostTenRowsPerMinute) {
    Opened f;
    for (int i = 0; i < 25; ++i) {  // 25 names in 25 s: 25 windows wanted
        f.log->append(failedLogin("user" + std::to_string(i), "10.0.0.9:1"));
        f.advance(1000);
    }
    const AuditPage page = f.log->query({});
    int64_t loginRows = 0, total = 0;
    std::vector<AuditRecord> suppressed;
    for (const auto& r : page.records) {
        total += r.count;
        if (r.action == "auth.login") ++loginRows;
        if (r.action == "audit.suppressed") suppressed.push_back(r);
    }
    EXPECT_EQ(loginRows, 10);
    ASSERT_EQ(suppressed.size(), 1u);
    EXPECT_EQ(suppressed[0].count, 15);
    EXPECT_EQ(total, 25);  // every event is still counted
    EXPECT_EQ(suppressed[0].channel, "system");
    EXPECT_EQ(suppressed[0].source, "system");
    EXPECT_EQ(suppressed[0].result, "ok");
    EXPECT_EQ(suppressed[0].tsMs, kT0 + 10000);  // the 11th event
    ASSERT_TRUE(suppressed[0].detail.has_value());
    EXPECT_EQ(nlohmann::json::parse(*suppressed[0].detail), nlohmann::json({{"auth.login", 15}}));
}

TEST(AuditLog, TheLimitSlidesAndSuppressionIsOneRowPerMinute) {
    Opened f;
    int n = 0;
    auto next = [&] { return failedLogin("u" + std::to_string(n++), "10.0.0.9:1"); };
    for (int i = 0; i < 12; ++i) f.log->append(next());  // t = 0: 10 rows, 2 suppressed
    f.advance(30000);
    for (int i = 0; i < 3; ++i) f.log->append(next());  // t = 30 s: the same audit.suppressed row
    AuditEvent denied(AuditAction::AccessDenied, AuditResult::Denied, AuditChannel::Http,
                      "10.0.0.10:2");
    denied.code = "HTTPS_REQUIRED";
    f.log->append(denied);  // suppressed too
    f.advance(30000);
    for (int i = 0; i < 12; ++i) f.log->append(next());  // t = 60 s: room for 10 rows again
    const AuditPage page = f.log->query({});
    int64_t loginRows = 0;
    std::vector<AuditRecord> suppressed;
    for (const auto& r : page.records) {
        if (r.action == "auth.login") ++loginRows;
        if (r.action == "audit.suppressed") suppressed.push_back(r);
    }
    EXPECT_EQ(loginRows, 20);
    ASSERT_EQ(suppressed.size(), 2u);  // newest first
    EXPECT_EQ(suppressed[1].count, 6);
    EXPECT_EQ(nlohmann::json::parse(suppressed[1].detail.value_or("null")),
              nlohmann::json({{"auth.login", 5}, {"access.denied", 1}}));
    EXPECT_EQ(suppressed[0].count, 2);
    EXPECT_EQ(suppressed[0].tsMs, kT0 + 60000);
}

TEST(AuditLog, ChangesAndSuccessfulSignInsAreNeverLimited) {
    Opened f;
    for (int i = 0; i < 20; ++i) f.log->append(failedLogin("u" + std::to_string(i), "10.0.0.9:1"));
    std::set<int64_t> ids;
    for (int i = 0; i < 30; ++i) {
        AuditEvent ok(AuditAction::AuthLogin, AuditResult::Ok, AuditChannel::Https, "10.0.0.8:2");
        ok.user = "eng1";
        ok.role = "engineer";
        ids.insert(f.log->append(ok));  // the same event 30 times: 30 rows
    }
    for (int i = 0; i < 3; ++i) {
        AuditEvent lockout(AuditAction::AuthLockout, AuditResult::Denied, AuditChannel::Https,
                           "10.0.0.8:3");
        lockout.user = "eng2";
        ids.insert(f.log->append(lockout));
    }
    ids.insert(f.log->append(deployStarted()));
    EXPECT_EQ(ids.size(), 34u);
    Db db(f.log->path());
    EXPECT_EQ(
        db.integer("SELECT count(*) FROM audit WHERE action = 'auth.login' AND result = 'ok'"), 30);
    EXPECT_EQ(db.integer("SELECT count(*) FROM audit WHERE action = 'auth.lockout'"), 3);
    EXPECT_EQ(db.integer("SELECT count(*) FROM audit WHERE action = 'project.deploy'"), 1);
}

TEST(AuditLog, CloseWritesTheCountsStillInMemory) {
    Fixture f;
    int64_t a = 0, b = 0;
    {
        AuditLog log(f.opts());
        std::string err;
        ASSERT_TRUE(log.open(err)) << err;
        a = log.append(failedLogin("admin", "10.0.0.5:1"));
        for (int i = 0; i < 6; ++i) log.append(failedLogin("admin", "10.0.0.5:1"));
        log.close();
        ASSERT_TRUE(log.open(err)) << err;  // the window does not survive close()
        f.advance(1000);
        b = log.append(failedLogin("admin", "10.0.0.5:1"));
        log.append(failedLogin("admin", "10.0.0.5:1"));
        log.append(failedLogin("admin", "10.0.0.5:1"));
    }  // the destructor closes
    EXPECT_NE(a, b);
    Db db(f.dir + "/audit.db");
    EXPECT_EQ(db.integer("SELECT count FROM audit WHERE id = " + std::to_string(a)), 7);
    EXPECT_EQ(db.integer("SELECT count FROM audit WHERE id = " + std::to_string(b)), 3);
}

TEST(AuditLog, ManyThreadsAppendAtOnce) {
    Opened f;
    std::atomic<int> errors{0};
    std::mutex mu;
    std::set<int64_t> ids;
    std::vector<std::thread> threads;
    for (int t = 0; t < 8; ++t)
        threads.emplace_back([&, t] {
            for (int i = 0; i < 20; ++i) {
                try {
                    AuditEvent e(AuditAction::ProjectRead, AuditResult::Ok, AuditChannel::Https,
                                 "10.0.1." + std::to_string(t) + ":1");
                    e.target = "sha256:" + std::to_string(i);
                    const int64_t id = f.log->append(e);
                    {
                        std::lock_guard<std::mutex> lk(mu);
                        ids.insert(id);
                    }
                    f.log->append(failedLogin("admin", "10.0.2.1:" + std::to_string(t)));
                } catch (const std::exception&) {
                    ++errors;
                }
            }
        });
    for (auto& t : threads) t.join();
    EXPECT_EQ(errors.load(), 0);
    EXPECT_EQ(ids.size(), 160u);
    f.log->query({});  // writes the count kept in memory
    Db db(f.log->path());
    EXPECT_EQ(db.integer("SELECT count(*) FROM audit WHERE action = 'project.read'"), 160);
    EXPECT_EQ(db.integer("SELECT count(*) FROM audit WHERE action = 'auth.login'"), 1);
    EXPECT_EQ(db.integer("SELECT sum(count) FROM audit WHERE action = 'auth.login'"), 160);
}

// ---- clock

TEST(AuditLog, ClockOkFollowsTheSyncCheck) {
    Opened f;
    f.synced = false;
    f.wall = kT0 + 5;
    const int64_t a = f.log->append(deployStarted());
    EXPECT_EQ(f.lastSyncArg, kT0 + 5);  // asked about the time of the event
    f.synced = true;
    const int64_t b = f.log->append(deployStarted());
    Db db(f.log->path());
    EXPECT_EQ(db.integer("SELECT clock_ok FROM audit WHERE id = " + std::to_string(a)), 0);
    EXPECT_EQ(db.integer("SELECT clock_ok FROM audit WHERE id = " + std::to_string(b)), 1);
    auto rows = byId(f.log->query({}));
    EXPECT_FALSE(rows[a].clockOk);
    EXPECT_TRUE(rows[b].clockOk);
}

TEST(AuditLog, DefaultSyncCheckNeedsTheTimesyncFlagAndATimeAfterTheBuild) {
    EXPECT_STREQ(kTimesyncFlag, "/run/systemd/timesync/synchronized");
    const std::string flag = tempDir() + "/synchronized";
    const int64_t valid = clockFloorMs() + 1000;
    EXPECT_FALSE(timesyncSynchronized(flag, valid));  // timesyncd has not synchronised yet
    { std::ofstream(flag) << ""; }
    EXPECT_TRUE(timesyncSynchronized(flag, valid));
    EXPECT_FALSE(timesyncSynchronized(flag, clockFloorMs() - 1));  // before the build: RTC lost
}

TEST(AuditLog, SystemClocksAreUsedWhenNoneIsInjected) {
    const AuditClock c = systemAuditClock();
    ASSERT_TRUE(c.wallMs && c.monoMs && c.synced);
    const int64_t m1 = c.monoMs();
    const int64_t m2 = c.monoMs();
    EXPECT_GE(m2, m1);
    EXPECT_GT(m1, 0);

    AuditOptions o;
    o.dataDir = tempDir();
    AuditLog log(o);
    std::string err;
    ASSERT_TRUE(log.open(err)) << err;
    using namespace std::chrono;
    const int64_t before =
        duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
    const int64_t id = log.append(deployStarted());
    const int64_t after =
        duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
    Db db(log.path());
    const int64_t ts = db.integer("SELECT ts_ms FROM audit WHERE id = " + std::to_string(id));
    EXPECT_GE(ts, before);
    EXPECT_LE(ts, after);
    EXPECT_EQ(db.integer("SELECT clock_ok FROM audit WHERE id = " + std::to_string(id)),
              timesyncSynchronized(kTimesyncFlag, ts) ? 1 : 0);
}

// ---- retention and size cap

TEST(AuditLog, RetentionDeletesExpiredRowsOnlyWithASynchronisedClock) {
    Opened f;  // 365 days
    std::vector<int64_t> ids;
    for (int d = 0; d <= 400; d += 10) {  // a row every 10 days for 400 days
        f.wall = kT0 + d * kDay;
        ids.push_back(f.log->append(deployStarted()));
    }
    const int64_t now = kT0 + 400 * kDay;  // cutoff: day 35
    f.synced = false;
    AuditMaintenance m = f.log->maintain(now);
    EXPECT_FALSE(m.retentionRan);
    EXPECT_EQ(m.expired, 0);
    Db db(f.log->path());
    EXPECT_EQ(db.integer("SELECT count(*) FROM audit"), 41);
    f.synced = true;
    m = f.log->maintain(now);
    EXPECT_TRUE(m.retentionRan);
    EXPECT_TRUE(m.error.empty()) << m.error;
    EXPECT_EQ(m.expired, 4);  // days 0, 10, 20, 30
    EXPECT_EQ(db.integer("SELECT count(*) FROM audit"), 37);
    EXPECT_EQ(db.integer("SELECT min(id) FROM audit"), ids[4]);
    EXPECT_EQ(f.log->maintain(now).expired, 0);
}

TEST(AuditLog, RetentionRunsAtOpen) {
    Fixture f;
    {
        AuditLog log(f.opts());
        std::string err;
        ASSERT_TRUE(log.open(err)) << err;
        log.append(deployStarted());  // day 0
        f.wall = kT0 + 300 * kDay;
        log.append(deployStarted());  // day 300
    }
    f.wall = kT0 + 400 * kDay;
    AuditLog log(f.opts());
    AuditMaintenance m;
    std::string err;
    ASSERT_TRUE(log.open(err, &m)) << err;
    EXPECT_TRUE(m.retentionRan);
    EXPECT_EQ(m.expired, 1);
    Db db(log.path());
    EXPECT_EQ(db.integer("SELECT count(*) FROM audit"), 1);
    EXPECT_EQ(db.integer("SELECT ts_ms FROM audit"), kT0 + 300 * kDay);
}

// A row written while the clock was wrong (clock_ok = 0, 1970 after the RTC was lost) is older
// than every row written after it: it goes with the first expired row that follows it, never
// earlier because of its wrong time.
TEST(AuditLog, RowsWithoutASynchronisedClockGoWithTheExpiredRowsAfterThem) {
    Opened f;
    f.synced = false;
    f.wall = 0;
    const int64_t lost1 = f.log->append(deployStarted());
    f.synced = true;
    f.wall = kT0;
    const int64_t day0 = f.log->append(deployStarted());
    f.synced = false;
    f.wall = 1000;
    const int64_t lost2 = f.log->append(deployStarted());
    f.synced = true;
    f.wall = kT0 + 100 * kDay;
    const int64_t day100 = f.log->append(deployStarted());
    const AuditMaintenance m = f.log->maintain(kT0 + 400 * kDay);  // cutoff: day 35
    EXPECT_EQ(m.expired, 2);
    EXPECT_EQ(idsOf(f.log->query({})), (std::vector<int64_t>{day100, lost2}));
    (void)lost1;
    (void)day0;
}

TEST(AuditLog, SizeCapDeletesTheOldestTenPercentWithAnAuditPurgedRow) {
    const int64_t cap = 256 * 1024;
    Opened f(cap);
    {
        Db db(f.log->path());  // ~400 KiB of rows quickly, in one transaction
        ASSERT_EQ(db.exec("BEGIN"), SQLITE_OK);
        for (int i = 0; i < 1000; ++i)
            ASSERT_EQ(db.exec("INSERT INTO audit(ts_ms, clock_ok, source, channel, action, result, "
                              "detail, count) VALUES(" +
                              std::to_string(kT0 + i) +
                              ", 1, 'system', 'system', 'project.read', 'ok', '{\"pad\":\"" +
                              std::string(300, 'x') + "\"}', 1)"),
                      SQLITE_OK);
        ASSERT_EQ(db.exec("COMMIT"), SQLITE_OK);
    }
    ASSERT_GT(usedBytes(*f.log), cap);
    f.synced = false;  // the cap does not depend on the clock
    const AuditMaintenance m = f.log->maintain(f.wall);
    EXPECT_TRUE(m.error.empty()) << m.error;
    EXPECT_GT(m.purged, 0);
    EXPECT_LE(usedBytes(*f.log), cap);
    Db db(f.log->path());
    // the oldest rows went: what is left is the newest, without a gap
    EXPECT_EQ(db.integer("SELECT min(id) FROM audit WHERE action = 'project.read'"), m.purged + 1);
    EXPECT_EQ(db.integer("SELECT count(*) FROM audit WHERE action = 'project.read'"),
              1000 - m.purged);
    // one audit.purged row per step of 10 %, together counting every deleted row
    const auto purged = db.rows(
        "SELECT detail, channel, source, result FROM audit WHERE action = "
        "'audit.purged' ORDER BY id");
    ASSERT_FALSE(purged.empty());
    int64_t sum = 0;
    int64_t firstStep = 0;
    for (const auto& r : purged) {
        const auto d = nlohmann::json::parse(r[0]);
        sum += d.at("rows").get<int64_t>();
        if (firstStep == 0) firstStep = d.at("rows").get<int64_t>();
        EXPECT_EQ(r[1], "system");
        EXPECT_EQ(r[2], "system");
        EXPECT_EQ(r[3], "ok");
    }
    EXPECT_EQ(sum, m.purged);
    EXPECT_EQ(firstStep, 100);                     // 10 % of 1000 rows
    EXPECT_EQ(f.log->maintain(f.wall).purged, 0);  // under the cap now
}

// ---- detail

TEST(AuditLog, DetailIsStoredAsACompactJsonObject) {
    Opened f;
    AuditEvent e = deployStarted();
    e.detail = "{ \"opId\" : \"op-7\",\n  \"seq\": 6 }";
    const int64_t id = f.log->append(e);
    Db db(f.log->path());
    const std::string stored = db.text("SELECT detail FROM audit WHERE id = " + std::to_string(id));
    EXPECT_EQ(nlohmann::json::parse(stored), nlohmann::json({{"opId", "op-7"}, {"seq", 6}}));
    EXPECT_EQ(stored.find_first_of(" \n"), std::string::npos);
}

TEST(AuditLog, DetailAbove1KiBIsCutButStaysAJsonObject) {
    Opened f;
    Db db(f.log->path());
    const std::string digest = "sha256:" + std::string(64, 'a');
    AuditEvent e(AuditAction::ProjectDeploy, AuditResult::Failed, AuditChannel::Https,
                 "10.0.0.2:1");
    e.detail = jsonText({{"opId", "op-9"},
                         {"from", digest},
                         {"message", std::string(3000, 'm')},
                         {"path", "screens/" + std::string(500, 'p')}});
    int64_t id = f.log->append(e);
    std::string stored = db.text("SELECT detail FROM audit WHERE id = " + std::to_string(id));
    EXPECT_LE(stored.size(), kAuditMaxDetailBytes);
    nlohmann::json j = nlohmann::json::parse(stored);  // still JSON
    ASSERT_TRUE(j.is_object());
    EXPECT_EQ(j.value("truncated", false), true);
    EXPECT_EQ(j.value("opId", ""), "op-9");  // short values stay whole
    EXPECT_EQ(j.value("from", ""), digest);
    EXPECT_EQ(j.value("message", "").rfind("mmmm", 0), 0u);  // cut, not dropped
    EXPECT_EQ(j.value("path", "").rfind("screens/", 0), 0u);

    // a character of several bytes is never split
    std::string vi;
    for (int i = 0; i < 600; ++i) vi += "\xE1\xBB\x87";  // "ệ"
    e.detail = jsonText({{"message", vi}});
    id = f.log->append(e);
    stored = db.text("SELECT detail FROM audit WHERE id = " + std::to_string(id));
    EXPECT_LE(stored.size(), kAuditMaxDetailBytes);
    j = nlohmann::json::parse(stored);  // the parser rejects broken UTF-8
    EXPECT_TRUE(isValidUtf8(j.value("message", "")));

    // exactly 1 KiB is kept as it is
    e.detail = "{\"a\":\"" + std::string(1016, 'x') + "\"}";
    ASSERT_EQ(e.detail.size(), kAuditMaxDetailBytes);
    id = f.log->append(e);
    EXPECT_EQ(db.text("SELECT detail FROM audit WHERE id = " + std::to_string(id)), e.detail);
}

// detail is built by the caller: anything but a JSON object, or a key that looks like a secret,
// is a programming error and nothing is written.
TEST(AuditLog, DetailMustBeAJsonObjectWithoutSecrets) {
    Opened f;
    for (const char* bad : {"not json", "[1,2]", "\"text\"", "42", "null", "{\"a\":1"}) {
        AuditEvent e = deployStarted();
        e.detail = bad;
        EXPECT_THROW(f.log->append(e), std::invalid_argument) << bad;
    }
    for (const char* secret :
         {R"({"password":"x"})", R"({"newPassword":"x"})", R"({"token":"mats_x"})",
          R"({"passwordHash":"$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA"})",
          R"({"opId":"1","inner":{"Secret":"s"}})", R"({"list":[{"tokenHash":"t"}]})"}) {
        AuditEvent e = deployStarted();
        e.detail = secret;
        EXPECT_THROW(f.log->append(e), std::invalid_argument) << secret;
    }
    Db db(f.log->path());
    EXPECT_EQ(db.integer("SELECT count(*) FROM audit"), 0);
}

// Names typed at a failed sign-in come from the network: stored as valid UTF-8, bounded.
TEST(AuditLog, TextFieldsAreValidUtf8AndBounded) {
    Opened f;
    const int64_t a = f.log->append(failedLogin(std::string("ad\xFFmin"), "10.0.0.5:1"));
    AuditEvent longOne = failedLogin(std::string(300, 'u'), "10.0.0.6:1");
    longOne.target = "/api/v1/" + std::string(1000, 't');
    longOne.code = std::string(200, 'C');
    const int64_t b = f.log->append(longOne);
    std::string vi;
    for (int i = 0; i < 40; ++i) vi += "\xE1\xBB\x87";  // 120 bytes
    const int64_t c = f.log->append(failedLogin(vi, "10.0.0.7:1"));
    auto rows = byId(f.log->query({}));
    EXPECT_EQ(rows[a].user, std::optional<std::string>("ad\xEF\xBF\xBDmin"));  // U+FFFD
    EXPECT_EQ(rows[b].user.value_or("").size(), 64u);
    EXPECT_EQ(rows[b].target.value_or("").size(), 256u);
    EXPECT_EQ(rows[b].code.value_or("").size(), 64u);
    const std::string cut = rows[c].user.value_or("");
    EXPECT_LE(cut.size(), 64u);
    EXPECT_GE(cut.size(), 61u);
    EXPECT_TRUE(isValidUtf8(cut));
}

// ---- query (contracts/device-api.md §7)

TEST(AuditLog, QueryReturnsNewestFirstAndFilters) {
    Opened f;
    auto event = [&](AuditAction a, AuditResult r, const char* user, const char* role) {
        AuditEvent e(a, r, AuditChannel::Https, "192.168.1.30:40000");
        e.user = user;
        e.role = role;
        const int64_t id = f.log->append(e);
        f.advance(kMinute);
        return id;
    };
    const int64_t a = event(AuditAction::AuthLogin, AuditResult::Ok, "eng1", "engineer");
    const int64_t b = event(AuditAction::ProjectDeploy, AuditResult::Started, "eng1", "engineer");
    const int64_t c = event(AuditAction::ProjectDeploy, AuditResult::Ok, "eng1", "engineer");
    const int64_t d = event(AuditAction::AuthLogin, AuditResult::Ok, "admin", "administrator");
    const int64_t e = event(AuditAction::AuditRead, AuditResult::Ok, "admin", "administrator");
    const int64_t g =
        event(AuditAction::ProjectRestore, AuditResult::Started, "admin", "administrator");

    AuditPage page = f.log->query({});
    EXPECT_EQ(idsOf(page), (std::vector<int64_t>{g, e, d, c, b, a}));
    EXPECT_FALSE(page.next.has_value());
    ASSERT_FALSE(page.records.empty());
    const AuditRecord& top = page.records[0];
    EXPECT_EQ(top.tsMs, kT0 + 5 * kMinute);
    EXPECT_TRUE(top.clockOk);
    EXPECT_EQ(top.user, std::optional<std::string>("admin"));
    EXPECT_EQ(top.role, std::optional<std::string>("administrator"));
    EXPECT_EQ(top.source, "192.168.1.30:40000");
    EXPECT_EQ(top.channel, "https");
    EXPECT_EQ(top.action, "project.restore");
    EXPECT_EQ(top.result, "started");
    EXPECT_FALSE(top.target.has_value());
    EXPECT_FALSE(top.code.has_value());
    EXPECT_FALSE(top.detail.has_value());
    EXPECT_EQ(top.count, 1);

    AuditQuery q;
    q.user = "eng1";
    EXPECT_EQ(idsOf(f.log->query(q)), (std::vector<int64_t>{c, b, a}));
    q.user = "eng";  // exact name, not a prefix
    EXPECT_TRUE(f.log->query(q).records.empty());

    q = AuditQuery{};
    q.actionPrefix = "project.";
    EXPECT_EQ(idsOf(f.log->query(q)), (std::vector<int64_t>{g, c, b}));
    q.actionPrefix = "project.deploy";
    EXPECT_EQ(idsOf(f.log->query(q)), (std::vector<int64_t>{c, b}));
    q.actionPrefix = "auth";
    EXPECT_EQ(idsOf(f.log->query(q)), (std::vector<int64_t>{d, a}));
    q.actionPrefix = "auth%";  // no wildcard
    EXPECT_TRUE(f.log->query(q).records.empty());

    q = AuditQuery{};
    q.fromMs = kT0 + kMinute;
    q.toMs = kT0 + 3 * kMinute;  // [from, to)
    EXPECT_EQ(idsOf(f.log->query(q)), (std::vector<int64_t>{c, b}));

    q = AuditQuery{};
    q.user = "admin";
    q.actionPrefix = "project.";
    EXPECT_EQ(idsOf(f.log->query(q)), (std::vector<int64_t>{g}));
}

TEST(AuditLog, QueryPagesByIdAndClampsTheLimit) {
    Opened f;
    {
        Db db(f.log->path());
        ASSERT_EQ(db.exec("BEGIN"), SQLITE_OK);
        for (int i = 1; i <= 250; ++i)
            ASSERT_EQ(db.exec("INSERT INTO audit(id, ts_ms, clock_ok, source, channel, action, "
                              "result, count) VALUES(" +
                              std::to_string(i) + ", " + std::to_string(kT0 + i) +
                              ", 1, 'system', 'system', 'project.read', 'ok', 1)"),
                      SQLITE_OK);
        ASSERT_EQ(db.exec("COMMIT"), SQLITE_OK);
    }
    AuditQuery q;
    AuditPage p = f.log->query(q);  // default 100
    ASSERT_EQ(p.records.size(), 100u);
    EXPECT_EQ(p.records.front().id, 250);
    EXPECT_EQ(p.records.back().id, 151);
    EXPECT_EQ(p.next, std::optional<int64_t>(151));
    q.beforeId = p.next;
    p = f.log->query(q);
    ASSERT_EQ(p.records.size(), 100u);
    EXPECT_EQ(p.records.front().id, 150);
    EXPECT_EQ(p.next, std::optional<int64_t>(51));
    q.beforeId = p.next;
    p = f.log->query(q);
    ASSERT_EQ(p.records.size(), 50u);
    EXPECT_EQ(p.records.back().id, 1);
    EXPECT_FALSE(p.next.has_value());

    q.beforeId = 101;  // exactly a page left
    p = f.log->query(q);
    EXPECT_EQ(p.records.size(), 100u);
    EXPECT_FALSE(p.next.has_value());

    q = AuditQuery{};
    q.limit = 500;
    p = f.log->query(q);
    EXPECT_EQ(p.records.size(), 200u);
    EXPECT_EQ(p.next, std::optional<int64_t>(51));
    q.limit = 0;
    EXPECT_EQ(f.log->query(q).records.size(), 1u);
    q.limit = -5;
    EXPECT_EQ(f.log->query(q).records.size(), 1u);
}

// T146 (--export-audit): oldest first, from an id, the same filters; paged by `next` = the id to
// pass as afterId.
TEST(AuditLog, QueryAscendingReadsOldestFirstFromAnIdAndPagesByNext) {
    Opened f;
    {
        Db db(f.log->path());
        ASSERT_EQ(db.exec("BEGIN"), SQLITE_OK);
        for (int i = 1; i <= 250; ++i)
            ASSERT_EQ(
                db.exec("INSERT INTO audit(id, ts_ms, user, clock_ok, source, channel, action, "
                        "result, count) VALUES(" +
                        std::to_string(i) + ", " + std::to_string(kT0 + i) + ", '" +
                        (i % 2 ? "eng1" : "admin") + "', 1, 'system', 'system', '" +
                        (i % 5 == 0 ? "project.deploy" : "auth.login") + "', 'ok', 1)"),
                SQLITE_OK);
        ASSERT_EQ(db.exec("COMMIT"), SQLITE_OK);
    }
    AuditQuery q;
    AuditPage p = f.log->queryAscending(q, 0);  // default page: 100, oldest first
    ASSERT_EQ(p.records.size(), 100u);
    EXPECT_EQ(p.records.front().id, 1);
    EXPECT_EQ(p.records.back().id, 100);
    EXPECT_EQ(p.next, std::optional<int64_t>(100));
    p = f.log->queryAscending(q, *p.next);
    ASSERT_EQ(p.records.size(), 100u);
    EXPECT_EQ(p.records.front().id, 101);
    EXPECT_EQ(p.next, std::optional<int64_t>(200));
    p = f.log->queryAscending(q, *p.next);
    ASSERT_EQ(p.records.size(), 50u);
    EXPECT_EQ(p.records.back().id, 250);
    EXPECT_FALSE(p.next.has_value());
    EXPECT_TRUE(f.log->queryAscending(q, 250).records.empty());

    q.limit = 500;  // clamped to 200
    EXPECT_EQ(f.log->queryAscending(q, 0).records.size(), 200u);
    q.limit = 0;
    EXPECT_EQ(f.log->queryAscending(q, 0).records.size(), 1u);

    q = AuditQuery{};
    q.user = "admin";
    q.actionPrefix = "project.";
    q.fromMs = kT0 + 10;
    q.toMs = kT0 + 100;
    p = f.log->queryAscending(q, 0);
    std::vector<int64_t> ids;
    for (const auto& r : p.records) ids.push_back(r.id);
    EXPECT_EQ(ids, (std::vector<int64_t>{10, 20, 30, 40, 50, 60, 70, 80, 90}));
}

// ---- measurement (not part of the suite): x64 numbers for T025; the BL335 eMMC is measured at
// T158–T165. Run: audit_log_test --gtest_also_run_disabled_tests --gtest_filter='AuditLogBench.*'

TEST(AuditLogBench, DISABLED_AppendLatencyAndFileSize) {
    Fixture f;
    AuditLog log(f.opts());
    std::string err;
    ASSERT_TRUE(log.open(err)) << err;
    auto event = [&](int i) {
        AuditEvent e(AuditAction::ProjectDeploy, AuditResult::Started, AuditChannel::Https,
                     "192.168.1.20:" + std::to_string(40000 + i % 20000));
        e.user = "eng" + std::to_string(i % 5);
        e.role = "engineer";
        e.target = "sha256:" + std::string(64, 'c');
        e.detail = jsonText({{"opId", "op-" + std::to_string(i)},
                             {"from", "sha256:" + std::string(64, 'a')},
                             {"to", "sha256:" + std::string(64, 'b')}});
        return e;
    };
    auto run = [&](int n, int& next, const char* label) {
        std::vector<double> us;
        for (int i = 0; i < n; ++i) {
            const auto t0 = std::chrono::steady_clock::now();
            log.append(event(next++));
            const auto t1 = std::chrono::steady_clock::now();
            us.push_back(std::chrono::duration<double, std::micro>(t1 - t0).count());
            f.advance(1);
        }
        std::sort(us.begin(), us.end());
        std::printf("%s: n=%d median=%.0f us p95=%.0f us max=%.0f us\n", label, n,
                    us[us.size() / 2], us[us.size() * 95 / 100], us.back());
    };
    int next = 0;
    ASSERT_TRUE(log.execForTest("PRAGMA wal_autocheckpoint=0", err)) << err;  // WAL bytes per row
    run(500, next, "FULL");
    const unsigned long walAfterFull = static_cast<unsigned long>([&] {
        struct stat st {};
        return ::stat((log.path() + "-wal").c_str(), &st) == 0 ? st.st_size : 0;
    }());
    std::printf("WAL after 500 FULL appends: %lu bytes (%.0f per append, page %lld)\n",
                walAfterFull, walAfterFull / 500.0,
                static_cast<long long>(log.pragmaInt("page_size")));
    ASSERT_TRUE(log.execForTest("PRAGMA wal_autocheckpoint=1000", err)) << err;
    ASSERT_TRUE(log.execForTest("PRAGMA wal_checkpoint(TRUNCATE)", err)) << err;
    ASSERT_TRUE(log.execForTest("PRAGMA synchronous=NORMAL", err)) << err;  // comparison only
    run(500, next, "NORMAL");
    ASSERT_TRUE(log.execForTest("PRAGMA synchronous=FULL", err)) << err;
    run(1000, next, "FULL");
    ASSERT_TRUE(log.execForTest("PRAGMA wal_checkpoint(TRUNCATE)", err)) << err;
    struct stat st {};
    ::stat(log.path().c_str(), &st);
    std::printf("%d rows: audit.db %lld bytes, used %lld bytes, %.0f bytes per row\n", next,
                static_cast<long long>(st.st_size), static_cast<long long>(usedBytes(log)),
                static_cast<double>(usedBytes(log)) / next);
}
