# Contract: HTTP API của BL335 (API 1.3.0)

**Feature**: [spec.md](../spec.md) FR-028…FR-034, FR-050, FR-051, FR-053, FR-054, FR-088…FR-092, SC-006, SC-007, SC-013 · **Data model**: [data-model.md](../data-model.md) §7 (API), §8 (audit) · **Research**: R14, R15, R17 · **ADR**: [029](../../../docs/adr/029-alarm-live-api.md)

Bổ sung cho [device-api-1.2.md của 007](../../007-screens-widgets/contracts/device-api-1.2.md), [device-api-1.1.md của 006](../../006-tags-modbus/contracts/device-api-1.1.md) và [device-api.md (1.0.0) của 005](../../005-device-online/contracts/device-api.md). Mọi endpoint, header, thứ tự kiểm (§1.3 của 1.2.0) và mã lỗi cũ giữ nguyên. Runtime `0.8.0`, `apiVersion` `1.3.0` (MINOR: thêm endpoint, thêm trường tùy chọn). Giao thức live lên `1.3.0` ([live-protocol-1.3.md](live-protocol-1.3.md)).

## 1. Chung

### 1.1 Bảng quyền: bảy dòng thêm

Bảng duy nhất `core/auth/roles.cpp` (`endpointRules()`): mỗi endpoint khai tường minh (FR-051), không có mặc định ngầm.

| Thao tác | Method và đường dẫn | Role tối thiểu | `needsSession` | `cookieAllowed` | CSRF, `Origin` | `changesDevice` | `refreshesSession` | Audit |
|---|---|---|---|---|---|---|---|---|
| Danh sách alarm đang có | `GET /api/v1/alarms` | viewer, theo `viewerAccess` và `viewerLogin` | không | có | không (`GET`) | không | không | không |
| Lịch sử alarm | `GET /api/v1/alarms/history` | viewer, như trên | không | có | không | không | không | không |
| Xác nhận | `POST /api/v1/alarms/ack` | operator | có | **có** | có | có | có | `alarm.ack` |
| Tạm ẩn | `POST /api/v1/alarms/shelve` | operator | có | **có** | có | có | có | `alarm.shelve` |
| Gỡ tạm ẩn | `POST /api/v1/alarms/unshelve` | operator | có | **có** | có | có | có | `alarm.unshelve` |
| Vô hiệu | `POST /api/v1/alarms/disable` | engineer | có | **không** | không áp (Bearer) | có | có | `alarm.disable` |
| Bật lại | `POST /api/v1/alarms/enable` | engineer | có | **không** | không áp (Bearer) | có | có | `alarm.enable` |

Các dòng của `endpointRules()`, theo thứ tự cột của `EndpointRule` (`method, path, needsSession, minRole, refreshesSession, changesDevice, cookieAllowed`; cột `webEntry` bỏ trống = `false`), để test so khớp từng cột:

```text
{"GET",  "/api/v1/alarms",           false, Role::Viewer,   false, false, true},
{"GET",  "/api/v1/alarms/history",   false, Role::Viewer,   false, false, true},
{"POST", "/api/v1/alarms/ack",       true,  Role::Operator, true,  true,  true},
{"POST", "/api/v1/alarms/shelve",    true,  Role::Operator, true,  true,  true},
{"POST", "/api/v1/alarms/unshelve",  true,  Role::Operator, true,  true,  true},
{"POST", "/api/v1/alarms/disable",   true,  Role::Engineer, true,  true,  false},
{"POST", "/api/v1/alarms/enable",    true,  Role::Engineer, true,  true,  false},
```

Ghi chú thực hiện:

- `GET alarms`, `GET alarms/history`: `needsSession = false` như `GET /api/v1/projects/active`: `AuthGate` xử lý nhánh "viewer" theo `viewerAccess` (ADR-018) và `viewerLogin` (007 §7): khách trong mạng riêng đọc được; `viewerLogin: required` không phiên thì 401 `AUTH_REQUIRED`; nguồn công cộng không phiên thì 403 theo luật lọc nguồn. Có phiên (Bearer hay cookie) thì không bị lọc nguồn.
- `ack`, `shelve`, `unshelve`: `{needsSession=true, Operator, refreshesSession=true, changesDevice=true, cookieAllowed=true}`.
- `disable`, `enable`: `{needsSession=true, Engineer, refreshesSession=true, changesDevice=true, cookieAllowed=false}`.
- `changesDevice = true` buộc **bước 9 của AuthGate**: thao tác đổi trạng thái cần audit hoạt động, ngược lại 503 `AUDIT_UNAVAILABLE` ngay từ cổng (trước cả khi xét thân yêu cầu).
- Cookie gọi `disable`/`enable`: 403 `SESSION_SCOPE` và `access.denied` (gộp 60 s), đúng cách các endpoint kỹ thuật khác (007 §1.2, FR-091). `roles_test.cpp` có thêm: mọi endpoint mới có dòng; không endpoint nào dùng mặc định.
- `Origin` và `X-MAT-CSRF`: bắt buộc cho `ack`, `shelve`, `unshelve` khi phiên là cookie (nhánh cookie của `AuthGate`, 007 §1.3 bước 6); Bearer không cần.

### 1.2 Quy ước chung của thân yêu cầu `POST`

- `Content-Type: application/json` (415 `UNSUPPORTED_MEDIA_TYPE`), UTF-8; thân ≤ **16 KiB** (413 `BODY_TOO_LARGE`), JSON lồng ≤ độ sâu của `jsonNestingDepth` mặc định.
- Khóa lạ trong thân: 400 `BAD_REQUEST` (không bỏ qua im lặng, để lỗi chính tả không thành thao tác sai).
- Mọi phản hồi: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
- Giới hạn tần suất: tối đa 10 yêu cầu `POST /api/v1/alarms/*` mỗi giây mỗi phiên; quá thì 429 `RATE_LIMITED` kèm `retryAfterMs`. Quyết định: chặn trang lỗi lặp (bấm giữ) dùng audit và động cơ; con số đủ cho thao tác người.
- `id` là **id instance** (`PUMP1_FAULT`, `TANK_B1_LEVEL.HH`): regex `^[A-Za-z][A-Za-z0-9_]{1,47}(\.(HH|H|L|LL))?$`; sai dạng là 400 `BAD_REQUEST`, đúng dạng mà không có là `NOT_FOUND`/`ALARM_NOT_FOUND`.

## 2. Đọc

### 2.1 `GET /api/v1/alarms`

Tập alarm hiện có, cùng cấu trúc với `alarmSnapshot` của live nhưng không có `subscriptionId`, `sequence`, `part`, `parts`:

```json
{ "ts": 1791601205000, "revision": 9123,
  "instances": [ { "id": "TANK_B1_LEVEL.HH", "alarmId": "TANK_B1_LEVEL", "…": "như live-protocol-1.3.md §3.2" } ],
  "classes": [ { "id": "critical", "name": "Khẩn cấp", "…": "…" } ],
  "areas": [ { "id": "bon", "name": "Bồn" } ],
  "counts": { "active": 2, "unack": 1, "rtnUnack": 1, "shelved": 1, "disabled": 0, "byPriority": { "…": "…" } } }
```

- Không tham số lọc (≤ 500 instance, ≈ 170 KB trong trường hợp xấu; thường < 30 KB). Lọc ở client.
- Dùng cho: kiểm tra bằng `curl`, tool thử (`alarm-it.ps1`), trang mở lần đầu khi live chưa sẵn sàng (không bắt buộc), Studio khi không có live. Trang vận hành dùng live.
- Project không có alarm: `instances: []`, `classes: []`, `areas: []`, mọi số đếm 0, `revision: 0`; vẫn 200.
- Đọc từ ảnh chụp trạng thái động cơ (không chặn vòng tick, không giữ khóa `TagStore`).
- **200** · 401 `AUTH_REQUIRED`/`SESSION_EXPIRED`/`SESSION_INVALID` · 403 theo luật nguồn · 503 khi chưa có project hợp lệ (như `projects/active`).

### 2.2 `GET /api/v1/alarms/history`

Truy vấn lịch sử các **lần xảy ra** (`alarm_occurrence`) trong `alarm.db`, qua kết nối SQLite chỉ đọc riêng ([alarm-store.md](alarm-store.md)). Không chặn ghi, không chặn tick.

Tham số (query string, UTF-8, mọi tham số tùy chọn):

| Tham số | Kiểu, ràng buộc | Mặc định | Ý nghĩa |
|---|---|---|---|
| `from` | số nguyên, ms UTC | `to` − 24 giờ | lần xảy ra **bắt đầu** (`ts_active_ms`) từ mốc này, tính cả |
| `to` | số nguyên, ms UTC | giờ hiện tại của thiết bị | đến mốc này, không tính |
| `alarmId` | `id` instance hoặc id định nghĩa | không lọc | id định nghĩa khớp mọi ngưỡng của nó |
| `area` | id khu vực, hoặc `-` (rỗng) cho "Chung" | không lọc | |
| `class` | id lớp | không lọc | |
| `priority` | `critical` \| `major` \| `minor` \| `advisory` | không lọc | **mức tối thiểu**: `major` trả `critical` và `major` (US4: "ưu tiên ≥ Quan trọng") |
| `state` | `active` \| `acked` \| `closed` \| `all` | `all` | `active`: chưa hết (`ts_return_ms` rỗng); `acked`: đã có xác nhận (`ack_user` có); `closed`: đã đóng (hết hoặc đóng do `config`, `disabled`, `restart-lost`) |
| `q` | chuỗi UTF-8 ≤ 80 ký tự | không lọc | tìm trong nội dung (`text`) và tên; không phân biệt hoa thường **và dấu tiếng Việt** (SC-013); ký tự `%`, `_`, `\` được thoát phía máy chủ (FR-054) |
| `limit` | số nguyên 1…500 | 100 | số dòng mỗi trang |
| `beforeId` | số nguyên ≥ 1 | không có | chỉ lấy dòng có mã lần xảy ra `< beforeId` (phân trang theo khóa, không `OFFSET`) |

Ràng buộc: `from < to`; `to − from` ≤ 366 ngày (31 622 400 000 ms); tên tham số lạ, giá trị sai kiểu, `limit` ngoài khoảng, `state`/`priority` lạ: 400 `BAD_QUERY` kèm `field` (tên tham số sai) và `message`. Mọi tham số vào SQLite bằng tham số ràng buộc (không ghép chuỗi SQL, FR-054).

**200:**

```json
{ "items": [
    { "id": 4412, "alarmId": "TANK_B1_LEVEL.HH", "name": "Mức bồn B1",
      "class": "critical", "priority": "critical", "area": "bon",
      "text": "Mức bồn B1 rất cao: 91,2 % (ngưỡng 90)",
      "valueActive": 91.2, "qualityActive": "GOOD", "reason": null,
      "tsActive": 1791601203000, "clockOk": true,
      "tsAck": 1791601230000, "ackUser": "vanhanh1",
      "tsReturn": 1791601800000, "tsReturnAck": null, "returnAckUser": null,
      "flags": { "startup": false, "inputBad": false },
      "closedBy": "return", "state": "closed" } ],
  "limit": 100, "hasMore": true, "nextBeforeId": 4300, "ts": 1791605000000 }
```

- `id` là **mã lần xảy ra**; thứ tự trả về: `id` giảm dần (mới nhất trước; mã tăng theo thời điểm bật, FR-024).
- `state` của dòng: `active` (chưa hết), `closed` (đã đóng); `acked` là cờ lọc, không phải giá trị trả về (dòng có `tsAck` là đã xác nhận).
- `closedBy`: `return` \| `config` \| `disabled` \| `restart-lost` \| `null` (chưa đóng).
- `hasMore` và `nextBeforeId`: còn dòng khi lấy hết `limit`; trang kế gọi `beforeId=<nextBeforeId>` cùng các tham số lọc. Không có tổng số dòng (đếm toàn bảng đắt; người dùng không thể buộc quét toàn bảng bằng một lần gọi, US4 kịch bản 6).
- Lần xảy ra `clockOk = false` mang giờ thô của đồng hồ chưa đồng bộ; trang hiện "giờ chưa đồng bộ". Quyết định tạm: so khớp khoảng `from`/`to` theo `ts_active_ms` đã lưu (xem Điểm cần sửa spec).
- Thời gian mục tiêu: 100.000 lần xảy ra, lọc khoảng + khu vực + ưu tiên ≤ 1 s trên x64, ≤ 2 s trên BL335 (SC-013), nhờ ba chỉ mục của FR-044.
- **200** · 400 `BAD_QUERY` · 401/403 như §2.1 · 503 `ALARM_LOG_UNAVAILABLE` khi `alarm.db` không mở được (đang đổi tên do hỏng, hoặc `logState` `error`); khi `logState` = `paused` (đĩa đầy) vẫn trả được lịch sử đã có.

Đồng thời tối đa 2 truy vấn lịch sử chạy cùng lúc trên toàn thiết bị (hàng đợi ngắn, quá hạn 10 s thì 503 `ALARM_HISTORY_BUSY` kèm `retryAfterMs`). Quyết định: chặn người dùng làm nghẽn CPU BL335 bằng nhiều truy vấn lớn.

## 3. Ghi

Mọi `POST` theo chuỗi kiểm §1.3 của 1.2.0 (HTTPS, phương thức, phương tiện xác thực, phiên, phạm vi cookie, `Origin`, `X-MAT-CSRF`, role, audit hoạt động), rồi mới tới kiểm thân. Từ chối ở bước 1 đến 8 ghi `access.denied` (gộp 60 s); riêng bản tin `alarm.ack` bị từ chối vì role đi qua `auditLimited` của chính `alarm.ack` (FR-088).

### 3.0 Thứ tự "audit trước rồi mới áp dụng"

Cho mọi thao tác đổi trạng thái (FR-029, FR-088; Constitution V). Ba pha, động cơ ở `core/alarm/alarm_service` (chi tiết trong [alarm-engine.md](alarm-engine.md)):

1. **Lập kế hoạch và đặt chỗ.** Với từng mục, dịch vụ phân loại theo trạng thái hiện tại của động cơ và **đặt chỗ** các mục sẽ có hiệu lực (`ACKED` hoặc thay đổi shelve/disable) bằng cờ trong bảng đặt chỗ (khóa ngắn, không chờ tick). Mục đã đặt chỗ bởi yêu cầu khác coi như đã có hiệu lực: `ALREADY_ACKED`.
2. **Audit.** Nếu có ít nhất một mục có hiệu lực, ghi **một** dòng audit (`AuditLog::append`, `audit.db` `synchronous=FULL`) và đợi commit. Không có mục nào có hiệu lực: không ghi audit, không có thay đổi, vẫn trả 200 (ack) hoặc phản hồi tương ứng.
3. **Áp dụng.** Chỉ sau khi audit đã commit, đẩy lệnh vào hàng đợi của động cơ; động cơ áp dụng ở đầu tick kế (≤ `deltaPeriodMs`), rồi phát `alarmDelta`. Lỗi ghi audit (`AuditUnavailable`): **thả đặt chỗ**, không áp dụng gì, trả 503 `AUDIT_UNAVAILABLE`.

Hệ quả kiểm được: (a) không có trạng thái `ACTIVE_ACK` mà `audit.db` thiếu dòng tương ứng, kể cả khi cắt điện giữa chừng (SC-008); (b) hai yêu cầu xác nhận cùng lần xảy ra cùng lúc: một yêu cầu `ACKED` và có audit, yêu cầu kia `ALREADY_ACKED` và không có audit (US1 kịch bản 11, SC-006); (c) trạng thái giữa pha 2 và 3 chưa đổi nên client khác chưa thấy; độ trễ từ lúc nhận yêu cầu đến `alarmDelta` ≈ thời gian fsync audit + ≤ 1 tick, p99 ≤ 500 ms trên LAN (SC-006).

Nếu tiến trình chết giữa pha 2 và 3: audit có dòng `alarm.ack` `ok` nhưng trạng thái chưa đổi. Khi khởi động lại alarm ở `ACTIVE_UNACK` (hướng an toàn, D14); người vận hành xác nhận lần nữa (thêm một dòng audit). Không có chiều ngược lại.

### 3.1 `POST /api/v1/alarms/ack`

Chính xác một trong hai dạng:

```json
{ "items": [ { "id": "TANK_B1_LEVEL.HH", "occurrence": 4412 },
             { "id": "PUMP1_FAULT", "occurrence": 4390 } ] }
```

```json
{ "all": true, "upToRevision": 9123,
  "filter": { "areas": ["bon"], "classes": [], "priorities": ["critical", "major"],
              "states": ["ACTIVE_UNACK", "RTN_UNACK"], "q": "B1" } }
```

| Trường | Ràng buộc |
|---|---|
| `items` | mảng 1…**100** phần tử `{id, occurrence}`; `occurrence` số nguyên ≥ 1; không trùng `id` (trùng: 400 `BAD_REQUEST`) |
| `all` | `true`; loại trừ lẫn nhau với `items` |
| `upToRevision` | số nguyên ≥ 0, bắt buộc với `all`: giá trị `revision` mà client đang hiển thị (live-protocol-1.3.md §3.1) |
| `filter` | tùy chọn; mọi khóa tùy chọn, kết hợp bằng AND; mảng rỗng hoặc vắng = không lọc theo khóa đó. `areas` ≤ 64 id (`-` là "Chung"), `classes` ≤ 16 id, `priorities` trong bốn mức (**chính xác** các mức liệt kê, không phải "tối thiểu", khác `history`), `states` ⊂ {`ACTIVE_UNACK`, `RTN_UNACK`} (mặc định cả hai), `q` ≤ 80 ký tự (cùng quy tắc chữ tìm của lịch sử, áp lên `text` và `name` của instance hiện có) |

Quy tắc xác nhận hàng loạt (US1 kịch bản 4; D19):

- Chỉ xét instance **đang hiện cho người dùng** khi bấm: thỏa `filter`, không shelved, state `ACTIVE_UNACK` hoặc `RTN_UNACK`, và `rev ≤ upToRevision` (đã có trong dữ liệu client lúc đó). Instance bật hoặc đổi sau `upToRevision` **không** bị xác nhận (đếm vào `skippedNewer`).
- `occurrence` được suy từ trạng thái hiện tại của động cơ; `rev` đảm bảo không xác nhận lần xảy ra mới hơn lần người dùng đã thấy.
- Một dòng audit cho cả lô (§3.0 pha 2); số mục tối đa bằng số instance (≤ 500).

Kết quả **theo từng mục** (FR-028):

| `result` | Khi |
|---|---|
| `ACKED` | xác nhận có hiệu lực: `ACTIVE_UNACK` → `ACTIVE_ACK`, hoặc `RTN_UNACK` → `NORMAL` (xác nhận hết) |
| `ALREADY_ACKED` | lần xảy ra này đã được xác nhận (`ACTIVE_ACK`), hoặc yêu cầu khác đang xác nhận (đặt chỗ) |
| `NOT_ACTIVE` | instance đang `NORMAL` (đã hết và đã đóng) |
| `STALE` | `occurrence` khác lần xảy ra hiện tại của instance (alarm đã hết rồi bật lại, hoặc mã lạ): **không** xác nhận lần mới |
| `SHELVED` | instance đang tạm ẩn: bị từ chối (US3, edge cases) |
| `NOT_FOUND` | `id` không có trong project đang chạy |

Mọi kết quả trên đều là **200**, không phải lỗi (idempotent): người dùng bấm hai lần hoặc hai người bấm cùng lúc không gặp lỗi.

**200:**

```json
{ "mode": "items",
  "results": [ { "id": "TANK_B1_LEVEL.HH", "occurrence": 4412, "result": "ACKED" },
               { "id": "PUMP1_FAULT", "occurrence": 4390, "result": "ALREADY_ACKED" } ],
  "acked": 1, "skippedNewer": 0,
  "revision": 9130,
  "counts": { "active": 1, "unack": 0, "rtnUnack": 0, "shelved": 1, "disabled": 0, "byPriority": { "…": "…" } } }
```

- Với `all`: `mode` = `all`, `results` liệt kê các mục khớp bộ lọc và `rev ≤ upToRevision` (≤ 500 phần tử), `skippedNewer` đếm các mục khớp bộ lọc nhưng mới hơn `upToRevision`.
- `counts` và `revision` là số **sau khi áp dụng** nếu có mục `ACKED`, ngược lại là số hiện tại. (Pha 3 xong trước khi phản hồi: yêu cầu chờ tới khi động cơ áp dụng, tối đa 1 tick, để trang có số đúng ngay trong phản hồi.)
- Dòng audit (`alarm.ack`, `result` `ok`):
  - một mục: `target` = id instance; `detail` = `{"occurrence": 4412, "from": "ACTIVE_UNACK"}`;
  - nhiều mục hoặc `all`: `target` = chuỗi bộ lọc rút gọn (ví dụ `all area=bon priority=critical,major`, ≤ 120 ký tự); `detail` = `{"count": 7, "ids": ["…", "…"], "upToRevision": 9123}` với `ids` tối đa 10 id đầu, cả `detail` ≤ 1 KiB (giới hạn của `audit.db`).
  - `channel`: `web` khi phiên cookie, `https` khi Bearer; người và role từ phiên.
- Lỗi: 400 `BAD_REQUEST` (sai dạng, vừa `items` vừa `all`, `items` > 100) · 401 · 403 (`FORBIDDEN`, `SESSION_SCOPE`, `CSRF_FAILED`, `ORIGIN_MISMATCH`) · 413 · 415 · 429 · 503 `AUDIT_UNAVAILABLE`.
- 503 `AUDIT_UNAVAILABLE` ví dụ: `{ "error": "AUDIT_UNAVAILABLE", "message": "Thiết bị không ghi được nhật ký kiểm toán nên chưa xác nhận" }`; **không** có `results`; trạng thái alarm không đổi (US6 kịch bản 2, SC-006).

### 3.2 `POST /api/v1/alarms/shelve`

```json
{ "id": "TANK_B1_LEVEL.H", "reason": "Cảm biến đang hiệu chuẩn", "durationS": 3600 }
```

| Trường | Ràng buộc |
|---|---|
| `id` | id instance |
| `reason` | chuỗi UTF-8 sau khi cắt khoảng trắng 1…120 ký tự, không ký tự điều khiển |
| `durationS` | số nguyên 60…28.800 (1 phút đến 8 giờ) |

- Cho mọi trạng thái của instance, kể cả `NORMAL` (tạm ẩn trước khi cảm biến hỏng). Instance **đang shelved**: đặt lại hạn mới và lý do mới (thay thế; ghi audit lại). Instance `disabled`: 409 `ALARM_DISABLED`.
- Tối đa **50** instance shelved cùng lúc (FR-034): đã đủ 50 mà thêm instance chưa shelved: 422 `SHELVE_RANGE` với `field: "limit"`. Tự cách ly do chập chờn (shelve hệ thống) **không** tính vào 50.
- Hết hạn đo bằng đồng hồ đơn điệu của thiết bị; `until` trả về là giờ treo tường tham khảo.

**200:**

```json
{ "id": "TANK_B1_LEVEL.H", "shelved": { "until": 1791604805000, "durationS": 3600, "reason": "Cảm biến đang hiệu chuẩn", "user": "vanhanh1", "system": false },
  "state": "ACTIVE_UNACK", "changed": true, "revision": 9131, "counts": { "…": "…" } }
```

Audit `alarm.shelve` `ok`: `target` = id; `detail` = `{"reason":"…","durationS":3600,"until":1791604805000,"replaced":false}`. Hết hạn tự động: dòng `alarm.unshelve` của `system` (kênh `system`, `detail.cause` = `"expired"`), gộp 60 s khi vượt 10 dòng/phút (FR-031, FR-090).

| HTTP | `error` | Khi |
|---|---|---|
| 404 | `ALARM_NOT_FOUND` | `id` không có trong project |
| 409 | `ALARM_DISABLED` | instance đang bị vô hiệu |
| 422 | `SHELVE_RANGE` | `reason` rỗng hoặc > 120; `durationS` ngoài 60…28.800; đủ 50 shelved. Kèm `field` (`reason`, `durationS`, `limit`) và `message` tiếng Việt |
| 400, 401, 403, 413, 415, 429, 503 `AUDIT_UNAVAILABLE` | | như §3.1 |

### 3.3 `POST /api/v1/alarms/unshelve`

```json
{ "id": "TANK_B1_LEVEL.H" }
```

- Gỡ tạm ẩn ngay. Điều kiện còn đúng thì instance trở thành `ACTIVE_UNACK` **mới** (lần xảy ra mới, có tiếng, có banner, D11); điều kiện đã sai thì về `NORMAL`.
- Gỡ tạm ẩn alarm tự cách ly do chập chờn: hợp lệ; bộ đếm chập chờn bắt đầu lại (edge cases).
- Instance không shelved: 200 với `"changed": false`, **không** ghi audit.
- **200:** `{ "id", "shelved": null, "state", "occurrence", "changed": true, "revision", "counts" }`. Audit `alarm.unshelve` `ok`, `detail` = `{"cause":"manual","remainingS":1800}`.
- Lỗi: 404 `ALARM_NOT_FOUND`, và các lỗi chung.

### 3.4 `POST /api/v1/alarms/disable`

```json
{ "id": "PUMP2_FAULT", "reason": "Cảm biến hỏng, chờ thay" }
```

- Chỉ phiên **Bearer** có role `engineer` trở lên (cookie: 403 `SESSION_SCOPE`). `reason` 1…120 ký tự bắt buộc.
- Instance ngừng được đánh giá; lần xảy ra đang mở đóng với `closedBy: "disabled"`, **không cần xác nhận** (edge cases). Trạng thái bền qua khởi động lại và qua nạp project mới khớp `id` (FR-032, bảng `alarm_override`).
- Đã disabled: 200 `"changed": false`, không audit (cập nhật `reason` không có; muốn đổi lý do thì `enable` rồi `disable`).
- **200:** `{ "id", "disabled": true, "state": "NORMAL", "changed": true, "revision", "counts" }`. Audit `alarm.disable` `ok`, `detail` = `{"reason":"…","closedOccurrence":4390}` (`closedOccurrence` vắng khi không có lần xảy ra mở).
- Lỗi: 404 `ALARM_NOT_FOUND`, và các lỗi chung.

### 3.5 `POST /api/v1/alarms/enable`

```json
{ "id": "PUMP2_FAULT" }
```

- Bật lại; instance được đánh giá lại từ đầu (bộ đếm trễ bắt đầu lại, giá trị Tag hiện tại). Không `reason`.
- Chưa disabled: 200 `"changed": false`, không audit. **200:** `{ "id", "disabled": false, "state", "changed": true, "revision", "counts" }`. Audit `alarm.enable` `ok`.

### 3.6 Idempotency và đua

| Thao tác | Gọi lặp | Hai người cùng lúc |
|---|---|---|
| `ack` | `ALREADY_ACKED`, không audit thêm | một `ACKED` (có audit), một `ALREADY_ACKED` |
| `shelve` | thay hạn và lý do, audit thêm (người dùng cố ý gia hạn) | hai lệnh lần lượt theo thứ tự đặt chỗ, cái sau thắng |
| `unshelve`, `disable`, `enable` | 200 `changed: false`, không audit | như `ack` |

Không có khóa idempotency (`requestId`) trong thân: tính chất tự nhiên của `(id, occurrence)` đủ cho `ack`; các thao tác còn lại lặp lại không gây hại. Trang không tự gửi lại khi mất kết nối ở giữa chừng: hiện trạng thái không rõ và để người dùng đối chiếu (như ghi Tag của 007).

## 4. Phần thêm vào endpoint có sẵn

### 4.1 `GET /api/v1/system/info`

```json
{
  "runtimeVersion": "0.8.0", "protocolVersion": "1.3.0",
  "schemaVersions": ["0.1", "0.2", "0.3", "0.4", "0.5"],
  "device": { "apiVersion": "1.3.0", "…": "…" },
  "alarms": {
    "instances": 200, "active": 3, "unacked": 2, "shelved": 1, "disabled": 0,
    "logState": "running", "droppedChanges": 0, "dbBytes": 1572864,
    "evalMaxMs": 0.6, "evalWindowS": 60
  },
  "web": { "…": "…" }, "warnings": []
}
```

| Trường | Ý nghĩa |
|---|---|
| `instances` | số instance đang chạy (đếm cả ngưỡng); 0 khi project không có alarm |
| `active`, `unacked`, `shelved`, `disabled` | cùng định nghĩa với `counts` ([live-protocol-1.3.md](live-protocol-1.3.md) §3.3) |
| `logState` | `running` \| `paused` (đĩa dưới `minFreeBytes`, FR-043) \| `error` (không mở/ghi được `alarm.db`; engine vẫn chạy) |
| `droppedChanges` | tổng số thay đổi lịch sử bị bỏ do bộ đệm 5.000 đầy, từ lúc khởi động |
| `dbBytes` | kích thước `alarm.db` (cộng `-wal`) |
| `evalMaxMs`, `evalWindowS` | thời gian đánh giá của một tick lớn nhất trong cửa sổ trượt 60 s |

- Khối `alarms` **luôn có** khi trả bản đầy đủ (kể cả 0 instance) để công cụ đọc không phải kiểm sự vắng mặt; client 1.2.0 bỏ qua. `warnings` thêm `ALARM_LOG_PAUSED` khi `logState` là `paused`, `ALARM_LOG_ERROR` khi `error`, `ALARM_DROPPED` khi `droppedChanges` > 0.
- Với `viewerLogin: required` và không phiên: bản tối thiểu `{ runtimeVersion, web }` như cũ; **không** lộ `alarms` (FR-097: không lộ thông tin ở `system/info`).
- `/api/v1/diagnostics` giữ nguyên (FR-092).

### 4.2 `GET /api/v1/device/identity`

`features` thêm `"alarms"` (runtime hỗ trợ alarm, bất kể project hiện có alarm hay không). Client cũ bỏ qua.

### 4.3 `GET /api/v1/projects/active`

Không thêm khối alarm: trang lấy lớp, khu vực và instance từ live (hoặc `GET /api/v1/alarms`). Nếu project 0.5 khai `navigation.alarms: false` ([project-format-0.5.md](project-format-0.5.md)), thân `navigation` mang trường đó (trang ẩn mục menu, D26). Project 0.1 đến 0.4: thân như 1.2.0.

### 4.4 Audit: sáu hành động mới (27 → 33)

`kAuditActions` trong `core/audit/audit_actions.hpp` đổi cỡ `std::array<…,27>` thành 33; `auditActionName` thêm tên; `auditLimited` quyết định gộp. Cột `action` của `audit.db` không có `CHECK`, nên **không cần migration** (FR-089).

| Hành động | Ghi khi | `channel` | `target` | `detail` (≤ 1 KiB) | `auditLimited` (gộp 60 s, ≤ 10 dòng/phút) |
|---|---|---|---|---|---|
| `alarm.ack` | xác nhận có hiệu lực; từ chối (role, live) | `web`, `https`, hoặc kênh live | id instance hoặc chuỗi bộ lọc | §3.1 | **có** cho `denied` (role thấp, `LIVE_ACK_NOT_ALLOWED`); không cho `ok`, `failed` |
| `alarm.shelve` | shelve có hiệu lực; tự cách ly chập chờn | `web`, `https`, `system` | id instance | §3.2; tự cách ly: `{"cause":"chatter","count":5,"windowS":60,"durationS":600}` | có cho dòng của `system` |
| `alarm.unshelve` | gỡ thủ công; tự hết hạn | `web`, `https`, `system` | id instance | §3.3; tự hết hạn `{"cause":"expired"}` | có cho dòng của `system` |
| `alarm.disable` | vô hiệu có hiệu lực | `https` | id instance | §3.4 | không |
| `alarm.enable` | bật lại có hiệu lực | `https` | id instance | §3.5 | không |
| `alarm.purged` | dọn lịch sử theo hạn hoặc trần; đổi tên `alarm.db` hỏng | `system` | `alarm.db` | `{"rows":1000,"reason":"retention"\|"size"\|"corrupt","file":"alarm.db.corrupt-1791601205"}` | không (một dòng mỗi lượt dọn) |

`result`: `ok` (có hiệu lực), `denied` (role, live), `failed` (lỗi nội bộ sau khi audit `started`: không dùng cho alarm, vì audit chỉ ghi khi chắc sẽ áp dụng). Dòng audit ghi **trước** khi áp dụng (§3.0), nên một dòng `ok` mà thiếu hiệu lực chỉ xảy ra khi tiến trình chết đúng giữa pha 2 và 3 (an toàn, §3.0). Ghi chú về kênh: `kAuditChannels` (digest) có `https`, `http`, `cli`, `system`, `web`; không có `studio`, nên Bearer qua HTTPS ghi `https` (khác `studio` của 007 cho `tag.write`).

`GET /api/v1/audit` (Administrator) lọc theo `action` nhận sáu tên mới.

## 5. Mã lỗi (bổ sung)

Cấu trúc lỗi như 1.x: `{ "error": "<MÃ>", "message": "<tiếng Việt>", … }`.

| HTTP | `error` | Endpoint | Khi |
|---|---|---|---|
| 400 | `BAD_QUERY` | `GET alarms/history` | tham số lạ, sai kiểu, ngoài khoảng, `from ≥ to`, khoảng > 366 ngày; kèm `field` |
| 400 | `BAD_REQUEST` | `POST alarms/*` | thân không đọc được, khóa lạ, `id` sai dạng, `items` > 100 hoặc trùng |
| 404 | `ALARM_NOT_FOUND` | shelve, unshelve, disable, enable | `id` không có trong project đang chạy |
| 409 | `ALARM_DISABLED` | shelve | instance đang bị vô hiệu |
| 422 | `SHELVE_RANGE` | shelve | `reason`, `durationS` ngoài khoảng; quá 50 shelved; kèm `field` |
| 429 | `RATE_LIMITED` | `POST alarms/*` | quá 10 yêu cầu/s mỗi phiên; kèm `retryAfterMs` |
| 503 | `AUDIT_UNAVAILABLE` | mọi `POST alarms/*` | audit không ghi được; trạng thái alarm không đổi |
| 503 | `ALARM_LOG_UNAVAILABLE` | `GET alarms/history` | `alarm.db` không mở được cho đọc |
| 503 | `ALARM_HISTORY_BUSY` | `GET alarms/history` | đã có 2 truy vấn lịch sử đang chạy quá 10 s; kèm `retryAfterMs` |

`ack` không có mã lỗi theo mục: kết quả theo mục (`ACKED`, `ALREADY_ACKED`, `NOT_ACTIVE`, `STALE`, `SHELVED`, `NOT_FOUND`) nằm trong thân 200 (§3.1). Mã chung của 005 đến 007 (`AUTH_REQUIRED`, `SESSION_EXPIRED`, `SESSION_INVALID`, `SESSION_SCOPE`, `FORBIDDEN`, `CSRF_FAILED`, `ORIGIN_MISMATCH`, `HTTPS_REQUIRED`, `BODY_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `NOT_FOUND`) giữ nguyên ý nghĩa.

## 6. Giới hạn (tóm tắt)

| Mục | Giới hạn |
|---|---|
| Thân `POST /api/v1/alarms/*` | ≤ 16 KiB |
| `items` của `ack` | 1…100 cặp (xác nhận nhiều hơn dùng `all`) |
| Mục khớp của `ack` `all` | ≤ 500 (bằng số instance tối đa) |
| `reason` | 1…120 ký tự |
| `durationS` | 60…28.800 |
| Shelve cùng lúc | ≤ 50 |
| `q` | ≤ 80 ký tự |
| `limit` của lịch sử | 1…500 (mặc định 100) |
| Khoảng `from`–`to` | ≤ 366 ngày |
| Truy vấn lịch sử đồng thời | 2 |
| `POST` mỗi giây mỗi phiên | 10 |
| `detail` audit | ≤ 1 KiB (≤ 10 id) |
| Instance mỗi project | ≤ 500 (nghiệm thu 200) |

## 7. Tương thích

| Client | Máy chủ | Kết quả |
|---|---|---|
| Studio 0.5/0.6, trang runtime 0.6/0.7 (API 1.2) | 1.3.0 | không đổi; không gọi endpoint alarm; `system/info` có thêm `alarms` bị bỏ qua |
| Trang runtime 0.8 / Studio 0.7 (API 1.3) | runtime 0.6/0.7 (API 1.2) | `GET /api/v1/alarms` trả 404 `NOT_FOUND`; trang đã quyết định "không hỗ trợ" từ `hello` ([live-protocol-1.3.md](live-protocol-1.3.md) §9) nên không gọi; Studio không hiện cột trạng thái sống; nạp xuống project 0.5 có alarm bị khóa (Tương thích runtime, FR-014) |
| Project 0.1 đến 0.4 | runtime 0.8 | chạy như trên 0.6 hoặc 0.7; các endpoint alarm trả danh sách rỗng; `ack` trả `NOT_FOUND` mọi mục |
| Công cụ ghi cũ | 1.3.0 | không đổi (không có thay đổi cho `tags/write`) |

## 8. Test

- `server/http/tests/alarms_api_test.cpp` (CivetWeb trong tiến trình, `AlarmService` thật với `AuditLog` thật và giả lỗi):
  - bảng quyền từng dòng §1.1 (viewer đọc được, `ack` bằng viewer 403, operator 200, `disable` bằng cookie `SESSION_SCOPE`, `disable` bằng operator `FORBIDDEN`, thiếu hoặc sai CSRF, `Origin` lạ, `GET` đổi trạng thái 405);
  - `ack` từng kết quả theo mục (`ACKED`, `ALREADY_ACKED`, `NOT_ACTIVE`, `STALE`, `SHELVED`, `NOT_FOUND`); `ack all` với bộ lọc và `upToRevision` (alarm bật sau lúc bấm không bị xác nhận); xác nhận hai lần và hai phiên cùng lúc: một dòng audit;
  - **audit trước rồi mới áp dụng**: giả lỗi `AuditUnavailable` thì trạng thái không đổi và đặt chỗ được thả; ghi audit rồi mới có `alarmDelta`; một dòng audit mỗi lô, `ids` ≤ 10;
  - `shelve`: biên `durationS` 59/60/28.800/28.801, `reason` rỗng/120/121, thứ 51 `SHELVE_RANGE`, `ALARM_NOT_FOUND`, `ALARM_DISABLED`, gia hạn; `unshelve`, `disable`, `enable` idempotent;
  - `history`: từng tham số, `BAD_QUERY` từng nhánh, phân trang `beforeId` (không trùng, không sót), `q` thoát `%`, `_`, `\`, chữ không dấu khớp có dấu, 100.000 dòng trong ngân sách; nội dung đối kháng (`'); DROP`, Unicode lạ) không đổi kết quả khác chữ tìm;
  - `system/info.alarms` đủ trường; khối vắng ở bản tối thiểu.
- `core/auth/tests/roles_test.cpp`: bảy dòng mới đúng từng cột; không còn đường dẫn `/api/v1/alarms*` nào ngoài bảng.
- `core/audit/tests/`: `kAuditActions` có 33 mục, `auditActionName` đủ sáu tên mới, `auditLimited` đúng; ghi `detail` > 1 KiB bị cắt hợp lệ.
- `core/alarm/tests/alarm_service_test.cpp`: đặt chỗ, thả đặt chỗ, ba pha, chết giữa pha 2 và 3 (khôi phục về `ACTIVE_UNACK`).
- `tools/alarm-it.ps1 -Scenario auth|attack|history` ([quickstart.md](../quickstart.md) §3): bộ ca tấn công 100 % bị từ chối (SC-007), `kill -9` giữa lúc ack (SC-008), truy vấn 100.000 dòng (SC-013).

## Điểm cần sửa spec

- **`upToRevision`**: Đã xử lý trong spec (D42, FR-028: `revision` toàn cục của động cơ, mỗi instance có `rev`); xem [live-protocol-1.3.md](live-protocol-1.3.md); [data-model.md](../data-model.md) §7 phải khớp.
- **Lỗi bổ sung ngoài danh sách của spec** (`ALARM_DISABLED`, `ALARM_LOG_UNAVAILABLE`, `RATE_LIMITED`, `ALARM_TIMEOUT`): Đã xử lý trong spec (FR-050). truy vấn lịch sử quá tải dùng `ALARM_HISTORY_BUSY` (503, FR-053).
- **Kênh audit**: spec FR-088 ghi kênh `web`, `https`; hợp đồng dùng `https` cho Bearer (khác `studio` của 007 `tag.write`); xác nhận với [data-model.md](../data-model.md) §8.
- **Lịch sử và `clockOk = false`**: Đã xử lý trong spec (FR-053, D45: tham số `unsynced=1`; không lọt vào kết quả theo khoảng thời gian).
- **Định nghĩa `state` của lịch sử** (`active`, `acked`, `closed`) được hợp đồng suy ra (§2.2); FR-053 chỉ liệt kê tên. Cần khớp [alarm-store.md](alarm-store.md).
- **Xác nhận khi bấm phía trang:** US1 kịch bản 3 nói hộp xác nhận nhỏ "không cần nhập lý do"; hợp đồng giữ `ack` không có `reason`. Trang quyết định có hộp xác nhận hay không ([ui-alarm.md](ui-alarm.md) §7.3).
