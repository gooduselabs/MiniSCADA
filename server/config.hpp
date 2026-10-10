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
};

struct ConfigResult {
    bool ok = false;
    RuntimeConfig cfg;
    std::vector<std::string> warnings;
    std::string error;
};

using FileReader = std::function<std::optional<std::string>(const std::string& path)>;

ConfigResult loadConfig(int argc, char** argv, const FileReader& readFile);
std::optional<std::string> readTextFile(const std::string& path, size_t maxBytes = 1 << 20);

}  // namespace mat
