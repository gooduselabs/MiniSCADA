// T140 (feature 011; FR-089, research R23, contracts/device-api-011.md §5): the clock check of
// server/time_sync with every probe injected: the order of the sources, the parsers of timedatectl
// and chronyc, the RTC flag, the year fallback, and the warning TIME_NOT_SYNCED raised and cleared.
// Nothing of the real system is read.
#include "server/time_sync.hpp"

#include <gtest/gtest.h>

#include <map>
#include <string>
#include <vector>

using namespace mat;

namespace {

constexpr int64_t k2026 = 1792195200000LL;  // 2026-10-17 UTC
constexpr int64_t k2025 = 1760659200000LL;  // 2025-10-17 UTC
constexpr int64_t k1970 = 3600000LL;        // a board without RTC battery, just booted

const char* kChronySynced =
    "Reference ID    : C0A80101 (192.168.1.1)\n"
    "Stratum         : 3\n"
    "Ref time (UTC)  : Sat Oct 17 03:12:00 2026\n"
    "System time     : 0.000012345 seconds fast of NTP time\n"
    "Leap status     : Normal\n";
const char* kChronyNot =
    "Reference ID    : 00000000 ()\n"
    "Stratum         : 0\n"
    "Leap status     : Not synchronised\n";

struct Fake {
    std::map<std::string, std::string> files;     // readFile + exists
    std::map<std::string, std::string> programs;  // argv[0] -> stdout
    std::vector<std::vector<std::string>> ran;
    int64_t wall = k2026;
    TimeSyncProbes probes() {
        TimeSyncProbes p;
        p.run = [this](const std::vector<std::string>& argv) -> std::optional<std::string> {
            ran.push_back(argv);
            auto it = programs.find(argv.at(0));
            if (it == programs.end()) return std::nullopt;
            return it->second;
        };
        p.readFile = [this](const std::string& path) -> std::optional<std::string> {
            auto it = files.find(path);
            if (it == files.end()) return std::nullopt;
            return it->second;
        };
        p.exists = [this](const std::string& path) { return files.count(path) > 0; };
        p.wallMs = [this] { return wall; };
        return p;
    }
};

const std::string kTimedatectl = "/usr/bin/timedatectl";
const std::string kChronyc = "/usr/bin/chronyc";

}  // namespace

TEST(TimeSyncParse, TimedatectlAndChronyc) {
    EXPECT_EQ(parseTimedatectlNtp("yes\n"), true);
    EXPECT_EQ(parseTimedatectlNtp("no\n"), false);
    EXPECT_EQ(parseTimedatectlNtp("NTPSynchronized=yes\n"), true);
    EXPECT_EQ(parseTimedatectlNtp("NTPSynchronized=no"), false);
    EXPECT_FALSE(parseTimedatectlNtp("").has_value());
    EXPECT_FALSE(parseTimedatectlNtp("Failed to connect to bus").has_value());
    EXPECT_EQ(parseChronycTracking(kChronySynced), true);
    EXPECT_EQ(parseChronycTracking(kChronyNot), false);
    EXPECT_EQ(parseChronycTracking("Leap status     : Insert second\n"), true);
    EXPECT_FALSE(parseChronycTracking("506 Cannot talk to daemon\n").has_value());
    EXPECT_EQ(utcYear(k2026), 2026);
    EXPECT_EQ(utcYear(k2025), 2025);
    EXPECT_EQ(utcYear(k1970), 1970);
}

TEST(TimeSync, TheTimesyncdFlagDecidesFirstAndNoProgramRuns) {
    Fake f;
    f.files["/run/systemd/timesync/synchronized"] = "";
    const TimeSyncStatus s = probeTimeSync(f.probes());
    EXPECT_TRUE(s.synced);
    EXPECT_EQ(s.source, "timesyncd");
    EXPECT_TRUE(f.ran.empty());
}

TEST(TimeSync, TimedatectlThenChronycWithReadOnlyArguments) {
    Fake f;
    f.programs[kTimedatectl] = "yes\n";
    TimeSyncStatus s = probeTimeSync(f.probes());
    EXPECT_TRUE(s.synced);
    EXPECT_EQ(s.source, "timedatectl");
    ASSERT_EQ(f.ran.size(), 1u);
    EXPECT_EQ(f.ran[0],
              (std::vector<std::string>{kTimedatectl, "show", "-p", "NTPSynchronized", "--value"}));
    Fake g;  // no timedatectl: chronyc
    g.programs[kChronyc] = kChronySynced;
    s = probeTimeSync(g.probes());
    EXPECT_TRUE(s.synced);
    EXPECT_EQ(s.source, "chronyc");
    ASSERT_EQ(g.ran.size(), 2u);
    EXPECT_EQ(g.ran[1], (std::vector<std::string>{kChronyc, "-n", "tracking"}));
}

TEST(TimeSync, NtpSaysNoButTheRtcSetTheClockIn2026) {
    Fake f;  // a site without NTP, the RTC battery kept the time
    f.programs[kTimedatectl] = "no\n";
    f.files["/sys/class/rtc/rtc0/hctosys"] = "1\n";
    TimeSyncStatus s = probeTimeSync(f.probes());
    EXPECT_TRUE(s.synced);
    EXPECT_EQ(s.source, "rtc");
    f.wall = k2025;  // the RTC holds a time before 2026: not trusted
    s = probeTimeSync(f.probes());
    EXPECT_FALSE(s.synced);
    EXPECT_EQ(s.source, "timedatectl");
    f.files["/sys/class/rtc/rtc0/hctosys"] = "0\n";  // the clock did not come from the RTC
    f.wall = k2026;
    s = probeTimeSync(f.probes());
    EXPECT_FALSE(s.synced);
    EXPECT_EQ(s.source, "timedatectl");
}

TEST(TimeSync, ChronycNotSynchronisedIsNotSynced) {
    Fake f;
    f.programs[kChronyc] = kChronyNot;
    const TimeSyncStatus s = probeTimeSync(f.probes());
    EXPECT_FALSE(s.synced);
    EXPECT_EQ(s.source, "chronyc");
}

TEST(TimeSync, NothingReadableFallsBackToTheYear) {
    Fake f;
    TimeSyncStatus s = probeTimeSync(f.probes());
    EXPECT_TRUE(s.synced);
    EXPECT_EQ(s.source, "year");
    EXPECT_EQ(s.checkedAtMs, k2026);
    f.wall = k1970;
    s = probeTimeSync(f.probes());
    EXPECT_FALSE(s.synced);
    EXPECT_EQ(s.source, "year");
}

TEST(TimeSync, RaisesAndClearsTimeNotSynced) {
    Fake f;
    f.wall = k1970;
    SystemWarnings w([] { return int64_t{5}; });
    TimeSync ts(f.probes(), &w);
    EXPECT_FALSE(ts.synced());  // nothing checked yet
    ts.refresh();
    EXPECT_FALSE(ts.synced());
    auto list = w.list();
    ASSERT_EQ(list.size(), 1u);
    EXPECT_EQ(list[0].code, "TIME_NOT_SYNCED");
    EXPECT_EQ(list[0].detail["source"], "year");
    f.programs[kTimedatectl] = "yes\n";
    ts.refresh();
    EXPECT_TRUE(ts.synced());
    EXPECT_EQ(ts.status().source, "timedatectl");
    EXPECT_TRUE(w.list().empty());
    TimeSync quiet(f.probes(), nullptr);  // no warnings object: still answers
    EXPECT_TRUE(quiet.refresh().synced);
}
