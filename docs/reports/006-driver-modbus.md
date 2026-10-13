# Báo cáo driver Modbus TCP và RTU (feature 006)

Ngày: 2026-10-13. Căn cứ: FR-060, Constitution VII, lộ trình v2 §4.8, [ADR-014](../adr/014-driver-sdk-modbus.md), hợp đồng [modbus-driver.md](../../specs/006-tags-modbus/contracts/modbus-driver.md).

**Kết luận: driver CHƯA ĐƯỢC PHÁT HÀNH.** Constitution VII đòi số đo trên BL335, giả lập trong CI và rà license. Giả lập trong CI và license đã đủ; số đo trên BL335, thử với PLC thật và thử RS485 thật chưa có vì SSH tới BL335 đang bị chặn và chưa có thiết bị. Các số "chưa đo" dưới đây là điều kiện còn thiếu, không phải kết quả đạt.

## 1. Phạm vi đọc và ghi hỗ trợ

| Hạng mục | Hỗ trợ |
|---|---|
| Đường truyền | Modbus TCP (MBAP), Modbus RTU qua cổng serial (RS485 hoặc RS232), tối đa 16 kênh, mỗi kênh một luồng |
| Đọc | mã 01 (coil), 02 (discrete input), 03 (holding), 04 (input register); gộp khối tham lam, `maxGap` mặc định 10 thanh ghi, mỗi yêu cầu ≤ 125 thanh ghi (≤ 2.000 bit) |
| Ghi | 05, 06, 15, 16, 22 (mặt nạ bit); ghi bit trong thanh ghi bằng 22 hoặc đọc-sửa-ghi (`W_BIT_RMW`) |
| Kiểu dữ liệu | BOOL, INT16, UINT16, INT32, UINT32, INT64, UINT64, FLOAT32, FLOAT64, STRING; bốn thứ tự byte ABCD, CDAB, BADC, DCBA; bit trong thanh ghi; scaling tuyến tính có kẹp; deadband |
| Exception 02/03 trong khối gộp | chia đôi tại khoảng trống lớn nhất, cô lập Tag lỗi trong ⌈log2 n⌉ lượt, nhớ tới khi kết nối lại |
| Ghi có kiểm soát | audit bền trước khi gửi, mã yêu cầu chống chạy hai lần, đọc lại (`readback`) so giá trị thô, không bao giờ gửi lại lệnh đã gửi |
| RTU | tách khung theo độ dài mong đợi, kiểm CRC, tạm ngưng thiết bị sau 3 yêu cầu hỏng (hỏi thử 10 s), `TIOCEXCL`, chế độ RS485 của kernel khi có |
| Chưa hỗ trợ | Modbus ASCII, mã hàm 23 và 43, ghi cuộn tệp; gateway TCP nhiều unit chưa cô lập lỗi theo từng thiết bị (xem §6) |

## 2. License

| Thành phần | License | Ghi chú |
|---|---|---|
| Driver Modbus TCP và RTU, Driver SDK, lớp mã hóa | tự viết trong repo | không dùng libmodbus (LGPL-2.1, spec D3) và không thư viện Modbus nào khác |
| Giả lập `tools/modbus-sim` (Node) | tự viết | chỉ để test, không vào gói thiết bị |
| Image `node:22.23.3-alpine` (giả lập và client trong `tests/driver-it/compose.yaml`) | MIT | chỉ công cụ test, ghi ở `third_party/LICENSES.md` |
| Slave pty trong test C++ | tự viết | chỉ test |

Không thêm thư viện vendored nào cho feature 006.

## 3. Giả lập trong CI

| Công cụ | Nội dung | Kết quả x64 (2026-10-13) |
|---|---|---|
| `tools/modbus-sim` + `node --test` | PDU, khung, bản đồ, tiêm lỗi (timeout, exception, sai tid/unit/độ dài, byte rác, chậm, đóng kết nối) | xanh |
| ctest, bộ test chuẩn cho driver (`DriverConformance`) | TCP trên transport giả, RTU trên pty | xanh, xem acceptance §10 |
| `tools/driver-it.ps1` | `source`, `read`, `merge`, `split`, `probe`, `write`, `write-race`, `unplug`, `write-kill`, `load`, `calc`, `retain`, `write-io`, `faults` | xem [006-acceptance.md](006-acceptance.md) |
| `tools/fuzz-modbus.ps1` | decoder TCP và RTU so với tham chiếu viết riêng, máy trạng thái nhận trên đường truyền hỏng | 3.600 s ASan + UBSan đạt (acceptance §11) |

## 3b. Số đo trên x64 (Docker, runtime Release, giả lập Node)

| Mục | Số đo | Bằng chứng |
|---|---|---|
| Đọc đủ kiểu, 4 thứ tự byte, bit, STRING, scaling | 27/27 Tag khớp giả lập | `006-read-x64.json` |
| Gộp khối | 6 khối, 30 yêu cầu trong cửa sổ so với 31 dự kiến, mỗi yêu cầu ≤ 125 thanh ghi | `006-merge-x64.json` |
| Tách khi exception 02 | chỉ Tag lỗi BAD `EXCEPTION_02`, Tag khác GOOD từ lượt sau | `006-split-x64.json` |
| Thử kết nối | REFUSED, DNS, EXCEPTION, TIMEOUT, OK đúng mã; kênh đang chạy khoảng cách lượt quét lớn nhất 1.000 ms | `006-probe-x64.json` |
| Ghi | 10 lệnh tới giả lập, 22 lệnh nhận; `CONFIRMED` ≤ 0,46 s; mọi từ chối có audit | `006-write-x64.json` |
| Mất kết nối, 20 vòng (10 ngắt mạng, 10 dừng giả lập luân phiên) | BAD sau tối đa 1,51 s, GOOD lại sau tối đa 2,01 s, không khởi động lại runtime; ngắt mạng thật (docker network disconnect) đạt | `006-unplug-x64.json` |
| Tải 500 Tag, 10 client, 60 s | CPU 0,2 % một lõi, RSS tối đa 12,9 MB, 0 mất sequence, chu kỳ trung bình 1.001,2 ms (p95 1.000), trễ p95 4 ms | `006-load-x64.json` |
| Tính toán 500 + 200 + 100 | CPU 0,6 % một lõi, RSS 15,6 MB, 12.000 lần đổi đầu vào, 0 sai | `006-calc-x64.json` |

Các số CPU và RSS x64 chỉ để so sánh tương đối; ngưỡng của Constitution III (CPU ≤ 30 %, RSS ≤ 150 MB) phải đo trên Cortex-A7 của BL335.

## 4. Phần cứng đã thử

| Phần cứng | Trạng thái |
|---|---|
| PLC Modbus TCP thật (model, firmware) | **chưa thử**: cần PLC của người dùng (T223) |
| Bộ chuyển USB-RS485 và thiết bị RS485 thật | **chưa thử**: cần người ở cạnh thiết bị (T224) |
| Cổng serial và RS485 trên BL335 | **chưa xác nhận**: kiểm chỉ đọc chờ SSH (T006) |
| pty (thay serial) trên x64 | đã thử, ghi nhận pty ép slave 8N1 và từ chối đặt parity lần hai (EINVAL) |

## 5. RAM, CPU trên BL335

**Chưa đo** (T219): SSH bị chặn. Cần: 500 Tag nhóm 1 s, 10 client, 30 phút, bằng `tools/measure/sample.sh`; ngưỡng CPU ≤ 30 %, RSS ≤ 150 MB (SC-003, SC-004).

## 6. Hạn chế đã biết

- Gateway Modbus TCP nhiều unit sau một kết nối: một thiết bị hết thời gian chờ làm đóng cả kết nối và đánh BAD mọi Tag của kênh (`modbus_tcp_driver.cpp`, `dropConnection`); chỉ driver RTU có đếm lỗi theo thiết bị và tạm ngưng. Với một PLC mỗi kênh TCP thì không ảnh hưởng. Đề xuất cho bản sau: đếm lỗi theo thiết bị trên TCP.
- CRC-16 của RTU cho lọt 1/65.536 khung hỏng; đó là tính chất của giao thức.
- Unit systemd còn `PrivateDevices=true`: kênh RTU chưa mở được cổng trên thiết bị cho tới khi làm T169 (cần kiểm trên BL335).

## 7. Điều kiện để phát hành

1. T006: xác nhận cổng serial và RS485 của BL335.
2. T169, T217: unit và `deploy.sh` cho cổng serial, cài runtime 0.5.0.
3. T219: CPU, RSS trên BL335.
4. T223: PLC Modbus TCP thật; T224: thiết bị RS485 thật.
5. Cập nhật báo cáo này, chuyển ADR-014 sang Accepted.
