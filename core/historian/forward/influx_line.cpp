#include "core/historian/forward/influx_line.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <optional>

#include "core/common/utf8.hpp"
#include "core/historian/cell.hpp"
#include "nlohmann/json.hpp"

namespace mat {

namespace {

std::string escape(const std::string& s, const char* special) {
    std::string out;
    out.reserve(s.size() + 4);
    for (char c : s) {
        if (std::char_traits<char>::find(special, std::char_traits<char>::length(special), c))
            out += '\\';
        out += c;
    }
    return out;
}

bool allDigits(const std::string& s) {
    return !s.empty() && s.size() <= 20 &&
           std::all_of(s.begin(), s.end(), [](char c) { return c >= '0' && c <= '9'; });
}

// Field value text for one cell, or nullopt when the field is left out.
std::optional<std::string> fieldValue(const Cell& c, TagType type) {
    if (std::holds_alternative<std::monostate>(c)) return std::nullopt;
    const auto* d = std::get_if<double>(&c);
    if (d && !std::isfinite(*d)) return std::nullopt;
    const auto* i = std::get_if<int64_t>(&c);
    const auto* u = std::get_if<uint64_t>(&c);
    const auto* b = std::get_if<bool>(&c);
    const auto* s = std::get_if<std::string>(&c);
    switch (type) {
        case TagType::BOOL:
            if (s) return std::nullopt;
            if (!b && !i && !u && !d) return std::nullopt;  // not reached: the variant holds one
            return (b ? *b : i ? *i != 0 : u ? *u != 0 : *d != 0.0) ? "true" : "false";
        case TagType::STRING:
            if (s) return influxString(*s);
            if (d) return influxString(shortestDouble(*d));
            if (i) return influxString(std::to_string(*i));
            if (u) return influxString(std::to_string(*u));
            if (b) return influxString(*b ? "1" : "0");
            return std::nullopt;  // not reached: the variant holds one of the five
        case TagType::FLOAT32:
        case TagType::FLOAT64:
            if (d) return type == TagType::FLOAT32 ? shortestFloat(*d) : shortestDouble(*d);
            if (i) return std::to_string(*i);
            if (u) return std::to_string(*u);
            if (b) return std::string(*b ? "1" : "0");
            return std::nullopt;
        case TagType::UINT64:
            if (u) return std::to_string(*u) + "u";
            if (i)
                return *i < 0 ? std::nullopt : std::optional<std::string>(std::to_string(*i) + "u");
            if (s) return allDigits(*s) ? std::optional<std::string>(*s + "u") : std::nullopt;
            if (d) {
                if (*d < 0 || *d >= 18446744073709551615.0) return std::nullopt;
                char buf[32];  // above 2^63 too, where llround would overflow
                std::snprintf(buf, sizeof buf, "%.0f", std::round(*d));
                return std::string(buf) + "u";
            }
            return std::string(*b ? "1u" : "0u");
        default:  // INT16 … INT64
            if (i) return std::to_string(*i) + "i";
            if (u) {
                if (*u > static_cast<uint64_t>(INT64_MAX)) return std::nullopt;
                return std::to_string(*u) + "i";
            }
            if (d) {
                if (std::fabs(*d) >= 9.2e18) return std::nullopt;
                return std::to_string(std::llround(*d)) + "i";
            }
            if (b) return std::string(*b ? "1i" : "0i");
            return std::nullopt;
    }
}

}  // namespace

std::string influxEscapeMeasurement(const std::string& s) { return escape(s, ", "); }

std::string influxEscapeKey(const std::string& s) { return escape(s, ",= "); }

std::string influxString(const std::string& raw) {
    const std::string s = sanitizeUtf8(raw);  // the server refuses broken UTF-8
    std::string out = "\"";
    out.reserve(s.size() + 2);
    for (char c : s) {
        if (c == '\0') continue;  // never sent, as in SQL text
        if (c == '\n' || c == '\r') {
            out += ' ';
            continue;
        }
        if (c == '\\' || c == '"') out += '\\';
        out += c;
    }
    return out + "\"";
}

std::optional<InfluxPartial> influxPartialWrite(long status, const std::string& reply,
                                                size_t lines) {
    if (status != 400 && status != 422) return std::nullopt;
    const auto j = nlohmann::json::parse(reply, nullptr, false);
    // InfluxDB 3: {"error":"partial write …","data":[one entry per refused line]}. A reply cut at
    // its size limit is no JSON any more: then only its very start counts, which Tag text never
    // reaches (review of the fixes, Important 4). The reason is per line: never only retention.
    const bool v3 = j.is_object() ? j.contains("error") && j["error"].is_string() &&
                                        j["error"].get<std::string>().rfind("partial write", 0) == 0
                                  : reply.rfind(R"({"error":"partial write)", 0) == 0;
    if (v3) {
        InfluxPartial p;
        if (j.is_object() && j.contains("data") && j["data"].is_array())
            p.dropped = std::min<uint64_t>(j["data"].size(), lines);
        return p;
    }
    if (!j.is_object() || !j.contains("message") || !j["message"].is_string()) return std::nullopt;
    const std::string msg = j["message"].get<std::string>();
    // InfluxDB 2 starts the message with it; a refused line quoted further on holds Tag text.
    if (msg.rfind("partial write", 0) != 0 &&
        msg.rfind("failure writing points to database: partial write", 0) != 0)
        return std::nullopt;
    InfluxPartial p;
    // "… dropped=N" (InfluxDB 2.x ends the message with it), else "dropped N points"
    size_t at = msg.rfind("dropped=");
    size_t from = at == std::string::npos ? 0 : at + 8;
    if (at == std::string::npos) {
        at = msg.find("dropped ");
        from = at == std::string::npos ? msg.size() : at + 8;
    }
    uint64_t n = 0;
    for (size_t i = from; i < msg.size() && msg[i] >= '0' && msg[i] <= '9' && n < 1000000000; ++i)
        n = n * 10 + static_cast<uint64_t>(msg[i] - '0');
    p.dropped = std::min<uint64_t>(n, lines);
    p.retentionOnly =
        msg.find("retention") != std::string::npos && msg.find("conflict") == std::string::npos;
    return p;
}

std::string influxLine(const std::string& measurement, const std::string& sourceId,
                       const std::vector<InfluxColumn>& cols, const StoredRow& row) {
    std::string fields;
    for (size_t k = 0; k < cols.size() && k < row.cells.size(); ++k) {
        const auto v = fieldValue(row.cells[k], cols[k].type);
        if (!v) continue;
        if (!fields.empty()) fields += ',';
        fields += influxEscapeKey(cols[k].name) + "=" + *v;
    }
    if (fields.empty()) return "";
    return influxEscapeMeasurement(measurement) + ",source=" + influxEscapeKey(sourceId) + " " +
           fields + " " + std::to_string(row.ts);
}

std::vector<InfluxBody> influxBodies(const std::string& measurement, const std::string& sourceId,
                                     const std::vector<InfluxColumn>& cols,
                                     const std::vector<StoredRow>& rows, size_t maxLines,
                                     size_t maxBytes) {
    std::vector<InfluxBody> out;
    InfluxBody cur;
    bool open = false;
    for (const auto& r : rows) {
        const std::string line = influxLine(measurement, sourceId, cols, r);
        const bool full = cur.lines >= maxLines || (!line.empty() && cur.lines > 0 &&
                                                    cur.text.size() + 1 + line.size() > maxBytes);
        if (open && full) {
            out.push_back(std::move(cur));
            cur = InfluxBody{};
        }
        if (!line.empty()) {
            if (cur.lines) cur.text += '\n';
            cur.text += line;
            ++cur.lines;
        }
        cur.lastSeq = r.seq;
        open = true;
    }
    if (open) out.push_back(std::move(cur));
    return out;
}

}  // namespace mat
