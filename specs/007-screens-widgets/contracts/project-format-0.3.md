# Contract: định dạng project 0.3.0

**Feature**: [spec.md](../spec.md) FR-001…FR-012, FR-020, FR-070 · **Data model**: [data-model.md](../data-model.md) §1–§4 · **Research**: R1–R6, R8 · **ADR**: [013](../../../docs/adr/013-screen-model-v1.md), [019](../../../docs/adr/019-widget-library.md)

Bổ sung cho [project-format-0.2.md của 006](../../006-tags-modbus/contracts/project-format-0.2.md). Luật của 0.1 và 0.2 giữ nguyên với project 0.1.x và 0.2.x. Theo [ADR-004](../../../docs/adr/004-schema-versioning.md): đổi cấu trúc file màn hình là MINOR khi MAJOR = 0, kèm migration: 0.2 → 0.3.

## 1. Phiên bản và tập file

| Điều | 0.1.x | 0.2.x | 0.3.x |
|---|---|---|---|
| `schemaVersion` mỗi file | `^0\.1\.\d+$` | `^0\.2\.\d+$`, bằng `project.json` | `^0\.3\.\d+$`, bằng `project.json` |
| Trộn các phiên bản | `E_SCHEMA_VERSION` | `E_SCHEMA_VERSION` | `E_SCHEMA_VERSION` |
| `minRuntimeVersion` | như cũ | ≥ `0.5.0` | ≥ `0.6.0`, không thì `E_MIN_RUNTIME` |
| Schema dùng để kiểm | `schemas/0.1/` | `schemas/0.2/` (đóng băng) | `schemas/*.schema.json`, `schemas/widgets.catalog.json` |
| Runtime nhận | 0.4.x, 0.5.x, 0.6.x | 0.5.x, 0.6.x | 0.6.x |
| Studio mở để sửa | sau khi nâng cấp | sau khi nâng cấp lên 0.3 | có |

**Tập file của project 0.3** (`projectFiles()` ở TS, `LoadedProject::files()` ở C++): như 0.2 (`project.json`, `tagFile`, `connectionFile`, `loggingFile`, `value-tables/*`, `watch-tables/*`), thêm với **mỗi màn hình** `screens/<id>.screen.json` và, với **mỗi item `svg`**, `svgFile` và `bindingFile` của item (trùng lặp giữa các item chỉ tính một lần). Gói `.matscada` giữ 1.0.0; luật đường dẫn và trần 1 MiB mỗi file JSON không đổi.

## 2. `project.json`

Khác 0.2: bỏ khóa nào không đổi; thêm `navigation` (tùy chọn). `screens` vẫn là danh sách id; `entryScreen` phải là màn hình `kind: "screen"`.

```json
{
  "format": "matscada-project",
  "schemaVersion": "0.3.0",
  "projectId": "pump-station",
  "projectName": "Trạm bơm số 1",
  "projectVersion": "1.2.0",
  "minRuntimeVersion": "0.6.0",
  "entryScreen": "tong-quan",
  "screens": ["tong-quan", "bon-nuoc", "giam-sat", "bom1"],
  "tagFile": "tags.json",
  "connectionFile": "connections.json",
  "valueTables": ["TrangThaiBom"],
  "navigation": {
    "position": "left",
    "items": [
      { "label": "Tổng quan", "screen": "tong-quan", "icon": "home" },
      { "label": "Bồn nước", "screen": "bon-nuoc", "icon": "tank" },
      { "label": "Giám sát", "icon": "chart", "items": [
        { "label": "Xu hướng", "screen": "giam-sat", "icon": "chart" }
      ] }
    ]
  },
  "maxClients": 10
}
```

`navigation`: `position` (`left` mặc định, `top`, `hidden`); `items` ≤ 32 mục lá, nhóm một cấp (mục nhóm có `items`, không có `screen`); `label` 1–40 ký tự; `icon` thuộc bộ 16 tên (R4). Không khóa lạ.

## 3. `screens/<id>.screen.json`

```json
{
  "schemaVersion": "0.3.0",
  "id": "tong-quan",
  "name": "Tổng quan",
  "kind": "screen",
  "size": { "width": 1920, "height": 1080 },
  "fitMode": "contain",
  "background": "#0F172A",
  "items": [
    { "id": "svg1", "name": "Sơ đồ bồn và bơm", "type": "svg",
      "x": 0, "y": 0, "width": 1920, "height": 1080,
      "svgFile": "screens/tong-quan.svg", "bindingFile": "screens/tong-quan.bindings.json",
      "viewBox": [0, 0, 1920, 1080], "fit": "contain",
      "elements": [ { "elementUid": "el_tank" }, { "elementUid": "el_pump" } ] },
    { "id": "panel_1", "name": "Khung bồn", "type": "widget", "widget": "panel",
      "x": 40, "y": 40, "width": 520, "height": 360, "props": { "title": "Bồn nước 1" } },
    { "id": "card_level", "name": "Mức bồn", "type": "widget", "widget": "card",
      "x": 60, "y": 100, "width": 220, "height": 110,
      "props": { "label": "Mức nước", "decimals": 1 }, "tags": { "value": "TANK01.LEVEL" } },
    { "id": "sp_level", "name": "Đặt mức", "type": "widget", "widget": "setpoint",
      "x": 300, "y": 100, "width": 240, "height": 72,
      "props": { "label": "Mức đặt" }, "tags": { "target": "TANK01.SP" },
      "security": { "minRole": "operator" } },
    { "id": "btn_start", "name": "Bật bơm", "type": "widget", "widget": "button",
      "x": 60, "y": 260, "width": 160, "height": 48,
      "props": { "label": "Bật bơm 1" }, "tags": { "target": "PUMP01.RUN_CMD" },
      "events": { "click": { "action": "pulse", "value": true, "durationMs": 500 } } },
    { "id": "btn_pump", "name": "Chi tiết bơm", "type": "widget", "widget": "button",
      "x": 240, "y": 260, "width": 160, "height": 48,
      "props": { "label": "Chi tiết bơm 1", "variant": "neutral" },
      "events": { "click": { "action": "popup", "screen": "bom1" } } }
  ]
}
```

**Màn hình:**

| Khóa | Ràng buộc |
|---|---|
| `schemaVersion` | bằng `project.json` |
| `id` | `^[a-z0-9][a-z0-9-]{0,47}$`; khớp tên file; có trong `screens` |
| `name` | 1–80 ký tự |
| `kind` | `screen` \| `popup` |
| `size` | `width` 64–4096, `height` 64–2304 (số nguyên); lỗi `E_SCREEN_SIZE` |
| `fitMode` | `contain` (mặc định), `cover`, `stretch`, `fit-width`, `none` |
| `background` | `#RGB` hoặc `#RRGGBB` (tùy chọn) |
| `items` | 0–250 phần tử; thứ tự là thứ tự xếp lớp, đầu ở dưới |

Không có khóa lạ ở cấp màn hình (`E_SCHEMA`): đặc biệt `svgFile`, `bindingFile`, `viewBox`, `elements` của 0.2 không còn.

**Phần tử chung của item:** `id` (`^[a-z][a-z0-9_]{1,31}$`, duy nhất trong màn hình: `E_ITEM_ID`), `name` (≤ 80), `type` (`svg` \| `widget`), `x`, `y` (số nguyên, −2048…8192), `width`, `height` (số nguyên ≥ 1, ≤ 8192; không nhỏ hơn `minSize` của loại: `E_ITEM_SIZE`), `locked` (bool, mặc định false), `hidden` (bool, mặc định false).

## 4. Item `svg`

| Khóa | Ràng buộc |
|---|---|
| `svgFile` | đuôi `.svg`, luật đường dẫn của 0.2; file phải có (`E_FILE_MISSING`) |
| `bindingFile` | đuôi `.json`; file phải có |
| `viewBox` | 4 số, rộng và cao > 0 |
| `fit` | `contain` (mặc định), `cover`, `stretch`: SVG vừa khung của item |
| `elements` | ≤ 2.000 `{ elementUid, name?, kind? }`; `elementUid` duy nhất trong item (`E_DUP_UID`) |

**File binding** (`screens/<id>.bindings.json`) giữ cấu trúc 0.2, `schemaVersion` 0.3.x, thêm `itemId` (tùy chọn): nếu có phải bằng `id` của item `svg` trỏ tới file này (`E_SCHEMA`); `screenId` bằng id màn hình. Binding, transform, `valueTable` giữ nguyên ngữ nghĩa 0.2. Một file binding thuộc đúng một item `svg`; hai item dùng chung file binding là `E_SCHEMA` (hai item dùng chung file SVG thì được).

Luật 0.2 áp cho mỗi item `svg`: `E_REF_UID` (binding trỏ uid không khai), `E_REF_TAG`, `E_TARGET_UNSUPPORTED`, `E_TYPE_MISMATCH`, `E_DUP_BINDING`, `W_UID_NOT_IN_SVG`.

## 5. Item `widget`

| Khóa | Ràng buộc |
|---|---|
| `widget` | loại trong [danh mục](widget-catalog.md): `E_WIDGET_UNKNOWN` |
| `props` | đối tượng; khóa, kiểu, khoảng theo danh mục: `E_WIDGET_PROP` |
| `tags` | khe → id Tag hoặc mảng id (khe `multi`): luật ở danh mục §4 |
| `events` | `{ "click": <hành động> }` khi loại có sự kiện: danh mục §3 |
| `security` | `{ "minRole": "operator" \| "engineer" \| "administrator" }` chỉ cho widget điều khiển; không có ở loại khác (`E_WIDGET_PROP`) |

Studio không ghi trường bằng mặc định (§11).

## 6. Màn hình `popup`

- `kind: "popup"` không được là `entryScreen` và không được nằm trong `navigation` (`E_SCREEN_KIND`, `E_NAV`).
- Chỉ mở bằng hành động `popup`; `closePopup` chỉ có nghĩa trong popup.
- Không có popup lồng popup (mở popup từ popup thay popup hiện tại; không cấm ở định dạng).

## 7. Mã lỗi và cảnh báo mới

### 7.1 Lỗi (chặn kích hoạt)

| Mã | Khi |
|---|---|
| `E_SCHEMA` | sai cấu trúc (kể cả khóa 0.2 còn sót, `itemId` không khớp, hai item chung file binding) |
| `E_SCHEMA_VERSION`, `E_MIN_RUNTIME` | như 0.2 (0.3 cần ≥ 0.6.0) |
| `E_SCREEN_ID` | id màn hình sai dạng hoặc không khớp tên file |
| `E_SCREEN_SIZE` | `size` ngoài khoảng |
| `E_SCREEN_KIND` | `kind` sai; `entryScreen` là popup |
| `E_LIMIT` | > 32 màn hình, > 250 item, > 8 item `svg`, > 16 biểu đồ đường/cột/tròn mỗi màn hình, > 32 mục menu |
| `E_SCREEN_TAGS` | một màn hình tham chiếu > 1.000 Tag riêng biệt, kể cả cộng Tag của mọi popup mà nút trong nó mở (kiểm từng cặp màn hình-popup) |
| `E_ITEM_ID` | id item sai dạng hoặc trùng |
| `E_ITEM_SIZE` | cỡ nhỏ hơn `minSize` của loại, hoặc ≤ 0 |
| `E_WIDGET_UNKNOWN` | loại widget lạ |
| `E_WIDGET_SLOT` | khe lạ, khe bắt buộc thiếu, khe không dùng với hành động này |
| `E_WIDGET_PROP` | thuộc tính lạ, sai kiểu, ngoài khoảng, thiếu nhau (`yMin` không `yMax`) |
| `E_WIDGET_TAG_TYPE` | kiểu Tag không thuộc khe |
| `E_REF_TAG`, `E_REF_TABLE` | Tag hoặc bảng giá trị không có |
| `E_TAG_ACCESS` | khe ghi mà Tag R, `calculated`, hoặc `simulation` không nhập tay |
| `E_WIDGET_LIMITS` | `min`/`max` của widget rộng hơn `Tag.limits` hoặc `min ≥ max` |
| `E_WIDGET_MINROLE` | `security.minRole` = `viewer` hoặc giá trị lạ |
| `E_WIDGET_CONFIRM` | `confirm: "none"` với Tag không phải BOOL |
| `E_ACTION` | hành động lạ, thiếu tham số, sai kiểu `value`, ngoài giới hạn Tag, `durationMs` ngoài 100–10.000 |
| `E_ACTION_TARGET` | `navigate`/`popup` trỏ tới màn hình không có hoặc sai loại |
| `E_NAV` | mục menu trỏ tới màn hình không có hoặc popup; nhóm lồng nhóm; nhóm rỗng |
| `E_REF_UID` | (item `svg`) uid trong binding không khai trong `elements` |
| `E_FILE_MISSING` | file SVG hoặc binding của item thiếu |

### 7.2 Cảnh báo (không chặn)

| Mã | Khi |
|---|---|
| `W_ITEM_OUTSIDE` | item nằm hoàn toàn ngoài màn hình |
| `W_SCREEN_EMPTY` | màn hình không có item |
| `W_STRETCH_WIDGETS` | `fitMode: "stretch"` mà có widget |
| `W_WRITE_NO_LIMITS` | widget ghi số mà Tag và widget đều không có giới hạn (mã của 006, dùng lại) |
| `W_CONFIRM_NONE` | `confirm: "none"` |
| `W_PULSE_READBACK` | hành động `pulse` trên Tag bật đọc lại |
| `W_ACTION_NOOP` | `closePopup` trên màn hình `screen` |
| `W_SCREEN_TAGS_MANY` | màn hình > 500 Tag riêng biệt |
| `W_ITEM_COVERED` | widget bị item phía trên che hoàn toàn |
| `W_UID_NOT_IN_SVG` | (như 0.2) |

Mã lỗi dùng chung TS và C++ ở `packages/project-schema/src/codes.ts` và `core/project-manager/`; câu `message` có thể khác. Đường dẫn lỗi (`path`) là JSON Pointer tới khóa sai (ví dụ `/items/3/tags/value`).

## 8. Nâng cấp 0.2 → 0.3 (`migrate02to03`)

Chạy trong bộ nhớ ở Studio ([research.md](../research.md) R6). Cho cùng đầu vào cùng kết quả.

**Trước** (`screens/main.screen.json`, 0.2.0):

```json
{ "schemaVersion": "0.2.0", "id": "main", "name": "Main", "svgFile": "screens/main.svg",
  "viewBox": [0, 0, 100, 100], "fitMode": "contain", "bindingFile": "screens/main.bindings.json",
  "elements": [ { "elementUid": "el_aaa" }, { "elementUid": "el_bbb" } ] }
```

**Sau** (0.3.0):

```json
{ "schemaVersion": "0.3.0", "id": "main", "name": "Main", "kind": "screen",
  "size": { "width": 100, "height": 100 }, "fitMode": "contain",
  "items": [ { "id": "svg1", "name": "Đồ họa", "type": "svg", "x": 0, "y": 0, "width": 100, "height": 100,
    "svgFile": "screens/main.svg", "bindingFile": "screens/main.bindings.json",
    "viewBox": [0, 0, 100, 100], "fit": "contain",
    "elements": [ { "elementUid": "el_aaa" }, { "elementUid": "el_bbb" } ] } ] }
```

Quy tắc:

- `size` = `viewBox[2]` × `viewBox[3]` làm tròn lên số nguyên, kẹp vào 64–4096 × 64–2304. Ngoài khoảng thì `size` kẹp, item `svg` có `width`, `height` bằng `size`, `viewBox` giữ nguyên, và Studio báo trong danh sách thay đổi (hiếm: `viewBox` nhỏ hơn 64 đơn vị hoặc lớn hơn 4096).
- `fitMode` giữ nguyên (`contain`, `cover`, `stretch`); `background` giữ nguyên.
- `id` item `svg` = `svg1`; `name` = "Đồ họa".
- `*.bindings.json`: chỉ `schemaVersion` và thêm `itemId: "svg1"`.
- `project.json`: `schemaVersion`, `minRuntimeVersion` = max(cũ, `0.6.0`); thêm `navigation` nếu ≥ 2 màn hình: một mục lá cho mỗi màn hình theo thứ tự `screens`, nhãn là `name`, `position: "left"`.
- Các file khác (`tags.json`, `connections.json`, `value-tables/*`, `watch-tables/*`, `logging.json`): chỉ đổi `schemaVersion`.
- Kiểm project sau nâng cấp bằng validator 0.3; có lỗi mà bản gốc không có thì không áp (`NEW_ERRORS`).
- Sao lưu: `.mat-backup/<tên>-0.2-<thời điểm>/` ngay trước lần lưu đầu (như 006).
- Project 0.1: `migrate01to02` rồi `migrate02to03` trong một lần; một thư mục sao lưu.

**Nền và co giãn:** vùng chứa màn hình của trang runtime (cả phần thừa hai bên khi `contain`) dùng `background` của màn hình, như `mountScreen` của 0.2 tô nền cho cả phần tử chứa. Vì `size` bằng cỡ `viewBox` (cùng tỉ lệ), `contain` cho cùng hình với 0.2 (SC-011). Ví dụ: `modbus-demo` có `viewBox` 100 × 100 nên `size` là 100 × 100.

## 9. Bộ chuyển `toScreenModel`

`toScreenModel(loadedScreen)` (trong `@mat/project-schema`, không ghi file):

- màn hình 0.3: trả nguyên (đã đúng mô hình);
- màn hình 0.1 hoặc 0.2: trả mô hình giống kết quả của §8 (cùng quy tắc kích thước), `kind: "screen"`.

Trang runtime và xem trước Studio chỉ dựng mô hình này. Kiểm bằng cặp: `toScreenModel(0.2)` bằng màn hình trong file 0.3 do `migrate02to03` sinh.

## 10. `GET /api/v1/projects/active`

Project 0.3: [device-api-1.2.md](device-api-1.2.md) §4. Project 0.1 và 0.2: như runtime 0.5.

## 11. Định dạng ghi của Studio (FR-070)

- Tệp màn hình thụt 2 dấu cách ở cấp màn hình; **mỗi item một khối gọn trên một dòng** (như mỗi Tag một dòng của 006), thứ tự khóa chuẩn: `id`, `name`, `type`, `widget`, `x`, `y`, `width`, `height`, `locked`, `hidden`, `props`, `tags`, `events`, `security` (item `svg`: `id`, `name`, `type`, `x`, `y`, `width`, `height`, `locked`, `hidden`, `svgFile`, `bindingFile`, `viewBox`, `fit`, `elements`).
- Không ghi trường bằng mặc định (danh mục, `locked: false`, `hidden: false`, `fit: "contain"`, `fitMode: "contain"`, `kind: "screen"`).
- Cùng đầu vào cho cùng byte; kết thúc bằng một dòng trống; UTF-8 không BOM.

## 12. Vector

- `tests/project-vectors/v03-*` (≥ 120 ca): mỗi mã ở §7 một ca đúng và một ca sai; biên (250 item, 251 item; 1.000 và 1.001 Tag; `size` 64, 63, 4096, 4097; `durationMs` 100, 99, 10000, 10001); ca popup; ca menu; ca có item `svg` nhiều.
- `tests/migration-vectors/*-0.2to0.3/{before,after}/`: `tank-demo` (qua cả 0.1), `modbus-demo`, `viewBox` gốc khác 0, `viewBox` rất lớn, `fitMode` `cover` và `stretch`, project một và nhiều màn hình, màn hình có lỗi sẵn.
- 82 ca 0.1 và các ca 0.2 giữ nguyên kết luận trên runtime 0.6 (SC-011, SC-012).
