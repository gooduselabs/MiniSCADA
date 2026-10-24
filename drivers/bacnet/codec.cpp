#include "drivers/bacnet/codec.hpp"

#include <cstring>

#include "drivers/bacnet/address.hpp"

namespace mat::bacnet {

namespace {

void put16(Bytes& out, uint16_t v) {
    out.push_back(static_cast<uint8_t>(v >> 8));
    out.push_back(static_cast<uint8_t>(v));
}

// Bytes of an unsigned in its shortest big-endian form (at least one).
Bytes unsignedBytes(uint64_t v) {
    Bytes b;
    do {
        b.insert(b.begin(), static_cast<uint8_t>(v & 0xFF));
        v >>= 8;
    } while (v);
    return b;
}

Bytes signedBytes(int64_t v) {
    Bytes b;
    for (;;) {
        b.insert(b.begin(), static_cast<uint8_t>(v & 0xFF));
        const int64_t rest = v >> 8;  // arithmetic shift
        const bool signBit = (b.front() & 0x80) != 0;
        if ((rest == 0 && !signBit) || (rest == -1 && signBit)) break;
        v = rest;
    }
    return b;
}

void encodeTag(Bytes& out, uint8_t number, bool context, uint32_t length) {
    uint8_t first = context ? 0x08 : 0x00;
    const bool extNumber = number > 14;
    first |= static_cast<uint8_t>((extNumber ? 15 : number) << 4);
    if (length <= 4) {
        out.push_back(static_cast<uint8_t>(first | length));
        if (extNumber) out.push_back(number);
        return;
    }
    out.push_back(static_cast<uint8_t>(first | 5));
    if (extNumber) out.push_back(number);
    if (length <= 253) {
        out.push_back(static_cast<uint8_t>(length));
    } else if (length <= 65535) {
        out.push_back(254);
        put16(out, static_cast<uint16_t>(length));
    } else {
        out.push_back(255);
        for (int s = 24; s >= 0; s -= 8) out.push_back(static_cast<uint8_t>(length >> s));
    }
}

void appendTagged(Bytes& out, uint8_t number, bool context, const Bytes& content) {
    encodeTag(out, number, context, static_cast<uint32_t>(content.size()));
    out.insert(out.end(), content.begin(), content.end());
}

Bytes realBytes(float f) {
    uint32_t u = 0;
    std::memcpy(&u, &f, 4);
    return {static_cast<uint8_t>(u >> 24), static_cast<uint8_t>(u >> 16),
            static_cast<uint8_t>(u >> 8), static_cast<uint8_t>(u)};
}

}  // namespace

Value Value::boolean(bool v) {
    Value x;
    x.tag = kTagBoolean;
    x.b = v;
    return x;
}
Value Value::unsignedInt(uint64_t v) {
    Value x;
    x.tag = kTagUnsigned;
    x.u = v;
    return x;
}
Value Value::signedInt(int64_t v) {
    Value x;
    x.tag = kTagSigned;
    x.i = v;
    return x;
}
Value Value::real(float v) {
    Value x;
    x.tag = kTagReal;
    x.d = v;
    return x;
}
Value Value::enumerated(uint64_t v) {
    Value x;
    x.tag = kTagEnumerated;
    x.u = v;
    return x;
}
Value Value::charString(const std::string& v) {
    Value x;
    x.tag = kTagCharString;
    x.s = v;
    return x;
}

void encodeAppValue(Bytes& out, const Value& v) {
    switch (v.tag) {
        case kTagNull:
            out.push_back(0x00);
            return;
        case kTagBoolean:
            out.push_back(v.b ? 0x11 : 0x10);
            return;
        case kTagUnsigned:
        case kTagEnumerated:
            appendTagged(out, v.tag, false, unsignedBytes(v.u));
            return;
        case kTagSigned:
            appendTagged(out, kTagSigned, false, signedBytes(v.i));
            return;
        case kTagReal:
            appendTagged(out, kTagReal, false, realBytes(static_cast<float>(v.d)));
            return;
        case kTagDouble: {
            uint64_t u = 0;
            std::memcpy(&u, &v.d, 8);
            Bytes b;
            for (int s = 56; s >= 0; s -= 8) b.push_back(static_cast<uint8_t>(u >> s));
            appendTagged(out, kTagDouble, false, b);
            return;
        }
        case kTagOctetString:
            appendTagged(out, kTagOctetString, false, Bytes(v.s.begin(), v.s.end()));
            return;
        case kTagCharString: {
            Bytes b{0x00};  // UTF-8
            b.insert(b.end(), v.s.begin(), v.s.end());
            appendTagged(out, kTagCharString, false, b);
            return;
        }
        case kTagBitString: {
            const int bytes = (v.bitCount + 7) / 8;
            Bytes b{static_cast<uint8_t>(bytes * 8 - v.bitCount)};
            for (int i = 0; i < bytes; ++i) {
                uint8_t byte = 0;
                for (int k = 0; k < 8; ++k) {
                    const int bit = i * 8 + k;
                    if (bit < v.bitCount && bit < 32 && ((v.bits >> bit) & 1u))
                        byte |= static_cast<uint8_t>(0x80 >> k);
                }
                b.push_back(byte);
            }
            appendTagged(out, kTagBitString, false, b);
            return;
        }
        case kTagDate:
        case kTagTime:
            appendTagged(out, v.tag, false,
                         {static_cast<uint8_t>(v.raw >> 24), static_cast<uint8_t>(v.raw >> 16),
                          static_cast<uint8_t>(v.raw >> 8), static_cast<uint8_t>(v.raw)});
            return;
        case kTagObjectId: {
            const uint32_t r = v.obj.raw();
            appendTagged(out, kTagObjectId, false,
                         {static_cast<uint8_t>(r >> 24), static_cast<uint8_t>(r >> 16),
                          static_cast<uint8_t>(r >> 8), static_cast<uint8_t>(r)});
            return;
        }
    }
}

void encodeContextUnsigned(Bytes& out, uint8_t tag, uint64_t v) {
    appendTagged(out, tag, true, unsignedBytes(v));
}

void encodeContextObjectId(Bytes& out, uint8_t tag, ObjectId id) {
    const uint32_t r = id.raw();
    appendTagged(out, tag, true,
                 {static_cast<uint8_t>(r >> 24), static_cast<uint8_t>(r >> 16),
                  static_cast<uint8_t>(r >> 8), static_cast<uint8_t>(r)});
}

void encodeOpening(Bytes& out, uint8_t tag) {
    if (tag <= 14) {
        out.push_back(static_cast<uint8_t>((tag << 4) | 0x0E));
    } else {
        out.push_back(0xFE);
        out.push_back(tag);
    }
}

void encodeClosing(Bytes& out, uint8_t tag) {
    if (tag <= 14) {
        out.push_back(static_cast<uint8_t>((tag << 4) | 0x0F));
    } else {
        out.push_back(0xFF);
        out.push_back(tag);
    }
}

// ---------- Reader ----------

bool Reader::peek(TagHeader& h) const {
    Reader copy = *this;
    return copy.next(h);
}

bool Reader::next(TagHeader& h) {
    if (pos_ >= n_) return false;
    const uint8_t first = p_[pos_++];
    h = TagHeader{};
    h.context = (first & 0x08) != 0;
    uint8_t number = first >> 4;
    if (number == 15) {
        if (pos_ >= n_) return false;
        number = p_[pos_++];
    }
    h.number = number;
    const uint8_t lvt = first & 0x07;
    if (h.context && lvt == 6) {
        h.opening = true;
        return true;
    }
    if (h.context && lvt == 7) {
        h.closing = true;
        return true;
    }
    if (!h.context && h.number == kTagBoolean) {  // the value is in the LVT, no content
        if (lvt > 1) return false;
        h.length = lvt;
        return true;
    }
    if (lvt < 5) {
        h.length = lvt;
    } else {
        if (pos_ >= n_) return false;
        const uint8_t l = p_[pos_++];
        if (l < 254) {
            h.length = l;
        } else if (l == 254) {
            if (n_ - pos_ < 2) return false;
            h.length = static_cast<uint32_t>(p_[pos_] << 8 | p_[pos_ + 1]);
            pos_ += 2;
        } else {
            if (n_ - pos_ < 4) return false;
            h.length = static_cast<uint32_t>(p_[pos_]) << 24 |
                       static_cast<uint32_t>(p_[pos_ + 1]) << 16 |
                       static_cast<uint32_t>(p_[pos_ + 2]) << 8 | p_[pos_ + 3];
            pos_ += 4;
        }
    }
    return h.length <= n_ - pos_;
}

bool Reader::take(size_t n, const uint8_t*& data) {
    if (n > n_ - pos_) return false;
    data = p_ + pos_;
    pos_ += n;
    return true;
}

bool Reader::unsignedContent(uint32_t len, uint64_t& v) {
    if (len < 1 || len > 8) return false;
    const uint8_t* d = nullptr;
    if (!take(len, d)) return false;
    v = 0;
    for (uint32_t i = 0; i < len; ++i) v = v << 8 | d[i];
    return true;
}

bool Reader::appValue(Value& v) {
    TagHeader h;
    if (!next(h) || h.context || h.opening || h.closing) return false;
    v = Value{};
    v.tag = static_cast<AppTag>(h.number);
    const uint8_t* d = nullptr;
    switch (h.number) {
        case kTagNull:
            return h.length == 0;
        case kTagBoolean:
            v.b = h.length == 1;
            return true;
        case kTagUnsigned:
        case kTagEnumerated:
            return unsignedContent(h.length, v.u);
        case kTagSigned: {
            if (h.length < 1 || h.length > 8 || !take(h.length, d)) return false;
            int64_t x = (d[0] & 0x80) ? -1 : 0;
            for (uint32_t i = 0; i < h.length; ++i)
                x = static_cast<int64_t>(static_cast<uint64_t>(x) << 8 | d[i]);
            v.i = x;
            return true;
        }
        case kTagReal: {
            if (h.length != 4 || !take(4, d)) return false;
            const uint32_t u = static_cast<uint32_t>(d[0]) << 24 |
                               static_cast<uint32_t>(d[1]) << 16 |
                               static_cast<uint32_t>(d[2]) << 8 | d[3];
            float f = 0;
            std::memcpy(&f, &u, 4);
            v.d = f;
            return true;
        }
        case kTagDouble: {
            if (h.length != 8 || !take(8, d)) return false;
            uint64_t u = 0;
            for (int i = 0; i < 8; ++i) u = u << 8 | d[i];
            std::memcpy(&v.d, &u, 8);
            return true;
        }
        case kTagOctetString:
            if (!take(h.length, d)) return false;
            v.s.assign(reinterpret_cast<const char*>(d), h.length);
            return true;
        case kTagCharString:
            // character set 0 (UTF-8, formerly ANSI X3.4) only; others are kept as bytes
            if (h.length < 1 || !take(h.length, d)) return false;
            v.s.assign(reinterpret_cast<const char*>(d + 1), h.length - 1);
            return true;
        case kTagBitString: {
            if (h.length < 1 || !take(h.length, d)) return false;
            const uint8_t unused = d[0];
            if (unused > 7 || (h.length == 1 && unused != 0)) return false;
            v.bitCount = static_cast<int>((h.length - 1) * 8 - unused);
            for (int bit = 0; bit < v.bitCount && bit < 32; ++bit)
                if (d[1 + bit / 8] & (0x80 >> (bit % 8))) v.bits |= 1u << bit;
            return true;
        }
        case kTagDate:
        case kTagTime:
        case kTagObjectId: {
            if (h.length != 4 || !take(4, d)) return false;
            const uint32_t u = static_cast<uint32_t>(d[0]) << 24 |
                               static_cast<uint32_t>(d[1]) << 16 |
                               static_cast<uint32_t>(d[2]) << 8 | d[3];
            if (h.number == kTagObjectId)
                v.obj = ObjectId::of(u);
            else
                v.raw = u;
            return true;
        }
        default:  // reserved application tags 13-15
            return take(h.length, d);
    }
}

bool Reader::isContext(uint8_t tag) const {
    TagHeader h;
    return peek(h) && h.context && !h.opening && !h.closing && h.number == tag;
}
bool Reader::isOpening(uint8_t tag) const {
    TagHeader h;
    return peek(h) && h.opening && h.number == tag;
}
bool Reader::isClosing(uint8_t tag) const {
    TagHeader h;
    return peek(h) && h.closing && h.number == tag;
}

bool Reader::contextUnsigned(uint8_t tag, uint64_t& v) {
    TagHeader h;
    if (!next(h) || !h.context || h.opening || h.closing || h.number != tag) return false;
    return unsignedContent(h.length, v);
}

bool Reader::contextObjectId(uint8_t tag, ObjectId& id) {
    TagHeader h;
    if (!next(h) || !h.context || h.opening || h.closing || h.number != tag || h.length != 4)
        return false;
    uint64_t u = 0;
    if (!unsignedContent(4, u)) return false;
    id = ObjectId::of(static_cast<uint32_t>(u));
    return true;
}

bool Reader::opening(uint8_t tag) {
    TagHeader h;
    return next(h) && h.opening && h.number == tag;
}
bool Reader::closing(uint8_t tag) {
    TagHeader h;
    return next(h) && h.closing && h.number == tag;
}

bool Reader::skip() {
    int depth = 0;
    do {
        TagHeader h;
        if (!next(h)) return false;
        if (h.opening) {
            if (++depth > kMaxDepth) return false;
        } else if (h.closing) {
            if (--depth < 0) return false;
        } else if (!(!h.context && h.number == kTagBoolean)) {
            const uint8_t* d = nullptr;
            if (!take(h.length, d)) return false;
        }
    } while (depth > 0);
    return true;
}

// ---------- frames ----------

uint8_t maxApduCode(int maxApdu) {
    if (maxApdu >= 1476) return 5;
    if (maxApdu >= 1024) return 4;
    if (maxApdu >= 480) return 3;
    if (maxApdu >= 206) return 2;
    if (maxApdu >= 128) return 1;
    return 0;
}

int maxApduOfCode(uint8_t code) {
    static const int kSizes[] = {50, 128, 206, 480, 1024, 1476};
    return code < 6 ? kSizes[code] : 50;
}

namespace {

void putNpdu(Bytes& out, const Route& dst, bool expectingReply) {
    out.push_back(0x01);
    uint8_t control = expectingReply ? 0x04 : 0x00;
    if (dst.network) control |= 0x20;
    out.push_back(control);
    if (dst.network) {
        put16(out, static_cast<uint16_t>(dst.network));
        out.push_back(static_cast<uint8_t>(dst.mac.size()));
        out.insert(out.end(), dst.mac.begin(), dst.mac.end());
        out.push_back(0xFF);  // hop count
    }
}

Bytes withBvlc(uint8_t function, const Bytes& npdu) {
    Bytes out{0x81, function};
    put16(out, static_cast<uint16_t>(npdu.size() + 4));
    out.insert(out.end(), npdu.begin(), npdu.end());
    return out;
}

}  // namespace

Bytes buildConfirmed(uint8_t invokeId, uint8_t service, const Bytes& serviceData, const Route& dst,
                     int maxApduAccepted) {
    Bytes npdu;
    putNpdu(npdu, dst, true);
    npdu.push_back(0x00);  // confirmed request, not segmented, segmented response not accepted
    npdu.push_back(maxApduCode(maxApduAccepted));
    npdu.push_back(invokeId);
    npdu.push_back(service);
    npdu.insert(npdu.end(), serviceData.begin(), serviceData.end());
    return withBvlc(kBvlcOriginalUnicast, npdu);
}

Bytes buildUnconfirmed(uint8_t service, const Bytes& serviceData, uint8_t bvlc, const Route& dst) {
    Bytes npdu;
    putNpdu(npdu, dst, false);
    npdu.push_back(0x10);
    npdu.push_back(service);
    npdu.insert(npdu.end(), serviceData.begin(), serviceData.end());
    return withBvlc(bvlc, npdu);
}

Bytes buildRegisterForeignDevice(uint16_t ttlS) {
    Bytes out{0x81, kBvlcRegisterForeignDevice, 0x00, 0x06};
    put16(out, ttlS);
    return out;
}

namespace {
bool bad(std::string* why, const char* w) {
    if (why) *why = w;
    return false;
}
}  // namespace

bool parseFrame(const uint8_t* p, size_t n, Frame& f, std::string* why) {
    f = Frame{};
    if (n < 4 || p[0] != 0x81) return bad(why, "not BVLC");
    const size_t len = static_cast<size_t>(p[2] << 8 | p[3]);
    if (len != n) return bad(why, "BVLC length");
    f.bvlc = p[1];
    size_t pos = 4;
    switch (f.bvlc) {
        case kBvlcResult:
            if (n != 6) return bad(why, "BVLC-Result length");
            f.bvlcResult = static_cast<uint16_t>(p[4] << 8 | p[5]);
            return true;
        case kBvlcForwardedNpdu:
            if (n < 10) return bad(why, "Forwarded-NPDU length");
            f.originIp = static_cast<uint32_t>(p[4]) << 24 | static_cast<uint32_t>(p[5]) << 16 |
                         static_cast<uint32_t>(p[6]) << 8 | p[7];
            f.originPort = static_cast<uint16_t>(p[8] << 8 | p[9]);
            pos = 10;
            break;
        case kBvlcOriginalUnicast:
        case kBvlcOriginalBroadcast:
        case kBvlcDistributeBroadcast:
            break;
        default:
            return bad(why, "BVLC function");
    }
    // NPDU
    if (n - pos < 2 || p[pos] != 0x01) return bad(why, "NPDU version");
    const uint8_t control = p[pos + 1];
    pos += 2;
    if (control & 0x20) {  // DNET DLEN DADR
        if (n - pos < 3) return bad(why, "NPDU DNET");
        const size_t dlen = p[pos + 2];
        pos += 3;
        if (n - pos < dlen) return bad(why, "NPDU DADR");
        pos += dlen;
    }
    if (control & 0x08) {  // SNET SLEN SADR
        if (n - pos < 3) return bad(why, "NPDU SNET");
        f.srcNetwork = p[pos] << 8 | p[pos + 1];
        const size_t slen = p[pos + 2];
        pos += 3;
        if (slen == 0 || n - pos < slen) return bad(why, "NPDU SADR");
        f.srcMac.assign(p + pos, p + pos + slen);
        pos += slen;
    }
    if (control & 0x20) {  // hop count
        if (n - pos < 1) return bad(why, "NPDU hop count");
        ++pos;
    }
    if (control & 0x80) return true;  // a network layer message: no APDU
    if (n - pos < 1) return bad(why, "APDU missing");
    const uint8_t* a = p + pos;
    const size_t an = n - pos;
    f.pduType = a[0] >> 4;
    size_t hdr = 0;
    switch (f.pduType) {
        case kConfirmedRequest:
            f.segmented = (a[0] & 0x08) != 0;
            hdr = f.segmented ? 6 : 4;
            if (an < hdr) return bad(why, "APDU header");
            f.maxApduCode = a[1] & 0x0F;
            f.invokeId = a[2];
            f.service = a[hdr - 1];
            break;
        case kUnconfirmedRequest:
            hdr = 2;
            if (an < hdr) return bad(why, "APDU header");
            f.service = a[1];
            break;
        case kSimpleAck:
            hdr = 3;
            if (an < hdr) return bad(why, "APDU header");
            f.invokeId = a[1];
            f.service = a[2];
            break;
        case kComplexAck:
            f.segmented = (a[0] & 0x08) != 0;
            hdr = f.segmented ? 5 : 3;
            if (an < hdr) return bad(why, "APDU header");
            f.invokeId = a[1];
            f.service = a[hdr - 1];
            break;
        case kSegmentAck:
            hdr = 4;
            if (an < hdr) return bad(why, "APDU header");
            f.invokeId = a[1];
            break;
        case kError: {
            hdr = 3;
            if (an < hdr) return bad(why, "APDU header");
            f.invokeId = a[1];
            f.service = a[2];
            Reader r(a + 3, an - 3);
            const bool wrapped = r.isOpening(0);
            if (wrapped) r.opening(0);
            Value cls, code;
            if (!r.appValue(cls) || cls.tag != kTagEnumerated || !r.appValue(code) ||
                code.tag != kTagEnumerated)
                return bad(why, "Error PDU");
            f.errorClass = static_cast<uint32_t>(cls.u);
            f.errorCode = static_cast<uint32_t>(code.u);
            break;
        }
        case kReject:
        case kAbort:
            hdr = 3;
            if (an < hdr) return bad(why, "APDU header");
            f.serverAbort = f.pduType == kAbort && (a[0] & 0x01);
            f.invokeId = a[1];
            f.service = a[2];
            break;
        default:
            return bad(why, "APDU type");
    }
    f.hasApdu = true;
    f.data = a + hdr;
    f.dataLen = an - hdr;
    return true;
}

// ---------- services ----------

Bytes encodeWhoIs(int64_t low, int64_t high) {
    Bytes out;
    if (low >= 0 && high >= 0) {
        encodeContextUnsigned(out, 0, static_cast<uint64_t>(low));
        encodeContextUnsigned(out, 1, static_cast<uint64_t>(high));
    }
    return out;
}

Bytes encodeReadProperty(ObjectId obj, uint32_t property, int64_t arrayIndex) {
    Bytes out;
    encodeContextObjectId(out, 0, obj);
    encodeContextUnsigned(out, 1, property);
    if (arrayIndex >= 0) encodeContextUnsigned(out, 2, static_cast<uint64_t>(arrayIndex));
    return out;
}

Bytes encodeReadPropertyMultiple(const std::vector<ObjectRefs>& objects) {
    Bytes out;
    for (const ObjectRefs& o : objects) {
        encodeContextObjectId(out, 0, o.obj);
        encodeOpening(out, 1);
        for (const PropertyRef& p : o.props) {
            encodeContextUnsigned(out, 0, p.property);
            if (p.arrayIndex >= 0)
                encodeContextUnsigned(out, 1, static_cast<uint64_t>(p.arrayIndex));
        }
        encodeClosing(out, 1);
    }
    return out;
}

Bytes encodeWriteProperty(ObjectId obj, uint32_t property, const Value& value, int priority,
                          int64_t arrayIndex) {
    Bytes out;
    encodeContextObjectId(out, 0, obj);
    encodeContextUnsigned(out, 1, property);
    if (arrayIndex >= 0) encodeContextUnsigned(out, 2, static_cast<uint64_t>(arrayIndex));
    encodeOpening(out, 3);
    encodeAppValue(out, value);
    encodeClosing(out, 3);
    if (priority > 0) encodeContextUnsigned(out, 4, static_cast<uint64_t>(priority));
    return out;
}

bool decodeIAm(const uint8_t* p, size_t n, IAm& out) {
    Reader r(p, n);
    Value id, apdu, seg, vendor;
    if (!r.appValue(id) || id.tag != kTagObjectId || id.obj.type != kDevice) return false;
    if (!r.appValue(apdu) || apdu.tag != kTagUnsigned) return false;
    if (!r.appValue(seg) || seg.tag != kTagEnumerated) return false;
    if (!r.appValue(vendor) || vendor.tag != kTagUnsigned) return false;
    out.instance = id.obj.instance;
    out.maxApdu = static_cast<uint32_t>(apdu.u);
    out.segmentation = static_cast<uint32_t>(seg.u);
    out.vendorId = static_cast<uint32_t>(vendor.u);
    return true;
}

namespace {

// Values up to the closing tag `tag` (application values; constructed ones are skipped).
bool readValues(Reader& r, uint8_t tag, std::vector<Value>& values) {
    while (!r.isClosing(tag)) {
        if (r.atEnd()) return false;
        TagHeader h;
        if (!r.peek(h)) return false;
        if (h.context || h.opening) {
            if (!r.skip()) return false;
            continue;
        }
        Value v;
        if (!r.appValue(v)) return false;
        if (values.size() < 100000) values.push_back(std::move(v));
    }
    return r.closing(tag);
}

}  // namespace

bool decodeReadPropertyAck(const uint8_t* p, size_t n, PropertyResult& out) {
    Reader r(p, n);
    out = PropertyResult{};
    uint64_t prop = 0;
    if (!r.contextObjectId(0, out.obj) || !r.contextUnsigned(1, prop)) return false;
    out.property = static_cast<uint32_t>(prop);
    if (r.isContext(2)) {
        uint64_t idx = 0;
        if (!r.contextUnsigned(2, idx)) return false;
        out.arrayIndex = static_cast<int64_t>(idx);
    }
    if (!r.opening(3) || !readValues(r, 3, out.values)) return false;
    out.ok = true;
    return r.atEnd();
}

bool decodeReadPropertyMultipleAck(const uint8_t* p, size_t n, std::vector<PropertyResult>& out) {
    Reader r(p, n);
    out.clear();
    while (!r.atEnd()) {
        ObjectId obj;
        if (!r.contextObjectId(0, obj) || !r.opening(1)) return false;
        while (!r.isClosing(1)) {
            if (r.atEnd()) return false;
            PropertyResult pr;
            pr.obj = obj;
            uint64_t prop = 0;
            if (!r.contextUnsigned(2, prop)) return false;
            pr.property = static_cast<uint32_t>(prop);
            if (r.isContext(3)) {
                uint64_t idx = 0;
                if (!r.contextUnsigned(3, idx)) return false;
                pr.arrayIndex = static_cast<int64_t>(idx);
            }
            if (r.isOpening(4)) {
                r.opening(4);
                if (!readValues(r, 4, pr.values)) return false;
                pr.ok = true;
            } else if (r.isOpening(5)) {
                r.opening(5);
                Value cls, code;
                if (!r.appValue(cls) || cls.tag != kTagEnumerated || !r.appValue(code) ||
                    code.tag != kTagEnumerated || !r.closing(5))
                    return false;
                pr.errorClass = static_cast<uint32_t>(cls.u);
                pr.errorCode = static_cast<uint32_t>(code.u);
            } else {
                return false;
            }
            if (out.size() >= 4096) return false;
            out.push_back(std::move(pr));
        }
        if (!r.closing(1)) return false;
    }
    return true;
}

size_t rpmObjectRequestBytes() { return 7; }  // object id [0] (5) + opening + closing

size_t rpmRequestBytes(const PropertyRef& ref) {
    size_t n = 1 + unsignedBytes(ref.property).size();
    if (ref.arrayIndex >= 0) n += 1 + unsignedBytes(static_cast<uint64_t>(ref.arrayIndex)).size();
    return n;
}

size_t rpmAnswerBytes(uint32_t property, int stringLength) {
    // property id [2] (<= 4) + [4] opening and closing (2) + the value; an error takes [5] 2 + 4.
    size_t value = 0;
    switch (property) {
        case kPropObjectName:
        case kPropDescription:
            value = 4 + static_cast<size_t>(stringLength > 0 ? stringLength * 4 : 64);
            break;
        case kPropStatusFlags:
            value = 3;
            break;
        case kPropPresentValue:
        case kPropUnits:
        case kPropReliability:
        case kPropEventState:
        case kPropOutOfService:
            value = 9;  // a Double at most
            break;
        default:
            value = 32;
    }
    return 6 + value;
}

const char* errorReason(uint32_t errorCode) {
    switch (errorCode) {
        case kErrUnknownObject:
            return "BACNET_UNKNOWN_OBJECT";
        case kErrUnknownProperty:
            return "BACNET_UNKNOWN_PROPERTY";
        case kErrWriteAccessDenied:
            return "BACNET_WRITE_DENIED";
        case kErrValueOutOfRange:
            return "BACNET_VALUE_RANGE";
        case kErrInvalidDataType:
            return "BACNET_DATA_TYPE";
        default:
            return "BACNET_ERROR";
    }
}

std::string hexOf(const Bytes& b) {
    static const char* d = "0123456789abcdef";
    std::string s;
    for (uint8_t x : b) {
        s.push_back(d[x >> 4]);
        s.push_back(d[x & 15]);
    }
    return s;
}

Bytes fromHex(const std::string& hex) {
    Bytes b;
    int hi = -1;
    for (char c : hex) {
        int v = -1;
        if (c >= '0' && c <= '9') v = c - '0';
        if (c >= 'a' && c <= 'f') v = c - 'a' + 10;
        if (c >= 'A' && c <= 'F') v = c - 'A' + 10;
        if (v < 0) continue;  // spaces
        if (hi < 0) {
            hi = v;
        } else {
            b.push_back(static_cast<uint8_t>(hi << 4 | v));
            hi = -1;
        }
    }
    return b;
}

}  // namespace mat::bacnet
