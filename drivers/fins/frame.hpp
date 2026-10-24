// Omron FINS frames (feature 018, spec FR-001 to FR-003; FINS Commands Reference Manual W342 §3,
// §5; FINS/TCP: W421 §6). Pure code, no I/O; vectors in tests/fins-vectors/frames.json.
//
// A FINS frame: a 10-byte header (ICF RSV GCT DNA DA1 DA2 SNA SA1 SA2 SID), the command code (MRC
// SRC) and the parameters. A response has the same header with the addresses swapped, ICF bit 6
// set, the command code, the end code (MRES SRES) and the data. Over UDP one datagram is one frame;
// over TCP every message has a 16-byte header ("FINS", length, command, error code), the length
// counting from the command field.
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace mat::fins {

using Bytes = std::vector<uint8_t>;

constexpr size_t kHeaderSize = 10;
constexpr size_t kMaxFrame = 2012;  // the largest FINS frame of a CS/CJ Ethernet unit
constexpr uint8_t kIcfCommand = 0x80;
constexpr uint8_t kGct = 0x02;

constexpr uint16_t kMemoryAreaRead = 0x0101;
constexpr uint16_t kMemoryAreaWrite = 0x0102;
constexpr uint16_t kMultipleMemoryAreaRead = 0x0104;
constexpr uint16_t kControllerDataRead = 0x0501;

// The largest word count of one 0101 read (response 14 + 2 x 999 bytes = 2012).
constexpr int kMaxReadWords = 999;
// The largest word count of one 0102 write (command 18 + 2 x 997 = 2012); the validator keeps 990.
constexpr int kMaxWriteWords = 990;
// The largest item count of one 0104 read accepted here (a CS/CJ takes 167).
constexpr int kMaxMultiItems = 128;

// A FINS node: network (0 = local), node, unit (0 = the CPU unit).
struct Endpoint {
    uint8_t network = 0;
    uint8_t node = 0;
    uint8_t unit = 0;
};

// A whole command frame.
Bytes encodeCommand(const Endpoint& dst, const Endpoint& src, uint8_t sid, uint16_t command,
                    const Bytes& params);

// Parameters of the commands.
Bytes memoryAreaReadParams(uint8_t areaCode, uint16_t address, uint8_t bit, uint16_t count);
// `data`: 2 bytes per word (big-endian) with a word area code, 1 byte (0 or 1) per bit with a bit
// area code; `count` items.
Bytes memoryAreaWriteParams(uint8_t areaCode, uint16_t address, uint8_t bit, uint16_t count,
                            const Bytes& data);
struct MultiItem {
    uint8_t areaCode = 0;
    uint16_t address = 0;
    uint8_t bit = 0;
};
Bytes multipleReadParams(const std::vector<MultiItem>& items);

// The words of a word area code are 2 bytes; anything else (bit areas, the T/C flags) 1 byte.
bool isWordCode(uint8_t areaCode);

enum class FrameIssue { None, Short, NotResponse, Route, Sid, Command, Length };

struct Response {
    FrameIssue issue = FrameIssue::Short;
    Endpoint dst, src;  // as the response carries them (dst = us)
    uint8_t sid = 0;
    uint16_t command = 0;
    uint8_t mres = 0, sres = 0;
    uint16_t endCode =
        0;  // relay and PLC error bits masked off: (MRES & 0x7F) << 8 | (SRES & 0x3F)
    bool relayError = false;   // MRES bit 7
    bool plcFatal = false;     // SRES bit 7
    bool plcNonFatal = false;  // SRES bit 6
    Bytes data;
};

// Reads a response frame: header, command code, end code, data. `issue` Short when it is shorter
// than 14 bytes, NotResponse when ICF bit 6 is clear, Length when it is longer than kMaxFrame.
Response parseResponse(const uint8_t* p, size_t n);

// The response matches the request sent from `us` to `peer` with `sid` and `command`. Nodes and
// units are compared; networks only when the request named one (DNA 0 is "the local network", a
// PLC with routing tables answers from its own number).
FrameIssue checkResponse(const Response& r, const Endpoint& peer, const Endpoint& us, uint8_t sid,
                         uint16_t command);

// The data of a 0101 response: `count` words (2 bytes each) or `count` bits (1 byte each, 0 or
// 1 as 0/1 words). false when the length is not exactly that.
bool readData(const Bytes& data, bool words, size_t count, std::vector<uint16_t>& out);
// The data of a 0104 response: per item its area code then 2 bytes (word) or 1 byte (bit). false
// when an area code or the length does not match the items.
bool multipleReadData(const Bytes& data, const std::vector<MultiItem>& items,
                      std::vector<uint16_t>& out);
// The CPU model of a 0501 response (the first 20 bytes, ASCII, spaces and zeros cut).
std::string controllerModel(const Bytes& data);

// ---- FINS/TCP ----
constexpr size_t kTcpHeaderSize = 16;
constexpr uint32_t kTcpNodeRequest = 0;   // client -> server: node address data send
constexpr uint32_t kTcpNodeResponse = 1;  // server -> client
constexpr uint32_t kTcpFrame = 2;         // a FINS frame
constexpr uint32_t kTcpFrameError = 3;    // FINS frame send error notification

// Node address data send (command 0); `clientNode` 0: the server picks one.
Bytes tcpNodeRequest(uint32_t clientNode);
// A FINS frame inside a TCP message (command 2).
Bytes tcpWrap(const Bytes& frame);

enum class TcpSplit { NeedMore, Message, Bad };
struct TcpMessage {
    TcpSplit status = TcpSplit::NeedMore;
    size_t size = 0;  // the whole message, header included
    uint32_t command = 0;
    uint32_t error = 0;
};
// The first message in `p`: NeedMore until it is whole; Bad when it does not start with "FINS" or
// its length is below 8 or above 8 + kMaxFrame (the stream cannot be read further).
TcpMessage splitTcp(const uint8_t* p, size_t n);
// The body of a node address response (command 1): the client node and the server node.
bool tcpNodeResponse(const uint8_t* p, size_t n, uint32_t& clientNode, uint32_t& serverNode);
// The FINS/TCP error codes (W421 §6-6): English text for the log.
const char* tcpErrorName(uint32_t error);

}  // namespace mat::fins
