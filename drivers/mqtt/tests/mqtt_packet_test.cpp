// MQTT 3.1.1 packets (feature 022): byte layouts of the standard, round trips client <-> broker,
// the framer on split and bad streams, and a short fuzz of the decoders (MAT_FUZZ_SECONDS longer).
#include <gtest/gtest.h>

#include <chrono>
#include <cstdlib>
#include <random>

#include "drivers/mqtt/packet.hpp"

using namespace mat::mqtt;

namespace {
Packet one(const std::vector<uint8_t>& bytes) {
    Framer f;
    f.feed(bytes.data(), bytes.size());
    Packet p;
    EXPECT_EQ(f.next(p), Framer::Result::Ready);
    EXPECT_EQ(f.buffered(), 0u);
    return p;
}
}  // namespace

TEST(MqttPacket, ConnectLayout) {
    ConnectOptions o;
    o.clientId = "ab";
    o.keepAliveS = 60;
    const auto b = encodeConnect(o);
    const std::vector<uint8_t> want = {0x10, 14,   0, 4,  'M', 'Q', 'T', 'T',
                                       4,    0x02, 0, 60, 0,   2,   'a', 'b'};
    EXPECT_EQ(b, want);
}

TEST(MqttPacket, ConnectRoundTrip) {
    ConnectOptions o;
    o.clientId = "mat-plc1";
    o.keepAliveS = 30;
    o.cleanSession = false;
    o.hasUsername = o.hasPassword = true;
    o.username = "op";
    o.password = "s3cret";
    o.hasWill = true;
    o.willTopic = "mat/status";
    o.willPayload = "offline";
    o.willQos = 1;
    o.willRetain = true;
    ConnectOptions r;
    ASSERT_TRUE(parseConnect(one(encodeConnect(o)), r));
    EXPECT_EQ(r.clientId, o.clientId);
    EXPECT_EQ(r.keepAliveS, 30);
    EXPECT_FALSE(r.cleanSession);
    EXPECT_EQ(r.username, "op");
    EXPECT_EQ(r.password, "s3cret");
    EXPECT_TRUE(r.hasWill);
    EXPECT_EQ(r.willTopic, "mat/status");
    EXPECT_EQ(r.willPayload, "offline");
    EXPECT_EQ(r.willQos, 1);
    EXPECT_TRUE(r.willRetain);
}

TEST(MqttPacket, PublishQos0AndQos1) {
    Publish p;
    p.topic = "a/b";
    p.payload = "12.5";
    const auto b0 = encodePublish(p);
    EXPECT_EQ(b0, (std::vector<uint8_t>{0x30, 9, 0, 3, 'a', '/', 'b', '1', '2', '.', '5'}));
    p.qos = 1;
    p.packetId = 0x1234;
    p.retain = true;
    Publish r;
    ASSERT_TRUE(parsePublish(one(encodePublish(p)), r));
    EXPECT_EQ(r.topic, "a/b");
    EXPECT_EQ(r.payload, "12.5");
    EXPECT_EQ(r.qos, 1);
    EXPECT_TRUE(r.retain);
    EXPECT_EQ(r.packetId, 0x1234);
}

TEST(MqttPacket, PublishRejects) {
    Packet p;
    p.type = PacketType::Publish;
    p.flags = 0x06;  // QoS 3
    p.body = {0, 1, 'a'};
    Publish r;
    EXPECT_FALSE(parsePublish(p, r));
    p.flags = 0x02;  // QoS 1, packet id 0
    p.body = {0, 1, 'a', 0, 0};
    EXPECT_FALSE(parsePublish(p, r));
    p.flags = 0;
    p.body = {0, 3, 'a', '/', '+'};  // wildcard in a topic name
    EXPECT_FALSE(parsePublish(p, r));
    p.body = {0, 5, 'a'};  // topic longer than the body
    EXPECT_FALSE(parsePublish(p, r));
}

TEST(MqttPacket, SubscribeSuback) {
    Subscribe s;
    s.packetId = 7;
    s.filters = {{"a/+", 1}, {"b/#", 0}};
    const auto b = encodeSubscribe(s);
    EXPECT_EQ(b[0], 0x82);
    Subscribe r;
    ASSERT_TRUE(parseSubscribe(one(b), r));
    EXPECT_EQ(r.packetId, 7);
    EXPECT_EQ(r.filters, s.filters);
    uint16_t id = 0;
    std::vector<uint8_t> codes;
    ASSERT_TRUE(parseSuback(one(encodeSuback(7, {1, 0x80})), id, codes));
    EXPECT_EQ(id, 7);
    EXPECT_EQ(codes, (std::vector<uint8_t>{1, 0x80}));
    EXPECT_FALSE(parseSuback(one(encodeSuback(7, {3})), id, codes));
}

TEST(MqttPacket, ConnackPingPuback) {
    Connack c;
    ASSERT_TRUE(parseConnack(one(encodeConnack({true, 5})), c));
    EXPECT_TRUE(c.sessionPresent);
    EXPECT_EQ(c.returnCode, 5);
    EXPECT_EQ(one(encodePingresp()).type, PacketType::Pingresp);
    EXPECT_EQ(encodePingreq(), (std::vector<uint8_t>{0xC0, 0}));
    EXPECT_EQ(encodeDisconnect(), (std::vector<uint8_t>{0xE0, 0}));
    uint16_t id = 0;
    const Packet pa = one(encodePuback(0xBEEF));
    EXPECT_EQ(pa.type, PacketType::Puback);
    ASSERT_TRUE(parsePacketId(pa, id));
    EXPECT_EQ(id, 0xBEEF);
}

TEST(MqttPacket, RemainingLength) {
    for (size_t n : {0u, 127u, 128u, 16383u, 16384u, 2097151u, 2097152u, 268435455u}) {
        std::vector<uint8_t> out;
        ASSERT_TRUE(appendRemainingLength(out, n));
        EXPECT_EQ(out.size(), n < 128 ? 1u : n < 16384 ? 2u : n < 2097152 ? 3u : 4u) << n;
    }
    std::vector<uint8_t> out;
    EXPECT_FALSE(appendRemainingLength(out, 268435456u));
}

TEST(MqttPacket, FramerSplitAndJoined) {
    Publish p;
    p.topic = "t";
    p.payload = std::string(300, 'x');  // two length bytes
    auto bytes = encodePublish(p);
    const auto ping = encodePingresp();
    bytes.insert(bytes.end(), ping.begin(), ping.end());
    Framer f;
    Packet out;
    for (size_t i = 0; i < bytes.size(); ++i) {
        f.feed(&bytes[i], 1);
        if (i + 1 < bytes.size() - 2) {
            EXPECT_EQ(f.next(out), Framer::Result::Need) << i;
        }
    }
    ASSERT_EQ(f.next(out), Framer::Result::Ready);
    EXPECT_EQ(out.type, PacketType::Publish);
    ASSERT_EQ(f.next(out), Framer::Result::Ready);
    EXPECT_EQ(out.type, PacketType::Pingresp);
    EXPECT_EQ(f.next(out), Framer::Result::Need);
}

TEST(MqttPacket, FramerErrors) {
    Packet out;
    {
        Framer f;
        const uint8_t b[] = {0x30, 0xFF, 0xFF, 0xFF, 0xFF, 0x01};  // five length bytes
        f.feed(b, sizeof b);
        EXPECT_EQ(f.next(out), Framer::Result::Error);
    }
    {
        Framer f(100);
        const uint8_t b[] = {0x30, 0x80, 0x01};  // 128 > 100
        f.feed(b, sizeof b);
        EXPECT_EQ(f.next(out), Framer::Result::Error);
    }
    {
        Framer f;
        const uint8_t b[] = {0x00, 0x00};  // type 0
        f.feed(b, sizeof b);
        EXPECT_EQ(f.next(out), Framer::Result::Error);
    }
}

// Random and mutated streams: the framer and every decoder return, never read out of bounds
// (ASan in the -Sanitize build).
TEST(MqttPacket, Fuzz) {
    const char* env = std::getenv("MAT_FUZZ_SECONDS");
    const int seconds = env ? std::atoi(env) : 0;
    const auto until = std::chrono::steady_clock::now() + std::chrono::seconds(seconds);
    std::mt19937 rng(22);
    Publish seed;
    seed.topic = "plant/t1";
    seed.payload = "{\"v\":1}";
    seed.qos = 1;
    seed.packetId = 3;
    const auto base = encodePublish(seed);
    long rounds = 0;
    do {
        for (int k = 0; k < 2000; ++k, ++rounds) {
            std::vector<uint8_t> b = base;
            if (rng() % 3 == 0) {
                b.resize(rng() % 64);
                for (auto& x : b) x = static_cast<uint8_t>(rng());
            } else {
                for (int m = 0; m < 3; ++m) b[rng() % b.size()] = static_cast<uint8_t>(rng());
            }
            Framer f(4096);
            f.feed(b.data(), b.size());
            Packet p;
            while (f.next(p) == Framer::Result::Ready) {
                Publish pu;
                Connack ca;
                ConnectOptions co;
                Subscribe su;
                uint16_t id = 0;
                std::vector<uint8_t> codes;
                parsePublish(p, pu);
                parseConnack(p, ca);
                parseConnect(p, co);
                parseSubscribe(p, su);
                parseSuback(p, id, codes);
                parsePacketId(p, id);
            }
        }
    } while (std::chrono::steady_clock::now() < until);
    EXPECT_GT(rounds, 0);
}
