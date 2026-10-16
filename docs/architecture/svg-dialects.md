# Khác biệt định dạng SVG giữa các phần mềm vẽ

Ngày 2026-10-10 (Sprint 0). Đầu vào cho SVG importer (Sprint 2) và cách runtime nhúng màn hình (Sprint 1). Công cụ đi kèm: `npm run svg:inspect -- <file|thư mục>` ([tools/svg-inspect](../../tools/svg-inspect/svg-inspect.mjs)); trang thử `apps/runtime-web` hiện "Nguồn" và cảnh báo cho từng màn hình.

## Tóm tắt

- File Inkscape thật của dự án hiển thị trên Chrome **giống Inkscape**. Không có vùng sai màu hay sai hình; chỉ khác ở viền chữ và khử răng cưa.
- Mỗi phần mềm ghi SVG theo một kiểu riêng. Phần lớn khác biệt vô hại khi mở **một** file trên Chrome, nhưng có 4 loại làm **mất hoặc sai nội dung**:
  - chữ khung của Inkscape (`flowRoot`) bị mất trên Chrome;
  - ảnh liên kết (không nhúng) chỉ hiện trên máy người vẽ;
  - font Illustrator ghi theo tên PostScript bị đổi sang font mặc định;
  - nhãn HTML của draw.io chỉ còn bản chữ dự phòng.
- Rủi ro lớn nhất khi **ghép nhiều SVG vào một trang**: class CSS và id trùng tên giữa các file làm sai màu và sai gradient. Thí nghiệm đã tái hiện được lỗi này. Đặt mỗi SVG trong **Shadow DOM** riêng thì hết.
- File thật của dự án có 27.029 phần tử, **vượt** giới hạn import 20.000 node (Master Plan §7.3). Cần quyết định.

## Cách kiểm chứng

| # | Thử nghiệm | Kết quả |
|---|---|---|
| 1 | Inkscape 1.4.3 xuất PNG từ file thật (`svg/file _SVG.svg`, xuất từ Inkscape 1.4.4). Chrome 154 mở chính file đó. So từng điểm ảnh ở 1600×900 | 1,66% điểm ảnh khác rõ (> 64/255), 1,87% khác nhẹ; độ lệch trung bình 3,4/255. Chỗ khác chỉ nằm ở viền chữ, viền nét và khử răng cưa; không có vùng tô khác màu |
| 2 | 5 fixture **mô phỏng** đặc trưng Illustrator (Save As và Export As), CorelDRAW, draw.io, Inkscape: mở thẳng trên Chrome, qua trang thử (có bộ lọc), và với Inkscape cho fixture Inkscape | Xem bảng theo phần mềm bên dưới |
| 3 | Ghép 2 SVG kiểu Illustrator Export vào cùng một trang. Hai file có `.cls-2` khác màu và cùng id `linear-gradient` khác màu | Chung DOM: file A lấy màu `.cls-2` của B (sai), file B lấy gradient của A (sai). Mỗi file một Shadow DOM: cả hai đúng |
| 4 | `svg-inspect` trên file thật và fixture | Nhận đúng phần mềm và các cảnh báo; đã có test Vitest |

Fixture mô phỏng là SVG **viết tay theo đặc trưng đã biết** của từng phần mềm, không phải file xuất thật. Cần kiểm lại với file xuất thật khi có (T036).

## Khác biệt theo phần mềm

| Phần mềm | Dấu hiệu nhận diện | Khác biệt định dạng | Ảnh hưởng trên Chrome | Xử lý |
|---|---|---|---|---|
| **Inkscape** (file thật của dự án) | `inkscape:version`, namespace `sodipodi`/`inkscape`, `<sodipodi:namedview>`, metadata RDF | layer là `<g inkscape:groupmode="layer">`; thuộc tính `style` dài; đơn vị mm hay gặp; `-inkscape-font-specification`; chữ khung `flowRoot` (SVG 1.2) hoặc `shape-inside` (SVG 2); ảnh có thể chỉ **liên kết** `file:///C:/…` | `flowRoot`: **chữ biến mất** (Inkscape vẫn hiện). Ảnh liên kết: không hiện trên máy khác. Namespace riêng: bị bỏ qua, vô hại | Trang thử: bỏ namespace lạ, bỏ ảnh liên kết, cảnh báo `flowRoot`/`shape-inside`. Importer: đổi chữ khung thành chữ thường hoặc từ chối; yêu cầu nhúng ảnh; giữ `inkscape:label` làm tên hiển thị |
| **Illustrator — Save As (kiểu cũ)** | comment `Generator: Adobe Illustrator …`, namespace `ns.adobe.com` | `<!DOCTYPE …[<!ENTITY …>]>`; `<switch>` + `<foreignObject requiredExtensions=…>` + `<i:pgf>` (khối dữ liệu chỉnh sửa riêng, có thể rất lớn); class `.st0…`; id `SVGID_1_`; `x="0px"`; `enable-background`; font tên PostScript `'MyriadPro-Regular'` | Chrome tự giải ENTITY và hiện hình đúng. **Font bị đổi** sang font mặc định (serif) vì tên PostScript không phải tên họ font | Trang thử: bỏ foreignObject và `i:pgf`, cảnh báo DTD/ENTITY và font. Importer: bỏ DTD trước khi parse (chống entity expansion); ánh xạ font PostScript sang tên họ font hoặc yêu cầu chuyển chữ thành đường nét |
| **Illustrator — Export As (kiểu mới)** | `data-name`, class `.cls-N`, id `Layer_1` | `<defs><style>.cls-1{…}</style>`; id gradient cố định `linear-gradient`, `linear-gradient-2`…, **giống nhau giữa mọi file**; font có dự phòng (`ArialMT, Arial`) | Một file: đúng. **Ghép nhiều file: trùng class và id gây sai màu/gradient** (thử nghiệm 3) | Importer: chuyển CSS sang thuộc tính theo đúng cascade rồi bỏ class; thêm tiền tố id theo từng file và sửa mọi `url(#…)`/`href`. Runtime: Shadow DOM cho mỗi màn hình |
| **CorelDRAW** | comment `Creator: CorelDRAW`, namespace `xodm`, `metadata id="CorelCorpID…"` | đơn vị mm với viewBox 100 đơn vị/mm; CSS trong `<![CDATA[ … ]]>` với class `.fil0/.str0/.fnt0`; id thoát ký tự `Layer_x0020_1`; `style` gốc có `shape-rendering`, `fill-rule:evenodd` | Hiển thị đúng | Importer: chuẩn hóa đơn vị theo viewBox; chuyển CSS sang thuộc tính; giữ `fill-rule` |
| **draw.io** | thuộc tính `content` chứa `mxfile` | nhãn chữ là **HTML** trong `<foreignObject>` kèm `<text>` dự phòng trong `<switch>`; thuộc tính `content` chứa cả sơ đồ gốc (có thể lớn); link "Text is not SVG" | Sau khi bỏ foreignObject, Chrome dùng chữ dự phòng: **mất xuống dòng và định dạng HTML** | Trang thử: bỏ foreignObject, giữ nhánh dự phòng. Importer: cảnh báo; khuyên xuất draw.io với tùy chọn chuyển chữ thành SVG |
| **LibreOffice Draw** (file **xuất thật**, LibreOffice 26.2) | namespace `http://xml.openoffice.org/svg/export` | `version="1.2"`; đơn vị mm với viewBox 1/100 mm; DOCTYPE; nhiều namespace (`ooo`, `presentation`, `smil`, `anim`) và tiền tố `svg:` gán cho namespace **không phải SVG**; **font SVG nhúng** (`<font>`, `<glyph>`); gradient đổi thành nhiều `path` theo bậc màu (31 → 280 phần tử); **mọi `id` và `data-*` gốc bị mất** | Hình gần như giống bản gốc; chữ dùng font hệ thống vì Chrome không hỗ trợ font SVG | Importer: bỏ `<font>`; không dựa vào `id`/`data-*` để nối binding khi file đã qua phần mềm khác (ADR-003); cảnh báo phình số phần tử |

Chưa kiểm chứng (cần file thật): Illustrator/CorelDRAW xuất thật, Visio, AutoCAD (DWG → SVG), Figma.

**Bằng chứng từ file LibreOffice thật** (`tests/fixtures/svg/real-libreoffice-draw.svg`, tạo bằng cách mở `process-overview.svg` trong LibreOffice Draw rồi xuất SVG):
- Hình hiển thị trên Chrome gần như giống hệt bản gốc.
- Cấu trúc đổi hoàn toàn: 31 → 280 phần tử, mất toàn bộ `id` và `data-tag`, thêm 3 font SVG nhúng.
- Hệ quả: một màn hình đã gắn binding, nếu được người vẽ mở và xuất lại bằng phần mềm khác, sẽ **mất mọi điểm neo binding**. Đây là lý do importer phải đối chiếu lại theo cấu trúc và hình học (ADR-003), không chỉ theo `id`.

## File thật của dự án (`svg/file _SVG.svg`)

- Xuất từ Inkscape 1.4.4. Kích thước 4,34 MB (gzip 554 KB), **27.029 phần tử**, độ sâu 5.
- Có 8 khối `<style>` với class kiểu `.cls-N` (CSS nội tuyến, kiểu hay gặp khi dán hình từ file khác vào Inkscape). **366 class được định nghĩa khác nhau ở nhiều khối, ảnh hưởng 10.411 phần tử.** Ví dụ `.cls-1` có 7 định nghĩa với 7 màu.
  - Trong một file, Chrome và Inkscape cùng áp quy tắc của khối sau, nên hình hiển thị giống nhau (thử nghiệm 1).
  - Hai trường hợp sẽ làm đổi màu: ghép file này với SVG khác vào cùng trang, hoặc importer chuyển CSS sang thuộc tính mà không theo đúng thứ tự cascade.
- Khoảng 87% phần tử nằm trong hai nhóm (`g18008`: 17.932, `g6432`: 5.627 `line`/`polygon`). Đó là hình minh họa máy được vector hóa thành nhiều polygon nhỏ.
- Có `filter` (làm mờ) ×2 và `pattern` ×3: theo §7.3 chỉ cho hiển thị, không cho chỉnh sửa sâu.
- Trên Chrome: hiển thị ≤ 1 s từ BL335 ([svg-load.md](../reports/svg-load.md)).

## Yêu cầu đề xuất cho importer (Sprint 2)

1. **DTD:** bỏ `<!DOCTYPE>` trước khi parse. Chỉ chấp nhận ENTITY namespace đã biết của Adobe; ENTITY khác thì từ chối file (chống entity expansion).
2. **Allowlist** phần tử và thuộc tính SVG trên DOM đã parse (Constitution V). Bỏ mọi namespace của phần mềm vẽ sau khi lấy thông tin cần (tên layer).
3. **CSS → thuộc tính trình bày** theo đúng cascade (thứ tự khối, độ ưu tiên selector, `style` nội tuyến thắng), rồi bỏ `<style>` và class. Kiểm tra bằng cách so ảnh trước và sau chuyển đổi trên Chrome.
4. **Id:** khi ghép nhiều file vào một màn hình, thêm tiền tố id theo từng file và cập nhật mọi tham chiếu `url(#…)`, `href`, `clip-path`, `mask`, `filter`, `marker-*`.
5. **Chữ:** `flowRoot`/`shape-inside` thì cảnh báo hoặc chuyển thành chữ thường. Font PostScript thì dùng bảng ánh xạ (ví dụ `MyriadPro-Regular` → `Myriad Pro`, `ArialMT` → `Arial`) hoặc yêu cầu chuyển chữ thành đường nét.
6. **foreignObject:** dùng nhánh dự phòng của `<switch>`; không có dự phòng thì báo mất nội dung.
7. **Ảnh:** chỉ nhận ảnh nhúng `data:image/png|jpeg|webp`; ảnh liên kết thì báo lỗi kèm hướng dẫn nhúng.
8. **Đơn vị và viewBox:** bảo đảm có viewBox; quy đổi mm/pt/in sang px.
9. **Giới hạn:** 5 MB / 20.000 node / độ sâu 32 (§7.3). File thật của dự án vượt giới hạn node. Cần chọn một trong hai:
   - nâng giới hạn, vì số đo cho thấy Chrome vẫn dựng file này dưới 1 s;
   - gộp các polygon cùng class thành `path` khi import (chưa thử).
10. **Runtime:** mỗi màn hình hoặc symbol trong Shadow DOM riêng, hoặc importer bảo đảm không còn class/id trùng. Đây là một quyết định kiến trúc, nên ghi ADR khi vào Sprint 1–2.

## Đã áp dụng trong trang thử Sprint 0

`apps/runtime-web` (không phải importer thật):
- Lọc theo namespace và theo `localName`. Chặn `href`/`on*` nguy hiểm ở mọi tiền tố namespace, chặn SMIL đổi `href`, chặn CSS gọi ra ngoài (sau khi giải escape).
- Bỏ foreignObject và ảnh liên kết.
- Bù viewBox từ width/height.
- Mỗi màn hình trong Shadow DOM.
- Hiển thị nguồn và cảnh báo định dạng.

Có test cho từng kiểu ở `src/sanitize.test.ts` và `src/inspect.test.ts`.

## Màn hình v1 (feature 007, định dạng 0.3.0)

- SVG không còn là cả màn hình: nó là một **item `svg`** (tối đa 8 mỗi màn hình) nằm trong khung `size` của màn hình, có vị trí, cỡ, `viewBox` và `fit` riêng. Mỗi item `svg` có Shadow DOM riêng (cùng bộ lọc và `DomApplier` như trên), nên hai item không đụng class/id của nhau (kiểm bằng test `mat-screen.test.ts` và `web-it screens`).
- Widget (card, nút, biểu đồ…) là phần tử HTML nằm **ngoài** SVG, trong cùng khung, xếp lớp theo thứ tự `items`. Không có widget nằm bên trong SVG và SVG không chứa `foreignObject` (vẫn bị lọc bỏ).
- File SVG và file binding của item được runtime phục vụ ở `/project/<file>` (danh sách cho phép gồm cả `*.bindings.json`; web-it `screens` phát hiện bản 0.6.0 đầu thiếu file binding).
- Project 0.1 và 0.2 vẫn chạy: trang hiểu màn hình cũ như một màn hình có một item `svg` phủ kín (`toScreenModel`), binding lấy từ thân `projects/active`.

## Importer thật (feature 008, `@mat/svg-import`, 2026-10-15)

Importer thay "Yêu cầu đề xuất cho importer (Sprint 2)" ở trên bằng mã chạy được. Đường ống `importSvg` (hàm thuần, chạy trong Web Worker ở Studio, cần `DOMParser` của trình duyệt hoặc jsdom): tiền xử lý byte và DTD bằng bộ quét ký tự (không regex) → parse → đếm thô → chuẩn hóa trước (`switch`, `flowRoot`, font SVG) → **allowlist** dùng chung với trang runtime (`@mat/svg-renderer`) → CSS thành thuộc tính (đúng cascade) → chuẩn hóa sau (đơn vị, `viewBox`, font, `id` trùng, làm tròn số) → Tối ưu (tùy chọn) → gán UID (`data-mat-uid`) và tên (`data-mat-name`) → ghi SVG tất định và **báo cáo**. Nhập lại thêm `previous` để đối chiếu giữ UID ([ADR-023](../adr/023-svg-import-allowlist-uid.md)). Cách xuất đúng từ từng phần mềm: [guide svg-export](../guides/svg-export.md); API: [packages/svg-import/README.md](../../packages/svg-import/README.md).

**Mức đáp ứng của 10 yêu cầu đề xuất:**

| # | Yêu cầu | Trạng thái |
|---|---|---|
| 1 | DTD | Đã làm. Chỉ ENTITY namespace Adobe đã biết được thay rồi bỏ DTD; ENTITY khác, `SYSTEM`, `PUBLIC`, tham số: `E_IMPORT_DTD` |
| 2 | Allowlist trên DOM đã parse | Đã làm, một bản mã cho Studio và trang (`allowlist.ts`); bỏ `sanitize` denylist cũ |
| 3 | CSS thành thuộc tính theo cascade | Đã làm với tập con (xem Giới hạn); so ảnh trước sau trên Chrome: 10/10 fixture ≤ 0,5 % điểm ảnh khác |
| 4 | Tiền tố id khi ghép nhiều file | **Không dùng cách này**: mỗi item `svg` có Shadow DOM riêng (007) nên `id` không đụng nhau giữa file; `id` trùng **trong một file** thì đổi `id-2`, `id-3` và cập nhật tham chiếu (`C_DUP_ID`) |
| 5 | Chữ `flowRoot`, font PostScript | Đã làm: `flowRoot` thành `text` một dòng (`C_FLOWROOT`, `W_IMPORT_FLOWTEXT_NOWRAP`); bảng font `data/fonts.json` (`C_FONT_MAP`), tên lạ thêm `sans-serif` (`W_IMPORT_FONT_FALLBACK`) |
| 6 | `foreignObject` và `switch` | Đã làm: `switch` thay bằng nhánh dự phòng đầu không phải `foreignObject` (`C_SWITCH`), `foreignObject` bị loại (`R_FOREIGN`) |
| 7 | Ảnh | Đã làm: chỉ `data:image/png\|jpeg\|gif\|webp;base64,` đúng chữ ký, ≤ 16 ảnh và ≤ 2 MiB; ảnh liên kết (`R_IMAGE_LINKED`), ảnh sai loại hoặc chữ ký (`R_IMAGE_BAD`, gồm `data:image/svg+xml`), quá giới hạn (`R_IMAGE_LIMIT`) bị bỏ |
| 8 | Đơn vị và `viewBox` | Đã làm (`C_UNITS`; thiếu cả `viewBox` lẫn kích thước: `E_IMPORT_SIZE`) |
| 9 | Giới hạn 20.000 node | Chọn **cả hai** hướng: giữ trần 20.000 phần tử sau chuẩn hóa và thêm **Tối ưu** (gộp hình cùng kiểu). `factory-isometric-stress.svg`: 27.029 thô → 10.307 phần tử, ảnh khác 0,463 % |
| 10 | Runtime: Shadow DOM riêng | Đã làm (item `svg` có Shadow DOM riêng, 007) |

**Bảng loại và chuyển** (mã ổn định; câu tiếng Việt ở `packages/svg-import/src/i18n/vi-import.ts`):

| Nhóm | Mã | Việc làm |
|---|---|---|
| Loại phần tử | `R_SCRIPT`, `R_FOREIGN`, `R_SMIL`, `R_META`, `R_NAMESPACE`, `R_ELEMENT_NOT_ALLOWED`, `R_EMPTY`, `R_UNUSED_DEF`, `R_FONT_SVG` | bỏ phần tử (và con, trừ `a` được mở vỏ); namespace Inkscape, Adobe, Corel, LibreOffice bị bỏ sau khi lấy nhãn làm tên |
| Loại thuộc tính và giá trị | `R_EVENT_ATTR`, `R_ATTR_NOT_ALLOWED`, `R_VALUE_INVALID`, `R_HREF_EXTERNAL`, `R_URL_EXTERNAL`, `R_DATA_ATTR` | bỏ thuộc tính; `data-*` chỉ giữ `data-mat-uid`, `data-mat-name` |
| Loại CSS | `R_CSS_PROP`, `R_CSS_RULE`, `R_CSS_AT` | bỏ thuộc tính CSS ngoài danh sách, luật có bộ chọn không hỗ trợ, `@import`, `@media`, `@font-face`, `@keyframes` |
| Loại khác | `R_PI`, `R_DTD`, `R_IMAGE_LINKED`, `R_IMAGE_BAD`, `R_IMAGE_LIMIT`, `R_FILTER_HEAVY`, `R_FILTER_LIMIT`, `R_DANGLING_REF`, `R_TEXT_LONG` | bỏ chỉ thị xử lý, DOCTYPE, ảnh, bộ lọc quá giới hạn, tham chiếu `id` không có, cắt chữ quá 4.096 ký tự |
| Chuyển đổi | `C_CSS`, `C_UNITS`, `C_SWITCH`, `C_FLOWROOT`, `C_FONT_MAP`, `C_ENTITY`, `C_XLINK`, `C_ROUND`, `C_DUP_ID` | giữ hình, đổi biểu diễn |
| Cảnh báo | `W_IMPORT_CSS_PARTIAL`, `W_IMPORT_FLOWTEXT_NOWRAP`, `W_IMPORT_NO_DRAWABLE`, `W_IMPORT_FONT_FALLBACK`, `W_IMPORT_HEAVY` | nhập được, cần xem lại |
| Từ chối | `E_IMPORT_LIMIT`, `E_IMPORT_PARSE`, `E_IMPORT_ENCODING`, `E_IMPORT_ROOT`, `E_IMPORT_DTD`, `E_IMPORT_USE_BOMB`, `E_IMPORT_SIZE`, `E_IMPORT_EXT` | không dựng gì, hiện mã và hướng dẫn |

**Theo phần mềm (đã đo trên fixture):** Inkscape (4 file xuất thật): giữ hình, bỏ `sodipodi`, `inkscape`, `rdf`, lấy `inkscape:label` làm tên; ảnh khác bản gốc 0 đến 0,496 %. Illustrator (3 file **mô phỏng**): thay entity `ns_*` rồi bỏ DTD, `switch` về nhánh dự phòng, bỏ `i:pgf` và namespace Adobe, `.cls-N` thành thuộc tính; khác bản gốc ≤ 0,118 %. CorelDRAW (3 file **mô phỏng**): giữ `viewBox`, `mm` ở `width/height` về px, CSS trong CDATA `.fil0/.str0/.fnt0` thành thuộc tính, id `_x0020_` giữ nguyên. Số đo: [008-fixtures.json](../reports/008-fixtures.json).

**Giới hạn (nói thật):**

- **Illustrator và CorelDRAW chưa kiểm trên file thật** (6 trong 10 fixture là mô phỏng đặc trưng cấu trúc từ tài liệu và file mẫu công khai): "đạt trên mô phỏng", chờ T120 (người cung cấp file).
- **CSS chỉ hỗ trợ tập con:** bộ chọn thẻ, `.lớp`, `#id`, ghép và danh sách; bộ chọn hậu duệ, `>`, `+`, `:hover`, `[attr]`, `@media`, `@keyframes` bị bỏ và có `W_IMPORT_CSS_PARTIAL` khi ảnh hưởng phần tử. Màu hoặc kiểu có thể sai nếu file dựa vào chúng.
- **Chữ:** `flowRoot` mất xuống dòng; font ngoài bảng ánh xạ rơi về `sans-serif` (kích thước chữ có thể lệch); không nhúng font; không hỗ trợ `foreignObject` (chữ HTML của draw.io chỉ còn nhánh dự phòng).
- **Ảnh:** chỉ ảnh raster nhúng base64; ảnh liên kết và `data:image/svg+xml` bị bỏ (cần nhúng lại ảnh raster ở phần mềm vẽ).
- **Không giữ:** hoạt ảnh SMIL, script, liên kết `a` (giữ nội dung), bộ lọc `feTurbulence`, `feDisplacementMap`, `feConvolveMatrix`, `feMorphology`, `feImage`; bộ lọc nặng bị kẹp (`stdDeviation` ≤ 30, ≤ 8 bộ lọc).
- **Tối ưu** chỉ gộp hình `line/polyline/polygon/path` liền kề cùng cha và cùng thuộc tính; đã đo ảnh khác ≤ 1 % (0,463 % trên file stress) nhưng chỉ trên **một** file thật lớn.
- **Nhập lại** giữ UID theo UID, `id`, đường dẫn cấu trúc, hình học; ngưỡng hiệu chỉnh trên 7 cặp (215 phần tử): 97,7 % khớp đúng, **0 gán sai**, phần còn lại vào danh sách chọn hoặc mồ côi. Tập đo còn nhỏ: không chứng minh được an toàn cho mọi cách chỉnh sửa; phần tử hai bản không phân biệt được luôn do người chọn.
- **Báo cáo chưa đủ chi tiết ở mục thuộc tính:** mục loại thuộc tính từ allowlist chưa nêu tên từng thuộc tính và vị trí ví dụ (xem [008-sc019.md](../reports/008-sc019.md)).
- File thật lớn qua jsdom chậm hơn Chrome: nhập 20.000 phần tử 2,6 s (jsdom), file stress có Tối ưu 9,3 s trong jsdom; ở Studio chạy trong Worker của Chrome (SC-018 đo ở `svg-perf.e2e.mjs`).
