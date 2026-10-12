#include "core/historian/secrets.hpp"

#include <fcntl.h>
#include <grp.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>

#include "core/common/utf8.hpp"
#include "nlohmann/json.hpp"

namespace mat {

namespace {

constexpr off_t kMaxBytes = 64 * 1024;
constexpr const char* kSchemaVersion = "0.1.0";

struct FileText {
    std::string text;
    std::string reason;  // empty = ok
};

// enforceMode: refuse a file that others can read or write (readers); the writer reads it anyway
// to keep its entries, then rewrites it with mode 0640.
FileText readSmallFile(const std::string& file, bool enforceMode) {
    FileText r;
    const int fd = ::open(file.c_str(), O_RDONLY | O_CLOEXEC);
    if (fd < 0) {
        r.reason = errno == ENOENT ? "missing_file" : "permissions";
        return r;
    }
    struct stat st {};
    if (::fstat(fd, &st) != 0 || !S_ISREG(st.st_mode)) {
        ::close(fd);
        r.reason = "invalid";
        return r;
    }
    if (enforceMode && (st.st_mode & 0007) != 0) {  // others may read or write it: never use it
        ::close(fd);
        r.reason = "permissions";
        return r;
    }
    if (st.st_size > kMaxBytes) {
        ::close(fd);
        r.reason = "too_big";
        return r;
    }
    char buf[4096];
    ssize_t n;
    while ((n = ::read(fd, buf, sizeof buf)) > 0) {
        r.text.append(buf, static_cast<size_t>(n));
        if (r.text.size() > static_cast<size_t>(kMaxBytes)) break;
    }
    ::close(fd);
    if (n < 0) r.reason = "invalid";
    if (r.text.size() > static_cast<size_t>(kMaxBytes)) r.reason = "too_big";
    return r;
}

std::string sysError(const std::string& what, const std::string& file) {
    return what + " " + file + ": " + std::strerror(errno);
}

}  // namespace

bool validConnectionId(const std::string& id) {
    if (id.empty() || id.size() > 48) return false;
    for (size_t i = 0; i < id.size(); ++i) {
        const char c = id[i];
        const bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || (c == '-' && i > 0);
        if (!ok) return false;
    }
    return true;
}

SecretResult readSecret(const std::string& file, const std::string& connectionId) {
    SecretResult r;
    const FileText f = readSmallFile(file, true);
    if (!f.reason.empty()) {
        r.reason = f.reason;
        return r;
    }
    const auto doc = nlohmann::json::parse(f.text, nullptr, false);
    if (doc.is_discarded() || !doc.is_object() || !doc.contains("connections") ||
        !doc["connections"].is_object()) {
        r.reason = "invalid";
        return r;
    }
    const auto& conns = doc["connections"];
    const auto it = conns.find(connectionId);
    if (it == conns.end()) {
        r.reason = "no_entry";
        return r;
    }
    if (!it->is_string()) {
        r.reason = "invalid";
        return r;
    }
    r.ok = true;
    r.secret = it->get<std::string>();
    return r;
}

bool writeSecret(const std::string& file, const std::string& connectionId,
                 const std::string& secret, std::string& err, std::string* warning) {
    if (!validConnectionId(connectionId)) {
        err = "id kết nối không hợp lệ (chữ thường, số, gạch ngang; tối đa 48 ký tự)";
        return false;
    }
    // JSON holds UTF-8 only; the message never shows the secret (security review L2).
    if (!isValidUtf8(secret)) {
        err =
            "mật khẩu/token không phải UTF-8 hợp lệ (kiểm tra bảng mã của terminal): không ghi gì";
        return false;
    }
    nlohmann::json doc = {{"schemaVersion", kSchemaVersion},
                          {"connections", nlohmann::json::object()}};
    const FileText old = readSmallFile(file, false);
    if (old.reason.empty()) {
        const auto parsed = nlohmann::json::parse(old.text, nullptr, false);
        if (parsed.is_discarded() || !parsed.is_object() ||
            (parsed.contains("connections") && !parsed["connections"].is_object())) {
            err = file + " không đúng định dạng: sửa tay hoặc xóa file trước";
            return false;
        }
        if (parsed.contains("connections")) doc["connections"] = parsed["connections"];
    } else if (old.reason != "missing_file") {
        err = file + " không đọc được (" + old.reason + "): cần chạy bằng root, hoặc sửa tay";
        return false;
    }
    doc["connections"][connectionId] = secret;
    const std::string text = doc.dump(2) + "\n";
    if (text.size() > static_cast<size_t>(kMaxBytes)) {
        err = "file bí mật sẽ vượt 64 KB";
        return false;
    }

    const std::string tmp = file + ".tmp";
    ::unlink(tmp.c_str());
    const int fd = ::open(tmp.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
    if (fd < 0) {
        err = sysError("không tạo được", tmp);
        return false;
    }
    auto fail = [&](const std::string& what) {
        err = sysError(what, tmp);
        ::close(fd);
        ::unlink(tmp.c_str());
        return false;
    };
    size_t done = 0;
    while (done < text.size()) {
        const ssize_t n = ::write(fd, text.data() + done, text.size() - done);
        if (n < 0) {
            if (errno == EINTR) continue;
            return fail("không ghi được");
        }
        done += static_cast<size_t>(n);
    }
    if (::fsync(fd) != 0) return fail("không fsync được");
    if (::geteuid() == 0) {
        if (const group* g = ::getgrnam("matscada")) {
            if (::fchown(fd, 0, g->gr_gid) != 0) return fail("không đổi chủ sở hữu được");
        } else if (warning) {
            *warning =
                "chưa có nhóm matscada (deploy.sh tạo khi cài lần đầu): dịch vụ chưa đọc "
                "được " +
                file + "; chạy lại lệnh này sau khi cài";
        }
    }
    if (::fchmod(fd, 0640) != 0) return fail("không đổi quyền được");
    if (::close(fd) != 0) {
        err = sysError("không đóng được", tmp);
        ::unlink(tmp.c_str());
        return false;
    }
    if (::rename(tmp.c_str(), file.c_str()) != 0) {
        err = sysError("không đổi tên được", tmp);
        ::unlink(tmp.c_str());
        return false;
    }
    const size_t slash = file.rfind('/');
    const std::string dir =
        slash == std::string::npos ? "." : slash == 0 ? "/" : file.substr(0, slash);
    const int dfd = ::open(dir.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dfd >= 0) {  // the rename itself survives a power cut
        ::fsync(dfd);
        ::close(dfd);
    }
    return true;
}

}  // namespace mat
