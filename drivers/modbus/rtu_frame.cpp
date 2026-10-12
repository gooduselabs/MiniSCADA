#include "drivers/modbus/rtu_frame.hpp"

#include <algorithm>
#include <cmath>

namespace mat::modbus {

uint16_t crc16(const uint8_t* data, size_t n) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < n; ++i) {
        crc ^= data[i];
        for (int b = 0; b < 8; ++b)
            crc = (crc & 1) ? static_cast<uint16_t>((crc >> 1) ^ 0xA001)
                            : static_cast<uint16_t>(crc >> 1);
    }
    return crc;
}

Bytes encodeRtu(uint8_t unit, const Bytes& pdu) {
    Bytes b;
    b.reserve(pdu.size() + 3);
    b.push_back(unit);
    b.insert(b.end(), pdu.begin(), pdu.end());
    const uint16_t crc = crc16(b.data(), b.size());
    b.push_back(static_cast<uint8_t>(crc & 0xFF));
    b.push_back(static_cast<uint8_t>(crc >> 8));
    return b;
}

size_t rtuExpectedLength(const uint8_t* head, size_t n) {
    if (n < 2) return kRtuNeedMore;
    const uint8_t fc = head[1];
    if (fc & 0x80) return 5;
    switch (fc) {
        case 1:
        case 2:
        case 3:
        case 4:
            if (n < 3) return kRtuNeedMore;
            // a byte count over 251 cannot fit in a 256-byte frame: no such frame
            if (head[2] > kMaxRtuAdu - 5) return kRtuBadFunction;
            return 5 + static_cast<size_t>(head[2]);
        case 5:
        case 6:
        case 15:
        case 16:
            return 8;
        case 22:
            return 10;
        default:
            return kRtuBadFunction;
    }
}

int rtuCharBits(int dataBits, char parity, int stopBits) {
    return 1 + dataBits + (parity == 'N' ? 0 : 1) + stopBits;
}

double rtuT35Ms(int baud, int charBits) {
    if (baud <= 0) return 1.75;
    return baud <= 19200 ? (3.5 * charBits * 1000.0) / baud : 1.75;
}

int rtuSilenceMs(int baud, int dataBits, char parity, int stopBits, int configuredMs) {
    const int t35 =
        static_cast<int>(std::ceil(rtuT35Ms(baud, rtuCharBits(dataBits, parity, stopBits)) - 1e-9));
    return std::max({t35, configuredMs, 1});
}

const char* rtuIssueName(RtuIssue issue) {
    switch (issue) {
        case RtuIssue::None:
            return "none";
        case RtuIssue::Short:
            return "short";
        case RtuIssue::Extra:
            return "extra";
        case RtuIssue::Crc:
            return "crc";
        case RtuIssue::Unit:
            return "unit";
        case RtuIssue::Function:
            return "function";
        case RtuIssue::ByteCount:
            return "bytecount";
        case RtuIssue::Format:
            return "format";
    }
    return "";
}

drv::BadFrameKind rtuIssueCounter(RtuIssue issue) {
    switch (issue) {
        case RtuIssue::Crc:
            return drv::BadFrameKind::Crc;
        case RtuIssue::Unit:
            return drv::BadFrameKind::Unit;
        case RtuIssue::Short:
        case RtuIssue::Extra:
            return drv::BadFrameKind::Length;
        default:
            return drv::BadFrameKind::Format;
    }
}

RtuCheck checkRtuResponse(uint8_t unit, const Bytes& requestPdu, const uint8_t* data, size_t size) {
    RtuCheck out;
    if (size < 4) return out;  // Short
    const size_t exp = rtuExpectedLength(data, size);
    if (exp == kRtuBadFunction) {
        out.issue = RtuIssue::Format;
        return out;
    }
    if (exp != kRtuNeedMore) {
        if (size < exp) return out;  // Short
        if (size > exp) {
            out.issue = RtuIssue::Extra;
            return out;
        }
    }
    const uint16_t crc = crc16(data, size - 2);
    if (data[size - 2] != (crc & 0xFF) || data[size - 1] != (crc >> 8)) {
        out.issue = RtuIssue::Crc;
        return out;
    }
    if (data[0] != unit) {
        out.issue = RtuIssue::Unit;
        return out;
    }
    out.pdu = checkResponsePdu(requestPdu, data + 1, size - 3);
    switch (out.pdu.kind) {
        case ResponseKind::Ok:
        case ResponseKind::Exception:
            out.issue = RtuIssue::None;
            break;
        case ResponseKind::Function:
            out.issue = RtuIssue::Function;
            break;
        case ResponseKind::ByteCount:
            out.issue = RtuIssue::ByteCount;
            break;
        case ResponseKind::Format:
            out.issue = RtuIssue::Format;
            break;
    }
    return out;
}

RtuReceive rtuReceive(drv::Transport& transport, const drv::Clock& clock, int64_t deadlineMs,
                      int gapMs, int silenceMs, Bytes carry) {
    RtuReceive out;
    Bytes& buf = out.bytes;
    buf = std::move(carry);
    if (!buf.empty()) out.lastByteMs = clock.monoMs();
    uint8_t tmp[512];
    constexpr size_t kDrainCap = 512;
    for (;;) {
        const size_t exp = rtuExpectedLength(buf.data(), buf.size());
        int64_t wait;
        if (buf.empty()) {
            wait = deadlineMs - clock.monoMs();
            if (wait <= 0) {
                out.status = RtuReceive::Status::Timeout;
                return out;
            }
        } else {
            // inside a frame: the gap; a frame that is complete: the silence that closes it
            wait = (exp != kRtuNeedMore && exp != kRtuBadFunction && buf.size() >= exp) ? silenceMs
                                                                                        : gapMs;
        }
        // Bytes beyond what the frame needs are only read to be thrown away.
        if (exp != kRtuNeedMore && exp != kRtuBadFunction && buf.size() > exp &&
            buf.size() >= kDrainCap) {
            out.status = RtuReceive::Status::Extra;
            return out;
        }
        if (buf.size() >= kDrainCap) {
            out.status =
                exp == kRtuBadFunction ? RtuReceive::Status::Format : RtuReceive::Status::Extra;
            return out;
        }
        const drv::ReadResult r = transport.read(tmp, sizeof tmp, static_cast<int>(wait));
        switch (r.code) {
            case drv::ReadCode::Data:
                buf.insert(buf.end(), tmp, tmp + r.n);
                out.lastByteMs = clock.monoMs();
                continue;
            case drv::ReadCode::Timeout:
                break;
            case drv::ReadCode::Closed:
                out.status = RtuReceive::Status::Closed;
                return out;
            case drv::ReadCode::Interrupted:
                out.status = RtuReceive::Status::Interrupted;
                return out;
            case drv::ReadCode::Error:
                out.status = RtuReceive::Status::Error;
                return out;
        }
        // time is up: nothing came within `wait`
        if (buf.empty()) {
            out.status = RtuReceive::Status::Timeout;
            return out;
        }
        if (exp == kRtuBadFunction) {
            out.status = RtuReceive::Status::Format;
        } else if (exp == kRtuNeedMore || buf.size() < exp) {
            out.status = RtuReceive::Status::Short;
        } else if (buf.size() > exp) {
            out.status = RtuReceive::Status::Extra;
        } else {
            out.status = RtuReceive::Status::Frame;
        }
        return out;
    }
}

}  // namespace mat::modbus
