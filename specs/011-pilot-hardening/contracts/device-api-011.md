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
- Audit `access.denied`, `detail.host` cắt 64 byte, `detail.reason = "host"`. Rà soát bảo mật 011 (L1, T062, 2026-10-17): gộp theo (địa chỉ nguồn, mã) trong 60 s: lần từ chối đầu ghi ngay (`target` là đường dẫn, `source` là `IP:cổng`); các lần sau trong phút đó chỉ đếm trong bộ nhớ (mọi đường dẫn, cả hai cổng); hết phút thì một bản ghi tổng `target = "*"`, `source` là địa chỉ, `detail = {"reason":"host","host":<lần cuối>,"repeated":n,"windowS":60}` (ghi ở chu kỳ 5 s của runtime, ở lần từ chối kế tiếp, hoặc lúc dừng). Tối đa 256 cửa sổ cùng lúc; đầy thì cửa sổ cũ nhất ghi tổng của nó rồi nhường chỗ. Một trận yêu cầu sai `Host` tốn một bản ghi mỗi phút cho mỗi nguồn, không phải một bản ghi mỗi yêu cầu.
- `GET /api/v1/device/identity` thêm `acceptedHosts: { names: [...], ips: ["*"] }` (liệt kê tên đang nhận; IP ghi `*`). Rà soát bảo mật 011 (L6): **chỉ** khi request có phiên hợp lệ (Bearer, hoặc cookie phiên web); không có phiên thì vắng khóa này (các khóa khác của `identity` vẫn công khai). Studio ≥ 1.0 đọc lại `identity` bằng token ngay sau khi đăng nhập.
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
- Tối đa 4.096 cặp trong bộ nhớ (LRU); mất khi khởi động lại. Rà soát bảo mật 011 (L5): bảng đầy thì bỏ trước cặp chưa từng bị khóa (hoặc lần khóa cuối đã quá 24 giờ), rồi mới tới cặp không đang khóa, cuối cùng cặp có hạn khóa sớm nhất: một trận cặp mới không xóa được lịch sử làm khóa lặp nhân đôi. Bảng IP (1.024) bỏ trước IP không có lần sai nào trong 10 phút. Bảng theo dõi tấn công phân tán (256 tên) bỏ trước tên có mọi lần sai đã quá 10 phút, rồi tên có ít lần sai nhất.
- IP nguồn của bộ đếm là địa chỉ đã chuẩn hóa: `::ffff:a.b.c.d` (IPv4 qua socket hai ngăn xếp) tính là `a.b.c.d` (L7).
- `LOGIN_BUSY` (L4): không ghi `auth.login`, không đếm lần sai; runtime ghi audit `auth.busy` (kênh `system`, `denied`, mã `LOGIN_BUSY`, `detail = {"refused": n, "maxConcurrentLogins": m, "windowS": 60}`) ở lần từ chối đầu, rồi tối đa một bản ghi mỗi phút với số lần từ chối kể từ bản ghi trước, kèm một dòng cảnh báo trên stderr.
- Tấn công phân tán: ≥ 50 lần sai trong 10 phút cho một tên từ ≥ 5 IP: audit `auth.distributed_attack` (gộp 10 phút), không khóa.
- Hạn khóa dùng đồng hồ monotonic.
- CLI root (mục 7): `--user-unlock <tên>`, `--user-unlock-all`. Mật khẩu mới 15–128 ký tự (`--user-add`, `--user-passwd`; giữ mức của ADR-011 theo NIST SP 800-63B-4, vẫn đạt yêu cầu ≥ 10 của FR-017; quyết định 2026-10-16, T044); tài khoản có sẵn không bị ép.

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

Cài đặt (T111, T112, T116, 2026-10-17): `update.enabled` false thì 404 `UPDATE_DISABLED` sau cổng quyền (chưa đăng nhập vẫn 401, sai role 403). Thêm mã: 404 `UPDATE_NOT_FOUND` (apply hoặc cancel khi không có gói `verified` mang `updateId` đó, kể cả đã hết 30 phút), 409 `UPDATE_NO_PREVIOUS` (rollback khi không có `/opt/mat-runtime.prev/bin/mat-runtime`), 503 `UPDATE_KEYS_MISSING`, 415 `UNSUPPORTED_MEDIA_TYPE`, 411 `LENGTH_REQUIRED`, 429 `AUTH_LOCKED`/`LOGIN_BUSY` ở bước xác thực lại. Mật khẩu của apply và rollback kiểm bằng `AuthService::reauthenticate`: cùng khóa cặp (tên, IP) và khóa IP, cùng hàng đợi băm `maxConcurrentLogins` với đăng nhập, audit `auth.reauth` (ok, failed), không tạo phiên; thiếu mật khẩu là 403 `REAUTH_FAILED` không tốn lượt băm. `GET` trả thêm `sha256`, `op`, `keys`, `current` (`version`, `releaseSeq`, `arch`); `state` là `committed`/`rolled-back`/`failed` khi `last.json` mang đúng `updateId` đang áp dụng. `system/info` có thêm `releaseSeq` (từ `build-info.json` của cây cài) cho bước kiểm sức khỏe. Gói được đọc theo khối 4 KiB (`mg_read` chờ đủ khối) để luật tốc độ tối thiểu chạy thường xuyên. Phiên Bearer và web **không** qua được lần khởi động lại của OTA (`RuntimeDirectory` mất khi dịch vụ dừng, unit không đổi): Studio đăng nhập lại; không phiên nào được nâng quyền (FR-071, nhánh "không thì đăng nhập lại").

## 4. Logic

| Endpoint | Role | Mô tả |
|---|---|---|
| `GET /api/v1/logic` | viewer (T, C) | trạng thái toàn bộ khối |
| `POST /api/v1/logic/writes` | administrator (T) | `{"enabled": false}` dừng ghi ngay (giữ qua khởi động lại); `{"enabled": true}` bị từ chối `403 LOGIC_ENABLE_ROOT_ONLY` (bật lại: root `mat-runtime --logic-writes-reset`, §7) |
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

Audit: `logic.write` (mỗi lệnh ghi thật: `ruleId`, `writeId`, `tag`, `old`, `new`, `inputs` ≤ 8 cặp, kết quả), `logic.write.suppressed` (gộp 60 s), `logic.throttled` (gộp 60 s), `logic.writes.disabled` (administrator dừng), `logic.writes.enabled` (root bỏ lệnh dừng, §7), `logic.reset`, `logic.retain.lost`.

## 5. `system/info`, `system/diagnostics`, `device/identity`

`system/info.warnings` thêm: `HOST_CHECK_OFF`, `SSH_ROOT_PASSWORD`, `PULSE_STUCK`, `LOGIC_WRITES_OFF`, `LOGIC_THROTTLED`, `LOGIC_RETAIN_LOST`, `UPDATE_ROLLED_BACK`, `TIME_NOT_SYNCED`, `UPDATE_KEYS_MISSING` (mỗi cảnh báo: `code`, `message` tiếng Việt, `since`, `detail`). Rà soát bảo mật 011 (L6, 2026-10-17): `detail` (đường dẫn thư mục khóa, Tag, nguồn đồng hồ…) chỉ có khi request có phiên hợp lệ (Bearer qua HTTPS hoặc cookie phiên web); request không có phiên vẫn nhận đủ `warnings` và `warningDetails` (`code`, `message` chung, `since`) nhưng `detail` luôn `null`. Studio đọc `system/info` bằng token nên không đổi; trang vận hành không đọc `detail`. `system/info` thêm `update: {"enabled": bool, "supported": true}` và `logic: {"present": bool, "writes": "off|on|stopped"}` để Studio ẩn hay hiện chức năng; thiết bị cũ không có hai khóa này thì Studio coi là không hỗ trợ.

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

Cài đặt (T029, 2026-10-17): khóa cũ của 005 (`cpu`, `memory`, `uptime`, `clients` dạng đối tượng `{live, max, sessions}`) giữ nguyên; khóa mới nằm ở cấp gốc. Đơn vị `rssMb`, `rssPeakMb` là MiB (1.048.576 byte), làm tròn 0,1; `cpuPct` là phần CPU của runtime trung bình 5 phút. Giá trị không biết là `null`, không bao giờ là 0: `fdCount`, `threads` (không đọc được `/proc`), `liveLagP95Ms` (không có khung delta nào trong 5 phút), `ioWriteBytesToday` (bộ đếm chưa chạy), `restarts` (runtime không có nguồn). `emmcLife` đọc sysfs (`/sys/block/mmcblkN/device/life_time`, `pre_eol_info`, chỉ thiết bị `type = MMC`), không chạy `mmc` (cần root); khi `null` thì có thêm `emmcLifeReason`: `no-emmc`, `not-supported`, `unreadable`. `ioWriteBytesToday` có thêm thành phần `alarm` (`alarm.db`); `log` luôn `null` (journald ghi, runtime không đo được); `total` là `write_bytes` của kernel khi có, nếu không (BL335, ADR-039) là tổng các thành phần và `other` là `null`; hai khóa anh em `ioWriteSource` (`proc-self-io` hoặc `counters`) và `ioWriteSince` (ms UTC, đầu khoảng đếm: lúc tiến trình khởi động hoặc 00:00 theo `tzOffsetMin`). `restarts` lấy từ `<dataDir>/run-record.json` (ghi lúc khởi động và lúc dừng sạch): `crash` khi lần chạy trước không dừng sạch (kể cả `kill -9`, mất điện), `update` khi phiên bản khác, `systemd-restart` khi dừng sạch, `unknown` khi tệp hỏng; `execv` đổi project không tính là khởi động lại; thêm `bootChanged` (boot id khác: máy khởi động lại). `liveLagP95Ms`: từ đầu vòng Tag Engine đến khi ghi xong khung delta, biểu đồ tần suất theo phút, cửa sổ 4 đến 5 phút, p95 là cận trên của ô (1 ms đến 100 ms, 10 ms đến 1 s, 100 ms đến 10 s). `timeSynced` (cả `system/info.timeSynced`) theo `server/time_sync.hpp` (T140).

## 6. `runtime.json`: khóa mới

| Khóa | Kiểu, mặc định, khoảng | Ý nghĩa |
|---|---|---|
| `allowedHosts` | mảng chuỗi, `[]`, ≤ 32 tên, mỗi tên ≤ 253 byte | tên miền được chấp nhận ở `Host` |
| `hostCheck` | `"strict"` (mặc định), `"off"` | bật tắt kiểm `Host` |
| `maxConnPerSource` | số nguyên, 48, 4 đến 64 | kết nối đồng thời tối đa mỗi IP nguồn (HTTP, HTTPS, WebSocket cộng chung, đếm lúc `accept()`, vượt thì đóng ngay); giá trị áp dụng không quá 75 % `httpsThreads` (mặc định 64; đặt cao hơn: runtime dùng 75 % và cảnh báo lúc khởi động). Đổi 2026-10-17 từ 24 và 60 % của 40 worker: 10 trang sau một địa chỉ (NAT, VPN) cùng F5 cần tới 41 kết nối, xem ADR-010. Rà soát bảo mật 011 (M1): thêm phần của từng cổng, mỗi cổng có nhóm worker riêng: một nguồn giữ tối đa min(`maxConnPerSource`, 75 % worker của cổng đó), mặc định 18 trong 24 worker HTTP (`threads`) và 48 trong 64 worker HTTPS, vẫn tối đa 48 cho cả hai cổng cộng lại |
| `maxLiveClientsPerSource` | số nguyên, không đặt, 1 đến 10 | phiên dữ liệu sống (WebSocket `/api/v1/live`) đồng thời tối đa của một IP nguồn; không đặt: nửa số phiên tối đa, làm tròn lên (5 của 10); không bao giờ quá `maxClients`. Vượt: bản tin `error` mã `MAX_CLIENTS_REACHED` có thêm `"scope":"source"` và câu "Máy này đã mở tối đa N kết nối dữ liệu sống. Đóng bớt tab hoặc thử lại sau.", rồi đóng 4429 như khi đầy (trang 1.x chờ 30 s rồi thử lại). Thêm 2026-10-17 (rà soát bảo mật 011, M1): trước đó một máy chiếm được cả 10 phiên. Nhiều máy sau một NAT là một nguồn: đặt 10 để giữ cách cũ. Tham số dòng lệnh `--max-live-clients-per-source N` (giàn thử mở 10 trang từ một máy) |
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
| `--user-unlock <tên>`, `--user-unlock-all` | ghi tệp yêu cầu mở khóa, runtime đọc ở chu kỳ tiếp theo (hoặc khởi động lại). Rà soát bảo mật 011: CLI mở `dataDir` bằng `O_DIRECTORY|O_NOFOLLOW` rồi xóa và tạo tệp tương đối với thư mục đó (`unlinkat`, `openat`), nên `dataDir` là liên kết thì lệnh thất bại (mã 4, audit `failed`) (L3); runtime chỉ dùng `<dataDir>/auth-unlock.req` khi là tệp thường của root (uid 0), không có quyền nào cho nhóm và người khác; ngược lại xóa không dùng, ghi một dòng log và audit `account.unlock` kết quả `denied`, mã `UNLOCK_REQUEST_REFUSED`, `detail.reason` là `type`, `owner` hoặc `mode` (L2) |
| `--logic-writes-reset` | bỏ lệnh dừng ghi PLC của logic do administrator đặt (`POST /logic/writes {"enabled": false}`, §4): audit `logic.writes.enabled` (`started`, `ok`/`failed` mã `LOGIC_RESET_REQUEST_FAILED`), ghi tệp yêu cầu `<dataDir>/logic-writes-reset.req` (0600, không theo symlink; từ rà soát bảo mật 011 L3 ghi qua `openat` trên `dataDir` mở `O_DIRECTORY|O_NOFOLLOW`, như `--user-unlock-all`); runtime lấy trong 5 s (project có `logic.json`) hoặc lúc khởi động: `writesStopped` của `logic-state.json` về `false` (giữ `edges`), xóa tệp, audit `logic.writes.enabled` kênh `system`. `logic.writes` của `runtime.json` vẫn quyết định. Thêm 2026-10-17 (theo sau T137); trước đó root phải xóa `logic-state.json` rồi khởi động lại |
| `--trust-key add <file.pem>`, `--trust-key remove <keyId>`, `--trust-key list` | quản lý khóa tin cậy (ghi `trusted-keys/`, audit khi runtime chạy lại) |
| `--update-status` | in `last.json` |
| `--self-check --config <file>` | kiểm cấu hình, mở chỉ đọc cơ sở dữ liệu, chạy validator trên project đang chạy; không mở cổng, không ghi; thoát 0 hay mã lỗi (dùng bởi `mat-updater` ở bước S5) |

`--check-data` (T069, 2026-10-17): `mat-runtime --check-data [--json] [--config <file>] [--data-dir <dir>] [--budget-s <1..300, mặc định 25>]`; thoát 0 nguyên vẹn, 1 chỉ có cảnh báo phục hồi được, 2 có mục hỏng, 3 sai tham số hoặc cấu hình. JSON: `{"schema":"mat-check-data/1","result":"ok|warning|damaged","exitCode":0|1|2,"durationMs":N,"checks":[{"name","status":"ok|warning|damaged|missing","detail"}]}` với `name` lần lượt `history.db`, `audit.db`, `alarm.db`, `project`, `retain`, `pulse.journal`, `logic-state`. Không tạo tệp: DB không có `-shm` mở `immutable` (chỉ tệp chính; `-wal` còn khung là `warning`), có `-shm` mở `mode=ro`. Kiểm hết thời gian (`--budget-s`) là `warning` "chưa kiểm hết", không bao giờ `ok`. `project` có thao tác dở trong `state.json` là `warning`. Chi tiết ở `server/cli/check_data.hpp`.

Tệp thực thi riêng (không phải `mat-runtime`):

| Tệp | Việc |
|---|---|
| `mat-update-verify <pkg|SHA256SUMS> [--sig <file>] [--keys <dir>] [--json]` | kiểm phong bì hoặc chữ ký của `SHA256SUMS`; mã thoát 0 hợp lệ, 3 chữ ký sai, 4 khóa lạ, 5 định dạng sai |
| `mat-updater` | thực hiện cập nhật; chỉ chạy bởi systemd (`mat-updater.service`) |

## 8. Mã lỗi mới (đủ để sinh `docs/user/error-codes.md`)

`HOST_NOT_ALLOWED` (421), `LOGIN_BUSY` (429), `UNLOCK_REQUEST_REFUSED` (audit, rà soát bảo mật 011 L2), `PULSE_JOURNAL_FAILED` (FAILED), `PULSE_STUCK` (cảnh báo), `PERSIST_FAILED`, `E_PACKAGE_EXTRA_FILE`, `UPDATE_DISABLED`, `UPDATE_PACKAGE_INVALID`, `UPDATE_SIGNATURE_INVALID`, `UPDATE_KEY_UNKNOWN`, `UPDATE_DOWNGRADE`, `UPDATE_PROJECT_INCOMPATIBLE`, `UPDATE_TOO_LARGE`, `UPDATE_ARCH_MISMATCH`, `UPDATER_MANUAL_ONLY`, `INSUFFICIENT_SPACE`, `UPDATE_RECEIVE_ABORTED`, `REAUTH_FAILED`, `OWNED_BY_LOGIC`, `LOGIC_ENABLE_ROOT_ONLY`, `E_LOGIC_*` (contract logic-engine §11), `E_TEMPLATE_TAG_REF`, `E_POPUP_ARGS`, `E_TEMPLATE_PARAM`.
