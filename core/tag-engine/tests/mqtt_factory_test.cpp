// Feature 022: an MQTT channel of a validated project read into the Tag model (defaults: port 1883,
// 8883 with TLS, client id mat-<channel>, keepalive 30 s, timeoutMs 2000) and handed to the MQTT
// driver with its addresses and publish groups; the Modbus factory leaves it alone.
#include "core/tag-engine/mqtt_factory.hpp"

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
    { "id": "plc1", "name": "PLC", "kind": "modbus-tcp", "tcp": { "host": "192.0.2.5" },
      "devices": [ { "id": "plc1", "name": "PLC 1" } ] },
    { "id": "mq1", "name": "Broker", "kind": "mqtt",
      "mqtt": { "host": "broker.local" },
      "devices": [ { "id": "broker1", "name": "Broker" } ] },
    { "id": "mq2", "name": "Cloud", "kind": "mqtt", "enabled": false,
      "mqtt": { "host": "192.0.2.20", "clientId": "site-7", "keepAliveS": 60, "cleanSession": false,
                "tls": { "enabled": true, "serverCertSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
                "auth": { "username": "site7", "secretId": "mqtt-mq2" },
                "will": { "topic": "site7/status", "payload": "offline", "qos": 1, "retain": true },
                "maxPublishPerS": 50, "connectTimeoutMs": 3000, "reconnectMaxS": 30,
                "publishGroups": [ { "topic": "site7/state", "tags": ["T", "M", "Nope"],
                                     "intervalMs": 5000, "onChange": true, "qos": 1 } ] },
      "devices": [ { "id": "cloud", "name": "Cloud", "timeoutMs": 4000, "staleAfterMs": 60000 } ] }
  ]
})");

const json kTags = json::parse(R"([
  {"id":"M","kind":"external","type":"INT16","source":{"device":"plc1","address":"HR1"}},
  {"id":"T","kind":"external","type":"FLOAT32","source":{"device":"broker1","address":"plant/+/t|$.v"}},
  {"id":"S","kind":"external","type":"FLOAT64","access":"RW","source":{"device":"cloud","address":"pub:site7/sp;qos=1"}},
  {"id":"N","kind":"external","type":"STRING","source":{"device":"cloud","address":"site7/name","stringLength":20}}
])");

}  // namespace

TEST(MqttFactory, TheModelReadsTheChannelsAndTheAddresses) {
    std::string err;
    const auto m = buildProjectModel(projectOf(kTags, kConnections), &err);
    ASSERT_TRUE(m) << err;
    const ChannelModel& a = m->channels[1];
    EXPECT_EQ(a.kind, "mqtt");
    EXPECT_EQ(a.host, "broker.local");
    EXPECT_EQ(a.port, 1883);
    EXPECT_EQ(a.mqttClientId, "mat-mq1");
    EXPECT_EQ(a.mqttKeepAliveS, 30);
    EXPECT_TRUE(a.mqttCleanSession);
    EXPECT_FALSE(a.mqttTls);
    EXPECT_EQ(m->devices[1].timeoutMs, 2000);
    EXPECT_EQ(m->devices[1].mqttStaleAfterMs, 0);
    const ChannelModel& b = m->channels[2];
    EXPECT_EQ(b.port, 8883);
    EXPECT_TRUE(b.mqttTls);
    EXPECT_EQ(b.mqttClientId, "site-7");
    EXPECT_TRUE(b.mqttAuth);
    EXPECT_EQ(b.mqttSecretId, "mqtt-mq2");
    EXPECT_TRUE(b.mqttWill);
    EXPECT_EQ(b.mqttWillQos, 1);
    ASSERT_EQ(b.mqttGroups.size(), 1u);
    EXPECT_EQ(b.mqttGroups[0].tags.size(), 3u);
    EXPECT_EQ(m->devices[2].mqttStaleAfterMs, 60000);
    EXPECT_TRUE(m->tags[1].source.mqttAddr.ok);
    EXPECT_TRUE(m->tags[1].source.mqttAddr.wildcard);
    EXPECT_EQ(m->tags[2].source.mqttAddr.dir, mqtt::Direction::Publish);
}

TEST(MqttFactory, DriversPerChannel) {
    std::string err;
    const auto m = buildProjectModel(projectOf(kTags, kConnections), &err);
    ASSERT_TRUE(m) << err;
    const auto drivers = makeMqttDrivers(*m, 8);
    ASSERT_EQ(drivers.size(), 2u);
    const drv::MqttConfig& a = drivers[0].driver->config();
    EXPECT_EQ(drivers[0].channel, 1u);
    ASSERT_EQ(a.tags.size(), 1u);
    EXPECT_EQ(a.tags[0].tag, 1u);
    EXPECT_EQ(a.tags[0].addr.topic, "plant/+/t");
    EXPECT_EQ(a.writeQueueCapacity, 8);
    const drv::MqttConfig& b = drivers[1].driver->config();
    EXPECT_FALSE(b.enabled);
    EXPECT_TRUE(b.tls.enabled);
    EXPECT_EQ(b.timeoutMs, 4000);
    EXPECT_EQ(b.staleAfterMs, 60000);
    EXPECT_EQ(b.maxPublishPerS, 50);
    EXPECT_EQ(b.reconnectMaxS, 30);
    ASSERT_EQ(b.tags.size(), 2u);
    EXPECT_EQ(b.tags[1].stringLength, 20);
    ASSERT_EQ(b.groups.size(), 1u);
    EXPECT_EQ(b.groups[0].tags, (std::vector<size_t>{1, 0}));  // "Nope" is not a Tag
    EXPECT_EQ(b.groups[0].ids, (std::vector<std::string>{"T", "M"}));
    EXPECT_EQ(b.groups[0].intervalMs, 5000);
    EXPECT_TRUE(b.groups[0].onChange);
    // the Modbus factory has only the Modbus channel
    EXPECT_EQ(makeModbusTcpDrivers(*m).size(), 1u);
}
