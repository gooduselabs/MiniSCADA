// The Modbus drivers of a project (feature 006 T108, T164): one driver per enabled or disabled
// channel of the model, with its field devices and its external Tags resolved as the driver wants
// them (drivers/modbus/modbus_tcp_driver.hpp). The index of a Tag is its index in the model, which
// is its index in the TagStore. A `modbus-rtu` channel gets a ModbusRtuDriver (the same class with
// the serial line set). The other kinds (S7, FINS, MC, BACnet/IP) have factories of their own.
#pragma once
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "core/tag-engine/tag_model.hpp"
#include "drivers/modbus/modbus_tcp_driver.hpp"

namespace mat {

struct ModbusFactoryOptions {
    int writeQueueCapacity = 16;  // tagWriteQueuePerChannel
    // RTU: "" when a channel may open the port, else PORT_CONSOLE or PORT_NOT_ALLOWED (the
    // runtime's `serialPorts` and the console of the system). Empty: no check.
    std::function<std::string(const std::string& port)> checkPort;
};

// The configuration of channel `channel` (an index in model.channels), modbus-tcp or modbus-rtu.
drv::ModbusTcpConfig modbusTcpConfigOf(const ProjectModel& model, size_t channel,
                                       const ModbusFactoryOptions& options = {});

struct ModbusChannelDriver {
    size_t channel = 0;  // index in model.channels
    std::unique_ptr<drv::ModbusTcpDriver> driver;
};

std::vector<ModbusChannelDriver> makeModbusTcpDrivers(const ProjectModel& model,
                                                      const ModbusFactoryOptions& options = {},
                                                      const drv::DriverEnv& env = {});

}  // namespace mat
