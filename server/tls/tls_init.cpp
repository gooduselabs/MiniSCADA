#include "server/tls/tls_init.hpp"

#include <psa/crypto.h>

namespace mat {

bool initTlsCrypto(std::string& error) {
    const psa_status_t status = psa_crypto_init();
    if (status == PSA_SUCCESS) return true;
    error = "psa_crypto_init: error " + std::to_string(static_cast<int>(status));
    return false;
}

}  // namespace mat
