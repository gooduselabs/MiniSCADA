#include "core/historian/clock.hpp"

#include <cstdio>

#ifndef MAT_BUILD_EPOCH_S
#define MAT_BUILD_EPOCH_S 1767225600LL  // 2026-01-01T00:00:00Z when CMake does not provide it
#endif

namespace mat {

namespace {

constexpr int64_t kDayMs = 86400000;

int64_t floorDiv(int64_t a, int64_t b) {
    int64_t q = a / b;
    if ((a % b != 0) && ((a < 0) != (b < 0))) --q;
    return q;
}

// Proleptic Gregorian calendar <-> days since 1970-01-01 (H. Hinnant, "chrono-Compatible
// Low-Level Date Algorithms").
void civilFromDays(int64_t z, int& y, unsigned& m, unsigned& d) {
    z += 719468;
    const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    const unsigned doe = static_cast<unsigned>(z - era * 146097);
    const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const unsigned mp = (5 * doy + 2) / 153;
    d = doy - (153 * mp + 2) / 5 + 1;
    m = mp < 10 ? mp + 3 : mp - 9;
    y = static_cast<int>(static_cast<int64_t>(yoe) + era * 400 + (m <= 2 ? 1 : 0));
}

int64_t daysFromCivil(int y, unsigned m, unsigned d) {
    y -= m <= 2 ? 1 : 0;
    const int64_t era = (y >= 0 ? y : y - 399) / 400;
    const unsigned yoe = static_cast<unsigned>(y - era * 400);
    const unsigned doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1;
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + static_cast<int64_t>(doe) - 719468;
}

bool isLeap(int y) { return (y % 4 == 0 && y % 100 != 0) || y % 400 == 0; }

unsigned daysInMonth(int y, unsigned m) {
    static const unsigned kDays[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    return m == 2 && isLeap(y) ? 29 : kDays[m - 1];
}

// Reads exactly `n` decimal digits at s[pos].
bool digits(const std::string& s, size_t pos, size_t n, int& out) {
    if (pos + n > s.size()) return false;
    int v = 0;
    for (size_t i = pos; i < pos + n; ++i) {
        if (s[i] < '0' || s[i] > '9') return false;
        v = v * 10 + (s[i] - '0');
    }
    out = v;
    return true;
}

}  // namespace

std::optional<int> parseUtcOffset(const std::string& s) {
    if (s.size() != 6 || (s[0] != '+' && s[0] != '-') || s[3] != ':') return std::nullopt;
    int hh = 0, mm = 0;
    if (!digits(s, 1, 2, hh) || !digits(s, 4, 2, mm) || mm > 59) return std::nullopt;
    const int minutes = hh * 60 + mm;
    if (s[0] == '+' ? minutes > 14 * 60 : minutes > 12 * 60) return std::nullopt;
    return s[0] == '+' ? minutes : -minutes;
}

std::string formatUtcOffset(int minutes) {
    const int a = minutes < 0 ? -minutes : minutes;
    char buf[24];
    std::snprintf(buf, sizeof buf, "%c%02d:%02d", minutes < 0 ? '-' : '+', a / 60, a % 60);
    return buf;
}

std::string formatLocalTime(int64_t utcMs, int offsetMin, char sep) {
    const int64_t local = utcMs + int64_t{offsetMin} * 60000;
    const int64_t days = floorDiv(local, kDayMs);
    const int64_t ms = local - days * kDayMs;
    int y = 0;
    unsigned m = 0, d = 0;
    civilFromDays(days, y, m, d);
    char buf[32];
    std::snprintf(buf, sizeof buf, "%04d-%02u-%02u%c%02d:%02d:%02d.%03d", y, m, d, sep,
                  static_cast<int>(ms / 3600000), static_cast<int>(ms / 60000 % 60),
                  static_cast<int>(ms / 1000 % 60), static_cast<int>(ms % 1000));
    return buf;
}

std::optional<int64_t> parseLocalTime(const std::string& s, int offsetMin) {
    if (s.size() != 10 && s.size() != 16 && s.size() != 19) return std::nullopt;
    int y = 0, mo = 0, d = 0, hh = 0, mi = 0, ss = 0;
    if (!digits(s, 0, 4, y) || s[4] != '-' || !digits(s, 5, 2, mo) || s[7] != '-' ||
        !digits(s, 8, 2, d))
        return std::nullopt;
    if (s.size() >= 16 &&
        (s[10] != ' ' || !digits(s, 11, 2, hh) || s[13] != ':' || !digits(s, 14, 2, mi)))
        return std::nullopt;
    if (s.size() == 19 && (s[16] != ':' || !digits(s, 17, 2, ss))) return std::nullopt;
    if (mo < 1 || mo > 12 || d < 1 || static_cast<unsigned>(d) > daysInMonth(y, mo) || hh > 23 ||
        mi > 59 || ss > 59)
        return std::nullopt;
    const int64_t days = daysFromCivil(y, static_cast<unsigned>(mo), static_cast<unsigned>(d));
    return days * kDayMs + hh * 3600000LL + mi * 60000LL + ss * 1000LL - int64_t{offsetMin} * 60000;
}

int64_t alignedNext(int64_t nowUtc, int64_t periodMs, int offsetMin, int64_t anchorUtc) {
    if (periodMs <= 0) return nowUtc + 1;
    if (kDayMs % periodMs == 0) {
        const int64_t off = int64_t{offsetMin} * 60000;
        return (floorDiv(nowUtc + off, periodMs) + 1) * periodMs - off;
    }
    if (nowUtc < anchorUtc) return anchorUtc;
    return anchorUtc + ((nowUtc - anchorUtc) / periodMs + 1) * periodMs;
}

int64_t clockFloorMs() { return static_cast<int64_t>(MAT_BUILD_EPOCH_S) * 1000; }

bool clockValid(int64_t nowUtc) { return nowUtc >= clockFloorMs(); }

}  // namespace mat
