#include "drivers/sdk/scheduler.hpp"

#include <algorithm>

namespace mat::drv {

namespace {
constexpr int64_t kWindowMs = 60000;
}

void Scheduler::addRound(uint32_t device, int group, int64_t periodMs, size_t blocks) {
    Round r;
    r.device = device;
    r.group = group;
    r.periodMs = periodMs;
    r.blocks = blocks;
    rounds_.push_back(std::move(r));
}

void Scheduler::start(int64_t nowMs) {
    for (Round& r : rounds_) {
        r.t0 = nowMs;
        r.k = 0;
        r.nextBlock = 0;
        r.running = false;
        r.lastStart = -1;
    }
    lastEnd_ = INT64_MIN / 2;
}

Scheduler::Round* Scheduler::find(uint32_t device, int group) {
    for (Round& r : rounds_)
        if (r.device == device && r.group == group) return &r;
    return nullptr;
}

const Scheduler::Round* Scheduler::find(uint32_t device, int group) const {
    for (const Round& r : rounds_)
        if (r.device == device && r.group == group) return &r;
    return nullptr;
}

Scheduler::Suspended& Scheduler::susp(uint32_t device) {
    if (suspended_.size() <= device) suspended_.resize(device + 1);
    return suspended_[device];
}

void Scheduler::setSuspended(uint32_t device, bool suspended, int64_t nowMs) {
    Suspended& s = susp(device);
    if (s.on == suspended) return;
    s.on = suspended;
    if (suspended) {
        s.nextProbe = nowMs + kProbeEveryMs;
        for (Round& r : rounds_)
            if (r.device == device) {
                r.running = false;
                r.nextBlock = 0;
            }
    } else {
        for (Round& r : rounds_)
            if (r.device == device) {  // start again from now, no catching up
                r.t0 = nowMs;
                r.k = 0;
                r.running = false;
                r.nextBlock = 0;
            }
    }
}

void Scheduler::setBlocks(uint32_t device, int group, size_t blocks) {
    if (Round* r = find(device, group)) {
        r->blocks = blocks;
        if (r->nextBlock >= blocks) r->nextBlock = 0;
    }
}

std::optional<Scheduler::Job> Scheduler::next(int64_t nowMs, bool writePending,
                                              int64_t* waitUntilMs) {
    if (waitUntilMs) *waitUntilMs = -1;
    const int64_t earliest = lastEnd_ + gapMs_;
    if (nowMs < earliest) {
        if (waitUntilMs) *waitUntilMs = earliest;
        return std::nullopt;
    }
    if (writePending) {
        Job j;
        j.kind = Kind::Write;
        j.dueMs = nowMs;
        return j;
    }
    // the read with the earliest deadline: a running or due round, or a probe that is due
    const Round* best = nullptr;
    int64_t bestDue = 0;
    for (const Round& r : rounds_) {
        if (r.device < suspended_.size() && suspended_[r.device].on) continue;
        if (r.blocks == 0) continue;
        if (!r.running && r.dueMs() > nowMs) continue;
        if (!best || r.dueMs() < bestDue) {
            best = &r;
            bestDue = r.dueMs();
        }
    }
    int probeDevice = -1;
    int64_t probeDue = 0;
    if (!probeRunning_) {
        for (uint32_t d = 0; d < suspended_.size(); ++d) {
            if (!suspended_[d].on || suspended_[d].nextProbe > nowMs) continue;
            if (probeDevice < 0 || suspended_[d].nextProbe < probeDue) {
                probeDevice = static_cast<int>(d);
                probeDue = suspended_[d].nextProbe;
            }
        }
    }
    if (probeDevice >= 0 && (!best || probeDue < bestDue)) {
        // the first block of the normal group, else of the first group of the device
        const Round* pr = find(static_cast<uint32_t>(probeDevice), 1);
        if (!pr || pr->blocks == 0)
            for (const Round& r : rounds_)
                if (r.device == static_cast<uint32_t>(probeDevice) && r.blocks > 0) {
                    pr = &r;
                    break;
                }
        if (pr) {
            probeRunning_ = true;
            Job j;
            j.kind = Kind::Probe;
            j.device = pr->device;
            j.group = pr->group;
            j.block = 0;
            j.dueMs = probeDue;
            return j;
        }
        suspended_[static_cast<size_t>(probeDevice)].nextProbe =
            nowMs + kProbeEveryMs;  // nothing to ask
    }
    if (best) {
        Round* r = find(best->device, best->group);
        Job j;
        j.kind = Kind::Read;
        j.device = r->device;
        j.group = r->group;
        j.block = r->nextBlock;
        j.dueMs = r->dueMs();
        if (!r->running) {
            r->running = true;
            if (r->lastStart >= 0) {
                r->intervals.emplace_back(nowMs, nowMs - r->lastStart);
                prune(*r, nowMs);
            }
            r->lastStart = nowMs;
        }
        return j;
    }
    if (waitUntilMs) {
        int64_t w = -1;
        for (const Round& r : rounds_) {
            if (r.device < suspended_.size() && suspended_[r.device].on) continue;
            if (r.blocks == 0) continue;
            if (w < 0 || r.dueMs() < w) w = r.dueMs();
        }
        for (const Suspended& s : suspended_)
            if (s.on && (w < 0 || s.nextProbe < w)) w = s.nextProbe;
        *waitUntilMs = std::max(w, earliest);
        if (w < 0) *waitUntilMs = -1;
    }
    return std::nullopt;
}

void Scheduler::complete(const Job& job, int64_t nowMs) {
    lastEnd_ = nowMs;
    if (job.kind == Kind::Write) return;
    if (job.kind == Kind::Probe) {
        probeRunning_ = false;
        susp(job.device).nextProbe = nowMs + kProbeEveryMs;
        return;
    }
    Round* r = find(job.device, job.group);
    if (!r || !r->running) return;
    ++r->nextBlock;
    if (r->nextBlock < r->blocks) return;
    r->running = false;
    r->nextBlock = 0;
    ++r->k;
    // A round late by more than one period is not made up.
    while (nowMs - r->dueMs() > r->periodMs) {
        ++r->k;
        ++r->overruns;
    }
}

void Scheduler::prune(Round& r, int64_t nowMs) const {
    while (!r.intervals.empty() && nowMs - r.intervals.front().first >= kWindowMs)
        r.intervals.pop_front();
}

Scheduler::GroupStats Scheduler::stats(uint32_t device, int group, int64_t nowMs) const {
    GroupStats s;
    const Round* r = find(device, group);
    if (!r) return s;
    s.periodMs = r->periodMs;
    s.overruns = r->overruns;
    double sum = 0;
    size_t n = 0;
    for (const auto& iv : r->intervals) {
        if (nowMs - iv.first >= kWindowMs) continue;
        sum += static_cast<double>(iv.second);
        s.actualMaxMs = std::max(s.actualMaxMs, iv.second);
        ++n;
    }
    if (n > 0) s.actualAvgMs = sum / static_cast<double>(n);
    s.overloaded = n > 0 && s.actualAvgMs > 1.1 * static_cast<double>(r->periodMs);
    return s;
}

}  // namespace mat::drv
