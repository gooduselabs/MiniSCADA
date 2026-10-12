#include "core/crypto/ct_compare.hpp"

// Unlike the other Mbed TLS 3.6.7 headers, this one has no extern "C" block of its own.
extern "C" {
#include <mbedtls/constant_time.h>
}

namespace mat {

bool constantTimeEqual(const void* a, size_t aLen, const void* b, size_t bLen) {
    if (aLen != bLen) return false;
    if (aLen == 0) return true;  // mbedtls_ct_memcmp wants non-null pointers
    return mbedtls_ct_memcmp(a, b, aLen) == 0;
}

bool constantTimeEqual(std::string_view a, std::string_view b) {
    return constantTimeEqual(a.data(), a.size(), b.data(), b.size());
}

}  // namespace mat
