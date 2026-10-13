# Contract: định dạng project 0.5.0

**Feature**: [spec.md](../spec.md) FR-001…FR-014, FR-084 · **Data model**: [data-model.md](../data-model.md) §1, §2 · **ADR**: [004](../../../docs/adr/004-schema-versioning.md)

Bổ sung cho [project-format-0.3.md của 007](../../007-screens-widgets/contracts/project-format-0.3.md). Nối tiếp định dạng 0.4 của feature 008 (GĐ 3b, [specs/008-svg-import-binding](../../008-svg-import-binding/spec.md)), vốn chỉ đổi số phiên bản và mở rộng binding/sự kiện SVG so với 0.3. Luật của 0.1 đến 0.4 giữ nguyên với project cùng phiên bản. Theo ADR-004: thêm file tùy chọn và đổi yêu cầu runtime tối thiểu là MINOR khi MAJOR = 0, kèm migration 0.4 → 0.5. Chuỗi `0.5.0` là hằng `kProjectFormatAlarms` (C++) và `PROJECT_FORMAT_ALARMS` (TS). Đã giải (D28): 3b (specs/008) dùng 0.4.0 nên feature này dùng 0.5.0; công cụ `tools/renumber-alarm-format.mjs` chỉ là phương án dự phòng nếu thứ tự phát hành đổi nữa.

## 1. Phiên bản và tập file

| Điều | 0.4.x (3b, đóng băng) | 0.5.x (feature này) |
|---|---|---|
| `schemaVersion` mỗi file | `^0\.4\.\d+$`, bằng `project.json` | `^0\.5\.\d+$`, bằng `project.json` |
| Trộn các phiên bản | `E_SCHEMA_VERSION` | `E_SCHEMA_VERSION` |
| `minRuntimeVersion` | ≥ `0.7.0` | ≥ `0.8.0`, không thì `E_MIN_RUNTIME` |
| Schema dùng để kiểm | `schemas/0.4/` (đóng băng) | `schemas/*.schema.json` |
| Runtime nhận | 0.7.x, 0.8.x | 0.8.x |
| Studio mở để sửa | sau khi nâng cấp | có (Studio 0.7.0) |

**Phạm vi thay đổi so với 0.4** (chỉ những điều dưới đây, mọi thứ khác giữ nguyên):

1. Hai file tùy chọn mới: `alarms.json` ([data-model §1](../data-model.md)) và `alarm-classes.json` ([§2](../data-model.md)).
2. `project.json`: hai khóa tùy chọn `alarmFile`, `alarmClassFile`; `navigation.alarms` (§2).
3. `minRuntimeVersion` tối thiểu `0.8.0`.
4. Danh mục widget `widgets.catalog.json` 0.4.0: thêm `alarm-list`, `alarm-count` (xem [widget-catalog.md của 007](../../007-screens-widgets/contracts/widget-catalog.md) để biết cấu trúc; bản mô tả hai widget nằm ở `contracts/ui-alarm.md`). Màn hình 0.4 không dùng hai widget này vẫn hợp lệ.
5. Mã lỗi `E_ALARM_*`, cảnh báo `W_ALARM_*` (§5).

**Tập file của project 0.5** (`projectFiles()` ở TS, `LoadedProject::files()` ở C++): như 0.4, thêm `alarmFile` và `alarmClassFile` nếu có khai. Gói `.matscada` giữ 1.0.0; luật đường dẫn và trần 1 MiB mỗi file JSON không đổi (`alarms.json` còn có trần riêng 512 KiB, `E_ALARM_COUNT`).

Project không có hai file này vẫn hợp lệ ở 0.5.0 (FR-001): không alarm, không banner, không mục menu Alarm; runtime 0.8 chạy y như project 0.4 của 3b (project 0.3 và 0.4 chạy trên runtime 0.8 như trên runtime 0.6 và 0.7 về kết quả).

## 2. `project.json`

Khác 0.4: thêm ba khóa; `navigation` mở rộng một khóa.

```json
{
  "format": "matscada-project",
  "schemaVersion": "0.5.0",
  "projectId": "pump-station",
  "projectName": "Trạm bơm số 1",
  "projectVersion": "1.3.0",
  "minRuntimeVersion": "0.8.0",
  "entryScreen": "tong-quan",
  "screens": ["tong-quan", "bon-nuoc"],
  "tagFile": "tags.json",
  "connectionFile": "connections.json",
  "alarmFile": "alarms.json",
  "alarmClassFile": "alarm-classes.json",
  "navigation": {
    "position": "left",
    "items": [
      { "label": "Tổng quan", "screen": "tong-quan", "icon": "home" },
      { "label": "Bồn nước", "screen": "bon-nuoc", "icon": "tank" }
    ],
    "alarms": true
  },
  "maxClients": 10
}
```

| Khóa | Kiểu | Ràng buộc |
|---|---|---|
| `alarmFile` | chuỗi | `.json`, 6 đến 128 ký tự, luật đường dẫn như `loggingFile`; file phải có (`E_FILE_MISSING`) |
| `alarmClassFile` | chuỗi | như trên |
| `navigation.alarms` | bool | mặc định `true`; `false` = trang không tự thêm mục "Alarm" và "Lịch sử alarm" vào menu (D26); banner không bị ảnh hưởng |

- Có `alarmFile` mà không có `alarmClassFile` (hoặc ngược lại) là hợp lệ về cấu trúc; alarm tham chiếu lớp không có thì `E_ALARM_CLASS_REF`.
- File alarm nằm trong thư mục project nhưng **không** được khai trong `project.json` thì bị bỏ qua (và Studio không bao giờ tạo file như vậy); khác với `valueTables`, không có "thư mục quét".
- Quyết định (người dùng giao toàn quyền 2026-10-11): project không có `navigation` mà có alarm: trang vẫn dựng menu chỉ gồm "Alarm" và "Lịch sử alarm" (vị trí `left`); lý do: alarm không được phụ thuộc vào việc kỹ sư có dựng menu; `navigation.alarms: false` ở project như vậy làm menu không có gì thì menu ẩn.
- `navigation` giữ nguyên các luật 0.4 (`E_NAV`); khóa lạ vẫn `E_SCHEMA`.

## 3. Ví dụ `alarms.json`

Ba loại alarm và khu vực. Ví dụ rút gọn nhưng đủ mọi khóa.

```json
{
  "schemaVersion": "0.5.0",
  "areas": [
    { "id": "bon", "name": "Bồn" },
    { "id": "bom", "name": "Bơm" },
    { "id": "ket-noi", "name": "Kết nối" }
  ],
  "alarms": [
    { "id": "TANK_B1_LEVEL", "type": "limit", "name": "Mức bồn B1", "area": "bon", "tag": "TANK01.LEVEL", "limits": { "LL": { "value": 5, "class": "major" }, "L": { "value": 15, "class": "minor" }, "H": { "value": 80, "class": "minor" }, "HH": { "value": 90, "class": "critical", "text": "{name} rất cao: {value:1} {unit} (> {limit})" } }, "deadband": 2, "onDelayMs": 3000, "offDelayMs": 3000 },
    { "id": "PUMP1_FAULT", "type": "digital", "name": "Bơm 1 lỗi", "area": "bom", "tag": "PUMP01.FAULT", "trigger": true, "class": "critical", "text": "Bơm 1 báo lỗi ({tag})", "onDelayMs": 500 },
    { "id": "PUMP1_RUNNING_OFF", "type": "digital", "name": "Bơm 1 dừng", "area": "bom", "tag": "PUMP01.RUN", "trigger": false, "class": "advisory", "enabled": false },
    { "id": "PLC1_LINK", "type": "quality", "name": "Mất kết nối PLC1", "area": "ket-noi", "device": "plc1", "class": "major", "text": "{name}: mất tín hiệu ({reason})", "onDelayMs": 5000 },
    { "id": "METER3_P_SIGNAL", "type": "quality", "name": "Mất tín hiệu đồng hồ 3", "area": "ket-noi", "tag": "METER3.P", "on": "notGood", "class": "minor" }
  ]
}
```

Khối của Studio ghi mỗi alarm **một dòng gọn** (§9); ví dụ trên theo đúng cách ghi đó. Ví dụ này cho 4 + 1 + 1 + 1 = 7 instance đang hoạt động (`TANK_B1_LEVEL.LL`, `.L`, `.H`, `.HH`, `PUMP1_FAULT`, `PLC1_LINK`, `METER3_P_SIGNAL`); `PUMP1_RUNNING_OFF` có `enabled: false` nên không tính.

**Thứ tự khóa chuẩn của một alarm:** `id`, `type`, `name`, `area`, `tag`, `device`, `trigger`, `on`, `limits` (theo thứ tự `LL`, `L`, `H`, `HH`; mỗi ngưỡng `value`, `class`, `text`), `deadband`, `class`, `text`, `onDelayMs`, `offDelayMs`, `enabled`.

## 4. Ví dụ `alarm-classes.json`

Bốn lớp mặc định của project mới (FR-076):

```json
{
  "schemaVersion": "0.5.0",
  "classes": [
    { "id": "critical", "name": "Khẩn cấp", "priority": "critical", "color": "red", "blink": true, "sound": "siren" },
    { "id": "major", "name": "Quan trọng", "priority": "major", "color": "orange", "blink": true, "sound": "double" },
    { "id": "minor", "name": "Nhỏ", "priority": "minor", "color": "amber", "sound": "beep" },
    { "id": "advisory", "name": "Lưu ý", "priority": "advisory", "color": "blue", "requiresAck": false }
  ]
}
```

Mặc định không ghi: `blink: false`, `requiresAck: true`, `ackReturn: false`, `sound: "none"`, `chatterLimit: 5`. Bảng đầy đủ của bốn lớp sau khi áp mặc định:

| `id` | `name` | `priority` | `color` | `blink` | `requiresAck` | `ackReturn` | `sound` | `chatterLimit` |
|---|---|---|---|---|---|---|---|---|
| `critical` | Khẩn cấp | `critical` | `red` | `true` | `true` | `false` | `siren` | 5 |
| `major` | Quan trọng | `major` | `orange` | `true` | `true` | `false` | `double` | 5 |
| `minor` | Nhỏ | `minor` | `amber` | `false` | `true` | `false` | `beep` | 5 |
| `advisory` | Lưu ý | `advisory` | `blue` | `false` | `false` | `false` | `none` | 5 |

Lớp do người dùng thêm (ví dụ "An toàn nước", `purple`): `{ "id": "an_toan_nuoc", "name": "An toàn nước", "priority": "major", "color": "purple", "ackReturn": true, "sound": "double" }`.

## 5. Mã lỗi và cảnh báo mới

Mã dùng chung TS (`packages/project-schema/src/codes.ts`) và C++ (`core/project-manager/`); câu `message` có thể khác. Vị trí báo: `file` (`alarms.json`, `alarm-classes.json`) cộng `path` là JSON Pointer.

### 5.1 Lỗi (chặn kích hoạt và Nạp xuống)

| Mã | Điều kiện | Vị trí báo (`path`) | Ví dụ |
|---|---|---|---|
| `E_ALARM_ID_DUP` | hai alarm cùng `id` (so sánh đúng, phân biệt hoa thường) | `/alarms/7/id` | `PUMP1_FAULT` xuất hiện hai lần |
| `E_ALARM_ID_FORMAT` | `id` không khớp `^[A-Za-z][A-Za-z0-9_]{1,47}$` (kể cả chứa `.`) | `/alarms/2/id` | `1PUMP`, `TANK.H` |
| `E_ALARM_TYPE` | `type` thiếu hoặc không thuộc `digital`, `limit`, `quality` | `/alarms/2/type` | `"type": "analog"` |
| `E_ALARM_TAG_REF` | `tag` không có trong `tags.json` | `/alarms/2/tag` | `"tag": "TANK99.LEVEL"` |
| `E_ALARM_TAG_TYPE` | kiểu Tag không hợp loại: `digital` cần BOOL hoặc số nguyên; `limit` cần số (INT, FLOAT); `quality` mọi kiểu | `/alarms/2/tag` | alarm `digital` trên Tag FLOAT hoặc STRING; `limit` trên Tag BOOL |
| `E_ALARM_DEVICE_REF` | `device` không có trong `connections.json`; hoặc `quality` có cả `tag` lẫn `device`, hoặc không có cái nào | `/alarms/4/device` | `"device": "plc9"` |
| `E_ALARM_CLASS_REF` | `class` (alarm hoặc ngưỡng) không có trong `alarm-classes.json`, hoặc có alarm mà không có lớp nào | `/alarms/0/limits/HH/class` | `"class": "khancap"` |
| `E_ALARM_AREA_REF` | `area` không có trong `areas` | `/alarms/1/area` | `"area": "kho"` |
| `E_ALARM_TRIGGER` | `digital` thiếu `trigger` hoặc không phải bool | `/alarms/1/trigger` | `"trigger": "on"` |
| `E_ALARM_ON` | `quality.on` không thuộc `bad`, `notGood` | `/alarms/4/on` | `"on": "uncertain"` |
| `E_ALARM_LIMIT_NONE` | `limit` không có `limits`, `limits` rỗng, hoặc khóa ngưỡng không thuộc `HH`, `H`, `L`, `LL` | `/alarms/0/limits` | `"limits": {}` |
| `E_ALARM_LIMIT_ORDER` | ngưỡng có mặt không thỏa `LL < L < H < HH`, hoặc `value` không hữu hạn | `/alarms/0/limits/H/value` | `H` = 90, `HH` = 80 |
| `E_ALARM_DEADBAND` | `deadband` âm, không hữu hạn, hoặc không nhỏ hơn khoảng cách tới ngưỡng kề cùng phía (`HH − H`, `H − L` cho `H`... theo từng cặp ngưỡng kề) | `/alarms/0/deadband` | `H` = 80, `HH` = 82, `deadband` = 3 |
| `E_ALARM_DELAY_RANGE` | `onDelayMs` hoặc `offDelayMs` không phải số nguyên 0 đến 86.400.000 | `/alarms/0/onDelayMs` | `-1`, `86400001`, `1.5` |
| `E_ALARM_TEXT_LEN` | `text` (alarm hoặc ngưỡng) dài hơn 200 ký tự (đếm điểm mã Unicode) | `/alarms/0/text` | 201 ký tự |
| `E_ALARM_TEXT_TOKEN` | thẻ không thuộc `{name}`, `{tag}`, `{value}`, `{value:N}` (N số nguyên 0 đến 6), `{unit}`, `{limit}`, `{limitName}`, `{area}`, `{reason}`; hoặc dấu `{` `}` không khớp | `/alarms/0/text` | `{abc}`, `{value:7}`, `{value:}` |
| `E_ALARM_FIELD` | khóa lạ ở alarm, ngưỡng, khu vực hoặc tệp; sai kiểu; `name` ngoài 1 đến 80; id hoặc `name` khu vực sai dạng; `chatterLimit` ngoài 0 đến 100 | tùy nơi | `"color": "red"` ở alarm |
| `E_ALARM_COUNT` | quá 500 instance; hoặc `alarms.json` > 512 KiB | `/alarms` | 501 instance |
| `E_ALARM_CLASS_DUP` | hai lớp cùng `id` | `/classes/3/id` | |
| `E_ALARM_CLASS_FIELD` | trường lớp sai: `id` không khớp `^[a-z][a-z0-9_]{1,31}$`, `name` ngoài 1 đến 40, `priority`, `color`, `sound` ngoài tập, kiểu bool sai, khóa lạ | `/classes/1/color` | `"color": "pink"` |
| `E_ALARM_AREA_DUP` | hai khu vực cùng `id` | `/areas/2/id` | |
| `E_ALARM_AREA_COUNT` | quá 64 khu vực | `/areas` | |
| `E_ALARM_CLASS_COUNT` | quá 16 lớp | `/classes` | |

Mã chung dùng lại: `E_SCHEMA` (sai cấu trúc ngoài các mã trên: JSON, kiểu của khóa tệp, thiếu `alarms`), `E_SCHEMA_VERSION`, `E_MIN_RUNTIME` (0.5 cần ≥ 0.8.0), `E_FILE_MISSING` (`alarmFile` hoặc `alarmClassFile` không có file), `E_PATH`.

Thứ tự kiểm khi nhiều lỗi trên cùng một alarm: theo thứ tự bảng (để cả hai bản validator ra cùng danh sách và cùng thứ tự: sắp theo `file`, `path` rồi mã).

### 5.2 Cảnh báo (không chặn, FR-013)

| Mã | Điều kiện | Vị trí báo | Ví dụ |
|---|---|---|---|
| `W_ALARM_COUNT_HIGH` | tổng instance > 200 (mức nghiệm thu là 200) | `/alarms` | 260 instance |
| `W_ALARM_NO_ACK_CRITICAL` | lớp có `priority: "critical"` mà `requiresAck` = `false` | `/classes/0/requiresAck` | |
| `W_ALARM_CHATTER_RISK` | alarm `limit` có `deadband` = 0 và cả `onDelayMs`, `offDelayMs` bằng 0 | `/alarms/0` | `deadband` bỏ trống, không trễ |
| `W_ALARM_DEVICE_EMPTY` | alarm `quality` có `device` mà thiết bị không có Tag đọc nào (alarm không bao giờ bật) | `/alarms/4/device` | thiết bị chỉ có Tag tính toán |

## 6. Quy tắc kiểm chéo

- `tag` của alarm trỏ Tag bất kỳ của `tags.json` kể cả Tag tính toán, mô phỏng (D6); Tag `STRING` chỉ hợp với `quality`.
- "Tag đọc từ thiết bị X" (cho `device` và `W_ALARM_DEVICE_EMPTY`): Tag có nguồn là thiết bị trường X (006), loại trừ Tag `calculated` và `simulation`.
- Đếm instance: §3 data-model; alarm `enabled: false` không tính vào giới hạn và không tạo instance, nhưng vẫn được kiểm đầy đủ (lỗi trong alarm đang tắt vẫn là lỗi).
- Giá trị `limits.<tên>.value` ngoài `min`/`max` của Tag: không phải lỗi (không cảnh báo thêm ở 0.5).
- Đổi tên Tag (Studio): `tag` của alarm cập nhật theo (FR-082); xóa Tag đang có alarm: `E_ALARM_TAG_REF`.
- `class` của ngưỡng là bắt buộc từng ngưỡng (`E_ALARM_CLASS_REF` khi thiếu hoặc rỗng).

## 7. Nâng cấp 0.4 → 0.5 (`migrate04to05`)

Chạy trong bộ nhớ ở Studio (FR-012). Cùng đầu vào cho cùng kết quả.

**Quy tắc:**

- Mọi file JSON của project (`project.json`, `tags.json`, `connections.json`, `logging.json`, `value-tables/*`, `watch-tables/*`, `screens/*.screen.json`, `screens/*.bindings.json`): chỉ `schemaVersion` đổi từ `0.4.x` sang `0.5.0`; mọi giá trị khác giữ nguyên từng byte (sau chuẩn hóa định dạng ghi của file đó).
- `project.json`: thêm `minRuntimeVersion` = max(cũ, `0.8.0`), vì luật `E_MIN_RUNTIME` của 0.5; không thêm `alarmFile`, `alarmClassFile`, `navigation.alarms`.
- Không tạo `alarms.json` hay `alarm-classes.json` rỗng.
- Kiểm project sau nâng cấp bằng validator 0.5; có lỗi mà bản gốc không có thì không áp (`NEW_ERRORS`).
- Sao lưu: `.mat-backup/<tên>-0.4-<thời điểm>/` ngay trước lần lưu đầu (như 006, 007).
- Project 0.1 và 0.2: `migrate01to02`, `migrate02to03`, `migrate04to05` trong một lần, một thư mục sao lưu (FR-012).
- Project 0.1, 0.2 và 0.3: `migrate01to02`, `migrate02to03`, `migrate03to04` (của 3b, specs/008) rồi `migrate04to05` trong một lần, một thư mục sao lưu (FR-012); chuỗi `0.1 → 0.2 → 0.3 → 0.4 → 0.5`.

**Trước** (`project.json`, 0.4.0, rút gọn):

```json
{ "format": "matscada-project", "schemaVersion": "0.4.0", "projectId": "demo", "projectName": "Demo",
  "projectVersion": "1.0.0", "minRuntimeVersion": "0.7.0", "entryScreen": "main",
  "screens": ["main"], "tagFile": "tags.json", "maxClients": 10 }
```

**Sau** (0.5.0):

```json
{ "format": "matscada-project", "schemaVersion": "0.5.0", "projectId": "demo", "projectName": "Demo",
  "projectVersion": "1.0.0", "minRuntimeVersion": "0.8.0", "entryScreen": "main",
  "screens": ["main"], "tagFile": "tags.json", "maxClients": 10 }
```

## 8. Tương thích

| Tình huống | Kết quả |
|---|---|
| Runtime 0.8 nhận project 0.1, 0.2, 0.3, 0.4, 0.5 | chạy; 0.3 và 0.4 cho cùng kết quả như runtime 0.6 và 0.7 (FR-014, SC-015) |
| Runtime 0.8 nhận project 0.6 trở lên | từ chối cả gói: `E_SCHEMA_VERSION` |
| Runtime ≤ 0.7 nhận project 0.5 | từ chối (`E_MIN_RUNTIME`/`E_SCHEMA_VERSION`); Studio chặn trước ở dòng "Tương thích runtime": "cần runtime ≥ 0.8.0" (FR-014) |
| Studio 0.7 mở project 0.1 đến 0.4 | hỏi Nâng cấp (§7), hoặc Mở chỉ đọc |
| Studio 0.7 mở project 0.6 trở lên | từ chối mở (như 006 FR-005) |
| Studio ≤ 0.6 mở project 0.5 | từ chối mở (phiên bản mới hơn) |
| Project 0.5 không có file alarm, nạp xuống runtime 0.7 | vẫn bị chặn: `minRuntimeVersion` 0.8.0 (đã chấp nhận ở FR-001) |
| Live | project 0.5 không phụ thuộc live 1.3.0 để chạy Tag; chỉ alarm cần |
| `schemas/protocol-version.json` | `{ "live": "1.3.0", "project": ["0.1", "0.2", "0.3", "0.4", "0.5"] }` |

## 9. Cập nhật `schemas/`

- **Đóng băng 0.4:** tạo `schemas/0.4/` bằng cách chép nguyên các `*.schema.json` và `widgets.catalog.json` hiện ở gốc `schemas/` (project, screen, tag, binding, connections, logging, value-table, watch-table, package-manifest nếu có), giữ `$id` `…/0.4.json` (bản 0.4 của 3b; 3b đã đóng băng `schemas/0.3/`); validator đường 0.4 trỏ vào đây (cùng cách `schemas/0.1/`, `schemas/0.2/`).
- **Gốc `schemas/` thành 0.5:** đổi `$id` và `title` các file sang 0.5; `project.schema.json` thêm `alarmFile`, `alarmClassFile` (kiểu như `loggingFile`) và `navigation.alarms` (bool); không đổi các schema còn lại ngoài `$id`.
- **File mới:** `schemas/alarms.schema.json` (`$id` `https://schemas.atpro.com.vn/mat/alarms/0.5.json`, `additionalProperties: false` ở mọi cấp, `oneOf` theo `type`; luật chéo giữa file ở validator, như `logging`) và `schemas/alarm-classes.schema.json` (`…/alarm-classes/0.5.json`).
- **`schemas/widgets.catalog.json`:** `catalogVersion` 0.4.0, thêm hai widget (FR-068).
- **`schemas/protocol-version.json`:** như §8.
- **`schemas/README.md`:** thêm mục 0.5 và dòng đóng băng 0.4.
- **TS** (`packages/project-schema/src/`): `types-05.ts`, `format-05.ts` (nạp, ghi ổn định, `projectFiles`), `rules-05.ts` (luật chung 0.5), `alarm-rules.ts` (luật `E_ALARM_*`, `W_ALARM_*`), `migrate.ts` thêm `migrate04to05`.
- **C++:** `core/project-manager/project_validator.*` (hằng `kProjectFormatAlarms`, nhận 0.5) và `core/project-manager/alarm_rules.{hpp,cpp}`.
- Bộ test lint: không còn schema nào ở gốc mang `$id` 0.4.

## 10. Định dạng ghi của Studio (FR-084)

- `alarms.json`: thụt 2 dấu cách ở cấp tệp; `areas` mỗi khu vực một dòng gọn; `alarms` **mỗi alarm một dòng gọn** theo thứ tự khóa chuẩn (§3); thứ tự mảng là thứ tự người dùng sắp.
- `alarm-classes.json`: mỗi lớp một dòng gọn; thứ tự khóa: `id`, `name`, `priority`, `color`, `blink`, `requiresAck`, `ackReturn`, `sound`, `chatterLimit`.
- Không ghi trường bằng mặc định: `enabled: true`, `onDelayMs: 0`, `offDelayMs: 0`, `deadband: 0`, `on: "bad"`, `blink: false`, `requiresAck: true`, `ackReturn: false`, `sound: "none"`, `chatterLimit: 5`, `navigation.alarms: true`.
- Cùng đầu vào cho cùng byte; kết thúc bằng một dòng trống; UTF-8 không BOM.
- Tab So sánh (FR-083) so alarm và lớp theo `id`, không theo dòng JSON.

## 11. Vector `tests/project-vectors/v05-*` (≥ 60 ca, mục tiêu 78)

Mỗi mã ở §5 có một ca sai và, khi có nghĩa, một ca đúng ngay ngoài biên. Cả hai validator (TS, C++) đọc cùng thư mục và phải cho cùng danh sách `(mã, file, path)`.

| Nhóm | Số ca | Ca ví dụ |
|---|---|---|
| Khung và phiên bản | 8 | `v05-ok-empty-no-alarm-files`, `v05-ok-alarm-only-no-classes-no-alarms`, `v05-bad-version-mixed`, `v05-bad-min-runtime-0.7.0`, `v05-ok-min-runtime-0.8.0`, `v05-bad-alarmfile-missing`, `v05-bad-alarmfile-path`, `v05-bad-extra-key-project` |
| `digital` | 8 | `v05-ok-digital-bool`, `v05-ok-digital-int-trigger-false`, `v05-bad-digital-float-tag`, `v05-bad-digital-string-tag`, `v05-bad-digital-trigger-missing`, `v05-bad-digital-trigger-string`, `v05-bad-digital-tag-ref`, `v05-bad-digital-extra-limits` |
| `limit` | 14 | `v05-ok-limit-4-thresholds`, `v05-ok-limit-only-H`, `v05-ok-limit-only-LL`, `v05-bad-limit-none`, `v05-bad-limit-unknown-key`, `v05-bad-limit-order-H-gt-HH`, `v05-bad-limit-order-equal`, `v05-bad-limit-nan-value`, `v05-bad-limit-bool-tag`, `v05-bad-limit-deadband-negative`, `v05-bad-limit-deadband-eq-gap`, `v05-ok-limit-deadband-just-below-gap`, `v05-bad-limit-class-missing-on-threshold`, `v05-warn-limit-chatter-risk` |
| `quality` | 8 | `v05-ok-quality-tag`, `v05-ok-quality-device`, `v05-bad-quality-both-tag-device`, `v05-bad-quality-neither`, `v05-bad-quality-device-ref`, `v05-bad-quality-on-unknown`, `v05-ok-quality-notGood`, `v05-warn-quality-device-empty` |
| Id và đếm | 8 | `v05-bad-id-dup`, `v05-bad-id-format-digit-first`, `v05-bad-id-format-dot`, `v05-ok-id-len-48`, `v05-bad-id-len-49`, `v05-ok-count-500-instances`, `v05-bad-count-501-instances`, `v05-warn-count-201` |
| Kích thước tệp | 2 | `v05-ok-alarms-file-512KiB`, `v05-bad-alarms-file-over-512KiB` |
| Nội dung (`text`) | 10 | `v05-ok-text-all-tokens`, `v05-ok-text-value-0`, `v05-ok-text-value-6`, `v05-bad-text-value-7`, `v05-bad-text-unknown-token`, `v05-bad-text-unbalanced-brace`, `v05-bad-text-empty-fmt`, `v05-ok-text-200-chars`, `v05-bad-text-201-chars`, `v05-ok-text-vietnamese-combining` |
| Trễ | 5 | `v05-ok-delay-0`, `v05-ok-delay-max-86400000`, `v05-bad-delay-over-max`, `v05-bad-delay-negative`, `v05-bad-delay-fraction` |
| Lớp | 9 | `v05-ok-classes-default-four`, `v05-bad-class-dup`, `v05-bad-class-id-format`, `v05-bad-class-color`, `v05-bad-class-sound`, `v05-bad-class-priority`, `v05-ok-classes-16`, `v05-bad-classes-17`, `v05-warn-critical-no-ack` |
| Khu vực | 6 | `v05-ok-areas-64`, `v05-bad-areas-65`, `v05-bad-area-dup`, `v05-bad-area-id-format`, `v05-bad-area-ref`, `v05-ok-area-absent-general` |
| Trường lạ và kiểu | 4 | `v05-bad-field-unknown-alarm`, `v05-bad-field-name-81`, `v05-bad-field-type-number-name`, `v05-bad-class-ref-without-class-file` |
| `enabled` | 2 | `v05-ok-enabled-false-not-counted`, `v05-bad-enabled-false-still-validated` |
| Giữ tương thích | 4 | `v05-ok-screen-widget-alarm-list`, `v05-ok-screen-0.4-features-in-0.5`, `v05-ok-navigation-alarms-false`, `v05-bad-navigation-alarms-string` |

Tổng: 8 + 8 + 14 + 8 + 8 + 2 + 10 + 5 + 9 + 6 + 4 + 2 + 4 = **88 ca** (vượt mức ≥ 60 của FR-094).

Bộ cặp `tests/migration-vectors/*-0.4to0.5/{before,after}/`: `dashboard-demo` (007), `modbus-demo` qua 0.2 và 0.1, project một màn hình, project nhiều màn hình có `navigation`, project 0.4 của 3b (`dashboard-demo` 0.4, `minRuntimeVersion` 0.7.0), project có `minRuntimeVersion` 0.6.0 và 0.7.0 (nâng lên 0.8.0 sau khi qua 0.4 và 0.5), project 0.3 đi qua 0.4 rồi 0.5 trong một lần, project đã có lỗi sẵn (không áp, `NEW_ERRORS` giữ nguyên).

## Điểm cần sửa spec

1. **SC-015 và FR-012 (migration nâng cả `minRuntimeVersion`):** Đã xử lý trong spec (FR-012: nâng cả `minRuntimeVersion` lên ≥ 0.8.0).
2. **FR-006 (alarm `quality` theo `device`)** nói điều kiện đúng khi mọi Tag của thiết bị "không GOOD", không nhắc `on`; tài liệu chốt: Tag thỏa vị từ `on` (`bad`: BAD, `notGood`: BAD hoặc UNCERTAIN). Cần đồng bộ câu chữ.
3. **D26 (`navigation.alarms`)** chưa nói project không có `navigation`: tài liệu chốt trang vẫn dựng menu tối thiểu (mục §2).
4. **FR-005 "tối đa 200 ký tự sau khi chèn (cắt có dấu …)" và Edge Cases "nội dung quá 200 ký tự là lỗi kiểm tra"** nói về hai thứ khác nhau (mẫu và kết quả); tài liệu chốt `E_ALARM_TEXT_LEN` kiểm **mẫu** (`text`) ≤ 200 ký tự, kết quả chèn bị cắt ở runtime.
5. **FR-011 liệt kê "trường lạ"** trong nhóm lỗi nhưng không có mã riêng; tài liệu gộp vào `E_ALARM_FIELD` (kèm sai kiểu, `name` quá dài, khu vực sai dạng) vì digest chỉ có 23 mã.
