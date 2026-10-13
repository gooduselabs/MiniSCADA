# ADR-033: Báo cáo sinh trên trình duyệt: tính bằng `history-math`, xuất CSV/XLSX/PDF, rà thư viện

- **Trạng thái:** Proposed (feature 010, 2026-10-13). Phiên bản thư viện, kích thước và lỗ hổng do task T005 chốt và điền vào bảng "Số đo / bằng chứng".
- **Ngày:** 2026-10-13
- **Liên quan:** [specs/010-history-reports](../../specs/010-history-reports/spec.md) (US5, US6, FR-040…FR-044), [research R9, R10](../../specs/010-history-reports/research.md), [contracts/templates-config.md](../../specs/010-history-reports/contracts/templates-config.md); [ADR-009](009-studio-ui-stack.md), [ADR-020](020-realtime-chart.md), [ADR-031](031-history-aggregates.md), [ADR-032](032-history-query-api.md); Constitution II, III, V, VII.

## Bối cảnh

Lộ trình §4.6: báo cáo theo mẫu ngày, ca, tháng (min, max, avg, tổng, cuối) xuất CSV, XLSX, PDF, **sinh trên trình duyệt để không tốn CPU BL335**; thư viện phải rà license, tuổi, kích thước. Studio xem trước cùng báo cáo; Constitution II yêu cầu một nơi tính cho Studio và Chrome. Quy tắc dự án (ADR-009, ADR-020): không thêm thư viện nếu tránh được; thư viện mới phải có license cho phép, phát hành ≥ 14 ngày, kích thước nén đo được, không lỗ hổng chưa vá.

## Các phương án

| Việc | Phương án | Đánh giá (giả thuyết cần T005 xác nhận) |
|---|---|---|
| Tính báo cáo | ở máy chủ; **ở trình duyệt từ `aggregate`** | trình duyệt: BL335 chỉ ghép bucket vào cửa sổ cố định (đã rẻ) |
| ZIP của XLSX | **`fflate`** (MIT, khoảng 8–30 KB gzip); `jszip` (MIT/GPL kép, 100 KB) | `fflate` |
| XLSX | **tự viết một sheet trên `fflate`**; `exceljs`; SheetJS | tự viết: ô số, chuỗi nội tuyến, freeze panes; thư viện đầy đủ quá nặng, SheetJS bản npm cũ có lỗ hổng đã công bố |
| PDF | **`pdfmake`** (MIT); `jsPDF` + autotable (MIT); `pdf-lib` + fontkit (MIT, không bảo trì); in của trình duyệt | `pdfmake` (bảng khai báo, lặp tiêu đề, chia trang, phông Roboto có chữ Việt); dự phòng `jsPDF` + phông Việt; cuối cùng in của trình duyệt (không có tệp để kiểm tự động) |
| CSV | tự viết | hai kiểu: chuẩn (`,` `.`) và Excel vi-VN (`;` `,`), UTF-8 có BOM |

## Quyết định

1. Mọi phép tính báo cáo nằm ở `packages/history-math` (TS thuần): kỳ ngày/ca/tháng theo `timeZone` của nhóm, gọi `aggregate` với `bucketMs`, `offsetMs`, ghép bucket (`merge`), hàm `min, max, avg, sum, first, last, delta, count`, dòng tổng, thiếu dữ liệu, định dạng vi-VN. Trang runtime và xem trước Studio dùng chung; bộ vector `tests/report-vectors`, so với `tools/history-ref`.
2. Mã xuất ở `packages/report-export`, **tải lười** khi bấm nút, không tính vào tải khởi động (≤ 250 KB gzip, SC-024 của 007). Cùng một `ReportTable` cho cả ba định dạng, không tính lại.
3. XLSX tự viết (một sheet) trên `fflate`; PDF bằng `pdfmake` (phông tiếng Việt); phiên bản cố định trong `package.json`, ghi `third_party/LICENSES.md`. Ngưỡng chấp nhận: license MIT/Apache-2.0/BSD, phát hành ≥ 14 ngày, 0 lỗ hổng chưa vá, chunk PDF ≤ 1,2 MB gzip, XLSX ≤ 60 KB gzip, trích chữ PDF khớp 100 % ô, dấu Việt đúng.
4. Mẫu báo cáo trong `reports.json` (schema 0.1.0), khai báo `reportsFile`; ca chia đều 24 giờ (2, 3, 4, 6, 8, 12 ca); tháng ghép từ ngày; chỉ đọc bảng tổng hợp (nhóm phải bật `aggregates`).
5. Chống chèn công thức: ô chuỗi bắt đầu bằng `=`, `+`, `-`, `@` được thêm `'` ở CSV và XLSX (kiểm ở rà soát bảo mật T156); mọi chuỗi mẫu là văn bản thuần, XML thoát ký tự.

## Hệ quả

- **Tốt:** không tốn CPU BL335 cho dựng tệp; một nơi tính; chunk nặng chỉ tải khi cần; kiểm tự động được cả ba định dạng.
- **Xấu:** hai phụ thuộc ngoài cần theo dõi bản vá; chunk PDF lớn (có thể trên 1 MB) tải qua LAN BL335 khi bấm lần đầu; XLSX tự viết cần test kỹ với Excel thật (thử tay).
- **Rủi ro:** `pdfmake` không đạt ngưỡng ở T005 (license, kích thước, chữ Việt): dùng dự phòng và ghi sai khác so với nghiệm thu; chưa mở thử bằng Excel/Acrobat trước khi người dùng thử tay.

## Số đo / bằng chứng

Chưa đo. T005 điền: phiên bản và ngày phát hành, license, kích thước gzip từng chunk, kết quả tra lỗ hổng, kết quả dựng PDF chữ Việt. T105, T106 điền: thời gian dựng báo cáo tháng, kích thước chunk trong bản build.

## Điều kiện xem xét lại

- Thư viện ngừng bảo trì hoặc có lỗ hổng chưa vá: thay theo bảng dự phòng.
- Khách hàng cần bố cục tùy ý (logo, biểu đồ trong báo cáo): mở rộng mẫu (ngoài phạm vi GĐ 5); xem `jsPDF` hoặc dựng HTML in.
- Báo cáo cần ca không đều hoặc kỳ tuần/quý/năm: thêm đường ghép từ bucket phút và `period` mới.
