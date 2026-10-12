// Shared parts of the feature 005 device commands
// (specs/005-device-online/contracts/device-config.md §4): what they need from the system, and the
// child process that writes as the service user.
//
// A command run by root never writes audit.db or server.pem itself: a child process switched to the
// user the runtime runs as (unit `User=matscada`) does, so those files and SQLite's -wal and -shm
// never belong to root (research R8). The child opens its own AuditLog after the switch; an open
// one is never carried across fork (core/audit/audit_log.hpp). Call these before any thread exists.
#pragma once
#include <functional>
#include <string>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "server/config.hpp"

namespace mat {

// What a device command needs from the system; tests replace parts of it.
struct DeviceCliEnv {
    bool isRoot = false;  // geteuid() == 0
    // Passwords: a terminal (asked twice, echo off) or, with --password-stdin, one line.
    int inFd = 0;
    // The user the runtime runs as. When it does not exist (a development container), the child
    // keeps the current user and the command prints a warning.
    std::string serviceUser = "matscada";
    std::function<std::string()> nowIso;    // UTC "YYYY-MM-DDTHH:MM:SSZ"; empty: system clock
    std::function<std::string()> hostname;  // empty: systemHostname()
    // Runs a program (argv[0] looked up in PATH), returns its exit status; 127 when it cannot be
    // started. Empty: runProgram. --regen-cert calls `systemctl try-restart mat-runtime`.
    std::function<int(const std::vector<std::string>& argv)> runCommand;
    AuditClock auditClock;  // empty members: the system clocks
};

// The real system: geteuid, stdin, the system clock and host name, runProgram.
DeviceCliEnv systemDeviceCliEnv();

// UTC "YYYY-MM-DDTHH:MM:SSZ" of the system clock.
std::string utcIsoNow();

// Exit status of a program run with posix_spawnp (PATH lookup); 127 when it cannot be started,
// 128 + signal when a signal ended it.
int runProgram(const std::vector<std::string>& argv);

// The configuration as the service sees it (/etc/mat-runtime/runtime.json, or --config) with the
// overrides the device commands accept (--config, --data-dir, --users-file and their values).
// false + `error` when it cannot be read or is not valid.
bool loadDeviceCliConfig(const std::vector<std::string>& overrides, const DeviceCliEnv& env,
                         RuntimeConfig& cfg, std::string& error);
// audit.db of that configuration: dataDir, auditRetentionDays, auditMaxMB, env.auditClock.
AuditOptions deviceCliAuditOptions(const RuntimeConfig& cfg, const DeviceCliEnv& env);

struct ChildResult {
    int status = -1;      // exit code of the child; -1: no child, or a signal ended it
    std::string message;  // what `fn` put in `message` (at most 4 KiB)
    std::string warning;  // e.g. the service user does not exist
};

// Runs `fn` in a child process: when root, switched to env.serviceUser (its uid and primary gid,
// no supplementary group, umask 077, working directory /) and unable to get root back. `fn` returns
// the exit code; its `message` comes back to the parent through a pipe. The child never returns
// (it ends with _exit, so no buffer of the parent is written twice).
ChildResult runAsServiceUser(const DeviceCliEnv& env,
                             const std::function<int(std::string& message)>& fn);

// One audit record, committed by such a child with its own AuditLog on `options.dataDir`.
// false + `error` when it was not written: the command changes nothing (exit code 5).
bool appendAuditAsServiceUser(const DeviceCliEnv& env, const AuditOptions& options,
                              const AuditEvent& event, std::string& error,
                              std::string* warning = nullptr);

}  // namespace mat
