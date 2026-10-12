// The Modbus TCP driver, write side (specs/006 T140; FR-014, FR-028; contracts/modbus-driver.md §8;
// data-model §8): the queue goes before the reads, the function code by the way to write, the
// readback and every result, a command is never sent twice, and item 4 of the standard driver
// suite.
#include <gtest/gtest.h>

#include <cmath>

#include "drivers/modbus/modbus_tcp_driver.hpp"
#include "drivers/modbus/tests/fake_plc.hpp"
#include "drivers/modbus/tests/tcp_harness.hpp"
#include "drivers/sdk/tests/driver_conformance.hpp"

using namespace mat;
using namespace mat::drv;
using namespace mat::testing;
using namespace mat::drv::conformance;

namespace {

struct TcpWriteTraits {
    static std::unique_ptr<Harness> make() { return std::make_unique<TcpHarness>(true, true); }
};

WriteCommand cmd(uint64_t id, size_t tag, TagScalar raw, bool readback = true,
                 int64_t deadline = 5000) {
    WriteCommand c;
    c.id = id;
    c.tag = tag;
    c.raw = std::move(raw);
    c.readback = readback;
    c.deadlineMs = deadline;
    return c;
}

// One Tag at `area`/`offset` with a PLC that knows the registers.
struct W {
    explicit W(TagBinding b, int regs = 1) {
        auto c = baseConfig();
        c.tags = {b, bind(1, 0, Area::HR, 100, TagType::INT16)};
        r = std::make_unique<Rig>(c);
        for (int i = 0; i < regs; ++i) r->plc.set(1, b.area, b.offset + i, 0);
        r->plc.set(1, Area::HR, 100, 7);
        r->start();
        r->run(50);  // connected, nothing due yet beyond the first lap
    }
    // The newest result; the sink keeps them all, so the count must have grown by one.
    WriteResult only() {
        const auto res = r->sink.takeResults();
        EXPECT_EQ(res.size(), ++seen);
        return res.empty() ? WriteResult{} : res.back();
    }
    size_t seen = 0;
    std::vector<int> fcs() {
        std::vector<int> v;
        for (const auto& q : r->plc.requests()) v.push_back(q.fc);
        return v;
    }
    std::unique_ptr<Rig> r;
};

TagBinding hr(TagType t, int offset = 0) { return bind(0, 0, Area::HR, offset, t); }

}  // namespace

INSTANTIATE_TYPED_TEST_SUITE_P(ModbusTcpWrite, DriverConformance, TcpWriteTraits);

TEST(ModbusTcpWrite, TheQueueGoesBeforeTheReadsThatAreDue) {
    auto c = baseConfig();
    c.tags = {bind(0, 0, Area::HR, 0, TagType::INT16), bind(1, 0, Area::HR, 100, TagType::INT16)};
    Rig r(c);
    r.plc.set(1, Area::HR, 0, 1);
    r.plc.set(1, Area::HR, 100, 2);
    r.start();
    ASSERT_TRUE(r.drv->enqueueWrite(cmd(1, 0, int64_t{55})));
    r.run(300);
    const auto log = r.plc.requests();
    ASSERT_GE(log.size(), 4u);
    EXPECT_EQ(log[0].fc, 6)
        << "the write is the first request, before the read blocks that are due";
    EXPECT_EQ(log[1].fc, 3) << "then its readback, which also goes before the reads";
    EXPECT_EQ(log[1].address, 0);
    const auto res = r.sink.takeResults();
    ASSERT_EQ(res.size(), 1u);
    EXPECT_EQ(res[0].id, 1u);
    EXPECT_EQ(res[0].status, WriteStatus::Confirmed);
    EXPECT_EQ(res[0].code, "CONFIRMED");
}

TEST(ModbusTcpWrite, ACoilIsWrittenWithFunction5OrWith15WhenTheDeviceSaysSo) {
    {
        W w(bind(0, 0, Area::C, 3, TagType::BOOL));
        w.r->plc.set(1, Area::C, 3, 0);
        ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, true)));
        w.r->run(100);
        EXPECT_EQ(w.r->plc.get(1, Area::C, 3), 1);
        EXPECT_GE(w.r->plc.requestCount(5), 1u);
        EXPECT_EQ(w.r->plc.requestCount(15), 0u);
        EXPECT_EQ(w.only().status, WriteStatus::Confirmed);
    }
    {
        auto b = bind(0, 0, Area::C, 3, TagType::BOOL);
        b.writeSingleCoilFc15 = true;
        W w(b);
        ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, true)));
        w.r->run(100);
        EXPECT_EQ(w.r->plc.get(1, Area::C, 3), 1);
        EXPECT_EQ(w.r->plc.requestCount(5), 0u);
        EXPECT_GE(w.r->plc.requestCount(15), 1u);
        EXPECT_EQ(w.only().status, WriteStatus::Confirmed);
    }
}

TEST(ModbusTcpWrite, OneRegisterIsWrittenWithFunction6OrWith16WhenTheDeviceSaysSo) {
    {
        W w(hr(TagType::INT16, 5));
        ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, int64_t{-2})));
        w.r->run(100);
        EXPECT_EQ(w.r->plc.get(1, Area::HR, 5), 0xFFFE);
        EXPECT_GE(w.r->plc.requestCount(6), 1u);
        EXPECT_EQ(w.r->plc.requestCount(16), 0u);
        EXPECT_EQ(w.only().status, WriteStatus::Confirmed);
    }
    {
        auto b = hr(TagType::UINT16, 5);
        b.writeSingleRegisterFc16 = true;
        W w(b);
        ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, uint64_t{40000})));
        w.r->run(100);
        EXPECT_EQ(w.r->plc.get(1, Area::HR, 5), 40000);
        EXPECT_EQ(w.r->plc.requestCount(6), 0u);
        EXPECT_GE(w.r->plc.requestCount(16), 1u);
        EXPECT_EQ(w.only().status, WriteStatus::Confirmed);
    }
}

TEST(ModbusTcpWrite, SeveralRegistersGoWithFunction16InTheByteOrderOfTheDevice) {
    auto b = hr(TagType::UINT32, 10);
    b.byteOrder = modbus::ByteOrder::CDAB;
    W w(b, 2);
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, uint64_t{0x01020304})));
    w.r->run(100);
    EXPECT_EQ(w.r->plc.get(1, Area::HR, 10), 0x0304);
    EXPECT_EQ(w.r->plc.get(1, Area::HR, 11), 0x0102);
    EXPECT_GE(w.r->plc.requestCount(16), 1u);
    const WriteResult res = w.only();
    EXPECT_EQ(res.status, WriteStatus::Confirmed);
    EXPECT_EQ(res.readback, TagScalar(uint64_t{0x01020304}));
}

TEST(ModbusTcpWrite, Float64AndStringsAreWrittenWholeAndPadded) {
    {
        W w(hr(TagType::FLOAT64, 20), 4);
        ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, 3.141592653589793)));
        w.r->run(100);
        const std::vector<uint16_t> want = {0x4009, 0x21FB, 0x5444, 0x2D18};
        for (int i = 0; i < 4; ++i)
            EXPECT_EQ(w.r->plc.get(1, Area::HR, 20 + i), want[static_cast<size_t>(i)]);
        EXPECT_EQ(w.only().status, WriteStatus::Confirmed);
    }
    {
        auto b = bind(0, 0, Area::HR, 30, TagType::STRING, 4);
        b.stringLength = 8;
        W w(b, 4);
        for (int i = 0; i < 4; ++i)
            w.r->plc.set(1, Area::HR, 30 + i, 0xFFFF);  // old content to be overwritten
        ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, std::string("Bơm 1"))));
        w.r->run(100);
        const std::vector<uint16_t> want = {0x42C6, 0xA16D, 0x2031, 0x0000};
        for (int i = 0; i < 4; ++i)
            EXPECT_EQ(w.r->plc.get(1, Area::HR, 30 + i), want[static_cast<size_t>(i)]);
        const WriteResult res = w.only();
        EXPECT_EQ(res.status, WriteStatus::Confirmed) << res.code;
        EXPECT_EQ(res.readback, TagScalar(std::string("Bơm 1")));
    }
}

TEST(ModbusTcpWrite, ABitInARegisterIsWrittenWithTheMaskFunction22) {
    auto b = bind(0, 0, Area::HR, 0, TagType::BOOL, 1, 5);
    b.bitWrite = BitWrite::Mask;
    W w(b);
    w.r->plc.set(1, Area::HR, 0, 0x0021);
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, false)));
    w.r->run(100);
    EXPECT_EQ(w.r->plc.get(1, Area::HR, 0), 0x0001)
        << "AND = ~(1 << 5), OR = 0: the other bits stay";
    EXPECT_GE(w.r->plc.requestCount(22), 1u);
    EXPECT_EQ(w.r->plc.requestCount(6), 0u);
    EXPECT_EQ(w.only().status, WriteStatus::Confirmed);
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(2, 0, true)));
    w.r->run(100);
    EXPECT_EQ(w.r->plc.get(1, Area::HR, 0), 0x0021);
    EXPECT_EQ(w.only().status, WriteStatus::Confirmed);
}

TEST(ModbusTcpWrite, ReadModifyWriteReadsFirstThenWritesTheWholeRegister) {
    auto b = bind(0, 0, Area::HR, 0, TagType::BOOL, 1, 2);
    b.bitWrite = BitWrite::ReadModifyWrite;
    W w(b);
    w.r->plc.set(1, Area::HR, 0, 0x8001);
    const size_t before = w.r->plc.requests().size();
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, true)));
    w.r->run(100);
    EXPECT_EQ(w.r->plc.get(1, Area::HR, 0), 0x8005);
    const auto log = w.r->plc.requests();
    ASSERT_GE(log.size(), before + 3);
    EXPECT_EQ(log[before].fc, 3) << "the read of the register comes first";
    EXPECT_EQ(log[before + 1].fc, 6);
    EXPECT_EQ(log[before + 2].fc, 3) << "then the readback";
    EXPECT_EQ(w.only().status, WriteStatus::Confirmed);
}

TEST(ModbusTcpWrite, ReadModifyWriteThatCannotReadSendsNothing) {
    auto b = bind(0, 0, Area::HR, 0, TagType::BOOL, 1, 2);
    b.bitWrite = BitWrite::ReadModifyWrite;
    W w(b);
    PlcFault f;
    f.kind = PlcFault::Exception;
    f.code = 4;
    f.fc = 3;
    f.count = 1;
    w.r->plc.addFault(f);
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, true)));
    w.r->run(100);
    const WriteResult res = w.only();
    EXPECT_EQ(res.status, WriteStatus::Failed);
    EXPECT_EQ(res.code, "NOT_SENT_READ_FAILED");
    EXPECT_EQ(w.r->plc.requestCount(6), 0u);
    EXPECT_EQ(w.r->plc.requestCount(22), 0u);
}

TEST(ModbusTcpWrite, TheValueReadBackIsPublishedAtOnceWithTheAfterWriteMark) {
    W w(hr(TagType::INT16, 5));
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, int64_t{99})));
    w.r->run(100);
    EXPECT_EQ(w.only().status, WriteStatus::Confirmed);
    const auto ups = w.r->updatesOf(0);
    ASSERT_FALSE(ups.empty());
    bool found = false;
    for (const auto& u : ups)
        if (u.afterWrite) {
            found = true;
            EXPECT_EQ(u.quality, Quality::GOOD);
            EXPECT_EQ(u.value, TagScalar(int64_t{99}));
        }
    EXPECT_TRUE(found) << "no update carried the afterWrite mark";
}

TEST(ModbusTcpWrite, WithoutReadbackTheAnswerAloneConfirms) {
    W w(hr(TagType::INT16, 5));
    const size_t before = w.r->plc.requests().size();
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, int64_t{12}, false)));
    w.r->run(100);
    const WriteResult res = w.only();
    EXPECT_EQ(res.status, WriteStatus::NoReadback);
    EXPECT_EQ(res.code, "NO_READBACK");
    EXPECT_EQ(w.r->plc.requests().size(), before + 1) << "no read after the write";
}

TEST(ModbusTcpWrite, ADifferentValueReadBackIsAMismatchWithTheValueFound) {
    W w(hr(TagType::INT16, 5));
    w.r->plc.set(1, Area::HR, 5, 77);
    w.r->plc.ignoreWrites = true;  // the PLC says yes and keeps its value
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, int64_t{12})));
    w.r->run(100);
    const WriteResult res = w.only();
    EXPECT_EQ(res.status, WriteStatus::Failed);
    EXPECT_EQ(res.code, "READBACK_MISMATCH");
    EXPECT_EQ(res.readback, TagScalar(int64_t{77}));
}

TEST(ModbusTcpWrite, FloatsAreComparedBitForBitAndStringsByteForByte) {
    {
        W w(hr(TagType::FLOAT32, 10), 2);
        ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, static_cast<double>(123.456f))));
        w.r->run(100);
        EXPECT_EQ(w.only().status, WriteStatus::Confirmed);
        EXPECT_EQ(w.r->plc.get(1, Area::HR, 10), 0x42F6);
        EXPECT_EQ(w.r->plc.get(1, Area::HR, 11), 0xE979);
    }
    {
        // the PLC rounds the written float: one bit differs, so it is not confirmed
        W w(hr(TagType::FLOAT32, 10), 2);
        w.r->plc.ignoreWrites = true;
        w.r->plc.setRegs(1, Area::HR, 10, {0x42F6, 0xE97A});
        ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, static_cast<double>(123.456f))));
        w.r->run(100);
        EXPECT_EQ(w.only().code, "READBACK_MISMATCH");
    }
}

TEST(ModbusTcpWrite, AnExceptionOnTheReadbackAndASilentReadbackAreTheirOwnResults) {
    {
        W w(hr(TagType::INT16, 5));
        PlcFault f;
        f.kind = PlcFault::Exception;
        f.code = 2;
        f.fc = 3;
        f.count = 1;
        w.r->plc.addFault(f);
        ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, int64_t{3})));
        w.r->run(100);
        const WriteResult res = w.only();
        EXPECT_EQ(res.status, WriteStatus::Failed);
        EXPECT_EQ(res.code, "READBACK_ERROR");
        EXPECT_EQ(res.exception, 2);
    }
    {
        W w(hr(TagType::INT16, 5));
        PlcFault f;
        f.kind = PlcFault::Silent;
        f.fc = 3;
        f.count = 1;
        w.r->plc.addFault(f);
        ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, int64_t{3})));
        w.r->run(1500);
        const WriteResult res = w.only();
        EXPECT_EQ(res.status, WriteStatus::Timeout);
        EXPECT_EQ(res.code, "READBACK_TIMEOUT");
    }
}

TEST(ModbusTcpWrite, ADeviceExceptionOnTheWriteFailsItAndKeepsTheConnection) {
    W w(hr(TagType::INT16, 5));
    PlcFault f;
    f.kind = PlcFault::Exception;
    f.code = 3;
    f.fc = 6;
    f.count = 1;
    w.r->plc.addFault(f);
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, int64_t{3})));
    w.r->run(100);
    const WriteResult res = w.only();
    EXPECT_EQ(res.status, WriteStatus::Failed);
    EXPECT_EQ(res.code, "DEVICE_EXCEPTION");
    EXPECT_EQ(res.exception, 3);
    EXPECT_EQ(w.r->plc.connections, 1);
    EXPECT_EQ(w.r->plc.requestCount(6), 1u);
    EXPECT_EQ(w.r->diag().devices[0].writes.failed, 1u);
}

TEST(ModbusTcpWrite, ACommandThatWasSentIsNeverSentAgain) {
    W w(hr(TagType::INT16, 5));
    PlcFault f;
    f.kind = PlcFault::Silent;
    f.fc = 6;
    f.count = 1;
    w.r->plc.addFault(f);
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, int64_t{3})));
    w.r->run(1500);
    const WriteResult res = w.only();
    EXPECT_EQ(res.status, WriteStatus::Timeout);
    EXPECT_EQ(res.code, "WRITE_TIMEOUT");
    // the connection was lost, opened again, many laps passed: still one write on the wire
    w.r->run(20000);
    EXPECT_EQ(w.r->plc.requestCount(6), 1u);
    EXPECT_EQ(w.r->sink.resultCount(), 1u) << "no second result";
    EXPECT_EQ(w.r->diag().devices[0].writes.timeout, 1u);
}

TEST(ModbusTcpWrite, AConnectionClosedBeforeTheSendIsOpenedAgainOnceAndTheWriteGoes) {
    W w(hr(TagType::INT16, 5));
    w.r->plc.dropAll();
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, int64_t{8})));
    w.r->run(100);
    EXPECT_EQ(w.r->plc.connections, 2);
    EXPECT_EQ(w.only().status, WriteStatus::Confirmed);
    EXPECT_EQ(w.r->plc.get(1, Area::HR, 5), 8);
}

TEST(ModbusTcpWrite, AWriteThatCannotBeSentBecauseTheConnectionIsGoneFailsAsNotSent) {
    W w(hr(TagType::INT16, 5));
    w.r->plc.refuse = true;
    w.r->plc.dropAll();
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, int64_t{8})));
    w.r->run(100);
    const WriteResult res = w.only();
    EXPECT_EQ(res.status, WriteStatus::Failed);
    EXPECT_EQ(res.code, "NOT_SENT_DISCONNECTED");
    EXPECT_EQ(w.r->plc.requestCount(6), 0u);
    // a command queued while the channel is down gets the same answer
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(2, 0, int64_t{9})));
    w.r->run(100);
    EXPECT_EQ(w.only().code, "NOT_SENT_DISCONNECTED");
}

TEST(ModbusTcpWrite, CommandsBehindATimedOutOneAreNotSentWhenTheConnectionIsLost) {
    W w(hr(TagType::INT16, 5));
    PlcFault f;
    f.kind = PlcFault::Silent;
    f.fc = 6;
    f.count = 1;
    w.r->plc.addFault(f);
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, int64_t{1})));
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(2, 0, int64_t{2})));
    w.r->run(1500);
    const auto res = w.r->sink.takeResults();
    ASSERT_EQ(res.size(), 2u);
    EXPECT_EQ(res[0].id, 1u);
    EXPECT_EQ(res[0].code, "WRITE_TIMEOUT");
    EXPECT_EQ(res[1].id, 2u);
    EXPECT_EQ(res[1].code, "NOT_SENT_DISCONNECTED");
    EXPECT_EQ(w.r->plc.requestCount(6), 1u);
}

TEST(ModbusTcpWrite, ACommandThatWaitedLongerThanItsDeadlineIsNotSent) {
    W w(hr(TagType::INT16, 5));
    PlcFault f;
    f.kind = PlcFault::Delay;
    f.fc = 6;
    f.delayMs = 800;
    f.count = 1;
    w.r->plc.addFault(f);
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, int64_t{1})));
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(2, 0, int64_t{2}, true, 500)));
    w.r->run(2000);
    const auto res = w.r->sink.takeResults();
    ASSERT_EQ(res.size(), 2u);
    EXPECT_EQ(res[0].status, WriteStatus::Confirmed);
    EXPECT_EQ(res[1].status, WriteStatus::Failed);
    EXPECT_EQ(res[1].code, "NOT_SENT_DEADLINE");
    EXPECT_EQ(w.r->plc.requestCount(6), 1u);
    EXPECT_EQ(w.r->plc.get(1, Area::HR, 5), 1);
}

TEST(ModbusTcpWrite, TheQueueHasACapacityAndRefusesWhatIsNotItsTag) {
    auto c = baseConfig();
    c.writeQueueCapacity = 2;
    c.tags = {bind(0, 0, Area::HR, 5, TagType::INT16)};
    Rig r(c);
    r.plc.set(1, Area::HR, 5, 0);
    r.start();
    EXPECT_TRUE(r.drv->enqueueWrite(cmd(1, 0, int64_t{1})));
    EXPECT_TRUE(r.drv->enqueueWrite(cmd(2, 0, int64_t{2})));
    EXPECT_FALSE(r.drv->enqueueWrite(cmd(3, 0, int64_t{3})))
        << "queue full: the caller says QUEUE_FULL";
    EXPECT_FALSE(r.drv->enqueueWrite(cmd(4, 99, int64_t{3}))) << "no such Tag in this channel";
    r.run(500);
    EXPECT_EQ(r.sink.resultCount(), 2u);
}

TEST(ModbusTcpWrite, TwoWritersToOneTagRunInTheOrderReceived) {
    W w(hr(TagType::INT16, 5));
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(1, 0, int64_t{10})));
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(2, 0, int64_t{20})));
    w.r->run(300);
    const auto res = w.r->sink.takeResults();
    ASSERT_EQ(res.size(), 2u);
    EXPECT_EQ(res[0].id, 1u);
    EXPECT_EQ(res[1].id, 2u);
    EXPECT_EQ(w.r->plc.get(1, Area::HR, 5), 20) << "the PLC holds the later command's value";
    int writes = 0;
    int first = 0;
    for (const auto& q : w.r->plc.requests())
        if (q.fc == 6) {
            if (writes++ == 0) first = q.address;
        }
    EXPECT_EQ(writes, 2);
    EXPECT_EQ(first, 5);
}

TEST(ModbusTcpWrite, CancelQueuedWritesTakesBackWhatIsNotSentAndPublishesNothing) {
    W w(hr(TagType::INT16, 5));
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(11, 0, int64_t{1})));
    ASSERT_TRUE(w.r->drv->enqueueWrite(cmd(12, 0, int64_t{2})));
    const std::vector<uint64_t> ids = w.r->drv->cancelQueuedWrites();
    EXPECT_EQ(ids, (std::vector<uint64_t>{11, 12}));
    w.r->run(500);
    EXPECT_EQ(w.r->plc.requestCount(6), 0u) << "nothing was sent";
    EXPECT_EQ(w.r->sink.resultCount(), 0u) << "the caller reports them, the driver does not";
    EXPECT_TRUE(w.r->drv->cancelQueuedWrites().empty());
    EXPECT_TRUE(w.r->drv->enqueueWrite(cmd(13, 0, int64_t{3}))) << "the queue works again";
}
