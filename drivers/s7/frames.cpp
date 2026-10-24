#include "drivers/s7/frames.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>

namespace mat::s7 {

namespace {

void put16(Bytes& b, unsigned v) {
    b.push_back(static_cast<uint8_t>((v >> 8) & 0xFF));
    b.push_back(static_cast<uint8_t>(v & 0xFF));
}

unsigned get16(const uint8_t* p) { return static_cast<unsigned>(p[0] << 8 | p[1]); }

// TPKT + COTP DT around an S7 PDU.
Bytes wrap(const Bytes& pdu) {
    Bytes f = {0x03, 0x00};
    put16(f, static_cast<unsigned>(pdu.size() + 7));
    f.insert(f.end(), {0x02, 0xF0, 0x80});
    f.insert(f.end(), pdu.begin(), pdu.end());
    return f;
}

void putItem(Bytes& b, const Item& it) {
    const bool bit = it.bit >= 0;
    b.insert(b.end(), {0x12, 0x0A, 0x10, static_cast<uint8_t>(bit ? 0x01 : 0x02)});
    put16(b, bit ? 1u : static_cast<unsigned>(it.size));
    put16(b, static_cast<unsigned>(it.area == Area::DB ? it.db : 0));
    b.push_back(static_cast<uint8_t>(areaCode(it.area)));
    const uint32_t addr =
        static_cast<uint32_t>(it.byte) * 8u + (bit ? static_cast<uint32_t>(it.bit) : 0u);
    b.push_back(static_cast<uint8_t>((addr >> 16) & 0xFF));
    b.push_back(static_cast<uint8_t>((addr >> 8) & 0xFF));
    b.push_back(static_cast<uint8_t>(addr & 0xFF));
}

// The common S7 header of an answer. Fills `r`; returns the header length, 0 on a format error or a
// header error (r.error set).
struct Parsed {
    size_t param = 0, paramLen = 0, data = 0, dataLen = 0;
};
bool parseAnswer(const uint8_t* p, size_t n, Reply& r, Parsed& out) {
    r = Reply{};
    if (n < 10 || p[0] != 0x32) {
        r.format = true;
        return false;
    }
    const int rosctr = p[1];
    r.ref = static_cast<uint16_t>(get16(p + 4));
    const size_t plen = get16(p + 6), dlen = get16(p + 8);
    if (rosctr != 2 && rosctr != 3) {
        r.format = true;
        return false;
    }
    if (n < 12 || 12 + plen + dlen != n) {
        r.format = true;
        return false;
    }
    r.error = static_cast<int>(get16(p + 10));
    if (r.error != 0) return false;
    if (rosctr != 3) {
        r.format = true;
        return false;
    }
    out.param = 12;
    out.paramLen = plen;
    out.data = 12 + plen;
    out.dataLen = dlen;
    return true;
}

bool asBool(const TagScalar& v, bool& out) {
    if (const bool* b = std::get_if<bool>(&v))
        out = *b;
    else if (const int64_t* i = std::get_if<int64_t>(&v))
        out = *i != 0;
    else if (const uint64_t* u = std::get_if<uint64_t>(&v))
        out = *u != 0;
    else if (const double* d = std::get_if<double>(&v))
        out = *d != 0;
    else
        return false;
    return true;
}

// An integral value in [lo, hi].
bool asInt(const TagScalar& v, int64_t lo, int64_t hi, int64_t& out) {
    if (const int64_t* i = std::get_if<int64_t>(&v))
        out = *i;
    else if (const uint64_t* u = std::get_if<uint64_t>(&v)) {
        if (*u > static_cast<uint64_t>(std::numeric_limits<int64_t>::max())) return false;
        out = static_cast<int64_t>(*u);
    } else if (const double* d = std::get_if<double>(&v)) {
        if (!std::isfinite(*d) || *d < -9.2e18 || *d > 9.2e18) return false;
        out = static_cast<int64_t>(std::llround(*d));
    } else if (const bool* b = std::get_if<bool>(&v))
        out = *b ? 1 : 0;
    else
        return false;
    return out >= lo && out <= hi;
}

bool asDouble(const TagScalar& v, double& out) {
    if (const double* d = std::get_if<double>(&v))
        out = *d;
    else if (const int64_t* i = std::get_if<int64_t>(&v))
        out = static_cast<double>(*i);
    else if (const uint64_t* u = std::get_if<uint64_t>(&v))
        out = static_cast<double>(*u);
    else
        return false;
    return std::isfinite(out);
}

std::string latin1ToUtf8(const uint8_t* p, size_t n) {
    std::string s;
    for (size_t i = 0; i < n; ++i) {
        const uint8_t c = p[i];
        if (c < 0x80) {
            s.push_back(static_cast<char>(c));
        } else {
            s.push_back(static_cast<char>(0xC0 | (c >> 6)));
            s.push_back(static_cast<char>(0x80 | (c & 0x3F)));
        }
    }
    return s;
}

// UTF-8 to Latin-1; false on a code point above 0xFF or bad UTF-8.
bool utf8ToLatin1(const std::string& s, Bytes& out) {
    out.clear();
    for (size_t i = 0; i < s.size();) {
        const uint8_t c = static_cast<uint8_t>(s[i]);
        if (c < 0x80) {
            out.push_back(c);
            ++i;
        } else if ((c & 0xE0) == 0xC0 && i + 1 < s.size() &&
                   (static_cast<uint8_t>(s[i + 1]) & 0xC0) == 0x80) {
            const unsigned cp = static_cast<unsigned>((c & 0x1F) << 6 | (s[i + 1] & 0x3F));
            if (cp < 0x80 || cp > 0xFF) return false;
            out.push_back(static_cast<uint8_t>(cp));
            i += 2;
        } else {
            return false;
        }
    }
    return true;
}

uint32_t be32(const uint8_t* p) {
    return static_cast<uint32_t>(p[0]) << 24 | static_cast<uint32_t>(p[1]) << 16 |
           static_cast<uint32_t>(p[2]) << 8 | p[3];
}

void putBe(Bytes& b, uint64_t v, int bytes) {
    for (int i = bytes - 1; i >= 0; --i) b.push_back(static_cast<uint8_t>((v >> (8 * i)) & 0xFF));
}

}  // namespace

uint16_t remoteTsapOf(int rack, int slot) {
    return static_cast<uint16_t>(0x0100 | ((rack & 0x07) << 5) | (slot & 0x1F));
}

Bytes encodeConnect(uint16_t localTsap, uint16_t remoteTsap) {
    Bytes f = {0x03, 0x00, 0x00, 0x16, 0x11, 0xE0, 0x00, 0x00,
               0x00, 0x01, 0x00, 0xC0, 0x01, 0x0A, 0xC1, 0x02};
    put16(f, localTsap);
    f.insert(f.end(), {0xC2, 0x02});
    put16(f, remoteTsap);
    return f;
}

bool isConnectConfirm(const uint8_t* frame, size_t n) {
    if (n < 7 || frame[0] != 0x03) return false;
    const size_t li = frame[4];
    if (li < 2 || li + 5 > n) return false;
    return (frame[5] & 0xF0) == 0xD0;
}

Bytes encodeSetup(uint16_t ref, int pduSize) {
    Bytes p = {0x32, 0x01, 0x00, 0x00};
    put16(p, ref);
    p.insert(p.end(), {0x00, 0x08, 0x00, 0x00, 0xF0, 0x00, 0x00, 0x01, 0x00, 0x01});
    put16(p, static_cast<unsigned>(pduSize));
    return wrap(p);
}

Bytes encodeRead(uint16_t ref, const std::vector<Item>& items) {
    Bytes p = {0x32, 0x01, 0x00, 0x00};
    put16(p, ref);
    put16(p, static_cast<unsigned>(2 + 12 * items.size()));
    put16(p, 0);
    p.push_back(0x04);
    p.push_back(static_cast<uint8_t>(items.size()));
    for (const Item& it : items) putItem(p, it);
    return wrap(p);
}

Bytes encodeWrite(uint16_t ref, const Item& item, const Bytes& data) {
    const bool bit = item.bit >= 0;
    Bytes p = {0x32, 0x01, 0x00, 0x00};
    put16(p, ref);
    put16(p, 14);
    put16(p, static_cast<unsigned>(4 + data.size()));
    p.push_back(0x05);
    p.push_back(0x01);
    Item it = item;
    it.size = static_cast<int>(data.size());
    putItem(p, it);
    p.push_back(0x00);
    p.push_back(bit ? 0x03 : 0x04);
    put16(p, bit ? 1u : static_cast<unsigned>(data.size() * 8));
    p.insert(p.end(), data.begin(), data.end());
    return wrap(p);
}

Split splitTpkt(const uint8_t* data, size_t n) {
    Split s;
    if (n >= 1 && data[0] != 0x03) {
        s.status = Split::Status::Bad;
        return s;
    }
    if (n < kTpktHeader) return s;
    const size_t len = get16(data + 2);
    if (len < 7 || len > kMaxFrame) {
        s.status = Split::Status::Bad;
        return s;
    }
    if (n < len) return s;
    s.status = Split::Status::Frame;
    s.size = len;
    return s;
}

DataTpdu dataOf(const uint8_t* frame, size_t n) {
    DataTpdu d;
    if (n < 7 || frame[4] != 0x02 || frame[5] != 0xF0) return d;
    d.ok = true;
    d.eot = (frame[6] & 0x80) != 0;
    d.offset = 7;
    d.size = n - 7;
    return d;
}

SetupReply decodeSetup(const uint8_t* pdu, size_t n) {
    SetupReply r;
    Parsed p;
    if (!parseAnswer(pdu, n, r, p)) return r;
    if (p.paramLen != 8 || pdu[p.param] != 0xF0) {
        r.format = true;
        return r;
    }
    r.pduSize = static_cast<int>(get16(pdu + p.param + 6));
    r.ok = true;
    return r;
}

ReadReply decodeRead(const uint8_t* pdu, size_t n, const std::vector<int>& sizes) {
    ReadReply r;
    Parsed p;
    if (!parseAnswer(pdu, n, r, p)) return r;
    if (p.paramLen != 2 || pdu[p.param] != 0x04 || pdu[p.param + 1] != sizes.size()) {
        r.format = true;
        return r;
    }
    const uint8_t* d = pdu + p.data;
    const size_t end = p.dataLen;
    size_t off = 0;
    for (size_t i = 0; i < sizes.size(); ++i) {
        if (off + 4 > end) {
            r.format = true;
            return r;
        }
        ItemReply it;
        it.rc = d[off];
        const int ts = d[off + 1];
        const size_t len = get16(d + off + 2);
        const size_t bytes = (ts == 0x03 || ts == 0x04 || ts == 0x05) ? (len + 7) / 8 : len;
        off += 4;
        if (off + bytes > end) {
            r.format = true;
            return r;
        }
        if (it.rc == 0xFF) {
            if (bytes != static_cast<size_t>(sizes[i])) {
                r.format = true;
                return r;
            }
            it.data.assign(d + off, d + off + bytes);
        }
        off += bytes;
        if ((bytes & 1) && i + 1 < sizes.size()) ++off;  // fill byte
        r.items.push_back(std::move(it));
    }
    if (off > end) {
        r.format = true;
        r.items.clear();
        return r;
    }
    r.ok = true;
    return r;
}

WriteReply decodeWrite(const uint8_t* pdu, size_t n) {
    WriteReply r;
    Parsed p;
    if (!parseAnswer(pdu, n, r, p)) return r;
    if (p.paramLen != 2 || pdu[p.param] != 0x05 || pdu[p.param + 1] != 1 || p.dataLen < 1) {
        r.format = true;
        return r;
    }
    r.rc = pdu[p.data];
    r.ok = true;
    return r;
}

Decoded decodeValue(S7Type type, int bit, const uint8_t* b, size_t n, int length) {
    Decoded r;
    if (n < static_cast<size_t>(type == S7Type::BOOL ? 1 : typeSize(type, length))) {
        r.reason = "BAD_FRAME";
        return r;
    }
    r.ok = true;
    switch (type) {
        case S7Type::BOOL:
            r.value = ((b[0] >> (bit < 0 ? 0 : bit)) & 1) != 0;
            break;
        case S7Type::BYTE:
            r.value = static_cast<uint64_t>(b[0]);
            break;
        case S7Type::INT:
            r.value = static_cast<int64_t>(static_cast<int16_t>(get16(b)));
            break;
        case S7Type::WORD:
            r.value = static_cast<uint64_t>(get16(b));
            break;
        case S7Type::DINT:
            r.value = static_cast<int64_t>(static_cast<int32_t>(be32(b)));
            break;
        case S7Type::DWORD:
            r.value = static_cast<uint64_t>(be32(b));
            break;
        case S7Type::REAL: {
            const uint32_t u = be32(b);
            float f;
            std::memcpy(&f, &u, sizeof f);
            if (!std::isfinite(f)) {
                r.ok = false;
                r.reason = "INVALID_VALUE";
                break;
            }
            r.value = static_cast<double>(f);
            break;
        }
        case S7Type::LREAL: {
            const uint64_t u = static_cast<uint64_t>(be32(b)) << 32 | be32(b + 4);
            double d;
            std::memcpy(&d, &u, sizeof d);
            if (!std::isfinite(d)) {
                r.ok = false;
                r.reason = "INVALID_VALUE";
                break;
            }
            r.value = d;
            break;
        }
        case S7Type::CHAR: {
            size_t k = static_cast<size_t>(std::max(1, length));
            while (k > 0 && b[k - 1] == 0) --k;
            r.value = latin1ToUtf8(b, k);
            break;
        }
        case S7Type::STRING: {
            size_t cur = b[1];
            cur = std::min<size_t>(cur, b[0]);
            cur = std::min<size_t>(cur, static_cast<size_t>(std::max(1, length)));
            r.value = latin1ToUtf8(b + 2, cur);
            break;
        }
    }
    return r;
}

bool encodeValue(S7Type type, const TagScalar& value, int length, Bytes& out) {
    out.clear();
    int64_t i = 0;
    double d = 0;
    switch (type) {
        case S7Type::BOOL: {
            bool v;
            if (!asBool(value, v)) return false;
            out.push_back(v ? 1 : 0);
            return true;
        }
        case S7Type::BYTE:
            if (!asInt(value, 0, 255, i)) return false;
            putBe(out, static_cast<uint64_t>(i), 1);
            return true;
        case S7Type::INT:
            if (!asInt(value, -32768, 32767, i)) return false;
            putBe(out, static_cast<uint64_t>(i), 2);
            return true;
        case S7Type::WORD:
            if (!asInt(value, 0, 65535, i)) return false;
            putBe(out, static_cast<uint64_t>(i), 2);
            return true;
        case S7Type::DINT:
            if (!asInt(value, INT32_MIN, INT32_MAX, i)) return false;
            putBe(out, static_cast<uint64_t>(i), 4);
            return true;
        case S7Type::DWORD:
            if (!asInt(value, 0, UINT32_MAX, i)) return false;
            putBe(out, static_cast<uint64_t>(i), 4);
            return true;
        case S7Type::REAL: {
            if (!asDouble(value, d)) return false;
            const float f = static_cast<float>(d);
            if (!std::isfinite(f)) return false;
            uint32_t u;
            std::memcpy(&u, &f, sizeof u);
            putBe(out, u, 4);
            return true;
        }
        case S7Type::LREAL: {
            if (!asDouble(value, d)) return false;
            uint64_t u;
            std::memcpy(&u, &d, sizeof u);
            putBe(out, u, 8);
            return true;
        }
        case S7Type::CHAR:
        case S7Type::STRING: {
            const std::string* s = std::get_if<std::string>(&value);
            Bytes chars;
            const size_t n = static_cast<size_t>(std::max(1, length));
            if (!s || !utf8ToLatin1(*s, chars) || chars.size() > n) return false;
            if (type == S7Type::STRING) {
                out.push_back(static_cast<uint8_t>(n));
                out.push_back(static_cast<uint8_t>(chars.size()));
            }
            out.insert(out.end(), chars.begin(), chars.end());
            out.resize(out.size() + (n - chars.size()), 0);
            return true;
        }
    }
    return false;
}

const char* itemReason(int rc) {
    switch (rc) {
        case 0x01:
            return "S7_HARDWARE_FAULT";
        case 0x03:
            return "S7_ACCESS_DENIED";
        case 0x05:
            return "S7_ADDRESS_OUT_OF_RANGE";
        case 0x06:
            return "S7_TYPE_NOT_SUPPORTED";
        case 0x07:
            return "S7_TYPE_INCONSISTENT";
        case 0x0A:
            return "S7_OBJECT_NOT_FOUND";
        default:
            return "S7_ITEM_ERROR";
    }
}

const char* headerReason(int error) {
    return error == 0x8104 ? "S7_FUNCTION_NOT_AVAILABLE" : "S7_REQUEST_ERROR";
}

}  // namespace mat::s7
