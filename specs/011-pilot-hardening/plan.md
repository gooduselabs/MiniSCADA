# Implementation Plan: Hoàn thiện và pilot, trình vẽ SVG đầy đủ, logic v2

**Branch**: `011-pilot-hardening` | **Date**: 2026-10-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/011-pilot-hardening/spec.md`

## Summary

GĐ 6 của [lộ trình v2](../../docs/plans/roadmap-v2.md) (§4.7), một feature gồm 9 user story giao riêng (D1, R1). Đưa sản phẩm từ "chạy được trên x64 và một phiên đo ngắn trên BL335" tới "giao được cho khách hàng": bằng chứng độ bền và an toàn, bộ cài tin cậy được, cập nhật từ xa an toàn, thêm logic và trình vẽ SVG đầy đủ, tài liệu và pilot.

Cách làm ([research.md](research.md) R1–R32):

- **Bảo mật và xử lý phát hiện tồn (US1)** (ADR-036): allowlist `Host` (IP literal luôn nhận, tên miền phải khai); khóa đăng nhập theo cặp (tên, IP) + khóa IP + giới hạn đồng thời; nhật ký xung bền và nhả khi khởi động; Modbus TCP cô lập timeout theo `transactionId`; `persist()` ngoài mutex; từ chối file thừa trong gói; giới hạn kết nối theo nguồn; `cppcheck`, `clang-tidy`, `cargo audit`, `npm audit`, rà license, fuzz 7 mục tiêu; mô hình mối đe dọa; review bằng hai agent.
- **Tải, soak, mất điện (US2):** bộ lấy mẫu `mat-sample` (tmpfs), `--check-data`, `load-tester` mở rộng, bộ điều khiển nguồn, tiền kiểm x64, rồi đo trên BL335 (7 ngày, 100 lần cắt điện, tải 500 và 1.000 Tag, tuổi thọ eMMC).
- **Bộ cài ký số (US3)** (ADR-035): `sign.ps1` ba chế độ (kho/token, lệnh ngoài, thử), cổng `-Release` từ chối chứng chỉ thử, chứng chỉ thử cho dev, `release.ps1` một lệnh (bộ cài, gói runtime, `.matupdate`, `SHA256SUMS` ký ECDSA P-256, SBOM CycloneDX, báo cáo license); chứng chỉ thật là việc người.
- **OTA (US4)** (ADR-035): `.matupdate` (tar ba thành viên + ECDSA P-256), `mat-update-verify` tĩnh nhỏ, runtime không đặc quyền kiểm sơ bộ, `mat-updater` (root, oneshot) kiểm lại và thay thế nguyên tử bố cục `/opt/mat-runtime{,.prev}`, kiểm sức khỏe 60 s, tự quay về; mặc định tắt; quy trình thủ công vẫn hỗ trợ.
- **Logic v2 (US5)** (ADR-037): `logic.json` khai báo (luật, timer, counter, totalizer, giờ chạy, lịch, `writes`), hai engine (TS mô phỏng, C++ runtime) cùng vector; ghi PLC khai báo, giới hạn, audit bền, mặc định tắt, dừng khẩn cấp; trạng thái giữ qua `RetainStore`.
- **Trình vẽ SVG (US6) và template/faceplate (US7)** (ADR-038): `@mat/svg-edit` (mô hình thuần, lệnh đảo ngược 100 bước, hình học và bắt dính có bảng test), editor Studio trên DOM thật, lớp, tự lưu, tuần tự hóa chuẩn tắc; template bung khi lưu (runtime không đổi), faceplate là popup có tham số thay chuỗi lúc chạy, validator bung mọi tổ hợp.
- **Tài liệu và pilot (US8, US9):** ba hướng dẫn, giáo trình, hồ sơ pilot, `docs-check`, `kpi.mjs`, tiêu chí vào/ra số hóa, Go/No-Go.

Quyết định ghi trong ADR [035](../../docs/adr/035-release-trust-ota.md), [036](../../docs/adr/036-security-hardening.md), [037](../../docs/adr/037-logic-v2.md), [038](../../docs/adr/038-svg-editor-templates.md) (Proposed). Mockup: `docs/architecture/mockups/studio-logic.html`, `studio-svg-draw.html` (task T005, T006; tự duyệt T007).

**Phiên bản:** runtime **1.0.0**, Studio **1.0.0**, định dạng project **1.0.0**, gói `.matupdate` **1.0.0**; bản dựng trong feature là `1.0.0-rc.N`, gắn `1.0.0` ở Go/No-Go (D2, R2). Giao thức live giữ nguyên số (1.3.0 của GĐ 4); gói `.matscada` giữ 1.0.0; API thiết bị tăng MINOR kế tiếp.

**Các feature đứng trước** (T003 chốt ngày 2026-10-16 khi bắt đầu làm; bản viết 2026-10-13 dự kiến 008 và 009 chưa có mã):

| Feature | Giai đoạn | Runtime | Studio | Định dạng project | API thiết bị | Ghi chú |
|---|---|---|---|---|---|---|
| [007](../007-screens-widgets/plan.md) | 3a | 0.6.0 | 0.5.0 | 0.3.0 | 1.2.0 | đã có mã |
| [008](../008-svg-import-binding/plan.md) | 3b | 0.7.0 | 0.6.0 | 0.4.0 | 1.2.0 | **đã có mã**: `@mat/svg-import` (allowlist `sanitizeSvg`), `@mat/symbol-library`, `@mat/svg-renderer`, `@mat/binding-engine`, sự kiện SVG |
| [009](../009-alarms/plan.md) | 4 | 0.8.0 | 0.7.0 | 0.5.0 | 1.3.0 | **đã có mã**; live 1.3.0 |
| [010](../010-history-reports/plan.md) | 5 | 0.9.0 | 0.8.0 | 0.6.0 | 1.4.0 | **đã có mã**; lưu trữ, tổng hợp, biểu đồ lịch sử, báo cáo XLSX/PDF |
| **011** | 6 | **1.0.0** | **1.0.0** | **1.0.0** | **1.5.0** | live giữ 1.3.0 trừ khi logic cần trường mới |

Chuỗi định dạng trung gian: 0.3 → 0.4 → 0.5 → 0.6 (schema 0.3–0.5 đóng băng ở `schemas/0.3`…`0.5`, gốc `schemas/` là 0.6); migration 1.0.0 đi tiếp từ 0.6. ADR 035–038 đã có (Proposed); ADR-039 là bộ đếm ghi SQLite của 010, nên ADR mới của 011 bắt đầu từ 040. Quyết định (người dùng giao toàn quyền 2026-10-16): API thiết bị 1.5.0 là MINOR kế tiếp của 1.4.0; không cần ghi "US6, US7 chờ" vì mã importer của 008 đã có.

## Technical Context

**Language/Version**:

- C++17 (GCC 9 trong Docker Ubuntu 20.04; cross `arm-linux-gnueabihf`);
- TypeScript 7 (Vite 8, Lit 3.3.3);
- Rust 1.99, edition 2024 (Tauri 2.12): thêm lệnh chỉ-đọc và lệnh OTA;
- Node ≥ 22 cho công cụ; PowerShell 5.1, sh (POSIX) cho `mat-updater`, `mat-sample`; Go (`tools/load-tester`).

**Primary Dependencies**:

- **Runtime C++:** không thêm thư viện. `core/update` và `mat-update-verify` dùng Mbed TLS 3.6.7 và SHA-256 có sẵn (kiểm cấu hình có ECDSA P-256: T008). CivetWeb 1.16 thêm bản vá nhỏ `init_connection` nếu cần (đánh dấu "mAT patch 5", T048).
- **Studio và trang:** không thêm gói npm hay crate. `@mat/logic-engine` và `@mat/svg-edit` là package nội bộ. Bộ chuyển Markdown → HTML của tài liệu: dùng `marked` nếu đã có trong workspace, nếu không thì bộ tối giản tự viết (T178).
- **Công cụ phát hành:** `signtool` (Windows SDK 26100, có sẵn), `openssl` (container toolchain), Node `crypto`.
- **Công cụ kiểm tra:** `cppcheck`, `clang-tidy` (container; chỉ chạy, không link), `cargo-audit` (🌐; cài từ crates.io phiên bản ≥ 2 tuần, ghi vào quy trình, không vào dự án).
- **Test:** GoogleTest, Vitest, puppeteer-core, axe-core (có sẵn), Pester không dùng (dùng `node --test` gọi PowerShell).

**Storage**:

- **BL335:** `<dataDir>/{pulse.journal, update/, logic-state.json, auth-unlock.req}`, `retain/logic/`, `/etc/mat-runtime/trusted-keys/`, `/var/lib/mat-updater/`, `/opt/mat-runtime{,.new,.prev,.failed}`, `/run/mat-sample/` (tmpfs); `audit.db` không đổi lược đồ; `history.db` không đổi.
- **Project:** `logic.json`, `templates/*.template.json`, `tpl`, `params`, `args`, `.mat-editor/` (ngoài gói).
- **Máy dev:** `release/<ver>/` (không commit), `docs/pilot/data/` (không commit).

**Testing**:

- GoogleTest + CTest x64 (Docker), armhf qemu-user, ASan + UBSan; Vitest (vector chung `logic-vectors`, `project-vectors` `v10-*`, hình học SVG, hoàn tác, KPI); `node --test` cho công cụ phát hành, soak, powercut, docs; e2e Chrome headless + axe-core (editor SVG, logic, OTA, faceplate); `tools/{device,driver,web,update,logic}-it.ps1` trên mạng Docker; fuzz 1 giờ × 7 mục tiêu.
- **Thiết bị và người:** BL335 (soak, mất điện, tải, OTA thật), Windows 10/11 sạch (cài bộ cài ký), người thử (SC-029, SC-036, SC-038), khách hàng (pilot).

**Target Platform**: BL335 (armhf, Ubuntu 20.04, kernel 5.4, 1 GB RAM, eMMC 8 GB); Studio trên Windows 10 (1809+)/11 x64; Chrome ≥ 120.

**Project Type**: sản phẩm nhiều thành phần: runtime C++, Studio Tauri, gói TS dùng chung, công cụ.

**Performance Goals** (spec SC): xem bảng SC-011 đến SC-016 (tải, soak), SC-020 (OTA ≤ 30 s ngừng), SC-028 (logic ≤ +3 điểm CPU, ≤ +5 MB, quét ≤ 5 ms), SC-033 (SVG 2.000 phần tử ≤ 16,7 ms/khung, 20.000 nút ≤ 3 s).

**Constraints**: ngân sách BL335 (Constitution III); không script (V); không thư viện mới; mọi thay đổi trên BL335 do người cho phép (quy trình bước 3); đang có lượt `ci-local` chạy: mã chỉ sửa sau khi nó kết thúc.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution 2.0.2 (PATCH 2026-10-16, T004 xong; trước đó 2.0.1).

| Nguyên tắc | Đánh giá | Ghi chú |
|---|---|---|
| I. Vertical slice trên thiết bị thật | ✅ (cần đo) | Chính feature này là nghiệm thu trên thiết bị thật: soak 7 ngày, 100 lần cắt điện, tải, OTA, pilot. Mọi thứ chạy x64 trước; kết luận chỉ khi có số BL335 (SC-011 đến SC-016, SC-023, SC-028, SC-040) |
| II. Ranh giới kiến trúc | ✅ | Logic có hai engine dùng chung vector (như biểu thức); mô phỏng Studio dùng bản TS; `core/logic` không có UI; trình vẽ SVG ở `packages/svg-edit` + Studio, không vào runtime; template không đổi runtime; faceplate dùng `substituteParams` chung. `core/` không include UI; trình vẽ không parse SVG để render ở BL335 |
| III. Ngân sách tài nguyên | ✅ (cần đo) | Logic ≤ +3 điểm CPU, ≤ +5 MB RSS (đo x64 rồi BL335); OTA không chạy thường trực (root oneshot); `mat-sample` ghi tmpfs; ghi eMMC thêm: audit logic ≤ 20 lệnh/phút (≈ 0,9 GB/ngày trong trần), retain logic ≤ 100 MB/ngày (cảnh báo), nhật ký xung nhỏ; tổng ≤ 2 GB/ngày kiểm ở soak (SC-013) |
| IV. Chrome ≥ 120, 10 client | ✅ | Không tính năng mới hơn Chrome 120; `maxConnPerSource` không đổi giới hạn 10 phiên; soak và tải kiểm client 11 (4429) |
| V. An toàn, bảo mật (NON-NEGOTIABLE) | ✅ (2.0.2) | (1) Không `eval`/script: logic khai báo; lint mở rộng. (2) Mọi lệnh ghi qua `WriteCoordinator`, kiểm quyền, audit bền trước khi gửi; **ghi từ logic và nhả xung khi khởi động không do người đăng nhập**: ủy quyền bởi người nạp xuống (engineer) và danh sách `writes` (xung: lệnh gốc đã được ủy quyền và audit), mặc định tắt ở `runtime.json` (root), giới hạn tần suất, dừng khẩn cấp (administrator); đã làm rõ ở **PATCH 2.0.2** (D22, T004, 2026-10-16). (3) OTA qua mạng chỉ HTTPS + Bearer + administrator + xác thực lại mật khẩu + audit, mặc định tắt, chữ ký ECDSA, kiểm lại ở root; đã làm rõ ở PATCH 2.0.2. (4) SVG: lệnh editor kiểm allowlist trước khi áp dụng; dán qua parser DOM, không regex; giới hạn 5 MB/20.000 nút/độ sâu 32. (5) Package: thêm từ chối file thừa. (6) Phát hiện Medium của 005–007 được xử lý. (7) Bí mật không vào repo (khóa, mật khẩu, PIN). |
| VI. Test-First | ✅ | Mọi task cài đặt có task test đỏ trước; vector chung cho logic, project, gói, cập nhật; 30 gói xấu; 150 ca hình học; fuzz; báo cáo trung thực ("Chưa đo") |
| VII. Đơn giản và có phiên bản | ✅ | Đúng phạm vi GĐ 6 (§4.7); mảng sau pilot không làm (D28). YAGNI: không ladder, không Bézier, không DST, không tự cập nhật Studio, không A/B phân vùng. SemVer: 1.0.0 có migration; deploy/OTA atomic (stage → validate → backup → activate → health check → rollback) |
| Ràng buộc công nghệ | ✅ | C++17/CMake/Ninja/armhf, CivetWeb, Mbed TLS, SQLite WAL `NORMAL`; `audit.db` FULL (ngoại lệ 2 đã chấp thuận) bao phủ audit logic và OTA với số lượng bị chặn; `pulse.journal` dùng `fdatasync` (không phải SQLite); không thêm thư viện ngoài; SVG.js và interact.js (Master Plan §4) **không dùng**: lý do R24 |
| Quy trình | ✅ | Spec Kit; ADR 035–038; mockup trước code giao diện; thao tác BL335 chỉ khi người cho phép; không ghi bí mật vào repo |

**Kết quả trước Phase 0:** đạt (Constitution 2.0.2, 2026-10-16): PATCH 2.0.2 (T004) đã làm rõ nguyên tắc V cho ghi PLC của logic và đường OTA ở runtime; được viết mã hai phần này. Không có `NEEDS CLARIFICATION`: mọi điểm để ngỏ đã chọn ở research, ghi "Quyết định (người dùng giao toàn quyền 2026-10-11)".

**Kiểm lại sau Phase 1** (data-model, contracts):

- **Bề mặt mới:** `POST /system/update*` (5 endpoint, administrator), `GET/POST /logic*`, `mat-updater` (root), `pulse.journal`. Mọi endpoint mới `cookieAllowed = false` trừ `GET /logic`.
- **Đường ghi Tag:** vẫn một (`WriteCoordinator`); nguồn mới `logic`, `pulse-recovery`.
- **Điểm thay đổi so với ADR cũ:** ADR-011 (khóa theo tên → theo cặp), ADR-012 (từ chối file thừa), ADR-018/021 (kiểm `Host`), ADR-017 (nhật ký xung), ADR-014 (cô lập timeout đa unit) — ghi ở ADR-036; ADR-005 thêm dòng "Cập nhật 011" (số đo).
- **Điểm cần phiên chính duyệt:** câu hỏi 1, 2 ở mục "Câu hỏi cho phiên chính" (đã trả lời).

## Project Structure

### Documentation (this feature)

```text
specs/011-pilot-hardening/
├── spec.md              # US1–US9, FR-001–FR-143, SC-001–SC-043, D1–D38
├── plan.md              # file này
├── research.md          # R1–R32
├── data-model.md        # tệp trên thiết bị, logic.json, .mat-editor, release, pilot
├── quickstart.md        # kiểm chứng từ máy dev tới BL335
├── contracts/
│   ├── device-api-011.md        # Host, khóa đăng nhập, OTA API, logic API, diagnostics, runtime.json, CLI, mã lỗi
│   ├── update-package.md        # .matupdate, mat-updater, 8 bước, 30 gói xấu
│   ├── release-signing.md       # Authenticode, khóa ECDSA, release.ps1, 12 ca hỏng
│   ├── logic-engine.md          # logic.json, ngữ nghĩa, vector
│   ├── project-format-1.0.md    # 1.0.0, template, faceplate, quy tắc tập tệp
│   ├── svg-editor.md            # mô hình tài liệu, lệnh, hình học, trạng thái
│   └── test-protocols.md        # tải, soak, eMMC, mất điện, pilot, KPI
├── checklists/requirements.md
└── tasks.md             # T001–T208
```

### Source Code (repository root)

```text
core/
├── auth/login_guard.*, auth_service.*, account_store.*   # SỬA: khóa theo cặp, đồng thời, quyền users.json
├── tag-engine/pulse_journal.*, write_coordinator.*        # MỚI/SỬA: nhật ký xung, nguồn logic, hẹn lại
├── project-store/deploy_pipeline.cpp                      # SỬA: persist() ngoài mutex
├── package/{package_check,package_rules,project_digest}.* # SỬA: file thừa
├── project-manager/rules_10.*, rules_logic.*              # MỚI: validator 1.0.0 và logic
├── logic/                                                 # MỚI: engine runtime
├── update/                                                # MỚI: phong bì, chữ ký, manifest
├── diagnostics/proc_stats.*                               # SỬA: KPI
└── session-manager/                                       # SỬA: liveLagP95Ms
drivers/modbus/modbus_tcp_driver.*, drivers/sdk/{backoff,scheduler}.*   # SỬA: cô lập timeout
server/
├── host_policy.*, time_sync.*, ssh_audit.*, logic_glue.*, update_service.*   # MỚI
├── http/{conn_limit,update_api,logic_api}.*, auth_gate.cpp, http_api.cpp, web_api.cpp, viewer_gate.cpp  # MỚI/SỬA
├── cli/{check_data,self_check,trust_key,update_status,users}.*   # MỚI/SỬA
├── updater/verify_main.cpp                                # MỚI: mat-update-verify
└── config.*, runtime_engine.cpp, write_subsystem.cpp, main.cpp   # SỬA
deployment/
├── device/{deploy.sh,mat-updater.sh,mat-updater-recover.sh,mat-sample.sh}, device/tests/   # MỚI/SỬA
├── systemd/{mat-updater.service,mat-updater.path,mat-updater-recover.service}              # MỚI
├── keys/                                                  # khóa công khai phát hành (người cung cấp)
└── package-runtime.ps1, config/runtime.json               # SỬA
packages/
├── logic-engine/                                          # MỚI (TS)
├── svg-edit/                                              # MỚI (TS)
├── project-schema/src/{migrate,rules-10,rules-logic,params,project-files,package-digest}.*   # SỬA/MỚI
├── ui-components/src/{control,chart,screen,widgets}/      # SỬA: nhấp 400 ms, ChartWindow, faceplate
└── svg-renderer/src/sanitize.ts                           # SỬA nhỏ: data-mat-layer, data-mat-name
apps/
├── runtime-web/src/{popup-host,action-host,project-store}.ts   # SỬA: faceplate, #poll
└── studio/
    ├── src/{model,ui/svg,ui/logic,ui/dialogs,ui/editors}/ # MỚI/SỬA
    ├── src-tauri/{tauri.conf.json,src/device/{update,logic}.rs,src/signature.rs,src/package/} # MỚI/SỬA
    └── tests/e2e/{svg-editor,logic,template,svg-perf}.e2e.mjs
schemas/{logic,template}.schema.json, {screen,project}.schema.json, widgets.catalog.json, error-codes.json, 1.0/   # MỚI/SỬA
tools/{release,soak,powercut,pilot,sast,fuzz}/, update-it.ps1, logic-it.ps1, docs-check.mjs, gen-error-codes.mjs, build-docs.mjs, gen-bench-projects.mjs, load-tester/, modbus-sim/   # MỚI/SỬA
tests/{logic-vectors,update-vectors,svg-editor-fixtures,pilot-kpi,fuzz-corpus}/, project-vectors/ (v10-*), package-vectors/, migration-vectors/, web-it/   # MỚI/SỬA
projects/{logic-demo,logic-load,bench-1000,soak-standard,training-demo}/, dashboard-demo/ (thêm template, faceplate)   # MỚI/SỬA
docs/{user,training,pilot,release,architecture/threat-model.md,deployment/hardening.md,plans/post-1.0-backlog.md,adr/035–038,reports/011-*,architecture/mockups/studio-{logic,svg}.html}   # MỚI
```

**Structure Decision**: tách `@mat/svg-edit` (không DOM) khỏi editor để kiểm bằng Vitest nhanh và để hoàn tác, hình học, tuần tự hóa có bảng test; `core/logic` và `packages/logic-engine` là hai bản của một ngữ nghĩa (như biểu thức); `server/updater/` chứa chỉ `mat-update-verify` (nhỏ, tách khỏi `mat-runtime`) còn phần thay thế là shell của `deployment/device/`.

### Ảnh hưởng tới mã của 003 đến 010

| Nơi | Thay đổi | Cách kiểm hồi quy |
|---|---|---|
| `core/auth` (005) | khóa theo cặp, đồng thời, CLI | `device-it -Scenario auth`, `web-it -Scenario attack` (30 ca của 007) |
| `core/project-store/deploy_pipeline.cpp` (005) | `persist()` | `device-it` `deploy`, `kill` (24 vòng), `health`, `busy` |
| `core/package` (005) | file thừa | `tests/package-vectors` (82 ca cũ giữ kết luận) |
| `drivers/modbus` (006) | cô lập timeout | `driver-it` `unplug`, `faults`, `merge`, `split`, `read`, `write*` |
| `core/tag-engine/write_coordinator` (006, 007) | nhật ký xung, nguồn `logic` | `driver-it` `write`, `write-race`, `write-kill`; `web-it` `pulse`, `expect` |
| `server/http/*` (005–007) | `Host`, giới hạn kết nối | `web-it` (mọi kịch bản), `device-it` |
| `packages/ui-components`, `apps/runtime-web` (007) | nhấp 400 ms, ChartWindow, faceplate | Vitest, e2e runtime-web, `web-it` |
| `packages/project-schema`, `core/project-manager` | định dạng 1.0.0, logic | vector chung 0.1, 0.2, 0.3 giữ kết luận |
| `deployment/device/deploy.sh` (005) | cài updater, khóa, kiểm chữ ký | `deployment/device/tests`, smoke armhf |
| 008, 009, 010 (feature riêng, có thể đang làm song song) | hợp nhất ở `schemas/*`, `runtime_engine.cpp`, `registry.ts`, `widgets.catalog.json`, `binding.schema.json` | rebase theo story; vector chung; migration 0.3 → 0.4 → 0.5 → … → 1.0.0 |

## Phát hiện tồn (bảng truy vết, FR-035, SC-001)

Nguồn: [005-acceptance §9](../../docs/reports/005-acceptance.md), [006-acceptance §12](../../docs/reports/006-acceptance.md), [007-security-review §2](../../docs/reports/007-security-review.md). Trạng thái ban đầu 2026-10-13; **cập nhật 2026-10-17 (T065)** theo "Ghi chú khi làm" của tasks.md ở mốc `cd0046b`. Mỗi dòng ánh xạ tới một mục của [mô hình mối đe dọa](../../docs/architecture/threat-model.md) §6. **Medium: 18 mục**: 10 đã sửa kèm test trong 011 (P-01, P-12 còn đo BL335 chờ người), 6 đã đóng từ trước kèm bằng chứng, 1 cảnh báo và tài liệu xong còn áp dụng chờ người (P-03), 1 chờ làm (P-05). Không dòng nào ở trạng thái "ghi nhận".

| ID | Nguồn | Mức | Phát hiện | Xử lý trong 011 | Task | Test hoặc bằng chứng | Trạng thái |
|---|---|---|---|---|---|---|---|
| P-01 | 005 | Medium | WebSocket live trên HTTPS và 8 worker bị chiếm làm đăng nhập và nạp xuống ngừng | giới hạn kết nối theo nguồn đếm lúc `accept()` (R10, mAT patch 5); `httpsThreads` 64, `maxConnPerSource` 48, trần 75 % (ADR-010, đổi 2026-10-17 sau `web-it f5x10`) | T039, T048, T063 | `conn_limit_test` (đỏ 3 rồi xanh; 60 kết nối TLS im lặng một nguồn, nguồn khác 25 ms); `web-it f5x10` 4/4 | **Đã sửa kèm test** (x64); đo RAM và đăng nhập trên BL335 chờ người ⚠️🔌 (T063) |
| P-02 | 005 | Medium | Đăng nhập thành công xóa bộ đếm sai theo nguồn | chỉ xóa bộ đếm cặp (R5) | T033, T034, T043 | `login_guard_test` (đỏ 18/19 rồi 19/19), `auth_gate_test`, `web_gate_test` | **Đã sửa kèm test** |
| P-03 | 005 | Medium | SSH root bằng mật khẩu và port-forward 9080 HTTP | cảnh báo `SSH_ROOT_PASSWORD` (`server/ssh_audit.cpp`); hướng dẫn [hardening.md](../../docs/deployment/hardening.md) (SSH khóa công khai, đóng 9080 và 22, VPN, `nft`); **áp dụng lên thiết bị cần người** | T040, T049, T061, T064 | `ssh_warning_test` (đỏ 10/13 rồi 13/13); `docs/deployment/hardening.md` | Cảnh báo và tài liệu: **xong**; áp dụng: **chờ người** ⚠️🔌 (T064) |
| P-04 | 005 | Medium | `persist()` giữ mutex khi fsync, ghi dư, lỗi `writeOp` chỉ ghi log | ngoài mutex, `PERSIST_FAILED`, bỏ ghi dư (R8) | T038, T047, T054 | `deploy_pipeline_test` (đỏ 3 rồi 29/29, gồm ca hồi quy `DEVICE_BUSY`) | **Đã sửa kèm test**; kịch bản `device-it persist-slow` (T054) còn mở |
| P-05 | 005 | Medium | Gói có file thừa làm lệch digest | từ chối ở mọi tầng (R9) | T022, T023, T024, T054 | (chưa có) | **Chờ làm** (T022–T024 chưa xong ở `cd0046b`); hiện an toàn nhờ rollback `HEALTH_TIMEOUT` |
| P-06 | 006 | Medium | Unit còn `PrivateDevices=true`, RTU chưa mở được cổng | **đã đóng từ trước**: unit hiện hành `DevicePolicy=closed`, `DeviceAllow=char-ttyAS rw` (đo trên BL335 ngày 2026-10-13); thử RS485 thật vẫn là việc của 006 | — | `deployment/systemd/mat-runtime.service` | Đã đóng kèm bằng chứng |
| P-07 | 006 | Medium | TCP: timeout làm đóng kết nối và BAD mọi Tag của kênh | cô lập theo `transactionId`, backoff riêng thiết bị (R7) | T037, T046, T054 | `modbus_tcp_multiunit_test` (đỏ 5 rồi 9/9), modbus-sim 27/27, `driver-it` trong ci-local | **Đã sửa kèm test**; `driver-it gateway-multiunit` (T054) còn mở |
| P-08 | 006 | Medium | `::alarm(20)` có thể ngắn hơn thời gian quiesce | **không đổi** theo kết luận của 006 (quiesce chạy ở hook riêng trước hook `restart`) | — | `006-acceptance` §12 dòng 4; `device-it kill` | Đã đóng kèm bằng chứng |
| P-09 | 006 | Medium | `RetainStore::createFresh` thất bại mà báo bình thường | **đã sửa** ở 006 (`lastError` cảnh báo stderr); logic 011 dùng chung `RetainStore` | T131, T139 | `006-acceptance` §12 dòng 5; `server/tests/logic_runtime_test.cpp` | Đã đóng kèm bằng chứng |
| P-10 | 007 | Medium | Khóa theo tên gây DoS đăng nhập | khóa theo cặp (tên, IP) + khóa IP (R5) | T033, T043, T053 | `login_guard_test`; `auth_gate_test` (IP khác vào < 2 s khi IP A bị khóa) | **Đã sửa kèm test**; `web-it lockout-dos` (T053) còn mở |
| P-11 | 007 | Medium | Không có allowlist `Host`: DNS rebinding | `HostPolicy` ở `begin_request` của CivetWeb (R4) | T032, T042, T053, T063 | `host_policy_test` (22/22, gồm HTTP, HTTPS, nâng cấp WebSocket) | **Đã sửa kèm test**; `web-it host-rebind` (T053) và BL335 (T063) còn mở |
| P-12 | 007 | Medium | Cạn worker HTTPS bởi kết nối TLS im lặng (S-M3, R-7) | như P-01; `nft ct count` ở [hardening.md](../../docs/deployment/hardening.md) §5 | T039, T048, T061, T063 | như P-01 | **Đã sửa kèm test** (x64); đo BL335 chờ người ⚠️🔌 |
| P-13 | 007 | Medium | Xung `pulseMs`: kill -9 để bit lệnh bật (S-L6/R-3) | nhật ký xung bền, nhả khi khởi động (R6) | T036, T045, T054, T085 | `pulse_journal_test` (đỏ 20/21 rồi 22/22), `write_coordinator_test` 39/39 | **Đã sửa kèm test**; `driver-it pulse-recovery` (T054) còn mở; cắt điện thật chờ người ⚠️🔌 (T085) |
| P-14 | 007 | Medium | `releasePulse` ngủ tối đa 500 ms trên luồng xung duy nhất (R-6) | hẹn lại 100 ms, không ngủ | T036, T045 | `write_coordinator_test` (ca "nhả không ngủ": bị chặn ~500 ms rồi xanh) | **Đã sửa kèm test** |
| P-15 | 007 | Medium | `ChartWindow` bỏ mẫu khi đồng hồ nguồn lùi (R-8) | đặt lại cửa sổ khi lùi > 2 s | T041, T050 | `chart/window.test.ts` (đỏ 2 rồi xanh) | **Đã sửa kèm test** |
| P-16 | 007 | Medium | `ProjectStore.open()` lần hai nhận kết quả của project cũ (R-4) | **đã sửa** ở 007 (thế hệ `#gen`) | — | `007-security-review` R-4 (test đỏ rồi xanh) | Đã đóng kèm bằng chứng |
| P-17 | 007 | Medium | `mat-screen` dùng lại phần tử giữa các màn hình (R-5) | **đã sửa** ở 007 (slot theo id màn hình) | — | `007-security-review` R-5 | Đã đóng kèm bằng chứng |
| P-18 | 007 | Medium (test) | `expect`: kiểm "không gì tới thiết bị" chấp nhận 1 hoặc 2 lệnh (R-9) | **đã sửa** ở 007 (đúng 0 lệnh) | — | `007-security-review` R-9 | Đã đóng kèm bằng chứng |

**Mục Medium/High đã đóng trong chính feature 006–010** (không thuộc phạm vi FR-035; liệt kê để mô hình mối đe dọa §6 truy vết đủ):

| ID | Nguồn | Mức | Phát hiện | Trạng thái và bằng chứng |
|---|---|---|---|---|
| H-01 | 006 §12 #1 | High | `WriteCoordinator::submit`: hai yêu cầu cùng `requestId` ghi hai lần | đã sửa ở 006, `WriteCoordinator.ConcurrentRequestsWithTheSameIdRunOnlyOnce` |
| H-02 | 007 F-1 | High | `httpsThreads` 8 | đã sửa ở 007 (40), nay 64 (ADR-010) |
| H-03 | 007 F-2 | High | `*.bindings.json` không được phục vụ | đã sửa ở 007, `startup_test.cpp` |
| H-04 | 007 R-1, R-2 | High (test) | kịch bản `bundle`, `pulse-kill` đạt khi rỗng | đã sửa ở 007 |
| H-05 | 008 F1 | High | ReDoS `hasDoctypeEntity` | đã sửa ở 008, `inspect.test.ts` |
| H-06 | 008 F2 | High | bom `use` treo tab | đã sửa ở 008, `usecount.test.ts`, `mount.test.ts` |
| H-07 | 008 F3, F4 | Medium | CSS và đối chiếu nhập lại bậc hai | đã sửa ở 008 (`E_IMPORT_LIMIT`) |
| H-08 | 008 F5 | Medium | `minRole` của sự kiện SVG chỉ là khóa giao diện | **chấp nhận** (thiết kế 007; threat model RR-5) |
| H-09 | 008 F6 | Medium | runtime C++ không parse SVG (D30) | **chấp nhận** (Constitution II; threat model RR-4) |
| H-10 | 009 M1 | Medium | khách thấy tên tài khoản, lý do trong alarm | đã sửa ở 009 (`9033802`) |
| H-11 | 009 R1 | High | luồng ghi alarm quay 100 % CPU khi đĩa đầy | đã sửa ở 009, `AlarmService.PausedWriterSleepsInsteadOfSpinning` |
| H-12 | 009 R2, R3 | Medium | override mất khi dừng lúc đĩa đầy; audit khi động cơ từ chối | đã sửa ở 009 (`42b84a9`, `9033802`) |
| H-13 | 010 #1, #2 | Medium | bộ nhớ của `lttb` và `series` | đã sửa ở 010 (`SCAN_LIMIT`, `RANGE_TOO_LARGE`) |
| H-14 | 010 #3 | Medium | truy vấn lịch sử không hủy khi trình duyệt ngắt | **chấp nhận có điều kiện** (ADR-032; threat model RR-7) |

**Mục Low** (D32: chỉ xử lý mục rẻ, có test):

| ID | Nguồn | Phát hiện | Xử lý | Task | Trạng thái |
|---|---|---|---|---|---|
| L-01 | 005 | `users.json` chỉ cấm bit "others" | cấm group-write và chủ khác root | T041, T050 | Đã sửa (`account_store_test` đỏ 1 rồi 17/17) |
| L-02 | 005 | BOM chỉ bỏ ở một số lần đọc | đã có test `ByteOrderMarkOnStdin...` (005); kiểm lại mật khẩu mới ở CLI | T035 | Đã kiểm (`user_cli_test` 26/26) |
| L-03 | 005 | discovery không giới hạn độ dài tên | giới hạn | T041, T050 | Đã đúng ở HEAD, thêm test bằng chứng (`discovery_server_test`) |
| L-04 | 005 | `open_device_web` mở URL tùy ý | chỉ mở `https://<thiết bị đã lưu>` | T041, T050 | Đã sửa (Rust đỏ 1 rồi 150/150) |
| L-05 | 005 | SVG sanitizer còn denylist | **feature 008** (allowlist, ADR-023); GĐ 6 thêm `data-mat-layer` | T166 | Đã đóng (008); T166 xong |
| L-06 | 005 | `audit.suppressed` mất nguồn | giữ nguồn (`detail.sources` ≤ 16) | T041, T050 | Đã sửa (đỏ 2 rồi 38/38) |
| L-07 | 006 | loopback luôn qua bộ lọc, CGNAT là mạng riêng | **giữ hợp đồng** (đã ghi tài liệu, ADR-018) | — | Hạn chế có chủ ý |
| L-08 | 006 | `drivers/test` nhận host tùy ý (quét cổng) | chấp nhận (engineer, 10 lần/phút, audit) | — | Hạn chế có chủ ý |
| L-09 | 006 | chuỗi toán tử nhị phân chưa có bộ đếm độ sâu | độ sâu > 512 ⇒ `E_EXPR_LIMIT` | T041, T050 | Đã sửa (đỏ 1 rồi 18/18) |
| L-10 | 006 | đổi tên Tag không chuyển giá trị giữ qua mất điện | hạn chế có chủ ý (ghi `admin-guide`) | T181 | Hạn chế có chủ ý |
| L-11 | 006 | `applyRetained` bỏ qua im lặng giá trị sai kiểu | hạn chế có chủ ý | — | Hạn chế có chủ ý |
| L-12 | 006 | `crc32` bảng tĩnh không an toàn đa luồng; `changing_` không reset | chấp nhận theo kết luận 006 | — | Hạn chế có chủ ý |
| L-13 | 007 | S-L2: logout chỉ xóa cookie phía trình duyệt | kiểm lại hủy phiên phía máy chủ | T041 | Đã đúng ở HEAD, thêm test bằng chứng |
| L-14 | 007 | S-L3: nhấp xuyên hộp xác nhận | bỏ nhấp 400 ms đầu | T041, T050 | Đã sửa (`confirm-dialog.test.ts` đỏ 3 rồi xanh) |
| L-15 | 007 | S-L4: `confirm: none` cho BOOL | **giữ** (cảnh báo `W_CONFIRM_NONE`) | — | Hạn chế có chủ ý |
| L-16 | 007 | R-10 đến R-14: người nghe ném lỗi, `#poll`, `setInterval`, vector xen kẽ | sửa các mục rẻ; R-12 (cache `schemasDir`) và R-14 ghi hạn chế | T041, T050 | R-10, R-11 đã sửa kèm test; R-13 không tái hiện, giữ test hồi quy; R-12, R-14 hạn chế có chủ ý |
| L-17 | 007 | Info: CSP `/assets/*.svg`, `Referrer-Policy`, vân tay trên `/login` | thêm hai header; vân tay: tài liệu đối chiếu nhãn thiết bị (đã có) | T041, T050 | Đã sửa (đỏ 1 rồi 25/25) |

## Thứ tự làm (gợi ý cho `/speckit-tasks`; đã áp vào tasks.md)

1. **Phase 1 và 2:** cấu trúc, gói, mockup (tự duyệt), spike (ECDSA trên armhf, `signtool`, Tauri `signCommand`, SAST), PATCH 2.0.2 (T004), định dạng 1.0.0, vector, file thừa, khóa `runtime.json`, chẩn đoán.
2. **US1** (P1): test đỏ rồi sửa từng Medium; công cụ rà soát; review lần 1.
3. **US8** (P1, song song US1 sau Phase 2): `docs-check`, tài liệu, giáo trình, hồ sơ pilot, kế hoạch sau pilot.
4. **US3** (P1): ký, phát hành thử, `mat-update-verify` (nền cho US4).
5. **US2** (P1): công cụ và x64; **gom** các task ⚠️🔌 của US1, US2, US3 thành một đợt xin SSH và bộ điều khiển nguồn; soak 7 ngày chạy nền.
6. **US4** (P2): OTA (cần T004, T007).
7. **US5** (P2) và **US6** (P2) song song nếu có người; **US7** (P3).
8. **US9:** pilot (cần P1 và US4); **Phase 12:** hồi quy, review lần 2, nghiệm thu, Go/No-Go.

## Rủi ro

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Phạm vi rất lớn (9 story) | Cao | Thứ tự P1 → P3; mốc commit và báo cáo từng story; có thể tách US6, US7 thành feature riêng (D1); pilot không chờ US5 đến US7 |
| Không có SSH, bộ điều khiển nguồn, site pilot, chứng chỉ thật | Cao | x64 trước; task ⚠️🔌 gom một chỗ (`customer-checklist.md`); báo cáo ghi "Chưa đo"; không gắn 1.0.0 khi thiếu bằng chứng |
| OTA gây hỏng thiết bị từ xa hoặc thêm bề mặt root | Cao | Mặc định tắt; bề mặt root nhỏ (`mat-update-verify` + sh); kiểm lại ở root; 30 gói xấu; 40 lần kill; 5 lần cắt điện thật; đường thủ công còn nguyên; fuzz |
| Logic ghi PLC ngoài ý muốn | Cao | `writes` khai báo, giới hạn nhiều lớp, mặc định tắt, dừng khẩn cấp, audit bền; thử trên giả lập; không thử trên máy thật đang chạy |
| Cô lập timeout đa unit đổi máy trạng thái driver 006 | Trung bình | Simulator gateway và 10.000 ca ngẫu nhiên; chạy lại `driver-it` đầy đủ |
| Khóa theo cặp bị vượt bởi botnet phân tán | Thấp (LAN) | Chi phí Argon2, giới hạn đồng thời, audit phát hiện, VPN; ghi trong threat model |
| `HostPolicy` làm vỡ khách dùng tên miền nội bộ | Trung bình | IP literal luôn nhận; `deploy.sh`, `device/identity`, Studio nhắc; `hostCheck: off` có cảnh báo |
| Mòn eMMC (nhật ký xung, audit logic, retain logic) | Trung bình | Ngân sách ở FR-081, FR-090; đo ở soak; cảnh báo ước tính |
| Phụ thuộc feature 008 (`sanitizeSvg` allowlist, `@mat/svg-import`, uid, `model/svg-doc.ts`) cho US6, US7; tên trùng với 008 (`studio-svg.html`, `svg-doc`) đã tránh: mockup `studio-svg-draw.html`, package `@mat/svg-edit`, kiểu `DrawDoc` | Trung bình | T003 kiểm sớm; US6 bắt đầu khi 008 có mã importer và allowlist; nếu chưa có thì ghi "chờ" và đẩy sau |
| Hiệu năng editor SVG với 2.000 phần tử DOM | Trung bình | Đo sớm (T164); dự phòng bản xem nhanh khi kéo |
| Chứng chỉ ký hoặc SmartScreen không như mong đợi | Trung bình | Không cam kết hết cảnh báo; ghi nguyên văn; bản rc có thể chạy không ký có quyết định (FR-140) |
| `cargo audit`, `npm audit` cần mạng | Thấp | Task 🌐; ghi "BỎ QUA" khi không mạng, không xanh giả |
| Pilot không đủ 30 ngày hoặc không có khách | Cao | Bàn thử nội bộ song song; No-Go kèm kế hoạch; không "đạt giả" |
| Thiếu datasheet eMMC | Trung bình | Nói thẳng "chưa tính được tuổi thọ tuyệt đối"; chỉ báo bậc `EXT_CSD` |
| Xung đột sửa mã khi `ci-local` đang chạy | Thấp | Không sửa mã khi lượt chạy chưa xong; task xếp hàng |

## Câu hỏi cho phiên chính

**Đã trả lời 2026-10-13** (phiên làm việc; người dùng giao toàn quyền quyết định ngày 2026-10-11 và đang vắng; có thể xem lại khi người dùng quay lại):

1. **OTA: làm hay chỉ thủ công?** **Làm, mặc định tắt, thủ công vẫn hỗ trợ** (D5, R17). Lý do: pilot có site ở xa, tắt được SSH mật khẩu; hạ tầng nạp xuống có sẵn.
2. **PATCH Constitution 2.0.2?** **Đồng ý đề xuất** (D22, R31, T004): làm rõ ghi từ logic và OTA; không đổi nguyên tắc. Phiên chính chạy `/speckit-constitution` ở T004; viết mã ghi PLC của logic và đường OTA chỉ sau đó. **Đã thực hiện 2026-10-16:** Constitution 2.0.2.
3. **Phiên bản 1.0.0 cho cả Studio và runtime, bản rc trong lúc làm?** **Đồng ý** (D2, R2).
4. **Allowlist `Host`: IP literal luôn nhận?** **Đồng ý** (D8, R4).
5. **Khóa đăng nhập theo cặp, bỏ khóa theo tên?** **Đồng ý** (D9, R5).
6. **Nhả xung khi khởi động?** **Đồng ý** (D10, R6), nêu giới hạn mất điện lâu.
7. **Mockup:** tự duyệt (T007), ghi ngày duyệt.
8. **BL335 và người:** danh sách việc gom ở `docs/pilot/customer-checklist.md` (T184): SSH, bộ điều khiển nguồn, datasheet eMMC, chứng chỉ ký, máy Windows sạch, site pilot, người thử.
9. **Phạm vi SVG:** D23 (không Bézier tay, boolean, filter, mask, văn bản nhiều dòng); sửa nút chỉ cho `path` M L H V Z.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Thành phần chạy bằng root (`mat-updater`, `mat-update-verify`) trong sản phẩm vốn không đặc quyền | Cập nhật `/opt` mà không phá sandbox `ProtectSystem=strict` của runtime | Cho `matscada` ghi `/opt`: kẻ chiếm runtime thay được mã chạy |
| `mat-update-verify` tự viết (đọc tar) thay vì dùng `tar` và `openssl` | Không có `openssl` chắc chắn trên BL335; cần đọc phong bì có giới hạn cố định | `openssl` trên thiết bị (chưa chắc có), phân tích tar bằng sh (dễ lỗi) |
| Hai bản engine logic (TS, C++) | Mô phỏng trong Studio và chạy trên BL335 (Constitution II) | Chỉ C++ (Studio không mô phỏng được); chỉ TS (không chạy trên thiết bị) |
| Nhật ký xung `fdatasync` mỗi lần | Không bao giờ bật bit mà không có bản ghi nhả | Ghi bộ nhớ (mất khi kill -9); SQLite (nặng, thêm giao dịch FULL) |
| `@mat/svg-edit` thêm package | Mô hình tài liệu kiểm được không DOM; hoàn tác bằng lệnh | Sửa DOM trực tiếp: không kiểm đơn vị được, hoàn tác bằng chụp DOM (cấm theo Master Plan §7.4) |
| Template bung khi lưu (nhân bản item) | Runtime không đổi | Runtime hiểu `instance`: thêm cơ chế runtime và validator |
| Faceplate thay chuỗi lúc chạy | Một popup cho N thiết bị | Nhân popup N lần: nổ số tệp |
| Thêm khóa `runtime.json` (13 khóa) | Mặc định an toàn, cấu hình được | Hằng cứng: khách không chỉnh được (tên miền, tần suất) |
