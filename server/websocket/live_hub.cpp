#include "server/websocket/live_hub.hpp"

#include <cstdio>

#include "core/common/json_limits.hpp"
#include "nlohmann/json.hpp"

namespace mat {

using nlohmann::json;

LiveHub::LiveHub(TagStore& store, LiveTransport& tx, HubOptions opt, Clock epoch, Clock monotonic)
    : store_(store),
      tx_(tx),
      opt_(std::move(opt)),
      clock_(std::move(epoch)),
      mono_(monotonic ? std::move(monotonic) : clock_),
      nextHeartbeat_(mono_() + opt_.heartbeatMs) {}

void LiveHub::setProjectJson(std::string j) {
    std::lock_guard<std::mutex> g(hubMu_);
    opt_.projectJson = std::move(j);
}

uint64_t LiveHub::overflowClosedTotal() const {
    std::lock_guard<std::mutex> g(hubMu_);
    return overflowClosed_;
}

void LiveHub::sendLocked(uint64_t sid, Session& s, std::string text) {
    if (s.dead) return;
    switch (tx_.push(sid, std::move(text))) {
        case SendQueue::PushResult::Ok:
            break;
        case SendQueue::PushResult::Overflow:
            // The queue already holds resync_required + close 4409; stop serving this session.
            s.dead = true;
            s.subscribed = false;
            ++overflowClosed_;
            break;
        case SendQueue::PushResult::Closed:
            s.dead = true;
            s.subscribed = false;
            break;
    }
}

void LiveHub::onOpen(uint64_t sid) {
    std::lock_guard<std::mutex> g(hubMu_);
    Session& s = sessions_[sid];
    char buf[256];
    std::snprintf(buf, sizeof buf,
                  "{\"type\":\"hello\",\"protocolVersion\":\"%s\",\"serverVersion\":\"%s\","
                  "\"maxClients\":%zu,\"heartbeatMs\":%lld,\"timeoutMs\":%lld,\"project\":",
                  kLiveProtocolVersion, opt_.serverVersion.c_str(), opt_.maxClients,
                  static_cast<long long>(opt_.heartbeatMs), static_cast<long long>(opt_.timeoutMs));
    sendLocked(sid, s, std::string(buf) + opt_.projectJson + "}");
}

void LiveHub::onClose(uint64_t sid) {
    std::lock_guard<std::mutex> g(hubMu_);
    sessions_.erase(sid);
}

void LiveHub::errorLocked(uint64_t sid, Session& s, const char* code, const std::string& message,
                          const std::string& requestId) {
    json e = {{"type", "error"}, {"code", code}, {"message", message}};
    if (!requestId.empty()) e["requestId"] = requestId;
    sendLocked(sid, s, e.dump());
}

void LiveHub::subscribeLocked(uint64_t sid, Session& s, const std::string& requestId,
                              const std::vector<std::string>& tags) {
    std::vector<size_t> idx;
    std::vector<std::string> unknown;
    std::unordered_map<size_t, uint32_t> pos;
    for (const auto& id : tags) {
        auto i = store_.indexOf(id);
        if (!i) {
            unknown.push_back(id);
            continue;
        }
        if (pos.count(*i)) continue;  // duplicates are ignored
        pos.emplace(*i, static_cast<uint32_t>(idx.size()));
        idx.push_back(*i);
    }
    if (idx.empty()) {
        errorLocked(sid, s, "NO_VALID_TAGS", "Không có Tag hợp lệ trong yêu cầu", requestId);
        return;
    }
    s.subscriptionId = requestId;
    s.tags = std::move(idx);
    s.position = std::move(pos);
    s.subscribed = true;

    std::string out;
    out.reserve(64 + s.tags.size() * 110);
    out += "{\"type\":\"snapshot\",\"subscriptionId\":";
    appendJsonString(out, s.subscriptionId);
    char buf[96];
    std::snprintf(buf, sizeof buf, ",\"sequence\":%lld,\"ts\":%lld,\"tags\":[",
                  static_cast<long long>(++s.sequence), static_cast<long long>(clock_()));
    out += buf;
    for (size_t k = 0; k < s.tags.size(); ++k) {
        if (k) out += ',';
        store_.appendSnapshotJson(out, s.tags[k]);
    }
    out += "],\"unknown\":[";
    for (size_t k = 0; k < unknown.size(); ++k) {
        if (k) out += ',';
        appendJsonString(out, unknown[k]);
    }
    out += "]}";
    sendLocked(sid, s, std::move(out));
}

void LiveHub::onMessage(uint64_t sid, const char* data, size_t len) {
    std::lock_guard<std::mutex> g(hubMu_);
    auto it = sessions_.find(sid);
    if (it == sessions_.end()) return;
    Session& s = it->second;
    if (s.dead) return;
    if (len > opt_.maxMessageBytes) {
        s.dead = true;
        tx_.close(sid, 1009, "MESSAGE_TOO_BIG");
        return;
    }
    auto bad = [&](const std::string& why, const std::string& requestId = {}) {
        errorLocked(sid, s, "BAD_MESSAGE", why, requestId);
        if (++s.errorStreak >= opt_.maxConsecutiveErrors) {
            s.dead = true;
            tx_.close(sid, 1008, "PROTOCOL_ERROR");
        }
    };
    if (jsonNestingDepth(data, len) > opt_.maxMessageDepth) return bad("JSON lồng quá sâu");
    json m = json::parse(data, data + len, nullptr, false);
    if (m.is_discarded() || !m.is_object() || !m.contains("type") || !m["type"].is_string())
        return bad("Bản tin không phải JSON object có 'type'");
    const std::string type = m["type"];
    std::string requestId;
    if (m.contains("requestId")) {
        if (!m["requestId"].is_string() || m["requestId"].get<std::string>().size() > 64)
            return bad("requestId phải là chuỗi ≤ 64 ký tự");
        requestId = m["requestId"];
    }
    if (type == "heartbeat") {
        s.errorStreak = 0;
        return;
    }
    if (type == "subscribe") {
        if (requestId.empty()) return bad("subscribe cần requestId");
        if (!m.contains("tags") || !m["tags"].is_array() || m["tags"].empty() ||
            m["tags"].size() > opt_.maxSubscribeTags)
            return bad("tags phải là mảng 1–1000 chuỗi", requestId);
        if (m.contains("mode") && m["mode"] != "delta")
            return bad("mode chỉ hỗ trợ 'delta'", requestId);
        std::vector<std::string> tags;
        tags.reserve(m["tags"].size());
        for (auto& t : m["tags"]) {
            if (!t.is_string()) return bad("tags phải là mảng chuỗi", requestId);
            tags.push_back(t.get<std::string>());
        }
        s.errorStreak = 0;
        subscribeLocked(sid, s, requestId, tags);
        return;
    }
    if (type == "unsubscribe") {
        s.errorStreak = 0;
        s.subscribed = false;
        s.tags.clear();
        s.position.clear();
        return;
    }
    bad("type không hỗ trợ: " + type, requestId);
}

void LiveHub::tick() {
    std::lock_guard<std::mutex> g(hubMu_);
    const int64_t now = clock_();
    const int64_t monoNow = mono_();
    const std::vector<size_t> dirty = store_.takeDirty();
    if (!dirty.empty()) {
        std::string out;
        for (auto& kv : sessions_) {
            Session& s = kv.second;
            if (!s.subscribed || s.dead) continue;
            out.clear();
            size_t n = 0;
            for (size_t i : dirty) {
                auto p = s.position.find(i);
                if (p == s.position.end()) continue;
                if (n == 0) {
                    out += "{\"type\":\"delta\",\"subscriptionId\":";
                    appendJsonString(out, s.subscriptionId);
                    char buf[96];
                    std::snprintf(buf, sizeof buf, ",\"sequence\":%lld,\"ts\":%lld,\"tags\":[",
                                  static_cast<long long>(s.sequence + 1),
                                  static_cast<long long>(now));
                    out += buf;
                } else {
                    out += ',';
                }
                store_.appendDeltaEntryJson(out, p->second, i);
                ++n;
            }
            if (n == 0) continue;
            out += "]}";
            ++s.sequence;
            sendLocked(kv.first, s, out);
        }
    }
    if (monoNow >= nextHeartbeat_) {
        nextHeartbeat_ = monoNow + opt_.heartbeatMs;
        const std::string hb = "{\"type\":\"heartbeat\",\"ts\":" + std::to_string(now) + "}";
        for (auto& kv : sessions_) sendLocked(kv.first, kv.second, hb);
    }
}

}  // namespace mat
