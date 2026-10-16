# ADR-033: Báo cáo sinh trên trình duyệt: tính bằng `history-math`, xuất CSV/XLSX/PDF, rà thư viện

- **Trạng thái:** Accepted trên x64 (2026-10-15). Chunk PDF 787,7 KB gzip (trần 1.171,9 KB), XLSX 6,2 KB (trần 58,6 KB), khởi động 91,8 KB (trần 244,1 KB) theo `npm run build:web`. Thử tay Excel/Acrobat (SC-016) cần người.
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

**Rà soát thư viện (T005, 2026-10-14).** `npm view`, `npm install --ignore-scripts` vào thư mục riêng (không chạy mã của gói), `npm audit`, đo gzip bằng script tĩnh. Quy tắc: license cho phép dùng thương mại, phát hành >= 14 ngày, 0 lỗ hổng chưa vá, chunk PDF <= 1,2 MB gzip, chunk XLSX <= 60 KB gzip.

| Thư viện | Phiên bản ghim | License | Phát hành | Kích thước | Dùng ở |
|---|---|---|---|---|---|
| `fflate` | 0.8.3 | MIT | 2026-05-16 | `esm/browser.js` 90.922 B, **22.151 B gzip** (cả thư viện; chỉ `zipSync` thì nhỏ hơn); không phụ thuộc con | XLSX (ZIP), `@mat/report-export` |
| `pdfmake` | 0.3.11 | MIT | 2026-06-12 | `build/pdfmake.min.js` 1.053.972 B, **353.720 B gzip**; `build/vfs_fonts.js` (4 kiểu Roboto) 854.725 B, 464.668 B gzip; hai kiểu cần dùng (Regular, Medium) khoảng 230 KB gzip; tổng chunk PDF khoảng 0,6-0,8 MB gzip | PDF, `@mat/report-export`, tải lười |
| `unpdf` | 1.8.1 | MIT | 2026-08-13 | chỉ `devDependencies` (trích chữ PDF để kiểm 100 % ô), không vào bản build | test |

- **Phụ thuộc của `pdfmake`** (23 gói, `npm ls`): `pdfkit` 0.19.1, `fontkit` 2.0.4, `linebreak`, `xmldoc`, `pako` 1.0.11 (MIT AND Zlib), `@swc/helpers` (Apache-2.0), `sax` (BlueOak-1.0.0), `tslib` (0BSD), `png-js` (package.json không ghi license; repo gốc MIT) và các gói MIT khác; không có GPL/LGPL. Bản build `pdfmake.min.js` đã gộp sẵn, bản build web chỉ kéo hai tệp trên.
- **Lỗ hổng:** `npm audit` của `fflate` + `pdfmake` (cả cây phụ thuộc) và của `unpdf`: 0 lỗ hổng.
- **Chữ Việt:** phân tích tĩnh cmap của bốn tệp Roboto trong `vfs_fonts.js`: đủ 74/74 ký tự tiếng Việt thử (`ăâđêôơư`, mọi nguyên âm có dấu hoa và thường), thiếu 0. Dựng PDF thật và trích chữ bằng `unpdf` nằm ở test của `@mat/report-export` (T098).
- **XLSX:** không thêm bộ đọc XLSX ngoài: test dùng `fflate.unzipSync` + `DOMParser` của `jsdom` (đã có ở gốc) kiểm XML hợp lệ và từng ô; `read-excel-file` bản mới nhất mới phát hành 2026-10-07 (dưới 14 ngày) nên không dùng.
- Không cần phương án dự phòng R10: cả ba thư viện đạt ngưỡng. Phiên bản ghim đúng trong `packages/report-export/package.json`; `third_party/LICENSES.md` ghi bảng trên (T154).

**Bản build (2026-10-15):** `npm run build:web`: khởi động JS+CSS 91,8 KB gzip (trần 244,1), XLSX 6,2 KB (trần 58,6), PDF 787,7 KB (trần 1.171,9). e2e báo cáo (`apps/runtime-web/tests/e2e/reports.e2e.mjs`): mẫu tháng 12 cột khổ A4 ngang, số không bị ngắt giữa chữ số (đã sửa ở `report-export/pdf.ts`, planLayout), CSV/XLSX/PDF khớp từng ô với bảng trên màn hình. Thử tay trên Excel và Acrobat (SC-016) **cần người**: chưa làm.

## Điều kiện xem xét lại

- Thư viện ngừng bảo trì hoặc có lỗ hổng chưa vá: thay theo bảng dự phòng.
- Khách hàng cần bố cục tùy ý (logo, biểu đồ trong báo cáo): mở rộng mẫu (ngoài phạm vi GĐ 5); xem `jsPDF` hoặc dựng HTML in.
- Báo cáo cần ca không đều hoặc kỳ tuần/quý/năm: thêm đường ghép từ bucket phút và `period` mới.
