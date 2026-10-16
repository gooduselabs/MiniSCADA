// Bytes written today, per component, for ioWriteBytesToday of GET /api/v1/diagnostics
// (specs/011-pilot-hardening FR-009, FR-045, contracts/device-api-011.md §5; ADR-039).
//
// The runtime hands in, every few seconds, counters that only grow while the process lives: the
// bytes SQLite wrote to each database (core/historian/write_counter_vfs: history, alarm, audit),
// the bytes of the retained store, of the logic state, and write_bytes of /proc/self/io as
// "process" when the kernel has it (the BL335 kernel has not). The meter keeps their values at the
// last local midnight (tzOffsetMin, no DST: research R23) and gives today = now - midnight. The
// first day starts when the process starts (`sinceMs`). Any change of the local day (midnight, or a
// clock set forward or back) starts a new day from the values of that moment. The bytes between
// midnight and the next update() (at most one period) are counted in the day before.
//
// Thread-safe: the tick thread calls update(), HTTP workers today().
#pragma once
#include <cstdint>
#include <map>
#include <mutex>
#include <optional>
#include <string>

namespace mat {

// Component keys of the counters (and of the answer).
inline constexpr const char* kWriteProcess = "process";  // /proc/self/io write_bytes
inline constexpr const char* kWriteHistory = "history";
inline constexpr const char* kWriteAlarm = "alarm";
inline constexpr const char* kWriteAudit = "audit";
inline constexpr const char* kWriteRetain = "retain";
inline constexpr const char* kWriteLogic = "logic";

// The local day number of a UTC time, and the UTC ms of that day's 00:00 (floor division: times
// before 1970 work too).
int64_t localDay(int64_t wallMs, int tzOffsetMin);
int64_t localMidnightMs(int64_t wallMs, int tzOffsetMin);

struct WritesToday {
    bool sampled = false;                  // update() ran at least once
    int64_t sinceMs = 0;                   // start of what is counted (process start or midnight)
    std::map<std::string, int64_t> bytes;  // per key of the counters
};

class DailyWriteMeter {
   public:
    explicit DailyWriteMeter(int tzOffsetMin);
    void update(int64_t wallMs, const std::map<std::string, int64_t>& cumulative);
    WritesToday today() const;

   private:
    int tz_;
    mutable std::mutex mu_;
    bool started_ = false;
    int64_t day_ = 0;
    int64_t sinceMs_ = 0;
    std::map<std::string, int64_t> base_, last_;
};

// The block of the answer: the components, `total` (the process counter when there is one, else
// the sum of the components) and `other` (process - components; nullopt without the process
// counter, since nothing else is counted). `log` is never measured (journald writes it): nullopt.
struct ComponentWrites {
    std::string source;  // "proc-self-io" | "counters"
    int64_t sinceMs = 0;
    int64_t total = 0;
    int64_t history = 0, alarm = 0, audit = 0, retain = 0, logic = 0;
    std::optional<int64_t> log;
    std::optional<int64_t> other;
};
ComponentWrites componentWrites(const WritesToday& t);

}  // namespace mat
