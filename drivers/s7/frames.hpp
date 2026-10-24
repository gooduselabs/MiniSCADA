// S7comm over ISO-on-TCP (feature 016, specs/016-driver-s7/contracts/s7-driver.md §3). Pure code,
// no I/O; byte vectors in tests/s7-vectors/frames.json (shared with tools/s7-sim).
//
// A frame is TPKT (RFC 1006: 03 00 <length 2>) + COTP (RFC 905, class 0: CR, CC, DR, DT 02 F0 80)
// + an S7 PDU (0x32, ROSCTR, ..., PDU reference, parameter and data lengths). Every multi-byte
// number is big-endian. The decoders check every length against the bytes they were given and never
// read past them.
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "core/tag-engine/tag_store.hpp"  // TagScalar
#include "drivers/s7/address.hpp"

namespace mat::s7 {

using Bytes = std::vector<uint8_t>;

constexpr size_t kTpktHeader = 4;
constexpr size_t kMaxFrame = 4096;  // a TPKT longer than this is not ours
constexpr int kMaxItems = 20;       // items of one Read Var request
constexpr int kReadOverhead = 18;   // S7 PDU of a one-item Read Var answer minus its data
constexpr int kWriteOverhead = 28;  // S7 PDU of a one-item Write Var request minus its data
constexpr int kMinPdu = 240;
constexpr int kMaxPdu = 960;

// One item of a Read or Write Var request: `size` bytes from `byte`, or the bit `bit` (size 1).
struct Item {
    Area area = Area::DB;
    int db = 0;
    int byte = 0;
    int bit = -1;
    int size = 1;
};

// TSAP of the PG connection to rack/slot: 0x0100 | rack << 5 | slot.
uint16_t remoteTsapOf(int rack, int slot);

Bytes encodeConnect(uint16_t localTsap, uint16_t remoteTsap);
// A whole TPKT frame: true for a COTP CC, false for a DR or anything else.
bool isConnectConfirm(const uint8_t* frame, size_t n);

Bytes encodeSetup(uint16_t ref, int pduSize);
Bytes encodeRead(uint16_t ref, const std::vector<Item>& items);
// `data`: the item's bytes (a bit: one byte 0 or 1).
Bytes encodeWrite(uint16_t ref, const Item& item, const Bytes& data);

// Cuts the next TPKT frame from a stream.
struct Split {
    enum class Status { NeedMore, Frame, Bad } status = Status::NeedMore;
    size_t size = 0;  // with Frame
};
Split splitTpkt(const uint8_t* data, size_t n);

// The payload of a COTP DT frame (a whole TPKT frame). ok false: not a DT frame.
struct DataTpdu {
    bool ok = false;
    bool eot = true;  // last fragment of the S7 PDU
    size_t offset = 0;
    size_t size = 0;
};
DataTpdu dataOf(const uint8_t* frame, size_t n);

// Answers. `pdu` is the S7 PDU (from 0x32). ok: a valid answer without a header error. format:
// the bytes are not a valid answer of that function (a frame error). error: the header error
// (class << 8 | code) of an answer that has one.
struct Reply {
    bool ok = false;
    bool format = false;
    uint16_t ref = 0;
    int error = 0;
};
struct SetupReply : Reply {
    int pduSize = 0;
};
struct ItemReply {
    int rc = 0;  // 0xFF: success
    Bytes data;
};
struct ReadReply : Reply {
    std::vector<ItemReply> items;
};
struct WriteReply : Reply {
    int rc = 0;
};
SetupReply decodeSetup(const uint8_t* pdu, size_t n);
// `sizes`: the bytes asked for each item, in order; an answer with other counts is a format error.
ReadReply decodeRead(const uint8_t* pdu, size_t n, const std::vector<int>& sizes);
WriteReply decodeWrite(const uint8_t* pdu, size_t n);

// Values (big-endian; CHAR and STRING are Latin-1, the value is UTF-8).
struct Decoded {
    bool ok = false;
    TagScalar value;
    std::string reason;  // INVALID_VALUE (NaN, infinity) or BAD_FRAME (too few bytes)
};
// `bytes` holds the Tag's `size` bytes (a bit: its byte); `length` the characters of CHAR/STRING.
Decoded decodeValue(S7Type type, int bit, const uint8_t* bytes, size_t n, int length);
// The bytes a Tag holds for `value` (a bit: 0 or 1; a STRING: max, current length, characters
// padded with 0). false: the value does not fit (type, range, length, not Latin-1).
bool encodeValue(S7Type type, const TagScalar& value, int length, Bytes& out);

// Quality reason of an item return code (contract §5), and of a header error.
const char* itemReason(int rc);
const char* headerReason(int error);

}  // namespace mat::s7
