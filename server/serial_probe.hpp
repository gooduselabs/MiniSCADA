// What the runtime does for the serial routes (feature 006 T164, T168; device-api-1.1 §4, §6): the
// connection test of an RTU channel and the list of ports, over the drivers that run. Apart from
// main.cpp so that it can be tested on a pty.
#pragma once
#include <functional>
#include <string>
#include <vector>

#include "drivers/modbus/modbus_tcp_driver.hpp"
#include "nlohmann/json.hpp"

namespace mat {

struct SerialDeviceEnv {
    std::vector<std::string> allowPatterns;  // serialPorts of the configuration
    std::string root;                        // prefix of /sys, /proc, /etc, /run, /dev ("" = real)
    // The RTU channel drivers that run; empty: none.
    std::function<std::vector<drv::ModbusTcpDriver*>()> channels;
};

// The connection test of an RTU channel on `port` (as the project names it). In the order of the
// contract §10:
//   the console or a getty holds the port    -> PORT_CONSOLE   (nothing is opened)
//   not in `serialPorts`                    -> PORT_NOT_ALLOWED
//   a channel holds it, same speed and frame -> the read goes through that channel's queue
//   a channel holds it, another frame        -> PORT_BUSY
//   free                                     -> opened for the test and closed (PORT_BUSY when
//                                               another program holds it, PORT_ERROR when it does
//                                               not open)
drv::TestOutcome probeSerialOnDevice(const SerialDeviceEnv& env, const std::string& port,
                                     const drv::RtuProbeRequest& request);

// GET /api/v1/serial/ports: the list (device-api-1.1 §6). A port a channel holds shows its channel
// and RS485 "enabled" when the channel asked for it and the kernel took it; with `probe`, the
// ports that are allowed and free are asked and named in `probed`.
nlohmann::json serialPortsOnDevice(const SerialDeviceEnv& env, bool probe,
                                   std::vector<std::string>& probed);

}  // namespace mat
