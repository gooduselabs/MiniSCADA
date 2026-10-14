#include "core/historian/agg_math.hpp"

#include <algorithm>

namespace mat {

AggBucket mergeBuckets(const AggBucket& a, const AggBucket& b) {
    if (a.empty()) return b;
    if (b.empty()) return a;
    AggBucket m;
    m.n = a.n + b.n;
    m.min = std::min(a.min, b.min);
    m.max = std::max(a.max, b.max);
    m.first = a.first;
    m.last = b.last;
    m.sumw = a.sumw + b.sumw;
    m.wms = a.wms + b.wms;
    return m;
}

std::optional<double> aggAvg(const AggBucket& b) {
    if (b.empty()) return std::nullopt;
    return b.wms > 0 ? b.sumw / static_cast<double>(b.wms) : b.last;
}

std::optional<double> aggSum(const AggBucket& b) {
    if (b.empty()) return std::nullopt;
    return b.sumw / 3600000.0;
}

std::optional<double> aggDelta(const AggBucket& b) {
    if (b.empty()) return std::nullopt;
    return b.last - b.first;
}

double aggCoverage(const AggBucket& b, int64_t lengthMs) {
    return lengthMs > 0 ? static_cast<double>(b.wms) / static_cast<double>(lengthMs) : 0.0;
}

}  // namespace mat
