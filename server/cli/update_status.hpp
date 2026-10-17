// `mat-runtime --update-status [--data-dir <dir>] [--config <file>] [--json]` (feature 011 T113;
// device-api-011 §7): the result of the last OTA update, <dataDir>/update/last.json as mat-updater
// wrote it, and whether a request waits. Read only. Exit 0 (2 for bad arguments).
#pragma once
#include <iosfwd>

#include "server/cli/device_cli.hpp"

namespace mat {

bool isUpdateStatusCommand(int argc, char** argv);
int runUpdateStatusCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
                       std::ostream& err);

}  // namespace mat
