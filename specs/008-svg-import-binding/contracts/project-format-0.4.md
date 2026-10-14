# Contract: định dạng project 0.4.0

**Feature**: [spec.md](../spec.md) FR-001…FR-010, FR-053 · **Data model**: [data-model.md](../data-model.md) §1–§4 · **Research**: R1, R8 · **ADR**: [024](../../../docs/adr/024-binding-animation-0.4.md), [025](../../../docs/adr/025-svg-element-events.md)

Bổ sung cho [project-format-0.3.md của 007](../../007-screens-widgets/contracts/project-format-0.3.md). Luật của 0.1, 0.2 và 0.3 giữ nguyên với project cùng phiên bản. Theo [ADR-004](../../../docs/adr/004-schema-versioning.md): thêm giá trị vào tập đóng (đích, phép biến đổi, tham số, sự kiện) làm runtime cũ từ chối file hợp lệ nên là MINOR khi MAJOR = 0, kèm migration: 0.3 → 0.4.

## 1. Phiên bản và tập file

| Điều | 0.1.x | 0.2.x | 0.3.x | 0.4.x |
|---|---|---|---|---|
| `schemaVersion` mỗi file | `^0\.1\.\d+$` | `^0\.2\.\d+$` | `^0\.3\.\d+$` | `^0\.4\.\d+$`, bằng `project.json` |
| Trộn các phiên bản | `E_SCHEMA_VERSION` | như cũ | như cũ | như cũ |
| `minRuntimeVersion` | như cũ | ≥ `0.5.0` | ≥ `0.6.0` | ≥ `0.7.0`, không thì `E_MIN_RUNTIME` |
| Schema dùng để kiểm | `schemas/0.1/` | `schemas/0.2/` | `schemas/0.3/` (đóng băng mới) | `schemas/*.schema.json`, `schemas/widgets.catalog.json` |
| Runtime nhận | 0.4–0.7 | 0.5–0.7 | 0.6–0.7 | 0.7 |
| Studio mở để sửa | sau nâng cấp | sau nâng cấp | sau nâng cấp lên 0.4 | có |
| Tối đa item `svg`/màn hình | | | 8 | 64 |

**Tập file của project 0.4** (`projectFiles()` ở TS, `LoadedProject::files()` ở C++): như 0.3 (`project.json`, `tagFile`, `connectionFile`, `loggingFile`, `value-tables/*`, `watch-tables/*`, `screens/<id>.screen.json`, `svgFile` và `bindingFile` của từng item `svg`, trùng chỉ tính một lần). Khác 0.3 ở thói quen đặt tên, không ở luật: `svgFile` thuộc `graphics/<tên>.svg` (SVG nhập) hoặc `graphics/symbols/<id>.svg` (thể hiện ký hiệu); `bindingFile` thuộc `screens/<màn hình>.<item>.bindings.json`. Luật đường dẫn (`isSafeRelPath`, `check_rel`: ≤ 128 byte, đuôi `.json`/`.svg`, không `..`) và trần 1 MiB mỗi file JSON không đổi. File `.svg` không có trần 1 MiB riêng: trần của item là 5 MiB (§6 `E_SVG_LIMIT`) và của gói 50 MiB (005).

Runtime phục vụ mọi file trong tập này ở `/project/<đường dẫn>` (allowlist dựng từ `projectFiles`), nên đường dẫn `graphics/…` không cần đổi mã phục vụ.

## 2. `project.json`

Khác 0.3: `schemaVersion` `0.4.0`, `minRuntimeVersion` `0.7.0`. Không khóa mới.

## 3. `screens/<id>.screen.json`

Cấu trúc như 0.3. Khác:

- `schemaVersion` `0.4.x`;
- tối đa **64** item `type: "svg"` mỗi màn hình (lỗi `E_LIMIT` ở 65); trần 250 item mỗi màn hình giữ nguyên;
- hai item `svg` được dùng chung một `svgFile` (như 0.3); mỗi item **một** `bindingFile` riêng (hai item chung `bindingFile` là `E_SCHEMA`, như 0.3);
- `elements[]` của item chỉ cần liệt kê UID có binding, sự kiện hoặc tên riêng (xem [svg-import.md](svg-import.md) §5); `elements[].name` ≤ 80 ký tự giữ nghĩa 0.3.

```json
{ "id": "svg_bom1", "name": "Bơm 1", "type": "svg",
  "x": 320, "y": 400, "width": 160, "height": 160,
  "svgFile": "graphics/symbols/pump-centrifugal.svg",
  "bindingFile": "screens/bon-nuoc.svg_bom1.bindings.json",
  "viewBox": [0, 0, 100, 100], "fit": "contain",
  "elements": [ { "elementUid": "el_pump_impeller", "name": "Cánh bơm" },
                { "elementUid": "el_pump_body" } ] }
```

## 4. `*.bindings.json` (binding của một item `svg`)

Cấu trúc 0.3 (`schemaVersion`, `screenId`, `itemId`, `elements`) mở rộng:

- mỗi phần tử của `elements` có `elementUid` và **ít nhất một** trong `bindings` (1–16), `events`;
- `bindings[]` nhận đích, phép biến đổi và tham số của 0.4 (§5 và [binding-animation.md](binding-animation.md));
- `events` là `{ "click": <hành động> }` (hành động: [svg-events.md](svg-events.md) §2).

```json
{
  "schemaVersion": "0.4.0",
  "screenId": "bon-nuoc",
  "itemId": "svg_bon",
  "elements": [
    { "elementUid": "el_tank_liquid",
      "bindings": [
        { "id": "level", "target": "geometry.clipLevel",
          "source": { "type": "tag", "tagId": "TANK01.LEVEL" },
          "transform": { "kind": "linearScale", "inMin": 0, "inMax": 100, "outMin": 0, "outMax": 100, "clamp": true },
          "direction": "up" },
        { "id": "colour", "target": "style.fill",
          "source": { "type": "tag", "tagId": "TANK01.LEVEL" },
          "transform": { "kind": "rangeMap",
            "ranges": [ { "to": 20, "value": "#d32f2f" }, { "from": 20, "to": 80, "value": "#1e88e5" }, { "from": 80, "value": "#d32f2f" } ],
            "default": "#9e9e9e" } } ] },
    { "elementUid": "el_tank_text",
      "bindings": [
        { "id": "value", "target": "text.content",
          "source": { "type": "tag", "tagId": "TANK01.LEVEL" },
          "transform": { "kind": "direct" },
          "format": { "decimals": 1, "unitFromTag": true } } ] },
    { "elementUid": "el_pipe_in",
      "bindings": [
        { "id": "flow", "target": "effect.flow",
          "source": { "type": "tag", "tagId": "PUMP01.RUN" },
          "transform": { "kind": "direct" },
          "dash": "12 8", "speed": 80 } ] },
    { "elementUid": "el_pump_hit",
      "events": { "click": { "action": "pulse", "tag": "PUMP01.RUN_CMD", "value": true, "durationMs": 500,
                             "confirm": "always", "minRole": "operator", "label": "Khởi động bơm 1" } } }
  ]
}
```

## 5. Đích, phép biến đổi và tham số (tóm tắt)

Chi tiết (miền giá trị, ngữ nghĩa, mặc định, `onBadQuality`) ở [binding-animation.md](binding-animation.md).

| `target` | Phép biến đổi cho phép | Tham số riêng (cạnh `transform`) |
|---|---|---|
| `text.content` | `direct`, `discreteMap`, `valueTable` (`output: text`), `rangeMap` | `format`: `decimals` 0–6, `prefix` ≤ 16, `suffix` ≤ 16, `unitFromTag` |
| `style.fill`, `style.stroke` | `direct` (Tag STRING chứa màu; giữ từ 0.2 để nâng cấp 0.3 → 0.4 không đổi binding), `discreteMap`, `valueTable` (`output: color`), `rangeMap` | |
| `style.opacity` | `direct`, `linearScale`, `discreteMap`, `rangeMap` | |
| `style.visibility` | `direct` (Tag BOOL, hoặc STRING `visible`/`hidden` như 0.2), `discreteMap`, `rangeMap` | |
| `transform.rotate` | `direct`, `linearScale`, `discreteMap`, `rangeMap` | `pivot` `[x, y]` ∈ [0, 1]²; `animation: "spin"` (rpm), `reverse` |
| `transform.translateX`, `transform.translateY` | `direct`, `linearScale`, `discreteMap`, `rangeMap` | |
| `transform.scale` | `direct`, `linearScale`, `discreteMap`, `rangeMap` | `axis` `xy` (mặc định), `x`, `y`; `pivot` |
| `geometry.levelPercent` | `direct`, `linearScale` | `direction` `up` (mặc định), `down`, `left`, `right` |
| `geometry.clipLevel` | `direct`, `linearScale` | `direction` |
| `effect.blink` | `direct`, `discreteMap`, `rangeMap` | `period` 400–5000, `mode` `opacity` (mặc định), `fill`, `stroke`, `minOpacity` 0–0,9, `color` |
| `effect.flow` | `direct`, `linearScale`, `discreteMap`, `rangeMap` | `dash` (mẫu nét đứt), `speed` 0–300, `reverse`, `byValueSign` |

`component.state` giữ `E_TARGET_UNSUPPORTED`. `format` và `expression` (phép biến đổi) giữ `E_TRANSFORM_UNSUPPORTED`.

**`rangeMap`:** `{ kind: "rangeMap", ranges: [ { from?, to?, value }, … ], default? }`; 1–64 khoảng; `from` bao gồm, `to` không bao gồm (nửa mở `[from, to)`); `from` vắng = −∞, `to` vắng = +∞; ít nhất một trong hai; không chồng nhau (`E_RANGE`); `value` thuộc kiểu đầu ra của đích (màu, chữ, số, `visible`/`hidden`, boolean cho nhấp nháy).

**Nhóm đích** (một binding mỗi nhóm trên một phần tử, vi phạm là `E_DUP_BINDING`): chữ; màu nền; màu viền; độ mờ; hiện ẩn; quay (gồm `transform.rotate` và `spin`); di chuyển X; di chuyển Y; co giãn; mức (gồm `geometry.levelPercent` và `geometry.clipLevel`); nhấp nháy; dòng chảy.

## 6. Mã lỗi và cảnh báo của 0.4

Cột "Bản": **C** = cả TS và C++ (cùng vector, cùng mã); **TS** = chỉ bản TS (cần nội dung SVG; `core/` không parse SVG, Constitution II). Mã không có trong bảng giữ nghĩa 0.3.

| Mã | Mức | Bản | Điều kiện |
|---|---|---|---|
| `E_BIND_TRANSFORM` | lỗi | C | phép biến đổi không thuộc danh sách của đích (ví dụ `linearScale` cho `style.fill`) |
| `E_BIND_PARAM` | lỗi | C | tham số sai kiểu, ngoài miền, hoặc không thuộc đích (`period` 399, `pivot` 1,01, `speed` 301, `dash` sai mẫu, `minOpacity` 0,91, `axis` lạ, `prefix` > 16 ký tự) |
| `E_RANGE` | lỗi | C | khoảng chồng, `from` ≥ `to`, thiếu cả `from` và `to`, > 64 khoảng |
| `E_EVENT_ACTION` | lỗi | C | khóa sự kiện khác `click`, hoặc hành động ngoài 6 hành động, hoặc thiếu/thừa trường theo hành động |
| `E_EVENT_TAG` | lỗi | C | hành động ghi: Tag không có, `access` ≠ `RW`, `kind` = `calculated`, `simulation` không nhập tay, kiểu giá trị sai kiểu Tag, giá trị ngoài `limits` của Tag |
| `E_EVENT_TARGET` | lỗi | C | `navigate` tới màn hình không có hoặc `popup`; `popup` tới màn hình không có hoặc `screen` |
| `E_EVENT_CONFIRM` | lỗi | C | `confirm` = `none` với Tag không phải BOOL |
| `E_EVENT_MINROLE` | lỗi | C | `minRole` = `viewer` hoặc giá trị lạ |
| `E_DUP_BINDING` | lỗi | C | hai binding cùng nhóm đích trên một phần tử (mở rộng nghĩa 0.2 từ "cùng đích") |
| `E_LIMIT` | lỗi | C | > 64 item `svg`; > 256 hoạt ảnh vô hạn trong một màn hình (đếm `spin`, `effect.blink`, `effect.flow` có Tag, không đếm `hidden`); các giới hạn 0.3 |
| `E_REF_UID` | lỗi | C | binding hoặc sự kiện trỏ `elementUid` không khai trong `elements` của item (và, ở TS, không có trong SVG: xem `W_UID_NOT_IN_SVG`) |
| `W_ANIM_MANY` | cảnh báo | C | > 64 hoạt ảnh vô hạn trong một màn hình |
| `W_BLINK_ONLY` | cảnh báo | C | phần tử có `effect.blink` theo một Tag mà không có binding `text.content`, `style.fill` hoặc `style.stroke` cùng Tag (nhấp nháy là tín hiệu duy nhất) |
| `W_EVENT_CONFIRM_NONE` | cảnh báo | C | `confirm` = `none` (BOOL) |
| `W_EVENT_PULSE_READBACK` | cảnh báo | C | `pulse` trên Tag bật đọc lại (như `W_PULSE_READBACK` của 007) |
| `E_SVG_UNSAFE` | lỗi | TS | file SVG của item không qua allowlist (còn phần tử, thuộc tính hoặc giá trị ngoài danh sách) |
| `E_SVG_LIMIT` | lỗi | TS | file SVG của item > 5 MiB, > 20.000 phần tử hoặc sâu hơn 32 |
| `W_SVG_HEAVY` | cảnh báo | TS | file SVG của item ≥ 1 MiB, hoặc ≥ 10.000 phần tử |
| `W_UID_NOT_IN_SVG` | cảnh báo | TS | như 0.2, 0.3 (cho cả sự kiện) |
| `W_BIND_ELEMENT_KIND` | cảnh báo | TS | đích không hợp loại phần tử: `text.content` trên không phải `text`; `geometry.levelPercent` trên không phải `rect`; `effect.flow` trên phần tử không có nét |
| `W_BIND_CLIP_EXISTS` | cảnh báo | TS | `geometry.clipLevel` trên phần tử đã có `clip-path` gốc |

Mã và vị trí (`path`) của vector chung so khớp từng ca; `message` không so.

## 7. Nâng cấp 0.3 → 0.4

Ở Studio (`migrate03to04` trong `@mat/project-schema`), trong bộ nhớ, sao lưu trước lần lưu đầu vào `.mat-backup/<giờ>/`:

1. `project.json`, `tags.json`, mọi file màn hình, binding, bảng giá trị, bảng theo dõi, kết nối, lưu trữ: `schemaVersion` → `0.4.0` (mọi file; giữ nguyên các phần còn lại);
2. `project.json`: `minRuntimeVersion` → `0.7.0`;
3. không đổi nội dung binding, vị trí, Tag.

Từ 0.1 hoặc 0.2: chuỗi `migrate01to02`, `migrate02to03`, `migrate03to04` trong cùng một lần lưu. Tất định: cùng đầu vào cùng byte đầu ra (cặp file mẫu `tests/migration-vectors/*-0.3to0.4/`).

## 8. Bộ vector

- `tests/project-vectors/generate.mjs`: ca `v04-*` ≥ 100 (hợp lệ và không hợp lệ): mỗi mã chung (cột C) ≥ 1 ca đúng và ≥ 1 ca sai; ca biên: `period` 399/400/5000/5001, `speed` 0/300/301, `pivot` −0,01/0/1/1,01, `minOpacity` 0/0,9/0,91, 63/64/65 khoảng `rangeMap`, 64/65 item `svg`, 64/65 và 256/257 hoạt ảnh, `label` 80/81, `durationMs` 100/99/10000/10001; ca kết hợp (cùng phần tử có quay + di chuyển + co giãn + màu; hai binding cùng nhóm; sự kiện không binding; phần tử không có cả `bindings` lẫn `events`); ca từ chối phiên bản (0.4 với `minRuntimeVersion` 0.6.0).
- `packages/project-schema/src/vectors-04.test.ts` (TS) và `core/project-manager/tests/vectors_04_test.cpp` (C++) chạy cùng thư mục.
- Vector 0.1, 0.2 và 0.3 giữ nguyên kết luận (SC-012).
- Mã chỉ ở TS (cột TS) có test riêng ở `rules-04.test.ts` với SVG dựng trong bộ nhớ.

## 9. Tương thích

| | Runtime 0.5 | 0.6 | 0.7 |
|---|---|---|---|
| Project 0.1/0.2 | chạy (0.5 nhận 0.1/0.2) | chạy | chạy |
| Project 0.3 | từ chối (`E_SCHEMA_VERSION`) | chạy | chạy |
| Project 0.4 | từ chối | từ chối (`E_SCHEMA_VERSION`; `minRuntimeVersion` 0.7.0) | chạy |

Studio 0.6.0: mở project 0.1–0.3 sau khi nâng cấp (hoặc chỉ đọc); Nạp xuống project 0.4 lên thiết bị chạy runtime < 0.7.0 bị khóa ở dòng "Tương thích runtime" (005).
