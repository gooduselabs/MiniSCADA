// TLS record cipher speed with the project's Mbed TLS build (mat_mbedtls_config.h): AES-128-GCM,
// AES-256-GCM and ChaCha20-Poly1305, encrypt + tag of whole records through PSA (psa_aead_encrypt:
// the path the TLS 1.2 and 1.3 records of Mbed TLS 3.6 take). Built only on request, like
// logic_bench: `cmake --build <dir> --target tls_cipher_bench`.
// Usage: tls_cipher_bench [MB per cipher, default 16] [record bytes, default 16384]
// Prints MB/s and microseconds per KiB for each cipher. Single thread; the BL335 has two cores.
#include <psa/crypto.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <vector>

namespace {

struct Cipher {
    const char* name;
    psa_key_type_t type;
    size_t keyBits;
    psa_algorithm_t alg;
};

int run(const Cipher& c, size_t totalBytes, size_t record) {
    psa_key_attributes_t attr = PSA_KEY_ATTRIBUTES_INIT;
    psa_set_key_type(&attr, c.type);
    psa_set_key_bits(&attr, c.keyBits);
    psa_set_key_usage_flags(&attr, PSA_KEY_USAGE_ENCRYPT);
    psa_set_key_algorithm(&attr, c.alg);
    std::vector<unsigned char> key(c.keyBits / 8, 0x5a);
    psa_key_id_t id = 0;
    if (psa_import_key(&attr, key.data(), key.size(), &id) != PSA_SUCCESS) {
        std::printf("%-20s key import failed\n", c.name);
        return 1;
    }
    std::vector<unsigned char> in(record, 0x17), out(record + 16);
    unsigned char nonce[12] = {0};
    unsigned char aad[13] = {0x17, 0x03, 0x03};  // TLS record header as additional data
    size_t outLen = 0;
    const size_t records = (totalBytes + record - 1) / record;
    const auto t0 = std::chrono::steady_clock::now();
    for (size_t i = 0; i < records; ++i) {
        nonce[11] = static_cast<unsigned char>(i);
        nonce[10] = static_cast<unsigned char>(i >> 8);
        if (psa_aead_encrypt(id, c.alg, nonce, sizeof nonce, aad, sizeof aad, in.data(), in.size(),
                             out.data(), out.size(), &outLen) != PSA_SUCCESS) {
            std::printf("%-20s encrypt failed\n", c.name);
            psa_destroy_key(id);
            return 1;
        }
    }
    const double s = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    const double bytes = static_cast<double>(records * record);
    std::printf("%-20s %8.2f MB/s %8.2f us/KiB  (%zu records of %zu B, %.3f s)\n", c.name,
                bytes / s / 1e6, s * 1e6 / (bytes / 1024.0), records, record, s);
    psa_destroy_key(id);
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    const long mb = argc > 1 ? std::strtol(argv[1], nullptr, 10) : 16;
    const long record = argc > 2 ? std::strtol(argv[2], nullptr, 10) : 16384;
    if (mb <= 0 || record <= 0 || record > 16384) {
        std::fprintf(stderr,
                     "usage: tls_cipher_bench [MB per cipher > 0] [record bytes 1..16384]\n");
        return 2;
    }
    if (psa_crypto_init() != PSA_SUCCESS) {
        std::fprintf(stderr, "psa_crypto_init failed\n");
        return 1;
    }
    const Cipher ciphers[] = {
        {"AES-128-GCM", PSA_KEY_TYPE_AES, 128, PSA_ALG_GCM},
        {"AES-256-GCM", PSA_KEY_TYPE_AES, 256, PSA_ALG_GCM},
        {"ChaCha20-Poly1305", PSA_KEY_TYPE_CHACHA20, 256, PSA_ALG_CHACHA20_POLY1305},
    };
    const size_t total = static_cast<size_t>(mb) * 1024 * 1024;
    int rc = 0;
    for (const Cipher& c : ciphers) rc |= run(c, total, static_cast<size_t>(record));
    mbedtls_psa_crypto_free();
    return rc;
}
