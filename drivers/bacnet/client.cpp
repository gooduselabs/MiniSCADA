#include "drivers/bacnet/client.hpp"

#include <algorithm>

namespace mat::bacnet {

namespace {
constexpr size_t kLateKept = 16;
constexpr size_t kRxMax = 1600;
}  // namespace

bool Client::send(uint32_t ip, uint16_t port, const Bytes& datagram) {
    return port_.sendTo(ip, port, datagram.data(), datagram.size());
}

void Client::drain(int64_t untilMs, const std::function<bool()>& stop) {
    uint8_t buf[kRxMax];
    while (!stopped() && !(stop && stop())) {
        const int64_t left = untilMs - clock_.monoMs();
        if (left <= 0) return;
        size_t n = 0;
        uint32_t ip = 0;
        uint16_t port = 0;
        const drv::ReadCode rc =
            port_.recvFrom(buf, sizeof buf, static_cast<int>(left), n, ip, port);
        if (rc != drv::ReadCode::Data) {
            if (rc == drv::ReadCode::Timeout) continue;
            return;
        }
        Frame f;
        if (!parseFrame(buf, n, f)) {
            if (onBadFrame) onBadFrame();
            continue;
        }
        if (onOther) onOther(f, ip, port);
    }
}

Reply Client::request(const Target& t, uint8_t service, const Bytes& data, int timeoutMs,
                      int retries) {
    Reply out;
    const int64_t begin = clock_.monoMs();
    uint8_t id = nextInvoke_++;
    for (int guard = 0; guard < 256 && std::find(late_.begin(), late_.end(), id) != late_.end();
         ++guard)
        id = nextInvoke_++;
    out.request = buildConfirmed(id, service, data, t.route, kMaxApdu);
    uint8_t buf[kRxMax];
    for (int attempt = 0; attempt <= retries; ++attempt) {
        if (stopped()) {
            out.code = Reply::Code::Interrupted;
            return out;
        }
        const int64_t sentAt = clock_.monoMs();
        if (!port_.sendTo(t.ip, t.port, out.request.data(), out.request.size())) {
            out.code = stopped() ? Reply::Code::Interrupted : Reply::Code::Closed;
            out.elapsedMs = clock_.monoMs() - begin;
            return out;
        }
        const int64_t deadline = sentAt + timeoutMs;
        for (;;) {
            const int64_t left = deadline - clock_.monoMs();
            if (left <= 0) break;
            size_t n = 0;
            uint32_t ip = 0;
            uint16_t port = 0;
            const drv::ReadCode rc =
                port_.recvFrom(buf, sizeof buf, static_cast<int>(left), n, ip, port);
            if (rc == drv::ReadCode::Timeout) break;
            if (rc == drv::ReadCode::Interrupted) {
                out.code = Reply::Code::Interrupted;
                return out;
            }
            if (rc != drv::ReadCode::Data) {
                out.code = Reply::Code::Closed;
                out.elapsedMs = clock_.monoMs() - begin;
                return out;
            }
            Frame f;
            if (!parseFrame(buf, n, f)) {
                if (onBadFrame) onBadFrame();
                continue;
            }
            const bool answer =
                f.hasApdu && (f.pduType == kSimpleAck || f.pduType == kComplexAck ||
                              f.pduType == kError || f.pduType == kReject || f.pduType == kAbort);
            if (!answer) {
                if (onOther) onOther(f, ip, port);
                continue;
            }
            const bool fromTarget = ip == t.ip && port == t.port &&
                                    (t.route.network == 0 ||
                                     (f.srcNetwork == t.route.network && f.srcMac == t.route.mac));
            const bool serviceMatches =
                f.pduType == kReject || f.pduType == kAbort || f.service == service;
            if (!fromTarget || f.invokeId != id || !serviceMatches) {
                if (onBadFrame) onBadFrame();
                const auto it = std::find(late_.begin(), late_.end(), f.invokeId);
                if (fromTarget && it != late_.end()) late_.erase(it);
                continue;
            }
            out.response.assign(buf, buf + n);
            out.elapsedMs = clock_.monoMs() - begin;
            out.responseMs = clock_.monoMs() - sentAt;
            out.pduType = f.pduType;
            switch (f.pduType) {
                case kSimpleAck:
                    out.code = Reply::Code::Ack;
                    break;
                case kComplexAck:
                    out.code = f.segmented ? Reply::Code::Segmented : Reply::Code::Ack;
                    out.data.assign(f.data, f.data + f.dataLen);
                    break;
                case kError:
                    out.code = Reply::Code::Error;
                    out.errorClass = f.errorClass;
                    out.errorCode = f.errorCode;
                    break;
                case kReject:
                    out.code = Reply::Code::Reject;
                    out.reason = f.service;
                    break;
                default:
                    out.code = Reply::Code::Abort;
                    out.reason = f.service;
                    if (out.reason == kAbortSegmentationNotSupported ||
                        out.reason == kAbortBufferOverflow || out.reason == kAbortApduTooLong)
                        out.code = Reply::Code::Segmented;
                    break;
            }
            return out;
        }
        if (onTimeout) onTimeout();
    }
    late_.push_back(id);
    if (late_.size() > kLateKept) late_.pop_front();
    out.code = Reply::Code::Timeout;
    out.elapsedMs = clock_.monoMs() - begin;
    return out;
}

}  // namespace mat::bacnet
