// SQLite durability calls (specs/006-tags-modbus T007, research R15, ADR-017 point 5): with
// HAVE_FDATASYNC=1 every sync of a WAL database at synchronous=FULL is fdatasync(), never fsync().
// The test binary links with -Wl,--wrap=fsync,--wrap=fdatasync and counts the calls.
#include <gtest/gtest.h>
#include <unistd.h>

#include <atomic>
#include <cstdlib>
#include <string>

#include "sqlite3.h"

namespace {
std::atomic<int> gFsync{0};
std::atomic<int> gFdatasync{0};
}  // namespace

extern "C" {
int __real_fsync(int fd);
int __real_fdatasync(int fd);
int __wrap_fsync(int fd) {
    ++gFsync;
    return __real_fsync(fd);
}
int __wrap_fdatasync(int fd) {
    ++gFdatasync;
    return __real_fdatasync(fd);
}
}

TEST(SqliteSync, WalFullUsesFdatasyncOnly) {
    char tmpl[] = "/tmp/mat-sqsync-XXXXXX";
    const char* d = mkdtemp(tmpl);
    ASSERT_NE(d, nullptr);
    const std::string path = std::string(d) + "/t.db";

    sqlite3* db = nullptr;
    ASSERT_EQ(
        sqlite3_open_v2(path.c_str(), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nullptr),
        SQLITE_OK);
    ASSERT_EQ(sqlite3_exec(db, "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;", nullptr,
                           nullptr, nullptr),
              SQLITE_OK);
    ASSERT_EQ(sqlite3_exec(db, "CREATE TABLE t(a INTEGER, b TEXT);", nullptr, nullptr, nullptr),
              SQLITE_OK);
    gFsync = 0;
    gFdatasync = 0;
    for (int i = 0; i < 10; ++i) {
        const std::string sql = "INSERT INTO t VALUES(" + std::to_string(i) + ", 'x');";
        ASSERT_EQ(sqlite3_exec(db, sql.c_str(), nullptr, nullptr, nullptr), SQLITE_OK);
    }
    ASSERT_EQ(sqlite3_exec(db, "PRAGMA wal_checkpoint(TRUNCATE);", nullptr, nullptr, nullptr),
              SQLITE_OK);
    sqlite3_close(db);
    EXPECT_GE(gFdatasync.load(), 10);  // at least one per commit
    EXPECT_EQ(gFsync.load(), 0);
    std::string rm = "rm -rf ";
    rm += d;
    (void)std::system(rm.c_str());
}
