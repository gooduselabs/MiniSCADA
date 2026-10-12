#include "drivers/modbus/codec.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>

namespace mat::modbus {

std::optional<ByteOrder> parseByteOrder(const std::string& s) {
    if (s == "ABCD") return ByteOrder::ABCD;
    if (s == "CDAB") return ByteOrder::CDAB;
    if (s == "BADC") return ByteOrder::BADC;
    if (s == "DCBA") return ByteOrder::DCBA;
    return std::nullopt;
}

std::optional<StringByteOrder> parseStringByteOrder(const std::string& s) {
    if (s == "AB") return StringByteOrder::AB;
    if (s == "BA") return StringByteOrder::BA;
    return std::nullopt;
}

int wordsOf(TagType t) {
    switch (t) {
        case TagType::INT16:
        case TagType::UINT16:
            return 1;
        case TagType::INT32:
        case TagType::UINT32:
        case TagType::FLOAT32:
            return 2;
        default:
            return 4;
    }
}

namespace {

using Bytes = std::vector<uint8_t>;

// Registers (read order) to big-endian bytes.
Bytes toBigEndian(const std::vector<uint16_t>& regs, size_t n, ByteOrder order) {
    std::vector<std::array<uint8_t, 2>> words;
    for (size_t i = 0; i < n; ++i)
        words.push_back({static_cast<uint8_t>(regs[i] >> 8), static_cast<uint8_t>(regs[i] & 0xFF)});
    if (n > 1) {
        if (order == ByteOrder::BADC || order == ByteOrder::DCBA)
            for (auto& w : words) std::swap(w[0], w[1]);
        if (order == ByteOrder::CDAB || order == ByteOrder::DCBA)
            std::reverse(words.begin(), words.end());
    }
    Bytes out;
    for (const auto& w : words) {
        out.push_back(w[0]);
        out.push_back(w[1]);
    }
    return out;
}

std::vector<uint16_t> fromBigEndian(const Bytes& bytes, ByteOrder order) {
    std::vector<std::array<uint8_t, 2>> words;
    for (size_t i = 0; i + 1 < bytes.size(); i += 2) words.push_back({bytes[i], bytes[i + 1]});
    if (words.size() > 1) {
        if (order == ByteOrder::CDAB || order == ByteOrder::DCBA)
            std::reverse(words.begin(), words.end());
        if (order == ByteOrder::BADC || order == ByteOrder::DCBA)
            for (auto& w : words) std::swap(w[0], w[1]);
    }
    std::vector<uint16_t> regs;
    for (const auto& w : words) regs.push_back(static_cast<uint16_t>((w[0] << 8) | w[1]));
    return regs;
}

uint64_t beValue(const Bytes& b) {
    uint64_t v = 0;
    for (uint8_t x : b) v = (v << 8) | x;
    return v;
}

}  // namespace

DecodeResult decodeNumber(TagType type, ByteOrder order, const std::vector<uint16_t>& regs) {
    DecodeResult r;
    const int words = wordsOf(type);
    if (regs.size() < static_cast<size_t>(words)) {
        r.reason = "SHORT_READ";
        return r;
    }
    const uint64_t u = beValue(toBigEndian(regs, static_cast<size_t>(words), order));
    r.ok = true;
    switch (type) {
        case TagType::INT16:
            r.value = static_cast<int64_t>(static_cast<int16_t>(u));
            break;
        case TagType::UINT16:
            r.value = static_cast<uint64_t>(u);
            break;
        case TagType::INT32:
            r.value = static_cast<int64_t>(static_cast<int32_t>(u));
            break;
        case TagType::UINT32:
            r.value = static_cast<uint64_t>(u);
            break;
        case TagType::INT64:
            r.value = static_cast<int64_t>(u);
            break;
        case TagType::UINT64:
            r.value = u;
            break;
        case TagType::FLOAT32: {
            const uint32_t b = static_cast<uint32_t>(u);
            float f;
            std::memcpy(&f, &b, sizeof f);
            if (!std::isfinite(f)) {
                r.ok = false;
                r.reason = "INVALID_VALUE";
            } else {
                r.value = static_cast<double>(f);
            }
            break;
        }
        default: {  // FLOAT64
            double d;
            std::memcpy(&d, &u, sizeof d);
            if (!std::isfinite(d)) {
                r.ok = false;
                r.reason = "INVALID_VALUE";
            } else {
                r.value = d;
            }
            break;
        }
    }
    return r;
}

std::vector<uint16_t> encodeNumber(TagType type, ByteOrder order, const TagScalar& value) {
    const int words = wordsOf(type);
    uint64_t u = 0;
    auto asU64 = [&]() -> uint64_t {
        if (const int64_t* i = std::get_if<int64_t>(&value)) return static_cast<uint64_t>(*i);
        if (const uint64_t* x = std::get_if<uint64_t>(&value)) return *x;
        if (const double* d = std::get_if<double>(&value))
            return static_cast<uint64_t>(static_cast<int64_t>(*d));
        return 0;
    };
    auto asDouble = [&]() -> double {
        if (const double* d = std::get_if<double>(&value)) return *d;
        if (const int64_t* i = std::get_if<int64_t>(&value)) return static_cast<double>(*i);
        if (const uint64_t* x = std::get_if<uint64_t>(&value)) return static_cast<double>(*x);
        return 0.0;
    };
    switch (type) {
        case TagType::FLOAT32: {
            const float f = static_cast<float>(asDouble());
            uint32_t b;
            std::memcpy(&b, &f, sizeof b);
            u = b;
            break;
        }
        case TagType::FLOAT64: {
            const double d = asDouble();
            std::memcpy(&u, &d, sizeof u);
            break;
        }
        default:
            u = asU64();
            break;
    }
    Bytes bytes;
    for (int i = words * 2 - 1; i >= 0; --i)
        bytes.push_back(static_cast<uint8_t>((u >> (8 * i)) & 0xFF));
    return fromBigEndian(bytes, order);
}

std::string decodeString(int length, StringByteOrder order, const std::vector<uint16_t>& regs) {
    Bytes bytes;
    for (uint16_t r : regs) {
        const uint8_t hi = static_cast<uint8_t>(r >> 8), lo = static_cast<uint8_t>(r & 0xFF);
        if (order == StringByteOrder::AB) {
            bytes.push_back(hi);
            bytes.push_back(lo);
        } else {
            bytes.push_back(lo);
            bytes.push_back(hi);
        }
    }
    if (bytes.size() > static_cast<size_t>(length)) bytes.resize(static_cast<size_t>(length));
    const auto z = std::find(bytes.begin(), bytes.end(), 0);
    bytes.erase(z, bytes.end());

    std::string out;
    size_t i = 0;
    const size_t n = bytes.size();
    while (i < n) {
        const unsigned b = bytes[i];
        if (b < 0x80) {
            out += static_cast<char>(b);
            ++i;
            continue;
        }
        size_t need;
        uint32_t cp, min;
        if (b >= 0xC2 && b <= 0xDF) {
            need = 1;
            cp = b & 0x1F;
            min = 0x80;
        } else if (b >= 0xE0 && b <= 0xEF) {
            need = 2;
            cp = b & 0x0F;
            min = 0x800;
        } else if (b >= 0xF0 && b <= 0xF4) {
            need = 3;
            cp = b & 0x07;
            min = 0x10000;
        } else {
            out += "\xEF\xBF\xBD";
            ++i;
            continue;
        }
        bool valid = true;
        for (size_t j = 1; j <= need; ++j) {
            if (i + j >= n || (bytes[i + j] & 0xC0) != 0x80) {
                valid = false;
                break;
            }
            cp = (cp << 6) | (bytes[i + j] & 0x3F);
        }
        if (valid && (cp < min || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF))) valid = false;
        if (!valid) {
            out += "\xEF\xBF\xBD";
            ++i;
            continue;
        }
        for (size_t j = 0; j <= need; ++j) out += static_cast<char>(bytes[i + j]);
        i += need + 1;
    }
    return out;
}

EncodeStringResult encodeString(int length, StringByteOrder order, const std::string& text) {
    EncodeStringResult r;
    if (text.size() > static_cast<size_t>(length)) {
        r.error = "STRING_TOO_LONG";
        return r;
    }
    Bytes bytes(text.begin(), text.end());
    const size_t total = static_cast<size_t>((length + 1) / 2) * 2;
    while (bytes.size() < total) bytes.push_back(0);
    for (size_t i = 0; i < total; i += 2)
        r.registers.push_back(order == StringByteOrder::AB
                                  ? static_cast<uint16_t>((bytes[i] << 8) | bytes[i + 1])
                                  : static_cast<uint16_t>((bytes[i + 1] << 8) | bytes[i]));
    r.ok = true;
    return r;
}

std::vector<uint8_t> unpackBits(const std::vector<uint8_t>& bytes, size_t count) {
    std::vector<uint8_t> out(count);
    for (size_t i = 0; i < count; ++i) {
        const size_t b = i >> 3;
        out[i] = b < bytes.size() ? static_cast<uint8_t>((bytes[b] >> (i & 7)) & 1) : 0;
    }
    return out;
}

std::vector<uint8_t> packBits(const std::vector<uint8_t>& bits) {
    std::vector<uint8_t> out((bits.size() + 7) / 8, 0);
    for (size_t i = 0; i < bits.size(); ++i)
        out[i >> 3] |= static_cast<uint8_t>((bits[i] & 1) << (i & 7));
    return out;
}

bool registerBit(uint16_t reg, int bit) { return ((reg >> bit) & 1) == 1; }

MaskWrite maskWrite(int bit, bool value) {
    MaskWrite m;
    m.andMask = static_cast<uint16_t>(~(1u << bit) & 0xFFFFu);
    m.orMask = static_cast<uint16_t>((value ? 1u : 0u) << bit);
    return m;
}

uint16_t applyBit(uint16_t reg, int bit, bool value) {
    const MaskWrite m = maskWrite(bit, value);
    return static_cast<uint16_t>(((reg & m.andMask) | m.orMask) & 0xFFFFu);
}

}  // namespace mat::modbus
