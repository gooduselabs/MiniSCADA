// Decides when a logging group writes a row (specs/003-data-logging research R5, R6). Pure: the
// caller passes both clocks and the current values; no thread, no I/O.
#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "core/historian/cell.hpp"
#include "core/historian/logging_config.hpp"

namespace mat {

struct LogRow {
    size_t group = 0;  // index in LoggingModel::groups
    int64_t tsUtc = 0;
    std::vector<Cell> cells;  // in the order of the group's columns
};

struct SamplerStats {
    uint64_t clockJumps = 0;
    uint64_t stringsTruncated = 0;
};

// Cuts `s` to at most `maxChars` Unicode characters without splitting a UTF-8 sequence.
std::string truncateUtf8(const std::string& s, size_t maxChars, bool& truncated);

// Value → cell of the column type; empty when the quality is not GOOD or the number is not finite.
Cell toCell(const TagValue& v, const LoggedColumn& col, SamplerStats& stats);

class GroupSampler {
   public:
    GroupSampler(const LoggingGroupModel& group, size_t groupIndex, int offsetMin);

    // One pass (every 100 ms). `values` are the current values of the group's columns. The wall
    // clock gives timestamps and alignment; the monotonic clock gives intervals and detects
    // wall-clock jumps (> 1 s difference between the two).
    std::optional<LogRow> tick(int64_t nowUtc, int64_t nowMono, const std::vector<TagValue>& values,
                               SamplerStats& stats);

   private:
    LogRow makeRow(int64_t nowUtc, const std::vector<TagValue>& values, SamplerStats& stats);
    bool changed(const std::vector<TagValue>& values);

    LoggingGroupModel g_;  // own copy: callers may pass a temporary
    size_t index_;
    int offsetMin_;
    bool started_ = false;
    int64_t lastUtc_ = 0;
    int64_t lastMono_ = 0;
    // cyclic
    int64_t anchor_ = 0;
    int64_t nextDue_ = 0;
    // onChange: changes are measured against the LOGGED cells (an empty cell = bad quality)
    bool pending_ = false;
    int64_t lastRowMono_ = 0;
    std::vector<uint64_t> seenRevision_;
    std::vector<Cell> logged_;
};

}  // namespace mat
