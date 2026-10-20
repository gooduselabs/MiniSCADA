# ADR-040: Bố cục màn hình lưới 12 cột, chủ đề giao diện và biểu đồ ECharts

- **Trạng thái:** Proposed (2026-10-19). Có mã, test TS và C++ (x64), e2e Chrome của trang vận hành và Studio; chưa thử trên BL335 và WebView2 thật.
- **Ngày:** 2026-10-19
- **Liên quan:** [spec 012](../../specs/012-screen-grid-layout/spec.md), [kế hoạch](../plans/screen-grid-layout.md) (D1 đến D15), [hợp đồng định dạng 1.1](../../specs/012-screen-grid-layout/contracts/project-format-1.1.md), [hợp đồng chủ đề](../../specs/012-screen-grid-layout/contracts/ui-theme.md), [research](../../specs/012-screen-grid-layout/research.md) R1 đến R7; [ADR-013](013-screen-model-v1.md) (cách dựng `mat-screen`), [ADR-033](033-browser-reports.md) (báo cáo trên trình duyệt).

## Bối cảnh

Màn hình 0.3 đến 1.0 đặt widget bằng tọa độ tuyệt đối và co cả màn hình theo một tỷ lệ. Người dùng (2026-10-19) muốn dựng trang theo hàng, mỗi hàng chia cột trên lưới 12 cột, gắn component vào ô; và muốn giao diện sáng, nhiều màu, biểu đồ và báo cáo hiện đại hơn.

## Quyết định

1. **Định dạng 1.1.0, cộng thêm:** màn hình có `layout` tùy chọn (`mode: grid`, 12 cột, `rows[]` → `cells[]`, ô trỏ item theo `id`). `items[]` phẳng giữ nguyên làm nguồn sự thật của component; item của màn hình lưới không có `x`, `y`, `width`, `height`. Project có `theme` (`vivid`, `industrial`, `dark`). Dòng 1.x dùng chung bộ schema ở thư mục gốc `schemas/` (MINOR chỉ thêm); khác biệt 1.0/1.1 là luật `E_LAYOUT_VERSION`.
2. **Hai bộ kiểm giống hệt:** `rules-11.ts` và `rules_11.cpp` (mã `E_LAYOUT_*`, `W_LAYOUT_ITEM_ORPHAN`), 50 vector chung `v11-*`; C++ chọn set 10 cho `1.0.x` và `1.1.x`; logic.json nhận cả hai.
3. **Hiển thị:** `mat-screen` có chế độ lưới (không thêm phần tử mới): mỗi hàng là CSS Grid 12 cột, ô giữ chỗ, widget dùng lại cơ chế slot cũ; cuộn dọc, không co; dưới 768 px (đo theo bề rộng của phần tử, không theo cửa sổ) các ô xếp chồng, hàng cao cố định thành tự cao và ô giữ chiều cao đó. Chế độ `edit` mở slot `cell-<id>` để Studio đặt lớp phủ.
4. **Studio:** `mat-grid-editor` riêng (canvas tự do không đổi): thêm hàng theo mẫu cột, thả widget vào ô (hỏi khi thay), kéo đường chia cột, thuộc tính hàng và ô, bàn phím, xem trước 1920/1366/600 px thu vừa khung; thao tác thuần `grid-ops.ts` qua `app.editScreen` (một bước hoàn tác). Màn hình mới của project 1.1 mặc định lưới; vẫn có "Thêm màn hình (bố cục tự do)" và "Chuyển sang bố cục lưới".
5. **Chủ đề:** token `--mat-*` có ba bộ giá trị; `industrial` đúng giá trị cũ (project cũ không đổi giao diện), `vivid` từ thang Radix Colors (chỉ lúc thiết kế, không phụ thuộc lúc chạy), phông Inter tự chứa (tập latin, latin-ext, vietnamese); chọn bằng `:root[data-mat-theme]`.
6. **Biểu đồ:** cột, tròn, đồng hồ vẽ bằng ECharts 6.1 nhập theo mô-đun, nạp lười (192 KB gzip, chỉ tải khi trang có widget đó); xu hướng giữ uPlot (giữ hiệu năng 50.000 điểm). Cổng nội dung của bản build cho phép đúng 9 chỗ `innerHTML` trong chunk ECharts, widget không đưa chuỗi HTML vào ECharts.

## Hệ quả

- Runtime không đổi đường dữ liệu sống (đăng ký theo item); thêm kiểm schema và luật; phiên bản sản phẩm lên `1.1.0-alpha.1`, project lưới cần runtime ≥ 1.1.0 (cổng phiên bản sẵn có chặn runtime cũ).
- Template chưa chèn được vào màn hình lưới (cần tọa độ): báo lý do; nhập SVG và ký hiệu đặt vào ô trống đầu tiên.
- Trang có biểu đồ tải thêm ~200 KB gzip (cộng phông khi chủ đề vivid, dark: tối đa ~340 KB, dưới ngân sách 400 KB của SC-006).

## Phương án đã loại

Lồng item trong ô (phải viết lại mọi luồng duyệt item); trường `slot` trên item (khó đổi thứ tự, khó kiểm trùng); phần tử `mat-grid-screen` riêng (lặp mã gắn widget, popup, sự kiện); thay cả bộ thành phần giao diện (rủi ro hồi quy); ECharts cho cả xu hướng (nặng hơn uPlot ở nhiều điểm).
