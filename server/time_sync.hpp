// Is the device clock synchronised? (specs/011-pilot-hardening T140, FR-089, research R23;
// contracts/device-api-011.md §5: system/info.timeSynced, diagnostics.timeSynced, the warning
// TIME_NOT_SYNCED.) Read only: a flag file, two programs that only print (no option that sets
// anything), and the RTC flag of sysfs. In this order, the first that decides wins:
//   1. /run/systemd/timesync/synchronized exists (systemd-timesyncd synchronised)   -> synced
//   2. `timedatectl show -p NTPSynchronized --value` says yes                        -> synced
//   3. `chronyc -n tracking` says "Leap status : Normal"                             -> synced
//   4. /sys/class/rtc/rtc0/hctosys is 1 (the clock was set from the battery RTC at boot) and the
//      year is >= 2026                                                               -> synced
//   5. 2 or 3 answered "not synchronised"                                            -> not synced
//   6. nothing could be read: synced when the year is >= 2026 (an RTC with a battery is assumed),
//      not synced before (R23)
// Not synced raises TIME_NOT_SYNCED (detail {"source": ...}); synced clears it. Each program gets
// at most 2 s, with LC_ALL=C, absolute path, no shell; a program that is not there is skipped.
// Which of these the BL335 has is settled by the read-only check of the device (T013); until then
// all are tried.
//
// Thread-safe: refresh() runs on a thread of its own (once a minute), synced() anywhere.
#pragma once
#include <atomic>
#include <cstdint>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "server/system_warnings.hpp"

namespace mat {

constexpr int64_t kTimeSyncPeriodMs = 60 * 1000;
constexpr int kTimeSyncMinYear = 2026;

// What the check reads; tests replace every part.
struct TimeSyncProbes {
    // stdout of a program that exited 0; nullopt: not there, failed, or too slow.
    std::function<std::optional<std::string>(const std::vector<std::string>& argv)> run;
    std::function<std::optional<std::string>(const std::string& path)> readFile;
    std::function<bool(const std::string& path)> exists;
    std::function<int64_t()> wallMs;  // UTC ms
};
TimeSyncProbes systemTimeSyncProbes();

struct TimeSyncStatus {
    bool synced = false;
    // "timesyncd" | "timedatectl" | "chronyc" | "rtc" | "year"
    std::string source;
    int64_t checkedAtMs = 0;
};

// "yes" / "no" (`--value`) or "NTPSynchronized=yes"; nullopt for anything else.
std::optional<bool> parseTimedatectlNtp(std::string_view text);
// The "Leap status" line of `chronyc tracking`: Normal -> true, "Not synchronised" -> false,
// anything else (Insert second, Delete second: synchronised too) -> true; no such line: nullopt.
std::optional<bool> parseChronycTracking(std::string_view text);
// UTC year of a time.
int utcYear(int64_t wallMs);

TimeSyncStatus probeTimeSync(const TimeSyncProbes& probes);

// What systemTimeSyncProbes().run does: stdout of `argv` (absolute path, no shell, LC_ALL=C, stdin
// and stderr /dev/null) when it exits 0 within `timeoutMs`; nullopt otherwise. The whole run is
// bounded (L8 of the security review of 011): a program that closes its stdout and goes on is
// killed at the deadline and reaped, never waited for without end.
std::optional<std::string> runReadOnlyCommand(const std::vector<std::string>& argv, int timeoutMs);

class TimeSync {
   public:
    // `warnings` may be null (no warning raised).
    TimeSync(TimeSyncProbes probes, SystemWarnings* warnings);
    TimeSyncStatus refresh();
    TimeSyncStatus status() const;
    bool synced() const { return synced_.load(); }

   private:
    TimeSyncProbes probes_;
    SystemWarnings* warnings_;
    mutable std::mutex mu_;
    TimeSyncStatus last_;
    std::atomic<bool> synced_{false};
};

}  // namespace mat
