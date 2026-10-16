// SQLite VFS shim that counts the bytes the runtime really write()s to each database file
// (ADR-039). The kernel of the BL335 has no /proc/<pid>/io and no blkio, so this is the only
// honest measure of what mat-runtime asks the eMMC to take: every xWrite of history.db, alarm.db,
// audit.db and their -wal / -journal files, added up per database (the file name without the
// -wal / -journal / -shm suffix). It counts what reaches the page cache, so it is an upper bound
// of the flash writes (the kernel may merge two writes of the same page before write-back).
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace mat {

inline constexpr const char* kCountingVfsName = "mat-count";

// Registers the shim over the default VFS (not as the default). Idempotent and thread-safe; false
// when SQLite has no default VFS. Open a database with countingVfsName() as the vfs argument of
// sqlite3_open_v2; it is nullptr (default VFS) when the shim cannot be registered.
bool registerCountingVfs();
const char* countingVfsName();

struct DbWriteBytes {
    std::string db;  // base name of the database file, e.g. "history.db"
    int64_t bytes = 0;
};

// Bytes written since the process started (or since the last reset), one entry per database.
std::vector<DbWriteBytes> dbWriteBytes();
int64_t totalDbWriteBytes();
// Tests only: a counter of one database back to zero.
void resetDbWriteBytesForTest(const std::string& db);

}  // namespace mat
