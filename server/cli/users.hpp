// Account commands of the device (specs/005-device-online/contracts/device-config.md §4, research
// R8, FR-011, ADR-011), run by root (the BL335 has no sudo):
//   mat-runtime --user-add <name> --role <role> [--password-stdin]
//   mat-runtime --user-passwd <name> [--password-stdin]
//   mat-runtime --user-role <name> <role>
//   mat-runtime --user-disable <name> | --user-enable <name> | --user-unlock <name>
//   mat-runtime --user-unlock-all
//   mat-runtime --logic-writes-reset   (feature 011: clear an administrator stop of logic writes)
//   mat-runtime --pulse-ack <rid|all>  (feature 011, T202: close pulses reported PULSE_STUCK)
//   mat-runtime --user-list
//   feature 013 (contracts/admin-api.md §8):
//   mat-runtime --user-groups <name> <g1,g2|->  --user-remove <name>
//   mat-runtime --group-add <id> <name> | --group-remove <id> | --access-reset
// each with [--users-file <file>] [--data-dir <dir>] [--config <runtime.json>].
//
// Feature 013: the accounts are <dataDir>/auth/users.json (0600, the service user's, in a 0700
// directory of the service user), made once from the seed --users-file (/etc/mat-runtime/
// users.json, audit account.migrate); groups and rules are <dataDir>/auth/access.json. Every
// change runs under the flock of that directory (the runtime's admin API takes it too), keeps the
// file before as .bak and bumps the file's rev. --group-remove also takes the group out of the
// accounts and the rules (recovery); --access-reset removes every rule and keeps the groups.
//
// - A password never comes from an argument: from the terminal (asked twice, echo off) or one line
//   of stdin with --password-stdin; 15–128 characters, not the account name, no combining mark
//   (ADR-011: the Studio sends NFC, so the device takes only precomposed letters).
// - The audit record (account.create … account.unlock) is committed first, as `started`, by a
//   child process switched to the service user; then users.json is written (temporary file, fsync,
//   root:<group of the service user>, 0640, rename); then `ok` or `failed`.
// - rev + 1 on a password, role or enabled change (the runtime ends the account's sessions);
//   unlockSeq + 1 on --user-unlock (the runtime clears every (name, IP) pair of the account). A
//   change to what the account already has changes nothing.
// - --user-unlock-all (feature 011, FR-017): <dataDir>/auth-unlock.req (0600), which the runtime
//   deletes within 5 s or at start, then clears every pair and address lock; audit account.unlock
//   with target "*". users.json is not touched.
// - --logic-writes-reset (feature 011, follow-up of T137): <dataDir>/logic-writes-reset.req (0600),
//   which the runtime takes within 5 s (a project with logic.json runs) or at start, then clears
//   writesStopped of logic-state.json (edges kept); audit logic.writes.enabled.
// - --pulse-ack <rid|all> (feature 011, second review T202): <dataDir>/pulse-ack.req (0600), which
//   the runtime takes within 5 s (a project runs) or at start, then closes the pulse journal
//   entries reported PULSE_STUCK (that request id, or all); audit pulse.ack. Exit 2 for a value
//   that is neither "all" nor a request id.
// - New passwords (--user-add, --user-passwd) keep the rule of 15 characters (feature 011 asks for
//   at least 10); accounts made before are not forced to change.
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
