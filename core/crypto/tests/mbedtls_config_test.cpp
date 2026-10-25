// T004 (feature 005, research R4): the Mbed TLS build configuration. Every user of mat_mbedtls
// compiles against third_party/mbedtls-config/mat_mbedtls_config.h (MBEDTLS_CONFIG_FILE), so the
// checks below see exactly what the library was built with:
// - at compile time (#if / static_assert): what R4 requires is on, what it forbids is off;
// - at run time: what the built library really offers (version, cipher suites, curves, PSA).
#include <gtest/gtest.h>
#include <mbedtls/build_info.h>
#include <mbedtls/ecp.h>
#include <mbedtls/ssl.h>
#include <mbedtls/ssl_ciphersuites.h>
#include <mbedtls/version.h>
#include <psa/crypto.h>

#include <set>
#include <string>
#include <vector>

// The project configuration, not the upstream default (mbedtls/mbedtls_config.h).
#if !defined(MAT_MBEDTLS_CONFIG_H)
#error "R4: compiled without third_party/mbedtls-config/mat_mbedtls_config.h (MBEDTLS_CONFIG_FILE)"
#endif
static_assert(MBEDTLS_VERSION_NUMBER == 0x03060700, "R4/R19: the vendored Mbed TLS is 3.6.7");

// --- On: TLS 1.2 and 1.3, server side only.
#if !defined(MBEDTLS_SSL_TLS_C) || !defined(MBEDTLS_SSL_SRV_C)
#error "R4: MBEDTLS_SSL_SRV_C (TLS server) must be on"
#endif
#if !defined(MBEDTLS_SSL_PROTO_TLS1_2)
#error "R4: MBEDTLS_SSL_PROTO_TLS1_2 must be on"
#endif
#if !defined(MBEDTLS_SSL_PROTO_TLS1_3)
#error "R4: MBEDTLS_SSL_PROTO_TLS1_3 must be on"
#endif

// --- On: ECDHE with X25519 and secp256r1; ECDSA certificates (P-256).
#if !defined(MBEDTLS_ECDH_C) || !defined(MBEDTLS_ECP_DP_CURVE25519_ENABLED) || \
    !defined(MBEDTLS_ECP_DP_SECP256R1_ENABLED)
#error "R4: ECDHE needs MBEDTLS_ECDH_C, X25519 and secp256r1"
#endif
#if !defined(MBEDTLS_KEY_EXCHANGE_ECDHE_ECDSA_ENABLED)
#error "R4: TLS 1.2 key exchange ECDHE-ECDSA must be on"
#endif
#if !defined(MBEDTLS_SSL_TLS1_3_KEY_EXCHANGE_MODE_EPHEMERAL_ENABLED)
#error "R4: TLS 1.3 (EC)DHE key exchange must be on"
#endif
#if !defined(MBEDTLS_ECDSA_C)
#error "R4: MBEDTLS_ECDSA_C must be on"
#endif

// --- On: AEAD ciphers and hashes.
#if !defined(MBEDTLS_GCM_C) || !defined(MBEDTLS_CHACHAPOLY_C)
#error "R4: AES-GCM (MBEDTLS_GCM_C) and ChaCha20-Poly1305 (MBEDTLS_CHACHAPOLY_C) must be on"
#endif
#if !defined(MBEDTLS_SHA256_C) || !defined(MBEDTLS_SHA384_C)
#error "R4: MBEDTLS_SHA256_C and MBEDTLS_SHA384_C must be on"
#endif

// --- On: X.509 read and write, PEM, random generator.
#if !defined(MBEDTLS_X509_CRT_PARSE_C) || !defined(MBEDTLS_X509_CRT_WRITE_C)
#error "R4: X.509 certificate parsing and writing must be on"
#endif
#if !defined(MBEDTLS_PEM_PARSE_C) || !defined(MBEDTLS_PEM_WRITE_C)
#error "R4: PEM parsing and writing must be on"
#endif
#if !defined(MBEDTLS_CTR_DRBG_C)
#error "R4: MBEDTLS_CTR_DRBG_C must be on"
#endif

// --- On: PSA Crypto (TLS 1.3 needs it) and threading (CivetWeb shares one CTR-DRBG).
#if !defined(MBEDTLS_PSA_CRYPTO_C)
#error "R4: MBEDTLS_PSA_CRYPTO_C must be on"
#endif
#if !defined(MBEDTLS_THREADING_C) || !defined(MBEDTLS_THREADING_PTHREAD)
#error "R4: MBEDTLS_THREADING_C and MBEDTLS_THREADING_PTHREAD must be on"
#endif

// --- Off: DTLS, renegotiation, RSA key exchange, CBC, debug. The client side is on since feature
// 023 (ADR-051, alarm email over STARTTLS/SMTPS) and used by the MQTT driver (022, ADR-050), with
// SNI.
#if !defined(MBEDTLS_SSL_CLI_C) || !defined(MBEDTLS_SSL_SERVER_NAME_INDICATION)
#error \
    "feature 023: MBEDTLS_SSL_CLI_C and MBEDTLS_SSL_SERVER_NAME_INDICATION must be on (SMTP client)"
#endif
#if defined(MBEDTLS_SSL_PROTO_DTLS)
#error "R4: MBEDTLS_SSL_PROTO_DTLS must be off"
#endif
#if defined(MBEDTLS_SSL_RENEGOTIATION)
#error "R4: MBEDTLS_SSL_RENEGOTIATION must be off"
#endif
#if defined(MBEDTLS_KEY_EXCHANGE_RSA_ENABLED)
#error "R4: MBEDTLS_KEY_EXCHANGE_RSA_ENABLED must be off"
#endif
// CBC is on since feature 019 (ADR-047) for the OPC UA policy Basic256Sha256 only: the TLS server
// still offers no CBC suite (OnlyAeadSuitesWithEcdheAndEcdsa checks the list at run time).
#if !defined(MBEDTLS_SSL_CIPHERSUITES)
#error "R4: the TLS suites must stay a fixed list (MBEDTLS_SSL_CIPHERSUITES)"
#endif
#if defined(MBEDTLS_DEBUG_C)
#error "R4: MBEDTLS_DEBUG_C must be off"
#endif

namespace {

// The cipher suites: AEAD only, (EC)DHE only. ECDHE-RSA only for the SMTP client (feature 023):
// the server's certificate is ECDSA, so it never picks them.
const std::set<int> kSuites = {
    MBEDTLS_TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
    MBEDTLS_TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
    MBEDTLS_TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256,
    MBEDTLS_TLS1_3_AES_128_GCM_SHA256,
    MBEDTLS_TLS1_3_AES_256_GCM_SHA384,
    MBEDTLS_TLS1_3_CHACHA20_POLY1305_SHA256,
    MBEDTLS_TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
    MBEDTLS_TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
    MBEDTLS_TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256,
};

}  // namespace

TEST(MbedtlsConfig, LinkedLibraryIsTheVendoredRelease) {
    EXPECT_EQ(mbedtls_version_get_number(), 0x03060700u);
    char version[16] = {0};  // the API wants at least 9 bytes
    mbedtls_version_get_string(version);
    EXPECT_STREQ(version, "3.6.7");
}

TEST(MbedtlsConfig, OnlyAeadSuitesWithEcdheAndEcdsa) {
    std::set<int> offered;
    for (const int* id = mbedtls_ssl_list_ciphersuites(); *id != 0; ++id) {
        EXPECT_TRUE(kSuites.count(*id))
            << "unexpected suite " << mbedtls_ssl_get_ciphersuite_name(*id);
        offered.insert(*id);
    }
    EXPECT_EQ(offered, kSuites);
}

TEST(MbedtlsConfig, OnlyX25519Secp256r1AndSecp384r1) {
    std::set<std::string> curves;
    for (const mbedtls_ecp_curve_info* c = mbedtls_ecp_curve_list();
         c->grp_id != MBEDTLS_ECP_DP_NONE; ++c)
        curves.insert(c->name);
    EXPECT_EQ(curves,
              (std::set<std::string>{"x25519", "secp256r1", "secp384r1"}));  // 384: feature 023
}

// PSA Crypto starts (entropy from the OS) and hands out random bytes.
TEST(MbedtlsConfig, PsaCryptoStartsAndGivesRandomBytes) {
    ASSERT_EQ(psa_crypto_init(), PSA_SUCCESS);
    unsigned char a[32] = {0}, b[32] = {0};
    ASSERT_EQ(psa_generate_random(a, sizeof a), PSA_SUCCESS);
    ASSERT_EQ(psa_generate_random(b, sizeof b), PSA_SUCCESS);
    EXPECT_NE(std::string(reinterpret_cast<char*>(a), sizeof a),
              std::string(reinterpret_cast<char*>(b), sizeof b));
}

// The server's order (TLS 1.2 upstream, TLS 1.3 with mAT patch 1): ChaCha20-Poly1305 before
// AES-GCM in each version, since the Cortex-A7 of the BL335 has no AES instructions.
#if !defined(MAT_SSL_TLS13_SERVER_ORDER)
#error "MAT_SSL_TLS13_SERVER_ORDER must be on (TLS 1.3 suite in the server's order)"
#endif
TEST(MbedtlsConfig, ChaCha20ComesFirstInEachVersion) {
    std::vector<int> order;
    for (const int* id = mbedtls_ssl_list_ciphersuites(); *id != 0; ++id) order.push_back(*id);
    ASSERT_EQ(order.size(), 9u);  // + 3 ECDHE-RSA of the SMTP client (feature 023), last
    EXPECT_EQ(order[0], MBEDTLS_TLS1_3_CHACHA20_POLY1305_SHA256);
    EXPECT_EQ(order[3], MBEDTLS_TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256);
}
