// The wake-ups of the tick loop (feature 011 T148; server/tick_schedule.hpp): logic scans on its
// own period, the live deltas keep theirs.
#include "server/tick_schedule.hpp"

#include <gtest/gtest.h>

#include <vector>

using namespace mat;

namespace {

struct W {
    int64_t at;
    bool delta;
    bool operator==(const W& o) const { return at == o.at && delta == o.delta; }
};

std::vector<W> wakes(TickSchedule s, int64_t until) {
    std::vector<W> out;
    for (;;) {
        const TickSchedule::Wake w = s.next();
        if (w.atMs > until) return out;
        out.push_back({w.atMs, w.delta});
    }
}

}  // namespace

TEST(TickSchedule, WithoutLogicTheLoopWakesAtTheDeltaPeriodOnly) {
    const auto w = wakes(TickSchedule(250, 0), 1000);
    EXPECT_EQ(w, (std::vector<W>{{250, true}, {500, true}, {750, true}, {1000, true}}));
}

TEST(TickSchedule, LogicFasterThanTheDeltasScansOnItsOwnPeriod) {
    // logic.scanMs 100 under deltaPeriodMs 250 (the BL335 of T148): a round every 100 ms, the
    // deltas still every 250 ms
    const auto w = wakes(TickSchedule(250, 100), 1000);
    EXPECT_EQ(w, (std::vector<W>{{100, false},
                                 {200, false},
                                 {250, true},
                                 {300, false},
                                 {400, false},
                                 {500, true},
                                 {600, false},
                                 {700, false},
                                 {750, true},
                                 {800, false},
                                 {900, false},
                                 {1000, true}}));
}

TEST(TickSchedule, LogicSlowerThanTheDeltasKeepsItsMultiples) {
    const auto w = wakes(TickSchedule(250, 300), 1200);
    EXPECT_EQ(w, (std::vector<W>{{250, true},
                                 {300, false},
                                 {500, true},
                                 {600, false},
                                 {750, true},
                                 {900, false},
                                 {1000, true},
                                 {1200, false}}));
}

TEST(TickSchedule, TheSamePeriodWakesOnceAtEachMultiple) {
    const auto w = wakes(TickSchedule(100, 100), 300);
    EXPECT_EQ(w, (std::vector<W>{{100, true}, {200, true}, {300, true}}));
    const auto m = wakes(TickSchedule(250, 500), 1000);
    EXPECT_EQ(m, (std::vector<W>{{250, true}, {500, true}, {750, true}, {1000, true}}));
}

TEST(TickSchedule, ScansPerSecondFollowTheLogicPeriod) {
    TickSchedule s(250, 100);
    int rounds = 0, deltas = 0;
    for (;;) {
        const auto w = s.next();
        if (w.atMs > 60000) break;
        ++rounds;
        if (w.delta) ++deltas;
    }
    EXPECT_EQ(deltas, 240);  // 4 per second
    // every multiple of 100 plus the multiples of 250 that are not (250, 750 of each 1000)
    EXPECT_EQ(rounds, 600 + 120);
}
