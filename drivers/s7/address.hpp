// Siemens S7 address of an external Tag (feature 016, specs/016-driver-s7/contracts/s7-driver.md
// §2). Pure code, no I/O; the same vectors as packages/tag-codec/src/s7-address.ts
// (tests/s7-vectors/address.json).
//
//   s7-address = "DB" num "." db-item / area area-item
//   db-item    = "DBX" num "." bit / "DBB" num / "DBW" num / "DBD" num / "STRING" num / "LREAL" num
//   area       = "M" / "I" / "E" / "Q" / "A"        ; E = I, A = Q (German mnemonics)
//   area-item  = num "." bit / "B" num / "W" num / "D" num
//
// The S7 type follows from the size in the address and the Tag's raw type.
#pragma once
#include <string>

#include "core/tag-engine/tag_store.hpp"  // TagType (types only)

namespace mat::s7 {

enum class Area { DB, I, Q, M };
enum class S7Type { BOOL, BYTE, CHAR, INT, WORD, DINT, DWORD, REAL, LREAL, STRING };

const char* areaName(Area a);
const char* s7TypeName(S7Type t);
// The area code of the S7ANY item: 0x84 DB, 0x81 I, 0x82 Q, 0x83 M.
int areaCode(Area a);

struct AddressOptions {
    TagType rawType = TagType::INT16;
    int stringLength = 0;  // characters of CHAR / STRING
    bool rw = false;       // access RW
};

struct Address {
    bool ok = false;
    std::string error;  // E_ADDR_SYNTAX | E_ADDR_AREA | E_ADDR_RANGE
    std::string normalized;
    Area area = Area::DB;
    int db = 0;  // 0 outside DB
    int byte = 0;
    int bit = -1;  // -1: not a bit
    S7Type type = S7Type::BYTE;
    int size = 0;  // bytes taken (a bit: 1)
};

// Bytes of an S7 type (`n`: characters of CHAR / STRING).
int typeSize(S7Type t, int n);
// Bytes a write sends (a STRING leaves its maximum length byte alone).
int writeSize(S7Type t, int size);

// Letters are upper-cased; whitespace is not trimmed.
Address parseAddress(const std::string& address, const AddressOptions& opts);

}  // namespace mat::s7
