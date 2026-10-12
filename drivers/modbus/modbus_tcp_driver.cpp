#include "drivers/modbus/modbus_tcp_driver.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <exception>
#include <limits>
#include <optional>

#include "drivers/modbus/address.hpp"
#include "drivers/modbus/codec.hpp"
#include "drivers/modbus/exceptions.hpp"
#include "drivers/modbus/mbap.hpp"
#include "drivers/modbus/rtu_frame.hpp"
#include "drivers/modbus/test_probe.hpp"
#include "drivers/sdk/serial_port.hpp"
#include "drivers/sdk/serial_ports.hpp"
#include "drivers/sdk/tcp_socket.hpp"

namespace mat::drv {

using modbus::Area;
using modbus::Bytes;

namespace {

constexpr int64_t kIdleCapMs = 1000;  // the longest the thread sleeps without a reason to wake

int functionOf(Area a) {
    switch (a) {
        case Area::C:
            return 1;
        case Area::DI:
            return 2;
        case Area::HR:
            return 3;
        case Area::IR:
            return 4;
    }
    return 3;
}

bool isBitArea(Area a) { return a == Area::C || a == Area::DI; }

std::vector<std::string> deviceIds(const ModbusTcpConfig& c) {
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

// The raw value of a write in the variant the codec wants for `type`.
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

std::vector<uint16_t> slice(const std::vector<uint16_t>& v, size_t from, size_t n) {
    if (from >= v.size()) return {};
    return std::vector<uint16_t>(v.begin() + static_cast<long>(from),
                                 v.begin() + static_cast<long>(std::min(v.size(), from + n)));
}

}  // namespace

struct ModbusTcpDriver::WritePlan {
    bool ok = false;
    std::string code;            // NOT_SENT_* when !ok
    Bytes pdu;                   // the write request
    bool needRead = false;       // read-modify-write: read the register first
    bool bitValue = false;       // the bit, coil or BOOL being written
    std::vector<uint16_t> regs;  // the registers that must read back
};

ModbusTcpDriver::ModbusTcpDriver(ModbusTcpConfig config, DriverEnv env)
    : cfg_(std::move(config)),
      env_(std::move(env)),
      clock_(env_.clock ? env_.clock : &systemClock_),
      diag_(cfg_.channelId, deviceIds(cfg_)),
      backoff_(cfg_.reconnectMaxS, env_.uniform),
      lastBad_(cfg_.tags.size()) {
    deviceState_ = std::make_unique<std::atomic<int>[]>(std::max<size_t>(1, cfg_.devices.size()));
    for (size_t d = 0; d < cfg_.devices.size(); ++d) {
        const DeviceState s = cfg_.devices[d].enabled ? DeviceState::Active : DeviceState::Disabled;
        deviceState_[d] = static_cast<int>(s);
        diag_.setDeviceState(d, cfg_.devices[d].enabled ? "active" : "disabled");
    }
    for (size_t i = 0; i < cfg_.tags.size(); ++i) localOf_[cfg_.tags[i].tag] = i;
    failStreak_.assign(std::max<size_t>(1, cfg_.devices.size()), 0);
    if (cfg_.serial) {
        silenceMs_ =
            modbus::rtuSilenceMs(cfg_.serial->baud, cfg_.serial->dataBits, cfg_.serial->parity,
                                 cfg_.serial->stopBits, cfg_.serial->silenceMs);
        gapMs_ = modbus::rtuGapMs(silenceMs_);
    }
}

ModbusTcpDriver::~ModbusTcpDriver() { stop(); }

void ModbusTcpDriver::setChannelState(ChannelState s) {
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

void ModbusTcpDriver::setDeviceState(size_t dev, DeviceState s) {
    if (dev >= cfg_.devices.size()) return;
    if (deviceState_[dev].exchange(static_cast<int>(s)) == static_cast<int>(s)) return;
    const char* name = s == DeviceState::Active
                           ? "active"
                           : s == DeviceState::Suspended
                                 ? "suspended"
                                 : s == DeviceState::Error ? "error" : "disabled";
    diag_.setDeviceState(dev, name);
}

LinkState ModbusTcpDriver::linkState(uint32_t device) const {
    LinkState s;
    s.channel = static_cast<ChannelState>(channelState_.load());
    s.device = device < cfg_.devices.size() ? static_cast<DeviceState>(deviceState_[device].load())
                                            : DeviceState::Disabled;
    return s;
}

void ModbusTcpDriver::diagnostics(DriverDiag& out, int64_t /*nowMs*/) const {
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

// ---- Plan ---------------------------------------------------------------------------------------

void ModbusTcpDriver::buildPlan() {
    std::lock_guard<std::mutex> g(schedMu_);
    sched_ = Scheduler();
    rounds_.assign(cfg_.devices.size(), {});
    for (size_t d = 0; d < cfg_.devices.size(); ++d) {
        const ModbusDeviceConfig& dc = cfg_.devices[d];
        if (!dc.enabled) continue;
        for (int grp = 0; grp < 3; ++grp) {
            Round& round = rounds_[d][static_cast<size_t>(grp)];
            for (Area area : {Area::C, Area::DI, Area::HR, Area::IR}) {
                std::vector<PlanItem> items;
                for (size_t i = 0; i < cfg_.tags.size(); ++i) {
                    const TagBinding& t = cfg_.tags[i];
                    if (t.device != d || static_cast<int>(t.group) != grp || t.area != area)
                        continue;
                    items.push_back({i, t.offset, t.offset + std::max(1, t.count)});
                }
                if (items.empty()) continue;
                const bool bits = isBitArea(area);
                const int maxLen = bits ? std::min(dc.maxReadBits, modbus::kMaxReadBits)
                                        : std::min(dc.maxReadRegisters, modbus::kMaxReadRegisters);
                const int maxGap = bits ? dc.maxGapBits : dc.maxGapRegisters;
                for (const mat::drv::Block& b : planBlocks(items, maxGap, maxLen)) {
                    Block blk;
                    blk.area = area;
                    blk.start = b.start;
                    blk.count = b.end - b.start;
                    for (size_t idx : b.items) blk.tags.push_back(items[idx].tag);
                    round.blocks.push_back(std::move(blk));
                }
            }
            if (!round.blocks.empty())
                sched_.addRound(static_cast<uint32_t>(d), grp,
                                cfg_.scanMs[static_cast<size_t>(grp)], round.blocks.size());
        }
    }
    sched_.setRequestGapMs(cfg_.requestGapMs);
}

bool ModbusTcpDriver::splitBlockAt(size_t dev, int group, size_t blockIndex) {
    std::lock_guard<std::mutex> g(schedMu_);
    std::vector<Block>& blocks = rounds_[dev][static_cast<size_t>(group)].blocks;
    const Block old = blocks[blockIndex];
    if (old.tags.size() < 2) return false;
    std::vector<PlanItem> items;
    mat::drv::Block whole;
    whole.start = old.start;
    whole.end = old.start + old.count;
    for (size_t k = 0; k < old.tags.size(); ++k) {
        const TagBinding& t = cfg_.tags[old.tags[k]];
        items.push_back({old.tags[k], t.offset, t.offset + std::max(1, t.count)});
        whole.items.push_back(k);
    }
    mat::drv::Block first, second;
    if (!splitBlock(items, whole, first, second)) return false;
    auto make = [&](const mat::drv::Block& b) {
        Block blk;
        blk.area = old.area;
        blk.start = b.start;
        blk.count = b.end - b.start;
        for (size_t idx : b.items) blk.tags.push_back(items[idx].tag);
        return blk;
    };
    blocks[blockIndex] = make(first);
    blocks.insert(blocks.begin() + static_cast<long>(blockIndex) + 1, make(second));
    sched_.setBlocks(static_cast<uint32_t>(dev), group, blocks.size());
    return true;
}

// ---- Publishing ---------------------------------------------------------------------------------

void ModbusTcpDriver::publishBad(const std::vector<size_t>& tags, const std::string& reason) {
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

void ModbusTcpDriver::publishBadAll(const std::string& reason, const std::vector<size_t>* except) {
    std::vector<size_t> all;
    for (size_t i = 0; i < cfg_.tags.size(); ++i) {
        const TagBinding& t = cfg_.tags[i];
        if (t.device < cfg_.devices.size() && !cfg_.devices[t.device].enabled)
            continue;  // DISABLED
        if (except && std::find(except->begin(), except->end(), i) != except->end()) continue;
        all.push_back(i);
    }
    publishBad(all, reason);
}

bool ModbusTcpDriver::decodeTag(const TagBinding& t, int blockStart,
                                const std::vector<uint16_t>& regs, const std::vector<uint8_t>& bits,
                                TagScalar& out, std::string& reason) const {
    const size_t idx = static_cast<size_t>(t.offset - blockStart);
    if (isBitArea(t.area)) {
        if (idx >= bits.size()) {
            reason = "BAD_FRAME";
            return false;
        }
        out = bits[idx] != 0;
        return true;
    }
    if (t.bit >= 0 || t.rawType == TagType::BOOL) {
        if (idx >= regs.size()) {
            reason = "BAD_FRAME";
            return false;
        }
        out = t.bit >= 0 ? modbus::registerBit(regs[idx], t.bit) : regs[idx] != 0;
        return true;
    }
    const size_t words = static_cast<size_t>(
        t.rawType == TagType::STRING ? (t.stringLength + 1) / 2 : modbus::wordsOf(t.rawType));
    if (idx + words > regs.size()) {
        reason = "BAD_FRAME";
        return false;
    }
    const std::vector<uint16_t> r = slice(regs, idx, words);
    if (t.rawType == TagType::STRING) {
        out = modbus::decodeString(t.stringLength, t.stringOrder, r);
        return true;
    }
    const modbus::DecodeResult d = modbus::decodeNumber(t.rawType, t.byteOrder, r);
    if (!d.ok) {
        reason = d.reason.empty() ? "INVALID_VALUE" : d.reason;
        return false;
    }
    out = d.value;
    return true;
}

void ModbusTcpDriver::publishBlock(const Block& b, const Bytes& response) {
    std::vector<uint16_t> regs;
    std::vector<uint8_t> bits;
    if (isBitArea(b.area))
        bits = modbus::responseBits(response, static_cast<size_t>(b.count));
    else
        regs = modbus::responseRegisters(response);
    std::vector<TagUpdate> ups;
    const int64_t w = wall();
    for (size_t i : b.tags) {
        const TagBinding& t = cfg_.tags[i];
        TagUpdate u;
        u.tag = t.tag;
        u.sourceTs = w;
        std::string reason;
        if (decodeTag(t, b.start, regs, bits, u.value, reason)) {
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
    if (!ups.empty()) sink_->publish(std::move(ups));
}

// ---- The connection -----------------------------------------------------------------------------

bool ModbusTcpDriver::connectNow() {
    if (cfg_.serial) {
        setChannelState(ChannelState::Opening);
        // the console or a port out of the list is never opened (FR-035)
        const std::string refused = env_.checkPort ? env_.checkPort(cfg_.serial->port) : "";
        if (!refused.empty()) {
            failConnect(refused, refused);
            return false;
        }
        const ConnectCode code =
            transport_->connect(serialDevicePath(cfg_.serial->port), 0, cfg_.connectTimeoutMs);
        if (stopping_) return false;
        for (const std::string& w : transport_->takeWarnings()) diag_.addWarning(w);
        if (code == ConnectCode::Ok) {
            onConnected();
            return true;
        }
        const std::string name = connectCodeName(code);
        failConnect(name, name);
        return false;
    }
    setChannelState(ChannelState::Connecting);
    const ConnectCode code = transport_->connect(cfg_.host, cfg_.port, cfg_.connectTimeoutMs);
    if (stopping_) return false;
    if (code == ConnectCode::Ok) {
        onConnected();
        return true;
    }
    onConnectFailed(code);
    return false;
}

void ModbusTcpDriver::onConnected() {
    connected_ = true;
    setChannelState(ChannelState::Connected);
    if (everConnected_) diag_.onReconnect();
    everConnected_ = true;
    firstSuccessPending_ = true;
    rx_.clear();
    nextTid_ = env_.firstTid ? env_.firstTid() : static_cast<uint16_t>(randomUniform() * 65536.0);
    for (size_t d = 0; d < cfg_.devices.size(); ++d)
        if (cfg_.devices[d].enabled) setDeviceState(d, DeviceState::Active);
    std::fill(failStreak_.begin(), failStreak_.end(), 0);
    buildPlan();  // a plan that was split starts again merged (and no device is suspended)
    std::lock_guard<std::mutex> g(schedMu_);
    sched_.start(mono());
}

void ModbusTcpDriver::onConnectFailed(ConnectCode code) {
    failConnect(connectCodeName(code), code == ConnectCode::Refused ? "REFUSED" : "DISCONNECTED");
}

// `code` is the channel's last error, `reason` what every Tag of the channel is marked with.
void ModbusTcpDriver::failConnect(const std::string& code, const std::string& reason) {
    connected_ = false;
    diag_.setLastError(code, wall());
    setChannelState(ChannelState::Error);
    publishBadAll(reason, nullptr);
    failQueuedWrites("NOT_SENT_DISCONNECTED");
    failQueuedProbes();
    nextConnectMs_ = mono() + backoff_.nextDelayMs();
}

void ModbusTcpDriver::handleIdleClose() {
    // The PLC closed the connection while nothing was being exchanged: open it again at once, one
    // time, before anything is counted as an error (contracts §5).
    transport_->close();
    connected_ = false;
    rx_.clear();
    connectNow();
}

void ModbusTcpDriver::dropConnection(const char* errorCode, const std::vector<size_t>& failedTags,
                                     const char* failedReason) {
    transport_->close();
    connected_ = false;
    rx_.clear();
    diag_.setLastError(errorCode, wall());
    setChannelState(ChannelState::Error);
    publishBad(failedTags, failedReason);
    publishBadAll("DISCONNECTED", &failedTags);
    failQueuedWrites("NOT_SENT_DISCONNECTED");
    failQueuedProbes();
    nextConnectMs_ = mono() + backoff_.nextDelayMs();
}

// ---- One request and its response
// ----------------------------------------------------------------

// ---- RTU: one request and its response ------------------------------------------------------

ModbusTcpDriver::Exchange ModbusTcpDriver::exchangeRtu(size_t dev, const Bytes& pdu, int timeoutMs,
                                                       int retries) {
    Exchange ex;
    const ModbusDeviceConfig& dc = cfg_.devices[dev];
    const int64_t begin = mono();
    Outcome last = Outcome::Timeout;
    for (int attempt = 0; attempt <= retries; ++attempt) {
        if (stopping_) {
            ex.outcome = Outcome::Interrupted;
            return ex;
        }
        // The line quiet for t3.5, what is left of an earlier answer thrown away, then the request.
        waitLineQuiet(*transport_, silenceMs_);
        if (stopping_) {
            ex.outcome = Outcome::Interrupted;
            return ex;
        }
        const Bytes frame = modbus::encodeRtu(static_cast<uint8_t>(dc.unit), pdu);
        const int64_t sentAt = mono();
        if (!transport_->writeAll(frame.data(), frame.size(), timeoutMs)) {
            ex.outcome = stopping_ ? Outcome::Interrupted : Outcome::Closed;
            return ex;
        }
        const int64_t deadline = sentAt + timeoutMs;
        Bytes carry;
        if (cfg_.serial->dropEcho) {  // the bus gives back what was sent: read it, compare
            while (carry.size() < frame.size()) {
                const int64_t left = deadline - mono();
                if (left <= 0) break;
                uint8_t buf[256];
                const ReadResult er = transport_->read(buf, sizeof buf, static_cast<int>(left));
                if (er.code == ReadCode::Data) {
                    carry.insert(carry.end(), buf, buf + er.n);
                } else if (er.code == ReadCode::Interrupted) {
                    ex.outcome = Outcome::Interrupted;
                    return ex;
                } else if (er.code == ReadCode::Timeout) {
                    break;
                } else {
                    ex.outcome = Outcome::Closed;
                    return ex;
                }
            }
            if (carry.size() < frame.size() ||
                !std::equal(frame.begin(), frame.end(), carry.begin())) {
                diag_.onBadFrame(dev, BadFrameKind::Echo);
                last = Outcome::Lost;
                continue;
            }
            carry.erase(carry.begin(), carry.begin() + static_cast<long>(frame.size()));
        }
        const modbus::RtuReceive rx = modbus::rtuReceive(*transport_, *clock_, deadline, gapMs_,
                                                         silenceMs_, std::move(carry));
        switch (rx.status) {
            case modbus::RtuReceive::Status::Timeout:
                diag_.onTimeout(dev);
                last = Outcome::Timeout;
                continue;
            case modbus::RtuReceive::Status::Closed:
            case modbus::RtuReceive::Status::Error:
                ex.outcome = Outcome::Closed;
                return ex;
            case modbus::RtuReceive::Status::Interrupted:
                ex.outcome = Outcome::Interrupted;
                return ex;
            case modbus::RtuReceive::Status::Short:
            case modbus::RtuReceive::Status::Extra:
                diag_.onBadFrame(dev, BadFrameKind::Length);
                last = Outcome::Lost;
                continue;
            case modbus::RtuReceive::Status::Format:
                diag_.onBadFrame(dev, BadFrameKind::Format);
                last = Outcome::Lost;
                continue;
            case modbus::RtuReceive::Status::Frame:
                break;
        }
        const modbus::RtuCheck ck = modbus::checkRtuResponse(static_cast<uint8_t>(dc.unit), pdu,
                                                             rx.bytes.data(), rx.bytes.size());
        if (ck.issue != modbus::RtuIssue::None) {
            diag_.onBadFrame(dev, modbus::rtuIssueCounter(ck.issue));
            last = Outcome::Lost;
            continue;
        }
        ex.pdu.assign(rx.bytes.begin() + 1, rx.bytes.end() - 2);
        ex.elapsedMs = mono() - begin;
        if (firstSuccessPending_) {
            firstSuccessPending_ = false;
            backoff_.reset();
        }
        if (ck.pdu.kind == modbus::ResponseKind::Exception) {
            ex.outcome = Outcome::Exception;
            ex.exception = ck.pdu.exception;
            diag_.onException(dev, ex.exception);
            if ((ex.exception == 5 || ex.exception == 6) && attempt < retries) continue;
            return ex;
        }
        diag_.onRequestOk(dev, mono() - sentAt, mono());
        ex.outcome = Outcome::Ok;
        return ex;
    }
    ex.outcome = last;
    ex.elapsedMs = mono() - begin;
    return ex;
}

// RTU: no valid answer is not a lost connection. The Tags of the request are BAD; after 3 requests
// in a row the whole device is suspended and asked one probe every 10 s (FR-027).
void ModbusTcpDriver::deviceFailed(size_t dev, const std::vector<size_t>& tags,
                                   const char* reason) {
    diag_.setLastError(reason, wall(), cfg_.devices[dev].id);
    if (deviceSuspended(dev)) return;  // a probe that fails: the Tags keep DEVICE_SUSPENDED
    publishBad(tags, reason);
    if (++failStreak_[dev] < 3) return;
    setDeviceState(dev, DeviceState::Suspended);
    {
        std::lock_guard<std::mutex> g(schedMu_);
        sched_.setSuspended(static_cast<uint32_t>(dev), true, mono());
    }
    std::vector<size_t> all;
    for (size_t i = 0; i < cfg_.tags.size(); ++i)
        if (cfg_.tags[i].device == dev) all.push_back(i);
    publishBad(all, "DEVICE_SUSPENDED");
}

void ModbusTcpDriver::deviceAnswered(size_t dev) {
    failStreak_[dev] = 0;
    if (!deviceSuspended(dev)) return;
    {
        std::lock_guard<std::mutex> g(schedMu_);
        sched_.setSuspended(static_cast<uint32_t>(dev), false, mono());
    }
    setDeviceState(dev, DeviceState::Active);
}

bool ModbusTcpDriver::deviceSuspended(size_t dev) const {
    return dev < cfg_.devices.size() &&
           deviceState_[dev].load() == static_cast<int>(DeviceState::Suspended);
}

ModbusTcpDriver::Exchange ModbusTcpDriver::exchange(size_t dev, const Bytes& pdu, int timeoutMs,
                                                    int retries) {
    if (cfg_.serial) return exchangeRtu(dev, pdu, timeoutMs, retries);
    Exchange ex;
    const ModbusDeviceConfig& dc = cfg_.devices[dev];
    const int64_t begin = mono();
    for (int attempt = 0; attempt <= retries; ++attempt) {
        const uint16_t tid = nextTid_++;
        const Bytes frame = modbus::encodeAdu(tid, static_cast<uint8_t>(dc.unit), pdu);
        const int64_t sentAt = mono();
        if (!transport_->writeAll(frame.data(), frame.size(), timeoutMs)) {
            ex.outcome = stopping_ ? Outcome::Interrupted : Outcome::Closed;
            return ex;
        }
        const int64_t deadline = sentAt + timeoutMs;
        bool again = false;
        for (;;) {
            // the frames already received, in order
            for (;;) {
                const modbus::Split s = modbus::splitFrame(rx_.data(), rx_.size());
                if (s.status == modbus::SplitStatus::NeedMore) break;
                if (s.status == modbus::SplitStatus::Lost) {
                    diag_.onBadFrame(dev, BadFrameKind::Length);
                    rx_.clear();
                    ex.outcome = Outcome::Lost;
                    return ex;
                }
                const Bytes f(rx_.begin(), rx_.begin() + static_cast<long>(s.size));
                rx_.erase(rx_.begin(), rx_.begin() + static_cast<long>(s.size));
                const modbus::AduCheck ck = modbus::checkTcpResponse(
                    tid, static_cast<uint8_t>(dc.unit), pdu, f.data(), f.size());
                if (ck.issue != modbus::FrameIssue::None) {
                    diag_.onBadFrame(dev, modbus::frameIssueCounter(ck.issue));
                    continue;  // dropped; the wait goes on
                }
                ex.pdu.assign(f.begin() + static_cast<long>(modbus::kMbapSize), f.end());
                ex.elapsedMs = mono() - begin;
                if (firstSuccessPending_) {
                    firstSuccessPending_ = false;
                    backoff_.reset();
                }
                if (ck.pdu.kind == modbus::ResponseKind::Exception) {
                    ex.outcome = Outcome::Exception;
                    ex.exception = ck.pdu.exception;
                    diag_.onException(dev, ex.exception);
                    if ((ex.exception == 5 || ex.exception == 6) && attempt < retries) {
                        again = true;  // busy: try again as `retries` says
                        break;
                    }
                    return ex;
                }
                diag_.onRequestOk(dev, mono() - sentAt, mono());
                ex.outcome = Outcome::Ok;
                return ex;
            }
            if (again) break;
            const int64_t left = deadline - mono();
            ReadResult rr;
            if (left > 0) {
                uint8_t buf[512];
                rr = transport_->read(buf, sizeof buf, static_cast<int>(left));
                if (rr.code == ReadCode::Data) {
                    rx_.insert(rx_.end(), buf, buf + rr.n);
                    continue;
                }
                if (rr.code == ReadCode::Interrupted) {
                    ex.outcome = Outcome::Interrupted;
                    return ex;
                }
                if (rr.code != ReadCode::Timeout) {
                    ex.outcome = Outcome::Closed;
                    return ex;
                }
            }
            // the wait is over
            diag_.onTimeout(dev);
            if (!rx_.empty()) {  // a frame cut short: what is left of it is of no use
                diag_.onBadFrame(dev, BadFrameKind::Length);
                rx_.clear();
            }
            break;
        }
        if (again) continue;
        if (attempt < retries) continue;  // timed out: the next attempt
        ex.outcome = Outcome::Timeout;
        ex.elapsedMs = mono() - begin;
        return ex;
    }
    return ex;
}

void ModbusTcpDriver::runRead(const Scheduler::Job& job) {
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
    const ModbusDeviceConfig& dc = cfg_.devices[dev];
    const Bytes pdu = modbus::readRequest(functionOf(b.area), b.start, b.count);
    const Exchange ex = exchange(dev, pdu, dc.timeoutMs, dc.retries);
    bool skipSecondHalf = false;
    switch (ex.outcome) {
        case Outcome::Ok:
            if (cfg_.serial) deviceAnswered(dev);
            setDeviceState(dev, DeviceState::Active);
            publishBlock(b, ex.pdu);
            break;
        case Outcome::Exception: {
            const int code = ex.exception;
            if (cfg_.serial) deviceAnswered(dev);  // an exception is a valid answer
            setDeviceState(
                dev, (code == 0x0A || code == 0x0B) ? DeviceState::Error : DeviceState::Active);
            if ((code == 2 || code == 3) && splitBlockAt(dev, group, job.block)) {
                skipSecondHalf = true;  // the two halves are read from the next round (FR-025)
                break;
            }
            publishBad(b.tags, modbus::exceptionReason(code));
            break;
        }
        case Outcome::Timeout:
            if (cfg_.serial)
                deviceFailed(dev, b.tags, "TIMEOUT");
            else
                dropConnection("TIMEOUT", b.tags, "TIMEOUT");
            break;
        case Outcome::Closed:
            dropConnection("DISCONNECTED", b.tags, "DISCONNECTED");
            break;
        case Outcome::Lost:
            if (cfg_.serial)
                deviceFailed(dev, b.tags, "BAD_FRAME");
            else
                dropConnection("BAD_FRAME", b.tags, "BAD_FRAME");
            break;
        case Outcome::Interrupted:
            return;
    }
    std::lock_guard<std::mutex> g(schedMu_);
    sched_.complete(job, mono());
    if (skipSecondHalf) sched_.complete(job, mono());
}

// ---- Writes -------------------------------------------------------------------------------------

bool ModbusTcpDriver::enqueueWrite(WriteCommand cmd) {
    if (!started_ || stopping_ || !cfg_.enabled) return false;
    const auto it = localOf_.find(cmd.tag);
    if (it == localOf_.end()) return false;
    const TagBinding& t = cfg_.tags[it->second];
    if (t.device >= cfg_.devices.size() || !cfg_.devices[t.device].enabled) return false;
    {
        std::lock_guard<std::mutex> g(wmu_);
        if (writes_.size() >= static_cast<size_t>(cfg_.writeQueueCapacity)) return false;
        writes_.push_back({std::move(cmd), mono()});
    }
    {
        std::lock_guard<std::mutex> l(mu_);
        wake_ = true;
    }
    cv_.notify_all();
    return true;
}

std::vector<uint64_t> ModbusTcpDriver::cancelQueuedWrites() {
    std::vector<uint64_t> ids;
    std::lock_guard<std::mutex> g(wmu_);
    for (const auto& w : writes_) ids.push_back(w.cmd.id);
    writes_.clear();
    return ids;
}

void ModbusTcpDriver::finishWrite(size_t local, WriteResult&& r) {
    const size_t dev = cfg_.tags[local].device;
    WriteOutcome o = WriteOutcome::Failed;
    if (r.status == WriteStatus::Confirmed || r.status == WriteStatus::NoReadback)
        o = WriteOutcome::Confirmed;
    else if (r.status == WriteStatus::Timeout)
        o = WriteOutcome::Timeout;
    diag_.onWrite(dev, o);
    if (!stopping_ && sink_) sink_->writeDone(std::move(r));
}

void ModbusTcpDriver::failQueuedWrites(const char* code) {
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

bool makePlanFor(const TagBinding& t, const TagScalar& raw, bool single16, Bytes& pdu,
                 bool& needRead, bool& bitValue, std::vector<uint16_t>& regs, std::string& code) {
    needRead = false;
    auto regsPdu = [&](const std::vector<uint16_t>& r) {
        pdu = (r.size() == 1 && !single16) ? modbus::writeSingleRegister(t.offset, r[0])
                                           : modbus::writeMultipleRegisters(t.offset, r);
        return !pdu.empty();
    };
    if (t.area == Area::C) {
        if (!asBool(raw, bitValue)) {
            code = "NOT_SENT_UNSUPPORTED";
            return false;
        }
        pdu = t.writeSingleCoilFc15
                  ? modbus::writeMultipleCoils(t.offset, {static_cast<uint8_t>(bitValue)})
                  : modbus::writeSingleCoil(t.offset, bitValue);
        if (pdu.empty()) code = "NOT_SENT_UNSUPPORTED";
        return !pdu.empty();
    }
    if (t.area != Area::HR) {
        code = "NOT_SENT_UNSUPPORTED";
        return false;
    }
    if (t.bit >= 0) {
        if (!asBool(raw, bitValue)) {
            code = "NOT_SENT_UNSUPPORTED";
            return false;
        }
        if (t.bitWrite == BitWrite::Mask) {
            const modbus::MaskWrite m = modbus::maskWrite(t.bit, bitValue);
            pdu = modbus::maskWriteRegister(t.offset, m.andMask, m.orMask);
            if (pdu.empty()) code = "NOT_SENT_UNSUPPORTED";
            return !pdu.empty();
        }
        if (t.bitWrite == BitWrite::ReadModifyWrite) {
            needRead = true;
            return true;
        }
        code = "NOT_SENT_UNSUPPORTED";
        return false;
    }
    if (t.rawType == TagType::BOOL) {
        if (!asBool(raw, bitValue)) {
            code = "NOT_SENT_UNSUPPORTED";
            return false;
        }
        regs = {static_cast<uint16_t>(bitValue ? 1 : 0)};
    } else if (t.rawType == TagType::STRING) {
        const std::string* s = std::get_if<std::string>(&raw);
        if (!s) {
            code = "NOT_SENT_UNSUPPORTED";
            return false;
        }
        const modbus::EncodeStringResult e =
            modbus::encodeString(t.stringLength, t.stringOrder, *s);
        if (!e.ok) {
            code = "NOT_SENT_UNSUPPORTED";
            return false;
        }
        regs = e.registers;
    } else {
        TagScalar v;
        if (!coerceNumber(t.rawType, raw, v)) {
            code = "NOT_SENT_UNSUPPORTED";
            return false;
        }
        regs = modbus::encodeNumber(t.rawType, t.byteOrder, v);
    }
    if (!regsPdu(regs)) code = "NOT_SENT_UNSUPPORTED";
    return !pdu.empty();
}

}  // namespace

void ModbusTcpDriver::runWrite() {
    QueuedWrite w;
    bool probeFirst;
    {
        std::lock_guard<std::mutex> g(wmu_);
        probeFirst = !probes_.empty();
    }
    if (probeFirst) {
        runProbeRequest();
        return;
    }
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
    const TagBinding& t = cfg_.tags[local];
    const size_t dev = t.device;
    const ModbusDeviceConfig& dc = cfg_.devices[dev];
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
    // RTU: a device that does not answer is not asked to write (it would wait out the timeout)
    if (cfg_.serial && deviceSuspended(dev)) return fail("NOT_SENT_DEVICE_SUSPENDED");
    // The request of this write had no valid answer: a lost connection on TCP; on a serial line the
    // device is counted (and suspended after 3), the port stays.
    auto lose = [&](Outcome o) {
        if (cfg_.serial && (o == Outcome::Timeout || o == Outcome::Lost)) {
            deviceFailed(dev, {local}, o == Outcome::Timeout ? "TIMEOUT" : "BAD_FRAME");
            return;
        }
        const char* code = o == Outcome::Timeout ? "TIMEOUT" : "DISCONNECTED";
        dropConnection(code, {local}, code);
    };

    WritePlan plan;
    plan.ok = makePlanFor(t, w.cmd.raw, t.writeSingleRegisterFc16, plan.pdu, plan.needRead,
                          plan.bitValue, plan.regs, plan.code);
    if (!plan.ok) return fail(plan.code.empty() ? "NOT_SENT_UNSUPPORTED" : plan.code.c_str());

    if (plan.needRead) {  // read-modify-write: the register as it is now, then the bit changed
        const Bytes rd = modbus::readRequest(3, t.offset, 1);
        const Exchange rx = exchange(dev, rd, dc.timeoutMs, 0);
        if (rx.outcome == Outcome::Interrupted) return;
        if (rx.outcome != Outcome::Ok) {
            fail("NOT_SENT_READ_FAILED");
            if (rx.outcome == Outcome::Timeout || rx.outcome == Outcome::Closed ||
                rx.outcome == Outcome::Lost)
                lose(rx.outcome);
            return;
        }
        if (cfg_.serial) deviceAnswered(dev);
        const auto regs = modbus::responseRegisters(rx.pdu);
        if (regs.empty()) return fail("NOT_SENT_READ_FAILED");
        plan.regs = {modbus::applyBit(regs[0], t.bit, plan.bitValue)};
        plan.pdu = (!t.writeSingleRegisterFc16)
                       ? modbus::writeSingleRegister(t.offset, plan.regs[0])
                       : modbus::writeMultipleRegisters(t.offset, plan.regs);
    }

    // sent once, never again
    const Exchange wx = exchange(dev, plan.pdu, dc.timeoutMs, 0);
    switch (wx.outcome) {
        case Outcome::Interrupted:
            return;
        case Outcome::Exception:
            if (cfg_.serial) deviceAnswered(dev);
            res.status = WriteStatus::Failed;
            res.code = "DEVICE_EXCEPTION";
            res.exception = wx.exception;
            finishWrite(local, std::move(res));
            complete();
            return;
        case Outcome::Timeout:
        case Outcome::Closed:
        case Outcome::Lost:
            res.status = WriteStatus::Timeout;
            res.code = "WRITE_TIMEOUT";
            finishWrite(local, std::move(res));  // its result first, then the ones behind it
            lose(wx.outcome);
            complete();
            return;
        case Outcome::Ok:
            if (cfg_.serial) deviceAnswered(dev);
            break;
    }
    if (!w.cmd.readback) {
        res.status = WriteStatus::NoReadback;
        res.code = "NO_READBACK";
        finishWrite(local, std::move(res));
        complete();
        return;
    }

    // the readback: the Tag's own range, straight after the answer, before any queued read
    const bool bitArea = t.area == Area::C;
    const int words = (t.bit >= 0 || t.rawType == TagType::BOOL) ? 1 : std::max(1, t.count);
    const Bytes rb = modbus::readRequest(bitArea ? 1 : 3, t.offset, bitArea ? 1 : words);
    const Exchange rx = exchange(dev, rb, dc.timeoutMs, 0);
    if (rx.outcome == Outcome::Interrupted) return;
    if (rx.outcome == Outcome::Exception) {
        res.status = WriteStatus::Failed;
        res.code = "READBACK_ERROR";
        res.exception = rx.exception;
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
    std::vector<uint16_t> regs;
    std::vector<uint8_t> bits;
    if (bitArea)
        bits = modbus::responseBits(rx.pdu, 1);
    else
        regs = modbus::responseRegisters(rx.pdu);
    bool match = false;
    if (bitArea)
        match = !bits.empty() && (bits[0] != 0) == plan.bitValue;
    else if (t.bit >= 0)
        match = !regs.empty() && modbus::registerBit(regs[0], t.bit) == plan.bitValue;
    else if (t.rawType == TagType::BOOL)
        match = !regs.empty() && (regs[0] != 0) == plan.bitValue;
    else
        match = regs == plan.regs;  // bit for bit, byte for byte
    TagScalar value;
    std::string why;
    if (decodeTag(t, t.offset, regs, bits, value, why)) {
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

void ModbusTcpDriver::start(EngineSink& sink) {
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
    transport_ = env_.makeTransport ? env_.makeTransport() : makeDefaultTransport();
    transport_->clearInterrupt();
    setChannelState(cfg_.serial ? ChannelState::Opening : ChannelState::Connecting);
    buildPlan();
    if (env_.manual) return;
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setstacksize(&attr, 256 * 1024);  // ADR-014: one small stack per channel
    if (pthread_create(&thread_, &attr, &ModbusTcpDriver::threadMain, this) == 0)
        threadRunning_ = true;
    pthread_attr_destroy(&attr);
    if (!threadRunning_) {
        std::fprintf(stderr, "modbus %s: cannot start the channel thread\n",
                     cfg_.channelId.c_str());
        setChannelState(ChannelState::Error);
    }
}

void* ModbusTcpDriver::threadMain(void* self) {
    ModbusTcpDriver* d = static_cast<ModbusTcpDriver*>(self);
    try {
        d->loop(std::numeric_limits<int64_t>::max());
    } catch (const std::exception& e) {
        std::fprintf(stderr, "modbus %s: %s\n", d->cfg_.channelId.c_str(), e.what());
        d->setChannelState(ChannelState::Error);
    }
    return nullptr;
}

void ModbusTcpDriver::stop() {
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
    failQueuedProbes();  // a connection test that waits for this channel is answered
    started_ = false;
}

void ModbusTcpDriver::pump(int64_t untilMs) {
    if (!started_ || !cfg_.enabled || stopping_) return;
    loop(untilMs);
}

void ModbusTcpDriver::idle(int64_t untilMs) {
    if (env_.sleep) {
        env_.sleep(untilMs);
        return;
    }
    const int64_t delay = std::max<int64_t>(0, untilMs - mono());
    std::unique_lock<std::mutex> l(mu_);
    cv_.wait_for(l, std::chrono::milliseconds(delay), [this] { return wake_ || stopping_.load(); });
    wake_ = false;
}

void ModbusTcpDriver::loop(int64_t untilMs) {
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
        if (transport_->peerClosed()) {
            handleIdleClose();
            continue;
        }
        bool writePending;
        {
            std::lock_guard<std::mutex> g(wmu_);
            writePending = !writes_.empty() || !probes_.empty();
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

TestOutcome ModbusTcpDriver::test(const TestRequest& req) {
    if (cfg_.serial) {
        RtuProbeRequest p;
        p.devicePath =
            serialDevicePath(req.serialPort.empty() ? cfg_.serial->port : req.serialPort);
        p.baud = cfg_.serial->baud;
        p.dataBits = cfg_.serial->dataBits;
        p.parity = cfg_.serial->parity;
        p.stopBits = cfg_.serial->stopBits;
        p.rs485 = cfg_.serial->rs485;
        p.dropEcho = cfg_.serial->dropEcho;
        p.silenceMs = cfg_.serial->silenceMs;
        p.connectTimeoutMs = cfg_.connectTimeoutMs;
        p.unit = req.unit;
        p.timeoutMs = cfg_.devices.empty() ? 1000 : cfg_.devices[0].timeoutMs;
        if (req.read) {
            modbus::AddressOptions o;
            o.addressBase = 0;
            o.rawType = TagType::UINT16;
            const modbus::AddressResult a = modbus::parseAddress(req.address, o);
            if (!a.ok) {
                TestOutcome out;
                out.code = "BAD_REQUEST";
                return out;
            }
            p.read = true;
            p.area = a.area;
            p.offset = a.offset;
            p.count = req.count;
        }
        // this channel holds the port: the test goes through its queue
        if (p.read && channelState_.load() == static_cast<int>(ChannelState::Connected) &&
            (req.serialPort.empty() ||
             serialDevicePath(req.serialPort) == serialDevicePath(cfg_.serial->port)))
            return probeThroughQueue(p, p.connectTimeoutMs + p.timeoutMs + 2000);
        std::unique_ptr<Transport> t =
            env_.makeTransport ? env_.makeTransport() : makeDefaultTransport();
        return probeModbusRtu(p, *t, *clock_);
    }
    TcpProbeRequest p;
    p.host = req.host.empty() ? cfg_.host : req.host;
    p.port = req.port > 0 ? req.port : cfg_.port;
    p.connectTimeoutMs = cfg_.connectTimeoutMs;
    p.unit = req.unit;
    p.timeoutMs = cfg_.devices.empty() ? 1000 : cfg_.devices[0].timeoutMs;
    if (req.read) {
        modbus::AddressOptions o;
        o.addressBase = 0;
        o.rawType = TagType::UINT16;
        const modbus::AddressResult a = modbus::parseAddress(req.address, o);
        if (!a.ok) {
            TestOutcome out;
            out.code = "BAD_REQUEST";
            return out;
        }
        p.read = true;
        p.area = a.area;
        p.offset = a.offset;
        p.count = req.count;
    }
    std::unique_ptr<Transport> t =
        env_.makeTransport ? env_.makeTransport() : std::unique_ptr<Transport>(new TcpSocket());
    return probeModbusTcp(p, *t, *clock_);
}

std::unique_ptr<Transport> ModbusTcpDriver::makeDefaultTransport() const {
    if (!cfg_.serial) return std::unique_ptr<Transport>(new TcpSocket());
    SerialParams p;
    p.baud = cfg_.serial->baud;
    p.dataBits = cfg_.serial->dataBits;
    p.parity = cfg_.serial->parity;
    p.stopBits = cfg_.serial->stopBits;
    p.rs485 = cfg_.serial->rs485;
    return std::unique_ptr<Transport>(new SerialPort(p));
}

bool ModbusTcpDriver::sameSerialFrame(const SerialLink& o) const {
    if (!cfg_.serial) return false;
    const SerialLink& s = *cfg_.serial;
    return serialDevicePath(s.port) == serialDevicePath(o.port) && s.baud == o.baud &&
           s.dataBits == o.dataBits && s.parity == o.parity && s.stopBits == o.stopBits;
}

// ---- RTU: a connection test through the queue of the channel
// -------------------------------------

TestOutcome ModbusTcpDriver::probeThroughQueue(const RtuProbeRequest& request, int waitMs) {
    TestOutcome out;
    if (!cfg_.serial || !started_ || stopping_ ||
        channelState_.load() != static_cast<int>(ChannelState::Connected)) {
        out.code = "PORT_ERROR";
        return out;
    }
    auto slot = std::make_shared<ProbeSlot>();
    slot->req = request;
    {
        std::lock_guard<std::mutex> g(wmu_);
        probes_.push_back(slot);
    }
    {
        std::lock_guard<std::mutex> l(mu_);
        wake_ = true;
    }
    cv_.notify_all();
    std::unique_lock<std::mutex> l(probeMu_);
    if (!probeCv_.wait_for(l, std::chrono::milliseconds(waitMs), [&] { return slot->done; })) {
        l.unlock();
        {  // still waiting in the queue: take it out
            std::lock_guard<std::mutex> g(wmu_);
            probes_.erase(std::remove(probes_.begin(), probes_.end(), slot), probes_.end());
        }
        out.code = "TIMEOUT";
        return out;
    }
    return slot->out;
}

void ModbusTcpDriver::runProbeRequest() {
    std::shared_ptr<ProbeSlot> slot;
    {
        std::lock_guard<std::mutex> g(wmu_);
        if (!probes_.empty()) {
            slot = probes_.front();
            probes_.pop_front();
        }
    }
    if (slot) {
        TestOutcome out = probeModbusRtuOnOpen(slot->req, *transport_, *clock_);
        {
            std::lock_guard<std::mutex> l(probeMu_);
            slot->out = std::move(out);
            slot->done = true;
        }
        probeCv_.notify_all();
    }
    std::lock_guard<std::mutex> sg(schedMu_);
    Scheduler::Job j;
    j.kind = Scheduler::Kind::Write;
    sched_.complete(j, mono());
}

void ModbusTcpDriver::failQueuedProbes() {
    std::deque<std::shared_ptr<ProbeSlot>> q;
    {
        std::lock_guard<std::mutex> g(wmu_);
        q.swap(probes_);
    }
    for (auto& s : q) {
        {
            std::lock_guard<std::mutex> l(probeMu_);
            s->out.code = "PORT_ERROR";
            s->done = true;
        }
    }
    probeCv_.notify_all();
}

}  // namespace mat::drv
