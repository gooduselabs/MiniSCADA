# Contract: lệnh Rust ↔ giao diện Studio (phần của feature 006)

**Feature**: [spec.md](../spec.md) FR-003, FR-004, FR-044–FR-052, FR-055a · **Research**: R3, R19, R22 · Lệnh của 004, 005: [004/contracts/tauri-commands.md](../../004-studio-shell/contracts/tauri-commands.md), [005/contracts/tauri-commands.md](../../005-device-online/contracts/tauri-commands.md) (giữ nguyên, trừ chỗ ghi "đổi" dưới đây)

Quy ước như 005 §1: `invoke` của Tauri 2; lỗi là chuỗi kebab-case hoặc đối tượng một khóa; token và mật khẩu không bao giờ về giao diện; giao diện không gửi đường dẫn tuyệt đối. Không thêm plugin, không thêm capability.

## 1. Dữ liệu sống: `live_open` (đổi)

- `{ id }` (`wss`, có ghim): **gửi kèm `Authorization: Bearer <token>`** khi Rust đang giữ phiên của thiết bị đó. Header đánh dấu `sensitive`. Cách gắn: `url.into_client_request()`, thêm header, rồi `client_async_with_config(request, stream, config)`.
- `{ address }` (`ws`, theo dõi chỉ đọc): không bao giờ gửi token.
- Phiên được làm mới sau khi đăng nhập lại: lần mở kế tiếp dùng token mới. Kết nối đang mở giữ nguyên.
- Sự kiện `close` thêm lý do:
  - mã 4401: `session-ended`. Giao diện chuyển `DeviceSession` sang hỏi đăng nhập lại;
  - bắt tay bị 403 vì lọc nguồn (theo dõi bằng địa chỉ từ ngoài mạng riêng): mã 1006, lý do `viewer-private`.

Thay mục §7 và §12.12 của contract 005 ở điểm "không gửi token". Test T070 của 005 đổi theo: có token khi đã đăng nhập, không có khi chưa đăng nhập hoặc theo dõi bằng địa chỉ.

## 2. `device_get` (đổi: thêm đường dẫn)

Thêm vào danh sách đường dẫn cho phép:

| Đường dẫn | Dùng cho |
|---|---|
| `/api/v1/projects/active` | định nghĩa Tag trên BL335 cho hộp xác nhận ghi (FR-050) |
| `/api/v1/tags/write/<uuid>`, `/api/v1/tags/write` (query `ids`) | kết quả ghi |
| `/api/v1/drivers/diagnostics` | Chẩn đoán driver |
| `/api/v1/serial/ports` (query `probe`) | danh sách cổng của kênh RTU |

`/api/v1/audit` nhận thêm khóa query `target`.

**Lỗi thêm:**

| Lỗi | Khi |
|---|---|
| `"no-such-request"` | 404 `NO_SUCH_REQUEST` |
| `"viewer-private"` | 403 `SOURCE_NOT_ALLOWED` (chỉ xảy ra khi chưa đăng nhập) |
| `"viewer-off"` | 403 `VIEWER_OFF` |

## 3. `device_post({ id, path, body }) → { status: number, body: unknown }` (mới)

- Chỉ được các đường dẫn `/api/v1/tags/write`, `/api/v1/drivers/test`.
- `body` là đối tượng JSON, ≤ 16 KiB sau khi tuần tự hóa (lớn hơn: `"too-large"`, không gửi).
- Hạn request: `tags/write` 10 s; `drivers/test` 40 s (lần thử có thể tới 35 s).
- **Không tự gửi lại** khi lỗi mạng: Studio quyết định, dựa trên mã yêu cầu (FR-040).
- Trả `{ status, body }` với 2xx, và với các mã có thân theo contract: 400 (kèm `issues`), 401 hay 403 kèm `results`, 409 `TEST_BUSY`, 429 `TEST_RATE_LIMITED`, 503 `AUDIT_UNAVAILABLE`. Giao diện đọc `results` từ thân.

| Lỗi | Khi |
|---|---|
| `"bad-path"`, `"too-large"` | trước khi gửi |
| `"cert-unpinned"`, `{ "cert-mismatch": {…} }` | như 005 |
| `"session-expired"`, `"session-invalid"`, `"auth-required"` | 401 không có `results` (Rust bỏ token như `device_get`) |
| `"unreachable"`, `"timeout"` | lỗi mạng. Với `tags/write`, lệnh **có thể đã được nhận**: giao diện hỏi lại kết quả theo mã yêu cầu, không gửi lại |
| `{ "http": status }` | mã khác |

## 4. `monitor_get` (đổi)

403 `SOURCE_NOT_ALLOWED` thành lỗi `"viewer-private"`; 403 `VIEWER_OFF` thành `"viewer-off"`. Hai lỗi này hiện câu "Thiết bị chỉ phục vụ trang xem trong mạng riêng; hãy Online (đăng nhập)".

## 5. File project

### `project_backup({ files: [{ rel, hash }], label }) → { dir, abs }` (mới)

- Chép đúng các file trong `files` (tập file của project 0.1, kèm SHA-256 lúc giao diện đọc) vào thư mục mới `.mat-backup/<label>-<UTC yyyyMMddTHHmmssZ>/` trong thư mục project. Giữ đường dẫn tương đối.
- Ghi `backup.json` ([data-model.md](../data-model.md) §12). Đọc lại và so SHA-256 từng file sau khi chép.
- `label` theo `^[0-9]+\.[0-9]+\.[0-9]+$` (phiên bản gốc).
- `dir`: đường dẫn tương đối để giao diện hiện; `abs`: đường dẫn đầy đủ, chỉ để hiện và mở bằng Explorer.

| Lỗi | Khi |
|---|---|
| `"exists"` | thư mục đã có (không bao giờ ghi đè) |
| `{ "changed": rel }` | file trên đĩa khác hash lúc đọc |
| `"bad-path"`, `"no-project"`, `{ "io": "…" }` | |

### `project_write` (đổi)

Tạo thư mục cha còn thiếu bên trong thư mục project (ví dụ `value-tables/`, `watch-tables/`), mỗi cấp kiểm không phải symlink hay junction trỏ ra ngoài. Sâu tối đa 8 cấp. Các luật khác giữ như 004 (chỉ `.json`, ≤ 1 MiB, kiểm hash).

### `project_remove({ rel, hash }) → null` (mới)

Xóa một file `.json` của project khi hash trên đĩa bằng `hash` (bảng giá trị hay bảng theo dõi đã bị xóa rồi lưu). Không xóa `project.json`, `tagFile`. Lỗi: `{ "changed": rel }`, `"missing"`, `"bad-path"`, `{ "io": "…" }`.

## 6. CSV (Bảng Tag, Bảng giá trị, Bảng theo dõi)

### `csv_open() → { name, bytes } | null` (mới)

- Hộp thoại mở file (`*.csv`, `*.txt`). Hủy thì `null`.
- Trả byte gốc (mảng số), ≤ 10 MiB; lớn hơn: `"too-large"`. Rust không giải mã: giao diện nhận diện bảng mã (BOM UTF-8; UTF-8 hợp lệ; không thì Windows-1258, bảng mã của file "CSV" mà Excel tiếng Việt lưu) bằng `TextDecoder`, và cho người dùng đổi trong bước xem trước.

### `csv_save({ suggestedName, text }) → { name } | null` (mới)

Hộp thoại lưu; ghi `text` đúng như nhận (giao diện đã thêm BOM UTF-8). Ghi atomic như `write_atomic` của 004. Hủy thì `null`.

## 7. Giao diện TS `DeviceLink` (thêm)

```ts
post(id: string, path: string, body: object): Promise<ApiResult | DeviceError>;
```

`openLive({ id })` không đổi chữ ký; Rust tự gắn token. Bản giả `mock-device.ts` thêm (điều khiển qua `window.__matMock.device`):

- `tags/write` theo từng kết quả (`CONFIRMED`, `NO_READBACK`, `FAILED` các loại, `TIMEOUT` các loại, `REJECTED` mọi lý do), có trễ đặt được, mất mạng giữa chừng, `duplicate`;
- chẩn đoán driver đổi theo thời gian;
- danh sách cổng (console, đang dùng, USB modem, RS485 `enabled`/`unsupported`);
- Thử kết nối mọi mã kết quả;
- `projects/active` khác project trên máy (để thử cảnh báo khác biệt);
- live: `reason`, 4401.
