// `mat-runtime --export-history <groupId> [--from …] [--to …] [--tz ±HH:MM] [--data-dir D]
// [--config C]` (specs/003-data-logging/contracts/device.md): CSV of one group on stdout,
// read-only. Exit codes: 0 ok, 2 bad arguments, 4 no database or unknown group, 5 the output
// failed (the CSV is cut). `terminal`: stdout is a terminal, where control characters of a Tag
// string are shown as \xNN instead of acting.
#pragma once
#include <cstdint>
#include <ostream>

namespace mat {

int runExportHistoryCli(int argc, char** argv, std::ostream& out, std::ostream& err, int64_t nowUtc,
                        bool terminal = false);

// `mat-runtime --check-history [--data-dir D] [--config C]`: PRAGMA integrity_check of
// history.db, read-only, and the rows of every table (T077: after a kill or a power cut). Exit
// codes: 0 sound, 2 bad arguments, 4 no database, 6 damaged.
int runCheckHistoryCli(int argc, char** argv, std::ostream& out, std::ostream& err);

}  // namespace mat
