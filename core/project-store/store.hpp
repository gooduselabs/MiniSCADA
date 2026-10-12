// Project store of the device (specs/005-device-online data-model §9, research R13; FR-019,
// FR-023, FR-024, FR-027), in <projectStoreDir> (default <dataDir>/projects), mode 0700:
//
//   state.json          the single source of truth: running version, backups, pending operation
//   v/<seq>/            package.matscada (the bytes received), project/ (extracted and checked:
//                       the runtime runs it), meta.json (written last: the version is complete)
//   staging/<opId>/     work area of an operation, emptied at every start
//   ops/<opId>.json     the 20 latest deploy and restore operations (written by DeployPipeline)
//
// state.json, meta.json and the operation records are replaced atomically (temporary file, fsync,
// rename, fsync of the directory): after a power cut each one is the old or the new file. Files
// 0600, directories 0700. One object per process; its methods lock, so HTTP threads may read
// while the pipeline writes. A library for now: the runtime wires it at T108.
#pragma once
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <vector>

#include "core/audit/audit_log.hpp"

namespace mat {

constexpr const char* kStoreSchemaVersion = "1.0.0";
constexpr const char* kStoreStateFile = "state.json";
constexpr const char* kStoreMetaFile = "meta.json";
constexpr const char* kStorePackageFile = "package.matscada";
constexpr const char* kStoreProjectDir = "project";
constexpr size_t kStoreOpsKept = 20;
constexpr int kProjectBackupsDefault = 3;
constexpr int kProjectBackupsMin = 1;
constexpr int kProjectBackupsMax = 10;
constexpr size_t kStoreJsonMaxBytes = 1024 * 1024;  // state.json, meta.json, ops/*.json when read

// Commits one audit record before it returns; throws AuditUnavailable when it cannot. The runtime
// passes AuditLog::append.
using StoreAuditFn = std::function<void(const AuditEvent& event)>;

// Free bytes for an unprivileged user on the file system of `dir`; false: unknown.
using FreeBytesFn = std::function<bool(const std::string& dir, uint64_t& freeBytes)>;
bool statvfsFreeBytes(const std::string& dir, uint64_t& freeBytes);  // f_bavail × f_frsize

enum class OpKind { Deploy, Restore };
const char* opKindName(OpKind k);  // "deploy", "restore"
std::optional<OpKind> parseOpKind(std::string_view s);

enum class VersionSource { Studio, RuntimePackage, Restore };
const char* versionSourceName(VersionSource s);  // "studio", "runtime-package", "restore"
std::optional<VersionSource> parseVersionSource(std::string_view s);

enum class PendingPhase { Activating, Health, RollingBack };
const char* pendingPhaseName(PendingPhase p);  // "activating", "health", "rolling-back"
std::optional<PendingPhase> parsePendingPhase(std::string_view s);

// A version of the project: an entry of state.json versions[], and v/<seq>/meta.json (where
// activatedAt is null: the version is stored, not yet activated).
struct ProjectVersion {
    int64_t seq = 0;
    std::string digest;  // "sha256:" + 64 hex: content digest of the package
    std::string projectId;
    std::string projectName;
    std::string projectVersion;
    std::string minRuntimeVersion;
    int64_t size = 0;                         // bytes of package.matscada
    std::optional<std::string> activatedAt;   // ISO 8601 UTC of the last activation
    bool clockOk = false;                     // false: the device clock was not synchronised
    std::optional<std::string> deployedBy;    // account; null when the runtime adopted it
    std::optional<std::string> deployedFrom;  // client address; null as deployedBy
    VersionSource source = VersionSource::Studio;
};

// `pending` of state.json: an operation between its activation and the end of its health check.
struct PendingOperation {
    std::string opId;
    OpKind kind = OpKind::Deploy;
    std::optional<int64_t> from;  // seq running when it started; nullopt: none
    int64_t to = 0;               // seq being activated
    PendingPhase phase = PendingPhase::Activating;
    int bootAttempts = 0;  // starts of the runtime on the version of this phase
    std::string user;
    std::string source;     // client address
    std::string startedAt;  // ISO 8601 UTC
};

struct StoreState {
    std::string schemaVersion = kStoreSchemaVersion;
    std::optional<int64_t> active;  // seq running; nullopt: no project in the store
    int64_t nextSeq = 1;
    std::vector<ProjectVersion> versions;  // the running version first, then backups, newest first
    std::optional<PendingOperation> pending;

    const ProjectVersion* find(int64_t seq) const;
};

// state.json (2-space indent, final newline) and its reader: schemaVersion 1.x.y and every key of
// data-model §9 with its type; unknown keys are ignored (a later 1.x may add some). nullopt and
// `error` otherwise, and for an inconsistent state: duplicate seq, a seq not below nextSeq,
// `active` not in versions[], a pending opId that is not validOpId.
std::string storeStateJson(const StoreState& s);
std::optional<StoreState> parseStoreState(std::string_view text, std::string& error);
// meta.json: the ProjectVersion keys plus schemaVersion.
std::string versionMetaJson(const ProjectVersion& v);
std::optional<ProjectVersion> parseVersionMeta(std::string_view text, std::string& error);

// Pure changes of the state, shared by the boot decision and the store's writes.
// Health check passed: `entry` (seq = pending->to) runs and comes first in versions[]; the
// versions beyond 1 + `backups` are dropped (their seqs appended to `dropped`); pending = null.
StoreState stateCommitted(StoreState s, ProjectVersion entry, int backups,
                          std::vector<int64_t>* dropped = nullptr);
// Health failed: back to `from`: phase rolling-back, active = from, bootAttempts = `attempts`.
StoreState stateRollingBack(StoreState s, int attempts);
// The pending operation ends without a commit: pending = null; active = from (rolled back,
// activation cancelled) or null when `keepFrom` is false (the rollback failed too).
StoreState stateEnded(StoreState s, bool keepFrom);

// UUID v4 text in lower case: the only names under staging/ and ops/ (opIds come from requests).
bool validOpId(std::string_view id);
std::string newOpId();              // UUID v4 from getrandom
std::string isoUtc(int64_t utcMs);  // "2026-10-20T03:12:00Z"
int64_t systemWallMs();             // system_clock, UTC ms
int64_t systemMonoMs();             // CLOCK_BOOTTIME, ms

struct StoreOptions {
    std::string dir;                                   // projectStoreDir
    int projectBackups = kProjectBackupsDefault;       // clamped to 1–10
    std::function<int64_t()> wallMs;                   // empty: systemWallMs
    std::function<bool(int64_t wallMs)> clockSynced;   // clockOk; empty: timesyncSynchronized
    std::function<int(int fd)> fsync;                  // empty: ::fsync; tests record or fail calls
    std::function<void(const std::string& line)> log;  // empty: stderr "project-store: …"
};

enum class StateStatus { Missing, Ok, Corrupt };

// The project installed the old way (projectDir, FR-027) as the runtime's validator saw it.
enum class LegacyStatus { Valid, Invalid, Empty };
struct LegacyProject {
    LegacyStatus status = LegacyStatus::Empty;
    std::string reason;              // Invalid, Empty: why it is not taken (NO_PROJECT_PACKAGE)
    std::string dir;                 // projectDir
    std::vector<std::string> files;  // Valid: LoadedProject::files(), relative to dir
    std::string projectId;           // Valid: the identity of project.json
    std::string projectName;
    std::string projectVersion;
    std::string minRuntimeVersion;
};

// Packs `files` (relative to `dir`) as a stored .matscada package written to `fd`, open for
// writing (the store syncs and closes it). The runtime passes writeStoredPackage (zip_writer).
struct PackResult {
    bool ok = false;
    std::string error;   // !ok: E_PKG_* or STORE_IO, and why
    std::string digest;  // "sha256:…"
    uint64_t bytes = 0;
};
using PackFn = std::function<PackResult(const std::string& dir,
                                        const std::vector<std::string>& files, int fd)>;

struct AdoptResult {
    bool ok = false;
    int64_t seq = 0;
    std::string error;  // !ok: why (also the NO_PROJECT_PACKAGE reason)
};

// recoverState(): state.json was damaged and is rebuilt from the versions on disk.
struct RecoverResult {
    bool ok = false;
    std::optional<int64_t> active;  // the version the rebuilt state runs; nullopt: none
    size_t versions = 0;            // versions[] of the rebuilt state
    std::string corruptFile;        // name of the damaged file, kept: state.json.corrupt-<mono ms>
    std::string error;              // !ok: why (the store stays damaged)
};

// GET /api/v1/project/versions
struct VersionView {
    ProjectVersion version;
    bool active = false;
    bool restorable = false;  // v/<seq> is complete (meta.json)
};

class ProjectStore {
   public:
    explicit ProjectStore(StoreOptions options);
    ~ProjectStore();
    ProjectStore(const ProjectStore&) = delete;
    ProjectStore& operator=(const ProjectStore&) = delete;

    const std::string& dir() const;
    int projectBackups() const;

    // Creates dir, v/, staging/, ops/ (0700) when missing and sets dir to 0700. Refuses a symlink
    // or something that is not a directory.
    bool open(std::string& err);
    // Reads state.json into memory.
    StateStatus load(std::string* error = nullptr);
    StateStatus stateStatus() const;
    StoreState state() const;  // a copy; a default StoreState when Missing or Corrupt

    // At start, after load(): staging/ is emptied; every v/<seq> without a meta.json that parses
    // is removed; with a readable state.json the complete versions it does not reference
    // (versions[], pending from and to) are removed, and with no state.json every version. v/ is
    // not touched while state.json is damaged. Returns the names removed from staging/.
    std::vector<std::string> cleanup();
    // Removes the complete versions the state in memory does not reference (after a commit or a
    // rollback). Nothing while state.json is damaged.
    void removeUnreferenced();

    std::set<int64_t> completeVersions() const;
    bool isComplete(int64_t seq) const;
    std::optional<ProjectVersion> readMeta(int64_t seq) const;
    std::vector<VersionView> versionList() const;

    std::string versionDir(int64_t seq) const;              // <dir>/v/<seq>
    std::string projectDir(int64_t seq) const;              // <dir>/v/<seq>/project
    std::string packagePath(int64_t seq) const;             // <dir>/v/<seq>/package.matscada
    std::string stagingDir(const std::string& opId) const;  // <dir>/staging/<opId>

    // state.json: temporary file, fsync, rename, fsync of the directory; then the copy in memory.
    bool writeState(const StoreState& s, std::string& err);

    // staging/<opId>/ (0700) of an operation, and package.matscada in it opened for writing
    // (O_EXCL, O_NOFOLLOW, 0600): the fd, or -1 with `err`.
    int createStaging(const std::string& opId, std::string& err);
    void removeStaging(const std::string& opId);  // best effort, never follows a symlink

    // Step backup of a deploy: staging/<opId>/ becomes v/<seq> (rename in the same file system,
    // fsync of v/), then meta.json is written (atomic) with `meta` and seq = max(nextSeq, highest
    // seq in v/ + 1). nullopt + `err` (STORE_IO): no v/<seq> is left; staging/<opId> may be, for
    // the caller to remove.
    std::optional<int64_t> commitStaging(const std::string& opId, ProjectVersion meta,
                                         std::string& err);
    void removeVersion(int64_t seq);  // best effort

    // The state changes of an operation, each one write of state.json (writeState).
    bool beginActivation(const PendingOperation& p, std::string& err);  // pending; nextSeq > to
    bool commitPending(const ProjectVersion& entry, std::string& err);  // stateCommitted
    bool rollBackPending(std::string& err);                             // stateRollingBack(·, 0)
    bool endPending(bool keepFrom, std::string& err);                   // stateEnded

    // Operation records ops/<opId>.json, written like state.json. A name that is not validOpId
    // is refused (nothing read or written).
    bool writeOp(const std::string& opId, const std::string& text, std::string& err);
    std::optional<std::string> readOp(const std::string& opId) const;
    void removeOp(const std::string& opId);
    std::vector<std::string> opIds() const;  // in no particular order

    // FR-027: the project installed the old way becomes v/1 of the empty store. Its files are
    // copied into staging (mkdirat, O_EXCL|O_NOFOLLOW, 0600, fsync), packed from that copy by
    // `pack` (stored, by the device), audit project.adopt ok is written, then v/1 and state.json
    // (active 1, source runtime-package). Any failure, the audit included, leaves the store empty.
    AdoptResult adopt(const LegacyProject& legacy, const PackFn& pack, const StoreAuditFn& audit);

    // state.json damaged (stateStatus() Corrupt): audit project.adopt (detail.reason
    // "state-corrupt", before any change), rename the file to state.json.corrupt-<monoMs>, write a
    // new state.json from the v/<seq> that have a valid meta.json: the version with the latest
    // activatedAt runs, the others follow (newest seq first), pending is null, nextSeq is above
    // every v/ directory. No such version: an empty, valid state (no project; a deploy is
    // possible). Any failure leaves the damaged file under its own name and the store Corrupt.
    RecoverResult recoverState(int64_t monoMs, const StoreAuditFn& audit);

    // A project installed the old way exists and could not be taken into the empty store: a
    // deploy would lose it, so begin() refuses (NO_BASE_PROJECT) with this reason. "" when there is
    // no such block; always "" once state.json exists.
    std::string baseBlockReason() const;
    void setBaseBlockReason(std::string reason);

    // Upload (404 NO_PROJECT_PACKAGE): why there is no package to read back; "" when there is.
    std::string noPackageReason() const;
    void setNoPackageReason(std::string reason);

    int64_t wallMs() const;
    bool clockSynced(int64_t wallMs) const;

   private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace mat
