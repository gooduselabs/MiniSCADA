#include "server/tls/server_cert.hpp"

#include <arpa/inet.h>
#include <fcntl.h>
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/ecp.h>
#include <mbedtls/entropy.h>
#include <mbedtls/error.h>
#include <mbedtls/oid.h>
#include <mbedtls/pem.h>
#include <mbedtls/pk.h>
#include <mbedtls/platform_util.h>
#include <mbedtls/x509_crt.h>
#include <mbedtls/x509_csr.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <exception>
#include <set>

#include "core/crypto/hex.hpp"
#include "core/crypto/random.hpp"
#include "core/crypto/sha256.hpp"

namespace mat {

namespace {

constexpr const char* kTlsDir = "tls";
constexpr const char* kPemName = "server.pem";
constexpr const char* kDeviceIdName = "device-id";
constexpr off_t kMaxPemBytes = 16 * 1024;  // the runtime's own file is about 0.8 KB
constexpr off_t kMaxDeviceIdBytes = 64;
constexpr size_t kMaxCommonNameBytes = 64;  // ub-common-name (RFC 5280 appendix A)
constexpr size_t kSerialBytes = 16;
// "No well-defined expiration date" (RFC 5280 §4.1.2.5): the BL335 has no readable RTC, so a
// certificate whose validity depends on the clock could look expired or not yet valid.
constexpr const char* kNotBefore = "20000101000000";
constexpr const char* kNotAfter = "99991231235959";
constexpr const char* kCertBegin = "-----BEGIN CERTIFICATE-----\n";
constexpr const char* kCertEnd = "-----END CERTIFICATE-----\n";
// extKeyUsage = SEQUENCE { id-kp-serverAuth }, non-critical, as issuers usually write it.
constexpr unsigned char kServerAuthEku[] = {0x30, 0x0A, 0x06, 0x08, 0x2B, 0x06,
                                            0x01, 0x05, 0x05, 0x07, 0x03, 0x01};

std::string joinPath(const std::string& dir, const char* name) {
    return !dir.empty() && dir.back() == '/' ? dir + name : dir + "/" + name;
}

// `what` stays a plain pointer: no allocation runs before errno is read.
std::string sysError(const char* what, const std::string& path, int err = errno) {
    return std::string(what) + " " + path + ": " + std::strerror(err);
}

std::string tlsError(const char* what, int ret) {
    char text[160];
    mbedtls_strerror(ret, text, sizeof text);
    char code[16];
    std::snprintf(code, sizeof code, "-0x%04X", static_cast<unsigned>(-ret));
    return std::string(what) + ": " + text + " (" + code + ")";
}

std::string octal(mode_t mode) {
    char text[8];
    std::snprintf(text, sizeof text, "%04o", static_cast<unsigned>(mode & 07777));
    return text;
}

// Bytes that held a private key are cleared before they go back to the allocator.
void wipe(std::string& s) {
    if (!s.empty()) mbedtls_platform_zeroize(&s[0], s.size());
    s.clear();
}

// An open directory: checks, the lock and the *at() calls below all go through the descriptor,
// so the directory that was checked is the one written to.
struct Dir {
    Dir() = default;
    ~Dir() {
        if (fd >= 0) ::close(fd);  // also releases the lock
    }
    Dir(const Dir&) = delete;
    Dir& operator=(const Dir&) = delete;

    int fd = -1;
    std::string path;
};

// fsync of a directory makes a new entry in it survive a power cut. Best effort, like
// core/historian/secrets.cpp: some file systems refuse fsync on a directory.
void syncDir(int fd) { ::fsync(fd); }
void syncDir(const std::string& path) {
    const int fd = ::open(path.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (fd >= 0) {
        syncDir(fd);
        ::close(fd);
    }
}

// mkdir -p; new directories get 0700 (on the device systemd's StateDirectory makes dataDir).
bool makeDirs(const std::string& dir, std::string& err) {
    if (dir.empty()) {
        err = "dataDir rỗng";
        return false;
    }
    for (size_t pos = 1; pos <= dir.size(); ++pos) {
        if (pos != dir.size() && dir[pos] != '/') continue;
        const std::string part = dir.substr(0, pos);
        if (::mkdir(part.c_str(), 0700) != 0 && errno != EEXIST) {
            err = sysError("không tạo được thư mục", part);
            return false;
        }
    }
    struct stat st {};
    if (::stat(dir.c_str(), &st) != 0 || !S_ISDIR(st.st_mode)) {
        err = dir + " không phải thư mục";
        return false;
    }
    return true;
}

enum class Opened {
    Ok,
    Missing,
    Refused,  // there, but not usable as it is (type, link, permissions): never replaced by itself
    Failed,   // a system error
};

Opened openDir(const std::string& path, bool noFollow, Dir& dir, std::string& err) {
    dir.path = path;
    dir.fd = ::open(path.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | (noFollow ? O_NOFOLLOW : 0));
    if (dir.fd >= 0) return Opened::Ok;
    const int e = errno;
    if (e == ENOENT) {
        err = "chưa có " + path;
        return Opened::Missing;
    }
    if (e == ELOOP || e == ENOTDIR) {
        err = path + " không phải thư mục (hoặc là liên kết)";
        return Opened::Refused;
    }
    err = sysError("không mở được thư mục", path, e);
    return Opened::Failed;
}

// Writers of one directory take turns: a start-up and --regen-cert (or two start-ups) never
// write at the same time, and "create when missing" is decided under the lock.
bool lockDir(const Dir& dir, std::string& err) {
    while (::flock(dir.fd, LOCK_EX) != 0) {
        if (errno != EINTR) {
            err = sysError("không khóa được thư mục", dir.path);
            return false;
        }
    }
    return true;
}

enum class TlsDirUse {
    Read,        // must exist, mode & 077 == 0
    Create,      // made (with dataDir) when missing; an existing one must have mode & 077 == 0
    Regenerate,  // made when missing; an existing one gets mode 0700 again
};

// <dataDir>/tls: a directory (not a symbolic link) only its owner can use.
Opened openTlsDir(const std::string& dataDir, TlsDirUse use, Dir& dir, std::string& err) {
    const std::string path = joinPath(dataDir, kTlsDir);
    if (use != TlsDirUse::Read && !makeDirs(dataDir, err)) return Opened::Failed;
    Opened opened = openDir(path, true, dir, err);
    if (opened == Opened::Missing && use != TlsDirUse::Read) {
        if (::mkdir(path.c_str(), 0700) != 0 && errno != EEXIST) {
            err = sysError("không tạo được thư mục", path);
            return Opened::Failed;
        }
        syncDir(dataDir);
        opened = openDir(path, true, dir, err);
    }
    if (opened != Opened::Ok) return opened;
    struct stat st {};
    if (::fstat(dir.fd, &st) != 0) {
        err = sysError("không đọc được", path);
        return Opened::Failed;
    }
    if ((st.st_mode & 077) != 0) {
        if (use != TlsDirUse::Regenerate) {
            err = "thư mục " + path + " sai quyền " + octal(st.st_mode) + " (cần 0700)";
            return Opened::Refused;
        }
        if (::fchmod(dir.fd, 0700) != 0) {
            err = sysError("không đổi quyền được", path);
            return Opened::Failed;
        }
    }
    return Opened::Ok;
}

// Replaces <dir>/<name> with `data` (mode 0600 unless given): a temporary file in the same
// directory, fsync, rename, fsync of the directory. The caller holds the directory lock, so a
// temporary file found there was left by a writer that died (power cut) and is removed.
bool writeFileAt(const Dir& dir, const char* name, const std::string& data, std::string& err,
                 mode_t mode = 0600) {
    const std::string tmp = std::string(name) + ".tmp";
    const std::string tmpPath = joinPath(dir.path, tmp.c_str());
    if (::unlinkat(dir.fd, tmp.c_str(), 0) != 0 && errno != ENOENT) {
        err = sysError("không xóa được", tmpPath);
        return false;
    }
    const int fd =
        ::openat(dir.fd, tmp.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode);
    if (fd < 0) {
        err = sysError("không tạo được", tmpPath);
        return false;
    }
    const auto fail = [&](const char* what) {
        err = sysError(what, tmpPath);
        ::close(fd);
        ::unlinkat(dir.fd, tmp.c_str(), 0);
        return false;
    };
    size_t done = 0;
    while (done < data.size()) {
        const ssize_t n = ::write(fd, data.data() + done, data.size() - done);
        if (n < 0) {
            if (errno == EINTR) continue;
            return fail("không ghi được");
        }
        done += static_cast<size_t>(n);
    }
    if (::fchmod(fd, mode) != 0) return fail("không đổi quyền được");  // whatever the umask
    if (::fsync(fd) != 0) return fail("không fsync được");
    if (::close(fd) != 0) {
        err = sysError("không đóng được", tmpPath);
        ::unlinkat(dir.fd, tmp.c_str(), 0);
        return false;
    }
    if (::renameat(dir.fd, tmp.c_str(), dir.fd, name) != 0) {
        err = sysError("không đổi tên được", tmpPath);
        ::unlinkat(dir.fd, tmp.c_str(), 0);
        return false;
    }
    syncDir(dir.fd);
    return true;
}

// Reads <dir>/<name>: a regular file (a symbolic link, FIFO or directory is refused) of at most
// `maxBytes`; with `ownerOnly` also mode & 077 == 0.
Opened readFileAt(const Dir& dir, const char* name, off_t maxBytes, bool ownerOnly,
                  std::string& text, std::string& err) {
    const std::string path = joinPath(dir.path, name);
    // O_NONBLOCK: opening a FIFO does not wait for a writer.
    const int fd = ::openat(dir.fd, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) {
        const int e = errno;
        if (e == ENOENT) return Opened::Missing;
        err = e == ELOOP ? path + " là liên kết, không phải file"
                         : sysError("không đọc được", path, e);
        return e == ELOOP ? Opened::Refused : Opened::Failed;
    }
    Opened result = Opened::Refused;
    struct stat st {};
    if (::fstat(fd, &st) != 0) {
        err = sysError("không đọc được", path);
        result = Opened::Failed;
    } else if (!S_ISREG(st.st_mode)) {
        err = path + " không phải file thường";
    } else if (ownerOnly && (st.st_mode & 077) != 0) {
        err = path + " sai quyền " + octal(st.st_mode) + " (cần 0600)";
    } else if (st.st_size > maxBytes) {
        err = path + " quá lớn (" + std::to_string(st.st_size) + " byte)";
    } else {
        text.reserve(static_cast<size_t>(st.st_size) + 1);  // no reallocation: no stray copies
        char buf[1024];
        ssize_t n = 0;
        while (text.size() <= static_cast<size_t>(maxBytes)) {
            n = ::read(fd, buf, sizeof buf);
            if (n < 0 && errno == EINTR) continue;
            if (n <= 0) break;
            text.append(buf, static_cast<size_t>(n));
        }
        mbedtls_platform_zeroize(buf, sizeof buf);
        if (n < 0) {
            err = sysError("không đọc được", path);
            result = Opened::Failed;
        } else if (text.size() > static_cast<size_t>(maxBytes)) {
            err = path + " quá lớn";
        } else {
            result = Opened::Ok;
        }
    }
    ::close(fd);
    if (result != Opened::Ok) wipe(text);
    return result;
}

// A CTR-DRBG for one call, seeded from the kernel through the Mbed TLS entropy collector
// (getrandom on Linux).
class Drbg {
   public:
    Drbg() {
        mbedtls_entropy_init(&entropy_);
        mbedtls_ctr_drbg_init(&drbg_);
        static const unsigned char kPersonalization[] = "mat-server-cert";
        seed_ = mbedtls_ctr_drbg_seed(&drbg_, mbedtls_entropy_func, &entropy_, kPersonalization,
                                      sizeof kPersonalization - 1);
    }
    ~Drbg() {
        mbedtls_ctr_drbg_free(&drbg_);
        mbedtls_entropy_free(&entropy_);
    }
    Drbg(const Drbg&) = delete;
    Drbg& operator=(const Drbg&) = delete;

    int seedResult() const { return seed_; }
    static int random(void* drbg, unsigned char* out, size_t len) {
        return mbedtls_ctr_drbg_random(drbg, out, len);
    }
    void* context() { return &drbg_; }

   private:
    mbedtls_entropy_context entropy_;
    mbedtls_ctr_drbg_context drbg_;
    int seed_ = -1;
};

// A DNS host name in the preferred syntax (RFC 1034 §3.5, RFC 1123 §2.1), which a SAN dNSName
// must follow (RFC 5280 §4.2.1.6): labels of letters, digits and hyphens, 1–63 characters, no
// hyphen at either end; 253 characters at most.
bool isDnsHostname(const std::string& host) {
    if (host.empty() || host.size() > 253) return false;
    size_t start = 0;
    for (size_t i = 0; i <= host.size(); ++i) {
        if (i == host.size() || host[i] == '.') {
            const size_t len = i - start;
            if (len == 0 || len > 63 || host[start] == '-' || host[i - 1] == '-') return false;
            start = i + 1;
            continue;
        }
        const char c = host[i];
        const bool ldh =
            (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-';
        if (!ldh) return false;
    }
    return true;
}

// "CN=#0c<length><bytes>": Mbed TLS takes the hexadecimal DER of a UTF8String as it is, so no
// character of the device name needs RFC 4514 escaping (",", "+", "\", "#"…).
std::string subjectName(const std::string& commonName) {
    std::string der;
    der.push_back(static_cast<char>(MBEDTLS_ASN1_UTF8_STRING));
    der.push_back(static_cast<char>(commonName.size()));  // < 128: one length byte
    der += commonName;
    return "CN=#" + toHex(der);
}

constexpr size_t kMaxSanEntries = 16;
// First line of a server.pem that --import-cert wrote: the certificate was signed by a CA, so the
// "self-signed with that key" check of start-up does not apply to it (a damaged self-signed file
// stays recognisable: it has no marker). Text outside the PEM blocks is ignored by every reader.
constexpr const char* kImportedMarker = "# mat-runtime: certificate imported with --import-cert\n";
constexpr const char* kPendingKeyName = "pending-key.pem";
constexpr const char* kPrevName = "server.pem.prev";
constexpr const char* kNewName = "server.pem.new";

bool parseIpv4(const std::string& text, unsigned char out[4]) {
    in_addr a{};
    if (text.empty() || ::inet_pton(AF_INET, text.c_str(), &a) != 1) return false;  // no zeros
    std::memcpy(out, &a, 4);
    return true;
}

std::string ipv4Text(const unsigned char* b) {
    return std::to_string(b[0]) + "." + std::to_string(b[1]) + "." + std::to_string(b[2]) + "." +
           std::to_string(b[3]);
}

std::string lowered(std::string s) {
    for (char& c : s)
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    return s;
}

bool onlyDigitsAndDots(const std::string& s) {
    return !s.empty() && s.find_first_not_of("0123456789.") == std::string::npos;
}

// The SAN of a new certificate or request: the host name, then the addresses of the cards, then
// --san; each name once; invalid addresses of `ipAddresses` are left out; 16 entries at most.
std::vector<SanEntry> sanEntries(const ServerCertOptions& o) {
    std::vector<SanEntry> out;
    std::set<std::string> seen;
    const auto add = [&](bool ip, const std::string& text) {
        if (out.size() >= kMaxSanEntries) return;
        SanEntry e{ip, text};
        if (ip) {
            unsigned char b[4];
            if (!parseIpv4(text, b)) return;
            e.text = ipv4Text(b);
        }
        if (seen.insert((ip ? "ip:" : "dns:") + lowered(e.text)).second) out.push_back(e);
    };
    if (isDnsHostname(o.hostname)) add(false, o.hostname);
    for (const std::string& ip : o.ipAddresses) add(true, ip);
    for (const SanEntry& e : o.extraSans) add(e.ip, e.text);
    return out;
}

// The linked list Mbed TLS wants, over `entries` (which must outlive it). Mbed TLS writes the
// list from its last node to its first, so the list is built backwards: the DER holds the entries
// in the order of `entries`.
struct SanNodes {
    explicit SanNodes(const std::vector<SanEntry>& entries) {
        ips.reserve(entries.size());
        nodes.assign(entries.size(), mbedtls_x509_san_list{});
        for (size_t k = 0; k < entries.size(); ++k) {
            const size_t i = entries.size() - 1 - k;  // node k holds entry i
            mbedtls_x509_san_list& n = nodes[k];
            if (entries[i].ip) {
                ips.emplace_back();
                parseIpv4(entries[i].text, ips.back().data());
                n.node.type = MBEDTLS_X509_SAN_IP_ADDRESS;
                n.node.san.unstructured_name.p = ips.back().data();
                n.node.san.unstructured_name.len = 4;
            } else {
                n.node.type = MBEDTLS_X509_SAN_DNS_NAME;
                n.node.san.unstructured_name.p =
                    reinterpret_cast<unsigned char*>(const_cast<char*>(entries[i].text.data()));
                n.node.san.unstructured_name.len = entries[i].text.size();
            }
            n.next = k + 1 < entries.size() ? &nodes[k + 1] : nullptr;
        }
    }
    const mbedtls_x509_san_list* head() const { return nodes.empty() ? nullptr : &nodes[0]; }

    std::vector<std::array<unsigned char, 4>> ips;
    std::vector<mbedtls_x509_san_list> nodes;
};

std::string timeText(const mbedtls_x509_time& t) {
    char buf[32];
    std::snprintf(buf, sizeof buf, "%04d-%02d-%02d %02d:%02d:%02d", t.year, t.mon, t.day, t.hour,
                  t.min, t.sec);
    return buf;
}

// "CN=mAT BL335-01", "C=VN, O=Cong ty, CN=CA": the attributes in the order of the certificate; the
// bytes as they are (UTF-8) except control characters.
std::string nameText(const mbedtls_x509_name& first) {
    std::string out;
    for (const mbedtls_x509_name* n = &first; n != nullptr; n = n->next) {
        if (n->oid.p == nullptr) continue;
        const char* shortName = nullptr;
        if (mbedtls_oid_get_attr_short_name(&n->oid, &shortName) != 0 || shortName == nullptr)
            shortName = "OID";
        if (!out.empty()) out += ", ";
        out += shortName;
        out += '=';
        for (size_t i = 0; i < n->val.len; ++i) {
            const unsigned char c = n->val.p[i];
            out += (c < 0x20 || c == 0x7F) ? '?' : static_cast<char>(c);
        }
    }
    return out;
}

void fillDetails(const mbedtls_x509_crt& crt, CertDetails& d) {
    d = CertDetails{};
    d.subject = nameText(crt.subject);
    d.issuer = nameText(crt.issuer);
    d.selfSigned = crt.issuer_raw.len == crt.subject_raw.len &&
                   std::memcmp(crt.issuer_raw.p, crt.subject_raw.p, crt.subject_raw.len) == 0;
    d.notBefore = timeText(crt.valid_from);
    d.notAfter = timeText(crt.valid_to);
    for (const mbedtls_x509_crt* c = &crt; c != nullptr && c->raw.p != nullptr; c = c->next)
        ++d.chainLength;
    for (const mbedtls_x509_sequence* s = &crt.subject_alt_names;
         s != nullptr && s->buf.p != nullptr; s = s->next) {
        mbedtls_x509_subject_alternative_name san{};
        if (mbedtls_x509_parse_subject_alt_name(&s->buf, &san) != 0) continue;
        const mbedtls_x509_buf& b = san.san.unstructured_name;
        if (san.type == MBEDTLS_X509_SAN_DNS_NAME)
            d.sanDns.emplace_back(reinterpret_cast<const char*>(b.p), b.len);
        else if (san.type == MBEDTLS_X509_SAN_IP_ADDRESS && b.len == 4)
            d.sanIps.push_back(ipv4Text(b.p));
        mbedtls_x509_free_subject_alt_name(&san);
    }
}

struct NewCert {
    NewCert() = default;
    ~NewCert() { wipe(pem); }
    NewCert(const NewCert&) = delete;
    NewCert& operator=(const NewCert&) = delete;

    std::string pem;  // private key, then certificate
    Sha256Digest fingerprint{};
};

// The Mbed TLS state of one new certificate, freed on every way out; the key PEM is wiped.
struct CertWriter {
    CertWriter() {
        mbedtls_pk_init(&key);
        mbedtls_x509write_crt_init(&crt);
    }
    ~CertWriter() {
        mbedtls_platform_zeroize(keyPem, sizeof keyPem);
        mbedtls_x509write_crt_free(&crt);
        mbedtls_pk_free(&key);
    }
    CertWriter(const CertWriter&) = delete;
    CertWriter& operator=(const CertWriter&) = delete;

    mbedtls_pk_context key;
    mbedtls_x509write_cert crt;
    unsigned char der[4096]{};
    unsigned char certPem[8192]{};
    unsigned char keyPem[1024]{};
};

// A new ECDSA P-256 key and a self-signed X.509 v3 certificate for it (research R5).
bool generate(const ServerCertOptions& o, NewCert& out, std::string& err) {
    const std::string commonName = "mAT " + o.deviceName;
    if (commonName.size() > kMaxCommonNameBytes || commonName.find('\0') != std::string::npos) {
        err = "tên thiết bị không dùng được trong chứng chỉ (CN tối đa 64 byte)";
        return false;
    }
    Drbg drbg;
    if (drbg.seedResult() != 0) {
        err = tlsError("không khởi tạo được bộ sinh số ngẫu nhiên", drbg.seedResult());
        return false;
    }
    CertWriter w;
    const auto failed = [&err](const char* what, int ret) {
        err = tlsError(what, ret);
        return false;
    };
    int ret = 0;
    if ((ret = mbedtls_pk_setup(&w.key, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY))) != 0 ||
        (ret = mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, mbedtls_pk_ec(w.key), Drbg::random,
                                   drbg.context())) != 0)
        return failed("không sinh được khóa ECDSA P-256", ret);
    // 16 random bytes; a positive INTEGER in minimal DER (first byte 0x01–0x7F).
    unsigned char serial[kSerialBytes];
    if ((ret = Drbg::random(drbg.context(), serial, sizeof serial)) != 0)
        return failed("không sinh được số serial", ret);
    serial[0] &= 0x7F;
    if (serial[0] == 0) serial[0] = 0x01;

    mbedtls_x509write_crt_set_version(&w.crt, MBEDTLS_X509_CRT_VERSION_3);
    mbedtls_x509write_crt_set_md_alg(&w.crt, MBEDTLS_MD_SHA256);
    mbedtls_x509write_crt_set_subject_key(&w.crt, &w.key);
    mbedtls_x509write_crt_set_issuer_key(&w.crt, &w.key);
    const std::string name = subjectName(commonName);
    if ((ret = mbedtls_x509write_crt_set_subject_name(&w.crt, name.c_str())) != 0 ||
        (ret = mbedtls_x509write_crt_set_issuer_name(&w.crt, name.c_str())) != 0 ||
        (ret = mbedtls_x509write_crt_set_serial_raw(&w.crt, serial, sizeof serial)) != 0 ||
        (ret = mbedtls_x509write_crt_set_validity(&w.crt, kNotBefore, kNotAfter)) != 0 ||
        (ret = mbedtls_x509write_crt_set_basic_constraints(&w.crt, 0, -1)) != 0 ||
        (ret = mbedtls_x509write_crt_set_key_usage(&w.crt, MBEDTLS_X509_KU_DIGITAL_SIGNATURE)) !=
            0 ||
        (ret = mbedtls_x509write_crt_set_extension(&w.crt, MBEDTLS_OID_EXTENDED_KEY_USAGE,
                                                   MBEDTLS_OID_SIZE(MBEDTLS_OID_EXTENDED_KEY_USAGE),
                                                   0, kServerAuthEku, sizeof kServerAuthEku)) != 0)
        return failed("không dựng được chứng chỉ", ret);
    // SAN (FR-053): the host name and the addresses of the cards (Chrome checks the address it was
    // given against them), then --san.
    const std::vector<SanEntry> entries = sanEntries(o);
    const SanNodes sans(entries);
    if (sans.head() != nullptr &&
        (ret = mbedtls_x509write_crt_set_subject_alternative_name(&w.crt, sans.head())) != 0)
        return failed("không dựng được chứng chỉ", ret);

    // Signed with deterministic ECDSA (RFC 6979, MBEDTLS_ECDSA_DETERMINISTIC). The DER ends at
    // the end of the buffer.
    if ((ret = mbedtls_x509write_crt_der(&w.crt, w.der, sizeof w.der, Drbg::random,
                                         drbg.context())) <= 0)
        return failed("không ký được chứng chỉ", ret);
    const unsigned char* certDer = w.der + sizeof w.der - ret;
    const size_t certLen = static_cast<size_t>(ret);
    size_t pemLen = 0;  // with the final NUL
    if ((ret = mbedtls_pem_write_buffer(kCertBegin, kCertEnd, certDer, certLen, w.certPem,
                                        sizeof w.certPem, &pemLen)) != 0 ||
        (ret = mbedtls_pk_write_key_pem(&w.key, w.keyPem, sizeof w.keyPem)) != 0)
        return failed("không ghi được PEM", ret);
    const size_t keyLen = std::strlen(reinterpret_cast<const char*>(w.keyPem));
    out.pem.reserve(keyLen + pemLen);  // no reallocation: no stray copy of the key
    out.pem.append(reinterpret_cast<const char*>(w.keyPem), keyLen);
    out.pem.append(reinterpret_cast<const char*>(w.certPem), pemLen - 1);
    out.fingerprint = sha256(certDer, certLen);
    return true;
}

struct ParsedPem {
    ParsedPem() {
        mbedtls_x509_crt_init(&crt);
        mbedtls_pk_init(&key);
    }
    ~ParsedPem() {
        mbedtls_x509_crt_free(&crt);
        mbedtls_pk_free(&key);
    }
    ParsedPem(const ParsedPem&) = delete;
    ParsedPem& operator=(const ParsedPem&) = delete;

    mbedtls_x509_crt crt;
    mbedtls_pk_context key;
};

bool sameBytes(const mbedtls_x509_buf& b, const void* p, size_t len) {
    return b.len == len && std::memcmp(b.p, p, len) == 0;
}

// The key and the certificate of an existing file: both readable, an ECDSA key, the certificate
// self-signed with that very key (a changed byte anywhere in it breaks the signature). Since 0.6
// the certificate may also be one a CA signed (--import-cert): then the key must fit it and the
// chain of the file must parse; the signature of the CA cannot be checked here (it is not in the
// file as a trust anchor), the clients check it.
bool checkPem(const std::string& text, Sha256Digest& fingerprint, std::string& err,
              CertDetails* details = nullptr) {
    Drbg drbg;  // blinding for the private-key operations of the checks
    if (drbg.seedResult() != 0) {
        err = tlsError("không khởi tạo được bộ sinh số ngẫu nhiên", drbg.seedResult());
        return false;
    }
    ParsedPem f;
    const auto* p = reinterpret_cast<const unsigned char*>(text.c_str());
    const size_t len = text.size() + 1;  // PEM: the final NUL counts
    int ret = mbedtls_x509_crt_parse(&f.crt, p, len);
    if (ret != 0) {
        err = ret > 0 ? "có chứng chỉ không đọc được" : tlsError("chứng chỉ hỏng", ret);
        return false;
    }
    if ((ret = mbedtls_pk_parse_key(&f.key, p, len, nullptr, 0, Drbg::random, drbg.context())) !=
        0) {
        err = tlsError("khóa riêng hỏng", ret);
        return false;
    }
    if (!mbedtls_pk_can_do(&f.key, MBEDTLS_PK_ECDSA)) {
        err = "khóa riêng không phải khóa ECDSA";
        return false;
    }
    if ((ret = mbedtls_pk_check_pair(&f.crt.pk, &f.key, Drbg::random, drbg.context())) != 0) {
        err = tlsError("khóa riêng không khớp chứng chỉ", ret);
        return false;
    }
    CertDetails d;
    fillDetails(f.crt, d);
    const bool imported = text.rfind(kImportedMarker, 0) == 0;
    if (d.selfSigned || !imported) {
        if (!sameBytes(f.crt.sig_oid, MBEDTLS_OID_ECDSA_SHA256,
                       MBEDTLS_OID_SIZE(MBEDTLS_OID_ECDSA_SHA256))) {
            err = "chứng chỉ không tự ký bằng ECDSA SHA-256";
            return false;
        }
        // No public call checks the signature of a self-signed end-entity certificate
        // (mbedtls_x509_crt_verify trusts it as it is when it is in the trusted list), hence the
        // private field. Mbed TLS 3.6.7 is vendored; the 4.x upgrade reviews this file (ADR-010).
        const mbedtls_x509_buf& sig = f.crt.MBEDTLS_PRIVATE(sig);
        const Sha256Digest tbsHash = sha256(f.crt.tbs.p, f.crt.tbs.len);
        if ((ret = mbedtls_pk_verify(&f.crt.pk, MBEDTLS_MD_SHA256, tbsHash.data(), tbsHash.size(),
                                     sig.p, sig.len)) != 0) {
            err = tlsError("chữ ký của chứng chỉ sai", ret);
            return false;
        }
    }
    fingerprint = sha256(f.crt.raw.p, f.crt.raw.len);
    if (details != nullptr) *details = std::move(d);
    return true;
}

void setFingerprint(ServerCert& r, const Sha256Digest& fingerprint) {
    r.ok = true;
    r.fingerprint = toHex(fingerprint);
    r.fingerprintColons = toHexColons(fingerprint);
}

// The way out of cert-error, in every message about an unusable file or directory.
std::string refused(const std::string& why) {
    return why + " (không tự sinh lại; tạo khóa mới bằng mat-runtime --regen-cert)";
}

void readExisting(const Dir& dir, ServerCert& r) {
    std::string text;
    std::string err;
    const Opened read = readFileAt(dir, kPemName, kMaxPemBytes, true, text, err);
    if (read == Opened::Missing) {
        r.error = "chưa có chứng chỉ " + r.pemPath;
        return;
    }
    if (read != Opened::Ok) {
        r.error = read == Opened::Refused ? refused(err) : err;
        return;
    }
    Sha256Digest fingerprint{};
    const bool ok = checkPem(text, fingerprint, err, &r.cert);
    wipe(text);
    if (!ok) {
        r.error = refused(r.pemPath + ": " + err);
        return;
    }
    setFingerprint(r, fingerprint);
}

void writeNew(const ServerCertOptions& o, const Dir& dir, ServerCert& r) {
    NewCert cert;
    std::string err;
    if (!generate(o, cert, err) || !writeFileAt(dir, kPemName, cert.pem, err)) {
        r.error = "không tạo được chứng chỉ " + r.pemPath + ": " + err;
        return;
    }
    setFingerprint(r, cert.fingerprint);
    Sha256Digest again{};
    checkPem(cert.pem, again, err, &r.cert);  // the details of what was just made
    r.generated = true;
}

std::string uuidV4() {
    unsigned char b[16];
    randomBytes(b, sizeof b);
    b[6] = static_cast<unsigned char>((b[6] & 0x0F) | 0x40);  // version 4
    b[8] = static_cast<unsigned char>((b[8] & 0x3F) | 0x80);  // RFC 4122 variant
    const std::string h = toHex(b, sizeof b);
    return h.substr(0, 8) + "-" + h.substr(8, 4) + "-" + h.substr(12, 4) + "-" + h.substr(16, 4) +
           "-" + h.substr(20);
}

// Exactly what uuidV4() makes: 8-4-4-4-12 lowercase hex, version 4, RFC 4122 variant.
bool isUuidV4(const std::string& s) {
    if (s.size() != 36) return false;
    for (size_t i = 0; i < s.size(); ++i) {
        const char c = s[i];
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (c != '-') return false;
        } else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) {
            return false;
        }
    }
    return s[14] == '4' && (s[19] == '8' || s[19] == '9' || s[19] == 'a' || s[19] == 'b');
}

// --- Feature 007: request, import ------------------------------------------------------------

// A line of any PEM private-key block ("PRIVATE KEY", "EC PRIVATE KEY", "ENCRYPTED PRIVATE KEY"…).
bool hasPrivateKeyMarker(const std::string& text) {
    return text.find("PRIVATE KEY-----") != std::string::npos;
}

// The first private-key block of `text` with its last newline; "" when there is none.
std::string privateKeyBlock(const std::string& text) {
    for (size_t b = text.find("-----BEGIN "); b != std::string::npos;
         b = text.find("-----BEGIN ", b + 1)) {
        size_t eol = text.find('\n', b);
        if (eol == std::string::npos) return "";
        std::string header = text.substr(b, eol - b);
        while (!header.empty() && header.back() == '\r') header.pop_back();
        const std::string tail = "PRIVATE KEY-----";
        if (header.size() < tail.size() ||
            header.compare(header.size() - tail.size(), tail.size(), tail) != 0)
            continue;
        const std::string type = header.substr(11, header.size() - 11 - 5);  // "EC PRIVATE KEY"
        const std::string endLine = "-----END " + type + "-----";
        const size_t e = text.find(endLine, eol);
        if (e == std::string::npos) return "";
        size_t stop = text.find('\n', e);
        stop = stop == std::string::npos ? text.size() : stop + 1;
        std::string block = text.substr(b, stop - b);
        if (block.back() != '\n') block += '\n';
        return block;
    }
    return "";
}

// The Mbed TLS state of one certificate request, freed on every way out; the key PEM is wiped.
struct CsrWriter {
    CsrWriter() {
        mbedtls_pk_init(&key);
        mbedtls_x509write_csr_init(&csr);
    }
    ~CsrWriter() {
        mbedtls_platform_zeroize(keyPem, sizeof keyPem);
        mbedtls_x509write_csr_free(&csr);
        mbedtls_pk_free(&key);
    }
    CsrWriter(const CsrWriter&) = delete;
    CsrWriter& operator=(const CsrWriter&) = delete;

    mbedtls_pk_context key;
    mbedtls_x509write_csr csr;
    unsigned char csrPem[4096]{};
    unsigned char keyPem[1024]{};
};

std::string fileStamp(const std::string& stamp) {
    std::string out;
    for (const char c : stamp)
        if ((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) out += c;
    return out.empty() ? "now" : out.substr(0, 32);
}

// A key of the device read from `name` in the directory: the first private-key block of the file.
// Opened::Missing when there is no such file.
Opened readDeviceKey(const Dir& dir, const char* name, mbedtls_pk_context& key, Drbg& drbg,
                     std::string& err) {
    std::string text;
    const Opened read = readFileAt(dir, name, kMaxPemBytes, true, text, err);
    if (read != Opened::Ok) return read;
    std::string block = privateKeyBlock(text);
    wipe(text);
    if (block.empty()) {
        err = std::string(name) + " không có khóa riêng";
        return Opened::Refused;
    }
    const int ret =
        mbedtls_pk_parse_key(&key, reinterpret_cast<const unsigned char*>(block.c_str()),
                             block.size() + 1, nullptr, 0, Drbg::random, drbg.context());
    wipe(block);
    if (ret != 0) {
        err = tlsError((std::string("khóa riêng của ") + name + " hỏng").c_str(), ret);
        return Opened::Refused;
    }
    return Opened::Ok;
}

}  // namespace

std::string serverCertPath(const std::string& dataDir) {
    return joinPath(joinPath(dataDir, kTlsDir), kPemName);
}

std::string deviceIdPath(const std::string& dataDir) { return joinPath(dataDir, kDeviceIdName); }

ServerCert loadOrCreateServerCert(const ServerCertOptions& options) {
    ServerCert r;
    r.pemPath = serverCertPath(options.dataDir);
    try {
        Dir dir;
        std::string err;
        const Opened opened = openTlsDir(options.dataDir, TlsDirUse::Create, dir, err);
        if (opened != Opened::Ok) {
            r.error = opened == Opened::Refused ? refused(err) : err;
            return r;
        }
        if (!lockDir(dir, r.error)) return r;
        struct stat st {};
        if (::fstatat(dir.fd, kPemName, &st, AT_SYMLINK_NOFOLLOW) == 0) {
            readExisting(dir, r);
        } else {
            const int e = errno;
            if (e == ENOENT)
                writeNew(options, dir, r);
            else
                r.error = sysError("không đọc được", r.pemPath, e);
        }
    } catch (const std::exception& e) {
        r = ServerCert{};
        r.pemPath = serverCertPath(options.dataDir);
        r.error = std::string("lỗi khi đọc hoặc tạo chứng chỉ: ") + e.what();
    }
    return r;
}

ServerCert readServerCert(const std::string& dataDir) {
    ServerCert r;
    r.pemPath = serverCertPath(dataDir);
    try {
        Dir dir;
        std::string err;
        const Opened opened = openTlsDir(dataDir, TlsDirUse::Read, dir, err);
        if (opened == Opened::Missing)
            r.error = "chưa có chứng chỉ " + r.pemPath;
        else if (opened != Opened::Ok)
            r.error = opened == Opened::Refused ? refused(err) : err;
        else
            readExisting(dir, r);
    } catch (const std::exception& e) {
        r = ServerCert{};
        r.pemPath = serverCertPath(dataDir);
        r.error = std::string("lỗi khi đọc chứng chỉ: ") + e.what();
    }
    return r;
}

ServerCert regenerateServerCert(const ServerCertOptions& options) {
    ServerCert r;
    r.pemPath = serverCertPath(options.dataDir);
    try {
        Dir dir;
        std::string err;
        if (openTlsDir(options.dataDir, TlsDirUse::Regenerate, dir, err) != Opened::Ok ||
            !lockDir(dir, err)) {
            r.error = "không tạo được chứng chỉ " + r.pemPath + ": " + err;
            return r;
        }
        writeNew(options, dir, r);
    } catch (const std::exception& e) {
        r = ServerCert{};
        r.pemPath = serverCertPath(options.dataDir);
        r.error = std::string("lỗi khi tạo chứng chỉ: ") + e.what();
    }
    return r;
}

DeviceId loadOrCreateDeviceId(const std::string& dataDir) {
    DeviceId r;
    const std::string path = deviceIdPath(dataDir);
    const std::string onlyThisRun = ": mã thiết bị mới chỉ dùng tới khi runtime dừng";
    try {
        Dir dir;
        std::string err;
        if (!makeDirs(dataDir, err) || openDir(dataDir, false, dir, err) != Opened::Ok ||
            !lockDir(dir, err)) {
            r.id = uuidV4();
            r.created = true;
            r.warning = "không ghi được " + path + " (" + err + ")" + onlyThisRun;
            return r;
        }
        std::string text;
        const Opened read = readFileAt(dir, kDeviceIdName, kMaxDeviceIdBytes, false, text, err);
        if (read == Opened::Ok) {
            if (!text.empty() && text.back() == '\n') text.pop_back();
            if (isUuidV4(text)) {
                r.id = text;
                return r;
            }
            err = path + " hỏng";
        }
        if (read != Opened::Missing)
            r.warning = err + ": tạo mã thiết bị mới (Studio thấy như một thiết bị mới)";
        r.id = uuidV4();
        r.created = true;
        if (!writeFileAt(dir, kDeviceIdName, r.id + "\n", err))
            r.warning += (r.warning.empty() ? "" : "; ") + err + onlyThisRun;
    } catch (const std::exception& e) {
        // Only getrandom failing ends here; then nothing else that needs randomness works either.
        r = DeviceId{};
        r.warning = std::string("không tạo được mã thiết bị: ") + e.what();
    }
    return r;
}

std::string publicCertificatePem(const std::string& pemText) {
    std::string out;
    const std::string begin = "-----BEGIN CERTIFICATE-----";
    const std::string end = "-----END CERTIFICATE-----";
    size_t at = 0;
    for (;;) {
        const size_t b = pemText.find(begin, at);
        if (b == std::string::npos) break;
        const size_t e = pemText.find(end, b);
        if (e == std::string::npos) break;
        std::string block = pemText.substr(b, e + end.size() - b);
        // a block that holds anything but base64 lines is not copied (a key cannot hide in it)
        bool clean = true;
        for (const char c : block.substr(begin.size(), block.size() - begin.size() - end.size()))
            if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
                  c == '+' || c == '/' || c == '=' || c == '\n' || c == '\r'))
                clean = false;
        if (clean) out += block + "\n";
        at = e + end.size();
    }
    return out;
}

bool parseSanList(const std::string& text, std::vector<SanEntry>& out, std::string& error) {
    out.clear();
    size_t start = 0;
    for (;;) {
        const size_t comma = text.find(',', start);
        std::string item = text.substr(start, comma == std::string::npos ? comma : comma - start);
        const size_t a = item.find_first_not_of(" \t");
        const size_t b = item.find_last_not_of(" \t");
        item = a == std::string::npos ? "" : item.substr(a, b - a + 1);
        if (item.empty()) {
            error = "--san có phần tử rỗng (dạng: 192.168.1.110,scada.example.vn)";
            return false;
        }
        if (item.find(':') != std::string::npos || item.find('[') != std::string::npos) {
            error = "--san không nhận địa chỉ IPv6: " + item;
            return false;
        }
        if (item.find('*') != std::string::npos) {
            error = "--san không nhận ký tự đại diện: " + item;
            return false;
        }
        SanEntry e;
        unsigned char ip[4];
        if (parseIpv4(item, ip)) {
            e.ip = true;
            e.text = ipv4Text(ip);
        } else if (!onlyDigitsAndDots(item) && isDnsHostname(item)) {
            e.text = item;
        } else {
            error = "--san: không phải địa chỉ IPv4 hay tên máy hợp lệ: " + item;
            return false;
        }
        out.push_back(std::move(e));
        if (out.size() > kMaxSanEntries) {
            error = "--san tối đa " + std::to_string(kMaxSanEntries) + " phần tử";
            return false;
        }
        if (comma == std::string::npos) break;
        start = comma + 1;
    }
    return true;
}

std::vector<std::string> tlsWarnings(const ServerCert& cert,
                                     const std::vector<std::string>& currentIps) {
    std::vector<std::string> w;
    if (!cert.ok) return w;
    if (cert.cert.sanIps.empty()) {
        w.emplace_back("TLS_NO_IP_SAN");
        return w;
    }
    for (const std::string& ip : currentIps) {
        if (std::find(cert.cert.sanIps.begin(), cert.cert.sanIps.end(), ip) ==
            cert.cert.sanIps.end()) {
            w.emplace_back("TLS_SAN_MISMATCH");
            break;
        }
    }
    return w;
}

CsrResult makeServerCsr(const ServerCertOptions& o, const std::string& stamp) {
    CsrResult r;
    try {
        const std::string commonName = "mAT " + o.deviceName;
        if (commonName.size() > kMaxCommonNameBytes || commonName.find('\0') != std::string::npos) {
            r.error = "tên thiết bị không dùng được trong yêu cầu (CN tối đa 64 byte)";
            return r;
        }
        Dir dir;
        std::string err;
        const Opened opened = openTlsDir(o.dataDir, TlsDirUse::Create, dir, err);
        if (opened != Opened::Ok || !lockDir(dir, err)) {
            r.error = err;
            return r;
        }
        Drbg drbg;
        if (drbg.seedResult() != 0) {
            r.error = tlsError("không khởi tạo được bộ sinh số ngẫu nhiên", drbg.seedResult());
            return r;
        }
        CsrWriter w;
        const auto failed = [&r](const char* what, int ret) {
            r.error = tlsError(what, ret);
            return r;
        };
        int ret = 0;
        if ((ret = mbedtls_pk_setup(&w.key, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY))) != 0 ||
            (ret = mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, mbedtls_pk_ec(w.key), Drbg::random,
                                       drbg.context())) != 0)
            return failed("không sinh được khóa ECDSA P-256", ret);
        mbedtls_x509write_csr_set_md_alg(&w.csr, MBEDTLS_MD_SHA256);
        mbedtls_x509write_csr_set_key(&w.csr, &w.key);
        const std::string name = subjectName(commonName);
        const std::vector<SanEntry> entries = sanEntries(o);
        const SanNodes sans(entries);
        if ((ret = mbedtls_x509write_csr_set_subject_name(&w.csr, name.c_str())) != 0 ||
            (ret = mbedtls_x509write_csr_set_key_usage(&w.csr,
                                                       MBEDTLS_X509_KU_DIGITAL_SIGNATURE)) != 0 ||
            (ret = mbedtls_x509write_csr_set_extension(
                 &w.csr, MBEDTLS_OID_EXTENDED_KEY_USAGE,
                 MBEDTLS_OID_SIZE(MBEDTLS_OID_EXTENDED_KEY_USAGE), 0, kServerAuthEku,
                 sizeof kServerAuthEku)) != 0 ||
            (sans.head() != nullptr &&
             (ret = mbedtls_x509write_csr_set_subject_alternative_name(&w.csr, sans.head())) != 0))
            return failed("không dựng được yêu cầu chứng chỉ", ret);
        if ((ret = mbedtls_x509write_csr_pem(&w.csr, w.csrPem, sizeof w.csrPem, Drbg::random,
                                             drbg.context())) != 0 ||
            (ret = mbedtls_pk_write_key_pem(&w.key, w.keyPem, sizeof w.keyPem)) != 0)
            return failed("không ghi được PEM", ret);
        std::string key(reinterpret_cast<const char*>(w.keyPem));
        const bool keyWritten = writeFileAt(dir, kPendingKeyName, key, err);
        wipe(key);
        const std::string csr(reinterpret_cast<const char*>(w.csrPem));
        const std::string csrName = "csr-" + fileStamp(stamp) + ".pem";
        if (!keyWritten || !writeFileAt(dir, csrName.c_str(), csr, err, 0644)) {
            r.error = "không ghi được yêu cầu chứng chỉ: " + err;
            return r;
        }
        r.csrPem = csr;
        r.csrPath = joinPath(dir.path, csrName.c_str());
        r.ok = true;
    } catch (const std::exception& e) {
        r = CsrResult{};
        r.error = std::string("lỗi khi tạo yêu cầu chứng chỉ: ") + e.what();
    }
    return r;
}

ImportResult importServerCert(const ImportOptions& o, const std::string& pemText) {
    ImportResult r;
    const auto fail = [&r](int code, std::string why) {
        r.code = code;
        r.error = std::move(why);
        return r;
    };
    try {
        if (hasPrivateKeyMarker(pemText))
            return fail(2,
                        "tệp có khối khóa riêng: không gửi khóa riêng; chứng chỉ chỉ gồm phần "
                        "công khai (chứng chỉ máy chủ rồi chuỗi CA)");
        ParsedPem chain;  // the certificates; the key member stays unused here
        const int parsed = mbedtls_x509_crt_parse(
            &chain.crt, reinterpret_cast<const unsigned char*>(pemText.c_str()),
            pemText.size() + 1);
        if (pemText.find("-----BEGIN CERTIFICATE-----") == std::string::npos || parsed != 0 ||
            chain.crt.raw.p == nullptr)
            return fail(2, parsed > 0 || parsed == 0
                               ? "tệp không có khối CERTIFICATE đọc được"
                               : tlsError("không đọc được chứng chỉ", parsed));
        if (!mbedtls_pk_can_do(&chain.crt.pk, MBEDTLS_PK_ECDSA))
            return fail(2, "chứng chỉ không dùng khóa ECDSA (thiết bị chỉ dùng khóa P-256)");

        Dir dir;
        std::string err;
        const Opened opened = openTlsDir(o.dataDir, TlsDirUse::Create, dir, err);
        if (opened != Opened::Ok || !lockDir(dir, err)) return fail(4, err);
        Drbg drbg;
        if (drbg.seedResult() != 0)
            return fail(4,
                        tlsError("không khởi tạo được bộ sinh số ngẫu nhiên", drbg.seedResult()));

        // The key: the one --make-csr made, else the one in use (a CA may sign a request made
        // elsewhere from it).
        std::string keyBlock;
        bool usedPending = false;
        std::string notes;
        for (const char* name : {kPendingKeyName, kPemName}) {
            mbedtls_pk_context key;
            mbedtls_pk_init(&key);
            std::string why;
            const Opened k = readDeviceKey(dir, name, key, drbg, why);
            bool fits = false;
            if (k == Opened::Ok &&
                mbedtls_pk_check_pair(&chain.crt.pk, &key, Drbg::random, drbg.context()) == 0)
                fits = true;
            mbedtls_pk_free(&key);
            if (k != Opened::Ok && k != Opened::Missing) notes += why + "; ";
            if (!fits) continue;
            std::string text, e2;
            if (readFileAt(dir, name, kMaxPemBytes, true, text, e2) == Opened::Ok)
                keyBlock = privateKeyBlock(text);
            wipe(text);
            usedPending = std::string(name) == kPendingKeyName;
            break;
        }
        if (keyBlock.empty())
            return fail(3, "chứng chỉ không khớp khóa riêng nào của thiết bị (" + notes +
                               "pending-key.pem của --make-csr hoặc khóa của server.pem); ký CSR "
                               "do chính thiết bị này sinh");

        // Warnings: the names, the dates.
        CertDetails d;
        fillDetails(chain.crt, d);
        bool covers = o.ipAddresses.empty() && o.hostname.empty();
        for (const std::string& ip : o.ipAddresses)
            if (std::find(d.sanIps.begin(), d.sanIps.end(), ip) != d.sanIps.end()) covers = true;
        for (const std::string& dns : d.sanDns)
            if (!o.hostname.empty() && lowered(dns) == lowered(o.hostname)) covers = true;
        if (!covers)
            r.warnings.push_back(
                "SAN của chứng chỉ không có IP nào của card hiện tại (hay tên máy đã khai): Chrome "
                "sẽ báo lỗi tên khi mở bằng địa chỉ đó");
        if (o.rejectExpired && mbedtls_x509_time_is_past(&chain.crt.valid_to))
            return fail(5, "chứng chỉ đã hết hạn theo đồng hồ của thiết bị (" + d.notAfter + ")");
        if (o.rejectExpired && mbedtls_x509_time_is_future(&chain.crt.valid_from))
            return fail(5, "chứng chỉ chưa tới ngày hiệu lực theo đồng hồ của thiết bị (" +
                               d.notBefore + "); kiểm đồng hồ");
        if (mbedtls_x509_time_is_past(&chain.crt.valid_to))
            r.warnings.push_back("chứng chỉ đã hết hạn theo đồng hồ của thiết bị");
        else if (mbedtls_x509_time_is_future(&chain.crt.valid_from))
            r.warnings.push_back(
                "chứng chỉ chưa tới ngày hiệu lực theo đồng hồ của thiết bị (BL335 không có RTC "
                "tin cậy: kiểm đồng hồ)");

        // What goes into server.pem: the key, then every certificate re-encoded from its DER.
        std::string content = std::string(kImportedMarker) + keyBlock;
        wipe(keyBlock);
        for (const mbedtls_x509_crt* c = &chain.crt; c != nullptr && c->raw.p != nullptr;
             c = c->next) {
            std::vector<unsigned char> pem(c->raw.len * 2 + 128);
            size_t len = 0;
            if (mbedtls_pem_write_buffer(kCertBegin, kCertEnd, c->raw.p, c->raw.len, pem.data(),
                                         pem.size(), &len) != 0) {
                wipe(content);
                return fail(4, "không mã hóa được chứng chỉ thành PEM");
            }
            content.append(reinterpret_cast<const char*>(pem.data()), len - 1);
        }
        Sha256Digest fingerprint{};
        const bool good = checkPem(content, fingerprint, err);
        if (!good) {
            wipe(content);
            return fail(3, "chứng chỉ và khóa không dùng được cùng nhau: " + err);
        }

        // Atomic steps: the old file stays complete until the last rename.
        const auto step = [&o](const char* name) { return !o.afterStep || o.afterStep(name); };
        ::unlinkat(dir.fd, kNewName, 0);  // left by an import that stopped
        if (!writeFileAt(dir, kNewName, content, err)) {
            wipe(content);
            return fail(4, err);
        }
        wipe(content);
        if (!step("new-written")) return fail(4, "dừng sau khi ghi server.pem.new");
        struct stat st {};
        if (::fstatat(dir.fd, kPemName, &st, AT_SYMLINK_NOFOLLOW) == 0) {
            ::unlinkat(dir.fd, kPrevName, 0);
            if (::linkat(dir.fd, kPemName, dir.fd, kPrevName, 0) != 0)
                return fail(4, sysError("không giữ được bản trước", joinPath(dir.path, kPrevName)));
            syncDir(dir.fd);
        }
        if (!step("prev-linked")) return fail(4, "dừng sau khi giữ server.pem.prev");
        if (::renameat(dir.fd, kNewName, dir.fd, kPemName) != 0)
            return fail(4, sysError("không đổi tên được", joinPath(dir.path, kNewName)));
        syncDir(dir.fd);
        if (usedPending) {
            ::unlinkat(dir.fd, kPendingKeyName, 0);
            syncDir(dir.fd);
        }
        r.fingerprint = toHex(fingerprint);
        r.fingerprintColons = toHexColons(fingerprint);
    } catch (const std::exception& e) {
        return fail(4, std::string("lỗi khi nhập chứng chỉ: ") + e.what());
    }
    return r;
}

}  // namespace mat
