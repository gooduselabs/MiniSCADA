# 008 — Spike Tối ưu và kích thước UID (T007)

Ngày đo: 2026-10-13. Trình duyệt: Chrome/155.0.8059.40 headless. File: `tests/fixtures/svg/factory-isometric-stress.svg` (4.551.595 byte, 27.029 phần tử gồm cả `style`, `metadata`, `title`, `desc`, `namedview`; 27.015 phần tử không kể các loại đó).
Script tái chạy: `node tools/svg-import/spike-optimize.mjs [--out docs/reports/008-spike-optimize.json]` (không sửa file gốc; bản gộp ghi vào thư mục tạm). Kết quả thô: [008-spike-optimize.json](008-spike-optimize.json).

Đây là **mô phỏng trong Chrome** (DOM thật; `getComputedStyle` giải cascade), không phải mã `optimizeSvg` của `@mat/svg-import` (T047). So ảnh: chụp màn hình 1600 × 900 của bản gốc và bản gộp (cùng cách mở file), một điểm ảnh "khác" khi có kênh lệch hơn 16/255 (ghi thêm ngưỡng 0 và 64). Chụp lại bản gốc hai lần cho nhiễu nền 0 điểm.

## Kết quả

| Kịch bản | Phần tử (tất cả → sau gộp) | Nhóm gộp | Ảnh khác (ngưỡng 16) | (ngưỡng 0) | (ngưỡng 64) | Byte sau gộp + UID + tên | Đạt |
|---|---|---|---|---|---|---|---|
| R5 nguyên văn ("không `id`") | 27.029 → 27.029 | 0 | 0 % | 0 % | 0 % | 4.141.733 | **không** (không gộp được gì) |
| id tự sinh, không bị tham chiếu, được gộp | 27.029 → 10.339 | 1.026 | 0,716 % | 2,079 % | 0,281 % | 2.701.487 | có |
| **id tự sinh + rào nền/nét (khuyến nghị)** | 27.029 → **10.446** | 1.015 | **0,453 %** | 1,379 % | 0,236 % | 2.708.948 | **có** |
| mọi id không bị tham chiếu (cận trên) | 27.029 → 10.339 | 1.026 | 0,716 % | 2,079 % | 0,281 % | 2.701.487 | có |

**Điều kiện (≤ 20.000 phần tử và ≤ 1 % điểm ảnh khác): ĐẠT** với quy tắc đã chỉnh (hai dòng dưới). Với R5 viết nguyên văn thì **không đạt**, vì Inkscape gán `id` cho mọi phần tử (`line4494`, `polygon1-0`…): 0 phần tử nào gộp được.

## Điều chỉnh quy tắc R5 (đã sửa vào research.md)

1. **`id` tự sinh và không bị tham chiếu không cản gộp:** id khớp mẫu "không nghĩa" của R6 (`path|rect|g|circle|ellipse|line|polygon|polyline|text|use|image|tspan` + số, thêm hậu tố `-<số>` Inkscape sinh khi nhân bản) mà không bị `url(#…)`, `href="#…"` hay bộ chọn CSS `#id` nhắc tới thì bỏ cùng phần tử khi gộp. Id có nghĩa (`conveyor-system3`…) hoặc bị tham chiếu thì vẫn cản gộp.
2. **Rào nền/nét:** không gộp phần tử vừa có nền (`fill` khác `none`) vừa có nét (`stroke` khác `none`): vẽ từng hình (nền rồi nét, hình sau che nét hình trước) khác vẽ gộp (mọi nền rồi mọi nét). Rào này giảm ảnh khác từ 0,716 % xuống 0,453 % (giữ dưới ngưỡng 0,5 % của T052 nếu dùng chung) với chi phí 107 phần tử.
3. **`path` nối `d`:** `m` đầu của `d` độc lập là tuyệt đối nên khi nối phải đổi thành `M` (đã làm trong mô phỏng); `polygon` → `…Z`, `polyline` → không đóng, `line` → `M x1 y1 L x2 y2`.
4. Phần tử gộp phải cùng chuỗi `transform`; không gộp khi `opacity`, `fill-opacity`, `stroke-opacity` khác 1, `filter`, `mask`, `marker-*` khác `none`, `display:none`, `visibility` khác `visible`; không đi vào `defs`, `clipPath`, `mask`, `pattern`, `marker`, `symbol`; hai phần tử khác loại liền kề chặn gộp (giữ thứ tự vẽ).

Phần ảnh còn khác (0,45 %) là khử răng cưa của từng nét/nền khi gộp thành một `path`; không phải sai màu hay sai vị trí (ngưỡng 64 chỉ 0,24 %).

## Kích thước và UID

- Mỗi `data-mat-uid="el_xxxxxxxxxx"` thêm đúng **29 byte** (R6 ước ≈ 28): 26.810 phần tử gắn được trong file gốc → +777.490 byte nếu không gộp (3.357.202 → 4.134.692 byte, tính theo `XMLSerializer`).
- Sau Tối ưu (khuyến nghị): 10.227 phần tử gắn được, 2.405.324 → 2.701.907 byte (+UID), 2.708.948 byte (+237 `data-mat-name` cho phần tử có nhãn `inkscape:label`, `data-name` hay id có nghĩa). Xấp xỉ đầu ra importer (bỏ `inkscape:*`, `sodipodi:*`, `namedview`, `metadata`, id tự sinh không tham chiếu): ≈ 2,56 MB. Tất cả **< 5 MiB**.
- Ngay cả không Tối ưu, file stress có UID chỉ 4,13 MB (< 5 MiB): số **phần tử** (27.015 > 20.000) mới là giới hạn vi phạm, không phải byte.

## Ý nghĩa cho thiết kế

- T047/T054: viết `optimize.ts` theo R5 đã sửa (id tự sinh không tham chiếu thì bỏ khi gộp; rào nền/nét). Báo cáo importer ghi số id đã bỏ.
- spec FR-018 và `contracts/svg-import.md` (nếu có mô tả điều kiện gộp) cần đồng bộ cách nói "không `id`" thành "không `id` có nghĩa hoặc bị tham chiếu" (ngoài phạm vi task này; báo cho phiên chính).
- SC-010 phần stress giữ nguyên (không cần giới hạn "sửa ngoài Studio").

## Giới hạn

Mô phỏng chỉ dùng thuộc tính tính toán của Chrome 155 và một ảnh 1600 × 900; ca có `use`, `text`, gradient nằm ngoài phạm vi gộp (không bị chạm). Kết quả bằng mã sản phẩm sẽ đo lại ở T054.
