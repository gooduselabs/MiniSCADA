// The BACnet/IP driver on fake devices (feature 020): reads with ReadPropertyMultiple and the
// quality of status-flags, errors per property, the fallback to ReadProperty, the size of a
// request, timeouts with the same invoke ID, writes with a priority and relinquish, wrong frames,
// and the connection test (Who-Is, object-list, a read).
#include "drivers/bacnet/bacnet_driver.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <map>

#include "drivers/bacnet/tests/fake_bacnet.hpp"

using namespace mat;
using namespace mat::drv;
using namespace mat::bacnet;
namespace fk = mat::bacnet::fake;

namespace {

struct Sink : EngineSink {
    std::map<size_t, TagUpdate> last;
    std::vector<TagUpdate> all;
    std::vector<WriteResult> writes;
    void publish(std::vector<TagUpdate>&& u) override {
        for (auto& x : u) {
            last[x.tag] = x;
            all.push_back(x);
        }
    }
    void writeDone(WriteResult&& r) override { writes.push_back(std::move(r)); }
};

BacnetTagBinding tag(size_t index, const std::string& address, TagType type, bool rw = false,
                     uint32_t device = 0) {
    BacnetTagBinding b;
    b.tag = index;
    b.device = device;
    b.rawType = type;
    AddressOptions o;
    o.rawType = type;
    o.rw = rw;
    b.addr = parseAddress(address, o);
    EXPECT_TRUE(b.addr.ok) << address << " " << b.addr.error;
    return b;
}

struct Rig {
    fk::Network net;
    std::shared_ptr<fk::Device> dev;
    BacnetConfig cfg;
    Sink sink;
    std::unique_ptr<BacnetDriver> driver;

    Rig() {
        dev = net.add(1001, 0x0A000032);
        dev->add(kAnalogInput, 1, Value::real(21.5f));
        dev->add(kAnalogValue, 5, Value::real(10.0f), true);
        dev->add(kAnalogOutput, 1, Value::real(0.0f), true);
        dev->add(kBinaryValue, 3, Value::enumerated(1), true);
        dev->add(kBinaryOutput, 2, Value::enumerated(0), true);
        dev->add(kMultiStateValue, 2, Value::unsignedInt(3), true);
        cfg.channelId = "bms";
        BacnetDeviceConfig d;
        d.id = "ahu1";
        d.deviceInstance = 1001;
        d.host = "10.0.0.50";
        d.timeoutMs = 1000;
        cfg.devices.push_back(d);
    }
    void start() {
        BacnetEnv env;
        env.manual = true;
        env.clock = &net.clock;
        env.makePort = [this] { return std::make_unique<fk::Port>(net); };
        env.resolve = [](const std::string& h, uint32_t& ip) { return resolveIpv4(h, ip); };
        env.uniform = [] { return 0.0; };
        env.firstInvokeId = [] { return uint8_t{10}; };
        env.sleep = [this](int64_t until) { net.clock.now = std::max(net.clock.now, until); };
        driver = std::make_unique<BacnetDriver>(cfg, env);
        driver->start(sink);
    }
    void run(int64_t ms) { driver->pump(net.clock.now + ms); }
    double real(size_t t) { return std::get<double>(sink.last.at(t).value); }
};

}  // namespace

TEST(BacnetDriver, ReadsEveryKindInOneReadPropertyMultiple) {
    Rig r;
    r.cfg.tags = {tag(0, "AI:1", TagType::FLOAT32),
                  tag(1, "BV:3", TagType::BOOL),
                  tag(2, "MSV:2", TagType::UINT16),
                  tag(3, "AI:1:units", TagType::UINT16),
                  tag(4, "AI:1:status-flags", TagType::UINT16),
                  tag(5, "DEV:1001:object-name", TagType::STRING),
                  tag(6, "AV:5", TagType::INT32)};
    r.start();
    const auto plan = r.driver->plannedRequests(0, 1);
    ASSERT_EQ(plan.size(), 1u);
    EXPECT_TRUE(plan[0].rpm);
    r.run(500);
    ASSERT_EQ(r.sink.last.size(), 7u);
    for (auto& [t, u] : r.sink.last) EXPECT_EQ(u.quality, Quality::GOOD) << t << " " << u.reason;
    EXPECT_DOUBLE_EQ(r.real(0), 21.5);
    EXPECT_EQ(std::get<bool>(r.sink.last[1].value), true);
    EXPECT_EQ(std::get<uint64_t>(r.sink.last[2].value), 3u);
    EXPECT_EQ(std::get<uint64_t>(r.sink.last[3].value), 62u);
    EXPECT_EQ(std::get<uint64_t>(r.sink.last[4].value), 0u);
    EXPECT_EQ(std::get<std::string>(r.sink.last[5].value), "Device 1001");
    EXPECT_EQ(std::get<int64_t>(r.sink.last[6].value), 10);
    EXPECT_EQ(r.dev->services.front(), kServiceReadPropertyMultiple);
}

TEST(BacnetDriver, StatusFlagsGiveTheQualityOfPresentValue) {
    Rig r;
    r.dev->add(kAnalogInput, 2, Value::real(1.0f));
    r.dev->add(kAnalogInput, 3, Value::real(2.0f));
    r.dev->setFlags(kAnalogInput, 1, 2);  // fault
    r.dev->setFlags(kAnalogInput, 2, 8);  // out-of-service
    r.dev->setFlags(kAnalogInput, 3, 4);  // overridden
    r.cfg.tags = {tag(0, "AI:1", TagType::FLOAT32), tag(1, "AI:2", TagType::FLOAT32),
                  tag(2, "AI:3", TagType::FLOAT32), tag(3, "AI:1:units", TagType::UINT16)};
    r.start();
    r.run(500);
    EXPECT_EQ(r.sink.last[0].quality, Quality::BAD);
    EXPECT_EQ(r.sink.last[0].reason, "BACNET_FAULT");
    EXPECT_EQ(r.sink.last[1].quality, Quality::UNCERTAIN);
    EXPECT_EQ(r.sink.last[1].reason, "BACNET_OUT_OF_SERVICE");
    EXPECT_DOUBLE_EQ(r.real(1), 1.0);
    EXPECT_EQ(r.sink.last[2].quality, Quality::UNCERTAIN);
    EXPECT_EQ(r.sink.last[2].reason, "BACNET_OVERRIDDEN");
    EXPECT_EQ(r.sink.last[3].quality, Quality::GOOD);  // not present-value: no flags
}

TEST(BacnetDriver, AnErrorPerPropertyMakesOnlyItsTagBad) {
    Rig r;
    r.cfg.tags = {tag(0, "AI:1", TagType::FLOAT32), tag(1, "AI:99", TagType::FLOAT32),
                  tag(2, "BV:3:65", TagType::UINT32)};  // a property the object does not have
    r.start();
    r.run(500);
    EXPECT_EQ(r.sink.last[0].quality, Quality::GOOD);
    EXPECT_EQ(r.sink.last[1].quality, Quality::BAD);
    EXPECT_EQ(r.sink.last[1].reason, "BACNET_UNKNOWN_OBJECT");
    EXPECT_EQ(r.sink.last[2].reason, "BACNET_UNKNOWN_PROPERTY");
}

TEST(BacnetDriver, NoReadPropertyMultipleFallsBackToReadProperty) {
    Rig r;
    r.dev->noRpm = true;
    r.cfg.tags = {tag(0, "AI:1", TagType::FLOAT32), tag(1, "BV:3", TagType::BOOL)};
    r.start();
    r.run(3000);
    EXPECT_EQ(r.sink.last[0].quality, Quality::GOOD);
    EXPECT_DOUBLE_EQ(r.real(0), 21.5);
    EXPECT_EQ(r.sink.last[1].quality, Quality::GOOD);
    const auto plan = r.driver->plannedRequests(0, 1);
    ASSERT_EQ(plan.size(), 4u);  // AI:1 pv + flags, BV:3 pv + flags
    EXPECT_FALSE(plan[0].rpm);
    DriverDiag d;
    r.driver->diagnostics(d, 0);
    EXPECT_EQ(d.devices[0].exceptions[1000 + kRejectUnrecognizedService], 1u);
}

TEST(BacnetDriver, RequestsFitTheMaxApduOfTheDevice) {
    Rig r;
    for (uint32_t i = 10; i < 60; ++i)
        r.dev->add(kAnalogValue, i, Value::real(static_cast<float>(i)));
    r.cfg.devices[0].maxApdu = 128;
    for (size_t i = 0; i < 50; ++i)
        r.cfg.tags.push_back(tag(i, "AV:" + std::to_string(10 + i), TagType::FLOAT32));
    r.start();
    const auto plan = r.driver->plannedRequests(0, 1);
    ASSERT_GT(plan.size(), 5u);
    for (const auto& p : plan) {
        std::vector<ObjectRefs> objs;
        for (const auto& it : p.items) {
            if (objs.empty() || !(objs.back().obj == it.obj)) objs.push_back({it.obj, {}});
            objs.back().props.push_back({it.property, it.arrayIndex});
        }
        EXPECT_LE(encodeReadPropertyMultiple(objs).size() + 4, 128u);
    }
    r.dev->maxApdu = 128;
    r.run(3000);
    for (size_t i = 0; i < 50; ++i) EXPECT_EQ(r.sink.last[i].quality, Quality::GOOD) << i;
}

TEST(BacnetDriver, AnAnswerTooLargeSplitsTheRequest) {
    Rig r;
    for (uint32_t i = 10; i < 30; ++i) r.dev->add(kAnalogValue, i, Value::real(1.0f));
    for (size_t i = 0; i < 20; ++i)
        r.cfg.tags.push_back(tag(i, "AV:" + std::to_string(10 + i), TagType::FLOAT32));
    r.start();
    ASSERT_EQ(r.driver->plannedRequests(0, 1).size(), 2u);  // 40 properties, 32 per request
    r.dev->maxApdu = 200;  // the device says less than the configuration
    r.run(10000);
    EXPECT_GT(r.driver->plannedRequests(0, 1).size(), 2u);
    for (size_t i = 0; i < 20; ++i) EXPECT_EQ(r.sink.last[i].quality, Quality::GOOD) << i;
}

TEST(BacnetDriver, TimeoutSendsAgainWithTheSameInvokeIdThenSuspends) {
    Rig r;
    r.cfg.devices[0].retries = 2;
    r.cfg.tags = {tag(0, "AI:1", TagType::FLOAT32)};
    r.dev->dropAll = true;
    r.start();
    r.run(3500);  // 3 sends of 1 s
    ASSERT_GE(r.dev->invokeIds.size(), 3u);
    EXPECT_EQ(r.dev->invokeIds[0], r.dev->invokeIds[1]);
    EXPECT_EQ(r.dev->invokeIds[1], r.dev->invokeIds[2]);
    EXPECT_EQ(r.sink.last[0].reason, "TIMEOUT");
    EXPECT_EQ(r.driver->linkState(0).device, DeviceState::Suspended);
    r.dev->dropAll = false;
    r.run(5000);  // the probe after the backoff
    EXPECT_EQ(r.sink.last[0].quality, Quality::GOOD);
    EXPECT_EQ(r.driver->linkState(0).device, DeviceState::Active);
    EXPECT_NE(r.dev->invokeIds.back(), r.dev->invokeIds[0]);
}

TEST(BacnetDriver, OneLostAnswerIsRecoveredByTheRetry) {
    Rig r;
    r.cfg.tags = {tag(0, "AI:1", TagType::FLOAT32)};
    r.dev->dropNext = 1;
    r.start();
    r.run(1500);
    EXPECT_EQ(r.sink.last[0].quality, Quality::GOOD);
    DriverDiag d;
    r.driver->diagnostics(d, 0);
    EXPECT_EQ(d.devices[0].timeouts, 1u);
}

TEST(BacnetDriver, WrongFramesAreDroppedAndCounted) {
    Rig r;
    r.cfg.tags = {tag(0, "AI:1", TagType::FLOAT32)};
    r.start();
    // an answer from another IP with any invoke ID, and garbage
    r.net.inject.push_back({fk::Network::wrapApdu({0x20, 10, kServiceReadPropertyMultiple}),
                            {0x0A000099, kDefaultPort}});
    r.net.inject.push_back({{0x81, 0x0a, 0x00, 0x05, 0x01}, {0x0A000032, kDefaultPort}});
    r.run(500);
    EXPECT_EQ(r.sink.last[0].quality, Quality::GOOD);
    DriverDiag d;
    r.driver->diagnostics(d, 0);
    EXPECT_EQ(d.devices[0].badFrames.format, 2u);
}

TEST(BacnetDriver, DeviceBehindARouter) {
    Rig r;
    r.dev->network = 5;
    r.dev->mac = {0x07};
    r.cfg.devices[0].network = 5;
    r.cfg.devices[0].mac = {0x07};
    r.cfg.tags = {tag(0, "AI:1", TagType::FLOAT32)};
    r.start();
    r.run(500);
    EXPECT_EQ(r.sink.last[0].quality, Quality::GOOD);
    Frame f;
    ASSERT_TRUE(parseFrame(r.net.sent.front(), f));
    EXPECT_EQ(r.net.sent.front()[5], 0x24);  // DNET present, expecting reply
}

TEST(BacnetDriver, WritesWithPriorityAndReadsBack) {
    Rig r;
    r.cfg.devices[0].writePriority = 10;
    r.cfg.tags = {tag(0, "BO:2@8", TagType::BOOL, true), tag(1, "AV:5", TagType::FLOAT32, true),
                  tag(2, "MSV:2", TagType::UINT16, true)};
    r.start();
    r.run(300);
    WriteCommand c;
    c.id = 1;
    c.tag = 0;
    c.raw = true;
    ASSERT_TRUE(r.driver->enqueueWrite(c));
    c.id = 2;
    c.tag = 1;
    c.raw = 21.5;
    ASSERT_TRUE(r.driver->enqueueWrite(c));
    c.id = 3;
    c.tag = 2;
    c.raw = uint64_t{4};
    ASSERT_TRUE(r.driver->enqueueWrite(c));
    r.run(300);
    ASSERT_EQ(r.sink.writes.size(), 3u);
    for (const auto& w : r.sink.writes) EXPECT_EQ(w.code, "CONFIRMED") << w.id;
    EXPECT_EQ(r.dev->wpPriorities, (std::vector<int>{8, 10, 10}));
    EXPECT_EQ(hexOf(r.dev->wpValues[0]), "9101");        // Enumerated active
    EXPECT_EQ(hexOf(r.dev->wpValues[1]), "4441ac0000");  // Real 21.5
    EXPECT_EQ(hexOf(r.dev->wpValues[2]), "2104");        // Unsigned 4
    EXPECT_TRUE(std::get<bool>(r.sink.last[0].value));
    EXPECT_TRUE(r.sink.last[0].afterWrite);
}

TEST(BacnetDriver, RelinquishCycle) {
    Rig r;
    r.cfg.tags = {tag(0, "AO:1@8", TagType::FLOAT32, true),
                  tag(1, "AO:1:relinquish@8", TagType::BOOL, true)};
    r.start();
    r.run(300);
    EXPECT_TRUE(std::get<bool>(r.sink.last[1].value));  // slot 8 is NULL
    WriteCommand c;
    c.id = 1;
    c.tag = 0;
    c.raw = 55.0;
    ASSERT_TRUE(r.driver->enqueueWrite(c));
    r.run(1100);
    EXPECT_FALSE(std::get<bool>(r.sink.last[1].value));
    EXPECT_DOUBLE_EQ(r.real(0), 55.0);
    c.id = 2;
    c.tag = 1;
    c.raw = true;
    ASSERT_TRUE(r.driver->enqueueWrite(c));
    r.run(1100);
    ASSERT_EQ(r.sink.writes.size(), 2u);
    EXPECT_EQ(r.sink.writes[1].code, "CONFIRMED");
    EXPECT_EQ(hexOf(r.dev->wpValues[1]), "00");
    EXPECT_EQ(r.dev->wpPriorities[1], 8);
    EXPECT_TRUE(std::get<bool>(r.sink.last[1].value));
    EXPECT_DOUBLE_EQ(r.real(0), 0.0);  // back to the relinquish default
}

TEST(BacnetDriver, WriteErrorsAreDeviceExceptions) {
    Rig r;
    r.cfg.tags = {tag(0, "AV:5", TagType::FLOAT32, true)};
    r.start();
    r.run(300);
    r.dev->forceErrorCode = kErrWriteAccessDenied;
    WriteCommand c;
    c.id = 7;
    c.tag = 0;
    c.raw = 1.0;
    ASSERT_TRUE(r.driver->enqueueWrite(c));
    r.run(100);
    ASSERT_EQ(r.sink.writes.size(), 1u);
    EXPECT_EQ(r.sink.writes[0].code, "DEVICE_EXCEPTION");
    EXPECT_EQ(r.sink.writes[0].exception, 40);
    EXPECT_EQ(r.sink.writes[0].status, WriteStatus::Failed);
}

TEST(BacnetDriver, AWriteIsNeverSentTwice) {
    Rig r;
    r.cfg.tags = {tag(0, "AV:5", TagType::FLOAT32, true)};
    r.start();
    r.run(300);
    r.dev->dropAll = true;
    const size_t before = r.dev->services.size();
    WriteCommand c;
    c.id = 7;
    c.tag = 0;
    c.raw = 1.0;
    ASSERT_TRUE(r.driver->enqueueWrite(c));
    r.run(1500);
    ASSERT_EQ(r.sink.writes.size(), 1u);
    EXPECT_EQ(r.sink.writes[0].code, "WRITE_TIMEOUT");
    size_t wps = 0;
    for (size_t i = before; i < r.dev->services.size(); ++i)
        if (r.dev->services[i] == kServiceWriteProperty) ++wps;
    EXPECT_EQ(wps, 1u);
}

TEST(BacnetDriver, PortBusyMakesEveryTagBadAndRetries) {
    Rig r;
    r.cfg.tags = {tag(0, "AI:1", TagType::FLOAT32)};
    r.net.portBusy = true;
    r.start();
    r.run(100);
    EXPECT_EQ(r.sink.last[0].reason, "DISCONNECTED");
    EXPECT_EQ(r.driver->linkState(0).channel, ChannelState::Error);
    DriverDiag d;
    r.driver->diagnostics(d, 0);
    EXPECT_EQ(d.channel.lastErrorCode, "PORT_BUSY");
    r.net.portBusy = false;
    r.run(2000);
    EXPECT_EQ(r.sink.last[0].quality, Quality::GOOD);
}

TEST(BacnetDriver, ForeignDeviceRegistersWithTheBbmd) {
    Rig r;
    r.cfg.bbmdHost = "10.0.0.1";
    r.cfg.bbmdTtlS = 60;
    r.cfg.tags = {tag(0, "AI:1", TagType::FLOAT32)};
    r.start();
    r.run(31000);
    size_t registrations = 0;
    for (const auto& b : r.net.sent)
        if (b.size() > 1 && b[1] == kBvlcRegisterForeignDevice) ++registrations;
    EXPECT_EQ(registrations, 2u);  // at once and after TTL / 2
}

TEST(BacnetDriver, DisabledDeviceAndChannel) {
    Rig r;
    r.cfg.devices[0].enabled = false;
    r.cfg.tags = {tag(0, "AI:1", TagType::FLOAT32)};
    r.start();
    r.run(500);
    EXPECT_EQ(r.sink.last[0].reason, "DISABLED");
    EXPECT_TRUE(r.dev->services.empty());
    WriteCommand c;
    c.tag = 0;
    c.raw = 1.0;
    EXPECT_FALSE(r.driver->enqueueWrite(c));
}

TEST(BacnetProbe, WhoIsListsTheDevices) {
    fk::Network net;
    net.add(1001, 0x0A000032);
    auto other = net.add(7, 0x0A000033);
    other->network = 5;
    other->mac = {0x07};
    fk::Port port(net);
    BacnetProbeRequest q;
    q.action = BacnetProbeRequest::Action::WhoIs;
    q.waitMs = 1000;
    const auto out = probeBacnet(q, port, net.clock, resolveIpv4);
    EXPECT_EQ(out.base.code, "OK");
    ASSERT_EQ(out.devices.size(), 2u);
    EXPECT_EQ(out.devices[0].instance, 7u);
    EXPECT_EQ(out.devices[0].network, 5);
    EXPECT_EQ(hexOf(out.devices[0].mac), "07");
    EXPECT_EQ(out.devices[1].instance, 1001u);
    EXPECT_EQ(out.devices[1].host, "10.0.0.50");
    EXPECT_EQ(out.devices[1].maxApdu, 1476u);
    EXPECT_EQ(net.sent.front()[1], kBvlcOriginalBroadcast);
}

TEST(BacnetProbe, ObjectListWholeOrElementByElement) {
    for (bool segmented : {false, true}) {
        fk::Network net;
        auto d = net.add(1001, 0x0A000032);
        d->add(kAnalogInput, 1, Value::real(1.0f));
        d->add(kBinaryValue, 2, Value::enumerated(0));
        d->segmentedObjectList = segmented;
        fk::Port port(net);
        BacnetProbeRequest q;
        q.action = BacnetProbeRequest::Action::Objects;
        q.host = "10.0.0.50";
        q.deviceInstance = 1001;
        const auto out = probeBacnet(q, port, net.clock, resolveIpv4);
        EXPECT_EQ(out.base.code, "OK");
        ASSERT_EQ(out.objects.size(), 3u) << segmented;
        ASSERT_EQ(out.objectNames.size(), 3u);
        EXPECT_NE(std::find(out.objectNames.begin(), out.objectNames.end(), "AI-1"),
                  out.objectNames.end());
        EXPECT_FALSE(out.truncated);
    }
}

TEST(BacnetProbe, ReadsAValueOrNamesTheError) {
    fk::Network net;
    auto d = net.add(1001, 0x0A000032);
    d->add(kAnalogInput, 1, Value::real(21.5f));
    fk::Port port(net);
    BacnetProbeRequest q;
    q.host = "10.0.0.50";
    q.deviceInstance = 1001;
    auto out = probeBacnet(q, port, net.clock, resolveIpv4);
    EXPECT_EQ(out.base.code, "OK");
    EXPECT_EQ(out.valueText, "Device 1001");
    EXPECT_EQ(out.valueKind, "string");
    AddressOptions o;
    o.rawType = TagType::FLOAT32;
    q.hasAddress = true;
    q.addr = parseAddress("AI:1", o);
    out = probeBacnet(q, port, net.clock, resolveIpv4);
    EXPECT_EQ(out.valueText, "21.5");
    q.addr = parseAddress("AI:9", o);
    out = probeBacnet(q, port, net.clock, resolveIpv4);
    EXPECT_EQ(out.base.code, "BACNET_ERROR");
    EXPECT_EQ(out.errorCode, 31u);
    q.host = "10.0.0.77";
    q.timeoutMs = 500;
    out = probeBacnet(q, port, net.clock, resolveIpv4);
    EXPECT_EQ(out.base.code, "TIMEOUT");
}

TEST(BacnetDriver, StatusFlagsAlsoGiveTheQualityWithReadPropertyOnly) {
    Rig r;
    r.dev->noRpm = true;
    r.dev->setFlags(kAnalogInput, 1, 8);  // out-of-service
    r.cfg.tags = {tag(0, "AI:1", TagType::FLOAT32)};
    r.start();
    r.run(3000);
    const auto plan = r.driver->plannedRequests(0, 1);
    ASSERT_EQ(plan.size(), 2u);
    EXPECT_EQ(plan[0].items[0].property, kPropStatusFlags);  // read before present-value
    EXPECT_EQ(r.sink.last[0].quality, Quality::UNCERTAIN);
    EXPECT_EQ(r.sink.last[0].reason, "BACNET_OUT_OF_SERVICE");
    r.dev->setFlags(kAnalogInput, 1, 0);
    r.run(2000);
    EXPECT_EQ(r.sink.last[0].quality, Quality::GOOD);
}
