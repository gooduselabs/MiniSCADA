// Account commands of the device (specs/005-device-online/contracts/device-config.md §4, research
// R8, FR-011, ADR-011), run by root (the BL335 has no sudo):
//   mat-runtime --user-add <name> --role <role> [--password-stdin]
//   mat-runtime --user-passwd <name> [--password-stdin]
//   mat-runtime --user-role <name> <role>
//   mat-runtime --user-disable <name> | --user-enable <name> | --user-unlock <name>
//   mat-runtime --user-list
// each with [--users-file <file>] [--data-dir <dir>] [--config <runtime.json>].
//
// - A password never comes from an argument: from the terminal (asked twice, echo off) or one line
//   of stdin with --password-stdin; 15–128 characters, not the account name, no combining mark
//   (ADR-011: the Studio sends NFC, so the device takes only precomposed letters).
// - The audit record (account.create … account.unlock) is committed first, as `started`, by a
//   child process switched to the service user; then users.json is written (temporary file, fsync,
//   root:<group of the service user>, 0640, rename); then `ok` or `failed`.
// - rev + 1 on a password, role or enabled change (the runtime ends the account's sessions);
//   unlockSeq + 1 on --user-unlock. A change to what the account already has changes nothing.
// - The last enabled administrator can be neither disabled nor given another role.
// - --user-list: a header line, then one line per account with the columns name, role, "bật" or
//   "tắt", last change (UTC), and a note for an unusable hash; never a hash. deploy.sh reads
//   columns 2 and 3 to find an enabled administrator.
//
// Exit codes: 0 ok (a change that changes nothing too); 2 bad arguments or a refused password;
// 4 not root, invalid name, no such account, account already there, 64 accounts, last
// administrator, users.json cannot be written; 5 the audit record cannot be written (nothing
// changed); 6 users.json damaged or unreadable.
#pragma once
#include <ostream>

#include "server/cli/device_cli.hpp"

namespace mat {

// argv holds one of the --user-* commands.
bool isUserCommand(int argc, char** argv);
int runUserCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
               std::ostream& err);

}  // namespace mat
