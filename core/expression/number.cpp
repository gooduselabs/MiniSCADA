// Shared arithmetic (contract expression-language §3, §4). No std::round: half away from zero.
#include <cmath>
#include <limits>

#include "core/expression/expression.hpp"

namespace mat::expr {

double roundHalfAway(double x) {
    const double r = std::trunc(x);
    if (std::fabs(x - r) >= 0.5) return r + (x > 0 ? 1.0 : -1.0);
    return r;
}

namespace {
Assigned fail(const char* reason) {
    Assigned a;
    a.reason = reason;
    return a;
}
Assigned good(TagScalar v) {
    Assigned a;
    a.ok = true;
    a.value = std::move(v);
    return a;
}
}  // namespace

Assigned assignNumber(TagType target, double x) {
    if (std::isnan(x)) return fail("NOT_A_NUMBER");
    if (std::isinf(x)) return fail("OVERFLOW");
    switch (target) {
        case TagType::FLOAT64:
            return good(x == 0 ? 0.0 : x);
        case TagType::FLOAT32: {
            const float f = static_cast<float>(x);
            if (!std::isfinite(f)) return fail("OVERFLOW");
            return good(f == 0 ? 0.0 : static_cast<double>(f));
        }
        case TagType::BOOL:
        case TagType::STRING:
            return fail("E_EXPR_TYPE");  // the checker rejects it; never reached
        default:
            break;
    }
    const double r = roundHalfAway(x);
    constexpr double k2p63 = 9223372036854775808.0;
    constexpr double k2p64 = 18446744073709551616.0;
    switch (target) {
        case TagType::INT16:
            if (r < -32768.0 || r > 32767.0) return fail("OUT_OF_RANGE");
            return good(static_cast<int64_t>(r));
        case TagType::UINT16:
            if (r < 0.0 || r > 65535.0) return fail("OUT_OF_RANGE");
            return good(static_cast<uint64_t>(r));
        case TagType::INT32:
            if (r < -2147483648.0 || r > 2147483647.0) return fail("OUT_OF_RANGE");
            return good(static_cast<int64_t>(r));
        case TagType::UINT32:
            if (r < 0.0 || r > 4294967295.0) return fail("OUT_OF_RANGE");
            return good(static_cast<uint64_t>(r));
        case TagType::INT64:
            if (r < -k2p63 || r >= k2p63) return fail("OUT_OF_RANGE");
            return good(static_cast<int64_t>(r));
        default:  // UINT64
            if (r < 0.0 || r >= k2p64) return fail("OUT_OF_RANGE");
            return good(static_cast<uint64_t>(r));
    }
}

Assigned assignBool(TagType target, bool b) {
    if (target == TagType::BOOL) return good(b);
    if (target == TagType::STRING) return fail("E_EXPR_TYPE");
    return assignNumber(target, b ? 1.0 : 0.0);
}

Assigned assignString(TagType target, const std::string& s) {
    if (target != TagType::STRING) return fail("E_EXPR_TYPE");
    if (s.size() > kMaxStringBytes) return fail("OUT_OF_RANGE");
    return good(s);
}

}  // namespace mat::expr
