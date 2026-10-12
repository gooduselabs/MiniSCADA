// Test support for the Modbus TCP driver and its probe (feature 006): a PLC model with memory and
// scripted faults, a fake clock, a fake transport that talks to the PLC in the same process
// (time moves only when a call waits), and a loopback TCP server that puts the same PLC on a real
// socket. Independent of the driver's own frame code only as far as a test can be: the PLC parses
// requests by hand.
#pragma once
#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <thread>
#include <vector>

#include "drivers/modbus/codec.hpp"
#include "drivers/modbus/pdu.hpp"
#include "drivers/sdk/transport.hpp"

namespace mat::testing {

using modbus::Area;
using modbus::Bytes;

class FakeClock : public drv::Clock {
   public:
    int64_t monoMs() const override { return mono_.load(); }
    int64_t wallMs() const override { return kWallBase + mono_.load(); }
    void set(int64_t t) {
        if (t > mono_.load()) mono_ = t;
    }
    void advance(int64_t d) { mono_ += d; }
    static constexpr int64_t kWallBase = 1791594000000;

   private:
    std::atomic<int64_t> mono_{1000};
};

struct PlcRequest {
    int unit = 0, fc = 0, address = 0, quantity = 0;
    uint16_t tid = 0;
    int64_t atMs = 0;
};

struct PlcFault {
    enum Kind {
        Silent,
        Exception,
        BadTid,
        BadUnit,
        BadLength,
        BadProtocol,
        Garbage,
        Delay,
        CloseConn,
        Truncate
    };
    Kind kind = Silent;
    int code = 2;            // Exception
    int64_t delayMs = 0;     // Delay, and extra delay of the others
    int unit = -1;           // only requests for this unit (-1: any)
    int fc = -1;             // only this function
    int from = -1, to = -1;  // only requests that touch this address range
    int count = 1;           // how many requests it affects
    int skip = 0;            // let this many matching requests pass first
};

struct PlcReply {
    std::vector<Bytes> pieces;    // each arrives as one read (a test splits a frame this way)
    std::vector<int64_t> gapsMs;  // wait before each piece after the first; empty: 1 ms
    int64_t delayMs = 0;
    bool silent = false;
    bool close = false;
};

// The PLC: memory by (unit, area, address) and the reply to a request frame.
class FakePlc {
   public:
    static uint32_t key(int unit, Area a, int addr) {
        return (static_cast<uint32_t>(unit) << 24) | (static_cast<uint32_t>(a) << 20) |
               static_cast<uint32_t>(addr);
    }
    void set(int unit, Area a, int addr, uint16_t v) {
        std::lock_guard<std::mutex> g(mu);
        mem[key(unit, a, addr)] = v;
    }
    void setRegs(int unit, Area a, int addr, const std::vector<uint16_t>& v) {
        for (size_t i = 0; i < v.size(); ++i) set(unit, a, addr + static_cast<int>(i), v[i]);
    }
    void erase(int unit, Area a, int addr) {
        std::lock_guard<std::mutex> g(mu);
        mem.erase(key(unit, a, addr));
    }
    uint16_t get(int unit, Area a, int addr) {
        std::lock_guard<std::mutex> g(mu);
        auto it = mem.find(key(unit, a, addr));
        return it == mem.end() ? 0 : it->second;
    }
    bool has(int unit, Area a, int addr) {
        std::lock_guard<std::mutex> g(mu);
        return mem.count(key(unit, a, addr)) != 0;
    }
    void addFault(PlcFault f) {
        std::lock_guard<std::mutex> g(mu);
        faults.push_back(f);
    }
    std::vector<PlcRequest> requests() {
        std::lock_guard<std::mutex> g(mu);
        return log;
    }
    size_t requestCount(int fc = -1, int unit = -1) {
        std::lock_guard<std::mutex> g(mu);
        size_t n = 0;
        for (const auto& r : log)
            if ((fc < 0 || r.fc == fc) && (unit < 0 || r.unit == unit)) ++n;
        return n;
    }

    // Reply to one request frame (the whole ADU).
    PlcReply handle(const Bytes& frame, int64_t nowMs) {
        std::lock_guard<std::mutex> g(mu);
        PlcReply out;
        if (frame.size() < 8) {
            out.silent = true;
            return out;
        }
        const uint16_t tid = static_cast<uint16_t>((frame[0] << 8) | frame[1]);
        const int unit = frame[6];
        const Bytes pdu(frame.begin() + 7, frame.end());
        PlcRequest rq;
        rq.unit = unit;
        rq.fc = pdu[0];
        rq.tid = tid;
        rq.atMs = nowMs;
        if (pdu.size() >= 5) {
            rq.address = (pdu[1] << 8) | pdu[2];
            rq.quantity = (pdu[3] << 8) | pdu[4];
            if (pdu[0] == 5 || pdu[0] == 6 || pdu[0] == 22) rq.quantity = 1;
        }
        log.push_back(rq);
        ++inflightSeen;
        if (!responding || (!knownUnits.empty() && !knownUnits.count(unit))) {
            out.silent = true;
            return out;
        }
        // a scripted fault for this request
        for (auto it = faults.begin(); it != faults.end(); ++it) {
            if (it->unit >= 0 && it->unit != unit) continue;
            if (it->fc >= 0 && it->fc != rq.fc) continue;
            if (it->from >= 0 && rq.address + rq.quantity - 1 < it->from) continue;
            if (it->to >= 0 && rq.address > it->to) continue;
            if (it->skip > 0) {
                --it->skip;
                continue;
            }
            const PlcFault f = *it;
            if (--it->count <= 0) faults.erase(it);
            return faulty(f, tid, unit, pdu);
        }
        const Bytes resp = respond(unit, pdu);
        out.pieces.push_back(adu(tid, unit, resp));
        return out;
    }

    Bytes adu(uint16_t tid, int unit, const Bytes& pdu) const {
        Bytes b{static_cast<uint8_t>(tid >> 8),
                static_cast<uint8_t>(tid & 0xFF),
                0,
                0,
                static_cast<uint8_t>((pdu.size() + 1) >> 8),
                static_cast<uint8_t>((pdu.size() + 1) & 0xFF),
                static_cast<uint8_t>(unit)};
        b.insert(b.end(), pdu.begin(), pdu.end());
        return b;
    }

    bool responding = true;
    bool ignoreWrites = false;  // answers a write but keeps the old value
    std::set<int> knownUnits;   // empty: every unit answers
    int connections = 0;
    int connectAttempts = 0;
    std::vector<int64_t> connectTimes;
    uint64_t bytesIn = 0, bytesOut = 0;
    int dropEpoch = 0;  // dropAll() makes every connection look closed from the PLC side
    void dropAll() {
        std::lock_guard<std::mutex> g(mu);
        ++dropEpoch;
    }
    bool refuse = false;
    bool connectTimesOut = false;

    std::mutex mu;
    std::map<uint32_t, uint16_t> mem;
    std::deque<PlcFault> faults;
    std::vector<PlcRequest> log;
    int inflightSeen = 0;

   private:
    PlcReply faulty(const PlcFault& f, uint16_t tid, int unit, const Bytes& pdu) {
        PlcReply out;
        out.delayMs = f.delayMs;
        switch (f.kind) {
            case PlcFault::Silent:
                out.silent = true;
                return out;
            case PlcFault::CloseConn:
                out.close = true;
                return out;
            case PlcFault::Exception:
                out.pieces.push_back(
                    adu(tid, unit,
                        Bytes{static_cast<uint8_t>(pdu[0] | 0x80), static_cast<uint8_t>(f.code)}));
                return out;
            case PlcFault::Garbage: {
                Bytes g(12);
                for (size_t i = 0; i < g.size(); ++i) g[i] = static_cast<uint8_t>(i * 37 + 11);
                g[2] = 0xFF;  // a protocol id that is not 0
                out.pieces.push_back(g);
                return out;
            }
            default:
                break;
        }
        Bytes frame = adu(tid, unit, respond(unit, pdu));
        if (f.kind == PlcFault::BadTid) frame[1] = static_cast<uint8_t>(frame[1] + 1);
        if (f.kind == PlcFault::BadUnit) frame[6] = static_cast<uint8_t>(frame[6] + 1);
        if (f.kind == PlcFault::BadLength) frame[5] = static_cast<uint8_t>(frame[5] + 1);
        if (f.kind == PlcFault::BadProtocol) frame[3] = 1;
        if (f.kind == PlcFault::Truncate) frame.resize(frame.size() - 1);
        out.pieces.push_back(frame);
        return out;
    }

    static Bytes exc(int fc, int code) {
        return Bytes{static_cast<uint8_t>(fc | 0x80), static_cast<uint8_t>(code)};
    }

    Bytes respond(int unit, const Bytes& pdu) {
        const int fc = pdu[0];
        if (pdu.size() < 5) return exc(fc, 3);
        const int addr = (pdu[1] << 8) | pdu[2];
        const int qty = (pdu[3] << 8) | pdu[4];
        auto area = [&]() {
            switch (fc) {
                case 1:
                case 5:
                case 15:
                    return Area::C;
                case 2:
                    return Area::DI;
                case 4:
                    return Area::IR;
                default:
                    return Area::HR;
            }
        };
        auto defined = [&](int a, int n) {
            for (int i = 0; i < n; ++i)
                if (!mem.count(key(unit, area(), a + i))) return false;
            return true;
        };
        switch (fc) {
            case 1:
            case 2: {
                if (qty < 1 || qty > 2000) return exc(fc, 3);
                if (!defined(addr, qty)) return exc(fc, 2);
                std::vector<uint8_t> bits;
                for (int i = 0; i < qty; ++i)
                    bits.push_back(mem[key(unit, area(), addr + i)] ? 1 : 0);
                const Bytes packed = modbus::packBits(bits);
                Bytes r{static_cast<uint8_t>(fc), static_cast<uint8_t>(packed.size())};
                r.insert(r.end(), packed.begin(), packed.end());
                return r;
            }
            case 3:
            case 4: {
                if (qty < 1 || qty > 125) return exc(fc, 3);
                if (!defined(addr, qty)) return exc(fc, 2);
                Bytes r{static_cast<uint8_t>(fc), static_cast<uint8_t>(qty * 2)};
                for (int i = 0; i < qty; ++i) {
                    const uint16_t v = mem[key(unit, area(), addr + i)];
                    r.push_back(static_cast<uint8_t>(v >> 8));
                    r.push_back(static_cast<uint8_t>(v & 0xFF));
                }
                return r;
            }
            case 5: {
                if (!defined(addr, 1)) return exc(fc, 2);
                if (!ignoreWrites) mem[key(unit, Area::C, addr)] = (pdu[3] == 0xFF) ? 1 : 0;
                return pdu;
            }
            case 6: {
                if (!defined(addr, 1)) return exc(fc, 2);
                if (!ignoreWrites)
                    mem[key(unit, Area::HR, addr)] = static_cast<uint16_t>((pdu[3] << 8) | pdu[4]);
                return pdu;
            }
            case 15: {
                if (!defined(addr, qty)) return exc(fc, 2);
                for (int i = 0; i < qty && !ignoreWrites; ++i)
                    mem[key(unit, Area::C, addr + i)] = (pdu[6 + (i >> 3)] >> (i & 7)) & 1;
                return Bytes(pdu.begin(), pdu.begin() + 5);
            }
            case 16: {
                if (!defined(addr, qty)) return exc(fc, 2);
                for (int i = 0; i < qty && !ignoreWrites; ++i)
                    mem[key(unit, Area::HR, addr + i)] =
                        static_cast<uint16_t>((pdu[6 + 2 * i] << 8) | pdu[7 + 2 * i]);
                return Bytes(pdu.begin(), pdu.begin() + 5);
            }
            case 22: {
                if (!defined(addr, 1)) return exc(fc, 2);
                const uint16_t andm = static_cast<uint16_t>((pdu[3] << 8) | pdu[4]);
                const uint16_t orm = static_cast<uint16_t>((pdu[5] << 8) | pdu[6]);
                uint16_t& v = mem[key(unit, Area::HR, addr)];
                if (!ignoreWrites) v = static_cast<uint16_t>((v & andm) | (orm & ~andm));
                return pdu;
            }
        }
        return exc(fc, 1);
    }
};

// The transport of the tests: no sockets, no sleeping. A read that has to wait moves the fake
// clock.
class FakeTransport : public drv::Transport {
   public:
    FakeTransport(FakePlc& plc, FakeClock& clock) : plc_(plc), clock_(clock) {}

    drv::ConnectCode connect(const std::string&, int, int timeoutMs) override {
        ++plc_.connectAttempts;
        plc_.connectTimes.push_back(clock_.monoMs());
        close();
        if (onReset) onReset();
        if (plc_.refuse) {
            clock_.advance(1);
            return drv::ConnectCode::Refused;
        }
        if (plc_.connectTimesOut) {
            clock_.advance(timeoutMs);
            return drv::ConnectCode::Timeout;
        }
        open_ = true;
        closedAt_ = -1;
        epoch_ = plc_.dropEpoch;
        ++plc_.connections;
        clock_.advance(1);
        return drv::ConnectCode::Ok;
    }
    bool isOpen() const override { return open_; }
    void close() override {
        open_ = false;
        events_.clear();
        inbound_.clear();
        if (onReset) onReset();
    }
    bool peerClosed() override { return open_ && (epoch_ != plc_.dropEpoch || closedAt_ >= 0); }
    size_t discardInput() override {
        const size_t n = inbound_.size();
        inbound_.clear();
        return n;
    }
    bool writeAll(const uint8_t* d, size_t n, int) override {
        if (!open_ || peerClosed()) return false;
        sent_ += n;
        plc_.bytesIn += n;
        const int64_t now = clock_.monoMs();
        PlcReply r = plc_.handle(Bytes(d, d + n), now);
        if (onWrite) onWrite(Bytes(d, d + n));
        if (mutateReply) mutateReply(r);
        if (r.close) {
            events_.push_back({now + latencyMs + r.delayMs, {}, true});
            return true;
        }
        int64_t at = now + latencyMs + r.delayMs;
        for (size_t i = 0; i < r.pieces.size(); ++i) {
            events_.push_back({at, r.pieces[i], false});
            at += i < r.gapsMs.size() ? r.gapsMs[i] : pieceGapMs;
        }
        std::stable_sort(events_.begin(), events_.end(),
                         [](const Event& a, const Event& b) { return a.at < b.at; });
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
                received_ += n;
                plc_.bytesOut += n;
                if (onDelivered) onDelivered(buf, n);
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
                closedAt_ = e.at;
                if (onReset) onReset();
                return {drv::ReadCode::Closed, 0};
            }
            inbound_.insert(inbound_.end(), e.bytes.begin(), e.bytes.end());
        }
    }
    void interrupt() override { interrupted_ = true; }
    void clearInterrupt() override { interrupted_ = false; }
    uint64_t bytesSent() const override { return sent_; }
    uint64_t bytesReceived() const override { return received_; }

    int64_t latencyMs = 5;
    int64_t pieceGapMs = 1;
    // Hooks of the fuzz tests: the request frame, the PLC reply before it is scheduled (a test may
    // damage it), the bytes handed to the driver, and a new or closed connection.
    std::function<void(const Bytes&)> onWrite;
    std::function<void(PlcReply&)> mutateReply;
    std::function<void(const uint8_t*, size_t)> onDelivered;
    std::function<void()> onReset;

   private:
    struct Event {
        int64_t at;
        Bytes bytes;
        bool close;
    };
    FakePlc& plc_;
    FakeClock& clock_;
    bool open_ = false;
    int epoch_ = 0;
    int64_t closedAt_ = -1;
    std::deque<Event> events_;
    std::deque<uint8_t> inbound_;
    uint64_t sent_ = 0, received_ = 0;
    std::atomic<bool> interrupted_{false};
};

// The same PLC on a real loopback socket, one thread per connection (tests only).
class LoopbackServer {
   public:
    explicit LoopbackServer(FakePlc& plc) : plc_(plc) {
        fd_ = ::socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
        int one = 1;
        ::setsockopt(fd_, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
        sockaddr_in a{};
        a.sin_family = AF_INET;
        a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        ::bind(fd_, reinterpret_cast<sockaddr*>(&a), sizeof a);
        ::listen(fd_, 16);
        socklen_t len = sizeof a;
        ::getsockname(fd_, reinterpret_cast<sockaddr*>(&a), &len);
        port = ntohs(a.sin_port);
        acceptor_ = std::thread([this] { acceptLoop(); });
    }
    ~LoopbackServer() { stop(); }
    void stop() {
        if (stopped_.exchange(true)) return;
        if (fd_ >= 0) ::shutdown(fd_, SHUT_RDWR);
        if (acceptor_.joinable()) acceptor_.join();
        for (auto& t : conns_) t.join();
        ::close(fd_);
        fd_ = -1;
    }
    int port = 0;

   private:
    void acceptLoop() {
        while (!stopped_) {
            pollfd p{fd_, POLLIN, 0};
            if (::poll(&p, 1, 50) <= 0) continue;
            const int c = ::accept4(fd_, nullptr, nullptr, SOCK_CLOEXEC);
            if (c < 0) continue;
            ++plc_.connections;
            conns_.emplace_back([this, c] { serve(c); });
        }
    }
    void serve(int c) {
        Bytes buf;
        while (!stopped_) {
            pollfd p{c, POLLIN, 0};
            const int r = ::poll(&p, 1, 50);
            if (r < 0) break;
            if (r == 0) continue;
            uint8_t tmp[512];
            const ssize_t n = ::recv(c, tmp, sizeof tmp, 0);
            if (n <= 0) break;
            buf.insert(buf.end(), tmp, tmp + n);
            while (buf.size() >= 6) {
                const size_t len = 6 + static_cast<size_t>((buf[4] << 8) | buf[5]);
                if (buf.size() < len) break;
                const Bytes frame(buf.begin(), buf.begin() + static_cast<long>(len));
                buf.erase(buf.begin(), buf.begin() + static_cast<long>(len));
                const PlcReply rep = plc_.handle(frame, 0);
                if (rep.close) {
                    ::close(c);
                    return;
                }
                if (rep.silent) continue;
                if (rep.delayMs > 0)
                    std::this_thread::sleep_for(std::chrono::milliseconds(rep.delayMs));
                for (const Bytes& piece : rep.pieces)
                    ::send(c, piece.data(), piece.size(), MSG_NOSIGNAL);
            }
        }
        ::close(c);
    }

    FakePlc& plc_;
    int fd_ = -1;
    std::atomic<bool> stopped_{false};
    std::thread acceptor_;
    std::vector<std::thread> conns_;
};

}  // namespace mat::testing
