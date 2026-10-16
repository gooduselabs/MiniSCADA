// T028 (feature 011, US2; FR-009, FR-045, contracts/device-api-011.md §5): the parts of the new
// keys of GET /api/v1/diagnostics that do not need HTTP: the eMMC wear from a fake sysfs, the bytes
// written today reset at the local midnight of tzOffsetMin, the record of the restarts and their
// reasons, the p95 of the live lag over five minutes.
#include <gtest/gtest.h>
#include <stdlib.h>
#include <sys/stat.h>

#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#include "core/diagnostics/daily_writes.hpp"
#include "core/diagnostics/emmc_life.hpp"
#include "core/diagnostics/run_record.hpp"
#include "core/session-manager/live_lag.hpp"
#include "nlohmann/json.hpp"

using namespace mat;
namespace fs = std::filesystem;

namespace {

struct FakeSysfs {
    std::map<std::string, std::string> files;
    std::map<std::string, std::vector<std::string>> dirs;
    SysfsReader reader() {
        SysfsReader r;
        r.readFile = [this](const std::string& p) -> std::optional<std::string> {
            auto it = files.find(p);
            if (it == files.end()) return std::nullopt;
            return it->second;
        };
        r.listDir = [this](const std::string& d) {
            auto it = dirs.find(d);
            return it == dirs.end() ? std::vector<std::string>{} : it->second;
        };
        return r;
    }
};

struct TempDir {
    fs::path path;
    TempDir() {
        std::string t = (fs::temp_directory_path() / "mat-diag011-XXXXXX").string();
        path = mkdtemp(t.data());
    }
    ~TempDir() { fs::remove_all(path); }
};

std::string readAll(const fs::path& p) {
    std::ifstream in(p);
    std::stringstream s;
    s << in.rdbuf();
    return s.str();
}

constexpr int64_t kDay = 86400000;
// 2026-10-17 00:00 UTC
constexpr int64_t kUtcMidnight = 1792195200000LL;

}  // namespace

// ---------- emmcLife ----------

TEST(EmmcLife, HexBytesOfSysfs) {
    EXPECT_EQ(parseSysfsHexByte("0x01"), 1);
    EXPECT_EQ(parseSysfsHexByte(" 0x0B\n"), 11);
    EXPECT_EQ(parseSysfsHexByte("0x0a"), 10);
    for (const char* bad : {"", "1", "0x", "0xzz", "0x123", "0x01 0x02"})
        EXPECT_FALSE(parseSysfsHexByte(bad).has_value()) << bad;
}

TEST(EmmcLife, TheFirstEmmcGivesTypeATypeBAndPreEol) {
    FakeSysfs f;
    // An SD card first in name order, the boot partitions of the eMMC, then the eMMC itself.
    f.dirs["/sys/block"] = {"loop0", "mmcblk1", "mmcblk0boot0", "mmcblk0rpmb", "mmcblk0"};
    f.files["/sys/block/mmcblk1/device/type"] = "SD\n";
    f.files["/sys/block/mmcblk0/device/type"] = "MMC\n";
    f.files["/sys/block/mmcblk0/device/life_time"] = "0x02 0x03\n";
    f.files["/sys/block/mmcblk0/device/pre_eol_info"] = "0x01\n";
    const EmmcLife e = readEmmcLife(f.reader());
    ASSERT_TRUE(e.available) << e.reason;
    EXPECT_EQ(e.typeA, 2);
    EXPECT_EQ(e.typeB, 3);
    EXPECT_EQ(e.preEol, 1);
    EXPECT_EQ(e.source, "sysfs");
    EXPECT_EQ(e.device, "mmcblk0");
}

TEST(EmmcLife, NoEmmcNoLifeTimeOrGarbageSaySoAndNeverGuess) {
    {
        FakeSysfs f;  // a development container: no mmcblk at all
        f.dirs["/sys/block"] = {"sda", "loop0"};
        const EmmcLife e = readEmmcLife(f.reader());
        EXPECT_FALSE(e.available);
        EXPECT_EQ(e.reason, "no-emmc");
    }
    {
        FakeSysfs f;  // only an SD card
        f.dirs["/sys/block"] = {"mmcblk0"};
        f.files["/sys/block/mmcblk0/device/type"] = "SD\n";
        EXPECT_EQ(readEmmcLife(f.reader()).reason, "no-emmc");
    }
    {
        FakeSysfs f;  // eMMC 4.5 or an old kernel: no life_time
        f.dirs["/sys/block"] = {"mmcblk0"};
        f.files["/sys/block/mmcblk0/device/type"] = "MMC\n";
        const EmmcLife e = readEmmcLife(f.reader());
        EXPECT_FALSE(e.available);
        EXPECT_EQ(e.reason, "not-supported");
    }
    {
        FakeSysfs f;
        f.dirs["/sys/block"] = {"mmcblk0"};
        f.files["/sys/block/mmcblk0/device/type"] = "MMC\n";
        f.files["/sys/block/mmcblk0/device/life_time"] = "garbage\n";
        f.files["/sys/block/mmcblk0/device/pre_eol_info"] = "0x01\n";
        const EmmcLife e = readEmmcLife(f.reader());
        EXPECT_FALSE(e.available);
        EXPECT_EQ(e.reason, "unreadable");
        EXPECT_EQ(e.typeA, 0);
    }
}

// ---------- ioWriteBytesToday ----------

TEST(DailyWrites, LocalDayAndMidnightFollowTzOffsetMin) {
    // 2026-10-17 16:59:59.999 UTC is 23:59:59.999 in UTC+7; one ms later it is the next day.
    const int64_t t = kUtcMidnight + 17 * 3600000LL - 1;
    EXPECT_EQ(localDay(t + 1, 420), localDay(t, 420) + 1);
    EXPECT_EQ(localMidnightMs(t + 1, 420), t + 1);
    EXPECT_EQ(localMidnightMs(t, 420), t + 1 - kDay);
    EXPECT_EQ(localMidnightMs(kUtcMidnight + 5, 0), kUtcMidnight);
    EXPECT_EQ(localMidnightMs(kUtcMidnight + 5, -300), kUtcMidnight + 5 * 3600000LL - kDay);
    EXPECT_EQ(localMidnightMs(-1, 0), -kDay);  // floor, not truncation
}

TEST(DailyWrites, TodayIsSinceTheStartThenSinceTheLocalMidnight) {
    DailyWriteMeter m(420);
    EXPECT_FALSE(m.today().sampled);
    // The runtime starts at 10:00 local (03:00 UTC).
    const int64_t start = kUtcMidnight + 3 * 3600000LL;
    m.update(start, {{kWriteHistory, 1000}, {kWriteAudit, 10}});
    WritesToday t = m.today();
    EXPECT_TRUE(t.sampled);
    EXPECT_EQ(t.sinceMs, start);
    EXPECT_EQ(t.bytes[kWriteHistory], 1000);  // what was written since the process started
    m.update(start + 3600000, {{kWriteHistory, 5000}, {kWriteAudit, 30}, {kWriteRetain, 8}});
    t = m.today();
    EXPECT_EQ(t.bytes[kWriteHistory], 5000);
    EXPECT_EQ(t.bytes[kWriteRetain], 8);
    // Local midnight is 17:00 UTC: the first update after it starts the new day from there.
    const int64_t midnight = kUtcMidnight + 17 * 3600000LL;
    m.update(midnight + 4000, {{kWriteHistory, 9000}, {kWriteAudit, 40}, {kWriteRetain, 8}});
    t = m.today();
    EXPECT_EQ(t.sinceMs, midnight);
    EXPECT_EQ(t.bytes[kWriteHistory], 0);
    m.update(midnight + 60000, {{kWriteHistory, 9500}, {kWriteAudit, 41}, {kWriteRetain, 8}});
    t = m.today();
    EXPECT_EQ(t.bytes[kWriteHistory], 500);
    EXPECT_EQ(t.bytes[kWriteAudit], 1);
    EXPECT_EQ(t.bytes[kWriteRetain], 0);
}

TEST(DailyWrites, AClockSetBackStartsANewDayAndACounterNeverGoesNegative) {
    DailyWriteMeter m(420);
    const int64_t noon = kUtcMidnight + 5 * 3600000LL;
    m.update(noon, {{kWriteHistory, 100}});
    m.update(noon - 2 * kDay, {{kWriteHistory, 300}});  // the clock went two days back
    WritesToday t = m.today();
    EXPECT_EQ(t.bytes[kWriteHistory], 0);
    EXPECT_EQ(t.sinceMs, localMidnightMs(noon - 2 * kDay, 420));
    m.update(noon - 2 * kDay + 1000, {{kWriteHistory, 50}});  // a counter that went down
    EXPECT_EQ(m.today().bytes[kWriteHistory], 0);
}

TEST(DailyWrites, ComponentsTotalAndOtherWithAndWithoutProcSelfIo) {
    WritesToday t;
    t.sampled = true;
    t.sinceMs = 42;
    t.bytes = {{kWriteHistory, 120},
               {kWriteAudit, 3},
               {kWriteAlarm, 7},
               {kWriteRetain, 4},
               {kWriteLogic, 2}};
    ComponentWrites c = componentWrites(t);  // the BL335: no /proc/self/io
    EXPECT_EQ(c.source, "counters");
    EXPECT_EQ(c.total, 136);
    EXPECT_FALSE(c.other.has_value());
    EXPECT_FALSE(c.log.has_value());
    EXPECT_EQ(c.history, 120);
    EXPECT_EQ(c.alarm, 7);
    EXPECT_EQ(c.sinceMs, 42);
    t.bytes[kWriteProcess] = 1000;
    c = componentWrites(t);
    EXPECT_EQ(c.source, "proc-self-io");
    EXPECT_EQ(c.total, 1000);
    ASSERT_TRUE(c.other.has_value());
    EXPECT_EQ(*c.other, 1000 - 136);
    t.bytes[kWriteProcess] = 100;  // the kernel counts what reached the disk; SQLite counts more
    c = componentWrites(t);
    EXPECT_EQ(*c.other, 0);
}

// ---------- restarts ----------

TEST(RunRecord, FirstStartThenCrashThenCleanStopThenUpdateThenExec) {
    TempDir d;
    const std::string path = (d.path / kRunRecordFile).string();
    const std::string boot = "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0";
    {
        RunRecord r(path);
        ASSERT_TRUE(r.begin(1000, "1.0.0-rc.1", boot));
        EXPECT_EQ(r.info().total, 0);
        EXPECT_EQ(r.info().lastReason, "");
        EXPECT_FALSE(r.info().lastAtMs.has_value());
        // no end(): a kill -9
    }
    {
        RunRecord r(path);
        ASSERT_TRUE(r.begin(2000, "1.0.0-rc.1", boot));
        EXPECT_EQ(r.info().total, 1);
        EXPECT_EQ(r.info().lastReason, "crash");
        EXPECT_EQ(r.info().lastAtMs, 2000);
        EXPECT_FALSE(r.info().bootChanged);
        ASSERT_TRUE(r.end(false));  // SIGTERM
    }
    {
        RunRecord r(path);
        ASSERT_TRUE(r.begin(3000, "1.0.0-rc.1", boot));
        EXPECT_EQ(r.info().total, 2);
        EXPECT_EQ(r.info().lastReason, "systemd-restart");
        ASSERT_TRUE(r.end(false));
    }
    {
        RunRecord r(path);
        ASSERT_TRUE(r.begin(4000, "1.0.0-rc.2", boot));  // another binary
        EXPECT_EQ(r.info().total, 3);
        EXPECT_EQ(r.info().lastReason, "update");
        ASSERT_TRUE(r.end(true));  // the project switch: execv
    }
    {
        RunRecord r(path);
        ASSERT_TRUE(r.begin(5000, "1.0.0-rc.2", boot));
        EXPECT_EQ(r.info().total, 3);  // not a restart
        EXPECT_EQ(r.info().lastReason, "update");
        EXPECT_EQ(r.info().lastAtMs, 4000);
    }
    {
        RunRecord r(path);  // power loss: running, and the machine booted again
        ASSERT_TRUE(r.begin(6000, "1.0.0-rc.2", "ffffffff-4f50-6172-8394-a5b6c7d8e9f0"));
        EXPECT_EQ(r.info().total, 4);
        EXPECT_EQ(r.info().lastReason, "crash");
        EXPECT_TRUE(r.info().bootChanged);
    }
    // The file is JSON, mode 0600, no temporary file left.
    const auto j = nlohmann::json::parse(readAll(path), nullptr, false);
    ASSERT_TRUE(j.is_object());
    EXPECT_EQ(j["state"], "running");
    EXPECT_EQ(j["total"], 4);
    struct stat st {};
    ASSERT_EQ(::stat(path.c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 0777, 0600u);
    int files = 0;
    for (const auto& e : fs::directory_iterator(d.path)) {
        (void)e;
        ++files;
    }
    EXPECT_EQ(files, 1);
}

TEST(RunRecord, AnUnreadableRecordIsUnknownAndCountsFromOne) {
    TempDir d;
    const std::string path = (d.path / kRunRecordFile).string();
    std::ofstream(path) << "{not json";
    RunRecord r(path);
    ASSERT_TRUE(r.begin(7000, "1.0.0", "b"));
    EXPECT_EQ(r.info().total, 1);
    EXPECT_EQ(r.info().lastReason, "unknown");
    EXPECT_EQ(r.info().lastAtMs, 7000);
}

TEST(RunRecord, ADirectoryThatCannotBeWrittenGivesFalseButTheInfo) {
    RunRecord r("/nonexistent-dir-mat/run-record.json");
    std::string error;
    EXPECT_FALSE(r.begin(1, "1.0.0", "b", &error));
    EXPECT_FALSE(error.empty());
    EXPECT_EQ(r.info().total, 0);
}

// ---------- liveLagP95Ms ----------

TEST(LiveLag, NoSampleIsUnknownNotZero) {
    LiveLagWindow w;
    EXPECT_FALSE(w.p95(1000000).has_value());
}

TEST(LiveLag, P95OfTheLastFiveMinutesAtTheUpperEdgeOfItsBin) {
    LiveLagWindow w;
    const int64_t t0 = 10 * 60000;
    // 94 frames at 20 ms and 6 at 400 ms: the p95 is in the 400 ms bin (400..410).
    for (int i = 0; i < 94; ++i) w.add(t0, 20);
    for (int i = 0; i < 6; ++i) w.add(t0 + 1000, 400);
    EXPECT_EQ(w.p95(t0 + 2000), 410);
    // 96 at 20 ms and 4 slow ones: the p95 is 20 ms (bin 20..21).
    LiveLagWindow v;
    for (int i = 0; i < 96; ++i) v.add(t0, 20);
    for (int i = 0; i < 4; ++i) v.add(t0, 3000);
    EXPECT_EQ(v.p95(t0), 21);
    // Bins: exact below 100 ms, 10 ms up to 1 s, 100 ms up to 10 s, then 10 s.
    EXPECT_EQ(LiveLagWindow::upperEdge(LiveLagWindow::binOf(0)), 1);
    EXPECT_EQ(LiveLagWindow::upperEdge(LiveLagWindow::binOf(99)), 100);
    EXPECT_EQ(LiveLagWindow::upperEdge(LiveLagWindow::binOf(100)), 110);
    EXPECT_EQ(LiveLagWindow::upperEdge(LiveLagWindow::binOf(999)), 1000);
    EXPECT_EQ(LiveLagWindow::upperEdge(LiveLagWindow::binOf(1000)), 1100);
    EXPECT_EQ(LiveLagWindow::upperEdge(LiveLagWindow::binOf(9999)), 10000);
    EXPECT_EQ(LiveLagWindow::upperEdge(LiveLagWindow::binOf(600000)), 10000);
    EXPECT_EQ(LiveLagWindow::binOf(-5), 0);
}

TEST(LiveLag, MinutesOlderThanFiveLeaveTheWindow) {
    LiveLagWindow w;
    const int64_t t0 = 100 * 60000;
    for (int i = 0; i < 100; ++i) w.add(t0, 900);  // a slow minute
    for (int m = 1; m <= 4; ++m)
        for (int i = 0; i < 10; ++i) w.add(t0 + m * 60000, 10);
    EXPECT_EQ(w.p95(t0 + 4 * 60000), 910);  // the slow minute is still in
    EXPECT_EQ(w.p95(t0 + 5 * 60000), 11);   // five minutes later it is out
    EXPECT_FALSE(w.p95(t0 + 20 * 60000).has_value());
}
