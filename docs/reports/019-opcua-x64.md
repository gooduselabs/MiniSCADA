# Báo cáo đo driver OPC UA client (feature 019), x64 và armhf (qemu)

Ngày đo: 2026-10-24. Máy dev Windows 11 + Docker Desktop, ảnh `mat-armhf` (Ubuntu 20.04, GCC 9.4). Server: `mat-opcua-sim` (open62541 1.4.21). **Chưa thử server thật** (Siemens S7-1500, Kepware, Prosys…) và **chưa đo trên BL335**: số ở đây chỉ để so ngân sách sơ bộ.

## Rig tích hợp x64 (`tools/driver-it-opcua.ps1`, kết quả `019-opcua-*-x64.json`)

| Kịch bản | Kết quả | Ghi chú |
|---|---|---|
| read | PASS (4/4) | 17/17 Tag mọi kiểu đúng giá trị, subscription 250/1000/5000 ms |
| write | PASS (17/17) | 7 kiểu CONFIRMED (readback), lâu nhất 447 ms; node chỉ đọc `DEVICE_EXCEPTION`; giới hạn chặn trước driver; audit |
| errors | PASS (5/5) | node không có `OPCUA_NODE_UNKNOWN`, mảng và ngoài khoảng `OPCUA_TYPE_MISMATCH`; Tag khác GOOD |
| reconnect | PASS (7/7) | dừng server: BAD `DISCONNECTED`; chạy lại: GOOD sau 1,05 s, subscription tạo lại, runtime không khởi động lại |
| security | PASS (5/5) | Basic256Sha256 SignAndEncrypt + username (mật khẩu qua `--set-secret`), chứng chỉ ghim; browse qua thiết bị; ghim sai → `OPCUA_CERT_UNTRUSTED` |
| load | PASS (4/4) | 500 node đổi mỗi 1 s, 10 client xem 500 Tag, 60 s |

## Tải 500 node / 1 s (x64)

| Số đo | Giá trị |
|---|---|
| CPU runtime trung bình (một lõi x64) | 0,3 % (đỉnh 5 s: 0,4 %) |
| RSS runtime lớn nhất | 15,8 MB |
| Chu kỳ thật của một node | 998,5 ms |
| Mất sequence trên client | 0 |

## armhf dưới qemu-user (bench-500-opcua, 60 s)

| Project | RSS tiến trình qemu | CPU (tick/60 s) |
|---|---|---|
| kênh OPC UA bật | 105 916 KiB | 19 |
| cùng project, kênh tắt | 103 752 KiB | 10 |

RSS của qemu gồm bộ dịch mã (~100 MB) nên chỉ hiệu số có ý nghĩa: kênh OPC UA với 500 node thêm khoảng **2,1 MB**. CPU dưới giả lập không đại diện cho Cortex-A7; ước tính thô từ x64 (0,3 %) cho thấy còn xa ngân sách 30 %, nhưng bắt tay RSA 2048 (một lần mỗi kết nối) cần đo trên BL335.

## Kích thước

`mat-runtime` x64 11,4 MB (text 9,8 MB), armhf 7,3 MB, link `--gc-sections` (bỏ phần server của open62541).

## So ngân sách (Constitution III)

RSS ≤ 150 MB: đạt trên x64 (15,8 MB). CPU ≤ 30 %: đạt trên x64; chờ đo BL335. Test đơn vị armhf (qemu): `opcua_node_id_test`, `opcua_codec_test`, `opcua_driver_test`, `opcua_browse_test`, `mbedtls_config_test` đều qua.
