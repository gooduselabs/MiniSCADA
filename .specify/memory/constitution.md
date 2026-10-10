# mAT SCADA Constitution

Nguồn gốc: rút ra từ `mAT_SCADA_Master_Plan.md` (10/10/2026). Khi xung đột, Constitution này thắng; thay đổi phải qua mục Governance.

## Core Principles

### I. Vertical slice trên thiết bị thật trước
Runtime phải chạy trên BL335 (Allwinner T113-i, armhf, 1 GB RAM) và Chrome ngay từ Sprint 1 với JSON viết tay. Editor Studio được xây sau để sinh đúng định dạng runtime đã chạy ổn định. Mỗi tính năng phải được xác nhận trên thiết bị thật, không chỉ trên x64.

### II. Ranh giới kiến trúc (BẮT BUỘC)
- Browser không truy cập PLC trực tiếp; mọi Tag đi qua Tag Engine.
- Studio và Runtime dùng chung schema, expression, animation semantic (package `packages/*`). `apps/studio` không chứa logic runtime riêng; `apps/runtime-web` chỉ hiển thị, tương tác và gọi API.
- Render SVG/animation chạy trên Chrome của client, không chạy trên BL335. BL335 không cài môi trường đồ họa.
- `core/` không include code UI, không parse SVG để render. Driver chỉ phát `TagUpdate`/`WriteResult`, không ghi DB tùy ý.
- Expression engine có hai bản (TS, C++) dùng chung bộ test vector JSON.

### III. Ngân sách tài nguyên là ràng buộc cứng
RAM OS idle ≤ 200 MB; `mat-runtime` ≤ 150 MB RSS (`MemoryMax=300M`); SQLite cache ≤ 32 MB; tmpfs ≤ 64 MB. CPU: 500 Tag/1 s/10 client trung bình ≤ 30%. Ghi eMMC ≤ 2 GB/ngày. Thay đổi làm vượt ngân sách phải có số đo và ADR.

### IV. Giới hạn Chrome và 10 client
Chỉ hỗ trợ Chrome/Chromium ≥ 120. Tối đa 10 phiên WebSocket đồng thời (giới hạn cứng, client 11 nhận `MAX_CLIENTS_REACHED`, close code 4429). `maxClients` của project không được vượt giới hạn runtime.

### V. An toàn và bảo mật mặc định (NON-NEGOTIABLE)
- Không `eval`/`new Function`; không script tùy ý trong project.
- SVG import dùng allowlist trên DOM đã parse (không regex); có giới hạn kích thước/node/độ sâu.
- Mọi lệnh ghi Tag: backend kiểm role/quyền/trạng thái và ghi audit. Web SCADA không phải lớp an toàn; interlock ở PLC.
- Package: chống ZIP bomb, path traversal, checksum, schema validation; không chứa secret plaintext.
- Validator chạy ở cả Studio và Runtime; Runtime không kích hoạt project nếu validation thất bại.

### VI. Test-First và kiểm chứng
Logic (sanitizer, binding, expression, session manager, schema) viết test trước (Vitest/GoogleTest). Có test tích hợp cho WebSocket, giới hạn client, deploy/rollback. Báo cáo kết quả trung thực: test fail hoặc bước bị bỏ qua phải được nêu rõ.

### VII. Đơn giản và có phiên bản
YAGNI: MVP không vẽ path, không alarm/trend/historian, không driver ngoài Mock/Modbus. Schema theo SemVer, có migration. Deploy atomic: stage → validate → backup → activate → health check → rollback.

## Ràng buộc công nghệ

- Backend C++17, CMake + Ninja, cross-toolchain `arm-linux-gnueabihf`; web server CivetWeb (mặc định) hoặc Drogon theo benchmark.
- Studio: Tauri 2 + TypeScript + Vite (Windows 10/11). SVG gốc + SVG.js, interact.js. Test: Vitest, Playwright, GoogleTest.
- DB: SQLite WAL, `synchronous=NORMAL`. Log thường ghi tmpfs; chỉ lỗi nghiêm trọng và audit ghi eMMC.
- Rà soát license mọi thư viện/driver (LGPL link động).
- Format: clang-format, ESLint, Prettier bắt buộc trong CI.

## Quy trình phát triển (Spec-Driven)

1. Quy trình Spec Kit: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement`. Spec nằm trong `specs/<NNN-feature>/`.
2. Mỗi Sprint của Master Plan (mục 13) tương ứng một feature spec; tiêu chí nghiệm thu của sprint là acceptance criteria của spec.
3. Thao tác trên thiết bị BL335 (SSH, xóa file, đổi service) chỉ thực hiện khi người dùng yêu cầu rõ; xem thông tin truy cập trong memory, **không ghi mật khẩu vào repo**.
4. Quyết định kiến trúc ghi vào `docs/adr/`.

## Governance

Constitution thay thế mọi thực hành khác. Sửa đổi cần ghi lý do, cập nhật version, và rà soát lại các spec/plan bị ảnh hưởng. Mọi plan phải qua "Constitution Check" trước khi implement; vi phạm phải được biện minh trong mục Complexity Tracking.

**Version**: 1.0.0 | **Ratified**: 2026-10-10 | **Last Amended**: 2026-10-10
