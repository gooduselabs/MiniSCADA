# Implementation Plan: Vertical slice trên thiết bị (Sprint 1)

**Branch**: `002-vertical-slice` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-vertical-slice/spec.md`

## Summary

Thay PoC Sprint 0 bằng runtime thật đầu tiên chạy end-to-end trên BL335. Luồng dữ liệu: **Mock Tag** → `mat-runtime` (C++17, CivetWeb) → WebSocket protocol 1.0.0 → Chrome hiển thị màn hình "bồn nước + motor" viết tay theo **schema v0** bằng các package TS dùng chung. Có thêm **Studio tối thiểu** (cấu hình, kiểm tra, xem trước, mở web thiết bị).

Các điểm kỹ thuật chính (chi tiết ở [research.md](research.md)):
- Hàng đợi gửi 256 KB với một thread ghi cho mỗi phiên, cộng `resync_required`/4409 (R4).
- Snapshot và đăng ký nguyên tử với bộ phát qua `LiveHub` (R5).
- Validator đầy đủ ở hai phía (TS: `@cfworker/json-schema`; C++: valijson + nlohmann), dùng chung test vector theo mã lỗi (R1–R3).
- Kiểm Origin trước khi lấy slot; CSP cho trang và cho file project (R7).
- Shadow DOM cho mỗi màn hình, ánh xạ `data-mat-uid` (R8–R9).
- Deploy systemd ở cổng 8080 (R11).

## Technical Context

**Language/Version**:
- C++17 (GCC 9, Ubuntu 20.04 trong Docker; cross `arm-linux-gnueabihf`);
- TypeScript (theo workspace hiện có), Node cho công cụ;
- Rust (Tauri 2) cho phần native của Studio;
- Go cho load-tester.

**Primary Dependencies**:
- C++: CivetWeb (MIT, đã vendor), nlohmann/json 3.11.3 (MIT), valijson 1.0.x (BSD-2), GoogleTest 1.15.2 (BSD-3, chỉ test).
- TS: `@cfworker/json-schema` 4.1.1 (MIT), Vite, Vitest, jsdom.
- Studio: `@tauri-apps/api` 2, `@tauri-apps/plugin-dialog` 2.8.x, `@tauri-apps/plugin-opener` 2.7.x (khi cài đặt: chỉ dùng crate Rust `tauri-plugin-dialog`, `tauri-plugin-opener` gọi từ lệnh Rust, không dùng package npm của plugin; xem T080).

**Storage**: file JSON/SVG (project viết tay, config). Không có DB trong Sprint 1.

**Testing**:
- GoogleTest + CTest: build x64 trong Docker.
- Vitest + jsdom: các package, runtime-web, logic Studio.
- `cargo test`: lệnh đọc/ghi file của Studio.
- Go test + load-tester: tích hợp với máy chủ thật (x64 và BL335).
- Thủ công trên Chrome thật theo [quickstart.md](quickstart.md).

**Target Platform**:
- BL335 (Allwinner T113-i, armv7l, Ubuntu 20.04.5, kernel 5.4.61, 993 MB RAM);
- client Chrome/Chromium ≥ 120;
- Studio trên Windows 10/11 (WebView2).

**Project Type**: hệ embedded web gồm máy chủ C++ trên thiết bị, SPA hiển thị chạy trên trình duyệt, và ứng dụng desktop cấu hình.

**Performance Goals**:
- 500 Tag/1 s × 10 client (mỗi client đăng ký đủ 500 Tag): CPU TB ≤ 30 %, đỉnh ≤ 60 %;
- mở màn hình ≤ 2 s; độ trễ Tag → hiển thị ≤ chu kỳ + 500 ms;
- cold load 10 tab ≤ 5 s.

**Constraints**:
- RSS `mat-runtime` ≤ 150 MB (`MemoryMax=300M`);
- hàng đợi gửi ≤ 256 KB/client;
- tối đa 10 phiên; heartbeat 5 s, timeout 15 s;
- không `eval`/`new Function`;
- ổ D: máy dev còn khoảng 1 GB.

**Scale/Scope**: 1 project, 1 screen (khoảng 30–60 phần tử SVG, khoảng 10 binding), 5 Tag mô phỏng có nghĩa + 500 Tag tải, 10 phiên.

## Constitution Check

*GATE: kiểm trước Phase 0, kiểm lại sau Phase 1.*

| Nguyên tắc | Đánh giá | Ghi chú |
|---|---|---|
| I. Vertical slice trên thiết bị trước | ✅ | Toàn bộ nghiệm thu trên BL335 thật. Studio chỉ cấu hình và xem trước, **không** có trình vẽ (Sprint 3); Studio đọc đúng định dạng runtime đã chạy |
| II. Ranh giới kiến trúc | ✅ | Browser chỉ nói chuyện với `mat-runtime`. Hiển thị, binding và client live nằm trong `packages/*`, dùng chung cho runtime-web và Studio. `core/` không parse SVG (luật `W_UID_NOT_IN_SVG` chỉ ở TS, R3). Mock provider chỉ ghi `TagStore` qua `TagProvider` |
| III. Ngân sách tài nguyên | ✅ (cần đo) | Hàng đợi chặn bộ nhớ. Thêm tối đa 10 thread ghi. Đo SC-005/006 trên BL335; vượt thì cần ADR |
| IV. Chrome + 10 client | ✅ | Giới hạn cứng 10, kẹp config. Phiên xem trước của Studio cũng tính vào 10 |
| V. An toàn mặc định | ✅ | Không eval (lý do chọn `@cfworker/json-schema`). Sanitizer allowlist trên DOM, cộng CSP `sandbox` cho file project (khi cài đặt: bộ lọc Sprint 1 vẫn là denylist + lọc namespace; allowlist là nợ chuyển Sprint 2, đã ghi ở báo cáo nghiệm thu). Kiểm Origin. Validator chạy ở cả Studio và Runtime; runtime không kích hoạt project lỗi. Chưa có lệnh ghi Tag nên chưa cần audit |
| VI. Test-first | ✅ | Test viết trước cho schema/validator (2 bản), binding, live-client, session/queue, LiveHub, Mock provider, form Studio, lệnh file Rust. Có test tích hợp live, 10+1, client chậm, Origin, resub |
| VII. Đơn giản, có phiên bản | ✅ | Chỉ 3 transform, 7 đích; schema `0.1.0`; protocol `1.0.0`. Deploy thủ công nhưng theo đúng chuỗi stage → validate (`--check-project`) → backup → activate → health check → rollback bằng script `deployment/device/deploy.sh` (atomic qua API `/deploy/*` là Sprint 6) |
| Ràng buộc công nghệ | ✅ | C++17/CMake/Ninja/cross armhf; CivetWeb; Tauri 2 + TS + Vite; Vitest/GoogleTest. License mới đều MIT/BSD (ghi `third_party/LICENSES.md`). clang-format/ESLint/Prettier trong CI |
| Quy trình | ✅ | Spec Kit. Thao tác thiết bị chỉ trong phạm vi deploy người dùng đã yêu cầu và ghi `device-changes.md`; không đụng dịch vụ của sản phẩm cũ. ADR mới: ADR-006 (protocol live 1.0.0 + Origin), ADR-007 (cách ly màn hình bằng Shadow DOM) |

**Kết quả:** đạt. Có 1 điểm nới cần biện minh (CSP Studio), ghi ở Complexity Tracking. Kiểm lại sau Phase 1: không phát sinh vi phạm mới.

## Project Structure

### Documentation (this feature)

```text
specs/002-vertical-slice/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── live-ws.md          # protocol 1.0.0
│   ├── http-api.md
│   ├── runtime-config.md
│   └── project-format.md   # mã lỗi validator + test vector
├── checklists/requirements.md
└── tasks.md                # /speckit-tasks
```

### Source Code (repository root)

```text
schemas/                         # JSON Schema draft-07 (nguồn chuẩn, dùng ở TS và C++)
├── project.schema.json
├── tag.schema.json
├── screen.schema.json
├── binding.schema.json
└── protocol-version.json        # {"live":"1.0.0","project":"0.1"}

projects/tank-demo/              # project mẫu viết tay (deploy lên thiết bị)
├── project.json  tags.json
└── screens/ tank-motor.svg, tank-motor.screen.json, tank-motor.bindings.json

tests/
├── fixtures/svg/                # có sẵn (Sprint 0) — chỉ dùng test/lab, không deploy
└── project-vectors/<case>/      # vector dùng chung TS ↔ C++ + expected.json

packages/
├── project-schema/              # @mat/project-schema: types, validate(), mã lỗi, ProjectSource
├── svg-renderer/                # @mat/svg-renderer: sanitize, inspect (chuyển từ runtime-web), mountScreen (Shadow DOM, uid map)
├── binding-engine/              # @mat/binding-engine: transforms, quality, DomApplier (rAF), spin/level
└── live-client/                 # @mat/live-client: state.ts (chuyển từ live.ts), connection.ts: LiveConnection (backoff, 4429 30 s, watchdog, STALE)

apps/
├── runtime-web/                 # chỉ ghép: tải /api/v1/projects/active → mount → subscribe → apply; trạng thái kết nối
│   ├── index.html, src/main.ts, src/status.ts   (build thiết bị → dist-device/)
│   └── lab.html, src/lab.ts, src/lab-binding.ts  # trang thử fixture Sprint 0 (dev-only, không đóng gói);
│                                # lab-binding.ts = binding data-tag Sprint 0, giữ có chủ đích (ngoại lệ FR-013, research R8)
└── studio/
    ├── src/ (main.ts, project-form.ts, device.ts, preview.ts)
    └── src-tauri/src/ (lib.rs: project_read/project_write có kiểm path; plugin dialog, opener)

core/
├── session-manager/             # có sẵn + send_queue.hpp (256 KB) + tests (GoogleTest)
├── tag-engine/                  # tag_store.hpp/.cpp, tag_provider.hpp
└── project-manager/             # project_validator.hpp/.cpp: nạp project + validator (valijson) + mã lỗi (không tách project_loader); chạy tests/project-vectors

drivers/simulation/              # mock_tag_provider.hpp/.cpp (bồn + motor tất định, SIM.* 500)

server/
├── main.cpp                     # mat-runtime: config, khởi động, signal
├── config.hpp/.cpp              # runtime.json + CLI
├── http/                        # http_api.cpp: /, /assets/ theo allowlist (gz, ETag, CSP), /api/v1/system/info, /api/v1/projects/active, /project/* allowlist
├── websocket/                   # live_hub (giao thức, độc lập CivetWeb) + civet_transport (Origin, writer thread)
└── poc/main.cpp                 # PoC Sprint 0 giữ để tái lập số đo (target mat-poc, không deploy)

tools/
├── project-validator/validate.mjs
└── load-tester/                 # + protocol 1.0.0, -tags sim, -slow, -origin, -resub

deployment/
├── systemd/mat-runtime.service  # (mat-poc.service giữ lại làm lịch sử)
├── config/runtime.json
├── package-runtime.ps1          # gói armhf + web + project; chặn fixture/lab
├── device/deploy.sh, device/rollback.sh  # chạy trên BL335: stage→validate→backup→activate→health→rollback
└── toolchain/run-x64.ps1        # chạy mat-runtime x64 trong container để thử cục bộ

docs/
├── adr/006-live-protocol-v1.md, adr/007-screen-isolation.md
├── deployment/mat-runtime.md    # hướng dẫn deploy thủ công + hoàn tác
└── reports/sprint1-*.md|csv|json, device-changes.md (cập nhật)

third_party/ nlohmann/, valijson/, googletest/, LICENSES.md
```

**Structure Decision**: theo cây thư mục ở Master Plan §5 (`schemas/`, `core/`, `drivers/`, `server/`, `packages/`, `apps/`, `tools/`, `deployment/`). Logic có trạng thái của máy chủ được tách khỏi CivetWeb (`LiveHub`, `SessionManager`, `SendQueue`, `TagStore`, validator) để unit test không cần mạng. `server/websocket/civet_transport` là lớp mỏng duy nhất phụ thuộc CivetWeb (ADR-001: đổi web server được). Project mẫu nằm ở `projects/` (không trong `tests/`) vì nó được deploy.

### Ghi chú thiết kế chính

- **Luồng thread máy chủ:**
  - Thread `ticker` (mỗi `deltaPeriodMs`): `provider.step()` → `hub.tick()`. Trong `hubMu`, tick lấy dirty set, dựng delta theo từng phiên rồi `push` vào `SendQueue`. Mỗi 5 s tick đưa heartbeat vào hàng đợi, và gọi `sessions.expireIds()` để đóng 4408. **Khi cài đặt:** việc đóng 4408 nằm ngoài `hub.tick()`: sau mỗi tick, vòng lặp chính gọi `transport.expire()` (dùng `SessionManager::expireIds()`), hàm này cũng cắt TCP các kết nối quá hạn chót 5 s sau close frame.
  - Thread CivetWeb: `connect` (Origin) → `ready` (`tryAcquire`, tạo phiên + writer) → `data` (parse, `hub.onMessage`) → `close` (release, dừng writer).
  - Mỗi phiên có 1 writer thread: chờ trên `SendQueue` rồi gọi `mg_websocket_write`. Khi gặp lệnh đóng thì gửi khung close.
- **Bộ nhớ:** snapshot 500 Tag khoảng 50 KB JSON, nằm trong giới hạn 256 KB. Khi `push` snapshot vào hàng đợi, phần đang chờ được tính đúng vào ngân sách.
- **Runtime web:** `main.ts` gọi `GET /api/v1/projects/active` → `mountScreen(svgText, screen)` → lấy danh sách Tag từ bindings → `LiveConnection.subscribe(tags)` → `DomApplier.apply(changes)`. API khi cài đặt: `mountScreen(host, svgText, layout)` → `new DomApplier({ elements, bindings, tagTypes })` → `new LiveConnection({ url, tags: applier.tagIds() }).start()` (tự gửi `subscribe` sau mỗi lần kết nối) → `applier.update(changes)`. Badge trạng thái theo `LiveConnection.state`. Tham số `?debug=1` hiện bộ đếm sequence gap, deltas.
- **Studio:**
  - Dùng `ProjectSource` kiểu Tauri (lệnh Rust) để `validate()` đọc file.
  - Form sửa `project.json`/`tags.json` qua `applyProjectEdits`, rồi validate lại toàn bộ trước khi `project_write` (atomic).
  - Xem trước dùng SVG/bindings cục bộ với Tag từ thiết bị (`LiveConnection` tới `ws://host:port/api/v1/live`).
- **Tương thích Sprint 0:** `tools/measure/svg-load.mjs` trỏ sang `lab.html` trên dev/x64 (khi cài đặt: script nhận URL đầy đủ, phải truyền `…/lab.html`; xem T028). Load-tester giữ được chế độ cũ (`-proto 0`) để chạy lại PoC khi cần.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| CSP Studio nới `connect-src` thêm `http: ws:` (không giới hạn host) | Địa chỉ BL335 do kỹ sư nhập lúc chạy; CSP Tauri là tĩnh lúc build | Proxy mọi HTTP/WS qua Rust: phải tự viết cầu nối WebSocket và tăng mã. Giới hạn theo dải IP cố định: không đúng ở công trường khác. Giảm thiểu: Studio chỉ kết nối tới địa chỉ đã nhập, không tải script từ xa (`script-src 'self'` giữ nguyên) |
| Thêm tối đa 10 thread ghi trong `mat-runtime` | Ghi CivetWeb là chặn; cần cô lập client chậm (ADR-001 phương án C) | Một thread ghi chung: client chậm chặn tất cả. Ghi không chặn: CivetWeb không có API |
| Giữ `server/poc/main.cpp` (target `mat-poc`) | Tái lập số đo Sprint 0 trong báo cáo Go/No-Go | Xóa: mất khả năng chạy lại số đo đã công bố. Chi phí: chỉ build, không deploy |
