# Báo cáo nghiệm thu feature 008 (nhập SVG, gắn Tag, animation, sự kiện): T128

Ngày: 2026-10-16. Nhánh: `worktree-agent-aa7c17c845679c8f6`. Báo cáo này **tổng hợp** số đo đã có ở `docs/reports/008-*.{json,md}`, ghi chú "Ghi chú khi làm" trong `specs/008-svg-import-binding/tasks.md` và mục "Số đo / bằng chứng" của ADR 023 đến 026. Lượt viết báo cáo **không chạy thêm phép đo, build, ctest hay e2e nào**.

## 0. Nói thật trước (Constitution VI)

1. **`ci-local.ps1` đầy đủ và ctest đầy đủ CHƯA chạy ở nhánh này.** Phiên chính chạy một lượt sau khi gộp. Ở nhánh này chỉ có test nhắm đích (Vitest từng package, e2e từng bộ, kịch bản `web-it` x64, `fuzz`, harness độc hại). Mọi checkpoint (T032, T062, T078, T086, T096, T104, T111) vì vậy là **tổng hợp trong báo cáo này**, không phải kết quả `ci-local`.
2. **Mọi số "x64" là loopback trên máy dev** (Windows, runtime x64 trong Docker, Chrome 155). Chúng chứng minh logic và không hồi quy so với 007; **không thay số BL335**. Chưa có số nào đo trên thiết bị.
3. **6 trong 10 fixture là mô phỏng** (Illustrator, CorelDRAW): kết quả ghi "đạt trên mô phỏng". SC-001 **không** được tuyên bố đầy đủ cho hai phần mềm này (T120).
4. Chưa có người thử tay: NVDA (T114), bộ gõ Telex/Unikey, Chrome thật ≥ 120 và WebView2 thật (T127), SC-020 (T131).

## 1. Trình duyệt đã thử

| Trình duyệt | Dùng cho |
|---|---|
| Chrome 155.0.8059.40 headless (puppeteer-core, Windows x64) | spike T006 (`008-spike-chrome.json`), 2 lần đo `-Scenario svg`/`compat` |
| Chrome 155.0.8059.41 | bộ độc hại, `page-path`, fixture, stress, e2e Studio và trang, `svg-events`, `open`, `f5x10`, `load`, `anim` |

**Chưa thử:** Chrome 120 (mức tối thiểu của spec), Chrome trên máy văn phòng yếu, WebView2 thật của bản cài Studio, Firefox/Safari (ngoài phạm vi). Ngưỡng `W_ANIM_MANY` 64 (D34) giữ đến khi có số đo trên máy yếu.

## 2. Bảng số đo từng SC

Chú giải: **Đạt** (có số đo hoặc test xanh trong cây này), **Đạt (x64)** (đạt trên runtime x64 loopback, BL335 chưa đo), **Một phần**, **Chưa đo**. "R" = đã chạy lại ở lượt viết fr-matrix 2026-10-15; "G" = theo ghi chú task, chưa chạy lại ở nhánh này.

| SC | Yêu cầu | Số đo / bằng chứng | Kết luận |
|---|---|---|---|
| SC-001 | 10/10 fixture nhập và hiển thị | `008-fixtures.json`: 10/10 ngay lần đầu, không phải chỉnh importer | **Một phần:** 4 thật (Inkscape 1.4.3) + 6 mô phỏng; file thật Illustrator, CorelDRAW chưa có (T120) |
| SC-002 | ảnh khác ≤ 0,5 % | 0,000 % (7 file), inkscape-03 **0,496 %** (sát ngưỡng), illustrator-01 0,118 %; PNG Inkscape ≤ 0,934 % (ngưỡng 3 %); stress 0,463 % | Đạt; 6 file là mô phỏng |
| SC-003 | ≥ 24 ca độc hại bị loại | bộ độc hại **48 ca** (35 làm sạch, 13 từ chối): `__pwned` 0, yêu cầu mạng ngoài 0, 0 lệch `expect.json`; harness đường trang **64 ca** 0 vi phạm; fuzz trang 6.000 ca (937 parse được) 0 vi phạm | Đạt |
| SC-004 | dựng lại bồn nước + motor, 0 dòng JSON | `rebuild-tank.e2e.mjs` 10/10, **32 thao tác** của người dùng; `008-compare-tank-x64.json` 10/10: cả `tank-demo` gốc và bản dựng lại có đủ 5 phần tử đích, mức khớp chữ mức 12/12 lần lấy mẫu, chữ là số 12/12, motor quay đúng khi tốc độ khác 0 12/12 | Đạt (x64). Chưa so "nhấp bơm có xác nhận" ở bản dựng lại (đã có ở SC-013) |
| SC-005 | mở màn hình chuẩn 3b ≤ 2 s; 10 F5 ≤ 5 s; 40 item `svg` ≤ 2 s | x64 (`008-open-x64.json`, 6 lần, cache trống): màn hình 3b (3.013 phần tử, 30 binding, 5 sự kiện, 100 Tag) trung vị **223 ms**, chậm nhất 238 ms; 40 item `svg` trung vị **798 ms**, chậm nhất 887 ms. `008-f5x10-x64.json`: 3 vòng x 10 phiên, chậm nhất 703/647/652 ms | Đạt (x64). **BL335 chưa đo** (T123); SVG ≥ 1 MiB (D31) chưa đo riêng |
| SC-006 | DOM Studio = Chrome | `008-svg-x64.json` (12/12): DOM và kiểu hiển thị giống bản xem trước ở **78/78 phần tử** (bỏ 32 phần tử gắn Tag đổi theo đồng hồ); 14 loại đích kiểm; 12/12 đích của Tag trạng thái đổi | Đạt (x64) |
| SC-007 | 30 phút, 10 client, 500 Tag: CPU ≤ 30 %, RSS ≤ 150 MB, 0 mất sequence | x64 (`008-load-x64.json`, 1.800 s): 10 trang, 473 Tag trên màn hình, 509 Tag mô phỏng, 72.066 delta, **0 mất sequence**, 0 đóng kết nối; `mat-runtime` CPU trung bình **2 %** một lõi, RSS **18,6 → 18,7 MB** | Đạt (x64). **BL335 chưa đo** (T124); ghi eMMC do audit chưa đo |
| SC-008 | 100 hoạt ảnh, p95 khung ≤ 8 ms, +≤ 50 MB | `008-anim-x64.json`, 30 phút thật: 180.016 khung, p50 1,1 ms, **p95 2,2 ms**, p99 3,2 ms; heap sau GC 1,9 → 1,8 MB (**-0,05 MB**); tab ẩn 0 callback rAF, 100/100 hoạt ảnh `paused` | Đạt. Giới hạn: heap JS (không phải RSS), khung = proxy luồng chính, máy dev 100 Hz |
| SC-009 | nhập lại: 0 gán sai, ≥ 90 % đúng | `008-fixtures.json` mục `reimport`: **210/215 = 97,7 %**, **0 gán sai**, 17 cần chọn, 12 mới, 4 mồ côi; 7 cặp (2 do Inkscape 1.4.3 thật, 1 mô phỏng LibreOffice, 4 kịch bản biến đổi). `008-uid-roundtrip-x64.json` 12/12: Nạp xuống rồi Đọc lên, So sánh "giống", UID giữ (svg-demo 32 kiểm, màn hình chuẩn 3b 6 kiểm) | Đạt. Tập đo nhỏ (215 phần tử); lưới giống hệt ra "cần chọn", không gán |
| SC-010 | ca biên giới hạn | `fx/limits.test.mjs`, `si/import.test.ts` | Đạt (R) |
| SC-011 | không hồi quy 0.1 đến 0.3 | `008-compat-x64.json` 30/30: tank-demo (ảnh lệch 0,0001 %), modbus-demo (0 %), dashboard-demo (0,293 %, do widget số đọc, không do SVG); ngưỡng 0,5 %; bản nâng cấp 0.4 cho cùng DOM (866/866 và 245/245 byte) | Đạt (x64), xem mục 6 về `el_motor_fan` |
| SC-012 | vector hai bản ≥ 100 ca | TS `vectors-04.test.ts` (R); C++ `vectors_04_test` 354/354 (G) | Đạt; C++ chưa chạy lại ở nhánh này (ctest đầy đủ chờ phiên chính) |
| SC-013 | ca khóa, 30 ca tấn công của 007 | `008-svg-events-x64.json` **76/76**: nhấp phần tử → hộp xác nhận → đúng 1 lệnh FC5 → `CONFIRMED` sau 463 ms; audit `channel` = `web`, `context.widget` = `elementUid`; xung 1 rồi 0 (2 lệnh FC5); **tấn công A1-A30 100 % bị từ chối, 0 lệnh tới giả lập**; khóa quan sát được 9/13 mã | Đạt (x64). **Không phải 13/13 trên thiết bị:** 4 mã (TAG_UNKNOWN, TAG_READONLY, NO_VALUE, PROJECT_CHANGING) không tới được trên x64, chỉ có test đơn vị |
| SC-014 | hợp biến đổi, hình học | `be/anim/transform-state.test.ts`, `clip-level.test.ts`, `E-R/anim.e2e.mjs`; quay trên phần tử có `transform` gốc: tâm hộp bao trôi 0 px (`008-svg-x64.json`) | Đạt |
| SC-015 | trợ năng, bàn phím | `008-a11y.md`: axe 0 critical/serious hai theme ở mọi trạng thái đã đo; 2 lỗi thật tìm thấy và sửa (F2 focus, lời nhắc nhấp nháy) | **Một phần:** NVDA chờ người (T127); chưa có e2e cho Enter trên thẻ ký hiệu Toolbox, F2 từ canvas, bước "đang xử lý" của Nhập SVG, menu ngữ cảnh "Nhập lại SVG…" |
| SC-016 | không hồi quy 004 đến 007 | Vitest các package xanh (R, xem fr-matrix); compat x64 30/30; `regress-sprint0.mjs` 19 file Sprint 0 (G) | **Một phần:** `ci-local.ps1` đầy đủ chưa chạy ở nhánh này |
| SC-017 | ký hiệu: 12/12 qua allowlist, UID, điểm gắn | `sym/tests/symbols.test.ts` 183 test, `E-S/symbols.e2e.mjs` | Đạt (R). Toolbox chưa hiện nguồn gốc và giấy phép từng ký hiệu (A6 của fr-matrix) |
| SC-018 | 20.000 phần tử: nhập ≤ 5 s, cây ≤ 300 ms, chọn ≤ 50 ms, thử ≤ 100 ms, hoàn tác ≤ 100 ms | `008-studio-perf.json` (máy dev, 12 lõi): nhập **1.239 ms**, cây **8,1 ms**, chọn **11,1 ms**, thử giá trị **4 ms**, hoàn tác **33,5 ms**; đối chiếu nhập lại 20.000 phần tử 0,9 s (giữ thứ tự) / 1,0 s (đảo) | Đạt |
| SC-019 | khớp mockup, quy tắc §5 và §7 | `008-sc019.md`: **chưa 100 %**; 12 ô "một phần"; phần vá A1 (nút/menu Nhập SVG) và A2 (tên thuộc tính, vị trí ví dụ trong báo cáo nhập) đã vá 2026-10-15; còn: nền ô xem trước ký hiệu `#eceff1` cứng, chữ phụ 10,5 và 11 px (< 12 px) | **Một phần** |
| SC-020 | kỹ sư mới làm trọn ≤ 20 phút | chưa có người thử | **Chưa đo** (T131) |
| SC-021 | không `eval`, `innerHTML`, `new Function` | `sr/no-regex.test.ts`, lint, `008-bundle-x64.json`: không `eval`/`new Function`/`innerHTML` ngoài 1 chỗ `<template>` của Lit | Đạt |
| SC-022 | khởi động ≤ 250 KB gzip, không có `@mat/svg-import` | `008-bundle-x64.json` 3/3: JS+CSS khởi động **82,4 KB gzip** (007: 68,4 KB), 0 vết importer; `package-web.mjs` chặn `E_IMPORT_`, `importSvg`… và phụ thuộc | Đạt |

## 3. Nền chung (Phase 2, T032)

- Định dạng 0.4.0, nâng cấp 0.3 → 0.4 chỉ đổi số phiên bản, allowlist một bộ cho Studio và trang, bộ kiểm TS và C++ cùng kết luận trên vector `v04-*` (341 thư mục, 354 ca C++ theo ghi chú).
- Allowlist qua 19 file Sprint 0: `tools/svg-import/regress-sprint0.mjs` (G).
- Vitest (R, 2026-10-15): Studio 2.071, `@mat/ui-components` 466, `@mat/svg-import` 232, `@mat/svg-renderer` 507, `@mat/symbols` 183, `@mat/binding-engine` 98; ghi chú T118 sau đó: Studio 2.074, svg-import 241, svg-renderer 529.
- **Chưa chạy ở nhánh này:** ctest đầy đủ, `ci-local.ps1`, `ci-local.ps1 -Full`. Đây là việc của phiên chính sau khi gộp.

## 4. Theo user story (checkpoint)

**US1 (T062): nhập SVG.** SC-001/002/003/010/018/021 như bảng trên. Importer sửa 2 lỗi thật do fuzz tìm ra (ReDoS `classConflicts`: 100 KB mất 5,9 s; nút chữ liền kề gộp > 4.096 ký tự); fuzz 10.000 ca trong **55 s** (`008-fuzz-x64.json`, ngân sách 180 s), 0 ném lỗi, 0 lọt allowlist. Chưa chạy bản dài 1 giờ.

**US2 (T078): gắn Tag.** SC-006 (phần Studio), SC-014, SC-018, SC-015 (phần inspector) như trên. 13 mục động hóa, Thử giá trị 4 ms.

**US3 (T086): sự kiện.** SC-013 như trên (76/76 trên runtime x64 thật). Còn lại: `minRole` của sự kiện chỉ khóa giao diện, máy chủ chỉ đòi `operator` (F5 của rà soát bảo mật, giới hạn mục 7).

**US4 (T096): ký hiệu và dựng lại tank-demo.** SC-004 (32 thao tác, 10/10 và so x64 10/10), SC-017, một phần SC-005 (40 item `svg`: 798 ms x64).

**US5 (T104): nhập lại giữ UID.** SC-009: 210/215, 0 gán sai; UID giữ qua Nạp xuống, Đọc lên, So sánh (12/12 x64).

**US6 (T111): tương thích và tải.** SC-005/007 (x64), SC-006, SC-008, SC-011, SC-016 (một phần), SC-022. **Mục BL335 ghi "chưa đo"** (T123, T124).

## 5. Mười fixture

| # | Fixture | Nguồn | Ảnh khác (gốc vs đã nhập) |
|---|---|---|---|
| 1 | inkscape-01 | **thật** (Inkscape 1.4.3) | 0,000 % |
| 2 | inkscape-02 | **thật** | 0,000 % |
| 3 | inkscape-03 | **thật** | **0,496 %** (sát ngưỡng; flowRoot thành chữ một dòng) |
| 4 | inkscape-04 | **thật** | 0,000 % |
| 5 | illustrator-01 | **mô phỏng** viết tay | 0,118 % |
| 6 | illustrator-02 | mô phỏng | 0,000 % |
| 7 | illustrator-03 | mô phỏng | 0,000 % |
| 8 | corel-01 | mô phỏng | 0,000 % |
| 9 | corel-02 | mô phỏng | 0,000 % |
| 10 | corel-03 | mô phỏng | 0,000 % |

Ngưỡng 0,5 % ở kênh lệch > 64/255, 1200 x 800. PNG Inkscape vs đã nhập: 0,024 / 0,441 / 0,934 / 0,001 % (ngưỡng 3 %). **Kết luận: đạt trên 4 file thật và "đạt trên mô phỏng" cho 6 file Illustrator/CorelDRAW.** Các mô phỏng dựa trên đặc trưng cấu trúc đã biết của hai phần mềm, có thể bỏ sót thói quen xuất thật. File stress `factory-isometric-stress.svg`: 27.029 phần tử thô; không Tối ưu bị `E_IMPORT_LIMIT` (26.894 > 20.000); với `--optimize` còn **10.307** phần tử, 2,47 MB, ảnh khác 0,463 % (≤ 1 %).

## 6. Thay đổi hành vi quay so với 0.2 (ADR-024 mục 4)

- **Thay đổi có chủ ý:** phần tử **có `transform` gốc** nay **giữ** nó khi gắn quay (0.2 im lặng ghi đè bằng CSS `transform`; sửa lỗi). Đo: quay trên phần tử có `transform` gốc `translate(200 150)`: giữ thuộc tính, tâm hộp bao trôi 0 px, khi dừng `transform` nguyên vẹn.
- **Không đổi hiển thị:** phần tử không có `transform` gốc và tâm giữa hiển thị như 0.2.
- **`el_motor_fan` của tank-demo (T107): không phải lỗi sản phẩm.** `<g>` không có `transform` gốc, gắn `spin`. 0.2 ghi `transform-box: fill-box; transform-origin: center center` + `rotate()`; 0.4 ghi `transform-origin: 0 0; transform-box: view-box; transform: translate(850px, 525px) rotate(…) translate(-850px, -525px)`. Hai chuỗi `style` khác nhau nhưng **cùng phép biến đổi**: tâm quay (850, 525) như nhau, cùng thuộc tính khác, cùng kiểu tính toán, cùng 1 hoạt ảnh, tâm hộp bao lệch ≤ 0,5 px, ảnh đóng băng lệch 0,0001 %. Chỗ lệch ở lần chạy trước là so sánh quá chặt; đã đổi `compat-008.mjs` phân loại "chuỗi style quay khác nhưng cùng tâm và cùng hoạt ảnh" tách khỏi "không dự kiến". Không sửa sản phẩm; compat 30/30.

## 7. Giới hạn đã biết

- **D30:** runtime C++ không parse SVG nên **không từ chối được gói có SVG độc** do sửa tay rồi nạp bằng công cụ khác Studio. Phòng thủ nằm ở trang: allowlist ở `mountScreen` (cộng giới hạn `use`), CSP `kCspProject`, validator của Studio. XSS (nếu có) sẽ chạy dưới quyền operator đang đăng nhập. Chưa có validator SVG ở C++.
- **D31:** SVG phục vụ **không nén** (`Cache-Control: no-cache`); giảm tải bằng chuẩn hóa gọn và `W_SVG_HEAVY` từ 1 MiB (ước tính 10 client F5 qua LAN 100 Mbps ≈ 0,8 s/MiB). **Chưa đo SVG ≥ 1 MiB trên BL335** (T123); nếu SC-005 không đạt thì rủi ro là nén tại runtime (ngoài phạm vi).
- Rà soát bảo mật (`008-security-review.md`): 0 Critical, 2 High đã sửa (ReDoS `inspectSvg` 55 KB mất 77 s; bom/chuỗi `use` treo Chrome), 2 Medium đã sửa (F3, F4), còn Medium F5 (`minRole` chỉ khóa giao diện) và F6 (= D30), 9 Low, 4 Info. T209-T220 của feature 011 giữ các phát hiện F5-F16.
- Illustrator, CorelDRAW: hướng dẫn `docs/guides/svg-export.md` viết theo đặc trưng cấu trúc đã biết, chưa kiểm trên phần mềm thật.
- Phép đo SC-008: máy dev 100 Hz, JS heap thay RSS, chưa có Chrome 120 trên máy yếu.

## 8. Đã dựng lại tank-demo (T095)

`rebuild-tank.e2e.mjs`: **32 thao tác** (đếm từng nhấp, kéo thả, chọn, gõ; không tính mở project): thả bồn, 2 ống, motor (4); gắn Mức chất lỏng và Chữ mức; gắn quay (spin), đèn theo bảng giá trị, chữ tốc độ, sự kiện xung; dòng chảy; nhập `inkscape-02`; Lưu. Bộ kiểm TS: 0 lỗi. So với `tank-demo` gốc trên runtime x64: 10/10 (mục SC-004). Khác biệt có chủ ý: `tank-demo` gốc dùng Tag `source.mock` của 0.1, bản dựng lại dùng Tag mô phỏng 0.4 cùng id (thêm MOTOR01.STATE và MOTOR01.PULSE).

## 9. Chưa đo / chưa làm

| Mục | Task | Lý do |
|---|---|---|
| Kiểm chỉ đọc BL335 (cổng mạng, RAM, `MemoryCurrent`; ước tính 65 Mbps của R20) | T010 | cần SSH, chờ người |
| Cài runtime 0.7.0 lên BL335, nạp svg-demo và dashboard-demo từ ≥ 2 máy | T121, T122 | SSH/thiết bị |
| SC-005 trên BL335 (3b ≤ 2 s, 10 F5 ≤ 5 s, 40 item, SVG ≥ 1 MiB) | T123 | thiết bị |
| SC-007 trên BL335 (30 phút, CPU, RSS, eMMC) | T124 | thiết bị |
| Điều khiển thật từ phần tử SVG, rút cáp PLC, `kill -9` giữa xung | T125 | thiết bị, cần người ở cạnh |
| Quay lại bằng `rollback.sh`, runtime cũ từ chối project 0.4 | T126 | thiết bị |
| File thật Illustrator và CorelDRAW | T120 | chờ người dùng cung cấp |
| Thử tay: Telex/Unikey (20/20 "Bơm nước số 1"), Chrome ≥ 120 thật, WebView2 thật | T127 | chờ người |
| NVDA (nút có nhãn, thông báo khóa/kết quả) | T114 (phần tay) | chờ người |
| SC-020 (người mới ≤ 20 phút) | T131 | chờ người; không có thì ghi "tự đo" |
| `ci-local.ps1` đầy đủ, ctest đầy đủ, `-Full` | T032..T111 | phiên chính chạy sau khi gộp |
| Fuzz importer bản dài 1 giờ; bộ cài Studio 0.6.0 và gói runtime 0.7.0 | T113, T118 | để phiên chính |

x64 loopback **không thay** cho BL335 ở mọi dòng trên.
