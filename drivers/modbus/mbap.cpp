#include "drivers/modbus/mbap.hpp"

namespace mat::modbus {

Bytes encodeAdu(uint16_t transactionId, uint8_t unit, const Bytes& pdu) {
    Bytes b;
    b.reserve(kMbapSize + pdu.size());
    b.push_back(static_cast<uint8_t>(transactionId >> 8));
    b.push_back(static_cast<uint8_t>(transactionId & 0xFF));
    b.push_back(0);
    b.push_back(0);
    const size_t len = pdu.size() + 1;
    b.push_back(static_cast<uint8_t>(len >> 8));
    b.push_back(static_cast<uint8_t>(len & 0xFF));
    b.push_back(unit);
    b.insert(b.end(), pdu.begin(), pdu.end());
    return b;
}

const char* frameIssueName(FrameIssue issue) {
    switch (issue) {
        case FrameIssue::None:
            return "none";
        case FrameIssue::Short:
            return "short";
        case FrameIssue::Tid:
            return "tid";
        case FrameIssue::Protocol:
            return "protocol";
        case FrameIssue::Length:
            return "length";
        case FrameIssue::Unit:
            return "unit";
        case FrameIssue::Function:
            return "function";
        case FrameIssue::ByteCount:
            return "bytecount";
        case FrameIssue::Format:
            return "format";
    }
    return "";
}

drv::BadFrameKind frameIssueCounter(FrameIssue issue) {
    switch (issue) {
        case FrameIssue::Tid:
            return drv::BadFrameKind::Tid;
        case FrameIssue::Unit:
            return drv::BadFrameKind::Unit;
        case FrameIssue::Short:
        case FrameIssue::Length:
            return drv::BadFrameKind::Length;
        default:
            return drv::BadFrameKind::Format;
    }
}

AduCheck checkTcpResponse(uint16_t tid, uint8_t unit, const Bytes& requestPdu, const uint8_t* data,
                          size_t size) {
    AduCheck out;
    if (size < kMbapSize + 1) return out;  // Short
    if (((data[0] << 8) | data[1]) != tid) {
        out.issue = FrameIssue::Tid;
        return out;
    }
    if (data[2] != 0 || data[3] != 0) {
        out.issue = FrameIssue::Protocol;
        return out;
    }
    if (static_cast<size_t>((data[4] << 8) | data[5]) != size - 6) {
        out.issue = FrameIssue::Length;
        return out;
    }
    if (data[6] != unit) {
        out.issue = FrameIssue::Unit;
        return out;
    }
    out.pdu = checkResponsePdu(requestPdu, data + kMbapSize, size - kMbapSize);
    switch (out.pdu.kind) {
        case ResponseKind::Ok:
        case ResponseKind::Exception:
            out.issue = FrameIssue::None;
            break;
        case ResponseKind::Function:
            out.issue = FrameIssue::Function;
            break;
        case ResponseKind::ByteCount:
            out.issue = FrameIssue::ByteCount;
            break;
        case ResponseKind::Format:
            out.issue = FrameIssue::Format;
            break;
    }
    return out;
}

Split splitFrame(const uint8_t* data, size_t size) {
    Split s;
    if (size < 6) return s;
    const size_t len = static_cast<size_t>((data[4] << 8) | data[5]);
    if (len < 2 || len > kMaxAdu - 6) {
        s.status = SplitStatus::Lost;
        return s;
    }
    if (size >= 6 + len) {
        s.status = SplitStatus::Frame;
        s.size = 6 + len;
    }
    return s;
}

}  // namespace mat::modbus
