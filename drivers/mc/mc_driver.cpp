#include "drivers/mc/mc_driver.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <exception>
#include <limits>
#include <optional>

#include "core/common/thread_name.hpp"
#include "drivers/mc/udp_socket.hpp"
#include "drivers/sdk/merge_planner.hpp"
#include "drivers/sdk/tcp_socket.hpp"

namespace mat::drv {

using mc::Cmd;
using mc::Device;

namespace {

constexpr int64_t kIdleCapMs = 1000;
constexpr int kDeviceBackoffCapS = 30;  // FR-007: the backoff of a device, 1 s to 30 s
constexpr int kTimeoutsToClose = 3;
constexpr size_t kLateSerialsKept = 64;

std::vector<std::string> deviceIds(const McConfig& c) {
    std::vector<std::string> ids;
    for (const auto& d : c.devices) ids.push_back(d.id);
    return ids;
}

bool asBool(const TagScalar& v, bool& out) {
    if (const bool* b = std::get_if<bool>(&v)) {
        out = *b;
        return true;
    }
    if (const int64_t* i = std::get_if<int64_t>(&v)) {
        out = *i != 0;
        return true;
    }
    if (const uint64_t* u = std::get_if<uint64_t>(&v)) {
        out = *u != 0;
        return true;
    }
    if (const double* d = std::get_if<double>(&v)) {
        out = *d != 0;
        return true;
    }
    return false;
}

// The raw value of a write in the variant the codec wants for `type` (as the Modbus driver).
bool coerceNumber(TagType type, const TagScalar& v, TagScalar& out) {
    const bool isFloat = type == TagType::FLOAT32 || type == TagType::FLOAT64;
    const bool isSigned =
        type == TagType::INT16 || type == TagType::INT32 || type == TagType::INT64;
    if (isFloat) {
        if (const double* d = std::get_if<double>(&v))
            out = *d;
        else if (const int64_t* i = std::get_if<int64_t>(&v))
            out = static_cast<double>(*i);
        else if (const uint64_t* u = std::get_if<uint64_t>(&v))
            out = static_cast<double>(*u);
        else
            return false;
        return true;
    }
    if (isSigned) {
        if (const int64_t* i = std::get_if<int64_t>(&v))
            out = *i;
        else if (const uint64_t* u = std::get_if<uint64_t>(&v)) {
            if (*u > static_cast<uint64_t>(std::numeric_limits<int64_t>::max())) return false;
            out = static_cast<int64_t>(*u);
        } else if (const double* d = std::get_if<double>(&v)) {
            if (!std::isfinite(*d)) return false;
            out = static_cast<int64_t>(std::llround(*d));
        } else
            return false;
        return true;
    }
    if (const uint64_t* u = std::get_if<uint64_t>(&v))
        out = *u;
    else if (const int64_t* i = std::get_if<int64_t>(&v)) {
        if (*i < 0) return false;
        out = static_cast<uint64_t>(*i);
    } else if (const double* d = std::get_if<double>(&v)) {
        if (!std::isfinite(*d) || *d < 0) return false;
        out = static_cast<uint64_t>(std::llround(*d));
    } else
        return false;
    return true;
}

// The word index of a Tag inside its device code: a bit device is read 16 points per word.
uint32_t wordIndexOf(const McTagBinding& t) { return t.bitDevice ? t.number / 16 : t.number; }

// The device number a request starts at for word index `start`.
uint32_t numberOf(Device dev, uint32_t start) {
    return mc::deviceInfo(dev).bit ? start * 16 : start;
}

BadFrameKind frameIssueCounter(mc::Issue i) {
    switch (i) {
        case mc::Issue::Route:
            return BadFrameKind::Unit;
        case mc::Issue::Serial:
            return BadFrameKind::Tid;
        case mc::Issue::Length:
            return BadFrameKind::Length;
        default:
            return BadFrameKind::Format;
    }
}

}  // namespace

const char* mcEndReason(uint16_t e) {
    switch (e) {
        case 0xC051:
        case 0xC052:
        case 0xC053:
        case 0xC054:
        case 0xC056:
        case 0x4030:
        case 0x4031:
            return "MC_END_RANGE";
        case 0xC05B:
        case 0xC05C:
        case 0xC060:
            return "MC_END_DEVICE";
        case 0xC050:
        case 0xC058:
        case 0xC059:
        case 0xC05F:
        case 0xC061:
        case 0xC06F:
            return "MC_END_COMMAND";
        default:
            return "MC_END_OTHER";
    }
}

std::string mcEndCodeHex(int endCode) {
    char b[8];
    std::snprintf(b, sizeof b, "%04X", static_cast<unsigned>(endCode) & 0xFFFFu);
    return b;
}

const char* mcEndMeaning(uint16_t endCode) {
    const std::string r = mcEndReason(endCode);
    if (r == "MC_END_RANGE") return "địa chỉ hoặc số điểm ngoài vùng của PLC";
    if (r == "MC_END_DEVICE") return "PLC không cho đọc/ghi thiết bị này (cấm ghi khi RUN?)";
    if (r == "MC_END_COMMAND") return "PLC không nhận lệnh (mã truyền binary/ASCII?)";
    return "end code khác của PLC";
}

std::vector<size_t> McDriver::Block::tags() const {
    std::vector<size_t> all;
    for (const Entry& e : entries) all.insert(all.end(), e.tags.begin(), e.tags.end());
    return all;
}

McDriver::McDriver(McConfig config, McEnv env)
    : cfg_(std::move(config)),
      env_(std::move(env)),
      clock_(env_.clock ? env_.clock : &systemClock_),
      diag_(cfg_.channelId, deviceIds(cfg_)),
      backoff_(cfg_.reconnectMaxS, env_.uniform),
      lastBad_(cfg_.tags.size()) {
    const size_t n = std::max<size_t>(1, cfg_.devices.size());
    deviceState_ = std::make_unique<std::atomic<int>[]>(n);
    for (size_t d = 0; d < cfg_.devices.size(); ++d) {
        const bool on = cfg_.devices[d].enabled;
        deviceState_[d] = static_cast<int>(on ? DeviceState::Active : DeviceState::Disabled);
        diag_.setDeviceState(d, on ? "active" : "disabled");
    }
    for (size_t i = 0; i < cfg_.tags.size(); ++i) localOf_[cfg_.tags[i].tag] = i;
    deviceBackoff_.assign(n, Backoff(kDeviceBackoffCapS, env_.uniform));
    probeAt_.assign(n, 0);
    timeoutDevices_.assign(n, false);
}

McDriver::~McDriver() { halt(); }

void McDriver::setChannelState(ChannelState s) {
    channelState_ = static_cast<int>(s);
    static const char* const kNames[] = {"disabled", "connecting", "opening", "connected", "error"};
    diag_.setChannelState(kNames[static_cast<int>(s)]);
}

void McDriver::setDeviceState(size_t dev, DeviceState s) {
    if (dev >= cfg_.devices.size()) return;
    if (deviceState_[dev].exchange(static_cast<int>(s)) == static_cast<int>(s)) return;
    static const char* const kNames[] = {"active", "suspended", "error", "disabled"};
    diag_.setDeviceState(dev, kNames[static_cast<int>(s)]);
}

LinkState McDriver::linkState(uint32_t device) const {
    LinkState s;
    s.channel = static_cast<ChannelState>(channelState_.load());
    s.device = device < cfg_.devices.size() ? static_cast<DeviceState>(deviceState_[device].load())
                                            : DeviceState::Disabled;
    return s;
}

void McDriver::diagnostics(DriverDiag& out, int64_t /*nowMs*/) const {
    out = diag_.snapshot(clock_->monoMs());
    std::lock_guard<std::mutex> g(schedMu_);
    static const char* const kGroupNames[3] = {"fast", "normal", "slow"};
    for (size_t d = 0; d < out.devices.size() && d < rounds_.size(); ++d) {
        out.devices[d].groups.clear();
        for (int g2 = 0; g2 < 3; ++g2) {
            if (rounds_[d][static_cast<size_t>(g2)].blocks.empty()) continue;
            const Scheduler::GroupStats st =
                sched_.stats(static_cast<uint32_t>(d), g2, clock_->monoMs());
            GroupDiag gd;
            gd.name = kGroupNames[g2];
            gd.periodMs = cfg_.scanMs[static_cast<size_t>(g2)];
            gd.actualAvgMs = st.actualAvgMs;
            gd.actualMaxMs = st.actualMaxMs;
            gd.overruns = st.overruns;
            gd.overloaded = st.overloaded;
            out.devices[d].groups.push_back(gd);
        }
    }
}

mc::FrameOptions McDriver::optionsOf(size_t dev) const {
    mc::FrameOptions o;
    o.frame = cfg_.frame;
    o.code = cfg_.code;
    const McDeviceConfig& dc = cfg_.devices[dev];
    o.route = dc.route;
    o.timer = mc::monitoringTimer(dc.timeoutMs);
    o.xyOctal = dc.xyOctal;
    return o;
}

mc::Request McDriver::requestOf(const Block& b) {
    mc::Request r;
    if (!b.random) {
        const Entry& e = b.entries.front();
        r.cmd = Cmd::ReadWords;
        r.dev = {e.dev, numberOf(e.dev, e.start)};
        r.points = static_cast<uint16_t>(e.count);
        return r;
    }
    r.cmd = Cmd::RandomRead;
    for (const Entry& e : b.entries)
        (e.count == 1 ? r.randomWords : r.randomDwords)
            .push_back({e.dev, numberOf(e.dev, e.start)});
    return r;
}

// ---- Plan ---------------------------------------------------------------------------------------

void McDriver::buildPlan() {
    std::lock_guard<std::mutex> g(schedMu_);
    sched_ = Scheduler();
    rounds_.assign(cfg_.devices.size(), {});
    static const Device kOrder[] = {Device::D,  Device::W,  Device::R, Device::ZR, Device::SD,
                                    Device::TN, Device::CN, Device::M, Device::X,  Device::Y,
                                    Device::B,  Device::L,  Device::SM};
    for (size_t d = 0; d < cfg_.devices.size(); ++d) {
        const McDeviceConfig& dc = cfg_.devices[d];
        if (!dc.enabled) continue;
        const int maxLen = std::max(1, std::min(dc.maxBatchWords, mc::kMaxBatchWords));
        for (int grp = 0; grp < 3; ++grp) {
            std::vector<Block> batch;
            for (Device dev : kOrder) {
                std::vector<PlanItem> items;
                for (size_t i = 0; i < cfg_.tags.size(); ++i) {
                    const McTagBinding& t = cfg_.tags[i];
                    if (t.device != d || static_cast<int>(t.group) != grp || t.dev != dev) continue;
                    const int s = static_cast<int>(wordIndexOf(t));
                    items.push_back({i, s, s + std::max(1, t.bitDevice ? 1 : t.words)});
                }
                if (items.empty()) continue;
                for (const mat::drv::Block& b : planBlocks(items, dc.maxGapWords, maxLen)) {
                    Entry e;
                    e.dev = dev;
                    e.start = static_cast<uint32_t>(b.start);
                    e.count = b.end - b.start;
                    for (size_t idx : b.items) e.tags.push_back(items[idx].tag);
                    Block blk;
                    blk.entries.push_back(std::move(e));
                    batch.push_back(std::move(blk));
                }
            }
            // Random Read: the small blocks (1 or 2 words) go together, words first then dwords
            Round& round = rounds_[d][static_cast<size_t>(grp)];
            std::vector<Entry> small;
            for (Block& b : batch) {
                if (dc.randomRead && b.entries.front().count <= 2)
                    small.push_back(std::move(b.entries.front()));
                else
                    round.blocks.push_back(std::move(b));
            }
            const size_t per = static_cast<size_t>(
                std::max(1, std::min(dc.maxRandomPoints, mc::kMaxRandomPoints)));
            std::stable_partition(small.begin(), small.end(),
                                  [](const Entry& e) { return e.count == 1; });
            for (size_t k = 0; k < small.size(); k += per) {
                Block blk;
                const size_t end = std::min(small.size(), k + per);
                blk.random = end - k >= 2;
                for (size_t j = k; j < end; ++j) blk.entries.push_back(std::move(small[j]));
                round.blocks.push_back(std::move(blk));  // one point alone: a Batch Read
            }
            if (!round.blocks.empty())
                sched_.addRound(static_cast<uint32_t>(d), grp,
                                cfg_.scanMs[static_cast<size_t>(grp)], round.blocks.size());
        }
    }
    sched_.setRequestGapMs(cfg_.requestGapMs);
}

bool McDriver::splitBlockAt(size_t dev, int group, size_t blockIndex) {
    std::lock_guard<std::mutex> g(schedMu_);
    std::vector<Block>& blocks = rounds_[dev][static_cast<size_t>(group)].blocks;
    const Block old = blocks[blockIndex];
    std::vector<Block> parts;
    if (old.random) {
        // a Random Read of several points: each point becomes a Batch Read of its own
        for (const Entry& e : old.entries) {
            Block b;
            b.entries.push_back(e);
            parts.push_back(std::move(b));
        }
    } else {
        const Entry& e = old.entries.front();
        if (e.tags.size() < 2) return false;
        std::vector<PlanItem> items;
        mat::drv::Block whole;
        whole.start = static_cast<int>(e.start);
        whole.end = static_cast<int>(e.start) + e.count;
        for (size_t k = 0; k < e.tags.size(); ++k) {
            const McTagBinding& t = cfg_.tags[e.tags[k]];
            const int s = static_cast<int>(wordIndexOf(t));
            items.push_back({e.tags[k], s, s + (t.bitDevice ? 1 : std::max(1, t.words))});
            whole.items.push_back(k);
        }
        mat::drv::Block first, second;
        if (!splitBlock(items, whole, first, second)) return false;
        for (const mat::drv::Block* b : {&first, &second}) {
            Block blk;
            Entry ne;
            ne.dev = e.dev;
            ne.start = static_cast<uint32_t>(b->start);
            ne.count = b->end - b->start;
            for (size_t idx : b->items) ne.tags.push_back(items[idx].tag);
            blk.entries.push_back(std::move(ne));
            parts.push_back(std::move(blk));
        }
    }
    if (parts.size() < 2) return false;
    blocks.erase(blocks.begin() + static_cast<long>(blockIndex));
    blocks.insert(blocks.begin() + static_cast<long>(blockIndex), parts.begin(), parts.end());
    sched_.setBlocks(static_cast<uint32_t>(dev), group, blocks.size());
    return true;
}

// ---- Publishing ---------------------------------------------------------------------------------

void McDriver::publishBad(const std::vector<size_t>& tags, const std::string& reason) {
    std::vector<TagUpdate> ups;
    const int64_t w = wall();
    for (size_t t : tags) {
        if (lastBad_[t] == reason) continue;
        lastBad_[t] = reason;
        TagUpdate u;
        u.tag = cfg_.tags[t].tag;
        u.quality = Quality::BAD;
        u.reason = reason;
        u.sourceTs = w;
        ups.push_back(std::move(u));
    }
    if (!ups.empty() && sink_) sink_->publish(std::move(ups));
}

void McDriver::publishBadAll(const std::string& reason, const std::vector<size_t>* except) {
    std::vector<size_t> all;
    for (size_t i = 0; i < cfg_.tags.size(); ++i) {
        const McTagBinding& t = cfg_.tags[i];
        if (t.device < cfg_.devices.size() && !cfg_.devices[t.device].enabled) continue;
        if (except && std::find(except->begin(), except->end(), i) != except->end()) continue;
        all.push_back(i);
    }
    publishBad(all, reason);
}

bool McDriver::decodeTag(const McTagBinding& t, uint32_t start, const std::vector<uint16_t>& words,
                         TagScalar& out, std::string& reason) const {
    const uint32_t at = wordIndexOf(t);
    if (at < start) {
        reason = "BAD_FRAME";
        return false;
    }
    const size_t idx = at - start;
    if (t.bitDevice) {
        if (idx >= words.size()) {
            reason = "BAD_FRAME";
            return false;
        }
        out = ((words[idx] >> (t.number % 16)) & 1) != 0;
        return true;
    }
    if (t.bit >= 0) {
        if (idx >= words.size()) {
            reason = "BAD_FRAME";
            return false;
        }
        out = modbus::registerBit(words[idx], t.bit);
        return true;
    }
    const size_t n = static_cast<size_t>(std::max(1, t.words));
    if (idx + n > words.size()) {
        reason = "BAD_FRAME";
        return false;
    }
    const std::vector<uint16_t> w(words.begin() + static_cast<long>(idx),
                                  words.begin() + static_cast<long>(idx + n));
    if (t.rawType == TagType::STRING) {
        out = modbus::decodeString(t.stringLength, t.stringOrder, w);
        return true;
    }
    if (t.rawType == TagType::BOOL) {
        out = w[0] != 0;
        return true;
    }
    const modbus::DecodeResult d = modbus::decodeNumber(t.rawType, t.byteOrder, w);
    if (!d.ok) {
        reason = d.reason.empty() ? "INVALID_VALUE" : d.reason;
        return false;
    }
    out = d.value;
    return true;
}

void McDriver::publishBlock(const Block& b, const std::vector<uint16_t>& words) {
    std::vector<TagUpdate> ups;
    const int64_t w = wall();
    // the words of each entry: a batch has them all; a random read has the word points first,
    // then two words per dword point
    std::vector<std::pair<const Entry*, std::vector<uint16_t>>> parts;
    if (!b.random) {
        parts.push_back({&b.entries.front(), words});
    } else {
        size_t nWords = 0;
        for (const Entry& e : b.entries)
            if (e.count == 1) ++nWords;
        size_t wi = 0, di = nWords;
        for (const Entry& e : b.entries) {
            std::vector<uint16_t> v;
            if (e.count == 1) {
                if (wi < words.size()) v.push_back(words[wi]);
                ++wi;
            } else {
                for (int k = 0; k < 2; ++k)
                    if (di + static_cast<size_t>(k) < words.size())
                        v.push_back(words[di + static_cast<size_t>(k)]);
                di += 2;
            }
            parts.push_back({&e, std::move(v)});
        }
    }
    for (const auto& [e, v] : parts) {
        for (size_t i : e->tags) {
            const McTagBinding& t = cfg_.tags[i];
            TagUpdate u;
            u.tag = t.tag;
            u.sourceTs = w;
            std::string reason;
            if (decodeTag(t, e->start, v, u.value, reason)) {
                u.quality = Quality::GOOD;
                lastBad_[i].clear();
            } else {
                u.quality = Quality::BAD;
                u.reason = reason;
                if (lastBad_[i] == reason) continue;
                lastBad_[i] = reason;
            }
            ups.push_back(std::move(u));
        }
    }
    if (!ups.empty()) sink_->publish(std::move(ups));
}

// ---- The connection -----------------------------------------------------------------------------

bool McDriver::connectNow() {
    setChannelState(ChannelState::Connecting);
    const ConnectCode code = transport_->connect(cfg_.host, cfg_.port, cfg_.connectTimeoutMs);
    if (stopping_) return false;
    if (code == ConnectCode::Ok) {
        onConnected();
        return true;
    }
    failConnect(connectCodeName(code), code == ConnectCode::Refused ? "REFUSED" : "DISCONNECTED");
    return false;
}

void McDriver::onConnected() {
    connected_ = true;
    setChannelState(ChannelState::Connected);
    if (everConnected_) diag_.onReconnect();
    everConnected_ = true;
    firstSuccessPending_ = true;
    rx_.clear();
    if (cfg_.udp) transport_->discardInput();
    nextSerial_ =
        env_.firstSerial ? env_.firstSerial() : static_cast<uint16_t>(randomUniform() * 65536.0);
    for (size_t d = 0; d < cfg_.devices.size(); ++d)
        if (cfg_.devices[d].enabled) setDeviceState(d, DeviceState::Active);
    for (Backoff& b : deviceBackoff_) b.reset();
    lateSerials_.clear();
    timeoutsInARow_ = 0;
    std::fill(timeoutDevices_.begin(), timeoutDevices_.end(), false);
    buildPlan();
    std::lock_guard<std::mutex> g(schedMu_);
    sched_.start(mono());
}

void McDriver::failConnect(const std::string& code, const std::string& reason) {
    connected_ = false;
    diag_.setLastError(code, wall());
    setChannelState(ChannelState::Error);
    publishBadAll(reason, nullptr);
    failQueuedWrites("NOT_SENT_DISCONNECTED");
    nextConnectMs_ = mono() + backoff_.nextDelayMs();
}

void McDriver::handleIdleClose() {
    transport_->close();
    connected_ = false;
    rx_.clear();
    connectNow();
}

void McDriver::dropConnection(const char* errorCode, const std::vector<size_t>& failedTags,
                              const char* failedReason) {
    transport_->close();
    connected_ = false;
    rx_.clear();
    lateSerials_.clear();
    timeoutsInARow_ = 0;
    std::fill(timeoutDevices_.begin(), timeoutDevices_.end(), false);
    diag_.setLastError(errorCode, wall());
    setChannelState(ChannelState::Error);
    publishBad(failedTags, failedReason);
    publishBadAll("DISCONNECTED", &failedTags);
    failQueuedWrites("NOT_SENT_DISCONNECTED");
    nextConnectMs_ = mono() + backoff_.nextDelayMs();
}

bool McDriver::deviceSuspended(size_t dev) const {
    return dev < cfg_.devices.size() &&
           deviceState_[dev].load() == static_cast<int>(DeviceState::Suspended);
}

void McDriver::deviceAnswered(size_t dev) {
    timeoutsInARow_ = 0;
    std::fill(timeoutDevices_.begin(), timeoutDevices_.end(), false);
    deviceBackoff_[dev].reset();
    if (!deviceSuspended(dev)) return;
    {
        std::lock_guard<std::mutex> g(schedMu_);
        sched_.setSuspended(static_cast<uint32_t>(dev), false, mono());
    }
    setDeviceState(dev, DeviceState::Active);
}

// 4E or UDP: a request without an answer is the device's problem (feature 011 FR-021, FR-022).
bool McDriver::deviceTimedOut(size_t dev, const std::vector<size_t>& tags) {
    ++timeoutsInARow_;
    timeoutDevices_[dev] = true;
    size_t devices = 0, enabled = 0;
    for (size_t d = 0; d < cfg_.devices.size(); ++d) {
        if (timeoutDevices_[d]) ++devices;
        if (cfg_.devices[d].enabled) ++enabled;
    }
    if (timeoutsInARow_ >= kTimeoutsToClose && devices >= std::min<size_t>(2, enabled)) {
        dropConnection("TIMEOUT", tags, "TIMEOUT");
        return false;
    }
    diag_.setLastError("TIMEOUT", wall(), cfg_.devices[dev].id);
    std::vector<size_t> all;
    for (size_t i = 0; i < cfg_.tags.size(); ++i)
        if (cfg_.tags[i].device == dev) all.push_back(i);
    publishBad(all, "TIMEOUT");
    probeAt_[dev] = mono() + deviceBackoff_[dev].nextDelayMs();
    setDeviceState(dev, DeviceState::Suspended);
    std::lock_guard<std::mutex> g(schedMu_);
    sched_.setSuspended(static_cast<uint32_t>(dev), true, mono());
    sched_.setNextProbe(static_cast<uint32_t>(dev), probeAt_[dev]);
    return true;
}

// A request without a valid answer: 3E over TCP closes the connection on a timeout (no serial: a
// late answer could be taken for the next one); 4E and UDP put the device in its backoff.
void McDriver::lose(size_t dev, Outcome o, const std::vector<size_t>& tags) {
    if (o == Outcome::Timeout) {
        if (tcp3E())
            dropConnection("TIMEOUT", tags, "TIMEOUT");
        else
            deviceTimedOut(dev, tags);
        return;
    }
    if (o == Outcome::Lost) {
        dropConnection("BAD_FRAME", tags, "BAD_FRAME");
        return;
    }
    dropConnection("DISCONNECTED", tags, "DISCONNECTED");
}

bool McDriver::lateSerial(uint16_t s) const {
    return std::find(lateSerials_.begin(), lateSerials_.end(), s) != lateSerials_.end();
}

McDriver::Exchange McDriver::exchange(size_t dev, const mc::Request& req, int timeoutMs,
                                      int retries) {
    Exchange ex;
    const mc::FrameOptions o = optionsOf(dev);
    const bool e4 = cfg_.frame == mc::FrameType::E4;
    for (int attempt = 0; attempt <= retries; ++attempt) {
        uint16_t serial = 0;
        if (e4) {
            serial = nextSerial_++;
            while (lateSerial(serial)) serial = nextSerial_++;
        }
        if (cfg_.udp) transport_->discardInput();  // what came after an earlier timeout
        const mc::Bytes frame = mc::encodeRequest(o, serial, req);
        const int64_t sentAt = mono();
        if (!transport_->writeAll(frame.data(), frame.size(), timeoutMs)) {
            ex.outcome = stopping_ ? Outcome::Interrupted : Outcome::Closed;
            return ex;
        }
        const int64_t deadline = sentAt + timeoutMs;
        // One frame received: true when it is the answer (ex filled).
        auto take = [&](const uint8_t* f, size_t n) {
            const mc::Response r = mc::checkResponse(o, serial, req, f, n);
            if (r.issue != mc::Issue::None) {
                if (r.issue == mc::Issue::Serial && lateSerial(r.serial)) {
                    // the late answer of a request that timed out: it came, drop it quietly
                    lateSerials_.erase(
                        std::find(lateSerials_.begin(), lateSerials_.end(), r.serial));
                    return false;
                }
                diag_.onBadFrame(dev, frameIssueCounter(r.issue));
                return false;
            }
            ex.response = r;
            if (firstSuccessPending_) {
                firstSuccessPending_ = false;
                backoff_.reset();
            }
            if (r.endCode != 0) {
                ex.outcome = Outcome::EndCode;
                diag_.onException(dev, r.endCode);
            } else {
                ex.outcome = Outcome::Ok;
                diag_.onRequestOk(dev, mono() - sentAt, mono());
            }
            return true;
        };
        for (;;) {
            if (!cfg_.udp) {
                bool done = false;
                for (;;) {
                    const mc::Split s =
                        mc::splitResponse(cfg_.frame, cfg_.code, rx_.data(), rx_.size());
                    if (s.status == mc::SplitStatus::NeedMore) break;
                    if (s.status == mc::SplitStatus::Lost) {
                        diag_.onBadFrame(dev, BadFrameKind::Format);
                        rx_.clear();
                        ex.outcome = Outcome::Lost;
                        return ex;
                    }
                    const mc::Bytes f(rx_.begin(), rx_.begin() + static_cast<long>(s.size));
                    rx_.erase(rx_.begin(), rx_.begin() + static_cast<long>(s.size));
                    if (take(f.data(), f.size())) {
                        done = true;
                        break;
                    }
                }
                if (done) return ex;
            }
            const int64_t left = deadline - mono();
            if (left <= 0) break;
            uint8_t buf[4096];
            const ReadResult rr = transport_->read(buf, sizeof buf, static_cast<int>(left));
            if (rr.code == ReadCode::Data) {
                if (cfg_.udp) {
                    if (take(buf, rr.n)) return ex;
                } else {
                    rx_.insert(rx_.end(), buf, buf + rr.n);
                }
                continue;
            }
            if (rr.code == ReadCode::Interrupted) {
                ex.outcome = Outcome::Interrupted;
                return ex;
            }
            if (rr.code == ReadCode::Timeout) continue;  // the loop checks the deadline
            ex.outcome = Outcome::Closed;
            return ex;
        }
        // the wait is over
        diag_.onTimeout(dev);
        if (e4) {
            lateSerials_.push_back(serial);
            if (lateSerials_.size() > kLateSerialsKept) lateSerials_.pop_front();
        }
        if (!rx_.empty()) {  // a frame cut short: the stream lost its framing
            diag_.onBadFrame(dev, BadFrameKind::Length);
            rx_.clear();
            ex.outcome = Outcome::Lost;
            return ex;
        }
        if (tcp3E()) break;  // no serial: never send again on a stream that may still answer
    }
    ex.outcome = Outcome::Timeout;
    return ex;
}

void McDriver::runRead(const Scheduler::Job& job) {
    const size_t dev = job.device;
    const int group = job.group;
    Block b;
    {
        std::lock_guard<std::mutex> g(schedMu_);
        const auto& blocks = rounds_[dev][static_cast<size_t>(group)].blocks;
        if (job.block >= blocks.size()) {
            sched_.complete(job, mono());
            return;
        }
        b = blocks[job.block];
    }
    const McDeviceConfig& dc = cfg_.devices[dev];
    const Exchange ex = exchange(dev, requestOf(b), dc.timeoutMs, dc.retries);
    bool skipSecondHalf = false;
    const std::vector<size_t> tags = b.tags();
    switch (ex.outcome) {
        case Outcome::Ok:
            deviceAnswered(dev);
            setDeviceState(dev, DeviceState::Active);
            publishBlock(b, ex.response.words);
            break;
        case Outcome::EndCode: {
            deviceAnswered(dev);  // an end code is a valid answer
            const char* reason = mcEndReason(ex.response.endCode);
            if (std::string(reason) == "MC_END_RANGE" && splitBlockAt(dev, group, job.block)) {
                skipSecondHalf = true;  // the parts are read from the next round
                break;
            }
            publishBad(tags, reason);
            break;
        }
        case Outcome::Timeout:
        case Outcome::Closed:
        case Outcome::Lost:
            lose(dev, ex.outcome, tags);
            break;
        case Outcome::Interrupted:
            return;
    }
    std::lock_guard<std::mutex> g(schedMu_);
    sched_.complete(job, mono());
    if (skipSecondHalf) sched_.complete(job, mono());
    if (job.kind == Scheduler::Kind::Probe && deviceSuspended(dev))
        sched_.setNextProbe(static_cast<uint32_t>(dev), probeAt_[dev]);
}

// ---- Writes -------------------------------------------------------------------------------------

bool McDriver::enqueueWrite(WriteCommand cmd) {
    if (!started_ || stopping_ || !cfg_.enabled) return false;
    const auto it = localOf_.find(cmd.tag);
    if (it == localOf_.end()) return false;
    const McTagBinding& t = cfg_.tags[it->second];
    if (t.device >= cfg_.devices.size() || !cfg_.devices[t.device].enabled) return false;
    {
        std::lock_guard<std::mutex> g(wmu_);
        if (!cmd.priority && writes_.size() >= static_cast<size_t>(cfg_.writeQueueCapacity))
            return false;
        if (cmd.priority)
            writes_.push_front({std::move(cmd), mono()});
        else
            writes_.push_back({std::move(cmd), mono()});
    }
    {
        std::lock_guard<std::mutex> l(mu_);
        wake_ = true;
    }
    cv_.notify_all();
    return true;
}

std::vector<uint64_t> McDriver::cancelQueuedWrites() {
    std::vector<uint64_t> ids;
    std::lock_guard<std::mutex> g(wmu_);
    for (const auto& w : writes_) ids.push_back(w.cmd.id);
    writes_.clear();
    return ids;
}

void McDriver::finishWrite(size_t local, WriteResult&& r) {
    const size_t dev = cfg_.tags[local].device;
    WriteOutcome o = WriteOutcome::Failed;
    if (r.status == WriteStatus::Confirmed || r.status == WriteStatus::NoReadback)
        o = WriteOutcome::Confirmed;
    else if (r.status == WriteStatus::Timeout)
        o = WriteOutcome::Timeout;
    diag_.onWrite(dev, o);
    if (!stopping_ && sink_) sink_->writeDone(std::move(r));
}

void McDriver::failQueuedWrites(const char* code) {
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
        finishWrite(localOf_.at(w.cmd.tag), std::move(r));
    }
}

void McDriver::runWrite() {
    QueuedWrite w;
    auto complete = [&] {
        std::lock_guard<std::mutex> sg(schedMu_);
        Scheduler::Job j;
        j.kind = Scheduler::Kind::Write;
        sched_.complete(j, mono());
    };
    {
        std::lock_guard<std::mutex> g(wmu_);
        if (writes_.empty()) {
            std::lock_guard<std::mutex> sg(schedMu_);
            Scheduler::Job j;
            j.kind = Scheduler::Kind::Write;
            sched_.complete(j, mono());
            return;
        }
        w = std::move(writes_.front());
        writes_.pop_front();
    }
    const size_t local = localOf_.at(w.cmd.tag);
    const McTagBinding& t = cfg_.tags[local];
    const size_t dev = t.device;
    const McDeviceConfig& dc = cfg_.devices[dev];
    WriteResult res;
    res.id = w.cmd.id;
    auto fail = [&](const char* code) {
        res.status = WriteStatus::Failed;
        res.code = code;
        finishWrite(local, std::move(res));
        complete();
    };
    if (mono() - w.enqueuedMs > w.cmd.deadlineMs) return fail("NOT_SENT_DEADLINE");
    if (deviceSuspended(dev)) return fail("NOT_SENT_DEVICE_SUSPENDED");

    mc::Request req;
    bool bitValue = false;
    std::vector<uint16_t> regs;
    if (t.bitDevice) {
        if (!asBool(w.cmd.raw, bitValue)) return fail("NOT_SENT_UNSUPPORTED");
        req.cmd = Cmd::WriteBits;
        req.dev = {t.dev, t.number};
        req.bits = {static_cast<uint8_t>(bitValue ? 1 : 0)};
    } else if (t.bit >= 0) {
        if (!asBool(w.cmd.raw, bitValue) || !dc.bitRmw) return fail("NOT_SENT_UNSUPPORTED");
        // read-modify-write: the word as it is now, then the bit changed
        mc::Request rd;
        rd.cmd = Cmd::ReadWords;
        rd.dev = {t.dev, t.number};
        rd.points = 1;
        const Exchange rx = exchange(dev, rd, dc.timeoutMs, 0);
        if (rx.outcome == Outcome::Interrupted) return;
        if (rx.outcome == Outcome::EndCode) deviceAnswered(dev);
        if (rx.outcome != Outcome::Ok) {
            fail("NOT_SENT_READ_FAILED");
            if (rx.outcome != Outcome::EndCode) lose(dev, rx.outcome, {local});
            return;
        }
        deviceAnswered(dev);
        if (rx.response.words.empty()) return fail("NOT_SENT_READ_FAILED");
        regs = {modbus::applyBit(rx.response.words[0], t.bit, bitValue)};
        req.cmd = Cmd::WriteWords;
        req.dev = {t.dev, t.number};
        req.words = regs;
    } else {
        if (t.rawType == TagType::BOOL) {
            if (!asBool(w.cmd.raw, bitValue)) return fail("NOT_SENT_UNSUPPORTED");
            regs = {static_cast<uint16_t>(bitValue ? 1 : 0)};
        } else if (t.rawType == TagType::STRING) {
            const std::string* s = std::get_if<std::string>(&w.cmd.raw);
            if (!s) return fail("NOT_SENT_UNSUPPORTED");
            const modbus::EncodeStringResult e =
                modbus::encodeString(t.stringLength, t.stringOrder, *s);
            if (!e.ok) return fail("NOT_SENT_UNSUPPORTED");
            regs = e.registers;
        } else {
            TagScalar v;
            if (!coerceNumber(t.rawType, w.cmd.raw, v)) return fail("NOT_SENT_UNSUPPORTED");
            regs = modbus::encodeNumber(t.rawType, t.byteOrder, v);
        }
        req.cmd = Cmd::WriteWords;
        req.dev = {t.dev, t.number};
        req.words = regs;
    }

    // sent once, never again
    const Exchange wx = exchange(dev, req, dc.timeoutMs, 0);
    switch (wx.outcome) {
        case Outcome::Interrupted:
            return;
        case Outcome::EndCode:
            deviceAnswered(dev);
            res.status = WriteStatus::Failed;
            res.code = "DEVICE_EXCEPTION";
            res.exception = wx.response.endCode;
            finishWrite(local, std::move(res));
            complete();
            return;
        case Outcome::Timeout:
        case Outcome::Closed:
        case Outcome::Lost:
            res.status = WriteStatus::Timeout;
            res.code = "WRITE_TIMEOUT";
            finishWrite(local, std::move(res));  // its result first, then the ones behind it
            lose(dev, wx.outcome, {local});
            complete();
            return;
        case Outcome::Ok:
            deviceAnswered(dev);
            break;
    }
    if (!w.cmd.readback) {
        res.status = WriteStatus::NoReadback;
        res.code = "NO_READBACK";
        finishWrite(local, std::move(res));
        complete();
        return;
    }

    // the readback: the Tag's own words (a bit device: its point), before any queued read
    mc::Request rb;
    rb.dev = {t.dev, t.number};
    if (t.bitDevice) {
        rb.cmd = Cmd::ReadBits;
        rb.points = 1;
    } else {
        rb.cmd = Cmd::ReadWords;
        rb.points = static_cast<uint16_t>(t.bit >= 0 ? 1 : std::max(1, t.words));
    }
    const Exchange rx = exchange(dev, rb, dc.timeoutMs, 0);
    if (rx.outcome == Outcome::Interrupted) return;
    if (rx.outcome == Outcome::EndCode) {
        res.status = WriteStatus::Failed;
        res.code = "READBACK_ERROR";
        res.exception = rx.response.endCode;
        finishWrite(local, std::move(res));
        complete();
        return;
    }
    if (rx.outcome != Outcome::Ok) {
        res.status = WriteStatus::Timeout;
        res.code = "READBACK_TIMEOUT";
        finishWrite(local, std::move(res));
        lose(dev, rx.outcome, {local});
        complete();
        return;
    }
    bool match = false;
    TagScalar value;
    bool haveValue = false;
    if (t.bitDevice) {
        match = !rx.response.bits.empty() && (rx.response.bits[0] != 0) == bitValue;
        if (!rx.response.bits.empty()) {
            value = rx.response.bits[0] != 0;
            haveValue = true;
        }
    } else {
        const std::vector<uint16_t>& got = rx.response.words;
        if (t.bit >= 0)
            match = !got.empty() && modbus::registerBit(got[0], t.bit) == bitValue;
        else if (t.rawType == TagType::BOOL)
            match = !got.empty() && (got[0] != 0) == bitValue;
        else
            match = got == regs;  // bit for bit
        std::string why;
        haveValue = decodeTag(t, wordIndexOf(t), got, value, why);
    }
    if (haveValue) {
        TagUpdate u;
        u.tag = t.tag;
        u.value = value;
        u.quality = Quality::GOOD;
        u.sourceTs = wall();
        u.afterWrite = true;  // published whatever the deadband (FR-038)
        lastBad_[local].clear();
        std::vector<TagUpdate> ups;
        ups.push_back(std::move(u));
        sink_->publish(std::move(ups));
        res.readback = value;
    }
    res.status = match ? WriteStatus::Confirmed : WriteStatus::Failed;
    res.code = match ? "CONFIRMED" : "READBACK_MISMATCH";
    finishWrite(local, std::move(res));
    complete();
}

// ---- The thread ---------------------------------------------------------------------------------

void McDriver::start(EngineSink& sink) {
    if (started_) return;
    sink_ = &sink;
    started_ = true;
    stopping_ = false;
    if (!cfg_.enabled) {
        setChannelState(ChannelState::Disabled);
        publishBadAll("DISABLED", nullptr);
        return;
    }
    {
        std::vector<size_t> off;
        for (size_t i = 0; i < cfg_.tags.size(); ++i) {
            const size_t d = cfg_.tags[i].device;
            if (d < cfg_.devices.size() && !cfg_.devices[d].enabled) off.push_back(i);
        }
        publishBad(off, "DISABLED");
    }
    transport_ = env_.makeTransport ? env_.makeTransport()
                                    : (cfg_.udp ? std::unique_ptr<Transport>(new UdpSocket())
                                                : std::unique_ptr<Transport>(new TcpSocket()));
    transport_->clearInterrupt();
    setChannelState(ChannelState::Connecting);
    buildPlan();
    if (env_.manual) return;
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setstacksize(&attr, 256 * 1024);  // ADR-014: one small stack per channel
    if (pthread_create(&thread_, &attr, &McDriver::threadMain, this) == 0) threadRunning_ = true;
    pthread_attr_destroy(&attr);
    if (!threadRunning_) {
        std::fprintf(stderr, "mc %s: cannot start the channel thread\n", cfg_.channelId.c_str());
        setChannelState(ChannelState::Error);
    }
}

void* McDriver::threadMain(void* self) {
    mat::setThreadName("mat-mc");
    McDriver* d = static_cast<McDriver*>(self);
    try {
        d->loop(std::numeric_limits<int64_t>::max());
    } catch (const std::exception& e) {
        std::fprintf(stderr, "mc %s: %s\n", d->cfg_.channelId.c_str(), e.what());
        d->setChannelState(ChannelState::Error);
    }
    return nullptr;
}

void McDriver::stop() { halt(); }

void McDriver::halt() {
    if (!started_) return;
    stopping_ = true;
    if (transport_) transport_->interrupt();
    {
        std::lock_guard<std::mutex> l(mu_);
        wake_ = true;
    }
    cv_.notify_all();
    if (threadRunning_) {
        pthread_join(thread_, nullptr);
        threadRunning_ = false;
    }
    if (transport_) transport_->close();
    started_ = false;
}

void McDriver::pump(int64_t untilMs) {
    if (!started_ || !cfg_.enabled || stopping_) return;
    loop(untilMs);
}

void McDriver::idle(int64_t untilMs) {
    if (env_.sleep) {
        env_.sleep(untilMs);
        return;
    }
    const int64_t delay = std::max<int64_t>(0, untilMs - mono());
    std::unique_lock<std::mutex> l(mu_);
    cv_.wait_for(l, std::chrono::milliseconds(delay), [this] { return wake_ || stopping_.load(); });
    wake_ = false;
}

void McDriver::loop(int64_t untilMs) {
    while (!stopping_) {
        const int64_t now = mono();
        if (now >= untilMs) break;
        if (!connected_) {
            if (channelState_.load() == static_cast<int>(ChannelState::Error))
                failQueuedWrites("NOT_SENT_DISCONNECTED");
            if (now < nextConnectMs_) {
                idle(std::min(nextConnectMs_, untilMs));
                continue;
            }
            connectNow();
            continue;
        }
        if (!cfg_.udp && transport_->peerClosed()) {
            handleIdleClose();
            continue;
        }
        bool writePending;
        {
            std::lock_guard<std::mutex> g(wmu_);
            writePending = !writes_.empty();
        }
        int64_t wait = -1;
        std::optional<Scheduler::Job> job;
        {
            std::lock_guard<std::mutex> g(schedMu_);
            job = sched_.next(now, writePending, &wait);
        }
        if (!job) {
            idle(wait >= 0 ? std::min(wait, untilMs) : std::min(untilMs, now + kIdleCapMs));
            continue;
        }
        if (job->kind == Scheduler::Kind::Write)
            runWrite();
        else
            runRead(*job);
    }
}

// ---- Connection test ----------------------------------------------------------------------------

TestOutcome McDriver::test(const TestRequest& req) {
    TestOutcome out;
    std::unique_ptr<Transport> t = env_.makeTransport
                                       ? env_.makeTransport()
                                       : (cfg_.udp ? std::unique_ptr<Transport>(new UdpSocket())
                                                   : std::unique_ptr<Transport>(new TcpSocket()));
    const int64_t begin = clock_->monoMs();
    const ConnectCode c = t->connect(req.host.empty() ? cfg_.host : req.host,
                                     req.port > 0 ? req.port : cfg_.port, cfg_.connectTimeoutMs);
    out.connectMs = clock_->monoMs() - begin;
    if (c != ConnectCode::Ok) {
        out.code = connectCodeName(c);
        out.elapsedMs = out.connectMs;
        return out;
    }
    out.code = "OK";
    if (req.read && !cfg_.devices.empty()) {
        mc::McAddressOptions ao;
        ao.rawType = TagType::UINT16;
        ao.xyOctal = cfg_.devices[0].xyOctal;
        const mc::McAddress a = mc::parseMcAddress(req.address, ao);
        if (!a.ok) {
            out.code = "BAD_REQUEST";
            return out;
        }
        mc::Request r;
        r.cmd = Cmd::ReadWords;
        r.dev = {a.device, a.number};
        r.points = static_cast<uint16_t>(std::max(1, std::min(req.count, 4)));
        mc::FrameOptions o = optionsOf(0);
        const mc::Bytes f = mc::encodeRequest(o, 1, r);
        out.requestFrame = f;
        const int timeout = cfg_.devices[0].timeoutMs;
        const int64_t sent = clock_->monoMs();
        if (!t->writeAll(f.data(), f.size(), timeout)) {
            out.code = "DISCONNECTED";
            return out;
        }
        mc::Bytes rx;
        for (;;) {
            const int64_t left = sent + timeout - clock_->monoMs();
            if (left <= 0) {
                out.code = "TIMEOUT";
                break;
            }
            uint8_t buf[4096];
            const ReadResult rr = t->read(buf, sizeof buf, static_cast<int>(left));
            if (rr.code == ReadCode::Timeout) continue;
            if (rr.code != ReadCode::Data) {
                out.code = "DISCONNECTED";
                break;
            }
            rx.insert(rx.end(), buf, buf + rr.n);
            const mc::Split s = mc::splitResponse(cfg_.frame, cfg_.code, rx.data(), rx.size());
            if (s.status == mc::SplitStatus::NeedMore && !cfg_.udp) continue;
            const size_t n = s.status == mc::SplitStatus::Frame ? s.size : rx.size();
            out.responseFrame.assign(rx.begin(), rx.begin() + static_cast<long>(n));
            const mc::Response resp = mc::checkResponse(o, 1, r, rx.data(), n);
            out.responseMs = clock_->monoMs() - sent;
            if (resp.issue != mc::Issue::None)
                out.code = "BAD_FRAME";
            else if (resp.endCode != 0) {
                out.code = "EXCEPTION";
                out.exception = resp.endCode;
            } else
                out.registers = resp.words;
            break;
        }
    }
    out.elapsedMs = clock_->monoMs() - begin;
    return out;
}

}  // namespace mat::drv
