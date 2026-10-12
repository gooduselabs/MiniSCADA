# Contract — WebSocket `/api/v1/live`, protocol 1.0.0

Thay [contract Sprint 0](../../001-platform-validation/contracts/live-ws.md). Chưa có xác thực (Sprint 5). Nguồn yêu cầu: Master Plan §10.2, §10.4; spec FR-012, FR-019…FR-023; research R4–R7.

## Kết nối

- `GET /api/v1/live` nâng cấp lên WebSocket, khung text UTF-8 JSON.
- **Kiểm Origin trước khi lấy slot** (R7):
  - Chấp nhận khi `Origin` = `http://<Host>` (cùng origin), hoặc nằm trong `allowedOrigins`, hoặc không có header `Origin`.
  - Ngược lại trả **HTTP 403** và không nâng cấp, không chiếm slot; tăng `originRejectedTotal`.
- **Đủ slot** (`active == maxClients`): gửi `{"type":"error","code":"MAX_CLIENTS_REACHED","message":"Hệ thống đã đạt tối đa N kết nối. Vui lòng thử lại sau."}` rồi đóng **4429**. `N` là giới hạn thực `min(config, project.maxClients)` (1–10; mặc định 10, đúng câu của Master Plan §10.2). Trang runtime hiển thị nguyên câu của máy chủ; nếu chỉ nhận mã 4429 mà không có bản tin thì hiện câu không có số.
- Nhận phiên thì máy chủ gửi `hello` ngay.

## Bản tin

| Chiều | `type` | Trường |
|---|---|---|
| S→C | `hello` | `protocolVersion` ("1.0.0"), `serverVersion`, `maxClients`, `heartbeatMs` (5000), `timeoutMs` (15000), `project` (`{projectId, projectVersion}` hoặc `null` khi không có project hợp lệ) |
| C→S | `subscribe` | `requestId` (string ≤ 64), `tags` (string[] 1–1000, Tag duy nhất), `mode` = `"delta"` |
| S→C | `snapshot` | `subscriptionId` (= `requestId`), `sequence`, `ts`, `tags`: `[{id, value, quality, sourceTimestamp, serverTimestamp, revision}]` **theo đúng thứ tự** `subscribe.tags` (đã bỏ Tag lạ), `unknown`: string[] |
| S→C | `delta` | `subscriptionId`, `sequence` (= trước + 1), `ts`, `tags`: `[[index, value, quality], …]` với `index` là vị trí trong mảng `snapshot.tags` |
| C→S | `unsubscribe` | `requestId`; máy chủ ngừng gửi delta, không trả lời |
| S↔C | `heartbeat` | `ts`. Máy chủ gửi mỗi 5 s; client **phải** gửi lại khi nhận. Mọi bản tin từ client đều làm mới thời điểm nhận cuối |
| S→C | `resync_required` | `reason` (`"SEND_QUEUE_OVERFLOW"`); máy chủ đóng **4409** ngay sau đó |
| S→C | `error` | `code`, `message`, `requestId?` |

Giá trị: BOOL → `true`/`false`; số → number; INT64/UINT64 → chuỗi thập phân; chưa có giá trị → `null`. `quality` ∈ `GOOD|BAD|UNCERTAIN` (máy chủ không gửi `STALE`).

## Quy tắc

1. **Snapshot và đăng ký là nguyên tử** so với bộ phát delta. Delta đầu tiên sau snapshot có `sequence = snapshot.sequence + 1`.
2. `subscribe` lần 2 trên cùng phiên **thay thế** đăng ký cũ: snapshot mới, `subscriptionId` mới. Client bỏ mọi delta có `subscriptionId` khác đăng ký hiện tại.
3. Delta được gom mỗi `deltaPeriodMs` (mặc định 250 ms, cho phép 100–250), chỉ chứa Tag đã đăng ký **có đổi** từ lần gửi trước. Chu kỳ không có thay đổi thì không gửi delta.
4. Client thấy `sequence` nhảy thì gửi lại `subscribe` (cùng danh sách, `requestId` mới). Delta nhảy sequence **không được áp**: giá trị, chất lượng và `sequence` giữ nguyên tới snapshot mới, để màn hình không ghép giá trị mới với giá trị cũ của Tag thuộc delta bị mất (US3 kịch bản 3). Delta tới trước snapshot bị bỏ.
5. Hàng đợi gửi mỗi phiên ≤ **262 144 byte**. Client **đọc chậm hơn** tốc độ dữ liệu: hàng đợi vượt ngưỡng thì máy chủ bỏ nội dung chờ, gửi `resync_required`, đóng 4409, giải phóng slot ngay (`overflowClosedTotal`). Client **ngừng đọc hẳn** (socket không nhận): một lần ghi bị chặn quá 10 s (`request_timeout_ms`), kể cả khi đã ghi được một phần frame, thì máy chủ bỏ phiên, giải phóng slot và cắt TCP ngay (`mg_mat_force_close`, `writeFailedTotal`); không có `resync_required` hay mã đóng trong trường hợp này. Cả hai đường đều giữ bộ nhớ mỗi phiên ≤ 256 KB + một bản tin đang ghi. Client kết nối lại theo backoff.
6. Frame client > **96 KiB** (98 304 byte, đủ cho 1000 Tag × id 64 ký tự) → máy chủ đóng **1009** ngay khi đọc header frame, không cấp phát payload (bản vá CivetWeb, review Sprint 1). JSON lồng sâu hơn 32 mức → `error` `BAD_MESSAGE` (đếm trên văn bản trước khi parse). JSON hỏng, `type` lạ hoặc trường sai → `error` (`BAD_MESSAGE`), phiên giữ nguyên. Đủ **20** lỗi liên tiếp (lỗi thứ 20) → đóng **1008**.
7. `subscribe` có Tag lạ: vẫn thành công với các Tag hợp lệ, Tag lạ nằm trong `unknown`. Danh sách rỗng sau khi lọc → `error` `NO_VALID_TAGS`.
8. `hello.protocolVersion` có MAJOR khác MAJOR client hỗ trợ: client dừng, hiển thị "Phiên bản giao thức không tương thích", **không** thử lại tự động.

## Mã đóng và hành vi client

| Mã | Ý nghĩa | Client |
|---|---|---|
| 4429 | Đủ client | Trạng thái `full`: hiển thị thông báo đầy và đếm ngược **30 s**, rồi thử lại; nút "Thử lại ngay" thử lại tức thì. Không dùng backoff |
| 4408 | Máy chủ không nhận gì > 15 s | Kết nối lại theo backoff |
| 4409 | `resync_required` (hàng đợi đầy) | Kết nối lại theo backoff |
| 1008 / 1009 | Vi phạm giao thức / bản tin quá lớn | Kết nối lại theo backoff, ghi lỗi console |
| 1013 | Máy chủ không tạo được phiên (hết tài nguyên) | Kết nối lại theo backoff |
| 4001 | Client tự đóng vì máy chủ im > 15 s | Kết nối lại theo backoff |
| 1000/1001/1006/khác | Đóng bình thường / mất mạng | Kết nối lại theo backoff |

**Backoff:** 1 s, 2 s, 4 s, … tối đa 30 s, nhân hệ số ngẫu nhiên [0,5; 1,0]. Đặt lại về 1 s sau khi nhận snapshot.

**STALE:** từ lúc mất kết nối (hoặc watchdog 15 s) tới khi có snapshot mới, mọi Tag hiển thị chất lượng `STALE` và giữ giá trị cuối.

## Đóng kết nối phía máy chủ

Từ lúc bắt đầu gửi close frame (4429, 4408, 4409, 1008, 1009, 1013), máy chủ chờ client đóng tối đa **5 s**, rồi tự cắt TCP. Nhờ vậy một client không trả lời không giữ được worker thread. Khi lần ghi bị lỗi hoặc quá hạn, máy chủ cắt TCP ngay. Test tích hợp in-process trên x64: `server/websocket/tests/civet_transport_test.cpp`.

## Chỉ số (đọc qua `/api/v1/system/info`)

`clients`, `maxClients`, `rejectedTotal` (đầy), `originRejectedTotal`, `overflowClosedTotal` (4409), `timeoutClosedTotal` (4408), `writeFailedTotal` (ghi bị chặn quá 10 s).
