// Test support for the S7 driver (feature 016): a PLC model with memory per area and scripted
// faults, a fake clock and a fake transport that talks to the PLC in the same process (time moves
// only when a call waits). The PLC parses requests by hand (it does not use drivers/s7/frames).
#pragma once
#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <deque>
#include <functional>
#include <map>
#include <set>
#include <string>
#include <vector>

#include "drivers/sdk/transport.hpp"

namespace mat::testing::s7fake {

using Bytes = std::vector<uint8_t>;

class Clock : public drv::Clock {
   public:
    int64_t monoMs() const override { return mono_.load(); }
    int64_t wallMs() const override { return 1791594000000 + mono_.load(); }
    void set(int64_t t) {
        if (t > mono_.load()) mono_ = t;
    }
    void advance(int64_t d) { mono_ += d; }

   private:
    std::atomic<int64_t> mono_{1000};
};

struct Request {
    int fn = 0;  // 0xF0 setup, 0x04 read, 0x05 write
    int items = 0;
    size_t pduBytes = 0;
};

struct Reply {
    std::vector<Bytes> pieces;
    bool close = false;
};

class Plc {
   public:
    // Memory: "DB1", "M", "I", "Q".
    std::map<std::string, Bytes> mem;
    std::set<std::string> denied;
    int pduMax = 480;
    bool putGetDisabled = false;
    bool rejectCr = false;
    bool refuse = false;
    bool responding = true;  // false: no answer to Read/Write Var
    int silent = 0;          // the next n Read/Write Var get no answer
    int closeNext = 0;       // close the connection on the next n Read/Write Var
    int garbageNext = 0;     // answer the next n Read/Write Var with bytes that are not TPKT
    int staleNext = 0;       // send an answer with another reference before the next n answers
    int fragmentNext = 0;    // send the next n answers as two DT fragments
    int writeError = 0;      // item return code of the next writes (0: none)

    int negotiated = 0;
    int connections = 0;
    int connectAttempts = 0;
    std::vector<Request> requests;
    size_t maxRequestPdu = 0, maxResponsePdu = 0;
    uint64_t bytesIn = 0, bytesOut = 0;

    void set(const std::string& area, int byte, const Bytes& b) {
        Bytes& m = mem[area];
        if (m.size() < static_cast<size_t>(byte) + b.size()) m.resize(byte + b.size(), 0);
        std::copy(b.begin(), b.end(), m.begin() + byte);
    }
    Bytes get(const std::string& area, int byte, int n) const {
        const Bytes& m = mem.at(area);
        return Bytes(m.begin() + byte, m.begin() + byte + n);
    }
    int count(int fn) const {
        return static_cast<int>(std::count_if(requests.begin(), requests.end(),
                                              [fn](const Request& r) { return r.fn == fn; }));
    }

    Reply handle(const Bytes& f) {
        Reply r;
        if (f.size() >= 6 && f[5] == 0xE0) {  // CR
            if (rejectCr)
                r.pieces.push_back(
                    {0x03, 0x00, 0x00, 0x0B, 0x06, 0x80, 0x00, 0x01, 0x00, 0x00, 0x01});
            else
                r.pieces.push_back({0x03, 0x00, 0x00, 0x16, 0x11, 0xD0, 0x00, 0x01,
                                    0x00, 0x01, 0x00, 0xC0, 0x01, 0x0A, 0xC1, 0x02,
                                    0x01, 0x00, 0xC2, 0x02, 0x01, 0x01});
            return r;
        }
        const Bytes p(f.begin() + 7, f.end());
        const unsigned ref = static_cast<unsigned>(p[4] << 8 | p[5]);
        const size_t plen = static_cast<size_t>(p[6] << 8 | p[7]);
        const int fn = p[10];
        Request rq;
        rq.fn = fn;
        rq.pduBytes = p.size();
        rq.items = fn == 0x04 || fn == 0x05 ? p[11] : 0;
        requests.push_back(rq);
        maxRequestPdu = std::max(maxRequestPdu, p.size());
        if (fn == 0xF0) {
            const int asked = p[16] << 8 | p[17];
            negotiated = std::min(asked, pduMax);
            Bytes a = {0x32,
                       0x03,
                       0x00,
                       0x00,
                       static_cast<uint8_t>(ref >> 8),
                       static_cast<uint8_t>(ref),
                       0x00,
                       0x08,
                       0x00,
                       0x00,
                       0x00,
                       0x00,
                       0xF0,
                       0x00,
                       0x00,
                       0x01,
                       0x00,
                       0x01,
                       static_cast<uint8_t>(negotiated >> 8),
                       static_cast<uint8_t>(negotiated)};
            r.pieces.push_back(wrap(a));
            return r;
        }
        if (!responding) return r;
        if (silent > 0) {
            --silent;
            return r;
        }
        if (closeNext > 0) {
            --closeNext;
            r.close = true;
            return r;
        }
        if (garbageNext > 0) {
            --garbageNext;
            r.pieces.push_back({0xFF, 0x00, 0x00, 0x0A, 0x0B, 0xAD});
            return r;
        }
        Bytes answer;
        if (putGetDisabled || (negotiated > 0 && p.size() > static_cast<size_t>(negotiated)))
            answer = headerError(ref, putGetDisabled ? 0x81 : 0x85, putGetDisabled ? 0x04 : 0x00);
        else if (fn == 0x04)
            answer = read(p, ref);
        else if (fn == 0x05)
            answer = write(p, ref, plen);
        else
            answer = headerError(ref, 0x84, 0x01);
        if (negotiated > 0 && answer.size() > static_cast<size_t>(negotiated))
            answer = headerError(ref, 0x85, 0x00);
        maxResponsePdu = std::max(maxResponsePdu, answer.size());
        if (staleNext > 0) {
            --staleNext;
            Bytes stale = answer;
            stale[5] = static_cast<uint8_t>(stale[5] - 1);
            r.pieces.push_back(wrap(stale));
        }
        if (fragmentNext > 0) {
            --fragmentNext;
            const size_t half = answer.size() / 2;
            Bytes a = wrap(Bytes(answer.begin(), answer.begin() + static_cast<long>(half)));
            a[6] = 0x00;  // no EOT
            r.pieces.push_back(a);
            r.pieces.push_back(wrap(Bytes(answer.begin() + static_cast<long>(half), answer.end())));
        } else {
            r.pieces.push_back(wrap(answer));
        }
        return r;
    }

   private:
    static Bytes wrap(const Bytes& pdu) {
        Bytes f = {0x03,
                   0x00,
                   static_cast<uint8_t>((pdu.size() + 7) >> 8),
                   static_cast<uint8_t>(pdu.size() + 7),
                   0x02,
                   0xF0,
                   0x80};
        f.insert(f.end(), pdu.begin(), pdu.end());
        return f;
    }
    static Bytes headerError(unsigned ref, int cls, int code) {
        return {0x32, 0x03, 0x00, 0x00, static_cast<uint8_t>(ref >> 8), static_cast<uint8_t>(ref),
                0x00, 0x00, 0x00, 0x00, static_cast<uint8_t>(cls),      static_cast<uint8_t>(code)};
    }
    static Bytes ack(unsigned ref, int fn, int items, const Bytes& data) {
        Bytes a = {0x32,
                   0x03,
                   0x00,
                   0x00,
                   static_cast<uint8_t>(ref >> 8),
                   static_cast<uint8_t>(ref),
                   0x00,
                   0x02,
                   static_cast<uint8_t>(data.size() >> 8),
                   static_cast<uint8_t>(data.size()),
                   0x00,
                   0x00,
                   static_cast<uint8_t>(fn),
                   static_cast<uint8_t>(items)};
        a.insert(a.end(), data.begin(), data.end());
        return a;
    }
    // The area of an item; rc 0 when it may be used.
    int locate(const uint8_t* it, std::string& key, int& byte, int& bit, int& len) {
        const int ts = it[3];
        len = it[4] << 8 | it[5];
        const int db = it[6] << 8 | it[7];
        const int area = it[8];
        const int addr = it[9] << 16 | it[10] << 8 | it[11];
        byte = addr >> 3;
        bit = addr & 7;
        key = area == 0x84 ? "DB" + std::to_string(db)
                           : area == 0x81 ? "I" : area == 0x82 ? "Q" : area == 0x83 ? "M" : "";
        if (key.empty() || !mem.count(key)) return 0x0A;
        if (denied.count(key)) return 0x03;
        const int n = ts == 0x01 ? 1 : len;
        if (byte + n > static_cast<int>(mem[key].size())) return 0x05;
        return 0;
    }
    Bytes read(const Bytes& p, unsigned ref) {
        const int count = p[11];
        Bytes data;
        for (int i = 0; i < count; ++i) {
            const uint8_t* it = p.data() + 12 + 12 * i;
            std::string key;
            int byte, bit, len;
            const int rc = locate(it, key, byte, bit, len);
            if (rc) {
                data.insert(data.end(), {static_cast<uint8_t>(rc), 0x00, 0x00, 0x00});
                continue;
            }
            Bytes v;
            if (it[3] == 0x01) {
                v.push_back(static_cast<uint8_t>((mem[key][byte] >> bit) & 1));
                data.insert(data.end(), {0xFF, 0x03, 0x00, 0x01});
            } else {
                v = get(key, byte, len);
                data.insert(data.end(), {0xFF, 0x04, static_cast<uint8_t>((len * 8) >> 8),
                                         static_cast<uint8_t>(len * 8)});
            }
            data.insert(data.end(), v.begin(), v.end());
            if ((v.size() & 1) && i + 1 < count) data.push_back(0x00);
        }
        return ack(ref, 0x04, count, data);
    }
    Bytes write(const Bytes& p, unsigned ref, size_t plen) {
        const int count = p[11];
        size_t off = 10 + plen;
        Bytes data;
        for (int i = 0; i < count; ++i) {
            const uint8_t* it = p.data() + 12 + 12 * i;
            const int ts = p[off + 1];
            const int len = p[off + 2] << 8 | p[off + 3];
            const int n = (ts == 0x03 || ts == 0x04) ? (len + 7) / 8 : len;
            const uint8_t* v = p.data() + off + 4;
            off += 4 + n + ((n & 1) && i + 1 < count ? 1 : 0);
            std::string key;
            int byte, bit, ilen;
            int rc = locate(it, key, byte, bit, ilen);
            if (!rc && writeError) rc = writeError;
            if (rc) {
                data.push_back(static_cast<uint8_t>(rc));
                continue;
            }
            if (it[3] == 0x01) {
                uint8_t& b = mem[key][byte];
                b = static_cast<uint8_t>(v[0] ? (b | (1 << bit)) : (b & ~(1 << bit)));
            } else {
                std::copy(v, v + n, mem[key].begin() + byte);
            }
            data.push_back(0xFF);
        }
        return ack(ref, 0x05, count, data);
    }
};

// The transport of the tests: no sockets, no sleeping. A read that has to wait moves the fake
// clock.
class Transport : public drv::Transport {
   public:
    Transport(Plc& plc, Clock& clock) : plc_(plc), clock_(clock) {}

    drv::ConnectCode connect(const std::string&, int, int) override {
        ++plc_.connectAttempts;
        close();
        if (plc_.refuse) {
            clock_.advance(1);
            return drv::ConnectCode::Refused;
        }
        open_ = true;
        ++plc_.connections;
        clock_.advance(1);
        return drv::ConnectCode::Ok;
    }
    bool isOpen() const override { return open_; }
    void close() override {
        open_ = false;
        events_.clear();
        inbound_.clear();
    }
    bool peerClosed() override { return false; }
    size_t discardInput() override {
        const size_t n = inbound_.size();
        inbound_.clear();
        return n;
    }
    bool writeAll(const uint8_t* d, size_t n, int) override {
        if (!open_) return false;
        plc_.bytesIn += n;
        const int64_t now = clock_.monoMs();
        Reply r = plc_.handle(Bytes(d, d + n));
        if (mutate) mutate(r);
        int64_t at = now + latencyMs;
        if (r.close) events_.push_back({at, {}, true});
        for (const Bytes& piece : r.pieces) events_.push_back({at++, piece, false});
        return true;
    }
    drv::ReadResult read(uint8_t* buf, size_t max, int timeoutMs) override {
        if (interrupted_) return {drv::ReadCode::Interrupted, 0};
        const int64_t deadline = clock_.monoMs() + timeoutMs;
        for (;;) {
            if (!inbound_.empty()) {
                const size_t n = std::min(max, inbound_.size());
                std::copy(inbound_.begin(), inbound_.begin() + static_cast<long>(n), buf);
                inbound_.erase(inbound_.begin(), inbound_.begin() + static_cast<long>(n));
                plc_.bytesOut += n;
                return {drv::ReadCode::Data, n};
            }
            if (!open_) return {drv::ReadCode::Closed, 0};
            if (events_.empty() || events_.front().at > deadline) {
                clock_.set(deadline);
                return {drv::ReadCode::Timeout, 0};
            }
            const Event e = events_.front();
            events_.pop_front();
            clock_.set(e.at);
            if (e.close) {
                open_ = false;
                return {drv::ReadCode::Closed, 0};
            }
            inbound_.insert(inbound_.end(), e.bytes.begin(), e.bytes.end());
        }
    }
    void interrupt() override { interrupted_ = true; }
    void clearInterrupt() override { interrupted_ = false; }
    uint64_t bytesSent() const override { return plc_.bytesIn; }
    uint64_t bytesReceived() const override { return plc_.bytesOut; }

    int64_t latencyMs = 5;
    // The fuzz test damages the replies here before they are scheduled.
    std::function<void(Reply&)> mutate;

   private:
    struct Event {
        int64_t at;
        Bytes bytes;
        bool close;
    };
    Plc& plc_;
    Clock& clock_;
    bool open_ = false;
    std::deque<Event> events_;
    std::deque<uint8_t> inbound_;
    std::atomic<bool> interrupted_{false};
};

}  // namespace mat::testing::s7fake
