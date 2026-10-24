#include "drivers/fins/fins_driver.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <exception>
#include <limits>
#include <map>

#include "core/common/thread_name.hpp"
#include "drivers/fins/bcd.hpp"
#include "drivers/fins/end_codes.hpp"
#include "drivers/fins/udp_link.hpp"
#include "drivers/sdk/merge_planner.hpp"
#include "drivers/sdk/tcp_socket.hpp"

namespace mat::drv {

using fins::Bytes;
using fins::FrameIssue;

namespace {

constexpr int64_t kIdleCapMs = 1000;
constexpr int kDeviceBackoffCapS = 30;  // the backoff of one field device, 1 s to 30 s
constexpr int kTimeoutsToClose = 3;     // timeouts in a row that close the link
constexpr size_t kLateSidsKept = 16;    // SIDs of timed-out commands whose answer may still come
constexpr int kSmallBlock = 8;          // a block of at most this many words may go into a 0104
constexpr size_t kRxMax = 4 * (fins::kTcpHeaderSize + fins::kMaxFrame);

std::vector<std::string> deviceIds(const FinsConfig& c) {
    std::vector<std::string> ids;
    for (const auto& d : c.devices) ids.push_back(d.id);
    return ids;
}

BadFrameKind counterOf(FrameIssue i) {
    switch (i) {
        case FrameIssue::Sid:
            return BadFrameKind::Tid;
        case FrameIssue::Route:
            return BadFrameKind::Unit;
        case FrameIssue::Length:
        case FrameIssue::Short:
            return BadFrameKind::Length;
        default:
            return BadFrameKind::Format;
    }
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

Bytes wordBytes(const std::vector<uint16_t>& regs) {
    Bytes b;
    b.reserve(regs.size() * 2);
    for (uint16_t r : regs) {
        b.push_back(static_cast<uint8_t>(r >> 8));
        b.push_back(static_cast<uint8_t>(r & 0xFF));
    }
    return b;
}

bool isSignedType(TagType t) {
    return t == TagType::INT16 || t == TagType::INT32 || t == TagType::INT64;
}

uint8_t readCode(const FinsTagBinding& t) { return t.addr.flag ? t.addr.bitCode : t.addr.wordCode; }

}  // namespace

std::vector<size_t> FinsDriver::Request::tags() const {
    std::vector<size_t> out;
    for (const SubBlock& b : blocks) out.insert(out.end(), b.tags.begin(), b.tags.end());
    return out;
}

FinsDriver::FinsDriver(FinsConfig config, FinsEnv env)
    : cfg_(std::move(config)),
      env_(std::move(env)),
      clock_(env_.clock ? env_.clock : &systemClock_),
      diag_(cfg_.channelId, deviceIds(cfg_)),
      backoff_(cfg_.reconnectMaxS, env_.uniform),
      lastBad_(cfg_.tags.size()) {
    const size_t n = std::max<size_t>(1, cfg_.devices.size());
    deviceState_ = std::make_unique<std::atomic<int>[]>(n);
    for (size_t d = 0; d < cfg_.devices.size(); ++d) {
        const DeviceState s = cfg_.devices[d].enabled ? DeviceState::Active : DeviceState::Disabled;
        deviceState_[d] = static_cast<int>(s);
        diag_.setDeviceState(d, cfg_.devices[d].enabled ? "active" : "disabled");
    }
    for (size_t i = 0; i < cfg_.tags.size(); ++i) localOf_[cfg_.tags[i].tag] = i;
    deviceBackoff_.assign(n, Backoff(kDeviceBackoffCapS, env_.uniform));
    probeAt_.assign(n, 0);
    timeoutDevices_.assign(n, false);
}

FinsDriver::~FinsDriver() { halt(); }

void FinsDriver::setChannelState(ChannelState s) {
    channelState_ = static_cast<int>(s);
    switch (s) {
        case ChannelState::Disabled:
            diag_.setChannelState("disabled");
            break;
        case ChannelState::Connecting:
            diag_.setChannelState("connecting");
            break;
        case ChannelState::Opening:
            diag_.setChannelState("opening");
            break;
        case ChannelState::Connected:
            diag_.setChannelState("connected");
            break;
        case ChannelState::Error:
            diag_.setChannelState("error");
            break;
    }
}

void FinsDriver::setDeviceState(size_t dev, DeviceState s) {
    if (dev >= cfg_.devices.size()) return;
    if (deviceState_[dev].exchange(static_cast<int>(s)) == static_cast<int>(s)) return;
    const char* name = s == DeviceState::Active
                           ? "active"
                           : s == DeviceState::Suspended
                                 ? "suspended"
                                 : s == DeviceState::Error ? "error" : "disabled";
    diag_.setDeviceState(dev, name);
}

LinkState FinsDriver::linkState(uint32_t device) const {
    LinkState s;
    s.channel = static_cast<ChannelState>(channelState_.load());
    s.device = device < cfg_.devices.size() ? static_cast<DeviceState>(deviceState_[device].load())
                                            : DeviceState::Disabled;
    return s;
}

void FinsDriver::diagnostics(DriverDiag& out, int64_t /*nowMs*/) const {
    out = diag_.snapshot(clock_->monoMs());
    std::lock_guard<std::mutex> g(schedMu_);
    static const char* const kGroupNames[3] = {"fast", "normal", "slow"};
    for (size_t d = 0; d < out.devices.size() && d < rounds_.size(); ++d) {
        out.devices[d].groups.clear();
        for (int g2 = 0; g2 < 3; ++g2) {
            if (rounds_[d][static_cast<size_t>(g2)].requests.empty()) continue;
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

std::vector<FinsDriver::PlannedRequest> FinsDriver::plannedRequests(uint32_t device,
                                                                    int group) const {
    std::vector<PlannedRequest> out;
    std::lock_guard<std::mutex> g(schedMu_);
    if (device >= rounds_.size() || group < 0 || group > 2) return out;
    for (const Request& r : rounds_[device][static_cast<size_t>(group)].requests) {
        PlannedRequest p;
        p.multi = r.multi;
        p.code = r.blocks.front().code;
        p.start = r.blocks.front().start;
        for (const SubBlock& b : r.blocks) p.count += b.count;
        p.tags = r.tags();
        out.push_back(std::move(p));
    }
    return out;
}

// ---- Plan ---------------------------------------------------------------------------------------

void FinsDriver::buildPlan() {
    std::lock_guard<std::mutex> g(schedMu_);
    sched_ = Scheduler();
    rounds_.assign(cfg_.devices.size(), {});
    for (size_t d = 0; d < cfg_.devices.size(); ++d) {
        const FinsDeviceConfig& dc = cfg_.devices[d];
        if (!dc.enabled) continue;
        const int maxLen = std::max(1, std::min(dc.maxReadWords, fins::kMaxReadWords));
        const int maxGap = std::max(0, dc.maxGapWords);
        const int maxItems = std::max(1, std::min(dc.maxMultiItems, fins::kMaxMultiItems));
        for (int grp = 0; grp < 3; ++grp) {
            std::map<uint8_t, std::vector<PlanItem>> byCode;
            for (size_t i = 0; i < cfg_.tags.size(); ++i) {
                const FinsTagBinding& t = cfg_.tags[i];
                if (t.device != d || static_cast<int>(t.group) != grp) continue;
                byCode[readCode(t)].push_back(
                    {i, t.addr.wire, t.addr.wire + std::max(1, t.addr.words)});
            }
            std::vector<SubBlock> small, big;
            for (auto& [code, items] : byCode) {
                for (const mat::drv::Block& b : planBlocks(items, maxGap, maxLen)) {
                    SubBlock sb;
                    sb.code = code;
                    sb.words = fins::isWordCode(code);
                    sb.start = b.start;
                    sb.count = b.end - b.start;
                    for (size_t idx : b.items) sb.tags.push_back(items[idx].tag);
                    if (dc.multiRead && sb.count <= std::min(kSmallBlock, maxItems))
                        small.push_back(std::move(sb));
                    else
                        big.push_back(std::move(sb));
                }
            }
            Round& round = rounds_[d][static_cast<size_t>(grp)];
            if (small.size() < 2) {
                for (SubBlock& sb : small) big.push_back(std::move(sb));
                small.clear();
            }
            for (SubBlock& sb : big) {
                Request r;
                r.blocks.push_back(std::move(sb));
                round.requests.push_back(std::move(r));
            }
            // the small blocks, packed into 0104 requests of at most maxItems items
            Request cur;
            cur.multi = true;
            int items = 0;
            auto flush = [&] {
                if (cur.blocks.empty()) return;
                cur.multi = cur.blocks.size() > 1;
                round.requests.push_back(std::move(cur));
                cur = Request();
                cur.multi = true;
                items = 0;
            };
            for (SubBlock& sb : small) {
                if (items + sb.count > maxItems) flush();
                items += sb.count;
                cur.blocks.push_back(std::move(sb));
            }
            flush();
            if (!round.requests.empty())
                sched_.addRound(static_cast<uint32_t>(d), grp,
                                cfg_.scanMs[static_cast<size_t>(grp)], round.requests.size());
        }
    }
    sched_.setRequestGapMs(cfg_.requestGapMs);
}

bool FinsDriver::splitRequestAt(size_t dev, int group, size_t index) {
    std::lock_guard<std::mutex> g(schedMu_);
    std::vector<Request>& reqs = rounds_[dev][static_cast<size_t>(group)].requests;
    const Request old = reqs[index];
    std::vector<Request> parts;
    if (old.multi) {
        for (const SubBlock& b : old.blocks) {
            Request r;
            r.blocks.push_back(b);
            parts.push_back(std::move(r));
        }
    } else {
        const SubBlock& ob = old.blocks.front();
        if (ob.tags.size() < 2) return false;
        std::vector<PlanItem> items;
        mat::drv::Block whole;
        whole.start = ob.start;
        whole.end = ob.start + ob.count;
        for (size_t k = 0; k < ob.tags.size(); ++k) {
            const FinsTagBinding& t = cfg_.tags[ob.tags[k]];
            items.push_back({ob.tags[k], t.addr.wire, t.addr.wire + std::max(1, t.addr.words)});
            whole.items.push_back(k);
        }
        mat::drv::Block first, second;
        if (!splitBlock(items, whole, first, second)) return false;
        for (const mat::drv::Block* b : {&first, &second}) {
            Request r;
            SubBlock sb;
            sb.code = ob.code;
            sb.words = ob.words;
            sb.start = b->start;
            sb.count = b->end - b->start;
            for (size_t idx : b->items) sb.tags.push_back(items[idx].tag);
            r.blocks.push_back(std::move(sb));
            parts.push_back(std::move(r));
        }
    }
    reqs.erase(reqs.begin() + static_cast<long>(index));
    reqs.insert(reqs.begin() + static_cast<long>(index), parts.begin(), parts.end());
    sched_.setBlocks(static_cast<uint32_t>(dev), group, reqs.size());
    return true;
}

// ---- Publishing ---------------------------------------------------------------------------------

void FinsDriver::publishBad(const std::vector<size_t>& tags, const std::string& reason) {
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

void FinsDriver::publishBadAll(const std::string& reason, const std::vector<size_t>* except) {
    std::vector<size_t> all;
    for (size_t i = 0; i < cfg_.tags.size(); ++i) {
        const FinsTagBinding& t = cfg_.tags[i];
        if (t.device < cfg_.devices.size() && !cfg_.devices[t.device].enabled) continue;
        if (except && std::find(except->begin(), except->end(), i) != except->end()) continue;
        all.push_back(i);
    }
    publishBad(all, reason);
}

bool FinsDriver::decodeTag(const FinsTagBinding& t, const std::vector<uint16_t>& words,
                           TagScalar& out, std::string& reason) const {
    const size_t need = static_cast<size_t>(std::max(1, t.addr.words));
    if (words.size() < need) {
        reason = "BAD_FRAME";
        return false;
    }
    if (t.addr.flag) {
        out = words[0] != 0;
        return true;
    }
    if (t.addr.bit >= 0) {
        out = ((words[0] >> t.addr.bit) & 1U) != 0;
        return true;
    }
    if (t.rawType == TagType::STRING) {
        out = modbus::decodeString(t.stringLength, t.stringOrder, words);
        return true;
    }
    if (t.bcd) {
        uint64_t v = 0;
        if (!fins::bcdDecode(words, static_cast<int>(need), v)) {
            reason = "INVALID_VALUE";
            return false;
        }
        if (isSignedType(t.rawType))
            out = static_cast<int64_t>(v);
        else
            out = v;
        return true;
    }
    const modbus::DecodeResult d = modbus::decodeNumber(t.rawType, t.byteOrder, words);
    if (!d.ok) {
        reason = d.reason.empty() ? "INVALID_VALUE" : d.reason;
        return false;
    }
    out = d.value;
    return true;
}

bool FinsDriver::requestValues(const Request& r, const fins::Response& resp,
                               std::vector<std::vector<uint16_t>>& values) const {
    values.clear();
    if (!r.multi) {
        const SubBlock& b = r.blocks.front();
        std::vector<uint16_t> v;
        if (!fins::readData(resp.data, b.words, static_cast<size_t>(b.count), v)) return false;
        values.push_back(std::move(v));
        return true;
    }
    std::vector<fins::MultiItem> items;
    for (const SubBlock& b : r.blocks)
        for (int k = 0; k < b.count; ++k)
            items.push_back({b.code, static_cast<uint16_t>(b.start + k), 0});
    std::vector<uint16_t> all;
    if (!fins::multipleReadData(resp.data, items, all)) return false;
    size_t at = 0;
    for (const SubBlock& b : r.blocks) {
        values.emplace_back(all.begin() + static_cast<long>(at),
                            all.begin() + static_cast<long>(at + static_cast<size_t>(b.count)));
        at += static_cast<size_t>(b.count);
    }
    return true;
}

void FinsDriver::publishRequest(const Request& r,
                                const std::vector<std::vector<uint16_t>>& values) {
    std::vector<TagUpdate> ups;
    const int64_t w = wall();
    for (size_t bi = 0; bi < r.blocks.size(); ++bi) {
        const SubBlock& b = r.blocks[bi];
        const std::vector<uint16_t>& v = values[bi];
        for (size_t i : b.tags) {
            const FinsTagBinding& t = cfg_.tags[i];
            const size_t from = static_cast<size_t>(t.addr.wire - b.start);
            const size_t n = static_cast<size_t>(std::max(1, t.addr.words));
            std::vector<uint16_t> words;
            if (from + n <= v.size())
                words.assign(v.begin() + static_cast<long>(from),
                             v.begin() + static_cast<long>(from + n));
            TagUpdate u;
            u.tag = t.tag;
            u.sourceTs = w;
            std::string reason;
            if (decodeTag(t, words, u.value, reason)) {
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
    if (!ups.empty() && sink_) sink_->publish(std::move(ups));
}

// ---- The link -----------------------------------------------------------------------------------

bool FinsDriver::connectNow() {
    setChannelState(ChannelState::Connecting);
    const ConnectCode code = transport_->connect(cfg_.host, cfg_.port, cfg_.connectTimeoutMs);
    if (stopping_) return false;
    if (code != ConnectCode::Ok) {
        failConnect(connectCodeName(code),
                    code == ConnectCode::Refused ? "REFUSED" : "DISCONNECTED");
        return false;
    }
    us_.network = static_cast<uint8_t>(cfg_.sourceNetwork);
    us_.unit = 0;
    if (cfg_.tcp) {
        rx_.clear();
        if (!tcpHandshake()) return false;
    } else {
        const fins::UdpLink* link = dynamic_cast<const fins::UdpLink*>(transport_.get());
        us_.node = static_cast<uint8_t>(cfg_.sourceNode > 0 ? cfg_.sourceNode
                                                            : (link ? link->localNode() : 0));
        peerAutoNode_ = link ? link->peerNode() : 0;
    }
    onConnected();
    return true;
}

bool FinsDriver::tcpHandshake() {
    const Bytes req = fins::tcpNodeRequest(static_cast<uint32_t>(std::max(0, cfg_.sourceNode)));
    if (!transport_->writeAll(req.data(), req.size(), cfg_.connectTimeoutMs)) {
        transport_->close();
        failConnect("DISCONNECTED", "DISCONNECTED");
        return false;
    }
    const int64_t deadline = mono() + cfg_.connectTimeoutMs;
    for (;;) {
        const fins::TcpMessage m = fins::splitTcp(rx_.data(), rx_.size());
        if (m.status == fins::TcpSplit::Bad) break;
        if (m.status == fins::TcpSplit::Message) {
            uint32_t client = 0, server = 0;
            const bool ok = m.command == fins::kTcpNodeResponse && m.error == 0 &&
                            fins::tcpNodeResponse(rx_.data(), m.size, client, server) &&
                            client <= 254 && server <= 254;
            if (m.command == fins::kTcpNodeResponse && m.error != 0) {
                std::fprintf(stderr, "fins %s: the PLC refused the node address: %s\n",
                             cfg_.channelId.c_str(), fins::tcpErrorName(m.error));
                transport_->close();
                rx_.clear();
                failConnect("FINS_TCP_REFUSED", "REFUSED");
                return false;
            }
            rx_.erase(rx_.begin(), rx_.begin() + static_cast<long>(m.size));
            if (!ok) break;
            us_.node = static_cast<uint8_t>(client);
            serverNode_ = static_cast<int>(server);
            return true;
        }
        const int64_t left = deadline - mono();
        if (left <= 0) break;
        uint8_t buf[256];
        const ReadResult rr = transport_->read(buf, sizeof buf, static_cast<int>(left));
        if (rr.code == ReadCode::Data) {
            rx_.insert(rx_.end(), buf, buf + rr.n);
            continue;
        }
        if (rr.code == ReadCode::Interrupted) return false;
        if (rr.code != ReadCode::Timeout) {
            transport_->close();
            rx_.clear();
            failConnect("DISCONNECTED", "DISCONNECTED");
            return false;
        }
    }
    transport_->close();
    rx_.clear();
    failConnect("BAD_FRAME", "DISCONNECTED");
    return false;
}

void FinsDriver::onConnected() {
    connected_ = true;
    setChannelState(ChannelState::Connected);
    if (everConnected_) diag_.onReconnect();
    everConnected_ = true;
    firstSuccessPending_ = true;
    nextSid_ = env_.firstSid ? env_.firstSid() : static_cast<uint8_t>(randomUniform() * 256.0);
    for (size_t d = 0; d < cfg_.devices.size(); ++d)
        if (cfg_.devices[d].enabled) setDeviceState(d, DeviceState::Active);
    for (Backoff& b : deviceBackoff_) b.reset();
    forgetLate();
    buildPlan();  // a split plan starts again merged
    std::lock_guard<std::mutex> g(schedMu_);
    sched_.start(mono());
}

void FinsDriver::failConnect(const std::string& code, const std::string& reason) {
    connected_ = false;
    diag_.setLastError(code, wall());
    setChannelState(ChannelState::Error);
    publishBadAll(reason, nullptr);
    failQueuedWrites("NOT_SENT_DISCONNECTED");
    nextConnectMs_ = mono() + backoff_.nextDelayMs();
}

void FinsDriver::dropConnection(const char* errorCode, const std::vector<size_t>& failedTags,
                                const char* failedReason) {
    transport_->close();
    connected_ = false;
    rx_.clear();
    forgetLate();
    diag_.setLastError(errorCode, wall());
    setChannelState(ChannelState::Error);
    publishBad(failedTags, failedReason);
    publishBadAll("DISCONNECTED", &failedTags);
    failQueuedWrites("NOT_SENT_DISCONNECTED");
    nextConnectMs_ = mono() + backoff_.nextDelayMs();
}

fins::Endpoint FinsDriver::peerOf(size_t dev) const {
    const FinsDeviceConfig& dc = cfg_.devices[dev];
    fins::Endpoint e;
    e.network = static_cast<uint8_t>(dc.network);
    e.unit = static_cast<uint8_t>(dc.unit);
    int node = dc.node;
    if (node == 0) node = cfg_.tcp ? serverNode_ : peerAutoNode_;
    e.node = static_cast<uint8_t>(node);
    return e;
}

void FinsDriver::deviceAnswered(size_t dev) {
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

bool FinsDriver::deviceTimedOut(size_t dev, const std::vector<size_t>& tags) {
    ++timeoutsInARow_;
    timeoutDevices_[dev] = true;
    size_t devices = 0, enabled = 0;
    for (size_t d = 0; d < cfg_.devices.size(); ++d) {
        if (timeoutDevices_[d]) ++devices;
        if (cfg_.devices[d].enabled) ++enabled;
    }
    if (timeoutsInARow_ >= kTimeoutsToClose && devices >= std::min<size_t>(2, enabled)) {
        timeoutsInARow_ = 0;
        std::fill(timeoutDevices_.begin(), timeoutDevices_.end(), false);
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

void FinsDriver::forgetLate() {
    lateSids_.clear();
    timeoutsInARow_ = 0;
    std::fill(timeoutDevices_.begin(), timeoutDevices_.end(), false);
}

bool FinsDriver::deviceSuspended(size_t dev) const {
    return dev < cfg_.devices.size() &&
           deviceState_[dev].load() == static_cast<int>(DeviceState::Suspended);
}

// One FINS frame from the link before `deadline`. UDP: the next datagram; TCP: the next message of
// command 2 (other messages are dropped). false with `fail` Timeout, Closed, Lost or Interrupted.
bool FinsDriver::receiveFrame(int64_t deadline, Bytes& frame, Outcome& fail) {
    for (;;) {
        if (cfg_.tcp) {
            for (;;) {
                const fins::TcpMessage m = fins::splitTcp(rx_.data(), rx_.size());
                if (m.status == fins::TcpSplit::NeedMore) break;
                if (m.status == fins::TcpSplit::Bad) {
                    rx_.clear();
                    fail = Outcome::Lost;
                    return false;
                }
                const Bytes msg(rx_.begin(), rx_.begin() + static_cast<long>(m.size));
                rx_.erase(rx_.begin(), rx_.begin() + static_cast<long>(m.size));
                if (m.command == fins::kTcpFrame && m.error == 0) {
                    frame.assign(msg.begin() + static_cast<long>(fins::kTcpHeaderSize), msg.end());
                    return true;
                }
                if (m.command == fins::kTcpFrameError || m.error != 0) {
                    std::fprintf(stderr, "fins %s: FINS/TCP error: %s\n", cfg_.channelId.c_str(),
                                 fins::tcpErrorName(m.error));
                    fail = Outcome::Lost;
                    return false;
                }
                // any other message is not ours: dropped
            }
        }
        const int64_t left = deadline - mono();
        if (left <= 0) {
            fail = Outcome::Timeout;
            return false;
        }
        uint8_t buf[fins::kTcpHeaderSize + fins::kMaxFrame + 16];
        const ReadResult rr = transport_->read(buf, sizeof buf, static_cast<int>(left));
        if (rr.code == ReadCode::Data) {
            if (!cfg_.tcp) {
                frame.assign(buf, buf + rr.n);
                return true;
            }
            rx_.insert(rx_.end(), buf, buf + rr.n);
            if (rx_.size() > kRxMax) {
                rx_.clear();
                fail = Outcome::Lost;
                return false;
            }
            continue;
        }
        if (rr.code == ReadCode::Interrupted) {
            fail = Outcome::Interrupted;
            return false;
        }
        if (rr.code == ReadCode::Timeout) {
            fail = Outcome::Timeout;
            return false;
        }
        fail = Outcome::Closed;
        return false;
    }
}

FinsDriver::Exchange FinsDriver::exchange(size_t dev, uint16_t command, const Bytes& params,
                                          int timeoutMs, int retries) {
    Exchange ex;
    const int64_t begin = mono();
    const fins::Endpoint peer = peerOf(dev);
    for (int attempt = 0; attempt <= retries; ++attempt) {
        if (stopping_) {
            ex.outcome = Outcome::Interrupted;
            return ex;
        }
        uint8_t sid = nextSid_++;
        while (std::find(lateSids_.begin(), lateSids_.end(), sid) != lateSids_.end())
            sid = nextSid_++;
        const Bytes frame = fins::encodeCommand(peer, us_, sid, command, params);
        const Bytes wire = cfg_.tcp ? fins::tcpWrap(frame) : frame;
        const int64_t sentAt = mono();
        if (!transport_->writeAll(wire.data(), wire.size(), timeoutMs)) {
            ex.outcome = stopping_ ? Outcome::Interrupted : Outcome::Closed;
            return ex;
        }
        const int64_t deadline = sentAt + timeoutMs;
        for (;;) {
            Bytes in;
            Outcome fail = Outcome::Timeout;
            if (!receiveFrame(deadline, in, fail)) {
                if (fail != Outcome::Timeout) {
                    ex.outcome = fail;
                    ex.elapsedMs = mono() - begin;
                    return ex;
                }
                break;  // timed out: the next attempt with a new SID
            }
            const fins::Response r = fins::parseResponse(in.data(), in.size());
            const FrameIssue issue = fins::checkResponse(r, peer, us_, sid, command);
            if (issue != FrameIssue::None) {
                diag_.onBadFrame(dev, counterOf(issue));
                if (issue == FrameIssue::Sid) {  // the late answer of an earlier command
                    const auto it = std::find(lateSids_.begin(), lateSids_.end(), r.sid);
                    if (it != lateSids_.end()) lateSids_.erase(it);
                }
                continue;
            }
            ex.resp = r;
            ex.elapsedMs = mono() - begin;
            if (firstSuccessPending_) {
                firstSuccessPending_ = false;
                backoff_.reset();
            }
            if (r.endCode != 0) {
                ex.outcome = Outcome::EndCode;
                diag_.onException(dev, r.endCode);
                return ex;
            }
            diag_.onRequestOk(dev, mono() - sentAt, mono());
            ex.outcome = Outcome::Ok;
            return ex;
        }
        diag_.onTimeout(dev);
        lateSids_.push_back(sid);
        if (lateSids_.size() > kLateSidsKept) lateSids_.pop_front();
    }
    ex.outcome = Outcome::Timeout;
    ex.elapsedMs = mono() - begin;
    return ex;
}

// ---- Reads --------------------------------------------------------------------------------------

void FinsDriver::runRead(const Scheduler::Job& job) {
    const size_t dev = job.device;
    const int group = job.group;
    Request r;
    {
        std::lock_guard<std::mutex> g(schedMu_);
        const auto& reqs = rounds_[dev][static_cast<size_t>(group)].requests;
        if (job.block >= reqs.size()) {
            sched_.complete(job, mono());
            return;
        }
        r = reqs[job.block];
    }
    const FinsDeviceConfig& dc = cfg_.devices[dev];
    Bytes params;
    uint16_t command;
    if (r.multi) {
        std::vector<fins::MultiItem> items;
        for (const SubBlock& b : r.blocks)
            for (int k = 0; k < b.count; ++k)
                items.push_back({b.code, static_cast<uint16_t>(b.start + k), 0});
        command = fins::kMultipleMemoryAreaRead;
        params = fins::multipleReadParams(items);
    } else {
        const SubBlock& b = r.blocks.front();
        command = fins::kMemoryAreaRead;
        params = fins::memoryAreaReadParams(b.code, static_cast<uint16_t>(b.start), 0,
                                            static_cast<uint16_t>(b.count));
    }
    const Exchange ex = exchange(dev, command, params, dc.timeoutMs, dc.retries);
    size_t extraCompletes = 0;
    const std::vector<size_t> tags = r.tags();
    switch (ex.outcome) {
        case Outcome::Ok: {
            deviceAnswered(dev);
            setDeviceState(dev, DeviceState::Active);
            std::vector<std::vector<uint16_t>> values;
            if (requestValues(r, ex.resp, values)) {
                publishRequest(r, values);
            } else {
                diag_.onBadFrame(dev, BadFrameKind::Length);
                publishBad(tags, "BAD_FRAME");
            }
            break;
        }
        case Outcome::EndCode: {
            const uint16_t code = ex.resp.endCode;
            deviceAnswered(dev);  // an end code is a valid answer
            diag_.setLastError(fins::endCodeReason(code), wall(), dc.id);
            setDeviceState(
                dev, fins::endCodeUnreachable(code) ? DeviceState::Error : DeviceState::Active);
            size_t partsBefore = 0;
            {
                std::lock_guard<std::mutex> g(schedMu_);
                partsBefore = rounds_[dev][static_cast<size_t>(group)].requests.size();
            }
            if (fins::endCodeSplits(code) && splitRequestAt(dev, group, job.block)) {
                std::lock_guard<std::mutex> g(schedMu_);
                // the parts are read from the next round
                extraCompletes =
                    rounds_[dev][static_cast<size_t>(group)].requests.size() - partsBefore;
                break;
            }
            publishBad(tags, fins::endCodeReason(code));
            break;
        }
        case Outcome::Timeout:
            deviceTimedOut(dev, tags);
            break;
        case Outcome::Closed:
            dropConnection("DISCONNECTED", tags, "DISCONNECTED");
            break;
        case Outcome::Lost:
            dropConnection("BAD_FRAME", tags, "BAD_FRAME");
            break;
        case Outcome::Interrupted:
            return;
    }
    std::lock_guard<std::mutex> g(schedMu_);
    sched_.complete(job, mono());
    for (size_t k = 0; k < extraCompletes; ++k) sched_.complete(job, mono());
    if (job.kind == Scheduler::Kind::Probe && deviceSuspended(dev))
        sched_.setNextProbe(static_cast<uint32_t>(dev), probeAt_[dev]);
}

// ---- Writes -------------------------------------------------------------------------------------

bool FinsDriver::enqueueWrite(WriteCommand cmd) {
    if (!started_ || stopping_ || !cfg_.enabled) return false;
    const auto it = localOf_.find(cmd.tag);
    if (it == localOf_.end()) return false;
    const FinsTagBinding& t = cfg_.tags[it->second];
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

std::vector<uint64_t> FinsDriver::cancelQueuedWrites() {
    std::vector<uint64_t> ids;
    std::lock_guard<std::mutex> g(wmu_);
    for (const auto& w : writes_) ids.push_back(w.cmd.id);
    writes_.clear();
    return ids;
}

void FinsDriver::finishWrite(size_t local, WriteResult&& r) {
    const size_t dev = cfg_.tags[local].device;
    WriteOutcome o = WriteOutcome::Failed;
    if (r.status == WriteStatus::Confirmed || r.status == WriteStatus::NoReadback)
        o = WriteOutcome::Confirmed;
    else if (r.status == WriteStatus::Timeout)
        o = WriteOutcome::Timeout;
    diag_.onWrite(dev, o);
    if (!stopping_ && sink_) sink_->writeDone(std::move(r));
}

void FinsDriver::failQueuedWrites(const char* code) {
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

namespace {

// The words (or the bit) a write puts in the PLC. false: the value cannot be written.
bool encodeWrite(const FinsTagBinding& t, const TagScalar& raw, std::vector<uint16_t>& regs,
                 bool& bitValue) {
    if (t.addr.flag || !t.addr.writable) return false;
    if (t.addr.bit >= 0) return asBool(raw, bitValue);
    if (t.rawType == TagType::BOOL) return false;
    if (t.rawType == TagType::STRING) {
        const std::string* s = std::get_if<std::string>(&raw);
        if (!s) return false;
        const modbus::EncodeStringResult e =
            modbus::encodeString(t.stringLength, t.stringOrder, *s);
        if (!e.ok) return false;
        regs = e.registers;
        return true;
    }
    TagScalar v;
    if (!coerceNumber(t.rawType, raw, v)) return false;
    if (t.bcd) {
        uint64_t u = 0;
        if (const int64_t* i = std::get_if<int64_t>(&v)) {
            if (*i < 0) return false;
            u = static_cast<uint64_t>(*i);
        } else if (const uint64_t* p = std::get_if<uint64_t>(&v)) {
            u = *p;
        } else {
            return false;
        }
        return fins::bcdEncode(u, std::max(1, t.addr.words), regs);
    }
    regs = modbus::encodeNumber(t.rawType, t.byteOrder, v);
    return !regs.empty();
}

}  // namespace

void FinsDriver::runWrite() {
    QueuedWrite w;
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
    const FinsTagBinding& t = cfg_.tags[local];
    const size_t dev = t.device;
    const FinsDeviceConfig& dc = cfg_.devices[dev];
    auto complete = [&] {
        std::lock_guard<std::mutex> sg(schedMu_);
        Scheduler::Job j;
        j.kind = Scheduler::Kind::Write;
        sched_.complete(j, mono());
    };
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
    auto lose = [&](Outcome o) {
        if (o == Outcome::Timeout) {
            deviceTimedOut(dev, {local});
            return;
        }
        const char* code = o == Outcome::Lost ? "BAD_FRAME" : "DISCONNECTED";
        dropConnection(code, {local}, code);
    };

    std::vector<uint16_t> regs;
    bool bitValue = false;
    if (!encodeWrite(t, w.cmd.raw, regs, bitValue)) return fail("NOT_SENT_UNSUPPORTED");
    const bool bitWrite = t.addr.bit >= 0;
    const Bytes params =
        bitWrite
            ? fins::memoryAreaWriteParams(t.addr.bitCode, static_cast<uint16_t>(t.addr.wire),
                                          static_cast<uint8_t>(t.addr.bit), 1,
                                          {static_cast<uint8_t>(bitValue ? 1 : 0)})
            : fins::memoryAreaWriteParams(t.addr.wordCode, static_cast<uint16_t>(t.addr.wire), 0,
                                          static_cast<uint16_t>(regs.size()), wordBytes(regs));

    // sent once, never again
    const Exchange wx = exchange(dev, fins::kMemoryAreaWrite, params, dc.timeoutMs, 0);
    switch (wx.outcome) {
        case Outcome::Interrupted:
            return;
        case Outcome::EndCode:
            deviceAnswered(dev);
            res.status = WriteStatus::Failed;
            res.code = "DEVICE_EXCEPTION";
            res.exception = wx.resp.endCode;
            finishWrite(local, std::move(res));
            complete();
            return;
        case Outcome::Timeout:
        case Outcome::Closed:
        case Outcome::Lost:
            res.status = WriteStatus::Timeout;
            res.code = "WRITE_TIMEOUT";
            finishWrite(local, std::move(res));
            lose(wx.outcome);
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
    // the readback: the Tag's own words (or its bit), straight after the answer
    const Bytes rb =
        bitWrite ? fins::memoryAreaReadParams(t.addr.bitCode, static_cast<uint16_t>(t.addr.wire),
                                              static_cast<uint8_t>(t.addr.bit), 1)
                 : fins::memoryAreaReadParams(t.addr.wordCode, static_cast<uint16_t>(t.addr.wire),
                                              0, static_cast<uint16_t>(t.addr.words));
    const Exchange rx = exchange(dev, fins::kMemoryAreaRead, rb, dc.timeoutMs, 0);
    if (rx.outcome == Outcome::Interrupted) return;
    if (rx.outcome == Outcome::EndCode) {
        res.status = WriteStatus::Failed;
        res.code = "READBACK_ERROR";
        res.exception = rx.resp.endCode;
        finishWrite(local, std::move(res));
        complete();
        return;
    }
    if (rx.outcome != Outcome::Ok) {
        res.status = WriteStatus::Timeout;
        res.code = "READBACK_TIMEOUT";
        finishWrite(local, std::move(res));
        lose(rx.outcome);
        complete();
        return;
    }
    std::vector<uint16_t> back;
    const bool shaped = fins::readData(rx.resp.data, !bitWrite,
                                       bitWrite ? 1 : static_cast<size_t>(t.addr.words), back);
    bool match = false;
    if (shaped) match = bitWrite ? ((back[0] != 0) == bitValue) : back == regs;
    // a bit read back is published as the word it lives in would decode it: one bit
    std::vector<uint16_t> asWords = back;
    if (shaped && bitWrite) asWords = {static_cast<uint16_t>(back[0] ? (1U << t.addr.bit) : 0U)};
    TagScalar value;
    std::string why;
    if (shaped && decodeTag(t, asWords, value, why)) {
        TagUpdate u;
        u.tag = t.tag;
        u.value = value;
        u.quality = Quality::GOOD;
        u.sourceTs = wall();
        u.afterWrite = true;
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

void FinsDriver::start(EngineSink& sink) {
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
    transport_ = env_.makeTransport
                     ? env_.makeTransport()
                     : (cfg_.tcp ? std::unique_ptr<Transport>(new TcpSocket())
                                 : std::unique_ptr<Transport>(new fins::UdpLink(cfg_.localPort)));
    transport_->clearInterrupt();
    setChannelState(ChannelState::Connecting);
    buildPlan();
    if (env_.manual) return;
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setstacksize(&attr, 256 * 1024);  // ADR-014: one small stack per channel
    if (pthread_create(&thread_, &attr, &FinsDriver::threadMain, this) == 0) threadRunning_ = true;
    pthread_attr_destroy(&attr);
    if (!threadRunning_) {
        std::fprintf(stderr, "fins %s: cannot start the channel thread\n", cfg_.channelId.c_str());
        setChannelState(ChannelState::Error);
    }
}

void* FinsDriver::threadMain(void* self) {
    mat::setThreadName("mat-fins");
    FinsDriver* d = static_cast<FinsDriver*>(self);
    try {
        d->loop(std::numeric_limits<int64_t>::max());
    } catch (const std::exception& e) {
        std::fprintf(stderr, "fins %s: %s\n", d->cfg_.channelId.c_str(), e.what());
        d->setChannelState(ChannelState::Error);
    }
    return nullptr;
}

void FinsDriver::stop() { halt(); }

void FinsDriver::halt() {
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

void FinsDriver::pump(int64_t untilMs) {
    if (!started_ || !cfg_.enabled || stopping_) return;
    loop(untilMs);
}

void FinsDriver::idle(int64_t untilMs) {
    if (env_.sleep) {
        env_.sleep(untilMs);
        return;
    }
    const int64_t delay = std::max<int64_t>(0, untilMs - mono());
    std::unique_lock<std::mutex> l(mu_);
    cv_.wait_for(l, std::chrono::milliseconds(delay), [this] { return wake_ || stopping_.load(); });
    wake_ = false;
}

void FinsDriver::loop(int64_t untilMs) {
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
        if (cfg_.tcp && transport_->peerClosed()) {
            // the PLC closed the link while nothing was exchanged: open it again at once
            transport_->close();
            connected_ = false;
            rx_.clear();
            connectNow();
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

TestOutcome FinsDriver::test(const TestRequest& req) {
    FinsProbeRequest p;
    p.host = req.host.empty() ? cfg_.host : req.host;
    p.port = req.port > 0 ? req.port : cfg_.port;
    p.tcp = cfg_.tcp;
    p.localPort = cfg_.localPort;
    p.connectTimeoutMs = cfg_.connectTimeoutMs;
    p.timeoutMs = cfg_.devices.empty() ? 1000 : cfg_.devices[0].timeoutMs;
    p.src.network = static_cast<uint8_t>(cfg_.sourceNetwork);
    p.src.node = static_cast<uint8_t>(cfg_.sourceNode);
    if (!cfg_.devices.empty()) {
        p.dst.network = static_cast<uint8_t>(cfg_.devices[0].network);
        p.dst.node = static_cast<uint8_t>(cfg_.devices[0].node);
        p.dst.unit = static_cast<uint8_t>(cfg_.devices[0].unit);
    }
    if (req.read) {
        fins::AddressOptions o;
        o.rawType = req.address.find('.') != std::string::npos ? TagType::BOOL : TagType::UINT16;
        p.addr = fins::parseAddress(req.address, o);
        if (!p.addr.ok) {
            TestOutcome out;
            out.code = "BAD_REQUEST";
            return out;
        }
        p.read = true;
        p.count = req.count;
    }
    std::unique_ptr<Transport> t =
        env_.makeTransport ? env_.makeTransport()
                           : (p.tcp ? std::unique_ptr<Transport>(new TcpSocket())
                                    : std::unique_ptr<Transport>(new fins::UdpLink(p.localPort)));
    return probeFins(p, *t, *clock_).base;
}

// ---- probeFins ----------------------------------------------------------------------------------

FinsProbeOutcome probeFins(const FinsProbeRequest& req) {
    std::unique_ptr<Transport> t =
        req.tcp ? std::unique_ptr<Transport>(new TcpSocket())
                : std::unique_ptr<Transport>(new fins::UdpLink(req.localPort));
    SystemClock clock;
    return probeFins(req, *t, clock);
}

FinsProbeOutcome probeFins(const FinsProbeRequest& req, Transport& t, const Clock& clock) {
    FinsProbeOutcome out;
    TestOutcome& o = out.base;
    const int64_t begin = clock.monoMs();
    const ConnectCode cc = t.connect(req.host, req.port, req.connectTimeoutMs);
    o.connectMs = clock.monoMs() - begin;
    if (cc != ConnectCode::Ok) {
        o.code = connectCodeName(cc);
        o.elapsedMs = clock.monoMs() - begin;
        return out;
    }
    fins::Endpoint us = req.src, peer = req.dst;
    Bytes rx;
    auto readSome = [&](int64_t deadline) -> ReadCode {
        const int64_t left = deadline - clock.monoMs();
        if (left <= 0) return ReadCode::Timeout;
        uint8_t buf[fins::kTcpHeaderSize + fins::kMaxFrame + 16];
        const ReadResult rr = t.read(buf, sizeof buf, static_cast<int>(left));
        if (rr.code == ReadCode::Data) rx.insert(rx.end(), buf, buf + rr.n);
        return rr.code;
    };
    if (req.tcp) {
        const Bytes hs = fins::tcpNodeRequest(req.src.node);
        if (!t.writeAll(hs.data(), hs.size(), req.connectTimeoutMs)) {
            o.code = "DISCONNECTED";
            t.close();
            return out;
        }
        const int64_t deadline = clock.monoMs() + req.connectTimeoutMs;
        for (;;) {
            const fins::TcpMessage m = fins::splitTcp(rx.data(), rx.size());
            if (m.status == fins::TcpSplit::Bad) {
                o.code = "BAD_FRAME";
                t.close();
                return out;
            }
            if (m.status == fins::TcpSplit::Message) {
                uint32_t client = 0, server = 0;
                if (m.error != 0) {
                    o.code = "REFUSED";
                    t.close();
                    return out;
                }
                if (m.command != fins::kTcpNodeResponse ||
                    !fins::tcpNodeResponse(rx.data(), m.size, client, server)) {
                    o.code = "BAD_FRAME";
                    t.close();
                    return out;
                }
                rx.erase(rx.begin(), rx.begin() + static_cast<long>(m.size));
                us.node = static_cast<uint8_t>(client);
                if (peer.node == 0) peer.node = static_cast<uint8_t>(server);
                out.clientNode = static_cast<int>(client);
                out.serverNode = static_cast<int>(server);
                break;
            }
            const ReadCode rc = readSome(deadline);
            if (rc == ReadCode::Data) continue;
            o.code = rc == ReadCode::Timeout ? "TIMEOUT" : "DISCONNECTED";
            t.close();
            return out;
        }
    } else if (const fins::UdpLink* link = dynamic_cast<const fins::UdpLink*>(&t)) {
        if (us.node == 0) us.node = link->localNode();
        if (peer.node == 0) peer.node = link->peerNode();
    }
    const int count = std::max(1, std::min(4, req.count));
    uint16_t command = fins::kControllerDataRead;
    Bytes params;
    bool words = true;
    if (req.read) {
        command = fins::kMemoryAreaRead;
        words = !req.addr.flag && req.addr.bit < 0;
        const uint8_t code = words ? req.addr.wordCode : req.addr.bitCode;
        params =
            fins::memoryAreaReadParams(code, static_cast<uint16_t>(req.addr.wire),
                                       static_cast<uint8_t>(words ? 0 : std::max(0, req.addr.bit)),
                                       static_cast<uint16_t>(count));
        o.offset = req.addr.wire;
        o.count = count;
    }
    o.fc = command;
    const uint8_t sid = 1;
    const Bytes frame = fins::encodeCommand(peer, us, sid, command, params);
    o.requestFrame = frame;
    const Bytes wire = req.tcp ? fins::tcpWrap(frame) : frame;
    const int64_t sent = clock.monoMs();
    if (!t.writeAll(wire.data(), wire.size(), req.timeoutMs)) {
        o.code = "DISCONNECTED";
        t.close();
        return out;
    }
    const int64_t deadline = sent + req.timeoutMs;
    for (;;) {
        Bytes in;
        if (req.tcp) {
            const fins::TcpMessage m = fins::splitTcp(rx.data(), rx.size());
            if (m.status == fins::TcpSplit::Bad) {
                o.code = "BAD_FRAME";
                break;
            }
            if (m.status == fins::TcpSplit::Message) {
                if (m.command == fins::kTcpFrame && m.error == 0)
                    in.assign(rx.begin() + static_cast<long>(fins::kTcpHeaderSize),
                              rx.begin() + static_cast<long>(m.size));
                rx.erase(rx.begin(), rx.begin() + static_cast<long>(m.size));
                if (in.empty()) continue;
            } else {
                const ReadCode rc = readSome(deadline);
                if (rc == ReadCode::Data) continue;
                o.code = rc == ReadCode::Timeout ? "TIMEOUT" : "DISCONNECTED";
                break;
            }
        } else {
            rx.clear();
            const ReadCode rc = readSome(deadline);
            if (rc != ReadCode::Data) {
                o.code = rc == ReadCode::Timeout ? "TIMEOUT" : "DISCONNECTED";
                break;
            }
            in = rx;
        }
        const fins::Response r = fins::parseResponse(in.data(), in.size());
        if (fins::checkResponse(r, peer, us, sid, command) != FrameIssue::None) continue;
        o.responseFrame = in;
        o.responseMs = clock.monoMs() - sent;
        out.endCode = r.endCode;
        if (r.endCode != 0) {
            o.code = "END_CODE";
            o.exception = r.endCode;
            break;
        }
        if (command == fins::kControllerDataRead) {
            out.model = fins::controllerModel(r.data);
            o.code = "OK";
            break;
        }
        std::vector<uint16_t> v;
        if (!fins::readData(r.data, words, static_cast<size_t>(count), v)) {
            o.code = "BAD_FRAME";
            break;
        }
        if (words)
            o.registers = v;
        else
            for (uint16_t b : v) o.bits.push_back(static_cast<uint8_t>(b));
        o.code = "OK";
        break;
    }
    o.elapsedMs = clock.monoMs() - begin;
    t.close();
    return out;
}

}  // namespace mat::drv
