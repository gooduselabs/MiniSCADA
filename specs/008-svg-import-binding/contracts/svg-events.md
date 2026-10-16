# Contract: sự kiện của phần tử SVG

**Feature**: [spec.md](../spec.md) US3, FR-003, FR-049…FR-054 · **Research**: R13, R14 · **ADR**: [025](../../../docs/adr/025-svg-element-events.md) · Nền: [ui-components-api.md của 007](../../007-screens-widgets/contracts/ui-components-api.md), [device-api-1.2.md của 007](../../007-screens-widgets/contracts/device-api-1.2.md)

Phần tử SVG nhấp được dùng **cùng** `ControlController`, `ActionHost`, hộp xác nhận và `POST /api/v1/tags/write` với widget. Không thêm đường ghi, không thêm trường API (API thiết bị giữ 1.2.0).

## 1. Vị trí dữ liệu

Trong file binding của item `svg`: `elements[].events.click` (xem [project-format-0.4.md](project-format-0.4.md) §4). Sự kiện **không** nằm trong file SVG; thuộc tính `on*` của SVG luôn bị loại.

## 2. Hành động (`events.click`)

| `action` | Trường (bắt buộc **đậm**) | Ghi chú |
|---|---|---|
| `write` | **`tag`**, **`value`** (BOOL, số, chuỗi), `confirm`, `minRole`, `label` | Tag `RW`, không `calculated`, `simulation` chỉ khi nhập tay; `value` đúng kiểu và trong `limits` của Tag |
| `toggle` | **`tag`** (BOOL), `confirm`, `minRole`, `label` | gửi kèm `expect` như 007 |
| `pulse` | **`tag`** (BOOL), **`value`** (BOOL), **`durationMs`** (100–10.000), `confirm`, `minRole`, `label` | BL335 giữ nhịp (`pulseMs`) |
| `navigate` | **`screen`**, `label` | màn hình `screen` (không phải `popup`) |
| `popup` | **`screen`**, `label` | màn hình `popup` |
| `closePopup` | `label` | |

- `confirm`: `always` (mặc định) hoặc `none`; `none` chỉ khi Tag BOOL (`E_EVENT_CONFIRM`), cảnh báo `W_EVENT_CONFIRM_NONE`.
- `minRole`: `operator` (mặc định), `engineer`, `administrator`; `viewer` là `E_EVENT_MINROLE`. Hành động ghi luôn cần ít nhất `operator` ở BL335 (kiểm lại ở máy chủ, giao diện chỉ khóa sớm).
- `label` ≤ 80 ký tự: nhãn đọc cho trình đọc màn hình và hộp xác nhận.
- Trường thừa cho hành động (ví dụ `navigate` có `tag`) hoặc thiếu trường bắt buộc: `E_EVENT_ACTION`.
- Mỗi phần tử tối đa một sự kiện `click`.

## 3. Gắn lúc chạy

```ts
// @mat/ui-components, screen/svg-events.ts
export interface SvgEventsDeps {
  screenId: string;
  mounted: MountedScreen;                 // @mat/svg-renderer
  events: ReadonlyArray<{ elementUid: string; click: ElementAction }>;
  source: TagSource; host: ActionHost;
  status: StatusSink;                     // vùng role="status" của <mat-screen>
  mode: 'run' | 'edit';
  modal?: ModalRegistry;
  now(): number; uuid(): string;
}
export interface StatusSink { show(message: string, kind: 'info' | 'warn' | 'error' | 'ok'): void; }
export function bindSvgEvents(d: SvgEventsDeps): { refresh(): void; dispose(): void };

// controller cho hành động ghi: widget ảo
export function svgActionController(a: WriteAction, ctx: { screen: string; uid: string; label: string },
                                    deps: Omit<ControlDeps, 'item' | 'context'>): ControlController;
```

- `mode: 'edit'`: không gắn gì (nhấp là chọn của editor).
- Với mỗi phần tử có `click`: tìm bằng `mounted.elements.get(uid)`; không có thì bỏ qua và cảnh báo console một lần (mồ côi chặn ở validator).
- Đặt (lúc chạy, không lưu): `data-mat-clickable=""`, `role="button"`, `tabindex="0"`, `aria-label`, `style.cursor = pointer`, `style.pointerEvents = visible` (không dùng `all`: `all` bỏ qua visibility nên nút trong nhóm bị ẩn vẫn bấm được; `visible` vẫn nhận nhấp ở hình `fill: none`). Nghe `click` và `keydown` (`Enter`, `Space`) trực tiếp trên phần tử; `stopPropagation()` để phần tử sâu nhất thắng; `mousedown` ở một phần tử và `mouseup` ở phần tử khác không là nhấp (do `click` của trình duyệt đã xử lý).
- **Hành động ghi:** `svgActionController` dựng `WidgetItem` ảo
  `{ id: uid, type: 'widget', widget: 'button', x: 0, y: 0, width: 1, height: 1, tags: { target: tag }, props: { confirm }, events: { click: { action, value?, durationMs? } }, security: { minRole } }`
  và `context = { screen, widget: uid }`. Hộp xác nhận, khóa, "đang gửi", kết quả: của `ControlController`. `refresh()` gọi lại khi `TagSource`/`ActionHost` đổi (cập nhật khóa).
- **`navigate`, `popup`, `closePopup`:** `host.navigate(screen)`, `host.openPopup(screen)`, `host.closePopup()`; không khóa.

## 4. Con trỏ, bàn phím, ẩn

| Trạng thái | Thuộc tính trên phần tử |
|---|---|
| Sẵn sàng | `cursor: pointer`, `tabindex=0`, `aria-disabled` bỏ, không `data-mat-lock` |
| Khóa (mã `LockCode`) | `data-mat-lock="<mã>"`, `aria-disabled="true"`, `cursor: not-allowed`, `filter: grayscale(0.6)`; lý do trong phần tử `<title data-mat-runtime>` do mã chèn (tooltip gốc) và `aria-describedby` trỏ vùng `status`; nhấp hoặc Enter hiện lý do ở vùng `role="status"` (không gửi gì) |
| Đang gửi | `data-mat-lock="BUSY"`, nhãn "Đang gửi…" ở vùng `status` |
| Ẩn (do `style.visibility` = `hidden` hoặc `display: none`) | `pointer-events: none`, `tabindex=-1`; hiện lại: khôi phục |
| Popup đang mở | lớp phủ của popup che; phần tử nền không nhận nhấp (không cần xử lý riêng) |

Quy tắc CSS nằm trong `<style>` của Shadow DOM của item do mã tạo (không nằm trong SVG): `[data-mat-clickable]:focus-visible { outline: 2px solid var(--mat-focus, #1e88e5); outline-offset: 2px }`.

## 5. Mã khóa

Như 007 (`LockCode`): `NO_SESSION`, `ROLE`, `INSECURE`, `HTTPS_DOWN`, `SESSION_EXPIRED`, `LIVE_LOST`, `TAG_UNKNOWN`, `TAG_READONLY`, `QUALITY_BAD`, `NO_VALUE`, `BUSY`, `OTHER_DIALOG`, `PROJECT_CHANGING`; thông điệp tiếng Việt dùng lại `i18n/control-vi.ts`. UNCERTAIN không khóa, chỉ cảnh báo trong hộp xác nhận.

## 6. Audit

`POST /api/v1/tags/write` với `context: { screen: <id màn hình>, widget: <elementUid> }` (mẫu `^[a-z][a-z0-9_-]{0,63}$`; `elementUid` ≤ 43 ký tự, hợp mẫu). Audit `tag.write` ghi `channel` = `web` (hoặc `studio` ở xem trước Thiết bị), `detail.context`. Không có trường mới. `widget` ở audit của 007 là id item widget; ở sự kiện SVG là `elementUid` (tiền tố `el_` phân biệt được).

## 7. Luật kiểm tra (xem [project-format-0.4.md](project-format-0.4.md) §6)

`E_EVENT_ACTION`, `E_EVENT_TAG`, `E_EVENT_TARGET`, `E_EVENT_CONFIRM`, `E_EVENT_MINROLE`, `E_REF_UID`, `E_REF_TAG`; cảnh báo `W_EVENT_CONFIRM_NONE`, `W_EVENT_PULSE_READBACK`. Giới hạn Tag mỗi màn hình (1.000, `E_SCREEN_TAGS` của 007) tính cả Tag của sự kiện (đăng ký live cần giá trị hiện tại cho hộp xác nhận và khóa).

## 8. Bộ ca kiểm

| Nhóm | Ca |
|---|---|
| `svgActionController` (Vitest, `MemoryTagSource`, `ActionHost` giả) | mọi `LockCode` (13); xác nhận `always` và `none`; kết quả `ACCEPTED`→`CONFIRMED`, `REJECTED`, `TIMEOUT`, `FAILED`, `UNKNOWN`; `toggle` kèm `expect`; `pulse` kèm `pulseMs`; `context` đúng; không gửi lại |
| `bindSvgEvents` (jsdom) | thuộc tính đặt đúng; Enter/Space/nhấp; phần tử sâu nhất thắng; ẩn bỏ nhấp; `mode: edit` không gắn; `dispose` gỡ sạch; lý do khóa ở `<title>` và `status` |
| e2e trang (runtime giả, axe-core) | nhấp mở popup; chuyển màn hình; ghi có xác nhận; viewer khóa; Tab và Enter; không lỗi axe |
| web-it `svg` (x64 + giả lập Modbus) | nhấp phần tử → hộp xác nhận → ghi → `CONFIRMED`; audit `channel` `web`, `context.widget` = `elementUid`; 30 ca tấn công của 007 với nguồn phần tử SVG: 100 % từ chối, 0 lệnh tới giả lập, 100 % có audit |
