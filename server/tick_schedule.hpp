// The wake-ups of the tick loop of mat-runtime (feature 011 T148; FR-076; contracts/logic-engine.md
// §8): the live deltas go out every `deltaPeriodMs` (hub.tick, the alarm round, the maintenance
// of the loop), and when the project runs logic the Tag Engine round also runs at every multiple of
// `logic.scanMs`, so that logic scans on its own period and not on the period of the deltas (before
// T148: a scanMs of 100 under a deltaPeriodMs of 250 scanned every 250 ms and counted an overrun
// at every scan). A wake that is both runs one Tag Engine round, then the deltas.
//
// Times are ms from the start of the loop; the deadlines never drift (each is the previous one
// plus its period, a late wake does not move the next ones).
#pragma once
#include <algorithm>
#include <cstdint>

namespace mat {

class TickSchedule {
   public:
    struct Wake {
        int64_t atMs = 0;    // from the start of the loop
        bool delta = false;  // the live deltas (and everything else of the loop) are due
    };
    // `logicMs` 0: no logic, the loop wakes every deltaMs only.
    TickSchedule(int deltaMs, int logicMs)
        : deltaMs_(std::max(1, deltaMs)),
          logicMs_(std::max(0, logicMs)),
          nextDelta_(deltaMs_),
          nextLogic_(logicMs_ > 0 ? logicMs_ : INT64_MAX) {}

    Wake next() {
        Wake w;
        w.atMs = std::min(nextDelta_, nextLogic_);
        w.delta = nextDelta_ == w.atMs;
        if (nextDelta_ == w.atMs) nextDelta_ += deltaMs_;
        if (nextLogic_ == w.atMs) nextLogic_ += logicMs_;
        return w;
    }

   private:
    int64_t deltaMs_;
    int64_t logicMs_;
    int64_t nextDelta_;
    int64_t nextLogic_;
};

}  // namespace mat
