// `mat-runtime --set-secret <connectionId> [--secrets-file <path>] [--config <runtime.json>]`
// (specs/003-data-logging/contracts/device.md): reads the password or token from the first line
// of stdin (no echo on a terminal) and stores it in the device secret file. Root only.
// Exit codes: 0 ok; 4 not root, invalid id, empty secret or the file cannot be written.
// The secret is never printed.
#pragma once
#include <istream>
#include <ostream>

namespace mat {

int runSetSecretCli(int argc, char** argv, std::istream& in, std::ostream& out, std::ostream& err,
                    bool isRoot);

}  // namespace mat
