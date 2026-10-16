// CPU, memory, disk and uptime of the runtime and of the system for GET /api/v1/diagnostics
// (specs/005-device-online contracts/device-api.md §6, research R16, data-model §12, FR-032).
// Everything comes from /proc and statvfs: parsers of the text (pure, tested on sample files) and
// a sampler that keeps the last 13 samples, one every 5 s, for the 1-minute averages.
//
// CPU: systemPct1m is the busy share of all CPU time of the machine (busy = everything but idle and
// iowait; guest time is already in user), runtimePct1m the share of the same total used by this
// process (utime + stime); both over the oldest and the newest sample of the window, so a history
// shorter than a minute is averaged over what there is, and one sample or none gives 0. Memory,
// load, uptime and disk are the values of the latest sample. A file that cannot be read keeps the
// last good value; nothing throws.
//
// Feature 011 (FR-009): the peak RSS (VmHWM), the threads, the open descriptors (/proc/self/fd),
// write_bytes of /proc/self/io when the kernel has it (the BL335 kernel does not: ADR-039) and the
// CPU averaged over 5 minutes (61 samples). A value that cannot be read is nullopt, not 0.
//
// Thread-safe: the tick thread calls sample(), HTTP workers call snapshot().
#pragma once
#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>

namespace mat {

constexpr int kProcStatsWindow = 13;    // samples: 12 intervals of 5 s = one minute
constexpr int kProcStatsWindow5m = 61;  // 60 intervals of 5 s = five minutes
constexpr int64_t kProcStatsPeriodMs = 5000;

// Jiffies of the first line of /proc/stat. total = user + nice + system + idle + iowait + irq +
// softirq + steal; busy = total - idle - iowait.
struct CpuTimes {
    int64_t busy = 0;
    int64_t total = 0;
};
std::optional<CpuTimes> parseProcStat(std::string_view text);

// /proc/self/stat: ticks = utime + stime, startTicks = starttime (in clock ticks since boot). The
// name (field 2) may hold spaces and parentheses: fields are counted after its last ')'.
struct SelfStat {
    int64_t ticks = 0;
    int64_t startTicks = 0;
};
std::optional<SelfStat> parseSelfStat(std::string_view text);

std::optional<int64_t> parseVmRssBytes(std::string_view statusText);  // /proc/self/status
std::optional<int64_t> parseVmHwmBytes(std::string_view statusText);  // VmHWM: the peak RSS
std::optional<int64_t> parseThreads(std::string_view statusText);     // Threads:
std::optional<int64_t> parseIoWriteBytes(std::string_view ioText);    // /proc/self/io write_bytes

struct MemInfo {
    int64_t totalBytes = 0;
    int64_t availableBytes = 0;  // MemAvailable; MemFree + Buffers + Cached on an old kernel
};
std::optional<MemInfo> parseMeminfo(std::string_view text);

std::optional<double> parseLoadavg1(std::string_view text);  // /proc/loadavg
std::optional<double> parseUptimeS(std::string_view text);   // /proc/uptime

struct DiskSpace {
    int64_t totalBytes = 0;
    int64_t freeBytes = 0;  // available to the service user (f_bavail)
};

// What the sampler reads; tests replace it.
struct ProcSource {
    std::function<std::optional<std::string>(const std::string& path)> readFile;
    std::function<std::optional<DiskSpace>(const std::string& dir)> diskSpace;
    // Entries of a directory without . and .. (/proc/self/fd); nullopt: cannot be listed.
    std::function<std::optional<int64_t>(const std::string& dir)> countEntries;
    int cores = 1;
    int clkTck = 100;  // sysconf(_SC_CLK_TCK)
};
ProcSource systemProcSource();  // /proc, statvfs, sysconf

struct ProcSnapshot {
    bool sampled = false;  // sample() ran at least once
    double systemPct1m = 0;
    double runtimePct1m = 0;
    double loadAvg1 = 0;
    int cores = 1;
    int64_t runtimeRssBytes = 0;
    int64_t systemTotalBytes = 0;
    int64_t systemAvailableBytes = 0;
    double systemUptimeS = 0;
    double runtimeUptimeS = 0;
    // Feature 011 (FR-009)
    double systemPct5m = 0;
    double runtimePct5m = 0;
    int64_t runtimeRssPeakBytes = 0;
    std::optional<int64_t> threads;
    std::optional<int64_t> fdCount;       // the descriptor of /proc/self/fd itself is not counted
    std::optional<int64_t> ioWriteBytes;  // write_bytes of /proc/self/io; nullopt without it
    std::string diskPath;
    std::optional<DiskSpace> disk;  // nullopt: statvfs failed
};

class ProcStats {
   public:
    ProcStats(ProcSource source, std::string dataDir);

    // Reads /proc once and adds a sample to the window; the runtime calls it every
    // kProcStatsPeriodMs on its tick thread.
    void sample();
    ProcSnapshot snapshot() const;

   private:
    struct Point {
        CpuTimes system;
        int64_t runtimeTicks = 0;
    };
    ProcSource src_;
    std::string dataDir_;
    mutable std::mutex mu_;
    std::deque<Point> window_;
    ProcSnapshot last_;
};

}  // namespace mat
