#include "drivers/fins/end_codes.hpp"

#include <cstdio>

namespace mat::fins {

const char* endCodeReason(uint16_t code) {
    const int main = code >> 8;
    if (code == 0x0000) return "";
    if (code == 0x0001) return "FINS_CANCELED";
    switch (main) {
        case 0x01:
        case 0x02:
        case 0x03:
        case 0x05:
            return "FINS_ROUTING";
        case 0x04:
            return "FINS_UNSUPPORTED";
        case 0x10:
            return "FINS_FORMAT";
        case 0x11:
            return "FINS_ADDRESS";
        case 0x20:
            return "FINS_READ_DENIED";
        case 0x21:
            return "FINS_WRITE_DENIED";
        case 0x22:
            return "FINS_MODE";
        case 0x23:
        case 0x24:
        case 0x25:
            return "FINS_UNIT_ERROR";
        case 0x26:
        case 0x30:
        case 0x40:
            return "FINS_ACCESS";
        default:
            return "FINS_OTHER";
    }
}

std::string endCodeHex(uint16_t code) {
    char b[8];
    std::snprintf(b, sizeof b, "%04X", code);
    return b;
}

const char* endCodeMeaning(uint16_t code) {
    switch (code) {
        case 0x0000:
            return "Hoàn tất bình thường";
        case 0x0001:
            return "Dịch vụ bị hủy";
        case 0x0101:
            return "Nút nguồn không nằm trong mạng";
        case 0x0103:
            return "Gửi lại quá số lần ở nút nguồn";
        case 0x0105:
            return "Địa chỉ nút sai (thiết lập nút của bộ Ethernet)";
        case 0x0201:
            return "Nút đích không nằm trong mạng";
        case 0x0202:
            return "Không có unit đích (số unit sai)";
        case 0x0204:
            return "Nút đích đang bận";
        case 0x0205:
            return "Hết thời gian chờ trả lời ở nút đích";
        case 0x0401:
            return "Lệnh không được hỗ trợ";
        case 0x0402:
            return "Model hoặc phiên bản PLC không hỗ trợ lệnh";
        case 0x0501:
            return "Sai địa chỉ đích (bảng định tuyến)";
        case 0x0502:
            return "Chưa có bảng định tuyến";
        case 0x0503:
            return "Bảng định tuyến lỗi";
        case 0x1001:
            return "Lệnh quá dài";
        case 0x1002:
            return "Lệnh quá ngắn";
        case 0x1003:
            return "Số phần tử không khớp dữ liệu";
        case 0x1101:
            return "Không có vùng nhớ này";
        case 0x1103:
            return "Địa chỉ ngoài vùng nhớ của PLC";
        case 0x1104:
            return "Vượt cuối vùng nhớ";
        case 0x110B:
            return "Trả lời quá dài";
        case 0x2101:
            return "Vùng chỉ đọc";
        case 0x2102:
            return "Vùng đang được bảo vệ";
        case 0x2201:
            return "Không thực hiện được khi PLC đang chạy";
        case 0x2202:
            return "Không thực hiện được khi PLC đang chạy";
        case 0x2203:
            return "PLC đang ở chế độ PROGRAM";
        case 0x2301:
            return "Không có thiết bị tệp";
        case 0x2302:
            return "Không có vùng nhớ này trên PLC";
        default:
            break;
    }
    switch (code >> 8) {
        case 0x01:
            return "Lỗi ở nút nguồn";
        case 0x02:
            return "Lỗi ở nút đích";
        case 0x03:
            return "Lỗi bộ điều khiển";
        case 0x04:
            return "Dịch vụ không được hỗ trợ";
        case 0x05:
            return "Lỗi bảng định tuyến";
        case 0x10:
            return "Lỗi định dạng lệnh";
        case 0x11:
            return "Lỗi tham số (vùng, địa chỉ)";
        case 0x20:
            return "Không đọc được";
        case 0x21:
            return "Không ghi được";
        case 0x22:
            return "Không thực hiện được ở chế độ hiện tại của PLC";
        case 0x23:
            return "Không có thiết bị";
        case 0x24:
            return "Không khởi động, dừng được";
        case 0x25:
            return "Lỗi unit";
        case 0x26:
            return "Lỗi lệnh (bảo vệ, mật khẩu, quyền)";
        case 0x30:
            return "Lỗi quyền truy cập";
        case 0x40:
            return "Bị hủy";
        default:
            return "Mã kết thúc lạ";
    }
}

bool endCodeSplits(uint16_t code) { return code == 0x1103 || code == 0x1104 || code == 0x110B; }

bool endCodeUnreachable(uint16_t code) {
    const int main = code >> 8;
    return main == 0x01 || main == 0x02 || main == 0x05;
}

}  // namespace mat::fins
