# Implementation Plan: Khung giao diện mới của mAT Studio

**Branch**: `004-studio-shell` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-studio-shell/spec.md`

## Summary

Thay trang form 5 tab của Studio Sprint 1 bằng khung kiểu IDE theo [studio-ux.md](../../docs/architecture/studio-ux.md) và [mockup bản 1](../../docs/architecture/mockups/studio-shell.html):

- cây project, Details, editor dạng tab, inspector (Thuộc tính, Thông tin, Chẩn đoán);
- task card, thanh trạng thái, theme sáng/tối/hệ thống, bảng lệnh, phím tắt.

Mọi chức năng Sprint 1 chuyển sang khung mới: mở project, thiết lập project, bảng Tag, kiểm tra, lưu, xem trước, kết nối thiết bị, mở web. Thêm ba thứ:

- kiểm tra liên tục và nhảy tới chỗ sai;
- theo dõi thiết bị chỉ đọc (giá trị sống trong bảng Tag, tab Chẩn đoán);
- xem cấu hình lưu trữ.

Cách làm ([research.md](research.md)):

- **Giao diện:** web component Lit 3.3.3. Logic nằm trong module TS thuần có test.
- **Bố cục:** CSS grid tự dựng, chưa dùng thư viện docking. Lưới Tag tự viết, chưa ảo hóa. Icon Fluent.
- **Kết nối thiết bị:** một phiên dùng chung cho bảng Tag và xem trước. `@mat/live-client` thêm `setTags` và danh sách Tag lạ.
- **Rust:**
  - danh sách project gần đây do Rust giữ;
  - đọc/ghi kèm SHA-256 để phát hiện file bị sửa ngoài Studio;
  - hỏi khi đóng cửa sổ còn thay đổi chưa lưu.

Không đổi runtime, schema hay định dạng project. Quyết định ngăn xếp ghi ở [ADR-009](../../docs/adr/009-studio-ui-stack.md).

## Technical Context

**Language/Version**: TypeScript 7 (Vite 8, đang dùng trong repo); Rust 1.99, edition 2024 (Tauri 2).

**Primary Dependencies**:

- **Mới:**
  - `lit` 3.3.3 (BSD-3-Clause);
  - `@fluentui/svg-icons` 1.1.343 (MIT, chỉ lấy file SVG lúc build);
  - crate `sha2` (MIT/Apache-2.0).
- **Mới, chỉ khi phát triển:** `axe-core` 4.13.0 (MPL-2.0); dùng `puppeteer-core` có sẵn.
- **Có sẵn:**
  - Tauri 2, `tauri-plugin-dialog`, `tauri-plugin-opener`;
  - `@mat/project-schema`, `@mat/svg-renderer`, `@mat/binding-engine`, `@mat/live-client`.

**Storage**:

- File project trong thư mục người dùng chọn: đọc/ghi qua Rust, ghi atomic.
- `recent.json` trong thư mục cấu hình của ứng dụng (Rust).
- `localStorage` của WebView2 cho bố cục, theme, địa chỉ thiết bị.

**Testing**:

- Vitest + jsdom: logic thuần và component Lit.
- E2E: Chrome headless + puppeteer-core + axe-core, giao diện build chế độ `e2e`, lớp Tauri giả.
- `cargo test` cho lệnh Rust.
- Studio thật: chạy tay bằng `tools/measure/studio-smoke.mjs` mở rộng.

**Target Platform**: Windows 10/11 x64, WebView2 (Chromium ≥ 120). Màn hình từ 1366 × 768; cửa sổ tối thiểu 960 × 600.

**Project Type**: ứng dụng desktop (Tauri), sửa thêm một package TS dùng chung (`@mat/live-client`).

**Performance Goals**:

- mở Studio tới tab Bắt đầu ≤ 3 s;
- mở project mẫu ≤ 2 s;
- lỗi hiện ≤ 1 s sau khi sửa;
- gõ trong lưới 500 Tag ≤ 100 ms mỗi phím;
- giá trị theo dõi lệch so với Chrome ≤ 1 s.

**Constraints**:

- CSP giữ `script-src 'self'`; không `eval`, không chèn dữ liệu project dạng HTML.
- Giao diện không tự chọn đường dẫn đọc/ghi.
- Chỉ chiếm 1 phiên của thiết bị.
- Không ghi gì xuống thiết bị.
- Phiên bản thư viện ≥ 2 tuần tuổi.

**Scale/Scope**: 1 project, 1 thiết bị, ≤ 500 Tag, vài màn hình. Khoảng 12 web component, 8 module logic, 3 lệnh Rust mới.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution 2.0.0.

| Nguyên tắc | Đánh giá |
|---|---|
| I. Vertical slice trên thiết bị thật | Đạt. Không đổi định dạng project; Studio vẫn sinh đúng định dạng runtime đang chạy. Theo dõi thiết bị được nghiệm thu với BL335 thật, chỉ đọc qua web, không SSH, không đổi gì trên thiết bị. |
| II. Ranh giới kiến trúc | Đạt. Kiểm tra, hiển thị, binding, dữ liệu sống, ước tính lưu trữ dùng `packages/*`. `SimSource` chỉ sinh dữ liệu xem trước trong Studio, không phải logic runtime (research R11). Sửa `@mat/live-client` theo cách dùng được cho cả runtime web. |
| III. Ngân sách tài nguyên | Đạt. Thiết bị không đổi. Studio dùng 1 phiên như Sprint 1. |
| IV. Chrome, 10 client | Đạt. Một phiên dùng chung cho bảng Tag và xem trước (research R10); thiết bị đầy thì báo và thử lại sau 30 s như Sprint 1. |
| V. An toàn | Đạt. Lit thoát ký tự dữ liệu; CSP không đổi; đường dẫn do Rust kiểm; danh sách gần đây do Rust giữ (R7); mở web chỉ `http(s)`; không có lệnh ghi xuống thiết bị. Lưu khi còn lỗi (FR-023) không làm yếu nguyên tắc V vì thiết bị và bước nạp xuống vẫn từ chối project lỗi. |
| VI. Test trước | Đạt. Logic thuần, component, E2E và lệnh Rust đều có test viết trước; tasks sẽ ghi rõ test nào đỏ trước. |
| VII. Đơn giản, có phiên bản | Đạt. Chỉ làm phần Studio của GĐ 1. Không thêm thư viện docking, lưới hay quản lý trạng thái khi chưa cần (R2, R3, R5). Xem lưu trữ chỉ đọc, thay khối tóm tắt lưu trữ của tab Thiết bị cũ; editor lưu trữ vẫn ở GĐ 5. |
| Ràng buộc công nghệ | Đạt. Tauri 2 + TS + Vite; ESLint, Prettier; license đã rà (BSD-3, MIT, MPL-2.0 chỉ dùng khi phát triển). |

Không có vi phạm; không cần Complexity Tracking.

**Kiểm lại sau Phase 1**: data-model và contracts không thêm API thiết bị, không đổi schema, không thêm quyền ngoài thư mục project. Thêm quyền đóng/hủy cửa sổ trong capability, chỉ cho cửa sổ chính. Vẫn đạt.

## Project Structure

### Documentation (this feature)

```text
specs/004-studio-shell/
├── spec.md
├── plan.md               # file này
├── research.md           # R1–R16
├── data-model.md         # trạng thái Studio, tài liệu project, ánh xạ lỗi
├── quickstart.md         # chạy, kiểm, nghiệm thu
├── contracts/
│   ├── tauri-commands.md # lệnh Rust ↔ giao diện
│   └── commands.md       # danh mục lệnh, phím tắt, điều kiện bật
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks
```

### Source Code (repository root)

```text
apps/studio/
├── index.html                    # chỉ còn <mat-shell>
├── src/
│   ├── main.ts                   # khởi động: theme, store, nạp component
│   ├── app/                      # logic thuần, không phụ thuộc DOM
│   │   ├── store.ts              # trạng thái + hành động + đăng ký nghe
│   │   ├── history.ts            # hoàn tác/làm lại bằng snapshot, gộp bước
│   │   ├── commands.ts           # danh mục lệnh (contracts/commands.md)
│   │   ├── shortcuts.ts          # phím → lệnh
│   │   ├── palette.ts            # tìm lệnh không dấu
│   │   ├── workspace.ts          # bố cục, theme, nhãn giai đoạn (localStorage)
│   │   └── save-policy.ts        # (chuyển từ src/) lưu được khi lỗi; đóng gói bị khóa khi lỗi
│   ├── model/
│   │   ├── project-doc.ts        # (từ project-form.ts) đọc, sửa giữ thứ tự khóa, so trước khi ghi
│   │   ├── tree.ts               # dựng cây project từ file + nhãn giai đoạn
│   │   ├── issue-map.ts          # lỗi (file, JSON pointer) → editor, ô/trường
│   │   ├── xref.ts               # "Dùng ở đâu" của Tag
│   │   ├── tag-ids.ts            # tăng số tên Tag
│   │   ├── grid-model.ts         # chọn ô, di chuyển, sửa, điền xuống, lọc, dán (chưa bật)
│   │   ├── sim-source.ts         # giá trị mô phỏng cho xem trước
│   │   ├── device.ts             # (giữ) địa chỉ, kiểm kết nối, tóm tắt lưu trữ
│   │   └── device-session.ts     # một phiên thiết bị: live + system/info
│   ├── ui/                       # web component Lit
│   │   ├── mat-shell.ts          # bố cục 7 vùng, thanh kéo, viền online
│   │   ├── mat-menubar.ts  mat-toolbar.ts  mat-statusbar.ts
│   │   ├── mat-tree.ts  mat-details.ts  mat-tabs.ts
│   │   ├── mat-inspector.ts  mat-taskcards.ts
│   │   ├── mat-palette.ts  mat-dialog.ts  mat-toast.ts
│   │   └── editors/
│   │       ├── start-page.ts  settings-editor.ts  tag-grid.ts
│   │       ├── logging-view.ts  screen-preview.ts  device-page.ts  phase-page.ts
│   ├── theme/tokens.css  theme/base.css
│   ├── i18n/vi.ts  i18n/index.ts
│   ├── icons/icons.ts            # sprite từ @fluentui/svg-icons
│   ├── platform/tauri.ts         # gọi lệnh Rust (contracts/tauri-commands.md)
│   ├── platform/mock.ts          # lớp giả cho chế độ e2e
│   └── preview.ts                # (giữ) gắn svg-renderer + binding-engine
├── tests/e2e/shell.e2e.mjs       # Chrome headless + axe-core
└── src-tauri/src/
    ├── lib.rs                    # đăng ký lệnh, quyền cửa sổ
    ├── project_fs.rs             # + SHA-256, ghi có điều kiện
    └── recent.rs                 # project gần đây

packages/live-client/src/connection.ts   # + setTags(), unknown
docs/adr/009-studio-ui-stack.md
tools/ci-local.ps1                        # + bước e2e Studio
```

**Structure Decision**: giữ `apps/studio`. Logic tách hẳn khỏi giao diện:

- `app/`, `model/`: TS thuần, test bằng Vitest;
- `ui/`: Lit;
- `platform/`: lớp gọi Tauri, thay được bằng bản giả cho e2e.

Ba file cũ được giữ hoặc chuyển chỗ có chủ đích: `device.ts`, `preview.ts`, `project-form.ts` (thành `model/project-doc.ts`). Không thêm package mới. `packages/ui-components` để GĐ 3a, khi có widget dùng chung với runtime web.

## Complexity Tracking

Không có vi phạm Constitution.
