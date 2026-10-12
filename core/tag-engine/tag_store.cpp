#include "core/tag-engine/tag_store.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "core/common/utf8.hpp"

namespace mat {

namespace {
const char* const kTypeNames[] = {"BOOL",  "INT16",  "UINT16",  "INT32",   "UINT32",
                                  "INT64", "UINT64", "FLOAT32", "FLOAT64", "STRING"};
}

std::optional<TagType> parseTagType(const std::string& s) {
    for (size_t i = 0; i < sizeof kTypeNames / sizeof kTypeNames[0]; ++i)
        if (s == kTypeNames[i]) return static_cast<TagType>(i);
    return std::nullopt;
}

const char* qualityName(Quality q) {
    switch (q) {
        case Quality::GOOD:
            return "GOOD";
        case Quality::UNCERTAIN:
            return "UNCERTAIN";
        default:
            return "BAD";
    }
}

bool isNumericType(TagType t) { return t != TagType::BOOL && t != TagType::STRING; }

void appendJsonString(std::string& out, const std::string& s) {
    out += '"';
    for (unsigned char c : s) {
        switch (c) {
            case '"':
                out += "\\\"";
                break;
            case '\\':
                out += "\\\\";
                break;
            case '\n':
                out += "\\n";
                break;
            case '\r':
                out += "\\r";
                break;
            case '\t':
                out += "\\t";
                break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof buf, "\\u%04x", c);
                    out += buf;
                } else {
                    out += static_cast<char>(c);
                }
        }
    }
    out += '"';
}

size_t TagStore::add(TagDef def) {
    std::lock_guard<std::mutex> g(mu_);
    if (byId_.count(def.id)) throw std::invalid_argument("duplicate tag id: " + def.id);
    const size_t i = defs_.size();
    byId_.emplace(def.id, i);
    defs_.push_back(std::move(def));
    values_.emplace_back();
    dirtyFlag_.push_back(0);
    return i;
}

std::optional<size_t> TagStore::indexOf(const std::string& id) const {
    std::lock_guard<std::mutex> g(mu_);
    auto it = byId_.find(id);
    if (it == byId_.end()) return std::nullopt;
    return it->second;
}

size_t TagStore::size() const {
    std::lock_guard<std::mutex> g(mu_);
    return defs_.size();
}

const TagDef& TagStore::def(size_t i) const {
    std::lock_guard<std::mutex> g(mu_);
    return defs_.at(i);
}

bool TagStore::set(size_t i, TagScalar v, Quality q, int64_t sourceTs, int64_t serverTs) {
    return set(i, std::move(v), q, std::string(), sourceTs, serverTs);
}

bool TagStore::set(size_t i, TagScalar v, Quality q, std::string reason, int64_t sourceTs,
                   int64_t serverTs) {
    // Text from a device may be anything: never pass broken UTF-8 to the live JSON (browsers drop
    // the WebSocket) or to the historian (databases refuse it). specs/003 security review M1.
    if (auto* s = std::get_if<std::string>(&v); s && !isValidUtf8(*s)) *s = sanitizeUtf8(*s);
    std::lock_guard<std::mutex> g(mu_);
    return setLocked(i, std::move(v), q, std::move(reason), sourceTs, serverTs);
}

bool TagStore::setLocked(size_t i, TagScalar v, Quality q, std::string reason, int64_t sourceTs,
                         int64_t serverTs) {
    TagValue& cur = values_.at(i);
    if (q == Quality::GOOD) reason.clear();
    const bool changed =
        cur.quality != q || cur.value != v || cur.reason != reason || cur.revision == 0;
    cur.sourceTs = sourceTs;
    cur.serverTs = serverTs;
    if (!changed) return false;
    cur.value = std::move(v);
    cur.quality = q;
    cur.reason = std::move(reason);
    ++cur.revision;
    if (!dirtyFlag_[i]) {
        dirtyFlag_[i] = 1;
        dirty_.push_back(i);
    }
    return true;
}

size_t TagStore::applyBatch(std::vector<Update> updates) {
    for (auto& u : updates)
        if (auto* s = std::get_if<std::string>(&u.value); s && !isValidUtf8(*s))
            *s = sanitizeUtf8(*s);
    std::lock_guard<std::mutex> g(mu_);
    for (const auto& u : updates)
        if (u.index >= values_.size()) throw std::out_of_range("TagStore::applyBatch: bad index");
    size_t changed = 0;
    for (auto& u : updates)
        if (setLocked(u.index, std::move(u.value), u.quality, std::move(u.reason), u.sourceTs,
                      u.serverTs))
            ++changed;
    return changed;
}

TagValue TagStore::get(size_t i) const {
    std::lock_guard<std::mutex> g(mu_);
    return values_.at(i);
}

void TagStore::snapshot(const std::vector<size_t>& indices, std::vector<TagValue>& out) const {
    std::lock_guard<std::mutex> g(mu_);
    out.clear();
    out.reserve(indices.size());
    for (size_t i : indices) out.push_back(values_.at(i));
}

std::vector<size_t> TagStore::takeDirty() {
    std::lock_guard<std::mutex> g(mu_);
    std::vector<size_t> out;
    out.swap(dirty_);
    for (size_t i : out) dirtyFlag_[i] = 0;
    std::sort(out.begin(), out.end());
    return out;
}

void TagStore::valueJsonLocked(std::string& out, size_t i) const {
    const TagDef& d = defs_[i];
    const TagScalar& v = values_[i].value;
    char buf[40];
    if (std::holds_alternative<bool>(v)) {
        out += std::get<bool>(v) ? "true" : "false";
    } else if (std::holds_alternative<int64_t>(v)) {
        std::snprintf(buf, sizeof buf, "%lld", static_cast<long long>(std::get<int64_t>(v)));
        if (d.type == TagType::INT64 || d.type == TagType::UINT64) {
            out += '"';
            out += buf;
            out += '"';
        } else {
            out += buf;
        }
    } else if (std::holds_alternative<uint64_t>(v)) {
        std::snprintf(buf, sizeof buf, "%llu",
                      static_cast<unsigned long long>(std::get<uint64_t>(v)));
        if (d.type == TagType::INT64 || d.type == TagType::UINT64) {
            out += '"';
            out += buf;
            out += '"';
        } else {
            out += buf;
        }
    } else if (std::holds_alternative<double>(v)) {
        const double x = std::get<double>(v);
        if (!std::isfinite(x)) {
            out += "null";
        } else if ((d.type == TagType::INT64 || d.type == TagType::UINT64) &&
                   std::fabs(x) >= 1.9e19) {
            out += "null";  // outside the 64-bit range: no meaningful integer
        } else if (d.type == TagType::INT64 || d.type == TagType::UINT64) {
            // Contract: 64-bit integers travel as decimal strings (no precision loss in JS).
            std::snprintf(buf, sizeof buf, "\"%.0f\"", std::round(x));
            out += buf;
        } else {
            std::snprintf(buf, sizeof buf, "%.9g", x);
            out += buf;
        }
    } else if (std::holds_alternative<std::string>(v)) {
        appendJsonString(out, std::get<std::string>(v));
    } else {
        out += "null";
    }
}

void TagStore::appendValueJson(std::string& out, size_t i) const {
    std::lock_guard<std::mutex> g(mu_);
    valueJsonLocked(out, i);
}

void TagStore::appendSnapshotJson(std::string& out, size_t i) const {
    std::lock_guard<std::mutex> g(mu_);
    const TagValue& v = values_.at(i);
    out += "{\"id\":";
    appendJsonString(out, defs_[i].id);
    out += ",\"value\":";
    valueJsonLocked(out, i);
    out += ",\"quality\":\"";
    out += qualityName(v.quality);
    out += '"';
    if (v.quality != Quality::GOOD && !v.reason.empty()) {
        out += ",\"reason\":";
        appendJsonString(out, v.reason);
    }
    char buf[120];
    std::snprintf(buf, sizeof buf,
                  ",\"sourceTimestamp\":%lld,\"serverTimestamp\":%lld,\"revision\":%llu}",
                  static_cast<long long>(v.sourceTs), static_cast<long long>(v.serverTs),
                  static_cast<unsigned long long>(v.revision));
    out += buf;
}

void TagStore::appendDeltaEntryJson(std::string& out, size_t position, size_t i) const {
    std::lock_guard<std::mutex> g(mu_);
    char buf[32];
    std::snprintf(buf, sizeof buf, "[%zu,", position);
    out += buf;
    valueJsonLocked(out, i);
    out += ",\"";
    out += qualityName(values_[i].quality);
    out += '"';
    if (values_[i].quality != Quality::GOOD && !values_[i].reason.empty()) {
        out += ',';
        appendJsonString(out, values_[i].reason);
    }
    out += ']';
}

}  // namespace mat
