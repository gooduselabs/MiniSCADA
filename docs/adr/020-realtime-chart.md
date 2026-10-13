# ADR-020: Biểu đồ thời gian thực: uPlot cho biểu đồ đường; cột và tròn tự viết bằng SVG

- **Trạng thái:** Accepted (feature 007, 2026-10-13; quyết định "người dùng giao toàn quyền 2026-10-11"). Kích thước đã đo (T005 đạt, bản build 21,5 KB gzip); hiệu năng bản rút gọn 5 phút đạt; bản 30 phút (T136) chờ.
- **Ngày:** 2026-10-13
- **Liên quan:** [specs/007-screens-widgets](../../specs/007-screens-widgets/plan.md), research R11; [studio-ux.md](../architecture/studio-ux.md) §8 ("Biểu đồ: uPlot"); lộ trình v2 §4.3, §4.6; [ADR-019](019-widget-library.md); Constitution II, VII.

## Bối cảnh

GĐ 3a cần biểu đồ đường thời gian thực (≤ 8 đường, cửa sổ tới 3.600 s, nhiều biểu đồ trên một màn hình), biểu đồ cột và biểu đồ tròn/donut. Chạy trên Chrome của client, không trên BL335 (Constitution II); dữ liệu nằm trong bộ đệm của trình duyệt (D20 của spec). GĐ 5 sẽ cần biểu đồ lịch sử (zoom, pan, con trỏ, tới trăm nghìn điểm). Quy tắc dự án: không thêm thư viện ngoài nếu tránh được; mọi thư viện mới phải rà license và phát hành ≥ 2 tuần (ADR-009).

## Các phương án

| Phương án | License | Ưu | Nhược |
|---|---|---|---|
| **uPlot 1.6.32** (phát hành 2025-03-14) | MIT | Rất nhẹ (khoảng 50 KB chưa nén cho bản `iife.min`, chưa đo gzip), không phụ thuộc, thiết kế cho chuỗi thời gian, dựng hàng chục nghìn điểm nhanh; lộ trình và studio-ux đã chọn; dùng lại ở GĐ 5 | Chỉ là biểu đồ đường/vùng/cột theo trục; không có tròn; tài liệu ít; CSS riêng phải nạp vào Shadow DOM |
| Tự viết Canvas 2D | không | Không phụ thuộc, vừa khít nhu cầu GĐ 3a | Phải viết trục thời gian, chia vạch, chú giải, con trỏ, co giãn DPI; GĐ 5 viết tiếp: tốn công, dễ lỗi |
| Chart.js | MIT | Phổ biến, có đủ loại biểu đồ | Nặng hơn nhiều (hàng trăm KB), chậm với chuỗi thời gian dài, thêm bộ điều hợp thời gian |
| Apache ECharts | Apache-2.0 | Rất đầy đủ | Hàng trăm KB tới MB; quá nặng cho trang chạy trên Chrome qua BL335 (10 client tải cùng lúc) |

## Quyết định

1. **Biểu đồ đường dùng uPlot 1.6.32** (MIT, cố định phiên bản trong `package.json`, ghi `third_party/LICENSES.md`), bọc trong widget `mat-w-line` (Shadow DOM, CSS của uPlot nạp bằng `adoptedStyleSheets`). Widget tải lười bằng `import()` để không tính vào tải khởi động (SC-024).
2. **Biểu đồ cột và biểu đồ tròn/donut tự viết bằng SVG** trong Lit (`mat-w-bar`, `mat-w-pie`): chỉ vẽ giá trị hiện tại của ≤ 12 và ≤ 8 Tag, vài chục dòng hình học; uPlot không có biểu đồ tròn.
3. **Mô hình dữ liệu của biểu đồ đường nằm ngoài uPlot** (TS thuần, kiểm bằng Vitest, `packages/ui-components/src/chart/window.ts`): bộ đệm vòng `Float64Array` mỗi đường (3.600 điểm), lấy mẫu theo chu kỳ `sampleMs` bằng giá trị mới nhất của Tag tại thời điểm lấy mẫu, đánh dấu `NaN` khi quality BAD hoặc STALE (uPlot vẽ khoảng đứt với `spanGaps: false`), trục thời gian theo giờ BL335 gửi, không theo đồng hồ máy khách. uPlot chỉ nhận mảng đã chuẩn bị (`setData`), vẽ tối đa một lần mỗi khung hình.
4. **Tín hiệu không chỉ bằng màu:** mỗi đường có màu từ bảng màu cố định của hệ thống thiết kế và kiểu nét khác nhau (liền, gạch, chấm, gạch chấm…); chú giải có tên Tag, đơn vị, giá trị hiện tại.
5. **Giới hạn:** ≤ 8 đường, ≤ 16 biểu đồ đường mỗi màn hình, cửa sổ 10–3.600 s, `sampleMs` ≥ 250. Dữ liệu không lưu lại (mất khi chuyển màn hình hoặc F5; lịch sử là GĐ 5).
6. **Không `eval`:** uPlot không dùng `eval` hay `new Function` (kiểm bằng grep trên bản build và bằng CSP `script-src 'self'` trong e2e).

## Hệ quả

- **Tốt:**
  - Phần đắt nhất (trục thời gian, vẽ nhanh) dùng thư viện đã kiểm chứng; phần có rủi ro đúng-sai (cửa sổ, lấy mẫu, đứt đoạn) tự viết và kiểm test.
  - GĐ 5 dùng lại uPlot cho biểu đồ lịch sử mà không đổi widget.
- **Xấu:**
  - Một phụ thuộc ngoài (MIT, không phụ thuộc con) cần cập nhật bản vá bảo mật.
  - Hai kiểu biểu đồ cột/tròn tự viết cần test hình học riêng.
- **Rủi ro:** CSS của uPlot dùng `position: absolute` và chọn theo class; trong Shadow DOM phải nạp đúng; kiểm bằng e2e và ảnh chụp.

## Số đo / bằng chứng

- Phiên bản, license, ngày phát hành tra bằng `npm view uplot@1.6.32 license` (MIT) và `npm view uplot time` ngày 2026-10-13: `1.6.32` phát hành 2025-03-14 (hơn 2 tuần). Kích thước `unpackedSize` 545 KB (gồm mã nguồn và bản dựng); **đo T005 (2026-10-13, `npm pack uplot@1.6.32`, giải nén riêng, không chạy script):** `dist/uPlot.iife.min.js` 51.081 B (gzip -9: 22.009 B), `dist/uPlot.min.css` 1.857 B (gzip: 772 B), tổng gzip **22,8 KB** (ngưỡng 100 KB: đạt); không phụ thuộc con; grep `eval(`/`new Function` trong bản min: 0; license MIT. Kết luận: dùng uPlot, không viết Canvas.
- Hiệu năng (SC-017: 8 biểu đồ × 8 đường, cửa sổ 3.600 s, lấy mẫu 250 ms): **bản rút gọn 5 phút đo 2026-10-13** (Chrome 155 headless, `web-it -Scenario charts`, [007-charts-x64.json](../reports/007-charts-x64.json)): bộ nhớ JS 4 MB ở mốc 60 s và 4 MB ở phút 5 (tăng -1 MB; ngưỡng +100 MB), p95 thời gian khung hình 10,2 ms. Chunk uPlot trong bản build thiết bị: 21,5 KB nén gzip (ngưỡng 100 KB). **Bản 30 phút (T136) chưa chạy.**

## Điều kiện xem xét lại

- Kích thước nén vượt 100 KB (SC-024) hoặc SC-017 không đạt: viết lại bằng Canvas 2D.
- uPlot ngừng bảo trì hoặc có lỗ hổng chưa vá: thay bằng bản tự viết.
- GĐ 5: cần biểu đồ lịch sử nhiều biểu đồ cùng lúc, kiểm lại hiệu năng với số điểm lớn.
