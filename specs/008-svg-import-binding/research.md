# Research: Nhập SVG, gắn Tag cho phần tử SVG, animation và sự kiện

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Ngày**: 2026-10-13

Phase 0 của plan. Mỗi mục gồm **Quyết định**, **Lý do**, **Phương án khác đã xét**.

- **Quyền quyết định.** Người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11. Chỗ spec để ngỏ, plan chọn phương án tốt nhất và ghi **Quyết định (người dùng giao toàn quyền 2026-10-11)**.
- **Phiên bản thư viện:** feature này **không thêm thư viện ngoài** (R22).
- **Số đo thiết bị** lấy từ `docs/reports/`. SSH tới BL335 không có trong phiên này: mọi bước cần BL335 thành task ⚠️🔌 hoặc lệnh trong [quickstart.md](quickstart.md) §8.
- **Không có thí nghiệm mới trong phiên viết kế hoạch** (phiên chỉ viết tài liệu, không chạm mã). Các số chưa đo ghi rõ "chưa đo"; task spike ở đầu `tasks.md` (T006, T007, T008) đo trước khi chốt R5, R7, R9, R10, R18.

**Mốc so sánh** (đã đo, dùng làm cơ sở):

- Mở 19 file SVG Sprint 0 trên Chrome 154 từ BL335: lớn nhất 554 ms (4,34 MB, 27.025 phần tử sau lọc), trung vị 13,7 ms với file nhỏ ([svg-load.md](../../docs/reports/svg-load.md)); BL335 phục vụ bản `.gz`, RSS `mat-poc` 2,1 MB. Hạn chế đã ghi: máy dev nối Wi-Fi, một client, bộ lọc là denylist.
- Thông lượng thực BL335 → máy dev: 4,55 MB trong 0,56 s ≈ 65 Mbps (cùng báo cáo); nghĩa là 10 client F5 cùng lúc một SVG 1 MiB không nén ≈ 10 × 1 MiB / 65 Mbps ≈ 1,3 s (R20).
- 007 đo x64: màn hình chuẩn có giá trị sống 0,20 s sau khi mở trang; 10 phiên F5 cùng lúc ≤ 0,54 s ([ADR-013](../../docs/adr/013-screen-model-v1.md)).
- Thí nghiệm svg-dialects: ảnh Chrome so với ảnh Inkscape tự xuất của file thật: 1,66 % điểm ảnh khác rõ (ΔRGB > 64/255).

**Điều tra hiện trạng mã** (đọc ngày 2026-10-13, cơ sở của kế hoạch):

| Phần | Hiện trạng | Ảnh hưởng |
|---|---|---|
| `packages/svg-renderer/src/sanitize.ts` | denylist phần tử (`script`, `foreignobject`, `iframe`…), lọc `on*`, `href` ngoài, CSS ngoài bằng regex sau giải escape; không giới hạn kích thước/node/độ sâu (chỉ đo) | thay bằng allowlist (R2); `mountScreen` gọi nó nên đổi một chỗ |
| `packages/svg-renderer/src/inspect.ts` | nhận diện phần mềm, cảnh báo; `DEFAULT_LIMITS` 5 MB / 20.000 / 32 chỉ để cảnh báo | dùng lại nhận diện (R18); giới hạn thành cứng ở importer |
| `packages/binding-engine` `DomApplier` | đích: fill, stroke, opacity, visibility, text, rotate (`style.transform` ghi đè `transform` gốc, tâm cố định giữa hộp bao), levelPercent cho `rect`; `rangeMap` báo "chưa hỗ trợ" | mở rộng (R8–R12) |
| `schemas/binding.schema.json` | `target` đã liệt `transform.translateX/Y`, `transform.scale`, `component.state` nhưng validator trả `E_TARGET_UNSUPPORTED`; `unsupportedTransform` gồm `rangeMap`, `format`, `expression` | 0.4.0 hiện thực hóa (R1, R8) |
| `packages/project-schema` | `rules-03.ts` có `LIMITS_03.svgItems = 8`, kiểm `W_UID_NOT_IN_SVG` bằng DOMParser phía TS | thêm `rules-04`/tham số minor (R1) |
| `core/project-manager/rules_03.*` | không parse SVG ("SVG files are not parsed (Constitution II)") | luật C++ 0.4 không có mã phụ thuộc SVG (R21) |
| `packages/ui-components` `ControlController` | nhận `WidgetItem`, khe `target`, `props.min/max`; hộp xác nhận, khóa, kết quả | dùng lại bằng widget ảo (R13) |
| `apps/studio/src/ui/props-element.ts` | binding chỉ đọc; nhóm Sự kiện "GĐ 3b" | thành inspector sửa được (R15, R16) |
| `apps/studio/src/ui/screen/mat-screen-canvas.ts`, `model/screen-edit/*` | canvas có chọn item, kéo, đổi cỡ, bắt dính | thêm chế độ "vào item" (R15) |
| `apps/studio/src-tauri/src/csv.rs` | `csv_open`: hộp thoại, byte thô, ≤ 10 MiB | khuôn của `svg_open` (R24) |
| `server/http/http_api.cpp` `onProjectFile` | phục vụ file có trong allowlist của project (`projectFiles`), `Cache-Control: no-cache`, CSP `kCspProject`, không nén | đường dẫn `graphics/…` phục vụ được mà không đổi mã; không nén (R20) |
| `tests/fixtures/svg/` | 19 file; chỉ Inkscape (stress) và LibreOffice xuất thật; 5 file Illustrator/Corel/draw.io mô phỏng | thêm bộ 10 fixture nghiệm thu (R18) |

## R1. Định dạng 0.4.0 và giới hạn mới

- **Quyết định (người dùng giao toàn quyền 2026-10-11):**
  - **0.4.0**: giữ cấu trúc màn hình và `navigation` của 0.3; file binding mở rộng (đích, phép biến đổi, tham số, `events`); trần item `svg` 8 → 64. Mọi file cùng `schemaVersion` `0.4.x`; `minRuntimeVersion` ≥ `0.7.0`.
  - Migration 0.3 → 0.4 chỉ đổi `schemaVersion` và `minRuntimeVersion` (mọi file hợp lệ ở 0.3 hợp lệ ở 0.4 với cùng ngữ nghĩa: 0.4 chỉ **thêm** giá trị cho tập đã đóng).
  - `schemas/0.3/` đóng băng; `schemas/*.schema.json` thành 0.4.0; `protocol-version.json` thêm `"0.4"`; `live` giữ `1.2.0`.
  - **API thiết bị giữ 1.2.0.** Mọi dữ liệu mới nằm trong file project; sự kiện SVG ghi bằng `POST /api/v1/tags/write` với `context.widget` = `elementUid` (R13).
- **Lý do:**
  - Runtime 0.6 từ chối đích và phép biến đổi lạ (`E_TARGET_UNSUPPORTED`, `E_TRANSFORM_UNSUPPORTED`): đây là thay đổi ngữ nghĩa nên phải đổi phiên bản; ADR-004 cho MINOR khi MAJOR = 0 kèm migration.
  - Giữ một phiên bản cho cả bộ file (ADR-004 điểm 2).
  - 64 item `svg`: xem R17 (thể hiện ký hiệu là item).
- **Phương án khác đã xét:**
  - **Giữ 0.3.0, thêm tùy chọn:** project dùng đích mới sẽ chạy trên runtime 0.6 như project hợp lệ rồi hiển thị sai im lặng (bỏ qua binding). Loại.
  - **Tách file sự kiện (`*.events.json`):** thêm loại file, thêm mồ côi riêng, đổi tên Tag phải sửa hai nơi. Loại (D9).
  - **Đưa sự kiện vào file màn hình** (như widget `events`): file màn hình khóa theo `item.id`, không theo `elementUid`; nhập lại và mồ côi phải xử lý hai nơi. Loại.

## R2. Allowlist trên DOM đã parse (Constitution V)

- **Quyết định:**
  - Một hàm `sanitizeSvg(root, opts): SanitizeReport` trong `@mat/svg-renderer` thay bản denylist; cùng chữ ký và cùng kiểu `SanitizeReport` (thêm trường), nên `mountScreen` và Studio không đổi nơi gọi.
  - **Duyệt cây bằng vòng lặp** (ngăn xếp tường minh), không đệ quy, để độ sâu lớn không làm tràn ngăn xếp; đếm phần tử và độ sâu trong cùng lượt.
  - **Quyết định theo bảng tra**, không regex: tên phần tử (localName và namespace SVG) tra `ELEMENTS`; tên thuộc tính tra `ATTRS[element]` hoặc `PRESENTATION`; giá trị qua hàm kiểm theo kiểu (`isNumber`, `isNumberList`, `isColor`, `isLength`, `isTransform`, `isPathData`, `isPoints`, `isLocalRef`, `isLocalUrl`, `isDataImage`) viết bằng bộ quét ký tự.
  - Phần tử ngoài danh sách: bỏ cả cây con; ngoại lệ "mở vỏ": `a` (giữ con), `switch` (importer xử lý trước; ở trang thì bỏ cả cây).
  - Thuộc tính `style`: tách khai báo bằng bộ tách từ vựng CSS (R4), giữ khai báo có thuộc tính trong `CSS_PROPS` và giá trị qua `isCssValue` (cấm `url()` không nội bộ, `expression`, `javascript:`, `\` thoát), ghi lại ở dạng chuẩn.
  - Danh sách đầy đủ: [contracts/svg-import.md](contracts/svg-import.md) §2–§4.
- **Lý do:**
  - Denylist (`BLOCKED_ELEMENTS`…) cho qua mọi thứ chưa nghĩ tới; allowlist thì phần mới thêm của SVG hay trình duyệt mặc nhiên bị loại.
  - Đệ quy trên cây 5 MB độ sâu bị kẻ tấn công kiểm soát là rủi ro tràn ngăn xếp (DOMParser của trình duyệt giới hạn độ sâu, nhưng Node/jsdom thì không đảm bảo).
  - Regex trên giá trị dễ lách bằng thoát ký tự (đã gặp ở review Sprint 1: `cssUnescape`); bộ quét ký tự có thể chứng minh đúng bằng ca thử.
- **Phương án khác đã xét:**
  - **DOMPurify (thư viện):** thêm phụ thuộc, cấu hình allowlist riêng cho SVG phức tạp, không có khái niệm giới hạn node/độ sâu của dự án, và không chạy tất định với jsdom/Node như CI cần; ngoài ra SVG của ta cần CSS cascade (R4), DOMPurify bỏ `<style>`. Loại.
  - **Giữ denylist và thêm giới hạn:** trái Constitution V ("allowlist"). Loại.
  - **Chạy sanitizer chỉ ở Studio, trang không lọc:** project sửa tay trên đĩa chạy mã trên Chrome. Loại: trang lọc lại (lớp thứ hai, FR-023).

## R3. Trước khi parse: DTD, entity, mã hóa (Constitution V)

- **Quyết định:**
  - Bộ quét ký tự (hàm `prescan(text)`) đi qua phần mở đầu: BOM, khai báo XML, bình luận, PI, `<!DOCTYPE …>` có ngoặc `[` `]` và chuỗi trong nháy; không dùng regex trên cả văn bản.
  - ENTITY: tên nằm trong bảng Adobe (`ns_svg`, `ns_extend`, `ns_ai`, `ns_graphs`, `ns_vars`, `ns_imrep`, `ns_sfw`, `ns_custom`, `ns_adobe_xpath`, `ns_flows`, `ns_xlink`) và giá trị là URI của chính bảng → thay `&tên;` bằng URI ở các nơi xuất hiện trong giá trị thuộc tính `xmlns*`; mọi ENTITY khác (tham số `%`, `SYSTEM`, `PUBLIC`, giá trị lạ) → `E_IMPORT_DTD`.
  - Bỏ toàn bộ DOCTYPE khỏi văn bản trước khi đưa cho `DOMParser`; bỏ PI (`<?xml-stylesheet …?>`…).
  - Mã hóa: UTF-8 (có hoặc không BOM); khai báo `encoding` khác UTF-8 hoặc chuỗi byte UTF-8 hỏng → `E_IMPORT_ENCODING`. Giải mã bằng `TextDecoder('utf-8', { fatal: true })`.
  - Kiểm byte ≤ 5 MiB **trước** mọi việc khác (`E_IMPORT_LIMIT`, ≤ 50 ms vì không parse).
- **Lý do:** XXE và "billion laughs" xảy ra ở lớp parser XML; cách chắc chắn nhất là không bao giờ đưa DTD cho parser. Illustrator Save As cũ cần ENTITY namespace để file hợp lệ, nên thay trước rồi bỏ.
- **Phương án khác đã xét:**
  - **Để DOMParser xử lý DTD:** Chrome không tải thực thể ngoài nhưng có mở rộng nội bộ (bom). Loại.
  - **Từ chối mọi DOCTYPE:** từ chối cả file Illustrator Save As (loại file có thật). Loại.

## R4. CSS thành thuộc tính trình bày (cascade)

- **Quyết định:**
  - Bộ tách từ vựng CSS tự viết (`css.ts` của `@mat/svg-import`): bỏ bình luận, nhận khối `selector { decl; … }`, bỏ at-rule (`@import`, `@font-face`, `@media`, `@keyframes`, `@charset`) và ghi báo cáo.
  - Bộ chọn hỗ trợ: thẻ (`rect`), lớp (`.cls-1`), `#id`, ghép (`g.cls-1`, `.a.b`), danh sách dấu phẩy, `*`. Khác: bỏ luật, ghi `W_IMPORT_CSS_PARTIAL` kèm số phần tử có thể bị ảnh hưởng (đếm bằng bộ chọn thô theo tên lớp).
  - Cascade: độ đặc hiệu (id > lớp > thẻ), rồi thứ tự xuất hiện, `!important` thắng; thuộc tính trình bày gốc (`fill="…"`) thua mọi luật CSS (đúng SVG); `style` nội tuyến thắng khối `<style>` (không `!important`).
  - Kết quả ghi thành thuộc tính trình bày (`fill`, `stroke`, `stroke-width`, `font-family`…) trên từng phần tử; thuộc tính CSS không có dạng thuộc tính (ví dụ `mix-blend-mode`) bị bỏ; sau cùng bỏ `<style>` và `class`.
  - Kế thừa không chuyển (trình duyệt tự kế thừa theo cây); chỉ chuyển luật khớp trực tiếp.
- **Lý do:** [svg-dialects.md](../../docs/architecture/svg-dialects.md) yêu cầu 3 và thí nghiệm 3: class trùng tên làm sai màu khi ghép; ta bỏ class để file không phụ thuộc khối `<style>`. Bộ phân tích tự viết cho cùng kết quả ở Chrome, WebView2, jsdom và Node (CSSOM của jsdom khác Chrome ở thứ tự và ở `@media`); tất định cho CI (SC-002 so ảnh trước/sau).
- **Phương án khác đã xét:**
  - **`getComputedStyle` của Chrome:** cho cascade đúng tuyệt đối nhưng chỉ chạy ở Chrome, không chạy trong Vitest/Node, ghi cả thuộc tính kế thừa (phình file), phụ thuộc phiên bản trình duyệt. Loại.
  - **Giữ `<style>` (lọc `url()` và `@import`):** sai khi ghép hai item cùng trang? Không: mỗi item có Shadow DOM. Nhưng giữ `<style>` buộc sanitizer parse CSS ở trang (code lớn hơn trong gói trang, SC-022) và binding ghi đè thuộc tính (`style.fill`) vẫn thắng nên được. Chọn chuyển sang thuộc tính để trang gọn và fixture thật (stress: 366 lớp xung đột) không phụ thuộc thứ tự khối.
  - **Thư viện CSS (css-tree, postcss):** thêm phụ thuộc. Loại (R22).

## R5. Chuẩn hóa và Tối ưu

- **Quyết định:**
  - **Chuẩn hóa** (luôn chạy): đơn vị `width/height` → px (1 in = 96, mm = 96/25,4, pt = 96/72, pc = 16, cm = 96/2,54); `viewBox` đủ; `switch` → nhánh đầu không phải `foreignObject`; `flowRoot` → `text` một dòng; font PostScript → họ font (bảng dữ liệu); `id` trùng → đổi; tham chiếu treo → bỏ; phần tử rỗng, `defs` không dùng → bỏ; thuộc tính bằng giá trị mặc định → bỏ; số làm tròn ≤ 3 chữ số thập phân khi chữ số dài hơn 4 (tọa độ trong `d`, `points`, `x`…); ghi bằng bộ ghi tuần tự riêng (R6).
  - **Tối ưu** (tùy chọn, mặc định tắt): gộp dãy phần tử liền kề cùng cha thuộc `{line, polyline, polygon, path}` có cùng thuộc tính trình bày đã giải, không `id`, không `data-*`, không `transform` (hoặc cùng `transform`), `opacity`, `fill-opacity`, `stroke-opacity` bằng 1 hoặc vắng, không bị tham chiếu, thành một `path` (nối `d`, `line` → `M x1 y1 L x2 y2`, `polygon` → `M … Z`). Không gộp qua phần tử khác loại (giữ thứ tự vẽ).
  - Đo mục tiêu: `factory-isometric-stress.svg` (27.029 phần tử, 87 % là `line`/`polygon` trong 2 nhóm) xuống ≤ 20.000 và ảnh khác ≤ 1 %. **Chưa đo**: spike T007 đo trước; nếu không đạt thì ghi giới hạn vào báo cáo (file này cần sửa ngoài Studio) và đổi SC-010 phần stress.
- **Lý do:** tài liệu fixtures ghi rõ file Inkscape thật của dự án vượt giới hạn node (27.029 > 20.000) và đề xuất gộp polygon; chọn gộp có điều kiện bảo toàn hình (chỉ khi không độ mờ, không chồng thứ tự) thay vì nâng giới hạn, vì Constitution V đòi giới hạn và 20.000 là số roadmap đã chốt.
- **Phương án khác đã xét:**
  - **Nâng giới hạn node lên 30.000:** trái roadmap §4.4; ảnh hưởng thời gian dựng trên Chrome yếu. Loại.
  - **Gộp tự động:** làm mất khả năng gắn từng hình nhỏ mà người dùng không biết. Loại (D22).
  - **Rasterize phần minh họa thành PNG nhúng:** đổi bản chất (không co giãn sắc nét). Loại.

## R6. Gán UID, tên và ghi tuần tự

- **Quyết định:**
  - **Phần tử gắn được** = phần tử vẽ được (`g`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path`, `text`, `tspan` không (con của `text` không gắn riêng), `use`, `image`) không nằm trong `defs`, `clipPath`, `mask`, `symbol`, `pattern`, `marker`. UID `el_` + 10 ký tự base32 (`a–z2–7`) từ bộ sinh ngẫu nhiên mật mã (`crypto.getRandomValues`), thay được bằng bộ sinh theo seed (xoshiro128**) cho test.
  - `data-mat-uid` và `data-mat-name` là hai `data-*` duy nhất sống sót. Tên: `inkscape:label` → `data-name` → `id` có nghĩa (không khớp mẫu tự sinh: `^(path|rect|g|circle|ellipse|line|polygon|polyline|text|use|image)\d+$`, `^SVGID_\d+_$`, `^Layer_\d+$`, chứa `_x0020_` hay `_x002F_`, `^_\d+_?$`) → "<thẻ> <số>"; ≤ 80 ký tự; giải mã `_x0020_` thành khoảng trắng; xóa ký tự điều khiển.
  - `elements` của item chỉ liệt kê UID có binding, sự kiện hoặc tên do người dùng đặt; phần còn lại nằm trong SVG và hiện ở cây phần tử.
  - **Bộ ghi SVG riêng** (`writeSvg`): thứ tự thuộc tính cố định (`id`, hình học, trình bày theo bảng, `transform`, `data-mat-*`), thoát `& < > "` cố định, không `XMLSerializer` (kết quả khác nhau giữa jsdom và Chrome: thứ tự thuộc tính, khai báo namespace, tự đóng thẻ).
- **Lý do:** ADR-003 mục 5 ("mọi phần tử trong model nhận UID mới") và roadmap ("tự gán `data-mat-uid`"). Chi phí kích thước 20.000 × ≈ 28 byte ≈ 560 KB (cộng `data-mat-name`) nằm trong 5 MiB; gán rộng để mọi phần tử chọn được trong canvas mà không phải sửa SVG sau (D26: Studio không sửa SVG).
- **Phương án khác đã xét:**
  - **Gán UID khi người dùng gắn binding đầu tiên** (lười): phải sửa file SVG khi gắn, và nhập lại không còn gì để đối chiếu cho phần tử chưa gắn. Loại.
  - **UID băm từ đường dẫn:** ADR-003 phương án B (đổi khi chèn phần tử). Loại.
  - **`XMLSerializer`:** không tất định giữa môi trường (FR-022). Loại.

## R7. Nhập lại và đối chiếu UID (ADR-003 mục 6)

- **Quyết định:**
  - **Chữ ký phần tử** `sig(e) = { tag, style: băm của thuộc tính trình bày đã giải, geom: dấu vân hình học }`; dấu vân hình học tính từ thuộc tính, không cần layout: `rect` (x, y, w, h), `circle`/`ellipse` (cx, cy, rx, ry), `line` (x1, y1, x2, y2), `polyline`/`polygon` (số điểm, hộp bao các điểm), `path` (chuỗi lệnh rút gọn, hộp bao các điểm của lệnh tuyệt đối và tương đối đã quy), `text` (x, y, nội dung rút gọn), `g` (hộp bao hợp của con đã khớp, hoặc số con), `use` (x, y, đích), `image` (x, y, w, h). Tọa độ quy về hệ tọa độ gốc `viewBox` (áp `transform` đơn giản: translate, scale, rotate bội 90; `transform` phức tạp → dấu vân giảm cấp, không dùng cho bước 4).
  - **Khoảng cách** `d(a, b)` = khoảng cách Chebyshev chuẩn hóa của hộp bao, chia cho đường chéo `viewBox`, cộng phạt 0,02 cho mỗi thuộc tính trình bày khác (tối đa 0,1); khác thẻ: vô cực.
  - **Bước** (dừng ở khớp đầu tiên đáng tin cho từng phần tử mới, theo thứ tự từ nhóm cha xuống để bước 3 dựa vào cha đã khớp):
    1. UID: `data-mat-uid` của bản mới có trong tập UID bản cũ, cùng thẻ, `d ≤ 0,25`; trùng UID hai phần tử mới: không dùng.
    2. `id` duy nhất ở cả hai phía, cùng thẻ, `d ≤ 0,25`.
    3. đường dẫn cấu trúc: cha đã khớp, cùng thẻ, cùng chỉ số trong các anh em cùng thẻ, `d ≤ 0,05`.
    4. hình học: ứng viên duy nhất cùng thẻ chưa khớp có `d ≤ 0,005`, và ứng viên thứ hai có `d` lớn hơn ít nhất 0,002 (ngược lại: mơ hồ).
  - Mỗi UID cũ khớp tối đa một phần tử mới (khớp hai chiều; tranh chấp → cả hai vào danh sách chọn).
  - Còn lại: **cần chọn** (kèm ≤ 3 ứng viên cùng thẻ theo `d` tăng dần, `d ≤ 0,25`), **mới** (nhận UID mới) hoặc **mồ côi** (phần tử cũ không phần tử mới nào chọn nó).
  - Ngưỡng 0,25 / 0,05 / 0,005 / 0,002 là **giá trị ban đầu**; task hiệu chỉnh (T100) chạy bộ cặp (SC-009) và chỉ chỉnh nếu có phần tử gán sai; mục tiêu bất biến: 0 gán sai tự động.
- **Lý do:** ADR-003 yêu cầu thứ tự UID → `id` → cấu trúc → hình học, "khớp mơ hồ không tự gán" và "mồ côi chặn build"; ADR để ngỏ dung sai cho Sprint 2. LibreOffice xuất lại làm mất mọi `id` và `data-*` (31 → 280 phần tử), nên bước 3, 4 không thể bỏ. Hộp bao tính từ thuộc tính để chạy trong Node (CI) mà không cần layout.
- **Phương án khác đã xét:**
  - **Hộp bao thật bằng `getBBox`:** chỉ chạy ở Chrome; CI (Vitest) không kiểm được; chậm với 20.000 phần tử. Loại.
  - **Khớp tối ưu toàn cục (Hungarian):** phức tạp, mơ hồ vẫn phải hỏi người dùng. Loại.
  - **Dựa vào vị trí trong cây (chỉ bước 3):** vỡ khi người vẽ nhóm lại. Loại.

## R8. Mở rộng binding: đích mới và `rangeMap`

- **Quyết định:**
  - Đích 0.4 (thêm vào enum đã có chỗ giữ): `transform.translateX`, `transform.translateY`, `transform.scale`, `geometry.clipLevel`, `effect.blink`, `effect.flow`; giữ `style.fill`, `style.stroke`, `style.opacity`, `style.visibility`, `text.content`, `transform.rotate`, `geometry.levelPercent`. `component.state` vẫn `E_TARGET_UNSUPPORTED` (GĐ 6, faceplate).
  - Phép biến đổi 0.4: `direct`, `discreteMap`, `linearScale`, `valueTable` (giữ) và **`rangeMap`** `{ kind, ranges: [{ from?, to?, value }], default? }` (nửa mở `[from, to)`, cấm chồng, ≤ 64 khoảng). `format` và `expression` vẫn không hỗ trợ.
  - Bảng đích × phép biến đổi cho phép: ở [contracts/binding-animation.md](contracts/binding-animation.md) §2 (ví dụ `effect.blink` nhận `direct` BOOL/số, `discreteMap`, `rangeMap` ra boolean; `style.fill` nhận `discreteMap`, `valueTable`, `rangeMap`, không `linearScale`).
  - Tham số theo đích nằm cạnh `transform` ở cấp binding (như `direction`, `format`, `animation` của 0.2): `pivot`, `axis`, `reverse`, `period`, `mode`, `minOpacity`, `color`, `dash`, `speed`, `byValueSign`, `prefix`, `unitFromTag`.
- **Lý do:** enum đích của schema 0.3 đã chừa các tên này; roadmap §4.4 liệt kê đúng các hiệu ứng này. `rangeMap` có sẵn trong `unsupportedTransform` của schema như chỗ giữ. Dùng lại ngữ nghĩa khoảng của bảng giá trị (006, ADR-015) để một luật chồng khoảng cho cả hai.
- **Phương án khác đã xét:**
  - **Chỉ dùng `valueTable` cho "theo khoảng":** buộc tạo bảng chung cho mỗi trường hợp một lần; nhưng vẫn giữ bảng giá trị làm cách dùng chung (D10). Chọn có cả hai.
  - **Biểu thức (`expression`)** để làm mọi phép biến đổi: GĐ 6; phải có ngôn ngữ biểu thức phía trang (006 có bản TS nhưng chưa nối binding), ngoài phạm vi.

## R9. Hợp các phép biến đổi

- **Quyết định:**
  - `DomApplier` giữ cho mỗi phần tử có binding transform một **trạng thái hợp** `{ tx, ty, rot, spinRps, sx, sy }`, ma trận cơ sở `M0` đọc từ thuộc tính `transform` gốc **một lần** (bộ phân tích `transform` của `@mat/svg-renderer`, không dùng layout) và hộp bao cục bộ `bbox` đo **một lần** bằng `getBBox` (đo lại khi phần tử vừa hiện hoặc `bbox` rỗng); `pivot` tương đối `[px, py]` cho điểm `c = (bbox.x + px·bbox.width, bbox.y + py·bbox.height)`.
  - Ghi **một** `style.transform` mỗi lần đổi, với `transform-origin: 0 0` và `transform-box: view-box` (đặt rõ trên phần tử):
    `translate(tx, ty) matrix(M0) translate(cr) rotate(rot) translate(-cr) translate(cs) scale(sx, sy) translate(-cs)`
    trong đó `cr`, `cs` là điểm `pivot` của quay và của co giãn (có thể khác nhau). Thuộc tính `transform` gốc giữ nguyên trong DOM (bị CSS `transform` che; không xóa để Studio và công cụ đọc được).
  - `translate` ở đơn vị người dùng của **nhóm cha** (bên ngoài `M0`); quay và co giãn ở hệ tọa độ **cục bộ** của phần tử (bên trong `M0`).
  - **Quay liên tục** (`spin`) là một hoạt ảnh Web Animations trên chính thuộc tính `transform` với hai khung hình có cùng cấu trúc hàm: `…rotate(0deg)…` và `…rotate(360deg)…` (các phần còn lại của chuỗi giống nhau nên trình duyệt nội suy đúng); `duration` cố định 1.000 ms (1 vòng/giây), tốc độ đặt bằng `updatePlaybackRate(rps)` nên đổi tốc độ không khởi động lại; khi `tx, ty, sx, sy` đổi giữa lúc quay, gọi `effect.setKeyframes()` với chuỗi mới (giữ nguyên thời gian hiện tại). `spin` và `transform.rotate` theo giá trị trên cùng phần tử là lỗi `E_DUP_BINDING` (cùng nhóm đích "quay").
  - **Thay đổi hành vi so với 0.2** (phát hiện khi đọc mã, ghi vào ADR-024): bản 0.2 đặt `style.transform = rotate(<độ>deg)` với tâm `fill-box center`; CSS `transform` che thuộc tính `transform` gốc, nên phần tử có `transform="translate(…)"` mất phép dời khi gắn quay (lỗi im lặng, hay gặp ở file Illustrator và CorelDRAW). Bản 0.4 giữ `M0`. Với phần tử không có `transform` gốc và tâm giữa hộp bao: kết quả hiển thị giống hệt 0.2 (kiểm bằng `compat`).
  - **Spike T006** kiểm trên Chrome: (a) chuỗi trên cho đúng vị trí với `M0` = dời, quay 90°, co giãn, lệch; (b) nội suy `matrix()` giữa hai khung hình giống nhau không gây giật; (c) hiệu năng `setKeyframes`. Kết quả ghi vào ADR-024; không đạt (b) thì dùng phần tử bọc `<g>` do runtime tạo cho phần tử có `spin` và `M0` khác đơn vị.
- **Lý do:** CSS `transform` ghi đè thuộc tính `transform` của SVG nên phải tự hợp `M0`; ma trận rõ ràng cho kết quả đúng với mọi `M0` và cho phép `pivot` riêng. Các thuộc tính CSS riêng `translate`/`rotate`/`scale` (Chrome ≥ 104) hợp *ngoài* `transform` và dùng chung `transform-origin`, nên với `M0` khác đơn vị tâm quay lệch (gốc tính trong hệ trước `M0`); đã loại.
- **Phương án khác đã xét:**
  - **Thuộc tính CSS riêng `rotate`/`translate`/`scale`:** lệch tâm khi `M0` ≠ đơn vị (lý do trên) và buộc một `pivot` chung. Loại.
  - **Bọc phần tử bằng `<g>` do runtime tạo:** thêm nút DOM mỗi phần tử có binding; `elementUid` trỏ vào nút nào làm phức tạp UID và nhập lại. Chỉ là dự phòng của spike.
  - **Tự chạy `requestAnimationFrame` cho quay:** CPU cao hơn Web Animations (chạy trên compositor khi có thể). Loại.
  - **SMIL `animateTransform`:** bị allowlist loại (R2).

## R10. Mức chất lỏng cho hình bất kỳ: `clipLevel`

- **Quyết định:**
  - Lúc dựng (một lần khi phần tử có hộp bao khác 0): tạo trong `<defs>` của item (Shadow DOM của item) `<clipPath id="mat-clip-<uid>" clipPathUnits="userSpaceOnUse"><rect x y width height/></clipPath>`; đặt `clip-path="url(#mat-clip-<uid>)"` (thuộc tính trình bày) lên phần tử; mỗi lần cập nhật chỉ đổi `y/height` (hướng lên/xuống) hoặc `x/width` (trái/phải) của `rect` cắt, theo hộp bao `bbox` đo một lần và phần trăm đã kẹp 0–100.
  - `userSpaceOnUse` nghĩa là theo hệ tọa độ của phần tử **bao gồm `transform` của nó** (SVG 1.1 §14.3.5): hộp bao cục bộ đo bằng `getBBox` nằm đúng trong hệ này, nên phần tử có `transform` gốc vẫn cắt đúng.
  - `clipPath` sinh lúc chạy không ghi vào file; `elements` trỏ vào phần tử gốc. `rect` vẫn dùng `geometry.levelPercent` (đổi `y/height` của chính nó, như 0.2).
  - Nếu phần tử đã có `clip-path` gốc: không bọc thêm `<g>`; Studio từ chối đề nghị `clipLevel` ("phần tử đã có clip-path; gắn cho nhóm chứa nó") và bản TS cảnh báo `W_BIND_CLIP_EXISTS` (cần nội dung SVG).
- **Lý do:** roadmap yêu cầu "cutaway mức chất lỏng (`rect`, và hình bất kỳ qua `clipPath`)". Cắt bằng `clipPath` không đổi hình học nên hợp hình cong; đo `bbox` một lần giữ nguyên tắc "không gọi `getBBox` mỗi lần cập nhật" của `DomApplier`.
- **Phương án khác đã xét:**
  - **Gradient `linearGradient` có hai stop trùng vị trí** (mức bằng điểm dừng): đổi `offset` mỗi lần; chỉ đổi màu nền được, không cắt được hình có nhiều lớp. Loại.
  - **Mặt nạ (`mask`):** tốn hơn clip; không cần anti-alias riêng. Loại.
  - **`clip-path: inset()` CSS trên phần tử:** `inset` theo hộp tham chiếu `fill-box` hoạt động ở Chrome cho phần tử SVG và không cần `defs`; nhưng hộp tham chiếu và hợp với `transform` kém ổn định giữa trình duyệt (Chrome ≥ 120 vẫn có sai khác với `stroke-box`). Giữ `clipPath` làm bản chính; spike T006 thử `inset()` như phương án thay nếu `clipPath` chậm.

## R11. Nhấp nháy

- **Quyết định:**
  - Hoạt ảnh Web Animations: `opacity` giữa 1 và `minOpacity` (mặc định 0,2) hoặc `fill`/`stroke` giữa màu hiện tại và `color`; `easing: 'steps(1, jump-none)'` hai trạng thái (bật/tắt gọn), `iterations: Infinity`, `duration` = `period` (400–5.000 ms, mặc định 1.000).
  - **Chung pha:** mọi hoạt ảnh nhấp nháy của một màn hình đặt `startTime` = bội nguyên của `period` theo `document.timeline.currentTime` (làm tròn xuống) nên các phần tử cùng chu kỳ cùng pha; chu kỳ khác nhau không cần cùng pha.
  - Điều kiện bật: `true`, số khác 0; tắt thì hủy hoạt ảnh và trả thuộc tính về giá trị gốc (xóa `style` đã đặt).
  - `prefers-reduced-motion: reduce`: không chạy hoạt ảnh; khi bật, phần tử giữ ở trạng thái "bật" tĩnh (độ mờ 1 hoặc màu `color`); đọc `matchMedia` một lần mỗi màn hình và nghe `change`.
  - Khi tab ẩn: `pause()`; hiện lại: `play()` (như `spin` của 0.2).
  - Studio: cảnh báo "nhấp nháy không nên là tín hiệu duy nhất" khi phần tử chỉ có binding nhấp nháy (không có binding màu hay chữ cùng Tag).
- **Lý do:** hướng dẫn trợ năng về ánh sáng nhấp nháy giới hạn 3 lần/giây; chu kỳ ≥ 400 ms cho tối đa 2,5 lần/giây. Hai trạng thái bước rõ ràng như đèn báo SCADA. `prefers-reduced-motion` là thiết lập hệ điều hành của người dùng (WCAG 2.3.3).
- **Phương án khác đã xét:** SMIL `animate` (loại ở allowlist); CSS `@keyframes` (cần `<style>` hay sửa SVG); tự chạy `setInterval` (không tạm dừng khi tab ẩn tự động, lệch pha giữa phần tử).

## R12. Dòng chảy trong ống

- **Quyết định:**
  - Áp lên phần tử có nét: đặt `stroke-dasharray` = `dash` (mặc định `12 8`) nếu phần tử chưa có; Web Animations `strokeDashoffset: 0 → -P` (P = tổng mẫu `dash`), `iterations: Infinity`, `easing: linear`, `duration` = `P / speedBase` ms; đổi tốc độ bằng `animation.updatePlaybackRate(speed / speedBase)` (không khởi động lại); giá trị 0 hoặc tắt: `pause()`; chiều ngược: `playbackRate` âm hoặc `direction: 'reverse'` (chọn `direction` + `playbackRate` dương để `updatePlaybackRate` không phải xử lý dấu).
  - Tốc độ: `speed` đơn vị đồ họa/giây, 0–300; nguồn: BOOL/số khác 0 → `speed` cố định; hoặc `linearScale` giá trị → tốc độ; `byValueSign: true` thì dấu của giá trị chọn chiều.
  - `prefers-reduced-motion` và tab ẩn: như R11.
- **Lý do:** cùng cơ chế với quay liên tục (đã chạy ở 0.2, có tạm dừng khi tab ẩn); `updatePlaybackRate` cho đổi tốc độ mượt; một hoạt ảnh mỗi phần tử.
- **Phương án khác đã xét:** thêm phần tử hạt chạy dọc đường dẫn (SMIL `animateMotion`, bị loại); `stroke-dashoffset` bằng `requestAnimationFrame` (CPU); `<animate>` SMIL.

## R13. Sự kiện của phần tử SVG và đường ghi

- **Quyết định:**
  - **Dữ liệu:** `events.click` trong file binding (R1); hành động = 6 hành động của 007 cộng `tag`, `confirm`, `minRole`, `label` cho ba hành động ghi.
  - **Gắn lúc chạy:** `<mat-screen>` (item `svg`) sau khi dựng và áp binding, với mỗi phần tử có `events`: đặt `cursor: pointer`, `pointer-events: all`, `tabindex=0`, `role=button`, `aria-label`, nghe `click` và `keydown` (Enter, Space) trên chính phần tử (không ủy quyền lên gốc để phần tử sâu nhất thắng và `stopPropagation` đúng).
  - **Ghi:** `svgActionController(action, ctx)` trong `@mat/ui-components` dựng `WidgetItem` ảo `{ id: uid, type: 'widget', widget: 'button', x: 0, y: 0, width: 1, height: 1, tags: { target: tag }, props: { confirm }, events: { click: action }, security: { minRole } }` và trả một `ControlController` như nút của widget; `context` = `{ screen: screen.id, widget: uid }`. Hộp xác nhận, khóa, trạng thái, kết quả dùng nguyên của 007; vùng thông báo `role="status"` ở góc dưới của `<mat-screen>` hiện lý do khóa và kết quả khi nhấp (một vùng cho cả màn hình).
  - **Bảng khóa:** như 007 (`NO_SESSION`, `ROLE`, `INSECURE`, `HTTPS_DOWN`, `SESSION_EXPIRED`, `LIVE_LOST`, `TAG_UNKNOWN`, `TAG_READONLY`, `QUALITY_BAD`, `NO_VALUE`, `BUSY`, `OTHER_DIALOG`, `PROJECT_CHANGING`); hành động `navigate`, `popup`, `closePopup` không khóa.
  - **Ẩn:** khi `style.visibility` do binding thành `hidden` hoặc `display: none`, đặt `pointer-events: none` và `tabindex=-1`; hiện lại thì khôi phục.
  - **Audit:** không đổi API: `context.widget` nhận `elementUid` (≤ 43 ký tự, hợp mẫu), `context.screen` id màn hình (007 FR-051 của contract).
  - **Mô phỏng/Thiết bị trong Studio:** `ActionHost` của 007 (`SimActionHost`, `DeviceActionHost`) không đổi.
- **Lý do:** một đường ghi và một bộ khóa (Constitution V); không thêm bề mặt API nên không thêm bản ghi tấn công mới ngoài việc chạy lại 30 ca của 007 với nguồn là phần tử SVG. `pointer-events: all` làm hình `fill: none` nhận nhấp. Gắn trình xử lý từ dữ liệu đã kiểm, không từ thuộc tính SVG (`on*` đã bị loại) nghĩa là SVG không thể tự khai báo hành vi.
- **Phương án khác đã xét:**
  - **Đổi `context` thành `{ screen, item, element }`:** nâng API lên 1.2.1 và đụng C++ của 006/007 (kiểm mẫu `context`) chỉ để thêm một trường tham khảo. Loại; `elementUid` đã đủ để truy ngược (audit + file binding).
  - **Viết hộp xác nhận riêng cho SVG:** hai nơi giữ quy tắc an toàn. Loại.
  - **Ủy quyền sự kiện ở gốc SVG:** khó đúng với hình `fill: none` và Shadow DOM `composedPath`; không có lợi về hiệu năng (≤ 2.000 phần tử có sự kiện, thực tế vài chục).

## R14. Trợ năng và con trỏ

- **Quyết định:** `aria-label` = `label` của sự kiện → `title` của phần tử → tên phần tử; `role="button"`; khóa: `aria-disabled="true"` và lý do trong `aria-describedby` trỏ tới vùng `role="status"`; viền focus: quy tắc CSS của Shadow DOM item `[data-mat-clickable]:focus-visible { outline: 2px solid var(--mat-focus); outline-offset: 2px }` (thuộc tính `data-mat-clickable` do mã đặt khi chạy, không có trong SVG); phần tử khóa `opacity` giảm 0,6 (qua thuộc tính CSS tùy biến không đụng binding `opacity`: dùng `filter: grayscale(0.6)`); tương phản hai theme.
- **Lý do:** FR-049, SC-015. `filter` cho khóa tránh tranh giành `opacity` với binding.
- **Phương án khác:** đổi `opacity` (xung đột binding); không báo khóa (người vận hành không hiểu).

## R15. Chọn phần tử trong canvas Studio

- **Quyết định:**
  - Nhấp = chọn item; **nhấp đúp hoặc Enter** trên item `svg` = "vào item" (con trỏ thành chữ thập, thanh trên canvas hiện đường dẫn "Màn hình › Item"); trong chế độ vào: `shadowRoot.elementsFromPoint(x, y)` (hoặc `document.elementsFromPoint` rồi lọc theo `host.shadowRoot`) trả chồng phần tử; chọn phần tử có `data-mat-uid` nhỏ nhất (đầu danh sách, sâu nhất); **Alt+nhấp** chọn phần tử cha kế tiếp; Esc hoặc nhấp ra ngoài item thoát.
  - Khung chọn: `getBoundingClientRect()` của phần tử (hoặc `getBBox` + ma trận màn hình của `getScreenCTM`) quy về đơn vị thiết kế bằng hệ số zoom của viewport; tính lại khi zoom, pan, đổi cỡ; vẽ ở lớp phủ của canvas (không sửa DOM của SVG).
  - Cây phần tử trong Details (`mat-details`): dựng **lười** (con mở khi bung); hiển thị `data-mat-name`; ô lọc; chọn trong cây cuộn canvas tới phần tử và tô khung.
  - Chọn nhiều: Shift+nhấp (cùng item).
  - Phím: Tab/Shift+Tab đi theo thứ tự tài liệu giữa các phần tử gắn được; mũi tên lên/xuống/trái/phải trong cây; Enter mở inspector; Delete không làm gì (Studio không xóa phần tử SVG, D26).
- **Lý do:** TIA Portal "vào nhóm"; một nhấp phải vẫn là chọn item để kéo và đổi cỡ (đã làm ở 007), nên cần cử chỉ riêng để chọn bên trong. `elementsFromPoint` có sẵn trong Chrome, không phải tự viết hit-test hình học cho `path` cong.
- **Phương án khác đã xét:** tự tính hit-test hình học (R20 của 007 không có cho `path`); chọn trực tiếp không cần "vào" (khó kéo item); thêm chế độ công cụ riêng.

## R16. Inspector Gắn Tag, Gợi ý, Thử giá trị

- **Quyết định:**
  - Inspector sinh từ **danh sách động hóa** (`animation-catalog.ts`): mỗi mục có `id`, `target`, nhãn, loại phần tử cho phép, kiểu Tag cho phép, phép biến đổi cho phép, bộ tham số (đặc tả trường: kiểu, khoảng, mặc định). Một mục thêm bằng dữ liệu.
  - Dòng: nhãn, ô Tag (kéo thả, nút chọn), nút phép biến đổi (Trực tiếp, Rời rạc, Tuyến tính, Bảng giá trị, Khoảng — theo mục), vùng tham số gập; hiển thị giá trị hiện tại (Mô phỏng hoặc Online).
  - **Gợi ý** theo bảng của [contracts/studio-svg-editor.md](contracts/studio-svg-editor.md) §6.
  - **Thử giá trị:** dùng `SimEngine` của Studio (006) ở chế độ nhập tay cho Tag của dòng đang chọn; canvas ở chế độ Mô phỏng tạm thời cho item đang xem; kết thúc khi bỏ chọn hoặc Đặt lại.
  - Tài liệu binding trong bộ nhớ: `svg-binding-doc.ts` (thao tác thuần: `addBinding`, `updateBinding`, `removeBinding`, `copyBindings`, `applyToMany`, `renameTag`), mỗi thao tác một bước lịch sử (`history.ts` có sẵn, 100 bước).
  - Kiểm liên tục bằng `rules-04.ts` (TS) trên tài liệu; lỗi gắn vào dòng theo `path`.
- **Lý do:** FR-031…FR-046; studio-ux §5 (cột Dynamization). Dữ liệu hóa danh sách giúp thêm hiệu ứng mà không viết giao diện mới, như danh mục widget của 007.
- **Phương án khác:** ô JSON thô trong inspector (người dùng đã từ chối giao diện form cơ bản; trái D3); trình hướng dẫn nhiều bước (chậm hơn một dòng).

## R17. Thư viện ký hiệu, thể hiện và điểm gắn

- **Quyết định:**
  - Package `packages/symbol-library` (`@mat/symbols`): `manifest.json`, `svg/*.svg`, `LICENSES.md`, `src/index.ts` (nạp, tra cứu), test.
  - 12 ký hiệu: bồn đứng, bồn nằm, bơm ly tâm, bơm định lượng, van cổng, van điều khiển, van một chiều, motor AC, quạt, ống ngang, ống đứng, cút. (Danh sách và bộ phận: [contracts/symbol-library.md](contracts/symbol-library.md).) Vẽ bằng mã (SVG viết tay) và kiểm bằng allowlist; không dùng nguồn ngoài.
  - **Thể hiện** = item `svg` mới; `svgFile` = `graphics/symbols/<id>.svg` dùng chung giữa thể hiện; `bindingFile` = `screens/<màn hình>.<item>.bindings.json` mỗi thể hiện một file.
  - **Điểm gắn:** `{ id, x, y, dir, kind }` (tọa độ tương đối `[0, 1]` trên `viewBox` của ký hiệu; `dir` `n/e/s/w`; `kind` `pipe`); dính khi hai điểm cùng `kind`, hướng đối nhau (hoặc bất kỳ nếu `dir` vắng) trong 10 điểm ảnh màn hình; chỉ siêu dữ liệu của thư viện, **không** lưu vào project (thể hiện không biết "nối với ai").
  - **Bộ phận:** `{ role, uid, label, suggest: [animationId] }`; UID cố định `el_<ký hiệu>_<bộ phận>` (dùng được vì UID chỉ cần duy nhất trong item).
- **Lý do:** thể hiện = item cho sẵn di chuyển, đổi cỡ, khóa, xếp lớp (007) mà không cần trình sửa SVG (GĐ 6); giữ SVG chung giúp project gọn (một file cho 20 bơm). Điểm gắn là siêu dữ liệu thuần để dính, tránh phải thêm đối tượng "kết nối" vào định dạng.
- **Phương án khác đã xét:**
  - **Gộp ký hiệu vào một SVG lớn của màn hình:** cần trình sửa SVG (chèn `<g>`, đổi UID), ngoài phạm vi (D26). Loại.
  - **Ký hiệu là widget:** widget nằm ngoài SVG, không gắn được vào phần tử hình học (ADR-013 hệ quả); ký hiệu cần binding theo phần tử. Loại.
  - **Mua/nhập bộ ký hiệu ngoài (ISA, ANSI):** vướng bản quyền và giấy phép. Loại (FR-055).

## R18. Fixture, so ảnh và giấy phép

- **Quyết định:**
  - **10 fixture** ở `tests/fixtures/svg-import/` (tên `inkscape-01…04`, `illustrator-01…03`, `corel-01…03`), mỗi file kèm mục trong `manifest.json` (nguồn gốc, giấy phép, đặc trưng đã tái tạo, giới hạn mô phỏng, mã báo cáo mong đợi, vùng khác biệt đã khai).
  - **Inkscape (thật):** script `tools/svg-fixtures/make-inkscape.ps1` viết bản vẽ nguồn bằng SVG tối giản (do dự án viết) rồi chạy `inkscape --export-filename` (Inkscape SVG, giữ namespace `sodipodi`/`inkscape`, `namedview`, layer) ra file fixture; ghi phiên bản Inkscape vào `manifest.json`. Nếu Inkscape không chạy được trên máy: task dừng và báo (không giả).
  - **Illustrator và CorelDRAW (mô phỏng):** viết tay theo đặc trưng cấu trúc ghi ở `svg-dialects.md` và tài liệu công khai của hai định dạng xuất (Save As cũ, Export As, Export for Screens; CorelDRAW SVG): đặc trưng tái tạo ghi từng dòng; **giới hạn** ghi rõ trong README và `manifest.json`: không chứng minh cách phần mềm thật sinh id, làm tròn số, thứ tự thuộc tính, phiên bản; kết quả SC-001 cho hai phần mềm là "đạt trên mô phỏng".
  - **Giấy phép:** do dự án tạo (CC0); không dùng ký hiệu, logo, font nhúng có bản quyền; text dùng họ font chung (`Arial`, `Courier New`, `sans-serif`).
  - **So ảnh:** trang Chrome headless: dựng cả hai SVG vào `<img>`/Shadow DOM cùng `viewBox` cỡ 1200 × 800, vẽ vào `canvas` 2D, so từng điểm ảnh (`ΔRGB` lớn nhất theo kênh > 64/255 là "khác rõ"); ghi `docs/reports/008-fixtures.json` (tỉ lệ từng fixture, ngưỡng, phiên bản Chrome). Ảnh Inkscape tự xuất (`inkscape --export-type=png -w 1200`) so với Chrome vẽ bản **đã nhập** (và, để biết phần khác biệt do import, cả bản gốc).
  - **Khác biệt đã khai** (không tính vào ngưỡng): nội dung nhánh dự phòng của `switch`/`foreignObject` (chữ thay HTML); `flowRoot` chuyển thành một dòng.
  - **Ca độc hại** ở `tests/fixtures/svg-import/malicious/*.svg` (≥ 24), mỗi ca kèm `*.expect.json` (mã báo cáo mong đợi hoặc mã từ chối).
  - **Cặp nhập lại** ở `tests/fixtures/svg-import/reimport/<cặp>/{v1.svg, v2.svg, answer.json}`; v2 tạo bằng Inkscape (giữ hoặc bỏ `data-*`), bằng chuyển đổi LibreOffice (nếu `soffice` có), bằng script biến đổi (dời, nhóm lại, đổi tên, thêm, xóa).
- **Lý do:** yêu cầu nghiệm thu "10 fixture… tạo fixture hợp lệ về giấy phép; Illustrator/CorelDRAW không có trên máy dev: mô phỏng… ghi rõ giới hạn". Tỉ lệ 0,5 % cho "import không đổi hình" chặt hơn 1,66 % của thí nghiệm Inkscape-vs-Chrome vì hai ảnh cùng do Chrome vẽ (không có khác biệt khử răng cưa).
- **Phương án khác đã xét:** dùng SVG công khai trên mạng (giấy phép lẫn lộn, không kiểm soát); thư viện so ảnh (pixelmatch: thêm phụ thuộc).

## R19. Bộ SVG độc hại và harness

- **Quyết định:** ≥ 24 ca ở `malicious/` theo bảng ở [contracts/svg-import.md](contracts/svg-import.md) §8; harness `tools/svg-import/malicious-harness.mjs`:
  1. nhập từng ca bằng `importSvg` (jsdom): so với `*.expect.json`;
  2. kiểm bản đã nhập **không còn** gì ngoài allowlist (chạy lại `assertAllowlisted`);
  3. dựng bản đã nhập trong Chrome headless với `window.__pwned = null`, chặn mọi yêu cầu mạng bằng `page.setRequestInterception` (đếm), nghe `console`/`pageerror`; mong đợi `__pwned === null` và 0 yêu cầu mạng;
  4. dựng **bản gốc** ở trang riêng tắt bộ lọc: ≥ 1 ca phải làm `__pwned` khác null (canary có hiệu lực).
- **Lý do:** FR-062, SC-003; kiểm hai lớp (importer và bộ lọc ở trang).
- **Phương án khác:** chỉ kiểm cấu trúc DOM sau nhập (không chứng minh không chạy mã).

## R20. Ngân sách BL335 và phục vụ file SVG

- **Quyết định:**
  - Feature **không đổi** phía BL335 ngoài: (1) validator C++ cho luật 0.4 (thêm vài trăm dòng, chạy lúc nạp); (2) tăng `RUNTIME_VERSION`; (3) tập file `/project/*` có thêm file SVG và binding của ≤ 64 item mỗi màn hình × ≤ 32 màn hình (đã nằm trong `projectAllowlist` theo `projectFiles`). Ước tính RSS tăng < 0,5 MB (danh sách đường dẫn; hằng số), CPU không đổi.
  - **Không nén file project** ở BL335: `Cache-Control: no-cache`, không `.gz`. Khuyến nghị và kiểm: `W_SVG_HEAVY` từ 1 MiB; chuẩn hóa gọn (làm tròn số, bỏ metadata/`defs` không dùng).
  - Ước tính tải F5: 10 client × (SVG trung bình 300 KB + binding 30 KB) ≈ 3,3 MB ≈ 0,4 s ở 65 Mbps; màn hình 40 item `svg` dùng chung 6 file SVG: 10 × (6 × 100 KB + 40 × 5 KB) ≈ 8 MB ≈ 1 s. **Chưa đo trên BL335**: task ⚠️🔌.
  - Phía máy khách: hoạt ảnh vô hạn ≤ 64 cảnh báo, 256 lỗi; số đo SC-008 trên máy dev.
- **Lý do:** Constitution III (ngân sách BL335) và D31. Nén tại runtime cần zlib hoặc tiền nén trong gói (gói 1.0.0 chỉ chứa `.json`, `.svg`): ngoài phạm vi; điều kiện xem xét lại nếu số đo không đạt.
- **Phương án khác đã xét:** Studio đóng gói thêm `.svg.gz` (đổi định dạng gói, `check_rel` cấm đuôi); bật nén tại CivetWeb (không có zlib trong build hiện tại, thêm phụ thuộc).

## R21. Mô hình mối đe dọa của nhập SVG và sự kiện (rà soát bảo mật, FR-064)

| Mối đe dọa | Điều kiện | Giảm thiểu |
|---|---|---|
| Chạy mã qua SVG (`script`, `on*`, `javascript:`, `href` của `a/use/image`, SMIL đổi `href`, `foreignObject`, `iframe`) | file độc hại được nhập hoặc sửa tay trên đĩa | allowlist importer và bộ lọc ở trang (R2); CSP `kCspProject` cho `/project/` (đã có); canary trong harness (R19) |
| Kéo tài nguyên ngoài (CSS `@import`, `url(http…)`, `image href=http`, `feImage`, `use` ngoài) | như trên | `url()` chỉ `#id` nội bộ; `href` chỉ `#id` hoặc `data:image` hợp lệ; chặn mạng trong harness |
| XXE, "billion laughs" | DTD trong file | `prescan` bỏ DTD, chỉ thay entity Adobe đã biết (R3) |
| Bom tài nguyên: file lớn, quá nhiều node, quá sâu, `use` nở cấp số nhân, filter nặng, ảnh khổng lồ | file độc hại hoặc vô tình | giới hạn cứng (FR-015), đếm hiệu dụng `use`, bỏ primitive nặng; từ chối trước khi dựng |
| mXSS/CDATA/bình luận lách bộ phân tích | nội dung `style`/`text` | giá trị dữ liệu đi qua DOM đã parse và bộ ghi riêng thoát ký tự; không đưa chuỗi qua `innerHTML` (lint) |
| Giả mạo `data-mat-uid` để chiếm binding khi nhập lại | file nhập lại có UID của phần tử khác | UID ngoài tập UID bản cũ bị bỏ; UID trùng hai phần tử bỏ; khớp mơ hồ phải hỏi (R7) |
| Sự kiện SVG ghi Tag ngoài ý muốn (nhấp nhầm, phần tử vô hình đè lên) | thiết kế xấu hoặc SVG độc hại che nút | xác nhận mặc định; khóa theo quyền; phần tử ẩn không nhấp; lệnh qua đường ghi có audit, role, CSRF (007); xác nhận hiện Tag và giá trị thật nên người vận hành thấy việc sẽ làm |
| XSS đã thực thi dùng sự kiện để ghi | lỗi ở nơi khác | giới hạn còn lại đã ghi ở 007: XSS chạy được ghi dưới quyền operator đang đăng nhập; không thêm bề mặt |
| Lộ thông tin trong báo cáo import (đường dẫn máy người dùng ở `file:///…`) | báo cáo chia sẻ | báo cáo chứa tên thẻ, mã, đường dẫn phần tử; đường dẫn ảnh liên kết cắt còn tên file |
| `svg_open` đọc file tùy ý | giao diện bị chiếm | chỉ qua hộp thoại hệ thống, đuôi `.svg`, ≤ 5 MiB + 64 B, byte thô trả cho giao diện (không lưu), như `csv_open` |
| Runtime C++ nhận gói có SVG độc | gói do Studio cũ hay công cụ khác tạo | trang lọc lại; CSP; Studio chặn đóng gói (`E_SVG_UNSAFE`); ghi rõ giới hạn (D30) |

## R22. Thư viện, license, phiên bản

- **Quyết định:** **không thêm thư viện ngoài** (npm, crate, C++). Tự viết: bộ phân tích CSS, bộ quét tiền xử lý, bộ ghi SVG, so ảnh trong trang. Dùng: jsdom (đã có, devDependency), puppeteer-core, axe-core, Lit 3.3.3, `@fluentui/svg-icons` (thêm icon).
- **Package mới:** `@mat/svg-import` 0.1.0 (Studio, CLI, test), `@mat/symbols` 0.1.0 (thư viện ký hiệu). `@mat/ui-components` 0.1.0 → 0.2.0; `@mat/svg-renderer`, `@mat/binding-engine` (private, không version độc lập).
- **Lý do:** FR-063; mỗi thư viện thêm là một bề mặt tấn công và một dòng license.
- **Phương án khác:** DOMPurify, css-tree, pixelmatch (R2, R4, R18).

## R23. Chiến lược kiểm thử

- **Vitest (viết trước):** `allowlist.test.ts` (mỗi phần tử, thuộc tính, giá trị), `prescan.test.ts`, `css.test.ts` (cascade), `normalize.test.ts`, `optimize.test.ts`, `uid.test.ts`, `match.test.ts` (đối chiếu), `import.test.ts` (10 fixture, ≥ 24 độc hại, ≥ 12 giới hạn), `applier.test.ts` (hợp biến đổi, `clipLevel`, blink, flow, pivot), `svg-action-controller.test.ts`, `rules-04.test.ts`, `vectors-04.test.ts`.
- **Vector chung:** `tests/project-vectors` ca `v04-*` (≥ 100) cho TS và C++; `tests/migration-vectors` cặp 0.3 → 0.4.
- **GoogleTest:** luật 0.4 trong `core/project-manager/tests`; chạy cùng vector.
- **e2e Chrome headless (Studio, lớp Tauri giả, axe-core):** nhập, báo cáo, vào item, chọn phần tử, gắn từng loại, Thử giá trị, sự kiện, nhập lại, ký hiệu, dựng lại `tank-demo`.
- **e2e trang runtime (runtime giả):** hoạt ảnh, sự kiện, khóa, nhãn đọc.
- **web-it x64:** kịch bản `svg` (project có đồ họa nhập; nhấp phần tử ghi qua giả lập Modbus; 30 ca tấn công của 007 với nguồn phần tử SVG; F5 ×10; đo RSS/CPU).
- **Đo hiệu năng hoạt ảnh:** `tools/measure/anim-bench.mjs` (Chrome headless, `performance.now` mỗi khung, `tracing` tùy chọn).
- **Kiểm tay (cần người):** bộ gõ khi đặt tên phần tử, nhãn; trình đọc màn hình; Chrome và WebView2 thật; file SVG thật từ Illustrator/CorelDRAW.

## R24. Lệnh Rust `svg_open`

- **Quyết định:** `svg_open(app) → Option<SvgFile { name, bytes_b64? }>`: hộp thoại hệ thống `.svg`; từ chối > 5 MiB + 64 B (`TooLarge`) và đuôi khác; trả byte thô (Tauri truyền `Vec<u8>` qua JSON dạng mảng số; dùng `tauri::ipc::Response` nhị phân nếu `csv_open` đã làm vậy), tên file không đường dẫn; thêm test `cargo test --lib` (đọc đúng byte, từ chối quá lớn, từ chối đuôi sai, hủy trả `None`). Không có `svg_save`: ghi vào project dùng lệnh `project_write` hiện có (đường dẫn `graphics/…svg` qua `check_rel`).
- **Lý do:** khuôn `csv_open` đã qua review của 006; giữ nguyên tắc "giao diện không tự đọc/ghi file ngoài thư mục project".
- **Phương án khác:** kéo thả file vào cửa sổ (Tauri cho đường dẫn tuyệt đối tới giao diện: mở đường đọc tùy ý); đọc bằng `<input type=file>` của WebView (quyền khác biệt giữa WebView2 và test; chọn đường Rust để nhất quán và dễ kiểm kích thước trước khi nạp vào bộ nhớ giao diện).
