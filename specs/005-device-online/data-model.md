# Data Model: Làm việc với thiết bị từ Studio

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Research**: [research.md](research.md)

Feature này không đổi schema project (`schemas/*.schema.json` giữ 0.1). Thêm:

- trạng thái trên thiết bị: chứng chỉ, tài khoản, phiên, audit, kho project, thao tác nạp xuống;
- trạng thái trong Studio: thiết bị đã dùng, kết quả tìm, phiên Online, so sánh;
- định dạng gói `.matscada` (chi tiết byte ở [contracts/matscada-package.md](contracts/matscada-package.md)).

Thời điểm ghi dạng ms UTC (`…Ms`) hoặc ISO 8601 UTC (`…At`). Đồng hồ đơn điệu là `CLOCK_BOOTTIME`, chỉ dùng trong bộ nhớ.

**Thuật ngữ** (theo cách gọi của PLC):
- **Nạp xuống** (download, `deploy`): Studio gửi project xuống thiết bị.
- **Đọc lên** (upload, `upload`, lệnh `online.upload`): Studio lấy project đang chạy từ thiết bị về.
- Bước thiết bị nhận gói trong lúc nạp xuống tên là `receive`, không gọi là upload. Sự kiện tiến trình gửi của Studio tên là `send`.
- Chốt 2026-10-11 (analyze F1, người dùng giao toàn quyền quyết định), trước khi đóng băng API thiết bị 1.0.0.

## 1. Bản ghi tìm thấy (`DiscoveredDevice`, Studio, chỉ sống trong hộp thoại)

| Trường | Kiểu | Nguồn, ràng buộc |
|---|---|---|
| `iface` | chỉ số card | card đã gửi gói hỏi |
| `ip` | IPv4 | **địa chỉ nguồn UDP** (không lấy trường `ip` của JSON) |
| `deviceId` | UUID | thiết bị sinh ở lần chạy đầu (`<dataDir>/device-id`) |
| `name`, `model` | chuỗi ≤ 32 | `deviceName`, `deviceModel` của `runtime.json` |
| `mac` | `AA:BB:CC:DD:EE:FF` | MAC của card thiết bị nhận gói hỏi |
| `prefix` | 0–32 | prefix của card đó |
| `runtime`, `api` | SemVer | phiên bản runtime, phiên bản API thiết bị |
| `status` | `running` \| `no-project` \| `project-error` \| `activating` | |
| `project` | `{ id, name?, version, digest }` hoặc `null` | `name` có thể bị bỏ khi thiếu chỗ (`truncated`) |
| `httpsPort`, `httpPort` | 0–65535 | `httpsPort = 0`: thiết bị tắt HTTPS |
| `fingerprint` | 64 hex | **chỉ để tham khảo**: không dùng để ghim (R6) |
| `receivedAt` | ms | |

- **Gộp:** theo (`deviceId`, `ip`). Hai thiết bị trùng tên vẫn tách được nhờ MAC và IP (Edge case).
- **Sắp xếp:** theo tên, rồi IP.

## 2. Thiết bị đã dùng (`KnownDevice`, Rust, `devices.json`)

File `%APPDATA%\vn.com.atpro.matstudio\devices.json`, do Rust giữ, như `recent.json` của 004. Giao diện chỉ thấy bản sao, không đọc/ghi file trực tiếp.

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | UUID | Studio sinh khi thêm; giao diện gọi lệnh theo `id` |
| `name` | chuỗi ≤ 64 | thêm theo địa chỉ thì mặc định là `host`; lần đọc `device/identity` thành công đầu tiên qua kết nối đã ghim (`device_login`, `device_get` identity) đổi thành tên thiết bị báo (chỉ khi tên vẫn là mặc định). Người dùng sửa được; tên đã sửa thì giữ. Dò chứng chỉ không đổi tên |
| `host` | IPv4 hoặc tên máy | |
| `httpsPort` | 1–65535 | mặc định 8443 |
| `httpPort` | 1–65535 | mặc định 8080; trang xem và chế độ theo dõi chỉ đọc |
| `deviceId`, `mac` | | từ gói tìm hoặc `device/identity`; có thể trống |
| `pin` | `{ fingerprint, pinnedAt }` hoặc `null` | fingerprint 64 hex chữ thường |
| `lastUser` | chuỗi | tài khoản dùng gần nhất. **Không có mật khẩu, không có token** |
| `lastSeenAt`, `lastRuntime` | | cache để hiện danh sách |

- Tối đa 64 thiết bị. File hỏng: coi như rỗng, ghi đè ở lần lưu sau. Ghim mất thì lần sau phải xác nhận lại fingerprint (an toàn).
- Ghi atomic: file tạm, `rename`.

**Thiết bị gắn với project** (thêm ở T085a, 2026-10-11):
- Studio lưu `id` của thiết bị đã lưu theo thư mục project, trong localStorage, khóa `mat-studio.projectDevices`: mới nhất trước, tối đa 64, `id` phải là UUID. **Không** ghi vào file project, vì địa chỉ thiết bị là thông tin của máy kỹ sư, không phải của project.
- Bấm Online một dòng trong hộp thoại Thiết bị trong mạng (nút, nhấp đúp, Enter) hoặc Thêm theo địa chỉ thì gắn thiết bị đó với project.
- Ctrl+K: đã gắn thì Online thiết bị đó; chưa gắn thì mở hộp thoại.
- Bỏ thiết bị khỏi danh sách đã lưu thì gỡ gắn. Thiết bị gắn mà không còn trong `devices.json` thì Ctrl+K gỡ gắn rồi mở hộp thoại.
- **Runtime cũ trên cổng HTTP lạ (T085b):** `probing ──not-tls──▶` Rust hỏi `system/info` bằng HTTP trên cùng cổng `──runtime < 0.4.0──▶` đọc lại thiết bị đã lưu `──▶` theo dõi chỉ đọc (`runtime-old`).

**Trạng thái ghim:**

```text
chưa ghim ──dò (device_probe)──▶ đã thấy fingerprint F ──người dùng xác nhận──▶ đã ghim F
đã ghim F ──bắt tay thấy F──▶ khớp (đi tiếp)
đã ghim F ──bắt tay thấy G ≠ F──▶ không khớp: chặn, hiện F và G
không khớp ──người dùng xác nhận rõ "gỡ ghim"──▶ chưa ghim ──dò──▶ … (lại xác nhận G)
```

Rust chỉ ghim đúng fingerprint vừa dò được ở lần `device_probe` gần nhất của thiết bị đó.

## 3. Chứng chỉ thiết bị (`DeviceCertificate`, thiết bị)

| Trường | Giá trị |
|---|---|
| File | `<dataDir>/tls/server.pem`: khóa riêng rồi chứng chỉ (PEM). Chủ sở hữu `matscada`, `0600`; thư mục `0700` |
| Khóa | ECDSA P-256, sinh bằng Mbed TLS |
| Chứng chỉ | X.509 v3 tự ký; CN `mAT <deviceName>`; SAN DNS = hostname; serial 16 byte ngẫu nhiên; hạn 2000-01-01 → 9999-12-31 |
| Fingerprint | SHA-256 của DER chứng chỉ; in `AB:CD:…` (95 ký tự), truyền dạng 64 hex chữ thường |
| `createdAt` | lấy từ thời điểm tạo file (thông tin, không dùng để kiểm) |

```text
chưa có file ──runtime khởi động──▶ sinh, ghi (tạm + fsync + rename) ──▶ hợp lệ
hợp lệ ──--regen-cert (root, audit)──▶ hợp lệ (fingerprint mới) ──▶ restart dịch vụ
file hỏng / sai quyền ──runtime khởi động──▶ HTTPS tắt, system/info.device.https = "cert-error" (không tự sinh lại)
```

## 4. Tài khoản (`Account`, `/etc/mat-runtime/users.json`)

`root:matscada`, `0640`. Chỉ lệnh trên thiết bị ghi; runtime đọc.

```json
{
  "schemaVersion": "1.0.0",
  "users": [
    {
      "name": "admin",
      "role": "administrator",
      "enabled": true,
      "passwordHash": "$argon2id$v=19$m=19456,t=2,p=1$<salt b64>$<hash b64>",
      "rev": 1,
      "unlockSeq": 0,
      "createdAt": "2026-10-20T03:00:00Z",
      "updatedAt": "2026-10-20T03:00:00Z"
    }
  ]
}
```

| Trường | Ràng buộc |
|---|---|
| `name` | `^[a-z][a-z0-9._-]{2,31}$`, duy nhất |
| `role` | `viewer` \| `operator` \| `engineer` \| `administrator` |
| `enabled` | `false` = tắt |
| `passwordHash` | chuỗi PHC Argon2id; salt 16 byte; tham số theo R7 |
| `rev` | tăng khi đổi mật khẩu, role, `enabled`. Runtime thấy đổi thì hủy phiên của tài khoản và xóa khóa tạm |
| `unlockSeq` | tăng khi `--user-unlock`. Runtime thấy đổi thì xóa khóa tạm |

- Tối đa 64 tài khoản; file ≤ 256 KB.
- File có quyền cho người khác (`mode & 0007`) hoặc không đọc được: runtime coi như không có tài khoản, mọi đăng nhập bị từ chối, log lỗi.
- Mật khẩu 15–128 ký tự (UTF-8, ≤ 512 byte), khác tên tài khoản; chỉ đi qua TTY hoặc stdin.

**Trạng thái của tài khoản** (spec: bật, tắt, tạm khóa):

```text
bật ──--user-disable──▶ tắt ──--user-enable──▶ bật
bật ──5 lần sai liên tiếp──▶ tạm khóa (5 phút, trong bộ nhớ)
tạm khóa ──hết 5 phút / --user-unlock / rev đổi──▶ bật
```

## 5. Phiên (`Session`) và bộ đếm sai (`LoginGuard`), trong bộ nhớ của runtime

**Phiên:**

| Trường | Ghi chú |
|---|---|
| `tokenHash` | SHA-256 của token (`mats_` + 43 ký tự base64url, 32 byte ngẫu nhiên). Token gốc không được lưu |
| `user` | tên tài khoản; role đọc lại từ `users.json` ở mỗi request |
| `rev` | `rev` của tài khoản lúc đăng nhập; khác `rev` hiện tại thì phiên vô hiệu |
| `source` | IP nguồn lúc đăng nhập; request từ IP khác bị từ chối |
| `createdMono`, `lastMono` | `CLOCK_BOOTTIME` ms |

- Hết hạn khi `now − lastMono > 30 phút` hoặc `now − createdMono > 12 giờ`.
- Tối đa 32 phiên; đầy thì bỏ phiên có `lastMono` nhỏ nhất.
- `lastMono` chỉ cập nhật ở request do người dùng thao tác: mọi `POST`, và `GET` của `versions`, `manifest`, `package`, `audit`. Request hỏi định kỳ (`diagnostics`, `auth/session`, `deployments/{opId}`, `operation`) không làm mới hạn, để phiên vẫn hết hạn khi kỹ sư rời máy dù Studio còn mở (FR-012).

**Bộ đếm sai:**

| Bảng | Khóa | Giá trị |
|---|---|---|
| theo tài khoản | tên (kể cả tên không tồn tại), LRU 256 | `failures`, `lockedUntilMono`, `unlockSeq` đã thấy |
| theo nguồn | IP, LRU 256 | `failures`, `lockedUntilMono` |

- Sai thì `failures += 1`; tới 5 thì `lockedUntilMono = now + 5 phút`, `failures = 0`.
- Đăng nhập đúng: xóa bộ đếm của tài khoản và của IP đó.
- Đang khóa (theo tài khoản hoặc theo IP): không kiểm mật khẩu, trả `AUTH_LOCKED`, `retryAfterS` = thời gian còn lại dài nhất.

**Đi qua `execv`** (R9, R13): `/run/mat-runtime/auth-state.json` (`0600`) chứa danh sách phiên (chỉ `tokenHash`) và hai bảng đếm. Ghi ngay trước `execv`; tiến trình mới đọc rồi xóa. File hỏng hoặc thiếu: bắt đầu rỗng.

## 6. Phiên thiết bị trong Studio (`DeviceSession`, mở rộng của 004 §9)

Thêm trường:

| Trường | Ghi chú |
|---|---|
| `mode` | `monitor` (theo địa chỉ, HTTP, chỉ đọc như 004) \| `online` (theo `deviceId`, HTTPS, đã đăng nhập) |
| `deviceId` | `KnownDevice.id` khi `online` |
| `auth` | `{ user, role, idleTimeoutS, maxLifetimeS }` hoặc `null` |
| `features` | nguyên mảng `features` của `device/identity`: `auth`, `deploy`, `upload`, `restore`, `diagnostics`, `audit` (tên và tập giá trị giống contract device-api §3) |
| `compare` | kết quả so sánh mới nhất (§11) hoặc `null` |

Trạng thái của 004 giữ nguyên (`idle`, `connecting`, `monitoring`, `error`, `lost`, `full`, `incompatible`). Thêm các bước trước khi vào `connecting` ở chế độ `online`:

```text
idle ──Online (chọn thiết bị)──▶ probing ──chưa ghim──▶ pin-confirm ──xác nhận──▶ login
                                   │ ghim khớp ─────────────────────────────────▶ login
                                   │ ghim không khớp ──▶ error (cert-mismatch: hiện F và G)
                                   │ cổng HTTPS không trả lời, HTTP là runtime < 0.4.0 ──▶ connecting (mode = monitor, báo "runtime cần cập nhật")
login ──đúng──▶ connecting (wss + system/info qua HTTPS) ──▶ monitoring (viền cam, thanh trạng thái có tài khoản và role)
login ──AUTH_FAILED / AUTH_LOCKED──▶ login (hiện lý do, retryAfterS)
monitoring ──401 SESSION_EXPIRED──▶ relogin (hộp thoại đăng nhập; không đụng tài liệu đang sửa) ──▶ monitoring
monitoring ──401 SESSION_INVALID (tài khoản bị tắt, đổi IP)──▶ idle (Offline, hiện lý do)
monitoring ──cert-mismatch khi kết nối lại──▶ error
```

Mã lỗi mới: `cert-unpinned`, `cert-mismatch`, `tls`, `auth-required`, `session-expired`, `session-invalid`, `forbidden`, `runtime-old`, `https-unreachable`.

## 7. Bản ghi audit (`AuditRecord`, `<dataDir>/audit.db`)

SQLite WAL, `synchronous=FULL` (ngoại lệ, R11), `cache_size` 256 KB.

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | tăng dần; phân trang theo `id` |
| `ts_ms` | INTEGER | UTC ms |
| `clock_ok` | INTEGER 0/1 | 0 = giờ chưa đồng bộ (spec: cờ "giờ chưa đồng bộ") |
| `user` | TEXT NULL | tài khoản (hoặc tên đã gõ khi đăng nhập sai); `NULL` khi chưa đăng nhập |
| `role` | TEXT NULL | role lúc ghi |
| `source` | TEXT | `IP:cổng`; `cli`; `system` |
| `channel` | TEXT | `https` \| `http` \| `cli` \| `system` |
| `action` | TEXT | danh mục dưới |
| `target` | TEXT NULL | đối tượng: digest, `seq`, tên tài khoản, đường dẫn API |
| `result` | TEXT | `ok` \| `failed` \| `denied` \| `started` \| `rolled-back` \| `interrupted` |
| `code` | TEXT NULL | mã lỗi (`AUTH_FAILED`, `E_PKG_PATH`…) |
| `detail` | TEXT NULL | JSON ≤ 1 KB, ví dụ `{"from":"sha256:…","to":"sha256:…","opId":"…"}` |
| `count` | INTEGER | số lần gộp (≥ 1) |

Chỉ mục: `ts_ms`, `(user, ts_ms)`, `(action, ts_ms)`.

**Danh mục `action`:**

| Nhóm | `action` | Gộp 60 s |
|---|---|---|
| Đăng nhập | `auth.login` (`ok`/`failed`), `auth.locked` (từ chối vì đang khóa), `auth.lockout` (vừa bị khóa), `auth.logout`, `auth.session-revoked` | `failed`, `auth.locked`: có |
| Truy cập | `access.denied` (`AUTH_REQUIRED`, `SESSION_EXPIRED`, `SESSION_INVALID`, `FORBIDDEN`, `HTTPS_REQUIRED`) | có |
| Project | `project.deploy` (`started` → `ok`/`failed`/`rolled-back`/`interrupted`), `project.restore` (như trên), `project.read` (đọc lên), `project.adopt` (nhận project cài theo cách cũ) | không |
| Thiết bị | `cert.generate`, `cert.regenerate`, `audit.read`, `audit.export`, `audit.purged`, `audit.suppressed` | không |
| Tài khoản | `account.create`, `account.password`, `account.role`, `account.disable`, `account.enable`, `account.unlock` | không |

- Không bao giờ ghi mật khẩu, token, `passwordHash`.
- Giữ 365 ngày (`auditRetentionDays`); trần 64 MiB (`auditMaxMB`).
- Không ghi được bản `started` của thao tác thay đổi, hay bản `auth.login ok`: từ chối thao tác (`AUDIT_UNAVAILABLE`).

## 8. Gói project (`Package`) và manifest

**Manifest** `matscada.json`, entry đầu của gói:

| Trường | Ràng buộc |
|---|---|
| `format` | `"matscada-package"` |
| `formatVersion` | SemVer; bản này `1.0.0`. Khác MAJOR thì từ chối (`E_PKG_FORMAT_VERSION`) |
| `project.projectId`, `projectName`, `projectVersion`, `minRuntimeVersion` | phải bằng giá trị trong `project.json` của gói (`E_PKG_IDENTITY`) |
| `createdAt` | ISO 8601 UTC; chỉ để hiển thị |
| `generator` | `{ name, version }`, ví dụ `mAT Studio 0.2.0`, `mat-runtime 0.4.0` |
| `files[]` | `{ path, size, sha256 }`; sắp theo `path` (byte UTF-8); không trùng; không chứa `matscada.json` |
| `digest` | `sha256:<64 hex>`, tính theo [contract](contracts/matscada-package.md) §4 |

**Tập file của project** (`projectFiles`): `project.json`, `tagFile`, `loggingFile` (nếu có), và mỗi màn hình gồm `screens/<id>.screen.json`, `bindingFile`, `svgFile`. Studio đóng gói đúng tập này; thiết bị tự đóng gói project cũ cũng theo tập này. Vector chung TS và C++.

**Gói trong Studio** (`PackageInfo`, Rust, thư mục tạm của ứng dụng):

| Trường | Ghi chú |
|---|---|
| `packageId` | UUID; giao diện chỉ thấy id, không thấy đường dẫn |
| `origin` | `built` (đóng gói từ project đang mở) \| `fetched` (đọc lên từ thiết bị) |
| `deviceId`, `seq` | khi `fetched` |
| `manifest`, `digest`, `size` | |

Tối đa 4 gói; xóa khi đóng Studio hoặc khi `package_discard`.

## 9. Kho project trên thiết bị (`ProjectStore`)

```text
<dataDir>/projects/                  matscada, 0700
├── state.json                       nguồn sự thật duy nhất
├── v/<seq>/
│   ├── package.matscada             đúng byte đã nhận (đọc lên trả file này)
│   ├── project/                     đã giải nén, đã kiểm (runtime chạy thư mục này)
│   └── meta.json                    ghi sau cùng: bản đầy đủ
├── staging/<opId>/                  vùng tạm, dọn khi khởi động
└── ops/<opId>.json                  20 thao tác gần nhất
```

**`state.json`:**

```json
{
  "schemaVersion": "1.0.0",
  "active": 7,
  "nextSeq": 8,
  "versions": [
    { "seq": 7, "digest": "sha256:…", "projectId": "tank-demo", "projectName": "Tank demo",
      "projectVersion": "1.3.0", "minRuntimeVersion": "0.4.0", "size": 41234,
      "activatedAt": "2026-10-20T03:12:00Z", "clockOk": true,
      "deployedBy": "kysu1", "deployedFrom": "192.168.1.20", "source": "studio" },
    { "seq": 6, "…": "…" }
  ],
  "pending": null
}
```

| Trường | Ghi chú |
|---|---|
| `active` | `seq` đang chạy; `null` khi chưa có project trong kho |
| `versions[]` | bản đang chạy cộng tối đa `projectBackups` (mặc định 3) bản dự phòng, mới nhất trước. `source`: `studio` \| `runtime-package` \| `restore` |
| `pending` | `null`, hoặc `{ opId, kind, from, to, phase, bootAttempts, user, source, startedAt }`; `phase`: `activating` \| `health` \| `rolling-back` |

- Một bản `v/<seq>` không có `meta.json` là bản dở: xóa khi khởi động.
- Dọn bản cũ (vượt `projectBackups`) chỉ sau khi đã commit.
- Đổi `state.json`: ghi file tạm, `fsync`, `rename`, `fsync` thư mục.

**Quyết định lúc khởi động** (đọc `state.json`):

| Tình huống | Làm |
|---|---|
| Không có `state.json`, kho trống, `projectDir` có project hợp lệ | nhận project cũ thành `v/1`, `source = runtime-package`, audit `project.adopt` |
| Không có `state.json`, `projectDir` lỗi hoặc trống | chạy `projectDir` như 0.3.0 (không kích hoạt nếu lỗi); đọc lên trả `NO_PROJECT_PACKAGE` |
| `pending = null` | chạy `v/<active>` |
| `pending.phase = activating` hoặc `health`, `bootAttempts < 2` | `bootAttempts += 1` (ghi), chạy `v/<to>`, kiểm sức khỏe |
| `pending.phase = activating` hoặc `health`, `bootAttempts ≥ 2` | rollback: `active = from`, `phase = rolling-back`, chạy `v/<from>` |
| `pending.phase = rolling-back` | chạy `v/<from>`; đạt thì `pending = null`, thao tác kết thúc `rolled-back` |

## 10. Thao tác nạp xuống, khôi phục (`DeployOperation`)

| Trường | Ghi chú |
|---|---|
| `opId` | UUID v4 |
| `kind` | `deploy` \| `restore` |
| `user`, `role`, `source` | người bắt đầu; kết quả ghi audit dưới người này kể cả khi phiên đã hết hạn |
| `startedAt`, `endedAt`, `clockOk` | |
| `from` | `{ seq, digest, projectVersion }` của bản đang chạy lúc bắt đầu (hoặc `null`) |
| `to` | `{ seq?, digest, projectId, projectVersion }` |
| `steps[]` | `{ id, state, startedAt, endedAt, code?, message?, issues? }`; `state`: `pending` \| `running` \| `ok` \| `failed` \| `skipped` |
| `result` | `running` \| `committed` \| `failed` \| `rolled-back` \| `interrupted` |
| `error` | `{ code, message, issues? }`; `issues` theo định dạng của bộ kiểm tra (`code`, `file`, `path`, `message`) |
| `clientsNotified` | số phiên live được báo tải lại (đóng mã 1012) |

**Các bước** (`id`): `receive`, `verify-package`, `validate`, `backup`, `activate`, `health`, cộng `rollback` khi cần. `restore` bỏ qua `receive` và `verify-package` (`skipped`).

```text
receive ─▶ verify-package ─▶ validate ─▶ backup ─▶ activate ─▶ health ─▶ committed
   └───────── lỗi ở 4 bước đầu ──────────┘                       │ lỗi, quá 15 s, chết 2 lần
                    ▼                                             ▼
                 failed (bản cũ chạy tiếp, không đổi gì)   rollback ─▶ rolled-back
mất điện trước activate ──khởi động──▶ interrupted (dọn vùng tạm, bản cũ chạy)
```

- **Khóa:** chỉ một thao tác ở trạng thái `running`. Thao tác thứ hai nhận `DEVICE_BUSY` kèm `{ opId, kind, user, source, since }`.
- **Hết hạn vùng tạm:** `receive` không xong trong 10 phút (mạng rớt) thì hủy, dọn vùng tạm, nhả khóa.

## 11. Kết quả so sánh (`CompareResult`, `packages/project-schema`)

```ts
interface CompareResult {
  localDigest: string;
  deviceDigest: string;
  same: boolean;                // hai digest bằng nhau
  files: FileDiff[];            // { path, status, localSha256?, deviceSha256? }
  objects: ObjectDiff[];
}
type DiffStatus = '=' | '≠' | '+' | '-';   // + chỉ trên máy, - chỉ trên thiết bị
interface ObjectDiff {
  kind: 'project' | 'logging-settings' | 'tag' | 'logging-group' | 'logging-connection' | 'screen' | 'svg' | 'binding';
  // 'logging-settings' (thêm khi cài T119): phần chung của file lưu trữ, ví dụ timeZone, khóa 'logging'
  key: string;                  // ví dụ 'TANK01.LEVEL', 'overview', 'overview/pump-1/b1'
  file: string;                 // file chứa đối tượng
  status: DiffStatus;
  fields: FieldDiff[];          // chỉ khi '≠': { path (JSON pointer), local?, device? }
}
```

- Đối tượng `=` vẫn có trong danh sách, để bảng và cây hiện đủ.
- **So theo khóa** (chốt khi cài T119):
  - chỉ đổi thứ tự trong file thì đối tượng vẫn `=` dù file `≠`;
  - file không đọc được hoặc sai dạng thì có cờ `unreadable`, và mọi đối tượng thuộc file đó bị bỏ ở cả hai bên, để không báo `+`/`-` sai;
  - `fields[].path` là JSON pointer tính từ đối tượng, dùng khóa thay chỉ số;
  - khóa của binding là `<màn hình>/<elementUid>/<binding.id>`.
- **Áp phần chọn** (`applyFromDevice(docs, selection)`):
  - kind `project`, `tag`: sửa đối tượng trong `project.json`, `tags.json`;
  - kind khác: thay cả file.

  Kết quả là một bước sửa của lịch sử hoàn tác (004 §4).

## 12. Chẩn đoán (`Diagnostics`)

Trả bởi `GET /api/v1/diagnostics` ([device-api.md](contracts/device-api.md) §6). Thiết bị giữ trong bộ nhớ 13 mẫu CPU (mỗi 5 s) để tính trung bình 1 phút. Studio chỉ giữ bản mới nhất.

## 13. Hộp thoại Nạp xuống (`DownloadFlow`, Studio)

```text
closed ──Ctrl+L──▶ preparing (lưu? → đóng gói → so sánh với thiết bị) ──▶ preview
preview ──có lỗi──▶ preview (nút Nạp xuống khóa)
preview ──có cảnh báo, chưa đánh dấu "đã đọc"──▶ preview (khóa)
preview ──Nạp xuống──▶ running (bước theo DeployOperation) ──▶ result (committed | failed | rolled-back)
result ──Khôi phục bản trước──▶ running (kind = restore)
```

**Các dòng xem trước** (FR-020):

| Dòng | Nguồn | Khóa nạp khi |
|---|---|---|
| Kiểm tra project | bộ kiểm tra TS | có lỗi |
| Tương thích runtime | `minRuntimeVersion` so với `system/info.runtimeVersion` | project cần runtime mới hơn |
| Thay project đang chạy | `system/info.project`, `CompareResult` (mở So sánh được) | |
| Client sẽ tải lại | `system/info.clients` trừ phiên của chính Studio | |
| Dung lượng | kích thước gói / 50 MiB; chỗ trống của thiết bị | gói > 50 MiB, hoặc thiết bị thiếu chỗ |
| Lưu trữ dữ liệu | `ObjectDiff` kind `logging-*`: nhóm thêm, bớt, đổi; cột mới | |
| Thiết bị | phiên còn hạn, role ≥ engineer, thiết bị không bận | thiếu một trong ba |

Còn thay đổi chưa lưu: hỏi "Lưu rồi nạp xuống" hoặc Hủy. Gói luôn đóng từ file trên đĩa, sau khi so SHA-256 với lần đọc của 004 (lệch thì kiểm lại).
