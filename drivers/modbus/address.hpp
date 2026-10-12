// Modbus address of an external Tag (contracts/project-format-0.2.md §3, FR-015). Pure code, no
// I/O; the same vectors as packages/tag-codec (tests/codec-vectors/address.json).
//
//   address      = area-form / modicon-form
//   area-form    = ("C" / "DI" / "IR" / "HR") number [ "." bit ]   ; bit only with IR, HR
//   modicon-form = ("0" / "1" / "3" / "4") (4DIGIT / 5DIGIT) [ "." bit ]
#pragma once
#include <string>
#include <vector>

#include "core/tag-engine/tag_store.hpp"  // TagType (types only)

namespace mat::modbus {

enum class Area { C, DI, IR, HR };
const char* areaName(Area a);

struct AddressOptions {
    int addressBase = 1;  // the number in the address minus this is the offset sent
    TagType rawType = TagType::UINT16;
    int stringLength = 0;  // required with STRING
    bool rw = false;       // access RW
};

struct AddressResult {
    bool ok = false;
    std::string error;  // E_ADDR_SYNTAX | E_ADDR_AREA | E_ADDR_RANGE
    std::string normalized;
    Area area = Area::HR;
    int fcRead = 0;
    std::vector<int> fcWrite;  // empty for read-only areas
    int offset = 0;
    int registers = 0;  // registers taken (a bit of C/DI or inside a register counts 1)
    int bit = -1;       // bit index in the register (0-15), -1 none
    std::vector<std::string> warnings;
};

// Registers a Tag takes (1 for BOOL; STRING: ceil(length / 2)).
int registerCount(TagType rawType, int stringLength);

// Letters are upper-cased; whitespace is not trimmed (Studio trims before calling).
AddressResult parseAddress(const std::string& address, const AddressOptions& opts);

}  // namespace mat::modbus
