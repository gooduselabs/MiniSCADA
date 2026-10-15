# ADR-030: Alarm trên trang runtime và trong Studio: banner và trang dựng sẵn, hai widget, âm thanh Web Audio, CSV ở trình duyệt, editor, Thử alarm

- **Trạng thái:** Proposed (feature 009, GĐ 4; quyết định "người dùng giao toàn quyền 2026-10-11")
- **Ngày:** 2026-10-13
- **Liên quan:** [specs/009-alarms](../../specs/009-alarms/plan.md), [spec](../../specs/009-alarms/spec.md) (D21–D28, D36, D38, D40; FR-055 đến FR-087), [research](../../specs/009-alarms/research.md) R16–R21, R23; [ADR-004](004-schema-versioning.md), [ADR-016](016-studio-grid-ime.md), [ADR-019](019-widget-library.md), [ADR-021](021-web-login-certificates.md), [ADR-022](022-screen-editor.md), [ADR-027](027-alarm-model-engine.md), [ADR-029](029-alarm-live-api.md); [studio-ux.md](../architecture/studio-ux.md) §5, §7, §9; mockup `docs/architecture/mockups/studio-alarms.html` (task tạo); [Constitution](../../.specify/memory/constitution.md) II, III, V, VII.

## Bối cảnh

Người vận hành xem Chrome cả ngày; alarm phải đập vào mắt, có tiếng, xác nhận nhanh, và không gây hại (nhấp nháy co giật, XSS từ nội dung, công thức Excel). BL335 yếu nên việc nặng (CSV, âm thanh) làm ở trình duyệt. Kỹ sư dựng hàng trăm alarm: người dùng từ chối giao diện form cơ bản, chuẩn là IDE kiểu TIA Portal. Widget không được gọi mạng (ADR-019); Studio và Chrome dùng chung logic ở `packages/*` (Constitution II).

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Banner và trang | alarm là màn hình project do kỹ sư dựng mỗi project; **phần dựng sẵn của trang runtime** | dựng sẵn (D26) |
| Widget | một widget duy nhất; **hai widget** `alarm-list` (bảng), `alarm-count` (số) | hai widget (D27) |
| Âm thanh | file âm thanh (tài nguyên tĩnh, bản quyền); **Web Audio tổng hợp**, mặc định tắt | Web Audio (D23) |
| CSV | server sinh (tốn CPU BL335); **trình duyệt sinh**, UTF-8 BOM, chống công thức | trình duyệt (D22) |
| Thời gian | múi giờ cấu hình ở thiết bị; **múi giờ trình duyệt**, CSV ISO 8601 có độ lệch | trình duyệt (D21) |
| Thử alarm | chạy runtime thật; **động cơ TS + SimEngine + đồng hồ ảo** | TS (D36) |
| Định dạng | mở rộng 0.4 (3b); **0.5.0 (MINOR)** | 0.5.0 (D28) |

## Quyết định

1. **Trang runtime (`apps/runtime-web/src/alarm/`) dựng sẵn, không phải màn hình project:** banner ở đầu mọi màn hình (alarm chưa xác nhận ưu tiên cao nhất, kế đó mới nhất; tổng và số theo mức; nút Xác nhận chỉ cho alarm đang hiện); trang `#/alarms` (tab Đang có, Tạm ẩn; lọc, sắp xếp, chọn nhiều, Xác nhận, Xác nhận tất cả theo bộ lọc, Tạm ẩn); trang `#/alarm-history` (khoảng thời gian, bộ lọc, phân trang `beforeId`, Theo dõi, Xuất CSV); huy hiệu trên menu có `aria-label`; tiền tố `(n)` ở tiêu đề tab. Menu tự thêm mục khi project có alarm (tắt được bằng `navigation.alarms: false`). Project không có alarm chạy y như project 0.4 của 3b trên runtime 0.7.
2. **Hai widget** `alarm-list` (`areas`, `classes`, `minPriority`, `states`, `columns`, `maxRows`, `showAck`) và `alarm-count` (`areas`, `minPriority`, `mode`, `target`) trong `@mat/ui-components` 0.3.0, danh mục widget 0.4.0 (17 widget); không khe Tag; nhận `AlarmSource` và `ActionHost` mở rộng (`ackAlarms`, `shelveAlarm`) do nơi chứa cấp; không gọi mạng; `alarm-list` dùng chung thành phần bảng với trang Alarm.
3. **Âm thanh Web Audio, mặc định tắt:** trang tạo `beep`, `double`, `siren` bằng bộ dao động, không tải file; phát lặp khi có `ACTIVE_UNACK` của lớp, ngừng khi đã xác nhận hoặc bấm "Tắt tiếng" (chỉ tắt tiếng, không xác nhận); chỉ báo "Âm thanh đang tắt, bấm để bật" vì Chrome chặn tự phát; lựa chọn lưu `localStorage` bọc `try/catch`. Âm thanh chỉ do trang lo, widget không phát tiếng; không có tắt tiếng toàn cục ở thiết bị (D38).
4. **Nhấp nháy ≤ 1 Hz** (không quá 3 lần/giây, WCAG 2.3.1) và `prefers-reduced-motion` đổi thành viền đậm tĩnh; trạng thái luôn có chữ và biểu tượng cùng màu (tám token màu, tương phản ≥ 4,5:1 ở hai theme). Bảng cập nhật theo `id` instance, tối đa một lần dựng mỗi khung hình.
5. **CSV sinh ở trình duyệt:** lấy từng trang 500 dòng theo bộ lọc tới tối đa 100.000 dòng; UTF-8 **có BOM**, RFC 4180, tiêu đề tiếng Việt, thời gian ISO 8601 kèm độ lệch; ô bắt đầu bằng `=`, `+`, `-`, `@`, tab, CR được thêm `'` ở đầu (**chống công thức**); vượt 100.000 dòng thì báo và cắt. Nội dung do project cung cấp chỉ vào DOM bằng `textContent`; lint cấm `innerHTML`.
6. **Thời gian hiển thị theo múi giờ trình duyệt** (D21); lần xảy ra có `clockOk` = false hiện "giờ chưa đồng bộ".
7. **Studio 0.7.0:** mục Alarm mở khóa (bỏ `phase: 'p4'`). Editor **Danh sách alarm** là lưới ảo hóa theo [ADR-016](016-studio-grid-ime.md) và studio-ux §5 (sửa tại ô, dán Excel, Ctrl+D, nhập/xuất CSV, lỗi theo ô, cột trạng thái sống khi Online) với bảng Khu vực phụ; editor **Lớp alarm** (lưới + xem trước màu, nhấp nháy, tiếng thử); lệnh **"Tạo alarm cho Tag…"** (menu chuột phải ở cây, Bảng Tag, bảng alarm; gợi ý ngưỡng theo `min`/`max`, một bước hoàn tác); đổi tên Tag cập nhật alarm, "Dùng ở đâu" liệt kê alarm; So sánh theo đối tượng.
8. **"Thử alarm"** là panel chạy `@mat/alarm-engine` với SimEngine (006) và **đồng hồ ảo** (1×, 5×, 20×): bảng alarm như trang Alarm, đẩy giá trị Tag nhập tay, xác nhận và tạm ẩn thử, nhật ký chuyển trạng thái; kết quả khớp động cơ C++ trên vector chung ([ADR-027](027-alarm-model-engine.md)). Xem trước màn hình ở chế độ Mô phỏng cấp `AlarmSource` từ cùng động cơ.
9. **Mockup tự duyệt:** `docs/architecture/mockups/studio-alarms.html` tạo và tự duyệt (ghi ngày) trước khi viết giao diện Studio mới; task chặn.
10. **Định dạng 0.5.0 (MINOR, ADR-004):** thêm `alarms.json`, `alarm-classes.json` tùy chọn; runtime tối thiểu 0.8.0; migration 0.4 → 0.5 chỉ đổi `schemaVersion` và nâng `minRuntimeVersion` ≥ 0.8.0; hằng `kProjectFormatAlarms`. **Đã giải (người dùng giao toàn quyền 2026-10-11):** 3b (specs/008) đã dùng 0.4.0 (runtime 0.7.0, Studio 0.6.0, `@mat/ui-components` 0.2.0) nên feature này dùng 0.5.0; 010 dùng 0.6.0; hằng số tập trung (task T002), công cụ đổi số giữ làm dự phòng. Rủi ro còn lại: hai feature cùng sửa file chung.

## Hệ quả

- **Tốt:**
  - Mọi project có alarm mà không dựng lại; kỹ sư không phải thiết kế banner.
  - Không thêm tài nguyên tĩnh, không bản quyền; BL335 không tốn CPU cho CSV và âm thanh.
  - Widget và trang dùng chung bảng: một cách hiển thị; kiểm DOM được.
  - Kỹ sư thử alarm không cần thiết bị; tương đương C++ có vector.
- **Xấu:**
  - Banner và trang không tùy biến theo project (chỉ bật/tắt menu).
  - CSV 100.000 dòng tốn bộ nhớ trình duyệt và nhiều lần gọi API (200 trang × 500).
  - Tiếng chưa bật thì người vận hành có thể không nghe được alarm (chỉ báo thay thế); tab ẩn dựa vào tiêu đề `(n)`.
  - Studio 0.7.0 và runtime 0.8.0 thêm khối lượng lớn (editor lưới, Thử alarm).
- **Rủi ro:**
  - Số định dạng và phiên bản trùng với 3b: đã giải (0.5.0 vì 3b dùng 0.4.0); rủi ro còn lại là hai feature cùng sửa file chung; hằng số và T002 giữ làm dự phòng.
  - XSS qua nội dung alarm, công thức CSV: bộ mẫu ≥ 20 và ≥ 30 chuỗi (SC-020).
  - Mockup tự duyệt có thể bỏ sót vấn đề dùng thật: ghi "tự đo" cho SC-023 như 004, 007.

## Số đo / bằng chứng

- **Xuất CSV 50.000 dòng (SC-013), x64 (T099):** 49.999 dòng trong 1,5 đến 3,2 s (≤ 10 s); trang Lịch sử mở 0,23 đến 0,47 s, lọc trên giao diện 0,18 đến 0,5 s. Tệp tải về không bắt được trong Chrome headless (trang chứng chỉ tự ký) nên số dòng lấy từ thanh tiến trình (= oracle), không đếm tệp; mở Excel đúng tiếng Việt vẫn kiểm tay. `docs/reports/009-history-x64.json`.
- **Trợ năng (SC-012):** tương phản tám màu lớp x hai theme ≥ 4,5:1 (chữ) và ≥ 3:1 (viền) bằng test tự động từ token (50 test xanh); axe có trong e2e runtime-web (trang Alarm, hộp thoại, Lịch sử, widget); `aria-live` có test chống đọc lặp. **Còn thiếu:** axe và bàn phím cho màn Studio của alarm (e2e Studio T072 chưa vào). `docs/reports/009-a11y.md`.
- **Dashboard, lưới Studio, khung cập nhật bảng:** khung cập nhật bảng 200 hàng ≤ 16,7 ms, lưới 200 dòng ≤ 1 s và 2.000 dòng cuộn mượt (SC-016), dashboard 20 widget cộng hai widget alarm mở ≤ 2 s (SC-014): **chưa đo** (T086, T110 còn mở); đo trên BL335 ở T128.
- Cơ sở: lưới ADR-016 và [ADR-022](022-screen-editor.md) đã đo trên Chrome headless.

## Điều kiện xem xét lại

- Khách cần bố cục banner hoặc trang Alarm riêng: cho trang Alarm tùy biến hoặc màn hình project dùng `alarm-list`.
- Khách cần âm thanh riêng: mở lại D23 (tải file có kiểm soát).
- CSV vượt 100.000 dòng thường xuyên hoặc ngốn bộ nhớ: sinh theo luồng hoặc xuất ở server.
- Cần xác nhận từ Studio: mở lại D31 ([ADR-029](029-alarm-live-api.md)).
- Thứ tự phát hành với 3b hoặc 010 đổi nữa: đổi cả bộ số theo T002 (`renumber-alarm-format.mjs`).
