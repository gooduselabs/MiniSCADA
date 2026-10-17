// Rule semantics (T127, C++ half; FR-076, FR-077, FR-081, FR-082; contracts/logic-engine.md §2,
// §8, §10), as packages/logic-engine/src/rules.test.ts: hold, edges, fireOnStart, repeatMs,
// SUSPENDED and the resume without a false edge, edgeId across a restart, order by id, the
// topological order, THROTTLED, writes off, a value outside `allowed`; and the static codes
// (cycle, self trigger, write conflict) through the C++ validator.
#include <gtest/gtest.h>

#include <cmath>

#include "core/logic/tests/test_util.hpp"
#include "core/logic/tests/vector_runner.hpp"
#include "core/project-manager/rules_logic.hpp"

using namespace mat;
using namespace mat::logic;
using namespace mat::logic::test;

namespace {

TagInfoMap tags() {
    return {{"LEVEL", tagInfo(TagType::FLOAT64)},
            {"RUN", tagInfo(TagType::BOOL)},
            {"CMD", tagInfo(TagType::BOOL, "external", true)},
            {"SP", tagInfo(TagType::FLOAT64, "external", true)},
            {"MODE", tagInfo(TagType::BOOL, "internal", true)},
            {"N", tagInfo(TagType::INT32, "internal", true)}};
}
const json kWCmd = {{"id", "w_cmd"},
                    {"tag", "CMD"},
                    {"allowed", {{"values", {true, false}}}},
                    {"minIntervalMs", 1000},
                    {"maxPerHour", 100}};
const json kWSp = {{"id", "w_sp"},
                   {"tag", "SP"},
                   {"allowed", {{"min", 0}, {"max", 100}}},
                   {"minIntervalMs", 1000},
                   {"maxPerHour", 100}};

json lowRule(json o = json::object()) {
    json r = {{"id", "low"},
              {"when", "LEVEL < 20"},
              {"hold", 1000},
              {"onRise", json::array({{{"do", "write"}, {"write", "w_cmd"}, {"value", true}}})},
              {"onFall", json::array({{{"do", "write"}, {"write", "w_cmd"}, {"value", false}}})}};
    for (auto it = o.begin(); it != o.end(); ++it) r[it.key()] = it.value();
    return r;
}

std::unique_ptr<Harness> make(json d, Config cfg = {}) {
    json doc = {{"schemaVersion", "1.0.0"}, {"writes", json::array({kWCmd, kWSp})}};
    for (auto it = d.begin(); it != d.end(); ++it) doc[it.key()] = it.value();
    return makeHarness(doc, tags(), cfg);
}

std::string text(const ActionOut& a) {
    if (!a.hasValue) return "undefined";
    const json v = scalarJson(a.value);
    if (v.is_boolean()) return v.get<bool>() ? "true" : "false";
    if (v.is_number()) {
        const double d = v.get<double>();
        char buf[32];
        std::snprintf(buf, sizeof buf, std::floor(d) == d ? "%.0f" : "%g", d);
        return buf;
    }
    if (v.is_string()) return v.get<std::string>();
    return "null";
}

std::vector<std::string> brief(const std::vector<ActionOut>& as) {
    std::vector<std::string> out;
    for (const auto& a : as)
        out.push_back(a.rule + ":" + a.doName + ":" + text(a) + ":" + a.result);
    return out;
}
using V = std::vector<std::string>;

void setLevel(Harness& h, double v) { setN(h, "LEVEL", v); }

}  // namespace

TEST(RuleHold, RisingEdgeAfterAContinuousHoldCancelledByAnEarlyChange) {
    auto h = make({{"rules", json::array({lowRule()})}});
    setLevel(*h, 50);
    EXPECT_TRUE(h->runTo(1000).empty());
    setLevel(*h, 10);
    EXPECT_TRUE(h->runTo(1500).empty());
    setLevel(*h, 30);
    EXPECT_TRUE(h->runTo(1600).empty());
    setLevel(*h, 10);
    EXPECT_TRUE(h->runTo(2600).empty());
    const auto a = h->runTo(2700);
    EXPECT_EQ(brief(a), V{"low:write:true:QUEUED"});
    EXPECT_EQ(a[0].tag, "CMD");
    EXPECT_EQ(a[0].write, "w_cmd");
    EXPECT_EQ(a[0].edgeId, 1);
    EXPECT_EQ(a[0].t, 2700);
    EXPECT_TRUE(h->runTo(10000).empty());
    setLevel(*h, 25);
    EXPECT_TRUE(h->runTo(11000).empty());
    EXPECT_EQ(brief(h->runTo(11100)), V{"low:write:false:QUEUED"});
    EXPECT_EQ(h->state("low")->state, "OK");
    EXPECT_EQ(h->state("low")->edgeId, 2);
}

TEST(RuleHold, HoldZeroIsStableInTheSameScan) {
    auto h = make({{"rules", json::array({lowRule({{"hold", 0}})})}});
    setLevel(*h, 50);
    h->runTo(0);
    setLevel(*h, 10);
    EXPECT_EQ(brief(h->runTo(100)), V{"low:write:true:QUEUED"});
}

TEST(RuleHold, FirstValidScanFiresNothing) {
    auto h = make({{"rules", json::array({lowRule({{"hold", 0}})})}});
    setLevel(*h, 10);
    EXPECT_TRUE(h->runTo(5000).empty());
    EXPECT_EQ(h->state("low")->stable, std::optional<bool>(true));
}

TEST(RuleHold, FireOnStartRunsOnRiseOnceWhenTrue) {
    auto h = make({{"rules", json::array({lowRule({{"fireOnStart", true}})})}});
    setLevel(*h, 10);
    EXPECT_EQ(brief(h->runTo(0)), V{"low:write:true:QUEUED"});
    EXPECT_TRUE(h->runTo(5000).empty());
    auto g = make({{"rules", json::array({lowRule({{"fireOnStart", true}})})}});
    setLevel(*g, 50);
    EXPECT_TRUE(g->runTo(5000).empty());
}

TEST(RuleRepeat, AgainEveryRepeatMsWhileTrueNeverForOnFall) {
    auto h = make({{"rules", json::array({lowRule({{"hold", 0}, {"repeatMs", 10000}})})}});
    setLevel(*h, 50);
    h->runTo(0);
    setLevel(*h, 10);
    EXPECT_EQ(brief(h->runTo(100)), V{"low:write:true:QUEUED"});
    EXPECT_TRUE(h->runTo(10000).empty());
    const auto a = h->runTo(10100);
    EXPECT_EQ(brief(a), V{"low:write:true:QUEUED"});
    EXPECT_EQ(a[0].edgeId, 2);
    EXPECT_EQ(brief(h->runTo(20100)), V{"low:write:true:QUEUED"});
    EXPECT_TRUE(h->runTo(21100).empty());
    setLevel(*h, 50);
    EXPECT_EQ(brief(h->runTo(21200)), V{"low:write:false:QUEUED"});
    EXPECT_TRUE(h->runTo(60000).empty());
}

TEST(RuleRepeat, NoRepeatWhenTrueSinceStartWithoutARun) {
    auto h = make({{"rules", json::array({lowRule({{"hold", 0}, {"repeatMs", 10000}})})}});
    setLevel(*h, 10);
    EXPECT_TRUE(h->runTo(60000).empty());
}

TEST(RuleSuspended, BadInputFreezesWithoutAFalseEdgeOnReturn) {
    auto h = make({{"rules", json::array({lowRule()})}});
    setLevel(*h, 10);
    h->runTo(0);
    EXPECT_EQ(h->state("low")->stable, std::optional<bool>(true));
    setBad(*h, "LEVEL", TagScalar{50.0});
    EXPECT_TRUE(h->runTo(5000).empty());
    EXPECT_EQ(h->state("low")->state, "SUSPENDED");
    EXPECT_EQ(h->state("low")->reason, "INPUT_BAD");
    EXPECT_EQ(h->state("low")->stable, std::optional<bool>(true));
    setLevel(*h, 10);
    EXPECT_TRUE(h->runTo(10000).empty());
    EXPECT_EQ(h->state("low")->state, "OK");
}

TEST(RuleSuspended, HoldRestartsFromZeroAfterASuspension) {
    auto h = make({{"rules", json::array({lowRule()})}});
    setLevel(*h, 50);
    h->runTo(0);
    setLevel(*h, 10);
    h->runTo(800);
    setBad(*h, "LEVEL");
    h->runTo(900);
    setLevel(*h, 10);
    EXPECT_TRUE(h->runTo(1900).empty());
    EXPECT_EQ(brief(h->runTo(2000)), V{"low:write:true:QUEUED"});
}

TEST(RuleSuspended, NoValueAndUncertainAreUnknown) {
    auto h = make({{"rules", json::array({lowRule()})}});
    h->runTo(500);
    EXPECT_EQ(h->state("low")->state, "SUSPENDED");
    EXPECT_EQ(h->state("low")->reason, "INPUT_BAD");
    expr::InputValue u;
    u.value = 10.0;
    u.quality = Quality::UNCERTAIN;
    u.reason = "STALE";
    h->set("LEVEL", u);
    h->runTo(600);
    EXPECT_EQ(h->state("low")->reason, "INPUT_BAD");
}

TEST(RuleSuspended, DivisionByZeroIsExprError) {
    auto h = make({{"rules", json::array({lowRule({{"when", "100 / LEVEL > 1"}})})}});
    setLevel(*h, 0);
    h->runTo(0);
    EXPECT_EQ(h->state("low")->state, "SUSPENDED");
    EXPECT_EQ(h->state("low")->reason, "EXPR_ERROR");
}

TEST(RuleSuspended, ScheduleWithoutSyncedClockIsTimeNotSynced) {
    auto h =
        make({{"rules", json::array({lowRule({{"when", "L.DAY && LEVEL < 20"}})})},
              {"schedules", json::array({{{"id", "s_day"},
                                          {"weekly", json::array({{{"days", {1, 2, 3, 4, 5, 6, 7}},
                                                                   {"from", "06:00"},
                                                                   {"to", "18:00"}}})},
                                          {"out", "L.DAY"}}})}});
    setLevel(*h, 10);
    h->setWall(parseWall("2026-10-19T08:00:00+07:00"), false, 0);
    h->runTo(0);
    EXPECT_EQ(h->state("low")->state, "SUSPENDED");
    EXPECT_EQ(h->state("low")->reason, "TIME_NOT_SYNCED");
    h->setWall(parseWall("2026-10-19T08:00:00+07:00"), true, 100);
    h->runTo(100);
    EXPECT_EQ(h->state("low")->state, "OK");
    EXPECT_EQ(h->state("low")->stable, std::optional<bool>(true));
}

TEST(RuleSuspended, DisabledDoesNothing) {
    auto h = make({{"rules", json::array({lowRule({{"enabled", false}, {"hold", 0}})})}});
    setLevel(*h, 50);
    h->runTo(0);
    setLevel(*h, 10);
    EXPECT_TRUE(h->runTo(1000).empty());
    EXPECT_EQ(h->state("low")->state, "DISABLED");
}

TEST(RuleOrder, RulesByIdActionsInDeclarationOrder) {
    const auto r = [](const char* id, int v) {
        return json{{"id", id},
                    {"when", "LEVEL < 20"},
                    {"onRise", json::array({{{"do", "setTag"}, {"tag", "N"}, {"value", v}},
                                            {{"do", "write"}, {"write", "w_sp"}, {"value", v}}})}};
    };
    auto h = make({{"rules", json::array({r("zeta", 3), r("alpha", 1), r("mid", 2)})}});
    setLevel(*h, 50);
    h->runTo(0);
    setLevel(*h, 10);
    EXPECT_EQ(brief(h->runTo(100)),
              (V{"alpha:setTag:1:OK", "alpha:write:1:QUEUED", "mid:setTag:2:OK",
                 "mid:write:2:RATE_LIMITED", "zeta:setTag:3:OK", "zeta:write:3:RATE_LIMITED"}));
}

TEST(RuleOrder, SetTagTakesEffectNextScanToggleInverts) {
    auto h = make(
        {{"rules",
          json::array(
              {{{"id", "a"},
                {"when", "RUN"},
                {"onRise", json::array({{{"do", "setTag"}, {"tag", "MODE"}, {"value", true}}})}},
               {{"id", "c"},
                {"when", "MODE"},
                {"onRise", json::array({{{"do", "setTag"}, {"tag", "N"}, {"value", 5}}})}},
               {{"id", "e"},
                {"when", "N > 0"},
                {"onRise", json::array({{{"do", "toggle"}, {"tag", "MODE"}}})}}})}});
    setB(*h, "RUN", false);
    setB(*h, "MODE", false);
    setN(*h, "N", 0);
    h->runTo(0);
    setB(*h, "RUN", true);
    EXPECT_EQ(brief(h->runTo(100)), V{"a:setTag:true:OK"});
    EXPECT_EQ(value(*h, "MODE"), json(true));
    EXPECT_EQ(brief(h->runTo(200)), V{"c:setTag:5:OK"});
    EXPECT_EQ(value(*h, "N"), json(5.0));
    EXPECT_EQ(brief(h->runTo(300)), V{"e:toggle:false:OK"});
    EXPECT_EQ(value(*h, "MODE"), json(false));
    EXPECT_TRUE(h->runTo(1000).empty());
}

TEST(RuleOrder, ExpressionValueAtFiringOutsideAllowedIsOutOfLimits) {
    auto h =
        make({{"rules",
               json::array({{{"id", "r"},
                             {"when", "RUN"},
                             {"onRise", json::array({{{"do", "write"},
                                                      {"write", "w_sp"},
                                                      {"value", {{"expr", "LEVEL * 2"}}}}})}}})}});
    setB(*h, "RUN", false);
    setLevel(*h, 30);
    h->runTo(0);
    setB(*h, "RUN", true);
    EXPECT_EQ(brief(h->runTo(100)), V{"r:write:60:QUEUED"});
    setB(*h, "RUN", false);
    setLevel(*h, 70);
    h->runTo(5000);
    setB(*h, "RUN", true);
    EXPECT_EQ(brief(h->runTo(5100)), V{"r:write:140:OUT_OF_LIMITS"});
    EXPECT_EQ(h->state("r")->lastError, std::optional<std::string>("OUT_OF_LIMITS"));
}

TEST(RuleOrder, ABlockSeesTheOutputOfAnEarlierBlockOfTheSameScan) {
    auto h = make(
        {{"rules",
          json::array(
              {{{"id", "a_rule"},
                {"when", "L.T"},
                {"onRise", json::array({{{"do", "setTag"}, {"tag", "N"}, {"value", 1}}})}}})},
         {"timers",
          json::array(
              {{{"id", "z_timer"}, {"kind", "ton"}, {"in", "RUN"}, {"pt", 300}, {"q", "L.T"}}})}});
    setB(*h, "RUN", false);
    h->runTo(0);
    setB(*h, "RUN", true);
    EXPECT_TRUE(h->runTo(300).empty());
    const auto a = h->runTo(400);
    EXPECT_EQ(brief(a), V{"a_rule:setTag:1:OK"});
    EXPECT_EQ(a[0].t, 400);
    EXPECT_EQ(value(*h, "L.T"), json(true));
    EXPECT_EQ(h->engine().blockIds(), (V{"z_timer", "a_rule"}));
}

namespace {

const json kRule = {
    {"id", "r"},
    {"when", "RUN"},
    {"onRise", json::array({{{"do", "write"}, {"write", "w_cmd"}, {"value", true}}})}};

V flap(Harness& h, int64_t from, int n, int64_t period) {
    V out;
    for (int i = 0; i < n; ++i) {
        setB(h, "RUN", true);
        for (auto& s : brief(h.runTo(from + i * period))) out.push_back(s);
        setB(h, "RUN", false);
        h.runTo(from + i * period + period / 2);
    }
    return out;
}

}  // namespace

TEST(RuleLimits, MinIntervalRateLimitsAndThrottledFor60s) {
    json w = kWCmd;
    w["minIntervalMs"] = 5000;
    auto h = make({{"writes", json::array({w})}, {"rules", json::array({kRule})}});
    setB(*h, "RUN", false);
    h->runTo(0);
    EXPECT_EQ(flap(*h, 1000, 3, 2000),
              (V{"r:write:true:QUEUED", "r:write:true:RATE_LIMITED", "r:write:true:RATE_LIMITED"}));
    EXPECT_EQ(h->state("r")->state, "THROTTLED");
    EXPECT_EQ(h->state("r")->lastError, std::optional<std::string>("RATE_LIMITED"));
    h->runTo(64000);
    EXPECT_EQ(h->state("r")->state, "THROTTLED");
    h->runTo(64100);
    EXPECT_EQ(h->state("r")->state, "OK");
}

TEST(RuleLimits, MaxPerHourSlidingWindow) {
    json w = kWCmd;
    w["maxPerHour"] = 3;
    auto h = make({{"writes", json::array({w})}, {"rules", json::array({kRule})}});
    setB(*h, "RUN", false);
    h->runTo(0);
    const V r = flap(*h, 1000, 5, 2000);
    EXPECT_EQ(
        std::count_if(r.begin(), r.end(),
                      [](const std::string& s) { return s.find("QUEUED") != std::string::npos; }),
        3);
    EXPECT_EQ(V(r.begin() + 3, r.end()),
              (V{"r:write:true:RATE_LIMITED", "r:write:true:RATE_LIMITED"}));
    h->runTo(3600900);
    EXPECT_EQ(flap(*h, 3601000, 1, 2000), V{"r:write:true:QUEUED"});
}

TEST(RuleLimits, DeviceWideTokenBucket) {
    json rules = json::array(), writes = json::array();
    for (int i = 0; i < 4; ++i) {
        rules.push_back({{"id", "r" + std::to_string(i)},
                         {"when", "RUN"},
                         {"onRise", json::array({{{"do", "write"},
                                                  {"write", "w" + std::to_string(i)},
                                                  {"value", true}}})}});
        json w = kWCmd;
        w["id"] = "w" + std::to_string(i);
        writes.push_back(w);
    }
    Config c;
    c.maxWritesPerMin = 3;
    auto h = make({{"writes", writes}, {"rules", rules}}, c);
    const auto results = [](const std::vector<ActionOut>& as) {
        V out;
        for (const auto& a : as) out.push_back(a.result);
        return out;
    };
    setB(*h, "RUN", false);
    h->runTo(0);
    setB(*h, "RUN", true);
    EXPECT_EQ(results(h->runTo(100)), (V{"QUEUED", "QUEUED", "QUEUED", "RATE_LIMITED"}));
    setB(*h, "RUN", false);
    h->runTo(20000);
    setB(*h, "RUN", true);
    EXPECT_EQ(results(h->runTo(20100)),
              (V{"QUEUED", "RATE_LIMITED", "RATE_LIMITED", "RATE_LIMITED"}));
}

TEST(RuleLimits, WritesOffSuppressesAndSetTagStillRuns) {
    json r = kRule;
    r["onRise"] = json::array({{{"do", "setTag"}, {"tag", "MODE"}, {"value", true}},
                               {{"do", "write"}, {"write", "w_cmd"}, {"value", true}}});
    Config c;
    c.writesOn = false;
    auto h = make({{"rules", json::array({r})}}, c);
    setB(*h, "RUN", false);
    h->runTo(0);
    EXPECT_EQ(flap(*h, 1000, 2, 2000), (V{"r:setTag:true:OK", "r:write:true:SUPPRESSED",
                                          "r:setTag:true:OK", "r:write:true:SUPPRESSED"}));
    EXPECT_EQ(h->state("r")->state, "OK");
}

TEST(RuleLimits, AdministratorStopAtRunTimeSuppresses) {
    auto h = make({{"rules", json::array({kRule})}});
    setB(*h, "RUN", false);
    h->runTo(0);
    h->engine().setWritesOn(false);
    EXPECT_EQ(flap(*h, 1000, 1, 2000), V{"r:write:true:SUPPRESSED"});
    h->engine().setWritesOn(true);
    EXPECT_EQ(flap(*h, 3000, 1, 2000), V{"r:write:true:QUEUED"});
}

TEST(RuleLimits, FailedResultGoesToLastErrorNoRetry) {
    auto h = make({{"rules", json::array({kRule})}});
    setB(*h, "RUN", false);
    h->runTo(0);
    setB(*h, "RUN", true);
    const auto a = h->runTo(100);
    h->writeResult("r", "FAILED");
    EXPECT_EQ(h->state("r")->state, "OK");
    EXPECT_EQ(h->state("r")->lastError, std::optional<std::string>("FAILED"));
    EXPECT_EQ(h->state("r")->edgeId, a[0].edgeId);
    EXPECT_TRUE(h->runTo(10000).empty());
}

TEST(RuleEdgeId, ContinuesFromTheSavedValueAndAHalfEdgeDoesNotFireAgain) {
    auto h = make({{"rules", json::array({lowRule({{"hold", 0}})})}});
    setLevel(*h, 50);
    h->runTo(0);
    for (int i = 0; i < 3; ++i) {
        setLevel(*h, 10);
        h->runTo(100 + i * 2000);
        setLevel(*h, 50);
        h->runTo(1100 + i * 2000);
    }
    EXPECT_EQ(h->state("low")->edgeId, 6);
    h->flush();
    setLevel(*h, 10);
    h->runTo(6000);
    EXPECT_EQ(h->state("low")->edgeId, 7);
    h->restart(nullptr, Harness::RetainFrom::Flushed, nullptr, std::nullopt);
    setLevel(*h, 10);
    EXPECT_TRUE(h->runTo(6100).empty());
    setLevel(*h, 50);
    const auto a = h->runTo(6200);
    ASSERT_EQ(a.size(), 1u);
    EXPECT_EQ(a[0].doName, "write");
    EXPECT_EQ(scalarJson(a[0].value), json(false));
    EXPECT_EQ(a[0].edgeId, 7);
}

namespace {

std::vector<std::string> codes(json d, bool warnings = false) {
    json doc = {{"schemaVersion", "1.0.0"}, {"writes", json::array({kWCmd})}};
    for (auto it = d.begin(); it != d.end(); ++it) doc[it.key()] = it.value();
    const TagInfoMap t = tags();
    LogicCheckOptions o;
    o.tags = &t;
    const LogicCheck r = checkLogic(doc, o);
    std::vector<std::string> out;
    for (const auto& e : warnings ? r.warnings : r.errors) out.push_back(e.code);
    return out;
}

}  // namespace

TEST(RuleStatic, Cycle) {
    EXPECT_EQ(
        codes({{"timers",
                json::array(
                    {{{"id", "a"}, {"kind", "ton"}, {"in", "L.B"}, {"pt", 100}, {"q", "L.A"}},
                     {{"id", "b"}, {"kind", "tof"}, {"in", "L.A"}, {"pt", 100}, {"q", "L.B"}}})}}),
        V{"E_LOGIC_CYCLE"});
}

TEST(RuleStatic, SelfTrigger) {
    EXPECT_EQ(codes({{"rules", json::array({{{"id", "r"},
                                             {"when", "!MODE"},
                                             {"onRise", json::array({{{"do", "setTag"},
                                                                      {"tag", "MODE"},
                                                                      {"value", true}}})}}})}}),
              V{"E_LOGIC_SELF_TRIGGER"});
}

TEST(RuleStatic, WriteConflict) {
    const auto r = [](const char* id, bool v) {
        return json{{"id", id},
                    {"when", "RUN"},
                    {"hold", 1000},
                    {"onRise", json::array({{{"do", "write"}, {"write", "w_cmd"}, {"value", v}}})}};
    };
    EXPECT_EQ(codes({{"rules", json::array({r("a", true), r("b", false)})}}, true),
              V{"W_LOGIC_WRITE_CONFLICT"});
}

TEST(LogicBucket, HoldsNoMoreThanAMinuteOfCommandsWhenNobodyAsks) {
    // T062: recent() (GET /logic) is the only reader; without it the times piled up for ever
    Bucket b(60);
    int64_t now = 0;
    for (int i = 0; i < 100000; ++i) {
        now += 1000;  // one a second: a token is back every second
        ASSERT_TRUE(b.allows(now)) << i;
        b.take();
        ASSERT_LE(b.held(), 61u) << i;
    }
    EXPECT_EQ(b.recent(now), 60);
}
