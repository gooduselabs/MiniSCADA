#include "core/tag-engine/scaling.hpp"

#include <algorithm>
#include <cmath>

#include "core/expression/expression.hpp"

namespace mat {

ScaleReadResult scaleRead(double x, const Scaling& sc, TagType tagType) {
    const double lo = std::min(sc.rawMin, sc.rawMax);
    const double hi = std::max(sc.rawMin, sc.rawMax);
    ScaleReadResult r;
    double eng;
    bool clamped = false;
    if (sc.clamp && x < lo) {
        eng = sc.rawMin < sc.rawMax ? sc.engMin : sc.engMax;
        clamped = true;
    } else if (sc.clamp && x > hi) {
        eng = sc.rawMin < sc.rawMax ? sc.engMax : sc.engMin;
        clamped = true;
    } else {
        eng = sc.engMin + ((x - sc.rawMin) * (sc.engMax - sc.engMin)) / (sc.rawMax - sc.rawMin);
    }
    if (tagType == TagType::FLOAT32) eng = static_cast<double>(static_cast<float>(eng));
    if (eng == 0) eng = 0;  // -0 becomes 0
    r.value = eng == 0 ? 0.0 : eng;
    if (clamped) {
        r.quality = Quality::UNCERTAIN;
        r.reason = "CLAMPED";
    }
    return r;
}

ScaleWriteResult scaleWrite(double eng, const Scaling& sc, TagType rawType) {
    ScaleWriteResult out;
    if (!std::isfinite(eng)) {
        out.error = "NOT_FINITE";
        return out;
    }
    double x = sc.rawMin + ((eng - sc.engMin) * (sc.rawMax - sc.rawMin)) / (sc.engMax - sc.engMin);
    if (!std::isfinite(x)) {
        out.error = "OUT_OF_RAW_RANGE";
        return out;
    }
    if (rawType == TagType::FLOAT32) {
        const float f = static_cast<float>(x);
        if (!std::isfinite(f)) {
            out.error = "OUT_OF_RAW_RANGE";
            return out;
        }
        out.ok = true;
        out.raw = f == 0 ? 0.0 : static_cast<double>(f);
        return out;
    }
    if (rawType == TagType::FLOAT64) {
        out.ok = true;
        out.raw = x == 0 ? 0.0 : x;
        return out;
    }
    // Integer raw type: rounded value against the exact range of the type.
    const expr::Assigned a = expr::assignNumber(rawType, x);
    if (!a.ok) {
        out.error = "OUT_OF_RAW_RANGE";
        return out;
    }
    out.ok = true;
    out.raw = a.value;
    return out;
}

}  // namespace mat
