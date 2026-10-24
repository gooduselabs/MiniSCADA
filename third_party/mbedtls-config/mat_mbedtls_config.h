/*
 * mAT SCADA: Mbed TLS 3.6.7 build configuration (feature 005, research R4).
 *
 * Used through MBEDTLS_CONFIG_FILE by mat_mbedtls and by every target linking it (CMakeLists.txt):
 * it replaces the upstream mbedtls/mbedtls_config.h entirely, so anything not defined here is off.
 * Scope: a TLS 1.2/1.3 server for the engineering port (8443) with an ECDSA P-256 certificate that
 * the runtime generates itself (R5), SHA-256 for checksums, digests and fingerprints, random bytes.
 * Checked by core/crypto/tests/mbedtls_config_test.cpp; the flags were settled by the T007 spike
 * (docs/adr/010-device-discovery-https.md, "Số đo / bằng chứng").
 *
 * Deliberately off (R4): TLS client, DTLS, renegotiation, RSA (key exchange and keys), CBC and
 * every non-AEAD cipher, static ECDH, (EC)DHE-PSK and TLS 1.3 PSK modes, session tickets and cache,
 * early data, SHA-1, MD5, curves other than X25519 and P-256, debug output, self tests.
 * Feature 019 turned on RSA, CBC and SHA-1 as primitives for OPC UA (section at the end); the TLS
 * server still negotiates none of them.
 */
#ifndef MAT_MBEDTLS_CONFIG_H
#define MAT_MBEDTLS_CONFIG_H

/* --- Platform: Linux, POSIX sockets and files, pthreads (R4). */
#define MBEDTLS_HAVE_ASM /* bignum assembly for ARMv7 and x86-64: ECC speed on the Cortex-A7 */
#define MBEDTLS_HAVE_TIME
#define MBEDTLS_FS_IO /* CivetWeb loads the key and certificate from ssl_certificate */
#define MBEDTLS_NET_C /* CivetWeb passes mbedtls_net_send/recv as the TLS I/O callbacks */
/* CivetWeb shares one CTR-DRBG and one SSL config between its worker threads (R4). */
#define MBEDTLS_THREADING_C
#define MBEDTLS_THREADING_PTHREAD

/* --- Randomness: kernel entropy (getrandom), CTR-DRBG (R4). */
#define MBEDTLS_ENTROPY_C
#define MBEDTLS_CTR_DRBG_C
#define MBEDTLS_HMAC_DRBG_C /* for deterministic ECDSA (RFC 6979) below */

/* --- TLS: server only, TLS 1.2 and 1.3, (EC)DHE key exchange, ECDSA certificate (R4). */
#define MBEDTLS_SSL_TLS_C
#define MBEDTLS_SSL_SRV_C
#define MBEDTLS_SSL_PROTO_TLS1_2
#define MBEDTLS_SSL_PROTO_TLS1_3
#define MBEDTLS_KEY_EXCHANGE_ECDHE_ECDSA_ENABLED
#define MBEDTLS_SSL_TLS1_3_KEY_EXCHANGE_MODE_EPHEMERAL_ENABLED
#define MBEDTLS_SSL_TLS1_3_COMPATIBILITY_MODE /* middlebox compatibility, RFC 8446 appendix D.4 */
#define MBEDTLS_SSL_KEEP_PEER_CERTIFICATE     /* required by the TLS 1.3 code of 3.6 */
#define MBEDTLS_SSL_EXTENDED_MASTER_SECRET    /* TLS 1.2, RFC 7627 */
#define MBEDTLS_SSL_ALL_ALERT_MESSAGES
/* AEAD suites only, chosen in this order (server choice) on TLS 1.2 and 1.3: ChaCha20-Poly1305
 * first, because the Cortex-A7 has no AES instructions and table-based AES is slower and leaks
 * timing (upstream SECURITY.md, "Block ciphers"); AES-GCM stays for clients without ChaCha20.
 * TLS 1.2 does it upstream; TLS 1.3 upstream takes the client's first suite (AES-256-GCM for
 * OpenSSL/Node, AES-128-GCM for Chrome on a PC with AES instructions), so MAT_SSL_TLS13_SERVER_ORDER
 * turns on "mAT patch 1" of library/ssl_tls13_server.c (ssl_tls13_select_ciphersuite). */
#define MAT_SSL_TLS13_SERVER_ORDER
#define MBEDTLS_SSL_CIPHERSUITES                           \
    MBEDTLS_TLS1_3_CHACHA20_POLY1305_SHA256,               \
    MBEDTLS_TLS1_3_AES_128_GCM_SHA256,                     \
    MBEDTLS_TLS1_3_AES_256_GCM_SHA384,                     \
    MBEDTLS_TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256, \
    MBEDTLS_TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,       \
    MBEDTLS_TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384

/* --- Ciphers and hashes: AES-GCM, ChaCha20-Poly1305, SHA-256, SHA-384 (R4). */
#define MBEDTLS_CIPHER_C
#define MBEDTLS_AES_C
#define MBEDTLS_AES_ROM_TABLES /* constant tables: no lazy table setup shared between threads */
#define MBEDTLS_GCM_C
#define MBEDTLS_CHACHA20_C
#define MBEDTLS_POLY1305_C
#define MBEDTLS_CHACHAPOLY_C
#define MBEDTLS_MD_C
#define MBEDTLS_SHA256_C
#define MBEDTLS_SHA384_C
#define MBEDTLS_SHA512_C /* sha512.c implements SHA-384 */
#define MBEDTLS_HKDF_C   /* TLS 1.3 key schedule (PSA HKDF) */

/* --- Elliptic curves: ECDHE with X25519 and secp256r1, ECDSA P-256 (R4, R5). */
#define MBEDTLS_BIGNUM_C
#define MBEDTLS_ECP_C
#define MBEDTLS_ECP_DP_SECP256R1_ENABLED
#define MBEDTLS_ECP_DP_CURVE25519_ENABLED
#define MBEDTLS_ECP_NIST_OPTIM /* fast P-256 reduction */
#define MBEDTLS_ECDH_C
#define MBEDTLS_ECDSA_C
#define MBEDTLS_ECDSA_DETERMINISTIC /* signatures do not depend on the RNG for their nonce */

/* --- Keys and certificates: parse, generate and write PEM (R5: server.pem made on first start). */
#define MBEDTLS_ASN1_PARSE_C
#define MBEDTLS_ASN1_WRITE_C
#define MBEDTLS_OID_C
#define MBEDTLS_BASE64_C
#define MBEDTLS_PEM_PARSE_C
#define MBEDTLS_PEM_WRITE_C
#define MBEDTLS_PK_C
#define MBEDTLS_PK_PARSE_C
#define MBEDTLS_PK_WRITE_C
#define MBEDTLS_X509_USE_C
#define MBEDTLS_X509_CRT_PARSE_C
#define MBEDTLS_X509_CREATE_C
#define MBEDTLS_X509_CRT_WRITE_C
/* Feature 007 (--make-csr, FR-055): a PKCS#10 request for a CA of the customer; the parser only for
 * the tests that read the request back. */
#define MBEDTLS_X509_CSR_WRITE_C
#define MBEDTLS_X509_CSR_PARSE_C

/* --- PSA Crypto: TLS 1.3 runs on it (R4). main() calls psa_crypto_init() once before opening
 * the ports, so a start-up failure shows there. Dynamic key store: concurrent handshakes cannot
 * run out of a fixed number of key slots. No persistent keys (no PSA storage, no ITS file). */
#define MBEDTLS_PSA_CRYPTO_C
#define MBEDTLS_PSA_KEY_STORE_DYNAMIC

/* --- OPC UA client (feature 019, ADR-047): the SecurityPolicy Basic256Sha256 of open62541
 * (third_party/open62541) runs on this same library. It needs RSA keys (OAEP-SHA1 to encrypt,
 * PKCS#1 v1.5 SHA-256 to sign, a 2048-bit client key generated on the device), AES-256-CBC for the
 * symmetric part, SHA-1 (OAEP, certificate thumbprints) and CRL parsing (its PKI plugin). These are
 * primitives only: the TLS cipher suites stay the fixed AEAD list above (MBEDTLS_SSL_CIPHERSUITES),
 * RSA key exchange stays off, and mbedtls_config_test checks at run time that TLS offers no CBC,
 * no RSA suite. */
#define MBEDTLS_RSA_C
#define MBEDTLS_PKCS1_V15
#define MBEDTLS_PKCS1_V21
#define MBEDTLS_GENPRIME
#define MBEDTLS_CIPHER_MODE_CBC
#define MBEDTLS_SHA1_C
#define MBEDTLS_X509_CRL_PARSE_C
/* The SecurityPolicy plugins of open62541 run mbedtls_entropy_self_test() when a policy is set
 * up; the self tests only exist with this flag. The other self tests are never called, and the
 * linkers of the device binaries drop them (--gc-sections). */
#define MBEDTLS_SELF_TEST

/* --- Diagnostics: error strings for logs (mbedtls_strerror) and the version. */
#define MBEDTLS_ERROR_C
#define MBEDTLS_VERSION_C

#endif /* MAT_MBEDTLS_CONFIG_H */
