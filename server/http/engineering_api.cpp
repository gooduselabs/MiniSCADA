#include "server/http/engineering_api.hpp"

#include <cstring>
#include <set>
#include <string>
#include <utility>

#include "civetweb.h"
#include "core/audit/audit_log.hpp"
#include "core/auth/auth_service.hpp"
#include "core/auth/password_hash.hpp"
#include "core/common/json_limits.hpp"
#include "core/common/json_text.hpp"
#include "core/project-manager/project_validator.hpp"
#include "nlohmann/json.hpp"
#include "server/websocket/live_hub.hpp"

namespace mat {

namespace {

using nlohmann::json;

// Request bodies of the engineering API are flat objects; deeper JSON is refused before the
// parser (which recurses per level) sees it.
constexpr int kMaxBodyDepth = 8;

constexpr const char* kIdentityPath = "/api/v1/device/identity";
constexpr const char* kLoginPath = "/api/v1/auth/login";
constexpr const char* kLogoutPath = "/api/v1/auth/logout";
constexpr const char* kSessionPath = "/api/v1/auth/session";

// The headers of device-api §1.2 on every answer; `extra` adds whole header lines.
int send(mg_connection* c, int status, const std::string& body, bool close,
         const std::string& extra = "") {
    // 204 has neither a body nor its headers (RFC 9110 §8.6).
    const std::string type =
        status == 204 ? std::string()
                      : "Content-Type: application/json; charset=utf-8\r\nContent-Length: " +
                            std::to_string(body.size()) + "\r\n";
    mg_printf(c,
              "HTTP/1.1 %d %s\r\n%sCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n"
              "%s%s\r\n",
              status, mg_get_response_code_text(c, status), type.c_str(), extra.c_str(),
              close ? "Connection: close\r\n" : "");
    if (status != 204 && !body.empty()) mg_write(c, body.data(), body.size());
    return status;
}

int sendError(mg_connection* c, int status, const std::string& code, bool close,
              const std::string& extra = "", json more = json::object()) {
    more["error"] = code;
    more["message"] = gateMessage(code);
    return send(c, status, jsonText(more), close, extra);
}

// The whole body of a request whose Content-Length is within the limit (checked before). false
// when the client stops sending (request_timeout_ms) or the connection fails.
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

// Reads and drops what is left of the body (at most kBodyDrainMaxBytes), so that an answer sent
// before the whole body reaches the client and the connection can serve the next request.
void drain(mg_connection* c) {
    char buf[4096];
    while (mg_read(c, buf, sizeof buf) > 0) {
    }
}

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

GateDeps gateDeps(AuthService& auth, AuditLog& audit) {
    GateDeps d;
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
      gate_(gateDeps(auth, audit)) {}

void EngineeringApi::install(mg_context* ctx) {
    std::set<std::string> patterns;  // one handler per path of the table, whatever its methods
    for (const auto& rule : endpointRules()) patterns.insert(handlerPattern(rule.path));
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

    // A body CivetWeb would read after the answer to keep the connection: chunked, or more than
    // we drain. The connection closes instead.
    const bool chunked = mg_get_header(c, "Transfer-Encoding") != nullptr;
    const bool hugeBody =
        chunked || ri->content_length > static_cast<long long>(kBodyDrainMaxBytes);
    if (hugeBody) mg_disable_connection_keep_alive(c);
    const bool close = !r.tls || hugeBody;

    const GateDecision d = gate_.check(r);
    if (!d.through()) {
        std::string extra;
        if (d.status == 401) extra = "WWW-Authenticate: Bearer\r\n";
        if (d.status == 405) extra = "Allow: " + d.allow + "\r\n";
        return sendError(c, d.status, d.error, close, extra);
    }
    const std::string path = d.rule->path;
    if (std::strcmp(d.rule->method, "POST") == 0) {
        // JSON bodies (device-api §1.2). US2 gives POST /api/v1/project/deployments its own
        // limits (application/zip, Content-Length ≤ 50 MiB) before this point.
        const size_t limit = path == kLoginPath ? kLoginBodyMaxBytes : kJsonBodyMaxBytes;
        if (chunked) return sendError(c, 411, "LENGTH_REQUIRED", close);
        if (ri->content_length > static_cast<long long>(limit)) {
            if (!hugeBody) drain(c);
            return sendError(c, 413, "BODY_TOO_LARGE", close);
        }
    }
    if (path == kIdentityPath) return identity(c, close);
    if (path == kLoginPath) return login(c, r, close);
    if (path == kLogoutPath) return logout(c, r, close);
    if (path == kSessionPath) return session(c, d, close);
    // Endpoints of the table that come with later stories (project US2, diagnostics and audit US4).
    return sendError(c, 501, "NOT_IMPLEMENTED", close);
}

int EngineeringApi::identity(mg_connection* c, bool close) {
    const DeviceFacts f = device_.facts();
    const json body = {
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
            return sendError(c, 429, "AUTH_BUSY", close, "Retry-After: 2\r\n");
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

}  // namespace mat
