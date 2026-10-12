// Tag Engine v1 (ADR-017; research R5, R6; FR-010, FR-011, FR-012, FR-016, FR-019): one round with
// a fake clock and a fake driver calling the EngineSink.
#include "core/tag-engine/engine.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <cmath>
#include <thread>

#include "core/tag-engine/sim_factory.hpp"
#include "drivers/simulation/mock_tag_provider.hpp"

using nlohmann::json;
using namespace mat;

namespace {

constexpr int64_t kT0 = 1791594000000;

LoadedProject projectOf(const json& tags, const json& tables = json::object()) {
    LoadedProject p;
    p.project = {{"schemaVersion", "0.2.0"}, {"tagFile", "tags.json"}, {"screens", json::array()}};
    p.tags = {{"schemaVersion", "0.2.0"}, {"tags", tags}};
    p.connections = json::parse(R"({"schemaVersion":"0.2.0","channels":[
      {"id":"c1","name":"C","kind":"modbus-tcp","tcp":{"host":"1.2.3.4"},"devices":[{"id":"d1","name":"D"}]},
      {"id":"c2","name":"C2","kind":"modbus-tcp","enabled":false,"tcp":{"host":"1.2.3.5"},"devices":[{"id":"d2","name":"D2"}]}]})");
    for (auto it = tables.begin(); it != tables.end(); ++it) p.valueTables[it.key()] = it.value();
    return p;
}

// Everything of a test: model, store, engine.
struct Rig {
    ProjectModel model;
    TagStore store;
    std::unique_ptr<Engine> engine;

    explicit Rig(const json& tags, const json& tables = json::object()) {
        std::string err;
        auto m = buildProjectModel(projectOf(tags, tables), &err);
        EXPECT_TRUE(m) << err;
        model = *m;
        addModelTagsToStore(model, store);
        engine = std::make_unique<Engine>(store, model);
    }
    size_t idx(const std::string& id) const { return *store.indexOf(id); }
    TagValue get(const std::string& id) const { return store.get(idx(id)); }

    drv::TagUpdate good(const std::string& id, TagScalar v, int64_t ts = kT0) const {
        drv::TagUpdate u;
        u.tag = idx(id);
        u.value = std::move(v);
        u.quality = Quality::GOOD;
        u.sourceTs = ts;
        return u;
    }
    drv::TagUpdate bad(const std::string& id, const char* reason, int64_t ts = kT0) const {
        drv::TagUpdate u;
        u.tag = idx(id);
        u.quality = Quality::BAD;
        u.reason = reason;
        u.sourceTs = ts;
        return u;
    }
    void publish(std::vector<drv::TagUpdate> v) { engine->publish(std::move(v)); }
};

double dval(const TagValue& v) { return std::get<double>(v.value); }

}  // namespace

// ---- one round ----

TEST(Engine, StartupExternalAndCalculatedTagsAreBadNoValueUntilTheFirstValue) {
    Rig r(json::parse(R"([
      {"id":"A","kind":"external","type":"FLOAT64","source":{"device":"d1","address":"HR1"}},
      {"id":"C","kind":"calculated","type":"FLOAT64","expression":"A + 1"},
      {"id":"I","kind":"internal","type":"FLOAT64","initial":5},
      {"id":"X","kind":"external","type":"FLOAT64","source":{"device":"d2","address":"HR1"}}
    ])"));
    r.engine->step(kT0);
    EXPECT_EQ(r.get("A").quality, Quality::BAD);
    EXPECT_EQ(r.get("A").reason, "NO_VALUE");
    EXPECT_EQ(r.get("C").quality, Quality::BAD);
    EXPECT_EQ(r.get("C").reason, "NO_VALUE");  // an input without a value
    EXPECT_EQ(r.get("I").quality, Quality::GOOD);
    EXPECT_EQ(dval(r.get("I")), 5.0);
    EXPECT_EQ(r.get("X").quality, Quality::BAD);
    EXPECT_EQ(r.get("X").reason, "DISABLED");  // channel disabled in the project
    r.publish({r.good("A", 2.0)});
    r.engine->step(kT0 + 250);
    EXPECT_EQ(r.get("A").quality, Quality::GOOD);
    EXPECT_EQ(dval(r.get("C")), 3.0);
    EXPECT_EQ(r.get("C").quality, Quality::GOOD);
}

TEST(Engine, ExternalScalingNanClampAndKeepLastValue) {
    Rig r(json::parse(R"([
      {"id":"L","kind":"external","type":"FLOAT32","source":{"device":"d1","address":"HR1","rawType":"INT16"},
       "scaling":{"rawMin":0,"rawMax":27648,"engMin":0,"engMax":100,"clamp":true}},
      {"id":"F","kind":"external","type":"FLOAT64","source":{"device":"d1","address":"HR10"}}
    ])"));
    r.publish({r.good("L", int64_t{13824}), r.good("F", 1.5)});
    r.engine->step(kT0);
    EXPECT_EQ(dval(r.get("L")), 50.0);  // US1-10
    // outside the raw range with clamp: the engineering bound, UNCERTAIN CLAMPED
    r.publish({r.good("L", int64_t{30000})});
    r.engine->step(kT0 + 250);
    EXPECT_EQ(dval(r.get("L")), 100.0);
    EXPECT_EQ(r.get("L").quality, Quality::UNCERTAIN);
    EXPECT_EQ(r.get("L").reason, "CLAMPED");
    // NaN and infinities: BAD INVALID_VALUE, the last value kept
    r.publish({r.good("F", std::nan(""))});
    r.engine->step(kT0 + 500);
    EXPECT_EQ(r.get("F").quality, Quality::BAD);
    EXPECT_EQ(r.get("F").reason, "INVALID_VALUE");
    EXPECT_EQ(dval(r.get("F")), 1.5);
    r.publish({r.good("F", INFINITY)});
    r.engine->step(kT0 + 750);
    EXPECT_EQ(r.get("F").reason, "INVALID_VALUE");
    r.publish({r.good("F", 2.5)});
    r.engine->step(kT0 + 1000);
    EXPECT_EQ(r.get("F").quality, Quality::GOOD);
    EXPECT_EQ(dval(r.get("F")), 2.5);
    // a BAD driver update keeps the value too
    r.publish({r.bad("F", "TIMEOUT")});
    r.engine->step(kT0 + 1250);
    EXPECT_EQ(r.get("F").reason, "TIMEOUT");
    EXPECT_EQ(dval(r.get("F")), 2.5);
}

TEST(Engine, DeadbandPublishesBeyondTheBandOrOnAQualityOrReasonChange) {
    Rig r(json::parse(R"([
      {"id":"D","kind":"external","type":"FLOAT64","deadband":0.5,"source":{"device":"d1","address":"HR1"}},
      {"id":"Z","kind":"external","type":"FLOAT64","deadband":0,"source":{"device":"d1","address":"HR2"}}
    ])"));
    r.publish({r.good("D", 10.0), r.good("Z", 10.0)});
    r.engine->step(kT0);
    r.store.takeDirty();
    // inside the band: nothing is published (the value in the store stays)
    r.publish({r.good("D", 10.4), r.good("Z", 10.4)});
    r.engine->step(kT0 + 250);
    EXPECT_EQ(dval(r.get("D")), 10.0);
    EXPECT_EQ(dval(r.get("Z")), 10.4);  // deadband 0: every change
    // exactly on the edge is not beyond it
    r.publish({r.good("D", 10.5)});
    r.engine->step(kT0 + 500);
    EXPECT_EQ(dval(r.get("D")), 10.0);
    r.publish({r.good("D", 10.6)});
    r.engine->step(kT0 + 750);
    EXPECT_EQ(dval(r.get("D")), 10.6);
    // the band is measured from the last published value
    r.publish({r.good("D", 10.2)});
    r.engine->step(kT0 + 1000);
    EXPECT_EQ(dval(r.get("D")), 10.6);
    // a quality change is always published, then a reason change
    r.store.takeDirty();
    r.publish({r.bad("D", "TIMEOUT")});
    r.engine->step(kT0 + 1250);
    EXPECT_EQ(r.store.takeDirty(), (std::vector<size_t>{r.idx("D")}));
    r.publish({r.bad("D", "DISCONNECTED")});
    r.engine->step(kT0 + 1500);
    EXPECT_EQ(r.get("D").reason, "DISCONNECTED");
    EXPECT_EQ(r.store.takeDirty(), (std::vector<size_t>{r.idx("D")}));
    // and the first GOOD value after a BAD one is published whatever the band
    r.publish({r.good("D", 10.7)});
    r.engine->step(kT0 + 1750);
    EXPECT_EQ(r.get("D").quality, Quality::GOOD);
    EXPECT_EQ(dval(r.get("D")), 10.7);
}

TEST(Engine, AValueReadBackAfterAWriteIsAlwaysPublished) {
    Rig r(json::parse(R"([
      {"id":"D","kind":"external","type":"FLOAT64","deadband":5,"source":{"device":"d1","address":"HR1"}}
    ])"));
    r.publish({r.good("D", 10.0)});
    r.engine->step(kT0);
    auto u = r.good("D", 10.5);
    u.afterWrite = true;
    r.publish({u});
    r.engine->step(kT0 + 250);
    EXPECT_EQ(dval(r.get("D")), 10.5);
}

TEST(Engine, SimulationTagsFollowTheClockOfTheRound) {
    Rig r(json::parse(R"([
      {"id":"R","kind":"simulation","type":"FLOAT64","sim":{"kind":"ramp","from":0,"to":100,"periodMs":10000}}
    ])"));
    auto sim = makeSimulationDriver(r.model);
    sim->start(*r.engine);
    r.engine->addSteppedDriver(sim.get());
    r.engine->step(2500);
    EXPECT_EQ(dval(r.get("R")), 25.0);
    r.engine->step(7500);
    EXPECT_EQ(dval(r.get("R")), 75.0);
    sim->stop();
}

TEST(Engine, InternalTagStartsAtInitialAndTakesCommands) {
    Rig r(json::parse(R"([
      {"id":"I","kind":"internal","type":"INT16","initial":7,"access":"RW"}
    ])"));
    r.engine->step(kT0);
    EXPECT_EQ(std::get<int64_t>(r.get("I").value), 7);
    r.engine->setInternal(r.idx("I"), int64_t{42});
    r.engine->step(kT0 + 250);
    EXPECT_EQ(std::get<int64_t>(r.get("I").value), 42);
    EXPECT_EQ(r.get("I").quality, Quality::GOOD);
}

TEST(Engine, ACommandOnAnInternalTagWithAnIdAnswersAppliedWhenItIsInTheStore) {  // FR-038
    Rig r(json::parse(R"([
      {"id":"I","kind":"internal","type":"INT16","initial":7,"access":"RW"}
    ])"));
    std::vector<drv::WriteResult> got;
    r.engine->setWriteResultHandler([&](const drv::WriteResult& w) { got.push_back(w); });
    r.engine->step(kT0);
    r.engine->setInternal(r.idx("I"), int64_t{42}, 77);
    EXPECT_TRUE(got.empty()) << "applied at the next round, not before";
    r.engine->step(kT0 + 250);
    EXPECT_EQ(std::get<int64_t>(r.get("I").value), 42);
    ASSERT_EQ(got.size(), 1u);
    EXPECT_EQ(got[0].id, 77u);
    EXPECT_EQ(got[0].status, drv::WriteStatus::Confirmed);
    EXPECT_EQ(got[0].code, "APPLIED");
    r.engine->step(kT0 + 500);
    EXPECT_EQ(got.size(), 1u) << "once";
    // a value of the wrong type is not applied and is not confirmed
    r.engine->setInternal(r.idx("I"), std::string("x"), 78);
    r.engine->step(kT0 + 750);
    ASSERT_EQ(got.size(), 2u);
    EXPECT_EQ(got[1].id, 78u);
    EXPECT_EQ(got[1].status, drv::WriteStatus::Failed);
    EXPECT_EQ(std::get<int64_t>(r.get("I").value), 42);
}

// ---- calculated Tags ----

TEST(Engine, ChainOfCalculatedTagsIsComputedInOneRoundAndComesInOneBatch) {  // US4-4
    Rig r(json::parse(R"([
      {"id":"C","kind":"calculated","type":"FLOAT64","expression":"B * 2"},
      {"id":"B","kind":"calculated","type":"FLOAT64","expression":"A + 1"},
      {"id":"A","kind":"external","type":"FLOAT64","source":{"device":"d1","address":"HR1"}}
    ])"));
    r.publish({r.good("A", 1.0)});
    r.engine->step(kT0);
    EXPECT_EQ(dval(r.get("C")), 4.0);
    r.store.takeDirty();
    const uint64_t revA = r.get("A").revision, revB = r.get("B").revision,
                   revC = r.get("C").revision;
    r.publish({r.good("A", 5.0)});
    r.engine->step(kT0 + 250);
    // all three changed in this round and in the same dirty set: no intermediate value was ever
    // visible
    EXPECT_EQ(r.store.takeDirty().size(), 3u);
    EXPECT_EQ(dval(r.get("B")), 6.0);
    EXPECT_EQ(dval(r.get("C")), 12.0);
    EXPECT_EQ(r.get("A").revision, revA + 1);
    EXPECT_EQ(r.get("B").revision, revB + 1);
    EXPECT_EQ(r.get("C").revision, revC + 1);
}

TEST(Engine, OnlyCalculatedTagsWithAChangedInputAreComputed) {
    Rig r(json::parse(R"([
      {"id":"A","kind":"external","type":"FLOAT64","source":{"device":"d1","address":"HR1"}},
      {"id":"B","kind":"external","type":"FLOAT64","source":{"device":"d1","address":"HR2"}},
      {"id":"CA","kind":"calculated","type":"FLOAT64","expression":"A * 10"},
      {"id":"CB","kind":"calculated","type":"FLOAT64","expression":"B * 10"}
    ])"));
    r.publish({r.good("A", 1.0), r.good("B", 1.0)});
    r.engine->step(kT0);
    r.store.takeDirty();
    r.publish({r.good("A", 2.0)});
    r.engine->step(kT0 + 250);
    const auto dirty = r.store.takeDirty();
    EXPECT_EQ(dirty, (std::vector<size_t>{r.idx("A"), r.idx("CA")}));
}

TEST(Engine, ErrorInTheExpressionIsBadWithAReasonKeepsTheLastValueAndHeals) {  // US4-5, US4-6
    Rig r(json::parse(R"([
      {"id":"D","kind":"external","type":"FLOAT64","source":{"device":"d1","address":"HR1"}},
      {"id":"Q","kind":"calculated","type":"FLOAT64","expression":"10 / D"}
    ])"));
    r.publish({r.good("D", 2.0)});
    r.engine->step(kT0);
    EXPECT_EQ(dval(r.get("Q")), 5.0);
    r.publish({r.good("D", 0.0)});
    r.engine->step(kT0 + 250);
    EXPECT_EQ(r.get("Q").quality, Quality::BAD);
    EXPECT_EQ(r.get("Q").reason, "DIV_ZERO");
    EXPECT_EQ(dval(r.get("Q")), 5.0);  // the last value is kept
    r.publish({r.good("D", 4.0)});
    r.engine->step(kT0 + 500);
    EXPECT_EQ(r.get("Q").quality, Quality::GOOD);
    EXPECT_EQ(dval(r.get("Q")), 2.5);
    // a BAD input: INPUT_BAD, back to GOOD when the input is valid again
    r.publish({r.bad("D", "TIMEOUT")});
    r.engine->step(kT0 + 750);
    EXPECT_EQ(r.get("Q").quality, Quality::BAD);
    EXPECT_EQ(r.get("Q").reason, "INPUT_BAD");
    r.publish({r.good("D", 1.0)});
    r.engine->step(kT0 + 1000);
    EXPECT_EQ(r.get("Q").quality, Quality::GOOD);
    EXPECT_EQ(dval(r.get("Q")), 10.0);
}

TEST(Engine, UncertainInputGivesUncertainResultWithItsReason) {
    Rig r(json::parse(R"([
      {"id":"L","kind":"external","type":"FLOAT64","source":{"device":"d1","address":"HR1","rawType":"INT16"},
       "scaling":{"rawMin":0,"rawMax":100,"engMin":0,"engMax":100,"clamp":true}},
      {"id":"Q","kind":"calculated","type":"FLOAT64","expression":"L + 1"}
    ])"));
    r.publish({r.good("L", int64_t{500})});
    r.engine->step(kT0);
    EXPECT_EQ(r.get("Q").quality, Quality::UNCERTAIN);
    EXPECT_EQ(r.get("Q").reason, "CLAMPED");
    EXPECT_EQ(dval(r.get("Q")), 101.0);
}

TEST(Engine, CalculatedTagWithADeadbandAndAValueTable) {
    Rig r(
        json::parse(R"j([
      {"id":"A","kind":"external","type":"INT16","source":{"device":"d1","address":"HR1"}},
      {"id":"T","kind":"calculated","type":"STRING","expression":"text(A, Tb)"},
      {"id":"V","kind":"calculated","type":"FLOAT64","deadband":1,"expression":"A * 1.0"}
    ])j"),
        json::parse(
            R"j({"Tb":{"schemaVersion":"0.2.0","name":"Tb","entries":[{"value":1,"text":"Chạy"}],"default":{"text":"?"}}})j"));
    r.publish({r.good("A", int64_t{1})});
    r.engine->step(kT0);
    EXPECT_EQ(std::get<std::string>(r.get("T").value), "Chạy");
    r.publish({r.good("A", int64_t{2})});  // V changes by 1: not beyond the deadband 1
    r.engine->step(kT0 + 250);
    EXPECT_EQ(std::get<std::string>(r.get("T").value), "?");
    EXPECT_EQ(dval(r.get("V")), 1.0);
}

// ---- one applyBatch per round ----

TEST(Engine, AReaderNeverSeesAHalfAppliedRound) {
    Rig r(json::parse(R"([
      {"id":"A","kind":"external","type":"FLOAT64","source":{"device":"d1","address":"HR1"}},
      {"id":"B","kind":"calculated","type":"FLOAT64","expression":"A * 2"}
    ])"));
    const size_t a = r.idx("A"), b = r.idx("B");
    std::atomic<bool> stop{false};
    std::atomic<uint64_t> torn{0};
    std::thread reader([&] {
        std::vector<TagValue> v;
        while (!stop) {
            r.store.snapshot({a, b}, v);
            if (std::holds_alternative<double>(v[0].value) !=
                std::holds_alternative<double>(v[1].value))
                ++torn;
            if (std::holds_alternative<double>(v[0].value) &&
                std::get<double>(v[1].value) != 2 * std::get<double>(v[0].value))
                ++torn;
        }
    });
    for (int i = 1; i <= 20000; ++i) {
        r.publish({r.good("A", static_cast<double>(i))});
        r.engine->step(kT0 + i);
    }
    stop = true;
    reader.join();
    EXPECT_EQ(torn.load(), 0u);
}

// ---- retained Tags ----

TEST(Engine, RetainedValuesAreAppliedAtStartupAndChangesAreReported) {
    Rig r(json::parse(R"([
      {"id":"K","kind":"internal","type":"FLOAT64","initial":1,"retain":true,"access":"RW"},
      {"id":"N","kind":"internal","type":"FLOAT64","initial":1,"access":"RW"}
    ])"));
    r.engine->applyRetained({{r.idx("K"), 42.5}}, false);
    std::vector<std::pair<size_t, TagScalar>> seen;
    r.engine->setRetainObserver([&](size_t t, const TagScalar& v) { seen.emplace_back(t, v); });
    r.engine->step(kT0);
    EXPECT_EQ(dval(r.get("K")), 42.5);
    EXPECT_EQ(r.engine->retainedTags(), (std::vector<size_t>{r.idx("K")}));
    seen.clear();
    r.engine->setInternal(r.idx("K"), 7.0);
    r.engine->setInternal(r.idx("N"), 8.0);  // not retained: not reported
    r.engine->step(kT0 + 250);
    ASSERT_EQ(seen.size(), 1u);
    EXPECT_EQ(seen[0].first, r.idx("K"));
    EXPECT_EQ(std::get<double>(seen[0].second), 7.0);
}

TEST(Engine, LostRetainedStoreStartsFromInitialAsUncertain) {
    Rig r(json::parse(R"([
      {"id":"K","kind":"internal","type":"FLOAT64","initial":3,"retain":true,"access":"RW"}
    ])"));
    r.engine->applyRetained({}, true);
    r.engine->step(kT0);
    EXPECT_EQ(dval(r.get("K")), 3.0);
    EXPECT_EQ(r.get("K").quality, Quality::UNCERTAIN);
    EXPECT_EQ(r.get("K").reason, "RETAIN_LOST");
    r.engine->setInternal(r.idx("K"), 4.0);  // a new value makes it GOOD again
    r.engine->step(kT0 + 250);
    EXPECT_EQ(r.get("K").quality, Quality::GOOD);
}

TEST(Engine, WriteResultsAreHandedOn) {
    Rig r(json::parse(R"([
      {"id":"A","kind":"external","type":"FLOAT64","source":{"device":"d1","address":"HR1"}}
    ])"));
    std::vector<drv::WriteResult> got;
    r.engine->setWriteResultHandler([&](const drv::WriteResult& w) { got.push_back(w); });
    drv::WriteResult w;
    w.id = 5;
    w.code = "CONFIRMED";
    r.engine->writeDone(std::move(w));
    EXPECT_TRUE(got.empty());  // handed on in the round, not at once
    r.engine->step(kT0);
    ASSERT_EQ(got.size(), 1u);
    EXPECT_EQ(got[0].id, 5u);
}

// ---- FR-002, SC-009, US1-2: project 0.1 gives what runtime 0.4 gave ----

namespace {

struct Frame {
    TagScalar value;
    Quality quality;
    bool operator==(const Frame& o) const { return value == o.value && quality == o.quality; }
};

// The values and qualities of the five mock Tags at `steps` instants, through runtime 0.4 (the
// MockTagProvider straight into a store)...
std::vector<std::vector<Frame>> viaMockProvider(
    const std::vector<std::pair<std::string, TagType>>& tags,
    const std::vector<std::string>& signals, int steps) {
    TagStore store;
    for (size_t i = 0; i < tags.size(); ++i) store.add({tags[i].first, tags[i].second, signals[i]});
    MockTagProvider provider(store, false);
    std::vector<std::vector<Frame>> out;
    for (int s = 0; s < steps; ++s) {
        provider.step(kT0 + static_cast<int64_t>(s) * 250);
        std::vector<Frame> row;
        for (size_t i = 0; i < tags.size(); ++i) {
            const TagValue v = store.get(i);
            row.push_back({v.value, v.quality});
        }
        out.push_back(std::move(row));
    }
    return out;
}

// ... and through the engine with the `legacy` simulation driver.
std::vector<std::vector<Frame>> viaEngine(const LoadedProject& project, int steps) {
    const auto m = buildProjectModel(project);
    EXPECT_TRUE(m);
    TagStore store;
    addModelTagsToStore(*m, store);
    Engine engine(store, *m);
    auto sim = makeSimulationDriver(*m);
    sim->start(engine);
    engine.addSteppedDriver(sim.get());
    std::vector<std::vector<Frame>> out;
    for (int s = 0; s < steps; ++s) {
        engine.step(kT0 + static_cast<int64_t>(s) * 250);
        std::vector<Frame> row;
        for (size_t i = 0; i < m->tags.size(); ++i) {
            const TagValue v = store.get(i);
            row.push_back({v.value, v.quality});
        }
        out.push_back(std::move(row));
    }
    sim->stop();
    return out;
}

}  // namespace

TEST(EngineLegacy, Project01GivesTheSameValuesAndQualitiesAsTheMockProvider) {
    const std::string schemas = std::string(MAT_SOURCE_DIR) + "/schemas";
    const auto v = validateProject(std::string(MAT_SOURCE_DIR) + "/projects/tank-demo", schemas);
    ASSERT_TRUE(v.valid);
    std::vector<std::pair<std::string, TagType>> tags;
    std::vector<std::string> signals;
    for (const auto& t : v.project->tags["tags"]) {
        tags.emplace_back(t["id"].get<std::string>(), *parseTagType(t["type"].get<std::string>()));
        signals.push_back(t["source"]["signal"].get<std::string>());
    }
    constexpr int kSteps = 500;
    const auto want = viaMockProvider(tags, signals, kSteps);
    const auto got = viaEngine(*v.project, kSteps);
    ASSERT_EQ(got.size(), want.size());
    size_t differences = 0;
    for (size_t s = 0; s < want.size(); ++s)
        for (size_t i = 0; i < want[s].size(); ++i)
            if (!(got[s][i] == want[s][i])) ++differences;
    EXPECT_EQ(differences, 0u) << "at 500 instants x " << tags.size() << " Tags";
    // the run did show every kind of value: a BAD temperature window and a pump that stops
    bool sawBad = false, sawStop = false;
    for (const auto& row : want)
        for (const auto& f : row) {
            if (f.quality == Quality::BAD) sawBad = true;
            if (std::holds_alternative<bool>(f.value) && !std::get<bool>(f.value)) sawStop = true;
        }
    EXPECT_TRUE(sawBad);
    EXPECT_TRUE(sawStop);
}

TEST(EngineLegacy, TheUpgradedProjectGivesTheSameChain) {
    const std::string schemas = std::string(MAT_SOURCE_DIR) + "/schemas";
    const auto before =
        validateProject(std::string(MAT_SOURCE_DIR) + "/projects/tank-demo", schemas);
    const auto after = validateProject(
        std::string(MAT_SOURCE_DIR) + "/tests/migration-vectors/valid-tank-demo/after", schemas);
    ASSERT_TRUE(before.valid);
    ASSERT_TRUE(after.valid) << resultJson(after);
    ASSERT_TRUE(after.project->is02());
    const auto a = viaEngine(*before.project, 500);
    const auto b = viaEngine(*after.project, 500);
    ASSERT_EQ(a.size(), b.size());
    size_t differences = 0;
    for (size_t s = 0; s < a.size(); ++s)
        for (size_t i = 0; i < a[s].size(); ++i)
            if (!(a[s][i] == b[s][i])) ++differences;
    EXPECT_EQ(differences, 0u);
}

TEST(EngineLegacy, UnknownSignalIsBadNoSignalLikeRuntime04) {
    Rig r(json::parse(R"([
      {"id":"X","kind":"simulation","type":"FLOAT32","sim":{"kind":"legacy","signal":"nonsense"}}
    ])"));
    auto sim = makeSimulationDriver(r.model);
    sim->start(*r.engine);
    r.engine->addSteppedDriver(sim.get());
    r.engine->step(kT0);
    EXPECT_EQ(r.get("X").quality, Quality::BAD);
    EXPECT_EQ(r.get("X").reason, "NO_SIGNAL");
    sim->stop();
}

TEST(EngineLegacy, SimLoadTagsArePublishedLikeTheSprint1Load) {
    ProjectModel m;
    addSimLoadTags(m);
    ASSERT_EQ(m.tags.size(), LegacyMock::kSimTagCount);
    TagStore store;
    addModelTagsToStore(m, store);
    Engine engine(store, m);
    auto sim = makeSimulationDriver(m);
    sim->start(engine);
    engine.addSteppedDriver(sim.get());
    engine.step(kT0);
    EXPECT_EQ(store.get(0).quality, Quality::GOOD);
    store.takeDirty();
    engine.step(kT0 + 1000);  // one second: every SIM Tag changes about once
    EXPECT_GE(store.takeDirty().size(), 490u);
    sim->stop();
}
