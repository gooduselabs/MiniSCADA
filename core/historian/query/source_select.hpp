// Which table answers a history request (specs/010-history-reports contracts/history-api.md §3.1).
// Pure: the caller measures the inputs (coverage of the aggregate tables, estimated raw scan).
#pragma once
#include <cstdint>
#include <string>

namespace mat {

enum class ResParam { Auto, Raw, Minute, Hour };
enum class ReduceParam { MinMax, Lttb, Decimate };

enum class SourceRes { Raw, Minute, Hour };

struct SourceInput {
    int64_t from = 0;
    int64_t to = 0;
    int maxPoints = 1000;
    ResParam res = ResParam::Auto;
    ReduceParam reduce = ReduceParam::MinMax;
    bool groupHasAggregates = false;
    double hourCoverage = 0;    // 0..1: share of [from, to) the hour table covers
    double minuteCoverage = 0;  // same for the minute table
    int64_t scanBytes = 0;      // estimated raw scan: rows in the range x (row bytes + 16)
    int64_t scanLimitBytes = 64LL << 20;
};

struct SourceChoice {
    SourceRes res = SourceRes::Raw;
    ReduceParam reduce = ReduceParam::MinMax;  // meaningful for the raw source
    bool approximate = false;                  // decimate over the limit
    std::string error;                         // "", "NO_AGGREGATES" or "SCAN_LIMIT"
};

constexpr double kMinCoverage = 0.5;  // an aggregate table "covers" the range from half of it on

SourceChoice chooseSource(const SourceInput& in);

const char* sourceResName(SourceRes r);  // raw / 1m / 1h

}  // namespace mat
