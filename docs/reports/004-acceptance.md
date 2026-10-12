# Báo cáo nghiệm thu — 004 Khung giao diện mới của mAT Studio

Spec: [specs/004-studio-shell/spec.md](../../specs/004-studio-shell/spec.md). Ngày: 2026-10-11.

**Trạng thái:** xong; Studio 0.2.0 có bộ cài (mục 4). Ngày 2026-10-11 người dùng dùng thử, duyệt giao diện ("giao diện ok") và giao toàn quyền quyết định, kể cả tự nghiệm thu. Còn:

- Bước 15 (rút cáp mạng 30 s) và 10 phiên thật trên BL335: cần người ở cạnh thiết bị; đã kiểm với runtime giả.
- **SC-002:** kỹ sư mới tự làm một lượt; không có người thứ hai để đo, ghi ở mục hạn chế.

Số đo trên Chrome headless dùng bản build e2e: giao diện thật, lớp Tauri giả, runtime giả. Số đo trên Studio thật (WebView2 + Rust) ghi ở mục 4.

## Tóm tắt theo tiêu chí

| SC | Nội dung | Kết quả | Bằng chứng |
|---|---|---|---|
| SC-001 | 100 % chức năng Studio Sprint 1 làm được trong khung mới | **Đạt** (bảng đối chiếu, mục 2) | e2e `shell`, `edit`, `monitor`, `logging` |
| SC-002 | Kỹ sư chưa dùng Studio mới: sửa lỗi theo tab Thông tin, lưu, xem trước mô phỏng ≤ 3 phút, không cần hướng dẫn | **Chưa đo**: cần người dùng (T086) | — |
| SC-003 | Lỗi hiện tại ô và thanh trạng thái ≤ 1 s; gõ trong lưới 500 Tag ≤ 100 ms mỗi phím | **Đạt trên Chrome**:<br>• sửa tới khi lỗi hiện: 280 ms;<br>• mũi tên: trung bình 14 ms, tối đa 22 ms;<br>• gõ: tối đa 11,4 ms | mục 1; `apps/studio/tests/e2e/perf.e2e.mjs` |
| SC-004 | Mở Studio tới tab Bắt đầu ≤ 3 s; mở project mẫu tới cây đầy đủ ≤ 2 s | **Đạt trên Studio thật** (1209 ms; 38 ms) | `tools/measure/studio-smoke.mjs` |
| SC-005 | 100 % lệnh của menu dùng được bằng bàn phím; axe không có lỗi nghiêm trọng; tương phản ≥ 4,5:1 | **Đạt**:<br>• axe 0 vi phạm critical/serious ở mọi editor, theme sáng và tối;<br>• tương phản: 42 cặp màu ≥ 4,5:1;<br>• bàn phím: e2e đi qua F6, bảng lệnh, menu, cây, tab, lưới, hộp thoại.<br>Chạy tay toàn bộ trên Studio thật làm cùng T086 | mục 1; `theme/contrast.test.ts` |
| SC-006 | Kết luận của Studio trùng 100 % với công cụ dòng lệnh trên bộ vector; file Studio lưu được runtime chấp nhận, diff chỉ phần đã sửa | **Đạt**:<br>• 82/82 vector mở qua store của Studio cùng tập mã lỗi;<br>• chỉ sửa tên project thì chỉ `project.json` được ghi, đúng một dòng đổi | `model/vectors.test.ts`; e2e `edit` |
| SC-007 | Theo dõi: lệch so với trang runtime trên Chrome ≤ 1 s; ngắt thì thiết bị giảm số phiên ≤ 2 s | **Đạt trên BL335 thật** (2026-10-11): lệch so với client trực tiếp trung vị 0 ms, tối đa 1 ms trên 180 mẫu; Ctrl+M → thiết bị giảm số phiên sau 26 ms. Với runtime giả: mất rồi có lại sau 158–512 ms | [004-bl335-monitor.json](004-bl335-monitor.json); e2e `monitor` |
| SC-008 | Người dùng duyệt giao diện bản build | **Đạt** (2026-10-11: người dùng dùng Studio 0.2.0, trả lời "giao diện ok", duyệt luôn mockup bản 1) | T040, T086 |

## 1. Test tự động (2026-10-11)

| Lớp | Kết quả |
|---|---|
| Vitest `@mat/studio` | 534 test, 36 file: logic (store, lịch sử, lệnh, phím tắt, cây, ánh xạ lỗi, lưới, phiên thiết bị…) và component trong jsdom |
| e2e (Chrome headless, `npm run e2e -w @mat/studio`) | 5 file, 110 kiểm, 0 lỗi console; mỗi file một ngữ cảnh trình duyệt riêng |
| `cargo test --lib` (`apps/studio/src-tauri`) | 23/23 |
| ESLint, Prettier, `tsc` | sạch; ESLint chặn `innerHTML`/`unsafeHTML` và chữ tiếng Việt viết thẳng ngoài `src/i18n` |
| `tools/ci-local.ps1` toàn bộ | đạt: armhf + smoke qemu, deploy/rollback, x64 ctest 377/377, Go, Vitest 769 test, build web, e2e Studio ([004-ci-local.txt](004-ci-local.txt)) |

Các file e2e:

- **`shell` (28 kiểm):**
  - tab Bắt đầu; lệnh khóa có lý do;
  - mở project giả, cây đủ mục và nhãn giai đoạn, 3 tab không trùng;
  - Ctrl+Shift+P "bang tag" (không dấu); menu có lệnh bị khóa;
  - F6 qua sáu vùng; theme sáng/tối; tải lại trang giữ bố cục;
  - cửa sổ 960 × 600 không tràn ngang; axe ở 4 trạng thái.
- **`edit` (34 kiểm):**
  - Max < Min → ô đỏ và "1 lỗi" sau khoảng 260 ms; nhảy tới lỗi; Ctrl+Z, Ctrl+Y;
  - chỉ ghi `project.json`; lưu khi còn lỗi;
  - xung đột Ghi đè / Tải lại / Hủy; đóng khi chưa lưu;
  - axe theme sáng và tối.
- **`monitor` (37 kiểm, runtime giả: system/info + live 1.0.0):**
  - viền cam, cột giá trị sống ngay sau cột Tên, "không có trên thiết bị";
  - mất kết nối rồi tự có lại; thiết bị đầy (4429) → báo và thử lại;
  - Ctrl+M trả phiên; chỉ một WebSocket;
  - báo lỗi kết nối trong ≤ 3 s; Chẩn đoán tự làm mới 4,1–4,3 s;
  - axe ở xem trước, trang Thiết bị, Chẩn đoán.
- **`logging` (6 kiểm):** đủ 2 nhóm của project mẫu, ước tính ghi eMMC, không hiện mật khẩu, axe.
- **`perf` (5 kiểm):** 500 Tag (`tests/fixtures/studio/tags-500`):

  | Phép đo | Kết quả |
  |---|---|
  | mở Bảng Tag | 99 ms |
  | mũi tên (n = 26) | trung bình 14 ms, p95 21,8 ms, tối đa 22,2 ms |
  | gõ (n = 23) | trung bình 10,5 ms, tối đa 11,4 ms |
  | sửa tới khi lỗi hiện | 280 ms |

Lỗi thật mà test và e2e bắt được, đều đã sửa và có test:

- **live-client:** gọi `stop()` trong `onState` để lại socket ma.
- **`checkDevice`:** fetch treo mà bỏ qua tín hiệu hủy thì hàm treo mãi; nay có hạn chót riêng. Hạn đặt 2,8 s để thông báo hiện trong ≤ 3 s, kể cả lúc vẽ (với hạn 3 s, e2e đo được 3,006–3,015 s).
- **Lỗi trợ năng (axe):**
  - cây rỗng mang role=tree;
  - nút đóng lồng trong role=tab;
  - chữ phụ trên dòng chọn ở theme tối chỉ 4,46:1.
- **Lỗi khởi động khung:** `<mat-shell>` có sẵn trong trang được nâng cấp trước khi gắn app, nên phím tắt chưa gắn.
- **Handler đọc trạng thái cũ** khi nhấp nhanh hai lần.
- **Bảng Tag:** lưới đã gỡ vẫn chọn lại Tag khi chuyển tab; đóng tab khi đang gõ dở.
- **CSS:** hai editor cùng đặt lớp `.lv`.

## 2. Đối chiếu chức năng Sprint 1 (SC-001, quickstart §5)

| Sprint 1 (`specs/002-vertical-slice`) | Ở khung mới | Kiểm |
|---|---|---|
| FR-032 mở project, kiểm tra, xem kết quả | Project › Mở…, tab Thông tin, thanh trạng thái; kiểm liên tục sau mỗi lần sửa, F7 kiểm lại từ đĩa | e2e `shell`, `edit` |
| FR-033 sửa cấu hình project và Tag | Thiết lập project, Bảng Tag. Nay lưu được cả khi còn lỗi (FR-023); giữ thứ tự khóa, chỉ ghi file đã đổi | e2e `edit`; `project-doc.test.ts` |
| FR-034 địa chỉ thiết bị, kiểm kết nối | Online › Thiết bị… (trang Thiết bị), thanh trạng thái, Chẩn đoán | e2e `monitor`; `device-page.test.ts` |
| FR-035 xem trước sống | Màn hình › Xem trước: Mô phỏng hoặc Thiết bị; một phiên dùng chung với Bảng Tag | e2e `monitor`; `screen-preview.test.ts` |
| FR-036 mở web thiết bị | Online › Mở web thiết bị, task card Công cụ online, trang Thiết bị | `device-page.test.ts` |
| FR-037 quyền tối thiểu | Không đổi: Rust kiểm đường dẫn; danh sách gần đây do Rust giữ; capability chỉ thêm quyền cửa sổ (đóng, hủy, đặt tiêu đề) | `cargo test` |
| Tab Giới thiệu | Trợ giúp › Giới thiệu | e2e `shell` (menu) |
| Tóm tắt lưu trữ ở tab Thiết bị (feature 003) | Chẩn đoán và editor Lưu trữ | e2e `monitor`, `logging` |

## 3. Hạn chế còn lại

- **Bộ gõ Telex có sẵn của Windows (TSF):** trong Bảng Tag, phím đầu tiên không vào chế độ sửa; nhấn F2 hoặc Enter trước. Unikey không bị. Xử lý cùng lưới kiểu Excel ở GĐ 2.
- **Lưới chưa ảo hóa:** đủ cho 500 Tag (SC-003); ≥ 2.000 dòng thuộc GĐ 2.
- **Theo dõi chỉ đọc, chưa đăng nhập** (feature 005):
  - CSP của Studio chưa có `https:`/`wss:`;
  - thiết bị có HTTPS thì phải chờ 005 chuyển kết nối xuống Rust.
- **Chẩn đoán:** CPU, RAM ghi "chưa có" vì runtime 0.3.0 chưa gửi; thời gian chạy runtime đã có.
- **Thanh tiêu đề gốc của Windows**, menu ở hàng riêng (research R12). Khác mockup một chút.

## 4. Bộ cài Studio 0.2.0 và kiểm trên Studio thật

**Bộ cài:** `C:uildmat-studioeleaseundle
sismAT Studio_0.2.0_x64-setup.exe`, 208,33 MiB (WebView2 offline đi kèm), build 2026-10-11 15:11. Cách cài như Sprint 1: NSIS, cho người dùng hiện tại, không cần quyền admin. Phiên bản 0.1.0 → 0.2.0 ở `package.json`, `tauri.conf.json`, `Cargo.toml`.

**Kiểm bằng `tools/measure/studio-smoke.mjs --exe`** trên chính file exe vừa build, với cổng debug của WebView2. Không cài đè lên bản Studio đang có trên máy. Kết quả: [004-studio-smoke.json](004-studio-smoke.json), 19/19 đạt.

| Kiểm | Kết quả |
|---|---|
| Mở Studio tới tab Bắt đầu (SC-004 ≤ 3 s) | **1209 ms** (từ lúc chạy exe tới khi tab Bắt đầu vẽ xong) |
| Mở project mẫu từ danh sách gần đây tới cây đầy đủ (SC-004 ≤ 2 s) | **38 ms** |
| IPC `app_info` | mAT Studio 0.2.0, Tauri 2.12.2 |
| Quyền tối thiểu | Chưa mở project thì `project_read`/`project_write` bị từ chối; `open_device_web` từ chối `javascript:`, `file:` và URL có ký tự lạ |
| Khung | đủ menu, thanh công cụ, cây, tab, inspector, task card, thanh trạng thái |
| Phím trình duyệt trong WebView2 (research R15) | F5 không tải lại trang; Ctrl+P bị chặn |
| Console, CSP | 0 lỗi |

**CSP thật của bản build:** Tauri chỉ chèn hash vào `script-src`; `style-src` giữ `'self' 'unsafe-inline'`. Kết quả kiểm:
- mở xem trước màn hình (chế độ Mô phỏng) và Bảng Tag: 0 vi phạm CSP (bắt bằng sự kiện `securitypolicyviolation`), 0 lỗi console;
- thụt lề của cây (gán bằng `styleMap`) đúng.

Để chạy được bước mở project, phiên này đã ghi sẵn `%APPDATA%n.com.atpro.matstudioecent.json` với một mục `projects/tank-demo`, vì hộp thoại chọn thư mục không tự động hóa được. Người dùng mở Studio 0.2.0 sẽ thấy mục này trong "Mở gần đây".

**Kiểm tay còn lại (cần người dùng, T086):**
- dùng thử bộ cài;
- duyệt giao diện so với mockup bản 1 (cùng T040);
- chạy quickstart §4 bước 1–18 bằng chuột và chỉ bằng bàn phím;
- đo SC-002.

Theo dõi BL335 thật (bước 14–16) làm ở T075.

## 5. Theo dõi BL335 thật (T075, 2026-10-11)

Chỉ đọc qua web, địa chỉ công khai `198.51.100.200:9080`; thiết bị chạy runtime 0.3.0, project tank-demo 0.1.0. Công cụ: `tools/measure/studio-monitor-check.mjs` chạy Studio 0.2.0 thật; client tham chiếu là `LiveConnection` trực tiếp tới thiết bị (vai trò trang runtime trên Chrome).

| Kiểm | Kết quả |
|---|---|
| Ctrl+K tới "Đang theo dõi", viền cam | 150 ms |
| Số phiên Studio chiếm | 1 (1 → 2 khi đã có client tham chiếu) |
| Cột giá trị sống, quality ngay sau cột Tên; mọi Tag có giá trị | đạt (TANK01.TEMP chập chờn BAD theo thiết kế của tank-demo) |
| Độ lệch so với client trực tiếp (180 mẫu `TANK01.LEVEL` trong 45 s) | trung vị 0 ms, p95 1 ms, tối đa 1 ms (SC-007 ≤ 1 s) |
| Tab Chẩn đoán | runtime 0.3.0, giao thức 1.0.0, 2/10 phiên, project cùng phiên bản với máy này, thời gian chạy |
| Ctrl+M: thiết bị giảm số phiên | 26 ms (SC-007 ≤ 2 s) |
| Đóng Studio | số phiên về như trước (0) |
| Console | 0 lỗi |

Kết quả đầy đủ: [004-bl335-monitor.json](004-bl335-monitor.json).
