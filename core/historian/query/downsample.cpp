#include "core/historian/query/downsample.hpp"

#include <algorithm>
#include <cmath>
#include <map>

namespace mat {

int64_t windowOf(int64_t t, int64_t from, int64_t to, int64_t w) {
    if (to <= from || w <= 0) return 0;
    const __int128 k = static_cast<__int128>(t - from) * w / (to - from);
    if (k < 0) return 0;
    if (k >= w) return w - 1;
    return static_cast<int64_t>(k);
}

// ---------------------------------------------------------------- minmax

MinMaxReducer::MinMaxReducer(int64_t from, int64_t to, int maxPoints)
    : from_(from), to_(to), maxPoints_(std::max(maxPoints, 4)) {
    windows_ = std::max<int64_t>(1, (maxPoints_ - 2) / 2);
    w_.resize(static_cast<size_t>(windows_));
}

void MinMaxReducer::add(int64_t t, std::optional<double> v) {
    const int64_t idx = count_++;
    if (first_.idx < 0) first_ = {idx, t, v};
    last_ = {idx, t, v};
    if (count_ <= maxPoints_) {
        all_.push_back({t, v});
    } else if (!all_.empty()) {
        all_.clear();
        all_.shrink_to_fit();
    }
    Window& w = w_[static_cast<size_t>(windowOf(t, from_, to_, windows_))];
    if (!v) {
        if (w.null.idx < 0) w.null = {idx, t, v};
        return;
    }
    if (w.min.idx < 0 || *v < *w.min.v) w.min = {idx, t, v};
    if (w.max.idx < 0 || *v > *w.max.v) w.max = {idx, t, v};
}

std::vector<SeriesPoint> MinMaxReducer::finish() {
    if (count_ <= maxPoints_) return all_;
    std::map<int64_t, Pick> sel;  // by row index = time order
    sel[first_.idx] = first_;
    sel[last_.idx] = last_;
    for (const auto& w : w_)
        for (const Pick* p : {&w.min, &w.max, &w.null})
            if (p->idx >= 0) sel[p->idx] = *p;
    // Over budget because of NULL points: drop them from the last window back; the first and the
    // last row of the range stay.
    for (auto it = w_.rbegin(); it != w_.rend() && static_cast<int64_t>(sel.size()) > maxPoints_;
         ++it) {
        if (it->null.idx >= 0 && it->null.idx != first_.idx && it->null.idx != last_.idx)
            sel.erase(it->null.idx);
    }
    std::vector<SeriesPoint> out;
    out.reserve(sel.size());
    for (const auto& kv : sel) out.push_back({kv.second.t, kv.second.v});
    return out;
}

std::vector<SeriesPoint> reduceMinMax(const std::vector<SeriesPoint>& rows, int64_t from,
                                      int64_t to, int maxPoints) {
    MinMaxReducer r(from, to, maxPoints);
    for (const auto& p : rows) r.add(p.t, p.v);
    return r.finish();
}

// ---------------------------------------------------------------- decimate

std::vector<SeriesPoint> reduceDecimate(const std::vector<SeriesPoint>& rows, int64_t from,
                                        int64_t to, int maxPoints) {
    std::vector<SeriesPoint> out;
    if (maxPoints <= 0 || to <= from) return out;
    size_t p = 0;
    auto bound = [&](int64_t k) {
        return from + static_cast<int64_t>(static_cast<__int128>(k) * (to - from) / maxPoints);
    };
    for (int64_t k = 0; k < maxPoints; ++k) {
        const int64_t lo = bound(k);
        const int64_t hi = bound(k + 1);
        while (p < rows.size() && rows[p].t < lo) ++p;
        if (p < rows.size() && rows[p].t < hi) out.push_back(rows[p]);
    }
    return out;
}

// ---------------------------------------------------------------- lttb

namespace {

// Steinarsson 2013, the reference implementation: first and last point kept, `threshold` points.
std::vector<SeriesPoint> lttbRun(const std::vector<SeriesPoint>& d, int threshold) {
    const size_t n = d.size();
    if (threshold >= static_cast<int>(n) || threshold < 3) {
        if (threshold == 2 && n > 2) return {d.front(), d.back()};
        return d;
    }
    std::vector<SeriesPoint> out;
    out.reserve(static_cast<size_t>(threshold));
    out.push_back(d[0]);
    const double every = static_cast<double>(n - 2) / static_cast<double>(threshold - 2);
    size_t a = 0;
    for (int i = 0; i < threshold - 2; ++i) {
        size_t avgStart = static_cast<size_t>(std::floor((i + 1) * every)) + 1;
        size_t avgEnd = static_cast<size_t>(std::floor((i + 2) * every)) + 1;
        if (avgEnd > n) avgEnd = n;
        double avgX = 0;
        double avgY = 0;
        const size_t avgLen = avgEnd - avgStart;
        for (size_t j = avgStart; j < avgEnd; ++j) {
            avgX += static_cast<double>(d[j].t);
            avgY += *d[j].v;
        }
        if (avgLen > 0) {
            avgX /= static_cast<double>(avgLen);
            avgY /= static_cast<double>(avgLen);
        }
        const size_t from = static_cast<size_t>(std::floor(i * every)) + 1;
        const size_t to = static_cast<size_t>(std::floor((i + 1) * every)) + 1;
        const double ax = static_cast<double>(d[a].t);
        const double ay = *d[a].v;
        double maxArea = -1;
        size_t next = from;
        for (size_t j = from; j < to; ++j) {
            const double area = std::fabs((ax - avgX) * (*d[j].v - ay) -
                                          (ax - static_cast<double>(d[j].t)) * (avgY - ay)) *
                                0.5;
            if (area > maxArea) {
                maxArea = area;
                next = j;
            }
        }
        out.push_back(d[next]);
        a = next;
    }
    out.push_back(d[n - 1]);
    return out;
}

}  // namespace

std::vector<SeriesPoint> reduceLttb(const std::vector<SeriesPoint>& points, int threshold) {
    if (threshold >= static_cast<int>(points.size())) return points;
    bool anyNull = false;
    for (const auto& p : points)
        if (!p.v) anyNull = true;
    if (!anyNull) return lttbRun(points, threshold);
    // Runs of values between NULLs: each is reduced alone, in proportion to its length (at least 2
    // points); the first NULL of every null run is kept.
    std::vector<std::vector<SeriesPoint>> segs;
    std::vector<SeriesPoint> nulls;  // nulls[i] sits after segs[i]
    std::vector<SeriesPoint> cur;
    bool leadingNull = false;
    for (size_t i = 0; i < points.size(); ++i) {
        if (points[i].v) {
            cur.push_back(points[i]);
            continue;
        }
        if (!cur.empty()) {
            segs.push_back(std::move(cur));
            cur.clear();
            nulls.push_back(points[i]);
        } else if (segs.empty() && i == 0) {
            leadingNull = true;
            nulls.push_back(points[i]);
        } else if (i > 0 && points[i - 1].v) {
            nulls.push_back(points[i]);
        }
    }
    if (!cur.empty()) segs.push_back(std::move(cur));
    int64_t valueCount = 0;
    for (const auto& s : segs) valueCount += static_cast<int64_t>(s.size());
    const int64_t budget = std::max<int64_t>(threshold - static_cast<int64_t>(nulls.size()), 0);
    std::vector<SeriesPoint> out;
    size_t ni = 0;
    if (leadingNull) out.push_back(nulls[ni++]);
    for (size_t s = 0; s < segs.size(); ++s) {
        const auto share = static_cast<int>(std::max<int64_t>(
            2, valueCount > 0 ? budget * static_cast<int64_t>(segs[s].size()) / valueCount : 2));
        const auto part = lttbRun(segs[s], share);
        out.insert(out.end(), part.begin(), part.end());
        if (ni < nulls.size()) out.push_back(nulls[ni++]);
    }
    return out;
}

// ---------------------------------------------------------------- merge

std::vector<MergedPoint> reduceMerge(const std::vector<BucketRow>& rows, int64_t from, int64_t to,
                                     int64_t res, int maxPoints) {
    std::vector<MergedPoint> out;
    if (res <= 0 || maxPoints <= 0 || to <= from) return out;
    auto floorDiv = [](int64_t a, int64_t b) {
        int64_t q = a / b;
        if ((a % b != 0) && ((a < 0) != (b < 0))) --q;
        return q;
    };
    const int64_t s0 = floorDiv(from, res);
    const int64_t s1 = floorDiv(to - 1, res);
    const int64_t cells = s1 - s0 + 1;
    const int64_t g = cells <= maxPoints ? 1 : (cells + maxPoints - 1) / maxPoints;
    int64_t curGroup = -1;
    AggBucket acc;
    auto flush = [&] {
        if (curGroup < 0 || acc.empty()) return;
        MergedPoint p;
        p.t = cells <= maxPoints ? 0 : (s0 + curGroup * g) * res;
        p.v = *aggAvg(acc);
        p.min = acc.min;
        p.max = acc.max;
        out.push_back(p);
    };
    for (const auto& r : rows) {
        if (r.agg.empty()) continue;
        const int64_t group = cells <= maxPoints ? floorDiv(r.bucket, res) : (floorDiv(r.bucket, res) - s0) / g;
        if (group != curGroup) {
            flush();
            curGroup = group;
            acc = AggBucket{};
        }
        acc = mergeBuckets(acc, r.agg);
        if (cells <= maxPoints) {  // one point per cell, at the cell start
            MergedPoint p;
            p.t = r.bucket;
            p.v = *aggAvg(r.agg);
            p.min = r.agg.min;
            p.max = r.agg.max;
            out.push_back(p);
            curGroup = -1;
        }
    }
    if (cells > maxPoints) flush();
    return out;
}

}  // namespace mat
