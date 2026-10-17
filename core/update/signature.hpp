// Trusted keys and ECDSA P-256 signatures (contracts/update-package.md §3, release-signing.md §5;
// research R16): public keys as PEM SubjectPublicKeyInfo files in trustedKeysDir, keyId =
// "sha256:" + SHA-256 of the DER SPKI, signatures DER over SHA-256 of the signed bytes. Only P-256
// ECDSA keys load; at most kMaxTrustedKeys keys are used (sorted by file name). Mbed TLS stays
// behind this header.
#pragma once
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace mat::update {

class PublicKey {
   public:
    PublicKey();
    ~PublicKey();
    PublicKey(PublicKey&&) noexcept;
    PublicKey& operator=(PublicKey&&) noexcept;
    PublicKey(const PublicKey&) = delete;
    PublicKey& operator=(const PublicKey&) = delete;

    // A PEM "PUBLIC KEY" (SPKI) of an ECDSA P-256 key; anything else is refused with a reason.
    bool parsePem(std::string_view pem, std::string& err);
    const std::string& keyId() const { return keyId_; }
    // True when `sig` (DER) is a signature of SHA-256(data) by this key.
    bool verify(const uint8_t* data, size_t n, const uint8_t* sig, size_t sigLen) const;
    bool verifyDigest(const uint8_t digest[32], const uint8_t* sig, size_t sigLen) const;

    std::string label;  // file name without .pem / .pub.pem ("release-primary")
    std::string file;   // the file it came from ("" when parsed from memory)

   private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    std::string keyId_;
};

struct KeySet {
    std::vector<PublicKey> keys;
    std::vector<std::string> warnings;  // files skipped and why (never fatal)
    // The key whose signature over `data` is `sig`; null when none.
    const PublicKey* verify(const uint8_t* data, size_t n, const uint8_t* sig, size_t sigLen) const;
};

// Loads <dir>/*.pem (regular files, ≤ 16 KiB each), sorted by name, at most kMaxTrustedKeys.
// A missing or empty directory gives an empty set (UPDATE_KEYS_MISSING for the caller).
KeySet loadTrustedKeys(const std::string& dir);

// keyId of a PEM public key ("" when it does not parse as a P-256 key).
std::string keyIdOfPem(std::string_view pem);

}  // namespace mat::update
