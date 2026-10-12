// T038 (feature 005; data-model §3, research R5, FR-006, contracts/device-config.md §2, ADR-010):
// the device's HTTPS certificate and device id (server/tls/server_cert).
//  - First start: an ECDSA P-256 key and a self-signed X.509 v3 certificate in
//    <dataDir>/tls/server.pem, key then certificate, file 0600 in a 0700 directory, written through
//    a temporary file; later starts reuse them (same fingerprint).
//  - Certificate: CN "mAT <deviceName>", SAN dNSName = host name, 16-byte random positive serial,
//    valid 2000-01-01 to 9999-12-31 (the BL335 has no readable RTC: validity must not depend on
//    the clock), CA:FALSE, keyUsage digitalSignature, extendedKeyUsage serverAuth.
//  - Fingerprint: SHA-256 of the certificate DER, as 64 lowercase hex and as "AB:CD:…".
//  - A damaged file or wrong permissions give cert-error and are never replaced;
//    regenerateServerCert (--regen-cert) makes a new key.
//  - device-id: UUID v4, 0600, made once; a damaged one is replaced (it is no secret).
//  - In-process CivetWeb HTTPS (mat_tls_test_support) serving that file: libcurl sees the same
//    fingerprint; the image's openssl reads, prints and strictly verifies the certificate.
// Every key lives in a temporary directory removed at the end of its test.
#include "server/tls/server_cert.hpp"

#include <dirent.h>
#include <gtest/gtest.h>
#include <mbedtls/asn1.h>
#include <mbedtls/ecp.h>
#include <mbedtls/oid.h>
#include <mbedtls/pem.h>
#include <mbedtls/pk.h>
#include <mbedtls/x509_crt.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <regex>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include "core/crypto/hex.hpp"
#include "core/crypto/random.hpp"
#include "core/crypto/sha256.hpp"

#ifdef MAT_TLS_TEST_SUPPORT
#include <curl/curl.h>

#include "server/tests/tls_test_support.hpp"
#endif

using namespace mat;

namespace {

class TempDir {
   public:
    TempDir() {
        char tmpl[] = "/tmp/mat-cert-XXXXXX";
        if (::mkdtemp(tmpl) != nullptr) path = tmpl;
    }
    ~TempDir() {
        std::error_code ec;
        if (!path.empty()) std::filesystem::remove_all(path, ec);
    }
    TempDir(const TempDir&) = delete;
    TempDir& operator=(const TempDir&) = delete;
    std::string path;
};

std::string readFile(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    std::ostringstream s;
    s << f.rdbuf();
    return s.str();
}

void writeFile(const std::string& path, const std::string& text, mode_t mode) {
    std::ofstream(path, std::ios::binary | std::ios::trunc) << text;
    ::chmod(path.c_str(), mode);
}

// File type and permission bits, without following a symbolic link; 0 when missing.
mode_t modeOf(const std::string& path) {
    struct stat st {};
    return ::lstat(path.c_str(), &st) == 0 ? st.st_mode : 0;
}
mode_t fileMode(mode_t perm) { return S_IFREG | perm; }
mode_t dirMode(mode_t perm) { return S_IFDIR | perm; }

std::vector<std::string> listDir(const std::string& dir) {
    std::vector<std::string> names;
    if (DIR* d = ::opendir(dir.c_str())) {
        while (const dirent* e = ::readdir(d))
            if (std::strcmp(e->d_name, ".") != 0 && std::strcmp(e->d_name, "..") != 0)
                names.emplace_back(e->d_name);
        ::closedir(d);
    }
    std::sort(names.begin(), names.end());
    return names;
}

size_t count(const std::string& text, const std::string& what) {
    size_t n = 0;
    for (size_t at = text.find(what); at != std::string::npos; at = text.find(what, at + 1)) ++n;
    return n;
}

int testRng(void*, unsigned char* out, size_t len) {
    randomBytes(out, len);
    return 0;
}

std::string bytes(const mbedtls_asn1_buf& b) {
    return std::string(reinterpret_cast<const char*>(b.p), b.len);
}

// A PEM text parsed by Mbed TLS: every certificate in it, and the private key if there is one.
struct ParsedPem {
    explicit ParsedPem(const std::string& pem) {
        mbedtls_x509_crt_init(&crt);
        mbedtls_pk_init(&key);
        const auto* p = reinterpret_cast<const unsigned char*>(pem.c_str());
        crtRet = mbedtls_x509_crt_parse(&crt, p, pem.size() + 1);  // PEM: the NUL counts
        keyRet = mbedtls_pk_parse_key(&key, p, pem.size() + 1, nullptr, 0, testRng, nullptr);
    }
    ~ParsedPem() {
        mbedtls_x509_crt_free(&crt);
        mbedtls_pk_free(&key);
    }
    ParsedPem(const ParsedPem&) = delete;
    ParsedPem& operator=(const ParsedPem&) = delete;

    mbedtls_x509_crt crt;
    mbedtls_pk_context key;
    int crtRet = -1;
    int keyRet = -1;
};

std::string fingerprintOf(const mbedtls_x509_crt& crt) {
    return toHex(sha256(crt.raw.p, crt.raw.len));
}

// The CN of a name that has only a CN; "" otherwise.
std::string onlyCommonName(const mbedtls_x509_name& name) {
    const std::string cn(MBEDTLS_OID_AT_CN, MBEDTLS_OID_SIZE(MBEDTLS_OID_AT_CN));
    if (name.next != nullptr || bytes(name.oid) != cn) return "";
    return bytes(name.val);
}

std::vector<std::string> dnsNames(const mbedtls_x509_crt& crt) {
    std::vector<std::string> names;
    for (const mbedtls_x509_sequence* s = &crt.subject_alt_names;
         s != nullptr && s->buf.p != nullptr; s = s->next) {
        mbedtls_x509_subject_alternative_name san{};
        if (mbedtls_x509_parse_subject_alt_name(&s->buf, &san) != 0) {
            names.emplace_back("<unparsable>");
            continue;
        }
        names.push_back(san.type == MBEDTLS_X509_SAN_DNS_NAME ? bytes(san.san.unstructured_name)
                                                              : "<other type>");
        mbedtls_x509_free_subject_alt_name(&san);
    }
    return names;
}

std::string timeText(const mbedtls_x509_time& t) {
    char buf[32];
    std::snprintf(buf, sizeof buf, "%04d-%02d-%02d %02d:%02d:%02d", t.year, t.mon, t.day, t.hour,
                  t.min, t.sec);
    return buf;
}

std::string crtInfo(const mbedtls_x509_crt& crt) {
    char buf[4096];
    const int n = mbedtls_x509_crt_info(buf, sizeof buf, "", &crt);
    return n > 0 ? std::string(buf, static_cast<size_t>(n)) : "";
}

// The certificate DER of a PEM text, and back.
std::string certDer(const std::string& pem) {
    ParsedPem p(pem);
    return p.crtRet == 0 ? bytes(p.crt.raw) : "";
}
std::string certPem(const std::string& der) {
    unsigned char buf[4096];
    size_t len = 0;
    if (mbedtls_pem_write_buffer("-----BEGIN CERTIFICATE-----\n", "-----END CERTIFICATE-----\n",
                                 reinterpret_cast<const unsigned char*>(der.data()), der.size(),
                                 buf, sizeof buf, &len) != 0)
        return "";
    return std::string(reinterpret_cast<const char*>(buf), len - 1);  // len counts the NUL
}

const char* const kKeyBegin = "-----BEGIN EC PRIVATE KEY-----\n";
const char* const kKeyEnd = "-----END EC PRIVATE KEY-----\n";
const char* const kCertBegin = "-----BEGIN CERTIFICATE-----\n";
const char* const kCertEnd = "-----END CERTIFICATE-----\n";

std::string keyBlock(const std::string& pem) { return pem.substr(0, pem.find(kCertBegin)); }
std::string certBlock(const std::string& pem) {
    const size_t at = pem.find(kCertBegin);
    return at == std::string::npos ? "" : pem.substr(at);
}

ServerCertOptions options(const std::string& dataDir) {
    return {dataDir, "BL335-01", "bl335-test"};
}

// A data directory whose tls/server.pem holds `text` with `mode` (directory 0700).
void plantPem(const std::string& dataDir, const std::string& text, mode_t mode = 0600) {
    ::mkdir((dataDir + "/tls").c_str(), 0700);
    writeFile(dataDir + "/tls/server.pem", text, mode);
}

const std::regex kHex64("[0-9a-f]{64}");
const std::regex kColons("[0-9A-F]{2}(:[0-9A-F]{2}){31}");
const std::regex kUuidV4("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}");

}  // namespace

// --- First start, file layout

TEST(ServerCert, FirstStartWritesKeyThenCertificate) {
    TempDir d;
    const ServerCert c = loadOrCreateServerCert(options(d.path));
    ASSERT_TRUE(c.ok) << c.error;
    EXPECT_TRUE(c.generated);
    EXPECT_STREQ(c.httpsState(), "ok");
    EXPECT_EQ(c.error, "");
    EXPECT_EQ(c.pemPath, d.path + "/tls/server.pem");
    EXPECT_EQ(serverCertPath(d.path), c.pemPath);
    EXPECT_EQ(modeOf(d.path + "/tls"), dirMode(0700));
    EXPECT_EQ(modeOf(c.pemPath), fileMode(0600));
    // Written through a temporary file: nothing but server.pem remains.
    EXPECT_EQ(listDir(d.path + "/tls"), std::vector<std::string>{"server.pem"});

    // One key block, then one certificate block (CivetWeb reads both from ssl_certificate).
    const std::string pem = readFile(c.pemPath);
    EXPECT_EQ(pem.rfind(kKeyBegin, 0), 0u) << pem;
    const size_t keyEnd = pem.find(kKeyEnd);
    ASSERT_NE(keyEnd, std::string::npos) << pem;
    EXPECT_EQ(pem.find(kCertBegin), keyEnd + std::strlen(kKeyEnd)) << pem;
    ASSERT_GE(pem.size(), std::strlen(kCertEnd));
    EXPECT_EQ(pem.substr(pem.size() - std::strlen(kCertEnd)), kCertEnd) << pem;
    EXPECT_EQ(count(pem, "-----BEGIN "), 2u) << pem;

    ParsedPem p(pem);
    ASSERT_EQ(p.crtRet, 0);
    ASSERT_EQ(p.keyRet, 0);
    EXPECT_EQ(p.crt.next, nullptr);  // one certificate
    EXPECT_EQ(mbedtls_pk_check_pair(&p.crt.pk, &p.key, testRng, nullptr), 0);
    ASSERT_EQ(mbedtls_pk_get_type(&p.key), MBEDTLS_PK_ECKEY);
    EXPECT_EQ(mbedtls_ecp_keypair_get_group_id(mbedtls_pk_ec(p.key)), MBEDTLS_ECP_DP_SECP256R1);
}

TEST(ServerCert, CertificateFields) {
    TempDir d;
    const ServerCert c = loadOrCreateServerCert(options(d.path));
    ASSERT_TRUE(c.ok) << c.error;
    ParsedPem p(readFile(c.pemPath));
    ASSERT_EQ(p.crtRet, 0);
    const mbedtls_x509_crt& crt = p.crt;
    const std::string info = crtInfo(crt);

    EXPECT_EQ(crt.version, 3);
    // Self-signed: issuer = subject = CN only, UTF8String.
    EXPECT_EQ(onlyCommonName(crt.subject), "mAT BL335-01") << info;
    EXPECT_EQ(crt.subject.val.tag, MBEDTLS_ASN1_UTF8_STRING);
    EXPECT_EQ(bytes(crt.issuer_raw), bytes(crt.subject_raw));
    EXPECT_EQ(dnsNames(crt), std::vector<std::string>{"bl335-test"}) << info;
    // 16 random bytes, a positive INTEGER in minimal DER (no leading zero byte).
    ASSERT_EQ(crt.serial.len, 16u) << info;
    EXPECT_EQ(crt.serial.p[0] & 0x80, 0) << info;
    EXPECT_NE(crt.serial.p[0], 0) << info;
    // Fixed validity, whatever the device clock says.
    EXPECT_EQ(timeText(crt.valid_from), "2000-01-01 00:00:00");
    EXPECT_EQ(timeText(crt.valid_to), "9999-12-31 23:59:59");
    // ECDSA P-256 key, signed with ecdsa-with-SHA256.
    ASSERT_EQ(mbedtls_pk_get_type(&crt.pk), MBEDTLS_PK_ECKEY);
    EXPECT_EQ(mbedtls_ecp_keypair_get_group_id(mbedtls_pk_ec(crt.pk)), MBEDTLS_ECP_DP_SECP256R1);
    EXPECT_EQ(bytes(crt.sig_oid),
              std::string(MBEDTLS_OID_ECDSA_SHA256, MBEDTLS_OID_SIZE(MBEDTLS_OID_ECDSA_SHA256)));
    // CA:FALSE; digitalSignature only; serverAuth only.
    EXPECT_NE(info.find("\nbasic constraints : CA=false\n"), std::string::npos) << info;
    EXPECT_NE(info.find("\nkey usage         : Digital Signature\n"), std::string::npos) << info;
    EXPECT_NE(info.find("\next key usage     : TLS Web Server Authentication\n"), std::string::npos)
        << info;
    EXPECT_EQ(mbedtls_x509_crt_check_key_usage(&crt, MBEDTLS_X509_KU_DIGITAL_SIGNATURE), 0);
    EXPECT_NE(mbedtls_x509_crt_check_key_usage(&crt, MBEDTLS_X509_KU_KEY_CERT_SIGN), 0);
    EXPECT_EQ(mbedtls_x509_crt_check_extended_key_usage(&crt, MBEDTLS_OID_SERVER_AUTH,
                                                        MBEDTLS_OID_SIZE(MBEDTLS_OID_SERVER_AUTH)),
              0);
    EXPECT_NE(mbedtls_x509_crt_check_extended_key_usage(&crt, MBEDTLS_OID_CLIENT_AUTH,
                                                        MBEDTLS_OID_SIZE(MBEDTLS_OID_CLIENT_AUTH)),
              0);
}

TEST(ServerCert, FingerprintIsTheSha256OfTheDer) {
    TempDir d;
    const ServerCert c = loadOrCreateServerCert(options(d.path));
    ASSERT_TRUE(c.ok) << c.error;
    ParsedPem p(readFile(c.pemPath));
    ASSERT_EQ(p.crtRet, 0);
    const Sha256Digest digest = sha256(p.crt.raw.p, p.crt.raw.len);
    EXPECT_EQ(c.fingerprint, toHex(digest));
    EXPECT_EQ(c.fingerprintColons, toHexColons(digest));
    EXPECT_TRUE(std::regex_match(c.fingerprint, kHex64)) << c.fingerprint;
    EXPECT_TRUE(std::regex_match(c.fingerprintColons, kColons)) << c.fingerprintColons;
    EXPECT_EQ(c.fingerprintColons.size(), 95u);

    // --cert-fingerprint reads the same value without writing.
    const ServerCert r = readServerCert(d.path);
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_FALSE(r.generated);
    EXPECT_EQ(r.pemPath, c.pemPath);
    EXPECT_EQ(r.fingerprint, c.fingerprint);
    EXPECT_EQ(r.fingerprintColons, c.fingerprintColons);
}

TEST(ServerCert, LaterStartsReuseTheKey) {
    TempDir d;
    const ServerCert first = loadOrCreateServerCert(options(d.path));
    ASSERT_TRUE(first.ok) << first.error;
    const std::string pem = readFile(first.pemPath);
    for (int i = 0; i < 2; ++i) {
        const ServerCert again = loadOrCreateServerCert(options(d.path));
        ASSERT_TRUE(again.ok) << again.error;
        EXPECT_FALSE(again.generated);
        EXPECT_EQ(again.fingerprint, first.fingerprint);
        EXPECT_EQ(again.fingerprintColons, first.fingerprintColons);
    }
    // A new device name or host name keeps the key and certificate: the pinned identity stays.
    const ServerCert renamed = loadOrCreateServerCert({d.path, "Another name", "other-host"});
    ASSERT_TRUE(renamed.ok) << renamed.error;
    EXPECT_FALSE(renamed.generated);
    EXPECT_EQ(renamed.fingerprint, first.fingerprint);
    EXPECT_EQ(readFile(first.pemPath), pem);
    EXPECT_EQ(modeOf(first.pemPath), fileMode(0600));
}

TEST(ServerCert, TwoDevicesNeverShareAKey) {
    TempDir a, b;
    const ServerCert ca = loadOrCreateServerCert(options(a.path));
    const ServerCert cb = loadOrCreateServerCert(options(b.path));
    ASSERT_TRUE(ca.ok && cb.ok) << ca.error << cb.error;
    EXPECT_NE(ca.fingerprint, cb.fingerprint);
    EXPECT_NE(keyBlock(readFile(ca.pemPath)), keyBlock(readFile(cb.pemPath)));
    ParsedPem pa(readFile(ca.pemPath)), pb(readFile(cb.pemPath));
    ASSERT_EQ(pa.crtRet, 0);
    ASSERT_EQ(pb.crtRet, 0);
    EXPECT_NE(bytes(pa.crt.serial), bytes(pb.crt.serial));
}

// RFC 4514 special characters and Vietnamese in the device name reach the CN unchanged; a host
// name with capitals (the BL335's own is "BL335-bliiot") reaches the SAN unchanged.
TEST(ServerCert, NameAndHostAreWrittenExactly) {
    const std::string name = "Trạm bơm #1, \"A+B\" <x>;=\\";
    TempDir d;
    const ServerCert c = loadOrCreateServerCert({d.path, name, "BL335-bliiot"});
    ASSERT_TRUE(c.ok) << c.error;
    ParsedPem p(readFile(c.pemPath));
    ASSERT_EQ(p.crtRet, 0);
    EXPECT_EQ(onlyCommonName(p.crt.subject), "mAT " + name);
    EXPECT_EQ(p.crt.subject.val.tag, MBEDTLS_ASN1_UTF8_STRING);
    EXPECT_EQ(dnsNames(p.crt), std::vector<std::string>{"BL335-bliiot"});
}

// The SAN carries a DNS host name (letters, digits, hyphens; labels of 1–63, at most 253 in
// all). Anything else stays out of the certificate instead of making a malformed dNSName.
TEST(ServerCert, OnlyAValidHostNameGoesIntoTheSan) {
    const std::string label63(63, 'a');
    const std::string name253 =
        label63 + "." + label63 + "." + label63 + "." + std::string(61, 'b');
    ASSERT_EQ(name253.size(), 253u);
    for (const std::string& host :
         {std::string("localhost"), std::string("a.b-c.d9"), label63, name253, std::string("x")}) {
        TempDir d;
        const ServerCert c = loadOrCreateServerCert({d.path, "BL335-01", host});
        ASSERT_TRUE(c.ok) << host << ": " << c.error;
        ParsedPem p(readFile(c.pemPath));
        ASSERT_EQ(p.crtRet, 0) << host;
        EXPECT_EQ(dnsNames(p.crt), std::vector<std::string>{host});
    }
    for (const std::string& host :
         {std::string(""), std::string("under_score"), std::string("-lead"), std::string("trail-"),
          std::string("a..b"), std::string("dot."), std::string(".dot"), std::string("sp ace"),
          std::string("trạm"), label63 + "a", name253 + "c", std::string("a\nb")}) {
        TempDir d;
        const ServerCert c = loadOrCreateServerCert({d.path, "BL335-01", host});
        ASSERT_TRUE(c.ok) << host << ": " << c.error;
        ParsedPem p(readFile(c.pemPath));
        ASSERT_EQ(p.crtRet, 0) << host;
        EXPECT_EQ(dnsNames(p.crt), std::vector<std::string>{}) << host;
    }
}

// --- Damaged files and wrong permissions: cert-error, the file stays as it is

TEST(ServerCert, DamagedFileIsNeverReplaced) {
    TempDir good, other;
    const ServerCert g = loadOrCreateServerCert(options(good.path));
    const ServerCert o = loadOrCreateServerCert(options(other.path));
    ASSERT_TRUE(g.ok && o.ok) << g.error << o.error;
    const std::string pem = readFile(g.pemPath);
    const std::string der = certDer(pem);
    ASSERT_FALSE(der.empty());
    // Still parses, but no longer matches its signature: a flipped bit in the signature value, and
    // one in the CN of the signed part.
    std::string badSignature = der;
    badSignature.back() = static_cast<char>(badSignature.back() ^ 0x01);
    std::string badName = der;
    const size_t cn = badName.find("mAT BL335-01");
    ASSERT_NE(cn, std::string::npos);
    badName[cn] = 'n';

    const std::vector<std::pair<std::string, std::string>> cases = {
        {"empty", ""},
        {"not PEM", "not a certificate\n"},
        {"key only", keyBlock(pem)},
        {"certificate only", certBlock(pem)},
        {"key of another device", keyBlock(readFile(o.pemPath)) + certBlock(pem)},
        {"cut in the middle", pem.substr(0, pem.size() / 2)},
        {"cut in the certificate", pem.substr(0, pem.size() - 100)},
        {"signature changed", keyBlock(pem) + certPem(badSignature)},
        {"signed part changed", keyBlock(pem) + certPem(badName)},
    };
    for (const auto& kase : cases) {
        SCOPED_TRACE(kase.first);
        TempDir d;
        plantPem(d.path, kase.second);
        const std::string path = d.path + "/tls/server.pem";
        const ServerCert c = loadOrCreateServerCert(options(d.path));
        EXPECT_FALSE(c.ok);
        EXPECT_STREQ(c.httpsState(), "cert-error");
        EXPECT_FALSE(c.generated);
        EXPECT_EQ(c.fingerprint, "");
        EXPECT_EQ(c.fingerprintColons, "");
        EXPECT_NE(c.error, "");
        EXPECT_EQ(c.pemPath, path);
        EXPECT_EQ(readFile(path), kase.second);
        EXPECT_EQ(modeOf(path), fileMode(0600));
        EXPECT_EQ(listDir(d.path + "/tls"), std::vector<std::string>{"server.pem"});
        EXPECT_FALSE(readServerCert(d.path).ok);
    }
    // The good file itself passes the same checks.
    TempDir d;
    plantPem(d.path, pem);
    const ServerCert c = loadOrCreateServerCert(options(d.path));
    EXPECT_TRUE(c.ok) << c.error;
    EXPECT_FALSE(c.generated);
    EXPECT_EQ(c.fingerprint, g.fingerprint);
}

TEST(ServerCert, WrongPermissionsAreCertError) {
    TempDir good;
    const ServerCert g = loadOrCreateServerCert(options(good.path));
    ASSERT_TRUE(g.ok) << g.error;
    const std::string pem = readFile(g.pemPath);
    // The file: group or others may do anything at all.
    for (const mode_t mode : {0640, 0604, 0644, 0660, 0666, 0610, 0601}) {
        SCOPED_TRACE(std::to_string(mode));
        TempDir d;
        plantPem(d.path, pem, mode);
        const std::string path = d.path + "/tls/server.pem";
        const ServerCert c = loadOrCreateServerCert(options(d.path));
        EXPECT_FALSE(c.ok);
        EXPECT_FALSE(c.generated);
        EXPECT_EQ(c.fingerprint, "");
        EXPECT_NE(c.error, "");
        EXPECT_EQ(readFile(path), pem);
        EXPECT_EQ(modeOf(path), fileMode(mode));
        EXPECT_FALSE(readServerCert(d.path).ok);
    }
    // The directory: anyone else could list it or replace the file.
    for (const mode_t mode : {0750, 0705, 0755, 0777, 0710}) {
        SCOPED_TRACE(std::to_string(mode));
        TempDir d;
        plantPem(d.path, pem);
        ::chmod((d.path + "/tls").c_str(), mode);
        const ServerCert c = loadOrCreateServerCert(options(d.path));
        EXPECT_FALSE(c.ok);
        EXPECT_FALSE(c.generated);
        EXPECT_NE(c.error, "");
        EXPECT_EQ(readFile(d.path + "/tls/server.pem"), pem);
        EXPECT_EQ(modeOf(d.path + "/tls"), dirMode(mode));
        EXPECT_FALSE(readServerCert(d.path).ok);
    }
    // Even with the file missing: no new key in a directory others can write to.
    TempDir d;
    ::mkdir((d.path + "/tls").c_str(), 0700);
    ::chmod((d.path + "/tls").c_str(), 0777);
    EXPECT_FALSE(loadOrCreateServerCert(options(d.path)).ok);
    EXPECT_EQ(listDir(d.path + "/tls"), std::vector<std::string>{});
}

TEST(ServerCert, LinksAndOddFileTypesAreCertError) {
    TempDir good;
    const ServerCert g = loadOrCreateServerCert(options(good.path));
    ASSERT_TRUE(g.ok) << g.error;
    {
        SCOPED_TRACE("server.pem is a symbolic link to a good file");
        TempDir d;
        ::mkdir((d.path + "/tls").c_str(), 0700);
        ASSERT_EQ(::symlink(g.pemPath.c_str(), (d.path + "/tls/server.pem").c_str()), 0);
        const ServerCert c = loadOrCreateServerCert(options(d.path));
        EXPECT_FALSE(c.ok);
        EXPECT_FALSE(c.generated);
        EXPECT_EQ(modeOf(d.path + "/tls/server.pem") & S_IFMT, static_cast<mode_t>(S_IFLNK));
        EXPECT_FALSE(readServerCert(d.path).ok);
    }
    {
        SCOPED_TRACE("tls is a symbolic link to a good directory");
        TempDir d;
        ASSERT_EQ(::symlink((good.path + "/tls").c_str(), (d.path + "/tls").c_str()), 0);
        EXPECT_FALSE(loadOrCreateServerCert(options(d.path)).ok);
        EXPECT_FALSE(readServerCert(d.path).ok);
    }
    {
        SCOPED_TRACE("server.pem is a directory");
        TempDir d;
        ::mkdir((d.path + "/tls").c_str(), 0700);
        ::mkdir((d.path + "/tls/server.pem").c_str(), 0700);
        EXPECT_FALSE(loadOrCreateServerCert(options(d.path)).ok);
        EXPECT_EQ(modeOf(d.path + "/tls/server.pem") & S_IFMT, static_cast<mode_t>(S_IFDIR));
    }
    {
        SCOPED_TRACE("tls is a regular file");
        TempDir d;
        writeFile(d.path + "/tls", "x", 0600);
        EXPECT_FALSE(loadOrCreateServerCert(options(d.path)).ok);
        EXPECT_EQ(readFile(d.path + "/tls"), "x");
    }
}

// --- Writing: missing directories, failures, crash leftovers, several writers

TEST(ServerCert, MissingDataDirectoriesAreCreated) {
    TempDir d;
    const ServerCert c = loadOrCreateServerCert(options(d.path + "/var/lib/mat-runtime"));
    ASSERT_TRUE(c.ok) << c.error;
    EXPECT_TRUE(c.generated);
    EXPECT_EQ(modeOf(d.path + "/var/lib/mat-runtime/tls"), dirMode(0700));
    EXPECT_EQ(modeOf(c.pemPath), fileMode(0600));
}

TEST(ServerCert, UnusableDataDirectoryIsCertError) {
    TempDir d;
    writeFile(d.path + "/file", "x", 0600);
    for (const ServerCert& c :
         {loadOrCreateServerCert(options(d.path + "/file")),
          regenerateServerCert(options(d.path + "/file")), readServerCert(d.path + "/file")}) {
        EXPECT_FALSE(c.ok);
        EXPECT_FALSE(c.generated);
        EXPECT_NE(c.error, "");
    }
    EXPECT_EQ(readFile(d.path + "/file"), "x");
}

TEST(ServerCert, ReadNeverWrites) {
    TempDir d;
    const ServerCert r = readServerCert(d.path);
    EXPECT_FALSE(r.ok);
    EXPECT_FALSE(r.generated);
    EXPECT_NE(r.error, "");
    EXPECT_EQ(r.pemPath, d.path + "/tls/server.pem");
    EXPECT_EQ(listDir(d.path), std::vector<std::string>{});
}

// A power cut while writing leaves the temporary file behind; the next start still writes.
TEST(ServerCert, LeftoverTemporaryFileIsReplaced) {
    TempDir d;
    ::mkdir((d.path + "/tls").c_str(), 0700);
    writeFile(d.path + "/tls/server.pem.tmp", "half written", 0600);
    const ServerCert c = loadOrCreateServerCert(options(d.path));
    ASSERT_TRUE(c.ok) << c.error;
    EXPECT_TRUE(c.generated);
    EXPECT_EQ(listDir(d.path + "/tls"), std::vector<std::string>{"server.pem"});
}

// A start-up racing another start-up (or --regen-cert) ends with one complete key and every
// caller agreeing with the file.
TEST(ServerCert, ConcurrentFirstStartsAgreeOnOneKey) {
    TempDir d;
    std::vector<ServerCert> results(8);
    std::vector<std::thread> threads;
    for (size_t i = 0; i < results.size(); ++i)
        threads.emplace_back([&, i] { results[i] = loadOrCreateServerCert(options(d.path)); });
    for (auto& t : threads) t.join();
    int generated = 0;
    for (const ServerCert& r : results) {
        ASSERT_TRUE(r.ok) << r.error;
        generated += r.generated ? 1 : 0;
        EXPECT_EQ(r.fingerprint, results[0].fingerprint);
    }
    EXPECT_EQ(generated, 1);
    ParsedPem p(readFile(d.path + "/tls/server.pem"));
    ASSERT_EQ(p.crtRet, 0);
    EXPECT_EQ(fingerprintOf(p.crt), results[0].fingerprint);
    EXPECT_EQ(listDir(d.path + "/tls"), std::vector<std::string>{"server.pem"});
}

TEST(ServerCert, ConcurrentRegenerationsLeaveOneCompleteFile) {
    TempDir d;
    std::vector<ServerCert> results(6);
    std::vector<std::thread> threads;
    for (size_t i = 0; i < results.size(); ++i)
        threads.emplace_back([&, i] { results[i] = regenerateServerCert(options(d.path)); });
    for (auto& t : threads) t.join();
    const ServerCert now = readServerCert(d.path);
    ASSERT_TRUE(now.ok) << now.error;
    bool fromOneWriter = false;
    for (const ServerCert& r : results) {
        ASSERT_TRUE(r.ok) << r.error;
        EXPECT_TRUE(r.generated);
        fromOneWriter = fromOneWriter || r.fingerprint == now.fingerprint;
    }
    EXPECT_TRUE(fromOneWriter);
    EXPECT_EQ(listDir(d.path + "/tls"), std::vector<std::string>{"server.pem"});
}

// --- --regen-cert

TEST(ServerCert, RegenerateMakesANewKey) {
    TempDir d;
    const ServerCert first = loadOrCreateServerCert(options(d.path));
    ASSERT_TRUE(first.ok) << first.error;
    const std::string oldPem = readFile(first.pemPath);
    const ServerCert next = regenerateServerCert(options(d.path));
    ASSERT_TRUE(next.ok) << next.error;
    EXPECT_TRUE(next.generated);
    EXPECT_EQ(next.pemPath, first.pemPath);
    EXPECT_TRUE(std::regex_match(next.fingerprint, kHex64)) << next.fingerprint;
    EXPECT_NE(next.fingerprint, first.fingerprint);
    EXPECT_NE(next.fingerprintColons, first.fingerprintColons);
    const std::string newPem = readFile(next.pemPath);
    EXPECT_NE(keyBlock(newPem), keyBlock(oldPem));  // a new key, not only a new certificate
    EXPECT_EQ(modeOf(next.pemPath), fileMode(0600));
    EXPECT_EQ(listDir(d.path + "/tls"), std::vector<std::string>{"server.pem"});
    ParsedPem p(newPem);
    ASSERT_EQ(p.crtRet, 0);
    EXPECT_EQ(fingerprintOf(p.crt), next.fingerprint);
    // Later starts use the new one.
    const ServerCert again = loadOrCreateServerCert(options(d.path));
    ASSERT_TRUE(again.ok) << again.error;
    EXPECT_FALSE(again.generated);
    EXPECT_EQ(again.fingerprint, next.fingerprint);
}

TEST(ServerCert, RegenerateRepairsWhatStartUpRefuses) {
    TempDir good;
    const ServerCert g = loadOrCreateServerCert(options(good.path));
    ASSERT_TRUE(g.ok) << g.error;
    const std::string pem = readFile(g.pemPath);
    struct Case {
        const char* name;
        std::string text;
        mode_t filePerm, dirPerm;
    };
    for (const Case& k :
         {Case{"damaged", "garbage", 0600, 0700}, Case{"file 0644", pem, 0644, 0700},
          Case{"directory 0755", pem, 0600, 0755}}) {
        SCOPED_TRACE(k.name);
        TempDir d;
        plantPem(d.path, k.text, k.filePerm);
        ::chmod((d.path + "/tls").c_str(), k.dirPerm);
        ASSERT_FALSE(loadOrCreateServerCert(options(d.path)).ok);
        const ServerCert r = regenerateServerCert(options(d.path));
        ASSERT_TRUE(r.ok) << r.error;
        EXPECT_TRUE(r.generated);
        EXPECT_NE(r.fingerprint, g.fingerprint);
        EXPECT_EQ(modeOf(d.path + "/tls/server.pem"), fileMode(0600));
        EXPECT_EQ(modeOf(d.path + "/tls"), dirMode(0700));
        const ServerCert after = loadOrCreateServerCert(options(d.path));
        ASSERT_TRUE(after.ok) << after.error;
        EXPECT_FALSE(after.generated);
        EXPECT_EQ(after.fingerprint, r.fingerprint);
    }
    {
        SCOPED_TRACE("nothing there yet");
        TempDir d;
        const ServerCert r = regenerateServerCert(options(d.path));
        ASSERT_TRUE(r.ok) << r.error;
        EXPECT_TRUE(r.generated);
        EXPECT_EQ(readServerCert(d.path).fingerprint, r.fingerprint);
    }
}

// --- device-id

TEST(DeviceId, MadeOnceThenKept) {
    TempDir d;
    const DeviceId a = loadOrCreateDeviceId(d.path);
    EXPECT_TRUE(a.created);
    EXPECT_EQ(a.warning, "");
    EXPECT_TRUE(std::regex_match(a.id, kUuidV4)) << a.id;
    EXPECT_EQ(deviceIdPath(d.path), d.path + "/device-id");
    EXPECT_EQ(readFile(d.path + "/device-id"), a.id + "\n");
    EXPECT_EQ(modeOf(d.path + "/device-id"), fileMode(0600));
    EXPECT_EQ(listDir(d.path), std::vector<std::string>{"device-id"});
    for (int i = 0; i < 2; ++i) {
        const DeviceId b = loadOrCreateDeviceId(d.path);
        EXPECT_FALSE(b.created);
        EXPECT_EQ(b.id, a.id);
        EXPECT_EQ(b.warning, "");
    }
    EXPECT_EQ(readFile(d.path + "/device-id"), a.id + "\n");
    TempDir other;
    EXPECT_NE(loadOrCreateDeviceId(other.path).id, a.id);
}

TEST(DeviceId, KeepsAnIdWithoutTheNewline) {
    TempDir d;
    const std::string id = "4f9c2a8e-6d1b-4c3a-9e57-0b2f1d6c8a10";
    writeFile(d.path + "/device-id", id, 0600);
    const DeviceId r = loadOrCreateDeviceId(d.path);
    EXPECT_FALSE(r.created);
    EXPECT_EQ(r.id, id);
    EXPECT_EQ(r.warning, "");
    EXPECT_EQ(readFile(d.path + "/device-id"), id);
}

// It only lets a Studio recognise the device: a damaged one is replaced, with a warning to log.
TEST(DeviceId, DamagedFileIsReplacedWithAWarning) {
    const std::string id = "4f9c2a8e-6d1b-4c3a-9e57-0b2f1d6c8a10";
    for (const std::string& text :
         {std::string(""), std::string("garbage\n"),
          std::string("4F9C2A8E-6D1B-4C3A-9E57-0B2F1D6C8A10\n"),
          std::string("4f9c2a8e6d1b4c3a9e570b2f1d6c8a10\n"), id + "\n\n", id + " \n", id + "0\n",
          id.substr(1) + "\n", std::string("4f9c2a8e-6d1b-1c3a-9e57-0b2f1d6c8a10\n"),
          std::string("4f9c2a8e-6d1b-4c3a-7e57-0b2f1d6c8a10\n"), std::string(4096, 'a')}) {
        SCOPED_TRACE(text.substr(0, 40));
        TempDir d;
        writeFile(d.path + "/device-id", text, 0644);
        const DeviceId r = loadOrCreateDeviceId(d.path);
        EXPECT_TRUE(r.created);
        EXPECT_NE(r.warning, "");
        EXPECT_TRUE(std::regex_match(r.id, kUuidV4)) << r.id;
        EXPECT_EQ(readFile(d.path + "/device-id"), r.id + "\n");
        EXPECT_EQ(modeOf(d.path + "/device-id"), fileMode(0600));
        EXPECT_EQ(listDir(d.path), std::vector<std::string>{"device-id"});
        const DeviceId again = loadOrCreateDeviceId(d.path);
        EXPECT_FALSE(again.created);
        EXPECT_EQ(again.id, r.id);
    }
}

TEST(DeviceId, UnwritableDirectoryStillGivesAnId) {
    TempDir d;
    writeFile(d.path + "/file", "x", 0600);
    const DeviceId r = loadOrCreateDeviceId(d.path + "/file");
    EXPECT_TRUE(std::regex_match(r.id, kUuidV4)) << r.id;
    EXPECT_TRUE(r.created);
    EXPECT_NE(r.warning, "");
    EXPECT_EQ(readFile(d.path + "/file"), "x");
}

TEST(DeviceId, MissingDataDirectoryIsCreated) {
    TempDir d;
    const DeviceId r = loadOrCreateDeviceId(d.path + "/a/b");
    EXPECT_TRUE(r.created);
    EXPECT_EQ(r.warning, "");
    EXPECT_EQ(readFile(d.path + "/a/b/device-id"), r.id + "\n");
}

#ifdef MAT_TLS_TEST_SUPPORT

namespace {

size_t discard(char*, size_t size, size_t n, void*) { return size * n; }

// The certificate the server sent, as libcurl (OpenSSL backend) reports it (CURLOPT_CERTINFO).
std::string peerCertificatePem(int port) {
    curl_global_init(CURL_GLOBAL_DEFAULT);
    CURL* c = curl_easy_init();
    std::string pem;
    if (c == nullptr) return pem;
    const std::string url = test::httpsUrl(port) + "/tls";
    curl_easy_setopt(c, CURLOPT_URL, url.c_str());
    curl_easy_setopt(c, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(c, CURLOPT_PROXY, "");
    curl_easy_setopt(c, CURLOPT_TIMEOUT_MS, 10000L);
    curl_easy_setopt(c, CURLOPT_SSL_VERIFYPEER, 0L);  // pinned by fingerprint, like the Studio
    curl_easy_setopt(c, CURLOPT_SSL_VERIFYHOST, 0L);
    curl_easy_setopt(c, CURLOPT_CERTINFO, 1L);
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, discard);
    curl_certinfo* info = nullptr;
    if (curl_easy_perform(c) == CURLE_OK &&
        curl_easy_getinfo(c, CURLINFO_CERTINFO, &info) == CURLE_OK && info != nullptr &&
        info->num_of_certs > 0)
        for (const curl_slist* s = info->certinfo[0]; s != nullptr; s = s->next)
            if (std::strncmp(s->data, "Cert:", 5) == 0) pem = s->data + 5;
    curl_easy_cleanup(c);
    curl_global_cleanup();
    return pem;
}

std::string lines(const std::vector<std::string>& v) {
    std::string s;
    for (const auto& l : v) s += l + "\n";
    return s;
}

}  // namespace

// CivetWeb (civetweb_runtime, Mbed TLS) serves the file as ssl_certificate; a client completes
// TLS 1.2 and 1.3 handshakes and sees the certificate whose SHA-256 is the fingerprint.
TEST(ServerCertTls, ClientSeesTheFingerprintOfTheFile) {
    TempDir d;
    const ServerCert c = loadOrCreateServerCert(options(d.path));
    ASSERT_TRUE(c.ok) << c.error;
    test::TlsTestServer s({"ssl_certificate", c.pemPath});
    ASSERT_NE(s.port, 0) << lines(s.errorLog());
    for (const test::TlsVersion v : {test::TlsVersion::Tls12, test::TlsVersion::Tls13}) {
        const test::HttpResult r = test::httpsGet(s.port, "/tls", {v});
        ASSERT_TRUE(r.ok()) << r.error << "\n" << r.info;
        EXPECT_EQ(r.body, "ok-tls");
    }
    const std::string peer = peerCertificatePem(s.port);
    ParsedPem p(peer);
    ASSERT_EQ(p.crtRet, 0) << peer;
    EXPECT_EQ(fingerprintOf(p.crt), c.fingerprint);
}

// The image's OpenSSL 1.1.1f reads the certificate and key, prints the expected fields and the
// fingerprint (the form --cert-fingerprint prints, T046), sees it over TLS, and accepts it under
// strict X.509 rules for the TLS server purpose. -partial_chain: OpenSSL takes a self-signed
// certificate as its own issuer only when keyUsage has keyCertSign, which RFC 5280 §4.2.1.9 forbids
// without CA:TRUE; the option trusts exactly the certificate of the file, as a pin does.
TEST(ServerCertTls, OpensslAcceptsTheCertificate) {
    if (!test::haveTool("openssl"))
        GTEST_SKIP() << "openssl is not installed (toolchain image, T008)";
    TempDir d;
    const ServerCert c = loadOrCreateServerCert(options(d.path));
    ASSERT_TRUE(c.ok) << c.error;

    const test::CommandResult text =
        test::runCommand("openssl x509 -in " + c.pemPath + " -noout -text");
    ASSERT_EQ(text.code, 0) << text.out;
    for (const char* want :
         {"Version: 3 (0x2)", "Signature Algorithm: ecdsa-with-SHA256", "Issuer: CN = mAT BL335-01",
          "Not Before: Jan  1 00:00:00 2000 GMT", "Not After : Dec 31 23:59:59 9999 GMT",
          "Subject: CN = mAT BL335-01", "Public Key Algorithm: id-ecPublicKey",
          "ASN1 OID: prime256v1", "CA:FALSE", "X509v3 Key Usage: critical", "Digital Signature",
          "TLS Web Server Authentication", "DNS:bl335-test"})
        EXPECT_NE(text.out.find(want), std::string::npos) << want << "\n" << text.out;

    const test::CommandResult fp =
        test::runCommand("openssl x509 -in " + c.pemPath + " -noout -fingerprint -sha256");
    EXPECT_EQ(fp.out, "SHA256 Fingerprint=" + c.fingerprintColons + "\n");

    const test::CommandResult key =
        test::runCommand("openssl ec -in " + c.pemPath + " -noout -check");
    EXPECT_EQ(key.code, 0) << key.out;
    EXPECT_NE(key.out.find("EC Key valid."), std::string::npos) << key.out;

    const test::CommandResult purpose =
        test::runCommand("openssl x509 -in " + c.pemPath + " -noout -purpose");
    EXPECT_NE(purpose.out.find("\nSSL server : Yes\n"), std::string::npos) << purpose.out;
    EXPECT_NE(purpose.out.find("\nSSL server CA : No\n"), std::string::npos) << purpose.out;

    const test::CommandResult verify =
        test::runCommand("openssl verify -partial_chain -x509_strict -purpose sslserver -CAfile " +
                         c.pemPath + " " + c.pemPath);
    EXPECT_EQ(verify.code, 0) << verify.out;
    EXPECT_EQ(verify.out, c.pemPath + ": OK\n");

    test::TlsTestServer s({"ssl_certificate", c.pemPath});
    ASSERT_NE(s.port, 0) << lines(s.errorLog());
    const test::CommandResult seen = test::runCommand(
        "timeout 10 openssl s_client -connect 127.0.0.1:" + std::to_string(s.port) +
        " </dev/null 2>/dev/null | openssl x509 -noout -fingerprint -sha256");
    EXPECT_EQ(seen.out, "SHA256 Fingerprint=" + c.fingerprintColons + "\n");
}

#endif  // MAT_TLS_TEST_SUPPORT
