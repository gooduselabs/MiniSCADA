#include "core/package/project_digest.hpp"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>

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

}  // namespace mat
