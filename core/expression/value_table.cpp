// Value tables (contract value-tables-simulation §1): overlap rule, ranges, text length and lookup.
#include <algorithm>
#include <cmath>
#include <limits>

#include "core/expression/expression.hpp"

namespace mat::expr {

namespace {

struct Norm {
    double from = 0, to = 0;
    bool point = false;  // true: the point {from}; false: the half-open range [from, to)
};

Norm normEntry(const VtEntry& e) {
    if (e.value) return {*e.value, *e.value, true};
    constexpr double inf = std::numeric_limits<double>::infinity();
    return {e.from ? *e.from : -inf, e.to ? *e.to : inf, false};
}

bool overlap(const Norm& a, const Norm& b) {
    if (a.point && b.point) return a.from == b.from;
    if (a.point) return b.from <= a.from && a.from < b.to;
    if (b.point) return a.from <= b.from && b.from < a.to;
    return std::max(a.from, b.from) < std::min(a.to, b.to);
}

size_t cpCount(const std::string& s) {
    size_t n = 0;
    for (unsigned char c : s)
        if ((c & 0xC0) != 0x80) ++n;
    return n;
}

}  // namespace

std::vector<VtIssue> validateValueTable(const ValueTable& t) {
    std::vector<VtIssue> issues;
    std::vector<std::optional<Norm>> norm;
    for (size_t i = 0; i < t.entries.size(); ++i) {
        const VtEntry& e = t.entries[i];
        const bool hasValue = e.value.has_value();
        const bool hasRange = e.from.has_value() || e.to.has_value();
        const int idx = static_cast<int>(i);
        if (hasValue == hasRange) {
            issues.push_back({"E_SCHEMA", "entry needs value or from/to", idx});
            norm.push_back(std::nullopt);
            continue;
        }
        const Norm n = normEntry(e);
        if (!n.point && !(n.from < n.to)) {
            issues.push_back({"E_VT_RANGE", "empty range (from >= to)", idx});
            norm.push_back(std::nullopt);
        } else {
            norm.push_back(n);
        }
        if (cpCount(e.text) > kVtMaxText)
            issues.push_back({"E_VT_TEXT", "text longer than 64 characters", idx});
    }
    if (t.defaultText && cpCount(*t.defaultText) > kVtMaxText)
        issues.push_back({"E_VT_TEXT", "default text longer than 64 characters", -1});
    for (size_t j = 1; j < norm.size(); ++j) {
        if (!norm[j]) continue;
        for (size_t i = 0; i < j; ++i) {
            if (norm[i] && overlap(*norm[i], *norm[j])) {
                issues.push_back(
                    {"E_VT_OVERLAP",
                     "entry " + std::to_string(j) + " overlaps entry " + std::to_string(i),
                     static_cast<int>(j)});
                break;
            }
        }
    }
    return issues;
}

LookupResult lookupValueTable(const ValueTable& t, double v) {
    if (!std::isnan(v)) {
        for (size_t i = 0; i < t.entries.size(); ++i) {
            const VtEntry& e = t.entries[i];
            bool hit;
            if (e.value)
                hit = v == *e.value;
            else
                hit = (!e.from || v >= *e.from) && (!e.to || v < *e.to);
            if (hit) {
                LookupResult r;
                r.text = e.text;
                r.color = e.color;
                r.entry = static_cast<int>(i);
                return r;
            }
        }
    }
    LookupResult r;
    if (t.hasDefault) {
        r.text = t.defaultText ? *t.defaultText : std::string();
        r.color = t.defaultColor;
        r.entry = kEntryDefault;
    }
    return r;
}

}  // namespace mat::expr
