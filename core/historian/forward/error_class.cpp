#include "core/historian/forward/error_class.hpp"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <initializer_list>

#include "core/common/utf8.hpp"

namespace mat {

namespace {

template <class T>
bool oneOf(T v, std::initializer_list<T> list) {
    return std::find(list.begin(), list.end(), v) != list.end();
}

std::string lower(std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

bool has(const std::string& text, const char* part) { return text.find(part) != std::string::npos; }

constexpr size_t kJournalMaxBytes = 512;

}  // namespace

std::string journalSafe(const std::string& s) {
    const std::string text = sanitizeUtf8(s);
    std::string out;
    char hex[8];
    for (size_t i = 0; i < text.size();) {
        const auto c = static_cast<unsigned char>(text[i]);
        std::string piece;
        size_t len = 1;
        size_t controlLen = 0;
        // marks, separators and bidirectional controls rearrange how a line reads
        const unsigned control = layoutControlAt(text, i, controlLen);
        if (c < 0x20 || c == 0x7f) {
            std::snprintf(hex, sizeof hex, "\\x%02x", c);
            piece = hex;
        } else if (c == 0xc2 && i + 1 < text.size() &&
                   static_cast<unsigned char>(text[i + 1]) < 0xa0) {
            // C1 controls (U+0080 … U+009F): some terminals act on them too
            std::snprintf(hex, sizeof hex, "\\u%04x", static_cast<unsigned char>(text[i + 1]));
            piece = hex;
            len = 2;
        } else if (control != 0) {
            std::snprintf(hex, sizeof hex, "\\u%04x", control);
            piece = hex;
            len = controlLen;
        } else {
            len = c < 0x80 ? 1 : c < 0xe0 ? 2 : c < 0xf0 ? 3 : 4;  // valid UTF-8 once sanitized
            piece = text.substr(i, len);
        }
        if (out.size() + piece.size() > kJournalMaxBytes) return out + "…";
        out += piece;
        i += len;
    }
    return out;
}

bool isStatementError(ErrorClass c) {
    return c == ErrorClass::Permission || c == ErrorClass::SchemaMismatch || c == ErrorClass::Sql;
}

bool isSqlState(const char* s) {
    if (!s) return false;
    size_t n = 0;
    for (; s[n] != '\0'; ++n)
        if (n >= 5 || !((s[n] >= '0' && s[n] <= '9') || (s[n] >= 'A' && s[n] <= 'Z'))) return false;
    return n == 5;
}

ErrorClass classifyMysql(unsigned int code) {
    if (oneOf(code, {1045u, 1698u, 1862u, 1251u})) return ErrorClass::Auth;
    if (oneOf(code, {2002u, 2003u, 2005u, 2006u, 2013u, 2055u})) return ErrorClass::Connect;
    // 2026 TLS error; 2061: caching_sha2_password needs a TLS connection (or the server key)
    if (oneOf(code, {2026u, 2061u})) return ErrorClass::Tls;
    if (code == 2059u) return ErrorClass::NoClient;  // authentication plugin missing on the client
    // Any other client error (CR_*, 2000 … 2999), a connection the server closed after a quiet
    // spell (4031) or killed (MariaDB 1927): the session is gone, never kept for the other groups.
    if ((code >= 2000u && code < 3000u) || code == 4031u || code == 1927u)
        return ErrorClass::Connect;
    if (oneOf(code, {1044u, 1142u, 1143u, 1227u, 1370u})) return ErrorClass::Permission;
    if (oneOf(code, {1049u, 1054u, 1146u, 1264u, 1265u, 1292u, 1366u, 1406u}))
        return ErrorClass::SchemaMismatch;
    if (oneOf(code, {1205u, 3024u})) return ErrorClass::Timeout;
    return ErrorClass::Sql;
}

ErrorClass classifyMssql(int number) {
    // server logins; db-lib SYBEPWD
    if (oneOf(number, {18456, 18452, 18486, 18487, 18488, 20014})) return ErrorClass::Auth;
    if (number == 20003) return ErrorClass::Timeout;  // SYBETIME
    // db-lib: SYBEFCON, SYBEREAD, SYBEWRIT, SYBESOCK, SYBECONN, SYBEINTF, SYBEUHST (unknown host),
    // SYBESEOF, SYBEOOB, SYBEDDNE (connection dead)
    if (oneOf(number, {20002, 20004, 20006, 20008, 20009, 20012, 20013, 20017, 20022, 20047}))
        return ErrorClass::Connect;
    if (oneOf(number, {229, 230, 262, 1088, 4902, 15247})) return ErrorClass::Permission;
    if (oneOf(number, {207, 208, 220, 245, 515, 911, 2628, 4060, 8114, 8115, 8152}))
        return ErrorClass::SchemaMismatch;
    return ErrorClass::Sql;
}

ErrorClass classifyMssqlOpen(int number, bool tlsDemanded) {
    if (tlsDemanded && number == 20002) return ErrorClass::Tls;  // SYBEFCON: see the header
    return classifyMssql(number);
}

ErrorClass classifyPg(const std::string& s) {
    if (s == "28P01" || s == "28000") return ErrorClass::Auth;
    if (s.rfind("08", 0) == 0 || s == "57P01" || s == "57P02" || s == "57P03")
        return ErrorClass::Connect;
    if (s == "42501") return ErrorClass::Permission;
    if (s == "57014") return ErrorClass::Timeout;  // statement_timeout
    if (s == "42703" || s == "42P01" || s == "3D000" || s == "3F000" || s == "23502" ||
        s.rfind("22", 0) == 0)
        return ErrorClass::SchemaMismatch;
    return ErrorClass::Sql;
}

ErrorClass classifyPgConnect(const std::string& message) {
    const std::string m = lower(message);
    if (has(m, "password authentication failed") || has(m, "pg_hba.conf") ||
        has(m, "no password supplied") || has(m, "authentication failed") ||
        (has(m, "role") && has(m, "does not exist")))
        return ErrorClass::Auth;
    if (has(m, "ssl") || has(m, "certificate")) return ErrorClass::Tls;
    if (has(m, "timeout") || has(m, "timed out")) return ErrorClass::Timeout;
    if (has(m, "permission denied")) return ErrorClass::Permission;
    if (has(m, "database") && has(m, "does not exist")) return ErrorClass::SchemaMismatch;
    return ErrorClass::Connect;
}

ErrorClass classifyHttp(long status) {
    if (status == 401 || status == 403) return ErrorClass::Auth;
    if (status == 400 || status == 404 || status == 422) return ErrorClass::SchemaMismatch;
    return ErrorClass::Http;
}

ErrorClass classifyCurl(int code) {
    if (code == 28) return ErrorClass::Timeout;  // CURLE_OPERATION_TIMEDOUT
    // SSL_CONNECT_ERROR, PEER_FAILED_VERIFICATION and the other TLS failures
    if (oneOf(code, {35, 51, 53, 54, 58, 59, 60, 64, 66, 77, 80, 82, 83, 90, 91}))
        return ErrorClass::Tls;
    return ErrorClass::Connect;  // resolve, connect, send/receive, empty reply, …
}

const char* errorClassCode(ErrorClass c) {
    switch (c) {
        case ErrorClass::NoClient:
            return "no_client";
        case ErrorClass::NoSecret:
            return "no_secret";
        case ErrorClass::Connect:
            return "connect";
        case ErrorClass::Auth:
            return "auth";
        case ErrorClass::Tls:
            return "tls";
        case ErrorClass::Timeout:
            return "timeout";
        case ErrorClass::Permission:
            return "permission";
        case ErrorClass::SchemaMismatch:
            return "schema_mismatch";
        case ErrorClass::Sql:
            return "sql";
        case ErrorClass::Http:
            return "http";
        case ErrorClass::None:
            break;
    }
    return "";
}

const char* errorClassMessage(ErrorClass c) {
    switch (c) {
        case ErrorClass::NoClient:
            return "Chưa cài thư viện client cho loại DB này";
        case ErrorClass::NoSecret:
            return "Chưa có mật khẩu/token trên thiết bị, hoặc file secrets sai quyền";
        case ErrorClass::Connect:
            return "Không kết nối được máy chủ";
        case ErrorClass::Auth:
            return "Sai tài khoản hoặc mật khẩu";
        case ErrorClass::Tls:
            return "Lỗi mã hóa đường truyền (TLS)";
        case ErrorClass::Timeout:
            return "Hết thời gian chờ máy chủ";
        case ErrorClass::Permission:
            return "Tài khoản thiếu quyền tạo/sửa/ghi bảng";
        case ErrorClass::SchemaMismatch:
            return "Bảng ở DB ngoài không khớp (thiếu cột, sai kiểu), hoặc bucket không có";
        case ErrorClass::Sql:
            return "Lỗi SQL khác (xem dbCode)";
        case ErrorClass::Http:
            return "InfluxDB trả lỗi HTTP (xem dbCode = mã HTTP)";
        case ErrorClass::None:
            break;
    }
    return "";
}

}  // namespace mat
