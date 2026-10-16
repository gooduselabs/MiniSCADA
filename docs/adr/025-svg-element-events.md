# ADR-025: Sự kiện của phần tử SVG: dữ liệu trong file binding, cùng đường ghi và cùng bộ điều khiển với widget

- **Trạng thái:** **Accepted** phần đã đo trên runtime x64 (feature 008, 2026-10-16): đường ghi, audit, 30 ca tấn công, khóa (SC-013). **Vẫn Proposed** phần chờ BL335 (T125: điều khiển thật, rút cáp PLC, `kill -9` giữa xung) và 4/13 mã khóa chưa tới được trên x64. Tổng hợp: [008-acceptance.md](../reports/008-acceptance.md).
- **Ngày:** 2026-10-16 (đề xuất 2026-10-13)
- **Liên quan:** [specs/008-svg-import-binding](../../specs/008-svg-import-binding/plan.md), research R13, R14, R21; contract [svg-events.md](../../specs/008-svg-import-binding/contracts/svg-events.md); [ADR-013](013-screen-model-v1.md) (hành động), [ADR-019](019-widget-library.md) (`ControlController`, `ActionHost`), [ADR-021](021-web-login-certificates.md) (đường ghi từ Chrome); lộ trình v2 §4.4; Constitution V.

## Bối cảnh

Roadmap §4.4: "nhấp để chuyển màn hình, mở popup, ghi/đảo/xung Tag (có xác nhận và kiểm quyền; dùng cùng đường ghi của 006/007)". 007 đã có sáu hành động, bộ điều khiển `ControlController` (khóa, xác nhận, kết quả), `ActionHost`, `POST /api/v1/tags/write` với `context`, `expect`, `pulseMs`, phiên web có cookie và CSRF.

Ràng buộc:

- sự kiện **không** được khai báo trong SVG: `on*` bị loại (ADR-023), SVG không thể tự mang hành vi;
- phần tử SVG nằm trong Shadow DOM của item, có thể là `fill: none`, có thể ẩn bởi binding;
- không thêm đường ghi, không đổi API 1.2.0 nếu không cần (Constitution V: mọi lệnh ghi qua backend kiểm role, quyền, trạng thái, audit);
- trợ năng: bàn phím, trình đọc màn hình.

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Nơi lưu sự kiện | trong SVG; trong file màn hình (`item.events`); file riêng; **trong file binding, khóa theo `elementUid`** | file binding |
| Bộ điều khiển | viết riêng cho SVG; **dùng `ControlController` qua widget ảo** | widget ảo |
| `context` của audit | thêm trường (API 1.2.1); **`context.widget` = `elementUid`** | `elementUid`, API giữ 1.2.0 |
| Gắn trình xử lý | thuộc tính `onclick` trong SVG; ủy quyền ở gốc; **nghe trực tiếp trên phần tử, từ dữ liệu đã kiểm** | trực tiếp |
| Vùng nhận nhấp | mặc định (`visiblePainted`); **`pointer-events: all` cho phần tử có sự kiện, `none` khi ẩn** | `all` |
| Bàn phím | không; **`tabindex`, `role=button`, Enter/Space** | có |
| Sự kiện hỗ trợ | click, hover, dblclick, kéo; **chỉ `click`** | chỉ `click` (YAGNI) |

## Quyết định

1. **Dữ liệu:** `elements[].events.click` trong file binding của item `svg` (định dạng 0.4.0): một hành động trong 6 hành động của 007 (`write`, `toggle`, `pulse`, `navigate`, `popup`, `closePopup`) cộng, cho ba hành động ghi, `tag`, `confirm` (`always` mặc định, `none` chỉ BOOL), `minRole` (`operator` mặc định; `viewer` bị cấm) và nhãn đọc `label`.
2. **Gắn lúc chạy** (`bindSvgEvents` ở `@mat/ui-components`): sau khi dựng và áp binding; với mỗi phần tử có sự kiện đặt (không lưu) `data-mat-clickable`, `role="button"`, `tabindex="0"`, `aria-label`, `cursor: pointer`, `pointer-events: all`; nghe `click` và `keydown` (Enter, Space) trên chính phần tử, `stopPropagation` (phần tử sâu nhất thắng); chế độ chỉnh sửa (`mode: 'edit'`) không gắn.
3. **Ghi:** `svgActionController` dựng một `WidgetItem` ảo (`widget: 'button'`, khe `target` = Tag, `props.confirm`, `security.minRole`, `events.click` = hành động) và trả `ControlController` của 007: cùng bảng khóa (13 mã), cùng hộp xác nhận (Tag, giá trị hiện tại, giá trị mới, tài khoản; Hủy có focus), cùng trạng thái "đang gửi" và kết quả (`ACCEPTED`, `CONFIRMED`, `REJECTED`, `TIMEOUT`, `FAILED`, `UNKNOWN`), cùng `expect` (toggle) và `pulseMs` (BL335 giữ nhịp). Không gửi lại.
4. **Audit:** `POST /api/v1/tags/write` với `context = { screen: <id màn hình>, widget: <elementUid> }`; `elementUid` (≤ 43 ký tự) hợp mẫu `context` của runtime (`isContextId`: chữ thường đầu, `[a-z0-9_-]`, ≤ 64). **API thiết bị giữ 1.2.0**, không thêm trường.
5. **Khóa và phản hồi:** phần tử khóa hiện `data-mat-lock`, `aria-disabled`, `filter: grayscale(0.6)` (không dùng `opacity` vì binding `style.opacity` có thể đặt), lý do trong phần tử `<title data-mat-runtime>` do mã chèn (tooltip) và vùng `role="status"` của `<mat-screen>` khi nhấp; `navigate`, `popup`, `closePopup` không bao giờ khóa.
6. **Ẩn:** khi binding làm `visibility: hidden` hoặc `display: none`: `pointer-events: none`, `tabindex=-1`.
7. **Kiểm tra:** `E_EVENT_ACTION`, `E_EVENT_TAG`, `E_EVENT_TARGET`, `E_EVENT_CONFIRM`, `E_EVENT_MINROLE`, `E_REF_UID` (mồ côi như binding); `W_EVENT_CONFIRM_NONE`, `W_EVENT_PULSE_READBACK`. Hai bản (TS, C++) chung vector.
8. **Không có** sự kiện khác `click`, nhiều hành động cho một sự kiện, hành động theo điều kiện, ghi nhiều Tag (GĐ 6).

## Hệ quả

- **Tốt:**
  - Một chuỗi kiểm ghi (khóa, xác nhận, quyền, CSRF, audit) cho widget và SVG: không có đường "rẻ" cho kẻ tấn công.
  - SVG không thể tự khai báo hành vi; sự kiện chỉ tồn tại khi project có dữ liệu đã qua validator.
  - Không đổi API, không đổi C++ của 006/007 (ngoài luật kiểm project).
  - Bàn phím và trình đọc màn hình dùng được.
- **Xấu:**
  - Widget ảo là chỗ nối khó nhìn; bù bằng test (`svg-action-controller.test.ts`) và tài liệu.
  - `widget` trong audit của sự kiện SVG là `elementUid` chứ không phải id item: điều tra phải nhìn thêm file binding (tiền tố `el_` phân biệt).
  - Phần tử nhỏ khó nhấp bằng chuột (chỉ vùng vẽ của hình): thiết kế nên có phần tử `hit` trong suốt (ký hiệu có sẵn).
- **Rủi ro:** (1) phần tử vô hình đè lên nút thật để lừa nhấp: xác nhận mặc định hiện Tag và giá trị thật, khóa theo quyền, audit; (2) XSS đã thực thi vẫn ghi được dưới quyền operator đang đăng nhập (giới hạn còn lại của 007, không thêm); (3) `elementUid` trùng giữa hai item cùng màn hình (hợp lệ) làm `context.widget` không phân biệt item: chấp nhận, `screen` cộng file binding đủ truy ngược.

## Số đo / bằng chứng

**SC-013 (T084, 2026-10-16, runtime x64 thật + Chrome 155 + giả lập Modbus, loopback máy dev, `008-svg-events-x64.json`, 76/76 kiểm đạt):**

- Nhấp phần tử SVG `el_pump_centrifugal_hit` (project `svg-demo`) → hộp xác nhận (Tag, giá trị mới, tài khoản) → đúng **1 lệnh FC5** tới coil 10 → `CONFIRMED` sau **463 ms**. Audit: `channel` = `web`, `context.widget` = `elementUid`, `context.screen` = `bon-nuoc`.
- Xung: bit R.PULSE lên 1 rồi tự về 0 (2 lệnh FC5 ở coil 11).
- Khóa quan sát được trên runtime thật: **9/13 mã** (BUSY, HTTPS_DOWN, INSECURE, LIVE_LOST, NO_SESSION, OTHER_DIALOG, QUALITY_BAD, ROLE, SESSION_EXPIRED). 4 mã (TAG_UNKNOWN, TAG_READONLY, NO_VALUE, PROJECT_CHANGING) không tới được trên x64 vì phụ thuộc Tag hỏng hay đổi project: chỉ có test đơn vị. **Không phải 13/13 trên thiết bị.**
- Tấn công của 007 chạy lại với lệnh từ phần tử SVG: A1 đến A30 (27 ca ở rig chính cộng A26, A27, A28 theo trạng thái tài khoản) **100 % bị từ chối, 0 lệnh tới giả lập**, audit đủ bốn mã từ chối.
- Giới hạn còn lại (rà soát bảo mật F5): `minRole` của sự kiện chỉ khóa giao diện; máy chủ chỉ đòi `operator` (tài khoản operator gọi thẳng API ghi vẫn ghi được Tag đó, có audit, CSRF, giới hạn). Nếu cần khóa thật theo `minRole`, phải thêm kiểm ở máy chủ (xem lại ADR).
- **Chưa đo:** BL335 (T125).

Cơ sở ban đầu: 007 đo ghi từ Chrome (x64) và 30 ca tấn công (`web-it`); contract `device-api-1.2.md` mục `context`.

## Điều kiện xem xét lại

- Cần audit phân biệt item của hai phần tử cùng `elementUid`: thêm `context.item` (API 1.2.1).
- Cần sự kiện khác (nhấn giữ cho jog, di chuột cho tooltip): thêm khóa trong `events` (MINOR).
- Cần hành động nhiều bước hoặc điều kiện: GĐ 6 (luật sự kiện).
