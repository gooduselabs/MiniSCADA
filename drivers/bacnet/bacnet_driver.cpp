#include "drivers/bacnet/bacnet_driver.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <exception>
#include <limits>
#include <map>

#include "core/common/thread_name.hpp"

namespace mat::drv {

using bacnet::Bytes;
using bacnet::ObjectId;
using bacnet::PropertyResult;
using bacnet::Reply;
using bacnet::Value;

namespace {

constexpr int64_t kIdleCapMs = 1000;
constexpr int kDeviceBackoffCapS = 30;  // the backoff of one device, 1 s to 30 s
constexpr uint16_t kRegisterNak = 0x0030;
// status-flags as the Tag value: bit 0 in-alarm, 1 fault, 2 overridden, 3 out-of-service
constexpr uint32_t kFlagFault = 2, kFlagOverridden = 4, kFlagOutOfService = 8;

std::vector<std::string> deviceIds(const BacnetConfig& c) {
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

bool asDouble(const TagScalar& v, double& out) {
    if (const double* d = std::get_if<double>(&v))
        out = *d;
    else if (const int64_t* i = std::get_if<int64_t>(&v))
        out = static_cast<double>(*i);
    else if (const uint64_t* u = std::get_if<uint64_t>(&v))
        out = static_cast<double>(*u);
    else if (const bool* b = std::get_if<bool>(&v))
        out = *b ? 1 : 0;
    else
        return false;
    return std::isfinite(out);
}

bool asUnsigned(const TagScalar& v, uint64_t& out) {
    if (const uint64_t* u = std::get_if<uint64_t>(&v)) {
        out = *u;
        return true;
    }
    if (const int64_t* i = std::get_if<int64_t>(&v)) {
        if (*i < 0) return false;
        out = static_cast<uint64_t>(*i);
        return true;
    }
    if (const double* d = std::get_if<double>(&v)) {
        if (!std::isfinite(*d) || *d < 0 || *d > 4294967295.0) return false;
        out = static_cast<uint64_t>(std::llround(*d));
        return true;
    }
    return false;
}

// The range of an integer raw type.
void intRange(TagType t, int64_t& lo, uint64_t& hi) {
    switch (t) {
        case TagType::INT16:
            lo = -32768;
            hi = 32767;
            return;
        case TagType::UINT16:
            lo = 0;
            hi = 65535;
            return;
        case TagType::INT32:
            lo = std::numeric_limits<int32_t>::min();
            hi = static_cast<uint64_t>(std::numeric_limits<int32_t>::max());
            return;
        case TagType::UINT32:
            lo = 0;
            hi = std::numeric_limits<uint32_t>::max();
            return;
        case TagType::INT64:
            lo = std::numeric_limits<int64_t>::min();
            hi = static_cast<uint64_t>(std::numeric_limits<int64_t>::max());
            return;
        default:
            lo = 0;
            hi = std::numeric_limits<uint64_t>::max();
            return;
    }
}

bool isSignedType(TagType t) {
    return t == TagType::INT16 || t == TagType::INT32 || t == TagType::INT64;
}

// The element of a Tag in the plan: its property, or priority-array[p] for `relinquish`.
void itemOf(const BacnetTagBinding& t, uint32_t& prop, int64_t& index) {
    if (t.addr.relinquish) {
        prop = bacnet::kPropPriorityArray;
        index = t.addr.priority;
    } else {
        prop = t.addr.property;
        index = -1;
    }
}

std::vector<bacnet::ObjectRefs> objectRefsOf(const std::vector<bacnet::ObjectId>& objs,
                                             const std::vector<bacnet::PropertyRef>& props) {
    std::vector<bacnet::ObjectRefs> out;
    for (size_t i = 0; i < objs.size(); ++i) {
        if (out.empty() || !(out.back().obj == objs[i])) out.push_back({objs[i], {}});
        out.back().props.push_back(props[i]);
    }
    return out;
}

}  // namespace

std::vector<size_t> BacnetDriver::Request::tags() const {
    std::vector<size_t> out;
    for (const Item& i : items) out.insert(out.end(), i.tags.begin(), i.tags.end());
    return out;
}

BacnetDriver::BacnetDriver(BacnetConfig config, BacnetEnv env)
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
    targets_.assign(n, {});
    resolved_.assign(n, false);
    rpmOff_.assign(n, false);
}

BacnetDriver::~BacnetDriver() { halt(); }

void BacnetDriver::setChannelState(ChannelState s) {
    channelState_ = static_cast<int>(s);
    static const char* const kNames[] = {"disabled", "connecting", "opening", "connected", "error"};
    diag_.setChannelState(kNames[static_cast<int>(s)]);
}

void BacnetDriver::setDeviceState(size_t dev, DeviceState s) {
    if (dev >= cfg_.devices.size()) return;
    if (deviceState_[dev].exchange(static_cast<int>(s)) == static_cast<int>(s)) return;
    static const char* const kNames[] = {"active", "suspended", "error", "disabled"};
    diag_.setDeviceState(dev, kNames[static_cast<int>(s)]);
}

LinkState BacnetDriver::linkState(uint32_t device) const {
    LinkState s;
    s.channel = static_cast<ChannelState>(channelState_.load());
    s.device = device < cfg_.devices.size() ? static_cast<DeviceState>(deviceState_[device].load())
                                            : DeviceState::Disabled;
    return s;
}

void BacnetDriver::diagnostics(DriverDiag& out, int64_t /*nowMs*/) const {
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

std::vector<BacnetDriver::PlannedRequest> BacnetDriver::plannedRequests(uint32_t device,
                                                                        int group) const {
    std::vector<PlannedRequest> out;
    std::lock_guard<std::mutex> g(schedMu_);
    if (device >= rounds_.size() || group < 0 || group > 2) return out;
    for (const Request& r : rounds_[device][static_cast<size_t>(group)].requests) {
        PlannedRequest p;
        p.rpm = r.rpm;
        for (const Item& i : r.items) p.items.push_back({i.obj, i.property, i.arrayIndex});
        out.push_back(std::move(p));
    }
    return out;
}

// ---- Plan ---------------------------------------------------------------------------------------

void BacnetDriver::buildDevicePlan(size_t dev) {
    const BacnetDeviceConfig& dc = cfg_.devices[dev];
    const bool rpm = dc.useRpm && !rpmOff_[dev];
    for (int g = 0; g < 3; ++g) {
        // the items of the group, in the order of the Tags, grouped by object
        std::vector<Item> items;
        std::vector<ObjectId> objects;
        auto add = [&](ObjectId obj, uint32_t prop, int64_t index, long tag, int strLen) {
            for (Item& it : items)
                if (it.obj == obj && it.property == prop && it.arrayIndex == index) {
                    if (tag >= 0) it.tags.push_back(static_cast<size_t>(tag));
                    it.stringLength = std::max(it.stringLength, strLen);
                    return;
                }
            Item it;
            it.obj = obj;
            it.property = prop;
            it.arrayIndex = index;
            it.stringLength = strLen;
            if (tag >= 0) it.tags.push_back(static_cast<size_t>(tag));
            items.push_back(std::move(it));
            if (std::find(objects.begin(), objects.end(), obj) == objects.end())
                objects.push_back(obj);
        };
        for (size_t i = 0; i < cfg_.tags.size(); ++i) {
            const BacnetTagBinding& t = cfg_.tags[i];
            if (t.device != dev || static_cast<int>(t.group) != g) continue;
            const ObjectId obj{t.addr.objectType, t.addr.instance};
            uint32_t prop = 0;
            int64_t index = -1;
            itemOf(t, prop, index);
            // FR-008: the status-flags of the object give the quality of its present-value; read
            // before it (one ReadProperty after the other when the device has no RPM)
            if (!t.addr.relinquish && t.addr.property == bacnet::kPropPresentValue)
                add(obj, bacnet::kPropStatusFlags, -1, -1, 0);
            add(obj, prop, index, static_cast<long>(i), t.stringLength);
        }
        std::vector<Item> ordered;
        for (const ObjectId& o : objects)
            for (Item& it : items)
                if (it.obj == o) ordered.push_back(it);
        std::vector<Request> reqs;
        if (!rpm) {
            for (Item& it : ordered) reqs.push_back({false, {it}});
        } else {
            const size_t maxApdu = static_cast<size_t>(std::max(50, dc.maxApdu));
            Request cur;
            size_t reqBytes = 4, ansBytes = 3;
            for (Item& it : ordered) {
                for (int pass = 0; pass < 2; ++pass) {
                    const bool newObj = cur.items.empty() || !(cur.items.back().obj == it.obj);
                    const size_t addReq = bacnet::rpmRequestBytes({it.property, it.arrayIndex}) +
                                          (newObj ? bacnet::rpmObjectRequestBytes() : 0);
                    const size_t addAns =
                        bacnet::rpmAnswerBytes(it.property, it.stringLength) + (newObj ? 7 : 0);
                    const bool full =
                        !cur.items.empty() &&
                        (reqBytes + addReq > maxApdu || ansBytes + addAns > maxApdu ||
                         cur.items.size() + 1 > static_cast<size_t>(std::max(1, dc.maxRpmProps)));
                    if (full && pass == 0) {
                        reqs.push_back(std::move(cur));
                        cur = Request{};
                        reqBytes = 4;
                        ansBytes = 3;
                        continue;
                    }
                    reqBytes += addReq;
                    ansBytes += addAns;
                    cur.items.push_back(it);
                    break;
                }
            }
            if (!cur.items.empty()) reqs.push_back(std::move(cur));
        }
        rounds_[dev][static_cast<size_t>(g)].requests = std::move(reqs);
    }
}

void BacnetDriver::buildPlan() {
    std::lock_guard<std::mutex> g(schedMu_);
    rounds_.assign(cfg_.devices.size(), {});
    sched_ = Scheduler();
    sched_.setRequestGapMs(cfg_.requestGapMs);
    for (size_t d = 0; d < cfg_.devices.size(); ++d) {
        buildDevicePlan(d);
        if (!cfg_.devices[d].enabled) continue;
        for (int grp = 0; grp < 3; ++grp) {
            const size_t n = rounds_[d][static_cast<size_t>(grp)].requests.size();
            if (n)
                sched_.addRound(static_cast<uint32_t>(d), grp,
                                cfg_.scanMs[static_cast<size_t>(grp)], n);
        }
    }
}

bool BacnetDriver::splitRequestAt(size_t dev, int group, size_t index) {
    auto& reqs = rounds_[dev][static_cast<size_t>(group)].requests;
    if (index >= reqs.size() || reqs[index].items.size() < 2) return false;
    Request a = reqs[index];
    Request b;
    b.rpm = a.rpm;
    const size_t half = a.items.size() / 2;
    b.items.assign(a.items.begin() + static_cast<long>(half), a.items.end());
    a.items.resize(half);
    reqs[index] = std::move(a);
    reqs.insert(reqs.begin() + static_cast<long>(index) + 1, std::move(b));
    sched_.setBlocks(static_cast<uint32_t>(dev), group, reqs.size());
    return true;
}

// ---- Publishing ---------------------------------------------------------------------------------

void BacnetDriver::publishBad(const std::vector<size_t>& tags, const std::string& reason) {
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

void BacnetDriver::publishBadAll(const std::string& reason) {
    std::vector<size_t> all;
    for (size_t i = 0; i < cfg_.tags.size(); ++i) {
        const BacnetTagBinding& t = cfg_.tags[i];
        if (t.device < cfg_.devices.size() && !cfg_.devices[t.device].enabled) continue;
        all.push_back(i);
    }
    publishBad(all, reason);
}

bool BacnetDriver::decodeTag(const BacnetTagBinding& t, const std::vector<Value>& values,
                             TagScalar& out, std::string& reason) const {
    if (values.empty()) {
        reason = "BACNET_TYPE";
        return false;
    }
    const Value& v = values[0];
    if (t.addr.relinquish) {
        out = v.tag == bacnet::kTagNull;
        return true;
    }
    if (t.rawType == TagType::STRING) {
        if (v.tag != bacnet::kTagCharString && v.tag != bacnet::kTagOctetString) {
            reason = "BACNET_TYPE";
            return false;
        }
        std::string s = v.s;
        if (t.stringLength > 0 && s.size() > static_cast<size_t>(t.stringLength))
            s.resize(static_cast<size_t>(t.stringLength));
        out = s;
        return true;
    }
    // the content as a number
    bool isReal = false, isSigned = false;
    double d = 0;
    int64_t i = 0;
    uint64_t u = 0;
    switch (v.tag) {
        case bacnet::kTagReal:
        case bacnet::kTagDouble:
            isReal = true;
            d = v.d;
            break;
        case bacnet::kTagUnsigned:
        case bacnet::kTagEnumerated:
            u = v.u;
            break;
        case bacnet::kTagSigned:
            isSigned = true;
            i = v.i;
            break;
        case bacnet::kTagBoolean:
            u = v.b ? 1 : 0;
            break;
        case bacnet::kTagBitString:
            u = v.bits;
            break;
        default:
            reason = "BACNET_TYPE";
            return false;
    }
    if (t.rawType == TagType::BOOL) {
        out = isReal ? d != 0 : isSigned ? i != 0 : u != 0;
        return true;
    }
    if (t.rawType == TagType::FLOAT32 || t.rawType == TagType::FLOAT64) {
        if (isReal && !std::isfinite(d)) {
            reason = "INVALID_VALUE";
            return false;
        }
        out = isReal ? d : isSigned ? static_cast<double>(i) : static_cast<double>(u);
        return true;
    }
    int64_t lo = 0;
    uint64_t hi = 0;
    intRange(t.rawType, lo, hi);
    if (isReal) {
        if (!std::isfinite(d) || d < static_cast<double>(lo) - 0.5 ||
            d > static_cast<double>(hi) + 0.5) {
            reason = "INVALID_VALUE";
            return false;
        }
        if (d < 0) {
            isSigned = true;
            i = std::llround(d);
        } else {
            u = static_cast<uint64_t>(std::llround(d));
        }
    }
    if (isSigned && i >= 0) {
        u = static_cast<uint64_t>(i);
        isSigned = false;
    }
    if (isSigned) {
        if (i < lo) {
            reason = "INVALID_VALUE";
            return false;
        }
        out = i;
        return true;
    }
    if (u > hi) {
        reason = "INVALID_VALUE";
        return false;
    }
    if (isSignedType(t.rawType))
        out = static_cast<int64_t>(u);
    else
        out = u;
    return true;
}

void BacnetDriver::publishResults(size_t dev, const Request& r,
                                  const std::vector<PropertyResult>& results) {
    auto find = [&](const Item& it) -> const PropertyResult* {
        for (const PropertyResult& p : results)
            if (p.obj == it.obj && p.property == it.property &&
                (p.arrayIndex == it.arrayIndex || (it.arrayIndex < 0 && p.arrayIndex < 0)))
                return &p;
        // a ReadProperty-ACK of one item carries what was asked
        return results.size() == 1 && r.items.size() == 1 ? &results[0] : nullptr;
    };
    // the status-flags of the objects of the request
    // the status-flags of the objects, kept from request to request (ReadProperty mode, a split)
    const auto key = [dev](ObjectId o) { return static_cast<uint64_t>(dev) << 32 | o.raw(); };
    for (const Item& it : r.items) {
        if (it.property != bacnet::kPropStatusFlags) continue;
        const PropertyResult* p = find(it);
        if (p && p->ok && !p->values.empty() && p->values[0].tag == bacnet::kTagBitString)
            flags_[key(it.obj)] = p->values[0].bits;
    }
    const auto& flags = flags_;
    std::vector<TagUpdate> ups;
    const int64_t w = wall();
    for (const Item& it : r.items) {
        const PropertyResult* p = find(it);
        for (size_t ti : it.tags) {
            const BacnetTagBinding& t = cfg_.tags[ti];
            TagUpdate u;
            u.tag = t.tag;
            u.sourceTs = w;
            std::string reason;
            if (!p) {
                reason = "BAD_FRAME";
            } else if (!p->ok) {
                reason = bacnet::errorReason(p->errorCode);
            } else if (decodeTag(t, p->values, u.value, reason)) {
                u.quality = Quality::GOOD;
                const auto f = flags.find(key(it.obj));
                if (f != flags.end() && !t.addr.relinquish &&
                    t.addr.property == bacnet::kPropPresentValue) {
                    if (f->second & kFlagFault) {
                        reason = "BACNET_FAULT";
                        u.value = TagScalar{};
                    } else if (f->second & kFlagOutOfService) {
                        u.quality = Quality::UNCERTAIN;
                        u.reason = "BACNET_OUT_OF_SERVICE";
                    } else if (f->second & kFlagOverridden) {
                        u.quality = Quality::UNCERTAIN;
                        u.reason = "BACNET_OVERRIDDEN";
                    }
                }
            }
            if (!reason.empty()) {
                u.quality = Quality::BAD;
                u.reason = reason;
                u.value = TagScalar{};
                if (lastBad_[ti] == reason) continue;
                lastBad_[ti] = reason;
            } else {
                lastBad_[ti].clear();
            }
            ups.push_back(std::move(u));
        }
    }
    if (!ups.empty() && sink_) sink_->publish(std::move(ups));
}

// ---- The port -----------------------------------------------------------------------------------

bool BacnetDriver::openNow() {
    setChannelState(ChannelState::Connecting);
    const ConnectCode code = port_->open(cfg_.localPort, cfg_.bindAddress);
    if (stopping_) return false;
    if (code != ConnectCode::Ok) {
        failOpen(connectCodeName(code));
        return false;
    }
    client_ = std::make_unique<bacnet::Client>(*port_, *clock_, &stopping_);
    client_->setFirstInvokeId(env_.firstInvokeId ? env_.firstInvokeId()
                                                 : static_cast<uint8_t>(randomUniform() * 256.0));
    client_->onBadFrame = [this] { diag_.onBadFrame(currentDevice_, BadFrameKind::Format); };
    client_->onTimeout = [this] { diag_.onTimeout(currentDevice_); };
    client_->onOther = [this](const bacnet::Frame& f, uint32_t ip, uint16_t port) {
        onOther(f, ip, port);
    };
    auto resolve = env_.resolve ? env_.resolve : bacnet::resolveIpv4;
    for (size_t d = 0; d < cfg_.devices.size(); ++d) {
        const BacnetDeviceConfig& dc = cfg_.devices[d];
        bacnet::Target& t = targets_[d];
        t.port = static_cast<uint16_t>(dc.port);
        t.route.network = dc.network;
        t.route.mac = dc.mac;
        t.maxApdu = dc.maxApdu;
        resolved_[d] = dc.enabled && resolve(dc.host, t.ip);
        if (dc.enabled && !resolved_[d]) diag_.setLastError("DNS", wall(), dc.id);
    }
    bbmdIp_ = 0;
    if (!cfg_.bbmdHost.empty() && !resolve(cfg_.bbmdHost, bbmdIp_)) {
        bbmdIp_ = 0;
        diag_.setLastError("DNS", wall());
    }
    open_ = true;
    setChannelState(ChannelState::Connected);
    if (everOpen_) diag_.onReconnect();
    everOpen_ = true;
    for (size_t d = 0; d < cfg_.devices.size(); ++d)
        if (cfg_.devices[d].enabled) setDeviceState(d, DeviceState::Active);
    for (Backoff& b : deviceBackoff_) b.reset();
    nextRegisterMs_ = 0;
    buildPlan();
    std::lock_guard<std::mutex> g(schedMu_);
    sched_.start(mono());
    return true;
}

void BacnetDriver::failOpen(const std::string& code) {
    open_ = false;
    if (port_) port_->close();
    diag_.setLastError(code, wall());
    setChannelState(ChannelState::Error);
    publishBadAll("DISCONNECTED");
    failQueuedWrites("NOT_SENT_DISCONNECTED");
    nextOpenMs_ = mono() + backoff_.nextDelayMs();
}

void BacnetDriver::registerForeign() {
    if (bbmdIp_ == 0 || !client_) return;
    const int ttl = std::max(30, cfg_.bbmdTtlS);
    client_->send(bbmdIp_, static_cast<uint16_t>(cfg_.bbmdPort),
                  bacnet::buildRegisterForeignDevice(static_cast<uint16_t>(ttl)));
    nextRegisterMs_ = mono() + ttl * 500;  // again every TTL / 2
}

void BacnetDriver::onOther(const bacnet::Frame& f, uint32_t ip, uint16_t /*port*/) {
    if (f.bvlc == bacnet::kBvlcResult && f.bvlcResult == kRegisterNak && ip == bbmdIp_ &&
        !bbmdNakWarned_) {
        bbmdNakWarned_ = true;
        diag_.addWarning("BBMD_NAK");
        std::fprintf(stderr, "bacnet %s: the BBMD refused the foreign device registration\n",
                     cfg_.channelId.c_str());
    }
}

void BacnetDriver::deviceAnswered(size_t dev) {
    deviceBackoff_[dev].reset();
    backoff_.reset();
    if (!deviceSuspended(dev)) return;
    {
        std::lock_guard<std::mutex> g(schedMu_);
        sched_.setSuspended(static_cast<uint32_t>(dev), false, mono());
    }
    setDeviceState(dev, DeviceState::Active);
}

void BacnetDriver::deviceTimedOut(size_t dev) {
    diag_.setLastError(resolved_[dev] ? "TIMEOUT" : "DNS", wall(), cfg_.devices[dev].id);
    std::vector<size_t> all;
    for (size_t i = 0; i < cfg_.tags.size(); ++i)
        if (cfg_.tags[i].device == dev) all.push_back(i);
    publishBad(all, resolved_[dev] ? "TIMEOUT" : "DISCONNECTED");
    probeAt_[dev] = mono() + deviceBackoff_[dev].nextDelayMs();
    setDeviceState(dev, DeviceState::Suspended);
    std::lock_guard<std::mutex> g(schedMu_);
    sched_.setSuspended(static_cast<uint32_t>(dev), true, mono());
    sched_.setNextProbe(static_cast<uint32_t>(dev), probeAt_[dev]);
}

bool BacnetDriver::deviceSuspended(size_t dev) const {
    return dev < cfg_.devices.size() &&
           deviceState_[dev].load() == static_cast<int>(DeviceState::Suspended);
}

// Exceptions of the diagnostics: the BACnet error code, 1000 + a Reject reason, 2000 + an Abort
// reason (spec FR-009, FR-014).
void BacnetDriver::countException(size_t dev, const Reply& r) {
    int code = -1;
    if (r.code == Reply::Code::Error) code = static_cast<int>(r.errorCode);
    if (r.code == Reply::Code::Reject) code = 1000 + r.reason;
    if (r.code == Reply::Code::Abort) code = 2000 + r.reason;
    if (r.code == Reply::Code::Segmented)
        code = r.pduType == bacnet::kAbort ? 2000 + r.reason
                                           : 2000 + bacnet::kAbortSegmentationNotSupported;
    if (code >= 0) diag_.onException(dev, code);
    diag_.setLastError(replyReason(r), wall(), cfg_.devices[dev].id);
}

std::string BacnetDriver::replyReason(const Reply& r) const {
    switch (r.code) {
        case Reply::Code::Error:
            return bacnet::errorReason(r.errorCode);
        case Reply::Code::Reject:
            return "BACNET_REJECT";
        case Reply::Code::Abort:
            return "BACNET_ABORT";
        case Reply::Code::Segmented:
            return "BACNET_SEGMENTATION";
        case Reply::Code::Timeout:
            return "TIMEOUT";
        default:
            return "DISCONNECTED";
    }
}

Reply BacnetDriver::call(size_t dev, uint8_t service, const Bytes& data, int retries) {
    currentDevice_ = dev;
    const BacnetDeviceConfig& dc = cfg_.devices[dev];
    Reply r = client_->request(targets_[dev], service, data, dc.timeoutMs, retries);
    if (r.code != Reply::Code::Timeout && r.code != Reply::Code::Closed &&
        r.code != Reply::Code::Interrupted)
        diag_.onRequestOk(dev, r.responseMs, mono());
    return r;
}

// ---- Reads --------------------------------------------------------------------------------------

bool BacnetDriver::readRequest(size_t dev, const Request& r, std::vector<PropertyResult>& results,
                               Reply& reply) {
    results.clear();
    const BacnetDeviceConfig& dc = cfg_.devices[dev];
    if (r.rpm) {
        std::vector<ObjectId> objs;
        std::vector<bacnet::PropertyRef> props;
        for (const Item& it : r.items) {
            objs.push_back(it.obj);
            props.push_back({it.property, it.arrayIndex});
        }
        reply = call(dev, bacnet::kServiceReadPropertyMultiple,
                     bacnet::encodeReadPropertyMultiple(objectRefsOf(objs, props)), dc.retries);
        if (reply.code != Reply::Code::Ack) return false;
        return bacnet::decodeReadPropertyMultipleAck(reply.data.data(), reply.data.size(), results);
    }
    const Item& it = r.items.front();
    reply = call(dev, bacnet::kServiceReadProperty,
                 bacnet::encodeReadProperty(it.obj, it.property, it.arrayIndex), dc.retries);
    if (reply.code != Reply::Code::Ack) return false;
    PropertyResult p;
    if (!bacnet::decodeReadPropertyAck(reply.data.data(), reply.data.size(), p)) return false;
    results.push_back(std::move(p));
    return true;
}

void BacnetDriver::runRead(const Scheduler::Job& job) {
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
    size_t extraCompletes = 0;
    const std::vector<size_t> tags = r.tags();
    if (!resolved_[dev]) {  // the host did not resolve when the port opened: try again
        auto resolve = env_.resolve ? env_.resolve : bacnet::resolveIpv4;
        resolved_[dev] = resolve(cfg_.devices[dev].host, targets_[dev].ip);
    }
    if (!resolved_[dev]) {
        deviceTimedOut(dev);
    } else {
        std::vector<PropertyResult> results;
        Reply reply;
        const bool decoded = readRequest(dev, r, results, reply);
        switch (reply.code) {
            case Reply::Code::Ack:
                deviceAnswered(dev);
                setDeviceState(dev, DeviceState::Active);
                if (decoded) {
                    publishResults(dev, r, results);
                } else {
                    diag_.onBadFrame(dev, BadFrameKind::Length);
                    publishBad(tags, "BAD_FRAME");
                }
                break;
            case Reply::Code::Error:
            case Reply::Code::Reject:
            case Reply::Code::Abort:
            case Reply::Code::Segmented: {
                deviceAnswered(dev);
                countException(dev, reply);
                const bool rpmMissing =
                    r.rpm && ((reply.code == Reply::Code::Reject &&
                               reply.reason == bacnet::kRejectUnrecognizedService) ||
                              (reply.code == Reply::Code::Error && reply.errorClass == 5));
                if (rpmMissing) {
                    // the device has no ReadPropertyMultiple: one ReadProperty per property from
                    // now on (the Tags are read from the next round)
                    rpmOff_[dev] = true;
                    std::lock_guard<std::mutex> g(schedMu_);
                    buildDevicePlan(dev);
                    for (int grp = 0; grp < 3; ++grp) {
                        const size_t n = rounds_[dev][static_cast<size_t>(grp)].requests.size();
                        if (n) sched_.setBlocks(static_cast<uint32_t>(dev), grp, n);
                    }
                    break;
                }
                const bool splits = reply.code == Reply::Code::Segmented ||
                                    (reply.code == Reply::Code::Error &&
                                     (reply.errorCode == bacnet::kErrUnknownObject ||
                                      reply.errorCode == bacnet::kErrUnknownProperty));
                if (splits) {
                    std::lock_guard<std::mutex> g(schedMu_);
                    if (splitRequestAt(dev, group, job.block)) {
                        extraCompletes = 1;  // the parts are read from the next round
                        break;
                    }
                }
                publishBad(tags, replyReason(reply));
                break;
            }
            case Reply::Code::Timeout:
                deviceTimedOut(dev);
                break;
            case Reply::Code::Closed:
                failOpen("DISCONNECTED");
                break;
            case Reply::Code::Interrupted:
                return;
        }
    }
    std::lock_guard<std::mutex> g(schedMu_);
    sched_.complete(job, mono());
    for (size_t k = 0; k < extraCompletes; ++k) sched_.complete(job, mono());
    if (job.kind == Scheduler::Kind::Probe && deviceSuspended(dev))
        sched_.setNextProbe(static_cast<uint32_t>(dev), probeAt_[dev]);
}

// ---- Writes -------------------------------------------------------------------------------------

bool BacnetDriver::enqueueWrite(WriteCommand cmd) {
    if (!started_ || stopping_ || !cfg_.enabled) return false;
    const auto it = localOf_.find(cmd.tag);
    if (it == localOf_.end()) return false;
    const BacnetTagBinding& t = cfg_.tags[it->second];
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

std::vector<uint64_t> BacnetDriver::cancelQueuedWrites() {
    std::vector<uint64_t> ids;
    std::lock_guard<std::mutex> g(wmu_);
    for (const auto& w : writes_) ids.push_back(w.cmd.id);
    writes_.clear();
    return ids;
}

void BacnetDriver::finishWrite(size_t local, WriteResult&& r) {
    const size_t dev = cfg_.tags[local].device;
    WriteOutcome o = WriteOutcome::Failed;
    if (r.status == WriteStatus::Confirmed || r.status == WriteStatus::NoReadback)
        o = WriteOutcome::Confirmed;
    else if (r.status == WriteStatus::Timeout)
        o = WriteOutcome::Timeout;
    diag_.onWrite(dev, o);
    if (!stopping_ && sink_) sink_->writeDone(std::move(r));
}

void BacnetDriver::failQueuedWrites(const char* code) {
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

// The value a write puts in present-value (NULL for relinquish). false: it cannot be written.
bool encodeWrite(const BacnetTagBinding& t, const TagScalar& raw, Value& out) {
    if (t.addr.relinquish) {
        out = Value::null();
        return true;
    }
    if (t.addr.property != bacnet::kPropPresentValue || !bacnet::isCommandable(t.addr.objectType))
        return false;
    if (bacnet::isAnalog(t.addr.objectType)) {
        double d = 0;
        if (!asDouble(raw, d) || std::fabs(d) > 3.4e38) return false;
        out = Value::real(static_cast<float>(d));
        return true;
    }
    if (bacnet::isBinary(t.addr.objectType)) {
        bool b = false;
        if (!asBool(raw, b)) return false;
        out = Value::enumerated(b ? 1 : 0);
        return true;
    }
    uint64_t u = 0;
    if (!asUnsigned(raw, u) || u > 4294967295ULL) return false;
    out = Value::unsignedInt(u);
    return true;
}

}  // namespace

void BacnetDriver::runWrite() {
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
    const BacnetTagBinding& t = cfg_.tags[local];
    const size_t dev = t.device;
    const BacnetDeviceConfig& dc = cfg_.devices[dev];
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
    if (!resolved_[dev]) return fail("NOT_SENT_DISCONNECTED");
    Value value;
    if (!encodeWrite(t, w.cmd.raw, value)) return fail("NOT_SENT_UNSUPPORTED");
    const int priority = t.addr.priority > 0 ? t.addr.priority : dc.writePriority;
    const ObjectId obj{t.addr.objectType, t.addr.instance};
    auto exceptionOf = [](const Reply& r) {
        if (r.code == Reply::Code::Error) return static_cast<int>(r.errorCode);
        if (r.code == Reply::Code::Reject) return 1000 + r.reason;
        return 2000 + r.reason;
    };

    // sent once, never again
    const Reply wr =
        call(dev, bacnet::kServiceWriteProperty,
             bacnet::encodeWriteProperty(obj, bacnet::kPropPresentValue, value,
                                         priority >= 1 && priority <= 16 ? priority : 0),
             0);
    switch (wr.code) {
        case Reply::Code::Interrupted:
            return;
        case Reply::Code::Ack:
            deviceAnswered(dev);
            break;
        case Reply::Code::Timeout:
        case Reply::Code::Closed:
            res.status = WriteStatus::Timeout;
            res.code = "WRITE_TIMEOUT";
            finishWrite(local, std::move(res));
            if (wr.code == Reply::Code::Timeout)
                deviceTimedOut(dev);
            else
                failOpen("DISCONNECTED");
            complete();
            return;
        default:
            deviceAnswered(dev);
            countException(dev, wr);
            res.status = WriteStatus::Failed;
            res.code = "DEVICE_EXCEPTION";
            res.exception = exceptionOf(wr);
            finishWrite(local, std::move(res));
            complete();
            return;
    }
    if (!w.cmd.readback) {
        res.status = WriteStatus::NoReadback;
        res.code = "NO_READBACK";
        finishWrite(local, std::move(res));
        complete();
        return;
    }
    // the readback: present-value, or priority-array[p] of a relinquish
    uint32_t prop = 0;
    int64_t index = -1;
    itemOf(t, prop, index);
    const Reply rb =
        call(dev, bacnet::kServiceReadProperty, bacnet::encodeReadProperty(obj, prop, index), 0);
    if (rb.code == Reply::Code::Interrupted) return;
    PropertyResult back;
    if (rb.code == Reply::Code::Timeout || rb.code == Reply::Code::Closed) {
        res.status = WriteStatus::Timeout;
        res.code = "READBACK_TIMEOUT";
        finishWrite(local, std::move(res));
        if (rb.code == Reply::Code::Timeout)
            deviceTimedOut(dev);
        else
            failOpen("DISCONNECTED");
        complete();
        return;
    }
    if (rb.code != Reply::Code::Ack ||
        !bacnet::decodeReadPropertyAck(rb.data.data(), rb.data.size(), back)) {
        res.status = WriteStatus::Failed;
        res.code = "READBACK_ERROR";
        if (rb.code != Reply::Code::Ack) res.exception = exceptionOf(rb);
        finishWrite(local, std::move(res));
        complete();
        return;
    }
    TagScalar got, expected;
    std::string why;
    const bool gotOk = decodeTag(t, back.values, got, why);
    bool expOk = true;
    if (t.addr.relinquish)
        expected = true;
    else
        expOk = decodeTag(t, {value}, expected, why);
    if (gotOk) {
        TagUpdate u;
        u.tag = t.tag;
        u.value = got;
        u.quality = Quality::GOOD;
        u.sourceTs = wall();
        u.afterWrite = true;
        lastBad_[local].clear();
        std::vector<TagUpdate> ups;
        ups.push_back(std::move(u));
        if (sink_) sink_->publish(std::move(ups));
        res.readback = got;
    }
    const bool match = gotOk && expOk && got == expected;
    res.status = match ? WriteStatus::Confirmed : WriteStatus::Failed;
    res.code = match ? "CONFIRMED" : "READBACK_MISMATCH";
    finishWrite(local, std::move(res));
    complete();
}

// ---- The thread ---------------------------------------------------------------------------------

void BacnetDriver::start(EngineSink& sink) {
    if (started_) return;
    sink_ = &sink;
    started_ = true;
    stopping_ = false;
    if (!cfg_.enabled) {
        setChannelState(ChannelState::Disabled);
        publishBadAll("DISABLED");
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
    port_ = env_.makePort ? env_.makePort() : std::make_unique<bacnet::UdpPort>();
    port_->clearInterrupt();
    setChannelState(ChannelState::Connecting);
    buildPlan();
    if (env_.manual) return;
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setstacksize(&attr, 256 * 1024);  // ADR-014: one small stack per channel
    if (pthread_create(&thread_, &attr, &BacnetDriver::threadMain, this) == 0)
        threadRunning_ = true;
    pthread_attr_destroy(&attr);
    if (!threadRunning_) {
        std::fprintf(stderr, "bacnet %s: cannot start the channel thread\n",
                     cfg_.channelId.c_str());
        setChannelState(ChannelState::Error);
    }
}

void* BacnetDriver::threadMain(void* self) {
    mat::setThreadName("mat-bacnet");
    BacnetDriver* d = static_cast<BacnetDriver*>(self);
    try {
        d->loop(std::numeric_limits<int64_t>::max());
    } catch (const std::exception& e) {
        std::fprintf(stderr, "bacnet %s: %s\n", d->cfg_.channelId.c_str(), e.what());
        d->setChannelState(ChannelState::Error);
    }
    return nullptr;
}

void BacnetDriver::stop() { halt(); }

void BacnetDriver::halt() {
    if (!started_) return;
    stopping_ = true;
    if (port_) port_->interrupt();
    {
        std::lock_guard<std::mutex> l(mu_);
        wake_ = true;
    }
    cv_.notify_all();
    if (threadRunning_) {
        pthread_join(thread_, nullptr);
        threadRunning_ = false;
    }
    if (port_) port_->close();
    started_ = false;
}

void BacnetDriver::pump(int64_t untilMs) {
    if (!started_ || !cfg_.enabled || stopping_) return;
    loop(untilMs);
}

void BacnetDriver::idle(int64_t untilMs) {
    if (env_.sleep) {
        env_.sleep(untilMs);
        return;
    }
    const int64_t delay = std::max<int64_t>(0, untilMs - mono());
    std::unique_lock<std::mutex> l(mu_);
    cv_.wait_for(l, std::chrono::milliseconds(delay), [this] { return wake_ || stopping_.load(); });
    wake_ = false;
}

void BacnetDriver::loop(int64_t untilMs) {
    while (!stopping_) {
        const int64_t now = mono();
        if (now >= untilMs) break;
        if (!open_) {
            if (channelState_.load() == static_cast<int>(ChannelState::Error))
                failQueuedWrites("NOT_SENT_DISCONNECTED");
            if (now < nextOpenMs_) {
                idle(std::min(nextOpenMs_, untilMs));
                continue;
            }
            openNow();
            continue;
        }
        if (bbmdIp_ && now >= nextRegisterMs_) registerForeign();
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
            int64_t until =
                wait >= 0 ? std::min(wait, untilMs) : std::min(untilMs, now + kIdleCapMs);
            if (bbmdIp_) until = std::min(until, nextRegisterMs_);
            idle(until);
            continue;
        }
        if (job->kind == Scheduler::Kind::Write)
            runWrite();
        else
            runRead(*job);
    }
}

// ---- Connection test ----------------------------------------------------------------------------

TestOutcome BacnetDriver::test(const TestRequest& req) {
    BacnetProbeRequest p;
    p.bindAddress = cfg_.bindAddress;
    if (!cfg_.devices.empty()) {
        const BacnetDeviceConfig& d = cfg_.devices[0];
        p.host = req.host.empty() ? d.host : req.host;
        p.port = d.port;
        p.network = d.network;
        p.mac = d.mac;
        p.deviceInstance = d.deviceInstance;
        p.timeoutMs = d.timeoutMs;
    } else {
        p.host = req.host;
    }
    if (req.read) {
        bacnet::AddressOptions o;
        o.rawType = TagType::STRING;
        p.addr = bacnet::parseAddress(req.address, o);
        if (!p.addr.ok) {
            o.rawType = TagType::FLOAT64;
            p.addr = bacnet::parseAddress(req.address, o);
        }
        if (!p.addr.ok) {
            TestOutcome out;
            out.code = "BAD_REQUEST";
            return out;
        }
        p.hasAddress = true;
    }
    std::unique_ptr<bacnet::DatagramPort> port =
        env_.makePort ? env_.makePort() : std::make_unique<bacnet::UdpPort>();
    return probeBacnet(p, *port, *clock_, env_.resolve ? env_.resolve : bacnet::resolveIpv4).base;
}

// ---- probeBacnet --------------------------------------------------------------------------------

namespace {

std::string valueText(const Value& v, std::string& kind) {
    char buf[64];
    switch (v.tag) {
        case bacnet::kTagNull:
            kind = "null";
            return "null";
        case bacnet::kTagBoolean:
            kind = "boolean";
            return v.b ? "true" : "false";
        case bacnet::kTagUnsigned:
            kind = "unsigned";
            return std::to_string(v.u);
        case bacnet::kTagEnumerated:
            kind = "enumerated";
            return std::to_string(v.u);
        case bacnet::kTagSigned:
            kind = "signed";
            return std::to_string(v.i);
        case bacnet::kTagReal:
            kind = "real";
            std::snprintf(buf, sizeof buf, "%.7g", v.d);
            return buf;
        case bacnet::kTagDouble:
            kind = "double";
            std::snprintf(buf, sizeof buf, "%.15g", v.d);
            return buf;
        case bacnet::kTagCharString:
            kind = "string";
            return v.s;
        case bacnet::kTagOctetString:
            kind = "octets";
            return bacnet::hexOf(Bytes(v.s.begin(), v.s.end()));
        case bacnet::kTagBitString: {
            kind = "bits";
            std::string s;
            for (int i = 0; i < v.bitCount && i < 32; ++i)
                s.push_back((v.bits >> i) & 1u ? '1' : '0');
            return s;
        }
        case bacnet::kTagObjectId: {
            kind = "object";
            const char* t = bacnet::typeName(v.obj.type);
            return (*t ? std::string(t) : std::to_string(v.obj.type)) + ":" +
                   std::to_string(v.obj.instance);
        }
        default:
            kind = "other";
            std::snprintf(buf, sizeof buf, "0x%08x", v.raw);
            return buf;
    }
}

void fromReply(const Reply& r, BacnetProbeOutcome& out) {
    out.base.requestFrame = r.request;
    out.base.responseFrame = r.response;
    out.base.responseMs = r.responseMs;
    switch (r.code) {
        case Reply::Code::Ack:
            out.base.code = "OK";
            return;
        case Reply::Code::Error:
            out.base.code = "BACNET_ERROR";
            out.errorClass = r.errorClass;
            out.errorCode = r.errorCode;
            return;
        case Reply::Code::Reject:
            out.base.code = "BACNET_REJECT";
            out.reason = r.reason;
            return;
        case Reply::Code::Abort:
            out.base.code = "BACNET_ABORT";
            out.reason = r.reason;
            return;
        case Reply::Code::Segmented:
            out.base.code = "BACNET_SEGMENTATION";
            out.reason = r.reason;
            return;
        case Reply::Code::Timeout:
            out.base.code = "TIMEOUT";
            return;
        case Reply::Code::Interrupted:
            out.base.code = "INTERRUPTED";
            return;
        default:
            out.base.code = "UNREACHABLE";
            return;
    }
}

}  // namespace

BacnetProbeOutcome probeBacnet(const BacnetProbeRequest& req) {
    bacnet::UdpPort port;
    SystemClock clock;
    return probeBacnet(req, port, clock, bacnet::resolveIpv4);
}

BacnetProbeOutcome probeBacnet(const BacnetProbeRequest& req, bacnet::DatagramPort& port,
                               const Clock& clock,
                               const std::function<bool(const std::string&, uint32_t&)>& resolve) {
    BacnetProbeOutcome out;
    const int64_t begin = clock.monoMs();
    auto done = [&]() -> BacnetProbeOutcome {
        out.base.elapsedMs = clock.monoMs() - begin;
        port.close();
        return out;
    };
    const ConnectCode oc = port.open(req.localPort, req.bindAddress);
    out.base.connectMs = clock.monoMs() - begin;
    if (oc != ConnectCode::Ok) {
        out.base.code = connectCodeName(oc);
        return done();
    }
    bacnet::Client client(port, clock);
    client.setFirstInvokeId(static_cast<uint8_t>(randomUniform() * 256.0));

    if (req.action == BacnetProbeRequest::Action::WhoIs) {
        uint32_t bbmd = 0;
        const Bytes whoIs = bacnet::encodeWhoIs(req.low, req.high);
        if (!req.bbmdHost.empty()) {
            if (!resolve(req.bbmdHost, bbmd)) {
                out.base.code = "DNS";
                return done();
            }
            client.send(bbmd, static_cast<uint16_t>(req.bbmdPort),
                        bacnet::buildRegisterForeignDevice(60));
            out.base.requestFrame = bacnet::buildUnconfirmed(bacnet::kServiceWhoIs, whoIs,
                                                             bacnet::kBvlcDistributeBroadcast);
            client.send(bbmd, static_cast<uint16_t>(req.bbmdPort), out.base.requestFrame);
        } else {
            uint32_t bc = 0;
            if (!resolve(req.broadcast, bc)) {
                out.base.code = "DNS";
                return done();
            }
            out.base.requestFrame = bacnet::buildUnconfirmed(bacnet::kServiceWhoIs, whoIs,
                                                             bacnet::kBvlcOriginalBroadcast);
            if (!client.send(bc, static_cast<uint16_t>(req.broadcastPort), out.base.requestFrame)) {
                out.base.code = "UNREACHABLE";
                return done();
            }
        }
        client.onOther = [&](const bacnet::Frame& f, uint32_t ip, uint16_t p) {
            if (!f.hasApdu || f.pduType != bacnet::kUnconfirmedRequest ||
                f.service != bacnet::kServiceIAm)
                return;
            bacnet::IAm i;
            if (!bacnet::decodeIAm(f.data, f.dataLen, i)) return;
            for (const auto& d : out.devices)
                if (d.instance == i.instance) return;
            if (out.devices.size() >= 1000) {
                out.truncated = true;
                return;
            }
            BacnetFoundDevice d;
            d.instance = i.instance;
            const bool forwarded = f.bvlc == bacnet::kBvlcForwardedNpdu;
            d.host = bacnet::ipText(forwarded ? f.originIp : ip);
            d.port = forwarded ? f.originPort : p;
            d.network = f.srcNetwork;
            d.mac = f.srcMac;
            d.maxApdu = i.maxApdu;
            d.segmentation = i.segmentation;
            d.vendorId = i.vendorId;
            out.devices.push_back(std::move(d));
        };
        client.drain(clock.monoMs() + std::max(500, std::min(req.waitMs, 10000)));
        std::sort(out.devices.begin(), out.devices.end(),
                  [](const BacnetFoundDevice& a, const BacnetFoundDevice& b) {
                      return a.instance < b.instance;
                  });
        out.base.code = "OK";
        return done();
    }

    bacnet::Target target;
    if (!resolve(req.host, target.ip)) {
        out.base.code = "DNS";
        return done();
    }
    target.port = static_cast<uint16_t>(req.port);
    target.route.network = req.network;
    target.route.mac = req.mac;
    const ObjectId device{bacnet::kDevice, req.deviceInstance};

    if (req.action == BacnetProbeRequest::Action::Read) {
        ObjectId obj = device;
        uint32_t prop = bacnet::kPropObjectName;
        int64_t index = -1;
        if (req.hasAddress) {
            obj = {req.addr.objectType, req.addr.instance};
            prop = req.addr.relinquish ? bacnet::kPropPriorityArray : req.addr.property;
            if (req.addr.relinquish) index = req.addr.priority;
        }
        const Reply r =
            client.request(target, bacnet::kServiceReadProperty,
                           bacnet::encodeReadProperty(obj, prop, index), req.timeoutMs, 1);
        fromReply(r, out);
        if (r.code == Reply::Code::Ack) {
            PropertyResult p;
            if (!bacnet::decodeReadPropertyAck(r.data.data(), r.data.size(), p) ||
                p.values.empty()) {
                out.base.code = "BAD_FRAME";
            } else {
                out.valueText = valueText(p.values[0], out.valueKind);
            }
        }
        return done();
    }

    // Objects: the whole object-list, or element by element when it does not fit one answer
    Reply r = client.request(target, bacnet::kServiceReadProperty,
                             bacnet::encodeReadProperty(device, bacnet::kPropObjectList),
                             req.timeoutMs, 1);
    PropertyResult p;
    if (r.code == Reply::Code::Ack &&
        bacnet::decodeReadPropertyAck(r.data.data(), r.data.size(), p)) {
        for (const Value& v : p.values) {
            if (v.tag != bacnet::kTagObjectId) continue;
            if (out.objects.size() >= req.maxObjects) {
                out.truncated = true;
                break;
            }
            out.objects.push_back(v.obj);
        }
        fromReply(r, out);
    } else if (r.code == Reply::Code::Segmented || r.code == Reply::Code::Abort) {
        r = client.request(target, bacnet::kServiceReadProperty,
                           bacnet::encodeReadProperty(device, bacnet::kPropObjectList, 0),
                           req.timeoutMs, 1);
        fromReply(r, out);
        if (r.code != Reply::Code::Ack ||
            !bacnet::decodeReadPropertyAck(r.data.data(), r.data.size(), p) || p.values.empty() ||
            p.values[0].tag != bacnet::kTagUnsigned)
            return done();
        const uint64_t count = p.values[0].u;
        const uint64_t take = std::min<uint64_t>(count, req.maxObjects);
        out.truncated = count > take;
        for (uint64_t i = 1; i <= take; ++i) {
            if (clock.monoMs() - begin > 25000) {  // the API's time limit
                out.truncated = true;
                break;
            }
            const Reply e =
                client.request(target, bacnet::kServiceReadProperty,
                               bacnet::encodeReadProperty(device, bacnet::kPropObjectList,
                                                          static_cast<int64_t>(i)),
                               req.timeoutMs, 1);
            PropertyResult q;
            if (e.code != Reply::Code::Ack ||
                !bacnet::decodeReadPropertyAck(e.data.data(), e.data.size(), q) ||
                q.values.empty() || q.values[0].tag != bacnet::kTagObjectId) {
                fromReply(e, out);
                out.truncated = true;
                break;
            }
            out.objects.push_back(q.values[0].obj);
        }
        if (!out.objects.empty()) out.base.code = "OK";
    } else {
        fromReply(r, out);
        return done();
    }
    // the names, 16 objects per ReadPropertyMultiple (the first 500); no RPM: no names
    out.objectNames.assign(out.objects.size(), "");
    const size_t named = std::min<size_t>(out.objects.size(), 500);
    for (size_t from = 0; from < named; from += 16) {
        if (clock.monoMs() - begin > 25000) break;
        std::vector<ObjectId> objs;
        std::vector<bacnet::PropertyRef> props;
        for (size_t i = from; i < std::min(named, from + 16); ++i) {
            objs.push_back(out.objects[i]);
            props.push_back({bacnet::kPropObjectName, -1});
        }
        const Reply e = client.request(
            target, bacnet::kServiceReadPropertyMultiple,
            bacnet::encodeReadPropertyMultiple(objectRefsOf(objs, props)), req.timeoutMs, 0);
        std::vector<PropertyResult> rs;
        if (e.code != Reply::Code::Ack ||
            !bacnet::decodeReadPropertyMultipleAck(e.data.data(), e.data.size(), rs))
            break;
        for (const PropertyResult& x : rs) {
            if (!x.ok || x.values.empty() || x.values[0].tag != bacnet::kTagCharString) continue;
            for (size_t i = from; i < std::min(named, from + 16); ++i)
                if (out.objects[i] == x.obj) out.objectNames[i] = x.values[0].s;
        }
    }
    return done();
}

}  // namespace mat::drv
