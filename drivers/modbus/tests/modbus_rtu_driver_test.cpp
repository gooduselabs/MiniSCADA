// The Modbus RTU driver (specs/006 T163; FR-027, FR-033 to FR-035; US3-2 to US3-5; contracts/
// modbus-driver.md §3-§5, §10, §11): the standard driver suite on a fake RS485 line, a device that
// does not answer (suspended after 3 requests, probed every 10 s, the others keep their cycle),
// frames that are wrong (dropped, counted, no Tag updated), the console and ports out of the list,
// writes and their readback, the connection test, and runs on a real serial port (a pty) with
// threads.
#include "drivers/modbus/modbus_rtu_driver.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <thread>

#include "drivers/modbus/rtu_frame.hpp"
#include "drivers/modbus/test_probe.hpp"
#include "drivers/modbus/tests/fake_plc.hpp"
#include "drivers/modbus/tests/rtu_harness.hpp"
#include "drivers/sdk/serial_port.hpp"
#include "drivers/sdk/tests/driver_conformance.hpp"

using namespace mat;
using namespace mat::drv;
using namespace mat::testing;
using namespace mat::drv::conformance;
using modbus::Area;

// ---------------------------------------------------------------------------------------------
// The standard driver suite (T048) with modbus-rtu: item 4 (writes at driver level) with the
// writable Tags.

namespace {

struct RtuTraits {
    static std::unique_ptr<Harness> make() { return std::make_unique<RtuHarness>(); }
};
struct RtuWriteTraits {
    static std::unique_ptr<Harness> make() { return std::make_unique<RtuHarness>(true, true); }
};

// Three slaves with two Tags each (HR 0 and 1): Tag = 2 * slave + k.
drv::ModbusTcpConfig threeSlaves(int timeoutMs = 100, int retries = 1) {
    auto c = rtuConfig(3);
    for (auto& d : c.devices) {
        d.timeoutMs = timeoutMs;
        d.retries = retries;
    }
    for (size_t s = 0; s < 3; ++s)
        for (size_t k = 0; k < 2; ++k)
            c.tags.push_back(bind(s * 2 + k, static_cast<uint32_t>(s), Area::HR,
                                  static_cast<int>(k), TagType::UINT16));
    return c;
}

void fillSlaves(FakePlc& plc) {
    for (int u = 1; u <= 3; ++u)
        for (int k = 0; k < 2; ++k) plc.set(u, Area::HR, k, static_cast<uint16_t>(u * 100 + k));
}

WriteCommand cmd(uint64_t id, size_t tag, TagScalar raw, bool readback = true) {
    WriteCommand c;
    c.id = id;
    c.tag = tag;
    c.raw = std::move(raw);
    c.readback = readback;
    return c;
}

}  // namespace

INSTANTIATE_TYPED_TEST_SUITE_P(ModbusRtu, DriverConformance, RtuTraits);
INSTANTIATE_TYPED_TEST_SUITE_P(ModbusRtuWrite, DriverConformance, RtuWriteTraits);

// ---------------------------------------------------------------------------------------------
// Suspension (FR-027, US3-2)

TEST(ModbusRtuDriver, ASlaveThatDoesNotAnswerIsSuspendedAndTheOthersKeepTheirCycle) {
    RtuRig r(threeSlaves());
    fillSlaves(r.plc);
    r.start();
    r.run(1000);
    for (size_t t = 0; t < 6; ++t) EXPECT_EQ(r.lastState(t), "GOOD") << t;
    EXPECT_EQ(r.diag().devices[1].state, "active");

    r.plc.knownUnits = {1, 3};  // slave 2 is silent
    r.run(4000);
    EXPECT_EQ(r.diag().devices[1].state, "suspended");
    EXPECT_EQ(r.drv->linkState(1).device, DeviceState::Suspended);
    EXPECT_EQ(r.drv->linkState(0).device, DeviceState::Active);
    EXPECT_EQ(r.lastState(2), "BAD DEVICE_SUSPENDED");
    EXPECT_EQ(r.lastState(3), "BAD DEVICE_SUSPENDED");
    // the channel itself is fine: the port stays open
    EXPECT_EQ(r.diag().channel.state, "connected");
    EXPECT_EQ(r.drv->linkState(0).channel, ChannelState::Connected);

    // slaves 1 and 3 keep their 200 ms cycle while slave 2 is suspended
    const size_t u1 = r.plc.requestCount(-1, 1), u3 = r.plc.requestCount(-1, 3);
    const size_t u2 = r.plc.requestCount(-1, 2);
    r.run(5000);
    EXPECT_GE(r.plc.requestCount(-1, 1) - u1, 22u);
    EXPECT_GE(r.plc.requestCount(-1, 3) - u3, 22u);
    EXPECT_EQ(r.lastState(0), "GOOD");
    EXPECT_EQ(r.lastState(5), "GOOD");
    // and slave 2 is only probed: nothing in 5 s (the probe is every 10 s)
    EXPECT_LE(r.plc.requestCount(-1, 2) - u2, 4u);
}

TEST(ModbusRtuDriver, ASuspendedSlaveIsProbedEveryTenSecondsAndComesBackWithin15) {
    RtuRig r(threeSlaves());
    fillSlaves(r.plc);
    r.plc.knownUnits = {1, 3};
    r.start();
    r.run(2000);
    ASSERT_EQ(r.diag().devices[1].state, "suspended");
    const int64_t suspendedAt = r.clock.monoMs();
    const size_t before = r.plc.requestCount(-1, 2);
    r.run(25000);  // two probes at most 10 s apart: two attempts each (retries 1)
    const size_t probes = r.plc.requestCount(-1, 2) - before;
    EXPECT_GE(probes, 4u);
    EXPECT_LE(probes, 6u);
    // times of the probes: gaps of about 10 s
    std::vector<int64_t> at;
    for (const auto& q : r.plc.requests())
        if (q.unit == 2 && q.atMs > suspendedAt) at.push_back(q.atMs);
    ASSERT_GE(at.size(), 4u);
    EXPECT_NEAR(static_cast<double>(at[2] - at[0]), 10000.0, 600.0);

    // the slave is back: its Tags have values within 15 s
    r.plc.knownUnits.clear();
    const int64_t back = r.clock.monoMs();
    int64_t good = -1;
    for (int step = 0; step < 300 && good < 0; ++step) {
        r.run(100);
        if (r.lastState(2) == "GOOD" && r.lastState(3) == "GOOD") good = r.clock.monoMs() - back;
    }
    ASSERT_GE(good, 0) << "the slave did not come back";
    EXPECT_LE(good, 15000);
    EXPECT_EQ(r.diag().devices[1].state, "active");
    EXPECT_EQ(r.drv->linkState(1).device, DeviceState::Active);
    EXPECT_EQ(r.sink.last(2)->value, TagScalar(uint64_t{200}));
}

TEST(ModbusRtuDriver, TwoFailedRequestsAndThenAnAnswerDoNotSuspend) {
    RtuRig r(threeSlaves());
    fillSlaves(r.plc);
    // slave 2: two requests fail (four attempts), the third is answered
    PlcFault f;
    f.kind = PlcFault::Silent;
    f.unit = 2;
    f.count = 4;
    r.plc.addFault(f);
    r.start();
    r.run(3000);
    EXPECT_EQ(r.diag().devices[1].state, "active");
    EXPECT_EQ(r.lastState(2), "GOOD");
    // it did go BAD with the reason on the way
    bool sawTimeout = false;
    for (const auto& u : r.updatesOf(2))
        if (u.quality == Quality::BAD && u.reason == "TIMEOUT") sawTimeout = true;
    EXPECT_TRUE(sawTimeout);
    for (const auto& u : r.updatesOf(2)) EXPECT_NE(u.reason, "DEVICE_SUSPENDED");
}

TEST(ModbusRtuDriver, AnExceptionIsAValidAnswerAndDoesNotCountTowardsSuspension) {
    auto c = rtuConfig();
    c.tags = {bind(0, 0, Area::HR, 0, TagType::UINT16)};
    RtuRig r(c);
    r.plc.set(1, Area::HR, 0, 5);
    PlcFault f;
    f.kind = PlcFault::Exception;
    f.code = 2;
    f.count = 12;
    r.plc.addFault(f);
    r.start();
    r.run(3000);
    EXPECT_EQ(r.diag().devices[0].state, "active");
    EXPECT_EQ(r.lastState(0), "GOOD");  // the faults ran out and the next read is fine
    EXPECT_GE(r.diag().devices[0].exceptions.at(2), 10u);
    bool sawException = false;
    for (const auto& u : r.updatesOf(0))
        if (u.reason == "EXCEPTION_02") sawException = true;
    EXPECT_TRUE(sawException);
    for (const auto& u : r.updatesOf(0)) EXPECT_NE(u.reason, "DEVICE_SUSPENDED");
}

// ---------------------------------------------------------------------------------------------
// Wrong frames (FR-034): dropped, counted, never a value in a Tag

namespace {

struct BadCase {
    RtuFault::Kind kind;
    const char* counter;  // crc | length | format | unit
    int64_t delayMs;
};

uint64_t counterOf(const BadFrameCounts& b, const std::string& name) {
    if (name == "crc") return b.crc;
    if (name == "length") return b.length;
    if (name == "format") return b.format;
    if (name == "unit") return b.unit;
    if (name == "echo") return b.echo;
    return b.tid;
}

}  // namespace

TEST(ModbusRtuDriver, WrongFramesAreDroppedCountedAndNeverUpdateATag) {
    const BadCase cases[] = {{RtuFault::BadCrc, "crc", 0},     {RtuFault::Short, "length", 0},
                             {RtuFault::Extra, "length", 0},   {RtuFault::Split, "length", 0},
                             {RtuFault::Garbage, "length", 0}, {RtuFault::WrongUnit, "unit", 0}};
    for (const BadCase& bc : cases) {
        auto c = rtuConfig();
        c.tags = {bind(0, 0, Area::HR, 0, TagType::UINT16)};
        RtuRig r(c);
        r.plc.set(1, Area::HR, 0, 4242);
        r.setup = [&](FakeRtuTransport& t) {
            RtuFault f;
            f.kind = bc.kind;
            f.count = 2;  // both attempts of one request
            f.skip = 2;   // after a clean first read
            t.faults.push_back(f);
        };
        r.start();
        r.run(1500);
        const auto d = r.diag().devices[0];
        EXPECT_EQ(counterOf(d.badFrames, bc.counter), 2u) << "kind " << bc.kind;
        // the Tag was BAD for it, with a reason; the value never changed to something wrong
        bool bad = false;
        for (const auto& u : r.updatesOf(0)) {
            if (u.quality == Quality::GOOD)
                EXPECT_EQ(u.value, TagScalar(uint64_t{4242})) << "kind " << bc.kind;
            else
                bad = true;
        }
        EXPECT_TRUE(bad) << "kind " << bc.kind;
        EXPECT_EQ(r.lastState(0), "GOOD") << "kind " << bc.kind << " (it recovers)";
        EXPECT_EQ(d.state, "active");
    }
}

TEST(ModbusRtuDriver, AFrameThatArrivesAfterTheTimeoutIsThrownAwayNotTakenForTheNextAnswer) {
    auto c = rtuConfig();
    c.tags = {bind(0, 0, Area::HR, 0, TagType::UINT16), bind(1, 0, Area::HR, 1, TagType::UINT16)};
    c.devices[0].timeoutMs = 100;
    RtuRig r(c);
    r.plc.set(1, Area::HR, 0, 11);
    r.plc.set(1, Area::HR, 1, 22);
    r.setup = [](FakeRtuTransport& t) {
        RtuFault f;
        f.kind = RtuFault::Late;
        f.delayMs = 130;  // after the 100 ms of the first attempt, inside the next quiet wait
        f.count = 1;
        t.faults.push_back(f);
    };
    r.start();
    r.run(2000);
    EXPECT_GE(r.diag().devices[0].timeouts, 1u);
    for (const auto& u : r.updatesOf(0))
        if (u.quality == Quality::GOOD) {
            EXPECT_EQ(u.value, TagScalar(uint64_t{11}));
        }
    for (const auto& u : r.updatesOf(1))
        if (u.quality == Quality::GOOD) {
            EXPECT_EQ(u.value, TagScalar(uint64_t{22}));
        }
}

TEST(ModbusRtuDriver, ARequestIsTriedAgainOnceByDefault) {
    for (int retries : {0, 1, 2}) {
        auto c = rtuConfig();
        c.scanMs = {5000, 5000, 5000};
        c.devices[0].retries = retries;
        c.devices[0].timeoutMs = 100;
        c.tags = {bind(0, 0, Area::HR, 0, TagType::UINT16)};
        RtuRig r(c);
        r.plc.responding = false;
        r.start();
        r.run(1000);
        EXPECT_EQ(r.plc.requestCount(-1, 1), static_cast<size_t>(1 + retries)) << retries;
    }
    EXPECT_EQ(rtuConfig().devices[0].retries, 1);
}

TEST(ModbusRtuDriver, TheEchoOfTheRequestIsDroppedWhenAsked) {
    auto c = rtuConfig();
    c.tags = {bind(0, 0, Area::HR, 0, TagType::UINT16)};
    c.serial->dropEcho = true;
    {
        RtuRig r(c);
        r.plc.set(1, Area::HR, 0, 9);
        r.setup = [](FakeRtuTransport& t) { t.echo = true; };
        r.start();
        r.run(1500);
        EXPECT_EQ(r.lastState(0), "GOOD");
        EXPECT_EQ(r.diag().devices[0].badFrames.echo, 0u);
        EXPECT_EQ(r.diag().devices[0].badFrames.crc, 0u);
    }
    {  // no echo on a line that was said to echo: counted as a bad echo, the Tag is BAD
        RtuRig r(c);
        r.plc.set(1, Area::HR, 0, 9);
        r.start();
        r.run(1500);
        EXPECT_GE(r.diag().devices[0].badFrames.echo, 2u);
        EXPECT_EQ(r.lastState(0).rfind("BAD", 0), 0u);
    }
    {  // the echo is there but nobody asked: it is taken for a frame and is wrong
        c.serial->dropEcho = false;
        RtuRig r(c);
        r.plc.set(1, Area::HR, 0, 9);
        r.setup = [](FakeRtuTransport& t) { t.echo = true; };
        r.start();
        r.run(1500);
        EXPECT_GE(r.diag().devices[0].badFrames.format + r.diag().devices[0].badFrames.length, 1u);
    }
}

TEST(ModbusRtuDriver, TheLineIsQuietForT35BeforeARequestAndNoRequestOverlapsAnAnswer) {
    auto c = threeSlaves();
    RtuRig r(c);
    fillSlaves(r.plc);
    r.start();
    r.run(2000);
    ASSERT_NE(r.transport, nullptr);
    const auto& times = r.transport->sendTimes;
    ASSERT_GE(times.size(), 10u);
    // the fake line answers 5 ms after a request; t3.5 of 9,600 8E1 is 5 ms (rounded up): two
    // requests are never closer than the answer plus the silence
    for (size_t i = 1; i < times.size(); ++i) EXPECT_GE(times[i] - times[i - 1], 10) << i;
}

// ---------------------------------------------------------------------------------------------
// The port (FR-035, US3-4, US3-5)

TEST(ModbusRtuDriver, TheConsoleAndPortsOutOfTheListAreNotOpenedAndTheOtherChannelsRun) {
    for (const char* code : {"PORT_CONSOLE", "PORT_NOT_ALLOWED"}) {
        auto c = rtuConfig();
        c.tags = {bind(0, 0, Area::HR, 0, TagType::UINT16)};
        RtuRig r(c, [code](const std::string& port) { return port == "ttyAS2" ? code : ""; });
        r.plc.set(1, Area::HR, 0, 1);
        r.start();
        r.run(3000);
        EXPECT_EQ(r.plc.connectAttempts, 0) << code << ": the port was opened";
        EXPECT_EQ(r.plc.requestCount(), 0u);
        EXPECT_EQ(r.diag().channel.state, "error");
        EXPECT_EQ(r.diag().channel.lastErrorCode, code);
        EXPECT_GT(r.diag().channel.lastErrorAt, 0);
        EXPECT_EQ(r.lastState(0), std::string("BAD ") + code);
        EXPECT_EQ(r.drv->linkState(0).channel, ChannelState::Error);

        // another channel, another port, in the same process: it runs
        auto c2 = rtuConfig();
        c2.channelId = "rs2";
        c2.serial->port = "ttyAS3";
        c2.tags = {bind(0, 0, Area::HR, 0, TagType::UINT16)};
        RtuRig r2(c2, [code](const std::string& port) { return port == "ttyAS2" ? code : ""; });
        r2.plc.set(1, Area::HR, 0, 1);
        r2.start();
        r2.run(1000);
        EXPECT_EQ(r2.lastState(0), "GOOD");
    }
}

TEST(ModbusRtuDriver, ABusyPortIsAnErrorOfTheChannelThatIsTriedAgainLater) {
    auto c = rtuConfig();
    c.tags = {bind(0, 0, Area::HR, 0, TagType::UINT16)};
    RtuRig r(c);
    r.plc.set(1, Area::HR, 0, 1);
    r.setup = [](FakeRtuTransport& t) { t.openCode = ConnectCode::PortBusy; };
    r.start();
    r.run(1500);
    EXPECT_EQ(r.diag().channel.state, "error");
    EXPECT_EQ(r.diag().channel.lastErrorCode, "PORT_BUSY");
    EXPECT_EQ(r.lastState(0), "BAD PORT_BUSY");
    EXPECT_EQ(r.plc.requestCount(), 0u);
    // the other program lets go of the port
    r.transport->openCode = ConnectCode::Ok;
    r.run(6000);
    EXPECT_EQ(r.lastState(0), "GOOD");
    EXPECT_EQ(r.diag().channel.state, "connected");
    EXPECT_GE(r.diag().channel.reconnects, 0u);
}

TEST(ModbusRtuDriver, WithoutRs485InTheKernelTheChannelWorksInThePlainModeWithAWarning) {
    auto c = rtuConfig();
    c.tags = {bind(0, 0, Area::HR, 0, TagType::UINT16)};
    RtuRig r(c);
    r.plc.set(1, Area::HR, 0, 1);
    r.setup = [](FakeRtuTransport& t) { t.warningsOnOpen = {"RS485_UNSUPPORTED"}; };
    r.start();
    r.run(1000);
    EXPECT_EQ(r.lastState(0), "GOOD");
    const auto w = r.diag().channel.warnings;
    ASSERT_EQ(w.size(), 1u);
    EXPECT_EQ(w[0], "RS485_UNSUPPORTED");
}

TEST(ModbusRtuDriver, ALostPortClosesAndIsOpenedAgain) {
    auto c = rtuConfig();
    c.tags = {bind(0, 0, Area::HR, 0, TagType::UINT16)};
    RtuRig r(c);
    r.plc.set(1, Area::HR, 0, 1);
    r.start();
    r.run(1000);
    ASSERT_EQ(r.lastState(0), "GOOD");
    r.transport->unplugged = true;  // a USB adapter pulled out
    r.run(500);
    EXPECT_EQ(r.lastState(0).rfind("BAD", 0), 0u);
    EXPECT_NE(r.diag().channel.state, "connected");
    r.transport->unplugged = false;
    r.run(8000);
    EXPECT_EQ(r.lastState(0), "GOOD");
    EXPECT_GE(r.diag().channel.reconnects, 1u);
}

TEST(ModbusRtuDriver, ADisabledChannelOrSlaveHasNoTraffic) {
    auto c = threeSlaves();
    c.devices[1].enabled = false;
    RtuRig r(c);
    fillSlaves(r.plc);
    r.start();
    r.run(2000);
    EXPECT_EQ(r.plc.requestCount(-1, 2), 0u);
    EXPECT_EQ(r.lastState(2), "BAD DISABLED");
    EXPECT_EQ(r.lastState(0), "GOOD");
    EXPECT_EQ(r.diag().devices[1].state, "disabled");
}

// ---------------------------------------------------------------------------------------------
// Writes through RTU

TEST(ModbusRtuDriver, WritesGoOutAsRtuFramesAndAreReadBack) {
    auto c = rtuConfig();
    c.tags = {bind(0, 0, Area::HR, 0, TagType::UINT16), bind(1, 0, Area::HR, 10, TagType::UINT32),
              bind(2, 0, Area::C, 3, TagType::BOOL)};
    RtuRig r(c);
    r.plc.set(1, Area::HR, 0, 0);
    r.plc.setRegs(1, Area::HR, 10, {0, 0});
    r.plc.set(1, Area::C, 3, 0);
    std::vector<Bytes> frames;
    r.setup = [&](FakeRtuTransport& t) {
        t.onWrite = [&frames](const Bytes& f) { frames.push_back(f); };
    };
    r.start();
    r.run(300);
    ASSERT_TRUE(r.drv->enqueueWrite(cmd(1, 0, uint64_t{1234})));
    ASSERT_TRUE(r.drv->enqueueWrite(cmd(2, 1, uint64_t{70000})));
    ASSERT_TRUE(r.drv->enqueueWrite(cmd(3, 2, true)));
    r.run(800);
    const auto res = r.sink.takeResults();
    ASSERT_EQ(res.size(), 3u);
    for (const auto& x : res) {
        EXPECT_EQ(x.status, WriteStatus::Confirmed) << x.code;
        EXPECT_EQ(x.code, "CONFIRMED");
    }
    EXPECT_EQ(r.plc.get(1, Area::HR, 0), 1234);
    EXPECT_EQ(r.plc.get(1, Area::HR, 10), 1);
    EXPECT_EQ(r.plc.get(1, Area::HR, 11), 70000 - 65536);
    EXPECT_EQ(r.plc.get(1, Area::C, 3), 1);
    // every frame that went out is a whole RTU frame with its CRC, by the right function
    std::set<int> fcs;
    for (const Bytes& f : frames) {
        ASSERT_GE(f.size(), 4u);
        const uint16_t crc = modbus::crc16(f.data(), f.size() - 2);
        EXPECT_EQ(f[f.size() - 2], crc & 0xFF);
        EXPECT_EQ(f.back(), crc >> 8);
        EXPECT_EQ(f[0], 1);
        fcs.insert(f[1]);
    }
    EXPECT_TRUE(fcs.count(6) && fcs.count(16) && fcs.count(5)) << "fc 6, 16, 5";
}

TEST(ModbusRtuDriver, AWriteToASlaveThatAnswersWithAnExceptionFailsWithTheCode) {
    auto c = rtuConfig();
    c.tags = {bind(0, 0, Area::HR, 0, TagType::UINT16)};
    RtuRig r(c);
    r.plc.set(1, Area::HR, 0, 0);
    r.start();
    r.run(300);
    PlcFault f;
    f.kind = PlcFault::Exception;
    f.code = 3;
    f.fc = 6;
    f.count = 1;
    r.plc.addFault(f);
    ASSERT_TRUE(r.drv->enqueueWrite(cmd(1, 0, uint64_t{5})));
    r.run(500);
    const auto res = r.sink.takeResults();
    ASSERT_EQ(res.size(), 1u);
    EXPECT_EQ(res[0].status, WriteStatus::Failed);
    EXPECT_EQ(res[0].code, "DEVICE_EXCEPTION");
    EXPECT_EQ(res[0].exception, 3);
    EXPECT_EQ(r.diag().devices[0].state, "active");
}

TEST(ModbusRtuDriver, AWriteToASuspendedSlaveIsNotSentAndAWriteThatTimesOutIsNeverRepeated) {
    RtuRig r(threeSlaves());
    fillSlaves(r.plc);
    r.plc.knownUnits = {1, 3};
    r.start();
    r.run(2500);
    ASSERT_EQ(r.diag().devices[1].state, "suspended");
    const size_t before = r.plc.requestCount(-1, 2);
    ASSERT_TRUE(r.drv->enqueueWrite(cmd(1, 2, uint64_t{9})));
    r.run(500);
    auto res = r.sink.takeResults();
    ASSERT_EQ(res.size(), 1u);
    EXPECT_EQ(res[0].status, WriteStatus::Failed);
    EXPECT_EQ(res[0].code, "NOT_SENT_DEVICE_SUSPENDED");
    EXPECT_EQ(r.plc.requestCount(-1, 2), before) << "nothing went to the suspended slave";

    // slave 1 stops answering just as a write goes out: one frame, a timeout, no second send
    r.plc.knownUnits.clear();
    r.run(15000);  // slave 2 is back
    PlcFault f;
    f.kind = PlcFault::Silent;
    f.unit = 1;
    f.fc = 6;
    f.count = 5;
    r.plc.addFault(f);
    size_t w6 = 0;
    ASSERT_TRUE(r.drv->enqueueWrite(cmd(2, 0, uint64_t{77})));
    r.run(1500);
    for (const auto& q : r.plc.requests())
        if (q.fc == 6 && q.unit == 1) ++w6;
    EXPECT_EQ(w6, 1u) << "a write is sent once";
    res = r.sink.takeResults();
    ASSERT_EQ(res.size(), 2u);
    EXPECT_EQ(res[1].status, WriteStatus::Timeout);
    EXPECT_EQ(res[1].code, "WRITE_TIMEOUT");
}

// ---------------------------------------------------------------------------------------------
// Connection test (FR-044, contract §10)

namespace {

RtuProbeRequest probeReq() {
    RtuProbeRequest p;
    p.devicePath = "/dev/ttyAS2";
    p.unit = 1;
    p.timeoutMs = 200;
    p.read = true;
    p.area = Area::HR;
    p.offset = 4;
    p.count = 2;
    return p;
}

}  // namespace

TEST(ModbusRtuProbe, ReadsARegisterRangeAndClosesThePort) {
    FakeClock clock;
    FakePlc plc;
    plc.setRegs(1, Area::HR, 4, {0x1234, 0xABCD});
    FakeRtuTransport t(plc, clock);
    const TestOutcome o = probeModbusRtu(probeReq(), t, clock);
    EXPECT_EQ(o.code, "OK");
    EXPECT_EQ(t.lastPath, "/dev/ttyAS2");
    ASSERT_EQ(o.registers.size(), 2u);
    EXPECT_EQ(o.registers[0], 0x1234);
    EXPECT_EQ(o.registers[1], 0xABCD);
    EXPECT_EQ(o.fc, 3);
    EXPECT_FALSE(o.requestFrame.empty());
    EXPECT_FALSE(o.responseFrame.empty());
    EXPECT_FALSE(t.isOpen());
    EXPECT_GT(o.responseMs, 0);
}

TEST(ModbusRtuProbe, WithoutAReadItOnlyOpensAndCloses) {
    FakeClock clock;
    FakePlc plc;
    FakeRtuTransport t(plc, clock);
    RtuProbeRequest p = probeReq();
    p.read = false;
    EXPECT_EQ(probeModbusRtu(p, t, clock).code, "OK");
    EXPECT_EQ(plc.requestCount(), 0u);
    EXPECT_FALSE(t.isOpen());
}

TEST(ModbusRtuProbe, TheCodesOfTheContract) {
    FakeClock clock;
    {
        FakePlc plc;
        FakeRtuTransport t(plc, clock);
        t.openCode = ConnectCode::PortBusy;
        EXPECT_EQ(probeModbusRtu(probeReq(), t, clock).code, "PORT_BUSY");
        t.openCode = ConnectCode::PortError;
        EXPECT_EQ(probeModbusRtu(probeReq(), t, clock).code, "PORT_ERROR");
    }
    {
        FakePlc plc;  // no slave 1
        plc.responding = false;
        FakeRtuTransport t(plc, clock);
        EXPECT_EQ(probeModbusRtu(probeReq(), t, clock).code, "TIMEOUT");
    }
    {
        FakePlc plc;
        plc.setRegs(1, Area::HR, 4, {1, 2});
        PlcFault f;
        f.kind = PlcFault::Exception;
        f.code = 2;
        plc.addFault(f);
        FakeRtuTransport t(plc, clock);
        const TestOutcome o = probeModbusRtu(probeReq(), t, clock);
        EXPECT_EQ(o.code, "EXCEPTION");
        EXPECT_EQ(o.exception, 2);
    }
    {
        FakePlc plc;
        plc.setRegs(1, Area::HR, 4, {1, 2});
        FakeRtuTransport t(plc, clock);
        RtuFault f;
        f.kind = RtuFault::BadCrc;
        t.faults.push_back(f);
        EXPECT_EQ(probeModbusRtu(probeReq(), t, clock).code, "BAD_FRAME");
    }
    {
        FakePlc plc;
        FakeRtuTransport t(plc, clock);
        RtuProbeRequest p = probeReq();
        p.count = 9;  // 1-4 registers
        EXPECT_EQ(probeModbusRtu(p, t, clock).code, "BAD_REQUEST");
    }
}

TEST(ModbusRtuProbe, AChannelThatHoldsThePortTakesTheTestThroughItsQueue) {
    auto c = rtuConfig();
    c.tags = {bind(0, 0, Area::HR, 0, TagType::UINT16)};
    RtuRig r(c);
    r.plc.set(1, Area::HR, 0, 1);
    r.plc.setRegs(1, Area::HR, 4, {0x0A0B, 0x0C0D});
    r.start();
    r.run(500);
    ASSERT_EQ(r.diag().channel.state, "connected");
    EXPECT_TRUE(r.drv->isRtu());
    SerialLink same;
    same.port = "ttyAS2";
    EXPECT_TRUE(r.drv->sameSerialFrame(same));
    SerialLink other = same;
    other.baud = 19200;
    EXPECT_FALSE(r.drv->sameSerialFrame(other));
    other = same;
    other.parity = 'N';
    EXPECT_FALSE(r.drv->sameSerialFrame(other));
    other = same;
    other.port = "ttyAS3";
    EXPECT_FALSE(r.drv->sameSerialFrame(other));

    const size_t connectsBefore = static_cast<size_t>(r.plc.connectAttempts);
    std::atomic<bool> done{false};
    TestOutcome out;
    std::thread t([&] {
        out = r.drv->probeThroughQueue(probeReq(), 5000);
        done = true;
    });
    for (int i = 0; i < 400 && !done; ++i) {
        r.run(50);
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    t.join();
    ASSERT_TRUE(done);
    EXPECT_EQ(out.code, "OK");
    ASSERT_EQ(out.registers.size(), 2u);
    EXPECT_EQ(out.registers[0], 0x0A0B);
    EXPECT_EQ(static_cast<size_t>(r.plc.connectAttempts), connectsBefore) << "no second open";
    EXPECT_EQ(r.lastState(0), "GOOD");  // the channel went on
}

// ---------------------------------------------------------------------------------------------
// A real serial port: a pty, the driver on its thread, the devices behind the master side

namespace {

template <typename F>
bool waitUntil(F cond, int timeoutMs) {
    const auto end = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
    while (std::chrono::steady_clock::now() < end) {
        if (cond()) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    return cond();
}

drv::ModbusTcpConfig ptyConfig(const std::string& path) {
    auto c = threeSlaves();
    c.serial->port = path;  // an absolute path is taken as it is
    c.serial->rs485 = true;
    return c;
}

}  // namespace

TEST(ModbusRtuPty, ThreeSlavesAreReadOverARealPortAndRs485IsAWarning) {
    FakePlc plc;
    fillSlaves(plc);
    PtyBridge bridge(plc);
    ModbusRtuDriver d(ptyConfig(bridge.path()));
    drv::conformance::RecordingSink sink;
    d.start(sink);
    ASSERT_TRUE(waitUntil(
        [&] {
            for (size_t t = 0; t < 6; ++t) {
                const auto u = sink.last(t);
                if (!u || u->quality != Quality::GOOD) return false;
            }
            return true;
        },
        4000));
    EXPECT_EQ(sink.last(2)->value, TagScalar(uint64_t{200}));
    DriverDiag diag;
    d.diagnostics(diag, 0);
    EXPECT_EQ(diag.channel.state, "connected");
    // a pty has no RS485: the channel says so and works
    ASSERT_EQ(diag.channel.warnings.size(), 1u);
    EXPECT_EQ(diag.channel.warnings[0], "RS485_UNSUPPORTED");
    d.stop();
}

TEST(ModbusRtuPty, ASecondChannelOnTheSamePortIsBusyAndTheFirstIsNotDisturbed) {
    FakePlc plc;
    fillSlaves(plc);
    PtyBridge bridge(plc);
    ModbusRtuDriver a(ptyConfig(bridge.path()));
    drv::conformance::RecordingSink sa;
    a.start(sa);
    ASSERT_TRUE(
        waitUntil([&] { return sa.last(0) && sa.last(0)->quality == Quality::GOOD; }, 4000));

    auto cb = ptyConfig(bridge.path());
    cb.channelId = "rs2";
    ModbusRtuDriver b(cb);
    drv::conformance::RecordingSink sb;
    b.start(sb);
    ASSERT_TRUE(waitUntil([&] { return sb.last(0).has_value(); }, 3000));
    EXPECT_EQ(sb.last(0)->reason, "PORT_BUSY");
    DriverDiag db;
    b.diagnostics(db, 0);
    EXPECT_EQ(db.channel.state, "error");
    EXPECT_EQ(db.channel.lastErrorCode, "PORT_BUSY");
    // the first channel runs on
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    EXPECT_EQ(sa.last(0)->quality, Quality::GOOD);
    b.stop();
    a.stop();
    // and the port is free again
    SerialParams sp;
    SerialPort probe(sp);
    EXPECT_EQ(probe.connect(bridge.path(), 0, 1000), ConnectCode::Ok);
}

TEST(ModbusRtuPty, ASlaveThatIsSilentIsSuspendedOnARealPortWhileTheOthersRun) {
    FakePlc plc;
    fillSlaves(plc);
    plc.knownUnits = {1, 3};
    PtyBridge bridge(plc);
    ModbusRtuDriver d(ptyConfig(bridge.path()));
    drv::conformance::RecordingSink sink;
    d.start(sink);
    ASSERT_TRUE(waitUntil([&] { return d.linkState(1).device == DeviceState::Suspended; }, 6000));
    // The link state turns Suspended before the sample of the suspension reaches the sink: wait
    // for it, bounded (seen red once under qemu-user on the macOS dev box, 2026-10-16).
    waitUntil([&] { return sink.last(2) && sink.last(2)->reason == "DEVICE_SUSPENDED"; }, 2000);
    EXPECT_EQ(sink.last(2)->reason, "DEVICE_SUSPENDED");
    EXPECT_EQ(sink.last(0)->quality, Quality::GOOD);
    EXPECT_EQ(sink.last(4)->quality, Quality::GOOD);
    const int before = bridge.requests;
    std::this_thread::sleep_for(std::chrono::milliseconds(1000));
    EXPECT_GE(bridge.requests - before, 6) << "slaves 1 and 3 keep their cycle";
    d.stop();
}

TEST(ModbusRtuPty, DamagedFramesOnARealPortAreDroppedAndCounted) {
    FakePlc plc;
    fillSlaves(plc);
    PtyBridge bridge(plc);
    std::atomic<int> n{0};
    bridge.mutate = [&](Bytes& reply, int unit) {
        if (unit != 1) return;
        const int k = n++;
        if (k == 2) reply.back() ^= 0x55;   // bad CRC
        if (k == 4) reply.pop_back();       // one byte short
        if (k == 6) reply.push_back(0x00);  // one byte too many
    };
    ModbusRtuDriver d(ptyConfig(bridge.path()));
    drv::conformance::RecordingSink sink;
    d.start(sink);
    ASSERT_TRUE(waitUntil(
        [&] {
            DriverDiag diag;
            d.diagnostics(diag, 0);
            return diag.devices[0].badFrames.crc >= 1 && diag.devices[0].badFrames.length >= 2;
        },
        6000));
    d.stop();
    for (const auto& u : sink.all)
        if (u.tag == 0 && u.quality == Quality::GOOD) {
            EXPECT_EQ(u.value, TagScalar(uint64_t{100}));
        }
}

TEST(ModbusRtuPty, TheSlaveComesBackWithin15SecondsOfAnsweringAgain) {
    FakePlc plc;
    fillSlaves(plc);
    plc.knownUnits = {1, 3};
    PtyBridge bridge(plc);
    ModbusRtuDriver d(ptyConfig(bridge.path()));
    drv::conformance::RecordingSink sink;
    d.start(sink);
    ASSERT_TRUE(waitUntil([&] { return d.linkState(1).device == DeviceState::Suspended; }, 6000));
    plc.knownUnits.clear();
    const auto t0 = std::chrono::steady_clock::now();
    ASSERT_TRUE(
        waitUntil([&] { return sink.last(2) && sink.last(2)->quality == Quality::GOOD; }, 15000));
    EXPECT_LE(std::chrono::steady_clock::now() - t0, std::chrono::seconds(15));
    EXPECT_EQ(d.linkState(1).device, DeviceState::Active);
    d.stop();
}

TEST(ModbusRtuPty, TheConnectionTestOnAFreePortAndThroughTheChannelThatHoldsIt) {
    FakePlc plc;
    fillSlaves(plc);
    plc.setRegs(1, Area::HR, 4, {7, 8});
    PtyBridge bridge(plc);
    RtuProbeRequest p = probeReq();
    p.devicePath = bridge.path();
    p.rs485 = false;
    // the port is free: opened for the test and closed
    const TestOutcome free = probeModbusRtu(p);
    EXPECT_EQ(free.code, "OK");
    ASSERT_EQ(free.registers.size(), 2u);
    EXPECT_EQ(free.registers[1], 8);
    SerialParams sp;
    {
        SerialPort again(sp);
        EXPECT_EQ(again.connect(bridge.path(), 0, 500), ConnectCode::Ok);
    }
    // a channel holds it: a second open is busy, the test goes through the channel's queue
    ModbusRtuDriver d(ptyConfig(bridge.path()));
    drv::conformance::RecordingSink sink;
    d.start(sink);
    ASSERT_TRUE(waitUntil(
        [&] { return sink.last(0).has_value() && sink.last(0)->quality == Quality::GOOD; }, 4000));
    EXPECT_EQ(probeModbusRtu(p).code, "PORT_BUSY");
    TestRequest tr;
    tr.unit = 1;
    tr.read = true;
    tr.address = "HR4";  // a number as it is on the wire (base 0)
    tr.count = 2;
    const TestOutcome via = d.test(tr);
    EXPECT_EQ(via.code, "OK");
    ASSERT_EQ(via.registers.size(), 2u);
    EXPECT_EQ(via.registers[0], 7);
    d.stop();
}
