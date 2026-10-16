#include "server/websocket/live_hub.hpp"

#include <algorithm>
#include <cstdio>
#include <iterator>

#include "core/common/json_limits.hpp"
#include "core/common/json_text.hpp"
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

void LiveHub::setRejectedWriteHook(RejectedWriteFn fn) {
    std::lock_guard<std::mutex> g(hubMu_);
    onRejectedWrite_ = std::move(fn);
}

uint64_t LiveHub::overflowClosedTotal() const {
    std::lock_guard<std::mutex> g(hubMu_);
    return overflowClosed_;
}

void LiveHub::sendLocked(uint64_t sid, Session& s, std::string text, int64_t deltaCommitMono) {
    if (s.dead) return;
    const SendQueue::PushResult r = deltaCommitMono != 0
                                        ? tx_.pushDelta(sid, std::move(text), deltaCommitMono)
                                        : tx_.push(sid, std::move(text));
    switch (r) {
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

void LiveHub::setAlarmSource(AlarmLiveSource* source) {
    std::lock_guard<std::mutex> g(hubMu_);
    alarms_ = source;
}

void LiveHub::setRejectedAckHook(RejectedAckFn fn) {
    std::lock_guard<std::mutex> g(hubMu_);
    onRejectedAck_ = std::move(fn);
}

size_t LiveHub::alarmHeldSessions() const {
    std::lock_guard<std::mutex> g(hubMu_);
    size_t n = 0;
    for (const auto& kv : sessions_)
        if (kv.second.holding && !kv.second.dead) ++n;
    return n;
}

namespace {
const char* kZeroCounts =
    "{\"active\":0,\"unack\":0,\"rtnUnack\":0,\"shelved\":0,\"disabled\":0,\"byPriority\":{"
    "\"critical\":{\"active\":0,\"unack\":0},\"major\":{\"active\":0,\"unack\":0},"
    "\"minor\":{\"active\":0,\"unack\":0},\"advisory\":{\"active\":0,\"unack\":0}}}";
}  // namespace

// live 1.3.0 §2: a second subscription replaces the first and sends a new snapshot; the sequence
// goes on.
void LiveHub::subscribeAlarmsLocked(uint64_t sid, Session& s, const std::string& requestId) {
    s.alarmSubscribed = true;
    s.alarmSubscriptionId = requestId;
    s.alarmPending.clear();
    s.snapshot.reset();
    s.holding = false;
    s.alarmWaiting = false;
    AlarmLiveSnapshot snap;
    if (alarms_) {
        snap = alarms_->snapshot(s.authenticated);
    } else {
        snap.counts = kZeroCounts;
    }
    if (!snap.ready) {
        s.alarmWaiting = true;  // §7: not before the first tick of the engine
        return;
    }
    startSnapshotLocked(sid, s, std::move(snap));
}

void LiveHub::startSnapshotLocked(uint64_t sid, Session& s, AlarmLiveSnapshot snap) {
    Session::SnapshotParts p;
    p.classes = std::move(snap.classes);
    p.areas = std::move(snap.areas);
    p.counts = std::move(snap.counts);
    p.revision = snap.revision;
    for (size_t i = 0; i < snap.instances.size(); i += kAlarmChunk) {
        const size_t end = std::min(snap.instances.size(), i + kAlarmChunk);
        p.chunks.emplace_back(std::make_move_iterator(snap.instances.begin() + i),
                              std::make_move_iterator(snap.instances.begin() + end));
    }
    if (p.chunks.empty()) p.chunks.emplace_back();
    ++s.alarmSequence;  // one sequence for every part of this snapshot
    s.snapshot = std::move(p);
    sendSnapshotPartsLocked(sid, s);
}

// The first part at once; the others while the queue is below the high mark (§3.4).
void LiveHub::sendSnapshotPartsLocked(uint64_t sid, Session& s) {
    while (s.snapshot && !s.dead) {
        auto& p = *s.snapshot;
        std::string out = "{\"type\":\"alarmSnapshot\",\"subscriptionId\":";
        appendJsonString(out, s.alarmSubscriptionId);
        out += ",\"sequence\":" + std::to_string(s.alarmSequence) +
               ",\"ts\":" + std::to_string(clock_()) +
               ",\"revision\":" + std::to_string(p.revision) + ",\"instances\":[";
        const auto& chunk = p.chunks[p.next];
        for (size_t k = 0; k < chunk.size(); ++k) {
            if (k) out += ',';
            out += chunk[k];
        }
        out += "],\"classes\":" + p.classes + ",\"areas\":" + p.areas + ",\"counts\":" + p.counts;
        if (p.chunks.size() > 1)
            out += ",\"part\":" + std::to_string(p.next + 1) +
                   ",\"parts\":" + std::to_string(p.chunks.size());
        out += "}";
        if (p.next >
            0) {  // the first part goes at once; the others only if they fit under the mark
            const int fillNow = tx_.queueFillPercent(sid);
            const size_t cap = std::max<size_t>(1, tx_.queueCapacity(sid));
            if (fillNow > 0 &&
                fillNow + static_cast<int>(out.size() * 100 / cap) > kAlarmHoldHighPct)
                return;
        }
        sendLocked(sid, s, std::move(out));
        if (++p.next >= p.chunks.size()) s.snapshot.reset();
    }
}

// §5: held changes go out when the queue allows; the newest instance wins, at most 100 per message.
void LiveHub::flushAlarmLocked(uint64_t sid, Session& s) {
    if (s.alarmPending.empty()) {
        s.holding = false;
        return;
    }
    const int fill = tx_.queueFillPercent(sid);
    const bool go = s.holding ? fill < kAlarmHoldLowPct : fill <= kAlarmHoldHighPct;
    if (!go) {
        s.holding = true;
        return;
    }
    // One message at a time, each only if the queue stays within the high mark WITH it (a message
    // of 100 instances is up to a quarter of the queue): what does not fit waits in the table.
    const size_t capacity = std::max<size_t>(1, tx_.queueCapacity(sid));
    s.holding = false;
    while (!s.alarmPending.empty() && !s.dead) {
        std::string changed, removed;
        std::vector<std::string> taken;
        for (auto it = s.alarmPending.begin();
             it != s.alarmPending.end() && taken.size() < kAlarmChunk; ++it) {
            taken.push_back(it->first);
            if (it->second.empty()) {
                if (!removed.empty()) removed += ',';
                appendJsonString(removed, it->first);
            } else {
                if (!changed.empty()) changed += ',';
                changed += it->second;
            }
        }
        std::string out = "{\"type\":\"alarmDelta\",\"subscriptionId\":";
        appendJsonString(out, s.alarmSubscriptionId);
        out += ",\"sequence\":" + std::to_string(s.alarmSequence + 1) +
               ",\"ts\":" + std::to_string(clock_()) +
               ",\"revision\":" + std::to_string(alarmRevision_) + ",\"changed\":[" + changed +
               "],\"removed\":[" + removed + "],\"counts\":" + alarmCounts_ + "}";
        const int fillNow = tx_.queueFillPercent(sid);  // an empty queue always takes one message
        const int projected = fillNow + static_cast<int>(out.size() * 100 / capacity);
        if (fillNow > 0 && projected > kAlarmHoldHighPct) {
            s.holding = true;
            return;
        }
        ++s.alarmSequence;
        for (const auto& id : taken) s.alarmPending.erase(id);
        sendLocked(sid, s, std::move(out));
    }
}

void LiveHub::alarmTickLocked(int64_t) {
    if (!alarms_) return;
    AlarmLiveBatch b = alarms_->takeChanges();  // drained even when nobody listens
    if (!b.changes.empty()) {
        alarmRevision_ = b.revision;
        alarmCounts_ = b.counts;
    }
    for (auto& kv : sessions_) {
        Session& s = kv.second;
        if (!s.alarmSubscribed || s.dead) continue;
        if (s.alarmWaiting) {
            AlarmLiveSnapshot snap = alarms_->snapshot(s.authenticated);
            if (!snap.ready) continue;
            s.alarmWaiting = false;
            startSnapshotLocked(kv.first, s, std::move(snap));
            continue;  // changes since are in the snapshot or come with the next batch
        }
        for (const auto& c : b.changes)
            s.alarmPending[c.id] = s.authenticated ? c.json : c.publicJson;
        if (s.snapshot) {  // parts first; the changes wait behind the last part
            sendSnapshotPartsLocked(kv.first, s);
            if (s.snapshot) continue;
        }
        flushAlarmLocked(kv.first, s);
    }
}

void LiveHub::onOpen(uint64_t sid, bool authenticated) {
    std::lock_guard<std::mutex> g(hubMu_);
    Session& s = sessions_[sid];
    s.authenticated = authenticated;
    char buf[256];
    std::snprintf(buf, sizeof buf,
                  "{\"type\":\"hello\",\"protocolVersion\":\"%s\",\"serverVersion\":\"%s\","
                  "\"maxClients\":%zu,\"heartbeatMs\":%lld,\"timeoutMs\":%lld,%s\"project\":",
                  kLiveProtocolVersion, opt_.serverVersion.c_str(), opt_.maxClients,
                  static_cast<long long>(opt_.heartbeatMs), static_cast<long long>(opt_.timeoutMs),
                  alarms_ && alarms_->hasAlarms() ? "\"features\":[\"alarms\"]," : "");
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
    sendLocked(sid, s, jsonText(e));
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
    if (type == "subscribeAlarms") {
        if (requestId.empty()) return bad("subscribeAlarms cần requestId");
        const int64_t now = mono_();
        auto& times = s.alarmSubscribeTimes;
        while (!times.empty() && now - times.front() >= kAlarmSubscribeWindowMs)
            times.erase(times.begin());
        if (static_cast<int>(times.size()) >= kAlarmSubscribeLimit)
            return bad("subscribeAlarms quá nhanh", requestId);
        times.push_back(now);
        s.errorStreak = 0;
        subscribeAlarmsLocked(sid, s, requestId);
        return;
    }
    if (type == "unsubscribeAlarms") {
        s.errorStreak = 0;
        s.alarmSubscribed = false;
        s.alarmWaiting = false;
        s.snapshot.reset();
        s.alarmPending.clear();
        s.holding = false;
        return;
    }
    if ((type == "ack" || type == "alarmAck") && onRejectedAck_) {  // live 1.3.0 §8
        std::string id, occ;
        if (m.contains("id") && m["id"].is_string()) id = m["id"].get<std::string>().substr(0, 64);
        if (m.contains("occurrence")) occ = m["occurrence"].dump().substr(0, 64);
        onRejectedAck_(id, occ, sid);
    }
    if (type == "write" && onRejectedWrite_) {  // live 1.2.0 §4: refused, and told to the audit
        std::string tag, value;
        if (m.contains("tag") && m["tag"].is_string())
            tag = m["tag"].get<std::string>().substr(0, 64);
        if (m.contains("value")) value = m["value"].dump().substr(0, 256);
        onRejectedWrite_(tag, value, sid);
    }
    bad("type không hỗ trợ: " + type, requestId);
}

void LiveHub::tick(int64_t commitMono) {
    std::lock_guard<std::mutex> g(hubMu_);
    const int64_t now = clock_();
    const int64_t monoNow = mono_();
    const int64_t commit = commitMono != 0 ? commitMono : monoNow;
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
            sendLocked(kv.first, s, out, commit);
        }
    }
    alarmTickLocked(now);
    if (monoNow >= nextHeartbeat_) {
        nextHeartbeat_ = monoNow + opt_.heartbeatMs;
        const std::string hb = "{\"type\":\"heartbeat\",\"ts\":" + std::to_string(now) + "}";
        for (auto& kv : sessions_) sendLocked(kv.first, kv.second, hb);
    }
}

}  // namespace mat
