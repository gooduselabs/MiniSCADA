// Test support for the Modbus RTU driver (feature 006 T163): a fake RS485 line on the fake clock,
// where the field devices are the FakePlc of the TCP tests (one memory per unit, scripted faults),
// and a bridge that puts the same devices on a real pty for the serial port. Tags are bound as in
// the TCP harness.
#pragma once
#include <fcntl.h>
#include <poll.h>
#include <stdlib.h>
#include <termios.h>
#include <unistd.h>

#include <atomic>
#include <deque>
#include <functional>
#include <memory>
#include <string>
#include <thread>

#include "drivers/modbus/modbus_rtu_driver.hpp"
#include "drivers/modbus/rtu_frame.hpp"
#include "drivers/modbus/tests/fake_plc.hpp"
#include "drivers/modbus/tests/tcp_harness.hpp"  // bind(), Rig-like helpers, conformance
#include "drivers/sdk/tests/driver_conformance.hpp"

namespace mat::testing {

// A fault of the line, on top of the ones of the FakePlc (Silent, Exception, Delay).
struct RtuFault {
    enum Kind {
        BadCrc,     // the last byte is wrong
        Short,      // the last byte is missing
        Extra,      // one byte too many
        Split,      // the frame in two, 60 ms apart: more than the gap
        Garbage,    // seven bytes of noise instead of the frame
        WrongUnit,  // another slave's address (CRC right)
        Late        // the right frame, `delayMs` late
    };
    Kind kind = BadCrc;
    int unit = -1;  // only requests to this slave
    int count = 1;
    int skip = 0;
    int64_t delayMs = 0;
};

// What the driver sees of the port: bytes arriving at the times the devices answer. Time moves only
// while the driver waits.
class FakeRtuTransport : public drv::Transport {
   public:
    FakeRtuTransport(FakePlc& plc, FakeClock& clock) : plc_(plc), clock_(clock) {}

    drv::ConnectCode connect(const std::string& path, int, int) override {
        ++plc_.connectAttempts;
        plc_.connectTimes.push_back(clock_.monoMs());
        lastPath = path;
        close();
        if (unplugged) {  // the device is gone: there is nothing to open
            clock_.advance(1);
            return drv::ConnectCode::PortError;
        }
        if (openCode != drv::ConnectCode::Ok) {
            clock_.advance(1);
            return openCode;
        }
        open_ = true;
        ++plc_.connections;
        warnings_ = warningsOnOpen;
        clock_.advance(1);
        return drv::ConnectCode::Ok;
    }
    bool isOpen() const override { return open_; }
    void close() override {
        open_ = false;
        events_.clear();
        inbound_.clear();
    }
    bool peerClosed() override { return open_ && unplugged; }
    size_t discardInput() override {
        // what has arrived by now is thrown away
        while (!events_.empty() && events_.front().at <= clock_.monoMs()) events_.pop_front();
        const size_t n = inbound_.size();
        inbound_.clear();
        return n;
    }
    bool writeAll(const uint8_t* d, size_t n, int) override {
        if (!open_ || unplugged) return false;
        sent_ += n;
        plc_.bytesIn += n;
        const Bytes frame(d, d + n);
        sendTimes.push_back(clock_.monoMs());
        if (onWrite) onWrite(frame);
        const int64_t now = clock_.monoMs();
        if (echo) schedule(now + 1, frame);
        // the slave takes the frame if the CRC is right
        if (frame.size() < 4) return true;
        const uint16_t crc = modbus::crc16(frame.data(), frame.size() - 2);
        if (frame[frame.size() - 2] != (crc & 0xFF) || frame.back() != (crc >> 8)) return true;
        const int unit = frame[0];
        const Bytes pdu(frame.begin() + 1, frame.end() - 2);
        const PlcReply r = plc_.handle(plc_.adu(1, unit, pdu), now);
        if (r.silent || r.close || r.pieces.empty()) return true;
        Bytes reply = r.pieces[0];
        if (reply.size() >= 8 && reply[2] == 0 && reply[3] == 0)
            reply = modbus::encodeRtu(reply[6], Bytes(reply.begin() + 7, reply.end()));
        int64_t at = now + latencyMs + r.delayMs;
        if (shapeReply) {  // the fuzz: the reply in pieces, damaged, late or not at all
            std::vector<std::pair<int64_t, Bytes>> pieces;
            shapeReply(reply, pieces);
            for (auto& [wait, bytes] : pieces) {
                at += wait;
                schedule(at, bytes);
            }
            return true;
        }
        // a scripted fault of the line
        for (auto it = faults.begin(); it != faults.end(); ++it) {
            if (it->unit >= 0 && it->unit != unit) continue;
            if (it->skip > 0) {
                --it->skip;
                continue;
            }
            const RtuFault f = *it;
            if (--it->count <= 0) faults.erase(it);
            applyFault(f, reply, at);
            return true;
        }
        schedule(at, reply);
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
            inbound_.insert(inbound_.end(), e.bytes.begin(), e.bytes.end());
        }
    }
    void interrupt() override { interrupted_ = true; }
    void clearInterrupt() override { interrupted_ = false; }
    uint64_t bytesSent() const override { return sent_; }
    uint64_t bytesReceived() const override { return received_; }
    std::vector<std::string> takeWarnings() override {
        std::vector<std::string> w;
        w.swap(warnings_);
        return w;
    }

    int64_t latencyMs = 5;
    bool echo = false;       // the bus gives back what is sent (a 2-wire adapter)
    bool unplugged = false;  // the port went away
    drv::ConnectCode openCode = drv::ConnectCode::Ok;
    std::vector<std::string> warningsOnOpen;
    std::string lastPath;
    std::deque<RtuFault> faults;
    std::vector<int64_t> sendTimes;
    std::function<void(const Bytes&)> onWrite;
    // Fuzz hooks: what the driver is handed, and the shape of a reply (pieces with the wait before
    // each; none: silence). Empty: the reply as it is, or a scripted fault.
    std::function<void(const uint8_t*, size_t)> onDelivered;
    std::function<void(const Bytes& reply, std::vector<std::pair<int64_t, Bytes>>& pieces)>
        shapeReply;

   private:
    struct Event {
        int64_t at;
        Bytes bytes;
    };
    void schedule(int64_t at, const Bytes& b) {
        events_.push_back({at, b});
        std::stable_sort(events_.begin(), events_.end(),
                         [](const Event& a, const Event& c) { return a.at < c.at; });
    }
    void applyFault(const RtuFault& f, Bytes reply, int64_t at) {
        switch (f.kind) {
            case RtuFault::BadCrc:
                reply.back() = static_cast<uint8_t>(reply.back() ^ 0x5A);
                schedule(at, reply);
                break;
            case RtuFault::Short:
                reply.pop_back();
                schedule(at, reply);
                break;
            case RtuFault::Extra:
                reply.push_back(0xFF);
                schedule(at, reply);
                break;
            case RtuFault::Split: {
                const size_t half = reply.size() / 2;
                schedule(at, Bytes(reply.begin(), reply.begin() + static_cast<long>(half)));
                schedule(at + 60, Bytes(reply.begin() + static_cast<long>(half), reply.end()));
                break;
            }
            case RtuFault::Garbage:
                schedule(at, Bytes{0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x02, 0x03});
                break;
            case RtuFault::WrongUnit: {
                const Bytes pdu(reply.begin() + 1, reply.end() - 2);
                schedule(at, modbus::encodeRtu(static_cast<uint8_t>(reply[0] + 1), pdu));
                break;
            }
            case RtuFault::Late:
                schedule(at + f.delayMs, reply);
                break;
        }
    }

    FakePlc& plc_;
    FakeClock& clock_;
    bool open_ = false;
    std::deque<Event> events_;
    std::deque<uint8_t> inbound_;
    std::vector<std::string> warnings_;
    uint64_t sent_ = 0, received_ = 0;
    std::atomic<bool> interrupted_{false};
};

inline drv::ModbusTcpConfig rtuConfig(size_t devices = 1) {
    drv::ModbusTcpConfig c;
    c.channelId = "rs1";
    drv::SerialLink s;
    s.port = "ttyAS2";
    c.serial = s;
    c.scanMs = {200, 200, 200};
    for (size_t i = 0; i < devices; ++i) {
        drv::ModbusDeviceConfig d;
        d.id = "slave" + std::to_string(i + 1);
        d.unit = static_cast<int>(i) + 1;
        d.timeoutMs = 100;
        d.retries = 1;
        c.devices.push_back(d);
    }
    return c;
}

// A driver on the fake line and clock, in manual mode.
struct RtuRig {
    explicit RtuRig(drv::ModbusTcpConfig c,
                    std::function<std::string(const std::string&)> check = {})
        : cfg(std::move(c)) {
        drv::DriverEnv env;
        env.manual = true;
        env.clock = &clock;
        env.uniform = [] { return 0.0; };
        env.sleep = [this](int64_t t) { clock.set(t); };
        env.checkPort = std::move(check);
        env.makeTransport = [this] {
            auto t = std::make_unique<FakeRtuTransport>(plc, clock);
            transport = t.get();
            if (setup) setup(*t);
            return std::unique_ptr<drv::Transport>(std::move(t));
        };
        drv = std::make_unique<drv::ModbusRtuDriver>(cfg, env);
    }
    ~RtuRig() { drv->stop(); }
    void start() { drv->start(sink); }
    void run(int64_t ms) { drv->pump(clock.monoMs() + ms); }
    drv::DriverDiag diag() const {
        drv::DriverDiag d;
        drv->diagnostics(d, clock.monoMs());
        return d;
    }
    std::vector<drv::TagUpdate> updatesOf(size_t tag) {
        std::lock_guard<std::mutex> g(sink.mu);
        std::vector<drv::TagUpdate> out;
        for (const auto& u : sink.all)
            if (u.tag == tag) out.push_back(u);
        return out;
    }
    // The last update of a Tag: quality and reason ("" when there is none).
    std::string lastState(size_t tag) {
        const auto u = sink.last(tag);
        if (!u) return "none";
        return u->quality == Quality::GOOD ? "GOOD" : "BAD " + u->reason;
    }

    FakeClock clock;
    FakePlc plc;
    drv::conformance::RecordingSink sink;
    drv::ModbusTcpConfig cfg;
    FakeRtuTransport* transport = nullptr;
    std::function<void(FakeRtuTransport&)> setup;  // set before start(): what a new port gets
    std::unique_ptr<drv::ModbusRtuDriver> drv;
};

// The standard driver suite on the fake line: the Tags of the TCP harness, on slave 1.
class RtuHarness : public drv::conformance::Harness {
   public:
    explicit RtuHarness(bool enabled = true, bool writable = false) : writable_(writable) {
        using modbus::Area;
        cfg_ = rtuConfig();
        cfg_.enabled = enabled;
        cfg_.tags = {
            bind(0, 0, Area::C, 0, TagType::BOOL),
            bind(1, 0, Area::HR, 0, TagType::BOOL, 1, 5),
            bind(2, 0, Area::HR, 1, TagType::INT16),
            bind(3, 0, Area::HR, 10, TagType::UINT32),
            bind(4, 0, Area::HR, 30, TagType::FLOAT32),
            bind(5, 0, Area::HR, 40, TagType::INT64),
            bind(6, 0, Area::HR, 70, TagType::FLOAT64),
            bind(7, 0, Area::HR, 80, TagType::STRING, 4),
        };
        cfg_.tags[1].bitWrite = drv::BitWrite::Mask;
        cfg_.tags[3].byteOrder = modbus::ByteOrder::CDAB;
        cfg_.tags[5].byteOrder = modbus::ByteOrder::DCBA;
        cfg_.tags[7].stringLength = 8;
        plc_.set(1, Area::C, 0, 1);
        plc_.set(1, Area::HR, 0, 0x0020);
        plc_.set(1, Area::HR, 1, 64302);
        plc_.setRegs(1, Area::HR, 10, {0x2800, 0xEE6B});
        plc_.setRegs(1, Area::HR, 30, {0x42F6, 0xE979});
        plc_.setRegs(1, Area::HR, 40, {0x0807, 0x0605, 0x0403, 0x0201});
        plc_.setRegs(1, Area::HR, 70, {0x4009, 0x21FB, 0x5444, 0x2D18});
        plc_.setRegs(1, Area::HR, 80, {0x42C6, 0xA16D, 0x2031, 0x0000});
        drv::DriverEnv env;
        env.manual = true;
        env.clock = &clock_;
        env.uniform = [] { return 0.0; };
        env.sleep = [this](int64_t t) { clock_.set(t); };
        env.makeTransport = [this] {
            return std::unique_ptr<drv::Transport>(new FakeRtuTransport(plc_, clock_));
        };
        drv_ = std::make_unique<drv::ModbusRtuDriver>(cfg_, env);
    }
    drv::Driver& driver() override { return *drv_; }
    size_t tagCount() const override { return 8; }
    TagType tagType(size_t t) const override { return cfg_.tags[t].rawType; }
    TagScalar backendValue(size_t t) const override {
        switch (t) {
            case 0:
            case 1:
                return true;
            case 2:
                return int64_t{-1234};
            case 3:
                return uint64_t{4000000000ULL};
            case 4:
                return static_cast<double>(123.456f);
            case 5:
                return int64_t{0x0102030405060708LL};
            case 6:
                return 3.141592653589793;
            default:
                return std::string("Bơm 1");
        }
    }
    void advance(int64_t ms) override { drv_->pump(clock_.monoMs() + ms); }
    int64_t cycleMs() const override { return 200; }
    bool supportsFaults() const override { return true; }
    void setBackendResponding(bool on) override { plc_.responding = on; }
    bool supportsDisabled() const override { return true; }
    std::unique_ptr<drv::conformance::Harness> makeDisabled() override {
        return std::make_unique<RtuHarness>(false, writable_);
    }
    uint64_t bytesOnWire() const override {
        return plc_.bytesIn + plc_.bytesOut + static_cast<uint64_t>(plc_.connectAttempts);
    }
    bool supportsDiagnostics() const override { return true; }
    void injectTimeouts(int count) override {
        PlcFault f;
        f.kind = PlcFault::Silent;
        f.count = count;
        plc_.addFault(f);
    }
    std::vector<size_t> writableTags() const override {
        return writable_ ? std::vector<size_t>{0, 1, 2, 3, 4, 7} : std::vector<size_t>{};
    }
    TagScalar writeValue(size_t t) const override {
        switch (t) {
            case 0:
            case 1:
                return false;
            case 2:
                return int64_t{4321};
            case 3:
                return uint64_t{123456789};
            case 4:
                return static_cast<double>(1.5f);
            default:
                return std::string("Van 2");
        }
    }

   private:
    bool writable_;
    FakeClock clock_;
    FakePlc plc_;
    drv::ModbusTcpConfig cfg_;
    std::unique_ptr<drv::ModbusRtuDriver> drv_;
};

// The same devices on a real pty, one thread: the master side reads RTU requests (cut by the length
// each function has), asks the FakePlc and writes the reply. Real time, for the serial port.
class PtyBridge {
   public:
    explicit PtyBridge(FakePlc& plc) : plc_(plc) {
        master_ = ::posix_openpt(O_RDWR | O_NOCTTY | O_CLOEXEC);
        ::grantpt(master_);
        ::unlockpt(master_);
        char buf[128];
        ::ptsname_r(master_, buf, sizeof buf);
        slave_ = buf;
        termios t{};
        ::tcgetattr(master_, &t);
        ::cfmakeraw(&t);
        ::tcsetattr(master_, TCSANOW, &t);
        thread_ = std::thread([this] { loop(); });
    }
    ~PtyBridge() {
        stop_ = true;
        if (thread_.joinable()) thread_.join();
        ::close(master_);
    }
    const std::string& path() const { return slave_; }
    std::atomic<int> requests{0};
    // Replies are cut, damaged or dropped by this hook (it gets the reply frame; empty: silence).
    std::function<void(Bytes&, int unit)> mutate;

   private:
    static size_t requestLength(const Bytes& b) {
        if (b.size() < 2) return 0;
        switch (b[1]) {
            case 1:
            case 2:
            case 3:
            case 4:
            case 5:
            case 6:
                return 8;
            case 22:
                return 10;
            case 15:
            case 16:
                return b.size() < 7 ? 0 : 9 + b[6];
        }
        return 8;
    }
    void loop() {
        Bytes buf;
        while (!stop_) {
            pollfd p{master_, POLLIN, 0};
            if (::poll(&p, 1, 10) <= 0 || !(p.revents & POLLIN)) continue;
            uint8_t tmp[256];
            const ssize_t n = ::read(master_, tmp, sizeof tmp);
            if (n <= 0) continue;
            buf.insert(buf.end(), tmp, tmp + n);
            for (;;) {
                const size_t len = requestLength(buf);
                if (len == 0 || buf.size() < len) break;
                const Bytes frame(buf.begin(), buf.begin() + static_cast<long>(len));
                buf.erase(buf.begin(), buf.begin() + static_cast<long>(len));
                const uint16_t crc = modbus::crc16(frame.data(), frame.size() - 2);
                if (frame[frame.size() - 2] != (crc & 0xFF) || frame.back() != (crc >> 8)) continue;
                ++requests;
                const int unit = frame[0];
                const PlcReply r =
                    plc_.handle(plc_.adu(1, unit, Bytes(frame.begin() + 1, frame.end() - 2)), 0);
                if (r.silent || r.pieces.empty()) continue;
                Bytes reply = modbus::encodeRtu(static_cast<uint8_t>(r.pieces[0][6]),
                                                Bytes(r.pieces[0].begin() + 7, r.pieces[0].end()));
                if (mutate) mutate(reply, unit);
                if (reply.empty()) continue;
                const ssize_t w = ::write(master_, reply.data(), reply.size());
                (void)w;
            }
        }
    }

    FakePlc& plc_;
    int master_ = -1;
    std::string slave_;
    std::atomic<bool> stop_{false};
    std::thread thread_;
};

}  // namespace mat::testing
