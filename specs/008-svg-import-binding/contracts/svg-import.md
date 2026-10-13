# Contract: nhập SVG (`@mat/svg-import`) và allowlist (`@mat/svg-renderer`)

**Feature**: [spec.md](../spec.md) FR-011…FR-029, FR-060, FR-062 · **Research**: R2–R7, R18, R19, R21 · **ADR**: [023](../../../docs/adr/023-svg-import-allowlist-uid.md) (và [ADR-003](../../../docs/adr/003-element-uid.md), [ADR-007](../../../docs/adr/007-screen-isolation.md))

Hai package:

- `@mat/svg-renderer` (có sẵn; dùng ở trang runtime, Studio, CLI): `parseSvg`, **`sanitizeSvg` (allowlist)**, `mountScreen`, `inspectSvg`, các bảng `ALLOW_*` và các hàm kiểm giá trị (§2–§4).
- `@mat/svg-import` (mới; chỉ Studio, CLI, test; **không** vào gói của trang): `importSvg`, `matchSvg`, `optimizeSvg`, `writeSvg`, bộ phân tích CSS, bộ quét tiền xử lý, bộ sinh UID.

## 1. API

```ts
// @mat/svg-import
export interface ImportLimits {
  maxBytes: number;          // 5 * 1024 * 1024
  maxNodes: number;          // 20_000 (sau chuẩn hóa và tối ưu)
  maxDepth: number;          // 32
  rawNodeCap: number;        // 100_000 (thô, trước làm sạch)
  useExpansionCap: number;   // 100_000 (phần tử hiệu dụng sau mở `use`)
  maxFilters: number;        // 8
  maxFilterPrimitives: number; // 64
  maxImages: number;         // 16
  maxImageBytes: number;     // 2 * 1024 * 1024 (tổng sau giải mã)
}
export interface ImportOptions {
  fileName?: string;         // chỉ để báo cáo
  optimize?: boolean;        // mặc định false (D22)
  uid?: () => string;        // mặc định: bộ sinh mật mã; test: bộ sinh theo seed
  limits?: Partial<ImportLimits>;
  previous?: { svg: string; uids?: ReadonlySet<string> };  // nhập lại: bản đang dùng (đã chuẩn hóa)
}
export type ImportErrorCode =
  | 'E_IMPORT_LIMIT' | 'E_IMPORT_PARSE' | 'E_IMPORT_ENCODING' | 'E_IMPORT_ROOT'
  | 'E_IMPORT_DTD' | 'E_IMPORT_USE_BOMB' | 'E_IMPORT_SIZE' | 'E_IMPORT_EXT';
export type ImportResult =
  | { ok: true; svg: string; viewBox: [number, number, number, number];
      elements: ElementInfo[]; report: ImportReport; match?: MatchResult }
  | { ok: false; error: { code: ImportErrorCode; message: string }; report: ImportReport };
export function importSvg(input: Uint8Array | string, opt?: ImportOptions): ImportResult;

export interface ElementInfo { uid: string; tag: string; name: string; parent: string | null; depth: number; label?: string; }
```

`importSvg` thuần (không DOM toàn cục): nhận `DOMParser` qua module `dom.ts` (trình duyệt: `window.DOMParser`; Node: jsdom), như `svg-inspect`. Không ném lỗi cho đầu vào xấu; trả `ok: false`.

## 2. Allowlist phần tử

Quyết định bằng tra bảng `ALLOW_ELEMENTS` theo `localName` **và** `namespaceURI` = `http://www.w3.org/2000/svg`.

| Nhóm | Phần tử | Ghi chú |
|---|---|---|
| Cấu trúc | `svg` (gốc và lồng), `g`, `defs`, `symbol`, `use`, `title` | `title` chỉ giữ làm con của phần tử gắn được, ≤ 200 ký tự |
| Hình | `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon` | |
| Chữ | `text`, `tspan`, `textPath` | nội dung là nút chữ; không HTML |
| Sơn | `linearGradient`, `radialGradient`, `stop`, `pattern` | |
| Cắt, mặt nạ, mũi tên | `clipPath`, `mask`, `marker` | |
| Ảnh | `image` | chỉ `data:image/png\|jpeg\|gif\|webp;base64,…` hợp lệ (§3) |
| Bộ lọc | `filter`, `feGaussianBlur`, `feOffset`, `feColorMatrix`, `feFlood`, `feComposite`, `feMerge`, `feMergeNode`, `feBlend`, `feComponentTransfer`, `feFuncR`, `feFuncG`, `feFuncB`, `feFuncA`, `feDropShadow` | ≤ 8 `filter`, ≤ 64 phần tử `fe*`; `stdDeviation` kẹp ≤ 30 |

**Không có trong danh sách (bị loại cùng cây con):** `script`, `style` (sau chuyển CSS), `foreignObject`, `switch` (importer xử lý trước, ở trang: loại), `view`, `cursor`, `animate`, `animateMotion`, `animateTransform`, `set`, `mpath`, `discard`, `font`, `font-face*`, `glyph`, `missing-glyph`, `metadata`, `desc`, mọi `fe*` khác (`feImage`, `feTurbulence`, `feDisplacementMap`, `feConvolveMatrix`, `feMorphology`, `feTile`, `feSpecularLighting`, `feDiffuseLighting`…), `iframe`, `object`, `embed`, `audio`, `video`, `canvas`, `link`, `meta`, `base`, `html:*`, và mọi phần tử ngoài namespace SVG. **Mở vỏ** (bỏ phần tử, giữ con): `a`.

## 3. Allowlist thuộc tính và kiểu giá trị

Quyết định bằng tra `ATTR_RULES[element][attr]` (bảng cho từng phần tử) và `PRESENTATION[attr]` (thuộc tính trình bày, dùng chung); thuộc tính không có trong bảng bị bỏ. Không có thuộc tính nào được giữ chỉ vì tên.

**Dùng chung mọi phần tử giữ:** `id` (`isId`), `data-mat-uid` (`isUid`), `data-mat-name` (`isName`), `transform` (`isTransform`), `style` (chuẩn hóa qua §4), các thuộc tính trình bày.

**Thuộc tính trình bày:** `fill`, `fill-opacity`, `fill-rule`, `stroke`, `stroke-width`, `stroke-opacity`, `stroke-linecap`, `stroke-linejoin`, `stroke-miterlimit`, `stroke-dasharray`, `stroke-dashoffset`, `opacity`, `display`, `visibility`, `clip-path`, `clip-rule`, `mask`, `filter`, `marker-start`, `marker-mid`, `marker-end`, `color`, `stop-color`, `stop-opacity`, `flood-color`, `flood-opacity`, `font-family`, `font-size`, `font-style`, `font-weight`, `font-stretch`, `text-anchor`, `text-decoration`, `letter-spacing`, `word-spacing`, `dominant-baseline`, `alignment-baseline`, `baseline-shift`, `writing-mode`, `direction`, `shape-rendering`, `text-rendering`, `image-rendering`, `color-interpolation-filters`, `paint-order`, `vector-effect`.

**Hình học theo phần tử:** `svg` (`viewBox`, `preserveAspectRatio`, `width`, `height`, `x`, `y`); `rect` (`x y width height rx ry`); `circle` (`cx cy r`); `ellipse` (`cx cy rx ry`); `line` (`x1 y1 x2 y2`); `polyline`/`polygon` (`points`); `path` (`d`); `text`/`tspan` (`x y dx dy rotate xml:space`); `textPath` (`href startOffset method spacing`); `use` (`x y width height href`); `image` (`x y width height href preserveAspectRatio`); `symbol` (`viewBox preserveAspectRatio refX refY`); `marker` (`markerWidth markerHeight refX refY orient markerUnits viewBox preserveAspectRatio`); `pattern` (`x y width height patternUnits patternContentUnits patternTransform viewBox preserveAspectRatio href`); `linearGradient` (`x1 y1 x2 y2 gradientUnits gradientTransform spreadMethod href`); `radialGradient` (`cx cy r fx fy fr gradientUnits gradientTransform spreadMethod href`); `stop` (`offset`); `clipPath` (`clipPathUnits`); `mask` (`maskUnits maskContentUnits x y width height`); `filter` (`x y width height filterUnits primitiveUnits`); `fe*` (`in in2 result stdDeviation dx dy mode operator k1 k2 k3 k4 type values tableValues slope intercept amplitude exponent offset`, theo từng phần tử).

**Kiểu giá trị** (hàm kiểm viết bằng bộ quét ký tự, không regex):

| Kiểu | Chấp nhận | Từ chối |
|---|---|---|
| `isId` | bắt đầu chữ cái, `_`; ký tự `[A-Za-z0-9_.:-]`; ≤ 128 | khoảng trắng, nháy, `<`, `&` |
| `isUid` | `el_` + 3–40 ký tự `[a-z0-9_]` | |
| `isName` | UTF-8 không ký tự điều khiển, ≤ 80 | |
| số, danh sách số | số thập phân, dạng mũ; hữu hạn; `\|x\| ≤ 1e9` | `NaN`, `Infinity`, hex |
| độ dài | số + (`px`, `pt`, `pc`, `mm`, `cm`, `in`, `em`, `ex`, `%`) hoặc không đơn vị | đơn vị khác, `calc()`, `var()` |
| `d` (path) | lệnh `MmLlHhVvCcSsQqTtAaZz` và số; ≤ 1 MiB | ký tự khác |
| `points` | danh sách số chẵn | |
| `transform` | danh sách `matrix`, `translate`, `scale`, `rotate`, `skewX`, `skewY` với số | hàm khác |
| màu / sơn | `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, `hsl()`, `hsla()` số hữu hạn, 148 tên màu CSS, `currentColor`, `none`, `transparent`, `inherit`; sơn: màu hoặc `url(#id)` (có dự phòng màu) | `url()` không bắt đầu bằng `#`, `var()`, `env()` |
| `url(#id)` | `url(` + khoảng trắng tùy chọn + nháy tùy chọn + `#id` + đóng | mọi URL khác |
| `href` | `#id`; hoặc (chỉ `image`) `data:image/png\|jpeg\|gif\|webp;base64,` + base64 hợp lệ + chữ ký tệp đúng | `http:`, `https:`, `file:`, `javascript:`, `data:` khác, đường dẫn tương đối |
| `font-family` | danh sách tên (định danh hoặc chuỗi trong nháy), `,` | `url`, `(`, `;`, `{`, `\` |
| từ khóa | giá trị trong tập của từng thuộc tính (`stroke-linecap`: `butt\|round\|square`…) | |
| văn bản (`text`, `tspan`, `title`) | chữ; ≤ 4.096 ký tự mỗi nút | |

`xlink:href` (namespace `http://www.w3.org/1999/xlink`) được chuẩn hóa thành `href` (nhận mọi tiền tố gán cho namespace đó); `href` trong namespace khác bị bỏ.

## 4. `style` và CSS

- **Thuộc tính CSS cho phép** (khi đọc `style` nội tuyến hoặc luật trong `<style>`): tên của các thuộc tính trình bày ở §3, cộng `transform` (chuyển thành thuộc tính `transform` nếu hợp lệ). Mọi thuộc tính CSS khác bị bỏ (`mix-blend-mode`, `pointer-events`, `animation*`, `transition*`, `content`, `behavior`, `-moz-binding`, `expression`…), ghi `R_CSS_PROP`.
- **Giá trị:** qua cùng bộ kiểm giá trị §3; `url()` chỉ `#id`; `!important` được ghi nhận cho cascade rồi bỏ khỏi đầu ra.
- **Bộ tách từ vựng:** bình luận, chuỗi, `\` thoát (giải mã một lần rồi kiểm lại), ngoặc; không đệ quy; ≤ 1 MiB mỗi khối `<style>`; ≤ 100.000 luật.
- **Bộ chọn hỗ trợ:** `*`, `tên`, `.lớp`, `#id`, ghép (`tên.lớp#id`, `.a.b`), danh sách phân cách `,`. Bộ chọn khác (tổ hợp `>`, `+`, `~`, hậu duệ, giả lớp, thuộc tính `[x]`): bỏ luật, ghi `R_CSS_RULE` và `W_IMPORT_CSS_PARTIAL`.
- **At-rule** (`@import`, `@font-face`, `@media`, `@keyframes`, `@charset`, `@namespace`, `@supports`): bỏ, ghi `R_CSS_AT`.
- **Cascade:** (1) thuộc tính trình bày gốc; (2) luật `<style>` theo độ đặc hiệu `(id, lớp, thẻ)` rồi thứ tự; (3) `style` nội tuyến; `!important` trong cả (2) và (3) thắng loại không `!important`; kết quả ghi thành thuộc tính trình bày, bỏ `class`, bỏ `<style>`, bỏ `style` (trừ khi còn khai báo không biểu diễn được bằng thuộc tính: không có).

## 5. UID, tên và `elements`

- **Phần tử gắn được:** `g`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path`, `text`, `use`, `image` không có tổ tiên `defs`, `clipPath`, `mask`, `symbol`, `pattern`, `marker`, `filter`. (Gốc `svg` không gắn được; `tspan`, `textPath` không gắn riêng.)
- **UID:** `el_` + 10 ký tự `[a-z2-7]`; duy nhất trong file; mọi `data-mat-uid` có sẵn ở nguồn bị **bỏ** khi nhập mới (ADR-003 mục 4; D5). Nhập lại: xem §7.
- **Tên** (`data-mat-name`, ≤ 80): ưu tiên `inkscape:label` → `data-name` → `id` có nghĩa → "<thẻ> <số thứ tự trong cha>". `id` "không nghĩa": `^(path|rect|g|circle|ellipse|line|polygon|polyline|text|use|image|tspan)[0-9]+$`, `^SVGID_[0-9]+_$`, `^Layer_[0-9]+$`, `^_[0-9]+_?$`, hoặc chỉ gồm chữ số (kiểm bằng bộ quét ký tự, không regex trong mã). `_x0020_` giải thành khoảng trắng; `_x002F_` thành `/`; ký tự điều khiển bỏ.
- **`elements` của item** (file màn hình) do Studio ghi khi có binding, sự kiện hoặc tên riêng; importer trả `ElementInfo[]` để Studio dựng cây phần tử.

## 6. Báo cáo

```ts
export interface ImportReport {
  tool: string;                         // "mat-svg-import 0.1.0"
  file: { name: string; bytes: number; sha256: string };
  generator: { name: string; certainty: 'chắc chắn' | 'có dấu hiệu' | 'không rõ'; evidence: string[] };
  counts: { elementsBefore: number; elementsAfter: number; depth: number; uidAssigned: number; named: number };
  viewBox: [number, number, number, number] | null;
  removed: Array<{ kind: RemovedKind; name: string; count: number; code: string; reason: string; examples: string[] }>;
  converted: Array<{ what: string; count: number; code: string; note: string }>;
  warnings: Array<{ code: string; count: number; message: string }>;
  optimize: { enabled: boolean; merged: number; elementsSaved: number };
  fonts: { used: string[]; mapped: Array<{ from: string; to: string }>; fallback: string[] };
  match: null | { kept: number; added: number; ambiguous: number; orphans: number };
}
type RemovedKind = 'element' | 'attribute' | 'css-property' | 'css-rule' | 'css-at' | 'namespace' | 'pi' | 'dtd' | 'image' | 'font' | 'definition' | 'reference';
```

- Mỗi mục `removed` có `examples` ≤ 3 đường dẫn kiểu `/svg/g[2]/path[5]` (tên thẻ và chỉ số; không nội dung).
- Tên đường dẫn `file:///…` của ảnh liên kết chỉ ghi phần tên tệp.
- Báo cáo **không** chứa nội dung SVG gốc; sắp xếp mục theo `code`, rồi `name` (tất định).
- Lưu: `.json` (đúng cấu trúc trên) và `.md` (bảng cho người đọc, sinh từ cùng dữ liệu).

**Mã lý do loại (`removed[].code`):** `R_SCRIPT`, `R_EVENT_ATTR`, `R_FOREIGN`, `R_NAMESPACE`, `R_ELEMENT_NOT_ALLOWED`, `R_ATTR_NOT_ALLOWED`, `R_VALUE_INVALID`, `R_HREF_EXTERNAL`, `R_URL_EXTERNAL`, `R_DATA_ATTR`, `R_CSS_PROP`, `R_CSS_RULE`, `R_CSS_AT`, `R_PI`, `R_DTD`, `R_IMAGE_LINKED`, `R_IMAGE_BAD`, `R_IMAGE_LIMIT`, `R_FILTER_HEAVY`, `R_FILTER_LIMIT`, `R_FONT_SVG`, `R_SMIL`, `R_META`, `R_EMPTY`, `R_UNUSED_DEF`, `R_DANGLING_REF`, `R_TEXT_LONG`.
**Mã chuyển đổi (`converted[].code`):** `C_CSS`, `C_UNITS`, `C_SWITCH`, `C_FLOWROOT`, `C_FONT_MAP`, `C_ENTITY`, `C_XLINK`, `C_ROUND`, `C_DUP_ID`.
**Cảnh báo:** `W_IMPORT_CSS_PARTIAL`, `W_IMPORT_FLOWTEXT_NOWRAP`, `W_IMPORT_NO_DRAWABLE`, `W_IMPORT_FONT_FALLBACK`, `W_IMPORT_HEAVY` (≥ 1 MiB sau chuẩn hóa).

Mỗi mã có câu tiếng Việt ở `i18n/vi-import.ts` (ví dụ `R_SCRIPT`: "Phần tử script bị loại: file SVG nhập vào không được chứa mã chạy").

## 7. Nhập lại: chữ ký và đối chiếu

**Đầu vào:** bản mới (đã làm sạch, **chưa** gán UID) `N` và bản đang dùng `O` (đã có `data-mat-uid`), cả hai là danh sách phần tử gắn được theo thứ tự tài liệu kèm cây.

**Chữ ký** `sig(e)` = `{ tag, style, box, kids }`:

- `tag`: tên thẻ;
- `style`: tập thuộc tính trình bày đã giải của chính phần tử (`fill`, `stroke`, `stroke-width`, `opacity`, `font-size`, …);
- `box`: hộp bao `[x0, y0, x1, y1]` trong hệ tọa độ `viewBox` của file, tính từ **thuộc tính** (không layout): `rect`, `circle`, `ellipse`, `line`, `polyline`/`polygon` (hộp bao các điểm), `path` (hộp bao các điểm điều khiển của mọi lệnh, đã quy về tuyệt đối), `text` (`x`, `y`, cỡ chữ × độ dài × 0,6), `image`, `use` (`x`, `y`, hộp bao của đích nếu có); `g`: hợp hộp bao của con; ma trận `transform` của chính phần tử và tổ tiên được áp đầy đủ lên các điểm;
- `kids`: số phần tử gắn được con trực tiếp (với `g`).

**Khoảng cách** `D(a, b)`: nếu `a.tag ≠ b.tag` thì ∞; ngược lại
`D = max(|a.x0−b.x0|, |a.y0−b.y0|, |a.x1−b.x1|, |a.y1−b.y1|) / diag + min(0,1; 0,02 × số thuộc tính trình bày khác nhau)`
với `diag` là đường chéo `viewBox` của `O`.

**Bước** (thực hiện tuần tự cho từng phần tử của `N` theo thứ tự tài liệu; cha trước con):

| Bước | Điều kiện khớp `n ↔ o` | Ngưỡng ban đầu |
|---|---|---|
| 1. UID | `n` mang `data-mat-uid` = `u`, `u` ∈ tập UID của `O`, `u` chưa dùng cho phần tử `N` khác, cùng thẻ | `D ≤ 0,25` |
| 2. `id` | `id(n) = id(o)`, `id` duy nhất trong cả hai file, cùng thẻ | `D ≤ 0,25` |
| 3. Cấu trúc | cha của `n` đã khớp với cha của `o`; cùng thẻ; cùng chỉ số trong các anh em cùng thẻ | `D ≤ 0,05`, và `kids` bằng nhau nếu là `g` |
| 4. Hình học | `o` là ứng viên **duy nhất** chưa khớp có `D ≤ 0,005` với `n`, và ứng viên tốt thứ hai (nếu có) có `D` lớn hơn ít nhất 0,002 | |

- Mỗi phần tử `o` khớp tối đa một `n` (nếu hai `n` cùng chọn `o`: cả hai thành "cần chọn").
- **Không khớp:** `n` có ứng viên cùng thẻ chưa khớp với `D ≤ 0,25` (tối đa 3, xếp theo `D`) → **cần chọn**; ngược lại → **mới** (UID mới).
- **Mồ côi:** phần tử `o` mà không `n` nào khớp hay chọn.
- `ImportResult.match`: `{ pairs: Array<{ newPath, oldUid, step, d }>, ambiguous: Array<{ newPath, candidates: Array<{ oldUid, d }> }>, added: string[], orphans: Array<{ oldUid, name, hasBinding, hasEvent }> }`.
- Ngưỡng là giá trị ban đầu; task hiệu chỉnh chỉnh để đạt SC-009. **Bất biến không đổi:** mơ hồ thì hỏi, 0 gán sai tự động trên bộ cặp.

Hàm `applyMatch(importResult, choices)` trả SVG cuối với UID đã quyết (UID cũ cho phần tử khớp hoặc được chọn, UID mới cho phần mới) và danh sách UID mồ côi còn lại.

## 8. Bộ SVG độc hại (`tests/fixtures/svg-import/malicious/`)

Mỗi ca có `mNN-<tên>.svg` và `mNN-<tên>.expect.json` `{ outcome: "sanitized" | "rejected", codes: [...], forbid: [...] }`. Bộ tối thiểu của spec: m01–m24 (30 ca mục tiêu).

| Ca | Nội dung | Kết quả mong đợi |
|---|---|---|
| m01 | `<script>` (và trong `<defs>`) | sanitized: `R_SCRIPT` |
| m02 | `<SCRIPT>`, `<sCrIpT>` (XML phân biệt hoa thường) | sanitized: `R_ELEMENT_NOT_ALLOWED` |
| m03 | `onload` trên `<svg>` | sanitized: `R_EVENT_ATTR` |
| m04 | `onclick`, `onmouseover`, `onfocus`, `onbegin` trên hình | sanitized: `R_EVENT_ATTR` |
| m05 | `<a href="javascript:…">` và `xlink:href` | sanitized: `R_HREF_EXTERNAL`, `a` mở vỏ |
| m06 | `<use href="javascript:…">` | sanitized: `R_HREF_EXTERNAL` |
| m07 | `<image href="http://…">` | sanitized: `R_IMAGE_LINKED` |
| m08 | `<use href="http://evil/x.svg#a">` | sanitized: `R_HREF_EXTERNAL` |
| m09 | `<foreignObject><iframe src=…>` | sanitized: `R_FOREIGN` |
| m10 | `<foreignObject><body onload>` | sanitized: `R_FOREIGN` |
| m11 | `<style>@import url(http://…)</style>` | sanitized: `R_CSS_AT` |
| m12 | `style="fill:url(javascript:…)"`, `style="fill:url(http://…)"` | sanitized: `R_URL_EXTERNAL` |
| m13 | `expression(…)`, `behavior:`, `-moz-binding` | sanitized: `R_CSS_PROP` |
| m14 | DOCTYPE "billion laughs" | rejected: `E_IMPORT_DTD` |
| m15 | DOCTYPE `<!ENTITY x SYSTEM "file:///etc/passwd">` | rejected: `E_IMPORT_DTD` |
| m16 | DOCTYPE thực thể tham số `<!ENTITY % p …>` | rejected: `E_IMPORT_DTD` |
| m17 | `use` lồng 10 cấp × 10 lần (10¹⁰ phần tử hiệu dụng) | rejected: `E_IMPORT_USE_BOMB` |
| m18 | `use` trỏ vào chính tổ tiên (vòng) | rejected: `E_IMPORT_USE_BOMB` |
| m19 | `<animate attributeName="href" values="javascript:…">` | sanitized: `R_SMIL` |
| m20 | `<set attributeName="xlink:href" to="javascript:…">` | sanitized: `R_SMIL` |
| m21 | `<html:script xmlns:html="http://www.w3.org/1999/xhtml">` | sanitized: `R_NAMESPACE` |
| m22 | `<?xml-stylesheet href="http://evil/x.css"?>` | sanitized: `R_PI` |
| m23 | `<image href="data:image/svg+xml;base64,…<script>…">` | sanitized: `R_IMAGE_BAD` |
| m24 | `<a href="data:text/html,<script>…">` | sanitized: `R_HREF_EXTERNAL` |
| m25 | `<feImage href="http://…">` và `stdDeviation="1e9"` | sanitized: `R_FILTER_HEAVY` |
| m26 | `link`, `meta http-equiv=refresh`, `base href`, `audio`, `video`, `canvas`, `embed`, `object`, `iframe` (cả namespace SVG và XHTML) | sanitized: `R_ELEMENT_NOT_ALLOWED`/`R_NAMESPACE` |
| m27 | `<style><![CDATA[</style><script>…]]></style>` | sanitized: không còn `script`; CSS hỏng bị bỏ |
| m28 | `data-mat-uid` giả (trùng UID của project, trùng giữa hai phần tử) | sanitized: UID nguồn bị bỏ, `R_DATA_ATTR` |
| m29 | file 6 MiB | rejected: `E_IMPORT_LIMIT` (không parse) |
| m30 | độ sâu 100; 200.000 phần tử | rejected: `E_IMPORT_LIMIT` |
| (thêm) | UTF-16 và UTF-8 hỏng | rejected: `E_IMPORT_ENCODING` |
| (thêm) | `<text>&lt;script&gt;alert(1)&lt;/script&gt;</text>` | sanitized: giữ chữ, không thành phần tử |
| (thêm) | tiền tố namespace lạ cho `href` (`x:href` với `x` = xlink; `y:href` với `y` lạ) | `x:href` chuẩn hóa; `y:href` bỏ |

**Harness** (`tools/svg-import/malicious-harness.mjs`): (1) `importSvg` → so `expect.json`; (2) `assertAllowlisted(result.svg)` (chạy lại allowlist: không có gì để loại thêm); (3) Chrome headless dựng `result.svg` với `window.__pwned = null` và chặn mọi yêu cầu ngoài máy chủ thử: yêu cầu `__pwned === null` và 0 yêu cầu mạng ngoài; (4) dựng **bản gốc** không lọc ở trang đối chứng: ≥ 1 ca làm `__pwned` ≠ null (canary).

## 9. Bộ fixture nghiệm thu (`tests/fixtures/svg-import/`)

Mỗi file có mục trong `manifest.json`: `{ file, generator, real: bool, source, license, features, limits, expectCodes, allowedDiff }`. Giấy phép: do dự án tạo (CC0); không logo, ký hiệu hay font có bản quyền.

| # | File | Phần mềm | Thật? | Đặc trưng tái tạo |
|---|---|---|---|---|
| 1 | `inkscape-01-tank-process.svg` | Inkscape (CLI) | thật | layer (`inkscape:groupmode`), `sodipodi:namedview`, `style` dài, đơn vị mm, gradient, `clipPath`, `inkscape:label` |
| 2 | `inkscape-02-motor-pump.svg` | Inkscape (CLI) | thật | nhóm lồng có `transform`, `use` (bản sao), marker, `tspan sodipodi:role="line"` |
| 3 | `inkscape-03-panel-text.svg` | Inkscape (CLI) | thật | chữ nhiều dòng, `flowRoot` (giữ từ nguồn), font nhiều họ, ảnh PNG nhúng |
| 4 | `inkscape-04-pipes-flow.svg` | Inkscape (CLI) | thật | polyline, `stroke-dasharray`, marker mũi tên, đường cong Bézier, `mask` |
| 5 | `illustrator-01-saveas-legacy.svg` | Illustrator (mô phỏng) | mô phỏng | DOCTYPE + ENTITY Adobe, `<switch>` + `foreignObject` + `i:pgf`, class `.st0`, font PostScript, `x="0px"` |
| 6 | `illustrator-02-export-cls.svg` | Illustrator (mô phỏng) | mô phỏng | `<style>.cls-N`, `data-name`, id gradient cố định `linear-gradient`, `symbol` + `use` |
| 7 | `illustrator-03-export-screens.svg` | Illustrator (mô phỏng) | mô phỏng | `<title>` cho từng đối tượng, `clip-path` + `<clipPath>`, `filter` bóng đổ, thuộc tính trình bày + một khối `<style>` |
| 8 | `corel-01-mm-css.svg` | CorelDRAW (mô phỏng) | mô phỏng | `width="…mm"` + `viewBox` 100 đơn vị/mm, CSS trong CDATA `.fil0/.str0/.fnt0`, id `_x0020_`, metadata `xodm` |
| 9 | `corel-02-curves-clip.svg` | CorelDRAW (mô phỏng) | mô phỏng | chữ chuyển thành đường cong, `clipPath`, gradient kế thừa `xlink:href`, `fill-rule: evenodd`, `shape-rendering` |
| 10 | `corel-03-blend-pattern.svg` | CorelDRAW (mô phỏng) | mô phỏng | `pattern` tô, ảnh PNG nhúng, `opacity`, `clip-rule`, nhóm lồng sâu 10 cấp |

**Giới hạn của mô phỏng** (ghi vào `README.md`, `manifest.json`, `docs/reports/008-acceptance.md`): các file 5–10 tái tạo *đặc trưng cấu trúc* đã biết, không phải file do Illustrator hay CorelDRAW sinh; không chứng minh cách phần mềm thật sinh id, làm tròn số, thứ tự thuộc tính, phiên bản mới; SC-001 cho hai phần mềm này là "đạt trên mô phỏng" tới khi có file thật (task chờ người dùng; thay file và chạy lại `manifest`).

**Ca phụ có sẵn trong repo:** `tests/fixtures/svg/*` (19 file Sprint 0, trong đó `factory-isometric-stress.svg` làm ca giới hạn và Tối ưu; file này do người dùng cung cấp, không thuộc 10 fixture mới).

**Tạo file:** `tools/svg-fixtures/make-inkscape.ps1` (nguồn viết tay trong `tools/svg-fixtures/src/*.svg`, chạy `inkscape --export-filename=…` ghi phiên bản Inkscape vào `manifest.json`); `tools/svg-fixtures/make-simulated.mjs` (file 5–10 sinh tất định từ khuôn `tools/svg-fixtures/src/*.tmpl.svg` để diff được).

## 10. Giới hạn (bảng chốt)

| Giới hạn | Giá trị | Mã khi vượt |
|---|---|---|
| Kích thước byte | 5 MiB (5.242.880), kiểm trước parse | `E_IMPORT_LIMIT` |
| Phần tử thô | 100.000 | `E_IMPORT_LIMIT` |
| Phần tử sau chuẩn hóa (và tối ưu) | 20.000 | `E_IMPORT_LIMIT` (gợi ý Tối ưu) |
| Độ sâu | 32 | `E_IMPORT_LIMIT` |
| Phần tử hiệu dụng sau mở `use` | 100.000 | `E_IMPORT_USE_BOMB` |
| `filter` / phần tử `fe*` | 8 / 64 | loại phần dư, `R_FILTER_LIMIT` |
| Ảnh nhúng | 16 ảnh, 2 MiB tổng | loại phần dư, `R_IMAGE_LIMIT` |
| Một nút chữ | 4.096 ký tự | cắt, `R_TEXT_LONG` |
| `d` | 1 MiB | loại thuộc tính, `R_VALUE_INVALID` |

## 11. CLI

`node tools/svg-inspect/svg-inspect.mjs --import <file|thư mục>… [--optimize] [--report-dir <thư mục>] [--json kết-quả.json]`: chạy `importSvg` trên từng file, in tóm tắt, ghi báo cáo `.json` và `.md`, ghi SVG đã nhập (`--out <thư mục>`); mã thoát 0 = mọi file nhập được, 1 = có file bị từ chối, 2 = dùng sai. `ci-local` chạy trên `tests/fixtures/svg-import/` (10 fixture phải nhập được; ca độc hại theo `expect.json`).
