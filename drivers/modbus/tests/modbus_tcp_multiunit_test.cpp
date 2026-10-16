// A Modbus TCP gateway with several field devices (specs/011 T037; FR-021, FR-022, SC-005;
// research R7): a timeout makes only that device BAD and the connection stays; the device waits
// out its own backoff (1 s to 30 s) and is asked again; a late answer is dropped by its
// transaction id and never taken for another request (10 000 random cases, fixed seed); the
// connection closes on a socket error, a frame error, or 3 timeouts in a row over 2 devices or
// more. RTU (serial) keeps its own rules (modbus_rtu_driver_test).
#include <gtest/gtest.h>

#include <map>
#include <random>
#include <set>

#include "drivers/modbus/modbus_tcp_driver.hpp"
#include "drivers/modbus/tests/fake_plc.hpp"
#include "drivers/modbus/tests/tcp_harness.hpp"

using namespace mat;
using namespace mat::drv;
using namespace mat::testing;

// tcp_harness.hpp brings the standard driver suite; it runs in modbus_tcp_driver_test.
GTEST_ALLOW_UNINSTANTIATED_PARAMETERIZED_TEST(DriverConformance);

namespace {

// Three units behind one gateway, one INT16 Tag each at HR 0 (value unit x 111).
ModbusTcpConfig gateway3() {
    auto c = baseConfig(3);
    for (size_t d = 0; d < 3; ++d)
        c.tags.push_back(bind(d, static_cast<uint32_t>(d), Area::HR, 0, TagType::INT16));
    return c;
}

void fill3(FakePlc& plc) {
    for (int u = 1; u <= 3; ++u) plc.set(u, Area::HR, 0, static_cast<uint16_t>(u * 111));
}

size_t goodCount(Rig& r, size_t tag) {
    size_t n = 0;
    for (const auto& u : r.updatesOf(tag))
        if (u.quality == Quality::GOOD) ++n;
    return n;
}

std::vector<int64_t> requestTimes(FakePlc& plc, int unit) {
    std::vector<int64_t> t;
    for (const auto& q : plc.requests())
        if (q.unit == unit) t.push_back(q.atMs);
    return t;
}

}  // namespace

TEST(ModbusTcpMultiUnit, HealthyUnitsStayGoodEveryCycleWhileOneUnitIsMute) {
    Rig r(gateway3());
    fill3(r.plc);
    r.plc.knownUnits = {1, 3};  // unit 2 never answers
    r.start();
    r.run(1000 * 1000 + 500);  // 1 000 cycles of the normal group (1 s)
    for (size_t t : {size_t{0}, size_t{2}}) {
        EXPECT_FALSE(r.everBad(t)) << "tag " << t;
        EXPECT_GE(goodCount(r, t), 1000u) << "tag " << t << ": a value every cycle";
        // never late by more than one cycle: no round of the healthy units is skipped
        const DriverDiag d = r.diag();
        ASSERT_FALSE(d.devices[t].groups.empty());
        EXPECT_EQ(d.devices[t].groups[0].overruns, 0u) << "tag " << t;
        int64_t prev = -1, worst = 0;
        for (const auto& u : r.updatesOf(t)) {
            if (prev >= 0) worst = std::max(worst, u.sourceTs - prev);
            prev = u.sourceTs;
        }
        EXPECT_LE(worst, 2000) << "tag " << t;
    }
    const auto u1 = r.sink.last(1);
    ASSERT_TRUE(u1.has_value());
    EXPECT_EQ(u1->quality, Quality::BAD);
    EXPECT_EQ(u1->reason, "TIMEOUT");
    EXPECT_EQ(r.plc.connections, 1) << "a single device timing out never closes the connection";
    EXPECT_EQ(r.diag().channel.reconnects, 0u);
    EXPECT_EQ(r.drv->linkState(0).channel, ChannelState::Connected);
    EXPECT_EQ(r.drv->linkState(1).device, DeviceState::Suspended);
    EXPECT_EQ(r.drv->linkState(0).device, DeviceState::Active);
}

TEST(ModbusTcpMultiUnit, AMuteDeviceIsAskedAgainAfterItsOwnBackoffFromOneToThirtySeconds) {
    Rig r(gateway3());
    fill3(r.plc);
    r.plc.knownUnits = {1, 3};
    r.start();
    r.run(200000);
    const auto t = requestTimes(r.plc, 2);
    // each wait: the 1 000 ms timeout, then 1, 2, 4, 8, 16, 30, 30 s (no jitter in the rig)
    const std::vector<int64_t> want = {2000, 3000, 5000, 9000, 17000, 31000, 31000, 31000};
    ASSERT_GE(t.size(), want.size() + 1);
    for (size_t i = 0; i < want.size(); ++i) {
        EXPECT_GE(t[i + 1] - t[i], want[i]) << i;
        EXPECT_LE(t[i + 1] - t[i], want[i] + 50)
            << i << ": other devices delay it at most a request";
    }
    // it comes back on its own once it answers
    r.plc.knownUnits.clear();
    r.run(35000);
    EXPECT_EQ(r.sink.last(1)->quality, Quality::GOOD);
    EXPECT_EQ(r.sink.last(1)->value, TagScalar(int64_t{222}));
    EXPECT_EQ(r.drv->linkState(1).device, DeviceState::Active);
    // and its backoff starts over at 1 s
    r.plc.knownUnits = {1, 3};
    const size_t before = requestTimes(r.plc, 2).size();
    r.run(4500);
    const auto t2 = requestTimes(r.plc, 2);
    ASSERT_GE(t2.size(), before + 2);
    EXPECT_LE(t2[before + 1] - t2[before], 2050);
    EXPECT_EQ(r.plc.connections, 1);
}

TEST(ModbusTcpMultiUnit, ALateAnswerIsDroppedByItsTransactionIdAndNeverGivenToAnotherUnit) {
    Rig r(gateway3());
    fill3(r.plc);
    PlcFault f;
    f.kind = PlcFault::Delay;
    f.unit = 2;
    f.delayMs = 1500;  // arrives while unit 3 is being asked
    f.count = 1;
    r.plc.addFault(f);
    r.start();
    r.run(6000);
    const DriverDiag d = r.diag();
    EXPECT_EQ(d.devices[1].timeouts, 1u);
    uint64_t tidDrops = 0;
    for (const auto& dev : d.devices) tidDrops += dev.badFrames.tid;
    EXPECT_EQ(tidDrops, 1u);
    for (size_t t = 0; t < 3; ++t)
        for (const auto& u : r.updatesOf(t))
            if (u.quality == Quality::GOOD)
                EXPECT_EQ(u.value, TagScalar(static_cast<int64_t>((t + 1) * 111))) << "tag " << t;
    EXPECT_EQ(r.plc.connections, 1);
    EXPECT_EQ(r.sink.last(1)->quality, Quality::GOOD) << "asked again after its backoff";
}

namespace {

// Two UINT32 blocks per unit (HR 0 and HR 100): the high word says which unit and block, the low
// word counts the requests of that block. A value is right only when it is the answer to the
// request in flight for that block.
struct Checker : EngineSink {
    std::map<std::pair<int, int>, uint16_t> inFlight;  // (unit, address) -> counter answered
    std::map<size_t, std::pair<int, int>> blockOf;     // tag -> (unit, address)
    uint64_t good = 0, mixed = 0;
    void publish(std::vector<TagUpdate>&& ups) override {
        for (const auto& u : ups) {
            if (u.quality != Quality::GOOD) continue;
            ++good;
            const auto b = blockOf.at(u.tag);
            const uint64_t v = std::get<uint64_t>(u.value);
            const uint64_t hi = v >> 16, lo = v & 0xFFFF;
            const uint64_t wantHi = static_cast<uint64_t>(b.first * 16 + (b.second ? 1 : 0));
            if (hi != wantHi || lo != inFlight[b]) ++mixed;
        }
    }
    void writeDone(WriteResult&&) override {}
};

}  // namespace

TEST(ModbusTcpMultiUnit, TenThousandRandomCasesNeverTakeALateAnswerForAnotherRequest) {
    auto c = baseConfig(3);
    size_t tag = 0;
    Checker check;
    for (uint32_t d = 0; d < 3; ++d)
        for (int addr : {0, 100}) {
            c.tags.push_back(bind(tag, d, Area::HR, addr, TagType::UINT32));
            check.blockOf[tag++] = {static_cast<int>(d) + 1, addr};
        }
    c.scanMs = {250, 500, 5000};
    for (auto& d : c.devices) d.timeoutMs = 300;
    Rig r(c, 65000);  // the transaction ids wrap during the run
    for (int u = 1; u <= 3; ++u)
        for (int addr : {0, 100})
            r.plc.setRegs(u, Area::HR, addr, {static_cast<uint16_t>(u * 16 + (addr ? 1 : 0)), 0});
    std::mt19937 rng(20261016);
    uint64_t late = 0, silent = 0, slow = 0, twice = 0;
    r.drv->start(check);  // the transport is made here and kept across reconnects
    ASSERT_NE(r.transport, nullptr);
    r.transport->onWrite = [&](const Bytes& req) {  // after the PLC built its answer from memory
        const int unit = req[6];
        const int addr = (req[8] << 8) | req[9];
        const uint16_t answered = r.plc.get(unit, Area::HR, addr + 1);
        check.inFlight[{unit, addr}] = answered;
        r.plc.set(unit, Area::HR, addr + 1, static_cast<uint16_t>(answered + 1));
    };
    r.transport->mutateReply = [&](PlcReply& rep) {
        const unsigned k = rng() % 100;
        if (k < 20) {  // after the timeout: must be dropped
            rep.delayMs = 300 + 1 + static_cast<int64_t>(rng() % 1200);
            ++late;
        } else if (k < 30) {  // slow but in time: must be taken
            rep.delayMs = static_cast<int64_t>(rng() % 280);
            ++slow;
        } else if (k < 38) {
            rep.pieces.clear();
            ++silent;
        } else if (k < 43 && !rep.pieces.empty()) {  // the same answer twice
            rep.pieces.push_back(rep.pieces.front());
            rep.gapsMs = {static_cast<int64_t>(rng() % 400)};
            ++twice;
        }
    };
    while (r.plc.requestCount() < 10000) r.run(500);
    EXPECT_GE(late, 1500u);
    EXPECT_GE(silent, 500u);
    EXPECT_GE(slow, 500u);
    EXPECT_GE(twice, 200u);
    EXPECT_GE(check.good, 4000u);
    EXPECT_EQ(check.mixed, 0u) << "a late or repeated answer was taken for another request";
}

TEST(ModbusTcpMultiUnit, ThreeTimeoutsInARowOverTwoDevicesCloseTheConnection) {
    Rig r(gateway3());
    fill3(r.plc);
    r.start();
    r.run(1500);
    ASSERT_EQ(r.sink.last(0)->quality, Quality::GOOD);
    r.plc.responding = false;  // the gateway itself is gone
    r.run(5000);
    EXPECT_GE(r.plc.connectTimes.size(), 2u) << "the whole channel is down: connect again";
    EXPECT_EQ(r.diag().channel.lastErrorCode, "TIMEOUT");
    // three timeouts of 1 000 ms, then the reconnect wait of 1 000 ms
    ASSERT_GE(r.plc.connectTimes.size(), 2u);
    EXPECT_GE(r.plc.connectTimes[1] - r.plc.connectTimes[0], 3 * 1000 + 1000);
    r.plc.responding = true;
    r.run(15000);
    for (size_t t = 0; t < 3; ++t) EXPECT_EQ(r.sink.last(t)->quality, Quality::GOOD) << t;
}

TEST(ModbusTcpMultiUnit,
     TimeoutsOfOneDeviceAloneNeverCloseTheConnectionButAnAnswerInBetweenResets) {
    // unit 2 and unit 3 time out in turn while unit 1 answers in between: no 3 in a row
    Rig r(gateway3());
    fill3(r.plc);
    r.plc.knownUnits = {1};
    r.start();
    r.run(60000);
    EXPECT_EQ(r.plc.connections, 1);
    EXPECT_FALSE(r.everBad(0));
}

TEST(ModbusTcpMultiUnit, ASingleDeviceChannelClosesAfterThreeTimeoutsInARow) {
    auto c = baseConfig();
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16)};
    Rig r(c);
    r.plc.set(1, Area::HR, 0, 1);
    r.start();
    r.run(1500);
    r.plc.responding = false;
    r.run(2500);
    EXPECT_EQ(r.plc.connections, 1) << "one timeout keeps the connection";
    EXPECT_EQ(r.sink.last(0)->reason, "TIMEOUT");
    r.run(6000);  // timeouts at +1 s, +3 s (after 1 s backoff), +6 s (after 2 s)
    EXPECT_GE(r.plc.connections, 2);
}

TEST(ModbusTcpMultiUnit, ASocketErrorOrAFrameErrorClosesTheConnectionAtOnce) {
    for (PlcFault::Kind k : {PlcFault::CloseConn, PlcFault::Garbage}) {
        Rig r(gateway3());
        fill3(r.plc);
        PlcFault f;
        f.kind = k;
        f.unit = 2;
        f.count = 1;
        r.plc.addFault(f);
        r.start();
        r.run(3500);
        EXPECT_EQ(r.plc.connections, 2) << k;
        EXPECT_EQ(r.sink.last(0)->quality, Quality::GOOD) << k;
    }
}

TEST(ModbusTcpMultiUnit, AWriteToADeviceInBackoffIsNotSentAndOthersGoOn) {
    auto c = gateway3();
    Rig r(c);
    fill3(r.plc);
    r.plc.knownUnits = {1, 3};
    r.start();
    r.run(2100);  // unit 2 timed out at about 2 s: in backoff
    ASSERT_EQ(r.drv->linkState(1).device, DeviceState::Suspended);
    WriteCommand w2;
    w2.id = 1;
    w2.tag = 1;
    w2.raw = int64_t{5};
    w2.deadlineMs = 5000;
    WriteCommand w1 = w2;
    w1.id = 2;
    w1.tag = 0;
    ASSERT_TRUE(r.drv->enqueueWrite(w2));
    ASSERT_TRUE(r.drv->enqueueWrite(w1));
    r.run(200);
    const auto res = r.sink.takeResults();
    ASSERT_EQ(res.size(), 2u);
    EXPECT_EQ(res[0].code, "NOT_SENT_DEVICE_SUSPENDED");
    EXPECT_EQ(res[1].code, "CONFIRMED");
    EXPECT_EQ(r.plc.requestCount(6, 2), 0u);
    EXPECT_EQ(r.plc.connections, 1);
}
