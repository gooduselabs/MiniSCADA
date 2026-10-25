// Alarm email settings of the device (specs/023-alarm-email FR-004, FR-009; ADR-051):
// <dataDir>/notify/email.json, owner the runtime, mode 0600, written by the admin API. The SMTP
// password is never here: it is the entry "smtp" of the device secrets file (--set-secret smtp).
#pragma once
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include "nlohmann/json.hpp"

namespace mat::notify {

constexpr const char* kEmailConfigSchemaVersion = "1.0.0";
constexpr const char* kSmtpSecretId = "smtp";
constexpr size_t kMaxEmailRules = 20;
constexpr size_t kMaxRuleAddresses = 20;
constexpr size_t kMaxRuleGroups = 16;
constexpr size_t kEmailConfigMaxBytes = 64 * 1024;

enum class SmtpSecurity { StartTls, Smtps, None };
const char* smtpSecurityName(SmtpSecurity s);  // starttls, smtps, none

struct SmtpSettings {
    std::string host;  // DNS name or IPv4
    int port = 587;
    SmtpSecurity security = SmtpSecurity::StartTls;
    std::string username;       // "" = no AUTH
    std::string auth = "auto";  // auto | plain | login
    std::string from;           // envelope and From: address
    std::string fromName;       // display name (UTF-8), "" = "mAT SCADA"
    std::string caFile;         // "" = /etc/ssl/certs/ca-certificates.crt
    std::string pinSha256;      // "" or 64 hex: SHA-256 of the server certificate (DER)
    int timeoutS = 20;          // every step (connect, each reply, TLS handshake)
};

struct EmailRule {
    std::string id;    // ^[a-z0-9][a-z0-9-]{0,31}$
    std::string name;  // shown on the page
    bool enabled = true;
    std::vector<int> priorities;       // 1..4; empty = every priority
    std::vector<std::string> classes;  // class ids; empty = every class
    std::vector<std::string> areas;    // area ids, "-" = Chung; empty = every area
    bool onActive = true, onReturn = false, onReminder = false;
    int reminderMin = 30;             // 5..1440
    std::vector<std::string> to;      // addresses
    std::vector<std::string> groups;  // group ids of access.json (feature 013)
};

struct QuietHours {
    bool enabled = false;
    int fromMin = 22 * 60;  // minute of the day, device local time
    int toMin = 6 * 60;
    int minPriority = 1;  // during quiet hours only priority <= this is sent
    bool contains(int minuteOfDay) const;
};

struct EmailConfig {
    int64_t rev = 0;
    bool enabled = false;
    std::string siteName;  // "Trạm bơm số 1"
    std::string baseUrl;   // "https://192.0.2.10:8443": link <baseUrl>/alarms; "" = none
    SmtpSettings smtp;
    std::vector<EmailRule> rules;
    QuietHours quiet;
    int batchSeconds = 30;  // 5..600
    int maxPerHour = 20;    // 1..120
    int reminderMax = 3;    // 1..20
};

// Checks the whole object strictly (unknown keys, types, ranges); `err` names the first problem
// in Vietnamese. `rev` is read when present.
bool parseEmailConfig(const nlohmann::json& j, EmailConfig& out, std::string& err);
nlohmann::json emailConfigJson(const EmailConfig& c);

// Missing file: defaults (rev 0) and true. A file that cannot be used: false and `err`.
bool readEmailConfigFile(const std::string& path, EmailConfig& out, std::string& err);
// Temporary file, fsync, mode 0600, rename, fsync of the directory (made 0700 when missing).
bool writeEmailConfigFile(const std::string& path, const EmailConfig& c, std::string& err);

bool validRuleId(std::string_view id);
// "HH:MM" -> minute of the day; -1 when not valid.
int parseClock(std::string_view s);
std::string clockText(int minuteOfDay);

// Small file helpers shared by the module.
bool ensurePrivateDir(const std::string& dir);
bool writeFileAtomic(const std::string& path, const std::string& data, std::string& err);

}  // namespace mat::notify
