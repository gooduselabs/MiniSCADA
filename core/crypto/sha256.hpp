// SHA-256 (FIPS 180-4) through Mbed TLS (feature 005, research R4): package checksums and content
// digest, session token hashes, certificate fingerprints. Mbed TLS stays behind this interface, so
// users need neither its headers nor its configuration.
#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string_view>

namespace mat {

constexpr size_t kSha256Bytes = 32;
using Sha256Digest = std::array<uint8_t, kSha256Bytes>;

Sha256Digest sha256(const void* data, size_t len);
Sha256Digest sha256(std::string_view data);

// Streaming form, for data that arrives in pieces (a file read in blocks, a package entry being
// decompressed). Not thread-safe; one object per stream.
class Sha256 {
   public:
    Sha256();
    ~Sha256();
    Sha256(const Sha256&) = delete;
    Sha256& operator=(const Sha256&) = delete;

    Sha256& update(const void* data, size_t len);
    Sha256& update(std::string_view data);
    // The digest of everything passed to update() since construction or the previous finish(); the
    // object then starts over, as if new.
    Sha256Digest finish();

   private:
    struct Context;
    std::unique_ptr<Context> ctx_;
};

}  // namespace mat
