#include "drivers/modbus/test_probe.hpp"

#include <algorithm>

#include "drivers/modbus/codec.hpp"
#include "drivers/modbus/mbap.hpp"
#include "drivers/modbus/pdu.hpp"
#include "drivers/modbus/rtu_frame.hpp"
#include "drivers/sdk/serial_port.hpp"
#include "drivers/sdk/tcp_socket.hpp"

namespace mat::drv {

namespace {

const char* connectCodeToResult(ConnectCode c) {
    switch (c) {
        case ConnectCode::Refused:
            return "REFUSED";
        case ConnectCode::Timeout:
        case ConnectCode::Interrupted:
            return "TIMEOUT";
        case ConnectCode::Dns:
            return "DNS";
        case ConnectCode::PortBusy:
            return "PORT_BUSY";
        case ConnectCode::PortError:
            return "PORT_ERROR";
        case ConnectCode::Unreachable:
        case ConnectCode::Error:
        case ConnectCode::Ok:
            break;
    }
    return "UNREACHABLE";
}

int functionOf(modbus::Area a) {
    switch (a) {
        case modbus::Area::C:
            return 1;
        case modbus::Area::DI:
            return 2;
        case modbus::Area::HR:
            return 3;
        case modbus::Area::IR:
            return 4;
    }
    return 3;
}

bool validRead(const TcpProbeRequest& r) {
    const bool bits = r.area == modbus::Area::C || r.area == modbus::Area::DI;
    return r.count >= 1 && r.count <= (bits ? 16 : 4) && r.offset >= 0 &&
           r.offset + r.count <= 65536;
}

}  // namespace

TestOutcome probeModbusTcp(const TcpProbeRequest& r, Transport& t, const Clock& clock) {
    TestOutcome out;
    if (r.read && !validRead(r)) {
        out.code = "BAD_REQUEST";
        return out;
    }
    const int64_t start = clock.monoMs();
    const ConnectCode cc = t.connect(r.host, r.port, r.connectTimeoutMs);
    out.connectMs = clock.monoMs() - start;
    if (cc != ConnectCode::Ok) {
        out.code = connectCodeToResult(cc);
        out.elapsedMs = clock.monoMs() - start;
        return out;
    }
    if (!r.read) {
        t.close();
        out.code = "OK";
        out.elapsedMs = clock.monoMs() - start;
        return out;
    }

    const int fc = functionOf(r.area);
    out.fc = fc;
    out.offset = r.offset;
    out.count = r.count;
    const modbus::Bytes pdu = modbus::readRequest(fc, r.offset, r.count);
    const uint16_t tid = 1;
    out.requestFrame = modbus::encodeAdu(tid, static_cast<uint8_t>(r.unit), pdu);
    const int64_t sent = clock.monoMs();
    auto finish = [&](const char* code) {
        out.code = code;
        out.responseMs = clock.monoMs() - sent;
        out.elapsedMs = clock.monoMs() - start;
        t.close();
        return out;
    };
    if (!t.writeAll(out.requestFrame.data(), out.requestFrame.size(), r.timeoutMs))
        return finish("BAD_FRAME");

    modbus::Bytes rx;
    const int64_t deadline = sent + r.timeoutMs;
    for (;;) {
        const modbus::Split s = modbus::splitFrame(rx.data(), rx.size());
        if (s.status == modbus::SplitStatus::Lost) {
            out.responseFrame = rx;
            return finish("BAD_FRAME");
        }
        if (s.status == modbus::SplitStatus::Frame) {
            out.responseFrame.assign(rx.begin(), rx.begin() + static_cast<long>(s.size));
            const modbus::AduCheck ck =
                modbus::checkTcpResponse(tid, static_cast<uint8_t>(r.unit), pdu,
                                         out.responseFrame.data(), out.responseFrame.size());
            if (ck.issue != modbus::FrameIssue::None) return finish("BAD_FRAME");
            if (ck.pdu.kind == modbus::ResponseKind::Exception) {
                out.exception = ck.pdu.exception;
                return finish("EXCEPTION");
            }
            const modbus::Bytes resp(
                out.responseFrame.begin() + static_cast<long>(modbus::kMbapSize),
                out.responseFrame.end());
            if (fc <= 2)
                out.bits = modbus::responseBits(resp, static_cast<size_t>(r.count));
            else
                out.registers = modbus::responseRegisters(resp);
            return finish("OK");
        }
        const int64_t left = deadline - clock.monoMs();
        if (left <= 0) {
            out.responseFrame = rx;
            return finish(rx.empty() ? "TIMEOUT" : "BAD_FRAME");
        }
        uint8_t buf[512];
        const ReadResult rr = t.read(buf, sizeof buf, static_cast<int>(left));
        if (rr.code == ReadCode::Data) {
            rx.insert(rx.end(), buf, buf + rr.n);
        } else if (rr.code == ReadCode::Timeout) {
            out.responseFrame = rx;
            return finish(rx.empty() ? "TIMEOUT" : "BAD_FRAME");
        } else if (rr.code == ReadCode::Interrupted) {
            return finish("TIMEOUT");
        } else {  // the PLC closed the connection or it failed, with no answer
            out.responseFrame = rx;
            return finish("BAD_FRAME");
        }
    }
}

namespace {

// The read of a test on a port that is open: quiet line, request, optional echo, response.
TestOutcome rtuReadOn(const RtuProbeRequest& r, Transport& t, const Clock& clock, int64_t start,
                      TestOutcome out, bool closeAfter) {
    const int fc = functionOf(r.area);
    out.fc = fc;
    out.offset = r.offset;
    out.count = r.count;
    const modbus::Bytes pdu = modbus::readRequest(fc, r.offset, r.count);
    out.requestFrame = modbus::encodeRtu(static_cast<uint8_t>(r.unit), pdu);
    const int silence = modbus::rtuSilenceMs(r.baud, r.dataBits, r.parity, r.stopBits, r.silenceMs);
    const int gap = modbus::rtuGapMs(silence);
    auto finish = [&](const char* code, int64_t sent) {
        out.code = code;
        out.responseMs = clock.monoMs() - sent;
        out.elapsedMs = clock.monoMs() - start;
        if (closeAfter) t.close();
        return out;
    };
    // the line must be quiet for t3.5 before the request goes
    waitLineQuiet(t, silence);
    const int64_t sent = clock.monoMs();
    if (!t.writeAll(out.requestFrame.data(), out.requestFrame.size(), r.timeoutMs))
        return finish("BAD_FRAME", sent);
    modbus::Bytes carry;
    if (r.dropEcho) {  // read back what was just sent
        const int64_t until = sent + r.timeoutMs;
        while (carry.size() < out.requestFrame.size()) {
            const int64_t left = until - clock.monoMs();
            if (left <= 0) break;
            uint8_t buf[256];
            const ReadResult rr = t.read(buf, sizeof buf, static_cast<int>(left));
            if (rr.code != ReadCode::Data) break;
            carry.insert(carry.end(), buf, buf + rr.n);
        }
        if (carry.size() < out.requestFrame.size() ||
            !std::equal(out.requestFrame.begin(), out.requestFrame.end(), carry.begin()))
            return finish(carry.empty() ? "TIMEOUT" : "BAD_FRAME", sent);
        carry.erase(carry.begin(), carry.begin() + static_cast<long>(out.requestFrame.size()));
    }
    const modbus::RtuReceive rx =
        modbus::rtuReceive(t, clock, sent + r.timeoutMs, gap, silence, std::move(carry));
    out.responseFrame = rx.bytes;
    switch (rx.status) {
        case modbus::RtuReceive::Status::Timeout:
        case modbus::RtuReceive::Status::Interrupted:
            return finish("TIMEOUT", sent);
        case modbus::RtuReceive::Status::Frame:
            break;
        default:
            return finish("BAD_FRAME", sent);
    }
    const modbus::RtuCheck ck = modbus::checkRtuResponse(static_cast<uint8_t>(r.unit), pdu,
                                                         rx.bytes.data(), rx.bytes.size());
    if (ck.issue != modbus::RtuIssue::None) return finish("BAD_FRAME", sent);
    if (ck.pdu.kind == modbus::ResponseKind::Exception) {
        out.exception = ck.pdu.exception;
        return finish("EXCEPTION", sent);
    }
    const modbus::Bytes resp(rx.bytes.begin() + 1, rx.bytes.end() - 2);
    if (fc <= 2)
        out.bits = modbus::responseBits(resp, static_cast<size_t>(r.count));
    else
        out.registers = modbus::responseRegisters(resp);
    return finish("OK", sent);
}

bool rtuReadValid(const RtuProbeRequest& r) {
    TcpProbeRequest shape;
    shape.read = r.read;
    shape.area = r.area;
    shape.offset = r.offset;
    shape.count = r.count;
    return validRead(shape);
}

}  // namespace

TestOutcome probeModbusRtu(const RtuProbeRequest& r, Transport& t, const Clock& clock) {
    TestOutcome out;
    if (r.read && !rtuReadValid(r)) {
        out.code = "BAD_REQUEST";
        return out;
    }
    const int64_t start = clock.monoMs();
    const ConnectCode cc = t.connect(r.devicePath, 0, r.connectTimeoutMs);
    out.connectMs = clock.monoMs() - start;
    if (cc != ConnectCode::Ok) {
        out.code = connectCodeToResult(cc);
        out.elapsedMs = clock.monoMs() - start;
        return out;
    }
    if (!r.read) {
        t.close();
        out.code = "OK";
        out.elapsedMs = clock.monoMs() - start;
        return out;
    }
    return rtuReadOn(r, t, clock, start, std::move(out), /*closeAfter=*/true);
}

TestOutcome probeModbusRtuOnOpen(const RtuProbeRequest& r, Transport& t, const Clock& clock) {
    TestOutcome out;
    if (!r.read || !rtuReadValid(r)) {
        out.code = "BAD_REQUEST";
        return out;
    }
    return rtuReadOn(r, t, clock, clock.monoMs(), std::move(out), /*closeAfter=*/false);
}

TestOutcome probeModbusRtu(const RtuProbeRequest& request) {
    SerialParams p;
    p.baud = request.baud;
    p.dataBits = request.dataBits;
    p.parity = request.parity;
    p.stopBits = request.stopBits;
    p.rs485 = request.rs485;
    SerialPort port(p);
    SystemClock clock;
    return probeModbusRtu(request, port, clock);
}

TestOutcome probeModbusTcp(const TcpProbeRequest& request) {
    TcpSocket socket;
    SystemClock clock;
    return probeModbusTcp(request, socket, clock);
}

}  // namespace mat::drv
