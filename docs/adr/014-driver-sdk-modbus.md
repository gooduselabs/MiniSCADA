# ADR-014: Driver SDK; Modbus TCP và RTU tự viết

- **Trạng thái:** Proposed (feature 006, plan ngày 2026-10-11; người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11). Chưa có số đo trên BL335; cổng RS485 của BL335 chưa xác nhận.
- **Ngày:** 2026-10-11
- **Liên quan:** [specs/006-tags-modbus](../../specs/006-tags-modbus/plan.md), research R7–R13, R23; contract [modbus-driver.md](../../specs/006-tags-modbus/contracts/modbus-driver.md); lộ trình v2 §3, §4.2, §4.8; Constitution II, III, VII; [ADR-017](017-tag-engine-v1.md).

## Bối cảnh

GĐ 2 cần đọc và ghi PLC thật. Lộ trình §4.8 đặt Modbus TCP/RTU ở đợt 1, rồi tới S7, MC, FINS, MQTT, OPC UA. Vì vậy cần một mô hình driver chung trước khi có driver thứ hai.

Ràng buộc:

- **Constitution II:** driver chỉ phát `TagUpdate`/`WriteResult`, không ghi DB, không nói chuyện với client.
- **Constitution III:** 500 Tag/1 s với 10 client, CPU ≤ 30 %, RSS ≤ 150 MB trên Cortex-A7.
- **Constitution VII:** driver chỉ phát hành khi có số đo trên BL335, giả lập trong CI, đã rà license.
- **Spec D3:** không dùng libmodbus (LGPL-2.1).
- **Thiết bị:** RS485 của BL335 chưa biết nằm ở cổng nào; `ttyUSB0`–`3` có thể là modem 4G; unit systemd có sandbox chặt (`PrivateDevices=true`).

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Luồng | một luồng `poll()` cho mọi kênh; **một luồng mỗi kênh** | một luồng mỗi kênh, ≤ 16, stack 256 KiB |
| Thư viện Modbus | libmodbus (LGPL-2.1); thư viện khác; **tự viết** | tự viết, lớp mã hóa thuần có vector chung |
| Gộp yêu cầu | không gộp; gộp chỉ liền nhau; **gộp tham lam có khoảng trống tối đa** | tham lam (tối ưu số khối), `maxGap` mặc định 10 thanh ghi |
| Exception 02/03 trong khối gộp | đọc từng Tag; **chia đôi tại khoảng trống lớn nhất** | chia đôi, cô lập trong ⌈log₂ n⌉ lượt, nhớ tới khi kết nối lại |
| Tách khung RTU | khoảng lặng t1.5/t3.5; **theo độ dài mong đợi** + khoảng lặng làm hàng rào | theo độ dài |
| Giả lập trong CI | pymodbus (Python ≥ 3.10); diagslave; **tự viết (Node) + slave pty trong test C++** | tự viết |
| Fuzz | libFuzzer (cần clang); **bộ sinh tất định trong GoogleTest + ASan/UBSan** | GoogleTest; libFuzzer tùy chọn trên runner |
| Quyền cổng serial | `PrivateDevices=true` + `BindPaths` từng cổng; **`DevicePolicy=closed` + `DeviceAllow` theo nhóm tty** | `DevicePolicy=closed`; dự phòng là `BindPaths` |

## Quyết định

1. **SDK:** mô hình kênh → thiết bị trường → Tag chung cho mọi driver.
   - Mỗi kênh một `Driver` chạy trong một luồng riêng. Driver nhận cấu hình đã phân giải, chỉ gọi `EngineSink::publish` và `EngineSink::writeDone`.
   - Trạng thái kênh và thiết bị trường đọc nguyên tử từ luồng HTTP, để kiểm lệnh ghi.
   - Có bộ test chuẩn cho mọi driver (`driver_conformance`). Modbus TCP, Modbus RTU và nguồn mô phỏng phải đạt cùng bộ.
2. **Lịch đọc:**
   - mỗi (thiết bị trường, nhóm quét) là một vòng; chọn việc theo thứ tự lệnh ghi trước, rồi khối đọc có hạn sớm nhất;
   - không dồn lượt trễ; chu kỳ thực đo theo lần bắt đầu vòng.
3. **Modbus tự viết:**
   - mã hàm 01–06, 15, 16, 22;
   - kiểm chặt từng phản hồi (mã giao dịch, unit, mã hàm, byte count, CRC); phản hồi sai bị bỏ và đếm;
   - một yêu cầu đang chờ mỗi kết nối;
   - RTU: khoảng lặng t3.5 trước khi gửi, khung theo độ dài, tùy chọn bỏ phần vọng lại, `TIOCSRS485` khi có, dự phòng chế độ thường.
4. **Thời gian:**
   - chờ 1 s; thử lại (chỉ đọc) TCP 0, RTU 1;
   - kết nối lại 1 s nhân đôi tới trần 10 s, ngẫu nhiên trừ tối đa 20 %;
   - tạm ngưng thiết bị trường RTU sau 3 lần không có trả lời hợp lệ, hỏi thử mỗi 10 s.
5. **Ghi:** hàng đợi FIFO ưu tiên hơn đọc; không bao giờ gửi lại; đọc lại để xác nhận (mặc định bật); bit trong thanh ghi bằng mã 22 hoặc đọc-sửa-ghi (có cảnh báo).
6. **Cổng serial:**
   - danh sách cho phép do root đặt (`serialPorts`, mặc định `ttyAS*`, tự loại console);
   - mở với `O_NOCTTY`, `TIOCEXCL`, `flock`;
   - unit đổi `PrivateDevices=true` thành `DevicePolicy=closed` + `DeviceAllow=char-ttyAS|ttyUSB|ttyACM` + `SupplementaryGroups=dialout`.
7. **Kiểm thử:**
   - vector khung và đổi giá trị chung với bản TS;
   - giả lập Modbus TCP viết bằng Node (mã hóa độc lập), có tiêm lỗi và nhật ký;
   - RTU qua cặp pty (`openpty`);
   - fuzz ≥ 1 giờ với ASan/UBSan khi nghiệm thu.

## Hệ quả

- **Tốt:**
  - Driver sau (S7, MC, FINS) cắm vào cùng mô hình, dùng lại bộ test chuẩn, lịch đọc, hàng đợi ghi, chẩn đoán.
  - Không có phụ thuộc LGPL. Toàn quyền về gộp yêu cầu, thời gian và chẩn đoán.
  - Kênh chậm hay lỗi không ảnh hưởng kênh khác.
- **Xấu:**
  - Phải tự giữ đúng giao thức; rủi ro hiểu sai đối xứng giữa driver và giả lập, giảm bằng vector từ tài liệu chuẩn và bàn thử PLC thật.
  - Tới 16 luồng thêm.
  - Unit bỏ `PrivateDevices=true` (thay bằng chính sách thiết bị tường minh), cần kiểm trên BL335.
  - Fuzz không theo độ phủ khi chạy trong image hiện có.

## Số đo / bằng chứng

- **Kiểm ngày 2026-10-11:**
  - image toolchain không có clang (chỉ `clang-format`);
  - CRC-16/MODBUS của `01 03 00 00 00 0A` là `C5 CD`, của `11 03 00 6B 00 03` là `76 87` (Node, khớp tài liệu chuẩn);
  - pymodbus 3.15.0 cần Python ≥ 3.10.
- **BL335** ([device-profile](../reports/device-profile.md)): `ttyAS0` là console (`serial-getty@ttyAS0`); có `usb0` 192.168.225.25, kiểu địa chỉ của modem 4G.
- **Chưa đo, làm ở task ⚠️🔌:**
  - RSS và CPU với 500 Tag/1 s qua Modbus TCP và 10 client (SC-003);
  - BAD ≤ 2 chu kỳ, GOOD ≤ 12 s khi rút cáp (SC-005);
  - RTU 30 phút với thiết bị thật (SC-002);
  - điều kiện của `DevicePolicy`/`DeviceAllow` trên kernel 5.4 của BL335 (lệnh chỉ đọc ở quickstart §8).

## Điều kiện xem xét lại

- Có driver thứ hai (S7, MC/SLMP): rà lại giao diện `Driver` trước khi đóng băng.
- Cần > 16 kênh, hoặc kênh cần nhiều yêu cầu đồng thời (cổng nối hiệu năng cao): xét event loop hoặc pipelining theo mã giao dịch.
- BL335 không có controller `devices` hoặc tên nhóm tty khác: chuyển hẳn sang drop-in `BindPaths`.
- Cần Modbus ASCII, RTU qua TCP, UDP, hay BL335 làm slave (ngoài phạm vi GĐ 2).
