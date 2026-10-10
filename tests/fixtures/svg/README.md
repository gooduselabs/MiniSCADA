# SVG fixtures (Sprint 0 — T035/T036)

Bộ SVG dùng để kiểm tra chuỗi "BL335 phục vụ file → Chrome hiển thị" (SC-005) và làm đầu vào cho importer ở Sprint 2. Trang thử [`apps/runtime-web`](../../../apps/runtime-web) tự đọc mọi `*.svg` ở thư mục này khi build.

## Nguồn gốc — đọc trước khi dùng làm bằng chứng

| Nhóm | Nguồn thật | Ghi chú |
|---|---|---|
| 12 file nhỏ (bảng dưới) | **Viết tay bằng mã trong Sprint 0** (Claude Code), cú pháp SVG tối giản | **Không** xuất từ Inkscape/Illustrator/CorelDRAW. Chúng phủ các đặc điểm FR-011 liệt kê nhưng **không** thể hiện cách từng phần mềm vẽ sinh `id`, `style`, `transform`, đơn vị, metadata. |
| `factory-isometric-stress.svg` | Người dùng cung cấp (`svg/file _SVG.svg`), **xuất từ Inkscape** (người dùng xác nhận; `inkscape:version="1.4.4"`) | Chứa 8 khối `<style>` với class `.cls-N` (CSS nội tuyến): 366 class trùng tên khác nội dung — xem [svg-dialects.md](../../../docs/architecture/svg-dialects.md). |
| `real-libreoffice-draw.svg` | **Xuất thật** bằng LibreOffice Draw 26.2: mở `process-overview.svg` rồi xuất SVG (`soffice --headless --convert-to svg:draw_svg_Export`) | Định dạng LibreOffice: mm, font SVG nhúng, gradient thành bậc, mất `id`/`data-tag`. Tính là phần mềm thứ 2 có file xuất thật (sau Inkscape) |
| 5 file `synthetic-*.svg` | **Mô phỏng (viết tay)** đặc trưng định dạng của Illustrator (Save As, Export As), CorelDRAW, draw.io, Inkscape | **Không** phải file xuất thật; dùng để thử bộ lọc và công cụ nhận diện trước khi có file thật. Không tính cho FR-011. |

**FR-011 yêu cầu ≥ 3 phần mềm vẽ: hiện chưa đạt.** Đã có file xuất thật từ Inkscape và LibreOffice Draw. Còn thiếu SVG xuất trực tiếp từ Illustrator và CorelDRAW (T036). Khi có, thêm vào thư mục này và cập nhật bảng.

## Danh sách

`data-tag` là thuộc tính thử nghiệm: trang thử đổi màu/chữ phần tử đó theo Tag `SIM.Txxxx` nhận qua WebSocket (không phải binding thật).

| File | Phủ đặc điểm | `data-tag` |
|---|---|---|
| `tank.svg` | bồn; gradient tuyến tính; `clipPath`; mức chất lỏng | T0001 (`#tank-level`) |
| `motor.svg` | motor; gradient; nhóm; đèn trạng thái | T0002 (`#motor-status`) |
| `valve.svg` | van; `polygon` trong nhóm | T0003 (`#valve-body`) |
| `pipe.svg` | ống; `polyline`; `stroke-dasharray`; `marker` | T0004 (`#pipe-fluid`) |
| `gauge.svg` | đồng hồ; cung `path`; `transform` xoay lồng nhau | T0005 (`#gauge-needle`) |
| `icon-set.svg` | 4 icon (cảnh báo, bơm, cảm biến, người dùng) | T0006 (`#icon-sensor`) |
| `nested-groups.svg` | nhóm lồng 8 cấp có `transform` cộng dồn | T0007 (`#nested-target`) |
| `gradients.svg` | `linearGradient` kế thừa (`xlink:href`), `radialGradient`, `userSpaceOnUse`, `pattern` | T0008 (`#pattern-target`) |
| `clippath.svg` | `clipPath` theo đối tượng và theo `userSpaceOnUse` | T0009 (`#clip-fill`) |
| `use-symbol.svg` | `symbol` + `use` (có `currentColor`), `use` tới `g` trong `defs` | T0010 (`#use-target`) |
| `process-overview.svg` | màn hình tổng hợp: bồn, ống, van (`use`), motor, ô số | T0011–T0014 |
| `unsafe-elements.svg` | **fixture an toàn**: `script`, `foreignObject`, `onload`/`onclick`, `javascript:` href, ảnh ngoài | T0015 |
| `real-libreoffice-draw.svg` | LibreOffice Draw thật: 280 phần tử, `font`/`glyph`, mm, DOCTYPE, không còn `data-tag` | — |
| `synthetic-illustrator-saveas.svg` | Illustrator "Save As" cũ: DOCTYPE + ENTITY, `<switch>` + `foreignObject` + `i:pgf`, class `.st0`, font PostScript | T0021 |
| `synthetic-illustrator-export.svg` | Illustrator "Export As": `<style>.cls-N`, id `linear-gradient`, `data-name`, `symbol` | T0022 |
| `synthetic-coreldraw.svg` | CorelDRAW: mm + viewBox 100 đơn vị/mm, CSS trong CDATA (`.fil0/.str0`), id `_x0020_` | T0023 |
| `synthetic-drawio.svg` | draw.io: nhãn HTML trong `foreignObject`, `<text>` dự phòng trong `<switch>`, thuộc tính `content` | T0024 |
| `synthetic-inkscape-features.svg` | Inkscape: layer, mm, `flowRoot` (Chrome không hiện), `tspan sodipodi:role="line"`, ảnh liên kết `file:///` | T0025 |
| `factory-isometric-stress.svg` | **stress**: 4,34 MB, 27.029 phần tử, độ sâu 5 (13.582 `line`, 10.304 `polygon`, 2.082 `rect`, 492 `path`, 170 `text`, 52+11 gradient, 3 `pattern`, 2 `filter`, 2 `clipPath`, 1 `marker`, 8 `style`) | — |

## Điểm cần quyết định từ `factory-isometric-stress.svg`

Đối chiếu với Master Plan §7.3 (giới hạn import mặc định: 5 MB, **20.000 node**, độ sâu 32):

- Kích thước 4,34 MB: **trong** giới hạn. Độ sâu 5: **trong** giới hạn.
- Số phần tử 27.029: **vượt** giới hạn node 20.000. Nếu giữ nguyên giới hạn, importer sẽ từ chối chính file mẫu này.
- Dùng `pattern`, `filter` (làm mờ), `<style>` nội tuyến: §7.3 chỉ cho "giữ nguyên hiển thị, không chỉnh sửa sâu, có cảnh báo" và yêu cầu tách CSS nội tuyến khi chuẩn hóa. `marker` không có trong danh sách phần tử MVP của §7.3.
- Khoảng 87% số phần tử (`line`/`polygon`) nằm trong hai nhóm: `g18008` (17.932 `line`/`polygon`) và `g6432` (5.627). Đó là hình minh họa máy móc được vector hóa thành hàng nghìn polygon nhỏ mang class `cls-N` (đã kiểm tra mẫu). Gộp chúng thành ít `path` hơn, hoặc coi mỗi minh họa là một đối tượng không chỉnh sửa, nhiều khả năng đưa file về dưới 20.000 node (chưa thử; cần kiểm tra hình ảnh không đổi).

Chưa quyết định: nâng giới hạn node, hay yêu cầu tối ưu file khi thiết kế. Đo thực tế trên Chrome PC (≤ 1 s từ BL335): [`docs/reports/svg-load.md`](../../../docs/reports/svg-load.md).

## Cần thêm: SVG xuất từ Illustrator và CorelDRAW (T036)

Để đạt FR-011 và để importer Sprint 2 được thử trên dữ liệu thật, cần **ít nhất 3 file** xuất trực tiếp từ Adobe Illustrator và CorelDRAW (không qua Inkscape), mỗi phần mềm tối thiểu 1 file. Gợi ý nội dung (một file có thể gom nhiều ý):

- thiết bị công nghiệp quen thuộc: bồn, motor, van, ống, đồng hồ; có **nhóm lồng nhau**, gradient, `clipPath`/mặt nạ, văn bản;
- cùng một hình xuất **hai kiểu** nếu phần mềm cho chọn: thuộc tính trình bày (`fill="..."`) và CSS nội tuyến (`<style>` với class như `.cls-1`); tên file ghi rõ kiểu xuất;
- ít nhất một file có phần tử dùng lại (`use`/`symbol`) và một file có văn bản;
- không cần dữ liệu nhạy cảm; nên dùng hình minh họa mà dự án được phép lưu trong repo.

Khi thêm: đặt vào thư mục này, chạy `npm run svg:inspect -- tests/fixtures/svg` để xem phần mềm nhận diện được và cảnh báo định dạng, ghi vào bảng ở trên (tên file, phần mềm và phiên bản, kiểu xuất, đặc điểm), rồi chạy lại `npm run build:web` và `node tools/measure/svg-load.mjs`.

## Chạy lại

```powershell
npm run svg:inspect -- tests/fixtures/svg   # nhận diện phần mềm xuất + cảnh báo khác biệt định dạng
npm run build:web                     # chép fixture vào apps/runtime-web/dist/screens + nén gzip
node tools/measure/svg-load.mjs http://<host>:<port>/ --runs 3 --out docs/reports/svg-load.json
```
