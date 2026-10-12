#include "core/common/utf8.hpp"

namespace mat {

namespace {

// Length of the valid UTF-8 sequence at s[i], or 0 when the byte there does not start one.
size_t sequenceAt(const std::string& s, size_t i) {
    auto b = [&](size_t k) { return static_cast<unsigned char>(s[i + k]); };
    const unsigned char c = b(0);
    const size_t n = c < 0x80 ? 1
                              : c >= 0xC2 && c <= 0xDF
                                    ? 2
                                    : c >= 0xE0 && c <= 0xEF ? 3 : c >= 0xF0 && c <= 0xF4 ? 4 : 0;
    if (n == 0 || i + n > s.size()) return 0;
    for (size_t k = 1; k < n; ++k)
        if ((b(k) & 0xC0) != 0x80) return 0;
    if (n == 3 && ((c == 0xE0 && b(1) < 0xA0) || (c == 0xED && b(1) > 0x9F))) return 0;
    if (n == 4 && ((c == 0xF0 && b(1) < 0x90) || (c == 0xF4 && b(1) > 0x8F))) return 0;
    return n;
}

constexpr const char* kReplacement = "\xEF\xBF\xBD";  // U+FFFD

}  // namespace

bool isValidUtf8(const std::string& s) {
    for (size_t i = 0; i < s.size();) {
        const size_t n = sequenceAt(s, i);
        if (n == 0) return false;
        i += n;
    }
    return true;
}

std::string sanitizeUtf8(const std::string& s, bool* repaired) {
    if (repaired) *repaired = false;
    if (isValidUtf8(s)) return s;
    std::string out;
    out.reserve(s.size() + 8);
    for (size_t i = 0; i < s.size();) {
        const size_t n = sequenceAt(s, i);
        if (n == 0) {
            out += kReplacement;
            ++i;
            if (repaired) *repaired = true;
        } else {
            out.append(s, i, n);
            i += n;
        }
    }
    return out;
}

std::string utf8Prefix(const std::string& s, size_t maxChars, bool& truncated) {
    truncated = false;
    size_t chars = 0;
    for (size_t i = 0; i < s.size();) {
        if (chars == maxChars) {
            truncated = true;
            return s.substr(0, i);
        }
        const size_t n = sequenceAt(s, i);
        i += n == 0 ? 1 : n;
        ++chars;
    }
    return s;
}

std::string utf16Prefix(const std::string& s, size_t maxUnits) {
    size_t units = 0;
    for (size_t i = 0; i < s.size();) {
        const size_t n = sequenceAt(s, i);
        const size_t step = n == 0 ? 1 : n;
        const size_t cost = n == 4 ? 2 : 1;  // above U+FFFF: a surrogate pair
        if (units + cost > maxUnits) return s.substr(0, i);
        units += cost;
        i += step;
    }
    return s;
}

unsigned layoutControlAt(const std::string& s, size_t i, size_t& len) {
    len = 0;
    const auto at = [&](size_t k) { return static_cast<unsigned char>(s[k]); };
    if (i + 1 < s.size() && at(i) == 0xd8 && at(i + 1) == 0x9c) {  // U+061C
        len = 2;
        return 0x061c;
    }
    if (i + 2 >= s.size() || at(i) != 0xe2) return 0;
    const unsigned b1 = at(i + 1);
    const unsigned b2 = at(i + 2);
    const bool hit = (b1 == 0x80 && (b2 == 0x8e || b2 == 0x8f || (b2 >= 0xa8 && b2 <= 0xae))) ||
                     (b1 == 0x81 && b2 >= 0xa6 && b2 <= 0xa9);
    if (!hit) return 0;
    len = 3;
    return 0x2000u | ((b1 & 0x3fu) << 6) | (b2 & 0x3fu);
}

}  // namespace mat
