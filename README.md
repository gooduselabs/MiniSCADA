# mAT SCADA

miniSCADA: Studio (Tauri) + Runtime C++ trên BL335 + trình duyệt Chrome. Xem `mAT_SCADA_Master_Plan.md`, rules trong `.specify/memory/constitution.md`, tiến độ trong `specs/`.

**Trạng thái:** Sprint 1 (vertical slice trên thiết bị). Xem [spec/plan/tasks](specs/002-vertical-slice/), [báo cáo nghiệm thu](docs/reports/sprint1-acceptance.md), [ADR](docs/adr/README.md). Sprint 0: [tasks](specs/001-platform-validation/tasks.md), [Go/No-Go (nháp)](docs/reports/go-no-go.md).

Runtime hiện **chưa có xác thực và TLS** (Sprint 5): chỉ dùng trong mạng tin cậy và chỉ đọc (không ghi Tag).

**Cập nhật (feature 006, runtime 0.5.0):** có Tag v1, Modbus TCP/RTU, Tag tính toán, ghi Tag qua HTTPS có đăng nhập (chỉ từ Bảng theo dõi của Studio) và lọc nguồn cho trang xem; mã xong và đã thử trên x64, **chưa thử trên BL335**. Xem [docs/deployment/mat-runtime.md](docs/deployment/mat-runtime.md) mục 5c và [specs/006-tags-modbus](specs/006-tags-modbus/).

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

Chạy lần lượt: clang-format, build armhf, smoke armhf dưới qemu-user (`deployment/toolchain/smoke-armhf.sh`: runtime của BL335 ghi lưu trữ rồi `--check-history`; bắt lỗi chỉ có ở bản 32-bit), build x64 + `ctest` (GoogleTest), `gofmt` + `go vet` + `go test`, `npm run lint | typecheck | validate:project | test | build:web`, rồi giao diện Studio trên Chrome headless với lớp Tauri giả và axe-core (`npm run e2e -w @mat/studio`, cần Chrome hoặc Edge; đường dẫn khác thì đặt `CHROME_PATH`). Sau đó (feature 005): `cargo test --lib` của Studio (chỉ chạy trên Windows; GitHub không chạy) và `tools/device-it.ps1` (kịch bản `auth, discovery, packages, deploy, busy, health`). Dừng ở bước lỗi đầu tiên.

### Kiểm tích hợp với thiết bị x64 (`device-it`)

```powershell
./tools/device-it.ps1 -Scenario auth,tls-idle,secrets,discovery,deploy,packages,busy,health,kill,reload [-Rounds 24] [-BuildDir C:uildmat-x64-e2]
```

Dựng 3 runtime x64 (Docker, vòng giám sát như systemd) và client Node; mật khẩu thử sinh ngẫu nhiên mỗi lần chạy. `deploy`: 3 project x 10 lần nạp xuống rồi đọc lên (digest giống hệt 30/30); `packages`: mọi gói độc trong `tests/package-vectors` bị từ chối đúng mã; `kill` (lâu, vài phút) và `health` build runtime với `-DMAT_TEST_HOOKS=ON`; `reload` mở 10 tab Chrome headless (cần Chrome, `CHROME_PATH`). Kết quả: `docs/reports/005-<kịch bản>-x64.json`. Gọi API thiết bị bằng tay: `node tools/measure/device-api.mjs https://host:8443 --fingerprint <fp> --user kysu1 login deploy --package x.matscada` (các lệnh `login session logout deploy fetch restore diag audit`).

### Kiểm Tag, Modbus, ghi Tag (feature 006)

```powershell
./tools/driver-it.ps1 -Scenario read,merge,split,probe,write [-Rounds 6] [-Seconds 60] [-Keep] [-NoBuild] [-BuildDir C:\build\mat-x64-e2] [-Net]
./tools/fuzz-modbus.ps1 [-Seconds 3600] [-Seed 0] [-BuildDir C:\build\mat-x64-asan] [-NoSanitize]
node --test "tools/modbus-sim/*.test.mjs" "tools/project-validator/*.test.mjs"
node tools/modbus-sim/sim.mjs --tcp 1502 --control 1503 --map tools/modbus-sim/maps/modbus-demo.json [--log build/sim-requests.jsonl]
```

- `driver-it` (Docker): runtime x64 + giả lập Modbus + client Node, mạng riêng trong `tests/driver-it/compose.yaml`. Kịch bản: `read`, `merge`, `split`, `probe`, `unplug`, `write`, `write-race`, `write-kill`, `load`, `calc`, `retain`, `write-io`, `faults`, `source`; mô tả từng kịch bản ở đầu `tools/driver-it.ps1`. Kết quả: `docs/reports/006-<kịch bản>-x64.json`. Mật khẩu thử sinh ngẫu nhiên mỗi lần chạy, không ghi file. `ci-local.ps1` chạy bản nhanh; `unplug`, `load`, `write-kill`, `retain` và fuzz 1 giờ chạy tay.
- `fuzz-modbus`: fuzz bộ giải mã khung và máy trạng thái driver TCP và RTU (ASan + UBSan; `-NoSanitize` dùng bản Release có sẵn cho lần chạy ngắn). Lỗi in hạt giống để chạy lại.
- `tools/modbus-sim`: giả lập Modbus TCP bằng Node >= 22, không cần package, chỉ dùng cho test; bản đồ bộ nhớ ở `tools/modbus-sim/maps/` (`all-types`, `bench-500`, `modbus-demo`), cổng điều khiển (`--control`) để gây lỗi theo lệnh. `projects/modbus-demo/` là project mẫu dùng giả lập này.
- `node --test` chạy test của giả lập và của `tools/project-validator`.

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
