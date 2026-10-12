// "Thử kết nối" (FR-044; contracts/modbus-driver.md §10), TCP part: a new, temporary connection to
// the PLC with the configuration sent by Studio, an optional read of one address, and a result
// code. It never touches the connection of a channel that runs. The RTU part (T164) opens the port
// for the length of the test, with the same rules as the channel driver.
#pragma once
#include <memory>
#include <string>

#include "drivers/modbus/address.hpp"
#include "drivers/sdk/driver.hpp"
#include "drivers/sdk/transport.hpp"

namespace mat::drv {

struct TcpProbeRequest {
    std::string host;
    int port = 502;
    int connectTimeoutMs = 3000;
    int unit = 1;
    int timeoutMs = 1000;
    // Optional read: 1-4 registers (HR, IR) or 1-16 bits (C, DI) at `offset` (already minus the
    // address base).
    bool read = false;
    modbus::Area area = modbus::Area::HR;
    int offset = 0;
    int count = 1;
};

// Codes (§10): OK, REFUSED, TIMEOUT, UNREACHABLE, DNS, EXCEPTION, BAD_FRAME; BAD_REQUEST for a read
// outside 1-4 registers or 1-16 bits (the caller checks that first). The connection is closed
// before this returns, within connect timeout + response timeout + 2 s.
TestOutcome probeModbusTcp(const TcpProbeRequest& request, Transport& transport,
                           const Clock& clock);
// On a TcpSocket and the system clock.
TestOutcome probeModbusTcp(const TcpProbeRequest& request);

struct RtuProbeRequest {
    std::string devicePath;  // /dev/ttyAS2 (the caller has checked the port is allowed and free)
    int baud = 9600;
    int dataBits = 8;
    char parity = 'E';
    int stopBits = 1;
    bool rs485 = true;
    bool dropEcho = false;
    int silenceMs = 0;
    int connectTimeoutMs = 3000;
    int unit = 1;
    int timeoutMs = 1000;
    bool read = false;
    modbus::Area area = modbus::Area::HR;
    int offset = 0;
    int count = 1;
};
// Codes: OK, TIMEOUT, PORT_BUSY, PORT_ERROR, EXCEPTION, BAD_FRAME, BAD_REQUEST. The port is closed
// before this returns.
TestOutcome probeModbusRtu(const RtuProbeRequest& request, Transport& transport,
                           const Clock& clock);
// On a port that is already open (the channel driver's own, through its queue): the read of the
// request only (BAD_REQUEST without one); the port is left open.
TestOutcome probeModbusRtuOnOpen(const RtuProbeRequest& request, Transport& open,
                                 const Clock& clock);
// On a SerialPort and the system clock.
TestOutcome probeModbusRtu(const RtuProbeRequest& request);

}  // namespace mat::drv
