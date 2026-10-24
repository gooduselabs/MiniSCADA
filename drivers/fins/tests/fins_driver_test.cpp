// The FINS driver on a fake PLC (feature 018, T020, T021): the standard driver suite over UDP and
// TCP, the read plan (0101 blocks, 0104 for scattered Tags), end codes, lost and late datagrams,
// the TCP node handshake and writes.
#include "drivers/fins/fins_driver.hpp"

#include <gtest/gtest.h>

#include <memory>

#include "drivers/fins/tests/fake_fins_plc.hpp"
#include "drivers/sdk/tests/driver_conformance.hpp"

namespace mat::testing {
namespace {

fins::Address addr(const std::string& a, TagType raw, int stringLength = 0, bool rw = true) {
    fins::AddressOptions o;
    o.rawType = raw;
    o.stringLength = stringLength;
    o.rw = rw;
    fins::Address r = fins::parseAddress(a, o);
    if (!r.ok) {
        o.rw = false;
        r = fins::parseAddress(a, o);
    }
    EXPECT_TRUE(r.ok) << a << " " << r.error;
    return r;
}

drv::FinsTagBinding bind(size_t tag, const std::string& a, TagType raw, int stringLength = 0,
                         uint32_t device = 0) {
    drv::FinsTagBinding b;
    b.tag = tag;
    b.device = device;
    b.addr = addr(a, raw, stringLength);
    b.rawType = raw;
    b.stringLength = stringLength;
    return b;
}

drv::FinsConfig baseConfig(bool tcp, size_t devices = 1) {
    drv::FinsConfig c;
    c.channelId = "omron1";
    c.host = "192.168.1.10";
    c.tcp = tcp;
    c.sourceNode = tcp ? 0 : 5;
    for (size_t i = 0; i < devices; ++i) {
        drv::FinsDeviceConfig d;
        d.id = "plc" + std::to_string(i);
        d.node = tcp ? 0 : 10;
        d.unit = static_cast<int>(i);
        d.retries = tcp ? 0 : 1;
        c.devices.push_back(d);
    }
    return c;
}

// A driver on the fake PLC and clock, in manual mode.
struct FinsRig {
    explicit FinsRig(drv::FinsConfig c, uint8_t firstSid = 0x40) : cfg(std::move(c)) {
        drv::FinsEnv env;
        env.manual = true;
        env.clock = &clock;
        env.uniform = [] { return 0.0; };
        env.firstSid = [firstSid] { return firstSid; };
        env.sleep = [this](int64_t t) { clock.set(t); };
        const bool tcp = cfg.tcp;
        env.makeTransport = [this, tcp] {
            return std::unique_ptr<drv::Transport>(new FakeFinsTransport(plc, clock, tcp));
        };
        drv = std::make_unique<drv::FinsDriver>(cfg, env);
    }
    ~FinsRig() { drv->stop(); }
    void start() { drv->start(sink); }
    void run(int64_t ms) { drv->pump(clock.monoMs() + ms); }
    drv::DriverDiag diag() const {
        drv::DriverDiag d;
        drv->diagnostics(d, clock.monoMs());
        return d;
    }
    std::optional<drv::TagUpdate> last(size_t tag) { return sink.last(tag); }

    FinsClock clock;
    FakeFinsPlc plc;
    drv::conformance::RecordingSink sink;
    drv::FinsConfig cfg;
    std::unique_ptr<drv::FinsDriver> drv;
};

// ---- the standard driver suite --------------------------------------------------------------

class FinsHarness : public drv::conformance::Harness {
   public:
    FinsHarness(bool tcp, bool enabled, bool writable) : tcp_(tcp), writable_(writable) {
        cfg_ = baseConfig(tcp);
        cfg_.enabled = enabled;
        cfg_.tags = {
            bind(0, "CIO0.00", TagType::BOOL),   bind(1, "D0.05", TagType::BOOL),
            bind(2, "D1", TagType::INT16),       bind(3, "D10", TagType::UINT32),
            bind(4, "D30", TagType::FLOAT32),    bind(5, "D40", TagType::INT64),
            bind(6, "D70", TagType::FLOAT64),    bind(7, "D80", TagType::STRING, 8),
            bind(8, "T5", TagType::BOOL),        bind(9, "C12", TagType::UINT16),
            bind(10, "E0_100", TagType::UINT16), bind(11, "W5.00", TagType::BOOL),
        };
        cfg_.tags[9].bcd = true;
        plc_.setWord(0xB0, 0, 0x0001);
        plc_.setWord(0x82, 0, 0x0020);
        plc_.setWord(0x82, 1, 64302);
        plc_.setWords(0x82, 10, {0x2800, 0xEE6B});
        plc_.setWords(0x82, 30, {0xE979, 0x42F6});
        plc_.setWords(0x82, 40, {0x0708, 0x0506, 0x0304, 0x0102});
        plc_.setWords(0x82, 70, {0x2D18, 0x5444, 0x21FB, 0x4009});
        plc_.setWords(0x82, 80, {0x42C6, 0xA16D, 0x2031, 0x0000});
        plc_.setFlag(5, true);
        plc_.setWord(0x89, 0x8000 + 12, 0x1234);
        plc_.setWord(0xA0, 100, 777);
        plc_.setWord(0xB1, 5, 0x0001);
        drv::FinsEnv env;
        env.manual = true;
        env.clock = &clock_;
        env.uniform = [] { return 0.0; };
        env.firstSid = [] { return static_cast<uint8_t>(7); };
        env.sleep = [this](int64_t t) { clock_.set(t); };
        env.makeTransport = [this] {
            return std::unique_ptr<drv::Transport>(new FakeFinsTransport(plc_, clock_, tcp_));
        };
        drv_ = std::make_unique<drv::FinsDriver>(cfg_, env);
    }
    drv::Driver& driver() override { return *drv_; }
    size_t tagCount() const override { return cfg_.tags.size(); }
    TagType tagType(size_t t) const override { return cfg_.tags[t].rawType; }
    TagScalar backendValue(size_t t) const override {
        switch (t) {
            case 0:
            case 1:
            case 8:
            case 11:
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
            case 7:
                return std::string("Bơm 1");
            case 9:
                return uint64_t{1234};
            default:
                return uint64_t{777};
        }
    }
    void advance(int64_t ms) override { drv_->pump(clock_.monoMs() + ms); }
    int64_t cycleMs() const override { return 1000; }
    bool supportsFaults() const override { return true; }
    void setBackendResponding(bool on) override { plc_.responding = on; }
    bool supportsDisabled() const override { return true; }
    std::unique_ptr<drv::conformance::Harness> makeDisabled() override {
        return std::make_unique<FinsHarness>(tcp_, false, writable_);
    }
    uint64_t bytesOnWire() const override {
        return plc_.bytesIn + plc_.bytesOut + static_cast<uint64_t>(plc_.connectAttempts);
    }
    bool supportsDiagnostics() const override { return true; }
    void injectTimeouts(int count) override {
        FinsFault f;
        f.kind = FinsFault::Silent;
        f.count = count;
        plc_.addFault(f);
    }
    std::vector<size_t> writableTags() const override {
        return writable_ ? std::vector<size_t>{0, 1, 2, 3, 4, 7, 9, 11} : std::vector<size_t>{};
    }
    TagScalar writeValue(size_t t) const override {
        switch (t) {
            case 0:
            case 1:
            case 11:
                return false;
            case 2:
                return int64_t{4321};
            case 3:
                return uint64_t{123456789};
            case 4:
                return static_cast<double>(1.5f);
            case 9:
                return uint64_t{4321};
            default:
                return std::string("Van 2");
        }
    }

   private:
    bool tcp_;
    bool writable_;
    FinsClock clock_;
    FakeFinsPlc plc_;
    drv::FinsConfig cfg_;
    std::unique_ptr<drv::FinsDriver> drv_;
};

struct FinsUdpTraits {
    static std::unique_ptr<drv::conformance::Harness> make() {
        return std::make_unique<FinsHarness>(false, true, true);
    }
};
struct FinsTcpTraits {
    static std::unique_ptr<drv::conformance::Harness> make() {
        return std::make_unique<FinsHarness>(true, true, true);
    }
};

}  // namespace
}  // namespace mat::testing

namespace mat::drv::conformance {
using FinsDrivers = ::testing::Types<mat::testing::FinsUdpTraits, mat::testing::FinsTcpTraits>;
INSTANTIATE_TYPED_TEST_SUITE_P(Fins, DriverConformance, FinsDrivers);
}  // namespace mat::drv::conformance

namespace mat::testing {
namespace {

// ---- the read plan --------------------------------------------------------------------------

TEST(FinsDriver, ContiguousTagsAreOneReadAndScatteredOnesGoIntoMultipleReads) {
    drv::FinsConfig c = baseConfig(false);
    size_t tag = 0;
    for (int a = 100; a < 200; ++a)
        c.tags.push_back(bind(tag++, "D" + std::to_string(a), TagType::UINT16));
    for (int k = 0; k < 130; ++k)
        c.tags.push_back(bind(tag++, "D" + std::to_string(1000 + 20 * k), TagType::INT16));
    FinsRig r(c);
    r.start();
    r.run(10);
    const auto plan = r.drv->plannedRequests(0, 1);
    ASSERT_EQ(plan.size(), 4u);  // D100-D199, then 130 small blocks in 64 + 64 + 2
    EXPECT_FALSE(plan[0].multi);
    EXPECT_EQ(plan[0].code, 0x82);
    EXPECT_EQ(plan[0].start, 100);
    EXPECT_EQ(plan[0].count, 100);
    EXPECT_TRUE(plan[1].multi);
    EXPECT_EQ(plan[1].count, 64);
    EXPECT_EQ(plan[2].count, 64);
    EXPECT_EQ(plan[3].count, 2);
    for (size_t t = 0; t < tag; ++t) {
        const auto u = r.last(t);
        ASSERT_TRUE(u.has_value()) << t;
        EXPECT_EQ(u->quality, Quality::GOOD) << t;
    }
    EXPECT_EQ(r.plc.countOf(0x0104), 3u);
    EXPECT_EQ(r.plc.countOf(0x0101), 1u);
}

TEST(FinsDriver, ReadsRespectMaxReadWordsAndAGapAboveMaxGapSplits) {
    drv::FinsConfig c = baseConfig(false);
    c.devices[0].maxReadWords = 50;
    c.devices[0].maxGapWords = 0;
    c.devices[0].multiRead = false;
    for (int a = 0; a < 60; ++a)
        c.tags.push_back(bind(static_cast<size_t>(a), "D" + std::to_string(a), TagType::UINT16));
    c.tags.push_back(bind(60, "D70", TagType::UINT16));
    FinsRig r(c);
    r.start();
    r.run(10);
    const auto plan = r.drv->plannedRequests(0, 1);
    ASSERT_EQ(plan.size(), 3u);
    EXPECT_EQ(plan[0].start, 0);
    EXPECT_EQ(plan[0].count, 50);
    EXPECT_EQ(plan[1].start, 50);
    EXPECT_EQ(plan[1].count, 10);
    EXPECT_EQ(plan[2].start, 70);
    EXPECT_EQ(plan[2].count, 1);
    for (size_t t = 0; t <= 60; ++t) EXPECT_EQ(r.last(t)->quality, Quality::GOOD) << t;
}

TEST(FinsDriver, FlagsAreReadWithTheBitCodeAndCountersFromTheirOffset) {
    drv::FinsConfig c = baseConfig(false);
    c.devices[0].multiRead = false;
    c.tags = {bind(0, "T5", TagType::BOOL), bind(1, "T6", TagType::BOOL),
              bind(2, "C12", TagType::UINT16)};
    FinsRig r(c);
    r.plc.setFlag(6, true);
    r.plc.setWord(0x89, 0x8000 + 12, 42);
    r.start();
    r.run(10);
    EXPECT_EQ(r.last(0)->value, TagScalar(false));
    EXPECT_EQ(r.last(1)->value, TagScalar(true));
    EXPECT_EQ(r.last(2)->value, TagScalar(uint64_t{42}));
    bool sawFlags = false, sawCounter = false;
    for (const auto& q : r.plc.requests()) {
        if (q.command == 0x0101 && q.code == 0x09 && q.address == 5 && q.count == 2)
            sawFlags = true;
        if (q.command == 0x0101 && q.code == 0x89 && q.address == 0x800C) sawCounter = true;
    }
    EXPECT_TRUE(sawFlags);
    EXPECT_TRUE(sawCounter);
}

// ---- end codes --------------------------------------------------------------------------------

TEST(FinsDriver, AddressEndCodeOnABlockSplitsItUntilOnlyTheBadTagIsBad) {
    drv::FinsConfig c = baseConfig(false);
    c.devices[0].multiRead = false;
    c.tags = {bind(0, "D0", TagType::UINT16), bind(1, "D4", TagType::UINT16),
              bind(2, "D8", TagType::UINT16)};
    FinsRig r(c);
    r.plc.limit[0x82] = 8;  // D8 is outside this PLC's DM
    r.plc.setWord(0x82, 0, 11);
    r.plc.setWord(0x82, 4, 44);
    r.start();
    r.run(5000);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
    EXPECT_EQ(r.last(0)->value, TagScalar(uint64_t{11}));
    EXPECT_EQ(r.last(1)->quality, Quality::GOOD);
    EXPECT_EQ(r.last(2)->quality, Quality::BAD);
    EXPECT_EQ(r.last(2)->reason, "FINS_ADDRESS");
    const auto d = r.diag();
    EXPECT_GE(d.devices[0].exceptions.at(0x1103), 1u);
    EXPECT_EQ(d.devices[0].state, "active");
}

TEST(FinsDriver, AddressEndCodeOnAMultipleReadGoesBackToOneReadPerBlock) {
    drv::FinsConfig c = baseConfig(false);
    c.tags = {bind(0, "D0", TagType::UINT16), bind(1, "D100", TagType::UINT16),
              bind(2, "D9000", TagType::UINT16)};
    FinsRig r(c);
    r.plc.limit[0x82] = 5000;
    r.start();
    r.run(10);
    ASSERT_EQ(r.drv->plannedRequests(0, 1).size(), 3u);
    r.run(3000);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
    EXPECT_EQ(r.last(1)->quality, Quality::GOOD);
    EXPECT_EQ(r.last(2)->reason, "FINS_ADDRESS");
}

TEST(FinsDriver, OtherEndCodesMakeTheTagsBadWithTheirReason) {
    drv::FinsConfig c = baseConfig(false);
    c.tags = {bind(0, "D0", TagType::UINT16)};
    FinsRig r(c);
    FinsFault f;
    f.kind = FinsFault::EndCode;
    f.endCode = 0x2002;
    f.count = 1;
    r.plc.addFault(f);
    r.start();
    r.run(10);
    EXPECT_EQ(r.last(0)->reason, "FINS_READ_DENIED");
    r.run(1500);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
}

TEST(FinsDriver, UnreachableDestinationPutsTheDeviceInError) {
    drv::FinsConfig c = baseConfig(false);
    c.tags = {bind(0, "D0", TagType::UINT16)};
    FinsRig r(c);
    FinsFault f;
    f.kind = FinsFault::EndCode;
    f.endCode = 0x0201;
    f.count = 1;
    r.plc.addFault(f);
    r.start();
    r.run(10);
    EXPECT_EQ(r.last(0)->reason, "FINS_ROUTING");
    EXPECT_EQ(r.drv->linkState(0).device, drv::DeviceState::Error);
    EXPECT_EQ(r.diag().channel.lastErrorCode, "FINS_ROUTING");
}

TEST(FinsDriver, PlcErrorFlagsOnANormalEndAreStillGoodData) {
    drv::FinsConfig c = baseConfig(false);
    c.tags = {bind(0, "D0", TagType::UINT16)};
    FinsRig r(c);
    r.plc.plcStatus = 0x40;
    r.plc.setWord(0x82, 0, 9);
    r.start();
    r.run(10);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
    EXPECT_EQ(r.last(0)->value, TagScalar(uint64_t{9}));
}

// ---- lost, late and wrong datagrams -------------------------------------------------------

TEST(FinsDriver, ALostDatagramIsSentAgainWithANewSid) {
    drv::FinsConfig c = baseConfig(false);
    c.tags = {bind(0, "D0", TagType::UINT16)};
    FinsRig r(c);
    FinsFault f;
    f.kind = FinsFault::Silent;
    f.count = 1;
    r.plc.addFault(f);
    r.start();
    r.run(10);
    const auto reqs = r.plc.requests();
    ASSERT_GE(reqs.size(), 2u);
    EXPECT_NE(reqs[0].sid, reqs[1].sid);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
    EXPECT_EQ(r.diag().devices[0].timeouts, 1u);
}

TEST(FinsDriver, ALateAnswerWithTheOldSidIsDroppedAndCounted) {
    drv::FinsConfig c = baseConfig(false);
    c.tags = {bind(0, "D0", TagType::UINT16)};
    FinsRig r(c);
    FinsFault f;
    f.kind = FinsFault::Late;
    f.delayMs = 1500;  // after the 1000 ms timeout, during the second attempt
    f.count = 1;
    r.plc.addFault(f);
    r.plc.setWord(0x82, 0, 5);
    r.start();
    r.run(3000);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
    const auto d = r.diag();
    EXPECT_EQ(d.devices[0].timeouts, 1u);
    EXPECT_GE(d.devices[0].badFrames.tid, 1u);
}

TEST(FinsDriver, AnAnswerFromAnotherNodeOrSidIsDroppedAndTheRightOneTaken) {
    drv::FinsConfig c = baseConfig(false);
    c.tags = {bind(0, "D0", TagType::UINT16)};
    FinsRig r(c);
    FinsFault a;
    a.kind = FinsFault::BadSid;
    r.plc.addFault(a);
    FinsFault b;
    b.kind = FinsFault::BadNode;
    b.skip = 0;
    r.plc.addFault(b);
    r.start();
    r.run(1500);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
    const auto d = r.diag();
    EXPECT_EQ(d.devices[0].badFrames.tid, 1u);
    EXPECT_EQ(d.devices[0].badFrames.unit, 1u);
    EXPECT_EQ(d.devices[0].timeouts, 0u);
}

TEST(FinsDriver, ADeadPlcGivesTimeoutThenDisconnectedAndComesBack) {
    drv::FinsConfig c = baseConfig(false);
    c.tags = {bind(0, "D0", TagType::UINT16)};
    FinsRig r(c);
    r.start();
    r.run(10);
    r.plc.responding = false;
    r.run(2500);
    EXPECT_EQ(r.last(0)->reason, "TIMEOUT");
    EXPECT_EQ(r.drv->linkState(0).device, drv::DeviceState::Suspended);
    r.run(20000);
    EXPECT_EQ(r.diag().channel.lastErrorCode, "TIMEOUT");
    r.plc.responding = true;
    r.run(40000);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
    EXPECT_EQ(r.drv->linkState(0).channel, drv::ChannelState::Connected);
}

// ---- TCP --------------------------------------------------------------------------------------

TEST(FinsDriverTcp, TheHandshakeGivesTheNodes) {
    drv::FinsConfig c = baseConfig(true);
    c.tags = {bind(0, "D0", TagType::UINT16)};
    FinsRig r(c);
    r.plc.clientNode = 0x21;
    r.plc.node = 0x0A;
    r.start();
    r.run(10);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
    const auto reqs = r.plc.requests();
    ASSERT_FALSE(reqs.empty());
    EXPECT_EQ(reqs[0].sa1, 0x21);
    EXPECT_EQ(reqs[0].da1, 0x0A);
}

TEST(FinsDriverTcp, ARefusedHandshakeIsRefusedWithItsCode) {
    drv::FinsConfig c = baseConfig(true);
    c.tags = {bind(0, "D0", TagType::UINT16)};
    FinsRig r(c);
    r.plc.tcpError = 0x20;  // all connections are in use
    r.start();
    r.run(10);
    EXPECT_EQ(r.last(0)->reason, "REFUSED");
    EXPECT_EQ(r.diag().channel.lastErrorCode, "FINS_TCP_REFUSED");
    r.plc.tcpError = 0;
    r.run(3000);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
}

TEST(FinsDriverTcp, GarbageOnTheStreamClosesTheConnection) {
    drv::FinsConfig c = baseConfig(true);
    c.tags = {bind(0, "D0", TagType::UINT16)};
    FinsRig r(c);
    FinsFault f;
    f.kind = FinsFault::Garbage;
    r.plc.addFault(f);
    r.start();
    r.run(10);
    EXPECT_EQ(r.last(0)->reason, "BAD_FRAME");
    EXPECT_EQ(r.diag().channel.lastErrorCode, "BAD_FRAME");
    r.run(3000);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
    EXPECT_GE(r.plc.connectAttempts, 2);
}

TEST(FinsDriverTcp, APlcThatClosesIsConnectedAgain) {
    drv::FinsConfig c = baseConfig(true);
    c.tags = {bind(0, "D0", TagType::UINT16)};
    FinsRig r(c);
    FinsFault f;
    f.kind = FinsFault::Close;
    r.plc.addFault(f);
    r.start();
    r.run(10);
    EXPECT_EQ(r.last(0)->reason, "DISCONNECTED");
    r.run(3000);
    EXPECT_EQ(r.last(0)->quality, Quality::GOOD);
}

// ---- writes -----------------------------------------------------------------------------------

drv::WriteCommand cmd(uint64_t id, size_t tag, TagScalar v) {
    drv::WriteCommand c;
    c.id = id;
    c.tag = tag;
    c.raw = std::move(v);
    return c;
}

TEST(FinsDriverWrite, ABitIsWrittenWithTheBitCodeAndOneByte) {
    drv::FinsConfig c = baseConfig(false);
    c.tags = {bind(0, "W5.03", TagType::BOOL)};
    FinsRig r(c);
    r.start();
    r.run(10);
    ASSERT_TRUE(r.drv->enqueueWrite(cmd(1, 0, true)));
    r.run(100);
    const auto res = r.sink.takeResults();
    ASSERT_EQ(res.size(), 1u);
    EXPECT_EQ(res[0].code, "CONFIRMED");
    EXPECT_EQ(r.plc.word(0xB1, 5), 0x0008);
    bool saw = false;
    for (const auto& q : r.plc.requests())
        if (q.command == 0x0102) {
            saw = true;
            EXPECT_EQ(q.code, 0x31);
            EXPECT_EQ(q.bit, 3);
            EXPECT_EQ(q.count, 1);
            EXPECT_EQ(q.data, Bytes{1});
        }
    EXPECT_TRUE(saw);
    EXPECT_EQ(r.last(0)->value, TagScalar(true));
}

TEST(FinsDriverWrite, BcdIsWrittenAsBcdAndTooManyDigitsAreNotSent) {
    drv::FinsConfig c = baseConfig(false);
    c.tags = {bind(0, "D300", TagType::UINT16), bind(1, "D310", TagType::UINT32)};
    c.tags[0].bcd = true;
    c.tags[1].bcd = true;
    FinsRig r(c);
    r.start();
    r.run(10);
    ASSERT_TRUE(r.drv->enqueueWrite(cmd(1, 0, uint64_t{1234})));
    ASSERT_TRUE(r.drv->enqueueWrite(cmd(2, 1, uint64_t{12345678})));
    ASSERT_TRUE(r.drv->enqueueWrite(cmd(3, 0, uint64_t{10000})));
    r.run(200);
    const auto res = r.sink.takeResults();
    ASSERT_EQ(res.size(), 3u);
    EXPECT_EQ(res[0].code, "CONFIRMED");
    EXPECT_EQ(res[1].code, "CONFIRMED");
    EXPECT_EQ(res[2].code, "NOT_SENT_UNSUPPORTED");
    EXPECT_EQ(r.plc.word(0x82, 300), 0x1234);
    EXPECT_EQ(r.plc.word(0x82, 310), 0x5678);
    EXPECT_EQ(r.plc.word(0x82, 311), 0x1234);
    EXPECT_EQ(res[0].readback, TagScalar(uint64_t{1234}));
}

TEST(FinsDriverWrite, AnEndCodeIsADeviceExceptionAndTheWriteIsNotSentAgain) {
    drv::FinsConfig c = baseConfig(false);
    c.tags = {bind(0, "D0", TagType::INT16)};
    FinsRig r(c);
    FinsFault f;
    f.kind = FinsFault::EndCode;
    f.endCode = 0x2101;
    f.command = 0x0102;
    r.plc.addFault(f);
    r.start();
    r.run(10);
    ASSERT_TRUE(r.drv->enqueueWrite(cmd(1, 0, int64_t{-5})));
    r.run(3000);
    const auto res = r.sink.takeResults();
    ASSERT_EQ(res.size(), 1u);
    EXPECT_EQ(res[0].code, "DEVICE_EXCEPTION");
    EXPECT_EQ(res[0].exception, 0x2101);
    EXPECT_EQ(r.plc.countOf(0x0102), 1u);
}

TEST(FinsDriverWrite, ALostWriteIsAWriteTimeoutAndNeverResent) {
    drv::FinsConfig c = baseConfig(false);
    c.tags = {bind(0, "D0", TagType::INT16)};
    FinsRig r(c);
    r.start();
    r.run(10);
    FinsFault f;
    f.kind = FinsFault::Silent;
    f.command = 0x0102;
    r.plc.addFault(f);
    ASSERT_TRUE(r.drv->enqueueWrite(cmd(1, 0, int64_t{7})));
    r.run(5000);
    const auto res = r.sink.takeResults();
    ASSERT_EQ(res.size(), 1u);
    EXPECT_EQ(res[0].code, "WRITE_TIMEOUT");
    EXPECT_EQ(r.plc.countOf(0x0102), 1u);
}

TEST(FinsDriverWrite, AFlagOrAReadOnlyAuxiliaryWordIsNotWritten) {
    drv::FinsConfig c = baseConfig(false);
    c.tags = {bind(0, "T5", TagType::BOOL)};
    FinsRig r(c);
    r.start();
    r.run(10);
    ASSERT_TRUE(r.drv->enqueueWrite(cmd(1, 0, true)));
    r.run(100);
    const auto res = r.sink.takeResults();
    ASSERT_EQ(res.size(), 1u);
    EXPECT_EQ(res[0].code, "NOT_SENT_UNSUPPORTED");
    EXPECT_EQ(r.plc.countOf(0x0102), 0u);
}

// ---- the connection test --------------------------------------------------------------------

TEST(FinsProbe, ControllerDataReadGivesTheModel) {
    FinsClock clock;
    FakeFinsPlc plc;
    FakeFinsTransport t(plc, clock, true);
    drv::FinsProbeRequest req;
    req.host = "192.168.1.10";
    req.tcp = true;
    const drv::FinsProbeOutcome o = drv::probeFins(req, t, clock);
    EXPECT_EQ(o.base.code, "OK");
    EXPECT_EQ(o.model, "CJ2M-CPU31");
    EXPECT_EQ(o.clientNode, 5);
    EXPECT_EQ(o.serverNode, 10);
}

TEST(FinsProbe, AReadGivesTheWordsAndAnEndCodeIsReported) {
    FinsClock clock;
    FakeFinsPlc plc;
    plc.setWords(0x82, 100, {1, 2});
    FakeFinsTransport t(plc, clock, false);
    drv::FinsProbeRequest req;
    req.host = "192.168.1.10";
    req.src.node = 5;
    req.dst.node = 10;
    req.read = true;
    req.addr = addr("D100", TagType::UINT16);
    req.count = 2;
    drv::FinsProbeOutcome o = drv::probeFins(req, t, clock);
    EXPECT_EQ(o.base.code, "OK");
    EXPECT_EQ(o.base.registers, (std::vector<uint16_t>{1, 2}));
    plc.limit[0x82] = 50;
    FakeFinsTransport t2(plc, clock, false);
    o = drv::probeFins(req, t2, clock);
    EXPECT_EQ(o.base.code, "END_CODE");
    EXPECT_EQ(o.endCode, 0x1103);
    plc.responding = false;
    FakeFinsTransport t3(plc, clock, false);
    o = drv::probeFins(req, t3, clock);
    EXPECT_EQ(o.base.code, "TIMEOUT");
}

}  // namespace
}  // namespace mat::testing
