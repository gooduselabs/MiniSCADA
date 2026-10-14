#include "core/historian/query/csv_writer.hpp"

#include <cmath>
#include <cstdio>
#include <type_traits>

#include "core/historian/clock.hpp"

namespace mat {

const char* csvBom() { return "\xEF\xBB\xBF"; }

std::string csvNumber(double v) {
    if (!std::isfinite(v)) return "";
    char buf[40];
    std::snprintf(buf, sizeof buf, "%.15g", v);
    // The runtime never calls setlocale(), so this is the C locale; be safe anyway.
    for (char* p = buf; *p; ++p)
        if (*p == ',') *p = '.';
    return buf;
}

std::string csvText(const std::string& s) {
    std::string t = s;
    if (!t.empty() && (t[0] == '=' || t[0] == '+' || t[0] == '-' || t[0] == '@' || t[0] == '\t' ||
                       t[0] == '\r'))
        t.insert(t.begin(), '\'');
    if (t.find_first_of(",\"\r\n") == std::string::npos) return t;
    std::string q = "\"";
    for (char c : t) {
        if (c == '"') q += '"';
        q += c;
    }
    return q + "\"";
}

std::string csvCell(const Cell& c) {
    return std::visit(
        [](const auto& v) -> std::string {
            using T = std::decay_t<decltype(v)>;
            if constexpr (std::is_same_v<T, std::monostate>) {
                return "";
            } else if constexpr (std::is_same_v<T, bool>) {
                return v ? "1" : "0";
            } else if constexpr (std::is_same_v<T, int64_t> || std::is_same_v<T, uint64_t>) {
                return std::to_string(v);
            } else if constexpr (std::is_same_v<T, double>) {
                return csvNumber(v);
            } else {
                return csvText(v);
            }
        },
        c);
}

std::string csvTime(int64_t utcMs, int offsetMin, int64_t resMs) {
    const std::string full = formatLocalTime(utcMs, offsetMin, ' ');  // yyyy-MM-dd HH:mm:ss.SSS
    if (resMs >= 3600000) return full.substr(0, 13) + ":00";
    if (resMs >= 60000) return full.substr(0, 16);
    return full;
}

std::string csvHeader(const std::vector<std::string>& names) {
    std::string out = "time";
    for (const auto& n : names) out += "," + csvText(n);
    return out + "\r\n";
}

std::string csvLine(const std::string& time, const std::vector<std::string>& cells) {
    std::string out = time;
    for (const auto& c : cells) out += "," + c;
    return out + "\r\n";
}

bool CsvChunker::append(const std::string& s) {
    if (!ok_) return false;
    buf_ += s;
    if (buf_.size() >= limit_) return flush();
    return true;
}

bool CsvChunker::flush() {
    if (!ok_) return false;
    if (buf_.empty()) return true;
    // never more than `limit_` bytes in one chunk
    size_t off = 0;
    while (off < buf_.size()) {
        const size_t n = std::min(limit_, buf_.size() - off);
        if (!sink_(buf_.substr(off, n))) {
            ok_ = false;
            buf_.clear();
            return false;
        }
        off += n;
    }
    buf_.clear();
    return true;
}

}  // namespace mat
