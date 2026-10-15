// T043 (feature 009; FR-045..FR-049, FR-052; contracts/live-protocol-1.3.md §1-§8): the alarm part
// of the live hub on a fake transport and a fake alarm source: hello.features, subscribeAlarms and
// the snapshot (empty too, in parts when large), alarmDelta in the tick that follows, one sequence
// per session, the hold-back table of §5, a second subscription, unsubscribe, a 1.2.0 client that
// never hears of alarms, ack on the live channel refused and audited, the rate limit.
#include <gtest/gtest.h>

#include <map>
#include <mutex>
#include <set>

#include "nlohmann/json.hpp"
#include "server/websocket/live_hub.hpp"

using namespace mat;
using nlohmann::json;

namespace {

struct FakeTransport : LiveTransport {
    std::map<uint64_t, std::vector<std::string>> sent;
    std::map<uint64_t, int> closed;
    std::map<uint64_t, int> fill;  // queue fill percent per session
    SendQueue::PushResult push(uint64_t sid, std::string text) override {
        sent[sid].push_back(std::move(text));
        return SendQueue::PushResult::Ok;
    }
    void close(uint64_t sid, int code, const std::string&) override { closed[sid] = code; }
    int queueFillPercent(uint64_t sid) override { return fill[sid]; }
    std::vector<json> ofType(uint64_t sid, const std::string& t) {
        std::vector<json> v;
        for (auto& s : sent[sid]) {
            json m = json::parse(s);
            if (m["type"] == t) v.push_back(m);
        }
        return v;
    }
    size_t count(uint64_t sid) { return sent[sid].size(); }
};

struct FakeSource : AlarmLiveSource {
    bool has = true, ready = true;
    std::map<std::string, std::string> present;  // id -> instance JSON
    AlarmLiveBatch batch;
    int64_t revision = 0;
    bool hasAlarms() const override { return has; }
    AlarmLiveSnapshot snapshot() override {
        AlarmLiveSnapshot s;
        s.ready = ready;
        s.revision = revision;
        s.counts = counts();
        s.classes = R"([{"id":"minor","name":"Nhỏ"}])";
        s.areas = R"([{"id":"bon","name":"Bồn"}])";
        for (auto& kv : present) s.instances.push_back(kv.second);
        return s;
    }
    AlarmLiveBatch takeChanges() override {
        AlarmLiveBatch b = std::move(batch);
        batch = {};
        return b;
    }
    std::string counts() const {
        return json{{"active", present.size()}, {"unack", present.size()}}.dump();
    }
    static std::string inst(const std::string& id, const std::string& state = "ACTIVE_UNACK") {
        return json{{"id", id}, {"state", state}}.dump();
    }
    // The engine changes an instance: what the hub will be told at its next tick.
    void set(const std::string& id, const std::string& state) {
        present[id] = inst(id, state);
        ++revision;
        batch.revision = revision;
        batch.counts = counts();
        batch.changes.push_back({id, present[id]});
    }
    void remove(const std::string& id) {
        present.erase(id);
        ++revision;
        batch.revision = revision;
        batch.counts = counts();
        batch.changes.push_back({id, ""});
    }
};

struct Fixture : ::testing::Test {
    TagStore store;
    FakeTransport tx;
    FakeSource src;
    int64_t now = 1000;
    std::unique_ptr<LiveHub> hub;
    void SetUp() override {
        store.add({"A", TagType::FLOAT32, ""});
        store.set(0, 1.5, Quality::GOOD, 1, 1);
        store.takeDirty();
        HubOptions o;
        o.serverVersion = "0.8.0";
        hub = std::make_unique<LiveHub>(store, tx, o, [this] { return now; });
        hub->setAlarmSource(&src);
    }
    void send(uint64_t sid, const std::string& s) { hub->onMessage(sid, s.data(), s.size()); }
    void sub(uint64_t sid, const std::string& id = "a1") {
        send(sid, R"({"type":"subscribeAlarms","requestId":")" + id + "\"}");
    }
};

}  // namespace

TEST_F(Fixture, ProtocolVersionIs130) { EXPECT_STREQ(kLiveProtocolVersion, "1.3.0"); }

TEST_F(Fixture, HelloAnnouncesTheAlarmFeatureOnlyWhenThereAreAlarms) {
    hub->onOpen(1);
    json h = json::parse(tx.sent[1][0]);
    EXPECT_EQ(h["protocolVersion"], "1.3.0");
    ASSERT_TRUE(h.contains("features"));
    EXPECT_EQ(h["features"], json::array({"alarms"}));
    src.has = false;
    hub->onOpen(2);
    EXPECT_FALSE(json::parse(tx.sent[2][0]).contains("features"));
    hub->setAlarmSource(nullptr);
    hub->onOpen(3);
    EXPECT_FALSE(json::parse(tx.sent[3][0]).contains("features"));
}

TEST_F(Fixture, SubscribeAlarmsAnswersWithAnEmptySnapshotWhenThereIsNothing) {
    hub->onOpen(1);
    sub(1);
    auto s = tx.ofType(1, "alarmSnapshot");
    ASSERT_EQ(s.size(), 1u);
    EXPECT_EQ(s[0]["subscriptionId"], "a1");
    EXPECT_EQ(s[0]["sequence"], 1);
    EXPECT_TRUE(s[0]["instances"].empty());
    EXPECT_EQ(s[0]["revision"], 0);
    EXPECT_FALSE(s[0].contains("part"));
    EXPECT_TRUE(s[0].contains("counts"));
    EXPECT_TRUE(s[0].contains("ts"));
}

TEST_F(Fixture, SnapshotWithoutAnyAlarmSourceIsEmptyWithZeroCounts) {
    hub->setAlarmSource(nullptr);
    hub->onOpen(1);
    sub(1);
    auto s = tx.ofType(1, "alarmSnapshot");
    ASSERT_EQ(s.size(), 1u);
    EXPECT_TRUE(s[0]["instances"].empty());
    EXPECT_TRUE(s[0]["classes"].empty());
    EXPECT_EQ(s[0]["counts"]["active"], 0);
    EXPECT_EQ(s[0]["counts"]["byPriority"]["critical"]["unack"], 0);
    EXPECT_EQ(s[0]["revision"], 0);
}

TEST_F(Fixture, SubscribeNeedsNoTagSubscriptionAndAMissingRequestIdIsBadMessage) {
    hub->onOpen(1);
    send(1, R"({"type":"subscribeAlarms"})");
    auto e = tx.ofType(1, "error");
    ASSERT_EQ(e.size(), 1u);
    EXPECT_EQ(e[0]["code"], "BAD_MESSAGE");
    send(1, R"({"type":"subscribeAlarms","requestId":5})");
    EXPECT_EQ(tx.ofType(1, "error").size(), 2u);
    EXPECT_TRUE(tx.ofType(1, "alarmSnapshot").empty());
}

TEST_F(Fixture, SnapshotHoldsEveryPresentInstanceAndTheCatalogue) {
    src.set("A.HH", "ACTIVE_UNACK");
    src.set("B", "RTN_UNACK");
    src.batch = {};
    hub->onOpen(1);
    sub(1);
    auto s = tx.ofType(1, "alarmSnapshot");
    ASSERT_EQ(s.size(), 1u);
    EXPECT_EQ(s[0]["instances"].size(), 2u);
    EXPECT_EQ(s[0]["revision"], 2);
    EXPECT_EQ(s[0]["classes"][0]["id"], "minor");
    EXPECT_EQ(s[0]["areas"][0]["id"], "bon");
}

TEST_F(Fixture, DeltaComesInTheNextTickWithChangedRemovedCountsAndNextSequence) {
    hub->onOpen(1);
    sub(1);
    hub->tick();
    EXPECT_TRUE(tx.ofType(1, "alarmDelta").empty());  // nothing changed: nothing sent
    src.set("P1", "ACTIVE_UNACK");
    hub->tick();
    auto d = tx.ofType(1, "alarmDelta");
    ASSERT_EQ(d.size(), 1u);
    EXPECT_EQ(d[0]["subscriptionId"], "a1");
    EXPECT_EQ(d[0]["sequence"], 2);
    EXPECT_EQ(d[0]["revision"], 1);
    EXPECT_EQ(d[0]["changed"][0]["id"], "P1");
    EXPECT_TRUE(d[0]["removed"].empty());
    EXPECT_EQ(d[0]["counts"]["active"], 1);
    src.set("P1", "ACTIVE_ACK");
    src.remove("P2");
    hub->tick();
    d = tx.ofType(1, "alarmDelta");
    ASSERT_EQ(d.size(), 2u);
    EXPECT_EQ(d[1]["sequence"], 3);
    EXPECT_EQ(d[1]["changed"][0]["state"], "ACTIVE_ACK");
    EXPECT_EQ(d[1]["removed"], json::array({"P2"}));
}

TEST_F(Fixture, SeveralChangesOfOneInstanceInATickLeaveTheLastOne) {
    hub->onOpen(1);
    sub(1);
    src.set("P1", "ACTIVE_UNACK");
    src.set("P1", "ACTIVE_ACK");
    src.set("P1", "RTN_UNACK");
    hub->tick();
    auto d = tx.ofType(1, "alarmDelta");
    ASSERT_EQ(d.size(), 1u);
    ASSERT_EQ(d[0]["changed"].size(), 1u);
    EXPECT_EQ(d[0]["changed"][0]["state"], "RTN_UNACK");
    // changed and removed of one id never together: the later one wins
    src.set("P1", "ACTIVE_UNACK");
    src.remove("P1");
    hub->tick();
    d = tx.ofType(1, "alarmDelta");
    EXPECT_TRUE(d[1]["changed"].empty());
    EXPECT_EQ(d[1]["removed"], json::array({"P1"}));
}

TEST_F(Fixture, MoreThan100ChangesAreSplitWithTheirOwnSequence) {
    hub->onOpen(1);
    sub(1);
    for (int i = 0; i < 250; ++i) src.set("I" + std::to_string(1000 + i), "ACTIVE_UNACK");
    hub->tick();
    auto d = tx.ofType(1, "alarmDelta");
    ASSERT_EQ(d.size(), 3u);
    EXPECT_EQ(d[0]["changed"].size(), 100u);
    EXPECT_EQ(d[1]["changed"].size(), 100u);
    EXPECT_EQ(d[2]["changed"].size(), 50u);
    for (size_t i = 0; i < 3; ++i) EXPECT_EQ(d[i]["sequence"], static_cast<int64_t>(i) + 2);
}

TEST_F(Fixture, LargeSnapshotComesInPartsOfAtMost100WithOneSequence) {
    for (int i = 0; i < 230; ++i) src.set("I" + std::to_string(1000 + i), "ACTIVE_UNACK");
    src.batch = {};
    hub->onOpen(1);
    tx.fill[1] = 60;  // the first part goes at once, the others wait while the queue is above the mark
    sub(1);
    auto s = tx.ofType(1, "alarmSnapshot");
    EXPECT_EQ(s.size(), 1u) << "the first part at once";
    hub->tick();
    EXPECT_EQ(tx.ofType(1, "alarmSnapshot").size(), 1u);
    tx.fill[1] = 10;
    hub->tick();
    s = tx.ofType(1, "alarmSnapshot");
    ASSERT_EQ(s.size(), 3u);
    size_t total = 0;
    for (size_t i = 0; i < 3; ++i) {
        EXPECT_EQ(s[i]["part"], static_cast<int64_t>(i) + 1);
        EXPECT_EQ(s[i]["parts"], 3);
        EXPECT_EQ(s[i]["sequence"], 1);
        EXPECT_EQ(s[i]["revision"], 230);
        EXPECT_TRUE(s[i].contains("classes") && s[i].contains("areas") && s[i].contains("counts"));
        EXPECT_LE(s[i]["instances"].size(), 100u);
        total += s[i]["instances"].size();
    }
    EXPECT_EQ(total, 230u);
}

TEST_F(Fixture, ChangesDuringTheSnapshotPartsComeAsADeltaAfterTheLastPart) {
    for (int i = 0; i < 150; ++i) src.set("I" + std::to_string(1000 + i), "ACTIVE_UNACK");
    src.batch = {};
    hub->onOpen(1);
    tx.fill[1] = 0;
    sub(1);
    tx.fill[1] = 70;
    src.set("I1000", "ACTIVE_ACK");
    hub->tick();
    EXPECT_TRUE(tx.ofType(1, "alarmDelta").empty());
    tx.fill[1] = 5;
    hub->tick();
    EXPECT_EQ(tx.ofType(1, "alarmSnapshot").size(), 2u);
    auto d = tx.ofType(1, "alarmDelta");
    ASSERT_EQ(d.size(), 1u);
    EXPECT_EQ(d[0]["sequence"], 2);
    EXPECT_EQ(d[0]["changed"][0]["id"], "I1000");
}

TEST_F(Fixture, HoldBackTableAbove50DoNotSendBelow25SendNewestWins) {
    hub->onOpen(1);
    sub(1);
    tx.fill[1] = 60;
    src.set("P1", "ACTIVE_UNACK");
    hub->tick();
    EXPECT_TRUE(tx.ofType(1, "alarmDelta").empty());
    EXPECT_EQ(hub->alarmHeldSessions(), 1u);
    src.set("P1", "RTN_UNACK");  // the newer one replaces the held one
    src.remove("P2");
    src.set("P2", "ACTIVE_UNACK");
    tx.fill[1] = 40;  // between the marks: still held
    hub->tick();
    EXPECT_TRUE(tx.ofType(1, "alarmDelta").empty());
    tx.fill[1] = 20;
    hub->tick();
    auto d = tx.ofType(1, "alarmDelta");
    ASSERT_EQ(d.size(), 1u);
    EXPECT_EQ(d[0]["sequence"], 2);  // the held ones are one message: no gap for the client
    std::map<std::string, std::string> states;
    for (auto& c : d[0]["changed"]) states[c["id"]] = c["state"];
    EXPECT_EQ(states["P1"], "RTN_UNACK");
    EXPECT_EQ(states["P2"], "ACTIVE_UNACK");
    EXPECT_EQ(d[0]["revision"], 4) << "revision and counts of the time of sending";
    EXPECT_EQ(hub->alarmHeldSessions(), 0u);
    // A removal replaces a held change.
    tx.fill[1] = 70;
    src.set("P3", "ACTIVE_UNACK");
    hub->tick();
    src.remove("P3");
    hub->tick();
    tx.fill[1] = 0;
    hub->tick();
    d = tx.ofType(1, "alarmDelta");
    ASSERT_EQ(d.size(), 2u);
    EXPECT_EQ(d[1]["removed"], json::array({"P3"}));
    EXPECT_TRUE(d[1]["changed"].empty());
    EXPECT_EQ(tx.closed.count(1), 0u) << "a held alarm never closes the session";
}

TEST_F(Fixture, ExactlyAtTheHighMarkStillSendsWhenNotHolding) {
    hub->onOpen(1);
    sub(1);
    tx.fill[1] = 50;
    src.set("P1", "ACTIVE_UNACK");
    hub->tick();
    EXPECT_EQ(tx.ofType(1, "alarmDelta").size(), 1u);
}

TEST_F(Fixture, SecondSubscriptionReplacesTheFirstAndDropsWhatWasHeld) {
    hub->onOpen(1);
    sub(1, "a1");
    tx.fill[1] = 70;
    src.set("P1", "ACTIVE_UNACK");
    hub->tick();  // held
    tx.fill[1] = 0;
    sub(1, "a2");
    auto s = tx.ofType(1, "alarmSnapshot");
    ASSERT_EQ(s.size(), 2u);
    EXPECT_EQ(s[1]["subscriptionId"], "a2");
    EXPECT_EQ(s[1]["sequence"], 2) << "the sequence goes on";
    EXPECT_EQ(s[1]["instances"].size(), 1u);
    hub->tick();
    EXPECT_TRUE(tx.ofType(1, "alarmDelta").empty()) << "the held change died with the old one";
    src.set("P2", "ACTIVE_UNACK");
    hub->tick();
    auto d = tx.ofType(1, "alarmDelta");
    ASSERT_EQ(d.size(), 1u);
    EXPECT_EQ(d[0]["subscriptionId"], "a2");
    EXPECT_EQ(d[0]["sequence"], 3);
}

TEST_F(Fixture, UnsubscribeStopsAndClearsTheHold) {
    hub->onOpen(1);
    sub(1);
    send(1, R"({"type":"unsubscribeAlarms"})");
    src.set("P1", "ACTIVE_UNACK");
    hub->tick();
    EXPECT_TRUE(tx.ofType(1, "alarmDelta").empty());
    EXPECT_TRUE(tx.ofType(1, "error").empty());
}

TEST_F(Fixture, ASessionThatNeverSubscribedHearsNothingOfAlarms) {  // a 1.2.0 client
    hub->onOpen(1);
    send(1, R"({"type":"subscribe","requestId":"r1","tags":["A"],"mode":"delta"})");
    const size_t before = tx.count(1);
    src.set("P1", "ACTIVE_UNACK");
    src.set("P2", "ACTIVE_UNACK");
    hub->tick();
    store.set(0, 9.0, Quality::GOOD, 2, 2);
    hub->tick();
    EXPECT_EQ(tx.ofType(1, "delta").size(), 1u) << "its Tags go on as before";
    for (auto& m : tx.sent[1]) {
        const std::string t = json::parse(m)["type"];
        EXPECT_NE(t, "alarmDelta");
        EXPECT_NE(t, "alarmSnapshot");
    }
    EXPECT_GT(tx.count(1), before);
}

TEST_F(Fixture, TagAndAlarmSequencesAreIndependent) {
    hub->onOpen(1);
    send(1, R"({"type":"subscribe","requestId":"r1","tags":["A"],"mode":"delta"})");
    sub(1);
    EXPECT_EQ(tx.ofType(1, "snapshot")[0]["sequence"], 1);
    EXPECT_EQ(tx.ofType(1, "alarmSnapshot")[0]["sequence"], 1);
    store.set(0, 3.0, Quality::GOOD, 3, 3);
    src.set("P1", "ACTIVE_UNACK");
    hub->tick();
    EXPECT_EQ(tx.ofType(1, "delta")[0]["sequence"], 2);
    EXPECT_EQ(tx.ofType(1, "alarmDelta")[0]["sequence"], 2);
}

TEST_F(Fixture, SubscribingBeforeTheFirstTickWaitsForIt) {
    src.ready = false;
    hub->onOpen(1);
    sub(1);
    EXPECT_TRUE(tx.ofType(1, "alarmSnapshot").empty());
    hub->tick();
    EXPECT_TRUE(tx.ofType(1, "alarmSnapshot").empty());
    src.ready = true;
    hub->tick();
    EXPECT_EQ(tx.ofType(1, "alarmSnapshot").size(), 1u);
}

TEST_F(Fixture, SubscribeAlarmsIsLimitedToFiveInTenSeconds) {
    int64_t mono = 100000;
    HubOptions o;
    hub = std::make_unique<LiveHub>(store, tx, o, [this] { return now; }, [&] { return mono; });
    hub->setAlarmSource(&src);
    hub->onOpen(1);
    for (int i = 0; i < 5; ++i) sub(1, "r" + std::to_string(i));
    EXPECT_EQ(tx.ofType(1, "alarmSnapshot").size(), 5u);
    EXPECT_TRUE(tx.ofType(1, "error").empty());
    sub(1, "r5");
    auto e = tx.ofType(1, "error");
    ASSERT_EQ(e.size(), 1u);
    EXPECT_EQ(e[0]["code"], "BAD_MESSAGE");
    EXPECT_EQ(tx.ofType(1, "alarmSnapshot").size(), 5u);
    mono += 10000;
    sub(1, "r6");
    EXPECT_EQ(tx.ofType(1, "alarmSnapshot").size(), 6u);
}

TEST_F(Fixture, AckOnTheLiveChannelIsRefusedAndAudited) {
    struct Seen {
        std::string id, occ;
        uint64_t sid;
    };
    std::vector<Seen> seen;
    hub->setRejectedAckHook([&](const std::string& id, const std::string& occ, uint64_t sid) {
        seen.push_back({id, occ, sid});
    });
    hub->onOpen(1);
    send(1, R"({"type":"ack","id":"TANK.HH","occurrence":4412})");
    send(1, R"({"type":"alarmAck","id":")" + std::string(100, 'x') + R"(","occurrence":"9"})");
    send(1, R"({"type":"shelve","id":"TANK.HH"})");  // only BAD_MESSAGE, no audit
    auto e = tx.ofType(1, "error");
    ASSERT_EQ(e.size(), 3u);
    for (auto& m : e) EXPECT_EQ(m["code"], "BAD_MESSAGE");
    ASSERT_EQ(seen.size(), 2u);
    EXPECT_EQ(seen[0].id, "TANK.HH");
    EXPECT_EQ(seen[0].occ, "4412");
    EXPECT_EQ(seen[0].sid, 1u);
    EXPECT_EQ(seen[1].id.size(), 64u);
    EXPECT_EQ(e[0]["message"], "type không hỗ trợ: ack");
}

TEST_F(Fixture, TheTagOverflowBehaviourIsUnchanged) {
    hub->onOpen(1);
    send(1, R"({"type":"subscribe","requestId":"r1","tags":["A"],"mode":"delta"})");
    struct Overflow : FakeTransport {
        SendQueue::PushResult push(uint64_t, std::string) override {
            return SendQueue::PushResult::Overflow;
        }
    } ov;
    LiveHub h2(store, ov, HubOptions{}, [] { return int64_t{1}; });
    h2.onOpen(5);  // the hello overflows: the session is dead, the counter counts it
    EXPECT_EQ(h2.overflowClosedTotal(), 1u);
}
