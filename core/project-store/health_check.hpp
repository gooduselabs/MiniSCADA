// Health check of a version that has just started (specs/005-device-online research R13 step 6,
// contracts/device-api.md §5 "health", contracts/device-config.md §7 step 9). A pure function over
// probes the runtime injects: the project is active, the HTTPS listener is open, the runtime's own
// GET http://127.0.0.1:<port>/api/v1/system/info reports the digest of the version, and the tick
// loop has run for 2 s without an error. The 15 s deadline is an absolute time on the monotonic
// clock (DeployPipeline::healthDeadlineMs(): from the moment state.json was read), so a process
// that is slow to start has less time, not more.
#pragma once
#include <cstdint>
#include <functional>
#include <optional>
#include <string>

namespace mat {

constexpr int64_t kHealthTickWindowMs = 2000;  // the tick loop must run this long
constexpr int kHealthPollMs = 100;

struct HealthProbes {
    // The project of the version was validated and activated; false → HEALTH_PROJECT.
    std::function<bool()> projectActive;
    // The HTTPS listener is open (or no HTTPS is configured); false → HEALTH_HTTPS.
    std::function<bool()> httpsOpen;
    // project.digest of the runtime's own system/info; nullopt: no answer, or no digest yet.
    std::function<std::optional<std::string>()> reportedDigest;
    // Number of passes of the tick loop so far, and whether one of them threw (HEALTH_PROJECT).
    std::function<int64_t()> tickCount;
    std::function<bool()> tickFailed;
};

struct HealthClock {
    std::function<int64_t()> monoMs;      // empty: systemMonoMs
    std::function<void(int ms)> sleepMs;  // empty: std::this_thread::sleep_for
};

struct HealthOutcome {
    bool ok = false;
    std::string code;    // !ok: HEALTH_TIMEOUT, HEALTH_PROJECT, HEALTH_HTTPS
    std::string detail;  // !ok: for the log
};

// Order: project (HEALTH_PROJECT), HTTPS (HEALTH_HTTPS), then waits until the digest matches
// `expectedDigest` and the tick loop has advanced for kHealthTickWindowMs; the deadline passing
// first is HEALTH_TIMEOUT. A failure of the first two is reported at once, without waiting.
HealthOutcome runHealthCheck(const HealthProbes& probes, const std::string& expectedDigest,
                             int64_t deadlineMonoMs, const HealthClock& clock = {});

// GET /api/v1/system/info of this runtime over HTTP on 127.0.0.1:<port> (one connection, closed
// after the answer): its project.digest. nullopt when the connection, the answer or the JSON
// fails, the status is not 200, or the digest is null. `timeoutMs` bounds the whole call.
std::optional<std::string> fetchSystemInfoDigest(int port, int timeoutMs);

}  // namespace mat
