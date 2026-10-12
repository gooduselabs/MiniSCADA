#include "server/config.hpp"

#include <unistd.h>

#include <climits>
#include <cstdint>
#include <fstream>
#include <sstream>

#include "core/common/utf8.hpp"
#include "core/session-manager/session_manager.hpp"
#include "nlohmann/json.hpp"

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

bool applyJson(const json& j, RuntimeConfig& c, std::string& err) {
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
        } else if (k == "auditRetentionDays") {
            if (!needInt()) return false;
            c.auditRetentionDays = v.get<int>();
        } else if (k == "auditMaxMB") {
            if (!needInt()) return false;
            c.auditMaxMB = v.get<int>();
        } else {
            err = "khóa không hỗ trợ: '" + k + "'";
            return false;
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
        if (!applyJson(j, c, r.error)) {
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
        } else if (a == "--no-discovery") {
            c.discoveryEnabled = false;
        } else {
            r.error = "tham số không hỗ trợ: " + a;
            return r;
        }
        if (!ok) return r;
    }

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
    } ranges[] = {{c.httpsThreads, 4, 32, "httpsThreads"},
                  {c.discoveryPort, 1024, 65535, "discoveryPort"},
                  {c.projectBackups, 1, 10, "projectBackups"},
                  {c.auditRetentionDays, 30, 3650, "auditRetentionDays"},
                  {c.auditMaxMB, 8, 1024, "auditMaxMB"}};
    for (const auto& x : ranges)
        if (x.value < x.lo || x.value > x.hi) {
            r.error = std::string(x.key) + " phải trong " + std::to_string(x.lo) + "–" +
                      std::to_string(x.hi);
            return r;
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
    if (c.projectStoreDir.empty())
        c.projectStoreDir = c.dataDir + (c.dataDir.back() == '/' ? "projects" : "/projects");
    if (c.threads < c.maxClients + 4) {
        r.warnings.push_back("threads " + std::to_string(c.threads) + " quá nhỏ: dùng " +
                             std::to_string(c.maxClients + 4));
        c.threads = c.maxClients + 4;
    }
    r.ok = true;
    return r;
}

}  // namespace mat
