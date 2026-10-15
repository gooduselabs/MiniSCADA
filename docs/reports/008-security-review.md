# Rà soát bảo mật feature 008 (nhập SVG và gắn Tag): T112

Ngày: 2026-10-15. Phạm vi: FR-064, Constitution V, research R21, ADR-023 đến ADR-025. Phương pháp: đọc mã, chạy lại bộ độc hại, viết thêm ca tấn công và đột biến, đo thời gian trong Chrome thật, sửa trực tiếp mọi phát hiện High (test đỏ trước, xanh sau).

## 1. Tóm tắt

| Mức | Số | Đã sửa | Còn lại |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 2 | 2 | 0 |
| Medium | 4 | 2 | 2 |
| Low | 9 | 0 | 9 |
| Info | 4 | n/a | n/a |

Kết luận: **không có đường chạy mã hay kéo tài nguyên ngoài qua allowlist** (bộ độc hại 48 ca, harness đường trang 64 ca, fuzz trang 6.000 ca đột biến với 937 ca parse được: 0 vi phạm, 0 `__pwned`, 0 yêu cầu mạng). Lỗ hổng thật nằm ở **từ chối dịch vụ** (treo Studio hoặc trang vận hành), cả hai mức High đã sửa. Được phép phát hành runtime 0.7.0 sang bước T121 sau khi người dùng xem hai mục Medium còn lại.

## 2. Bảng phát hiện

| # | Mức | Vị trí | Mô tả | Cách tái hiện | Sửa | Trạng thái |
|---|---|---|---|---|---|---|
| F1 | High | `packages/svg-renderer/src/inspect.ts` (`hasDoctypeEntity`, trước đây regex `/<!DOCTYPE[^>]*\[[\s\S]*?<!ENTITY/i`) | ReDoS bậc ba trên đầu vào thô, chạy ở **mọi** lần nhập (bước nhận diện phần mềm, sau tiền xử lý) | file 55 KB: `<text><![CDATA[` + `<!DOCTYPE [` x 5.000 + `]]></text>` : `importSvg` mất **77 giây**, 10.000 lần không xong; 5 MiB treo vô hạn Worker của Studio | bộ quét tuyến tính con trỏ chỉ tiến; test `inspect.test.ts` "chống ReDoS" (200.000 lần < 2 s); ca `m39` | Đã sửa (7074aa2) |
| F2 | High | `packages/svg-renderer/src/mount.ts`, `packages/project-schema/src/rules-04-svg.ts`, `packages/svg-import/src/usecount.ts` | Bom `use` làm **treo tab** trang vận hành, và bộ đếm của bộ nhập có ba khe hở. (a) Trang và bộ kiểm project không có giới hạn `use` (gói sửa tay: D30). (b) `countEffective` chỉ đếm `use` ngoài `defs`, trong khi Chrome dựng bóng cho **mọi** `use` (kể cả không ai dùng, trong `pattern`, `symbol`). (c) Không giới hạn độ sâu chuỗi `use`: chuỗi 500 `use` (2.000 phần tử, qua mọi giới hạn cũ) mất 12 giây, 1.000 trở lên treo hẳn; bản đã nhập vẫn bị | `m17` thô vào `mountScreen` trong Chrome: treo; `m46` (chuỗi 500): importer cũ trả `ok:true`, Chrome treo; `m47` (bom bọc trong `pattern` + `fill`): lọt bộ đếm cũ | `usecount.ts` chuyển sang `@mat/svg-renderer`, thêm `work` (E của gốc, mọi `use`), `depth` (chuỗi dài nhất), vòng không còn dừng đo (thêm một vòng vô hại vào bom từng qua mặt được); ngưỡng `MAX_USE_EXPANSION` 100.000, `MAX_USE_WORK` 300.000, `MAX_USE_DEPTH` 32; `mountScreen` ném lỗi, validator `E_SVG_LIMIT`, importer `E_IMPORT_USE_BOMB`; test `mount.test.ts`, `usecount.test.ts`, `dos-limits.test.ts`, `rules-04-svg.test.ts`; ca `m45`–`m47`, `p16`–`p19` | Đã sửa (c7fa498 và commit kế) |
| F3 | Medium | `packages/svg-import/src/css.ts` `applyCss` | Bậc hai luật `*{…}` x phần tử | 19.000 luật x 19.000 phần tử (1 MB): 26 giây; file 5 MiB có thể vài phút (hủy được vì Worker) | `cssWorkCap` 30 triệu cặp -> `E_IMPORT_LIMIT`; bỏ `push(...mảng)` (tràn ngăn xếp trong trình duyệt) | Đã sửa |
| F4 | Medium | `packages/svg-import/src/match.ts` `BoxIndex.query` | Đối chiếu nhập lại bậc hai khi nhiều hình trùng vị trí (vi phạm SC-009 với đầu vào xấu) | 6.000 hình `rect` trùng nhau: 31 giây; 20.000: khoảng 6 phút | đồng hồ công việc (`workCap` 500 triệu đơn vị) -> `MatchLimitError` -> `E_IMPORT_LIMIT`; lưới 20.000 và "đổi toàn bộ sang circle" dùng dưới 40% ngưỡng | Đã sửa |
| F5 | Medium | `packages/ui-components/src/control/svg-action-controller.ts:44`, hợp đồng svg-events §2 | `minRole: engineer/administrator` của sự kiện chỉ là **khóa giao diện**; máy chủ chỉ đòi `operator`. Người vận hành gọi thẳng API ghi vẫn ghi được Tag đó (có audit, CSRF, giới hạn) | tài khoản operator `POST` ghi Tag của một sự kiện `minRole: engineer` | Nêu rõ trong inspector "Sự kiện" và tài liệu rằng `minRole` không phải phân quyền; về sau thêm `writeMinRole` theo Tag và máy chủ kiểm | Còn lại (thiết kế của 007) |
| F6 | Medium | `server/` (D30), `core/project-manager` | Runtime C++ không parse SVG nên không từ chối được gói có SVG độc; XSS (nếu có) chạy dưới quyền operator đang đăng nhập | sửa tay `.svg` trong gói rồi nạp bằng công cụ khác Studio | Lớp phòng thủ đã có: allowlist ở `mountScreen` (nay thêm giới hạn `use`), CSP `kCspProject` (sandbox, không script) và CSP trang; kiểm chứng bằng harness đường trang | Giới hạn đã chấp nhận (D30) |
| F7 | Low | `packages/svg-renderer/src/css-value.ts` `parseDataImage` | Chỉ kiểm chữ ký và byte, không kiểm số điểm ảnh: PNG 20.000 x 20.000 xám nén còn 389 KB lọt (R21 ghi "ảnh khổng lồ" đã giảm thiểu) | `p12`, bản 20.000² : Chrome vẫn dựng trong 20 giây, chưa thấy treo; bộ nhớ chưa đo | đọc IHDR/GIF/VP8X, từ chối > 16 triệu điểm ảnh | Còn lại |
| F8 | Low | `packages/svg-renderer/src/sanitize.ts` (`removedElements = {}`) | Khóa là tên phần tử từ file: `__proto__` mất khỏi danh sách, `constructor` thành chuỗi (báo cáo, không ô nhiễm prototype; đã thử) | `<__proto__/>`, `<constructor/>` | dùng `Map` hoặc `Object.create(null)` | Còn lại |
| F9 | Low | `packages/svg-import/src/match.ts` bước 1 | UID giả trong file nhập lại **không** được giữ (`assignUids` xóa hết, `retagUids` chỉ ghi cặp đã khớp), nhưng bước 1 nhận cặp tự động khi cùng thẻ và D <= 0,25 đường chéo: hình lệch 30 px vẫn nhận UID của nút có binding/sự kiện | kiểm `reimp.mjs`: UID lạ ở xa (D 0,6) bị bỏ, ở gần (D 0,13) được nhận; UID trùng hai phần tử bị bỏ cả hai | yêu cầu xác nhận khi bước 1 có D > 0,05 hoặc phần tử có sự kiện ghi | Còn lại |
| F10 | Low | `packages/binding-engine/src/transforms.ts:15` `COLOR` | Regex trong hàm quyết định màu áp lên `fill`/`stroke` (`^(#hex|[a-zA-Z]{3,20})$`): không có `url(` hay `(` nên an toàn, nhưng nhận từ khóa lạ (`inherit`, `initial`) và ngược lệ "không regex" của FR-013 (test chỉ quét svg-renderer) | giá trị bảng màu `initial` | dùng `isColor` của svg-renderer; mở rộng `no-regex.test.ts` sang binding-engine | Còn lại |
| F11 | Low | `apps/studio/src/model/svg-upgrade.ts` | Nâng cấp 0.1–0.3: file mà `sanitizeSvg` không báo gì thì giữ nguyên từng byte, kể cả `DOCTYPE`/PI/bình luận (không có trong báo cáo của bộ lọc) | project 0.3 có SVG với `<!DOCTYPE … <!ATTLIST rect onclick …>` | luôn ghi lại bằng bộ ghi tất định, hoặc từ chối `DOCTYPE` ở `parseSvg` | Còn lại (trang vẫn lọc: `p03` đạt) |
| F12 | Low | `packages/svg-renderer/src/sanitize.ts` `parseSvg` | Trang đưa chuỗi có `DOCTYPE` thẳng cho DOMParser; Chrome tự chặn bom entity (`m14` lỗi parse) và ATTLIST mặc định được bộ lọc xóa, nhưng không có chốt chủ động | `m42` bản gốc đặt canary `p03b` (ATTLIST `onclick`); bản trang sạch | từ chối khi chuỗi chứa `<!DOCTYPE`/`<!ENTITY` (bản đã nhập không bao giờ có) | Còn lại |
| F13 | Low | `packages/svg-import/src/name.ts` `cleanName`, `css-value.ts` `isName` | Ký tự điều khiển hai chiều (U+202A–202E, U+2066–2069, U+200B–200F) không bị bỏ khỏi `data-mat-name`, `title`: đánh lừa hiển thị trong danh sách Studio ("Trojan Source") | `inkscape:label="‮evlis"` | bỏ các điểm mã trên | Còn lại |
| F14 | Low | `packages/binding-engine/src/applier.ts:354` | Id clipPath `mat-clip-<uid>` do mã sinh có thể đụng id do SVG tự khai: phần tử sinh trước trong tài liệu thắng, đổi hiển thị mức (toàn vẹn hiển thị, không leo quyền) | SVG có `<clipPath id="mat-clip-el_x">` | kiểm id trùng khi nhập (bỏ id bắt đầu `mat-`) | Còn lại |
| F15 | Low | `apps/studio/src-tauri/src/csv.rs` `csv_save` | `text` không giới hạn kích thước; nội dung do giao diện chọn nên XSS trong WebView có thể ghi nội dung tùy ý vào đường dẫn do **người dùng** chọn ở hộp thoại; CSV không chống công thức (`=`, `+`, `-`, `@`) (006) | bảng Tag có tên `=HYPERLINK(…)` | trần `text` (ví dụ 32 MiB), tiền tố `'` cho ô bắt đầu bằng ký tự công thức | Còn lại |
| F16 | Low | `tools/svg-fixtures/make-malicious.mjs` | Bộ sinh tất định chỉ biết `m01`–`m38`; `m39`–`m47` viết tay (`--check` không phủ) | `make-malicious.mjs --check` báo 39 ca | đưa 9 ca mới vào bộ sinh | Còn lại |
| F17 | Info | `apps/studio/src-tauri` | Mọi lệnh ứng dụng (`device_post`, `project_remove`, `device_deploy`) mở cho cửa sổ chính; XSS trong WebView có bán kính lớn hơn trang vận hành. Giảm nhẹ: CSP chặt (`connect-src` chỉ IPC, `freezePrototype`), `capabilities/default.json` tối thiểu, bộ lọc chung cho Studio và trang | | | Ghi nhận |
| F18 | Info | `apps/runtime-web/src/lab.ts` | Dùng `sanitizeSvg` nhưng không `mountScreen` (không giới hạn `use`); không vào gói thiết bị (`package-web.mjs` kiểm) | | | Ghi nhận |
| F19 | Info | `tools/svg-import/cli.test.mjs` | Thất bại có sẵn: thư mục `reimport/` (T097) làm CLI báo 24 file thay vì 10 | `node --test tools/svg-import/cli.test.mjs` | sửa kỳ vọng hoặc bỏ qua `reimport/` | Không thuộc T112 |
| F20 | Info | `packages/project-schema` vectors | Test `vectors-02` đôi khi lỗi `ENOENT tests/project-vectors/out/…` khi chạy song song (đua ghi thư mục `out`); chạy riêng thì xanh | `npx vitest run` trong gói | tách thư mục `out` theo tiến trình | Không thuộc T112 |

## 3. Kết quả theo hạng mục yêu cầu

- **Allowlist (phần tử, thuộc tính, CSS, URL):** tra bảng, so khớp chính xác `localName` + namespace SVG, `xlink:href` chuẩn hóa, mọi thuộc tính có namespace khác bị bỏ, `style` qua bộ tách từ vựng, `url()` chỉ `#id`, `href` chỉ `#id` hoặc `data:image/(png|jpeg|gif|webp)` có chữ ký. Không có `position`, `z-index`, `pointer-events`, `cursor`, `content`, `behavior`, `-moz-binding` trong `CSS_PROPS`. Thử viết hoa tên thuộc tính, tiền tố namespace, `style` độc, `feImage`, SMIL, `foreignObject`: bị loại. Fuzz vi sai trong Chrome (rolldown gói `svg-renderer`, `tools/svg-import/page-fuzz.mjs`): 6.000 ca, 937 parse được, 0 vi phạm.
- **DTD/entity và bom:** `prescan` từ chối mọi thực thể ngoài bảng Adobe, bỏ DOCTYPE trước khi parse (ATTLIST/ELEMENT vô hại vì DTD bị bỏ; xác nhận `m42`). Bom `use` xem F2; `filter` 8/64, `stdDeviation` kẹp 30, ảnh 16 và 2 MiB, độ sâu 32, thô 100.000 đều có test biên. Các thuộc tính hợp lệ nhưng nặng (stroke-dasharray 0,0001, pattern 0,0001, vùng filter 2e9, 3.000 phần tử blur, vòng mask/pattern/gradient, chuỗi `href` 15.000, lồng 3.000 tầng, PNG 60.000²) Chrome xử lý không treo (`p06`–`p15`).
- **mXSS và CDATA:** trang dùng DOMParser XML + `importNode` (không tuần tự hóa HTML); bộ ghi riêng thoát `& < >` và `"`, tab, xuống dòng trong thuộc tính, và đổi CDATA thành chữ thoát; harness "inline" (đưa vào `innerHTML` của trang HTML rồi bắn sự kiện) đạt 0 `__pwned`.
- **Shadow DOM và id:** mỗi màn hình có ShadowRoot riêng; id `__proto__`, `constructor`, `document`, `host`, `elements` không gây ô nhiễm hay đè (`m43`, `p05`, kiểm `reimp.mjs` đối chiếu lại với id đó). `url(#id)` chỉ trong cây của chính màn hình. Tìm phần tử theo UID dùng allowlist ký tự (`findByUid`, `UID_SAFE`), không dựng bộ chọn từ chuỗi lạ. Xem F14.
- **UID giả mạo khi nhập lại:** xem F9. Bất biến "0 gán sai tự động" giữ ở bước 2–4; `applyMatch` từ chối lựa chọn ngoài ứng viên hoặc trùng UID đã dùng.
- **Sự kiện SVG và đường ghi Tag:** không thêm đường ghi: `svgActionController` dựng `WidgetItem` nút rồi dùng `ControlController` của 007 (khóa, xác nhận, "đang gửi", `context.widget` = `elementUid`). `confirm: none` chỉ hiệu lực với Tag BOOL; `minRole` do validator TS và C++ giới hạn `operator|engineer|administrator`; giá trị kiểm kiểu và `limits`; `pulse` 100–10.000 ms. SVG không thể tạo sự kiện (sự kiện nằm trong binding JSON). Phần tử ẩn không nhấp; hộp xác nhận nằm ở lớp ngoài Shadow DOM, SVG không có `position`/`z-index` nên không che được. 30 ca tấn công của 007 chạy lại với lệnh từ phần tử SVG: `docs/reports/008-svg-events-x64.json` (76 kiểm tra, `pass: true`; do agent web-it chạy). Xem F5.
- **Rust `svg.rs` và `csv_save`:** `svg_open` chỉ qua hộp thoại hệ thống, đuôi `.svg` kiểm trước khi mở, đọc `take(5 MiB + 65)` nên không đọc quá, trả tên không đường dẫn. `csv_save`: đuôi chỉ `csv|json|md` (khác rơi về `csv`), tên gợi ý bỏ `/ \ :` và ký tự điều khiển. Xem F15.
- **Lộ thông tin trong báo cáo:** báo cáo chỉ có tên thẻ/thuộc tính, mã, đường dẫn phần tử, tên file (không thư mục), SHA-256; metadata (`metadata`, `sodipodi:docname`, đường dẫn xuất) bị bỏ và chỉ hiện tên thuộc tính. Bản `.md` thoát `|` và xuống dòng nhưng không thoát Markdown (Info).
- **Nâng cấp 0.1–0.3 -> 0.4:** xem F11.
- **Validator TS/C++:** C++ không parse SVG (Constitution II) nhưng kiểm đường dẫn an toàn, tồn tại file và toàn bộ luật sự kiện (`E_EVENT_*`: Tag RW thật, BOOL cho toggle/pulse, giá trị trong limits, đích màn hình/popup). TS thêm `E_SVG_UNSAFE`, `E_SVG_LIMIT` (nay gồm giới hạn `use`).
- **Clickjacking (giữ):** CSP `frame-ancestors 'none'` ở trang và `/login` (A30 đạt), `/project/*` có CSP `sandbox` + `default-src 'none'` + `nosniff`.
- **Regex còn sót:** không có trong `svg-renderer` (trừ `inspect.ts`, chỉ báo cáo, đã kiểm tuyến tính) và toàn bộ `svg-import` (test mới quét mọi file). Còn `COLOR` ở binding-engine (F10).
- **innerHTML/eval:** không có trong mã nguồn (lint cấm; gói thiết bị được `package-web.mjs` kiểm, ngoại lệ duy nhất là `<template>` của Lit).

## 4. Giới hạn còn lại

1. **D30:** runtime C++ không từ chối gói có SVG độc; lớp phòng thủ là allowlist ở trang và CSP.
2. **XSS (nếu có) chạy dưới quyền operator đang đăng nhập** và, ở Studio, qua IPC Tauri (F17).
3. `minRole` của sự kiện chỉ là khóa giao diện (F5).
4. Thuộc tính hợp lệ nhưng nặng có thể làm chậm máy khách yếu; không có đồng hồ thời gian dựng.
5. Ảnh nhúng không giới hạn điểm ảnh (F7).
6. Trang không chặn `DOCTYPE` chủ động (F12).

## 5. Điểm làm tốt

Allowlist tra bảng và quét mã bằng test cấu trúc; bộ ghi tất định; UID nguồn luôn bị bỏ rồi gán lại bằng bộ sinh mật mã; CSP ba lớp (trang, project, Studio); `svg_open` không nhận đường dẫn từ giao diện; xác nhận mặc định cho mọi ghi từ SVG; harness có canary đối chứng (6 ca bản gốc kích hoạt, chứng minh bộ thử có hiệu lực).

## 6. Công cụ và bằng chứng mới

- `tools/svg-import/page-path-harness.mjs`: SVG gốc vào `mountScreen` trong Chrome, canary + mạng + kiểm allowlist trên DOM thật, phát hiện treo (20 giây). `docs/reports/008-page-path-x64.json` (64 ca, đạt).
- `tools/svg-import/page-fuzz.mjs`: fuzz vi sai đường trang. `docs/reports/008-page-fuzz-x64.json`.
- Bộ độc hại 48 ca (`m39`–`m47` mới; cờ `skipOriginal` cho ca mà bản gốc treo Chrome): `docs/reports/008-malicious-x64.json`. Ca đường trang: `tests/fixtures/svg-import/malicious/page-path/` (`p01`–`p19`).
- Test mới: `inspect.test.ts` (ReDoS), `usecount.test.ts`, `mount.test.ts`, `dos-limits.test.ts`, `rules-04-svg.test.ts`, `no-regex.test.ts` (toàn `svg-import`).
- Fuzz importer có sẵn (`fuzz.mjs`) thêm 5.500 ca seed 7712 và 42: 0 lỗi.
