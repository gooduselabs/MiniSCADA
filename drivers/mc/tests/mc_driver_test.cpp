// The MC driver on a fake PLC (feature 017; spec US1-US3, plan "Quyết định"): every device and
// type, merging into Batch Read and Random Read, end codes and the split of a block, writes with
// readback, timeouts (3E closes the connection, 4E keeps it), UDP, ASCII, frames that do not match,
// and the SDK conformance suite.
#include "drivers/mc/mc_driver.hpp"

#include <gtest/gtest.h>

#include <cstring>

#include "drivers/mc/tests/fake_mc_plc.hpp"
#include "drivers/sdk/tests/driver_conformance.hpp"

using namespace mat;
using namespace mat::drv;
using namespace mat::testing;
using mc::Device;

namespace {

McTagBinding bindMc(size_t tag, const std::string& address, TagType raw, int stringLength = 0,
                    uint32_t device = 0, bool xyOctal = false) {
    mc::McAddressOptions o;
    o.rawType = raw;
    o.stringLength = stringLength;
    o.xyOctal = xyOctal;
    const mc::McAddress a = mc::parseMcAddress(address, o);
    EXPECT_TRUE(a.ok) << address << " " << a.error;
    McTagBinding b;
    b.tag = tag;
    b.device = device;
    b.dev = a.device;
    b.number = a.number;
    b.bitDevice = a.bitDevice;
    b.words = a.words;
    b.bit = a.bit;
    b.rawType = raw;
    b.stringLength = stringLength;
    return b;
}

McConfig baseMc(size_t devices = 1) {
    McConfig c;
    c.channelId = "plc-mc";
    c.host = "127.0.0.1";
    c.port = 5007;
    for (size_t i = 0; i < devices; ++i) {
        McDeviceConfig d;
        d.id = "dev" + std::to_string(i);
        d.route.station = static_cast<uint8_t>(i == 0 ? 255 : i);
        c.devices.push_back(d);
    }
    return c;
}

std::vector<uint16_t> floatWords(float f) {
    uint32_t u;
    std::memcpy(&u, &f, 4);
    return {static_cast<uint16_t>(u & 0xFFFF), static_cast<uint16_t>(u >> 16)};
}

std::vector<uint16_t> doubleWords(double d) {
    uint64_t u;
    std::memcpy(&u, &d, 8);
    return {static_cast<uint16_t>(u), static_cast<uint16_t>(u >> 16),
            static_cast<uint16_t>(u >> 32), static_cast<uint16_t>(u >> 48)};
}

struct McRig {
    explicit McRig(McConfig c, bool udp = false) : cfg(std::move(c)) {
        cfg.udp = udp;
        McEnv env;
        env.manual = true;
        env.clock = &clock;
        env.uniform = [] { return 0.0; };
        env.firstSerial = [] { return static_cast<uint16_t>(500); };
        env.sleep = [this](int64_t t) { clock.set(t); };
        env.makeTransport = [this, udp] {
            auto t = std::make_unique<McFakeTransport>(plc, clock, udp);
            transport = t.get();
            return std::unique_ptr<Transport>(std::move(t));
        };
        drv = std::make_unique<McDriver>(cfg, env);
    }
    ~McRig() { drv->stop(); }
    void start() { drv->start(sink); }
    void run(int64_t ms) { drv->pump(clock.monoMs() + ms); }
    DriverDiag diag() const {
        DriverDiag d;
        drv->diagnostics(d, clock.monoMs());
        return d;
    }
    std::optional<TagUpdate> last(size_t tag) { return sink.last(tag); }
    std::vector<McPlcRequest> requestsSince(size_t from) {
        auto all = plc.requests();
        return std::vector<McPlcRequest>(
            all.begin() + static_cast<long>(std::min(from, all.size())), all.end());
    }
    bool write(size_t tag, TagScalar raw, uint64_t id = 1) {
        WriteCommand c;
        c.id = id;
        c.tag = tag;
        c.raw = std::move(raw);
        return drv->enqueueWrite(c);
    }

    FakeClock clock;
    FakeMcPlc plc;
    conformance::RecordingSink sink;
    McConfig cfg;
    McFakeTransport* transport = nullptr;
    std::unique_ptr<McDriver> drv;
};

// Every device and type of FR-003/FR-004 on station 255.
McConfig allTypes() {
    McConfig c = baseMc();
    c.tags = {
        bindMc(0, "D100", TagType::INT16),     bindMc(1, "D101", TagType::UINT16),
        bindMc(2, "D200", TagType::FLOAT32),   bindMc(3, "D300", TagType::INT32),
        bindMc(4, "D302", TagType::UINT32),    bindMc(5, "D400", TagType::FLOAT64),
        bindMc(6, "D500", TagType::STRING, 8), bindMc(7, "D100.5", TagType::BOOL),
        bindMc(8, "ZR1000", TagType::INT32),   bindMc(9, "R10", TagType::INT16),
        bindMc(10, "W1A", TagType::UINT16),    bindMc(11, "SD210", TagType::UINT16),
        bindMc(12, "TN0", TagType::INT16),     bindMc(13, "CN3", TagType::UINT16),
        bindMc(14, "M10", TagType::BOOL),      bindMc(15, "X1F", TagType::BOOL),
        bindMc(16, "Y20", TagType::BOOL),      bindMc(17, "B1F", TagType::BOOL),
        bindMc(18, "L5", TagType::BOOL),       bindMc(19, "SM400", TagType::BOOL),
        bindMc(20, "D600", TagType::INT64),    bindMc(21, "M11", TagType::BOOL),
    };
    return c;
}

void seedAllTypes(FakeMcPlc& p) {
    const int s = 255;
    p.setWord(s, Device::D, 100, static_cast<uint16_t>(-1234 & 0xFFFF) | 0x0020);  // bit 5 set
    p.setWord(s, Device::D, 101, 65000);
    p.setWords(s, Device::D, 200, floatWords(123.5f));
    p.setWords(s, Device::D, 300, {0x2EEA, 0xFFFF});  // -53526 (low word first)
    p.setWords(s, Device::D, 302, {0x2800, 0xEE6B});  // 4000000000
    p.setWords(s, Device::D, 400, doubleWords(3.141592653589793));
    // "MITSU-01": first char in the low byte
    p.setWords(s, Device::D, 500, {0x494D, 0x5354, 0x2D55, 0x3130});
    p.setWords(s, Device::ZR, 1000, {0x86A0, 0x0001});  // 100000
    p.setWord(s, Device::R, 10, static_cast<uint16_t>(-7));
    p.setWord(s, Device::W, 0x1A, 0xBEEF);
    p.setWord(s, Device::SD, 210, 2026);
    p.setWord(s, Device::TN, 0, 42);
    p.setWord(s, Device::CN, 3, 7);
    p.setBit(s, Device::M, 10, true);
    p.setBit(s, Device::X, 0x1F, true);
    p.setBit(s, Device::Y, 0x20, true);
    p.setBit(s, Device::B, 0x1F, true);
    p.setBit(s, Device::L, 5, true);
    p.setBit(s, Device::SM, 400, true);
    p.setWords(s, Device::D, 600, {0x0807, 0x0605, 0x0403, 0x0201});
}

void expectAllTypes(McRig& r) {
    auto val = [&](size_t t) {
        const auto u = r.last(t);
        EXPECT_TRUE(u.has_value()) << "tag " << t;
        if (!u) return TagScalar{};
        EXPECT_EQ(u->quality, Quality::GOOD) << "tag " << t << " " << u->reason;
        return u->value;
    };
    // D100 holds 0xFB2E | 0x20 = 0xFB2E (bit 5 already set in -1234 = 0xFB2E)
    EXPECT_EQ(val(0), TagScalar(int64_t{-1234}));
    EXPECT_EQ(val(1), TagScalar(uint64_t{65000}));
    EXPECT_EQ(val(2), TagScalar(123.5));
    EXPECT_EQ(val(3), TagScalar(int64_t{-53526}));
    EXPECT_EQ(val(4), TagScalar(uint64_t{4000000000ULL}));
    EXPECT_EQ(val(5), TagScalar(3.141592653589793));
    EXPECT_EQ(val(6), TagScalar(std::string("MITSU-01")));
    EXPECT_EQ(val(7), TagScalar(true));
    EXPECT_EQ(val(8), TagScalar(int64_t{100000}));
    EXPECT_EQ(val(9), TagScalar(int64_t{-7}));
    EXPECT_EQ(val(10), TagScalar(uint64_t{0xBEEF}));
    EXPECT_EQ(val(11), TagScalar(uint64_t{2026}));
    EXPECT_EQ(val(12), TagScalar(int64_t{42}));
    EXPECT_EQ(val(13), TagScalar(uint64_t{7}));
    for (size_t t : {14, 15, 16, 17, 18, 19}) EXPECT_EQ(val(t), TagScalar(true)) << t;
    EXPECT_EQ(val(21), TagScalar(false));
}

}  // namespace

// ---- Conformance
// ---------------------------------------------------------------------------------

class McHarness : public conformance::Harness {
   public:
    McHarness(bool enabled, bool writable, mc::FrameType frame, mc::CodeType code)
        : writable_(writable), frame_(frame), code_(code) {
        McConfig c = baseMc();
        c.enabled = enabled;
        c.frame = frame;
        c.code = code;
        c.tags = {bindMc(0, "M0", TagType::BOOL),     bindMc(1, "D0.5", TagType::BOOL),
                  bindMc(2, "D1", TagType::INT16),    bindMc(3, "D10", TagType::UINT32),
                  bindMc(4, "D30", TagType::FLOAT32), bindMc(5, "D40", TagType::INT64),
                  bindMc(6, "D70", TagType::FLOAT64), bindMc(7, "D80", TagType::STRING, 8)};
        c.devices[0].bitRmw = true;
        rig_ = std::make_unique<McRig>(c);
        auto& p = rig_->plc;
        p.setBit(255, Device::M, 0, true);
        p.setWord(255, Device::D, 0, 0x0020);
        p.setWord(255, Device::D, 1, static_cast<uint16_t>(-1234));
        p.setWords(255, Device::D, 10, {0x2800, 0xEE6B});
        p.setWords(255, Device::D, 30, floatWords(123.456f));
        p.setWords(255, Device::D, 40, {0x0807, 0x0605, 0x0403, 0x0201});
        p.setWords(255, Device::D, 70, doubleWords(3.141592653589793));
        p.setWords(255, Device::D, 80, {0xC642, 0x6DA1, 0x3120, 0x0000});  // "Bơm 1" as BA
    }
    Driver& driver() override { return *rig_->drv; }
    size_t tagCount() const override { return 8; }
    TagType tagType(size_t t) const override { return rig_->cfg.tags[t].rawType; }
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
                return int64_t{0x0201040306050807LL};
            case 6:
                return 3.141592653589793;
            default:
                return std::string("Bơm 1");
        }
    }
    void advance(int64_t ms) override { rig_->run(ms); }
    int64_t cycleMs() const override { return 1000; }
    bool supportsFaults() const override { return true; }
    void setBackendResponding(bool on) override { rig_->plc.responding = on; }
    bool supportsDisabled() const override { return true; }
    std::unique_ptr<conformance::Harness> makeDisabled() override {
        return std::make_unique<McHarness>(false, writable_, frame_, code_);
    }
    uint64_t bytesOnWire() const override {
        return rig_->plc.bytesIn + rig_->plc.bytesOut +
               static_cast<uint64_t>(rig_->plc.connectAttempts);
    }
    bool supportsDiagnostics() const override { return true; }
    void injectTimeouts(int count) override {
        McFault f;
        f.kind = McFault::Silent;
        f.count = count;
        rig_->plc.addFault(f);
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
    mc::FrameType frame_;
    mc::CodeType code_;
    std::unique_ptr<McRig> rig_;
};

struct Mc3EBinary {
    static std::unique_ptr<conformance::Harness> make() {
        return std::make_unique<McHarness>(true, false, mc::FrameType::E3, mc::CodeType::Binary);
    }
};
struct Mc3EWrite {
    static std::unique_ptr<conformance::Harness> make() {
        return std::make_unique<McHarness>(true, true, mc::FrameType::E3, mc::CodeType::Binary);
    }
};
struct Mc4EAscii {
    static std::unique_ptr<conformance::Harness> make() {
        return std::make_unique<McHarness>(true, true, mc::FrameType::E4, mc::CodeType::Ascii);
    }
};
using namespace mat::drv::conformance;
INSTANTIATE_TYPED_TEST_SUITE_P(Mc3EBinary, DriverConformance, Mc3EBinary);
INSTANTIATE_TYPED_TEST_SUITE_P(Mc3EWrite, DriverConformance, Mc3EWrite);
INSTANTIATE_TYPED_TEST_SUITE_P(Mc4EAscii, DriverConformance, Mc4EAscii);

// ---- Reads
// ---------------------------------------------------------------------------------------

TEST(McDriver, ReadsEveryDeviceAndType) {
    for (auto code : {mc::CodeType::Binary, mc::CodeType::Ascii}) {
        McConfig c = allTypes();
        c.code = code;
        McRig r(c);
        seedAllTypes(r.plc);
        r.start();
        r.run(2500);
        expectAllTypes(r);
        const auto u = r.last(20);
        ASSERT_TRUE(u);
        EXPECT_EQ(u->value, TagScalar(int64_t{0x0201040306050807LL}));
    }
}

TEST(McDriver, OctalXOfFx5) {
    McConfig c = baseMc();
    c.devices[0].xyOctal = true;
    c.code = mc::CodeType::Ascii;
    c.tags = {bindMc(0, "X17", TagType::BOOL, 0, 0, true)};
    McRig r(c);
    r.plc.xyOctal = true;
    r.plc.setBit(255, Device::X, 15, true);  // X17 octal = point 15
    r.start();
    r.run(1500);
    const auto u = r.last(0);
    ASSERT_TRUE(u);
    EXPECT_EQ(u->value, TagScalar(true));
}

TEST(McDriver, MergesBatchAndRandomRead) {
    McConfig c = baseMc();
    for (size_t i = 0; i < 10; ++i)
        c.tags.push_back(bindMc(i, "D" + std::to_string(i), TagType::INT16));
    c.tags.push_back(bindMc(10, "D500", TagType::INT16));
    c.tags.push_back(bindMc(11, "D900", TagType::FLOAT32));
    c.tags.push_back(bindMc(12, "M5000", TagType::BOOL));
    c.tags.push_back(bindMc(13, "TN7", TagType::INT16));
    McRig r(c);
    r.start();
    r.run(1100);  // connected, first round done
    const size_t from = r.plc.requests().size();
    r.run(3000);  // three rounds
    const auto reqs = r.requestsSince(from);
    int batch = 0, random = 0;
    for (const auto& q : reqs) {
        if (q.cmd == 0x0401) {
            ++batch;
            EXPECT_EQ(q.device, static_cast<int>(Device::D));
            EXPECT_EQ(q.points, 10);
        } else if (q.cmd == 0x0403) {
            ++random;
            EXPECT_EQ(q.randomWords, 3);   // D500, M5000 (word of 16 points), TN7
            EXPECT_EQ(q.randomDwords, 1);  // D900
        }
    }
    EXPECT_EQ(batch, 3);
    EXPECT_EQ(random, 3);
    for (size_t t = 0; t < 14; ++t) {
        const auto u = r.last(t);
        ASSERT_TRUE(u) << t;
        EXPECT_EQ(u->quality, Quality::GOOD) << t;
    }
}

TEST(McDriver, RandomReadOffAndBatchLimit) {
    McConfig c = baseMc();
    c.devices[0].randomRead = false;
    c.devices[0].maxBatchWords = 4;
    c.devices[0].maxGapWords = 0;
    for (size_t i = 0; i < 8; ++i)
        c.tags.push_back(bindMc(i, "D" + std::to_string(i), TagType::INT16));
    c.tags.push_back(bindMc(8, "D500", TagType::INT16));
    c.tags.push_back(bindMc(9, "D900", TagType::INT16));
    McRig r(c);
    r.start();
    r.run(1100);
    const size_t from = r.plc.requests().size();
    r.run(1000);
    const auto reqs = r.requestsSince(from);
    ASSERT_EQ(reqs.size(), 4u);  // D0-3, D4-7, D500, D900
    for (const auto& q : reqs) {
        EXPECT_EQ(q.cmd, 0x0401);
        EXPECT_LE(q.points, 4);
    }
}

TEST(McDriver, RangeEndCodeSplitsTheBlock) {
    McConfig c = baseMc();
    c.devices[0].randomRead = false;
    for (size_t i = 0; i < 10; ++i)
        c.tags.push_back(bindMc(i, "D" + std::to_string(i * 2), TagType::INT16));
    McRig r(c);
    for (uint32_t i = 0; i < 20; ++i) r.plc.setWord(255, Device::D, i, static_cast<uint16_t>(i));
    McFault f;
    f.kind = McFault::EndCode;
    f.code = 0xC056;
    f.device = static_cast<int>(Device::D);
    f.from = 6;
    f.to = 6;
    f.count = 1000000;
    r.plc.addFault(f);
    r.start();
    r.run(12000);
    for (size_t i = 0; i < 10; ++i) {
        const auto u = r.last(i);
        ASSERT_TRUE(u) << i;
        if (i == 3) {
            EXPECT_EQ(u->quality, Quality::BAD);
            EXPECT_EQ(u->reason, "MC_END_RANGE");
        } else {
            EXPECT_EQ(u->quality, Quality::GOOD) << i << " " << u->reason;
            EXPECT_EQ(u->value, TagScalar(int64_t{static_cast<int64_t>(i * 2)}));
        }
    }
    EXPECT_GT(r.diag().devices[0].exceptions[0xC056], 0u);
}

TEST(McDriver, RandomReadRangeErrorBecomesBatchReads) {
    McConfig c = baseMc();
    c.tags = {bindMc(0, "D10", TagType::INT16), bindMc(1, "D500", TagType::INT16),
              bindMc(2, "W1000", TagType::INT16)};
    McRig r(c);
    r.plc.setWord(255, Device::D, 10, 1);
    r.plc.setWord(255, Device::D, 500, 2);
    McFault f;
    f.kind = McFault::EndCode;
    f.code = 0xC056;
    f.device = static_cast<int>(Device::W);
    f.count = 1000000;
    r.plc.addFault(f);
    r.start();
    r.run(5000);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
    EXPECT_EQ(r.last(1)->quality, Quality::GOOD);
    EXPECT_EQ(r.last(2)->reason, "MC_END_RANGE");
}

TEST(McDriver, DeviceEndCodeGivesItsReason) {
    McConfig c = baseMc();
    c.devices[0].randomRead = false;
    c.tags = {bindMc(0, "R0", TagType::INT16), bindMc(1, "D0", TagType::INT16)};
    McRig r(c);
    r.plc.badDevice[static_cast<int>(Device::R)] = 0xC05B;
    r.start();
    r.run(2500);
    EXPECT_EQ(r.last(0)->reason, "MC_END_DEVICE");
    EXPECT_EQ(r.last(1)->quality, Quality::GOOD);
    EXPECT_STREQ(mcEndReason(0xC059), "MC_END_COMMAND");
    EXPECT_STREQ(mcEndReason(0x4031), "MC_END_RANGE");
    EXPECT_STREQ(mcEndReason(0xCEE0), "MC_END_OTHER");
}

// ---- Writes
// --------------------------------------------------------------------------------------

TEST(McDriver, WritesEveryKindWithReadback) {
    for (auto code : {mc::CodeType::Binary, mc::CodeType::Ascii}) {
        McConfig c = baseMc();
        c.code = code;
        c.devices[0].bitRmw = true;
        c.tags = {bindMc(0, "M100", TagType::BOOL),     bindMc(1, "D10.3", TagType::BOOL),
                  bindMc(2, "D20", TagType::FLOAT32),   bindMc(3, "D30", TagType::STRING, 6),
                  bindMc(4, "ZR70000", TagType::INT32), bindMc(5, "Y2F", TagType::BOOL)};
        McRig r(c);
        r.plc.setWord(255, Device::D, 10, 0x8001);
        r.start();
        r.run(1100);
        ASSERT_TRUE(r.write(0, true, 1));
        ASSERT_TRUE(r.write(1, true, 2));
        ASSERT_TRUE(r.write(2, 21.25, 3));
        ASSERT_TRUE(r.write(3, std::string("AB-12"), 4));
        ASSERT_TRUE(r.write(4, int64_t{-70000}, 5));
        ASSERT_TRUE(r.write(5, true, 6));
        r.run(2000);
        const auto results = r.sink.takeResults();
        ASSERT_EQ(results.size(), 6u);
        for (const auto& res : results) EXPECT_EQ(res.code, "CONFIRMED") << res.id;
        EXPECT_TRUE(r.plc.bit(255, Device::M, 100));
        EXPECT_EQ(r.plc.word(255, Device::D, 10), 0x8009);  // bit 3 set, others kept
        EXPECT_EQ(r.plc.word(255, Device::D, 20), floatWords(21.25f)[0]);
        EXPECT_EQ(r.plc.word(255, Device::D, 21), floatWords(21.25f)[1]);
        EXPECT_EQ(r.plc.word(255, Device::D, 30), 0x4241);  // "AB": 'A' in the low byte
        EXPECT_EQ(r.plc.word(255, Device::ZR, 70000), static_cast<uint16_t>(-70000 & 0xFFFF));
        EXPECT_EQ(r.plc.word(255, Device::ZR, 70001), 0xFFFE);
        EXPECT_TRUE(r.plc.bit(255, Device::Y, 0x2F));
        // a bit device is written by one point (1401 sub 0001)
        bool sawBit = false;
        for (const auto& q : r.plc.requests())
            if (q.cmd == 0x1401 && q.sub == 1 && q.points == 1) sawBit = true;
        EXPECT_TRUE(sawBit);
    }
}

TEST(McDriver, WriteEndCodeIsDeviceException) {
    McConfig c = baseMc();
    c.tags = {bindMc(0, "D0", TagType::INT16)};
    McRig r(c);
    r.start();
    r.run(1100);
    McFault f;
    f.kind = McFault::EndCode;
    f.code = 0xC05B;
    f.cmd = 0x1401;
    r.plc.addFault(f);
    ASSERT_TRUE(r.write(0, int64_t{5}, 9));
    r.run(500);
    const auto res = r.sink.takeResults();
    ASSERT_EQ(res.size(), 1u);
    EXPECT_EQ(res[0].code, "DEVICE_EXCEPTION");
    EXPECT_EQ(res[0].exception, 0xC05B);
    EXPECT_EQ(r.diag().devices[0].writes.failed, 1u);
}

// ---- Timeouts, connection
// ------------------------------------------------------------------------

TEST(McDriver, TimeoutOn3EClosesTheConnection) {
    McConfig c = baseMc();
    c.tags = {bindMc(0, "D0", TagType::INT16)};
    McRig r(c);
    r.start();
    r.run(1100);
    ASSERT_EQ(r.plc.connections, 1);
    McFault f;
    f.kind = McFault::Silent;
    r.plc.addFault(f);
    r.run(1500);
    EXPECT_EQ(r.last(0)->reason, "TIMEOUT");
    EXPECT_EQ(r.diag().channel.lastErrorCode, "TIMEOUT");
    r.run(3000);
    EXPECT_EQ(r.plc.connections, 2);  // opened again after the backoff
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
}

TEST(McDriver, TimeoutOn4EKeepsTheConnectionAndDropsTheLateAnswer) {
    McConfig c = baseMc(2);
    c.frame = mc::FrameType::E4;
    c.tags = {bindMc(0, "D0", TagType::INT16, 0, 0), bindMc(1, "D0", TagType::INT16, 0, 1)};
    McRig r(c);
    r.plc.stations = {255, 1};
    r.plc.setWord(255, Device::D, 0, 11);
    r.plc.setWord(1, Device::D, 0, 22);
    r.start();
    r.run(1100);
    // station 1 answers late (after its 1 s timeout): the answer is dropped by its serial
    McFault late;
    late.kind = McFault::Delay;
    late.station = 1;
    late.delayMs = 1500;
    r.plc.addFault(late);
    r.run(4000);
    EXPECT_EQ(r.plc.connections, 1);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
    EXPECT_EQ(r.last(0)->value, TagScalar(int64_t{11}));
    // late answers are dropped quietly
    EXPECT_EQ(r.diag().devices[0].badFrames.tid + r.diag().devices[1].badFrames.tid, 0u);
    r.run(5000);
    EXPECT_EQ(r.last(1)->value, TagScalar(int64_t{22}));
    EXPECT_EQ(r.last(1)->quality, Quality::GOOD);
}

TEST(McDriver, MuteStationSuspendsOnlyItsDevice) {
    McConfig c = baseMc(2);
    c.frame = mc::FrameType::E4;
    c.tags = {bindMc(0, "D0", TagType::INT16, 0, 0), bindMc(1, "D0", TagType::INT16, 0, 1)};
    McRig r(c);
    r.plc.stations = {255, 1};
    r.plc.mute = {1};
    r.start();
    r.run(8000);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
    EXPECT_EQ(r.last(1)->reason, "TIMEOUT");
    EXPECT_EQ(r.drv->linkState(1).device, DeviceState::Suspended);
    EXPECT_EQ(r.plc.connections, 1);
}

TEST(McDriver, UdpReadsAndRecovers) {
    McConfig c = baseMc();
    c.frame = mc::FrameType::E4;
    c.tags = {bindMc(0, "D0", TagType::INT16)};
    McRig r(c, true);
    r.plc.setWord(255, Device::D, 0, 77);
    r.start();
    r.run(1100);
    EXPECT_EQ(r.last(0)->value, TagScalar(int64_t{77}));
    r.plc.responding = false;
    r.run(2500);
    EXPECT_EQ(r.last(0)->reason, "TIMEOUT");
    r.plc.responding = true;
    r.run(5000);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
}

TEST(McDriver, RefusedConnection) {
    McConfig c = baseMc();
    c.tags = {bindMc(0, "D0", TagType::INT16)};
    McRig r(c);
    r.plc.refuse = true;
    r.start();
    r.run(500);
    EXPECT_EQ(r.last(0)->reason, "REFUSED");
    EXPECT_EQ(r.diag().channel.lastErrorCode, "REFUSED");
    EXPECT_EQ(r.drv->linkState(0).channel, ChannelState::Error);
    r.plc.refuse = false;
    r.run(3000);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
}

TEST(McDriver, FramesThatDoNotMatchAreCounted) {
    McConfig c = baseMc();
    c.frame = mc::FrameType::E4;
    c.tags = {bindMc(0, "D0", TagType::INT16)};
    McRig r(c);
    r.start();
    r.run(1100);
    McFault route;
    route.kind = McFault::BadRoute;
    r.plc.addFault(route);
    McFault serial;
    serial.kind = McFault::BadSerial;
    r.run(1000);
    r.plc.addFault(serial);
    r.run(6000);  // two timeouts: the probes come 1 s, then 2 s after them
    const auto d = r.diag();
    EXPECT_EQ(d.devices[0].badFrames.unit, 1u);
    EXPECT_EQ(d.devices[0].badFrames.tid, 1u);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
}

TEST(McDriver, GarbageAndSplitDelivery) {
    McConfig c = baseMc();
    c.tags = {bindMc(0, "D0", TagType::INT16)};
    McRig r(c);
    r.plc.setWord(255, Device::D, 0, 5);
    McFault split;
    split.kind = McFault::Split;
    split.count = 3;
    r.plc.addFault(split);
    r.start();
    r.run(1100);
    EXPECT_EQ(r.last(0)->value, TagScalar(int64_t{5}));
    McFault g;
    g.kind = McFault::Garbage;
    r.plc.addFault(g);
    r.run(1000);
    EXPECT_EQ(r.diag().channel.lastErrorCode, "BAD_FRAME");
    r.run(3000);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
    EXPECT_EQ(r.plc.connections, 2);
}

TEST(McDriver, DisabledDeviceAndChannel) {
    McConfig c = baseMc(2);
    c.devices[1].enabled = false;
    c.tags = {bindMc(0, "D0", TagType::INT16, 0, 0), bindMc(1, "D0", TagType::INT16, 0, 1)};
    McRig r(c);
    r.start();
    r.run(1100);
    EXPECT_EQ(r.last(1)->reason, "DISABLED");
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
    for (const auto& q : r.plc.requests()) EXPECT_EQ(q.station, 255);
}
