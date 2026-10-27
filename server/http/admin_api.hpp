// The admin API and the page's access routes of feature 013 (specs/013-access-control
// contracts/admin-api.md §1 to §4, device-api 1.6.0):
//   GET  /api/v1/web/access                       the EffectiveAccess of the caller (also anonymous
//                                                 when viewerLogin is off)
//   POST /api/v1/web/password                     the caller's own password
//   GET|POST /api/v1/admin/users, POST …/users/{name}, …/{name}/password, …/{name}/delete
//   GET|POST /api/v1/admin/groups, POST …/groups/{id}, …/{id}/delete
//   GET|POST /api/v1/admin/access, POST …/access/cleanup, …/access/restore
//   GET  /api/v1/admin/effective?user=<name>
//   GET|POST /api/v1/admin/email, POST …/email/test   (feature 023, device-api 1.6.0 mở rộng,
//   apiVersion không đổi: alarm email)
//   GET|POST /api/v1/admin/apikeys, POST …/apikeys/{id}, …/{id}/revoke   (feature 025: API keys
//   of the data API; the token only in the answer of its creation, a key that may write needs
//   the re-entered password)
// The roles table (core/auth/roles.cpp) and the gate have already checked HTTPS, the session, the
// role (administrator for /admin/), Origin and the CSRF token of a cookie. Here: the body (at most
// 64 KiB of JSON, 400 before anything), 30 changes a minute per session (429), the `rev` the
// request was made on (409 CONFLICT), the re-entered password of sensitive changes (403
// REAUTH_REQUIRED, counted in the lockout of the caller), the rules (LAST_ADMIN, IN_USE, EXISTS,
// NOT_FOUND, WEAK_PASSWORD), the audit (written before the files, so that no change happens without
// its record: 503 AUDIT_UNAVAILABLE), then the files under the store's lock, then the sessions of
// the accounts changed end at once (D23). Never a password, a hash or `reauth` in an answer, the
// audit or the log (but the generated password, once, in the answer of its request).
#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/auth/access_service.hpp"
#include "core/auth/access_store.hpp"
#include "core/auth/api_keys.hpp"
#include "core/auth/auth_service.hpp"
#include "core/notify/email_service.hpp"
#include "nlohmann/json.hpp"

struct mg_connection;

namespace mat {

struct GateRequest;
struct GateDecision;
class DeviceAdmin;

constexpr size_t kAdminBodyMaxBytes = 64 * 1024;
constexpr int kAdminChangesPerMinute = 30;

struct AdminBackend {
    AuthService* auth = nullptr;
    AuthStore* store = nullptr;
    AccessService* access = nullptr;
    // Commits one record or throws (AuditLog::append).
    std::function<void(const AuditEvent&)> audit;
    std::string viewerLogin = "off";  // runtime.json: "off" | "required"
    // GET /web/access without a session (viewerLogin off): the source filter would serve the page
    // to this request. Empty: always.
    std::function<bool(const GateRequest&)> anonymousAllowed;
    std::function<int64_t()> monoMs;      // the rate limit; empty: bootTimeMs
    std::function<std::string()> nowIso;  // createdAt / updatedAt; empty: the system clock
    std::function<std::string(const std::string&)> hash;  // empty: hashPassword
    std::function<std::string()> generatePassword;        // empty: 20 random characters
    // Feature 023: the alarm email service (null: /admin/email answers 501).
    notify::EmailService* email = nullptr;
    // Feature 025: the API keys of the data API (null: /admin/apikeys answers 501).
    ApiKeyService* keys = nullptr;
    // Feature 027: settings.json and the certificate (null: /admin/device-settings and
    // /admin/cert/* answer 501).
    DeviceAdmin* device = nullptr;
};

// The person of a request, as the gate saw it.
struct AdminCaller {
    std::string user;  // "" anonymous
    Role role = Role::Viewer;
    std::vector<std::string> groups;
    int64_t accountRev = 0;
    int64_t usersRev = 0;
    ClientAddress from;
    bool viaCookie = false;
    std::string sessionKey;  // hash of the token: the rate limit and admin.read
    std::string webToken;    // the cookie session (kept by POST /web/password)
    bool signedIn() const { return !user.empty(); }
};

struct AdminReply {
    int status = 200;
    nlohmann::json body = nlohmann::json::object();
    std::string extra;  // header lines
};

class AdminApi {
   public:
    explicit AdminApi(AdminBackend backend);
    AdminApi(const AdminApi&) = delete;
    AdminApi& operator=(const AdminApi&) = delete;

    // The routes above, after the gate (EngineeringApi dispatches them here).
    int handle(mg_connection* c, const GateRequest& r, const GateDecision& d, bool close);

    // The same without a connection (tests): `path` without the query string, `body` the JSON
    // text (empty for a GET), `query` decoded name -> value.
    AdminReply call(const std::string& method, const std::string& path,
                    const std::map<std::string, std::string>& query, const std::string& body,
                    const AdminCaller& who);

    static AdminCaller callerOf(const GateRequest& r, const GateDecision& d);

   private:
    struct Impl;
    std::shared_ptr<Impl> impl_;
};

}  // namespace mat
