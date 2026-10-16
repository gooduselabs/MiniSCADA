// `mat-runtime --check-data [--json]` (specs/011-pilot-hardening FR-040, T066, T069;
// contracts/device-api-011.md §7, test-protocols §4 step 5): a read-only look at everything the
// runtime keeps on the eMMC, after a power cut or a kill -9, in at most 30 s:
//   history.db, audit.db, alarm.db   PRAGMA quick_check, opened read only. With no -shm next to it
//                                    the file is opened `immutable` (SQLite makes no -wal or -shm);
//                                    with one, read only with the usual locks. A -wal that holds
//                                    frames is "warning" (the next open replays it: recoverable).
//   project                          state.json of the store; the files of v/<active>/project
//                                    hashed again (projectDirDigest) and compared with the digest
//                                    of that version
//   retain                           the store read as --retain-dump reads it (nothing renamed)
//   pulse.journal                    armed entries (an `arm` without its `done`): "warning" (the
//                                    next start releases them)
//   logic-state                      <dataDir>/logic-state.json is JSON (when there is one)
// A file that is not there is "missing" (a device that never made it), never an error.
// Exit codes: 0 everything sound; 1 only warnings (recoverable); 2 something damaged; 3 bad
// arguments or configuration. With --json, one JSON object on stdout:
//   {"schema":"mat-check-data/1","result":"ok|warning|damaged","exitCode":0|1|2,"durationMs":N,
//    "checks":[{"name":"history.db","status":"ok|warning|damaged|missing","detail":"…"}, …]}
// It creates no file, renames nothing, changes no mtime (the -shm of a database in use is the one
// exception: SQLite's shared index, no data). The budget of the quick_checks is --budget-s (25 by
// default); a check stopped by it is "warning" ("chưa kiểm hết"), never "ok".
//   mat-runtime --check-data [--json] [--config <file>] [--data-dir <dir>] [--budget-s <n>]
#pragma once
#include <cstdint>
#include <iosfwd>
#include <string>
#include <vector>

#include "server/cli/device_cli.hpp"

namespace mat {

struct CheckDataOptions {
    std::string dataDir;
    std::string projectStoreDir;  // empty: <dataDir>/projects
    std::string retainDir;        // empty: <dataDir>/retain
    int64_t budgetMs = 25000;
};

struct CheckItem {
    std::string name;
    std::string status;  // ok | warning | damaged | missing
    std::string detail;
};

struct CheckDataResult {
    int exitCode = 0;
    int64_t durationMs = 0;
    std::vector<CheckItem> checks;
};

CheckDataResult checkData(const CheckDataOptions& options);
std::string checkDataJson(const CheckDataResult& result);

bool isCheckDataCommand(int argc, char** argv);
int runCheckDataCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
                    std::ostream& err);

}  // namespace mat
