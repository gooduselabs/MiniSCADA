# Implementation Plan: Tag v1, Modbus TCP/RTU, Tag tính toán và ghi Tag có kiểm soát

**Branch**: `006-tags-modbus` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-tags-modbus/spec.md`

## Summary

GĐ 2 của [lộ trình v2](../../docs/plans/roadmap-v2.md) (§4.2), một feature (D1). BL335 đọc và ghi PLC thật qua Modbus TCP và RTU; có Tag nội bộ, Tag tính toán, bảng giá trị; ghi Tag có kiểm soát từ Bảng theo dõi của Studio; Studio có lưới kiểu Excel gõ được tiếng Việt, editor Kết nối, Tag tính toán, Bảng giá trị, Bảng theo dõi, Chẩn đoán driver và Mô phỏng.

Cách làm ([research.md](research.md) R1–R25):

- **Định dạng project 0.2.0:**
  - thêm `connections.json`, `value-tables/<tên>.json`, `watch-tables/<id>.json`; Tag v1 trong `tags.json`, mỗi Tag một dòng;
  - `type` là kiểu giá trị, `source.rawType` là kiểu trên thiết bị trường;
  - mọi file cùng `schemaVersion`; cần runtime ≥ 0.5.0; gói `.matscada` giữ 1.0.0.
  - Studio nâng cấp 0.1 trong bộ nhớ, sao lưu vào `.mat-backup/` trước lần lưu đầu. Runtime 0.5 đọc Tag mock của 0.1 thành Tag mô phỏng `legacy`: giá trị y như 0.4.
- **Tag Engine v1** chạy trên vòng tick hiện có, ngay trước `hub.tick()`:
  - scaling, kiểm NaN, deadband, bộ sinh, Tag tính toán theo thứ tự tô-pô **một lần**;
  - ghi `TagStore` dưới một lần khóa, nên Tag tính toán luôn đi cùng delta với đầu vào (FR-019);
  - quality kèm mã lý do; lý do đi qua giao thức live 1.2.0.
- **Driver SDK** (ADR-014):
  - kênh → thiết bị trường → Tag; một luồng mỗi kênh (≤ 16); driver chỉ phát cập nhật và kết quả ghi;
  - lịch đọc theo hạn sớm nhất, lệnh ghi trước; gộp tham lam (tối ưu số khối); tách đôi tại khoảng trống lớn nhất khi gặp exception 02/03;
  - kết nối lại 1 → 10 s có ngẫu nhiên; RTU tạm ngưng thiết bị trường sau 3 lần hỏng.
- **Modbus TCP và RTU tự viết** (không libmodbus):
  - lớp mã hóa thuần, vector chung với bản TS;
  - RTU: khung theo độ dài, khoảng lặng t3.5, CRC, bỏ phần vọng lại, `TIOCSRS485` khi có;
  - fuzz bằng GoogleTest với ASan/UBSan (image không có clang);
  - giả lập Modbus TCP viết bằng Node (mã hóa độc lập), RTU qua cặp pty (`openpty`).
- **Cổng serial:**
  - danh sách cho phép do root đặt (mặc định `ttyAS*`, loại console; `ttyUSB*` có thể là modem 4G nên không mặc định);
  - unit thay `PrivateDevices=true` bằng `DevicePolicy=closed` + `DeviceAllow` nhóm tty + `SupplementaryGroups=dialout`;
  - danh sách lệnh chỉ đọc cho người dùng chạy trên BL335 ([quickstart.md](quickstart.md) §8).
- **Ghi Tag** (ADR-017):
  - `POST /api/v1/tags/write` (operator), kiểm theo thứ tự FR-037;
  - bản ghi audit lúc nhận (`audit.db`, FULL) và mã yêu cầu lưu trong cùng giao dịch, trước khi gửi;
  - hỏi kết quả qua HTTPS mỗi 200 ms;
  - token bucket theo phiên và toàn BL335; `quiesce` trước `execv` khi nạp xuống; lệnh dở ghi `interrupted` lúc khởi động.
- **Ngân sách eMMC** (đo trên ext4 x64):
  - SQLite build với `HAVE_FDATASYNC=1`: 24,1 KB mỗi lần ghi Tag, thay vì khoảng 49 KB;
  - Tag giữ qua mất điện ghi tại chỗ trong file cấp sẵn: 4,1 KB mỗi lần lưu, thay vì 66–86 KB với file tạm + `rename`;
  - mặc định tạm 20 lệnh/phút toàn BL335 cho khoảng 0,77 GB/ngày (SC-011 ≤ 1 GB).
- **Biểu thức** (ADR-015):
  - kiểu C, không script; số thực 64 bit không FMA; `round` nửa ra xa 0 tự viết; so sánh không kết hợp;
  - bytecode hai bản (`@mat/expression`, `core/expression`); ≥ 300 ca vector chung;
  - bảng giá trị cấm chồng; bộ sinh mô phỏng tất định (sin tự viết, băm lowbias32 theo bộ đếm).
- **Lọc nguồn** (ADR-018, FR-055a): phần không đăng nhập mặc định chỉ phục vụ mạng riêng (`viewerAccess`); request có phiên không bị lọc; Studio gửi token khi mở live; mã đóng 4401.
- **Studio** (ADR-016):
  - lưới ảo hóa tự viết trên Lit; một `textarea` luôn giữ focus để nhận chữ từ bộ gõ (sửa hạn chế Telex TSF của 004);
  - kiểm project trong Web Worker;
  - Mô phỏng (`sim-engine.ts`) thay `sim-source.ts` của 004; đổi tên Tag cập nhật mọi tham chiếu trong một bước hoàn tác.

Quyết định ghi trong ADR [014](../../docs/adr/014-driver-sdk-modbus.md), [015](../../docs/adr/015-expression-language.md), [016](../../docs/adr/016-studio-grid-ime.md), [017](../../docs/adr/017-tag-engine-v1.md), [018](../../docs/adr/018-viewer-source-filter.md) (Proposed). Số 013 vẫn dành cho mô hình màn hình v1 (GĐ 3a, lộ trình §8).

## Technical Context

**Language/Version**:

- C++17 (GCC 9 trong Docker Ubuntu 20.04; cross `arm-linux-gnueabihf`);
- TypeScript 7 (Vite 8);
- Rust 1.99, edition 2024 (Tauri 2.12);
- Node ≥ 22 cho công cụ (giả lập Modbus, sinh vector); PowerShell, sh.

**Primary Dependencies** (phiên bản, license: research R25):

- **Runtime:** không thêm thư viện. Dùng CivetWeb 1.16, Mbed TLS 3.6.7 (005), SQLite 3.54.0 (đổi cờ build `HAVE_FDATASYNC=1`), nlohmann/json, valijson, GoogleTest. Modbus, biểu thức, bộ sinh, lưu Tag giữ qua mất điện tự viết.
- **Studio:** không thêm gói npm hay crate. Lit 3.3.3, `@mat/*`; `tokio-tungstenite` (đã có) dùng thêm `IntoClientRequest`.
- **Package mới trong workspace:** `@mat/expression`, `@mat/tag-codec`, `@mat/tag-sim`.
- **Công cụ test:** `tools/modbus-sim` (Node, không phụ thuộc); image `node:24-slim` cho kịch bản Docker (ghim digest).

**Storage**:

- **BL335:**
  - `/var/lib/mat-runtime/retain/retain-{a,b}.bin` (Tag giữ qua mất điện);
  - `audit.db` lên `user_version` 2 (bảng `tag_write_request`);
  - `history.db`, `projects/`, `tls/`, `users.json` không đổi.
- **Project:** `connections.json`, `value-tables/*.json`, `watch-tables/*.json`; `.mat-backup/<bản gốc>-<thời điểm>/` khi nâng cấp.

**Testing**:

- GoogleTest + CTest (x64 Docker), thêm build ASan/UBSan (`MAT_SANITIZE=ON`) cho fuzz; test armhf chạy dưới qemu-user;
- Vitest (vector chung TS); e2e Chrome headless với lớp Tauri giả, axe-core; `cargo test`;
- tích hợp x64 `tools/driver-it.ps1` (mạng Docker: runtime, giả lập Node, client; dải 203.0.113.0/24 cho lọc nguồn);
- thử bộ gõ bằng tay trên Windows 11 (Telex TSF, Unikey);
- đo và thử thật trên BL335 ở task ⚠️🔌 (cần người dùng cho phép SSH; RS485 và cắt điện cần người ở cạnh thiết bị).

**Target Platform**:

- BL335: armv7l, 2 × Cortex-A7 (VFPv4), 993 MB RAM, Ubuntu 20.04.5, kernel 5.4.61 BSP Allwinner, systemd 245, eMMC ext4; cổng `ttyAS*`; modem 4G;
- Studio: Windows 10/11 x64, WebView2.

**Project Type**: dịch vụ nhúng C++ (mở rộng `mat-runtime`: Tag Engine, driver), ứng dụng desktop Tauri (Rust + TS), package TS dùng chung, công cụ test Node.

**Performance Goals**:

| Mục tiêu | Ngưỡng | Nguồn |
|---|---|---|
| 500 Tag/1 s Modbus TCP, 10 client, 30 phút | CPU trung bình ≤ 30 %, RSS ≤ 150 MB, chu kỳ thực 1 s ± 10 %, 0 mất sequence | SC-003 |
| Thêm 200 Tag tính toán, 100 Tag nội bộ | vẫn trong ngân sách; 100 % cùng delta với đầu vào | SC-004 |
| Rút cáp / cắm lại | BAD ≤ 2 chu kỳ; GOOD ≤ 12 s | SC-005 |
| Ghi Tag trong LAN | ≥ 95 % `CONFIRMED` ≤ 2 s | SC-007 |
| Thử kết nối | ≤ tổng thời gian chờ + 2 s | SC-014 |
| Chẩn đoán driver | lỗi tiêm hiện ≤ 5 s; cập nhật ≤ 2 s | SC-016, FR-051 |
| Bảng Tag 2.000 dòng | mở ≤ 1 s; di chuyển ≤ 50 ms; phím ≤ 100 ms; lỗi ≤ 1 s; dán 2.000 × 10 ≤ 5 s | SC-012 |
| Biểu thức trong Studio | gợi ý ≤ 200 ms; lỗi ≤ 500 ms | SC-015 |
| Mô phỏng | bật ≤ 1 s; Tag tính toán phụ thuộc cập nhật ≤ 1 s | US6 |
| Ghi eMMC do ghi Tag + Tag giữ qua mất điện | ≤ 1 GB/ngày ở tần suất tối đa mặc định | SC-011 |

**Constraints**:

- Ngân sách Constitution III; ước tính RSS khoảng 16–20 MB, CPU hệ thống khoảng 15–18 % ở tải SC-004 (research R23).
- Mỗi file JSON ≤ 1 MiB (gói 005): `tags.json` 2.000 Tag vừa trần ở cấu hình đầy đủ thường gặp (research R2).
- Không thêm GPL/LGPL; thư viện mới (nếu có) phát hành ≥ 2 tuần.
- Không sửa `core/`, `server/`, `apps/studio/`, `specs/005-*` trong lúc 005 còn đang làm các file đó: phần chạm file chung xếp sau task tương ứng của 005 (mục "Thứ tự làm").
- SSH tới BL335 đang bị chặn: bước trên BL335 chờ quyền, hoặc người dùng tự chạy lệnh chỉ đọc.
- Ổ D: máy dev còn ít chỗ (build Rust trên C:).

**Scale/Scope**:

- ≤ 2.000 Tag (≤ 500 tính toán, ≤ 500 giữ qua mất điện); ≤ 16 kênh, ≤ 64 thiết bị trường; ≤ 256 bảng giá trị × 256 mục; ≤ 32 bảng theo dõi × 200 dòng (D12).
- Khoảng 25 module C++ mới; 3 package TS mới; 5 endpoint mới, 5 endpoint có sẵn thêm trường hoặc tham số; 9 lệnh Tauri mới hoặc đổi; 6 editor (Bảng Tag viết lại) và 5 hộp thoại Studio mới.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution 2.0.1.

| Nguyên tắc | Đánh giá | Ghi chú |
|---|---|---|
| I. Vertical slice trên thiết bị thật | ✅ (cần đo) | Runtime làm trước, Studio sinh đúng định dạng runtime đã chạy. Mọi chức năng chạy trên x64 và qemu armhf trước; nghiệm thu trên BL335 ở task ⚠️🔌. Cổng RS485 chưa xác nhận (D7): có lệnh kiểm chỉ đọc và đường dự phòng (bộ chuyển tự đổi chiều) |
| II. Ranh giới kiến trúc | ✅ | Trình duyệt và Studio không nói chuyện với thiết bị trường: Thử kết nối chạy trên BL335 (D10). Mọi Tag qua Tag Engine. Driver chỉ phát `TagUpdate`/`WriteResult` (giao diện `EngineSink`). Biểu thức, bảng giá trị, bộ sinh, đổi thô ↔ giá trị có hai bản (TS trong `packages/*`, C++ trong `core/`, `drivers/`) dùng chung bộ vector. `apps/studio` chỉ điều phối package dùng chung (Mô phỏng, xem trước). `core/` không include UI hay CivetWeb |
| III. Ngân sách tài nguyên | ✅ (cần đo) | RSS, CPU ước tính trong ngân sách (R23). eMMC đã đo trên ext4 x64 (R15, R16); mặc định tần suất ghi đặt dưới trần của spec cho khớp SC-011; chốt bằng số đo trên BL335 |
| IV. Chrome, 10 client | ✅ | Phiên live của Studio vẫn tính trong 10. Giao thức live 1.2.0 tương thích ngược với client 1.1 |
| V. An toàn, bảo mật (NON-NEGOTIABLE) | ✅ (đã duyệt 2026-10-11) | Ghi Tag chỉ qua HTTPS + phiên + role operator + audit lưu bền trước khi gửi; viewer, HTTP, live, trang xem không ghi được (SC-006). Không `eval`, ngữ pháp đóng. Bộ kiểm tra ở cả hai phía; runtime không kích hoạt project lỗi. Gói giữ các luật của 005. Phần không đăng nhập mặc định chỉ mạng riêng. **Điểm cần duyệt:** unit đổi `PrivateDevices=true` thành `DevicePolicy=closed` + `DeviceAllow` (vẫn chặn thiết bị khối và bộ nhớ ở cgroup). Ghi ở Complexity Tracking, câu hỏi 1 |
| VI. Test trước | ✅ | Danh sách test viết trước theo FR-058; vector chung cho biểu thức (≥ 300), đổi giá trị, bảng giá trị, bộ sinh, khung Modbus, project 0.2, cặp file nâng cấp; bộ test chuẩn cho driver; tích hợp x64 (ghi, giết tiến trình, lọc nguồn); fuzz ≥ 1 giờ |
| VII. Đơn giản, có phiên bản | ✅ (cần đo trước khi phát hành driver) | Đúng phạm vi GĐ 2; không có ghi từ web, alarm, driver khác. SemVer: runtime 0.5.0, định dạng 0.2.0 có migration, API 1.1.0, live 1.2.0, gói 1.0.0 giữ nguyên. Deploy atomic giữ chuỗi của 005, thêm `quiesce`. **Driver chỉ phát hành** khi có số đo RAM/CPU trên BL335, giả lập trong CI (có), license đã rà (không thư viện ngoài) |
| Ràng buộc công nghệ | ✅ (đã duyệt 2026-10-11) | C++17/CMake/Ninja/armhf, CivetWeb giữ. `audit.db` vẫn FULL (ngoại lệ đã có, áp cho mọi giao dịch của file, gồm bảng mới). Tag giữ qua mất điện không dùng SQLite (file riêng, `fdatasync`), là dữ liệu chứ không phải log. **Điểm cần duyệt:** cờ build `HAVE_FDATASYNC=1` của SQLite dùng chung với 003 và 005 (không đổi chế độ `synchronous`, chỉ đổi lời gọi đồng bộ). License: không thêm thư viện |
| Quy trình | ✅ | Spec Kit. Thao tác trên BL335 chỉ khi người dùng cho phép; ghi `device-changes.md`. ADR 014–018 |

**Kết quả trước Phase 0:** đạt. Không còn `NEEDS CLARIFICATION`: mọi điểm spec để ngỏ đã chọn ở research, ghi "Quyết định (người dùng giao toàn quyền 2026-10-11)". Hai điểm cần phiên chính duyệt (câu hỏi 1, 2), có phương án dự phòng.

**Kiểm lại sau Phase 1** (data-model, contracts):

- Không phát sinh vi phạm mới.
- **Bề mặt mạng mới:**
  - HTTPS: `tags/write` (operator), `drivers/test` (engineer; BL335 kết nối tới host:cổng do engineer chọn, chỉ một yêu cầu đọc Modbus, có trần tần suất và audit), `drivers/diagnostics` (viewer), `serial/ports` (engineer);
  - phần công khai bị thu hẹp (lọc nguồn).
- **Đường ghi Tag:** chỉ một; 4 đường khác (HTTP, live, trang xem, viewer) có test từ chối và audit.
- **Thiết bị:** chỉ cổng serial trong danh sách cho phép; không console; không `ttyUSB*` mặc định.
- **Audit:** schema `audit.db` lên 2 (thêm bảng, không đổi bảng `audit`); danh mục action thêm `tag.write`, `driver.test`.
- Hai điểm (câu hỏi 1 và 2) đã được phiên chính duyệt ngày 2026-10-11; xem mục "Câu hỏi cho phiên chính".

## Project Structure

### Documentation (this feature)

```text
specs/006-tags-modbus/
├── spec.md
├── plan.md                         # file này
├── research.md                     # R1–R25
├── data-model.md                   # Tag v1, kênh, bảng giá trị, bảng theo dõi, giá trị khi chạy, yêu cầu ghi, kho Tag giữ qua mất điện, Studio
├── quickstart.md                   # test, tích hợp x64, Studio, bộ gõ, lệnh chỉ đọc BL335, BL335 ⚠️🔌
├── contracts/
│   ├── project-format-0.2.md       # schema 0.2.0, ví dụ, luật và mã lỗi, binding valueTable, nâng cấp, vector
│   ├── expression-language.md      # ngữ pháp, kiểu, ngữ nghĩa số, quality, mã lỗi, vector
│   ├── value-tables-simulation.md  # bảng giá trị, bộ sinh (sinTurns, lowbias32), vector
│   ├── modbus-driver.md            # SDK, PDU, khung, exception, thời gian, đổi giá trị, gộp/tách, ghi, chẩn đoán, giả lập
│   ├── device-api-1.1.md           # tags/write, kết quả ghi, Thử kết nối, chẩn đoán driver, cổng serial, lọc nguồn, bảng quyền
│   ├── live-protocol-1.2.md        # reason, nâng cấp kèm phiên, 4401
│   ├── tauri-commands-006.md       # live_open có token, device_get/device_post, project_backup/remove, csv_*
│   └── device-config.md            # runtime.json, file, unit, lệnh, deploy.sh, thứ tự khởi động
├── checklists/requirements.md
└── tasks.md                        # /speckit-tasks
```

### Source Code (repository root)

```text
schemas/
├── project.schema.json, tag.schema.json, screen.schema.json, binding.schema.json, logging.schema.json   # → 0.2.0
├── connections.schema.json, value-table.schema.json, watch-table.schema.json                           # mới
├── 0.1/*.schema.json                                                                                    # bản 0.1 đóng băng
└── protocol-version.json                                                                                # live 1.2.0, project ["0.1","0.2"]

core/
├── expression/                     # mat_expression: lexer, parser, checker, compiler, vm, value_table (-ffp-contract=off)
├── tag-engine/                     # tag_model (Tag v1, nạp 0.1 thành legacy), engine (lượt), scaling, deadband,
│                                   # calc_graph (tô-pô, vòng, độ sâu), retain_store, write_coordinator (kiểm FR-037,
│                                   # token bucket, mã yêu cầu, quiesce), tag_store (+ reason, applyBatch)
├── project-manager/project_validator.*   # luật 0.2, chọn schema theo phiên bản, LoadedProject::files() mở rộng
└── audit/                          # (005) + action tag.write, driver.test; user_version 2; bảng tag_write_request

drivers/
├── sdk/                            # driver.hpp (EngineSink, Driver), scheduler, merge_planner, backoff, diag_counters,
│                                   # transport (tcp_socket, serial_port: termios, TIOCSRS485, TIOCEXCL, flock),
│                                   # serial_ports (liệt kê /sys, console, getty, LCK), tests/driver_conformance.hpp
├── modbus/                         # pdu, mbap, rtu_frame (crc16, độ dài, vọng lại), address, codec (thứ tự byte, chuỗi),
│                                   # modbus_tcp_driver, modbus_rtu_driver, test_probe (Thử kết nối), tests/ (pty, fuzz)
└── simulation/                     # sim_generators (sinTurns, lowbias32), simulation_driver, mock_tag_provider (legacy, giữ nguyên)

server/
├── main.cpp                        # engine trên vòng tick; luồng kênh; luồng audit kết quả; luồng lưu retain; thứ tự khởi động
├── config.*                        # serialPorts, viewerAccess, retainWindowS, tagWrite…
├── http/
│   ├── tags_api.*                  # tags/write, kết quả ghi
│   ├── drivers_api.*               # drivers/diagnostics, drivers/test, serial/ports
│   ├── source_filter.*             # hàm thuần isPrivateSource + quyết định theo viewerAccess
│   └── http_api.*                  # (sửa) lọc nguồn, projects/active 0.2, system/info
├── websocket/
│   ├── live_hub.*                  # (sửa) reason trong snapshot/delta, protocol 1.2.0, móc audit cho bản tin write
│   └── civet_transport.*           # (sửa) Authorization trên nâng cấp, kiểm phiên kiểu nhìn, 4401, lọc nguồn
└── cli/                            # --list-serial, --retain-dump

deployment/
├── systemd/mat-runtime.service     # DevicePolicy=closed, DeviceAllow tty, SupplementaryGroups=dialout
├── device/deploy.sh                # chọn unit hoặc drop-in, lời nhắc viewerAccess, --list-serial
└── toolchain/                      # smoke-armhf.sh mở rộng; bước test armhf dưới qemu; MAT_SANITIZE

packages/
├── expression/                     # @mat/expression: biểu thức, bảng giá trị (vector chung)
├── tag-codec/                      # @mat/tag-codec: địa chỉ Modbus, thô ↔ giá trị, scaling, chuỗi
├── tag-sim/                        # @mat/tag-sim: bộ sinh, legacy-mock
├── project-schema/src/             # validate 0.2, migrate.ts, rename.ts, compare.ts (+ kind mới), project-files.ts
├── binding-engine/src/             # transform valueTable
└── live-client/src/                # reason, 4401
apps/runtime-web/src/               # bảng giá trị cho binding (dùng @mat/expression)

apps/studio/
├── src/model/
│   ├── grid/                       # grid-model mở rộng: vùng chọn, ime, clipboard TSV, csv, fill, bulk-add
│   ├── project-doc.ts              # (sửa) tài liệu 0.2, sửa đổi mới, batch
│   ├── upgrade.ts                  # hộp thoại nâng cấp, chế độ chỉ đọc, sao lưu
│   ├── sim-engine.ts               # thay sim-source.ts
│   ├── live-subscriptions.ts       # hợp Tag cần theo dõi, ưu tiên, ≤ 1.000
│   ├── write-flow.ts               # ghi từ Bảng theo dõi, hỏi kết quả
│   └── driver-diag.ts              # phần tăng từ lúc mở trang
├── src/workers/validate.worker.ts  # kiểm project ngoài luồng giao diện
├── src/ui/grid/mat-grid.ts         # lưới ảo hóa, textarea giữ focus
├── src/ui/editors/                 # tag-grid (viết lại trên mat-grid), connections-editor, value-table-editor,
│                                   # calc-tags-editor (+ expression-input), watch-table-editor, driver-diagnostics
├── src/ui/dialogs/                 # upgrade-dialog, write-confirm-dialog, bulk-add-dialog, csv-import-dialog, rename-tag-dialog
├── src/i18n/vi-tags2.ts            # chuỗi của 006 (mã lý do, exception, lỗi biểu thức)
└── src-tauri/src/                  # device/live.rs (token), device/http.rs (device_post, đường dẫn), project_fs.rs
                                    # (project_backup, project_remove, tạo thư mục), csv.rs

tests/
├── expression-vectors/, value-table-vectors/, sim-vectors/, codec-vectors/, modbus-vectors/frames/
├── project-vectors/v02-*           # ca 0.2 (82 ca 0.1 giữ nguyên)
├── migration-vectors/              # cặp before/after
└── driver-it/                      # compose.yaml (runtime, giả lập, client; mạng 203.0.113.0/24), kịch bản
tools/
├── modbus-sim/                     # giả lập Modbus TCP (Node), maps/
├── driver-it.ps1, fuzz-modbus.ps1
└── project-validator/validate.mjs  # (sửa) 0.2, --migrate
projects/modbus-demo/               # project mẫu 0.2.0

docs/
├── architecture/mockups/studio-tags.html   # mockup editor GĐ 2 + bản thử bộ gõ (trước khi code giao diện)
├── deployment/mat-runtime.md               # viewerAccess, cổng serial, unit, rollback qua 0.5
└── reports/006-acceptance.md, device-profile.md (mục serial), device-changes.md
```

**Structure Decision:**

- **BL335:** logic mới nằm trong `core/` và `drivers/` thành thư viện độc lập CivetWeb và độc lập luồng (engine, biểu thức, kho Tag giữ qua mất điện, bộ điều phối ghi, mã hóa Modbus, lập lịch), để unit test không cần mạng hay cổng serial. `server/` chỉ nối HTTP, WebSocket, luồng và lệnh.
- **Hàm thuần có test trước:** gộp và tách khối, mã hóa khung, CRC, đổi giá trị, biểu thức, bảng giá trị, bộ sinh, quyết định lọc nguồn, máy trạng thái ghi, token bucket, định dạng file lưu.
- **Studio:** quyết định ở TS thuần (`model/`), giao diện chỉ hiển thị; logic dùng chung với runtime nằm trong `packages/*` (Constitution II); mạng và file qua Rust.

### Ảnh hưởng tới mã của 004 và 005

| File | Thay đổi | Làm sau |
|---|---|---|
| `server/main.cpp`, `server/config.*` | engine, luồng kênh, khóa mới, thứ tự khởi động | 005 xong T044 (hai context) và US2 (kho, `execv`) |
| `server/http/http_api.*`, `server/websocket/civet_transport.*`, `live_hub.*` | lọc nguồn, phiên trên live, `reason`, 1.2.0 | 005 xong T044 |
| `server/http/auth_gate.*`, `engineering_api.*` (005) | dùng lại chuỗi kiểm; móc audit `tag.write` cho từ chối | 005 xong T042, T043 |
| `core/project-store/deploy_pipeline.*` (005) | móc `quiesce` trước `activate` | 005 xong T100 |
| `core/audit/*` (005) | action mới, `user_version` 2, bảng `tag_write_request` | đã có `AuditLog`; sửa khi 005 không còn task chạm file này |
| `core/tag-engine/tag_store.*` | `reason`, `applyBatch` | không có task 005 chạm |
| `core/project-manager/project_validator.*` | luật 0.2; `kRuntimeVersion` 0.5.0 | 005 xong task chạm `LoadedProject::files()` |
| `CMakeLists.txt` | target mới; `HAVE_FDATASYNC=1`; `MAT_SANITIZE`; `-ffp-contract=off` | phối hợp với 005 (file chung) |
| `deployment/systemd/mat-runtime.service`, `deploy.sh` | unit, lời nhắc | 005 xong task chạm `deploy.sh` |
| `apps/studio/src-tauri/src/device/live.rs`, `http.rs`, `lib.rs` | token cho live; `device_post`; đường dẫn mới | 005 xong US1 phía Rust (đã xong T070–T072) và các task Rust còn lại chạm `lib.rs` |
| `apps/studio/src/model/grid-model.ts`, `ui/editors/tag-grid.ts`, `model/sim-source.ts`, `model/tree.ts`, `model/project-doc.ts` (004) | lưới mới, Mô phỏng mới, bỏ nhãn GĐ 2, tài liệu 0.2 | 005 xong task Studio TS chạm các file này |
| `packages/project-schema/src/compare.ts`, `apps/studio/src/model/download-flow.ts` (005) | kind mới; dòng xem trước của FR-008 | 005 xong T119, T121 |
| `packages/live-client` | `reason`, 4401 | 005 xong phần 1012 |
| Contract 005 `tauri-commands.md` §7, §12.12 ("không gửi token") | thay bằng [tauri-commands-006.md](contracts/tauri-commands-006.md) §1 | không sửa file của 005; 006 ghi chồng bằng contract riêng |

## Thứ tự làm (gợi ý cho `/speckit-tasks`)

0. **Làm ngay, không phụ thuộc 005:**
   - người dùng chạy lệnh chỉ đọc trên BL335 ([quickstart.md](quickstart.md) §8);
   - bản thử bộ gõ (`textarea` giữ focus) trong `docs/architecture/mockups/studio-tags.html`, thử Telex TSF và Unikey trên WebView2. Phiên chính hoặc người dùng gõ; không đạt thì xem lại ADR-016 trước khi làm lưới;
   - mockup các editor GĐ 2 (phiên làm việc tự duyệt).
1. **Nền dùng chung** (file mới, không đụng 005):
   - schema 0.2.0 và bản 0.1 đóng băng;
   - `@mat/expression`, `@mat/tag-codec`, `@mat/tag-sim` cùng bản C++ (`core/expression`, codec trong `drivers/modbus`, bộ sinh trong `drivers/simulation`);
   - mọi bộ vector và script sinh;
   - `migrate.ts`, `rename.ts`; bộ kiểm tra 0.2 bản TS.

   **Mốc:** vector chung xanh ở hai bản.
2. **Tag Engine v1 và driver SDK** (`core/tag-engine`, `drivers/sdk`, `drivers/simulation`):
   - engine, deadband, scaling, Tag tính toán, Tag nội bộ, kho Tag giữ qua mất điện;
   - bộ test chuẩn cho driver với driver mô phỏng;
   - bộ kiểm tra 0.2 bản C++ (sau khi 005 xong task chạm `project_validator`).

   **Mốc:** project 0.1 trên runtime 0.5 qua mọi kiểm tra tự động của Sprint 1 và 003 (SC-009).
3. **Modbus TCP:** mã hóa, driver, lập lịch, gộp và tách, fuzz; giả lập Node; nối vào `main.cpp` (sau 005 T044); `driver-it` đọc, gộp, tách, mất kết nối, tiêm lỗi, tải.
4. **Ghi Tag:** bộ điều phối ghi, `audit.db` v2, `tags_api`, móc `quiesce` (sau 005 T042, T043, T100); `driver-it` ghi, hai người ghi, giết giữa lúc ghi, nạp xuống khi đang ghi.
5. **Modbus RTU và cổng serial:** transport serial, pty, liệt kê cổng, `drivers/test`; unit và `deploy.sh` (theo kết quả bước 0).
6. **Lọc nguồn và live 1.2.0:** `source_filter`, `civet_transport`, `live_hub`, `live-client`; Rust `live.rs` gửi token; `driver-it -Scenario source`.
7. **Studio** (sau khi 005 xong các task Studio TS chạm cùng file):
   - nâng cấp và chế độ chỉ đọc; `mat-grid` và bộ gõ; Bảng Tag v1, CSV, dán, thêm hàng loạt;
   - Kết nối và Thử kết nối; Bảng giá trị; Tag tính toán;
   - Bảng theo dõi và ghi; Chẩn đoán driver; Mô phỏng; đổi tên Tag;
   - dòng xem trước Nạp xuống (FR-008); So sánh với kind mới; lọc audit theo Tag.
8. **BL335 ⚠️🔌**, khi người dùng cho phép: [quickstart.md](quickstart.md) §9; chốt `tagWriteGlobalPerMin` theo số đo SC-011. Viết báo cáo driver `docs/reports/006-driver-modbus.md` trước khi phát hành (FR-060, Constitution VII, lộ trình §4.8): model và firmware đã thử, license, mức đọc/ghi, phần cứng thử, RAM/CPU trên BL335, giả lập trong CI.

**Theo user story:**

| Story | Gồm |
|---|---|
| US1 (P1) Đọc Modbus TCP | bước 1, 2, 3; Studio: nâng cấp, lưới, Bảng Tag, Kết nối, Thử kết nối, Bảng theo dõi (chỉ xem) |
| US2 (P1) Ghi Tag | bước 4; Studio: ghi từ Bảng theo dõi, lọc audit theo Tag |
| US3 (P2) Modbus RTU | bước 5 |
| US4 (P2) Tag nội bộ, tính toán, bảng giá trị | bước 1, 2 (phần engine); Studio: Tag tính toán, Bảng giá trị, đổi tên Tag, binding `valueTable` |
| US5 (P3) Chẩn đoán driver | phần chẩn đoán của bước 3, 5; Studio: trang Chẩn đoán driver |
| US6 (P3) Mô phỏng trong Studio | bước 1 (`@mat/tag-sim`); Studio: `sim-engine.ts` |

Bước 6 (lọc nguồn) phải xong trước khi phát hành runtime 0.5 lên BL335 có port-forward: trang xem hiện dữ liệu PLC thật từ GĐ 2 (D33).

## Rủi ro

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Cổng RS485 của BL335 không rõ, kernel không có chế độ RS485 | Cao | Lệnh kiểm chỉ đọc; chế độ thường cho bộ chuyển tự đổi chiều; bộ chuyển USB qua `by-id` |
| SSH bị chặn: chưa đo được SC-002/003/004/005/010/011 trên BL335 | Cao | Đo x64 trước; mặc định thận trọng; task ⚠️🔌 chờ quyền |
| Cách nhận chữ từ bộ gõ chưa thử trên WebView2 với Telex TSF | Trung bình | Bản thử ở bước 0, trước khi làm lưới |
| Va chạm với 005 đang làm (cùng file `main.cpp`, `http_api`, `civet_transport`, `live.rs`, `AuditLog`, chuỗi nạp xuống, `CMakeLists.txt`, file Studio) | Trung bình | Bảng "Ảnh hưởng" và "Làm sau"; phần mới để ở file riêng |
| Số đo eMMC trên BL335 khác số x64 | Trung bình | Công thức chốt sẵn; trần cấu hình được; ghi trong báo cáo |
| Hiểu sai giao thức đối xứng (driver và giả lập cùng sai) | Trung bình | Vector từ tài liệu chuẩn; giả lập viết độc lập bằng Node; bàn thử PLC thật (SC-001) |
| Thiếu PLC và thiết bị RS485 thật để thử | Cao | Người dùng cung cấp danh sách phần cứng (lộ trình §6); giả lập trong CI |
| `tags.json` chạm trần 1 MiB khi 2.000 Tag điền đủ mọi trường | Thấp | Ghi gọn, bỏ trường mặc định, Studio báo từ 85 %; chia file ở 0.3.0 nếu cần |
| `DevicePolicy`/`DeviceAllow` không chạy trên kernel BSP | Thấp | Kiểm `/proc/cgroups`, `/proc/devices`; drop-in `BindPaths` dự phòng |
| Người đang xem qua port-forward 9080 mất trang xem sau khi cập nhật | Thấp | `deploy.sh` in lời nhắc; `viewerAccess: any` |
| Phạm vi lớn (6 story) | Cao | Làm theo thứ tự P1 trước; mốc sau mỗi bước |

## Câu hỏi cho phiên chính

**Đã trả lời 2026-10-11** (phiên chính, người dùng giao toàn quyền quyết định):

1. **Đồng ý phương án A:** `DevicePolicy=closed` + `DeviceAllow` + `SupplementaryGroups=dialout`.
   - Điều kiện: kết quả lệnh chỉ đọc trên BL335 (quickstart §8) cho thấy systemd 245 và cgroup của BL335 áp được `DeviceAllow` theo nhóm major.
   - Không đạt thì dùng phương án B. Task đổi unit chỉ đánh dấu xong khi có số đo trên thiết bị.
2. **Đồng ý `HAVE_FDATASYNC=1`.**
   - Làm thành task nền đầu tiên của 006, chạy lại toàn bộ test của 003 và 005 (x64, armhf, smoke qemu).
   - `fdatasync` giữ nguyên độ bền dữ liệu của SQLite trên ext4: metadata cần cho việc đọc lại vẫn được ghi.
3. **Đồng ý mặc định tạm 20 lệnh/phút toàn BL335.** Chốt lại bằng công thức R15 sau khi đo trên BL335.
4. **Đồng ý cả bốn điểm phối hợp.** Thứ tự:
   - live 1.2.0 làm sau T105/T106 của 005; alarm ở GĐ 4 dùng 1.3.0 (đã sửa lộ trình §4.5);
   - `live.rs` gửi token làm sau T085a; sửa kỳ vọng của test T070 trong cùng task;
   - `quiesce` làm sau T100;
   - `audit.db` lên phiên bản 2 (migration trong `AuditLog::open`), làm sau khi 005 đóng.
5. **Phiên bản:** 005 phát hành Studio 0.3.0, runtime 0.4.0. 006 là Studio 0.4.0, runtime 0.5.0.
6. **BL335:** chuyển danh sách lệnh của quickstart §8 cho người dùng, đồng thời xin quyền SSH. Trong lúc chờ, các task cần thiết bị đánh dấu ⚠️🔌.

Nội dung câu hỏi gốc giữ dưới đây để tra cứu.

1. **Sandbox của unit** (research R13, ADR-014): đồng ý thay `PrivateDevices=true` bằng `DevicePolicy=closed` + `DeviceAllow=char-ttyAS/ttyUSB/ttyACM` + `SupplementaryGroups=dialout`?
   - Lợi: thấy được bộ chuyển USB cắm nóng và tên `/dev/serial/by-id`.
   - Phương án B: giữ `PrivateDevices=true`, thêm `BindPaths` từng cổng qua drop-in; bộ chuyển USB cắm sau phải khởi động lại dịch vụ.
   - Cả hai đều cần kết quả lệnh chỉ đọc trên BL335.
2. **Cờ build SQLite `HAVE_FDATASYNC=1`** (research R15, ADR-017): áp cho mọi DB (`audit.db`, `history.db`), phải chạy lại test của 003 và 005. Không đồng ý thì mặc định tần suất ghi toàn BL335 hạ xuống 10 lệnh/phút để vẫn đạt SC-011.
3. **Mặc định tạm 20 lệnh/phút toàn BL335** (spec cho tới 30), chốt sau khi đo trên BL335. Đồng ý?
4. **Phối hợp với 005** (agent đang implement):
   - 006 dùng số live 1.2.0, số mà 005 dự kiến cho alarm; alarm của GĐ 4 thành 1.3.0 (§4.5 của lộ trình còn ghi "1.1.0", ngoài các mục plan này được sửa);
   - `live.rs` gửi token khi mở live (đổi kỳ vọng của test T070 của 005);
   - móc `quiesce` trong `deploy_pipeline`;
   - `audit.db` lên phiên bản 2.

   Phiên chính sắp lịch để các task 006 chạm file này chạy sau task tương ứng của 005.
5. **Phiên bản Studio:** plan giả định 005 phát hành Studio 0.3.0, nên 006 là 0.4.0. Nếu 005 giữ 0.2.x thì 006 là 0.3.0.
6. **BL335:** chuyển danh sách lệnh chỉ đọc ([quickstart.md](quickstart.md) §8) cho người dùng, hoặc xin quyền SSH để phiên làm việc tự chạy. Kết quả quyết định câu hỏi 1 và danh sách cổng mặc định.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Unit đổi `PrivateDevices=true` thành `DevicePolicy=closed` + `DeviceAllow` (câu hỏi 1) | Driver RTU phải mở cổng serial, kể cả bộ chuyển USB cắm nóng, mà không cấp capability | `PrivateDevices=true` + `BindPaths`: không thấy thiết bị cắm sau khi dịch vụ chạy, không có `/dev/serial/by-id` (giữ làm dự phòng) |
| Cờ build `HAVE_FDATASYNC=1` của SQLite dùng chung (câu hỏi 2) | SC-011: mỗi lần ghi Tag có 2 commit FULL; `fsync` tốn khoảng gấp đôi byte (đo x64) | Giữ `fsync`: phải hạ tần suất ghi xuống 10 lệnh/phút |
| Định dạng file riêng cho Tag giữ qua mất điện (nhật ký ghi tại chỗ, nén A/B) | FR-018 và SC-011: 4,1 KB mỗi lần lưu | File tạm + `rename`: 66–86 KB mỗi lần lưu, một mình đã vượt SC-011 ở mức trần |
| Lưới và cách nhận chữ từ bộ gõ tự viết | SC-013 (Telex TSF); license; giữ `grid-model` và theme của 004 | Handsontable: license phi thương mại; AG Grid Community: chọn vùng và clipboard thuộc bản thương mại; thư viện khác chưa rõ hành vi bộ gõ |
| Hàm `round`, `sin`, băm tự viết ở hai ngôn ngữ, build C++ với `-ffp-contract=off` | Constitution II và SC-008, SC-017: hai bản giống từng bit | `Math.round`/`std::round` khác nhau ở số âm; `Math.sin`/`std::sin` có thể lệch một ulp; GCC mặc định cho phép FMA |
| Hai bản mã hóa Modbus (C++ trong driver, TS trong giả lập) | Bắt lỗi hiểu sai giao thức mà cả driver và giả lập cùng mắc | Giả lập dùng lại mã C++: lỗi đối xứng lọt qua CI |
| Đổi giao thức live (1.2.0) và API (1.1.0) trong lúc 005 đang làm (câu hỏi 4) | Lý do của quality cho Bảng Tag và Bảng theo dõi; kênh live mang phiên cho FR-055a | Hỏi lý do qua HTTPS mỗi 2 s: trễ, thêm tải, hai nguồn dữ liệu cho một ô |
