#include "drivers/fins/frame.hpp"

namespace mat::fins {

namespace {

void put16(Bytes& b, uint16_t v) {
    b.push_back(static_cast<uint8_t>(v >> 8));
    b.push_back(static_cast<uint8_t>(v & 0xFF));
}

void put32(Bytes& b, uint32_t v) {
    b.push_back(static_cast<uint8_t>(v >> 24));
    b.push_back(static_cast<uint8_t>((v >> 16) & 0xFF));
    b.push_back(static_cast<uint8_t>((v >> 8) & 0xFF));
    b.push_back(static_cast<uint8_t>(v & 0xFF));
}

uint32_t get32(const uint8_t* p) {
    return (static_cast<uint32_t>(p[0]) << 24) | (static_cast<uint32_t>(p[1]) << 16) |
           (static_cast<uint32_t>(p[2]) << 8) | static_cast<uint32_t>(p[3]);
}

constexpr uint32_t kMagic = 0x46494E53;  // "FINS"

}  // namespace

Bytes encodeCommand(const Endpoint& dst, const Endpoint& src, uint8_t sid, uint16_t command,
                    const Bytes& params) {
    Bytes b;
    b.reserve(kHeaderSize + 2 + params.size());
    b.push_back(kIcfCommand);
    b.push_back(0x00);
    b.push_back(kGct);
    b.push_back(dst.network);
    b.push_back(dst.node);
    b.push_back(dst.unit);
    b.push_back(src.network);
    b.push_back(src.node);
    b.push_back(src.unit);
    b.push_back(sid);
    put16(b, command);
    b.insert(b.end(), params.begin(), params.end());
    return b;
}

Bytes memoryAreaReadParams(uint8_t areaCode, uint16_t address, uint8_t bit, uint16_t count) {
    Bytes b;
    b.push_back(areaCode);
    put16(b, address);
    b.push_back(bit);
    put16(b, count);
    return b;
}

Bytes memoryAreaWriteParams(uint8_t areaCode, uint16_t address, uint8_t bit, uint16_t count,
                            const Bytes& data) {
    Bytes b = memoryAreaReadParams(areaCode, address, bit, count);
    b.insert(b.end(), data.begin(), data.end());
    return b;
}

Bytes multipleReadParams(const std::vector<MultiItem>& items) {
    Bytes b;
    b.reserve(items.size() * 4);
    for (const MultiItem& it : items) {
        b.push_back(it.areaCode);
        put16(b, it.address);
        b.push_back(it.bit);
    }
    return b;
}

bool isWordCode(uint8_t c) {
    // CIO/W/H/A words B0-B3, DM 82, EM banks A0-AC and current bank 98, T/C present value 89
    return (c >= 0xB0 && c <= 0xB3) || c == 0x82 || (c >= 0xA0 && c <= 0xAC) || c == 0x98 ||
           c == 0x89;
}

Response parseResponse(const uint8_t* p, size_t n) {
    Response r;
    if (n < kHeaderSize + 4) {
        r.issue = FrameIssue::Short;
        return r;
    }
    if (n > kMaxFrame) {
        r.issue = FrameIssue::Length;
        return r;
    }
    if ((p[0] & 0x40) == 0) {
        r.issue = FrameIssue::NotResponse;
        return r;
    }
    r.dst = {p[3], p[4], p[5]};
    r.src = {p[6], p[7], p[8]};
    r.sid = p[9];
    r.command = static_cast<uint16_t>((p[10] << 8) | p[11]);
    r.mres = p[12];
    r.sres = p[13];
    r.relayError = (r.mres & 0x80) != 0;
    r.plcFatal = (r.sres & 0x80) != 0;
    r.plcNonFatal = (r.sres & 0x40) != 0;
    r.endCode = static_cast<uint16_t>(((r.mres & 0x7F) << 8) | (r.sres & 0x3F));
    r.data.assign(p + kHeaderSize + 4, p + n);
    r.issue = FrameIssue::None;
    return r;
}

FrameIssue checkResponse(const Response& r, const Endpoint& peer, const Endpoint& us, uint8_t sid,
                         uint16_t command) {
    if (r.issue != FrameIssue::None) return r.issue;
    if (r.dst.node != us.node || r.dst.unit != us.unit || r.src.node != peer.node ||
        r.src.unit != peer.unit)
        return FrameIssue::Route;
    if ((us.network != 0 && r.dst.network != us.network) ||
        (peer.network != 0 && r.src.network != peer.network))
        return FrameIssue::Route;
    if (r.sid != sid) return FrameIssue::Sid;
    if (r.command != command) return FrameIssue::Command;
    return FrameIssue::None;
}

bool readData(const Bytes& data, bool words, size_t count, std::vector<uint16_t>& out) {
    out.clear();
    if (data.size() != count * (words ? 2 : 1)) return false;
    out.reserve(count);
    for (size_t i = 0; i < count; ++i)
        out.push_back(words ? static_cast<uint16_t>((data[2 * i] << 8) | data[2 * i + 1])
                            : static_cast<uint16_t>(data[i] != 0));
    return true;
}

bool multipleReadData(const Bytes& data, const std::vector<MultiItem>& items,
                      std::vector<uint16_t>& out) {
    out.clear();
    out.reserve(items.size());
    size_t at = 0;
    for (const MultiItem& it : items) {
        const bool word = isWordCode(it.areaCode);
        const size_t need = word ? 3 : 2;
        if (at + need > data.size() || data[at] != it.areaCode) return false;
        out.push_back(word ? static_cast<uint16_t>((data[at + 1] << 8) | data[at + 2])
                           : static_cast<uint16_t>(data[at + 1] != 0));
        at += need;
    }
    return at == data.size();
}

std::string controllerModel(const Bytes& data) {
    std::string s;
    for (size_t i = 0; i < data.size() && i < 20; ++i) {
        const uint8_t c = data[i];
        if (c == 0) break;
        s.push_back(c >= 0x20 && c < 0x7F ? static_cast<char>(c) : '?');
    }
    while (!s.empty() && s.back() == ' ') s.pop_back();
    return s;
}

Bytes tcpNodeRequest(uint32_t clientNode) {
    Bytes b;
    put32(b, kMagic);
    put32(b, 12);
    put32(b, kTcpNodeRequest);
    put32(b, 0);
    put32(b, clientNode);
    return b;
}

Bytes tcpWrap(const Bytes& frame) {
    Bytes b;
    b.reserve(kTcpHeaderSize + frame.size());
    put32(b, kMagic);
    put32(b, static_cast<uint32_t>(8 + frame.size()));
    put32(b, kTcpFrame);
    put32(b, 0);
    b.insert(b.end(), frame.begin(), frame.end());
    return b;
}

TcpMessage splitTcp(const uint8_t* p, size_t n) {
    TcpMessage m;
    const size_t magicSeen = n < 4 ? n : 4;
    for (size_t i = 0; i < magicSeen; ++i)
        if (p[i] != static_cast<uint8_t>(kMagic >> (24 - 8 * i))) {
            m.status = TcpSplit::Bad;
            return m;
        }
    if (n < 8) return m;
    const uint32_t len = get32(p + 4);
    if (len < 8 || len > 8 + kMaxFrame) {
        m.status = TcpSplit::Bad;
        return m;
    }
    if (n < 8 + static_cast<size_t>(len)) return m;
    m.status = TcpSplit::Message;
    m.size = 8 + len;
    m.command = get32(p + 8);
    m.error = get32(p + 12);
    return m;
}

bool tcpNodeResponse(const uint8_t* p, size_t n, uint32_t& clientNode, uint32_t& serverNode) {
    if (n != kTcpHeaderSize + 8) return false;
    clientNode = get32(p + 16);
    serverNode = get32(p + 20);
    return true;
}

const char* tcpErrorName(uint32_t error) {
    switch (error) {
        case 0x00:
            return "normal";
        case 0x01:
            return "header is not FINS";
        case 0x02:
            return "data length too long";
        case 0x03:
            return "command not supported";
        case 0x20:
            return "all connections are in use";
        case 0x21:
            return "the client node is already connected";
        case 0x22:
            return "protected node, this IP address is not allowed";
        case 0x23:
            return "client node out of range";
        case 0x24:
            return "client and server have the same node";
        case 0x25:
            return "all node addresses are in use";
        default:
            return "other error";
    }
}

}  // namespace mat::fins
