// Write and storage estimate of logging.json (specs/003-data-logging/contracts/logging-config.md):
// the same constants and the same arithmetic order as packages/project-schema/src/logging.ts, so
// that both validators give the same W_LOG_* warnings.
#pragma once
#include <map>
#include <optional>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"

namespace mat {

constexpr double kLogBudgetBytes = 2.0 * 1024 * 1024 * 1024;  // 2 GiB

struct LoggingEstimate {
    double writeBytesPerDay = 0;
    double storageBytes = 0;
    std::vector<std::string> warnings;  // W_LOG_WRITE_BUDGET, W_LOG_SIZE_CAP
};

// Bytes of one cell by Tag type ("FLOAT32", …); unknown types count as 9.
double logCellBytes(const std::string& type, int maxLength = 255);

// `logging` passed the schema; `tagTypes`: Tag id → type name.
LoggingEstimate estimateLogging(const nlohmann::json& logging,
                                const std::map<std::string, std::string>& tagTypes);

// JSON Pointer of the first key that looks like a secret (contains password, passwd, pwd,
// secret, token, apikey or api_key, any case), or nullopt.
std::optional<std::string> findSecretKey(const nlohmann::json& v, const std::string& path = "");
// JSON Pointer of the first connection URL that holds a user or password
// (https://user:pass@host, security review L4), or nullopt.
std::optional<std::string> findUrlCredentials(const nlohmann::json& logging);
// Indexes of the connections a group sends to without checking the server
// (W_LOG_TLS_UNVERIFIED, security review M2): SQL with a tls other than verify-full (the default);
// InfluxDB https with require, or http to another machine (the token goes in clear).
std::vector<size_t> unverifiedConnections(const nlohmann::json& logging);

}  // namespace mat
