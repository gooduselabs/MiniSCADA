// `mat-runtime --self-check [--config <file>] [--data-dir <dir>] [--json]` (feature 011 T113;
// FR-066; device-api-011 §7; contracts/update-package.md §4 S5): run by mat-updater as matscada
// with the NEW binary of an update, before the switch. Read only, no port:
//   config         runtime.json loads with this binary's rules
//   data           the read-only check of --check-data (server/cli/check_data.hpp); "damaged"
//                  refuses (the new version would start on broken data), warnings pass
//   project-valid  the running project (the active version of the store, else projectDir) passes
//                  the validator of this binary with the schemas of its tree (<exe>/../schemas)
// Exit: 0 good, 1 refused, 2 bad arguments or configuration. --json: {"schema":"mat-self-check/1",
// "result":"ok|refused","checks":[{"name","status":"ok|warning|failed|missing","detail"}]}.
#pragma once
#include <iosfwd>
#include <string>

#include "server/cli/device_cli.hpp"

namespace mat {

bool isSelfCheckCommand(int argc, char** argv);
int runSelfCheckCli(int argc, char** argv, const DeviceCliEnv& env, const std::string& schemasDir,
                    std::ostream& out, std::ostream& err);

// The directory of the project the runtime runs: <store>/v/<active>/project, else projectDir
// (installed the old way); "" when there is none.
std::string runningProjectDir(const RuntimeConfig& cfg);

}  // namespace mat
