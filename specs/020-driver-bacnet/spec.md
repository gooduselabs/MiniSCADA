# Feature Specification: Driver BACnet/IP client

**Feature Branch**: `020-driver-bacnet`

**Created**: 2026-10-24

**Status**: Draft (quyết định tự chốt trong phiên, người dùng giao toàn quyền; giả định ở cuối)

**Input**: Lộ trình v2 §4.8 đợt 4: "BACnet/IP client — bacnet-stack (license phải rà soát) hoặc tự viết tập con; Who-Is, ReadPropertyMultiple, COV, WriteProperty có priority". Song song: Mitsubishi MC (017), OPC UA (019), cầu nối OPC DA (021); S7 (016) và FINS (018) đã xong trên nhánh riêng.

## Bối cảnh

BACnet/IP (ASHRAE 135, Annex J) là giao thức chính của hệ thống tòa nhà (BMS: điều hòa, AHU, chiller, đồng hồ năng lượng). Runtime cần đọc/ghi các đối tượng Analog/Binary/Multi-state của bộ điều khiển BACnet qua UDP 47808. Tự viết tập con (C++17) theo khuôn SDK driver như S7/FINS: không thêm thư viện ngoài, không vướng cổng giấy phép (bacnet-stack là GPL-2.0 kèm ngoại lệ liên kết; tự viết là mặc định, xem ADR-048).

Ràng buộc ([Constitution](../../.specify/memory/constitution.md)): ngân sách BL335 (một luồng 256 KiB mỗi kênh), offline, ranh giới driver (chỉ phát `TagUpdate`/`WriteResult`), ghi qua write coordinator + audit, test trước, hai bộ kiểm TS/C++ cùng vector, phát hành driver cần số đo trên BL335 và giả lập trong CI.

## User Scenarios & Testing

### User Story 1 - Đọc điểm BACnet (P1)

Kỹ sư thêm kênh "BACnet/IP", một thiết bị (device instance 1001, IP 192.168.1.50), Tag `AI:1` (FLOAT32), `BV:3` (BOOL), `MSV:2` (UINT16), `AI:1:units` (UINT16), `AI:1:status-flags` (UINT16). Nạp xuống: Tag GOOD, cập nhật theo nhóm quét; Tag present-value mang quality theo status-flags của đối tượng.

**Independent Test**: driver-it `bacnet-it.mjs` trên giả lập BACnet/IP: đọc mọi loại đối tượng; 500 điểm gom bằng ReadPropertyMultiple.

1. **Given** 500 Tag trên một thiết bị, **When** quét 1 s, **Then** driver gom thành các ReadPropertyMultiple vừa `maxApdu` (không segmentation).
2. **Given** đối tượng có status-flags fault, **When** đọc, **Then** Tag BAD `BACNET_FAULT`; out-of-service hoặc overridden → UNCERTAIN.
3. **Given** một Tag trỏ đối tượng không tồn tại, **When** đọc RPM, **Then** chỉ Tag đó BAD `BACNET_UNKNOWN_OBJECT`, Tag khác GOOD.
4. **Given** thiết bị không hỗ trợ RPM (Reject unrecognized-service), **Then** driver chuyển sang ReadProperty từng điểm.

### User Story 2 - Ghi có priority và relinquish (P1)

Người vận hành đặt `AV:5` = 21.5 (priority mặc định 16 của thiết bị) hoặc `BO:2@8` = true (priority 8). Ghi đi qua write coordinator (quyền, giới hạn, audit); driver gửi WriteProperty một lần, đọc lại present-value và xác nhận. Tag `AO:1:relinquish@8` (BOOL, RW): ghi bất kỳ giá trị → WriteProperty present-value NULL ở priority 8; đọc → true khi priority-array[8] là NULL.

### User Story 3 - Studio: thêm kênh, tìm thiết bị, duyệt đối tượng (P2)

Editor Kết nối: **Thêm kênh BACnet/IP**, form kênh (cổng cục bộ, broadcast, BBMD), thiết bị (instance, IP, cổng, maxApdu, timeout, priority ghi). Nút **Tìm thiết bị** gửi Who-Is qua runtime (API thử kết nối) và liệt kê I-Am; chọn một dòng điền form thiết bị. **Duyệt đối tượng** đọc object-list của thiết bị, chọn đối tượng để thêm Tag. Bảng Tag nhận và kiểm địa chỉ BACnet.

## Requirements

- **FR-001** BVLC (Annex J): 0x81, chức năng Original-Unicast (0x0A), Original-Broadcast (0x0B), Forwarded-NPDU (0x04, nhận), Register-Foreign-Device (0x05), Distribute-Broadcast-To-Network (0x09), BVLC-Result (0x00); độ dài 16 bit. Cổng mặc định 47808 (0xBAC0).
- **FR-002** NPDU version 1; control: bit 2 expecting-reply với confirmed request; DNET/DLEN/DADR + hop count 255 khi thiết bị sau router (`network`, `mac`); bỏ qua SNET/SADR khi nhận; NPDU network-layer message bị bỏ.
- **FR-003** APDU: Confirmed-Request (không segment, max-segments 0, max-APDU theo kênh 1476), Unconfirmed-Request, Simple-ACK, Complex-ACK (segmented → lỗi `BACNET_SEGMENTATION`), Error, Reject, Abort. Dịch vụ: Who-Is (8, unconfirmed), I-Am (0), ReadProperty (12), ReadPropertyMultiple (14), WriteProperty (15).
- **FR-004** Mã hóa tag ASN.1 kiểu BACnet: application tag 0–12 (NULL, BOOLEAN, Unsigned, Signed, REAL, Double, Octet String, Character String UTF-8, Bit String, Enumerated, Date, Time, Object Identifier), context tag, opening/closing tag, độ dài mở rộng (5, 254, 65535). Bộ giải mã chặn tràn độ dài và lồng sâu.
- **FR-005** Địa chỉ Tag: `<loại>:<instance>[:<thuộc tính>][@<priority>]`. Loại: AI, AO, AV, BI, BO, BV, MSI, MSO, MSV, DEV. Instance 0–4194302. Thuộc tính: `present-value` (mặc định), `status-flags`, `units`, `out-of-service`, `object-name`, `description`, `reliability`, `event-state`, `relinquish` (giả thuộc tính, cần `@`), hoặc số 0–4194303. Priority 1–16 chỉ với `present-value` hoặc `relinquish` trên đối tượng ghi được (AO, AV, BO, BV, MSO, MSV); priority 6 dành cho minimum on/off → `E_ADDR_RANGE`.
- **FR-006** Kiểu theo thuộc tính: analog present-value REAL → FLOAT32, FLOAT64, INT16/32/64, UINT16/32/64 (đổi số, làm tròn); binary present-value → BOOL, UINT16; multi-state present-value → UINT16, UINT32, INT16, INT32; status-flags → UINT16 (bit0 in-alarm, bit1 fault, bit2 overridden, bit3 out-of-service); units, reliability, event-state → UINT16, UINT32; out-of-service → BOOL; object-name, description → STRING; số thuộc tính tự do → mọi kiểu số/BOOL/STRING, chỉ đọc. Sai kiểu → `E_ADDR_AREA`.
- **FR-007** Ghi: chỉ present-value của AO/AV/BO/BV/MSO/MSV và `relinquish`; còn lại `access: RW` → `E_ADDR_AREA`. Priority: `@p` của Tag, không có thì `writePriority` của thiết bị (mặc định 16). Đọc lại present-value (hoặc priority-array[p] với relinquish).
- **FR-008** Gom: theo (thiết bị, nhóm quét), một Tag present-value kéo theo status-flags của đối tượng (cùng request); RPM gói theo đối tượng, mỗi request ≤ `maxApdu` cả chiều gửi lẫn ước tính trả lời, ≤ `maxRpmProps` thuộc tính (mặc định 32). `useRpm: false` hoặc thiết bị Reject/Error unrecognized-service → ReadProperty từng thuộc tính. Abort segmentation-not-supported / buffer-overflow → chia đôi request.
- **FR-009** Lỗi → lý do quality / mã SDK: Error class/code: unknown-object (31) `BACNET_UNKNOWN_OBJECT`, unknown-property (32) `BACNET_UNKNOWN_PROPERTY`, write-access-denied (40) `BACNET_WRITE_DENIED`, value-out-of-range (37) `BACNET_VALUE_RANGE`, invalid-data-type (9) `BACNET_DATA_TYPE`, khác `BACNET_ERROR`; Reject `BACNET_REJECT`; Abort `BACNET_ABORT`; segmentation `BACNET_SEGMENTATION`; giá trị trả về khác kiểu mong đợi `BACNET_TYPE`; status-flags fault `BACNET_FAULT` (BAD); out-of-service `BACNET_OUT_OF_SERVICE`, overridden `BACNET_OVERRIDDEN` (UNCERTAIN). Ghi lỗi → `DEVICE_EXCEPTION` kèm `exception` = mã error-code BACnet (Reject/Abort: 1000 + lý do / 2000 + lý do).
- **FR-010** Timeout và gửi lại: invoke-id 0–255 xoay vòng theo kênh; hết `timeoutMs` (mặc định 500) gửi lại **cùng invoke-id** `retries` lần (mặc định 1; chuẩn gợi ý 3000 ms × 3, chọn ngắn hơn để Tag báo TIMEOUT trong 1 s, trong chu kỳ normal như FINS); hết lượt: Tag của thiết bị BAD `TIMEOUT`, thiết bị backoff 1–30 s rồi hỏi thử. Trả lời muộn/sai nguồn/sai invoke-id bị bỏ và đếm (`badFrames`). Ghi không gửi lại.
- **FR-011** Kênh `bacnet` (định dạng 1.1): `bacnet { localPort (0–65535, mặc định 47808), bindAddress?, broadcast?, bbmd? { host, port, ttlS } , reconnectMaxS }`; thiết bị `{ id, name, enabled, deviceInstance (0–4194302), host, port (47808), network? (1–65534), mac? (hex 1–6 byte, cần network), maxApdu (50–1476, mặc định 1476), timeoutMs (100–30000, 500), retries (0–5, 1), writeDeadlineMs, writePriority (1–16 trừ 6, mặc định 16), useRpm (true), maxRpmProps (1–128, 32) }`. Dưới 1.1 → `E_CHANNEL_VERSION`. Luật TS và C++ cùng vector `tests/project-vectors/v11-bacnet-*`.
- **FR-012** Foreign device: có `bbmd` → gửi Register-Foreign-Device (TTL) lúc mở và mỗi TTL/2; Who-Is qua Distribute-Broadcast-To-Network. BVLC-Result NAK → cảnh báo kênh `BBMD_NAK`.
- **FR-013** Thử kết nối (POST /api/v1/drivers/test, `kind: bacnet`): `action` = `read` (mặc định: đọc object-name của Device hoặc một địa chỉ), `whois` (Who-Is broadcast hoặc qua BBMD, chờ `waitMs` ≤ 5000, trả danh sách {instance, host, port, network, mac, maxApdu, segmentation, vendorId}), `objects` (đọc object-list của thiết bị, tối đa 2000 đối tượng, từng phần tử nếu cần). Giới hạn tần suất và audit như Modbus.
- **FR-014** Chẩn đoán: kênh `kind: bacnet`, đếm request/response/timeout/badFrames; `exceptions` theo mã error-code BACnet.
- **FR-015** Studio: thêm kênh BACnet/IP (chỉ project 1.1), form, Tìm thiết bị, Duyệt đối tượng → thêm Tag, Bảng Tag kiểm địa chỉ; tiếng Việt.

## Success Criteria

- **SC-001** gtest mã hóa/giải mã khớp vector byte công khai (`tests/bacnet-vectors/frames.json`); fuzz bộ giải mã không crash.
- **SC-002** driver-it đọc/ghi/lỗi/500 điểm qua giả lập Node trên mạng riêng `mat-drv-it-bacnet` (172.30.20.0/24).
- **SC-003** RSS/CPU x64 với 500 điểm 1 s ghi ở `docs/reports/020-bacnet-x64.md`; armhf qua qemu chạy test. **Chưa thử thiết bị BACnet thật.**

## Ngoài phạm vi (v1)

SubscribeCOV (để bản sau; quét định kỳ đủ cho 500 điểm), segmentation, BACnet MS/TP, BACnet/SC, trend log, schedule/calendar, alarm/event BACnet, Who-Has, tự tìm IP theo instance khi chạy (IP thiết bị bắt buộc trong cấu hình).

## Giả định

- Thiết bị trả lời về cổng nguồn của yêu cầu (chuẩn Annex J); `localPort` mặc định 47808 để thiết bị cũ trả về 47808 vẫn tới, đổi được khi trùng cổng.
- Một request đang chờ mỗi kênh (giống Modbus/FINS); 500 điểm ≈ 10–20 RPM mỗi giây, đủ.
- Who-Is trên BL335 dùng broadcast của giao diện (`broadcast` mặc định 255.255.255.255).
