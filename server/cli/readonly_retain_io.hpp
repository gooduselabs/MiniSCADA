// The files of the retained store opened for reading only (--retain-dump, --check-data): every
// call that writes fails with EROFS, so RetainStore::open() (which makes a fresh store or renames a
// damaged file) changes nothing.
#pragma once
#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <string>
#include <vector>

#include "core/tag-engine/retain_store.hpp"

namespace mat {

class ReadOnlyRetainIo : public RetainIo {
   public:
    explicit ReadOnlyRetainIo(std::string dir) : dir_(std::move(dir)) {}
    bool exists(const std::string& name) override {
        struct stat st {};
        return ::stat((dir_ + "/" + name).c_str(), &st) == 0;
    }
    int64_t size(const std::string& name) override {
        struct stat st {};
        return ::stat((dir_ + "/" + name).c_str(), &st) == 0 ? static_cast<int64_t>(st.st_size)
                                                             : -1;
    }
    bool createZeroed(const std::string&, size_t) override { return refuse(); }
    bool pread(const std::string& name, size_t offset, void* buf, size_t n) override {
        const int fd = ::open((dir_ + "/" + name).c_str(), O_RDONLY | O_CLOEXEC);
        if (fd < 0) {
            error_ = std::strerror(errno);
            return false;
        }
        auto* p = static_cast<uint8_t*>(buf);
        bool ok = true;
        while (n > 0) {
            const ssize_t r = ::pread(fd, p, n, static_cast<off_t>(offset));
            if (r < 0 && errno == EINTR) continue;
            if (r <= 0) {
                error_ = r < 0 ? std::strerror(errno) : "EOF";
                ok = false;
                break;
            }
            p += r;
            offset += static_cast<size_t>(r);
            n -= static_cast<size_t>(r);
        }
        ::close(fd);
        return ok;
    }
    bool pwrite(const std::string&, size_t, const void*, size_t) override { return refuse(); }
    bool fdatasync(const std::string&) override { return refuse(); }
    bool rename(const std::string&, const std::string&) override { return refuse(); }
    bool remove(const std::string&) override { return refuse(); }
    std::vector<std::string> list() override {
        std::vector<std::string> out;
        if (DIR* d = ::opendir(dir_.c_str())) {
            while (const dirent* e = ::readdir(d)) {
                const std::string n = e->d_name;
                if (n != "." && n != "..") out.push_back(n);
            }
            ::closedir(d);
        }
        std::sort(out.begin(), out.end());
        return out;
    }
    std::string lastError() const override { return error_; }

   private:
    bool refuse() {
        error_ = "EROFS";
        return false;
    }
    std::string dir_;
    std::string error_;
};

}  // namespace mat
