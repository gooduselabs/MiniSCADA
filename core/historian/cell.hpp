// One value of a wide log row (specs/003-data-logging data-model §2). monostate = empty (NULL):
// bad quality, NaN or infinity. UINT64 above INT64_MAX is stored as decimal TEXT in SQLite.
#pragma once
#include <cfloat>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <variant>
#include <vector>

namespace mat {

using Cell = std::variant<std::monostate, bool, int64_t, uint64_t, double, std::string>;

// Shortest decimal text that reads back to the same double (65.2, not 65.200000000000003).
inline std::string shortestDouble(double d) {
    char buf[40];
    for (int precision : {15, 16, 17}) {
        std::snprintf(buf, sizeof buf, "%.*g", precision, d);
        if (std::strtod(buf, nullptr) == d) break;
    }
    return buf;
}

// FLOAT32 columns: the shortest text of the value as a float, so that 65.2f stored as the double
// 65.19999694824219 is written 65.2. Values outside the float range keep the double text.
inline std::string shortestFloat(double d) {
    if (!std::isfinite(d) || std::fabs(d) > FLT_MAX) return shortestDouble(d);
    const float f = static_cast<float>(d);
    char buf[40];
    for (int precision : {6, 7, 8, 9}) {
        std::snprintf(buf, sizeof buf, "%.*g", precision, static_cast<double>(f));
        if (std::strtof(buf, nullptr) == f) break;
    }
    return buf;
}

}  // namespace mat
