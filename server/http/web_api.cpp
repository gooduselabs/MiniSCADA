// The sign-in endpoints of the runtime page (feature 007; contracts/device-api-1.2.md §2,
// web-session.md §2, §3; ADR-021 points 1 to 5): POST /api/v1/web/login, POST /web/logout,
// GET /web/session, POST /web/touch. Member functions of EngineeringApi, in a file of their own.
// The gate has already checked HTTPS, Origin, the CSRF token and the scope; these only do the work.
#include <chrono>
#include <cstring>
#include <string>

#include "civetweb.h"
#include "core/audit/audit_log.hpp"
#include "core/auth/auth_service.hpp"
#include "core/auth/password_hash.hpp"
#include "core/common/json_limits.hpp"
#include "core/common/json_text.hpp"
#include "nlohmann/json.hpp"
#include "server/http/cookie.hpp"
#include "server/http/engineering_api.hpp"
#include "server/http/engineering_api_internal.hpp"

namespace mat {

namespace {

using eapi::readBody;
using eapi::send;
using eapi::sendError;
using nlohmann::json;

constexpr int kMaxBodyDepth = 8;

// The only place that writes the session cookie. "__Host-" makes the browser insist on Secure, no
// Domain and Path=/; no Max-Age: it is a session cookie (the real limits are the device's).
std::string setCookie(const std::string& value, bool clear) {
    std::string line = std::string("Set-Cookie: ") + kSessionCookieName + "=" + value +
                       "; Secure; HttpOnly; SameSite=Strict; Path=/";
    if (clear) line += "; Max-Age=0";
    return line + "\r\n";
}

std::string isoUtc(int64_t epochSeconds) {
    const time_t t = static_cast<time_t>(epochSeconds);
    tm tmv{};
    ::gmtime_r(&t, &tmv);
    char buf[32];
    std::strftime(buf, sizeof buf, "%Y-%m-%dT%H:%M:%SZ", &tmv);
    return buf;
}

int64_t wallSeconds() {
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

// Content-Type: application/json, with or without parameters (charset).
bool isJsonContentType(mg_connection* c) {
    const char* h = mg_get_header(c, "Content-Type");
    if (!h) return false;
    std::string v = h;
    const size_t semi = v.find(';');
    if (semi != std::string::npos) v.erase(semi);
    while (!v.empty() && (v.back() == ' ' || v.back() == '\t')) v.pop_back();
    size_t i = 0;
    while (i < v.size() && (v[i] == ' ' || v[i] == '\t')) ++i;
    v = v.substr(i);
    for (char& ch : v)
        if (ch >= 'A' && ch <= 'Z') ch = static_cast<char>(ch - 'A' + 'a');
    return v == "application/json";
}

// The body of the sign-in and of the session read: user, role, the CSRF token and the times.
json sessionBody(const std::string& user, const std::string& role, const std::string& csrf,
                 int64_t idleRemainingS, int64_t lifetimeRemainingS, int64_t idleTimeoutS,
                 int64_t maxSessionS) {
    const int64_t now = wallSeconds();
    return {{"user", user},
            {"role", role},
            {"csrfToken", csrf},
            {"expiresAt", isoUtc(now + lifetimeRemainingS)},
            {"idleExpiresAt", isoUtc(now + idleRemainingS)},
            {"idleTimeoutS", idleTimeoutS},
            {"maxSessionS", maxSessionS}};
}

}  // namespace

int EngineeringApi::webLogin(mg_connection* c, const GateRequest& r, bool close) {
    // Only JSON (a form from another site could be sent as text/plain or urlencoded).
    if (!isJsonContentType(c)) {
        eapi::drain(c);
        return sendError(c, 415, "UNSUPPORTED_MEDIA_TYPE", close, "",
                         {{"message", "Chỉ nhận application/json."}});
    }
    std::string body;
    struct Wipe {
        std::string& s;
        ~Wipe() { secureZero(s); }
    } wipeBody{body};
    if (!readBody(c, body)) {
        mg_disable_connection_keep_alive(c);
        return sendError(c, 400, "BAD_REQUEST", true);
    }
    if (jsonNestingDepth(body.data(), body.size()) > kMaxBodyDepth)
        return sendError(c, 400, "BAD_REQUEST", close);
    json j = json::parse(body, nullptr, false);
    secureZero(body);
    if (!j.is_object() || !j.contains("username") || !j["username"].is_string() ||
        !j.contains("password") || !j["password"].is_string())
        return sendError(c, 400, "BAD_REQUEST", close);
    std::string& password = j["password"].get_ref<std::string&>();
    struct WipePassword {
        std::string& s;
        ~WipePassword() { secureZero(s); }
    } wipePassword{password};
    const std::string user = j["username"].get<std::string>();
    if (user.size() > kLoginMaxUserBytes || password.size() > kPasswordMaxBytes)
        return sendError(c, 400, "BAD_REQUEST", close);
    // No session without its audit record: do not even spend the hash when the log is down.
    if (!audit_.isOpen()) return sendError(c, 503, "AUDIT_UNAVAILABLE", close);

    LoginResult res = auth_.loginWeb(user, password, r.from);  // wipes the password
    switch (res.status) {
        case LoginStatus::Ok: {
            std::string out =
                jsonText(sessionBody(res.user, roleName(res.role), res.csrf, res.idleTimeoutS,
                                     res.maxSessionS, res.idleTimeoutS, res.maxSessionS));
            const std::string cookie = setCookie(res.token, false);
            secureZero(res.token);
            const int status = send(c, 200, out, close, cookie);
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

int EngineeringApi::webSession(mg_connection* c, const GateDecision& d, bool close) {
    return send(c, 200,
                jsonText(sessionBody(d.web.user, d.web.role ? roleName(*d.web.role) : "",
                                     d.web.csrf, d.web.idleRemainingS, d.web.lifetimeRemainingS,
                                     d.web.idleTimeoutS, d.web.maxSessionS)),
                close);
}

int EngineeringApi::webTouch(mg_connection* c, bool close) {
    // The gate restarted the idle time (the endpoint is a person's request).
    eapi::drain(c);
    return send(c, 204, "", close);
}

int EngineeringApi::webLogout(mg_connection* c, const GateRequest& r, const GateDecision& d,
                              bool close) {
    eapi::drain(c);
    // A live session ends; a dead or missing one is not an error: the cookie is cleared anyway.
    if (d.viaCookie && !d.webToken.empty()) auth_.logoutWeb(d.webToken, r.from);
    return send(c, 204, "", close, setCookie("", true));
}

}  // namespace mat
