// T025: the alarm engine (FR-015..FR-023, FR-031..FR-036): hysteresis, delays, input quality,
// acknowledgement, shelving, disabling, chattering, reconciliation, determinism, no allocation.
#include "core/alarm/alarm_engine.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <new>

#include "core/alarm/tests/alarm_test_support.hpp"

// ---- allocation counter (replaces the global operator new of this test binary) ----
namespace {
std::atomic<long> gAllocs{0};
std::atomic<bool> gCount{false};
}  // namespace
#if !defined(__SANITIZE_ADDRESS__)  // under ASan the sanitizer counts allocations; the replacement would mismatch
void* operator new(std::size_t n) {
    if (gCount.load(std::memory_order_relaxed)) gAllocs.fetch_add(1, std::memory_order_relaxed);
    if (void* p = std::malloc(n ? n : 1)) return p;
    throw std::bad_alloc();
}
void* operator new[](std::size_t n) { return operator new(n); }
void operator delete(void* p) noexcept { std::free(p); }
void operator delete[](void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }
void operator delete[](void* p, std::size_t) noexcept { std::free(p); }
#define MAT_ALLOC_COUNTING 1
#endif

using namespace mat::alarm;
using namespace mat::alarm::test;
using nlohmann::json;
using Q = TagSample::Quality;

namespace {
json lowAlarm(double v = 20, double db = 2, int on = 0, int off = 0) {
    return json::array({{{"id", "LO"}, {"type", "limit"}, {"name", "Thấp"}, {"tag", "T.L"},
                         {"limits", {{"L", {{"value", v}, {"class", "minor"}}}}}, {"deadband", db},
                         {"onDelayMs", on}, {"offDelayMs", off}}});
}
json qualityTagAlarm(const std::string& on = "bad", int onDelay = 0) {
    return json::array({{{"id", "Q"}, {"type", "quality"}, {"name", "Mất tín hiệu"}, {"tag", "T.Q"},
                         {"on", on}, {"class", "minor"}, {"onDelayMs", onDelay}}});
}
json qualityDeviceAlarm(int onDelay = 0) {
    return json::array({{{"id", "QD"}, {"type", "quality"}, {"name", "PLC"}, {"device", "plc1"},
                         {"class", "minor"}, {"onDelayMs", onDelay}}});
}
int count(const std::vector<AlarmEvent>& ev, const std::string& id, AlarmEvent::Kind k) {
    int n = 0;
    for (const auto& e : ev)
        if (e.instance == id && e.kind == k) ++n;
    return n;
}
}  // namespace

// ---------------------------------------------------------------- digital and the ISA flow

TEST(AlarmEngine, DigitalStartsReturnsAndAcknowledges) {
    Rig r(digitalDefs());
    r.set("T.D", 0);
    r.run(500);
    EXPECT_TRUE(r.events.empty());
    r.set("T.D", 1);
    r.tick();
    ASSERT_EQ(r.events.size(), 1u);
    const AlarmEvent& e = r.events[0];
    EXPECT_EQ(e.kind, AlarmEvent::Kind::State);
    EXPECT_EQ(e.instance, "D");
    EXPECT_EQ(*e.from, AlarmState::Normal);
    EXPECT_EQ(*e.to, AlarmState::ActiveUnack);
    EXPECT_EQ(e.occurrence, 1);
    EXPECT_EQ(e.text, "Cảnh báo D");
    EXPECT_EQ(e.quality, "GOOD");
    ASSERT_TRUE(e.row.has_value());
    EXPECT_EQ(e.row->id, 1);
    EXPECT_FALSE(e.row->closed);
    EXPECT_EQ(e.row->classId, "minor");
    EXPECT_EQ(e.row->priority, 3);
    EXPECT_EQ(e.row->fingerprint, r.defs.instances[0].fingerprint);
    EXPECT_EQ(r.state("D"), AlarmState::ActiveUnack);
    r.set("T.D", 0);
    r.tick();
    EXPECT_EQ(r.state("D"), AlarmState::RtnUnack);
    ASSERT_TRUE(r.events.back().row->tsReturnMs.has_value());
    EXPECT_FALSE(r.events.back().row->closed);
    CommandResult res = r.ack("D", 1);
    EXPECT_EQ(res.result, "ACKED");
    EXPECT_EQ(r.state("D"), AlarmState::Normal);
    const AlarmEvent& last = r.events.back();
    EXPECT_EQ(last.closedBy, ClosedBy::Return);
    EXPECT_TRUE(last.row->closed);
    EXPECT_TRUE(last.row->tsReturnAckMs.has_value());
    EXPECT_TRUE(last.row->tsAckMs.has_value());  // set to the same moment (data-model)
    EXPECT_EQ(*last.row->returnAckUser, "op1");
}

TEST(AlarmEngine, DigitalTriggerFalseAndIntegerNonZero) {
    nlohmann::json a = json::array(
        {{{"id", "F"}, {"type", "digital"}, {"name", "Dừng"}, {"tag", "T.F"}, {"trigger", false}, {"class", "minor"}},
         {{"id", "I"}, {"type", "digital"}, {"name", "Số"}, {"tag", "T.I"}, {"trigger", true}, {"class", "minor"}}});
    Rig r(makeDefs(a, classesJson()));
    r.set("T.F", 1);
    r.set("T.I", 0);
    r.run(500);
    EXPECT_EQ(r.state("F"), AlarmState::Normal);
    r.set("T.F", 0);
    r.set("T.I", 7);  // an integer: non-zero is true
    r.tick();
    EXPECT_EQ(r.state("F"), AlarmState::ActiveUnack);
    EXPECT_EQ(r.state("I"), AlarmState::ActiveUnack);
}

TEST(AlarmEngine, NotRequiringAckGoesStraightToActiveAckAndBackToNormal) {
    Rig r(digitalDefs(false));
    r.set("T.D", 1);
    r.tick();
    EXPECT_EQ(r.state("D"), AlarmState::ActiveAck);
    r.set("T.D", 0);
    r.tick();
    EXPECT_EQ(r.state("D"), AlarmState::Normal);
    EXPECT_EQ(r.events.back().closedBy, ClosedBy::Return);
    EXPECT_TRUE(r.events.back().row->closed);
}

TEST(AlarmEngine, AckReturnNeedsASecondAcknowledgement) {
    Rig r(digitalDefs(true, true));
    r.set("T.D", 1);
    r.tick();
    EXPECT_EQ(r.ack("D", 1).result, "ACKED");
    EXPECT_EQ(r.state("D"), AlarmState::ActiveAck);
    r.set("T.D", 0);
    r.tick();
    EXPECT_EQ(r.state("D"), AlarmState::RtnUnack);  // AR
    EXPECT_EQ(r.ack("D", 1).result, "ACKED");
    EXPECT_EQ(r.state("D"), AlarmState::Normal);
}

TEST(AlarmEngine, ReactivationFromRtnUnackOpensANewOccurrence) {
    Rig r(digitalDefs());
    r.set("T.D", 1);
    r.tick();
    r.set("T.D", 0);
    r.tick();
    ASSERT_EQ(r.state("D"), AlarmState::RtnUnack);
    r.set("T.D", 1);
    r.tick();
    EXPECT_EQ(r.state("D"), AlarmState::ActiveUnack);
    EXPECT_EQ(r.occurrence("D"), 2);
    // two events in one tick (vectors README 3): the old occurrence is closed, then the new one opens
    ASSERT_GE(r.events.size(), 2u);
    const AlarmEvent& closing = r.events[r.events.size() - 2];
    const AlarmEvent& opening = r.events.back();
    EXPECT_EQ(*closing.from, AlarmState::RtnUnack);
    EXPECT_EQ(*closing.to, AlarmState::Normal);
    EXPECT_EQ(closing.occurrence, 1);
    EXPECT_EQ(closing.closedBy, ClosedBy::Return);
    EXPECT_TRUE(closing.row->closed);
    EXPECT_EQ(*opening.from, AlarmState::Normal);
    EXPECT_EQ(*opening.to, AlarmState::ActiveUnack);
    EXPECT_EQ(opening.occurrence, 2);
}

// ---------------------------------------------------------------- limits and hysteresis

TEST(AlarmEngine, HighLimitHysteresis) {
    Rig r(limitDefs(2));
    for (double v : {79.0, 80.0}) {  // 80 is on (>=)
        r.set("T.L", v);
        r.tick();
    }
    EXPECT_EQ(r.state("L.H"), AlarmState::ActiveUnack);
    r.set("T.L", 78.5);  // inside the deadband (80 - 2 = 78): still on
    r.tick();
    EXPECT_EQ(r.state("L.H"), AlarmState::ActiveUnack);
    r.set("T.L", 78.0);  // 78 < 78 is false: still on
    r.tick();
    EXPECT_EQ(r.state("L.H"), AlarmState::ActiveUnack);
    r.set("T.L", 77.9);
    r.tick();
    EXPECT_EQ(r.state("L.H"), AlarmState::RtnUnack);
}

TEST(AlarmEngine, HighLimitZeroDeadbandIsPlainComparison) {
    Rig r(limitDefs(0));
    r.set("T.L", 79.99);
    r.tick();
    EXPECT_EQ(r.state("L.H"), AlarmState::Normal);
    r.set("T.L", 80);
    r.tick();
    EXPECT_EQ(r.state("L.H"), AlarmState::ActiveUnack);
    r.set("T.L", 79.99);
    r.tick();
    EXPECT_EQ(r.state("L.H"), AlarmState::RtnUnack);
}

TEST(AlarmEngine, LowLimitHysteresis) {
    Rig r(makeDefs(lowAlarm(20, 2), classesJson(), {{"T.L", AlarmTagInfo{"%", {}, false}}}));
    r.set("T.L", 20.5);
    r.tick();
    EXPECT_EQ(r.state("LO.L"), AlarmState::Normal);
    r.set("T.L", 20);  // <= is on
    r.tick();
    EXPECT_EQ(r.state("LO.L"), AlarmState::ActiveUnack);
    r.set("T.L", 22);  // 22 > 22 is false: still on
    r.tick();
    EXPECT_EQ(r.state("LO.L"), AlarmState::ActiveUnack);
    r.set("T.L", 22.1);
    r.tick();
    EXPECT_EQ(r.state("LO.L"), AlarmState::RtnUnack);
}

TEST(AlarmEngine, DeadbandNeverResetsTheDelayTimer) {
    // on delay 3 s; the value wiggles inside the band after crossing: the timer keeps running.
    Rig r(limitDefs(2, 3000, 0));
    r.set("T.L", 81);
    r.tick();  // t = 0, pending starts
    r.run(500);
    r.set("T.L", 79);  // inside the deadband (above 78): rawCond stays true
    r.run(1500);
    r.set("T.L", 80.5);
    r.run(1000);
    r.tick();
    EXPECT_EQ(r.state("L.H"), AlarmState::ActiveUnack);
    ASSERT_EQ(r.of("L.H").size(), 1u);
    EXPECT_EQ(r.of("L.H")[0].tMono, 3000);
}

TEST(AlarmEngine, HighAndHighHighTogether) {
    Rig r(limitDefs(2, 0, 0, true));
    r.set("T.L", 95);
    r.tick();
    ASSERT_EQ(r.events.size(), 2u);
    EXPECT_EQ(r.events[0].instance, "L.HH");  // order of the defs: HH before H
    EXPECT_EQ(r.events[1].instance, "L.H");
    EXPECT_EQ(r.events[0].occurrence, 1);
    EXPECT_EQ(r.events[1].occurrence, 2);
    EXPECT_EQ(r.events[0].row->priority, 1);  // critical
    EXPECT_EQ(r.events[0].text, "Mức rất cao: 95 % (ngưỡng 90)");
    EXPECT_EQ(r.events[1].text, "Mức cao: 95 % (ngưỡng 80)");
    r.set("T.L", 85);  // drops under HH only (88 = 90 - 2: 85 < 88)
    r.tick();
    EXPECT_EQ(r.state("L.HH"), AlarmState::RtnUnack);
    EXPECT_EQ(r.state("L.H"), AlarmState::ActiveUnack);
}

// ---------------------------------------------------------------- delays

TEST(AlarmEngine, OnDelayBoundaryAndReset) {
    Rig r(digitalDefs(true, false, 3000, 0));
    r.set("T.D", 1);
    r.run(2750);  // ticks at 0 ... 2500: pending since 0
    EXPECT_TRUE(r.events.empty());
    r.tick();  // t = 2750: 2750 < 3000
    EXPECT_TRUE(r.events.empty());
    r.set("T.D", 0);  // back before the delay: no occurrence, timer cleared
    r.tick();
    r.run(500);
    EXPECT_TRUE(r.events.empty());
    r.set("T.D", 1);
    const int64_t t0 = r.mono;
    r.run(3000);  // up to t0 + 2750
    EXPECT_TRUE(r.events.empty());
    r.tick();  // t0 + 3000 >= delay: on
    ASSERT_EQ(r.events.size(), 1u);
    EXPECT_EQ(r.events[0].tMono, t0 + 3000);
}

TEST(AlarmEngine, OffDelayHoldsAndIsResetByNewActivity) {
    Rig r(digitalDefs(false, false, 0, 1000));
    r.set("T.D", 1);
    r.tick();
    EXPECT_EQ(r.state("D"), AlarmState::ActiveAck);
    r.set("T.D", 0);
    r.run(750);  // 750 ms false: still on
    EXPECT_EQ(r.state("D"), AlarmState::ActiveAck);
    r.set("T.D", 1);
    r.tick();  // came back: no off
    r.set("T.D", 0);
    r.run(1000);  // 0, 250, 500, 750
    EXPECT_EQ(r.state("D"), AlarmState::ActiveAck);
    r.tick();  // 1000 ms false
    EXPECT_EQ(r.state("D"), AlarmState::Normal);
    EXPECT_EQ(count(r.events, "D", AlarmEvent::Kind::State), 2);  // on, off
}

TEST(AlarmEngine, ZeroDelayIsImmediate) {
    Rig r(digitalDefs());
    r.set("T.D", 1);
    r.tick();
    EXPECT_EQ(r.state("D"), AlarmState::ActiveUnack);
    EXPECT_EQ(r.events[0].tMono, 0);
}

// ---------------------------------------------------------------- input quality

TEST(AlarmEngine, BadQualityHoldsTheStateAndRestartsTheDelay) {
    Rig r(digitalDefs(true, false, 3000, 0));
    r.set("T.D", 1);
    r.run(2000);
    EXPECT_TRUE(r.events.empty());
    r.set("T.D", 1, Q::Bad, "TIMEOUT");  // pending is reset
    r.run(1000);
    EXPECT_TRUE(r.events.empty());
    r.set("T.D", 1);  // GOOD again: the count starts over
    const int64_t t0 = r.mono;
    r.run(3000);  // ticks up to t0 + 2750
    EXPECT_TRUE(r.events.empty());
    r.tick();  // t0 + 3000
    ASSERT_EQ(r.events.size(), 1u);
    EXPECT_EQ(r.events[0].tMono, t0 + 3000);
}

TEST(AlarmEngine, BadQualityKeepsAnActiveAlarmActive) {
    Rig r(digitalDefs(false, false, 0, 500));
    r.set("T.D", 1);
    r.tick();
    r.set("T.D", 0, Q::Bad, "TIMEOUT");  // value false but BAD: not evaluated
    r.run(5000);
    EXPECT_EQ(r.state("D"), AlarmState::ActiveAck);
    auto v = r.eng.view();
    ASSERT_NE(v->find("D"), nullptr);
    EXPECT_TRUE(v->find("D")->inputBad);
    r.set("T.D", 0);  // GOOD and false: the off delay runs from now
    const int64_t t0 = r.mono;
    r.run(500);
    EXPECT_EQ(r.state("D"), AlarmState::ActiveAck);
    r.tick();
    EXPECT_EQ(r.state("D"), AlarmState::Normal);
    EXPECT_EQ(r.events.back().tMono, t0 + 500);
    EXPECT_FALSE(r.eng.view()->find("D"));
}

TEST(AlarmEngine, BadQualityDoesNotStartAnAlarmAndTheFlagBumpsTheRevision) {
    Rig r(digitalDefs());
    const int64_t rev0 = r.eng.view()->revision;
    r.set("T.D", 1, Q::Bad, "TIMEOUT");
    r.run(1000);
    EXPECT_TRUE(r.events.empty());
    EXPECT_EQ(r.state("D"), AlarmState::Normal);
    EXPECT_GT(r.eng.view()->revision, rev0);  // the flag changed
}

TEST(AlarmEngine, UncertainIsEvaluatedAsGood) {
    Rig r(digitalDefs());
    r.set("T.D", 1, Q::Uncertain, "STALE");
    r.tick();
    EXPECT_EQ(r.state("D"), AlarmState::ActiveUnack);
}

TEST(AlarmEngine, NotFiniteValuesAreBadInput) {
    Rig r(limitDefs(0));
    r.set("T.L", std::numeric_limits<double>::quiet_NaN());
    r.run(500);
    EXPECT_TRUE(r.events.empty());
    r.set("T.L", std::numeric_limits<double>::infinity());
    r.run(500);
    EXPECT_TRUE(r.events.empty());  // +inf is not "above the limit": it is bad input
    r.set("T.L", 85);
    r.tick();
    EXPECT_EQ(r.state("L.H"), AlarmState::ActiveUnack);
    r.set("T.L", -std::numeric_limits<double>::infinity());
    r.run(500);
    EXPECT_EQ(r.state("L.H"), AlarmState::ActiveUnack);  // held
}

TEST(AlarmEngine, UnknownTagHoldsDigitalLimitAndQuality) {
    Rig r(makeDefs(json::array({{{"id", "D"}, {"type", "digital"}, {"name", "d"}, {"tag", "T.D"},
                                 {"trigger", true}, {"class", "minor"}},
                                {{"id", "Q"}, {"type", "quality"}, {"name", "q"}, {"tag", "T.Q"},
                                 {"class", "minor"}}}),
                   classesJson()));
    // nothing set: both Tags are unknown, quality BAD
    r.run(2000);
    EXPECT_TRUE(r.events.empty());  // no start-up storm of "lost signal"
    r.set("T.Q", 0, Q::Bad, "TIMEOUT");  // known now, and bad
    r.tick();
    EXPECT_EQ(r.state("Q"), AlarmState::ActiveUnack);
    EXPECT_EQ(r.state("D"), AlarmState::Normal);
}

// ---------------------------------------------------------------- quality alarms

TEST(AlarmEngine, QualityOnATag) {
    Rig r(makeDefs(qualityTagAlarm("bad"), classesJson()));
    r.set("T.Q", 1, Q::Uncertain);
    r.tick();
    EXPECT_EQ(r.state("Q"), AlarmState::Normal);  // "bad" only counts BAD
    r.set("T.Q", 1, Q::Bad, "SENSOR_FAULT");
    r.tick();
    ASSERT_EQ(r.state("Q"), AlarmState::ActiveUnack);
    EXPECT_EQ(r.events.back().reason, "SENSOR_FAULT");  // the reason is captured
    EXPECT_EQ(r.events.back().row->reason.value(), "SENSOR_FAULT");
    EXPECT_EQ(r.events.back().text, "Mất tín hiệu: mất tín hiệu (SENSOR_FAULT)");
    EXPECT_EQ(r.events.back().quality, "BAD");
    EXPECT_FALSE(r.events.back().inputBad);
}

TEST(AlarmEngine, QualityNotGoodCountsUncertainToo) {
    Rig r(makeDefs(qualityTagAlarm("notGood"), classesJson()));
    r.set("T.Q", 1, Q::Uncertain, "STALE");
    r.tick();
    EXPECT_EQ(r.state("Q"), AlarmState::ActiveUnack);
}

TEST(AlarmEngine, QualityDeviceNeedsEveryTagBad) {
    Rig r(makeDefs(qualityDeviceAlarm(), classesJson(), {}, {{"plc1", {"P.A", "P.B"}}}));
    r.set("P.A", 0, Q::Bad, "TIMEOUT");
    r.set("P.B", 0, Q::Good);
    r.run(500);
    EXPECT_EQ(r.state("QD"), AlarmState::Normal);  // partial
    r.set("P.B", 0, Q::Bad, "DISCONNECTED");
    r.tick();
    ASSERT_EQ(r.state("QD"), AlarmState::ActiveUnack);
    EXPECT_EQ(r.events.back().reason, "TIMEOUT");  // first non-empty reason in the order of the device
    r.set("P.A", 0, Q::Good);
    r.tick();
    EXPECT_EQ(r.state("QD"), AlarmState::RtnUnack);
}

TEST(AlarmEngine, QualityDeviceWithoutTagsNeverStarts) {
    Rig r(makeDefs(qualityDeviceAlarm(), classesJson(), {}, {{"plc1", {}}}));
    r.run(2000);
    EXPECT_TRUE(r.events.empty());
}

TEST(AlarmEngine, QualityOnDelay) {
    Rig r(makeDefs(qualityTagAlarm("bad", 5000), classesJson()));
    r.set("T.Q", 0, Q::Bad, "TIMEOUT");
    r.run(5000);  // ticks up to 4750
    EXPECT_TRUE(r.events.empty());
    r.tick();  // 5000
    EXPECT_EQ(r.state("Q"), AlarmState::ActiveUnack);
}

// ---------------------------------------------------------------- acknowledgement

TEST(AlarmEngine, AckResults) {
    Rig r(digitalDefs());
    EXPECT_EQ(r.ack("NOPE", 1).result, "NOT_FOUND");
    EXPECT_EQ(r.ack("D", 1).result, "NOT_ACTIVE");  // NORMAL
    r.set("T.D", 1);
    r.tick();
    EXPECT_EQ(r.ack("D", 99).result, "STALE");
    EXPECT_EQ(r.ack("D", 1).result, "ACKED");
    EXPECT_EQ(r.ack("D", 1).result, "ALREADY_ACKED");
    r.set("T.D", 0);
    r.tick();
    r.set("T.D", 1);
    r.tick();  // occurrence 2 (the first was closed with "return"): old occurrence is STALE
    EXPECT_EQ(r.occurrence("D"), 2);
    EXPECT_EQ(r.ack("D", 1).result, "STALE");
    EXPECT_EQ(r.ack("D", 2).result, "ACKED");
    r.set("T.D", 0);
    r.tick();  // AA, not AR: NORMAL
    EXPECT_EQ(r.ack("D", 2).result, "NOT_ACTIVE");  // wrong code at NORMAL: NOT_ACTIVE
}

TEST(AlarmEngine, AckOfAShelvedInstanceIsRejected) {
    Rig r(digitalDefs());
    r.set("T.D", 1);
    r.tick();
    EXPECT_EQ(r.shelve("D").result, "OK");
    EXPECT_EQ(r.ack("D", 1).result, "SHELVED");
    EXPECT_EQ(r.state("D"), AlarmState::ActiveUnack);
}

TEST(AlarmEngine, CommandIsProcessedBeforeTheEvaluationOfTheSameTick) {
    Rig r(digitalDefs());
    r.set("T.D", 1);
    r.tick();
    // ack and the end of the condition arrive in the same tick: the ack sees ACTIVE_UNACK first.
    Command c;
    c.kind = CommandKind::Ack;
    c.id = "D";
    c.occurrence = 1;
    c.user = "op1";
    CommandResult res;
    r.eng.submit(c, [&](const CommandResult& x) { res = x; });
    r.set("T.D", 0);
    r.tick();
    EXPECT_EQ(res.result, "ACKED");
    EXPECT_EQ(r.state("D"), AlarmState::Normal);  // AA, then off: NORMAL
    EXPECT_EQ(r.of("D").size(), 3u);              // on, ack, off
}

TEST(AlarmEngine, PreviewAckOnTheSnapshot) {
    nlohmann::json a = json::array(
        {{{"id", "A"}, {"type", "digital"}, {"name", "a"}, {"tag", "T.A"}, {"trigger", true}, {"class", "minor"}, {"area", "bon"}},
         {{"id", "B"}, {"type", "digital"}, {"name", "b"}, {"tag", "T.B"}, {"trigger", true}, {"class", "critical"}, {"area", "bom"}},
         {{"id", "C"}, {"type", "digital"}, {"name", "c"}, {"tag", "T.C"}, {"trigger", true}, {"class", "minor"}}});
    Rig r(makeDefs(a, classesJson(), {}, {}, json::parse(R"([{"id":"bon","name":"Bồn"},{"id":"bom","name":"Bơm"}])")));
    for (const char* t : {"T.A", "T.B", "T.C"}) r.set(t, 1);
    r.tick();
    const int64_t rev = r.eng.view()->revision;
    AckRequest all;
    all.all = true;
    all.upToRevision = rev;
    EXPECT_EQ(r.eng.previewAck(all).size(), 3u);
    all.filter.area = "bon";
    auto one = r.eng.previewAck(all);
    ASSERT_EQ(one.size(), 1u);
    EXPECT_EQ(one[0].id, "A");
    all.filter = {};
    all.filter.priority = 1;  // critical and above
    one = r.eng.previewAck(all);
    ASSERT_EQ(one.size(), 1u);
    EXPECT_EQ(one[0].id, "B");
    all.filter = {};
    all.filter.area = "";  // "Chung"
    one = r.eng.previewAck(all);
    ASSERT_EQ(one.size(), 1u);
    EXPECT_EQ(one[0].id, "C");
    // upToRevision: C is acked before D comes; an alarm newer than the page is not touched
    all.filter = {};
    all.upToRevision = rev - 1;
    EXPECT_LT(r.eng.previewAck(all).size(), 3u);
    // item list: results per item
    AckRequest items;
    items.items = {{"A", r.occurrence("A")}, {"A", 99}, {"NOPE", 1}};
    auto res = r.eng.previewAck(items);
    ASSERT_EQ(res.size(), 3u);
    EXPECT_EQ(res[0].result, "ACKED");
    EXPECT_EQ(res[1].result, "STALE");
    EXPECT_EQ(res[2].result, "NOT_FOUND");
    r.ack("A", r.occurrence("A"));
    all.upToRevision = r.eng.view()->revision;
    all.filter.state = "unack";
    EXPECT_EQ(r.eng.previewAck(all).size(), 2u);  // A is acknowledged
    // shelved instances are skipped
    r.shelve("B");
    all.upToRevision = r.eng.view()->revision;
    EXPECT_EQ(r.eng.previewAck(all).size(), 1u);
}

// ---------------------------------------------------------------- shelving

TEST(AlarmEngine, ShelveHidesAndExpiresOnTheMonotonicClock) {
    Rig r(digitalDefs());
    r.set("T.D", 1);
    r.tick();
    CommandResult res = r.shelve("D", 60, "bảo trì");
    EXPECT_EQ(res.result, "OK");
    EXPECT_EQ(res.untilEpochMs, kEpoch0 + r.mono - 250 + 60000);
    auto v = r.eng.view();
    ASSERT_NE(v->find("D"), nullptr);
    ASSERT_TRUE(v->find("D")->shelve.has_value());
    EXPECT_EQ(v->find("D")->shelve->reason, "bảo trì");
    EXPECT_EQ(v->counts.shelved, 1);
    EXPECT_EQ(v->counts.active, 0);  // hidden from the counts
    EXPECT_EQ(v->counts.unacked, 0);
    r.run(59000);
    EXPECT_EQ(count(r.events, "D", AlarmEvent::Kind::Unshelve), 0);
    r.run(2000);
    EXPECT_EQ(count(r.events, "D", AlarmEvent::Kind::Unshelve), 1);
    auto un = r.of("D", AlarmEvent::Kind::Unshelve)[0];
    EXPECT_EQ(un.reason, "expired");
    EXPECT_TRUE(un.system);
    EXPECT_EQ(r.eng.view()->counts.unacked, 1);
}

TEST(AlarmEngine, ShelvedInstanceStillEvaluatesAndRecords) {
    Rig r(digitalDefs());
    r.shelve("D");
    r.set("T.D", 1);
    r.tick();
    EXPECT_EQ(r.state("D"), AlarmState::ActiveUnack);  // the state is kept, the row is written
    EXPECT_EQ(r.events.back().occurrence, 1);
    EXPECT_EQ(r.eng.view()->counts.active, 0);
}

TEST(AlarmEngine, UnshelveOfAnAcknowledgedActiveAlarmRearms) {
    Rig r(digitalDefs());
    r.set("T.D", 1);
    r.tick();
    r.ack("D", 1);
    EXPECT_EQ(r.state("D"), AlarmState::ActiveAck);
    r.shelve("D");
    EXPECT_EQ(r.simple(CommandKind::Unshelve, "D").result, "OK");
    EXPECT_EQ(r.state("D"), AlarmState::ActiveUnack);  // same occurrence, shown again
    EXPECT_EQ(r.occurrence("D"), 1);
    EXPECT_EQ(r.simple(CommandKind::Unshelve, "D").result, "NOT_SHELVED");
}

TEST(AlarmEngine, ShelveRanges) {
    Rig r(digitalDefs());
    EXPECT_EQ(r.shelve("D", 59).result, "SHELVE_RANGE");
    EXPECT_EQ(r.shelve("D", 28801).result, "SHELVE_RANGE");
    EXPECT_EQ(r.shelve("D", 600, "").result, "SHELVE_RANGE");
    EXPECT_EQ(r.shelve("D", 600, std::string(121, 'x')).result, "SHELVE_RANGE");
    EXPECT_EQ(r.shelve("NOPE").result, "NOT_FOUND");
    EXPECT_EQ(r.shelve("D", 60).result, "OK");
    EXPECT_EQ(r.shelve("D", 28800, std::string(120, 'x')).result, "OK");  // again: replaces
}

TEST(AlarmEngine, FiftyInstancesAtMostCanBeShelved) {
    json a = json::array();
    for (int i = 0; i < 52; ++i)
        a.push_back({{"id", "A" + std::to_string(i)}, {"type", "digital"}, {"name", "n"},
                     {"tag", "T" + std::to_string(i)}, {"trigger", true}, {"class", "minor"}});
    Rig r(makeDefs(a, classesJson()));
    for (int i = 0; i < 50; ++i) EXPECT_EQ(r.shelve("A" + std::to_string(i)).result, "OK") << i;
    EXPECT_EQ(r.shelve("A50").result, "SHELVE_RANGE");
    EXPECT_EQ(r.shelve("A0", 120).result, "OK");  // already shelved: not counted again
    EXPECT_EQ(r.simple(CommandKind::Unshelve, "A1").result, "OK");
    EXPECT_EQ(r.shelve("A50").result, "OK");
}

// ---------------------------------------------------------------- disabling

TEST(AlarmEngine, DisableClosesTheOpenOccurrenceAndStopsEvaluation) {
    Rig r(digitalDefs());
    r.set("T.D", 1);
    r.tick();
    EXPECT_EQ(r.simple(CommandKind::Disable, "D").result, "OK");
    EXPECT_EQ(r.state("D"), AlarmState::Normal);
    EXPECT_EQ(count(r.events, "D", AlarmEvent::Kind::Disable), 1);
    bool closedByDisable = false;
    for (const auto& e : r.events)
        if (e.closedBy == ClosedBy::Disabled && e.row && e.row->closed && !e.row->tsReturnMs) closedByDisable = true;
    EXPECT_TRUE(closedByDisable);
    EXPECT_EQ(r.simple(CommandKind::Disable, "D").result, "ALREADY_DISABLED");
    r.set("T.D", 0);
    r.run(500);
    r.set("T.D", 1);
    const size_t n = r.events.size();
    r.run(1000);
    EXPECT_EQ(r.events.size(), n);  // not evaluated
    auto v = r.eng.view();
    ASSERT_NE(v->find("D"), nullptr);
    EXPECT_TRUE(v->find("D")->disabled);
    EXPECT_EQ(v->counts.disabled, 1);
    EXPECT_EQ(r.simple(CommandKind::Enable, "D").result, "OK");
    r.tick();  // evaluated from scratch: true now -> a new occurrence
    EXPECT_EQ(r.state("D"), AlarmState::ActiveUnack);
    EXPECT_EQ(r.occurrence("D"), 2);
    EXPECT_EQ(r.simple(CommandKind::Enable, "D").result, "NOT_DISABLED");
}

// ---------------------------------------------------------------- chattering

namespace {
// Toggles T.D on and off `n` times, one on-phase of 250 ms and an off-phase of 250 ms each.
void chatter(Rig& r, int n) {
    for (int i = 0; i < n; ++i) {
        r.set("T.D", 1);
        r.tick();
        r.set("T.D", 0);
        r.tick();
    }
}
}  // namespace

TEST(AlarmEngine, FifthStartInTheWindowSelfShelvesAndIsTheSummaryRow) {
    Rig r(digitalDefs(false, false, 0, 0, 5));  // not R: the rows close at once
    chatter(r, 4);
    EXPECT_EQ(count(r.events, "D", AlarmEvent::Kind::Shelve), 0);
    r.set("T.D", 1);
    r.tick();  // the fifth
    ASSERT_EQ(count(r.events, "D", AlarmEvent::Kind::Shelve), 1);
    ASSERT_EQ(count(r.events, "D", AlarmEvent::Kind::Chatter), 1);
    auto sh = r.of("D", AlarmEvent::Kind::Shelve)[0];
    EXPECT_TRUE(sh.system);
    EXPECT_EQ(sh.reason, "chatter");
    EXPECT_EQ(sh.untilEpochMs, kEpoch0 + r.mono - 250 + 1800 * 1000);
    auto ch = r.of("D", AlarmEvent::Kind::Chatter)[0];
    EXPECT_EQ(ch.count, 5);
    // the fifth occurrence is a real row (the summary row), repeat_count 5
    const AlarmEvent* fifth = nullptr;
    for (const auto& e : r.events)
        if (e.kind == AlarmEvent::Kind::State && e.occurrence == 5) fifth = &e;
    ASSERT_NE(fifth, nullptr);
    EXPECT_EQ(fifth->row->repeatCount, 5);
}

TEST(AlarmEngine, StartsInsideTheSelfShelveAreGhostsAndTheSummaryGetsTheCount) {
    Rig r(digitalDefs(false, false, 0, 0, 5));
    chatter(r, 5);  // the fifth start shelves; its return follows
    r.set("T.D", 1);
    r.tick();
    r.set("T.D", 0);
    r.tick();
    r.set("T.D", 1);
    r.tick();
    r.set("T.D", 0);
    r.tick();
    // two further starts: ghosts (occurrence 0, no row)
    int ghosts = 0;
    for (const auto& e : r.events)
        if (e.kind == AlarmEvent::Kind::State && e.to && *e.to != AlarmState::Normal && e.occurrence == 0) {
            ++ghosts;
            EXPECT_FALSE(e.row.has_value());
        }
    EXPECT_EQ(ghosts, 2);
    int rows = 0;
    for (const auto& e : r.events)
        if (e.kind == AlarmEvent::Kind::State && e.row && !e.row->closed) ++rows;
    EXPECT_GE(rows, 5);
    // end of the episode: the user unshelves; the summary row gets 5 + 2
    EXPECT_EQ(r.simple(CommandKind::Unshelve, "D").result, "OK");
    const AlarmEvent* chat = nullptr;
    for (const auto& e : r.events)
        if (e.kind == AlarmEvent::Kind::Chatter) chat = &e;
    ASSERT_NE(chat, nullptr);
    // the last chatter event carries the total
    EXPECT_EQ(chat->count, 7);
    ASSERT_TRUE(chat->row.has_value());
    EXPECT_EQ(chat->row->repeatCount, 7);
    EXPECT_EQ(chat->row->id, 5);
}

TEST(AlarmEngine, SelfShelveExpiresAfterTheConfiguredTimeAndOpensARealOccurrenceIfStillOn) {
    AlarmOptions opt;
    opt.chatterShelveS = 60;
    Rig r(digitalDefs(false, false, 0, 0, 3), opt);
    chatter(r, 2);
    r.set("T.D", 1);
    r.tick();  // third start: shelved; occurrence 3 (summary)
    r.set("T.D", 0);
    r.tick();
    r.set("T.D", 1);
    r.tick();  // ghost
    EXPECT_EQ(r.occurrence("D"), 0);
    r.run(61000);  // still on when the self-shelve ends
    auto un = r.of("D", AlarmEvent::Kind::Unshelve);
    ASSERT_EQ(un.size(), 1u);
    EXPECT_EQ(un[0].reason, "chatter-end");
    EXPECT_TRUE(un[0].system);
    EXPECT_EQ(r.occurrence("D"), 4);  // a new real occurrence with the current value
    EXPECT_EQ(r.state("D"), AlarmState::ActiveAck);
}

TEST(AlarmEngine, UserShelveOnAChatteringInstanceKeepsWritingRows) {
    Rig r(digitalDefs(false, false, 0, 0, 3));
    r.shelve("D");
    chatter(r, 6);
    EXPECT_EQ(count(r.events, "D", AlarmEvent::Kind::Chatter), 0);
    int rows = 0;
    for (const auto& e : r.events)
        if (e.kind == AlarmEvent::Kind::State && e.row && !e.row->closed) ++rows;
    EXPECT_EQ(rows, 6);
}

TEST(AlarmEngine, ChatterLimitZeroTurnsItOff) {
    Rig r(digitalDefs(false, false, 0, 0, 0));
    chatter(r, 12);
    EXPECT_EQ(count(r.events, "D", AlarmEvent::Kind::Shelve), 0);
    EXPECT_EQ(r.occurrence("D"), 0);
    int rows = 0;
    for (const auto& e : r.events)
        if (e.kind == AlarmEvent::Kind::State && e.row && !e.row->closed) ++rows;
    EXPECT_EQ(rows, 12);
}

TEST(AlarmEngine, StartsOutsideTheWindowDoNotCount) {
    Rig r(digitalDefs(false, false, 0, 0, 3));
    for (int i = 0; i < 6; ++i) {
        r.set("T.D", 1);
        r.tick();
        r.set("T.D", 0);
        r.run(31000);  // 31 s between starts: never 3 within 60 s
    }
    EXPECT_EQ(count(r.events, "D", AlarmEvent::Kind::Shelve), 0);
}

TEST(AlarmEngine, SelfShelveDoesNotCountInTheFiftyShelved) {
    json a = json::array();
    for (int i = 0; i < 52; ++i)
        a.push_back({{"id", "A" + std::to_string(i)}, {"type", "digital"}, {"name", "n"},
                     {"tag", "T" + std::to_string(i)}, {"trigger", true}, {"class", "minor"}});
    AlarmDefs d = makeDefs(a, classesJson(false, false, 2));
    Rig r(d);
    for (int i = 0; i < 2; ++i) {  // A0 and A1 self-shelve (2 starts)
        for (int k = 0; k < 2; ++k) {
            r.set("T0", 1);
            r.set("T1", 1);
            r.tick();
            r.set("T0", 0);
            r.set("T1", 0);
            r.tick();
        }
        break;
    }
    EXPECT_EQ(count(r.events, "A0", AlarmEvent::Kind::Shelve), 1);
    for (int i = 2; i < 52; ++i) EXPECT_EQ(r.shelve("A" + std::to_string(i)).result, "OK") << i;
}

// ---------------------------------------------------------------- load and reconcile

namespace {
OccurrenceRow openRow(const InstanceDef& d, int64_t id, bool acked = false, bool returned = false) {
    OccurrenceRow row;
    row.id = id;
    row.alarmId = d.id;
    row.fingerprint = d.fingerprint;
    row.tsActiveMs = kEpoch0 - 100000;
    row.priority = 3;
    row.classId = "minor";
    row.text = "x";
    row.textFold = "x";
    row.valueActive = 1;
    if (acked) {
        row.tsAckMs = kEpoch0 - 50000;
        row.ackUser = "op0";
    }
    if (returned) row.tsReturnMs = kEpoch0 - 20000;
    return row;
}

struct Restarted {
    AlarmEngine eng;
    AlarmDefs defs;
    std::vector<AlarmEvent> ev;
    explicit Restarted(AlarmDefs d, std::vector<OccurrenceRow> open, std::vector<OverrideRow> ov = {},
                       int64_t next = 100, bool clockOk = true) : defs(std::move(d)) {
        LoadContext ctx;
        ctx.open = std::move(open);
        ctx.overrides = std::move(ov);
        ctx.nowMonoMs = 5000;
        ctx.nowEpochMs = kEpoch0;
        ctx.clockOk = clockOk;
        ctx.nextOccurrence = next;
        eng.load(defs, ctx);
        eng.takeEvents(ev);
    }
    void step(int64_t mono, std::vector<TagSample> tags) {
        eng.step(mono, kEpoch0 + (mono - 5000), tags);
        std::vector<AlarmEvent> e;
        eng.takeEvents(e);
        for (auto& x : e) ev.push_back(std::move(x));
    }
};
}  // namespace

TEST(AlarmEngine, ReconcileKeepsTheOpenOccurrenceWithoutANewOneOrANewDelay) {
    AlarmDefs d = digitalDefs(true, false, 3000, 0);
    Restarted rs(d, {openRow(d.instances[0], 41, true)});
    auto v = rs.eng.view();
    ASSERT_NE(v->find("D"), nullptr);
    EXPECT_EQ(v->find("D")->state, AlarmState::ActiveAck);  // acked, not returned
    EXPECT_EQ(v->find("D")->occurrence, 41);
    TagSample on;
    on.value = 1;
    rs.step(5000, {on});
    rs.step(5250, {on});
    int states = 0;
    for (const auto& e : rs.ev)
        if (e.kind == AlarmEvent::Kind::State) ++states;
    EXPECT_EQ(states, 0);  // no event, no new occurrence, no on-delay run again
    EXPECT_EQ(rs.eng.view()->find("D")->occurrence, 41);
}

TEST(AlarmEngine, ReconcileUnacknowledgedAndReturnedStates) {
    AlarmDefs d = digitalDefs();
    {
        Restarted rs(d, {openRow(d.instances[0], 7)});
        EXPECT_EQ(rs.eng.view()->find("D")->state, AlarmState::ActiveUnack);
    }
    {
        Restarted rs(d, {openRow(d.instances[0], 7, true, true)});
        EXPECT_EQ(rs.eng.view()->find("D")->state, AlarmState::RtnUnack);
    }
}

TEST(AlarmEngine, ReconcileConditionFalseStartsTheOffDelayFromTheFirstTick) {
    AlarmDefs d = digitalDefs(false, false, 0, 1000);
    Restarted rs(d, {openRow(d.instances[0], 9, true)});
    TagSample off;
    off.value = 0;
    rs.step(5000, {off});
    rs.step(5750, {off});
    EXPECT_EQ(rs.eng.view()->find("D")->state, AlarmState::ActiveAck);
    rs.step(6000, {off});
    EXPECT_EQ(rs.eng.view()->find("D"), nullptr);  // returned to NORMAL after the delay
    EXPECT_EQ(rs.ev.back().closedBy, ClosedBy::Return);
}

TEST(AlarmEngine, ReconcileHoldsWhileTheTagIsUnknownOrBad) {
    AlarmDefs d = digitalDefs();
    Restarted rs(d, {openRow(d.instances[0], 9)});
    TagSample unknown;
    unknown.known = false;
    unknown.quality = TagSample::Quality::Bad;
    rs.step(5000, {unknown});
    rs.step(9000, {unknown});
    EXPECT_EQ(rs.eng.view()->find("D")->state, AlarmState::ActiveUnack);
    TagSample bad;
    bad.value = 0;
    bad.quality = TagSample::Quality::Bad;
    rs.step(9250, {bad});
    EXPECT_EQ(rs.eng.view()->find("D")->state, AlarmState::ActiveUnack);
}

TEST(AlarmEngine, ReconcileClosesWhenTheFingerprintChangedOrTheInstanceIsGone) {
    AlarmDefs d = digitalDefs();
    OccurrenceRow wrong = openRow(d.instances[0], 3);
    wrong.fingerprint = "0000000000000000";
    Restarted rs(d, {wrong});
    EXPECT_EQ(rs.eng.view()->find("D"), nullptr);
    bool closed = false;
    for (const auto& e : rs.ev)
        if (e.row && e.row->id == 3 && e.row->closed && e.closedBy == ClosedBy::Config) closed = true;
    EXPECT_TRUE(closed);
    OccurrenceRow gone = openRow(d.instances[0], 4);
    gone.alarmId = "GONE";
    Restarted rs2(d, {gone});
    closed = false;
    for (const auto& e : rs2.ev)
        if (e.row && e.row->id == 4 && e.row->closed && e.closedBy == ClosedBy::Config) closed = true;
    EXPECT_TRUE(closed);
}

TEST(AlarmEngine, ReconcileKeepsOnlyTheNewestOfDuplicateOpenRows) {
    AlarmDefs d = digitalDefs();
    Restarted rs(d, {openRow(d.instances[0], 5), openRow(d.instances[0], 8)});
    EXPECT_EQ(rs.eng.view()->find("D")->occurrence, 8);
    bool lost = false;
    for (const auto& e : rs.ev)
        if (e.row && e.row->id == 5 && e.closedBy == ClosedBy::RestartLost) lost = true;
    EXPECT_TRUE(lost);
}

TEST(AlarmEngine, ReconcileAppliesTheClassChangeToNotRequiringAck) {
    AlarmDefs d = digitalDefs(false);  // class no longer requires ack
    Restarted rs(d, {openRow(d.instances[0], 6)});
    EXPECT_EQ(rs.eng.view()->find("D")->state, AlarmState::ActiveAck);  // AU -> AA
    Restarted rs2(d, {openRow(d.instances[0], 6, true, true)});
    EXPECT_EQ(rs2.eng.view()->find("D"), nullptr);  // RU -> NORMAL and closed
}

TEST(AlarmEngine, LoadRestoresOverrides) {
    AlarmDefs d = digitalDefs();
    OverrideRow sh;
    sh.alarmId = "D";
    sh.kind = "shelve";
    sh.user = "op1";
    sh.reason = "bảo trì";
    sh.tsStartMs = kEpoch0 - 1000;
    sh.tsEndMs = kEpoch0 + 120000;
    OverrideRow dis;
    dis.alarmId = "OTHER";
    dis.kind = "disable";
    dis.user = "eng";
    dis.reason = "x";
    Restarted rs(d, {}, {sh, dis});
    auto v = rs.eng.view();
    ASSERT_NE(v->find("D"), nullptr);
    ASSERT_TRUE(v->find("D")->shelve.has_value());
    EXPECT_EQ(v->find("D")->shelve->remainingS, 120);
    // an expired shelve and a stale one
    sh.tsEndMs = kEpoch0 - 1;
    Restarted rs2(d, {}, {sh});
    EXPECT_EQ(rs2.eng.view()->find("D"), nullptr);
    EXPECT_EQ(count(rs2.ev, "D", AlarmEvent::Kind::Unshelve), 1);
    // no clock: the shelve is treated as expired
    sh.tsEndMs = kEpoch0 + 120000;
    Restarted rs3(d, {}, {sh}, 100, false);
    EXPECT_EQ(count(rs3.ev, "D", AlarmEvent::Kind::Unshelve), 1);
    // a disable of an instance that exists is applied
    OverrideRow dd = dis;
    dd.alarmId = "D";
    Restarted rs4(d, {}, {dd});
    ASSERT_NE(rs4.eng.view()->find("D"), nullptr);
    EXPECT_TRUE(rs4.eng.view()->find("D")->disabled);
}

TEST(AlarmEngine, StartupFlagOnlyWhenTheConditionWasTrueAtTheFirstObservation) {
    AlarmDefs d = digitalDefs();
    Restarted rs(d, {});
    TagSample on;
    on.value = 1;
    rs.step(5000, {on});
    ASSERT_FALSE(rs.ev.empty());
    const AlarmEvent* e = nullptr;
    for (const auto& x : rs.ev)
        if (x.kind == AlarmEvent::Kind::State) e = &x;
    ASSERT_NE(e, nullptr);
    EXPECT_TRUE(e->startup);
    EXPECT_EQ(e->row->flags & 1, 1);
    // false first, then true: no flag
    Restarted rs2(d, {});
    TagSample off;
    off.value = 0;
    rs2.step(5000, {off});
    rs2.step(5250, {on});
    for (const auto& x : rs2.ev)
        if (x.kind == AlarmEvent::Kind::State) {
            EXPECT_FALSE(x.startup);
            EXPECT_EQ(x.row->flags & 1, 0);
        }
}

TEST(AlarmEngine, ReplacingTheProjectKeepsMatchingInstancesAndClosesTheOthers) {
    Rig r(limitDefs(2, 0, 0, true));  // L.HH, L.H
    r.set("T.L", 95);
    r.tick();
    ASSERT_EQ(r.state("L.H"), AlarmState::ActiveUnack);
    r.ack("L.H", r.occurrence("L.H"));
    // new project: H threshold changes (fingerprint), HH stays (class, text change only)
    json limits = {{"H", {{"value", 85}, {"class", "minor"}}},
                   {"HH", {{"value", 90}, {"class", "minor"}, {"text", "nuevo"}}}};
    json a = json::array({{{"id", "L"}, {"type", "limit"}, {"name", "Mức mới"}, {"tag", "T.L"},
                           {"limits", limits}, {"deadband", 2}}});
    AlarmDefs d2 = makeDefs(a, classesJson(), {{"T.L", AlarmTagInfo{"%", {}, false}}});
    LoadContext ctx;
    ctx.nowMonoMs = r.mono;
    ctx.nowEpochMs = kEpoch0 + r.mono;
    ctx.processStart = false;
    r.events.clear();
    r.eng.load(d2, ctx);
    r.drain();
    EXPECT_EQ(r.state("L.HH"), AlarmState::ActiveUnack);  // kept (same fingerprint)
    EXPECT_EQ(r.eng.view()->find("L.HH")->classId, "minor" /* the new class shows */);
    EXPECT_EQ(r.eng.view()->find("L.H"), nullptr);        // closed: config
    bool closedConfig = false;
    for (const auto& e : r.events)
        if (e.instance == "L.H" && e.closedBy == ClosedBy::Config && e.row && e.row->closed) closedConfig = true;
    EXPECT_TRUE(closedConfig);
    // the new H evaluates from scratch: value 95 -> a new occurrence on the next tick
    r.eng.step(r.mono, kEpoch0 + r.mono, r.samples.data(), r.samples.size());
    r.drain();
    EXPECT_EQ(r.state("L.H"), AlarmState::ActiveUnack);
    EXPECT_GT(r.occurrence("L.H"), 2);
    // a removed instance
    AlarmDefs none = makeDefs(json::array(), classesJson());
    r.events.clear();
    r.eng.load(none, ctx);
    r.drain();
    EXPECT_EQ(count(r.events, "L.HH", AlarmEvent::Kind::Removed), 1);
    EXPECT_EQ(r.eng.instanceCount(), 0u);
}

// ---------------------------------------------------------------- properties

TEST(AlarmEngine, RevisionsIncreaseAndEventsCarryThem) {
    Rig r(limitDefs(2, 0, 0, true));
    r.set("T.L", 95);
    r.tick();
    r.set("T.L", 70);
    r.tick();
    int64_t last = 0;
    for (const auto& e : r.events) {
        if (e.kind == AlarmEvent::Kind::Command) continue;
        EXPECT_GT(e.revision, last);
        last = e.revision;
    }
    EXPECT_EQ(r.eng.view()->revision, last);
}

TEST(AlarmEngine, DeterministicForTheSameInputs) {
    auto run = [] {
        Rig r(limitDefs(2, 500, 250, true));
        std::string log;
        unsigned seed = 3;
        for (int i = 0; i < 400; ++i) {
            seed = seed * 1664525u + 1013904223u;
            r.set("T.L", 60 + static_cast<double>((seed >> 8) % 400) / 10.0);
            r.tick();
        }
        for (const auto& e : r.events)
            log += std::to_string(e.tMono) + e.instance + std::to_string(e.occurrence) +
                   std::to_string(e.revision) + (e.to ? stateName(*e.to) : "-") + ";";
        return log;
    };
    EXPECT_EQ(run(), run());
    EXPECT_GT(run().size(), 50u);
}

TEST(AlarmEngine, NoAllocationInTheHotPathWhenNothingChanges) {
#ifndef MAT_ALLOC_COUNTING
    GTEST_SKIP() << "allocation counting is off under ASan";
#endif
    json a = json::array();
    for (int i = 0; i < 100; ++i)
        a.push_back({{"id", "A" + std::to_string(i)}, {"type", "limit"}, {"name", "n"},
                     {"tag", "T" + std::to_string(i % 20)},
                     {"limits", {{"H", {{"value", 80}, {"class", "minor"}}}, {"HH", {{"value", 90}, {"class", "minor"}}}}},
                     {"deadband", 1}, {"onDelayMs", 1000}});
    Rig r(makeDefs(a, classesJson()));
    for (int i = 0; i < 20; ++i) r.set("T" + std::to_string(i), 50);
    r.run(2000);
    r.events.reserve(16);
    std::vector<AlarmEvent> sink;
    sink.reserve(8);
    gAllocs = 0;
    gCount = true;
    for (int i = 0; i < 1000; ++i) r.eng.step(r.mono + i * 250, kEpoch0 + r.mono + i * 250, r.samples.data(), r.samples.size());
    gCount = false;
    EXPECT_EQ(gAllocs.load(), 0);
}

TEST(AlarmEngine, PendingDelaysDoNotAllocateEither) {
#ifndef MAT_ALLOC_COUNTING
    GTEST_SKIP() << "allocation counting is off under ASan";
#endif
    Rig r(limitDefs(2, 600000, 0));  // 10 minutes on delay, so the timer runs the whole time
    r.set("T.L", 85);
    r.tick();
    gAllocs = 0;
    gCount = true;
    for (int i = 0; i < 500; ++i) r.eng.step(r.mono + i * 250, kEpoch0 + r.mono + i * 250, r.samples.data(), r.samples.size());
    gCount = false;
    EXPECT_EQ(gAllocs.load(), 0);
}

TEST(AlarmEngine, ClockNotOkIsMarkedOnTheOccurrence) {
    AlarmOptions opt;
    opt.clockOkFromMs = kEpoch0 + 10000000;  // the clock is "before the floor"
    Rig r(digitalDefs(), opt);
    r.set("T.D", 1);
    r.tick();
    ASSERT_EQ(r.events.size(), 1u);
    EXPECT_FALSE(r.events[0].clockOk);
    EXPECT_FALSE(r.events[0].row->clockOk);
}

TEST(AlarmEngine, SubmittedCommandsGetNotFoundWhenTheProjectIsReplacedFirst) {
    Rig r(digitalDefs());
    Command c;
    c.kind = CommandKind::Ack;
    c.id = "D";
    c.occurrence = 1;
    CommandResult res;
    bool got = false;
    r.eng.submit(c, [&](const CommandResult& x) {
        res = x;
        got = true;
    });
    LoadContext ctx;
    ctx.nowMonoMs = 0;
    ctx.nowEpochMs = kEpoch0;
    ctx.processStart = false;
    r.eng.load(r.defs, ctx);
    EXPECT_TRUE(got);
    EXPECT_EQ(res.result, "NOT_FOUND");
}

TEST(AlarmEngine, TickWithManyInstancesStaysFast) {
    json a = json::array();
    for (int i = 0; i < 125; ++i)
        a.push_back({{"id", "A" + std::to_string(i)}, {"type", "limit"}, {"name", "n"}, {"tag", "T" + std::to_string(i % 50)},
                     {"limits", {{"LL", {{"value", 5}, {"class", "minor"}}}, {"L", {{"value", 15}, {"class", "minor"}}},
                                 {"H", {{"value", 80}, {"class", "minor"}}}, {"HH", {{"value", 90}, {"class", "minor"}}}}},
                     {"deadband", 1}});
    Rig r(makeDefs(a, classesJson()));
    EXPECT_EQ(r.eng.instanceCount(), 500u);
    for (int i = 0; i < 50; ++i) r.set("T" + std::to_string(i), 50);
    r.run(1000);
    EXPECT_TRUE(r.events.empty());
}
