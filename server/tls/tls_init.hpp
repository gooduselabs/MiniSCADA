// Start-up of the TLS crypto (feature 005; contracts/device-config.md §7 step 1, ADR-010): PSA
// Crypto of Mbed TLS is initialised once, before any port opens, so that a failure (no entropy
// source, …) shows at start instead of at the first TLS 1.3 handshake. Mbed TLS stays behind this
// header.
#pragma once
#include <string>

namespace mat {

// psa_crypto_init(). false, with `error`, when it fails: the runtime keeps HTTP and reports
// system/info.device.https = "tls-error".
bool initTlsCrypto(std::string& error);

}  // namespace mat
