#include "drivers/mqtt/packet.hpp"

namespace mat::mqtt {

namespace {

void put16(std::vector<uint8_t>& o, size_t v) {
    o.push_back(static_cast<uint8_t>((v >> 8) & 0xFF));
    o.push_back(static_cast<uint8_t>(v & 0xFF));
}

void putString(std::vector<uint8_t>& o, const std::string& s) {
    put16(o, s.size());
    o.insert(o.end(), s.begin(), s.end());
}

std::vector<uint8_t> frame(uint8_t first, const std::vector<uint8_t>& body) {
    std::vector<uint8_t> out;
    out.reserve(body.size() + 5);
    out.push_back(first);
    appendRemainingLength(out, body.size());
    out.insert(out.end(), body.begin(), body.end());
    return out;
}

// Reads the body of a packet in order; any read past the end makes ok false.
struct Reader {
    const std::vector<uint8_t>& b;
    size_t pos = 0;
    bool ok = true;
    explicit Reader(const std::vector<uint8_t>& body) : b(body) {}
    size_t left() const { return b.size() - pos; }
    uint8_t u8() {
        if (left() < 1) {
            ok = false;
            return 0;
        }
        return b[pos++];
    }
    uint16_t u16() {
        if (left() < 2) {
            ok = false;
            return 0;
        }
        const uint16_t v = static_cast<uint16_t>(b[pos] << 8 | b[pos + 1]);
        pos += 2;
        return v;
    }
    std::string str() {
        const uint16_t n = u16();
        if (!ok || left() < n) {
            ok = false;
            return {};
        }
        std::string s(reinterpret_cast<const char*>(b.data() + pos), n);
        pos += n;
        return s;
    }
};

}  // namespace

bool appendRemainingLength(std::vector<uint8_t>& out, size_t n) {
    if (n > 268435455u) return false;
    do {
        uint8_t byte = static_cast<uint8_t>(n % 128);
        n /= 128;
        if (n > 0) byte |= 0x80;
        out.push_back(byte);
    } while (n > 0);
    return true;
}

std::vector<uint8_t> encodeConnect(const ConnectOptions& o) {
    std::vector<uint8_t> b;
    putString(b, "MQTT");
    b.push_back(4);  // protocol level 3.1.1
    uint8_t flags = 0;
    if (o.cleanSession) flags |= 0x02;
    if (o.hasWill) {
        flags |= 0x04;
        flags |= static_cast<uint8_t>((o.willQos & 3) << 3);
        if (o.willRetain) flags |= 0x20;
    }
    if (o.hasPassword) flags |= 0x40;
    if (o.hasUsername) flags |= 0x80;
    b.push_back(flags);
    put16(b, static_cast<size_t>(o.keepAliveS));
    putString(b, o.clientId);
    if (o.hasWill) {
        putString(b, o.willTopic);
        putString(b, o.willPayload);
    }
    if (o.hasUsername) putString(b, o.username);
    if (o.hasPassword) putString(b, o.password);
    return frame(0x10, b);
}

std::vector<uint8_t> encodePublish(const Publish& p) {
    std::vector<uint8_t> b;
    b.reserve(p.topic.size() + p.payload.size() + 4);
    putString(b, p.topic);
    if (p.qos > 0) put16(b, p.packetId);
    b.insert(b.end(), p.payload.begin(), p.payload.end());
    uint8_t first = static_cast<uint8_t>(0x30 | ((p.qos & 3) << 1));
    if (p.retain) first |= 0x01;
    if (p.dup) first |= 0x08;
    return frame(first, b);
}

std::vector<uint8_t> encodePuback(uint16_t id) {
    return {0x40, 0x02, static_cast<uint8_t>(id >> 8), static_cast<uint8_t>(id & 0xFF)};
}

std::vector<uint8_t> encodeSubscribe(const Subscribe& s) {
    std::vector<uint8_t> b;
    put16(b, s.packetId);
    for (const auto& f : s.filters) {
        putString(b, f.first);
        b.push_back(static_cast<uint8_t>(f.second & 3));
    }
    return frame(0x82, b);
}

std::vector<uint8_t> encodePingreq() { return {0xC0, 0x00}; }
std::vector<uint8_t> encodeDisconnect() { return {0xE0, 0x00}; }
std::vector<uint8_t> encodePingresp() { return {0xD0, 0x00}; }

std::vector<uint8_t> encodeConnack(const Connack& c) {
    return {0x20, 0x02, static_cast<uint8_t>(c.sessionPresent ? 1 : 0),
            static_cast<uint8_t>(c.returnCode)};
}

std::vector<uint8_t> encodeSuback(uint16_t id, const std::vector<uint8_t>& codes) {
    std::vector<uint8_t> b;
    put16(b, id);
    b.insert(b.end(), codes.begin(), codes.end());
    return frame(0x90, b);
}

bool parseConnack(const Packet& p, Connack& out) {
    if (p.type != PacketType::Connack || p.flags != 0 || p.body.size() != 2) return false;
    if (p.body[0] & 0xFE) return false;
    out.sessionPresent = p.body[0] & 1;
    out.returnCode = p.body[1];
    return true;
}

bool parsePublish(const Packet& p, Publish& out) {
    if (p.type != PacketType::Publish) return false;
    out.qos = (p.flags >> 1) & 3;
    if (out.qos == 3) return false;
    out.retain = p.flags & 1;
    out.dup = p.flags & 8;
    Reader r(p.body);
    out.topic = r.str();
    out.packetId = 0;
    if (out.qos > 0) {
        out.packetId = r.u16();
        if (r.ok && out.packetId == 0) return false;
    }
    if (!r.ok || out.topic.empty() || out.topic.find_first_of("+#") != std::string::npos)
        return false;
    out.payload.assign(reinterpret_cast<const char*>(p.body.data() + r.pos), r.left());
    return true;
}

bool parsePacketId(const Packet& p, uint16_t& out) {
    if (p.body.size() != 2) return false;
    out = static_cast<uint16_t>(p.body[0] << 8 | p.body[1]);
    return true;
}

bool parseSuback(const Packet& p, uint16_t& id, std::vector<uint8_t>& codes) {
    if (p.type != PacketType::Suback || p.flags != 0 || p.body.size() < 3) return false;
    id = static_cast<uint16_t>(p.body[0] << 8 | p.body[1]);
    codes.assign(p.body.begin() + 2, p.body.end());
    for (uint8_t c : codes)
        if (c > 2 && c != 0x80) return false;
    return true;
}

bool parseConnect(const Packet& p, ConnectOptions& out) {
    if (p.type != PacketType::Connect) return false;
    Reader r(p.body);
    if (r.str() != "MQTT" || r.u8() != 4) return false;
    const uint8_t flags = r.u8();
    if (flags & 1) return false;  // reserved
    out.cleanSession = flags & 0x02;
    out.hasWill = flags & 0x04;
    out.willQos = (flags >> 3) & 3;
    out.willRetain = flags & 0x20;
    out.hasPassword = flags & 0x40;
    out.hasUsername = flags & 0x80;
    out.keepAliveS = r.u16();
    out.clientId = r.str();
    if (out.hasWill) {
        out.willTopic = r.str();
        out.willPayload = r.str();
    }
    if (out.hasUsername) out.username = r.str();
    if (out.hasPassword) out.password = r.str();
    return r.ok && r.left() == 0;
}

bool parseSubscribe(const Packet& p, Subscribe& out) {
    if (p.type != PacketType::Subscribe || p.flags != 2) return false;
    Reader r(p.body);
    out.packetId = r.u16();
    out.filters.clear();
    while (r.ok && r.left() > 0) {
        std::string f = r.str();
        const int q = r.u8();
        if (!r.ok || f.empty() || q > 2) return false;
        out.filters.emplace_back(std::move(f), q);
    }
    return r.ok && !out.filters.empty();
}

Framer::Result Framer::next(Packet& out) {
    if (buf_.size() < 2) return Result::Need;
    size_t len = 0, mul = 1, i = 1;
    while (true) {
        if (i > 4) return Result::Error;  // more than 4 length bytes
        if (i >= buf_.size()) return Result::Need;
        const uint8_t b = buf_[i++];
        len += (b & 0x7Fu) * mul;
        mul *= 128;
        if (!(b & 0x80)) break;
    }
    const uint8_t type = buf_[0] >> 4;
    if (type == 0 || type == 15 || len > max_) return Result::Error;
    if (buf_.size() < i + len) return Result::Need;
    out.type = static_cast<PacketType>(type);
    out.flags = buf_[0] & 0x0F;
    const auto start = buf_.begin() + static_cast<std::ptrdiff_t>(i);
    const auto end = start + static_cast<std::ptrdiff_t>(len);
    out.body.assign(start, end);
    buf_.erase(buf_.begin(), end);
    return Result::Ready;
}

}  // namespace mat::mqtt
