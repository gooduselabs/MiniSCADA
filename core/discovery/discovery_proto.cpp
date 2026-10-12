// The discovery packets of the device: contracts/discovery.md §2–§5a (see the header).
#include "core/discovery/discovery_proto.hpp"

#include <algorithm>
#include <cstring>

namespace mat::discovery {

namespace {

constexpr uint8_t kMagic[4] = {'M', 'A', 'T', 'D'};
constexpr uint16_t kMinSourcePort = 1024;  // below: system services, never reflected to
constexpr int64_t kMilli = 1000;           // a token, in thousandths

// 0.0.0.0, 255.255.255.255, multicast (224.0.0.0/4), loopback (127.0.0.0/8).
bool isSpecialSource(uint32_t ip) {
    return ip == 0 || ip == 0xFFFFFFFFu || (ip >> 28) == 0xE || (ip >> 24) == 127;
}

// ---- Reply JSON ----

// The UTF-8 sequence at s[i]: its length in bytes and whether it is valid. An invalid one is its
// maximal subpart (the bytes that still could have begun a valid sequence, at least one), which
// becomes one U+FFFD, as nlohmann::json's error_handler_t::replace does.
struct Seq {
    size_t len;
    bool valid;
};

Seq sequenceAt(const std::string& s, size_t i) {
    const auto byte = [&](size_t k) { return static_cast<unsigned char>(s[i + k]); };
    const unsigned c = byte(0);
    if (c < 0x80) return {1, true};
    size_t len = 0;
    unsigned lo = 0x80, hi = 0xBF;  // range of the second byte
    if (c >= 0xC2 && c <= 0xDF) {
        len = 2;
    } else if (c >= 0xE0 && c <= 0xEF) {
        len = 3;
        if (c == 0xE0) lo = 0xA0;  // no overlong form
        if (c == 0xED) hi = 0x9F;  // no surrogate
    } else if (c >= 0xF0 && c <= 0xF4) {
        len = 4;
        if (c == 0xF0) lo = 0x90;  // no overlong form
        if (c == 0xF4) hi = 0x8F;  // nothing above U+10FFFF
    } else {
        return {1, false};
    }
    for (size_t k = 1; k < len; ++k) {
        if (i + k >= s.size()) return {k, false};
        const unsigned x = byte(k);
        if (k == 1 ? (x < lo || x > hi) : (x < 0x80 || x > 0xBF)) return {k, false};
    }
    return {len, true};
}

const char kReplacement[] = "\xEF\xBF\xBD";  // U+FFFD

// Bytes of the value (not escaped) and of the JSON text a sequence turns into.
size_t valueBytes(Seq seq) { return seq.valid ? seq.len : 3; }

size_t jsonBytes(const std::string& s, size_t i, Seq seq) {
    if (!seq.valid) return 3;
    if (seq.len > 1) return seq.len;
    switch (s[i]) {
        case '"':
        case '\\':
        case '\b':
        case '\f':
        case '\n':
        case '\r':
        case '\t':
            return 2;
        default:
            return static_cast<unsigned char>(s[i]) < 0x20 ? 6 : 1;
    }
}

// The longest prefix of `s`, in bytes of `s` and on a sequence boundary, whose value takes at most
// `maxBytes` bytes (U+FFFD counted as 3).
size_t prefixByBytes(const std::string& s, size_t maxBytes) {
    size_t i = 0, bytes = 0;
    while (i < s.size()) {
        const Seq seq = sequenceAt(s, i);
        if (bytes + valueBytes(seq) > maxBytes) break;
        bytes += valueBytes(seq);
        i += seq.len;
    }
    return i;
}

// The first `maxChars` characters of `s`, in bytes of `s`.
size_t prefixByChars(const std::string& s, size_t maxChars) {
    size_t i = 0;
    for (size_t n = 0; i < s.size() && n < maxChars; ++n) i += sequenceAt(s, i).len;
    return i;
}

// Writes into a fixed buffer and counts what does not fit, so one pass both writes and measures.
class Writer {
   public:
    Writer(uint8_t* buf, size_t cap) : buf_(buf), cap_(cap) {}
    void put(char c) {
        if (n_ < cap_) buf_[n_] = static_cast<uint8_t>(c);
        ++n_;
    }
    void put(const char* s) {
        while (*s) put(*s++);
    }
    void put(const char* s, size_t len) {
        for (size_t i = 0; i < len; ++i) put(s[i]);
    }
    void number(int64_t v) {
        char digits[20];
        size_t len = 0;
        uint64_t u = v < 0 ? 0 - static_cast<uint64_t>(v) : static_cast<uint64_t>(v);
        do {
            digits[len++] = static_cast<char>('0' + u % 10);
            u /= 10;
        } while (u != 0);
        if (v < 0) put('-');
        while (len > 0) put(digits[--len]);
    }
    size_t size() const { return n_; }

   private:
    uint8_t* buf_;
    size_t cap_;
    size_t n_ = 0;
};

// s[0, end) as a JSON string, escaped as nlohmann::json::dump() escapes (ensure_ascii off).
void putString(Writer& w, const std::string& s, size_t end) {
    static const char kHex[] = "0123456789abcdef";
    w.put('"');
    for (size_t i = 0; i < end;) {
        const Seq seq = sequenceAt(s, i);
        if (!seq.valid) {
            w.put(kReplacement);
        } else if (seq.len > 1) {
            w.put(s.data() + i, seq.len);
        } else {
            const char c = s[i];
            switch (c) {
                case '"':
                    w.put("\\\"");
                    break;
                case '\\':
                    w.put("\\\\");
                    break;
                case '\b':
                    w.put("\\b");
                    break;
                case '\f':
                    w.put("\\f");
                    break;
                case '\n':
                    w.put("\\n");
                    break;
                case '\r':
                    w.put("\\r");
                    break;
                case '\t':
                    w.put("\\t");
                    break;
                default:
                    if (static_cast<unsigned char>(c) < 0x20) {
                        w.put("\\u00");
                        w.put(kHex[c >> 4]);
                        w.put(kHex[c & 0xF]);
                    } else {
                        w.put(c);
                    }
            }
        }
        i += seq.len;
    }
    w.put('"');
}

void putIp(Writer& w, uint32_t ip) {
    w.put('"');
    for (int k = 3; k >= 0; --k) {
        w.number((ip >> (8 * k)) & 0xFF);
        if (k > 0) w.put('.');
    }
    w.put('"');
}

void putMac(Writer& w, const std::optional<Mac>& mac) {
    static const char kHex[] = "0123456789ABCDEF";
    if (!mac) {
        w.put("null");
        return;
    }
    w.put('"');
    for (size_t k = 0; k < mac->size(); ++k) {
        if (k > 0) w.put(':');
        w.put(kHex[(*mac)[k] >> 4]);
        w.put(kHex[(*mac)[k] & 0xF]);
    }
    w.put('"');
}

bool isFingerprint(const std::optional<std::string>& fp) {
    return fp && fp->size() == 64 && std::all_of(fp->begin(), fp->end(), [](char c) {
               return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
           });
}

// What goes out of the device info: how much of each cut string, and which parts.
struct Shape {
    size_t nameEnd = 0;  // bytes of info.name
    size_t modelEnd = 0;
    size_t projectNameEnd = 0;
    bool projectName = false;  // project.name is written
    bool project = true;       // the "project" key is written
    bool https = false;        // "https" and "fp" carry the port and the fingerprint
};

// The JSON of contract §3, keys in its order; returns its size (written as far as it fits).
size_t writeJson(Writer& w, const DeviceInfo& i, const LocalAddress& l, const Shape& s) {
    w.put("{\"v\":1,\"id\":");
    putString(w, i.deviceId, i.deviceId.size());
    w.put(",\"name\":");
    putString(w, i.name, s.nameEnd);
    w.put(",\"model\":");
    putString(w, i.model, s.modelEnd);
    w.put(",\"mac\":");
    putMac(w, l.mac);
    w.put(",\"ip\":");
    putIp(w, l.net.addr);
    w.put(",\"prefix\":");
    w.number(l.net.prefix());
    w.put(",\"runtime\":");
    putString(w, i.runtime, i.runtime.size());
    w.put(",\"api\":");
    putString(w, i.api, i.api.size());
    w.put(",\"status\":\"");
    w.put(statusName(i.status));
    w.put('"');
    if (s.project) {
        w.put(",\"project\":");
        if (!i.project) {
            w.put("null");
        } else {
            const ProjectInfo& p = *i.project;
            w.put("{\"id\":");
            putString(w, p.id, p.id.size());
            if (s.projectName) {
                w.put(",\"name\":");
                putString(w, p.name, s.projectNameEnd);
            }
            w.put(",\"version\":");
            putString(w, p.version, p.version.size());
            w.put(",\"digest\":");
            if (p.digest)
                putString(w, *p.digest, p.digest->size());
            else
                w.put("null");
            w.put('}');
        }
    }
    w.put(",\"https\":");
    w.number(s.https ? i.httpsPort : 0);
    w.put(",\"http\":");
    w.number(i.httpPort);
    w.put(",\"fp\":");
    if (s.https)
        putString(w, *i.fingerprint, i.fingerprint->size());
    else
        w.put("null");
    w.put('}');
    return w.size();
}

}  // namespace

// ---- Query ----

bool parseQuery(const uint8_t* data, size_t size, Nonce& nonce) {
    if (data == nullptr || size != kQuerySize) return false;
    if (std::memcmp(data, kMagic, sizeof kMagic) != 0) return false;
    if (data[4] != kVersion || data[5] != kTypeQuery || data[6] != 0 || data[7] != 0) return false;
    if (std::any_of(data + kHeaderSize, data + kQuerySize, [](uint8_t b) { return b != 0; }))
        return false;
    std::memcpy(nonce.data(), data + 8, nonce.size());
    return true;
}

std::optional<Ipv4Net> replyAddress(uint32_t source, const Iface& iface) {
    if (isSpecialSource(source)) return std::nullopt;
    std::optional<Ipv4Net> best;
    for (const Ipv4Net& a : iface.addrs) {
        const std::optional<uint32_t> broadcast = a.broadcast();
        if (broadcast && *broadcast == source) return std::nullopt;
        if (a.contains(source) && (!best || a.prefix() > best->prefix())) best = a;
    }
    return best;
}

// ---- Rate ----

void RateLimiter::refill(Bucket& b, int64_t nowMs, int64_t burst, int64_t perSecond) {
    if (nowMs <= b.atMs) return;  // a clock going back gives nothing
    const int64_t full = burst * kMilli;
    b.milli = std::min(full, b.milli + std::min(nowMs - b.atMs, full) * perSecond);
    b.atMs = nowMs;
}

bool RateLimiter::allow(uint32_t source, int64_t nowMs) {
    Source* entry = nullptr;
    for (size_t i = 0; i < used_ && !entry; ++i)
        if (sources_[i].ip == source) entry = &sources_[i];
    if (!entry) {
        // A new source: a free entry, else the one seen least recently. Either starts full.
        entry = used_ < kSources ? &sources_[used_++]
                                 : &*std::min_element(sources_.begin(), sources_.end(),
                                                      [](const Source& a, const Source& b) {
                                                          return a.seenMs < b.seenMs;
                                                      });
        entry->ip = source;
        entry->bucket = {kSourceBurst * kMilli, nowMs};
    }
    entry->seenMs = nowMs;
    if (!totalStarted_) {
        total_ = {kTotalBurst * kMilli, nowMs};
        totalStarted_ = true;
    }
    refill(entry->bucket, nowMs, kSourceBurst, kSourcePerSecond);
    refill(total_, nowMs, kTotalBurst, kTotalPerSecond);
    if (entry->bucket.milli < kMilli || total_.milli < kMilli) return false;
    entry->bucket.milli -= kMilli;
    total_.milli -= kMilli;
    return true;
}

// ---- Responder ----

Decision Responder::check(const Datagram& d, int64_t nowMs) {
    Decision out;
    if (d.cut || !parseQuery(d.data, d.size, out.nonce)) {
        out.drop = Drop::Format;
    } else if (const auto local = d.iface ? replyAddress(d.source, *d.iface) : std::nullopt;
               !local) {
        out.drop = Drop::Subnet;
    } else if (d.sourcePort < kMinSourcePort) {
        out.drop = Drop::Port;
    } else if (!limiter_.allow(d.source, nowMs)) {
        out.drop = Drop::Rate;
    } else {
        out.drop = Drop::None;
        out.local = *local;
    }
    count(out.drop);
    return out;
}

void Responder::count(Drop drop) {
    switch (drop) {
        case Drop::None:
            break;
        case Drop::Format:
            format_.fetch_add(1, std::memory_order_relaxed);
            break;
        case Drop::Subnet:
            subnet_.fetch_add(1, std::memory_order_relaxed);
            break;
        case Drop::Port:
            port_.fetch_add(1, std::memory_order_relaxed);
            break;
        case Drop::Rate:
            rate_.fetch_add(1, std::memory_order_relaxed);
            break;
    }
}

void Responder::countReply() { replies_.fetch_add(1, std::memory_order_relaxed); }

Counters Responder::counters() const {
    Counters c;
    c.replies = replies_.load(std::memory_order_relaxed);
    c.subnet = subnet_.load(std::memory_order_relaxed);
    c.format = format_.load(std::memory_order_relaxed);
    c.rate = rate_.load(std::memory_order_relaxed);
    c.port = port_.load(std::memory_order_relaxed);
    return c;
}

// ---- Reply ----

const char* statusName(DeviceStatus status) {
    switch (status) {
        case DeviceStatus::Running:
            return "running";
        case DeviceStatus::NoProject:
            return "no-project";
        case DeviceStatus::ProjectError:
            return "project-error";
        case DeviceStatus::Activating:
            return "activating";
    }
    return "no-project";
}

size_t buildReply(const Nonce& nonce, const DeviceInfo& info, const LocalAddress& local,
                  Packet& out) {
    uint16_t flags = 0;
    Shape s;
    const size_t nameMax = prefixByBytes(info.name, kMaxNameBytes);
    s.nameEnd = nameMax;
    s.modelEnd = prefixByBytes(info.model, kMaxNameBytes);
    if (s.nameEnd < info.name.size() || s.modelEnd < info.model.size()) flags |= kFlagTruncated;
    if (info.project) {
        s.projectName = true;
        s.projectNameEnd = prefixByChars(info.project->name, kMaxProjectNameChars);
        if (s.projectNameEnd < info.project->name.size()) flags |= kFlagTruncated;
    }
    s.https = isFingerprint(info.fingerprint) && info.httpsPort >= 1 && info.httpsPort <= 65535;

    // Every measure writes too; the last one is the reply.
    uint8_t* const json = out.data() + kHeaderSize;
    const auto measure = [&](const Shape& shape) {
        Writer w(json, kMaxJson);
        return writeJson(w, info, local, shape);
    };
    // Step (2) of §5a: the longest prefix of name that fits; false when no name fits either.
    const auto cutName = [&](Shape& shape) {
        shape.nameEnd = 0;
        const size_t base = measure(shape);
        if (base > kMaxJson) return false;
        size_t room = kMaxJson - base, end = 0;
        while (end < nameMax) {
            const Seq seq = sequenceAt(info.name, end);
            const size_t bytes = jsonBytes(info.name, end, seq);
            if (bytes > room) break;
            room -= bytes;
            end += seq.len;
        }
        shape.nameEnd = end;
        return true;
    };

    size_t size = measure(s);
    if (size > kMaxJson && s.projectName) {  // (1) project.name goes
        s.projectName = false;
        flags |= kFlagTruncated;
        size = measure(s);
    }
    if (size > kMaxJson) {
        flags |= kFlagTruncated;
        if (!cutName(s)) {  // (3) the project block goes; name gets the room back
            s.project = false;
            if (!cutName(s)) return 0;
        }
        size = measure(s);
    }
    if (size > kMaxJson) return 0;

    std::memcpy(out.data(), kMagic, sizeof kMagic);
    out[4] = kVersion;
    out[5] = kTypeReply;
    out[6] = static_cast<uint8_t>(flags >> 8);
    out[7] = static_cast<uint8_t>(flags & 0xFF);
    std::memcpy(out.data() + 8, nonce.data(), nonce.size());
    return kHeaderSize + size;
}

}  // namespace mat::discovery
