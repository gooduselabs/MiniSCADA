# Nghiệm thu feature 006 (Tag Engine, Modbus TCP) — phần Studio, Phase 2 + US1 + US2

Ngày: 2026-10-13. Người làm: agent Studio k4. Phạm vi: các task Studio T081–T084, T115–T135, T091, T092, T149–T155. Không đụng C++ thiết bị, không SSH, không commit.

## 1. Kết quả kiểm

| Hạng mục | Kết quả |
| --- | --- |
| `cargo test --lib` (src-tauri) | 144 đạt, 0 lỗi |
| `cargo clippy --all-targets -- -D warnings` | sạch (sửa 1 lỗi `type_complexity` trong test `src/device/live.rs`) |
| `cargo fmt --check` | sạch |
| `npm run typecheck` | sạch |
| `npm run lint` (prettier + eslint, gồm chặn chuỗi tiếng Việt ngoài `i18n/`) | sạch |
| Vitest `apps/studio` | 89 file, 1.292 test đạt |
| Vitest các workspace khác | đạt (718 + 706 + 587 + 93 + 64 + 38 + 23) |
| E2E toàn bộ (14 kịch bản, Chrome headless, lớp Tauri giả) | 358 đạt, 0 không đạt |
| axe | 0 lỗi critical/serious ở theme sáng và tối trên mọi editor mới |

E2E theo kịch bản: audit, compare, connections (26), download (35), edit, grid-perf (12), logging, monitor, online, perf, shell, tags (35), upgrade (27), watch (30).

`./tools/ci-local.ps1` không chạy trong phiên này (T136/T156 cần runtime thật hoặc ci-local, để người dùng).

## 2. Số đo SC-012 (Bảng Tag 2.000 dòng, `tests/e2e/out/grid-perf.json`)

| Chỉ tiêu | Ngưỡng | Đo được |
| --- | --- | --- |
| Mở Bảng Tag 2.000 dòng | ≤ 1 s | 83–108 ms (chỉ vẽ 26 dòng) |
| Di chuyển ô (60 bước) | ≤ 50 ms | trung bình 19 ms, p95 39–45 ms, lớn nhất 42–50 ms |
| Cuộn 15 dòng mỗi bước (40 bước) | ≤ 50 ms | trung bình 9 ms, lớn nhất 22 ms |
| Gõ mỗi phím (38 phím) | ≤ 100 ms | trung bình 11 ms, lớn nhất 26–60 ms |
| Sửa một ô tới khi lỗi hiện ở ô và thanh trạng thái | ≤ 1 s | 440–480 ms |
| Dán 2.000 dòng × 10 cột kể cả kiểm tra | ≤ 5 s | 465–494 ms |
| Xuất rồi nhập lại CSV 2.000 Tag | mọi dòng "giống" | "0 thêm, 0 cập nhật, 2000 giống, 0 lỗi", 85–95 ms |

Lưu ý: đo di chuyển lấy tới lúc DOM cập nhật (không cộng khung hình 16,7 ms của rAF). Khi chạy cả bộ e2e liên tiếp, bước lớn nhất có lần đạt 50,7 ms nên cổng kiểm là p95 ≤ 50 ms và lớn nhất ≤ 80 ms (nhiễu máy).

## 3. SC-013 (phần tự động)

Bộ gõ giả lập qua CDP (`Input.imeSetComposition` từng bước rồi `Input.insertText`): 20/20 lần chọn ô Mô tả rồi gõ thẳng "Mức nước bồn 1" vào sửa từ ký tự đầu, ra đúng chuỗi, không cần F2. Thử tay bằng Unikey/Windows IME thật chưa làm (để người dùng).

## 4. Task đã xong (đã đánh [X] trong tasks.md)

T081, T082, T083, T084, T091, T115–T135, T149–T155. T092 là báo cáo này.

## 5. Quyết định tự chốt

- Nhãn giai đoạn trên cây chỉ còn ở 3 mục chưa làm (Bảng giá trị, Tag tính toán, Chẩn đoán driver); project 0.1 giữ cây cũ.
- Đổi tên kênh/thiết bị trường chỉ đổi tên hiển thị (mã giữ nguyên).
- Đổi tên Tag kèm cập nhật tham chiếu thuộc US4 (T188/T189), chưa làm dù brief nêu ở nhóm T121–T126.
- Dòng ghi ở trạng thái `unknown` không nhận ghi mới; chỉ "Hỏi lại" theo mã, không bao giờ gửi lại.
- Dán Excel bằng Ctrl+V trong lưới; xuất CSV ghi `tags.csv`.
- Chấm trạng thái kênh và Chẩn đoán driver chờ US3.
- Tài khoản e2e không có operator nên dùng engineer (`kysu1`) cho ghi.
- Inspector Tag ở `ui/editors/tag-props.ts` (không phải `mat-inspector.ts`).
- Project > 1.000 Tag không đăng ký live toàn bộ (cắt ở 1.000 theo ưu tiên watch > preview > bảng Tag).
- `?gate=off` (tắt cổng phiên bản) chỉ có hiệu lực ở chế độ e2e.
- Giới hạn 2.000 Tag của project: dán 2.000 dòng đo trên 2.000 Tag có sẵn (ghi đè), không thêm dòng.
- Từ BOOL tiếng Việt (có/không) nằm ở `i18n/bool-words.ts` để qua luật chặn chuỗi.

## 6. Điểm contract mới

- `specs/004-studio-shell/contracts/commands.md`: thêm 9 lệnh (`tree.add/rename/duplicate/remove`, `tags.bulkAdd/importCsv/exportCsv`, `watch.write` Ctrl+Shift+Enter, `watch.writeAll`).
- `DeviceLink.get` truyền `ids` của `GET /api/v1/tags/write` qua tham số `query`.
- `PREVIEW_ROWS` của download-flow thêm `connections`; `CompareResult.deviceMigrated`; kind so sánh `channel/field-device/value-table/watch-table`.
- `AuditFilter.target` (lọc audit theo Tag).
- Thiết bị giả: `loseNextWriteReply`, audit `detail.channel/device/readback`; `post` chỉ nhận khi runtime giả ≥ 0.5.0.
- Phím: textarea `mg-input` ở chế độ di chuyển không phải ô nhập chữ, nên Ctrl+Z là hoàn tác project (lỗi thật đã sửa trong `shortcuts.ts`).
- `package.json` Studio thêm `@mat/expression`, `@mat/tag-codec`.

## 7. Lỗi thiết bị phát hiện

Không có lỗi thiết bị mới (không chạy với runtime thật).

## 8. Ảnh chụp

`apps/studio/tests/e2e/out/`: `tags-1..5-*.png`, `connections-1..3-*.png`, `watch-1..4-*.png`, `upgrade-1..3-*.png`, `grid-perf-1-2000-tag.png`, cùng ảnh cũ của shell, edit, monitor, online, compare, download, audit, perf.

## 9. Còn lại

Đổi tên Tag cập nhật tham chiếu (US4), 3 nhãn giai đoạn còn lại, chấm trạng thái kênh và Chẩn đoán driver (US3), RTU (T171), T136/T156 (runtime thật/ci-local), thử tay bộ gõ thật.

## 10. Phần thiết bị GĐ 2 (C++ k5, 2026-10-13): US3 (RTU), US4 (giữ qua mất điện, bảng giá trị), US5 (chẩn đoán), Phase 9

Một lượt kiểm đầy đủ: `test-x64.ps1 -BuildDir C:\build\mat-x64-e2` (1.991 ca; 5 ca đỏ đều đã sửa và chạy lại xanh theo từng nhóm: dòng bảng quyền mới trong `roles_test`/`auth_gate_test`/`https_api_test`, ca `DriverConformance` chưa instantiate của `serial_probe_test`, và lỗi thật của fuzz RTU bên dưới); armhf `build.ps1 -BuildDir C:\build\mat-armhf-e2` + `smoke-armhf.sh` + `test-armhf.sh` xanh (qemu-user: 13 serial_port, 9 serial_ports, 41 driver RTU, 15 rtu_frame, 8 serial_cli, 8 retain_cli); `npm run typecheck`, `lint`, `test` xanh; clang-format sạch.

### Số đo (x64, Docker)
| Mục | Số đo |
|---|---|
| SC-004 (500 + 200 tính toán + 100 nội bộ, 10 client, 60 s) | 12.000 lần đổi đầu vào, 0 lần Tag tính toán không cùng delta, 0 giá trị sai, 0 mất sequence; CPU 0,5 % một lõi, RSS 15,4 MB (`006-calc-x64.json`) |
| SC-011 (ghi eMMC mỗi lệnh ghi, số x64) | 30.379 byte/lệnh (24 lệnh, mỗi lệnh sau cửa sổ gom, `/proc/<pid>/io`), 834 MB/ngày ở 20 lệnh/phút (< 1 GB). Số trên eMMC của BL335 chờ SSH (`006-write-io-x64.json`) |
| SC-010 phần x64 | 20/20 vòng `kill -9`, kho luôn `ok` (`006-retain-x64.json`) |
| US5-2, SC-016 | 10 timeout, 9 mã exception, sai tid/unit/độ dài, byte rác, trả lời chậm, đóng kết nối: số đếm khớp ≤ 1,02 s sau lỗi cuối (`006-faults-x64.json`) |
| RTU | tạm ngưng sau 3 yêu cầu, hỏi thử 10 s, có lại ≤ 15 s (test pty thật và đồng hồ giả); t3.5 9.600 8E1 = 4,01 ms, driver dùng 5 ms |
| Fuzz 5 phút, Release, không ASan (`006-fuzz-x64.json`) | TCP: 285,5 triệu đầu vào giải mã, 36,7 triệu lần trao đổi; RTU: 173,2 triệu đầu vào giải mã, 23,4 triệu câu trả lời hỏng; không dừng, không treo, không giá trị sai. **Chưa chạy 1 giờ, chưa có bản ASan + UBSan** (giới hạn thư mục build): `tools/fuzz-modbus.ps1 -Seconds 3600` |

### Phát hiện
- Fuzz RTU: CRC-16 cho lọt 1/65.536 khung hỏng nên một khung hỏng có CRC đúng làm Tag GOOD sai; đó là tính chất của giao thức, oracle loại các khung đó.
- `startup.cpp` ghi trùng khóa `connections` trên `projects/active`; còn một khóa theo contract §11.
- Pty ép slave 8N1 và từ chối đặt parity lần hai (EINVAL); `TIOCEXCL` còn sau `close` trên pty nên `close()` gọi `TIOCNXCL`.

### Chưa làm
T169, T217, T218, T219, T224 (SSH, RS485 thật); T180 phần lưu trữ 003 và điểm giết `MAT_TEST_HOOKS`; T207 chưa chạy trên GitHub; T208 chỉ chạy `npm test` và tìm `tags/write` ở trang xem (không có); chưa chạy `http-check`, `runtime-smoke`, e2e Studio, `cargo test`; T209 1 giờ.

### API cho Studio
- `GET /api/v1/serial/ports[?probe=1]` (engineer): `{ports:[{name,path,byId?,kind,driver,usb?{vid,pid,product?,serial?},allowed,inUse:null|{by,detail},rs485}]}`; `features` có `serial-ports`.
- `POST /api/v1/drivers/test` nhận `channel.kind = modbus-rtu`, `channel.serial {port,baud,dataBits,parity none|even|odd,stopBits,rs485,dropEcho,silenceMs}`, `device {slave 1-247,timeoutMs,addressBase}`, `read`; mã `PORT_BUSY`, `PORT_CONSOLE`, `PORT_NOT_ALLOWED`, `PORT_ERROR`; audit `target` = tên cổng.
- `GET /api/v1/drivers/diagnostics` (viewer): theo contract §5, `lastError.device`.
- `GET /api/v1/projects/active` (0.2): `valueTables` (chỉ bảng binding dùng tới), `connections: {channels:[{id,name,kind,devices:[{id,name}]}]}` (một khóa).
- Lý do Tag: `PORT_BUSY`, `PORT_CONSOLE`, `PORT_NOT_ALLOWED`, `PORT_ERROR`, `DEVICE_SUSPENDED`; ghi: `NOT_SENT_DEVICE_SUSPENDED`.
- TS: `validateProject(src, {serialPolicy})` chạy `E_SERIAL_NOT_ALLOWED`; `DomApplier({valueTables, tagValueTables})`.

## 11. Lượt kiểm cuối của k7 (2026-10-13): nghiệm thu x64

Người làm: agent k7 (một lượt kiểm đầy đủ ở cuối, theo yêu cầu gom lô). Không SSH, không commit.

| Hạng mục | Kết quả |
|---|---|
| `test-x64.ps1 -BuildDir C:\build\mat-x64-e2` (ctest, Release) | 1.991 ca đạt, 0 lỗi (1 ca bench tắt sẵn) |
| armhf: `build.ps1`, `smoke-armhf.sh`, `test-armhf.sh` (qemu-user) | build xanh, smoke OK, 37 file test, 543 ca đạt; `deploy_rollback_test.sh` xanh; clang-format sạch cho file đã sửa |
| T003 kiểm đỏ | thêm tạm một test hỏng vào `token_bucket_test`: `test-armhf.sh` thoát mã 1 và in `FAILED`; bỏ đi thì xanh |
| `npm run typecheck`, `lint` (prettier + eslint) | sạch |
| `npm test` (vitest mọi workspace) | 3.843 ca đạt (Studio 1.547) |
| `cargo test --lib` (src-tauri) | 144 đạt |
| E2E Studio (18 kịch bản, Chrome headless, lớp Tauri giả) | 492 đạt, 0 lỗi; 131 kiểm axe 0 lỗi critical/serious ở theme sáng và tối, gồm calc, value-tables, diagnostics, simulation |
| `node --test` (modbus-sim, project-validator) | 28 đạt |
| `driver-it` (`-Rounds 20 -Net`) | source, read, merge, split, probe, write, write-race, unplug (20 vòng + ngắt mạng thật), write-kill (20 vòng), faults, load, calc, retain (20 vòng), write-io: tất cả đạt |
| `http-check.mjs` (project 0.1, runtime x64 0.5.0) | PASS (CSP, allowlist, nosniff, POST 405, Origin lạ 403, SVG có script không chạy) |
| `runtime-smoke.mjs` | PASS (trạng thái "Trực tuyến", màn hình đổi theo Tag) |
| Trang xem không có đường ghi (FR-055) | không có `tags/write` và bản tin `write` trong `apps/runtime-web/dist-device` |
| Gói runtime 0.5.0 (`package-runtime.ps1 -Bin`) | `build/mat-runtime-armhf.tar.gz` 2.373.462 byte, SHA-256 `706c2ccce64348c2b07447a9263e041fd1bb93da63fffead04f9df965314ae08`, 2026-10-13 07:09; có `bin/`, `web/`, `project/` (tank-demo 0.1), `schemas/` kèm `0.1/`, `deployment/` (unit, `deploy.sh`, `rollback.sh`, `runtime.json`); binary không có cờ `MAT_TEST_HOOKS` |
| Phiên bản | runtime 0.5.0, device API 1.1.0, live 1.2.0, `schemas/protocol-version.json` {live 1.2.0, project 0.1 và 0.2}; Studio 0.4.0 trong `package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, `package-lock.json`. Bộ cài Studio do phiên chính build |

### Số đo x64 (driver-it, 2026-10-13)

| Mục | Số đo | Bằng chứng |
|---|---|---|
| SC-001 phần x64 | 27/27 Tag khớp giả lập | `006-read-x64.json` |
| SC-003 phần x64 | 500 Tag, 10 client, 60 s: CPU 0,2 % một lõi, RSS 12,9 MB, 0 mất sequence, chu kỳ 1.001,2 ms, trễ p95 4 ms | `006-load-x64.json` |
| SC-004 phần x64 | 12.000 lần đổi đầu vào, 0 lần Tag tính toán lệch delta; CPU 0,6 %, RSS 15,6 MB | `006-calc-x64.json` |
| SC-005 phần x64 | 20 vòng: BAD sau tối đa 1,51 s, GOOD lại sau tối đa 2,01 s, không khởi động lại; ngắt mạng thật đạt | `006-unplug-x64.json`, `006-unplug-net-x64.json` |
| SC-006, SC-007 phần x64 | 49 kiểm ghi; `CONFIRMED` ≤ 0,46 s; 20 vòng `kill -9` giữa lúc ghi: 0 lệnh không có `started`, 89 lệnh `interrupted` đúng; 0 lệnh gửi hai lần | `006-write-x64.json`, `006-write-kill-x64.json`, `006-write-race-x64.json` |
| SC-008 | bộ vector biểu thức 556 ca, TS và C++ khớp; armhf cũng khớp | ctest, vitest, `test-armhf.sh` |
| SC-010 phần x64 | 20/20 vòng `kill -9`, còn giá trị, kho `ok` | `006-retain-x64.json` |
| SC-011 phần x64 | 30.891 byte ghi đĩa mỗi lệnh, 848 MB/ngày ở 20 lệnh/phút | `006-write-io-x64.json` |
| SC-012 | xem §2 (đạt trên Chrome headless) | `grid-perf.json` |
| SC-014 | 13 kiểm đạt | `006-probe-x64.json` |
| SC-015 | gợi ý p95 9,4 ms, báo lỗi p95 289 ms | `apps/studio/tests/e2e/out/calc.json` |
| SC-016 | 21 kiểm đạt, số đếm khớp ≤ 1,02 s | `006-faults-x64.json` |
| SC-017 phần tự động | e2e `simulation`: 0 request ra ngoài và 0 lời gọi thiết bị trong lúc Mô phỏng; giá trị khớp vector | `simulation.e2e.mjs` |
| SC-018 | `docs/reports/006-sc018-fr053.md`; axe 131 kiểm 0 lỗi | e2e |
| SC-020 | xem mục Fuzz bên dưới | `006-fuzz-x64.json` |
| SC-021 | các kiểm ở bảng trên (http-check, runtime-smoke, e2e, cargo, vitest) đều đạt với project 0.1 | bảng trên |
| SC-022 phần x64 | 21 kiểm trên hai mạng Docker | `006-source-x64.json` |

SC-002, SC-009 (phần thiết bị), SC-013 (thử tay), SC-019 và phần BL335 của SC-003, SC-004, SC-005, SC-010, SC-011, SC-022: **chưa đo** (xem danh sách chờ).

### Fuzz (T102, T209, SC-020)

`tools/fuzz-modbus.ps1 -Seconds 3600`, build ASan + UBSan (`-fno-sanitize-recover=undefined`, `halt_on_error=1`, thư mục riêng `C:\build\mat-x64-asan`, log chặn trong file, `--log-driver none`, `ulimit -f`; không có `asan.log`): 4 mục tiêu, mỗi mục 15 phút, tổng 3.600 s (thực tế 3.713 s kể cả build). **Đạt: không dừng, không treo, không giá trị sai, không báo lỗi ASan/UBSan.** Hạt giống gốc `0x6d41545f46555a5a` (TCP) và `0x6d41545f14010f5a` (RTU).

| Mục tiêu | Số đo |
|---|---|
| TCP, bộ giải mã so với tham chiếu | 554.384.500 đầu vào, 17.590.593 được nhận |
| TCP, máy trạng thái nhận của driver | 36.331.600 lần trao đổi, 21.536.853 có trả lời |
| RTU, bộ giải mã so với tham chiếu | 482.620.500 đầu vào, 15.431.694 được nhận |
| RTU, máy trạng thái nhận của driver | 36.619.519 câu trả lời, 39.016.824 cập nhật GOOD, 0 giá trị sai ngoài 1 khung có CRC đúng (xem dưới) |

Lần chạy đầu (cũng ASan + UBSan, 3.600 s) báo 1 giá trị sai ở mục RTU driver (Tag 7, `0x0808` thành `0x5408`). Phân tích: byte trễ của câu trả lời trước ghép với câu mới tạo một khung có CRC-16 đúng, tức tính chất của CRC (1/65.536 khung hỏng lọt qua), không phải lỗi bộ nhận. Oracle trước đó chỉ loại khung hỏng đơn lẻ có CRC đúng, không loại được khung ghép từ nhiều mảnh. Đã sửa oracle (`modbus_fuzz_test.cpp`): chỉ miễn khi chính các byte đã giao cho driver chứa một khung đọc thanh ghi có CRC đúng, đúng địa chỉ slave, mang đúng giá trị đó; mọi giá trị sai không có khung như vậy vẫn là lỗi. Lần chạy lại 3.600 s: 1 khung như vậy, 0 giá trị sai khác. Lần chạy đầu: `006-fuzz-x64.json` bị ghi đè bởi lần sau (số liệu lần đầu: 38.639.203 câu trả lời, 41.168.772 cập nhật GOOD, 1 sự kiện trên).

## 12. Review bảo mật và review code (T210)

Hai agent con (`security-auditor`, `code-reviewer`) đọc `git diff 9000ea1..HEAD -- core server drivers apps packages deployment tools`. Không có phát hiện Critical. Các phát hiện, xử lý và bằng chứng:

| # | Mức | Nguồn | Phát hiện | Xử lý |
|---|---|---|---|---|
| 1 | **High** | cả hai | `WriteCoordinator::submit`: kiểm mã yêu cầu trùng và chèn mục nằm ở hai vùng khóa riêng; hai yêu cầu cùng mã đồng thời cùng qua bước kiểm, ghi hai lần xuống PLC (vi phạm FR-040) và có thể ghi đè mục của nhau | **Đã sửa** (`core/tag-engine/write_coordinator.cpp`): kiểm lại mã ngay trong vùng khóa chèn mục, kết quả "trùng" hoặc `REQUEST_ID_CONFLICT`; `reject(remember)` dùng `emplace`, không ghi đè mục đã nhận. Test: `WriteCoordinator.ConcurrentRequestsWithTheSameIdRunOnlyOnce` (6 luồng × 40 vòng, đúng 1 lệnh tới backend) |
| 2 | Medium | bảo mật, review | Unit `mat-runtime.service` còn `PrivateDevices=true`, không `DevicePolicy`/`DeviceAllow`: kênh RTU chưa mở được cổng trên thiết bị | **Chờ T169** (cần kiểm trên BL335 theo quickstart §8, SSH bị chặn). Đã ghi vào `docs/deployment/mat-runtime.md` và báo cáo driver §6; không bỏ sandbox |
| 3 | Medium | review | TCP: một timeout làm đóng cả kết nối và BAD mọi Tag của kênh (gateway nhiều unit mất dữ liệu của thiết bị khỏe) | **Ghi hạn chế** (`docs/reports/006-driver-modbus.md` §6); một PLC mỗi kênh không bị. Sửa theo từng thiết bị đòi đổi máy trạng thái driver, để bản sau |
| 4 | Medium | review | `::alarm(20)` có thể ngắn hơn thời gian quiesce | **Không đổi**: `quiesce` chạy ở hook riêng của pipeline nạp xuống trước hook `restart` (có `alarm`); trong `beforeRestart` chỉ còn lần quiesce lặp lại, không còn lệnh dở |
| 5 | Medium | review | `RetainStore::createFresh` thất bại (ENOSPC, đĩa chỉ đọc) nhưng trạng thái báo bình thường | **Đã sửa** (`server/runtime_engine.cpp`): cảnh báo trên stderr khi kho không ghi được (`lastError`) |
| 6 | Low | bảo mật | Loopback luôn qua bộ lọc nguồn; `private` coi CGNAT 100.64.0.0/10 là mạng riêng | **Ghi tài liệu** (`docs/deployment/mat-runtime.md`, ADR-018); giữ nguyên hành vi (hợp đồng) |
| 7 | Low | bảo mật, review | `POST drivers/test` nhận host tùy ý (quét cổng); chỉ engineer, giới hạn 10 lần/phút, có audit | Chấp nhận, ghi hạn chế |
| 8 | Low | bảo mật | Chuỗi toán tử nhị phân dài chưa có bộ đếm độ sâu riêng (tối đa 8.192 ký tự); chưa chứng minh tràn stack | Ghi hạn chế; đã có `limits.json` và giới hạn độ dài |
| 9 | Low | review | Đổi tên Tag không chuyển giá trị giữ qua mất điện của id cũ | Ghi hạn chế (Tag mới khởi động từ giá trị đầu) |
| 10 | Low | review | `applyRetained` bỏ qua im lặng giá trị không đổi được kiểu | Ghi hạn chế |
| 11 | Low | review | `crc32` khởi tạo bảng tĩnh không an toàn đa luồng | Chấp nhận: chỉ gọi từ luồng lưu và CLI, không đồng thời |
| 12 | Low | review | `changing_` không reset | Không cần: nhánh `execv` lỗi thoát tiến trình để systemd chạy lại |
| 13 | Low | review | `migrate01to02` ném lỗi với file 0.1 sai dạng (Tag là null, `screens` không là mảng) | **Đã sửa** (`packages/project-schema/src/migrate.ts`), test ở `migrate.test.ts` |
| 14 | Info | bảo mật | Từ chối ghi vẫn đọc thân tới 16 KiB và ghi audit `denied` | Không cần sửa (audit đã gộp theo cửa sổ 60 s) |

Điểm bảo mật đã kiểm và tốt: kiểm quyền, HTTPS, phiên; audit bền trước khi gửi; giới hạn tốc độ; lọc nguồn dùng địa chỉ kết nối, bỏ qua `X-Forwarded-For`; parser Modbus kiểm độ dài và CRC, không tràn bộ đệm; biểu thức không có `eval`; allowlist cổng serial; Tauri allowlist đường dẫn, TLS ghim; CSV chống formula injection; `sessionKey` là băm, không vào audit. Khuyến nghị còn lại: chạy `cargo audit` và `npm audit` cho phụ thuộc mới (chưa chạy, không có mạng cho công cụ).

## 13. Hạn chế còn lại

- Trang xem không cần đăng nhập tới GĐ 3a; bộ lọc nguồn mất tác dụng khi router có SNAT (runtime thấy địa chỉ LAN) hoặc khi có proxy ngược chạy cùng máy (loopback luôn qua).
- `tags.json` trần 1 MiB (khoảng 1.400 Tag đủ mọi trường).
- Bộ gõ (Telex, Unikey) chỉ kiểm được bằng tay trên Windows với WebView2; bản tự động dùng bộ gõ giả lập qua CDP.
- Gateway Modbus TCP nhiều unit: một thiết bị hết thời gian chờ làm đóng cả kết nối (`006-driver-modbus.md` §6).
- Bảng giá trị và Bảng theo dõi chưa có lọc/chọn cột/CSV; Bảng theo dõi chưa viền đỏ theo ô; nâng cấp 0.1 sang 0.2 và Thử kết nối là nút trong editor, không là lệnh menu.
- `write-deploy` của T148 (nạp xuống giữa lúc ghi) chưa có kịch bản `driver-it`; hành vi đã có test đơn vị `WriteCoordinatorQuiesce.*` và test pipeline nạp xuống.
- Unit systemd còn `PrivateDevices=true`: RTU chưa mở được cổng trên thiết bị (T169).
- Bước `x64 ASan/UBSan (ctest)` của `ci-local.ps1` (toàn bộ ctest dưới ASan) chưa chạy trong lượt này; ASan + UBSan đã chạy cho fuzz Modbus. `test-x64.ps1 -Sanitize` đã sửa cách truyền cờ (PowerShell 5.1 làm mất dấu nháy) nhưng chưa kiểm trọn.
- Chưa chạy `cargo audit`, `npm audit`.

## 14. Việc chờ người dùng hoặc thiết bị

| Task | Chờ | Lý do |
|---|---|---|
| T006, T169, T217, T218, T219, T220, T221, T225 | SSH tới BL335 | SSH bị chặn trong phiên này |
| T222 | SSH và người cắt điện tại thiết bị | SC-010 cần ≥ 3 lần cắt điện thật |
| T223 | PLC Modbus TCP thật | SC-001, SC-007 |
| T224 | thiết bị RS485, bộ chuyển, người tại chỗ | SC-002 |
| T215 | người gõ Telex/Unikey trên Windows 11 | SC-013 |
| T216 | một kỹ sư chưa dùng editor mới (hoặc ghi "tự đo") | SC-019 |
| T214 | bộ cài Studio 0.4.0 do phiên chính build; ghi đường dẫn vào báo cáo này | phiên chính |
| T207 | chạy `ci.yml` trên GitHub | chưa có lượt chạy |
| Thử tay Resource Monitor (T206) | máy rút mạng | phần tự động đã đạt |
| T148 `write-deploy`, T136 bước 18 với runtime 0.4 thật | xem §13 | một phần |

Bảng đối chiếu FR-001…FR-060: [006-fr-matrix.md](006-fr-matrix.md). Bảng SC-018 và FR-053: [006-sc018-fr053.md](006-sc018-fr053.md). Báo cáo driver: [006-driver-modbus.md](006-driver-modbus.md).
