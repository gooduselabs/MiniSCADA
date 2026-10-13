# ADR-032: API truy vấn lịch sử: nguồn theo cửa sổ, giảm điểm, giới hạn tải, HTTPS và đăng nhập

- **Trạng thái:** Proposed (feature 010, 2026-10-13). Chưa có số đo; số đo x64 và BL335 do task T073, T144, T145.
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

Chưa đo. Dự kiến: SC-006 (24 giờ ≤ 2 s, p95), SC-007, SC-009, SC-011 trên BL335; số x64 ở `docs/reports/010-query-x64.json`.

## Điều kiện xem xét lại

- p95 24 giờ trên BL335 > 2 s: xem lại chỉ mục, cache, giảm giới hạn; hoặc tách tiến trình `mat-history`.
- Truy vấn làm live gián đoạn > 1 s (SC-009): tiến trình riêng, hoặc hạ ưu tiên và giới hạn chặt hơn.
- Khách hàng cần kiosk xem lịch sử không đăng nhập: thêm tùy chọn `historyViewerAccess` theo `viewerAccess` (kèm đánh giá bảo mật).
- Cần truy vấn nhiều nhóm một yêu cầu hoặc khóa API cho hệ thống ngoài: GĐ 6 ("API dữ liệu ra").
