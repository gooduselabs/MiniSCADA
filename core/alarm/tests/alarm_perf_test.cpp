// T041 (label perf): the tick budget of the engine (FR-021: step <= 2 ms for 500 instances) on x64.
// Three phases: nothing changes, a random walk of a tenth of the Tags, and storms where all 200
// Tags jump over the thresholds and back. With MAT_PERF_WRITE=1 it writes
// docs/reports/009-tick-x64.json.
#include <gtest/gtest.h>

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <fstream>
#include <vector>

#include "core/alarm/alarm_defs.hpp"
#include "core/alarm/alarm_engine.hpp"
#include "nlohmann/json.hpp"

using namespace mat::alarm;
using nlohmann::json;
using Clock = std::chrono::steady_clock;

namespace {
constexpr int64_t kEpoch0 = 1791600000000LL;

struct Stats {
    double avgUs = 0, p99Us = 0, maxUs = 0;
    long steps = 0, events = 0;
};

Stats summarize(std::vector<double>& us, long events) {
    Stats s;
    s.steps = static_cast<long>(us.size());
    s.events = events;
    double sum = 0;
    for (double v : us) sum += v;
    s.avgUs = us.empty() ? 0 : sum / us.size();
    std::sort(us.begin(), us.end());
    s.maxUs = us.empty() ? 0 : us.back();
    s.p99Us = us.empty() ? 0 : us[static_cast<size_t>(us.size() * 0.99)];
    return s;
}
json statsJson(const Stats& s) {
    return {{"steps", s.steps},
            {"events", s.events},
            {"avgUs", s.avgUs},
            {"p99Us", s.p99Us},
            {"maxUs", s.maxUs}};
}
}  // namespace

TEST(AlarmPerf, FiveHundredInstancesFit2Ms) {
    json alarms = json::array();
    for (int i = 0; i < 125; ++i)
        alarms.push_back({{"id", "A" + std::to_string(i)},
                          {"type", "limit"},
                          {"name", "Mức " + std::to_string(i)},
                          {"tag", "T" + std::to_string((i * 7) % 200)},
                          {"limits",
                           {{"LL", {{"value", 5}, {"class", "minor"}}},
                            {"L", {{"value", 15}, {"class", "minor"}}},
                            {"H", {{"value", 80}, {"class", "minor"}}},
                            {"HH", {{"value", 90}, {"class", "critical"}}}}},
                          {"deadband", 1},
                          {"onDelayMs", 1000},
                          {"offDelayMs", 500}});
    json classes = {{"classes", json::array({{{"id", "minor"},
                                              {"name", "Nhỏ"},
                                              {"priority", "minor"},
                                              {"color", "amber"},
                                              {"chatterLimit", 0}},
                                             {{"id", "critical"},
                                              {"name", "Khẩn"},
                                              {"priority", "critical"},
                                              {"color", "red"},
                                              {"chatterLimit", 0}}})}};
    ProjectView p;
    p.alarms = {{"alarms", alarms}};
    p.classes = classes;
    CompileResult r = compileAlarms(p);
    ASSERT_TRUE(r.ok());
    ASSERT_EQ(r.defs.instances.size(), 500u);
    AlarmEngine eng;
    LoadContext ctx;
    ctx.nowEpochMs = kEpoch0;
    eng.load(r.defs, ctx);
    std::vector<AlarmEvent> sink;
    eng.takeEvents(sink);
    sink.clear();
    const size_t n = eng.watchedTags().size();
    std::vector<TagSample> s(n);
    std::vector<double> base(n, 50.0);
    unsigned seed = 11;
    auto rnd = [&] {
        seed = seed * 1664525u + 1013904223u;
        return (seed >> 8) & 0xFFFFFF;
    };
    int64_t mono = 0;
    long events = 0;
    auto stepOnce = [&](std::vector<double>& us) {
        for (size_t i = 0; i < n; ++i) s[i].value = base[i];
        const auto t0 = Clock::now();
        eng.step(mono, kEpoch0 + mono, s.data(), s.size());
        const auto t1 = Clock::now();
        eng.takeEvents(sink);
        events += static_cast<long>(sink.size());
        sink.clear();
        us.push_back(std::chrono::duration<double, std::micro>(t1 - t0).count());
        mono += 250;
    };
    std::vector<double> quiet, walk, storm;
    for (int i = 0; i < 4000; ++i) stepOnce(quiet);
    const long evQuiet = events;
    for (int i = 0; i < 8000; ++i) {
        for (int k = 0; k < 20; ++k) {
            const size_t j = rnd() % n;
            base[j] = std::min(
                120.0,
                std::max(-20.0, base[j] + (static_cast<double>(rnd() % 2001) / 100.0 - 10.0)));
        }
        stepOnce(walk);
    }
    const long evWalk = events - evQuiet;
    std::fill(base.begin(), base.end(), 50.0);
    for (int round = 0; round < 40; ++round) {
        for (int i = 0; i < 12; ++i) {  // all Tags above HH for 3 s ...
            std::fill(base.begin(), base.end(), 95.0);
            stepOnce(storm);
        }
        for (int i = 0; i < 12; ++i) {  // ... then below LL
            std::fill(base.begin(), base.end(), 0.0);
            stepOnce(storm);
        }
    }
    const long evStorm = events - evQuiet - evWalk;
    Stats a = summarize(quiet, evQuiet), b = summarize(walk, evWalk), c = summarize(storm, evStorm);
    std::printf(
        "[perf] quiet avg %.1f us max %.1f | walk avg %.1f us max %.1f (%ld events) | storm avg "
        "%.1f us max %.1f (%ld events)\n",
        a.avgUs, a.maxUs, b.avgUs, b.maxUs, b.events, c.avgUs, c.maxUs, c.events);
    EXPECT_LT(a.avgUs, 2000.0);
    EXPECT_LT(b.avgUs, 2000.0);
    EXPECT_LT(c.avgUs, 2000.0);
    EXPECT_EQ(a.events, 0);
    if (std::getenv("MAT_PERF_WRITE")) {
        json out = {
            {"task", "T041"},
            {"feature", "009-alarms"},
            {"what",
             "AlarmEngine::step, 500 instances, 200 watched Tags, tick 250 ms, x64 container"},
            {"instances", 500},
            {"tags", static_cast<int>(n)},
            {"quiet", statsJson(a)},
            {"randomWalk", statsJson(b)},
            {"storm", statsJson(c)},
            {"budgetUs", 2000},
            {"note", "BL335 is measured at T129; x64 numbers are a reference only"}};
        std::ofstream(std::string(MAT_SOURCE_DIR) + "/docs/reports/009-tick-x64.json")
            << out.dump(2) << "\n";
    }
}
