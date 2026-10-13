# Contract: editor Màn hình của Studio

**Feature**: [spec.md](../spec.md) FR-058…FR-072 · **Data model**: [data-model.md](../data-model.md) §13–§15 · **Research**: R19–R22 · **ADR**: [022](../../../docs/adr/022-screen-editor.md) · **Mockup**: [studio-screens.html](../../../docs/architecture/mockups/studio-screens.html)

Studio 0.5.0. **Không có lệnh Tauri mới**: đọc và ghi file màn hình dùng `project_fs` có sẵn; xem trước Thiết bị dùng `device_get`, `device_post`, `live_open` của 005 và 006; ghi qua `WriteFlow` của 006.

## 1. Cấu trúc mô-đun

```text
apps/studio/src/
├── model/
│   ├── screen-doc.ts             # tài liệu màn hình: thao tác bất biến trên ScreenModel
│   ├── screen-edit/              # gesture.ts (máy trạng thái), snap.ts, align.ts, resize.ts, layers.ts, hit.ts,
│   │                             # clipboard.ts, viewport.ts (zoom/pan, đổi tọa độ), keymap.ts
│   ├── screen-catalog.ts         # đọc widgets.catalog.json, dựng form inspector, kiểm kiểu/quyền khe
│   ├── screen-issues.ts          # ánh xạ Issue (path JSON Pointer) → itemId, ô inspector
│   ├── navigation-doc.ts         # sửa navigation
│   └── preview-hosts.ts          # SimTagSource, DeviceTagSource, StudioActionHost
├── ui/
│   ├── editors/screen-editor.ts  # editor Màn hình (thay screen-preview.ts)
│   ├── editors/navigation-editor.ts
│   ├── screen/                   # mat-screen-canvas.ts, mat-ruler.ts, mat-layers.ts, mat-screen-toolbar.ts
│   ├── props-widget.ts           # inspector cho item (Chung, Hiển thị, Gắn Tag, Sự kiện, Bảo mật)
│   └── dialogs/                  # screen-props-dialog.ts, delete-screen-dialog.ts
└── i18n/vi-screens.ts
```

## 2. Tài liệu màn hình (`screen-doc.ts`)

Hàm thuần `(doc: ScreenModel, args) → ScreenModel` (bất biến); mỗi hàm trả `{ doc, selection? }`:

| Hàm | Việc |
|---|---|
| `addWidget(doc, type, at)` | thêm item cuối mảng với cỡ mặc định theo danh mục, id mới, props rỗng |
| `moveItems(doc, ids, dx, dy)`, `setRect(doc, id, rect)` | đổi vị trí và cỡ (số nguyên; tối thiểu theo danh mục) |
| `resizeItems(doc, ids, handle, delta, opts)` | đổi cỡ theo tay nắm |
| `alignItems(doc, ids, kind)`, `distributeItems(doc, ids, axis)`, `matchSize(doc, ids, axis)` | căn chỉnh |
| `reorder(doc, ids, op)` | `front`, `back`, `forward`, `backward`, hoặc `toIndex` |
| `setProp(doc, id, name, value)`, `setTag(doc, id, slot, tagId \| tagId[] \| null)`, `setAction(doc, id, event, action)`, `setSecurity(doc, id, minRole)` | thuộc tính |
| `rename(doc, id, name)`, `setLocked`, `setHidden` | |
| `duplicate(doc, ids)`, `paste(doc, clip, offset)`, `remove(doc, ids)` | |
| `setScreenProps(doc, {name, kind, size, fitMode, background})` | |

Quy tắc: `id` mới là `<loại>_<số nhỏ nhất chưa dùng>`; `paste` giữ Tag và hành động, cấp id mới, lệch (+20, +20); thao tác không hợp lệ (cỡ dưới tối thiểu) kẹp về giá trị gần nhất hợp lệ; không bao giờ trả tài liệu mà `items` có id trùng.

## 3. Cử chỉ (`gesture.ts`)

Máy trạng thái nhận sự kiện đã đổi sang tọa độ thiết kế (`down`, `move`, `up`, `key`, `cancel`) và phát lệnh cho canvas.

| Trạng thái | Vào khi | Kết quả khi `up` |
|---|---|---|
| `idle` | | nhấp trống: bỏ chọn; nhấp item: chọn (Shift/Ctrl: thêm/bớt) |
| `marquee` | kéo trên nền trống | chọn mọi item (không khóa, không ẩn) giao với khung |
| `moving` | kéo item đã chọn quá 3 điểm ảnh | `moveItems` một bước hoàn tác; `Esc` hủy |
| `resizing` | kéo tay nắm | `resizeItems` một bước |
| `panning` | giữ Space + kéo, hoặc chuột giữa | đổi `viewport` (không vào lịch sử) |
| `tool-drop` | thả từ Toolbox (HTML5 DnD) | `addWidget` tại điểm thả |

Trong `moving`/`resizing`: `snap` áp (lưới, đường gióng), Alt tắt, Shift ràng buộc tỉ lệ (đổi cỡ) hoặc trục (di chuyển: giữ Shift khóa theo trục chính). Tooltip kích thước hoặc tọa độ theo con trỏ.

## 4. Phím tắt và lệnh (bảng lệnh Ctrl+Shift+P)

Phím của editor Màn hình chỉ có hiệu lực **khi canvas hoặc danh sách Lớp có focus** (không đăng ký toàn cục, để không xung đột với lưới Bảng Tag: ví dụ Ctrl+D là điền xuống ở lưới và nhân bản ở canvas). Phím toàn cục của 004–006 (Ctrl+S, Ctrl+Z, Ctrl+Y, Ctrl+K, Ctrl+M, Ctrl+L, Ctrl+F, Ctrl+Shift+P, F6, F7) giữ nguyên; `shortcuts.test.ts` kiểm không xung đột.

| Phím (canvas có focus) | Lệnh |
|---|---|
| Ctrl+Z, Ctrl+Y | hoàn tác, làm lại (lệnh toàn cục có sẵn) |
| Ctrl+C, Ctrl+V, Ctrl+D, Delete | sao chép, dán, nhân bản, xóa |
| Ctrl+A, Esc | chọn tất cả (item không khóa); bỏ chọn hoặc hủy cử chỉ |
| Mũi tên, Shift+mũi tên | dịch 1, 10 đơn vị |
| Tab, Shift+Tab | chọn item kế, trước theo thứ tự lớp |
| Enter | đưa focus tới inspector |
| `]`, `[`, Shift+`]`, Shift+`[` | lên một lớp, xuống một lớp, lên trên, xuống dưới |
| `+`, `-`, `0`, `1` | zoom vào, ra, vừa khung, 100 % |
| Ctrl+lăn chuột, Space+kéo, chuột giữa | zoom quanh con trỏ, pan |

Căn chỉnh, phân bố, cùng rộng/cao, khóa, ẩn, bật/tắt lưới và bắt dính, chuyển chế độ xem trước (Tắt, Mô phỏng, Thiết bị) chỉ có trên thanh công cụ và bảng lệnh (không phím tắt).

## 5. Kéo thả HTML5

| Loại MIME | Nguồn | Dữ liệu | Đích | Kiểm |
|---|---|---|---|---|
| `application/x-mat-widget` | Toolbox | loại widget (`card`…) | canvas | loại có trong danh mục |
| `application/x-mat-tag` | cây, Details, Bảng Tag | id Tag | ô khe của inspector; widget trên canvas | kiểu, quyền RW (danh mục §4); Tag có trong project |

Dữ liệu kéo chỉ là chuỗi định danh. Thả widget lên canvas: vị trí thả đổi sang tọa độ thiết kế, dính lưới. Thả Tag lên widget: gắn khe đầu tiên chưa có Tag mà hợp kiểu; nếu mọi khe đã gắn thì thay khe chính (có thể hoàn tác).

## 6. Inspector (`props-widget.ts`)

| Nhóm | Nội dung | Sinh từ |
|---|---|---|
| Chung | Tên, X, Y, Rộng, Cao, khóa tỉ lệ (giao diện), Khóa, Ẩn | cố định |
| Hiển thị | các `props` có `group: display` | danh mục |
| Gắn Tag | khe: ô thả Tag, nút [Tag ▼] (chọn từ danh sách), kiểu/đơn vị/quyền của Tag, nút "Dùng đơn vị, bảng, giới hạn của Tag" | danh mục + `TagInfo` |
| Sự kiện | hành động của `click` (loại, tham số), Hộp xác nhận, nội dung xác nhận | danh mục |
| Bảo mật | `minRole`, ghi chú "Khóa khi mất kết nối, quality xấu: luôn bật" | danh mục |

Lỗi theo ô: `Issue.path` (JSON Pointer) → ô tương ứng bằng `screen-issues.ts`; viền đỏ, chi tiết ở tab Thông tin; nhấp đôi một dòng lỗi chọn item và đưa focus tới ô. Item `svg`: nhóm Chung và nhóm "Đồ họa" chỉ đọc (file, `viewBox`, số phần tử gắn Tag; sửa binding là GĐ 3b).

## 7. Xem trước

Ba chế độ như 004, 006. `preview-hosts.ts`:

- `SimTagSource` bọc `SimEngine` (006); `info()` lấy từ `tags.json` trong bộ nhớ; `connection` luôn `live`.
- `DeviceTagSource` bọc phiên thiết bị Online (đăng ký qua `live-subscriptions.ts`, ≤ 1.000 Tag, ưu tiên màn hình đang xem); mất kết nối: `stale`.
- `StudioActionHost`: `session()` từ phiên Online (hoặc operator giả ở Mô phỏng); `write` ở Mô phỏng gọi `SimEngine.write` với kết quả `CONFIRMED`/`REJECTED` theo RW và giới hạn (không mã `PULSE`: mô phỏng xung bằng hẹn giờ trong `SimEngine`); ở Thiết bị gọi `WriteFlow` của 006 (kèm `context`, `expect`, `pulseMs`); `navigate`/`openPopup` đổi màn hình đang xem trong editor.
- Xem trước khóa chỉnh sửa; chuyển về Tắt thì giữ lựa chọn và vùng nhìn.

## 8. Lưu và định dạng

Ghi file theo [project-format-0.3.md](project-format-0.3.md) §11. Màn hình nằm trong `ProjectDoc` như tài liệu sửa được (snapshot chuỗi); lưu cùng Ctrl+S, hoàn tác theo `history.ts` (100 bước, `mergeKey` cho gõ liên tục trong ô inspector). Đổi tên màn hình đổi tên file (`screens/<id>.screen.json`, SVG và binding giữ tên); id màn hình không đổi khi đổi tên hiển thị; "đổi id" là thao tác riêng cập nhật mọi tham chiếu (hành động, menu, `entryScreen`).

## 9. Test

- Vitest thuần: `snap.test.ts`, `align.test.ts`, `resize.test.ts`, `layers.test.ts`, `hit.test.ts`, `gesture.test.ts`, `screen-doc.test.ts`, `clipboard.test.ts`, `screen-catalog.test.ts`, `screen-issues.test.ts`, `navigation-doc.test.ts`, `viewport.test.ts` (bảng ca hình học: SC-014).
- e2e Chrome headless: `screen-build.e2e.mjs` (dựng dashboard 20 widget đủ 15 loại từ project rỗng bằng chuột và bàn phím, lưu, kiểm tra, so với JSON mong đợi), `screen-geometry.e2e.mjs` (kéo, đổi cỡ, căn chỉnh, hoàn tác), `screen-preview.e2e.mjs`, `screen-a11y.e2e.mjs` (axe, bàn phím), `screen-perf.e2e.mjs` (SC-013), `navigation.e2e.mjs`.
