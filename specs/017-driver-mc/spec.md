# Feature Specification: Driver Mitsubishi MC protocol (SLMP) cho iQ-R, iQ-F (FX5), Q, L

**Feature Branch**: `017-driver-mc`

**Created**: 2026-10-23

**Status**: Draft (quyết định tự chốt trong phiên, người dùng giao toàn quyền; ghi rõ giả định)

**Input**: Lộ trình v2 §4.8 đợt 2: "Mitsubishi MC/SLMP (khung 3E binary), tự viết theo tài liệu công khai; iQ-R, iQ-F (FX5), Q, L; phải mở cổng MC trong PLC". Làm song song với driver Siemens S7 (016) và Omron FINS (018).

## Bối cảnh

Runtime có driver Modbus TCP/RTU (feature 006, ADR-014) với SDK chung: lịch quét theo nhóm, gom khối, quality và lý do, hàng đợi ghi qua write coordinator (quyền, giới hạn tốc độ, audit), chẩn đoán, kết nối lại có backoff, thử kết nối. Khách hàng trong nước dùng nhiều PLC Mitsubishi; hiện phải qua gateway Modbus. MC protocol (SLMP) là giao thức Ethernet có sẵn trong CPU iQ-R, iQ-F (FX5), Q (cổng tích hợp hoặc module E71), L.

Ràng buộc ([Constitution](../../.specify/memory/constitution.md) 2.0.2): tự viết, không thư viện ngoài (license sạch); ngân sách BL335 (III); Browser không chạm PLC, driver chỉ phát `TagUpdate`/`WriteResult` (II); mọi lệnh ghi qua kiểm quyền, giới hạn, audit (V); test trước, hai bộ kiểm TS/C++ cùng vector (VI); định dạng chỉ thêm ở dòng 1.x (VII); driver chỉ phát hành khi có số đo BL335, giả lập chạy trong CI, đã rà license (VII).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Đọc dữ liệu PLC Mitsubishi lên SCADA (Priority: P1)

Kỹ sư thêm kênh "Mitsubishi MC" (IP, cổng SLMP), một thiết bị trường (PLC), rồi nhập Tag với địa chỉ quen thuộc của GX Works (`D100`, `D200` kiểu REAL, `M10`, `X1F`, `D100.5`, `ZR1000`, `TN0`, `CN3`, `SD210`...). Nạp xuống, màn hình hiện giá trị GOOD theo chu kỳ nhóm quét.

**Independent Test**: driver-it `mc-read` trên giả lập MC: 100 % Tag mọi kiểu và mọi loại thiết bị khớp bản đồ dữ liệu; số yêu cầu trên dây bằng số khối tính trước (gom theo giới hạn điểm, Random Read cho Tag rời).

**Acceptance Scenarios**:

1. **Given** Tag `INT16` ở D100, `FLOAT32` ở D200, `INT32` ở D300, `STRING` 10 ký tự ở D400, **When** chạy, **Then** giá trị khớp thứ tự byte của Mitsubishi (word thấp trước, byte thấp trước; ký tự đầu ở byte thấp).
2. **Given** 100 Tag D liền nhau và 20 Tag rời rạc ở các thiết bị khác, **When** quét, **Then** mỗi chu kỳ một lệnh Batch Read cho khối liền và ≤ 1 lệnh Random Read cho các Tag rời (≤ 192 điểm mỗi lệnh).
3. **Given** địa chỉ không có trong PLC (end code C056), **When** quét khối nhiều Tag, **Then** khối được chia, chỉ Tag sai BAD `MC_END_RANGE`, các Tag khác GOOD từ chu kỳ sau.

### User Story 2 - Ghi xuống PLC (Priority: P1)

Vận hành viên bật bơm (`M100`), đặt setpoint (`D500` REAL); lệnh đi qua write coordinator như Modbus (quyền, giới hạn, audit, đọc lại xác nhận). Bit trong word (`D10.3`) chỉ ghi được khi thiết bị cho phép đọc-sửa-ghi.

**Independent Test**: driver-it `mc-write`: ghi mọi kiểu, đọc lại khớp, audit có dòng; PLC cấm ghi (end code) cho `DEVICE_EXCEPTION` với mã end code.

**Acceptance Scenarios**:

1. **Given** Tag RW, **When** ghi, **Then** một lệnh 1401 (word hoặc bit), đọc lại, kết quả `CONFIRMED`.
2. **Given** Tag `D10.3` RW mà thiết bị `write.registerBit` = `none`, **When** kiểm project, **Then** lỗi `E_BIT_WRITE` ở cả Studio và runtime.

### User Story 3 - Mất kết nối, lỗi PLC, chẩn đoán (Priority: P1)

Rút cáp hoặc dừng PLC: Tag BAD trong ≤ 2 chu kỳ, kết nối lại có backoff (1 s → trần), GOOD lại không cần khởi động runtime. End code của PLC hiện ở chẩn đoán (đếm theo mã) và lý do quality.

**Independent Test**: driver-it `mc-faults` (im lặng, đóng kết nối, end code tiêm, trả lời chậm) và `mc-unplug`; gtest driver trên PLC giả.

### User Story 4 - Studio (Priority: P2)

Studio có lệnh "Thêm kênh Mitsubishi MC" ở cây Kết nối và editor kênh/thiết bị (frame 3E/4E, binary/ASCII, TCP/UDP, network/station/module I/O/station, timeout, giới hạn gom); Bảng Tag nhận địa chỉ MC (gợi ý thiết bị, báo lỗi tại ô), chẩn đoán hiện kênh MC và end code dạng hex.

**Independent Test**: Vitest model + e2e Studio: thêm kênh MC, thêm Tag `D100`, nhập `Q100` báo lỗi `E_ADDR_SYNTAX` tại ô.

### Edge Cases

- `X17` trên FX5 (bát phân) khác `X17` trên iQ-R (thập lục phân): chọn theo `xyNotation` của thiết bị.
- 3E không có số thứ tự: trả lời đến muộn có thể bị nhầm. Mỗi trả lời được kiểm độ dài và trường định tuyến; với 3E TCP, timeout thì đóng và mở lại kết nối; 4E dùng số thứ tự (khuyến nghị khi nhiều PLC sau một gateway).
- Bit của thiết bị bit được đọc theo word (16 điểm, đầu khối làm tròn xuống bội 16).
- Project 1.0 có kênh `mc`: lỗi `E_CHANNEL_VERSION` (định dạng 1.1 mới có).

## Requirements *(mandatory)*

- **FR-001** Khung 3E binary qua TCP (bắt buộc); 4E binary, ASCII (3E/4E) và UDP là tùy chọn của kênh.
- **FR-002** Lệnh: Batch Read 0401 (word, bit), Batch Write 1401 (word, bit), Random Read 0403 (word, dword). Mã lệnh con dạng Q/L (0000/0001), iQ-R và FX5 đều nhận.
- **FR-003** Thiết bị: D, W, R, ZR, M, X, Y, B, L, SM, SD, TN, CN. X, Y, B, W viết hệ 16 (X, Y hệ 8 khi `xyNotation: octal`), còn lại hệ 10. Bit trong word `D100.5` (một chữ số hex 0–F).
- **FR-004** Kiểu: BOOL, INT16 (INT), UINT16 (UINT), INT32 (DINT), UINT32 (UDINT), FLOAT32 (REAL), FLOAT64 (LREAL), INT64/UINT64, STRING (theo word). Mặc định thứ tự Mitsubishi: `byteOrder` CDAB, `stringByteOrder` BA; Tag ghi đè được.
- **FR-005** Gom yêu cầu: theo (thiết bị, mã thiết bị, nhóm quét), khoảng trống ≤ `maxGapWords`, khối ≤ `maxBatchWords` (≤ 960); khối nhỏ (≤ 2 word) rời rạc gom vào Random Read ≤ `maxRandomPoints` (≤ 192) khi `randomRead` bật.
- **FR-006** End code ≠ 0: phân loại thành lý do quality `MC_END_RANGE`, `MC_END_DEVICE`, `MC_END_COMMAND`, `MC_END_OTHER` (đăng ký ở `schemas/error-codes.json`); `MC_END_RANGE` trên khối nhiều Tag thì chia khối; chẩn đoán đếm theo end code; ghi lỗi trả `DEVICE_EXCEPTION` kèm end code.
- **FR-007** Timeout, kết nối lại có backoff, chẩn đoán (trạng thái kênh, thiết bị, đếm yêu cầu, timeout, khung hỏng, end code), cùng khuôn Modbus TCP (feature 011: backoff riêng của thiết bị).
- **FR-008** Tích hợp SDK: nhóm quét, quality, write coordinator (quyền, giới hạn tốc độ, audit), hủy lệnh ghi khi kích hoạt project; hành vi Modbus không đổi.
- **FR-009** Schema dòng 1.x (chỉ thêm): kênh `kind: "mc"` (`tcp`, `mc`), thiết bị MC; luật TS và C++ cùng vector `tests/project-vectors/v11-mc-*`, `tests/mc-vectors/address.json`.
- **FR-010** Giả lập Node `tools/mc-sim` (bản đồ JSON, tiêm lỗi qua cổng điều khiển); driver-it MC; gtest khung với vector byte; fuzz bộ giải mã.
- **FR-011** Studio: thêm kênh, editor, địa chỉ Tag, chẩn đoán; e2e.
- **FR-012** Đo RSS/CPU x64 500 Tag 1 s qua giả lập; build và test armhf dưới qemu.

## Success Criteria

- **SC-001** driver-it `mc-read`: 100 % Tag khớp; số lệnh/chu kỳ bằng số tính trước.
- **SC-002** Mất kết nối: BAD ≤ 2 chu kỳ, GOOD lại ≤ 12 s sau khi PLC trở lại.
- **SC-003** 500 Tag/1 s x64: CPU runtime trung bình và RSS ghi ở `docs/reports/017-mc-x64.md`, cùng cỡ với Modbus 500 Tag (`006-load`).
- **SC-004** TS và C++ cùng kết luận trên mọi vector `v11-mc-*` và `mc-vectors/address.json`.

## Assumptions

- Chưa thử PLC thật (không có phần cứng trong phiên); vector byte dựng theo cấu trúc khung của tài liệu công khai (SLMP Reference Manual, MELSEC Communication Protocol Reference Manual). Cần thử với iQ-R, FX5U, Q03UDE trước khi phát hành (Constitution VII).
- Dùng mã thiết bị 1 byte và số thiết bị 3 byte (lệnh con Q/L): không với tới thiết bị mở rộng của iQ-R (số > 16.777.215, LZ, LT...). Đủ cho các thiết bị của FR-003.
- ASCII: số thiết bị hex cho X, Y, B, W, ZR (theo bảng thiết bị của tài liệu), bát phân cho X, Y khi `xyNotation: octal`; chưa đối chiếu PLC thật.
- Không hỗ trợ: mật khẩu từ xa (remote password), Random Write, monitor, khối nhiều khối (0406), LCN/LTN 32 bit, ST/SS.
