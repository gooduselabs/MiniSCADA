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
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "core/diagnostics/daily_writes.hpp"
#include "core/diagnostics/emmc_life.hpp"
#include "core/diagnostics/proc_stats.hpp"
#include "core/diagnostics/run_record.hpp"
#include "core/discovery/discovery_proto.hpp"
#include "server/device_state.hpp"
#include "server/http/auth_gate.hpp"
#include "server/http/drivers_api.hpp"

struct mg_connection;
struct mg_context;

namespace mat {

class AlarmGlue;
namespace alarmsapi {
class PostLimiter;
}
class AuditLog;
class AuthService;
class WriteCoordinator;
class HistoryApi;
class HostPolicy;
class DeployPipeline;
class ProjectStore;
class LogicSubsystem;
class UpdateService;
struct UpdateCaller;
class AdminApi;
class AccessService;

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
        // Feature 011 (device-api-011 §1): device/identity.acceptedHosts. Null: no such block.
        const HostPolicy* hostPolicy = nullptr;
        // Feature 013: runtime.json viewerLogin, in GET /api/v1/web/session.
        std::string viewerLogin = "off";
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
        // Feature 011 (FR-009, device-api-011 §5): the KPI keys. Each one empty: its key is null
        // (never a made-up 0). The rest (uptimeS, rssMb, rssPeakMb, cpuPct, fdCount, threads)
        // comes from `proc`.
        std::function<RestartInfo()> restarts;
        std::function<WritesToday()> writesToday;  // DailyWriteMeter::today
        std::function<EmmcLife()> emmcLife;
        std::function<std::optional<int64_t>()> liveLagP95Ms;
    };
    void setDiagnostics(DiagnosticsBackend backend);

    // POST /api/v1/drivers/test (engineer), device-api-1.1 §4. The test runs on the HTTP worker
    // thread that took the request (one at a time, at most ten a minute). Call before install();
    // adds "drivers" to the features of device/identity. Without it the route answers 501.
    struct DriversBackend {
        std::function<drv::TestOutcome(const drv::TcpProbeRequest&)> probeTcp;  // required
        // Modbus RTU (T164): the test of a channel on `port` as the project names it ("ttyAS2");
        // the request carries the device path and the frame. The function refuses the console and
        // ports out of `serialPorts` (PORT_CONSOLE, PORT_NOT_ALLOWED), sends the request through
        // the channel that holds the port when its frame is the same, PORT_BUSY when it is not.
        // Empty: a modbus-rtu test answers 501.
        std::function<drv::TestOutcome(const std::string& port, const drv::RtuProbeRequest&)>
            probeRtu;
        // GET /api/v1/drivers/diagnostics (US5, T195): the whole body of §5. Empty: 501.
        std::function<nlohmann::json()> diagnostics;
        std::function<int64_t()> monoMs;  // rate limit; empty: CLOCK_BOOTTIME
    };
    void setDrivers(DriversBackend backend);

    // GET /api/v1/serial/ports[?probe=1] (engineer), device-api-1.1 §6. `list` returns the body;
    // with `probe` it asks the ports that are allowed and free, and names them in `probed` (one
    // audit row driver.test each, code RS485_PROBE). It opens nothing without `probe`. Call before
    // install(); adds "serial-ports" to the features of device/identity. Without it: 501.
    struct SerialBackend {
        std::function<nlohmann::json(bool probe, std::vector<std::string>& probed)> list;
    };
    void setSerial(SerialBackend backend);

    // POST /api/v1/tags/write (operator) and the questions about a result, device-api-1.1 §3, over
    // this coordinator, which must outlive the CivetWeb contexts. Call before install(); adds
    // "tag-write" to the features of device/identity. Without it the routes answer 501 (after the
    // gate). With it, the refusals of the gate on the write route (no session, a viewer, plain
    // HTTP) are audited as tag.write denied, with the Tag and the value, and not as access.denied.
    struct TagsBackend {
        WriteCoordinator* coordinator = nullptr;  // required
    };
    void setTags(TagsBackend backend);

    // POST /api/v1/alarms/{ack,shelve,unshelve,disable,enable} (feature 009, device-api-1.3 §3)
    // over this glue, which must outlive the CivetWeb contexts. Call before install(); adds
    // "alarms" to the features of device/identity. Without it the routes answer 501 (after the
    // gate). The two GET routes of the table (list, history) belong to HttpApi (the page's source
    // filter), so install() leaves them out.
    struct AlarmsBackend {
        AlarmGlue* glue = nullptr;
        std::function<int64_t()> monoMs;  // the rate limit; empty: the steady clock
    };
    void setAlarms(AlarmsBackend backend);
    // GET /api/v1/history/* (viewer), feature 010. The object must outlive the CivetWeb contexts.
    // Call before install(); adds "history" to the features of device/identity. Without it the
    // routes answer 501 after the gate.
    void setHistory(HistoryApi* api);

    // GET /api/v1/logic (viewer, also the cookie of the page), POST /api/v1/logic/writes
    // (administrator: only {"enabled": false}) and POST /api/v1/logic/reset (engineer), feature
    // 011 (device-api-011 §4). `logic` gives the subsystem of the running project (null: no
    // logic.json, GET answers {"enabled": false}); called on HTTP workers. Call before install();
    // adds "logic" to the features of device/identity. Without it the routes answer 501.
    struct LogicBackend {
        std::function<LogicSubsystem*()> logic;
    };
    void setLogic(LogicBackend backend);

    // GET/POST /api/v1/system/update, POST …/apply, …/cancel, …/rollback (administrator, Bearer
    // only, HTTPS), feature 011 (device-api-011 §3). 404 UPDATE_DISABLED while the service is off.
    // Call before install(); adds "update" to the features of device/identity. Without it the
    // routes answer 501.
    struct UpdateBackend {
        UpdateService* service = nullptr;
    };
    void setUpdate(UpdateBackend backend);

    // Feature 013 (contracts/admin-api.md): GET /api/v1/web/access, POST /api/v1/web/password and
    // /api/v1/admin/* go to `admin` (they answer 501 without it); the access model of the sessions
    // checks the cookie's tag writes (context.screen, context.widget, operate) and the alarm
    // actions. Both must outlive the contexts. Call before install().
    void setAdmin(AdminApi* admin);
    void setAccess(AccessService* access);

    // Registers the endpoints of the roles table on `ctx` (HTTP or HTTPS listener).
    void install(mg_context* ctx);

   private:
    // `close`: the answer says Connection: close (always over HTTP, as in 0.3.0).
    static int onRequest(mg_connection* c, void* self);
    int handle(mg_connection* c);
    int identity(mg_connection* c, const GateRequest& r, bool close);
    int login(mg_connection* c, const GateRequest& request, bool close);
    int logout(mg_connection* c, const GateRequest& request, bool close);
    int session(mg_connection* c, const GateDecision& decision, bool close);
    // The sign-in of the runtime page (web_api.cpp; feature 007).
    int webLogin(mg_connection* c, const GateRequest& request, bool close);
    int webSession(mg_connection* c, const GateDecision& decision, bool close);
    int webTouch(mg_connection* c, bool close);
    int webLogout(mg_connection* c, const GateRequest& request, const GateDecision& decision,
                  bool close);
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
    // The alarm routes (alarms_api.cpp).
    int alarmsPost(mg_connection* c, const GateRequest& request, const GateDecision& decision,
                   bool close);
    // The routes of logic (logic_api.cpp).
    int logicRoute(mg_connection* c, const GateRequest& request, const GateDecision& decision,
                   bool close);
    // The routes of OTA (update_api.cpp).
    int updateRoute(mg_connection* c, const GateRequest& request, const GateDecision& decision,
                    bool close);
    int updateUpload(mg_connection* c, const UpdateCaller& who);
    // The connection test (drivers_api.cpp).
    int driversTest(mg_connection* c, const GateRequest& request, const GateDecision& decision,
                    bool close);
    int driversDiagnostics(mg_connection* c, bool close);
    int serialPorts(mg_connection* c, const GateRequest& request, const GateDecision& decision,
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
    HistoryApi* history_ = nullptr;
    SerialBackend serial_;
    AlarmsBackend alarms_;
    LogicBackend logic_;
    UpdateBackend update_;
    AdminApi* admin_ = nullptr;
    AccessService* access_ = nullptr;
    std::unique_ptr<alarmsapi::PostLimiter> postLimiter_;
    std::mutex testMu_;              // guards the two members below
    std::deque<int64_t> testTimes_;  // when the tests of the last minute began
    bool testBusy_ = false;
    std::mutex workerMu_;
    std::thread worker_;
};

}  // namespace mat
