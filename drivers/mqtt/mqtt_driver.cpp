#include "drivers/mqtt/mqtt_driver.hpp"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <exception>
#include <set>
#include <thread>

#include "core/common/thread_name.hpp"
#include "drivers/mqtt/payload.hpp"

namespace mat::drv {

namespace {

constexpr int kReadSliceMs = 50;  // longest wait of the connected loop (a write wakes it then)
constexpr size_t kFiltersPerSubscribe = 32;

std::vector<std::string> deviceIds(const MqttConfig& c) {
    if (!c.hasDevice) return {};
    return {c.deviceId};
}

bool subscribes(const mqtt::Address& a) { return a.dir != mqtt::Direction::Publish; }

}  // namespace

MqttDriver::MqttDriver(MqttConfig config, MqttEnv env)
    : cfg_(std::move(config)),
      env_(std::move(env)),
      clock_(env_.clock ? env_.clock : &systemClock_),
      diag_(cfg_.channelId, deviceIds(cfg_)),
      backoff_(cfg_.reconnectMaxS, env_.uniform),
      lastBad_(cfg_.tags.size()),
      lastRaw_(cfg_.tags.size()),
      lastMsgMs_(cfg_.tags.size(), 0),
      stale_(cfg_.tags.size(), false),
      groups_(cfg_.groups.size()) {
    if (cfg_.maxPublishPerS < 1) cfg_.maxPublishPerS = 1;
    if (env_.groupCheckMs < 10) env_.groupCheckMs = 10;
    for (size_t i = 0; i < cfg_.tags.size(); ++i) {
        localOf_[cfg_.tags[i].tag] = i;
        const mqtt::Address& a = cfg_.tags[i].addr;
        if (!subscribes(a)) continue;
        auto it = byFilter_.find(a.topic);
        if (it == byFilter_.end()) {
            filters_.emplace_back(a.topic, a.qos);
            if (a.wildcard) wildcardFilters_.push_back(filters_.size() - 1);
            byFilter_[a.topic] = {i};
        } else {
            it->second.push_back(i);
            for (auto& f : filters_)
                if (f.first == a.topic) f.second = std::max(f.second, a.qos);
        }
    }
    const bool on = cfg_.hasDevice && cfg_.deviceEnabled;
    deviceState_ = static_cast<int>(on ? DeviceState::Active : DeviceState::Disabled);
    if (cfg_.hasDevice) diag_.setDeviceState(0, on ? "active" : "disabled");
    tokens_ = cfg_.maxPublishPerS;
    updateDetails();
}

MqttDriver::~MqttDriver() { stop(); }

// ---- State and publishing -----------------------------------------------------------------------

void MqttDriver::setChannelState(ChannelState s) {
    channelState_ = static_cast<int>(s);
    static const char* const kNames[] = {"disabled", "connecting", "opening", "connected", "error"};
    diag_.setChannelState(kNames[static_cast<int>(s)]);
}

void MqttDriver::setDeviceState(DeviceState s) {
    if (!cfg_.hasDevice) return;
    if (deviceState_.exchange(static_cast<int>(s)) == static_cast<int>(s)) return;
    diag_.setDeviceState(
        0, s == DeviceState::Active ? "active" : s == DeviceState::Error ? "error" : "disabled");
}

LinkState MqttDriver::linkState(uint32_t device) const {
    LinkState s;
    s.channel = static_cast<ChannelState>(channelState_.load());
    s.device = device == 0 ? static_cast<DeviceState>(deviceState_.load()) : DeviceState::Disabled;
    return s;
}

void MqttDriver::updateDetails() {
    std::vector<std::pair<std::string, std::string>> d = {
        {"broker", cfg_.host + ":" + std::to_string(cfg_.port)},
        {"tls", cfg_.tls.enabled ? "on" : "off"},
        {"clientId", cfg_.clientId},
        {"subscriptions", std::to_string(filters_.size())},
        {"groups", std::to_string(cfg_.groups.size())},
    };
    {
        std::lock_guard<std::mutex> g(detailsMu_);
        d.emplace_back("messagesIn", std::to_string(messagesIn_));
        d.emplace_back("messagesOut", std::to_string(messagesOut_));
        d.emplace_back("dropped", std::to_string(dropped_));
    }
    if (!link_.peerCertSha256().empty()) d.emplace_back("serverCertSha256", link_.peerCertSha256());
    diag_.setDetails(std::move(d));
}

void MqttDriver::diagnostics(DriverDiag& out, int64_t /*nowMs*/) const {
    out = diag_.snapshot(clock_->monoMs());
}

TestOutcome MqttDriver::test(const TestRequest& /*req*/) {
    TestOutcome out;
    out.code = "NOT_SUPPORTED";
    return out;
}

void MqttDriver::publishBad(const std::vector<size_t>& locals, const std::string& reason) {
    std::vector<TagUpdate> ups;
    const int64_t w = wall();
    for (size_t t : locals) {
        if (lastBad_[t] == reason) continue;
        lastBad_[t] = reason;
        stale_[t] = false;
        TagUpdate u;
        u.tag = cfg_.tags[t].tag;
        u.quality = Quality::BAD;
        u.reason = reason;
        u.sourceTs = w;
        ups.push_back(std::move(u));
    }
    if (!ups.empty() && sink_) sink_->publish(std::move(ups));
}

void MqttDriver::publishBadAll(const std::string& reason) {
    if (!cfg_.deviceEnabled) return;  // DISABLED stays
    std::vector<size_t> all(cfg_.tags.size());
    for (size_t i = 0; i < all.size(); ++i) all[i] = i;
    publishBad(all, reason);
}

// ---- Connection ---------------------------------------------------------------------------------

uint16_t MqttDriver::nextPacketId() {
    if (++packetId_ == 0) packetId_ = 1;
    return packetId_;
}

bool MqttDriver::send(const std::vector<uint8_t>& bytes) {
    if (!link_.writeAll(bytes.data(), bytes.size(), cfg_.timeoutMs)) return false;
    lastTxMs_ = mono();
    return true;
}

void MqttDriver::failConnect(const std::string& code, const std::string& reason) {
    link_.close();
    framer_.clear();
    connected_ = false;
    lastError_ = code;
    diag_.setLastError(code, wall(), cfg_.deviceId);
    setChannelState(ChannelState::Connecting);
    setDeviceState(DeviceState::Error);
    publishBadAll(reason);
    failQueuedWrites("NOT_SENT_DISCONNECTED");
    nextConnectMs_ = mono() + backoff_.nextDelayMs();
    updateDetails();
}

void MqttDriver::dropConnection(const std::string& code) {
    failInFlight("WRITE_TIMEOUT");
    failConnect(code, "DISCONNECTED");
    diag_.onReconnect();
}

void MqttDriver::connectNow() {
    setChannelState(ChannelState::Opening);
    mqtt::ConnectOptions o;
    o.clientId = cfg_.clientId;
    o.keepAliveS = cfg_.keepAliveS;
    o.cleanSession = cfg_.cleanSession;
    if (cfg_.hasAuth) {
        std::optional<std::string> pw;
        if (env_.password) pw = env_.password(cfg_.secretId);
        if (!pw) {
            failConnect("MQTT_SECRET_MISSING", "MQTT_SECRET_MISSING");
            return;
        }
        o.hasUsername = true;
        o.username = cfg_.username;
        o.hasPassword = true;
        o.password = *pw;
    }
    if (cfg_.hasWill) {
        o.hasWill = true;
        o.willTopic = cfg_.willTopic;
        o.willPayload = cfg_.willPayload;
        o.willQos = cfg_.willQos;
        o.willRetain = cfg_.willRetain;
    }
    const std::string linkCode = link_.open(cfg_.host, cfg_.port, cfg_.connectTimeoutMs, cfg_.tls);
    if (!linkCode.empty()) {
        const bool tlsCode = linkCode.rfind("MQTT_", 0) == 0;
        failConnect(linkCode, tlsCode ? linkCode : "DISCONNECTED");
        return;
    }
    framer_.clear();
    lastRxMs_ = mono();
    if (!send(mqtt::encodeConnect(o))) {
        failConnect("DISCONNECTED", "DISCONNECTED");
        return;
    }
    // CONNACK within timeoutMs
    const int64_t deadline = mono() + cfg_.timeoutMs;
    mqtt::Packet p;
    bool got = false;
    while (!stopping_ && mono() < deadline && !got) {
        uint8_t buf[512];
        const ReadResult r = link_.read(buf, sizeof buf, kReadSliceMs);
        if (r.code == ReadCode::Data) {
            framer_.feed(buf, r.n);
            const auto res = framer_.next(p);
            if (res == mqtt::Framer::Result::Error) break;
            got = res == mqtt::Framer::Result::Ready;
        } else if (r.code != ReadCode::Timeout) {
            break;
        }
    }
    mqtt::Connack ack;
    if (!got || !mqtt::parseConnack(p, ack)) {
        failConnect(got ? "MQTT_PROTOCOL" : "TIMEOUT", "DISCONNECTED");
        return;
    }
    if (ack.returnCode != 0) {
        const char* code = ack.returnCode == 4 || ack.returnCode == 5 ? "MQTT_AUTH_FAILED"
                                                                      : "MQTT_CONNECT_REFUSED";
        failConnect(code, code);
        return;
    }
    connected_ = true;
    lastRxMs_ = mono();
    pingOutstanding_ = false;
    // Subscriptions, 32 filters per SUBSCRIBE; publishes that come first are handled on the way.
    for (size_t at = 0; at < filters_.size() && connected_; at += kFiltersPerSubscribe) {
        mqtt::Subscribe s;
        s.packetId = nextPacketId();
        const size_t end = std::min(filters_.size(), at + kFiltersPerSubscribe);
        for (size_t i = at; i < end; ++i) s.filters.push_back(filters_[i]);
        if (!send(mqtt::encodeSubscribe(s))) {
            dropConnection("DISCONNECTED");
            return;
        }
        const int64_t until = mono() + cfg_.timeoutMs;
        bool acked = false;
        while (!stopping_ && connected_ && !acked && mono() < until) {
            uint8_t buf[4096];
            const ReadResult r = link_.read(buf, sizeof buf, kReadSliceMs);
            if (r.code == ReadCode::Data) {
                framer_.feed(buf, r.n);
                mqtt::Packet q;
                while (connected_) {
                    const auto res = framer_.next(q);
                    if (res == mqtt::Framer::Result::Need) break;
                    if (res == mqtt::Framer::Result::Error) {
                        dropConnection("MQTT_PROTOCOL");
                        return;
                    }
                    uint16_t id = 0;
                    std::vector<uint8_t> codes;
                    if (q.type == mqtt::PacketType::Suback && mqtt::parseSuback(q, id, codes) &&
                        id == s.packetId) {
                        acked = true;
                        std::vector<size_t> refused;
                        for (size_t k = 0; k < codes.size() && k < s.filters.size(); ++k)
                            if (codes[k] == 0x80)
                                for (size_t local : byFilter_[s.filters[k].first])
                                    refused.push_back(local);
                        if (!refused.empty()) {
                            diag_.setLastError("MQTT_SUBSCRIBE_REFUSED", wall(), cfg_.deviceId);
                            publishBad(refused, "MQTT_SUBSCRIBE_REFUSED");
                        }
                    } else {
                        handle(q);
                    }
                }
            } else if (r.code != ReadCode::Timeout) {
                dropConnection("DISCONNECTED");
                return;
            }
        }
        if (!acked && connected_) {
            dropConnection("TIMEOUT");
            return;
        }
    }
    if (!connected_) return;
    backoff_.reset();
    setChannelState(ChannelState::Connected);
    setDeviceState(DeviceState::Active);
    // Tags still BAD from the lost link: a subscribed Tag waits for its next message (NO_VALUE,
    // the engine keeps the last value; stale counting starts now), a Tag that only publishes shows
    // what it last wrote again. A refused subscription and a message that came already stay.
    const int64_t now = mono();
    std::vector<size_t> waiting;
    std::vector<TagUpdate> back;
    for (size_t i = 0; i < cfg_.tags.size(); ++i) {
        lastMsgMs_[i] = now;
        const std::string& bad = lastBad_[i];
        if (bad != "DISCONNECTED" && (bad.rfind("MQTT_", 0) != 0 || bad == "MQTT_PAYLOAD" ||
                                      bad == "MQTT_SUBSCRIBE_REFUSED"))
            continue;
        if (subscribes(cfg_.tags[i].addr) || std::holds_alternative<std::monostate>(lastRaw_[i])) {
            waiting.push_back(i);
            continue;
        }
        lastBad_[i].clear();
        TagUpdate u;
        u.tag = cfg_.tags[i].tag;
        u.value = lastRaw_[i];
        u.sourceTs = wall();
        back.push_back(std::move(u));
    }
    publishBad(waiting, "NO_VALUE");
    if (!back.empty() && sink_) sink_->publish(std::move(back));
    for (size_t g = 0; g < groups_.size(); ++g) {
        groups_[g].nextDueMs = now;
        groups_[g].nextCheckMs = now;
        groups_[g].lastSig.clear();
    }
    updateDetails();
}

// ---- Receiving ----------------------------------------------------------------------------------

bool MqttDriver::pump(int waitMs) {
    uint8_t buf[4096];
    const ReadResult r = link_.read(buf, sizeof buf, waitMs);
    if (r.code == ReadCode::Timeout || r.code == ReadCode::Interrupted) {
        link_.clearInterrupt();
        return true;
    }
    if (r.code != ReadCode::Data) return false;
    framer_.feed(buf, r.n);
    mqtt::Packet p;
    while (connected_) {
        const auto res = framer_.next(p);
        if (res == mqtt::Framer::Result::Need) break;
        if (res == mqtt::Framer::Result::Error) {
            {
                std::lock_guard<std::mutex> g(detailsMu_);
                ++dropped_;
            }
            dropConnection("MQTT_PROTOCOL");
            return true;
        }
        handle(p);
    }
    return true;
}

void MqttDriver::handle(const mqtt::Packet& p) {
    lastRxMs_ = mono();
    switch (p.type) {
        case mqtt::PacketType::Publish: {
            mqtt::Publish m;
            if (!mqtt::parsePublish(p, m)) {
                diag_.onBadFrame(0, BadFrameKind::Format);
                return;
            }
            if (m.qos == 1) send(mqtt::encodePuback(m.packetId));
            onPublish(m);
            return;
        }
        case mqtt::PacketType::Puback: {
            uint16_t id = 0;
            if (!mqtt::parsePacketId(p, id) || !inflight_.active || id != inflight_.packetId)
                return;
            const InFlight f = inflight_;
            inflight_.active = false;
            const MqttTagBinding& b = cfg_.tags[f.local];
            if (b.addr.dir == mqtt::Direction::Publish && sink_) {
                TagUpdate u;
                u.tag = b.tag;
                u.value = f.raw;
                u.sourceTs = wall();
                u.afterWrite = true;
                lastRaw_[f.local] = f.raw;
                lastBad_[f.local].clear();
                sink_->publish({u});
            }
            WriteResult res;
            res.id = f.id;
            res.status = WriteStatus::NoReadback;
            res.code = "NO_READBACK";
            finishWrite(std::move(res));
            return;
        }
        case mqtt::PacketType::Pingresp:
            pingOutstanding_ = false;
            return;
        default:
            return;  // SUBACK of nothing, others: ignored
    }
}

void MqttDriver::onPublish(const mqtt::Publish& m) {
    {
        std::lock_guard<std::mutex> g(detailsMu_);
        ++messagesIn_;
        if (m.payload.size() > mqtt::kMaxPayload) {
            ++dropped_;
            return;
        }
    }
    std::vector<size_t> locals;
    auto it = byFilter_.find(m.topic);
    if (it != byFilter_.end()) locals = it->second;  // a topic never equals a wildcard filter
    for (size_t fi : wildcardFilters_)
        if (mqtt::topicMatches(filters_[fi].first, m.topic)) {
            const auto& more = byFilter_[filters_[fi].first];
            locals.insert(locals.end(), more.begin(), more.end());
        }
    if (locals.empty()) return;
    const int64_t now = mono(), w = wall();
    std::vector<TagUpdate> ups;
    for (size_t local : locals) {
        const MqttTagBinding& b = cfg_.tags[local];
        const mqtt::Decoded d =
            mqtt::decodePayload(m.payload, b.addr.hasPath, b.addr.steps, b.rawType, b.stringLength);
        TagUpdate u;
        u.tag = b.tag;
        u.sourceTs = w;
        lastMsgMs_[local] = now;
        stale_[local] = false;
        if (d.ok) {
            u.value = d.value;
            lastRaw_[local] = d.value;
            lastBad_[local].clear();
        } else {
            if (lastBad_[local] == "MQTT_PAYLOAD") continue;
            u.quality = Quality::BAD;
            u.reason = "MQTT_PAYLOAD";
            lastBad_[local] = "MQTT_PAYLOAD";
        }
        ups.push_back(std::move(u));
    }
    if (cfg_.hasDevice) diag_.onRequestOk(0, 0, now);
    if (!ups.empty() && sink_) sink_->publish(std::move(ups));
}

void MqttDriver::checkStale() {
    if (cfg_.staleAfterMs <= 0) return;
    const int64_t now = mono();
    std::vector<TagUpdate> ups;
    for (size_t i = 0; i < cfg_.tags.size(); ++i) {
        if (stale_[i] || !subscribes(cfg_.tags[i].addr) || !lastBad_[i].empty()) continue;
        if (std::holds_alternative<std::monostate>(lastRaw_[i])) continue;  // no value yet
        if (now - lastMsgMs_[i] < cfg_.staleAfterMs) continue;
        stale_[i] = true;
        TagUpdate u;
        u.tag = cfg_.tags[i].tag;
        u.value = lastRaw_[i];
        u.quality = Quality::UNCERTAIN;
        u.reason = "MQTT_STALE";
        u.sourceTs = wall();
        ups.push_back(std::move(u));
    }
    if (!ups.empty() && sink_) sink_->publish(std::move(ups));
}

// ---- Writes and groups --------------------------------------------------------------------------

bool MqttDriver::takeToken() {
    const int64_t now = mono();
    tokens_ = std::min<double>(cfg_.maxPublishPerS,
                               tokens_ + (now - tokensAtMs_) * cfg_.maxPublishPerS / 1000.0);
    tokensAtMs_ = now;
    if (tokens_ < 1) return false;
    tokens_ -= 1;
    return true;
}

bool MqttDriver::enqueueWrite(WriteCommand cmd) {
    if (!started_ || stopping_ || !cfg_.enabled || !cfg_.deviceEnabled) return false;
    const auto it = localOf_.find(cmd.tag);
    if (it == localOf_.end() || !cfg_.tags[it->second].addr.ok) return false;
    std::lock_guard<std::mutex> g(wmu_);
    if (!cmd.priority && writes_.size() >= static_cast<size_t>(cfg_.writeQueueCapacity))
        return false;
    if (cmd.priority)
        writes_.push_front({std::move(cmd), mono()});
    else
        writes_.push_back({std::move(cmd), mono()});
    return true;
}

std::vector<uint64_t> MqttDriver::cancelQueuedWrites() {
    std::vector<uint64_t> ids;
    std::lock_guard<std::mutex> g(wmu_);
    for (const auto& w : writes_) ids.push_back(w.cmd.id);
    writes_.clear();
    return ids;
}

void MqttDriver::finishWrite(WriteResult&& r) {
    WriteOutcome o = WriteOutcome::Failed;
    if (r.status == WriteStatus::Confirmed || r.status == WriteStatus::NoReadback)
        o = WriteOutcome::Confirmed;
    else if (r.status == WriteStatus::Timeout)
        o = WriteOutcome::Timeout;
    if (cfg_.hasDevice) diag_.onWrite(0, o);
    if (!stopping_ && sink_) sink_->writeDone(std::move(r));
}

void MqttDriver::failQueuedWrites(const char* code) {
    std::deque<QueuedWrite> q;
    {
        std::lock_guard<std::mutex> g(wmu_);
        q.swap(writes_);
    }
    for (auto& w : q) {
        WriteResult r;
        r.id = w.cmd.id;
        r.status = WriteStatus::Failed;
        r.code = code;
        finishWrite(std::move(r));
    }
}

void MqttDriver::failInFlight(const char* code) {
    if (!inflight_.active) return;
    inflight_.active = false;
    WriteResult r;
    r.id = inflight_.id;
    r.status = WriteStatus::Timeout;
    r.code = code;
    finishWrite(std::move(r));
}

void MqttDriver::runWrite() {
    if (inflight_.active) {
        if (mono() - inflight_.sentMs > cfg_.timeoutMs) failInFlight("WRITE_TIMEOUT");
        return;
    }
    QueuedWrite w;
    {
        std::lock_guard<std::mutex> g(wmu_);
        // drop what waited past its deadline
        while (!writes_.empty() &&
               mono() - writes_.front().enqueuedMs > writes_.front().cmd.deadlineMs) {
            QueuedWrite late = std::move(writes_.front());
            writes_.pop_front();
            WriteResult r;
            r.id = late.cmd.id;
            r.status = WriteStatus::Failed;
            r.code = "NOT_SENT_DEADLINE";
            wmu_.unlock();
            finishWrite(std::move(r));
            wmu_.lock();
        }
        if (writes_.empty()) return;
        if (!takeToken()) return;  // the rate limit: try again on the next round
        w = std::move(writes_.front());
        writes_.pop_front();
    }
    const size_t local = localOf_.at(w.cmd.tag);
    const MqttTagBinding& b = cfg_.tags[local];
    mqtt::Publish m;
    m.topic = b.addr.topic;
    m.payload = mqtt::encodePayload(w.cmd.raw, b.rawType, b.addr.hasPath, b.addr.steps);
    m.qos = b.addr.qos;
    m.retain = b.addr.retain;
    if (m.qos > 0) m.packetId = nextPacketId();
    if (!send(mqtt::encodePublish(m))) {
        WriteResult r;
        r.id = w.cmd.id;
        r.status = WriteStatus::Failed;
        r.code = "NOT_SENT_DISCONNECTED";
        finishWrite(std::move(r));
        dropConnection("DISCONNECTED");
        return;
    }
    {
        std::lock_guard<std::mutex> g(detailsMu_);
        ++messagesOut_;
    }
    if (m.qos > 0) {
        inflight_.active = true;
        inflight_.id = w.cmd.id;
        inflight_.packetId = m.packetId;
        inflight_.sentMs = mono();
        inflight_.local = local;
        inflight_.raw = w.cmd.raw;
        return;
    }
    if (b.addr.dir == mqtt::Direction::Publish && sink_) {
        TagUpdate u;
        u.tag = b.tag;
        u.value = w.cmd.raw;
        u.sourceTs = wall();
        u.afterWrite = true;
        lastRaw_[local] = w.cmd.raw;
        lastBad_[local].clear();
        sink_->publish({u});
    }
    WriteResult r;
    r.id = w.cmd.id;
    r.status = WriteStatus::NoReadback;
    r.code = "NO_READBACK";
    finishWrite(std::move(r));
}

void MqttDriver::runGroups() {
    if (!env_.snapshot) return;
    const int64_t now = mono();
    for (size_t g = 0; g < cfg_.groups.size(); ++g) {
        const MqttGroupConfig& gc = cfg_.groups[g];
        GroupState& st = groups_[g];
        const bool periodic = gc.intervalMs > 0 && now >= st.nextDueMs;
        const bool check = gc.onChange && now >= st.nextCheckMs;
        if (!periodic && !check && !st.pending) continue;
        std::vector<TagValue> values;
        env_.snapshot(gc.tags, values);
        std::vector<mqtt::GroupEntry> entries;
        for (size_t k = 0; k < gc.tags.size() && k < values.size(); ++k)
            entries.push_back({gc.ids[k], values[k]});
        // the signature leaves out the time, so only a value or a quality counts as a change
        const std::string sig = mqtt::encodeGroup(0, entries);
        if (check) st.nextCheckMs = now + env_.groupCheckMs;
        const bool changed = check && sig != st.lastSig;
        if (!periodic && !changed && !st.pending) continue;
        if (!takeToken()) {
            st.pending = true;
            continue;
        }
        st.pending = false;
        mqtt::Publish m;
        m.topic = gc.topic;
        m.payload = mqtt::encodeGroup(wall(), entries);
        m.qos = gc.qos;
        m.retain = gc.retain;
        if (m.qos > 0) m.packetId = nextPacketId();  // its PUBACK is not waited for
        if (!send(mqtt::encodePublish(m))) {
            dropConnection("DISCONNECTED");
            return;
        }
        {
            std::lock_guard<std::mutex> lk(detailsMu_);
            ++messagesOut_;
        }
        st.lastSig = sig;
        if (gc.intervalMs > 0 && now >= st.nextDueMs) st.nextDueMs = now + gc.intervalMs;
    }
}

// ---- The thread ---------------------------------------------------------------------------------

void MqttDriver::start(EngineSink& sink) {
    if (started_) return;
    sink_ = &sink;
    started_ = true;
    stopping_ = false;
    if (!cfg_.enabled) {
        setChannelState(ChannelState::Disabled);
        publishBadAll("DISABLED");
        return;
    }
    if (!cfg_.deviceEnabled) {
        std::vector<size_t> all(cfg_.tags.size());
        for (size_t i = 0; i < all.size(); ++i) all[i] = i;
        publishBad(all, "DISABLED");
    }
    setChannelState(ChannelState::Connecting);
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setstacksize(&attr, 256 * 1024);
    if (pthread_create(&thread_, &attr, &MqttDriver::threadMain, this) == 0) threadRunning_ = true;
    pthread_attr_destroy(&attr);
    if (!threadRunning_) {
        std::fprintf(stderr, "mqtt %s: cannot start the channel thread\n", cfg_.channelId.c_str());
        setChannelState(ChannelState::Error);
    }
}

void* MqttDriver::threadMain(void* self) {
    mat::setThreadName("mat-mqtt");
    auto* d = static_cast<MqttDriver*>(self);
    try {
        d->loop();
    } catch (const std::exception& e) {
        std::fprintf(stderr, "mqtt %s: %s\n", d->cfg_.channelId.c_str(), e.what());
        d->setChannelState(ChannelState::Error);
    }
    if (d->connected_) d->send(mqtt::encodeDisconnect());
    d->link_.close();
    return nullptr;
}

void MqttDriver::stop() {
    if (!started_) return;
    stopping_ = true;
    link_.interrupt();
    if (threadRunning_) {
        pthread_join(thread_, nullptr);
        threadRunning_ = false;
    }
    link_.close();
    started_ = false;
}

void MqttDriver::idle(int64_t untilMs) {
    while (!stopping_ && mono() < untilMs) {
        const int64_t step = std::min<int64_t>(untilMs - mono(), kReadSliceMs);
        std::this_thread::sleep_for(std::chrono::milliseconds(std::max<int64_t>(step, 1)));
        std::lock_guard<std::mutex> g(wmu_);
        if (!writes_.empty()) break;  // fail them at once (not connected)
    }
}

void MqttDriver::loop() {
    while (!stopping_) {
        if (!cfg_.hasDevice || !cfg_.deviceEnabled) {
            idle(mono() + 1000);
            continue;
        }
        if (!connected_) {
            failQueuedWrites("NOT_SENT_DISCONNECTED");
            if (mono() < nextConnectMs_) {
                idle(nextConnectMs_);
                continue;
            }
            connectNow();
            continue;
        }
        runWrite();
        if (connected_) runGroups();
        if (!connected_) continue;
        checkStale();
        const int64_t now = mono();
        const int64_t keepMs = static_cast<int64_t>(cfg_.keepAliveS) * 1000;
        if (keepMs > 0) {
            if (pingOutstanding_ &&
                now - pingSentMs_ > std::max<int64_t>(cfg_.timeoutMs, keepMs / 2)) {
                dropConnection("TIMEOUT");
                continue;
            }
            if (!pingOutstanding_ && now - lastTxMs_ >= keepMs) {
                if (!send(mqtt::encodePingreq())) {
                    dropConnection("DISCONNECTED");
                    continue;
                }
                pingOutstanding_ = true;
                pingSentMs_ = now;
            }
            if (now - lastRxMs_ > keepMs * 3 / 2 + cfg_.timeoutMs) {
                dropConnection("TIMEOUT");
                continue;
            }
        }
        int wait = kReadSliceMs;
        {
            std::lock_guard<std::mutex> g(wmu_);
            if (!writes_.empty() && !inflight_.active) wait = 5;
        }
        if (!pump(wait)) {
            dropConnection("DISCONNECTED");
            continue;
        }
        if (now - lastDetailsMs_ >= 1000) {
            lastDetailsMs_ = now;
            updateDetails();
        }
    }
}

}  // namespace mat::drv
