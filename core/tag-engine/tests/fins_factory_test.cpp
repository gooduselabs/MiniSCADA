// Feature 018: an Omron FINS channel of a validated project read into the Tag model (defaults of
// the FINS device: low word first, 500 ms, one retry over UDP) and handed to the FINS driver; the
// Modbus factory leaves it alone.
#include "core/tag-engine/fins_factory.hpp"

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
    { "id": "omron1", "name": "Omron UDP", "kind": "fins",
      "fins": { "host": "10.0.0.20", "sourceNode": 5 },
      "devices": [ { "id": "cj2", "name": "CJ2M", "node": 20 },
                   { "id": "cs1", "name": "CS1", "network": 3, "node": 7, "unit": 16, "timeoutMs": 800,
                     "maxReadWords": 400, "maxGapWords": 4, "multiRead": false, "maxMultiItems": 32,
                     "byteOrder": "ABCD", "enabled": false } ] },
    { "id": "omron2", "name": "Omron TCP", "kind": "fins", "enabled": false,
      "fins": { "host": "plc.local", "port": 9601, "transport": "tcp", "sourceNetwork": 1,
                "localPort": 9600, "connectTimeoutMs": 5000, "reconnectMaxS": 20 },
      "devices": [ { "id": "cp1", "name": "CP1L" } ] }
  ]
})");

const json kTags = json::parse(R"([
  {"id":"M","kind":"external","type":"INT16","source":{"device":"plc1","address":"HR1"}},
  {"id":"A","kind":"external","type":"FLOAT32","source":{"device":"cj2","address":"D200"}},
  {"id":"B","kind":"external","type":"BOOL","access":"RW","source":{"device":"cj2","address":"W5.03","scanGroup":"fast"}},
  {"id":"C","kind":"external","type":"UINT16","access":"RW","source":{"device":"cs1","address":"C12","bcd":true}},
  {"id":"D","kind":"external","type":"BOOL","source":{"device":"cp1","address":"T5"}}
])");

}  // namespace

TEST(FinsFactory, TheModelReadsTheChannelTheDevicesAndTheAddresses) {
    std::string err;
    const auto m = buildProjectModel(projectOf(kTags, kConnections), &err);
    ASSERT_TRUE(m) << err;
    ASSERT_EQ(m->channels.size(), 3u);
    const ChannelModel& udp = m->channels[1];
    EXPECT_TRUE(udp.isFins);
    EXPECT_EQ(udp.kind, "fins");
    EXPECT_FALSE(udp.finsTcp);
    EXPECT_EQ(udp.port, 9600);
    EXPECT_EQ(udp.finsSourceNode, 5);
    const ChannelModel& tcp = m->channels[2];
    EXPECT_TRUE(tcp.finsTcp);
    EXPECT_EQ(tcp.port, 9601);
    EXPECT_EQ(tcp.finsSourceNetwork, 1);
    EXPECT_EQ(tcp.finsLocalPort, 9600);
    EXPECT_EQ(tcp.connectTimeoutMs, 5000);
    EXPECT_EQ(tcp.reconnectMaxS, 20);
    EXPECT_EQ(m->channels[0].kind, "modbus-tcp");
    EXPECT_FALSE(m->channels[0].isFins);

    const DeviceModel& cj2 = m->devices[1];
    EXPECT_EQ(cj2.byteOrder, modbus::ByteOrder::CDAB);  // Omron: low word first
    EXPECT_EQ(cj2.timeoutMs, 500);
    EXPECT_EQ(cj2.retries, 1);  // UDP
    EXPECT_EQ(cj2.finsNode, 20);
    EXPECT_EQ(cj2.maxReadWords, 999);
    EXPECT_TRUE(cj2.multiRead);
    const DeviceModel& cs1 = m->devices[2];
    EXPECT_EQ(cs1.byteOrder, modbus::ByteOrder::ABCD);
    EXPECT_EQ(cs1.finsNetwork, 3);
    EXPECT_EQ(cs1.finsUnit, 16);
    EXPECT_EQ(cs1.maxGapWords, 4);
    EXPECT_FALSE(cs1.multiRead);
    EXPECT_EQ(m->devices[3].retries, 0);  // TCP

    EXPECT_TRUE(m->tags[1].source.finsAddr.ok);
    EXPECT_EQ(m->tags[1].source.finsAddr.wordCode, 0x82);
    EXPECT_EQ(m->tags[1].source.byteOrder, modbus::ByteOrder::CDAB);
    EXPECT_EQ(m->tags[2].source.finsAddr.bit, 3);
    EXPECT_TRUE(m->tags[2].writable);
    EXPECT_TRUE(m->tags[3].source.bcd);
    EXPECT_EQ(m->tags[3].source.finsAddr.wire, 0x8000 + 12);
    EXPECT_TRUE(m->tags[3].disabled);
    EXPECT_TRUE(m->tags[4].source.finsAddr.flag);
    EXPECT_TRUE(m->tags[0].source.addr.ok);  // Modbus untouched
}

TEST(FinsFactory, OneFinsDriverPerFinsChannelAndNoModbusDriverForThem) {
    const auto m = buildProjectModel(projectOf(kTags, kConnections));
    ASSERT_TRUE(m);
    const auto modbus = makeModbusTcpDrivers(*m);
    ASSERT_EQ(modbus.size(), 1u);
    EXPECT_EQ(modbus[0].channel, 0u);
    const auto fins = makeFinsDrivers(*m, 8);
    ASSERT_EQ(fins.size(), 2u);
    EXPECT_EQ(fins[0].channel, 1u);
    EXPECT_EQ(fins[1].channel, 2u);

    const drv::FinsConfig& c = fins[0].driver->config();
    EXPECT_EQ(c.channelId, "omron1");
    EXPECT_EQ(c.host, "10.0.0.20");
    EXPECT_FALSE(c.tcp);
    EXPECT_EQ(c.sourceNode, 5);
    EXPECT_EQ(c.writeQueueCapacity, 8);
    ASSERT_EQ(c.devices.size(), 2u);
    EXPECT_EQ(c.devices[0].node, 20);
    EXPECT_EQ(c.devices[1].network, 3);
    EXPECT_EQ(c.devices[1].unit, 16);
    EXPECT_FALSE(c.devices[1].enabled);
    EXPECT_EQ(c.devices[1].maxMultiItems, 32);
    ASSERT_EQ(c.tags.size(), 3u);
    EXPECT_EQ(c.tags[0].tag, 1u);
    EXPECT_EQ(c.tags[0].device, 0u);
    EXPECT_EQ(c.tags[1].group, drv::ScanGroup::Fast);
    EXPECT_EQ(c.tags[2].tag, 3u);
    EXPECT_EQ(c.tags[2].device, 1u);
    EXPECT_TRUE(c.tags[2].bcd);

    const drv::FinsConfig& t = fins[1].driver->config();
    EXPECT_TRUE(t.tcp);
    EXPECT_FALSE(t.enabled);
    EXPECT_EQ(t.port, 9601);
    ASSERT_EQ(t.tags.size(), 1u);
    EXPECT_TRUE(t.tags[0].addr.flag);
}
