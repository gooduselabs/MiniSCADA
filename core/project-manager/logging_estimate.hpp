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

constexpr double kLogExtremeBytes = 8.0 * 1024 * 1024 * 1024;  // W_LOG_WRITE_EXTREME (0.6)
constexpr double kAggRowBytes = 64;  // one mat_agg row; per Tag a day holds 1440 + 24 rows

// One group of the estimate v2 (contracts/logging-config-0.2.md §5).
struct GroupEstimate {
    double rowsPerDay = 0;
    std::string basis;  // exact | expected | upper
    double rowBytes = 0;
    double rawWrite = 0;
    double aggWrite = 0;
    double rawStorage = 0;
    double aggStorage = 0;
    double aggTags = 0;
};

struct LoggingEstimate {
    double writeBytesPerDay = 0;
    double rawWriteBytesPerDay = 0;
    double aggWriteBytesPerDay = 0;
    double storageBytes = 0;
    double dailyGrowthBytes = 0;
    // floor(2 GiB / dailyGrowthBytes); -1 when there is no group or nothing grows (null in TS)
    double daysToFillCap = -1;
    // W_LOG_WRITE_BUDGET, W_LOG_WRITE_EXTREME (0.6 only), W_LOG_SIZE_CAP
    std::vector<std::string> warnings;
    std::vector<GroupEstimate> groups;
};

// Bytes of one cell by Tag type ("FLOAT32", …); unknown types count as 9.
double logCellBytes(const std::string& type, int maxLength = 255);

// `logging` passed the schema; `tagTypes`: Tag id → type name. `extremeWarning`:
// W_LOG_WRITE_EXTREME exists only in format 0.6 (the validator passes false for 0.1 to 0.3). The
// arithmetic and its order are those of estimateLogging() in
// packages/project-schema/src/logging.ts.
LoggingEstimate estimateLogging(const nlohmann::json& logging,
                                const std::map<std::string, std::string>& tagTypes,
                                bool extremeWarning = true);

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
