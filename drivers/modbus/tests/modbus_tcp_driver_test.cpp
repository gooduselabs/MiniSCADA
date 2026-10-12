// The Modbus TCP driver, read side, on a fake network and a fake clock (specs/006 T099; FR-024 to
// FR-027, FR-031, FR-032; contracts/modbus-driver.md §3-§5, §7): the standard driver suite, the
// transaction ids, dropped frames, timeouts and reconnect, exceptions and the split of blocks,
// shared connections, the schedule, diagnostics, and one run over a real socket on a thread.
#include "drivers/modbus/modbus_tcp_driver.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <set>

#include "drivers/modbus/tests/fake_plc.hpp"
#include "drivers/modbus/tests/tcp_harness.hpp"
#include "drivers/sdk/tests/driver_conformance.hpp"

using namespace mat;
using namespace mat::drv;
using namespace mat::testing;
using namespace mat::drv::conformance;
using modbus::ByteOrder;
using modbus::StringByteOrder;

// ---------------------------------------------------------------------------------------------
// The standard driver suite (T048) with modbus-tcp: items 1-3 and 5-7 here, item 4 in
// modbus_tcp_write_test.cpp.

namespace {

struct TcpTraits {
    static std::unique_ptr<Harness> make() { return std::make_unique<TcpHarness>(); }
};

}  // namespace

INSTANTIATE_TYPED_TEST_SUITE_P(ModbusTcp, DriverConformance, TcpTraits);

// ---------------------------------------------------------------------------------------------

TEST(ModbusTcpDriver, TransactionIdsStartAtTheGivenValueAndCountUpThroughTheWrap) {
    auto c = baseConfig();
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16)};
    Rig r(c, 65534);
    r.plc.set(1, Area::HR, 0, 7);
    r.start();
    r.run(5500);
    const auto log = r.plc.requests();
    ASSERT_GE(log.size(), 5u);
    EXPECT_EQ(log[0].tid, 65534);
    EXPECT_EQ(log[1].tid, 65535);
    EXPECT_EQ(log[2].tid, 0);
    EXPECT_EQ(log[3].tid, 1);
}

TEST(ModbusTcpDriver, ARequestIsSentOnlyAfterTheAnswerToThePreviousOne) {
    // Three blocks that are due together: the PLC sees them one by one, each after the previous
    // answer (the fake transport answers 5 ms after a request).
    auto c = baseConfig();
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16), bind(1, 0, Area::HR, 100, TagType::INT16),
              bind(2, 0, Area::HR, 200, TagType::INT16)};
    Rig r(c);
    for (int a : {0, 100, 200}) r.plc.set(1, Area::HR, a, 1);
    r.start();
    r.run(1500);
    const auto log = r.plc.requests();
    ASSERT_GE(log.size(), 3u);
    for (size_t i = 1; i < log.size(); ++i) EXPECT_GE(log[i].atMs - log[i - 1].atMs, 5) << i;
}

TEST(ModbusTcpDriver, ABadResponseIsDroppedCountedByKindAndNeverTakenForAnother) {
    struct Case {
        PlcFault::Kind kind;
        const char* counter;
    };
    for (const Case& cs :
         {Case{PlcFault::BadTid, "tid"}, Case{PlcFault::BadUnit, "unit"},
          Case{PlcFault::BadProtocol, "format"}, Case{PlcFault::Truncate, "length"}}) {
        auto c = baseConfig();
        c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16)};
        Rig r(c);
        r.plc.set(1, Area::HR, 0, 1234);
        PlcFault f;
        f.kind = cs.kind;
        f.count = 1;
        r.plc.addFault(f);
        r.start();
        r.run(1500);  // the request at 1001 waits until 2001 for an answer that never comes
        const DriverDiag d2 = r.diag();
        const auto& b2 = d2.devices[0].badFrames;
        const uint64_t got2 =
            std::string(cs.counter) == "tid"
                ? b2.tid
                : std::string(cs.counter) == "unit"
                      ? b2.unit
                      : std::string(cs.counter) == "length" ? b2.length : b2.format;
        EXPECT_EQ(got2, 1u) << cs.counter;
        EXPECT_EQ(d2.devices[0].timeouts, 1u) << cs.counter << ": nothing valid answered";
        // the value was never taken from the bad frame
        for (const auto& u : r.updatesOf(0)) EXPECT_NE(u.quality, Quality::GOOD) << cs.counter;
    }
}

TEST(ModbusTcpDriver, ALateAnswerToAnEarlierRequestIsCountedAndNotGivenToTheNextOne) {
    auto c = baseConfig();
    c.devices[0].retries = 1;
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16)};
    Rig r(c);
    r.plc.set(1, Area::HR, 0, 111);
    PlcFault f;
    f.kind = PlcFault::Delay;
    f.delayMs = 1500;  // the answer to the first request comes after its 1000 ms
    f.count = 1;
    r.plc.addFault(f);
    r.start();
    r.plc.set(1, Area::HR, 0, 111);
    r.run(4500);
    const DriverDiag d = r.diag();
    EXPECT_EQ(d.devices[0].timeouts, 1u);
    EXPECT_EQ(d.devices[0].badFrames.tid, 1u) << "the late answer is dropped by its transaction id";
    EXPECT_EQ(d.channel.reconnects, 0u) << "one retry, the connection stays";
    const auto u = r.sink.last(0);
    ASSERT_TRUE(u.has_value());
    EXPECT_EQ(u->quality, Quality::GOOD);
    EXPECT_EQ(u->value, TagScalar(int64_t{111}));
}

TEST(ModbusTcpDriver, ATimeoutMakesTheRequestTagsTimeoutAndTheRestDisconnectedThenReconnects) {
    auto c = baseConfig(2);
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16), bind(1, 1, Area::HR, 0, TagType::INT16)};
    Rig r(c);
    r.plc.set(1, Area::HR, 0, 1);
    r.plc.set(2, Area::HR, 0, 2);
    r.plc.knownUnits = {2};  // unit 1 never answers
    r.start();
    r.run(1800);
    auto u0 = r.sink.last(0);
    auto u1 = r.sink.last(1);
    ASSERT_TRUE(u0.has_value());
    ASSERT_TRUE(u1.has_value());
    EXPECT_EQ(u0->quality, Quality::BAD);
    EXPECT_EQ(u0->reason, "TIMEOUT");
    EXPECT_EQ(u1->quality, Quality::BAD);
    EXPECT_EQ(u1->reason, "DISCONNECTED");
    EXPECT_EQ(r.plc.connections, 1);
    EXPECT_EQ(r.drv->linkState(0).channel, ChannelState::Error);
    // the wait is 1000 ms from the drop; then it connects again
    r.run(1500);
    ASSERT_GE(r.plc.connectTimes.size(), 2u);
    const int64_t reconnectGap = r.plc.connectTimes[1] - r.plc.connectTimes[0];
    EXPECT_GE(reconnectGap, 1000 + 1000)
        << "a 1000 ms wait for the answer, then 1000 ms of backoff";
    EXPECT_LE(reconnectGap, 2100);
}

TEST(ModbusTcpDriver, ReconnectWaitsDoubleUpToTheCapAndNeverStartOver) {
    auto c = baseConfig();
    c.reconnectMaxS = 10;
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16)};
    Rig r(c);
    r.plc.refuse = true;
    r.start();
    r.run(50000);
    const auto& t = r.plc.connectTimes;
    ASSERT_GE(t.size(), 8u);
    // each refused attempt takes 1 ms of fake time; the wait is the gap minus that
    const std::vector<int64_t> want = {1000, 2000, 4000, 8000, 10000, 10000, 10000};
    for (size_t i = 0; i < want.size(); ++i) EXPECT_EQ(t[i + 1] - t[i] - 1, want[i]) << i;
    auto u = r.sink.last(0);
    ASSERT_TRUE(u.has_value());
    EXPECT_EQ(u->quality, Quality::BAD);
    EXPECT_EQ(u->reason, "REFUSED");
    const DriverDiag d = r.diag();
    EXPECT_EQ(d.channel.lastErrorCode, "REFUSED");
    EXPECT_EQ(d.channel.state, "error");
    // and it recovers when the PLC comes back
    r.plc.refuse = false;
    r.plc.set(1, Area::HR, 0, 5);
    r.run(12000);
    EXPECT_EQ(r.sink.last(0)->quality, Quality::GOOD);
    EXPECT_EQ(r.diag().channel.state, "connected");
}

TEST(ModbusTcpDriver, AConnectionClosedWhileIdleIsOpenedAgainAtOnceWithoutAnError) {
    auto c = baseConfig();
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16)};
    Rig r(c);
    r.plc.set(1, Area::HR, 0, 9);
    r.start();
    r.run(1500);
    ASSERT_EQ(r.sink.last(0)->quality, Quality::GOOD);
    r.plc.dropAll();  // the PLC closes the connection while the driver is idle
    r.run(3000);
    EXPECT_EQ(r.plc.connections, 2);
    EXPECT_EQ(r.diag().channel.reconnects, 1u);
    EXPECT_FALSE(r.everBad(0))
        << "the Tag never went BAD: the connection was reopened before the request";
    EXPECT_EQ(r.sink.last(0)->quality, Quality::GOOD);
}

TEST(ModbusTcpDriver, ExceptionsFollowTheTable) {
    struct Case {
        int code;
        const char* reason;
    };
    for (const Case& cs :
         {Case{1, "EXCEPTION_01"}, Case{4, "EXCEPTION_04"}, Case{7, "EXCEPTION_07"},
          Case{8, "EXCEPTION_08"}, Case{9, "EXCEPTION_OTHER"}, Case{0x7F, "EXCEPTION_OTHER"}}) {
        auto c = baseConfig();
        c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16)};
        Rig r(c);
        r.plc.set(1, Area::HR, 0, 3);
        PlcFault f;
        f.kind = PlcFault::Exception;
        f.code = cs.code;
        f.count = 1;
        r.plc.addFault(f);
        r.start();
        r.run(900);
        auto u = r.sink.last(0);
        ASSERT_TRUE(u.has_value()) << cs.code;
        EXPECT_EQ(u->quality, Quality::BAD) << cs.code;
        EXPECT_EQ(u->reason, cs.reason) << cs.code;
        EXPECT_EQ(r.plc.connections, 1) << "an exception is an answer: the connection stays";
        EXPECT_EQ(r.drv->linkState(0).channel, ChannelState::Connected);
        EXPECT_EQ(r.diag().devices[0].exceptions.at(cs.code), 1u);
        r.run(2000);  // the next lap reads fine again
        EXPECT_EQ(r.sink.last(0)->quality, Quality::GOOD) << cs.code;
    }
}

TEST(ModbusTcpDriver, Exceptions05And06AreRetriedByRetriesThenBad) {
    for (int code : {5, 6}) {
        auto c = baseConfig();
        c.devices[0].retries = 2;
        c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16)};
        Rig r(c);
        r.plc.set(1, Area::HR, 0, 3);
        PlcFault f;
        f.kind = PlcFault::Exception;
        f.code = code;
        f.count = 2;  // two busy answers, then the value
        r.plc.addFault(f);
        r.start();
        r.run(900);
        EXPECT_EQ(r.sink.last(0)->quality, Quality::GOOD) << code;
        EXPECT_EQ(r.plc.requestCount(3), 3u) << code;
    }
    auto c = baseConfig();
    c.devices[0].retries = 2;
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16)};
    Rig r(c);
    r.plc.set(1, Area::HR, 0, 3);
    PlcFault f;
    f.kind = PlcFault::Exception;
    f.code = 6;
    f.count = 3;
    r.plc.addFault(f);
    r.start();
    r.run(900);
    EXPECT_EQ(r.sink.last(0)->quality, Quality::BAD);
    EXPECT_EQ(r.sink.last(0)->reason, "EXCEPTION_06");
    EXPECT_EQ(r.plc.requestCount(3), 3u);
}

TEST(ModbusTcpDriver, ExceptionOnAMergedBlockSplitsItUntilOnlyTheHoleIsBad) {
    // Tags at HR0..HR3, one block; HR2 does not exist in the PLC: exception 02.
    auto c = baseConfig();
    for (int i = 0; i < 4; ++i)
        c.tags.push_back(bind(static_cast<size_t>(i), 0, Area::HR, i, TagType::INT16));
    Rig r(c);
    for (int i = 0; i < 4; ++i) r.plc.set(1, Area::HR, i, static_cast<uint16_t>(10 + i));
    r.plc.erase(1, Area::HR, 2);
    r.start();
    r.run(6000);
    for (size_t t : {0u, 1u, 3u}) {
        EXPECT_EQ(r.sink.last(t)->quality, Quality::GOOD) << t;
        EXPECT_FALSE(r.everBad(t)) << "Tag " << t << " kept its state while the block was split";
    }
    EXPECT_EQ(r.sink.last(0)->value, TagScalar(int64_t{10}));
    EXPECT_EQ(r.sink.last(3)->value, TagScalar(int64_t{13}));
    ASSERT_TRUE(r.sink.last(2).has_value());
    EXPECT_EQ(r.sink.last(2)->quality, Quality::BAD);
    EXPECT_EQ(r.sink.last(2)->reason, "EXCEPTION_02");
    // converged: from here a lap is the two good reads and the one bad one, nothing more
    const size_t before = r.plc.requestCount(3);
    r.run(3000);
    EXPECT_EQ(r.plc.requestCount(3) - before, 3u * 3u);
    EXPECT_EQ(r.drv->linkState(0).channel, ChannelState::Connected);
}

TEST(ModbusTcpDriver, ASplitBlockIsKeptUntilTheConnectionIsOpenedAgain) {
    auto c = baseConfig();
    for (int i = 0; i < 4; ++i)
        c.tags.push_back(bind(static_cast<size_t>(i), 0, Area::HR, i, TagType::INT16));
    Rig r(c);
    for (int i = 0; i < 4; ++i) r.plc.set(1, Area::HR, i, 1);
    r.plc.erase(1, Area::HR, 2);
    r.start();
    r.run(6000);
    r.plc.set(1, Area::HR, 2, 1);  // the PLC is fixed: the single Tag block heals at once
    r.run(1500);
    EXPECT_EQ(r.sink.last(2)->quality, Quality::GOOD);
    const size_t splitLap = r.plc.requestCount(3);
    r.run(2000);
    const size_t perLap = (r.plc.requestCount(3) - splitLap) / 2;
    EXPECT_GE(perLap, 3u) << "still split: more than the one request of the merged block";
    r.plc.dropAll();
    r.run(4000);
    const size_t after = r.plc.requestCount(3);
    r.run(2000);
    EXPECT_EQ((r.plc.requestCount(3) - after) / 2, 1u)
        << "after the reconnect the plan is merged again";
}

TEST(ModbusTcpDriver, Exception03OnASingleTagBlockMakesItBad) {
    auto c = baseConfig();
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16)};
    Rig r(c);
    r.plc.set(1, Area::HR, 0, 3);
    PlcFault f;
    f.kind = PlcFault::Exception;
    f.code = 3;
    f.count = 1;
    r.plc.addFault(f);
    r.start();
    r.run(900);
    EXPECT_EQ(r.sink.last(0)->reason, "EXCEPTION_03");
    EXPECT_EQ(r.drv->linkState(0).channel, ChannelState::Connected);
}

TEST(ModbusTcpDriver, Exception0A0BOnlyBadsThatDeviceAndTheChannelStaysConnected) {
    auto c = baseConfig(2);
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16), bind(1, 1, Area::HR, 0, TagType::INT16)};
    Rig r(c);
    r.plc.set(1, Area::HR, 0, 1);
    r.plc.set(2, Area::HR, 0, 2);
    PlcFault f;
    f.kind = PlcFault::Exception;
    f.code = 0x0B;
    f.unit = 2;
    f.count = 1000;
    r.plc.addFault(f);
    r.start();
    r.run(3500);
    EXPECT_EQ(r.sink.last(0)->quality, Quality::GOOD);
    EXPECT_EQ(r.sink.last(1)->quality, Quality::BAD);
    EXPECT_EQ(r.sink.last(1)->reason, "EXCEPTION_0B");
    EXPECT_EQ(r.drv->linkState(0).channel, ChannelState::Connected);
    EXPECT_EQ(r.drv->linkState(0).device, DeviceState::Active);
    EXPECT_EQ(r.drv->linkState(1).device, DeviceState::Error);
    EXPECT_EQ(r.plc.connections, 1);
}

TEST(ModbusTcpDriver, FieldDevicesShareTheConnection) {
    auto c = baseConfig(3);
    for (size_t d = 0; d < 3; ++d)
        c.tags.push_back(bind(d, static_cast<uint32_t>(d), Area::HR, 0, TagType::INT16));
    Rig r(c);
    for (int u = 1; u <= 3; ++u) r.plc.set(u, Area::HR, 0, static_cast<uint16_t>(u * 11));
    r.start();
    r.run(2500);
    EXPECT_EQ(r.plc.connections, 1);
    for (size_t d = 0; d < 3; ++d) {
        ASSERT_TRUE(r.sink.last(d).has_value());
        EXPECT_EQ(r.sink.last(d)->value, TagScalar(static_cast<int64_t>((d + 1) * 11)));
        EXPECT_GE(r.plc.requestCount(3, static_cast<int>(d) + 1), 2u);
    }
}

TEST(ModbusTcpDriver, ScanGroupsRunAtTheirOwnPeriod) {
    auto c = baseConfig();
    auto fast = bind(0, 0, Area::HR, 0, TagType::INT16);
    fast.group = ScanGroup::Fast;
    auto normal = bind(1, 0, Area::HR, 100, TagType::INT16);
    auto slow = bind(2, 0, Area::HR, 200, TagType::INT16);
    slow.group = ScanGroup::Slow;
    c.tags = {fast, normal, slow};
    Rig r(c);
    for (int a : {0, 100, 200}) r.plc.set(1, Area::HR, a, 1);
    r.start();
    r.run(10000);
    auto count = [&](int addr) {
        size_t n = 0;
        for (const auto& q : r.plc.requests())
            if (q.address == addr) ++n;
        return n;
    };
    EXPECT_NEAR(static_cast<double>(count(0)), 40.0, 2.0);
    EXPECT_NEAR(static_cast<double>(count(100)), 10.0, 1.0);
    EXPECT_NEAR(static_cast<double>(count(200)), 2.0, 1.0);
    const DriverDiag d = r.diag();
    ASSERT_EQ(d.devices[0].groups.size(), 3u);
    std::set<int64_t> periods;
    for (const auto& g : d.devices[0].groups) periods.insert(g.periodMs);
    EXPECT_EQ(periods, (std::set<int64_t>{250, 1000, 5000}));
}

TEST(ModbusTcpDriver, RequestGapKeepsRequestsApart) {
    auto c = baseConfig();
    c.requestGapMs = 100;
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16), bind(1, 0, Area::HR, 100, TagType::INT16),
              bind(2, 0, Area::HR, 200, TagType::INT16)};
    Rig r(c);
    for (int a : {0, 100, 200}) r.plc.set(1, Area::HR, a, 1);
    r.start();
    r.run(3000);
    const auto log = r.plc.requests();
    ASSERT_GE(log.size(), 6u);
    for (size_t i = 1; i < log.size(); ++i) EXPECT_GE(log[i].atMs - log[i - 1].atMs, 100) << i;
}

TEST(ModbusTcpDriver, MergesNearbyTagsIntoOneRequestAndNeverCutsOne) {
    auto c = baseConfig();
    // 50 FLOAT32 side by side: one request of 100 registers (US1-6)
    for (size_t i = 0; i < 50; ++i)
        c.tags.push_back(bind(i, 0, Area::HR, static_cast<int>(2 * i), TagType::FLOAT32));
    Rig r(c);
    for (int i = 0; i < 100; ++i) r.plc.set(1, Area::HR, i, 0x3F80 + (i & 1));
    r.start();
    r.run(900);
    auto log = r.plc.requests();
    ASSERT_EQ(log.size(), 1u);
    EXPECT_EQ(log[0].quantity, 100);
    for (size_t i = 0; i < 50; ++i) EXPECT_EQ(r.sink.last(i)->quality, Quality::GOOD) << i;

    // 65 FLOAT32 = 130 registers: two requests of at most 125, no Tag cut
    auto c2 = baseConfig();
    for (size_t i = 0; i < 65; ++i)
        c2.tags.push_back(bind(i, 0, Area::HR, static_cast<int>(2 * i), TagType::FLOAT32));
    Rig r2(c2);
    for (int i = 0; i < 130; ++i) r2.plc.set(1, Area::HR, i, 1);
    r2.start();
    r2.run(900);
    log = r2.plc.requests();
    ASSERT_EQ(log.size(), 2u);
    for (const auto& q : log) {
        EXPECT_LE(q.quantity, 125);
        EXPECT_EQ(q.quantity % 2, 0) << "a Tag is never cut in two";
    }
    EXPECT_EQ(log[0].quantity + log[1].quantity, 130);
}

TEST(ModbusTcpDriver, BitsOfOneRegisterAndTagsAtTheSameAddressAreReadOnce) {
    auto c = baseConfig();
    c.tags = {bind(0, 0, Area::HR, 5, TagType::INT16), bind(1, 0, Area::HR, 5, TagType::UINT16),
              bind(2, 0, Area::HR, 5, TagType::BOOL, 1, 3),
              bind(3, 0, Area::HR, 5, TagType::BOOL, 1, 0)};
    Rig r(c);
    r.plc.set(1, Area::HR, 5, 0x0009);  // bits 0 and 3
    r.start();
    r.run(2500);
    for (const auto& q : r.plc.requests()) {
        EXPECT_EQ(q.address, 5);
        EXPECT_EQ(q.quantity, 1);
    }
    EXPECT_EQ(r.plc.requestCount(), 3u);  // 1001, 2001, ... one per lap
    EXPECT_EQ(r.sink.last(0)->value, TagScalar(int64_t{9}));
    EXPECT_EQ(r.sink.last(1)->value, TagScalar(uint64_t{9}));
    EXPECT_EQ(r.sink.last(2)->value, TagScalar(true));
    EXPECT_EQ(r.sink.last(3)->value, TagScalar(true));
}

TEST(ModbusTcpDriver, ABitOfZeroIsFalseAndAnInvalidFloatIsBad) {
    auto c = baseConfig();
    c.tags = {bind(0, 0, Area::HR, 0, TagType::BOOL, 1, 4),
              bind(1, 0, Area::HR, 1, TagType::FLOAT32)};
    Rig r(c);
    r.plc.set(1, Area::HR, 0, 0x0001);
    r.plc.setRegs(1, Area::HR, 1, {0x7FC0, 0x0000});  // NaN
    r.start();
    r.run(1500);
    EXPECT_EQ(r.sink.last(0)->value, TagScalar(false));
    EXPECT_EQ(r.sink.last(1)->quality, Quality::BAD);
    EXPECT_EQ(r.sink.last(1)->reason, "INVALID_VALUE");
}

TEST(ModbusTcpDriver, ADisabledChannelHasNoTrafficAndItsTagsAreDisabled) {
    auto c = baseConfig();
    c.enabled = false;
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16)};
    Rig r(c);
    r.plc.set(1, Area::HR, 0, 1);
    r.start();
    r.run(5000);
    EXPECT_EQ(r.plc.connectAttempts, 0);
    EXPECT_EQ(r.plc.bytesIn + r.plc.bytesOut, 0u);
    EXPECT_EQ(r.sink.last(0)->reason, "DISABLED");
    EXPECT_EQ(r.drv->linkState(0).channel, ChannelState::Disabled);
    EXPECT_EQ(r.diag().channel.state, "disabled");
}

TEST(ModbusTcpDriver, ADisabledFieldDeviceIsNotAskedAndItsTagsAreDisabled) {
    auto c = baseConfig(2);
    c.devices[1].enabled = false;
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16), bind(1, 1, Area::HR, 0, TagType::INT16)};
    Rig r(c);
    r.plc.set(1, Area::HR, 0, 1);
    r.plc.set(2, Area::HR, 0, 2);
    r.start();
    r.run(3000);
    EXPECT_EQ(r.plc.requestCount(-1, 2), 0u);
    EXPECT_GE(r.plc.requestCount(-1, 1), 2u);
    EXPECT_EQ(r.sink.last(1)->reason, "DISABLED");
    EXPECT_EQ(r.drv->linkState(1).device, DeviceState::Disabled);
    EXPECT_EQ(r.drv->linkState(0).device, DeviceState::Active);
}

TEST(ModbusTcpDriver, DiagnosticsCountWhatHappened) {
    auto c = baseConfig();
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16)};
    Rig r(c);
    r.plc.set(1, Area::HR, 0, 1);
    r.start();
    r.run(5500);
    const DriverDiag d = r.diag();
    ASSERT_EQ(d.devices.size(), 1u);
    EXPECT_EQ(d.channel.id, "plc1");
    EXPECT_EQ(d.channel.state, "connected");
    EXPECT_EQ(d.devices[0].id, "dev0");
    EXPECT_EQ(d.devices[0].requestsOk, r.plc.requestCount());
    EXPECT_EQ(d.devices[0].timeouts, 0u);
    EXPECT_NEAR(d.devices[0].responseAvgMs, 5.0, 2.0);
    EXPECT_EQ(d.devices[0].state, "active");
}

// ---------------------------------------------------------------------------------------------
// Real socket, real thread

TEST(ModbusTcpDriverThread, ReadsOverALoopbackSocketAndLinkStateIsReadFromAnotherThread) {
    FakePlc plc;
    plc.set(1, Area::HR, 0, 321);
    plc.set(1, Area::C, 0, 1);
    LoopbackServer server(plc);
    auto c = baseConfig();
    c.port = server.port;
    c.scanMs = {100, 100, 100};
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16), bind(1, 0, Area::C, 0, TagType::BOOL)};
    ModbusTcpDriver d(c);
    RecordingSink sink;
    d.start(sink);
    bool connected = false;
    for (int i = 0; i < 100 && !(connected && sink.last(0) && sink.last(1)); ++i) {
        connected = d.linkState(0).channel == ChannelState::Connected;
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    EXPECT_TRUE(connected);
    ASSERT_TRUE(sink.last(0).has_value());
    ASSERT_TRUE(sink.last(1).has_value());
    EXPECT_EQ(sink.last(0)->value, TagScalar(int64_t{321}));
    EXPECT_EQ(sink.last(1)->value, TagScalar(true));
    plc.set(1, Area::HR, 0, 322);
    for (int i = 0; i < 50 && sink.last(0)->value != TagScalar(int64_t{322}); ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    EXPECT_EQ(sink.last(0)->value, TagScalar(int64_t{322}));
    d.stop();
    const size_t before = sink.count();
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    EXPECT_EQ(sink.count(), before) << "nothing is published after stop()";
}

TEST(ModbusTcpDriverThread, StopEndsAWaitForAnAnswerAtOnce) {
    FakePlc plc;
    plc.set(1, Area::HR, 0, 1);
    plc.responding = false;  // never answers
    LoopbackServer server(plc);
    auto c = baseConfig();
    c.port = server.port;
    c.devices[0].timeoutMs = 10000;
    c.scanMs = {100, 100, 100};
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16)};
    ModbusTcpDriver d(c);
    RecordingSink sink;
    d.start(sink);
    for (int i = 0; i < 100 && plc.requestCount() == 0; ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    ASSERT_GE(plc.requestCount(), 1u);
    const auto t0 = std::chrono::steady_clock::now();
    d.stop();
    const auto took =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count();
    EXPECT_LT(took, 1000) << "stop() waited for the 10 s timeout";
}

TEST(ModbusTcpDriverThread, ARefusedConnectionGivesBadRefusedAndStopIsPrompt) {
    int port;
    {
        FakePlc plc;
        LoopbackServer s(plc);
        port = s.port;
    }
    auto c = baseConfig();
    c.port = port;
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16)};
    ModbusTcpDriver d(c);
    RecordingSink sink;
    d.start(sink);
    for (int i = 0; i < 100 && !sink.last(0); ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    ASSERT_TRUE(sink.last(0).has_value());
    EXPECT_EQ(sink.last(0)->quality, Quality::BAD);
    EXPECT_EQ(sink.last(0)->reason, "REFUSED");
    const auto t0 = std::chrono::steady_clock::now();
    d.stop();  // it is waiting out a backoff
    EXPECT_LT(
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count(),
        500);
}

TEST(ModbusTcpDriver, TagsSeparatedByAGapUpToMaxGapShareARequestAndAGapAboveItDoesNot) {
    auto c = baseConfig();
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16),
              bind(1, 0, Area::HR, 8, TagType::INT16),    // gap 7: merged
              bind(2, 0, Area::HR, 19, TagType::INT16),   // gap 10: merged
              bind(3, 0, Area::HR, 40, TagType::INT16)};  // gap 20: apart
    Rig r(c);
    for (int a : {0, 8, 19, 40}) r.plc.set(1, Area::HR, a, 1);
    for (int a = 0; a < 20; ++a) r.plc.set(1, Area::HR, a, 1);  // the registers in the gaps exist
    r.start();
    r.run(900);
    const auto log = r.plc.requests();
    ASSERT_EQ(log.size(), 2u);
    EXPECT_EQ(log[0].address, 0);
    EXPECT_EQ(log[0].quantity, 20);
    EXPECT_EQ(log[1].address, 40);
    EXPECT_EQ(log[1].quantity, 1);
    c.devices[0].maxGapRegisters = 0;  // only touching Tags
    Rig z(c);
    for (int a = 0; a < 41; ++a) z.plc.set(1, Area::HR, a, 1);
    z.start();
    z.run(900);
    EXPECT_EQ(z.plc.requests().size(), 4u);
}
