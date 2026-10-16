// Held-signal accumulator of the 1-minute and 1-hour aggregate tables (specs/010-history-reports
// contracts/history-db.md §3). Pure and clock-free: the caller passes the times. The TypeScript
// twin is packages/history-math/src/aggregator.ts; both run tests/agg-vectors.
#pragma once
#include <cstdint>
#include <optional>
#include <vector>

#include "core/historian/agg_math.hpp"

namespace mat {

constexpr int64_t kAggMinuteMs = 60000;
constexpr int64_t kAggHourMs = 3600000;

// A closed window, ready to be written.
struct AggOut {
    size_t col = 0;   // column index given to the aggregator
    int64_t res = 0;  // kAggMinuteMs or kAggHourMs
    int64_t bucket = 0;
    AggBucket agg;
};

// One column. Rows arrive in write order; advance(t) is called at least every pass.
class SignalAccumulator {
   public:
    // `v` empty = NULL row (the signal is unknown from t on).
    void row(int64_t t, std::optional<double> v, std::vector<AggBucket>& closed,
             std::vector<int64_t>& closedStart);
    void advance(int64_t t, std::vector<AggBucket>& closed, std::vector<int64_t>& closedStart);
    // Ends the held signal at t (start of the run, clock jump, paused writing, error, reload).
    void breakSignal(int64_t t, std::vector<AggBucket>& closed, std::vector<int64_t>& closedStart);
    bool holds() const { return held_.has_value(); }
    // The signal already had value `v` at t (back-fill: the last row before a slice), without
    // counting a row.
    void seed(int64_t t, double v);

   private:
    void openWindow(int64_t b);
    void closeWindow(std::vector<AggBucket>& closed, std::vector<int64_t>& closedStart);
    void addSegment(int64_t from, int64_t to);
    void addValue(double v);

    std::optional<double> held_;
    int64_t since_ = 0;
    int64_t lastT_ = INT64_MIN;
    bool haveWindow_ = false;
    int64_t winStart_ = 0;
    AggBucket cur_;
    bool hasMinMax_ = false;
    bool firstSet_ = false;
};

// All columns of one group: minute windows from the held signal, hour windows merged from them.
class GroupAggregator {
   public:
    explicit GroupAggregator(size_t columns) : cols_(columns), hours_(columns) {}

    // `values[i]` is the cell of column i (NULL = empty); size must equal the column count.
    void row(int64_t t, const std::vector<std::optional<double>>& values);
    void advance(int64_t t);
    void breakAll(int64_t t);
    // Starts the hour of column `col` from minute buckets already stored (recovery).
    void seedHour(size_t col, int64_t hourStart, const AggBucket& merged);
    void seed(size_t col, int64_t t, double v) {
        if (col < cols_.size()) cols_[col].seed(t, v);
    }
    // Closed windows since the last call, in the order they closed.
    void drain(std::vector<AggOut>& out);
    bool pending() const { return !out_.empty(); }
    size_t columns() const { return cols_.size(); }

   private:
    struct Hour {
        bool open = false;
        int64_t start = 0;
        AggBucket agg;
    };
    void collect(size_t col);
    void flushHour(size_t col);

    std::vector<SignalAccumulator> cols_;
    std::vector<Hour> hours_;
    std::vector<AggOut> out_;
    std::vector<AggBucket> tmpB_;
    std::vector<int64_t> tmpS_;
};

}  // namespace mat
