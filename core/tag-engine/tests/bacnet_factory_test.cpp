// Feature 020: a BACnet/IP channel of a validated project read into the Tag model (defaults of a
// BACnet device: 500 ms, 1 retry, priority 16, RPM) and handed to the BACnet driver; the Modbus
// factory leaves it alone.
#include "core/tag-engine/bacnet_factory.hpp"

#include <gtest/gtest.h>

#include "core/tag-engine/modbus_factory.hpp"
#include "core/tag-engine/tag_model.hpp"

using nlohmann::json;
using namespace mat;

namespace {

LoadedProject projectOf(const json& tags, const json& connections) {
    LoadedProject p;
    p.project = {{"schemaVersion", "1.1.0"}, {"tagFile", "tags.json"}, {"screens", json::array()}};
    p.tags = {{"schemaVersion", "1.1.0"}, {"tags", tags}};
    p.connections = connections;
    return p;
}

const json kConnections = json::parse(R"({
  "schemaVersion": "1.1.0",
  "channels": [
    { "id": "plc1", "name": "PLC", "kind": "modbus-tcp", "tcp": { "host": "10.0.0.5" },
      "devices": [ { "id": "plc1", "name": "PLC 1" } ] },
    { "id": "bms", "name": "BMS", "kind": "bacnet",
      "bacnet": { "localPort": 47809, "bbmd": { "host": "10.0.0.1", "ttlS": 120 } },
      "devices": [ { "id": "ahu1", "name": "AHU 1", "deviceInstance": 1001, "host": "10.0.0.50" },
                   { "id": "vav", "name": "VAV", "deviceInstance": 7, "host": "10.0.0.60",
                     "network": 5, "mac": "07", "maxApdu": 480, "timeoutMs": 1500, "retries": 1,
                     "writePriority": 8, "useRpm": false, "maxRpmProps": 10, "enabled": false } ] }
  ]
})");

const json kTags = json::parse(R"([
  {"id":"M","kind":"external","type":"INT16","source":{"device":"plc1","address":"HR1"}},
  {"id":"T","kind":"external","type":"FLOAT32","source":{"device":"ahu1","address":"AI:1"}},
  {"id":"S","kind":"external","type":"FLOAT32","access":"RW","source":{"device":"ahu1","address":"AV:5@8","scanGroup":"fast"}},
  {"id":"V","kind":"external","type":"BOOL","access":"RW","source":{"device":"vav","address":"BO:2"}}
])");

}  // namespace

TEST(BacnetFactory, TheModelReadsTheChannelTheDevicesAndTheAddresses) {
    std::string err;
    const auto m = buildProjectModel(projectOf(kTags, kConnections), &err);
    ASSERT_TRUE(m) << err;
    const ChannelModel& ch = m->channels[1];
    EXPECT_TRUE(ch.isBacnet);
    EXPECT_EQ(ch.kind, "bacnet");
    EXPECT_EQ(ch.port, 47809);
    EXPECT_EQ(ch.bacnetBbmdHost, "10.0.0.1");
    EXPECT_EQ(ch.bacnetBbmdTtlS, 120);
    EXPECT_FALSE(m->channels[0].isBacnet);
    const DeviceModel& a = m->devices[1];
    EXPECT_EQ(a.timeoutMs, 500);
    EXPECT_EQ(a.retries, 1);
    EXPECT_EQ(a.bacnetInstance, 1001u);
    EXPECT_EQ(a.bacnetWritePriority, 16);
    EXPECT_TRUE(a.bacnetUseRpm);
    const DeviceModel& v = m->devices[2];
    EXPECT_EQ(v.bacnetNetwork, 5);
    EXPECT_EQ(v.bacnetMac, "07");
    EXPECT_EQ(v.bacnetMaxApdu, 480);
    EXPECT_FALSE(v.bacnetUseRpm);
    EXPECT_TRUE(m->tags[1].source.bacnetAddr.ok);
    EXPECT_EQ(m->tags[2].source.bacnetAddr.priority, 8);
    EXPECT_TRUE(m->tags[3].disabled);
    EXPECT_TRUE(m->tags[0].source.addr.ok);  // Modbus untouched
}

TEST(BacnetFactory, OneBacnetDriverPerBacnetChannelAndNoModbusDriverForIt) {
    const auto m = buildProjectModel(projectOf(kTags, kConnections));
    ASSERT_TRUE(m);
    const auto modbus = makeModbusTcpDrivers(*m);
    ASSERT_EQ(modbus.size(), 1u);
    const auto bac = makeBacnetDrivers(*m, 8);
    ASSERT_EQ(bac.size(), 1u);
    EXPECT_EQ(bac[0].channel, 1u);
    const drv::BacnetConfig& c = bac[0].driver->config();
    EXPECT_EQ(c.channelId, "bms");
    EXPECT_EQ(c.localPort, 47809);
    EXPECT_EQ(c.writeQueueCapacity, 8);
    ASSERT_EQ(c.devices.size(), 2u);
    EXPECT_EQ(c.devices[0].host, "10.0.0.50");
    EXPECT_EQ(c.devices[1].mac, (bacnet::Bytes{0x07}));
    EXPECT_EQ(c.devices[1].writePriority, 8);
    ASSERT_EQ(c.tags.size(), 3u);
    EXPECT_EQ(c.tags[0].tag, 1u);
    EXPECT_EQ(c.tags[1].group, drv::ScanGroup::Fast);
    EXPECT_EQ(c.tags[2].device, 1u);
}
