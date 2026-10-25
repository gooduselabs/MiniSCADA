// The MQTT driver (feature 022) on mat-mqtt-sim in the same process: subscribe (raw, JSON,
// wildcard, QoS 1, retained), publish on write (QoS 0/1, the PUBACK timeout, a pub Tag takes the
// written value), the groups, the rate limit, the broker lost and back, staleness, user and
// password from the secrets, the will, refused subscriptions and TLS (pin, CA, wrong pin).
#include "drivers/mqtt/mqtt_driver.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <condition_variable>
#include <functional>
#include <map>
#include <mutex>
#include <thread>

#include "tools/mqtt-sim/broker.hpp"

using namespace mat;
using namespace mat::drv;
using mat::mqttsim::Broker;
using mat::mqttsim::BrokerOptions;

namespace {

struct Sink : EngineSink {
    std::mutex mu;
    std::condition_variable cv;
    std::map<size_t, TagUpdate> last;
    std::vector<TagUpdate> all;
    std::vector<WriteResult> writes;
    void publish(std::vector<TagUpdate>&& ups) override {
        std::lock_guard<std::mutex> g(mu);
        for (auto& u : ups) {
            last[u.tag] = u;
            all.push_back(u);
        }
        cv.notify_all();
    }
    void writeDone(WriteResult&& r) override {
        std::lock_guard<std::mutex> g(mu);
        writes.push_back(std::move(r));
        cv.notify_all();
    }
    // Polls every 10 ms as well: some predicates look at the broker, which notifies nobody.
    bool waitFor(const std::function<bool()>& pred, int ms = 5000) {
        const auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(ms);
        std::unique_lock<std::mutex> l(mu);
        while (!pred()) {
            if (std::chrono::steady_clock::now() >= until) return false;
            cv.wait_for(l, std::chrono::milliseconds(10));
        }
        return true;
    }
    bool tagIs(size_t tag, Quality q, const std::string& reason = "") {
        auto it = last.find(tag);
        return it != last.end() && it->second.quality == q &&
               (reason.empty() || it->second.reason == reason);
    }
};

MqttTagBinding tag(size_t index, const std::string& address, TagType t = TagType::FLOAT64) {
    MqttTagBinding b;
    b.tag = index;
    b.addr = mqtt::parseAddress(address);
    EXPECT_TRUE(b.addr.ok) << address;
    b.rawType = t;
    return b;
}

MqttConfig config(int port) {
    MqttConfig c;
    c.channelId = "mq1";
    c.host = "127.0.0.1";
    c.port = port;
    c.clientId = "mat-test";
    c.keepAliveS = 5;
    c.deviceId = "broker";
    c.timeoutMs = 1000;
    c.connectTimeoutMs = 1000;
    c.reconnectMaxS = 1;
    c.maxPublishPerS = 100;
    return c;
}

MqttEnv env() {
    MqttEnv e;
    e.uniform = [] { return 0.0; };
    return e;
}

double num(const TagUpdate& u) { return std::get<double>(u.value); }

WriteCommand cmd(uint64_t id, size_t tag, TagScalar v) {
    WriteCommand w;
    w.id = id;
    w.tag = tag;
    w.raw = std::move(v);
    return w;
}

bool waitSubscribed(Broker& b, size_t n, int ms = 3000) {
    const auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(ms);
    while (std::chrono::steady_clock::now() < until) {
        if (b.subscriptions().size() >= n && b.clients() > 0) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    return false;
}

}  // namespace

TEST(MqttDriver, SubscribeRawJsonWildcard) {
    Broker broker({});
    ASSERT_TRUE(broker.start());
    broker.publish("plant/retained", "7", 0, true);
    MqttConfig c = config(broker.port());
    c.tags = {tag(0, "plant/t1/level"), tag(1, "sensors/+/data|$.temp", TagType::FLOAT32),
              tag(2, "plant/#;qos=1", TagType::STRING), tag(3, "plant/retained", TagType::INT16),
              tag(4, "plant/run", TagType::BOOL)};
    MqttDriver d(c, env());
    Sink s;
    d.start(s);
    ASSERT_TRUE(waitSubscribed(broker, 5));
    ASSERT_TRUE(s.waitFor([&] { return s.last.count(3); }));  // the retained message
    EXPECT_EQ(std::get<int64_t>(s.last[3].value), 7);
    broker.publish("plant/t1/level", "42.5");
    broker.publish("sensors/a7/data", R"({"temp":19.25,"rh":40})", 1);
    broker.publish("plant/run", "true");
    ASSERT_TRUE(s.waitFor([&] { return s.last.count(0) && s.last.count(1) && s.last.count(4); }));
    EXPECT_EQ(num(s.last[0]), 42.5);
    EXPECT_EQ(s.last[0].quality, Quality::GOOD);
    EXPECT_EQ(num(s.last[1]), 19.25);
    EXPECT_TRUE(std::get<bool>(s.last[4].value));
    ASSERT_TRUE(s.waitFor([&] {
        return s.last.count(2) && std::get<std::string>(s.last[2].value) == "true";
    }));  // plant/# saw plant/run last
    broker.publish("sensors/a7/data", "not json");
    ASSERT_TRUE(s.waitFor([&] { return s.tagIs(1, Quality::BAD, "MQTT_PAYLOAD"); }));
    DriverDiag dg;
    d.diagnostics(dg, 0);
    EXPECT_EQ(dg.channel.state, "connected");
    d.stop();
}

TEST(MqttDriver, PublishOnWrite) {
    Broker broker({});
    ASSERT_TRUE(broker.start());
    MqttConfig c = config(broker.port());
    c.tags = {tag(0, "pub:plant/cmd/sp|$.data.sp;qos=1;retain"),
              tag(1, "pub:plant/cmd/run", TagType::BOOL),
              tag(2, "both:plant/mode", TagType::INT32)};
    MqttDriver d(c, env());
    Sink s;
    d.start(s);
    ASSERT_TRUE(s.waitFor([&] { return d.linkState(0).channel == ChannelState::Connected; }));
    ASSERT_TRUE(d.enqueueWrite(cmd(1, 0, 55.5)));
    ASSERT_TRUE(d.enqueueWrite(cmd(2, 1, true)));
    ASSERT_TRUE(d.enqueueWrite(cmd(3, 2, int64_t{3})));
    ASSERT_TRUE(s.waitFor([&] { return s.writes.size() == 3; }));
    for (const auto& w : s.writes) EXPECT_EQ(w.code, "NO_READBACK") << w.id;
    // a QoS 0 write is done once sent: the broker thread may not have read it yet
    ASSERT_TRUE(s.waitFor([&] { return broker.received().size() == 3; }));
    const auto rx = broker.received();
    ASSERT_EQ(rx.size(), 3u);
    EXPECT_EQ(rx[0].topic, "plant/cmd/sp");
    EXPECT_EQ(rx[0].payload, R"({"data":{"sp":55.5}})");
    EXPECT_EQ(rx[0].qos, 1);
    EXPECT_TRUE(rx[0].retain);
    EXPECT_EQ(rx[1].payload, "1");
    EXPECT_EQ(rx[2].payload, "3");
    // a pub Tag shows what was written; a both Tag gets its own message back from the broker
    ASSERT_TRUE(s.waitFor([&] { return s.last.count(0) && s.last.count(2); }));
    EXPECT_EQ(num(s.last[0]), 55.5);
    EXPECT_TRUE(s.last[0].afterWrite);
    EXPECT_EQ(std::get<int64_t>(s.last[2].value), 3);
    // no PUBACK: WRITE_TIMEOUT after timeoutMs
    broker.setAckPublish(false);
    ASSERT_TRUE(d.enqueueWrite(cmd(4, 0, 1.0)));
    ASSERT_TRUE(s.waitFor([&] { return s.writes.size() == 4; }, 4000));
    EXPECT_EQ(s.writes[3].code, "WRITE_TIMEOUT");
    EXPECT_EQ(s.writes[3].status, WriteStatus::Timeout);
    d.stop();
}

TEST(MqttDriver, RateLimitAndDeadline) {
    Broker broker({});
    ASSERT_TRUE(broker.start());
    MqttConfig c = config(broker.port());
    c.maxPublishPerS = 5;
    c.writeQueueCapacity = 32;
    c.tags = {tag(0, "pub:a/b")};
    MqttDriver d(c, env());
    Sink s;
    d.start(s);
    ASSERT_TRUE(s.waitFor([&] { return d.linkState(0).channel == ChannelState::Connected; }));
    const auto t0 = std::chrono::steady_clock::now();
    for (uint64_t i = 1; i <= 10; ++i) {
        WriteCommand w = cmd(i, 0, static_cast<double>(i));
        w.deadlineMs = i == 10 ? 300 : 10000;  // the last one cannot wait for its token
        ASSERT_TRUE(d.enqueueWrite(std::move(w)));
    }
    ASSERT_TRUE(s.waitFor([&] { return s.writes.size() == 10; }, 5000));
    const auto ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count();
    EXPECT_GE(ms, 700);  // 5 at once, then 5 per second
    int deadline = 0;
    for (const auto& w : s.writes)
        if (w.code == "NOT_SENT_DEADLINE") ++deadline;
    EXPECT_EQ(deadline, 1);
    EXPECT_EQ(broker.received().size(), 9u);
    d.stop();
}

TEST(MqttDriver, Groups) {
    Broker broker({});
    ASSERT_TRUE(broker.start());
    MqttConfig c = config(broker.port());
    MqttGroupConfig g;
    g.topic = "mat/plant/state";
    g.tags = {10, 11};
    g.ids = {"Tank.Level", "Pump.Run"};
    g.intervalMs = 300;
    g.onChange = true;
    c.groups = {g};
    std::mutex mu;
    double level = 1.5;
    MqttEnv e = env();
    e.groupCheckMs = 20;
    e.snapshot = [&](const std::vector<size_t>& idx, std::vector<TagValue>& out) {
        std::lock_guard<std::mutex> lk(mu);
        out.assign(idx.size(), {});
        out[0].value = level;
        out[0].quality = Quality::GOOD;
        out[1].value = true;
        out[1].quality = Quality::GOOD;
    };
    MqttDriver d(c, e);
    Sink s;
    d.start(s);
    ASSERT_TRUE(s.waitFor([&] { return broker.received().size() >= 2; }, 3000));  // periodic
    {
        std::lock_guard<std::mutex> lk(mu);
        level = 2.5;
    }
    ASSERT_TRUE(s.waitFor(
        [&] {
            for (const auto& m : broker.received())
                if (m.payload.find("\"Tank.Level\":2.5") != std::string::npos) return true;
            return false;
        },
        3000));
    const auto rx = broker.received();
    EXPECT_EQ(rx[0].topic, "mat/plant/state");
    EXPECT_NE(rx[0].payload.find("\"values\":{\"Pump.Run\":true,\"Tank.Level\":1.5}"),
              std::string::npos)
        << rx[0].payload;
    d.stop();
}

TEST(MqttDriver, BrokerLostAndBackThenStale) {
    BrokerOptions o;
    Broker broker(o);
    ASSERT_TRUE(broker.start());
    MqttConfig c = config(broker.port());
    c.staleAfterMs = 600;
    c.tags = {tag(0, "a/v"), tag(1, "pub:a/w")};
    MqttDriver d(c, env());
    Sink s;
    d.start(s);
    ASSERT_TRUE(waitSubscribed(broker, 1));
    broker.publish("a/v", "1");
    ASSERT_TRUE(s.waitFor([&] { return s.tagIs(0, Quality::GOOD); }));
    broker.stop();
    ASSERT_TRUE(s.waitFor([&] { return s.tagIs(0, Quality::BAD, "DISCONNECTED"); }, 4000));
    EXPECT_TRUE(s.tagIs(1, Quality::BAD, "DISCONNECTED"));
    ASSERT_TRUE(d.enqueueWrite(cmd(1, 1, 2.0)));
    ASSERT_TRUE(s.waitFor(
        [&] { return !s.writes.empty() && s.writes.back().code == "NOT_SENT_DISCONNECTED"; }));
    ASSERT_TRUE(broker.start());  // same port
    broker.publish("a/v", "2", 0, true);
    ASSERT_TRUE(
        s.waitFor([&] { return s.tagIs(0, Quality::GOOD) && num(s.last[0]) == 2.0; }, 5000));
    // no message for staleAfterMs: UNCERTAIN with the last value
    ASSERT_TRUE(s.waitFor([&] { return s.tagIs(0, Quality::UNCERTAIN, "MQTT_STALE"); }, 3000));
    EXPECT_EQ(num(s.last[0]), 2.0);
    broker.publish("a/v", "3");
    ASSERT_TRUE(s.waitFor([&] { return s.tagIs(0, Quality::GOOD); }));
    DriverDiag dg;
    d.diagnostics(dg, 0);
    EXPECT_GE(dg.channel.reconnects, 1u);
    d.stop();
}

TEST(MqttDriver, AuthSecretsWillAndRefused) {
    BrokerOptions o;
    o.username = "op";
    o.password = "pw-1";
    o.denyPrefix = "secret/";
    Broker broker(o);
    ASSERT_TRUE(broker.start());
    MqttConfig c = config(broker.port());
    c.hasAuth = true;
    c.username = "op";
    c.secretId = "mqtt-mq1";
    c.hasWill = true;
    c.willTopic = "mat/status";
    c.willPayload = "offline";
    c.willRetain = true;
    c.tags = {tag(0, "ok/v"), tag(1, "secret/v")};
    {
        MqttDriver d(c, env());  // no secret on the device
        Sink s;
        d.start(s);
        ASSERT_TRUE(s.waitFor([&] { return s.tagIs(0, Quality::BAD, "MQTT_SECRET_MISSING"); }));
        d.stop();
    }
    {
        MqttEnv e = env();
        e.password = [](const std::string&) { return std::optional<std::string>("wrong"); };
        MqttDriver d(c, e);
        Sink s;
        d.start(s);
        ASSERT_TRUE(s.waitFor([&] { return s.tagIs(0, Quality::BAD, "MQTT_AUTH_FAILED"); }));
        d.stop();
    }
    MqttEnv e = env();
    e.password = [](const std::string& id) {
        return id == "mqtt-mq1" ? std::optional<std::string>("pw-1") : std::nullopt;
    };
    MqttDriver d(c, e);
    Sink s;
    d.start(s);
    ASSERT_TRUE(s.waitFor([&] { return s.tagIs(1, Quality::BAD, "MQTT_SUBSCRIBE_REFUSED"); }));
    broker.publish("ok/v", "5");
    ASSERT_TRUE(s.waitFor([&] { return s.tagIs(0, Quality::GOOD); }));
    EXPECT_EQ(broker.lastConnect().willTopic, "mat/status");
    // the will goes out when the link dies without DISCONNECT (retained: a later client sees it)
    broker.kickAll();
    MqttConfig w = c;
    w.clientId = "watcher";
    w.hasWill = false;
    w.tags = {tag(5, "mat/status", TagType::STRING)};
    MqttDriver watcher(w, e);
    Sink ws;
    watcher.start(ws);
    ASSERT_TRUE(ws.waitFor([&] {
        return ws.last.count(5) && ws.last[5].quality == Quality::GOOD &&
               std::get<std::string>(ws.last[5].value) == "offline";
    }));
    watcher.stop();
    d.stop();
}

TEST(MqttDriver, TlsPinCaAndWrongPin) {
    BrokerOptions o;
    o.tls = true;
    Broker broker(o);
    ASSERT_TRUE(broker.start());
    MqttConfig c = config(broker.port());
    c.connectTimeoutMs = 3000;
    c.tls.enabled = true;
    c.tags = {tag(0, "t/v")};
    {
        c.tls.serverCertSha256 = broker.certSha256();
        MqttDriver d(c, env());
        Sink s;
        d.start(s);
        ASSERT_TRUE(waitSubscribed(broker, 1, 5000));
        broker.publish("t/v", "8");
        ASSERT_TRUE(s.waitFor([&] { return s.tagIs(0, Quality::GOOD); }));
        c.tags.push_back(tag(1, "pub:t/w"));
        d.stop();
    }
    {
        c.tls.serverCertSha256.clear();
        c.tls.caCertPem = broker.certPem();
        c.tls.serverName = "mat-mqtt-sim";
        MqttDriver d(c, env());
        Sink s;
        d.start(s);
        ASSERT_TRUE(s.waitFor([&] { return d.linkState(0).channel == ChannelState::Connected; }));
        d.stop();
    }
    {
        c.tls.caCertPem.clear();
        c.tls.serverCertSha256 = std::string(64, 'a');
        MqttDriver d(c, env());
        Sink s;
        d.start(s);
        ASSERT_TRUE(s.waitFor([&] { return s.tagIs(0, Quality::BAD, "MQTT_CERT_UNTRUSTED"); }));
        d.stop();
    }
    {
        c.tls.serverCertSha256.clear();  // neither pin nor CA: never opens
        MqttDriver d(c, env());
        Sink s;
        d.start(s);
        ASSERT_TRUE(s.waitFor([&] { return s.tagIs(0, Quality::BAD, "MQTT_CERT_UNTRUSTED"); }));
        d.stop();
    }
}

TEST(MqttDriver, DisabledAndNoDevice) {
    MqttConfig c = config(1);
    c.enabled = false;
    c.tags = {tag(0, "a")};
    MqttDriver d(c, env());
    Sink s;
    d.start(s);
    EXPECT_TRUE(s.tagIs(0, Quality::BAD, "DISABLED"));
    EXPECT_FALSE(d.enqueueWrite(cmd(1, 0, 1.0)));
    EXPECT_EQ(d.test({}).code, "NOT_SUPPORTED");
    d.stop();
}
