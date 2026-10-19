# Data Model: 012

Chi tiết schema và luật: [contracts/project-format-1.1.md](contracts/project-format-1.1.md).

## ScreenModel11 (tệp `screens/<id>.screen.json`)

Như `ScreenModel10` cộng:

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `layout` | `Layout` | không | thiếu = bố cục Tự do (như 1.0) |

`size`, `fitMode` giữ (popup dùng `size` làm khung; màn hình lưới bỏ qua `fitMode`).

## Layout

| Trường | Kiểu | Ràng buộc |
|---|---|---|
| `mode` | `"grid"` | duy nhất ở bản này |
| `columns` | số | phải là 12 (`E_LAYOUT_COLUMNS`) |
| `gap` | số px | 0 đến 64, mặc định 12 |
| `padding` | số px | 0 đến 64, mặc định 16 |
| `rows` | `Row[]` | 0 đến 100 (`E_LAYOUT_LIMIT`) |

## Row

| Trường | Kiểu | Ràng buộc |
|---|---|---|
| `id` | chuỗi | `^[a-z][a-z0-9_-]{0,31}$`, duy nhất trong màn hình (hàng và ô cùng không gian tên, `E_LAYOUT_ID`) |
| `height` | `"auto"` hoặc số px | số: 24 đến 4.000 |
| `gap` | số px | tùy chọn, 0 đến 64 |
| `cells` | `Cell[]` | 1 đến 12 (`E_LAYOUT_LIMIT`); tổng `offset + span` ≤ 12 (`E_LAYOUT_SPAN`) |

## Cell

| Trường | Kiểu | Ràng buộc |
|---|---|---|
| `id` | chuỗi | như Row.id |
| `span` | số nguyên | 1 đến 12 |
| `offset` | số nguyên | 0 đến 11, mặc định 0 |
| `align` | `start`, `center`, `end`, `stretch` | mặc định `stretch` |
| `minHeight` | số px | 0 đến 4.000 |
| `item` | chuỗi | `id` của một item trong `items[]` (`E_LAYOUT_ITEM_REF`); một item chỉ ở một ô (`E_LAYOUT_ITEM_DUP`) |

## Item (widget, svg)

Như 1.0. Trong màn hình có `layout`: `x`, `y`, `width`, `height` **không được có** (`E_LAYOUT_ITEM_POS`); item không ô nào trỏ tới: `W_LAYOUT_ITEM_ORPHAN`. Trong màn hình Tự do: bốn trường bắt buộc như cũ.

## Project (`project.json`)

| Trường mới | Kiểu | Ghi chú |
|---|---|---|
| `theme` | `"vivid"`, `"industrial"`, `"dark"` | thiếu = `industrial` (giữ giao diện cũ cho project cũ); project mới tạo bằng Studio ghi `vivid` |

## Quan hệ và vòng đời

- Xóa item → các ô trỏ tới nó thành ô trống (cùng một `ProjectEdit`).
- Xóa ô hoặc hàng có item → item bị xóa cùng (sau xác nhận).
- Đổi `id` item (đổi tên) → cập nhật `cell.item` (hàm `renameItemRef` trong `layout.ts`).
- Nhân bản màn hình lưới → `id` item mới theo quy tắc nhân bản hiện có, ô trỏ theo.
- Chuyển tự do → lưới (`grid-convert.ts`): sinh `layout`, xóa `x`, `y`, `width`, `height` khỏi item, một bước hoàn tác.
