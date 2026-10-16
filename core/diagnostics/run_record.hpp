// The restarts of mat-runtime for GET /api/v1/diagnostics (specs/011-pilot-hardening FR-009,
// contracts/device-api-011.md §5 `restarts`, test-protocols §5 X1): <dataDir>/run-record.json, a
// small file written twice per run (at start: "running"; at a clean stop: "stopped"; before the
// execv that switches the project: "exec"). At start the record of the run before says why this
// one began:
//   no file                        first start: total 0, no reason
//   "running"                      the run before never stopped cleanly (crash, kill -9, power
//                                  loss, watchdog): "crash"; `bootChanged` when the boot id
//                                  differs too (the machine restarted: power loss or reset)
//   "stopped", other version       "update" (a new runtime binary)
//   "stopped", same version        "systemd-restart" (SIGTERM: systemctl restart, stop, reboot)
//   "exec"                         not a restart (same process, same uptime): nothing changes
//   unreadable                     "unknown", total counted again from 1
// Written as a temporary file, fsync, rename, fsync of the directory (a power cut leaves the old
// or the new record). Not thread-safe: main() calls it before the threads and after them.
#pragma once
#include <cstdint>
#include <optional>
#include <string>

namespace mat {

inline constexpr const char* kRunRecordFile = "run-record.json";

struct RestartInfo {
    int64_t total = 0;
    std::string lastReason;           // "" when there was none
    std::optional<int64_t> lastAtMs;  // when that restart happened (UTC ms)
    bool bootChanged = false;
};

class RunRecord {
   public:
    explicit RunRecord(std::string path);
    // Reads the record of the run before, decides, writes the one of this run. false with `error`
    // when the new record could not be written (info() is still right for this run).
    bool begin(int64_t wallMs, const std::string& version, const std::string& bootId,
               std::string* error = nullptr);
    // A clean stop, or (exec) the image replaced by the project switch.
    bool end(bool exec, std::string* error = nullptr);
    RestartInfo info() const { return info_; }

   private:
    bool write(const std::string& state, std::string* error);
    std::string path_;
    RestartInfo info_;
    std::string version_, boot_;
    int64_t startedAt_ = 0;
};

// /proc/sys/kernel/random/boot_id without the newline; "" when it cannot be read.
std::string systemBootId();

}  // namespace mat
