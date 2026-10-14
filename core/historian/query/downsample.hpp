// Point reduction for the history API (specs/010-history-reports contracts/history-api.md §3.2).
// Pure and deterministic; the TypeScript twin is packages/history-math/src/reduce.ts and both run
// tests/downsample-vectors (README there fixes the details the contract leaves open).
#pragma once
#include <cstdint>
#include <optional>
#include <vector>

#include "core/historian/agg_math.hpp"

namespace mat {

struct SeriesPoint {
    int64_t t = 0;
    std::optional<double> v;  // empty = NULL cell
};

// One reduced point of an aggregate source: `v` = avg of the merged window, `min`, `max`.
struct MergedPoint {
    int64_t t = 0;
    double v = 0;
    double min = 0;
    double max = 0;
};

struct BucketRow {
    int64_t bucket = 0;  // window start, UTC ms
    AggBucket agg;
};

// min/max per window, streaming: feed the rows of one series in time order (all inside
// [from, to)), then take the result. Keeps O(windows) state; the rows themselves are kept only
// while there are no more than maxPoints of them (then they are returned unchanged).
class MinMaxReducer {
   public:
    MinMaxReducer(int64_t from, int64_t to, int maxPoints);
    void add(int64_t t, std::optional<double> v);
    std::vector<SeriesPoint> finish();
    // Rows given so far.
    int64_t count() const { return count_; }

   private:
    struct Pick {
        int64_t idx = -1;
        int64_t t = 0;
        std::optional<double> v;
    };
    struct Window {
        Pick min, max, null;
    };
    int64_t from_;
    int64_t to_;
    int maxPoints_;
    int64_t windows_;
    int64_t count_ = 0;
    std::vector<SeriesPoint> all_;  // while count_ <= maxPoints_
    std::vector<Window> w_;
    Pick first_;
    Pick last_;
};

std::vector<SeriesPoint> reduceMinMax(const std::vector<SeriesPoint>& rows, int64_t from,
                                      int64_t to, int maxPoints);
// The first row at or after the start of each of `maxPoints` windows, if inside the window.
std::vector<SeriesPoint> reduceDecimate(const std::vector<SeriesPoint>& rows, int64_t from,
                                        int64_t to, int maxPoints);
// Largest-Triangle-Three-Buckets over the non-NULL points; runs between NULLs are reduced one by
// one (at least 2 points each) and the NULL points between them are kept.
std::vector<SeriesPoint> reduceLttb(const std::vector<SeriesPoint>& points, int threshold);
// Aggregate rows into at most maxPoints windows of adjacent cells (merge); one point per window.
std::vector<MergedPoint> reduceMerge(const std::vector<BucketRow>& rows, int64_t from, int64_t to,
                                     int64_t res, int maxPoints);

// Window k of `w` equal parts of [from, to) that holds time t (exact integer arithmetic).
int64_t windowOf(int64_t t, int64_t from, int64_t to, int64_t w);

}  // namespace mat
