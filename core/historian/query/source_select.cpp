#include "core/historian/query/source_select.hpp"

namespace mat {

const char* sourceResName(SourceRes r) {
    switch (r) {
        case SourceRes::Minute:
            return "1m";
        case SourceRes::Hour:
            return "1h";
        default:
            return "raw";
    }
}

SourceChoice chooseSource(const SourceInput& in) {
    SourceChoice c;
    c.reduce = in.reduce;
    // An explicit resolution is taken as asked, or refused.
    if (in.res == ResParam::Minute || in.res == ResParam::Hour) {
        if (!in.groupHasAggregates) {
            c.error = "NO_AGGREGATES";
            return c;
        }
        c.res = in.res == ResParam::Minute ? SourceRes::Minute : SourceRes::Hour;
        return c;
    }
    if (in.res == ResParam::Raw) {
        c.res = SourceRes::Raw;
        if (in.scanBytes > in.scanLimitBytes) c.error = "SCAN_LIMIT";
        return c;
    }
    // auto: w is the length of the window one reduced point stands for
    const int64_t half = in.maxPoints / 2 > 0 ? in.maxPoints / 2 : 1;
    const int64_t w = (in.to - in.from) / half;
    if (in.groupHasAggregates) {
        if (w >= 3600000 && in.hourCoverage >= kMinCoverage) {
            c.res = SourceRes::Hour;
            return c;
        }
        if (w >= 60000 && in.minuteCoverage >= kMinCoverage) {
            c.res = SourceRes::Minute;
            return c;
        }
    }
    if (in.scanBytes <= in.scanLimitBytes) {
        c.res = SourceRes::Raw;
        return c;
    }
    if (in.groupHasAggregates) {  // too much raw to scan: the aggregates, whatever their coverage
        c.res = in.minuteCoverage > 0 || in.hourCoverage <= 0 ? SourceRes::Minute : SourceRes::Hour;
        return c;
    }
    c.res = SourceRes::Raw;
    c.reduce = ReduceParam::Decimate;
    c.approximate = true;
    return c;
}

}  // namespace mat
