#include "core/auth/account_store.hpp"

#include <fcntl.h>
#include <grp.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <set>
#include <utility>

#include "nlohmann/json.hpp"

namespace mat {

namespace {

struct FileText {
    UsersStatus status = UsersStatus::Ok;
    std::string text;
    std::string error;
};

std::string modeText(mode_t m) {
    char buf[8];
    std::snprintf(buf, sizeof buf, "%04o", static_cast<unsigned>(m & 07777));
    return buf;
}

FileText readSmallFile(const std::string& path, bool enforceMode) {
    FileText r;
    auto fail = [&](const std::string& why) {
        r.status = UsersStatus::Error;
        r.error = why;
        r.text.clear();
        return r;
    };
    // O_NONBLOCK: a FIFO in its place cannot hang the open.
    const int fd = ::open(path.c_str(), O_RDONLY | O_CLOEXEC | O_NONBLOCK);
    if (fd < 0) {
        if (errno == ENOENT) {
            r.status = UsersStatus::Missing;
            return r;
        }
        return fail(std::string("cannot open: ") + std::strerror(errno));
    }
    struct stat st {};
    if (::fstat(fd, &st) != 0 || !S_ISREG(st.st_mode)) {
        ::close(fd);
        return fail("not a regular file");
    }
    if (enforceMode && (st.st_mode & 0007) != 0) {
        ::close(fd);
        return fail("others may read or write it (mode " + modeText(st.st_mode) +
                    "), so it is not used; it must be 0640 root:matscada");
    }
    if (st.st_size > static_cast<off_t>(kUsersFileMaxBytes)) {
        ::close(fd);
        return fail("larger than 256 KB");
    }
    char buf[4096];
    ssize_t n;
    while ((n = ::read(fd, buf, sizeof buf)) != 0) {
        if (n < 0) {
            if (errno == EINTR) continue;
            break;
        }
        r.text.append(buf, static_cast<size_t>(n));
        if (r.text.size() > kUsersFileMaxBytes) break;
    }
    const int readErrno = errno;
    ::close(fd);
    if (n < 0) return fail(std::string("cannot read: ") + std::strerror(readErrno));
    if (r.text.size() > kUsersFileMaxBytes) return fail("larger than 256 KB");
    return r;
}

// SemVer 1.<minor>.<patch>, numbers without leading zero.
bool majorOne(const std::string& v) {
    if (v.compare(0, 2, "1.") != 0) return false;
    size_t i = 2;
    for (int part = 0; part < 2; ++part) {
        const size_t start = i;
        while (i < v.size() && v[i] >= '0' && v[i] <= '9') ++i;
        if (i == start || (i - start > 1 && v[start] == '0') || i - start > 9) return false;
        if (part == 0) {
            if (i >= v.size() || v[i] != '.') return false;
            ++i;
        }
    }
    return i == v.size();
}

bool nonNegativeInt(const nlohmann::json& j, int64_t& out) {
    if (j.is_number_unsigned()) {
        const uint64_t v = j.get<uint64_t>();
        if (v > static_cast<uint64_t>(INT64_MAX)) return false;
        out = static_cast<int64_t>(v);
        return true;
    }
    if (j.is_number_integer()) {
        const int64_t v = j.get<int64_t>();
        if (v < 0) return false;
        out = v;
        return true;
    }
    return false;
}

const nlohmann::json* member(const nlohmann::json& obj, const char* key) {
    const auto it = obj.find(key);
    return it == obj.end() ? nullptr : &*it;
}

std::string sysError(const std::string& what, const std::string& file) {
    return what + " " + file + ": " + std::strerror(errno);
}

// The change may not leave the file without an enabled administrator when it had one.
AccountEditError commitKeepingAnAdministrator(UsersFile& f, UsersFile changed) {
    if (hasEnabledAdministrator(f) && !hasEnabledAdministrator(changed))
        return AccountEditError::LastAdministrator;
    f = std::move(changed);
    return AccountEditError::None;
}

}  // namespace

bool validAccountName(std::string_view name) {
    if (name.size() < 3 || name.size() > 32) return false;
    if (name[0] < 'a' || name[0] > 'z') return false;
    for (const char c : name.substr(1)) {
        const bool ok =
            (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-';
        if (!ok) return false;
    }
    return true;
}

const Account* UsersFile::find(std::string_view name) const {
    for (const auto& a : users)
        if (a.name == name) return &a;
    return nullptr;
}

Account* UsersFile::find(std::string_view name) {
    for (auto& a : users)
        if (a.name == name) return &a;
    return nullptr;
}

UsersRead parseUsers(std::string_view text) {
    UsersRead r;
    auto fail = [&](const std::string& why) {
        UsersRead e;
        e.status = UsersStatus::Error;
        e.error = why;
        return e;
    };
    const auto doc = nlohmann::json::parse(text.begin(), text.end(), nullptr, false);
    if (doc.is_discarded()) return fail("not valid JSON");
    if (!doc.is_object()) return fail("not a JSON object");
    const nlohmann::json* sv = member(doc, "schemaVersion");
    if (!sv || !sv->is_string()) return fail("no schemaVersion");
    if (!majorOne(sv->get<std::string>())) return fail("schemaVersion is not 1.x.y");
    const nlohmann::json* users = member(doc, "users");
    if (!users || !users->is_array()) return fail("no users array");
    if (users->size() > kMaxAccounts) return fail("more than 64 accounts");
    std::set<std::string> names;
    for (size_t i = 0; i < users->size(); ++i) {
        const nlohmann::json& u = (*users)[i];
        const std::string at = "account " + std::to_string(i + 1);
        if (!u.is_object()) return fail(at + ": not an object");
        Account a;
        const nlohmann::json* name = member(u, "name");
        if (!name || !name->is_string()) return fail(at + ": no name");
        a.name = name->get<std::string>();
        if (!validAccountName(a.name))
            return fail(at + ": the name does not match ^[a-z][a-z0-9._-]{2,31}$");
        if (!names.insert(a.name).second) return fail(at + ": " + a.name + " is there twice");
        const std::string who = at + " (" + a.name + ")";
        const nlohmann::json* role = member(u, "role");
        const auto parsedRole =
            role && role->is_string() ? parseRole(role->get<std::string>()) : std::nullopt;
        if (!parsedRole)
            return fail(who + ": role is not viewer, operator, engineer or administrator");
        a.role = *parsedRole;
        const nlohmann::json* enabled = member(u, "enabled");
        if (!enabled || !enabled->is_boolean()) return fail(who + ": enabled is not true or false");
        a.enabled = enabled->get<bool>();
        const nlohmann::json* phc = member(u, "passwordHash");
        if (!phc || !phc->is_string()) return fail(who + ": no passwordHash text");
        a.passwordHash = phc->get<std::string>();
        const nlohmann::json* rev = member(u, "rev");
        if (!rev || !nonNegativeInt(*rev, a.rev)) return fail(who + ": rev is not an integer >= 0");
        const nlohmann::json* unlock = member(u, "unlockSeq");
        if (!unlock || !nonNegativeInt(*unlock, a.unlockSeq))
            return fail(who + ": unlockSeq is not an integer >= 0");
        const nlohmann::json* created = member(u, "createdAt");
        const nlohmann::json* updated = member(u, "updatedAt");
        if (!created || !created->is_string() || !updated || !updated->is_string())
            return fail(who + ": createdAt or updatedAt is not text");
        a.createdAt = created->get<std::string>();
        a.updatedAt = updated->get<std::string>();
        std::string why;
        a.hash = parsePhc(a.passwordHash, &why);
        if (!a.hash) r.damaged.push_back(a.name + ": " + why);
        r.file.users.push_back(std::move(a));
    }
    r.file.schemaVersion = sv->get<std::string>();
    r.status = UsersStatus::Ok;
    return r;
}

UsersRead readUsersFile(const std::string& path, bool enforceMode) {
    const FileText f = readSmallFile(path, enforceMode);
    if (f.status != UsersStatus::Ok) {
        UsersRead r;
        r.status = f.status;
        if (!f.error.empty()) r.error = path + ": " + f.error;
        return r;
    }
    UsersRead r = parseUsers(f.text);
    if (r.status == UsersStatus::Error) r.error = path + ": " + r.error;
    return r;
}

std::string usersJson(const UsersFile& f) {
    nlohmann::ordered_json users = nlohmann::ordered_json::array();
    for (const auto& a : f.users)
        users.push_back({{"name", a.name},
                         {"role", roleName(a.role)},
                         {"enabled", a.enabled},
                         {"passwordHash", a.passwordHash},
                         {"rev", a.rev},
                         {"unlockSeq", a.unlockSeq},
                         {"createdAt", a.createdAt},
                         {"updatedAt", a.updatedAt}});
    nlohmann::ordered_json doc;
    doc["schemaVersion"] = f.schemaVersion;
    doc["users"] = std::move(users);
    return doc.dump(2) + "\n";
}

bool writeUsersFile(const std::string& path, const UsersFile& f, std::string& err,
                    std::string* warning, const UsersWriteOptions& opts) {
    const std::string text = usersJson(f);
    if (text.size() > kUsersFileMaxBytes) {
        err = "file tài khoản sẽ vượt 256 KB: không ghi gì";
        return false;
    }
    std::string tmp = path + ".tmp-XXXXXX";
    const int fd = ::mkostemp(&tmp[0], O_CLOEXEC);  // mode 0600 until the chmod below
    if (fd < 0) {
        err = sysError("không tạo được file tạm cạnh", path);
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
        if (const group* g = ::getgrnam(opts.group.c_str())) {
            if (::fchown(fd, 0, g->gr_gid) != 0) return fail("không đổi chủ sở hữu được");
        } else if (warning) {
            *warning = "chưa có nhóm " + opts.group +
                       " (deploy.sh tạo khi cài lần đầu): dịch vụ "
                       "chưa đọc được " +
                       path + "; chạy lại lệnh sau khi cài";
        }
    }
    if (::fchmod(fd, 0640) != 0) return fail("không đổi quyền được");
    if (::close(fd) != 0) {
        err = sysError("không đóng được", tmp);
        ::unlink(tmp.c_str());
        return false;
    }
    if (::rename(tmp.c_str(), path.c_str()) != 0) {
        err = sysError("không đổi tên được", tmp);
        ::unlink(tmp.c_str());
        return false;
    }
    const size_t slash = path.rfind('/');
    const std::string dir =
        slash == std::string::npos ? "." : slash == 0 ? "/" : path.substr(0, slash);
    const int dfd = ::open(dir.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dfd >= 0) {  // the rename itself survives a power cut
        ::fsync(dfd);
        ::close(dfd);
    }
    return true;
}

const char* accountEditMessage(AccountEditError e) {
    switch (e) {
        case AccountEditError::None:
            return "";
        case AccountEditError::InvalidName:
            return "tên tài khoản không hợp lệ: 3–32 ký tự a-z, 0-9, '.', '_', '-', bắt đầu bằng "
                   "chữ thường";
        case AccountEditError::Exists:
            return "tài khoản đã có";
        case AccountEditError::NotFound:
            return "không có tài khoản này";
        case AccountEditError::TooMany:
            return "đã đủ 64 tài khoản";
        case AccountEditError::LastAdministrator:
            return "không được tắt, xóa hay hạ role tài khoản administrator cuối cùng còn bật";
        case AccountEditError::BadHash:
            return "chuỗi băm mật khẩu không hợp lệ";
    }
    return "";
}

bool hasEnabledAdministrator(const UsersFile& f) {
    return std::any_of(f.users.begin(), f.users.end(),
                       [](const Account& a) { return a.enabled && a.role == Role::Administrator; });
}

AccountEditError addAccount(UsersFile& f, const std::string& name, Role role,
                            const std::string& phc, const std::string& nowIso) {
    if (!validAccountName(name)) return AccountEditError::InvalidName;
    if (f.find(name)) return AccountEditError::Exists;
    if (f.users.size() >= kMaxAccounts) return AccountEditError::TooMany;
    Account a;
    a.hash = parsePhc(phc);
    if (!a.hash) return AccountEditError::BadHash;
    a.name = name;
    a.role = role;
    a.enabled = true;
    a.passwordHash = phc;
    a.rev = 1;
    a.unlockSeq = 0;
    a.createdAt = nowIso;
    a.updatedAt = nowIso;
    f.users.push_back(std::move(a));
    return AccountEditError::None;
}

AccountEditError setAccountPassword(UsersFile& f, const std::string& name, const std::string& phc,
                                    const std::string& nowIso) {
    Account* a = f.find(name);
    if (!a) return AccountEditError::NotFound;
    auto parsed = parsePhc(phc);
    if (!parsed) return AccountEditError::BadHash;
    a->passwordHash = phc;
    a->hash = std::move(parsed);
    a->rev += 1;
    a->updatedAt = nowIso;
    return AccountEditError::None;
}

AccountEditError setAccountRole(UsersFile& f, const std::string& name, Role role,
                                const std::string& nowIso) {
    const Account* a = f.find(name);
    if (!a) return AccountEditError::NotFound;
    if (a->role == role) return AccountEditError::None;
    UsersFile changed = f;
    Account* c = changed.find(name);
    c->role = role;
    c->rev += 1;
    c->updatedAt = nowIso;
    return commitKeepingAnAdministrator(f, std::move(changed));
}

AccountEditError setAccountEnabled(UsersFile& f, const std::string& name, bool enabled,
                                   const std::string& nowIso) {
    const Account* a = f.find(name);
    if (!a) return AccountEditError::NotFound;
    if (a->enabled == enabled) return AccountEditError::None;
    UsersFile changed = f;
    Account* c = changed.find(name);
    c->enabled = enabled;
    c->rev += 1;
    c->updatedAt = nowIso;
    return commitKeepingAnAdministrator(f, std::move(changed));
}

AccountEditError unlockAccount(UsersFile& f, const std::string& name, const std::string& nowIso) {
    Account* a = f.find(name);
    if (!a) return AccountEditError::NotFound;
    a->unlockSeq += 1;
    a->updatedAt = nowIso;
    return AccountEditError::None;
}

AccountEditError removeAccount(UsersFile& f, const std::string& name) {
    if (!f.find(name)) return AccountEditError::NotFound;
    UsersFile changed = f;
    changed.users.erase(std::remove_if(changed.users.begin(), changed.users.end(),
                                       [&](const Account& a) { return a.name == name; }),
                        changed.users.end());
    return commitKeepingAnAdministrator(f, std::move(changed));
}

// --- AccountStore

namespace {

struct Signature {
    dev_t dev = 0;
    ino_t ino = 0;
    off_t size = 0;
    mode_t mode = 0;
    struct timespec mtime {};
    struct timespec ctime {};
};

bool sameSignature(const std::optional<Signature>& a, const std::optional<Signature>& b) {
    if (a.has_value() != b.has_value()) return false;
    if (!a) return true;
    return a->dev == b->dev && a->ino == b->ino && a->size == b->size && a->mode == b->mode &&
           a->mtime.tv_sec == b->mtime.tv_sec && a->mtime.tv_nsec == b->mtime.tv_nsec &&
           a->ctime.tv_sec == b->ctime.tv_sec && a->ctime.tv_nsec == b->ctime.tv_nsec;
}

}  // namespace

struct AccountStore::Impl {
    std::string path;
    AuthLogFn log;
    bool checked = false;
    int64_t lastCheck = 0;
    std::optional<Signature> signature;  // nullopt: stat failed (no file)
    UsersStatus status = UsersStatus::Missing;
    UsersFile file;  // status Ok only
    std::string lastProblem;
    int64_t loads = 0;
};

AccountStore::AccountStore(std::string path, AuthLogFn log) : impl_(new Impl) {
    impl_->path = std::move(path);
    impl_->log = authLogOrStderr(std::move(log));
}

AccountStore::~AccountStore() = default;

AccountChanges AccountStore::refresh(int64_t nowMonoMs) {
    Impl& s = *impl_;
    if (s.checked && nowMonoMs - s.lastCheck < kUsersRecheckMs) return {};
    s.checked = true;
    s.lastCheck = nowMonoMs;
    std::optional<Signature> sig;
    struct stat st {};
    if (::stat(s.path.c_str(), &st) == 0) {
        Signature g;
        g.dev = st.st_dev;
        g.ino = st.st_ino;
        g.size = st.st_size;
        g.mode = st.st_mode;
        g.mtime = st.st_mtim;
        g.ctime = st.st_ctim;
        sig = g;
    }
    if (s.loads > 0 && sameSignature(sig, s.signature)) return {};
    s.signature = sig;
    UsersRead r = readUsersFile(s.path, true);
    ++s.loads;

    AccountChanges ch;
    if (s.status == UsersStatus::Ok) {
        for (const auto& before : s.file.users) {
            const Account* now = r.status == UsersStatus::Ok ? r.file.find(before.name) : nullptr;
            if (!now) {
                ch.revoked.push_back(before.name);
            } else if (now->rev != before.rev) {
                ch.revoked.push_back(before.name);
                ch.unlocked.push_back(before.name);
            } else if (now->unlockSeq != before.unlockSeq) {
                ch.unlocked.push_back(before.name);
            }
        }
    }

    std::string problem;
    if (r.status == UsersStatus::Error)
        problem = r.error + "; nobody can sign in";
    else if (r.status == UsersStatus::Missing)
        problem = s.path +
                  ": no account yet; create one with mat-runtime --user-add <name> --role "
                  "administrator";
    if (!problem.empty() && problem != s.lastProblem) s.log(problem);
    s.lastProblem = problem;
    for (const auto& d : r.damaged)
        s.log("account " + d + "; it cannot sign in until its password is set again");

    s.status = r.status;
    s.file = r.status == UsersStatus::Ok ? std::move(r.file) : UsersFile{};
    return ch;
}

UsersStatus AccountStore::status() const { return impl_->status; }

const Account* AccountStore::find(std::string_view name) const {
    return impl_->status == UsersStatus::Ok ? impl_->file.find(name) : nullptr;
}

size_t AccountStore::size() const {
    return impl_->status == UsersStatus::Ok ? impl_->file.users.size() : 0;
}

int64_t AccountStore::loads() const { return impl_->loads; }

const std::string& AccountStore::path() const { return impl_->path; }

}  // namespace mat
