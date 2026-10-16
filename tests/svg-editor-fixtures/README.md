# Fixture của trình vẽ SVG (feature 011, T151)

Dữ liệu cho T152–T155, T165; đặc tả ở `specs/011-pilot-hardening/contracts/svg-editor.md` §2, §7, §10, §12 (FR-109, FR-111, FR-117; SC-030, SC-034). Mọi tệp do dự án tạo, giấy phép **CC0**; không có logo, ký hiệu hay phông có bản quyền.

Sinh và kiểm: `node tests/svg-editor-fixtures/make-fixtures.mjs` (ghi), `--check` (thoát 1 khi tệp đã commit lệch). Test: `packages/svg-edit/src/roundtrip.test.ts` (round-trip, uid, hộp bao), `clipboard.test.ts` (bộ độc), `fuzz.test.ts` và `tools/fuzz/svg-sanitize.mjs` (kho mầm).

## 1. Mười tệp "đã nhập" (`imported-*.svg`): sinh bằng `importSvg`

Fixture của feature 008 (`tests/fixtures/svg-import/`) chạy qua `importSvg` (UID theo seed `svg-editor:<tên>`), đúng như Studio lưu vào project rồi mở trong trình vẽ:

| Tệp | Nguồn | Thật hay mô phỏng |
|---|---|---|
| `imported-inkscape-01-tank-process.svg` … `imported-inkscape-04-pipes-flow.svg` | xuất bởi **Inkscape 1.4.3 thật** (xem `tests/fixtures/svg-import/README.md` §1) | THẬT (qua bộ nhập) |
| `imported-illustrator-01-saveas-legacy.svg` … `-03-export-screens.svg` | viết tay theo đặc trưng Illustrator | **MÔ PHỎNG** (không phải Adobe Illustrator xuất) |
| `imported-corel-01-mm-css.svg` … `-03-blend-pattern.svg` | viết tay theo đặc trưng CorelDRAW | **MÔ PHỎNG** (không phải CorelDRAW xuất) |

Vì đã qua bộ nhập, cách ghi là của `writeSvg` (mỗi phần tử một dòng, không thụt). Đặc trưng riêng của phần mềm vẽ (namespace, `sodipodi:namedview`, `<style>`) đã bị bộ nhập loại hoặc chuyển; kết luận "đạt trên Illustrator/CorelDRAW" vẫn chỉ là **đạt trên mô phỏng** cho tới khi có tệp thật (T120 của feature 008).

Tệp Inkscape chưa qua bộ nhập (mở thẳng trong trình vẽ): `roundtrip.test.ts` dùng trực tiếp `tests/fixtures/svg-import/inkscape-01-tank-process.svg` (loại namespace, có báo cáo, lưu lần hai cùng byte lần một).

## 2. Mười sáu tệp viết tay: MÔ PHỎNG

Viết tay để kiểm **giữ nguyên byte** với nhiều cách ghi (thụt dấu cách/tab, nháy đơn, chú thích, khai báo XML, BOM và CRLF, thực thể, CDATA, style nội tuyến có khoảng trắng). Mỗi tệp có chú thích `MÔ PHỎNG` khi phù hợp; không tệp nào do phần mềm vẽ sinh ra.

| Tệp | Nội dung |
|---|---|
| `hand-pump-symbol.svg`, `hand-valve-symbol.svg` | ký hiệu tay (bơm, van); tab và nháy đơn |
| `nested-transform-3-levels.svg` | transform lồng 3 tầng: xoay, `skewX`, co không đều, `rotate(a cx cy)`, `matrix` |
| `units-mm.svg` | gốc `210mm × 148mm`; `mm`, `pt`, `cm` ở phần tử (không bake được) |
| `inline-style.svg` | `style` nội tuyến có khoảng trắng và `;` cuối |
| `gradients.svg` | `linearGradient`, `radialGradient`, `gradientTransform`, `xlink:href` nối gradient, sơn dự phòng |
| `use-symbol.svg` | `symbol` có `viewBox`, `use` với `xlink:href` và `href`, `use` có transform |
| `mask.svg`, `filter.svg`, `nested-svg.svg`, `clip-pattern-marker.svg` | phần tử giữ nguyên (mask, filter, svg lồng, pattern, marker) và `clipPath` |
| `layers.svg` | lớp `<g data-mat-layer>` (T166), `data-mat-name`, phần tử ở lớp mặc định |
| `text-tspan-vi.svg` | chữ tiếng Việt, `&amp;`, `&#x2013;`, `tspan`, `xml:space`, `title` |
| `paths-mixed.svg` | path đa giác tuyệt đối/tương đối (sửa nút được) và path cong C S Q T A (khóa sửa nút) |
| `crlf-bom.svg` | BOM + CRLF + khai báo XML |
| `blank-new.svg` | tệp của "Mới: SVG trống" (800 × 600) |

## 3. `expected.json`

Mỗi fixture: `sha256`, `bytes` (của tệp), `canonicalSha256` (của `serialize(parseDrawDoc(tệp))`, phải bằng `sha256`: mở rồi lưu cùng byte), `elements` (kể cả gốc), `removed` (số mục bị loại khi mở: 0), `rebuilt` (mô hình dựng lại từ DOM: false), `uids` (theo thứ tự tài liệu), `bboxes` (uid → `[x, y, rộng, cao]` trong hệ tài liệu, làm tròn 3 chữ số; chữ là **ước tính** 0,6 × cỡ × số ký tự, không phải số đo của Chrome).

## 4. `malicious/`: mười SVG độc để dán (SC-034)

| Tệp | Kết quả mong đợi khi dán |
|---|---|
| `m01-script.svg` | lọc: bỏ `script` (cả CDATA) — `R_SCRIPT` |
| `m02-on-event.svg` | lọc: bỏ `onload`, `onclick`, `onmouseover`, `onfocusin` — `R_EVENT_ATTR` |
| `m03-foreign-object.svg` | lọc: bỏ `foreignObject` (iframe bên trong) — `R_FOREIGN` |
| `m04-external-href.svg` | lọc: `href`/`xlink:href`/`url()` ra ngoài — `R_HREF_EXTERNAL` |
| `m05-data-uri.svg` | lọc: ảnh `data:image/svg+xml`, `use` trỏ `data:text/html` |
| `m06-use-bomb.svg` | từ chối `SVG_LIMIT` (10 tầng × 10 `use`) |
| `m07-depth-33.svg` | từ chối `SVG_LIMIT` (độ sâu 33) |
| `m08-nodes-20001.svg` | từ chối `SVG_LIMIT` (20.001 phần tử kể cả gốc) |
| `m09-style-import.svg` | lọc: `<style>` có `@import`, `@font-face`, `url()` ngoài trong `style` |
| `m10-javascript-url.svg` | lọc: `javascript:` trong `a`, `xlink:href`, `url()` |

`expect.json`: `outcome` (`sanitized` hoặc `rejected`), `code` (khi từ chối), `forbid` (chuỗi con không được còn, không phân biệt hoa thường), `reported` (mã phải có trong báo cáo của bộ nhập).

## 5. Chưa làm

So ảnh dựng lại ≤ 1 % (`render-diff.test.ts` với Chrome headless) chưa có: phần không sửa giữ đúng byte nên ảnh không đổi; ca bake được so bằng hộp bao với bản tham chiếu không bake (`bake.test.ts`, sai số ≤ 0,001). Bộ so ảnh cần Chrome, để cho task e2e (T157/T164).
