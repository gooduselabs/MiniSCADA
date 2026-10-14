// Checks the aggregate tables against the raw rows (specs/010-history-reports FR-061, device-010.md
// §3): the buckets are built again from the raw rows with the same accumulator, the signal broken
// at every start recorded in mat_runs, and compared with mat_agg. Read-only.
//
// What is not compared (the run that ended in a crash or a clean stop is not known to the ms):
// the windows from the last raw row of a finished run to the start of the next one, and the window
// that holds the start of the range asked for. They are counted as `tolerated`.
#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"

namespace mat {

struct AggDiff {
    std::string column;
    int64_t res = 0;
    int64_t bucket = 0;
    std::string kind;    // missing / extra / mismatch
    std::string detail;  // which field
};

struct VerifyResult {
    int64_t checked = 0;    // buckets compared
    int64_t tolerated = 0;  // buckets left out (see above)
    int64_t missing = 0;
    int64_t extra = 0;
    int64_t mismatch = 0;
    int64_t duplicates = 0;  // never expected: the primary key forbids it
    std::string note;        // e.g. "no aggregates built yet"
    std::vector<AggDiff> diffs;  // at most the first 200
    bool clean() const { return missing + extra + mismatch + duplicates == 0; }
};

// `groupId` as in logging.json. `from`, `to`: UTC ms; the end is cut at `agg_built_to` (the open
// window is not built yet). false + `err` when the file or the group cannot be read.
bool verifyAggregates(const std::string& dbPath, const std::string& groupId,
                      std::optional<int64_t> from, std::optional<int64_t> to, VerifyResult& out,
                      std::string& err);

// Rows and space per table, the aggregate tables, the runs and the schema (--history-stats).
bool historyStats(const std::string& dbPath, nlohmann::json& out, std::string& err);

}  // namespace mat
