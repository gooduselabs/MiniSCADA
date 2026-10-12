// mat-runtime configuration (specs/002-vertical-slice/contracts/runtime-config.md):
// defaults < /etc/mat-runtime/runtime.json (or --config) < command line.
#pragma once
#include <cstddef>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace mat {

struct RuntimeConfig {
    int port = 8080;
    std::string docroot = "/opt/mat-runtime/web";
    std::string projectDir = "/opt/mat-runtime/project";
    std::string schemasDir;  // empty: <binary dir>/../schemas
    int maxClients = 10;
    std::vector<std::string> allowedOrigins{"http://tauri.localhost", "tauri://localhost"};
    int deltaPeriodMs = 250;
    bool simLoad = true;
    size_t sendQueueBytes = 262144;
    int heartbeatTimeoutMs = 15000;
    int threads = 24;
    bool checkProject = false;
    std::string configPath = "/etc/mat-runtime/runtime.json";
    // Feature 003 (specs/003-data-logging/contracts/device.md)
    std::string dataDir = "/var/lib/mat-runtime";
    std::string secretsFile = "/etc/mat-runtime/secrets.json";
    std::string clientLibDir = "/opt/mat-runtime/lib";
    int historianMaxDbMB = 2048;
    int historianMinFreeMB = 500;
    int historianCommitMs = 5000;
    // Feature 005 (specs/005-device-online/contracts/device-config.md §1)
    int httpsPort = 8443;  // 0: no HTTPS context and no engineering API
    int httpsThreads = 8;
    bool discoveryEnabled = true;
    int discoveryPort = 8446;  // UDP
    std::string deviceName;    // set by loadConfig: the host name unless configured
    std::string deviceModel = "BL335";
    std::string projectStoreDir;  // set by loadConfig: <dataDir>/projects unless configured
    int projectBackups = 3;
    std::string usersFile = "/etc/mat-runtime/users.json";
    int auditRetentionDays = 365;
    int auditMaxMB = 64;
    // Test hooks of the project switch (T108): only a build with -DMAT_TEST_HOOKS=ON (the x64
    // runtime of tools/device-it.ps1) accepts the arguments; the armhf build never has them.
    std::string testKillAtStep;  // --test-kill-at <step>: SIGKILL just before that deploy step
    std::string testHealth;      // --test-health die|hang: the version being tried dies or hangs
};

struct ConfigResult {
    bool ok = false;
    RuntimeConfig cfg;
    std::vector<std::string> warnings;
    std::string error;
};

using FileReader = std::function<std::optional<std::string>(const std::string& path)>;
// The host name (gethostname), default of deviceName; injectable for tests.
using HostnameFn = std::function<std::string()>;
std::string systemHostname();

ConfigResult loadConfig(int argc, char** argv, const FileReader& readFile,
                        const HostnameFn& hostname = systemHostname);
std::optional<std::string> readTextFile(const std::string& path, size_t maxBytes = 1 << 20);

}  // namespace mat
