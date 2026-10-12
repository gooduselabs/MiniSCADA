#include "core/crypto/sha256.hpp"

#include <mbedtls/sha256.h>

#include <stdexcept>
#include <string>

namespace mat {

namespace {

// The software SHA-256 of Mbed TLS cannot fail; a non-zero code means a broken build, and a
// wrong digest must never be used, so it is an exception rather than a value.
void check(int rc, const char* step) {
    if (rc != 0)
        throw std::runtime_error(std::string("SHA-256 ") + step + " failed: " + std::to_string(rc));
}

}  // namespace

struct Sha256::Context {
    mbedtls_sha256_context ctx;
    Context() {
        mbedtls_sha256_init(&ctx);
        check(mbedtls_sha256_starts(&ctx, 0), "start");  // 0: SHA-256, not SHA-224
    }
    ~Context() { mbedtls_sha256_free(&ctx); }
};

Sha256Digest sha256(const void* data, size_t len) {
    Sha256Digest d{};
    check(mbedtls_sha256(static_cast<const unsigned char*>(data), len, d.data(), 0), "compute");
    return d;
}

Sha256Digest sha256(std::string_view data) { return sha256(data.data(), data.size()); }

Sha256::Sha256() : ctx_(new Context) {}
Sha256::~Sha256() = default;

Sha256& Sha256::update(const void* data, size_t len) {
    check(mbedtls_sha256_update(&ctx_->ctx, static_cast<const unsigned char*>(data), len),
          "update");
    return *this;
}

Sha256& Sha256::update(std::string_view data) { return update(data.data(), data.size()); }

Sha256Digest Sha256::finish() {
    Sha256Digest d{};
    check(mbedtls_sha256_finish(&ctx_->ctx, d.data()), "finish");
    check(mbedtls_sha256_starts(&ctx_->ctx, 0), "start");
    return d;
}

}  // namespace mat
