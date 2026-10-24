// Test support for the FINS driver (feature 018): a PLC model with memory and scripted faults, a
// fake clock and a fake transport that talks to it in the same process (time moves only when a
// call waits). UDP (one datagram per frame) or TCP (the FINS/TCP header and the node handshake).
// The PLC parses commands by hand, apart from drivers/fins/frame.cpp.
#pragma once
#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <deque>
#include <map>
#include <mutex>
#include <string>
#include <vector>

#include "drivers/sdk/transport.hpp"

namespace mat::testing {

using Bytes = std::vector<uint8_t>;

class FinsClock : public drv::Clock {
   public:
    int64_t monoMs() const override { return mono_.load(); }
    int64_t wallMs() const override { return kWallBase + mono_.load(); }
    void set(int64_t t) {
        if (t > mono_.load()) mono_ = t;
    }
    static constexpr int64_t kWallBase = 1791594000000;

   private:
    std::atomic<int64_t> mono_{1000};
};

struct FinsRequest {
    uint16_t command = 0;
    uint8_t sid = 0;
    uint8_t dna = 0, da1 = 0, da2 = 0, sna = 0, sa1 = 0, sa2 = 0;
    uint8_t code = 0;  // 0101 / 0102: the area code
    int address = 0, bit = 0, count = 0;
    std::vector<std::array<int, 3>> items;  // 0104: code, address, bit
    Bytes data;                             // 0102
    int64_t atMs = 0;
};

struct FinsFault {
    enum Kind { Silent, EndCode, Late, BadSid, BadNode, Garbage, Close, TcpError };
    Kind kind = Silent;
    uint16_t endCode = 0x1103;
    int64_t delayMs = 0;     // Late: the reply comes this long after the command
    int command = -1;        // only this command (-1: any)
    int from = -1, to = -1;  // only commands that touch these addresses (0101 / 0102)
    int count = 1;
    int skip = 0;
};

class FakeFinsPlc {
   public:
    uint8_t node = 10;       // our node (SA1 of the replies when the command named another one)
    uint8_t clientNode = 5;  // TCP: the node the handshake gives a client that asks for 0
    uint32_t tcpError = 0;   // TCP: the handshake answers with this error code
    bool responding = true;
    std::map<uint8_t, int> limit;  // code -> first address that answers 1103 (a word code)
    uint16_t plcStatus = 0;        // SRES bits 6-7 of every reply

    static uint8_t wordCodeOf(uint8_t c) {
        if (c >= 0x30 && c <= 0x33) return static_cast<uint8_t>(c + 0x80);
        if (c == 0x02) return 0x82;
        if (c >= 0x20 && c <= 0x2C) return static_cast<uint8_t>(c + 0x80);
        return c;
    }
    static bool isWord(uint8_t c) {
        return (c >= 0xB0 && c <= 0xB3) || c == 0x82 || (c >= 0xA0 && c <= 0xAC) || c == 0x89;
    }
    void setWord(uint8_t code, int addr, uint16_t v) {
        std::lock_guard<std::mutex> g(mu);
        words[{code, addr}] = v;
    }
    void setWords(uint8_t code, int addr, const std::vector<uint16_t>& v) {
        for (size_t i = 0; i < v.size(); ++i) setWord(code, addr + static_cast<int>(i), v[i]);
    }
    uint16_t word(uint8_t code, int addr) {
        std::lock_guard<std::mutex> g(mu);
        auto it = words.find({code, addr});
        return it == words.end() ? 0 : it->second;
    }
    void setFlag(int addr, bool v) {
        std::lock_guard<std::mutex> g(mu);
        flags[addr] = v;
    }
    void addFault(FinsFault f) {
        std::lock_guard<std::mutex> g(mu);
        faults.push_back(f);
    }
    std::vector<FinsRequest> requests() {
        std::lock_guard<std::mutex> g(mu);
        return log;
    }
    size_t countOf(uint16_t command) {
        std::lock_guard<std::mutex> g(mu);
        return static_cast<size_t>(std::count_if(
            log.begin(), log.end(), [&](const FinsRequest& r) { return r.command == command; }));
    }

    // The reply frames to one command frame (none: silent), each with its delay.
    struct Reply {
        Bytes frame;
        int64_t delayMs = 1;
        bool close = false;
    };
    std::vector<Reply> handle(const Bytes& f, int64_t nowMs) {
        std::lock_guard<std::mutex> g(mu);
        std::vector<Reply> out;
        if (f.size() < 12) return out;
        FinsRequest r;
        r.dna = f[3];
        r.da1 = f[4];
        r.da2 = f[5];
        r.sna = f[6];
        r.sa1 = f[7];
        r.sa2 = f[8];
        r.sid = f[9];
        r.command = static_cast<uint16_t>((f[10] << 8) | f[11]);
        r.atMs = nowMs;
        size_t p = 12;
        if (r.command == 0x0101 || r.command == 0x0102) {
            if (f.size() < 18) return out;
            r.code = f[12];
            r.address = (f[13] << 8) | f[14];
            r.bit = f[15];
            r.count = (f[16] << 8) | f[17];
            r.data.assign(f.begin() + 18, f.end());
        } else if (r.command == 0x0104) {
            for (; p + 4 <= f.size(); p += 4)
                r.items.push_back({f[p], (f[p + 1] << 8) | f[p + 2], f[p + 3]});
        }
        log.push_back(r);
        if (!responding) return out;

        // the fault that applies
        uint16_t endCode = 0;
        FinsFault::Kind kind = FinsFault::Silent;
        bool faulted = false;
        int64_t delay = 1;
        for (auto it = faults.begin(); it != faults.end(); ++it) {
            if (it->command >= 0 && it->command != r.command) continue;
            if (it->from >= 0 &&
                (r.command == 0x0104 || r.address + std::max(1, r.count) <= it->from ||
                 r.address > it->to))
                continue;
            if (it->skip > 0) {
                --it->skip;
                continue;
            }
            kind = it->kind;
            endCode = it->endCode;
            delay = std::max<int64_t>(1, it->delayMs);
            faulted = true;
            if (--it->count <= 0) faults.erase(it);
            break;
        }
        if (faulted && kind == FinsFault::Silent) return out;
        if (faulted && kind == FinsFault::Close) {
            out.push_back({{}, 1, true});
            return out;
        }
        if (faulted && kind == FinsFault::Garbage) {
            out.push_back({Bytes{0xDE, 0xAD}, 1, false});
            return out;
        }

        Bytes data;
        if (!faulted || kind != FinsFault::EndCode) endCode = execute(r, data);
        Bytes rep = {0xC0,
                     0x00,
                     0x02,
                     r.sna,
                     r.sa1,
                     r.sa2,
                     r.dna,
                     r.da1,
                     r.da2,
                     r.sid,
                     static_cast<uint8_t>(r.command >> 8),
                     static_cast<uint8_t>(r.command & 0xFF),
                     static_cast<uint8_t>(endCode >> 8),
                     static_cast<uint8_t>((endCode & 0xFF) | (plcStatus & 0xC0))};
        if (endCode == 0) rep.insert(rep.end(), data.begin(), data.end());
        if (faulted && kind == FinsFault::BadSid) rep[9] = static_cast<uint8_t>(r.sid + 1);
        if (faulted && kind == FinsFault::BadNode) rep[7] = static_cast<uint8_t>(r.da1 + 1);
        out.push_back({rep, faulted && kind == FinsFault::Late ? delay : 1, false});
        if (faulted && (kind == FinsFault::BadSid || kind == FinsFault::BadNode)) {
            // the right answer follows the wrong one
            Bytes good = rep;
            good[9] = r.sid;
            good[7] = r.da1;
            out.push_back({good, 2, false});
        }
        return out;
    }

    std::mutex mu;
    std::map<std::pair<uint8_t, int>, uint16_t> words;
    std::map<int, bool> flags;
    std::deque<FinsFault> faults;
    std::vector<FinsRequest> log;
    int connectAttempts = 0;
    uint64_t bytesIn = 0, bytesOut = 0;

   private:
    bool outside(uint8_t code, int addr) const {
        auto it = limit.find(wordCodeOf(code));
        return it != limit.end() && addr >= it->second;
    }
    uint16_t readOne(uint8_t code, int addr, int bit) {
        if (code == 0x09) {
            auto it = flags.find(addr);
            return it != flags.end() && it->second ? 1 : 0;
        }
        const uint8_t wc = wordCodeOf(code);
        auto it = words.find({wc, addr});
        const uint16_t w = it == words.end() ? 0 : it->second;
        if (isWord(code)) return w;
        return static_cast<uint16_t>((w >> bit) & 1);
    }
    uint16_t execute(const FinsRequest& r, Bytes& data) {
        if (r.command == 0x0501) {
            const char model[] = "CJ2M-CPU31          ";
            data.assign(model, model + 20);
            data.resize(20 + 20, ' ');
            return 0;
        }
        if (r.command == 0x0104) {
            for (const auto& it : r.items) {
                const uint8_t c = static_cast<uint8_t>(it[0]);
                if (outside(c, it[1])) return 0x1103;
                data.push_back(c);
                const uint16_t v = readOne(c, it[1], it[2]);
                if (isWord(c)) data.push_back(static_cast<uint8_t>(v >> 8));
                data.push_back(static_cast<uint8_t>(v & 0xFF));
            }
            return 0;
        }
        if (r.command != 0x0101 && r.command != 0x0102) return 0x0401;
        const bool word = isWord(r.code);
        for (int k = 0; k < r.count; ++k)
            if (outside(r.code, word ? r.address + k : r.address)) return 0x1103;
        if (r.command == 0x0101) {
            for (int k = 0; k < r.count; ++k) {
                // bits run on through the word, then into the next one
                const int bitIndex = r.bit + k;
                const uint16_t v = word ? readOne(r.code, r.address + k, 0)
                                        : readOne(r.code, r.address + bitIndex / 16, bitIndex % 16);
                if (word) data.push_back(static_cast<uint8_t>(v >> 8));
                data.push_back(static_cast<uint8_t>(v & 0xFF));
                if (r.code == 0x09) data.back() = readOne(0x09, r.address + k, 0) ? 1 : 0;
            }
            return 0;
        }
        // 0102
        if (r.code == 0x09) return 0x2101;
        if (static_cast<int>(r.data.size()) != r.count * (word ? 2 : 1)) return 0x1003;
        const uint8_t wc = wordCodeOf(r.code);
        for (int k = 0; k < r.count; ++k) {
            if (word) {
                words[{wc, r.address + k}] =
                    static_cast<uint16_t>((r.data[2 * k] << 8) | r.data[2 * k + 1]);
            } else {
                const int bitIndex = r.bit + k;
                uint16_t& w = words[{wc, r.address + bitIndex / 16}];
                const uint16_t m = static_cast<uint16_t>(1U << (bitIndex % 16));
                w = r.data[k] ? static_cast<uint16_t>(w | m) : static_cast<uint16_t>(w & ~m);
            }
        }
        return 0;
    }
};

// The link to the fake PLC. `tcp`: FINS/TCP stream with the handshake; else one datagram per
// frame. Time moves only when read() waits.
class FakeFinsTransport : public drv::Transport {
   public:
    FakeFinsTransport(FakeFinsPlc& plc, FinsClock& clock, bool tcp)
        : plc_(plc), clock_(clock), tcp_(tcp) {}
    drv::ConnectCode connect(const std::string&, int, int) override {
        std::lock_guard<std::mutex> g(plc_.mu);
        ++plc_.connectAttempts;
        if (!plc_.responding && tcp_) return drv::ConnectCode::Refused;
        open_ = true;
        pending_.clear();
        inbuf_.clear();
        return drv::ConnectCode::Ok;
    }
    bool isOpen() const override { return open_; }
    void close() override {
        open_ = false;
        pending_.clear();
        inbuf_.clear();
    }
    bool peerClosed() override { return !open_; }
    size_t discardInput() override { return 0; }
    bool writeAll(const uint8_t* data, size_t n, int) override {
        if (!open_) return false;
        plc_.bytesIn += n;
        if (!tcp_) {
            deliver(Bytes(data, data + n));
            return true;
        }
        inbuf_.insert(inbuf_.end(), data, data + n);
        while (inbuf_.size() >= 16) {
            const uint32_t len = (static_cast<uint32_t>(inbuf_[4]) << 24) | (inbuf_[5] << 16) |
                                 (inbuf_[6] << 8) | inbuf_[7];
            if (inbuf_.size() < 8 + len) break;
            const uint32_t cmd = (static_cast<uint32_t>(inbuf_[8]) << 24) | (inbuf_[9] << 16) |
                                 (inbuf_[10] << 8) | inbuf_[11];
            const Bytes msg(inbuf_.begin(), inbuf_.begin() + 8 + len);
            inbuf_.erase(inbuf_.begin(), inbuf_.begin() + 8 + len);
            if (cmd == 0) {  // node address data send
                const uint32_t asked = (static_cast<uint32_t>(msg[16]) << 24) | (msg[17] << 16) |
                                       (msg[18] << 8) | msg[19];
                Bytes rep = {'F', 'I', 'N', 'S', 0, 0, 0, 0x10, 0, 0, 0, 1};
                for (int s = 24; s >= 0; s -= 8)
                    rep.push_back(static_cast<uint8_t>(plc_.tcpError >> s));
                if (plc_.tcpError != 0) {
                    rep[7] = 8;
                    queue(rep, 1);
                    continue;
                }
                const uint32_t client = asked != 0 ? asked : plc_.clientNode;
                for (int s = 24; s >= 0; s -= 8) rep.push_back(static_cast<uint8_t>(client >> s));
                for (int s = 24; s >= 0; s -= 8)
                    rep.push_back(static_cast<uint8_t>(plc_.node >> s));
                if (plc_.responding) queue(rep, 1);
            } else if (cmd == 2) {
                deliver(Bytes(msg.begin() + 16, msg.end()));
            }
        }
        return true;
    }
    drv::ReadResult read(uint8_t* buf, size_t max, int timeoutMs) override {
        drv::ReadResult r;
        if (!open_) {
            r.code = drv::ReadCode::Closed;
            return r;
        }
        const int64_t now = clock_.monoMs();
        if (!pending_.empty() && pending_.front().at <= now + timeoutMs) {
            Pending p = pending_.front();
            pending_.pop_front();
            clock_.set(p.at);
            if (p.close) {
                open_ = false;
                r.code = drv::ReadCode::Closed;
                return r;
            }
            const size_t n = std::min(max, p.bytes.size());
            std::memcpy(buf, p.bytes.data(), n);
            plc_.bytesOut += n;
            r.code = drv::ReadCode::Data;
            r.n = n;
            return r;
        }
        clock_.set(now + timeoutMs);
        r.code = drv::ReadCode::Timeout;
        return r;
    }
    void interrupt() override {}
    void clearInterrupt() override {}
    uint64_t bytesSent() const override { return plc_.bytesIn; }
    uint64_t bytesReceived() const override { return plc_.bytesOut; }

   private:
    struct Pending {
        int64_t at = 0;
        Bytes bytes;
        bool close = false;
    };
    void queue(const Bytes& b, int64_t delay, bool close = false) {
        Pending p;
        p.at = clock_.monoMs() + delay;
        p.bytes = b;
        p.close = close;
        // keep the queue ordered by delivery time
        auto it = std::find_if(pending_.begin(), pending_.end(),
                               [&](const Pending& q) { return q.at > p.at; });
        pending_.insert(it, p);
    }
    void deliver(const Bytes& frame) {
        for (const auto& rep : plc_.handle(frame, clock_.monoMs())) {
            if (rep.close) {
                queue({}, rep.delayMs, true);
                continue;
            }
            if (!tcp_) {
                queue(rep.frame, rep.delayMs);
                continue;
            }
            Bytes msg = {'F', 'I', 'N', 'S'};
            const uint32_t len = static_cast<uint32_t>(8 + rep.frame.size());
            for (int s = 24; s >= 0; s -= 8) msg.push_back(static_cast<uint8_t>(len >> s));
            for (uint8_t b : {0, 0, 0, 2, 0, 0, 0, 0}) msg.push_back(b);
            msg.insert(msg.end(), rep.frame.begin(), rep.frame.end());
            if (rep.frame.size() == 2) msg = rep.frame;  // garbage goes raw
            queue(msg, rep.delayMs);
        }
    }

    FakeFinsPlc& plc_;
    FinsClock& clock_;
    bool tcp_;
    bool open_ = false;
    std::deque<Pending> pending_;
    Bytes inbuf_;
};

}  // namespace mat::testing
