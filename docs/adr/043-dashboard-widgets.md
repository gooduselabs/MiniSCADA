# ADR-043: Widget dashboard, khung có tiêu đề và mẫu hàng

- **Trạng thái:** Proposed (2026-10-20). Có mã, test TS, e2e Chrome của trang vận hành và Studio; test C++ đã viết, chưa build ở máy làm (cần ctest x64); chưa thử trên BL335 và WebView2.
- **Ngày:** 2026-10-20
- **Liên quan:** [ADR-040](040-grid-layout-and-theme.md) (lưới 12 cột, chủ đề, ECharts), [hợp đồng chủ đề](../../specs/012-screen-grid-layout/contracts/ui-theme.md), danh mục `schemas/widgets.catalog.json` 0.6.0.

## Bối cảnh

Phản hồi của người dùng (2026-10-20) kèm ảnh dashboard tham khảo: "kích thước ô card chart nhìn xấu quá", muốn thư viện component phong phú hơn. Dashboard của 012 có thẻ trắng viền mảnh, số không nổi, biểu đồ không tiêu đề, đồng hồ kim chiếm cả ô, hàng cao thấp không đều.

## Quyết định

1. **Danh mục 0.6.0 (chỉ thêm):** bảy widget nhóm `display`: `stat-tile` (thẻ chỉ số màu đặc), `kpi`, `progress`, `status-list`, `clock`, `text`, `image`. `title` cho `line`, `bar`, `pie`, `gauge`, `tag-table`; `highLimit`, `lowLimit`, `xLabel`, `yLabel` cho `line`; `variant` (`plain`, `card`) cho `panel`. Thuộc tính chỉ dùng kiểu sẵn có (chuỗi có `pattern`, enum, số, màu); TS và C++ đọc cùng tệp lúc chạy nên luật kiểm không đổi mã, vector danh mục sinh lại (298 ca).
2. **Màu thẻ:** bảng 10 màu có tên (`--mat-tile-*`), cùng giá trị ở mọi chủ đề, chữ trắng ≥ 4,5:1 (có test). Không cho mã màu tự do để thẻ luôn đọc được.
3. **Biểu tượng:** 21 hình tự vẽ (nét 24 × 24, chỉ dữ liệu `d` đưa qua Lit), không thêm thư viện, không điều khoản giấy phép.
4. **Khung có tiêu đề:** lớp `.framed` + `.head` dùng chung trong `widgetStyles`; không tiêu đề thì giữ giao diện cũ.
5. **Đường ngưỡng:** vẽ trên canvas của uPlot (hook `draw`), trục Y tự nới để thấy ngưỡng; giá trị lấy từ thuộc tính (trang vận hành chưa nạp `alarms.json`, nên chưa tự lấy giới hạn alarm).
6. **Ảnh:** `image.src` là tệp SVG trong `graphics/` (mẫu đường dẫn chặn `..` và URL ngoài: Constitution offline); tệp thuộc project như SVG của item `svg` (`projectFiles`, `files()`, `allowlist()`, `E_FILE_MISSING`), nội dung qua luật SVG của TS và dựng bằng `mountScreen` (lọc allowlist).
7. **Mẫu hàng của Studio:** "4 thẻ chỉ số" (116 px), "3 biểu đồ" (260 px), "2 biểu đồ + 1" (260 px), "1 biểu đồ rộng" (300 px): một thao tác thuần `addTemplateRow`, hàng cao cố định nên các ô cùng hàng cao bằng nhau. Mẫu Project mới "Dashboard tối".
8. **Chủ đề dark** đổi nền sang xám xanh (`#1f2a33`, khung `#2b3640`); nhấn (`accent`) phải ≥ 4,5:1 trên khung.

## Hệ quả

- Project dùng widget mới cần runtime có danh mục 0.6.0 (runtime cũ báo `E_WIDGET_UNKNOWN` lúc kiểm, không kích hoạt).
- Gói khởi động của trang vận hành tăng vài KB (widget nằm trong gói widget chung); ECharts, uPlot vẫn nạp lười.
- `role=meter` (đồng hồ, mức, tiến độ) luôn có `aria-valuenow` (bằng min khi giá trị không rõ) theo axe.

## Phương án đã loại

Thư viện biểu tượng ngoài (Lucide: phải nhúng chọn lọc và theo dõi giấy phép, lợi ít với 21 hình); màu thẻ tự do (không bảo đảm tương phản); thẻ chỉ số là biến thể của `card` (thuộc tính rối, đổi giao diện project cũ).
