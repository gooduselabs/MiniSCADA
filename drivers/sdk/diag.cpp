#include "drivers/sdk/diag.hpp"

#include <algorithm>

namespace mat::drv {

DiagCounters::DiagCounters(std::string channelId, std::vector<std::string> devices) {
    channel_.id = std::move(channelId);
    channel_.state = "disabled";
    for (auto& id : devices) {
        Dev d;
        d.d.id = std::move(id);
        d.d.state = "active";
        for (int i = 0; i < 60; ++i) d.bucketSec[i] = -1;
        devs_.push_back(std::move(d));
    }
}

void DiagCounters::setChannelState(const std::string& state) {
    std::lock_guard<std::mutex> g(mu_);
    channel_.state = state;
}

void DiagCounters::setLastError(const std::string& code, int64_t atMs) {
    std::lock_guard<std::mutex> g(mu_);
    channel_.lastErrorCode = code;
    channel_.lastErrorAt = atMs;
}

void DiagCounters::onReconnect() {
    std::lock_guard<std::mutex> g(mu_);
    ++channel_.reconnects;
}

void DiagCounters::addWarning(const std::string& code) {
    std::lock_guard<std::mutex> g(mu_);
    if (std::find(channel_.warnings.begin(), channel_.warnings.end(), code) ==
        channel_.warnings.end())
        channel_.warnings.push_back(code);
}

void DiagCounters::setDeviceState(size_t device, const std::string& state) {
    std::lock_guard<std::mutex> g(mu_);
    if (device < devs_.size()) devs_[device].d.state = state;
}

void DiagCounters::onRequestOk(size_t device, int64_t responseMs, int64_t nowMs) {
    std::lock_guard<std::mutex> g(mu_);
    if (device >= devs_.size()) return;
    Dev& v = devs_[device];
    ++v.d.requestsOk;
    if (!v.haveAvg) {
        v.d.responseAvgMs = static_cast<double>(responseMs);
        v.haveAvg = true;
    } else {
        v.d.responseAvgMs = v.d.responseAvgMs * 0.8 + static_cast<double>(responseMs) * 0.2;
    }
    const int64_t sec = nowMs / 1000;
    const size_t slot = static_cast<size_t>(sec % 60);
    if (v.bucketSec[slot] != sec) {
        v.bucketSec[slot] = sec;
        v.bucketMax[slot] = responseMs;
    } else {
        v.bucketMax[slot] = std::max(v.bucketMax[slot], responseMs);
    }
}

void DiagCounters::onTimeout(size_t device) {
    std::lock_guard<std::mutex> g(mu_);
    if (device < devs_.size()) ++devs_[device].d.timeouts;
}

void DiagCounters::onException(size_t device, int code) {
    std::lock_guard<std::mutex> g(mu_);
    if (device < devs_.size()) ++devs_[device].d.exceptions[code];
}

void DiagCounters::onBadFrame(size_t device, BadFrameKind kind) {
    std::lock_guard<std::mutex> g(mu_);
    if (device >= devs_.size()) return;
    BadFrameCounts& b = devs_[device].d.badFrames;
    switch (kind) {
        case BadFrameKind::Crc:
            ++b.crc;
            break;
        case BadFrameKind::Format:
            ++b.format;
            break;
        case BadFrameKind::Tid:
            ++b.tid;
            break;
        case BadFrameKind::Unit:
            ++b.unit;
            break;
        case BadFrameKind::Length:
            ++b.length;
            break;
        case BadFrameKind::Echo:
            ++b.echo;
            break;
    }
}

void DiagCounters::onWrite(size_t device, WriteOutcome outcome) {
    std::lock_guard<std::mutex> g(mu_);
    if (device >= devs_.size()) return;
    WriteCounts& w = devs_[device].d.writes;
    switch (outcome) {
        case WriteOutcome::Confirmed:
            ++w.confirmed;
            break;
        case WriteOutcome::Failed:
            ++w.failed;
            break;
        case WriteOutcome::Timeout:
            ++w.timeout;
            break;
        case WriteOutcome::Rejected:
            ++w.rejected;
            break;
    }
}

DriverDiag DiagCounters::snapshot(int64_t nowMs) const {
    std::lock_guard<std::mutex> g(mu_);
    DriverDiag out;
    out.channel = channel_;
    const int64_t nowSec = nowMs / 1000;
    for (const Dev& v : devs_) {
        DeviceDiag d = v.d;
        int64_t mx = 0;
        for (int i = 0; i < 60; ++i)
            if (v.bucketSec[i] >= 0 && nowSec - v.bucketSec[i] < 60 && nowSec - v.bucketSec[i] >= 0)
                mx = std::max(mx, v.bucketMax[i]);
        d.responseMaxMs = mx;
        out.devices.push_back(std::move(d));
    }
    return out;
}

}  // namespace mat::drv
