# Contract: driver SDK và driver Modbus TCP/RTU

**Feature**: [spec.md](../spec.md) FR-013–FR-017, FR-023–FR-035, FR-044, SC-001–SC-005, SC-014, SC-016, SC-020 · **Research**: R7–R13 · **ADR**: [014](../../../docs/adr/014-driver-sdk-modbus.md)

Tài liệu tham chiếu: *Modbus Application Protocol Specification V1.1b3* và *Modbus over Serial Line V1.02* (modbus.org, công khai). Driver tự viết, không dùng libmodbus (D3, FR-060).

## 1. Driver SDK

**Ranh giới** (Constitution II, FR-023): driver chỉ gọi `EngineSink::publish(TagUpdate…)` và `EngineSink::writeDone(WriteResult)`. Driver không ghi DB, không gửi gì tới client, không biết `TagStore`.

| Kiểu | Trường |
|---|---|
| `TagBinding` | chỉ số Tag, vùng, offset, số thanh ghi hoặc bit, bit (với bit trong thanh ghi), `rawType`, `byteOrder`, `stringLength`, `stringByteOrder`, nhóm quét, `readback`, cách ghi |
| `TagUpdate` | chỉ số Tag, giá trị thô đã giải mã theo `rawType` (`TagScalar`), quality, lý do, `sourceTs` (lúc nhận phản hồi) |
| `WriteCommand` | mã nội bộ, chỉ số Tag, giá trị thô (đã scaling ngược, đã kiểm khoảng), hạn chót (`writeDeadlineMs`), `readback` |
| `WriteResult` | mã nội bộ, kết quả (`CONFIRMED`, `NO_READBACK`, `FAILED_*`, `TIMEOUT_*`), giá trị đọc lại, mã exception |
| `LinkState` | trạng thái kênh, trạng thái thiết bị trường: đọc nguyên tử từ luồng HTTP (FR-037 bước 5) |

Giao diện C++: [research.md](../research.md) R7. Một `Driver` mỗi kênh, một luồng mỗi kênh, stack 256 KiB.

**Driver trong GĐ 2:** `modbus-tcp`, `modbus-rtu`, `simulation` (bộ sinh của [value-tables-simulation.md](value-tables-simulation.md) §2 và `legacy`). `simulation` không có kênh hay luồng riêng: engine gọi `step(now)` mỗi lượt; nó vẫn chỉ phát qua `EngineSink`.

## 2. PDU

| Mã | Yêu cầu | Phản hồi đúng | Giới hạn |
|---|---|---|---|
| 01 đọc coil | addr(2) qty(2) | n(1) + n byte (bit thấp trước) | qty 1–2.000; n = ⌈qty/8⌉ |
| 02 đọc DI | như 01 | như 01 | như 01 |
| 03 đọc HR | addr(2) qty(2) | n(1) + 2·qty byte | qty 1–125 |
| 04 đọc IR | như 03 | như 03 | như 03 |
| 05 ghi 1 coil | addr(2) val(2) = `FF00` hoặc `0000` | nhắc lại yêu cầu | |
| 06 ghi 1 HR | addr(2) val(2) | nhắc lại yêu cầu | |
| 15 ghi nhiều coil | addr(2) qty(2) n(1) + n byte | addr(2) qty(2) | qty 1–1.968 |
| 16 ghi nhiều HR | addr(2) qty(2) n(1) + 2·qty byte | addr(2) qty(2) | qty 1–123 |
| 22 ghi có mặt nạ | addr(2) and(2) or(2) | nhắc lại yêu cầu | |
| exception | | mã \| 0x80, mã exception(1) | |

Số nhiều byte theo thứ tự lớn trước (big-endian), như chuẩn Modbus.

## 3. Khung

**Modbus TCP (MBAP):** mã giao dịch(2), mã giao thức(2) = 0, độ dài(2) = 1 + độ dài PDU, unit ID(1), PDU. ADU ≤ 260 byte.

- Mỗi kết nối, mã giao dịch bắt đầu ngẫu nhiên, tăng 1 mỗi yêu cầu (quay vòng sau 65.535). Một yêu cầu đang chờ mỗi kết nối.
- Phản hồi được nhận khi khớp mã giao dịch, mã giao thức 0, độ dài, unit ID, mã hàm, byte count hoặc trường nhắc lại. Sai thì bỏ, đếm, chờ tiếp tới hết hạn.

**Modbus RTU:** địa chỉ slave(1), PDU, CRC(2, byte thấp trước). ADU ≤ 256 byte.

- **CRC-16/MODBUS:** đa thức 0xA001 (đảo bit), giá trị đầu 0xFFFF. Ví dụ: `01 03 00 00 00 0A` → `C5 CD`; `11 03 00 6B 00 03` → `76 87` (ví dụ của tài liệu chuẩn).
- **Độ dài khung mong đợi:** 01–04: 5 + n; 05, 06, 15, 16: 8; 22: 10; exception: 5.
- **Nhận:** đọc tới đủ độ dài. Hai byte cách nhau quá `max(t3.5, gapFloor)` mà chưa đủ thì khung thiếu byte. Đủ rồi vẫn chờ một khoảng lặng: có byte thừa thì cả khung bị bỏ. Sai CRC, sai địa chỉ, sai mã hàm, thiếu, thừa: bỏ, đếm, không cập nhật Tag (FR-034).
- **Khoảng lặng:** ký tự = 1 + bit dữ liệu + bit parity (nếu có) + bit stop. t3.5 = 3,5 ký tự khi tốc độ ≤ 19.200; 1,75 ms khi lớn hơn. `silenceMs` (nếu đặt) phải ≥ t3.5. `gapFloor` = 20 ms. Trước mỗi lần gửi: chờ đủ khoảng lặng kể từ byte cuối, rồi `tcflush(TCIFLUSH)`.
- **Vọng lại** (`dropEcho`): đọc và so N byte vừa gửi; khác thì đếm `echo` và coi như khung hỏng.
- **Không có địa chỉ 0 (broadcast)** (D31).

## 4. Exception

| Mã | Nghĩa (Studio hiện) | Khi đọc | Khi ghi |
|---|---|---|---|
| 01 | mã hàm không hỗ trợ | Tag BAD `EXCEPTION_01` | `FAILED`; gợi ý "đặt luôn dùng mã 16" (hoặc 15) |
| 02 | địa chỉ không hợp lệ | khối gộp: tách (§7); một Tag: BAD | `FAILED` |
| 03 | giá trị dữ liệu không hợp lệ | như 02 | `FAILED` |
| 04 | thiết bị trường lỗi | BAD | `FAILED` |
| 05 | đã nhận, đang xử lý | coi như lỗi, thử lại theo `retries` | `FAILED` (không chắc kết quả: lý do nói rõ) |
| 06 | thiết bị trường bận | thử lại theo `retries`, rồi BAD | `FAILED` (không thử lại) |
| 07 | không thực hiện được (NAK) | BAD | `FAILED` |
| 08 | lỗi chẵn lẻ bộ nhớ | BAD | `FAILED` |
| 09 | mã không xác định | BAD `EXCEPTION_OTHER` | `FAILED` |
| 0A | cổng nối không có đường tới thiết bị | chỉ thiết bị trường đó BAD; kênh vẫn chạy | `FAILED` |
| 0B | thiết bị sau cổng nối không trả lời | như 0A | `FAILED` |
| khác | mã lạ | BAD `EXCEPTION_OTHER` | `FAILED` |

Exception là trả lời hợp lệ: không tính vào bộ đếm tạm ngưng của RTU (FR-027).

## 5. Thời gian và trạng thái

| Tham số | Mặc định | Khoảng |
|---|---|---|
| Nhóm quét nhanh, thường, chậm | 250 ms, 1 s, 5 s | 100 ms–60 s |
| Chờ trả lời (`timeoutMs`) | 1.000 | 100–10.000 |
| Thử lại khi đọc (`retries`) | TCP 0, RTU 1 | 0–5 |
| Chờ kết nối TCP | 3.000 | 500–30.000 |
| Kết nối lại TCP | 1 s, tăng gấp đôi, trần `reconnectMaxS` 10 s | trần 1–60 s |
| Tạm ngưng RTU | sau 3 lần liên tiếp không có trả lời hợp lệ; hỏi thử mỗi 10 s | cố định |
| Thời hạn ghi (`writeDeadlineMs`) | 5.000 | 1.000–60.000 |
| Khoảng nghỉ giữa hai yêu cầu (`requestGapMs`) | 0 | 0–1.000 |

- **Chờ kết nối lại:** `d_n = max(1 s, min(trần, 2ⁿ s) × (1 − 0,2·u))`, `u` đều trong [0, 1). Lần đầu đúng 1 s; từ lần thứ 5 nằm trong 8–10 s.
- **Kết nối bị phía kia đóng khi đang rảnh:** kết nối lại ngay một lần trước khi tính lỗi.
- **Mất kết nối TCP, hay hết số lần thử của một yêu cầu đọc:** Tag của yêu cầu BAD ngay (`TIMEOUT`, `BAD_FRAME`, `EXCEPTION_xx`). Đóng kết nối TCP thì mọi Tag của kênh BAD `DISCONNECTED`.
- **Lịch đọc** (FR-017):
  - vòng của (thiết bị trường, nhóm quét) đến hạn ở `t0 + k × chu kỳ`; chọn việc theo thứ tự: lệnh ghi, rồi khối đọc có hạn sớm nhất;
  - vòng trễ không dồn: trễ hơn một chu kỳ thì bỏ lượt đã lỡ, đếm `overruns`;
  - chu kỳ thực = khoảng giữa hai lần bắt đầu vòng; chẩn đoán báo trung bình và lớn nhất trong 60 s, có dấu quá tải khi trung bình > 110 % chu kỳ đặt.
- **Thiết bị trường hay kênh tắt trong project:** không có lưu lượng; Tag BAD `DISABLED`.

## 6. Đổi giá trị thô ↔ giá trị (`@mat/tag-codec` và C++ dùng chung vector)

**Thứ tự byte/word** (kiểu 32 và 64 bit; kiểu 16 bit luôn lớn trước). Ví dụ FLOAT32 123,456 = `42F6E979`, INT64 `0x0102030405060708`:

| `byteOrder` | FLOAT32 (2 thanh ghi) | INT64 (4 thanh ghi) |
|---|---|---|
| `ABCD` (chuẩn Modbus) | `42F6 E979` | `0102 0304 0506 0708` |
| `CDAB` (đảo word) | `E979 42F6` | `0708 0506 0304 0102` |
| `BADC` (đảo byte trong word) | `F642 79E9` | `0201 0403 0605 0807` |
| `DCBA` (đảo cả hai) | `79E9 F642` | `0807 0605 0403 0201` |

Với 64 bit, "đảo word" đảo thứ tự cả 4 word (FR-013).

- **Bit trong thanh ghi:** `(reg >> b) & 1`.
- **Coil, DI:** bit thứ i của byte ⌊i/8⌋, bit thấp trước.
- **STRING** (`stringLength` L byte, ⌈L/2⌉ thanh ghi, `stringByteOrder` `AB` mặc định):
  - **đọc:** ghép byte, dừng ở byte 0 đầu tiên, giải mã UTF-8; byte lỗi thành U+FFFD;
  - **ghi:** mã hóa UTF-8, đệm byte 0 tới L (và tới số chẵn); dài hơn L thì `REJECTED` `STRING_TOO_LONG`;
  - ví dụ "Bơm 1" (`42 C6 A1 6D 20 31`), L = 8: `AB` → `42C6 A16D 2031 0000`; `BA` → `C642 6DA1 3120 0000`.
- **NaN, ±∞ đọc từ FLOAT32/64:** BAD `INVALID_VALUE`.
- **Scaling** (engine): [research.md](../research.md) R6; khoảng thô của kiểu kiểm bằng số nguyên chính xác (INT64/UINT64 so dạng số nguyên, không qua số thực).

**Vector `tests/codec-vectors/`:**

| File | Nội dung |
|---|---|
| `address.json` | chuỗi địa chỉ, `addressBase` → vùng, mã hàm đọc/ghi, offset, số thanh ghi, bit, hoặc mã lỗi (`E_ADDR_*`) |
| `numeric.json` | kiểu, thứ tự, thanh ghi (hex) ↔ giá trị; mọi kiểu × 4 thứ tự; biên khoảng của kiểu; NaN, vô cực |
| `string.json` | L, thứ tự, thanh ghi ↔ chuỗi; UTF-8 lỗi, byte 0 giữa chuỗi, L lẻ, quá dài |
| `scaling.json` | thô ↔ kỹ thuật, `clamp`, làm tròn khi ghi, ngoài khoảng thô |
| `bits.json` | coil/DI đóng gói; bit trong thanh ghi; mặt nạ mã 22 |

## 7. Gộp yêu cầu, tách khi có exception

**Gộp** (FR-024), cho mỗi (thiết bị trường, vùng, nhóm quét):

```text
sắp khoảng [đầu, cuối) theo (đầu, cuối)
khối = khoảng đầu tiên
với mỗi khoảng r kế tiếp:
    nếu r.đầu − khối.cuối ≤ maxGap và max(khối.cuối, r.cuối) − khối.đầu ≤ maxLen: khối.cuối = max(khối.cuối, r.cuối)
    không thì: đóng khối, khối = r
maxLen = min(125 thanh ghi | 2.000 bit, maxRead… của thiết bị trường)
maxGap = maxGapRegisters | maxGapBits (0: chỉ gộp liền nhau)
```

- Khoảng chồng hoặc trùng (hai Tag cùng địa chỉ) vào cùng khối, đọc một lần.
- Tag dài hơn `maxLen` là lỗi kiểm tra `E_ADDR_READ_LIMIT`: không bao giờ tách một Tag.

**Tách** (FR-025):

- khối ≥ 2 Tag gặp 02 hoặc 03: chia tại khoảng trống lớn nhất giữa hai Tag liền kề (bằng nhau thì lấy khoảng gần giữa nhất); không có khoảng trống thì chia tại ranh giới Tag gần giữa nhất. Hai nửa đọc từ lượt sau;
- khối 1 Tag gặp 02 hoặc 03: Tag BAD `EXCEPTION_02`/`03`; khối vẫn đọc mỗi lượt;
- trong lúc tách, Tag giữ giá trị và quality đang có;
- kế hoạch đã tách giữ tới khi kết nối lại hoặc đổi project.

**Test:** ca của US1-6, US1-8; thuộc tính ngẫu nhiên (hạt giống cố định): mỗi Tag trong đúng một khối, khối ≤ `maxLen`, khoảng trống ≤ `maxGap`, số khối bằng vét cạn khi ≤ 8 Tag; hội tụ của việc tách ≤ ⌈log₂ n⌉ lượt.

## 8. Ghi

| Tag | Cách ghi |
|---|---|
| BOOL ở coil | 05 (`write.singleCoil = fc05`) hoặc 15 với qty 1 |
| 1 thanh ghi (16 bit) | 06 (`write.singleRegister = fc06`) hoặc 16 với qty 1 |
| 2–123 thanh ghi (32/64 bit, STRING) | 16 |
| bit trong HR, `registerBit = mask` | 22: `and = ~(1 << b)`, `or = v << b` |
| bit trong HR, `registerBit = rmw` | 03 đọc (ưu tiên), sửa bit, 06 hoặc 16; cảnh báo `W_BIT_RMW` |
| `DI`, `IR` | không ghi được (`E_ADDR_AREA`) |

- **Hàng đợi ghi** của kênh: 16 lệnh, FIFO, luôn trước khối đọc đang chờ. Không gửi lại lệnh đã gửi (FR-028). Lệnh chưa gửi mà mất kết nối, quá `writeDeadlineMs` hay đổi project: `FAILED` `NOT_SENT_*`.
- **Đọc lại** (`readback`, mặc định bật): ngay sau phản hồi đúng, đọc đúng vùng của Tag (01 hoặc 03), ưu tiên như lệnh ghi; so **giá trị thô** (từng bit với số thực, từng byte với STRING đã đệm). Kết quả theo máy trạng thái của [data-model.md](../data-model.md) §8.

## 9. Chẩn đoán (FR-029)

Số đếm nguyên tử, từ lúc runtime chạy:

| Mức | Số đếm |
|---|---|
| Kênh | `state`, `lastError { code, at }`, `reconnects`, `warnings[]` (`RS485_UNSUPPORTED`…) |
| Thiết bị trường | `state`, `requestsOk`, `timeouts`, `exceptions { "02": n, … }`, `badFrames { crc, format, tid, unit, length, echo }`, `responseMs { avg, max }` (EWMA và lớn nhất trong 60 s), `writes { confirmed, failed, timeout, rejected }` |
| Nhóm quét × thiết bị trường | `periodMs`, `actualMs { avg, max }`, `overruns`, `overloaded` |

JSON: [device-api-1.1.md](device-api-1.1.md) §5.

## 10. Thử kết nối (FR-044)

Chạy trên BL335 với cấu hình gửi kèm, chưa cần nạp xuống.

- **TCP:** kết nối mới, tạm thời; không đụng kết nối của kênh đang chạy.
- **RTU:**
  - cổng rảnh: mở tạm (luật mở cổng của [research.md](../research.md) R13), đóng sau khi thử;
  - cổng đang do một kênh chạy với **cùng** tốc độ và khung: gửi yêu cầu thử vào hàng đợi của kênh đó, như một yêu cầu đọc thường;
  - khác tham số: `PORT_BUSY`.
- **Kết quả** trong ≤ chờ kết nối + chờ trả lời + 2 s; mã: `OK`, `REFUSED`, `TIMEOUT`, `UNREACHABLE`, `DNS`, `PORT_BUSY`, `PORT_CONSOLE`, `PORT_NOT_ALLOWED`, `PORT_ERROR`, `EXCEPTION`, `BAD_FRAME`.
- **Tùy chọn đọc một địa chỉ** (1–4 thanh ghi, hoặc 1–16 bit): trả giá trị thô. Studio tự hiện cách hiểu theo các kiểu và 4 thứ tự (`@mat/tag-codec`).
- Mỗi lúc một lần thử trên một BL335; ≤ 10 lần/phút; audit `driver.test`.

## 11. Bộ test chuẩn cho driver (FR-023, SC-020)

`drivers/sdk/tests/driver_conformance.hpp`, chạy cho `modbus-tcp` (transport giả và giả lập Node), `modbus-rtu` (pty), `simulation`:

1. Trước lần đọc đầu: Tag BAD `NO_VALUE`.
2. Giá trị khớp backend, mọi kiểu và thứ tự.
3. Backend không trả lời: BAD có lý do trong ≤ 2 chu kỳ (cấu hình mặc định); có lại thì GOOD, không khởi động lại.
4. Đủ các kết quả ghi của [data-model.md](../data-model.md) §8; không gửi lại lệnh đã gửi.
5. Kênh hay thiết bị trường tắt: `DISABLED`, 0 byte trên đường truyền.
6. Sau `stop()`: không gọi `EngineSink` nữa; luồng đã join.
7. Số đếm chẩn đoán khớp số lỗi đã tiêm.

## 12. Giả lập Modbus TCP (`tools/modbus-sim`, chỉ để test)

`node tools/modbus-sim/sim.mjs --tcp 1502 --control 1503 --map map.json [--log requests.jsonl]`

- **`map.json`:** unit ID → vùng → giá trị ban đầu; kịch bản đổi giá trị (`everySecond`, `counter`, `sine`).
- **Điều khiển** `POST http://127.0.0.1:1503/fault` với `{ unit?, fc?, from?, to?, kind, count?, delayMs?, code? }`, `kind` ∈:
  - `timeout`, `exception`, `delay`, `close`, `refuse`;
  - `bad-tid`, `bad-unit`, `bad-length`, `garbage`.
- **Đọc trạng thái:** `GET /counters`, `GET /log`; đặt giá trị: `POST /set`.
- Mã hóa riêng (TS), cùng vector `tests/modbus-vectors/frames/`. Không phụ thuộc gói npm nào.
