# Contract: lệnh Rust ↔ giao diện Studio

**Feature**: [spec.md](../spec.md) · **Data model**: [data-model.md](../data-model.md)

Giao diện gọi Rust qua `invoke` của Tauri 2. Lỗi trả về là chuỗi kebab-case, kiểu enum phía Rust. Giao diện không bao giờ gửi đường dẫn tuyệt đối: thư mục project chỉ đặt được qua hộp thoại hoặc qua danh sách gần đây do Rust giữ (research R7).

Các lệnh có từ Sprint 1 và thay đổi:

| Lệnh | Sprint 1 | Feature 004 |
|---|---|---|
| `app_info` | có | giữ nguyên |
| `project_pick` | trả đường dẫn hiển thị | thêm ghi vào danh sách gần đây |
| `project_read` | trả nội dung; lỗi đã phân loại (audit FR-032, GĐ 0) | trả nội dung kèm SHA-256 |
| `project_write` | ghi atomic | thêm hash mong đợi và cờ `force` |
| `open_device_web` | có | giữ nguyên |
| `project_recent`, `project_open_recent`, `project_forget_recent` | không có | mới |

## Payload thực tế (đối chiếu sau khi cài đặt, 2026-10-11)

Tauri 2 tự đổi tham số Rust `expected_hash` thành khóa JS `expectedHash`. Lỗi là chuỗi kebab-case trần, riêng `io` là đối tượng một khóa `{ "io": "<chi tiết>" }`: bản cài không có console, nên chi tiết phải đi kèm lỗi để Studio hiện được.

| Lệnh | Tham số JS | Kết quả | Lỗi |
|---|---|---|---|
| `project_pick` | — | `{ display }` hoặc `null` | chuỗi mô tả (hiếm) |
| `project_recent` | — | `[{ index, display, name, openedAt, exists }]` | không có; `recent.json` hỏng thì trả `[]` |
| `project_open_recent` | `{ index }` | `{ display }` | `"no-such-entry"`, `"missing"` |
| `project_forget_recent` | `{ index }` | `null` | `"no-such-entry"`, `{ "io": … }` |
| `project_read` | `{ rel }` | `{ text, hash }` | `"missing"`, `"bad-path"`, `"too-large"`, `"bad-utf8"` |
| `project_write` | `{ rel, content, expectedHash: string \| null, force: boolean }` | `{ hash }` | `"changed"`, `"bad-path"`, `"no-project"`, `{ "io": … }` |

- `openedAt` dạng `2026-10-11T08:30:00Z`.
- `index` là số nguyên ≥ 0; số âm hay số thực bị Tauri báo lỗi tham số.
- `project_recent` và `project_open_recent` là lệnh async, để việc kiểm thư mục trên ổ mạng đã mất không chặn giao diện.
- `hash` là SHA-256 của đúng các byte trên đĩa, kể cả BOM.
- `project_pick` của Sprint 1 trả chuỗi; `pickProject()` trong `platform/tauri-source.ts` vẫn trả chuỗi cho giao diện cũ tới T078.

## `app_info() → AppInfo`

`{ name: string, version: string, tauri: string }`. Dùng cho Trợ giúp › Giới thiệu.

## `project_pick() → PickResult | null`

Mở hộp thoại chọn thư mục. Hủy thì trả `null`. Chọn được thì:

- đặt thư mục đó làm thư mục project của phiên;
- thêm hoặc đưa lên đầu danh sách gần đây;
- trả `{ display: string }` là đường dẫn để hiển thị.

## `project_recent() → RecentEntry[]`

Tối đa 10 mục, mới nhất trước. Mỗi mục: `{ index: number, display: string, name: string, openedAt: string (ISO 8601 UTC), exists: boolean }`. File `recent.json` hỏng thì trả `[]`.

## `project_open_recent(index: number) → PickResult`

Đặt thư mục của mục `index` làm thư mục project. Lỗi:

| Lỗi | Khi nào |
|---|---|
| `no-such-entry` | `index` ngoài danh sách |
| `missing` | thư mục không còn tồn tại |

## `project_forget_recent(index: number) → void`

Bỏ một mục khỏi danh sách.

## `project_read(rel: string) → ReadResult`

`{ text: string, hash: string }`, trong đó `hash` là SHA-256 dạng hex chữ thường của nội dung UTF-8.

- **Từ GĐ 0 (2026-10-11):**
  - lệnh Rust trả `Result<String, ReadError>`;
  - phía TS, `ProjectSource` của `@mat/project-schema` đổi `readText()` thành `read(rel)`, trả `ReadResult` = `{ text }` hoặc `{ error }`.
- **Feature 004:** lệnh trả thêm `hash`. `ReadResult` thêm trường `hash` tùy chọn: chỉ nguồn đọc của Studio có, bộ kiểm tra không dùng.

Lỗi giữ như sau GĐ 0 (audit FR-032):

| Lỗi | Khi nào | Bộ kiểm tra báo |
|---|---|---|
| `missing` | không có file, khác chữ hoa/thường, không phải file thường, chưa mở project | `E_FILE_MISSING` |
| `bad-path` | đường dẫn không an toàn hoặc ra ngoài thư mục project (kể cả qua symlink) | `E_PATH` |
| `too-large` | JSON > 1 MB, SVG > 5 MB | như runtime |
| `bad-utf8` | không phải UTF-8 hợp lệ | `E_JSON` |

Mã lỗi phía kiểm tra phải trùng với runtime C++ cho cùng file; agent GĐ 0 chốt bảng này.

## `project_write(rel: string, content: string, expectedHash: string | null, force: boolean) → WriteResult`

Ghi atomic: file tạm cùng thư mục rồi đổi tên. Trả `{ hash: string }` của nội dung mới.

- `expectedHash` là hash lúc đọc; `null` khi tạo file mới.
- Rust đọc hash hiện tại của file trước khi ghi:
  - khác `expectedHash` và `force = false`: không ghi, trả lỗi `changed`;
  - `force = true`: ghi đè.

| Lỗi | Khi nào |
|---|---|
| `changed` | file trên đĩa khác lúc đọc (FR-025) |
| `bad-path` | như `project_read` |
| `no-project` | chưa mở project |
| `io` | lỗi hệ điều hành; giao diện hiện thông báo chung kèm chi tiết trong nhật ký |

Chỉ ghi `.json` (SVG chỉ đọc ở feature này).

## `open_device_web(url: string) → void`

Như Sprint 1: chỉ nhận `http://` hoặc `https://`, dài ≤ 256 ký tự, không có khoảng trắng, ký tự điều khiển hay dấu `"`. Lỗi trả chuỗi mô tả.

Feature 011 (FR-026, L-04 của 005): chỉ nhận `https://<tên máy>:<cổng HTTPS>/` của một thiết bị đã lưu (`devices.json`; tên máy không phân biệt hoa thường, đường dẫn `/` hoặc bỏ trống, không user info, query hay fragment); URL được dựng lại từ bản ghi đã lưu. URL khác, kể cả `http://`, bị từ chối với chuỗi mô tả. Studio mở trang HTTPS của thiết bị đang làm việc, thiết bị gắn với project, hoặc thiết bị đã lưu có cùng tên máy với địa chỉ đã nhập.

## Đóng cửa sổ (FR-024)

Không có lệnh Rust riêng. Giao diện:

1. nghe `onCloseRequested` của cửa sổ chính;
2. còn thay đổi chưa lưu thì `preventDefault`, hiện hộp thoại Lưu / Không lưu / Hủy;
3. xong thì gọi `destroy()`.

Capability `default.json` thêm cho cửa sổ `main`: `core:window:allow-close`, `core:window:allow-destroy`. Thêm quyền dùng sự kiện đóng nếu bản Tauri đang dùng yêu cầu.

## Lớp giả cho e2e

`platform/mock.ts` cài các lệnh trên bằng `mockIPC`, dùng project mẫu trong bộ nhớ:

- `project_write` cập nhật bộ nhớ và trả hash mới;
- có cờ để giả lập `changed`, `missing`, lỗi ghi.

Lớp giả chỉ có trong build chế độ `e2e`, không vào bộ cài.
