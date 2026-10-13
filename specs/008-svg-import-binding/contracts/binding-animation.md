# Contract: binding 0.4 và animation (`@mat/binding-engine`)

**Feature**: [spec.md](../spec.md) FR-002, FR-032…FR-041, FR-048 · **Research**: R8–R12 · **ADR**: [024](../../../docs/adr/024-binding-animation-0.4.md) · Định dạng file: [project-format-0.4.md](project-format-0.4.md) §4–§5

Bổ sung cho `DomApplier`, `evaluateBinding`, `applyTransform` hiện có ([packages/binding-engine](../../../packages/binding-engine/src/)). Mọi điều trong 0.2 giữ nguyên với binding đang chạy (kiểm bằng test hiện có), trừ một thay đổi hành vi có chủ ý ở §3 (giữ `transform` gốc).

## 1. Kiểu dữ liệu

```ts
export type Target04 =
  | 'style.fill' | 'style.stroke' | 'style.opacity' | 'style.visibility' | 'text.content'
  | 'transform.rotate' | 'transform.translateX' | 'transform.translateY' | 'transform.scale'
  | 'geometry.levelPercent' | 'geometry.clipLevel' | 'effect.blink' | 'effect.flow';

export type Transform04 =
  | { kind: 'direct' }
  | { kind: 'discreteMap'; cases: Array<{ equals: Scalar; value: Scalar }>; default?: Scalar }
  | { kind: 'linearScale'; inMin: number; inMax: number; outMin: number; outMax: number; clamp?: boolean }
  | { kind: 'valueTable'; table?: string; output: 'text' | 'color' }
  | { kind: 'rangeMap'; ranges: Array<{ from?: number; to?: number; value: Scalar }>; default?: Scalar };

export interface Binding04 {
  id: string; target: Target04;
  source: { type: 'tag'; tagId: string };
  transform: Transform04;
  onBadQuality?: { mode: 'hold' | 'override'; value?: Scalar };
  // tham số theo đích
  animation?: 'spin';                       // transform.rotate
  reverse?: boolean;                        // spin, effect.flow
  pivot?: [number, number];                 // transform.rotate, transform.scale; mặc định [0.5, 0.5]
  axis?: 'xy' | 'x' | 'y';                  // transform.scale; mặc định 'xy'
  direction?: 'up' | 'down' | 'left' | 'right';   // geometry.levelPercent, geometry.clipLevel; mặc định 'up'
  format?: { decimals?: number; prefix?: string; suffix?: string; unitFromTag?: boolean };  // text.content
  period?: number; mode?: 'opacity' | 'fill' | 'stroke'; minOpacity?: number; color?: string;  // effect.blink
  dash?: string; speed?: number; byValueSign?: boolean;      // effect.flow
}
```

## 2. Đích: kiểu, miền, mặc định

Giá trị Tag vào phép biến đổi; **đầu ra** là giá trị cho đích. `Tag` = kiểu Tag cho phép (BOOL, số = INT*/UINT*/FLOAT*, STRING).

| Đích | Tag | Phép biến đổi | Đầu ra và miền | Mặc định tham số | Chất lượng xấu (mặc định) |
|---|---|---|---|---|---|
| `text.content` | mọi | `direct`, `discreteMap`, `valueTable` (`text`), `rangeMap` | chuỗi; `direct` số: `toFixed(decimals)`; thêm `prefix`, rồi `suffix` hoặc ` ` + đơn vị Tag nếu `unitFromTag` (`suffix` thắng) | `decimals` vắng: giữ số như nhận | `--` |
| `style.fill`, `style.stroke` | mọi | `discreteMap`, `valueTable` (`color`), `rangeMap` | màu hợp lệ (`#RGB`, `#RRGGBB`, tên 3–20 chữ), hoặc `""` = giữ màu gốc | | màu trung tính `#8d99a3` |
| `style.opacity` | số, BOOL | `direct`, `linearScale`, `discreteMap`, `rangeMap` | số kẹp [0, 1] | | 0,5 |
| `style.visibility` | BOOL, số | `direct` (BOOL), `discreteMap`, `rangeMap` | `visible` / `hidden` (BOOL true = `visible`) | | giữ |
| `transform.rotate` | số | `direct`, `linearScale`, `discreteMap`, `rangeMap` | độ (số hữu hạn) | `pivot [0.5, 0.5]` | giữ |
| `transform.rotate` + `animation: "spin"` | số, BOOL | như trên | vòng/phút ≥ 0; BOOL true = 600; tốc độ hiển thị kẹp ≤ 2 vòng/giây; 0 dừng | `reverse false` | dừng (0) |
| `transform.translateX`, `translateY` | số | `direct`, `linearScale`, `discreteMap`, `rangeMap` | đơn vị người dùng của nhóm cha, kẹp ±100.000 | | giữ |
| `transform.scale` | số | `direct`, `linearScale`, `discreteMap`, `rangeMap` | hệ số kẹp [0,01; 10] | `axis xy`, `pivot [0.5, 0.5]` | giữ |
| `geometry.levelPercent` | số | `direct`, `linearScale` | phần trăm kẹp [0, 100] | `direction up` | giữ |
| `geometry.clipLevel` | số | `direct`, `linearScale` | phần trăm kẹp [0, 100] | `direction up` | giữ |
| `effect.blink` | BOOL, số | `direct`, `discreteMap`, `rangeMap` | bật khi `true` hoặc số ≠ 0 | `period 1000`, `mode opacity`, `minOpacity 0.2` | tắt |
| `effect.flow` | BOOL, số | `direct`, `linearScale`, `discreteMap`, `rangeMap` | BOOL true: `speed` (mặc định 60) rồi bật, false: dừng; số: tốc độ \|s\| kẹp [0, 300] đơn vị/giây, 0 dừng | `dash "12 8"`, `speed 60`, `reverse false`, `byValueSign false` | dừng |

- `onBadQuality` giữ nghĩa 0.2: `hold` giữ hiển thị, `override` đặt giá trị thay thế (kiểu theo đích; chữ thay thế nguyên văn).
- Tag STRING chỉ vào `text.content`, `style.fill`, `style.stroke` (qua `discreteMap` khi `equals` là chuỗi) và `style.visibility` (`discreteMap`); vào đích khác là `E_TYPE_MISMATCH`.
- `rangeMap` chỉ cho Tag số (BOOL: dùng `discreteMap`).
- Phép biến đổi ngoài danh sách của đích: `E_BIND_TRANSFORM`. Tham số ngoài miền: `E_BIND_PARAM`.

## 3. Hợp biến đổi (ADR-024)

Phần tử có một hoặc nhiều binding thuộc `transform.rotate` (tĩnh hoặc `spin`), `transform.translateX/Y`, `transform.scale`:

1. Lúc dựng, một lần: `M0` = ma trận của thuộc tính `transform` gốc (đơn vị nếu không có); `bbox` = `getBBox()` cục bộ (đo lại khi phần tử vừa hiện hoặc hộp rỗng; chưa có hộp bao thì hoãn việc áp quay và co giãn tới lần áp kế, không ném lỗi); `transform-origin: 0 0`, `transform-box: view-box` đặt trên phần tử.
2. Với `pivot [px, py]`: điểm `c = (bbox.x + px·bbox.width, bbox.y + py·bbox.height)`.
3. Mỗi lần đổi, **một** lần ghi:
   `style.transform = "translate(tx, ty) matrix(M0) translate(crx, cry) rotate(rot) translate(-crx, -cry) translate(csx, csy) scale(sx, sy) translate(-csx, -csy)"`
   (bỏ đoạn không dùng: không có quay thì bỏ đoạn quay; không có co giãn thì bỏ đoạn co giãn).
   `tx`, `ty` ở đơn vị nhóm cha; `rot` độ; `sx`, `sy`: theo `axis` (`x`: `sy = 1`; `y`: `sx = 1`).
4. **Quay liên tục:** hoạt ảnh Web Animations trên `transform`, hai khung hình cùng cấu trúc (`rotate(0deg)` và `rotate(360deg)` hoặc `-360deg` khi `reverse`), `duration` 1.000 ms, `iterations` vô hạn, `easing: linear`; `updatePlaybackRate(rps)` đổi tốc độ; khi `tx, ty, sx, sy` đổi thì `effect.setKeyframes()`; `rps = 0` thì `pause()`.
5. Thuộc tính `transform` gốc **không bị sửa** trong DOM.

**Thay đổi so với 0.2:** 0.2 đặt `style.transform = rotate(<độ>deg)` (che `transform` gốc). 0.4 giữ `M0`. Phần tử không có `transform` gốc, tâm `[0.5, 0.5]`: hiển thị giống 0.2.

**Không hợp được** (E_DUP_BINDING): `transform.rotate` tĩnh và `animation: "spin"` trên cùng phần tử; hai binding cùng đích.

## 4. Hành vi từng đích

### 4.1 `text.content`
`el.textContent = chuỗi` (không bao giờ HTML). Phần tử là `text` hoặc `tspan` (khác: cảnh báo `W_BIND_ELEMENT_KIND`; vẫn chạy: đặt `textContent` của phần tử khác `text` thay con của nó, nên Studio chỉ đề nghị cho `text`).

### 4.2 `style.fill`, `style.stroke`
`style.setProperty('fill'|'stroke', màu)`; `""` = `style.removeProperty` (trở về thuộc tính gốc).

### 4.3 Mức chất lỏng
- `geometry.levelPercent` (chỉ `rect`): như 0.2 (`y/height` hoặc `x/width` từ hộp `rect` đo một lần); trên phần tử không phải `rect`: bỏ qua và `console.warn` một lần (không ném lỗi, không đổi hiển thị); validator TS cảnh báo `W_BIND_ELEMENT_KIND`.
- `geometry.clipLevel` (mọi phần tử gắn được): lúc dựng tạo `<clipPath id="mat-clip-<uid>" clipPathUnits="userSpaceOnUse"><rect/></clipPath>` trong `<defs>` của item (tạo `<defs>` nếu chưa có); đặt `clip-path="url(#mat-clip-<uid>)"` trên phần tử; `rect` cắt theo `bbox` cục bộ: `up`: `y = bbox.y + bbox.height·(1 − p)`, `height = bbox.height·p`, `x`, `width` = hộp; `down`: `y = bbox.y`, `height = bbox.height·p`; `right`: `x = bbox.x`, `width = bbox.width·p`; `left`: `x = bbox.x + bbox.width·(1 − p)`, `width = bbox.width·p`. `p` ∈ [0, 1]. Làm tròn 2 chữ số thập phân (như 0.2).
- `dispose()` gỡ `clipPath` và thuộc tính `clip-path` đã đặt.

### 4.4 `style.opacity`, `style.visibility`
`style.setProperty('opacity'|'visibility')`. Khi `visibility` thành `hidden`: đặt `pointer-events: none` và (nếu có sự kiện) `tabindex=-1`; hiện lại thì khôi phục (xem [svg-events.md](svg-events.md) §4).

### 4.5 `effect.blink`
- Web Animations: `opacity` giữa `1` và `minOpacity`, hoặc `fill`/`stroke` giữa giá trị hiện tại và `color` (bắt buộc khi `mode` ≠ `opacity`); hai khung hình, `easing: steps(1, jump-none)`, `duration` = `period`, `iterations` vô hạn.
- **Chung pha:** `startTime` = `floor(document.timeline.currentTime / period) · period` cho mọi hoạt ảnh nhấp nháy cùng `period` của một màn hình.
- Tắt: `cancel()` và xóa thuộc tính `style` đã đặt.
- `prefers-reduced-motion: reduce`: không tạo hoạt ảnh; bật = `style.opacity = 1` (mode `opacity`) hoặc `fill`/`stroke` = `color`; tắt = trả về gốc.

### 4.6 `effect.flow`
- Điều kiện: phần tử có nét (`stroke` ≠ `none`); nếu chưa có `stroke-dasharray` thì `style.setProperty('stroke-dasharray', dash)`.
- Web Animations: `strokeDashoffset: 0 → -P` (`P` = tổng các số của `dash`, nhân đôi nếu số phần tử lẻ), `duration = P / 60 · 1000` ms (tốc độ gốc 60 đơn vị/giây), `iterations` vô hạn, `easing: linear`, `direction` thuận hoặc `reverse`; tốc độ `s` đặt bằng `updatePlaybackRate(s / 60)`; `s = 0` thì `pause()`.
- Chiều: `reverse` XOR (`byValueSign` và giá trị < 0).
- `prefers-reduced-motion`: đứng yên (không hoạt ảnh); `stroke-dasharray` vẫn đặt.

## 5. Hoạt ảnh vô hạn, tab ẩn, dọn dẹp

- Hoạt ảnh vô hạn = `spin`, `effect.blink` bật, `effect.flow` bật. Mỗi `DomApplier` tạo ít hoạt ảnh nhất có thể (một cho mỗi phần tử và loại).
- Tab ẩn (`document.hidden`): `pause()` mọi hoạt ảnh; hiện lại: `play()` theo trạng thái (như `spin` 0.2); nhấp nháy tính lại pha khi hiện lại.
- `dispose()`: `cancel()` mọi hoạt ảnh, gỡ `clipPath` đã tạo, gỡ nghe `visibilitychange` và `matchMedia`.
- Không gọi `getBBox` mỗi lần cập nhật: chỉ khi dựng hoặc khi hộp rỗng và phần tử vừa hiện.

## 6. API `DomApplier` (mở rộng)

```ts
export interface DomApplierOptions {
  // … như hiện nay (elements, bindings, raf, isHidden, doc, tagTypes, valueTables, tagValueTables)
  /** Đơn vị của Tag (cho `format.unitFromTag`). */
  tagUnits?: Record<string, string | undefined>;
  /** Đo hộp bao cục bộ; mặc định `el.getBBox()`. Test thay bằng hàm giả. */
  measure?: (el: Element) => { x: number; y: number; width: number; height: number };
  /** `prefers-reduced-motion`; mặc định `matchMedia('(prefers-reduced-motion: reduce)')`. */
  reducedMotion?: () => boolean;
  /** Đồng hồ trang cho pha nhấp nháy; mặc định `document.timeline.currentTime`. */
  now?: () => number;
}
class DomApplier {
  readonly missing: string[];
  writes: number;
  /** Số hoạt ảnh vô hạn đang tồn tại (dùng cho đo và cảnh báo). */
  animationCount(): number;
  tagIds(): string[];
  update(changes: TagUpdate[]): void;
  flush(): void;
  dispose(): void;
}
```

`bindings: ElementBindings02[]` đọc cả `ElementBindings04` (cùng `elementUid` và `bindings`; `events` do `ui-components` xử lý, không phải `DomApplier`).

## 7. Bộ ca kiểm (viết trước)

| Nhóm | Ca |
|---|---|
| Chuyển đổi (`evaluateBinding`) | `rangeMap` ở biên (`from` bao gồm, `to` không bao gồm; −∞, +∞; `default`; không khớp); `text.content` với `decimals`, `prefix`, `suffix`, `unitFromTag`, bảng giá trị, khoảng; `blink` với BOOL, số 0, số khác 0, `discreteMap`; `flow` BOOL, số, âm với `byValueSign`; `translate`, `scale` kẹp; chất lượng xấu cho từng đích |
| Hợp biến đổi (jsdom + `measure` giả) | `M0` đơn vị và `M0` = dời/quay 90°/co giãn/lệch; tâm 9 điểm; quay + dời + co giãn cùng lúc (chuỗi `style.transform` đúng); một lần ghi mỗi lần flush; `spin` có `setKeyframes` khi `tx` đổi |
| Mức | `levelPercent` (hộp `rect`), `clipLevel` bốn hướng ở 0, 50, 100 %; `clipPath` được tạo một lần, gỡ khi `dispose` |
| Hoạt ảnh (Web Animations giả) | tạo/hủy đúng; `updatePlaybackRate`; tab ẩn tạm dừng; `reducedMotion` đúng; chung pha nhấp nháy |
| Tương thích 0.2 | toàn bộ test hiện có của `applier.test.ts`, `transforms.test.ts` giữ xanh; `compat` (web-it) |
| Trình duyệt thật (e2e) | `clipLevel` trên `path` cong và nhóm; quay quanh gốc kim; dòng chảy chạy (offset đổi theo thời gian); nhấp nháy đổi opacity; tab ẩn |
