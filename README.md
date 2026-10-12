# mAT SCADA

miniSCADA: Studio (Tauri) + Runtime C++ trên BL335 + trình duyệt Chrome. Xem `mAT_SCADA_Master_Plan.md`, rules trong `.specify/memory/constitution.md`, tiến độ trong `specs/`.

**Trạng thái:** Sprint 1 (vertical slice trên thiết bị). Xem [spec/plan/tasks](specs/002-vertical-slice/), [báo cáo nghiệm thu](docs/reports/sprint1-acceptance.md), [ADR](docs/adr/README.md). Sprint 0: [tasks](specs/001-platform-validation/tasks.md), [Go/No-Go (nháp)](docs/reports/go-no-go.md).

Runtime hiện **chưa có xác thực và TLS** (Sprint 5): chỉ dùng trong mạng tin cậy và chỉ đọc (không ghi Tag).

## Yêu cầu máy phát triển (Windows)

| Cần | Dùng cho |
|---|---|
| Docker Desktop | build chéo armhf và build/test x64 (Ubuntu 20.04, glibc 2.31 như BL335) |
| Node ≥ 24, `npm install` ở thư mục gốc | runtime web, package dùng chung, Studio, công cụ |
| Go ≥ 1.26 | `tools/load-tester` |
| Chrome ≥ 120 | runtime web, công cụ đo (puppeteer) |
| Rust (MSVC) + Visual Studio/Build Tools có C++ | chỉ cho Studio (`apps/studio`); đặt `CARGO_TARGET_DIR=C:\build\mat-studio` |

## Kiểm tra tất cả (giống CI)

```powershell
./tools/ci-local.ps1
```

Chạy lần lượt: clang-format, build armhf, smoke armhf dưới qemu-user (`deployment/toolchain/smoke-armhf.sh`: runtime của BL335 ghi lưu trữ rồi `--check-history`; bắt lỗi chỉ có ở bản 32-bit), build x64 + `ctest` (GoogleTest), `gofmt` + `go vet` + `go test`, `npm run lint | typecheck | validate:project | test | build:web`, rồi giao diện Studio trên Chrome headless với lớp Tauri giả và axe-core (`npm run e2e -w @mat/studio`, cần Chrome hoặc Edge; đường dẫn khác thì đặt `CHROME_PATH`). Dừng ở bước lỗi đầu tiên. Test Rust của Studio chỉ chạy cục bộ trên Windows (CI và `ci-local.ps1` không chạy bước này): `cd apps/studio/src-tauri; cargo test --lib`.

## Chạy

```powershell
npm run build:web                        # apps/runtime-web/dist (dev + lab) và dist-device (gói thiết bị)
./deployment/toolchain/run-x64.ps1       # mat-runtime x64 trong Docker → http://localhost:8080/
npm run dev -w @mat/runtime-web          # Vite dev server, proxy API/WebSocket tới runtime ở 8080
npm run validate:project                 # kiểm projects/tank-demo bằng bộ kiểm tra dùng chung
```

Triển khai lên BL335: [docs/deployment/mat-runtime.md](docs/deployment/mat-runtime.md). Thông tin SSH **không** nằm trong repo. Mọi thay đổi trên thiết bị phải ghi vào [docs/reports/device-changes.md](docs/reports/device-changes.md).

Studio: `$env:CARGO_TARGET_DIR='C:\build\mat-studio'; npm run studio:build`, rồi cài bộ cài NSIS. Cách dùng: [apps/studio/README.md](apps/studio/README.md).

## Đo và kiểm

| Việc | Lệnh |
|---|---|
| RAM/CPU trên thiết bị | `sh tools/measure/sample.sh <kịch bản> <giây> [pid]` (chạy trên thiết bị, hoặc `ssh … sh -s < sample.sh`) |
| 10 client + client dư, client chậm, Origin, race đăng ký, slot | `build/load-tester.exe -host <ip> -port <cổng> [-clients 10 -extra 1 -tags sim] [-slow 1] [-origin URL] [-resub 100] [-slot-test]` |
| Trang runtime trên Chrome (thời gian có dữ liệu, binding đổi) | `node tools/measure/runtime-smoke.mjs <url>` |
| Mất kết nối → STALE → tự kết nối lại | `node tools/measure/reconnect-check.mjs <url> --cut "<lệnh>" --restore "<lệnh>"` |
| Header/CSP/allowlist/Origin/SVG có script | `node tools/measure/http-check.mjs <url> [--script-svg /project/…svg]` |
| Mở SVG fixture (lab, chỉ dev) | `node tools/measure/svg-load.mjs http://localhost:8080/lab.html` (cần server phục vụ `dist`) |
| SVG từ phần mềm vẽ | `npm run svg:inspect -- <file.svg hoặc thư mục>` |
| Lưu trữ: dọn theo thời hạn + trần dung lượng (x64) | `./tools/historian-it.ps1 -Scenario retention` |
| Lưu trữ: gửi sang MySQL, SQL Server, PostgreSQL, InfluxDB thật (Docker) | `./tools/historian-it.ps1 -Scenario forward` |
| Lưu trữ: mất kết nối, kill -9, dòng bị xóa trước khi gửi | `./tools/historian-it.ps1 -Scenario reliability` |
| Xuất dữ liệu lưu trữ ra CSV (trên thiết bị hoặc container x64) | `mat-runtime --export-history <nhóm> [--from …] [--to …] [--tz +07:00] [--data-dir …]` |

## Cấu trúc

```text
schemas/                 JSON Schema v0 (project, tag, screen, binding) + protocol-version.json
projects/tank-demo/      project mẫu viết tay (bồn nước + bơm), được triển khai lên thiết bị
packages/                dùng chung Studio ↔ runtime web: project-schema (validator TS), svg-renderer,
                         binding-engine, live-client
apps/runtime-web/        trang runtime (index.html) + lab.html (đo fixture Sprint 0, không triển khai)
apps/studio/             Studio Tauri 2, khung kiểu IDE (feature 004): cây project, editor dạng tab, inspector, kiểm tra liên tục, theo dõi thiết bị, xem trước
core/                    session-manager (10 client, hàng đợi 256 KB), tag-engine, project-manager (validator C++)
drivers/simulation/      Mock Tag provider (bồn + bơm, 500 Tag SIM.*)
server/                  mat-runtime: main, config, http/, websocket/ (live hub, CivetWeb transport, Origin);
                         server/poc: PoC Sprint 0 (giữ để tái lập số đo)
tests/project-vectors/   bộ vector dùng chung cho validator TS và C++ (generate.mjs)
tests/fixtures/svg/      SVG mẫu Sprint 0
tools/                   load-tester (Go), measure/, project-validator/, svg-inspect/
deployment/              toolchain Docker, systemd, config, device/ (deploy.sh, rollback.sh), package-runtime.ps1
third_party/             CivetWeb, nlohmann/json, valijson, GoogleTest (LICENSES.md)
docs/                    adr/, architecture/, deployment/, reports/
specs/                   spec, plan, tasks (Spec Kit)
```
