#include "drivers/s7/s7_driver.hpp"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <exception>
#include <limits>

#include "core/common/thread_name.hpp"
#include "drivers/sdk/tcp_socket.hpp"

namespace mat::drv {

namespace {

constexpr int64_t kIdleCapMs = 1000;  // the longest the thread sleeps without a reason to wake
constexpr size_t kMaxPduBytes = 4096;

std::string hex4(uint16_t v) {
    char b[8];
    std::snprintf(b, sizeof b, "%04X", v);
    return b;
}

std::vector<std::string> deviceIds(const S7Config& c) {
    return c.hasDevice ? std::vector<std::string>{c.deviceId} : std::vector<std::string>{};
}

}  // namespace

S7Driver::S7Driver(S7Config config, S7Env env)
    : cfg_(std::move(config)),
      env_(std::move(env)),
      clock_(env_.clock ? env_.clock : &systemClock_),
      diag_(cfg_.channelId, deviceIds(cfg_)),
      backoff_(cfg_.reconnectMaxS, env_.uniform),
      lastBad_(cfg_.tags.size()),
      tooLarge_(cfg_.tags.size(), false) {
    for (size_t i = 0; i < cfg_.tags.size(); ++i) localOf_[cfg_.tags[i].tag] = i;
    const bool on = cfg_.hasDevice && cfg_.deviceEnabled;
    deviceState_ = static_cast<int>(on ? DeviceState::Active : DeviceState::Disabled);
    if (cfg_.hasDevice) diag_.setDeviceState(0, on ? "active" : "disabled");
}

S7Driver::~S7Driver() { halt(); }

void S7Driver::setChannelState(ChannelState s) {
    channelState_ = static_cast<int>(s);
    static const char* const kNames[] = {"disabled", "connecting", "opening", "connected", "error"};
    diag_.setChannelState(kNames[static_cast<int>(s)]);
}

void S7Driver::setDeviceState(DeviceState s) {
    if (!cfg_.hasDevice) return;
    if (deviceState_.exchange(static_cast<int>(s)) == static_cast<int>(s)) return;
    diag_.setDeviceState(0, s == DeviceState::Active
                                ? "active"
                                : s == DeviceState::Suspended
                                      ? "suspended"
                                      : s == DeviceState::Error ? "error" : "disabled");
}

LinkState S7Driver::linkState(uint32_t device) const {
    LinkState s;
    s.channel = static_cast<ChannelState>(channelState_.load());
    s.device = device == 0 ? static_cast<DeviceState>(deviceState_.load()) : DeviceState::Disabled;
    return s;
}

void S7Driver::diagnostics(DriverDiag& out, int64_t /*nowMs*/) const {
    out = diag_.snapshot(clock_->monoMs());
    std::lock_guard<std::mutex> g(schedMu_);
    static const char* const kGroupNames[3] = {"fast", "normal", "slow"};
    if (out.devices.empty()) return;
    out.devices[0].groups.clear();
    for (int g2 = 0; g2 < 3; ++g2) {
        if (rounds_[static_cast<size_t>(g2)].requests.empty()) continue;
        const Scheduler::GroupStats st = sched_.stats(0, g2, clock_->monoMs());
        GroupDiag gd;
        gd.name = kGroupNames[g2];
        gd.periodMs = cfg_.scanMs[static_cast<size_t>(g2)];
        gd.actualAvgMs = st.actualAvgMs;
        gd.actualMaxMs = st.actualMaxMs;
        gd.overruns = st.overruns;
        gd.overloaded = st.overloaded;
        out.devices[0].groups.push_back(gd);
    }
}

TestOutcome S7Driver::test(const TestRequest& /*req*/) {
    TestOutcome out;
    out.code = "NOT_SUPPORTED";
    return out;
}

// ---- Plan ---------------------------------------------------------------------------------------

std::vector<s7::PlanTag> S7Driver::planTags(int group) const {
    std::vector<s7::PlanTag> out;
    for (size_t i = 0; i < cfg_.tags.size(); ++i) {
        const S7TagBinding& t = cfg_.tags[i];
        if (static_cast<int>(t.group) != group || tooLarge_[i]) continue;
        s7::PlanTag p;
        p.key = i;
        p.area = t.addr.area;
        p.db = t.addr.db;
        p.byte = t.addr.byte;
        p.size = t.addr.size;
        out.push_back(p);
    }
    return out;
}

void S7Driver::buildPlan() {
    const int pdu = pdu_.load() > 0 ? pdu_.load() : cfg_.pduSize;
    const int maxLen = s7::maxItemBytes(pdu);
    std::vector<size_t> large;
    for (size_t i = 0; i < cfg_.tags.size(); ++i) {
        tooLarge_[i] = cfg_.tags[i].addr.size > maxLen;
        if (tooLarge_[i]) large.push_back(i);
    }
    {
        std::lock_guard<std::mutex> g(schedMu_);
        sched_ = Scheduler();
        for (int grp = 0; grp < 3; ++grp) {
            Round& r = rounds_[static_cast<size_t>(grp)];
            r = Round();
            if (!cfg_.hasDevice || !cfg_.deviceEnabled) continue;
            r.items = s7::mergeItems(planTags(grp), cfg_.maxGapBytes, maxLen);
            r.requests = s7::packRequests(r.items, pdu);
            if (!r.requests.empty())
                sched_.addRound(0, grp, cfg_.scanMs[static_cast<size_t>(grp)], r.requests.size());
        }
        sched_.setRequestGapMs(cfg_.requestGapMs);
    }
    publishBad(large, "S7_PDU_TOO_SMALL");
}

void S7Driver::repack(int group) {
    Round& r = rounds_[static_cast<size_t>(group)];
    r.requests = s7::packRequests(r.items, pdu_.load());
    sched_.setBlocks(0, group, r.requests.size());
}

// ---- Publishing ---------------------------------------------------------------------------------

void S7Driver::publishBad(const std::vector<size_t>& tags, const std::string& reason) {
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

void S7Driver::publishBadAll(const std::string& reason, const std::vector<size_t>* except) {
    if (!cfg_.deviceEnabled) return;  // DISABLED
    std::vector<size_t> all;
    for (size_t i = 0; i < cfg_.tags.size(); ++i) {
        if (except && std::find(except->begin(), except->end(), i) != except->end()) continue;
        all.push_back(i);
    }
    publishBad(all, reason);
}

bool S7Driver::decodeTag(const S7TagBinding& t, const s7::Item& item, const s7::Bytes& data,
                         TagScalar& out, std::string& reason) const {
    const long off = static_cast<long>(t.addr.byte) - item.byte;
    if (off < 0 || static_cast<size_t>(off) >= data.size()) {
        reason = "BAD_FRAME";
        return false;
    }
    const s7::Decoded d = s7::decodeValue(t.addr.type, t.addr.bit, data.data() + off,
                                          data.size() - static_cast<size_t>(off), t.stringLength);
    if (!d.ok) {
        reason = d.reason;
        return false;
    }
    out = d.value;
    return true;
}

// ---- The connection -----------------------------------------------------------------------------

uint16_t S7Driver::nextRef() { return ++ref_; }

bool S7Driver::connectNow() {
    setChannelState(ChannelState::Connecting);
    const ConnectCode code = transport_->connect(cfg_.host, cfg_.port, cfg_.connectTimeoutMs);
    if (stopping_) return false;
    if (code != ConnectCode::Ok) {
        failConnect(connectCodeName(code),
                    code == ConnectCode::Refused ? "REFUSED" : "DISCONNECTED");
        return false;
    }
    rx_.clear();
    if (!handshake()) {
        transport_->close();
        return false;
    }
    connected_ = true;
    setChannelState(ChannelState::Connected);
    if (everConnected_) diag_.onReconnect();
    everConnected_ = true;
    firstSuccessPending_ = true;
    if (cfg_.deviceEnabled) setDeviceState(DeviceState::Active);
    diag_.setDetails({{"pduSize", std::to_string(pdu_.load())},
                      {"localTsap", hex4(cfg_.localTsap)},
                      {"remoteTsap", hex4(cfg_.remoteTsap)}});
    buildPlan();
    std::lock_guard<std::mutex> g(schedMu_);
    sched_.start(mono());
    return true;
}

// COTP CR/CC and Setup Communication; on failure the channel's error is set.
bool S7Driver::handshake() {
    const s7::Bytes cr = s7::encodeConnect(cfg_.localTsap, cfg_.remoteTsap);
    const int64_t deadline = mono() + cfg_.connectTimeoutMs;
    if (!transport_->writeAll(cr.data(), cr.size(), cfg_.connectTimeoutMs)) {
        if (!stopping_) failConnect("DISCONNECTED", "DISCONNECTED");
        return false;
    }
    // the answer to the CR is a TPKT frame that is not DT
    for (;;) {
        const s7::Split s = s7::splitTpkt(rx_.data(), rx_.size());
        if (s.status == s7::Split::Status::Bad) {
            failConnect("S7_CONNECT_REJECTED", "S7_CONNECT_REJECTED");
            return false;
        }
        if (s.status == s7::Split::Status::Frame) {
            const bool cc = s7::isConnectConfirm(rx_.data(), s.size);
            rx_.erase(rx_.begin(), rx_.begin() + static_cast<long>(s.size));
            if (!cc) {
                failConnect("S7_CONNECT_REJECTED", "S7_CONNECT_REJECTED");
                return false;
            }
            break;
        }
        const int64_t left = deadline - mono();
        if (left <= 0) {
            failConnect("TIMEOUT", "DISCONNECTED");
            return false;
        }
        uint8_t buf[256];
        const ReadResult rr = transport_->read(buf, sizeof buf, static_cast<int>(left));
        if (rr.code == ReadCode::Data) {
            rx_.insert(rx_.end(), buf, buf + rr.n);
        } else if (rr.code == ReadCode::Interrupted) {
            return false;
        } else if (rr.code == ReadCode::Timeout) {
            failConnect("TIMEOUT", "DISCONNECTED");
            return false;
        } else {
            failConnect("S7_CONNECT_REJECTED", "S7_CONNECT_REJECTED");
            return false;
        }
    }
    const uint16_t ref = nextRef();
    const s7::Bytes setup = s7::encodeSetup(ref, cfg_.pduSize);
    if (!transport_->writeAll(setup.data(), setup.size(), cfg_.connectTimeoutMs)) {
        if (!stopping_) failConnect("DISCONNECTED", "DISCONNECTED");
        return false;
    }
    s7::Bytes pdu;
    for (;;) {
        const Outcome o = receivePdu(deadline, pdu);
        if (o == Outcome::Interrupted) return false;
        if (o == Outcome::Timeout) {
            failConnect("TIMEOUT", "DISCONNECTED");
            return false;
        }
        if (o != Outcome::Ok) {
            failConnect("S7_SETUP_FAILED", "S7_SETUP_FAILED");
            return false;
        }
        const s7::SetupReply r = s7::decodeSetup(pdu.data(), pdu.size());
        if (!r.format && r.ref != ref) continue;  // not ours
        if (!r.ok || r.pduSize < s7::kMinPdu) {
            failConnect("S7_SETUP_FAILED", "S7_SETUP_FAILED");
            return false;
        }
        pdu_ = std::min(cfg_.pduSize, r.pduSize);
        return true;
    }
}

void S7Driver::failConnect(const std::string& code, const std::string& reason) {
    connected_ = false;
    diag_.setLastError(code, wall());
    setChannelState(ChannelState::Error);
    publishBadAll(reason, nullptr);
    failQueuedWrites("NOT_SENT_DISCONNECTED");
    nextConnectMs_ = mono() + backoff_.nextDelayMs();
}

void S7Driver::handleIdleClose() {
    // The PLC closed the connection while nothing was being exchanged: open it again at once, one
    // time, before anything is counted as an error (as the Modbus driver).
    transport_->close();
    connected_ = false;
    rx_.clear();
    connectNow();
}

void S7Driver::dropConnection(const char* code, const std::vector<size_t>& failed,
                              const char* reason) {
    transport_->close();
    connected_ = false;
    rx_.clear();
    diag_.setLastError(code, wall());
    setChannelState(ChannelState::Error);
    publishBad(failed, reason);
    publishBadAll("DISCONNECTED", &failed);
    failQueuedWrites("NOT_SENT_DISCONNECTED");
    nextConnectMs_ = mono() + backoff_.nextDelayMs();
}

// ---- One request and its answer -----------------------------------------------------------------

S7Driver::Outcome S7Driver::receivePdu(int64_t deadline, s7::Bytes& pdu) {
    pdu.clear();
    for (;;) {
        const s7::Split s = s7::splitTpkt(rx_.data(), rx_.size());
        if (s.status == s7::Split::Status::Bad) {
            if (cfg_.hasDevice) diag_.onBadFrame(0, BadFrameKind::Length);
            rx_.clear();
            return Outcome::Lost;
        }
        if (s.status == s7::Split::Status::Frame) {
            const s7::DataTpdu dt = s7::dataOf(rx_.data(), s.size);
            if (!dt.ok) {
                if (cfg_.hasDevice) diag_.onBadFrame(0, BadFrameKind::Format);
                rx_.clear();
                return Outcome::Lost;
            }
            pdu.insert(pdu.end(), rx_.begin() + static_cast<long>(dt.offset),
                       rx_.begin() + static_cast<long>(dt.offset + dt.size));
            rx_.erase(rx_.begin(), rx_.begin() + static_cast<long>(s.size));
            if (pdu.size() > kMaxPduBytes) {
                if (cfg_.hasDevice) diag_.onBadFrame(0, BadFrameKind::Length);
                rx_.clear();
                return Outcome::Lost;
            }
            if (!dt.eot) continue;
            if (pdu.size() < 10 || pdu[0] != 0x32) {
                if (cfg_.hasDevice) diag_.onBadFrame(0, BadFrameKind::Format);
                rx_.clear();
                return Outcome::Lost;
            }
            return Outcome::Ok;
        }
        const int64_t left = deadline - mono();
        if (left <= 0) return Outcome::Timeout;
        uint8_t buf[1024];
        const ReadResult rr = transport_->read(buf, sizeof buf, static_cast<int>(left));
        if (rr.code == ReadCode::Data)
            rx_.insert(rx_.end(), buf, buf + rr.n);
        else if (rr.code == ReadCode::Interrupted)
            return Outcome::Interrupted;
        else if (rr.code == ReadCode::Timeout)
            return Outcome::Timeout;
        else
            return Outcome::Closed;
    }
}

S7Driver::Exchange S7Driver::exchange(uint16_t& ref,
                                      const std::function<s7::Bytes(uint16_t)>& frame,
                                      int timeoutMs, int retries) {
    Exchange ex;
    for (int attempt = 0; attempt <= retries; ++attempt) {
        if (stopping_) {
            ex.outcome = Outcome::Interrupted;
            return ex;
        }
        ref = nextRef();
        const s7::Bytes f = frame(ref);
        const int64_t sentAt = mono();
        if (!transport_->writeAll(f.data(), f.size(), timeoutMs)) {
            ex.outcome = stopping_ ? Outcome::Interrupted : Outcome::Closed;
            return ex;
        }
        const int64_t deadline = sentAt + timeoutMs;
        for (;;) {
            const Outcome o = receivePdu(deadline, ex.pdu);
            if (o == Outcome::Ok) {
                const uint16_t got = static_cast<uint16_t>(ex.pdu[4] << 8 | ex.pdu[5]);
                if (got != ref) {  // a late answer of an earlier request
                    diag_.onBadFrame(0, BadFrameKind::Tid);
                    continue;
                }
                if (firstSuccessPending_) {
                    firstSuccessPending_ = false;
                    backoff_.reset();
                }
                diag_.onRequestOk(0, mono() - sentAt, mono());
                ex.outcome = Outcome::Ok;
                return ex;
            }
            if (o != Outcome::Timeout) {
                ex.outcome = o;
                return ex;
            }
            diag_.onTimeout(0);
            break;
        }
    }
    ex.outcome = Outcome::Timeout;
    return ex;
}

void S7Driver::runRead(const Scheduler::Job& job) {
    const int group = job.group;
    s7::ReadRequest req;
    {
        std::lock_guard<std::mutex> g(schedMu_);
        const auto& reqs = rounds_[static_cast<size_t>(group)].requests;
        if (job.block >= reqs.size()) {
            sched_.complete(job, mono());
            return;
        }
        req = reqs[job.block];
    }
    std::vector<s7::Item> items;
    std::vector<int> sizes;
    std::vector<size_t> tags;
    for (const auto& it : req.items) {
        items.push_back(it.item);
        sizes.push_back(it.item.size);
        tags.insert(tags.end(), it.keys.begin(), it.keys.end());
    }
    uint16_t ref = 0;
    const Exchange ex = exchange(
        ref, [&](uint16_t r) { return s7::encodeRead(r, items); }, cfg_.timeoutMs, cfg_.retries);
    switch (ex.outcome) {
        case Outcome::Interrupted:
            return;
        case Outcome::Timeout:
            dropConnection("TIMEOUT", tags, "TIMEOUT");
            break;
        case Outcome::Closed:
            dropConnection("DISCONNECTED", tags, "DISCONNECTED");
            break;
        case Outcome::Lost:
            dropConnection("BAD_FRAME", tags, "BAD_FRAME");
            break;
        case Outcome::Ok: {
            const s7::ReadReply r = s7::decodeRead(ex.pdu.data(), ex.pdu.size(), sizes);
            if (r.format) {
                diag_.onBadFrame(0, BadFrameKind::Format);
                dropConnection("BAD_FRAME", tags, "BAD_FRAME");
                break;
            }
            if (!r.ok) {
                diag_.onException(0, r.error);
                diag_.setLastError(s7::headerReason(r.error), wall(), cfg_.deviceId);
                publishBad(tags, s7::headerReason(r.error));
                break;
            }
            std::vector<TagUpdate> ups;
            const int64_t w = wall();
            for (size_t k = 0; k < req.items.size(); ++k) {
                const s7::ReadItem& it = req.items[k];
                const int rc = r.items[k].rc;
                if (rc != 0xFF) {
                    diag_.onException(0, rc);
                    diag_.setLastError(s7::itemReason(rc), wall(), cfg_.deviceId);
                    s7::ReadItem a, b;
                    if ((rc == 0x05 || rc == 0x0A) && s7::splitItem(it, planTags(group), a, b)) {
                        std::lock_guard<std::mutex> g(schedMu_);
                        auto& list = rounds_[static_cast<size_t>(group)].items;
                        for (size_t i = 0; i < list.size(); ++i) {
                            if (list[i].keys == it.keys) {
                                list[i] = a;
                                list.insert(list.begin() + static_cast<long>(i) + 1, b);
                                break;
                            }
                        }
                        repack(group);
                        continue;  // the halves are read from the next request on
                    }
                    publishBad(it.keys, s7::itemReason(rc));
                    continue;
                }
                for (size_t key : it.keys) {
                    TagUpdate u;
                    u.tag = cfg_.tags[key].tag;
                    u.sourceTs = w;
                    std::string reason;
                    if (decodeTag(cfg_.tags[key], it.item, r.items[k].data, u.value, reason)) {
                        u.quality = Quality::GOOD;
                        lastBad_[key].clear();
                    } else {
                        u.quality = Quality::BAD;
                        u.reason = reason;
                        if (lastBad_[key] == reason) continue;
                        lastBad_[key] = reason;
                    }
                    ups.push_back(std::move(u));
                }
            }
            if (!ups.empty() && sink_) sink_->publish(std::move(ups));
            break;
        }
    }
    std::lock_guard<std::mutex> g(schedMu_);
    sched_.complete(job, mono());
}

// ---- Writes -------------------------------------------------------------------------------------

bool S7Driver::enqueueWrite(WriteCommand cmd) {
    if (!started_ || stopping_ || !cfg_.enabled || !cfg_.hasDevice || !cfg_.deviceEnabled)
        return false;
    if (localOf_.find(cmd.tag) == localOf_.end()) return false;
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

std::vector<uint64_t> S7Driver::cancelQueuedWrites() {
    std::vector<uint64_t> ids;
    std::lock_guard<std::mutex> g(wmu_);
    for (const auto& w : writes_) ids.push_back(w.cmd.id);
    writes_.clear();
    return ids;
}

void S7Driver::finishWrite(size_t /*local*/, WriteResult&& r) {
    WriteOutcome o = WriteOutcome::Failed;
    if (r.status == WriteStatus::Confirmed || r.status == WriteStatus::NoReadback)
        o = WriteOutcome::Confirmed;
    else if (r.status == WriteStatus::Timeout)
        o = WriteOutcome::Timeout;
    if (cfg_.hasDevice) diag_.onWrite(0, o);
    if (!stopping_ && sink_) sink_->writeDone(std::move(r));
}

void S7Driver::failQueuedWrites(const char* code) {
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

void S7Driver::completeWriteJob() {
    std::lock_guard<std::mutex> sg(schedMu_);
    Scheduler::Job j;
    j.kind = Scheduler::Kind::Write;
    sched_.complete(j, mono());
}

void S7Driver::runWrite() {
    QueuedWrite w;
    {
        std::lock_guard<std::mutex> g(wmu_);
        if (writes_.empty()) {
            completeWriteJob();
            return;
        }
        w = std::move(writes_.front());
        writes_.pop_front();
    }
    const size_t local = localOf_.at(w.cmd.tag);
    const S7TagBinding& t = cfg_.tags[local];
    WriteResult res;
    res.id = w.cmd.id;
    auto finish = [&](WriteStatus st, const char* code, int exception = -1) {
        res.status = st;
        res.code = code;
        res.exception = exception;
        finishWrite(local, std::move(res));
        completeWriteJob();
    };
    if (mono() - w.enqueuedMs > w.cmd.deadlineMs)
        return finish(WriteStatus::Failed, "NOT_SENT_DEADLINE");
    if (tooLarge_[local] ||
        s7::writeSize(t.addr.type, t.addr.size) > pdu_.load() - s7::kWriteOverhead)
        return finish(WriteStatus::Failed, "NOT_SENT_UNSUPPORTED");
    s7::Bytes bytes;
    if (!s7::encodeValue(t.addr.type, w.cmd.raw, t.stringLength, bytes))
        return finish(WriteStatus::Failed, "NOT_SENT_UNSUPPORTED");

    s7::Item item;
    item.area = t.addr.area;
    item.db = t.addr.db;
    item.byte = t.addr.byte;
    s7::Bytes data = bytes;
    if (t.addr.type == s7::S7Type::BOOL) {
        item.bit = t.addr.bit;
    } else if (t.addr.type == s7::S7Type::STRING) {
        item.byte += 1;  // the PLC's maximum length byte stays as it is
        data.erase(data.begin());
    }
    item.size = static_cast<int>(data.size());

    auto lose = [&](Outcome o) {
        const char* code =
            o == Outcome::Timeout ? "TIMEOUT" : o == Outcome::Lost ? "BAD_FRAME" : "DISCONNECTED";
        dropConnection(code, {local}, code);
    };
    // sent once, never again
    uint16_t ref = 0;
    const Exchange wx = exchange(
        ref, [&](uint16_t r) { return s7::encodeWrite(r, item, data); }, cfg_.timeoutMs, 0);
    if (wx.outcome == Outcome::Interrupted) return;
    if (wx.outcome != Outcome::Ok) {
        finish(WriteStatus::Timeout, "WRITE_TIMEOUT");
        lose(wx.outcome);
        return;
    }
    const s7::WriteReply wr = s7::decodeWrite(wx.pdu.data(), wx.pdu.size());
    if (wr.format) {
        diag_.onBadFrame(0, BadFrameKind::Format);
        finish(WriteStatus::Timeout, "WRITE_TIMEOUT");
        lose(Outcome::Lost);
        return;
    }
    if (!wr.ok || wr.rc != 0xFF) {
        const int code = wr.ok ? wr.rc : wr.error;
        diag_.onException(0, code);
        return finish(WriteStatus::Failed, "DEVICE_EXCEPTION", code);
    }
    if (!w.cmd.readback) return finish(WriteStatus::NoReadback, "NO_READBACK");

    // the readback: the Tag's own bytes, straight after the answer, before any queued read
    s7::Item rb;
    rb.area = t.addr.area;
    rb.db = t.addr.db;
    rb.byte = t.addr.byte;
    rb.size = t.addr.size;
    const Exchange rx = exchange(
        ref, [&](uint16_t r) { return s7::encodeRead(r, {rb}); }, cfg_.timeoutMs, 0);
    if (rx.outcome == Outcome::Interrupted) return;
    if (rx.outcome != Outcome::Ok) {
        finish(WriteStatus::Timeout, "READBACK_TIMEOUT");
        lose(rx.outcome);
        return;
    }
    const s7::ReadReply rr = s7::decodeRead(rx.pdu.data(), rx.pdu.size(), {rb.size});
    if (rr.format) {
        diag_.onBadFrame(0, BadFrameKind::Format);
        finish(WriteStatus::Timeout, "READBACK_TIMEOUT");
        lose(Outcome::Lost);
        return;
    }
    if (!rr.ok || rr.items[0].rc != 0xFF) {
        const int code = rr.ok ? rr.items[0].rc : rr.error;
        return finish(WriteStatus::Failed, "READBACK_ERROR", code);
    }
    const s7::Bytes& got = rr.items[0].data;
    bool match;
    if (t.addr.type == s7::S7Type::BOOL)
        match = !got.empty() && ((got[0] >> t.addr.bit) & 1) == bytes[0];
    else if (t.addr.type == s7::S7Type::STRING)
        match = got.size() == bytes.size() &&
                std::equal(bytes.begin() + 1, bytes.end(), got.begin() + 1);
    else
        match = got == bytes;
    TagScalar value;
    std::string why;
    if (decodeTag(t, rb, got, value, why)) {
        TagUpdate u;
        u.tag = t.tag;
        u.value = value;
        u.quality = Quality::GOOD;
        u.sourceTs = wall();
        u.afterWrite = true;  // published whatever the deadband (FR-038 of 006)
        lastBad_[local].clear();
        std::vector<TagUpdate> ups;
        ups.push_back(std::move(u));
        if (sink_) sink_->publish(std::move(ups));
        res.readback = value;
    }
    finish(match ? WriteStatus::Confirmed : WriteStatus::Failed,
           match ? "CONFIRMED" : "READBACK_MISMATCH");
}

// ---- The thread ---------------------------------------------------------------------------------

void S7Driver::start(EngineSink& sink) {
    if (started_) return;
    sink_ = &sink;
    started_ = true;
    stopping_ = false;
    if (!cfg_.enabled || !cfg_.hasDevice || !cfg_.deviceEnabled) {
        setChannelState(ChannelState::Disabled);
        std::vector<size_t> all(cfg_.tags.size());
        for (size_t i = 0; i < all.size(); ++i) all[i] = i;
        publishBad(all, "DISABLED");
        return;
    }
    transport_ =
        env_.makeTransport ? env_.makeTransport() : std::unique_ptr<Transport>(new TcpSocket());
    transport_->clearInterrupt();
    ref_ = env_.firstRef ? env_.firstRef() : static_cast<uint16_t>(randomUniform() * 65536.0);
    setChannelState(ChannelState::Connecting);
    if (env_.manual) return;
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setstacksize(&attr, 256 * 1024);  // ADR-014: one small stack per channel
    if (pthread_create(&thread_, &attr, &S7Driver::threadMain, this) == 0) threadRunning_ = true;
    pthread_attr_destroy(&attr);
    if (!threadRunning_) {
        std::fprintf(stderr, "s7 %s: cannot start the channel thread\n", cfg_.channelId.c_str());
        setChannelState(ChannelState::Error);
    }
}

void* S7Driver::threadMain(void* self) {
    mat::setThreadName("mat-s7");
    S7Driver* d = static_cast<S7Driver*>(self);
    try {
        d->loop(std::numeric_limits<int64_t>::max());
    } catch (const std::exception& e) {
        std::fprintf(stderr, "s7 %s: %s\n", d->cfg_.channelId.c_str(), e.what());
        d->setChannelState(ChannelState::Error);
    }
    return nullptr;
}

void S7Driver::stop() { halt(); }

void S7Driver::halt() {
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

void S7Driver::pump(int64_t untilMs) {
    if (!started_ || stopping_ || !transport_) return;
    loop(untilMs);
}

void S7Driver::idle(int64_t untilMs) {
    if (env_.sleep) {
        env_.sleep(untilMs);
        return;
    }
    const int64_t delay = std::max<int64_t>(0, untilMs - mono());
    std::unique_lock<std::mutex> l(mu_);
    cv_.wait_for(l, std::chrono::milliseconds(delay), [this] { return wake_ || stopping_.load(); });
    wake_ = false;
}

void S7Driver::loop(int64_t untilMs) {
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

}  // namespace mat::drv
