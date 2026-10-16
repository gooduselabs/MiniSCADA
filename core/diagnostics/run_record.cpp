#include "core/diagnostics/run_record.hpp"

#include <fcntl.h>
#include <unistd.h>

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>

#include "nlohmann/json.hpp"

namespace mat {

namespace {

using nlohmann::json;

std::string dirOf(const std::string& path) {
    const size_t slash = path.rfind('/');
    return slash == std::string::npos ? "." : (slash == 0 ? "/" : path.substr(0, slash));
}

bool writeAll(int fd, const std::string& text) {
    size_t off = 0;
    while (off < text.size()) {
        const ssize_t w = ::write(fd, text.data() + off, text.size() - off);
        if (w < 0 && errno == EINTR) continue;
        if (w <= 0) return false;
        off += static_cast<size_t>(w);
    }
    return true;
}

std::optional<std::string> readSmall(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::nullopt;
    std::ostringstream s;
    s << in.rdbuf();
    std::string t = s.str();
    if (t.size() > 64 * 1024) return std::string();  // not ours: unreadable
    return t;
}

}  // namespace

RunRecord::RunRecord(std::string path) : path_(std::move(path)) {}

bool RunRecord::begin(int64_t wallMs, const std::string& version, const std::string& bootId,
                      std::string* error) {
    version_ = version;
    boot_ = bootId;
    startedAt_ = wallMs;
    info_ = RestartInfo{};
    if (const auto text = readSmall(path_)) {
        const json j = json::parse(*text, nullptr, false);
        const bool valid = j.is_object() && j.value("v", 0) == 1 && j.contains("state") &&
                           j["state"].is_string() && j.contains("total") &&
                           j["total"].is_number_integer();
        if (!valid) {
            info_.total = 1;
            info_.lastReason = "unknown";
            info_.lastAtMs = wallMs;
        } else {
            const std::string state = j["state"].get<std::string>();
            const int64_t total = j["total"].get<int64_t>();
            if (state == "exec") {  // the same process went on: carry the record over
                info_.total = total;
                if (j.contains("lastReason") && j["lastReason"].is_string())
                    info_.lastReason = j["lastReason"].get<std::string>();
                if (j.contains("lastAt") && j["lastAt"].is_number_integer())
                    info_.lastAtMs = j["lastAt"].get<int64_t>();
                info_.bootChanged = j.value("bootChanged", false);
            } else {
                info_.total = total + 1;
                info_.lastAtMs = wallMs;
                if (state == "running") {
                    info_.lastReason = "crash";
                    info_.bootChanged = j.value("boot", std::string()) != bootId;
                } else if (state == "stopped") {
                    info_.lastReason =
                        j.value("version", std::string()) != version ? "update" : "systemd-restart";
                } else {
                    info_.lastReason = "unknown";
                }
            }
        }
    }
    return write("running", error);
}

bool RunRecord::end(bool exec, std::string* error) {
    return write(exec ? "exec" : "stopped", error);
}

bool RunRecord::write(const std::string& state, std::string* error) {
    const json j = {
        {"v", 1},
        {"state", state},
        {"total", info_.total},
        {"lastReason", info_.lastReason.empty() ? json(nullptr) : json(info_.lastReason)},
        {"lastAt", info_.lastAtMs ? json(*info_.lastAtMs) : json(nullptr)},
        {"bootChanged", info_.bootChanged},
        {"version", version_},
        {"boot", boot_},
        {"startedAt", startedAt_}};
    const std::string tmp = path_ + ".tmp";
    const auto fail = [&](const char* what) {
        if (error) *error = std::string(what) + " " + tmp + ": " + std::strerror(errno);
        return false;
    };
    const int fd = ::open(tmp.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
    if (fd < 0) return fail("open");
    const bool ok = writeAll(fd, j.dump() + "\n") && ::fsync(fd) == 0;
    const int saved = errno;
    ::close(fd);
    if (!ok) {
        errno = saved;
        ::unlink(tmp.c_str());
        return fail("write");
    }
    if (::rename(tmp.c_str(), path_.c_str()) != 0) {
        const bool r = fail("rename");
        ::unlink(tmp.c_str());
        return r;
    }
    const int dfd = ::open(dirOf(path_).c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dfd >= 0) {
        ::fsync(dfd);
        ::close(dfd);
    }
    return true;
}

std::string systemBootId() {
    auto t = readSmall("/proc/sys/kernel/random/boot_id");
    if (!t) return {};
    while (!t->empty() && (t->back() == '\n' || t->back() == ' ')) t->pop_back();
    return *t;
}

}  // namespace mat
