// The text of an alarm email (specs/023-alarm-email FR-008): Vietnamese, UTF-8, Subject encoded
// as RFC 2047 words, multipart/alternative with a plain text and a simple HTML part (every value
// escaped), both base64. Pure functions: no clock, no I/O.
#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mat::notify {

enum class EmailEvent { Active, Return, Reminder };
const char* emailEventName(EmailEvent e);        // active, return, reminder
const char* emailEventLabel(EmailEvent e);       // Vietnamese
const char* priorityLabel(int priority);         // Khẩn cấp, Quan trọng, Nhỏ, Thông tin
const char* stateLabel(std::string_view state);  // ACTIVE_UNACK -> Vietnamese

struct EmailItem {
    EmailEvent event = EmailEvent::Active;
    int64_t tsEpochMs = 0;  // when the alarm event happened
    int priority = 3;
    std::string alarmId, name, tag, area, className;
    std::optional<double> value;
    std::string text;   // the alarm message
    std::string state;  // ACTIVE_UNACK, ACTIVE_ACK, RTN_UNACK, NORMAL
    int64_t occurrence = 0;
};

struct EmailContent {
    std::string siteName;
    std::string baseUrl;  // "" = no link
    std::vector<EmailItem> items;
    size_t more = 0;        // events of this batch not listed (above the list limit)
    size_t suppressed = 0;  // events dropped since the last email (queue limit), told once
    int tzOffsetMin = 0;    // device local time = UTC + this
};

struct RenderedEmail {
    std::string subject;  // UTF-8, not encoded
    std::string text;
    std::string html;
};

RenderedEmail renderAlarmEmail(const EmailContent& c);
RenderedEmail renderTestEmail(const std::string& siteName, const std::string& baseUrl,
                              int64_t nowEpochMs, int tzOffsetMin);

// "2026-10-25 14:03:07 (UTC+07:00)"
std::string formatTime(int64_t epochMs, int tzOffsetMin);

// RFC 2047 encoded words (=?UTF-8?B?...?=), each at most 75 characters, folded with CRLF SP;
// never splits a UTF-8 sequence. Plain ASCII without specials is returned as is.
std::string encodeHeader(std::string_view utf8);
std::string htmlEscape(std::string_view s);
std::string base64Lines(std::string_view data);  // 76 characters per line, CRLF

struct MimeEnvelope {
    std::string from, fromName;
    std::vector<std::string> to;
    int64_t dateEpochMs = 0;
    int tzOffsetMin = 0;
    std::string messageId;  // without <>, e.g. "1730000000000.4f2a@mat-scada"
    std::string boundary;   // random text, not in the bodies (base64 never has '=_')
};
// The whole message (headers + body), lines ending CRLF.
std::string buildMime(const MimeEnvelope& env, const RenderedEmail& body);

// DATA payload: CRLF line ends, a '.' doubled at the start of a line, then CRLF "." CRLF.
std::string smtpData(std::string_view message);

}  // namespace mat::notify
