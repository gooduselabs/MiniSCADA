// Modbus RTU frame (feature 006 T158; contracts/modbus-driver.md §3; research R10). Pure code
// except rtuReceive(), which reads a Transport against a Clock (a fake in the tests).
//   slave address (1), PDU, CRC-16/MODBUS (2, low byte first). ADU <= 256 bytes.
#pragma once
#include <cstddef>
#include <cstdint>

#include "drivers/modbus/pdu.hpp"
#include "drivers/sdk/diag.hpp"  // BadFrameKind only
#include "drivers/sdk/transport.hpp"

namespace mat::modbus {

constexpr size_t kMaxRtuAdu = 256;
constexpr int kRtuGapFloorMs = 20;  // two bytes of one frame never wait longer than max(t3.5, this)

// CRC-16/MODBUS: polynomial 0xA001 (reflected), initial value 0xFFFF.
uint16_t crc16(const uint8_t* data, size_t n);

// unit, PDU, CRC (low byte first).
Bytes encodeRtu(uint8_t unit, const Bytes& pdu);

// Length of a whole response frame (address and CRC included) from its first bytes.
//   01-04: 5 + byte count; 05, 06, 15, 16: 8; 22: 10; exception (function | 0x80): 5.
// kRtuNeedMore: the bytes seen so far are not enough to tell. kRtuBadFunction: no such function.
constexpr size_t kRtuNeedMore = 0;
constexpr size_t kRtuBadFunction = SIZE_MAX;
size_t rtuExpectedLength(const uint8_t* head, size_t n);

// Character = 1 start bit + data bits + parity bit (parity 'N' none, 'E', 'O') + stop bits.
int rtuCharBits(int dataBits, char parity, int stopBits);
// t3.5 in ms: 3.5 characters up to 19,200 bit/s, 1.75 ms above.
double rtuT35Ms(int baud, int charBits);
// The silence the driver keeps: t3.5 rounded up to a whole ms; `configuredMs` (0: none) when
// larger.
int rtuSilenceMs(int baud, int dataBits, char parity, int stopBits, int configuredMs);
inline int rtuGapMs(int silenceMs) {
    return silenceMs > kRtuGapFloorMs ? silenceMs : kRtuGapFloorMs;
}

enum class RtuIssue {
    None,
    Short,  // fewer bytes than the function says
    Extra,  // more bytes than the function says
    Crc,
    Unit,
    Function,   // another function than the request's (also an unknown one)
    ByteCount,  // byte count of a read does not match the quantity requested
    Format      // echoed fields differ
};
const char* rtuIssueName(RtuIssue issue);
// The counter of the diagnostics (contract §9): crc, unit, length (short, extra), format.
drv::BadFrameKind rtuIssueCounter(RtuIssue issue);

struct RtuCheck {
    RtuIssue issue = RtuIssue::Short;
    PduCheck pdu;  // with issue None: Ok or Exception
};
// Checks a whole response frame of `size` bytes against the request (`unit`, `requestPdu`), in the
// order of the vectors: length (short, extra), CRC, address, function, byte count and echoed
// fields.
RtuCheck checkRtuResponse(uint8_t unit, const Bytes& requestPdu, const uint8_t* data, size_t size);

struct RtuReceive {
    enum class Status {
        Frame,    // `bytes` is one whole frame (CRC and address not checked yet)
        Short,    // the gap passed before the frame was complete
        Extra,    // bytes beyond the frame
        Format,   // unknown function: no length to wait for
        Timeout,  // nothing arrived before the deadline
        Closed,
        Interrupted,
        Error
    };
    Status status = Status::Timeout;
    Bytes bytes;
    int64_t lastByteMs = 0;  // time of the last byte read (0: none)
};
// Reads one response frame: waits for the first byte until `deadlineMs`, then takes bytes until the
// length the function asks for, each within `gapMs` of the one before. A frame that is complete
// still waits one `silenceMs` (t3.5): a byte that comes makes the whole frame Extra, and what is
// received after it (up to 512 bytes) is thrown away. `carry`: bytes already read (what follows an
// echo).
RtuReceive rtuReceive(drv::Transport& transport, const drv::Clock& clock, int64_t deadlineMs,
                      int gapMs, int silenceMs, Bytes carry = {});

}  // namespace mat::modbus
