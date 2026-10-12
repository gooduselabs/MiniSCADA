// tests/sim-vectors/legacy.json (contract value-tables-simulation §2.4, T027): the Sprint 1 mock
// (MockTagProvider, the `legacy` generator) on a fixed series of instants, written by this test and
// checked by it: the TypeScript port (packages/tag-sim legacy-mock.ts, T029) must follow it within
// 1e-9. Run with MAT_WRITE_VECTORS=1 to write the file again; without the file the test is red.
//
// Format:
//   { "t0", "stepMs", "steps",
//     "tags":   [ { "id", "type", "signal" } ... ]       the mock tags, in store order
//     "load":   { "count": 500, "recorded": 5 }           SIM.T0001.. (the load), the first
//     `recorded` in full "values": [ [ [value, quality, reason?] ... ] ... ] per step, per tag
//     (tags then the recorded SIM tags);
//                                                          value null: none yet (a BAD tag without
//                                                          a value)
//     "simSumCents": [ ... ]                               per step: sum over all SIM tags of
//     round(value x 100) }
#include <gtest/gtest.h>

#include <cmath>
#include <cstdlib>
#include <fstream>

#include "drivers/simulation/mock_tag_provider.hpp"
#include "nlohmann/json.hpp"

using nlohmann::json;
using namespace mat;

namespace {

const std::string kFile = std::string(MAT_SOURCE_DIR) + "/tests/sim-vectors/legacy.json";
constexpr int64_t kT0 = 1791594000000;  // 2026-10-10T01:00:00Z
constexpr int kStepMs = 250;
constexpr int kSteps = 400;
constexpr size_t kRecordedLoad = 5;

struct MockTag {
    const char* id;
    TagType type;
    const char* signal;
};
const MockTag kTags[] = {
    {"TANK01.LEVEL", TagType::FLOAT32, "tank.level"},
    {"MOTOR01.RUN", TagType::BOOL, "motor.run"},
    {"MOTOR01.SPEED", TagType::FLOAT32, "motor.speed"},
    {"TANK01.INFLOW", TagType::FLOAT32, "tank.inflow"},
    {"TANK01.TEMP", TagType::FLOAT32, "tank.temp"},
    {"X.UNKNOWN", TagType::FLOAT32, "nonsense"},
};
const char* typeName(TagType t) {
    switch (t) {
        case TagType::BOOL:
            return "BOOL";
        default:
            return "FLOAT32";
    }
}

json cell(const TagValue& v) {
    json c = json::array();
    if (const double* d = std::get_if<double>(&v.value))
        c.push_back(*d);
    else if (const bool* b = std::get_if<bool>(&v.value))
        c.push_back(*b);
    else
        c.push_back(nullptr);
    c.push_back(qualityName(v.quality));
    if (!v.reason.empty()) c.push_back(v.reason);
    return c;
}

json generate() {
    TagStore store;
    for (const auto& t : kTags) store.add({t.id, t.type, t.signal});
    MockTagProvider provider(store, true);  // adds SIM.T0001..T0500 after the mock tags
    json doc;
    doc["t0"] = kT0;
    doc["stepMs"] = kStepMs;
    doc["steps"] = kSteps;
    doc["tags"] = json::array();
    for (const auto& t : kTags)
        doc["tags"].push_back({{"id", t.id}, {"type", typeName(t.type)}, {"signal", t.signal}});
    doc["load"] = {{"count", MockTagProvider::kSimTagCount}, {"recorded", kRecordedLoad}};
    doc["values"] = json::array();
    doc["simSumCents"] = json::array();
    const size_t first = sizeof kTags / sizeof kTags[0];
    for (int s = 0; s < kSteps; ++s) {
        provider.step(kT0 + static_cast<int64_t>(s) * kStepMs);
        json row = json::array();
        for (size_t i = 0; i < first + kRecordedLoad; ++i) row.push_back(cell(store.get(i)));
        doc["values"].push_back(std::move(row));
        int64_t sum = 0;
        for (size_t i = first; i < first + MockTagProvider::kSimTagCount; ++i)
            sum += static_cast<int64_t>(std::llround(std::get<double>(store.get(i).value) * 100));
        doc["simSumCents"].push_back(sum);
    }
    return doc;
}

}  // namespace

TEST(LegacyVectors, TheMockReproducesTheCommittedFile) {
    const json now = generate();
    if (const char* w = std::getenv("MAT_WRITE_VECTORS"); w && std::string(w) == "1") {
        std::ofstream(kFile, std::ios::binary | std::ios::trunc) << now.dump(1) << "\n";
        GTEST_SKIP() << "wrote " << kFile;
    }
    std::ifstream f(kFile, std::ios::binary);
    ASSERT_TRUE(f.good()) << "missing " << kFile << ": run once with MAT_WRITE_VECTORS=1";
    const json committed = json::parse(f);
    EXPECT_EQ(now["t0"], committed["t0"]);
    EXPECT_EQ(now["tags"], committed["tags"]);
    EXPECT_EQ(now["simSumCents"], committed["simSumCents"]);
    ASSERT_EQ(committed["values"].size(), now["values"].size());
    for (size_t s = 0; s < now["values"].size(); ++s)
        EXPECT_EQ(now["values"][s], committed["values"][s]) << "step " << s;
}

TEST(LegacyVectors, TheSeriesShowsEveryKindOfValue) {
    const json doc = generate();
    bool badTemp = false, stopped = false, running = false, noSignal = false;
    double lowest = 100, highest = 0;
    for (const auto& row : doc["values"]) {
        const auto& temp = row[4];
        if (temp[1] == "BAD") badTemp = true;
        if (row[1][0] == false) stopped = true;
        if (row[1][0] == true) running = true;
        if (row[5][1] == "BAD" && row[5].size() == 3 && row[5][2] == "NO_SIGNAL") noSignal = true;
        lowest = std::min(lowest, row[0][0].get<double>());
        highest = std::max(highest, row[0][0].get<double>());
    }
    EXPECT_TRUE(badTemp);  // tank.temp is BAD for 5 s in every 20 s
    EXPECT_TRUE(stopped);  // the pump stops at 90 %
    EXPECT_TRUE(running);
    EXPECT_TRUE(noSignal);  // an unknown signal
    EXPECT_GT(highest, 89.0);
    EXPECT_LT(lowest, 60.0);
}
