// `mat-runtime --alarm-db-check` (feature 009 T038; FR-041, D46; specs/009-alarms tasks T040): a
// read-only look at alarm.db, for the technician and for tools/alarm-it.ps1 after a kill -9:
//   {"state": "ok" | "missing" | "damaged", "path": "...", "integrity": "ok" | "<first lines>",
//    "rows": N, "open": M, "acked": K, "schema": 1,
//    "ackWithoutAudit": [{"id": 4412, "alarmId": "TANK.HH"}, ...]}
// `ackWithoutAudit` lists the occurrences that carry an acknowledgement (ts_ack_ms) while audit.db
// has no alarm.ack record naming them (SC-008: audit first, then state). A record of a batch names
// at most 10 ids, so an acknowledgement beyond the tenth of a large batch is reported here although
// it is in order (a false positive of a batch of more than ten, never a miss).
// It opens the files read only, makes none, renames nothing (the runtime renames a damaged file
// when it starts). Run as the service user.
//   mat-runtime --alarm-db-check [--config <file>] [--data-dir <dir>]
// Exit codes: 0 sound or no alarm.db yet, 1 integrity_check failed, 2 bad arguments or
// configuration, 3 an acknowledgement without an audit record.
#pragma once
#include <iosfwd>

#include "server/cli/device_cli.hpp"

namespace mat {

bool isAlarmDbCheckCommand(int argc, char** argv);
int runAlarmDbCheckCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
                       std::ostream& err);

}  // namespace mat
