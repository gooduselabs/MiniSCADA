# Contract: HTTP API của thiết bị (API 1.0.0)

**Feature**: [spec.md](../spec.md) · **Data model**: [data-model.md](../data-model.md) · **Research**: R5, R9–R16

Bổ sung cho [http-api.md của Sprint 1](../../002-vertical-slice/contracts/http-api.md); các endpoint cũ giữ nguyên hành vi. Runtime `0.4.0`, `apiVersion` `1.0.0`.

## 1. Chung

### 1.1 Hai listener

| Listener | Cổng | Endpoint |
|---|---|---|
| HTTP | `port` (8080) | như Sprint 1: `/`, `/index.html`, `/assets/*`, `/project/*`, `GET /api/v1/system/info`, `GET /api/v1/projects/active`, WebSocket `/api/v1/live` |
| HTTPS | `httpsPort` (8443; `0` = tắt) | mọi endpoint của HTTP, cộng các endpoint ở mục 3–7 |

- Endpoint ở mục 3–7 gọi qua HTTP: **403** `HTTPS_REQUIRED`, ghi audit `access.denied` (FR-007).
- Hai listener dùng chung giới hạn 10 phiên live (Constitution IV).

### 1.2 Header và định dạng

- **Mọi phản hồi của mục 3–7:** `Content-Type: application/json; charset=utf-8` (trừ tải gói), `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. Không có header CORS.
- **Xác thực:** `Authorization: Bearer mats_<43 ký tự base64url>`. Không dùng cookie ở GĐ 1.
- **Lỗi:** `{ "error": "<MÃ>", "message": "<câu tiếng Việt>", …trường thêm }`. Studio dịch theo `error`, không theo `message`.
- **Thân request JSON:** ≤ 16 KiB (đăng nhập ≤ 4 KiB). Lớn hơn: **413** `BODY_TOO_LARGE`. Không phải JSON object: **400** `BAD_REQUEST`.
- **Phương thức sai:** **405**, kèm header `Allow`.

### 1.3 Kiểm theo thứ tự

1. TLS (`is_ssl`): sai thì 403 `HTTPS_REQUIRED`.
2. Phiên (nếu endpoint cần):
   - không có header: 401 `AUTH_REQUIRED`;
   - token lạ hoặc hết hạn: 401 `SESSION_EXPIRED`;
   - khác IP lúc đăng nhập, tài khoản bị tắt, hoặc `rev` đổi: 401 `SESSION_INVALID`.
3. Role ([research.md](../research.md) R10): thiếu thì 403 `FORBIDDEN`.
4. Audit được (với thao tác thay đổi): không thì 503 `AUDIT_UNAVAILABLE`.

Các lần bị từ chối ở bước 1–3 ghi `access.denied` (gộp 60 s).

**Làm mới hạn phiên** (30 phút không thao tác): chỉ request do người dùng thao tác làm mới, tức mọi `POST`, và `GET` của `/project/versions`, `/project/manifest`, `/project/package`, `/audit`. Request hỏi định kỳ (`/diagnostics`, `/auth/session`, `/project/deployments/{opId}`, `/project/operation`) không làm mới hạn.

## 2. Endpoint công khai: phần thêm

### `GET /api/v1/system/info` (HTTP và HTTPS)

Thêm vào phản hồi hiện có (các khóa cũ giữ nguyên):

```json
{
  "runtimeVersion": "0.4.0",
  "protocolVersion": "1.1.0",
  "project": {
    "status": "active", "projectId": "tank-demo", "projectVersion": "1.3.0",
    "projectName": "Tank demo", "digest": "sha256:9f2c…", "errors": []
  },
  "device": {
    "deviceId": "4f9c2a8e-…", "name": "BL335-01", "model": "BL335",
    "apiVersion": "1.0.0", "httpsPort": 8443, "https": "ok", "discovery": true
  },
  "operation": { "kind": "deploy", "step": "health", "since": 1791601205000 }
}
```

- `project.digest`: digest nội dung của project đang chạy; `null` khi không có project trong kho.
- `device.https`: `ok` \| `off` (`httpsPort = 0`) \| `cert-error` (file chứng chỉ hỏng hoặc sai quyền) \| `tls-error` (chứng chỉ dùng được nhưng không mở được listener HTTPS: cổng bận, khởi tạo TLS lỗi; chi tiết ghi log). Ở cả `cert-error` và `tls-error`, HTTP vẫn chạy và mọi API kỹ thuật đều không có.
- `operation`: thao tác đang chạy hoặc `null`. **Không** có tên tài khoản hay địa chỉ: trang này công khai.
- Không có fingerprint: fingerprint lấy qua HTTP có thể bị sửa; Studio chỉ tin fingerprint thấy khi bắt tay TLS.

### `GET /api/v1/projects/active`

Thêm khóa cấp đầu `digest` (giống `system/info.project.digest`). Trang xem so khóa này với `hello.project.digest` để biết khi nào cần tải lại ([live-protocol-1.1.md](live-protocol-1.1.md)).

## 3. Thiết bị và đăng nhập

### `GET /api/v1/device/identity` (HTTPS, không cần đăng nhập)

```json
{
  "deviceId": "4f9c2a8e-…", "name": "BL335-01", "model": "BL335",
  "runtimeVersion": "0.4.0", "apiVersion": "1.0.0", "protocolVersion": "1.1.0",
  "httpPort": 8080, "httpsPort": 8443,
  "fingerprint": "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b",
  "setupRequired": false,
  "features": ["auth", "deploy", "upload", "restore", "diagnostics", "audit"]
}
```

`setupRequired: true` khi chưa có tài khoản nào: Studio hướng dẫn đặt mật khẩu quản trị bằng lệnh trên thiết bị.

### `POST /api/v1/auth/login`

Request: `{ "user": "kysu1", "password": "…" }`. Thân ≤ 4 KiB; `user` ≤ 64 byte; `password` ≤ 512 byte (128 ký tự).

| Kết quả | Phản hồi |
|---|---|
| Đúng | **200** `{ "token": "mats_…", "user": "kysu1", "role": "engineer", "idleTimeoutS": 1800, "maxLifetimeS": 43200 }` |
| Sai tên hoặc sai mật khẩu (kể cả tài khoản bị tắt, chưa có tài khoản) | **401** `AUTH_FAILED`, cùng câu cho mọi trường hợp |
| Đang khóa (theo tài khoản hoặc theo IP) | **429** `AUTH_LOCKED`, `{ "retryAfterS": 287 }`, header `Retry-After` |
| Hàng đợi băm đầy (> 4) | **429** `AUTH_BUSY`, `Retry-After: 2` |
| Không ghi được audit | **503** `AUDIT_UNAVAILABLE`; không cấp token |

Audit: mỗi lần (`auth.login` `ok`/`failed`, `auth.locked`, `auth.lockout`). Mật khẩu không bao giờ vào log, audit hay phản hồi.

### `POST /api/v1/auth/logout` (có phiên)

**204**. Hủy phiên; audit `auth.logout`.

### `GET /api/v1/auth/session` (có phiên)

**200** `{ "user": "kysu1", "role": "engineer", "idleRemainingS": 1790, "lifetimeRemainingS": 40100 }`. Không làm mới hạn của phiên.

## 4. Project (role engineer)

### `GET /api/v1/project/versions`

```json
{
  "active": 7, "backupsMax": 3,
  "versions": [
    { "seq": 7, "state": "active", "digest": "sha256:…", "projectId": "tank-demo",
      "projectName": "Tank demo", "projectVersion": "1.3.0", "minRuntimeVersion": "0.4.0",
      "size": 41234, "activatedAt": "2026-10-20T03:12:00Z", "clockOk": true,
      "deployedBy": "kysu1", "deployedFrom": "192.168.1.20", "source": "studio" },
    { "seq": 6, "state": "backup", "…": "…", "restorable": true }
  ]
}
```

`restorable`: bản dự phòng còn đủ file (`meta.json`). Kiểm project với runtime hiện tại chỉ chạy khi khôi phục.

### `GET /api/v1/project/manifest?seq=<n>`

Thiếu `seq` thì lấy bản đang chạy. **200**: đúng nội dung `matscada.json` của gói đã lưu. **404** `NO_PROJECT_PACKAGE`: chưa có project trong kho; `message` nói lý do (ví dụ project cài theo cách cũ đang lỗi).

### `GET /api/v1/project/package?seq=<n>`

Đọc lên (FR-027).

- **200**, thân là đúng byte của `v/<seq>/package.matscada`.
- Header: `Content-Type: application/zip`, `Content-Length`, `Content-Disposition: attachment; filename="<projectId>-<projectVersion>.matscada"`, `X-Mat-Digest: sha256:…`, `ETag: "sha256:…"`.
- Audit `project.read` (`target` = digest), ghi trước khi gửi byte đầu; không ghi được thì **503** `AUDIT_UNAVAILABLE` và không gửi gì.
- `seq` không phải số nguyên không âm: **400** `BAD_REQUEST`; `seq` không có hoặc bản thiếu `meta.json`: **404** `NO_SUCH_VERSION` (kho chưa có version nào: **404** `NO_PROJECT_PACKAGE`). Cùng quy tắc cho `/project/manifest`.

### `POST /api/v1/project/deployments`

Nạp xuống (FR-021).

| Header | Bắt buộc | Ý nghĩa |
|---|---|---|
| `Content-Type: application/zip` | có | khác thì 415 `UNSUPPORTED_MEDIA_TYPE` |
| `Content-Length` | có | thiếu: 411 `LENGTH_REQUIRED`; > 52.428.800: 413 `PACKAGE_TOO_LARGE`; không nhận chunked |
| `X-Mat-Digest` | có | digest Studio đã tính; khác digest của gói thì bước `verify-package` lỗi `E_PKG_DIGEST` |
| `X-Mat-Base-Digest` | có | digest đang chạy mà người dùng đã xem trước, hoặc `none`. Khác digest hiện tại: 409 `BASE_CHANGED` |

Kiểm trước khi đọc thân:

| Điều kiện | Phản hồi |
|---|---|
| Đang có thao tác | **409** `DEVICE_BUSY` `{ "opId", "kind", "user", "source", "since" }` |
| Thiếu chỗ (trống < gói + `historianMinFreeMB`) | **507** `NO_SPACE` |
| Không ghi được audit `project.deploy started` | **503** `AUDIT_UNAVAILABLE` |

Thân thiếu header `X-Mat-Digest` hoặc `X-Mat-Base-Digest`, hoặc sai dạng (`sha256:` + 64 hex thường; `none` cho base): **400** `BAD_REQUEST`. Chunked: **411** `LENGTH_REQUIRED`. Mọi lần từ chối trước khi đọc thân đóng kết nối (không đọc nốt thân tới 50 MiB). Còn project cài theo cách cũ chưa vào kho: **409** `NO_BASE_PROJECT` (nạp xuống sẽ làm mất nó).

Nhận đủ thân thì trả **202** `{ "opId": "…", "status": "/api/v1/project/deployments/<opId>" }`; các bước sau chạy nền. Mạng rớt giữa lúc gửi: hủy, dọn vùng tạm, nhả khóa, audit `project.deploy failed` (`code` = `RECEIVE_ABORTED`).

### `GET /api/v1/project/deployments/{opId}`

**200**: `DeployOperation` ([data-model.md](../data-model.md) §10):

```json
{
  "opId": "…", "kind": "deploy", "user": "kysu1", "source": "192.168.1.20",
  "startedAt": "2026-10-20T03:11:52Z", "endedAt": null, "result": "running",
  "from": { "seq": 6, "digest": "sha256:…", "projectVersion": "1.2.0" },
  "to": { "digest": "sha256:…", "projectId": "tank-demo", "projectVersion": "1.3.0" },
  "steps": [
    { "id": "receive", "state": "ok", "startedAt": "…", "endedAt": "…" },
    { "id": "verify-package", "state": "ok" },
    { "id": "validate", "state": "ok" },
    { "id": "backup", "state": "ok" },
    { "id": "activate", "state": "ok" },
    { "id": "health", "state": "running" }
  ],
  "error": null, "clientsNotified": 4
}
```

- Lỗi kiểm project: `error = { "code": "E_VALIDATION", "issues": [{ "code": "E_TAG_RANGE", "file": "tags.json", "path": "/tags/3", "message": "…" }] }`.
- **404** `NO_SUCH_OPERATION`: không còn trong 20 thao tác gần nhất.
- Trong lúc thiết bị chạy lại (khoảng 1–3 s), kết nối bị từ chối: Studio thử lại.

### `GET /api/v1/project/operation`

Thao tác đang chạy, hoặc thao tác gần nhất: cùng định dạng, hoặc `null`. Studio dùng khi mất `opId` (ví dụ Studio vừa mở lại).

### `POST /api/v1/project/restore`

Request: `{ "seq": 6, "baseDigest": "sha256:…" }`. Kiểm như `deployments` (bận, `BASE_CHANGED`, audit). **202** `{ opId, status }`. Bước `receive` và `verify-package` là `skipped`. `seq` không có hoặc là bản đang chạy: **404** `NO_SUCH_VERSION` hoặc **409** `ALREADY_ACTIVE`.

## 5. Bảng mã lỗi của bước

| Bước | Mã |
|---|---|
| `receive` | `RECEIVE_ABORTED`, `NO_SPACE`, `RECEIVE_TIMEOUT` (> 10 phút) |
| `verify-package` | `E_PKG_*` ([matscada-package.md](matscada-package.md) §6); `NO_SPACE` (chỗ trống xuống dưới `historianMinFreeMB` khi giải nén) |
| `validate` | `E_VALIDATION` kèm `issues` theo mã của bộ kiểm tra hiện có (`E_SCHEMA`, `E_RUNTIME_TOO_OLD`, `E_LOG_*`…) |
| `backup` | `STORE_IO` |
| `activate` | `STORE_IO`, `EXEC_FAILED` |
| `health` | `HEALTH_TIMEOUT` (> 15 s), `HEALTH_CRASH` (tiến trình chết 2 lần), `HEALTH_PROJECT` (project không kích hoạt được), `HEALTH_HTTPS` (context HTTPS không mở được) |
| khởi động | `INTERRUPTED` (mất điện hoặc bị giết trước bước `activate`) |

## 6. Chẩn đoán (role viewer)

### `GET /api/v1/diagnostics`

```json
{
  "at": 1791601205000, "timeSynced": true,
  "cpu": { "systemPct1m": 11.7, "runtimePct1m": 4.2, "loadAvg1": 0.42, "cores": 2 },
  "memory": { "runtimeRssBytes": 9900032, "systemTotalBytes": 1041235968, "systemAvailableBytes": 909115392 },
  "disk": { "path": "/var/lib/mat-runtime", "totalBytes": 7301234688, "freeBytes": 6512341504 },
  "uptime": { "systemS": 123456, "runtimeS": 3600 },
  "clients": { "live": 3, "max": 10, "sessions": 1 },
  "discovery": { "enabled": true, "replies": 42, "dropped": { "subnet": 0, "format": 3, "rate": 0, "port": 0 } },
  "versions": { "runtime": "0.4.0", "protocol": "1.1.0", "api": "1.0.0" }
}
```

- `systemPct1m`, `runtimePct1m`: % thời gian bận trong 60 s gần nhất (13 mẫu cách 5 s). Chưa đủ 60 s thì tính trên khoảng đã có; chưa có hai mẫu thì `0`. `runtimePct1m` là phần của **tổng** thời gian CPU của máy (mọi lõi) mà tiến trình runtime dùng, nên không vượt `systemPct1m`. Làm tròn một chữ số thập phân.
- `disk`: `null` khi `statvfs` thất bại; `freeBytes` là phần dành cho user của dịch vụ (`f_bavail`).
- `uptime.systemS`, `runtimeS`: số nguyên giây.
- `timeSynced`: `true` khi `systemd-timesyncd` báo đã đồng bộ (cùng cờ `clockOk` của audit và kho project).
- Route không ghi audit và không làm mới hạn phiên.
- `sessions`: số phiên đăng nhập còn hạn.
- `discovery`: bộ đếm từ lúc runtime chạy ([discovery.md](discovery.md) §2).

## 7. Audit (role administrator)

### `GET /api/v1/audit?from=&to=&user=&action=&before=&limit=`

| Tham số | Ý nghĩa |
|---|---|
| `from`, `to` | ms UTC |
| `user` | đúng tên |
| `action` | tiền tố, ví dụ `project.` |
| `before` | `id`: lấy bản ghi cũ hơn (phân trang) |
| `limit` | 1–200, mặc định 100 |

**200** `{ "records": [AuditRecord…], "next": <id | null> }`, mới nhất trước. `next` là giá trị `before` của trang tiếp, `null` ở trang cuối.

**`AuditRecord`** (JSON, chốt khi cài T144): `id`, `ts` (ms UTC), `clockOk`, `user`, `role`, `source`, `channel`, `action`, `target`, `result`, `code` (chuỗi hoặc `null`), `detail` (đối tượng JSON hoặc `null`), `count`; cùng dạng với `--export-audit --format jsonl`.

**Kiểm tham số (400 `BAD_REQUEST`):**

- `from`, `to`: số nguyên 0–15 chữ số; `before`: số nguyên ≥ 1; `limit`: số nguyên 1–200;
- `user`: 1–64 byte, không có ký tự điều khiển; `action`: 1–64 ký tự trong `a-z 0-9 . -`;
- tham số lạ (viết sai tên), tham số lặp, thiếu `=`, mã `%` sai: 400. Sai thì không đọc gì và không ghi audit.

**`audit.read`:** thiết bị đọc trang trước, rồi ghi `audit.read` (`target` = `/api/v1/audit`, `detail` = các tham số đã dùng); không ghi được thì **503** `AUDIT_UNAVAILABLE` và không trả dữ liệu. Vì vậy trang trả về không chứa bản ghi của chính lần gọi, và `GET /audit` làm mới hạn phiên (người dùng bấm).

**Quyền:** chỉ `administrator`; `engineer`, `viewer` nhận **403** `FORBIDDEN` và thiết bị ghi `access.denied`.

## 8. Ghi audit theo endpoint

| Endpoint | `action` |
|---|---|
| `POST /auth/login` | `auth.login`, `auth.locked`, `auth.lockout` |
| `POST /auth/logout` | `auth.logout` |
| Từ chối ở §1.3 | `access.denied` |
| `GET /project/package` | `project.read` |
| `POST /project/deployments` | `project.deploy` (`started`, rồi kết quả) |
| `POST /project/restore` | `project.restore` (`started`, rồi kết quả) |
| `GET /audit` | `audit.read` |
| `GET /diagnostics`, `/versions`, `/manifest`, `/deployments/*`, `/operation` | không ghi |
