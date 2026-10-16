// The coordinator of tag writes (specs/006 T138; FR-037 to FR-042; data-model §8; research R14).
// The audit, the drivers and the clocks are fakes: what is under test is the order of the checks,
// that nothing reaches a driver before the audit record is durable, the state machine, the request
// ids, the order of commands, the memory of results, and quiesce.
#include "core/tag-engine/write_coordinator.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <cmath>
#include <functional>
#include <future>
#include <mutex>
#include <thread>

#include "core/tag-engine/engine.hpp"
#include "core/tag-engine/tests/write_fakes.hpp"

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
        // the old values the Tags hold
        auto set = [&](Tg t, TagScalar v) { store.set(t, v, Quality::GOOD, 1, 1); };
        set(SP, 72.5);
        set(RUN, false);
        set(CNT, int64_t{3});
        set(BIG, int64_t{1});
        set(NAME, std::string("A"));
        set(INT_SET, 5.0);
        coord = std::make_unique<WriteCoordinator>(model, store, backend, audit, o);
    }
    ~Rig() { coord.reset(); }

    WriteCaller who(const std::string& user = "vh1", const std::string& session = "sess-1") {
        WriteCaller w;
        w.user = user;
        w.role = "operator";
        w.source = "10.0.0.7:51000";
        w.sessionKey = session;
        return w;
    }
    WriteView one(const std::string& tag, const WriteValue& v, const std::string& id = kId1,
                  const WriteCaller* c = nullptr) {
        const WriteCaller w = c ? *c : who();
        return coord->submit(w, {{id, tag, v}}).at(0);
    }
    // A request with an id of its own each time (a test of many refusals).
    WriteView fresh(const std::string& tag, const WriteValue& v) {
        return one(tag, v, idN(1000 + ++seq));
    }
    int seq = 0;
    void result(uint64_t id, drv::WriteStatus st, const char* code, int exc = -1,
                TagScalar rb = {}) {
        drv::WriteResult r;
        r.id = id;
        r.status = st;
        r.code = code;
        r.exception = exc;
        r.readback = std::move(rb);
        coord->onDriverResult(r);
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

// ---------- steps 2 to 4: the Tag and the value ----------

TEST(WriteCoordinator, NoSuchTagAndReadOnlyTags) {
    Rig r;
    EXPECT_EQ(r.fresh("NOPE", WriteValue::number(1)).code, "NO_SUCH_TAG");
    EXPECT_EQ(r.fresh("LEVEL_R", WriteValue::number(1)).code, "READ_ONLY") << "access R";
    EXPECT_EQ(r.fresh("CALC", WriteValue::number(1)).code, "READ_ONLY") << "calculated Tag";
    EXPECT_EQ(r.fresh("SIM_RAMP", WriteValue::number(1)).code, "READ_ONLY")
        << "simulation Tag that is not manual";
    for (const char* t : {"NOPE", "LEVEL_R"})
        EXPECT_EQ(r.fresh(t, WriteValue::number(1)).status, "REJECTED");
    EXPECT_EQ(r.backend.count(), 0u);
}

TEST(WriteCoordinator, TheValueMustHaveTheTypeOfTheTag) {
    Rig r;
    EXPECT_EQ(r.fresh("SP", WriteValue::boolean(true)).code, "BAD_TYPE");
    EXPECT_EQ(r.fresh("RUN", WriteValue::number(1)).code, "BAD_TYPE");
    EXPECT_EQ(r.fresh("RUN", WriteValue::text("true")).code, "BAD_TYPE");
    EXPECT_EQ(r.fresh("NAME", WriteValue::number(5)).code, "BAD_TYPE");
    EXPECT_EQ(r.fresh("SP", WriteValue::text("abc")).code, "BAD_TYPE");
    EXPECT_EQ(r.fresh("SP", WriteValue::text("12,5")).code, "BAD_TYPE") << "no decimal comma";
    EXPECT_EQ(r.fresh("SP", WriteValue::text("")).code, "BAD_TYPE");
    EXPECT_EQ(r.fresh("CNT", WriteValue::number(2.5)).code, "BAD_TYPE")
        << "a fraction for an integer Tag";
    EXPECT_EQ(r.fresh("CNT", WriteValue::text("2.5")).code, "BAD_TYPE");
    EXPECT_EQ(r.backend.count(), 0u);
}

TEST(WriteCoordinator, NaNAndInfinityAreNotFinite) {
    Rig r;
    EXPECT_EQ(r.fresh("SP", WriteValue::number(std::nan(""))).code, "NOT_FINITE");
    EXPECT_EQ(r.fresh("SP", WriteValue::number(INFINITY)).code, "NOT_FINITE");
    EXPECT_EQ(r.fresh("SP", WriteValue::text("NaN")).code, "NOT_FINITE");
    EXPECT_EQ(r.fresh("SP", WriteValue::text("Infinity")).code, "NOT_FINITE");
    EXPECT_EQ(r.fresh("SP", WriteValue::text("-inf")).code, "NOT_FINITE");
    EXPECT_EQ(r.fresh("SP", WriteValue::text("1e999")).code, "NOT_FINITE");
}

TEST(WriteCoordinator, LimitsTypeRangeRawRangeAndStringLengthInThatOrder) {
    Rig r;
    EXPECT_EQ(r.fresh("SP", WriteValue::number(90.0001)).code, "OUT_OF_LIMITS");
    EXPECT_EQ(r.fresh("SP", WriteValue::number(-0.0001)).code, "OUT_OF_LIMITS");
    EXPECT_EQ(r.fresh("INT_SET", WriteValue::number(100.5)).code, "OUT_OF_LIMITS");
    EXPECT_EQ(r.fresh("CNT", WriteValue::integer(40000)).code, "OUT_OF_TYPE_RANGE");
    EXPECT_EQ(r.fresh("CNT", WriteValue::integer(-32769)).code, "OUT_OF_TYPE_RANGE");
    EXPECT_EQ(r.fresh("FLT32", WriteValue::number(1e39)).code, "OUT_OF_TYPE_RANGE");
    EXPECT_EQ(r.fresh("BIG", WriteValue::text("9223372036854775808")).code, "OUT_OF_TYPE_RANGE");
    EXPECT_EQ(r.fresh("UBIG", WriteValue::integer(-1)).code, "OUT_OF_TYPE_RANGE");
    EXPECT_EQ(r.fresh("SCALED", WriteValue::number(150)).code, "OUT_OF_RAW_RANGE")
        << "150 % is 41472, beyond INT16";
    EXPECT_EQ(r.fresh("NAME", WriteValue::text("123456789")).code, "STRING_TOO_LONG");
    EXPECT_EQ(r.fresh("NAME", WriteValue::text("Bơm 1234")).code, "STRING_TOO_LONG")
        << "bytes of UTF-8: 9";
    EXPECT_EQ(r.fresh("STR_LIM", WriteValue::text("12345")).code, "STRING_TOO_LONG")
        << "limits.maxLength 4";
    // the edges are in
    EXPECT_EQ(r.one("SP", WriteValue::number(90.0), idN(1)).status, "ACCEPTED");
    EXPECT_EQ(r.one("SP", WriteValue::number(0.0), idN(2)).status, "ACCEPTED");
    EXPECT_EQ(r.one("CNT", WriteValue::integer(-32768), idN(3)).status, "ACCEPTED");
    EXPECT_EQ(r.one("NAME", WriteValue::text("12345678"), idN(4)).status, "ACCEPTED");
    // when two limits are broken the first of the list is told
    EXPECT_EQ(r.fresh("INT_SET", WriteValue::number(1e39)).code, "OUT_OF_LIMITS");
}

TEST(WriteCoordinator, TheOrderOfTheChecksIsTheOrderOfTheSpec) {
    Rig r;
    r.backend.state = {drv::ChannelState::Error, drv::DeviceState::Active};
    // a Tag that does not exist beats a bad link; a bad value beats a bad link
    EXPECT_EQ(r.fresh("NOPE", WriteValue::number(1)).code, "NO_SUCH_TAG");
    EXPECT_EQ(r.fresh("LEVEL_R", WriteValue::number(1)).code, "READ_ONLY");
    EXPECT_EQ(r.fresh("SP", WriteValue::boolean(true)).code, "BAD_TYPE");
    EXPECT_EQ(r.fresh("SP", WriteValue::number(500)).code, "OUT_OF_LIMITS");
    EXPECT_EQ(r.fresh("SP", WriteValue::number(50)).code, "CONNECTION_BAD");
    // the link beats the rate limit and the project change
    r.coord->quiesce();
    EXPECT_EQ(r.fresh("SP", WriteValue::number(50)).code, "CONNECTION_BAD");
    r.backend.state = {drv::ChannelState::Connected, drv::DeviceState::Active};
    EXPECT_EQ(r.fresh("SP", WriteValue::number(50)).code, "PROJECT_CHANGING");
}

TEST(WriteCoordinator, TheLinkOfTheChannelAndOfTheFieldDeviceIsLookedAt) {
    Rig r;
    r.backend.state = {drv::ChannelState::Connecting, drv::DeviceState::Active};
    EXPECT_EQ(r.fresh("SP", WriteValue::number(1)).code, "CONNECTION_BAD");
    r.backend.state = {drv::ChannelState::Connected, drv::DeviceState::Suspended};
    EXPECT_EQ(r.fresh("SP", WriteValue::number(1)).code, "DEVICE_NOT_ACTIVE");
    r.backend.state = {drv::ChannelState::Connected, drv::DeviceState::Error};
    EXPECT_EQ(r.fresh("SP", WriteValue::number(1)).code, "DEVICE_NOT_ACTIVE");
    r.backend.state = {drv::ChannelState::Disabled, drv::DeviceState::Disabled};
    EXPECT_EQ(r.fresh("SP", WriteValue::number(1)).code, "DISABLED");
    r.backend.state = {drv::ChannelState::Connected, drv::DeviceState::Active};
    EXPECT_EQ(r.fresh("OFF", WriteValue::number(1)).code, "DISABLED") << "disabled in the project";
    // an internal Tag has no link to look at
    r.backend.state = {drv::ChannelState::Error, drv::DeviceState::Error};
    EXPECT_EQ(r.fresh("INT_SET", WriteValue::number(10)).status, "ACCEPTED");
    EXPECT_EQ(r.backend.count(), 1u);
}

// ---------- rate and queue ----------

TEST(WriteCoordinator, RateLimitedTellsHowLongToWait) {
    Rig r;
    for (int i = 0; i < 10; ++i)
        ASSERT_EQ(r.one("CNT", WriteValue::integer(i), idN(i)).status, "ACCEPTED") << i;
    const WriteView v = r.one("CNT", WriteValue::integer(1), idN(11));
    EXPECT_EQ(v.status, "REJECTED");
    EXPECT_EQ(v.code, "RATE_LIMITED");
    EXPECT_EQ(v.retryAfterMs, 3000);
    EXPECT_FALSE(v.message.empty());
    r.mono += 3000;
    EXPECT_EQ(r.one("CNT", WriteValue::integer(1), idN(12)).status, "ACCEPTED");
}

TEST(WriteCoordinator, OnlyRequestsThatPassedStepsOneToFiveSpendATokenAndLateFailuresGiveItBack) {
    CoordinatorOptions o;
    o.rate.sessionBurst = 2;
    o.rate.globalBurst = 20;
    Rig r(o);
    for (int i = 0; i < 5; ++i)
        EXPECT_EQ(r.one("SP", WriteValue::number(500), idN(i)).code, "OUT_OF_LIMITS");
    EXPECT_EQ(r.one("SP", WriteValue::number(1), idN(10)).status, "ACCEPTED");
    EXPECT_EQ(r.one("SP", WriteValue::number(2), idN(11)).status, "ACCEPTED")
        << "the five refusals cost nothing";
    EXPECT_EQ(r.one("SP", WriteValue::number(3), idN(12)).code, "RATE_LIMITED");
    // the audit goes down: the token comes back
    r.mono += 3000;
    r.audit.up = false;
    EXPECT_EQ(r.one("SP", WriteValue::number(4), idN(13)).code, "AUDIT_UNAVAILABLE");
    r.audit.up = true;
    EXPECT_EQ(r.one("SP", WriteValue::number(5), idN(14)).status, "ACCEPTED")
        << "AUDIT_UNAVAILABLE gave the token back";
}

TEST(WriteCoordinator, QueueFullPerChannelAndInAll) {
    CoordinatorOptions o;
    o.rate.sessionBurst = 10;
    o.rate.sessionPerMin = 20;
    o.rate.globalBurst = 20;
    o.queuePerChannel = 3;
    o.queueTotal = 5;
    Rig r(o);
    WriteCaller a = r.who("vh1", "s-a");
    for (int i = 0; i < 3; ++i)
        ASSERT_EQ(r.one("CNT", WriteValue::integer(i), idN(i), &a).status, "ACCEPTED");
    EXPECT_EQ(r.one("CNT", WriteValue::integer(9), idN(9), &a).code, "QUEUE_FULL")
        << "3 per channel";
    // internal Tags have their own queue; the total of 5 stops the sixth command
    EXPECT_EQ(r.one("INT_SET", WriteValue::number(1), idN(20), &a).status, "ACCEPTED");
    EXPECT_EQ(r.one("INT_SET", WriteValue::number(2), idN(21), &a).status, "ACCEPTED");
    WriteCaller b = r.who("vh2", "s-b");
    EXPECT_EQ(r.one("SIM_MAN", WriteValue::integer(1), idN(22), &b).code, "QUEUE_FULL")
        << "5 in all";
    // a result frees a place
    r.result(1, drv::WriteStatus::Confirmed, "CONFIRMED");
    EXPECT_EQ(r.one("CNT", WriteValue::integer(7), idN(23), &b).status, "ACCEPTED");
}

TEST(WriteCoordinator, AFullQueueOfTheDriverAfterTheAuditEndsInAFailedCommand) {
    Rig r;
    r.backend.full = true;
    const WriteView v = r.one("CNT", WriteValue::integer(1));
    EXPECT_EQ(v.status, "ACCEPTED") << "the record of receipt is already durable";
    const WriteView s = r.coord->status(r.who(), kId1);
    EXPECT_EQ(s.status, "FAILED");
    EXPECT_EQ(s.code, "NOT_SENT_QUEUE_FULL");
    r.coord->waitAuditIdle();
    ASSERT_EQ(r.audit.finishedRecs.size(), 1u);
    EXPECT_EQ(r.audit.finishedRecs[0].second.result, "failed");
}

// ---------- accept: durable before the driver ----------

TEST(WriteCoordinator, TheRecordOfReceiptIsDurableBeforeTheCommandReachesTheDriver) {
    Rig r;
    const WriteView v = r.one("SP", WriteValue::number(75));
    ASSERT_EQ(v.status, "ACCEPTED");
    EXPECT_EQ(v.phase, "queued");
    const int started = r.ev.indexOf("started:" + kId1);
    const int submit = r.ev.indexOf("submit:");
    ASSERT_GE(started, 0);
    ASSERT_GE(submit, 0);
    EXPECT_LT(started, submit) << "FR-039: durable before it is sent";
}

TEST(WriteCoordinator, TheAcceptedViewAndTheAuditRecordCarryTheFactsOfFR039) {
    Rig r;
    r.wall = 1791600123456LL;
    const WriteView v = r.one("SP", WriteValue::number(75));
    ASSERT_EQ(v.status, "ACCEPTED");
    EXPECT_EQ(v.requestId, kId1);
    EXPECT_EQ(v.tag, "SP");
    EXPECT_TRUE(v.hasOld);
    EXPECT_EQ(std::get<double>(v.oldValue), 72.5);
    EXPECT_EQ(v.oldQuality, Quality::GOOD);
    EXPECT_EQ(v.receivedAtMs, 1791600123456LL);
    EXPECT_FALSE(v.hasRaw) << "no scaling: no raw value";
    ASSERT_EQ(r.audit.startedRecs.size(), 1u);
    const WriteRecord& rec = r.audit.startedRecs[0];
    EXPECT_EQ(rec.requestId, kId1);
    EXPECT_EQ(rec.who.user, "vh1");
    EXPECT_EQ(rec.who.role, "operator");
    EXPECT_EQ(rec.who.source, "10.0.0.7:51000");
    EXPECT_EQ(rec.tag, "SP");
    EXPECT_EQ(rec.kind, "external");
    EXPECT_EQ(rec.channel, "plc1");
    EXPECT_EQ(rec.device, "d1");
    EXPECT_EQ(rec.newJson, "75");
    EXPECT_EQ(rec.oldJson, R"({"value":72.5,"quality":"GOOD"})");
    EXPECT_EQ(rec.receivedWallMs, 1791600123456LL);
    // the command the driver got: the raw value, the deadline of the field device, the readback
    // flag
    const drv::WriteCommand c = r.backend.cmd(0);
    EXPECT_EQ(std::get<double>(c.raw), 75.0);
    EXPECT_EQ(c.deadlineMs, 5000);
    EXPECT_TRUE(c.readback);
    EXPECT_EQ(c.tag, static_cast<size_t>(SP));
}

TEST(WriteCoordinator, ScalingIsReversedAndTheRawValueIsShown) {
    Rig r;
    const WriteView v = r.fresh("SCALED", WriteValue::number(50));
    ASSERT_EQ(v.status, "ACCEPTED");
    ASSERT_TRUE(v.hasRaw);
    EXPECT_EQ(std::get<int64_t>(v.raw), 13824);
    EXPECT_EQ(std::get<int64_t>(r.backend.cmd(0).raw), 13824);
    EXPECT_EQ(r.audit.startedRecs[0].rawJson, "13824");
    // rounded like `round` for an integer raw type
    const WriteView w = r.one("SCALED", WriteValue::number(50.003), idN(2));
    EXPECT_EQ(std::get<int64_t>(w.raw), 13825);
}

TEST(WriteCoordinator, ValuesOfEveryKind) {
    Rig r;
    EXPECT_EQ(r.one("RUN", WriteValue::boolean(true), idN(1)).status, "ACCEPTED");
    EXPECT_EQ(std::get<bool>(r.backend.cmd(0).raw), true);
    EXPECT_EQ(r.one("CNT", WriteValue::integer(-7), idN(2)).status, "ACCEPTED");
    EXPECT_EQ(std::get<int64_t>(r.backend.cmd(1).raw), -7);
    EXPECT_EQ(r.one("CNT", WriteValue::number(8.0), idN(3)).status, "ACCEPTED")
        << "8.0 is an integer";
    EXPECT_EQ(std::get<int64_t>(r.backend.cmd(2).raw), 8);
    EXPECT_EQ(r.one("SP", WriteValue::text("12.5"), idN(4)).status, "ACCEPTED");
    EXPECT_EQ(std::get<double>(r.backend.cmd(3).raw), 12.5);
    EXPECT_EQ(r.one("NAME", WriteValue::text("Bơm 1"), idN(5)).status, "ACCEPTED");
    EXPECT_EQ(std::get<std::string>(r.backend.cmd(4).raw), "Bơm 1");
    EXPECT_EQ(r.audit.startedRecs[4].newJson, "\"Bơm 1\"");
}

TEST(WriteCoordinator, SixtyFourBitValuesBeyond2To53GoAsDecimalStringsAndStayExact) {
    Rig r;
    EXPECT_EQ(r.one("BIG", WriteValue::text("9007199254740993"), idN(1)).status, "ACCEPTED");
    EXPECT_EQ(std::get<int64_t>(r.backend.cmd(0).raw), 9007199254740993LL);
    EXPECT_EQ(r.one("BIG", WriteValue::text("-9223372036854775808"), idN(2)).status, "ACCEPTED");
    EXPECT_EQ(std::get<int64_t>(r.backend.cmd(1).raw), INT64_MIN);
    EXPECT_EQ(r.one("UBIG", WriteValue::text("18446744073709551615"), idN(3)).status, "ACCEPTED");
    EXPECT_EQ(std::get<uint64_t>(r.backend.cmd(2).raw), UINT64_MAX);
    EXPECT_EQ(r.one("UBIG", WriteValue::unsignedInt(UINT64_MAX), idN(4)).status, "ACCEPTED");
    EXPECT_EQ(r.audit.startedRecs[2].newJson, "\"18446744073709551615\"")
        << "audit keeps it exact too";
}

TEST(WriteCoordinator, ARefusalSendsNothingAndIsAuditedAsDeniedWithTagAndValue) {
    Rig r;
    EXPECT_EQ(r.one("SP", WriteValue::number(500), idN(1)).code, "OUT_OF_LIMITS");
    EXPECT_EQ(r.backend.count(), 0u);
    EXPECT_TRUE(r.audit.startedRecs.empty());
    ASSERT_EQ(r.audit.deniedRecs.size(), 1u);
    EXPECT_EQ(r.audit.deniedRecs[0].tag, "SP");
    EXPECT_EQ(r.audit.deniedRecs[0].value, "500");
    EXPECT_EQ(r.audit.deniedRecs[0].code, "OUT_OF_LIMITS");
    EXPECT_EQ(r.audit.deniedRecs[0].user, "vh1");
    EXPECT_EQ(r.audit.deniedRecs[0].id, idN(1));
}

TEST(WriteCoordinator, ASameValueAsTheCurrentOneIsStillSentAndAudited) {
    Rig r;
    EXPECT_EQ(r.one("SP", WriteValue::number(72.5)).status, "ACCEPTED");
    EXPECT_EQ(r.backend.count(), 1u);
    EXPECT_EQ(r.audit.startedRecs.size(), 1u);
}

// ---------- the state machine ----------

namespace {
struct Case {
    drv::WriteStatus status;
    const char* code;
    const char* api;
};
}  // namespace

TEST(WriteCoordinator, EveryEndOfACommandHasItsStatusAndCode) {
    const Case cases[] = {
        {drv::WriteStatus::Confirmed, "CONFIRMED", "CONFIRMED"},
        {drv::WriteStatus::NoReadback, "NO_READBACK", "CONFIRMED"},
        {drv::WriteStatus::Confirmed, "APPLIED", "CONFIRMED"},
        {drv::WriteStatus::Timeout, "WRITE_TIMEOUT", "TIMEOUT"},
        {drv::WriteStatus::Timeout, "READBACK_TIMEOUT", "TIMEOUT"},
        {drv::WriteStatus::Failed, "DEVICE_EXCEPTION", "FAILED"},
        {drv::WriteStatus::Failed, "READBACK_MISMATCH", "FAILED"},
        {drv::WriteStatus::Failed, "READBACK_ERROR", "FAILED"},
        {drv::WriteStatus::Failed, "NOT_SENT_DISCONNECTED", "FAILED"},
        {drv::WriteStatus::Failed, "NOT_SENT_DEADLINE", "FAILED"},
        {drv::WriteStatus::Failed, "NOT_SENT_PROJECT_CHANGE", "FAILED"},
        {drv::WriteStatus::Failed, "NOT_SENT_READ_FAILED", "FAILED"},
    };
    int n = 0;
    for (const Case& c : cases) {
        Rig r;
        const std::string id = idN(++n);
        ASSERT_EQ(r.one("CNT", WriteValue::integer(5), id).status, "ACCEPTED") << c.code;
        EXPECT_EQ(r.coord->status(r.who(), id).status, "ACCEPTED") << "no result yet";
        EXPECT_EQ(r.coord->status(r.who(), id).phase, "queued");
        r.result(1, c.status, c.code, std::string(c.code) == "DEVICE_EXCEPTION" ? 2 : -1,
                 std::string(c.code) == "READBACK_MISMATCH" ? TagScalar(int64_t{4}) : TagScalar{});
        const WriteView s = r.coord->status(r.who(), id);
        EXPECT_EQ(s.status, c.api) << c.code;
        EXPECT_EQ(s.code, c.code);
        EXPECT_TRUE(s.finishedAtMs > 0) << c.code;
        if (std::string(c.code) == "DEVICE_EXCEPTION") EXPECT_EQ(s.exception, 2);
        if (std::string(c.code) == "READBACK_MISMATCH") {
            ASSERT_TRUE(s.hasReadback);
            EXPECT_EQ(std::get<int64_t>(s.readback), 4);
        }
        r.coord->waitAuditIdle();
        ASSERT_EQ(r.audit.finishedRecs.size(), 1u) << c.code;
        EXPECT_EQ(r.audit.finishedRecs[0].second.code, c.code);
        EXPECT_EQ(r.audit.finishedRecs[0].second.result,
                  std::string(c.api) == "CONFIRMED" ? "ok" : "failed");
    }
}

TEST(WriteCoordinator, AResultCountsOnceAndTheAuditGetsTheIdentityOfTheSender) {
    Rig r;
    ASSERT_EQ(r.one("CNT", WriteValue::integer(5)).status, "ACCEPTED");
    r.result(1, drv::WriteStatus::Confirmed, "CONFIRMED");
    r.result(1, drv::WriteStatus::Failed, "DEVICE_EXCEPTION",
             2);                                             // a second result for the same command
    r.result(99, drv::WriteStatus::Confirmed, "CONFIRMED");  // an unknown one
    r.coord->waitAuditIdle();
    ASSERT_EQ(r.audit.finishedRecs.size(), 1u);
    EXPECT_EQ(r.coord->status(r.who(), kId1).code, "CONFIRMED");
    EXPECT_EQ(r.audit.finishedRecs[0].first.who.user, "vh1")
        << "the session may be gone: the record has the account";
    EXPECT_EQ(r.audit.finishedRecs[0].first.who.source, "10.0.0.7:51000");
    EXPECT_EQ(r.audit.finishedRecs[0].first.requestId, kId1);
    EXPECT_EQ(r.coord->outstanding(), 0u);
}

TEST(WriteCoordinator, TheEngineNeverWaitsForTheAuditOfAResult) {
    Rig r;
    ASSERT_EQ(r.one("CNT", WriteValue::integer(5)).status, "ACCEPTED");
    r.audit.gate = std::make_shared<std::promise<void>>();  // the audit is slow: finished() blocks
    const auto t0 = std::chrono::steady_clock::now();
    r.result(1, drv::WriteStatus::Confirmed, "CONFIRMED");
    EXPECT_LT(
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count(),
        100)
        << "onDriverResult must only queue";
    EXPECT_EQ(r.coord->status(r.who(), kId1).status, "CONFIRMED")
        << "the client sees the result before the fsync";
    EXPECT_TRUE(r.audit.finishedRecs.empty());
    r.audit.gate->set_value();
    r.coord->waitAuditIdle();
    EXPECT_EQ(r.audit.finishedRecs.size(), 1u);
}

// ---------- request ids ----------

TEST(WriteCoordinator, ASameRequestIdWithTheSameContentGetsThePreviousAnswerAndRunsOnce) {
    Rig r;
    const WriteView first = r.one("SP", WriteValue::number(75));
    ASSERT_EQ(first.status, "ACCEPTED");
    const WriteView again = r.one("SP", WriteValue::number(75));
    EXPECT_EQ(again.status, "ACCEPTED");
    EXPECT_TRUE(again.duplicate);
    EXPECT_EQ(r.backend.count(), 1u);
    EXPECT_EQ(r.audit.startedRecs.size(), 1u);
    r.result(1, drv::WriteStatus::Confirmed, "CONFIRMED");
    const WriteView third = r.one("SP", WriteValue::number(75));
    EXPECT_EQ(third.status, "CONFIRMED") << "the result of the first time";
    EXPECT_TRUE(third.duplicate);
    EXPECT_EQ(r.backend.count(), 1u);
}

TEST(WriteCoordinator, ASameRequestIdWithOtherContentIsAConflict) {
    Rig r;
    ASSERT_EQ(r.one("SP", WriteValue::number(75)).status, "ACCEPTED");
    EXPECT_EQ(r.one("SP", WriteValue::number(76)).code, "REQUEST_ID_CONFLICT");
    EXPECT_EQ(r.one("CNT", WriteValue::integer(75)).code, "REQUEST_ID_CONFLICT");
    EXPECT_EQ(r.backend.count(), 1u);
}

TEST(WriteCoordinator, ARefusedRequestIsRememberedWithoutRunningAgainOrAuditing) {
    Rig r;
    EXPECT_EQ(r.one("SP", WriteValue::number(500)).code, "OUT_OF_LIMITS");
    r.backend.state = {drv::ChannelState::Error,
                       drv::DeviceState::Active};  // would be another reason now
    const WriteView again = r.one("SP", WriteValue::number(500));
    EXPECT_EQ(again.status, "REJECTED");
    EXPECT_EQ(again.code, "OUT_OF_LIMITS");
    EXPECT_TRUE(again.duplicate);
    EXPECT_EQ(r.audit.deniedRecs.size(), 1u) << "no second audit row";
    r.mono += 10 * 60 * 1000 + 1;  // 10 minutes later it is forgotten
    EXPECT_EQ(r.one("SP", WriteValue::number(500)).code, "OUT_OF_LIMITS");
    EXPECT_EQ(r.audit.deniedRecs.size(), 2u);
}

TEST(WriteCoordinator, AnAcceptedRequestIdIsFoundInTheTableAfterARestart) {
    Rig r;
    StoredWrite s;
    s.requestId = kId1;
    s.user = "vh1";
    s.tag = "SP";
    s.newJson = "75";
    s.finished = true;
    s.outcome = {"ok", "CONFIRMED", "75", -1};
    s.receivedWallMs = 1791600000000LL;
    s.finishedWallMs = 1791600000500LL;
    s.clockOk = true;
    r.audit.stored[kId1] = s;
    const WriteView again = r.one("SP", WriteValue::number(75));
    EXPECT_EQ(again.status, "CONFIRMED");
    EXPECT_TRUE(again.duplicate);
    EXPECT_EQ(r.backend.count(), 0u) << "never run twice, whatever happened to the process";
    EXPECT_EQ(r.one("SP", WriteValue::number(80)).code, "REQUEST_ID_CONFLICT");
    // a command the crash cut off is "no known result"
    StoredWrite cut = s;
    cut.requestId = idN(2);
    cut.outcome = {"interrupted", "UNKNOWN_OUTCOME", "", -1};
    r.audit.stored[idN(2)] = cut;
    const WriteView v = r.one("SP", WriteValue::number(75), idN(2));
    EXPECT_EQ(v.status, "TIMEOUT");
    EXPECT_EQ(v.code, "UNKNOWN_OUTCOME");
    EXPECT_EQ(r.backend.count(), 0u);
}

// ---------- order of commands, results of each caller ----------

TEST(WriteCoordinator, TwoWritersToOneTagRunInTheOrderReceivedAndEachGetsTheirOwnResult) {
    Rig r;
    WriteCaller a = r.who("vh1", "s-a");
    WriteCaller b = r.who("vh2", "s-b");
    ASSERT_EQ(r.one("SP", WriteValue::number(10), idN(1), &a).status, "ACCEPTED");
    ASSERT_EQ(r.one("SP", WriteValue::number(20), idN(2), &b).status, "ACCEPTED");
    ASSERT_EQ(r.backend.count(), 2u);
    EXPECT_EQ(std::get<double>(r.backend.cmd(0).raw), 10.0);
    EXPECT_EQ(std::get<double>(r.backend.cmd(1).raw), 20.0);
    // the old value of the second is the one at its own receipt (the first was not applied yet)
    EXPECT_EQ(std::get<double>(r.coord->status(b, idN(2)).oldValue), 72.5);
    r.result(2, drv::WriteStatus::Failed, "DEVICE_EXCEPTION", 3);
    r.result(1, drv::WriteStatus::Confirmed, "CONFIRMED");
    EXPECT_EQ(r.coord->status(a, idN(1)).status, "CONFIRMED");
    EXPECT_EQ(r.coord->status(b, idN(2)).status, "FAILED");
    EXPECT_EQ(r.coord->status(b, idN(2)).exception, 3);
}

TEST(WriteCoordinator, AFewRequestsInOnePostAreDecidedOneByOneInOrder) {
    Rig r;
    const auto v = r.coord->submit(r.who(), {{idN(1), "SP", WriteValue::number(1)},
                                             {idN(2), "SP", WriteValue::number(999)},
                                             {idN(3), "RUN", WriteValue::boolean(true)},
                                             {idN(4), "NOPE", WriteValue::number(1)}});
    ASSERT_EQ(v.size(), 4u);
    EXPECT_EQ(v[0].status, "ACCEPTED");
    EXPECT_EQ(v[1].code, "OUT_OF_LIMITS");
    EXPECT_EQ(v[2].status, "ACCEPTED");
    EXPECT_EQ(v[3].code, "NO_SUCH_TAG");
    EXPECT_EQ(v[0].requestId, idN(1));
    EXPECT_EQ(r.backend.count(), 2u);
}

// ---------- who may ask ----------

TEST(WriteCoordinator, OnlyTheSenderOrAnAdministratorSeesAResult) {
    Rig r;
    ASSERT_EQ(r.one("SP", WriteValue::number(10)).status, "ACCEPTED");
    r.result(1, drv::WriteStatus::Confirmed, "CONFIRMED");
    EXPECT_EQ(r.coord->status(r.who("vh1"), kId1).status, "CONFIRMED");
    EXPECT_EQ(r.coord->status(r.who("vh2"), kId1).status, "UNKNOWN");
    WriteCaller admin = r.who("admin1");
    admin.administrator = true;
    EXPECT_EQ(r.coord->status(admin, kId1).status, "CONFIRMED");
    EXPECT_EQ(r.coord->status(r.who("vh1"), idN(77)).status, "UNKNOWN");
}

TEST(WriteCoordinator, ResultsAreKeptFor15MinutesAndAtMost1024) {
    Rig r;
    ASSERT_EQ(r.one("SP", WriteValue::number(10)).status, "ACCEPTED");
    r.result(1, drv::WriteStatus::Confirmed, "CONFIRMED");
    r.mono += 14 * 60 * 1000;
    EXPECT_EQ(r.coord->status(r.who(), kId1).status, "CONFIRMED");
    r.mono += 61 * 1000;
    EXPECT_EQ(r.coord->status(r.who(), kId1).status, "UNKNOWN");

    CoordinatorOptions o;
    o.maxResults = 8;
    o.rate.sessionBurst = 10;
    Rig q(o);
    for (int i = 1; i <= 12; ++i) {
        ASSERT_EQ(q.one("CNT", WriteValue::integer(i), idN(i)).status, "ACCEPTED") << i;
        q.result(static_cast<uint64_t>(i), drv::WriteStatus::Confirmed, "CONFIRMED");
        q.mono += 3000;
    }
    EXPECT_EQ(q.coord->status(q.who(), idN(1)).status, "UNKNOWN")
        << "the oldest finished ones go first";
    EXPECT_EQ(q.coord->status(q.who(), idN(12)).status, "CONFIRMED");
}

// ---------- audit down ----------

TEST(WriteCoordinator, WithoutAuditEveryCommandIsRefused) {
    Rig r;
    r.audit.up = false;
    for (int i = 0; i < 3; ++i) {
        const WriteView v = r.one("SP", WriteValue::number(10), idN(i));
        EXPECT_EQ(v.status, "REJECTED");
        EXPECT_EQ(v.code, "AUDIT_UNAVAILABLE");
    }
    EXPECT_EQ(r.backend.count(), 0u);
}

// ---------- internal and simulation Tags ----------

TEST(WriteCoordinator, InternalAndManualSimulationTagsGoToTheBackendWithoutRaw) {
    Rig r;
    EXPECT_EQ(r.one("INT_SET", WriteValue::number(33), idN(1)).status, "ACCEPTED");
    EXPECT_EQ(r.one("SIM_MAN", WriteValue::integer(4), idN(2)).status, "ACCEPTED");
    ASSERT_EQ(r.backend.count(), 2u);
    EXPECT_EQ(std::get<double>(r.backend.cmd(0).raw), 33.0);
    EXPECT_EQ(std::get<int64_t>(r.backend.cmd(1).raw), 4);
    EXPECT_EQ(r.audit.startedRecs[0].kind, "internal");
    EXPECT_EQ(r.audit.startedRecs[1].kind, "simulation");
    EXPECT_EQ(r.audit.startedRecs[0].channel, "");
    r.result(1, drv::WriteStatus::Confirmed, "APPLIED");
    EXPECT_EQ(r.coord->status(r.who(), idN(1)).code, "APPLIED");
}

TEST(WriteCoordinator, ATagWithoutReadbackAsksTheDriverNotToReadBack) {
    Rig r;
    ASSERT_EQ(r.one("NOREAD", WriteValue::boolean(true)).status, "ACCEPTED");
    EXPECT_FALSE(r.backend.cmd(0).readback);
}

// ---------- quiesce ----------

TEST(WriteCoordinatorQuiesce, NewCommandsAreRefusedAndUnsentOnesFailWithTheirAudit) {
    Rig r;
    ASSERT_EQ(r.one("SP", WriteValue::number(1), idN(1)).status,
              "ACCEPTED");  // internal id 1: being sent
    ASSERT_EQ(r.one("SP", WriteValue::number(2), idN(2)).status, "ACCEPTED");  // id 2: unsent
    ASSERT_EQ(r.one("SP", WriteValue::number(3), idN(3)).status, "ACCEPTED");  // id 3: unsent
    r.backend.unsent = {2, 3};
    std::thread engine([&] {  // the command being sent ends while quiesce waits
        std::this_thread::sleep_for(std::chrono::milliseconds(150));
        r.result(1, drv::WriteStatus::Confirmed, "CONFIRMED");
    });
    const auto rep = r.coord->quiesce();
    engine.join();
    EXPECT_EQ(rep.cancelled, 2);
    EXPECT_EQ(rep.waited, 1);
    EXPECT_EQ(rep.unfinished, 0);
    EXPECT_TRUE(r.coord->changing());
    EXPECT_EQ(r.coord->status(r.who(), idN(1)).status, "CONFIRMED");
    EXPECT_EQ(r.coord->status(r.who(), idN(2)).status, "FAILED");
    EXPECT_EQ(r.coord->status(r.who(), idN(2)).code, "NOT_SENT_PROJECT_CHANGE");
    EXPECT_EQ(r.coord->status(r.who(), idN(3)).code, "NOT_SENT_PROJECT_CHANGE");
    // every result is in the audit when quiesce returns
    EXPECT_EQ(r.audit.finishedRecs.size(), 3u);
    EXPECT_EQ(r.one("SP", WriteValue::number(9), idN(9)).code, "PROJECT_CHANGING");
    EXPECT_EQ(r.backend.count(), 3u) << "nothing went out after quiesce began";
}

TEST(WriteCoordinatorQuiesce, ItWaitsForAnAnswerAtMostTwiceTheLongestTimeoutPlusOneSecond) {
    Rig r;
    r.backend.maxTimeout = 50;  // 2 x 50 + 1000 = 1.1 s
    ASSERT_EQ(r.one("SP", WriteValue::number(1)).status, "ACCEPTED");
    const auto t0 = std::chrono::steady_clock::now();
    const auto rep = r.coord->quiesce();  // the command never ends
    const auto took =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count();
    EXPECT_EQ(rep.waited, 1);
    EXPECT_EQ(rep.unfinished, 1);
    EXPECT_GE(took, 1000);
    EXPECT_LT(took, 2500);
}

TEST(WriteCoordinatorQuiesce, WithNothingToWaitForItReturnsAtOnceAndIsRepeatable) {
    Rig r;
    const auto t0 = std::chrono::steady_clock::now();
    const auto rep = r.coord->quiesce();
    r.coord->quiesce();
    EXPECT_LT(
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count(),
        300);
    EXPECT_EQ(rep.cancelled + rep.waited + rep.unfinished, 0);
}

TEST(WriteCoordinatorQuiesce, ItWaitsForTheAuditToHaveEveryResult) {
    Rig r;
    ASSERT_EQ(r.one("SP", WriteValue::number(1)).status, "ACCEPTED");
    r.backend.unsent = {1};
    r.audit.gate = std::make_shared<std::promise<void>>();
    std::thread t([&] {
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
        r.audit.gate->set_value();
    });
    r.coord->quiesce();
    t.join();
    EXPECT_EQ(r.audit.finishedRecs.size(), 1u)
        << "quiesce returned before the audit had the result";
}

// ---------- recordDenied: the refusals decided by the HTTP layer and the live channel ----------

TEST(WriteCoordinator, ARefusalOfTheHttpLayerIsAuditedWithTagAndValue) {
    Rig r;
    r.coord->recordDenied(r.who(), kId1, "SP", WriteValue::number(75), true, "FORBIDDEN");
    r.coord->recordDenied(r.who(), "", "", WriteValue{}, false, "HTTPS_REQUIRED");
    ASSERT_EQ(r.audit.deniedRecs.size(), 2u);
    EXPECT_EQ(r.audit.deniedRecs[0].tag, "SP");
    EXPECT_EQ(r.audit.deniedRecs[0].value, "75");
    EXPECT_EQ(r.audit.deniedRecs[0].code, "FORBIDDEN");
    EXPECT_EQ(r.audit.deniedRecs[1].tag, "");
    EXPECT_EQ(r.audit.deniedRecs[1].value, "");
    r.audit.up = false;
    r.coord->recordDenied(r.who(), kId1, "SP", WriteValue::number(75), true,
                          "FORBIDDEN");  // swallowed
}

TEST(WriteCoordinator, ConcurrentRequestsWithTheSameIdRunOnlyOnce) {
    // T210 (security review): the id look-up and the insert of the entry are two critical sections.
    for (int round = 0; round < 40; ++round) {
        Rig r;
        const std::string id = idN(5000 + round);
        std::atomic<bool> go{false};
        std::vector<std::thread> threads;
        for (int i = 0; i < 6; ++i) {
            threads.emplace_back([&] {
                while (!go.load()) std::this_thread::yield();
                (void)r.coord->submit(r.who(), {{id, "SP", WriteValue::number(75)}});
            });
        }
        go = true;
        for (auto& t : threads) t.join();
        EXPECT_EQ(r.backend.count(), 1u) << "round " << round;
    }
}

// ---------- feature 011 T036: two pulses on one Tag; a release never sleeps (FR-020) ----------

namespace {
WriteRequest pulseReq(const std::string& tag, int n, int64_t ms) {
    WriteRequest q;
    q.requestId = idN(n);
    q.tag = tag;
    q.value = WriteValue::boolean(true);
    q.pulseMs = ms;
    return q;
}
bool waitUntil(const std::function<bool()>& pred, int ms = 3000) {
    const auto end = std::chrono::steady_clock::now() + std::chrono::milliseconds(ms);
    while (std::chrono::steady_clock::now() < end) {
        if (pred()) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    return pred();
}
}  // namespace

TEST(WriteCoordinator, ASecondPulseOnATagWhosePulseRunsIsPulseInProgress) {
    Rig r;
    ASSERT_EQ(r.coord->submit(r.who(), {pulseReq("RUN", 1, 500)}).at(0).status, "ACCEPTED");
    const WriteView second = r.coord->submit(r.who(), {pulseReq("RUN", 2, 500)}).at(0);
    EXPECT_EQ(second.status, "REJECTED");
    EXPECT_EQ(second.code, "PULSE_IN_PROGRESS");
    EXPECT_FALSE(second.message.empty());
    EXPECT_EQ(r.backend.count(), 1u) << "nothing sent for the second";
    {
        std::lock_guard<std::mutex> g(r.audit.mu);
        ASSERT_FALSE(r.audit.deniedRecs.empty());
        EXPECT_EQ(r.audit.deniedRecs.back().code, "PULSE_IN_PROGRESS");
    }
    // also while the first waits for its release
    r.result(r.backend.cmd(0).id, drv::WriteStatus::Confirmed, "CONFIRMED");
    EXPECT_EQ(r.coord->submit(r.who(), {pulseReq("RUN", 3, 500)}).at(0).code, "PULSE_IN_PROGRESS");
    // a pulse on another Tag is not concerned
    EXPECT_EQ(r.coord->submit(r.who(), {pulseReq("NOREAD", 4, 500)}).at(0).status, "ACCEPTED");
    // once the first pulse has ended, the Tag takes a pulse again
    r.mono += 500;
    ASSERT_TRUE(waitUntil([&] { return r.backend.count() == 3; }));
    for (size_t i = 0; i < r.backend.count(); ++i)
        if (r.backend.cmd(i).priority && r.backend.cmd(i).tag == RUN)
            r.result(r.backend.cmd(i).id, drv::WriteStatus::Confirmed, "CONFIRMED");
    ASSERT_EQ(r.coord->status(r.who(), idN(1)).status, "CONFIRMED");
    EXPECT_EQ(r.coord->submit(r.who(), {pulseReq("RUN", 5, 500)}).at(0).status, "ACCEPTED");
}

TEST(WriteCoordinator, AReleaseADriverCannotTakeIsRescheduledAndNeverHoldsUpAnotherPulse) {
    Rig r;
    ASSERT_EQ(r.coord->submit(r.who(), {pulseReq("RUN", 1, 200)}).at(0).status, "ACCEPTED");
    ASSERT_EQ(r.coord->submit(r.who(), {pulseReq("NOREAD", 2, 200)}).at(0).status, "ACCEPTED");
    r.result(r.backend.cmd(0).id, drv::WriteStatus::Confirmed, "CONFIRMED");
    r.result(r.backend.cmd(1).id, drv::WriteStatus::NoReadback, "NO_READBACK");
    {
        std::lock_guard<std::mutex> g(r.backend.mu);
        r.backend.fullTags = {RUN};  // the queue of RUN's channel cannot take its release
    }
    r.mono += 200;  // both due at once, RUN first
    ASSERT_TRUE(waitUntil([&] { return r.backend.count() == 3; }))
        << "the release of NOREAD went out";
    std::chrono::steady_clock::time_point runRefused{}, noreadSent{};
    {
        std::lock_guard<std::mutex> g(r.backend.mu);
        for (size_t i = 2; i < r.backend.attempts.size(); ++i) {  // after the two on writes
            const auto& a = r.backend.attempts[i];
            if (a.first == RUN && runRefused == std::chrono::steady_clock::time_point{})
                runRefused = a.second;
            if (a.first == NOREAD) noreadSent = a.second;
        }
    }
    ASSERT_NE(runRefused, std::chrono::steady_clock::time_point{});
    EXPECT_LT(
        std::chrono::duration_cast<std::chrono::milliseconds>(noreadSent - runRefused).count(), 100)
        << "the pulse thread does not sleep on a full queue";
    // RUN's release is tried again on the runtime's clock, not by sleeping
    std::this_thread::sleep_for(std::chrono::milliseconds(150));
    size_t runTries = 0;
    {
        std::lock_guard<std::mutex> g(r.backend.mu);
        for (size_t i = 2; i < r.backend.attempts.size(); ++i)
            if (r.backend.attempts[i].first == RUN) ++runTries;
        r.backend.fullTags.clear();
    }
    EXPECT_EQ(runTries, 1u) << "the fake clock has not moved: no second try yet";
    r.mono += 100;
    ASSERT_TRUE(waitUntil([&] { return r.backend.count() == 4; }));
    EXPECT_EQ(r.backend.cmd(3).tag, static_cast<size_t>(RUN));
    EXPECT_TRUE(r.backend.cmd(3).priority);
}
