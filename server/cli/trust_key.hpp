// `mat-runtime --trust-key list | add <file.pem> [--label <name>] | remove <keyId>
//  [--keys-dir <dir>] [--config <file>]` (feature 011 T113; FR-066; device-api-011 §7;
// contracts/update-package.md §3; release-signing.md §6): the trusted keys of OTA, root only for
// add and remove. The directory is update.trustedKeysDir of runtime.json unless --keys-dir. A key
// is written <label>.pem (temp file, then rename; 0644; directory 0755); only ECDSA P-256 public
// keys, at most 4 keys (ADR-035), never the same key twice. The runtime audits the change at its
// next start (system.keys.updated). Exit: 0 done, 1 refused, 2 bad arguments, 4 not root.
#pragma once
#include <iosfwd>

#include "server/cli/device_cli.hpp"

namespace mat {

bool isTrustKeyCommand(int argc, char** argv);
int runTrustKeyCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
                   std::ostream& err);

}  // namespace mat
