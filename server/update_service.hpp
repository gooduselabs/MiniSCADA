// The runtime side of OTA (feature 011 US4; contracts/update-package.md §4 S1–S3,
// device-api-011 §3; FR-058 to FR-061, FR-064, FR-065; ADR-035). The runtime (user matscada,
// unprivileged) only receives a package into <dataDir>/update/incoming/<id>.part (0600), checks it
// with core/update in the order of FR-061, keeps it in ready/<id>.matupdate for 30 minutes, and on
// apply writes update/request.json, which mat-updater.path hands to mat-updater (root) — which
// checks everything again on its own copy. One operation at a time, shared with the project
// deployment (DEVICE_BUSY both ways). Every step is audited (system.update.*) before it acts:
// `accepted` is written (FULL) before the first byte of the body is read.
//
// Thread-safe. The password of apply and rollback is checked by the HTTP layer (AuthService::
// reauthenticate) before apply() / rollback() is called.
#pragma once
#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>

#include "core/audit/audit_log.hpp"
#include "core/project-store/deploy_pipeline.hpp"
#include "core/update/verify.hpp"
#include "nlohmann/json.hpp"

namespace mat {

class SystemWarnings;

struct UpdateCaller {
    std::string user;
    std::string role;
    std::string source;  // audit source "IP:port"
};

struct UpdateServiceOptions {
    bool enabled = false;                    // update.enabled
    uint64_t maxPackageBytes = 64ULL << 20;  // update.maxPackageMiB
    std::string trustedKeysDir = "/etc/mat-runtime/trusted-keys";
    std::string dataDir;                           // <dataDir>/update/ is ours
    std::string installRoot = "/opt/mat-runtime";  // build-info.json; <installRoot>.prev
    std::string arch = update::buildArch();
    std::string version;  // running version (kRuntimeVersion)
    // Format of the running project ("1.0.0"); empty: not checked.
    std::function<std::string()> projectFormat;
    // The deployment holding the device (DeployPipeline::current); empty: never busy.
    std::function<std::optional<BusyInfo>()> deployBusy;
    // Audit: false when the row could not be written (the request is then refused).
    std::function<bool(const AuditEvent&)> audit;
    std::function<int64_t()> wallMs;         // empty: system clock
    std::function<int64_t()> monoMs;         // empty: CLOCK_BOOTTIME (expiry of a verified package)
    std::function<int64_t()> receiveMonoMs;  // the receive limits; empty: CLOCK_BOOTTIME
    std::function<std::string()> newId;      // empty: "upd_" + 16 random hex
    // Free bytes of the file system of `path`; empty: statvfs.
    std::function<uint64_t(const std::string& path)> freeBytes;
    SystemWarnings* warnings = nullptr;  // UPDATE_KEYS_MISSING, UPDATE_ROLLED_BACK
    int64_t verifiedTtlMs = 30 * 60 * 1000;
    // Receiving (device-api-011 §3): at most `receiveTotalMs`, then at least `minRateBytesPerS`
    // on average once `rateGraceMs` has passed.
    int64_t receiveTotalMs = 120000;
    uint64_t minRateBytesPerS = 64 * 1024;
    int64_t rateGraceMs = 10000;
    // The warning UPDATE_ROLLED_BACK stays this long after the rollback (or until acknowledged).
    int64_t rolledBackWarningMs = 30LL * 24 * 3600 * 1000;
    std::function<void(const std::string&)> log;  // empty: stderr
};

// The answer of an operation: HTTP status and the JSON body (an error carries error + message).
struct UpdateReply {
    int status = 200;
    nlohmann::json body;
    std::string code;  // the error code, "" on success
};

class UpdateService {
   public:
    explicit UpdateService(UpdateServiceOptions options);
    ~UpdateService();
    UpdateService(const UpdateService&) = delete;
    UpdateService& operator=(const UpdateService&) = delete;

    bool enabled() const { return o_.enabled; }
    // update/ and its subdirectories (0700), stale incoming/ and ready/ removed, last.json read:
    // a result not yet audited is audited now (system.update.committed / rolled-back /
    // manual-rollback) and marked audited (FR-063). The warnings are set. Call once at start.
    void start();

    // POST /system/update, before the body: enabled, keys, size, busy; then the audit
    // `accepted`. On success `id` names the receive and the body may be read.
    UpdateReply begin(const UpdateCaller& who, uint64_t contentLength, std::string& id);
    // Body bytes in order; false: the receive was aborted (rate, total time, write error, size):
    // the caller answers finish(id, false, …).
    bool receive(const std::string& id, const void* data, size_t n);
    // End of the body: `complete` with exactly Content-Length bytes → the package is checked;
    // otherwise UPDATE_RECEIVE_ABORTED. Refusals are audited, the files removed, the lock freed.
    UpdateReply finish(const std::string& id, bool complete, const UpdateCaller& who);

    // GET /system/update.
    nlohmann::json status();
    // POST apply (password already checked): writes request.json, audit `applying`, 202.
    UpdateReply apply(const std::string& updateId, const UpdateCaller& who);
    UpdateReply cancel(const std::string& updateId, const UpdateCaller& who);
    // POST rollback (password already checked): request.json with op "rollback" when
    // <installRoot>.prev holds a runtime.
    UpdateReply rollback(const UpdateCaller& who);

    // What holds the device for DeployPipeline (DEVICE_BUSY): a receive, a verified package, an
    // apply under way. Lock-free (called under the pipeline's mutex).
    std::optional<BusyInfo> busy() const;
    // system/info.update: {"enabled", "supported": true, "keys": n}.
    nlohmann::json infoBlock() const;
    // releaseSeq of the running tree (build-info.json), 0 without one.
    int64_t releaseSeq() const { return releaseSeq_; }
    // Expiry of a verified package; called by status() and the API, and by the runtime's tick.
    void expire();

   private:
    void startLast(nlohmann::json& last, bool& keysetAudited);
    struct Impl;
    UpdateServiceOptions o_;
    std::unique_ptr<Impl> impl_;
    int64_t releaseSeq_ = 0;
    std::atomic<bool> claimed_{false};
};

// The installed tree's build-info.json: {"version", "releaseSeq", …}; missing or broken: version
// "", releaseSeq 0.
struct BuildInfo {
    std::string version;
    int64_t releaseSeq = 0;
    std::string arch;
};
BuildInfo readBuildInfo(const std::string& installRoot);

}  // namespace mat
