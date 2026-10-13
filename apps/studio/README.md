# mAT Studio (khung kiểu IDE, feature 004)

Ứng dụng desktop Tauri 2 + Vite + TypeScript + Lit. Từ feature 004 (GĐ 1 của [lộ trình v2](../../docs/plans/roadmap-v2.md)), Studio là khung kiểu IDE theo cách tổ chức của TIA Portal ([studio-ux.md](../../docs/architecture/studio-ux.md), [mockup](../../docs/architecture/mockups/studio-shell.html)), thay trang form 5 tab của Sprint 1.

## Khung cửa sổ

- **Menu** (Project, Sửa, Xem, Online, Công cụ, Trợ giúp) và **thanh công cụ**, dựng từ một danh mục lệnh ([contracts/commands.md](../../specs/004-studio-shell/contracts/commands.md)). Lệnh chưa dùng được vẫn hiện, kèm lý do ("Có ở feature 005", "Có ở GĐ 2", "Chưa mở project"…).
- **Cây project**: thiết lập project, thiết bị, Tag, lưu trữ, màn hình. Mục của giai đoạn sau có nhãn giai đoạn (tắt được) và mở trang giải thích.
- **Details** dưới cây: Tag, phần tử màn hình hoặc nhóm lưu trữ theo editor đang mở.
- **Editor dạng tab** có dấu chưa lưu: Bắt đầu, Thiết lập project, Bảng Tag, Màn hình (xem trước), Thiết bị, Lưu trữ (chỉ đọc).
- **Inspector**: Thuộc tính (Tag và "Dùng ở đâu", phần tử màn hình và binding chỉ đọc, nhóm lưu trữ, project), Thông tin (lỗi và cảnh báo; nhấp đúp hoặc Enter để tới đúng ô), Chẩn đoán (thiết bị khi đang theo dõi).
- **Task card**: Toolbox, Thư viện (giới thiệu widget của GĐ 3a/3b), Công cụ online, Tìm.
- **Thanh trạng thái**: thiết bị, số lỗi và cảnh báo, tiến trình, theme.
- **Bảng lệnh** Ctrl+Shift+P (gõ có dấu hay không dấu đều khớp), phím tắt giống TIA Portal (Ctrl+K Online tới thiết bị gắn với project, chưa gắn thì mở Thiết bị trong mạng; Ctrl+M Offline), F6 chuyển vùng. Mọi vùng dùng được bằng bàn phím.
- Theme sáng, tối, theo hệ thống; kéo đổi cỡ các vùng (chuột hoặc phím mũi tên trên thanh kéo); bố cục, theme, địa chỉ theo dõi và thiết bị gắn với từng project (khóa theo thư mục project, không ghi vào file project) được nhớ trong `localStorage` của WebView2.

Chức năng Sprint 1 vẫn đủ: mở project, kiểm tra bằng bộ kiểm tra dùng chung với runtime (nay chạy liên tục sau mỗi lần sửa), sửa thiết lập và Tag (hoàn tác/làm lại 100 bước), lưu theo định dạng chuẩn (giữ thứ tự khóa, chỉ ghi file đã đổi, lưu được cả khi còn lỗi), xem trước màn hình (mô phỏng hoặc dữ liệu sống), kiểm kết nối thiết bị, mở web thiết bị. Theo dõi thiết bị chỉ **đọc** và chiếm 1 trong 10 phiên của thiết bị.

Feature 005 (US1): Thiết bị trong mạng (tìm BL335 trong LAN, thêm theo địa chỉ), ghim chứng chỉ, đăng nhập theo role, Online qua HTTPS. Thiết bị runtime cũ (< 0.4.0) chỉ theo dõi chỉ đọc qua HTTP; trang Thiết bị vẫn theo dõi được theo địa chỉ. Nạp xuống, đọc lên, so sánh làm ở US2/US3.

## Tag, Modbus và Online (feature 006, Studio 0.4.0)

Các editor mới cho project định dạng **0.2** (mở từ cây project; lệnh có trong menu và bảng lệnh):

- **Bảng Tag:** lưới ảo hóa sửa tại ô (bộ gõ tiếng Việt: mục tiêu là gõ thẳng không cần F2, **chưa thử tay trên Windows 11**, T215), thêm hàng loạt, điền xuống, dán từ Excel, nhập/xuất CSV, lọc, lỗi theo ô; đổi tên Tag cập nhật mọi chỗ dùng ("Đổi tên Tag...").
- **Kết nối:** kênh Modbus TCP và RTU, thiết bị trường, danh sách cổng serial của thiết bị, **Thử kết nối** (chạy trên thiết bị qua HTTPS, cần engineer). Các bước: [mat-runtime.md](../../docs/deployment/mat-runtime.md) mục 5c.
- **Bảng giá trị:** giá trị hoặc khoảng sang chữ và màu, dùng cho Tag chuỗi và hàm `text(tag, bảng)`.
- **Tag tính toán:** biểu thức (`+ - * / %`, so sánh, logic, `? :`, `min`, `max`, `abs`, `round`, `clamp`, `text`), gợi ý tên Tag, kiểm khi gõ; cùng bộ tính với runtime ([ADR-015](../../docs/adr/015-expression-language.md)).
- **Bảng theo dõi và ghi:** giá trị sống và quality của các Tag chọn; ghi giá trị có xác nhận (một Tag hoặc cả bảng, `Ctrl+Shift+Enter`), cần đăng nhập Online qua HTTPS với role operator trở lên; kết quả `ACCEPTED`/`REJECTED`/`TIMEOUT`/`FAILED`/`CONFIRMED`; mỗi lần ghi có audit trên thiết bị. Trang xem Chrome vẫn chỉ đọc.
- **Chẩn đoán driver:** trạng thái từng kênh và thiết bị, số lỗi theo loại, chu kỳ quét thực tế, lỗi gần nhất.
- **Mô phỏng** ("Bật hoặc tắt Mô phỏng", menu Công cụ): Tag chạy trong Studio theo `sim` (hằng, ramp, sin, ngẫu nhiên...), Tag tính toán tính lại, ghi tay giữ tới khi tắt; không cần thiết bị và không mạng.
- **Nâng cấp 0.1 sang 0.2:** mở project 0.1 hiện hộp thoại "Mở project định dạng 0.1" liệt kê thay đổi; "Nâng cấp" làm trong bộ nhớ, đĩa chỉ đổi khi bấm Lưu và Studio sao lưu bản 0.1 trước; "Mở chỉ đọc" khóa mọi lệnh sửa. Project 0.2 cần runtime >= 0.5.0 trên thiết bị.

Phần Online vẫn chờ thử trên BL335 thật (xem [roadmap-v2.md](../../docs/plans/roadmap-v2.md) §4.2).

## Cấu trúc mã

```text
src/
├── main.ts            khởi động: theme, sprite icon, StudioApp, <mat-shell>
├── app/               logic thuần, không DOM (Vitest)
│   ├── app.ts         StudioApp: nối store, không gian làm việc, phiên thiết bị, lệnh, hộp thoại
│   ├── store.ts       project đang mở, sửa, kiểm tra liên tục, tab, lựa chọn, lưu, xung đột
│   ├── history.ts  commands.ts  palette.ts  shortcuts.ts  workspace.ts  save-policy.ts
├── model/             project-doc (giữ thứ tự khóa), tree, issue-map, grid-model, xref, tag-ids,
│                      sim-source, device, device-session
├── ui/                web component Lit, render ở light DOM (research R1)
│   ├── base.ts        AppElement: gắn StudioApp, vẽ lại khi trạng thái đổi
│   ├── registry.ts    editor, thuộc tính inspector, chẩn đoán tự đăng ký vào khung
│   ├── mat-shell.ts   bố cục bảy vùng, thanh kéo, F6, viền cam khi theo dõi
│   ├── mat-*.ts       menu, thanh công cụ, cây, Details, tab, inspector, task card, thanh trạng
│   │                  thái, bảng lệnh, hộp thoại, thông báo
│   ├── shell.css      kiểu của khung (token màu ở theme/tokens.css)
│   └── editors/       start-page, phase-page, settings-editor, tag-grid, screen-preview,
│                      device-page, logging-view
├── i18n/              chuỗi giao diện tiếng Việt (vi.ts và vi-*.ts), t('khóa', tham số)
├── icons/             sprite Fluent UI System Icons + ký hiệu công nghiệp tự vẽ
├── theme/             tokens.css (màu, chữ), base.css
└── platform/          tauri.ts (lệnh Rust), mock.ts (lớp giả cho e2e), types.ts; feature 005:
                       tauri-device.ts (DeviceLink), mock-device.ts (thiết bị giả cho e2e), device-types.ts
src-tauri/src/         lib.rs, project_fs.rs (đọc/ghi kèm SHA-256), recent.rs (project gần đây);
                       feature 005: discovery.rs (tìm thiết bị), device/ (devices.json, TLS ghim, phiên, live)
tests/e2e/             run.mjs (Chrome headless + axe-core), *.e2e.mjs
```

Quy ước:

- Chuỗi giao diện chỉ nằm trong `src/i18n` (ESLint chặn chữ tiếng Việt viết thẳng trong mã, trừ file test).
- Không `innerHTML`, không `unsafeHTML`/`unsafeSVG` (ESLint chặn). Dữ liệu project chỉ vào giao diện qua binding của Lit; SVG của project gắn bằng `@mat/svg-renderer`.
- Logic nằm ở `app/` và `model/` (hàm thuần, có test); thành phần `ui/` chỉ vẽ và gọi hành động của `StudioApp`.

## Test

```powershell
npm test -w @mat/studio          # Vitest + jsdom: logic, component (cây, tab, bảng lệnh, khung…)
npm run e2e -w @mat/studio       # build chế độ e2e rồi chạy tests/e2e/*.e2e.mjs trên Chrome headless
cd src-tauri; $env:CARGO_TARGET_DIR='C:\build\mat-studio'; cargo test --lib
```

- E2E dùng bản build `--mode e2e`: `platform/tauri.ts` được thay bằng `platform/mock.ts` (project mẫu `projects/tank-demo` trong bộ nhớ, điều khiển qua `window.__matMock`), `platform/tauri-device.ts` bằng `platform/mock-device.ts` (thiết bị giả, điều khiển qua `window.__matMock.device`). Kiểm axe-core: 0 vi phạm mức critical/serious. Ảnh chụp ở `tests/e2e/out/`.
- Chọn một file: `node tests/e2e/run.mjs shell`; xem trình duyệt: thêm `--headful`. Chrome/Edge ở chỗ khác thì đặt `CHROME_PATH`; đổi thư mục build bằng `MAT_E2E_OUT`.
- CI GitHub không chạy test Rust (Studio chỉ chạy trên Windows): chạy tay như trên.

## Làm việc với thiết bị (feature 005)

- **Online:** thanh trạng thái và tab "Thiết bị trong mạng" tìm thiết bị (UDP 8446), thêm theo địa chỉ, **ghim fingerprint** (so đủ từng cặp ký tự với giá trị in trên thiết bị bằng `--cert-fingerprint`), đăng nhập (tài khoản tạo trên thiết bị: [hướng dẫn](../../docs/deployment/mat-runtime.md), mục 5b). Token phiên chỉ nằm trong Rust.
- **Nạp xuống:** Online, "Nạp project xuống thiết bị": xem trước khác biệt, 6 bước, tự quay về bản cũ nếu kiểm tra sức khỏe lỗi; "Khôi phục bản trước" từ kết quả hoặc menu.
- **Đọc lên và So sánh:** "Đọc lên thành project mới", "Đọc lên để so sánh"; chip khớp/khác ở thanh trạng thái; So sánh liệt kê `+`, `≠`, `−` theo từng thực thể.
- **Chẩn đoán và Audit:** tab Chẩn đoán (CPU, RAM, đĩa, giờ, phiên); Audit chỉ cho administrator, xuất bằng `--export-audit` trên thiết bị.

## Yêu cầu máy build

- Rust toolchain MSVC (`rustup`; máy dev: stable 1.99.0).
- Visual Studio 2022/2026 hoặc Build Tools có **MSVC x64/x86 build tools** và **Windows 11 SDK**.
- WebView2 Runtime (Windows 11 có sẵn). Bộ cài NSIS nhúng bản offline cho máy chưa có.
- Lần build đầu cần Internet: bundler tải NSIS, `nsis_tauri_utils.dll` và WebView2 offline installer.
- Kiểm tra môi trường: `npm run tauri -w @mat/studio -- info`.

## Chạy và đóng gói

Thư mục `target` của Rust rất lớn (vài GB). Đặt ra ngoài ổ chứa dự án nếu ổ đó gần đầy:

```powershell
$env:CARGO_TARGET_DIR = 'C:\build\mat-studio'
npm run studio:dev      # cửa sổ Tauri + Vite dev server (cổng 1420)
npm run studio:build    # → $env:CARGO_TARGET_DIR\release\bundle\nsis\mAT Studio_<phiên bản>_x64-setup.exe
```

Xem giao diện không cần Rust: `npm run build:e2e -w @mat/studio` rồi mở `dist-e2e` bằng một máy chủ tĩnh (hoặc `node tests/e2e/run.mjs --headful`).

Gỡ lỗi WebView2: đặt `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` trước khi chạy app, rồi mở `http://127.0.0.1:9223` hoặc dùng `tools/measure/studio-smoke.mjs`.

## Ghi chú an toàn

- Giao diện không tự chọn được đường dẫn đọc/ghi: thư mục project chỉ đặt qua hộp thoại của Rust hoặc danh sách gần đây do Rust giữ (`recent.rs`); mọi đọc/ghi nằm trong thư mục đó (`project_fs.rs`), ghi atomic và so SHA-256 để phát hiện file bị sửa ngoài Studio.
- CSP (`src-tauri/tauri.conf.json`): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; form-action 'none'`, kèm `freezePrototype` (feature 005, T084; `src/platform/csp.test.ts` kiểm). WebView không tự kết nối ra mạng: mọi kết nối tới thiết bị (kiểm kết nối, theo dõi theo địa chỉ, tìm thiết bị, Online qua HTTPS có ghim, dữ liệu sống) đi qua lệnh Rust (`DeviceLink`, [contracts/tauri-commands.md](../../specs/005-device-online/contracts/tauri-commands.md)). Token phiên và mật khẩu không quay lại giao diện.
- Plugin `dialog` và `opener` chỉ được gọi bên trong lệnh Rust (`project_pick`, `open_device_web`, chỉ mở `http(s)://`); capability của giao diện chỉ có quyền cửa sổ cần cho tiêu đề và hỏi khi đóng.
- Studio dùng chung bộ kiểm tra, renderer, binding và client dữ liệu sống với runtime qua `packages/*` (Constitution II).

## Trạng thái kiểm chứng bộ cài

Bộ cài Sprint 0/1 đã kiểm trên Windows 11 (cài, mở, gỡ im lặng, không cần admin). Chưa thử trên Windows 10 và máy không Internet ([studio-install.md](../../docs/reports/studio-install.md)). Kết quả của khung mới ghi ở `docs/reports/004-acceptance.md`.
