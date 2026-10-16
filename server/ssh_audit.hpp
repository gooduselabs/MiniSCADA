// The warning SSH_ROOT_PASSWORD of system/info (specs/011-pilot-hardening FR-034,
// contracts/device-api-011.md §5): sshd lets root sign in with a password. The configuration is
// read the way sshd reads it, read-only: the main file, the files its Include lines name in place
// (a relative path from the folder of the main file, a glob in lexical order, at most 16 levels),
// the first value of a keyword wins, lines of a Match block do not set the global value. Unreadable
// main file: no warning (we do not know). Nothing is ever written.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "server/system_warnings.hpp"

namespace mat {

constexpr const char* kSshdConfigPath = "/etc/ssh/sshd_config";
constexpr int64_t kSshAuditPeriodMs = 10 * 60 * 1000;  // mat-runtime reads it again this often

struct SshAuditResult {
    bool readable = false;      // the main file could be read
    bool rootPassword = false;  // PermitRootLogin yes and PasswordAuthentication not no
    std::string permitRootLogin = "prohibit-password";  // effective value (sshd default)
    std::string passwordAuthentication = "yes";         // effective value (sshd default)
    std::vector<std::string> files;                     // files read, in order
};

SshAuditResult auditSshConfig(const std::string& mainPath = kSshdConfigPath);

// Sets SSH_ROOT_PASSWORD (detail: the two values) when rootPassword, clears it otherwise.
void publishSshWarning(const SshAuditResult& result, SystemWarnings& warnings);

}  // namespace mat
