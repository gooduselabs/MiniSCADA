// `mat-runtime --verify-aggregates <group> [--from T --to T] [--json] [--data-dir D] [--config C]
// [--tz ±HH:MM]` and `--history-stats [--json]` (specs/010-history-reports contracts/device-010.md
// §3). Read-only; they run while the runtime runs. Exit codes: 0 consistent, 1 differences found,
// 2 bad arguments or an unreadable file.
#pragma once
#include <cstdint>
#include <ostream>

namespace mat {

int runVerifyAggregatesCli(int argc, char** argv, std::ostream& out, std::ostream& err);
int runHistoryStatsCli(int argc, char** argv, std::ostream& out, std::ostream& err);

}  // namespace mat
