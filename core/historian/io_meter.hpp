// Write bytes of the runtime process over the last 24 hours (specs/010-history-reports
// contracts/device-010.md §1): /proc/self/io write_bytes sampled once a minute into a ring of
// 1,440 cells. Not thread-safe: the historian thread feeds it and copies snapshot() into its status.
#pragma once
#include <cstdint>
#include <functional>
#include <optional>
#include <vector>

namespace mat {

struct IoSnapshot {
    bool available = true;  // false: /proc/self/io cannot be read; all numbers are 0 / null
    int64_t writeBytes1h = 0;
    int64_t writeBytes24h = 0;
    int64_t coverageS = 0;               // seconds of the last 24 h that have a measurement
    std::optional<int64_t> bytesPerDay;  // writeBytes24h * 86400 / coverageS; null below 600 s
};

class IoMeter {
   public:
    using Source = std::function<std::optional<int64_t>()>;
    // Empty source = write_bytes of /proc/self/io.
    explicit IoMeter(Source source = {});

    // Called every pass with the monotonic clock (ms); looks at the source every 60 s.
    void sample(int64_t nowMono);
    IoSnapshot snapshot() const;

   private:
    struct Cell {
        int64_t bytes = 0;
        int32_t seconds = 0;
    };
    Source source_;
    bool unavailable_ = false;
    bool haveBase_ = false;
    int64_t lastMono_ = 0;
    int64_t lastTry_ = 0;
    int64_t lastCounter_ = 0;
    std::vector<Cell> ring_;  // newest last, at most 1,440
};

// write_bytes of /proc/self/io, or nullopt.
std::optional<int64_t> readProcSelfIoWriteBytes();

}  // namespace mat
