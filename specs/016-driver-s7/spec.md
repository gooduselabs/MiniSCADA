# Feature Specification: Driver Siemens S7 (PUT/GET) (016)

**Feature Branch**: `016-driver-s7`

**Created**: 2026-10-23

**Status**: Draft (quyết định tự chốt theo giao việc; người dùng đã giao toàn quyền quyết định, xem memory "User full authority")

**Input**: Giao việc 2026-10-23: driver Siemens S7 (S7comm qua ISO-on-TCP, cổng 102) cho S7-1200/1500/300/400 bằng PUT/GET; giao thức tự viết C++17 không thư viện ngoài (roadmap-v2 §4.8: không dùng Snap7 vì LGPL); schema kết nối `s7` và địa chỉ Tag S7 trong dòng định dạng 1.1; giả lập S7 bằng Node cho test tích hợp; Studio thêm kênh Siemens S7; đo RSS/CPU x64; tài liệu, ADR-044.

## Bối cảnh

Runtime hiện chỉ có driver Modbus TCP/RTU (feature 006, ADR-014) và mô phỏng. Đa số trạm bơm/nhà máy khách hàng dùng PLC Siemens; muốn đọc/ghi PLC S7 không qua gateway Modbus. S7-1200/1500 cho phép truy cập tuyệt đối (absolute) qua "PUT/GET" khi bật quyền đó trong TIA Portal và tắt "Optimized block access" cho DB cần đọc; S7-300/400 luôn cho phép.

Ràng buộc (Constitution 2.0.2): II (driver chỉ phát `TagUpdate`/`WriteResult`; validator TS và C++ cùng vector), III (500 Tag/1 s: RSS ≤ 150 MB, CPU ≤ 30 % trên BL335), V (mọi lệnh ghi qua write coordinator: role, giới hạn, audit), VI (test trước), VII (định dạng có phiên bản: chỉ thêm, MINOR trong dòng 1.1; driver mới cần số đo, giả lập trong CI, license sạch).

## Quyết định đã chốt

- **D1. Giao thức tự viết.** TPKT (RFC 1006) + COTP (ISO 8073 lớp 0) + S7comm (ROSCTR Job/Ack_Data; hàm Setup Communication 0xF0, Read Var 0x04, Write Var 0x05; địa chỉ kiểu S7ANY 0x10). Không Snap7 (LGPL-3.0), không thư viện ngoài. Chỉ truy cập tuyệt đối; không symbolic (S7-1500 symbolic dùng OPC UA sau này).
- **D2. Kết nối.** Kênh `kind: "s7"` có `tcp` (`host`, `port` mặc định 102, `connectTimeoutMs`, `reconnectMaxS`) và `s7` (`rack` 0–7 mặc định 0, `slot` 0–31 mặc định 1, hoặc `remoteTsap`/`localTsap` dạng 4 chữ số hex; `pduSize` 240–960 mặc định 480). TSAP mặc định: local `0100`, remote `01` + `rack*32 + slot` (kiểu kết nối PG, như Snap7). Có `remoteTsap` thì không được có `rack`/`slot` (`E_S7_TSAP`). Mỗi kênh S7 có **đúng một thiết bị trường** (một CPU) với `timeoutMs`, `retries`, `writeDeadlineMs`, `maxGapBytes` (0–256, mặc định 16).
- **D3. Địa chỉ Tag** (chữ hoa/thường như nhau, chuẩn hóa về tiếng Anh: `E`→`I`, `A`→`Q`): `DBn.DBXb.x`, `DBn.DBBb`, `DBn.DBWb`, `DBn.DBDb`, `DBn.STRINGb`, `DBn.LREALb`; `Mb.x`, `MBb`, `MWb`, `MDb`; `Ib.x`/`Eb.x`, `IBb`, `IWb`, `IDb`; `Qb.x`/`Ab.x`, `QBb`, `QWb`, `QDb`. Kiểu S7 suy từ cỡ trong địa chỉ và `rawType` của Tag (bảng ở contracts §2). DB 1–65535, byte 0–65535, bit 0–7. Ghi vùng I bị từ chối (`E_ADDR_AREA`). Mã lỗi địa chỉ dùng lại `E_ADDR_SYNTAX`, `E_ADDR_AREA`, `E_ADDR_RANGE`, `E_ADDR_READ_LIMIT`, `E_ADDR_WRITE_LIMIT` (thông điệp riêng cho S7); `byteOrder`/`stringByteOrder` trên Tag S7 là `E_SCHEMA`.
- **D4. Định dạng.** Thêm trong dòng 1.1 (schema gốc, MINOR): `connections.schema.json` thêm `s7Channel`, `s7Device`; `tag.schema.json` nới `source.address` tới 24 ký tự. Kênh `s7` trong project 1.0 là `E_DRIVER_VERSION`. Không đổi `schemas/1.0/`.
- **D5. Đọc gộp.** Tag cùng (nhóm quét, vùng, DB) gộp thành khoảng byte liền kề (khe ≤ `maxGapBytes`, cỡ ≤ PDU − 18); nhiều khoảng gộp vào một Read Var nhiều item (≤ 20 item, yêu cầu và trả lời đều ≤ PDU đã thương lượng). Item lỗi 0x05/0x0A có ≥ 2 Tag thì tách đôi như exception 02/03 của Modbus.
- **D6. Ghi.** Một lệnh ghi = một Write Var một item (BOOL ghi bit, không đọc-sửa-ghi); gửi một lần, rồi đọc lại (readback) như Modbus. STRING ghi từ byte độ dài hiện tại (không ghi byte độ dài tối đa của PLC).
- **D7. Lỗi.** Timeout của một yêu cầu (hết `retries`) đóng kết nối và mở lại sau backoff (PLC là một đầu mối, không có gateway). Lỗi item → lý do quality `S7_*` (bảng contracts §5); lỗi đầu khung 0x8104 → `S7_FUNCTION_NOT_AVAILABLE` (thường do chưa bật PUT/GET). PDU đã thương lượng nhỏ hơn cỡ Tag → `S7_PDU_TOO_SMALL`.
- **D8. Thử kết nối** (`POST /api/v1/drivers/test`) cho kênh S7 **chưa làm** trong feature này: Studio ẩn nút Thử kết nối ở kênh S7 kèm ghi chú. Ghi vào việc còn mở.
- **D9. Giả lập** `tools/s7-sim` (Node, không gói ngoài) và rig tích hợp riêng `tests/driver-it-s7` + `tools/driver-it-s7.ps1` (tên dự án compose, mạng riêng) để không va với rig Modbus.
- **D10. Chưa thử PLC thật**: mọi kết quả là trên giả lập và tài liệu công khai; báo cáo và tài liệu ghi rõ.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Đọc PLC S7 (Priority: P1)

Kỹ sư thêm kênh Siemens S7 (IP, rack 0, slot 1), khai Tag `DB1.DBD4` REAL, `M0.1` BOOL, nạp xuống: Tag GOOD với giá trị PLC, cập nhật theo nhóm quét.

**Acceptance Scenarios**:
1. **Given** giả lập có DB1, M, I, Q với mọi kiểu, **When** runtime chạy project read-all-types S7, **Then** 100 % Tag GOOD và đúng giá trị (BOOL, BYTE, CHAR, INT, WORD, DINT, DWORD, REAL, LREAL, STRING).
2. **Given** 500 Tag chu kỳ 1 s, **Then** mỗi vòng dùng số yêu cầu đúng bằng kế hoạch gộp, mỗi yêu cầu ≤ PDU.
3. **Given** giả lập chỉ chịu PDU 240 còn project xin 960, **Then** driver dùng 240, mọi yêu cầu ≤ 240 byte, Tag vẫn GOOD.

### User Story 2 - Ghi xuống PLC (Priority: P1)

Người vận hành ghi Tag RW (BOOL, INT, REAL, STRING…): qua write coordinator (quyền, giới hạn, audit), driver gửi Write Var, đọc lại, kết quả CONFIRMED.

**Acceptance Scenarios**:
1. **Given** Tag RW mọi kiểu, **When** ghi, **Then** giả lập có giá trị mới, kết quả CONFIRMED, audit có dòng.
2. **Given** DB bị từ chối (0x03), **When** ghi, **Then** kết quả DEVICE_EXCEPTION, exception 3.

### User Story 3 - Mất kết nối và lỗi (Priority: P1)

**Acceptance Scenarios**:
1. **Given** giả lập ngừng trả lời hoặc đóng kết nối, **Then** Tag BAD (TIMEOUT/DISCONNECTED) trong ≤ 2 chu kỳ, kết nối lại có backoff, Tag GOOD lại khi giả lập về, runtime không khởi động lại.
2. **Given** Tag trỏ DB không tồn tại hoặc ngoài cỡ DB, **Then** chỉ Tag đó BAD (`S7_OBJECT_NOT_FOUND`, `S7_ADDRESS_OUT_OF_RANGE`), Tag khác GOOD.
3. **Given** PUT/GET tắt (giả lập trả 0x8104), **Then** mọi Tag BAD `S7_FUNCTION_NOT_AVAILABLE`, Chẩn đoán driver hiện mã đó.

### User Story 4 - Studio (Priority: P1)

Editor Kết nối có "Thêm kênh Siemens S7" (form theo khuôn Modbus, kiểm trực tiếp); Bảng Tag gợi ý định dạng địa chỉ S7 và báo lỗi tại ô; Chẩn đoán driver hiện kênh S7 (PDU đã thương lượng, TSAP, lỗi item).

### Edge Cases

- `DB0`, bit 8, byte > 65535, `DB1.DBX0` thiếu bit, `MW` thiếu số → lỗi địa chỉ có mã.
- STRING đọc về có độ dài hiện tại > độ dài tối đa → cắt theo độ dài tối đa và `stringLength`.
- REAL NaN/Inf → BAD `INVALID_VALUE` như Modbus.
- Trả lời sai PDU reference (trả lời muộn) → bỏ, đếm `badFrames.tid`.

## Requirements *(mandatory)*

- **FR-001** Mã hóa/giải mã TPKT, COTP CR/CC/DT, S7 Setup Communication, Read Var, Write Var; kiểm từng byte, khung hỏng không làm sập (fuzz).
- **FR-002** Bộ phân tích địa chỉ S7 hai bản (TS `@mat/tag-codec`, C++ `drivers/s7`) cùng vector `tests/s7-vectors/address.json`.
- **FR-003** Luật kiểm project TS và C++ cùng vector `tests/project-vectors/v11-s7-*`.
- **FR-004** Driver S7 theo SDK: nhóm quét, quality, backoff, chẩn đoán, write coordinator; không đổi hành vi Modbus.
- **FR-005** Mã lỗi mới có trong `schemas/error-codes.json`, `docs/user/error-codes.md` sinh lại.
- **FR-006** Giả lập S7 Node + rig tích hợp: đọc mọi kiểu, ghi, mất kết nối/kết nối lại, PDU nhỏ, lỗi địa chỉ, tải 500 Tag.
- **FR-007** Studio: kênh S7, địa chỉ S7 trong Bảng Tag, chẩn đoán S7; e2e.
- **FR-008** Đo RSS/CPU x64 500 Tag/1 s (`docs/reports/016-s7-x64.md`); test S7 dưới qemu armhf.
- **FR-009** Tài liệu kỹ sư (kết nối S7, PUT/GET, optimized block access, bảng địa chỉ), ADR-044.

## Success Criteria

- **SC-001** 100 % Tag của project read-all-types S7 GOOD đúng giá trị trên giả lập.
- **SC-002** 500 Tag/1 s x64: RSS runtime ≤ 150 MB, CPU trung bình thấp (số đo trong báo cáo).
- **SC-003** Kết nối lại sau khi giả lập về ≤ 12 s, không khởi động lại runtime.
- **SC-004** Các bộ kiểm: ctest x64, test S7 armhf qemu, lint, typecheck, `npm test`, e2e liên quan xanh.

## Giả định

- Kiểu kết nối PG (TSAP remote `0x01xx`) như Snap7 mặc định; S7-1200/1500 chấp nhận PG. Ai cần OP/basic thì nhập `remoteTsap`.
- Không hỗ trợ LINT/ULINT/LWORD, DATE/TIME, vùng bộ đếm/timer (C/T), WSTRING; STRING tối đa 250 ký tự (trần `stringLength` của schema).
- CHAR/STRING đọc là Latin-1 (byte > 0x7F đổi sang ký tự Unicode cùng mã); ghi ký tự ngoài Latin-1 bị từ chối.
- Chưa thử với PLC thật.
