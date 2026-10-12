// The connection test, TCP part (specs/006 T103; FR-044; contracts/modbus-driver.md §10): a new
// temporary connection, every result code, the optional read, the time bound, and the channel that
// runs is not disturbed.
#include "drivers/modbus/test_probe.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <thread>

#include "drivers/modbus/modbus_tcp_driver.hpp"
#include "drivers/modbus/tests/fake_plc.hpp"
#include "drivers/modbus/tests/tcp_harness.hpp"

using namespace mat;
using namespace mat::drv;
using namespace mat::testing;

GTEST_ALLOW_UNINSTANTIATED_PARAMETERIZED_TEST(DriverConformance);

namespace {

int64_t nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

TcpProbeRequest req(int port) {
    TcpProbeRequest r;
    r.host = "127.0.0.1";
    r.port = port;
    r.connectTimeoutMs = 1000;
    r.timeoutMs = 400;
    return r;
}

// A transport that only fails to connect, with the code it is given.
class StubTransport : public Transport {
   public:
    explicit StubTransport(ConnectCode c) : code_(c) {}
    ConnectCode connect(const std::string&, int, int) override { return code_; }
    bool isOpen() const override { return false; }
    void close() override {}
    bool peerClosed() override { return false; }
    size_t discardInput() override { return 0; }
    bool writeAll(const uint8_t*, size_t, int) override { return false; }
    ReadResult read(uint8_t*, size_t, int) override { return {}; }
    void interrupt() override {}
    void clearInterrupt() override {}
    uint64_t bytesSent() const override { return 0; }
    uint64_t bytesReceived() const override { return 0; }

   private:
    ConnectCode code_;
};

}  // namespace

TEST(TcpProbe, ConnectionAloneIsOkAndSendsNothing) {
    FakePlc plc;
    LoopbackServer server(plc);
    const TestOutcome o = probeModbusTcp(req(server.port));
    EXPECT_EQ(o.code, "OK");
    EXPECT_EQ(plc.requestCount(), 0u);
    EXPECT_EQ(plc.connections, 1);
    EXPECT_GE(o.connectMs, 0);
    EXPECT_LE(o.elapsedMs, 1500);
}

TEST(TcpProbe, ReadsRegistersAndGivesTheRawValue) {
    FakePlc plc;
    plc.setRegs(1, Area::HR, 100, {0x42F6, 0xE979});
    LoopbackServer server(plc);
    TcpProbeRequest r = req(server.port);
    r.read = true;
    r.offset = 100;
    r.count = 2;
    const TestOutcome o = probeModbusTcp(r);
    EXPECT_EQ(o.code, "OK");
    EXPECT_EQ(o.fc, 3);
    EXPECT_EQ(o.offset, 100);
    EXPECT_EQ(o.count, 2);
    ASSERT_EQ(o.registers.size(), 2u);
    EXPECT_EQ(o.registers[0], 0x42F6);
    EXPECT_EQ(o.registers[1], 0xE979);
    EXPECT_EQ(o.requestFrame.size(), 12u);
    EXPECT_EQ(o.responseFrame.size(), 7u + 2 + 4);
    EXPECT_GE(o.responseMs, 0);
    EXPECT_EQ(plc.requestCount(), 1u);
}

TEST(TcpProbe, ReadsInputRegistersAndBits) {
    FakePlc plc;
    plc.set(1, Area::IR, 7, 4660);
    for (int i = 0; i < 5; ++i) plc.set(1, Area::C, 2 + i, (i % 2 == 0) ? 1 : 0);
    for (int i = 0; i < 3; ++i) plc.set(1, Area::DI, i, 1);
    LoopbackServer server(plc);
    TcpProbeRequest r = req(server.port);
    r.read = true;
    r.area = Area::IR;
    r.offset = 7;
    EXPECT_EQ(probeModbusTcp(r).registers, std::vector<uint16_t>{4660});
    r.area = Area::C;
    r.offset = 2;
    r.count = 5;
    TestOutcome o = probeModbusTcp(r);
    EXPECT_EQ(o.fc, 1);
    EXPECT_EQ(o.bits, (std::vector<uint8_t>{1, 0, 1, 0, 1}));
    r.area = Area::DI;
    r.offset = 0;
    r.count = 3;
    o = probeModbusTcp(r);
    EXPECT_EQ(o.fc, 2);
    EXPECT_EQ(o.bits, (std::vector<uint8_t>{1, 1, 1}));
}

TEST(TcpProbe, UsesTheUnitOfTheRequest) {
    FakePlc plc;
    plc.set(7, Area::HR, 0, 77);
    LoopbackServer server(plc);
    TcpProbeRequest r = req(server.port);
    r.read = true;
    r.unit = 7;
    EXPECT_EQ(probeModbusTcp(r).registers, std::vector<uint16_t>{77});
}

TEST(TcpProbe, RefusedWhenNothingListens) {
    int port;
    {
        FakePlc plc;
        LoopbackServer s(plc);
        port = s.port;
    }
    const int64_t t0 = nowMs();
    const TestOutcome o = probeModbusTcp(req(port));
    EXPECT_EQ(o.code, "REFUSED");
    EXPECT_LT(nowMs() - t0, 1000);
}

TEST(TcpProbe, TimeoutWhenThePlcDoesNotAnswerAndTheTimeIsBounded) {
    FakePlc plc;
    plc.responding = false;
    LoopbackServer server(plc);
    TcpProbeRequest r = req(server.port);
    r.read = true;
    r.timeoutMs = 300;
    const int64_t t0 = nowMs();
    const TestOutcome o = probeModbusTcp(r);
    const int64_t took = nowMs() - t0;
    EXPECT_EQ(o.code, "TIMEOUT");
    EXPECT_GE(took, 280);
    EXPECT_LE(took, r.connectTimeoutMs + r.timeoutMs + 2000);
}

TEST(TcpProbe, ExceptionCarriesTheCode) {
    FakePlc plc;
    plc.set(1, Area::HR, 0, 1);
    PlcFault f;
    f.kind = PlcFault::Exception;
    f.code = 2;
    plc.addFault(f);
    LoopbackServer server(plc);
    TcpProbeRequest r = req(server.port);
    r.read = true;
    const TestOutcome o = probeModbusTcp(r);
    EXPECT_EQ(o.code, "EXCEPTION");
    EXPECT_EQ(o.exception, 2);
    EXPECT_TRUE(o.registers.empty());
}

TEST(TcpProbe, AFrameThatDoesNotMatchTheRequestIsBadFrame) {
    for (PlcFault::Kind k :
         {PlcFault::BadTid, PlcFault::BadUnit, PlcFault::BadProtocol, PlcFault::Garbage}) {
        FakePlc plc;
        plc.set(1, Area::HR, 0, 1);
        PlcFault f;
        f.kind = k;
        plc.addFault(f);
        LoopbackServer server(plc);
        TcpProbeRequest r = req(server.port);
        r.read = true;
        const TestOutcome o = probeModbusTcp(r);
        EXPECT_EQ(o.code, "BAD_FRAME") << k;
        EXPECT_FALSE(o.responseFrame.empty()) << "the bytes that came are returned for diagnosis";
    }
}

TEST(TcpProbe, AFrameCutShortIsBadFrameNotATimeoutOfSilence) {
    FakePlc plc;
    plc.set(1, Area::HR, 0, 1);
    PlcFault f;
    f.kind = PlcFault::Truncate;
    plc.addFault(f);
    LoopbackServer server(plc);
    TcpProbeRequest r = req(server.port);
    r.read = true;
    r.timeoutMs = 300;
    EXPECT_EQ(probeModbusTcp(r).code, "BAD_FRAME");
}

TEST(TcpProbe, ANameThatDoesNotResolveIsDns) {
    TcpProbeRequest r = req(502);
    r.host = "no-such-host.invalid";
    EXPECT_EQ(probeModbusTcp(r).code, "DNS");
}

TEST(TcpProbe, ConnectFailuresMapToTheirCodes) {
    SystemClock clock;
    struct Case {
        ConnectCode in;
        const char* out;
    };
    for (const Case& c :
         {Case{ConnectCode::Unreachable, "UNREACHABLE"}, Case{ConnectCode::Timeout, "TIMEOUT"},
          Case{ConnectCode::Refused, "REFUSED"}, Case{ConnectCode::Dns, "DNS"},
          Case{ConnectCode::Error, "UNREACHABLE"}}) {
        StubTransport t(c.in);
        EXPECT_EQ(probeModbusTcp(req(502), t, clock).code, c.out);
    }
}

TEST(TcpProbe, ARequestOutsideTheLimitsIsRefusedBeforeAnythingIsSent) {
    FakePlc plc;
    LoopbackServer server(plc);
    TcpProbeRequest r = req(server.port);
    r.read = true;
    r.count = 5;  // at most 4 registers
    EXPECT_EQ(probeModbusTcp(r).code, "BAD_REQUEST");
    r.area = Area::C;
    r.count = 17;  // at most 16 bits
    EXPECT_EQ(probeModbusTcp(r).code, "BAD_REQUEST");
    r.count = 0;
    EXPECT_EQ(probeModbusTcp(r).code, "BAD_REQUEST");
    EXPECT_EQ(plc.connections, 0);
}

TEST(TcpProbe, TheChannelThatRunsKeepsItsConnectionAndItsRhythm) {
    FakePlc plc;
    plc.set(1, Area::HR, 0, 5);
    LoopbackServer server(plc);
    auto c = baseConfig();
    c.port = server.port;
    c.scanMs = {100, 100, 100};
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16)};
    ModbusTcpDriver d(c);
    conformance::RecordingSink sink;
    d.start(sink);
    for (int i = 0; i < 100 && plc.requestCount() < 3; ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    ASSERT_GE(plc.requestCount(), 3u);
    const int before = plc.connections;
    TcpProbeRequest r = req(server.port);
    r.read = true;
    EXPECT_EQ(probeModbusTcp(r).code, "OK");
    EXPECT_EQ(plc.connections, before + 1) << "the probe used a connection of its own";
    const size_t mark = plc.requestCount();
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    EXPECT_GE(plc.requestCount() - mark, 3u) << "the channel kept reading";
    DriverDiag dd;
    d.diagnostics(dd, 0);
    EXPECT_EQ(dd.channel.reconnects, 0u);
    // the same through the Driver interface, on the same channel
    TestRequest tr;
    tr.host = "127.0.0.1";
    tr.port = server.port;
    tr.unit = 1;
    tr.read = true;
    tr.address = "HR0";
    tr.count = 1;
    const TestOutcome o = d.test(tr);
    EXPECT_EQ(o.code, "OK");
    ASSERT_EQ(o.registers.size(), 1u);
    EXPECT_EQ(o.registers[0], 5);
    d.stop();
}
