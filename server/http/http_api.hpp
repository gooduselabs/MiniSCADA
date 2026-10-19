// HTTP part of mat-runtime (specs/002-vertical-slice/contracts/http-api.md): runtime page with CSP,
// read-only API, and project files restricted to the validated allowlist. Installed on both
// listeners (feature 005, device-api §1.1): on HTTP every response closes its connection as in
// 0.3.0; on HTTPS the connection may stay open for the next request.
#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/auth/access_service.hpp"
#include "nlohmann/json.hpp"
#include "server/system_warnings.hpp"

struct mg_connection;
struct mg_context;

namespace mat {

class DeviceState;
class ViewerGate;
struct RequestOrigin;
class AlarmGlue;
namespace alarmsapi {
class SourceLimiter;
}
enum class FilterOutcome;

class HttpApi {
   public:
    struct Options {
        std::string docroot;
        std::string projectDir;
        std::vector<std::string> allowedOrigins;
        std::set<std::string> projectAllowlist;  // empty when the project is not active
        std::string activeProjectJson;           // empty when the project is not active
        nlohmann::json projectErrors = nlohmann::json::array();
        // Feature 005 (device-api §2): system/info gets the block "device" from it, and
        // "operation" (null unless the info provider gives one). Must outlive the contexts.
        const DeviceState* device = nullptr;
        // Feature 006 (FR-055a): the source filter of the page, the assets, the project files,
        // system/info and projects/active. Null: no filter (tests of the other features).
        ViewerGate* gate = nullptr;
        // Feature 007 (device-api-1.2 §3): GET /device.crt answers with this text, the certificate
        // blocks of server.pem (never a key: publicCertificatePem). Empty: 503.
        std::string deviceCertPem;
        // Feature 009 (device-api-1.3 §2): GET /api/v1/alarms and /api/v1/alarms/history behind the
        // same source filter as projects/active, and the block "alarms" of system/info. Null: the
        // two routes answer 404 (no alarm engine in this runtime), no block. Must outlive the
        // contexts.
        AlarmGlue* alarms = nullptr;
        // Feature 011 (device-api-011 §5): the warnings raised by the 1.0 sources, with `since` and
        // `detail`. Null: only the older warnings, each with the time HttpApi first saw it.
        const SystemWarnings* systemWarnings = nullptr;
        // The blocks `update` and `logic` of system/info (runtime.json `update.enabled`,
        // `logic.writes`; `logicPresent` once a logic file is loaded).
        bool updateEnabled = false;
        std::string logicWrites = "off";
        bool logicPresent = false;
        // Feature 011 (T138): logic.writes now ("off", "on", "stopped" by an administrator);
        // empty: logicWrites.
        std::function<std::string()> logicWritesNow;
        // Feature 013 (contracts/admin-api.md §6): the access of the person of a request (null:
        // every resource, as before). A screen file of a screen not viewed: 403 ACCESS_DENIED
        // (audited access.denied); viewed: without its hidden items and their grid cells; the SVG
        // and binding files of an SVG item only when the item is viewed; the report templates
        // only those viewed; projects/active with the viewed screens, menu entries and Tags; the
        // alarms only with page:alarms, those of its Tags.
        std::function<SessionAccessPtr(const RequestOrigin&)> accessOf;
        std::function<void(const AuditEvent&)> audit;
        // The owners (screen, item) of the files of SVG items; for a project before 0.3, the
        // screen of each SVG file (item "svg"). The report templates file, when there is one.
        std::map<std::string, std::vector<std::pair<std::string, std::string>>> itemFiles;
        std::string reportsFile;
    };
    using InfoProvider = std::function<nlohmann::json()>;

    HttpApi(Options opt, InfoProvider info);
    void install(mg_context* ctx);

   private:
    // 0: go on; otherwise the 403 was sent and this is the status to return.
    // `outcome`, when given, is the decision of the filter (MinimalInfo is served, with 0).
    int filtered(mg_connection* c, FilterOutcome* outcome = nullptr) const;
    static int onLogin(mg_connection* c, void* self);
    static int onDeviceCert(mg_connection* c, void* self);
    static int onIndex(mg_connection* c, void* self);
    static int onAsset(mg_connection* c, void* self);
    static int onInfo(mg_connection* c, void* self);
    static int onActive(mg_connection* c, void* self);
    static int onAlarms(mg_connection* c, void* self);
    static int onAlarmsHistory(mg_connection* c, void* self);
    static int onProjectFile(mg_connection* c, void* self);

    Options opt_;
    InfoProvider info_;
    std::set<std::string> assets_;  // file names under docroot/assets
    std::shared_ptr<alarmsapi::SourceLimiter> historyLimiter_;
    // `since` of the warnings that come without one (the codes older than feature 011).
    std::shared_ptr<std::mutex> firstSeenMu_ = std::make_shared<std::mutex>();
    std::shared_ptr<std::map<std::string, int64_t>> firstSeen_ =
        std::make_shared<std::map<std::string, int64_t>>();
    // Feature 013: projects/active as JSON, and its filtered texts by the fingerprint of an access.
    std::shared_ptr<const nlohmann::json> activeDoc_;
    std::shared_ptr<std::mutex> activeMu_ = std::make_shared<std::mutex>();
    std::shared_ptr<std::map<std::string, std::string>> activeByAccess_ =
        std::make_shared<std::map<std::string, std::string>>();
    // 0 to go on, or the 403 sent (ACCESS_DENIED, audited).
    int denied(mg_connection* c, const SessionAccess& a, const std::string& what) const;
};

}  // namespace mat
