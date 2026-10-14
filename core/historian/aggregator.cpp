#include "core/historian/aggregator.hpp"

#include <algorithm>

namespace mat {

namespace {
int64_t floorTo(int64_t t, int64_t res) {
    int64_t r = t % res;
    if (r < 0) r += res;
    return t - r;
}
}  // namespace

// ---------------------------------------------------------------- SignalAccumulator

void SignalAccumulator::openWindow(int64_t b) {
    haveWindow_ = true;
    winStart_ = b;
    cur_ = AggBucket{};
    hasMinMax_ = false;
    firstSet_ = false;
    if (held_) {  // the signal carried over from the window before
        cur_.first = *held_;
        firstSet_ = true;
    }
}

void SignalAccumulator::closeWindow(std::vector<AggBucket>& closed,
                                    std::vector<int64_t>& closedStart) {
    if (haveWindow_ && !cur_.empty()) {
        closed.push_back(cur_);
        closedStart.push_back(winStart_);
    }
    haveWindow_ = false;
}

void SignalAccumulator::addValue(double v) {
    if (!hasMinMax_) {
        cur_.min = cur_.max = v;
        hasMinMax_ = true;
    } else {
        cur_.min = std::min(cur_.min, v);
        cur_.max = std::max(cur_.max, v);
    }
}

void SignalAccumulator::addSegment(int64_t from, int64_t to) {
    if (!held_ || to <= from) return;
    addValue(*held_);
    cur_.sumw += *held_ * static_cast<double>(to - from);
    cur_.wms += to - from;
    cur_.last = *held_;
}

void SignalAccumulator::advance(int64_t t, std::vector<AggBucket>& closed,
                                std::vector<int64_t>& closedStart) {
    if (t < lastT_) return;  // never go back
    lastT_ = t;
    if (held_) {
        int64_t cursor = since_;
        while (cursor < t) {
            if (!haveWindow_) openWindow(floorTo(cursor, kAggMinuteMs));
            const int64_t winEnd = winStart_ + kAggMinuteMs;
            const int64_t end = std::min(t, winEnd);
            addSegment(cursor, end);
            cursor = end;
            if (cursor >= winEnd) closeWindow(closed, closedStart);
        }
        since_ = std::max(since_, t);
    }
    if (haveWindow_ && t >= winStart_ + kAggMinuteMs) closeWindow(closed, closedStart);
}

void SignalAccumulator::row(int64_t t, std::optional<double> v, std::vector<AggBucket>& closed,
                            std::vector<int64_t>& closedStart) {
    advance(t, closed, closedStart);
    if (t < lastT_) return;
    if (!haveWindow_) openWindow(floorTo(t, kAggMinuteMs));
    if (v) {
        ++cur_.n;
        addValue(*v);
        if (!firstSet_) {
            cur_.first = *v;
            firstSet_ = true;
        }
        cur_.last = *v;
        held_ = v;
        since_ = t;
    } else {
        held_.reset();
    }
}

void SignalAccumulator::seed(int64_t t, double v) {
    held_ = v;
    since_ = t;
    if (t > lastT_) lastT_ = t;
}

void SignalAccumulator::breakSignal(int64_t t, std::vector<AggBucket>& closed,
                                    std::vector<int64_t>& closedStart) {
    advance(t, closed, closedStart);
    held_.reset();
    closeWindow(closed, closedStart);
    lastT_ = INT64_MIN;  // after a break the clock may be a new one (jump back)
}

// ---------------------------------------------------------------- GroupAggregator

void GroupAggregator::flushHour(size_t col) {
    Hour& h = hours_[col];
    if (!h.open) return;
    if (!h.agg.empty()) out_.push_back({col, kAggHourMs, h.start, h.agg});
    h.open = false;
}

void GroupAggregator::collect(size_t col) {
    for (size_t i = 0; i < tmpB_.size(); ++i) {
        const int64_t b = tmpS_[i];
        out_.push_back({col, kAggMinuteMs, b, tmpB_[i]});
        Hour& h = hours_[col];
        const int64_t hs = floorTo(b, kAggHourMs);
        if (h.open && h.start != hs) flushHour(col);
        if (!h.open) {
            h.open = true;
            h.start = hs;
            h.agg = AggBucket{};
        }
        h.agg = mergeBuckets(h.agg, tmpB_[i]);
        if (b + kAggMinuteMs >= hs + kAggHourMs) flushHour(col);  // last minute of the hour
    }
    tmpB_.clear();
    tmpS_.clear();
}

void GroupAggregator::row(int64_t t, const std::vector<std::optional<double>>& values) {
    for (size_t i = 0; i < cols_.size(); ++i) {
        cols_[i].row(t, i < values.size() ? values[i] : std::nullopt, tmpB_, tmpS_);
        collect(i);
    }
}

void GroupAggregator::advance(int64_t t) {
    for (size_t i = 0; i < cols_.size(); ++i) {
        cols_[i].advance(t, tmpB_, tmpS_);
        collect(i);
        if (hours_[i].open && t >= hours_[i].start + kAggHourMs) flushHour(i);
    }
}

void GroupAggregator::breakAll(int64_t t) {
    for (size_t i = 0; i < cols_.size(); ++i) {
        cols_[i].breakSignal(t, tmpB_, tmpS_);
        collect(i);
        if (hours_[i].open && t >= hours_[i].start + kAggHourMs) flushHour(i);
    }
}

void GroupAggregator::seedHour(size_t col, int64_t hourStart, const AggBucket& merged) {
    if (col >= hours_.size()) return;
    Hour& h = hours_[col];
    h.open = true;
    h.start = hourStart;
    h.agg = merged;
}

void GroupAggregator::drain(std::vector<AggOut>& out) {
    out.insert(out.end(), out_.begin(), out_.end());
    out_.clear();
}

}  // namespace mat
