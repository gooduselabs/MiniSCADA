# Contract: lệnh Rust ↔ giao diện Studio (feature 005)

**Feature**: [spec.md](../spec.md) · **Data model**: [data-model.md](../data-model.md) · **Research**: R3, R6, R12, R15 · Lệnh của 004: [004/contracts/tauri-commands.md](../../004-studio-shell/contracts/tauri-commands.md) (giữ nguyên)

## 1. Quy ước

- Như 004: gọi bằng `invoke` của Tauri 2; tham số Rust `snake_case` thành khóa JS `camelCase`.
- **Lỗi:** chuỗi kebab-case (`"auth-failed"`), hoặc đối tượng một khóa khi có dữ liệu kèm (`{ "locked": 287 }`, `{ "io": "…" }`).
- **Luồng dữ liệu:** dùng `Channel` của Tauri (`import { Channel } from '@tauri-apps/api/core'`). Tin đến đúng thứ tự gửi.
- **Giao diện chỉ gọi thiết bị theo `id`** của thiết bị đã lưu. Riêng chế độ theo dõi chỉ đọc (như 004) gọi theo địa chỉ, và chỉ được hai đường dẫn cố định.
- **Token phiên và mật khẩu không bao giờ quay lại giao diện.** Mật khẩu chỉ đi vào ở `device_login`.
- **Đường dẫn file:** giao diện không gửi đường dẫn tuyệt đối (quy tắc của 004). Gói được gọi bằng `packageId`.
- **CSP** (`tauri.conf.json`): `connect-src 'self' ipc: http://ipc.localhost`. Bỏ `http: ws:`; WebView không tự kết nối tới thiết bị nữa.

## 2. Card mạng và tìm thiết bị

### `net_interfaces() → NetInterface[]`

`{ index, name, address, prefix, broadcast: string | null, canBroadcast: boolean, hint: "vpn" | null }`

- `canBroadcast = false` khi prefix ≥ 31 hoặc không có địa chỉ broadcast.
- `hint = "vpn"` khi tên card có dạng VPN thường gặp (WireGuard, TAP, OpenVPN, Tailscale, ZeroTier…). Chỉ để hiện gợi ý "Thêm theo địa chỉ".

### `discover_run({ interfaces: number[] | null, onEvent: Channel<DiscoverEvent> }) → DiscoverSummary`

- `interfaces = null`: mọi card có `canBroadcast`.
- Sự kiện: `{ kind: "found", device: DiscoveredDevice }` ([data-model.md](../data-model.md) §1), đẩy ngay khi nhận.
- Kết quả, khoảng 2,5 s sau khi gọi: `{ scanned: number, found: number, failed: [{ index, reason }] }`. `reason`: `bind`, `send`.
- Lỗi: `"busy"` khi một lượt quét khác đang chạy.

## 3. Thiết bị đã lưu (`devices.json`)

| Lệnh | Tham số JS | Kết quả | Lỗi |
|---|---|---|---|
| `devices_list` | — | `KnownDevice[]` | không (file hỏng thì `[]`) |
| `device_add` | `{ host, httpsPort?, httpPort?, name?, fromDiscovery?: { deviceId, mac, fingerprint } }` | `KnownDevice` (đã có `host:httpsPort` thì trả mục cũ) | `"bad-address"`, `"too-many"` (> 64) |
| `device_update` | `{ id, name?, host?, httpsPort?, httpPort? }` | `KnownDevice` | `"no-such-device"`, `"bad-address"` |
| `device_forget` | `{ id }` | `null` | `"no-such-device"` |

- `host`: IPv4 hoặc tên máy theo luật `normalizeDevice` của 004.
- Cổng mặc định: HTTPS 8443, HTTP 8080.
- Đổi `host` không xóa ghim: ghim gắn với chứng chỉ, không gắn với địa chỉ.

## 4. Chứng chỉ và ghim

### `device_probe({ id }) → ProbeResult`

`{ fingerprint: string, pinned: string | null, state: "unpinned" | "match" | "mismatch", discovered: string | null }`

- Bắt tay TLS (kiểm cả chữ ký bắt tay), lấy SHA-256 của chứng chỉ, đóng ngay. Không gửi request HTTP nào.
- `discovered`: fingerprint của gói tìm thiết bị gần nhất, nếu có. Khác `fingerprint` thì giao diện cảnh báo đỏ.
- Lỗi: `"no-such-device"`, `"unreachable"`, `"timeout"` (kết nối 3 s, bắt tay 5 s), `"not-tls"` (cổng trả lời HTTP thường: runtime cũ hoặc sai cổng), `{ "tls": "<chi tiết>" }`.

### `device_pin({ id, fingerprint }) → KnownDevice`

Chỉ ghim khi `fingerprint` đúng bằng giá trị của lần `device_probe` gần nhất cho `id`. Lỗi: `"not-observed"`.

### `device_unpin({ id, fingerprint }) → KnownDevice`

`fingerprint` phải bằng ghim hiện tại: giao diện chỉ gọi sau khi người dùng xác nhận rõ (FR-008). Lỗi: `"pin-mismatch"`.

## 5. Phiên đăng nhập

| Lệnh | Tham số JS | Kết quả |
|---|---|---|
| `device_login` | `{ id, user, password }` | `SessionInfo { user, role, idleTimeoutS, maxLifetimeS, identity }` |
| `device_logout` | `{ id }` | `null` (luôn xóa token phía Rust, kể cả khi thiết bị không trả lời) |
| `device_session` | `{ id }` | `SessionInfo` hoặc `null` |

- `identity`: kết quả `GET /api/v1/device/identity`.
- Rust xóa bộ đệm mật khẩu sau khi gửi.

Lỗi của `device_login`:

| Lỗi | Khi |
|---|---|
| `"auth-failed"` | 401 `AUTH_FAILED` |
| `{ "locked": retryAfterS }` | 429 `AUTH_LOCKED` |
| `"auth-busy"` | 429 `AUTH_BUSY` |
| `"audit-unavailable"` | 503 |
| `"setup-required"` | `identity.setupRequired` |
| `"cert-unpinned"` | chưa ghim |
| `{ "cert-mismatch": { "pinned": "…", "seen": "…" } }` | fingerprint đổi |
| `"unreachable"`, `"timeout"` | |

## 6. Gọi API thiết bị

### `device_get({ id, path, query? }) → { status: number, body: unknown }`

Chỉ được các đường dẫn:

- `/api/v1/system/info`, `/api/v1/device/identity`, `/api/v1/auth/session`, `/api/v1/diagnostics`;
- `/api/v1/project/versions`, `/api/v1/project/manifest`, `/api/v1/project/operation`, `/api/v1/project/deployments/<uuid>`;
- `/api/v1/audit`.

`query` là đối tượng khóa → chuỗi; Rust mã hóa.

| Lỗi | Khi |
|---|---|
| `"bad-path"` | ngoài danh sách |
| `"auth-required"`, `"session-expired"`, `"session-invalid"`, `"forbidden"` | 401, 403 tương ứng |
| `{ "cert-mismatch": {…} }`, `"unreachable"`, `"timeout"` | |
| `{ "http": status }` | mã HTTP khác |

401 `SESSION_*` thì Rust bỏ token của thiết bị đó.

### `monitor_get({ address }) → { status, body }`

Chế độ theo dõi chỉ đọc (như 004, FR-035). HTTP thường, chỉ `GET /api/v1/system/info`, timeout 3 s. Lỗi giữ mã của `checkDevice`: `"timeout"`, `"network"`, `"http"`, `"bad-response"`.

## 7. Dữ liệu sống

### `live_open({ target: { id } | { address }, onEvent: Channel<LiveEvent> }) → { liveId }`

- `{ id }`: `wss://host:httpsPort/api/v1/live`, có ghim. Không gửi token: endpoint này công khai (FR-033), và hỏi định kỳ không được làm mới hạn phiên.
- `{ address }`: `ws://…/api/v1/live` (chế độ theo dõi).
- Không gửi header `Origin` (máy chủ chấp nhận client không phải trình duyệt).
- Sự kiện:
  - `{ kind: "open" }`;
  - `{ kind: "message", data: string }`;
  - `{ kind: "close", code: number, reason: string }`. Bắt tay lỗi thì `code` = 1006, `reason` là mã lỗi (`cert-mismatch`, `unreachable`…).

| Lệnh | Tham số JS | Ghi chú |
|---|---|---|
| `live_send` | `{ liveId, text }` | frame text; > 96 KiB thì lỗi `"too-large"` (giới hạn của máy chủ) |
| `live_close` | `{ liveId, code?, reason? }` | mặc định 1000 |

Giao diện bọc ba lệnh này thành `SocketLike` cho `LiveConnection` (`createSocket`); `@mat/live-client` không đổi.

## 8. Gói, nạp xuống, đọc lên

### `package_build({ files: [{ rel, hash }] }) → PackageInfo`

- Đóng gói project đang mở theo [matscada-package.md](matscada-package.md).
- `files`: tập file của project (`projectFiles`) kèm SHA-256 lúc giao diện đọc. Rust đọc lại; hash khác thì lỗi `{ "changed": rel }` (như `project_write` của 004).
- Kết quả: `{ packageId, origin: "built", digest, size, manifest }`.
- Lỗi: `"no-project"`, `"bad-path"`, `{ "too-large": rel }`, `{ "package": "<E_PKG_…>" }`, `{ "io": "…" }`.

### `device_deploy({ id, packageId, baseDigest, onEvent: Channel<DeployEvent> }) → DeployOperation`

- Gửi gói (`POST /api/v1/project/deployments`), rồi hỏi tiến trình mỗi 500 ms tới khi kết thúc.
- Trong lúc thiết bị chạy lại: thử lại tối đa 60 s.
- Sự kiện:
  - `{ kind: "send", sent, total }`;
  - `{ kind: "operation", op }` mỗi khi trạng thái đổi;
  - `{ kind: "restarting" }` khi thiết bị đang chạy lại.
- Kết quả: `DeployOperation` cuối ([data-model.md](../data-model.md) §10).

| Lỗi | Khi |
|---|---|
| `{ "busy": { opId, kind, user, source, since } }` | 409 `DEVICE_BUSY` |
| `"base-changed"` | 409 `BASE_CHANGED`: có người vừa nạp xuống; xem trước lại |
| `"no-space"`, `"too-large"`, `"audit-unavailable"` | 507, 413, 503 |
| `"session-expired"`, `"forbidden"`, `{ "cert-mismatch": {…} }`, `"unreachable"` | trước khi gửi xong |
| `"lost"` | không theo dõi được 60 s sau khi thiết bị chạy lại. Thao tác vẫn có thể đã xong: xem bằng `device_get /api/v1/project/operation` |

### `device_restore({ id, seq, baseDigest, onEvent }) → DeployOperation`

Như `device_deploy`, gọi `POST /api/v1/project/restore`. Lỗi thêm: `"no-such-version"`, `"already-active"`.

### `device_fetch_package({ id, seq? }) → PackageInfo`

- Đọc lên (`GET /api/v1/project/package`). Thiếu `seq` thì lấy bản đang chạy.
- Rust kiểm gói đúng luật như thiết bị; digest phải bằng `X-Mat-Digest`.
- Kết quả: `{ packageId, origin: "fetched", deviceId, seq, digest, size, manifest }`.
- Lỗi: `{ "package": "<E_PKG_…>", "path"?: "…" }`, `"no-project-package"`, `"forbidden"`, `"session-expired"`, `"unreachable"`.

### `package_read({ packageId, rel }) → { text, hash }`

Đọc một file trong gói, cùng định dạng và cùng mã lỗi với `project_read` của 004 (`"missing"`, `"bad-path"`, `"too-large"`, `"bad-utf8"`). Giao diện dựng `ProjectSource` cho bộ nạp dùng chung.

### `package_extract({ packageId }) → PickResult | null`

- "Đọc lên thành project mới" (FR-028): hộp thoại chọn thư mục. Hủy thì `null`.
- Thư mục phải rỗng. Giải nén theo [matscada-package.md](matscada-package.md) §8, rồi đặt làm thư mục project và thêm vào danh sách gần đây (như `project_pick`).
- Lỗi: `"not-empty"`, `{ "package": "<E_PKG_…>" }`, `{ "io": "…" }`.

### `package_discard({ packageId }) → null`

Xóa gói tạm. Rust giữ tối đa 4 gói; xóa hết khi đóng Studio.

## 9. Giao diện TS `DeviceLink`

`apps/studio/src/platform/device-types.ts`. Bản Tauri: `tauri-device.ts`. Bản giả: `mock-device.ts`.

```ts
export interface DeviceLink {
  netInterfaces(): Promise<NetInterface[]>;
  discover(ifaces: number[] | null, onFound: (d: DiscoveredDevice) => void): Promise<DiscoverSummary>;
  devices(): Promise<KnownDevice[]>;
  addDevice(input: AddDeviceInput): Promise<KnownDevice | DeviceError>;
  updateDevice(input: UpdateDeviceInput): Promise<KnownDevice | DeviceError>;
  forgetDevice(id: string): Promise<void>;
  probe(id: string): Promise<ProbeResult | DeviceError>;
  pin(id: string, fingerprint: string): Promise<KnownDevice | DeviceError>;
  unpin(id: string, fingerprint: string): Promise<KnownDevice | DeviceError>;
  login(id: string, user: string, password: string): Promise<SessionInfo | DeviceError>;
  logout(id: string): Promise<void>;
  get(id: string, path: string, query?: Record<string, string>): Promise<ApiResult | DeviceError>;
  monitorGet(address: string): Promise<ApiResult | DeviceError>;
  openLive(target: { id: string } | { address: string }): SocketLike;  // bọc live_open/send/close
  buildPackage(files: { rel: string; hash: string }[]): Promise<PackageInfo | DeviceError>;
  deploy(id: string, packageId: string, baseDigest: string, onEvent: (e: DeployEvent) => void): Promise<DeployOperation | DeviceError>;
  restore(id: string, seq: number, baseDigest: string, onEvent: (e: DeployEvent) => void): Promise<DeployOperation | DeviceError>;
  fetchPackage(id: string, seq?: number): Promise<PackageInfo | DeviceError>;
  readPackageFile(packageId: string, rel: string): Promise<ReadOutcome>;
  extractPackage(packageId: string): Promise<PickResult | null | DeviceError>;
  discardPackage(packageId: string): Promise<void>;
}
```

`DeviceError` = `{ error: string; detail?: unknown }`, chuyển từ lỗi IPC bằng `ipcError` của 004.

## 10. Lớp giả cho e2e

`platform/mock-device.ts` (alias Vite ở chế độ `e2e`, như `mock.ts` của 004). Điều khiển qua `window.__matMock.device`:

- hai thiết bị giả trong LAN, một thiết bị chỉ thêm theo địa chỉ, một thiết bị runtime cũ;
- chứng chỉ giả: chưa ghim, khớp, đổi;
- tài khoản `kysu1` (engineer), `xem1` (viewer), `admin` (administrator); khóa sau 5 lần sai;
- nạp xuống theo từng bước, có cờ gây lỗi ở bước bất kỳ, gây rollback, gây `DEVICE_BUSY`;
- gói đọc lên lấy từ `projects/tank-demo`, có thể sửa một Tag để thử So sánh;
- `addSaved(device)` (T085a): thêm thẳng một thiết bị đã lưu với cổng HTTP tùy ý, để e2e trỏ tới runtime giả nghe ở cổng ngẫu nhiên.

## 11. Capability

Lệnh của ứng dụng không cần quyền thêm trong `capabilities/default.json`. `Channel` thuộc IPC lõi. Không thêm plugin Tauri.

## 12. Quyết định khi cài US1 (2026-10-11)

Phần Rust của US1 (T062–T072) chốt các điểm contract chưa ghi rõ. Người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11. Bản TS (`platform/device-types.ts`, `tauri-device.ts`, `mock-device.ts`) theo đúng mục này.

1. **`NetInterface.index`:**
   - là số thứ tự dòng (0…n) của lần gọi `net_interfaces` gần nhất; danh sách sắp theo (chỉ số card của hệ điều hành, IP), mỗi địa chỉ IPv4 một dòng;
   - `discover_run` quét theo danh sách đó, giữ trong bộ nhớ; `DiscoveredDevice.iface` là số dòng này;
   - hộp thoại gọi `net_interfaces` trước mỗi lượt quét;
   - `hint: "vpn"` bật theo tên card và cả khi hệ điều hành báo card điểm-điểm.
2. **Lỗi theo card khi quét:** card không có broadcast → `send`; chỉ số không còn trong danh sách → `bind`.
3. **Gói trả lời, phía Studio:**
   - sai thì bỏ gói: `id` không phải UUID; `https` không phải số nguyên 0–65535; `v` khác số nguyên 1;
   - `status` lạ giữ nguyên chuỗi (giao diện hiện "không rõ");
   - `project` thiếu `id`, `version` hoặc `digest` → `null`; `project.name` vắng thì bỏ hẳn khóa;
   - `fp` nhận chữ hoa, chuẩn hóa về chữ thường; `mac` sai dạng → `null`; `prefix` > 32 → `null`;
   - `DiscoveredDevice` không có trường `truncated`.
4. **`KnownDevice`:**
   - trường trống là `null`; `pinnedAt`, `lastSeenAt` dạng ISO 8601 UTC;
   - `lastSeenAt` cập nhật khi dò thành công và khi đăng nhập; đăng nhập cập nhật `deviceId`, `lastRuntime` từ `device/identity`;
   - tên mặc định là `host`, bỏ ký tự điều khiển, cắt còn 64 ký tự;
   - **(T085a)** lần đọc `device/identity` thành công qua kết nối đã ghim (`device_login`; `device_get` với đường dẫn identity) đổi tên mặc định thành `identity.name`, làm sạch như tên nhập tay; tên rỗng thì bỏ qua. Tên khác `host` (người dùng đã sửa) thì giữ;
   - `device_get` identity cũng cập nhật `deviceId`, `lastRuntime`. `device_probe` không đổi tên, vì lúc dò chứng chỉ chưa ghim. `device_update` đổi `host` khi tên còn mặc định thì tên theo `host` mới;
   - `fromDiscovery.fingerprint` nhận nhưng bỏ qua: không lưu, không ghim (R6);
   - địa chỉ theo luật `normalizeDevice`, cộng kiểm khứ hồi qua bộ phân tích URL; trùng `host:httpsPort` so không phân biệt hoa thường;
   - `device_update` đổi `host` hoặc `httpsPort` thì bỏ phiên, client và kết quả dò cũ; ghim giữ nguyên.
5. **Ghim:**
   - `device_pin` khi đang ghim fingerprint khác → `pin-mismatch` (phải gỡ ghim trước, FR-008); ghim lại đúng fingerprint cũ thì giữ nguyên;
   - lần dò lỗi xóa kết quả dò cũ;
   - `device_unpin` khi chưa ghim → `pin-mismatch`; gỡ ghim cũng bỏ phiên.
6. **`device_login`:**
   - thứ tự kiểm: `no-such-device` → `cert-unpinned` → lỗi khi gọi `device/identity` → `setup-required` (không gửi mật khẩu) → `user` > 64 byte hoặc mật khẩu > 512 byte thành `auth-failed` mà không gửi;
   - `locked` lấy `retryAfterS`; thiếu thì lấy header `Retry-After`, thiếu nữa thì 300; trần 86 400. 429 với mã lạ → `{ http: 429 }`.
7. **Mã lỗi thêm ngoài bảng §5, §6:**
   - `{ http: <status> }`, `bad-response` (2xx mà thân không phải JSON object), `{ tls: "<thông báo>" }`, `not-tls`;
   - `bad-address`: `monitor_get`/`live_open` nhận địa chỉ sai, hoặc `https://` ở chế độ theo dõi;
   - `closed`: `live_send` vào kết nối đã đóng;
   - `monitor_get` báo lỗi mạng dạng `{ network: "<thông báo của hệ điều hành>" }`, không phải chuỗi trần.
8. **`device_get`:**
   - thiết bị chưa ghim → `cert-unpinned`;
   - 401:
     - `AUTH_REQUIRED` giữ token;
     - `SESSION_EXPIRED`, `SESSION_INVALID` hoặc mã lạ thì bỏ token; mã lạ trả về giao diện là `session-expired`;
   - 403 không phải `FORBIDDEN` → `{ http: 403 }`;
   - lỗi không 2xx khác chỉ còn `{ http }`. **US3 phải thêm** ánh xạ `NO_PROJECT_PACKAGE` cho đường dẫn đọc gói.
9. **`device_session`:** gọi `GET /auth/session` (không làm mới hạn). 401 thì bỏ token, trả `null`. Kết quả là `SessionInfo` lưu lúc đăng nhập.
10. **`device_logout`:** `id` lạ → `null`. Rust bỏ token trước, rồi báo thiết bị với hạn 3 s.
11. **`monitor_get`:** nhận `host`, `host:port`, `http://host:port[/]`. Thân trả về phải là JSON object.
12. **`live_open`:**
    - `id` lạ → `no-such-device`; địa chỉ sai → `bad-address`, trả trực tiếp từ lệnh;
    - thiết bị chưa ghim → sự kiện `close` mã 1006, lý do `cert-unpinned`;
    - bắt tay WebSocket lỗi → `close` 1006, lý do `http`, `unreachable`, `bad-response`, `timeout` hoặc `cert-mismatch`;
    - `liveId` là số (u32, tăng từ 1).
13. **`live_send`, `live_close`:**
    - `live_send` trước khi mở xong thì xếp hàng;
    - `live_close` thay mã ngoài 1000 và 3000–4999 bằng 1000; lý do cắt còn ≤ 123 byte; `id` lạ thì bỏ qua;
    - sau khi đóng, không đẩy tin nào nữa;
    - máy chủ không trả frame đóng trong 3 s thì vẫn báo `close` với mã đã gửi; máy chủ đóng TCP mà không gửi frame đóng → 1006.

## 13. Bổ sung khi cài T085b, T085c, T104a (2026-10-12)

- **§4 `device_probe`:** khi gặp `not-tls`, Rust gửi đúng một request HTTP thường `GET /api/v1/system/info` trên cùng cổng.
  - Thiết bị là runtime < 0.4.0 → lưu cổng đó làm `httpPort` (chỉ khi địa chỉ thiết bị không đổi trong lúc hỏi); luồng Online rơi về theo dõi chỉ đọc kèm `runtime-old`.
  - Ngoại lệ duy nhất của câu "lần dò không gửi request ứng dụng nào": lần dò TLS vẫn không gửi gì; request HTTP chỉ đi sau khi đã biết cổng không phải TLS.
  - So phiên bản lấy `MAJOR.MINOR.PATCH`, bỏ hậu tố `-…`, `+…`. Chuỗi không đủ ba số thì không coi là cũ.
- **§9 `login`:** mật khẩu được chuẩn hóa NFC (`loginPassword()`) trước khi gửi `device_login` (ADR-011).
- **§10 bản giả:**
  - `setHttpPort(name, port)`;
  - `realRuntime(address)`: chỉ địa chỉ đã khai mới được `fetch` ra mạng thật; địa chỉ lạ coi như không có gì nghe, để e2e giữ 0 lỗi console.
