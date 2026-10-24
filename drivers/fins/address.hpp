// Omron FINS address of an external Tag (feature 018, spec FR-004, FR-005). Pure code, no I/O; the
// same vectors as packages/tag-codec (tests/fins-vectors/address.json).
//
//   address = area number [ "." bit ]
//   area    = "CIO" / "W" / "H" / "A" / "D" / "T" / "C" / "E" bank "_"   ; bank 0-9, A-C (hex)
//   number  = 1*5DIGIT                                                   ; leading zeros allowed
//   bit     = 1*2DIGIT                                                   ; 0-15, BOOL only
//
// T and C: a BOOL is the completion flag (read only), a 16-bit number the present value. Memory
// area codes of the CS/CJ mode (W342 §5-2): word / bit.
#pragma once
#include <cstdint>
#include <string>

#include "core/tag-engine/tag_store.hpp"  // TagType (types only)

namespace mat::fins {

enum class Area { CIO, W, H, A, D, E, T, C };
const char* areaName(Area a);

struct AddressOptions {
    TagType rawType = TagType::UINT16;
    int stringLength = 0;  // required with STRING
    bool rw = false;       // access RW
};

struct Address {
    bool ok = false;
    std::string error;  // E_ADDR_SYNTAX | E_ADDR_AREA | E_ADDR_RANGE
    std::string normalized;
    Area area = Area::D;
    int bank = -1;      // EM bank 0-12, -1 for the other areas
    int offset = 0;     // the word (or the timer / counter number)
    int wire = 0;       // the word address sent (a counter: 0x8000 + number)
    int bit = -1;       // bit in the word (0-15), -1 none
    int words = 0;      // words taken (a bit or a flag counts 1)
    bool flag = false;  // completion flag of a timer or counter
    uint8_t wordCode = 0;
    uint8_t bitCode = 0;
    bool writable = false;
};

// Words a Tag of `rawType` takes (1 for BOOL; STRING: ceil(length / 2)).
int wordCount(TagType rawType, int stringLength);

// The largest word number of an area (CIO 6143, W 511, H 1535, A 1471, D and E 32767, T and C
// 4095).
int areaMax(Area a);

// Letters are upper-cased; whitespace is not trimmed.
Address parseAddress(const std::string& address, const AddressOptions& opts);

}  // namespace mat::fins
