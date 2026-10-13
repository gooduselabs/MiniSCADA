# Feature Specification: Nhập SVG, gắn Tag cho phần tử SVG, animation và sự kiện

**Feature Branch**: `008-svg-import-binding`

**Created**: 2026-10-13

**Status**: Draft

**Input**: User description: "GĐ 3b của lộ trình v2: SVG import, gắn Tag bằng inspector, animation, sự kiện. Importer SVG: sanitizer allowlist trên DOM đã parse (thay denylist hiện tại), giới hạn 5 MB, 20.000 node, độ sâu 32 (Constitution V), tự gán `data-mat-uid`, giữ UID khi import lại (đối sánh theo cấu trúc/đường dẫn), báo cáo import (loại gì, vì sao). Gắn Tag cho phần tử SVG bằng inspector: chữ hiển thị giá trị (định dạng, bảng giá trị); màu fill/stroke theo bảng giá trị hoặc theo khoảng; cutaway mức chất lỏng (`rect`, và hình bất kỳ qua `clipPath`); quay, quay liên tục; di chuyển, co giãn; nhấp nháy; dòng chảy trong ống; ẩn/hiện. Chọn phần tử trên canvas Studio; tạo binding không viết tay JSON. Sự kiện: nhấp để chuyển màn hình, mở popup, ghi/đảo/xung Tag (xác nhận + kiểm quyền; dùng cùng đường ghi của 006/007). Thư viện ký hiệu cơ bản: bơm, van, bồn, motor, ống (SVG sạch, có điểm gắn). Nghiệm thu: 10 fixture từ Inkscape, Illustrator, CorelDRAW import và hiển thị đúng ở Studio và Chrome (fixture hợp lệ về giấy phép; Illustrator/CorelDRAW không có trên máy dev: mô phỏng đặc trưng cấu trúc xuất của chúng, ghi rõ giới hạn); SVG độc hại bị loại; màn hình bồn nước + motor dựng lại hoàn toàn trong Studio; RSS ≤ 150 MB, CPU ≤ 30 %, mở màn hình ≤ 2 s. Ngoài phạm vi: trình vẽ SVG đầy đủ, faceplate/template (GĐ 6); alarm (GĐ 4); biểu đồ lịch sử (GĐ 5)."

## Bối cảnh

Sau GĐ 3a ([007](../007-screens-widgets/spec.md)), mỗi màn hình là một khung gồm các item xếp lớp: item `svg` (đồ họa có binding theo `elementUid`) và item `widget`. Nhưng phần **đồ họa** vẫn chưa dùng được ngoài thử nghiệm:

- **Không có trình nhập SVG.** Muốn có một item `svg`, kỹ sư phải tự thêm `data-mat-uid` vào file SVG và viết file binding bằng tay (D37 của 007: Studio 0.5.0 chỉ có item `svg` sinh từ nâng cấp 0.2). Bộ lọc [sanitize.ts](../../packages/svg-renderer/src/sanitize.ts) là **denylist tạm thời** và chưa có giới hạn kích thước, số node, độ sâu; đây là nợ Constitution V đã ghi ở [báo cáo Sprint 1](../../docs/reports/sprint1-acceptance.md), [ADR-007](../../docs/adr/007-screen-isolation.md) và [ADR-003](../../docs/adr/003-element-uid.md).
- **Binding chỉ viết tay.** Inspector hiện chỉ đọc binding ([props-element.ts](../../apps/studio/src/ui/props-element.ts)). `DomApplier` biết đổi chữ, màu, độ mờ, ẩn/hiện, mức chất lỏng của `rect` và quay; chưa có di chuyển, co giãn, nhấp nháy, dòng chảy, mức chất lỏng cho hình bất kỳ, màu theo khoảng ([transforms.ts](../../packages/binding-engine/src/transforms.ts) báo `rangeMap` là chưa hỗ trợ).
- **Phần tử SVG chưa nhấp được.** Không có sự kiện: nhấp bơm để bật, nhấp nút trên sơ đồ để sang màn hình khác.
- **Chưa có ký hiệu mẫu** (bơm, van, bồn, motor, ống) và chưa có SVG xuất thật từ Illustrator, CorelDRAW ([tests/fixtures/svg/README.md](../../tests/fixtures/svg/README.md), T036 của Sprint 0).

GĐ 3b của [lộ trình v2](../../docs/plans/roadmap-v2.md) (§4.4) giải quyết các điểm này. Ràng buộc chính của [Constitution](../../.specify/memory/constitution.md) 2.0.1:

- **II:** `core/` không parse SVG để render; importer, sanitizer, `DomApplier`, widget dùng chung ở `packages/*` cho Studio và Chrome. Render và animation chạy trên Chrome của client, không chạy trên BL335.
- **III:** ngân sách BL335: RSS ≤ 150 MB, CPU trung bình ≤ 30 % với 500 Tag/1 s/10 client. Feature này không thêm việc tính toán lên BL335 (chỉ phục vụ file tĩnh lớn hơn và kiểm tra thêm khi nạp project).
- **V:** SVG import dùng **allowlist trên DOM đã parse (không regex)**, có giới hạn kích thước/node/độ sâu; không `eval`, không script; mọi lệnh ghi Tag kiểm role, quyền, trạng thái và ghi audit (cùng đường ghi của 006/007).
- **VI:** test viết trước. **VII:** schema theo SemVer có migration; YAGNI theo giai đoạn (trình vẽ SVG đầy đủ là GĐ 6).

Giao diện Studio theo [studio-ux.md](../../docs/architecture/studio-ux.md) §5, §9 (3b: Import SVG, cây phần tử SVG, gắn Tag cho phần tử, thư viện ký hiệu) và chuẩn IDE kiểu TIA Portal của người dùng; không làm form cơ bản. Mockup của feature: [studio-svg.html](../../docs/architecture/mockups/studio-svg.html) (task tạo ở bước làm).

**Thuật ngữ:**

- **Importer**: bộ nhập SVG của Studio (`@mat/svg-import`): đọc file ngoài, kiểm giới hạn, làm sạch bằng allowlist, chuẩn hóa, gán UID, sinh **báo cáo import**.
- **Allowlist**: danh sách phần tử, thuộc tính, thuộc tính CSS và dạng giá trị được giữ lại; mọi thứ ngoài danh sách bị loại. Một bản dùng chung cho importer (Studio) và trang runtime (Chrome).
- **UID**: `elementUid`, `data-mat-uid`, định danh bất biến của phần tử SVG ([ADR-003](../../docs/adr/003-element-uid.md)). **Phần tử gắn được**: phần tử vẽ được (hình, chữ, nhóm, `use`, ảnh) nằm ngoài `defs`, `clipPath`, `mask`, `symbol`, `pattern`, `marker`.
- **Nhập lại (re-import)**: thay file SVG của một item `svg` bằng bản đã chỉnh sửa ngoài Studio, giữ UID và binding theo đối chiếu cấu trúc.
- **Binding SVG**: gắn một thuộc tính hiển thị của phần tử (đích: chữ, màu, mức, quay, di chuyển, co giãn, nhấp nháy, dòng chảy, ẩn/hiện, độ mờ) với một Tag qua một phép biến đổi. **Animation**: kiểu binding có chuyển động (quay liên tục, nhấp nháy, dòng chảy).
- **Sự kiện SVG**: hành động của một phần tử SVG khi nhấp: chuyển màn hình, mở popup, ghi, đảo, xung Tag. Chỉ có hành động có sẵn, không script.
- **Ký hiệu**: một SVG sạch của thư viện cơ bản (bơm, van, bồn, motor, ống) kèm danh sách **bộ phận** (phần tử có UID cố định, gợi ý binding) và **điểm gắn** (cổng nối ống).
- **Item `svg`**, **màn hình**, **widget**, **popup**, **hành động**: như [007](../007-screens-widgets/spec.md).
- **BL335**: thiết bị chạy runtime, như 005–007.

**Nền chung** cho mọi story: định dạng project **0.4.0** (binding mở rộng, sự kiện SVG, giới hạn 64 item `svg` mỗi màn hình), sanitizer allowlist dùng chung, package `@mat/svg-import`. Phần này được nghiệm thu qua User Story 1 kịch bản 1–6, FR-001…FR-010, FR-023 và SC-011, SC-012. Các quyết định đã chốt và quyết định khi viết spec nằm ở mục Assumptions (D1–D40).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Nhập SVG từ Inkscape, Illustrator, CorelDRAW vào Studio an toàn (Priority: P1)

Kỹ sư vẽ sơ đồ bồn nước và motor bằng Inkscape (hoặc nhận file từ nhà thiết kế dùng Illustrator, CorelDRAW). Trong Studio họ mở màn hình "Bồn nước", bấm **Thêm › Đồ họa SVG…** (hoặc Ctrl+Shift+I) và chọn file. Một hộp thoại **Nhập SVG** hiện:

- ảnh xem trước **trước** (bản gốc đã lọc bằng allowlist: Studio không bao giờ dựng SVG chưa lọc) và **sau** (bản đã chuẩn hóa) cạnh nhau;
- dòng nhận diện phần mềm xuất ("Inkscape 1.4.4, chắc chắn");
- **báo cáo**: giữ bao nhiêu phần tử, gán bao nhiêu UID, đã loại gì và vì sao ("2 `script`: không cho phép script", "14 thuộc tính `onclick`", "1 `foreignObject`: nội dung HTML, đã dùng nhánh dự phòng", "5 khối `<style>` đã chuyển thành thuộc tính", "ảnh liên kết `file:///C:/…`: không hiển thị trên máy khác, hãy nhúng ảnh", "font `MyriadPro-Regular` đổi thành `Myriad Pro, sans-serif`");
- tùy chọn **Tối ưu** (gộp các hình nhỏ cùng kiểu) khi file vượt giới hạn node.

Họ bấm Nhập: màn hình có thêm một item `svg` đúng cỡ, có UID cho từng phần tử; cây Details hiện cây phần tử SVG với tên dễ đọc ("Bồn 1", "Nhóm bơm"). File độc hại (có `script`, `onload`, `javascript:`, ảnh ngoài, DTD khai báo entity, `use` lồng bùng nổ, file 6 MB) bị loại phần nguy hiểm hoặc bị từ chối hẳn kèm lý do, và không bao giờ chạy mã hay gọi mạng.

**Why this priority**: không có đường nhập SVG an toàn thì mọi phần còn lại (gắn Tag, sự kiện) không dùng được ngoài file viết tay; và allowlist là nợ Constitution V.

**Independent Test**: bộ `tests/fixtures/svg-import/` (10 fixture Inkscape, Illustrator, CorelDRAW; bộ SVG độc hại ≥ 24 ca) chạy qua `importSvg` bằng Vitest/jsdom; trong Chrome headless dựng cả ba bản (gốc, đã nhập, đã nhập qua trang runtime) và so ảnh; canary `window.__pwned` và chặn mạng bằng puppeteer.

**Acceptance Scenarios**:

1. **Given** 4 fixture Inkscape xuất thật (`inkscape-01…04`), **When** nhập, **Then** mỗi file nhập được; số phần tử vẽ được giữ nguyên (trừ phần loại có ghi trong báo cáo); ảnh dựng bằng Chrome từ bản đã nhập khác ảnh dựng từ bản gốc ≤ 0,5 % số điểm ảnh (SC-002); ảnh PNG do Inkscape tự xuất khác ảnh Chrome của bản đã nhập ≤ 3 % điểm ảnh khác rõ (trừ vùng đã khai ở `manifest.json`).
2. **Given** 3 fixture mô phỏng Illustrator (Save As cũ có DOCTYPE + ENTITY, `<switch>` + `foreignObject` + `i:pgf`; Export As có `.cls-N`, `data-name`, id gradient cố định; Export for Screens), **When** nhập, **Then** DTD bị bỏ sau khi thay các entity namespace đã biết; `switch` chỉ còn nhánh dự phòng; `i:pgf` và namespace Adobe bị loại; CSS chuyển thành thuộc tính; hình giống bản gốc ≤ 0,5 % (trừ chữ nhánh dự phòng, ghi trong báo cáo).
3. **Given** 3 fixture mô phỏng CorelDRAW (đơn vị mm + `viewBox` 100 đơn vị/mm, CSS trong CDATA `.fil0/.str0/.fnt0`, id `_x0020_`, metadata `xodm`), **When** nhập, **Then** `viewBox` được giữ, đơn vị `mm` khai báo ở `width/height` được quy về px, lớp CSS thành thuộc tính, hình giống bản gốc ≤ 0,5 %.
4. **Given** mỗi ca của bộ độc hại (script, `onload`/`onclick`, `javascript:` ở `a/use/image`, `data:text/html`, ảnh `http:`, `use` trỏ ngoài, `foreignObject` chứa iframe, `<style>@import`, `url(javascript:)` trong CSS, `expression(`, `-moz-binding`, thực thể mở rộng "billion laughs", XXE `SYSTEM "file:///…"`, `use` lồng bùng nổ, `animate/set` đổi `href`, thẻ viết hoa `<SCRIPT>`, `xhtml:script`, `<?xml-stylesheet?>`, ảnh `data:image/svg+xml` chứa script, `feImage` ngoài, `link`, `meta`, `base`, `audio`, `video`, CDATA lách, nhồi `data-mat-uid` giả), **When** nhập, **Then** bản đã nhập không còn phần tử, thuộc tính hay giá trị ngoài allowlist; ca không thể làm sạch (entity lạ, quá giới hạn) bị từ chối với mã lỗi; **không** có mã nào chạy và **không** có yêu cầu mạng khi dựng bản đã nhập trong Chrome (SC-003).
5. **Given** file 5 MiB + 1 byte, hoặc 100.001 phần tử thô, hoặc độ sâu 33, **When** nhập, **Then** từ chối ngay (`E_IMPORT_LIMIT`) trước khi dựng bất cứ gì; file đúng 5 MiB, đúng độ sâu 32, đúng 20.000 phần tử sau chuẩn hóa nhập được.
6. **Given** file có 27.029 phần tử (`factory-isometric-stress.svg`), **When** nhập không Tối ưu, **Then** báo "27.029 phần tử vượt giới hạn 20.000" và gợi ý Tối ưu; **When** bật Tối ưu, **Then** số phần tử giảm xuống ≤ 20.000, ảnh khác bản gốc ≤ 1 % điểm ảnh, báo cáo ghi số nhóm đã gộp.
7. **Given** nhập xong, **When** xem báo cáo, **Then** mỗi mục loại có: loại (phần tử, thuộc tính, CSS, namespace, ảnh, font…), tên, số lượng, lý do bằng chữ tiếng Việt kèm mã (`R_SCRIPT`, `R_EVENT_ATTR`…), tối đa 3 vị trí ví dụ (đường dẫn phần tử); có thể lưu báo cáo thành file `.json` hoặc `.md` (Ctrl+S trong hộp thoại).
8. **Given** nhập xong, **When** mở cây phần tử, **Then** mọi phần tử gắn được có UID dạng `el_` + 10 ký tự; tên hiển thị lấy từ `inkscape:label`, `data-name` hoặc `id` có nghĩa (không phải `path1234`, `SVGID_1_`, `Layer_1`), ngược lại là "<loại> <số thứ tự>"; đổi tên phần tử (F2) ghi `data-mat-name`.
9. **Given** hai lần nhập cùng một file với bộ sinh UID cố định (seed), **When** so kết quả, **Then** giống từng byte (nhập tất định); với bộ sinh ngẫu nhiên, mọi UID khác nhau nhưng cấu trúc giống hệt.
10. **Given** hộp thoại Nhập SVG đang mở, **When** bấm Hủy hoặc Esc, **Then** project không đổi và không có file nào được tạo; **When** bấm Nhập rồi Ctrl+Z, **Then** item và các file của nó biến mất trong một bước hoàn tác.
11. **Given** bản đã nhập, **When** Lưu và Nạp xuống BL335, **Then** gói `.matscada` chứa file SVG đã làm sạch và file binding của item; trang runtime trên Chrome hiển thị đúng; So sánh ngay sau Đọc lên cho "giống".
12. **Given** file SVG trên đĩa của project bị sửa tay, thêm `<script>` hoặc `onload` (bỏ qua Studio), **When** nạp project vào runtime và mở màn hình trên Chrome, **Then** trang vẫn không chạy mã: bộ lọc allowlist của trang loại phần đó khi dựng (lớp phòng thủ thứ hai), và Studio báo `E_SVG_UNSAFE` khi mở project (Nạp xuống bị khóa cho tới khi nhập lại hoặc làm sạch).
13. **Given** file không phải UTF-8, XML hỏng, gốc không phải `<svg>`, hoặc gốc sai namespace, **When** nhập, **Then** hộp thoại báo đúng một lỗi (`E_IMPORT_ENCODING`, `E_IMPORT_PARSE`, `E_IMPORT_ROOT`) và hướng dẫn xuất lại.
14. **Given** người dùng dùng bàn phím, **When** mở hộp thoại bằng Ctrl+Shift+I, chọn file, Tab qua bảng báo cáo, Enter để nhập, **Then** làm được mọi bước không cần chuột (SC-015).

---

### User Story 2 - Gắn Tag cho phần tử SVG bằng inspector (Priority: P1)

Kỹ sư bấm đúp vào đồ họa bồn trên canvas để "vào" item SVG; con trỏ chọn từng phần tử (nhóm "Bồn", hình "Nước", chữ "72.5"). Họ chọn hình "Nước"; inspector, nhóm **Gắn Tag**, hiện danh sách động hóa như cột Dynamization của WinCC: Mức chất lỏng, Màu nền, Màu viền, Quay, Di chuyển X/Y, Co giãn, Nhấp nháy, Dòng chảy, Ẩn/hiện, Độ mờ. Họ kéo Tag `TANK01.LEVEL` thả vào dòng "Mức chất lỏng": Studio chọn cách làm theo hình (`rect` đổi chiều cao, hình bất kỳ cắt bằng `clipPath`), đặt hướng "Từ dưới lên", khoảng 0–100 theo giới hạn Tag; trên canvas mức nước đổi ngay khi họ kéo thanh **Thử giá trị**. Họ chọn chữ "72.5", gắn `TANK01.LEVEL` vào "Chữ hiển thị giá trị", định dạng 1 số lẻ, hậu tố "%" (hoặc lấy đơn vị của Tag). Họ chọn cánh quạt motor, gắn `PUMP01.RUN` vào "Quay liên tục"; chọn đèn, gắn `PUMP01.STATE` vào "Màu nền" theo bảng giá trị `TrangThaiBom`; chọn ống, gắn `PUMP01.RUN` vào "Dòng chảy". Không dòng JSON nào được viết tay. Họ bấm Xem trước, chọn Mô phỏng: sơ đồ chạy sống; Nạp xuống BL335 và mở Chrome: giống xem trước.

**Why this priority**: là phần giá trị chính của 3b ("gắn Tag bằng inspector, animation") và là nghiệm thu "dựng hoàn toàn trong Studio".

**Independent Test**: lớp Tauri giả và Chrome headless: kịch bản e2e dựng binding cho từng loại animation trên fixture, kiểm DOM của `<mat-screen>` sau khi đặt giá trị mô phỏng; Vitest cho `DomApplier` (jsdom, đồng hồ giả), bộ ca chuyển đổi và ca hình học; vector chung cho validator.

**Acceptance Scenarios**:

1. **Given** item SVG đã nhập, **When** bấm đúp vào đồ họa trên canvas, **Then** vào chế độ chọn phần tử: con trỏ chọn phần tử gắn được nhỏ nhất dưới con trỏ, khung chọn bám phần tử (kể cả khi zoom, pan), Alt+nhấp chọn xuyên qua nhóm, Esc hoặc nhấp ra ngoài item thoát chế độ; trong cây Details cũng chọn được phần tử; chọn ở cây thì canvas tô khung phần tử.
2. **Given** phần tử đang chọn, **When** mở nhóm Gắn Tag, **Then** thấy đủ 13 dòng animation (FR-032…FR-039), dòng không hợp loại phần tử bị mờ kèm lý do (ví dụ "Chữ hiển thị giá trị: chỉ cho phần tử chữ"); dòng đã gắn hiện Tag, kiểu biến đổi và giá trị hiện tại khi Online hoặc Mô phỏng.
3. **Given** dòng "Chữ hiển thị giá trị", **When** kéo Tag số vào và đặt định dạng (số lẻ 0–6, tiền tố, hậu tố, "dùng đơn vị của Tag"), **Then** chữ trên canvas đổi theo giá trị mô phỏng; chọn "Bảng giá trị" thì chữ là chữ của bảng cho giá trị đó ("Đang chạy"); chất lượng xấu hiện "--" hoặc chữ thay thế đã đặt.
4. **Given** dòng "Màu nền" hoặc "Màu viền", **When** chọn cách biến đổi **Bảng giá trị**, **Khoảng** hoặc **Rời rạc** (BOOL), **Then**:
   - bảng giá trị: chọn bảng có sẵn (mặc định bảng của Tag), màu lấy theo bảng;
   - khoảng: thêm các khoảng (từ, đến, màu) như `0–20: đỏ`, `20–80: xanh`, `≥ 80: đỏ`; Studio báo lỗi tại ô nếu khoảng chồng nhau hoặc `từ` > `đến`;
   - rời rạc: hai ô (`true`, `false`) hai màu; màu mặc định cho giá trị còn lại.
5. **Given** dòng "Mức chất lỏng" trên `rect`, **When** gắn Tag, **Then** Studio dùng cách đổi chiều cao `rect` (như 0.2, `geometry.levelPercent`); trên hình bất kỳ (`path`, `polygon`, nhóm), Studio dùng `clipPath` do runtime tạo (`geometry.clipLevel`) theo hộp bao của phần tử, bốn hướng, mức 0 % ẩn hết, 100 % hiện hết, và hình không bị méo; phần tử có thuộc tính `transform` vẫn đúng.
6. **Given** dòng "Quay" (theo giá trị, độ) và "Quay liên tục" (theo vòng/phút hoặc BOOL, chiều kim đồng hồ hoặc ngược), **When** đặt **tâm quay** (mặc định giữa phần tử; chọn 9 điểm trên hộp bao hoặc nhập tay), **Then** kim đồng hồ quay quanh gốc kim, cánh bơm quay quanh tâm; phần tử có sẵn `transform` không bị mất phép biến đổi cũ.
7. **Given** dòng "Di chuyển X", "Di chuyển Y" và "Co giãn" (đều, theo X hoặc theo Y), **When** gắn Tag với khoảng vào `[inMin, inMax]` và ra `[outMin, outMax]` (đơn vị của đồ họa; hệ số co giãn), **Then** phần tử di chuyển theo hệ tọa độ của nhóm cha, co giãn quanh tâm đã chọn; ra ngoài khoảng bị kẹp.
8. **Given** dòng "Nhấp nháy" (Tag BOOL hoặc số khác 0 là bật), **When** đặt chu kỳ 400–5.000 ms và kiểu (độ mờ, màu nền, màu viền), **Then** phần tử nhấp nháy khi bật, dừng khi tắt; chu kỳ dưới 400 ms bị từ chối (không quá 3 lần/giây); khi hệ điều hành bật "giảm chuyển động" thì không chuyển động mà phần tử hiện đậm ở trạng thái bật (và Studio nhắc rằng nhấp nháy không được là tín hiệu duy nhất).
9. **Given** dòng "Dòng chảy" trên hình có nét (đường, đường gấp khúc, `path`), **When** gắn Tag BOOL hoặc số, đặt chiều (thuận, ngược), tốc độ (đơn vị đồ họa/giây, tối đa 300) và nét đứt (mẫu `12 8`), **Then** dòng chảy chạy dọc ống khi bật, đứng yên khi tắt, đổi chiều theo dấu của giá trị (nếu chọn "theo dấu"), tốc độ đổi theo giá trị mà không khởi động lại hoạt ảnh.
10. **Given** dòng "Ẩn/hiện" và "Độ mờ", **When** gắn Tag BOOL (đảo được) hoặc số, **Then** phần tử ẩn hiện hoặc đổi độ mờ; phần tử đang ẩn không nhận nhấp chuột.
11. **Given** một phần tử có nhiều binding (quay + di chuyển + màu), **When** chạy, **Then** các phép biến đổi hợp theo thứ tự cố định: di chuyển (theo hệ tọa độ nhóm cha), rồi `transform` gốc của phần tử, rồi quay và co giãn quanh tâm đã chọn; hai binding cùng đích trên một phần tử là lỗi `E_DUP_BINDING`.
12. **Given** kéo Tag không hợp (Tag chuỗi vào "Quay"; Tag chỉ đọc vào hành động ghi), **When** thả, **Then** Studio từ chối ngay kèm lý do và không đổi gì; Tag `BOOL` vào dòng số được đề nghị biến đổi rời rạc.
13. **Given** thanh **Thử giá trị** ở đầu nhóm Gắn Tag, **When** kéo trượt hoặc bật tắt, **Then** Studio đặt giá trị mô phỏng cho Tag của dòng đang chọn và canvas đổi ngay (≤ 100 ms); nút Đặt lại trả về giá trị mô phỏng cũ; không ghi vào project và không tới thiết bị.
14. **Given** phần tử chữ hoặc `rect` hoặc nhóm vừa chọn và một Tag vừa kéo vào, **When** bấm **Gợi ý**, **Then** Studio đề nghị binding theo loại phần tử và kiểu Tag (chữ + số: "Chữ hiển thị giá trị"; `rect` + số: "Mức chất lỏng"; hình + BOOL: "Màu nền theo bảng/rời rạc"; nhóm + BOOL: "Quay liên tục"); người dùng chấp nhận hoặc bỏ.
15. **Given** nhiều phần tử cùng loại đang chọn (Shift+nhấp), **When** áp một binding, **Then** áp cho cả nhóm trong một bước hoàn tác; Ctrl+C và Ctrl+V trong inspector chép cả bộ binding sang phần tử khác (Tag giữ nguyên).
16. **Given** mỗi thao tác (thêm, sửa, xóa binding), **When** Ctrl+Z rồi Ctrl+Y, **Then** đúng một bước; hoàn tác tới 100 bước.
17. **Given** binding đang có lỗi (Tag không có, sai kiểu, khoảng chồng, chu kỳ ngoài khoảng), **When** kiểm tra, **Then** lỗi hiện ở đúng dòng và ở tab Thông tin; nhấp đúp lỗi chọn phần tử và dòng; lưu vẫn được, Nạp xuống bị khóa cho tới khi hết lỗi.
18. **Given** đổi tên Tag `TANK01.LEVEL` (006), **When** xác nhận, **Then** mọi binding và sự kiện SVG tham chiếu được cập nhật trong cùng một bước hoàn tác; "Dùng ở đâu" của Tag liệt kê cả phần tử SVG (màn hình, item, phần tử, thuộc tính).
19. **Given** Studio chế độ Xem trước (Mô phỏng hoặc Thiết bị) và Chrome với cùng project, **When** đặt cùng giá trị Tag, **Then** DOM và kiểu của phần tử giống nhau (cùng `DomApplier`, SC-006).
20. **Given** chất lượng Tag xấu (BAD) hoặc STALE, **When** áp binding, **Then** theo `onBadQuality` của binding, mặc định: màu xám trung tính, chữ "--", độ mờ 0,5; quay liên tục dừng; nhấp nháy tắt; dòng chảy dừng; di chuyển, co giãn, mức giữ nguyên.

---

### User Story 3 - Sự kiện: nhấp phần tử SVG để chuyển màn hình, mở popup, ghi Tag (Priority: P1)

Kỹ sư chọn hình bơm trên sơ đồ, mở nhóm **Sự kiện**, chọn "Nhấp chuột › Mở popup › Bơm 1". Họ chọn nút "Khởi động" trong đồ họa, chọn "Nhấp chuột › Xung Tag `PUMP01.RUN_CMD` 500 ms", đặt xác nhận (mặc định luôn xác nhận) và quyền tối thiểu operator. Trên Chrome, người vận hành thấy con trỏ bàn tay trên các phần tử nhấp được; Tab chuyển focus qua chúng (có viền focus); nhấp bơm mở popup; nhấp "Khởi động" mà chưa đăng nhập thì phần tử mờ và chú thích "Đăng nhập để điều khiển"; đã đăng nhập operator thì hộp xác nhận hiện đúng như nút của widget (Tag, giá trị hiện tại, giá trị mới, tài khoản), rồi `ACCEPTED` → `CONFIRMED`. Audit ghi kênh `web`, màn hình và phần tử.

**Why this priority**: roadmap §4.4 yêu cầu sự kiện, và đây là chỗ SVG chạm vào đường ghi Tag (Constitution V): phải dùng đúng chuỗi kiểm đã có, không tạo đường mới.

**Independent Test**: runtime x64 + giả lập Modbus (006); Chrome headless nhấp vào phần tử trong Shadow DOM; client Node tấn công; Vitest cho adapter `ControlController`; so audit với nhật ký giả lập.

**Acceptance Scenarios**:

1. **Given** phần tử có `events.click` hành động `navigate`, **When** nhấp hoặc Enter, **Then** chuyển màn hình (URL `#/<id>`); có `popup` thì mở popup; `closePopup` thì đóng; các hành động này chạy cả khi chưa đăng nhập.
2. **Given** hành động `write`, `toggle`, `pulse`, **When** chưa đăng nhập, viewer, mở bằng HTTP, HTTPS không chạy, mất live, Tag BAD/STALE/chưa có giá trị, Tag chỉ đọc hoặc lạ, **Then** phần tử khóa đúng các lý do của 007 (SC-009 của 007) và hiện lý do khi di chuột, khi focus và khi nhấp (vùng thông báo `role="status"`); không có gì gửi đi.
3. **Given** operator đăng nhập, **When** nhấp phần tử có hành động `write`/`toggle`/`pulse` với `confirm` = `always`, **Then** hộp xác nhận dùng chung với widget hiện đúng Tag, giá trị hiện tại, giá trị mới, tài khoản; Hủy có focus mặc định; Xác nhận thì phần tử hiện "Đang gửi…" (khóa nhấp thêm) rồi kết quả (`ACCEPTED`, `CONFIRMED`, `REJECTED`, `TIMEOUT`, `FAILED`) như 007.
4. **Given** hành động `toggle` trên Tag BOOL, **When** xác nhận, **Then** gửi `expect` như 007 (hai operator cùng đảo: lệnh đến sau bị `REJECTED` `STALE_EXPECTATION`); `pulse` thì BL335 giữ nhịp (`pulseMs`), không phải trình duyệt.
5. **Given** mọi lệnh ghi từ phần tử SVG, **When** kiểm audit, **Then** bản ghi có `channel` = `web`, `context.screen` = id màn hình, `context.widget` = `elementUid` của phần tử; viewer hoặc thiếu CSRF/Origin bị từ chối như 007 (30 ca tấn công của 007 vẫn đạt, SC-005 của 007).
6. **Given** phần tử có sự kiện, **When** dùng bàn phím, **Then** Tab vào được theo thứ tự DOM, Enter hoặc Space kích hoạt như nhấp, viền focus nhìn thấy, trình đọc màn hình đọc nhãn (tên phần tử, hoặc nhãn đặt trong Studio) và vai trò "nút".
7. **Given** phần tử không có fill (`fill="none"`) hoặc chỉ có nét mảnh, **When** nhấp vào vùng hình, **Then** vẫn nhận nhấp (vùng nhận nhấp là toàn bộ vùng vẽ của hình); phần tử đang ẩn (`visibility: hidden` do binding) không nhận nhấp.
8. **Given** Studio, **When** vào nhóm Sự kiện, **Then** chọn hành động trong 6 hành động có sẵn, chọn màn hình đích (chỉ `screen` cho `navigate`, chỉ `popup` cho `popup`), Tag (chỉ Tag RW, không phải `calculated`, `simulation` không nhập tay) kèm giá trị, `durationMs` cho xung (100–10.000), xác nhận (`always`/`none`), quyền tối thiểu (`operator`, `engineer`, `administrator`), nhãn đọc cho trình đọc màn hình (≤ 80 ký tự).
9. **Given** hành động ghi với `confirm` = `none` và Tag không phải BOOL, hoặc `minRole` = `viewer`, **When** kiểm tra, **Then** lỗi (`E_EVENT_CONFIRM`, `E_EVENT_MINROLE`); `confirm` = `none` với BOOL thì cảnh báo `W_EVENT_CONFIRM_NONE`; xung trên Tag bật đọc lại thì `W_EVENT_PULSE_READBACK` (như 007).
10. **Given** Studio ở chế độ Xem trước Mô phỏng hoặc Thiết bị, **When** nhấp phần tử có sự kiện, **Then** chạy như trên Chrome (hộp xác nhận, ghi vào mô phỏng hoặc qua API của Studio kênh `studio`); chế độ chỉnh sửa thì nhấp là chọn, không kích hoạt sự kiện.
11. **Given** phần tử được gắn đồng thời binding "Ẩn/hiện" và sự kiện, **When** phần tử ẩn, **Then** không nhấp, không focus được, không có trong thứ tự Tab.
12. **Given** project có sự kiện trên phần tử mà `elementUid` không còn trong SVG (sau nhập lại), **When** kiểm tra, **Then** `E_REF_UID` như binding (mồ côi chặn Nạp xuống).
13. **Given** `events.click` hành động `navigate` tới màn hình bị xóa, **When** kiểm tra, **Then** `E_EVENT_TARGET`; Studio liệt kê các chỗ trỏ tới màn hình khi xóa (gồm sự kiện SVG).

---

### User Story 4 - Thư viện ký hiệu và dựng lại màn hình bồn nước + motor trong Studio (Priority: P2)

Kỹ sư mở Toolbox, nhóm **Ký hiệu SVG**: Bồn, Bơm, Van, Motor, Ống. Họ kéo "Bồn đứng", "Bơm ly tâm", "Van cổng", "Motor AC" và vài đoạn ống vào canvas; ống tự bắt dính vào điểm gắn của bồn, bơm, van (chấm xanh hiện khi đến gần). Khi chọn một ký hiệu, inspector hiện **Gắn nhanh** theo bộ phận ("Nước trong bồn: mức", "Cánh bơm: quay liên tục", "Đèn motor: màu theo trạng thái", "Ống: dòng chảy"). Trong khoảng thời gian ngắn họ dựng lại hoàn toàn màn hình bồn nước + motor của `tank-demo` (Sprint 1) mà không viết dòng JSON nào, xem trước bằng Mô phỏng, Nạp xuống và mở trên Chrome.

**Why this priority**: thư viện làm cho người không có công cụ vẽ vẫn dựng được sơ đồ; và "dựng lại màn hình bồn nước + motor hoàn toàn trong Studio" là điều kiện nghiệm thu của lộ trình.

**Independent Test**: Vitest cho thư viện (mỗi ký hiệu qua allowlist không bị loại gì; bộ phận và điểm gắn đúng manifest); e2e Studio kịch bản "dựng lại tank-demo" từ project rỗng; so DOM và giá trị binding với `tank-demo` chạy trên runtime x64.

**Acceptance Scenarios**:

1. **Given** thư viện, **When** mở Toolbox, **Then** có ≥ 12 ký hiệu thuộc 5 nhóm (bồn, bơm, van, motor, ống) (FR-055); mỗi ký hiệu có tên, hình xem trước và nguồn gốc (do dự án vẽ, giấy phép CC0).
2. **Given** ký hiệu kéo thả vào canvas, **When** thả, **Then** tạo một item `svg` mới (file SVG của ký hiệu sao vào `graphics/symbols/<id>.svg`, file binding riêng của item), cỡ mặc định của ký hiệu, dính lưới, được chọn; nhiều thể hiện của cùng ký hiệu dùng chung một file SVG và mỗi thể hiện có binding riêng; Ctrl+Z bỏ trong một bước.
3. **Given** ký hiệu có điểm gắn, **When** kéo một ký hiệu lại gần điểm gắn tương thích của ký hiệu khác (≤ 10 điểm ảnh màn hình), **Then** hiện chấm gắn và hai điểm dính vào nhau; giữ Alt khi kéo thì tắt dính; ống có hai điểm gắn nên nối tiếp được thành đường ống.
4. **Given** ký hiệu đang chọn, **When** bấm **Gắn nhanh** ở một bộ phận, **Then** Studio mở đúng dòng binding gợi ý trên phần tử của bộ phận (ví dụ cánh bơm: Quay liên tục) và chờ kéo Tag vào.
5. **Given** project rỗng với Tag của `tank-demo`, **When** dựng lại màn hình bồn nước + motor chỉ bằng ký hiệu, nhập SVG, inspector (không sửa JSON), **Then** màn hình có: bồn có mức chất lỏng (cutaway) và chữ giá trị mức, motor có cánh quay liên tục theo Tag chạy và đèn trạng thái đổi màu theo bảng giá trị, ống có dòng chảy khi bơm chạy, một nút nhấp được để bật bơm (có xác nhận); `validate` không lỗi.
6. **Given** màn hình dựng lại, **When** Nạp xuống runtime x64 rồi mở trên Chrome, **Then** các phần tử đổi theo Tag mô phỏng đúng như `tank-demo` gốc (cùng đích binding: chữ, màu, mức, quay) và có thêm dòng chảy và sự kiện (SC-004).
7. **Given** mỗi ký hiệu của thư viện, **When** chạy bộ kiểm tra, **Then** không có phần tử hay thuộc tính nào bị allowlist loại; mọi bộ phận có UID cố định dạng `el_<ký hiệu>_<bộ phận>`; mọi điểm gắn nằm trong hộp bao của ký hiệu.
8. **Given** màn hình dựng bằng ký hiệu có 40 item `svg`, **When** mở trên Chrome, **Then** hiện giá trị sống trong ≤ 2 s (SC-005); ≤ 64 item `svg` mỗi màn hình (65 là lỗi `E_LIMIT`).
9. **Given** thư viện, **When** kiểm giấy phép, **Then** mọi ký hiệu do dự án vẽ, không có logo hay hình của hãng, ghi trong `LICENSES.md` của gói thư viện.

---

### User Story 5 - Nhập lại SVG đã chỉnh sửa mà giữ UID và binding (Priority: P2)

Nhà thiết kế sửa lại sơ đồ trong Inkscape (dời bồn, thêm van, nhóm lại, đổi tên layer) rồi gửi lại file. Kỹ sư bấm **Nhập lại SVG…** trên item đó. Studio nhập file mới (qua cùng đường làm sạch), rồi **đối chiếu** với bản đang dùng: phần tử nào khớp thì giữ UID (binding và sự kiện đi theo), phần tử mới nhận UID mới, phần tử khớp mơ hồ thì vào danh sách để chọn tay, phần tử cũ không còn thì thành "mồ côi". Hộp thoại **Đối chiếu lại** hiện: "46 giữ nguyên, 3 mới, 2 cần chọn, 1 mồ côi có binding". Với từng dòng cần chọn, kỹ sư thấy hình hai phần tử cạnh nhau và 3 ứng viên. Họ xử lý hết rồi bấm Áp dụng; hoặc để mồ côi lại và Studio chặn Nạp xuống.

**Why this priority**: ADR-003 coi đây là rủi ro lớn nhất của UID ("khớp sai gán binding vào nhầm phần tử: hiển thị sai trạng thái thiết bị"); không có nhập lại thì thiết kế lại bằng công cụ ngoài làm mất công gắn Tag.

**Independent Test**: bộ cặp `tests/fixtures/svg-import/reimport/*` (bản 1 và bản 2 qua Inkscape, LibreOffice mất id, dời phần tử, nhóm lại, đổi tên) với bảng đáp án đúng cho từng phần tử; Vitest đo tỉ lệ khớp đúng, khớp sai, mơ hồ.

**Acceptance Scenarios**:

1. **Given** bản 2 của file đã nhập, giữ nguyên `data-mat-uid` (Inkscape giữ thuộc tính `data-*` khi lưu), **When** nhập lại, **Then** các phần tử có UID thuộc bản trước và cùng loại thẻ được giữ UID (bước 1); UID không thuộc bản trước bị coi là không tin cậy và bỏ (ADR-003 mục 4).
2. **Given** bản 2 mất `data-mat-uid` nhưng giữ `id` (Inkscape "Save as Plain SVG"), **When** nhập lại, **Then** khớp theo `id` cộng thẻ (bước 2); `id` trùng lặp ở một phía không dùng được cho khớp.
3. **Given** bản 2 mất cả `id` và `data-*` (xuất lại qua LibreOffice), **When** nhập lại, **Then** khớp theo đường dẫn cấu trúc (bước 3) hoặc hình học (bước 4); phần tử nào có nhiều ứng viên ngang nhau không được gán tự động.
4. **Given** bộ cặp chuẩn (≥ 6 cặp, ≥ 150 phần tử có đáp án), **When** nhập lại, **Then** 0 phần tử bị gán tự động sai UID (SC-009), ≥ 90 % phần tử có binding được khớp tự động đúng, phần còn lại vào danh sách chọn hoặc mồ côi (không mất im lặng).
5. **Given** hộp thoại Đối chiếu lại, **When** chọn ứng viên cho một dòng, đánh dấu "Bỏ binding", hoặc "Giữ mồ côi", **Then** kết quả áp đúng khi bấm Áp dụng trong một bước hoàn tác; Hủy thì không đổi gì (file cũ giữ nguyên).
6. **Given** mồ côi có binding hoặc sự kiện còn lại, **When** kiểm tra, **Then** `E_REF_UID` ở từng chỗ, Nạp xuống bị khóa, nhấp đúp lỗi mở hộp thoại Đối chiếu lại.
7. **Given** nhập lại xong, **When** Lưu, Đọc lên, So sánh, Hoàn tác, **Then** UID giữ nguyên qua mọi bước; binding và sự kiện của phần tử khớp hiển thị đúng trên canvas và trên Chrome.
8. **Given** bản 2 lớn hơn giới hạn, quá nhiều phần tử mới, hoặc có phần độc hại, **When** nhập lại, **Then** như nhập mới: từ chối hoặc làm sạch kèm báo cáo, item cũ không đổi.
9. **Given** hai item `svg` cùng dùng một file SVG (thể hiện ký hiệu), **When** nhập lại ở một item, **Then** Studio hỏi áp cho mọi thể hiện hay tách file; mặc định tách (không đổi các thể hiện khác).

---

### User Story 6 - Hiển thị, hiệu năng và an toàn khi vận hành (Priority: P3)

Trước khi giao cho khách, kỹ sư chạy bài thử: mở màn hình có đồ họa nhập từ file thật ở 10 máy cùng F5, xem animation chạy lâu, mở project 0.3 (Studio nâng cấp lên 0.4), kiểm project cũ 0.1 và 0.2, sửa tay SVG trên đĩa cài mã độc, thử trên BL335.

**Why this priority**: là phần đo độ vững và ngân sách (Constitution III, IV) và kiểm tương thích; cần các story trước đã chạy.

**Independent Test**: `tools/web-it.ps1` (đã có từ 007, thêm kịch bản `svg`), `tools/measure`, kịch bản `compat`; trên BL335 cần SSH (⚠️🔌).

**Acceptance Scenarios**:

1. **Given** project 0.3 (như `dashboard-demo`), **When** mở trong Studio 0.6.0, **Then** đề nghị nâng cấp lên 0.4.0 (nâng cấp trong bộ nhớ, sao lưu trước lần lưu đầu, cùng đầu vào cùng kết quả, mở chỉ đọc nếu từ chối); project 0.1 và 0.2 đi qua cả chuỗi 0.2 → 0.3 → 0.4 trong một lần; project 0.4 cần runtime ≥ 0.7.0.
2. **Given** runtime 0.7.0, **When** nạp project 0.1, 0.2, 0.3 và 0.4, **Then** cả bốn chạy; với 0.1–0.3 trang cho cùng phần tử đích, cùng giá trị binding và cùng hiển thị (ảnh chụp khác ≤ 0,5 %) như runtime 0.6 (SC-011); ngoại lệ có chủ ý: phần tử có thuộc tính `transform` gốc và binding quay của 0.2 nay **giữ** `transform` gốc (sửa lỗi im lặng của 0.2, ADR-024).
3. **Given** màn hình chuẩn 3b (một đồ họa nhập ≈ 3.000 phần tử, 30 binding, 10 hoạt ảnh, 5 sự kiện), **When** mở trang trên Chrome từ BL335 với bộ nhớ đệm trống, **Then** có giá trị sống đầu tiên ≤ 2 s (SC-005); 10 client cùng F5 xong ≤ 5 s.
4. **Given** BL335 chạy màn hình chuẩn 3b với 10 client và 500 Tag mô phỏng/1 s trong 30 phút, **When** đo, **Then** RSS ≤ 150 MB, CPU ≤ 30 %, 0 mất sequence (SC-007).
5. **Given** màn hình có 100 phần tử hoạt ảnh (quay, nhấp nháy, dòng chảy) chạy 30 phút trên Chrome (máy dev), **When** đo, **Then** p95 thời gian mỗi khung ≤ 8 ms trên luồng chính (SC-008); tab ẩn thì hoạt ảnh tạm dừng và không tiêu CPU đáng kể.
6. **Given** màn hình có hơn 64 hoạt ảnh vô hạn cùng lúc, **When** kiểm tra, **Then** cảnh báo `W_ANIM_MANY`; hơn 256 là lỗi `E_LIMIT`.
7. **Given** file SVG trên đĩa của project có `<script>`, **When** mở trên Chrome, **Then** không chạy mã, nhận `E_SVG_UNSAFE` ở Studio (kịch bản 12 của US1); runtime C++ không parse SVG (Constitution II), lớp phòng thủ là allowlist của trang và CSP của `/project/` (đã có).
8. **Given** SVG của item từ 1 MiB trở lên, **When** kiểm tra, **Then** cảnh báo `W_SVG_HEAVY` kèm ước tính thời gian tải khi 10 client cùng F5 qua LAN 100 Mbps; từ 5 MiB là lỗi.
9. **Given** BL335 chạy runtime 0.5 hoặc 0.6 và project 0.4, **When** Nạp xuống, **Then** dòng "Tương thích runtime" khóa nạp (cần ≥ 0.7.0).
10. **Given** mọi kiểm tra tự động của 004–007, **When** chạy lại, **Then** vẫn đạt (SC-016).

---

### Edge Cases

**Nhập SVG**

- File có BOM UTF-8: bỏ BOM rồi xử lý; UTF-16 hoặc mã hóa khác khai báo trong `<?xml encoding?>`: từ chối `E_IMPORT_ENCODING`, hướng dẫn xuất UTF-8.
- DOCTYPE có ENTITY là tên namespace Adobe đã biết (`ns_svg`, `ns_extend`, `ns_ai`, `ns_graphs`, `ns_vars`, `ns_imrep`, `ns_sfw`, `ns_custom`, `ns_adobe_xpath`, `ns_flows`, `ns_xlink`): thay bằng URI rồi bỏ DTD; ENTITY khác (kể cả `SYSTEM`, `PUBLIC`, tham số): từ chối `E_IMPORT_DTD`.
- Hướng dẫn xử lý (`<?xml-stylesheet?>` và mọi PI trừ khai báo XML): bỏ, ghi báo cáo.
- Namespace lạ (`inkscape`, `sodipodi`, `rdf`, `cc`, `dc`, Adobe `i:`, Corel `xodm`, LibreOffice `ooo`…): bỏ phần tử và thuộc tính; trước khi bỏ lấy nhãn (`inkscape:label`, `data-name`) làm tên hiển thị.
- Phần tử SVG hợp lệ nhưng ngoài allowlist (`a`, `view`, `cursor`, `font`, `glyph`, `font-face`, `animate*`, `set`, `script`, `style` sau chuyển, `foreignObject`, `switch` sau mở): bỏ, `a` thì giữ con (bỏ liên kết); `switch` thì chỉ giữ nhánh đầu không phải `foreignObject`.
- CSS: chọn lọc chỉ hỗ trợ bộ chọn thẻ, `.lớp`, `#id`, ghép (`g.cls-1`) và danh sách phân cách dấu phẩy; bộ chọn khác (`>`, `+`, khoảng trắng hậu duệ, `:hover`, thuộc tính `[x]`), `@media`, `@font-face`, `@import`, `@keyframes` bị bỏ và ghi `W_IMPORT_CSS_PARTIAL` nếu nó ảnh hưởng phần tử; thuộc tính CSS ngoài allowlist bị bỏ; `!important` được tôn trọng; `style` nội tuyến thắng khối `<style>` như trình duyệt.
- `id` trùng nhau trong một file: giữ phần tử đầu, đổi `id` các phần tử sau thành `id-2`, `id-3`… và cập nhật tham chiếu trỏ tới chúng khi xác định được (một tham chiếu mơ hồ thì trỏ tới phần tử đầu, ghi báo cáo).
- Tham chiếu `url(#x)` hoặc `href="#x"` tới `id` không có: bỏ thuộc tính, ghi báo cáo (Chrome cũng bỏ qua).
- `use` đệ quy (vòng) hoặc nở theo cấp số nhân: tính số phần tử hiệu dụng (đã mở `use`) > 100.000 hoặc vòng thì từ chối `E_IMPORT_USE_BOMB`.
- `filter`: giữ tối đa 8 bộ lọc, 64 hình nguyên thủy; `feGaussianBlur` `stdDeviation` kẹp ≤ 30; `feTurbulence`, `feDisplacementMap`, `feConvolveMatrix`, `feMorphology`, `feImage` bị loại (tốn CPU hoặc kéo tài nguyên).
- `image`: chỉ `data:image/png|jpeg|gif|webp;base64,` có chữ ký tệp đúng (magic bytes), tổng ≤ 2 MiB giải mã, ≤ 16 ảnh; ảnh liên kết hay `data:image/svg+xml`: bỏ ảnh và ghi báo cáo.
- `text`: nội dung chữ giữ nguyên dạng chữ (không bao giờ là HTML), ≤ 4.096 ký tự mỗi nút; `flowRoot` và `shape-inside` chuyển thành `text` một dòng không xuống dòng, ghi `W_IMPORT_FLOWTEXT_NOWRAP`.
- Font: tên PostScript (`MyriadPro-Regular`, `ArialMT`) đổi theo bảng ánh xạ, tên không ánh xạ được thì thêm họ dự phòng `sans-serif`; `<font>/<glyph>` bỏ; không nhúng font (không `@font-face`).
- Đơn vị `mm/cm/in/pt/pc` ở `width/height` của `<svg>`: quy về px (1 in = 96 px); không có `viewBox`: sinh từ `width/height`; không có cả hai: từ chối `E_IMPORT_SIZE`.
- Số phần tử vẽ được bằng 0: nhập được, cảnh báo "không có phần tử vẽ được".
- Phần tử rỗng (nhóm không con, `defs` không dùng, `title`/`desc` rỗng): bỏ khi chuẩn hóa (ghi tổng số).
- `title` và `desc`: giữ `title` của phần tử gắn được (≤ 200 ký tự) làm nhãn đọc màn hình; bỏ `desc` và `metadata`.
- Thuộc tính `data-*` khác ngoài `data-mat-uid`, `data-mat-name`: bỏ (ADR-003 mục 4, mở rộng thêm `data-mat-name` ở ADR-023).
- File SVG đã nhập có `data-mat-uid` của nguồn khác hoặc của project khác: coi là không tin cậy, bỏ khi nhập mới (D5), chỉ dùng làm gợi ý khi nhập lại.
- Ký tự điều khiển, chuỗi UTF-8 hỏng trong thuộc tính hoặc chữ: từ chối `E_IMPORT_ENCODING`.
- Tên file nhập có ký tự lạ: tên file trong project là `graphics/<slug>.svg` (chữ thường, số, dấu gạch ngang; trùng thì thêm `-2`); tên gốc chỉ hiện ở báo cáo.

**Gắn Tag và animation**

- Phần tử không nằm trong `elements` của item (SVG sửa ngoài): `W_UID_NOT_IN_SVG`/`E_REF_UID` như 0.2.
- `getBBox` không có hoặc bằng 0 (phần tử `display:none`, nhóm rỗng, hết kết nối layout): hoạt ảnh cần hộp bao hoãn tới lần áp kế tiếp khi hộp bao khác 0; không ném lỗi.
- Phần tử có `transform` gốc: mọi phép biến đổi hoạt ảnh hợp với nó, không thay thế (D11); đổi `transform` bằng CSS `style` không làm mất thuộc tính `transform` gốc.
- Tâm quay hoặc co giãn: mặc định giữa hộp bao; tọa độ tương đối `[0, 1]` trên hộp bao (đổi cỡ hình thì tâm theo); không có tọa độ tuyệt đối trong binding.
- `clipPath` sinh lúc chạy có `id` riêng của Shadow DOM của item (`mat-clip-<uid>`); không ghi vào file SVG.
- Hai binding `clipLevel` và `levelPercent` trên cùng phần tử: lỗi `E_DUP_BINDING` (cùng nhóm đích "mức").
- Tag đổi kiểu (BOOL → số) sau khi đã gắn: `E_TYPE_MISMATCH` ở dòng đó, không tự sửa.
- Khoảng giá trị: `[từ, đến)` nửa mở; `từ` vắng là −∞; `đến` vắng là +∞; khoảng chồng nhau hoặc `từ` ≥ `đến` là lỗi; giá trị không rơi vào khoảng nào dùng `default`; không có `default` thì bỏ qua (xem `onBadQuality`).
- Màu theo bảng giá trị có `color` rỗng: phần tử giữ màu gốc (như 0.2).
- Nhấp nháy trên nhiều phần tử cùng lúc: dùng chung một nhịp (cùng pha) để không "lệch" nhau; tối đa 3 lần/giây.
- Dòng chảy trên phần tử không có nét (`stroke: none`): Studio cảnh báo "phần tử không có nét"; chạy vẫn không lỗi (không thấy gì).
- Tab trình duyệt ẩn: hoạt ảnh tạm dừng, về lại thì tiếp tục (như quay liên tục của 0.2); nhấp nháy tính theo đồng hồ trang.
- Hoạt ảnh vô hạn: hơn 64 là cảnh báo, hơn 256 là lỗi (mỗi màn hình, tính cả popup đang mở).
- Số Tag phía SVG vẫn tính vào giới hạn 1.000 Tag mỗi màn hình của 007.
- `prefers-reduced-motion: reduce`: quay liên tục dừng ở góc hiện tại, dòng chảy đứng yên, nhấp nháy không chuyển động và phần tử hiện ở trạng thái "bật" rõ (đậm hơn); thông tin trạng thái vẫn có qua màu, chữ.

**Sự kiện**

- Nhiều phần tử lồng nhau đều có sự kiện: phần tử sâu nhất dưới con trỏ nhận nhấp, không nổi bọt lên nhóm cha.
- Nhấp kéo (mousedown trên một phần tử, mouseup trên phần tử khác): không là nhấp.
- Hộp xác nhận mở thì mọi điều khiển khác tạm khóa (như 007): gồm cả phần tử SVG.
- Hai phần tử SVG cùng ghi một Tag, hai operator cùng nhấp: như 007 (thứ tự BL335 nhận, hai bản ghi audit).
- Popup đang mở: sự kiện của đồ họa dưới popup không nhận nhấp (lớp phủ che).
- Phần tử bị gỡ (đổi màn hình) giữa lúc đang gửi: kết quả vẫn hiện ở thông báo trạng thái của trang; không gửi lại (như 007).
- Trình đọc màn hình: vai trò `button` đặt bằng mã trên phần tử (không lưu trong SVG); nhãn là `title` của phần tử, hoặc nhãn đặt trong Studio, hoặc tên phần tử.

**Thư viện ký hiệu**

- Ký hiệu có bộ phận bị xóa khỏi SVG của dự án (sửa tay): `W_UID_NOT_IN_SVG` như thường lệ; "Gắn nhanh" bỏ qua bộ phận không có.
- Ghép ống: hai điểm gắn không cùng hướng (ngang nối đứng) vẫn dính nhưng chỉ ghi cảnh báo trực quan (không lỗi).
- Một thể hiện ký hiệu bị đổi cỡ không đều: ký hiệu méo (như 007: `fit` = `stretch`); mặc định giữ tỉ lệ.

**Studio**

- Chọn phần tử trong item có 20.000 nút: cây phần tử dựng lười (mở nhánh khi cần); chọn bằng nhấp ≤ 50 ms.
- Xóa phần tử trong SVG không có trong Studio 3b (không có trình sửa SVG): muốn bỏ phần tử, sửa ngoài rồi Nhập lại (GĐ 6 mới có sửa trực tiếp).
- Project 0.3 chưa nâng cấp: mở chỉ đọc (như 006 D23, 007 D7); xem trước vẫn dùng được.
- Nhập SVG khi project đang chỉ đọc hoặc đang Online xem trước: nút khóa kèm lý do.
- Rust từ chối đọc file > 5 MiB + 64 B hoặc không phải `.svg` do hộp thoại chọn: `E_IMPORT_LIMIT` hoặc `E_IMPORT_EXT`.
- Hai người sửa một project: như 007 (không đồng sửa).
- Mất điện hay Studio đóng khi đang nhập: không có file nửa chừng (ghi file khi Lưu, nguyên tử như 004).

## Requirements *(mandatory)*

### Functional Requirements

**Định dạng project 0.4.0, nâng cấp, tương thích**

- **FR-001**: Định dạng project 0.4.0 MUST giữ cấu trúc 0.3.0 (màn hình `items`, `navigation`) và mở rộng file binding của item `svg` (FR-002, FR-003) và giới hạn (FR-004). Mọi file của một project MUST mang cùng `schemaVersion` `0.4.x` ([ADR-004](../../docs/adr/004-schema-versioning.md)); `minRuntimeVersion` MUST ≥ `0.7.0` (`E_MIN_RUNTIME`). Schema 0.3 đóng băng ở `schemas/0.3/`; `schemas/*.schema.json` thành 0.4.0.
- **FR-002**: File binding 0.4 MUST nhận thêm:
  - đích `transform.translateX`, `transform.translateY`, `transform.scale`, `geometry.clipLevel`, `effect.blink`, `effect.flow`;
  - phép biến đổi `rangeMap` (khoảng nội tuyến, đầu ra màu, chữ, số hoặc `visible/hidden`);
  - tham số mới: `pivot` (quay, co giãn), `axis` (co giãn), `reverse` (quay liên tục), `period`, `mode`, `minOpacity`, `color` (nhấp nháy), `dash`, `speed`, `byValueSign` (dòng chảy), `prefix`, `unitFromTag` (chữ).

  Ngữ nghĩa từng đích, miền giá trị, mã lỗi: [contracts/project-format-0.4.md](contracts/project-format-0.4.md), [contracts/binding-animation.md](contracts/binding-animation.md).
- **FR-003**: Mỗi phần tử trong file binding MAY có `events` với khóa `click`: một hành động trong 6 hành động của 007 (`write`, `toggle`, `pulse`, `navigate`, `popup`, `closePopup`) cộng, cho ba hành động ghi, `tag`, `confirm` (`always` mặc định, `none`), `minRole` (`operator` mặc định, `engineer`, `administrator`) và nhãn đọc `label` (≤ 80 ký tự).
- **FR-004**: Giới hạn: ≤ 64 item `svg` mỗi màn hình (007: 8); ≤ 250 item mỗi màn hình (giữ); ≤ 2.000 phần tử khai báo mỗi item; ≤ 16 binding mỗi phần tử (giữ); hơn 64 hoạt ảnh vô hạn mỗi màn hình là cảnh báo, hơn 256 là lỗi; file SVG của item ≤ 5 MiB, ≤ 20.000 phần tử, độ sâu ≤ 32.
- **FR-005**: Khi mở project 0.3 (từ đĩa hoặc vừa đọc lên), Studio MUST đề nghị nâng cấp lên 0.4.0, nói những gì đổi và nơi giữ bản sao lưu, cho chọn Nâng cấp, Mở chỉ đọc hoặc Hủy (như 007 FR-007). Project 0.1 và 0.2 MUST được nâng qua 0.3 rồi 0.4 trong một lần.
- **FR-006**: Nâng cấp 0.3 → 0.4 MUST chạy trong bộ nhớ, sao lưu file gốc trước lần lưu đầu, cho cùng kết quả với cùng đầu vào, và chỉ đổi `schemaVersion`, `minRuntimeVersion`; không đổi nội dung binding (mọi binding 0.3 hợp lệ ở 0.4 với cùng ngữ nghĩa).
- **FR-007**: Bộ kiểm tra hai bản (TS ở Studio, C++ ở runtime) MUST có luật 0.4 và cho cùng kết luận, cùng mã lỗi trên bộ vector chung cho 0.1, 0.2, 0.3 và 0.4. Luật phụ thuộc nội dung SVG (`E_SVG_UNSAFE`, `E_SVG_LIMIT`, `W_SVG_HEAVY`, `W_UID_NOT_IN_SVG`) chỉ có ở bản TS vì `core/` không parse SVG (Constitution II); danh sách mã nằm ở [contracts/project-format-0.4.md](contracts/project-format-0.4.md) §6.
- **FR-008**: Runtime 0.7.x MUST nhận project 0.1.x, 0.2.x, 0.3.x và 0.4.x; 0.1–0.3 chạy như trên runtime 0.6 (cùng DOM, cùng giá trị binding). Project có `schemaVersion` runtime không hiểu MUST bị từ chối cả gói kèm lý do.
- **FR-009**: Tập file của project 0.4 MUST gồm các file của 0.3 cộng file SVG của mọi item `svg` ở bất kỳ đường dẫn hợp lệ nào (mặc định `graphics/<tên>.svg`, `graphics/symbols/<id>.svg`) và file binding của mỗi item (`screens/<màn hình>.<item>.bindings.json`); gói `.matscada` giữ 1.0.0, trần 1 MiB mỗi file JSON và luật đường dẫn của 005; file SVG không bị giới hạn 1 MiB riêng mà theo FR-004 (5 MiB) và trần gói 50 MiB.
- **FR-010**: So sánh, Đọc lên và Xem trước Nạp xuống (005) MUST hiểu đối tượng mới: số binding và sự kiện SVG theo item và phần tử, file SVG theo digest; Xem trước Nạp xuống thêm dòng tương thích (project 0.4 cần runtime ≥ 0.7.0), tổng dung lượng SVG của project và cảnh báo `W_SVG_HEAVY`.

**Importer SVG và sanitizer allowlist**

- **FR-011**: Studio MUST có lệnh **Thêm › Đồ họa SVG…** (Ctrl+Shift+I) và **Nhập lại SVG…**; chọn file bằng hộp thoại hệ thống qua lệnh Rust `svg_open` (≤ 5 MiB + 64 B, đuôi `.svg`, trả byte thô như `csv_open`); hộp thoại **Nhập SVG** hiện xem trước trước/sau, nhận diện phần mềm xuất, báo cáo và tùy chọn Tối ưu; chỉ khi bấm Nhập mới thay đổi tài liệu (một bước hoàn tác); file ghi xuống đĩa khi Lưu (nguyên tử như 004).
- **FR-012**: Trước khi parse, importer MUST: kiểm byte ≤ 5 MiB; bỏ BOM UTF-8; từ chối mã hóa khác UTF-8; tìm DOCTYPE bằng bộ quét ký tự (không regex): chỉ ENTITY namespace Adobe đã biết được thay bằng URI rồi bỏ DTD, mọi khai báo ENTITY khác bị từ chối (`E_IMPORT_DTD`); bỏ mọi hướng dẫn xử lý (PI) ngoài khai báo XML.
- **FR-013**: Sanitizer MUST là **allowlist trên DOM đã parse**: duyệt cây bằng vòng lặp (không đệ quy), giữ phần tử chỉ khi thuộc namespace SVG và tên nằm trong danh sách phần tử cho phép ([contracts/svg-import.md](contracts/svg-import.md) §2); phần tử ngoài danh sách bị bỏ cùng con, trừ nhóm "mở vỏ" (`a`, `switch`). Không dùng regex để quyết định giữ hay bỏ bất kỳ nút, thuộc tính hay giá trị nào.
- **FR-014**: Mỗi thuộc tính MUST nằm trong allowlist theo phần tử và qua bộ kiểm giá trị theo kiểu (số, danh sách số, màu, `transform`, `points`, `d`, `url(#id)`, tham chiếu `#id`, `data:image/…`): thuộc tính `on*`, `href` ngoài `#id` và `data:image` hợp lệ, `style` có thuộc tính CSS ngoài allowlist hay `url()` không nội bộ, `data-*` ngoài `data-mat-uid` và `data-mat-name`, đều bị bỏ. `style` nội tuyến MUST được phân tích bằng bộ tách từ vựng và ghi lại ở dạng chuẩn chỉ gồm khai báo hợp lệ.
- **FR-015**: Giới hạn nhập MUST: ≤ 5 MiB; ≤ 20.000 phần tử **sau chuẩn hóa** (và sau Tối ưu nếu bật); độ sâu ≤ 32; ngưỡng thô 100.000 phần tử và số phần tử hiệu dụng sau mở `use` ≤ 100.000 để chặn bom; ≤ 8 `filter`, ≤ 64 hình nguyên thủy lọc; ≤ 16 ảnh nhúng, ≤ 2 MiB sau giải mã. Vượt mức: từ chối cả file với mã `E_IMPORT_LIMIT` hoặc `E_IMPORT_USE_BOMB` trước khi dựng.
- **FR-016**: Importer MUST chuyển CSS thành thuộc tính trình bày theo đúng cascade (độ đặc hiệu, thứ tự khối, `!important`, `style` nội tuyến thắng), rồi bỏ `<style>` và `class`; bộ phân tích CSS tự viết ở `@mat/svg-import`, không dùng CSSOM của trình duyệt (kết quả phải như nhau ở Chrome, jsdom và Node, D6). Bộ chọn không hỗ trợ ghi `W_IMPORT_CSS_PARTIAL` kèm số phần tử bị ảnh hưởng.
- **FR-017**: Importer MUST chuẩn hóa: đơn vị `width/height` về px; `viewBox` có đủ; `switch` mở nhánh dự phòng; `flowRoot` thành `text` một dòng; font PostScript theo bảng ánh xạ; bỏ phần tử rỗng và định nghĩa không dùng; số tọa độ làm tròn tối đa 3 chữ số thập phân khi giảm kích thước (không làm đổi ảnh quá 0,5 % điểm ảnh, SC-002); `id` giữ nguyên (đã cách ly bằng Shadow DOM của item, D7), trừ `id` trùng.
- **FR-018**: Importer MUST có tùy chọn **Tối ưu**: gộp các hình `line/polyline/polygon/path` liền kề cùng cha có cùng thuộc tính trình bày đã giải (không `id`, không `transform` riêng khác nhau, độ mờ bằng 1, không bị tham chiếu) thành một `path`, nhằm đưa file về dưới giới hạn node; kết quả MUST khác ảnh gốc ≤ 1 % điểm ảnh trên bộ thử.
- **FR-019**: Importer MUST gán `data-mat-uid` (`el_` + 10 ký tự base32) cho mọi **phần tử gắn được** (hình, chữ, nhóm, `use`, ảnh nằm ngoài `defs`/`clipPath`/`mask`/`symbol`/`pattern`/`marker`) và `data-mat-name` (≤ 80 ký tự) cho phần tử có nhãn; mọi `data-mat-uid` có sẵn trong nguồn bị coi là không tin cậy và bỏ (ADR-003 mục 4); danh sách `elements` của item chỉ liệt kê phần tử được binding hoặc sự kiện hoặc tên riêng (FR-004). Bộ sinh UID MUST thay thế được bằng bộ sinh theo seed để nhập tất định.
- **FR-020**: Mỗi lần nhập MUST sinh **báo cáo** (cấu trúc ở [contracts/svg-import.md](contracts/svg-import.md) §6): phần mềm nhận diện, kích thước, số phần tử trước và sau, từng mục loại (loại mục, tên, số lượng, mã lý do, câu tiếng Việt, ≤ 3 đường dẫn ví dụ), cảnh báo, tối ưu, UID đã gán; lưu được ra `.json` và `.md`; không chứa nội dung SVG gốc ngoài tên thẻ và đường dẫn.
- **FR-021**: Mọi lỗi từ chối MUST có mã ổn định và câu hướng dẫn: `E_IMPORT_LIMIT`, `E_IMPORT_PARSE`, `E_IMPORT_ENCODING`, `E_IMPORT_ROOT`, `E_IMPORT_DTD`, `E_IMPORT_USE_BOMB`, `E_IMPORT_SIZE`, `E_IMPORT_EXT`.
- **FR-022**: Nhập SVG MUST tất định: cùng byte đầu vào, cùng tùy chọn và cùng seed UID cho ra cùng byte SVG đầu ra và cùng báo cáo; bản đầu ra ghi bằng bộ ghi tuần tự riêng (thứ tự thuộc tính cố định, thoát ký tự cố định), không dùng `XMLSerializer`.
- **FR-023**: `mountScreen` và `sanitizeSvg` của `@mat/svg-renderer` MUST chuyển sang cùng bộ allowlist (một bản mã); bộ lọc denylist cũ MUST bị xóa; mọi fixture hiện có của Sprint 0 MUST vẫn hiển thị như cũ trừ phần bị loại có chủ ý (kiểm bằng `svg-load` và `svg-inspect`). Trang runtime MUST lọc lại SVG khi dựng (lớp phòng thủ thứ hai) và không bao giờ chèn SVG chưa lọc vào DOM.
- **FR-024**: Bộ kiểm tra của Studio MUST kiểm file SVG của mọi item `svg` khi mở và khi lưu: file không qua allowlist hoặc vượt giới hạn là `E_SVG_UNSAFE` hoặc `E_SVG_LIMIT` (chặn Nạp xuống); ≥ 1 MiB là `W_SVG_HEAVY`.
- **FR-025**: `tools/svg-inspect` MUST có chế độ `--import` chạy importer trên file hoặc thư mục, in và lưu báo cáo, mã thoát khác 0 khi có file bị từ chối; `ci-local` chạy chế độ này trên bộ fixture.

**Nhập lại SVG, giữ UID**

- **FR-026**: **Nhập lại SVG** MUST đối chiếu bản mới (đã chuẩn hóa) với bản đang dùng theo thứ tự, dừng ở khớp đầu tiên đáng tin: (1) `data-mat-uid` có trong bản trước và cùng thẻ; (2) `id` duy nhất ở cả hai phía và cùng thẻ; (3) đường dẫn cấu trúc (chuỗi chỉ số con và thẻ từ cha đã khớp) kèm chữ ký hình học trong dung sai; (4) chữ ký hình học duy nhất trong dung sai chặt. Ngưỡng và công thức chữ ký: [contracts/svg-import.md](contracts/svg-import.md) §7, [ADR-023](../../docs/adr/023-svg-import-allowlist-uid.md).
- **FR-027**: Phần tử có nhiều ứng viên ngang nhau, hoặc khớp chỉ ở mức thấp, MUST NOT được gán tự động: vào danh sách chọn, kèm ≤ 3 ứng viên xếp theo độ giống; phần tử mới nhận UID mới; phần tử cũ không còn khớp và có binding hoặc sự kiện thành mồ côi (`E_REF_UID` chặn Nạp xuống).
- **FR-028**: Hộp thoại **Đối chiếu lại** MUST cho mỗi dòng cần chọn: xem hai phần tử cạnh nhau (hình, tên, thẻ, vị trí), chọn ứng viên, "Bỏ binding" hoặc "Giữ mồ côi"; Áp dụng trong một bước hoàn tác; Hủy không đổi gì.
- **FR-029**: UID MUST giữ nguyên qua Lưu, mở lại, đóng gói, Đọc lên, So sánh, hoàn tác, nhân bản item (item mới cùng file SVG dùng chung UID vì UID duy nhất theo item) và nhập lại.

**Chọn phần tử, inspector, binding**

- **FR-030**: Editor Màn hình MUST cho **vào** một item `svg` (nhấp đúp hoặc Enter) để chọn phần tử gắn được bằng nhấp, Alt+nhấp (xuyên nhóm), cây phần tử trong Details (dựng lười), Tab/Shift+Tab; hiển thị khung chọn bám phần tử ở mọi mức zoom; Esc thoát. Chọn bằng nhấp ≤ 50 ms với SVG 20.000 phần tử.
- **FR-031**: Inspector, nhóm **Gắn Tag**, MUST liệt kê 13 dòng animation (FR-032…FR-039): chữ, màu nền, màu viền, mức, quay, quay liên tục, di chuyển X, di chuyển Y, co giãn, nhấp nháy, dòng chảy, ẩn/hiện, độ mờ, mỗi dòng: Tag (kéo thả hoặc chọn), cách biến đổi, tham số, giá trị hiện tại; dòng không hợp loại phần tử mờ kèm lý do; mọi thay đổi tạo hoặc sửa binding trong tài liệu, không có ô JSON.
- **FR-032**: **Chữ hiển thị giá trị** (`text.content`): định dạng số lẻ 0–6, tiền tố, hậu tố hoặc "đơn vị của Tag", hoặc chữ theo bảng giá trị; chất lượng xấu hiện "--" hoặc chữ thay thế.
- **FR-033**: **Màu nền** (`style.fill`) và **Màu viền** (`style.stroke`): theo bảng giá trị (`valueTable`), theo khoảng (`rangeMap`), hoặc rời rạc (`discreteMap`); màu hợp lệ `#RGB`, `#RRGGBB` hoặc tên màu CSS cơ bản.
- **FR-034**: **Mức chất lỏng**: `rect` dùng `geometry.levelPercent`; hình bất kỳ và nhóm dùng `geometry.clipLevel` (runtime tạo `clipPath` theo hộp bao, cập nhật bằng thuộc tính `y`/`height` hoặc `x`/`width` của `rect` cắt); bốn hướng; giữ đúng khi phần tử có `transform`.
- **FR-035**: **Quay** (`transform.rotate`, độ, theo giá trị) và **Quay liên tục** (`transform.rotate` với `animation: spin`, vòng/phút hoặc BOOL, `reverse`), cả hai có `pivot` (tọa độ tương đối `[0, 1]` trên hộp bao, mặc định `[0,5; 0,5]`).
- **FR-036**: **Di chuyển X/Y** (`transform.translateX/Y`) và **Co giãn** (`transform.scale`, `axis` `xy`/`x`/`y`, `pivot`): biến đổi tuyến tính `inMin…inMax` sang `outMin…outMax` (kẹp), đơn vị đồ họa của hệ tọa độ nhóm cha; hệ số co giãn trong 0,01–10.
- **FR-037**: **Nhấp nháy** (`effect.blink`): bật khi giá trị BOOL true hoặc số khác 0; `period` 400–5.000 ms (mặc định 1.000); `mode` `opacity` (với `minOpacity` 0–0,9, mặc định 0,2), `fill` hoặc `stroke` (với `color`); cùng pha giữa mọi phần tử; tôn trọng `prefers-reduced-motion`.
- **FR-038**: **Dòng chảy** (`effect.flow`): hoạt ảnh `stroke-dashoffset` với `dash` (mẫu nét đứt), `speed` (0–300 đơn vị/giây; tuyến tính theo giá trị hoặc cố định khi bật), chiều thuận hoặc ngược, `byValueSign`; đổi tốc độ bằng `playbackRate` không khởi động lại; tôn trọng `prefers-reduced-motion`.
- **FR-039**: **Ẩn/hiện** (`style.visibility`, BOOL đảo được) và **Độ mờ** (`style.opacity`, tuyến tính 0–1).
- **FR-040**: Nhiều binding trên một phần tử MUST hợp theo thứ tự cố định (di chuyển cha → `transform` gốc → quay → co giãn quanh tâm); mỗi nhóm đích chỉ một binding (`E_DUP_BINDING`); chi tiết ở [contracts/binding-animation.md](contracts/binding-animation.md) §3.
- **FR-041**: `onBadQuality` MUST có mặc định cho đích mới: quay liên tục dừng, nhấp nháy tắt, dòng chảy dừng, di chuyển/co giãn/mức giữ nguyên; `hold` và `override` giữ nghĩa 0.2.
- **FR-042**: Kéo Tag thả lên phần tử trên canvas hoặc vào dòng của inspector MUST kiểm kiểu (số, BOOL, chuỗi theo đích) và từ chối kèm lý do; Tag BOOL vào đích số được đề nghị `discreteMap`.
- **FR-043**: **Thử giá trị**: thanh trượt hoặc công tắc đặt giá trị mô phỏng cho Tag của dòng đang chọn, canvas đổi ≤ 100 ms; không ghi vào project, không tới thiết bị; Đặt lại khôi phục.
- **FR-044**: **Gợi ý** MUST đề nghị binding theo loại phần tử và kiểu Tag (bảng ở [contracts/studio-svg-editor.md](contracts/studio-svg-editor.md) §6).
- **FR-045**: Áp binding cho nhiều phần tử đang chọn (cùng loại thẻ hoặc cùng đích) và chép dán bộ binding giữa phần tử MUST là một bước hoàn tác; mọi thao tác binding MUST hoàn tác được tới 100 bước.
- **FR-046**: Bộ kiểm tra liên tục MUST hiện lỗi ở đúng dòng inspector và tab Thông tin; lưu được khi còn lỗi, Nạp xuống bị khóa (như 004–007).
- **FR-047**: Đổi tên Tag MUST cập nhật binding và sự kiện SVG; "Dùng ở đâu" MUST liệt kê phần tử SVG (màn hình, item, tên phần tử, thuộc tính).
- **FR-048**: `DomApplier` MUST là nơi duy nhất áp binding SVG ở cả Studio (xem trước, Thử giá trị) và Chrome; gom theo `requestAnimationFrame`, chỉ ghi DOM khi giá trị hiển thị đổi, tạm dừng hoạt ảnh khi tab ẩn, hủy sạch khi đổi màn hình, và không gọi `getBBox` mỗi lần cập nhật (đo một lần, đo lại khi phần tử vừa hiện).

**Sự kiện SVG**

- **FR-049**: Trang runtime và xem trước MUST gắn trình xử lý nhấp từ dữ liệu `events` đã kiểm (không từ thuộc tính SVG), đặt `cursor: pointer`, `pointer-events: all`, `tabindex="0"`, `role="button"`, nhãn đọc (`label`, hoặc `title`, hoặc tên phần tử), Enter và Space kích hoạt, viền focus nhìn thấy; phần tử ẩn không nhận nhấp và không vào thứ tự Tab.
- **FR-050**: Hành động `navigate`, `popup`, `closePopup` MUST chạy qua `ActionHost` của 007; hành động `write`, `toggle`, `pulse` MUST đi qua `ControlController` của 007 (một bộ điều khiển cho widget và phần tử SVG, qua bộ chuyển `svgActionController`), cho cùng quy tắc khóa, xác nhận, trạng thái "đang gửi", kết quả và mã `expect`/`pulseMs`, không thêm đường ghi nào.
- **FR-051**: Lệnh ghi từ phần tử SVG MUST mang `context` = `{ screen: <id màn hình>, widget: <elementUid> }` (khớp `^[a-z][a-z0-9_-]{0,63}$`); audit `tag.write` ghi `channel` = `web` (hoặc `studio`) và `context`; **API thiết bị giữ 1.2.0**, không thêm trường.
- **FR-052**: Phần tử SVG khóa MUST hiện lý do (mờ nhẹ, `aria-disabled`, tooltip khi di chuột và focus, vùng `role="status"` khi nhấp) theo cùng bảng mã khóa của 007; hành động chuyển màn hình và popup không bao giờ khóa.
- **FR-053**: Bộ kiểm tra MUST kiểm sự kiện: `E_EVENT_ACTION` (hành động ngoài 6), `E_EVENT_TAG` (Tag không có, không RW, `calculated`, `simulation` không nhập tay, thiếu cho hành động ghi), `E_EVENT_TARGET` (màn hình không có hoặc sai loại), `E_EVENT_CONFIRM` (`none` với Tag không phải BOOL), `E_EVENT_MINROLE` (`viewer`), `E_REF_UID`; `W_EVENT_CONFIRM_NONE`, `W_EVENT_PULSE_READBACK`.
- **FR-054**: Studio MUST có nhóm **Sự kiện** trong inspector cho phần tử SVG (hành động, đích, Tag, giá trị, `durationMs`, xác nhận, quyền tối thiểu, nhãn); xem trước Mô phỏng và Thiết bị chạy sự kiện như Chrome; chế độ chỉnh sửa không kích hoạt.

**Thư viện ký hiệu**

- **FR-055**: Thư viện MUST có ≥ 12 ký hiệu SVG sạch thuộc 5 nhóm (bồn, bơm, van, motor, ống), do dự án vẽ (CC0), không logo hay hình của hãng, mỗi ký hiệu qua allowlist không bị loại gì; manifest ở [contracts/symbol-library.md](contracts/symbol-library.md).
- **FR-056**: Mỗi ký hiệu MUST khai báo **bộ phận** (vai trò, UID cố định `el_<ký hiệu>_<bộ phận>`, nhãn, gợi ý binding) và **điểm gắn** (id, vị trí tương đối, hướng, loại cổng), nằm trong hộp bao của ký hiệu.
- **FR-057**: Toolbox MUST có nhóm **Ký hiệu SVG** (kéo thả, tìm); thả tạo một item `svg` với file SVG sao vào `graphics/symbols/<id>.svg` (các thể hiện dùng chung một file) và file binding riêng; kéo gần điểm gắn tương thích (≤ 10 điểm ảnh màn hình) thì dính và hiện chấm gắn; Alt tắt dính.
- **FR-058**: Inspector MUST có **Gắn nhanh** cho từng bộ phận của ký hiệu đang chọn: mở đúng dòng binding gợi ý trên phần tử bộ phận.

**Kiểm thử, công cụ, tài liệu, phiên bản**

- **FR-059**: Test MUST viết trước (Constitution VI), gồm: vector chung `v04-*` ≥ 100 ca cho hai validator; bộ ca importer (10 fixture, ≥ 24 ca độc hại, ≥ 12 ca giới hạn, ≥ 6 cặp nhập lại); bộ ca chuyển đổi và hợp biến đổi của `DomApplier`; bộ ca hình học (tâm quay, `clipLevel`, hộp bao); bộ ca `svgActionController` cho mọi mã khóa; e2e Studio với axe-core; `web-it` kịch bản `svg`.
- **FR-060**: Bộ fixture nghiệm thu MUST gồm đúng 10 file: 4 Inkscape xuất thật bằng Inkscape CLI từ bản vẽ của dự án, 3 mô phỏng Illustrator và 3 mô phỏng CorelDRAW (viết theo đặc trưng cấu trúc đã biết, không phải file xuất thật); mỗi file có nguồn gốc, giấy phép (CC0/như mã dự án), đặc trưng đã tái tạo và **giới hạn mô phỏng** ghi trong `tests/fixtures/svg-import/README.md` và `manifest.json`. Fixture mô phỏng MUST được thay bằng file thật khi có (task chờ người dùng).
- **FR-061**: Công cụ so ảnh MUST chạy trong trang Chrome headless (canvas, không thêm thư viện), cho tỉ lệ điểm ảnh khác rõ (ΔRGB > 64/255) giữa hai ảnh cùng cỡ; dùng cho SC-002, ghi kết quả `docs/reports/008-fixtures.json`.
- **FR-062**: Bộ SVG độc hại MUST có ≥ 24 ca, mỗi ca khai báo hành vi mong đợi (loại phần nguy hiểm hoặc từ chối); harness MUST kiểm cả ở Studio (kết quả nhập) và ở Chrome (canary `window.__pwned`, chặn mọi yêu cầu mạng ngoài máy chủ thử).
- **FR-063**: Không thêm thư viện ngoài cho runtime, Studio hay công cụ (CSS, tách từ vựng, so ảnh, ghi SVG tự viết); nếu buộc phải thêm: bản phát hành ≥ 2 tuần, rà license, ghi `third_party/LICENSES.md`, không GPL/LGPL (FR-078 của 007).
- **FR-064**: Rà soát bảo mật MUST làm trước khi đóng feature: allowlist (phần tử, thuộc tính, CSS, URL), DTD và entity, bom (`use`, filter, độ sâu), mXSS/CDATA, Shadow DOM và `id`, sự kiện SVG và đường ghi Tag, lệnh Rust `svg_open`, clickjacking (giữ), lộ thông tin trong báo cáo.
- **FR-065**: Tài liệu MUST có: README của `packages/svg-import`, README của thư viện ký hiệu, mục "Nhập SVG và gắn Tag" trong `apps/studio/README.md`, hướng dẫn xuất SVG từ Inkscape, Illustrator, CorelDRAW trong `docs/guides/svg-export.md`, cập nhật `docs/architecture/svg-dialects.md` (mục importer), báo cáo `docs/reports/008-acceptance.md`, ADR 023–026, mục 3b của `studio-ux.md`.
- **FR-066**: Phiên bản: runtime 0.7.0; Studio 0.6.0; định dạng project 0.4.0; API thiết bị 1.2.0 (không đổi); giao thức live 1.2.0 (không đổi); gói `.matscada` 1.0.0 (không đổi); `@mat/ui-components` 0.2.0; `@mat/svg-import` 0.1.0; `schemas/protocol-version.json` thêm `"0.4"`.
- **FR-067**: Trợ năng MUST đạt: 0 lỗi critical hoặc serious (axe-core) ở hộp thoại Nhập SVG, Đối chiếu lại, inspector Gắn Tag và Sự kiện, trang runtime có đồ họa nhập; tương phản chữ ≥ 4,5:1 ở hai theme; mọi lệnh dùng được bằng bàn phím; hoạt ảnh tôn trọng `prefers-reduced-motion`.

### Key Entities

- **Báo cáo import**: phần mềm nhận diện, kích thước, số phần tử trước và sau, danh sách mục loại (loại, tên, số lượng, mã lý do, ví dụ), cảnh báo, tùy chọn đã dùng, số UID đã gán.
- **Phần tử gắn được**: nút SVG có UID (`data-mat-uid`), tên (`data-mat-name`), thẻ, vị trí trong cây.
- **Binding SVG**: id, đích, nguồn Tag, phép biến đổi (`direct`, `discreteMap`, `linearScale`, `valueTable`, `rangeMap`), tham số của đích, `onBadQuality`.
- **Sự kiện SVG**: phần tử, kích hoạt (`click`), hành động, Tag, giá trị, xác nhận, quyền tối thiểu, nhãn.
- **Chữ ký phần tử**: thẻ, thuộc tính trình bày đã giải, dấu vân hình học (hộp bao tính từ thuộc tính), dùng để nhập lại.
- **Kết quả đối chiếu**: với mỗi phần tử bản mới: khớp (UID, bước, độ tin cậy), mới, cần chọn (ứng viên); với mỗi phần tử cũ: được giữ hoặc mồ côi.
- **Ký hiệu**: id, tên, nhóm, tệp SVG, hộp bao, bộ phận, điểm gắn.
- **Thể hiện ký hiệu**: item `svg` tham chiếu tệp SVG của ký hiệu trong project, có binding riêng.
- **Nơi chứa hoạt ảnh**: tập hoạt ảnh vô hạn đang chạy của một màn hình (đếm cho giới hạn).

## Success Criteria *(mandatory)*

### Measurable Outcomes

**Nghiệm thu của lộ trình (§4.4)**

- **SC-001**: 10/10 fixture (4 Inkscape thật, 3 mô phỏng Illustrator, 3 mô phỏng CorelDRAW) nhập thành công và hiển thị trên Studio (canvas editor, e2e) và Chrome (trang runtime): 100 % file qua; báo cáo của mỗi file khớp `manifest.json` (đúng các mã loại mong đợi).
- **SC-002**: Với mỗi fixture, ảnh Chrome của bản đã nhập khác ảnh Chrome của bản gốc ≤ 0,5 % số điểm ảnh (trừ vùng đã khai trong `manifest.json`: chữ nhánh dự phòng của `foreignObject`, `flowRoot` chuyển thành một dòng); với 4 fixture Inkscape, ảnh PNG do Inkscape tự xuất khác ảnh Chrome của bản đã nhập ≤ 3 % số điểm ảnh khác rõ; ngưỡng Tối ưu của file stress ≤ 1 %.
- **SC-003**: Bộ SVG độc hại ≥ 24 ca: 100 % bị loại hoặc từ chối đúng mong đợi; khi dựng bản đã nhập trong Chrome: 0 mã chạy (`window.__pwned` vẫn null), 0 yêu cầu mạng ngoài máy chủ thử; phần mềm dựng bản gốc chưa lọc làm canary kích hoạt ở ≥ 1 ca (chứng minh bộ thử có hiệu lực).
- **SC-004**: Màn hình bồn nước + motor của `tank-demo` dựng lại hoàn toàn trong Studio (0 dòng JSON viết tay, kịch bản e2e từ project rỗng): `validate` không lỗi, Nạp xuống runtime x64, mở trên Chrome: 100 % phần tử đích đổi đúng theo Tag mô phỏng (chữ, màu, mức, quay liên tục, dòng chảy), nút nhấp được có xác nhận và audit đúng; số thao tác của kịch bản ghi trong báo cáo.
- **SC-005**: Mở màn hình chuẩn 3b (một đồ họa nhập ≈ 3.000 phần tử, 30 binding, 10 hoạt ảnh, 5 sự kiện, 100 Tag) ≤ 2 s từ lúc bấm menu hoặc nhập địa chỉ (bộ nhớ đệm trống) tới giá trị sống đầu tiên trên Chrome ở LAN tới BL335; 10 client cùng F5 ≤ 5 s; màn hình 40 item `svg` ≤ 2 s. Đo trên x64 và, khi có SSH, trên BL335 (⚠️🔌).
- **SC-006**: Cùng project và cùng giá trị Tag: DOM và thuộc tính hiển thị của phần tử có binding giống nhau ở Studio (xem trước) và trang runtime ở 100 % phần tử của bộ ca (cùng `DomApplier`).
- **SC-007**: Trên BL335, 10 client xem màn hình chuẩn 3b 30 phút với 500 Tag mô phỏng/1 s: CPU trung bình ≤ 30 %, RSS ≤ 150 MB, 0 mất sequence (⚠️🔌; x64 làm trước).

**Chất lượng importer và nhập lại**

- **SC-008**: 100 phần tử hoạt ảnh (quay liên tục, nhấp nháy, dòng chảy) chạy 30 phút trên Chrome (máy dev): p95 thời gian mỗi khung ≤ 8 ms, bộ nhớ tab phút 30 không lớn hơn phút 5 quá 50 MB; tab ẩn: số lần chạy callback `requestAnimationFrame` của trang bằng 0.
- **SC-009**: Bộ cặp nhập lại (≥ 6 cặp, ≥ 150 phần tử có đáp án): 0 phần tử bị gán tự động sai UID; ≥ 90 % phần tử có binding khớp tự động đúng; 100 % phần tử còn lại ở danh sách chọn hoặc mồ côi (không mất im lặng); thời gian đối chiếu 20.000 phần tử ≤ 3 s trên máy dev.
- **SC-010**: Giới hạn: 100 % ca biên (5 MiB, 5 MiB + 1; 20.000 và 20.001 phần tử sau chuẩn hóa; độ sâu 32 và 33; 100.000 và 100.001 thô; 100.000 và 100.001 hiệu dụng; 8 và 9 filter) cho đúng kết quả; thời gian từ chối file 5 MiB + 1 ≤ 50 ms (không parse).
- **SC-011**: Không hồi quy: 100 % project 0.1–0.3 mẫu (`tank-demo`, `modbus-demo`, `dashboard-demo`) chạy trên runtime 0.7 cho cùng phần tử đích, cùng giá trị binding và cùng hiển thị (ảnh chụp khác ≤ 0,5 % số điểm ảnh) như runtime 0.6, ngoại lệ có chủ ý ở US6 kịch bản 2 (quay trên phần tử có `transform` gốc: có test riêng); mọi project nâng cấp được sang 0.4 và bản nâng cấp hợp lệ.
- **SC-012**: Bộ vector chung `v04-*` ≥ 100 ca: Studio (TS) và runtime (C++) cho cùng kết luận và mã ở 100 % ca; 100 % vector 0.1, 0.2 và 0.3 hiện có giữ nguyên kết luận.

**Bảo mật và vận hành**

- **SC-013**: Sự kiện SVG: 100 % ca khóa của 007 (viewer, chưa đăng nhập, HTTP, HTTPS không chạy, mất live, BAD, STALE, chưa có giá trị, Tag lạ, Tag R, đang gửi, hộp xác nhận khác đang mở) áp đúng cho phần tử SVG với đúng lý do; 30 ca tấn công của 007 chạy lại với lệnh từ phần tử SVG: 100 % bị từ chối, 0 lệnh tới thiết bị trường, 100 % có audit; 100 % lệnh ghi hợp lệ có `context.widget` = `elementUid`.
- **SC-014**: Bộ ca hợp biến đổi và hình học (tâm quay 9 điểm, quay + di chuyển + co giãn trên phần tử có `transform` gốc, `clipLevel` bốn hướng ở 0, 50, 100 %, `levelPercent` trên `rect`): 100 % cho đúng ma trận và đúng hộp cắt (sai số ≤ 0,01 đơn vị).
- **SC-015**: Kiểm trợ năng tự động và bàn phím: 0 lỗi critical hoặc serious ở các hộp thoại và inspector mới và trang runtime có đồ họa nhập, hai theme; 100 % lệnh (nhập, đối chiếu, gắn binding, sự kiện, thử giá trị) dùng được chỉ bằng bàn phím; phần tử có sự kiện vào được bằng Tab và kích hoạt bằng Enter/Space.
- **SC-016**: Không hồi quy: mọi kiểm tra tự động của 004–007 vẫn đạt; `svg-load` (19 file Sprint 0) vẫn hiển thị ≤ 2 s; trang xem 0.1–0.3 từ mạng riêng không đổi hành vi.
- **SC-017**: Ký hiệu: 12/12 ký hiệu qua allowlist không bị loại gì; 100 % bộ phận có UID đúng quy ước; 100 % điểm gắn nằm trong hộp bao; kéo thả ký hiệu và dính điểm gắn đạt SC-014 của 007 (bộ ca hình học).

**Studio**

- **SC-018**: Nhập SVG 20.000 phần tử ≤ 5 s (hộp thoại hiện báo cáo ≤ 3 s, ghi tài liệu ≤ 2 s) trên máy dev; mở cây phần tử ≤ 300 ms; chọn phần tử bằng nhấp ≤ 50 ms; Thử giá trị đổi canvas ≤ 100 ms; hoàn tác ≤ 100 ms.
- **SC-019**: Các editor và hộp thoại mới đạt 100 % quy tắc studio-ux.md §5 và §7 (bảng đối chiếu từng quy tắc, `docs/reports/008-sc019.md`) và khớp bố cục của mockup `studio-svg.html`.
- **SC-020**: Một kỹ sư chưa dùng tính năng làm trọn trong ≤ 20 phút không cần tài liệu: nhập một SVG, gắn mức nước, màu đèn, quay motor, thêm một sự kiện, xem trước Mô phỏng, Nạp xuống. Không có người thử thì ghi "tự đo" như 004.
- **SC-021**: Không có `innerHTML`, `eval`, `new Function` ở `packages/svg-import`, `packages/svg-renderer`, `packages/binding-engine`, `packages/ui-components` (lint và grep trong CI, như SC-020 của 007).
- **SC-022**: Tải khởi động của trang ≤ 250 KB nén gzip (như 007; code của allowlist và sự kiện SVG không đẩy vượt); `@mat/svg-import` không vào gói của trang (chỉ Studio và CLI).

## Assumptions

### Quyết định đã chốt trước khi viết spec

Theo lộ trình v2 (duyệt ngày 2026-10-11) §4.4 và yêu cầu của phiên:

- **D1. GĐ 3b là một feature** (`008-svg-import-binding`). Lý do: importer, binding bằng inspector, sự kiện và ký hiệu cùng dựa vào một mô hình (UID, binding 0.4); tách ra thì mỗi feature phải đổi định dạng binding.
- **D2. Allowlist trên DOM đã parse thay denylist** (Constitution V); giới hạn 5 MB, 20.000 node, độ sâu 32 (roadmap §4.4).
- **D3. Gắn Tag bằng inspector, không viết tay JSON** (roadmap §4.4; studio-ux §5).
- **D4. Sự kiện dùng cùng đường ghi của 006/007** (`POST /api/v1/tags/write`), không script (Constitution V, D4 và D5 của 007).
- **D5. Nghiệm thu:** 10 fixture từ Inkscape, Illustrator, CorelDRAW; SVG độc hại bị loại; màn hình bồn nước + motor dựng lại trong Studio; RSS ≤ 150 MB, CPU ≤ 30 %, mở màn hình ≤ 2 s.
- **D6. Ngoài phạm vi:** trình vẽ SVG đầy đủ, faceplate, template (GĐ 6); alarm (GĐ 4); biểu đồ lịch sử (GĐ 5).

### Quyết định khi viết spec

Các điểm dưới đây chưa được chốt trước; spec chọn phương án hợp lý nhất. Mỗi điểm là **Quyết định (người dùng giao toàn quyền 2026-10-11)**.

- **D7. Định dạng 0.4.0, không mở rộng 0.3.** Lý do: thêm đích, phép biến đổi và `events` vào file binding làm runtime 0.6 từ chối project (`E_TARGET_UNSUPPORTED`): đó là thay đổi ngữ nghĩa, theo ADR-004 là MINOR khi MAJOR = 0, kèm migration (0.3 → 0.4 chỉ đổi số phiên bản). Nhập 0.1–0.3 vẫn chạy trên runtime 0.7.
- **D8. Một item `svg` mỗi thể hiện ký hiệu, nâng trần lên 64 item `svg`.** Lý do: thể hiện = item cho sẵn di chuyển, đổi cỡ, khóa, xếp lớp, binding riêng mà không cần trình sửa SVG (GĐ 6); 8 item của 007 (D26) không đủ cho sơ đồ có vài chục bơm, van, ống. Chi phí: mỗi item một Shadow DOM và một file binding; đo ở SC-005 (40 item).
- **D9. Sự kiện nằm trong file binding** (`elements[].events`), không trong file màn hình. Lý do: binding và sự kiện cùng khóa theo `elementUid` của item, cùng vòng đời (mồ côi, đổi tên Tag, nhập lại); file màn hình giữ mô tả bố cục.
- **D10. Hai cách đổi màu theo khoảng:** bảng giá trị dùng chung (đã có từ 006, có mục khoảng) và `rangeMap` nội tuyến trong binding. Lý do: bảng dùng chung cho nhiều nơi; `rangeMap` cho trường hợp một lần, khỏi tạo bảng. Ngữ nghĩa khoảng giống bảng giá trị (nửa mở, cấm chồng, ADR-015) và cùng mã dò.
- **D11. Hợp biến đổi:** di chuyển ở hệ tọa độ của nhóm cha (đứng ngoài cùng), `transform` gốc của phần tử giữ nguyên, quay và co giãn quanh tâm tương đối trên hộp bao. Lý do: CSS `transform` ghi đè thuộc tính `transform` của SVG (0.2 quay làm mất `transform` gốc); người dùng mong "di chuyển ngang" là ngang trên sơ đồ dù phần tử đã xoay sẵn. ADR-024.
- **D12. Mức chất lỏng cho hình bất kỳ bằng `clipPath` sinh lúc chạy** (không sửa file SVG): `rect` cắt theo hộp bao đo một lần. Lý do: không đổi hình dạng hay `d` của đường; chạy với hình cong (bồn tròn, đáy cầu). `rect` giữ cách đổi thuộc tính (rẻ hơn, 0.2).
- **D13. Nhấp nháy:** chu kỳ 400–5.000 ms (≤ 2,5 lần/giây, dưới giới hạn 3 lần/giây của hướng dẫn trợ năng về ánh sáng nhấp nháy), chung nhịp, tôn trọng `prefers-reduced-motion`; nhấp nháy không là tín hiệu duy nhất (Studio cảnh báo khi phần tử không kèm màu hay chữ).
- **D14. Dòng chảy bằng Web Animations (`stroke-dashoffset`)**, đổi tốc độ bằng `playbackRate`, không thêm phần tử và không dùng SMIL. Lý do: cùng cơ chế quay liên tục đã chạy (0.2), tạm dừng khi tab ẩn, một hoạt ảnh mỗi phần tử.
- **D15. Phần tử SVG dùng lại `ControlController` bằng một widget ảo** (`svgActionController`: tạo `WidgetItem` ảo từ hành động của phần tử), `context.widget` = `elementUid`; API 1.2.0 không đổi. Lý do: một chuỗi khóa, xác nhận, kết quả cho mọi điều khiển (Constitution V); `elementUid` hợp mẫu `context.widget` và duy nhất trong màn hình khi kèm `screen`.
- **D16. Vùng nhận nhấp và bàn phím:** `pointer-events: all` cho phần tử có sự kiện, `tabindex`, `role`, `aria-label` do mã đặt khi chạy (thuộc tính này bị sanitizer bỏ khỏi SVG; sự kiện không bao giờ nằm trong SVG).
- **D17. Một bộ allowlist, hai nơi dùng:** `@mat/svg-renderer` giữ allowlist và bộ lọc (dùng ở trang và Studio); `@mat/svg-import` (Studio, CLI) thêm chuẩn hóa, CSS, UID, đối chiếu, báo cáo trên cùng allowlist. Lý do: Constitution II (một nguồn), trang không nạp mã importer (SC-022).
- **D18. CSS bằng bộ phân tích tự viết** (bộ chọn thẻ, lớp, id, ghép, danh sách; cascade theo độ đặc hiệu), không dùng CSSOM của trình duyệt. Lý do: cùng kết quả ở Chrome, WebView2, jsdom, Node (CI); tất định; không thêm thư viện. Bộ chọn lạ báo `W_IMPORT_CSS_PARTIAL`.
- **D19. Không đổi `id`** (trừ trùng) và không tiền tố: mỗi item một Shadow DOM (ADR-007) đã cách ly; khuyến nghị 4 và 5 của `svg-dialects.md` (tiền tố khi ghép nhiều file vào một màn hình) không cần vì 3b không ghép nhiều file vào một item.
- **D20. Phần tử gắn được và UID:** gán cho mọi phần tử vẽ được nằm ngoài `defs`, `clipPath`, `mask`, `symbol`, `pattern`, `marker`. Chi phí kích thước (≈ 28 byte mỗi phần tử, 20.000 phần tử ≈ 560 KB) chấp nhận; `data-mat-name` thêm cho phần tử có nhãn. ADR-023 mở rộng ADR-003 mục 4 (thêm `data-mat-name`) và chốt thuật toán nhập lại.
- **D21. Ngưỡng nhập lại ban đầu:** bước 1 và 2 tự động khi khoảng cách chữ ký ≤ 25 % đường chéo hộp bao gốc; bước 3 ≤ 5 %; bước 4 ≤ 0,5 % và duy nhất (khoảng cách hạng hai lớn hơn ít nhất 0,2 %); các số được hiệu chỉnh bằng bộ cặp (SC-009) ở task hiệu chỉnh, không đổi nguyên tắc "mơ hồ thì hỏi".
- **D22. Tối ưu (gộp) là tùy chọn**, mặc định tắt, chỉ gợi ý khi vượt giới hạn node; không bao giờ tự bật. Lý do: gộp làm mất khả năng gắn riêng từng hình nhỏ; người dùng quyết định.
- **D23. Fixture:** 4 Inkscape xuất thật bằng Inkscape CLI trên máy dev từ bản vẽ do dự án viết; 3 Illustrator và 3 CorelDRAW là **mô phỏng** đặc trưng cấu trúc xuất (theo [svg-dialects.md](../../docs/architecture/svg-dialects.md)), vì hai phần mềm không có trên máy dev; **giới hạn:** không thể hiện đầy đủ cách phần mềm thật sinh id, số thập phân, thứ tự thuộc tính, phiên bản; kết luận SC-001 cho hai phần mềm này là "đạt trên mô phỏng" cho tới khi có file thật (task chờ người dùng cung cấp ≥ 1 file mỗi phần mềm, bước thay trong `manifest.json`). Giấy phép: do dự án tạo, CC0; không dùng ký hiệu, font hay logo có bản quyền; file người dùng cung cấp trước đây (`factory-isometric-stress.svg`) chỉ dùng làm ca giới hạn có sẵn trong repo.
- **D24. So ảnh trong trang Chrome headless bằng canvas** (không thêm thư viện); ngưỡng "khác rõ" ΔRGB > 64/255 như thí nghiệm 1 của svg-dialects (đo 1,66 % cho file Inkscape thật), ngưỡng nhận Inkscape-vs-Chrome 3 %.
- **D25. Chọn phần tử trong canvas:** nhấp đúp vào item "vào" chế độ chọn phần tử (như TIA vào nhóm); Alt+nhấp xuyên nhóm; cây phần tử dựng lười; khung chọn tính bằng `getBoundingClientRect` và quy về đơn vị thiết kế. Lý do: một lần nhấp phải là chọn item (kéo, đổi cỡ), nhấp đúp mới vào bên trong.
- **D26. Studio không sửa nội dung SVG** ngoài nhập, nhập lại, đổi tên phần tử (`data-mat-name`); xóa, vẽ, sắp lại phần tử là GĐ 6 (trình vẽ đầy đủ). Muốn đổi hình: sửa ngoài rồi Nhập lại.
- **D27. Lệnh Rust `svg_open`** (cùng khuôn `csv_open`: hộp thoại hệ thống, trả byte thô, trần 5 MiB + 64 B, đuôi `.svg`); không thêm đường đọc file tùy ý. Lý do: giữ nguyên tắc "giao diện không tự đọc/ghi ngoài thư mục project".
- **D28. Thử giá trị trong inspector** dùng `SimEngine` của Studio (006) như xem trước Mô phỏng; không bật chế độ Online. Lý do: kiểm binding tức thì không cần thiết bị.
- **D29. Kích thước và vị trí item nhập:** item đặt ở (0, 0), cỡ bằng `viewBox` thu về vừa màn hình (giữ tỉ lệ, không phóng to quá 100 %); kỹ sư đổi sau.
- **D30. Runtime C++ không parse SVG** (Constitution II); lớp phòng thủ khi project bị sửa trên đĩa là allowlist của trang và CSP của `/project/` ([http_api.cpp](../../server/http/http_api.cpp) `kCspProject`). Ghi vào rủi ro: runtime không từ chối được gói có SVG độc; Studio chặn ở phía đóng gói.
- **D31. Không thêm nén phía BL335.** SVG phục vụ không nén (`Cache-Control: no-cache`); giảm tải bằng chuẩn hóa gọn (làm tròn số, bỏ metadata) và cảnh báo `W_SVG_HEAVY` từ 1 MiB (ước tính 10 client F5 qua LAN 100 Mbps ≈ 0,8 s mỗi MiB). Điều kiện xem xét lại: số đo BL335 (⚠️🔌) cho thấy SC-005 không đạt với SVG ≥ 1 MiB: bật nén tại runtime (ngoài phạm vi, ghi rủi ro).
- **D32. Ký hiệu:** 12 ký hiệu do dự án vẽ (CC0) ở `packages/symbol-library`; thể hiện là item `svg` (D8); điểm gắn là siêu dữ liệu để dính khi kéo, không phải đối tượng nối (trình nối ống tự động thuộc GĐ 6); không có "lưu thành ký hiệu của project" (GĐ 6, faceplate/template).
- **D33. Bảng ánh xạ font PostScript** gồm Arial, Times New Roman, Courier New, Calibri, Myriad Pro, Helvetica, Segoe UI, Tahoma, Verdana, Cambria; tên không có trong bảng thêm `sans-serif`. Cập nhật bằng dữ liệu, không bằng mã.
- **D34. Giới hạn hoạt ảnh vô hạn** 64 (cảnh báo) và 256 (lỗi) mỗi màn hình. Lý do: bảo vệ máy khách cấu hình thấp; số đo SC-008 là 100 hoạt ảnh trên máy dev; điều chỉnh khi có số đo Chrome 120 trên máy yếu.
- **D35. Nhãn đọc và `title`:** `title` của phần tử gắn được được giữ (≤ 200 ký tự) làm nhãn đọc màn hình; `desc`, `metadata` bỏ.
- **D36. Phiên bản:** runtime 0.7.0; Studio 0.6.0; định dạng 0.4.0; API 1.2.0 và live 1.2.0 không đổi; `@mat/ui-components` 0.2.0; `@mat/svg-import` 0.1.0. API không đổi vì `context.widget` nhận `elementUid` (D15) và mọi dữ liệu mới nằm trong file project.
- **D37. Thiết bị BL335:** SSH tới BL335 không có trong phiên viết spec này (như 006 D7, 007 D40); các bước đo và thử trên thiết bị làm thành task ⚠️🔌, chờ người dùng cho phép SSH hoặc tự chạy lệnh của quickstart. Mọi chức năng chạy và kiểm trên x64 trước (Constitution I: nghiệm thu trên BL335 là điều kiện đóng feature).
- **D38. Mockup:** `docs/architecture/mockups/studio-svg.html` tạo trước code giao diện Studio mới (hộp thoại Nhập SVG, Đối chiếu lại, inspector Gắn Tag, Sự kiện, ký hiệu); phiên làm việc tự duyệt (người dùng giao toàn quyền).
- **D39. Hiệu năng hoạt ảnh trên máy khách** không tính vào ngân sách BL335 (Constitution III) nhưng có số đo riêng (SC-008) vì người vận hành dùng máy văn phòng và Chrome ≥ 120.
- **D40. Nhấp nháy theo đồng hồ trang**, không theo thời gian BL335; dòng chảy và quay theo đồng hồ trang. Hoạt ảnh là hiển thị, không phải đo lường.

### Giả định và phụ thuộc

- **Phụ thuộc:**
  - feature 007 xong về mã (commit `634d528`: màn hình v1, widget, điều khiển trên Chrome, trình bố trí, Studio 0.5.0, runtime 0.6.0); phần chờ BL335 của 005, 006, 007 không chặn feature này;
  - feature 006 (Tag, bảng giá trị, ghi Tag, `SimEngine`), 005 (HTTPS, đăng nhập, nạp xuống), 004 (khung Studio), 003 (không đổi);
  - Inkscape CLI trên máy dev (đã có theo ghi chú môi trường) để tạo 4 fixture thật.
- **Bàn thử:** runtime x64 (Docker), giả lập Modbus (006), Chrome headless (puppeteer-core, axe-core đã có); thử với BL335, Chrome và Windows thật, Illustrator, CorelDRAW là việc của người và thiết bị.
- **Thao tác trên BL335** theo Constitution, quy trình bước 3: chỉ đọc khi kiểm; mọi thay đổi ghi vào `device-changes.md`; không đụng dịch vụ khác. SSH tới BL335 hiện cần người dùng cho phép: SC-005, SC-007 trên thiết bị chờ quyền đó.
- **ADR:** 023 (importer allowlist, UID, nhập lại), 024 (binding 0.4.0 và animation), 025 (sự kiện của phần tử SVG), 026 (thư viện ký hiệu và chọn phần tử trong Studio); tất cả Proposed khi lập plan.
- **Đo SC-020:** cần một người chưa dùng tính năng; không có thì ghi tự đo.
- Chrome ≥ 120 (Constitution IV): mọi API dùng (Web Animations, `getBBox`, `ResizeObserver`, `elementsFromPoint`, `prefers-reduced-motion`) có từ Chrome 84 trở lên.

## Ngoài phạm vi

- Trình vẽ SVG đầy đủ: vẽ, sửa, nhóm, bỏ nhóm, xóa phần tử trong Studio; trình nối ống tự động; sửa `d` của đường (GĐ 6).
- Faceplate, template, "lưu thành ký hiệu của project", thư viện ký hiệu của khách (GĐ 6).
- Alarm: nhấp nháy theo alarm, màu theo lớp alarm, banner (GĐ 4).
- Biểu đồ lịch sử, báo cáo (GĐ 5).
- Biểu thức trong binding (`expression`), điều kiện `enableWhen`, interlock, logic và luật sự kiện (GĐ 6); phép biến đổi nhiều Tag cho một thuộc tính.
- Sự kiện khác nhấp: nhấn giữ, thả, di chuột, nhấp đúp, kéo (chỉ `click`); nhiều hành động cho một sự kiện; ghi nhiều Tag một lần.
- Hoạt ảnh theo đường cong (di chuyển dọc `path`), biến đổi hình (morph), SMIL, CSS animation của người dùng; nhấp nháy hơn 3 lần/giây.
- Nhập định dạng khác SVG (DXF, DWG, PDF, Visio, EMF, PNG làm hình nền ngoài ảnh nhúng trong SVG).
- Nhúng font; chữ khung có xuống dòng tự động (`flowRoot` thành một dòng).
- Nén phía BL335 cho file project; bộ nhớ đệm có điều kiện (ETag) cho file project.
- Nhiều file SVG trong một item; ghép nhiều SVG và tiền tố `id` (D19).
- Bố cục đáp ứng cho điện thoại, ứng dụng di động, quyền xem theo từng màn hình.
- Thử Illustrator và CorelDRAW thật tự động; chỉ có mô phỏng (D23), thay bằng file thật khi người dùng cung cấp.
