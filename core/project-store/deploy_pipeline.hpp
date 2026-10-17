// Deploy and restore of a project on the device (specs/005-device-online data-model §10,
// contracts/device-api.md §4–5, research R13; FR-021–FR-024): a state machine over a
// ProjectStore whose steps are injected (DeployHooks). No thread and no socket of its own: the
// HTTP layer calls begin(), receive(), receiveEnd(), then run() on a worker; the runtime calls
// resume() at start, healthPassed()/healthFailed() from its health check and poll() about once a
// second (receive deadline 10 min, health deadline 15 s, both on the monotonic clock). Every
// method locks; hooks run without the lock.
//
//   receive → verify-package → validate → backup → activate → health → committed
//   failure in the first four: failed (store untouched, staging removed, lock released)
//   health failed, over 15 s, died twice: rollback → rolled-back (rollback failing too: failed,
//   no project runs)
//   killed before activate: interrupted at the next start
//
// Audit: `started` is committed before anything changes (AUDIT_UNAVAILABLE otherwise), the result
// is written under the account that started, with the same role and source. Records:
// ops/<opId>.json at the start, before execv, when a rollback starts and at the end (the result
// is written before the state.json write that decides it, so a record that still says "running"
// with no pending operation was killed before activation).
#pragma once
#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "core/project-manager/project_validator.hpp"
#include "core/project-store/boot_decision.hpp"
#include "core/project-store/store.hpp"

namespace mat {

constexpr int64_t kReceiveTimeoutMs = 10 * 60 * 1000;
constexpr int64_t kHealthTimeoutMs = 15 * 1000;

constexpr const char* kStepReceive = "receive";
constexpr const char* kStepVerify = "verify-package";
constexpr const char* kStepValidate = "validate";
constexpr const char* kStepBackup = "backup";
constexpr const char* kStepActivate = "activate";
constexpr const char* kStepHealth = "health";
constexpr const char* kStepRollback = "rollback";

enum class StepState { Pending, Running, Ok, Failed, Skipped };
const char* stepStateName(StepState s);  // "pending" …
enum class DeployResult { Running, Committed, Failed, RolledBack, Interrupted };
const char* deployResultName(DeployResult r);  // "running", "committed", "failed", "rolled-back"…

struct DeployStep {
    std::string id;
    StepState state = StepState::Pending;
    std::optional<std::string> startedAt;  // ISO 8601 UTC
    std::optional<std::string> endedAt;
    std::string code;                  // failed: the step's code (device-api §5)
    std::string message;               // failed: for people
    std::vector<ProjectIssue> issues;  // validate: the validator's issues; verify: {code, file}
};

struct DeployError {
    std::string code;
    std::string message;
    std::vector<ProjectIssue> issues;
};

struct DeployFrom {
    int64_t seq = 0;
    std::string digest;
    std::string projectVersion;
};
struct DeployTo {
    std::optional<int64_t> seq;  // deploy: known from step backup
    std::string digest;          // deploy: X-Mat-Digest until verify-package, then the package's
    std::string projectId;
    std::string projectVersion;
};

struct DeployOperation {
    std::string opId;
    OpKind kind = OpKind::Deploy;
    std::string user;
    std::string role;
    std::string source;       // client address
    std::string auditSource;  // source of its audit rows ("IP:port"); not in the API JSON
    int64_t serial = 0;       // order of the operations; not in the API JSON
    int64_t startedMs = 0;    // UTC ms: DEVICE_BUSY since, system/info.operation.since
    std::string startedAt;
    std::optional<std::string> endedAt;
    bool clockOk = false;
    std::optional<DeployFrom> from;
    DeployTo to;
    std::vector<DeployStep> steps;
    DeployResult result = DeployResult::Running;
    std::optional<DeployError> error;
    int clientsNotified = 0;

    DeployStep* step(std::string_view id);
    const DeployStep* step(std::string_view id) const;
    std::string runningStep() const;  // id of the step running, "" when none
};

// GET /api/v1/project/deployments/{opId} (device-api §4).
std::string deployOperationJson(const DeployOperation& op);
// ops/<opId>.json: the API object plus serial, auditSource, startedMs.
std::string deployRecordJson(const DeployOperation& op);
std::optional<DeployOperation> parseDeployRecord(std::string_view text, std::string& error);

// Who asks: the session's account and role, the client's address, and the audit source.
struct Initiator {
    std::string user;
    std::string role;
    std::string ip;
    std::string auditSource;  // "IP:port"
};

struct BusyInfo {
    std::string opId;
    OpKind kind = OpKind::Deploy;
    std::string user;
    std::string source;
    int64_t since = 0;  // UTC ms
};
std::string busyInfoJson(const BusyInfo& b);  // {opId, kind, user, source, since} of DEVICE_BUSY

enum class BeginStatus {
    Started,           // 202 after the body (deploy) / at once (restore)
    Busy,              // 409 DEVICE_BUSY + busy
    BaseChanged,       // 409 BASE_CHANGED
    NoSuchVersion,     // 404 NO_SUCH_VERSION (restore)
    AlreadyActive,     // 409 ALREADY_ACTIVE (restore)
    NoSpace,           // 507 NO_SPACE (deploy)
    NoBaseProject,     // 409 NO_BASE_PROJECT: the old project is not in the store yet (FR-027)
    AuditUnavailable,  // 503 AUDIT_UNAVAILABLE
    StoreError,        // 500: STORE_IO, damaged store
    PersistFailed,     // 500 PERSIST_FAILED: the record of the operation could not be written
};
const char* beginErrorCode(BeginStatus s);  // "DEVICE_BUSY" …; "" for Started

struct BeginRequest {
    OpKind kind = OpKind::Deploy;
    Initiator who;
    std::string baseDigest;      // X-Mat-Base-Digest, restore baseDigest: a digest or "none"
    std::string packageDigest;   // deploy: X-Mat-Digest
    uint64_t contentLength = 0;  // deploy
    int64_t seq = 0;             // restore
};

struct BeginResult {
    BeginStatus status = BeginStatus::StoreError;
    std::string opId;              // Started
    std::optional<BusyInfo> busy;  // Busy
    std::string message;           // for people
};

enum class ReceiveStatus {
    Ok,      // keep sending / the body is complete: answer 202, then run() on a worker
    Gone,    // no operation receiving with this opId (timed out, aborted, unknown): close
    Failed,  // the operation failed now (NO_SPACE, STORE_IO, RECEIVE_ABORTED): close
};

struct VerifyRequest {
    std::string opId;
    std::string packagePath;     // staging/<opId>/package.matscada, synced
    std::string projectDir;      // staging/<opId>/project: to create and fill
    std::string expectedDigest;  // X-Mat-Digest
    uint64_t minFreeBytes = 0;
};
struct VerifyOutcome {
    bool ok = false;
    std::string code;  // E_PKG_*, NO_SPACE, STORE_IO
    std::string path;  // entry of the error, "" for the whole package
    std::string message;
    std::string digest;  // ok: from the manifest
    std::string projectId;
    std::string projectName;
    std::string projectVersion;
    std::string minRuntimeVersion;
};
struct ValidateOutcome {
    bool ok = false;
    std::vector<ProjectIssue> issues;  // errors of the validator (E_VALIDATION)
};

// Tests only: a restart hook returning Replaced stands for a successful execv (the old process
// is gone). In the runtime restart() never returns on success.
enum class RestartOutcome { Replaced, Failed };

struct DeployHooks {
    // T110: extractPackage (core/package/extract.hpp) of the received file into projectDir.
    std::function<VerifyOutcome(const VerifyRequest&)> verifyPackage;
    // T110: validateProject(projectDir, schemasDir), errors only.
    std::function<ValidateOutcome(const std::string& projectDir)> validate;
    // Feature 006 (FR-042): just before the activation begins, the tag write coordinator stops
    // taking commands, cancels the ones not sent, waits for the ones being sent and has every
    // result in the audit. The chain goes on only when it returns. Empty: nothing to wait for.
    std::function<void()> quiesce;
    // T108: close every live session with 1012; their number (clientsNotified).
    std::function<int()> notifyClients;
    // T108: commit historian, stop CivetWeb, save auth-state.json, close the audit, execv.
    std::function<RestartOutcome(std::string& error)> restart;
    FreeBytesFn freeBytes;  // empty: statvfsFreeBytes
    // Test hook (MAT_TEST_HOOKS): false = the process dies just before this step.
    std::function<bool(const std::string& stepId)> beforeStep;
};

struct DeployOptions {
    uint64_t minFreeBytes = 500ULL << 20;  // historianMinFreeMB in bytes
    StoreAuditFn audit;                    // empty: every begin() ends with AUDIT_UNAVAILABLE
    std::function<int64_t()> wallMs;       // empty: the store's
    std::function<int64_t()> monoMs;       // empty: systemMonoMs (CLOCK_BOOTTIME)
    std::function<std::string()> newOpId;  // empty: newOpId()
    // Digest of the project the runtime shows (system/info), compared with the base digest.
    // Empty: the active version of the store ("none" without one).
    std::function<std::optional<std::string>()> runningDigest;
    std::function<void(const std::string& line)> log;  // empty: stderr "deploy: …"
    // Feature 011 (FR-060): another operation holding the device (an OTA update); begin() then
    // answers DEVICE_BUSY with it. Called under the pipeline's mutex: must not call back into the
    // pipeline. Empty: none.
    std::function<std::optional<BusyInfo>()> otherBusy;
};

// Feature 011 (FR-023, research R8): the records ops/<opId>.json are written outside the mutex
// of the pipeline. take() runs under that mutex and only copies the text and gives it a number;
// write() runs without it, one write at a time (its own lock), and skips a ticket older than the
// last one written for the same record, so an old snapshot never overwrites a newer one. A text
// equal to the one last written for that record is not written again (one sync less on the eMMC).
class RecordWriter {
   public:
    using WriteFn =
        std::function<bool(const std::string& id, const std::string& text, std::string& err)>;
    struct Ticket {
        std::string id;
        std::string text;
        uint64_t seq = 0;
        bool unchanged = false;  // equal to what was last written: write() does nothing
    };
    explicit RecordWriter(WriteFn write) : write_(std::move(write)) {}

    Ticket take(const std::string& id, std::string text);
    // true when the text is on disk, or a newer one is, or nothing changed; false with `err`.
    bool write(const Ticket& t, std::string& err);
    void forget(const std::string& id);  // the record was removed

   private:
    struct Written {
        uint64_t seq = 0;
        size_t hash = 0;
        bool any = false;
    };
    WriteFn write_;
    std::mutex io_;  // one write at a time
    std::mutex mu_;  // seq_ and written_, held only for a moment
    uint64_t seq_ = 0;
    std::map<std::string, Written> written_;
};

enum class RunOutcome {
    Restarted,  // restart() replaced the process (tests)
    Failed,     // the operation ended failed (or the restart failed)
    Done,       // nothing more to do: committed, rolled back, nothing pending
    Stopped,    // beforeStep() stopped the run (tests: the process died)
    Ignored,    // no such operation in that state
};

class DeployPipeline {
   public:
    DeployPipeline(ProjectStore& store, DeployHooks hooks, DeployOptions options);
    ~DeployPipeline();
    DeployPipeline(const DeployPipeline&) = delete;
    DeployPipeline& operator=(const DeployPipeline&) = delete;

    // At start, after startStore(): records still "running" that are not the pending operation
    // were killed before activation: interrupted (INTERRUPTED, audit). The pending operation is
    // taken over as the decision says: its health check runs (deadline stateReadMonoMs + 15 s),
    // or it ends here (rolled back to nothing, rollback failed).
    void resume(const StoreStartup& st);

    // Checks before the body (device-api §4): busy, base digest, version (restore), free space
    // (deploy: Content-Length + minFreeBytes), then audit `started`. Refusals are audited
    // `failed` (best effort). Deploy: staging/<opId>/package.matscada is open for receive().
    BeginResult begin(const BeginRequest& r);
    // Body bytes, in order. The free space must stay ≥ minFreeBytes (NO_SPACE).
    ReceiveStatus receive(const std::string& opId, const void* data, size_t n);
    // End of the body: complete and exactly Content-Length bytes → the package is synced, Ok;
    // otherwise RECEIVE_ABORTED.
    ReceiveStatus receiveEnd(const std::string& opId, bool complete);
    // verify-package (deploy), validate, backup, activate. Returns only when the operation failed
    // or (tests) the process was replaced.
    RunOutcome run(const std::string& opId);

    // Result of the health check of the version being checked (TryNew, rollback).
    RunOutcome healthPassed();
    RunOutcome healthFailed(const std::string& code);
    // Deadlines: RECEIVE_TIMEOUT, HEALTH_TIMEOUT.
    RunOutcome poll();

    std::optional<DeployOperation> current() const;  // the running operation
    std::optional<DeployOperation> find(const std::string& opId) const;
    std::optional<DeployOperation> latest() const;    // GET /project/operation
    std::optional<int64_t> healthDeadlineMs() const;  // monotonic

   private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace mat
