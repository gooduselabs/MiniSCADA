// Hexadecimal text of bytes (feature 005): SHA-256 values in package manifests and digests, the
// fingerprint of the device certificate (data-model §3).
#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace mat {

// Lowercase, two characters per byte: a SHA-256 value is 64 characters.
std::string toHex(const void* data, size_t len);
std::string toHex(std::string_view bytes);
template <size_t N>
std::string toHex(const std::array<uint8_t, N>& bytes) {
    return toHex(bytes.data(), N);
}
// Inverse of toHex: lowercase pairs only (the one form this code writes); anything else: nullopt.
std::optional<std::string> fromHex(std::string_view hex);

// Uppercase pairs joined by ':' ("AB:CD:…"), as `openssl x509 -fingerprint -sha256` prints a
// certificate fingerprint: 95 characters for SHA-256.
std::string toHexColons(const void* data, size_t len);
template <size_t N>
std::string toHexColons(const std::array<uint8_t, N>& bytes) {
    return toHexColons(bytes.data(), N);
}

}  // namespace mat
