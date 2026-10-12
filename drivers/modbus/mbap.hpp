// Modbus TCP frame (MBAP header + PDU), contracts/modbus-driver.md §3, FR-032. Pure code.
//   transaction id (2), protocol id (2) = 0, length (2) = 1 + PDU length, unit (1), PDU.
#pragma once
#include <cstddef>
#include <cstdint>

#include "drivers/modbus/pdu.hpp"
#include "drivers/sdk/diag.hpp"  // BadFrameKind only (a header-only enum)

namespace mat::modbus {

constexpr size_t kMbapSize = 7;  // up to and including the unit id
constexpr size_t kMaxAdu = 260;  // 7 + a PDU of at most 253 bytes

Bytes encodeAdu(uint16_t transactionId, uint8_t unit, const Bytes& pdu);

enum class FrameIssue {
    None,
    Short,     // fewer than 8 bytes: no PDU
    Tid,       // transaction id differs
    Protocol,  // protocol id is not 0
    Length,    // the length field does not match the bytes received
    Unit,
    Function,
    ByteCount,
    Format
};
const char* frameIssueName(FrameIssue issue);  // "short", "tid", "protocol", "length", ...
// The counter of the diagnostics (contract §9): tid, unit, length, format.
drv::BadFrameKind frameIssueCounter(FrameIssue issue);

struct AduCheck {
    FrameIssue issue = FrameIssue::Short;
    PduCheck pdu;  // with issue None: Ok or Exception
};

// Checks a whole response frame of `size` bytes against the request (`tid`, `unit`, `requestPdu`),
// in the order of the contract: size, transaction id, protocol id, length, unit, function, byte
// count and echoed fields.
AduCheck checkTcpResponse(uint16_t tid, uint8_t unit, const Bytes& requestPdu, const uint8_t* data,
                          size_t size);

// Cuts frames out of a byte stream by the length field.
enum class SplitStatus { NeedMore, Frame, Lost };
struct Split {
    SplitStatus status = SplitStatus::NeedMore;
    size_t size = 0;  // Frame: bytes of the first frame
};
// Lost: the length field is below 2 or above 254, so no frame boundary can be trusted: the
// connection must be closed and opened again.
Split splitFrame(const uint8_t* data, size_t size);

}  // namespace mat::modbus
