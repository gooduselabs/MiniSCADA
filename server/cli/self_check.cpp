#include "server/cli/self_check.hpp"

#include <sys/stat.h>

#include <cstring>
#include <fstream>
#include <ostream>
#include <sstream>
#include <vector>

#include "core/project-manager/project_validator.hpp"
#include "core/project-store/store.hpp"
#include "nlohmann/json.hpp"
#include "server/cli/check_data.hpp"

namespace mat {

namespace {

bool isDirectory(const std::string& p) {
    struct stat st {};
    return ::stat(p.c_str(), &st) == 0 && S_ISDIR(st.st_mode);
}

std::string readSmall(const std::string& p) {
    std::ifstream in(p, std::ios::binary);
    std::ostringstream s;
    if (in) s << in.rdbuf();
    return s.str().substr(0, kStoreJsonMaxBytes);
}

}  // namespace

bool isSelfCheckCommand(int argc, char** argv) {
    for (int i = 1; i < argc; ++i)
        if (std::strcmp(argv[i], "--self-check") == 0) return true;
    return false;
}

std::string runningProjectDir(const RuntimeConfig& cfg) {
    const std::string store =
        cfg.projectStoreDir.empty() ? cfg.dataDir + "/projects" : cfg.projectStoreDir;
    const std::string text = readSmall(store + "/" + kStoreStateFile);
    if (!text.empty()) {
        std::string why;
        if (const auto state = parseStoreState(text, why); state && state->active) {
            const std::string dir =
                store + "/v/" + std::to_string(*state->active) + "/" + kStoreProjectDir;
            if (isDirectory(dir)) return dir;
        }
    }
    return isDirectory(cfg.projectDir) ? cfg.projectDir : std::string();
}

int runSelfCheckCli(int argc, char** argv, const DeviceCliEnv& env, const std::string& schemasDir,
                    std::ostream& out, std::ostream& err) {
    std::vector<std::string> overrides;
    bool asJson = false;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--self-check") continue;
        if (a == "--json") {
            asJson = true;
        } else if (a == "--config" || a == "--data-dir") {
            if (i + 1 >= argc || *argv[i + 1] == '\0') {
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
    nlohmann::json checks = nlohmann::json::array();
    auto add = [&](const std::string& name, const std::string& status, const std::string& detail) {
        checks.push_back({{"name", name}, {"status", status}, {"detail", detail}});
    };
    RuntimeConfig cfg;
    std::string error;
    if (!loadDeviceCliConfig(overrides, env, cfg, error)) {
        err << "cấu hình: " << error << "\n";
        return 2;
    }
    add("config", "ok", "");
    bool refused = false;

    // the data, read only (no file made, nothing renamed)
    CheckDataOptions co;
    co.dataDir = cfg.dataDir;
    co.projectStoreDir = cfg.projectStoreDir;
    co.budgetMs = 20000;
    const CheckDataResult data = checkData(co);
    std::string damaged;
    for (const CheckItem& c : data.checks)
        if (c.status == "damaged")
            damaged += (damaged.empty() ? "" : ", ") + c.name + ": " + c.detail;
    if (!damaged.empty()) {
        add("data", "failed", damaged);
        refused = true;
    } else {
        add("data", data.exitCode == 0 ? "ok" : "warning", "");
    }

    // the running project with this binary's validator and schemas
    const std::string dir = runningProjectDir(cfg);
    if (dir.empty()) {
        add("project-valid", "missing", "không có project đang chạy");
    } else {
        const ProjectValidation v = validateProject(dir, schemasDir);
        if (v.valid) {
            add("project-valid", "ok", dir);
        } else {
            std::string why;
            for (size_t i = 0; i < v.errors.size() && i < 3; ++i)
                why += (i ? "; " : "") + v.errors[i].code + " " + v.errors[i].message;
            add("project-valid", "failed", why);
            refused = true;
        }
    }
    if (asJson) {
        out << nlohmann::json{{"schema", "mat-self-check/1"},
                              {"result", refused ? "refused" : "ok"},
                              {"checks", checks}}
                   .dump()
            << "\n";
    } else {
        for (const auto& c : checks)
            out << c["name"].get<std::string>() << "\t" << c["status"].get<std::string>() << "\t"
                << c["detail"].get<std::string>() << "\n";
        out << (refused ? "self-check: TỪ CHỐI\n" : "self-check: đạt\n");
    }
    return refused ? 1 : 0;
}

}  // namespace mat
