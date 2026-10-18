# Bảng đối chiếu FR và SC của feature 011 (T204)

Ngày lập: 2026-10-17, trên nhánh `gd6` (commit `c86ebe85`). **Đếm lại 2026-10-18** theo `tasks.md` hiện hành (T013, T063, T075, T077–T079, T122, T146–T148, T191, T202, quyết định O1/O2 và T081). Nguồn: `specs/011-pilot-hardening/{spec.md, tasks.md}` (ô đánh dấu và "Ghi chú khi làm"), `docs/reports/011-*.json`, `docs/reports/011-{security-review,sast,license,release-dryrun,spikes}.md`, `docs/reports/device-changes.md` (mục 2026-10-17, 2026-10-18), `docs/pilot/customer-checklist.md`.

Trạng thái:

- **Đạt**: có test hoặc kịch bản tự động xanh, hoặc tài liệu/công cụ đúng yêu cầu. "Đạt (x64)" là đo trong container Docker; nhiều lượt "x64" của 011 thực ra chạy image `mat-armhf` trên Linux arm64 (Apple Silicon), báo cáo JSON ghi rõ máy.
- **Không đạt**: việc chưa xong hoặc số đo vượt ngưỡng; ghi phần thiếu.
- **Chưa đo**: làm được mà không cần người (x64 hoặc BL335 qua LAN) nhưng chưa chạy; ghi task.
- **Chờ người**: cần người ở cạnh thiết bị, Windows thật, chứng chỉ thật, khách hàng hoặc người thử; mã mục ở `docs/pilot/customer-checklist.md` (K, B, R, H, P).

Một dòng có thể có hai phần (ví dụ "Đạt (x64) · Chưa đo BL335"); kết luận của dòng là phần yếu hơn.

Viết tắt: `ps` = `packages/project-schema/src`; `le` = `packages/logic-engine/src`; `se` = `packages/svg-edit/src`; `st` = `apps/studio/src`; `rw` = `apps/runtime-web/src`; `uc` = `packages/ui-components/src`; `R:` = `docs/reports/`; "ctest X" = GoogleTest/CTest x64.

## Chung (FR-001 đến FR-010)

| FR | Nội dung | Task | Bằng chứng | Trạng thái |
|---|---|---|---|---|
| FR-001 | Phiên bản 1.0.0 (runtime, Studio, định dạng, `.matupdate`), API MINOR kế tiếp, bản dựng mang `-rc.N` | T003, T191 | T191 (2026-10-18): Studio (`package.json`, `tauri.conf.json`, `Cargo.toml`) và runtime (`kRuntimeVersion`, `RUNTIME_VERSION`) cùng `1.0.0-rc.1` (`build-info.mjs versions --expect 1.0.0-rc.1` đồng nhất); API 1.5.0, live 1.3.0, định dạng 1.0.0, `.matupdate` 1.0.0; rc.1 nhận project `minRuntimeVersion` 1.0.0 (vector `v10-runtime-rc-*`, ADR 035 mục 7) | Đạt (mã nguồn; gói rc ký trên Windows: T102, T104) |
| FR-002 | Runtime nhận 0.1 đến 1.0; Studio nâng cấp có sao lưu; ma trận tương thích | T015–T020 | `ps/migrate-10.test.ts` 21/21, `tests/migration-vectors/0.6-to-1.0/` 18 cặp; `store-10.test.ts` 6/6; BL335 1.0.0 báo `schemaVersions` 0.1–1.0 (`device-changes.md` 2026-10-17); ma trận ở `docs/user/admin-guide.md` | Đạt |
| FR-003 | Hồi quy 003–010 | T059, T200 | T191 (2026-10-18): `ci-local` đầy đủ xanh trên `1.0.0-rc.1` ("ALL STEPS PASSED": build armhf, ctest x64, armhf qemu, `device-it`, `driver-it`, `web-it`, `alarm-it`, `update-it`, `logic-it`, SAST, audit, e2e Studio và runtime-web, `cargo test --lib`, smoke armhf); ctest dưới ASan + UBSan chạy riêng (T059: 5.888 ca, 56 đỏ đã phân loại và sửa) · chưa có lượt `ci-local -Sanitize` và so cặp 0.6/1.0 (T200) | Chưa đo — T059 (ASan qua `ci-local`), T200 |
| FR-004 | Cấm `eval`/`innerHTML`; lint mở rộng | T014 | `tools/lint-rules.test.mjs` đỏ 5/22 rồi 22/22; khối mới trong `eslint.config.mjs` | Đạt |
| FR-005 | Ngân sách kèm logic (RSS, CPU, eMMC, cache, tmpfs) | T079, T147, T148, T201 | `R:011-load.md` §1, `R:011-soak.md`; BL335 1.0.0 L1 4 giờ: RSS ≤ 19,5 MB, CPU 28,9 % một lõi (T079); logic tối đa trên BL335 (rc.1, T148): quét 2,5 ms, RSS +3,9 MB đạt, **CPU +3,3 điểm một lõi vượt ngưỡng +3**; eMMC và tổng hợp ngân sách chưa làm (T201) | Không đạt — CPU logic BL335 vượt 0,3 điểm (T148); tổng hợp T201 chưa làm |
| FR-006 | Mã lỗi mới có test, tiếng Việt, `error-codes.md` | T025 | `tools/gen-error-codes.test.mjs` 6/6 (quét mã nguồn, thất bại khi thiếu mã); `schemas/error-codes.json`; `docs/user/error-codes.md` sinh bằng `--check` | Đạt |
| FR-007 | Thao tác BL335 theo Constitution, ghi `device-changes.md` | T206 | `R:device-changes.md` mục 2026-10-16, 2026-10-17, 2026-10-18 (T079, T122, T148, T013, T063, cài `1.0.0-rc.1`; mỗi thay đổi kèm cách hoàn tác, không đụng `atscada-*`) | Đạt (tiếp tục ở T206) |
| FR-008 | Khóa `runtime.json` mới | T026, T027 | ctest `Config011.*`, config 47/47; `deployment/config/runtime.json`; `maxConnPerSource` mặc định 48 (spec ghi 24; đổi có ADR-010, T039) | Đạt |
| FR-009 | Trường KPI ở `system/diagnostics` | T028, T029 | ctest `proc_stats_test` 16/16, `diagnostics_011_test` 13/13, `diagnostics_audit_api_test` 21/21 · BL335 (T013, 2026-10-18): không có `mmc-utils`, tuổi thọ đọc qua sysfs `life_time` `0x01 0x01`, `pre_eol_info` `0x01`, runtime đọc đúng đường này; kernel 5.4 không có `/proc/<pid>/io` (ADR-039) | Đạt |
| FR-010 | Cảnh báo mới trong `system/info.warnings` | T030, T031, T049, T116, T137, T140 | ctest `SystemInfo011` (4), `ssh_warning_test` 13/13, `time_sync_test` 7/7; `st/model/device-011.test.ts` 6/6; BL335 1.0.0 báo `SSH_ROOT_PASSWORD`, `VIEWER_PUBLIC`, `TLS_NO_IP_SAN` đúng cấu hình | Đạt |

## US1: rà soát bảo mật (FR-011 đến FR-036)

| FR | Nội dung | Task | Bằng chứng | Trạng thái |
|---|---|---|---|---|
| FR-011, 012 | Kiểm `Host` trước mọi xử lý (HTTP, HTTPS, WebSocket); `Origin` giữ | T032, T042, T053 | ctest `host_policy_test` 22/22; `R:011-host-x64.json` 16/16 (Chrome thật, DNS rebinding giả lập); BL335 1.0.0: `Host: evil.test` → 421 trên HTTP và HTTPS, IP/`.local`/`localhost` → 200 | Đạt |
| FR-013 | `deploy.sh` và tài liệu nhắc `allowedHosts` | T042, T051 | `deployment/device/deploy.sh`; `deploy_rollback_test.sh`; `docs/deployment/mat-runtime.md` 5h | Đạt |
| FR-014, 015, 016 | Khóa (tên, IP), khóa IP, `LOGIN_BUSY` | T033, T034, T043 | ctest `login_guard_test` 19/19, `auth_service_test` 33/33, `auth_gate_test`, `web_gate_test`; `R:011-lockout-x64.json` (1.000 lần đoán: 20 lần kiểm mật khẩu, 980 lần 429; IP B vào ≤ 19 ms) | Đạt (x64) |
| FR-017 | `--user-unlock`, `--user-unlock-all`; mật khẩu mới ≥ 10 | T035, T044 | ctest `user_cli_test` 26/26, `account_store_test` 17/17; tối thiểu thực tế 15 ký tự (ADR-011, vẫn thỏa ≥ 10) | Đạt |
| FR-018, 019, 020 | Nhật ký xung, nhả khi khởi động, `releasePulse` không ngủ | T036, T045, T054 | ctest `pulse_journal_test` 22/22, `write_coordinator_test` 39/39; `R:011-pulse-x64.json` (20/20 vòng `kill -9` nhả bit ~7,2 s; 20/20 nhật ký hỏng → `PULSE_JOURNAL_FAILED`); sửa LG1, LG5, LG11 (`R:011-security-review.md` §3) | Đạt (x64) · điểm D4 BL335 Chờ người (T085, B4) |
| FR-021, 022 | Modbus TCP cô lập timeout theo unit, backoff riêng | T037, T046, T054 | ctest `modbus_tcp_multiunit_test` 9/9; `R:011-gateway-x64.json` (1.000 chu kỳ, unit 1 và 3 GOOD 1000/1000, 0 kết nối mới) | Đạt (x64) |
| FR-023 | `persist()` ngoài mutex, `PERSIST_FAILED` | T038, T047, T054 | ctest `deploy_pipeline_test` 29/29; `R:011-persist-x64.json` (fsync 500 ms: p99 6 ms; ENOSPC → `PERSIST_FAILED`) | Đạt (x64) |
| FR-024 | Từ chối tệp thừa `E_PACKAGE_EXTRA_FILE` | T022–T024, T054 | 13 vector `tests/package-vectors/extra-*` (C++, TS, Rust); `R:011-extra-file-x64.json` (30 lần nạp, 0 `HEALTH_TIMEOUT`) | Đạt |
| FR-025 | Giới hạn kết nối theo nguồn | T039, T048, T062 (M1) | ctest `conn_limit_test` (60 TLS im lặng, nguồn khác 25 ms); giới hạn theo cổng (HTTP 18/24, HTTPS 48/64), live 5 phiên/IP · BL335 rc.1 (T063): 40 TLS im lặng, 43/43 đăng nhập từ địa chỉ khác, chậm nhất 837 ms, RSS không tăng bền (`R:011-security-bl335.json`); T079 L8 tệ nhất 1.198 ms, RSS +0,3–0,7 MB | Đạt |
| FR-026 | Các mục Low rẻ (S-L3, ChartWindow, …) | T041, T050 | Vitest `confirm-dialog`, `chart/window`, `widgets/base`, `rw` 45/45; ctest biểu thức 18/18, audit 38/38, web 25/25; Rust 150/150 | Đạt |
| FR-027 | `cargo audit`, `npm audit`, license, tra CVE | T056, T057 | `R:011-audit-npm.json` (0 lỗ hổng); `R:011-audit-cargo.json` (rustls: 1 Medium, 3 Low, không chạm tới; nâng 0.23.46 từ 2026-10-28); `R:011-license.md`; bảng CVE `third_party/LICENSES.md` (CivetWeb CVE-2025-55763 chấp nhận có lý do) | Đạt |
| FR-028 | SAST cppcheck + clang-tidy | T011, T055 | `R:011-sast.md` (73 + 29 phát hiện đã phân loại, 1 lỗi thật `compareSemver` đã sửa; `run.ps1`: 0 error/warning) | Đạt |
| FR-029 | Fuzz ≥ 1 giờ mỗi mục tiêu (ASan + UBSan) | T058, T118, T142, T165 | `R:011-fuzz-x64.json`: TS (T058, T142, T165) project-json, expression, params, package-digest, logic-json, svg-edit-commands mỗi mục ≥ 1 giờ, `svg-sanitize` 3.626 s (`R:011-fuzz-svg.json`); C++ dưới ASan + UBSan: `update-envelope` 3.600 s, gói `.matscada` 3.600 s, `logic-json` 3.601 s, **project-json, expression, modbus mỗi mục 1.800 s** (chưa đủ 1 giờ); 0 sự cố ở mọi lượt (Docker Linux arm64, không phải x64 thật) | Chưa đo — ba mục tiêu C++ mới 30 phút (T058) |
| FR-030 | `ci-local.ps1` thêm ASan ctest, audit, sast, docs-check, update-it, logic-it | T059 | Bước mới trong `tools/ci-local.ps1` và `ci.yml` (commit 02d70856): `sast`, `audit` (không mạng ⇒ BỎ QUA), `update-it`, `logic-it`, fuzz C++ 20 s sau ASan, `docs-check`; bước bỏ qua in "BO QUA (SKIPPED)"; `ci-local` đầy đủ xanh trên rc.1 (2026-10-18) · chưa chạy `ci-local -Sanitize` (ASan qua ci-local) | Chưa đo — T059 (lượt `-Sanitize`) |
| FR-031 | Mô hình mối đe dọa | T060 | `docs/architecture/threat-model.md` (14 giao diện, mọi phát hiện Medium trở lên ánh xạ một dòng) | Đạt |
| FR-032 | Review hai agent trên diff từ mốc 007 | T062, T202 | `R:011-security-review.md` lần 1 (T062, 5 lượt; 0 Critical; K1 High đã sửa) và lần 2 (T202, §7: 0 Critical/High; N-OTA1–3 Medium và các Low đã sửa, gộp); O1 chấp nhận, O2 hoãn sau pilot (ADR-035) | Đạt |
| FR-033 | `hardening.md` | T061, T064 | `docs/deployment/hardening.md` · áp dụng trên BL335 cần người ở cạnh | Đạt (tài liệu) · Chờ người (T064, B2, B3) |
| FR-034 | Cảnh báo `SSH_ROOT_PASSWORD` | T040, T049 | ctest `ssh_warning_test` 13/13; BL335 1.0.0 báo cảnh báo này (đúng cấu hình hiện tại) | Đạt |
| FR-035 | Bảng truy vết "Phát hiện tồn" | T065 | `plan.md` mục "Phát hiện tồn" (18 Medium, H-xx của 006–010); dòng "Cập nhật 011" ở báo cáo 005, 006, 007, 008 | Đạt |
| FR-036 | Studio hiện chip cảnh báo mới, `acceptedHosts`, hướng dẫn 421 | T052 | `st/ui/mat-statusbar-006.test.ts`, `device-page-online.test.ts` (đỏ rồi xanh) | Đạt |

## US2: tải, soak, mất điện (FR-037 đến FR-046)

| FR | Nội dung | Task | Bằng chứng | Trạng thái |
|---|---|---|---|---|
| FR-037 | `mat-sample` chỉ đọc, tmpfs, quay vòng | T067, T070 | `tools/soak/mat-sample.test.mjs` (cây `/proc` giả); `node --test` soak + powercut 55/55; chạy trong container của soak x64 (T076, đang chạy); chưa cài trên BL335 (T079 dùng script lấy mẫu riêng) | Đạt (công cụ) · Chưa đo trên BL335 (T079) |
| FR-038 | `load-tester` 500/1.000 Tag, client 11, F5, SVG, `--latency` | T071, T072 | Go 18/18; `tests/web-it/f5-storm.mjs`, `svg-load.mjs`; `tools/gen-bench-projects.mjs` 6/6; dùng ở T075 (x64) và T079 (BL335); phần thứ hai L3 (client mới vào ≤ 35 s) chưa có trong `load-tester` (T079 đo bằng script riêng trên BL335: 28–83 ms, 15,2 s khi client 1 im lặng) | Không đạt — `load-tester` thiếu phần L3 nối lại (T071) |
| FR-039 | Soak S0 x64 24 giờ, S1 BL335 7 ngày, S2 30 ngày | T076, T081, T196 | `R:011-soak.md` §2a: S0 x64 24 giờ đang chạy từ 2026-10-17 20:38 UTC (`tools/soak/x64-soak.mjs`); S1 BL335 7 ngày **không chạy ở GĐ 6 theo quyết định người dùng 2026-10-18** (thay bằng S0, L1 4 giờ BL335, S2 khi pilot) | Chưa đo — S0 (T076) · S1 hoãn theo quyết định người dùng (T081) · S2 Chờ người (P2) |
| FR-040 | `--check-data` chỉ đọc ≤ 30 s | T066, T069 | ctest `check_data_test` 13/13, armhf qemu 13/13; `history.db` 500 MiB: 0,79 s (x64) | Đạt (x64) · Chưa đo BL335 |
| FR-041 | `powercut.mjs` (Tasmota, rơ-le, tay), chu trình 6 bước | T068, T073 | `tools/powercut/powercut.test.mjs` (thiết bị giả); chưa chạy với nguồn thật; bản Node `x64-run.mjs`/`x64-kill.mjs` đã chạy ở T077 | Đạt (công cụ) · Chờ người (T083, B4) |
| FR-042 | Đối chiếu `ACCEPTED` với `audit.db` sau cắt điện | T073, T077, T084 | `R:011-powercut-x64.json` (T077): 0 lệnh `ACCEPTED` thiếu audit trên 1.781 lệnh, 130/130 vòng; BL335 cần bộ điều khiển nguồn | Đạt (x64) · Chờ người (T084, B4) |
| FR-043 | Tiền kiểm x64 100 vòng `kill -9` | T074, T077 | `R:011-powercut-x64.json` (T077, bản Node của `x64-kill.ps1`): 130/130 vòng (100 ngẫu nhiên + D1, D3, D5 × 10), READY tối đa 12,1 s, `--check-data` 0 hỏng; D2 từ `update-it kill` 40/40, D4 từ `driver-it pulse-recovery` 20/20; D3 đạt một phần; Docker Linux arm64 | Đạt (x64; T077 chưa đóng vì D3 một phần, D2/D4 ngoài rig) |
| FR-044 | Báo cáo `011-load.md`, `011-soak.md`, `011-powercut.md` | T087 | Ba báo cáo có số x64 (T075, T077, T078, T147) và BL335 (T079, T122, T148, T063); còn L2 (T080), soak S0 (T076), kết luận cuối (T087) | Chưa đo — T076, T080, T087 |
| FR-045 | Ghi eMMC theo thành phần, tuổi thọ | T029, T082 | Bộ đếm theo thành phần (`core/diagnostics/daily_writes`); BL335 `historian.io.source` = `sqlite-vfs`; T013: chip eMMC `S0311D` (manfid `0xea`), `life_time` `0x01 0x01`, `pre_eol_info` `0x01` (bình thường); tuổi thọ tuyệt đối cần datasheet | Chờ người (T082, B5) |
| FR-046 | Kết luận từng chỉ tiêu ngân sách | T087, T201 | `R:011-load.md` §1 | Chưa đo — T087, T201 |

## US3: ký số và phát hành (FR-047 đến FR-056)

| FR | Nội dung | Task | Bằng chứng | Trạng thái |
|---|---|---|---|---|
| FR-047 | Ký Authenticode SHA-256 + dấu thời gian cho bộ cài, exe, trình gỡ | T010, T093, T104 | Chưa dựng bộ cài ký (cần Windows) | Chờ người (Windows; T093; chứng chỉ thật R1) |
| FR-048 | `sign.ps1` ba chế độ | T092 | `tools/release/sign.test.mjs` 7; chế độ `command` chạy thật với lệnh ký giả trên pwsh 7; `store`, `test` cần signtool | Chờ người (Windows; T092) |
| FR-049 | Cổng `-Release` từ chối 8 điều kiện | T088, T098 | `tools/release/gate.test.mjs` 8 (đỏ rồi xanh); `node --test tools/release` 42/42 | Đạt |
| FR-050 | Chứng chỉ thử `make-test-cert.ps1` | T009, T091 | Chưa có | Chờ người (Windows; T009, T091) |
| FR-051 | `verify-release.ps1` 12 ca hỏng | T088, T094 | `verify-release.test.mjs` 10; `R:011-release-dryrun.md`: ca 6–11 bị từ chối, ca 1–5 (Authenticode) và 12 bỏ qua ngoài Windows | Chờ người (Windows; T094) |
| FR-052 | Thư mục phát hành 9 mục, SBOM | T089, T095, T098, T102 | `sbom.test.mjs` 4/4 (CycloneDX 1.5, 836 thành phần); `release.ps1` 9 bước; T191: `release.ps1` chế độ thử bằng pwsh trên macOS tạo `release/1.0.0-rc.1/` (bước 4–9 đạt; bước 3 bộ cài Studio cần Windows) | Chờ người (Windows: bộ cài; T098, T102) |
| FR-053 | Khóa phát hành ngoại tuyến | T097, T103 | `tools/release/keygen.ps1`, `deployment/keys/README.md`; khóa thật chưa có | Chờ người (T103, R2) |
| FR-054, 055 | `signing.md`, `process.md`, `incident-keys.md` | T099 | `docs/release/{signing,process,incident-keys}.md` | Đạt |
| FR-056 | Studio hiện trạng thái chữ ký | T101 | Rust `signature.rs` 8 test; Vitest `signature.test.ts` 6/6; ngoài Windows báo "chưa ký (chỉ kiểm được trên Windows)" | Đạt (mã) · Chờ người (thử trên Windows, R3) |

## US4: OTA (FR-057 đến FR-072)

| FR | Nội dung | Task | Bằng chứng | Trạng thái |
|---|---|---|---|---|
| FR-057 | Gói `.matupdate` theo contract | T090, T106, T117 | ctest `envelope_test` 13, `signature_test` 8, CLI 5; `tools/release/make-update.mjs` (35 ca xấu), `make-update.test.mjs` 5/5 | Đạt |
| FR-058, 059, 060, 065 | OTA mặc định tắt, 5 endpoint, HTTPS + Bearer + administrator, giới hạn cỡ và slowloris | T107, T111, T112 | ctest `update_api_test` 15/15 (+3 ca U3); `R:011-update-x64.json` kịch bản `auth`, `bad` (31/31), `busy` | Đạt (lab Docker) |
| FR-061 | Thứ tự kiểm gói | T090, T096 | ctest `envelope_test`, `signature_test`, `UpdateManifest.*`; fuzz `update-envelope` 1 giờ 0 sự cố | Đạt |
| FR-062, 063 | Runtime chỉ kiểm sơ bộ; `mat-updater` atomic, kiểm lại ở root, quay về | T108, T114, T115 | `deployment/device/tests/updater_test.sh` 76/76 (40 ca kill S1–S8); `R:011-update-x64.json` `kill` 40/40, `health` quay về 89,3 s; sửa K1, U3, U4, U6–U8, N-OTA1–3; BL335 (T122): 10/10 OTA thật `committed`, quay về bằng tay đạt (`R:011-ota-bl335.json`) | Đạt (lab, BL335 T122) · cắt điện giữa bước Chờ người (T123; B4) |
| FR-064 | Không đụng dữ liệu, cấu hình, tài khoản | T114 | `updater_test.sh`; `update-x64` `ok` 20/20 | Đạt (lab) |
| FR-066 | Xoay khóa bằng `keyset`, `--trust-key`, `rollback` | T109, T113 | ctest `self_check_test` 6/6, `trust_key_cli_test` 5/5; `update-x64` `keyset`, `manual-rollback`; **O1** (rollback không cần chữ ký) chấp nhận là rủi ro còn lại, **O2** (một khóa gỡ được mọi khóa khác) hoãn sau pilot (quyết định 2026-10-17, ADR-035) | Đạt |
| FR-067 | Quy trình thủ công; `deploy.sh` kiểm `SHA256SUMS.sig` | T100, T121 | `deploy_rollback_test.sh` phần OTA; F1 (dùng verifier đã cài, `--expect-key-id`); `mat-runtime.md` 5i | Đạt |
| FR-068 | Luồng "Cập nhật runtime" ở Studio | T110, T119 | Rust 12/12; `update-flow` 27/27; `update-wizard` 14/14; e2e `ota` 19/19 (axe 0 lỗi nặng) | Đạt |
| FR-069 | `mat-update-verify` nhỏ, độc lập | T008, T096 | armhf strip 214.592 B (≤ 400 KB, chỉ phụ thuộc libc); BL335 Cortex-A7: ≈ 16 ms/lần kiểm gói 5 KiB (`device-changes.md` 2026-10-17) | Đạt |
| FR-070 | Ngừng ≤ 30 s (x64), toàn bộ ≤ 120 s | T120, T122 | `update-x64` `ok`: ngừng tối đa 9,6 s, toàn bộ ≤ 17,6 s · BL335 (T122): ngừng 13,2–15,9 s (trung bình 14,5 s), toàn bộ 21,1–24,0 s | Đạt |
| FR-071 | Phiên sau cập nhật, không nâng quyền | T116 | Phiên mất qua khởi động lại, Studio đăng nhập lại (nhánh dự phòng của FR-071) | Đạt |
| FR-072 | `updater/` trong gói → `UPDATER_MANUAL_ONLY` | T114 | `updater_test.sh` | Đạt |

## US5: logic v2 (FR-073 đến FR-096)

| FR | Nội dung | Task | Bằng chứng | Trạng thái |
|---|---|---|---|---|
| FR-073, 074, 075 | `logic.json`, dữ liệu khai báo, giới hạn | T017, T125, T135 | `schemas/logic.schema.json`; `ps/rules-logic.test.ts` 29 ca; ctest `rules_logic_test` 13; LG6 (dừng sau `E_LOGIC_LIMIT`) | Đạt |
| FR-076, 077 | Thứ tự tô-pô, ngữ nghĩa luật | T127, T133, T134, T136 | `le/rules.test.ts`; ctest luật 26 ca; 279 vector `tests/logic-vectors/` TS = C++ | Đạt |
| FR-078, 079, 080 | Hành động, `writes`, ghi qua `WriteCoordinator`, audit trước khi gửi | T129, T137 | ctest `logic_write_test` đỏ 11/11 rồi xanh 11/11 (driver giả); `R:011-logic-x64.json` `rules` 9/9 (giả lập Modbus: mỗi lệnh có dòng audit `logic.write` "started" trước khi tới giả lập) | Đạt (x64) |
| FR-081, 082 | Giới hạn tần suất; `logic.writes: off` | T129, T137 | ctest `logic_write_test`; LG2, LG7, LG9; `R:011-logic-x64.json` `throttle` 4/4 (40 cạnh ⇒ 5 lệnh), `writes-off` 3/3 (0 lệnh) | Đạt (x64) |
| FR-083 | `POST /logic/writes`, giữ qua khởi động lại, bật lại chỉ root | T130, T137, T138 | ctest `LogicApi`, `LogicRuntime` 12/12; `--logic-writes-reset` (đỏ 3 rồi xanh); LG4 | Đạt |
| FR-084 | Tag logic chỉ đọc `OWNED_BY_LOGIC` | T130, T136 | ctest `logic_api_test`, `tags_api_test` | Đạt |
| FR-085–089 | Timer, counter, totalizer, giờ chạy, lịch; `timeSynced` | T126, T133, T134, T140 | `le/{timers,counters,totalizer,runhours,schedule}.test.ts`; ctest 52 ca; `time_sync_test` 7/7 | Đạt |
| FR-090, 091 | Lưu trạng thái, nạp xuống giữ theo `id` | T131, T139 | ctest `logic_runtime_test`; `R:011-logic-x64.json` `retain-kill` 100 vòng `kill -9` (mất ≤ một `flushS`, 0 lần giảm, 0 ghi trùng cạnh), `retain-lost` 5/5, `deploy-keep` 3/3 | Đạt (x64) · BL335 cắt điện D5 Chờ người (T149) |
| FR-092 | Hai engine cùng ≥ 200 vector | T125, T134 | 279/279 khớp, x64 và armhf qemu, so số thực từng bit | Đạt |
| FR-093 | Validator mọi mã `E_LOGIC_*` | T128, T135 | `ps/rules-logic.test.ts`; ctest `rules_logic_test`; vector `v10-logic-*` | Đạt |
| FR-094 | Editor Logic theo mockup | T005, T007, T132, T143, T144 | 9 tệp Vitest 108/108; e2e `logic.e2e.mjs` 47/47 (axe 0); thử tay bộ gõ chưa làm | Đạt (tự động) · Chờ người (bộ gõ, H3) |
| FR-095 | Tải logic tối đa ≤ +3 điểm CPU, ≤ +5 MB, quét ≤ 5 ms | T147, T148 | x64 sau sửa arena glibc (T147): +1,43 điểm CPU, RSS +4,6 MB, quét p99 1,38 ms · BL335 rc.1 (T148, A/B/A/B dưới L1): quét trung vị 2,5 ms, p99 3,8 ms, RSS +3,9 MB đạt; **CPU +3,3 điểm một lõi** (+1,65 cả máy) vượt ngưỡng +3 (cách đọc một lõi); phương án `scanMs` 200–250 ms (`R:011-load.md` §3.2) | Không đạt — CPU BL335 vượt 0,3 điểm (T148) |
| FR-096 | Trạng thái logic Online, cảnh báo `logic.writes` | T132, T144, T145 | `deploy-preview.test.ts`, chip Ghi PLC; Rust `device/logic.rs` 6/6 | Đạt |

## US6: trình vẽ SVG (FR-097 đến FR-118)

| FR | Nội dung | Task | Bằng chứng | Trạng thái |
|---|---|---|---|---|
| FR-097 | Editor tab mới, cây "Đồ họa SVG", lệnh mở | T157, T162 | `st/ui/svg/svg-editor.test.ts` 17; e2e `svg-editor.e2e.mjs` 66/66 | Đạt |
| FR-098 | Lệnh đảo được, hoàn tác ≥ 100 | T153, T158 | `se/command.test.ts` 30 ca (1.000 chuỗi lệnh) | Đạt |
| FR-099 | Công cụ tạo | T157, T162, T163 | e2e `svg-editor`; task card "Công cụ vẽ" (`taskcards-context.test.ts` 7/7) | Đạt |
| FR-100 | Hình học với `transform` lồng | T152, T158 | `se/{matrix,transform,bbox,bake}.test.ts` (~146 ca) | Đạt |
| FR-101 | Chọn, tay nắm, nhập số | T157, T162 | `editor.test.ts` 31 ca; e2e | Đạt |
| FR-102 | Nhóm/bỏ nhóm đúng hình học | T152, T158 | `se/group.test.ts` | Đạt |
| FR-103, 104 | Bắt dính; căn chỉnh, phân bố, xếp lớp | T152, T159 | `se/{snap,align,order}.test.ts` (74 ca) | Đạt |
| FR-105 | Lớp `data-mat-layer`, panel Lớp | T163, T166 | `data-layer.test.ts` (đỏ 10 rồi xanh); vector `v10-svg-layer-valid`; e2e | Đạt |
| FR-106 | Inspector | T163 | e2e `svg-editor` | Đạt |
| FR-107 | Sửa nút `path` M/L/H/V/Z; khóa đường cong | T152, T159 | `se/polygon.test.ts` 32 ca | Đạt |
| FR-108 | Văn bản tại chỗ, bộ gõ tiếng Việt | T157, T163, T167 | e2e (bộ gõ giả qua CDP, ADR-016); Telex/Unikey thật chưa thử | Đạt (tự động) · Chờ người (T167, H4) |
| FR-109 | Sao chép/dán uid mới, lọc SVG dán | T155, T160 | `se/clipboard.test.ts` 22; dán > 5 MB bị từ chối trước phân tích | Đạt |
| FR-110 | Giữ uid và binding; xóa có binding cảnh báo | T153, T163 | `command.test.ts`; lô `ExternalCommand` | Đạt |
| FR-111 | Tuần tự hóa chuẩn tắc | T154, T158 | `se/serialize.test.ts` 29, `roundtrip.test.ts` 106 | Đạt |
| FR-112, 113 | Tự lưu 30 s; phát hiện đổi trên đĩa | T156, T161 | `st/model/svg-state.test.ts` 14/14; Rust `editor_fs.rs`, `file_fingerprint` (158 test) | Đạt |
| FR-114 | Hiệu năng editor | T164 | `R:011-svg-perf.json` (máy dev M2): mở 20.000 nút 486–507 ms; kéo trong 2.000: khoảng khung p95 16,8 ms (nhịp 60 Hz; xử lý 1,7 ms); chọn khung 7,7 ms; hoàn tác 7,4 ms | Đạt (máy dev; khoảng khung p95 vượt 0,1 ms do nhịp màn hình, xem SC-033) |
| FR-115 | Bàn phím, axe 0 | T157, T163, T167 | e2e axe 0 critical/serious hai theme; NVDA chưa thử | Đạt (tự động) · Chờ người (NVDA, H4) |
| FR-116 | Mockup `studio-svg-draw.html` duyệt trước | T006, T007 | Ghi chú T007 (duyệt 2026-10-16) | Đạt |
| FR-117 | ≥ 20 fixture SVG | T151 | `tests/svg-editor-fixtures/` 26 tệp + `malicious/` 10; 4 Inkscape thật, Illustrator và CorelDRAW **mô phỏng** | Đạt (ghi chú: fixture Illustrator/CorelDRAW mô phỏng) |
| FR-118 | Giới hạn có chủ đích nêu trong giao diện và tài liệu | T168 | `docs/user/engineer-guide.md` 7.3 | Đạt |

## US7: template và faceplate (FR-119 đến FR-127)

| FR | Nội dung | Task | Bằng chứng | Trạng thái |
|---|---|---|---|---|
| FR-119, 120, 121 | Template, bung khi lưu, "Cập nhật mọi bản sao" | T017, T169, T172 | `st/model/template-doc.test.ts` 20/20 | Đạt |
| FR-122 | Kiểu tham số | T021 | `ps/params.test.ts` 20/20; F8 (`__proto__`) | Đạt |
| FR-123, 124 | Faceplate `params`; validator bung tổ hợp `args` | T018–T020 | 88 vector `v10-*` TS 89/89, C++ `vectors_10_test` 94/94 | Đạt |
| FR-125 | Runtime thay `{param}` khi mở popup | T170, T174 | `uc/screen/popup-layer.test.ts` 15/15; e2e `faceplate.e2e.mjs` 23/23; `web-it -Scenario faceplate` 103/103 trên runtime x64 (`R:011-faceplate-x64.json`, 2026-10-18) | Đạt (x64) |
| FR-126 | Studio tạo template, thư viện, hộp `args` | T171, T173 | `template-dialogs.test.ts` 8, `args-dialog.test.ts` 5; e2e `template.e2e.mjs` 32/32 | Đạt |
| FR-127 | Mockup cảnh Template | T006, T007 | `studio-svg-draw.html` cảnh 3 | Đạt |

## US8: tài liệu, huấn luyện, hồ sơ pilot (FR-128 đến FR-135)

| FR | Nội dung | Task | Bằng chứng | Trạng thái |
|---|---|---|---|---|
| FR-128, 129 | Ba hướng dẫn, bảng tác vụ (≥ 12, 6, 10) | T179–T182, T203 | `docs/user/{engineer,operator,admin}-guide.md`, `glossary.md`, `error-codes.md`; T203 phần chữ xong (OTA §7.2, kiểm `SHA256SUMS`, cảnh báo thiết bị, logic); còn ảnh chụp Studio trên Windows | Chờ người (ảnh chụp Studio trên Windows, T203) |
| FR-130 | `docs-check` | T176, T177 | `tools/docs-check.test.mjs` 5/5; 258 tệp sạch; bước trong `ci-local.ps1` | Đạt |
| FR-131 | Giáo trình ba nhóm | T183 | `docs/training/{operator,engineer,admin}.md`; `projects/training-demo/` (validator TS và C++ hợp lệ) | Đạt |
| FR-132 | Hồ sơ pilot | T184 | `docs/pilot/` 7 tệp | Đạt |
| FR-133 | Nút "Trợ giúp", tài liệu HTML đi kèm | T178 | `tools/build-docs.test.mjs` 5/5; `help.test.ts` 25/25; Rust `open_help`; chưa thử neo `#` trên WebView2 | Đạt (mã) · Chờ người (Windows, R3) |
| FR-134 | `post-1.0-backlog.md` | T185 | `docs/plans/post-1.0-backlog.md` | Đạt |
| FR-135 | `011-acceptance.md`, `011-fr-matrix.md` | T204, T205 | Bảng này; `R:011-acceptance.md` là **bản nháp** (cập nhật 2026-10-18) | Không đạt — acceptance còn nháp (chờ T076, T080, T087, T198) |

## US9: pilot và phát hành (FR-136 đến FR-143)

| FR | Nội dung | Task | Bằng chứng | Trạng thái |
|---|---|---|---|---|
| FR-136 | Pilot ≥ 30 ngày, ≥ 1 site thật + bàn thử | T190, T192–T195 | `tools/pilot/bench-setup.ps1`, `docs/pilot/plan.md` | Chờ người (K1–K6, P1, P2) |
| FR-137 | `collect.ps1` | T189 | `tools/pilot/collect.test.mjs` 5/5; F2 (ghim TLS mọi kết nối); còn mở: audit chỉ cho administrator mà collector dùng viewer (ghi `FORBIDDEN`); chưa thử PowerShell 5.1 | Đạt (công cụ, có hạn chế) · Chờ người (Windows) |
| FR-138 | `kpi.mjs` | T187, T188 | `tools/pilot/kpi.test.mjs` 16/16 trên 6 kịch bản `tests/pilot-kpi/` | Đạt |
| FR-139 | Tiêu chí ra X1–X11 | T195–T197 | `docs/pilot/criteria.md` | Chờ người (pilot) |
| FR-140 | Tiêu chí vào E1–E9 | T193 | `docs/pilot/criteria.md` | Chờ người (T193, P4) |
| FR-141 | Quy trình sự cố | T184, T195 | `docs/pilot/incident-log.md` (mẫu, mức, thời hạn) | Đạt (quy trình) · Chờ người (áp dụng trong pilot) |
| FR-142 | Go/No-Go có chữ ký | T198 | chưa có `011-go-no-go.md` | Chờ người (T198, P4) |
| FR-143 | Danh sách chờ người một chỗ | T184, T205 | `docs/pilot/customer-checklist.md` (K1–K9, B1–B9, R1–R3, H1–H4, P1–P4); mục "Việc chờ người" của `R:011-acceptance.md` | Đạt |

## Tiêu chí thành công

| SC | Tiêu chí (rút gọn) | Task | Số đo hoặc bằng chứng | Trạng thái |
|---|---|---|---|---|
| SC-001 | 100 % Medium 005–007 có trạng thái trong bảng truy vết | T065 | `plan.md` "Phát hiện tồn"; P-01, P-12 đã đo trên BL335 (T063, T079 L8); P-03 chờ người áp dụng (được phép theo SC) | Đạt |
| SC-002 | ≥ 16 ca `Host`, rebinding qua Chrome | T032, T053 | 22/22; `R:011-host-x64.json` 16/16; BL335 421/200 đúng | Đạt |
| SC-003 | ≥ 14 ca khóa; IP B ≤ 2 s | T033, T034, T053 | 19 + 33 ca; `R:011-lockout-x64.json` (IP B chậm nhất 19 ms) | Đạt (x64) |
| SC-004 | Xung `kill -9` 20/20, nhật ký hỏng 20/20 | T054 | `R:011-pulse-x64.json` | Đạt (x64) |
| SC-005 | Gateway 1.000 chu kỳ, unit khỏe 100 % GOOD | T054 | `R:011-gateway-x64.json` | Đạt (x64) |
| SC-006 | ≥ 10 vector tệp thừa, 30 lần nạp không `HEALTH_TIMEOUT` | T022, T054 | 13 vector; `R:011-extra-file-x64.json` | Đạt |
| SC-007 | fsync 500 ms ⇒ p99 ≤ 50 ms; ENOSPC ⇒ `PERSIST_FAILED` | T038, T054 | p99 6 ms (`R:011-persist-x64.json`) | Đạt (x64) |
| SC-008 | 40 TLS im lặng, đăng nhập IP khác ≤ 2 s; RAM | T039, T063 | x64: 60 TLS, nguồn khác 25 ms · BL335 rc.1 (T063): 40 TLS im lặng, 43/43 đăng nhập từ địa chỉ khác, chậm nhất 837 ms; RSS 9,5 → 8,2 MB (không tăng bền); T079 L8: tệ nhất 1.198 ms, RSS +0,3–0,7 MB (`R:011-security-bl335.json`, `R:011-load-bl335.json`) | Đạt |
| SC-009 | audit, license, SAST sạch; fuzz ≥ 1 giờ × 7 mục tiêu | T055–T058 | audit, license, SAST đạt (`ci-local` rc.1: SAST PASS); fuzz TS mọi mục tiêu ≥ 1 giờ, 0 sự cố; C++ ASan + UBSan: `update-envelope`, gói `.matscada`, `logic-json` ≥ 1 giờ; project-json, expression, modbus mỗi mục 30 phút (0 sự cố) | Chưa đo — ba mục tiêu C++ chưa đủ 1 giờ (T058) |
| SC-010 | 0 Critical/High mở; Medium mở chỉ chờ người; 30 ca tấn công 007 | T062, T202 | `R:011-security-review.md`: lần 1 (T062) và lần 2 (T202) 0 Critical/High mở; O1 chấp nhận, O2 hoãn sau pilot (quyết định 2026-10-17); `web-it attack` trong `ci-local` đầy đủ xanh (2026-10-17 và trên rc.1 2026-10-18) | Đạt |
| SC-011 | BL335 500 Tag × 10 client × 4 giờ; client 11; F5 50 vòng | T075, T079 | BL335 1.0.0 (T079): L1 4 giờ, CPU 28,9 % một lõi (14,5 % cả máy), đỉnh 50,4 % một lõi, RSS ≤ 19,5 MB, 0 mất sequence; client 11 4429 50/50; F5 10 trang × 50 vòng màn 250 item tối đa 935 ms (`R:011-load-bl335.json`); T079 chưa đóng vì `mat-sample` chưa cài, 8443 xen kẽ, RSS tab | Đạt (BL335) |
| SC-012 | BL335 1.000 Tag × 10 client × 1 giờ | T080 | — | Chưa đo — T080 |
| SC-013 | Soak 7 ngày BL335 | T076, T081 | Không chạy 7 ngày trên BL335 ở GĐ 6 (quyết định người dùng 2026-10-18; T081); thay bằng soak x64 24 giờ (T076, đang chạy), L1 4 giờ BL335 (T079), soak 30 ngày bàn thử khi pilot (T196); lưu ý: ghi khối toàn máy nền 2,6–4,7 GB/ngày khi mat tắt (`R:011-soak.md` §4) | Chưa đo — hoãn theo quyết định người dùng |
| SC-014 | Mất điện 100 vòng + 5 điểm × 10 | T077, T083–T085 | x64 (T077): 130/130 vòng `kill -9` (100 ngẫu nhiên + D1, D3, D5 × 10), 0 lệnh ACCEPTED thiếu audit; D2 40/40, D4 20/20 ở lab; BL335 cần bộ điều khiển nguồn | Chờ người (bộ điều khiển nguồn B4) |
| SC-015 | Cắt mạng 50 lần, nối lại ≤ 35 s | T078, T086 | x64 (T078): 500/500 nối lại, 0 lần > 35 s (tối đa 8,7 s), 0 slot rò (`R:011-flap-x64.json`) · BL335 cần người cắt mạng | Đạt (x64) · Chờ người BL335 (T086, B7) |
| SC-016 | Tuổi thọ eMMC ≥ 5 năm hoặc "chưa tính được" | T082 | T013: sysfs `life_time` `0x01 0x01`, `pre_eol_info` `0x01` (chip `S0311D`); tuổi thọ tuyệt đối cần datasheet | Chờ người (datasheet B5) |
| SC-017 | Ký thử 3 tệp, 12/12 ca hỏng, cổng `-Release` | T088, T093, T094 | cổng 8/8 đạt; ca hỏng 6–11 đạt; Authenticode chưa chạy | Chờ người (Windows) |
| SC-018 | `release.ps1` đủ 9 mục ≤ 30 phút; SBOM 100 % | T095, T098, T102 | SBOM 836 thành phần đạt; dry-run ngoài Windows 4,3 s; T191: `release.ps1` chế độ thử bằng pwsh trên macOS tạo `release/1.0.0-rc.1/` (bước 4–9 đạt, bước 3 cần Windows) | Chờ người (Windows) |
| SC-019 | Chứng chỉ thật trên Windows 10/11 sạch | T103–T105 | — | Chờ người (R1, R3) |
| SC-020 | OTA 20/20, ngừng ≤ 30 s, toàn bộ ≤ 120 s; ≥ 25 gói xấu | T120 | `R:011-update-x64.json`: 20/20, ngừng ≤ 9,6 s, toàn bộ ≤ 17,6 s; 31/31 gói xấu (Docker arm64, `systemctl` giả) | Đạt (lab) |
| SC-021 | 40 lần kill giữa 8 bước; sức khỏe lỗi quay về ≤ 90 s | T108, T120 | `kill` 40/40 (30 về bản cũ, 10 lên bản mới); quay về 89,3 s | Đạt (lab) |
| SC-022 | OTA bảo mật 100 % | T107, T120 | ctest `update_api_test`; `update-x64` `auth`, `downgrade` | Đạt |
| SC-023 | BL335 10 OTA thật, 5 lần cắt giữa bước | T122, T123 | BL335 (T122): 10/10 OTA thật `committed`, ngừng 13,2–15,9 s, toàn bộ 21,1–24,0 s, quay về bằng tay đạt (`R:011-ota-bl335.json`); 5 lần cắt điện giữa bước chưa làm (T123) | Đạt (10 OTA thật) · Chờ người (cắt điện T123, B4) |
| SC-024 | ≥ 200 vector logic TS = C++ | T125, T134 | 279/279 | Đạt |
| SC-025 | Độ chính xác timer, totalizer, counter, giờ chạy | T126 | Vitest + ctest 52 ca | Đạt |
| SC-026 | 100 vòng `kill -9` logic retain | T131, T146 | `R:011-logic-x64.json` `retain-kill` 100 vòng `kill -9`: mất tối đa count 6, total 0,95, giờ chạy 0,0027 (≤ một `flushS` 10 s), 0 lần giảm, 0 ghi trùng cạnh; `retain-lost` 5/5 (về 0, cảnh báo, audit một lần) | Đạt (x64) |
| SC-027 | Ghi từ logic: audit trước khi gửi, kiểm bằng giả lập Modbus | T129, T146 | `R:011-logic-x64.json` (giả lập Modbus): `rules` 9/9 (audit đủ trường trước khi gửi), `writes-off` 0 lệnh, `throttle` 35/35 cạnh thừa bị chặn; validator TS và C++ từ chối ghi Tag không khai báo (vector `v10-logic-*`) | Đạt (x64) |
| SC-028 | Tải logic BL335 | T147, T148 | x64 (T147): +1,43 điểm CPU, +4,6 MB, quét p99 1,38 ms · BL335 rc.1 (T148): quét trung vị 2,5 ms, p99 3,8 ms, RSS +3,9 MB đạt; **CPU +3,3 điểm một lõi** (ngưỡng +3) | Không đạt — CPU BL335 vượt 0,3 điểm (T148) |
| SC-029 | Kỹ sư dựng luật bơm ≤ 25 phút | T150 | — | Chờ người (H3) |
| SC-030 | Round-trip ≥ 20 fixture, ảnh ≤ 1 % | T154 | 26 fixture; e2e `svg-render-diff` 76 phép so khác 0 % | Đạt |
| SC-031 | ≥ 150 ca hình học | T152 | ~270 ca | Đạt |
| SC-032 | 1.000 chuỗi hoàn tác/làm lại | T153 | `command.test.ts` | Đạt |
| SC-033 | Kéo p95 ≤ 16,7 ms, mở 20.000 ≤ 3 s, chọn khung ≤ 50 ms | T164 | `R:011-svg-perf.json`: khoảng khung p95 16,8 ms (trung bình 16,7 = nhịp 60 Hz, xử lý p95 1,7 ms), mở 486 ms, chọn 7,7–28,9 ms | Đạt (máy dev; 16,8 ms là giới hạn nhịp màn hình, không phải xử lý) |
| SC-034 | Fuzz 100.000 chuỗi, 10 SVG độc, lint | T014, T155 | `se/fuzz.test.ts` 100.000, clipboard 10 ca độc, lint 22/22 | Đạt |
| SC-035 | Kill Studio 20 lần, ≥ 95 % khôi phục; thử tay | T156, T167 | `svg-state.test.ts` (kill giả lập); chưa kill Studio thật 20 lần | Chưa đo (kill thật) · Chờ người (bộ gõ, NVDA) |
| SC-036 | Ký hiệu "bơm" ≤ 20 phút | T167 | — | Chờ người (H4) |
| SC-037 | Template 20/20; faceplate 20 bơm; ≥ 30 vector; diff máy chủ trống | T169–T175 | 20/20; 88 vector; `web-it faceplate` 103/103 trên runtime x64 (`R:011-faceplate-x64.json`, 2026-10-18); không đổi `server/http/`, `core/project-store/` cho template | Đạt (x64) |
| SC-038 | `docs-check` 0 lỗi; người thử ≥ 90 % | T177, T186 | 0 lỗi | Đạt (docs-check) · Chờ người (H1) |
| SC-039 | Huấn luyện ≥ 2 vận hành, ≥ 1 kỹ sư | T186, T197 | — | Chờ người (H2, K5) |
| SC-040 | Pilot ≥ 30 ngày, X1–X11 | T195, T196 | — | Chờ người (pilot) |
| SC-041 | Biên bản ký; `kpi.mjs` khớp mẫu | T187, T188, T197 | `kpi.mjs` 16/16 khớp 6 kịch bản | Đạt (kpi) · Chờ người (biên bản, K9) |
| SC-042 | `ci-local` xanh với bước mới; so cặp 0.6/1.0 | T059, T200 | `ci-local` đầy đủ xanh trên rc.1 với bước mới (SAST, audit, docs-check, `update-it`, `logic-it`); ctest ASan + UBSan chạy riêng (T059); chưa có lượt `ci-local -Sanitize` và so cặp 0.6/1.0 (T200) | Chưa đo — T059 (ASan qua `ci-local`), T200 |
| SC-043 | Go/No-Go đủ bằng chứng | T198 | — | Chờ người (T198) |

## Tổng hợp

| Nhóm | Đạt trọn | Không đạt | Chưa đo | Chờ người |
|---|---|---|---|---|
| FR (143) | 101 | 4 (FR-005, 038, 095, 135) | 8 | 30 |
| SC (43) | 23 | 1 (SC-028) | 5 | 14 |

Cách đếm: mỗi FR/SC tính một lần theo phần yếu nhất của dòng, thứ tự Không đạt, Chưa đo, Chờ người, Đạt (dòng "Đạt (x64) · Chưa đo BL335" tính là Chưa đo); dòng gộp (ví dụ FR-014, 015, 016) tính đủ số FR.

**Số đo vượt ngưỡng:** một mục, CPU thêm của logic tối đa trên BL335 (T148, rc.1): +3,3 điểm một lõi so với ngưỡng +3 (vòng quét 2,5 ms và RSS +3,9 MB đạt). Kéo theo FR-005, FR-095, SC-028. Phương án ở `R:011-load.md` §3.2. Các mục Không đạt khác là việc chưa xong: FR-038 (`load-tester` thiếu phần L3 nối lại), FR-135 (nghiệm thu còn nháp).

So với lần đếm 2026-10-17 (FR 89/5/22/27, SC 17/0/13/13): chuyển Đạt nhờ T063 (SC-008, FR-025), T079 (SC-011), T122 (FR-070, phần OTA thật của SC-023), T146 (SC-026, SC-027, FR-078–082, FR-090, 091), T202 và quyết định O1/O2 (SC-010, FR-032, FR-066), T175 trên runtime x64 (SC-037, FR-125), T013 (FR-009); FR-128, 129 sang Chờ người (chỉ còn ảnh chụp trên Windows); FR-030, FR-003 từ Không đạt/Chưa đo sang Chưa đo chờ lượt `ci-local -Sanitize` (T059) và T200. SC-013 ghi "Chưa đo — hoãn theo quyết định người dùng" (T081 không chạy ở GĐ 6). Đếm lại khi T076, T080, T059, T198 xong.
