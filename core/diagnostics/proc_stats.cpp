#include "core/diagnostics/proc_stats.hpp"

#include <dirent.h>
#include <sys/statvfs.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <utility>
#include <vector>

namespace mat {

namespace {

// Next whitespace-separated token of `s` from `pos` (advances `pos`); empty at the end.
std::string_view token(std::string_view s, size_t& pos) {
    while (pos < s.size() && (s[pos] == ' ' || s[pos] == '\t' || s[pos] == '\n')) ++pos;
    const size_t start = pos;
    while (pos < s.size() && s[pos] != ' ' && s[pos] != '\t' && s[pos] != '\n') ++pos;
    return s.substr(start, pos - start);
}

bool toInt(std::string_view t, int64_t& out) {
    if (t.empty() || t.size() > 18) return false;
    int64_t v = 0;
    for (char c : t) {
        if (c < '0' || c > '9') return false;
        v = v * 10 + (c - '0');
    }
    out = v;
    return true;
}

bool toDouble(std::string_view t, double& out) {
    if (t.empty() || t.size() > 32) return false;
    const std::string s(t);
    char* end = nullptr;
    errno = 0;
    const double v = std::strtod(s.c_str(), &end);
    if (end == s.c_str() || *end != '\0' || errno != 0 || !(v >= 0)) return false;
    out = v;
    return true;
}

// The number of a "Key: 123" line (/proc/self/status Threads, /proc/self/io write_bytes).
std::optional<int64_t> numberLine(std::string_view text, std::string_view key);

// The value of a "Key:   123 kB" line of /proc/meminfo or /proc/self/status, in bytes.
std::optional<int64_t> kbLine(std::string_view text, std::string_view key) {
    const auto kb = numberLine(text, key);
    if (!kb) return std::nullopt;
    return *kb * 1024;
}

std::optional<int64_t> numberLine(std::string_view text, std::string_view key) {
    size_t at = 0;
    while (at < text.size()) {
        size_t end = text.find('\n', at);
        if (end == std::string_view::npos) end = text.size();
        const std::string_view line = text.substr(at, end - at);
        at = end + 1;
        if (line.size() <= key.size() || line.compare(0, key.size(), key) != 0 ||
            line[key.size()] != ':')
            continue;
        size_t pos = key.size() + 1;
        int64_t n = 0;
        if (!toInt(token(line, pos), n)) return std::nullopt;
        return n;
    }
    return std::nullopt;
}

std::optional<std::string> readWholeFile(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::nullopt;
    std::ostringstream s;
    s << in.rdbuf();
    return s.str();
}

}  // namespace

std::optional<CpuTimes> parseProcStat(std::string_view text) {
    size_t pos = 0;
    if (token(text, pos) != "cpu") return std::nullopt;
    int64_t v[8] = {};
    for (int i = 0; i < 8; ++i)
        if (!toInt(token(text, pos), v[i])) return std::nullopt;
    CpuTimes t;
    for (int64_t x : v) t.total += x;
    t.busy = t.total - v[3] - v[4];  // idle, iowait
    return t;
}

std::optional<SelfStat> parseSelfStat(std::string_view text) {
    const size_t close = text.rfind(')');
    if (close == std::string_view::npos) return std::nullopt;
    size_t pos = close + 1;
    // Fields after the name: state is field 3, utime 14, stime 15, starttime 22.
    int64_t utime = 0, stime = 0, start = 0;
    for (int field = 3; field <= 22; ++field) {
        const std::string_view t = token(text, pos);
        if (t.empty()) return std::nullopt;
        if (field == 14 && !toInt(t, utime)) return std::nullopt;
        if (field == 15 && !toInt(t, stime)) return std::nullopt;
        if (field == 22 && !toInt(t, start)) return std::nullopt;
    }
    return SelfStat{utime + stime, start};
}

std::optional<int64_t> parseVmRssBytes(std::string_view statusText) {
    return kbLine(statusText, "VmRSS");
}

std::optional<int64_t> parseVmHwmBytes(std::string_view statusText) {
    return kbLine(statusText, "VmHWM");
}

std::optional<int64_t> parseThreads(std::string_view statusText) {
    return numberLine(statusText, "Threads");
}

std::optional<int64_t> parseIoWriteBytes(std::string_view ioText) {
    return numberLine(ioText, "write_bytes");
}

std::optional<MemInfo> parseMeminfo(std::string_view text) {
    const auto total = kbLine(text, "MemTotal");
    if (!total) return std::nullopt;
    MemInfo m;
    m.totalBytes = *total;
    if (const auto avail = kbLine(text, "MemAvailable")) {
        m.availableBytes = *avail;
    } else {
        const auto free = kbLine(text, "MemFree");
        if (!free) return std::nullopt;
        m.availableBytes =
            *free + kbLine(text, "Buffers").value_or(0) + kbLine(text, "Cached").value_or(0);
    }
    return m;
}

std::optional<double> parseLoadavg1(std::string_view text) {
    size_t pos = 0;
    double v = 0;
    if (!toDouble(token(text, pos), v)) return std::nullopt;
    return v;
}

std::optional<double> parseUptimeS(std::string_view text) {
    size_t pos = 0;
    double v = 0;
    if (!toDouble(token(text, pos), v)) return std::nullopt;
    return v;
}

ProcSource systemProcSource() {
    ProcSource s;
    s.readFile = readWholeFile;
    s.diskSpace = [](const std::string& dir) -> std::optional<DiskSpace> {
        struct statvfs v {};
        if (::statvfs(dir.c_str(), &v) != 0) return std::nullopt;
        const auto frsize = static_cast<int64_t>(v.f_frsize ? v.f_frsize : v.f_bsize);
        return DiskSpace{static_cast<int64_t>(v.f_blocks) * frsize,
                         static_cast<int64_t>(v.f_bavail) * frsize};
    };
    s.countEntries = [](const std::string& dir) -> std::optional<int64_t> {
        DIR* d = ::opendir(dir.c_str());
        if (!d) return std::nullopt;
        int64_t n = 0;
        while (const dirent* e = ::readdir(d))
            if (std::strcmp(e->d_name, ".") != 0 && std::strcmp(e->d_name, "..") != 0) ++n;
        ::closedir(d);
        return n;
    };
    const long cores = ::sysconf(_SC_NPROCESSORS_ONLN);
    s.cores = cores > 0 ? static_cast<int>(cores) : 1;
    const long hz = ::sysconf(_SC_CLK_TCK);
    s.clkTck = hz > 0 ? static_cast<int>(hz) : 100;
    return s;
}

ProcStats::ProcStats(ProcSource source, std::string dataDir)
    : src_(std::move(source)), dataDir_(std::move(dataDir)) {
    last_.cores = src_.cores > 0 ? src_.cores : 1;
    last_.diskPath = dataDir_;
}

void ProcStats::sample() {
    // Read outside the lock: HTTP workers wait on snapshot() only for the copy.
    const auto read = [this](const char* path) -> std::optional<std::string> {
        return src_.readFile ? src_.readFile(path) : std::nullopt;
    };
    const auto stat = read("/proc/stat");
    const auto self = read("/proc/self/stat");
    const auto status = read("/proc/self/status");
    const auto mem = read("/proc/meminfo");
    const auto load = read("/proc/loadavg");
    const auto up = read("/proc/uptime");
    const auto io = read("/proc/self/io");
    // The listing opens a descriptor of its own, which it lists too.
    std::optional<int64_t> fds =
        src_.countEntries ? src_.countEntries("/proc/self/fd") : std::nullopt;
    if (fds) fds = std::max<int64_t>(0, *fds - 1);
    const std::optional<DiskSpace> disk = src_.diskSpace ? src_.diskSpace(dataDir_) : std::nullopt;

    const auto cpu = stat ? parseProcStat(*stat) : std::nullopt;
    const auto selfStat = self ? parseSelfStat(*self) : std::nullopt;

    std::lock_guard<std::mutex> l(mu_);
    last_.sampled = true;
    last_.disk = disk;
    if (cpu && selfStat) {
        window_.push_back({*cpu, selfStat->ticks});
        while (window_.size() > static_cast<size_t>(kProcStatsWindow5m)) window_.pop_front();
        // Over the oldest and the newest sample of the last `n` (fewer when there are fewer).
        const auto average = [this](size_t n, double& system, double& runtime) {
            if (window_.size() < 2) return;
            const Point& a = window_[window_.size() - std::min(n, window_.size())];
            const Point& b = window_.back();
            const double dTotal = static_cast<double>(b.system.total - a.system.total);
            if (dTotal <= 0) return;
            const auto pct = [dTotal](int64_t d) {
                return std::clamp(100.0 * static_cast<double>(d) / dTotal, 0.0, 100.0);
            };
            system = pct(b.system.busy - a.system.busy);
            runtime = pct(b.runtimeTicks - a.runtimeTicks);
        };
        average(kProcStatsWindow, last_.systemPct1m, last_.runtimePct1m);
        average(kProcStatsWindow5m, last_.systemPct5m, last_.runtimePct5m);
    }
    if (const auto rss = status ? parseVmRssBytes(*status) : std::nullopt)
        last_.runtimeRssBytes = *rss;
    if (const auto hwm = status ? parseVmHwmBytes(*status) : std::nullopt)
        last_.runtimeRssPeakBytes = *hwm;
    last_.threads = status ? parseThreads(*status) : std::nullopt;
    last_.fdCount = fds;
    last_.ioWriteBytes = io ? parseIoWriteBytes(*io) : std::nullopt;
    if (const auto m = mem ? parseMeminfo(*mem) : std::nullopt) {
        last_.systemTotalBytes = m->totalBytes;
        last_.systemAvailableBytes = m->availableBytes;
    }
    if (const auto v = load ? parseLoadavg1(*load) : std::nullopt) last_.loadAvg1 = *v;
    if (const auto u = up ? parseUptimeS(*up) : std::nullopt) {
        last_.systemUptimeS = *u;
        if (selfStat && src_.clkTck > 0)
            last_.runtimeUptimeS = std::max(0.0, *u - static_cast<double>(selfStat->startTicks) /
                                                          static_cast<double>(src_.clkTck));
    }
}

ProcSnapshot ProcStats::snapshot() const {
    std::lock_guard<std::mutex> l(mu_);
    return last_;
}

}  // namespace mat
