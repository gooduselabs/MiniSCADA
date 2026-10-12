// The engineering API of mat-runtime (specs/005-device-online contracts/device-api.md §1–§4,
// research R5, R9, R10, R13, ADR-011): GET /api/v1/device/identity, POST /api/v1/auth/login,
// POST /api/v1/auth/logout, GET /api/v1/auth/session, the project routes of US2 (device-api
// §4: versions, manifest, package, deployments, operation, restore) once setProject() gave it the
// project store and the deploy pipeline, and the diagnostics and audit routes of US4 (§6, §7) once
// setDiagnostics() gave it the numbers.
//
// Installed on both listeners for every endpoint of the roles table (core/auth/roles.hpp). Each
// request goes through the gate (auth_gate.hpp) first: over HTTP it gets 403 HTTPS_REQUIRED; over
// HTTPS, endpoints of the table that this runtime does not serve yet answer 501 NOT_IMPLEMENTED
// after the gate (the project routes without setProject(); diagnostics and audit without
// setDiagnostics()),
// so a refusal never depends on what is implemented.
//
// Responses: JSON (UTF-8), Cache-Control: no-store, X-Content-Type-Options: nosniff, no CORS
// header; errors are {"error": <CODE>, "message": <Vietnamese sentence>, …}. Request bodies: at
// most 16 KiB (sign-in 4 KiB), else 413 BODY_TOO_LARGE; a chunked body gets 411. Over HTTPS the
// connection stays open (keep-alive) unless the body was too large to drain. The one exception is
// POST /api/v1/project/deployments: its body is a .matscada package (application/zip, at most
// 50 MiB, Content-Length required, never chunked) streamed to the deploy pipeline, and its
// connection closes after the answer.
#pragma once
#include <cstddef>
#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "core/diagnostics/proc_stats.hpp"
#include "core/discovery/discovery_proto.hpp"
#include "server/device_state.hpp"
#include "server/http/auth_gate.hpp"
#include "server/http/drivers_api.hpp"

struct mg_connection;
struct mg_context;

namespace mat {

class AuditLog;
class AuthService;
class WriteCoordinator;
class DeployPipeline;
class ProjectStore;

constexpr size_t kJsonBodyMaxBytes = 16 * 1024;  // device-api §1.2
constexpr size_t kLoginBodyMaxBytes = 4 * 1024;  // device-api §3
// A body over the limit is read and dropped up to this size, so the answer reaches the client and
// the connection can stay; above it (or chunked) the connection closes without reading it.
constexpr size_t kBodyDrainMaxBytes = 64 * 1024;

class EngineeringApi {
   public:
    struct Options {
        // "features" of device/identity: what this runtime serves. US2 adds deploy, upload,
        // restore; US4 diagnostics, audit.
        std::vector<std::string> features{"auth"};
    };

    // `audit` may be closed (open() failed): sign-ins and changes are then refused with 503
    // AUDIT_UNAVAILABLE. Every argument must outlive the CivetWeb contexts it is installed on.
    EngineeringApi(Options options, const DeviceState& device, AuthService& auth, AuditLog& audit);
    EngineeringApi(const EngineeringApi&) = delete;
    EngineeringApi& operator=(const EngineeringApi&) = delete;

    ~EngineeringApi();

    // The project routes (device-api §4) over this store and pipeline, which must outlive the
    // CivetWeb contexts and this object. Call before install(); adds deploy, upload and restore to
    // the features of device/identity. Without it the project routes answer 501.
    struct ProjectBackend {
        ProjectStore* store = nullptr;
        DeployPipeline* pipeline = nullptr;
    };
    void setProject(ProjectBackend backend);

    // GET /api/v1/diagnostics (viewer) and GET /api/v1/audit (administrator), device-api §6, §7.
    // The numbers come from the runtime through these callbacks (called on HTTP worker threads;
    // each must be thread-safe). Call before install(); adds diagnostics and audit to the
    // features of device/identity. Without it both routes answer 501.
    struct DiagnosticsBackend {
        std::function<ProcSnapshot()> proc;  // ProcStats::snapshot; required
        std::function<int()> liveClients;    // live sessions of both listeners
        std::function<int()> maxClients;
        std::function<discovery::Counters()> discovery;  // empty: all zero
        // The device clock is synchronised (clock_ok of the audit log); empty: false.
        std::function<bool(int64_t wallMs)> timeSynced;
        std::function<int64_t()> wallMs;  // UTC ms; empty: the system clock
        // Device API 1.1.0 (feature 006): the blocks "viewer", "tags" and "retain" of §2; each is
        // added to the answer as it is when its function is set.
        std::function<nlohmann::json()> viewer, tags, retain;
    };
    void setDiagnostics(DiagnosticsBackend backend);

    // POST /api/v1/drivers/test (engineer), device-api-1.1 §4. The test runs on the HTTP worker
    // thread that took the request (one at a time, at most ten a minute). Call before install();
    // adds "drivers" to the features of device/identity. Without it the route answers 501.
    struct DriversBackend {
        std::function<drv::TestOutcome(const drv::TcpProbeRequest&)> probeTcp;  // required
        std::function<int64_t()> monoMs;  // rate limit; empty: CLOCK_BOOTTIME
    };
    void setDrivers(DriversBackend backend);

    // POST /api/v1/tags/write (operator) and the questions about a result, device-api-1.1 §3, over
    // this coordinator, which must outlive the CivetWeb contexts. Call before install(); adds
    // "tag-write" to the features of device/identity. Without it the routes answer 501 (after the
    // gate). With it, the refusals of the gate on the write route (no session, a viewer, plain
    // HTTP) are audited as tag.write denied, with the Tag and the value, and not as access.denied.
    struct TagsBackend {
        WriteCoordinator* coordinator = nullptr;  // required
    };
    void setTags(TagsBackend backend);

    // Registers the endpoints of the roles table on `ctx` (HTTP or HTTPS listener).
    void install(mg_context* ctx);

   private:
    // `close`: the answer says Connection: close (always over HTTP, as in 0.3.0).
    static int onRequest(mg_connection* c, void* self);
    int handle(mg_connection* c);
    int identity(mg_connection* c, bool close);
    int login(mg_connection* c, const GateRequest& request, bool close);
    int logout(mg_connection* c, const GateRequest& request, bool close);
    int session(mg_connection* c, const GateDecision& decision, bool close);
    // Project routes (engineering_api_project.cpp).
    int projectRoute(mg_connection* c, const GateRequest& request, const GateDecision& decision,
                     bool close);
    int versions(mg_connection* c, bool close);
    int manifest(mg_connection* c, bool close);
    int package(mg_connection* c, const GateRequest& request, const GateDecision& decision,
                bool close);
    int deploy(mg_connection* c, const GateRequest& request, const GateDecision& decision);
    int restore(mg_connection* c, const GateRequest& request, const GateDecision& decision,
                bool close);
    int operation(mg_connection* c, const std::string& opId, bool close);
    // Diagnostics and audit routes (engineering_api.cpp).
    int diagnostics(mg_connection* c, bool close);
    int auditRead(mg_connection* c, const GateRequest& request, const GateDecision& decision,
                  bool close);
    // The tag write routes (tags_api.cpp).
    int tagsWrite(mg_connection* c, const GateRequest& request, const GateDecision& decision,
                  bool close);
    int tagsAsk(mg_connection* c, const GateRequest& request, const GateDecision& decision,
                bool close);
    // The gate refused POST /tags/write: the body is read if it can be, every request in it is
    // audited as denied, and the 401 / 403 / 503 carry `results` when the body was readable.
    int tagsRefused(mg_connection* c, const GateRequest& request, const GateDecision& decision,
                    bool close);
    bool skipDeniedAudit(const GateRequest& request) const;
    // The connection test (drivers_api.cpp).
    int driversTest(mg_connection* c, const GateRequest& request, const GateDecision& decision,
                    bool close);
    // Runs the steps of operation `opId` on a worker thread (one operation at a time).
    void runInBackground(const std::string& opId);

    Options opt_;
    const DeviceState& device_;
    AuthService& auth_;
    AuditLog& audit_;
    AuthGate gate_;
    ProjectBackend project_;
    DiagnosticsBackend diag_;
    DriversBackend drivers_;
    TagsBackend tags_;
    std::mutex testMu_;              // guards the two members below
    std::deque<int64_t> testTimes_;  // when the tests of the last minute began
    bool testBusy_ = false;
    std::mutex workerMu_;
    std::thread worker_;
};

}  // namespace mat
