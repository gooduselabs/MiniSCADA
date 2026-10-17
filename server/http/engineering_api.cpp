#include "server/http/engineering_api.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <map>
#include <set>
#include <string>
#include <utility>

#include "civetweb.h"
#include "core/audit/audit_log.hpp"
#include "core/audit/audit_record_json.hpp"
#include "core/auth/auth_service.hpp"
#include "core/auth/password_hash.hpp"
#include "core/common/json_limits.hpp"
#include "core/common/json_text.hpp"
#include "core/crypto/hex.hpp"
#include "core/crypto/sha256.hpp"
#include "core/project-manager/project_validator.hpp"
#include "core/project-store/store.hpp"
#include "nlohmann/json.hpp"
#include "server/host_policy.hpp"
#include "server/http/alarms_api.hpp"
#include "server/http/engineering_api_internal.hpp"
#include "server/http/history_api.hpp"
#include "server/websocket/live_hub.hpp"

namespace mat {

namespace eapi {

using nlohmann::json;

// The headers of device-api §1.2 on every answer; `extra` adds whole header lines.
int send(mg_connection* c, int status, const std::string& body, bool close,
         const std::string& extra) {
    // 204 has neither a body nor its headers (RFC 9110 §8.6).
    const std::string type =
        status == 204 ? std::string()
                      : "Content-Type: application/json; charset=utf-8\r\nContent-Length: " +
                            std::to_string(body.size()) + "\r\n";
    mg_printf(c,
              "HTTP/1.1 %d %s\r\n%sCache-Control: no-store\r\nX-Content-Type-Options: "
              "nosniff\r\nReferrer-Policy: no-referrer\r\n"
              "%s%s\r\n",
              status, mg_get_response_code_text(c, status), type.c_str(), extra.c_str(),
              close ? "Connection: close\r\n" : "");
    if (status != 204 && !body.empty()) mg_write(c, body.data(), body.size());
    return status;
}

int sendError(mg_connection* c, int status, const std::string& code, bool close,
              const std::string& extra, json more) {
    more["error"] = code;
    if (!more.contains("message")) more["message"] = gateMessage(code);
    return send(c, status, jsonText(more), close, extra);
}

bool readBody(mg_connection* c, std::string& out) {
    const long long n = mg_get_request_info(c)->content_length;
    if (n <= 0) return true;  // none (no Content-Length means no body, RFC 9112 §6.3)
    out.assign(static_cast<size_t>(n), '\0');
    size_t got = 0;
    while (got < out.size()) {
        const int r = mg_read(c, &out[got], out.size() - got);
        if (r <= 0) return false;
        got += static_cast<size_t>(r);
    }
    return true;
}

void drain(mg_connection* c) {
    char buf[4096];
    while (mg_read(c, buf, sizeof buf) > 0) {
    }
}

}  // namespace eapi

namespace {

using eapi::drain;
using eapi::readBody;
using eapi::send;
using eapi::sendError;
using nlohmann::json;

// Request bodies of the engineering API are flat objects; deeper JSON is refused before the
// parser (which recurses per level) sees it.
constexpr int kMaxBodyDepth = 8;

constexpr const char* kIdentityPath = "/api/v1/device/identity";
constexpr const char* kLoginPath = "/api/v1/auth/login";
constexpr const char* kLogoutPath = "/api/v1/auth/logout";
constexpr const char* kWebLoginPath = "/api/v1/web/login";
constexpr const char* kWebLogoutPath = "/api/v1/web/logout";
constexpr const char* kWebSessionPath = "/api/v1/web/session";
constexpr const char* kWebTouchPath = "/api/v1/web/touch";
constexpr const char* kSessionPath = "/api/v1/auth/session";
constexpr const char* kDeployPath = "/api/v1/project/deployments";
constexpr const char* kDiagnosticsPath = "/api/v1/diagnostics";
constexpr const char* kAuditPath = "/api/v1/audit";
constexpr const char* kDriversTestPath = "/api/v1/drivers/test";
constexpr const char* kDriversDiagPath = "/api/v1/drivers/diagnostics";
constexpr const char* kSerialPortsPath = "/api/v1/serial/ports";
constexpr const char* kTagsWritePath = "/api/v1/tags/write";
constexpr const char* kTagsWriteIdPath = "/api/v1/tags/write/{requestId}";

// "/api/v1/project/deployments/{opId}" → CivetWeb pattern "/api/v1/project/deployments/*$".
std::string handlerPattern(const char* path) {
    std::string out;
    for (const char* s = path; *s; ++s) {
        if (*s == '{') {
            out += '*';
            while (*s && *s != '}') ++s;
            if (!*s) break;
        } else {
            out += *s;
        }
    }
    return out + "$";
}

GateDeps gateDeps(AuthService& auth, AuditLog& audit,
                  std::function<bool(const GateRequest&)> skipDenied) {
    GateDeps d;
    d.skipDeniedAudit = std::move(skipDenied);
    // Feature 007: the cookie branch of the gate.
    d.authorizeWeb = [&auth](std::string_view token, const ClientAddress& from, Role role,
                             bool refresh) {
        return auth.authorizeWeb(token, from, role, refresh);
    };
    d.touchWeb = [&auth](std::string_view token) { auth.touchWeb(token); };
    d.authorize = [&auth](std::string_view token, const ClientAddress& from, Role role,
                          bool refresh) { return auth.authorize(token, from, role, refresh); };
    d.audit = [&audit](const AuditEvent& e) { audit.append(e); };
    d.auditAvailable = [&audit] { return audit.isOpen(); };
    return d;
}

}  // namespace

EngineeringApi::EngineeringApi(Options options, const DeviceState& device, AuthService& auth,
                               AuditLog& audit)
    : opt_(std::move(options)),
      device_(device),
      auth_(auth),
      audit_(audit),
      gate_(gateDeps(auth, audit, [this](const GateRequest& q) { return skipDeniedAudit(q); })) {
    // Feature 007: the sign-in of the page and the screens of project 0.3 are served.
    for (const char* f : {"web-login", "screens-v1"}) opt_.features.push_back(f);
}

bool EngineeringApi::skipDeniedAudit(const GateRequest& q) const {
    return tags_.coordinator != nullptr && q.method == "POST" && q.path == kTagsWritePath;
}

void EngineeringApi::setTags(TagsBackend backend) {
    tags_ = backend;
    if (!tags_.coordinator) return;
    if (std::find(opt_.features.begin(), opt_.features.end(), "tag-write") == opt_.features.end())
        opt_.features.push_back("tag-write");
    // Feature 007: the optional fields of the write (device-api-1.2 §5).
    for (const char* f : {"write-pulse", "write-expect"})
        if (std::find(opt_.features.begin(), opt_.features.end(), f) == opt_.features.end())
            opt_.features.push_back(f);
}

EngineeringApi::~EngineeringApi() {
    std::lock_guard<std::mutex> l(workerMu_);
    if (worker_.joinable()) worker_.join();
}

void EngineeringApi::setProject(ProjectBackend backend) {
    project_ = backend;
    if (!backend.store || !backend.pipeline) return;
    for (const char* f : {"deploy", "upload", "restore"})
        if (std::find(opt_.features.begin(), opt_.features.end(), f) == opt_.features.end())
            opt_.features.push_back(f);
}

void EngineeringApi::setDiagnostics(DiagnosticsBackend backend) {
    diag_ = std::move(backend);
    if (!diag_.proc) return;
    for (const char* f : {"diagnostics", "audit"})
        if (std::find(opt_.features.begin(), opt_.features.end(), f) == opt_.features.end())
            opt_.features.push_back(f);
}

void EngineeringApi::setDrivers(DriversBackend backend) {
    drivers_ = std::move(backend);
    if (!drivers_.probeTcp) return;
    if (std::find(opt_.features.begin(), opt_.features.end(), "drivers") == opt_.features.end())
        opt_.features.push_back("drivers");
}

void EngineeringApi::setSerial(SerialBackend backend) {
    serial_ = std::move(backend);
    if (!serial_.list) return;
    if (std::find(opt_.features.begin(), opt_.features.end(), "serial-ports") ==
        opt_.features.end())
        opt_.features.push_back("serial-ports");
}

void EngineeringApi::setHistory(HistoryApi* api) {
    history_ = api;
    if (api) opt_.features.push_back("history");
}

void EngineeringApi::install(mg_context* ctx) {
    std::set<std::string> patterns;  // one handler per path of the table, whatever its methods
    for (const auto& rule : endpointRules()) {
        // the two reads of the alarms are HttpApi's (the page's source filter, feature 009)
        const std::string path = rule.path;
        if (path == "/api/v1/alarms" || path == "/api/v1/alarms/history") continue;
        patterns.insert(handlerPattern(rule.path));
    }
    for (const auto& p : patterns) mg_set_request_handler(ctx, p.c_str(), onRequest, this);
}

int EngineeringApi::onRequest(mg_connection* c, void* self) {
    try {  // an exception here would end the runtime from inside CivetWeb
        return static_cast<EngineeringApi*>(self)->handle(c);
    } catch (const std::exception&) {
        mg_disable_connection_keep_alive(c);
        return sendError(c, 500, "INTERNAL_ERROR", true);
    }
}

int EngineeringApi::handle(mg_connection* c) {
    const mg_request_info* ri = mg_get_request_info(c);
    GateRequest r;
    r.method = ri->request_method ? ri->request_method : "";
    r.path = ri->local_uri ? ri->local_uri : "";  // decoded, without the query string
    r.tls = ri->is_ssl != 0;
    if (const char* h = mg_get_header(c, "Authorization")) r.authorization = std::string(h);
    r.from = ClientAddress{ri->remote_addr, ri->remote_port};
    // Feature 007: what the cookie branch of the gate looks at.
    if (const char* h = mg_get_header(c, "Cookie")) r.cookie = std::string(h);
    if (const char* h = mg_get_header(c, "Origin")) r.origin = std::string(h);
    if (const char* h = mg_get_header(c, "Host")) r.host = std::string(h);
    if (const char* h = mg_get_header(c, "X-MAT-CSRF")) r.csrf = std::string(h);
    if (const char* h = mg_get_header(c, "Sec-Fetch-Site")) r.secFetchSite = std::string(h);

    // A body CivetWeb would read after the answer to keep the connection: chunked, or more than
    // we drain. The connection closes instead.
    const bool chunked = mg_get_header(c, "Transfer-Encoding") != nullptr;
    const bool hugeBody =
        chunked || ri->content_length > static_cast<long long>(kBodyDrainMaxBytes);
    if (hugeBody) mg_disable_connection_keep_alive(c);
    const bool close = !r.tls || hugeBody;

    const GateDecision d = gate_.check(r);
    if (!d.through() && skipDeniedAudit(r) &&
        (d.status == 401 || d.status == 403 || d.status == 503))
        return tagsRefused(c, r, d, close);
    if (!d.through()) {
        std::string extra;
        if (d.status == 401 && !d.viaCookie) extra = "WWW-Authenticate: Bearer\r\n";
        if (d.status == 405) extra = "Allow: " + d.allow + "\r\n";
        return sendError(c, d.status, d.error, close, extra);
    }
    const std::string path = d.rule->path;
    // POST /api/v1/project/deployments has its own limits (application/zip, Content-Length at most
    // 50 MiB, never chunked), checked before anything of its body is read (device-api §4).
    const bool packageUpload =
        path == kDeployPath || (path == "/api/v1/system/update" && r.method == "POST");
    if (std::strcmp(d.rule->method, "POST") == 0 && !packageUpload) {
        // JSON bodies (device-api §1.2).
        const size_t limit =
            path == kLoginPath || path == kWebLoginPath ? kLoginBodyMaxBytes : kJsonBodyMaxBytes;
        if (chunked) return sendError(c, 411, "LENGTH_REQUIRED", close);
        if (ri->content_length > static_cast<long long>(limit)) {
            if (!hugeBody) drain(c);
            return sendError(c, 413, "BODY_TOO_LARGE", close);
        }
    }
    if (path == kIdentityPath) return identity(c, r, close);
    if (path == kLoginPath) return login(c, r, close);
    if (path == kLogoutPath) return logout(c, r, close);
    if (path == kSessionPath) return session(c, d, close);
    if (path == kWebLoginPath) return webLogin(c, r, close);
    if (path == kWebLogoutPath) return webLogout(c, r, d, close);
    if (path == kWebSessionPath) return webSession(c, d, close);
    if (path == kWebTouchPath) return webTouch(c, close);
    if (path.rfind("/api/v1/project/", 0) == 0) return projectRoute(c, r, d, close);
    if (diag_.proc && path == kDiagnosticsPath) return diagnostics(c, close);
    if (diag_.proc && path == kAuditPath) return auditRead(c, r, d, close);
    if (drivers_.probeTcp && path == kDriversTestPath) return driversTest(c, r, d, close);
    if (drivers_.diagnostics && path == kDriversDiagPath) return driversDiagnostics(c, close);
    if (serial_.list && path == kSerialPortsPath) return serialPorts(c, r, d, close);
    if (history_ && path.rfind("/api/v1/history/", 0) == 0) return history_->handle(c, r, d, close);
    if (tags_.coordinator && path == kTagsWritePath) {
        return r.method == "POST" ? tagsWrite(c, r, d, close) : tagsAsk(c, r, d, close);
    }
    if (tags_.coordinator && path == kTagsWriteIdPath) return tagsAsk(c, r, d, close);
    if (path.rfind("/api/v1/alarms/", 0) == 0) return alarmsPost(c, r, d, close);  // feature 009
    if (logic_.logic && path.rfind("/api/v1/logic", 0) == 0)
        return logicRoute(c, r, d, close);  // feature 011
    if (update_.service && path.rfind("/api/v1/system/update", 0) == 0)
        return updateRoute(c, r, d, close);  // feature 011 (OTA)
    // Endpoints of the table this runtime does not serve (the routes of a story not set up).
    return sendError(c, 501, "NOT_IMPLEMENTED", close);
}

int EngineeringApi::identity(mg_connection* c, const GateRequest& r, bool close) {
    const DeviceFacts f = device_.facts();
    json body = {
        {"deviceId", f.deviceId},
        {"name", f.name},
        {"model", f.model},
        {"runtimeVersion", kRuntimeVersion},
        {"apiVersion", kDeviceApiVersion},
        {"protocolVersion", kLiveProtocolVersion},
        {"httpPort", f.httpPort},
        {"httpsPort", f.httpsPort},
        {"fingerprint", f.fingerprint.empty() ? json(nullptr) : json(f.fingerprint)},
        {"setupRequired", auth_.setupRequired()},
        {"features", opt_.features},
    };
    // 011 §1. L6 of the security review of 011: the names the device answers to help a page of
    // another site aim at it; they go only to a caller with a session (the Studio reads identity
    // again once signed in), never to an anonymous one.
    if (opt_.hostPolicy) {
        bool withSession = false;
        if (r.authorization) {
            if (const auto token = bearerToken(*r.authorization))
                withSession =
                    auth_.authorize(*token, r.from, Role::Viewer, false).status == AccessStatus::Ok;
        } else if (const auto web = sessionCookieToken(r.cookie)) {
            withSession =
                auth_.authorizeWeb(*web, r.from, Role::Viewer, false).status == AccessStatus::Ok;
        }
        if (withSession) body["acceptedHosts"] = opt_.hostPolicy->acceptedHosts();
    }
    return send(c, 200, jsonText(body), close);
}

int EngineeringApi::login(mg_connection* c, const GateRequest& r, bool close) {
    std::string body;
    struct Wipe {
        std::string& s;
        ~Wipe() { secureZero(s); }
    } wipeBody{body};
    if (!readBody(c, body)) {  // the client stopped sending: do not wait for the rest again
        mg_disable_connection_keep_alive(c);
        return sendError(c, 400, "BAD_REQUEST", true);
    }
    if (jsonNestingDepth(body.data(), body.size()) > kMaxBodyDepth)
        return sendError(c, 400, "BAD_REQUEST", close);
    json j = json::parse(body, nullptr, false);
    secureZero(body);
    if (!j.is_object() || !j.contains("user") || !j["user"].is_string() ||
        !j.contains("password") || !j["password"].is_string())
        return sendError(c, 400, "BAD_REQUEST", close);
    std::string& password = j["password"].get_ref<std::string&>();
    struct WipePassword {
        std::string& s;
        ~WipePassword() { secureZero(s); }
    } wipePassword{password};
    const std::string user = j["user"].get<std::string>();
    // device-api §3: user ≤ 64 bytes, password ≤ 512 bytes (128 characters).
    if (user.size() > kLoginMaxUserBytes || password.size() > kPasswordMaxBytes)
        return sendError(c, 400, "BAD_REQUEST", close);
    // No token without its audit record: do not even spend the hash when the log is down.
    if (!audit_.isOpen()) return sendError(c, 503, "AUDIT_UNAVAILABLE", close);

    LoginResult res = auth_.login(user, password, r.from);  // wipes the password
    switch (res.status) {
        case LoginStatus::Ok: {
            std::string out = jsonText({{"token", res.token},
                                        {"user", res.user},
                                        {"role", roleName(res.role)},
                                        {"idleTimeoutS", kIdleTimeoutS},
                                        {"maxLifetimeS", kMaxLifetimeS}});
            secureZero(res.token);
            const int status = send(c, 200, out, close);
            secureZero(out);
            return status;
        }
        case LoginStatus::Locked:
            return sendError(c, 429, "AUTH_LOCKED", close,
                             "Retry-After: " + std::to_string(res.retryAfterS) + "\r\n",
                             {{"retryAfterS", res.retryAfterS}});
        case LoginStatus::Busy:
            return sendError(c, 429, "LOGIN_BUSY", close, "Retry-After: 1\r\n");  // FR-016
        case LoginStatus::AuditUnavailable:
            return sendError(c, 503, "AUDIT_UNAVAILABLE", close);
        case LoginStatus::Error:
            return sendError(c, 500, "INTERNAL_ERROR", close);
        case LoginStatus::Failed:
            break;
    }
    return sendError(c, 401, "AUTH_FAILED", close);
}

int EngineeringApi::logout(mg_connection* c, const GateRequest& r, bool close) {
    const std::string header = r.authorization.value_or("");  // the token views into it
    const auto token = bearerToken(header);
    const AccessStatus s = token ? auth_.logout(*token, r.from) : AccessStatus::SessionExpired;
    if (s == AccessStatus::Ok) return send(c, 204, "", close);
    // The session ended between the gate and here.
    return sendError(c, 401, accessErrorCode(s), close, "WWW-Authenticate: Bearer\r\n");
}

int EngineeringApi::session(mg_connection* c, const GateDecision& d, bool close) {
    const json body = {{"user", d.access.user},
                       {"role", d.access.role ? roleName(*d.access.role) : ""},
                       {"idleRemainingS", d.access.idleRemainingS},
                       {"lifetimeRemainingS", d.access.lifetimeRemainingS}};
    return send(c, 200, jsonText(body), close);
}

// ---------- GET /diagnostics, GET /audit (device-api §6, §7) ----------

namespace {

double round1(double v) { return std::round(v * 10.0) / 10.0; }

int hexValue(char x) {
    if (x >= '0' && x <= '9') return x - '0';
    if (x >= 'a' && x <= 'f') return x - 'a' + 10;
    if (x >= 'A' && x <= 'F') return x - 'A' + 10;
    return -1;
}

// The query string of a request as name → value, percent-decoded ('+' is a space). false for a
// malformed escape, a name given twice, or a part without a name or without '='. An absent query
// is an empty map.
bool parseQuery(const char* query, std::map<std::string, std::string>& out) {
    out.clear();
    if (!query || !*query) return true;
    const std::string q = query;
    size_t at = 0;
    for (;;) {
        size_t end = q.find('&', at);
        if (end == std::string::npos) end = q.size();
        const std::string part = q.substr(at, end - at);
        const size_t eq = part.find('=');
        if (eq == std::string::npos || eq == 0) return false;
        std::string value;
        for (size_t i = eq + 1; i < part.size(); ++i) {
            const char ch = part[i];
            if (ch == '+') {
                value += ' ';
            } else if (ch == '%') {
                if (i + 2 >= part.size()) return false;  // needs two hex digits
                const int hi = hexValue(part[i + 1]);
                const int lo = hexValue(part[i + 2]);
                if (hi < 0 || lo < 0) return false;
                value += static_cast<char>(hi * 16 + lo);
                i += 2;
            } else {
                value += ch;
            }
        }
        if (!out.emplace(part.substr(0, eq), value).second) return false;
        if (end >= q.size()) return true;
        at = end + 1;
    }
}

// 1 … 15 digits, no sign, no leading space.
bool parseCount(const std::string& s, int64_t& out) {
    if (s.empty() || s.size() > 15) return false;
    int64_t v = 0;
    for (char ch : s) {
        if (ch < '0' || ch > '9') return false;
        v = v * 10 + (ch - '0');
    }
    out = v;
    return true;
}

bool printable(const std::string& s) {
    for (unsigned char ch : s)
        if (ch < 0x20 || ch == 0x7f) return false;
    return true;
}

// The parameters of GET /audit (§7); nullopt: 400.
std::optional<AuditQuery> auditQueryOf(const std::map<std::string, std::string>& p) {
    AuditQuery q;
    for (const auto& [name, value] : p) {
        int64_t n = 0;
        if (name == "from" || name == "to") {
            if (!parseCount(value, n)) return std::nullopt;
            (name == "from" ? q.fromMs : q.toMs) = n;
        } else if (name == "before") {
            if (!parseCount(value, n) || n < 1) return std::nullopt;
            q.beforeId = n;
        } else if (name == "limit") {
            if (!parseCount(value, n) || n < 1 || n > kAuditQueryMaxLimit) return std::nullopt;
            q.limit = static_cast<int>(n);
        } else if (name == "user") {
            if (value.empty() || value.size() > 64 || !printable(value)) return std::nullopt;
            q.user = value;
        } else if (name == "target") {  // feature 006: a Tag id (exact)
            if (value.empty() || value.size() > 256 || !printable(value)) return std::nullopt;
            q.target = value;
        } else if (name == "action") {
            // An action name or the start of one: lower-case letters, digits, '.' and '-'.
            if (value.empty() || value.size() > 64) return std::nullopt;
            for (char ch : value)
                if (!((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '.' ||
                      ch == '-'))
                    return std::nullopt;
            q.actionPrefix = value;
        } else {
            return std::nullopt;  // an unknown name would silently widen the answer
        }
    }
    return q;
}

}  // namespace

int EngineeringApi::diagnostics(mg_connection* c, bool close) {
    const ProcSnapshot p = diag_.proc();
    const int64_t wall = diag_.wallMs ? diag_.wallMs()
                                      : std::chrono::duration_cast<std::chrono::milliseconds>(
                                            std::chrono::system_clock::now().time_since_epoch())
                                            .count();
    const discovery::Counters dc = diag_.discovery ? diag_.discovery() : discovery::Counters{};
    const DeviceFacts facts = device_.facts();
    json disk = nullptr;
    if (p.disk)
        disk = {{"path", p.diskPath},
                {"totalBytes", p.disk->totalBytes},
                {"freeBytes", p.disk->freeBytes}};
    json body = {
        {"at", wall},
        {"timeSynced", diag_.timeSynced ? diag_.timeSynced(wall) : false},
        {"cpu",
         {{"systemPct1m", round1(p.systemPct1m)},
          {"runtimePct1m", round1(p.runtimePct1m)},
          {"loadAvg1", p.loadAvg1},
          {"cores", p.cores}}},
        {"memory",
         {{"runtimeRssBytes", p.runtimeRssBytes},
          {"systemTotalBytes", p.systemTotalBytes},
          {"systemAvailableBytes", p.systemAvailableBytes}}},
        {"disk", disk},
        {"uptime",
         {{"systemS", static_cast<int64_t>(p.systemUptimeS)},
          {"runtimeS", static_cast<int64_t>(p.runtimeUptimeS)}}},
        {"clients",
         {{"live", diag_.liveClients ? diag_.liveClients() : 0},
          {"max", diag_.maxClients ? diag_.maxClients() : 0},
          {"sessions", static_cast<int64_t>(auth_.activeSessions())}}},
        {"discovery",
         {{"enabled", facts.discovery},
          {"replies", dc.replies},
          {"dropped",
           {{"subnet", dc.subnet}, {"format", dc.format}, {"rate", dc.rate}, {"port", dc.port}}}}},
        {"versions",
         {{"runtime", kRuntimeVersion},
          {"protocol", kLiveProtocolVersion},
          {"api", kDeviceApiVersion}}},
    };
    // Feature 011 (FR-009, device-api-011 §5): the KPI keys; what is not known is null.
    const auto mib = [](int64_t bytes) { return round1(static_cast<double>(bytes) / 1048576.0); };
    const auto opt = [](const std::optional<int64_t>& v) { return v ? json(*v) : json(nullptr); };
    body["uptimeS"] = static_cast<int64_t>(p.runtimeUptimeS);
    body["rssMb"] = mib(p.runtimeRssBytes);
    body["rssPeakMb"] = mib(std::max(p.runtimeRssPeakBytes, p.runtimeRssBytes));
    body["cpuPct"] = round1(p.runtimePct5m);
    body["fdCount"] = opt(p.fdCount);
    body["threads"] = opt(p.threads);
    if (diag_.restarts) {
        const RestartInfo ri = diag_.restarts();
        body["restarts"] = {
            {"total", ri.total},
            {"lastReason", ri.lastReason.empty() ? json(nullptr) : json(ri.lastReason)},
            {"lastAt", ri.lastAtMs ? json(isoUtc(*ri.lastAtMs)) : json(nullptr)},
            {"bootChanged", ri.bootChanged}};
    } else {
        body["restarts"] = nullptr;
    }
    body["ioWriteBytesToday"] = nullptr;
    if (diag_.writesToday) {
        const WritesToday t = diag_.writesToday();
        if (t.sampled) {
            const ComponentWrites cw = componentWrites(t);
            body["ioWriteBytesToday"] = {{"total", cw.total},   {"history", cw.history},
                                         {"audit", cw.audit},   {"alarm", cw.alarm},
                                         {"retain", cw.retain}, {"logic", cw.logic},
                                         {"log", opt(cw.log)},  {"other", opt(cw.other)}};
            body["ioWriteSource"] = cw.source;
            body["ioWriteSince"] = cw.sinceMs;
        }
    }
    body["emmcLife"] = nullptr;
    if (diag_.emmcLife) {
        const EmmcLife e = diag_.emmcLife();
        if (e.available)
            body["emmcLife"] = {
                {"typeA", e.typeA}, {"typeB", e.typeB}, {"preEol", e.preEol}, {"source", e.source}};
        else
            body["emmcLifeReason"] = e.reason;
    }
    body["liveLagP95Ms"] = diag_.liveLagP95Ms ? opt(diag_.liveLagP95Ms()) : json(nullptr);
    if (diag_.viewer) body["viewer"] = diag_.viewer();
    if (diag_.tags) body["tags"] = diag_.tags();
    if (diag_.retain) body["retain"] = diag_.retain();
    return send(c, 200, jsonText(body), close);
}

int EngineeringApi::auditRead(mg_connection* c, const GateRequest& r, const GateDecision& d,
                              bool close) {
    std::map<std::string, std::string> params;
    std::optional<AuditQuery> query;
    if (parseQuery(mg_get_request_info(c)->query_string, params)) query = auditQueryOf(params);
    if (!query) return sendError(c, 400, "BAD_REQUEST", close);

    // The page first, then the record: nothing leaves the device without its audit.read row, and
    // the answer does not hold the record of its own call (Constitution V).
    AuditPage page;
    try {
        page = audit_.query(*query);
        AuditEvent e(AuditAction::AuditRead, AuditResult::Ok, AuditChannel::Https, r.from.text());
        e.user = d.access.user;
        if (d.access.role) e.role = roleName(*d.access.role);
        e.target = kAuditPath;
        json used = json::object();
        for (const auto& [name, value] : params) {
            int64_t n = 0;
            if (name == "user" || name == "action" || name == "target")
                used[name] = value;
            else if (parseCount(value, n))
                used[name] = n;
        }
        if (!used.empty()) e.detail = jsonText(used);
        audit_.append(e);
    } catch (const std::exception&) {
        return sendError(c, 503, "AUDIT_UNAVAILABLE", close);
    }
    json records = json::array();
    for (const AuditRecord& rec : page.records) records.push_back(auditRecordJson(rec));
    const json body = {{"records", records},
                       {"next", page.next ? json(*page.next) : json(nullptr)}};
    return send(c, 200, jsonText(body), close);
}

// ---- the POST routes, a member of the engineering API (they go through its gate) ----

void EngineeringApi::setAlarms(AlarmsBackend backend) {
    alarms_ = backend;
    if (!alarms_.glue) return;
    if (!postLimiter_)
        postLimiter_ =
            std::make_unique<alarmsapi::PostLimiter>(alarms_.monoMs ? alarms_.monoMs : [] {
                return static_cast<int64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(
                                                std::chrono::steady_clock::now().time_since_epoch())
                                                .count());
            });
    if (std::find(opt_.features.begin(), opt_.features.end(), "alarms") == opt_.features.end())
        opt_.features.push_back("alarms");
}

int EngineeringApi::alarmsPost(mg_connection* c, const GateRequest& r, const GateDecision& d,
                               bool close) {
    using eapi::send;
    using eapi::sendError;
    const std::string verb =
        std::string(d.rule->path).substr(std::string("/api/v1/alarms/").size());
    if (!alarms_.glue) return sendError(c, 501, "NOT_IMPLEMENTED", close);

    // The session of the request, for the rate limit and the audit.
    std::string sessionKey;
    if (d.viaCookie) {
        sessionKey = toHex(sha256(d.webToken));
    } else if (r.authorization) {
        if (const auto t = bearerToken(*r.authorization)) sessionKey = toHex(sha256(*t));
    }
    int retryAfterMs = 0;
    if (postLimiter_ &&
        !postLimiter_->allow(sessionKey.empty() ? d.access.user : sessionKey, retryAfterMs)) {
        eapi::drain(c);
        return sendError(c, 429, "RATE_LIMITED", close, "Retry-After: 1\r\n",
                         {{"message", "Quá 10 yêu cầu mỗi giây. Hãy chậm lại."},
                          {"retryAfterMs", retryAfterMs}});
    }
    // JSON and nothing else (a form of another site could send text/plain).
    {
        const char* type = mg_get_header(c, "Content-Type");
        std::string t = type ? type : "";
        t = t.substr(0, t.find(';'));
        while (!t.empty() && t.back() == ' ') t.pop_back();
        for (char& ch : t)
            if (ch >= 'A' && ch <= 'Z') ch = static_cast<char>(ch - 'A' + 'a');
        if (t != "application/json") {
            eapi::drain(c);
            return sendError(c, 415, "UNSUPPORTED_MEDIA_TYPE", close, "",
                             {{"message", "Chỉ nhận application/json."}});
        }
    }
    std::string body;
    if (!eapi::readBody(c, body)) {
        mg_disable_connection_keep_alive(c);
        return sendError(c, 400, "BAD_REQUEST", true);
    }
    AlarmActor who;
    who.user = d.access.user;
    if (d.access.role) who.role = roleName(*d.access.role);
    who.source = r.from.text();
    who.channel = d.viaCookie ? AuditChannel::Web : AuditChannel::Https;
    const AlarmApiResult res = alarmsapi::post(verb, body, *alarms_.glue, who);
    return send(c, res.status, jsonText(res.body), close);
}

}  // namespace mat
