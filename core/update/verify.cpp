#include "core/update/verify.hpp"

#include <sys/stat.h>

#include <algorithm>

#include "core/update/payload.hpp"
#include "mbedtls/sha256.h"

namespace mat::update {

namespace {

std::string hexOf(const unsigned char* p, size_t n) {
    static const char* d = "0123456789abcdef";
    std::string s;
    for (size_t i = 0; i < n; ++i) {
        s.push_back(d[p[i] >> 4]);
        s.push_back(d[p[i] & 15]);
    }
    return s;
}

// Hashes what the first pass reads (the whole package, once).
class HashingSource : public Source {
   public:
    explicit HashingSource(Source& in) : in_(in) {
        mbedtls_sha256_init(&ctx_);
        mbedtls_sha256_starts(&ctx_, 0);
    }
    ~HashingSource() override { mbedtls_sha256_free(&ctx_); }
    size_t read(uint8_t* p, size_t n) override {
        const size_t k = in_.read(p, n);
        if (on_ && k) mbedtls_sha256_update(&ctx_, p, k);
        return k;
    }
    bool seek(uint64_t offset) override {
        on_ = false;
        return in_.seek(offset);
    }
    std::string finish() {
        unsigned char d[32];
        mbedtls_sha256_finish(&ctx_, d);
        on_ = false;
        return hexOf(d, 32);
    }

   private:
    Source& in_;
    mbedtls_sha256_context ctx_{};
    bool on_ = true;
};

Error keysMissing() { return Error{"UPDATE_KEYS_MISSING", "", "no trusted key", 503, kExitKeys}; }
Error badSignature() {
    return Error{"UPDATE_SIGNATURE_INVALID", "", "no trusted key verifies the signature", 403,
                 kExitSignature};
}

bool readSmall(const std::string& path, size_t max, std::string& out) {
    return readFileLimited(path, max, out);
}

}  // namespace

const char* buildArch() {
#if defined(__arm__)
    return "armhf";
#elif defined(__aarch64__)
    return "arm64";
#elif defined(__x86_64__)
    return "x64";
#else
    return "unknown";
#endif
}

std::optional<Error> verifyPackage(Source& raw, uint64_t size, const KeySet& keys,
                                   const DeviceContext& device, Verified& out) {
    // 1. size
    if (size > device.maxPackageBytes)
        return Error{"UPDATE_TOO_LARGE", "", "package larger than maxPackageMiB", 413,
                     kExitInvalid};
    if (keys.keys.empty()) return keysMissing();
    HashingSource in(raw);
    // 2. envelope, members 1 and 2
    EnvelopeHead head;
    if (auto e = readHead(in, head)) return e;
    // 3. signature, before anything of the manifest is read
    const PublicKey* signer = keys.verify(reinterpret_cast<const uint8_t*>(head.manifest.data()),
                                          head.manifest.size(), head.sig.data(), head.sig.size());
    if (!signer) return badSignature();
    Manifest m;
    if (auto e = parseManifest(head.manifest, m)) return e;
    // 4. payload digest (member 3 hashed as it is read) and the end of the archive
    mbedtls_sha256_context sha;
    mbedtls_sha256_init(&sha);
    mbedtls_sha256_starts(&sha, 0);
    PayloadInfo info;
    auto e = readPayload(in, device.maxPackageBytes, head, info,
                         [&](const uint8_t* p, size_t n) { mbedtls_sha256_update(&sha, p, n); });
    unsigned char digest[32];
    mbedtls_sha256_finish(&sha, digest);
    mbedtls_sha256_free(&sha);
    if (e) return e;
    out.packageSha256 = in.finish();
    if (info.size != m.payloadSize || hexOf(digest, 32) != m.payloadSha256)
        return invalid("PAYLOAD_DIGEST", "payloadSha256");
    // 5. files[] (or the keyset), then the listing of the payload
    if (auto fe = checkFileList(m, signer->keyId())) return fe;
    if (m.kind == "runtime") {
        if (!in.seek(info.offset))
            return invalid("ENVELOPE_TRUNCATED", "cannot read the payload again");
        if (auto pe = scanPayload(in, info.size, m)) return pe;
    }
    // 6. product and arch, releaseSeq, minFromVersion, projectFormatMax, updater protocol
    if (m.product != "mat-runtime") return invalid("PRODUCT", m.product);
    if (!device.arch.empty() && m.arch != device.arch)
        return refused("UPDATE_ARCH_MISMATCH", 422, m.arch + " != " + device.arch);
    if (device.releaseSeq && m.releaseSeq <= *device.releaseSeq)
        return refused("UPDATE_DOWNGRADE", 409,
                       std::to_string(m.releaseSeq) + " <= " + std::to_string(*device.releaseSeq));
    if (!device.version.empty() && compareVersions(device.version, m.minFromVersion) < 0) {
        Error fe = invalid("FROM_VERSION", device.version + " < " + m.minFromVersion);
        fe.exit = kExitRefused;
        return fe;
    }
    if (m.kind == "runtime" && !device.projectFormat.empty() &&
        compareVersions(m.projectFormatMax, device.projectFormat) < 0)
        return refused("UPDATE_PROJECT_INCOMPATIBLE", 409,
                       m.projectFormatMax + " < " + device.projectFormat);
    if (m.updaterRequired > device.updaterProtocol)
        return refused("UPDATER_MANUAL_ONLY", 422,
                       "updaterRequired " + std::to_string(m.updaterRequired));
    out.manifest = std::move(m);
    out.signerKeyId = signer->keyId();
    out.signerLabel = signer->label;
    out.packageSize = size;
    return std::nullopt;
}

std::optional<Error> verifyPackageFile(const std::string& path, const KeySet& keys,
                                       const DeviceContext& device, Verified& out) {
    FileSource f;
    std::string err;
    if (!f.open(path, err)) return invalid("ENVELOPE_TRUNCATED", err);
    return verifyPackage(f, f.size(), keys, device, out);
}

std::optional<Error> verifySums(const std::string& sumsPath, const std::string& sigPath,
                                const KeySet& keys, std::string& signer) {
    if (keys.keys.empty()) return keysMissing();
    std::string sums, sig;
    if (!readSmall(sumsPath, 1 << 20, sums)) return invalid("FILE_MISSING", sumsPath);
    if (!readSmall(sigPath, kSigMaxBytes, sig)) return badSignature();
    const PublicKey* k = keys.verify(reinterpret_cast<const uint8_t*>(sums.data()), sums.size(),
                                     reinterpret_cast<const uint8_t*>(sig.data()), sig.size());
    if (!k) return badSignature();
    signer = k->keyId();
    const size_t slash = sumsPath.rfind('/');
    const std::string dir = slash == std::string::npos ? "." : sumsPath.substr(0, slash);
    size_t pos = 0;
    while (pos < sums.size()) {
        size_t nl = sums.find('\n', pos);
        if (nl == std::string::npos) nl = sums.size();
        std::string line = sums.substr(pos, nl - pos);
        pos = nl + 1;
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.empty()) continue;
        if (line.size() < 67 || line[64] != ' ' || (line[65] != ' ' && line[65] != '*'))
            return invalid("SUMS_FORMAT", line.substr(0, 80));
        const std::string want = line.substr(0, 64);
        const std::string name = line.substr(66);
        if (name.find('/') != std::string::npos || name == "." || name == ".." || name.empty())
            return invalid("PATH_INVALID", name);
        FileSource f;
        std::string err;
        if (!f.open(dir + "/" + name, err)) return invalid("FILE_MISSING", name);
        mbedtls_sha256_context sha;
        mbedtls_sha256_init(&sha);
        mbedtls_sha256_starts(&sha, 0);
        std::vector<uint8_t> buf(64 * 1024);
        size_t n;
        while ((n = f.read(buf.data(), buf.size())) > 0) mbedtls_sha256_update(&sha, buf.data(), n);
        unsigned char d[32];
        mbedtls_sha256_finish(&sha, d);
        mbedtls_sha256_free(&sha);
        std::string lower = want;
        std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);
        if (hexOf(d, 32) != lower) return invalid("FILE_DIGEST", name);
    }
    return std::nullopt;
}

}  // namespace mat::update
