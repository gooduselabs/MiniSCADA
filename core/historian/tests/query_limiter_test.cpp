// Load limits and the connection pool of the history API (specs/010-history-reports
// contracts/history-api.md §1.2, §7; FR-028, FR-029).
#include "core/historian/query/query_limiter.hpp"

#include <gtest/gtest.h>
#include <unistd.h>

#include <atomic>

#include "core/historian/query/reader_pool.hpp"
#include "sqlite3.h"

using namespace mat;

TEST(QueryLimiter, AtMostTwoQueriesAtOnce) {
    QueryLimiter l(2);
    auto a = l.tryAcquire(QueryLimiter::Kind::Query, "s1");
    auto b = l.tryAcquire(QueryLimiter::Kind::Query, "s2");
    auto c = l.tryAcquire(QueryLimiter::Kind::Query, "s3");
    EXPECT_TRUE(a.has_value());
    EXPECT_TRUE(b.has_value());
    EXPECT_FALSE(c.has_value());
    EXPECT_EQ(l.stats().rejectedBusy, 1u);
    EXPECT_EQ(l.stats().inFlight, 2);
    a.reset();  // the slot is back
    EXPECT_TRUE(l.tryAcquire(QueryLimiter::Kind::Query, "s3").has_value());
}

TEST(QueryLimiter, OneRequestPerSession) {
    QueryLimiter l(4);
    auto a = l.tryAcquire(QueryLimiter::Kind::Query, "s1");
    EXPECT_TRUE(a.has_value());
    EXPECT_FALSE(l.tryAcquire(QueryLimiter::Kind::Query, "s1").has_value());
    EXPECT_FALSE(l.tryAcquire(QueryLimiter::Kind::Export, "s1").has_value());  // any kind
    EXPECT_TRUE(l.tryAcquire(QueryLimiter::Kind::Query, "s2").has_value());
    a.reset();
    EXPECT_TRUE(l.tryAcquire(QueryLimiter::Kind::Query, "s1").has_value());
}

TEST(QueryLimiter, ExportsAreCountedApartAndOnlyOne) {
    QueryLimiter l(1);
    auto q = l.tryAcquire(QueryLimiter::Kind::Query, "s1");
    auto e = l.tryAcquire(QueryLimiter::Kind::Export, "s2");
    EXPECT_TRUE(q.has_value());
    EXPECT_TRUE(e.has_value());  // not blocked by the query slot
    EXPECT_FALSE(l.tryAcquire(QueryLimiter::Kind::Export, "s3").has_value());
    EXPECT_FALSE(l.tryAcquire(QueryLimiter::Kind::Query, "s4").has_value());
}

TEST(QueryLimiter, TheSlotIsGivenBackWhenAnExceptionUnwinds) {
    QueryLimiter l(1);
    try {
        auto t = l.tryAcquire(QueryLimiter::Kind::Query, "s1");
        ASSERT_TRUE(t.has_value());
        throw std::runtime_error("query failed");
    } catch (const std::exception&) {
    }
    EXPECT_EQ(l.stats().inFlight, 0);
    EXPECT_TRUE(l.tryAcquire(QueryLimiter::Kind::Query, "s1").has_value());
}

TEST(QueryLimiter, CountersAndP95OfTheLast256) {
    QueryLimiter l(2);
    for (int i = 1; i <= 100; ++i) l.recordServed(i);
    auto s = l.stats();
    EXPECT_EQ(s.served, 100u);
    EXPECT_GE(s.p95Ms, 95);
    EXPECT_LE(s.p95Ms, 96);
    for (int i = 0; i < 256; ++i) l.recordServed(7);  // the ring forgets the first 100
    EXPECT_EQ(l.stats().p95Ms, 7);
    l.recordRejectedLimit();
    l.recordTimeout(1234);
    l.recordError("HISTORY_UNAVAILABLE", 5678);
    s = l.stats();
    EXPECT_EQ(s.rejectedLimit, 1u);
    EXPECT_EQ(s.timeouts, 1u);
    EXPECT_EQ(s.errors, 1u);
    EXPECT_EQ(s.lastErrorCode, "HISTORY_UNAVAILABLE");
    EXPECT_EQ(s.lastErrorAt, 5678);
}

// ---------------------------------------------------------------------------------------------

namespace {
std::string makeDb() {
    char tmpl[] = "/tmp/mat-pool-XXXXXX";
    const std::string dir = mkdtemp(tmpl);
    const std::string path = dir + "/history.db";
    sqlite3* db = nullptr;
    sqlite3_open(path.c_str(), &db);
    sqlite3_exec(db,
                 "PRAGMA journal_mode=WAL;CREATE TABLE mat_meta(key TEXT, value TEXT);"
                 "INSERT INTO mat_meta VALUES('instance_id','x');",
                 nullptr, nullptr, nullptr);
    sqlite3_close(db);
    return path;
}

// A statement that runs long enough for the progress handler (a million steps).
const char* kLong =
    "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 3000000) SELECT "
    "count(*) FROM c";
}  // namespace

TEST(ReaderPool, ConnectionsAreMadeOnFirstUseAndClosedWhenIdle) {
    int64_t now = 1000;
    ReaderPool::Options o;
    o.dbPath = makeDb();
    o.idleCloseMs = 60000;
    o.nowMono = [&] { return now; };
    ReaderPool p(o);
    EXPECT_EQ(p.openConnections(), 0);  // lazy
    std::string err;
    {
        auto lease = p.acquire(0, nullptr, err);
        ASSERT_TRUE(lease) << err;
        EXPECT_EQ(p.openConnections(), 1);
    }
    now += 59000;
    p.closeIdle();
    EXPECT_EQ(p.openConnections(), 1);  // idle for less than 60 s
    now += 2000;
    p.closeIdle();
    EXPECT_EQ(p.openConnections(), 0);
}

TEST(ReaderPool, AtMostThreeConnections) {
    ReaderPool::Options o;
    o.dbPath = makeDb();
    ReaderPool p(o);
    std::string err;
    auto a = p.acquire(0, nullptr, err);
    auto b = p.acquire(0, nullptr, err);
    auto c = p.acquire(0, nullptr, err);
    ASSERT_TRUE(a && b && c);
    auto d = p.acquire(0, nullptr, err);
    EXPECT_FALSE(d);
    EXPECT_EQ(err, "busy");
    c.reset();
    EXPECT_TRUE(p.acquire(0, nullptr, err));
}

TEST(ReaderPool, ConnectionsAreReadOnlyWithASmallCache) {
    ReaderPool::Options o;
    o.dbPath = makeDb();
    o.cacheKiB = 4096;
    ReaderPool p(o);
    std::string err;
    auto lease = p.acquire(0, nullptr, err);
    ASSERT_TRUE(lease);
    char* msg = nullptr;
    EXPECT_NE(
        sqlite3_exec(lease->db(), "INSERT INTO mat_meta VALUES('a','b')", nullptr, nullptr, &msg),
        SQLITE_OK);  // a write is an error
    sqlite3_free(msg);
    sqlite3_stmt* st = nullptr;
    sqlite3_prepare_v2(lease->db(), "PRAGMA cache_size", -1, &st, nullptr);
    ASSERT_EQ(sqlite3_step(st), SQLITE_ROW);
    EXPECT_EQ(sqlite3_column_int(st, 0), -4096);
    sqlite3_finalize(st);
    sqlite3_prepare_v2(lease->db(), "PRAGMA query_only", -1, &st, nullptr);
    sqlite3_step(st);
    EXPECT_EQ(sqlite3_column_int(st, 0), 1);
    sqlite3_finalize(st);
    sqlite3_prepare_v2(lease->db(), "PRAGMA mmap_size", -1, &st, nullptr);
    sqlite3_step(st);
    EXPECT_EQ(sqlite3_column_int(st, 0), 0);
    sqlite3_finalize(st);
}

TEST(ReaderPool, ADeadlineStopsALongStatement) {
    int64_t now = 5000;
    ReaderPool::Options o;
    o.dbPath = makeDb();
    o.nowMono = [&] { return now; };
    ReaderPool p(o);
    std::string err;
    auto lease = p.acquire(now + 100, nullptr, err);  // 100 ms
    ASSERT_TRUE(lease);
    now += 200;  // the clock has passed it
    char* msg = nullptr;
    EXPECT_EQ(sqlite3_exec(lease->db(), kLong, nullptr, nullptr, &msg), SQLITE_INTERRUPT);
    sqlite3_free(msg);
    EXPECT_TRUE(lease->timedOut());
    EXPECT_FALSE(lease->cancelled());
}

TEST(ReaderPool, TheCancelFlagStopsALongStatement) {
    std::atomic<bool> cancel{false};
    ReaderPool::Options o;
    o.dbPath = makeDb();
    ReaderPool p(o);
    std::string err;
    auto lease = p.acquire(0, &cancel, err);
    ASSERT_TRUE(lease);
    cancel = true;  // the browser closed the connection
    char* msg = nullptr;
    EXPECT_EQ(sqlite3_exec(lease->db(), kLong, nullptr, nullptr, &msg), SQLITE_INTERRUPT);
    sqlite3_free(msg);
    EXPECT_TRUE(lease->cancelled());
}

TEST(ReaderPool, AReaderDoesNotBlockTheWriter) {
    const std::string path = makeDb();
    ReaderPool::Options o;
    o.dbPath = path;
    ReaderPool p(o);
    std::string err;
    auto lease = p.acquire(0, nullptr, err);
    ASSERT_TRUE(lease);
    sqlite3_stmt* st = nullptr;
    sqlite3_prepare_v2(lease->db(), "SELECT * FROM mat_meta", -1, &st, nullptr);
    ASSERT_EQ(sqlite3_step(st), SQLITE_ROW);  // a read transaction is open
    sqlite3* w = nullptr;
    ASSERT_EQ(sqlite3_open(path.c_str(), &w), SQLITE_OK);
    sqlite3_busy_timeout(w, 100);
    EXPECT_EQ(sqlite3_exec(w, "INSERT INTO mat_meta VALUES('k','v')", nullptr, nullptr, nullptr),
              SQLITE_OK);  // WAL: the writer goes on
    sqlite3_close(w);
    sqlite3_finalize(st);
}

TEST(ReaderPool, AMissingFileIsAnErrorNotACrash) {
    ReaderPool::Options o;
    o.dbPath = "/nonexistent/history.db";
    ReaderPool p(o);
    std::string err;
    EXPECT_FALSE(p.acquire(0, nullptr, err));
    EXPECT_EQ(err, "open");
}
