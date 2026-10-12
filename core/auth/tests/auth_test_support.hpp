// Helpers of the core/auth tests (feature 005, T026–T031): temporary directories and files, test
// passwords made at run time (never written to the repo), and PHC text built without the code under
// test.
#pragma once
#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include "core/auth/password_hash.hpp"
#include "core/crypto/random.hpp"
#include "core/crypto/sha256.hpp"
#include "nlohmann/json.hpp"

namespace mat::test {

class TempDir {
   public:
    TempDir() {
        char tmpl[] = "/tmp/mat-auth-test-XXXXXX";
        if (!::mkdtemp(tmpl)) throw std::runtime_error("mkdtemp");
        path_ = tmpl;
    }
    ~TempDir() { removeTree(path_); }
    TempDir(const TempDir&) = delete;
    TempDir& operator=(const TempDir&) = delete;

    const std::string& path() const { return path_; }
    std::string file(const std::string& name) const { return path_ + "/" + name; }

    std::vector<std::string> names() const {
        std::vector<std::string> out;
        if (DIR* d = ::opendir(path_.c_str())) {
            while (dirent* e = ::readdir(d)) {
                const std::string n = e->d_name;
                if (n != "." && n != "..") out.push_back(n);
            }
            ::closedir(d);
        }
        return out;
    }

   private:
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
    std::string path_;
};

inline void writeFile(const std::string& path, const std::string& text, mode_t mode = 0640) {
    {
        std::ofstream out(path, std::ios::binary | std::ios::trunc);
        out << text;
    }
    ::chmod(path.c_str(), mode);
}

inline std::string readFile(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    std::ostringstream s;
    s << in.rdbuf();
    return s.str();
}

inline bool fileExists(const std::string& path) {
    struct stat st {};
    return ::lstat(path.c_str(), &st) == 0;
}

inline mode_t fileMode(const std::string& path) {
    struct stat st {};
    return ::stat(path.c_str(), &st) == 0 ? (st.st_mode & 07777) : 0;
}

// A test password from getrandom, `chars` long: letters of both cases, digits and symbols, with at
// least one capital and one '#', so it never looks like an account name (^[a-z][a-z0-9._-]{2,31}$).
inline std::string randomPassword(size_t chars = 20) {
    static const char kSet[] = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789#%+=@!";
    const std::string bytes = randomBytes(chars);
    std::string out = "Q#";
    for (size_t i = 2; i < chars; ++i)
        out += kSet[static_cast<unsigned char>(bytes[i]) % (sizeof kSet - 1)];
    return out;
}

// Standard base64 without padding (the PHC form), written here so fixtures do not depend on
// formatPhc.
inline std::string b64(std::string_view bytes) {
    static const char kAlphabet[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    size_t i = 0;
    for (; i + 3 <= bytes.size(); i += 3) {
        const uint32_t v = uint32_t(uint8_t(bytes[i])) << 16 |
                           uint32_t(uint8_t(bytes[i + 1])) << 8 | uint8_t(bytes[i + 2]);
        for (int k = 18; k >= 0; k -= 6) out += kAlphabet[v >> k & 63];
    }
    if (bytes.size() - i == 1) {
        const uint32_t v = uint32_t(uint8_t(bytes[i])) << 16;
        out += kAlphabet[v >> 18 & 63];
        out += kAlphabet[v >> 12 & 63];
    } else if (bytes.size() - i == 2) {
        const uint32_t v = uint32_t(uint8_t(bytes[i])) << 16 | uint32_t(uint8_t(bytes[i + 1])) << 8;
        out += kAlphabet[v >> 18 & 63];
        out += kAlphabet[v >> 12 & 63];
        out += kAlphabet[v >> 6 & 63];
    }
    return out;
}

inline std::string phcText(uint32_t m, uint32_t t, uint32_t p, std::string_view salt,
                           std::string_view hash) {
    return "$argon2id$v=19$m=" + std::to_string(m) + ",t=" + std::to_string(t) +
           ",p=" + std::to_string(p) + "$" + b64(salt) + "$" + b64(hash);
}

// Stand-in for Argon2id where its cost is not the point: SHA-256(salt, 0x01, password), 32 bytes.
inline std::string fakeHash(std::string_view password, const PasswordHash& ref) {
    std::string in = ref.salt;
    in += '\x01';
    in.append(password.data(), password.size());
    const Sha256Digest d = sha256(in);
    return std::string(reinterpret_cast<const char*>(d.data()), d.size());
}

// PHC text (default parameters) that fakeHash accepts for `password`.
inline std::string fakePhc(std::string_view password) {
    PasswordHash ref;
    ref.salt = randomBytes(kSaltBytes);
    return phcText(kArgon2Default.mKiB, kArgon2Default.t, kArgon2Default.p, ref.salt,
                   fakeHash(password, ref));
}

struct TestAccount {
    std::string name;
    std::string role;
    std::string phc;
    bool enabled = true;
    int64_t rev = 1;
    int64_t unlockSeq = 0;
};

inline std::string usersText(const std::vector<TestAccount>& accounts,
                             const std::string& schemaVersion = "1.0.0") {
    nlohmann::json users = nlohmann::json::array();
    for (const auto& a : accounts)
        users.push_back({{"name", a.name},
                         {"role", a.role},
                         {"enabled", a.enabled},
                         {"passwordHash", a.phc},
                         {"rev", a.rev},
                         {"unlockSeq", a.unlockSeq},
                         {"createdAt", "2026-10-20T03:00:00Z"},
                         {"updatedAt", "2026-10-20T03:00:00Z"}});
    return nlohmann::json({{"schemaVersion", schemaVersion}, {"users", users}}).dump(2) + "\n";
}

// stderr of the process into a file while it lives: what nobody passed a log sink for.
class StderrToFile {
   public:
    explicit StderrToFile(const std::string& path) : path_(path) {
        std::fflush(stderr);
        saved_ = ::dup(2);
        const int fd = ::open(path.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
        ::dup2(fd, 2);
        ::close(fd);
    }
    ~StderrToFile() { restore(); }
    std::string text() {
        restore();
        return readFile(path_);
    }

   private:
    void restore() {
        if (saved_ < 0) return;
        std::fflush(stderr);
        ::dup2(saved_, 2);
        ::close(saved_);
        saved_ = -1;
    }
    std::string path_;
    int saved_ = -1;
};

}  // namespace mat::test
