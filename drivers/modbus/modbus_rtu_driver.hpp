// Modbus RTU driver over RS485 (feature 006 T164; contracts/modbus-driver.md §3, §5, §10; R10,
// R13). It is the channel driver of modbus_tcp_driver.hpp with the serial line set: one thread per
// channel, one port, one request in flight on the bus, a field device suspended after 3 requests
// without a valid answer (probe every 10 s) while the others keep their cycle. The frame, the t3.5
// silence, the echo and the port rules are in rtu_frame.hpp, drivers/sdk/serial_port.hpp and the
// driver's own exchangeRtu(). This class only makes sure a configuration with a serial line is what
// it gets.
#pragma once
#include <stdexcept>

#include "drivers/modbus/modbus_tcp_driver.hpp"

namespace mat::drv {

class ModbusRtuDriver final : public ModbusTcpDriver {
   public:
    // `config.serial` must be set (std::invalid_argument otherwise).
    explicit ModbusRtuDriver(ModbusTcpConfig config, DriverEnv env = {})
        : ModbusTcpDriver(checked(std::move(config)), std::move(env)) {}

   private:
    static ModbusTcpConfig checked(ModbusTcpConfig c) {
        if (!c.serial)
            throw std::invalid_argument("ModbusRtuDriver: the channel has no serial line");
        return c;
    }
};

}  // namespace mat::drv
