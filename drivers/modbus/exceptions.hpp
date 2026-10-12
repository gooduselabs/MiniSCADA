// Modbus exception codes (contracts/modbus-driver.md §4): the Vietnamese meaning for the API and
// Studio, and the reason code a Tag gets when a read ends in that exception.
#pragma once
#include <string>

namespace mat::modbus {

// "địa chỉ không hợp lệ" for 2 ...; "mã lạ" for a code the table does not know.
const char* exceptionMeaning(int code);
// "EXCEPTION_01" ... "EXCEPTION_08", "EXCEPTION_0A", "EXCEPTION_0B"; "EXCEPTION_OTHER" for 09,
// 0 and codes above 0B (data-model §6).
std::string exceptionReason(int code);
// Two upper-case hex digits: "02", "0A" (the "code" of the API).
std::string exceptionHex(int code);

}  // namespace mat::modbus
