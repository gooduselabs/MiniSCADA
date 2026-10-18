// The scan skips what cannot change (T148, the CPU of the BL335; contracts/logic-engine.md §10): a
// block whose step inputs did not change and whose state does not move with time (a timer not
// running, a rule without a pending candidate or repeat, a counter, run hours not running) is not
// stepped. Every case runs two engines on the same inputs: the reference steps every block at every
// scan (EngineOptions::scanEveryBlock), the other skips; after each scan both give the same
// actions, logic Tag values, block states, changed Tags (takeChanged) and retained values. The
// targeted cases are the ones where a skip would be wrong: a timer expiring, a hold expiring or a
// repeat with unchanged inputs, a schedule at a minute boundary or losing its clock, counter edges,
// run hours running, a reset by the API, a restart from retain, and a chain through logic Tags in
// one scan; the last case is random inputs, times and clocks on a document of every kind.
#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <map>
#include <random>

#include "core/logic/engine.hpp"
#include "core/logic/tests/test_util.hpp"

using namespace mat;
using namespace mat::logic;
using namespace mat::logic::test;

namespace {

json actionJson(const ActionOut& a) {
    return {{"t", a.t},
            {"rule", a.rule},
            {"edgeId", a.edgeId},
            {"edge", a.edge},
            {"index", a.index},
            {"do", a.doName},
            {"tag", a.tag},
            {"write", a.write},
            {"value", a.hasValue ? scalarJson(a.value) : json("none")},
            {"ms", a.ms},
            {"result", a.result}};
}

json stateJson(const BlockState& s) {
    return {{"kind", s.kind},
            {"state", s.state},
            {"reason", s.reason},
            {"stable", s.stable ? json(*s.stable) : json()},
            {"edgeId", s.edgeId},
            {"lastError", s.lastError ? json(*s.lastError) : json()},
            {"lastFired", s.lastFiredMono ? json(*s.lastFiredMono) : json()},
            {"fired", s.fired},
            {"degraded", s.degraded},
            {"overflow", s.overflow}};
}

json outputJson(const Output& o) {
    json v = scalarJson(o.value);
    // a NaN or an infinity has no JSON form: compare its text
    if (const double* d = std::get_if<double>(&o.value); d && !std::isfinite(*d))
        v = std::to_string(*d);
    return {v, o.good, o.reason};
}

// Two engines on one Tag store: `ref` steps every block every scan, `opt` skips.
class Twin {
   public:
    Twin(const json& doc, TagInfoMap tags, Config cfg = {}, const RetainMap* retain = nullptr)
        : doc_(doc), tags_(std::move(tags)), cfg_(cfg) {
        build(retain);
    }

    void set(const std::string& tag, TagScalar v) {
        expr::InputValue iv;
        iv.value = std::move(v);
        iv.quality = Quality::GOOD;
        store_[tag] = std::move(iv);
    }
    void setBad(const std::string& tag) {
        expr::InputValue iv;
        iv.quality = Quality::BAD;
        iv.reason = "COMM";
        store_[tag] = iv;
    }
    void wall(std::optional<int64_t> epochMs, bool synced) {
        wall_.epochMs = epochMs;
        wall_.synced = synced;
    }

    // One scan of both at `now`; the reference's actions (setTag/toggle applied to the store).
    std::vector<ActionOut> scan(int64_t now) {
        const ReadTag read = [this](const std::string& id) {
            const auto it = store_.find(id);
            if (it != store_.end()) return it->second;
            expr::InputValue v;
            v.quality = Quality::BAD;
            v.reason = "NO_VALUE";
            return v;
        };
        const std::vector<ActionOut> a = ref_->step(now, read, wall_);
        const std::vector<ActionOut> b = opt_->step(now, read, wall_);
        compare(a, b, now);
        for (const ActionOut& x : a)
            if ((x.doName == "setTag" || x.doName == "toggle") && x.result == "OK" && x.hasValue)
                set(x.tag, x.value);
        ++scans_;
        return a;
    }
    // Scans every `step` ms in (from, to].
    void run(int64_t from, int64_t to, int64_t step) {
        for (int64_t t = from + step; t <= to; t += step) scan(t);
    }

    bool reset(const std::string& id, double value) {
        const bool a = ref_->reset(id, value);
        const bool b = opt_->reset(id, value);
        EXPECT_EQ(a, b) << id;
        return a;
    }
    void writeResult(const std::string& rule, const std::string& result) {
        ref_->writeResult(rule, result);
        opt_->writeResult(rule, result);
    }
    void setWritesOn(bool on) {
        ref_->setWritesOn(on);
        opt_->setWritesOn(on);
    }
    // A restart of both from the retained values of the reference (the Tag store kept).
    void restart() {
        const RetainMap r = ref_->retainSnapshot();
        build(&r);
    }

    json out(const std::string& tag) const {
        const Output* o = opt_->output(tag);
        return o ? scalarJson(o->value) : json("none");
    }
    BlockState state(const std::string& id) const { return *opt_->state(id); }
    int scans() const { return scans_; }

   private:
    void build(const RetainMap* retain) {
        EngineOptions o;
        o.tags = tags_;
        o.config = cfg_;
        o.retain = retain;
        o.scanEveryBlock = true;
        ref_ = std::make_unique<Engine>(doc_, o);
        o.scanEveryBlock = false;
        opt_ = std::make_unique<Engine>(doc_, o);
        compare({}, {}, 0);
    }

    static std::map<std::string, json> changed(Engine& e) {
        std::map<std::string, json> out;
        e.takeChanged([&](size_t, const std::string& tag, const Output& o) {
            EXPECT_FALSE(out.count(tag)) << tag << " twice";
            out[tag] = outputJson(o);
        });
        return out;
    }

    void compare(const std::vector<ActionOut>& a, const std::vector<ActionOut>& b, int64_t now) {
        const std::string at = "scan " + std::to_string(scans_) + " at " + std::to_string(now);
        ASSERT_EQ(a.size(), b.size()) << at;
        for (size_t i = 0; i < a.size(); ++i) ASSERT_EQ(actionJson(a[i]), actionJson(b[i])) << at;
        for (const auto& [tag, def] : ref_->outputTags()) {
            const Output* x = ref_->output(tag);
            const Output* y = opt_->output(tag);
            ASSERT_EQ(x == nullptr, y == nullptr) << at << " " << tag;
            if (x) ASSERT_EQ(outputJson(*x), outputJson(*y)) << at << " " << tag;
        }
        ASSERT_EQ(ref_->blockIds(), opt_->blockIds());
        for (const std::string& id : ref_->blockIds())
            ASSERT_EQ(stateJson(*ref_->state(id)), stateJson(*opt_->state(id))) << at << " " << id;
        ASSERT_EQ(ref_->throttledRules(now), opt_->throttledRules(now)) << at;
        ASSERT_EQ(ref_->writesLastMinute(now), opt_->writesLastMinute(now)) << at;
        ASSERT_EQ(json(ref_->retainSnapshot()), json(opt_->retainSnapshot())) << at;
        ASSERT_EQ(changed(*ref_), changed(*opt_)) << at;
    }

    json doc_;
    TagInfoMap tags_;
    Config cfg_;
    std::unique_ptr<Engine> ref_, opt_;
    std::map<std::string, expr::InputValue> store_;
    WallClock wall_{std::nullopt, false};
    int scans_ = 0;
};

json doc(std::initializer_list<std::pair<const char*, json>> parts) {
    json d = {{"schemaVersion", "1.0.0"}};
    for (const auto& [k, v] : parts) d[k] = v;
    return d;
}

TagInfoMap boolTags(std::initializer_list<const char*> ids) {
    TagInfoMap m;
    for (const char* id : ids) m[id] = tagInfo(TagType::BOOL, "internal", true);
    return m;
}

// 2026-10-12 (a Monday) 05:58:30 at +07:00, in UTC ms
constexpr int64_t kMonday0558 = 1791759510000;

}  // namespace

TEST(ScanSkip, TimersExpireWithUnchangedInputs) {
    json timers = json::array();
    for (const char* k : {"ton", "tof", "tp"})
        timers.push_back({{"id", std::string("t_") + k},
                          {"kind", k},
                          {"in", "IN"},
                          {"pt", 1000},
                          {"q", std::string("L.") + k + ".Q"},
                          {"et", std::string("L.") + k + ".ET"}});
    Twin t(doc({{"timers", timers}}), boolTags({"IN"}));
    t.set("IN", false);
    t.run(0, 500, 100);
    t.set("IN", true);  // ton and tp start; the input then never changes
    t.run(500, 1400, 100);
    EXPECT_EQ(t.out("L.ton.Q"), false);
    EXPECT_EQ(t.out("L.tp.Q"), true);
    t.run(1400, 3000, 100);
    EXPECT_EQ(t.out("L.ton.Q"), true);
    EXPECT_EQ(t.out("L.ton.ET"), 1000);
    EXPECT_EQ(t.out("L.tp.Q"), false);
    t.set("IN", false);  // tof starts
    t.run(3000, 3500, 100);
    EXPECT_EQ(t.out("L.tof.Q"), true);
    t.run(3500, 5000, 100);
    EXPECT_EQ(t.out("L.tof.Q"), false);
    EXPECT_EQ(t.out("L.tof.ET"), 1000);
    t.setBad("IN");  // unknown: degraded, outputs held; then the same value again
    t.run(5000, 5500, 100);
    EXPECT_TRUE(t.state("t_ton").degraded);
    t.set("IN", true);
    t.run(5500, 8000, 250);
    EXPECT_EQ(t.out("L.ton.Q"), true);
}

TEST(ScanSkip, HoldAndRepeatWithUnchangedInputs) {
    const json rules = json::array(
        {{{"id", "hold"},
          {"when", "A"},
          {"hold", 700},
          {"onRise", json::array({{{"do", "setTag"}, {"tag", "H"}, {"value", true}}})},
          {"onFall", json::array({{{"do", "setTag"}, {"tag", "H"}, {"value", false}}})}},
         {{"id", "rep"},
          {"when", "A"},
          {"repeatMs", 300},
          {"onRise", json::array({{{"do", "toggle"}, {"tag", "R"}}})}},
         {{"id", "start"},
          {"when", "A"},
          {"fireOnStart", true},
          {"repeatMs", 1000},
          {"onRise", json::array({{{"do", "setTag"}, {"tag", "S"}, {"value", true}}})}}});
    Twin t(doc({{"rules", rules}}), boolTags({"A", "H", "R", "S"}));
    t.set("A", true);
    t.set("R", false);
    t.run(0, 3000, 100);
    t.set("A", false);
    t.run(3000, 3300, 100);
    t.set("A", true);  // back before the hold: the candidate dropped, then again
    t.run(3300, 6000, 100);
    t.setBad("A");
    t.run(6000, 6500, 100);
    EXPECT_EQ(t.state("hold").state, "SUSPENDED");
    t.set("A", true);
    t.run(6500, 9000, 100);
    EXPECT_GE(t.state("rep").fired, 10);
    EXPECT_GE(t.state("start").fired, 5);
}

TEST(ScanSkip, ScheduleAtMinuteBoundaryAndClockLoss) {
    const json schedules = json::array(
        {{{"id", "s"},
          {"weekly",
           json::array({{{"days", {1, 2, 3, 4, 5}}, {"from", "06:00"}, {"to", "06:01"}}})},
          {"out", "L.S"}}});
    const json rules = json::array(
        {{{"id", "r"},
          {"when", "L.S"},
          {"onRise", json::array({{{"do", "setTag"}, {"tag", "X"}, {"value", true}}})},
          {"onFall", json::array({{{"do", "setTag"}, {"tag", "X"}, {"value", false}}})}}});
    Twin t(doc({{"schedules", schedules}, {"rules", rules}}), boolTags({"X"}));
    t.scan(0);  // no clock yet
    EXPECT_EQ(t.state("r").state, "SUSPENDED");
    for (int64_t ms = 100; ms <= 200000; ms += 100) {
        t.wall(kMonday0558 + ms, ms < 150000 || ms > 150500);
        t.scan(ms);
        if (ms == 100000) EXPECT_EQ(t.out("L.S"), true);
    }
    EXPECT_EQ(t.out("L.S"), false);
    EXPECT_EQ(t.state("r").edgeId, 2);
}

TEST(ScanSkip, CounterEdgesAndApiReset) {
    const json counters = json::array({{{"id", "c"},
                                        {"up", "UP"},
                                        {"down", "DN"},
                                        {"reset", "RST"},
                                        {"preset", 3},
                                        {"value", "L.V"},
                                        {"reached", "L.R"}}});
    Twin t(doc({{"counters", counters}}), boolTags({"UP", "DN", "RST"}));
    t.set("UP", false);
    t.set("DN", false);
    t.set("RST", false);
    int64_t now = 0;
    for (int i = 0; i < 10; ++i) {
        t.set("UP", i % 2 == 1);
        t.scan(now += 100);
        t.scan(now += 100);  // the same value: no edge
    }
    EXPECT_EQ(t.out("L.V"), 5);
    EXPECT_EQ(t.out("L.R"), true);
    t.setBad("UP");
    t.scan(now += 100);
    t.set("UP", true);  // unknown between false and true: no edge (the mark moves on valid only)
    t.scan(now += 100);
    t.set("DN", true);
    t.scan(now += 100);
    EXPECT_EQ(t.out("L.V"), 4);
    EXPECT_TRUE(t.reset("c", 0));
    t.scan(now += 100);
    EXPECT_EQ(t.out("L.V"), 0);
    t.set("RST", true);
    t.scan(now += 100);
    t.restart();  // from retain: the edge marks start again
    t.scan(now += 100);
    t.set("UP", false);
    t.scan(now += 100);
    t.set("UP", true);
    t.scan(now += 100);
    EXPECT_EQ(t.out("L.V"), 1);
}

TEST(ScanSkip, RunhoursAndTotalizerWithUnchangedInputsAndRetain) {
    const json runhours = json::array({{{"id", "h"},
                                        {"run", "RUN"},
                                        {"reset", "RST"},
                                        {"hours", "L.H"},
                                        {"starts", "L.N"},
                                        {"due", "L.D"},
                                        {"serviceEveryHours", 0.0005}}});
    const json totalizers = json::array({{{"id", "z"},
                                          {"source", "FLOW"},
                                          {"rateUnit", "s"},
                                          {"maxGapMs", 450},
                                          {"total", "L.Z"},
                                          {"gapSeconds", "L.G"}}});
    TagInfoMap tags = boolTags({"RUN", "RST"});
    tags["FLOW"] = tagInfo(TagType::FLOAT64);
    Twin t(doc({{"runhours", runhours}, {"totalizers", totalizers}}), tags);
    t.set("RUN", false);
    t.set("RST", false);
    t.set("FLOW", 2.5);
    t.run(0, 1000, 100);
    t.set("RUN", true);
    t.run(1000, 4000, 100);
    EXPECT_EQ(t.out("L.H"), 2900.0 / 3600000);  // the first scan with RUN true only marks
    EXPECT_EQ(t.out("L.D"), true);
    t.run(4000, 6000, 500);  // gaps over maxGapMs
    t.restart();
    t.run(6000, 8000, 100);
    t.set("RUN", false);
    t.run(8000, 9000, 100);
    EXPECT_TRUE(t.reset("h", 0));
    EXPECT_TRUE(t.reset("z", 7));
    t.run(9000, 10000, 100);
    t.set("RUN", true);
    t.set("RST", true);
    t.run(10000, 11000, 100);
    EXPECT_EQ(t.out("L.N"), 1);  // reset by the API cleared the starts
}

TEST(ScanSkip, ChainThroughLogicTagsInOneScan) {
    // rule -> internal Tag (next scan) -> timer Q -> counter -> rule on the counter value, and a
    // rule reading a schedule and a timer output
    const json d =
        doc({{"rules",
              json::array(
                  {{{"id", "a"},
                    {"when", "IN"},
                    {"onRise", json::array({{{"do", "setTag"}, {"tag", "M"}, {"value", true}}})},
                    {"onFall", json::array({{{"do", "setTag"}, {"tag", "M"}, {"value", false}}})}},
                   {{"id", "b"},
                    {"when", "L.C >= 2 && L.Q"},
                    {"onRise", json::array({{{"do", "toggle"}, {"tag", "IN"}}})}}})},
             {"timers",
              json::array({{{"id", "t"}, {"kind", "tp"}, {"in", "M"}, {"pt", 300}, {"q", "L.Q"}}})},
             {"counters", json::array({{{"id", "c"}, {"up", "L.Q"}, {"value", "L.C"}}})}});
    Twin t(d, boolTags({"IN", "M"}));
    t.set("IN", false);
    t.set("M", false);
    int64_t now = 0;
    for (int i = 0; i < 200; ++i) {
        if (i % 7 == 0) t.set("IN", (i / 7) % 2 == 0);
        t.scan(now += 100);
    }
    EXPECT_GE(t.state("b").fired, 1);
}

TEST(ScanSkip, RandomInputsTimesAndClocksOnEveryKind) {
    // every kind, chained through logic Tags (forward only), over a few input Tags
    const std::vector<std::string> bools = {"B1", "B2", "B3"};
    const std::vector<std::string> nums = {"N1", "N2"};
    json rules = json::array(), timers = json::array(), counters = json::array(),
         totalizers = json::array(), runhours = json::array(), schedules = json::array(),
         writes = json::array();
    writes.push_back({{"id", "w"},
                      {"tag", "W"},
                      {"allowed", {{"min", 0}, {"max", 50}}},
                      {"minIntervalMs", 300},
                      {"maxPerHour", 40}});
    schedules.push_back(
        {{"id", "s1"},
         {"weekly",
          json::array({{{"days", {1, 2, 3, 4, 5, 6, 7}}, {"from", "06:00"}, {"to", "06:02"}},
                       {{"days", {1}}, {"from", "06:03"}, {"to", "06:00"}}})},
         {"exceptions", json::array({{{"date", "2026-10-13"}, {"mode", "on"}}})},
         {"out", "L.S1"}});
    const char* kinds[] = {"ton", "tof", "tp"};
    for (int k = 0; k < 6; ++k) {
        const std::string b = bools[k % 3], n = nums[k % 2], id = std::to_string(k);
        timers.push_back({{"id", "t" + id},
                          {"kind", kinds[k % 3]},
                          {"in", k < 3 ? b : b + " && L.S1"},
                          {"pt", 200 + 150 * k},
                          {"q", "L.T" + id + ".Q"},
                          {"et", "L.T" + id + ".ET"}});
        counters.push_back({{"id", "c" + id},
                            {"up", "L.T" + id + ".Q"},
                            {"down", n + " > 60"},
                            {"reset", k % 2 ? "B3 && B1" : "L.T0.Q && " + b},
                            {"preset", 3},
                            {"value", "L.C" + id + ".V"},
                            {"reached", "L.C" + id + ".R"}});
        rules.push_back(
            {{"id", "r" + id},
             {"when", k % 2 ? n + " > 50" : "L.C" + id + ".R || " + b},
             {"hold", 100 * (k % 3)},
             {"repeatMs", k % 3 == 1 ? 400 : 0},
             {"fireOnStart", k == 0},
             {"enabled", k != 5},
             {"onRise",
              json::array({{{"do", "write"}, {"write", "w"}, {"value", {{"expr", n + " / 2"}}}},
                           {{"do", "toggle"}, {"tag", "X" + id}}})},
             {"onFall", json::array({{{"do", "setTag"}, {"tag", "X" + id}, {"value", false}}})}});
    }
    for (int k = 0; k < 3; ++k) {
        const std::string id = std::to_string(k);
        totalizers.push_back({{"id", "z" + id},
                              {"source", k == 2 ? "L.C0.V + N1" : nums[k % 2]},
                              {"reset", "L.T" + id + ".Q"},
                              {"cutoff", 10},
                              {"maxGapMs", 900},
                              {"rolloverAt", 1},
                              {"total", "L.Z" + id + ".T"},
                              {"gapSeconds", "L.Z" + id + ".G"}});
        runhours.push_back({{"id", "h" + id},
                            {"run", k == 2 ? "L.T4.Q" : bools[k]},
                            {"reset", "L.C" + id + ".R"},
                            {"hours", "L.H" + id + ".H"},
                            {"starts", "L.H" + id + ".N"}});
    }
    const json d = doc({{"rules", rules},
                        {"timers", timers},
                        {"counters", counters},
                        {"totalizers", totalizers},
                        {"runhours", runhours},
                        {"schedules", schedules},
                        {"writes", writes}});
    TagInfoMap tags;
    for (const auto& b : bools) tags[b] = tagInfo(TagType::BOOL, "internal", true);
    for (const auto& n : nums) tags[n] = tagInfo(TagType::FLOAT64);
    for (int k = 0; k < 6; ++k)
        tags["X" + std::to_string(k)] = tagInfo(TagType::BOOL, "internal", true);
    tags["W"] = tagInfo(TagType::FLOAT64, "external", true);
    Config cfg;
    cfg.maxWritesPerMin = 5;
    for (uint32_t seed = 1; seed <= 12 && !::testing::Test::HasFatalFailure(); ++seed) {
        SCOPED_TRACE("seed " + std::to_string(seed));
        std::mt19937 rng(seed);
        const auto pick = [&](int n) { return static_cast<int>(rng() % static_cast<uint32_t>(n)); };
        Twin t(d, tags, cfg);
        int64_t now = 0, wall = kMonday0558;
        bool synced = true;
        for (int i = 0; i < 3000 && !::testing::Test::HasFatalFailure(); ++i) {
            // inputs change rarely (most scans see none), sometimes unknown, NaN or the same again
            if (pick(6) == 0) {
                const std::string& b = bools[static_cast<size_t>(pick(3))];
                if (pick(10) == 0)
                    t.setBad(b);
                else
                    t.set(b, pick(2) == 0);
            }
            if (pick(8) == 0) {
                const std::string& n = nums[static_cast<size_t>(pick(2))];
                const int r = pick(20);
                if (r == 0)
                    t.setBad(n);
                else if (r == 1)
                    t.set(n, std::nan(""));
                else
                    t.set(n, static_cast<double>(pick(100)));
            }
            const int dt = pick(20) == 0 ? 1 + pick(3000) : 100;
            now += dt;
            wall += pick(50) == 0 ? pick(400000) - 100000 : dt;
            if (pick(80) == 0) synced = !synced;
            t.wall(pick(200) == 0 ? std::nullopt : std::optional<int64_t>(wall), synced);
            const int ev = pick(300);
            if (ev == 0) t.reset("c" + std::to_string(pick(6)), pick(5));
            if (ev == 1) t.reset("z" + std::to_string(pick(3)), 0.5);
            if (ev == 2) t.reset("h" + std::to_string(pick(3)), 0);
            if (ev == 3) t.writeResult("r" + std::to_string(pick(6)), "FAILED");
            if (ev == 4) t.setWritesOn(pick(2) == 0);
            if (ev == 5) t.restart();
            t.scan(now);
        }
        EXPECT_EQ(t.scans(), 3000);
    }
}

// The snapshot by slot with versions (mat-runtime, EngineRound::version): a slot is read again only
// when its version moved or is unknown (0); the results are those of reading every slot.
TEST(ScanSkip, TheSnapshotIsReadOnlyWhenTheVersionMoved) {
    const json d = doc(
        {{"rules",
          json::array(
              {{{"id", "r"},
                {"when", "A && N > 5"},
                {"onRise", json::array({{{"do", "setTag"}, {"tag", "A"}, {"value", false}}})}}})},
         {"counters", json::array({{{"id", "c"}, {"up", "A"}, {"value", "L.V"}}})}});
    TagInfoMap tags = boolTags({"A"});
    tags["N"] = tagInfo(TagType::FLOAT64);
    EngineOptions o;
    o.tags = tags;
    Engine plain(d, o), versioned(d, o);
    const std::vector<std::string> names = versioned.tags();
    ASSERT_EQ(plain.tags(), names);
    std::map<std::string, std::pair<expr::InputValue, uint64_t>> store;  // value, version
    const auto put = [&](const std::string& tag, TagScalar v) {
        auto& e = store[tag];
        e.first.value = std::move(v);
        e.first.quality = Quality::GOOD;
        ++e.second;
    };
    std::map<std::string, int> reads;
    const auto value = [&](size_t i) {
        const auto it = store.find(names[i]);
        return it == store.end() ? expr::InputValue{} : it->second.first;
    };
    const ReadAt readPlain = value;
    const ReadAt read = [&](size_t i) {
        ++reads[names[i]];
        return value(i);
    };
    const VersionAt version = [&](size_t i) -> uint64_t {
        const auto it = store.find(names[i]);
        return it == store.end() ? 0 : it->second.second;
    };
    put("A", false);
    put("N", 1.0);
    int64_t now = 0;
    const auto scan = [&] {
        now += 100;
        const auto a = plain.step(now, readPlain, WallClock{});
        const auto b = versioned.step(now, read, WallClock{}, version);
        ASSERT_EQ(a.size(), b.size());
        for (size_t i = 0; i < a.size(); ++i) EXPECT_EQ(actionJson(a[i]), actionJson(b[i]));
        EXPECT_EQ(outputJson(*plain.output("L.V")), outputJson(*versioned.output("L.V")));
        EXPECT_EQ(stateJson(*plain.state("r")), stateJson(*versioned.state("r")));
        for (const ActionOut& x : a)
            if (x.result == "OK") put(x.tag, x.value);
    };
    scan();
    EXPECT_EQ(reads["A"], 1);
    EXPECT_EQ(reads["N"], 1);
    scan();
    scan();
    EXPECT_EQ(reads["A"], 1) << "version unchanged: not read";
    EXPECT_EQ(reads["N"], 1);
    put("N", 9.0);
    put("A", true);
    scan();  // the rule fires, the counter counts
    EXPECT_EQ(reads["A"], 2);
    EXPECT_EQ(reads["N"], 2);
    EXPECT_EQ(std::get<int64_t>(versioned.output("L.V")->value), 1);
    scan();  // A back to false (the setTag)
    EXPECT_EQ(reads["A"], 3);
    put("N", 9.0);  // the same value with a new version: read, nothing changes
    scan();
    EXPECT_EQ(reads["N"], 3);
    store.erase("N");  // unknown version (0): read at every scan
    scan();
    scan();
    EXPECT_EQ(reads["N"], 5);
}
