# Bảng đối chiếu FR và SC của feature 009 (T123, SC-022)

Ngày lập: 2026-10-15. Nguồn: `specs/009-alarms/{spec.md, tasks.md}`, `docs/reports/009-*.json|md`, mã và test trong repo (đã kiểm file có thật bằng `ls`; chưa chạy lại test trong lượt lập bảng này, số liệu lấy từ ghi chú task và báo cáo).

Trạng thái: **Đạt x64** (có test hoặc kịch bản tự động xanh theo ghi chú task); **Chờ BL335** (cần SSH, T127 đến T133; SSH đang tắt, chưa đo); **Chờ người** (thử tay, cắt điện, Excel, NVDA: T133, T134, T135); **Một phần** (ghi rõ phần thiếu); **Chưa làm**.

## Hạn chế chung (đọc trước)

1. **Chưa có e2e Studio cho alarm.** `apps/studio/tests/e2e/` không có `alarm-*.e2e.mjs`. Chưa xong: T072 (`alarm-editor.e2e.mjs`), T086 (`alarm-perf.e2e.mjs`), T087 (`009-sc016.md`), T103 phía Studio (`alarm-widgets.e2e.mjs`), T110, T088; T082 (cột trạng thái sống Online) chưa làm. Phần Studio chỉ có test đơn vị Vitest (model và logic editor), không có axe, không đo thời gian mở bảng hay lưới 2.000 dòng.
2. **Runtime x64 của các kịch bản `alarm-it` (T039, T040, T065, T099, T111 đến T116) được đo trên bản sao nguồn chỉ đổi `kRuntimeVersion` 0.8.0 và `kDeviceApiVersion` 1.3.0** (ghi chú T039). Nay `core/project-manager/project_validator.hpp` đã có `kRuntimeVersion = "0.8.0"` và `server/device_state.hpp` có `kDeviceApiVersion = "1.3.0"`, nhưng T125 chưa đánh [X] (đóng gói, `deploy_rollback_test.sh`, CMake, `tauri.conf.json`) và các kịch bản chưa chạy lại trên bản build của cây hiện tại. Số đo x64 là THAM KHẢO.
3. **BL335 chưa đo** (T008, T127 đến T133 chưa làm; SSH tắt). Mọi ngưỡng ghi "BL335" là chưa đo.
4. **Tick lớn nhất vượt ngưỡng ước tính.** `docs/reports/009-tick-x64.json` (500 instance, x64 container): trung bình 8,8 µs lúc yên, 146 µs đi ngẫu nhiên, 122 µs bão; **lớn nhất 3,04 ms (đi ngẫu nhiên) và 3,15 ms (bão), p99 bão 1,53 ms**, so với ngưỡng ước tính 2 ms của FR-021 (BL335). Chưa kết luận đạt; đã ghi ở ADR-027. Đo BL335 ở T129; nếu vượt thì đổi sang đánh giá theo thay đổi (dự phòng ghi ở tasks.md).
5. `./tools/ci-local.ps1` chưa chạy trọn; các Checkpoint T042, T066, T088, T118 và T126, T136 chưa xong. T008, T121, T125 chưa xong.
6. Không có số đo từ runtime 0.6 và 0.7 để so cạnh nhau (T113 so với hợp đồng cũ).

Viết tắt: `eng` = `core/alarm/tests`; `rw` = `apps/runtime-web`; `uc` = `packages/ui-components/src/alarm`; `ae` = `packages/alarm-engine/src`; `st` = `apps/studio/src`; `R:` = `docs/reports/009-<tên>-x64.json`; `vec` = `tests/alarm-vectors/`; `pv` = `tests/project-vectors/v05-*`.

## Định dạng, nâng cấp, kiểm tra (FR-001 đến FR-014)

| FR | Bằng chứng | Trạng thái |
|---|---|---|
| FR-001 đến FR-008 | `pv` (165 ca, T011) chạy ở TS (`packages/project-schema`, 1931 test) và C++ (`core/project-manager/tests/{project_validator_test,alarm_rules_test}.cpp`); `schemas/alarms.schema.json`, `schemas/alarm-classes.schema.json`; `eng/alarm_defs_test.cpp` | Đạt x64 |
| FR-009 | vector biên giới hạn trong `pv` (500 instance, 16 lớp, 64 khu vực) | Đạt x64 |
| FR-010 | ca vector `onDelayMs`/`offDelayMs` trong `pv` | Đạt x64 |
| FR-011 | hai validator cùng mã, cùng vị trí trên `pv`; widget: 3 ca `v05-*-widget-alarm-*` (T104) | Đạt x64 |
| FR-012 | `tests/migration-vectors/0.4-to-0.5/` (15 cặp); `migrate04to05` ở `packages/project-schema/src/migrate.ts`; `st/model/project-doc.test.ts` (hộp thoại nâng cấp) | Một phần: không có e2e Studio của hộp thoại nâng cấp 0.4 sang 0.5 (T072) |
| FR-013 | `st/model/project-doc.test.ts` (khóa Nạp xuống khi còn `E_ALARM_*`) | Một phần: chỉ test đơn vị, chưa e2e `download` với alarm |
| FR-014 | runtime nhận 0.1 đến 0.5, từ chối 0.6: `project_validator_test`; `R:compat` (36 kiểm, project 0.1 đến 0.4 chạy); khóa Nạp xuống theo `< 0.8.0`: `project-doc.test.ts` | Đạt x64 (hạn chế 2) |

## Động cơ (FR-015 đến FR-026)

| FR | Bằng chứng | Trạng thái |
|---|---|---|
| FR-015 | `core/alarm/` thuần, `eng/alarm_engine_test.cpp` (58), `alarm_state_table_test.cpp`; armhf qemu 7 file xanh (ghi chú T037) | Đạt x64; armhf qemu xanh |
| FR-016 | `eng/alarm_engine_vectors_test.cpp` (100) và `ae/{engine,vectors}.test.ts` (198 test) cùng `vec` (99 ca) | Đạt x64 |
| FR-017, 018, 019, 020 | `eng/alarm_engine_test.cpp`; `vec` nhóm `limit-*`, `digital-*`, `quality-*`; `R:quality` (9 kiểm) | Đạt x64 |
| FR-021 | `eng/alarm_perf_test.cpp`, `R:tick`: trung bình 8,8 µs, **lớn nhất 3,04 đến 3,15 ms > 2 ms**; không cấp phát đường nóng: `alarm_engine_test` (đếm `operator new`, 0) | Một phần: không cấp phát đạt; ngưỡng 2 ms chưa đạt trên x64 ở giá trị lớn nhất, BL335 chưa đo (T129) |
| FR-022 | `vec` nhóm `restart-*`; `R:restart` (14 kiểm); `server/tests/alarm_recovery_test.cpp` | Đạt x64 (hạn chế 2) |
| FR-023 | `vec` nhóm `config-*`; `eng/alarm_defs_test.cpp` (dấu vân tay); `alarm_glue` đối chiếu khi kích hoạt (T038) | Đạt x64 |
| FR-024 | `eng/alarm_store_test.cpp` (`clock_ok`, mã tăng qua khởi động lại) | Đạt x64; chưa kiểm đồng hồ BL335 (T008) |
| FR-025 | `eng/alarm_text_test.cpp` (`fold.json` 50, `fold-table.json`, `round-table.json` 1.006); `ae/text.test.ts`; `vec` nhóm `text-*` | Đạt x64 |
| FR-026 | `eng/alarm_service_test.cpp` (push < 5 ms khi writer ngủ 500 ms) | Đạt x64 |

## Trạng thái, xác nhận, tạm ẩn, vô hiệu (FR-027 đến FR-036)

| FR | Bằng chứng | Trạng thái |
|---|---|---|
| FR-027 | `eng/alarm_state_table_test.cpp` (40 ô x 3 tổ hợp, 10 ô không thể tới) | Đạt x64 |
| FR-028 | `server/http/tests/alarms_api_test.cpp` (22); `R:auth` (22 kiểm) | Đạt x64 |
| FR-029 | `alarms_api_test.cpp` (audit giả lỗi, 503 `AUDIT_UNAVAILABLE`); `server/tests/alarm_recovery_test.cpp`; `R:auth` (`ts` audit <= `tsAck`); `R:killloop` (100/100 không ack thiếu audit) | Đạt x64 |
| FR-030 | `alarms_api_test.cpp`; `R:killloop` (hàng `ts_ack_ms` trong `alarm.db`) | Đạt x64 |
| FR-031 | `alarm_engine_test.cpp`, `alarms_api_test.cpp` (`SHELVE_RANGE`, unshelve, hết hạn đồng hồ đơn điệu) | Đạt x64 |
| FR-032 | `alarms_api_test.cpp` (disable, enable); `R:auth` (cookie 403 `SESSION_SCOPE`) | Đạt x64 |
| FR-033 | `alarm_store_test.cpp` (`alarm_override` bền); `R:restart`: disable sống qua khởi động lại; **shelve không sống trên x64 Docker vì `clockOk=false`** (đúng FR-033, ghi nhận) | Một phần: shelve bền khi `clockOk=true` chưa chứng minh bằng tích hợp (chỉ test đơn vị); BL335 chưa đo |
| FR-034 | `alarm_engine_test.cpp` (giới hạn 50, `SHELVE_RANGE`) | Đạt x64 |
| FR-035 | `alarm_engine_test.cpp`; `eng/alarm_storm_test.cpp`; `R:storm` (5 hàng = `chatterLimit`, dòng tổng kết) | Đạt x64 |
| FR-036 | `alarm_engine_test.cpp`, `vec` (cờ `startup`, `inputBad`, `closedBy`) | Đạt x64 |

## Lưu trữ (FR-037 đến FR-044)

| FR | Bằng chứng | Trạng thái |
|---|---|---|
| FR-037 | `eng/alarm_store_test.cpp` (PRAGMA, không `FULL`, quyền 0600) | Đạt x64 |
| FR-038 | `alarm_store_test.cpp` (chèn, cập nhật, dựng lại lần xảy ra mở) | Đạt x64 |
| FR-039 | `eng/alarm_service_test.cpp` (cửa sổ thích ứng, bộ đệm 5.000, `droppedChanges`) | Đạt x64 |
| FR-040 | `alarm_store_test.cpp`, `alarm_service_test.cpp` (xóa chỉ lần đã đóng, mẻ <= 1.000, không khi `clockOk` sai, trần dung lượng) | Đạt x64 |
| FR-041 | `server/tests/{alarm_recovery_test,alarm_db_check_test}.cpp`; `R:killloop` (100/100 `integrity_check` ok) | Đạt x64; BL335 chưa (T132) |
| FR-042 | spike T006 (x64 Docker, ADR-028 "Số đo"): chuẩn 21,2 MB/ngày, bão 77,3 MB/ngày với cửa sổ 2 đến 60 s (trần 30 s cũ cho 122 MB, không đạt nên đổi lên 60 s); `R:budget`: `alarm.db`+WAL tăng 2,96 MB/10 phút với ~150 alarm đang bật (không phải tải chuẩn của FR-042) | Chờ BL335 (T130); `/proc/<pid>/io` bị chặn trong container |
| FR-043 | `alarm_service_test.cpp`, `server/tests/alarm_recovery_test.cpp` (đĩa gần đầy, `paused`, tiếp tục) | Đạt x64 |
| FR-044 | `eng/alarm_history_test.cpp` (14; kế hoạch dùng chỉ mục ở `alarm_store_test`); `R:history` | Đạt x64 |

## Live, API, lịch sử (FR-045 đến FR-054)

| FR | Bằng chứng | Trạng thái |
|---|---|---|
| FR-045, 046, 047 | `server/websocket/tests/live_hub_alarm_test.cpp` (19); `packages/live-client/src/alarms.test.ts` (30); `R:storm` (0 phiên 4409, 0 hở sequence) | Đạt x64 |
| FR-048 | `live_hub_alarm_test.cpp` (`ack` trên live: `BAD_MESSAGE`, audit `LIVE_ACK_NOT_ALLOWED`) | Đạt x64. Rà soát M1: `ackUser`, `shelved.*` lộ cho nguồn chưa đăng nhập, hoãn (`docs/reports/009-security-review.md`) |
| FR-049 | `live_hub_alarm_test.cpp`; `R:compat` | Đạt x64 |
| FR-050 | `alarms_api_test.cpp`, `server/http/tests/alarms_history_api_test.cpp` | Đạt x64 |
| FR-051 | `core/auth/tests/roles_alarm_test.cpp` (4; bảng 30 dòng); `R:auth` | Đạt x64 |
| FR-052 | `live_hub_alarm_test.cpp`; `R:storm` (đánh giá lớn nhất 0,78 ms, không tăng khi bão) | Đạt x64 |
| FR-053, FR-054 | `eng/alarm_history_test.cpp` (tham số ràng buộc, thoát `%_\`, chuỗi SQL); `alarms_history_api_test.cpp` (8); `R:history` | Đạt x64 |

## Trang vận hành (FR-055 đến FR-067)

| FR | Bằng chứng | Trạng thái |
|---|---|---|
| FR-055, 057, 058 | `rw/src/alarm/{banner,badge}.test.ts` (37); `rw/tests/e2e/alarm-live.e2e.mjs` (55 kiểm tra, axe sáng và tối 0 vi phạm); `uc/alarm-tokens.test.ts` (50, tương phản tám màu hai theme) | Đạt x64 (Chrome headless) |
| FR-056 | `rw/src/alarm/alarm-page.test.ts` (22); `alarm-live.e2e.mjs` | Đạt x64 |
| FR-059 | `rw/src/alarm/sound.test.ts` (24, `AudioContext` giả); `alarm-live.e2e.mjs` (giả) | Một phần: chưa nghe thử trên Chrome thật (T134, chờ người) |
| FR-060 | `rw/src/alarm/history-page.test.ts` (22); `rw/tests/e2e/alarm-history.e2e.mjs` (30 kiểm tra, axe) | Đạt x64 |
| FR-061 | `rw/src/alarm/csv.test.ts` (21; 33 chuỗi nguy hiểm); `alarm-history.e2e.mjs` (đọc nội dung Blob, 5.001 dòng) | Đạt x64; mở bằng Excel chờ người (T134) |
| FR-062 | lint `innerHTML` của 007 áp cho `rw/src/**`, `uc/**` (T005, `tools/lint-rules-alarm.test.mjs`); test XSS `alarm-table.test.ts`, `alarm-page.test.ts` | Đạt x64 |
| FR-063 | `alarm-client.test.ts` (19); `alarms.test.ts` (live-client); `alarm-live.e2e.mjs` (mất kết nối, 1.2.0); `R:compat` | Đạt x64 |
| FR-064 | `rw/src/action-host.test.ts` (alarm, 9 test đỏ rồi xanh); `alarm-page.test.ts`, `banner.test.ts` (khóa kèm lý do) | Đạt x64 |
| FR-065 | `alarm-page.test.ts` (`AUDIT_UNAVAILABLE`, `STALE`, `SHELVE_RANGE`); `alarm-live.e2e.mjs` | Đạt x64 |
| FR-066 | `uc/alarm-table.test.ts` (dựng một lần, 200 hàng); `alarm-live.e2e.mjs` (đổi alarm tới DOM đổi 14 đến 29 ms) | Đạt x64 |
| FR-067 | lint chuỗi cứng (T005, `tools/lint-rules-alarm.test.mjs`, 8 test); `rw/src/i18n/vi.ts`, `packages/ui-components/src/i18n/alarm-vi.ts` | Đạt x64 |

## Widget (FR-068 đến FR-072)

| FR | Bằng chứng | Trạng thái |
|---|---|---|
| FR-068 | `schemas/widgets.catalog.json` 0.4.0 (17 widget); `tests/widget-catalog-vectors/` (156 ca, TS và C++ `widget_catalog_test`); `tools/gen-widget-docs.test.mjs`; Toolbox, inspector Studio (T106, `st/model/tree.test.ts`) | Một phần: Toolbox và inspector chưa có e2e Studio (T103 phía Studio) |
| FR-069, 070 | `uc/mat-alarm-widgets.test.ts`; `rw/tests/e2e/alarm-widgets.e2e.mjs` (19 kiểm tra, `alarm-count` cập nhật 84 ms) | Đạt x64 |
| FR-071 | `mat-alarm-widgets.test.ts`; `alarm-widgets.e2e.mjs` (project không alarm) | Đạt x64 |
| FR-072 | `mat-alarm-widgets.test.ts` (XSS, không `innerHTML`); axe sáng và tối ở `alarm-widgets.e2e.mjs` | Đạt x64 |

## Studio (FR-073 đến FR-087)

Chỉ có test đơn vị Vitest (`st/model/alarm-{doc,grid,live,preview,refs,sim,text}.test.ts`, `st/ui/editors/alarm-{dialogs,grid,test-panel}.test.ts`, `tree.test.ts`, `project-doc.test.ts`); **không có e2e Studio của alarm**.

| FR | Bằng chứng | Trạng thái |
|---|---|---|
| FR-073 | `st/model/tree.test.ts` (mở khóa) | Một phần: không có e2e |
| FR-074 | `alarm-grid.test.ts` (model và editor), `alarm-doc.test.ts`; **cột trạng thái sống Online (T082) chưa làm**; lưới chưa đo 200 hay 2.000 dòng (T086) | Một phần |
| FR-075 | `alarm-doc.test.ts` (`quickCreate`), `alarm-dialogs.test.ts` | Một phần: không e2e |
| FR-076 | `alarm-dialogs.test.ts`, `alarm-doc.test.ts` (lớp, xem trước) | Một phần: không e2e |
| FR-077 | `alarm-refs.test.ts`, `alarm-doc.test.ts` (khu vực, nơi dùng) | Một phần: không e2e |
| FR-078 | `alarm-grid.test.ts` (lỗi theo ô); chưa đo "sửa ô tới lỗi <= 500 ms" | Một phần |
| FR-079 | `alarm-text.test.ts`, `alarm-dialogs.test.ts`, `ae/text.test.ts` | Một phần: bộ gõ Telex, Unikey chưa thử (T134) |
| FR-080 | `st/model/alarm-sim.test.ts` (17, chạy chung `vec`), `alarm-test-panel.test.ts` | Đạt x64 (đơn vị); panel chưa qua e2e |
| FR-081 | `alarm-preview.test.ts`, `alarm-live.test.ts`; chế độ Thiết bị chưa có chuyển tiếp `alarmSnapshot` kiểm chứng (T082) | Một phần |
| FR-082 | `alarm-refs.test.ts` (đổi tên, xóa Tag, Dùng ở đâu; T083, mã thực tế không đặt tên `tag-rename.ts`/`usage.ts`) | Đạt x64 (đơn vị) |
| FR-083 | `project-doc.test.ts` (So sánh theo đối tượng) | Một phần: không e2e `compare` với alarm |
| FR-084 | `alarm-doc.test.ts` (định dạng ghi ổn định) | Đạt x64 |
| FR-085 | `project-doc.test.ts`, `tree.test.ts` (số lỗi trên nhãn cây) | Một phần: không e2e |
| FR-086 | mockup `docs/architecture/mockups/studio-alarms.html` duyệt 2026-10-13 (T004); `docs/reports/009-sc016.md` **chưa viết** (T087); lệch ghi ở T076: không có cửa sổ "Lớp theo ngưỡng" riêng, chưa nhớ cột ẩn, chưa ánh xạ tiêu đề khi dán từ Excel | Một phần |
| FR-087 | chưa chạy `npm run e2e -w @mat/studio` sau khi thêm alarm (T086 chưa xong) | Chưa làm (chưa kiểm hồi quy e2e Studio) |

## An toàn, audit, ngân sách, kiểm thử, tài liệu (FR-088 đến FR-100)

| FR | Bằng chứng | Trạng thái |
|---|---|---|
| FR-088 | `alarms_api_test.cpp`, `R:auth`, `R:attack` | Đạt x64 |
| FR-089 | `core/audit/tests/audit_alarm_actions_test.cpp` (7; 33 hành động, lược đồ không đổi) | Đạt x64 |
| FR-090 | `audit_alarm_actions_test.cpp` (`auditLimited`, `alarm.ack` denied); `R:attack` (dấu vết audit); `R:storm` (ack hàng loạt 1 dòng) | Đạt x64 |
| FR-091 | `R:attack` (48/48 bị từ chối, 0 đổi trạng thái); `R:auth`; `roles_alarm_test.cpp` | Đạt x64 |
| FR-092 | `server/tests/config_test.cpp` (Config009, 5 test); khối `system/info.alarms` (T038); `server/tests/alarm_db_check_test.cpp` | Đạt x64 |
| FR-093 | `R:budget` (x64 Docker, THAM KHẢO): CPU 0,5 % bật so với 0,2 % tắt (thêm 0,3 điểm), RSS 20,6 MB so với 17,2 MB (thêm 3,4 MB), 10/10 client | Chờ BL335 (T129) |
| FR-094 | `vec` (99 ca), `pv` (165 ca T011 cộng 3 ca T104), `tests/widget-catalog-vectors/` (156 ca), `tests/migration-vectors/0.4-to-0.5/` (15 cặp); một số task ghi "không có pha đỏ riêng" (T017, T019, T043, T044, T104 phần C++) | Một phần: đủ số ca; pha đỏ không ghi cho mọi task test |
| FR-095 | `tools/alarm-it.ps1`, `tools/alarm-it/{lib,scenarios,attack-cases,storm,compat}.mjs`, `tests/alarm-it/compose.yaml`; `R:` đủ `state, quality, restart, killloop, latency, auth, history, attack, storm, compat, budget` | Đạt x64 (hạn chế 2); bước CI (`ci.yml`, `ci-local.ps1`, T122) đã thêm nhưng chưa chạy, chưa kiểm cú pháp YAML |
| FR-096 | e2e runtime-web: `alarm-live` (55), `alarm-history` (30), `alarm-widgets` (19); **e2e Studio (dựng 200 alarm, Thử alarm, nâng cấp, So sánh) chưa viết** | Một phần |
| FR-097 | `docs/reports/009-security-review.md`: 0 Critical, 0 High, 1 Medium (M1 hoãn), 4 Low, 3 Info; rà soát đọc mã, không chạy tấn công trực tiếp | Một phần: chạy lại `alarm-it -Scenario attack` trên gói cuối còn lại (ghi ở T119) |
| FR-098 | tasks.md không ghi thêm thư viện nào; chưa đối chiếu riêng `package-lock.json`, `third_party/LICENSES.md` | Chưa kiểm riêng |
| FR-099 | ADR `docs/adr/027..030` (Proposed, "chờ BL335"); `docs/deployment/alarm-operations.md`; `packages/alarm-engine/README.md` khung; mục Alarm trong `apps/studio/README.md` ghi "đang làm" | Một phần: T121 chưa [X]; "Đã làm của GĐ 4" ở `studio-ux.md` §9 chưa ghi thật |
| FR-100 | `kRuntimeVersion` 0.8.0, `kDeviceApiVersion` 1.3.0, Studio 0.7.0, `@mat/ui-components` 0.3.0, `@mat/alarm-engine` 0.1.0 có trong cây; `kProjectFormatAlarms` 0.5.0 | Một phần: T125 chưa xong (CMake, `tauri.conf.json`, `Cargo.toml`, `deployment/package-runtime.ps1`, `build/mat-runtime-armhf.tar.gz`, `deploy_rollback_test.sh` chưa xác nhận) |

## Tiêu chí thành công (SC-001 đến SC-024)

| SC | Bằng chứng | Trạng thái |
|---|---|---|
| SC-001 | `tools/alarm-demo` sinh `projects/alarm-200` (đúng 200 instance, hợp lệ TS); **kịch bản dựng trong Studio (T072) chưa có** | Chưa làm |
| SC-002 | 100 % `vec` ở C++ (100 test, x64 và armhf qemu) và TS; `R:state` (32 kiểm), `R:quality`, `R:restart`; trên BL335 chưa chạy | Một phần: x64 đạt; Chờ BL335 |
| SC-003 | `R:latency` (Chrome 155 headless, 100 lần, 0 bỏ sót): từ delta Tag tới DOM p95 12 ms (trễ bật 0) và 114 ms (trễ bật 3 s), p99 38 ms và 331 ms. THAM KHẢO tính từ lúc đổi thanh ghi giả lập (gồm chu kỳ quét Modbus 1 s): p95 1,29 và 1,39 s, tức vượt 1.000 ms nếu "Tag đổi" hiểu là nguồn | Đạt x64 (theo cách đo từ delta Tag; theo nguồn giả lập thì vượt); Chờ BL335 (T128) |
| SC-004 | `eng/alarm_engine_vectors_test.cpp` (100 xanh) và `ae/vectors.test.ts`, 99 ca (>= 60) | Đạt x64 |
| SC-005 | `eng/alarm_state_table_test.cpp` (40 ô x 3 tổ hợp; 10 ô không thể tới) | Đạt x64 |
| SC-006 | `R:auth` (22 kiểm: audit đủ trường, `ts` audit <= `tsAck`); `alarms_api_test.cpp` (503 khi audit lỗi); `alarm-live.e2e.mjs` (đổi alarm tới DOM 14 đến 29 ms trên một client giả). Chưa đo "99 % mọi client <= 500 ms" với nhiều client trong LAN | Một phần: audit đạt; số đo 500 ms nhiều client chưa có |
| SC-007 | `R:attack` (48/48 bị từ chối, 0 đổi trạng thái, 0 dòng audit ack/disable ok mới; 20/30 yêu cầu bão POST bị 429) | Đạt x64 |
| SC-008 | `R:killloop` (100/100 vòng `kill -9`: `integrity` ok, `ackWithoutAudit` rỗng; 290 yêu cầu ack, 351 mục chấp nhận); không thay phép thử mất điện thật | Một phần: 100 lần kill x64 đạt; cắt điện thật >= 10 lần Chờ người (T133), `kill -9` trên BL335 Chờ BL335 (T132) |
| SC-009 | không có (x64 chặn `/proc/<pid>/io`; spike T006 chỉ tham khảo) | Chờ BL335 (T130) |
| SC-010 | `alarm_store_test.cpp`, `alarm_service_test.cpp` (xóa theo hạn, trần dung lượng, chỉ lần đã đóng) | Đạt x64 (đơn vị); không đo "trong <= 1 giờ" trên chạy thật |
| SC-011 | `R:budget` x64 THAM KHẢO (xem FR-093); 30 phút trên BL335 chưa chạy | Chờ BL335 (T129) |
| SC-012 | axe sáng và tối 0 vi phạm ở ba e2e runtime-web (`docs/reports/009-a11y.md`); tương phản tám màu x hai theme (`alarm-tokens.test.ts`, 50 test). **Chưa có** axe và bàn phím cho màn Studio; NVDA chưa thử | Một phần: Studio thiếu; NVDA Chờ người (T134) |
| SC-013 | `R:history`: 100.000 dòng, lọc khoảng + khu vực + ưu tiên p95 5 đến 24 ms (<= 1 s), tìm "rò rỉ nước" = "ro ri nuoc" = oracle; xuất CSV 49.999 dòng 1,5 đến 3,2 s (tham khảo, tệp tải về không bắt được trong Chrome headless, số dòng lấy từ thanh tiến trình); `eng/alarm_history_test.cpp` (100.000 dòng < 1 s); `csv.test.ts` | Đạt x64; BL335 (<= 2 s) Chờ BL335 (T131); Excel Chờ người (T134) |
| SC-014 | `alarm-widgets.e2e.mjs`: dashboard 20 + 2 widget mở 383 ms (<= 2 s), `alarm-count` cập nhật 84 ms; vector danh mục 156 ca, hai validator đồng ý; **e2e Studio và BL335 chưa** | Một phần: runtime-web x64 đạt; Studio (T103, T110) chưa; Chờ BL335 (T128) |
| SC-015 | `R:compat` (36 kiểm: client 1.2.0 đóng băng `tests/compat/live-client-1.2/` với server 1.3.0 0 bản tin alarm 0 lỗi; client 1.3.0 với server giả 1.2.0 `unsupported`; project 0.1 đến 0.4 chạy); `tests/migration-vectors/0.4-to-0.5/` | Đạt x64 (không có binary runtime 0.6 và 0.7 để so cạnh nhau; hạn chế 2) |
| SC-016 | `docs/reports/009-sc016.md` chưa có; không đo mở bảng, sửa ô, cuộn 2.000 dòng (T072, T086, T087 chưa xong). Không dùng `grid-perf.e2e.mjs` của 006 làm bằng chứng vì không áp cho lưới alarm | Chưa làm |
| SC-017 | `st/model/alarm-sim.test.ts` (17 test, chạy `vec` qua cùng runner, 1×/5×/20× cùng chuỗi); `ae/vectors.test.ts` | Đạt x64 (đơn vị); chưa e2e panel Thử alarm |
| SC-018 | `R:storm`: 200 alarm bật trong một tick, 10 client (3 chậm): 0 phiên 4409, 0 hở sequence, 7 client nhanh thấy sau 1,2 s, bản tin lớn nhất 34.796 B, client chậm tổng 71.601 B (< 128 KB = 50 % của 256 KB), đánh giá lớn nhất 0,78 ms; `alarm_storm_test.cpp`, `live_hub_alarm_test.cpp` | Đạt x64 |
| SC-019 | `R:storm`: dao động 22 lần bật trong 66 s, tự cách ly, `alarm.db` đúng 5 hàng = `chatterLimit`, hàng tổng kết `repeat` = 5; `alarm_storm_test.cpp`. Lệch task T112: "<= 2 dòng/30 phút" không khớp spec, kiểm theo spec | Đạt x64 |
| SC-020 | `csv.test.ts` (33 chuỗi), `alarm-table.test.ts` (XSS 20 chuỗi), `alarm-page.test.ts`; lint DOM (T005) | Đạt x64 |
| SC-021 | `alarm_engine_test.cpp`, `alarms_api_test.cpp` (shelve, hết hạn, giới hạn 50, audit); `banner.test.ts` (bỏ shelved); `R:restart` không chứng minh shelve bền (Docker `clockOk=false`) | Một phần: bền qua khởi động lại khi `clockOk=true` chưa kiểm tích hợp; hết hạn "± 1 s" chỉ ở test đơn vị |
| SC-022 | bảng này; chưa chạy `/speckit-analyze`; một số task test không ghi pha đỏ riêng (xem FR-094) | Một phần |
| SC-023 | chưa có người; T135 chưa làm; "tự đo" chưa thực hiện | Chưa làm (Chờ người) |
| SC-024 | `tools/lint-rules-alarm.test.mjs` (8 test), eslint sạch (T005, T064); rà soát đọc tự nhiên chưa làm | Đạt x64 (lint); đọc tay Chờ người |

## Tóm tắt

- Đã có bằng chứng x64 cho động cơ (C++ và TS cùng vector), lưu trữ, live, API, audit, bảo mật, trang vận hành, lịch sử, widget trên runtime-web.
- Còn thiếu: toàn bộ e2e Studio của alarm và SC-016 (T072, T082, T086, T087, T103 Studio, T110), SC-001, SC-023; mọi số đo BL335 (SC-003, 009, 011, 013, 008 phần cắt điện) và thử tay (T134); T121, T125, T126, T136.
- Rủi ro mở: tick lớn nhất 3,0 đến 3,2 ms trên x64 so với ngưỡng ước tính 2 ms (FR-021); số đo x64 lấy từ bản sao đổi phiên bản (hạn chế 2); shelve bền qua khởi động lại chưa có bằng chứng tích hợp.
