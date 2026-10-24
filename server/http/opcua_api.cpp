#include "server/http/opcua_api.hpp"

#include <chrono>
#include <ctime>
#include <mutex>

#include "civetweb.h"
#include "core/audit/audit_log.hpp"
#include "core/common/json_limits.hpp"
#include "core/common/json_text.hpp"
#include "core/historian/secrets.hpp"
#include "drivers/opcua/node_id.hpp"
#include "server/http/engineering_api.hpp"
#include "server/http/engineering_api_internal.hpp"

namespace mat {

namespace {

using nlohmann::json;

void issue(std::vector<ProbeIssue>& out, const char* code, const std::string& path,
           const std::string& message) {
    out.push_back({code, path, message});
}

bool isHex64(const std::string& s) {
    if (s.size() != 64) return false;
    for (char c : s)
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    return true;
}

// opc.tcp://host[:port][/path] (the pattern of connections.schema.json)
bool endpointOk(const std::string& u) {
    const std::string pre = "opc.tcp://";
    if (u.size() > 256 || u.rfind(pre, 0) != 0 || u.size() == pre.size()) return false;
    for (char c : u)
        if (c == ' ' || c == '\t' || c == '\r' || c == '\n' || static_cast<unsigned char>(c) < 0x20)
            return false;
    const char first = u[pre.size()];
    return first != '/' && first != ':';
}

std::string messageOf(const std::string& code) {
    if (code == "OK") return "Kết nối được server OPC UA.";
    if (code == "REFUSED")
        return "Không kết nối được server OPC UA (sai địa chỉ, cổng, hoặc server tắt).";
    if (code == "TIMEOUT") return "Server OPC UA không trả lời kịp.";
    if (code == "OPCUA_CERT_UNTRUSTED")
        return "Chứng chỉ server chưa được tin: kiểm tra SHA-256 rồi bấm Tin chứng chỉ này.";
    if (code == "OPCUA_SECURITY_REJECTED")
        return "Server từ chối kênh bảo mật: cho server tin chứng chỉ của thiết bị, hoặc kiểm tra "
               "securityPolicy.";
    if (code == "OPCUA_AUTH_FAILED") return "Server từ chối đăng nhập (username/mật khẩu).";
    if (code == "OPCUA_SECRET_MISSING")
        return "Thiết bị chưa có mật khẩu của kênh: đặt bằng mat-runtime --set-secret <secretId>.";
    if (code == "OPCUA_ENDPOINT_NOT_FOUND")
        return "Server không có endpoint với bảo mật và kiểu đăng nhập đã chọn.";
    if (code == "OPCUA_BROWSE_FAILED") return "Không duyệt được node này.";
    return "Lỗi khi kết nối server OPC UA.";
}

std::string isoUtc(int64_t ms) {
    if (ms <= 0) return "";
    const time_t t = static_cast<time_t>(ms / 1000);
    struct tm tmv {};
    gmtime_r(&t, &tmv);
    char b[32];
    std::strftime(b, sizeof b, "%Y-%m-%dT%H:%M:%SZ", &tmv);
    return b;
}

}  // namespace

bool parseOpcUaBrowseRequest(const json& body, OpcUaBrowseSpec& spec,
                             std::vector<ProbeIssue>& issues) {
    spec = OpcUaBrowseSpec{};
    issues.clear();
    if (!body.is_object()) {
        issue(issues, "E_FIELD_MISSING", "", "Thân yêu cầu phải là một đối tượng JSON.");
        return false;
    }
    if (!body.contains("channel") || !body["channel"].is_object()) {
        issue(issues, "E_FIELD_MISSING", "channel", "Thiếu cấu hình kênh.");
        return false;
    }
    const json& ch = body["channel"];
    if (!ch.contains("kind") || ch["kind"] != "opcua") {
        issue(issues, "E_FIELD_VALUE", "channel.kind", "Loại kênh phải là opcua.");
        return false;
    }
    if (!ch.contains("opcua") || !ch["opcua"].is_object()) {
        issue(issues, "E_FIELD_MISSING", "channel.opcua", "Thiếu khối opcua của kênh.");
        return false;
    }
    const json& o = ch["opcua"];
    opcua::BrowseRequest& q = spec.request;
    if (!o.contains("endpointUrl") || !o["endpointUrl"].is_string())
        issue(issues, "E_FIELD_MISSING", "channel.opcua.endpointUrl",
              "Thiếu endpoint (opc.tcp://…).");
    else if (!endpointOk(o["endpointUrl"].get<std::string>()))
        issue(issues, "E_FIELD_VALUE", "channel.opcua.endpointUrl",
              "Endpoint phải có dạng opc.tcp://máy[:cổng][/đường dẫn].");
    else
        q.endpointUrl = o["endpointUrl"].get<std::string>();
    auto text = [&](const char* key, const std::string& def) -> std::string {
        if (!o.contains(key)) return def;
        return o[key].is_string() ? o[key].get<std::string>() : std::string("\x01");
    };
    const std::string mode = text("securityMode", "None");
    const std::string policy = text("securityPolicy", "None");
    if (mode != "None" && mode != "Sign" && mode != "SignAndEncrypt")
        issue(issues, "E_FIELD_VALUE", "channel.opcua.securityMode",
              "securityMode phải là None, Sign hoặc SignAndEncrypt.");
    if (policy != "None" && policy != "Basic256Sha256")
        issue(issues, "E_FIELD_VALUE", "channel.opcua.securityPolicy",
              "securityPolicy phải là None hoặc Basic256Sha256.");
    else if ((mode == "None") != (policy == "None"))
        issue(issues, "E_FIELD_VALUE", "channel.opcua.securityPolicy",
              "securityMode và securityPolicy không khớp.");
    q.securityMode = mode == "Sign"
                         ? drv::OpcUaSecurityMode::Sign
                         : mode == "SignAndEncrypt" ? drv::OpcUaSecurityMode::SignAndEncrypt
                                                    : drv::OpcUaSecurityMode::None;
    q.basic256Sha256 = policy == "Basic256Sha256";
    if (o.contains("serverCertSha256")) {
        if (!o["serverCertSha256"].is_string() ||
            !isHex64(o["serverCertSha256"].get<std::string>()))
            issue(issues, "E_FIELD_VALUE", "channel.opcua.serverCertSha256",
                  "serverCertSha256 phải là 64 chữ số hex thường.");
        else
            q.serverCertSha256 = o["serverCertSha256"].get<std::string>();
    }
    if (o.contains("auth")) {
        const json& a = o["auth"];
        const std::string am = a.is_object() && a.contains("mode") && a["mode"].is_string()
                                   ? a["mode"].get<std::string>()
                                   : "";
        if (am == "username") {
            const bool ok = a.contains("username") && a["username"].is_string() &&
                            !a["username"].get<std::string>().empty() &&
                            a["username"].get<std::string>().size() <= 128 &&
                            a.contains("secretId") && a["secretId"].is_string() &&
                            validConnectionId(a["secretId"].get<std::string>());
            if (!ok) {
                issue(issues, "E_FIELD_VALUE", "channel.opcua.auth",
                      "Đăng nhập username cần username và secretId hợp lệ.");
            } else {
                q.authUsername = true;
                q.username = a["username"].get<std::string>();
                spec.secretId = a["secretId"].get<std::string>();
            }
        } else if (am != "anonymous") {
            issue(issues, "E_FIELD_VALUE", "channel.opcua.auth.mode",
                  "auth.mode phải là anonymous hoặc username.");
        }
    }
    const std::string action = body.contains("action") && body["action"].is_string()
                                   ? body["action"].get<std::string>()
                                   : "";
    if (action != "endpoints" && action != "browse")
        issue(issues, "E_FIELD_VALUE", "action", "action phải là endpoints hoặc browse.");
    q.action = action;
    if (body.contains("nodeId")) {
        if (!body["nodeId"].is_string()) {
            issue(issues, "E_FIELD_VALUE", "nodeId", "nodeId phải là chuỗi.");
        } else {
            const opcua::NodeIdRef r = opcua::parseNodeId(body["nodeId"].get<std::string>());
            if (!r.ok)
                issue(issues, r.error.c_str(), "nodeId", "NodeId không hợp lệ.");
            else
                q.nodeId = r.normalized;
        }
    }
    if (body.contains("timeoutMs")) {
        const json& t = body["timeoutMs"];
        if (!t.is_number_integer() || t.get<int64_t>() < 1000 || t.get<int64_t>() > 30000)
            issue(issues, "E_FIELD_VALUE", "timeoutMs", "Phải là số nguyên từ 1000 đến 30000.");
        else
            q.timeoutMs = t.get<int>();
    }
    spec.target = q.endpointUrl;
    return issues.empty();
}

json opcuaBrowseAnswerJson(const opcua::BrowseResult& r) {
    json server = {
        {"applicationUri", r.applicationUri},
        {"certSha256", r.certSha256.empty() ? json() : json(r.certSha256)},
        {"certSubject", r.certSubject.empty() ? json() : json(r.certSubject)},
        {"certNotAfter", r.certNotAfterMs > 0 ? json(isoUtc(r.certNotAfterMs)) : json()}};
    json eps = json::array();
    for (const auto& e : r.endpoints)
        eps.push_back({{"securityMode", e.securityMode},
                       {"securityPolicy", e.securityPolicy},
                       {"userTokens", e.userTokens}});
    json refs = json::array();
    for (const auto& b : r.references) {
        json j = {{"nodeId", b.nodeId},
                  {"browseName", b.browseName},
                  {"displayName", b.displayName},
                  {"nodeClass", b.nodeClass},
                  {"hasChildren", b.hasChildren}};
        if (!b.dataType.empty()) j["dataType"] = b.dataType;
        if (!b.tagType.empty()) j["tagType"] = b.tagType;
        if (b.writable) j["writable"] = *b.writable;
        refs.push_back(std::move(j));
    }
    json out = {{"ok", r.ok},
                {"code", r.code},
                {"message", messageOf(r.code)},
                {"elapsedMs", r.elapsedMs},
                {"server", server},
                {"endpoints", eps},
                {"references", refs},
                {"truncated", r.truncated}};
    if (!r.status.empty()) out["status"] = r.status;
    return out;
}

int EngineeringApi::opcuaBrowse(mg_connection* c, const GateRequest& r, const GateDecision& d,
                                bool close) {
    using eapi::send;
    using eapi::sendError;
    std::string body;
    if (!eapi::readBody(c, body)) {
        mg_disable_connection_keep_alive(c);
        return sendError(c, 400, "BAD_REQUEST", true);
    }
    if (jsonNestingDepth(body.data(), body.size()) > 8)
        return sendError(c, 400, "BAD_REQUEST", close);
    const json j = json::parse(body, nullptr, false);
    if (j.is_discarded()) return sendError(c, 400, "BAD_REQUEST", close);
    OpcUaBrowseSpec spec;
    std::vector<ProbeIssue> issues;
    if (!parseOpcUaBrowseRequest(j, spec, issues)) {
        json list = json::array();
        for (const auto& i : issues)
            list.push_back({{"code", i.code}, {"path", i.path}, {"message", i.message}});
        return sendError(c, 400, "BAD_REQUEST", close, "", {{"issues", list}});
    }
    const int64_t now =
        drivers_.monoMs
            ? drivers_.monoMs()
            : static_cast<int64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(
                                       std::chrono::steady_clock::now().time_since_epoch())
                                       .count());
    {
        std::lock_guard<std::mutex> l(testMu_);
        while (!browseTimes_.empty() && now - browseTimes_.front() >= 60000)
            browseTimes_.pop_front();
        if (static_cast<int>(browseTimes_.size()) >= kOpcUaBrowseRatePerMinute) {
            const int64_t wait =
                std::max<int64_t>(1, (browseTimes_.front() + 60000 - now + 999) / 1000);
            return sendError(
                c, 429, "TEST_RATE_LIMITED", close, "Retry-After: " + std::to_string(wait) + "\r\n",
                {{"retryAfterS", wait},
                 {"message", "Duyệt server OPC UA quá nhiều lần: tối đa 60 lần mỗi phút."}});
        }
        browseTimes_.push_back(now);
    }
    opcua::BrowseResult result;
    try {
        result = drivers_.opcuaBrowse(spec.request, spec.secretId);
    } catch (const std::exception&) {
        result.ok = false;
        result.code = "REFUSED";
    }
    try {
        AuditEvent e(AuditAction::DriverTest, result.ok ? AuditResult::Ok : AuditResult::Failed,
                     AuditChannel::Https, r.from.text());
        e.user = d.access.user;
        if (d.access.role) e.role = roleName(*d.access.role);
        e.target = spec.target;
        e.code = result.code;
        audit_.append(e);
    } catch (const std::exception&) {
        return sendError(c, 503, "AUDIT_UNAVAILABLE", close);
    }
    return send(c, 200, jsonText(opcuaBrowseAnswerJson(result)), close);
}

}  // namespace mat
