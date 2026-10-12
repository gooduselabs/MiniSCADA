// The Modbus TCP drivers of a project (feature 006 T108): one driver per enabled or disabled
// `modbus-tcp` channel of the model, with its field devices and its external Tags resolved as the
// driver wants them (drivers/modbus/modbus_tcp_driver.hpp). The index of a Tag is its index in the
// model, which is its index in the TagStore. Channels of kind `modbus-rtu` get none here (the
// serial driver comes with feature 006's RTU stage).
#pragma once
#include <memory>
#include <vector>

#include "core/tag-engine/tag_model.hpp"
#include "drivers/modbus/modbus_tcp_driver.hpp"

namespace mat {

struct ModbusFactoryOptions {
    int writeQueueCapacity = 16;  // tagWriteQueuePerChannel
};

// The configuration of channel `channel` (an index in model.channels) of kind modbus-tcp.
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
