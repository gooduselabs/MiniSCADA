#include "core/package/project_digest.hpp"

#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>
#include <set>

#include "core/crypto/hex.hpp"
#include "core/crypto/sha256.hpp"
#include "core/package/digest.hpp"

namespace mat {

namespace {

// SHA-256 and size of one regular file, read in blocks.
bool hashFile(const std::string& path, PackageFile& out, std::string& error) {
    const int fd = ::open(path.c_str(), O_RDONLY | O_CLOEXEC);
    if (fd < 0) {
        error = std::strerror(errno);
        return false;
    }
    struct stat st {};
    if (::fstat(fd, &st) != 0 || !S_ISREG(st.st_mode)) {
        ::close(fd);
        error = "not a regular file";
        return false;
    }
    Sha256 h;
    char buf[65536];
    int64_t size = 0;
    for (;;) {
        const ssize_t n = ::read(fd, buf, sizeof buf);
        if (n < 0 && errno == EINTR) continue;
        if (n < 0) {
            error = std::strerror(errno);
            ::close(fd);
            return false;
        }
        if (n == 0) break;
        h.update(buf, static_cast<size_t>(n));
        size += n;
    }
    ::close(fd);
    out.size = size;
    out.sha256 = toHex(h.finish());
    return true;
}

}  // namespace

std::optional<std::string> projectDirDigest(const std::string& dir,
                                            const std::vector<std::string>& files,
                                            std::string* error) {
    std::vector<PackageFile> entries;
    entries.reserve(files.size());
    for (const auto& rel : files) {
        PackageFile f;
        f.path = rel;
        std::string why;
        if (!hashFile(dir + "/" + rel, f, why)) {
            if (error) *error = rel + ": " + why;
            return std::nullopt;
        }
        entries.push_back(std::move(f));
    }
    try {
        return packageDigest(entries);
    } catch (const std::exception& ex) {  // a path the digest cannot take (validated before)
        if (error) *error = ex.what();
        return std::nullopt;
    }
}

namespace {

// Walks `dir` + "/" + `rel` without following symlinks: every entry that is not a directory goes
// to `out` (relative path), every empty directory as "<rel>/". Depth is bounded like package paths
// (8 segments); deeper directories are listed as one entry.
bool walk(const std::string& root, const std::string& rel, int depth, std::vector<std::string>& out,
          std::string& error) {
    const std::string path = rel.empty() ? root : root + "/" + rel;
    DIR* d = ::opendir(path.c_str());
    if (!d) {
        error = (rel.empty() ? path : rel) + ": " + std::strerror(errno);
        return false;
    }
    bool empty = true;
    bool ok = true;
    while (const dirent* e = ::readdir(d)) {
        const std::string n = e->d_name;
        if (n == "." || n == "..") continue;
        empty = false;
        const std::string r = rel.empty() ? n : rel + "/" + n;
        struct stat st {};
        if (::lstat((root + "/" + r).c_str(), &st) != 0) {
            out.push_back(r);
            continue;
        }
        if (S_ISDIR(st.st_mode) && depth < 8) {
            if (!walk(root, r, depth + 1, out, error)) {
                ok = false;
                break;
            }
        } else {
            out.push_back(S_ISDIR(st.st_mode) ? r + "/" : r);
        }
    }
    ::closedir(d);
    if (ok && empty && !rel.empty()) out.push_back(rel + "/");
    return ok;
}

}  // namespace

std::optional<std::vector<std::string>> projectExtraFiles(const std::string& dir,
                                                          const std::vector<std::string>& files,
                                                          std::string* error) {
    std::vector<std::string> present;
    std::string why;
    if (!walk(dir, "", 1, present, why)) {
        if (error) *error = why;
        return std::nullopt;
    }
    const std::set<std::string> project(files.begin(), files.end());
    std::set<std::string> extra;  // sorted by unsigned bytes: the UTF-8 order of the manifest
    for (auto& p : present)
        if (!project.count(p)) extra.insert(std::move(p));
    return std::vector<std::string>(extra.begin(), extra.end());
}

}  // namespace mat
