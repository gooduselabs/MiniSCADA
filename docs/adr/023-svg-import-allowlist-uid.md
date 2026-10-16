# ADR-023: Nhập SVG bằng allowlist trên DOM đã parse, UID tự gán và đối chiếu khi nhập lại

- **Trạng thái:** **Accepted** phần đã đo trên x64 (feature 008, 2026-10-16; quyết định "người dùng giao toàn quyền 2026-10-11"): importer, allowlist, nhập lại (210/215, 0 gán sai), bộ độc hại, stress. **Vẫn Proposed** phần chờ BL335 và người: SC-005 trên thiết bị với SVG ≥ 1 MiB (D31, T123), file thật Illustrator và CorelDRAW (T120). Tổng hợp: [008-acceptance.md](../reports/008-acceptance.md).
- **Ngày:** 2026-10-16 (đề xuất 2026-10-13)
- **Liên quan:** [specs/008-svg-import-binding](../../specs/008-svg-import-binding/plan.md), research R2–R7, R18, R19, R21; contract [svg-import.md](../../specs/008-svg-import-binding/contracts/svg-import.md); **thay** phần "bộ lọc tối thiểu" của [ADR-007](007-screen-isolation.md); **chốt** thuật toán còn để ngỏ của [ADR-003](003-element-uid.md) (mục 4 mở rộng, mục 6 đặt ngưỡng); [svg-dialects.md](../architecture/svg-dialects.md); lộ trình v2 §4.4; Constitution II, V, VI.

## Bối cảnh

Từ Sprint 1, trang runtime và Studio dựng SVG qua `mountScreen`, gọi `sanitizeSvg` ở [sanitize.ts](../../packages/svg-renderer/src/sanitize.ts): một **denylist** phần tử và thuộc tính (cộng lọc namespace và regex CSS sau giải escape), không giới hạn kích thước, số phần tử, độ sâu. Báo cáo Sprint 1 và ADR-007 ghi đây là nợ Constitution V ("SVG import dùng allowlist trên DOM đã parse, không regex; có giới hạn"). GĐ 3b thêm đường nhập SVG từ phần mềm ngoài, nên nợ phải trả.

Ràng buộc:

- SVG nhập là **dữ liệu không tin cậy**: có thể do công cụ vẽ sinh ra (Inkscape, Illustrator, CorelDRAW: đặc trưng ở [svg-dialects.md](../architecture/svg-dialects.md)), hoặc do kẻ xấu làm ra.
- Studio, trang Chrome, CLI và CI dùng chung một bộ kiểm tra (Constitution II), CI chạy ở Node (jsdom) chứ không chỉ Chrome.
- `core/` không parse SVG (Constitution II): runtime C++ không thể kiểm nội dung SVG; lớp phòng thủ thứ hai nằm ở trang.
- Binding bám `elementUid` (ADR-003): nhập SVG phải gán UID, nhập lại phải giữ UID, và "khớp sai gán binding vào nhầm phần tử" là rủi ro lớn nhất của ADR-003.
- Giới hạn của roadmap: 5 MB, 20.000 node, độ sâu 32. File Inkscape thật của dự án có 27.029 phần tử.

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Cách lọc | (A) giữ denylist + thêm giới hạn; (B) DOMPurify; **(C) allowlist tự viết trên DOM đã parse, tra bảng, vòng lặp** | **C** |
| Nơi lọc | chỉ Studio; **Studio (importer) và trang (khi dựng)**; chỉ trang | cả hai, cùng một bộ bảng |
| DTD và entity | để parser xử lý; từ chối mọi DOCTYPE; **quét tiền xử lý, thay entity namespace Adobe đã biết rồi bỏ DTD, từ chối entity khác** | quét tiền xử lý |
| CSS | giữ `<style>` đã lọc; `getComputedStyle`; thư viện CSS; **bộ phân tích tự viết, cascade, chuyển thành thuộc tính** | bộ tự viết |
| Quá 20.000 node | nâng giới hạn; tự gộp; **từ chối, gợi ý Tối ưu (gộp hình có điều kiện, người dùng bật)** | Tối ưu tùy chọn |
| Gán UID | khi gắn binding đầu tiên; băm đường dẫn; **khi nhập, cho mọi phần tử gắn được** | khi nhập |
| Tên phần tử | chỉ `id`; **`data-mat-name` (thêm một `data-*`)**; sidecar | `data-mat-name` |
| Nhập lại | chỉ `id`; vị trí trong cây; **bốn bước UID → `id` → cấu trúc → hình học, mơ hồ thì hỏi** | bốn bước |
| Hộp bao cho nhập lại | `getBBox` (layout); **tính từ thuộc tính** | từ thuộc tính |
| Ghi SVG | `XMLSerializer`; **bộ ghi tuần tự riêng** | bộ ghi riêng |

## Quyết định

1. **Allowlist** (`sanitizeSvg` mới, cùng chữ ký):
   - duyệt cây bằng ngăn xếp tường minh; giữ phần tử khi `localName` và `namespaceURI` (SVG) thuộc `ALLOW_ELEMENTS` (≈ 45 tên: cấu trúc, hình, chữ, sơn, cắt, ảnh, `filter` và 15 hình nguyên thủy nhẹ); bỏ phần tử khác cùng con, trừ `a` (mở vỏ);
   - thuộc tính: tra `ATTR_RULES[element]` và `PRESENTATION`, mỗi giá trị qua hàm kiểm theo kiểu viết bằng bộ quét ký tự; `href` chỉ `#id` hoặc `data:image/{png,jpeg,gif,webp};base64` hợp lệ (có kiểm chữ ký tệp); `url()` chỉ `#id`; `data-*` chỉ `data-mat-uid` và `data-mat-name`; `style` phân tích bằng bộ tách từ vựng rồi ghi lại khai báo hợp lệ;
   - **không regex** để quyết định giữ hay bỏ bất kỳ nút, thuộc tính, giá trị nào.
   - Dùng ở trang (khi dựng; lớp phòng thủ thứ hai), Studio (xem trước, kiểm `E_SVG_UNSAFE`), importer, CLI.
2. **Tiền xử lý** (`@mat/svg-import`): bỏ BOM; chỉ UTF-8; bộ quét đi qua phần mở đầu để tìm DOCTYPE; entity namespace Adobe đã biết (`ns_svg`, `ns_extend`, `ns_ai`, …) thay bằng URI rồi bỏ DTD; entity khác (kể cả `SYSTEM`, `PUBLIC`, tham số) → từ chối `E_IMPORT_DTD`; bỏ mọi PI; byte > 5 MiB từ chối trước khi parse.
3. **Giới hạn:** 5 MiB; **20.000 phần tử sau chuẩn hóa** (và sau Tối ưu nếu bật); độ sâu 32; chặn bom: 100.000 phần tử thô, 100.000 phần tử hiệu dụng sau mở `use`, ≤ 8 `filter`, ≤ 64 hình nguyên thủy lọc, ≤ 16 ảnh và 2 MiB giải mã. Vượt thì từ chối cả file.
4. **CSS → thuộc tính:** bộ tách từ vựng, bộ chọn hỗ trợ (`*`, thẻ, `.lớp`, `#id`, ghép, danh sách), cascade theo độ đặc hiệu, thứ tự, `!important`, `style` nội tuyến thắng; kết quả là thuộc tính trình bày, bỏ `<style>` và `class`; bộ chọn lạ bỏ và cảnh báo.
5. **Chuẩn hóa:** đơn vị về px, `viewBox`, `switch` mở nhánh dự phòng, `flowRoot` thành `text` một dòng, font PostScript theo bảng dữ liệu, `xlink:href` thành `href`, bỏ phần tử rỗng và định nghĩa không dùng, `id` trùng đổi tên; **không** tiền tố `id` (mỗi item một Shadow DOM, ADR-007; 3b không ghép nhiều file vào một item). **Tối ưu** (tùy chọn): gộp `line/polyline/polygon/path` liền kề cùng thuộc tính đã giải khi không độ mờ và không bị tham chiếu.
6. **UID (mở rộng ADR-003):** gán `data-mat-uid` (`el_` + 10 ký tự base32) cho mọi phần tử gắn được; `data-mat-uid` của nguồn **bị bỏ** (mục 4 của ADR-003 giữ nguyên); thêm `data-mat-name` (≤ 80 ký tự) cho phần tử có nhãn (`inkscape:label`, `data-name`, `id` có nghĩa). Studio không sửa SVG ngoài nhập, nhập lại, đổi tên.
7. **Nhập lại (chốt mục 6 của ADR-003):** chữ ký `{ tag, style, box, kids }` với `box` tính từ thuộc tính; khoảng cách `D` (Chebyshev chuẩn hóa theo đường chéo `viewBox` + phạt thuộc tính trình bày). Bốn bước: UID (`D ≤ 0,25`), `id` duy nhất (`D ≤ 0,25`), cấu trúc dưới cha đã khớp (`D ≤ 0,05`), hình học duy nhất (`D ≤ 0,005`, ứng viên hạng hai cách ≥ 0,002). Mơ hồ → danh sách chọn (≤ 3 ứng viên); mới → UID mới; mồ côi → `E_REF_UID` chặn Nạp xuống. **Ngưỡng đã hiệu chỉnh bằng bộ cặp (T100, xem "Số đo")**: giữ bốn ngưỡng, thêm 0,05 cho `id` tự sinh ở bước 2, kiểm đối thủ hai phía ở bước 3 và 4; **bất biến:** 0 gán sai tự động.
8. **Báo cáo** có cấu trúc, tất định, không chứa nội dung SVG gốc; mã lý do ổn định (`R_*`, `C_*`, `W_IMPORT_*`).
9. **Bộ ghi SVG riêng** (thứ tự thuộc tính cố định, thoát ký tự cố định): nhập tất định (cùng byte vào, cùng seed UID, cùng byte ra).
10. **Runtime C++ không kiểm nội dung SVG** (Constitution II). Hệ quả được chấp nhận: gói có SVG độc không bị runtime từ chối; chặn ở Studio khi đóng gói (`E_SVG_UNSAFE`), ở trang khi dựng (allowlist) và bằng CSP của `/project/`.

## Hệ quả

- **Tốt:**
  - Nợ Constitution V được trả: allowlist, giới hạn, DOM đã parse, không regex; một bảng dùng chung cho trang, Studio, CLI, CI.
  - Phần mới của SVG hay của trình duyệt mặc nhiên bị loại cho tới khi được thêm có chủ ý.
  - File nhập không phụ thuộc `<style>` và `class`, nên không sai màu khi hai item đặt cạnh nhau (và Shadow DOM vẫn cách ly).
  - Nhập lại có thuật toán định lượng, đo được, "mơ hồ thì hỏi".
- **Xấu:**
  - Mã importer đáng kể (bộ phân tích CSS, đối chiếu, Tối ưu): thêm bề mặt lỗi; bù bằng test trước, fixture, bộ độc hại.
  - Allowlist có thể loại nhầm tính năng SVG hiếm gặp: báo cáo nói rõ; mở rộng bằng dữ liệu.
  - UID cho mọi phần tử phình file (≈ 28 byte/phần tử; 20.000 phần tử ≈ 560 KB).
  - Runtime không tự bảo vệ trước gói SVG độc (D30).
  - Chữ khung (`flowRoot`) mất xuống dòng khi chuyển.
- **Rủi ro:** (1) CSS cascade lệch làm sai màu (so ảnh trước/sau ≤ 0,5 %); (2) nhập lại gán sai (0 gán sai tự động trên bộ cặp, mơ hồ hỏi); (3) fixture Illustrator và CorelDRAW chỉ là mô phỏng (ghi rõ, thay bằng file thật khi có); (4) bộ ghi riêng có thể lệch Chrome ở trường hợp lạ (kiểm bằng so ảnh).

## Số đo / bằng chứng

**Đã đo ngày 2026-10-13 đến 2026-10-16 (các mục bên dưới và [008-acceptance.md](../reports/008-acceptance.md)); đoạn này giữ lại cơ sở ban đầu.** Bổ sung 2026-10-16: bộ độc hại nay **48 ca** (35 làm sạch, 13 từ chối, 0 `__pwned`, 0 yêu cầu mạng; canary bản gốc kích hoạt ở m01, m03, m04, m10, m21, m42), harness đường trang 64 ca, fuzz trang 6.000 ca (0 vi phạm); fuzz importer 10.000 ca trong 55 s (tìm và sửa 2 lỗi thật); rà soát bảo mật 0 Critical, 2 High đã sửa; UID giữ qua Nạp xuống, Đọc lên, So sánh (`008-uid-roundtrip-x64.json` 12/12 trên runtime x64). **Chưa đo:** BL335 (T123), SVG ≥ 1 MiB trên thiết bị (D31), file thật Illustrator và CorelDRAW (T120: 6 trong 10 fixture là mô phỏng). Cơ sở ban đầu: svg-load 19 file ≤ 554 ms trên Chrome 154 từ BL335; thí nghiệm svg-dialects (1,66 % điểm ảnh khác rõ giữa Inkscape và Chrome); phân tích file stress (87 % là `line`/`polygon` trong 2 nhóm). Sẽ ghi vào mục này khi làm: số 10 fixture (tỉ lệ khác ảnh), bộ độc hại (canary), Tối ưu trên file stress, bộ cặp nhập lại (ngưỡng cuối), thời gian nhập 20.000 phần tử.

**Spike T007 (2026-10-13, Chrome 155; [008-spike-optimize.md](../reports/008-spike-optimize.md)), mô phỏng Tối ưu trên `factory-isometric-stress.svg` (27.029 phần tử):**

- R5 nguyên văn ("không `id`") gộp 0 phần tử, vì Inkscape gán `id` cho mọi phần tử. **Quy tắc đã chỉnh:** `id` tự sinh (mẫu "không nghĩa" của R6, kể cả hậu tố `-<số>`) không bị tham chiếu thì bỏ cùng phần tử khi gộp; không gộp phần tử vừa có nền vừa có nét.
- Kết quả với quy tắc đã chỉnh: **27.029 → 10.446 phần tử** (1.015 nhóm gộp; điều kiện ≤ 20.000 **đạt**); ảnh khác **0,453 %** điểm ảnh (kênh lệch > 16/255; 1,379 % ở ngưỡng 0; 0,236 % ở ngưỡng 64; điều kiện ≤ 1 % **đạt**). Không có "giới hạn file stress cần sửa ngoài Studio".
- Kích thước: mỗi `data-mat-uid` thêm 29 byte; sau Tối ưu có UID và 237 `data-mat-name`: 2,71 MB (< 5 MiB); không Tối ưu: 4,14 MB. Giới hạn vi phạm của file stress là số phần tử, không phải byte.
- Còn chờ ghi: bộ cặp nhập lại (ngưỡng cuối), thời gian nhập 20.000 phần tử. (Bộ cặp nhập lại: xem mục "Nhập lại (T097-T100)" dưới đây.)

**Nhập lại (T097-T100, 2026-10-15; `tests/fixtures/svg-import/reimport/measure.mjs`, kết quả ở `docs/reports/008-fixtures.json` mục `reimport`):**

- **Bộ cặp:** 7 cặp, 284 phần tử bản mới có đáp án (215 phần tử có phần tử cũ tương ứng). Cặp 1-2 do **Inkscape 1.4.3 thật** (lưu lại giữ `data-*`; Plain SVG của 1.4.3 vẫn giữ `data-*` nên kịch bản bỏ nốt). Cặp 3 là **kịch bản biến đổi mô phỏng LibreOffice** (máy dev không có `soffice`: bỏ id và `data-*`, viewBox 1/100 mm, bọc chữ trong `g`, làm tròn); cặp 4-7 kịch bản biến đổi (dời và nhóm lại, đổi id + thêm 3 + xóa 2, lưới 12 ô giống hệt vẽ lại lệch nửa ô, hàng cách 40 px chèn một phần tử). Kết quả cho LibreOffice là "đạt trên mô phỏng".
- **Kết quả với ngưỡng cuối** (0,25 / 0,05 / 0,005 / 0,002 và `idAuto` 0,05): khớp đúng **210/215 = 97,7 %** (>= 90 %); **gán sai tự động 0**; 17 mục "cần chọn" (12 mục thật sự mơ hồ ở cặp 6 và 5 mục có ứng viên đúng trong danh sách: 3 ở cặp 4, 2 ở cặp 5); 12 mới (đúng đáp án); 4 mồ côi (đúng các phần tử đã xóa hoặc bỏ nhóm). Phân bố `D` của khớp đúng: bước 1 (UID) 32 ở < 0,0005, 4 ở [0,002; 0,005), 2 ở [0,02; 0,05); bước 2 38 ở < 0,0005; bước 3 77 ở < 0,0005, 3 ở [0,02; 0,05), 1 ở [0,0005; 0,002); bước 4 53 ở < 0,0005. Khớp sai: không có.
- **Hiệu chỉnh:** (1) theo chữ §7 gốc (`id` duy nhất, `D <= 0,25`) có **4 gán sai** ở cặp 5 (id tự sinh `rect123`/`text200` bị đánh số lại lệch +3 nên `id` mới chỉ phần tử khác, `D` = 0,163-0,166): thêm ngưỡng riêng **0,05** cho `id` tự sinh (0 sai, không mất khớp đúng). (2) Hàng giống nhau cách 40 px (< 5 % đường chéo) chèn một phần tử sẽ bị bước 3 gán lệch chỉ số nếu không kiểm đối thủ: thêm kiểm "không có phần tử chưa khớp nào gần hơn D + 0,002" ở hai phía; lưới 12 ô giống hệt nhờ đó ra "cần chọn" chứ không gán theo chỉ số. (3) Bước 4 bỏ điều kiện "chỉ một ứng viên `D <= 0,005`" (lưới dày 10 px trên 2.236 đường chéo có láng giềng ở 0,0045), thay bằng kiểm đối xứng và biên 0,002 hai phía.
- **Quét ngưỡng (một yếu tố mỗi lần, cùng bộ cặp):** `structure` 0,02: đúng 207, cần chọn 20; 0,1 và 0,25: như 0,05; `geometry` 0,002: như 0,005; 0,01: đúng 212; 0,02: đúng 215, cần chọn 12; `margin` 0,005: như 0,002; `uid` 0,1: như 0,25. **Không nới `geometry`** dù 0,02 đạt 215/215: bộ cặp chỉ có 5 ca "cần chọn có đáp án", dữ liệu quá ít để chứng minh 0,02 (khoảng 23 px trên viewBox 1000 x 600) không gán sai trên bản vẽ dày; giá của việc hỏi thấp, giá của gán sai cao (bất biến). Xem xét lại khi có file thật của khách hàng.
- **Hiệu năng:** đối chiếu 20.000 phần tử (lưới 200 x 100, mọi phần tử khớp) 0,9 s khi giữ thứ tự và 1,0 s khi đảo thứ tự (gồm phân tích hai tài liệu; Node 24, máy dev); lần đầu của bản chưa tối ưu quá 90 s vì quét cửa sổ rộng: đã sửa bằng cận hình học rẻ trước khi tính `D` và tìm ứng viên bằng bán kính tăng dần.

**Nghiệm thu importer (2026-10-15, Chrome 155, `importSvg` + `--optimize` mã sản phẩm; số thật ở `docs/reports/008-fixtures.json`, `008-malicious-x64.json`, `008-stress-x64.json`):**

- **10 fixture (T052)**, điểm ảnh khác = kênh lệch lớn nhất > 64/255, 1200 x 800, trừ vùng khai báo. Mọi fixture đạt ngưỡng ≤ 0,5 % so bản gốc; không phải chỉnh importer. Bản gốc vs bản đã nhập: inkscape-01 0,000 %; inkscape-02 0,000 %; inkscape-03 **0,496 %** (sát ngưỡng; ngoài vùng khai báo flowRoot); inkscape-04 0,000 %; illustrator-01 0,118 %; illustrator-02 0,000 %; illustrator-03 0,000 %; corel-01, 02, 03 đều 0,000 %. PNG Inkscape vs bản đã nhập (ngưỡng ≤ 3 %): 0,024 %; 0,441 %; 0,934 %; 0,001 %. Để so, ảnh Chrome của bản gốc vs PNG Inkscape: 0,024 %; 0,441 %; 0,439 %; 0,001 %, nên chênh còn lại chủ yếu do Chrome và Inkscape vẽ khác nhau (inkscape-03: importer tăng 0,439 lên 0,934 % do flowRoot chuyển thành chữ một dòng).
- **Giới hạn của kết quả:** bốn file Inkscape là thật (Inkscape 1.4.3). Sáu file Illustrator và CorelDRAW là **mô phỏng viết tay**: kết quả cho hai phần mềm này là "**đạt trên mô phỏng**", không phải trên file do phần mềm thật xuất (chờ T120).
- **Bộ độc hại (T053):** 39 ca (36 `.svg` và 3 sinh lúc chạy). Bản đã nhập, dựng hai cách (tài liệu SVG độc lập, và `innerHTML` rồi bắn sự kiện trên mọi phần tử): `__pwned` **0** ca, yêu cầu mạng ngoài **0**, mọi ca khớp `expect.json` và qua `assertAllowlisted`. Đối chứng bản gốc không lọc: canary kích hoạt ở **5** ca (m01, m03, m04, m10, m21) và Chrome xin tài nguyên ngoài ở 6 ca (m07, m08, m12, m25, m26, m37), nên canary và việc chặn/đếm mạng có hiệu lực.
- **File stress (T054):** `factory-isometric-stress.svg` không Tối ưu bị từ chối (`E_IMPORT_LIMIT`, 26.894 phần tử > 20.000); với `--optimize` còn **10.307** phần tử (27.029 thô, gộp 1.020 nhóm), 2,47 MB, ảnh khác **0,463 %** (kênh lệch > 16/255; 0,220 % ở ngưỡng 64; 1,316 % ở ngưỡng 0), ≤ 1 % đạt. Khớp spike T007 (10.446 phần tử, 0,453 %). Không cần ghi giới hạn "sửa ngoài Studio".

## Điều kiện xem xét lại

- Nhập lại cho kết quả gán sai tự động ở bất kỳ ca nào: siết ngưỡng hoặc bỏ bước 4.
- File thật của khách hàng (Illustrator, CorelDRAW, Visio, AutoCAD) bị loại nhầm nhiều: mở rộng bảng, ghi vào báo cáo; xem xét nhận thêm phần tử.
- Cần ghép nhiều SVG vào một item: thêm tiền tố `id` (khuyến nghị 4 của svg-dialects).
- Giới hạn 20.000 phần tử làm loại file hợp lệ của khách: xem lại cùng số đo Chrome yếu.
- Runtime C++ cần từ chối SVG độc: thêm bộ kiểm byte ở C++ (cần ADR vì trái "không parse SVG").
