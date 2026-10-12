#include "drivers/modbus/exceptions.hpp"

#include <cstdio>

namespace mat::modbus {

const char* exceptionMeaning(int code) {
    switch (code) {
        case 1:
            return "mã hàm không hỗ trợ";
        case 2:
            return "địa chỉ không hợp lệ";
        case 3:
            return "giá trị dữ liệu không hợp lệ";
        case 4:
            return "thiết bị trường lỗi";
        case 5:
            return "đã nhận, đang xử lý";
        case 6:
            return "thiết bị trường bận";
        case 7:
            return "không thực hiện được (NAK)";
        case 8:
            return "lỗi chẵn lẻ bộ nhớ";
        case 9:
            return "mã không xác định";
        case 10:
            return "cổng nối không có đường tới thiết bị";
        case 11:
            return "thiết bị sau cổng nối không trả lời";
    }
    return "mã lạ";
}

std::string exceptionHex(int code) {
    char b[8];
    std::snprintf(b, sizeof b, "%02X", code & 0xFF);
    return b;
}

std::string exceptionReason(int code) {
    if (code >= 1 && code <= 11 && code != 9) return "EXCEPTION_" + exceptionHex(code);
    return "EXCEPTION_OTHER";
}

}  // namespace mat::modbus
