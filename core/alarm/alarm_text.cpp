#include "core/alarm/alarm_text.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <utility>
#include <vector>

namespace mat::alarm {

namespace {

constexpr char32_t kReplacement = 0xFFFD;

// Strict UTF-8 decoder: one U+FFFD per offending byte (the same as the TS twin's manual decoder).
char32_t decodeAt(std::string_view s, size_t i, size_t& len) {
    const auto b0 = static_cast<unsigned char>(s[i]);
    auto cont = [&](size_t k) { return i + k < s.size() && (static_cast<unsigned char>(s[i + k]) & 0xC0) == 0x80; };
    len = 1;
    if (b0 < 0x80) return b0;
    if (b0 >= 0xC2 && b0 <= 0xDF && cont(1)) {
        len = 2;
        return ((b0 & 0x1Fu) << 6) | (static_cast<unsigned char>(s[i + 1]) & 0x3Fu);
    }
    if (b0 >= 0xE0 && b0 <= 0xEF && cont(1) && cont(2)) {
        const char32_t cp = ((b0 & 0x0Fu) << 12) | ((static_cast<unsigned char>(s[i + 1]) & 0x3Fu) << 6) |
                            (static_cast<unsigned char>(s[i + 2]) & 0x3Fu);
        if (cp >= 0x800 && !(cp >= 0xD800 && cp <= 0xDFFF)) {
            len = 3;
            return cp;
        }
    }
    if (b0 >= 0xF0 && b0 <= 0xF4 && cont(1) && cont(2) && cont(3)) {
        const char32_t cp = ((b0 & 0x07u) << 18) | ((static_cast<unsigned char>(s[i + 1]) & 0x3Fu) << 12) |
                            ((static_cast<unsigned char>(s[i + 2]) & 0x3Fu) << 6) |
                            (static_cast<unsigned char>(s[i + 3]) & 0x3Fu);
        if (cp >= 0x10000 && cp <= 0x10FFFF) {
            len = 4;
            return cp;
        }
    }
    return kReplacement;  // len stays 1
}

void appendUtf8(std::string& out, char32_t cp) {
    if (cp < 0x80) {
        out += static_cast<char>(cp);
    } else if (cp < 0x800) {
        out += static_cast<char>(0xC0 | (cp >> 6));
        out += static_cast<char>(0x80 | (cp & 0x3F));
    } else if (cp < 0x10000) {
        out += static_cast<char>(0xE0 | (cp >> 12));
        out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (cp & 0x3F));
    } else {
        out += static_cast<char>(0xF0 | (cp >> 18));
        out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
        out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (cp & 0x3F));
    }
}

bool isCombining(char32_t cp) { return cp >= 0x0300 && cp <= 0x036F; }

// The 134 pairs of alarm-store.md §7 (code point -> base letter), sorted by code point.
const std::vector<std::pair<char32_t, char>>& foldTable() {
    static const std::vector<std::pair<char32_t, char>> table = [] {
        struct Row {
            char base;
            const char* letters;
        };
        const Row rows[] = {
            {'a', "àáảãạăằắẳẵặâầấẩẫậÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ"},
            {'e', "èéẻẽẹêềếểễệÈÉẺẼẸÊỀẾỂỄỆ"},
            {'i', "ìíỉĩịÌÍỈĨỊ"},
            {'o', "òóỏõọôồốổỗộơờớởỡợÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ"},
            {'u', "ùúủũụưừứửữựÙÚỦŨỤƯỪỨỬỮỰ"},
            {'y', "ỳýỷỹỵỲÝỶỸỴ"},
            {'d', "đĐ"},
        };
        std::vector<std::pair<char32_t, char>> t;
        for (const Row& r : rows) {
            const std::string_view s = r.letters;
            for (size_t i = 0; i < s.size();) {
                size_t len = 1;
                const char32_t cp = decodeAt(s, i, len);
                t.emplace_back(cp, r.base);
                i += len;
            }
        }
        std::sort(t.begin(), t.end());
        return t;
    }();
    return table;
}

std::string stripTrailingZeros(std::string digits) {
    while (digits.size() > 1 && digits.back() == '0') digits.pop_back();
    return digits;
}

// Adds one to a string of decimal digits ("999" -> "1000").
std::string incrementDigits(std::string d) {
    int i = static_cast<int>(d.size()) - 1;
    while (i >= 0) {
        if (d[i] == '9') {
            d[i] = '0';
            --i;
        } else {
            ++d[i];
            return d;
        }
    }
    return "1" + d;
}

bool isSpace(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'; }

// {value} / {value:N} text of the value of the context.
std::string valueText(const TextContext& c, int decimals /* -1: {value} */) {
    if (!c.value || !std::isfinite(*c.value)) return "n/a";
    const double v = *c.value;
    if (c.labels) {
        auto it = c.labels->find(shortestDouble(v));
        if (it != c.labels->end()) return it->second;
    }
    if (c.isBool) return v != 0 ? "Bật" : "Tắt";
    return decimals < 0 ? formatNumberTrim(v) : formatNumber(v, decimals);
}

std::string expandTag(const std::string& tag, const TextContext& c, bool& known) {
    known = true;
    if (tag == "name") return c.name;
    if (tag == "tag") return c.tag;
    if (tag == "value") return valueText(c, -1);
    if (tag.size() == 7 && tag.compare(0, 6, "value:") == 0 && tag[6] >= '0' && tag[6] <= '6')
        return valueText(c, tag[6] - '0');
    if (tag == "unit") return c.unit;
    if (tag == "limit") return c.limit && std::isfinite(*c.limit) ? formatNumberTrim(*c.limit) : std::string();
    if (tag == "limitName") return c.limitName;
    if (tag == "area") return c.area.empty() ? "Chung" : c.area;
    if (tag == "reason") return c.reason;
    known = false;
    return {};
}

}  // namespace

std::string shortestDouble(double v) {
    if (!std::isfinite(v)) return "n/a";
    if (v == 0) return "0";
    char buf[48];
    for (int p = 1; p <= 17; ++p) {
        std::snprintf(buf, sizeof buf, "%.*e", p - 1, v);
        // a locale could write a comma; the engine never calls setlocale, but be sure
        for (char* q = buf; *q; ++q)
            if (*q == ',') *q = '.';
        if (std::strtod(buf, nullptr) == v) break;
    }
    const char* s = buf;
    bool neg = false;
    if (*s == '-') {
        neg = true;
        ++s;
    }
    std::string digits;
    while (*s && *s != 'e' && *s != 'E') {
        if (*s != '.') digits += *s;
        ++s;
    }
    const int exp10 = *s ? std::atoi(s + 1) : 0;
    digits = stripTrailingZeros(digits);
    std::string out;
    if (exp10 >= 0) {
        const size_t intLen = static_cast<size_t>(exp10) + 1;
        if (digits.size() <= intLen) {
            out = digits + std::string(intLen - digits.size(), '0');
        } else {
            out = digits.substr(0, intLen) + "." + digits.substr(intLen);
        }
    } else {
        out = "0." + std::string(static_cast<size_t>(-exp10 - 1), '0') + digits;
    }
    return neg ? "-" + out : out;
}

std::string formatNumber(double v, int decimals) {
    if (!std::isfinite(v)) return "n/a";
    decimals = std::min(std::max(decimals, 0), 6);
    std::string s = shortestDouble(std::fabs(v));
    std::string ip = s, fp;
    const size_t dot = s.find('.');
    if (dot != std::string::npos) {
        ip = s.substr(0, dot);
        fp = s.substr(dot + 1);
    }
    const size_t n = static_cast<size_t>(decimals);
    if (fp.size() > n) {
        const bool up = fp[n] >= '5';
        fp.resize(n);
        if (up) {
            std::string all = incrementDigits(ip + fp);
            ip = all.substr(0, all.size() - n);
            fp = all.substr(all.size() - n);
        }
    } else {
        fp += std::string(n - fp.size(), '0');
    }
    const bool nonZero = ip.find_first_not_of('0') != std::string::npos || fp.find_first_not_of('0') != std::string::npos;
    std::string out = (v < 0 && nonZero) ? "-" : "";
    out += ip;
    if (n > 0) {
        out += kDecimalSeparator;
        out += fp;
    }
    return out;
}

std::string formatNumberTrim(double v) {
    std::string s = formatNumber(v, 6);
    if (s.find(kDecimalSeparator) != std::string::npos) {
        while (!s.empty() && s.back() == '0') s.pop_back();
        if (!s.empty() && s.back() == kDecimalSeparator) s.pop_back();
    }
    if (s == "-0" || s.empty()) return "0";
    return s;
}

std::string defaultTemplate(AlarmKind kind, std::string_view limitName) {
    switch (kind) {
        case AlarmKind::Digital: return "{name}";
        case AlarmKind::Quality: return "{name}: mất tín hiệu ({reason})";
        case AlarmKind::Limit:
            if (limitName == "HH") return "{name} rất cao: {value} {unit} (ngưỡng {limit})";
            if (limitName == "H") return "{name} cao: {value} {unit} (ngưỡng {limit})";
            if (limitName == "L") return "{name} thấp: {value} {unit} (ngưỡng {limit})";
            return "{name} rất thấp: {value} {unit} (ngưỡng {limit})";
    }
    return "{name}";
}

size_t utf8Length(std::string_view s) {
    size_t n = 0;
    for (char c : s)
        if ((static_cast<unsigned char>(c) & 0xC0) != 0x80) ++n;
    return n;
}

std::string formatAlarmText(const TextTemplate& tplIn, const TextContext& ctx) {
    const std::string tpl = tplIn.empty() ? defaultTemplate(ctx.kind, ctx.limitName) : tplIn;
    std::string out;
    for (size_t i = 0; i < tpl.size();) {
        if (tpl[i] == '{') {
            const size_t end = tpl.find('}', i + 1);
            if (end != std::string::npos) {
                bool known = false;
                std::string rep = expandTag(tpl.substr(i + 1, end - i - 1), ctx, known);
                if (known) {
                    out += rep;
                    i = end + 1;
                    continue;
                }
            }
        }
        out += tpl[i++];
    }
    // empty () go, one pass
    std::string a;
    a.reserve(out.size());
    for (size_t i = 0; i < out.size();) {
        if (out[i] == '(') {
            size_t j = i + 1;
            while (j < out.size() && isSpace(out[j])) ++j;
            if (j < out.size() && out[j] == ')') {
                i = j + 1;
                continue;
            }
        }
        a += out[i++];
    }
    // runs of white space become one space, both ends trimmed
    std::string b;
    b.reserve(a.size());
    bool pendingSpace = false;
    for (char ch : a) {
        if (isSpace(ch)) {
            pendingSpace = !b.empty();
        } else {
            if (pendingSpace) b += ' ';
            pendingSpace = false;
            b += ch;
        }
    }
    // at most 200 code points; 199 and "…" when longer; not between a base and its combining marks
    std::vector<size_t> starts;
    std::vector<char32_t> cps;
    for (size_t i = 0; i < b.size();) {
        size_t len = 1;
        const char32_t cp = decodeAt(b, i, len);
        starts.push_back(i);
        cps.push_back(cp);
        i += len;
    }
    if (cps.size() > 200) {
        size_t cut = 199;
        while (cut > 0 && isCombining(cps[cut])) --cut;
        return b.substr(0, starts[cut]) + "\xE2\x80\xA6";
    }
    return b;
}

std::string foldText(std::string_view s) {
    const auto& table = foldTable();
    std::string out;
    out.reserve(s.size());
    for (size_t i = 0; i < s.size();) {
        size_t len = 1;
        const char32_t cp = decodeAt(s, i, len);
        i += len;
        if (isCombining(cp)) continue;
        auto it = std::lower_bound(table.begin(), table.end(), std::make_pair(cp, '\0'));
        if (it != table.end() && it->first == cp) {
            out += it->second;
        } else if (cp >= 'A' && cp <= 'Z') {
            out += static_cast<char>(cp - 'A' + 'a');
        } else {
            appendUtf8(out, cp);
        }
    }
    return out;
}

}  // namespace mat::alarm
