// `mat-runtime --list-serial` (feature 006 T168; contracts/device-config.md §4): the list of serial
// ports as GET /api/v1/serial/ports gives it, on stdout. Run as the service user (`runuser -u
// matscada --`); it reads /sys, /proc, /etc and /run and opens no port, so it also works while the
// runtime holds them. A running channel is not known to this process: `inUse` shows the console,
// getty and lock files only.
//   mat-runtime --list-serial [--config <file>] [--serial-ports <pattern,…>]
// (`--sys-root <dir>` takes the trees of /sys, /proc, /etc, /dev and /run from a directory: tests.)
// Exit codes as the other device commands: 0 ok; 2 bad arguments or configuration.
#pragma once
#include <iosfwd>
#include <string>

#include "server/cli/device_cli.hpp"

namespace mat {

bool isSerialCommand(int argc, char** argv);
int runSerialCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
                 std::ostream& err);

}  // namespace mat
