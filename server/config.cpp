#include "server/config.hpp"

#include <unistd.h>

#include <algorithm>
#include <climits>
#include <cstdint>
#include <fstream>
#include <sstream>

#include "core/common/utf8.hpp"
#include "core/session-manager/session_manager.hpp"
#include "nlohmann/json.hpp"
#include "server/http/conn_limit.hpp"

namespace mat {

using nlohmann::json;

std::optional<std::string> readTextFile(const std::string& path, size_t maxBytes) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return std::nullopt;
    std::string s;
    char buf[8192];
    while (f.read(buf, sizeof buf) || f.gcount() > 0) {
        s.append(buf, static_cast<size_t>(f.gcount()));
        if (s.size() > maxBytes) return std::nullopt;
    }
    return s;
}

std::string systemHostname() {
    char name[256] = {0};  // HOST_NAME_MAX is 64 on Linux
    if (::gethostname(name, sizeof name - 1) != 0) return {};
    return name;
}

bool isValidSerialPortPattern(const std::string& s) {
    auto word = [](char c) {
        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
    };
    if (s.compare(0, 3, "tty") == 0) {
        size_t n = s.size() - 3;
        const bool star = n > 0 && s.back() == '*';
        if (star) --n;
        if (n < 1 || n > 16) return false;
        for (size_t i = 3; i < 3 + n; ++i)
            if (!word(s[i])) return false;
        return true;
    }
    for (const char* prefix : {"/dev/serial/by-id/", "/dev/serial/by-path/"}) {
        const std::string p = prefix;
        if (s.compare(0, p.size(), p) != 0) continue;
        const size_t n = s.size() - p.size();
        if (n < 1 || n > 200) return false;
        for (size_t i = p.size(); i < s.size(); ++i) {
            const char c = s[i];
            if (!(word(c) || c == '.' || c == '_' || c == ':' || c == '+' || c == '-'))
                return false;
        }
        return true;
    }
    return false;
}

namespace {

constexpr size_t kMaxNameBytes = 32;

// deviceName, deviceModel: 1–32 bytes of UTF-8 that print. No control character (C0, DEL, C1)
// and none of the marks that reorder a line unseen: the name shows in the Studio's device list
// and goes as it is into the JSON of discovery replies and of the device API.
bool isPrintableName(const std::string& s) {
    if (s.empty() || s.size() > kMaxNameBytes || !isValidUtf8(s)) return false;
    for (size_t i = 0; i < s.size(); ++i) {
        const auto c = static_cast<unsigned char>(s[i]);
        // Valid UTF-8: a lead byte C2 always has a continuation byte after it.
        const bool c1 = c == 0xC2 && static_cast<unsigned char>(s[i + 1]) < 0xA0;  // U+0080–9F
        size_t len = 0;
        if (c < 0x20 || c == 0x7f || c1 || layoutControlAt(s, i, len) != 0) return false;
    }
    return true;
}

// The host name, cut to 32 bytes on a character boundary; when it still is no valid name (empty,
// a control character), the model.
std::string defaultDeviceName(std::string host, const std::string& model) {
    if (host.size() > kMaxNameBytes) {
        size_t n = kMaxNameBytes;
        while (n > 0 && (static_cast<unsigned char>(host[n]) & 0xC0) == 0x80) --n;
        host.resize(n);
    }
    return isPrintableName(host) ? host : model;
}

// Feature 009 (data-model §11): the integer keys of the alarms and their ranges.
struct AlarmKey {
    const char* name;
    int RuntimeConfig::*member;
    int lo, hi;
};
const AlarmKey kAlarmKeys[] = {
    {"alarmRetentionDays", &RuntimeConfig::alarmRetentionDays, 1, 3650},
    {"alarmMaxBytes", &RuntimeConfig::alarmMaxBytes, 4 * 1024 * 1024, 1024 * 1024 * 1024},
    {"alarmCommitMs", &RuntimeConfig::alarmCommitMs, 200, 60000},
    {"alarmCommitMaxMs", &RuntimeConfig::alarmCommitMaxMs, 1000, 300000},
    {"alarmCommitRows", &RuntimeConfig::alarmCommitRows, 10, 5000},
    {"alarmBufferMax", &RuntimeConfig::alarmBufferMax, 500, 100000},
    {"alarmChatterWindowS", &RuntimeConfig::alarmChatterWindowS, 10, 600},
    {"alarmChatterShelveS", &RuntimeConfig::alarmChatterShelveS, 60, 86400},
    {"alarmMaxShelved", &RuntimeConfig::alarmMaxShelved, 1, 200},
    {"alarmPurgeIntervalS", &RuntimeConfig::alarmPurgeIntervalS, 60, 86400},
    {"alarmPurgeBatch", &RuntimeConfig::alarmPurgeBatch, 100, 5000},
};

int* alarmIntKey(RuntimeConfig& c, const std::string& k) {
    for (const AlarmKey& a : kAlarmKeys)
        if (k == a.name) return &(c.*a.member);
    return nullptr;
}

bool jsonIntIn(const json& v, int lo, int hi, int& out) {
    if (!v.is_number_integer()) return false;
    const int64_t x = v.get<int64_t>();
    if (v.is_number_unsigned() && v.get<uint64_t>() > static_cast<uint64_t>(INT64_MAX))
        return false;
    if (x < lo || x > hi) return false;
    out = static_cast<int>(x);
    return true;
}

// Feature 011 (contracts/device-api-011.md §6): a wrong type or a value out of range stops the
// runtime with the key named; an unknown key inside `update` or `logic` is skipped with a warning.
bool applyJson011(const std::string& k, const json& v, RuntimeConfig& c, std::string& err,
                  std::vector<std::string>& warnings) {
    auto intKey = [&](const std::string& name, const json& x, int lo, int hi, int& out) {
        if (jsonIntIn(x, lo, hi, out)) return true;
        err = "'" + name + "' phải là số nguyên " + std::to_string(lo) + "–" + std::to_string(hi);
        return false;
    };
    auto choice = [&](const std::string& name, const json& x, const char* a, const char* b,
                      std::string& out) {
        if (x.is_string() && (x.get<std::string>() == a || x.get<std::string>() == b)) {
            out = x.get<std::string>();
            return true;
        }
        err = "'" + name + "' phải là \"" + a + "\" hoặc \"" + b + "\"";
        return false;
    };
    if (k == "allowedHosts") {
        const char* msg = "'allowedHosts' phải là mảng tối đa 32 tên, mỗi tên 1–253 byte";
        if (!v.is_array() || v.size() > 32) {
            err = msg;
            return false;
        }
        std::vector<std::string> hosts;
        for (const json& h : v) {
            if (!h.is_string() || h.get<std::string>().empty() ||
                h.get<std::string>().size() > 253) {
                err = msg;
                return false;
            }
            hosts.push_back(h.get<std::string>());
        }
        c.allowedHosts = std::move(hosts);
        return true;
    }
    if (k == "hostCheck") return choice(k, v, "strict", "off", c.hostCheck);
    if (k == "maxConnPerSource") return intKey(k, v, 4, 64, c.maxConnPerSource);
    if (k == "maxLiveClientsPerSource") return intKey(k, v, 1, 10, c.maxLiveClientsPerSource);
    if (k == "maxConcurrentLogins") return intKey(k, v, 1, 4, c.maxConcurrentLogins);
    if (k == "pulseRecovery") return choice(k, v, "on", "off", c.pulseRecovery);
    if (k == "tzOffsetMin") return intKey(k, v, -720, 840, c.tzOffsetMin);
    if (!v.is_object()) {
        err = "'" + k + "' phải là JSON object";
        return false;
    }
    for (auto it = v.begin(); it != v.end(); ++it) {
        const std::string name = k + "." + it.key();
        const json& x = it.value();
        bool ok = true;
        if (k == "update" && it.key() == "enabled") {
            if (!x.is_boolean()) {
                err = "'" + name + "' phải là true/false";
                return false;
            }
            c.updateEnabled = x.get<bool>();
        } else if (k == "update" && it.key() == "maxPackageMiB") {
            ok = intKey(name, x, 8, 256, c.updateMaxPackageMiB);
        } else if (k == "update" && it.key() == "trustedKeysDir") {
            if (!x.is_string() || x.get<std::string>().empty()) {
                err = "'" + name + "' phải là đường dẫn (chuỗi khác rỗng)";
                return false;
            }
            c.updateTrustedKeysDir = x.get<std::string>();
        } else if (k == "logic" && it.key() == "writes") {
            ok = choice(name, x, "off", "on", c.logicWrites);
        } else if (k == "logic" && it.key() == "maxWritesPerMin") {
            ok = intKey(name, x, 1, 60, c.logicMaxWritesPerMin);
        } else if (k == "logic" && it.key() == "flushS") {
            ok = intKey(name, x, 10, 600, c.logicFlushS);
        } else if (k == "logic" && it.key() == "scanMs") {
            ok = intKey(name, x, 50, 1000, c.logicScanMs);
        } else {
            warnings.push_back("bỏ qua khóa không hỗ trợ: '" + name + "'");
        }
        if (!ok) return false;
    }
    return true;
}

bool applyJson(const json& j, RuntimeConfig& c, std::string& err,
               std::vector<std::string>& warnings) {
    if (!j.is_object()) {
        err = "config phải là JSON object";
        return false;
    }
    for (auto it = j.begin(); it != j.end(); ++it) {
        const std::string& k = it.key();
        const json& v = it.value();
        // Within int as well: get<int>() of 2^32 + 8443 would quietly give 8443.
        auto needInt = [&]() {
            const bool fits = v.is_number_unsigned()
                                  ? v.get<uint64_t>() <= static_cast<uint64_t>(INT_MAX)
                                  : v.is_number_integer() && v.get<int64_t>() >= INT_MIN &&
                                        v.get<int64_t>() <= INT_MAX;
            if (!fits) err = "'" + k + "' phải là số nguyên";
            return err.empty();
        };
        auto needBool = [&]() {
            if (!v.is_boolean()) err = "'" + k + "' phải là true/false";
            return err.empty();
        };
        auto needStr = [&]() {
            if (!v.is_string()) err = "'" + k + "' phải là chuỗi";
            return err.empty();
        };
        auto needPath = [&]() {
            if (!v.is_string() || v.get<std::string>().empty())
                err = "'" + k + "' phải là đường dẫn (chuỗi khác rỗng)";
            return err.empty();
        };
        if (k == "port") {
            if (!needInt()) return false;
            c.port = v.get<int>();
        } else if (k == "docroot") {
            if (!needStr()) return false;
            c.docroot = v.get<std::string>();
        } else if (k == "projectDir") {
            if (!needStr()) return false;
            c.projectDir = v.get<std::string>();
        } else if (k == "schemasDir") {
            if (!needStr()) return false;
            c.schemasDir = v.get<std::string>();
        } else if (k == "maxClients") {
            if (!needInt()) return false;
            c.maxClients = v.get<int>();
        } else if (k == "allowedOrigins") {
            if (!v.is_array()) {
                err = "'allowedOrigins' phải là mảng chuỗi";
                return false;
            }
            c.allowedOrigins.clear();
            for (auto& o : v) {
                if (!o.is_string()) {
                    err = "'allowedOrigins' phải là mảng chuỗi";
                    return false;
                }
                c.allowedOrigins.push_back(o.get<std::string>());
            }
        } else if (k == "deltaPeriodMs") {
            if (!needInt()) return false;
            c.deltaPeriodMs = v.get<int>();
        } else if (k == "simLoad") {
            if (!v.is_boolean()) {
                err = "'simLoad' phải là true/false";
                return false;
            }
            c.simLoad = v.get<bool>();
        } else if (k == "sendQueueBytes") {
            if (!needInt()) return false;
            c.sendQueueBytes = v.get<size_t>();
        } else if (k == "heartbeatTimeoutMs") {
            if (!needInt()) return false;
            c.heartbeatTimeoutMs = v.get<int>();
        } else if (k == "threads") {
            if (!needInt()) return false;
            c.threads = v.get<int>();
        } else if (k == "dataDir") {
            if (!needPath()) return false;
            c.dataDir = v.get<std::string>();
        } else if (k == "secretsFile") {
            if (!needPath()) return false;
            c.secretsFile = v.get<std::string>();
        } else if (k == "clientLibDir") {
            if (!needPath()) return false;
            c.clientLibDir = v.get<std::string>();
        } else if (k == "historianMaxDbMB") {
            if (!needInt()) return false;
            c.historianMaxDbMB = v.get<int>();
        } else if (k == "historianMinFreeMB") {
            if (!needInt()) return false;
            c.historianMinFreeMB = v.get<int>();
        } else if (k == "historianCommitMs") {
            if (!needInt()) return false;
            c.historianCommitMs = v.get<int>();
        } else if (k == "httpsPort") {  // feature 005 (contracts/device-config.md §1)
            if (!needInt()) return false;
            c.httpsPort = v.get<int>();
        } else if (k == "httpsThreads") {
            if (!needInt()) return false;
            c.httpsThreads = v.get<int>();
        } else if (k == "discoveryEnabled") {
            if (!needBool()) return false;
            c.discoveryEnabled = v.get<bool>();
        } else if (k == "discoveryPort") {
            if (!needInt()) return false;
            c.discoveryPort = v.get<int>();
        } else if (k == "deviceName") {
            // Checked here: an empty name must not pass for "not configured" (host name).
            if (!v.is_string() || !isPrintableName(v.get<std::string>())) {
                err = "'deviceName' phải là 1–32 byte UTF-8 in được";
                return false;
            }
            c.deviceName = v.get<std::string>();
        } else if (k == "deviceModel") {
            if (!needStr()) return false;
            c.deviceModel = v.get<std::string>();
        } else if (k == "projectStoreDir") {
            if (!needPath()) return false;
            c.projectStoreDir = v.get<std::string>();
        } else if (k == "projectBackups") {
            if (!needInt()) return false;
            c.projectBackups = v.get<int>();
        } else if (k == "usersFile") {
            if (!needPath()) return false;
            c.usersFile = v.get<std::string>();
        } else if (k == "authDir") {  // feature 013: users.json and access.json of the device
            if (!needPath()) return false;
            c.authDir = v.get<std::string>();
        } else if (k == "auditRetentionDays") {
            if (!needInt()) return false;
            c.auditRetentionDays = v.get<int>();
        } else if (k == "auditMaxMB") {
            if (!needInt()) return false;
            c.auditMaxMB = v.get<int>();
        } else if (k == "serialPorts") {  // feature 006 (contracts/device-config.md §1)
            if (!v.is_array()) {
                err = "'serialPorts' phải là mảng chuỗi";
                return false;
            }
            c.serialPorts.clear();
            for (auto& o : v) {
                if (!o.is_string() || !isValidSerialPortPattern(o.get<std::string>())) {
                    err =
                        "'serialPorts': mục phải là tên tty (có thể kết thúc bằng *) hoặc đường "
                        "dẫn "
                        "/dev/serial/by-id/… hay by-path/…";
                    return false;
                }
                c.serialPorts.push_back(o.get<std::string>());
            }
        } else if (k == "viewerAccess") {
            if (!v.is_string() ||
                (v.get<std::string>() != "private" && v.get<std::string>() != "any" &&
                 v.get<std::string>() != "off")) {
                err = "'viewerAccess' phải là private, any hoặc off";
                return false;
            }
            c.viewerAccess = v.get<std::string>();
        } else if (k == "viewerLogin") {
            if (!v.is_string() ||
                (v.get<std::string>() != "off" && v.get<std::string>() != "required")) {
                err = "'viewerLogin' phải là off hoặc required";
                return false;
            }
            c.viewerLogin = v.get<std::string>();
        } else if (k == "webSessionIdleMin") {
            if (!needInt()) return false;
            c.webSessionIdleMin = v.get<int>();
        } else if (k == "webMaxSessions") {
            if (!needInt()) return false;
            c.webMaxSessions = v.get<int>();
        } else if (k == "webSessionMaxHours") {
            if (!needInt()) return false;
            c.webSessionMaxHours = v.get<int>();
        } else if (k == "historyApi") {
            if (!v.is_boolean()) {
                err = "'historyApi' phải là true hoặc false";
                return false;
            }
            c.historyApi = v.get<bool>();
        } else if (k == "historyMaxConcurrent") {
            if (!needInt()) return false;
            c.historyMaxConcurrent = v.get<int>();
        } else if (k == "historyQueryTimeoutMs") {
            if (!needInt()) return false;
            c.historyQueryTimeoutMs = v.get<int>();
        } else if (k == "historyMaxScanMiB") {
            if (!needInt()) return false;
            c.historyMaxScanMiB = v.get<int>();
        } else if (k == "historyReaderCacheKiB") {
            if (!needInt()) return false;
            c.historyReaderCacheKiB = v.get<int>();
        } else if (k == "retainWindowS") {
            if (!needInt()) return false;
            c.retainWindowS = v.get<int>();
        } else if (k == "retainDir") {
            if (!needPath()) return false;
            c.retainDir = v.get<std::string>();
        } else if (k == "tagWriteSessionBurst") {
            if (!needInt()) return false;
            c.tagWriteSessionBurst = v.get<int>();
        } else if (k == "tagWriteSessionPerMin") {
            if (!needInt()) return false;
            c.tagWriteSessionPerMin = v.get<int>();
        } else if (k == "tagWriteGlobalBurst") {
            if (!needInt()) return false;
            c.tagWriteGlobalBurst = v.get<int>();
        } else if (k == "tagWriteGlobalPerMin") {
            if (!needInt()) return false;
            c.tagWriteGlobalPerMin = v.get<int>();
        } else if (k == "tagWriteQueuePerChannel") {
            if (!needInt()) return false;
            c.tagWriteQueuePerChannel = v.get<int>();
        } else if (k == "tagWriteQueueTotal") {
            if (!needInt()) return false;
            c.tagWriteQueueTotal = v.get<int>();
        } else if (k.rfind("alarm", 0) == 0 && alarmIntKey(c, k) != nullptr) {  // feature 009
            if (!needInt()) return false;
            *alarmIntKey(c, k) = v.get<int>();
        } else if (k == "allowedHosts" || k == "hostCheck" || k == "maxConnPerSource" ||
                   k == "maxLiveClientsPerSource" || k == "maxConcurrentLogins" ||
                   k == "pulseRecovery" || k == "update" || k == "logic" ||
                   k == "tzOffsetMin") {  // feature 011
            if (!applyJson011(k, v, c, err, warnings)) return false;
        } else {
            // Feature 011 (contracts/device-api-011.md §6): skipped with a warning, so a file
            // written for a newer runtime still starts; every key defaults to its safe value.
            warnings.push_back("bỏ qua khóa không hỗ trợ: '" + k + "'");
        }
    }
    return true;
}

bool parseIntArg(const char* s, int& out) {
    try {
        size_t used = 0;
        int v = std::stoi(s, &used);
        if (s[used] != '\0') return false;
        out = v;
        return true;
    } catch (...) {
        return false;
    }
}

}  // namespace

std::string deviceSettingsPath(const std::string& dataDir) {
    return dataDir + (!dataDir.empty() && dataDir.back() == '/' ? "" : "/") + kDeviceSettingsFile;
}

const std::vector<std::string>& deviceSettingKeys() {
    static const std::vector<std::string> keys{"viewerLogin",   "viewerAccess",
                                               "allowedHosts",  "maxLiveClientsPerSource",
                                               "updateEnabled", "deviceName"};
    return keys;
}

bool applyDeviceSettings(const json& values, RuntimeConfig& cfg, std::string& err) {
    if (!values.is_object()) {
        err = "settings phải là JSON object";
        return false;
    }
    const auto& keys = deviceSettingKeys();
    json mapped = json::object();
    for (auto it = values.begin(); it != values.end(); ++it) {
        if (std::find(keys.begin(), keys.end(), it.key()) == keys.end()) {
            err = "khóa '" + it.key() + "' không đổi được từ Studio (chỉ runtime.json)";
            return false;
        }
        if (it.key() == "updateEnabled")
            mapped["update"] = {{"enabled", it.value()}};
        else
            mapped[it.key()] = it.value();
    }
    std::vector<std::string> warnings;
    return applyJson(mapped, cfg, err, warnings);
}

json deviceSettingsOf(const RuntimeConfig& c) {
    return {
        {"viewerLogin", c.viewerLogin},     {"viewerAccess", c.viewerAccess},
        {"allowedHosts", c.allowedHosts},   {"maxLiveClientsPerSource", c.maxLiveClientsPerSource},
        {"updateEnabled", c.updateEnabled}, {"deviceName", c.deviceName}};
}

namespace {

// settings.json, else its .bak: {"rev": n >= 1, "values": {...}}. What cannot be used is left out
// with a warning (the runtime starts with runtime.json alone).
void applySettingsFile(const FileReader& readFile, RuntimeConfig& c, ConfigResult& r) {
    if (c.dataDir.empty()) return;
    const std::string path = deviceSettingsPath(c.dataDir);
    for (const std::string& p : {path, path + ".bak"}) {
        const auto text = readFile(p);
        if (!text) continue;
        const json j = json::parse(*text, nullptr, false);
        std::string err;
        RuntimeConfig next = c;
        if (j.is_discarded() || !j.is_object())
            err = "JSON không hợp lệ";
        else if (!j.contains("rev") || !j["rev"].is_number_integer() || j["rev"].get<int64_t>() < 1)
            err = "thiếu rev";
        else if (!j.contains("values"))
            err = "thiếu values";
        else
            applyDeviceSettings(j["values"], next, err);
        if (err.empty()) {
            c = next;
            r.settingsRev = j["rev"].get<int64_t>();
            r.settings = j["values"];
            if (p != path) r.warnings.push_back(path + " hỏng: dùng bản trước " + p);
            return;
        }
        r.warnings.push_back(p + ": " + err + "; bỏ qua (xóa tệp để dùng runtime.json)");
    }
}

}  // namespace

ConfigResult loadConfig(int argc, char** argv, const FileReader& readFile,
                        const HostnameFn& hostname) {
    ConfigResult r;
    RuntimeConfig& c = r.cfg;
    bool explicitConfig = false;
    for (int i = 1; i < argc; ++i)
        if (std::string(argv[i]) == "--config" && i + 1 < argc) {
            c.configPath = argv[i + 1];
            explicitConfig = true;
        }

    if (auto text = readFile(c.configPath)) {
        json j = json::parse(*text, nullptr, false);
        if (j.is_discarded()) {
            r.error = c.configPath + ": JSON không hợp lệ";
            return r;
        }
        if (!applyJson(j, c, r.error, r.warnings)) {
            r.error = c.configPath + ": " + r.error;
            return r;
        }
    } else if (explicitConfig) {
        r.error = "không đọc được file config: " + c.configPath;
        return r;
    }

    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        auto next = [&]() -> const char* { return i + 1 < argc ? argv[++i] : nullptr; };
        auto intArg = [&](int& dst) {
            const char* v = next();
            if (!v || !parseIntArg(v, dst)) {
                r.error = a + " cần một số nguyên";
                return false;
            }
            return true;
        };
        auto strArg = [&](std::string& dst) {
            const char* v = next();
            if (!v) {
                r.error = a + " cần một giá trị";
                return false;
            }
            dst = v;
            return true;
        };
        auto pathArg = [&](std::string& dst) {
            const char* v = next();
            if (!v || *v == '\0') {
                r.error = a + " cần một đường dẫn";
                return false;
            }
            dst = v;
            return true;
        };
        bool ok = true;
        if (a == "--config") {
            ++i;
        } else if (a == "--port") {
            ok = intArg(c.port);
        } else if (a == "--docroot") {
            ok = strArg(c.docroot);
        } else if (a == "--project-dir") {
            ok = strArg(c.projectDir);
        } else if (a == "--schemas-dir") {
            ok = strArg(c.schemasDir);
        } else if (a == "--max-clients") {
            ok = intArg(c.maxClients);
        } else if (a == "--max-live-clients-per-source") {  // M1 of the review of 011
            ok = intArg(c.maxLiveClientsPerSource);
            if (ok && (c.maxLiveClientsPerSource < 1 || c.maxLiveClientsPerSource > 10)) {
                r.error = "--max-live-clients-per-source phải trong 1–10";
                return r;
            }
        } else if (a == "--delta-period-ms") {
            ok = intArg(c.deltaPeriodMs);
        } else if (a == "--threads") {
            ok = intArg(c.threads);
        } else if (a == "--sim-load") {
            c.simLoad = true;
        } else if (a == "--no-sim-load") {
            c.simLoad = false;
        } else if (a == "--check-project") {
            c.checkProject = true;
        } else if (a == "--data-dir") {
            ok = strArg(c.dataDir);
        } else if (a == "--secrets-file") {
            ok = strArg(c.secretsFile);
        } else if (a == "--https-port") {
            ok = intArg(c.httpsPort);
        } else if (a == "--project-store-dir") {
            ok = pathArg(c.projectStoreDir);
        } else if (a == "--users-file") {
            ok = pathArg(c.usersFile);
        } else if (a == "--auth-dir") {
            ok = pathArg(c.authDir);
        } else if (a == "--no-discovery") {
            c.discoveryEnabled = false;
        } else if (a == "--serial-ports") {  // feature 006: comma separated patterns
            std::string list;
            ok = strArg(list);
            if (ok) {
                c.serialPorts.clear();
                size_t start = 0;
                while (start <= list.size()) {
                    size_t end = list.find(',', start);
                    if (end == std::string::npos) end = list.size();
                    const std::string item = list.substr(start, end - start);
                    if (!isValidSerialPortPattern(item)) {
                        r.error = "--serial-ports: mục không hợp lệ: '" + item + "'";
                        return r;
                    }
                    c.serialPorts.push_back(item);
                    start = end + 1;
                }
            }
        } else if (a == "--viewer-access") {
            ok = strArg(c.viewerAccess);
            if (ok && c.viewerAccess != "private" && c.viewerAccess != "any" &&
                c.viewerAccess != "off") {
                r.error = "--viewer-access nhận private, any hoặc off";
                return r;
            }
        } else if (a == "--viewer-login") {
            ok = strArg(c.viewerLogin);
            if (ok && c.viewerLogin != "off" && c.viewerLogin != "required") {
                r.error = "--viewer-login nhận off hoặc required";
                return r;
            }
        } else if (a == "--retain-dir") {
            ok = pathArg(c.retainDir);
#ifdef MAT_TEST_HOOKS
        } else if (a == "--test-kill-at") {
            ok = strArg(c.testKillAtStep);
        } else if (a == "--test-health") {
            ok = strArg(c.testHealth);
            if (ok && c.testHealth != "die" && c.testHealth != "hang") {
                r.error = "--test-health nhận die hoặc hang";
                return r;
            }
        } else if (a == "--test-persist-delay-ms") {
            ok = intArg(c.testPersistDelayMs);
        } else if (a == "--test-persist-fail") {
            c.testPersistFail = true;
#endif
        } else {
            r.error = "tham số không hỗ trợ: " + a;
            return r;
        }
        if (!ok) return r;
    }

    // Feature 027 (FR-002): settings.json over runtime.json and the command line; a damaged file
    // (then its .bak) is skipped with a warning, never an error.
    const RuntimeConfig beforeSettings = c;
    applySettingsFile(readFile, c, r);

    if (c.port < 1024 || c.port > 65535) {
        r.error = "port phải trong 1024–65535 (chạy bằng user không đặc quyền)";
        return r;
    }
    if (c.maxClients < 1) {
        r.error = "maxClients phải trong 1–10";
        return r;
    }
    if (c.maxClients > static_cast<int>(SessionManager::kHardLimit)) {
        r.warnings.push_back("maxClients " + std::to_string(c.maxClients) +
                             " > 10: dùng giới hạn cứng 10");
        c.maxClients = static_cast<int>(SessionManager::kHardLimit);
    }
    if (c.deltaPeriodMs < 100 || c.deltaPeriodMs > 250) {
        r.error = "deltaPeriodMs phải trong 100–250";
        return r;
    }
    if (c.sendQueueBytes < 16384 || c.sendQueueBytes > 262144) {
        r.error = "sendQueueBytes phải trong 16384–262144";
        return r;
    }
    if (c.heartbeatTimeoutMs < 5000) {
        r.error = "heartbeatTimeoutMs phải ≥ 5000";
        return r;
    }
    if (c.historianMaxDbMB < 64 || c.historianMaxDbMB > 65536) {
        r.error = "historianMaxDbMB phải trong 64–65536";
        return r;
    }
    if (c.historianMinFreeMB < 50 || c.historianMinFreeMB > 65536) {
        r.error = "historianMinFreeMB phải trong 50–65536";
        return r;
    }
    if (c.historianCommitMs < 1000 || c.historianCommitMs > 60000) {
        r.error = "historianCommitMs phải trong 1000–60000";
        return r;
    }
    // Feature 005 (contracts/device-config.md §1).
    if (c.httpsPort != 0 && (c.httpsPort < 1024 || c.httpsPort > 65535)) {
        r.error = "httpsPort phải là 0 (tắt HTTPS) hoặc trong 1024–65535";
        return r;
    }
    if (c.httpsPort == c.port) {
        r.error = "httpsPort phải khác port";
        return r;
    }
    const struct {
        int value, lo, hi;
        const char* key;
    } ranges[] = {{c.httpsThreads, 4, 64, "httpsThreads"},
                  {c.discoveryPort, 1024, 65535, "discoveryPort"},
                  {c.projectBackups, 1, 10, "projectBackups"},
                  {c.auditRetentionDays, 30, 3650, "auditRetentionDays"},
                  {c.auditMaxMB, 8, 1024, "auditMaxMB"},
                  {c.retainWindowS, 1, 60, "retainWindowS"},
                  {c.tagWriteSessionBurst, 1, 10, "tagWriteSessionBurst"},
                  {c.tagWriteSessionPerMin, 1, 20, "tagWriteSessionPerMin"},
                  {c.tagWriteGlobalBurst, 1, 20, "tagWriteGlobalBurst"},
                  {c.tagWriteGlobalPerMin, 1, 30, "tagWriteGlobalPerMin"},
                  {c.tagWriteQueuePerChannel, 1, 64, "tagWriteQueuePerChannel"},
                  {c.tagWriteQueueTotal, 1, 256, "tagWriteQueueTotal"},
                  {c.webSessionIdleMin, 5, 480, "webSessionIdleMin"},
                  {c.webMaxSessions, 1, 16, "webMaxSessions"},
                  {c.webSessionMaxHours, 1, 24, "webSessionMaxHours"},
                  {c.historyMaxConcurrent, 1, 4, "historyMaxConcurrent"},
                  {c.historyQueryTimeoutMs, 1000, 30000, "historyQueryTimeoutMs"},
                  {c.historyMaxScanMiB, 8, 256, "historyMaxScanMiB"},
                  {c.historyReaderCacheKiB, 1024, 8192, "historyReaderCacheKiB"}};
    for (const auto& x : ranges)
        if (x.value < x.lo || x.value > x.hi) {
            r.error = std::string(x.key) + " phải trong " + std::to_string(x.lo) + "–" +
                      std::to_string(x.hi);
            return r;
        }
    // Feature 011 (FR-025): one source holds at most 75 % of the HTTPS workers. The key keeps what
    // was set (4-64, contract §6); the runtime applies the lower value and says so here.
    if (const int applied = effectiveMaxConnPerSource(c.maxConnPerSource, c.httpsThreads);
        applied != c.maxConnPerSource)
        r.warnings.push_back("maxConnPerSource " + std::to_string(c.maxConnPerSource) +
                             " vượt 75 % của httpsThreads " + std::to_string(c.httpsThreads) +
                             ": dùng " + std::to_string(applied));
    // Feature 009: out of range is clamped with a warning (data-model §11).
    for (const AlarmKey& a : kAlarmKeys) {
        int& v = c.*a.member;
        const int clamped = std::min(std::max(v, a.lo), a.hi);
        if (clamped != v) {
            r.warnings.push_back(std::string(a.name) + " " + std::to_string(v) + " ngoài " +
                                 std::to_string(a.lo) + "–" + std::to_string(a.hi) + ": dùng " +
                                 std::to_string(clamped));
            v = clamped;
        }
    }
    if (c.alarmCommitMaxMs < c.alarmCommitMs) {
        r.warnings.push_back("alarmCommitMaxMs nhỏ hơn alarmCommitMs: dùng " +
                             std::to_string(c.alarmCommitMs));
        c.alarmCommitMaxMs = c.alarmCommitMs;
    }
    if (!isPrintableName(c.deviceModel)) {
        r.error = "deviceModel phải là 1–32 byte UTF-8 in được";
        return r;
    }
    if (c.dataDir.empty()) {  // --data-dir "" (the file already refuses it)
        r.error = "dataDir phải là đường dẫn (chuỗi khác rỗng)";
        return r;
    }
    if (c.deviceName.empty())
        c.deviceName = defaultDeviceName(hostname ? hostname() : systemHostname(), c.deviceModel);
    r.base = beforeSettings;
    if (r.base.deviceName.empty())
        r.base.deviceName =
            defaultDeviceName(hostname ? hostname() : systemHostname(), r.base.deviceModel);
    if (c.projectStoreDir.empty())
        c.projectStoreDir = c.dataDir + (c.dataDir.back() == '/' ? "projects" : "/projects");
    if (c.retainDir.empty())
        c.retainDir = c.dataDir + (c.dataDir.back() == '/' ? "retain" : "/retain");
    if (c.authDir.empty())  // feature 013
        c.authDir = c.dataDir + (c.dataDir.back() == '/' ? "auth" : "/auth");
    if (c.threads < c.maxClients + 4) {
        r.warnings.push_back("threads " + std::to_string(c.threads) + " quá nhỏ: dùng " +
                             std::to_string(c.maxClients + 4));
        c.threads = c.maxClients + 4;
    }
    r.ok = true;
    return r;
}

}  // namespace mat
