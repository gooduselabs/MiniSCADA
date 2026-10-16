// SQLite VFS that counts bytes written per database file (ADR-039).
#include "core/historian/write_counter_vfs.hpp"

#include <gtest/gtest.h>
#include <sqlite3.h>
#include <unistd.h>

#include <cstdio>
#include <string>

using namespace mat;

namespace {
std::string tmpDir() {
    char t[] = "/tmp/mat_wcvfs_XXXXXX";
    return mkdtemp(t);
}

int64_t bytesOf(const std::string& db) {
    for (const auto& e : dbWriteBytes())
        if (e.db == db) return e.bytes;
    return -1;
}

int64_t fileSize(const std::string& p) {
    std::FILE* f = std::fopen(p.c_str(), "rb");
    if (!f) return 0;
    std::fseek(f, 0, SEEK_END);
    const long n = std::ftell(f);
    std::fclose(f);
    return n;
}
}  // namespace

TEST(WriteCounterVfs, RegistersOnceAndGivesAName) {
    ASSERT_TRUE(registerCountingVfs());
    ASSERT_TRUE(registerCountingVfs());
    ASSERT_NE(countingVfsName(), nullptr);
    EXPECT_STREQ(countingVfsName(), kCountingVfsName);
    EXPECT_NE(sqlite3_vfs_find(kCountingVfsName), nullptr);
    EXPECT_NE(sqlite3_vfs_find(nullptr), sqlite3_vfs_find(kCountingVfsName));  // not the default
}

TEST(WriteCounterVfs, RollbackJournalDbCountsAtLeastThePagesItWrote) {
    ASSERT_TRUE(registerCountingVfs());
    const std::string dir = tmpDir();
    const std::string path = dir + "/cnt_a.db";
    resetDbWriteBytesForTest("cnt_a.db");
    sqlite3* db = nullptr;
    ASSERT_EQ(sqlite3_open_v2(path.c_str(), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
                              countingVfsName()),
              SQLITE_OK);
    ASSERT_EQ(sqlite3_exec(db, "CREATE TABLE t(a INTEGER, b BLOB);", 0, 0, 0), SQLITE_OK);
    for (int i = 0; i < 50; ++i)
        ASSERT_EQ(sqlite3_exec(db, "INSERT INTO t VALUES(1, zeroblob(2000));", 0, 0, 0), SQLITE_OK);
    sqlite3_close(db);
    const int64_t n = bytesOf("cnt_a.db");
    EXPECT_GE(n, fileSize(path));        // at least the file that came out
    EXPECT_GE(n, 50 * 2000);             // and no less than the payload
    EXPECT_LT(n, 50 * 2000 * 40);        // not wildly more (journal + db pages, a few times)
    ::unlink(path.c_str());
    ::rmdir(dir.c_str());
}

TEST(WriteCounterVfs, WalAndMainFileCountUnderOneDatabaseName) {
    ASSERT_TRUE(registerCountingVfs());
    const std::string dir = tmpDir();
    const std::string path = dir + "/cnt_b.db";
    resetDbWriteBytesForTest("cnt_b.db");
    sqlite3* db = nullptr;
    ASSERT_EQ(sqlite3_open_v2(path.c_str(), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
                              countingVfsName()),
              SQLITE_OK);
    ASSERT_EQ(sqlite3_exec(db, "PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL;", 0, 0, 0),
              SQLITE_OK);
    ASSERT_EQ(sqlite3_exec(db, "CREATE TABLE t(b BLOB);", 0, 0, 0), SQLITE_OK);
    const int64_t before = bytesOf("cnt_b.db");
    for (int i = 0; i < 20; ++i)
        ASSERT_EQ(sqlite3_exec(db, "INSERT INTO t VALUES(zeroblob(1000));", 0, 0, 0), SQLITE_OK);
    const int64_t afterWal = bytesOf("cnt_b.db");
    // 20 commits: each puts at least one 4 KiB page frame (+ 24 B header) in the -wal
    EXPECT_GE(afterWal - before, 20 * 4096);
    EXPECT_EQ(bytesOf("cnt_b.db-wal"), -1);  // no separate entry for the -wal
    int logFrames = 0, ckpt = 0;
    ASSERT_EQ(sqlite3_wal_checkpoint_v2(db, nullptr, SQLITE_CHECKPOINT_TRUNCATE, &logFrames, &ckpt),
              SQLITE_OK);
    EXPECT_GT(bytesOf("cnt_b.db"), afterWal);  // the checkpoint writes the main file
    sqlite3_close(db);
    ::unlink((path + "-wal").c_str());
    ::unlink((path + "-shm").c_str());
    ::unlink(path.c_str());
    ::rmdir(dir.c_str());
}

TEST(WriteCounterVfs, ReadsAndRereadsAddNothing) {
    ASSERT_TRUE(registerCountingVfs());
    const std::string dir = tmpDir();
    const std::string path = dir + "/cnt_c.db";
    resetDbWriteBytesForTest("cnt_c.db");
    sqlite3* db = nullptr;
    ASSERT_EQ(sqlite3_open_v2(path.c_str(), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
                              countingVfsName()),
              SQLITE_OK);
    ASSERT_EQ(sqlite3_exec(db, "CREATE TABLE t(a);INSERT INTO t VALUES(1);", 0, 0, 0), SQLITE_OK);
    const int64_t before = bytesOf("cnt_c.db");
    for (int i = 0; i < 10; ++i)
        ASSERT_EQ(sqlite3_exec(db, "SELECT * FROM t;", 0, 0, 0), SQLITE_OK);
    EXPECT_EQ(bytesOf("cnt_c.db"), before);
    sqlite3_close(db);
    ::unlink(path.c_str());
    ::rmdir(dir.c_str());
}

TEST(WriteCounterVfs, TotalIsTheSumOfTheDatabases) {
    ASSERT_TRUE(registerCountingVfs());
    int64_t sum = 0;
    for (const auto& e : dbWriteBytes()) sum += e.bytes;
    EXPECT_EQ(totalDbWriteBytes(), sum);
}

TEST(WriteCounterVfs, ADatabaseOpenedWithoutTheShimIsNotCounted) {
    ASSERT_TRUE(registerCountingVfs());
    const std::string dir = tmpDir();
    const std::string path = dir + "/cnt_d.db";
    sqlite3* db = nullptr;
    ASSERT_EQ(sqlite3_open_v2(path.c_str(), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
                              nullptr),
              SQLITE_OK);
    ASSERT_EQ(sqlite3_exec(db, "CREATE TABLE t(a);INSERT INTO t VALUES(1);", 0, 0, 0), SQLITE_OK);
    sqlite3_close(db);
    EXPECT_EQ(bytesOf("cnt_d.db"), -1);
    ::unlink(path.c_str());
    ::rmdir(dir.c_str());
}
