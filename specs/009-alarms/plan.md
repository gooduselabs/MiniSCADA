# Implementation Plan: Alarm (cảnh báo) theo ISA-18.2

**Branch**: `009-alarms` | **Date**: 2026-10-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-alarms/spec.md`

## Summary

GĐ 4 của [lộ trình v2](../../docs/plans/roadmap-v2.md) (§4.5), một feature (D1). Người vận hành thấy ngay khi máy có sự cố, xác nhận trên Chrome và tra lịch sử; kỹ sư định nghĩa alarm hoàn toàn trong Studio, thử bằng mô phỏng rồi nạp xuống; mất điện không làm hỏng log và không bao giờ tạo xác nhận giả.

Cách làm ([research.md](research.md) R1–R25):

- **Định nghĩa** (định dạng **0.5.0**, hằng `kProjectFormatAlarms`):
  - hai file tùy chọn `alarms.json` (alarm, khu vực) và `alarm-classes.json` (lớp);
  - ba loại `digital`, `limit` (HH/H/L/LL, mỗi ngưỡng một instance `<id>.<ngưỡng>`, deadband và trễ chung), `quality` (`tag` hoặc `device`); không biểu thức riêng;
  - nội dung có thẻ chèn `{value:N}`, `{unit}`...; migration 0.4 → 0.5 chỉ đổi `schemaVersion`.
- **Động cơ** (ADR-027): trạng thái ISA-18.2 (`NORMAL`, `ACTIVE_UNACK`, `ACTIVE_ACK`, `RTN_UNACK` + cờ `shelved`, `disabled`, `inputBad`); thuần, thời gian tiêm vào, trễ bằng đồng hồ đơn điệu; **hai bản** `core/alarm` (C++) và `packages/alarm-engine` (TS) cùng bộ vector `tests/alarm-vectors/` (≥ 60 ca); chạy trên luồng tick **ngay sau `TagEngine::step`**, đọc Tag bằng một lần `snapshot`; tự cách ly alarm chập chờn (5 lần/60 s → 30 phút).
- **Lưu trữ** (ADR-028): `<dataDir>/alarm.db` riêng, WAL, `synchronous=NORMAL` (**không xin ngoại lệ SQLite thứ ba**); một dòng một lần xảy ra; ghi gom ở luồng riêng (commit 2 s hoặc 200 thay đổi, có cửa sổ thích ứng khi bão); thời hạn 180 ngày, trần 64 MiB, chỉ xóa lần xảy ra đã đóng; hỏng thì đổi tên `.corrupt-<epoch>`. **Độ bền của xác nhận do `audit.db` FULL ghi trước**; mất điện chỉ đẩy về "chưa xác nhận" (research R8 liệt kê từng thời điểm cắt).
- **Live 1.3.0 và REST** (ADR-029): `subscribeAlarms`/`unsubscribeAlarms`, `alarmSnapshot`/`alarmDelta` (`sequence` riêng, dồn theo instance), `hello.features`; REST `GET alarms`, `GET alarms/history`, `POST alarms/{ack,shelve,unshelve,disable,enable}`; xác nhận **chỉ REST**; sáu hành động audit mới (27 → 33).
- **Web** (ADR-030): banner, trang `#/alarms`, trang `#/alarm-history`, huy hiệu menu và tiêu đề tab, âm thanh Web Audio (mặc định tắt), nhấp nháy ≤ 1 Hz + giảm chuyển động, CSV sinh ở trình duyệt (UTF-8 BOM, chống công thức); hai widget `alarm-list`, `alarm-count` (danh mục 0.4.0, 17 widget).
- **Studio** (ADR-030): mở khóa mục Alarm; lưới Danh sách alarm (ADR-016), Lớp alarm, bảng Khu vực, "Tạo alarm cho Tag…", "Thử alarm" (động cơ TS + SimEngine + đồng hồ ảo), cột trạng thái sống khi Online.

Quyết định ghi trong **bốn ADR 027–030 (trạng thái Proposed)**: [027](../../docs/adr/027-alarm-model-engine.md), [028](../../docs/adr/028-alarm-log-storage.md), [029](../../docs/adr/029-alarm-live-api.md), [030](../../docs/adr/030-alarm-web-studio.md). Bố cục Studio: [mockup studio-alarms.html](../../docs/architecture/mockups/studio-alarms.html), **tạo và phiên chính tự duyệt ở task Setup; chặn việc viết giao diện Studio** (FR-086, D40).

**Phiên bản:** runtime 0.8.0; Studio 0.7.0; định dạng project 0.5.0; API thiết bị 1.3.0; giao thức live 1.3.0; gói `.matscada` 1.0.0 (không đổi); `@mat/ui-components` 0.3.0; `@mat/alarm-engine` 0.1.0; danh mục widget 0.4.0 (17 widget). Đã giải (D28, D29): GĐ 3b (specs/008) dùng định dạng 0.4.0, runtime 0.7.0, Studio 0.6.0, `@mat/ui-components` 0.2.0; feature này nằm sau 3b và trước 010 (0.6.0, runtime 0.9.0, Studio 0.8.0).

## Technical Context

**Language/Version**:

- C++17 (GCC 9 trong Docker Ubuntu 20.04; cross `arm-linux-gnueabihf`);
- TypeScript 7 (Vite 8, Lit 3.3.3);
- Rust 1.99, edition 2024 (Tauri 2.12): không đổi;
- Node ≥ 22 cho công cụ; PowerShell, sh.

**Primary Dependencies** (research R23): **không thêm thư viện nào.**

- **Runtime C++:** SQLite (đã có; WAL, `sqlite3_progress_handler`), CivetWeb 1.16, Mbed TLS 3.6.7, nlohmann/json, valijson, GoogleTest.
- **Trang runtime và Studio:** Lit 3.3.3, `@fluentui/svg-icons` (icon đã có), uPlot 1.6.32 (từ 007, không dùng cho alarm); Web Audio và `prefers-reduced-motion` là API của trình duyệt.
- **Package mới trong workspace:** `@mat/alarm-engine`. **Mở rộng:** `@mat/ui-components` (thư mục `alarm/`), `@mat/project-schema`, `@mat/live-client`.
- **Test:** Vitest, jsdom, puppeteer-core, axe-core, GoogleTest (đã có).

**Storage**:

- **BL335:** `<dataDir>/alarm.db` (+ `-wal`, `-shm`; `0600`; bảng `alarm_occurrence`, `alarm_override`, `alarm_meta`); `audit.db` không đổi lược đồ; `history.db` không đổi. Trạng thái alarm hiển thị nằm trong RAM của engine.
- **Project:** `alarms.json`, `alarm-classes.json` (tùy chọn); `.mat-backup/` khi nâng cấp 0.4 → 0.5.
- **Trình duyệt:** bật/tắt âm thanh trong `localStorage` bọc `try/catch` (tiện ích, không phải trạng thái cần bền); bảng alarm trong RAM.

**Testing**:

- GoogleTest + CTest (x64 Docker); test armhf dưới qemu-user (thêm `core/alarm` vào `MAT_ARMHF_TEST_TARGETS`, đặc biệt `alarm_store` với SQLite 32-bit);
- Vitest: vector chung (`tests/alarm-vectors/` ≥ 60, `tests/project-vectors/v05-*` ≥ 60, `tests/widget-catalog-vectors/`, `tests/migration-vectors/`), bảng ISA, `alarm-doc`, CSV, bộ gấp dấu, widget trên jsdom;
- e2e Chrome headless với axe-core: runtime-web (`alarm-*.e2e.mjs`) và Studio (lớp Tauri giả);
- tích hợp x64 `tools/alarm-it.ps1 -Scenario {state,latency,quality,storm,restart,killloop,history,auth,attack,compat,budget}`;
- mô phỏng cắt điện: `kill -9` 100 lần và cắt cụt/xáo trộn đuôi `-wal` tại ≥ 200 vị trí (research R24); cắt điện thật ≥ 10 lần ở BL335 cần người (⚠️🔌);
- đo trên BL335 ở task ⚠️🔌 (SSH và người); mọi bước ghi `docs/reports/device-changes.md`.

**Target Platform**: BL335 (armv7l, 2 × Cortex-A7, 993 MB RAM, Ubuntu 20.04.5, systemd 245, eMMC ext4; RTC không chạy); Chrome/Chromium ≥ 120; Studio trên Windows 10/11 (WebView2).

**Project Type**: dịch vụ nhúng C++ (mô-đun `core/alarm` mới, `server/alarm_glue`, `server/http/alarms_api`, mở rộng `LiveHub`, `core/audit`, `core/auth`, `core/project-manager`), package TS dùng chung (`@mat/alarm-engine`, mở rộng `@mat/ui-components`), ứng dụng web TS (`apps/runtime-web`), ứng dụng desktop Tauri (Studio).

**Performance Goals** (tất cả là mục tiêu; số ước tính ở research R9, R22 là **chưa đo**):

| Mục tiêu | Ngưỡng | Nguồn |
|---|---|---|
| Alarm hiện trên Chrome sau khi điều kiện đúng cộng trễ cấu hình | p95 ≤ 1.000 ms, p99 ≤ 1.250 ms (100 lần) | SC-003 |
| Xác nhận: mọi client thấy trạng thái mới (LAN) | ≥ 99 % ≤ 500 ms; 100 % lệnh có audit commit trước | SC-006 |
| Mất điện | 100 lần `kill -9` + ≥ 10 lần cắt điện thật: `integrity_check` = ok, 0 ACK không có audit; alarm còn đúng hiện lại ≤ 5 s | SC-008 |
| Ghi eMMC của alarm | tải chuẩn ≤ 25 MB/ngày; tải bão ≤ 0,1 GB/ngày; tổng runtime ≤ 2 GB/ngày | SC-009 (rủi ro: R9) |
| Thời hạn lưu, trần | dọn ≤ 1 giờ; file ≤ trần + 5 %; dọn không giãn khung live quá 250 ms | SC-010 |
| BL335, 200 alarm + 500 Tag/1 s + 10 client, 30 phút | CPU ≤ 30 %, RSS ≤ 150 MB, 0 mất sequence; alarm thêm ≤ 3 điểm % CPU và ≤ 4 MB RSS | SC-011 |
| Tick engine | 500 instance ≤ 2 ms mỗi tick trên BL335 | FR-021 |
| Lịch sử 100.000 lần xảy ra | lọc khoảng + khu vực + ưu tiên ≤ 1 s (x64), ≤ 2 s (BL335); CSV 50.000 dòng ≤ 10 s | SC-013 |
| Dashboard 20 widget + `alarm-list` + `alarm-count` | mở ≤ 2 s; `alarm-count` cập nhật ≤ 1 s | SC-014 |
| Bảng Studio | 200 dòng mở ≤ 1 s; sửa ô tới lỗi ≤ 500 ms; 2.000 dòng khung ≤ 16,7 ms | SC-016 |
| Bão alarm | 200 alarm trong một tick, 10 client: 0 lần 4409, đủ trạng thái ≤ 1 s, hàng đợi ≤ 50 % của 256 KB, trễ tick không tăng quá 5 ms | SC-018 |
| Chập chờn | 20 lần/phút bị cách ly đúng ở `chatterLimit`; đúng `chatterLimit` dòng mỗi chu kỳ 30 phút | SC-019 |
| Cập nhật bảng alarm (200 hàng liên tục) | khung trung bình ≤ 16,7 ms | FR-066 |

**Constraints**:

- Ngân sách Constitution III: toàn bộ cơ chế chống bão nằm trong thiết kế (tự cách ly, cửa sổ commit thích ứng, dồn delta); alarm thêm ≤ 4 MB RSS và ≤ 3 điểm % CPU (FR-093).
- Mỗi file JSON ≤ 1 MiB (gói 005); `alarms.json` ≤ 512 KiB (≈ 150 KB cho 500 instance, ước).
- Không thêm thư viện; không GPL/LGPL; không xin ngoại lệ SQLite thứ ba.
- Không sửa `specs/003`–`007`; điểm 009 đổi nằm ở ADR 027–030 và [contracts/](contracts/).
- SSH tới BL335 không có trong phiên viết kế hoạch: bước trên BL335 chờ quyền hoặc người dùng chạy lệnh ([quickstart.md](quickstart.md)); không tự khởi động lại hoặc cắt điện; không đụng `atscada-*`, `piano-edtech-*`.
- Ổ D máy dev ít chỗ: build Rust và C++ trên C:.
- Có lượt `tools/ci-local.ps1` chạy trên cây mã trong lúc viết tài liệu: bước viết kế hoạch **chỉ** thêm file dưới `specs/009-alarms/`.

**Scale/Scope**:

- ≤ 500 instance (nghiệm thu 200, cảnh báo trên 200), ≤ 16 lớp, ≤ 64 khu vực, ≤ 50 shelved cùng lúc; 10 client; 17 widget (thêm 2).
- Khoảng 8 module C++ mới hoặc sửa (`core/alarm` mới, `core/project-manager`, `core/audit`, `core/auth`, `server/alarm_glue`, `server/http/alarms_api`, `server/websocket/live_hub`, `server/config`); 2 package TS (1 mới), 3 ứng dụng/package TS sửa; 7 endpoint mới; 6 hành động audit mới; 4 ADR; 3 editor và 2 hộp thoại Studio mới.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution 2.0.1.

| Nguyên tắc | Đánh giá | Ghi chú |
|---|---|---|
| I. Vertical slice trên thiết bị thật | ✅ (cần đo) | Mọi chức năng chạy và kiểm trên x64 và Chrome headless trước; nghiệm thu trên BL335 ở task ⚠️🔌 (SC-003, 008, 009, 011, 013). Số ghi eMMC và tick là ước tính; spike đo trên x64 rồi BL335 |
| II. Ranh giới kiến trúc | ✅ | `core/alarm` không chứa giao diện; động cơ **hai bản** (C++ cho thiết bị, TS cho mô phỏng) với **bộ vector chung** ≥ 60 ca (như biểu thức, ADR-015); validator hai bản đọc cùng schema và vector `v05-*`; widget không gọi mạng (`AlarmSource`, `ActionHost`); trang chỉ hiển thị và gọi API. `apps/studio` điều phối package dùng chung và chứa logic soạn thảo |
| III. Ngân sách tài nguyên | ✅ (cần đo) | Tick ≤ 2 ms cho 500 instance; RSS thêm ≤ 4 MB (ước ≈ 3 MB); CPU thêm ≤ 3 điểm %; ghi eMMC: tự cách ly chập chờn, cửa sổ commit thích ứng, bỏ chỉ mục phụ nếu spike đòi (R9); hàng đợi live ≤ 50 % của 256 KB; **chặn bão nằm trong thiết kế, không đẩy cho người dùng**. Tổng ghi runtime ≤ 2 GB/ngày giữ vững (alarm ≈ 0,4 đến 5 % ngay cả ở ước tính xấu) |
| IV. Chrome ≥ 120, 10 client | ✅ | Alarm đi chung kênh live (không thêm kết nối); Web Audio và CSS `prefers-reduced-motion` có trong Chrome 120; không tính năng mới hơn |
| V. An toàn, bảo mật (NON-NEGOTIABLE) | ✅ (cần rà soát) | Xác nhận chỉ REST: backend kiểm role operator, cookie kèm CSRF + `Origin`; **audit `alarm.ack` (FULL) commit trước khi áp dụng**, audit lỗi thì 503 và không đổi trạng thái; `disable`/`enable` engineer, **không cookie**; không `eval`; chuỗi do project cung cấp (tên, nội dung, khu vực, lớp) chỉ vào DOM bằng `textContent`, lint cấm `innerHTML`; CSV chống công thức; truy vấn lịch sử tham số ràng buộc; shelve có lý do, ≤ 8 giờ, ≤ 50; web SCADA không phải lớp an toàn, interlock ở PLC (ghi giới hạn còn lại). Rà soát bảo mật là task bắt buộc (FR-097) |
| VI. Test trước | ✅ | Test viết trước, đỏ rồi mới cài; vector chung C++ ↔ TS; bảng ISA đủ tích Descartes; test tích hợp mất điện (`kill -9` 100 lần, cắt cụt WAL) và tải (bão, 10 client); `docs/reports/009-fr-matrix.md` kiểm bằng `/speckit-analyze` |
| VII. Đơn giản, có phiên bản | ✅ | Đúng phạm vi GĐ 4 (không thông báo ngoài, recipe, quản lý thay đổi alarm, xác nhận từ Studio hay qua WebSocket). YAGNI: khu vực phẳng, hai widget, shelve + disable là toàn bộ "suppress". SemVer: runtime 0.8.0, project 0.5.0 có migration (chỉ đổi `schemaVersion`), API 1.3.0, live 1.3.0 (MINOR, tương thích ngược), danh mục 0.4.0, gói 1.0.0 giữ. Không thêm thư viện (R23). `alarm.db` có số phiên bản lược đồ nội bộ (D37) |
| Ràng buộc công nghệ | ✅ | C++17/CMake/Ninja/armhf, CivetWeb, SQLite; Studio Tauri 2 + TS + Vite + Lit. **SQLite: không xin ngoại lệ thứ ba**: `alarm.db` `NORMAL`; hai ngoại lệ `FULL` hiện có (mốc historian, `audit.db`) không đổi; `audit.db` giữ lược đồ, chỉ thêm sáu giá trị `action` (27 → 33). Không thêm thư viện C++ hay TS |
| Quy trình | ✅ | Spec Kit; ADR 027–030 (Proposed); mockup trước code giao diện; thao tác BL335 chỉ khi người dùng cho phép; không cắt điện hoặc khởi động lại thiết bị tự ý |

**Kết quả trước Phase 0:** đạt. Không có `NEEDS CLARIFICATION`: mọi điểm spec để ngỏ đã chọn ở research, ghi "Quyết định (người dùng giao toàn quyền 2026-10-11)".

**Kiểm lại sau Phase 1** (data-model, contracts):

- Không phát sinh vi phạm mới.
- **Bề mặt mạng mới:** bảy endpoint `alarms/*` (hai đọc, ba thao tác cho operator, hai kỹ thuật) và hai bản tin live client + hai bản tin live server; mọi endpoint khai tường minh trong bảng quyền.
- **Độ bền:** chuỗi bắt buộc kiểm quyền → audit FULL → engine → live → `alarm.db` NORMAL; bất biến B1 đến B3 của research R8 có test.
- **Điểm cần phiên chính duyệt:** câu hỏi 1, 2, 3 ở mục "Câu hỏi cho phiên chính" (đã trả lời); các điểm lệch số ghi ở research cuối ("Điểm cần sửa spec").

## Project Structure

### Documentation (this feature)

```text
specs/009-alarms/
├── spec.md
├── plan.md                         # file này
├── research.md                     # R1–R25
├── data-model.md                   # alarms.json, alarm-classes.json, alarm.db, RAM engine, bảng ISA, bản tin live, API, audit, trang/widget, Studio, cấu hình, giới hạn
├── quickstart.md                   # test, tích hợp x64, Studio, lệnh chỉ đọc BL335, BL335 ⚠️🔌
├── contracts/
│   ├── project-format-0.5.md       # schema 0.5.0, ví dụ, mã E_ALARM_*/W_ALARM_*, migration, vector
│   ├── alarm-engine.md             # ngữ nghĩa, bảng chuyển trạng thái, định dạng vector chung
│   ├── alarm-store.md              # lược đồ SQL alarm.db, truy vấn, bảo trì, thứ tự độ bền
│   ├── live-protocol-1.3.md        # subscribeAlarms/alarmSnapshot/alarmDelta, dồn, tương thích
│   ├── device-api-1.3.md           # 7 endpoint, quyền, lỗi, system/info.alarms
│   ├── ui-alarm.md                 # AlarmSource, ActionHost mở rộng, widget, trang, âm thanh, CSV
│   └── studio-alarm-editor.md      # lưới, lớp, khu vực, tạo nhanh, Thử alarm, so sánh
├── checklists/requirements.md
└── tasks.md                        # /speckit-tasks
docs/adr/027, 028, 029, 030; docs/architecture/mockups/studio-alarms.html
```

### Source Code (repository root)

```text
schemas/
├── project.schema.json, alarms.schema.json (mới), alarm-classes.schema.json (mới), …  # → 0.5.0
├── widgets.catalog.json                                                               # 0.4.0: alarm-list, alarm-count
├── 0.4/                                                                               # bản đóng băng 0.4 (3b đã đóng băng 0.3)
└── protocol-version.json                                                              # live 1.3.0; project ["0.1","0.2","0.3","0.4","0.5"]

core/
├── alarm/                          # (mới) alarm_types.hpp, alarm_defs.{hpp,cpp}, alarm_engine.{hpp,cpp},
│                                   #       alarm_text.{hpp,cpp}, alarm_store.{hpp,cpp}, alarm_history.{hpp,cpp},
│                                   #       alarm_service.{hpp,cpp}, tests/
├── project-manager/                # (sửa) project_validator.* (chọn schema 0.5, kProjectFormatAlarms, kRuntimeVersion 0.8.0),
│                                   #       alarm_rules.{hpp,cpp} (mới: E_ALARM_*, W_ALARM_*)
├── audit/                          # (sửa) audit_actions.hpp (27 → 33, auditActionName, auditLimited), audit_log.cpp
└── auth/roles.cpp                  # (sửa) 7 hàng bảng quyền (cookieAllowed)

server/
├── alarm_glue.{hpp,cpp}            # (mới) nối engine ↔ store ↔ hub ↔ system/info; hàng đợi lệnh; nạp/kích hoạt project
├── http/alarms_api.{hpp,cpp}       # (mới) GET alarms, GET alarms/history, POST ack/shelve/unshelve/disable/enable
├── websocket/live_hub.*            # (sửa) subscribeAlarms/unsubscribeAlarms, alarmSnapshot/alarmDelta, hello.features, "1.3.0"
├── runtime_engine.cpp, main.cpp    # (sửa) AlarmEngine::step sau engine.step; khởi động/dừng alarm_service
├── device_state.hpp                # (sửa) kDeviceApiVersion 1.3.0
├── config.*                        # (sửa) alarmRetentionDays, alarmMaxBytes, alarmCommitMs, alarmCommitMaxMs, alarmChatterWindowS…
deployment/
├── device/deploy.sh                # (sửa) kiểm schemas/0.4, alarm schema; lời nhắc alarm.db khi hạ cấp
└── package-runtime.ps1             # (sửa) chép schemas mới, widgets.catalog.json 0.4.0

packages/
├── alarm-engine/src/               # (mới) types.ts, engine.ts, text.ts, vectors.ts
├── project-schema/src/             # (sửa) types-05.ts, format-05.ts, rules-05.ts, alarm-rules.ts, migrate.ts (migrate04to05), codes.ts
├── live-client/                    # (sửa) subscribeAlarms, bản tin alarm, cờ features
└── ui-components/src/alarm/        # (mới) alarm-source.ts, alarm-table.ts, alarm-format.ts, mat-alarm-list.ts, mat-alarm-count.ts
                                    #       + host/types.ts mở rộng (AlarmSource, ActionHost.ackAlarms/shelveAlarm), memory-source.ts

apps/runtime-web/src/
├── alarm/                          # (mới) alarm-client.ts, banner.ts, alarm-page.ts, history-page.ts, csv.ts, sound.ts, badge.ts
├── menu.ts, shell.ts, main.ts, action-host.ts, live-source.ts   # (sửa) mục menu + huy hiệu, route #/alarms #/alarm-history
└── i18n/vi.ts                      # (sửa) chuỗi alarm

apps/studio/
├── src/model/                      # (mới) alarm-doc.ts, alarm-sim.ts; (sửa) tree.ts (bỏ phase 'p4'), project-doc.ts (0.5, nâng cấp)
├── src/ui/editors/                 # (mới) alarm-grid.ts, alarm-classes.ts, alarm-quick-create.ts, alarm-test-panel.ts
└── src/i18n/vi.ts                  # (sửa) bỏ phase.p4; chuỗi alarm

tests/
├── alarm-vectors/                  # (mới) ≥ 60 ca JSON chung C++ ↔ TS
├── project-vectors/v05-*, widget-catalog-vectors/ (thêm 2 widget), migration-vectors/*-0.4to0.5/
tools/
├── alarm-it.ps1                    # (mới) -Scenario state|latency|quality|storm|restart|killloop|history|auth|attack|compat|budget
├── alarm-demo/                     # (mới) sinh projects/alarm-demo (12 alarm; sau mở rộng 200)
├── alarm-history-seed/             # (mới) nạp 100.000 lần xảy ra
└── project-validator/validate.mjs  # (sửa) 0.5, --migrate 0.4→0.5
projects/alarm-demo/                # project mẫu 0.5.0
apps/runtime-web/tests/e2e/alarm-*.e2e.mjs, apps/studio/tests/e2e/alarm-*.e2e.mjs
docs/
├── architecture/mockups/studio-alarms.html     # tạo ở task Setup, tự duyệt
├── deployment/mat-runtime.md                    # mục alarm.db và cấu hình
├── adr/027..030
└── reports/009-acceptance.md, 009-sc016.md, 009-fr-matrix.md, 009-<kịch bản>-x64.json, device-changes.md
```

**Structure Decision:**

- **BL335:** logic alarm nằm trong `core/alarm` thành thư viện độc lập CivetWeb và độc lập SQLite-binding của `server/` (engine thuần không I/O; `alarm_store` dùng SQLite trực tiếp như `local_store.cpp`), để unit test không cần mạng; `server/` chỉ nối HTTP, WebSocket, tick (`alarm_glue`).
- **Hàm thuần có test trước:** `AlarmEngine::step`, `AlarmDefs` (dấu vân tay), `alarm_text`, `foldVi`, `migrate04to05`, `alarm-rules` (hai bản), `csv.ts`, `alarm-doc.ts`, bảng chuyển ISA.
- **Dùng chung (Constitution II):** `@mat/alarm-engine`, thành phần bảng `alarm-table.ts`, widget, danh mục, validator nằm trong `packages/*` và `schemas/`; trang và Studio chỉ cấp `AlarmSource` và `ActionHost`.
- **Studio:** quyết định ở TS thuần (`model/`), giao diện chỉ hiển thị; mạng và file qua Rust (không lệnh Tauri mới).

### Ảnh hưởng tới mã của 003–007

Các feature 003 đến 007 đã xong về mã (commit `634d528` cho 007). Lượt `ci-local` có thể đang chạy: file chung chỉ thêm dòng hoặc khối mới, không đổi chữ ký có sẵn.

| File | Thay đổi | Rủi ro hồi quy |
|---|---|---|
| `core/audit/audit_actions.hpp`, `audit_log.cpp` | `kAuditActions` 27 → 33, `auditActionName`, `auditLimited` | trung bình: đổi cỡ mảng; chạy lại test audit (005, 006, 007), kiểm gộp 60 s không đổi cho hành động cũ |
| `core/auth/roles.cpp` | 7 hàng bảng quyền | cao: bảng test "mọi endpoint khai tường minh", kịch bản `auth`, `attack` của 005 và 007 |
| `server/websocket/live_hub.*` | nhánh `onMessage`, hàng đợi alarm, `hello.features`, hằng 1.3.0 | cao: hàng đợi 256 KB, 4409, `resync_required` của Tag giữ nguyên; chạy lại `driver-it`, `web-it` (F5 × 10) và vector tương thích 1.2.0 |
| `server/runtime_engine.cpp`, `server/main.cpp` | chèn `AlarmEngine::step` sau `engine.step`; khởi động/dừng dịch vụ; nạp project | cao: thứ tự tick, đường dừng sạch, `execv` khi đổi project; chạy lại toàn bộ `driver-it` và `deploy-live` |
| `core/project-manager/project_validator.*` | chọn schema 0.5, hằng `kProjectFormatAlarms`, `kRuntimeVersion` 0.8.0 | cao: 82 ca 0.1, ca 0.2 đến 0.4 giữ kết luận; hợp nhất với thay đổi của 008 (`kRuntimeVersion` 0.7.0 → 0.8.0) (SC-015) |
| `server/http/http_api.*` (`system/info`), `server/device_state.hpp` | khối `alarms`, API 1.3.0 | thấp: trường thêm |
| `server/config.*` | cấu hình alarm | thấp |
| `packages/project-schema/*`, `schemas/*`, `protocol-version.json` | luật 0.5, nâng cấp, schema | cao: vector `v01`–`v04` (của 007 và 008) giữ kết luận |
| `packages/live-client/*` | `subscribeAlarms`, bản tin | thấp: tùy chọn, không đổi Tag |
| `packages/ui-components/src/host/types.ts`, `memory-source.ts`, danh mục widget | `AlarmSource`, `ActionHost` mở rộng (thêm phương thức), 2 widget | trung bình: `FakeActionHost` và widget điều khiển của 007 phải biên dịch; test widget của 007 giữ |
| `apps/runtime-web/src/{menu,shell,main}.ts` | mục menu, route, banner | trung bình: e2e 007 (điều hướng, popup, đăng nhập) giữ; `compat` 0.1–0.4 |
| `apps/studio/src/model/tree.ts`, `i18n/vi.ts`, `model/project-doc.ts`; `tree.test.ts` | mở khóa Alarm, bỏ `phase:'p4'`, tài liệu 0.5 | thấp đến trung bình: test cây phải cập nhật |
| `CMakeLists.txt`, `package.json`, `eslint.config.mjs`, `tools/ci-local.ps1` | target, workspace, glob lint, bước CI | thấp |

## Thứ tự làm (gợi ý cho `/speckit-tasks`)

**Phase 1: Setup** (không phụ thuộc nhau, làm ngay):

- cấu trúc thư mục mới (`core/alarm`, `packages/alarm-engine`, thư mục `alarm/` của trang và `ui-components`, `tests/*`), glob lint, target CMake, workspace;
- **task T002:** hằng số phiên bản (`kProjectFormatAlarms`...) một chỗ, đối chiếu `specs/008` và `specs/010` `plan.md` xác nhận số hiện hành;
- package `@mat/alarm-engine` (khung, `README`);
- **mockup `studio-alarms.html`** tạo và phiên chính **tự duyệt** (ghi ngày): chặn giao diện Studio;
- **spike đo SQLite và ước tính ghi** (T006, x64 trước): `alarm.db` với tải chuẩn và bão (đếm byte ghi, số khung WAL mỗi commit, với 3 và 1 chỉ mục; cửa sổ commit cố định và thích ứng), kích thước dòng thực, truy vấn 100.000 dòng, `text_fold`; kết quả quyết định giữ hay bỏ hai chỉ mục phụ (R9) và đề xuất sửa SC-009;
- lệnh **chỉ đọc** trên BL335 (người dùng chạy hoặc khi có quyền): `df`, `mount` (ext4/eMMC, `dirty_expire_centisecs`), `/proc/<pid>/io` baseline, kích thước `history.db`, `audit.db` ([quickstart.md](quickstart.md)).

**Mốc:** khung biên dịch xanh; mockup duyệt; số spike ghi vào research.

**Phase 2: Foundational** (chặn mọi story):

- schema 0.5.0 (`alarms`, `alarm-classes`, `project`, `schemas/0.4/`, `widgets.catalog.json` 0.4.0, `protocol-version.json`);
- **validator hai bản** (`rules-05.ts`, `alarm-rules.ts` và `alarm_rules.cpp`, `project_validator`) + vector `v05-*` ≥ 60 và `widget-catalog-vectors` (test trước, đỏ);
- `migrate04to05` + cặp vector 0.4 → 0.5;
- hằng phiên bản (runtime 0.8.0, API 1.3.0, live 1.3.0 ở mức hằng; Studio 0.7.0, `ui-components` 0.3.0);
- **hành động audit mới** (27 → 33) có test;
- **vector alarm** `tests/alarm-vectors/` (≥ 60 ca) viết trước và runner ở cả hai bản (đỏ);
- hàng quyền (bảng `roles.cpp`) và khung `alarms_api` trả 501 có test quyền.

**Mốc:** vector validator xanh ở hai bản (SC-015 phần nâng cấp); vector alarm **đỏ có chủ đích**; project 0.1 đến 0.4 giữ kết luận.

**Phase 3: US3 (P1) Động cơ và lưu trữ** (rủi ro cao nhất, làm đầu):

- `alarm_types`, `alarm_defs` (dấu vân tay), `alarm_text`, `alarm_engine` C++ và `@mat/alarm-engine` TS **song song** (hai người/hai tác nhân, cùng vector): mốc xanh vector ở cả hai bản (SC-004, SC-005);
- `alarm_store` (lược đồ, ghi gom luồng riêng, cửa sổ thích ứng, thời hạn, trần, hỏng, đĩa đầy), `alarm_history` (kết nối chỉ đọc), `alarm_service` (khởi động dựng lại, đối chiếu override với audit, nạp project);
- `alarm_glue`, chèn vào tick, tự cách ly; `alarm-it -Scenario state,quality,restart,killloop,storm`;
- cắt cụt WAL tại ≥ 200 vị trí; bất biến B1 đến B3.

**Mốc:** `killloop` 100 lần sạch, `integrity_check` ok; chập chờn (SC-019); đo tick và ghi eMMC trên x64; vector xanh hai bản.

**Phase 4: US1 (P1) Live, REST, web:**

- live 1.3.0 ở `LiveHub` (đăng ký, snapshot chia lô, delta, dồn, tương thích 1.2.0) và `@mat/live-client`;
- REST `alarms_api` (ack với kết quả theo mục, `upToRevision`, shelve, unshelve, disable, enable, history, `system/info.alarms`), audit trước khi áp;
- `AlarmSource`, `alarm-table`, trang runtime (`alarm-client`, banner, trang, huy hiệu, tiếng, nhấp nháy), lịch sử sẽ ở Phase 6;
- `alarm-it -Scenario latency,state,compat,auth`; e2e banner/trang/menu (axe).

**Mốc:** SC-003, SC-006, SC-007 (phần trang), SC-012 trên x64; client 1.2.0 chạy như cũ.

**Phase 5: US2 (P1) Studio** (bắt đầu được song song từ Phase 2 phần mô hình `alarm-doc`, `alarm-sim`; giao diện **sau** mockup được duyệt):

- `alarm-doc.ts`, `alarm-sim.ts` (đồng hồ ảo, nối `@mat/alarm-engine`), nâng cấp 0.4 → 0.5 trong Studio, đổi tên Tag/Dùng ở đâu/So sánh;
- `alarm-grid`, `alarm-classes`, bảng Khu vực, `alarm-quick-create`, nội dung và Xem trước, `alarm-test-panel`, cột trạng thái sống, mở khóa cây (`tree.ts`, `vi.ts`), Tương thích runtime;
- e2e Studio: dựng 200 alarm, Thử alarm = vector (SC-017), SC-016.

**Mốc:** e2e dựng 200 alarm xanh (SC-001 phần x64).

**Phase 6: US4 (P2) Lịch sử và CSV:** truy vấn `beforeId`, `foldVi`/`text_fold`, hạn thời gian truy vấn; trang `#/alarm-history`; `csv.ts`; `tools/alarm-history-seed`; `alarm-it -Scenario history`; **mốc:** SC-013, SC-020 (CSV).

**Phase 7: US5 (P2) Widget:** `alarm-list`, `alarm-count`, danh mục 0.4.0, Toolbox/inspector tự sinh, xem trước Mô phỏng/Thiết bị cấp `AlarmSource`; **mốc:** SC-014.

**Phase 8: US6 (P3) Vận hành an toàn:** `alarm-it -Scenario attack,compat,budget`, tấn công US6, `AUDIT_UNAVAILABLE`, `alarm.db` hỏng (`alarm.purged`), đĩa đầy (`logPaused`); **mốc:** SC-007, SC-015, SC-018 trên x64.

**Phase 9: Polish:** rà soát bảo mật (FR-097), trợ năng, đối chiếu studio-ux §5 và §7 (`009-sc016.md`), tài liệu (README `alarm-engine`, `apps/studio/README.md`, `docs/deployment/mat-runtime.md`, hướng dẫn vận hành), `009-fr-matrix.md` (`/speckit-analyze`), `009-acceptance.md`, ADR 027–030 chuyển Accepted (phần đã đo), lint, `ci-local`.

**Phase 10: BL335 ⚠️🔌**, khi người dùng cho phép ([quickstart.md](quickstart.md)): độ trễ (SC-003), RSS/CPU/ghi eMMC (SC-009, SC-011), truy vấn 100.000 dòng (SC-013), **≥ 10 lần cắt điện thật có người ở cạnh (SC-008)**; ghi `device-changes.md`.

**Phần song song:**

- hai bản động cơ (C++ và TS) trên cùng vector;
- validator C++ và TS;
- `alarm_store` (Phase 3) song song với live/REST (Phase 4) khi giao diện giữa chúng (hàng đợi sự kiện, `AlarmStore` API) đã chốt ở data-model;
- Studio (mô hình) song song với runtime sau Phase 2;
- trang web (Phase 4) và widget (Phase 7) dùng chung `alarm-table.ts`: tách thành phần bảng ở Phase 4;
- **không** song song: mọi sửa `live_hub.*`, `runtime_engine.cpp`, `roles.cpp` (một người một lúc).

**Theo user story:**

| Story | Gồm |
|---|---|
| US3 (P1) Động cơ, bền, mất điện | Phase 2, 3 |
| US1 (P1) Thấy alarm và xác nhận trên Chrome | Phase 4 |
| US2 (P1) Studio định nghĩa, thử, nạp xuống | Phase 5 |
| US4 (P2) Lịch sử, CSV | Phase 6 |
| US5 (P2) Widget | Phase 7 |
| US6 (P3) Vận hành an toàn | Phase 8 (+ rà soát Phase 9) |

Phase 3 (kể cả cắt cụt WAL và `killloop`) phải xanh trước khi phát hành runtime 0.8.0 lên BL335. Phase 10 cần người ở cạnh thiết bị (cắt điện).

## Rủi ro

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Số phiên bản: đã giải (D28, D29): 0.5.0, vì 3b (specs/008) dùng 0.4.0. Rủi ro còn lại: hai feature cùng sửa file chung (`schemas/project.schema.json`, `packages/project-schema/src/{codes,index,validate,project-files,migrate}.ts`, `schemas/protocol-version.json`, `apps/studio/src/model/tree.ts`, `i18n/vi.ts`, shell/menu của runtime-web, `packages/ui-components`, `project_validator.*`) | Trung bình | Làm 009 sau khi 008 có mã (hoặc gộp bằng thêm khối); chạy lại vector của cả hai; T002 đối chiếu `specs/008` và `specs/010` `plan.md`; `tools/renumber-alarm-format.mjs` là phương án dự phòng nếu thứ tự phát hành đổi |
| Hai bản động cơ (C++ và TS) lệch nhau | Trung bình | Vector chung ≥ 60 ca (dự kiến 80), mỗi cặp ISA có test, ca biên làm tròn; CI chạy cả hai |
| Mất điện thật cần người; `kill -9` không chứng minh mất dữ liệu chưa fsync | Cao | Cắt cụt/xáo trộn đuôi WAL tại ≥ 200 vị trí ở x64; ≥ 10 lần cắt điện thật ⚠️🔌 có người; bất biến B1 đến B3; hướng mất mát an toàn do thiết kế (audit FULL trước) |
| Đo BL335 cần SSH; không có trong phiên kế hoạch | Cao | Đo x64 trước; task ⚠️🔌; lệnh chỉ đọc cho người dùng; số ước tính ghi rõ "chưa đo" |
| Bão alarm làm vượt ngân sách ghi eMMC (ước 0,11 GB/ngày với giảm thiểu; 3,8 GB/ngày nếu không) | Cao | Tự cách ly chập chờn, cửa sổ commit thích ứng, bỏ chỉ mục phụ nếu spike đòi, đề xuất cách ly 30 phút (R9, R12); đo `budget` |
| Con số SC-009 (25 MB/ngày) có dư so với ước tính (8 đến 22 MB) | Trung bình | Spike T006; nếu vượt thì bỏ chỉ mục hoặc nâng ngưỡng nghiệm thu (ghi "Điểm cần sửa spec") |
| `takeDirty` và hub chia sẻ: `LiveHub` dùng chung cơ chế gom Tag bẩn, thêm hàng đợi alarm có thể làm lệch thứ tự hoặc giữ khóa | Cao | Hàng đợi MPSC một chiều engine → hub; hub không giữ khóa Tag khi gửi; alarm có `sequence` riêng; chạy lại toàn bộ `driver-it`, `web-it` (F5 × 10), tương thích 1.2.0 |
| Kích thước hàng đợi live 256 KB: snapshot 500 hàng ≈ 175 KB, bão 10 client | Trung bình | Snapshot chia lô ≤ 100 hàng, dồn theo instance, giữ ≤ 50 % hàng đợi (SC-018), 4409 sẵn có |
| Ngân sách tick: 500 instance ≤ 2 ms trên Cortex-A7 (chưa đo) | Trung bình | Đường nóng không cấp phát, một `snapshot` mỗi tick; spike đo; trần cứng 500, cảnh báo 200 |
| Trang SQLite làm dung lượng ghi tăng (khung WAL 4 KiB cho một dòng 200 B; chỉ mục) | Trung bình | Gom commit, bỏ chỉ mục phụ nếu cần, không `VACUUM` tự động, đo `alarm.db` thực (ADR-028) |
| `alarm.db` hỏng hoặc đĩa đầy | Thấp | `.corrupt-<epoch>`, `alarm.purged`, `logPaused`; engine vẫn chạy trong RAM |
| Truy vấn lịch sử lớn làm nghẽn | Trung bình | Kết nối chỉ đọc, `limit` ≤ 500, `beforeId`, hạn thời gian 5 s, `q` ≤ 80 |
| Tìm tiếng Việt không dấu sai (NFC/NFD) | Thấp | `text_fold` + bộ ≥ 30 chuỗi test; chuẩn hóa NFC khi nhập |
| Lạm dụng shelve che alarm | Trung bình | ≤ 8 giờ, lý do, ≤ 50, audit, tab "Tạm ẩn", tự hết hạn (D11) |
| Giờ thiết bị về 1970 sau mất điện (RTC không chạy) | Thấp | `clockOk`, thứ tự theo mã tăng dần, trễ bằng đồng hồ đơn điệu, không dọn khi đồng hồ sai |
| Phạm vi lớn (6 story, 2 bản động cơ, lưu trữ, giao thức, web, Studio) | Cao | P1 trước theo thứ tự rủi ro (US3 → US1 → US2); mốc sau mỗi phase; tái dùng hạ tầng 006, 007 |
| Chrome chặn âm thanh, người vận hành tưởng có tiếng | Thấp | Chỉ báo rõ "Âm thanh đang tắt", chỉ báo ở thanh trên |

## Câu hỏi cho phiên chính

**Đã trả lời 2026-10-13** (phiên làm việc; người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11 và đang vắng; mọi điểm dưới đây có thể xem lại khi người dùng quay lại):

1. **`alarm.db` `NORMAL`, không ngoại lệ Constitution thứ ba; độ bền xác nhận ở `audit.db` FULL:** **đồng ý.** Hướng mất mát an toàn (research R8). Đòi bất biến B1 đến B3 có test trước khi phát hành.
2. **Đối chiếu `alarm_override` với `audit.db` lúc khởi động** (áp theo audit nếu mới hơn) để lệnh `disable`/`shelve` không mất khi cắt điện: **đồng ý** (R8); ack **không** dựng lại từ audit.
3. **Biện pháp ngân sách ghi:** cửa sổ commit thích ứng (2 → 30 s khi bão), bỏ hai chỉ mục phụ nếu spike đòi, đề xuất cách ly chập chờn 30 phút thay 10: **đồng ý làm theo kết quả spike**; các thay đổi chạm spec (SC-009, FR-035, FR-039, FR-044) ghi ở "Điểm cần sửa spec" của research, chờ người dùng quay lại trước khi sửa spec.
4. **Hai bản động cơ với bộ vector chung** (C++ và TS), thay vì WASM: **đồng ý** (R6, Constitution II, như ADR-015).
5. **Không thêm thư viện:** **đồng ý** (R23); tìm chữ không dấu bằng cột `text_fold`, CSV tự viết, âm thanh Web Audio.
6. **Mockup `studio-alarms.html`:** tự duyệt (phiên chính) ở task Setup; chặn giao diện Studio; ghi chú hạn chế (tĩnh).
7. **BL335:** chuyển danh sách lệnh chỉ đọc ([quickstart.md](quickstart.md)) cho người dùng cùng lời xin quyền SSH; cắt điện thật cần người; task cần thiết bị đánh dấu ⚠️🔌.
8. **Phiên bản:** runtime 0.8.0, Studio 0.7.0, API 1.3.0, live 1.3.0, định dạng 0.5.0 (hằng, D28; 3b dùng 0.4.0), `@mat/ui-components` 0.3.0, `@mat/alarm-engine` 0.1.0, danh mục 0.4.0, gói 1.0.0.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Hai bản động cơ alarm (C++ và TS) + bộ vector chung | Studio cần "Thử alarm" không phụ thuộc thiết bị; Constitution II | WASM: thêm chuỗi công cụ, kích thước; chỉ TS trên thiết bị: vượt RSS; chỉ C++: Studio không thử được |
| `alarm.db` riêng thay vì dùng `history.db` hoặc `audit.db` | Khác chu kỳ ghi, thời hạn, trần; hỏng riêng không mất lịch sử Tag hay audit | Dùng chung: một file hỏng mất nhiều thứ; đổ dữ liệu vận hành vào audit làm FULL đắt và bị dọn sớm |
| Cửa sổ commit thích ứng và hai chỉ mục có thể bỏ | Giữ ghi eMMC trong ngân sách ở tải bão | Commit cố định 2 s: ≈ 3,8 GB/ngày ở bão (R9) |
| Đối chiếu override với audit lúc khởi động | `alarm.db` NORMAL có thể mất lệnh `disable`/`shelve` cuối; không xin ngoại lệ FULL | `alarm_override` FULL: ngoại lệ Constitution thứ ba |
| Cột `text_fold` trong `alarm_occurrence` | Tìm chữ không phân biệt hoa thường và dấu tiếng Việt bằng `LIKE`, không thêm thư viện | FTS5: phụ thuộc cấu hình SQLite BL335, thêm ghi; hàm SQL tự đăng ký: chậm trên mọi hàng |
| Hàng đợi MPSC engine → hub và hàng đợi alarm riêng ở hub (dồn theo instance) | Engine không chờ hub; không mất trạng thái cuối khi client chậm | Gửi trực tiếp từ luồng tick: bị chặn bởi client chậm; trộn vào `delta` Tag: phá tương thích ngược |
| Tự cách ly chập chờn (D15) | Bão alarm xử lý ở nguồn; giữ ngân sách eMMC và màn hình | Giới hạn tốc độ ghi toàn cục: mất sự kiện thật của alarm tốt |
