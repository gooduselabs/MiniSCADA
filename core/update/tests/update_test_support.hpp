// Helpers of the core/update tests (feature 011 T090): the vectors of tests/update-vectors (made by
// tools/release/make-update.mjs), temporary directories, and a ustar writer for envelopes built
// in the test (written apart from the code under test).
#pragma once
#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"

namespace mat::test {

inline std::string vectorDir() { return std::string(MAT_SOURCE_DIR) + "/tests/update-vectors"; }
inline std::string vectorPath(const std::string& rel) { return vectorDir() + "/" + rel; }

inline std::string readBytes(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("cannot read " + path);
    std::ostringstream s;
    s << in.rdbuf();
    return s.str();
}
inline void writeBytes(const std::string& path, const std::string& bytes, mode_t mode = 0644) {
    {
        std::ofstream out(path, std::ios::binary | std::ios::trunc);
        out << bytes;
    }
    ::chmod(path.c_str(), mode);
}
inline bool exists(const std::string& p) {
    struct stat st {};
    return ::lstat(p.c_str(), &st) == 0;
}

inline nlohmann::json vectorCases() {
    return nlohmann::json::parse(readBytes(vectorPath("cases.json")));
}

class UpdTempDir {
   public:
    UpdTempDir() {
        char tmpl[] = "/tmp/mat-update-test-XXXXXX";
        if (!::mkdtemp(tmpl)) throw std::runtime_error("mkdtemp");
        path_ = tmpl;
    }
    ~UpdTempDir() { removeTree(path_); }
    UpdTempDir(const UpdTempDir&) = delete;
    UpdTempDir& operator=(const UpdTempDir&) = delete;
    const std::string& path() const { return path_; }
    std::string file(const std::string& name) const { return path_ + "/" + name; }
    std::string dir(const std::string& name) const {
        const std::string p = file(name);
        ::mkdir(p.c_str(), 0755);
        return p;
    }
    static void removeTree(const std::string& p) {
        struct stat st {};
        if (::lstat(p.c_str(), &st) != 0) return;
        if (S_ISDIR(st.st_mode)) {
            if (DIR* d = ::opendir(p.c_str())) {
                while (dirent* e = ::readdir(d)) {
                    const std::string n = e->d_name;
                    if (n != "." && n != "..") removeTree(p + "/" + n);
                }
                ::closedir(d);
            }
            ::rmdir(p.c_str());
        } else {
            ::unlink(p.c_str());
        }
    }

   private:
    std::string path_;
};

// One ustar header (the test's own writer). `sumDelta` spoils the checksum.
inline std::string tarHeader(const std::string& name, uint64_t size, char type = '0',
                             int sumDelta = 0, const char* magic = "ustar") {
    std::string h(512, '\0');
    std::memcpy(&h[0], name.data(), std::min<size_t>(name.size(), 100));
    std::snprintf(&h[100], 8, "%07o", 0644);
    std::snprintf(&h[108], 8, "%07o", 0);
    std::snprintf(&h[116], 8, "%07o", 0);
    std::snprintf(&h[124], 12, "%011llo", static_cast<unsigned long long>(size));
    std::snprintf(&h[136], 12, "%011o", 0);
    std::memset(&h[148], ' ', 8);
    h[156] = type;
    std::memcpy(&h[257], magic, std::strlen(magic));
    h[263] = '0';
    h[264] = '0';
    unsigned sum = 0;
    for (unsigned char c : h) sum += c;
    sum += static_cast<unsigned>(sumDelta);
    std::snprintf(&h[148], 8, "%06o", sum);
    h[155] = ' ';
    return h;
}

inline std::string tarMember(const std::string& name, const std::string& data, char type = '0') {
    std::string out = tarHeader(name, data.size(), type) + data;
    out.append((512 - data.size() % 512) % 512, '\0');
    return out;
}

inline std::string tarEnd() { return std::string(1024, '\0'); }

}  // namespace mat::test
