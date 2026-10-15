# ADR-032: API truy vấn lịch sử: nguồn theo cửa sổ, giảm điểm, giới hạn tải, HTTPS và đăng nhập

- **Trạng thái:** Accepted trên x64 (2026-10-15). Số đo BL335 (SC-006, SC-007, SC-009, SC-011) **cần thiết bị/SSH**: chưa đo (T144, T145).
- **Ngày:** 2026-10-13
- **Liên quan:** [specs/010-history-reports](../../specs/010-history-reports/spec.md) (US3, FR-018…FR-031), [research R4–R8](../../specs/010-history-reports/research.md), [contracts/history-api.md](../../specs/010-history-reports/contracts/history-api.md); [ADR-008](008-data-logging.md), [ADR-011](011-auth-roles-audit.md), [ADR-021](021-web-login-certificates.md), [ADR-031](031-history-aggregates.md); Constitution III, IV, V.

## Bối cảnh

Trình duyệt cần đọc lịch sử (biểu đồ nhiều đường, bảng, báo cáo) từ BL335 (RAM 1 GB, 2 nhân) khi 10 client đang xem live. Yêu cầu: truy vấn 24 giờ ≤ 2 s; giảm điểm tối đa N điểm mỗi đường; xuất CSV; HTTPS và đăng nhập (viewer đọc); giữ ngân sách (RSS ≤ 150 MB, CPU ≤ 30 %). Dòng thô là bảng rộng: đọc một cột vẫn đọc cả dòng (khoảng 1,8 KB cho nhóm 200 Tag), nên truy vấn dài từ dòng thô không đạt 2 s ([research R4](../../specs/010-history-reports/research.md)).

## Các phương án

| Vấn đề | Phương án đã xét | Chọn |
|---|---|---|
| Nguồn dữ liệu | luôn dòng thô; luôn bảng tổng hợp; **chọn theo cửa sổ giảm điểm và ước tính quét** | chọn theo cửa sổ (`res=auto`), `decimate` khi không có tổng hợp |
| Giảm điểm | LTTB; min/max theo cửa sổ (M4); lấy mẫu | **`minmax` mặc định** (một lượt, giữ gai), `lttb` tùy chọn, `decimate` dự phòng; ghép bucket khi nguồn là tổng hợp |
| Đọc/ghi đồng thời | dùng kết nối của historian; **kết nối chỉ đọc riêng (WAL)**; tiến trình riêng | kết nối chỉ đọc riêng, tối đa 3, ưu tiên thấp |
| Bảo vệ tải | hàng đợi ở máy chủ; **429 ngay + thử lại ở trình duyệt** | 2 truy vấn đồng thời, 1 xuất CSV, quét ≤ 64 MiB, hạn 10 s |
| Truy cập | cho HTTP theo `viewerAccess`; **chỉ HTTPS + đăng nhập viewer** | chỉ HTTPS + viewer; cookie cho `GET` |
| Báo cáo | máy chủ dựng theo ca/tháng; **máy chủ trả cửa sổ cố định, trình duyệt ghép** | `aggregate` với `bucketMs`, `offsetMs`; ca đều; tháng ghép từ ngày |

## Quyết định

1. Năm endpoint `GET /api/v1/history/{catalog, series, aggregate, rows, export.csv}`, API thiết bị 1.4.0 (số căn lại theo hiện trạng). Thời gian là epoch ms UTC; hiển thị theo `timeZone` của nhóm.
2. `res=auto`: cửa sổ giảm điểm `w = (to − from) / (maxPoints / 2)`; `w ≥ 1 giờ` → bảng giờ, `w ≥ 1 phút` → bảng phút, ngược lại dòng thô nếu ước tính quét (hiệu `seq`) ≤ 64 MiB; quá giới hạn mà có tổng hợp thì dùng tổng hợp, không có thì `decimate` kèm `approximate: true`; `res=raw` rõ ràng quá giới hạn: 422 `SCAN_LIMIT` trước khi quét.
3. Giảm điểm tự viết (C++), tất định, không vượt `maxPoints`; `minmax` giữ mọi cực trị của từng cửa sổ.
4. Giới hạn: ≤ 16 Tag, `maxPoints` ≤ 5.000, ≤ 5.000 cửa sổ, ≤ 500 dòng mỗi trang, ≤ 500.000 dòng CSV, 2 truy vấn và 1 xuất đồng thời, 1 yêu cầu mỗi phiên, hạn 10 s (CSV 120 s); 429 `BUSY` + `Retry-After`; hủy khi ngắt kết nối. Các số là điểm xuất phát, chỉnh bằng `runtime.json` sau số đo.
5. Kết nối đọc: `query_only`, `cache_size` 4 MiB, `mmap_size` 0, luồng `nice +10`, progress handler kiểm hạn và cờ hủy; tổng cache SQLite toàn tiến trình ≤ 32 MiB.
6. Quyền: HTTPS 8443, role từ `viewer`; Bearer và cookie (chỉ `GET`, kiểm `Sec-Fetch-Site`); không phụ thuộc `viewerAccess` hay `viewerLogin`. Truy vấn thường đếm, không audit; xuất CSV audit `history.export`.
7. Mọi tham số kiểm chặt, tên nhóm và Tag tra từ `catalog`, không chuỗi nào của client vào SQL; phản hồi không chứa tên bảng, đích, đường dẫn.

## Hệ quả

- **Tốt:** 24 giờ đọc ≈ 11.520 hàng thay vì ≈ 150 MB; gai không mất; máy chủ không giữ kết nối chờ; tải bị chặn trước khi quét.
- **Xấu:** nhóm không bật tổng hợp trả kết quả xấp xỉ cho khoảng dài; kiosk HTTP không đăng nhập không xem được lịch sử; 10 client mở 4 biểu đồ cùng lúc gặp 429 nhiều (thử lại ở trình duyệt, kéo dài vài giây).
- **Rủi ro:** luồng CivetWeb đang chờ truy vấn khiến thiếu luồng cho live: `httpThreads` kiểm ở T070.

## Số đo / bằng chứng

x64 (container trên máy dev), DB 7 ngày x 200 Tag (120.960 dòng thô, 2.049.600 hàng tổng hợp, 379 MB), 20 lần mỗi truy vấn (`docs/reports/010-query-x64.json`, `010-api-x64.json`, `010-load-x64.json`):

| Truy vấn | p50 | p95 |
|---|---|---|
| `series` 24 giờ, 8 đường, auto | 97 ms | 135 ms |
| `series` thô 1 giờ, 16 đường | 7 ms | 12 ms |
| `series` 7 ngày, 8 đường, auto | 645 ms | 847 ms |
| `aggregate` 7 ngày, bucket 8 giờ | 14 ms | 24 ms |
| `rows` trang 200 | 17 ms | 23 ms |
| CSV 24 giờ, 50 Tag (≈ 8,2 MB) | 332 ms | 364 ms (lần đo lớn nhất) |

- 6 truy vấn nặng cùng lúc: 2 chạy, 4 nhận 429 trong ≤ 17,5 ms.
- Tải 600 s (10 phiên live, 2 truy vấn liên tục, luồng thứ ba): 7.128 yêu cầu, 432 trả 429 (≤ 6,6 ms), p95 73 ms, 0 mất sequence, khoảng trống live lớn nhất 277 ms, RSS đỉnh 106 MB. Một lần chạy trước cùng kịch bản có một ngoại lệ 429 mất 1,7 s và khoảng trống 2,8 s trong lúc máy dev chạy build và Chrome khác; không lặp lại (ghi trong báo cáo).
- Rà soát bảo mật: `docs/reports/010-security-review.md`; 100 % ca tấn công bị từ chối đúng mã, không 5xx, không lộ tên bảng.
- **Phiên web: mặc định 8 lên 12 (2026-10-15).** Chạy `history-10` (10 trình duyệt cùng F5 màn hình 4 biểu đồ) trên runtime x64 thật lộ ra rằng hạn 8 phiên web của 007 (D33, lý do ghi "như 005", không phải ngân sách) loại 2 trong 10 phiên: trang hiện "Đăng nhập để xem lịch sử". Đo cùng kịch bản với hạn 12 và 8 (`docs/reports/010-websessions-x64.json`): VmHWM 35,4 MB so với 35,8 MB, VmRSS 18,0 so với 18,3 MB, CPU cùng bậc (một phiên chỉ là token, giá trị CSRF và địa chỉ), nên chọn 12 để 10 client live (`maxClients` 10) vừa với đăng nhập mỗi người một lần. Đổi `webMaxSessions` mặc định (C++, `runtime.json`, `mat-runtime.md`, spec và hợp đồng 007), test A27 và test `web_api` đổi sang 13 phiên; tổng với phiên Bearer vẫn ≤ 32. Kịch bản `history-10` x64 dùng mỗi phiên một tài khoản viewer (`xem1`..`xem10`).
- Còn lại: số trên BL335 (người dùng cho phép SSH).

## Điều kiện xem xét lại

- p95 24 giờ trên BL335 > 2 s: xem lại chỉ mục, cache, giảm giới hạn; hoặc tách tiến trình `mat-history`.
- Truy vấn làm live gián đoạn > 1 s (SC-009): tiến trình riêng, hoặc hạ ưu tiên và giới hạn chặt hơn.
- Khách hàng cần kiosk xem lịch sử không đăng nhập: thêm tùy chọn `historyViewerAccess` theo `viewerAccess` (kèm đánh giá bảo mật).
- Cần truy vấn nhiều nhóm một yêu cầu hoặc khóa API cho hệ thống ngoài: GĐ 6 ("API dữ liệu ra").
