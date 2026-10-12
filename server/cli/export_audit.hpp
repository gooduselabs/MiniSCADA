// `mat-runtime --export-audit [--from …] [--to …] [--tz ±HH:MM] [--format csv|jsonl] [--data-dir D]
// [--config C]` (specs/005-device-online/contracts/device-config.md §4, research R11, US4-3): the
// audit log on stdout, oldest first so that the newest row is last, read page by page. Run as the
// service user: `runuser -u matscada -- mat-runtime --export-audit`.
//
// - Every sign-in that failed, every refused access and every change is in it; nothing secret is
//   stored in a row, so nothing is printed.
// - CSV: header `id,time,ts_ms,clock_ok,user,role,source,channel,action,target,result,code,detail,
//   count`; text cells follow the rules of --export-history against CSV injection (a name typed at
//   a failed sign-in is attacker text). JSONL: one object per line with the fields of GET
//   /api/v1/audit (device-api §7).
// - --from, --to: local time `YYYY-MM-DD[ HH:MM[:SS]]` in --tz (default +07:00 as
// --export-history),
//   [from, to); without them the whole log.
// - The command writes its own audit.export row (result ok, channel cli, source cli, target = the
//   format, detail = the arguments) before the first byte of data, and the export ends with it.
//
// Exit codes: 0 ok; 2 bad arguments; 4 no audit.db (nothing is created) or it cannot be opened;
// 5 the audit.export row cannot be written (nothing is printed) or the output failed (the export is
// cut). \`terminal\`: stdout is a terminal, where control characters of a CSV text are shown as
// \xNN.
#pragma once
#include <ostream>

#include "server/cli/device_cli.hpp"

namespace mat {

bool isExportAuditCommand(int argc, char** argv);
int runExportAuditCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
                      std::ostream& err, bool terminal = false);

}  // namespace mat
