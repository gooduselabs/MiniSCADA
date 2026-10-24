#include "drivers/mc/mc_frame.hpp"

#include <algorithm>

namespace mat::mc {

namespace {

// The longest response data of the commands the driver sends (binary bytes / ASCII characters
// after the end code), plus room for the error information: a larger length is not a response.
constexpr size_t kMaxBinaryLen = 2 + 2 * kMaxBatchWords + 16;
constexpr size_t kMaxAsciiLen = 4 + 4 * kMaxBatchWords + 32;

const char kHex[] = "0123456789ABCDEF";

void hexText(std::string& out, uint32_t v, int digits) {
    for (int i = digits - 1; i >= 0; --i) out.push_back(kHex[(v >> (4 * i)) & 0xF]);
}

void le16(Bytes& b, uint16_t v) {
    b.push_back(static_cast<uint8_t>(v & 0xFF));
    b.push_back(static_cast<uint8_t>(v >> 8));
}

int hexDigit(uint8_t c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

// `digits` hex characters at p; false when one is not 0-9A-F.
bool readHex(const uint8_t* p, int digits, uint32_t& v) {
    v = 0;
    for (int i = 0; i < digits; ++i) {
        const int d = hexDigit(p[i]);
        if (d < 0) return false;
        v = (v << 4) | static_cast<uint32_t>(d);
    }
    return true;
}

void binDevice(Bytes& b, const DevRef& d) {
    b.push_back(static_cast<uint8_t>(d.number & 0xFF));
    b.push_back(static_cast<uint8_t>((d.number >> 8) & 0xFF));
    b.push_back(static_cast<uint8_t>((d.number >> 16) & 0xFF));
    b.push_back(deviceInfo(d.device).code);
}

void asciiDevice(std::string& s, const DevRef& d, bool xyOctal) {
    const McDeviceInfo& i = deviceInfo(d.device);
    s += i.ascii;
    int radix = i.asciiRadix;
    if (xyOctal && (d.device == Device::X || d.device == Device::Y)) radix = 8;
    char digits[6];
    uint32_t v = d.number;
    for (int k = 5; k >= 0; --k) {
        digits[k] = kHex[v % static_cast<uint32_t>(radix)];
        v /= static_cast<uint32_t>(radix);
    }
    s.append(digits, 6);
}

// The data of the request, binary.
Bytes binaryData(const Request& r) {
    Bytes b;
    switch (r.cmd) {
        case Cmd::ReadWords:
        case Cmd::ReadBits:
            binDevice(b, r.dev);
            le16(b, r.points);
            break;
        case Cmd::WriteWords:
            binDevice(b, r.dev);
            le16(b, static_cast<uint16_t>(r.words.size()));
            for (uint16_t w : r.words) le16(b, w);
            break;
        case Cmd::WriteBits:
            binDevice(b, r.dev);
            le16(b, static_cast<uint16_t>(r.bits.size()));
            for (size_t i = 0; i < r.bits.size(); i += 2) {
                uint8_t v = static_cast<uint8_t>((r.bits[i] ? 1 : 0) << 4);
                if (i + 1 < r.bits.size() && r.bits[i + 1]) v |= 1;
                b.push_back(v);
            }
            break;
        case Cmd::RandomRead:
            b.push_back(static_cast<uint8_t>(r.randomWords.size()));
            b.push_back(static_cast<uint8_t>(r.randomDwords.size()));
            for (const auto& d : r.randomWords) binDevice(b, d);
            for (const auto& d : r.randomDwords) binDevice(b, d);
            break;
    }
    return b;
}

std::string asciiData(const Request& r, bool xyOctal) {
    std::string s;
    switch (r.cmd) {
        case Cmd::ReadWords:
        case Cmd::ReadBits:
            asciiDevice(s, r.dev, xyOctal);
            hexText(s, r.points, 4);
            break;
        case Cmd::WriteWords:
            asciiDevice(s, r.dev, xyOctal);
            hexText(s, static_cast<uint32_t>(r.words.size()), 4);
            for (uint16_t w : r.words) hexText(s, w, 4);
            break;
        case Cmd::WriteBits:
            asciiDevice(s, r.dev, xyOctal);
            hexText(s, static_cast<uint32_t>(r.bits.size()), 4);
            for (uint8_t v : r.bits) s.push_back(v ? '1' : '0');
            break;
        case Cmd::RandomRead:
            hexText(s, static_cast<uint32_t>(r.randomWords.size()), 2);
            hexText(s, static_cast<uint32_t>(r.randomDwords.size()), 2);
            for (const auto& d : r.randomWords) asciiDevice(s, d, xyOctal);
            for (const auto& d : r.randomDwords) asciiDevice(s, d, xyOctal);
            break;
    }
    return s;
}

// Units of response data a successful answer carries: binary bytes or ASCII characters.
size_t expectedData(const Request& r, CodeType code) {
    const bool a = code == CodeType::Ascii;
    switch (r.cmd) {
        case Cmd::ReadWords:
            return static_cast<size_t>(r.points) * (a ? 4 : 2);
        case Cmd::ReadBits:
            return a ? r.points : (static_cast<size_t>(r.points) + 1) / 2;
        case Cmd::WriteWords:
        case Cmd::WriteBits:
            return 0;
        case Cmd::RandomRead:
            return r.randomWords.size() * (a ? 4 : 2) + r.randomDwords.size() * (a ? 8 : 4);
    }
    return 0;
}

// Sizes of the header before the length field and of the whole fixed part.
struct Layout {
    size_t lenAt;    // offset of the length field
    size_t dataAt;   // offset of the end code (the length counts from here)
    size_t lenSize;  // 2 bytes or 4 characters
};

Layout layoutOf(FrameType f, CodeType c) {
    if (c == CodeType::Binary) return f == FrameType::E3 ? Layout{7, 9, 2} : Layout{11, 13, 2};
    return f == FrameType::E3 ? Layout{14, 18, 4} : Layout{22, 26, 4};
}

bool subheaderOk(FrameType f, CodeType c, const uint8_t* p, size_t n) {
    // compares what is there of the subheader (n may be short)
    static const uint8_t b3[] = {0xD0, 0x00}, b4[] = {0xD4, 0x00};
    static const char a3[] = "D000", a4[] = "D400";
    const uint8_t* want = c == CodeType::Binary
                              ? (f == FrameType::E3 ? b3 : b4)
                              : reinterpret_cast<const uint8_t*>(f == FrameType::E3 ? a3 : a4);
    const size_t len = c == CodeType::Binary ? 2 : 4;
    for (size_t i = 0; i < std::min(n, len); ++i)
        if (p[i] != want[i]) return false;
    return true;
}

bool readLength(CodeType c, const uint8_t* p, size_t& len) {
    if (c == CodeType::Binary) {
        len = static_cast<size_t>(p[0]) | (static_cast<size_t>(p[1]) << 8);
        return true;
    }
    uint32_t v;
    if (!readHex(p, 4, v)) return false;
    len = v;
    return true;
}

}  // namespace

uint16_t monitoringTimer(int timeoutMs) {
    const int t = (timeoutMs - 250) / 250;
    return static_cast<uint16_t>(std::max(1, std::min(t, 0xFFFF)));
}

uint16_t commandOf(Cmd c) {
    switch (c) {
        case Cmd::ReadWords:
        case Cmd::ReadBits:
            return 0x0401;
        case Cmd::WriteWords:
        case Cmd::WriteBits:
            return 0x1401;
        case Cmd::RandomRead:
            return 0x0403;
    }
    return 0x0401;
}

uint16_t subcommandOf(Cmd c) { return (c == Cmd::ReadBits || c == Cmd::WriteBits) ? 1 : 0; }

Bytes encodeRequest(const FrameOptions& o, uint16_t serial, const Request& r) {
    const Route& rt = o.route;
    if (o.code == CodeType::Binary) {
        const Bytes data = binaryData(r);
        Bytes b;
        b.reserve(21 + data.size());
        if (o.frame == FrameType::E3) {
            b = {0x50, 0x00};
        } else {
            b = {0x54, 0x00};
            le16(b, serial);
            le16(b, 0);
        }
        b.push_back(rt.network);
        b.push_back(rt.station);
        le16(b, rt.moduleIo);
        b.push_back(rt.moduleStation);
        le16(b, static_cast<uint16_t>(6 + data.size()));
        le16(b, o.timer);
        le16(b, commandOf(r.cmd));
        le16(b, subcommandOf(r.cmd));
        b.insert(b.end(), data.begin(), data.end());
        return b;
    }
    const std::string data = asciiData(r, o.xyOctal);
    std::string s;
    s.reserve(42 + data.size());
    if (o.frame == FrameType::E3) {
        s = "5000";
    } else {
        s = "5400";
        hexText(s, serial, 4);
        s += "0000";
    }
    hexText(s, rt.network, 2);
    hexText(s, rt.station, 2);
    hexText(s, rt.moduleIo, 4);
    hexText(s, rt.moduleStation, 2);
    hexText(s, static_cast<uint32_t>(12 + data.size()), 4);
    hexText(s, o.timer, 4);
    hexText(s, commandOf(r.cmd), 4);
    hexText(s, subcommandOf(r.cmd), 4);
    s += data;
    return Bytes(s.begin(), s.end());
}

Split splitResponse(FrameType frame, CodeType code, const uint8_t* data, size_t n) {
    Split s;
    if (!subheaderOk(frame, code, data, n)) {
        s.status = SplitStatus::Lost;
        return s;
    }
    const Layout l = layoutOf(frame, code);
    if (n < l.dataAt) return s;  // NeedMore
    size_t len = 0;
    if (!readLength(code, data + l.lenAt, len) || len < (code == CodeType::Binary ? 2u : 4u) ||
        len > (code == CodeType::Binary ? kMaxBinaryLen : kMaxAsciiLen)) {
        s.status = SplitStatus::Lost;
        return s;
    }
    if (n < l.dataAt + len) return s;
    s.status = SplitStatus::Frame;
    s.size = l.dataAt + len;
    return s;
}

Response checkResponse(const FrameOptions& o, uint16_t serial, const Request& r, const uint8_t* p,
                       size_t n) {
    Response out;
    out.issue = Issue::Format;
    const bool bin = o.code == CodeType::Binary;
    const Layout l = layoutOf(o.frame, o.code);
    if (n < l.dataAt || !subheaderOk(o.frame, o.code, p, n)) return out;
    // serial and the two reserved units (4E)
    size_t at = bin ? 2 : 4;
    if (o.frame == FrameType::E4) {
        uint32_t ser = 0, reserved = 0;
        if (bin) {
            ser = static_cast<uint32_t>(p[2] | (p[3] << 8));
            reserved = static_cast<uint32_t>(p[4] | (p[5] << 8));
            at = 6;
        } else {
            if (!readHex(p + 4, 4, ser) || !readHex(p + 8, 4, reserved)) return out;
            at = 12;
        }
        out.serial = static_cast<uint16_t>(ser);
        (void)reserved;  // reserved: not checked (a PLC may answer anything there)
    }
    // routing
    uint32_t net, pc, io, st;
    if (bin) {
        net = p[at];
        pc = p[at + 1];
        io = static_cast<uint32_t>(p[at + 2] | (p[at + 3] << 8));
        st = p[at + 4];
    } else if (!readHex(p + at, 2, net) || !readHex(p + at + 2, 2, pc) ||
               !readHex(p + at + 4, 4, io) || !readHex(p + at + 8, 2, st)) {
        return out;
    }
    size_t len = 0;
    if (!readLength(o.code, p + l.lenAt, len) || len < (bin ? 2u : 4u)) return out;
    if (o.frame == FrameType::E4 && out.serial != serial) {
        out.issue = Issue::Serial;
        return out;
    }
    if (net != o.route.network || pc != o.route.station || io != o.route.moduleIo ||
        st != o.route.moduleStation) {
        out.issue = Issue::Route;
        return out;
    }
    if (l.dataAt + len != n) {
        out.issue = Issue::Length;
        return out;
    }
    const uint8_t* d = p + l.dataAt;
    uint32_t end = 0;
    if (bin)
        end = static_cast<uint32_t>(d[0] | (d[1] << 8));
    else if (!readHex(d, 4, end))
        return out;
    out.endCode = static_cast<uint16_t>(end);
    if (end != 0) {
        out.issue = Issue::None;
        return out;
    }
    d += bin ? 2 : 4;
    const size_t dataLen = len - (bin ? 2 : 4);
    if (dataLen != expectedData(r, o.code)) {
        out.issue = Issue::Length;
        return out;
    }
    switch (r.cmd) {
        case Cmd::WriteWords:
        case Cmd::WriteBits:
            break;
        case Cmd::ReadBits:
            out.bits.reserve(r.points);
            for (size_t i = 0; i < r.points; ++i) {
                if (bin) {
                    const uint8_t v = d[i / 2];
                    out.bits.push_back(((i % 2 == 0) ? (v >> 4) : (v & 0x0F)) != 0 ? 1 : 0);
                } else {
                    if (d[i] != '0' && d[i] != '1') return out;
                    out.bits.push_back(d[i] == '1' ? 1 : 0);
                }
            }
            break;
        case Cmd::ReadWords:
        case Cmd::RandomRead: {
            const size_t words = r.cmd == Cmd::ReadWords ? r.points : r.randomWords.size();
            const size_t dwords = r.cmd == Cmd::ReadWords ? 0 : r.randomDwords.size();
            out.words.reserve(words + 2 * dwords);
            for (size_t i = 0; i < words; ++i) {
                uint32_t v;
                if (bin)
                    v = static_cast<uint32_t>(d[2 * i] | (d[2 * i + 1] << 8));
                else if (!readHex(d + 4 * i, 4, v))
                    return out;
                out.words.push_back(static_cast<uint16_t>(v));
            }
            const uint8_t* q = d + words * (bin ? 2 : 4);
            for (size_t i = 0; i < dwords; ++i) {
                uint32_t v;
                if (bin)
                    v = static_cast<uint32_t>(q[4 * i]) |
                        (static_cast<uint32_t>(q[4 * i + 1]) << 8) |
                        (static_cast<uint32_t>(q[4 * i + 2]) << 16) |
                        (static_cast<uint32_t>(q[4 * i + 3]) << 24);
                else if (!readHex(q + 8 * i, 8, v))
                    return out;
                out.words.push_back(static_cast<uint16_t>(v & 0xFFFF));
                out.words.push_back(static_cast<uint16_t>(v >> 16));
            }
            break;
        }
    }
    out.issue = Issue::None;
    return out;
}

}  // namespace mat::mc
