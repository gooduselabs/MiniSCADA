# ADR-006: Giao thức dữ liệu sống 1.0.0, kiểm Origin và hàng đợi gửi theo phiên

- **Trạng thái:** Accepted (Sprint 1, 2026-10-10). Phê duyệt chính thức của Tech Lead cùng nghiệm thu Sprint 1.
- **Ngày:** 2026-10-10
- **Liên quan:** Master Plan §6.1, §10.2, §10.4; Constitution IV, V; [ADR-001](001-web-server.md) (phương án C), [ADR-004](004-schema-versioning.md) (điểm 7 còn mở); contract [specs/002-vertical-slice/contracts/live-ws.md](../../specs/002-vertical-slice/contracts/live-ws.md).

## Bối cảnh

Sprint 0 chỉ có giao thức PoC: `subscribe` "all", không có phiên bản giao thức, client thứ 11 không thử lại, ghi đồng bộ (một client chậm có thể chặn bộ phát), không kiểm `Origin` (review S-3, T058). ADR-004 điểm 7 để mở việc đánh phiên bản giao thức live. Sprint 1 cần một giao thức ổn định để runtime web và Studio Preview dùng chung (`@mat/live-client`).

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Định dạng delta | (a) `[index, value, quality]` theo vị trí trong danh sách đã đăng ký; (b) `{id, value, quality}`; (c) nhị phân (MessagePack) | **(a)**: gọn khoảng 3 lần so với (b) ở 500 Tag; dễ debug hơn (c), không thêm thư viện |
| Mất sequence | (a) đóng kết nối rồi kết nối lại (Sprint 0); (b) gửi lại `subscribe`, máy chủ thay thế đăng ký và gửi snapshot mới | **(b)**: không mất slot giữa chừng, bớt một lần bắt tay |
| Client chậm | (a) ghi đồng bộ; (b) một thread ghi chung; (c) hàng đợi 256 KB + thread ghi riêng mỗi phiên | **(c)** (ADR-001) |
| Client thứ 11 | (a) không thử lại; (b) tự thử lại sau 30 s, có đếm ngược và nút "Thử lại ngay" | **(b)** (Master Plan §10.2, clarification spec 002) |
| Chống CSWSH | (a) không kiểm; (b) kiểm `Origin` trước khi lấy slot | **(b)** |

## Quyết định

1. **Phiên bản giao thức** `protocolVersion` trong `hello`, SemVer, bắt đầu `1.0.0` (`schemas/protocol-version.json`). Client từ chối MAJOR khác và **không** tự thử lại. Thêm trường hoặc bản tin mới là tăng MINOR; đổi ý nghĩa hoặc định dạng là tăng MAJOR. Điểm 7 của ADR-004 được đóng bằng quyết định này.
2. **Đăng ký theo danh sách Tag** (tối đa 1000). Snapshot giữ đúng thứ tự yêu cầu, Tag lạ trả trong `unknown`. Delta là `[index, value, quality]`. Sequence tính theo phiên. `subscribe` lần 2 thay thế đăng ký cũ.
3. **Nguyên tử snapshot + đăng ký:** cả `subscribe` và chu kỳ phát delta chạy trong cùng một mutex của `LiveHub`. Hub chỉ đưa bản tin vào hàng đợi, không bao giờ ghi socket.
4. **Hàng đợi gửi 262 144 byte mỗi phiên**, một thread ghi cho mỗi phiên. Hai đường bảo vệ, đều giải phóng slot ngay:
   - client đọc chậm hơn tốc độ dữ liệu: hàng đợi vượt ngưỡng → bỏ nội dung chờ, gửi `resync_required`, đóng **4409** (`overflowClosedTotal`);
   - client ngừng đọc hẳn: lần ghi bị chặn quá `request_timeout_ms` (10 s) → bỏ phiên (`writeFailedTotal`). Trường hợp này thường xảy ra **trước** khi hàng đợi đầy: đo trên BL335, lúc hết hạn ghi hàng đợi mới có 190 KB. Ping/pong của CivetWeb (`websocket_timeout_ms` 5 s) là lớp cắt kết nối chết thứ hai.
5. **Giới hạn đầu vào:** frame client ≤ 96 KiB, kiểm **trước khi cấp phát** (bản vá CivetWeb `MG_MAT_MAX_WS_FRAME`); JSON lồng ≤ 32 mức, đếm trước khi parse. Sau close frame, client có 5 s để đóng, quá hạn thì máy chủ cắt TCP (`mg_mat_force_close`).
6. **Mã đóng:** 4429 đầy (client chờ 30 s), 4408 im lặng > 15 s, 4409 hàng đợi đầy, 1008 vi phạm giao thức (đủ 20 lỗi liên tiếp), 1009 frame > 96 KiB (98 304 byte), 1013 máy chủ không tạo được phiên, 4001 client tự đóng khi máy chủ im > 15 s.
7. **Origin:** chấp nhận cùng origin (`http://<Host>`), các origin trong `allowedOrigins` (mặc định là origin của Studio), và yêu cầu **không có** `Origin` (client không phải trình duyệt, không mang cookie). Còn lại trả HTTP 403 trước khi lấy slot. Khi có xác thực bằng cookie (Sprint 5), cần xem lại quyết định cho yêu cầu không có Origin. *Ghi chú 2026-10-13:* [ADR-021](021-web-login-certificates.md) điểm 6 đã xem lại: yêu cầu nâng cấp có cookie phiên mà không có `Origin` (hoặc `Origin` lạ) bị từ chối 403 trước khi lấy slot; yêu cầu không cookie giữ như trên.

## Số đo / bằng chứng

- Unit test: `send_queue_test` (8), `live_hub_test` (16, gồm 100 lần subscribe xen kẽ bộ phát: 0 gap), `origin_test` (4), `connection.test.ts` (14 ở cuối Sprint 1; 16 sau GĐ 0).
- Test tích hợp x64 (thêm ngày 2026-10-11, GĐ 0): `civet_transport_test` (6), chạy CivetWeb thật trong tiến trình:
  - client thứ 11 nhận 4429;
  - câu báo đầy dùng giới hạn thực;
  - phiên im bị đóng 4408 và trả slot;
  - hạn đóng cắt client không trả lời close frame;
  - frame > 96 KiB bị đóng 1009;
  - ghi thiếu thì bỏ phiên.
- Trên BL335 (2026-10-10, client qua Internet, cổng 9080): xem [sprint1-acceptance.md](../reports/sprint1-acceptance.md).
  - 10 client × 500 Tag × 300 s: 0 mất sequence; client 11 nhận 4429.
  - Resub 100 lần (5 Tag): 0 gap, 0 delta cũ.
  - Resub 500 Tag liên tục qua đường Internet: máy chủ đóng **4409** sau 12 snapshot vì băng thông không kịp. Đây là cơ chế bảo vệ hoạt động đúng trên thiết bị thật.
  - Client ngừng đọc hẳn (9 client thường + 1 client chậm, 200 s và 600 s): client chậm bị bỏ do ghi quá hạn 10 s (lần 200 s: `writeFailedTotal` = 1, [sprint1-slow-deploy2.json](../reports/sprint1-slow-deploy2.json); log: `write failed/timed out (queued 190753 B)`); 9 client còn lại 0 mất sequence; RSS 3,8–4,4 MB (lần 600 s, [sprint1-slow-budget.csv](../reports/sprint1-slow-budget.csv)).
  - Origin lạ: 403, không tốn slot.

## Hệ quả

- **Tốt:** client chậm không ảnh hưởng client khác hay bộ nhớ máy chủ; client và Studio dùng chung một thư viện; giao thức có phiên bản để tiến hóa.
- **Xấu:** thêm tối đa 10 thread ghi; delta theo chỉ số buộc client giữ đúng snapshot (đã có test).
- **Rủi ro:** client resubscribe liên tục với nhiều Tag trên đường truyền chậm sẽ bị 4409 lặp lại. Client chuẩn chỉ resubscribe khi mất sequence nên không gặp trường hợp này.

## Điều kiện xem xét lại

- Xác thực bằng cookie (Sprint 5): xem lại việc chấp nhận yêu cầu không có `Origin`.
- Số Tag mỗi màn hình vượt khoảng 2000 hoặc băng thông thiết bị trở thành nút cổ chai: cân nhắc định dạng nhị phân.

## Ghi chú (feature 009, 2026-10-15)

- Giao thức live lên **1.3.0** (cộng tương thích ngược): đăng ký riêng `subscribeAlarms`, bản tin `alarmSnapshot` và `alarmDelta` với `sequence` riêng; chi tiết và số đo ở [ADR-029](029-alarm-live-api.md). Quyết định 1.0.0 ở trên (hàng đợi 256 KB mỗi phiên, kiểm Origin, 4429, 4409) không đổi và được dùng lại cho kênh alarm.
- Bằng chứng x64 (`docs/reports/009-compat-x64.json`, 36 kiểm): client 1.2.0 đóng băng nối được runtime 1.3.0 và lên trạng thái live; kịch bản bão 200 alarm, 10 client (3 chậm): 0 phiên 4409, hàng đợi cao nhất dưới 50 % của 256 KB (`009-storm-x64.json`). BL335 chưa đo.
