#include "drivers/mqtt/payload.hpp"

#include <cerrno>
#include <cfloat>
#include <cmath>
#include <cstdint>
#include <cstdlib>

#include "nlohmann/json.hpp"

namespace mat::mqtt {

namespace {

using nlohmann::json;

std::string trim(const std::string& s) {
    const char* ws = " \t\r\n";
    const size_t b = s.find_first_not_of(ws);
    if (b == std::string::npos) return {};
    return s.substr(b, s.find_last_not_of(ws) - b + 1);
}

std::string lower(std::string s) {
    for (char& c : s)
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    return s;
}

bool fullDouble(const std::string& t, double& out) {
    if (t.empty()) return false;
    errno = 0;
    char* end = nullptr;
    out = std::strtod(t.c_str(), &end);
    if (end != t.c_str() + t.size() || errno == ERANGE) return false;
    return std::isfinite(out);
}

// A text without a sign or decimal point that strtoll / strtoull read whole.
bool fullSigned(const std::string& t, int64_t& out) {
    if (t.empty() || t.find_first_of(".eE") != std::string::npos) return false;
    errno = 0;
    char* end = nullptr;
    out = std::strtoll(t.c_str(), &end, 10);
    return end == t.c_str() + t.size() && errno == 0;
}

bool fullUnsigned(const std::string& t, uint64_t& out) {
    if (t.empty() || t[0] == '-' || t.find_first_of(".eE") != std::string::npos) return false;
    errno = 0;
    char* end = nullptr;
    out = std::strtoull(t.c_str(), &end, 10);
    return end == t.c_str() + t.size() && errno == 0;
}

std::string cutUtf8(const std::string& s, int max) {
    if (max <= 0 || s.size() <= static_cast<size_t>(max)) return s;
    size_t n = static_cast<size_t>(max);
    while (n > 0 && (static_cast<unsigned char>(s[n]) & 0xC0) == 0x80) --n;
    return s.substr(0, n);
}

void rangeOf(TagType t, int64_t& lo, int64_t& hi) {
    lo = t == TagType::INT16 ? INT16_MIN : t == TagType::INT32 ? INT32_MIN : INT64_MIN;
    hi = t == TagType::INT16 ? INT16_MAX : t == TagType::INT32 ? INT32_MAX : INT64_MAX;
}

uint64_t umaxOf(TagType t) {
    return t == TagType::UINT16 ? UINT16_MAX : t == TagType::UINT32 ? UINT32_MAX : UINT64_MAX;
}

json scalarJson(const TagScalar& v) {
    if (const bool* b = std::get_if<bool>(&v)) return *b;
    if (const int64_t* i = std::get_if<int64_t>(&v)) return *i;
    if (const uint64_t* u = std::get_if<uint64_t>(&v)) return *u;
    if (const double* d = std::get_if<double>(&v)) return std::isfinite(*d) ? json(*d) : json();
    if (const std::string* s = std::get_if<std::string>(&v)) return *s;
    return nullptr;
}

}  // namespace

Decoded decodeText(const std::string& raw, TagType rawType, int stringLength) {
    Decoded d;
    if (rawType == TagType::STRING) {
        d.ok = true;
        d.value = cutUtf8(raw, stringLength);
        return d;
    }
    const std::string t = trim(raw);
    switch (rawType) {
        case TagType::BOOL: {
            const std::string l = lower(t);
            if (l == "1" || l == "true" || l == "on")
                d.value = true;
            else if (l == "0" || l == "false" || l == "off")
                d.value = false;
            else
                return d;
            d.ok = true;
            return d;
        }
        case TagType::INT16:
        case TagType::INT32:
        case TagType::INT64: {
            int64_t lo = 0, hi = 0;
            rangeOf(rawType, lo, hi);
            int64_t i = 0;
            double x = 0;
            if (fullSigned(t, i)) {
            } else if (fullDouble(t, x) && std::trunc(x) == x && x >= -9.2e18 && x <= 9.2e18) {
                i = static_cast<int64_t>(x);
            } else {
                return d;
            }
            if (i < lo || i > hi) return d;
            d.ok = true;
            d.value = i;
            return d;
        }
        case TagType::UINT16:
        case TagType::UINT32:
        case TagType::UINT64: {
            uint64_t u = 0;
            double x = 0;
            if (fullUnsigned(t, u)) {
            } else if (fullDouble(t, x) && std::trunc(x) == x && x >= 0 && x <= 1.8e19) {
                u = static_cast<uint64_t>(x);
            } else {
                return d;
            }
            if (u > umaxOf(rawType)) return d;
            d.ok = true;
            d.value = u;
            return d;
        }
        case TagType::FLOAT32:
        case TagType::FLOAT64: {
            double x = 0;
            if (!fullDouble(t, x)) return d;
            if (rawType == TagType::FLOAT32 && std::fabs(x) > FLT_MAX) return d;
            d.ok = true;
            d.value = x;
            return d;
        }
        default:
            return d;
    }
}

Decoded decodePayload(const std::string& payload, bool isJson, const std::vector<PathStep>& steps,
                      TagType rawType, int stringLength) {
    if (payload.size() > kMaxPayload) return {};
    if (!isJson) return decodeText(payload, rawType, stringLength);
    const json doc = json::parse(payload, nullptr, false);
    if (doc.is_discarded()) return {};
    const json* node = &doc;
    for (const PathStep& s : steps) {
        if (s.index) {
            if (!node->is_array() || static_cast<size_t>(s.n) >= node->size()) return {};
            node = &(*node)[static_cast<size_t>(s.n)];
        } else {
            if (!node->is_object()) return {};
            const auto it = node->find(s.name);
            if (it == node->end()) return {};
            node = &*it;
        }
    }
    switch (node->type()) {
        case json::value_t::string:
            return decodeText(node->get<std::string>(), rawType, stringLength);
        case json::value_t::boolean:
            if (rawType == TagType::STRING) return decodeText(node->dump(), rawType, stringLength);
            return decodeText(node->get<bool>() ? "1" : "0", rawType, stringLength);
        case json::value_t::number_integer:
        case json::value_t::number_unsigned:
        case json::value_t::number_float:
            if (rawType == TagType::BOOL) {
                const double x = node->get<double>();
                if (x != 0 && x != 1) return {};
                Decoded d;
                d.ok = true;
                d.value = x == 1;
                return d;
            }
            return decodeText(node->dump(), rawType, stringLength);
        default:
            return {};
    }
}

std::string encodePayload(const TagScalar& value, TagType rawType, bool isJson,
                          const std::vector<PathStep>& steps) {
    json v = scalarJson(value);
    if (rawType == TagType::BOOL && !v.is_boolean() && v.is_number()) v = v.get<double>() != 0;
    if (!isJson) {
        if (v.is_boolean()) return v.get<bool>() ? "1" : "0";
        if (v.is_string()) return v.get<std::string>();
        if (v.is_null()) return "";
        return v.dump();
    }
    for (auto it = steps.rbegin(); it != steps.rend(); ++it) {
        json outer;
        if (it->index) {
            outer = json::array();
            for (int k = 0; k < it->n; ++k) outer.push_back(nullptr);
            outer.push_back(std::move(v));
        } else {
            outer = json::object();
            outer[it->name] = std::move(v);
        }
        v = std::move(outer);
    }
    return v.dump(-1, ' ', false, json::error_handler_t::replace);
}

std::string encodeGroup(int64_t tsMs, const std::vector<GroupEntry>& entries) {
    json values = json::object(), quality = json::object();
    for (const GroupEntry& e : entries) {
        values[e.id] = scalarJson(e.value.value);
        quality[e.id] = qualityName(e.value.quality);
    }
    json doc = json::object();
    doc["ts"] = tsMs;
    doc["values"] = std::move(values);
    doc["quality"] = std::move(quality);
    return doc.dump(-1, ' ', false, json::error_handler_t::replace);
}

}  // namespace mat::mqtt
