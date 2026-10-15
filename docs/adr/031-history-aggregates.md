# ADR-031: Bảng tổng hợp 1 phút và 1 giờ trong `history.db`: tín hiệu giữ, bảng dài, ghi cùng giao dịch

- **Trạng thái:** Accepted trên x64 (2026-10-15) với trần SC-004 đã đổi từ 40 lên 80 MB/ngày (người dùng ủy quyền duyệt). Số đo cuối trên BL335 chưa có: **cần thiết bị/SSH** (task T143).
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
3. Bucket phút đóng được ghi **cùng giao dịch** với dòng thô hoặc sau; `agg_built_to` và `mat_runs.alive_ms` cập nhật mỗi 15 phút (`aggFlushMs`) trong giao dịch đó (không mỗi commit, để không thêm ≈ 140 MB/ngày ghi); bucket đóng chờ trong bộ nhớ tới lượt ghi này. Sau khởi động lại: dựng bucket từ dòng thô `≥ agg_built_to`, ghi bằng **upsert ghép** (cộng `n`, `sumw`, `wms`; `min`/`max`; `first` giữ; `last` mới) nên một lần chạy lại giữa phút không tạo trùng; giờ dựng lại từ bucket phút và `INSERT OR REPLACE`.
3. Dựng bù ở nền cho nhóm đã có dữ liệu thô (≤ 20 ms mỗi lượt, lát ≤ 1 giờ, gieo tín hiệu qua `mat_runs`).
4. Thời hạn riêng cho bucket phút (31 ngày mặc định) và giờ (730 ngày); trần dung lượng xóa dòng thô, rồi bucket phút, rồi bucket giờ.
5. Mọi giao dịch mới ở `synchronous=NORMAL`; không thêm ngoại lệ vào Constitution.
6. Hai bản phép ghép và đại lượng suy ra (`avg`, `sum`, `delta`): C++ `core/historian/agg_math.*` và TS `packages/history-math`, cùng bộ vector `tests/agg-vectors`; bản tham chiếu độc lập `tools/history-ref` sinh kết quả mong đợi.

## Hệ quả

- **Tốt:** truy vấn dài đọc một lượng nhỏ hàng (24 giờ × 8 Tag ≈ 11.520 hàng); `delta`, tích phân và giờ chạy chính xác; báo cáo ghép được theo ca, ngày, tháng; không có đường quét dòng thô lớn.
- **Xấu:** ghi thêm ≈ 37,5 MB/ngày cho 200 Tag (ước tính, chưa đo); thêm một bộ cộng dồn trên đường ghi nóng; số nguyên 64 bit trên 2^53 mất chính xác trong số tổng hợp; `delta` không chính xác qua `break` (khởi động lại, dựng bù lại).
- **Rủi ro:** lỗi bộ cộng dồn làm sai báo cáo âm thầm: giảm bằng vector chung, `tools/history-ref` độc lập và `--verify-aggregates` chạy được trên thiết bị.

## Số đo / bằng chứng

x64, `historian_tool soak`, 7 ngày giả x 200 Tag, 1 dòng/giây, thời hạn 3 ngày, đồng hồ nén (`docs/reports/010-soak-x64.json`, `010-agg-write-x64.json`). "Thêm" là hiệu giữa cấu hình có và không có `aggregates`.

| Biện pháp | Ca xấu (mọi Tag đổi giá trị ngẫu nhiên) | Ca thưa (1 Tag đổi mỗi 100 ms) |
|---|---|---|
| Khóa `(cid, res, bucket)`, ghi bucket mỗi commit | 2,8 GB/ngày (sai) | n/a |
| Khóa theo thời gian `(res, bucket, cid)` + ghi mỗi 5 phút | 71,7 MB/ngày | n/a |
| + NULL cho max/first/last bằng min | 73,0 MB/ngày (không đổi: dữ liệu ngẫu nhiên) | n/a |
| + chu kỳ ghi 15 phút (mặc định hiện hành) | 64,2 MB/ngày | 57,0 MB/ngày |

Tổng ghi của nhóm 200 Tag (003 + 010) đo được ≈ 795 MB/ngày (ước tính 759): dưới ngân sách 2 GB/ngày của Constitution III. `synchronous=NORMAL` giữ nguyên, không đổi giao dịch của dòng thô. Lệch của ước tính so với số đo tổng: 5 % có tổng hợp, 4 % không.

**Vì sao không đạt 40 MB/ngày:** dữ liệu tổng hợp được lưu ≈ 21 MB/ngày (288.000 hàng phút + 4.800 hàng giờ, 70 byte mỗi hàng với 5 số thực). Mỗi trang đi qua WAL rồi qua checkpoint (x2), và xóa theo thời hạn viết lại các trang cũ: tổng ≈ 3 lần dung lượng lưu. Chu kỳ ghi dài hơn chỉ bỏ phần trang cuối bị ghi lại và trang mốc/hour, phần còn lại là dữ liệu thật. Muốn ≤ 40 MB phải giảm một nửa kích thước hàng.

**Trần mới:** SC-004 = 80 MB/ngày cho 200 Tag ở ca xấu (số đo 64–73 + biên). Hằng số ước tính `AGG_WRITE_FACTOR` = 3,6 theo ca xấu (cả TypeScript, C++ và các vector `tests/project-vectors/v06-logging-010-estimate-*`). Ca thưa chỉ bớt ≈ 11 %.

**Đổi chu kỳ ghi sang 15 phút:** mất điện làm mất tối đa 15 phút bucket đã đóng nhưng chưa ghi; khởi động lại dựng chúng từ dòng thô `>= agg_built_to` (test `ACrashRightBeforeTheFifteenMinuteFlushRebuildsAllTheUnflushedWindows`). `--verify-aggregates` dung sai 17 phút sau lần sống cuối.

**Việc sau (cần người/thiết bị):**
- Thử mã hóa float32 cho min/max/first/last của Tag FLOAT32 (lưu mẫu bit 32 bit thay vì REAL 8 byte): dự kiến giảm kích thước hàng ≈ ½ và ghi ≈ ½. Chưa làm.
- Số đo cuối SC-004, SC-022 trên BL335 (T143, T144): **cần SSH và người dùng cho phép**; chưa đo. Số x64 ở trên là số duy nhất hiện có.

## Điều kiện xem xét lại

- Ghi tổng hợp vượt 80 MB/ngày cho 200 Tag (ca xấu) hoặc CPU thêm > 3 điểm (SC-004): mã hóa float32 (mục "Việc sau"), hoặc chỉ tổng hợp giờ.
- Khách hàng cần phân vị, độ lệch chuẩn hoặc hàm có điều kiện: thêm cột hoặc bảng mới, đổi schema 3.
- Cần ca không đều: thêm đường ghép từ bucket phút nhiều cửa sổ hoặc bảng phụ.
