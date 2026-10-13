#include "server/http/auth_gate.hpp"

#include <mutex>
#include <utility>

#include "core/auth/session_store.hpp"
#include "core/crypto/ct_compare.hpp"

namespace mat {

namespace {

constexpr int64_t kLogEveryMs = 60000;

bool isSpace(char c) { return c == ' ' || c == '\t'; }

std::string_view trim(std::string_view s) {
    while (!s.empty() && isSpace(s.front())) s.remove_prefix(1);
    while (!s.empty() && isSpace(s.back())) s.remove_suffix(1);
    return s;
}

bool equalsNoCase(std::string_view a, std::string_view b) {
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); ++i) {
        const char x = (a[i] >= 'A' && a[i] <= 'Z') ? static_cast<char>(a[i] - 'A' + 'a') : a[i];
        const char y = (b[i] >= 'A' && b[i] <= 'Z') ? static_cast<char>(b[i] - 'A' + 'a') : b[i];
        if (x != y) return false;
    }
    return true;
}

bool csrfMatches(const GateRequest& request, const std::string& csrf) {
    return request.csrf && !csrf.empty() && constantTimeEqual(*request.csrf, csrf);
}

GateDecision refuse(int status, const char* error) {
    GateDecision d;
    d.status = status;
    d.error = error;
    return d;
}

}  // namespace

struct AuthGate::Throttle {
    std::mutex mu;
    bool logged = false;
    int64_t lastMs = 0;
    int64_t silenced = 0;
};

AuthGate::AuthGate(GateDeps deps)
    : deps_(std::move(deps)),
      log_(authLogOrStderr(deps_.log)),
      mono_(deps_.monoMs ? deps_.monoMs : bootTimeMs),
      throttle_(std::make_shared<Throttle>()) {}

GateDecision AuthGate::check(const GateRequest& request) {
    // 0. An endpoint of the table, whatever the method: anything else does not exist.
    const std::string allow = allowedMethods(request.path);
    if (allow.empty()) return refuse(404, "NOT_FOUND");

    // 1. HTTPS only (FR-007), before anything of the request is looked at.
    if (!request.tls) {
        GateDecision d = refuse(403, "HTTPS_REQUIRED");
        recordDenied(request, d);
        return d;
    }
    const EndpointRule* rule = findEndpointRule(request.method, request.path);
    if (rule == nullptr) {
        GateDecision d = refuse(405, "METHOD_NOT_ALLOWED");
        d.allow = allow;
        return d;
    }
    GateDecision d;
    d.rule = rule;

    // 3. The medium of the session: an Authorization header wins and the cookie is then not looked
    // at; a web token in the header is no Bearer token (SESSION_SCOPE).
    const std::optional<std::string_view> token =
        request.authorization ? bearerToken(*request.authorization) : std::nullopt;
    if (token && isWebTokenFormat(*token)) {
        d.status = 403;
        d.error = "SESSION_SCOPE";
        recordDenied(request, d);
        return d;
    }
    if (!token && deps_.authorizeWeb && (rule->needsSession || rule->webEntry))
        return checkCookie(request, *rule, std::move(d));
    if (!rule->needsSession) return d;
    // The endpoints of the web session answer to its cookie only.
    if (token && std::string_view(rule->path).rfind("/api/v1/web/", 0) == 0) {
        d.status = 403;
        d.error = "SESSION_SCOPE";
        recordDenied(request, d);
        return d;
    }

    // 2–3. Session, then role: AuthService checks both in one step.
    if (!token) {
        d.status = 401;
        d.error = "AUTH_REQUIRED";
        recordDenied(request, d);
        return d;
    }
    d.access = deps_.authorize
                   ? deps_.authorize(*token, request.from, rule->minRole, rule->refreshesSession)
                   : Access{};
    if (d.access.status != AccessStatus::Ok) {
        d.status = d.access.status == AccessStatus::Forbidden ? 403 : 401;
        d.error = accessErrorCode(d.access.status);
        recordDenied(request, d);
        return d;
    }

    // 4. A change runs only when its audit record can be written first.
    if (rule->changesDevice && !(deps_.auditAvailable && deps_.auditAvailable())) {
        d.status = 503;
        d.error = "AUDIT_UNAVAILABLE";
    }
    return d;
}

// The cookie branch (device-api-1.2 §1.3, steps 3 to 9). A cookie that is not one of ours (another
// name, another token kind) is no cookie: AUTH_REQUIRED.
GateDecision AuthGate::checkCookie(const GateRequest& request, const EndpointRule& rule,
                                   GateDecision d) {
    const bool changes = request.method != "GET" && request.method != "HEAD";
    const auto refuse = [&](int status, const char* error) {
        d.status = status;
        d.error = error;
        recordDenied(request, d);
        return d;
    };
    std::optional<std::string> cookie;
    if (request.cookie) cookie = cookieValue(*request.cookie, kSessionCookieName);
    const bool ours = cookie && cookie->rfind(kWebTokenPrefix, 0) == 0;

    if (rule.webEntry) {
        // Sign-in and sign-out: no session needed, but the request must come from the page (an
        // Origin that is this device over HTTPS), or a page of another site could sign a visitor
        // in as somebody else (login CSRF) or out. A cookie that is a live session also needs its
        // CSRF token to sign out.
        if (changes && !originMatchesHost(request.origin, request.host))
            return refuse(403, "ORIGIN_MISMATCH");
        if (ours && isWebTokenFormat(*cookie)) {
            d.web = deps_.authorizeWeb(*cookie, request.from, Role::Viewer, false);
            if (d.web.status == AccessStatus::Ok) {
                d.access = d.web;
                d.viaCookie = true;
                d.webToken = *cookie;
                // only a sign-out needs the token; a sign-in over a live cookie starts a new
                // session
                if (changes && std::string_view(rule.path) == "/api/v1/web/logout" &&
                    !csrfMatches(request, d.web.csrf))
                    return refuse(403, "CSRF_FAILED");
            }
        }
        return d;
    }

    // 4. A valid session. A client that chose its own token (not made by login) is invalid.
    if (!ours) return refuse(401, "AUTH_REQUIRED");
    d.viaCookie = true;  // from here a refusal is on the channel `web`
    if (!isWebTokenFormat(*cookie)) return refuse(401, "SESSION_INVALID");
    d.web = deps_.authorizeWeb(*cookie, request.from, Role::Viewer, false);
    d.access = d.web;
    if (d.web.status != AccessStatus::Ok) {
        return refuse(401, accessErrorCode(d.web.status));
    }
    d.webToken = *cookie;
    // 5. Scope: the endpoints of the page and nothing else.
    if (!rule.cookieAllowed) return refuse(403, "SESSION_SCOPE");
    // 6. A request that changes state comes from the page: its Origin, then its CSRF token. 7. A
    // read of the session or of a result is the page's own too.
    if (changes) {
        if (!originMatchesHost(request.origin, request.host)) return refuse(403, "ORIGIN_MISMATCH");
        if (!csrfMatches(request, d.web.csrf)) return refuse(403, "CSRF_FAILED");
    } else if (request.secFetchSite && *request.secFetchSite != "same-origin") {
        return refuse(403, "FETCH_SITE");
    }
    // 8. The role: read from users.json at every request.
    if (!d.web.role || !roleAtLeast(*d.web.role, rule.minRole)) {
        d.access.status = AccessStatus::Forbidden;
        return refuse(403, "FORBIDDEN");
    }
    if (rule.refreshesSession && deps_.touchWeb) deps_.touchWeb(*cookie);
    // 9. A change runs only when its audit record can be written first.
    if (rule.changesDevice && !(deps_.auditAvailable && deps_.auditAvailable())) {
        d.status = 503;
        d.error = "AUDIT_UNAVAILABLE";
    }
    return d;
}

void AuthGate::recordDenied(const GateRequest& request, const GateDecision& decision) {
    if (!deps_.audit) return;
    if (deps_.skipDeniedAudit && deps_.skipDeniedAudit(request)) return;
    AuditEvent e(AuditAction::AccessDenied, AuditResult::Denied,
                 decision.viaCookie ? AuditChannel::Web
                                    : request.tls ? AuditChannel::Https : AuditChannel::Http,
                 request.from.text());
    e.target = request.path;
    e.code = decision.error;
    if (!decision.access.user.empty()) e.user = decision.access.user;
    if (decision.access.status == AccessStatus::Forbidden && decision.access.role)
        e.role = roleName(*decision.access.role);
    std::string error;
    try {
        deps_.audit(e);
        return;
    } catch (const std::exception& ex) {
        error = ex.what();
    }
    // Under attack every refusal would fail the same way: one line a minute.
    std::string line;
    {
        Throttle& t = *throttle_;
        std::lock_guard<std::mutex> l(t.mu);
        const int64_t now = mono_();
        if (t.logged && now - t.lastMs < kLogEveryMs) {
            ++t.silenced;
            return;
        }
        line = "audit access.denied not written: " + error;
        if (t.silenced > 0)
            line += " (" + std::to_string(t.silenced) + " more since the last line)";
        t.logged = true;
        t.lastMs = now;
        t.silenced = 0;
    }
    log_(line);
}

std::optional<std::string_view> bearerToken(std::string_view authorization) {
    const std::string_view h = trim(authorization);
    constexpr std::string_view kScheme = "bearer";
    if (h.size() <= kScheme.size() || !equalsNoCase(h.substr(0, kScheme.size()), kScheme) ||
        !isSpace(h[kScheme.size()]))
        return std::nullopt;
    const std::string_view token = trim(h.substr(kScheme.size()));
    if (token.empty()) return std::nullopt;
    return token;
}

const char* gateMessage(std::string_view error) {
    struct Entry {
        const char* code;
        const char* message;
    };
    static const Entry kMessages[] = {
        {"HTTPS_REQUIRED", "Chức năng này chỉ dùng được qua HTTPS (cổng kỹ thuật)."},
        {"AUTH_REQUIRED", "Cần đăng nhập."},
        {"SESSION_EXPIRED", "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại."},
        {"SESSION_INVALID",
         "Phiên đăng nhập không còn dùng được (đổi địa chỉ, tài khoản bị tắt hoặc đã đổi)."},
        {"FORBIDDEN", "Tài khoản không đủ quyền cho thao tác này."},
        {"AUDIT_UNAVAILABLE", "Thiết bị không ghi được nhật ký audit nên từ chối thao tác."},
        {"NOT_FOUND", "Không có chức năng này."},
        {"METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ cho đường dẫn này."},
        {"AUTH_FAILED", "Sai tên đăng nhập hoặc mật khẩu."},
        {"AUTH_LOCKED", "Đăng nhập đang bị khóa tạm do sai nhiều lần. Hãy thử lại sau."},
        {"AUTH_BUSY", "Thiết bị đang bận xử lý đăng nhập khác. Hãy thử lại sau giây lát."},
        {"BODY_TOO_LARGE", "Nội dung yêu cầu quá lớn."},
        {"BAD_REQUEST", "Yêu cầu không hợp lệ."},
        {"LENGTH_REQUIRED", "Yêu cầu cần có Content-Length."},
        {"NOT_IMPLEMENTED", "Phiên bản runtime này chưa có chức năng này."},
        // Feature 007: the cookie session of the page (device-api-1.2 §1.3).
        {"SESSION_SCOPE", "Phiên đăng nhập của trang này không dùng được cho thao tác này."},
        {"CSRF_FAILED", "Yêu cầu không có mã chống giả mạo hợp lệ. Hãy tải lại trang."},
        {"ORIGIN_MISMATCH", "Yêu cầu không xuất phát từ trang của thiết bị này."},
        {"FETCH_SITE", "Yêu cầu từ trang khác nguồn bị từ chối."},
        {"INTERNAL_ERROR", "Lỗi nội bộ của thiết bị."},
        // Project routes (device-api §4–§5).
        {"UNSUPPORTED_MEDIA_TYPE", "Gói project phải gửi với Content-Type: application/zip."},
        {"PACKAGE_TOO_LARGE", "Gói project lớn hơn 50 MiB."},
        {"DEVICE_BUSY", "Thiết bị đang bận với một thao tác khác."},
        {"BASE_CHANGED",
         "Project trên thiết bị đã đổi sau lúc xem trước. Hãy đọc lại rồi thử lại."},
        {"NO_SPACE", "Thiết bị không đủ chỗ trống."},
        {"NO_BASE_PROJECT",
         "Project cài theo cách cũ chưa vào kho nên chưa nạp xuống được (sẽ mất project đó)."},
        {"NO_PROJECT_PACKAGE", "Thiết bị chưa có gói project để đọc lên."},
        {"NO_SUCH_VERSION", "Không có bản project này trên thiết bị."},
        {"NO_SUCH_OPERATION", "Không có thao tác này (chỉ giữ 20 thao tác gần nhất)."},
        {"ALREADY_ACTIVE", "Bản này đang chạy."},
        {"STORE_IO", "Lỗi đọc hoặc ghi kho project của thiết bị."},
        {"RECEIVE_ABORTED", "Mất kết nối khi nhận gói."},
        {"RECEIVE_TIMEOUT", "Không nhận xong gói trong 10 phút."},
    };
    for (const Entry& e : kMessages)
        if (error == e.code) return e.message;
    return "";
}

}  // namespace mat
