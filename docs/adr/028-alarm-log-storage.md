# ADR-028: Alarm log trong `alarm.db` riêng: WAL NORMAL, xác nhận bền nhờ audit FULL, mất điện chỉ về phía an toàn

- **Trạng thái:** Proposed (feature 009, GĐ 4; quyết định "người dùng giao toàn quyền 2026-10-11")
- **Ngày:** 2026-10-13
- **Liên quan:** [specs/009-alarms](../../specs/009-alarms/plan.md), [spec](../../specs/009-alarms/spec.md) (D12–D15, D17, D20, D37; FR-037 đến FR-044), [research](../../specs/009-alarms/research.md) R8–R12, R22; [ADR-008](008-data-logging.md), [ADR-011](011-auth-roles-audit.md), [ADR-017](017-tag-engine-v1.md), [ADR-005](005-resource-budget.md), [ADR-027](027-alarm-model-engine.md); [Constitution](../../.specify/memory/constitution.md) III, V, VI.

## Bối cảnh

Alarm cần lịch sử có vòng đời (bật, xác nhận, hết), có thời hạn lưu, chịu mất điện, trong ngân sách ghi eMMC 2 GB/ngày (Constitution III). BL335 có RTC không chạy, mất điện là chuyện thường. Constitution 2.0.1 chỉ cho hai ngoại lệ `synchronous=FULL`: mốc gửi historian và `audit.db`. `history.db` (003) là bảng rộng theo Tag, `audit.db` là nhật ký bảo mật; cả hai không hợp để chứa sự kiện có vòng đời. Xác nhận là hành động của người, đã có nơi bền (`audit.db` FULL, ghi trước khi áp dụng).

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Độ bền | `FULL` cho `alarm.db` (cần sửa Constitution thành ngoại lệ thứ ba, nhiều ghi hơn); **`NORMAL` + audit FULL ghi trước cho hành động của người** | NORMAL, không ngoại lệ thứ ba (D13) |
| Nơi lưu | chung `history.db` (chu kỳ, thời hạn khác; hỏng chung); chung `audit.db` (trộn dữ liệu vận hành vào nhật ký bảo mật có FULL); **file `alarm.db` riêng** | file riêng (D12) |
| Mô hình bảng | nhật ký sự kiện 4 dòng mỗi lần (bật, xác nhận, hết, xác nhận hết); file nối đuôi tự viết; **một dòng mỗi lần xảy ra, cập nhật tại chỗ** | `alarm_occurrence` (D20) |
| Bão alarm | giới hạn tốc độ ghi toàn cục; **tự cách ly instance chập chờn** | tự cách ly (D15) |
| Lỗi đĩa | dừng runtime; **dừng ghi lịch sử, động cơ vẫn chạy** | dừng ghi, engine chạy |

## Quyết định

1. **File riêng** `<dataDir>/alarm.db`, WAL, `synchronous=NORMAL`, `cache_size` ≤ 2 MiB, `journal_size_limit` 64 MiB, quyền `0600`. **Không xin ngoại lệ Constitution thứ ba.**
2. **Lược đồ:** `alarm_occurrence` (một dòng mỗi lần xảy ra: mã tăng dần, `alarm_id`, `ts_active_ms`, `clock_ok`, `ts_ack_ms`, `ack_user`, `ts_return_ms`, `ts_return_ack_ms`, `return_ack_user`, `priority`, `class`, `area`, `text`, `value_active`, `quality_active`, `reason`, cờ `startup`, `inputBad`, `closedBy`), cập nhật tại chỗ khi xác nhận và khi hết; `alarm_override` (shelve và disable bền); `alarm_meta` (số phiên bản lược đồ, migration nội bộ theo số nguyên). Chỉ mục `(ts_active_ms)`, `(alarm_id, ts_active_ms)`, `(priority, ts_active_ms)` và chỉ mục một phần cho lần xảy ra đang mở.
3. **Xác nhận bền nhờ `audit.db`:** xác nhận, tạm ẩn, vô hiệu ghi audit (FULL) và commit **trước** khi áp dụng vào động cơ; `alarm.db` chỉ phản chiếu trạng thái. Audit lỗi thì 503 `AUDIT_UNAVAILABLE` và không đổi trạng thái ([ADR-029](029-alarm-live-api.md)).
4. **Hướng mất mát an toàn.** Mỗi thời điểm cắt điện và hậu quả:

   | Cắt điện lúc | Điều gì có thể mất | Trạng thái sau khởi động | Hướng |
   |---|---|---|---|
   | giữa một lần bật, chưa commit (≤ `alarmCommitMs` = 2 s) | dòng lần xảy ra | đánh giá lại từ Tag: lần xảy ra mới, cờ `startup` | an toàn: alarm vẫn hiện, chỉ lịch sử có thể thiếu một lần |
   | ngay sau xác nhận, audit đã commit, `alarm.db` chưa | cập nhật `ts_ack_ms` | quay về `ACTIVE_UNACK` | an toàn: người vận hành xác nhận lại; audit vẫn có lần xác nhận trước |
   | giữa lúc xác nhận, audit chưa commit | không có xác nhận nào | `ACTIVE_UNACK`, API chưa trả OK | an toàn: không có xác nhận giả |
   | ngay sau lần hết, chưa commit | `ts_return_ms` | dựng lại lần mở; điều kiện sai nên hết sau trễ tắt | an toàn: hết chậm vài giây, không mất alarm |
   | giữa lúc shelve (audit rồi mới áp dụng) | cập nhật `alarm_override` | alarm hiện lại như chưa shelve | an toàn: hiện thừa, không ẩn thừa |
   | giữa lúc disable (audit rồi mới áp dụng) | cập nhật `alarm_override` | alarm vẫn được đánh giá | an toàn: audit ghi disable, kỹ sư thấy và làm lại |
   | giữa lúc dọn thời hạn | một mẻ xóa dở | giao dịch bị hủy, dọn lại giờ sau | không mất dòng đang mở |
   | giữa lúc ghi WAL | không (WAL, kiểm `integrity_check`) | file nguyên vẹn; hỏng thì đổi tên `alarm.db.corrupt-<epoch>` | không hỏng file |

   Bất biến: **không bao giờ** có alarm `ACTIVE_ACK` mà `audit.db` không có dòng `alarm.ack` tương ứng (SC-008). Khi dựng lại, lần xảy ra không có xác nhận bền ở `alarm.db` là chưa xác nhận.
5. **Ghi gom ở luồng riêng:** commit mỗi `alarmCommitMs` (2.000 ms) hoặc đủ 200 thay đổi; không chặn luồng tick; bộ đệm tối đa 5.000 thay đổi, quá thì bỏ thay đổi lịch sử cũ nhất (đếm `droppedChanges` ở `system/info`); trạng thái trong RAM và hiển thị không bị ảnh hưởng.
6. **Thời hạn và trần:** `alarmRetentionDays` mặc định 180 (1 đến 3.650), `alarmMaxBytes` mặc định 64 MiB; dọn mỗi giờ một lượt (và khi vượt trần), mẻ ≤ 1.000 dòng; **chỉ xóa lần xảy ra đã đóng**, không bao giờ xóa lần đang mở; không dọn khi đồng hồ không hợp lệ (`clockOk` = false); ghi audit `alarm.purged` kèm số dòng. Không `VACUUM` tự động.
7. **Hỏng và đĩa đầy:** `integrity_check` lúc khởi động khi dấu "tắt không sạch" bật hoặc khi SQLite báo hỏng; hỏng thì đổi tên `alarm.db.corrupt-<epoch>`, tạo mới, ghi audit `alarm.purged` kèm lý do, chạy tiếp (như `history.db`). Đĩa dưới `minFreeBytes`: dừng ghi lịch sử, **engine vẫn chạy** và hiện alarm trong RAM; `system/info` có `alarms.logState` (`running`, `paused`, `error`).
8. **Tự cách ly chập chờn để giữ ngân sách eMMC:** cơ chế của [ADR-027](027-alarm-model-engine.md): instance bật ≥ `chatterLimit` lần trong 60 s bị cách ly 30 phút và chỉ ghi một dòng tổng kết; mỗi instance chập chờn tối đa khoảng 6 dòng mỗi 30 phút (SC-019).
9. **Truy vấn lịch sử** qua kết nối SQLite chỉ đọc riêng (như `HistoryReader`), không chặn ghi và tick; phân trang bằng `beforeId`, không OFFSET.
10. **Ước tính ghi:** một lần xảy ra ≈ 300 byte dữ liệu, 3 lần cập nhật tại chỗ, chỉ mục và trang 4 KiB: khoảng 12 đến 20 KiB ghi vật lý mỗi lần xảy ra sau khuếch đại. Tải chuẩn (200 alarm, 20 lần xảy ra mỗi giờ, 480 lần/ngày) ≈ 6 đến 10 MB/ngày, **< 25 MB/ngày**. Tải bão (200 alarm chập chờn liên tục, mỗi alarm tối đa 6 dòng mỗi 30 phút, ≈ 57.600 dòng/ngày; cửa sổ commit thích ứng 2 đến 30 s) **< 0,1 GB/ngày**. Cả hai là ước tính, đo ở SC-009.

## Hệ quả

- **Tốt:**
  - Không sửa Constitution; ít ghi eMMC hơn `FULL` mỗi lần bật hoặc hết.
  - Mất điện chỉ đẩy về phía an toàn (chưa xác nhận, hiện lại); kiểm được bằng `kill -9` và cắt điện thật.
  - Hỏng, thời hạn, trần riêng; không ảnh hưởng `history.db` hay `audit.db`.
  - Một dòng mỗi lần xảy ra: ít dòng và chỉ mục hơn nhật ký 4 dòng; CSV và truy vấn tự nhiên.
- **Xấu:**
  - Có thể mất tới 2 s lịch sử bật hoặc hết khi cắt điện (D14).
  - Xác nhận cuối có thể phải làm lại sau mất điện.
  - Thêm một file SQLite, một luồng ghi, một bộ dọn.
- **Rủi ro:**
  - Khuếch đại ghi của SQLite lớn hơn ước tính (trang 4 KiB, chỉ mục): đo ở SC-009, nếu vượt thì tăng `alarmCommitMs` hoặc giảm chỉ mục.
  - Dựng lại sau mất điện sinh lần xảy ra mới cờ `startup` cho alarm đang bật: lịch sử có thể có hai dòng cho một sự cố dài; chấp nhận, lọc được bằng cờ.
  - Lỗi trong thứ tự "audit trước, áp dụng sau" phá bất biến SC-008; có test chèn lỗi ở từng bước.

## Số đo / bằng chứng

- **Chưa đo.** Các số ở Quyết định 10 (< 25 MB/ngày, < 0,1 GB/ngày, 12 đến 20 KiB mỗi lần xảy ra) là ước tính; đo ở SC-009 bằng `/proc/<pid>/io` trên BL335 ⚠️🔌.
- Chưa có: 100 lần `kill -9` và ≥ 10 lần cắt điện thật (SC-008), thời gian truy vấn 100.000 dòng (SC-013), dọn không giãn live quá 250 ms (SC-010). Cắt điện thật cần người ở cạnh thiết bị.
- Cơ sở tương tự đã đo: `history.db` WAL NORMAL trên BL335 ([ADR-008](008-data-logging.md)); `audit.db` FULL ([ADR-011](011-auth-roles-audit.md)).

## Điều kiện xem xét lại

- Cắt điện thật cho thấy WAL NORMAL làm hỏng `alarm.db` hoặc mất quá 2 s: chỉnh `alarmCommitMs` hoặc xét ngoại lệ có đo.
- Ghi thật vượt ngân sách: đổi mô hình (gom theo lô lớn hơn, bỏ chỉ mục).
- Khách cần lưu alarm sang DB ngoài hoặc báo cáo ca: xem lại cùng cơ chế chuyển tiếp của 003 (ngoài phạm vi 009).
- Cần chữ ký điện tử cho xác nhận: xem lại FULL cho `alarm.db`.
