#include "server/config.hpp"

#include <fstream>
#include <sstream>

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

namespace {

bool applyJson(const json& j, RuntimeConfig& c, std::string& err) {
    if (!j.is_object()) {
        err = "config phải là JSON object";
        return false;
    }
    for (auto it = j.begin(); it != j.end(); ++it) {
        const std::string& k = it.key();
        const json& v = it.value();
        auto needInt = [&]() {
            if (!v.is_number_integer()) err = "'" + k + "' phải là số nguyên";
            return err.empty();
        };
        auto needStr = [&]() {
            if (!v.is_string()) err = "'" + k + "' phải là chuỗi";
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

ConfigResult loadConfig(int argc, char** argv, const FileReader& readFile) {
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
    if (c.threads < c.maxClients + 4) {
        r.warnings.push_back("threads " + std::to_string(c.threads) + " quá nhỏ: dùng " +
                             std::to_string(c.maxClients + 4));
        c.threads = c.maxClients + 4;
    }
    r.ok = true;
    return r;
}

}  // namespace mat
