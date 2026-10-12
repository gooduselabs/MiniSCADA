// The Modbus TCP driver on a fake PLC for the standard driver suite (T048): eight Tags of every
// shape the suite needs. `writable` marks six of them for item 4 (write results).
#pragma once
#include <memory>
#include <string>

#include "drivers/modbus/modbus_tcp_driver.hpp"
#include "drivers/modbus/tests/fake_plc.hpp"
#include "drivers/sdk/tests/driver_conformance.hpp"

namespace mat::testing {

inline drv::TagBinding bind(size_t tag, uint32_t dev, modbus::Area area, int offset, TagType raw,
                            int count = 0, int bit = -1) {
    drv::TagBinding b;
    b.tag = tag;
    b.device = dev;
    b.area = area;
    b.offset = offset;
    b.rawType = raw;
    b.bit = bit;
    b.count = count > 0 ? count : (raw == TagType::BOOL ? 1 : modbus::wordsOf(raw));
    return b;
}

inline drv::ModbusTcpConfig baseConfig(size_t devices = 1) {
    drv::ModbusTcpConfig c;
    c.channelId = "plc1";
    c.host = "127.0.0.1";
    c.port = 502;
    for (size_t i = 0; i < devices; ++i) {
        drv::ModbusDeviceConfig d;
        d.id = "dev" + std::to_string(i);
        d.unit = static_cast<int>(i) + 1;
        c.devices.push_back(d);
    }
    return c;
}

class TcpHarness : public drv::conformance::Harness {
   public:
    explicit TcpHarness(bool enabled = true, bool writable = false) : writable_(writable) {
        using modbus::Area;
        cfg_ = baseConfig();
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
        env.firstTid = [] { return static_cast<uint16_t>(100); };
        env.sleep = [this](int64_t t) { clock_.set(t); };
        env.makeTransport = [this] {
            return std::unique_ptr<drv::Transport>(new FakeTransport(plc_, clock_));
        };
        drv_ = std::make_unique<drv::ModbusTcpDriver>(cfg_, env);
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
    int64_t cycleMs() const override { return 1000; }
    bool supportsFaults() const override { return true; }
    void setBackendResponding(bool on) override { plc_.responding = on; }
    bool supportsDisabled() const override { return true; }
    std::unique_ptr<drv::conformance::Harness> makeDisabled() override {
        return std::make_unique<TcpHarness>(false, writable_);
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
    std::unique_ptr<drv::ModbusTcpDriver> drv_;
};

// A driver on the fake PLC and clock, in manual mode.
struct Rig {
    explicit Rig(drv::ModbusTcpConfig c, int firstTid = 1000) : cfg(std::move(c)) {
        drv::DriverEnv env;
        env.manual = true;
        env.clock = &clock;
        env.uniform = [] { return 0.0; };
        env.firstTid = [firstTid] { return static_cast<uint16_t>(firstTid); };
        env.sleep = [this](int64_t t) { clock.set(t); };
        env.makeTransport = [this] {
            auto t = std::make_unique<FakeTransport>(plc, clock);
            transport = t.get();
            return std::unique_ptr<drv::Transport>(std::move(t));
        };
        drv = std::make_unique<drv::ModbusTcpDriver>(cfg, env);
    }
    ~Rig() { drv->stop(); }
    void start() { drv->start(sink); }
    void run(int64_t ms) { drv->pump(clock.monoMs() + ms); }
    drv::DriverDiag diag() const {
        drv::DriverDiag d;
        drv->diagnostics(d, clock.monoMs());
        return d;
    }
    // Every update of a Tag, in order.
    std::vector<drv::TagUpdate> updatesOf(size_t tag) {
        std::lock_guard<std::mutex> g(sink.mu);
        std::vector<drv::TagUpdate> out;
        for (const auto& u : sink.all)
            if (u.tag == tag) out.push_back(u);
        return out;
    }
    bool everBad(size_t tag) {
        for (const auto& u : updatesOf(tag))
            if (u.quality == Quality::BAD) return true;
        return false;
    }

    FakeClock clock;
    FakePlc plc;
    drv::conformance::RecordingSink sink;
    drv::ModbusTcpConfig cfg;
    FakeTransport* transport = nullptr;
    std::unique_ptr<drv::ModbusTcpDriver> drv;
};

}  // namespace mat::testing
