// Block `historian` of GET /api/v1/system/info (specs/003-data-logging/contracts/system-info.md).
// The page is public (no login yet): the JSON is built only from counters, states, error classes,
// database error codes and fixed sentences, never from the connection settings or the raw error
// text of a client (which can hold host, user and database names: journal only, research R13).
#pragma once
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "core/historian/historian.hpp"
#include "nlohmann/json.hpp"

namespace mat {

// Counters of the history API (specs/010 contracts/device-010.md §1 "query").
struct HistoryQueryInfo {
    bool enabled = true;
    int inFlight = 0;
    uint64_t served = 0;
    uint64_t rejectedBusy = 0;
    uint64_t rejectedLimit = 0;
    uint64_t timeouts = 0;
    uint64_t errors = 0;
    int64_t p95Ms = 0;
    std::string lastErrorCode;  // empty = none
    int64_t lastErrorAt = 0;
};

struct HistorianInfoInput {
    bool enabled = false;  // the active project has a logging file
    size_t groups = 0;
    int64_t commitMs = 5000;
    std::vector<std::string> warnings;  // W_LOG_* of the active project
    std::string startError;             // the historian could not start: state error, code io
    // specs/010-history-reports
    std::optional<HistoryQueryInfo> query;  // the history API is served
    int64_t estimateBytesPerDay = -1;       // estimateLogging of the running config; -1 = unknown
    int64_t budgetBytesPerDay = 2147483648LL;
};

nlohmann::json historianInfoJson(const HistorianInfoInput& in, const HistorianStatus& s);

// Fixed sentence of a local storage error code (disk_full, corrupt, corrupt_recovered, io).
const char* historianErrorMessage(const std::string& code);

}  // namespace mat
