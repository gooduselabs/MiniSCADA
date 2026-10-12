#include "core/package/extract.hpp"

#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <set>
#include <vector>

namespace mat {

namespace {

bool defaultFreeBytes(int dirFd, uint64_t& freeBytes) {
    struct statvfs st {};
    if (::fstatvfs(dirFd, &st) != 0) return false;
    freeBytes = static_cast<uint64_t>(st.f_bavail) * static_cast<uint64_t>(st.f_frsize);
    return true;
}

PackageError storeIo(const std::string& path, const std::string& what, int err) {
    return {"STORE_IO", path, what + ": " + std::strerror(err)};
}

bool noSpace(int err) { return err == ENOSPC || err == EDQUOT; }

// Removes everything under dirFd without following symlinks (unlinkat removes a link, never its
// target). Best effort: used to clean up after a failure.
void removeContents(int dirFd) {
    const int dup = ::dup(dirFd);
    if (dup < 0) return;
    DIR* d = ::fdopendir(dup);
    if (!d) {
        ::close(dup);
        return;
    }
    std::vector<std::string> names;
    // readdir64: the 32-bit readdir fails with EOVERFLOW on 64-bit directory offsets (armhf under
    // qemu-user, as in project_validator.cpp).
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

// Writes the project files under one directory descriptor (stage 5 of checkPackage).
class DiskSink final : public PackageEntrySink {
   public:
    DiskSink(int rootFd, const ExtractOptions& o) : root_(rootFd), o_(o) {}
    ~DiskSink() override { closeCached(); }

    bool onFile(const std::string& path, std::string_view bytes, PackageError& error) override {
        const size_t slash = path.rfind('/');
        const std::string dir = slash == std::string::npos ? "" : path.substr(0, slash);
        const std::string name = slash == std::string::npos ? path : path.substr(slash + 1);
        const int dirFd = openDir(dir, path, error);
        if (dirFd < 0) return false;
        uint64_t free = 0;
        if (!o_.freeBytes(dirFd, free)) {
            error = storeIo(path, "không đọc được chỗ trống", errno);
            return false;
        }
        if (free < o_.minFreeBytes || free - o_.minFreeBytes < bytes.size()) {
            error = {"NO_SPACE", path, "Không đủ chỗ trống: phải còn ít nhất historianMinFreeMB"};
            return false;
        }
        const int fd = ::openat(dirFd, name.c_str(),
                                O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
        if (fd < 0) {
            error = noSpace(errno) ? PackageError{"NO_SPACE", path, "Hết chỗ khi tạo file"}
                                   : storeIo(path, "không tạo được file", errno);
            return false;
        }
        bool ok = writeAll(fd, bytes, path, error);
        if (ok && o_.fsync(fd) != 0) {
            error = noSpace(errno) ? PackageError{"NO_SPACE", path, "Hết chỗ khi ghi file"}
                                   : storeIo(path, "fsync lỗi", errno);
            ok = false;
        }
        if (::close(fd) != 0 && ok) {
            error = storeIo(path, "đóng file lỗi", errno);
            ok = false;
        }
        written_.insert(dir);
        return ok;
    }

    // fsync of every directory written into, deepest first; "" is the root.
    bool syncDirectories(PackageError& error) {
        closeCached();
        std::vector<std::string> dirs(written_.begin(), written_.end());
        // Every ancestor of a written directory got an entry too (the subdirectory).
        for (const auto& d : written_)
            for (size_t at = d.find('/'); at != std::string::npos; at = d.find('/', at + 1))
                dirs.push_back(d.substr(0, at));
        dirs.push_back("");
        std::sort(dirs.begin(), dirs.end());
        dirs.erase(std::unique(dirs.begin(), dirs.end()), dirs.end());
        std::stable_sort(dirs.begin(), dirs.end(), [](const std::string& a, const std::string& b) {
            return depth(a) > depth(b);
        });
        for (const auto& d : dirs) {
            const int fd = d.empty() ? ::dup(root_) : walk(d);
            if (fd < 0 || o_.fsync(fd) != 0) {
                error = storeIo(d, "fsync thư mục lỗi", errno);
                if (fd >= 0) ::close(fd);
                return false;
            }
            ::close(fd);
        }
        return true;
    }

   private:
    static int depth(const std::string& d) {
        return d.empty() ? 0 : 1 + static_cast<int>(std::count(d.begin(), d.end(), '/'));
    }

    bool writeAll(int fd, std::string_view bytes, const std::string& path, PackageError& error) {
        const char* p = bytes.data();
        size_t left = bytes.size();
        while (left > 0) {
            const ssize_t n = ::write(fd, p, left);
            if (n < 0 && errno == EINTR) continue;
            if (n <= 0) {
                error = noSpace(errno) ? PackageError{"NO_SPACE", path, "Hết chỗ khi ghi file"}
                                       : storeIo(path, "ghi file lỗi", errno);
                return false;
            }
            p += n;
            left -= static_cast<size_t>(n);
        }
        return true;
    }

    // Opens dir (relative to the root, "" is the root) segment by segment, never following a
    // symlink; creates missing segments (0700). The last directory stays open for the next file.
    int openDir(const std::string& dir, const std::string& path, PackageError& error) {
        if (dir.empty()) return root_;
        if (cachedFd_ >= 0 && cachedDir_ == dir) return cachedFd_;
        closeCached();
        int fd = ::dup(root_);
        size_t start = 0;
        while (fd >= 0) {
            const size_t end = std::min(dir.find('/', start), dir.size());
            const std::string seg = dir.substr(start, end - start);
            if (::mkdirat(fd, seg.c_str(), 0700) != 0 && errno != EEXIST) {
                error = noSpace(errno) ? PackageError{"NO_SPACE", path, "Hết chỗ khi tạo thư mục"}
                                       : storeIo(path, "không tạo được thư mục", errno);
                ::close(fd);
                return -1;
            }
            const int sub =
                ::openat(fd, seg.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
            const int err = errno;
            ::close(fd);
            if (sub < 0) {
                error = storeIo(path, "không mở được thư mục (symlink hoặc file có sẵn?)", err);
                return -1;
            }
            fd = sub;
            if (end == dir.size()) break;
            start = end + 1;
        }
        if (fd < 0) {
            error = storeIo(path, "không mở được thư mục", errno);
            return -1;
        }
        cachedFd_ = fd;
        cachedDir_ = dir;
        return fd;
    }

    // An existing directory (relative to the root), opened without following symlinks.
    int walk(const std::string& dir) {
        int fd = ::dup(root_);
        size_t start = 0;
        while (fd >= 0) {
            const size_t end = std::min(dir.find('/', start), dir.size());
            const int sub = ::openat(fd, dir.substr(start, end - start).c_str(),
                                     O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
            ::close(fd);
            fd = sub;
            if (end == dir.size()) break;
            start = end + 1;
        }
        return fd;
    }

    void closeCached() {
        if (cachedFd_ >= 0) ::close(cachedFd_);
        cachedFd_ = -1;
        cachedDir_.clear();
    }

    int root_;
    const ExtractOptions& o_;
    int cachedFd_ = -1;
    std::string cachedDir_;
    std::set<std::string> written_;  // directories (relative, "" root) that received a file
};

}  // namespace

PackageCheck extractPackage(PackageSource& src, const PackageSchema& schema,
                            const std::string& destDir, const ExtractOptions& options) {
    ExtractOptions o = options;
    if (!o.freeBytes) o.freeBytes = defaultFreeBytes;
    if (!o.fsync) o.fsync = [](int fd) { return ::fsync(fd); };
    PackageCheck failure;
    failure.packageBytes = src.size();

    // The destination: made here (0700), or an existing directory that is not a symlink.
    bool created = ::mkdir(destDir.c_str(), 0700) == 0;
    if (!created && errno != EEXIST) {
        failure.error = storeIo("", "không tạo được " + destDir, errno);
        return failure;
    }
    const int rootFd = ::open(destDir.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (rootFd < 0) {
        failure.error =
            storeIo("", "không mở được " + destDir + " (symlink hoặc không phải thư mục?)", errno);
        return failure;
    }

    PackageCheck r;
    {
        DiskSink sink(rootFd, o);
        r = checkPackage(src, schema, {o.expectedDigest}, &sink);
        PackageError error;
        if (r.ok && !sink.syncDirectories(error)) {
            r.ok = false;
            r.error = std::move(error);
            r.manifest = PackageManifest{};
            r.unpackedBytes = 0;
        }
    }
    if (r.ok && created) {
        // The new directory entry of destDir in its parent.
        std::string dir = destDir;
        while (dir.size() > 1 && dir.back() == '/') dir.pop_back();
        const size_t slash = dir.find_last_of('/');
        const std::string parent =
            slash == std::string::npos ? "." : slash == 0 ? "/" : dir.substr(0, slash);
        const int pfd = ::open(parent.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
        if (pfd < 0 || o.fsync(pfd) != 0) {
            r.ok = false;
            r.error = storeIo("", "fsync thư mục cha lỗi", errno);
            r.manifest = PackageManifest{};
            r.unpackedBytes = 0;
        }
        if (pfd >= 0) ::close(pfd);
    }
    if (!r.ok) {
        removeContents(rootFd);
        ::close(rootFd);
        ::rmdir(destDir.c_str());
        return r;
    }
    ::close(rootFd);
    return r;
}

}  // namespace mat
