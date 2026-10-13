# Contract: thư viện ký hiệu (`@mat/symbols`)

**Feature**: [spec.md](../spec.md) US4, FR-055…FR-058 · **Research**: R17 · **ADR**: [026](../../../docs/adr/026-symbol-library-svg-editing.md)

Package `packages/symbol-library` (`@mat/symbols` 0.1.0, `private`): SVG sạch do dự án vẽ, siêu dữ liệu bộ phận và điểm gắn. Studio nạp lúc khởi động; **không** vào gói của trang runtime.

## 1. Cấu trúc

```text
packages/symbol-library/
├── manifest.json
├── svg/<tệp>.svg           # 15 tệp (cút có 4 biến thể)
├── LICENSES.md             # CC0-1.0; nguồn gốc: do dự án vẽ; không logo, hình, font của hãng
├── src/{index.ts, manifest.ts, ports.ts}
└── tests/*.test.ts
```

## 2. `manifest.json`

```json
{
  "schemaVersion": "1",
  "license": "CC0-1.0",
  "categories": [ { "id": "tank", "name": "Bồn" }, { "id": "pump", "name": "Bơm" }, { "id": "valve", "name": "Van" },
                  { "id": "motor", "name": "Motor" }, { "id": "pipe", "name": "Ống" } ],
  "symbols": [
    { "id": "pump-centrifugal", "name": "Bơm ly tâm", "category": "pump",
      "file": "svg/pump-centrifugal.svg", "viewBox": [0, 0, 100, 100], "defaultSize": [120, 120],
      "keywords": ["bơm", "pump", "ly tâm"],
      "parts": [
        { "role": "body",     "uid": "el_pump_centrifugal_body",     "label": "Thân bơm",  "suggest": ["fill"] },
        { "role": "impeller", "uid": "el_pump_centrifugal_impeller", "label": "Cánh bơm",  "suggest": ["spin"] },
        { "role": "lamp",     "uid": "el_pump_centrifugal_lamp",     "label": "Đèn trạng thái", "suggest": ["fill", "blink"] },
        { "role": "hit",      "uid": "el_pump_centrifugal_hit",      "label": "Vùng nhấp", "suggest": ["click"] } ],
      "ports": [
        { "id": "in",  "x": 0, "y": 0.5, "dir": "w", "kind": "pipe" },
        { "id": "out", "x": 0.5, "y": 0, "dir": "n", "kind": "pipe" } ] } ]
}
```

- `id`: `^[a-z][a-z0-9-]{1,31}$`; `file` đường dẫn trong package; `viewBox` khớp `viewBox` của tệp; `defaultSize` đơn vị thiết kế (số nguyên, giữ tỉ lệ `viewBox`).
- `parts[].uid`: `el_<id với "-" thành "_">_<role>`, khớp `^el_[a-z0-9_]{3,40}$`; **có trong tệp SVG** (`data-mat-uid`); `role` duy nhất trong ký hiệu; `suggest` ∈ id của [danh sách động hóa](studio-svg-editor.md) §5 (`text`, `fill`, `stroke`, `level`, `rotate`, `spin`, `translateX`, `translateY`, `scale`, `blink`, `flow`, `visibility`, `opacity`, `click`).
- `ports[]`: `x`, `y` ∈ [0, 1] tương đối trên `viewBox`; `dir` ∈ `n|e|s|w` (hướng **ra khỏi** ký hiệu); `kind` ∈ `pipe` (mở rộng sau).
- Biến thể (cút): `variants: [{ id: "ws", file, ports }]`; mỗi biến thể là một tệp SVG riêng, một mục trong Toolbox.

## 3. Danh sách ký hiệu (12 mục, 15 tệp)

| Id | Tên | Nhóm | `viewBox` | Bộ phận (`role`) | Điểm gắn |
|---|---|---|---|---|---|
| `tank-vertical` | Bồn đứng | tank | 100 × 160 | `body`, `liquid`, `text`, `hit` | `top` (n), `bottom` (s), `west` (w, 0,8), `east` (e, 0,8) |
| `tank-horizontal` | Bồn nằm | tank | 160 × 100 | `body`, `liquid`, `text` | `west`, `east`, `top`, `bottom` |
| `pump-centrifugal` | Bơm ly tâm | pump | 100 × 100 | `body`, `impeller`, `lamp`, `hit` | `in` (w), `out` (n) |
| `pump-dosing` | Bơm định lượng | pump | 100 × 100 | `body`, `plunger`, `lamp`, `hit` | `in` (w), `out` (e) |
| `valve-gate` | Van cổng | valve | 60 × 60 | `body`, `handwheel`, `hit` | `in` (w), `out` (e) |
| `valve-control` | Van điều khiển | valve | 60 × 80 | `body`, `actuator`, `stem` | `in` (w), `out` (e) |
| `valve-check` | Van một chiều | valve | 60 × 60 | `body`, `arrow` | `in` (w), `out` (e) |
| `motor-ac` | Motor AC | motor | 120 × 90 | `body`, `rotor`, `lamp`, `text`, `hit` | `shaft` (e) |
| `fan` | Quạt | motor | 100 × 100 | `body`, `blades`, `lamp` | `in` (w), `out` (e) |
| `pipe-h` | Ống ngang | pipe | 100 × 20 | `pipe`, `flow` | `west` (w), `east` (e) |
| `pipe-v` | Ống đứng | pipe | 20 × 100 | `pipe`, `flow` | `top` (n), `bottom` (s) |
| `pipe-elbow` | Cút | pipe | 40 × 40 | `pipe`, `flow` | theo biến thể: `ws`, `wn`, `es`, `en` (hai điểm) |

Gợi ý `suggest` mặc định: `liquid` → `level`; `text` → `text`; `impeller`, `rotor`, `blades` → `spin`; `lamp` → `fill`, `blink`; `flow` → `flow`; `pipe`, `body`, `actuator` → `fill`; `plunger` → `translateX`; `handwheel` → `rotate`; `stem` → `translateY`; `arrow` → `visibility`; `hit` → `click`.

## 4. Quy tắc vẽ (kiểm bằng test)

- Qua `sanitizeSvg` (allowlist) mà **không bị loại gì** (`report` rỗng) và qua `importSvg` với `converted` rỗng.
- Chỉ thuộc tính trình bày (không `<style>`, không `class`); không `id` (UID là `data-mat-uid`); có `<title>` ở gốc.
- Màu trung tính (`#37474f` nét, `#eceff1`/`#b0bec5` nền, `#1e88e5` nước); độ rộng nét 2; tọa độ nguyên hoặc một chữ số thập phân.
- ≤ 8 KB mỗi tệp; ≤ 60 phần tử mỗi tệp.
- Mọi `parts[].uid` có đúng một phần tử `data-mat-uid` tương ứng; phần tử có UID nằm ngoài `defs`; mọi điểm gắn nằm trong hộp bao `viewBox`; `viewBox` của tệp bằng `manifest`.
- `liquid` là hình có hộp bao phủ phần trong của bồn (cho `clipLevel`); `flow` là đường có nét và `stroke-dasharray`; `impeller`/`rotor`/`blades` là nhóm có tâm ở giữa (quay quanh `[0,5; 0,5]`).
- `hit` là hình trong suốt (`fill="none"`, `stroke="none"`) phủ vùng nhấp được (nhận nhấp nhờ `pointer-events: all`).

## 5. Thể hiện (instance) trong project

Khi kéo ký hiệu vào canvas, Studio:

1. sao tệp SVG vào `graphics/symbols/<tệp>` nếu project chưa có (nhiều thể hiện dùng chung);
2. tạo item `svg`: `id` `<id ký hiệu rút gọn>_<số>` (≤ 32 ký tự), `name` = tên ký hiệu, `x`, `y` điểm thả (dính lưới), cỡ `defaultSize`, `viewBox`, `fit: "contain"`, `svgFile`, `bindingFile` `screens/<màn hình>.<item>.bindings.json` (tạo mới, rỗng `elements: []`), `elements` liệt kê các bộ phận (`elementUid`, `name` = `label`);
3. một bước hoàn tác.

## 6. Điểm gắn: dính khi kéo (`ports.ts`, thuần, có bảng test)

```ts
export interface PortRef { itemId: string; portId: string; x: number; y: number; dir: 'n'|'e'|'s'|'w'; kind: string; }
export function portSnap(moving: PortRef[], fixed: PortRef[], zoom: number,
  opt?: { thresholdPx?: number }): { dx: number; dy: number; pair: [PortRef, PortRef] } | null;
```

- `x`, `y`: toạ độ trong **đơn vị thiết kế** (đã đổi từ tương đối theo vị trí và cỡ item).
- Hai điểm tương thích khi cùng `kind` và hướng đối nhau (`w`↔`e`, `n`↔`s`); chọn cặp có khoảng cách (đơn vị màn hình = đơn vị thiết kế × `zoom`) nhỏ nhất ≤ `thresholdPx` (mặc định 10); trả độ dời để hai điểm trùng; hòa thì cặp đầu theo thứ tự id.
- Giữ Alt tắt dính; bắt dính lưới và đường gióng của 007 chạy trước, dính điểm gắn thắng khi cả hai cùng trúng.
- Hai điểm cùng hướng (không tương thích) không dính; không ghi gì vào project (không có đối tượng "nối").

## 7. Bộ ca kiểm

- Mỗi ký hiệu qua allowlist không loại gì; `manifest` hợp lệ theo schema; `parts` khớp tệp; điểm gắn trong hộp bao; giấy phép.
- `portSnap`: trùng khít, trong và ngoài ngưỡng, nhiều cặp (chọn gần nhất), hướng không tương thích, zoom 25 % và 400 %, `thresholdPx` khác, danh sách rỗng.
- e2e: kéo thả từng ký hiệu; dính hai ống; Gắn nhanh mở đúng dòng.
