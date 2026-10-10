#include "server/websocket/live_hub.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <map>
#include <mutex>
#include <set>
#include <thread>

#include "nlohmann/json.hpp"

using namespace mat;
using nlohmann::json;

namespace {

struct FakeTransport : LiveTransport {
    std::mutex mu;
    std::map<uint64_t, std::vector<std::string>> sent;
    std::map<uint64_t, int> closed;
    std::set<uint64_t> overflowSids;

    SendQueue::PushResult push(uint64_t sid, std::string text) override {
        std::lock_guard<std::mutex> g(mu);
        if (overflowSids.count(sid)) return SendQueue::PushResult::Overflow;
        sent[sid].push_back(std::move(text));
        return SendQueue::PushResult::Ok;
    }
    void close(uint64_t sid, int code, const std::string&) override {
        std::lock_guard<std::mutex> g(mu);
        closed[sid] = code;
    }
    std::vector<json> msgs(uint64_t sid) {
        std::lock_guard<std::mutex> g(mu);
        std::vector<json> v;
        for (auto& s : sent[sid]) v.push_back(json::parse(s));
        return v;
    }
    std::vector<json> ofType(uint64_t sid, const std::string& t) {
        std::vector<json> v;
        for (auto& m : msgs(sid))
            if (m["type"] == t) v.push_back(m);
        return v;
    }
    void clear() {
        std::lock_guard<std::mutex> g(mu);
        sent.clear();
    }
};

struct Fixture : ::testing::Test {
    TagStore store;
    FakeTransport tx;
    int64_t now = 1000;
    std::unique_ptr<LiveHub> hub;

    void SetUp() override {
        store.add({"A", TagType::FLOAT32, ""});
        store.add({"B", TagType::BOOL, ""});
        store.add({"C", TagType::INT64, ""});
        store.set(0, 1.5, Quality::GOOD, 1, 1);
        store.set(1, true, Quality::GOOD, 1, 1);
        store.takeDirty();
        HubOptions o;
        o.serverVersion = "0.2.0";
        o.maxClients = 10;
        o.projectJson = R"({"projectId":"tank-demo","projectVersion":"0.1.0"})";
        hub = std::make_unique<LiveHub>(store, tx, o, [this] { return now; });
    }
    void send(uint64_t sid, const std::string& s) { hub->onMessage(sid, s.data(), s.size()); }
};

}  // namespace

TEST_F(Fixture, HelloOnOpen) {
    hub->onOpen(1);
    auto m = tx.msgs(1);
    ASSERT_EQ(m.size(), 1u);
    EXPECT_EQ(m[0]["type"], "hello");
    EXPECT_EQ(m[0]["protocolVersion"], "1.0.0");
    EXPECT_EQ(m[0]["serverVersion"], "0.2.0");
    EXPECT_EQ(m[0]["maxClients"], 10);
    EXPECT_EQ(m[0]["heartbeatMs"], 5000);
    EXPECT_EQ(m[0]["timeoutMs"], 15000);
    EXPECT_EQ(m[0]["project"]["projectId"], "tank-demo");
}

TEST_F(Fixture, SnapshotKeepsRequestedOrderAndListsUnknown) {
    hub->onOpen(1);
    send(1, R"({"type":"subscribe","requestId":"r1","tags":["B","X","A"],"mode":"delta"})");
    auto s = tx.ofType(1, "snapshot");
    ASSERT_EQ(s.size(), 1u);
    EXPECT_EQ(s[0]["subscriptionId"], "r1");
    ASSERT_EQ(s[0]["tags"].size(), 2u);
    EXPECT_EQ(s[0]["tags"][0]["id"], "B");
    EXPECT_EQ(s[0]["tags"][0]["value"], true);
    EXPECT_EQ(s[0]["tags"][1]["id"], "A");
    EXPECT_DOUBLE_EQ(s[0]["tags"][1]["value"].get<double>(), 1.5);
    EXPECT_EQ(s[0]["tags"][1]["quality"], "GOOD");
    EXPECT_EQ(s[0]["tags"][1]["revision"], 1);
    EXPECT_TRUE(s[0]["tags"][1].contains("sourceTimestamp"));
    EXPECT_TRUE(s[0]["tags"][1].contains("serverTimestamp"));
    ASSERT_EQ(s[0]["unknown"].size(), 1u);
    EXPECT_EQ(s[0]["unknown"][0], "X");
}

TEST_F(Fixture, OnlyUnknownTagsIsAnError) {
    hub->onOpen(1);
    send(1, R"({"type":"subscribe","requestId":"r1","tags":["X"],"mode":"delta"})");
    auto e = tx.ofType(1, "error");
    ASSERT_EQ(e.size(), 1u);
    EXPECT_EQ(e[0]["code"], "NO_VALID_TAGS");
    EXPECT_TRUE(tx.ofType(1, "snapshot").empty());
}

TEST_F(Fixture, DeltaContainsOnlySubscribedChangedTagsWithIndexes) {
    hub->onOpen(1);
    send(1, R"({"type":"subscribe","requestId":"r1","tags":["B","A"],"mode":"delta"})");
    int64_t snapSeq = tx.ofType(1, "snapshot")[0]["sequence"];
    hub->tick();  // nothing changed
    EXPECT_TRUE(tx.ofType(1, "delta").empty());
    store.set(0, 2.5, Quality::GOOD, 5, 5);
    store.set(2, int64_t{7}, Quality::GOOD, 5, 5);  // not subscribed
    hub->tick();
    auto d = tx.ofType(1, "delta");
    ASSERT_EQ(d.size(), 1u);
    EXPECT_EQ(d[0]["sequence"], snapSeq + 1);
    EXPECT_EQ(d[0]["subscriptionId"], "r1");
    ASSERT_EQ(d[0]["tags"].size(), 1u);
    EXPECT_EQ(d[0]["tags"][0][0], 1);  // position of "A" in the snapshot
    EXPECT_DOUBLE_EQ(d[0]["tags"][0][1].get<double>(), 2.5);
    EXPECT_EQ(d[0]["tags"][0][2], "GOOD");
    store.set(1, false, Quality::BAD, 6, 6);
    hub->tick();
    d = tx.ofType(1, "delta");
    ASSERT_EQ(d.size(), 2u);
    EXPECT_EQ(d[1]["sequence"], snapSeq + 2);
    EXPECT_EQ(d[1]["tags"][0][0], 0);
    EXPECT_EQ(d[1]["tags"][0][1], false);
    EXPECT_EQ(d[1]["tags"][0][2], "BAD");
}

TEST_F(Fixture, ResubscribeReplacesAndUnsubscribeStops) {
    hub->onOpen(1);
    send(1, R"({"type":"subscribe","requestId":"r1","tags":["A"],"mode":"delta"})");
    send(1, R"({"type":"subscribe","requestId":"r2","tags":["B"],"mode":"delta"})");
    auto s = tx.ofType(1, "snapshot");
    ASSERT_EQ(s.size(), 2u);
    EXPECT_EQ(s[1]["subscriptionId"], "r2");
    EXPECT_GT(s[1]["sequence"].get<int64_t>(), s[0]["sequence"].get<int64_t>());
    store.set(0, 9.0, Quality::GOOD, 0, 0);  // A no longer subscribed
    hub->tick();
    EXPECT_TRUE(tx.ofType(1, "delta").empty());
    send(1, R"({"type":"unsubscribe","requestId":"r2"})");
    store.set(1, false, Quality::GOOD, 0, 0);
    hub->tick();
    EXPECT_TRUE(tx.ofType(1, "delta").empty());
}

TEST_F(Fixture, BadMessagesProduceErrorsAndRepeatedAbuseCloses) {
    hub->onOpen(1);
    send(1, "{not json");
    send(1, R"({"type":"wat"})");
    send(1, R"({"type":"subscribe","requestId":"r","tags":"all"})");
    auto e = tx.ofType(1, "error");
    ASSERT_EQ(e.size(), 3u);
    for (auto& m : e) EXPECT_EQ(m["code"], "BAD_MESSAGE");
    EXPECT_EQ(tx.closed.count(1), 0u);
    for (int i = 0; i < 17; ++i) send(1, "x");
    EXPECT_EQ(tx.closed[1], 1008);
}

TEST_F(Fixture, ValidMessageResetsErrorStreak) {
    hub->onOpen(1);
    for (int i = 0; i < 19; ++i) send(1, "x");
    send(1, R"({"type":"heartbeat","ts":1})");
    for (int i = 0; i < 19; ++i) send(1, "x");
    EXPECT_EQ(tx.closed.count(1), 0u);
}

TEST_F(Fixture, OversizedMessageCloses1009) {
    hub->onOpen(1);
    std::string big(98305, ' ');  // > 96 KiB
    send(1, big);
    EXPECT_EQ(tx.closed[1], 1009);
}

// Review I-3: 1000 tags x 64-char ids (~67 KB) must fit in one subscribe message.
TEST_F(Fixture, LargestValidSubscribeIsNotRejectedForSize) {
    hub->onOpen(1);
    json m = {{"type", "subscribe"}, {"requestId", "r"}, {"mode", "delta"}};
    std::vector<std::string> tags;
    for (int i = 0; i < 1000; ++i) {
        std::string id = "T" + std::to_string(i);
        id.resize(64, 'X');
        tags.push_back(id);
    }
    m["tags"] = tags;
    const std::string text = m.dump();
    ASSERT_GT(text.size(), 60000u);
    send(1, text);
    EXPECT_EQ(tx.closed.count(1), 0u);
    auto e = tx.ofType(1, "error");
    ASSERT_EQ(e.size(), 1u);
    EXPECT_EQ(e[0]["code"], "NO_VALID_TAGS");  // unknown ids, but parsed
}

// Review M3: deeply nested JSON must not reach the recursive parser.
TEST_F(Fixture, DeeplyNestedJsonIsRejectedWithoutCrash) {
    hub->onOpen(1);
    std::string deep(40000, '[');
    deep += std::string(40000, ']');
    send(1, deep);
    std::string obj;
    for (int i = 0; i < 33; ++i) obj += "{\"a\":";
    obj += "1" + std::string(33, '}');
    send(1, obj);
    auto e = tx.ofType(1, "error");
    ASSERT_EQ(e.size(), 2u);
    EXPECT_EQ(e[0]["code"], "BAD_MESSAGE");
    EXPECT_EQ(tx.closed.count(1), 0u);
    // brackets inside strings do not count
    send(1, R"({"type":"heartbeat","x":"[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[["})");
    EXPECT_EQ(tx.ofType(1, "error").size(), 2u);
}

// Review I-2: the heartbeat schedule must not depend on the wall clock (NTP/RTC jumps).
TEST(LiveHubClock, HeartbeatUsesMonotonicClockWhenWallClockJumpsBack) {
    TagStore store;
    store.add({"A", TagType::FLOAT32, ""});
    FakeTransport tx;
    int64_t wall = 1'800'000'000'000;
    int64_t mono = 1000;
    HubOptions o;
    LiveHub hub(
        store, tx, o, [&] { return wall; }, [&] { return mono; });
    hub.onOpen(1);
    wall -= 7 * 3600 * 1000;  // clock corrected 7 h backwards
    mono += 5000;
    hub.tick();
    auto hb = tx.ofType(1, "heartbeat");
    ASSERT_EQ(hb.size(), 1u);
    EXPECT_EQ(hb[0]["ts"], wall);  // ts still reports wall-clock time
}

TEST_F(Fixture, TooManyTagsInSubscribeIsRejected) {
    hub->onOpen(1);
    json m = {{"type", "subscribe"}, {"requestId", "r"}, {"mode", "delta"}};
    std::vector<std::string> tags;
    for (int i = 0; i < 1001; ++i) tags.push_back("T" + std::to_string(i));
    m["tags"] = tags;
    send(1, m.dump());
    auto e = tx.ofType(1, "error");
    ASSERT_EQ(e.size(), 1u);
    EXPECT_EQ(e[0]["code"], "BAD_MESSAGE");
}

TEST_F(Fixture, HeartbeatEveryFiveSecondsToOpenSessions) {
    hub->onOpen(1);
    hub->tick();
    EXPECT_TRUE(tx.ofType(1, "heartbeat").empty());
    now += 5000;
    hub->tick();
    EXPECT_EQ(tx.ofType(1, "heartbeat").size(), 1u);
    now += 1000;
    hub->tick();
    EXPECT_EQ(tx.ofType(1, "heartbeat").size(), 1u);
}

TEST_F(Fixture, OverflowDropsSessionFromDeltasAndCounts) {
    hub->onOpen(1);
    hub->onOpen(2);
    send(1, R"({"type":"subscribe","requestId":"r","tags":["A"],"mode":"delta"})");
    send(2, R"({"type":"subscribe","requestId":"r","tags":["A"],"mode":"delta"})");
    tx.overflowSids.insert(1);
    store.set(0, 3.0, Quality::GOOD, 0, 0);
    hub->tick();
    EXPECT_EQ(hub->overflowClosedTotal(), 1u);
    tx.overflowSids.clear();
    store.set(0, 4.0, Quality::GOOD, 0, 0);
    hub->tick();
    EXPECT_EQ(tx.ofType(1, "delta").size(), 0u);  // session 1 no longer served
    auto d2 = tx.ofType(2, "delta");
    ASSERT_EQ(d2.size(), 2u);
    EXPECT_EQ(d2[1]["sequence"], d2[0]["sequence"].get<int64_t>() + 1);
}

TEST_F(Fixture, CloseForgetsSession) {
    hub->onOpen(1);
    send(1, R"({"type":"subscribe","requestId":"r","tags":["A"],"mode":"delta"})");
    hub->onClose(1);
    tx.clear();
    store.set(0, 5.0, Quality::GOOD, 0, 0);
    hub->tick();
    EXPECT_TRUE(tx.msgs(1).empty());
}

// FR-020: snapshot + registration is atomic with respect to the delta producer.
TEST_F(Fixture, NoSequenceGapWhenSubscribingWhileTicking) {
    std::atomic<bool> run{true};
    std::thread producer([&] {
        double v = 0;
        while (run) {
            store.set(0, v += 1, Quality::GOOD, 0, 0);
            hub->tick();
            std::this_thread::sleep_for(std::chrono::microseconds(200));
        }
    });
    hub->onOpen(1);
    for (int i = 0; i < 100; ++i) {
        send(1, R"({"type":"subscribe","requestId":"r)" + std::to_string(i) +
                    R"(","tags":["A"],"mode":"delta"})");
        std::this_thread::yield();
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
    run = false;
    producer.join();
    // Walk the stream: after every snapshot, the next delta of that subscription is seq+1.
    std::string sub;
    int64_t seq = -1;
    int gaps = 0, snapshots = 0;
    for (auto& m : tx.msgs(1)) {
        if (m["type"] == "snapshot") {
            sub = m["subscriptionId"];
            seq = m["sequence"];
            ++snapshots;
        } else if (m["type"] == "delta") {
            ASSERT_EQ(m["subscriptionId"], sub);  // never a delta of an old subscription
            if (m["sequence"].get<int64_t>() != seq + 1) ++gaps;
            seq = m["sequence"];
        }
    }
    EXPECT_EQ(snapshots, 100);
    EXPECT_EQ(gaps, 0);
}
