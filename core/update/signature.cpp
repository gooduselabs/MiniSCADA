#include "core/update/signature.hpp"

#include <dirent.h>
#include <sys/stat.h>

#include <algorithm>
#include <cstdio>

#include "core/update/envelope.hpp"
#include "core/update/update_error.hpp"
#include "mbedtls/ecp.h"
#include "mbedtls/pem.h"
#include "mbedtls/pk.h"
#include "mbedtls/sha256.h"

namespace mat::update {

namespace {

constexpr size_t kPemMaxBytes = 16 * 1024;

std::string hexOf(const unsigned char* p, size_t n) {
    static const char* d = "0123456789abcdef";
    std::string s;
    s.reserve(n * 2);
    for (size_t i = 0; i < n; ++i) {
        s.push_back(d[p[i] >> 4]);
        s.push_back(d[p[i] & 15]);
    }
    return s;
}

bool endsWith(const std::string& s, const std::string& x) {
    return s.size() >= x.size() && s.compare(s.size() - x.size(), x.size(), x) == 0;
}

}  // namespace

struct PublicKey::Impl {
    mbedtls_pk_context pk;
    Impl() { mbedtls_pk_init(&pk); }
    ~Impl() { mbedtls_pk_free(&pk); }
};

PublicKey::PublicKey() = default;
PublicKey::~PublicKey() = default;
PublicKey::PublicKey(PublicKey&&) noexcept = default;
PublicKey& PublicKey::operator=(PublicKey&&) noexcept = default;

bool PublicKey::parsePem(std::string_view pem, std::string& err) {
    impl_.reset();
    keyId_.clear();
    if (pem.empty() || pem.size() > kPemMaxBytes) {
        err = "empty or larger than 16 KiB";
        return false;
    }
    const std::string text(pem);  // NUL-terminated for mbedtls_pem_read_buffer
    mbedtls_pem_context ctx;
    mbedtls_pem_init(&ctx);
    size_t used = 0;
    int rc = mbedtls_pem_read_buffer(&ctx, "-----BEGIN PUBLIC KEY-----", "-----END PUBLIC KEY-----",
                                     reinterpret_cast<const unsigned char*>(text.c_str()), nullptr,
                                     0, &used);
    if (rc != 0) {
        mbedtls_pem_free(&ctx);
        err = "not a PEM PUBLIC KEY";
        return false;
    }
    size_t derLen = 0;
    const unsigned char* der = mbedtls_pem_get_buffer(&ctx, &derLen);
    auto impl = std::make_unique<Impl>();
    rc = mbedtls_pk_parse_public_key(&impl->pk, der, derLen);
    unsigned char digest[32];
    if (rc == 0) mbedtls_sha256(der, derLen, digest, 0);
    mbedtls_pem_free(&ctx);
    if (rc != 0) {
        err = "not a public key";
        return false;
    }
    if (!mbedtls_pk_can_do(&impl->pk, MBEDTLS_PK_ECDSA) ||
        mbedtls_ecp_keypair_get_group_id(mbedtls_pk_ec(impl->pk)) != MBEDTLS_ECP_DP_SECP256R1) {
        err = "not an ECDSA P-256 key";
        return false;
    }
    keyId_ = "sha256:" + hexOf(digest, sizeof digest);
    impl_ = std::move(impl);
    return true;
}

bool PublicKey::verifyDigest(const uint8_t digest[32], const uint8_t* sig, size_t sigLen) const {
    if (!impl_ || !sig || sigLen == 0 || sigLen > kSigMaxBytes) return false;
    return mbedtls_pk_verify(&impl_->pk, MBEDTLS_MD_SHA256, digest, 32, sig, sigLen) == 0;
}

bool PublicKey::verify(const uint8_t* data, size_t n, const uint8_t* sig, size_t sigLen) const {
    unsigned char digest[32];
    if (mbedtls_sha256(data, n, digest, 0) != 0) return false;
    return verifyDigest(digest, sig, sigLen);
}

const PublicKey* KeySet::verify(const uint8_t* data, size_t n, const uint8_t* sig,
                                size_t sigLen) const {
    unsigned char digest[32];
    if (mbedtls_sha256(data, n, digest, 0) != 0) return nullptr;
    for (const PublicKey& k : keys)
        if (k.verifyDigest(digest, sig, sigLen)) return &k;
    return nullptr;
}

KeySet loadTrustedKeys(const std::string& dir) {
    KeySet ks;
    std::vector<std::string> names;
    if (DIR* d = ::opendir(dir.c_str())) {
        while (dirent* e = ::readdir(d)) {
            const std::string n = e->d_name;
            if (n.size() > 4 && endsWith(n, ".pem") && n[0] != '.') names.push_back(n);
        }
        ::closedir(d);
    }
    std::sort(names.begin(), names.end());
    for (const std::string& n : names) {
        const std::string path = dir + "/" + n;
        struct stat st {};
        if (::stat(path.c_str(), &st) != 0 || !S_ISREG(st.st_mode)) {
            ks.warnings.push_back(n + ": not a regular file");
            continue;
        }
        if (static_cast<uint64_t>(st.st_size) > kPemMaxBytes) {
            ks.warnings.push_back(n + ": larger than 16 KiB");
            continue;
        }
        if (ks.keys.size() >= kMaxTrustedKeys) {
            ks.warnings.push_back(n + ": more than 4 trusted keys, ignored");
            continue;
        }
        std::string text;
        PublicKey k;
        std::string err;
        if (!readFileLimited(path, kPemMaxBytes, text) || !k.parsePem(text, err)) {
            if (err.empty()) err = "cannot read";
            ks.warnings.push_back(n + ": " + err);
            continue;
        }
        std::string label = n.substr(0, n.size() - 4);
        if (endsWith(label, ".pub")) label.resize(label.size() - 4);
        k.label = label;
        k.file = path;
        ks.keys.push_back(std::move(k));
    }
    return ks;
}

std::string keyIdOfPem(std::string_view pem) {
    PublicKey k;
    std::string err;
    return k.parsePem(pem, err) ? k.keyId() : std::string();
}

}  // namespace mat::update
