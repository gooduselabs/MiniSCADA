#include "core/auth/access_store.hpp"

#include <fcntl.h>
#include <pwd.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <vector>

namespace mat {

namespace {

std::string sysError(const std::string& what) { return what + ": " + std::strerror(errno); }

std::string modeText(mode_t m) {
    char buf[8];
    std::snprintf(buf, sizeof buf, "%04o", static_cast<unsigned>(m & 07777));
    return buf;
}

struct Owner {
    bool set = false;
    uid_t uid = 0;
    gid_t gid = 0;
};

// Run as root: the service user (when it exists) owns what is written.
Owner ownerOf(const std::string& user) {
    Owner o;
    if (::geteuid() != 0 || user.empty()) return o;
    passwd pw{};
    passwd* res = nullptr;
    std::vector<char> buf(16384);
    if (::getpwnam_r(user.c_str(), &pw, buf.data(), buf.size(), &res) == 0 && res) {
        o.set = true;
        o.uid = res->pw_uid;
        o.gid = res->pw_gid;
    }
    return o;
}

// A small regular file, not followed through a link; mode rules of readUsersFile.
bool readPrivateFile(const std::string& path, size_t maxBytes, std::string& text, bool& missing,
                     std::string& error, bool anyOwner = false) {
    missing = false;
    text.clear();
    const int fd = ::open(path.c_str(), O_RDONLY | O_CLOEXEC | O_NONBLOCK | O_NOFOLLOW);
    if (fd < 0) {
        if (errno == ENOENT) {
            missing = true;
            return false;
        }
        error = errno == ELOOP ? "a symbolic link" : sysError("cannot open");
        return false;
    }
    struct stat st {};
    if (::fstat(fd, &st) != 0 || !S_ISREG(st.st_mode)) {
        ::close(fd);
        error = "not a regular file";
        return false;
    }
    if ((st.st_mode & 0027) != 0) {
        ::close(fd);
        error = "its group may write it or others may use it (mode " + modeText(st.st_mode) +
                "); it must be 0600";
        return false;
    }
    if (!anyOwner && st.st_uid != 0 && st.st_uid != ::geteuid()) {
        ::close(fd);
        error = "owner uid " + std::to_string(st.st_uid) + " is neither root nor this process";
        return false;
    }
    if (st.st_size > static_cast<off_t>(maxBytes)) {
        ::close(fd);
        error = "larger than " + std::to_string(maxBytes / 1024) + " KiB";
        return false;
    }
    char buf[8192];
    for (;;) {
        const ssize_t n = ::read(fd, buf, sizeof buf);
        if (n < 0 && errno == EINTR) continue;
        if (n < 0) {
            error = sysError("cannot read");
            ::close(fd);
            return false;
        }
        if (n == 0) break;
        text.append(buf, static_cast<size_t>(n));
        if (text.size() > maxBytes) {
            ::close(fd);
            error = "larger than " + std::to_string(maxBytes / 1024) + " KiB";
            return false;
        }
    }
    ::close(fd);
    return true;
}

void fsyncDir(const std::string& dir) {
    const int dfd = ::open(dir.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dfd >= 0) {
        ::fsync(dfd);
        ::close(dfd);
    }
}

// Temporary file in `dir`, fsync, 0600 and the owner, the file before kept as <name>.bak (a hard
// link: readers never find the file missing), rename, fsync of the directory.
bool writePrivateFile(const std::string& dir, const std::string& name, const std::string& text,
                      const Owner& owner, std::string& err) {
    const std::string path = dir + "/" + name;
    std::string tmp = path + ".tmp-XXXXXX";
    const int fd = ::mkostemp(&tmp[0], O_CLOEXEC);  // 0600
    if (fd < 0) {
        err = sysError("không tạo được file tạm trong " + dir);
        return false;
    }
    auto fail = [&](const std::string& what) {
        err = sysError(what + " " + tmp);
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
    if (::fchmod(fd, 0600) != 0) return fail("không đổi quyền được");
    if (owner.set && ::fchown(fd, owner.uid, owner.gid) != 0)
        return fail("không đổi chủ sở hữu được");
    if (::fsync(fd) != 0) return fail("không fsync được");
    if (::close(fd) != 0) {
        err = sysError("không đóng được " + tmp);
        ::unlink(tmp.c_str());
        return false;
    }
    const std::string bak = path + ".bak";
    struct stat st {};
    if (::lstat(path.c_str(), &st) == 0 && S_ISREG(st.st_mode)) {
        ::unlink(bak.c_str());
        if (::link(path.c_str(), bak.c_str()) != 0) {
            err = sysError("không giữ được bản trước " + bak);
            ::unlink(tmp.c_str());
            return false;
        }
    }
    if (::rename(tmp.c_str(), path.c_str()) != 0) {
        err = sysError("không đổi tên được " + tmp);
        ::unlink(tmp.c_str());
        return false;
    }
    fsyncDir(dir);
    return true;
}

// An exclusive flock on the directory, released when the object goes.
class DirLock {
   public:
    explicit DirLock(const std::string& dir) {
        fd_ = ::open(dir.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
        if (fd_ < 0) {
            error_ = sysError("không mở được thư mục " + dir);
            return;
        }
        while (::flock(fd_, LOCK_EX) != 0) {
            if (errno == EINTR) continue;
            error_ = sysError("không khóa được thư mục " + dir);
            ::close(fd_);
            fd_ = -1;
            return;
        }
    }
    ~DirLock() {
        if (fd_ >= 0) ::close(fd_);
    }
    DirLock(const DirLock&) = delete;
    DirLock& operator=(const DirLock&) = delete;
    bool held() const { return fd_ >= 0; }
    const std::string& error() const { return error_; }

   private:
    int fd_ = -1;
    std::string error_;
};

}  // namespace

AuthFiles readAuthFiles(const std::string& usersPath, const std::string& accessPath,
                        bool deviceCommand) {
    AuthFiles f;
    f.users = readUsersFile(usersPath, !deviceCommand);
    std::string text, error;
    bool missing = false;
    if (readPrivateFile(accessPath, kAccessFileMaxBytes, text, missing, error, deviceCommand)) {
        AccessParse p = parseAccessFile(text);
        if (p.ok) {
            f.accessState = AccessFileState::Ok;
            f.access = std::move(p.file);
        } else {
            f.accessState = AccessFileState::Invalid;
            f.accessError = accessPath + ": " + p.error;
        }
    } else if (missing) {
        f.accessState = AccessFileState::Missing;
    } else {
        f.accessState = AccessFileState::Invalid;
        f.accessError = accessPath + ": " + error;
    }
    return f;
}

struct AuthStore::Impl {
    AuthStoreOptions o;
    Owner owner;
};

AuthStore::AuthStore(AuthStoreOptions options) : impl_(new Impl) {
    impl_->o = std::move(options);
    impl_->owner = ownerOf(impl_->o.ownerUser);
}

AuthStore::~AuthStore() = default;

const std::string& AuthStore::dir() const { return impl_->o.dir; }
std::string AuthStore::usersPath() const { return impl_->o.dir + "/" + kAuthUsersFile; }
std::string AuthStore::accessPath() const { return impl_->o.dir + "/" + kAuthAccessFile; }

bool AuthStore::prepare(std::string& err, bool* migrated, std::string* seedError) {
    if (migrated) *migrated = false;
    const std::string& dir = impl_->o.dir;
    struct stat st {};
    if (::lstat(dir.c_str(), &st) != 0) {
        if (errno != ENOENT) {
            err = sysError("không đọc được thư mục " + dir);
            return false;
        }
        if (::mkdir(dir.c_str(), 0700) != 0 && errno != EEXIST) {
            err = sysError("không tạo được thư mục " + dir);
            return false;
        }
        ::chmod(dir.c_str(), 0700);
        if (impl_->owner.set && ::chown(dir.c_str(), impl_->owner.uid, impl_->owner.gid) != 0) {
            err = sysError("không đổi chủ sở hữu được " + dir);
            return false;
        }
        if (::lstat(dir.c_str(), &st) != 0) {
            err = sysError("không đọc được thư mục " + dir);
            return false;
        }
    }
    if (S_ISLNK(st.st_mode) || !S_ISDIR(st.st_mode)) {
        err = dir + " không phải thư mục (liên kết hoặc file): không dùng";
        return false;
    }
    if ((st.st_mode & 0022) != 0) {
        err = dir + " cho nhóm hoặc người khác ghi (mode " + modeText(st.st_mode) +
              "): không dùng, phải là 0700";
        return false;
    }
    if (impl_->o.seedUsersFile.empty()) return true;
    DirLock lock(dir);  // two first starts at once copy the seed once
    if (!lock.held()) {
        err = lock.error();
        return false;
    }
    struct stat ust {};
    if (::lstat(usersPath().c_str(), &ust) == 0) return true;  // made already: the seed is done
    const UsersRead seed = readUsersFile(impl_->o.seedUsersFile, true);
    if (seed.status == UsersStatus::Missing) return true;
    if (seed.status == UsersStatus::Error) {
        if (seedError) *seedError = seed.error;
        return true;
    }
    UsersFile f = seed.file;
    f.schemaVersion = kUsersSchemaVersion;
    f.rev = 1;
    if (!writePrivateFile(dir, kAuthUsersFile, usersJson(f), impl_->owner, err)) return false;
    if (migrated) *migrated = true;
    return true;
}

AuthFiles AuthStore::read() const {
    return readAuthFiles(usersPath(), accessPath(), impl_->o.deviceCommand);
}

TxnStatus AuthStore::transact(const std::function<bool(AuthTxn&)>& edit, std::string& err) {
    if (!prepare(err)) return TxnStatus::Failed;
    DirLock lock(impl_->o.dir);
    if (!lock.held()) {
        err = lock.error();
        return TxnStatus::Failed;
    }
    AuthTxn t;
    t.before = read();
    if (t.before.users.status == UsersStatus::Ok) t.users = t.before.users.file;
    if (t.before.accessState == AccessFileState::Ok) t.access = t.before.access;
    if (!edit(t)) return TxnStatus::Aborted;
    if (t.usersChanged) {
        t.users.schemaVersion = kUsersSchemaVersion;
        if (!t.keepUsersRev) t.users.rev = t.before.users.file.rev + 1;
        const std::string text = usersJson(t.users);
        if (text.size() > kUsersFileMaxBytes) {
            err = "file tài khoản sẽ vượt 512 KB: không ghi gì";
            return TxnStatus::Failed;
        }
        if (!writePrivateFile(impl_->o.dir, kAuthUsersFile, text, impl_->owner, err))
            return TxnStatus::Failed;
    }
    if (t.accessChanged) {
        t.access.schemaVersion = kAccessSchemaVersion;
        t.access.rev = t.before.access.rev + 1;
        const std::string text = accessFileJson(t.access);
        if (text.size() > kAccessFileMaxBytes) {
            err = "access.json sẽ vượt 2 MiB: không ghi gì";
            return TxnStatus::Failed;
        }
        if (!writePrivateFile(impl_->o.dir, kAuthAccessFile, text, impl_->owner, err))
            return TxnStatus::Failed;
    }
    return TxnStatus::Ok;
}

bool AuthStore::restoreAccessBackup(std::string& err, int64_t* rev) {
    if (!prepare(err)) return false;
    DirLock lock(impl_->o.dir);
    if (!lock.held()) {
        err = lock.error();
        return false;
    }
    std::string text, error;
    bool missing = false;
    if (!readPrivateFile(accessPath() + ".bak", kAccessFileMaxBytes, text, missing, error,
                         impl_->o.deviceCommand)) {
        err = missing ? "không có bản trước (access.json.bak)" : "access.json.bak: " + error;
        return false;
    }
    AccessParse p = parseAccessFile(text);
    if (!p.ok) {
        err = "access.json.bak không hợp lệ: " + p.error;
        return false;
    }
    // Past the rev of the file that replaced the backup (at least its rev + 1), so that a request
    // made on the damaged file or the one before it is a conflict.
    int64_t next = p.file.rev + 2;
    std::string current;
    if (readPrivateFile(accessPath(), kAccessFileMaxBytes, current, missing, error,
                        impl_->o.deviceCommand)) {
        const AccessParse now = parseAccessFile(current);
        if (now.ok) next = std::max(next, now.file.rev + 1);
    }
    p.file.rev = next;
    // The damaged file is not kept as the backup: the good copy stays .bak as well.
    if (!writePrivateFile(impl_->o.dir, kAuthAccessFile, accessFileJson(p.file), impl_->owner, err))
        return false;
    const std::string bak = accessPath() + ".bak";
    ::unlink(bak.c_str());
    if (::link(accessPath().c_str(), bak.c_str()) != 0) {
        // the restore itself is done; only the second copy is missing
    }
    if (rev) *rev = next;
    return true;
}

// --- AccessStoreView

AccessStoreView::AccessStoreView(std::string path) : path_(std::move(path)) {}

void AccessStoreView::recheckNow() { checked_ = false; }

bool AccessStoreView::refresh(int64_t nowMonoMs) {
    if (checked_ && nowMonoMs - lastCheck_ < kAccessRecheckMs) return false;
    checked_ = true;
    lastCheck_ = nowMonoMs;
    std::string sig = "none";
    struct stat st {};
    if (::lstat(path_.c_str(), &st) == 0)
        sig = std::to_string(st.st_dev) + ":" + std::to_string(st.st_ino) + ":" +
              std::to_string(st.st_size) + ":" + std::to_string(st.st_mode) + ":" +
              std::to_string(st.st_mtim.tv_sec) + "." + std::to_string(st.st_mtim.tv_nsec) + ":" +
              std::to_string(st.st_ctim.tv_sec) + "." + std::to_string(st.st_ctim.tv_nsec);
    if (loads_ > 0 && sig == signature_) return false;
    signature_ = sig;
    ++loads_;
    std::string text, error;
    bool missing = false;
    file_ = AccessFile{};
    error_.clear();
    if (readPrivateFile(path_, kAccessFileMaxBytes, text, missing, error)) {
        AccessParse p = parseAccessFile(text);
        if (p.ok) {
            state_ = AccessFileState::Ok;
            file_ = std::move(p.file);
        } else {
            state_ = AccessFileState::Invalid;
            error_ = path_ + ": " + p.error;
        }
    } else if (missing) {
        state_ = AccessFileState::Missing;
    } else {
        state_ = AccessFileState::Invalid;
        error_ = path_ + ": " + error;
    }
    return true;
}

}  // namespace mat
