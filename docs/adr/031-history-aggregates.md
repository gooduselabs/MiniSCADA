# ADR-031: Bảng tổng hợp 1 phút và 1 giờ trong `history.db`: tín hiệu giữ, bảng dài, ghi cùng giao dịch

- **Trạng thái:** Proposed (feature 010, 2026-10-13). Chưa có số đo; số đo x64 và BL335 do task T049, T143 của [tasks.md](../../specs/010-history-reports/tasks.md).
- **Ngày:** 2026-10-13
- **Liên quan:** [specs/010-history-reports](../../specs/010-history-reports/spec.md) (US2, FR-009…FR-017), [research R2, R3](../../specs/010-history-reports/research.md), [contracts/history-db.md](../../specs/010-history-reports/contracts/history-db.md); [ADR-008](008-data-logging.md) (lưu trữ 003); Constitution III (ngân sách ghi), VII (SQLite WAL `NORMAL`).

## Bối cảnh

003 ghi dòng thô vào bảng rộng `log_<table>` (mỗi dòng một thời điểm, mỗi Tag một cột). Một dòng thô của nhóm 200 Tag dài khoảng 1,6–1,8 KB; 24 giờ ở 1 dòng/giây là khoảng 150 MB. Biểu đồ lịch sử và báo cáo cần truy vấn 24 giờ ≤ 2 s trên BL335 và số liệu theo ca, ngày, tháng (min, max, trung bình, tổng, cuối) mà không quét dòng thô. Dòng thô của nhóm `onChange` thưa và không đều, nên trung bình số học các dòng không phản ánh thời gian.

## Các phương án

| Vấn đề | Phương án đã xét | Chọn |
|---|---|---|
| Nơi tính | khi truy vấn từ dòng thô; trong lúc ghi (bộ cộng dồn); công việc nền đọc lại dòng thô | **bộ cộng dồn trong lúc ghi**, bucket đóng được ghi cùng giao dịch commit |
| Định nghĩa trung bình, tổng | trung bình số học các dòng; **tín hiệu giữ** (giá trị giữ tới dòng kế) | **tín hiệu giữ**: `sumw` (giá trị × ms), `wms`; `first` mang từ cửa sổ trước |
| Dạng bảng | bảng rộng (7 giá trị × số Tag cột); **bảng dài** `(cid, res, bucket)` | **dài**, `WITHOUT ROWID`, `cid` tra từ `mat_agg_cols` |
| Độ phân giải | chỉ phút; chỉ giờ; phút và giờ; thêm ngày | **phút và giờ**, giờ ghép từ phút; ngày và ca ghép khi truy vấn |
| Giá trị lưu | `min, max, avg, last` (lộ trình); thêm `first`, `n`, `sumw`, `wms` | `n, min, max, first, last, sumw, wms` (đủ cho `avg`, tổng tích phân, `delta`, ghép chính xác) |
| Khôi phục | cờ "đã tổng hợp" trên từng dòng thô; mốc theo bảng; dựng lại hết | **mốc `agg_built_to` cập nhật mỗi phút**, dựng lại từ dòng thô sau mốc, upsert ghép |

## Quyết định

1. Schema 2 của `history.db`: `mat_agg(cid, res, bucket, n, min, max, first, last, sumw, wms)` `PRIMARY KEY (cid, res, bucket)` `WITHOUT ROWID`; `mat_agg_cols`; `mat_runs` (lần chạy và lần sống cuối); bốn cột mới của `mat_tables` (thời hạn bucket, `agg_built_to`, `agg_back_to`). Nâng cấp bằng thêm bảng và cột, không viết lại dữ liệu; mở bằng runtime cũ vẫn chạy.
2. Bộ cộng dồn tín hiệu giữ theo từng cột có tổng hợp; ngắt tín hiệu (`break`) khi quality xấu, khởi động lại, đồng hồ không hợp lệ hoặc nhảy, ghi tạm dừng, lỗi lưu trữ. Chỉ Tag số và BOOL.
3. Bucket phút đóng được ghi **cùng giao dịch** với dòng thô hoặc sau; `agg_built_to` cập nhật mỗi phút trong giao dịch đó (không mỗi commit, để không thêm ≈ 140 MB/ngày ghi). Sau khởi động lại: dựng bucket từ dòng thô `≥ agg_built_to`, ghi bằng **upsert ghép** (cộng `n`, `sumw`, `wms`; `min`/`max`; `first` giữ; `last` mới) nên một lần chạy lại giữa phút không tạo trùng; giờ dựng lại từ bucket phút và `INSERT OR REPLACE`.
3. Dựng bù ở nền cho nhóm đã có dữ liệu thô (≤ 20 ms mỗi lượt, lát ≤ 1 giờ, gieo tín hiệu qua `mat_runs`).
4. Thời hạn riêng cho bucket phút (31 ngày mặc định) và giờ (730 ngày); trần dung lượng xóa dòng thô, rồi bucket phút, rồi bucket giờ.
5. Mọi giao dịch mới ở `synchronous=NORMAL`; không thêm ngoại lệ vào Constitution.
6. Hai bản phép ghép và đại lượng suy ra (`avg`, `sum`, `delta`): C++ `core/historian/agg_math.*` và TS `packages/history-math`, cùng bộ vector `tests/agg-vectors`; bản tham chiếu độc lập `tools/history-ref` sinh kết quả mong đợi.

## Hệ quả

- **Tốt:** truy vấn dài đọc một lượng nhỏ hàng (24 giờ × 8 Tag ≈ 11.520 hàng); `delta`, tích phân và giờ chạy chính xác; báo cáo ghép được theo ca, ngày, tháng; không có đường quét dòng thô lớn.
- **Xấu:** ghi thêm ≈ 37,5 MB/ngày cho 200 Tag (ước tính, chưa đo); thêm một bộ cộng dồn trên đường ghi nóng; số nguyên 64 bit trên 2^53 mất chính xác trong số tổng hợp; `delta` không chính xác qua `break` (khởi động lại, dựng bù lại).
- **Rủi ro:** lỗi bộ cộng dồn làm sai báo cáo âm thầm: giảm bằng vector chung, `tools/history-ref` độc lập và `--verify-aggregates` chạy được trên thiết bị.

## Số đo / bằng chứng

Chưa đo. Dự kiến: SC-003 (x64, so với `history-ref`), SC-004 (ghi và CPU, x64 rồi BL335), SC-005 (kill100). Bảng này được điền khi các task xong.

## Điều kiện xem xét lại

- Ghi tổng hợp vượt 40 MB/ngày cho 200 Tag hoặc CPU thêm > 3 điểm (SC-004): xem lại kích thước hàng (nén số, bỏ `first` khi bằng `last`), hoặc chỉ tổng hợp giờ.
- Khách hàng cần phân vị, độ lệch chuẩn hoặc hàm có điều kiện: thêm cột hoặc bảng mới, đổi schema 3.
- Cần ca không đều: thêm đường ghép từ bucket phút nhiều cửa sổ hoặc bảng phụ.
