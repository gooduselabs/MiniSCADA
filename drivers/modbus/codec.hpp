// Registers <-> values (contracts/modbus-driver.md §6, §8). Pure code, no I/O, built with
// -ffp-contract=off; the same vectors as packages/tag-codec (tests/codec-vectors).
// 16-bit types are always big-endian; the byte order only applies to 32 and 64 bit types.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "core/tag-engine/tag_store.hpp"  // TagType, TagScalar (types only)

namespace mat::modbus {

// ABCD: Modbus standard; CDAB: words swapped; BADC: bytes swapped inside each word; DCBA: both.
enum class ByteOrder { ABCD, CDAB, BADC, DCBA };
enum class StringByteOrder { AB, BA };

std::optional<ByteOrder> parseByteOrder(const std::string& s);
std::optional<StringByteOrder> parseStringByteOrder(const std::string& s);

// Registers a numeric type takes (INT16/UINT16 1, 32 bit 2, 64 bit 4).
int wordsOf(TagType t);

struct DecodeResult {
    bool ok = false;
    // INT16/INT32/INT64: int64_t, UINT16/UINT32/UINT64: uint64_t, FLOAT32/FLOAT64: double
    TagScalar value;
    std::string reason;  // INVALID_VALUE for NaN and infinities of FLOAT32/FLOAT64
};

// `regs` has at least wordsOf(type) registers (extra ones are ignored).
DecodeResult decodeNumber(TagType type, ByteOrder order, const std::vector<uint16_t>& regs);

// Raw value already range checked; the variant holds int64_t, uint64_t or double as decodeNumber
// gives.
std::vector<uint16_t> encodeNumber(TagType type, ByteOrder order, const TagScalar& value);

// First `length` bytes, up to the first 0, UTF-8; each byte outside a valid sequence becomes
// U+FFFD.
std::string decodeString(int length, StringByteOrder order, const std::vector<uint16_t>& regs);

struct EncodeStringResult {
    bool ok = false;
    std::vector<uint16_t> registers;
    std::string error;  // STRING_TOO_LONG
};
EncodeStringResult encodeString(int length, StringByteOrder order, const std::string& text);

// Coil/DI bits: bit i is in byte i/8, low bit first.
std::vector<uint8_t> unpackBits(const std::vector<uint8_t>& bytes, size_t count);
std::vector<uint8_t> packBits(const std::vector<uint8_t>& bits);
bool registerBit(uint16_t reg, int bit);
struct MaskWrite {
    uint16_t andMask = 0;
    uint16_t orMask = 0;
};
MaskWrite maskWrite(int bit, bool value);  // function 22: (reg & and) | or
uint16_t applyBit(uint16_t reg, int bit, bool value);

}  // namespace mat::modbus
