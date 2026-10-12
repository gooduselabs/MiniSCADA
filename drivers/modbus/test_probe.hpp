// "Thử kết nối" (FR-044; contracts/modbus-driver.md §10), TCP part: a new, temporary connection to
// the PLC with the configuration sent by Studio, an optional read of one address, and a result
// code. It never touches the connection of a channel that runs. The RTU part comes with the serial
// driver (T164).
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

}  // namespace mat::drv
