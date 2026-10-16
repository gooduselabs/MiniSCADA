# Rà soát bảo mật feature 010 (lịch sử, tổng hợp, báo cáo)

Ngày 2026-10-14. Người rà: agent `security-auditor` (chỉ đọc mã), mã C++ của API truy vấn, truy vấn, CSV, bộ đọc, bộ giới hạn, CLI, đường ghi và khôi phục. Phần trình duyệt (xuất báo cáo XLSX/PDF, `HttpHistorySource`) ghi ở mục 3.

## 1. Kết quả

Không có phát hiện Critical hay High. 4 Medium, 5 Low/Info.

| # | Mức | Nội dung | Xử lý |
|---|---|---|---|
| 1 | Medium | `reduce=lttb` giữ mọi dòng của mọi đường trong bộ nhớ (24 byte một điểm); giới hạn quét 64 MiB tính theo byte lưu trữ nên một nhóm nhiều cột nhỏ qua được và dùng hàng trăm MB | **Đã sửa**: lttb bị chặn thêm `dòng × đường × 24 ≤ historyMaxScanMiB` (`SCAN_LIMIT`) |
| 2 | Medium | `series` với `res=1m/1h` đọc toàn bộ hàng tổng hợp của khoảng (tới 3650 ngày) vào bộ nhớ, không có giới hạn như `aggregate` | **Đã sửa**: ước tính `ô × đường > 300.000` thì `RANGE_TOO_LARGE` trước khi đọc (test `ASeriesOverAHugeRange…`) |
| 3 | Medium | Chưa hủy truy vấn khi trình duyệt ngắt kết nối (cờ hủy của `ReaderPool` không bao giờ bật); một truy vấn nặng giữ chỗ tới hạn 10 s (xuất 120 s) | **Còn lại, chấp nhận có điều kiện**: CivetWeb không công khai socket của kết nối để kiểm `POLLRDHUP`; giảm tác hại bằng hạn 10 s/120 s, tối đa 2 truy vấn + 1 xuất, một yêu cầu mỗi phiên (cần phiên viewer hợp lệ). Xuất CSV đã phát hiện ngắt khi `mg_write` lỗi và dừng. Ghi vào "Điều kiện xem xét lại" của ADR-032 (vá CivetWeb thêm truy vấn socket) |
| 4 | Low | Khóa phiên của bộ giới hạn băm nguyên văn phần sau `Bearer ` nên một token có nhiều khóa (khác hoa thường, khoảng trắng) → một phiên chiếm hết chỗ | **Đã sửa**: dùng `bearerToken()` của cổng (test `OneTokenHasOneSession…`) |
| 5 | Low | Xuất CSV vượt ước tính bị cắt im lặng và gửi chunk kết thúc hợp lệ | **Đã sửa**: trả `ExportTooLarge`, không gửi chunk kết thúc, audit `Failed` (`aborted`) |
| 6 | Low | Hạn xuất 120 s cố định; client đọc chậm giữ một giao dịch đọc WAL tới 120 s | Còn lại (tác động nhỏ: một xuất mỗi lúc; `journal_size_limit`). Ghi trong ADR-032 |
| 7 | Low | Tên file `Content-Disposition` cho byte không ASCII, `;`, `,`, `%` đi nguyên (id nhóm do người soạn project nhập, không do client) | **Đã sửa**: chỉ `[A-Za-z0-9._-]`, ký tự khác thành `-` |
| 8 | Low | `std::thread` ném `system_error` khi hết tài nguyên, không bắt | **Đã sửa**: bắt, trả 503 `HISTORY_UNAVAILABLE` |
| 9 | Info | Handler tiến trình đọc `deadline/cancel` không khóa (đua lý thuyết) | Còn lại: gán trước khi truy vấn chạy và trên luồng riêng; ghi nhận |

Đã đọc và xác nhận không có lỗi: SQL (mọi giá trị là tham số `?`, tên bảng/cột từ catalog trích dẫn, danh sách `cid` dựng từ số nguyên nội bộ), phân tích tham số (từ chối lặp, `%` hỏng, khóa lạ, số > 15 chữ số, khoảng ≤ 3650 ngày; `__int128` đúng chỗ), không lộ tên bảng/đường dẫn/SQL trong phản hồi và audit (kiểm bằng test và bằng client x64), chống công thức CSV, cổng xác thực (HTTPS, phiên, vai trò viewer trở lên, `Sec-Fetch-Site`, GET), đua luồng của `QueryLimiter`/`ReaderPool`, CLI chỉ đọc.

## 2. Bộ tấn công và kiểm thử

`server/tests/history_api_test.cpp` (17 ca) và `tests/web-it/history-api.mjs` (bộ tấn công trên runtime x64, DB 7 ngày × 200 Tag: số tràn, `from ≥ to`, `maxPoints`, tham số lặp/lạ, chuỗi giống SQL ở nhóm và Tag, nhiều Tag, `..%2F`, `res=1;DROP`, HTTP, không phiên, POST, 6 truy vấn nặng cùng lúc). Mọi tham số sai bị 4xx, không 5xx, không lộ tên bảng.

## 3. Chưa rà trong báo cáo này

Mã TypeScript (`@mat/report-export`: chống chèn công thức CSV/XLSX, escape XML, kích thước đầu vào; `HttpHistorySource`; trang báo cáo) và Studio do rà soát phía TS (mục T156 của `tasks.md`); kết quả bổ sung vào file này khi có.
