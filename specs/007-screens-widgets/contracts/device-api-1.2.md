# Contract: HTTP API của BL335 (API 1.2.0)

**Feature**: [spec.md](../spec.md) FR-020, FR-034, FR-038…FR-050, FR-053, FR-054 · **Data model**: [data-model.md](../data-model.md) §9–§12 · **Research**: R5, R13–R17 · **ADR**: [021](../../../docs/adr/021-web-login-certificates.md)

Bổ sung cho [device-api-1.1.md của 006](../../006-tags-modbus/contracts/device-api-1.1.md) và [device-api.md (1.0.0) của 005](../../005-device-online/contracts/device-api.md). Mọi endpoint, header, thứ tự kiểm và mã lỗi của 1.0.0 và 1.1.0 giữ nguyên. Runtime `0.6.0`, `apiVersion` `1.2.0` (MINOR: thêm endpoint, thêm trường tùy chọn). Giao thức live giữ `1.2.0`.

## 1. Chung

### 1.1 Hai cách xác thực

| | Studio và công cụ | Trang runtime trên Chrome |
|---|---|---|
| Mang phiên | `Authorization: Bearer mats_…` | cookie `__Host-mat_sid=matw_…` |
| Phạm vi | mọi endpoint của bảng quyền | chỉ endpoint ở cột **Cookie** của §1.2 |
| Chống CSRF | không cần (không tự gửi) | `Origin` + `X-MAT-CSRF` trên mọi yêu cầu đổi trạng thái |
| Tạo phiên | `POST /api/v1/auth/login` (005) | `POST /api/v1/web/login` |

Token `mats_` đặt trong cookie bị bỏ qua; token `matw_` đặt trong `Authorization` bị từ chối (403 `SESSION_SCOPE`). Yêu cầu mang cả hai: dùng Bearer, bỏ qua cookie.

### 1.2 Bảng quyền: dòng thêm và cột Cookie

Bảng duy nhất `core/auth/roles.*` thêm cột `cookieAllowed`:

| Thao tác | Endpoint | Cần | Cookie |
|---|---|---|---|
| Đăng nhập web | `POST /api/v1/web/login` | không | (tạo cookie) |
| Đăng xuất web | `POST /api/v1/web/logout` | không (phiên nếu có) | có |
| Hỏi phiên | `GET /api/v1/web/session` | phiên web | có |
| Làm mới hạn rảnh | `POST /api/v1/web/touch` | phiên web | có |
| Ghi Tag | `POST /api/v1/tags/write` | operator | **có** |
| Kết quả ghi | `GET /api/v1/tags/write/{id}`, `?ids=` | operator | **có** |
| Project đang chạy | `GET /api/v1/projects/active` | theo `viewerLogin` | có |
| Thông tin hệ thống | `GET /api/v1/system/info` | theo `viewerLogin` (bản tối thiểu luôn công khai) | có |
| Nhận diện thiết bị | `GET /api/v1/device/identity` | không | có |
| Trang, tài nguyên, `/project/*`, live | `/`, `/assets/*`, `/project/*`, `/api/v1/live` | theo `viewerAccess`, `viewerLogin` | có |
| Chứng chỉ công khai | `GET /device.crt` | không | — |
| Trang đăng nhập | `GET /login`, `/assets/login-*` (bundle riêng, không chia sẻ chunk với trang chính) | không | — |
| Mọi endpoint khác (nạp xuống, đọc lên, audit, Thử kết nối, cổng serial, chẩn đoán driver, tài khoản, đăng nhập Bearer…) | | như cũ | **không** |

Endpoint `cookieAllowed = false` nhận cookie: 403 `SESSION_SCOPE`, audit `access.denied` (gộp 60 s).

### 1.3 Thứ tự kiểm (nhánh cookie của `AuthGate`)

0. đường dẫn thuộc bảng (404 `NOT_FOUND`);
1. HTTPS (403 `HTTPS_REQUIRED`; cookie qua HTTP bị bỏ qua và ghi đếm, không phiên);
2. phương thức hợp lệ (405 + `Allow`);
3. chọn phương tiện: có `Authorization` thì Bearer, ngược lại có cookie thì web;
4. phiên hợp lệ: 401 `AUTH_REQUIRED` (không cookie), `SESSION_EXPIRED`, `SESSION_INVALID` (đổi IP, đã bị hủy);
5. phạm vi cookie (403 `SESSION_SCOPE`);
6. yêu cầu đổi trạng thái (`POST`, `PUT`, `DELETE`): `Origin` = `https://<Host>` (403 `ORIGIN_MISMATCH`), `X-MAT-CSRF` khớp (403 `CSRF_FAILED`);
7. yêu cầu `GET` của `web/session`, `tags/write/{id}`: `Sec-Fetch-Site` vắng hoặc `same-origin` (403 `FETCH_SITE`);
8. role (403 `FORBIDDEN`);
9. thao tác đổi trạng thái cần audit hoạt động (503 `AUDIT_UNAVAILABLE`).

Từ chối ở bước 1–8 ghi `access.denied` (gộp 60 s) với mã; riêng `tags/write` ghi `tag.write` `denied` như 006.

## 2. Endpoint web

### 2.1 `POST /api/v1/web/login`

Request (≤ 4 KiB, `Content-Type: application/json` bắt buộc, `Origin` bắt buộc đúng):

```json
{ "username": "vanhanh1", "password": "…" }
```

Mật khẩu chuẩn hóa NFC ở trang (như Studio). **200:**

```json
{ "user": "vanhanh1", "role": "operator", "csrfToken": "Zk3…(43 ký tự base64url)",
  "expiresAt": "2026-10-20T15:12:00Z", "idleExpiresAt": "2026-10-20T03:42:00Z",
  "idleTimeoutS": 1800, "maxSessionS": 43200 }
```

Header: `Set-Cookie: __Host-mat_sid=matw_…; Secure; HttpOnly; SameSite=Strict; Path=/`, `Cache-Control: no-store`.

| HTTP | `error` | Khi |
|---|---|---|
| 400 | `BAD_REQUEST` | thân không đọc được, thiếu trường |
| 401 | `AUTH_FAILED` | sai tên hoặc mật khẩu (một câu chung); tài khoản tắt |
| 403 | `HTTPS_REQUIRED`, `ORIGIN_MISMATCH` | |
| 413 | `BODY_TOO_LARGE` | |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | không phải JSON |
| 429 | `AUTH_LOCKED` | kèm `retryAfterS`; 5 lần sai liên tiếp khóa 5 phút theo tên và theo IP (005) |
| 503 | `AUDIT_UNAVAILABLE` | không ghi được audit đăng nhập |

Audit: `auth.login` `ok`/`denied`/`locked`, `channel` = `web` (gộp như 005). Đăng nhập thành công khi đã đủ 8 phiên web: phiên web rảnh lâu nhất bị loại (audit `auth.session_evicted`).

### 2.2 `GET /api/v1/web/session`

**200:** như thân của `login` (không `Set-Cookie`). **401** `AUTH_REQUIRED` | `SESSION_EXPIRED` | `SESSION_INVALID`. Không làm mới hạn. Dùng khi tải lại trang để lấy lại `csrfToken` và hạn.

### 2.3 `POST /api/v1/web/logout`

Cần `Origin`; có phiên hợp lệ thì cần `X-MAT-CSRF`. **204**, `Set-Cookie: __Host-mat_sid=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`. Phiên bị hủy ở BL335 (dùng lại cookie cũ: 401). Cookie không hợp lệ cũng nhận 204 (xóa cookie). Audit `auth.logout`.

### 2.4 `POST /api/v1/web/touch`

Thân rỗng. Làm mới hạn rảnh. **204**. Trang gọi tối đa một lần mỗi phút khi có chuột hoặc phím (hoạt động của người). `GET` và kết nối live không làm mới hạn.

## 3. Trang đăng nhập và chứng chỉ

### 3.1 `GET /login`

HTTPS: trang tĩnh (`login.html` trong docroot) cho mọi nguồn, không bị lọc nguồn, CSP của trang runtime; tải `/assets/login-*.js`. Trang hiện biểu mẫu, fingerprint của thiết bị (từ `device/identity`) và liên kết `/device.crt`. HTTP: `302` về `https://<host>:<httpsPort>/login` nếu `httpsPort` bật, ngược lại 404 (không tự chuyển hướng trang xem; chỉ `/login`).

### 3.2 `GET /device.crt`

HTTPS, không đăng nhập, không bị lọc nguồn. `200`, `Content-Type: application/x-x509-ca-cert`, `Content-Disposition: attachment; filename="mat-device.crt"`, PEM `CERTIFICATE` duy nhất (chứng chỉ máy chủ; thêm chuỗi nếu đã nhập chứng chỉ CA). Không bao giờ chứa khóa riêng. `HTTPS` lỗi chứng chỉ (`cert-error`): 503.

## 4. `GET /api/v1/projects/active` cho project 0.3

```json
{
  "project": { "…": "project.json" },
  "tags": { "schemaVersion": "0.3.0", "tags": [ "…" ] },
  "valueTables": { "TrangThaiBom": { "…": "…" } },
  "connections": [ { "id": "plc1", "name": "PLC trạm bơm", "kind": "modbus-tcp" } ],
  "navigation": { "position": "left", "items": [ "…" ] },
  "screens": [
    { "id": "tong-quan", "name": "Tổng quan", "kind": "screen", "file": "screens/tong-quan.screen.json" },
    { "id": "bom1", "name": "Bơm 1", "kind": "popup", "file": "screens/bom1.screen.json" }
  ]
}
```

- `valueTables`: mọi bảng mà Tag (`valueTable`), widget (`props.table`) hoặc binding tham chiếu.
- `connections`: như 006 (id, tên, loại; không địa chỉ).
- `screens[].file` được tải bằng `GET /project/<file>` (cùng cổng kiểm của `/project/*`).
- Không có `items`; thân nhỏ (≈ vài KB). Tag có thêm `limits`, `access`, `kind`, `valueTable`, `unit`, `min`, `max`, `description` (đã có ở 006 cho trang).
- Project 0.1 và 0.2: thân như runtime 0.5 (kèm `screens` đầy đủ).
- Bản `503` khi chưa có project hợp lệ: như 005.

## 5. Phần thêm vào endpoint có sẵn

### `GET /api/v1/system/info`

```json
{
  "runtimeVersion": "0.6.0", "protocolVersion": "1.2.0",
  "schemaVersions": ["0.1", "0.2", "0.3"],
  "device": { "apiVersion": "1.2.0", "viewerAccess": "private", "…": "…" },
  "web": { "https": true, "httpsPort": 8443, "login": true, "viewerLogin": "off" },
  "warnings": []
}
```

- `web` là phần công khai nhỏ (cả khi `viewerLogin: required`), để trang HTTP dựng liên kết HTTPS.
- `warnings` thêm: `TLS_NO_IP_SAN` (chứng chỉ không có SAN IP), `TLS_SAN_MISMATCH` (IP card hiện tại không có trong SAN), `HTTPS_DOWN` (cổng HTTPS không chạy: điều khiển trên web bị khóa).
- Với `viewerLogin: required` và không có phiên: chỉ trả `{ runtimeVersion, web }`.

### `GET /api/v1/device/identity`

`features` thêm `"web-login"`, `"screens-v1"`, `"write-pulse"`, `"write-expect"`. Không đổi nếu thiếu: client cũ bỏ qua.

## 6. Ghi Tag: trường tùy chọn mới (`POST /api/v1/tags/write`)

Mỗi phần tử của `requests` thêm các trường tùy chọn:

```json
{ "requestId": "6f1c2a8e-4b7d-4c1e-9a3f-1a2b3c4d5e6f", "tag": "PUMP01.RUN_CMD", "value": true,
  "pulseMs": 500,
  "context": { "screen": "tong-quan", "widget": "btn_start" } }
{ "requestId": "9d0e…", "tag": "PUMP01.AUTO", "value": false, "expect": true,
  "context": { "screen": "bon-nuoc", "widget": "sw_auto" } }
```

| Trường | Ràng buộc |
|---|---|
| `context.screen`, `context.widget` | `^[a-z][a-z0-9_-]{0,63}$`; sai dạng thì bỏ (không từ chối); chỉ vào `detail` của audit |
| `expect` | boolean; Tag phải BOOL (`REJECTED` `EXPECT_NOT_BOOL`); khác giá trị hiện tại của Tag lúc kiểm: `REJECTED` `STALE_EXPECTATION`, không gì tới thiết bị trường |
| `pulseMs` | int 100–10.000 (`REJECTED` `PULSE_RANGE`); Tag BOOL RW (`PULSE_NOT_BOOL`); `value` BOOL |

**Thứ tự kiểm** (thêm vào FR-037 của 006): sau "Tag tồn tại" và "RW": `EXPECT_NOT_BOOL`, `PULSE_NOT_BOOL`, `PULSE_RANGE`; sau "kết nối" và trước "tần suất": `STALE_EXPECTATION`.

**Xung:** `CONFIRMED` chỉ sau khi cả hai lần ghi xong; phản hồi `GET tags/write/{id}`:

```json
{ "requestId": "6f1c…", "status": "ACCEPTED", "phase": "release" }
{ "requestId": "6f1c…", "status": "CONFIRMED", "code": "NO_READBACK", "pulse": { "valueMs": 500, "released": true } }
{ "requestId": "6f1c…", "status": "FAILED", "code": "PULSE_RELEASE_FAILED",
  "message": "Đã ghi bật nhưng không ghi được giá trị trả về: bit lệnh có thể đang bật",
  "pulse": { "valueMs": 500, "released": false } }
```

- `phase` thêm giá trị `release` (đang chờ `pulseMs` hoặc đang ghi giá trị ngược).
- Lần ghi đầu thất bại: kết quả của lần đầu, không ghi lần hai.
- Runtime dừng giữa chừng: dòng audit `interrupted` `UNKNOWN_OUTCOME` lúc khởi động (như 006), kèm `detail.pulse = "pending"`.

**Audit** (`tag.write`): `channel` = `web` khi phiên là cookie (`studio` khi Bearer); `detail` thêm `context`, `pulseMs`, `expect`.

**Lỗi cả lô** thêm: 403 `CSRF_FAILED`, `ORIGIN_MISMATCH`, `SESSION_SCOPE` (kèm `results` `REJECTED` cùng mã khi thân đọc được, như 401/403 của 006).

## 7. Lọc nguồn và `viewerLogin`

Mở rộng bảng §1.2 của 006:

| Điều kiện | Kết quả |
|---|---|
| Phiên web hợp lệ (cookie, HTTPS) | không bị lọc nguồn (như phiên Bearer) |
| `viewerLogin: off` | theo `viewerAccess` (ADR-018) cho request không phiên |
| `viewerLogin: required`, không phiên | trang `/` trên HTTPS: `302` tới `/login`; `/project/*`, `projects/active`, live: 401 `AUTH_REQUIRED`; `system/info`: bản tối thiểu; HTTP `/`: trang hướng dẫn "Mở bằng HTTPS: https://…" (HTML ngắn, CSP `default-src 'none'`) |
| `viewerAccess: off` | trang và dữ liệu 403 cho nguồn không phiên, kể cả `required`; phiên hợp lệ vẫn vào |

`/login`, `/device.crt`, `web/login` không bao giờ bị lọc nguồn và không bị `viewerLogin` chặn. Chế độ theo dõi chỉ đọc của Studio qua HTTP không đăng nhập (004) không dùng được khi `viewerLogin: required` (Studio Online dùng Bearer nên vẫn chạy).

## 8. Header

Mọi phản hồi của endpoint web: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`; không `Access-Control-Allow-*`. Trang và tài nguyên: CSP `kCspRuntime` như hiện nay (`frame-ancestors 'none'`, `form-action 'none'`); `/login` cần gửi biểu mẫu bằng `fetch`, không dùng `form-action`.

## 9. Tương thích

| Client | Máy chủ | Kết quả |
|---|---|---|
| Studio 0.4 (Bearer, API 1.1) | 1.2.0 | không đổi |
| Trang runtime 0.5 | runtime 0.6 | chạy project 0.2 như cũ; không có đăng nhập |
| Trang runtime 0.6 | runtime 0.5 (API 1.1) | `web/session` 404: trang ở chế độ chỉ xem; project 0.3 không có trên 0.5 |
| Client ghi cũ (không `context`, `expect`, `pulseMs`) | 1.2.0 | không đổi |

## 10. Test

- `server/http/tests/web_api_test.cpp` (CivetWeb trong tiến trình): đăng nhập (đúng, sai, khóa, đầy phiên), thuộc tính `Set-Cookie`, `session`, `logout`, `touch`, quota 8; chuỗi kiểm §1.3 từng bước; phạm vi cookie (mọi endpoint kỹ thuật 403); Bearer thắng cookie; token chéo loại; CSRF, `Origin` thiếu và lạ, `Sec-Fetch-Site`; cookie qua HTTP bị bỏ qua.
- `core/tag-engine/tests/write_extensions_test.cpp`: `expect`, `pulseMs` (đúng nhịp, lần hai lỗi, runtime dừng giữa chừng), `context` vào audit.
- `tools/web-it.ps1 -Scenario attack|control|session`: [quickstart.md](../quickstart.md) §4.
