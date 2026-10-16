// Merging of aggregate buckets and the quantities derived from them (specs/010-history-reports
// contracts/history-db.md §6). Pure functions; the TypeScript twin is packages/history-math, both
// run the same vectors (tests/agg-vectors).
#pragma once
#include <cstdint>
#include <optional>

namespace mat {

// One window of the held signal: n rows, min/max, the signal at the start (first) and the end
// (last) of the window, the integral value x ms (sumw) and the ms that have a value (wms).
struct AggBucket {
    int64_t n = 0;
    double min = 0;
    double max = 0;
    double first = 0;
    double last = 0;
    double sumw = 0;
    int64_t wms = 0;

    // No data at all: the identity of mergeBuckets().
    bool empty() const { return n == 0 && wms == 0; }
};

// A (earlier) merged with B (later); the windows may be adjacent or apart. An empty bucket is
// the identity.
AggBucket mergeBuckets(const AggBucket& a, const AggBucket& b);

// Time-weighted mean; `last` when no millisecond has a value; nullopt for an empty bucket.
std::optional<double> aggAvg(const AggBucket& b);
// Integral in value x hours (kW -> kWh, BOOL -> hours of running); nullopt for an empty bucket.
std::optional<double> aggSum(const AggBucket& b);
std::optional<double> aggDelta(const AggBucket& b);
// Share of the window `lengthMs` that has a value (0..1).
double aggCoverage(const AggBucket& b, int64_t lengthMs);

}  // namespace mat
