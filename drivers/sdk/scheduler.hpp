// Read schedule of one channel (FR-017, contracts/modbus-driver.md §5, research R7). Pure, driven
// by the caller's clock (milliseconds on a monotonic clock); one thread uses it.
//
// A "round" belongs to a (field device, scan group) and is a list of read blocks. Round k is due at
// t0 + k x period. Work is chosen in this order: a pending write, then the block with the earliest
// deadline (the due time of its round). A round that is late is not made up: when it ends later
// than one period after its due time, the missed rounds are skipped and counted (`overruns`).
// A suspended field device is only asked one probe block every 10 s.
#pragma once
#include <cstdint>
#include <deque>
#include <optional>
#include <vector>

namespace mat::drv {

class Scheduler {
   public:
    enum class Kind { Write, Read, Probe };
    struct Job {
        Kind kind = Kind::Read;
        uint32_t device = 0;
        int group = 0;     // scan group index (fast 0, normal 1, slow 2)
        size_t block = 0;  // block index in the round
        int64_t dueMs = 0;
    };
    struct GroupStats {
        int64_t periodMs = 0;
        double actualAvgMs = 0;  // between two round starts, last 60 s
        int64_t actualMaxMs = 0;
        uint64_t overruns = 0;
        bool overloaded = false;  // average > 110 % of the set period
    };

    static constexpr int64_t kProbeEveryMs = 10000;

    void addRound(uint32_t device, int group, int64_t periodMs, size_t blocks);
    void setRequestGapMs(int64_t gapMs) { gapMs_ = gapMs; }
    void start(int64_t nowMs);  // t0 of every round
    void setSuspended(uint32_t device, bool suspended, int64_t nowMs);

    // The next job, or nullopt with *waitUntilMs set to when to ask again (-1: never, nothing to
    // do). `writePending`: the write queue is not empty.
    std::optional<Job> next(int64_t nowMs, bool writePending, int64_t* waitUntilMs = nullptr);
    // The request of `job` ended (response, timeout or error) at nowMs.
    void complete(const Job& job, int64_t nowMs);

    GroupStats stats(uint32_t device, int group, int64_t nowMs) const;
    // Replaces the number of blocks of a round (after a split).
    void setBlocks(uint32_t device, int group, size_t blocks);

   private:
    struct Round {
        uint32_t device = 0;
        int group = 0;
        int64_t periodMs = 0;
        size_t blocks = 0;
        int64_t t0 = 0;
        int64_t k = 0;         // index of the current or next round
        size_t nextBlock = 0;  // next block of the running round
        bool running = false;
        int64_t lastStart = -1;  // start of the previous round
        uint64_t overruns = 0;
        std::deque<std::pair<int64_t, int64_t>>
            intervals;  // (start time, interval since the previous start)
        int64_t dueMs() const { return t0 + k * periodMs; }
    };
    struct Suspended {
        bool on = false;
        int64_t nextProbe = 0;
    };

    Round* find(uint32_t device, int group);
    const Round* find(uint32_t device, int group) const;
    Suspended& susp(uint32_t device);
    void prune(Round& r, int64_t nowMs) const;

    std::vector<Round> rounds_;
    std::vector<Suspended> suspended_;
    int64_t gapMs_ = 0;
    int64_t lastEnd_ = INT64_MIN / 2;
    bool probeRunning_ = false;
};

}  // namespace mat::drv
