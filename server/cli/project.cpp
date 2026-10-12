#include "server/cli/project.hpp"

#include <sys/stat.h>

#include <cstdio>
#include <cstring>
#include <vector>

#include "core/project-manager/project_validator.hpp"
#include "core/project-store/store.hpp"
#include "nlohmann/json.hpp"
#include "server/config.hpp"

namespace mat {

namespace {

bool hasFlag(int argc, char** argv, const char* name) {
    for (int i = 1; i < argc; ++i)
        if (std::strcmp(argv[i], name) == 0) return true;
    return false;
}

bool fileExists(const std::string& path) {
    struct stat st {};
    return ::stat(path.c_str(), &st) == 0;
}

// Text from the state of a device, as the terminal shows it: ASCII control characters and C1
// controls (UTF-8 C2 80–9F) become '?', so a crafted account name cannot drive the terminal.
std::string shown(const std::string& s) {
    std::string out;
    for (size_t i = 0; i < s.size(); ++i) {
        const auto c = static_cast<unsigned char>(s[i]);
        if (c < 0x20 || c == 0x7f) {
            out += '?';
        } else if (c == 0xc2 && i + 1 < s.size() && static_cast<unsigned char>(s[i + 1]) >= 0x80 &&
                   static_cast<unsigned char>(s[i + 1]) < 0xa0) {
            out += '?';
            ++i;
        } else {
            out += static_cast<char>(c);
        }
    }
    return out;
}

enum class StateRead { Ok, Missing, Unreadable };

// state.json of the store, read only (no directory is created, nothing is locked).
StateRead readState(const std::string& dir, StoreState& state, std::string& error) {
    const std::string path = dir + "/" + kStoreStateFile;
    if (!fileExists(path)) {
        error = "không có " + path;
        return StateRead::Missing;
    }
    const auto text = readTextFile(path, kStoreJsonMaxBytes);
    if (!text) {
        error = "không đọc được " + path;
        return StateRead::Unreadable;
    }
    std::string why;
    const auto parsed = parseStoreState(*text, why);
    if (!parsed) {
        error = path + " hỏng: " + why;
        return StateRead::Unreadable;
    }
    state = *parsed;
    return StateRead::Ok;
}

std::string versionLine(const ProjectVersion& v, const std::string& dir) {
    std::string s = "seq " + std::to_string(v.seq) + "  " + shown(v.projectId) + " " +
                    shown(v.projectVersion) + "  " + v.digest;
    s += "\n    nguồn " + std::string(versionSourceName(v.source));
    if (v.activatedAt)
        s += "; kích hoạt " + shown(*v.activatedAt) +
             (v.clockOk ? "" : " (đồng hồ thiết bị chưa đồng bộ)");
    if (v.deployedBy) s += "; bởi " + shown(*v.deployedBy);
    if (v.deployedFrom) s += " từ " + shown(*v.deployedFrom);
    if (!fileExists(dir + "/v/" + std::to_string(v.seq) + "/" + kStoreMetaFile))
        s += "\n    [thiếu file: bản chưa đầy đủ, không khôi phục được]";
    return s;
}

int projectStatus(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
                  std::ostream& err) {
    std::vector<std::string> overrides;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--project-status") continue;
        if (a == "--config" || a == "--data-dir" || a == "--project-store-dir") {
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
    const std::string& dir = cfg.projectStoreDir;
    StoreState s;
    switch (readState(dir, s, error)) {
        case StateRead::Missing:
            out << "Kho project: " << dir << "\nKho chưa có state.json (chưa nhận project nào).\n";
            return 0;
        case StateRead::Unreadable:
            err << error << "\n";
            return 6;
        case StateRead::Ok:
            break;
    }
    out << "Kho project: " << dir << "\n";
    const ProjectVersion* active = s.active ? s.find(*s.active) : nullptr;
    if (active)
        out << "Đang chạy: " << versionLine(*active, dir) << "\n";
    else
        out << "Đang chạy: chưa có project trong kho\n";
    bool anyBackup = false;
    for (const auto& v : s.versions) {
        if (active && v.seq == active->seq) continue;
        if (!anyBackup) out << "Bản dự phòng:\n";
        anyBackup = true;
        out << "  " << versionLine(v, dir) << "\n";
    }
    if (!anyBackup) out << "Bản dự phòng: không\n";
    if (!s.pending) {
        out << "Thao tác dở dang: không\n";
        return 0;
    }
    const PendingOperation& p = *s.pending;
    out << "Thao tác dở dang: " << opKindName(p.kind) << " opId=" << p.opId << "\n    từ "
        << (p.from ? "seq " + std::to_string(*p.from) : std::string("chưa có project"))
        << " sang seq " << p.to << ", pha " << pendingPhaseName(p.phase) << ", lần khởi động "
        << p.bootAttempts << "\n    bởi " << shown(p.user) << " từ " << shown(p.source) << ", lúc "
        << shown(p.startedAt) << "\n";
    return 0;
}

int checkProject(int argc, char** argv, std::ostream& out, std::ostream& err,
                 const std::string& defaultSchemasDir) {
    std::string store, schemas = defaultSchemasDir;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--check-project") continue;
        if (a == "--project-store" || a == "--schemas-dir") {
            if (i + 1 >= argc || *argv[i + 1] == '\0') {
                err << a << " cần một đường dẫn\n";
                return 2;
            }
            (a == "--project-store" ? store : schemas) = argv[++i];
        } else {
            err << "tham số không hỗ trợ: " << a << "\n";
            return 2;
        }
    }
    StoreState s;
    std::string error;
    if (readState(store, s, error) != StateRead::Ok) {
        err << error << "\n";
        return 6;
    }
    if (!fileExists(schemas + "/project.schema.json")) {
        err << "không đọc được schema trong " << schemas << "\n";
        return 6;
    }
    if (!s.active) {  // nothing runs: nothing for the new binary to refuse
        out << R"({"valid":true,"errors":[],"warnings":[],"project":null})"
            << "\n";
        return 0;
    }
    const ProjectValidation v = validateProject(
        store + "/v/" + std::to_string(*s.active) + "/" + kStoreProjectDir, schemas);
    out << resultJson(v) << "\n";
    return v.valid ? 0 : 1;
}

}  // namespace

bool isProjectCommand(int argc, char** argv) {
    return hasFlag(argc, argv, "--project-status") ||
           (hasFlag(argc, argv, "--check-project") && hasFlag(argc, argv, "--project-store"));
}

int runProjectCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
                  std::ostream& err, const std::string& defaultSchemasDir) {
    if (hasFlag(argc, argv, "--project-status")) return projectStatus(argc, argv, env, out, err);
    return checkProject(argc, argv, out, err, defaultSchemasDir);
}

}  // namespace mat
