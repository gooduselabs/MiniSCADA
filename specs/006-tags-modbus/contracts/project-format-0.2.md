# Contract: định dạng project 0.2.0

**Feature**: [spec.md](../spec.md) FR-001…FR-008, FR-013–FR-015, FR-020–FR-022, FR-054 · **Data model**: [data-model.md](../data-model.md) §1–§5 · **Research**: R1–R4, R17, R18

Bổ sung cho [project-format.md của 002](../../002-vertical-slice/contracts/project-format.md) và [logging-config.md của 003](../../003-data-logging/contracts/logging-config.md). Luật của 0.1 giữ nguyên với project 0.1.x. Theo [ADR-004](../../../docs/adr/004-schema-versioning.md): thêm file và thêm trường tùy chọn là MINOR, 0.1 → 0.2.

## 1. Phiên bản và tập file

| Điều | 0.1.x | 0.2.x |
|---|---|---|
| `schemaVersion` mỗi file | mỗi file khớp `^0\.1\.\d+$` | mọi file **bằng đúng** `project.json.schemaVersion`, khớp `^0\.2\.\d+$` |
| Trộn 0.1 và 0.2 | `E_SCHEMA_VERSION` | `E_SCHEMA_VERSION` |
| `minRuntimeVersion` | như cũ | ≥ `0.5.0`, không thì `E_MIN_RUNTIME` |
| Schema dùng để kiểm | `schemas/0.1/*.schema.json` (đóng băng) | `schemas/*.schema.json` |
| Runtime nhận | 0.4.x, 0.5.x | 0.5.x |
| Studio mở để sửa | sau khi nâng cấp (§9) | có |

**Tập file của project** (`projectFiles()` ở TS, `LoadedProject::files()` ở C++; thứ tự byte UTF-8), thêm vào tập của 005:

- `connectionFile` (nếu có);
- `value-tables/<tên>.json` cho mỗi tên trong `valueTables`;
- `watch-tables/<id>.json` cho mỗi id trong `watchTables`.

Gói `.matscada` giữ định dạng 1.0.0 (luật đường dẫn, trần 1 MiB mỗi file JSON).

## 2. `project.json`

Thêm ba khóa tùy chọn:

| Khóa | Kiểu | Ràng buộc |
|---|---|---|
| `connectionFile` | chuỗi | luật đường dẫn như `tagFile`; đuôi `.json` |
| `valueTables` | mảng tên | 0–256; mỗi tên `^[A-Za-z][A-Za-z0-9_]{0,63}$`; không trùng khi không phân biệt hoa thường |
| `watchTables` | mảng id | 0–32; mỗi id `^[a-z0-9][a-z0-9-]{0,47}$`; không trùng |

```json
{
  "format": "matscada-project",
  "schemaVersion": "0.2.0",
  "projectId": "pump-station",
  "projectName": "Trạm bơm số 1",
  "projectVersion": "1.0.0",
  "minRuntimeVersion": "0.5.0",
  "entryScreen": "overview",
  "screens": ["overview"],
  "tagFile": "tags.json",
  "connectionFile": "connections.json",
  "loggingFile": "logging.json",
  "valueTables": ["TrangThaiBom"],
  "watchTables": ["van-hanh"],
  "maxClients": 10
}
```

## 3. `tags.json`: Tag v1

Trường: [data-model.md](../data-model.md) §1. Studio ghi mỗi Tag một dòng.

```json
{
  "schemaVersion": "0.2.0",
  "tags": [
    {"id":"TANK01.LEVEL","kind":"external","type":"FLOAT32","description":"Mức nước bồn","unit":"%","min":0,"max":100,"deadband":0.5,"source":{"device":"plc1","address":"HR100","rawType":"INT16"},"scaling":{"rawMin":0,"rawMax":27648,"engMin":0,"engMax":100,"clamp":true}},
    {"id":"TANK01.SP","kind":"external","type":"FLOAT32","unit":"%","access":"RW","limits":{"min":0,"max":90},"source":{"device":"plc1","address":"HR200","byteOrder":"CDAB"}},
    {"id":"PUMP01.RUN_CMD","kind":"external","type":"BOOL","access":"RW","source":{"device":"plc1","address":"C10","readback":false}},
    {"id":"PUMP01.STATE","kind":"external","type":"INT16","valueTable":"TrangThaiBom","source":{"device":"plc1","address":"HR10","scanGroup":"fast"}},
    {"id":"METER1.P","kind":"external","type":"FLOAT32","unit":"kW","source":{"device":"meter1","address":"30013"}},
    {"id":"PUMP01.FAULT","kind":"external","type":"BOOL","source":{"device":"plc1","address":"HR12.3"}},
    {"id":"PUMP01.NAME","kind":"external","type":"STRING","source":{"device":"plc1","address":"HR300","stringLength":16}},
    {"id":"TANK01.SP_HI","kind":"internal","type":"FLOAT32","unit":"%","access":"RW","limits":{"min":0,"max":100},"initial":85,"retain":true},
    {"id":"TANK01.VOLUME","kind":"calculated","type":"FLOAT32","unit":"m3","expression":"TANK01.LEVEL * 12.5"},
    {"id":"TANK01.HIGH","kind":"calculated","type":"BOOL","expression":"TANK01.LEVEL > TANK01.SP_HI"},
    {"id":"PUMP01.STATE_TEXT","kind":"calculated","type":"STRING","expression":"text(PUMP01.STATE, TrangThaiBom)"},
    {"id":"DEMO.WAVE","kind":"simulation","type":"FLOAT64","sim":{"kind":"sine","center":50,"amplitude":25,"periodMs":20000}},
    {"id":"DEMO.SET","kind":"simulation","type":"INT16","access":"RW","sim":{"kind":"manual","initial":0}}
  ]
}
```

**Địa chỉ Modbus** (FR-015). Chữ hoa; Studio tự đổi khi người dùng gõ chữ thường.

```text
address      = area-form / modicon-form
area-form    = ("C" / "DI" / "IR" / "HR") number [ "." bit ]      ; bit chỉ với IR, HR
modicon-form = ("0" / "1" / "3" / "4") (4DIGIT / 5DIGIT) [ "." bit ] ; 5 hoặc 6 chữ số; bit chỉ với 3, 4
number       = 1*5DIGIT
bit          = 1*2DIGIT                                            ; 0–15
```

- Chữ số đầu của dạng Modicon chọn vùng: 0 coil, 1 discrete input, 3 input register, 4 holding register.
- **offset gửi đi** = số − `addressBase` của thiết bị trường. Phải nằm trong 0–65535, và offset + số thanh ghi Tag chiếm ≤ 65.536.
- Ví dụ với `addressBase` 1: `HR1` và `40001` đều là mã 03, offset 0. Với `addressBase` 0: `40001` là offset 1, kèm cảnh báo `W_ADDR_MODICON_BASE0`.

## 4. `connections.json`

```json
{
  "schemaVersion": "0.2.0",
  "scanGroups": { "fast": 250, "normal": 1000, "slow": 5000 },
  "channels": [
    { "id": "plc1", "name": "PLC trạm bơm", "kind": "modbus-tcp",
      "tcp": { "host": "192.168.10.5", "port": 502 },
      "devices": [ { "id": "plc1", "name": "PLC trạm bơm", "unitId": 1, "byteOrder": "ABCD",
                     "write": { "registerBit": "mask" } } ] },
    { "id": "rs485-1", "name": "RS485 đồng hồ điện", "kind": "modbus-rtu",
      "serial": { "port": "ttyAS2", "baud": 9600, "dataBits": 8, "parity": "even", "stopBits": 1, "rs485": true },
      "devices": [ { "id": "meter1", "name": "Đồng hồ 1", "slave": 1, "addressBase": 1 },
                   { "id": "meter2", "name": "Đồng hồ 2", "slave": 2, "addressBase": 1 },
                   { "id": "meter3", "name": "Đồng hồ 3", "slave": 3, "addressBase": 1, "enabled": false } ] }
  ]
}
```

Trường và mặc định: [data-model.md](../data-model.md) §2. `unitId` chỉ với Modbus TCP; `slave` chỉ với RTU; `tcp` và `serial` theo `kind`.

## 5. `value-tables/<tên>.json`

```json
{
  "schemaVersion": "0.2.0",
  "name": "TrangThaiBom",
  "entries": [
    { "value": 0, "text": "Dừng", "color": "#808080" },
    { "value": 1, "text": "Chạy", "color": "#2E7D32" },
    { "value": 2, "text": "Lỗi", "color": "#C62828" },
    { "from": 10, "to": 20, "text": "Bảo trì" }
  ],
  "default": { "text": "Không rõ", "color": "#B26A00" }
}
```

## 6. `watch-tables/<id>.json`

```json
{
  "schemaVersion": "0.2.0",
  "id": "van-hanh",
  "name": "Vận hành",
  "rows": [
    { "tag": "TANK01.SP", "decimals": 1, "writeValue": "75" },
    { "tag": "PUMP01.STATE", "format": "dec" },
    { "tag": "PUMP01.RUN_CMD", "format": "bool", "writeValue": "true" }
  ]
}
```

## 7. Luật kiểm tra 0.2

Hai bộ kiểm tra (TS, C++) cho **cùng tập mã** trên `tests/project-vectors`. `message` có thể khác nhau. Lỗi trong biểu thức có thêm `span: [đầu, cuối)` (chỉ số ký tự Unicode trong chuỗi `expression`).

**Kiểm trước schema** như 0.1, cộng một điểm: trường `expression` được miễn trần 1.024 byte chung, có trần riêng 4.096 byte.

### 7.1 Lỗi

| Mã | Khi |
|---|---|
| `E_SCHEMA_VERSION` | §1 |
| `E_MIN_RUNTIME` | project 0.2.x có `minRuntimeVersion` < 0.5.0 |
| `E_LIMIT` | vượt D12: > 2.000 Tag, > 500 Tag tính toán, > 500 Tag giữ qua mất điện, > 16 kênh, > 64 thiết bị trường, > 32 thiết bị trường một kênh, > 256 bảng giá trị, > 256 mục một bảng, > 32 bảng theo dõi, > 200 dòng một bảng |
| `E_DUP_ID` | trùng id kênh, id thiết bị trường (toàn project), tên bảng giá trị (không phân biệt hoa thường), id bảng theo dõi; `name`/`id` trong file khác tên file |
| `E_DUP_TAG` | như 0.1 |
| `E_REF_DEVICE` | `source.device` không có |
| `E_REF_TABLE` | `valueTable` của Tag, hay `table` của binding, không có |
| `E_ADDR_SYNTAX` | địa chỉ không theo §3 |
| `E_ADDR_AREA` | vùng không hợp kiểu (BOOL ở `HR` mà không có `.bit`; số ở `C`, `DI`; `.bit` ở `C`, `DI`), hoặc vùng chỉ đọc (`DI`, `IR`) mà `RW` |
| `E_ADDR_RANGE` | offset ngoài 0–65535, hoặc Tag vượt qua 65.535 |
| `E_ADDR_READ_LIMIT` | Tag dài hơn giới hạn một lần đọc của thiết bị trường (STRING dài) |
| `E_ADDR_WRITE_LIMIT` | Tag `RW` dài hơn một lần ghi (> 123 thanh ghi) |
| `E_BIT_WRITE` | bit trong thanh ghi mà `RW`, khi `write.registerBit` của thiết bị trường là `none` |
| `E_SCALING` | `scaling` cho Tag không phải số; `rawMin = rawMax` hay `engMin = engMax`; `type` không phải FLOAT32/FLOAT64; `rawType` không phải kiểu số |
| `E_DEADBAND` | `deadband` cho Tag không phải số, hoặc âm |
| `E_LIMITS` | `limits.min/max` cho Tag không phải số; `min > max`; `maxLength` cho Tag không phải STRING; giới hạn ngoài khoảng của kiểu |
| `E_TAG_RANGE` | như 0.1 (`min`/`max` hiển thị) |
| `E_TAG_ACCESS` | Tag tính toán `RW`; Tag mô phỏng `RW` mà bộ sinh khác `manual` |
| `E_SIM` | `sim` không hợp kiểu Tag (`sine`, `ramp` cho BOOL hay STRING), tham số sai (`min ≥ max`, `duty` ngoài 0–1), `sim` trên Tag tính toán |
| `E_INITIAL` | `initial` sai kiểu, ngoài khoảng của kiểu, chuỗi > 256 byte (Tag giữ qua mất điện) hoặc > `limits.maxLength` |
| `E_RETAIN` | `retain` trên Tag không phải nội bộ |
| `E_EXPR_SYNTAX` | lỗi cú pháp ([expression-language.md](expression-language.md) §6) |
| `E_EXPR_UNKNOWN_TAG`, `E_EXPR_UNKNOWN_TABLE`, `E_EXPR_UNKNOWN_FUNC` | tên không có |
| `E_EXPR_ARITY` | sai số tham số |
| `E_EXPR_TYPE` | sai kiểu, gồm cả kết quả không gán được vào kiểu của Tag |
| `E_EXPR_CYCLE` | vòng tham chiếu giữa các Tag tính toán; báo ở **mỗi** Tag trong vòng, `message` có đường vòng (`A → B → A`) |
| `E_EXPR_DEPTH` | chuỗi phụ thuộc > 16 tầng |
| `E_EXPR_LIMIT` | > 1.000 ký tự hay > 4.096 byte, lồng > 32, > 32 Tag đầu vào |
| `E_VT_OVERLAP` | hai mục chồng nhau ([value-tables-simulation.md](value-tables-simulation.md) §1) |
| `E_VT_RANGE` | khoảng rỗng: `from ≥ to` |
| `E_VT_TEXT` | `text` > 64 ký tự Unicode (đếm theo ký tự, không theo byte) |
| `E_SERIAL_PORT` | `serial.port` không khớp `^tty[A-Za-z]{1,8}[0-9]{1,3}$`, hay `^/dev/serial/by-id/[A-Za-z0-9._:+-]{1,200}$`, hay `^/dev/serial/by-path/[A-Za-z0-9._:+-]{1,200}$` |
| `E_SERIAL_SHARED` | hai kênh dùng chung một cổng |
| `E_TYPE_MISMATCH` | như 0.1, cộng: transform `valueTable` cho Tag STRING; `output: "color"` vào đích chữ, hay `"text"` vào đích màu |

**Chỉ ở runtime** (không có trong vector chung; có test C++ riêng):

| Mã | Khi |
|---|---|
| `E_RUNTIME_TOO_OLD` | như 0.1 |
| `E_SERIAL_NOT_ALLOWED` | `serial.port` không khớp `serialPorts` của BL335 (sau khi đã loại cổng console) |

### 7.2 Cảnh báo (không chặn)

| Mã | Khi |
|---|---|
| `W_WRITE_NO_LIMITS` | Tag số `RW` không có `limits` |
| `W_DETECT_SLOW` | `timeoutMs × (retries + 1)` > chu kỳ nhóm quét của một Tag của thiết bị trường đó |
| `W_RTU_SCAN_TIME` | ước tính thời gian một vòng của nhóm quét trên kênh RTU > chu kỳ; `message` có số ms ước tính và số ms đặt |
| `W_BIT_RMW` | có Tag bit `RW` trên thiết bị trường dùng `rmw` |
| `W_EXPR_INT64` | biểu thức dùng Tag INT64/UINT64 |
| `W_WATCH_REF` | bảng theo dõi có Tag không tồn tại |
| `W_ADDR_MODICON_BASE0` | địa chỉ dạng Modicon trên thiết bị trường `addressBase` 0 |

**Ước tính thời gian quét RTU** (`W_RTU_SCAN_TIME`): mỗi yêu cầu = (byte yêu cầu + byte trả lời) × bit mỗi ký tự / tốc độ + 2 × t3.5 + 10 ms (thời gian thiết bị trường xử lý, ước tính). Cộng mọi yêu cầu (sau khi gộp) của mọi thiết bị trường trên kênh có Tag trong nhóm đó. Ví dụ US3-6: 200 thanh ghi nhóm nhanh, 9.600 8E1, hai yêu cầu (125 + 75) cho khoảng 520 ms, so với 250 ms đặt.

## 8. Binding 0.2: transform `valueTable` (FR-054)

```json
{ "id": "b-state", "target": "style.fill", "source": { "type": "tag", "tagId": "PUMP01.STATE" },
  "transform": { "kind": "valueTable", "output": "color" } }
```

- `table` tùy chọn; vắng thì dùng `valueTable` của Tag; cả hai đều vắng là `E_REF_TABLE`.
- `output: "text"` cho `text.content`; `"color"` cho `style.fill`, `style.stroke`.
- Không khớp mục nào và không có `default`: chữ rỗng; màu không áp (phần tử giữ màu gốc).
- `rangeMap`, `format`, `expression` vẫn là `E_TRANSFORM_UNSUPPORTED` (biểu thức trong binding thuộc GĐ 3b).

## 9. Nâng cấp 0.1 → 0.2 (chỉ Studio)

Hàm thuần `migrate01to02(files: Record<path, text>) → { files, changes, backup }` (`packages/project-schema/src/migrate.ts`):

1. Kiểm bản 0.1 (bộ kiểm tra 0.1). Có lỗi vẫn nâng cấp; `changes` ghi "project gốc có N lỗi".
2. `project.json`: `schemaVersion` = `"0.2.0"`; `minRuntimeVersion` = max(cũ, `"0.5.0"`). Khóa khác giữ nguyên thứ tự.
3. `tags.json`: `schemaVersion` = `"0.2.0"`. Mỗi Tag 0.1 thành:

   ```json
   {"id":"…","kind":"simulation","type":"…","description":"…","unit":"…","min":…,"max":…,"sim":{"kind":"legacy","signal":"<signal cũ>"}}
   ```

   Giữ thứ tự Tag; giữ khóa tùy chọn đang có.
4. `logging.json`, `screens/*.screen.json`, file binding: chỉ đổi `schemaVersion`.
5. Ghi lại bằng định dạng chuẩn của Studio 0.2 (Tag một dòng; file khác thụt 2 dấu cách). Cùng đầu vào cho cùng byte.
6. Kiểm bản 0.2. Có lỗi mà bản gốc không có thì không áp, trả lỗi. Lỗi đã có từ bản gốc được mang sang, không chặn (research R3).

**Cặp file mẫu:** `tests/migration-vectors/<ca>/before/…` và `after/…`; Vitest so từng byte. Ca bắt buộc:

- `tank-demo`;
- mọi ca `valid-*` của `tests/project-vectors`;
- Tag có `signal` lạ;
- Tag không có `min`/`max`;
- project không có `logging.json`;
- nhiều màn hình;
- file có BOM.

## 10. Vector

| Thư mục | Nội dung | Ai chạy |
|---|---|---|
| `tests/project-vectors/` | 82 ca 0.1 hiện có (không đổi kết luận) + ca `v02-*` | Vitest, GoogleTest |
| `tests/migration-vectors/` | cặp before/after | Vitest |
| `tests/expression-vectors/` | ≥ 300 ca ([expression-language.md](expression-language.md) §8) | Vitest, GoogleTest |
| `tests/value-table-vectors/`, `tests/sim-vectors/` | [value-tables-simulation.md](value-tables-simulation.md) §3 | Vitest, GoogleTest |
| `tests/codec-vectors/` | địa chỉ, đổi thô ↔ giá trị, scaling, chuỗi ([modbus-driver.md](modbus-driver.md) §6) | Vitest, GoogleTest |
| `tests/modbus-vectors/frames/` | khung Modbus ([modbus-driver.md](modbus-driver.md) §2–§3) | GoogleTest, giả lập Node |

`expected.json` của ca `v02-*` như 0.1 (`{ valid, errors: [mã], warnings: [mã] }`); ca hợp lệ có thêm `files` và `digest` (005).

## 11. `GET /api/v1/projects/active` với project 0.2

```json
{ "project": { … }, "tags": { … }, "screens": { … }, "digest": "sha256:…",
  "valueTables": { "TrangThaiBom": { … } },
  "connections": { "channels": [ { "id": "plc1", "name": "PLC trạm bơm", "kind": "modbus-tcp",
                                   "devices": [ { "id": "plc1", "name": "PLC trạm bơm" } ] } ] } }
```

- `valueTables`: chỉ bảng mà binding dùng tới (trực tiếp, hoặc qua `valueTable` của Tag), để trang xem không phải tải mọi bảng.
- `connections`: chỉ id, tên, loại. Không có địa chỉ IP, cổng, tham số serial.
- `watchTables` không gửi.
