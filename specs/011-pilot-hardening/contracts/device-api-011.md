# Contract: API thiết bị, cấu hình và CLI thêm ở feature 011

**Feature**: [spec.md](../spec.md) FR-008 đến FR-017, FR-040, FR-058 đến FR-072, FR-080 đến FR-083 · **ADR**: [035](../../../docs/adr/035-release-trust-ota.md), [036](../../../docs/adr/036-security-hardening.md), [037](../../../docs/adr/037-logic-v2.md)

API thiết bị tăng một bước MINOR kế tiếp của feature 010 (lúc viết: 007 là 1.2.0, 008 giữ 1.2.0, 009 là 1.3.0, 010 chưa có plan; dự kiến 1.4.0 hoặc 1.5.0, T003 chốt). Mọi thay đổi **thêm vào**; không endpoint cũ nào đổi nghĩa. Ngoại lệ có chủ ý ghi rõ ở §1 (421) và §2 (khóa).

Ký hiệu bảng quyền: `T` Bearer, `C` cookie web (`cookieAllowed`), role tối thiểu. Mọi endpoint mới có `cookieAllowed = false` trừ khi ghi khác (007 FR-042).

## 1. Kiểm `Host`

Áp cho **mọi** yêu cầu HTTP (8080), HTTPS (8443) và nâng cấp WebSocket, chạy trước đăng nhập, trước phục vụ file, trước kiểm `Origin`.

Chuẩn hóa `Host`: cắt khoảng trắng, hạ chữ thường, bỏ một dấu chấm cuối của tên, tách cổng (`:` cuối, trừ IPv6 trong ngoặc), bỏ ngoặc IPv6.

| Giá trị `Host` đã chuẩn hóa | Kết quả |
|---|---|
| IPv4 literal hợp lệ (`a.b.c.d`, mỗi số 0 đến 255) | chấp nhận (mọi IP, vì kẻ tấn công không rebinding được IP literal) |
| IPv6 literal hợp lệ (`[...]`) | chấp nhận |
| `localhost` | chấp nhận |
| tên máy của thiết bị (`gethostname()`), hoặc `<tên>.local` | chấp nhận |
| có trong `allowedHosts` (so khớp chính xác, không ký tự đại diện) | chấp nhận |
| tên khác | 421 `HOST_NOT_ALLOWED` |
| thiếu `Host` | HTTP/1.1: 400 `BAD_REQUEST`; HTTP/1.0: chấp nhận khi nguồn là loopback, ngược lại 400 |
| nhiều tiêu đề `Host`, ký tự điều khiển, dài > 255 byte | 400 `BAD_REQUEST` |

- Thân 421: `{"error":{"code":"HOST_NOT_ALLOWED","message":"Tên này chưa được phép. Quản trị viên: thêm vào allowedHosts của runtime.json."}}`, không có dữ liệu khác.
- `hostCheck: "off"` bỏ toàn bộ bảng; `system/info.warnings` có `HOST_CHECK_OFF`.
- Audit `access.denied` (gộp theo cửa sổ 60 s của 005), `detail.host` cắt 64 byte, `detail.reason = "host"`.
- `GET /api/v1/device/identity` thêm `acceptedHosts: { names: [...], ips: ["*"] }` (liệt kê tên đang nhận; IP ghi `*`).
- Không áp cho gói UDP discovery (không phải HTTP).

## 2. Đăng nhập: khóa và giới hạn

Thay cho khóa theo tên của 005 (ADR-036):

| Khóa | Khóa theo | Ngưỡng | Thời gian khóa | Ghi chú |
|---|---|---|---|---|
| Cặp | (tên tài khoản đã chuẩn hóa NFC, IP nguồn) | 5 lần sai liên tiếp | 5 phút, nhân đôi mỗi lần khóa lặp lại trong 24 giờ, tối đa 60 phút | thay khóa theo tên |
| IP | IP nguồn | 20 lần sai (mọi tên) trong 10 phút | 5 phút | giữ ý của 005 |
| Đồng thời | toàn thiết bị | `maxConcurrentLogins` kiểm mật khẩu cùng lúc | không khóa | vượt: 429 `LOGIN_BUSY`, `Retry-After: 1` |

- Đăng nhập thành công xóa **chỉ** bộ đếm của cặp (tên, IP). Không xóa bộ đếm IP, không xóa bộ đếm cặp khác.
- Trả lời khi bị khóa: 429 `ACCOUNT_LOCKED` (như 005, `retryAfterS`); thông điệp không phân biệt "tên không tồn tại" với "sai mật khẩu" (như 007).
- Tối đa 4.096 cặp trong bộ nhớ (LRU); mất khi khởi động lại.
- Tấn công phân tán: ≥ 50 lần sai trong 10 phút cho một tên từ ≥ 5 IP: audit `auth.distributed_attack` (gộp 10 phút), không khóa.
- Hạn khóa dùng đồng hồ monotonic.
- CLI root (mục 7): `--user-unlock <tên>`, `--user-unlock-all`. Mật khẩu mới ≥ 10 ký tự (`--user-add`, `--user-passwd`); tài khoản có sẵn không bị ép.

## 3. Cập nhật runtime (OTA)

Mọi endpoint: HTTPS, Bearer, role `administrator`, `cookieAllowed = false`. Khi `update.enabled` là false: 404 `UPDATE_DISABLED`. Gói và quy trình: [update-package.md](update-package.md).

| Endpoint | Mô tả |
|---|---|
| `POST /api/v1/system/update` | Tải gói (`Content-Type: application/octet-stream`, `Content-Length` bắt buộc, không `chunked`) |
| `GET /api/v1/system/update` | Trạng thái và kế hoạch |
| `POST /api/v1/system/update/apply` | Xác nhận áp dụng: `{"updateId": "...", "password": "..."}` |
| `POST /api/v1/system/update/cancel` | Hủy gói đang chờ (chưa áp dụng) |
| `POST /api/v1/system/update/rollback` | Quay về bản `.prev`: `{"password": "..."}` |

**`POST /system/update`**

- Audit `system.update.accepted` (FULL) **trước** khi nhận byte đầu; rồi nhận có hạn: tổng ≤ 120 s, tốc độ tối thiểu 64 KiB/s sau 10 s đầu, `Content-Length` ≤ `maxPackageMiB` MiB, ghi vào `<dataDir>/update/incoming/<id>.part` (0600).
- Kiểm theo thứ tự của FR-061 (kích thước, phong bì, chữ ký, băm, danh sách file, sản phẩm và kiến trúc, `releaseSeq`, `minFromVersion`, `projectFormatMax`, chỗ trống).
- 201 thành công: `{"updateId":"upd_…","state":"verified","plan":{"from":"1.0.0","to":"1.0.1","releaseSeq":12,"signer":{"keyId":"sha256:…","label":"release-primary"},"projectCompatible":true,"estimatedDowntimeS":25,"restartRequired":true,"notes":"…"}}`.
- Lỗi: 400 `UPDATE_PACKAGE_INVALID` (kèm `detail.code`), 403 `UPDATE_SIGNATURE_INVALID`, 403 `UPDATE_KEY_UNKNOWN`, 409 `DEVICE_BUSY`, 409 `UPDATE_DOWNGRADE`, 409 `UPDATE_PROJECT_INCOMPATIBLE`, 413 `UPDATE_TOO_LARGE`, 422 `UPDATE_ARCH_MISMATCH`, 422 `UPDATER_MANUAL_ONLY`, 507 `INSUFFICIENT_SPACE`, 408 `UPDATE_RECEIVE_ABORTED`.
- Chỉ một gói ở trạng thái `verified` hoặc đang áp dụng tại một thời điểm; gói `verified` hết hạn sau 30 phút (xóa).

**`GET /system/update`**: `{"enabled":true,"state":"idle|verified|applying|committed|rolled-back|failed","updateId":"…","plan":{…},"step":"switching|health-check|…","startedAt":"…","last":{"updateId":"…","result":"committed|rolled-back","from":"…","to":"…","finishedAt":"…","reason":"…"},"previous":{"version":"1.0.0","available":true}}`. Role administrator (chứa thông tin hệ thống).

**`POST /system/update/apply`**

- Kiểm mật khẩu (Argon2id, tính vào `maxConcurrentLogins`), sai mật khẩu: 403 `REAUTH_FAILED` và tính vào khóa cặp (tên, IP) như đăng nhập sai.
- Audit `system.update.applying` (FULL), ghi tệp yêu cầu `<dataDir>/update/request.json`, 202 `{"state":"applying"}`; `mat-updater.path` kích hoạt `mat-updater`. Trả lời trước khi dịch vụ dừng; Studio theo dõi bằng nối lại và `GET /system/update`.
- Điều kiện: có gói `verified` đúng `updateId`, không có nạp xuống hay thao tác khác (`DEVICE_BUSY`).

**Audit** (dòng `audit.db`): `system.update.accepted`, `.rejected` (mã), `.applying`, `.committed`, `.rolled-back` (lý do), `.cancelled`, `.manual-rollback`, `system.keys.updated`. Dòng `committed` và `rolled-back` do runtime mới ghi ở lần khởi động đầu sau cập nhật (đọc `last.json` do `mat-updater` để lại), vì `mat-updater` không ghi `audit.db`.

## 4. Logic

| Endpoint | Role | Mô tả |
|---|---|---|
| `GET /api/v1/logic` | viewer (T, C) | trạng thái toàn bộ khối |
| `POST /api/v1/logic/writes` | administrator (T) | `{"enabled": false}` dừng ghi ngay (giữ qua khởi động lại); `{"enabled": true}` bị từ chối `403 LOGIC_ENABLE_ROOT_ONLY` |
| `POST /api/v1/logic/reset` | engineer (T) | `{"id": "<id khối>", "value": 0}` đặt lại counter, totalizer, giờ chạy (audit `logic.reset`) |

**`GET /logic`**

```json
{
  "enabled": true,
  "writes": { "configured": "on", "runtimeEnabled": true, "perMinute": 3, "limitPerMinute": 20 },
  "scan": { "periodMs": 100, "lastMs": 1.8, "p99Ms": 3.1 },
  "blocks": [
    { "id": "pump_low_level", "kind": "rule", "state": "OK", "lastFired": "2026-10-13T08:12:03+07:00", "fired": 14, "reason": null },
    { "id": "pump_hours", "kind": "runhours", "state": "OK", "outputs": { "LOGIC.PUMP01.HOURS": 123.456 } }
  ]
}
```

`state`: `OK`, `SUSPENDED` (kèm `reason`: `INPUT_BAD`, `TIME_NOT_SYNCED`, `EXPR_ERROR`), `THROTTLED`, `DISABLED`. Không có `logic.json` thì `{"enabled": false}`.

Ghi vào Tag logic qua `POST /tags/write`: `REJECTED` `OWNED_BY_LOGIC` (và audit `denied`).

Audit: `logic.write` (mỗi lệnh ghi thật: `ruleId`, `writeId`, `tag`, `old`, `new`, `inputs` ≤ 8 cặp, kết quả), `logic.write.suppressed` (gộp 60 s), `logic.throttled` (gộp 60 s), `logic.writes.disabled` (administrator dừng), `logic.reset`, `logic.retain.lost`.

## 5. `system/info`, `system/diagnostics`, `device/identity`

`system/info.warnings` thêm: `HOST_CHECK_OFF`, `SSH_ROOT_PASSWORD`, `PULSE_STUCK`, `LOGIC_WRITES_OFF`, `LOGIC_THROTTLED`, `LOGIC_RETAIN_LOST`, `UPDATE_ROLLED_BACK`, `TIME_NOT_SYNCED`, `UPDATE_KEYS_MISSING` (mỗi cảnh báo: `code`, `message` tiếng Việt, `since`, `detail`). `system/info` thêm `update: {"enabled": bool, "supported": true}` và `logic: {"present": bool, "writes": "off|on|stopped"}` để Studio ẩn hay hiện chức năng; thiết bị cũ không có hai khóa này thì Studio coi là không hỗ trợ.

`system/diagnostics` (FR-009) thêm:

```json
{
  "uptimeS": 1234567,
  "restarts": { "total": 2, "lastReason": "systemd-restart|update|crash|unknown", "lastAt": "…" },
  "rssMb": 41.2, "rssPeakMb": 48.9, "cpuPct": 11.4, "fdCount": 63, "threads": 31,
  "ioWriteBytesToday": { "total": 183500000, "history": 120000000, "audit": 3000000, "retain": 4000000, "logic": 2000000, "log": 9000000, "other": 45500000 },
  "emmcLife": { "typeA": 1, "typeB": 1, "preEol": 1, "source": "mmc-extcsd" },
  "liveLagP95Ms": 120, "clients": 7, "timeSynced": true
}
```

`emmcLife` là `null` kèm `reason` khi không đọc được (thiếu `mmc-utils`, không có quyền, thiết bị không phải eMMC). `ioWriteBytesToday` từ `/proc/self/io` (`write_bytes`) cộng bộ đếm của từng thành phần, đặt lại lúc 00:00 giờ địa phương. Không có bí mật trong mọi trường.

## 6. `runtime.json`: khóa mới

| Khóa | Kiểu, mặc định, khoảng | Ý nghĩa |
|---|---|---|
| `allowedHosts` | mảng chuỗi, `[]`, ≤ 32 tên, mỗi tên ≤ 253 byte | tên miền được chấp nhận ở `Host` |
| `hostCheck` | `"strict"` (mặc định), `"off"` | bật tắt kiểm `Host` |
| `maxConnPerSource` | số nguyên, 24, 4 đến 64 | kết nối đồng thời tối đa mỗi IP nguồn (HTTP, HTTPS, WebSocket cộng chung, đếm lúc `accept()`, vượt thì đóng ngay); giá trị áp dụng không quá 60 % `httpsThreads` (đặt cao hơn: runtime dùng 60 % và cảnh báo lúc khởi động) |
| `maxConcurrentLogins` | số nguyên, 2, 1 đến 4 | kiểm mật khẩu đồng thời |
| `pulseRecovery` | `"on"` (mặc định), `"off"` | nhả xung dở khi khởi động |
| `update.enabled` | bool, `false` | bật OTA |
| `update.maxPackageMiB` | số nguyên, 64, 8 đến 256 | trần gói |
| `update.trustedKeysDir` | chuỗi, `/etc/mat-runtime/trusted-keys` | thư mục khóa công khai |
| `logic.writes` | `"off"` (mặc định), `"on"` | cho phép ghi PLC từ logic |
| `logic.maxWritesPerMin` | số nguyên, 20, 1 đến 60 | tổng lệnh ghi từ logic mỗi phút |
| `logic.flushS` | số nguyên, 60, 10 đến 600 | chu kỳ ghi trạng thái logic |
| `logic.scanMs` | số nguyên, 100, 50 đến 1000 | chu kỳ quét logic |
| `tzOffsetMin` | số nguyên, 420, -720 đến 840 | độ lệch múi giờ của lịch (phút so với UTC) |

Khóa lạ: bỏ qua kèm cảnh báo trên stderr (tương thích ngược). Giá trị ngoài khoảng: runtime không khởi động và in lỗi cụ thể (như 005).

## 7. CLI (root) thêm vào `mat-runtime`

| Lệnh | Việc |
|---|---|
| `--check-data [--json]` | kiểm chỉ đọc cơ sở dữ liệu và trạng thái (FR-040); thoát 0, 1, 2 |
| `--user-unlock <tên>`, `--user-unlock-all` | ghi tệp yêu cầu mở khóa, runtime đọc ở chu kỳ tiếp theo (hoặc khởi động lại) |
| `--trust-key add <file.pem>`, `--trust-key remove <keyId>`, `--trust-key list` | quản lý khóa tin cậy (ghi `trusted-keys/`, audit khi runtime chạy lại) |
| `--update-status` | in `last.json` |
| `--self-check --config <file>` | kiểm cấu hình, mở chỉ đọc cơ sở dữ liệu, chạy validator trên project đang chạy; không mở cổng, không ghi; thoát 0 hay mã lỗi (dùng bởi `mat-updater` ở bước S5) |

Tệp thực thi riêng (không phải `mat-runtime`):

| Tệp | Việc |
|---|---|
| `mat-update-verify <pkg|SHA256SUMS> [--sig <file>] [--keys <dir>] [--json]` | kiểm phong bì hoặc chữ ký của `SHA256SUMS`; mã thoát 0 hợp lệ, 3 chữ ký sai, 4 khóa lạ, 5 định dạng sai |
| `mat-updater` | thực hiện cập nhật; chỉ chạy bởi systemd (`mat-updater.service`) |

## 8. Mã lỗi mới (đủ để sinh `docs/user/error-codes.md`)

`HOST_NOT_ALLOWED` (421), `LOGIN_BUSY` (429), `PULSE_JOURNAL_FAILED` (FAILED), `PULSE_STUCK` (cảnh báo), `PERSIST_FAILED`, `E_PACKAGE_EXTRA_FILE`, `UPDATE_DISABLED`, `UPDATE_PACKAGE_INVALID`, `UPDATE_SIGNATURE_INVALID`, `UPDATE_KEY_UNKNOWN`, `UPDATE_DOWNGRADE`, `UPDATE_PROJECT_INCOMPATIBLE`, `UPDATE_TOO_LARGE`, `UPDATE_ARCH_MISMATCH`, `UPDATER_MANUAL_ONLY`, `INSUFFICIENT_SPACE`, `UPDATE_RECEIVE_ABORTED`, `REAUTH_FAILED`, `OWNED_BY_LOGIC`, `LOGIC_ENABLE_ROOT_ONLY`, `E_LOGIC_*` (contract logic-engine §11), `E_TEMPLATE_TAG_REF`, `E_POPUP_ARGS`, `E_TEMPLATE_PARAM`.
