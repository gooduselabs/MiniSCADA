#include "core/crypto/hex.hpp"

namespace mat {

namespace {

constexpr char kLower[] = "0123456789abcdef";
constexpr char kUpper[] = "0123456789ABCDEF";

int lowerNibble(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    return -1;
}

}  // namespace

std::string toHex(const void* data, size_t len) {
    const auto* in = static_cast<const unsigned char*>(data);
    std::string out;
    out.reserve(2 * len);
    for (size_t i = 0; i < len; ++i) {
        out += kLower[in[i] >> 4];
        out += kLower[in[i] & 15];
    }
    return out;
}

std::string toHex(std::string_view bytes) { return toHex(bytes.data(), bytes.size()); }

std::optional<std::string> fromHex(std::string_view hex) {
    if (hex.size() % 2 != 0) return std::nullopt;
    std::string out;
    out.reserve(hex.size() / 2);
    for (size_t i = 0; i < hex.size(); i += 2) {
        const int hi = lowerNibble(hex[i]), lo = lowerNibble(hex[i + 1]);
        if (hi < 0 || lo < 0) return std::nullopt;
        out += static_cast<char>(hi << 4 | lo);
    }
    return out;
}

std::string toHexColons(const void* data, size_t len) {
    const auto* in = static_cast<const unsigned char*>(data);
    std::string out;
    out.reserve(len == 0 ? 0 : 3 * len - 1);
    for (size_t i = 0; i < len; ++i) {
        if (i > 0) out += ':';
        out += kUpper[in[i] >> 4];
        out += kUpper[in[i] & 15];
    }
    return out;
}

}  // namespace mat
