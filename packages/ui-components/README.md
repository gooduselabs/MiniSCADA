# @mat/ui-components

<!-- Sinh bởi tools/gen-widget-docs.mjs từ schemas/widgets.catalog.json. Không sửa tay: sửa danh mục rồi chạy lại. -->

Thư viện widget và màn hình v1 của mAT SCADA (Lit, Shadow DOM, không phụ thuộc framework). Dùng chung cho trang vận hành (`apps/runtime-web`) và xem trước của Studio. Danh mục 21 widget (phiên bản danh mục 0.5.0) nằm ở `schemas/widgets.catalog.json`; hai bộ kiểm tra (TS và C++) và Studio đọc cùng tệp đó.

## Nhúng

```ts
import { registerWidgets, type MatScreen } from '@mat/ui-components';
registerWidgets(); // đăng ký <mat-w-*> và <mat-screen>
const el = document.createElement('mat-screen') as MatScreen;
el.screen = screenModel;      // ScreenModel của định dạng 0.3 (toScreenModel cho 0.1 và 0.2)
el.tags = tagSource;          // TagSource: giá trị, chất lượng, giờ
el.host = actionHost;         // ActionHost: ghi, điều hướng, popup
el.loadSvg = (p) => store.loadSvg(p);
el.loadBindings = (p) => store.loadBindings(p);
```

## Hai giao diện chủ

- `TagSource`: `subscribe(ids, fn)` (trả hàm hủy), `get(id)`, `info(id)`, `now()`, trạng thái kết nối. Trang vận hành dùng `LiveTagSource` (WebSocket live), Studio dùng nguồn mô phỏng hoặc thiết bị.
- `ActionHost`: `write(spec, onPhase)` (kết quả `ACCEPTED`, `CONFIRMED`, `REJECTED`, `FAILED`, `TIMEOUT`, `UNKNOWN`), `navigate`, `openPopup`, `closePopup`, `session`, `writeBlocked`, `requestLogin`. Mọi lệnh ghi đi qua `ControlController` (khóa theo role, kết nối, chất lượng, giới hạn; hộp xác nhận).
- `AlarmSource` (feature 009, `.alarms` của `<mat-w-*>`): `snapshot()`, `subscribe(fn)`, `counts()`, `classes()`, `areas()`, `status()`, `now()`; `ActionHost` có thêm `ackAlarms`, `shelveAlarm`, `unshelveAlarm`. Hai widget alarm không có khe Tag và không gọi mạng: chỉ đọc `AlarmSource` và gọi `ActionHost`.

## An toàn DOM

Không dùng `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, `unsafeHTML` (ESLint, SC-020). Mọi chữ do người dùng nhập (nhãn, mô tả, `confirmText`, tên Tag) đi qua template Lit hoặc `textContent`; màu qua danh sách trắng.

## Nhóm Hiển thị

### `card` (`<mat-w-card>`)

Nhóm: Hiển thị. Cỡ mặc định 220 × 110, nhỏ nhất 96 × 56.

| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |
|---|---|---|---|---|
| `value` | có | không | number, bool, string | không |

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `label` | string | `""` | ≤ 40 ký tự |
| `decimals` | int | `1` | ≥ 0, ≤ 6 |
| `unit` | string | theo Tag (`unit`) | ≤ 16 ký tự |
| `fontSize` | enum | `"m"` | `s`, `m`, `l`, `xl` |
| `showQuality` | bool | `true` |  |
| `valueColor` | color | `"auto"` |  |
| `background` | color | `"auto"` |  |

### `label` (`<mat-w-label>`)

Nhóm: Hiển thị. Cỡ mặc định 200 × 40, nhỏ nhất 24 × 16.

| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |
|---|---|---|---|---|
| `value` | không | không | number, bool, string | không |

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `text` | string | `""` | ≤ 200 ký tự |
| `fontSize` | int | `16` | ≥ 8, ≤ 200 |
| `bold` | bool | `false` |  |
| `align` | enum | `"left"` | `left`, `center`, `right` |
| `color` | color | `"auto"` |  |
| `wrap` | bool | `false` |  |
| `decimals` | int | `1` | ≥ 0, ≤ 6 |

### `lamp` (`<mat-w-lamp>`)

Nhóm: Hiển thị. Cỡ mặc định 140 × 40, nhỏ nhất 24 × 24.

| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |
|---|---|---|---|---|
| `state` | có | không | bool, number | không |

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `label` | string | `""` | ≤ 40 ký tự |
| `shape` | enum | `"circle"` | `circle`, `square` |
| `onColor` | color | `"auto"` |  |
| `offColor` | color | `"auto"` |  |
| `invert` | bool | `false` |  |
| `useValueTable` | bool | `true` |  |
| `showText` | bool | `true` |  |

### `gauge` (`<mat-w-gauge>`)

Nhóm: Hiển thị. Cỡ mặc định 240 × 200, nhỏ nhất 120 × 100.

| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |
|---|---|---|---|---|
| `value` | có | không | number | không |

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `label` | string | `""` | ≤ 40 ký tự |
| `min` | number | theo Tag (`min`) |  |
| `max` | number | theo Tag (`max`) |  |
| `decimals` | int | `1` | ≥ 0, ≤ 6 |
| `unit` | string | theo Tag (`unit`) | ≤ 16 ký tự |
| `zones` | array | `[]` | ≤ 4 phần tử |
| `showValue` | bool | `true` |  |

### `level` (`<mat-w-level>`)

Nhóm: Hiển thị. Cỡ mặc định 100 × 260, nhỏ nhất 40 × 80.

| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |
|---|---|---|---|---|
| `value` | có | không | number | không |

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `orientation` | enum | `"vertical"` | `vertical`, `horizontal` |
| `label` | string | `""` | ≤ 40 ký tự |
| `min` | number | theo Tag (`min`) |  |
| `max` | number | theo Tag (`max`) |  |
| `decimals` | int | `1` | ≥ 0, ≤ 6 |
| `unit` | string | theo Tag (`unit`) | ≤ 16 ký tự |
| `zones` | array | `[]` | ≤ 4 phần tử |
| `showValue` | bool | `true` |  |

### `panel` (`<mat-w-panel>`)

Nhóm: Hiển thị. Cỡ mặc định 400 × 300, nhỏ nhất 80 × 60.

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `title` | string | `""` | ≤ 60 ký tự |
| `showTitle` | bool | `true` |  |
| `background` | color | `"auto"` |  |
| `border` | bool | `true` |  |

## Nhóm Biểu đồ

### `line` (`<mat-w-line>`)

Nhóm: Biểu đồ. Cỡ mặc định 600 × 300, nhỏ nhất 240 × 140.

| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |
|---|---|---|---|---|
| `series` | có | có (≤ 8) | number, bool | không |

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `windowSec` | int | `60` | ≥ 10, ≤ 3600 |
| `sampleMs` | int | `1000` | ≥ 250, ≤ 60000 |
| `yMin` | number |  |  |
| `yMax` | number |  |  |
| `legend` | bool | `true` |  |
| `grid` | bool | `true` |  |
| `labels` | array | `[]` | ≤ 8 phần tử |

### `bar` (`<mat-w-bar>`)

Nhóm: Biểu đồ. Cỡ mặc định 400 × 260, nhỏ nhất 160 × 120.

| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |
|---|---|---|---|---|
| `series` | có | có (≤ 12) | number, bool | không |

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `orientation` | enum | `"vertical"` | `vertical`, `horizontal` |
| `min` | number |  |  |
| `max` | number |  |  |
| `decimals` | int | `1` | ≥ 0, ≤ 6 |
| `showValues` | bool | `true` |  |
| `labels` | array | `[]` | ≤ 12 phần tử |

### `pie` (`<mat-w-pie>`)

Nhóm: Biểu đồ. Cỡ mặc định 280 × 280, nhỏ nhất 120 × 120.

| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |
|---|---|---|---|---|
| `series` | có | có (≤ 8) | number | không |

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `donut` | bool | `true` |  |
| `decimals` | int | `1` | ≥ 0, ≤ 6 |
| `showPercent` | bool | `true` |  |
| `showTotal` | bool | `false` |  |
| `labels` | array | `[]` | ≤ 8 phần tử |

## Nhóm Bảng

### `tag-table` (`<mat-w-tag-table>`)

Nhóm: Bảng. Cỡ mặc định 420 × 300, nhỏ nhất 240 × 80.

| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |
|---|---|---|---|---|
| `rows` | có | có (≤ 50) | number, bool, string | không |

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `columns` | array | `["label","value","unit","quality"]` | ≤ 5 phần tử, không trùng; phần tử: `label`, `value`, `unit`, `quality`, `updated` |
| `sortable` | bool | `true` |  |
| `dense` | bool | `false` |  |
| `labels` | array | `[]` | ≤ 50 phần tử |

## Nhóm Điều khiển

### `button` (`<mat-w-button>`)

Nhóm: Điều khiển. Cỡ mặc định 160 × 48, nhỏ nhất 64 × 32.

| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |
|---|---|---|---|---|
| `target` | không | không | number, bool, string | có |

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `label` | string | `""` | ≤ 40 ký tự |
| `variant` | enum | `"primary"` | `primary`, `neutral`, `danger` |
| `confirm` | enum | `"always"` | `always`, `none` |
| `confirmText` | string | `""` | ≤ 200 ký tự |

Sự kiện: `click` (hành động: `write`, `toggle`, `pulse`, `navigate`, `popup`, `closePopup`).

### `switch` (`<mat-w-switch>`)

Nhóm: Điều khiển. Cỡ mặc định 160 × 48, nhỏ nhất 64 × 32.

| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |
|---|---|---|---|---|
| `target` | có | không | bool | có |

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `label` | string | `""` | ≤ 40 ký tự |
| `onText` | string | `"Bật"` | ≤ 16 ký tự |
| `offText` | string | `"Tắt"` | ≤ 16 ký tự |
| `confirm` | enum | `"always"` | `always`, `none` |
| `confirmText` | string | `""` | ≤ 200 ký tự |

### `setpoint` (`<mat-w-setpoint>`)

Nhóm: Điều khiển. Cỡ mặc định 220 × 72, nhỏ nhất 120 × 48.

| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |
|---|---|---|---|---|
| `target` | có | không | number | có |

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `label` | string | `""` | ≤ 40 ký tự |
| `min` | number | theo Tag (`limits.min`) |  |
| `max` | number | theo Tag (`limits.max`) |  |
| `step` | number |  |  |
| `decimals` | int | `1` | ≥ 0, ≤ 6 |
| `unit` | string | theo Tag (`unit`) | ≤ 16 ký tự |
| `confirmText` | string | `""` | ≤ 200 ký tự |

### `slider` (`<mat-w-slider>`)

Nhóm: Điều khiển. Cỡ mặc định 280 × 64, nhỏ nhất 120 × 32.

| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |
|---|---|---|---|---|
| `target` | có | không | number | có |

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `label` | string | `""` | ≤ 40 ký tự |
| `min` | number | theo Tag (`limits.min`) |  |
| `max` | number | theo Tag (`limits.max`) |  |
| `step` | number |  |  |
| `decimals` | int | `1` | ≥ 0, ≤ 6 |
| `unit` | string | theo Tag (`unit`) | ≤ 16 ký tự |
| `orientation` | enum | `"horizontal"` | `horizontal`, `vertical` |
| `confirmText` | string | `""` | ≤ 200 ký tự |

### `select` (`<mat-w-select>`)

Nhóm: Điều khiển. Cỡ mặc định 220 × 72, nhỏ nhất 120 × 48.

| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |
|---|---|---|---|---|
| `target` | có | không | number, bool | có |

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `label` | string | `""` | ≤ 40 ký tự |
| `table` | tableRef | theo Tag (`valueTable`) |  |
| `confirmText` | string | `""` | ≤ 200 ký tự |

## Nhóm Alarm

### `alarm-list` (`<mat-w-alarm-list>`)

Nhóm: Alarm. Cỡ mặc định 640 × 260, nhỏ nhất 320 × 120.

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `areas` | array | `[]` | ≤ 64 phần tử |
| `classes` | array | `[]` | ≤ 16 phần tử |
| `minPriority` | enum | `"advisory"` | `advisory`, `minor`, `major`, `critical` |
| `states` | array | `["ACTIVE_UNACK","ACTIVE_ACK","RTN_UNACK"]` | ≥ 1 phần tử, ≤ 3 phần tử, không trùng; phần tử: `ACTIVE_UNACK`, `ACTIVE_ACK`, `RTN_UNACK` |
| `columns` | array | `["time","priority","text","value","state"]` | ≥ 1 phần tử, ≤ 7 phần tử, không trùng; phần tử: `time`, `priority`, `area`, `text`, `value`, `state`, `ackUser` |
| `maxRows` | int | `8` | ≥ 1, ≤ 50 |
| `showAck` | bool | `true` |  |

### `alarm-count` (`<mat-w-alarm-count>`)

Nhóm: Alarm. Cỡ mặc định 120 × 48, nhỏ nhất 48 × 32.

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `areas` | array | `[]` | ≤ 64 phần tử |
| `minPriority` | enum | `"advisory"` | `advisory`, `minor`, `major`, `critical` |
| `mode` | enum | `"unacked"` | `unacked`, `active` |
| `target` | object | `{"kind":"alarms"}` | `kind`, `screen` (bắt buộc khi kind = screen) |

## Nhóm Lịch sử

### `history-trend` (`<mat-w-history-trend>`)

Nhóm: Lịch sử. Cỡ mặc định 640 × 320, nhỏ nhất 280 × 160.

| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |
|---|---|---|---|---|
| `series` | có | có (≤ 8) | number, bool | không |

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `group` | logGroup |  |  |
| `range` | enum | `"24h"` | `1h`, `8h`, `24h`, `7d`, `30d`, `today`, `yesterday` |
| `follow` | bool | `true` |  |
| `controls` | bool | `true` |  |
| `legend` | bool | `true` |  |
| `grid` | bool | `true` |  |
| `showBand` | bool | `true` |  |
| `step` | enum | `"auto"` | `auto`, `on`, `off` |
| `labels` | array | `[]` | ≤ 8 phần tử |
| `axes` | array | `[]` | ≤ 8 phần tử; phần tử: `left`, `right` |
| `yMin` | number |  |  |
| `yMax` | number |  |  |

### `history-table` (`<mat-w-history-table>`)

Nhóm: Lịch sử. Cỡ mặc định 640 × 320, nhỏ nhất 280 × 160.

| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |
|---|---|---|---|---|
| `columns` | có | có (≤ 32) | number, bool, string | không |

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `group` | logGroup |  |  |
| `range` | enum | `"24h"` | `1h`, `8h`, `24h`, `7d`, `30d`, `today`, `yesterday` |
| `pageSize` | int | `100` | ≥ 10, ≤ 500 |
| `order` | enum | `"desc"` | `asc`, `desc` |
| `controls` | bool | `true` |  |
| `labels` | array | `[]` | ≤ 32 phần tử |

### `history-bar` (`<mat-w-history-bar>`)

Nhóm: Lịch sử. Cỡ mặc định 480 × 280, nhỏ nhất 200 × 140.

| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |
|---|---|---|---|---|
| `series` | có | có (≤ 4) | number, bool | không |

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `group` | logGroup |  |  |
| `fn` | enum | `"delta"` | `sum`, `avg`, `min`, `max`, `first`, `last`, `delta`, `count` |
| `bucket` | enum | `"shift"` | `hour`, `shift`, `day` |
| `period` | enum | `"last7d"` | `last24h`, `last7d`, `last30d`, `today`, `yesterday`, `thisShift`, `lastShift`, `thisMonth`, `lastMonth` |
| `shiftCount` | int | `3` | ≥ 2, ≤ 12 |
| `shiftStart` | string | `"06:00"` | ≤ 5 ký tự |
| `decimals` | int | `1` | ≥ 0, ≤ 6 |
| `showValues` | bool | `true` |  |
| `labels` | array | `[]` | ≤ 4 phần tử |
| `refreshSec` | int | `60` | ≥ 30, ≤ 3600 |

### `history-pie` (`<mat-w-history-pie>`)

Nhóm: Lịch sử. Cỡ mặc định 320 × 320, nhỏ nhất 140 × 140.

| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |
|---|---|---|---|---|
| `series` | có | có (≤ 8) | number, bool | không |

| Thuộc tính | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `group` | logGroup |  |  |
| `fn` | enum | `"delta"` | `sum`, `delta`, `avg` |
| `period` | enum | `"today"` | `last24h`, `last7d`, `last30d`, `today`, `yesterday`, `thisShift`, `lastShift`, `thisMonth`, `lastMonth` |
| `shiftCount` | int | `3` | ≥ 2, ≤ 12 |
| `shiftStart` | string | `"06:00"` | ≤ 5 ký tự |
| `donut` | bool | `true` |  |
| `decimals` | int | `1` | ≥ 0, ≤ 6 |
| `showPercent` | bool | `true` |  |
| `showTotal` | bool | `false` |  |
| `labels` | array | `[]` | ≤ 8 phần tử |
| `refreshSec` | int | `60` | ≥ 30, ≤ 3600 |
