# Rà soát bảo mật feature 009-alarms (T119)

Ngày: 2026-10-15. Phạm vi: `git diff 634d528..HEAD` (core/alarm, server/alarm_glue, server/http/alarms_api + phần alarm của engineering_api/http_api/source_filter, live_hub 1.3.0, core/auth/roles, core/audit, validator `alarm_rules`, packages/alarm-engine, live-client, ui-components alarm, runtime-web alarm, Studio alarm). Mô hình đe dọa: research R25. Phương pháp: đọc mã theo từng dòng của R25 (không chạy tấn công trực tiếp; bộ `tools/alarm-it/attack-cases.mjs` A1..A16 và `server/http/tests/alarms_api_test.cpp` đã có sẵn cho phần lớn các dòng).

## Tóm tắt

| Mức | Số mục | Đã sửa | Hoãn |
|---|---|---|---|
| Critical | 0 | - | - |
| High | 0 | - | - |
| Medium | 1 | 1 (M1, 2026-10-16) | 0 |
| Low | 4 | 0 | 4 |
| Info | 3 | - | - |

Không có mục Critical hoặc High: không có thay đổi mã trong lượt này, nên không có test đỏ cần viết. Mọi mục thấp hơn được hoãn có lý do ở bảng dưới.

## Các mục phát hiện

| # | Mức | Vị trí | Mô tả | Trạng thái |
|---|---|---|---|---|
| M1 | Medium | `server/alarm_glue.cpp:331,335-339` (`itemJson`), `GET /api/v1/alarms`, live `alarmSnapshot/alarmDelta` | `ackUser`, `shelved.user`, `shelved.reason` (tên tài khoản và lý do tự do do operator gõ) có trong danh sách alarm trả cho mọi nguồn qua bộ lọc nguồn. Với `viewerAccess = any` (cảnh báo `VIEWER_PUBLIC`) và BL335 có port-forward, người chưa đăng nhập đọc được tên tài khoản (hỗ trợ dò mật khẩu) và lý do vận hành. Giá trị khác (Tag) đã công khai cho viewer theo thiết kế 003/007, nhưng tên tài khoản là thông tin mới. | Đã sửa (2026-10-16): nguồn không có phiên (Bearer/cookie hợp lệ) không nhận `ackUser`, `shelved.user`, `shelved.reason` ở `GET /api/v1/alarms`, `alarmSnapshot`, `alarmDelta`; `alarms/history` trả `ackUser`/`returnAckUser` = null. Có phiên thì đủ. Test `AlarmsApi.AGuestDoesNotSeeAccountNamesOrFreeTextReasons`, `Fixture.AConnectionWithoutASessionDoesNotGetAccountNames`; contract device-api-1.3 §2 và live-protocol-1.3 §3.2 đã ghi. Lưu ý: kịch bản `tools/alarm-it` đọc `ackUser`/`shelved.user` bằng yêu cầu khách sẽ cần đọc bằng Bearer (chạy trên thiết bị, chưa kiểm vì SSH tắt). |
| L1 | Low | `core/alarm/alarm_history.hpp:59-61` (`waitMs = 10000`, `maxConcurrent = 2`), `server/http/alarms_api.cpp:376` | Một truy vấn lịch sử chờ khe tối đa 10 s trên một luồng CivetWeb; mỗi IP chỉ 1 truy vấn (SourceLimiter) nhưng nhiều IP có thể giữ nhiều luồng chờ, làm đói các route khác. Giảm nhẹ đã có: 2 khe, hạn 5 s mỗi truy vấn, `limit` ≤ 500, khoảng ≤ 366 ngày, `q` ≤ 80, LIKE đã thoát, mọi tham số ràng buộc (không có SQL ghép chuỗi người dùng). | Hoãn: cần số đo trên BL335 (SSH đang tắt) để chọn `waitMs`; khuyến nghị giảm còn 1500-2000 ms rồi trả 503 `ALARM_HISTORY_BUSY` (đã có đường trả này). |
| L2 | Low | `core/audit/audit_actions.hpp:196-209`, `server/main.cpp:600` | Từ chối `alarm.ack` (kể cả bản tin `ack` trên live, ai kết nối live cũng gửi được với `id` tùy ý) dùng chung hạn mức 10 dòng/phút của các sự kiện bị gộp (`access.denied`, đăng nhập sai). Kẻ tấn công có thể dùng hết hạn mức để các dòng khác chỉ còn là đếm trong `audit.suppressed` (số đếm theo hành động vẫn được ghi, nên không mất dấu vết, nhưng mất chi tiết nguồn). | Hoãn: thiết kế R15 đã chấp nhận; sửa cần hạn mức theo từng hành động (đổi lõi audit đã khóa bởi 003/005). Khuyến nghị: tách bộ đếm `limitedRows` theo `action`. |
| L3 | Low | `apps/runtime-web/src/alarm/alarm-page.ts:247` | `v.state in STATE_MAP` nhận khóa nguyên mẫu (`"toString"`) từ `sessionStorage`; sau đó `STATE_MAP[s.state]` không phải mảng và `[...]` ném lỗi khi dựng truy vấn. Chỉ tác động lên chính phiên của người dùng (cùng origin, không XSS), không thoát ra ngoài. | Hoãn: tự gây hại, không có đường tấn công từ xa. Sửa: `Object.hasOwn(STATE_MAP, v.state)`. |
| L4 | Low | `server/alarm_glue.cpp:524-566` | Bản ghi audit `alarm.ack` ghi số lượng mục sẽ có hiệu lực tại thời điểm xem trước; lệnh thực thi ở vòng kế tiếp của động cơ có thể cho kết quả khác (ví dụ lần xảy ra đã đổi) nên số `acked` trả về có thể nhỏ hơn số đã audit. Audit luôn không thiếu (ghi TRƯỚC khi đổi), chỉ có thể thừa. Hướng an toàn. | Chấp nhận: đúng hướng "mất an toàn về phía ghi nhiều", ghi lại ở đây. |

Info:

- I1. `GET /api/v1/alarms/history` với HEAD chạy cả truy vấn (không có lối tắt); vô hại do giới hạn ở L1.
- I2. `alarm.shelve` có thể thay thế một lần tạm ẩn của `system` (chatter) bởi operator (`unshelve` cũng vậy): đúng spec D11, ghi ở đây để nhất quán với audit.
- I3. Giới hạn còn lại theo R25: web SCADA không phải lớp an toàn; interlock ở PLC; XSS đã thực thi có quyền operator đang đăng nhập (như 007).

## Đối chiếu từng dòng R25

| Mối đe dọa | Kết quả | Chứng cứ |
|---|---|---|
| Xác nhận trái phép (viewer, CSRF, XSS) | Đạt | `core/auth/roles.cpp:91-100` (ack/shelve/unshelve: Operator, cookie được phép); `server/http/auth_gate.cpp:176-182` (cookie phải kèm `Origin` khớp host và `X-MAT-CSRF` so sánh thời gian hằng, nếu không 403 `ORIGIN_MISMATCH`/`CSRF_FAILED`); `engineering_api.cpp` kiểm `Content-Type: application/json` nên form chéo trang không gửi được; thân ≤ `kJsonBodyMaxBytes`, độ sâu ≤ 8, khóa lạ bị từ chối (`alarms_api.cpp:205-281`) |
| Vô hiệu alarm trái phép | Đạt | `roles.cpp:98-99`: `disable`/`enable` có `cookieAllowed = false` và `minRole = Engineer`, nên cookie nhận 403 `SESSION_SCOPE` (gate dòng 176); `reason` 1..120 ký tự, cấm ký tự điều khiển (`alarms_api.cpp:301-314`); audit trước khi áp |
| Audit trước khi đổi; 503 khi audit lỗi | Đạt | Gate bước 9 trả 503 `AUDIT_UNAVAILABLE` khi audit không ghi được (rule `changesDevice = true` cho cả 5 POST); `AlarmGlue` ghi audit rồi mới `runCommands` ở ack (`:563`), shelve (`:627`), unshelve (`:664`), disable (`:696`), enable (`:722`); audit ném ngoại lệ thì `auditDown()` 503, giải phóng chỗ giữ (`release()`) |
| Shelve hàng loạt | Đạt | 60..28.800 s, lý do bắt buộc, ≤ `maxShelved` (50, cấu hình 1..200 có chặn) (`alarm_glue.cpp:613-625`), động cơ kiểm lại (`SHELVE_RANGE`) |
| XSS qua nội dung/tên | Đạt | Không có `innerHTML`/`insertAdjacentHTML`/`unsafeHTML` trong `apps/runtime-web/src/alarm`, `packages/ui-components/src/alarm`, `packages/alarm-engine`, Studio alarm (grep); màu lớp đi qua danh sách trắng 8 màu (`banner.ts:172`, `alarm-table.ts:56`); Studio dùng khuôn lit và `COLOR_VAR` cố định |
| Công thức CSV | Đạt | `csv.ts:45-60`: bỏ khoảng trắng/BOM/ký tự điều khiển rồi thêm `'` trước `= + - @ tab CR`, trích dẫn nháy kép; ô số là kiểu `number` |
| SQL injection | Đạt | `alarm_history.cpp`: mọi giá trị bind (`:from :to :alarm_id :area :class :priority :q :before_id :limit`), `LIKE ... ESCAPE '\'` với `escapeLike`, chỉ nối các mảnh SQL cố định; `alarm_store.cpp`: chỉ `PRAGMA` nội bộ và một số nguyên tự sinh; kết nối chỉ đọc (`SQLITE_OPEN_READONLY`, `query_only`), không `CREATE` |
| Từ chối dịch vụ truy vấn | Đạt có điều kiện | `limit` ≤ 500, khoảng ≤ 366 ngày, `q` ≤ 80, `beforeId` keyset, hạn 5 s qua `sqlite3_progress_handler`, 2 khe toàn máy, 1 truy vấn mỗi IP, chuỗi truy vấn ≤ `kMaxQueryStringBytes`, tham số lạ/lặp bị từ chối; điều kiện còn lại: L1 |
| Tràn hàng đợi live | Đạt | `onMessage`: ≤ 96 KiB, độ sâu kiểm trước khi parse, `requestId` ≤ 64, `subscribeAlarms` giới hạn tần suất; gửi tuần tự có ngưỡng đầy hàng đợi (`kAlarmHoldHighPct`), snapshot chia mảnh 100, delta ≤ 100 mỗi bản tin, `alarmPending` giới hạn bởi số instance (≤ 500 alarm) |
| Bão audit | Đạt | Cả từ chối REST (gate) và từ chối live đi qua cửa gộp 60 s, ≤ 10 dòng/phút (`auditLimited`); xem L2 |
| Lộ thông tin ở `system/info` | Đạt | Khối `alarms` chỉ có số đếm, trạng thái log, byte, thời gian đánh giá (`alarm_glue.cpp:794-810`), không tên/nội dung; nằm sau bộ lọc nguồn; bản "MinimalInfo" bỏ hết (`http_api.cpp:326-330`) |
| Project độc hại | Đạt | Validator và `compileAlarms` kiểm khóa lạ, độ dài tên (≤ 80), giới hạn; văn bản alarm là chuỗi tĩnh của project, không nội suy giá trị Tag nên dữ liệu thiết bị không vào `text`; giới hạn 500 và tự cách ly chatter |
| Đồng hồ giả | Đạt (đọc mã) | `clockOk` đi vào bản ghi, thứ tự theo `occurrence`/`id`; `unsynced` tách `clock_ok = 0` |
| `alarm.db` quyền | Đạt | `SQLITE_DEFAULT_FILE_PERMISSIONS=0600` ở `CMakeLists.txt:54` (không có cửa sổ 0644) và `AlarmStore::makePrivate()` chmod `.db`, `-wal`, `-shm`; test `alarm_store_test.cpp:99`; không lưu bí mật |
| `synchronous` PRAGMA | Đạt | `PRAGMA synchronous=NORMAL` (không FULL), WAL, `journal_size_limit` (`alarm_store.cpp:195-204`); test `alarm_store_test.cpp:87` |
| Nhường quyền | Đạt | Runtime mở `alarm.db` sau cùng chủ thể với `audit.db`; CLI `alarm-db-check` chạy qua `systemDeviceCliEnv` (umask 077, bỏ quyền) và mở chỉ đọc |
| Cấu hình | Đạt | Mọi khóa `alarm*` trong `runtime.json` bị chặn về khoảng cho phép kèm cảnh báo (`server/config.cpp`) |

## Điều đã làm tốt

- Mọi thao tác thay đổi đi qua cùng một cổng (`AuthGate`) với `tags/write`: role đọc lại ở mỗi yêu cầu, CSRF, `Origin`, phạm vi cookie, audit-trước.
- Kiểm đầu vào nghiêm: khóa lạ bị từ chối ở mọi thân JSON, `id` theo dạng chặt, `occurrence` kiểu số nguyên chống tràn khi ép kiểu, `filter` có danh sách trắng.
- Giữ chỗ `reserved_` loại bỏ xác nhận trùng song song; `release()` được gọi ở mọi nhánh lỗi.
- Phía trình duyệt: không dùng `innerHTML`, tất cả `textContent`, danh sách trắng cho màu, lỗi từ máy chủ chỉ hiện qua bảng mã.
- Audit làm sạch UTF-8 và cắt theo ký tự (`utf8Cut`), `jsonText` thay byte lỗi thành U+FFFD, nên nội dung tự do không làm hỏng việc xuất audit.

## Khuyến nghị tăng cường

1. M1: quyết định về `ackUser`/`shelved` cho nguồn chưa đăng nhập trước khi mở port-forward với `viewerAccess = any`.
2. L1: đo trên BL335 khi có SSH, rồi hạ `waitMs`.
3. Chạy lại `tools/alarm-it.ps1 -Scenario attack` trên bản gói cuối (T127/T131) để xác nhận các dòng "Đạt" ở trên bằng thực nghiệm, không chỉ đọc mã.
4. Thêm hạn mức audit theo từng hành động (L2) ở lượt lõi audit kế tiếp.

## Rà soát mã

Rà soát đa trục (đúng đắn, đọc được, kiến trúc, bảo mật, hiệu năng), phạm vi `git diff 634d528..HEAD`, trọng tâm: `alarm_service`/`alarm_store` (độ bền, tick không bị chặn, hàng đợi), `alarm_glue` (audit trước, ack hàng loạt, `upToRevision`), `live_hub` 1.3.0 (sequence, dồn, tài nguyên), `alarms_api`. Động cơ C++ và TS được đối chiếu qua bộ vector chung (đã có test); không đọc lại từng ô của bảng ISA. Trang runtime-web và Studio chỉ rà ở mức grep an toàn (xem bảng ở trên), chưa đọc từng dòng.

| # | Mức | Vị trí | Mô tả | Trạng thái |
|---|---|---|---|---|
| R1 | High | `core/alarm/alarm_service.cpp` `writerLoop` | Khi đĩa đầy (`paused`), hàng lịch sử vẫn nằm trong hàng đợi nên `have` luôn đúng, hạn tới = quá khứ, vòng lặp không bao giờ ngủ: luồng ghi quay 100% CPU (đo: 5,4 triệu lần `statvfs` trong 0,5 s) và tranh khóa `mu_` với `push()` của tick, trên BL335 hai lõi chậm. | Đã sửa: khi `paused` chỉ override/meta/audit mới tính là việc cần làm; kiểm đĩa mỗi 1 s (`diskCheckAt`). Test mới `AlarmService.PausedWriterSleepsInsteadOfSpinning` (đỏ trước, 19/19 xanh sau). |
| R2 | Medium | `alarm_service.cpp` `writerLoop`, nhánh `stop_` | `doCommit = !paused`: dừng dịch vụ khi đang tạm dừng vì đĩa đầy bỏ luôn override (shelve/disable) và meta đang chờ, dù chúng được phép ghi lúc paused. | Mở. Đề xuất: khi `stop_` và `paused`, vẫn ghi `overrides`, `meta`, `audits` (bỏ `rows`). |
| R3 | Medium | `server/alarm_glue.cpp` `shelve`/`disable`/`ack` | Audit được ghi trước (đúng thiết kế) nhưng nếu động cơ trả kết quả không áp dụng (`SHELVE_RANGE`, `NOT_FOUND`, `STALE` ở ack) thì audit đã có dòng "đã làm". Chỉ chênh khi đua với tick. | Đã sửa (2026-10-16): khi động cơ từ chối sau audit (`SHELVE_RANGE`, `NOT_FOUND`, `STALE`...), ghi thêm một dòng audit cùng hành động, result `failed`, `detail.outcome`; dòng đầu giữ nguyên và vẫn đi trước, 503 khi audit lỗi giữ. Chỉ chạy khi đua với tick nên không có test đỏ xác định được (xanh ở các test hiện có, không hồi quy). |
| R4 | Low | `alarm_service.cpp` `push`/`start` | `started_` ghi không giữ `mu_` trong `start()`, đọc dưới `mu_` trong `push()`. Thực tế `start()` chạy trước tick nên không đua. | Đã sửa (2026-10-16): `started_` đọc/ghi dưới `mu_` trong `start()`/`stop()`; bỏ lần đọc trần trong `loadContext`. |
| R5 | Low | `live_hub.cpp` `flushAlarmLocked` | Delta cắt 100 mục mang `revision`/`counts` mới nhất dù các mục còn lại chưa gửi; client phải coi `revision` là "ít nhất". Khớp contract nhưng nên ghi rõ ở live-protocol-1.3. | Đã sửa (2026-10-16): ghi chú trong live-protocol-1.3 §3.3. |
| R6 | Low | `alarm_glue.cpp` `ack` mode `all` | `fromState`/kế hoạch đọc từ view trước khi đặt chỗ; kết quả `STALE` sau audit vẫn nằm trong dòng audit "count" của lô. | Đã sửa cùng R3 (dòng audit kết quả cho các mục `ack` bị từ chối). |

Đã kiểm, không có lỗi: audit trước khi đổi trạng thái và 503 khi audit lỗi; `release()` ở mọi nhánh; `upToRevision` loại mục mới hơn trang đang xem; `alarmPending` bị chặn bởi số instance; snapshot chia mảnh có kiểm đầy hàng đợi; callback audit của luồng ghi bắt ngoại lệ (không `terminate`); phân tích tham số truy vấn (giải mã, lặp, khóa lạ, độ dài); bind tham số SQL; test `TheTickNeverWaitsForSqlite` và khôi phục sau lỗi tạm thời.

Verdict: không còn Critical/High mở; R2 và R3 nên xử lý trước bản gói cuối.
