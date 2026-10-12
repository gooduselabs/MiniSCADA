#include "server/http/auth_gate.hpp"

#include <mutex>
#include <utility>

#include "core/auth/session_store.hpp"

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
    if (!rule->needsSession) return d;

    // 2–3. Session, then role: AuthService checks both in one step.
    const std::optional<std::string_view> token =
        request.authorization ? bearerToken(*request.authorization) : std::nullopt;
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

void AuthGate::recordDenied(const GateRequest& request, const GateDecision& decision) {
    if (!deps_.audit) return;
    AuditEvent e(AuditAction::AccessDenied, AuditResult::Denied,
                 request.tls ? AuditChannel::Https : AuditChannel::Http, request.from.text());
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
