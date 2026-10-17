#include "server/cli/update_status.hpp"

#include <sys/stat.h>

#include <cstring>
#include <fstream>
#include <ostream>
#include <sstream>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"

namespace mat {

bool isUpdateStatusCommand(int argc, char** argv) {
    for (int i = 1; i < argc; ++i)
        if (std::strcmp(argv[i], "--update-status") == 0) return true;
    return false;
}

int runUpdateStatusCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
                       std::ostream& err) {
    std::vector<std::string> overrides;
    bool asJson = false;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--update-status") continue;
        if (a == "--json") {
            asJson = true;
        } else if (a == "--config" || a == "--data-dir") {
            if (i + 1 >= argc) {
                err << a << " cần một giá trị\n";
                return 2;
            }
            overrides.push_back(a);
            overrides.push_back(argv[++i]);
        } else {
            err << "tham số không hỗ trợ: " << a << "\n";
            return 2;
        }
    }
    RuntimeConfig cfg;
    std::string error;
    if (!loadDeviceCliConfig(overrides, env, cfg, error)) {
        err << "cấu hình: " << error << "\n";
        return 2;
    }
    const std::string dir = cfg.dataDir + "/update";
    std::ifstream in(dir + "/last.json", std::ios::binary);
    std::ostringstream s;
    if (in) s << in.rdbuf();
    const nlohmann::json last = nlohmann::json::parse(s.str(), nullptr, false);
    struct stat st {};
    const bool pending = ::stat((dir + "/request.json").c_str(), &st) == 0;
    if (asJson) {
        out << nlohmann::json{{"last", last.is_object() ? last : nlohmann::json(nullptr)},
                              {"requestPending", pending}}
                   .dump()
            << "\n";
        return 0;
    }
    if (!last.is_object()) {
        out << "chưa có cập nhật qua mạng nào (" << dir << "/last.json)\n";
    } else {
        for (const char* k :
             {"updateId", "op", "result", "from", "to", "finishedAt", "code", "reason"})
            if (last.contains(k) && last[k].is_string() && !last[k].get<std::string>().empty())
                out << k << ": " << last[k].get<std::string>() << "\n";
        if (last.contains("audited"))
            out << "audited: " << (last.value("audited", false) ? "có" : "chưa") << "\n";
    }
    if (pending) out << "có yêu cầu đang chờ mat-updater (request.json)\n";
    return 0;
}

}  // namespace mat
