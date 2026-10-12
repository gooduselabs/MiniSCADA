// Read schedule (FR-017; contract §5; fake clock).
#include "drivers/sdk/scheduler.hpp"

#include <gtest/gtest.h>

using namespace mat::drv;

namespace {

// Runs the scheduler against a channel whose every request takes `reqMs`; returns the jobs taken.
struct Loop {
    Scheduler s;
    int64_t now = 0;
    std::vector<Scheduler::Job> jobs;
    std::vector<int64_t> startedAt;

    // Advances time to the next job (or `until`), executes it, repeats until `until`.
    void run(int64_t until, int64_t reqMs, bool writePending = false) {
        while (now < until) {
            int64_t wait = 0;
            const auto job = s.next(now, writePending, &wait);
            if (!job) {
                if (wait < 0 || wait > until) {
                    now = until;
                    break;
                }
                now = std::max(wait, now + 1);
                continue;
            }
            jobs.push_back(*job);
            startedAt.push_back(now);
            now += reqMs;
            s.complete(*job, now);
        }
    }
};

}  // namespace

TEST(Scheduler, RoundsAreDueAtT0PlusKTimesThePeriod) {
    Loop r;
    r.s.addRound(0, 1, 1000, 1);
    r.s.start(5000);
    r.run(8500, 10);
    ASSERT_EQ(r.jobs.size(), 4u);
    EXPECT_EQ(r.startedAt[0], 5000);
    EXPECT_EQ(r.startedAt[1], 6000);
    EXPECT_EQ(r.startedAt[2], 7000);
    EXPECT_EQ(r.startedAt[3], 8000);
}

TEST(Scheduler, BlocksOfARoundRunOneAfterTheOther) {
    Loop r;
    r.s.addRound(0, 1, 1000, 3);
    r.s.start(0);
    r.run(900, 50);
    ASSERT_EQ(r.jobs.size(), 3u);
    EXPECT_EQ(r.jobs[0].block, 0u);
    EXPECT_EQ(r.jobs[1].block, 1u);
    EXPECT_EQ(r.jobs[2].block, 2u);
}

TEST(Scheduler, AWritePendingGoesFirstThenTheEarliestDeadline) {
    Scheduler s;
    s.addRound(0, 0, 250, 1);  // fast, due at 0, 250, ...
    s.addRound(0, 1, 1000, 1);
    s.start(0);
    // both due at t0: the fast group first (same due time: insertion order)
    int64_t wait;
    auto j = s.next(0, true, &wait);
    ASSERT_TRUE(j);
    EXPECT_EQ(j->kind, Scheduler::Kind::Write);
    s.complete(*j, 5);
    j = s.next(5, false, &wait);
    ASSERT_TRUE(j);
    EXPECT_EQ(j->kind, Scheduler::Kind::Read);
    EXPECT_EQ(j->group, 0);
    s.complete(*j, 10);
    j = s.next(10, false, &wait);
    ASSERT_TRUE(j);
    EXPECT_EQ(j->group, 1);
    s.complete(*j, 15);
    EXPECT_FALSE(s.next(15, false, &wait));
    EXPECT_EQ(wait, 250);  // the fast round again
}

TEST(Scheduler, EarliestDeadlineAcrossDevicesAndGroups) {
    Scheduler s;
    s.addRound(0, 2, 5000, 1);
    s.addRound(1, 0, 250, 1);
    s.start(0);
    // device 1 fast round (due 0) and device 0 slow round (due 0): tie goes to insertion order
    auto j = s.next(0, false);
    ASSERT_TRUE(j);
    EXPECT_EQ(j->device, 0u);
    s.complete(*j, 100);
    j = s.next(100, false);
    ASSERT_TRUE(j);
    EXPECT_EQ(j->device, 1u);
    s.complete(*j, 200);
    // at 250 only the fast one is due again
    EXPECT_FALSE(s.next(240, false));
    j = s.next(250, false);
    ASSERT_TRUE(j);
    EXPECT_EQ(j->device, 1u);
    EXPECT_EQ(j->dueMs, 250);
}

TEST(Scheduler, ALateRoundIsNotMadeUpAndCountsAnOverrun) {
    Loop r;
    r.s.addRound(0, 1, 1000, 1);
    r.s.start(0);
    // each request takes 2500 ms: round 0 runs 0-2500; round 1 (due 1000) is late by 1500 > period
    // and is skipped (overrun); round 2 (due 2000) is late by 500 only and starts at once
    r.run(10000, 2500);
    ASSERT_GE(r.jobs.size(), 3u);
    EXPECT_EQ(r.startedAt[0], 0);
    EXPECT_EQ(r.startedAt[1], 2500);
    EXPECT_EQ(r.jobs[1].dueMs, 2000);
    EXPECT_EQ(r.startedAt[2], 5000);
    EXPECT_GE(r.s.stats(0, 1, r.now).overruns, 2u);
}

TEST(Scheduler, ALateRoundWithinOnePeriodStartsAtOnce) {
    Loop r;
    r.s.addRound(0, 1, 1000, 1);
    r.s.start(0);
    r.run(2000, 1400);  // round 0: 0-1400, round 1 (due 1000, late 400) starts at 1400, ends 2800
    ASSERT_GE(r.jobs.size(), 2u);
    EXPECT_EQ(r.startedAt[1], 1400);
    EXPECT_EQ(r.s.stats(0, 1, r.now).overruns, 0u);
}

TEST(Scheduler, ActualPeriodIsTheTimeBetweenTwoRoundStarts) {
    Loop r;
    r.s.addRound(0, 1, 1000, 1);
    r.s.start(0);
    r.run(20500, 10);
    const auto st = r.s.stats(0, 1, r.now);
    EXPECT_EQ(st.periodMs, 1000);
    EXPECT_NEAR(st.actualAvgMs, 1000.0, 1e-9);
    EXPECT_EQ(st.actualMaxMs, 1000);
    EXPECT_FALSE(st.overloaded);
}

TEST(Scheduler, OverloadedWhenTheAverageExceeds110PercentOfThePeriod) {
    Loop r;
    r.s.addRound(0, 1, 1000, 1);
    r.s.start(0);
    r.run(60000, 1200);  // a request longer than the period: rounds start every 2000 ms (skips one)
    const auto st = r.s.stats(0, 1, r.now);
    EXPECT_GT(st.actualAvgMs, 1100.0);
    EXPECT_TRUE(st.overloaded);
    EXPECT_GT(st.overruns, 0u);
}

TEST(Scheduler, StatisticsCoverTheLast60Seconds) {
    Loop r;
    r.s.addRound(0, 1, 1000, 1);
    r.s.start(0);
    r.run(10000, 3500);  // slow phase: a round starts every 3500 ms
    EXPECT_EQ(r.s.stats(0, 1, r.now).actualMaxMs, 3500);
    r.run(100000, 10);  // fast phase: every 1000, more than 60 s long
    const auto st = r.s.stats(0, 1, r.now);
    EXPECT_EQ(st.actualMaxMs, 1000);
}

TEST(Scheduler, RequestGapDelaysTheNextRequest) {
    Scheduler s;
    s.addRound(0, 1, 1000, 2);
    s.setRequestGapMs(100);
    s.start(0);
    auto j = s.next(0, false);
    ASSERT_TRUE(j);
    s.complete(*j, 20);
    int64_t wait = 0;
    EXPECT_FALSE(s.next(50, false, &wait));
    EXPECT_EQ(wait, 120);
    j = s.next(120, false);
    ASSERT_TRUE(j);
    EXPECT_EQ(j->block, 1u);
    // a write waits for the gap too
    s.complete(*j, 130);
    EXPECT_FALSE(s.next(150, true, &wait));
    EXPECT_EQ(wait, 230);
    EXPECT_TRUE(s.next(230, true));
}

TEST(Scheduler, SuspendedDeviceIsProbedOnceEvery10SecondsOnItsFirstNormalBlock) {
    Scheduler s;
    s.addRound(0, 0, 250, 2);   // device 0 fast
    s.addRound(0, 1, 1000, 3);  // device 0 normal
    s.addRound(1, 1, 1000, 1);  // device 1 keeps its period
    s.start(0);
    s.setSuspended(0, true, 0);
    int64_t now = 0;
    std::vector<Scheduler::Job> jobs;
    std::vector<int64_t> at;
    while (now < 31000) {
        int64_t wait = 0;
        auto j = s.next(now, false, &wait);
        if (!j) {
            ASSERT_GE(wait, 0);
            now = std::max(wait, now + 1);
            continue;
        }
        jobs.push_back(*j);
        at.push_back(now);
        now += 5;
        s.complete(*j, now);
    }
    int probes = 0, dev1 = 0;
    for (size_t i = 0; i < jobs.size(); ++i) {
        if (jobs[i].kind == Scheduler::Kind::Probe) {
            ++probes;
            EXPECT_EQ(jobs[i].device, 0u);
            EXPECT_EQ(jobs[i].group, 1);
            EXPECT_EQ(jobs[i].block, 0u);
            EXPECT_GE(at[i], 10000 * probes) << "probe at " << at[i];
            EXPECT_LT(at[i], 10000 * probes + 100) << "probe at " << at[i];
        } else {
            EXPECT_EQ(jobs[i].device, 1u) << "a suspended device is never read";
            ++dev1;
        }
    }
    EXPECT_EQ(probes, 3);  // 10 s, 20 s, 30 s
    EXPECT_GE(dev1, 28);
}

TEST(Scheduler, ResumingRestartsTheRoundsWithoutCatchingUp) {
    Scheduler s;
    s.addRound(0, 1, 1000, 1);
    s.start(0);
    s.setSuspended(0, true, 0);
    s.setSuspended(0, false, 25000);
    auto j = s.next(25000, false);
    ASSERT_TRUE(j);
    EXPECT_EQ(j->kind, Scheduler::Kind::Read);
    EXPECT_EQ(j->dueMs, 25000);
    s.complete(*j, 25010);
    EXPECT_FALSE(s.next(25100, false));  // one round, not twenty-five
}

TEST(Scheduler, NothingToDoWaitsForever) {
    Scheduler s;
    s.start(0);
    int64_t wait = 0;
    EXPECT_FALSE(s.next(0, false, &wait));
    EXPECT_EQ(wait, -1);
}

TEST(Scheduler, SplitChangesTheBlockCountOfARound) {
    Scheduler s;
    s.addRound(0, 1, 1000, 1);
    s.start(0);
    s.setBlocks(0, 1, 2);
    auto j = s.next(0, false);
    ASSERT_TRUE(j);
    s.complete(*j, 10);
    j = s.next(10, false);
    ASSERT_TRUE(j);
    EXPECT_EQ(j->block, 1u);
}
