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
    int httpsThreads =
        40;  // 007: one worker per live socket (10) + the idle connections of the pages
    bool discoveryEnabled = true;
    int discoveryPort = 8446;  // UDP
    std::string deviceName;    // set by loadConfig: the host name unless configured
    std::string deviceModel = "BL335";
    std::string projectStoreDir;  // set by loadConfig: <dataDir>/projects unless configured
    int projectBackups = 3;
    std::string usersFile = "/etc/mat-runtime/users.json";
    int auditRetentionDays = 365;
    int auditMaxMB = 64;
    // Feature 006 (specs/006-tags-modbus/contracts/device-config.md §1)
    std::vector<std::string> serialPorts{
        "ttyAS*"};  // tty names (a trailing * allowed) or by-id / by-path paths
    std::string viewerAccess = "private";  // private | any | off (FR-055a)
    int retainWindowS = 5;                 // 1-60
    std::string retainDir;                 // set by loadConfig: <dataDir>/retain unless configured
    int tagWriteSessionBurst = 10;         // 1-10
    int tagWriteSessionPerMin = 20;        // 1-20
    int tagWriteGlobalBurst = 20;          // 1-20
    int tagWriteGlobalPerMin = 20;         // 1-30; provisional, set from the eMMC measure (R15)
    int tagWriteQueuePerChannel = 16;      // 1-64
    int tagWriteQueueTotal = 64;           // 1-256
    // Feature 007 (specs/007-screens-widgets/contracts/device-config-007.md §1): the sign-in of the
    // runtime page. viewerLogin: off (the page is seen without signing in, as before) or required
    // (no page and no data without a session).
    std::string viewerLogin = "off";
    int webSessionIdleMin = 30;   // 5-480
    int webMaxSessions = 8;       // 1-16
    int webSessionMaxHours = 12;  // 1-24
    // Feature 009 (specs/009-alarms data-model §11): alarm.db and the alarm engine. A value out of
    // its range is clamped with a warning at start-up (as the keys of 003), never an error.
    int alarmRetentionDays = 180;    // 1-3650
    int alarmMaxBytes = 67108864;    // 4 MiB - 1 GiB: bytes of pages in use
    int alarmCommitMs = 2000;        // 200-60000
    int alarmCommitMaxMs = 60000;    // alarmCommitMs - 300000 (the window of a storm, ADR-028)
    int alarmCommitRows = 200;       // 10-5000
    int alarmBufferMax = 5000;       // 500-100000
    int alarmChatterWindowS = 60;    // 10-600
    int alarmChatterShelveS = 1800;  // 60-86400
    int alarmMaxShelved = 50;        // 1-200
    int alarmPurgeIntervalS = 3600;  // 60-86400
    int alarmPurgeBatch = 1000;      // 100-5000
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
// A serialPorts entry (contract device-config §1): tty name with an optional trailing *, or a
// /dev/serial/by-id/ or /dev/serial/by-path/ path of one name.
bool isValidSerialPortPattern(const std::string& s);

std::optional<std::string> readTextFile(const std::string& path, size_t maxBytes = 1 << 20);

}  // namespace mat
