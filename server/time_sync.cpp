#include "server/time_sync.hpp"

#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

#include <chrono>
#include <cstring>
#include <ctime>
#include <fstream>
#include <sstream>

namespace mat {

namespace {

constexpr const char* kTimesyncdFlag = "/run/systemd/timesync/synchronized";
constexpr const char* kTimedatectl = "/usr/bin/timedatectl";
constexpr const char* kChronyc = "/usr/bin/chronyc";
constexpr const char* kRtcHctosys = "/sys/class/rtc/rtc0/hctosys";
constexpr int kRunTimeoutMs = 2000;
constexpr size_t kRunMaxBytes = 16 * 1024;

std::string_view trim(std::string_view s) {
    while (!s.empty() &&
           (s.front() == ' ' || s.front() == '\t' || s.front() == '\n' || s.front() == '\r'))
        s.remove_prefix(1);
    while (!s.empty() &&
           (s.back() == ' ' || s.back() == '\t' || s.back() == '\n' || s.back() == '\r'))
        s.remove_suffix(1);
    return s;
}

int64_t steadyMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

// stdout of `argv` (absolute path, no shell, LC_ALL=C, stdin and stderr /dev/null) when it exits 0
// within the timeout; killed and nullopt otherwise.
std::optional<std::string> runReadOnly(const std::vector<std::string>& argv) {
    if (argv.empty() || ::access(argv[0].c_str(), X_OK) != 0) return std::nullopt;
    int out[2];
    if (::pipe2(out, O_CLOEXEC) != 0) return std::nullopt;
    posix_spawn_file_actions_t fa;
    posix_spawn_file_actions_init(&fa);
    posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0);
    posix_spawn_file_actions_adddup2(&fa, out[1], 1);
    posix_spawn_file_actions_addopen(&fa, 2, "/dev/null", O_WRONLY, 0);
    std::vector<char*> args;
    for (const auto& a : argv) args.push_back(const_cast<char*>(a.c_str()));
    args.push_back(nullptr);
    char lc[] = "LC_ALL=C";
    char path[] = "PATH=/usr/bin:/bin";
    char* env[] = {lc, path, nullptr};
    pid_t pid = -1;
    const int rc = posix_spawn(&pid, argv[0].c_str(), &fa, nullptr, args.data(), env);
    posix_spawn_file_actions_destroy(&fa);
    ::close(out[1]);
    if (rc != 0) {
        ::close(out[0]);
        return std::nullopt;
    }
    std::string text;
    const int64_t deadline = steadyMs() + kRunTimeoutMs;
    bool timedOut = false;
    for (;;) {
        const int64_t left = deadline - steadyMs();
        if (left <= 0) {
            timedOut = true;
            break;
        }
        pollfd p{out[0], POLLIN, 0};
        const int n = ::poll(&p, 1, static_cast<int>(left));
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) {
            timedOut = n == 0;
            break;
        }
        char buf[1024];
        const ssize_t r = ::read(out[0], buf, sizeof buf);
        if (r < 0 && errno == EINTR) continue;
        if (r <= 0) break;
        if (text.size() < kRunMaxBytes) text.append(buf, static_cast<size_t>(r));
    }
    ::close(out[0]);
    if (timedOut) ::kill(pid, SIGKILL);
    int status = 0;
    while (::waitpid(pid, &status, 0) < 0 && errno == EINTR) {
    }
    if (timedOut || !WIFEXITED(status) || WEXITSTATUS(status) != 0) return std::nullopt;
    return text;
}

}  // namespace

TimeSyncProbes systemTimeSyncProbes() {
    TimeSyncProbes p;
    p.run = runReadOnly;
    p.readFile = [](const std::string& path) -> std::optional<std::string> {
        std::ifstream in(path, std::ios::binary);
        if (!in) return std::nullopt;
        std::ostringstream s;
        s << in.rdbuf();
        return s.str().substr(0, 256);
    };
    p.exists = [](const std::string& path) { return ::access(path.c_str(), F_OK) == 0; };
    p.wallMs = [] {
        using namespace std::chrono;
        return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
    };
    return p;
}

std::optional<bool> parseTimedatectlNtp(std::string_view text) {
    std::string_view t = trim(text);
    constexpr std::string_view kKey = "NTPSynchronized=";
    if (t.compare(0, kKey.size(), kKey) == 0) t.remove_prefix(kKey.size());
    if (t == "yes") return true;
    if (t == "no") return false;
    return std::nullopt;
}

std::optional<bool> parseChronycTracking(std::string_view text) {
    size_t at = 0;
    while (at < text.size()) {
        size_t end = text.find('\n', at);
        if (end == std::string_view::npos) end = text.size();
        const std::string_view line = text.substr(at, end - at);
        at = end + 1;
        if (line.compare(0, 11, "Leap status") != 0) continue;
        const size_t colon = line.find(':');
        if (colon == std::string_view::npos) return std::nullopt;
        const std::string_view v = trim(line.substr(colon + 1));
        if (v.empty()) return std::nullopt;
        return v != "Not synchronised";
    }
    return std::nullopt;
}

int utcYear(int64_t wallMs) {
    const time_t s = static_cast<time_t>(wallMs >= 0 ? wallMs / 1000 : (wallMs - 999) / 1000);
    struct tm tm {};
    if (!::gmtime_r(&s, &tm)) return 0;
    return tm.tm_year + 1900;
}

TimeSyncStatus probeTimeSync(const TimeSyncProbes& probes) {
    TimeSyncStatus st;
    st.checkedAtMs = probes.wallMs ? probes.wallMs() : 0;
    const bool recentYear = utcYear(st.checkedAtMs) >= kTimeSyncMinYear;
    const auto done = [&st](bool synced, const char* source) {
        st.synced = synced;
        st.source = source;
        return st;
    };
    if (probes.exists && probes.exists(kTimesyncdFlag)) return done(true, "timesyncd");
    const char* ntpNo = nullptr;  // the source that said "not synchronised"
    if (probes.run) {
        if (const auto out = probes.run({kTimedatectl, "show", "-p", "NTPSynchronized", "--value"}))
            if (const auto v = parseTimedatectlNtp(*out)) {
                if (*v) return done(true, "timedatectl");
                ntpNo = "timedatectl";
            }
        if (!ntpNo)
            if (const auto out = probes.run({kChronyc, "-n", "tracking"}))
                if (const auto v = parseChronycTracking(*out)) {
                    if (*v) return done(true, "chronyc");
                    ntpNo = "chronyc";
                }
    }
    if (probes.readFile)
        if (const auto rtc = probes.readFile(kRtcHctosys))
            if (trim(*rtc) == "1" && recentYear) return done(true, "rtc");
    if (ntpNo) return done(false, ntpNo);
    return done(recentYear, "year");
}

TimeSync::TimeSync(TimeSyncProbes probes, SystemWarnings* warnings)
    : probes_(std::move(probes)), warnings_(warnings) {}

TimeSyncStatus TimeSync::refresh() {
    const TimeSyncStatus st = probeTimeSync(probes_);
    {
        std::lock_guard<std::mutex> l(mu_);
        last_ = st;
    }
    synced_ = st.synced;
    if (warnings_) {
        if (st.synced)
            warnings_->clear("TIME_NOT_SYNCED");
        else
            warnings_->set("TIME_NOT_SYNCED", nlohmann::json{{"source", st.source}});
    }
    return st;
}

TimeSyncStatus TimeSync::status() const {
    std::lock_guard<std::mutex> l(mu_);
    return last_;
}

}  // namespace mat
