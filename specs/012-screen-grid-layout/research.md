# Research: 012 bố cục lưới và giao diện

Phiên bản thư viện lấy bằng `npm view` ngày 2026-10-19. Kích thước sau nén là ước tính, **R2 đo lại** trước khi khóa.

## R1. Mô hình bố cục: ô tham chiếu item

- **Decision**: `screen.layout = { mode: "grid", columns: 12, gap, padding, rows: [{ id, height, gap?, cells: [{ id, span, offset?, align?, minHeight?, item? }] }] }`; `items[]` phẳng giữ nguyên; item của màn hình lưới bỏ `x`, `y`, `width`, `height`.
- **Rationale**: mọi luồng hiện có (binding, sự kiện, `rename.ts`, `compare.ts`, `svg-bind.ts`, `*-flow.ts`, template) duyệt `screen.items`; giữ nguyên thì FR-014 gần như miễn phí. Vị trí là dữ liệu riêng của bố cục.
- **Alternatives**: lồng item trong ô (phải viết lại mọi luồng duyệt item); thêm `slot {row, col, span}` vào item (thứ tự hàng và ô rải rác, khó đổi thứ tự, khó kiểm trùng).

## R2. Thư viện biểu đồ

- **Decision (tạm, chốt sau spike T-R2)**: ECharts 6.1.0 nhập theo mô-đun (`echarts/core` + `BarChart`, `PieChart`, `GaugeChart`, `HeatmapChart`, các component `Grid`, `Tooltip`, `Legend`, renderer `SVGRenderer`/`CanvasRenderer`), **nạp lười** bằng `import()` lần đầu một widget cần nó. Xu hướng thời gian thực và lịch sử **giữ uPlot 1.6.32**, làm mới giao diện bằng token và plugin.
- **Rationale**: ECharts có cột, tròn/vành khuyên, đồng hồ, bản đồ nhiệt, hoạt ảnh, theme, tooltip đẹp, giấy phép Apache-2.0 (qua cổng giấy phép), có renderer SVG dùng lại cho báo cáo (R6). uPlot vẫn nhanh nhất cho 10.000 đến 100.000 điểm; viết lại xu hướng là rủi ro không cần.
- **Spike T-R2 (đo)**: kích thước gzip của gói ECharts tối thiểu (mục tiêu ≤ 350 KB), thời gian vẽ 12 widget, CPU ở 1 Hz × 10 client. Nếu vượt: dùng Chart.js 4.5.1 (MIT) cho cột/tròn và giữ đồng hồ SVG tay vẽ lại.
- **Alternatives**: chỉ cải tiến SVG tay (rẻ nhất nhưng người dùng chê; khó có tooltip, hoạt ảnh); ECharts cho cả xu hướng (nặng hơn uPlot nhiều ở 50.000 điểm).
- **Kết quả spike T037 (2026-10-19, nhánh 012-theme, `node tools/spikes/charts-r2/run.mjs`, Vite 8.3.4, Chrome 155, máy dev Windows)**:
  - Chunk ECharts lite của spike (`echarts/core` + Bar, Pie, Gauge, Heatmap, Grid, Tooltip, Legend, **VisualMap** (bản đồ nhiệt cần), SVGRenderer, CanvasRenderer): **599,3 KB thô, 200,8 KB gzip mức 9** (169,6 KB brotli), tách riêng và tải lười; chunk khởi động của trang mẫu (uPlot + mã trang) 24,0 KB gzip. **Đạt mục tiêu ≤ 350 KB: chốt ECharts 6.1.0, không dùng phương án Chart.js.**
  - Thời gian (trung vị 5 lần, 12 widget: 3 cột, 2 tròn, 2 vành khuyên, 3 đồng hồ, 1 bản đồ nhiệt 24 × 7, 1 xu hướng uPlot 10.000 điểm × 3 chuỗi): nạp chunk 30 ms (máy cục bộ), vẽ lần đầu 106 ms (SVG), 96 ms (Canvas).
  - CPU khi cập nhật mọi widget 1 Hz, 10 tab cùng lúc trong 30 s (TaskDuration của DevTools): mỗi tab trung vị 6,9 % một lõi, lớn nhất 33,2 % (một tab); mỗi máy vận hành thường mở một tab nên con số đáng xét là ~7 %.
  - Cổng nội dung bản thiết bị (`apps/runtime-web/scripts/package-web.mjs`, SC-020): chunk ECharts **không** có `eval(` hay `new Function`, nhưng có **11 chỗ `innerHTML`** (xóa nội dung khi dispose/clear, đọc `getSvgDom().innerHTML` khi `connect`, và nội dung tooltip HTML). Xử lý: widget không đưa chuỗi HTML vào ECharts (formatter tooltip trả phần tử DOM dựng bằng `textContent`; nhãn là chuỗi thuần zrender vẽ thành chữ SVG); cổng cho phép đúng số chỗ đó **chỉ** trong chunk ECharts, số chỗ đổi (đổi phiên bản) thì cổng báo lỗi để xem lại (T047).
  - uPlot sau khi làm mới giao diện (T045: 12 màu, lưới nét đứt, không vạch chia, điểm con trỏ viền màu, tô vùng khi một đường), `run.mjs --uplot` với bộ điều hợp thật, 50.000 điểm × 4 đường, so cùng lần chạy với bản cũ chép tạm: dựng lần đầu 30 ms cũ / 30 ms mới, `setData` trung vị 5,4 / 5,4 ms (hai lần đo); một đường có tô vùng 1,6 ms so với 1,5 ms không tô. Không chậm đi (FR-034).
  - **Đo bundle trang vận hành (T047, SC-006, 2026-10-19, `npm run build -w @mat/runtime-web`, gzip mức 9 của `package-web.mjs`)**: trước thay đổi (gốc 95c2b4ab) JS+CSS khởi động 143,5 KB; sau US3 151,0 KB (**+7,5 KB**: ba chủ đề trong `tokens.ts` và CSS). Chunk `echarts-modules-*.js` 587 KB thô, **192,0 KB gzip**, tải lười, chỉ khi màn hình có `bar`, `pie` hoặc `gauge` (index.html không tham chiếu; cổng `package-web.mjs` kiểm). Phông Inter (woff2, đã nén sẵn) 47,1 + 83,1 + 10,0 KB, chỉ tải khi chủ đề dùng Inter (vivid, dark) và theo ký tự cần. Tổng tăng khi mở trang có biểu đồ: +199,5 KB mã, tối đa +339,7 KB kể cả phông: **≤ 400 KB, đạt SC-006**. Trang không có biểu đồ: +7,5 KB, không tải ECharts (test `bar.test.ts` "màn hình không có biểu đồ không nạp ECharts").
  - Bản dùng thật (`packages/ui-components/src/chart/echarts-lite.ts`) bỏ CanvasRenderer, chỉ giữ **SVGRenderer** (nét sắc khi phóng, dùng lại cho báo cáo R6; chênh thời gian vẽ với Canvas nhỏ).

## R3. Bảng màu và chủ đề

- **Decision**: ba chủ đề `vivid` (Sáng đa sắc, mặc định project mới), `industrial` (giá trị token hiện có), `dark`. Giá trị lấy từ thang 12 bậc của **Radix Colors 3.0.0** (MIT) lúc thiết kế, ghi cứng vào `packages/ui-components/src/styles/themes/*.css`; không có phụ thuộc lúc chạy. Bảng màu chuỗi 12 màu: blue, teal, green, amber, orange, red, crimson, pink, violet, indigo, cyan, lime (bậc 9 cho nét, bậc 3 cho vùng); thang tuần tự (blue 3→11) và phân kỳ (red ↔ blue). Biến chủ đề qua thuộc tính `data-mat-theme` trên `:root`.
- **Rationale**: Radix có cặp sáng/tối đã cân chỉnh tương phản; ghi giá trị vào CSS giữ cơ chế token `--mat-*` hiện có (`tokens.css`, `:where()`), widget không phải sửa.
- **Tương phản**: test tự động mở rộng `alarm-tokens.test.ts` cho mọi cặp chữ/nền của ba chủ đề (≥ 4,5:1); chuỗi biểu đồ giữ mảng kiểu nét hiện có (`line-chart.ts`).
- **Alternatives**: thang Tailwind (tương tự, ít bậc nền nhạt cho tối); sinh OKLCH tự viết (tốn công cân chỉnh).

## R4. Phông chữ

- **Decision**: `@fontsource-variable/inter` 5.3.0 (OFL-1.1), chỉ chép `inter-latin-wght-normal.woff2` và `inter-latin-ext-wght-normal.woff2` (đủ dấu tiếng Việt) vào tài nguyên tĩnh; `font-display: swap`; dự phòng `Segoe UI`, `system-ui`.
- **Sửa khi làm T039 (2026-10-19)**: latin-ext của Inter **không** có U+1EA0-1EF1 (ạ, ả, ấ, ầ, …), nên thêm `inter-vietnamese-wght-normal.woff2` (10 KB). Ba tệp (latin 48 KB, latin-ext 85 KB, vietnamese 10 KB) chép vào `packages/ui-components/src/styles/fonts/` kèm `LICENSE-Inter.txt`; trình duyệt chỉ tải khi chủ đề dùng Inter (vivid, dark) và chỉ tập có ký tự cần.
- **Rationale**: giống nhau trên mọi máy vận hành; số dễ đọc (tabular-nums).
- **Alternatives**: phông hệ thống (khác nhau giữa máy, hiện đang dùng).

## R5. Hiển thị lưới

- **Decision**: phần tử `mat-grid-screen` (Lit) render hàng là `display: grid; grid-template-columns: repeat(12, minmax(0, 1fr))`, ô `grid-column: <offset+1> / span <span>`; hàng `height: auto` dùng `min-height` từ danh mục widget, hàng px cố định; dưới 768 px (container query trên phần tử, không dùng kích thước cửa sổ, để xem trước Studio giả lập được) mọi ô `grid-column: 1 / -1`. Widget, binding, sự kiện, popup dùng lại mã của `mat-screen` qua hàm chung tách ra (`mountWidget`, `mountSvgItem`).
- **Rationale**: CSS Grid có sẵn, không phụ thuộc; container query cho xem trước nhiều cỡ ở Studio (FR-023).
- **Alternatives**: tính vị trí bằng JS rồi đặt tuyệt đối (mất khả năng co giãn tự nhiên).

## R6. Báo cáo

- **Decision**: giữ pdfmake 0.3.11; nhúng Inter (vfs) thay Roboto; mẫu mới (dải tiêu đề màu chủ đề, logo tùy chọn, thẻ số liệu, bảng zebra, `headerRows: 1`, chân trang `currentPage/pageCount`); biểu đồ: ECharts SSR SVG (`renderToSVGString`) nhúng bằng nút `svg` của pdfmake. XLSX: thêm style (fill tiêu đề, độ rộng cột, numFmt) trong `xlsx/` tự ghép hiện có.
- **Alternatives**: chụp canvas thành PNG (vỡ hạt khi phóng, trái SC-009).

## R7. Định dạng 1.1 và hai bộ kiểm

- **Decision**: `SUPPORTED_SCHEMA_11 = /^1\.1\.\d+$/`; set 11 trong `project_validator.cpp` (bản đóng băng `schemas/1.1/`); `migrateTo11` dùng `bumpFormat` (chỉ đổi `schemaVersion`, `minRuntimeVersion` 1.1.0). Studio lưu project có màn hình lưới bắt buộc 1.1; nút Nâng cấp đưa 0.x/1.0 lên 1.1 (một lần). Mã lỗi: `E_LAYOUT_COLUMNS`, `E_LAYOUT_SPAN`, `E_LAYOUT_ITEM_REF`, `E_LAYOUT_ITEM_DUP`, `E_LAYOUT_ITEM_POS`, `E_LAYOUT_LIMIT`, `E_LAYOUT_ID`, `W_LAYOUT_ITEM_ORPHAN`.
- **Rationale**: cùng cách các bước 0.4 → 1.0 đã làm; vector chung đảm bảo TS = C++.

## R8. Hiệu năng

- Live hub, đăng ký Tag không đổi (theo item). Đo: `tools/load-tester` 500 Tag, 10 client với project mẫu `projects/grid-demo` (mới) so với `dashboard-demo`; trình duyệt: Performance panel, 12 widget, 1 Hz.
