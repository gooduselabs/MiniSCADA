// `mat-runtime --retain-dump` (feature 006 T177; contracts/device-config.md §4; FR-018): what the
// store of the retained Tags holds, on stdout as JSON:
//   {"state": "ok" | "fallback" | "lost" | "fresh", "file": "retain-a.bin", "generation": 7,
//    "entries": 2, "tags": [{"id": "A.SET", "type": "FLOAT32", "value": 85.5}, ...]}
// `fresh`: nothing was stored yet. 64-bit integers are text, as in the live protocol. Run as the
// service user (`runuser -u matscada --`). It only reads: a damaged file is not renamed and no file
// is made (the runtime does that when it starts).
//   mat-runtime --retain-dump [--config <file>] [--data-dir <dir>] [--retain-dir <dir>]
// Exit codes as the other device commands: 0 ok, fallback or fresh; 1 the store is lost; 2 bad
// arguments or configuration.
#pragma once
#include <iosfwd>

#include "server/cli/device_cli.hpp"

namespace mat {

bool isRetainCommand(int argc, char** argv);
int runRetainCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
                 std::ostream& err);

}  // namespace mat
