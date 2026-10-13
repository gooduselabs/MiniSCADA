// T054 (feature 007; FR-045 to FR-047, research R17, contracts/device-api-1.2.md §6): the three
// optional fields of a tag write.
//  - `context` (screen, widget) reaches the audit record when it is of the shape of an id, and is
//    dropped (the command is not refused) when it is not;
//  - `expect` (BOOL Tags): the value the person saw must still be the current one, else
//    STALE_EXPECTATION and nothing goes to the field; EXPECT_NOT_BOOL for other Tags;
//  - `pulseMs` (BOOL Tags, 100 to 10000): the first write, a wait on the monotonic clock of the
//    runtime, the opposite write at the front of the driver's queue; CONFIRMED only after both;
//    PULSE_RELEASE_FAILED when the second fails; nothing sent twice; quiesce releases at once.
//  - the order of the checks of 006 FR-037 with the new ones in their places.
#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <functional>
#include <thread>

#include "core/tag-engine/engine.hpp"
#include "core/tag-engine/tests/write_fakes.hpp"
#include "core/tag-engine/write_coordinator.hpp"

using namespace mat;
using namespace mat::testing;

namespace {

struct Rig {
    explicit Rig(CoordinatorOptions o = {}) : backend(ev), audit(ev), model(makeModel()) {
        addModelTagsToStore(model, store);
        o.monoMs = [this] { return mono.load(); };
        o.wallMs = [this] { return wall.load(); };
        o.clockSynced = [](int64_t) { return true; };
        o.log = [](const std::string&) {};
        store.set(RUN, false, Quality::GOOD, 1, 1);
        store.set(NOREAD, false, Quality::GOOD, 1, 1);
        store.set(SP, 72.5, Quality::GOOD, 1, 1);
        coord = std::make_unique<WriteCoordinator>(model, store, backend, audit, o);
    }
    ~Rig() { coord.reset(); }

    WriteCaller who(const std::string& session = "sess-1") {
        WriteCaller w;
        w.user = "vh1";
        w.role = "operator";
        w.source = "10.0.0.7:51000";
        w.sessionKey = session;
        w.channel = "web";
        return w;
    }
    WriteView one(WriteRequest req) { return coord->submit(who(), {std::move(req)}).at(0); }
    WriteRequest req(const std::string& tag, WriteValue v, int n = 1) {
        WriteRequest q;
        q.requestId = idN(n);
        q.tag = tag;
        q.value = std::move(v);
        return q;
    }
    WriteRequest pulse(int64_t ms, bool value = true, int n = 1) {
        WriteRequest q = req("RUN", WriteValue::boolean(value), n);
        q.pulseMs = ms;
        return q;
    }
    void done(uint64_t id, drv::WriteStatus st = drv::WriteStatus::Confirmed,
              const char* code = "CONFIRMED") {
        drv::WriteResult r;
        r.id = id;
        r.status = st;
        r.code = code;
        coord->onDriverResult(r);
    }
    bool waitFor(const std::function<bool()>& pred, int ms = 3000) {
        const auto end = std::chrono::steady_clock::now() + std::chrono::milliseconds(ms);
        while (std::chrono::steady_clock::now() < end) {
            if (pred()) return true;
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        }
        return pred();
    }
    size_t finishedCount() {
        coord->waitAuditIdle();
        std::lock_guard<std::mutex> g(audit.mu);
        return audit.finishedRecs.size();
    }

    Events ev;
    FakeBackend backend;
    FakeAudit audit;
    ProjectModel model;
    TagStore store;
    std::atomic<int64_t> mono{1000000};
    std::atomic<int64_t> wall{1791600000000LL};
    std::unique_ptr<WriteCoordinator> coord;
};

}  // namespace

// ---------- context ----------

TEST(WriteContext, AnIdShapedContextGoesToTheRecordOfReceipt) {
    Rig r;
    WriteRequest q = r.req("SP", WriteValue::number(50));
    q.context = {"tong-quan", "btn_start"};
    ASSERT_EQ(r.one(q).status, "ACCEPTED");
    ASSERT_EQ(r.audit.startedRecs.size(), 1u);
    const auto j = nlohmann::json::parse(r.audit.startedRecs[0].contextJson);
    EXPECT_EQ(j["screen"], "tong-quan");
    EXPECT_EQ(j["widget"], "btn_start");
}

TEST(WriteContext, AFieldOfTheWrongShapeIsDroppedAndTheCommandStillRuns) {
    Rig r;
    const std::string tooLong(65, 'a');
    struct Case {
        const char* screen;
        std::string widget;
    };
    int n = 0;
    for (const Case& k : {Case{"Tong-Quan", "ok"}, Case{"1abc", "ok"}, Case{"a b", "ok"},
                          Case{"ok", "<img src=x onerror=1>"}, Case{"ok", tooLong}, Case{"", ""},
                          Case{"a\nb", "ok"}, Case{"ok", "ünï"}}) {
        WriteRequest q = r.req("SP", WriteValue::number(50), ++n);
        q.context = {k.screen, k.widget};
        ASSERT_EQ(r.one(q).status, "ACCEPTED") << k.screen << "|" << k.widget;
        const WriteRecord rec = r.audit.startedRecs.back();
        const auto j = rec.contextJson.empty() ? nlohmann::json::object()
                                               : nlohmann::json::parse(rec.contextJson);
        // a good field survives next to a bad one
        if (std::string(k.screen) == "ok") {
            EXPECT_EQ(j.value("screen", ""), "ok");
        }
        if (k.widget == "ok") {
            EXPECT_EQ(j.value("widget", ""), "ok");
        }
        for (const char* key : {"screen", "widget"})
            if (j.contains(key)) {
                const std::string v = j[key];
                EXPECT_TRUE(!v.empty() && v.size() <= 64 && v[0] >= 'a' && v[0] <= 'z') << v;
                EXPECT_EQ(v.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789_-"),
                          std::string::npos)
                    << v;
            }
    }
}

TEST(WriteContext, ARequestWithoutAContextHasNone) {
    Rig r;
    ASSERT_EQ(r.one(r.req("SP", WriteValue::number(50))).status, "ACCEPTED");
    EXPECT_EQ(r.audit.startedRecs[0].contextJson, "");
    EXPECT_EQ(r.audit.startedRecs[0].pulseMs, 0);
    EXPECT_EQ(r.audit.startedRecs[0].expect, -1);
}

// ---------- expect ----------

TEST(WriteExpect, AMatchingValueIsWrittenAndTheRecordKeepsIt) {
    Rig r;
    WriteRequest q = r.req("RUN", WriteValue::boolean(true));
    q.expect = false;  // the person saw it off
    EXPECT_EQ(r.one(q).status, "ACCEPTED");
    EXPECT_EQ(r.backend.count(), 1u);
    EXPECT_EQ(r.audit.startedRecs[0].expect, 0);
    r.store.set(RUN, true, Quality::GOOD, 2, 2);
    WriteRequest q2 = r.req("RUN", WriteValue::boolean(false), 2);
    q2.expect = true;
    EXPECT_EQ(r.one(q2).status, "ACCEPTED");
    EXPECT_EQ(r.audit.startedRecs[1].expect, 1);
}

TEST(WriteExpect, ADifferentCurrentValueIsStaleAndNothingGoesToTheField) {
    Rig r;
    WriteRequest q = r.req("RUN", WriteValue::boolean(true));
    q.expect = true;  // the person saw it on; it is off now
    const WriteView v = r.one(q);
    EXPECT_EQ(v.status, "REJECTED");
    EXPECT_EQ(v.code, "STALE_EXPECTATION");
    EXPECT_FALSE(v.message.empty());
    EXPECT_EQ(r.backend.count(), 0u);
    EXPECT_EQ(r.ev.indexOf("started:"), -1) << "no record of receipt: it was refused";
    EXPECT_GE(r.ev.indexOf("denied:RUN:STALE_EXPECTATION"), 0);
}

TEST(WriteExpect, ATagWithoutAKnownValueCannotMatch) {
    Rig r;
    TagStore empty;
    ProjectModel m = makeModel();
    addModelTagsToStore(m, empty);  // every Tag starts BAD, with no value
    Events ev;
    FakeBackend backend(ev);
    FakeAudit audit(ev);
    CoordinatorOptions o;
    o.log = [](const std::string&) {};
    WriteCoordinator coord(m, empty, backend, audit, o);
    WriteCaller w;
    w.user = "vh1";
    w.sessionKey = "s";
    WriteRequest q;
    q.requestId = idN(1);
    q.tag = "RUN";
    q.value = WriteValue::boolean(true);
    q.expect = false;
    const WriteView v = coord.submit(w, {q}).at(0);
    EXPECT_EQ(v.status, "REJECTED");
    EXPECT_EQ(v.code, "STALE_EXPECTATION");
    EXPECT_EQ(backend.count(), 0u);
}

TEST(WriteExpect, OnlyBoolTagsHaveAnExpectation) {
    Rig r;
    int n = 0;
    for (const char* tag : {"SP", "CNT", "NAME", "INT_SET", "SIM_MAN"}) {
        WriteRequest q = r.req(tag, WriteValue::number(1), 100 + ++n);
        q.expect = true;
        const WriteView v = r.one(q);
        EXPECT_EQ(v.status, "REJECTED") << tag;
        EXPECT_EQ(v.code, "EXPECT_NOT_BOOL") << tag;
    }
    EXPECT_EQ(r.backend.count(), 0u);
}

// ---------- pulseMs: the checks ----------

TEST(WritePulse, OnlyBoolTagsAndOnlyBetween100And10000Ms) {
    Rig r;
    WriteRequest notBool = r.req("SP", WriteValue::number(1));
    notBool.pulseMs = 500;
    EXPECT_EQ(r.one(notBool).code, "PULSE_NOT_BOOL");
    int n = 0;
    for (const int64_t ms :
         {int64_t{-1}, int64_t{0}, int64_t{99}, int64_t{10001}, int64_t{600000}}) {
        const WriteView v = r.one(r.pulse(ms, true, 900 + ++n));
        EXPECT_EQ(v.status, "REJECTED") << ms;
        EXPECT_EQ(v.code, "PULSE_RANGE") << ms;
    }
    EXPECT_EQ(r.backend.count(), 0u);
    EXPECT_EQ(r.one(r.pulse(100, true, 20)).status, "ACCEPTED");
    EXPECT_EQ(r.one(r.pulse(10000, true, 21)).status, "ACCEPTED");
}

TEST(WritePulse, TheValueOfAPulseIsABoolean) {
    Rig r;
    WriteRequest q = r.req("RUN", WriteValue::number(1));
    q.pulseMs = 500;
    EXPECT_EQ(r.one(q).code, "BAD_TYPE");
}

TEST(WriteChecks, TheNewChecksAreInTheirPlacesInTheOrderOf006) {
    Rig r;
    // after "the Tag exists" and "it is writable", before the value
    WriteRequest a = r.req("NOPE", WriteValue::boolean(true), 1);
    a.expect = true;
    a.pulseMs = 5;
    EXPECT_EQ(r.one(a).code, "NO_SUCH_TAG");
    WriteRequest b = r.req("LEVEL_R", WriteValue::boolean(true), 2);
    b.expect = true;
    b.pulseMs = 5;
    EXPECT_EQ(r.one(b).code, "READ_ONLY");
    WriteRequest c = r.req("SP", WriteValue::number(1000), 3);  // value out of limits too
    c.expect = true;
    c.pulseMs = 5;
    EXPECT_EQ(r.one(c).code, "EXPECT_NOT_BOOL") << "before PULSE_NOT_BOOL";
    WriteRequest d = r.req("SP", WriteValue::number(1000), 4);
    d.pulseMs = 5;
    EXPECT_EQ(r.one(d).code, "PULSE_NOT_BOOL") << "before the range and the limits";
    WriteRequest e = r.pulse(5, true, 5);
    e.value = WriteValue::number(3);
    EXPECT_EQ(r.one(e).code, "PULSE_RANGE") << "before BAD_TYPE";
    // after the connection, before the rate
    r.backend.state = {drv::ChannelState::Error, drv::DeviceState::Error};
    WriteRequest f = r.req("RUN", WriteValue::boolean(true), 6);
    f.expect = true;  // stale as well
    EXPECT_EQ(r.one(f).code, "CONNECTION_BAD")
        << "the connection is checked before STALE_EXPECTATION";
    r.backend.state = {drv::ChannelState::Connected, drv::DeviceState::Active};
    f.requestId = idN(7);
    EXPECT_EQ(r.one(f).code, "STALE_EXPECTATION");
}

TEST(WriteChecks, AStaleRequestDoesNotSpendTheRateLimit) {
    CoordinatorOptions o;
    o.rate.sessionBurst = 1;
    o.rate.sessionPerMin = 1;
    o.rate.globalBurst = 20;
    o.rate.globalPerMin = 20;
    Rig r(o);
    WriteRequest stale = r.req("RUN", WriteValue::boolean(true), 1);
    stale.expect = true;
    EXPECT_EQ(r.one(stale).code, "STALE_EXPECTATION");
    EXPECT_EQ(r.one(r.req("SP", WriteValue::number(10), 2)).status, "ACCEPTED")
        << "the one token of the session is still there";
}

// ---------- pulseMs: the run ----------

TEST(WritePulse, FirstWriteThenTheWaitThenTheOppositeWrite) {
    Rig r;
    const WriteView v = r.one(r.pulse(500));
    ASSERT_EQ(v.status, "ACCEPTED");
    EXPECT_EQ(v.pulseMs, 500);
    ASSERT_EQ(r.backend.count(), 1u);
    const drv::WriteCommand first = r.backend.cmd(0);
    EXPECT_EQ(std::get<bool>(first.raw), true);
    EXPECT_FALSE(first.priority);
    EXPECT_EQ(r.audit.startedRecs[0].pulseMs, 500);

    r.done(first.id);  // the PLC confirmed the first write
    const WriteView hold = r.coord->status(r.who(), idN(1));
    EXPECT_EQ(hold.status, "ACCEPTED");
    EXPECT_EQ(hold.phase, "release") << "waiting for the end of the pulse";
    EXPECT_EQ(r.finishedCount(), 0u) << "no result is audited before the pulse ends";
    EXPECT_EQ(r.coord->outstanding(), 1u);

    r.mono += 499;  // not yet
    std::this_thread::sleep_for(std::chrono::milliseconds(150));
    EXPECT_EQ(r.backend.count(), 1u) << "the opposite write waits for the whole pulse";
    r.mono += 1;
    ASSERT_TRUE(r.waitFor([&] { return r.backend.count() == 2; }));
    const drv::WriteCommand second = r.backend.cmd(1);
    EXPECT_EQ(std::get<bool>(second.raw), false) << "the opposite value";
    EXPECT_TRUE(second.priority) << "at the front of the driver's queue";
    EXPECT_NE(second.id, first.id);
    EXPECT_EQ(r.coord->status(r.who(), idN(1)).phase, "release");

    r.done(second.id, drv::WriteStatus::NoReadback, "NO_READBACK");
    const WriteView end = r.coord->status(r.who(), idN(1));
    EXPECT_EQ(end.status, "CONFIRMED");
    EXPECT_EQ(end.code, "NO_READBACK");
    EXPECT_EQ(end.pulseMs, 500);
    EXPECT_TRUE(end.pulseEnded);
    EXPECT_TRUE(end.pulseReleased);
    ASSERT_EQ(r.finishedCount(), 1u);
    const auto& rec = r.audit.finishedRecs[0];
    EXPECT_EQ(rec.second.result, "ok");
    const auto p = nlohmann::json::parse(rec.second.pulseJson);
    EXPECT_EQ(p["valueMs"], 500);
    EXPECT_EQ(p["released"], true);
    EXPECT_EQ(r.coord->outstanding(), 0u);
    EXPECT_EQ(r.backend.count(), 2u) << "never a third write";
}

TEST(WritePulse, ThePulseOfAFalseValueReleasesToTrue) {
    Rig r;
    r.store.set(RUN, true, Quality::GOOD, 2, 2);
    ASSERT_EQ(r.one(r.pulse(100, false)).status, "ACCEPTED");
    r.done(r.backend.cmd(0).id);
    r.mono += 100;
    ASSERT_TRUE(r.waitFor([&] { return r.backend.count() == 2; }));
    EXPECT_EQ(std::get<bool>(r.backend.cmd(1).raw), true);
}

TEST(WritePulse, ASecondWriteThatFailsLeavesTheBitPossiblyOnAndSaysSo) {
    Rig r;
    ASSERT_EQ(r.one(r.pulse(300)).status, "ACCEPTED");
    r.done(r.backend.cmd(0).id);
    r.mono += 300;
    ASSERT_TRUE(r.waitFor([&] { return r.backend.count() == 2; }));
    r.done(r.backend.cmd(1).id, drv::WriteStatus::Timeout, "WRITE_TIMEOUT");
    const WriteView v = r.coord->status(r.who(), idN(1));
    EXPECT_EQ(v.status, "FAILED");
    EXPECT_EQ(v.code, "PULSE_RELEASE_FAILED");
    EXPECT_FALSE(v.message.empty());
    EXPECT_TRUE(v.pulseEnded);
    EXPECT_FALSE(v.pulseReleased);
    ASSERT_EQ(r.finishedCount(), 1u);
    const auto& rec = r.audit.finishedRecs[0];
    EXPECT_EQ(rec.second.result, "failed");
    EXPECT_EQ(rec.second.code, "PULSE_RELEASE_FAILED");
    EXPECT_EQ(nlohmann::json::parse(rec.second.pulseJson)["released"], false);
}

TEST(WritePulse, ADriverThatCannotTakeTheOppositeWriteIsAReleaseFailure) {
    Rig r;
    ASSERT_EQ(r.one(r.pulse(100)).status, "ACCEPTED");
    r.done(r.backend.cmd(0).id);
    r.backend.full = true;
    r.mono += 100;
    ASSERT_TRUE(
        r.waitFor([&] { return r.coord->status(r.who(), idN(1)).status == "FAILED"; }, 5000));
    EXPECT_EQ(r.coord->status(r.who(), idN(1)).code, "PULSE_RELEASE_FAILED");
    EXPECT_EQ(r.coord->outstanding(), 0u);
}

TEST(WritePulse, AFirstWriteThatFailsEndsTheCommandAndNothingElseIsSent) {
    Rig r;
    ASSERT_EQ(r.one(r.pulse(200)).status, "ACCEPTED");
    r.done(r.backend.cmd(0).id, drv::WriteStatus::Failed, "DEVICE_EXCEPTION");
    const WriteView v = r.coord->status(r.who(), idN(1));
    EXPECT_EQ(v.status, "FAILED");
    EXPECT_EQ(v.code, "DEVICE_EXCEPTION") << "the result of the first write, not a release failure";
    EXPECT_FALSE(v.pulseEnded);
    r.mono += 10000;
    std::this_thread::sleep_for(std::chrono::milliseconds(150));
    EXPECT_EQ(r.backend.count(), 1u);
    ASSERT_EQ(r.finishedCount(), 1u);
    EXPECT_TRUE(r.audit.finishedRecs[0].second.pulseJson.empty());
}

TEST(WritePulse, ATimeoutOfTheFirstWriteIsNotFollowedByARelease) {
    Rig r;
    ASSERT_EQ(r.one(r.pulse(200)).status, "ACCEPTED");
    r.done(r.backend.cmd(0).id, drv::WriteStatus::Timeout, "WRITE_TIMEOUT");
    r.mono += 10000;
    std::this_thread::sleep_for(std::chrono::milliseconds(150));
    EXPECT_EQ(r.backend.count(), 1u);
    EXPECT_EQ(r.coord->status(r.who(), idN(1)).status, "TIMEOUT");
}

TEST(WritePulse, ASecondRequestWithTheSameIdDuringThePulseIsTheSameCommand) {
    Rig r;
    ASSERT_EQ(r.one(r.pulse(500)).status, "ACCEPTED");
    r.done(r.backend.cmd(0).id);
    const WriteView again = r.one(r.pulse(500));
    EXPECT_TRUE(again.duplicate);
    EXPECT_EQ(again.status, "ACCEPTED");
    EXPECT_EQ(again.phase, "release");
    EXPECT_EQ(r.backend.count(), 1u);
    WriteRequest other = r.pulse(900);  // the same id with another pulse: another command
    EXPECT_EQ(r.one(other).code, "REQUEST_ID_CONFLICT");
}

TEST(WritePulse, OnePulseCostsOneCommandOfTheRateLimit) {
    CoordinatorOptions o;
    o.rate.sessionBurst = 2;
    o.rate.sessionPerMin = 20;
    o.rate.globalBurst = 20;
    o.rate.globalPerMin = 20;
    Rig r(o);
    ASSERT_EQ(r.one(r.pulse(100, true, 1)).status, "ACCEPTED");
    r.done(r.backend.cmd(0).id);
    r.mono += 100;
    ASSERT_TRUE(r.waitFor([&] { return r.backend.count() == 2; }));
    r.done(r.backend.cmd(1).id);
    EXPECT_EQ(r.one(r.req("SP", WriteValue::number(1), 2)).status, "ACCEPTED")
        << "the opposite write took no token";
    EXPECT_EQ(r.one(r.req("SP", WriteValue::number(2), 3)).code, "RATE_LIMITED");
}

TEST(WritePulse, ThePulseOfAnInternalTagRunsThroughTheSameStages) {
    Rig r;
    // an internal BOOL Tag: the engine answers APPLIED
    TagModel t;
    t.id = "FLAG";
    t.kind = TagKind::Internal;
    t.type = TagType::BOOL;
    t.writable = true;
    r.model.tags.push_back(t);
    // the model changed after the coordinator was made: use a new one over the same pieces
    TagStore store;
    addModelTagsToStore(r.model, store);
    Events ev;
    FakeBackend backend(ev);
    FakeAudit audit(ev);
    CoordinatorOptions o;
    std::atomic<int64_t> mono{5000};
    o.monoMs = [&] { return mono.load(); };
    o.log = [](const std::string&) {};
    WriteCoordinator coord(r.model, store, backend, audit, o);
    WriteCaller w;
    w.user = "vh1";
    w.sessionKey = "s";
    WriteRequest q;
    q.requestId = idN(1);
    q.tag = "FLAG";
    q.value = WriteValue::boolean(true);
    q.pulseMs = 100;
    ASSERT_EQ(coord.submit(w, {q}).at(0).status, "ACCEPTED");
    drv::WriteResult first;
    first.id = backend.cmd(0).id;
    first.status = drv::WriteStatus::Confirmed;
    first.code = "APPLIED";
    coord.onDriverResult(first);
    mono += 100;
    const auto end = std::chrono::steady_clock::now() + std::chrono::seconds(3);
    while (backend.count() < 2 && std::chrono::steady_clock::now() < end)
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    ASSERT_EQ(backend.count(), 2u);
    drv::WriteResult second;
    second.id = backend.cmd(1).id;
    second.status = drv::WriteStatus::Confirmed;
    second.code = "APPLIED";
    coord.onDriverResult(second);
    EXPECT_EQ(coord.status(w, idN(1)).status, "CONFIRMED");
    EXPECT_EQ(coord.status(w, idN(1)).code, "APPLIED");
}

// ---------- quiesce ----------

TEST(WritePulse, QuiesceEndsAPulseAtOnceAndWaitsForTheOppositeWrite) {
    Rig r;
    ASSERT_EQ(r.one(r.pulse(10000)).status, "ACCEPTED");
    r.done(r.backend.cmd(0).id);  // the bit is on, the pulse has 10 s to go
    std::atomic<bool> finished{false};
    WriteCoordinator::QuiesceReport rep;
    std::thread q([&] {
        rep = r.coord->quiesce();
        finished = true;
    });
    // the opposite write is sent without waiting for the time to pass
    ASSERT_TRUE(r.waitFor([&] { return r.backend.count() == 2; }));
    EXPECT_FALSE(finished) << "quiesce waits for its result";
    EXPECT_TRUE(r.backend.cmd(1).priority);
    r.done(r.backend.cmd(1).id);
    q.join();
    EXPECT_TRUE(finished);
    EXPECT_EQ(rep.unfinished, 0);
    EXPECT_EQ(r.coord->status(r.who(), idN(1)).status, "CONFIRMED");
    EXPECT_TRUE(r.coord->status(r.who(), idN(1)).pulseReleased);
    EXPECT_EQ(r.finishedCount(), 1u);
    // no new command while the project changes
    EXPECT_EQ(r.one(r.req("SP", WriteValue::number(1), 5)).code, "PROJECT_CHANGING");
}

TEST(WritePulse, QuiesceDoesNotCancelAnOppositeWriteThatWaitsInTheDriver) {
    Rig r;
    ASSERT_EQ(r.one(r.pulse(100)).status, "ACCEPTED");
    r.done(r.backend.cmd(0).id);
    r.mono += 100;
    ASSERT_TRUE(r.waitFor([&] { return r.backend.count() == 2; }));
    // the driver has not begun to send it: cancelUnsent would take it
    {
        std::lock_guard<std::mutex> g(r.backend.mu);
        r.backend.unsent = {r.backend.sent[1].second.id};
    }
    std::thread q([&] { r.coord->quiesce(); });
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    r.done(r.backend.cmd(1).id);  // the driver sends it and the PLC confirms
    q.join();
    EXPECT_EQ(r.coord->status(r.who(), idN(1)).status, "CONFIRMED")
        << "the release was waited for, not cancelled";
}

TEST(WritePulse, QuiesceStillCancelsACommandWhoseFirstWriteWasNotSent) {
    Rig r;
    ASSERT_EQ(r.one(r.pulse(5000)).status, "ACCEPTED");
    {
        std::lock_guard<std::mutex> g(r.backend.mu);
        r.backend.unsent = {r.backend.sent[0].second.id};
    }
    const auto rep = r.coord->quiesce();
    EXPECT_EQ(rep.cancelled, 1);
    const WriteView v = r.coord->status(r.who(), idN(1));
    EXPECT_EQ(v.status, "FAILED");
    EXPECT_EQ(v.code, "NOT_SENT_PROJECT_CHANGE") << "the bit never moved: nothing to release";
    EXPECT_EQ(r.backend.count(), 1u);
}
