# Contract: HTTP API của BL335 (API 1.1.0)

**Feature**: [spec.md](../spec.md) FR-029, FR-035–FR-044, FR-051, FR-055a · **Data model**: [data-model.md](../data-model.md) §6–§11 · **Research**: R13–R15, R19, R20

Bổ sung cho [device-api.md (1.0.0) của 005](../../005-device-online/contracts/device-api.md). Mọi endpoint, header, thứ tự kiểm và mã lỗi của 1.0.0 giữ nguyên. Runtime `0.5.0`, `apiVersion` `1.1.0` (MINOR: thêm endpoint, thêm trường).

## 1. Chung

### 1.1 Bảng quyền: dòng thêm

Bảng duy nhất `core/auth/roles.*` của 005 thêm:

| Thao tác | Endpoint | Cần |
|---|---|---|
| Ghi Tag | `POST /api/v1/tags/write` | operator |
| Kết quả ghi | `GET /api/v1/tags/write/{requestId}`, `GET /api/v1/tags/write?ids=` | operator; chỉ thấy lệnh của chính tài khoản (administrator thấy mọi lệnh) |
| Chẩn đoán driver | `GET /api/v1/drivers/diagnostics` | viewer |
| Danh sách cổng serial | `GET /api/v1/serial/ports` | engineer |
| Thử kết nối | `POST /api/v1/drivers/test` | engineer |
| Lọc audit theo Tag | `GET /api/v1/audit?target=` | administrator (như 005) |

Mọi endpoint trên chỉ có ở HTTPS. Gọi qua HTTP: 403 `HTTPS_REQUIRED`; riêng `tags/write` ghi audit `tag.write` `denied` thay cho `access.denied` (§3.4).

### 1.2 Lọc nguồn cho phần không cần đăng nhập (FR-055a)

| Đường dẫn | Listener | Lọc khi không kèm phiên hợp lệ |
|---|---|---|
| `/`, `/index.html`, `/assets/*`, `/project/*` | HTTP, HTTPS | có |
| `GET /api/v1/system/info`, `GET /api/v1/projects/active` | HTTP, HTTPS | có |
| `/api/v1/live` (nâng cấp WebSocket) | HTTP, HTTPS | có |
| `device/identity`, `auth/*` và mọi API kỹ thuật | HTTPS | không |

- **Phiên hợp lệ** = HTTPS + `Authorization: Bearer mats_…` + phiên còn hạn, đúng IP lúc đăng nhập. Kiểm kiểu "nhìn", không làm mới hạn phiên. Header `Authorization` qua HTTP: 403 `HTTPS_REQUIRED`.
- **Mạng riêng:** 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10, 169.254.0.0/16, 127.0.0.0/8, fc00::/7, fe80::/10, ::1; IPv4 ánh xạ (`::ffff:…`) xét như IPv4.
- **Theo `viewerAccess`** (`runtime.json`):

  | `viewerAccess` | Nguồn mạng riêng | Nguồn khác | Loopback |
  |---|---|---|---|
  | `private` (mặc định) | phục vụ | **403** `SOURCE_NOT_ALLOWED` | phục vụ |
  | `any` | phục vụ | phục vụ (có cảnh báo) | phục vụ |
  | `off` | trang, `projects/active`, live: **403** `VIEWER_OFF`; `system/info` phục vụ | 403 | phục vụ |

- **Phản hồi 403:**
  - đường dẫn trang: HTML ngắn (UTF-8, CSP `default-src 'none'`) "Trang xem chỉ mở trong mạng nội bộ. Hãy kết nối qua VPN, hoặc nhờ quản trị đổi `viewerAccess`";
  - đường dẫn API: `{ "error": "SOURCE_NOT_ALLOWED" | "VIEWER_OFF", "message": "…" }`;
  - WebSocket: HTTP 403 trước khi lấy slot (như kiểm `Origin` của ADR-006).
- **Không ghi audit**; đếm ở chẩn đoán của 005 (§2).

## 2. Phần thêm vào endpoint có sẵn

### `GET /api/v1/system/info`

```json
{
  "runtimeVersion": "0.5.0", "protocolVersion": "1.2.0",
  "schemaVersions": ["0.1", "0.2"],
  "device": { "apiVersion": "1.1.0", "viewerAccess": "private", "…": "…" },
  "warnings": []
}
```

- `viewerAccess = "any"` thì `warnings` có `"VIEWER_PUBLIC"`.
- Không có thông tin kênh, IP của PLC hay tài khoản (trang công khai).

### `GET /api/v1/device/identity`

`features` thêm `"tag-write"`, `"drivers"`, `"serial-ports"`.

### `GET /api/v1/projects/active`

Project 0.2 thêm `valueTables` (chỉ bảng mà binding dùng tới) và `connections` (id, tên, loại; không có địa chỉ, cổng, tham số serial): [project-format-0.2.md](project-format-0.2.md) §11.

### `GET /api/v1/diagnostics` (005)

Thêm:

```json
"viewer": { "access": "private", "blockedTotal": 17, "lastBlockedAt": 1791601205000 },
"tags": { "total": 812, "good": 790, "uncertain": 2, "bad": 20 },
"retain": { "state": "ok", "tags": 12, "lastSaveAt": 1791601200000, "saves": 341 }
```

`retain.state`: `ok` \| `fallback` (dùng file cũ hơn) \| `lost` (cả hai file hỏng, Tag về giá trị đầu) \| `off` (không có Tag giữ qua mất điện).

### `GET /api/v1/audit` (005)

Thêm tham số `target` (bằng đúng, ví dụ `target=TANK01.SP`). Kết hợp được với `action=tag.`.

## 3. Ghi Tag

### 3.1 `POST /api/v1/tags/write` (operator)

Request (thân ≤ 16 KiB):

```json
{ "requests": [
  { "requestId": "6f1c2a8e-4b7d-4c1e-9a3f-1a2b3c4d5e6f", "tag": "TANK01.SP", "value": 75 },
  { "requestId": "9d0e…", "tag": "PUMP01.RUN_CMD", "value": true },
  { "requestId": "a1b2…", "tag": "COUNTER.TOTAL", "value": "12345678901234567890" }
] }
```

| Trường | Ràng buộc |
|---|---|
| `requests` | 1–16 phần tử; xử lý theo thứ tự |
| `requestId` | UUID v4 dạng chữ thường có gạch; sai dạng thì cả lô 400 `BAD_REQUEST` |
| `tag` | id Tag ≤ 64 byte |
| `value` | BOOL: `true`/`false`; số: JSON number hữu hạn, hoặc chuỗi thập phân (bắt buộc với INT64/UINT64 ngoài ±2^53); STRING: chuỗi. Dấu phẩy thập phân không có trong JSON nên không mơ hồ |

**Phản hồi 200:**

```json
{ "results": [
  { "requestId": "6f1c…", "status": "ACCEPTED", "phase": "queued",
    "tag": "TANK01.SP", "old": { "value": 72.5, "quality": "GOOD" }, "value": 75,
    "receivedAt": "2026-10-20T03:12:00.123Z" },
  { "requestId": "9d0e…", "status": "REJECTED", "reason": "CONNECTION_BAD",
    "message": "Kết nối tới PLC trạm bơm đang mất" },
  { "requestId": "a1b2…", "status": "REJECTED", "reason": "RATE_LIMITED", "retryAfterMs": 2400 }
] }
```

- `reason`: mã của [data-model.md](../data-model.md) §8, theo thứ tự kiểm của FR-037.
- `raw`: giá trị thô sau scaling ngược, theo `rawType` (ví dụ 13824 với INT16 0–27648 → 0–100 %), chỉ có khi Tag có scaling.
- Gửi lại cùng `requestId`, cùng `tag` và `value`: trả kết quả đang có của lần trước, thêm `"duplicate": true`; không chạy lại, không thêm audit. Khác `tag` hoặc `value`: `REJECTED` `REQUEST_ID_CONFLICT`.

**Lỗi cả lô:**

| HTTP | `error` | Khi | `results` |
|---|---|---|---|
| 400 | `BAD_REQUEST` | thân không phải object, `requests` sai, > 16 phần tử, `requestId` sai dạng | không |
| 401 | `AUTH_REQUIRED`, `SESSION_EXPIRED`, `SESSION_INVALID` | như 005 | có, mỗi phần tử `REJECTED` cùng mã (khi thân đọc được) |
| 403 | `FORBIDDEN` | role < operator | có, `REJECTED` `FORBIDDEN` |
| 403 | `HTTPS_REQUIRED` | gọi qua HTTP | không |
| 413 | `BODY_TOO_LARGE` | > 16 KiB | không |
| 503 | `AUDIT_UNAVAILABLE` | không ghi được audit | có, `REJECTED` `AUDIT_UNAVAILABLE` |

### 3.2 `GET /api/v1/tags/write/{requestId}` và `GET /api/v1/tags/write?ids=a,b,…` (operator)

```json
{ "results": [
  { "requestId": "6f1c…", "status": "CONFIRMED", "code": "CONFIRMED", "tag": "TANK01.SP",
    "value": 75, "readback": 75, "receivedAt": "…", "finishedAt": "…", "clockOk": true },
  { "requestId": "77aa…", "status": "ACCEPTED", "phase": "readback" },
  { "requestId": "88bb…", "status": "FAILED", "code": "DEVICE_EXCEPTION",
    "exception": { "code": "02", "meaning": "địa chỉ không hợp lệ" } },
  { "requestId": "99cc…", "status": "TIMEOUT", "code": "WRITE_TIMEOUT",
    "message": "Thiết bị trường không trả lời: không chắc đã ghi" }
] }
```

- `status`: `ACCEPTED` (`phase`: `queued` \| `sent` \| `readback`), `CONFIRMED`, `FAILED`, `TIMEOUT`, `REJECTED`.
- `code`: [data-model.md](../data-model.md) §8–§9. `NO_READBACK` nghĩa là "thiết bị xác nhận, không đọc lại"; `APPLIED` là Tag nội bộ hay Tag mô phỏng nhập tay.
- Mã không có, quá 15 phút, hoặc của tài khoản khác: phần tử `{ "requestId", "status": "UNKNOWN" }` (một mã: 404 `NO_SUCH_REQUEST`).
- `ids`: ≤ 16 mã. Không làm mới hạn phiên (hỏi định kỳ). Không ghi audit.
- Studio hỏi mỗi 200 ms tới kết quả cuối, tối đa 30 s.

### 3.3 Kiểm và hàng đợi

Theo FR-037, [research.md](../research.md) R14. Mặc định của giới hạn tần suất và hàng đợi: [device-config.md](device-config.md) §1.

### 3.4 Audit

| Sự kiện | `action` / `result` / `code` |
|---|---|
| Nhận (`ACCEPTED`) | `tag.write` / `started` / `ACCEPTED`: ghi bền trước khi gửi |
| Kết quả cuối | `tag.write` / `ok` \| `failed` / mã cuối |
| Từ chối (mọi bước, cả gọi qua HTTP, cả bản tin `write` trên live) | `tag.write` / `denied` / mã `REJECTED`; gộp 60 s |
| Runtime dừng giữa chừng | `tag.write` / `interrupted` / `UNKNOWN_OUTCOME`, ghi lúc khởi động |

`target` = id Tag; `detail` theo [data-model.md](../data-model.md) §9.

## 4. Thử kết nối: `POST /api/v1/drivers/test` (engineer)

Request (thân ≤ 16 KiB): cấu hình đang sửa trong Studio, theo schema của `connections.json`:

```json
{ "channel": { "kind": "modbus-tcp", "tcp": { "host": "192.168.10.5", "port": 502, "connectTimeoutMs": 3000 } },
  "device": { "unitId": 1, "timeoutMs": 1000, "addressBase": 0 },
  "read": { "address": "HR100", "count": 2 } }
```

- `channel.kind = modbus-rtu`: có `serial` như `connections.json` và `device.slave`.
- `read` tùy chọn: thanh ghi 1–4, bit 1–16.

**200:**

```json
{ "ok": true, "code": "OK", "connectMs": 4, "responseMs": 12,
  "read": { "fc": 3, "offset": 100, "count": 2, "registers": ["42F6", "E979"] } }
```

```json
{ "ok": false, "code": "EXCEPTION", "connectMs": 3, "responseMs": 9,
  "exception": { "code": "02", "meaning": "địa chỉ không hợp lệ" } }
```

```json
{ "ok": false, "code": "REFUSED", "message": "PLC từ chối kết nối (có thể đã đủ số kết nối)" }
```

- `code`: [modbus-driver.md](modbus-driver.md) §10. Bit trả `"bits": [true, false, …]`.
- Phản hồi trong ≤ chờ kết nối + chờ trả lời + 2 s; trần cứng 35 s.

| HTTP | `error` | Khi |
|---|---|---|
| 409 | `TEST_BUSY` | đang có lần thử khác trên BL335 này |
| 429 | `TEST_RATE_LIMITED` | > 10 lần/phút; header `Retry-After` |
| 400 | `BAD_REQUEST` | cấu hình sai (kèm `issues` theo mã của bộ kiểm tra: `E_ADDR_SYNTAX`, `E_SERIAL_PORT`…) |
| 503 | `AUDIT_UNAVAILABLE` | |

Audit `driver.test`: `target` = `host:cổng` hoặc tên cổng; `code` = mã kết quả.

## 5. Chẩn đoán driver: `GET /api/v1/drivers/diagnostics` (viewer)

```json
{
  "at": 1791601205000, "runtimeStartedAt": 1791597605000,
  "scanGroups": { "fast": 250, "normal": 1000, "slow": 5000 },
  "channels": [
    { "id": "rs485-1", "name": "RS485 đồng hồ điện", "kind": "modbus-rtu", "state": "connected",
      "lastError": { "code": "TIMEOUT", "at": 1791601201000, "device": "meter3" },
      "reconnects": 0, "warnings": ["RS485_UNSUPPORTED"],
      "devices": [
        { "id": "meter3", "name": "Đồng hồ 3", "state": "active",
          "requestsOk": 10234, "timeouts": 57, "exceptions": { "02": 1 },
          "badFrames": { "crc": 12, "format": 0, "tid": 0, "unit": 0, "length": 3, "echo": 0 },
          "responseMs": { "avg": 41.5, "max": 212 },
          "groups": [ { "group": "normal", "periodMs": 1000, "actualMs": { "avg": 1800, "max": 2310 },
                        "overruns": 412, "overloaded": true } ],
          "writes": { "confirmed": 3, "failed": 0, "timeout": 1, "rejected": 2 } } ] } ],
  "badTags": [
    { "id": "METER3.P", "quality": "BAD", "reason": "TIMEOUT", "detail": null, "updatedAt": 1791601201000 },
    { "id": "TANK01.VOLUME", "quality": "BAD", "reason": "INPUT_BAD", "detail": "TANK01.LEVEL", "updatedAt": 1791601201000 }
  ],
  "badTagsTruncated": false
}
```

- `badTags` ≤ 500, xấu mới nhất trước; `detail` là đầu vào xấu (Tag tính toán) hoặc mã exception.
- Không làm mới hạn phiên. Studio hỏi mỗi 2 s khi trang mở (FR-051).

## 6. Cổng serial: `GET /api/v1/serial/ports[?probe=1]` (engineer)

```json
{ "ports": [
  { "name": "ttyAS0", "path": "/dev/ttyAS0", "kind": "onboard", "driver": "uart", "allowed": false,
    "inUse": { "by": "console", "detail": "console của hệ điều hành (serial-getty@ttyAS0)" }, "rs485": "unknown" },
  { "name": "ttyAS2", "path": "/dev/ttyAS2", "kind": "onboard", "driver": "uart", "allowed": true,
    "inUse": { "by": "channel", "detail": "rs485-1" }, "rs485": "enabled" },
  { "name": "ttyUSB0", "path": "/dev/ttyUSB0", "kind": "usb", "driver": "option",
    "usb": { "vid": "2c7c", "pid": "0125", "product": "EC25" }, "allowed": false, "inUse": null, "rs485": "unknown" }
] }
```

- Đọc `/sys/class/tty`, `/proc/consoles`, `/sys/class/tty/console/active`, `/dev/serial/by-id`, file khóa `/run/lock/LCK..*`. Không mở cổng nào.
- `?probe=1` (Studio gọi khi người dùng bấm "Dò RS485"): với cổng `allowed`, rảnh, runtime mở cổng, đặt lại đúng cấu hình đang có bằng `TIOCSRS485`, rồi đóng. Có audit `driver.test` (`target` = tên cổng, `code` = `RS485_PROBE`).
- Giá trị `driver` thật phụ thuộc kernel của BL335 (xác nhận bằng lệnh chỉ đọc, [quickstart.md](../quickstart.md) §8).

## 7. Làm mới hạn phiên

Theo quy tắc của 005: mọi `POST` làm mới hạn (`tags/write`, `drivers/test`). `GET` của kết quả ghi, chẩn đoán driver và danh sách cổng không làm mới.
