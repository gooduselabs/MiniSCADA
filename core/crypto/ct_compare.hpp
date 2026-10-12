// Comparison of secrets (token hashes, password hashes: feature 005 research R7, R9) in time that
// does not depend on their content.
#pragma once
#include <cstddef>
#include <string_view>

namespace mat {

// True when both byte strings are equal. Never branches on the bytes (Mbed TLS mbedtls_ct_memcmp
// reads every byte); different lengths give false at once: lengths are not secret here, the
// values compared are hashes of fixed size.
bool constantTimeEqual(const void* a, size_t aLen, const void* b, size_t bLen);
bool constantTimeEqual(std::string_view a, std::string_view b);

}  // namespace mat
