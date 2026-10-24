// MC protocol (SLMP) frames (feature 017; specs/017-driver-mc/contracts/mc-protocol.md §2-§3):
// 3E and 4E, binary and ASCII; Batch Read/Write 0401/1401 in word and bit units, Random Read 0403
// (Q/L subcommands, 1-byte device codes, 3-byte device numbers). Pure code, no I/O; the vectors of
// tests/mc-vectors/frames.json are shared with the simulator (tools/mc-sim).
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "drivers/mc/mc_address.hpp"

namespace mat::mc {

using Bytes = std::vector<uint8_t>;

enum class FrameType { E3, E4 };
enum class CodeType { Binary, Ascii };

struct Route {
    uint8_t network = 0;
    uint8_t station = 0xFF;  // PC no
    uint16_t moduleIo = 0x03FF;
    uint8_t moduleStation = 0;
};

struct FrameOptions {
    FrameType frame = FrameType::E3;
    CodeType code = CodeType::Binary;
    Route route;
    uint16_t timer = 4;    // monitoring timer, 250 ms units
    bool xyOctal = false;  // ASCII: X and Y numbers written in octal
};

// Monitoring timer for a request that the driver waits `timeoutMs` for: the PLC gives up first.
uint16_t monitoringTimer(int timeoutMs);

struct DevRef {
    Device device = Device::D;
    uint32_t number = 0;
};

enum class Cmd { ReadWords, ReadBits, WriteWords, WriteBits, RandomRead };

struct Request {
    Cmd cmd = Cmd::ReadWords;
    DevRef dev;                        // batch commands
    uint16_t points = 0;               // ReadWords: words; ReadBits: points
    std::vector<uint16_t> words;       // WriteWords
    std::vector<uint8_t> bits;         // WriteBits: 0 or 1 per point
    std::vector<DevRef> randomWords;   // RandomRead: word points
    std::vector<DevRef> randomDwords;  // RandomRead: double word points
};

// Limits of one command (Q/L, contracts §2.4).
constexpr int kMaxBatchWords = 960;
constexpr int kMaxBatchBits = 7168;
constexpr int kMaxRandomPoints = 192;

uint16_t commandOf(Cmd c);
uint16_t subcommandOf(Cmd c);

// The whole request frame; `serial` is only used by 4E.
Bytes encodeRequest(const FrameOptions& o, uint16_t serial, const Request& r);

enum class SplitStatus { NeedMore, Frame, Lost };
struct Split {
    SplitStatus status = SplitStatus::NeedMore;
    size_t size = 0;  // with Frame: the bytes of the first frame
};
// The first response frame of a stream (TCP): by the subheader and the length field. Lost: the
// bytes cannot start a response of this frame type and code (the stream lost its framing).
Split splitResponse(FrameType frame, CodeType code, const uint8_t* data, size_t n);

enum class Issue { None, Format, Route, Serial, Length };

struct Response {
    Issue issue = Issue::Format;
    uint16_t serial = 0;   // 4E: the serial of the response (also with Issue::Serial)
    uint16_t endCode = 0;  // with Issue::None
    // End code 0: ReadWords the words; RandomRead the word points then each double word as two
    // words (low first); ReadBits one 0/1 per point.
    std::vector<uint16_t> words;
    std::vector<uint8_t> bits;
};

// Checks `n` bytes as exactly one response to `r` sent with `o` and `serial`: subheader, routing,
// serial (4E), length field against `n`, and with end code 0 the data length the command wants.
Response checkResponse(const FrameOptions& o, uint16_t serial, const Request& r,
                       const uint8_t* data, size_t n);

}  // namespace mat::mc
