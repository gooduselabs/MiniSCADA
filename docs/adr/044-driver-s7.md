# ADR-044: Driver Siemens S7 tự viết (S7comm qua ISO-on-TCP, PUT/GET)

- **Trạng thái**: Proposed (feature 016, 2026-10-23; test x64, armhf qemu và giả lập; chưa thử PLC thật, chưa đo trên BL335)
- **Bối cảnh**: [spec 016](../../specs/016-driver-s7/spec.md), [hợp đồng](../../specs/016-driver-s7/contracts/s7-driver.md), roadmap-v2 §4.8, ADR-014 (SDK driver), Constitution 2.0.2 (III, V, VII).

## Bối cảnh

Khách hàng dùng nhiều PLC Siemens. Roadmap-v2 §4.8 đặt S7 PUT/GET là driver thứ hai sau Modbus, với hai lựa chọn: tự viết S7comm hoặc dùng Snap7 (LGPL-3.0). Constitution VII đòi driver mới có giả lập trong CI, số đo RAM/CPU và license đã rà soát.

## Quyết định

1. **Tự viết giao thức** (C++17, không thư viện ngoài): TPKT (RFC 1006), COTP lớp 0 (CR/CC/DT), S7comm Job/Ack_Data với Setup Communication, Read Var, Write Var, địa chỉ S7ANY. Không dùng Snap7: LGPL-3.0 trên thiết bị nhúng đòi cho người dùng thay thư viện (liên kết động, cung cấp cách thay), thêm rà soát pháp lý; phần giao thức cần dùng nhỏ (khoảng 1.500 dòng cả driver) và đã có tài liệu công khai (Wireshark, tài liệu Snap7) để viết lại mà không chép mã.
2. **Khuôn SDK của Modbus** (ADR-014): một luồng 256 KiB mỗi kênh; `Scheduler` (nhóm quét, ghi trước), `Backoff`, `DiagCounters`, `planBlocks`/`splitBlock`, `Transport`/`TcpSocket`; driver chỉ phát `TagUpdate`/`WriteResult`; ghi đi qua write coordinator sẵn có (role, giới hạn, tốc độ, audit). Một CPU mỗi kênh.
3. **Đọc gộp theo PDU**: khoảng byte theo (nhóm quét, vùng, DB) với khe ≤ `maxGapBytes`; nhiều item (≤ 20) mỗi Read Var sao cho yêu cầu và trả lời ≤ PDU đã thương lượng = min(xin, PLC trả lời). Tag lớn hơn một lần đọc: BAD `S7_PDU_TOO_SMALL`.
4. **Lỗi**: timeout (hết `retries`) đóng kết nối và mở lại sau backoff (PLC là một đầu mối, không có gateway như Modbus TCP); trả lời mang PDU reference khác bị bỏ; lỗi item → lý do quality `S7_*` riêng Tag đó (05/0A trên item nhiều Tag thì tách đôi); lỗi đầu khung 81 04 → `S7_FUNCTION_NOT_AVAILABLE` (PUT/GET chưa bật).
5. **Định dạng**: kênh `kind: "s7"` và địa chỉ S7 là phần thêm của dòng 1.1 (MINOR), chặn ở 1.0 bằng `E_DRIVER_VERSION`; mã lỗi địa chỉ dùng lại `E_ADDR_*`; bộ phân tích địa chỉ hai bản TS/C++ cùng vector.
6. **Thử nghiệm**: giả lập Node `tools/s7-sim` (bản đồ JSON, điều khiển lỗi qua HTTP), vector khung viết tay `tests/s7-vectors/frames.json` dùng chung cho C++ và giả lập, PLC giả trong gtest, fuzz bộ giải mã, rig `tests/driver-it-s7` riêng (tên dự án và mạng riêng).

## Hệ quả

- Không phụ thuộc license ngoài; tự chịu trách nhiệm tương thích. Rủi ro: khác biệt PLC thật (firmware S7-1500 mới, CP 343/443, LOGO!) chưa thấy ở giả lập; giảm bằng TSAP nhập tay, mã lỗi rõ, Chẩn đoán driver hiện PDU/TSAP.
- Chỉ truy cập tuyệt đối: DB phải tắt "Optimized block access"; truy cập symbolic để cho OPC UA (đợt driver sau).
- Thử kết nối (`POST /api/v1/drivers/test`) chưa có cho S7.
- Chỗ dùng chung đổi nhỏ: `RuntimeEngine` giữ driver theo kênh dạng `drv::Driver*`; chẩn đoán có `channel.details`.
- Phát hành (Constitution VII) chờ số đo trên BL335 và thử với PLC thật.
