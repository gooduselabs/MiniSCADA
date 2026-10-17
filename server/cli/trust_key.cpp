#include "server/cli/trust_key.hpp"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cstring>
#include <fstream>
#include <ostream>
#include <regex>
#include <sstream>
#include <string>
#include <vector>

#include "core/update/signature.hpp"
#include "core/update/update_error.hpp"

namespace mat {

namespace {

bool readSmall(const std::string& p, std::string& out) {
    struct stat st {};
    if (::stat(p.c_str(), &st) != 0 || !S_ISREG(st.st_mode) || st.st_size > 16 * 1024) return false;
    std::ifstream in(p, std::ios::binary);
    std::ostringstream s;
    s << in.rdbuf();
    out = s.str();
    return true;
}

bool writeKey(const std::string& path, const std::string& pem) {
    const std::string tmp = path + ".tmp";
    const int fd = ::open(tmp.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW | O_CLOEXEC, 0644);
    if (fd < 0) return false;
    bool ok = ::write(fd, pem.data(), pem.size()) == static_cast<ssize_t>(pem.size()) &&
              ::fchmod(fd, 0644) == 0 && ::fsync(fd) == 0;
    ok = ::close(fd) == 0 && ok;
    if (!ok || ::rename(tmp.c_str(), path.c_str()) != 0) {
        ::unlink(tmp.c_str());
        return false;
    }
    return true;
}

std::string stem(const std::string& path) {
    std::string n = path.substr(path.rfind('/') == std::string::npos ? 0 : path.rfind('/') + 1);
    if (n.size() > 4 && n.compare(n.size() - 4, 4, ".pem") == 0) n.resize(n.size() - 4);
    if (n.size() > 4 && n.compare(n.size() - 4, 4, ".pub") == 0) n.resize(n.size() - 4);
    return n;
}

}  // namespace

bool isTrustKeyCommand(int argc, char** argv) {
    for (int i = 1; i < argc; ++i)
        if (std::strcmp(argv[i], "--trust-key") == 0) return true;
    return false;
}

int runTrustKeyCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
                   std::ostream& err) {
    std::vector<std::string> overrides, rest;
    std::string keysDir, label;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--trust-key") continue;
        if (a == "--config" || a == "--keys-dir" || a == "--label") {
            if (i + 1 >= argc || *argv[i + 1] == '\0') {
                err << a << " cần một giá trị\n";
                return 2;
            }
            const std::string v = argv[++i];
            if (a == "--config") {
                overrides.push_back(a);
                overrides.push_back(v);
            } else if (a == "--keys-dir") {
                keysDir = v;
            } else {
                label = v;
            }
        } else {
            rest.push_back(a);
        }
    }
    const std::string action = rest.empty() ? "" : rest[0];
    if ((action == "list" && rest.size() != 1) ||
        ((action == "add" || action == "remove") && rest.size() != 2) ||
        (action != "list" && action != "add" && action != "remove")) {
        err << "dùng: mat-runtime --trust-key list | add <file.pem> [--label <tên>] | remove "
               "<keyId>\n";
        return 2;
    }
    if (keysDir.empty()) {
        RuntimeConfig cfg;
        std::string error;
        if (!loadDeviceCliConfig(overrides, env, cfg, error)) {
            err << "cấu hình: " << error << "\n";
            return 2;
        }
        keysDir = cfg.updateTrustedKeysDir;
    }
    const update::KeySet keys = update::loadTrustedKeys(keysDir);
    if (action == "list") {
        for (const std::string& w : keys.warnings) err << "cảnh báo: " << w << "\n";
        if (keys.keys.empty()) {
            out << "không có khóa tin cậy trong " << keysDir
                << " (cập nhật qua mạng không nhận gói)\n";
            return 0;
        }
        for (const auto& k : keys.keys)
            out << k.keyId() << "\t" << k.label << "\t" << k.file << "\n";
        return 0;
    }
    if (!env.isRoot) {
        err << "--trust-key " << action << " cần quyền root\n";
        return 4;
    }
    if (action == "add") {
        std::string pem, why;
        if (!readSmall(rest[1], pem)) {
            err << "không đọc được " << rest[1] << "\n";
            return 1;
        }
        update::PublicKey k;
        if (!k.parsePem(pem, why)) {
            err << rest[1] << ": " << why << " (chỉ nhận khóa công khai ECDSA P-256, PEM)\n";
            return 1;
        }
        if (label.empty()) label = stem(rest[1]);
        static const std::regex kLabel("^[a-z0-9][a-z0-9._-]{0,63}$");
        if (!std::regex_match(label, kLabel) || label.find("..") != std::string::npos) {
            err << "--label: chữ thường, số, '.', '_', '-' (tối đa 64)\n";
            return 2;
        }
        for (const auto& t : keys.keys)
            if (t.keyId() == k.keyId()) {
                err << "khóa đã có: " << t.label << " (" << k.keyId() << ")\n";
                return 1;
            }
        if (keys.keys.size() >= update::kMaxTrustedKeys) {
            err << "đã có " << keys.keys.size() << " khóa: tối đa 4, gỡ một khóa trước\n";
            return 1;
        }
        const std::string path = keysDir + "/" + label + ".pem";
        struct stat st {};
        if (::lstat(path.c_str(), &st) == 0) {
            err << "đã có tệp " << path << "\n";
            return 1;
        }
        if (::mkdir(keysDir.c_str(), 0755) != 0 && errno != EEXIST) {
            err << "không tạo được " << keysDir << ": " << std::strerror(errno) << "\n";
            return 1;
        }
        ::chmod(keysDir.c_str(), 0755);
        if (!writeKey(path, pem)) {
            err << "không ghi được " << path << "\n";
            return 1;
        }
        out << "đã thêm " << k.keyId() << " (" << label
            << "): runtime ghi audit ở lần khởi động tới\n";
        return 0;
    }
    // remove
    for (const auto& k : keys.keys)
        if (k.keyId() == rest[1]) {
            if (::unlink(k.file.c_str()) != 0) {
                err << "không xóa được " << k.file << ": " << std::strerror(errno) << "\n";
                return 1;
            }
            out << "đã gỡ " << k.keyId() << " (" << k.label << ")";
            if (keys.keys.size() == 1) out << ": không còn khóa, cập nhật qua mạng không nhận gói";
            out << "\n";
            return 0;
        }
    err << "không có khóa " << rest[1] << " trong " << keysDir << "\n";
    return 1;
}

}  // namespace mat
