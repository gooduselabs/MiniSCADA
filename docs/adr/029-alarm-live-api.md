# ADR-029: Alarm trên live 1.3.0 và API thiết bị 1.3.0: đăng ký riêng, xác nhận chỉ qua REST, audit trước rồi áp dụng

- **Trạng thái:** Accepted trên x64 2026-10-16, số đo thiết bị BL335 chờ SSH (feature 009, GĐ 4; quyết định "người dùng giao toàn quyền 2026-10-11")
- **Ngày:** 2026-10-13
- **Liên quan:** [specs/009-alarms](../../specs/009-alarms/plan.md), [spec](../../specs/009-alarms/spec.md) (D18, D19, D31, D35; FR-028, FR-029, FR-045 đến FR-054, FR-088 đến FR-092), [research](../../specs/009-alarms/research.md) R13–R15, R25; [ADR-006](006-live-protocol-v1.md), [ADR-011](011-auth-roles-audit.md), [ADR-017](017-tag-engine-v1.md), [ADR-018](018-viewer-source-filter.md), [ADR-021](021-web-login-certificates.md), [ADR-027](027-alarm-model-engine.md), [ADR-028](028-alarm-log-storage.md); [Constitution](../../.specify/memory/constitution.md) IV, V, VI.

## Bối cảnh

Live 1.2.0 chỉ mang Tag (`snapshot`, `delta`); `LiveHub` có hàng đợi 256 KB mỗi phiên, tràn thì `resync_required` rồi đóng 4409; `write` trên live bị từ chối (`LIVE_WRITE_NOT_ALLOWED`). Alarm cần cấu trúc riêng (lớp, khu vực, số đếm), tương thích ngược với client cũ, và chịu bão 200 alarm đổi trong một tick tới 10 phiên. Xác nhận là thao tác của người vận hành: phải kiểm role ở backend, ghi audit FULL trước khi áp dụng (Constitution V). Cookie, CSRF, `Origin` đã có từ 007 (ADR-021).

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Đường đẩy | trộn alarm vào `delta` của Tag; **đăng ký riêng `subscribeAlarms`** với snapshot, delta, `sequence` riêng | đăng ký riêng (D18) |
| Xác nhận | qua WebSocket (`ack`); **chỉ REST** (một đường kiểm quyền, như ghi Tag) | REST (D31) |
| Định danh khi xác nhận | ack theo `id` không kèm `occurrence` (xác nhận oan alarm mới bật); **theo cặp (`id`, `occurrence`) và `upToRevision`** | cặp + `upToRevision` (D19) |
| Hàng đợi đầy | bỏ delta cũ; **dồn theo instance, bản mới nhất thắng** rồi mới tới 4409 | dồn theo instance |
| Audit | áp dụng rồi ghi; **ghi audit trước, áp dụng sau** | audit trước |

## Quyết định

1. **Live 1.3.0 (MINOR, tương thích ngược):** client gửi `subscribeAlarms`, `unsubscribeAlarms`; server gửi `alarmSnapshot` (mọi instance không `NORMAL` hoặc đang shelved, kèm `classes`, `areas`, `counts`, `sequence`) và `alarmDelta` (instance đổi và instance biến mất, `counts` mới, `sequence` + 1) trong ≤ 1 tick sau thay đổi; `hello` thêm `features` (có `alarms` khi project có alarm). Không đổi bản tin hiện có; client 1.2.0 không đăng ký thì không nhận gì (SC-015). Đăng ký lần hai trên cùng phiên thay bản đăng ký và nhận snapshot mới; project không alarm trả snapshot rỗng.
2. **`sequence` riêng, đơn điệu theo phiên;** đứt thì client xin lại snapshot (`subscribeAlarms`), server có thể gửi `resync_required`. Khi hàng đợi phiên gần đầy, `alarmDelta` được **dồn theo instance** (không bỏ); vẫn đầy thì cơ chế 4409 hiện có. Động cơ đẩy sự kiện qua hàng đợi một chiều không khóa, hub rút; động cơ không chờ hub, hub không giữ khóa Tag khi gửi.
3. **Quyền bản tin:** ai đọc được live thì đọc được alarm (ADR-018). Bản tin `ack` trên live nhận `error` `BAD_MESSAGE` và ghi audit `alarm.ack` denied `LIVE_ACK_NOT_ALLOWED` (gộp 60 s). Xác nhận, tạm ẩn **không** qua WebSocket.
4. **API thiết bị 1.3.0 (MINOR):**
   - `GET /api/v1/alarms` (danh sách hiện có, lớp, khu vực, số đếm); `GET /api/v1/alarms/history` (`from`, `to`, `alarmId`, `area`, `class`, `priority`, `state`, `q`, `limit` ≤ 500, `beforeId`; khoảng ≤ 366 ngày; sai thì 400 `BAD_QUERY`);
   - `POST /api/v1/alarms/{ack,shelve,unshelve,disable,enable}`;
   - `system/info` thêm khối `alarms` (số instance, đang có, chưa xác nhận, shelved, `logState`, `droppedChanges`, kích thước `alarm.db`, thời gian tick lớn nhất 1 phút).
5. **Bảng quyền:** đọc: viewer (theo ADR-018, cookie được); `ack`, `shelve`, `unshelve`: `operator`, cookie được, kèm CSRF `X-MAT-CSRF` và `Origin`; `disable`, `enable`: `engineer`, **`cookieAllowed` = false** (chỉ phiên Bearer, như API kỹ thuật). Mọi endpoint mới khai tường minh trong `core/auth/roles.cpp`; `GET` không bao giờ đổi trạng thái.
6. **Ack theo (`id`, `occurrence`) và `upToRevision`:** `ack` nhận danh sách cặp hoặc `{all:true, upToRevision, filter}`; "tất cả" chỉ xác nhận alarm đã có `sequence` ≤ `upToRevision` (alarm bật sau lúc bấm giữ nguyên chưa xác nhận). Kết quả theo từng mục: `ACKED`, `ALREADY_ACKED`, `NOT_ACTIVE`, `STALE` (mã lần xảy ra cũ), `SHELVED`, `NOT_FOUND`. Idempotent: hai phiên cùng xác nhận thì một lần có hiệu lực. `shelve`: `reason` 1 đến 120 ký tự, `durationS` 60 đến 28.800; lỗi `SHELVE_RANGE` (cũng khi quá 50 shelved), `ALARM_NOT_FOUND`, `AUDIT_UNAVAILABLE` (503).
7. **Audit mới, 6 hành động (27 → 33):** `alarm.ack`, `alarm.shelve`, `alarm.unshelve`, `alarm.disable`, `alarm.enable`, `alarm.purged`; đổi cỡ `kAuditActions`, `auditActionName` và quyết định `auditLimited`; không đổi lược đồ `audit.db` (cột `action` không có CHECK). Xác nhận hàng loạt ghi **một** dòng (`target` là chuỗi bộ lọc, `detail` có `count` và ≤ 10 id đầu, ≤ 1 KiB); tự cách ly và tự hết hạn là dòng của `system`, bị gộp khi vượt 10 dòng/phút; `alarm.ack` bị từ chối đi qua gộp 60 s như `access.denied`.
8. **Audit trước rồi áp dụng:** với mọi hành động đổi trạng thái do người, backend kiểm role, ghi audit (FULL) và commit, **rồi mới** áp dụng vào động cơ; audit lỗi thì 503 `AUDIT_UNAVAILABLE` và trạng thái không đổi. Động cơ xử lý lệnh trên một luồng nên kết quả theo từng mục không có đua dữ liệu; kết quả (`STALE`, `ALREADY_ACKED`) được ghi vào audit nếu đã có hiệu lực.

## Hệ quả

- **Tốt:**
  - Client 1.2.0 không đổi hành vi; snapshot có cấu trúc riêng; `sequence` riêng phát hiện đứt mà không ảnh hưởng Tag.
  - Một đường kiểm quyền cho mọi hành động ghi (REST), như ghi Tag.
  - Xác nhận không bao giờ xác nhận oan alarm mới bật.
  - Dồn theo instance giữ trạng thái cuối mà không cần hàng đợi lớn hơn.
- **Xấu:**
  - Hai đường dữ liệu (live đọc, REST ghi): client phải chờ delta để thấy kết quả (≤ 500 ms LAN).
  - Thêm 7 endpoint, 6 hành động audit, nhánh mới trong `LiveHub::onMessage`.
  - Audit trước làm mỗi lần xác nhận tốn một lần fsync (FULL): chấp nhận, xác nhận là thao tác người, hiếm.
- **Rủi ro:**
  - Xác nhận hàng loạt trong bão (200 alarm) tạo một dòng audit lớn: giới hạn `detail` 1 KiB.
  - Bỏ sót khai một endpoint trong bảng quyền: có test duyệt toàn bộ bảng (kịch bản `auth`, `attack`).
  - Dồn delta làm client không thấy trạng thái trung gian (bật rồi hết trong một lần dồn); lịch sử vẫn đủ.

## Số đo / bằng chứng

Số x64 chạy trong container Docker (tham khảo); **BL335 chưa đo** (T129, T130 chờ SSH và người).

- **SC-003 (alarm hiện trên Chrome), x64 (T065, Chrome 155 headless, 50 lần trễ bật 0 và 50 lần trễ bật 3 s, 0 bỏ sót):** từ lúc delta Tag tới client đến lúc DOM banner đổi p95 12 ms (trễ 0) và 114 ms (trễ 3 s), p99 38 ms và 331 ms: đạt p95 ≤ 1.000 ms cộng trễ cấu hình. Tham khảo: tính từ lúc đổi thanh ghi giả lập (gồm chu kỳ quét Modbus 1 s) p95 1,29 và 1,39 s, tức vượt 1.000 ms nếu hiểu "Tag đổi" là nguồn; phần alarm thêm vài chục ms. `docs/reports/009-latency-x64.json`.
- **SC-007 bộ ca tấn công:** `attack` 57 kiểm, 0 trượt. `auth` 22 kiểm xanh (khách đọc 200 ghi 401, viewer 403, operator ack và shelve 200, disable bằng cookie 403 `SESSION_SCOPE`, Bearer operator 403, engineer Bearer 200; audit đủ trường và ghi trước `tsAck`). `docs/reports/009-{attack,auth}-x64.json`.
- **SC-018 (200 alarm một tick, 10 client, 3 chậm), x64 (T112):** 200 alarm thấy ở cả 7 client nhanh sau 1,2 s; 0 phiên 4409; 0 khoảng hở `sequence`; bản tin lớn nhất 34.796 B (≤ 100 phần tử); tổng client chậm 71.601 B, dưới 128 KB (50 % của 256 KB); ack hàng loạt 1 dòng audit (150 mục). `docs/reports/009-storm-x64.json`.
- **Tương thích ngược (`compat`):** 36 kiểm xanh (client 1.2.0 đóng băng nối được runtime 1.3.0 và lên trạng thái live, v.v.). `docs/reports/009-compat-x64.json`.
- **SC-006 (ack tới mọi client ≤ 500 ms, LAN, ≥ 99 %):** chưa có số riêng; BL335 chưa đo.
- Cơ sở: hàng đợi 256 KB và 4409 đã đo ở [ADR-006](006-live-protocol-v1.md); audit FULL đã đo ở [ADR-011](011-auth-roles-audit.md).

## Điều kiện xem xét lại

- Cần xác nhận từ Studio hoặc qua WebSocket: mở lại D31 (cần chọn đường kiểm quyền, kênh `studio`).
- Bão thật làm 4409: tăng dồn, giảm tần delta hoặc nén.
- Cần xác nhận hai bước hay chữ ký điện tử: đổi `ack` thành hai pha.
- Cần lọc alarm theo quyền khu vực: đổi quyền bản tin (D35).
- Giao thức live lên MAJOR vì lý do khác: gộp đổi.
