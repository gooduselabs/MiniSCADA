// Modbus PDU: request encoders and the check of a response against its request
// (contracts/modbus-driver.md §2, FR-032). Pure code, no I/O; the same vectors as the Node
// simulator (tests/modbus-vectors/frames).
#pragma once
#include <cstddef>
#include <cstdint>
#include <vector>

namespace mat::modbus {

using Bytes = std::vector<uint8_t>;

// Largest quantities of one request (function 1/2, 3/4, 15, 16).
constexpr int kMaxReadBits = 2000;
constexpr int kMaxReadRegisters = 125;
constexpr int kMaxWriteCoils = 1968;
constexpr int kMaxWriteRegisters = 123;

// Quantity allowed for the function `fc` (1, 2, 3, 4, 15, 16); false for any other function.
bool validQuantity(int fc, int qty);

// Request PDUs. An empty result means the arguments are outside the limits above (never sent).
Bytes readRequest(int fc, int address, int quantity);                     // 1, 2, 3, 4
Bytes writeSingleCoil(int address, bool on);                              // 5
Bytes writeSingleRegister(int address, uint16_t value);                   // 6
Bytes writeMultipleCoils(int address, const std::vector<uint8_t>& bits);  // 15, bits 0 or 1
Bytes writeMultipleRegisters(int address, const std::vector<uint16_t>& registers);  // 16
Bytes maskWriteRegister(int address, uint16_t andMask, uint16_t orMask);            // 22

enum class ResponseKind {
    Ok,         // the answer of the request's function, well formed
    Exception,  // function | 0x80 and an exception code: a valid answer (an error of the device)
    Format,     // too short, wrong length, echoed fields differ
    Function,   // another function than the request's
    ByteCount   // byte count of a read does not match the quantity requested
};

struct PduCheck {
    ResponseKind kind = ResponseKind::Format;
    int exception = -1;  // the code, with Exception
};

// `request`: the PDU that was sent. Checks the function (or function | 0x80), the byte count of a
// read against the quantity asked, the fields a write echoes.
PduCheck checkResponsePdu(const Bytes& request, const uint8_t* pdu, size_t size);

// Data of a checked response (`response` is the PDU): the registers of function 3/4 and the first
// `quantity` bits of function 1/2 (bit i in byte i / 8, low bit first).
std::vector<uint16_t> responseRegisters(const Bytes& response);
std::vector<uint8_t> responseBits(const Bytes& response, size_t quantity);

}  // namespace mat::modbus
