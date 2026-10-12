// Device commands of the project store (specs/005-device-online/contracts/device-config.md §4):
//   mat-runtime --project-status [--config <file>] [--data-dir <dir>] [--project-store-dir <dir>]
//     the running version, the backups and the pending operation, read from state.json; writes
//     nothing (no directory is created, no audit row). Run as `runuser -u matscada --`.
//   mat-runtime --check-project --project-store <dir> [--schemas-dir <dir>]
//     validates the project that runs in the store (v/<active>/project) with this binary, as
//     `deploy.sh` does before it replaces the runtime (T111). Prints the validator's JSON
//     (resultJson). A store with no running project is valid: there is nothing to run.
// Exit codes: 0 ok / valid; 1 the project is not valid for this binary; 2 bad arguments; 6 the
// store cannot be read (no state.json, damaged, schema file missing).
// `--check-project` without `--project-store` is the older check of projectDir (server/main.cpp).
#pragma once
#include <ostream>
#include <string>

#include "server/cli/device_cli.hpp"

namespace mat {

bool isProjectCommand(int argc, char** argv);

// `defaultSchemasDir`: the schemas of this runtime (<exe>/../schemas), used without --schemas-dir.
int runProjectCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
                  std::ostream& err, const std::string& defaultSchemasDir);

}  // namespace mat
