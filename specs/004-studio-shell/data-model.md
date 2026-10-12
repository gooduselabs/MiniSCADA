# Data Model: Khung giao diện mới của mAT Studio

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

Feature này không đổi định dạng project hay schema. Các thực thể dưới đây là trạng thái của Studio, chỉ sống trong Studio hoặc trong cấu hình cục bộ của máy kỹ sư.

## 1. Không gian làm việc (`Workspace`)

Lưu trong `localStorage` của WebView2. Mất hoặc hỏng thì dùng mặc định, không báo lỗi.

| Trường | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `leftWidth` | số px | 264 | 180–480 |
| `detailsHeight` | số px | 196 | 70 tới (chiều cao cột trái − 120) |
| `inspectorHeight` | số px | 218 | 90 tới (chiều cao vùng giữa − 150) |
| `taskCard` | `toolbox` \| `library` \| `online` \| `find` | `toolbox` | |
| `taskCardOpen` | bool | true nếu cửa sổ ≥ 1180 px | |
| `theme` | `system` \| `light` \| `dark` | `system` | |
| `showPhases` | bool | true | nhãn giai đoạn trên cây và task card |
| `deviceAddress` | chuỗi | trống | khóa `mat-studio.device` của Sprint 1, giữ nguyên |

Lệnh "Đặt lại bố cục" xóa ba kích thước và `taskCard*`, giữ `theme` và `deviceAddress`.

## 2. Project gần đây (`RecentProject`, Rust)

Rust giữ trong `%APPDATA%\vn.com.atpro.matstudio\recent.json`. Giao diện chỉ thấy chỉ số, tên, đường dẫn hiển thị (research R7).

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `path` | đường dẫn tuyệt đối | thư mục người dùng đã chọn qua hộp thoại |
| `name` | chuỗi | `projectName` đọc được lúc mở, hoặc tên thư mục |
| `openedAt` | thời điểm UTC | |

- Tối đa 10 mục, mới nhất trước; mở lại một mục thì đưa mục đó lên đầu.
- Mục có thư mục không còn tồn tại: trả `exists: false`; giao diện cho bỏ khỏi danh sách.
- File hỏng: coi như danh sách rỗng và ghi đè ở lần mở sau.

## 3. Project đang mở (`OpenProject`)

| Trường | Ghi chú |
|---|---|
| `display` | đường dẫn thư mục để hiển thị (do Rust trả) |
| `docs` | các tài liệu theo đường dẫn tương đối (mục 3.1) |
| `loaded` | kết quả nạp của bộ kiểm tra dùng chung khi project hợp lệ (`LoadedProject`), dùng cho cây, xem trước, lưu trữ |
| `issues` | lỗi và cảnh báo mới nhất (mục 5) |
| `checkSeq` | số thứ tự lần kiểm; chỉ áp kết quả có `checkSeq` mới nhất (FR-017) |

### 3.1 Tài liệu (`ProjectDoc`)

| Trường | Ghi chú |
|---|---|
| `rel` | đường dẫn tương đối trong project (`project.json`, `tags.json`, `logging.json`, `screens/...`) |
| `diskText` | nội dung đọc từ đĩa |
| `diskHash` | SHA-256 của `diskText` (Rust trả, contracts/tauri-commands.md) |
| `value` | đối tượng đang sửa; chỉ `project.json` và `tags.json` sửa được ở feature này |
| `editable` | `true` với `project.json` và file Tag; `false` với lưu trữ, màn hình, binding, SVG |

- **Chưa lưu** khi `serialize(value) !== diskText`, so trên đúng chuỗi sẽ ghi (FR-022). Sửa rồi hoàn tác về như cũ thì hết dấu chưa lưu.
- **Lưu:** ghi tài liệu chưa lưu theo thứ tự `tags.json` trước, `project.json` sau, mỗi file kèm `diskHash` (mục 6).
- **Giữ định dạng:**
  - sửa trên bản sao của đối tượng đọc từ đĩa;
  - chỉ gán trường người dùng đổi;
  - giữ thứ tự khóa và trường không chạm (kể cả chuỗi rỗng, khoảng trắng);
  - Tag mới thêm theo thứ tự khóa chuẩn: `id`, `type`, `description`, `unit`, `min`, `max`, `source`.

## 4. Lịch sử sửa (`EditHistory`)

| Trường | Ghi chú |
|---|---|
| `past`, `future` | mảng snapshot; tối đa 100 phần tử, bỏ cũ nhất khi đầy |
| `mergeKey`, `mergeAt` | gõ liên tục vào cùng một ô hoặc trường trong 1,2 s thì gộp thành một bước |

- **Snapshot:** chuỗi JSON của các tài liệu sửa được (`project.json`, file Tag).
- **Ghi lịch sử:** mỗi hành động sửa đẩy snapshot trước khi sửa vào `past` và xóa `future`.
- **Hoàn tác, làm lại:** đổi chỗ snapshot giữa `past` và `future`.
- **Lưu không xóa lịch sử:** hoàn tác sau khi lưu làm tài liệu chưa lưu trở lại.

## 5. Kết quả kiểm tra và ánh xạ (`Issue`, `Location`)

`Issue` là kết quả của bộ kiểm tra dùng chung, gồm `code`, `file`, `path` (JSON pointer), `message`, mức (lỗi nếu mã bắt đầu bằng `E_`, cảnh báo nếu bắt đầu bằng `W_`). Studio thêm `Location` để nhảy tới chỗ sai (FR-018):

| `file` | `path` | `Location` |
|---|---|---|
| file Tag | `/tags/{i}/{field}` | `{ editor: 'tags', row: i, column: field }` |
| file Tag | `/tags/{i}` (cả dòng, ví dụ `E_TAG_RANGE`) | `{ editor: 'tags', row: i, column: 'max' }`; tô đỏ cả Min và Max |
| `project.json` | `/{field}` | `{ editor: 'settings', field }` |
| `logging.json` | `/groups/{g}/...`, `/connections/{c}/...` | `{ editor: 'logging', group: g }` hoặc `{ editor: 'logging', connection: c }` |
| `screens/{id}.bindings.json` | `/elements/{k}/...` | `{ editor: 'screen', screen: id, element: uid }` |
| khác hoặc không khớp | | `{ editor: null }`: chỉ hiện trong tab Thông tin |

Bảng ánh xạ là hàm thuần (`model/issue-map.ts`) và có test cho từng dòng.

## 6. Lưu và xung đột

Mỗi tài liệu chưa lưu đi qua các trạng thái:

```text
sạch ──sửa──▶ chưa lưu ──Ctrl+S──▶ đang ghi ──ok──▶ sạch (diskText, diskHash mới)
                                     │
                                     └──"changed"──▶ xung đột ──Ghi đè──▶ đang ghi (force)
                                                        ├──Tải lại──▶ sạch (đọc lại; lịch sử giữ để hoàn tác)
                                                        └──Hủy──▶ chưa lưu
```

Lỗi ghi khác (đường dẫn, IO) giữ trạng thái chưa lưu và hiện lý do.

## 7. Cây project (`TreeNode`)

| Trường | Ghi chú |
|---|---|
| `id` | ổn định giữa các lần dựng (để giữ trạng thái mở/đóng và chọn) |
| `label`, `icon`, `sub` | `sub`: chữ phụ, ví dụ địa chỉ thiết bị, "màn hình đầu" |
| `editor` | editor mở khi chọn; `null` với nút chỉ để nhóm |
| `count` | số Tag, số nhóm lưu trữ |
| `phase` | `GĐ 2`, `GĐ 3b`… với mục chưa làm |
| `children` | |
| `deviceState` | chỉ nút thiết bị: `offline` \| `monitoring` \| `lost` |

Cây dựng bằng hàm thuần (`model/tree.ts`) từ `OpenProject` và trạng thái thiết bị. Thứ tự cố định theo studio-ux.md §4.

## 8. Editor, tab, lựa chọn

- **Tab:** `editorId` (`start`, `settings`, `tags`, `logging`, `screen:{id}`, `device`, `phase:{key}`). Mỗi `editorId` có tối đa một tab. `start` không đóng được.
- **Lựa chọn hiện tại:** quyết định nội dung của inspector › Thuộc tính và Details. Một trong:
  - `{ kind: 'tag', row }`;
  - `{ kind: 'element', screen, uid }`;
  - `{ kind: 'group', index }`;
  - `{ kind: 'project' }`;
  - không chọn gì.
- **Ô đang chọn của lưới:** `{ row, column }`, giữ khi chuyển tab.

## 9. Phiên thiết bị (`DeviceSession`)

| Trường | Ghi chú |
|---|---|
| `address` | gốc URL đã chuẩn hóa (`normalizeDevice` của Sprint 1) |
| `info` | bản `system/info` mới nhất và thời điểm nhận |
| `live` | trạng thái `LiveConnection`: `connecting`, `open`, `live`, `offline`, `full`, `incompatible`, `stopped` |
| `values` | Tag → giá trị, quality, thời điểm |
| `unknown` | Tag thiết bị báo không có (snapshot `unknown`) |

Các trạng thái của phiên:

```text
idle ──Ctrl+K──▶ connecting ──system/info ok + live──▶ monitoring
  ▲                  │ lỗi/timeout 3 s                    │ mất mạng
  │                  ▼                                    ▼
  └──Ctrl+M──── error (hiện lý do)               lost (tự kết nối lại theo backoff của live-client)
                                                          │ có lại
monitoring ◀──────────────────────────────────────────────┘
connecting/monitoring ──thiết bị đầy (4429)──▶ full ──30 s──▶ connecting
connecting ──giao thức không tương thích──▶ incompatible (không tự thử lại)
```

- **Khi `lost`:** mọi giá trị hiện trạng thái mất kết nối, không giữ giá trị cũ như còn tốt.
- **Khi danh sách Tag của project đổi:** phiên gọi `setTags` (research R10).
- **Ngắt:** đóng WebSocket ngay, để thiết bị trả phiên.

## 10. Xem trước (`PreviewMode`)

`off` | `sim` | `device`. Chế độ `device` chỉ chọn được khi phiên thiết bị đang `monitoring`. Mất phiên thì chuyển về `sim` và báo.

## 11. Lệnh (`Command`)

| Trường | Ghi chú |
|---|---|
| `id` | ví dụ `project.save` (danh mục ở contracts/commands.md) |
| `label` | khóa chuỗi i18n |
| `shortcut` | tùy chọn |
| `menu` | nhóm menu |
| `enabled(state)` | `true` hoặc khóa chuỗi lý do bị khóa (hiện ở tooltip, bảng lệnh) |
| `run(state)` | |
