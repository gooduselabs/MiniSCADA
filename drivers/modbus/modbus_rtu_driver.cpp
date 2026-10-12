#include "drivers/modbus/modbus_rtu_driver.hpp"

// The RTU driver is the Modbus channel driver with a serial line (modbus_tcp_driver.cpp,
// exchangeRtu()); nothing more to define here. The file exists so that the module has the name the
// plan gives it and a place for the RTU-only code that may come (a second line per channel is not
// planned).
namespace mat::drv {}  // namespace mat::drv
