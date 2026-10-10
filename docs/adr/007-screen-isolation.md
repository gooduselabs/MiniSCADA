# ADR-007: Mỗi màn hình SVG nằm trong Shadow DOM riêng

- **Trạng thái:** Accepted (Sprint 1, 2026-10-10).
- **Ngày:** 2026-10-10
- **Liên quan:** [svg-dialects.md](../architecture/svg-dialects.md) (thí nghiệm 3, yêu cầu 10); [ADR-003](003-element-uid.md); Constitution II; package `@mat/svg-renderer` (`mountScreen`).

## Bối cảnh

Thí nghiệm Sprint 0 cho thấy khi ghép hai SVG kiểu Illustrator Export vào cùng một trang, class `.cls-N` và id gradient (`linear-gradient`) trùng tên làm sai màu và sai gradient. File Inkscape thật của dự án có 366 class được định nghĩa khác nhau ở nhiều khối `<style>`. Runtime web và Studio Preview hiển thị cùng một màn hình theo cùng một cách (Constitution II), và về sau sẽ có nhiều màn hình, popup và symbol trên cùng trang.

## Các phương án

| Phương án | Ưu | Nhược |
|---|---|---|
| A. Chèn SVG thẳng vào DOM của trang | Đơn giản | Class/id/CSS trùng giữa các file hoặc với trang làm sai hiển thị (đã tái hiện) |
| B. Importer đổi tên mọi class/id và sửa tham chiếu (`url(#…)`, `href`) | Không phụ thuộc trình duyệt | Phức tạp, dễ sót tham chiếu; là việc của Sprint 2 và chưa có |
| C. `<iframe>` mỗi màn hình | Cách ly mạnh | Nặng, khó điều phối binding và sự kiện; CSP/sandbox phức tạp |
| **D. Shadow DOM mỗi màn hình** (chọn) | Cách ly CSS và id, nhẹ, binding vẫn truy cập trực tiếp phần tử | `document.getElementById` không thấy phần tử; công cụ ngoài phải đi qua `shadowRoot` |

## Quyết định

- `mountScreen(host, svgText, layout)` lọc SVG (allowlist tối thiểu, chỉ giữ `data-mat-uid`), rồi dựng SVG trong `host.shadowRoot` (mode `open` để test và công cụ đo truy cập được). Trả về `Map<elementUid, Element>` lập **một lần** theo `data-mat-uid` (ADR-003 điểm 7). Chỉ nhận UID đã khai báo trong screen.
- `unmount()` xóa toàn bộ nội dung; `DomApplier.dispose()` hủy animation và listener.
- Importer của Sprint 2 vẫn nên đổi tên id khi ghép nhiều file vào **một** màn hình (Shadow DOM chỉ cách ly giữa các màn hình).

## Số đo / bằng chứng

- `mount.test.ts`: hai màn hình cùng `id="same"` và cùng `.c` nhưng khác màu, mỗi màn hình giữ đúng phần tử và style của mình; script và `on*` bị lọc trước khi chèn.
- Trên Chrome thật (x64 và BL335): màn hình tank-motor hiển thị trong Shadow DOM, có dữ liệu sống sau 216–296 ms (`tools/measure/runtime-smoke.mjs`).

## Hệ quả

- **Tốt:** hết lỗi trùng class/id giữa các màn hình; Studio và runtime dùng chung một hàm.
- **Xấu:** CSS của trang không áp vào SVG (đây là điều mong muốn); công cụ đo phải truy cập qua `shadowRoot`.

## Điều kiện xem xét lại

Cần chia sẻ `<defs>`/symbol giữa nhiều màn hình, hoặc hiệu năng dựng hàng trăm Shadow DOM (symbol library) không đạt.
