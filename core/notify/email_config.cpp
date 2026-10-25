#include "core/notify/email_config.hpp"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <set>
#include <sstream>

#include "core/auth/account_store.hpp"

namespace mat::notify {

using nlohmann::json;

const char* smtpSecurityName(SmtpSecurity s) {
    switch (s) {
        case SmtpSecurity::StartTls:
            return "starttls";
        case SmtpSecurity::Smtps:
            return "smtps";
        case SmtpSecurity::None:
            return "none";
    }
    return "";
}

bool QuietHours::contains(int m) const {
    if (!enabled || fromMin == toMin) return false;
    return fromMin < toMin ? (m >= fromMin && m < toMin) : (m >= fromMin || m < toMin);
}

bool validRuleId(std::string_view id) {
    if (id.empty() || id.size() > 32) return false;
    for (size_t i = 0; i < id.size(); ++i) {
        const char c = id[i];
        const bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || (i > 0 && c == '-');
        if (!ok) return false;
    }
    return true;
}

int parseClock(std::string_view s) {
    if (s.size() != 5 || s[2] != ':') return -1;
    for (int i : {0, 1, 3, 4})
        if (s[i] < '0' || s[i] > '9') return -1;
    const int h = (s[0] - '0') * 10 + (s[1] - '0');
    const int m = (s[3] - '0') * 10 + (s[4] - '0');
    if (h > 23 || m > 59) return -1;
    return h * 60 + m;
}

std::string clockText(int m) {
    char b[8];
    std::snprintf(b, sizeof b, "%02d:%02d", (m / 60) % 24, m % 60);
    return b;
}

namespace {

bool validHost(const std::string& h) {
    if (h.empty() || h.size() > 253) return false;
    for (char c : h)
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
              c == '.' || c == '-'))
            return false;
    return h.front() != '.' && h.front() != '-';
}

bool isHex64(const std::string& s) {
    if (s.size() != 64) return false;
    for (char c : s)
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    return true;
}

// Printable text without control characters (they would break a header), at most `max` bytes.
bool plainText(const std::string& s, size_t max) {
    if (s.size() > max) return false;
    for (unsigned char c : s)
        if (c < 0x20 || c == 0x7f) return false;
    return true;
}

struct Checker {
    std::string& err;
    bool fail(const std::string& m) {
        err = m;
        return false;
    }
    bool keys(const json& o, std::initializer_list<const char*> allowed, const std::string& where) {
        if (!o.is_object()) return fail(where + " phải là object");
        for (auto it = o.begin(); it != o.end(); ++it) {
            bool known = false;
            for (const char* k : allowed) known = known || it.key() == k;
            if (!known) return fail(where + ": khóa lạ '" + it.key() + "'");
        }
        return true;
    }
    bool integer(const json& o, const char* k, int lo, int hi, int& out, const std::string& w) {
        if (!o.contains(k)) return true;
        const json& v = o[k];
        if (!v.is_number_integer() || v.get<int64_t>() < lo || v.get<int64_t>() > hi)
            return fail(w + "." + k + " phải là số nguyên " + std::to_string(lo) + ".." +
                        std::to_string(hi));
        out = v.get<int>();
        return true;
    }
    bool boolean(const json& o, const char* k, bool& out, const std::string& w) {
        if (!o.contains(k)) return true;
        if (!o[k].is_boolean()) return fail(w + "." + k + " phải là true/false");
        out = o[k].get<bool>();
        return true;
    }
    bool text(const json& o, const char* k, size_t max, std::string& out, const std::string& w) {
        if (!o.contains(k)) return true;
        if (!o[k].is_string() || !plainText(o[k].get<std::string>(), max))
            return fail(w + "." + k + " phải là chuỗi tối đa " + std::to_string(max) +
                        " byte, không ký tự điều khiển");
        out = o[k].get<std::string>();
        return true;
    }
    bool strings(const json& o, const char* k, size_t maxItems, std::vector<std::string>& out,
                 const std::string& w, bool (*valid)(const std::string&)) {
        if (!o.contains(k)) return true;
        const json& v = o[k];
        if (!v.is_array() || v.size() > maxItems)
            return fail(w + "." + k + " phải là mảng tối đa " + std::to_string(maxItems) +
                        " phần tử");
        std::set<std::string> seen;
        for (const auto& x : v) {
            if (!x.is_string() || !valid(x.get<std::string>()) ||
                !seen.insert(x.get<std::string>()).second)
                return fail(w + "." + k + " có phần tử sai hoặc trùng");
            out.push_back(x.get<std::string>());
        }
        return true;
    }
};

bool validId(const std::string& s) {
    return !s.empty() && s.size() <= 64 && plainText(s, 64) && s.find(' ') == std::string::npos;
}
bool validAddress(const std::string& s) { return validAccountEmail(s); }

}  // namespace

bool parseEmailConfig(const json& j, EmailConfig& out, std::string& err) {
    Checker c{err};
    EmailConfig r;
    if (!c.keys(j,
                {"schemaVersion", "rev", "enabled", "siteName", "baseUrl", "smtp", "rules",
                 "quietHours", "batchSeconds", "maxPerHour", "reminderMax"},
                "email"))
        return false;
    if (j.contains("schemaVersion") && (!j["schemaVersion"].is_string() ||
                                        j["schemaVersion"].get<std::string>().rfind("1.", 0) != 0))
        return c.fail("schemaVersion phải là 1.x.y");
    if (j.contains("rev")) {
        if (!j["rev"].is_number_integer() || j["rev"].get<int64_t>() < 0)
            return c.fail("rev phải là số nguyên >= 0");
        r.rev = j["rev"].get<int64_t>();
    }
    if (!c.boolean(j, "enabled", r.enabled, "email") ||
        !c.text(j, "siteName", 80, r.siteName, "email") ||
        !c.text(j, "baseUrl", 200, r.baseUrl, "email") ||
        !c.integer(j, "batchSeconds", 5, 600, r.batchSeconds, "email") ||
        !c.integer(j, "maxPerHour", 1, 120, r.maxPerHour, "email") ||
        !c.integer(j, "reminderMax", 1, 20, r.reminderMax, "email"))
        return false;
    if (!r.baseUrl.empty() && r.baseUrl.rfind("https://", 0) != 0 &&
        r.baseUrl.rfind("http://", 0) != 0)
        return c.fail("baseUrl phải bắt đầu bằng https:// hoặc http://");
    if (!r.baseUrl.empty() && (r.baseUrl.find_first_of(" \"'<>\\") != std::string::npos))
        return c.fail("baseUrl có ký tự không hợp lệ");
    while (!r.baseUrl.empty() && r.baseUrl.back() == '/') r.baseUrl.pop_back();

    if (j.contains("smtp")) {
        const json& s = j["smtp"];
        if (!c.keys(s,
                    {"host", "port", "security", "username", "auth", "from", "fromName", "caFile",
                     "pinSha256", "timeoutS"},
                    "smtp"))
            return false;
        SmtpSettings& m = r.smtp;
        if (!c.text(s, "host", 253, m.host, "smtp") ||
            !c.integer(s, "port", 1, 65535, m.port, "smtp") ||
            !c.text(s, "username", 254, m.username, "smtp") ||
            !c.text(s, "from", 254, m.from, "smtp") ||
            !c.text(s, "fromName", 80, m.fromName, "smtp") ||
            !c.text(s, "caFile", 255, m.caFile, "smtp") ||
            !c.text(s, "pinSha256", 95, m.pinSha256, "smtp") ||
            !c.integer(s, "timeoutS", 5, 120, m.timeoutS, "smtp"))
            return false;
        if (!m.host.empty() && !validHost(m.host)) return c.fail("smtp.host không hợp lệ");
        if (!m.from.empty() && !validAccountEmail(m.from))
            return c.fail("smtp.from không phải địa chỉ email hợp lệ");
        if (s.contains("security")) {
            const json& v = s["security"];
            const std::string t = v.is_string() ? v.get<std::string>() : "";
            if (t == "starttls")
                m.security = SmtpSecurity::StartTls;
            else if (t == "smtps")
                m.security = SmtpSecurity::Smtps;
            else if (t == "none")
                m.security = SmtpSecurity::None;
            else
                return c.fail("smtp.security phải là starttls, smtps hoặc none");
        }
        if (s.contains("auth")) {
            if (!s["auth"].is_string()) return c.fail("smtp.auth phải là auto, plain hoặc login");
            m.auth = s["auth"].get<std::string>();
            if (m.auth != "auto" && m.auth != "plain" && m.auth != "login")
                return c.fail("smtp.auth phải là auto, plain hoặc login");
        }
        std::string pin;
        for (char ch : m.pinSha256)
            if (ch != ':') pin += static_cast<char>(ch >= 'A' && ch <= 'F' ? ch - 'A' + 'a' : ch);
        if (!pin.empty() && !isHex64(pin))
            return c.fail("smtp.pinSha256 phải là 64 ký tự hex (SHA-256 của chứng chỉ)");
        m.pinSha256 = pin;
        if (!m.caFile.empty() && m.caFile.front() != '/')
            return c.fail("smtp.caFile phải là đường dẫn tuyệt đối");
    }

    if (j.contains("rules")) {
        const json& rs = j["rules"];
        if (!rs.is_array() || rs.size() > kMaxEmailRules)
            return c.fail("rules phải là mảng tối đa 20 quy tắc");
        std::set<std::string> ids;
        for (size_t i = 0; i < rs.size(); ++i) {
            const json& x = rs[i];
            const std::string w = "rules[" + std::to_string(i) + "]";
            EmailRule e;
            if (!c.keys(x,
                        {"id", "name", "enabled", "priorities", "classes", "areas", "events",
                         "reminderMin", "to", "groups"},
                        w))
                return false;
            if (!x.contains("id") || !x["id"].is_string() ||
                !validRuleId(x["id"].get<std::string>()) ||
                !ids.insert(x["id"].get<std::string>()).second)
                return c.fail(w + ".id thiếu, sai mẫu [a-z0-9-] hoặc trùng");
            e.id = x["id"].get<std::string>();
            if (!c.text(x, "name", 80, e.name, w) || !c.boolean(x, "enabled", e.enabled, w) ||
                !c.integer(x, "reminderMin", 5, 1440, e.reminderMin, w) ||
                !c.strings(x, "classes", 64, e.classes, w, validId) ||
                !c.strings(x, "areas", 64, e.areas, w, validId) ||
                !c.strings(x, "to", kMaxRuleAddresses, e.to, w, validAddress) ||
                !c.strings(x, "groups", kMaxRuleGroups, e.groups, w, validId))
                return false;
            if (x.contains("priorities")) {
                const json& p = x["priorities"];
                if (!p.is_array() || p.size() > 4)
                    return c.fail(w + ".priorities phải là mảng 1..4");
                std::set<int> seen;
                for (const auto& v : p) {
                    if (!v.is_number_integer() || v.get<int>() < 1 || v.get<int>() > 4 ||
                        !seen.insert(v.get<int>()).second)
                        return c.fail(w + ".priorities phải là mảng 1..4 không trùng");
                    e.priorities.push_back(v.get<int>());
                }
            }
            if (x.contains("events")) {
                const json& ev = x["events"];
                if (!ev.is_array() || ev.empty() || ev.size() > 3)
                    return c.fail(w + ".events phải có 1..3 phần tử active, return, reminder");
                e.onActive = e.onReturn = e.onReminder = false;
                for (const auto& v : ev) {
                    const std::string t = v.is_string() ? v.get<std::string>() : "";
                    if (t == "active")
                        e.onActive = true;
                    else if (t == "return")
                        e.onReturn = true;
                    else if (t == "reminder")
                        e.onReminder = true;
                    else
                        return c.fail(w + ".events chỉ nhận active, return, reminder");
                }
            }
            if (e.to.empty() && e.groups.empty())
                return c.fail(w + ": cần ít nhất một địa chỉ (to) hoặc một nhóm (groups)");
            r.rules.push_back(std::move(e));
        }
    }

    if (j.contains("quietHours")) {
        const json& q = j["quietHours"];
        if (!c.keys(q, {"enabled", "from", "to", "minPriority"}, "quietHours") ||
            !c.boolean(q, "enabled", r.quiet.enabled, "quietHours") ||
            !c.integer(q, "minPriority", 1, 4, r.quiet.minPriority, "quietHours"))
            return false;
        for (const char* k : {"from", "to"}) {
            if (!q.contains(k)) continue;
            const int m = q[k].is_string() ? parseClock(q[k].get<std::string>()) : -1;
            if (m < 0) return c.fail(std::string("quietHours.") + k + " phải có dạng HH:MM");
            (std::string(k) == "from" ? r.quiet.fromMin : r.quiet.toMin) = m;
        }
    }
    if (r.enabled && (r.smtp.host.empty() || r.smtp.from.empty()))
        return c.fail("bật gửi email cần smtp.host và smtp.from");
    out = std::move(r);
    return true;
}

json emailConfigJson(const EmailConfig& c) {
    json rules = json::array();
    for (const EmailRule& e : c.rules) {
        json ev = json::array();
        if (e.onActive) ev.push_back("active");
        if (e.onReturn) ev.push_back("return");
        if (e.onReminder) ev.push_back("reminder");
        rules.push_back({{"id", e.id},
                         {"name", e.name},
                         {"enabled", e.enabled},
                         {"priorities", e.priorities},
                         {"classes", e.classes},
                         {"areas", e.areas},
                         {"events", ev},
                         {"reminderMin", e.reminderMin},
                         {"to", e.to},
                         {"groups", e.groups}});
    }
    return {{"schemaVersion", kEmailConfigSchemaVersion},
            {"rev", c.rev},
            {"enabled", c.enabled},
            {"siteName", c.siteName},
            {"baseUrl", c.baseUrl},
            {"smtp",
             {{"host", c.smtp.host},
              {"port", c.smtp.port},
              {"security", smtpSecurityName(c.smtp.security)},
              {"username", c.smtp.username},
              {"auth", c.smtp.auth},
              {"from", c.smtp.from},
              {"fromName", c.smtp.fromName},
              {"caFile", c.smtp.caFile},
              {"pinSha256", c.smtp.pinSha256},
              {"timeoutS", c.smtp.timeoutS}}},
            {"rules", rules},
            {"quietHours",
             {{"enabled", c.quiet.enabled},
              {"from", clockText(c.quiet.fromMin)},
              {"to", clockText(c.quiet.toMin)},
              {"minPriority", c.quiet.minPriority}}},
            {"batchSeconds", c.batchSeconds},
            {"maxPerHour", c.maxPerHour},
            {"reminderMax", c.reminderMax}};
}

bool readEmailConfigFile(const std::string& path, EmailConfig& out, std::string& err) {
    struct stat st {};
    if (::lstat(path.c_str(), &st) != 0) {
        if (errno == ENOENT) {
            out = EmailConfig{};
            return true;
        }
        err = path + ": " + std::strerror(errno);
        return false;
    }
    if (!S_ISREG(st.st_mode) || st.st_size > static_cast<off_t>(kEmailConfigMaxBytes)) {
        err = path + ": không phải file thường hoặc quá 64 KiB";
        return false;
    }
    std::ifstream f(path, std::ios::binary);
    std::stringstream ss;
    ss << f.rdbuf();
    const json j = json::parse(ss.str(), nullptr, false);
    if (j.is_discarded()) {
        err = path + ": không phải JSON";
        return false;
    }
    if (!parseEmailConfig(j, out, err)) {
        err = path + ": " + err;
        return false;
    }
    return true;
}

bool ensurePrivateDir(const std::string& dir) {
    if (::mkdir(dir.c_str(), 0700) == 0) return true;
    struct stat st {};
    return errno == EEXIST && ::stat(dir.c_str(), &st) == 0 && S_ISDIR(st.st_mode);
}

bool writeFileAtomic(const std::string& path, const std::string& data, std::string& err) {
    const size_t slash = path.rfind('/');
    const std::string dir = slash == std::string::npos ? "." : path.substr(0, slash);
    if (!ensurePrivateDir(dir)) {
        err = "không tạo được thư mục " + dir;
        return false;
    }
    const std::string tmp = path + ".tmp";
    const int fd = ::open(tmp.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
    if (fd < 0) {
        err = tmp + ": " + std::strerror(errno);
        return false;
    }
    size_t at = 0;
    bool ok = true;
    while (at < data.size()) {
        const ssize_t n = ::write(fd, data.data() + at, data.size() - at);
        if (n < 0) {
            if (errno == EINTR) continue;
            ok = false;
            break;
        }
        at += static_cast<size_t>(n);
    }
    ok = ok && ::fchmod(fd, 0600) == 0 && ::fsync(fd) == 0;
    const int e = errno;
    ::close(fd);
    if (!ok || ::rename(tmp.c_str(), path.c_str()) != 0) {
        err = path + ": " + std::strerror(ok ? errno : e);
        ::unlink(tmp.c_str());
        return false;
    }
    const int dfd = ::open(dir.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dfd >= 0) {
        ::fsync(dfd);
        ::close(dfd);
    }
    return true;
}

bool writeEmailConfigFile(const std::string& path, const EmailConfig& c, std::string& err) {
    return writeFileAtomic(path, emailConfigJson(c).dump(2) + "\n", err);
}

}  // namespace mat::notify
