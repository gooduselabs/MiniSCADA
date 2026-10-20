# Vector project của feature 012 (định dạng 1.1.0: bố cục lưới, chủ đề)

Sinh bởi `tests/project-vectors/generate.mjs` (mã ca ở `v11.mjs`). Cấu trúc thư mục và `expected.json` như `v10-*` (`valid`, `errors`, `warnings`, `issues`, `runtimeVersion`); `runtimeVersion` mặc định `1.1.0`. Hợp đồng: [contracts/project-format-1.1.md](../../specs/012-screen-grid-layout/contracts/project-format-1.1.md) §3, §5. Chạy: `packages/project-schema/src/vectors-11.test.ts` (TS), `core/project-manager/tests/vectors_11_test.cpp` (C++, T011). Studio mở cùng các vector ở `apps/studio/src/model/vectors.test.ts`.

## Project nền `base11()`

`base10()` với mọi `schemaVersion` 1.1.0, `minRuntimeVersion` 1.1.0, `theme: "vivid"`, cộng màn hình lưới `screens/tong-quan.screen.json` (khai ở `project.json` `screens`):

- hàng `r1` `auto`: ô `c1` (4 cột, thẻ `luu_luong` → `PUMP07.FLOW`), `c2` (4, đồng hồ `dong_ho` → `PUMP08.FLOW`), `c3` (4, đèn `den` → `PUMP07.RUN`);
- hàng `r2` `auto`: `c4` (8, biểu đồ đường `xu_huong` → `PUMP07.FLOW`), `c5` (4, trống);
- hàng `r3` 320 px: `c6` (12, khung nhóm `khung`).

Item của màn hình lưới không có `x`, `y`, `width`, `height`. Base hợp lệ, không cảnh báo.

## Luật bộ C++ phải cài giống hệt (rules-11.ts)

Chạy cho họ 1.x (1.0 và 1.1 dùng chung bộ schema ở thư mục gốc `schemas/`):

1. Project 1.0 có `theme`: `E_LAYOUT_VERSION` `project.json` `/theme`. Màn hình của project 1.0 có `layout`: `E_LAYOUT_VERSION` `/layout` (không kiểm tiếp bố cục đó). Project 1.1 có `minRuntimeVersion` < 1.1.0: `E_LAYOUT_VERSION` `/minRuntimeVersion`.
2. Màn hình không có `layout`: item thiếu `x`, `y`, `width` hoặc `height` (theo thứ tự đó, báo trường thiếu đầu tiên): `E_LAYOUT_ITEM_POS` `/items/<i>/<trường>`.
3. Màn hình có `layout` (project 1.1): `mode` khác `grid`: `E_LAYOUT_COLUMNS` `/layout/mode`; `columns` khác 12: `E_LAYOUT_COLUMNS` `/layout/columns`; quá 100 hàng: `E_LAYOUT_LIMIT` `/layout/rows`.
4. Mỗi hàng `r` theo thứ tự: id hàng sai mẫu `^[a-z][a-z0-9_-]{0,31}$` hoặc trùng (hàng và ô chung không gian tên): `E_LAYOUT_ID` `/layout/rows/<r>/id`; 0 hoặc quá 12 ô: `E_LAYOUT_LIMIT` `/layout/rows/<r>/cells`. Mỗi ô `c`: id như trên (`.../cells/<c>/id`); cộng dồn `offset + span`; `span` ngoài 1..12 hoặc `offset` ngoài 0..11: `E_LAYOUT_SPAN` `.../cells/<c>/span`; nếu không, ô đầu tiên làm tổng vượt 12: `E_LAYOUT_SPAN` `.../cells/<c>/span` (một lần mỗi hàng). `item` không có trong `items`: `E_LAYOUT_ITEM_REF` `.../cells/<c>/item`; đã đặt ở ô trước: `E_LAYOUT_ITEM_DUP` `.../cells/<c>/item`.
5. Mỗi item `i`: có một trong `x`, `y`, `width`, `height` (trường đầu tiên có): `E_LAYOUT_ITEM_POS` `/items/<i>/<trường>`; không ô nào trỏ tới: cảnh báo `W_LAYOUT_ITEM_ORPHAN` `/items/<i>`.

Luật 0.3 về kích thước và vị trí item (`E_ITEM_SIZE`, `W_ITEM_OUTSIDE`, `W_ITEM_COVERED`) không áp cho item của màn hình lưới (không có tọa độ).
