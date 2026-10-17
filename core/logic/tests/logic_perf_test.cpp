// The scan of the maximum logic configuration (FR-095, T147 part: the engine alone; label perf):
// the document of `projects/logic-load` (tools/gen-bench-projects.mjs): 200 rules, 100 timers, 100
// counters, 50 totalizers, 50 run-hours blocks, 50 schedules over 100 changing Tags. Prints the
// scan time (mean, p99, max) and checks it stays within the 5 ms budget of FR-095 on this host
// (the BL335 measure is T148). MAT_LOGIC_PERF_OUT=<file> also writes the numbers as JSON.
#include <gtest/gtest.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>

#include "core/logic/tests/test_util.hpp"

using namespace mat;
using namespace mat::logic;
using namespace mat::logic::test;

namespace {

std::string pad(int k) {
    char b[8];
    std::snprintf(b, sizeof b, "%03d", k);
    return b;
}
std::string sim(int k) {
    char b[16];
    std::snprintf(b, sizeof b, "SIM.T%04d", ((k - 1) % 100) + 1);
    return b;
}

json loadDoc() {
    json rules = json::array(), timers = json::array(), counters = json::array(),
         totalizers = json::array(), runhours = json::array(), schedules = json::array();
    for (int k = 1; k <= 200; ++k)
        rules.push_back(
            {{"id", "r" + pad(k)},
             {"when", sim(k) + " > 100"},
             {"hold", 1000},
             {"onRise",
              json::array({{{"do", "setTag"}, {"tag", "INT.R" + pad(k)}, {"value", true}}})},
             {"onFall",
              json::array({{{"do", "setTag"}, {"tag", "INT.R" + pad(k)}, {"value", false}}})}});
    const char* kinds[] = {"ton", "tof", "tp"};
    for (int k = 1; k <= 100; ++k)
        timers.push_back({{"id", "t" + pad(k)},
                          {"kind", kinds[k % 3]},
                          {"in", "INT.R" + pad(k)},
                          {"pt", 2000},
                          {"q", "LOGIC.T" + pad(k) + ".Q"},
                          {"et", "LOGIC.T" + pad(k) + ".ET"}});
    for (int k = 1; k <= 100; ++k)
        counters.push_back({{"id", "c" + pad(k)},
                            {"up", "INT.R" + pad(k + 100)},
                            {"preset", 100},
                            {"value", "LOGIC.C" + pad(k) + ".VALUE"},
                            {"reached", "LOGIC.C" + pad(k) + ".REACHED"}});
    for (int k = 1; k <= 50; ++k)
        totalizers.push_back({{"id", "z" + pad(k)},
                              {"source", sim(k)},
                              {"rateUnit", "h"},
                              {"total", "LOGIC.Z" + pad(k) + ".TOTAL"},
                              {"gapSeconds", "LOGIC.Z" + pad(k) + ".GAP"}});
    for (int k = 1; k <= 50; ++k)
        runhours.push_back({{"id", "h" + pad(k)},
                            {"run", "INT.R" + pad(k + 50)},
                            {"hours", "LOGIC.H" + pad(k) + ".HOURS"},
                            {"starts", "LOGIC.H" + pad(k) + ".STARTS"}});
    for (int k = 1; k <= 50; ++k)
        schedules.push_back(
            {{"id", "s" + pad(k)},
             {"weekly",
              json::array({{{"days", {1, 2, 3, 4, 5}}, {"from", "06:00"}, {"to", "18:30"}}})},
             {"exceptions", json::array({{{"date", "2026-12-25"}, {"mode", "off"}}})},
             {"out", "LOGIC.S" + pad(k) + ".Q"}});
    return {{"schemaVersion", "1.0.0"}, {"rules", rules},           {"timers", timers},
            {"counters", counters},     {"totalizers", totalizers}, {"runhours", runhours},
            {"schedules", schedules}};
}

}  // namespace

TEST(LogicPerf, TheMaximumConfigurationScansWithinFiveMilliseconds) {
    TagInfoMap tags;
    for (int k = 1; k <= 100; ++k) tags[sim(k)] = tagInfo(TagType::FLOAT64);
    for (int k = 1; k <= 200; ++k)
        tags["INT.R" + pad(k)] = tagInfo(TagType::BOOL, "internal", true);
    Config c;
    auto h = makeHarness(loadDoc(), tags, c);
    h->setWall(int64_t{1791594000000}, true, 0);
    std::vector<double> ms;
    for (int s = 0; s < 3000; ++s) {  // 300 s of scans at 100 ms, the Tags changing
        for (int k = 1; k <= 100; ++k) setN(*h, sim(k), 100 + 40 * std::sin((s + 7 * k) / 50.0));
        const auto t0 = std::chrono::steady_clock::now();
        h->runTo(static_cast<int64_t>(s) * 100);
        ms.push_back(
            std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0)
                .count());
    }
    std::vector<double> sorted = ms;
    std::sort(sorted.begin(), sorted.end());
    double sum = 0;
    for (double x : ms) sum += x;
    const double mean = sum / ms.size();
    const double p99 = sorted[static_cast<size_t>(sorted.size() * 0.99)];
    const double mx = sorted.back();
    std::printf("logic scan (550 blocks): mean %.3f ms, p99 %.3f ms, max %.3f ms over %zu scans\n",
                mean, p99, mx, ms.size());
    if (const char* out = std::getenv("MAT_LOGIC_PERF_OUT")) {
        std::ofstream f(out);
        f << json{{"blocks", 550},
                  {"scans", ms.size()},
                  {"meanMs", mean},
                  {"p99Ms", p99},
                  {"maxMs", mx}}
                 .dump(2)
          << "\n";
    }
    EXPECT_LE(p99, 5.0) << "FR-095: one scan <= 5 ms at the maximum configuration";
}
