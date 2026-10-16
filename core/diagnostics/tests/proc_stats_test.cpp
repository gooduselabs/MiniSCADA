// T141 (feature 005, US4; contracts/device-api.md §6, research R16, data-model §12): CPU, memory,
// disk and uptime of the runtime and of the system from /proc text, on sample files (no real /proc
// is read): parsers, the window of 13 samples 5 s apart for the 1-minute average (a shorter
// history is averaged over what there is), statvfs injected.
#include "core/diagnostics/proc_stats.hpp"

#include <gtest/gtest.h>

#include <map>
#include <string>

using namespace mat;

namespace {

// /proc/stat of a 2-core machine: cpu line = user nice system idle iowait irq softirq steal guest
// guest_nice (guest is already inside user and must not be counted twice).
const char* kStat =
    "cpu  4705 150 1120 42000 300 20 40 5 1000 0\n"
    "cpu0 2300 70 560 21000 150 10 20 2 500 0\n"
    "cpu1 2405 80 560 21000 150 10 20 3 500 0\n"
    "intr 123456 0 0\n"
    "ctxt 98765\n";

// /proc/self/stat: the name (field 2) may hold spaces and ')'.
const char* kSelfStat =
    "812 (mat run) time) S 1 812 812 0 -1 4194560 3211 0 0 0 250 70 0 0 20 0 9 0 5000 51310592 "
    "2418 4294967295 1 1 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0\n";

const char* kStatus =
    "Name:\tmat-runtime\nUmask:\t0077\nState:\tS (sleeping)\nVmPeak:\t   52000 kB\n"
    "VmRSS:\t    9668 kB\nRssAnon:\t    4000 kB\nThreads:\t9\n";

const char* kMeminfo =
    "MemTotal:        1016832 kB\nMemFree:          300000 kB\nMemAvailable:     887808 kB\n"
    "Buffers:           20000 kB\nCached:           500000 kB\n";

const char* kLoadavg = "0.42 0.35 0.30 1/142 9812\n";
const char* kUptime = "123456.78 98765.43\n";

// A fake /proc and a fake statvfs.
struct Fake {
    std::map<std::string, std::string> files;
    std::optional<DiskSpace> disk = DiskSpace{7301234688LL, 6512341504LL};
    ProcSource source() {
        ProcSource s;
        s.readFile = [this](const std::string& path) -> std::optional<std::string> {
            const auto it = files.find(path);
            if (it == files.end()) return std::nullopt;
            return it->second;
        };
        s.diskSpace = [this](const std::string&) { return disk; };
        s.cores = 2;
        s.clkTck = 100;
        return s;
    }
};

std::string statText(int64_t total, int64_t busy) {
    // user = busy, idle = the rest; nothing else, so busy/total is exact.
    return "cpu  " + std::to_string(busy) + " 0 0 " + std::to_string(total - busy) +
           " 0 0 0 0 0 0\n";
}

std::string selfStatText(int64_t ticks, int64_t start = 5000) {
    return "812 (mat-runtime) S 1 812 812 0 -1 4194560 3211 0 0 0 " + std::to_string(ticks) +
           " 0 0 0 20 0 9 0 " + std::to_string(start) + " 51310592 2418\n";
}

void feed(Fake& f, int64_t total, int64_t busy, int64_t runtimeTicks) {
    f.files["/proc/stat"] = statText(total, busy);
    f.files["/proc/self/stat"] = selfStatText(runtimeTicks);
}

}  // namespace

TEST(ProcStatsParse, SystemCpuLineSumsEightFieldsAndLeavesGuestOut) {
    const auto t = parseProcStat(kStat);
    ASSERT_TRUE(t.has_value());
    EXPECT_EQ(t->total, 4705 + 150 + 1120 + 42000 + 300 + 20 + 40 + 5);
    EXPECT_EQ(t->busy, t->total - 42000 - 300);  // idle and iowait are not busy time
}

TEST(ProcStatsParse, SelfStatSurvivesAClosingParenthesisInTheName) {
    const auto s = parseSelfStat(kSelfStat);
    ASSERT_TRUE(s.has_value());
    EXPECT_EQ(s->ticks, 250 + 70);  // utime + stime
    EXPECT_EQ(s->startTicks, 5000);
}

TEST(ProcStatsParse, StatusMeminfoLoadavgUptime) {
    EXPECT_EQ(parseVmRssBytes(kStatus), 9668LL * 1024);
    const auto m = parseMeminfo(kMeminfo);
    ASSERT_TRUE(m.has_value());
    EXPECT_EQ(m->totalBytes, 1016832LL * 1024);
    EXPECT_EQ(m->availableBytes, 887808LL * 1024);
    EXPECT_DOUBLE_EQ(*parseLoadavg1(kLoadavg), 0.42);
    EXPECT_DOUBLE_EQ(*parseUptimeS(kUptime), 123456.78);
}

TEST(ProcStatsParse, MissingMemAvailableFallsBackToFreePlusBuffersAndCache) {
    const auto m =
        parseMeminfo("MemTotal: 1000 kB\nMemFree: 300 kB\nBuffers: 20 kB\nCached: 80 kB\n");
    ASSERT_TRUE(m.has_value());
    EXPECT_EQ(m->availableBytes, (300 + 20 + 80) * 1024LL);
}

TEST(ProcStatsParse, GarbageGivesNothingAndNeverThrows) {
    for (const char* bad : {"", "cpu", "cpu  a b c", "\n\n", "VmRSS: x kB"}) {
        EXPECT_FALSE(parseProcStat(bad).has_value()) << bad;
        EXPECT_FALSE(parseSelfStat(bad).has_value()) << bad;
        EXPECT_FALSE(parseVmRssBytes(bad).has_value()) << bad;
        EXPECT_FALSE(parseMeminfo(bad).has_value()) << bad;
        EXPECT_FALSE(parseLoadavg1(bad).has_value()) << bad;
        EXPECT_FALSE(parseUptimeS(bad).has_value()) << bad;
    }
}

TEST(ProcStats, OneSampleOrNoneGivesZeroPercentAndNoInvention) {
    Fake f;
    ProcStats s(f.source(), "/var/lib/mat-runtime");
    EXPECT_FALSE(s.snapshot().sampled);
    feed(f, 10000, 1000, 100);
    s.sample();
    const ProcSnapshot snap = s.snapshot();
    EXPECT_TRUE(snap.sampled);
    EXPECT_EQ(snap.systemPct1m, 0.0);  // nothing to measure over yet
    EXPECT_EQ(snap.runtimePct1m, 0.0);
    EXPECT_EQ(snap.cores, 2);
}

TEST(ProcStats, ThirteenSamplesGiveTheMinuteAverageAndAShorterHistoryTheRangeThere) {
    Fake f;
    ProcStats s(f.source(), "/d");
    // Each 5 s: 2 cores × 100 ticks/s × 5 s = 1000 ticks; the system is busy 100 of them (10 %),
    // the runtime uses 30 ticks (3 % of all ticks).
    int64_t total = 100000, busy = 10000, rt = 500;
    for (int i = 0; i < 3; ++i) {  // three samples: two intervals
        feed(f, total, busy, rt);
        s.sample();
        total += 1000;
        busy += 100;
        rt += 30;
    }
    ProcSnapshot snap = s.snapshot();
    EXPECT_NEAR(snap.systemPct1m, 10.0, 1e-9);
    EXPECT_NEAR(snap.runtimePct1m, 3.0, 1e-9);
    // Thirteen samples (twelve intervals = 60 s) at 10 % / 3 %, then the load rises to 50 % / 20 %.
    for (int i = 3; i < 13; ++i) {
        feed(f, total, busy, rt);
        s.sample();
        total += 1000;
        busy += 100;
        rt += 30;
    }
    EXPECT_NEAR(s.snapshot().systemPct1m, 10.0, 1e-9);
    for (int i = 0; i < 12;
         ++i) {  // twelve more samples at 50 %: the old ones have left the window
        feed(f, total, busy, rt);
        s.sample();
        total += 1000;
        busy += 500;
        rt += 200;
    }
    feed(f, total, busy, rt);
    s.sample();
    snap = s.snapshot();
    EXPECT_NEAR(snap.systemPct1m, 50.0, 1e-9);
    EXPECT_NEAR(snap.runtimePct1m, 20.0, 1e-9);
}

TEST(ProcStats, WindowKeepsExactlyThirteenSamples) {
    EXPECT_EQ(kProcStatsWindow, 13);
    EXPECT_EQ(kProcStatsPeriodMs, 5000);
}

TEST(ProcStats, MemoryUptimeLoadAndDiskComeFromTheLatestSample) {
    Fake f;
    f.files["/proc/stat"] = kStat;
    f.files["/proc/self/stat"] = kSelfStat;
    f.files["/proc/self/status"] = kStatus;
    f.files["/proc/meminfo"] = kMeminfo;
    f.files["/proc/loadavg"] = kLoadavg;
    f.files["/proc/uptime"] = kUptime;
    ProcStats s(f.source(), "/var/lib/mat-runtime");
    s.sample();
    const ProcSnapshot snap = s.snapshot();
    EXPECT_EQ(snap.runtimeRssBytes, 9668LL * 1024);
    EXPECT_EQ(snap.systemTotalBytes, 1016832LL * 1024);
    EXPECT_EQ(snap.systemAvailableBytes, 887808LL * 1024);
    EXPECT_DOUBLE_EQ(snap.loadAvg1, 0.42);
    EXPECT_NEAR(snap.systemUptimeS, 123456.78, 1e-6);
    // The runtime started 5000 ticks (50 s at 100 Hz) after boot.
    EXPECT_NEAR(snap.runtimeUptimeS, 123456.78 - 50.0, 1e-6);
    ASSERT_TRUE(snap.disk.has_value());
    EXPECT_EQ(snap.disk->totalBytes, 7301234688LL);
    EXPECT_EQ(snap.disk->freeBytes, 6512341504LL);
    EXPECT_EQ(snap.diskPath, "/var/lib/mat-runtime");
}

// ---------- feature 011 (FR-009): peak RSS, threads, descriptors, write_bytes, CPU over 5 min ----

TEST(ProcStatsParse, PeakRssThreadsAndWriteBytes) {
    const char* status =
        "Name:\tmat-runtime\nVmPeak:\t   52000 kB\nVmHWM:\t   12288 kB\nVmRSS:\t    9668 kB\n"
        "Threads:\t31\n";
    EXPECT_EQ(parseVmHwmBytes(status), 12288LL * 1024);
    EXPECT_EQ(parseThreads(status), 31);
    const char* io =
        "rchar: 1000\nwchar: 2000\nsyscr: 3\nsyscw: 4\nread_bytes: 4096\nwrite_bytes: 183500000\n"
        "cancelled_write_bytes: 0\n";
    EXPECT_EQ(parseIoWriteBytes(io), 183500000);
    for (const char* bad : {"", "Threads: x\n", "write_bytes:\n", "VmHWM: kB\n"}) {
        EXPECT_FALSE(parseVmHwmBytes(bad).has_value()) << bad;
        EXPECT_FALSE(parseThreads(bad).has_value()) << bad;
        EXPECT_FALSE(parseIoWriteBytes(bad).has_value()) << bad;
    }
}

TEST(ProcStats, ThePeakTheThreadsTheDescriptorsAndWriteBytesAreInTheSnapshot) {
    Fake f;
    f.files["/proc/stat"] = kStat;
    f.files["/proc/self/stat"] = kSelfStat;
    f.files["/proc/self/status"] = "VmHWM:\t   50073 kB\nVmRSS:\t   42188 kB\nThreads:\t31\n";
    f.files["/proc/self/io"] = "read_bytes: 0\nwrite_bytes: 4096\n";
    std::string listed;
    ProcSource src = f.source();
    src.countEntries = [&listed](const std::string& dir) -> std::optional<int64_t> {
        listed = dir;
        return 64;  // the descriptor of the listing itself is one of them
    };
    ProcStats s(src, "/d");
    s.sample();
    const ProcSnapshot snap = s.snapshot();
    EXPECT_EQ(listed, "/proc/self/fd");
    EXPECT_EQ(snap.fdCount, 63);
    EXPECT_EQ(snap.threads, 31);
    EXPECT_EQ(snap.runtimeRssPeakBytes, 50073LL * 1024);
    EXPECT_EQ(snap.ioWriteBytes, 4096);
}

TEST(ProcStats, WithoutProcSelfIoOrTheFdListTheyAreUnknownNotZero) {
    Fake f;  // no /proc/self/io (the BL335 kernel), no countEntries
    f.files["/proc/self/status"] = "VmRSS:\t 100 kB\n";
    ProcStats s(f.source(), "/d");
    s.sample();
    const ProcSnapshot snap = s.snapshot();
    EXPECT_FALSE(snap.ioWriteBytes.has_value());
    EXPECT_FALSE(snap.fdCount.has_value());
    EXPECT_FALSE(snap.threads.has_value());
}

TEST(ProcStats, FiveMinuteAverageOverSixtyOneSamples) {
    EXPECT_EQ(kProcStatsWindow5m, 61);
    Fake f;
    ProcStats s(f.source(), "/d");
    int64_t total = 100000, busy = 0, rt = 0;
    // Intervals 0..47 (4 min) at 10 % / 2 %, then 48..59 (1 min) at 60 % / 12 %.
    for (int i = 0; i <= 60; ++i) {
        feed(f, total, busy, rt);
        s.sample();
        total += 1000;
        busy += i < 48 ? 100 : 600;
        rt += i < 48 ? 20 : 120;
    }
    ProcSnapshot snap = s.snapshot();
    EXPECT_NEAR(snap.systemPct5m, (48 * 10.0 + 12 * 60.0) / 60, 1e-9);
    EXPECT_NEAR(snap.runtimePct5m, (48 * 2.0 + 12 * 12.0) / 60, 1e-9);
    EXPECT_NEAR(snap.systemPct1m, 60.0, 1e-9);  // the minute is still the last 12 intervals
    // One more interval at 60 %: the first one (10 %) leaves the 5-minute window.
    feed(f, total, busy, rt);
    s.sample();
    snap = s.snapshot();
    EXPECT_NEAR(snap.systemPct5m, (47 * 10.0 + 13 * 60.0) / 60, 1e-9);
}

TEST(ProcStats, StatvfsIsInjectedAndAFailureLeavesNoDiskBlock) {
    Fake f;
    f.disk = std::nullopt;
    ProcStats s(f.source(), "/d");
    feed(f, 1000, 100, 10);
    s.sample();
    EXPECT_FALSE(s.snapshot().disk.has_value());
    f.disk = DiskSpace{100, 40};
    s.sample();
    ASSERT_TRUE(s.snapshot().disk.has_value());
    EXPECT_EQ(s.snapshot().disk->freeBytes, 40);
}

TEST(ProcStats, UnreadableFilesKeepEarlierValuesAndNeverThrow) {
    Fake f;
    f.files["/proc/self/status"] = kStatus;
    f.files["/proc/meminfo"] = kMeminfo;
    ProcStats s(f.source(), "/d");
    s.sample();
    EXPECT_EQ(s.snapshot().runtimeRssBytes, 9668LL * 1024);
    f.files.clear();
    EXPECT_NO_THROW(s.sample());
    EXPECT_EQ(s.snapshot().runtimeRssBytes, 9668LL * 1024);  // the last good value stays
    EXPECT_EQ(s.snapshot().systemPct1m, 0.0);
}

TEST(ProcStats, RealSystemSourceReadsTheRunningProcess) {
    ProcStats s(systemProcSource(), "/");
    s.sample();
    const ProcSnapshot snap = s.snapshot();
    EXPECT_GT(snap.runtimeRssBytes, 0);
    EXPECT_GT(snap.systemTotalBytes, 0);
    EXPECT_GE(snap.cores, 1);
    ASSERT_TRUE(snap.disk.has_value());
    EXPECT_GT(snap.disk->totalBytes, 0);
}
