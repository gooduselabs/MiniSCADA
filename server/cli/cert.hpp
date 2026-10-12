// Certificate commands of the device (specs/005-device-online/contracts/device-config.md §4,
// research R5, FR-009), each with [--data-dir <dir>] [--config <runtime.json>]:
//   mat-runtime --cert-fingerprint  (root or the service user) prints
//       "SHA256 Fingerprint=AB:CD:…", as `openssl x509 -noout -fingerprint -sha256` does; it only
//       reads.
//   mat-runtime --regen-cert  (root) records cert.regenerate `started`, has a child process
//       switched to the service user write a new key and certificate, records `ok` (old and new
//       fingerprint) or `failed`, prints the new fingerprint, then runs
//       `systemctl try-restart mat-runtime`. Studios that pinned the old fingerprint refuse the
//       device until an engineer pins it again.
// Exit codes: 0 ok (a restart that fails only warns); 2 bad arguments; 4 not root, the new files
// cannot be written; 5 the audit record cannot be written (the certificate is unchanged);
// 6 no certificate yet, or a damaged one (--cert-fingerprint).
#pragma once
#include <ostream>

#include "server/cli/device_cli.hpp"

namespace mat {

// argv holds --cert-fingerprint or --regen-cert.
bool isCertCommand(int argc, char** argv);
int runCertCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
               std::ostream& err);

}  // namespace mat
