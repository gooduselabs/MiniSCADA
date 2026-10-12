# Data Model: Tag v1, Modbus TCP/RTU, Tag tính toán và ghi Tag có kiểm soát

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Research**: [research.md](research.md)

Feature này đổi định dạng project lên **0.2.0** (schema, luật, ví dụ đủ: [contracts/project-format-0.2.md](contracts/project-format-0.2.md)) và thêm:

- trạng thái trên BL335: giá trị Tag và lý do, trạng thái kênh và thiết bị trường, kế hoạch đọc, yêu cầu ghi, kho Tag giữ qua mất điện, chẩn đoán;
- trạng thái trong Studio: tài liệu project 0.2, lưới, phiên ghi của Bảng theo dõi, Mô phỏng, đăng ký dữ liệu sống.

Thời điểm dạng ms UTC (`…Ms`) hoặc ISO 8601 UTC (`…At`). Đồng hồ đơn điệu là `CLOCK_BOOTTIME`, chỉ dùng trong bộ nhớ.

**Thuật ngữ** như spec: **BL335** (thiết bị chạy runtime), **kênh**, **thiết bị trường**, **Tag ngoài / nội bộ / tính toán / mô phỏng**.

## 1. Tag v1 (`tags.json`)

**Trường chung:**

| Trường | Kiểu | Bắt buộc | Ràng buộc |
|---|---|---|---|
| `id` | chuỗi ≤ 64 | có | `^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$` (như 0.1); duy nhất |
| `kind` | `external` \| `internal` \| `calculated` \| `simulation` | có | |
| `type` | 10 kiểu của 0.1 | có | kiểu **giá trị** của Tag |
| `description` | chuỗi ≤ 200 | | |
| `unit` | chuỗi ≤ 16 | | |
| `min`, `max` | số | | khoảng hiển thị (như 0.1); chỉ Tag số; `min < max` |
| `access` | `R` \| `RW` | | mặc định `R` (D14); `calculated` luôn `R` |
| `limits` | `{ min?, max? }` (Tag số) hoặc `{ maxLength? }` (STRING) | | giới hạn nhập khi ghi; `min ≤ max` |
| `valueTable` | tên bảng giá trị | | phải tồn tại |
| `deadband` | số ≥ 0 | | chỉ Tag số; đơn vị kỹ thuật |
| `sim` | cấu hình mô phỏng (§5) | `simulation`: có | không dùng cho `calculated` |

**Theo loại:**

| Loại | Trường thêm |
|---|---|
| `external` | `source` (bảng dưới); `scaling` (tùy chọn) |
| `internal` | `initial` (mặc định `0`, `false` hoặc `""`); `retain` (mặc định `false`) |
| `calculated` | `expression` (chuỗi ≤ 1.000 ký tự, ≤ 4.096 byte) |
| `simulation` | `sim` bắt buộc; `RW` chỉ khi `sim.kind = manual` |

**`source` của Tag ngoài:**

| Trường | Ý nghĩa | Mặc định |
|---|---|---|
| `device` | id thiết bị trường (duy nhất trong project) | bắt buộc |
| `address` | địa chỉ Modbus: `HR100`, `IR5`, `C12`, `DI0`, `HR100.3` (bit), `40101`, `400101` | bắt buộc |
| `scanGroup` | `fast` \| `normal` \| `slow` | `normal` |
| `rawType` | kiểu trên thiết bị trường | bằng `type` |
| `byteOrder` | `ABCD` \| `CDAB` \| `BADC` \| `DCBA`, chỉ cho kiểu 32 và 64 bit | của thiết bị trường |
| `stringLength` | số byte của STRING: 1–250 (≤ 125 thanh ghi, vừa một lần đọc); Tag `RW` ≤ 246 (123 thanh ghi, giới hạn của mã 16) | bắt buộc với STRING |
| `stringByteOrder` | `AB` \| `BA` | `AB` |
| `readback` | đọc lại sau khi ghi | `true` (D15) |

**`scaling`** (chỉ Tag số): `{ rawMin, rawMax, engMin, engMax, clamp? }`, `rawMin ≠ rawMax`, `engMin ≠ engMax`, `clamp` mặc định `false`. Có `scaling` thì `type` ∈ {`FLOAT32`, `FLOAT64`} và `rawType` là kiểu số (research R2).

**Số thanh ghi Tag chiếm:** BOOL ở coil/DI là 1 bit; bit trong thanh ghi là 1 thanh ghi; 16 bit là 1; 32 bit là 2; 64 bit là 4; STRING là ⌈`stringLength`/2⌉.

**Vùng và quyền:**

| Vùng | Kiểu được | RW được | Mã hàm đọc / ghi |
|---|---|---|---|
| `C` coil | BOOL | có | 01 / 05 hoặc 15 |
| `DI` discrete input | BOOL | không | 02 / — |
| `IR` input register | số, STRING, bit | không | 04 / — |
| `HR` holding register | số, STRING, bit | có (bit cần cách ghi bit của thiết bị trường) | 03 / 06 hoặc 16; bit: 22 hoặc đọc-sửa-ghi |

**Định dạng ghi của Studio:** mỗi Tag một dòng JSON gọn; khóa theo thứ tự `id, kind, type, description, unit, min, max, access, limits, valueTable, deadband, source, scaling, initial, retain, expression, sim`; không ghi trường bằng mặc định (research R2).

## 2. Kênh, thiết bị trường, nhóm quét (`connections.json`)

```json
{
  "schemaVersion": "0.2.0",
  "scanGroups": { "fast": 250, "normal": 1000, "slow": 5000 },
  "channels": [ { "id": "plc1", "name": "PLC trạm bơm", "kind": "modbus-tcp", "enabled": true,
                  "tcp": { "host": "192.168.10.5", "port": 502 }, "devices": [ … ] } ]
}
```

**Nhóm quét** (FR-017): chu kỳ ms trong 100–60.000; mặc định 250, 1.000, 5.000.

**Kênh:**

| Trường | Modbus TCP | Modbus RTU | Mặc định, ràng buộc |
|---|---|---|---|
| `id` | ✓ | ✓ | `^[a-z0-9][a-z0-9-]{0,31}$`, duy nhất |
| `name` | ✓ | ✓ | ≤ 64 |
| `kind` | `modbus-tcp` | `modbus-rtu` | |
| `enabled` | ✓ | ✓ | `true` |
| `tcp.host` | IPv4 hoặc tên máy ≤ 253 | | bắt buộc |
| `tcp.port` | 1–65535 | | 502 |
| `tcp.connectTimeoutMs` | 500–30.000 | | 3.000 |
| `tcp.reconnectMaxS` | 1–60 | | 10 |
| `serial.port` | | `ttyXXXn`, `/dev/serial/by-id/…` hoặc `/dev/serial/by-path/…` | bắt buộc; một cổng một kênh |
| `serial.baud` | | 1.200–115.200 (tốc độ chuẩn) | 9.600 |
| `serial.dataBits` | | 7 \| 8 | 8 |
| `serial.parity` | | `none` \| `even` \| `odd` | `even` |
| `serial.stopBits` | | 1 \| 2 | 1 |
| `serial.rs485` | | bật chế độ RS485 của kernel | `true` |
| `serial.dropEcho` | | bỏ phần vọng lại | `false` |
| `serial.silenceMs` | | khoảng lặng giữa hai khung | vắng: tính theo tốc độ (t3.5) |
| `requestGapMs` | ✓ | ✓ | 0 (0–1.000) |
| `devices` | ✓ | ✓ | 1–32 |

**Thiết bị trường:**

| Trường | Ý nghĩa | Mặc định |
|---|---|---|
| `id`, `name` | id duy nhất trong project (Tag tham chiếu bằng id này) | |
| `unitId` (TCP) / `slave` (RTU) | 0–255 / 1–247; không có ghi broadcast (D31) | 1 |
| `enabled` | | `true` |
| `addressBase` | 0 \| 1: số trong địa chỉ trừ đi giá trị này ra offset gửi đi | 0 |
| `maxReadRegisters`, `maxReadBits` | giới hạn mỗi lần đọc | 125, 2.000 |
| `maxGapRegisters`, `maxGapBits` | khoảng trống tối đa để gộp | 10, 64 |
| `byteOrder` | thứ tự mặc định cho kiểu 32/64 bit | `ABCD` |
| `timeoutMs` | 100–10.000 | 1.000 |
| `retries` | 0–5, chỉ cho đọc | TCP 0, RTU 1 |
| `writeDeadlineMs` | thời hạn ghi trong hàng đợi | 5.000 |
| `write.singleRegister` | `fc06` \| `fc16` | `fc06` |
| `write.singleCoil` | `fc05` \| `fc15` | `fc05` |
| `write.registerBit` | `none` \| `mask` (mã 22) \| `rmw` (đọc-sửa-ghi) | `none` (D17) |

**Trạng thái khi chạy** (FR-029):

```text
Kênh TCP:     disabled | connecting ──kết nối được──▶ connected ──lỗi──▶ error ──chờ backoff──▶ connecting
Kênh RTU:     disabled | opening ──mở được──▶ connected | error (cổng bận, console, không cho phép, I/O)
Thiết bị trường:
  active ──3 lần liên tiếp không có trả lời hợp lệ (RTU)──▶ suspended ──hỏi thử mỗi 10 s, có trả lời──▶ active
  active ──0A/0B, kênh lỗi──▶ error ──đọc được──▶ active
  disabled (trong project)
```

## 3. Bảng giá trị (`value-tables/<tên>.json`)

| Trường | Ràng buộc |
|---|---|
| `name` | `^[A-Za-z][A-Za-z0-9_]{0,63}$`; bằng tên file; duy nhất, không phân biệt hoa thường (tên file trên Windows) |
| `description` | ≤ 200 |
| `entries[]` | 0–256 mục; mỗi mục **một trong hai**: `value` (số hoặc BOOL) hoặc `from` và/hoặc `to` (số, nửa mở `from ≤ x < to`) |
| `entries[].text` | ≤ 64 ký tự Unicode |
| `entries[].color` | `#RRGGBB`, tùy chọn |
| `default` | `{ text?, color? }`, tùy chọn |

- BOOL coi là 1/0 khi so (`true` và `1` là trùng).
- Các mục không được chồng nhau (`E_VT_OVERLAP`).
- Tra: khớp một mục, hoặc `default`, hoặc chữ rỗng không màu.
- Ngữ nghĩa và vector: [contracts/value-tables-simulation.md](contracts/value-tables-simulation.md) §1.

## 4. Bảng theo dõi (`watch-tables/<id>.json`)

| Trường | Ràng buộc |
|---|---|
| `id` | `^[a-z0-9][a-z0-9-]{0,47}$`; bằng tên file |
| `name` | ≤ 80, ví dụ "Vận hành" |
| `rows[]` | ≤ 200 |
| `rows[].tag` | id Tag; Tag không có là cảnh báo `W_WATCH_REF` |
| `rows[].format` | `auto` \| `dec` \| `hex` \| `bin` \| `bool`; mặc định `auto` |
| `rows[].decimals` | 0–9, tùy chọn |
| `rows[].writeValue` | chuỗi đã gõ (dấu chấm thập phân), tùy chọn; không tự ghi khi mở |

Runtime chỉ kiểm, không dùng khi chạy (FR-050, D22).

## 5. Cấu hình mô phỏng (`sim`)

| `kind` | Tham số | Kiểu Tag dùng được |
|---|---|---|
| `const` | `value` | mọi kiểu |
| `ramp` | `from`, `to`, `periodMs` | số |
| `sine` | `center`, `amplitude`, `periodMs`, `phase` (0–1, mặc định 0) | số |
| `random` | `min` < `max`, `periodMs`, `seed` (0–4.294.967.295, mặc định 1) | số, BOOL |
| `square` | `periodMs`, `duty` (0–1, mặc định 0,5) | BOOL, số (1/0) |
| `manual` | `initial` | mọi kiểu; cho phép `RW` |
| `legacy` | `signal` (`^[a-z][a-z0-9_.]{0,63}$`) | như Tag mock của 0.1; chỉ sinh ra khi nâng cấp |

`periodMs` là số nguyên 100–86.400.000. Công thức: [contracts/value-tables-simulation.md](contracts/value-tables-simulation.md) §2.

## 6. Giá trị Tag khi chạy (`TagValue`, BL335)

`TagStore` của Sprint 1 thêm `reason`:

| Trường | Ghi chú |
|---|---|
| `value` | `TagScalar` như hiện nay (`bool`, `int64`, `uint64`, `double`, `string`, rỗng) |
| `quality` | `GOOD` \| `UNCERTAIN` \| `BAD` |
| `reason` | mã lý do; rỗng khi GOOD |
| `sourceTs`, `serverTs`, `revision` | như hiện nay |

**Danh mục mã lý do** (dùng ở giao thức live 1.2.0, chẩn đoán, Studio dịch sang tiếng Việt):

| Nhóm | Mã | Quality |
|---|---|---|
| Chung | `NO_VALUE` (chưa có giá trị), `DISABLED` (kênh hoặc thiết bị trường tắt) | BAD |
| Kết nối | `DISCONNECTED`, `TIMEOUT`, `REFUSED`, `PORT_BUSY`, `PORT_NOT_ALLOWED`, `DEVICE_SUSPENDED` | BAD |
| Thiết bị trường | `EXCEPTION_01` … `EXCEPTION_0B`, `EXCEPTION_OTHER` | BAD |
| Khung | `BAD_FRAME` (CRC, độ dài, định dạng) | BAD |
| Giá trị | `INVALID_VALUE` (NaN, vô cực từ thiết bị trường) | BAD |
| | `CLAMPED` (đã giới hạn theo scaling) | UNCERTAIN |
| Tag tính toán | `INPUT_BAD`, `DIV_ZERO`, `MOD_ZERO`, `OVERFLOW`, `NOT_A_NUMBER`, `OUT_OF_RANGE`, `CLAMP_RANGE` | BAD |
| | (đầu vào UNCERTAIN) | UNCERTAIN, lý do của đầu vào |
| Tag giữ qua mất điện | `RETAIN_LOST` (bản lưu không đọc được, dùng giá trị đầu) | UNCERTAIN |
| Tag mô phỏng | `NO_SIGNAL` (`legacy` với tín hiệu lạ, như runtime 0.4) | BAD |

- Chuyển BAD giữ giá trị cuối (FR-010).
- Đổi quality hoặc đổi lý do luôn được phát (FR-012).

## 7. Kế hoạch đọc và chẩn đoán (BL335, trong bộ nhớ)

**Kế hoạch đọc** (`ScanPlan`, dựng lúc nạp project, theo từng thiết bị trường):

| Thực thể | Trường |
|---|---|
| `ReadBlock` | vùng, offset đầu, số lượng, nhóm quét, danh sách (Tag, vị trí trong khối), đã tách hay chưa |
| `GroupRound` | (thiết bị trường, nhóm quét): khối, `nextDueMono`, thời điểm bắt đầu vòng trước, chu kỳ thực (trung bình, lớn nhất trong 60 s), số lần quá tải |

Tách khi exception 02/03 thay một `ReadBlock` bằng hai khối con. Kế hoạch đã tách giữ tới khi kết nối lại hoặc đổi project (FR-025).

**Chẩn đoán** (FR-029; JSON ở [contracts/device-api-1.1.md](contracts/device-api-1.1.md) §5). Số đếm từ lúc runtime chạy, không đặt lại (D28):

- **kênh:** trạng thái, lỗi gần nhất và thời điểm, số lần kết nối lại, cảnh báo (`RS485_UNSUPPORTED`…);
- **thiết bị trường:** trạng thái; yêu cầu thành công; hết thời gian chờ; exception theo mã; khung hỏng theo loại (`crc`, `format`, `tid`, `unit`, `length`, `echo`); thời gian trả lời trung bình và lớn nhất; theo nhóm quét: chu kỳ đặt, chu kỳ thực, quá tải; lệnh ghi theo kết quả;
- **Tag xấu:** id, quality, lý do, thời điểm cập nhật cuối (tối đa 500 dòng, xấu mới nhất trước).

## 8. Yêu cầu ghi (`WriteRequest`, BL335)

| Trường | Ghi chú |
|---|---|
| `requestId` | UUID v4 do Studio sinh |
| `user`, `role`, `source` | từ phiên; kết quả ghi audit dưới tài khoản này kể cả khi phiên đã hết hạn |
| `tag`, `kind`, `channel`, `device` | |
| `value` | giá trị kỹ thuật đã kiểm; `raw` sau scaling (nếu có) |
| `old` | `{ value, quality }` lúc nhận (FR-039) |
| `receivedMono`, `receivedAt`, `clockOk` | |
| `status` | `REJECTED` \| `ACCEPTED` \| `TIMEOUT` \| `FAILED` \| `CONFIRMED` |
| `code` | mã chi tiết (bảng dưới) |
| `readback` | giá trị đọc lại (khi có) |
| `exception` | mã exception (khi có) |
| `startedAuditId`, `resultAuditId` | id bản ghi audit |

**Máy trạng thái:**

```text
nhận ─▶ kiểm 1–8 (FR-037) ──không đạt──▶ REJECTED (cuối)
          │ đạt (ghi bền audit "started" + tag_write_request)
          ▼
       ACCEPTED ──Tag nội bộ / mô phỏng nhập tay: engine áp ở lượt sau──▶ CONFIRMED (APPLIED)
          │ Tag ngoài: vào hàng đợi của kênh (FIFO, trước yêu cầu đọc)
          ├──mất kết nối / quá writeDeadlineMs / đổi project, khi chưa gửi──▶ FAILED (NOT_SENT_*)
          ▼
        SENT ──không trả lời──▶ TIMEOUT (WRITE_TIMEOUT)
          ├──exception──▶ FAILED (DEVICE_EXCEPTION)
          ├──trả lời đúng, readback=false──▶ CONFIRMED (NO_READBACK)
          ▼ readback=true: đọc ngay, ưu tiên
       READBACK ──khớp thô──▶ CONFIRMED
          ├──khác──▶ FAILED (READBACK_MISMATCH, kèm giá trị đọc được)
          ├──exception──▶ FAILED (READBACK_ERROR)
          └──không trả lời──▶ TIMEOUT (READBACK_TIMEOUT)
runtime dừng giữa chừng ──khởi động lại──▶ audit "interrupted" (UNKNOWN_OUTCOME), không gửi lại
```

- `SENT` và `READBACK` là trạng thái trong; API báo chúng là `ACCEPTED` kèm `phase`.
- Ghi bit kiểu đọc-sửa-ghi thêm bước đọc trước `SENT`. Đọc đó lỗi thì `FAILED` `NOT_SENT_READ_FAILED`.

**Mã của `REJECTED`** (theo thứ tự kiểm FR-037):

| Bước | Mã |
|---|---|
| 1 | `AUTH_REQUIRED`, `SESSION_EXPIRED`, `SESSION_INVALID`, `FORBIDDEN`, `HTTPS_REQUIRED` |
| 2 | `NO_SUCH_TAG`, `READ_ONLY` |
| 3 | `BAD_TYPE`, `NOT_FINITE` |
| 4 | `OUT_OF_LIMITS`, `OUT_OF_TYPE_RANGE`, `OUT_OF_RAW_RANGE`, `STRING_TOO_LONG` |
| 5 | `CONNECTION_BAD`, `DEVICE_NOT_ACTIVE`, `DISABLED` |
| 6 | `RATE_LIMITED` (kèm `retryAfterMs`), `QUEUE_FULL` |
| 7 | `PROJECT_CHANGING` |
| 8 | `AUDIT_UNAVAILABLE` |
| khác | `REQUEST_ID_CONFLICT`, `LIVE_WRITE_NOT_ALLOWED` (chỉ trong audit) |

**Bộ nhớ của bộ điều phối ghi:**

- mã yêu cầu đã `ACCEPTED`: bảng `tag_write_request` (§9), ≥ 15 phút;
- mã bị `REJECTED`: LRU 1.024 trong RAM, 10 phút;
- kết quả để Studio hỏi: 15 phút, tối đa 1.024 yêu cầu;
- token bucket theo phiên (khóa là băm token) và toàn BL335.

## 9. Audit ghi Tag (`audit.db` của 005)

**Danh mục action thêm** (nối vào cuối `AuditAction` của 005):

| `action` | `result` | `code` | Gộp 60 s |
|---|---|---|---|
| `tag.write` | `started` | `ACCEPTED` | không |
| | `ok` | `CONFIRMED`, `NO_READBACK`, `APPLIED` | không |
| | `failed` | `WRITE_TIMEOUT`, `READBACK_TIMEOUT`, `DEVICE_EXCEPTION`, `READBACK_MISMATCH`, `READBACK_ERROR`, `NOT_SENT_*` | không |
| | `denied` | mã `REJECTED` (§8) | **có** (`auditLimited`) |
| | `interrupted` | `UNKNOWN_OUTCOME` | không |
| `driver.test` | `ok` \| `failed` \| `denied` | mã kết quả của Thử kết nối | `denied`: có |

- `target`: id Tag (với `driver.test`: id kênh hoặc `host:cổng`).
- `detail` (JSON ≤ 1 KiB, không có bí mật): `requestId`, `kind`, `channel`, `device`, `old`, `new`, `raw`, `readback`, `exception`, `phase`, `duplicateCount`.

**Bảng mới** (`user_version` của `audit.db` 1 → 2):

```sql
CREATE TABLE IF NOT EXISTS tag_write_request(
  request_id TEXT PRIMARY KEY,     -- UUID v4, chữ thường
  started_id INTEGER NOT NULL,     -- id bản ghi audit "started"
  result_id INTEGER,               -- id bản ghi kết quả; NULL: chưa có kết quả
  ts_ms INTEGER NOT NULL,          -- lúc nhận (UTC ms, có thể sai khi giờ chưa đồng bộ)
  boot TEXT NOT NULL               -- boot_id của kernel (/proc/sys/kernel/random/boot_id) lúc nhận
) WITHOUT ROWID;
```

- **Giao dịch 1** (FULL, trước khi gửi): chèn bản ghi `started`, chèn dòng.
- **Giao dịch 2** (FULL, luồng audit kết quả): chèn bản ghi kết quả, gán `result_id`.
- **Dọn** mỗi 10 phút, một giao dịch: xóa dòng đã có kết quả **và** đã qua ≥ 15 phút thời gian chạy. Dòng của lần khởi động trước (`boot` khác) chỉ xóa sau khi lần chạy hiện tại đã qua 15 phút, để giờ sai sau mất điện không làm xóa sớm. Giữ tối đa 4.096 dòng.
- **Khởi động:** dòng `result_id IS NULL` nhận bản ghi `interrupted` (§8) trước khi nhận lệnh ghi nào.

## 10. Kho Tag giữ qua mất điện (`<dataDir>/retain/`)

| File | Nội dung |
|---|---|
| `retain-a.bin`, `retain-b.bin` | mỗi file 512 KiB, cấp sẵn; phần đầu 64 byte + chuỗi bản ghi |
| `retain-*.corrupt-<thời điểm>` | bản hỏng giữ lại để điều tra, tối đa 3 bộ |

**Phần đầu** (little-endian): magic `MATRET01` (8 byte), phiên bản định dạng u16 (= 1), dự phòng u16, thế hệ u64, độ dài ảnh chụp u32, dự phòng (36 byte 0), CRC32 của 60 byte trước (u32).

**Bản ghi:** độ dài u32 (gồm cả CRC), số thứ tự u64, cờ u8 (1 = ảnh chụp, 0 = thay đổi), số mục u16, các mục, CRC32 u32.

**Mục:** độ dài id u8, id (UTF-8), mã kiểu u8 (thứ tự 10 kiểu của `TagType`), giá trị (BOOL 1 byte; số nguyên 8 byte; FLOAT32 4 byte; FLOAT64 8 byte; STRING: độ dài u16 + byte, ≤ 256).

**Bất biến:**

- chỉ ghi vào vùng sau bản ghi hợp lệ cuối của file đang dùng, hoặc vào file kia khi nén lại;
- phần đầu của file mới chỉ ghi sau khi thân đã `fdatasync`;
- khi phát lại, mục của Tag không còn (khác id, khác `type`, bỏ `retain`) bị bỏ qua và kích hoạt nén lại.

```text
khởi động ─▶ đọc 2 phần đầu ─▶ chọn thế hệ hợp lệ cao nhất ─▶ phát lại tới bản ghi hỏng đầu tiên ─▶ chạy
             cả hai hỏng ─▶ đổi tên *.corrupt-*, tạo mới, Tag RETAIN_LOST (UNCERTAIN), chẩn đoán báo
chạy: Tag giữ qua mất điện đổi ─▶ chờ đủ cửa sổ (retainWindowS) ─▶ pwrite bản ghi thay đổi + fdatasync
       file gần đầy ─▶ ghi ảnh chụp sang file kia (thân, fdatasync, phần đầu thế hệ+1, fdatasync)
```

## 11. Cổng serial (`SerialPortInfo`, BL335 báo)

| Trường | Ghi chú |
|---|---|
| `name` | `ttyAS2` |
| `path`, `byId` | `/dev/ttyAS2`; `/dev/serial/by-id/…` nếu có |
| `kind` | `onboard` \| `usb` \| `unknown` |
| `driver` | tên driver kernel (`sunxi-uart`, `ftdi_sio`, `option`…) |
| `usb` | `{ vid, pid, product?, serial? }` với cổng USB |
| `allowed` | có trong `serialPorts` của BL335 |
| `inUse` | `{ by: "console" \| "getty" \| "channel" \| "lock", detail }` hoặc `null` |
| `rs485` | `enabled` \| `supported` \| `unsupported` \| `unknown` |

## 12. Bản sao lưu khi nâng cấp (Studio)

`<project>/.mat-backup/<schemaVersion gốc>-<UTC yyyyMMddTHHmmssZ>/` chứa đúng tập file của project 0.1, giữ đường dẫn tương đối, cộng `backup.json`:

```json
{ "from": "0.1.0", "to": "0.2.0", "createdAt": "2026-10-20T03:00:00Z", "generator": "mAT Studio 0.4.0",
  "files": [ { "path": "tags.json", "sha256": "…" } ] }
```

Không bao giờ ghi đè thư mục đã có; không thuộc tập file của project (không vào gói, không vào digest).

## 13. Studio

### 13.1 Tài liệu project 0.2

Mô hình tài liệu của 004 (§3 data-model của 004) và phần "nội dung chờ ghi" của 005 mở rộng thêm:

- **Tài liệu sửa được theo đối tượng:** `project.json`, `tags.json`, `connections.json`, `value-tables/*.json`, `watch-tables/*.json`. Các file mới tạo khi có nội dung đầu tiên; bảng bị xóa thì file bị xóa khi lưu (lệnh `project_remove`).
- **Sửa đổi mới** (`ProjectEdit`):
  - `tagUpsert`, `tagRemove`, `tagField` mở rộng cho trường v1;
  - `channelUpsert`, `channelRemove`, `deviceUpsert`, `deviceRemove`, `scanGroups`;
  - `valueTableUpsert`, `valueTableRemove`, `valueTableRename`;
  - `watchTableUpsert`, `watchTableRemove`;
  - `batch` (gộp nhiều sửa đổi thành một bước hoàn tác: dán, điền, nhập CSV, thêm hàng loạt, đổi tên Tag).
- **Chế độ chỉ đọc** cho project 0.1 không nâng cấp (FR-003): mọi lệnh sửa bị khóa kèm lý do.

### 13.2 Lưới (`GridModel`)

`grid-model.ts` của 004 thành mô hình chung theo `GridAdapter` (cột, đọc ô, đổi chữ thành giá trị, tạo dòng mới, lỗi theo ô). Thêm:

| Trạng thái | Ghi chú |
|---|---|
| `anchor`, `cell` | vùng chọn là hình chữ nhật từ `anchor` tới `cell` (Shift+mũi tên, kéo chuột) |
| `editing` | `{ row, column, original, text, origin: "typed" \| "f2" \| "dblclick" }` |
| `ime` | `idle` \| `composing` \| `cancelPending` |
| `filter` | theo cột: chuỗi chứa (bỏ dấu), so sánh số; cộng ô tìm |
| `sort` | cột, chiều |
| `viewport` | dòng đầu, số dòng hiện (đẩy cho đăng ký dữ liệu sống) |

**Máy trạng thái của ô nhập (bộ gõ):**

```text
di chuyển (ô nhập rỗng, trong suốt)
  ──keydown mũi tên/Tab/Enter/F2/Delete/Ctrl+…──▶ xử lý của lưới (preventDefault)
  ──keydown "Process" (bộ gõ)──▶ không chặn
  ──compositionstart──▶ sửa (origin typed), ime = composing   [không đổi focus, không gán value]
  ──beforeinput/input có chữ──▶ sửa (origin typed), giữ chữ đã vào ô nhập
sửa
  ──compositionend──▶ ime = idle (nếu cancelPending: hủy sửa, trả nội dung cũ)
  ──Esc khi composing──▶ ime = cancelPending
  ──Esc khi idle──▶ hủy sửa ─▶ di chuyển
  ──Enter/Tab khi idle──▶ xác nhận (một sửa đổi) ─▶ di chuyển, ô nhập về rỗng và trong suốt
```

### 13.3 Ghi từ Bảng theo dõi (`WriteFlow`)

Mỗi dòng có `writeState`:

```text
idle ──Ghi + xác nhận──▶ sending ──200 ACCEPTED──▶ accepted (hỏi mỗi 200 ms) ──▶ confirmed | failed | timeout
                          ├──200 REJECTED──▶ rejected (lý do)
                          ├──mất mạng──▶ unknown (hỏi lại theo mã khi có mạng; không gửi lại)
                          └──401 SESSION_EXPIRED──▶ relogin ─▶ idle (phải xác nhận lại, US2-11)
```

Hộp xác nhận lấy định nghĩa Tag từ `GET /api/v1/projects/active` của BL335 và liệt kê khác biệt với project trên máy (FR-050).

### 13.4 Mô phỏng (`SimEngine`)

- **Nguồn giá trị theo loại Tag:** Tag có `sim` chạy theo `sim`; Tag ngoài chưa có `sim` dùng mặc định của research R18; Tag nội bộ là `initial`; Tag tính toán tính bằng `@mat/expression` theo thứ tự tô-pô.
- **Lượt:** mỗi 250 ms, `t = Date.now()`. Ghi tay từ Bảng theo dõi áp ngay vào bảng ghi đè của Mô phỏng.
- **Loại trừ với Online** (D30): bật Mô phỏng khi đang Online thì hỏi rồi chuyển Offline trước; bật Online khi đang Mô phỏng thì tắt Mô phỏng.

### 13.5 Đăng ký dữ liệu sống (`LiveSubscriptions`)

Mỗi nơi cần dữ liệu khai một tập Tag kèm mức ưu tiên: Bảng theo dõi 3, xem trước màn hình 2, Bảng Tag (dòng đang hiện) 1. Hợp lại, cắt ở 1.000 Tag theo ưu tiên, gửi `subscribe` sau 300 ms yên lặng.

## 14. Cấu hình BL335 (`runtime.json`)

Khóa mới (`serialPorts`, `viewerAccess`, `retainWindowS`, `tagWrite…`) và mặc định: [contracts/device-config.md](contracts/device-config.md) §1.
