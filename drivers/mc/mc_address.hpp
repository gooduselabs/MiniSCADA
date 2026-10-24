// Mitsubishi MC (SLMP) address of an external Tag (feature 017; specs/017-driver-mc/plan.md
// "Địa chỉ Tag MC", contracts/mc-protocol.md §1). Pure code, no I/O; the same vectors as
// packages/tag-codec (tests/mc-vectors/address.json). The project validator uses it too.
//
//   address = device number [ "." bit ]
//   device  = SM / SD / TN / CN / ZR / D / W / R / M / X / Y / B / L
//   number  = 1*8 DIGIT (decimal devices) / 1*6 HEXDIG (X, Y, B, W) / 1*8 octal (X, Y when the
//             field device says xyNotation octal)
//   bit     = HEXDIG (0-F), only on word devices and with rawType BOOL
#pragma once
#include <cstdint>
#include <string>

#include "core/tag-engine/tag_store.hpp"  // TagType (types only)

namespace mat::mc {

enum class Device { SM, SD, X, Y, M, L, B, D, W, TN, CN, R, ZR };

struct McDeviceInfo {
    Device device;
    const char* name;   // "D", "ZR"
    const char* ascii;  // the 2-character code of the ASCII frame ("D*", "ZR")
    uint8_t code;       // the binary device code
    bool bit;           // a bit device (M, X, ...); otherwise a word device
    int radix;          // how the number is written in the address: 10 or 16
    int asciiRadix;     // how the number is written in an ASCII frame: 10 or 16
};

const McDeviceInfo& deviceInfo(Device d);
const char* deviceName(Device d);
const McDeviceInfo* deviceByName(const std::string& name);  // null: unknown
const McDeviceInfo* deviceByCode(uint8_t code);             // null: unknown

constexpr uint32_t kNumberLimit = 0x1000000;  // device numbers are 3 bytes on the wire

struct McAddressOptions {
    TagType rawType = TagType::UINT16;
    int stringLength = 0;  // required with STRING
    bool rw = false;       // access RW
    bool xyOctal = false;  // X and Y written in octal (FX5 / iQ-F)
};

struct McAddress {
    bool ok = false;
    std::string error;  // E_ADDR_SYNTAX | E_ADDR_AREA | E_ADDR_RANGE
    std::string normalized;
    Device device = Device::D;
    uint8_t code = 0;
    bool bitDevice = false;
    uint32_t number = 0;
    int words = 0;  // words on the wire (a bit device: one point, counted 1)
    int bit = -1;   // bit inside the word (0-15), -1 none
};

// Letters are upper-cased; whitespace is not trimmed.
McAddress parseMcAddress(const std::string& address, const McAddressOptions& opts);

// Words a Tag of `rawType` takes (BOOL 1, 16 bit 1, 32 bit 2, 64 bit 4, STRING ceil(len / 2)).
int mcWordCount(TagType rawType, int stringLength);

}  // namespace mat::mc
