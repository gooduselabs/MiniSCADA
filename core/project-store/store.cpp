#include "core/project-store/store.hpp"

#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <mutex>

#include "core/common/json_text.hpp"
#include "core/crypto/random.hpp"
#include "nlohmann/json.hpp"

namespace mat {

namespace {

using Json = nlohmann::json;
using OJson = nlohmann::ordered_json;

std::string sysError(const std::string& what, const std::string& path, int err) {
    return what + " " + path + ": " + std::strerror(err);
}

bool writeAll(int fd, const char* data, size_t n) {
    size_t done = 0;
    while (done < n) {
        const ssize_t w = ::write(fd, data + done, n - done);
        if (w < 0) {
            if (errno == EINTR) continue;
            return false;
        }
        done += static_cast<size_t>(w);
    }
    return true;
}

// Names in a directory but "." and "..". readdir64: the 32-bit readdir fails with EOVERFLOW on
// 64-bit directory offsets (armhf under qemu-user, as in project_validator.cpp).
std::vector<std::string> listNames(const std::string& dir) {
    std::vector<std::string> out;
    DIR* d = ::opendir(dir.c_str());
    if (!d) return out;
    while (const dirent64* e = ::readdir64(d)) {
        const std::string n = e->d_name;
        if (n != "." && n != "..") out.push_back(n);
    }
    ::closedir(d);
    return out;
}

// Removes everything under dirFd without following symlinks (unlinkat removes a link, never its
// target). Best effort.
void removeContents(int dirFd) {
    const int dup = ::dup(dirFd);
    if (dup < 0) return;
    DIR* d = ::fdopendir(dup);
    if (!d) {
        ::close(dup);
        return;
    }
    std::vector<std::string> names;
    while (const dirent64* e = ::readdir64(d)) {
        const std::string n = e->d_name;
        if (n != "." && n != "..") names.push_back(n);
    }
    ::closedir(d);
    for (const auto& n : names) {
        struct stat64 st {};
        if (::fstatat64(dirFd, n.c_str(), &st, AT_SYMLINK_NOFOLLOW) != 0) continue;
        if (S_ISDIR(st.st_mode)) {
            const int sub =
                ::openat(dirFd, n.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
            if (sub >= 0) {
                removeContents(sub);
                ::close(sub);
            }
            ::unlinkat(dirFd, n.c_str(), AT_REMOVEDIR);
        } else {
            ::unlinkat(dirFd, n.c_str(), 0);
        }
    }
}

void removeTree(const std::string& path) {
    struct stat64 st {};
    if (::lstat64(path.c_str(), &st) != 0) return;
    if (!S_ISDIR(st.st_mode)) {
        ::unlink(path.c_str());
        return;
    }
    const int fd = ::open(path.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (fd >= 0) {
        removeContents(fd);
        ::close(fd);
    }
    ::rmdir(path.c_str());
}

// A regular file of at most `max` bytes, not through a symlink.
std::optional<std::string> readSmall(const std::string& path, size_t max) {
    const int fd = ::open(path.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) return std::nullopt;
    struct stat64 st {};
    if (::fstat64(fd, &st) != 0 || !S_ISREG(st.st_mode) ||
        static_cast<uint64_t>(st.st_size) > max) {
        ::close(fd);
        return std::nullopt;
    }
    std::string out;
    char buf[8192];
    for (;;) {
        const ssize_t n = ::read(fd, buf, sizeof buf);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) break;
        out.append(buf, static_cast<size_t>(n));
        if (out.size() > max) break;
    }
    ::close(fd);
    if (out.size() > max) return std::nullopt;
    return out;
}

// A directory with mode 0700: made when missing; an existing one must be a real directory.
bool makePrivateDir(const std::string& path, std::string& err) {
    if (::mkdir(path.c_str(), 0700) != 0 && errno != EEXIST) {
        err = sysError("không tạo được thư mục", path, errno);
        return false;
    }
    struct stat64 st {};
    if (::lstat64(path.c_str(), &st) != 0 || !S_ISDIR(st.st_mode)) {
        err = "không phải thư mục (hoặc là liên kết): " + path;
        return false;
    }
    if ((st.st_mode & 07777) != 0700 && ::chmod(path.c_str(), 0700) != 0) {
        err = sysError("không đổi quyền được", path, errno);
        return false;
    }
    return true;
}

// "123" → 123; anything else (sign, leading zero, too long) → nullopt.
std::optional<int64_t> seqName(const std::string& n) {
    if (n.empty() || n.size() > 15 || n[0] == '0') return std::nullopt;
    int64_t v = 0;
    for (char c : n) {
        if (c < '0' || c > '9') return std::nullopt;
        v = v * 10 + (c - '0');
    }
    return v;
}

bool isDigest(const std::string& d) {
    if (d.size() != 71 || d.compare(0, 7, "sha256:") != 0) return false;
    for (size_t i = 7; i < d.size(); ++i) {
        const char c = d[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    }
    return true;
}

// SemVer "1.x.y" (MAJOR 1); pre-release and build tags allowed.
bool schemaMajorOne(const std::string& v) {
    size_t i = 0;
    int parts = 0;
    while (parts < 3) {
        const size_t start = i;
        while (i < v.size() && v[i] >= '0' && v[i] <= '9') ++i;
        if (i == start) return false;
        if (parts == 0 && v.substr(start, i - start) != "1") return false;
        ++parts;
        if (parts < 3) {
            if (i >= v.size() || v[i] != '.') return false;
            ++i;
        }
    }
    return i == v.size() || v[i] == '-' || v[i] == '+';
}

// Readers of one field; false + `error` naming it.
struct Reader {
    const Json& j;
    std::string where;
    std::string& error;

    bool fail(const char* key, const char* what) {
        error = where + key + ": " + what;
        return false;
    }
    bool has(const char* key) {
        if (!j.contains(key)) return fail(key, "thiếu");
        return true;
    }
    bool str(const char* key, std::string& out) {
        if (!has(key)) return false;
        if (!j[key].is_string()) return fail(key, "phải là chuỗi");
        out = j[key].get<std::string>();
        return true;
    }
    bool optStr(const char* key, std::optional<std::string>& out) {
        if (!has(key)) return false;
        if (j[key].is_null()) {
            out.reset();
            return true;
        }
        if (!j[key].is_string()) return fail(key, "phải là chuỗi hoặc null");
        out = j[key].get<std::string>();
        return true;
    }
    bool integer(const char* key, int64_t& out, int64_t min) {
        if (!has(key)) return false;
        if (!j[key].is_number_integer()) return fail(key, "phải là số nguyên");
        out = j[key].get<int64_t>();
        if (out < min) return fail(key, "nhỏ quá");
        return true;
    }
    bool optInteger(const char* key, std::optional<int64_t>& out, int64_t min) {
        if (!has(key)) return false;
        if (j[key].is_null()) {
            out.reset();
            return true;
        }
        int64_t v = 0;
        if (!integer(key, v, min)) return false;
        out = v;
        return true;
    }
    bool boolean(const char* key, bool& out) {
        if (!has(key)) return false;
        if (!j[key].is_boolean()) return fail(key, "phải là true/false");
        out = j[key].get<bool>();
        return true;
    }
};

bool readVersion(const Json& j, const std::string& where, ProjectVersion& v, std::string& error) {
    if (!j.is_object()) {
        error = where + "phải là object";
        return false;
    }
    Reader r{j, where, error};
    std::string source;
    if (!r.integer("seq", v.seq, 1) || !r.str("digest", v.digest) ||
        !r.str("projectId", v.projectId) || !r.str("projectName", v.projectName) ||
        !r.str("projectVersion", v.projectVersion) ||
        !r.str("minRuntimeVersion", v.minRuntimeVersion) || !r.integer("size", v.size, 0) ||
        !r.optStr("activatedAt", v.activatedAt) || !r.boolean("clockOk", v.clockOk) ||
        !r.optStr("deployedBy", v.deployedBy) || !r.optStr("deployedFrom", v.deployedFrom) ||
        !r.str("source", source))
        return false;
    if (!isDigest(v.digest)) return r.fail("digest", "không đúng dạng sha256:<64 hex>");
    const auto src = parseVersionSource(source);
    if (!src) return r.fail("source", "không biết");
    v.source = *src;
    return true;
}

OJson versionJson(const ProjectVersion& v) {
    auto opt = [](const std::optional<std::string>& s) { return s ? OJson(*s) : OJson(nullptr); };
    OJson j;
    j["seq"] = v.seq;
    j["digest"] = v.digest;
    j["projectId"] = v.projectId;
    j["projectName"] = v.projectName;
    j["projectVersion"] = v.projectVersion;
    j["minRuntimeVersion"] = v.minRuntimeVersion;
    j["size"] = v.size;
    j["activatedAt"] = opt(v.activatedAt);
    j["clockOk"] = v.clockOk;
    j["deployedBy"] = opt(v.deployedBy);
    j["deployedFrom"] = opt(v.deployedFrom);
    j["source"] = versionSourceName(v.source);
    return j;
}

std::string dumpJson(const OJson& j) {
    return j.dump(2, ' ', false, OJson::error_handler_t::replace) + "\n";
}

// Days since 1970-01-01 → civil date (H. Hinnant's algorithm): no time_t, so 32-bit builds work
// past 2038.
void civil(int64_t days, int64_t& y, unsigned& m, unsigned& d) {
    days += 719468;
    const int64_t era = (days >= 0 ? days : days - 146096) / 146097;
    const unsigned doe = static_cast<unsigned>(days - era * 146097);
    const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const unsigned mp = (5 * doy + 2) / 153;
    d = doy - (153 * mp + 2) / 5 + 1;
    m = mp < 10 ? mp + 3 : mp - 9;
    y = static_cast<int64_t>(yoe) + era * 400 + (m <= 2 ? 1 : 0);
}

// Path segments are not empty, ".", ".." nor hold '\' or NUL; not absolute.
bool safeRelPath(const std::string& p) {
    if (p.empty() || p[0] == '/' || p.size() > 4096) return false;
    size_t start = 0;
    for (;;) {
        const size_t slash = p.find('/', start);
        const std::string seg =
            p.substr(start, slash == std::string::npos ? std::string::npos : slash - start);
        if (seg.empty() || seg == "." || seg == ".." ||
            seg.find_first_of(std::string("\\\0", 2)) != std::string::npos)
            return false;
        if (slash == std::string::npos) return true;
        start = slash + 1;
    }
}

}  // namespace

// ---------- names, JSON, pure changes ----------

bool statvfsFreeBytes(const std::string& dir, uint64_t& freeBytes) {
    struct statvfs64 st {};
    if (::statvfs64(dir.c_str(), &st) != 0) return false;
    freeBytes = static_cast<uint64_t>(st.f_bavail) * static_cast<uint64_t>(st.f_frsize);
    return true;
}

const char* opKindName(OpKind k) {
    return k == OpKind::Restore ? "restore" : (k == OpKind::Update ? "update" : "deploy");
}
std::optional<OpKind> parseOpKind(std::string_view s) {
    if (s == "deploy") return OpKind::Deploy;
    if (s == "restore") return OpKind::Restore;
    return std::nullopt;
}

const char* versionSourceName(VersionSource s) {
    switch (s) {
        case VersionSource::Studio:
            return "studio";
        case VersionSource::RuntimePackage:
            return "runtime-package";
        case VersionSource::Restore:
            return "restore";
    }
    return "";
}
std::optional<VersionSource> parseVersionSource(std::string_view s) {
    for (VersionSource v :
         {VersionSource::Studio, VersionSource::RuntimePackage, VersionSource::Restore})
        if (s == versionSourceName(v)) return v;
    return std::nullopt;
}

const char* pendingPhaseName(PendingPhase p) {
    switch (p) {
        case PendingPhase::Activating:
            return "activating";
        case PendingPhase::Health:
            return "health";
        case PendingPhase::RollingBack:
            return "rolling-back";
    }
    return "";
}
std::optional<PendingPhase> parsePendingPhase(std::string_view s) {
    for (PendingPhase p :
         {PendingPhase::Activating, PendingPhase::Health, PendingPhase::RollingBack})
        if (s == pendingPhaseName(p)) return p;
    return std::nullopt;
}

const ProjectVersion* StoreState::find(int64_t seq) const {
    for (const auto& v : versions)
        if (v.seq == seq) return &v;
    return nullptr;
}

std::string storeStateJson(const StoreState& s) {
    OJson j;
    j["schemaVersion"] = s.schemaVersion;
    j["active"] = s.active ? OJson(*s.active) : OJson(nullptr);
    j["nextSeq"] = s.nextSeq;
    j["versions"] = OJson::array();
    for (const auto& v : s.versions) j["versions"].push_back(versionJson(v));
    if (s.pending) {
        const PendingOperation& p = *s.pending;
        OJson pj;
        pj["opId"] = p.opId;
        pj["kind"] = opKindName(p.kind);
        pj["from"] = p.from ? OJson(*p.from) : OJson(nullptr);
        pj["to"] = p.to;
        pj["phase"] = pendingPhaseName(p.phase);
        pj["bootAttempts"] = p.bootAttempts;
        pj["user"] = p.user;
        pj["source"] = p.source;
        pj["startedAt"] = p.startedAt;
        j["pending"] = std::move(pj);
    } else {
        j["pending"] = nullptr;
    }
    return dumpJson(j);
}

std::optional<StoreState> parseStoreState(std::string_view text, std::string& error) {
    Json j = Json::parse(text.begin(), text.end(), nullptr, false);
    if (j.is_discarded() || !j.is_object()) {
        error = "state.json không phải JSON object";
        return std::nullopt;
    }
    StoreState s;
    Reader r{j, "", error};
    if (!r.str("schemaVersion", s.schemaVersion)) return std::nullopt;
    if (!schemaMajorOne(s.schemaVersion)) {
        r.fail("schemaVersion", "phải là 1.x.y");
        return std::nullopt;
    }
    if (!r.optInteger("active", s.active, 1) || !r.integer("nextSeq", s.nextSeq, 1) ||
        !r.has("versions"))
        return std::nullopt;
    if (!j["versions"].is_array()) {
        r.fail("versions", "phải là mảng");
        return std::nullopt;
    }
    std::set<int64_t> seqs;
    for (size_t i = 0; i < j["versions"].size(); ++i) {
        ProjectVersion v;
        if (!readVersion(j["versions"][i], "versions[" + std::to_string(i) + "].", v, error))
            return std::nullopt;
        if (!seqs.insert(v.seq).second) {
            error = "versions: seq " + std::to_string(v.seq) + " trùng";
            return std::nullopt;
        }
        if (v.seq >= s.nextSeq) {
            error = "versions: seq " + std::to_string(v.seq) + " không nhỏ hơn nextSeq";
            return std::nullopt;
        }
        s.versions.push_back(std::move(v));
    }
    if (s.active && !seqs.count(*s.active)) {
        error = "active không có trong versions";
        return std::nullopt;
    }
    if (!r.has("pending")) return std::nullopt;
    const Json& pj = j["pending"];
    if (!pj.is_null()) {
        if (!pj.is_object()) {
            r.fail("pending", "phải là object hoặc null");
            return std::nullopt;
        }
        PendingOperation p;
        Reader pr{pj, "pending.", error};
        std::string kind, phase;
        int64_t attempts = 0;
        if (!pr.str("opId", p.opId) || !pr.str("kind", kind) || !pr.optInteger("from", p.from, 1) ||
            !pr.integer("to", p.to, 1) || !pr.str("phase", phase) ||
            !pr.integer("bootAttempts", attempts, 0) || !pr.str("user", p.user) ||
            !pr.str("source", p.source) || !pr.str("startedAt", p.startedAt))
            return std::nullopt;
        if (!validOpId(p.opId)) {
            pr.fail("opId", "không phải UUID");
            return std::nullopt;
        }
        const auto k = parseOpKind(kind);
        const auto ph = parsePendingPhase(phase);
        if (!k || !ph) {
            pr.fail(k ? "phase" : "kind", "không biết");
            return std::nullopt;
        }
        if (p.to >= s.nextSeq || (p.from && *p.from >= s.nextSeq)) {
            pr.fail("to", "không nhỏ hơn nextSeq");
            return std::nullopt;
        }
        p.kind = *k;
        p.phase = *ph;
        p.bootAttempts = static_cast<int>(std::min<int64_t>(attempts, 1000));
        s.pending = std::move(p);
    }
    return s;
}

std::string versionMetaJson(const ProjectVersion& v) {
    OJson j;
    j["schemaVersion"] = kStoreSchemaVersion;
    const OJson fields = versionJson(v);
    for (const auto& [k, val] : fields.items()) j[k] = val;
    return dumpJson(j);
}

std::optional<ProjectVersion> parseVersionMeta(std::string_view text, std::string& error) {
    Json j = Json::parse(text.begin(), text.end(), nullptr, false);
    if (j.is_discarded() || !j.is_object()) {
        error = "meta.json không phải JSON object";
        return std::nullopt;
    }
    std::string schema;
    Reader r{j, "", error};
    if (!r.str("schemaVersion", schema)) return std::nullopt;
    if (!schemaMajorOne(schema)) {
        r.fail("schemaVersion", "phải là 1.x.y");
        return std::nullopt;
    }
    ProjectVersion v;
    if (!readVersion(j, "", v, error)) return std::nullopt;
    return v;
}

StoreState stateCommitted(StoreState s, ProjectVersion entry, int backups,
                          std::vector<int64_t>* dropped) {
    const int64_t to = s.pending ? s.pending->to : entry.seq;
    entry.seq = to;
    s.versions.erase(std::remove_if(s.versions.begin(), s.versions.end(),
                                    [&](const ProjectVersion& v) { return v.seq == to; }),
                     s.versions.end());
    s.versions.insert(s.versions.begin(), std::move(entry));
    const size_t keep =
        1 + static_cast<size_t>(std::clamp(backups, kProjectBackupsMin, kProjectBackupsMax));
    while (s.versions.size() > keep) {
        if (dropped) dropped->push_back(s.versions[keep].seq);
        s.versions.erase(s.versions.begin() + static_cast<std::ptrdiff_t>(keep));
    }
    s.active = to;
    s.nextSeq = std::max(s.nextSeq, to + 1);
    s.pending.reset();
    return s;
}

StoreState stateRollingBack(StoreState s, int attempts) {
    if (s.pending) {
        s.pending->phase = PendingPhase::RollingBack;
        s.pending->bootAttempts = attempts;
        s.active = s.pending->from;
    }
    return s;
}

StoreState stateEnded(StoreState s, bool keepFrom) {
    if (s.pending) {
        if (keepFrom)
            s.active = s.pending->from;
        else
            s.active.reset();
        s.pending.reset();
    } else if (!keepFrom) {
        s.active.reset();
    }
    return s;
}

bool validOpId(std::string_view id) {
    if (id.size() != 36) return false;
    for (size_t i = 0; i < id.size(); ++i) {
        const char c = id[i];
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (c != '-') return false;
        } else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) {
            return false;
        }
    }
    return id[14] == '4' && (id[19] == '8' || id[19] == '9' || id[19] == 'a' || id[19] == 'b');
}

std::string newOpId() {
    unsigned char b[16];
    randomBytes(b, sizeof b);
    b[6] = static_cast<unsigned char>((b[6] & 0x0f) | 0x40);
    b[8] = static_cast<unsigned char>((b[8] & 0x3f) | 0x80);
    char out[37];
    std::snprintf(out, sizeof out,
                  "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x", b[0],
                  b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13],
                  b[14], b[15]);
    return out;
}

std::string isoUtc(int64_t utcMs) {
    int64_t s = utcMs / 1000;
    if (utcMs < 0 && utcMs % 1000 != 0) --s;
    int64_t days = s / 86400;
    int64_t rem = s % 86400;
    if (rem < 0) {
        rem += 86400;
        --days;
    }
    int64_t y = 0;
    unsigned m = 0, d = 0;
    civil(days, y, m, d);
    char buf[40];
    std::snprintf(buf, sizeof buf, "%04lld-%02u-%02uT%02u:%02u:%02uZ", static_cast<long long>(y), m,
                  d, static_cast<unsigned>(rem / 3600), static_cast<unsigned>(rem / 60 % 60),
                  static_cast<unsigned>(rem % 60));
    return buf;
}

int64_t systemWallMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

int64_t systemMonoMs() {
    struct timespec ts {};
    ::clock_gettime(CLOCK_BOOTTIME, &ts);
    return static_cast<int64_t>(ts.tv_sec) * 1000 + ts.tv_nsec / 1000000;
}

// ---------- ProjectStore ----------

struct ProjectStore::Impl {
    StoreOptions o;
    mutable std::recursive_mutex mu;
    StateStatus status = StateStatus::Missing;
    StoreState state;
    std::string reason;
    std::string baseBlock;  // an old project could not be taken into the empty store

    void log(const std::string& line) const {
        if (o.log)
            o.log(line);
        else
            std::fprintf(stderr, "project-store: %s\n", line.c_str());
    }
    int doFsync(int fd) const { return o.fsync ? o.fsync(fd) : ::fsync(fd); }
    bool syncDir(const std::string& dir, std::string& err) const {
        const int fd = ::open(dir.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
        if (fd < 0) {
            err = sysError("không mở được thư mục", dir, errno);
            return false;
        }
        const bool ok = doFsync(fd) == 0;
        if (!ok) err = sysError("fsync thư mục lỗi", dir, errno);
        ::close(fd);
        return ok;
    }
    // Temporary file in `dir`, fsync, rename onto `name`, fsync of `dir`. `renamed` tells whether
    // the new file is in place (a failed directory sync comes after it).
    bool atomicWrite(const std::string& dir, const std::string& name, const std::string& text,
                     std::string& err, bool* renamed = nullptr) const {
        if (renamed) *renamed = false;
        const std::string path = dir + "/" + name;
        std::string tmp = path + ".tmp-XXXXXX";
        const int fd = ::mkostemp(&tmp[0], O_CLOEXEC);  // mode 0600
        if (fd < 0) {
            err = sysError("không tạo được file tạm cạnh", path, errno);
            return false;
        }
        auto fail = [&](const std::string& what) {
            err = sysError(what, tmp, errno);
            ::close(fd);
            ::unlink(tmp.c_str());
            return false;
        };
        if (!writeAll(fd, text.data(), text.size())) return fail("không ghi được");
        if (doFsync(fd) != 0) return fail("fsync lỗi");
        if (::fchmod(fd, 0600) != 0) return fail("không đổi quyền được");
        if (::close(fd) != 0) {
            err = sysError("không đóng được", tmp, errno);
            ::unlink(tmp.c_str());
            return false;
        }
        if (::rename(tmp.c_str(), path.c_str()) != 0) {
            err = sysError("không đổi tên được", tmp, errno);
            ::unlink(tmp.c_str());
            return false;
        }
        if (renamed) *renamed = true;
        return syncDir(dir, err);
    }
    std::string vDir() const { return o.dir + "/v"; }
    std::string versionDir(int64_t seq) const { return vDir() + "/" + std::to_string(seq); }
    std::optional<ProjectVersion> readMeta(int64_t seq) const {
        const auto text = readSmall(versionDir(seq) + "/" + kStoreMetaFile, kStoreJsonMaxBytes);
        if (!text) return std::nullopt;
        std::string err;
        auto v = parseVersionMeta(*text, err);
        if (!v || v->seq != seq) return std::nullopt;
        return v;
    }
    bool referenced(int64_t seq) const {
        if (state.find(seq)) return true;
        if (state.pending && (state.pending->to == seq || state.pending->from == seq)) return true;
        return false;
    }
    bool writeState(const StoreState& s, std::string& err) {
        bool renamed = false;
        const bool ok = atomicWrite(o.dir, kStoreStateFile, storeStateJson(s), err, &renamed);
        if (renamed) {  // the file on disk is the new one, even when its directory sync failed
            state = s;
            status = StateStatus::Ok;
        }
        return ok;
    }
};

ProjectStore::ProjectStore(StoreOptions options) : impl_(new Impl) {
    impl_->o = std::move(options);
    impl_->o.projectBackups =
        std::clamp(impl_->o.projectBackups, kProjectBackupsMin, kProjectBackupsMax);
}
ProjectStore::~ProjectStore() = default;

const std::string& ProjectStore::dir() const { return impl_->o.dir; }
int ProjectStore::projectBackups() const { return impl_->o.projectBackups; }

bool ProjectStore::open(std::string& err) {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    if (impl_->o.dir.empty()) {
        err = "projectStoreDir trống";
        return false;
    }
    for (const std::string& d :
         {impl_->o.dir, impl_->o.dir + "/v", impl_->o.dir + "/staging", impl_->o.dir + "/ops"})
        if (!makePrivateDir(d, err)) return false;
    return true;
}

StateStatus ProjectStore::load(std::string* error) {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    impl_->state = StoreState{};
    const std::string path = impl_->o.dir + "/" + kStoreStateFile;
    struct stat64 st {};
    if (::lstat64(path.c_str(), &st) != 0 && errno == ENOENT) {
        impl_->status = StateStatus::Missing;
        return impl_->status;
    }
    std::string err;
    const auto text = readSmall(path, kStoreJsonMaxBytes);
    std::optional<StoreState> s;
    if (!text)
        err = "không đọc được " + path;
    else
        s = parseStoreState(*text, err);
    if (!s) {
        impl_->status = StateStatus::Corrupt;
        impl_->log("state.json damaged: " + err);
        if (error) *error = err;
        return impl_->status;
    }
    impl_->state = std::move(*s);
    impl_->status = StateStatus::Ok;
    return impl_->status;
}

StateStatus ProjectStore::stateStatus() const {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    return impl_->status;
}

StoreState ProjectStore::state() const {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    return impl_->status == StateStatus::Ok ? impl_->state : StoreState{};
}

std::vector<std::string> ProjectStore::cleanup() {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    std::vector<std::string> removed;
    const std::string staging = impl_->o.dir + "/staging";
    auto names = listNames(staging);
    std::sort(names.begin(), names.end());
    for (const auto& n : names) {
        removeTree(staging + "/" + n);
        removed.push_back(n);
    }
    if (impl_->status == StateStatus::Corrupt) return removed;
    for (const auto& n : listNames(impl_->vDir())) {
        const auto seq = seqName(n);
        if (!seq) {
            impl_->log("v/" + n + ": not a version, left alone");
            continue;
        }
        const bool complete = impl_->readMeta(*seq).has_value();
        if (!complete || impl_->status == StateStatus::Missing || !impl_->referenced(*seq)) {
            impl_->log("v/" + n +
                       (complete ? ": not referenced, removed" : ": incomplete, removed"));
            removeTree(impl_->versionDir(*seq));
        }
    }
    return removed;
}

void ProjectStore::removeUnreferenced() {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    if (impl_->status == StateStatus::Corrupt) return;
    for (const auto& n : listNames(impl_->vDir())) {
        const auto seq = seqName(n);
        if (seq && (impl_->status == StateStatus::Missing || !impl_->referenced(*seq)))
            removeTree(impl_->versionDir(*seq));
    }
}

std::set<int64_t> ProjectStore::completeVersions() const {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    std::set<int64_t> out;
    for (const auto& n : listNames(impl_->vDir()))
        if (const auto seq = seqName(n); seq && impl_->readMeta(*seq)) out.insert(*seq);
    return out;
}

bool ProjectStore::isComplete(int64_t seq) const { return readMeta(seq).has_value(); }

std::optional<ProjectVersion> ProjectStore::readMeta(int64_t seq) const {
    if (seq < 1) return std::nullopt;
    return impl_->readMeta(seq);
}

std::vector<VersionView> ProjectStore::versionList() const {
    const StoreState s = state();
    std::vector<VersionView> out;
    for (const auto& v : s.versions) out.push_back({v, s.active == v.seq, isComplete(v.seq)});
    return out;
}

std::string ProjectStore::versionDir(int64_t seq) const { return impl_->versionDir(seq); }
std::string ProjectStore::projectDir(int64_t seq) const {
    return versionDir(seq) + "/" + kStoreProjectDir;
}
std::string ProjectStore::packagePath(int64_t seq) const {
    return versionDir(seq) + "/" + kStorePackageFile;
}
std::string ProjectStore::stagingDir(const std::string& opId) const {
    return impl_->o.dir + "/staging/" + opId;
}

bool ProjectStore::writeState(const StoreState& s, std::string& err) {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    return impl_->writeState(s, err);
}

int ProjectStore::createStaging(const std::string& opId, std::string& err) {
    if (!validOpId(opId)) {
        err = "opId không hợp lệ";
        return -1;
    }
    const std::string dir = stagingDir(opId);
    if (::mkdir(dir.c_str(), 0700) != 0) {
        err = sysError("không tạo được vùng tạm", dir, errno);
        return -1;
    }
    const std::string pkg = dir + "/" + kStorePackageFile;
    const int fd = ::open(pkg.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0) {
        err = sysError("không tạo được", pkg, errno);
        removeTree(dir);
    }
    return fd;
}

void ProjectStore::removeStaging(const std::string& opId) {
    if (validOpId(opId)) removeTree(stagingDir(opId));
}

std::optional<int64_t> ProjectStore::commitStaging(const std::string& opId, ProjectVersion meta,
                                                   std::string& err) {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    if (!validOpId(opId)) {
        err = "opId không hợp lệ";
        return std::nullopt;
    }
    int64_t seq = impl_->status == StateStatus::Ok ? impl_->state.nextSeq : 1;
    for (const auto& n : listNames(impl_->vDir()))
        if (const auto s = seqName(n)) seq = std::max(seq, *s + 1);
    const std::string from = stagingDir(opId);
    const std::string to = impl_->versionDir(seq);
    if (::rename(from.c_str(), to.c_str()) != 0) {
        err = sysError("không chuyển được vùng tạm thành", to, errno);
        return std::nullopt;
    }
    meta.seq = seq;
    meta.activatedAt.reset();
    if (!impl_->syncDir(impl_->vDir(), err) ||
        !impl_->atomicWrite(to, kStoreMetaFile, versionMetaJson(meta), err)) {
        removeTree(to);
        return std::nullopt;
    }
    return seq;
}

void ProjectStore::removeVersion(int64_t seq) {
    if (seq >= 1) removeTree(versionDir(seq));
}

bool ProjectStore::beginActivation(const PendingOperation& p, std::string& err) {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    if (impl_->status == StateStatus::Corrupt) {
        err = "state.json hỏng";
        return false;
    }
    StoreState s = impl_->status == StateStatus::Ok ? impl_->state : StoreState{};
    s.pending = p;
    s.pending->phase = PendingPhase::Activating;
    s.pending->bootAttempts = 0;
    s.nextSeq = std::max(s.nextSeq, p.to + 1);
    return impl_->writeState(s, err);
}

bool ProjectStore::commitPending(const ProjectVersion& entry, std::string& err) {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    if (impl_->status != StateStatus::Ok || !impl_->state.pending) {
        err = "không có thao tác đang chờ";
        return false;
    }
    // The activation goes into meta.json first: if state.json is lost, the version activated last
    // is known (recoverState). A crash between the two writes leaves state.json as the truth.
    ProjectVersion meta = entry;
    meta.seq = impl_->state.pending->to;
    if (isComplete(meta.seq) &&
        !impl_->atomicWrite(versionDir(meta.seq), kStoreMetaFile, versionMetaJson(meta), err))
        return false;
    if (!impl_->writeState(stateCommitted(impl_->state, entry, impl_->o.projectBackups), err))
        return false;
    removeUnreferenced();
    return true;
}

bool ProjectStore::rollBackPending(std::string& err) {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    if (impl_->status != StateStatus::Ok || !impl_->state.pending) {
        err = "không có thao tác đang chờ";
        return false;
    }
    return impl_->writeState(stateRollingBack(impl_->state, 0), err);
}

bool ProjectStore::endPending(bool keepFrom, std::string& err) {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    if (impl_->status != StateStatus::Ok) {
        err = "state.json không đọc được";
        return false;
    }
    return impl_->writeState(stateEnded(impl_->state, keepFrom), err);
}

bool ProjectStore::writeOp(const std::string& opId, const std::string& text, std::string& err) {
    if (!validOpId(opId)) {
        err = "opId không hợp lệ";
        return false;
    }
    return impl_->atomicWrite(impl_->o.dir + "/ops", opId + ".json", text, err);
}

std::optional<std::string> ProjectStore::readOp(const std::string& opId) const {
    if (!validOpId(opId)) return std::nullopt;
    return readSmall(impl_->o.dir + "/ops/" + opId + ".json", kStoreJsonMaxBytes);
}

void ProjectStore::removeOp(const std::string& opId) {
    if (validOpId(opId)) ::unlink((impl_->o.dir + "/ops/" + opId + ".json").c_str());
}

std::vector<std::string> ProjectStore::opIds() const {
    std::vector<std::string> out;
    for (const auto& n : listNames(impl_->o.dir + "/ops")) {
        if (n.size() != 41 || n.compare(36, 5, ".json") != 0) continue;
        const std::string id = n.substr(0, 36);
        if (validOpId(id)) out.push_back(id);
    }
    return out;
}

namespace {

// Copies the project files into `destDir` (made 0700): subdirectories with mkdirat on the parent's
// descriptor, files O_EXCL|O_NOFOLLOW 0600, each synced, then every directory written into.
bool copyProject(const std::string& srcDir, const std::vector<std::string>& files,
                 const std::string& destDir, const std::function<int(int)>& fsyncFn,
                 std::string& err) {
    if (::mkdir(destDir.c_str(), 0700) != 0) {
        err = sysError("không tạo được", destDir, errno);
        return false;
    }
    std::set<std::string> dirs{""};
    for (const auto& rel : files) {
        int dirFd = ::open(destDir.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        if (dirFd < 0) {
            err = sysError("không mở được", destDir, errno);
            return false;
        }
        size_t start = 0;
        std::string sub;
        bool ok = true;
        for (size_t slash; (slash = rel.find('/', start)) != std::string::npos; start = slash + 1) {
            const std::string seg = rel.substr(start, slash - start);
            sub += (sub.empty() ? "" : "/") + seg;
            if (::mkdirat(dirFd, seg.c_str(), 0700) != 0 && errno != EEXIST) ok = false;
            const int next =
                ok ? ::openat(dirFd, seg.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                   : -1;
            ::close(dirFd);
            dirFd = next;
            if (dirFd < 0) {
                err = sysError("không tạo được thư mục", destDir + "/" + sub, errno);
                return false;
            }
            dirs.insert(sub);
        }
        const std::string name = rel.substr(start);
        const std::string srcPath = srcDir + "/" + rel;
        const int in = ::open(srcPath.c_str(), O_RDONLY | O_CLOEXEC);
        struct stat64 st {};
        if (in < 0 || ::fstat64(in, &st) != 0 || !S_ISREG(st.st_mode)) {
            err = sysError("không đọc được file", srcPath, in < 0 ? errno : EINVAL);
            if (in >= 0) ::close(in);
            ::close(dirFd);
            return false;
        }
        const int out = ::openat(dirFd, name.c_str(),
                                 O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
        ::close(dirFd);
        if (out < 0) {
            err = sysError("không tạo được", destDir + "/" + rel, errno);
            ::close(in);
            return false;
        }
        char buf[65536];
        for (;;) {
            const ssize_t n = ::read(in, buf, sizeof buf);
            if (n < 0 && errno == EINTR) continue;
            if (n < 0 || (n > 0 && !writeAll(out, buf, static_cast<size_t>(n)))) {
                ok = false;
                break;
            }
            if (n == 0) break;
        }
        if (ok && fsyncFn(out) != 0) ok = false;
        if (!ok) err = sysError("không chép được", rel, errno);
        ::close(in);
        ::close(out);
        if (!ok) return false;
    }
    for (auto it = dirs.rbegin(); it != dirs.rend(); ++it) {  // deepest first, then the root
        const std::string d = it->empty() ? destDir : destDir + "/" + *it;
        const int fd = ::open(d.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
        const bool ok = fd >= 0 && fsyncFn(fd) == 0;
        if (fd >= 0) ::close(fd);
        if (!ok) {
            err = sysError("fsync thư mục lỗi", d, errno);
            return false;
        }
    }
    return true;
}

}  // namespace

AdoptResult ProjectStore::adopt(const LegacyProject& legacy, const PackFn& pack,
                                const StoreAuditFn& audit) {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    AdoptResult r;
    if (impl_->status != StateStatus::Missing) {
        r.error = "kho project không trống";
        return r;
    }
    if (legacy.status != LegacyStatus::Valid || legacy.files.empty() || !pack) {
        r.error = "project cài theo cách cũ không hợp lệ";
        return r;
    }
    for (const auto& f : legacy.files) {
        if (!safeRelPath(f)) {
            r.error = "đường dẫn không an toàn trong project cũ: " + f;
            return r;
        }
    }
    const std::string id = newOpId();
    const std::string staging = stagingDir(id);
    auto fail = [&](const std::string& why) {
        removeTree(staging);
        r.error = why;
        impl_->log("adopt: " + why);
        return r;
    };
    if (::mkdir(staging.c_str(), 0700) != 0)
        return fail(sysError("không tạo được vùng tạm", staging, errno));
    const std::string projectCopy = staging + "/" + kStoreProjectDir;
    std::string err;
    const std::function<int(int)> fsyncFn = [this](int fd) { return impl_->doFsync(fd); };
    if (!copyProject(legacy.dir, legacy.files, projectCopy, fsyncFn, err))
        return fail("không chép được project cũ: " + err);

    const std::string pkg = staging + "/" + kStorePackageFile;
    const int fd = ::open(pkg.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0) return fail(sysError("không tạo được", pkg, errno));
    const PackResult packed = pack(projectCopy, legacy.files, fd);
    const bool synced = packed.ok && impl_->doFsync(fd) == 0;
    ::close(fd);
    if (!packed.ok) return fail("không đóng gói được project cũ: " + packed.error);
    if (!synced) return fail(sysError("fsync lỗi", pkg, errno));

    const int64_t now = wallMs();
    ProjectVersion meta;
    meta.digest = packed.digest;
    meta.projectId = legacy.projectId;
    meta.projectName = legacy.projectName;
    meta.projectVersion = legacy.projectVersion;
    meta.minRuntimeVersion = legacy.minRuntimeVersion;
    meta.size = static_cast<int64_t>(packed.bytes);
    meta.clockOk = clockSynced(now);
    meta.source = VersionSource::RuntimePackage;

    auto auditEvent = [&](AuditResult result, const char* code) {
        AuditEvent e(AuditAction::ProjectAdopt, result, AuditChannel::System, "system");
        e.target = meta.digest;
        if (code) e.code = code;
        e.detail = jsonText(Json{
            {"seq", 1}, {"projectId", meta.projectId}, {"projectVersion", meta.projectVersion}});
        return e;
    };
    if (!audit) return fail("audit không ghi được: không nhận project cũ vào kho");
    try {
        audit(auditEvent(AuditResult::Ok, nullptr));
    } catch (const std::exception& e) {
        return fail(std::string("audit không ghi được: ") + e.what());
    }
    const auto seq = commitStaging(id, meta, err);
    auto failedAfterAudit = [&](const std::string& why) {
        try {
            audit(auditEvent(AuditResult::Failed, "STORE_IO"));
        } catch (const std::exception&) {
        }
        return fail(why);
    };
    if (!seq) return failedAfterAudit("không lưu được bản 1: " + err);
    StoreState s;
    ProjectVersion entry = meta;
    entry.seq = *seq;
    entry.activatedAt = isoUtc(now);
    s.active = *seq;
    s.nextSeq = *seq + 1;
    s.versions = {entry};
    // meta.json records the activation too (recoverState reads it).
    if (!impl_->atomicWrite(impl_->versionDir(*seq), kStoreMetaFile, versionMetaJson(entry), err)) {
        removeTree(impl_->versionDir(*seq));
        return failedAfterAudit("không ghi được meta.json: " + err);
    }
    bool renamed = false;
    if (!impl_->atomicWrite(impl_->o.dir, kStoreStateFile, storeStateJson(s), err, &renamed)) {
        if (renamed) ::unlink((impl_->o.dir + "/" + kStoreStateFile).c_str());
        removeTree(impl_->versionDir(*seq));
        return failedAfterAudit("không ghi được state.json: " + err);
    }
    impl_->state = s;
    impl_->status = StateStatus::Ok;
    impl_->reason.clear();
    impl_->baseBlock.clear();
    r.ok = true;
    r.seq = *seq;
    return r;
}

RecoverResult ProjectStore::recoverState(int64_t monoMs, const StoreAuditFn& audit) {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    RecoverResult r;
    if (impl_->status != StateStatus::Corrupt) {
        r.error = "state.json không hỏng";
        return r;
    }
    // The versions on disk, newest seq first; every v/ directory counts for nextSeq.
    std::vector<ProjectVersion> found;
    int64_t highestDir = 0;
    for (const auto& n : listNames(impl_->vDir())) {
        const auto seq = seqName(n);
        if (!seq) continue;
        highestDir = std::max(highestDir, *seq);
        if (auto m = impl_->readMeta(*seq)) found.push_back(std::move(*m));
    }
    std::sort(found.begin(), found.end(),
              [](const ProjectVersion& a, const ProjectVersion& b) { return a.seq > b.seq; });
    // The version activated last runs (the same time: the higher seq, which comes first).
    size_t best = found.size();
    for (size_t i = 0; i < found.size(); ++i)
        if (found[i].activatedAt &&
            (best == found.size() || *found[i].activatedAt > *found[best].activatedAt))
            best = i;
    StoreState s;
    s.nextSeq = highestDir + 1;
    if (best < found.size()) {
        s.active = found[best].seq;
        s.versions.push_back(found[best]);
    }
    for (size_t i = 0; i < found.size(); ++i)
        if (i != best) s.versions.push_back(found[i]);

    // The audit row comes before any change.
    if (!audit) {
        r.error = "audit không ghi được: không dựng lại state.json";
        return r;
    }
    AuditEvent e(AuditAction::ProjectAdopt, AuditResult::Ok, AuditChannel::System, "system");
    Json detail{{"reason", "state-corrupt"}, {"versions", s.versions.size()}};
    if (s.active) {
        e.target = found[best].digest;
        detail["seq"] = *s.active;
    }
    e.detail = jsonText(detail);
    try {
        audit(e);
    } catch (const std::exception& ex) {
        r.error = std::string("audit không ghi được: ") + ex.what();
        return r;
    }

    const std::string statePath = impl_->o.dir + "/" + kStoreStateFile;
    const std::string corruptName =
        std::string(kStoreStateFile) + ".corrupt-" + std::to_string(monoMs);
    const std::string corruptPath = impl_->o.dir + "/" + corruptName;
    if (::rename(statePath.c_str(), corruptPath.c_str()) != 0) {
        r.error = sysError("không đổi tên được", statePath, errno);
        return r;
    }
    std::string err;
    const bool written = impl_->writeState(s, err);
    if (!written && impl_->status != StateStatus::Ok) {  // nothing in place: put the old name back
        ::rename(corruptPath.c_str(), statePath.c_str());
        r.error = "không ghi được state.json mới: " + err;
        return r;
    }
    if (!written) impl_->log("state.json rebuilt, directory sync failed: " + err);
    impl_->log("state.json damaged: kept as " + corruptName + ", rebuilt from " +
               std::to_string(s.versions.size()) + " version(s)");
    r.ok = true;
    r.active = s.active;
    r.versions = s.versions.size();
    r.corruptFile = corruptName;
    return r;
}

std::string ProjectStore::baseBlockReason() const {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    return impl_->status == StateStatus::Missing ? impl_->baseBlock : std::string();
}
void ProjectStore::setBaseBlockReason(std::string reason) {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    impl_->baseBlock = std::move(reason);
}

std::string ProjectStore::noPackageReason() const {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    return impl_->reason;
}
void ProjectStore::setNoPackageReason(std::string reason) {
    std::lock_guard<std::recursive_mutex> lock(impl_->mu);
    impl_->reason = std::move(reason);
}

int64_t ProjectStore::wallMs() const {
    return impl_->o.wallMs ? impl_->o.wallMs() : systemWallMs();
}
bool ProjectStore::clockSynced(int64_t wallMs) const {
    return impl_->o.clockSynced ? impl_->o.clockSynced(wallMs)
                                : timesyncSynchronized(kTimesyncFlag, wallMs);
}

}  // namespace mat
