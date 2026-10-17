// The routes of OTA (feature 011 T111, T112; device-api-011 §3; FR-058 to FR-061, FR-065):
// GET/POST /api/v1/system/update, POST …/apply, …/cancel, …/rollback. The gate has already checked
// HTTPS, the Bearer session (cookieAllowed = false) and the role administrator
// (core/auth/roles.cpp); this file answers 404 UPDATE_DISABLED while update.enabled is false,
// streams the package into the update service (the audit `accepted` is written before the first
// byte is read) and asks the password again (AuthService::reauthenticate: the lockout of the pair,
// maxConcurrentLogins) before apply and rollback.
#include <algorithm>
#include <cctype>
#include <cstring>
#include <vector>

#include "civetweb.h"
#include "core/auth/auth_service.hpp"
#include "core/auth/password_hash.hpp"
#include "core/auth/roles.hpp"
#include "core/common/json_text.hpp"
#include "server/http/engineering_api.hpp"
#include "server/http/engineering_api_internal.hpp"
#include "server/update_service.hpp"

namespace mat {

using nlohmann::json;

namespace {

constexpr const char* kUpdatePath = "/api/v1/system/update";
// mg_read fills the whole buffer (or times out): a small one lets the rate check run often.
constexpr size_t kUploadChunk = 4 * 1024;

std::string mediaTypeOf(const char* header) {
    std::string t = header ? header : "";
    t = t.substr(0, t.find(';'));
    t.erase(std::remove_if(t.begin(), t.end(), [](unsigned char ch) { return std::isspace(ch); }),
            t.end());
    std::transform(t.begin(), t.end(), t.begin(),
                   [](unsigned char ch) { return std::tolower(ch); });
    return t;
}

int reply(mg_connection* c, const UpdateReply& r, bool close) {
    return eapi::send(c, r.status, jsonText(r.body), close);
}

}  // namespace

void EngineeringApi::setUpdate(UpdateBackend backend) {
    update_ = backend;
    if (!update_.service) return;
    if (std::find(opt_.features.begin(), opt_.features.end(), "update") == opt_.features.end())
        opt_.features.push_back("update");
}

int EngineeringApi::updateRoute(mg_connection* c, const GateRequest& r, const GateDecision& d,
                                bool close) {
    using eapi::sendError;
    UpdateService& svc = *update_.service;
    const std::string path = d.rule->path;
    const bool upload = path == kUpdatePath && r.method == "POST";
    if (!svc.enabled()) {
        if (upload) mg_disable_connection_keep_alive(c);  // the package is not read
        return sendError(
            c, 404, "UPDATE_DISABLED", upload || close, "",
            {{"message", "Cập nhật qua mạng đang tắt (update.enabled trong runtime.json)."}});
    }
    UpdateCaller who;
    who.user = d.access.user;
    if (d.access.role) who.role = roleName(*d.access.role);
    who.source = r.from.text();
    if (path == kUpdatePath && r.method == "GET")
        return eapi::send(c, 200, jsonText(svc.status()), close);
    if (upload) return updateUpload(c, who);

    // apply, cancel, rollback: a small JSON body (its size was checked by handle())
    std::string body;
    struct Wipe {
        std::string& s;
        ~Wipe() { secureZero(s); }
    } wipeBody{body};
    if (!eapi::readBody(c, body)) {
        mg_disable_connection_keep_alive(c);
        return sendError(c, 400, "BAD_REQUEST", true);
    }
    json j = json::parse(body, nullptr, false);
    secureZero(body);
    if (!j.is_object()) return sendError(c, 400, "BAD_REQUEST", close);
    std::string password;
    struct WipePassword {
        std::string& s;
        ~WipePassword() { secureZero(s); }
    } wipePassword{password};
    if (j.contains("password") && j["password"].is_string()) {
        password = j["password"].get<std::string>();
        secureZero(j["password"].get_ref<std::string&>());
    }
    const std::string updateId =
        j.contains("updateId") && j["updateId"].is_string() ? j["updateId"].get<std::string>() : "";

    if (path == "/api/v1/system/update/cancel") {
        if (updateId.empty()) return sendError(c, 400, "BAD_REQUEST", close);
        return reply(c, svc.cancel(updateId, who), close);
    }
    const bool apply = path == "/api/v1/system/update/apply";
    if (apply && updateId.empty()) return sendError(c, 400, "BAD_REQUEST", close);
    // the password again (D35): missing is refused without spending a hash
    if (password.empty() || password.size() > kPasswordMaxBytes)
        return sendError(c, 403, "REAUTH_FAILED", close, "",
                         {{"message", "Cần nhập lại mật khẩu để xác nhận."}});
    const LoginResult a = auth_.reauthenticate(who.user, password, r.from);  // wipes it
    switch (a.status) {
        case LoginStatus::Ok:
            break;
        case LoginStatus::Locked:
            return sendError(c, 429, "AUTH_LOCKED", close,
                             "Retry-After: " + std::to_string(a.retryAfterS) + "\r\n",
                             {{"retryAfterS", a.retryAfterS}});
        case LoginStatus::Busy:
            return sendError(c, 429, "LOGIN_BUSY", close, "Retry-After: 1\r\n");
        case LoginStatus::AuditUnavailable:
            return sendError(c, 503, "AUDIT_UNAVAILABLE", close);
        case LoginStatus::Error:
            return sendError(c, 500, "INTERNAL_ERROR", close);
        case LoginStatus::Failed:
        default:
            return sendError(c, 403, "REAUTH_FAILED", close, "",
                             {{"message", "Mật khẩu xác nhận không đúng."}});
    }
    return reply(c, apply ? svc.apply(updateId, who) : svc.rollback(who), close);
}

// POST /api/v1/system/update: application/octet-stream, Content-Length (never chunked). The
// connection closes after the answer: a refused body is never read.
int EngineeringApi::updateUpload(mg_connection* c, const UpdateCaller& who) {
    using eapi::sendError;
    UpdateService& svc = *update_.service;
    const mg_request_info* ri = mg_get_request_info(c);
    mg_disable_connection_keep_alive(c);
    if (mediaTypeOf(mg_get_header(c, "Content-Type")) != "application/octet-stream")
        return sendError(
            c, 415, "UNSUPPORTED_MEDIA_TYPE", true, "",
            {{"message", "Gói cập nhật phải gửi với Content-Type: application/octet-stream."}});
    if (mg_get_header(c, "Transfer-Encoding") != nullptr || ri->content_length < 0)
        return sendError(c, 411, "LENGTH_REQUIRED", true);
    std::string id;
    const UpdateReply started = svc.begin(who, static_cast<uint64_t>(ri->content_length), id);
    if (started.status != 100) return reply(c, started, true);
    std::vector<char> buf(kUploadChunk);
    long long left = ri->content_length;
    while (left > 0) {
        const int n =
            mg_read(c, buf.data(), static_cast<size_t>(std::min<long long>(left, buf.size())));
        if (n <= 0) return reply(c, svc.finish(id, false, who), true);  // dropped or silent
        if (!svc.receive(id, buf.data(), static_cast<size_t>(n)))
            return reply(c, svc.finish(id, false, who), true);  // too slow, too long, write error
        left -= n;
    }
    return reply(c, svc.finish(id, true, who), true);
}

}  // namespace mat
