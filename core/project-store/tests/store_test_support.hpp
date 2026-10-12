// Helpers of the project store tests (T096–T098): temporary directories, files, an fsync recorder,
// a fake packer and a fake audit log.
#pragma once
#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <functional>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/project-store/store.hpp"

namespace storetest {

inline std::string tempDir() {
    char tmpl[] = "/tmp/mat-store-XXXXXX";
    const char* d = ::mkdtemp(tmpl);
    return d ? d : "";
}

inline bool exists(const std::string& p) {
    struct stat st {};
    return ::lstat(p.c_str(), &st) == 0;
}

inline unsigned modeOf(const std::string& p) {
    struct stat st {};
    return ::lstat(p.c_str(), &st) == 0 ? static_cast<unsigned>(st.st_mode & 07777) : 0u;
}

inline std::string readFile(const std::string& p) {
    std::ifstream f(p, std::ios::binary);
    if (!f) return "<missing>";
    std::ostringstream s;
    s << f.rdbuf();
    return s.str();
}

inline void writeFile(const std::string& p, const std::string& text) {
    const size_t slash = p.rfind('/');
    if (slash != std::string::npos && slash > 0) {
        std::string cmd = "mkdir -p '" + p.substr(0, slash) + "'";
        if (std::system(cmd.c_str()) != 0) return;
    }
    std::ofstream f(p, std::ios::binary | std::ios::trunc);
    f << text;
}

inline std::vector<std::string> listDir(const std::string& p) {
    std::vector<std::string> out;
    if (DIR* d = ::opendir(p.c_str())) {
        // readdir64: the 32-bit readdir fails with EOVERFLOW under qemu-user (armhf runs).
        while (const dirent64* e = ::readdir64(d)) {
            const std::string n = e->d_name;
            if (n != "." && n != "..") out.push_back(n);
        }
        ::closedir(d);
    }
    std::sort(out.begin(), out.end());
    return out;
}

inline std::string fdPath(int fd) {
    char buf[4096];
    const std::string link = "/proc/self/fd/" + std::to_string(fd);
    const ssize_t n = ::readlink(link.c_str(), buf, sizeof buf - 1);
    return n > 0 ? std::string(buf, static_cast<size_t>(n)) : "";
}

inline bool endsWith(const std::string& s, const std::string& tail) {
    return s.size() >= tail.size() && s.compare(s.size() - tail.size(), tail.size(), tail) == 0;
}

// 64 hex characters from the text (FNV-1a, four seeds): a digest-shaped value for fakes.
inline std::string fakeHex(const std::string& text) {
    std::string out;
    for (uint64_t seed : {1469598103934665603ULL, 1099511628211ULL, 7ULL, 31ULL}) {
        uint64_t h = seed;
        for (unsigned char c : text) h = (h ^ c) * 1099511628211ULL;
        char buf[17];
        std::snprintf(buf, sizeof buf, "%016llx", static_cast<unsigned long long>(h));
        out += buf;
    }
    return out;
}
inline std::string fakeDigest(const std::string& text) { return "sha256:" + fakeHex(text); }

// Records every fsync with the path of its descriptor, and fails the ones `fail` selects.
struct FsyncRecorder {
    struct Call {
        std::string path;
        std::string stateAtCall;  // content of <dir>/state.json when the call happened
    };
    std::string storeDir;
    std::vector<Call> calls;
    std::function<bool(const std::string& path)> fail;

    std::function<int(int)> hook() {
        return [this](int fd) {
            const std::string p = fdPath(fd);
            calls.push_back({p, readFile(storeDir + "/state.json")});
            if (fail && fail(p)) {
                errno = EIO;
                return -1;
            }
            return ::fsync(fd);
        };
    }
    size_t count(const std::function<bool(const std::string&)>& pred) const {
        size_t n = 0;
        for (const auto& c : calls)
            if (pred(c.path)) ++n;
        return n;
    }
};

// Audit log in memory; `fail` makes append throw AuditUnavailable.
struct FakeAudit {
    struct Row {
        std::string action, result, channel, source, user, role, target, code, detail;
    };
    std::vector<Row> rows;
    bool fail = false;
    std::function<void(const mat::AuditEvent&)> onAppend;  // runs before the row is kept

    mat::StoreAuditFn fn() {
        return [this](const mat::AuditEvent& e) {
            if (onAppend) onAppend(e);
            if (fail) throw mat::AuditUnavailable("audit down");
            rows.push_back({mat::auditActionName(e.action), mat::auditResultName(e.result),
                            mat::auditChannelName(e.channel), e.source, e.user.value_or(""),
                            e.role.value_or(""), e.target.value_or(""), e.code.value_or(""),
                            e.detail});
        };
    }
};

// A fake packer: "PACK" then, per file, its path and bytes (read from `dir`); digest from that.
struct FakePack {
    int calls = 0;
    bool fail = false;
    std::string lastDir;
    mat::PackFn fn() {
        return [this](const std::string& dir, const std::vector<std::string>& files, int fd) {
            ++calls;
            lastDir = dir;
            mat::PackResult r;
            if (fail) {
                r.error = "E_PKG_SECRET logging.json";
                return r;
            }
            std::string bytes = "PACK\n";
            for (const auto& f : files) bytes += f + "\n" + readFile(dir + "/" + f) + "\n";
            size_t done = 0;
            while (done < bytes.size()) {
                const ssize_t n = ::write(fd, bytes.data() + done, bytes.size() - done);
                if (n <= 0) {
                    r.error = "STORE_IO write";
                    return r;
                }
                done += static_cast<size_t>(n);
            }
            r.ok = true;
            r.digest = fakeDigest(bytes);
            r.bytes = bytes.size();
            return r;
        };
    }
};

// A legacy project directory with three files (one in a subdirectory).
inline mat::LegacyProject makeLegacy(const std::string& dir) {
    writeFile(dir + "/project.json", "{\"projectId\":\"tank-demo\"}\n");
    writeFile(dir + "/tags.json", "{\"tags\":[]}\n");
    writeFile(dir + "/screens/overview.screen.json", "{\"id\":\"overview\"}\n");
    writeFile(dir + "/notes.txt", "not part of the project\n");
    mat::LegacyProject l;
    l.status = mat::LegacyStatus::Valid;
    l.dir = dir;
    l.files = {"project.json", "screens/overview.screen.json", "tags.json"};
    l.projectId = "tank-demo";
    l.projectName = "Tank demo";
    l.projectVersion = "1.0.0";
    l.minRuntimeVersion = "0.3.0";
    return l;
}

inline mat::ProjectVersion makeVersion(int64_t seq, const std::string& version = "1.0.0") {
    mat::ProjectVersion v;
    v.seq = seq;
    v.digest = fakeDigest("v" + std::to_string(seq));
    v.projectId = "tank-demo";
    v.projectName = "Tank demo";
    v.projectVersion = version;
    v.minRuntimeVersion = "0.4.0";
    v.size = 1000 + seq;
    v.activatedAt = "2026-10-20T03:12:00Z";
    v.clockOk = true;
    v.deployedBy = "kysu1";
    v.deployedFrom = "192.168.1.20";
    v.source = mat::VersionSource::Studio;
    return v;
}

constexpr const char* kOp1 = "0f8fad5b-d9cb-469f-a165-70867728950e";
constexpr const char* kOp2 = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

}  // namespace storetest
