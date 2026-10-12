#include "core/crypto/base64url.hpp"

#include <cstdint>

namespace mat {

namespace {

constexpr char kAlphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// Value of one character of the alphabet, or -1.
int valueOf(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '-') return 62;
    if (c == '_') return 63;
    return -1;
}

}  // namespace

std::string base64urlEncode(const void* data, size_t len) {
    const auto* in = static_cast<const unsigned char*>(data);
    std::string out;
    out.reserve((len * 4 + 2) / 3);
    size_t i = 0;
    for (; i + 3 <= len; i += 3) {
        const uint32_t v = uint32_t{in[i]} << 16 | uint32_t{in[i + 1]} << 8 | in[i + 2];
        out += kAlphabet[v >> 18 & 63];
        out += kAlphabet[v >> 12 & 63];
        out += kAlphabet[v >> 6 & 63];
        out += kAlphabet[v & 63];
    }
    if (len - i == 1) {
        const uint32_t v = uint32_t{in[i]} << 16;
        out += kAlphabet[v >> 18 & 63];
        out += kAlphabet[v >> 12 & 63];
    } else if (len - i == 2) {
        const uint32_t v = uint32_t{in[i]} << 16 | uint32_t{in[i + 1]} << 8;
        out += kAlphabet[v >> 18 & 63];
        out += kAlphabet[v >> 12 & 63];
        out += kAlphabet[v >> 6 & 63];
    }
    return out;
}

std::string base64urlEncode(std::string_view bytes) {
    return base64urlEncode(bytes.data(), bytes.size());
}

std::optional<std::string> base64urlDecode(std::string_view text) {
    if (text.size() % 4 == 1) return std::nullopt;  // 6 bits: not even one byte
    std::string out;
    out.reserve(text.size() * 3 / 4);
    uint32_t acc = 0;
    int bits = 0;
    for (const char c : text) {
        const int v = valueOf(c);
        if (v < 0) return std::nullopt;
        acc = (acc << 6 | static_cast<uint32_t>(v)) & 0xFFFFFF;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out += static_cast<char>(acc >> bits & 0xFF);
        }
    }
    // The bits left over (2 or 4) belong to no byte: the encoder writes them as 0.
    if ((acc & ((1u << bits) - 1)) != 0) return std::nullopt;
    return out;
}

}  // namespace mat
