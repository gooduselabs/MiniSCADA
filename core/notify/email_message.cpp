#include "core/notify/email_message.hpp"

#include <cmath>
#include <cstdio>
#include <ctime>

namespace mat::notify {

const char* emailEventName(EmailEvent e) {
    switch (e) {
        case EmailEvent::Active:
            return "active";
        case EmailEvent::Return:
            return "return";
        case EmailEvent::Reminder:
            return "reminder";
    }
    return "";
}

const char* emailEventLabel(EmailEvent e) {
    switch (e) {
        case EmailEvent::Active:
            return "Xuất hiện";
        case EmailEvent::Return:
            return "Đã hết";
        case EmailEvent::Reminder:
            return "Nhắc lại: chưa xác nhận";
    }
    return "";
}

const char* priorityLabel(int p) {
    switch (p) {
        case 1:
            return "Khẩn cấp";
        case 2:
            return "Quan trọng";
        case 3:
            return "Nhỏ";
        case 4:
            return "Thông tin";
    }
    return "?";
}

const char* stateLabel(std::string_view s) {
    if (s == "ACTIVE_UNACK") return "Đang có, chưa xác nhận";
    if (s == "ACTIVE_ACK") return "Đang có, đã xác nhận";
    if (s == "RTN_UNACK") return "Đã hết, chưa xác nhận";
    if (s == "NORMAL") return "Bình thường";
    return "?";
}

std::string formatTime(int64_t ms, int tz) {
    const time_t t = static_cast<time_t>((ms / 1000) + static_cast<int64_t>(tz) * 60);
    tm v{};
    ::gmtime_r(&t, &v);
    char b[64];
    const int a = tz < 0 ? -tz : tz;
    std::snprintf(b, sizeof b, "%04d-%02d-%02d %02d:%02d:%02d (UTC%c%02d:%02d)", v.tm_year + 1900,
                  v.tm_mon + 1, v.tm_mday, v.tm_hour, v.tm_min, v.tm_sec, tz < 0 ? '-' : '+',
                  a / 60, a % 60);
    return b;
}

namespace {

const char kB64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string base64(std::string_view in) {
    std::string out;
    out.reserve((in.size() + 2) / 3 * 4);
    size_t i = 0;
    for (; i + 2 < in.size(); i += 3) {
        const uint32_t v = (static_cast<unsigned char>(in[i]) << 16) |
                           (static_cast<unsigned char>(in[i + 1]) << 8) |
                           static_cast<unsigned char>(in[i + 2]);
        out += kB64[(v >> 18) & 63];
        out += kB64[(v >> 12) & 63];
        out += kB64[(v >> 6) & 63];
        out += kB64[v & 63];
    }
    if (i < in.size()) {
        uint32_t v = static_cast<unsigned char>(in[i]) << 16;
        if (i + 1 < in.size()) v |= static_cast<unsigned char>(in[i + 1]) << 8;
        out += kB64[(v >> 18) & 63];
        out += kB64[(v >> 12) & 63];
        out += i + 1 < in.size() ? kB64[(v >> 6) & 63] : '=';
        out += '=';
    }
    return out;
}

bool plainAsciiWord(std::string_view s) {
    for (unsigned char c : s)
        if (c < 0x20 || c > 0x7e || c == '=' || c == '?' || c == '"' || c == ',' || c == ';' ||
            c == ':' || c == '<' || c == '>' || c == '(' || c == ')' || c == '@' || c == '[' ||
            c == ']' || c == '\\' || c == '_')
            return false;
    return s.size() <= 70;
}

size_t utf8Len(unsigned char c) {
    if (c < 0x80) return 1;
    if ((c >> 5) == 6) return 2;
    if ((c >> 4) == 14) return 3;
    if ((c >> 3) == 30) return 4;
    return 1;
}

std::string valueText(const std::optional<double>& v) {
    if (!v || !std::isfinite(*v)) return "n/a";
    char b[32];
    std::snprintf(b, sizeof b, "%.6g", *v);
    return b;
}

std::string clip(std::string_view s, size_t max) {
    if (s.size() <= max) return std::string(s);
    size_t n = max;
    while (n > 0 && (static_cast<unsigned char>(s[n]) & 0xC0) == 0x80) --n;
    return std::string(s.substr(0, n)) + "…";
}

std::string countLine(const std::vector<EmailItem>& items, size_t more) {
    int byP[5] = {0, 0, 0, 0, 0};
    for (const auto& i : items)
        if (i.priority >= 1 && i.priority <= 4) ++byP[i.priority];
    std::string s = std::to_string(items.size() + more) + " sự kiện alarm";
    std::string parts;
    for (int p = 1; p <= 4; ++p)
        if (byP[p]) {
            if (!parts.empty()) parts += ", ";
            parts += std::to_string(byP[p]) + " " + priorityLabel(p);
        }
    if (!parts.empty()) s += " (" + parts + ")";
    return s;
}

std::string siteOf(const std::string& s) { return s.empty() ? "mAT SCADA" : s; }

}  // namespace

std::string htmlEscape(std::string_view s) {
    std::string o;
    o.reserve(s.size());
    for (char c : s) {
        switch (c) {
            case '&':
                o += "&amp;";
                break;
            case '<':
                o += "&lt;";
                break;
            case '>':
                o += "&gt;";
                break;
            case '"':
                o += "&quot;";
                break;
            case '\'':
                o += "&#39;";
                break;
            default:
                o += c;
        }
    }
    return o;
}

std::string encodeHeader(std::string_view s) {
    if (plainAsciiWord(s)) return std::string(s);
    // 75 - len("=?UTF-8?B?") - len("?=") = 63 base64 characters -> at most 45 bytes per word.
    std::string out;
    size_t at = 0;
    while (at < s.size()) {
        size_t n = 0;
        while (at + n < s.size()) {
            const size_t l = utf8Len(static_cast<unsigned char>(s[at + n]));
            if (n + l > 45) break;
            n += l;
        }
        if (n == 0) n = 1;
        if (!out.empty()) out += "\r\n ";
        out += "=?UTF-8?B?" + base64(s.substr(at, n)) + "?=";
        at += n;
    }
    return out;
}

std::string base64Lines(std::string_view data) {
    const std::string b = base64(data);
    std::string o;
    for (size_t i = 0; i < b.size(); i += 76) o += b.substr(i, 76) + "\r\n";
    return o;
}

RenderedEmail renderAlarmEmail(const EmailContent& c) {
    RenderedEmail r;
    const std::string site = siteOf(c.siteName);
    bool allReminder = !c.items.empty();
    for (const auto& i : c.items) allReminder = allReminder && i.event == EmailEvent::Reminder;
    if (c.items.size() == 1 && c.more == 0) {
        const EmailItem& i = c.items[0];
        r.subject = "[" + site + "] " + (allReminder ? "Nhắc lại " : "") +
                    priorityLabel(i.priority) + ": " +
                    clip(i.name.empty() ? i.alarmId : i.name, 80) +
                    (i.event == EmailEvent::Return ? " (đã hết)" : "");
    } else {
        r.subject =
            "[" + site + "] " + (allReminder ? "Nhắc lại: " : "") + countLine(c.items, c.more);
    }

    const std::string link = c.baseUrl.empty() ? "" : c.baseUrl + "/alarms";
    std::string t;
    t += "Trạm: " + site + "\r\n";
    t += countLine(c.items, c.more) + "\r\n\r\n";
    std::string rows;
    for (const EmailItem& i : c.items) {
        t += "- " + std::string(emailEventLabel(i.event)) + " | " + priorityLabel(i.priority) +
             " | " + formatTime(i.tsEpochMs, c.tzOffsetMin) + "\r\n";
        t += "  Alarm: " + (i.name.empty() ? i.alarmId : i.name) + " (" + i.alarmId + ")\r\n";
        if (!i.tag.empty()) t += "  Tag: " + i.tag + " = " + valueText(i.value) + "\r\n";
        if (!i.area.empty()) t += "  Khu: " + i.area + "\r\n";
        if (!i.className.empty()) t += "  Lớp: " + i.className + "\r\n";
        t += "  Thông điệp: " + i.text + "\r\n";
        t += "  Trạng thái: " + std::string(stateLabel(i.state)) + "\r\n\r\n";

        const char* color =
            i.priority == 1 ? "#b00020"
                            : i.priority == 2 ? "#c75b00" : i.priority == 3 ? "#8a6d00" : "#555555";
        rows += "<tr><td style=\"padding:4px 8px;border-bottom:1px solid #ddd\">" +
                htmlEscape(emailEventLabel(i.event)) + "</td>";
        rows +=
            "<td style=\"padding:4px 8px;border-bottom:1px solid #ddd;color:" + std::string(color) +
            ";font-weight:bold\">" + htmlEscape(priorityLabel(i.priority)) + "</td>";
        rows += "<td style=\"padding:4px 8px;border-bottom:1px solid #ddd\">" +
                htmlEscape(formatTime(i.tsEpochMs, c.tzOffsetMin)) + "</td>";
        rows += "<td style=\"padding:4px 8px;border-bottom:1px solid #ddd\">" +
                htmlEscape(i.name.empty() ? i.alarmId : i.name) + "<br><small>" +
                htmlEscape(i.alarmId) + (i.area.empty() ? "" : " · " + htmlEscape(i.area)) +
                "</small></td>";
        rows += "<td style=\"padding:4px 8px;border-bottom:1px solid #ddd\">" +
                htmlEscape(i.tag.empty() ? "" : i.tag + " = " + valueText(i.value)) + "</td>";
        rows += "<td style=\"padding:4px 8px;border-bottom:1px solid #ddd\">" + htmlEscape(i.text) +
                "</td>";
        rows += "<td style=\"padding:4px 8px;border-bottom:1px solid #ddd\">" +
                htmlEscape(stateLabel(i.state)) + "</td></tr>\r\n";
    }
    if (c.more) t += "... và " + std::to_string(c.more) + " sự kiện khác (xem trang Alarm).\r\n";
    if (c.suppressed)
        t += "Lưu ý: " + std::to_string(c.suppressed) +
             " sự kiện trước đó không được gửi (vượt giới hạn hàng chờ).\r\n";
    if (!link.empty()) t += "Trang Alarm: " + link + "\r\n";
    t += "\r\nEmail tự động từ mAT SCADA. Không trả lời email này.\r\n";
    r.text = t;

    std::string h;
    h += "<!DOCTYPE html><html lang=\"vi\"><head><meta charset=\"utf-8\"><title>" +
         htmlEscape(r.subject) + "</title></head><body style=\"font-family:Arial,sans-serif\">\r\n";
    h += "<p><b>Trạm:</b> " + htmlEscape(site) + "<br>" + htmlEscape(countLine(c.items, c.more)) +
         "</p>\r\n";
    h += "<table style=\"border-collapse:collapse;font-size:14px\"><thead><tr>"
         "<th align=\"left\">Sự kiện</th><th align=\"left\">Mức</th><th align=\"left\">Thời "
         "gian</th>"
         "<th align=\"left\">Alarm</th><th align=\"left\">Tag = giá trị</th>"
         "<th align=\"left\">Thông điệp</th><th align=\"left\">Trạng "
         "thái</th></tr></thead><tbody>\r\n";
    h += rows;
    h += "</tbody></table>\r\n";
    if (c.more)
        h += "<p>... và " + std::to_string(c.more) + " sự kiện khác (xem trang Alarm).</p>\r\n";
    if (c.suppressed)
        h += "<p>Lưu ý: " + std::to_string(c.suppressed) +
             " sự kiện trước đó không được gửi (vượt giới hạn hàng chờ).</p>\r\n";
    if (!link.empty()) h += "<p><a href=\"" + htmlEscape(link) + "\">Mở trang Alarm</a></p>\r\n";
    h += "<p style=\"color:#777;font-size:12px\">Email tự động từ mAT SCADA. Không trả lời email "
         "này.</p></body></html>\r\n";
    r.html = h;
    return r;
}

RenderedEmail renderTestEmail(const std::string& siteName, const std::string& baseUrl,
                              int64_t nowEpochMs, int tz) {
    RenderedEmail r;
    const std::string site = siteOf(siteName);
    r.subject = "[" + site + "] Email thử";
    const std::string when = formatTime(nowEpochMs, tz);
    r.text = "Email thử từ " + site + " lúc " + when +
             ".\r\nCấu hình gửi email alarm hoạt động.\r\n" +
             (baseUrl.empty() ? "" : "Trang Alarm: " + baseUrl + "/alarms\r\n");
    r.html = "<!DOCTYPE html><html lang=\"vi\"><head><meta charset=\"utf-8\"><title>" +
             htmlEscape(r.subject) + "</title></head><body><p>Email thử từ <b>" + htmlEscape(site) +
             "</b> lúc " + htmlEscape(when) + ".</p><p>Cấu hình gửi email alarm hoạt động.</p>" +
             (baseUrl.empty() ? ""
                              : "<p><a href=\"" + htmlEscape(baseUrl + "/alarms") +
                                    "\">Mở trang Alarm</a></p>") +
             "</body></html>\r\n";
    return r;
}

std::string buildMime(const MimeEnvelope& env, const RenderedEmail& body) {
    std::string m;
    const std::string fromName = env.fromName.empty() ? "mAT SCADA" : env.fromName;
    m += "From: " + encodeHeader(fromName) + " <" + env.from + ">\r\n";
    m += "To: ";
    for (size_t i = 0; i < env.to.size(); ++i) m += (i ? ",\r\n " : "") + env.to[i];
    m += "\r\n";
    m += "Subject: " + encodeHeader(body.subject) + "\r\n";
    // Date (RFC 5322 §3.3), in the device's offset.
    {
        static const char* kDays[] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
        static const char* kMonths[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
        const time_t t = static_cast<time_t>(env.dateEpochMs / 1000 + env.tzOffsetMin * 60);
        tm v{};
        ::gmtime_r(&t, &v);
        const int a = env.tzOffsetMin < 0 ? -env.tzOffsetMin : env.tzOffsetMin;
        char b[64];
        std::snprintf(b, sizeof b, "%s, %02d %s %04d %02d:%02d:%02d %c%02d%02d", kDays[v.tm_wday],
                      v.tm_mday, kMonths[v.tm_mon], v.tm_year + 1900, v.tm_hour, v.tm_min, v.tm_sec,
                      env.tzOffsetMin < 0 ? '-' : '+', a / 60, a % 60);
        m += std::string("Date: ") + b + "\r\n";
    }
    m += "Message-ID: <" + env.messageId + ">\r\n";
    m += "MIME-Version: 1.0\r\n";
    m += "Auto-Submitted: auto-generated\r\n";
    m += "X-Auto-Response-Suppress: All\r\n";
    m += "Content-Type: multipart/alternative; boundary=\"" + env.boundary + "\"\r\n\r\n";
    m += "--" + env.boundary + "\r\n";
    m += "Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n";
    m += base64Lines(body.text);
    m += "--" + env.boundary + "\r\n";
    m += "Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n";
    m += base64Lines(body.html);
    m += "--" + env.boundary + "--\r\n";
    return m;
}

std::string smtpData(std::string_view msg) {
    std::string o;
    o.reserve(msg.size() + 16);
    bool lineStart = true;
    for (size_t i = 0; i < msg.size(); ++i) {
        const char c = msg[i];
        if (c == '\r') continue;  // normalised below
        if (c == '\n') {
            o += "\r\n";
            lineStart = true;
            continue;
        }
        if (lineStart && c == '.') o += '.';
        o += c;
        lineStart = false;
    }
    if (!lineStart) o += "\r\n";
    o += ".\r\n";
    return o;
}

}  // namespace mat::notify
