# ADR-019: Thư viện widget: web component Lit, `TagSource` và `ActionHost`, danh mục dùng chung, bộ điều khiển

- **Trạng thái:** Accepted (feature 007, 2026-10-13; quyết định "người dùng giao toàn quyền 2026-10-11"). Đo x64 đạt; hiệu năng 250 widget trên thiết bị chờ T150.
- **Ngày:** 2026-10-13
- **Liên quan:** [specs/007-screens-widgets](../../specs/007-screens-widgets/plan.md), research R7–R9, R12; contracts [widget-catalog.md](../../specs/007-screens-widgets/contracts/widget-catalog.md), [ui-components-api.md](../../specs/007-screens-widgets/contracts/ui-components-api.md); [ADR-009](009-studio-ui-stack.md) (Lit, Shadow DOM cho widget); [ADR-013](013-screen-model-v1.md); Constitution II, V.

## Bối cảnh

Lộ trình v2 §3 định `packages/ui-components` là thư viện widget dạng web component, dùng chung cho trang runtime và xem trước của Studio. ADR-009 đã chọn Lit cho giao diện Studio và để ngỏ Shadow DOM cho widget. GĐ 3a cần 15 widget: hiển thị, biểu đồ, bảng, điều khiển.

Ràng buộc:

- Constitution II: `apps/runtime-web` chỉ hiển thị, tương tác, gọi API; widget không tự gọi mạng; Studio xem trước dùng mô phỏng thay cho thiết bị mà không sửa widget.
- Constitution V: không `eval`, không `innerHTML` với dữ liệu project, không script; sự kiện chỉ là hành động có sẵn.
- Trang runtime phải nhẹ (SC-024: ≤ 250 KB nén gzip khi khởi động), chạy Chrome ≥ 120.
- Logic điều khiển (khóa, xác nhận, kết quả) đúng đắn hơn mọi thứ khác: cần test thuần, không phụ thuộc DOM.

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Công nghệ | **Lit 3.3.3 web component**; Preact; TS thuần; thư viện widget có sẵn (Shoelace, Material Web) | Lit (đã dùng ở Studio; khoảng 5 KB nén) |
| Cách ly | **Shadow DOM mỗi widget**; light DOM | Shadow DOM (CSS không rò; hai bản Studio và runtime không đụng nhau) |
| Dữ liệu vào | widget tự mở WebSocket; widget đọc kho toàn cục; **giao diện `TagSource` do nơi chứa cấp** | `TagSource` |
| Tác động ra | widget tự `fetch`; **giao diện `ActionHost` do nơi chứa cấp** | `ActionHost` |
| Khai báo widget | mỗi widget tự có schema riêng ở hai nơi; **một danh mục JSON dùng chung cho TS và C++** | danh mục JSON |
| Logic điều khiển | trong từng widget; **`ControlController` thuần TS dùng chung** | `ControlController` |
| Theme | CSS riêng của widget; **token CSS (custom property, kế thừa qua Shadow DOM)** | token |

## Quyết định

1. **Package `@mat/ui-components`** (`packages/ui-components`), phụ thuộc `lit`, `@mat/binding-engine`, `@mat/svg-renderer`, `@mat/expression` (bảng giá trị), `@mat/project-schema` (kiểu). Mỗi widget là một phần tử tùy biến `mat-w-<loại>` (ví dụ `mat-w-card`), Shadow DOM `open`, stylesheet nhận bằng `adoptedStyleSheets`.
2. **Giao diện nơi chứa:**
   - `TagSource`: `get(id)` → `{ value, quality, reason?, updatedAt }`; `subscribe(ids, fn)` → hàm hủy; `tagInfo(id)` → định nghĩa Tag (kiểu, đơn vị, min/max, quyền, giới hạn, bảng giá trị); `connection` → `live | stale | offline`.
   - `ActionHost`: `session()` → `{ role, user } | null`, `canWrite()` → lý do khóa chung (HTTP, không HTTPS…), `write(request)` → `Promise<WriteOutcome>` (gồm hỏi kết quả), `navigate(id)`, `openPopup(id)`, `closePopup()`.
   - Trang runtime cấp bản dùng `LiveConnection` và `fetch` có cookie; xem trước Studio cấp bản dùng `SimEngine` hoặc phiên thiết bị. Widget không biết bản nào.
3. **Danh mục** `schemas/widgets.catalog.json`: mỗi loại có `kind` (nhóm), `defaultSize`, `minSize`, `slots` (tên, bắt buộc, kiểu Tag cho phép, `needsWrite`), `props` (tên, kiểu, khoảng, mặc định, `scope`: Chung/Hiển thị/Bảo mật), `events` và hành động cho phép. Dùng bởi: validator TS, validator C++ (đọc file lúc chạy từ `schemasDir`, như schema), inspector Studio (sinh form), Toolbox, `<mat-screen>` (giá trị mặc định). Vector kiểm tra chung bảo đảm hai validator cho cùng kết luận.
4. **`ControlController`** (TS thuần, `packages/ui-components/src/control/`): máy trạng thái `locked | ready | confirming | sending | result` cho mọi widget điều khiển. Đầu vào: phiên, quality của Tag, `connection`, `canWrite`, hộp xác nhận khác đang mở. Đầu ra: lý do khóa (mã, chữ tiếng Việt), nội dung hộp xác nhận, kết quả. Test viết trước (Vitest) cho từng ca khóa (SC-009).
5. **Hành động** (FR-033): `write`, `toggle`, `pulse`, `navigate`, `popup`, `closePopup`. `toggle` gửi `expect` (giá trị đang thấy, BOOL); `pulse` gửi `pulseMs` cho BL335 giữ nhịp ([ADR-021](021-web-login-certificates.md), API 1.2.0). Không có hành động "chạy script".
6. **Chữ và an toàn:** mọi chữ của project vào template Lit dưới dạng nội dung văn bản (Lit thoát ký tự); không dùng `unsafeHTML`, `innerHTML`, `eval`; lint `no-restricted-syntax` chặn ở package (SC-020).
7. **Token và theme:** màu, cỡ chữ, bo góc, khoảng cách lấy từ CSS custom property kế thừa (`--mat-*`) do nơi chứa định nghĩa; sáng/tối theo `prefers-color-scheme` và lựa chọn của trang. Widget không có mã màu cứng ngoài màu dữ liệu do project đặt.
8. **Trợ năng:** vai trò ARIA đúng (`button`, `switch`, `slider`, `spinbutton`, `combobox`, `table`, `img` có `aria-label` cho biểu đồ), thao tác bàn phím cho điều khiển, vùng `aria-live="polite"` cho kết quả điều khiển; tương phản ≥ 4,5:1.
9. **Kích thước:** khởi động ≤ 250 KB nén gzip cho cả trang; widget biểu đồ đường tải lười (`import()`), kèm uPlot ([ADR-020](020-realtime-chart.md)).
10. **Định dạng giá trị** là một hàm thuần (`formatValue`) trong package, dùng bởi card, bảng, nhãn, hộp xác nhận, xem trước.

## Hệ quả

- **Tốt:**
  - Một widget chạy ở Studio và Chrome; xem trước bằng mô phỏng mà không đổi widget.
  - Thêm widget mới chủ yếu là thêm một mục danh mục và một phần tử; validator và inspector tự biết.
  - Logic điều khiển kiểm được bằng test thuần; mọi widget điều khiển cư xử như nhau.
- **Xấu:**
  - Danh mục JSON là hợp đồng giữa TS và C++: sửa danh mục phải chạy lại vector cả hai bản.
  - Shadow DOM làm CSS toàn trang không áp vào widget (mong muốn); kiểm thử phải `shadowRoot`.
  - Thêm Lit vào trang runtime (khoảng 5 KB nén).
- **Rủi ro:** `adoptedStyleSheets` và `ElementInternals` có từ Chrome 73 và 77, nằm dưới mức 120; không dùng tính năng mới hơn mức 120.

## Số đo / bằng chứng

- **Đo x64 (2026-10-13):** bản build thiết bị: khởi động JS + CSS 68,3 KB nén gzip (ngưỡng SC-024 250 KB; [007-bundle-x64.json](../reports/007-bundle-x64.json)); `@mat/ui-components` 15 widget, test đơn vị xanh (dựng 100 widget có ghi số đo ra console ở `mat-screen.test.ts`); màn hình 250 item dựng xong và có giá trị 0,08 s trên Chrome 155 ([007-open-x64.json](../reports/007-open-x64.json)); 8 biểu đồ x 8 đường chạy 5 phút: p95 khung hình 10,2 ms ([007-charts-x64.json](../reports/007-charts-x64.json)). Không có `innerHTML`, `eval`, `new Function` (ESLint và grep bản build).
- Rà soát review 2026-10-13: slot của `mat-screen` gắn với id màn hình (item cùng id ở màn hình khác không dùng lại phần tử và trạng thái cũ), có test.

## Điều kiện xem xét lại

- Kích thước vượt SC-024: tách widget thành các gói tải lười theo nhóm.
- Cần widget do người dùng viết hoặc thư viện ngoài: cần ADR về sandbox (Constitution V), ngoài phạm vi.
- Hiệu năng 250 widget không đạt SC-013: dùng một bộ cập nhật chung thay vì mỗi widget tự đăng ký.
