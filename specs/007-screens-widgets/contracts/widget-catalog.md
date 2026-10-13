# Contract: danh mục widget (`schemas/widgets.catalog.json`)

**Feature**: [spec.md](../spec.md) FR-004, FR-025…FR-033, FR-052, FR-063 · **Research**: R8, R9, R21 · **ADR**: [019](../../../docs/adr/019-widget-library.md)

Danh mục là nguồn duy nhất cho validator TS (`packages/project-schema/src/rules-03.ts`), validator C++ (`core/project-manager/rules_03.cpp`), inspector và Toolbox của Studio, `<mat-screen>` (giá trị mặc định). Sửa danh mục: chạy lại vector chung của hai validator.

## 1. Cấu trúc file

```json
{
  "catalogVersion": "0.3.0",
  "widgets": [
    {
      "id": "card",
      "group": "display",
      "label": "widget.card",
      "defaultSize": [220, 110],
      "minSize": [96, 56],
      "slots": [
        { "name": "value", "required": true, "multi": false, "types": ["number", "bool", "string"], "needsWrite": false }
      ],
      "props": [
        { "name": "label", "kind": "string", "maxLength": 40, "default": "", "group": "display" },
        { "name": "decimals", "kind": "int", "min": 0, "max": 6, "default": 1, "group": "display" }
      ],
      "events": []
    }
  ]
}
```

| Trường | Ý nghĩa |
|---|---|
| `id` | loại widget: khóa `widget` của item; `^[a-z][a-z-]{1,19}$` |
| `group` | `display`, `chart`, `table`, `control` (nhóm của Toolbox) |
| `label` | khóa chuỗi giao diện (`i18n`); không phải chữ trong danh mục |
| `defaultSize`, `minSize` | `[rộng, cao]` đơn vị thiết kế |
| `slots[]` | khe Tag: `name`, `required`, `multi` (và `max` khi `multi`), `types` (lớp kiểu cho phép), `needsWrite` (Tag phải RW, không phải `calculated`) |
| `props[]` | thuộc tính tĩnh: `name`, `kind`, ràng buộc, `default`, `group` (`general`, `display`, `security`) |
| `events[]` | sự kiện và hành động cho phép: `{ "name": "click", "actions": ["write", "toggle", "pulse", "navigate", "popup", "closePopup"] }` |

**Lớp kiểu Tag** (kiểu giá trị `type` của Tag v1, 006): `number` = INT16, UINT16, INT32, UINT32, INT64, UINT64, FLOAT32, FLOAT64; `bool` = BOOL; `string` = STRING.

**`kind` của thuộc tính:** `string` (`maxLength`), `int` (`min`, `max`), `number` (`min`, `max`, hữu hạn), `bool`, `enum` (`options`), `color` (`#RRGGBB`, hoặc chuỗi `auto` nếu `allowAuto`), `array` (`items`: `kind` của phần tử, `maxItems`), `object` (`fields`, dùng cho vùng màu), `tableRef` (tên bảng giá trị phải có). Thuộc tính vắng thì dùng `default`; `default` ghi trong danh mục để Studio không ghi vào file (FR-070). Khóa lạ trong `props` là `E_WIDGET_PROP`.

**Giá trị mặc định lấy từ Tag** (khi thuộc tính vắng): `unit` ← `Tag.unit`; `min`, `max` ← `Tag.min`, `Tag.max` (card, gauge, level, bar), hoặc ← `Tag.limits` (setpoint, slider); `table` ← `Tag.valueTable`.

**Vùng màu** (`zones`, đối tượng): `{ "from": số, "to": số, "color": "#RRGGBB" }`, ≤ 4 vùng, `from < to`, các vùng không chồng nhau.

## 2. Mười lăm loại

Kích thước theo đơn vị thiết kế.

### 2.1 Hiển thị

| `id` | Cỡ mặc định / tối thiểu | Khe Tag | Thuộc tính (mặc định) |
|---|---|---|---|
| `card` | 220×110 / 96×56 | `value` bắt buộc: number, bool, string | `label` (chuỗi ≤ 40, ""), `decimals` (int 0–6, 1), `unit` (chuỗi ≤ 16; vắng = theo Tag), `fontSize` (`s`, `m`, `l`, `xl`; `m`), `showQuality` (true), `valueColor` (màu hoặc `auto`; `auto` = màu của bảng giá trị, không có thì màu chữ), `background` (màu hoặc `auto`) |
| `label` | 200×40 / 24×16 | `value` tùy chọn: number, bool, string | `text` (≤ 200, ""; hiện trước giá trị, cách một khoảng trắng), `fontSize` (int 8–200, 16), `bold` (false), `align` (`left`, `center`, `right`; `left`), `color` (màu hoặc `auto`), `wrap` (false), `decimals` (0–6, 1) |
| `lamp` | 140×40 / 24×24 | `state` bắt buộc: bool, number | `label` (≤ 40, ""), `shape` (`circle`, `square`; `circle`), `onColor`, `offColor` (màu hoặc `auto`: `auto` = màu "tốt" và màu "tắt" của theme), `invert` (false), `useValueTable` (true: nếu Tag có bảng giá trị thì màu và chữ theo bảng), `showText` (true: chữ trạng thái đi kèm) |
| `gauge` | 240×200 / 120×100 | `value` bắt buộc: number | `label` (≤ 40, ""), `min`, `max` (số; vắng = theo Tag, không có thì 0 và 100; `min < max`), `decimals` (0–6, 1), `unit` (vắng = theo Tag), `zones` (≤ 4 vùng màu), `showValue` (true) |
| `level` | 100×260 / 40×80 | `value` bắt buộc: number | `orientation` (`vertical`, `horizontal`; `vertical`), `label`, `min`, `max`, `decimals`, `unit`, `zones`, `showValue` (như `gauge`) |
| `panel` | 400×300 / 80×60 | không | `title` (≤ 60, ""), `showTitle` (true), `background` (màu hoặc `auto`), `border` (true). Không sự kiện. Vẽ ở lớp dưới các widget khác theo thứ tự `items` do người thiết kế đặt |

### 2.2 Biểu đồ và bảng

| `id` | Cỡ mặc định / tối thiểu | Khe Tag | Thuộc tính (mặc định) |
|---|---|---|---|
| `line` | 600×300 / 240×140 | `series` bắt buộc, `multi`, `max` 8: number, bool | `windowSec` (int 10–3600, 60), `sampleMs` (int 250–60000, 1000), `yMin`, `yMax` (số; cả hai vắng = tự co; một trong hai thì lỗi `E_WIDGET_PROP`), `legend` (true), `grid` (true), `labels` (mảng ≤ 8 chuỗi ≤ 40; thiếu thì dùng mô tả hoặc id Tag; dài hơn số Tag là lỗi) |
| `bar` | 400×260 / 160×120 | `series` bắt buộc, `multi`, `max` 12: number, bool | `orientation` (`vertical`, `horizontal`; `vertical`), `min`, `max` (vắng = tự co từ 0), `decimals` (0–6, 1), `showValues` (true), `labels` (mảng ≤ 12) |
| `pie` | 280×280 / 120×120 | `series` bắt buộc, `multi`, `max` 8: number | `donut` (true), `decimals` (0–6, 1), `showPercent` (true), `showTotal` (false; donut hiện tổng ở giữa), `labels` (mảng ≤ 8) |
| `tag-table` | 420×300 / 240×80 | `rows` bắt buộc, `multi`, `max` 50: number, bool, string | `columns` (mảng gồm `label`, `value`, `unit`, `quality`, `updated`, không trùng; mặc định `["label","value","unit","quality"]`), `sortable` (true), `dense` (false), `labels` (mảng ≤ 50) |

### 2.3 Điều khiển

Mọi widget điều khiển có nhóm `security`: **`security.minRole`** (`operator`, `engineer`, `administrator`; mặc định `operator`). `viewer` là `E_WIDGET_MINROLE`.

| `id` | Cỡ mặc định / tối thiểu | Khe Tag | Thuộc tính (mặc định) | Sự kiện |
|---|---|---|---|---|
| `button` | 160×48 / 64×32 | `target`: number, bool, string; `needsWrite`; chỉ khi hành động là `write`, `toggle`, `pulse` | `label` (≤ 40, ""), `variant` (`primary`, `neutral`, `danger`; `primary`), `confirm` (`always`, `none`; `always`), `confirmText` (≤ 200, "") | `click`: `write`, `toggle`, `pulse`, `navigate`, `popup`, `closePopup` |
| `switch` | 160×48 / 64×32 | `target` bắt buộc: bool; `needsWrite` | `label`, `onText` (≤ 16, "Bật"), `offText` (≤ 16, "Tắt"), `confirm` (`always`, `none`; `always`), `confirmText` | không (ghi giá trị đối lập, kèm `expect`) |
| `setpoint` | 220×72 / 120×48 | `target` bắt buộc: number; `needsWrite` | `label`, `min`, `max` (số; nằm trong giới hạn của Tag), `step` (> 0; vắng = 10^−decimals), `decimals` (0–6, 1), `unit` (vắng = theo Tag), `confirmText` | không (ghi giá trị đã gõ) |
| `slider` | 280×64 / 120×32 | `target` bắt buộc: number; `needsWrite` | `label`, `min`, `max`, `step`, `decimals`, `unit`, `orientation` (`horizontal`, `vertical`; `horizontal`), `confirmText` | không (ghi giá trị khi thả) |
| `select` | 220×72 / 120×48 | `target` bắt buộc: number, bool; `needsWrite` | `label`, `table` (tên bảng giá trị; vắng = bảng của Tag; không có cả hai là `E_WIDGET_PROP`), `confirmText` | không (ghi giá trị của mục chọn) |

`confirm` = `none` chỉ hợp lệ khi Tag BOOL (`E_WIDGET_CONFIRM` nếu không) và luôn có cảnh báo `W_CONFIRM_NONE`. `setpoint`, `slider`, `select` không có thuộc tính `confirm`: luôn xác nhận.

## 3. Hành động (`events.click`)

Một đối tượng có khóa `action`:

| `action` | Tham số | Dùng khe `target` | Luật |
|---|---|---|---|
| `write` | `value` (BOOL, số hoặc chuỗi) | có | kiểu của `value` khớp kiểu Tag (`E_ACTION`); số nằm trong `Tag.limits` (`E_ACTION`); chuỗi ≤ `limits.maxLength`; Tag `RW` thật sự, không `calculated`, `simulation` chỉ khi `sim.kind = manual` (`E_TAG_ACCESS`) |
| `toggle` | không | có | Tag BOOL; ghi giá trị đối lập với giá trị đang thấy, kèm `expect` |
| `pulse` | `value` (BOOL), `durationMs` (int 100–10000) | có | Tag BOOL RW; BL335 ghi `value`, chờ, ghi giá trị ngược. Cảnh báo `W_PULSE_READBACK` khi Tag bật đọc lại (`source.readback` ≠ false) |
| `navigate` | `screen` | không (có `tags.target` là `E_WIDGET_SLOT`) | `screen` phải là màn hình `screen` (`E_ACTION_TARGET`) |
| `popup` | `screen` | không | `screen` phải là màn hình `popup` (`E_ACTION_TARGET`) |
| `closePopup` | không | không | chỉ có nghĩa khi nút nằm trong popup; ở màn hình thường: cảnh báo `W_ACTION_NOOP` |

Khóa lạ trong đối tượng hành động: `E_ACTION`. Không có hành động nào khác.

## 4. Luật chung cho `tags`

- Mỗi khe trong `tags` phải có trong danh mục (`E_WIDGET_SLOT`); khe bắt buộc thiếu là `E_WIDGET_SLOT`.
- Khe `multi` là mảng id Tag, 1–`max` phần tử, không trùng; khe thường là một chuỗi.
- Tag không có trong `tags.json`: `E_REF_TAG`; kiểu không thuộc `types`: `E_WIDGET_TAG_TYPE`; khe `needsWrite` mà Tag R, `calculated` hay `simulation` không nhập tay: `E_TAG_ACCESS`.
- `props.table` (và `Tag.valueTable`) tham chiếu bảng không có: `E_REF_TABLE`.
- `setpoint`, `slider`: `Tag.limits` và `props.min`/`props.max` phải thỏa `Tag.limits.min ≤ props.min < props.max ≤ Tag.limits.max` (khi cả hai có); nới rộng hơn Tag là `E_WIDGET_LIMITS`. Không có giới hạn ở cả hai nơi: `W_WRITE_NO_LIMITS` (mã của 006).

## 5. Vector

`tests/widget-catalog-vectors/<tên>/{screen.json, tags.json, expect.json}`: mỗi ca có màn hình tối thiểu, Tag cần thiết và danh sách `{code, path}` mong đợi. Tối thiểu: một ca hợp lệ và một ca vi phạm cho mỗi mã ở [project-format-0.3.md](project-format-0.3.md) §7; một ca hợp lệ cho mỗi loại widget với mọi thuộc tính ở giá trị biên. Hai validator phải trùng kết luận ở 100 % ca (SC-012).
