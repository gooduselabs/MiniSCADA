# Feature Specification: Driver Omron FINS (UDP và TCP) cho CP1, CJ1, CJ2, CS1

**Feature Branch**: `018-driver-fins`

**Created**: 2026-10-23

**Status**: Draft (các quyết định tự chốt trong phiên, người dùng giao toàn quyền; ghi giả định ở cuối)

**Input**: Lộ trình v2 §4.8 đợt 2: "Omron FINS (UDP/TCP), tự viết theo tài liệu công khai; CP, CJ, CS; NJ/NX ưu tiên EtherNet/IP hoặc OPC UA". Hai đợt song song: Siemens S7 (016), Mitsubishi MC (017).

## Bối cảnh

Runtime có driver Modbus TCP/RTU (006, 011) trên khuôn SDK driver (`drivers/sdk`: nhóm quét, bộ gom khối, backoff, chẩn đoán, transport giả cho test). Omron CP1/CJ1/CJ2/CS1 với cổng Ethernet (CJ1W-ETN21, CJ2 built-in, CP1L-EM/EL, CP1W-CIF41) nói FINS qua UDP 9600 hoặc TCP 9600. Feature này thêm kênh loại `fins` vào định dạng 1.1 (chỉ thêm, MINOR), driver C++ tự viết, giả lập Node chạy trong CI và phần Studio.

Ràng buộc ([Constitution](../../.specify/memory/constitution.md) 2.0.2): ngân sách BL335 (III: một luồng 256 KiB mỗi kênh như Modbus), offline, ranh giới driver (II: chỉ phát `TagUpdate`/`WriteResult`), ghi Tag qua write coordinator và audit (V), test trước (VI), hai bộ kiểm TS/C++ cùng vector, phát hành driver cần số đo trên BL335 và giả lập trong CI (VII).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Đọc dữ liệu PLC Omron qua FINS (Priority: P1)

Kỹ sư thêm kênh "Omron FINS" (host PLC, UDP hoặc TCP, cổng 9600), một thiết bị (nút đích, unit 0 = CPU), rồi Tag `D100` (INT16), `D200` (FLOAT32), `CIO10.03` (BOOL), `E0_100` (UINT32), `T5` (PV timer), `T5` kiểu BOOL (cờ hoàn thành). Nạp xuống: Tag GOOD và cập nhật theo nhóm quét.

**Independent Test**: driver-it `fins-read-all` qua giả lập FINS (UDP và TCP): mọi vùng, mọi kiểu khớp bản đồ dữ liệu.

**Acceptance Scenarios**:

1. **Given** 500 Tag rời rạc trên D, **When** quét 1 s, **Then** driver gom thành ít yêu cầu (0101 cho khối liền, 0104 cho Tag lẻ) trong giới hạn khung (≤ 999 word mỗi lần đọc, ≤ 64 phần tử mỗi 0104 mặc định).
2. **Given** PLC trả mã kết thúc 1103 (địa chỉ ngoài vùng) cho một khối nhiều Tag, **When** đọc, **Then** khối bị tách đến khi chỉ Tag sai mang BAD `FINS_ADDRESS`, các Tag khác GOOD.
3. **Given** mất một gói UDP, **When** hết `timeoutMs`, **Then** driver gửi lại với SID mới (`retries`, mặc định 1 với UDP), trả lời muộn mang SID cũ bị bỏ và đếm.

### User Story 2 - Ghi Tag xuống PLC Omron (Priority: P1)

Người vận hành bấm nút ghi `W5.00` hoặc đặt `D300` (UINT16 BCD). Lệnh đi qua write coordinator (quyền, giới hạn, audit), driver gửi 0102 một lần, đọc lại và xác nhận.

**Independent Test**: driver-it `fins-write`: ghi word, bit, DINT, REAL, STRING, BCD; đọc lại khớp; ghi vào `A100` (chỉ đọc) bị validator chặn; giả lập trả end code 2101 → `DEVICE_EXCEPTION`.

**Acceptance Scenarios**:

1. **Given** Tag bit `W5.00` RW, **When** ghi true, **Then** driver gửi 0102 với mã vùng bit (0x31), dữ liệu 1 byte.
2. **Given** Tag BCD UINT16, **When** ghi 1234, **Then** word gửi là 0x1234; ghi 10000 → `NOT_SENT_UNSUPPORTED`.

### User Story 3 - Cấu hình và chẩn đoán trong Studio (Priority: P2)

Trong editor Kết nối: nút **Thêm kênh Omron FINS**, form kênh (host, transport, cổng, mạng/nút nguồn), thiết bị (mạng, nút, unit, timeout). Bảng Tag gợi ý địa chỉ FINS (`D`, `CIO`, `W`, `H`, `A`, `E0_`, `T`, `C`), báo lỗi ngay trên ô. Dock Chẩn đoán hiện kênh FINS và đếm theo mã kết thúc.

**Independent Test**: e2e Studio: thêm kênh FINS, thêm Tag `D100.05` BOOL hợp lệ, `D100.16` báo `E_ADDR_SYNTAX`; lưu, mở lại giữ nguyên.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** Khung FINS 10 byte (ICF, RSV, GCT, DNA, DA1, DA2, SNA, SA1, SA2, SID) + MRC/SRC; trả lời có MRES/SRES. ICF lệnh 0x80, trả lời bit 6 = 1. Kiểm trả lời: ICF trả lời, DNA/DA1/DA2 của trả lời = SNA/SA1/SA2 của lệnh, SNA/SA1/SA2 trả lời = đích, SID, MRC/SRC; sai thì bỏ và đếm (`badFrames`).
- **FR-002** FINS/UDP (một datagram mỗi khung, cổng nguồn tự cấp hoặc `localPort`) và FINS/TCP (đầu "FINS" 16 byte, bắt tay nút: client gửi lệnh 0 với nút 0 = tự cấp, server trả lệnh 1 với nút client và nút server; khung FINS gửi bằng lệnh 2; mã lỗi đầu TCP khác 0 đóng kết nối).
- **FR-003** Lệnh 0101 (đọc vùng), 0102 (ghi vùng), 0104 (đọc nhiều vùng); 0501 (đọc dữ liệu bộ điều khiển) chỉ dùng cho Thử kết nối.
- **FR-004** Vùng và mã vùng (chế độ CS/CJ): CIO (B0/30), W (B1/31), H (B2/32), A (B3/33), D (82/02), EM bank 0–C (A0+n/20+n), T và C: giá trị hiện tại (89) và cờ hoàn thành (09), C cộng 0x8000 vào địa chỉ.
- **FR-005** Cú pháp địa chỉ: `D100`, `D100.05`, `CIO10.03`, `W5`, `H2`, `A448`, `E0_100`, `EC_100.15`, `T5`, `C12`. Bit 0–15 chỉ với BOOL; `T`/`C` kiểu BOOL là cờ hoàn thành (chỉ đọc), kiểu số là giá trị hiện tại. Tầm: CIO 0–6143, W 0–511, H 0–1535, A 0–1471 (ghi chỉ 448–1471), D và EM 0–32767, T/C 0–4095. Tag nhiều word không vượt tầm.
- **FR-006** Kiểu: BOOL, INT16 (INT), UINT16 (UINT), INT32 (DINT), UINT32 (UDINT), FLOAT32 (REAL), FLOAT64 (LREAL), INT64/UINT64, STRING. Thứ tự Omron: word big-endian, word thấp ở địa chỉ thấp (`CDAB`); chuỗi ký tự đầu ở byte cao (`AB`). `source.bcd` (tùy chọn, INT16/UINT16 4 chữ số, INT32/UINT32 8 chữ số).
- **FR-007** Gom: theo (thiết bị, vùng, nhóm quét) bằng `planBlocks` (`maxGapWords`, `maxReadWords` ≤ 999); khối ≤ 8 word còn lại gộp vào 0104 (`multiRead`, `maxMultiItems` ≤ 128) khi có ≥ 2 khối như vậy.
- **FR-008** Mã kết thúc → lý do quality và mã SDK: 0000 OK; 0001 `FINS_CANCELED`; 01xx/02xx/03xx/05xx `FINS_ROUTING`; 04xx `FINS_UNSUPPORTED`; 10xx `FINS_FORMAT`; 11xx `FINS_ADDRESS`; 20xx `FINS_READ_DENIED`; 21xx `FINS_WRITE_DENIED`; 22xx `FINS_MODE`; 23xx/24xx/25xx `FINS_UNIT_ERROR`; 26xx/30xx/40xx `FINS_ACCESS`; khác `FINS_OTHER`. Bit 7 của MRES (lỗi chuyển tiếp) và bit 6–7 của SRES (lỗi PLC) được che trước khi tra. Trả lời 0000 kèm cờ lỗi PLC vẫn là dữ liệu tốt (cờ chỉ báo trạng thái PLC). Chẩn đoán đếm theo mã đủ 4 chữ số.
- **FR-009** Timeout: UDP gửi lại với SID mới (`retries`, mặc định 1), TCP không gửi lại (mặc định 0). Hết lượt: Tag của thiết bị BAD `TIMEOUT`, thiết bị vào backoff riêng (1–30 s) rồi hỏi thử; 3 timeout liên tiếp trên ≥ 2 thiết bị (hoặc thiết bị duy nhất) đóng kết nối (TCP) hoặc mở lại socket (UDP), mọi Tag khác BAD `DISCONNECTED`, kết nối lại có backoff (`reconnectMaxS`).
- **FR-010** Ghi: một lần, không gửi lại; 0102 với mã vùng word hoặc bit; đọc lại theo `readback`; mã như Modbus (`CONFIRMED`, `NO_READBACK`, `WRITE_TIMEOUT`, `DEVICE_EXCEPTION`, `READBACK_*`, `NOT_SENT_*`).
- **FR-011** Định dạng 1.1: `connections.json` thêm kênh `kind: "fins"` (`fins: {host, port, transport, sourceNetwork, sourceNode, localPort, connectTimeoutMs, reconnectMaxS}`, thiết bị `{network, node, unit, timeoutMs, retries, writeDeadlineMs, maxReadWords, maxGapWords, multiRead, maxMultiItems, byteOrder}`); `tags.json` thêm `source.bcd`. Dưới 1.1: `E_CHANNEL_VERSION`. Địa chỉ sai: `E_ADDR_SYNTAX`/`E_ADDR_AREA`/`E_ADDR_RANGE`; Tag quá `maxReadWords`: `E_ADDR_READ_LIMIT`; ghi quá 990 word: `E_ADDR_WRITE_LIMIT`; `bcd` sai kiểu hoặc trên kênh Modbus: `E_SCHEMA`.
- **FR-012** Chẩn đoán (`GET /api/v1/drivers/diagnostics`): kênh `kind: "fins"`, `exceptions` theo mã kết thúc 4 chữ số hex. Thử kết nối (`POST /api/v1/drivers/test`, kind `fins`): gửi 0501 hoặc đọc một địa chỉ.
- **FR-013** Giả lập `tools/fins-sim` (Node, UDP + TCP, bản đồ JSON, cổng điều khiển để rớt gói, trả end code, trễ). Kịch bản driver-it mới.

### Key Entities

Kênh FINS (một điểm cuối IP), thiết bị FINS (địa chỉ FINS đích sau điểm cuối đó), Tag FINS (vùng, word, bit, kiểu, BCD).

## Success Criteria *(mandatory)*

- **SC-001** gtest khung với vector byte theo W342 (lệnh 0101/0102/0104, bắt tay TCP, mã kết thúc) qua; fuzz bộ giải mã 20 s không lỗi ASan/UBSan.
- **SC-002** Vector `tests/fins-vectors/address.json` qua cả TS và C++; vector project `v11-fins-*` qua cả hai bộ kiểm.
- **SC-003** driver-it FINS qua (UDP, TCP, ghi, mất gói, end code).
- **SC-004** x64: 500 Tag 1 s qua giả lập, RSS tăng so với không có kênh ≤ 2 MB, CPU ≤ 1 % (`docs/reports/018-fins-x64.md`). armhf build và test FINS dưới qemu qua.
- **SC-005** Modbus không đổi hành vi: toàn bộ test Modbus và driver-it Modbus cũ vẫn qua.

## Assumptions

- **Chưa thử PLC thật**; tầm vùng và mã vùng theo tài liệu công khai W342 (FINS Commands Reference) và W421/W465 (CJ1W-ETN21, CJ2). Đo trên BL335 để lại cho người dùng (ngân sách VII).
- UDP: PLC trả về cổng nguồn của lệnh (ETN21, CJ2, CP1L-E); ETN11 cũ trả về 9600 → đặt `localPort: 9600`. Nút nguồn UDP mặc định là byte cuối IP của BL335 (tự cấp khi `sourceNode` = 0); nút đích mặc định là byte cuối IP của PLC (`node` = 0).
- CV/C-mode (mã vùng cũ), NJ/NX, ghi cờ hoàn thành T/C, chế độ đọc/ghi "forced status", FINS qua Host Link (serial): ngoài phạm vi.
- Giới hạn 0104 thực tế của CS/CJ là 167 phần tử; chọn mặc định 64, tối đa 128 để có dư khung.
