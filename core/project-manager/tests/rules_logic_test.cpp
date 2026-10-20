// The validator of logic.json (T128, C++ half; FR-093; SC-024; contracts/logic-engine.md §1, §11),
// as packages/project-schema/src/rules-logic.test.ts: every E_LOGIC_* and W_LOGIC_* code has a
// failing and a passing case, the limits, `writes`, output collisions, cycles, self trigger, the
// logic Tags declared as internal read-only Tags; and the verdict of TS on the static group of
// tests/logic-vectors.
#include "core/project-manager/rules_logic.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <set>

#include "core/logic/order.hpp"
#include "core/logic/tests/vector_runner.hpp"

using namespace mat;
using nlohmann::json;
using Codes = std::set<std::string>;

namespace {

const json kTags = {
    {"schemaVersion", "1.0.0"},
    {"tags",
     json::array(
         {{{"id", "TANK01.LEVEL"}, {"kind", "external"}, {"type", "FLOAT64"}, {"access", "R"}},
          {{"id", "PUMP01.RUN"}, {"kind", "external"}, {"type", "BOOL"}, {"access", "R"}},
          {{"id", "PUMP01.RUN_CMD"}, {"kind", "external"}, {"type", "BOOL"}, {"access", "RW"}},
          {{"id", "VALVE02.SP"}, {"kind", "external"}, {"type", "FLOAT32"}, {"access", "RW"}},
          {{"id", "MODE.CODE"}, {"kind", "external"}, {"type", "INT16"}, {"access", "RW"}},
          {{"id", "FLOW01"}, {"kind", "external"}, {"type", "FLOAT64"}, {"access", "R"}},
          {{"id", "INT.MODE"}, {"kind", "internal"}, {"type", "BOOL"}, {"access", "RW"}},
          {{"id", "INT.COUNT"}, {"kind", "internal"}, {"type", "INT32"}, {"access", "RW"}},
          {{"id", "INT.NAME"}, {"kind", "internal"}, {"type", "STRING"}, {"access", "RW"}},
          {{"id", "CALC.MODE"},
           {"kind", "calculated"},
           {"type", "BOOL"},
           {"expression", "INT.MODE"}}})}};

const json kWPump = {{"id", "w_pump"},
                     {"tag", "PUMP01.RUN_CMD"},
                     {"allowed", {{"values", {true, false}}}},
                     {"minIntervalMs", 30000},
                     {"maxPerHour", 20}};
const json kWValve = {{"id", "w_valve"},
                      {"tag", "VALVE02.SP"},
                      {"allowed", {{"min", 0}, {"max", 100}}},
                      {"minIntervalMs", 1000},
                      {"maxPerHour", 60}};

json rule(json o = json::object()) {
    json r = {{"id", "r_low"},
              {"when", "TANK01.LEVEL < 20"},
              {"hold", 1000},
              {"onRise", json::array({{{"do", "write"}, {"write", "w_pump"}, {"value", true}}})}};
    for (auto it = o.begin(); it != o.end(); ++it) r[it.key()] = it.value();
    return r;
}

LogicCheck run(json d, LogicCheckOptions o = {}) {
    static const logic::TagInfoMap tags = logicTagsFromList(kTags);
    json doc = {{"schemaVersion", "1.0.0"}};
    for (auto it = d.begin(); it != d.end(); ++it) doc[it.key()] = it.value();
    o.tags = &tags;
    return checkLogic(doc, o);
}
Codes errs(json d, LogicCheckOptions o = {}) {
    Codes c;
    for (const auto& e : run(std::move(d), o).errors) c.insert(e.code);
    return c;
}
Codes warns(json d, LogicCheckOptions o = {}) {
    Codes c;
    for (const auto& e : run(std::move(d), o).warnings) c.insert(e.code);
    return c;
}
json timer(const char* id, json o = json::object()) {
    json t = {{"id", id},
              {"kind", "ton"},
              {"in", "PUMP01.RUN"},
              {"pt", 5000},
              {"q", std::string("LOGIC.") + id}};
    for (auto it = o.begin(); it != o.end(); ++it) t[it.key()] = it.value();
    return t;
}

}  // namespace

TEST(RulesLogic, TheExampleOfContractSection1IsValid) {
    const json d = {
        {"writes", json::array({kWPump})},
        {"rules",
         json::array(
             {rule({{"onFall", json::array()}}),
              rule({{"id", "r_high"},
                    {"when", "TANK01.LEVEL > 80"},
                    {"onRise",
                     json::array({{{"do", "write"}, {"write", "w_pump"}, {"value", false}}})}})})},
        {"timers", json::array({{{"id", "t_start"},
                                 {"kind", "ton"},
                                 {"in", "PUMP01.RUN_CMD"},
                                 {"pt", 5000},
                                 {"q", "LOGIC.T_START.Q"},
                                 {"et", "LOGIC.T_START.ET"}}})},
        {"counters", json::array({{{"id", "c_starts"},
                                   {"up", "PUMP01.RUN"},
                                   {"down", nullptr},
                                   {"reset", "LOGIC.RESET_DAILY.Q"},
                                   {"preset", 1000},
                                   {"value", "LOGIC.C_STARTS.VALUE"},
                                   {"reached", "LOGIC.C_STARTS.REACHED"},
                                   {"retain", true}}})},
        {"totalizers", json::array({{{"id", "z_flow"},
                                     {"source", "FLOW01"},
                                     {"rateUnit", "h"},
                                     {"factor", 1.0},
                                     {"cutoff", 0.05},
                                     {"maxGapMs", 5000},
                                     {"reset", "LOGIC.RESET_DAILY.Q"},
                                     {"total", "LOGIC.FLOW01.TOTAL"},
                                     {"gapSeconds", "LOGIC.FLOW01.GAP_S"}}})},
        {"runhours", json::array({{{"id", "h_pump"},
                                   {"run", "PUMP01.RUN"},
                                   {"reset", nullptr},
                                   {"serviceEveryHours", 500},
                                   {"hours", "LOGIC.PUMP01.HOURS"},
                                   {"starts", "LOGIC.PUMP01.STARTS"},
                                   {"due", "LOGIC.PUMP01.DUE"}}})},
        {"schedules",
         json::array(
             {{{"id", "s_day"},
               {"tzOffsetMin", nullptr},
               {"weekly",
                json::array({{{"days", {1, 2, 3, 4, 5, 6}}, {"from", "06:00"}, {"to", "18:00"}}})},
               {"exceptions", json::array({{{"date", "2026-12-25"}, {"mode", "off"}}})},
               {"out", "LOGIC.DAY.Q"}},
              {{"id", "s_midnight"},
               {"weekly",
                json::array(
                    {{{"days", {1, 2, 3, 4, 5, 6, 7}}, {"from", "00:00"}, {"to", "00:01"}}})},
               {"out", "LOGIC.RESET_DAILY.Q"}}})}};
    const LogicCheck r = run(d);
    EXPECT_TRUE(r.errors.empty()) << r.errors[0].code << " " << r.errors[0].path;
    EXPECT_TRUE(r.warnings.empty());
}

TEST(RulesLogic, LogicTagsAreDeclaredInternalReadOnlyWithTheirTypes) {
    const json d = {
        {"schemaVersion", "1.0.0"},
        {"timers", json::array({timer("t", {{"et", "LOGIC.T.ET"}})})},
        {"counters", json::array({{{"id", "c"},
                                   {"up", "PUMP01.RUN"},
                                   {"preset", 3},
                                   {"value", "LOGIC.C"},
                                   {"reached", "LOGIC.C.R"}}})},
        {"runhours",
         json::array(
             {{{"id", "h"}, {"run", "PUMP01.RUN"}, {"hours", "LOGIC.H"}, {"starts", "LOGIC.t"}}})}};
    const json defs = logicTagDefs(d, logicTagsFromList(kTags));
    ASSERT_EQ(defs.size(), 5u) << defs.dump()
                               << " (LOGIC.t of runhours collides with the timer's q)";
    EXPECT_EQ(defs[0],
              json({{"id", "LOGIC.t"}, {"kind", "internal"}, {"type", "BOOL"}, {"access", "R"}}));
    EXPECT_EQ(defs[1]["type"], "INT64");
    EXPECT_EQ(defs[2]["type"], "INT64");
    EXPECT_EQ(defs[3]["type"], "BOOL");
    EXPECT_EQ(defs[4]["type"], "FLOAT64");
    EXPECT_TRUE(isValidLogicTagId("LOGIC.T_START.Q"));
    EXPECT_FALSE(isValidLogicTagId("LOGIC..Q"));
    EXPECT_FALSE(isValidLogicTagId("true"));
    EXPECT_FALSE(isValidLogicTagId("1A"));
    EXPECT_FALSE(isValidLogicTagId(std::string(65, 'A')));
}

TEST(RulesLogic, Version) {
    // feature 012: the 1.x family is 1.0.x and 1.1.x; 1.2 is newer
    EXPECT_EQ(errs({{"schemaVersion", "1.2.0"}, {"rules", json::array({rule({{"id", "BAD"}})})}}),
              Codes{"E_LOGIC_VERSION"});
    EXPECT_EQ(errs({{"schemaVersion", "1.0.7"}}), Codes{});
    EXPECT_EQ(errs({{"schemaVersion", "1.1.0"}}), Codes{});
}

TEST(RulesLogic, Limits) {
    json many = json::array();
    for (int i = 0; i < 101; ++i) many.push_back(timer(("t" + std::to_string(i)).c_str()));
    EXPECT_EQ(errs({{"timers", many}}), Codes{"E_LOGIC_LIMIT"});
    many.erase(many.begin());
    EXPECT_EQ(errs({{"timers", many}}), Codes{});
    json acts = json::array();
    for (int i = 0; i < 9; ++i)
        acts.push_back({{"do", "setTag"}, {"tag", "INT.COUNT"}, {"value", i}});
    EXPECT_EQ(errs({{"rules", json::array({rule({{"onRise", acts}})})}}), Codes{"E_LOGIC_LIMIT"});
    LogicCheckOptions big;
    big.bytes = 512 * 1024 + 1;
    EXPECT_EQ(errs(json::object(), big), Codes{"E_LOGIC_LIMIT"});
    big.bytes = 512 * 1024;
    EXPECT_EQ(errs(json::object(), big), Codes{});
    EXPECT_EQ(errs({{"writes", json::array({kWPump})},
                    {"rules", json::array({rule({{"hold", 86400001}})})}}),
              Codes{"E_LOGIC_LIMIT"});
    EXPECT_EQ(errs({{"writes", json::array({kWPump})},
                    {"rules", json::array({rule({{"repeatMs", 9999}})})}}),
              Codes{"E_LOGIC_LIMIT"});
    json w = kWPump;
    w["minIntervalMs"] = 999;
    EXPECT_EQ(errs({{"writes", json::array({w})}}), Codes{"E_LOGIC_LIMIT"});
    w = kWPump;
    w.erase("maxPerHour");
    EXPECT_EQ(errs({{"writes", json::array({w})}}), Codes{"E_LOGIC_LIMIT"});
    // T062: upper bounds (a day, one a second)
    w = kWPump;
    w["minIntervalMs"] = 86400000;
    w["maxPerHour"] = 3600;
    EXPECT_EQ(errs({{"writes", json::array({w})}}), Codes{});
    w["minIntervalMs"] = 86400001;
    EXPECT_EQ(errs({{"writes", json::array({w})}}), Codes{"E_LOGIC_LIMIT"});
    w["minIntervalMs"] = 1e300;
    EXPECT_EQ(errs({{"writes", json::array({w})}}), Codes{"E_LOGIC_LIMIT"});
    w["minIntervalMs"] = 1000;
    w["maxPerHour"] = 3601;
    EXPECT_EQ(errs({{"writes", json::array({w})}}), Codes{"E_LOGIC_LIMIT"});
}

TEST(RulesLogic, ADocumentOverTheLimitsIsNotLookedAtFurther) {
    // T062: 10^5 timers chained one into the next: E_LOGIC_LIMIT at once, no graph, no other code
    json many = json::array();
    for (int i = 0; i < 100000; ++i)
        many.push_back(
            timer(("t" + std::to_string(i)).c_str(),
                  {{"in", i == 0 ? std::string("PUMP01.RUN") : "LOGIC.t" + std::to_string(i - 1)},
                   {"pt", -1}}));
    const auto t0 = std::chrono::steady_clock::now();
    const LogicCheck c = run({{"timers", many}});
    const auto ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count();
    ASSERT_EQ(c.errors.size(), 1u);
    EXPECT_EQ(c.errors[0].code, "E_LOGIC_LIMIT");
    EXPECT_EQ(c.errors[0].path, "/timers");
    EXPECT_LT(ms, 2000);
}

TEST(RulesLogic, TheOrderOfALongChainNeedsNoDeepStack) {
    // T062: the graph itself (the engine and the validator below the limits): iterative, no
    // recursion as deep as the chain, no O(n^2) queue
    json doc = {{"schemaVersion", "1.0.0"}, {"timers", json::array()}};
    const int n = 200000;
    for (int i = 0; i < n; ++i)
        doc["timers"].push_back(timer(("t" + std::to_string(i)).c_str(),
                                      {{"in", "LOGIC.t" + std::to_string((i + 1) % n)}}));
    logic::LogicEnv env;
    env.tagType = [](const std::string&) -> std::optional<TagType> { return TagType::BOOL; };
    env.hasTable = [](const std::string&) { return false; };
    std::map<std::string, logic::LogicOutput> outs;
    for (const logic::LogicOutput& o : logic::logicOutputs(doc)) outs.emplace(o.tag, o);
    const auto t0 = std::chrono::steady_clock::now();
    const logic::LogicGraph g = logic::logicGraph(doc, env, outs);
    const auto ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count();
    ASSERT_EQ(g.cycles.size(), 1u) << "one ring of every timer";
    EXPECT_EQ(g.cycles[0].size(), static_cast<size_t>(n));
    EXPECT_TRUE(g.order.empty());
    EXPECT_LT(ms, 20000);

    // the same chain without the ring: every block in order, readers after what they read
    doc["timers"][n - 1]["in"] = "PUMP01.RUN";
    outs.clear();
    for (const logic::LogicOutput& o : logic::logicOutputs(doc)) outs.emplace(o.tag, o);
    const logic::LogicGraph h = logic::logicGraph(doc, env, outs);
    EXPECT_TRUE(h.cycles.empty());
    ASSERT_EQ(h.order.size(), static_cast<size_t>(n));
    EXPECT_EQ(h.order.front(), "t" + std::to_string(n - 1));
    EXPECT_EQ(h.order.back(), "t0");
}

TEST(RulesLogic, IdsShareOneSpace) {
    EXPECT_EQ(errs({{"writes", json::array({kWPump})}, {"timers", json::array({timer("w_pump")})}}),
              Codes{"E_LOGIC_ID"});
    EXPECT_EQ(errs({{"timers", json::array({timer("Bad")})}}), Codes{"E_LOGIC_ID"});
    EXPECT_EQ(errs({{"timers", json::array({timer("t", {{"q", "LOGIC..Q"}})})}}),
              Codes{"E_LOGIC_ID"});
}

TEST(RulesLogic, TagRefTypeExpr) {
    EXPECT_EQ(errs({{"timers", json::array({timer("t", {{"in", "NOPE"}})})}}),
              Codes{"E_LOGIC_TAG_REF"});
    EXPECT_EQ(errs({{"timers", json::array({timer("t", {{"in", "TANK01.LEVEL + 1"}})})}}),
              Codes{"E_LOGIC_TYPE"});
    EXPECT_EQ(errs({{"timers", json::array({timer("t", {{"in", "PUMP01.RUN &&"}})})}}),
              Codes{"E_LOGIC_EXPR"});
    EXPECT_EQ(errs({{"rules", json::array({{{"id", "r"},
                                            {"when", "PUMP01.RUN"},
                                            {"onRise", json::array({{{"do", "setTag"},
                                                                     {"tag", "INT.COUNT"},
                                                                     {"value", "x"}}})}}})}}),
              Codes{"E_LOGIC_TYPE"});
    EXPECT_EQ(errs({{"rules", json::array({{{"id", "r"},
                                            {"when", "PUMP01.RUN"},
                                            {"onRise", json::array({{{"do", "toggle"},
                                                                     {"tag", "INT.COUNT"}}})}}})}}),
              Codes{"E_LOGIC_TYPE"});
}

TEST(RulesLogic, TagCollision) {
    EXPECT_EQ(errs({{"timers", json::array({timer("t", {{"q", "FLOW01"}})})}}),
              Codes{"E_LOGIC_TAG_COLLISION"});
    EXPECT_EQ(errs({{"timers", json::array({timer("a", {{"q", "LOGIC.X"}}),
                                            timer("b", {{"q", "LOGIC.X"}})})}}),
              Codes{"E_LOGIC_TAG_COLLISION"});
}

TEST(RulesLogic, CycleAndSelfTrigger) {
    EXPECT_EQ(errs({{"timers", json::array({timer("a", {{"in", "LOGIC.b"}}),
                                            timer("b", {{"in", "LOGIC.a"}})})}}),
              Codes{"E_LOGIC_CYCLE"});
    EXPECT_EQ(errs({{"timers", json::array({timer("a", {{"in", "LOGIC.a"}})})}}),
              Codes{"E_LOGIC_CYCLE"});
    // directly, through a block, through a calculated Tag
    const json set = json::array({{{"do", "setTag"}, {"tag", "INT.MODE"}, {"value", true}}});
    EXPECT_EQ(
        errs({{"rules", json::array({{{"id", "r"}, {"when", "!INT.MODE"}, {"onRise", set}}})}}),
        Codes{"E_LOGIC_SELF_TRIGGER"});
    EXPECT_EQ(errs({{"rules", json::array({{{"id", "r"}, {"when", "!LOGIC.t"}, {"onRise", set}}})},
                    {"timers", json::array({timer("t", {{"in", "INT.MODE"}})})}}),
              Codes{"E_LOGIC_SELF_TRIGGER"});
    EXPECT_EQ(
        errs({{"rules", json::array({{{"id", "r"}, {"when", "!CALC.MODE"}, {"onRise", set}}})}}),
        Codes{"E_LOGIC_SELF_TRIGGER"});
    // set by another rule: not a self trigger
    EXPECT_EQ(errs({{"rules",
                     json::array({{{"id", "a"}, {"when", "!INT.MODE"}, {"onRise", json::array()}},
                                  {{"id", "b"}, {"when", "PUMP01.RUN"}, {"onRise", set}}})}}),
              Codes{});
}

TEST(RulesLogic, Writes) {
    const json r =
        rule({{"onRise", json::array({{{"do", "write"}, {"write", "w_nope"}, {"value", true}}})}});
    EXPECT_EQ(errs({{"writes", json::array({kWPump})}, {"rules", json::array({r})}}),
              Codes{"E_LOGIC_WRITE_UNDECLARED"});
    json w = kWPump;
    w["tag"] = "PUMP01.RUN";
    EXPECT_EQ(errs({{"writes", json::array({w})}}), Codes{"E_LOGIC_WRITE_TARGET"});
    w["tag"] = "INT.MODE";
    EXPECT_EQ(errs({{"writes", json::array({w})}}), Codes{"E_LOGIC_WRITE_TARGET"});
    w["tag"] = "LOGIC.t";
    EXPECT_EQ(errs({{"writes", json::array({w})}, {"timers", json::array({timer("t")})}}),
              Codes{"E_LOGIC_WRITE_TARGET"});
    w["tag"] = "NOPE";
    EXPECT_EQ(errs({{"writes", json::array({w})}}), Codes{"E_LOGIC_TAG_REF"});
    w = kWPump;
    w["allowed"] = {{"values", {1, 0}}};
    EXPECT_EQ(errs({{"writes", json::array({w})}}), Codes{"E_LOGIC_WRITE_VALUE"});
    w["allowed"] = {{"min", 0}, {"max", 1}};
    EXPECT_EQ(errs({{"writes", json::array({w})}}), Codes{"E_LOGIC_WRITE_VALUE"});
    json v = kWValve;
    v["allowed"] = {{"min", 10}, {"max", 1}};
    EXPECT_EQ(errs({{"writes", json::array({v})}}), Codes{"E_LOGIC_WRITE_VALUE"});
    const json out =
        rule({{"onRise", json::array({{{"do", "write"}, {"write", "w_valve"}, {"value", 150}}})}});
    EXPECT_EQ(errs({{"writes", json::array({kWValve})}, {"rules", json::array({out})}}),
              Codes{"E_LOGIC_WRITE_VALUE"});
    const json in =
        rule({{"onRise", json::array({{{"do", "write"}, {"write", "w_valve"}, {"value", 50}}})}});
    EXPECT_EQ(errs({{"writes", json::array({kWValve})}, {"rules", json::array({in})}}), Codes{});
    json code = {{"id", "w_code"},
                 {"tag", "MODE.CODE"},
                 {"allowed", {{"values", {1, 2, 40000}}}},
                 {"minIntervalMs", 1000},
                 {"maxPerHour", 1}};
    EXPECT_EQ(errs({{"writes", json::array({code})}}), Codes{"E_LOGIC_WRITE_VALUE"})
        << "40000 > INT16";
}

TEST(RulesLogic, Actions) {
    const auto with = [](json a) {
        return json{{"writes", json::array({kWPump})},
                    {"rules", json::array({rule({{"onRise", json::array({a})}})})}};
    };
    EXPECT_EQ(errs(with({{"do", "beep"}})), Codes{"E_LOGIC_ACTION"});
    EXPECT_EQ(errs(with({{"do", "write"}, {"write", "w_pump"}})), Codes{"E_LOGIC_ACTION"});
    EXPECT_EQ(errs(with({{"do", "toggle"}, {"tag", "INT.MODE"}, {"value", true}})),
              Codes{"E_LOGIC_ACTION"});
    EXPECT_EQ(errs(with({{"do", "pulse"}, {"write", "w_pump"}, {"value", true}, {"ms", 50}})),
              Codes{"E_LOGIC_ACTION"});
    EXPECT_EQ(errs(with({{"do", "pulse"}, {"write", "w_pump"}, {"value", true}, {"ms", 500}})),
              Codes{});
    EXPECT_EQ(errs(with({{"do", "setTag"}, {"tag", "PUMP01.RUN_CMD"}, {"value", true}})),
              Codes{"E_LOGIC_ACTION"});
    EXPECT_EQ(errs(with({{"do", "setTag"}, {"tag", "NOPE"}, {"value", true}})),
              Codes{"E_LOGIC_TAG_REF"});
    EXPECT_EQ(errs(with({{"do", "setTag"}, {"tag", "INT.NAME"}, {"value", "ok"}})), Codes{});
    EXPECT_EQ(
        errs(with(
            {{"do", "setTag"}, {"tag", "INT.COUNT"}, {"value", {{"expr", "TANK01.LEVEL * 2"}}}})),
        Codes{});
}

TEST(RulesLogic, BlockParameters) {
    EXPECT_EQ(errs({{"timers", json::array({timer("t", {{"kind", "tx"}})})}}),
              Codes{"E_LOGIC_TIMER"});
    EXPECT_EQ(errs({{"timers", json::array({timer("t", {{"pt", 0}})})}}), Codes{"E_LOGIC_TIMER"});
    EXPECT_EQ(errs({{"timers", json::array({timer("t", {{"pt", 1.5}})})}}), Codes{"E_LOGIC_TIMER"});
    const json c = {{"id", "c"}, {"up", "PUMP01.RUN"}, {"value", "LOGIC.C"}};
    json c0 = c;
    c0["preset"] = 0;
    EXPECT_EQ(errs({{"counters", json::array({c0})}}), Codes{"E_LOGIC_COUNTER"});
    json cr = c;
    cr["reached"] = "LOGIC.R";
    EXPECT_EQ(errs({{"counters", json::array({cr})}}), Codes{"E_LOGIC_COUNTER"});
    const json z = {{"id", "z"}, {"source", "FLOW01"}, {"rateUnit", "h"}, {"total", "LOGIC.Z"}};
    for (const auto& [k, v] : std::vector<std::pair<std::string, json>>{{"rateUnit", "w"},
                                                                        {"factor", 0},
                                                                        {"cutoff", -1},
                                                                        {"maxGapMs", 0},
                                                                        {"rolloverAt", 0}}) {
        json b = z;
        b[k] = v;
        EXPECT_EQ(errs({{"totalizers", json::array({b})}}), Codes{"E_LOGIC_TOTALIZER"}) << k;
    }
    EXPECT_EQ(errs({{"totalizers", json::array({z})}}), Codes{});
    const json s = {{"id", "s"},
                    {"weekly", json::array({{{"days", {1}}, {"from", "06:00"}, {"to", "18:00"}}})},
                    {"out", "LOGIC.S"}};
    const auto sched = [&](const char* k, json v, bool window = false) {
        json b = s;
        if (window)
            b["weekly"][0][k] = std::move(v);
        else
            b[k] = std::move(v);
        return errs({{"schedules", json::array({b})}});
    };
    EXPECT_EQ(sched("tzOffsetMin", 900), Codes{"E_LOGIC_SCHEDULE"});
    EXPECT_EQ(sched("days", json::array(), true), Codes{"E_LOGIC_SCHEDULE"});
    EXPECT_EQ(sched("days", {1, 1}, true), Codes{"E_LOGIC_SCHEDULE"});
    EXPECT_EQ(sched("days", {8}, true), Codes{"E_LOGIC_SCHEDULE"});
    EXPECT_EQ(sched("from", "24:00", true), Codes{"E_LOGIC_SCHEDULE"});
    EXPECT_EQ(sched("to", "06:00", true), Codes{"E_LOGIC_SCHEDULE"});
    EXPECT_EQ(sched("exceptions", json::array({{{"date", "2026-02-29"}, {"mode", "off"}}})),
              Codes{"E_LOGIC_SCHEDULE"});
    EXPECT_EQ(sched("exceptions", json::array({{{"date", "2028-02-29"}, {"mode", "off"}},
                                               {{"date", "2028-02-29"}, {"mode", "on"}}})),
              Codes{"E_LOGIC_SCHEDULE"});
    EXPECT_EQ(sched("exceptions", json::array({{{"date", "2028-02-29"}, {"mode", "x"}}})),
              Codes{"E_LOGIC_SCHEDULE"});
    EXPECT_EQ(sched("exceptions", json::array({{{"date", "2028-02-29"}, {"mode", "on"}}})),
              Codes{});
    const json h = {
        {"id", "h"}, {"run", "PUMP01.RUN"}, {"hours", "LOGIC.H"}, {"serviceEveryHours", 0}};
    EXPECT_EQ(errs({{"runhours", json::array({h})}}), Codes{"E_LOGIC_LIMIT"});
}

TEST(RulesLogic, Warnings) {
    EXPECT_EQ(warns({{"timers", json::array({timer("t", {{"pt", 50}})})}}),
              Codes{"W_LOGIC_PT_ROUNDED"});
    EXPECT_EQ(warns({{"writes", json::array({kWPump})},
                     {"rules", json::array({rule({{"enabled", false}})})}}),
              Codes{"W_LOGIC_DISABLED"});
    EXPECT_EQ(
        warns({{"writes", json::array({kWPump})}, {"rules", json::array({rule({{"hold", 0}})})}}),
        Codes{"W_LOGIC_NO_HOLD"});
    EXPECT_EQ(warns({{"writes", json::array({kWPump})}, {"rules", json::array({rule()})}}),
              Codes{});
    const json a = rule({{"id", "a"}, {"when", "TANK01.LEVEL<20"}});
    const json b =
        rule({{"id", "b"},
              {"onRise", json::array({{{"do", "write"}, {"write", "w_pump"}, {"value", false}}})}});
    EXPECT_EQ(warns({{"writes", json::array({kWPump})}, {"rules", json::array({a, b})}}),
              Codes{"W_LOGIC_WRITE_CONFLICT"});
    LogicCheckOptions off;
    off.deviceWrites = "off";
    EXPECT_EQ(warns({{"writes", json::array({kWPump})}}, off), Codes{"W_LOGIC_WRITES_OFF"});
    off.deviceWrites = "on";
    EXPECT_EQ(warns({{"writes", json::array({kWPump})}}, off), Codes{});
    json rules = json::array();
    for (int i = 0; i < 200; ++i)
        rules.push_back({{"id", "r" + std::to_string(i)}, {"when", "PUMP01.RUN"}});
    LogicCheckOptions fast;
    fast.flushS = 10;
    EXPECT_EQ(warns({{"rules", rules}}, fast), Codes{}) << "(200*24+4608)*8640 = 81 MiB";
    fast.flushS = 1;
    EXPECT_EQ(warns({{"rules", rules}}, fast), Codes{"W_LOGIC_RETAIN_IO"});
}

TEST(RulesLogic, StaticGroupOfTheSharedVectorsSameAsTypeScript) {
    size_t n = 0;
    for (const auto& [group, c] :
         mat::logic::test::loadVectors(std::string(MAT_SOURCE_DIR) + "/tests/logic-vectors")) {
        if (group != "static") continue;
        ++n;
        const auto problems = mat::logic::test::runCase(c);
        EXPECT_TRUE(problems.empty()) << c["id"] << ": " << (problems.empty() ? "" : problems[0]);
    }
    EXPECT_GE(n, 30u);
}
