# Research: Alarm (cảnh báo) theo ISA-18.2

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Ngày**: 2026-10-13

Phase 0 của plan. Mỗi mục gồm **Quyết định**, **Lý do**, **Phương án khác đã xét**.

- **Quyền quyết định.** Người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11. Chỗ spec để ngỏ, plan chọn phương án tốt nhất và ghi **Quyết định (người dùng giao toàn quyền 2026-10-11)**.
- **Số đo thiết bị** lấy từ `docs/reports/` (nhật ký 003, 005 đến 007). SSH tới BL335 không có trong phiên viết kế hoạch: mọi bước cần BL335 thành task ⚠️🔌 hoặc lệnh trong [quickstart.md](quickstart.md). Không có số đo nào của alarm trên BL335: mọi con số của feature này là **ước tính, chưa đo**; spike đo trên x64 rồi BL335 (R8, R9, R22).
- **Số đo đã có** (dùng làm mốc, không phải của alarm): 003 trên BL335, tải chuẩn 500 Tag/1 s/10 client có lưu trữ: RSS tối đa 13,7 MB, CPU hệ thống trung bình 11,7 % ([003-acceptance.md](../../docs/reports/003-acceptance.md)); Argon2id đặt t=1 theo số đo 883 ms ở t=2 (nhật ký 2026-10-12); `history.db` WAL `synchronous=NORMAL`, commit mỗi 5 s, đã qua kiểm mất điện của 003.
- **Phiên bản** (spec FR-100, D28, D29): runtime 0.8.0, Studio 0.7.0, định dạng project 0.5.0 (hằng `kProjectFormatAlarms`), API thiết bị 1.3.0, live 1.3.0, `@mat/ui-components` 0.3.0, `@mat/alarm-engine` 0.1.0, danh mục widget 0.4.0, gói `.matscada` 1.0.0.
- **Thí nghiệm trong scratchpad:** không có. Các phân tích số bên dưới là tính tay từ các thông số SQLite đã biết (trang 4 KiB, khung WAL = 24 B + 4096 B), ghi rõ "ước tính, chưa đo; spike T006 đo trên x64 rồi BL335".

**Điều tra hiện trạng mã** (đọc ngày 2026-10-13, dùng làm cơ sở):

| Phần | Hiện trạng | Ảnh hưởng |
|---|---|---|
| `core/audit` | `AuditLog::append`, `audit.db` WAL `synchronous=FULL`; `kAuditActions` là `std::array<…,27>`; cột `action` không CHECK; trần 64 MiB, 365 ngày; gộp 60 s tối đa 10 dòng/phút cho `auditLimited`; lỗi ghi ném `AuditUnavailable` (503 `AUDIT_UNAVAILABLE`) | thêm 6 hành động (27 → 33): đổi cỡ mảng, `auditActionName`, quyết định `auditLimited`; không đổi lược đồ |
| `core/historian/local_store.cpp` | `history.db` WAL `NORMAL`, `cache_size=-8192`, writer thread, commit 5 s hoặc 5.000 dòng, bộ đệm 10.000, dọn mỗi giờ ≤ 2.000 dòng, `minFreeBytes` 500 MiB, hỏng đổi tên `.corrupt-<epoch>`; `HistoryReader` chỉ đọc | mẫu cho `alarm_store` và `alarm_history`; không dùng chung file (D12) |
| `core/tag-engine` | `TagStore` (`TagValue{value, quality, reason, sourceTs, serverTs, revision}`, `snapshot(indices,out)`, mutex trong); `TagEngine::step(now)` ngay trước `hub.tick()` (`server/runtime_engine.cpp`, `server/main.cpp`) | chỗ cắm `AlarmEngine::step` ngay sau `engine.step` (R7) |
| `server/websocket/live_hub.*` | `kLiveProtocolVersion="1.2.0"`; client `subscribe, unsubscribe, heartbeat`; server `hello, snapshot, delta, heartbeat, error, resync_required`; `write` bị từ chối `BAD_MESSAGE` + audit; hàng đợi 256 KB/phiên, tràn → `resync_required` rồi 4409 | thêm nhánh trong `LiveHub::onMessage`, hàng đợi alarm riêng, `hello.features` (R13) |
| `core/auth/roles.cpp` | cờ `needsSession, minRole, refreshesSession, changesDevice, cookieAllowed, webEntry`; CSRF `X-MAT-CSRF`, so `Origin` với `Host`; role `viewer < operator < engineer < administrator` | 7 hàng mới trong bảng quyền (R14) |
| `server/http/*` | `device/identity`, `auth/*`, `web/*`, `project/*`, `projects/active`, `diagnostics`, `audit`, `drivers/*`, `serial/ports`, `system/info`, `tags/write*`, `live` | thêm `alarms_api.*`; `system/info` thêm khối `alarms` |
| `core/project-manager` | `kRuntimeVersion` 0.6.0 (0.7.0 sau 3b); validator chọn schema theo `schemaVersion` (0.1 đến 0.3; 3b thêm 0.4); luật 0.3 tách `rules_03` (3b thêm luật 0.4) | `alarm_rules.*` mới; `kProjectFormatAlarms` |
| `packages/ui-components/src/host/types.ts` | `TagSource`, `ActionHost` (`session, writeBlocked, write, navigate, openPopup, closePopup, requestLogin`); `memory-source.ts` (`MemoryTagSource`, `FakeActionHost`) | thêm `AlarmSource`, mở rộng `ActionHost` (`ackAlarms`, `shelveAlarm`) |
| `apps/runtime-web/src` | `menu.ts`, `status.ts`, `live-source.ts`, `action-host.ts`, `shell.ts`, `popup-host.ts`, `main.ts` | thêm thư mục `alarm/`; menu nhận huy hiệu |
| `apps/studio/src/model/tree.ts` | `PHASE_PAGES.alarm` (`phase:'p4'`), node `alarm`, `alarmList`, `alarmClasses`; `i18n/vi.ts` có `phase.p4`, `tree.alarm`, `tc.group.alarm`; `tree.test.ts` | mở khóa, bỏ `phase:'p4'`, cập nhật test |
| `packages/alarm-engine`, `core/alarm` | **chưa có** | tạo mới |
| `tests/alarm-vectors/` | **chưa có** | tạo mới (≥ 60 ca) |

## R1. Định dạng 0.5.0 và hai file

- **Quyết định (người dùng giao toàn quyền 2026-10-11):**
  - **Định dạng 0.5.0** (hằng `kProjectFormatAlarms` ở C++ và `PROJECT_FORMAT_ALARMS` ở TS; không chuỗi `"0.5.0"` rải rác). Thêm hai file tùy chọn: `alarms.json` (`schemaVersion`, `areas`, `alarms`) và `alarm-classes.json` (`schemaVersion`, `classes`), khai trong `project.json` cạnh `logging`. Project không có hai file vẫn hợp lệ.
  - `minRuntimeVersion` ≥ `0.8.0` khi có alarm (`E_MIN_RUNTIME`). Mọi file cùng `schemaVersion` `0.4.x` (ADR-004).
  - Schema 0.3 đóng băng ở `schemas/0.4/`; `schemas/*.schema.json` thành 0.5.0; thêm `schemas/alarms.schema.json`, `schemas/alarm-classes.schema.json`; `protocol-version.json` = `{"live":"1.3.0","project":["0.1","0.2","0.3","0.4","0.5"]}`.
  - Migration 0.4 → 0.5 chỉ đổi `schemaVersion` mọi file và nâng `minRuntimeVersion` lên ≥ 0.8.0 (FR-012), không tạo file alarm rỗng, không đổi nội dung (SC-015). Bản sao lưu trước lần lưu đầu như 006 FR-003 và 007 FR-007.
  - Tách `alarms.json` và `alarm-classes.json` (lớp ở file riêng): lớp ít đổi, alarm đổi nhiều; So sánh theo đối tượng gọn hơn; giới hạn 1 MiB mỗi file của gói 005 không bị chạm (`alarms.json` ≤ 512 KiB, 500 instance ≈ 150 KB ước tính).
  - Định dạng ghi ổn định (thứ tự khóa chuẩn, bỏ trường bằng mặc định) cho diff (FR-084).
  - **Phụ thuộc 3b (đã giải, D28, D29):** 3b (specs/008) đã chiếm 0.4.0 (runtime 0.7.0, Studio 0.6.0, `@mat/ui-components` 0.2.0) nên feature này dùng 0.5.0; 010 dùng 0.6.0. Task T002 đối chiếu `specs/008` và `specs/010` `plan.md`; công cụ đổi số giữ làm dự phòng. Rủi ro còn lại: hai feature cùng sửa file chung (xem tasks.md, "Phối hợp với GĐ 3b").
  - **Kết quả đọc mã (T010, 2026-10-13):** `project.json` khai file tùy chọn bằng một khóa chuỗi mỗi file (`loggingFile`, `connectionFile`; `navigation` là đối tượng gộp trong chính `project.json`, không phải file). `packages/project-schema/src/validate.ts` (`validateProject03`) và `core/project-manager/project_validator.cpp` (`validate03`) nạp từng khóa theo thứ tự: kiểm `isSafeRelPath` (sai thì `E_PATH` ở `/<khóa>`), rồi `loadJson` (thiếu file là `E_FILE_MISSING`); `projectFiles()` (TS) và `LoadedProject::files()` (C++) liệt kê file khai. Chốt tên khóa: **`alarmFile`** và **`alarmClassFile`** (cùng dạng `loggingFile`: chuỗi `.json`, 6 đến 128 ký tự), cộng `navigation.alarms` (bool); file không khai không được đọc. Cách làm này được cài ở T014 đến T018 (schema `project.schema.json`, `validate.ts`, `project_validator.cpp`, `project-files.ts`).
- **Lý do:** thêm file tùy chọn kèm đổi yêu cầu runtime tối thiểu là đổi MINOR theo ADR-004; không có dữ liệu cần chuyển nên migration tầm thường và kiểm được bằng so byte; một hằng số giữ chi phí đổi số gần bằng 0.
- **Phương án khác đã xét:**
  - **Mở rộng 0.4 (thêm file tùy chọn, không đổi số):** runtime 0.7 gặp project có alarm sẽ bỏ qua âm thầm, kỹ sư tưởng đã có alarm. Loại: phải có cổng `minRuntimeVersion`.
  - **Một file `alarms.json` chứa cả lớp:** diff lẫn lộn, validator chung một đối tượng lớn. Loại.
  - **Nhúng alarm vào `tags.json`:** trộn hai miền, Tag tính toán và alarm đổi theo nhịp khác nhau. Loại.

## R2. Loại alarm và instance

- **Quyết định:**
  - Ba loại: `digital`, `limit`, `quality`; không biểu thức riêng (D6). Điều kiện phức làm bằng Tag tính toán của 006 rồi đặt alarm số.
  - **Instance** là đơn vị đánh giá. `digital`, `quality`: một instance, id = id định nghĩa. `limit`: tối đa bốn instance, id `<id>.<HH|H|L|LL>`, mỗi ngưỡng một lớp, deadband và trễ chung (D7).
  - Dấu vân tay điều kiện của instance (dùng ở R11, FR-023): băm của (loại, Tag hoặc thiết bị, `trigger`/`on`/giá trị ngưỡng, hướng cao hoặc thấp). Lớp, khu vực, tên, nội dung, trễ, deadband **không** vào dấu vân tay (đổi chúng không đóng lần xảy ra).
  - Giới hạn: ≤ 500 instance mỗi project, cảnh báo trên 200; id `^[A-Za-z][A-Za-z0-9_]{1,47}$` (chữ hoa/thường cho khớp tên Tag; dấu `.` dành cho hậu tố ngưỡng nên cấm trong id).
  - Thứ tự đánh giá cố định theo thứ tự instance trong `alarms.json` (HH, H, L, LL trong cùng alarm) để vector tất định.
- **Lý do:** máy trạng thái ISA một dạng cho mọi instance; test bảng đơn giản; mỗi ngưỡng có xác nhận, lịch sử, lớp riêng. Chi phí HH và H cùng hiện khi vượt cả hai được chấp nhận (bảng xếp HH trước).
- **Phương án khác đã xét:**
  - **Một instance `limit` có "mức" thay đổi (H rồi HH):** máy trạng thái phải mô tả chuyển mức, xác nhận mức nào, lịch sử một dòng hay nhiều dòng. Loại (D7).
  - **Loại `expression`:** thêm đường đánh giá thứ hai ngoài ADR-015, vector tăng gấp đôi. Loại (D6).
  - **Loại `rate-of-change`, `deviation`:** YAGNI; làm được bằng Tag tính toán.

## R3. Thuật toán deadband và trễ

- **Quyết định:**
  - **Điều kiện thô** (trước trễ) của instance, theo FR-017:
    - cao (`H`, `HH`): đang `false` thì thành `true` khi `v ≥ limit`; đang `true` thì thành `false` khi `v < limit − deadband`; trong vùng giữa giữ nguyên;
    - thấp (`L`, `LL`): đang `false` thì `true` khi `v ≤ limit`; đang `true` thì `false` khi `v > limit + deadband`;
    - `digital`: `cond = (value != 0) == trigger` (BOOL, số nguyên khác 0 là `true`).
  - **Trễ** (FR-018) bằng hai bộ đếm đơn điệu mỗi instance, chỉ một chạy tại một thời điểm:
    - `cond` thô đúng và instance chưa bật: bắt đầu (hoặc tiếp tục) đếm `onDelay` từ mốc `condSinceMono`; đủ `onDelayMs` thì bật; `cond` sai trước hạn thì xóa mốc;
    - `cond` thô sai và instance đang bật: đếm `offDelay` từ `clearSinceMono`; đủ thì hết; `cond` đúng lại thì xóa mốc;
    - trễ 0 nghĩa là chuyển ngay trong tick đó.
  - **Độ phân giải:** chu kỳ tick (≤ 250 ms). Điều kiện "đủ" là `nowMono − since ≥ delay`, nên trễ 3.000 ms trên tick 250 ms bật ở tick đầu tiên có `nowMono − since ≥ 3000` (sai số ≤ 250 ms, không bao giờ sớm hơn). Spec SC-003 tính trên cơ sở này.
  - **Đồng hồ đơn điệu** (`nowMonoMs`) cho trễ, thời hạn shelve, cửa sổ chập chờn; **giờ treo tường** (`nowEpochMs`) chỉ để ghi và hiển thị. Cả hai do nơi gọi tiêm vào; engine không đọc đồng hồ.
  - **Giá trị không hữu hạn** (NaN, ±inf) của Tag FLOAT coi như BAD cho `limit` (giữ nguyên, R4).
  - **Deadband phải nhỏ hơn khoảng cách tới ngưỡng kề cùng phía** (FR-004), nên điều kiện thô của hai instance kề nhau không giằng nhau; lỗi `E_ALARM_DEADBAND`.
  - **Giá trị ngay lúc khởi động:** instance chưa có `cond` trước đó coi `cond = false`; nếu `v` đã ≥ ngưỡng thì chạy trễ bật như thường, lần xảy ra mang cờ `startup`.
- **Lý do:** hysteresis lệch (không đối xứng) theo cách PLC thường làm; một cặp bộ đếm gọn, không cấp phát; trễ đo bằng đồng hồ đơn điệu nên NTP nhảy giờ không làm bật/hết sai.
- **Phương án khác đã xét:**
  - **Hysteresis đối xứng quanh ngưỡng (± deadband/2):** khác thói quen PLC, khó giải thích; loại.
  - **Trễ tính bằng số tick:** đổi chu kỳ tick làm đổi ngữ nghĩa. Loại.
  - **Lọc trung bình trước khi so:** là chức năng của Tag tính toán, không phải của alarm.

## R4. Quality và `device`

- **Quyết định:**
  - **`digital` và `limit`:** Tag BAD (hoặc giá trị không hữu hạn) thì giữ nguyên trạng thái và bộ đếm trễ, đặt cờ `inputBad` = true trong dữ liệu instance; khi quality trở lại GOOD thì xóa cả hai mốc trễ và đánh giá tiếp từ giá trị mới (D16, FR-019). UNCERTAIN coi như GOOD.
  - **`quality` trên `tag`:** `cond = (q == BAD)` khi `on: bad`; `cond = (q != GOOD)` khi `on: notGood`. Trễ bật mặc định 0 s. `reason` của Tag lúc bật được chụp vào lần xảy ra và vào thẻ `{reason}`.
  - **`quality` trên `device`:** `cond` đúng khi **mọi** Tag đọc từ thiết bị (nguồn `deviceId`, loại bỏ Tag tính toán) có quality thỏa `on` và có ít nhất một Tag. Danh sách chỉ số Tag của thiết bị dựng một lần khi nạp project (`AlarmDefs` giữ `std::vector<uint32_t>`); mỗi tick duyệt qua `snapshot` đã lấy.
  - Thiết bị không còn Tag: instance không bao giờ bật; `W_ALARM_DEVICE_EMPTY`.
  - **Tag chưa có giá trị tin cậy** (chưa từng GOOD kể từ khởi động): coi như BAD cho `digital`/`limit` (giữ nguyên), như chưa có dữ liệu cho `quality` thì `cond` theo quality thực của Tag (`BAD` lúc khởi động đúng nghĩa "chưa có tín hiệu").
- **Lý do:** một sự cố một báo cáo: PLC rút cáp thì alarm `quality` bật, các alarm ngưỡng của Tag đó không báo "hết" giả; `device` dùng đúng dữ liệu Tag Engine đã có (D33), không thêm đường dữ liệu trạng thái kết nối riêng.
- **Phương án khác đã xét:**
  - **BAD thì tự bật alarm của mọi Tag liên quan:** bão alarm khi mất một thiết bị 200 Tag. Loại.
  - **Alarm `device` đọc `DriverManager` trực tiếp:** thêm phụ thuộc từ `core/alarm` sang drivers; engine mất tính thuần. Loại.
  - **BAD thì coi như hết (xóa alarm):** báo hết giả khi rút cáp; nguy hiểm. Loại.

## R5. Trạng thái ISA và bảng chuyển

- **Quyết định (D8):**
  - Bốn trạng thái `NORMAL`, `ACTIVE_UNACK`, `ACTIVE_ACK`, `RTN_UNACK` và hai cờ độc lập `shelved`, `disabled`, cộng cờ dữ liệu `inputBad`.
  - **Sự kiện** vào máy: `condOn` (điều kiện qua trễ bật), `condOff` (qua trễ tắt), `ack`, `ackReturn`... gộp thành `ack` khi `RTN_UNACK`, `shelve`, `unshelve`, `shelveExpire`, `disable`, `enable`, `configRemove`, `restore`.
  - Bảng (data-model §5 liệt kê đủ trạng thái × sự kiện; ở đây là cốt lõi):

    | Từ | Sự kiện | Điều kiện | Tới |
    |---|---|---|---|
    | `NORMAL` | `condOn` | lớp `requiresAck` | `ACTIVE_UNACK` (lần xảy ra mới) |
    | `NORMAL` | `condOn` | lớp không `requiresAck` | `ACTIVE_ACK` (thông tin) |
    | `ACTIVE_UNACK` | `ack` | | `ACTIVE_ACK` |
    | `ACTIVE_UNACK` | `condOff` | `requiresAck` (luôn đúng ở trạng thái này) | `RTN_UNACK` |
    | `ACTIVE_ACK` | `condOff` | lớp `ackReturn` | `RTN_UNACK` |
    | `ACTIVE_ACK` | `condOff` | không `ackReturn` | `NORMAL` (đóng lần xảy ra) |
    | `RTN_UNACK` | `ack` | | `NORMAL` (đóng) |
    | `RTN_UNACK` | `condOn` | | `ACTIVE_UNACK` (lần xảy ra **mới**, lần cũ đóng) |

  - `ACTIVE_UNACK` + `condOff` với lớp không `requiresAck` không xảy ra (lớp đó không bao giờ vào `ACTIVE_UNACK`).
  - **Đóng lần xảy ra** khi về `NORMAL`; `closedBy` ∈ {`return`, `config`, `disabled`, `restart-lost`} (FR-036). `restart-lost` dành cho lần xảy ra mà khởi động lại không thể đối chiếu (ví dụ alarm bị xóa trong lúc tắt máy, hoặc dòng `alarm.db` mất commit cuối).
  - **`shelved`:** instance vẫn được đánh giá và ghi lịch sử; chỉ ảnh hưởng hiển thị, tiếng, đếm. `ack` lên instance shelved trả `SHELVED`. Hết hạn mà `cond` còn đúng thì lần xảy ra mới `ACTIVE_UNACK` (D11): lần xảy ra cũ (nếu có) đóng với `closedBy` = `return` và dòng mới có cờ `fromShelve`? Không thêm cờ: tập cờ chỉ `startup`, `inputBad`, `closedBy` (FR-036); lần mới được nhận biết qua `ts_active_ms` mới.
  - **`disabled`:** không đánh giá; lần xảy ra mở đóng `closedBy=disabled`; `enable` thì đánh giá từ đầu (như alarm mới).
  - Mọi trạng thái ngoài bảng không tới được: kiểu `State` đóng, `switch` đầy đủ, test duyệt hết tích Descartes (SC-005).
- **Lý do:** đúng khung ISA-18.2 ở mức tối thiểu hợp lý; hai núm lớp `requiresAck`, `ackReturn` bao phủ alarm thông tin, alarm thường, alarm cần xác nhận khi hết, không thêm trạng thái.
- **Phương án khác đã xét:**
  - **Bảy trạng thái ISA đầy đủ (suppressed-by-design, out-of-service, shelved là trạng thái):** hồ sơ hợp lý hóa alarm ngoài phạm vi; shelved là cờ giúp trạng thái chạy tiếp bên dưới. Loại.
  - **Xác nhận trên mức instance cha (alarm `limit` cả cụm):** mất tính độc lập (D7). Loại.

## R6. Hai bản động cơ và bộ vector

- **Quyết định:**
  - **Hai bản:** `core/alarm` (C++17: `alarm_types.hpp`, `alarm_defs.*`, `alarm_engine.*`, `alarm_text.*`) và `packages/alarm-engine` (TS: `types.ts`, `engine.ts`, `text.ts`, `vectors.ts`). Cùng giao diện thuần: `step(nowMonoMs, nowEpochMs, tags) → events`; thời gian tiêm vào; không I/O, không đồng hồ, không ngẫu nhiên, không cấp phát khi không có thay đổi (C++).
  - **Bộ vector chung** `tests/alarm-vectors/*.json` (≥ 60 ca, chạy ở cả hai bản, chung loader `vectors.ts` và `alarm_vectors_test.cpp`). Mỗi ca:

    ```json
    {
      "name": "limit-h-hysteresis",
      "description": "H=80, deadband 2, trễ bật 3 s, trễ tắt 1 s",
      "classes": [{"id":"minor","priority":"minor","requiresAck":true,"ackReturn":false,"chatterLimit":5}],
      "alarms": [{"id":"LV","type":"limit","tag":"TANK.LEVEL","name":"Mức bồn","deadband":2,
                  "onDelayMs":3000,"offDelayMs":1000,"limits":{"H":{"value":80,"class":"minor"}}}],
      "tags": {"TANK.LEVEL":{"type":"FLOAT","unit":"%"}},
      "tickMs": 250,
      "events": [
        {"t":0,"tags":{"TANK.LEVEL":{"v":70,"q":"GOOD"}}},
        {"t":1000,"tags":{"TANK.LEVEL":{"v":85,"q":"GOOD"}}},
        {"t":4500,"cmd":{"ack":{"id":"LV.H","occurrence":1}}},
        {"t":6000,"tags":{"TANK.LEVEL":{"v":77,"q":"GOOD"}}}
      ],
      "expect": [
        {"t":4000,"id":"LV.H","from":"NORMAL","to":"ACTIVE_UNACK","occurrence":1,
         "valueActive":85,"text":"Mức bồn cao: 85 % (ngưỡng 80)"},
        {"t":4500,"id":"LV.H","from":"ACTIVE_UNACK","to":"ACTIVE_ACK","occurrence":1,"result":"ACKED"},
        {"t":7000,"id":"LV.H","from":"ACTIVE_ACK","to":"NORMAL","occurrence":1,"closedBy":"return"}
      ]
    }
    ```

  - **Quy ước định dạng:** `t` là mili giây thời gian ảo (đồng thời là `nowMono`; `nowEpoch` = `epoch0 + t`, `epoch0` mặc định 1.700.000.000.000, ca `*-clock-*` đặt riêng); runner chạy tick đều mỗi `tickMs` từ 0 đến `t` cuối + 120 s, áp dụng `events` đúng tick có `t` (sự kiện giữa hai tick áp dụng ở tick kế); `expect` là **danh sách chuyển trạng thái đầy đủ theo thứ tự** (không chỉ tập con): runner so từng phần tử (`t`, `id`, `from`, `to`, `occurrence`, và các trường có mặt: `closedBy`, `valueActive`, `text`, `flags`, `result`); thừa hoặc thiếu chuyển trạng thái là hỏng ca. Các lệnh trong `events.cmd`: `ack`, `ackAll {upToRevision, filter}`, `shelve {id, durationS, reason}`, `unshelve`, `disable`, `enable`, `restart {persisted: <ảnh chụp lưu>}`, `reload {alarms, classes}`.
  - **Nhóm ca và số lượng dự kiến (tổng ≥ 60):**

    | Nhóm | Nội dung | Ca |
    |---|---|---|
    | `limit-*` | bật theo H/HH/L/LL, deadband (vào, vùng giữa, ra), trễ bật bị đặt lại, trễ tắt bị đặt lại, nhảy qua cả H và HH, hạ từ HH giữa H và HH, ngưỡng tên thiếu, nhiều tick cùng giá trị, giá trị đúng ngưỡng | 14 |
    | `digital-*` | `trigger` true/false, số nguyên khác 0, trễ bật/tắt, đúng sai chập chờn ngắn hơn trễ | 7 |
    | `quality-*` | `tag` bad/notGood, `reason` vào nội dung, `device` mọi Tag không GOOD, thiết bị một Tag, thiết bị không Tag, BAD giữ nguyên instance `limit`/`digital` (`inputBad`), quality trở lại bắt đầu lại trễ, NaN | 9 |
    | `ack-*` | ack đúng lần xảy ra, ALREADY_ACKED, NOT_ACTIVE, STALE, SHELVED, NOT_FOUND, ackAll theo `upToRevision` và bộ lọc, lớp `requiresAck=false`, `ackReturn`, `RTN_UNACK` rồi bật lại | 12 |
    | `shelve-*` | shelve/unshelve, hết hạn khi còn đúng/hết, SHELVE_RANGE, tối đa 50, disable/enable, disable giữ qua `reload` | 8 |
    | `chatter-*` | 5 lần trong 60 s thì cách ly, không đủ thì không, cách ly hết hạn, `chatterLimit` 0, unshelve sớm, tổng kết | 6 |
    | `restart-*` | khởi động lại khi `ACTIVE_UNACK`, `ACTIVE_ACK` (từ ảnh chụp), `RTN_UNACK`, điều kiện đã sai thì hết sau trễ tắt, Tag chưa tin cậy, lần xảy ra `startup`, ack bị mất commit (ảnh chụp cũ hơn) | 7 |
    | `config-*` | xóa alarm (đóng `config`), đổi ngưỡng (dấu vân tay khác, đóng), đổi lớp/nội dung (giữ), alarm mới, đổi loại, đổi Tag | 6 |
    | `text-*` | `{value:N}` làm tròn nửa ra xa 0, BOOL `Bật`/`Tắt`, bảng giá trị, thẻ hết, cắt 200 ký tự có `…`, `{reason}` rỗng, Unicode | 8 |
    | `clock-*` | `clockOk=false`, giờ nhảy lùi (thứ tự theo `occurrence`) | 3 |

    Tổng dự kiến 80 ca (≥ 60 theo FR-016); mỗi mã lỗi của bảng ISA có ít nhất một ca.
  - **Kiểm tương đương:** CI chạy cùng thư mục ở GoogleTest và Vitest; một ca lệch ở bản nào là đỏ (SC-004). Số làm tròn và định dạng giá trị đi qua đúng hàm của từng bản, vector có ca biên (0,5; 1,5; −0,5; 1e-7).
  - **Vector cho validator** là tập riêng `tests/project-vectors/` (`v05-*`) và `tests/widget-catalog-vectors/`.
- **Lý do:** Constitution II đòi logic dùng chung có kiểm tương đương; Studio cần "Thử alarm" không phụ thuộc thiết bị (D36); mô hình biểu thức ADR-015 đã chứng minh cách này chạy.
- **Phương án khác đã xét:**
  - **Biên dịch C++ sang WASM cho Studio:** thêm chuỗi công cụ, kích thước tải, build Tauri phức tạp; loại (như ADR-015).
  - **Chỉ bản TS, runtime nhúng Node:** vượt ngân sách RSS BL335. Loại.
  - **Sinh mã từ một đặc tả:** đặc tả thành ngôn ngữ thứ ba; loại.

## R7. Vị trí động cơ trên vòng tick và cách đọc TagStore

- **Quyết định (D30):**
  - Động cơ chạy **trên luồng tick, ngay sau `TagEngine::step`**, trước `hub.tick()`: thứ tự "Tag cập nhật, rồi đánh giá, rồi đẩy" (`server/runtime_engine.cpp`, `server/main.cpp`). Không luồng riêng cho động cơ.
  - Mỗi tick một lần `TagStore::snapshot(indices, out)` với tập chỉ số đã dựng khi nạp project (hợp mọi Tag mà alarm tham chiếu, kể cả Tag của thiết bị cho `device`), vào bộ đệm có sẵn (không cấp phát khi tick rỗng). Mutex của `TagStore` chỉ giữ trong lần `snapshot`.
  - `AlarmEngine::step(nowMonoMs, nowEpochMs, tags)` trả danh sách chuyển trạng thái vào một vector dùng lại; **keo** (`server/alarm_glue.*`) đẩy: (a) vào hàng đợi ghi `alarm_store` (luồng ghi riêng), (b) vào hàng đợi cho `LiveHub` (R13), (c) cập nhật bộ đếm `system/info`.
  - **Lệnh từ người dùng** (ack, shelve...) đi qua REST thread: `alarm_service` kiểm quyền, **ghi audit FULL (đồng bộ, trên thread REST)**, rồi đẩy lệnh vào hàng đợi lệnh của engine (MPSC, trơn); luồng tick rút lệnh ở đầu `step` và trả kết quả qua `std::promise`/ô kết quả; REST chờ ≤ 1 tick + biên (500 ms). Một luồng áp dụng nên không có đường đua dữ liệu (Edge Cases).
  - `alarm_service` còn lo nạp project (so định nghĩa, R11) và dựng lại từ `alarm.db` lúc khởi động.
  - Ngân sách tick: 500 instance × (một so sánh, hai nhánh trễ) ≈ vài nghìn lệnh; ước tính 0,05 đến 0,3 ms trên Cortex-A7 (chưa đo); mục tiêu FR-021 ≤ 2 ms; spike đo trên x64 rồi BL335 (R22).
- **Lý do:** cùng luồng nên thứ tự rõ, không thêm khóa; 200 instance × vài phép so mỗi 250 ms là không đáng kể; audit FULL chạy ở thread REST không chặn tick (một lệnh fsync eMMC ~ vài chục ms).
- **Phương án khác đã xét:**
  - **Luồng riêng cho engine với hàng đợi Tag:** thêm hàng đợi, nhân đôi bộ nhớ Tag, thứ tự khó chứng minh. Loại.
  - **Engine nằm trong `TagEngine::step`:** làm bẩn Tag Engine bằng logic alarm; khó test riêng. Loại.
  - **Đánh giá theo sự kiện đổi Tag (không theo tick):** trễ bật/tắt cần tick đều đặn; vẫn phải có tick. Loại.
  - **Audit trên luồng tick:** fsync chặn tick. Loại.

## R8. `alarm.db`, độ bền và hướng mất mát an toàn khi mất điện

- **Quyết định (D12, D13, D14, D37):**
  - **File riêng** `<dataDir>/alarm.db`, WAL, `synchronous=NORMAL`, `cache_size = -2048` (2 MiB), `journal_size_limit = 8 MiB`, `wal_autocheckpoint = 1000` trang mặc định, `page_size = 4096` mặc định, quyền `0600`. **Không xin ngoại lệ Constitution thứ ba.**
  - Bảng: `alarm_occurrence` (một dòng một lần xảy ra, cập nhật tại chỗ), `alarm_override` (shelve, disable bền), `alarm_meta` (`schema`, `clean_shutdown`, `last_sequence`); chỉ mục (R9); `alarm_meta.schema` số nguyên cho migration nội bộ (D37).
  - **Dấu tắt sạch:** khi mở, đọc `clean_shutdown`; nếu = 0 (lần trước chết không sạch) thì chạy `PRAGMA quick_check` trước khi dùng; ghi `clean_shutdown=0` ngay sau khi mở, đặt `=1` khi dừng bình thường (SIGTERM). Kiểm `integrity_check` đầy đủ chỉ khi `quick_check` lỗi. Lỗi thì đổi tên `alarm.db.corrupt-<epoch>`, tạo mới, audit `alarm.purged` (cùng cách `history.db`).
  - **Thứ tự bắt buộc của hành động người dùng** (xác nhận làm mẫu):
    1. thread REST kiểm quyền (role, CSRF, Origin);
    2. **`AuditLog::append(alarm.ack)`** commit `synchronous=FULL` (fsync trước khi trả); lỗi thì 503 `AUDIT_UNAVAILABLE`, dừng, không đổi gì;
    3. đẩy lệnh vào engine; tick sau engine áp dụng vào RAM;
    4. engine phát chuyển trạng thái: đẩy vào hàng đợi live (người dùng thấy gần như ngay) và hàng đợi ghi `alarm.db`;
    5. luồng ghi commit `alarm.db` trong ≤ `alarmCommitMs` (2 s) hoặc 200 thay đổi;
    6. REST trả 200 cho client sau bước 3 (không chờ bước 5).
  - **Phân tích từng thời điểm cắt điện** (đồng thời là kế hoạch test R24):

    | # | Cắt điện ở thời điểm | `audit.db` sau bật lại | `alarm.db` sau bật lại | Trạng thái hiển thị | Hướng |
    |---|---|---|---|---|---|
    | 1 | trước bước 2 commit (đang gửi lệnh, đang ghi audit) | không có dòng (transaction FULL nguyên tử: có trọn hoặc không) | nguyên như trước (UNACK) | `ACTIVE_UNACK`; người dùng chưa nhận 200, xác nhận lại | an toàn |
    | 2 | sau bước 2, trước bước 3 (audit đã bền, engine chưa áp) | có dòng `alarm.ack` | UNACK | `ACTIVE_UNACK` (audit có dòng thừa, người dùng xác nhận lại nên có thể có **hai** dòng audit cho một lần xảy ra) | an toàn (audit nhiều hơn trạng thái, không bao giờ ít hơn) |
    | 3 | sau bước 3, trước bước 5 (đã hiện ACK trên Chrome, `alarm.db` chưa commit hoặc commit còn trong bộ đệm trang của hệ điều hành) | có dòng | không có ack (mất ≤ `alarmCommitMs` + cửa sổ ghi nền của kernel) | `ACTIVE_UNACK` | an toàn |
    | 4 | sau bước 5 (commit WAL đã `write` nhưng **chưa fsync**: NORMAL) | có dòng | SQLite khôi phục tới commit hợp lệ cuối cùng trên đĩa: có thể trước hoặc sau transaction chứa ack; cả hai đều nhất quán | `ACTIVE_UNACK` hoặc `ACTIVE_ACK`; nếu `ACTIVE_ACK` thì audit **chắc chắn có** dòng (bước 2 đã fsync trước) | an toàn |
    | 5 | giữa lúc `alarm.db` đang ghi khung WAL (khung dở) | có dòng (nếu qua bước 2) | khung dở bị bỏ khi khôi phục (checksum WAL sai); file không hỏng | như dòng 3 hoặc 4 | an toàn |
    | 6 | giữa lúc checkpoint (WAL → file chính) | như trên | WAL còn nguyên đến khi checkpoint xong và được đồng bộ; khôi phục áp lại WAL; file chính không có trang rách dùng được vì checkpoint đồng bộ WAL trước khi ghi file chính | như dòng 4 | an toàn |
    | 7 | giữa lúc bật/hết của một alarm (không có người dùng): bật mất khỏi lịch sử | không liên quan | lần xảy ra mới nhất chưa commit | khởi động: đánh giá lại từ Tag; nếu còn đúng thì lần xảy ra mới `ACTIVE_UNACK` cờ `startup` | an toàn (người vận hành vẫn thấy) |
    | 8 | giữa lúc hết của alarm: dòng vẫn mở trong `alarm.db` | không liên quan | lần xảy ra mở, `ts_return` trống | khởi động: Tag đã bình thường, đánh giá lại: `cond=false` thì hết sau trễ tắt, đóng `closedBy=return` | an toàn (hiện lại một lát rồi hết) |
    | 9 | giữa lúc shelve | có dòng `alarm.shelve` (nếu qua bước 2) | `alarm_override` chưa commit | không shelve; alarm hiện bình thường | an toàn (hiện nhiều hơn là ẩn nhầm) |
    | 10 | giữa lúc disable | có dòng nếu qua bước 2 | `alarm_override` chưa commit | alarm đánh giá bình thường (chưa vô hiệu) | hướng ngược (alarm vẫn đánh giá dù kỹ sư đã ra lệnh vô hiệu): chấp nhận được nhờ đối chiếu với audit lúc khởi động (xem bên dưới) |

    **Lời giải cho dòng 10 và override nói chung (Quyết định):** audit là bản ghi chân lý của ý định; lúc khởi động `alarm_service` **đối chiếu**: với mỗi `alarm.disable`/`alarm.enable`/`alarm.shelve` gần nhất theo `target` trong `audit.db` ≤ 8 giờ (shelve) hoặc không giới hạn (disable, tra theo `target` mới nhất) mà `alarm_override` không khớp, **áp dụng theo audit** nếu audit mới hơn `alarm_override.ts` (disable giữ; shelve còn thời hạn thì áp; enable thì xóa). Chi phí: một truy vấn chỉ đọc lúc khởi động. Nhờ đó mất điện không làm mất ý định kỹ sư mà không cần `FULL` cho `alarm.db`. **Ack thì ngược:** không dựng lại ack từ audit (an toàn thì quay về chưa xác nhận); ack là ý định "đã thấy", mất nó chỉ phiền, giữ nó mà sai mới nguy hiểm.

  - **Bất biến cần chứng minh và test (SC-008):** (B1) mọi `ts_ack_ms IS NOT NULL` trong `alarm.db` có dòng `alarm.ack` ở `audit.db` được ghi trước nó (do thứ tự bước 2 → bước 5 và do audit FULL fsync xong trước khi lệnh tới engine); (B2) `alarm.db` luôn qua `PRAGMA integrity_check` (WAL: khôi phục tới commit hợp lệ); (B3) không bao giờ có `ACTIVE_ACK` hiển thị mà thiếu dòng audit. B1 áp dụng cho ack từng mục và ack hàng loạt (một dòng audit cho cả nhóm, nên đối chiếu theo `count` và danh sách rút gọn ≤ 10: test kiểm bằng `occurrence` nằm trong `[min,max]` của lệnh và thời điểm audit ≤ thời điểm ack).
  - **Cái chấp nhận mất** (D14): (a) bản ghi bật/hết trong khoảng ≤ `alarmCommitMs` cuối cộng cửa sổ ghi nền của kernel (mặc định `dirty_expire_centisecs` 3000 = 30 s, nên thực tế tới ~30 s ở NORMAL khi chưa có checkpoint) có thể mất khỏi lịch sử; (b) ack cuối quay về chưa xác nhận. Không có hướng nào tạo trạng thái sai nguy hiểm.
  - **`kill -9` khác cắt điện:** `kill -9` giữ trang đã `write` trong bộ nhớ đệm hệ điều hành, nên không thử được mất dữ liệu chưa fsync; chỉ chứng minh luồng và kỹ thuật khôi phục logic. Thử cắt điện thật cần người (≥ 10 lần, SC-008, task ⚠️🔌). Trên x64, mô phỏng bằng cách cắt cụt hoặc xáo trộn đuôi file `-wal` tại nhiều vị trí byte và chạy `integrity_check` (R24).
  - **Tăng độ tin cậy cho WAL NORMAL:** `PRAGMA wal_checkpoint(TRUNCATE)` khi dừng sạch; checkpoint thụ động mỗi lần dọn mỗi giờ; không dùng `VACUUM` tự động.
- **Lý do:** hai ngoại lệ FULL (mốc historian, `audit.db`) đã đủ; thêm ngoại lệ thứ ba phải sửa Constitution và tăng ghi eMMC; thiết kế đặt chân lý bền ở nơi đã bền (audit) và để alarm.db mất theo hướng an toàn; mọi mất mát đều làm hệ thống hiển thị **nhiều** alarm hơn thực tế, không ít hơn.
- **Phương án khác đã xét:**
  - **`alarm.db` FULL:** mỗi lần bật/hết là một fsync: ước tính (R9) tăng ghi thực và thời gian chờ eMMC (fsync ~ 5 đến 30 ms); đòi sửa Constitution. Loại (D13).
  - **Chung `audit.db` (ghi lần xảy ra vào audit):** audit là nhật ký bảo mật, 64 MiB/365 ngày; đổ dữ liệu vận hành nhiều vào làm audit bị dọn sớm và làm FULL đắt. Loại (D12).
  - **Chung `history.db`:** khác chu kỳ ghi, thời hạn, và hỏng chung mất cả lịch sử Tag. Loại (D12).
  - **Đối chiếu ack ngược từ audit khi khởi động:** audit không còn chắc có (dọn 64 MiB/365 ngày; ack hàng loạt chỉ lưu 10 id đầu); và ack giả là hướng sai. Loại.
  - **Ghi nhật ký sự kiện (4 dòng cho mỗi lần xảy ra):** nhiều ghi hơn, chỉ mục nhiều hơn (R9); loại (D20).

## R9. Ước tính ghi eMMC của alarm

**Ước tính, chưa đo; spike T006 đo trên x64 (đếm byte ghi qua `/proc/<pid>/io` và trang ghi WAL) rồi BL335.**

- **Quyết định:**
  - Tham số mô hình: kích thước dòng `alarm_occurrence` ≈ 200 B (nội dung chèn ≤ 200 ký tự thường ≈ 60 B; hơn 14 trường nhỏ ≈ 100 B); trang 4 KiB; khung WAL = 24 B + 4096 B = 4.120 B; chỉ mục (cột khóa + rowid) ≈ 20 B mỗi mục; checkpoint ghi mỗi trang bẩn **một lần** mỗi lần checkpoint (1.000 khung).
  - **Số khung WAL mỗi commit** = số trang bẩn: (1) trang lá bảng cuối (chèn và cập nhật hàng mới ở cùng trang), (2) lá cuối của chỉ mục `(ts_active_ms)`, (3) một lá của `(alarm_id, ts_active_ms)`, (4) một lá của `(priority, ts_active_ms)`, (5) một lá của chỉ mục từng phần "đang mở".
  - **Mỗi lần xảy ra, bốn sự kiện:** chèn (≈ 5 khung), xác nhận (1: chỉ trang bảng), hết (2: bảng và chỉ mục từng phần), xác nhận hết (1, chỉ khi `ackReturn`). Tổng 8 đến 9 khung nếu **mỗi sự kiện một commit** (trường hợp xấu nhất khi sự kiện thưa).
  - **Tải chuẩn** (200 alarm, 20 lần xảy ra mỗi giờ, giả định ở spec): 20 × 24 = 480 lần/ngày.
    - Mô hình **một sự kiện một commit**: 480 × 8,5 khung ≈ 4.080 khung × 4.120 B ≈ **16,8 MB/ngày** WAL; cộng checkpoint (≈ 4 lần/ngày × ≈ 30 trang bẩn × 4 KiB ≈ 0,5 MB) và siêu dữ liệu ext4 ngoài số đếm của tiến trình: **≈ 17 MB/ngày**.
    - Mô hình **tối thiểu** (mỗi commit chỉ một khung, bỏ qua chỉ mục): 480 × 4 sự kiện × 4.120 B ≈ **7,9 MB/ngày**.
    - Mô hình **có gộp thực tế** (sự kiện chùm: H và HH cùng lúc, xác nhận hàng loạt, cửa sổ 2 s gộp một vài): giữa hai mô hình trên; **thường ước 8 đến 12 MB/ngày**.
    - **Kết luận:** mục tiêu ban đầu của spec (≤ 10 MB/ngày) **ở mức biên**; spec đã nới thành ≤ 25 MB/ngày (D43, SC-009), không chắc chắn đạt ở mô hình xấu nhất (≈ 17 MB). So với trần 2 GB/ngày của Constitution III là 0,4 đến 0,9 %: **không phải rủi ro ngân sách**, chỉ là rủi ro con số nghiệm thu. Biện pháp theo thứ tự nếu spike cho > 10 MB/ngày (ghi trong plan, quyết định ở T006): (1) bỏ chỉ mục `(priority, ts_active_ms)` (lọc ưu tiên trong khoảng thời gian bằng cách quét theo chỉ mục thời gian; 100.000 hàng vẫn đạt SC-013 theo ước tính), còn 7 khung; (2) bỏ chỉ mục `(alarm_id, ts_active_ms)` còn 6 khung (lọc theo alarm trong khoảng thời gian cũng dùng chỉ mục thời gian); (3) nâng nghiệm thu SC-009 chuẩn lên ≤ 25 MB/ngày (ghi "Điểm cần sửa spec").
  - **Tải bão** (200 alarm chập chờn 20 lần/phút liên tục, tự cách ly sau `chatterLimit` = 5, cách ly theo phương án ban đầu có chu kỳ ≈ 10,25 phút; D43 đổi mặc định thành 30 phút nên các số dưới đây là cận trên, thực tế thấp hơn khoảng ba lần): mỗi alarm mỗi chu kỳ ≈ 10,25 phút ghi 5 lần xảy ra (mỗi lần: chèn + hết) và một dòng tổng kết: ≈ 6 hàng và ≈ 11 sự kiện; 200 alarm tức 140 chu kỳ/ngày × 200 alarm × 11 sự kiện ≈ **308.000 sự kiện/ngày ≈ 3,6 sự kiện/giây**.
    - **Không điều chỉnh** (commit mỗi 2 s, pha chập chờn phân tán đều nên gần như mọi cửa sổ có việc): 43.200 commit/ngày; mỗi commit ≈ 7 sự kiện chạm ≈ 18 đến 25 trang (chỉ mục `(alarm_id, ts)` chạm nhiều lá khác nhau) ≈ 90 KiB: **≈ 3,8 GB/ngày**, gấp 38 lần nghiệm thu (0,1 GB/ngày). Không dùng được.
    - **Điều chỉnh thích ứng (Quyết định):** khi bộ đệm ghi có ≥ 100 thay đổi giữa hai commit (dấu hiệu bão), luồng ghi **giãn cửa sổ commit** gấp đôi mỗi lần tới tối đa `alarmCommitMaxMs` (mặc định 30.000 ms), trở về 2.000 khi bộ đệm dưới 20; trạng thái và hiển thị không phụ thuộc cửa sổ (chỉ lịch sử chậm hơn); tăng nguy cơ mất lịch sử khi cắt điện lên tối đa 30 s (D14a vẫn đúng hướng). Cộng bỏ hai chỉ mục phụ (biện pháp 1, 2): 30 s → 2.880 commit/ngày, mỗi commit ≈ 100 sự kiện ≈ 50 hàng ≈ 10 KiB dữ liệu bảng ≈ 3 trang + 1 lá chỉ mục thời gian + 2 lá chỉ mục "đang mở" ≈ 6 trang ≈ 24,7 KiB: **≈ 71 MB/ngày WAL**; checkpoint ≈ 42 MB/ngày dữ liệu bảng+chỉ mục (168.000 hàng × 250 B): **≈ 0,11 GB/ngày** tổng, sát 0,1 GB.
    - **Thêm biện pháp 4 (đã chọn, D43, FR-035):** thời gian tự cách ly chập chờn mặc định là 30 phút (giảm chu kỳ ≈ 3 lần so với phương án ngắn hơn đã xét ban đầu): **≈ 0,04 GB/ngày**. Đã xử lý trong spec (D43, FR-035).
    - Tổng: bão kéo dài cả ngày là kịch bản cực đoan (nguyên nhân thật của bão thường xử lý trong giờ); nhưng nghiệm thu đòi nên giữ biện pháp 1, 2, 3, 4.
  - **Hàng đợi bộ đệm trong bão:** 3,6 sự kiện/giây × 30 s ≈ 110 thay đổi ≪ trần 5.000: dư dả.
- **Lý do:** con số lịch sử alarm là số nhỏ so với 2 GB/ngày của Tag; rủi ro thật là bão và mô hình "mỗi sự kiện một commit" làm đắt; xử lý ở nguồn (tự cách ly), ở lô (cửa sổ thích ứng) và ở số chỉ mục.
- **Phương án khác đã xét:**
  - **Chỉ ghi khi hết (một dòng một commit khi đóng):** mất lần xảy ra đang mở khi mất điện (không có gì để dựng lại ngoài điều kiện Tag, D14a vẫn ổn) nhưng không có "đang mở" bền và người dùng không thấy lịch sử alarm chưa hết. Loại.
  - **`journal_mode=MEMORY` hay `synchronous=OFF`:** hỏng DB khi mất điện. Loại.
  - **Giãn cửa sổ cố định 30 s mọi lúc:** mất tới 30 s lịch sử ở tải thường. Loại; thích ứng chỉ khi bão.

## R10. Thời hạn lưu và trần dung lượng

- **Quyết định:**
  - `alarmRetentionDays` mặc định 180 (1 đến 3.650), `alarmMaxBytes` mặc định 64 MiB. Dọn mỗi giờ một lượt, xóa **chỉ lần xảy ra đã đóng** (`ts_return_ms` không rỗng và đã xác nhận hết nếu cần, hoặc `closed_by` khác rỗng), theo mẻ ≤ 1.000 dòng (mỗi mẻ một transaction), từ cũ nhất; lần xảy ra đang mở không bao giờ bị xóa. Vượt trần thì chạy dọn ngay (không chờ giờ) cho tới khi dưới 95 % trần.
  - Đồng hồ không hợp lệ (`clockOk=false` hoặc năm < 2024 như `audit.db`) thì **không** xóa theo thời hạn (xóa theo trần vẫn chạy, theo `id` tăng dần).
  - Ghi audit `alarm.purged` (hệ thống, `count`, lý do `retention`/`size`), gộp 60 s.
  - **Số liệu dung lượng:** 180 ngày × 480 lần/ngày = 86.400 lần xảy ra tải chuẩn; dòng ≈ 200 B + chỉ mục ≈ 3 × 20 B ≈ 260 B/lần ≈ 22 MB (dưới trần 64 MiB). 100.000 lần xảy ra (kích thước thử SC-013) ≈ 26 MB. Trần 64 MiB giữ ≈ 250.000 lần xảy ra. Cộng khoảng trống chưa tái dùng sau xóa (`auto_vacuum=INCREMENTAL`? Không; SQLite tái dùng trang trống cho dòng mới; kích thước file không thu nhỏ, chấp nhận) nên `alarmMaxBytes` tính theo kích thước file, vượt thì dọn dựa theo số trang trống: file không vượt quá trần + 5 % (SC-010).
  - **Dọn không chặn tick:** chạy trên luồng ghi, mẻ nhỏ; mỗi mẻ ≈ vài ms; ước: 1.000 dòng xóa ≈ 5 đến 15 ms trên eMMC (chưa đo; spike đo).
  - Không dùng `VACUUM` tự động (tạm 2 lần dung lượng, giữ khóa dài).
- **Lý do:** cùng cách `audit.db` (trần và ngày, đồng hồ không hợp lệ không xóa) đã được chứng minh; xóa theo mẻ nhỏ cho độ trễ nhỏ.
- **Phương án khác đã xét:**
  - **Chỉ theo ngày:** bão làm đầy đĩa trong ngày. Loại.
  - **Chỉ theo trần:** người dùng không giữ được "6 tháng". Loại.
  - **Ghi vòng (ring buffer) cố định:** SQLite không có, tự viết thêm; loại.

## R11. Khởi động lại và đối chiếu

- **Quyết định (D17, FR-022, FR-023):**
  - Khởi động: (1) mở `alarm.db` (R8), (2) nạp project, dựng `AlarmDefs` (instance, dấu vân tay), (3) đọc lần xảy ra mở từ chỉ mục từng phần (`closed_by IS NULL AND ts_return_ms IS NULL`... và cả `RTN_UNACK` chưa xác nhận hết), dựng `AlarmEngine` ở trạng thái đã commit (`ACTIVE_UNACK`, `ACTIVE_ACK`, `RTN_UNACK`) kèm `occurrence`, (4) đối chiếu override với audit (R8), (5) **chờ Tag có giá trị tin cậy**: instance giữ nguyên trạng thái cho tới khi Tag của nó có chất lượng không-BAD đầu tiên (hoặc, với `quality`, theo quality thật), (6) đánh giá: nếu `cond` còn đúng thì giữ lần xảy ra, **không** chạy lại trễ bật; nếu `cond` sai thì chạy trễ tắt từ lúc khởi động; (7) instance không có lần xảy ra mở mà `cond` đúng thì chạy trễ bật rồi lần xảy ra mới có cờ `startup`.
  - Lần xảy ra mở của alarm đã bị xóa hoặc đổi dấu vân tay trong lúc tắt máy: đóng `closed_by=config`; không tìm được ánh xạ (hỏng): `restart-lost`.
  - **Nạp project mới khi chạy** (FR-023): so theo `id` instance và dấu vân tay: giống thì giữ nguyên trạng thái và bộ đếm trễ, cập nhật lớp/nội dung/khu vực cho hiển thị tiếp theo; khác hoặc bị xóa thì đóng với `closedBy=config`; mới thì từ đầu. Việc này nằm trong `alarm_service`, chạy trên luồng tick khi `ActivationSwap` (cùng điểm nạp của Tag Engine).
  - **Kiểu đúng hạn nhất khi khởi động:** đánh giá lại **sau** khi Tag Engine có dữ liệu thật, nên chuỗi "chờ Tag tin cậy" tránh báo hết giả lúc các driver chưa kết nối.
  - Mục tiêu: alarm còn đúng điều kiện hiện lại ≤ 5 s sau khi runtime khởi động xong (SC-008); vì lần xảy ra mở dựng lại từ DB nên hiện ngay khi `alarmSnapshot` đầu tiên, không chờ Tag.
- **Lý do:** người vận hành không bị báo lại vô ích sau khởi động lại; trạng thái hiển thị đúng ngay; không báo hết giả khi driver chưa lên.
- **Phương án khác đã xét:**
  - **Xóa mọi lần xảy ra mở khi khởi động rồi tính lại:** mất lịch sử "đã xác nhận", người vận hành bị báo lại. Loại.
  - **Giữ lần xảy ra mở bất kể điều kiện:** alarm hết trong lúc tắt máy vẫn đỏ mãi. Loại (đã có trễ tắt).

## R12. Chập chờn (chattering) và bão alarm

- **Quyết định (D15, FR-035):**
  - Mỗi instance giữ vòng đệm tối đa `chatterLimit` mốc `nowMono` của các lần **bật** trong 60 s (cửa sổ `alarmChatterWindowS`, mặc định 60 s). Lần bật thứ `chatterLimit` (mặc định 5) trong cửa sổ thì engine **tự cách ly**: shelve hệ thống 30 phút (`alarmChatterShelveS`, mặc định 1800), lý do "chập chờn", audit `alarm.shelve` do `system` (gộp 60 s), đóng lần xảy ra đang mở (`closedBy=return`) và ghi **một dòng tổng kết** vào lịch sử (FR-036: `closedBy` có thêm giá trị `chatter` cho dòng tổng kết; `text` = "Chập chờn: 5 lần trong 60 s", giá trị lần bật cuối).
  - Trong lúc cách ly: tiếp tục đánh giá nhưng **không** ghi lần xảy ra, không live, không tiếng (chỉ cập nhật bộ đếm số lần bật trong cách ly để dòng tổng kết).
  - Hết hạn (đồng hồ đơn điệu) hoặc `unshelve` sớm: bộ đếm chập chờn bắt đầu lại; nếu `cond` còn đúng thì thành `ACTIVE_UNACK` mới (D11). Lần cách ly kế tiếp lại ghi một dòng tổng kết.
  - `chatterLimit = 0` tắt cơ chế (cảnh báo `W_ALARM_CHATTER_RISK` khi analog có deadband 0 và hai trễ 0).
  - **Số liệu bão chuẩn:** 200 alarm dao động 20 lần/phút. Không có cơ chế: 20 lần bật + 20 lần hết = 40 sự kiện/phút/alarm × 200 = 8.000 sự kiện/phút = 133 sự kiện/s: **11,5 triệu sự kiện/ngày**: không thể ghi và không thể hiển thị. Có cơ chế: mỗi alarm chỉ 5 lần xảy ra (10 sự kiện) và 1 dòng tổng kết mỗi chu kỳ cách ly (R9): **0,5 sự kiện/s toàn hệ thống trung bình** (3,6/s tính cả pha cách ly tới 30 phút); giảm ≥ 37 lần. SC-019: DB nhận đúng `chatterLimit` dòng mỗi chu kỳ 30 phút cho một alarm.
  - **Live trong bão:** 200 alarm cùng bật trong một tick = một `alarmDelta` ≈ 200 × 350 B ≈ 70 KB cho mỗi client (nhỏ hơn 256 KB/phiên, R13, R22).
  - **Hai dòng phòng thủ nữa:** (1) tối đa 50 alarm shelved cùng lúc áp cho shelve người dùng; tự cách ly **không** tính vào 50 (nếu tính, bão làm người dùng hết quota) nhưng tính vào trần 500 instance; (2) chặn tổng: tốc độ sự kiện toàn engine đo bằng vòng đệm; nếu > 50 lần xảy ra mới/giây kéo dài 10 s thì nâng cờ `system/info.alarms.storm=true` (chỉ báo, không đổi hành vi).
- **Lý do:** nguyên nhân bão thường là ít alarm chập chờn; xử lý ở nguồn giữ cả màn hình lẫn eMMC; theo khuyến nghị ISA-18.2 và EEMUA 191 về chattering.
- **Phương án khác đã xét:**
  - **Giới hạn tốc độ ghi toàn cục:** mất sự kiện thật của alarm tốt khi có một alarm xấu. Loại (D15).
  - **Tự gộp "N lần trong 1 phút" thành một dòng mà vẫn hiện:** hiển thị gây nhầm (đỏ liên tục). Loại.
  - **Lọc ở Tag (làm mịn):** là chức năng của Tag tính toán; không thay được cách ly.

## R13. Giao thức live 1.3.0

- **Quyết định (D18, FR-045 đến FR-049, FR-052):**
  - **Đăng ký riêng.** Client gửi `{"type":"subscribeAlarms"}` (tùy chọn `"filter":{"areas":[…]}`? Không: lọc ở client; YAGNI) và `{"type":"unsubscribeAlarms"}`. Server trả `alarmSnapshot` rồi `alarmDelta`. `hello` thêm `"features":["alarms"]` khi project có alarm (và `liveVersion` 1.3.0).
  - **Bản tin mẫu:**

    ```json
    {"type":"hello","protocol":"1.3.0","session":"…","features":["alarms"]}

    {"type":"subscribeAlarms"}

    {"type":"alarmSnapshot","sequence":41,
     "counts":{"unack":2,"active":3,"shelved":1,"byPriority":{"critical":1,"major":1,"minor":0,"advisory":0}},
     "classes":[{"id":"critical","name":"Khẩn cấp","priority":"critical","color":"red","blink":true,
                 "requiresAck":true,"ackReturn":false,"sound":"siren"}],
     "areas":[{"id":"bon","name":"Bồn"}],
     "items":[{"id":"TANK_B1_LEVEL.HH","occurrence":1823,"state":"ACTIVE_UNACK","class":"critical",
               "area":"bon","name":"Bồn B1 mức rất cao","text":"Bồn B1 mức rất cao: 91,2 % (ngưỡng 90)",
               "tsActive":1760352000123,"clockOk":true,"valueActive":91.2,"tsAck":null,"ackUser":null,
               "tsReturn":null,"shelved":false,"shelvedUntil":null,"inputBad":false,"startup":false}]}

    {"type":"alarmDelta","sequence":42,
     "counts":{"unack":1,"active":3,"shelved":1,"byPriority":{…}},
     "changed":[{"id":"TANK_B1_LEVEL.HH","occurrence":1823,"state":"ACTIVE_ACK","tsAck":1760352060456,"ackUser":"vanhanh1"}],
     "removed":["TANK_B1_LEVEL.H"]}
    ```

    Quy ước: `changed` mang **toàn bộ** hàng mới nhất của instance (đơn giản cho client: thay hàng theo `id`); `removed` là id biến mất khỏi danh sách "không NORMAL và không shelved" (về `NORMAL`, hoặc đóng). Mỗi hàng ≈ 350 B (ước: 14 trường, tên và nội dung tiếng Việt ≈ 100 B): 200 hàng ≈ 70 KB, **dưới 256 KB** của hàng đợi phiên; snapshot 500 instance ≈ 175 KB cũng dưới 256 KB nhưng dùng > 50 % hàng đợi: server chia `alarmSnapshot` thành nhiều bản tin ≥ ... **Quyết định:** snapshot chia lô ≤ 100 hàng (bản tin có `"part":i,"parts":n`), client ghép rồi mới áp dụng.
  - **`sequence`** riêng mỗi phiên, tăng 1 mỗi `alarmDelta`; đứt thì client gửi lại `subscribeAlarms` (xin snapshot mới); server cũng có thể gửi `resync_required` (có sẵn).
  - **Dồn khi hàng đợi gần đầy:** hàng đợi **riêng** cho alarm trong phiên là bản đồ `id → hàng mới nhất` cộng `removed`; khi hàng đợi gửi của phiên vượt 50 % (128 KB), các delta chưa gửi **gộp** thành một delta với `sequence` mới (bản mới nhất thắng); vẫn đầy (> 90 %) thì cơ chế 4409 hiện có. Hàng đợi alarm không bao giờ bỏ thay đổi trạng thái, chỉ gộp: trạng thái cuối luôn đến nơi.
  - **Hàng đợi từ engine sang hub** (FR-052): MPSC không khóa, kích thước cố định 4.096 sự kiện; engine đẩy `std::memcpy` nhỏ, hub rút ở luồng của hub; đầy (không xảy ra ở tải thiết kế) thì engine đặt cờ `needResync`; hub gửi lại `alarmSnapshot` cho mọi phiên đăng ký. Hub không giữ khóa Tag khi gửi.
  - **Quyền:** ai đọc được live thì nhận alarm (ADR-018: viewer trong mạng riêng). **Không có `ack` trên WebSocket**: bản tin `ack` nhận `error` `BAD_MESSAGE`, audit `alarm.ack` kết quả `denied` với `LIVE_ACK_NOT_ALLOWED` (gộp 60 s, như `LIVE_WRITE_NOT_ALLOWED`).
  - **Tương thích:** client 1.2.0 không gửi `subscribeAlarms` nên không nhận gì; `hello` có thêm trường `features` mà client 1.2.0 bỏ qua (kiểm bằng vector tương thích). Client 1.3.0 gặp `hello` không có `features.alarms` hiện "chưa hỗ trợ". `subscribeAlarms` lần hai trên cùng phiên thay đăng ký và nhận snapshot mới. `schemas/protocol-version.json` đặt `live` = 1.3.0.
  - **Thời gian:** `alarmDelta` gửi trong ≤ 1 tick sau thay đổi (trong cùng lượt `hub.tick()` sau `AlarmEngine::step`).
- **Lý do:** đăng ký riêng cho tương thích ngược sạch; `sequence` riêng không ảnh hưởng Tag; toàn bộ hàng (không vá từng trường) đơn giản hơn nhiều cho client và số byte vẫn nhỏ; dồn theo `id` chỉ giữ trạng thái cuối.
- **Phương án khác đã xét:**
  - **Trộn alarm vào `delta` của Tag:** client cũ nhận trường lạ, `sequence` chung gây resync Tag vì chuyện alarm. Loại.
  - **Vá từng trường (JSON patch):** logic client phức tạp, khó dồn. Loại.
  - **Server-Sent Events riêng:** thêm kết nối (vi phạm tinh thần Constitution IV 10 phiên). Loại.
  - **Xác nhận qua WebSocket:** hai đường kiểm quyền (D18, D31). Loại.

## R14. REST, quyền và kết quả theo mục

- **Quyết định (FR-050, FR-051, FR-053, FR-054, FR-091):**
  - Bảng quyền `core/auth/roles.cpp` thêm bảy hàng:

    | Endpoint | Phương thức | `minRole` | `cookieAllowed` | `changesDevice` | Ghi chú |
    |---|---|---|---|---|---|
    | `/api/v1/alarms` | GET | viewer | có | không | theo luật nguồn của ADR-018 |
    | `/api/v1/alarms/history` | GET | viewer | có | không | như trên |
    | `/api/v1/alarms/ack` | POST | operator | có (CSRF, `Origin`) | không | |
    | `/api/v1/alarms/shelve` | POST | operator | có (CSRF, `Origin`) | không | |
    | `/api/v1/alarms/unshelve` | POST | operator | có (CSRF, `Origin`) | không | |
    | `/api/v1/alarms/disable` | POST | engineer | **không** | không | chỉ Bearer |
    | `/api/v1/alarms/enable` | POST | engineer | **không** | không | chỉ Bearer |

  - **`POST ack`**: `{"items":[{"id":"TANK_B1_LEVEL.HH","occurrence":1823}]}` hoặc `{"all":true,"upToRevision":42,"filter":{"area":"bon","class":null,"priority":"minor","state":"unack","q":null}}`. Phản hồi 200: `{"results":[{"id":…,"occurrence":…,"result":"ACKED"}],"summary":{"acked":1,"already":0,"notActive":0,"stale":0,"shelved":0,"notFound":0}}`. Kết quả theo mục: `ACKED`, `ALREADY_ACKED`, `NOT_ACTIVE`, `STALE`, `SHELVED`, `NOT_FOUND`; mỗi mục không gây lỗi HTTP (idempotent). Tối đa 500 mục mỗi lệnh.
  - **`all:true` + `upToRevision`**: xác nhận mọi instance thỏa `filter` **và** có `rev ≤ upToRevision` (alarm bật sau mốc `sequence` mà người dùng nhìn thấy không bị xác nhận oan, D19). `rev` giữ trong RAM của engine theo instance (tăng theo bộ đếm chung mỗi lần chuyển trạng thái).
  - **Thứ tự lệnh** (R8): kiểm quyền → xác thực dữ liệu vào (kích thước, trường) → **audit FULL** → hàng đợi lệnh engine → kết quả → 200. Audit lỗi → 503 `AUDIT_UNAVAILABLE`, không đổi trạng thái.
  - **`shelve`**: `{"id":…,"reason":"Cảm biến đang hiệu chuẩn","durationS":3600}`; `reason` 1 đến 120 ký tự, `durationS` 60 đến 28.800, ngoài khoảng, rỗng hay vượt 50 shelved: `SHELVE_RANGE`; id lạ: 404 `ALARM_NOT_FOUND`. **`unshelve`**: `{"id":…}`. **`disable`/`enable`**: `{"id":…,"reason":…}` (`reason` bắt buộc cho `disable`, tùy chọn cho `enable`); disable áp cho **định nghĩa** (mọi instance của alarm `limit` hoặc một instance `<id>.<ngưỡng>` tùy `id` đưa vào).
  - **`GET alarms/history`** (R17): `from`, `to`, `alarmId`, `area`, `class`, `priority`, `state`, `q`, `limit` (≤ 500), `beforeId`; trả `{"items":[…],"nextBeforeId":…,"truncated":false}`; sai tham số: 400 `BAD_QUERY`; 429 theo giới hạn tần suất truy vấn lịch sử của ADR-018 nếu có.
  - **`system/info`** thêm khối `alarms`: `{instances, active, unack, shelved, logState, droppedChanges, dbBytes, tickMaxUs1m, storm}`; `/api/v1/diagnostics` giữ nguyên.
  - Lỗi: `AUDIT_UNAVAILABLE` (503), `SHELVE_RANGE` (400), `BAD_QUERY` (400), `ALARM_NOT_FOUND` (404), 401/403 theo `AuthGate`; 429 cho tấn công đếm gộp.
- **Lý do:** mọi hành động đổi trạng thái qua một đường REST với kiểm quyền backend (Constitution V); cookie được cho thao tác của người vận hành (như `tags/write`) nhưng không cho `disable`/`enable` là thao tác kỹ sư, chỉ Bearer; kết quả theo mục nên hai người bấm cùng lúc không có lỗi.
- **Phương án khác đã xét:**
  - **Một endpoint `POST /alarms/action {type:…}`:** bảng quyền theo đường dẫn khó khai. Loại.
  - **`PUT`/`DELETE` kiểu REST:** không thêm giá trị, bảng quyền hiện có theo phương thức + đường dẫn cũng chạy được; chọn `POST` động từ cho rõ nghĩa.
  - **Lọc xác nhận hàng loạt chỉ theo danh sách id:** danh sách dài; bộ lọc + `upToRevision` gọn và an toàn hơn.

## R15. Audit

- **Quyết định (FR-029, FR-088 đến FR-090):**
  - Thêm sáu hành động: `alarm.ack`, `alarm.shelve`, `alarm.unshelve`, `alarm.disable`, `alarm.enable`, `alarm.purged` (27 → 33): đổi `std::array<…,27>` thành 33, thêm `auditActionName` và quyết định `auditLimited`. Không đổi lược đồ (cột `action` không CHECK); kiểm test nhóm hành động.
  - Trường: `action`, `actor` (người; `system` cho tự cách ly, tự hết hạn, dọn), `role`, `channel` (`web`, `https`, `system`), `target` (id alarm; với ack hàng loạt là chuỗi bộ lọc), `result` (`ok`, `denied`, `failed`), `detail` JSON ≤ 1 KiB.
  - **Chi tiết mẫu:** ack từng mục: `{"occurrence":1823,"result":"ACKED"}`; ack hàng loạt: `{"count":7,"ids":["…" (tối đa 10)],"upToRevision":42}`; shelve: `{"occurrence":1823,"durationS":3600,"reason":"…"}` (`reason` cắt 120); chập chờn: `{"reason":"chattering","count":5,"windowS":60}`; purged: `{"count":1000,"reason":"retention"}`.
  - **Gộp (`auditLimited`):** `alarm.ack` bị từ chối (denied), tự cách ly và tự hết hạn của `system`, `alarm.purged`: tối đa 10 dòng/phút theo cơ chế 60 s hiện có. Hành động `ok` của người dùng (ack, shelve, disable) **không** bị gộp (mỗi hành động là bằng chứng).
  - **Ngân sách audit:** 64 MiB/365 ngày giữ; ước ≈ 300 B/dòng; xác nhận 100 lần/ngày ≈ 30 KB/ngày; bão chập chờn sinh `system` gộp ≤ 10 dòng/phút ≈ 14.400 dòng/ngày ≈ 4 MB/ngày: còn chấp nhận nhưng đáng kể; giảm thiểu: tự cách ly **không** ghi lại mỗi chu kỳ sau lần đầu trong 1 giờ (chỉ cập nhật tổng kết); ghi một dòng `alarm.shelve` đầu và một dòng khi hết "chattering liên tục n chu kỳ" mỗi giờ. Chưa đo.
  - **Ack hàng loạt:** một dòng (FR-029).
- **Lý do:** audit là chân lý bền (R8); gộp có sẵn bảo vệ khỏi tấn công và bão; thêm hành động không đổi lược đồ.
- **Phương án khác đã xét:**
  - **Một dòng audit mỗi alarm khi ack hàng loạt:** 200 dòng cho một cú bấm, phá ngân sách. Loại.
  - **Tách audit alarm sang file khác:** mất tính "một nơi tra cứu hành động của con người". Loại.

## R16. Trang web: banner, trang Alarm, tiếng, nhấp nháy

- **Quyết định (D23 đến D26, FR-055 đến FR-067):**
  - **Cấu trúc** `apps/runtime-web/src/alarm/`: `alarm-client.ts` (đăng ký live, trạng thái cục bộ, kết quả lệnh), `banner.ts`, `alarm-page.ts` (`#/alarms`), `history-page.ts` (`#/alarm-history`), `csv.ts`, `sound.ts`, `badge.ts`; thành phần bảng dùng chung với widget ở `@mat/ui-components` (`alarm-table.ts`).
  - **Banner:** dải đầu trang mọi màn hình, `role="alert"` cho alarm mới ưu tiên cao (`aria-live="assertive"` chỉ khi mức `critical`, còn lại `polite`); nội dung "Khẩn cấp · … · 2 chưa xác nhận" lấy từ `textContent`; chọn alarm: ưu tiên cao nhất rồi mới nhất; bấm mở `#/alarms`; nút Xác nhận chỉ cho alarm đang hiện.
  - **Trang Alarm:** bảng ảo hóa nhẹ (≤ 500 hàng, dựng tối đa một lần mỗi khung hình bằng `requestAnimationFrame`, so khớp theo `id` instance, không dựng lại toàn bảng, FR-066); tab "Đang có" và "Tạm ẩn"; lọc khu vực, lớp, mức ưu tiên, trạng thái, chữ tìm; sắp xếp mọi cột (mặc định ưu tiên rồi `tsActive` giảm dần); chọn nhiều; Xác nhận; Xác nhận tất cả (theo bộ lọc, `upToRevision` = `sequence` của snapshot đang hiển thị); Tạm ẩn (hộp có lý do và thời lượng).
  - **Huy hiệu menu và tiêu đề tab:** số chưa xác nhận (không tính shelved) từ `counts.unack`; màu theo mức ưu tiên cao nhất chưa xác nhận; `aria-label="3 alarm chưa xác nhận"`; `document.title = "(3) " + base`.
  - **Âm thanh Web Audio** (`sound.ts`): bộ dao động và `GainNode`, không tải file; `beep` (một tiếng 880 Hz 150 ms mỗi 2 s), `double` (hai tiếng liền mỗi 2 s), `siren` (quét 600 đến 1.000 Hz chu kỳ 1 s); phát lặp khi còn `ACTIVE_UNACK` của lớp đó và không phải shelved; dừng khi xác nhận hết hoặc "Tắt tiếng" (đặt cờ `silencedUntilNew` tới khi có alarm mới chưa xác nhận). Mặc định tắt; chỉ báo "Âm thanh đang tắt, bấm để bật" (Chrome cần thao tác người dùng); `AudioContext` tạo trong sự kiện nhấp; trạng thái lưu `localStorage` bọc `try/catch`.
  - **Nhấp nháy:** lớp `blink` chỉ áp trên hàng/banner `ACTIVE_UNACK`; CSS `animation` 1 chu kỳ/s (tối đa 1 Hz: 2 pha trong 1 s, an toàn dưới 3 lần/giây của WCAG 2.3.1); `@media (prefers-reduced-motion: reduce)` đổi sang viền đậm tĩnh; không dùng JS timer (tab ẩn tự giảm).
  - **Trạng thái nhìn thấy được không chỉ bằng màu:** chữ trạng thái ("Chưa xác nhận", "Đã xác nhận", "Đã hết, chưa xác nhận"), biểu tượng theo mức ưu tiên (hình khác nhau: tam giác đầy cho critical, tam giác rỗng cho major, hình tròn cho minor, chấm cho advisory), tương phản chữ ≥ 4,5:1 ở hai theme (token `--mat-alarm-*` ở `@mat/ui-components`; tám màu thiết kế D24).
  - **Mất kết nối live:** sau hết hạn nhận dữ liệu, banner "Mất kết nối tới thiết bị: danh sách alarm có thể đã cũ", bảng mờ, nút khóa; kết nối lại thì nhận `alarmSnapshot` mới và thay hoàn toàn (không giữ hàng cũ). Thiết bị không có `features.alarms`: "Thiết bị chưa hỗ trợ alarm (runtime < 0.8.0)".
  - **Project không có alarm:** không banner, không mục menu (`navigation.alarms` mặc định tự theo có alarm; `false` ẩn). Trang chạy như 0.6 (FR 1.12).
  - **Chuỗi do project cung cấp** (tên, nội dung, khu vực, lớp) chỉ vào DOM bằng `textContent` (lint `no-innerHTML` từ 007 áp cho thư mục mới). Chuỗi giao diện ở `apps/runtime-web/src/i18n/vi.ts`.
  - **Khóa nút:** viewer/khách, qua HTTP, mất kết nối, `writeBlocked`: nút khóa kèm lý do "Cần đăng nhập với role operator"; lỗi 401/403 mở hộp đăng nhập của 007 mà không mất bộ lọc.
- **Lý do:** banner và trang là phần dựng sẵn của runtime nên mọi project đều có; Web Audio không tài nguyên, kiểm DOM được; nhấp nháy bằng CSS để trình duyệt tự tối ưu và để tôn trọng giảm chuyển động.
- **Phương án khác đã xét:**
  - **Banner là widget do kỹ sư đặt trong màn hình:** quên đặt thì mất alarm. Loại (D26).
  - **File âm thanh .mp3:** bản quyền, tài nguyên tĩnh, kích thước. Loại (D23).
  - **Thông báo trình duyệt (Notification API) khi tab ẩn:** thêm xin quyền, ngoài phạm vi; tiêu đề tab `(n)` đủ.
  - **Nhấp nháy bằng JS:** tăng CPU, khó tôn trọng giảm chuyển động. Loại.

## R17. Truy vấn lịch sử và CSV

- **Quyết định (D20 đến D22, FR-044, FR-053, FR-054, FR-060, FR-061):**
  - **Lược đồ chỉ mục** (R9): `(ts_active_ms)`, `(alarm_id, ts_active_ms)`, `(priority, ts_active_ms)` (hai chỉ mục sau là phần "có thể bỏ" nếu spike cho thấy ghi quá ngân sách, R9) và một chỉ mục từng phần cho lần xảy ra đang mở.
  - **Phân trang `beforeId`:** `WHERE id < :beforeId AND ts_active_ms BETWEEN :from AND :to [AND …] ORDER BY id DESC LIMIT :limit`. `id` tăng theo thời gian bật, nên sắp theo `id` DESC cho thứ tự "mới nhất trước" mà không OFFSET (D19: thứ tự theo mã, không theo giờ treo tường). `limit` ≤ 500; `to − from` ≤ 366 ngày.
  - **Bộ lọc** `state`: `active` (chưa hết), `acked` (đã xác nhận), `closed` (đã hết hoặc đóng do cấu hình), `all`; kết hợp bằng AND; tất cả giá trị là **tham số ràng buộc**; `q` dài ≤ 80, thoát `%`, `_`, `\` rồi `LIKE ? ESCAPE '\'`.
  - **Tìm chữ không phân biệt hoa thường và dấu tiếng Việt:** cột `text_fold` được lưu sẵn (nội dung đã chuyển về chữ thường, bỏ dấu, `đ` → `d`) lúc ghi; `q` được gấp theo cùng hàm ở server (hàm `foldVi` C++ có bảng ánh xạ cố định cho Latin mở rộng và tổ hợp dấu NFC/NFD thường gặp, test với bộ ≥ 30 chuỗi tiếng Việt) rồi `LIKE '%q%'` trên `text_fold` (quét tuần tự trong khoảng thời gian đã lọc; 100.000 hàng ≈ 20 MB đọc, ước ≈ 100 đến 300 ms trên x64, ≈ 0,5 đến 1,5 s trên BL335, chưa đo; SC-013 ≤ 2 s trên BL335). Thêm cột này vào `alarm_occurrence` tốn ≈ 60 B mỗi dòng (ước ≈ 5 MB cho 86.400 hàng).
  - **Kết nối chỉ đọc riêng** (`AlarmHistory`, như `HistoryReader`): không chặn ghi hay tick; truy vấn chạy trên luồng của REST với hạn thời gian `sqlite3_progress_handler` 5 s để một truy vấn lớn không giữ luồng quá lâu. **Quyết định:** hết hạn trả 503 `ALARM_HISTORY_BUSY` (thêm vào danh mục lỗi device-api-1.3; xem "Điểm cần sửa spec" mục 5).
  - **CSV ở trình duyệt** (`csv.ts`): lấy từng trang 500 dòng theo bộ lọc, tối đa 100.000 dòng (200 trang), cho phép hủy; UTF-8 **có BOM** (`﻿`), phân cách `,`, kết thúc dòng CRLF, RFC 4180 (nháy kép gấp đôi); tiêu đề tiếng Việt; thời gian ISO 8601 có độ lệch của trình duyệt; **chống công thức:** ô bắt đầu bằng `=`, `+`, `-`, `@`, tab, CR được thêm `'` ở đầu (cả khi đã bọc nháy). Ngoại lệ duy nhất: cột "Giá trị lúc bật" sinh từ số của Tag (không phải chuỗi do project cung cấp) được ghi dạng số thuần, nên số âm giữ dấu `-` không có `'`; mọi cột chuỗi (tên, nội dung, khu vực, lớp, người xác nhận) luôn qua bộ chống công thức. Tên file `alarm-history-<từ>-<đến>.csv`; tải bằng `Blob` + `<a download>`.
  - **Bộ mẫu kiểm** ≥ 30 chuỗi nguy hiểm (SC-020): `=cmd|' /C calc'!A0`, `+1+1`, `-2+3`, `@SUM(1)`, `\t=1`, `\r=1`, chuỗi có dấu phẩy, nháy kép, xuống dòng, Unicode; kiểm bằng cách phân tích lại CSV.
  - **Ngân sách thời gian:** xuất 50.000 dòng ≤ 10 s trên Chrome (SC-013): 100 trang × (truy vấn ≈ 50 đến 150 ms) + sinh chuỗi: ước 5 đến 15 s ở BL335 qua LAN, chưa đo; nếu chậm thì giảm khoảng giữa các trang không (tuần tự, giữ tải thấp).
- **Lý do:** `beforeId` không quét OFFSET; một kết nối chỉ đọc không đụng ghi; CSV ở trình duyệt tiết kiệm CPU BL335; `text_fold` biến tìm tiếng Việt thành `LIKE` thường mà không cần extension FTS (không thêm thư viện, R23).
- **Phương án khác đã xét:**
  - **FTS5:** tăng kích thước DB và ghi eMMC, phụ thuộc cấu hình biên dịch SQLite của BL335 (đã vá 32-bit ở 003); loại.
  - **Gấp dấu bằng hàm SQL tự đăng ký (`sqlite3_create_function`):** chạy trên mọi hàng ở mỗi truy vấn (chậm hơn); lưu sẵn tốt hơn.
  - **Sinh CSV ở server:** tốn CPU, bộ nhớ BL335; loại (D22).
  - **OFFSET:** quét lại cả phần đã bỏ; loại.

## R18. Widget alarm

- **Quyết định (D27, FR-068 đến FR-072):**
  - Danh mục `widgets.catalog.json` lên 0.4.0, thêm nhóm "Alarm" và hai widget (17 widget): `alarm-list` (thuộc tính `areas`, `classes`, `minPriority`, `states`, `columns`, `maxRows`, `showAck`; không khe Tag) và `alarm-count` (thuộc tính `areas`, `minPriority`, `mode` ∈ {`unacked`,`active`}, `target` hành động điều hướng; không khe Tag).
  - Widget không gọi mạng: nhận **`AlarmSource`** (`snapshot()`, `subscribe(onChange)`, `counts()`, `classes()`, `status()`) và `ActionHost` mở rộng (`ackAlarms(items, onPhase)`, `shelveAlarm(spec, onPhase)`) từ nơi chứa. Trang runtime cấp bản dựa trên `alarm-client.ts` (live 1.3.0); xem trước Studio cấp bản dựa trên `@mat/alarm-engine` (Mô phỏng) hoặc live của thiết bị (Thiết bị, chỉ đọc); `MemoryAlarmSource` cho test.
  - `alarm-list` dùng chung thành phần bảng `alarm-table.ts` với trang Alarm (một cách hiển thị, FR-070); `alarm-count` cập nhật ≤ 1 s sau thay đổi, nhấp nháy theo lớp ưu tiên cao nhất chưa xác nhận.
  - **Không có nguồn** (xem trước Tắt): "Không có dữ liệu alarm". **Project 0.5 không có alarm:** "Không có alarm cấu hình" (FR-071).
  - **Âm thanh chỉ do trang lo**, không phải widget (FR-072): widget nhúng nhiều lần không phát chồng tiếng.
  - Widget tuân FR-058 (trạng thái có chữ và biểu tượng, tương phản, giảm chuyển động) và FR-062 (`textContent`).
  - Ngân sách: dashboard 20 widget của 007 cộng hai widget ≤ 2 s (SC-014); `alarm-list` `maxRows` ≤ 50 (mặc định 8) giữ DOM nhỏ.
  - Validator hai bản đọc cùng danh mục; vector `tests/widget-catalog-vectors/` thêm các ca của hai widget (thuộc tính sai kiểu, `minPriority` lạ, `columns` lạ, `target` không hợp lệ, có khe Tag thừa).
- **Lý do:** tái dùng toàn bộ cơ chế của 007 (danh mục, inspector sinh từ danh mục, Toolbox); hai widget thay vì một vì thuộc tính khác hẳn (D27).
- **Phương án khác đã xét:**
  - **Một widget `alarm` có `mode`:** inspector rối (D27).
  - **Widget tự gọi REST/WebSocket:** phá quy tắc ADR-019, không dùng được ở Studio. Loại.
  - **Widget có tiếng riêng:** nhiều widget phát chồng tiếng. Loại.

## R19. Editor Studio

- **Quyết định (D32, D40, FR-073 đến FR-086):**
  - **Cây dự án:** mục **Alarm** mở khóa (`tree.ts` bỏ `phase:'p4'`; `vi.ts` bỏ `phase.p4`; cập nhật `tree.test.ts`), gồm **Danh sách alarm** và **Lớp alarm**; **Khu vực** là bảng phụ bên phải của Danh sách alarm (phẳng, D32). Nhãn cây có số lỗi.
  - **Danh sách alarm:** lưới ảo hóa ADR-016 (`apps/studio/src/ui/editors/alarm-grid.ts`); cột id, tên, loại, Tag/thiết bị, HH, H, L, LL, deadband, trễ bật, trễ tắt, lớp, khu vực, nội dung, bật/tắt; sửa tại ô, lỗi theo ô, Ctrl+D, dán Excel, nhập/xuất CSV, lọc/tìm, chọn cột; ≥ 2.000 dòng mượt; dòng alarm `limit` nhiều ngưỡng hiển thị một dòng với bốn ô ngưỡng (mô hình tài liệu là một định nghĩa; đếm instance hiển thị ở thanh trạng thái "n alarm · m instance"); khi Online thêm cột trạng thái sống (viền cam), lấy từ live 1.3.0.
  - **Lớp alarm:** lưới và panel xem trước (màu, nhấp nháy, biểu tượng, tiếng thử bằng Web Audio, `alarm-classes.ts`); bốn lớp mặc định `critical`, `major`, `minor`, `advisory` cho project mới; xóa lớp đang dùng liệt kê nơi dùng và hỏi.
  - **"Tạo alarm cho Tag…"** (`alarm-quick-create.ts`): menu chuột phải ở cây, bảng Tag, bảng alarm; loại, bốn ngưỡng, deadband, trễ, lớp gợi ý (HH → `critical`, H → `minor`, L → `minor`, LL → `critical`; người dùng đổi được), khu vực; gợi ý ngưỡng từ `min`/`max` của Tag (25/50/75/90 %); một bước hoàn tác.
  - **Nội dung:** ô nhập có "Xem trước nội dung" bằng bộ định dạng TS (R6) với giá trị mẫu; gợi ý thẻ khi gõ `{`.
  - **Kiểm tra:** chạy liên tục trong worker (luật `alarm-rules.ts` + `rules-05.ts`); lỗi theo ô, chi tiết ở tab Thông tin; lưu khi còn lỗi; Nạp xuống bị khóa; `W_ALARM_*` không chặn (FR-013).
  - **Đổi tên Tag** cập nhật `tag` của alarm cùng một bước hoàn tác; xóa Tag đang có alarm liệt kê và hỏi; "Dùng ở đâu" liệt kê alarm (FR-082). So sánh theo `id` (FR-083).
  - **Mô hình tài liệu** `apps/studio/src/model/alarm-doc.ts`: hàm thuần trên cấu trúc dữ liệu `alarms.json` (thêm, sửa, xóa, đổi tên, tạo nhanh) + hoàn tác dùng lịch sử có sẵn của project-doc.
  - **Mockup** `docs/architecture/mockups/studio-alarms.html`: task Setup tạo và **phiên chính tự duyệt** (ghi ngày); **chặn** việc viết giao diện Studio (FR-086). Mockup có: lưới, tab Lớp, bảng Khu vực, hộp "Tạo alarm cho Tag…", panel Thử alarm, cột trạng thái sống; ghi chú hạn chế (tĩnh).
  - **Tương thích khi nạp xuống:** dòng Tương thích runtime khóa nạp project 0.5 có alarm lên runtime < 0.8.0 (FR-014).
  - **Phiên bản:** Studio 0.7.0; nâng cấp 0.4 → 0.5 trong bộ nhớ (R21).
- **Lý do:** đúng chuẩn IDE kiểu TIA Portal mà người dùng yêu cầu; dùng lại lưới ADR-016 (đã có IME Telex/Unikey, dán, kéo điền), nên tập trung vào miền alarm.
- **Phương án khác đã xét:**
  - **Biểu mẫu một alarm mỗi lần:** người dùng đã từ chối giao diện form cơ bản. Loại.
  - **Mỗi ngưỡng một dòng lưới:** nhân dòng ×4, khó thấy bộ ngưỡng; một dòng bốn ô ngưỡng gọn hơn, giống Tia/WinCC (bảng analog alarm).
  - **Khu vực dạng cây nhiều cấp:** D32 (YAGNI).

## R20. Thử alarm bằng mô phỏng

- **Quyết định (D36, FR-080, FR-081):**
  - Panel **Thử alarm** (`alarm-test-panel.ts`) chạy `@mat/alarm-engine` với `SimEngine` của 006 và **đồng hồ ảo** (`alarm-sim.ts`): tốc độ 1×, 5×, 20× (tick ảo 250 ms; ở 20× chạy 20 tick ảo mỗi 250 ms thật, **không** bỏ tick nên kết quả không đổi theo tốc độ); đổi Tag mô phỏng sang "Nhập tay" để đẩy giá trị qua ngưỡng; xác nhận thử, tạm ẩn thử, bật/tắt từng alarm; nhật ký chuyển trạng thái với thời điểm ảo và lý do.
  - **Bảng alarm** dùng chung thành phần với trang Alarm (`alarm-table.ts`), cấp `AlarmSource` dựa trên engine TS; widget alarm trong xem trước Mô phỏng dùng cùng nguồn (FR-081).
  - Project có lỗi: chạy với alarm hợp lệ, báo alarm bị bỏ qua.
  - **Tương đương:** động cơ TS trong Studio chạy đúng mã được kiểm bởi vector chung (R6); SC-017: cùng thời điểm bật, tắt, trạng thái, nội dung trên 100 % vector (test e2e dùng `vectors.ts` đẩy vào `alarm-sim.ts`).
  - Thử không ghi audit, không ghi đĩa, không gọi thiết bị.
- **Lý do:** Studio không cần thiết bị; kỹ sư thấy alarm bật đúng thời điểm sau trễ ngay khi dựng; cùng mã đã kiểm tương đương.
- **Phương án khác đã xét:**
  - **Thử bằng cách nạp xuống thiết bị rồi xem:** chậm, cần BL335; chỉ giữ cột trạng thái sống khi Online.
  - **Chạy `mat-runtime` x64 từ Studio:** phụ thuộc tiến trình ngoài; loại (D36).

## R21. Migration và phiên bản

- **Quyết định (D28, D29, FR-012, FR-014, FR-100):**
  - `migrate04to05` (`packages/project-schema/src/migrate.ts`): hàm thuần đổi `schemaVersion` mọi file từ `0.4.x` sang `0.5.0`, nâng `minRuntimeVersion` lên max(cũ, 0.8.0) (FR-012; để `E_MIN_RUNTIME` đúng với FR-001). Project 0.1, 0.2 và 0.3 nâng qua các bước trung gian trong một lần (`0.1 → 0.2 → 0.3 → 0.4 → 0.5`).
  - Cặp file mẫu `tests/migration-vectors/*-0.4to0.5/` (vào/ra), kiểm so byte sau chuẩn hóa JSON (SC-015); cùng đầu vào, cùng kết quả.
  - Runtime 0.8.x nhận 0.1 đến 0.5; từ chối `schemaVersion` ≥ 0.6 (như 006 FR-005). Project 0.3 và 0.4 (của 3b) chạy trên runtime 0.8 như trên 0.6 và 0.7.
  - **Hằng số:** `kProjectFormatAlarms` (C++, `core/project-manager/project_validator.hpp`), `PROJECT_FORMAT_ALARMS` (TS); `kRuntimeVersion` 0.8.0; `kDeviceApiVersion` 1.3.0 (`server/device_state.hpp`); `kLiveProtocolVersion` "1.3.0"; Studio 0.7.0; `@mat/ui-components` 0.3.0; `@mat/alarm-engine` 0.1.0; danh mục widget 0.4.0; gói `.matscada` 1.0.0.
  - **Nếu thứ tự phát hành đổi nữa:** task T002 (`tools/renumber-alarm-format.mjs`) là điểm sửa duy nhất: đổi hằng, `protocol-version.json`, `schemas/<ver>` đóng băng, tài liệu. Mã dùng hằng nên không có chuỗi rải rác. Đã giải: 0.5.0, vì 3b dùng 0.4.0; rủi ro còn lại: hai feature cùng sửa file chung.
  - Lược đồ `alarm.db` có số phiên bản nội bộ (`alarm_meta.schema`, D37): v1 ở 0.8.0; thêm cột tùy chọn không cần migration; đổi cấu trúc thì migration trong transaction, sao lưu `alarm.db.bak-v<n>` trước khi chạy.
- **Lý do:** đổi yêu cầu runtime là đổi MINOR (ADR-004); nâng một cấp cuối làm hàm thuần nên kiểm được; hằng số làm cho việc đổi số (nếu cần) rẻ.
- **Phương án khác đã xét:**
  - **Không nâng 0.4 → 0.5 khi project không có alarm:** hai định dạng sống song song vô hạn; Studio luôn ghi bản mới nhất (như 006, 007). Loại.
  - **Runtime tự nâng khi nạp:** sai nguyên tắc "Studio sinh, runtime chạy". Loại.

## R22. Ngân sách BL335

- **Quyết định (Constitution III, FR-021, FR-093, SC-009, SC-011, SC-018):**

  | Hạng mục | Ước tính (chưa đo) | Cơ sở | Mục tiêu |
  |---|---|---|---|
  | RSS thêm của engine | ≈ 0,5 MB: 500 instance × ~300 B trạng thái + chuỗi lớp ≈ 150 KB; bộ đệm snapshot Tag ≈ 12 KB; bộ đệm lần xảy ra mở | tính tay | alarm thêm ≤ 4 MB RSS (FR-093) |
  | RSS thêm của `alarm_store` | ≈ 2 MiB `cache_size` + bộ đệm ghi 5.000 × 250 B ≈ 1,25 MB (tối đa) + luồng ghi (stack 512 KB ảo) | cấu hình | cộng với engine ≤ 4 MB |
  | RSS thêm của hub (hàng đợi alarm) | 10 phiên × tối đa một bản đồ 500 hàng × 350 B ≈ 1,75 MB (cực đại hiếm) | tính tay | thuộc 4 MB |
  | CPU tick engine | 500 instance ≈ 0,05 đến 0,3 ms mỗi tick; mỗi 250 ms ≈ 0,02 đến 0,12 % một lõi | 2 lõi Cortex-A7, ước | ≤ 2 ms mỗi tick (FR-021) |
  | CPU hub đóng gói delta | 200 hàng đổi ≈ 70 KB JSON mỗi client mỗi bão; JSON dựng một lần mỗi tick rồi gửi chung cho 10 phiên | tính tay | alarm thêm ≤ 3 điểm % CPU (SC-011) |
  | CPU ghi `alarm.db` | commit mỗi 2 s, ≤ 7 sự kiện ≈ vài trăm µs CPU | tính tay | thuộc 3 điểm % |
  | Ghi eMMC | xem R9 | | SC-009 |
  | Hàng đợi live | snapshot 200 hàng ≈ 70 KB; 500 hàng chia lô 100 hàng/lô ≈ 35 KB mỗi lô | R13 | ≤ 50 % của 256 KB (SC-018) |

  - **Số đo spike T007 (2026-10-13, x64 trong container; qemu-arm chỉ tham khảo, mô phỏng chậm hơn Cortex-A7 thật):** `TagStore::snapshot` 200 chỉ số + dựng mẫu: x64 trung bình 0,9 µs (p99 1,4); qemu-arm 10,0 µs (p99 35,6). `AlarmEngine::step` 500 instance (125 alarm `limit` × 4 ngưỡng, 200 Tag, không đổi): x64 trung bình 6,0 µs (p99 12,5; max 513); qemu-arm 91,7 µs (p99 246; max 2.753 do mô phỏng). Bão và đi ngẫu nhiên (`alarm_perf_test`, `docs/reports/009-tick-x64.json`): x64 trung bình ≤ 0,12 ms, lớn nhất vài ms khi 200 Tag cùng vượt ngưỡng. Kết luận: **đạt FR-021 (≤ 2 ms) với dư lớn, không cần đánh giá theo thay đổi (`revision`)**; số trên BL335 thật đo ở T129. Cấp phát: không có trong đường nóng khi không đổi (test `NoAllocationInTheHotPath...`).
  - **Cách đo (task):** `tools/alarm-it.ps1 -Scenario budget` trên x64 (tham khảo) rồi trên BL335 ⚠️🔌: 200 alarm, 500 Tag mô phỏng/1 s, 10 client xem trang Alarm, 30 phút; đọc `/proc/<pid>/{status,io}` mỗi 10 s; `system/info.alarms.tickMaxUs1m` cho tick; mốc so sánh 003: RSS tối đa 13,7 MB, CPU hệ thống trung bình 11,7 % ở tải chuẩn có lưu trữ, nên còn dư lớn so với 150 MB và 30 %.
  - **Giới hạn mềm:** trên 200 instance: `W_ALARM_COUNT_HIGH` vì chưa đo; 500 là trần cứng (D34).
- **Lý do:** mọi cơ chế chống bão nằm trong thiết kế (Constitution III) chứ không để người dùng tự chịu; số ước tính cho thấy engine không phải ràng buộc nặng.
- **Phương án khác đã xét:**
  - **Chạy engine trên luồng riêng để cô lập:** không cần ở 500 instance; tăng độ phức tạp (R7). Loại.
  - **Giảm chu kỳ tick đánh giá alarm xuống 1 s:** làm trễ bật thô và vi phạm SC-003. Loại.

## R23. Thư viện và license

- **Quyết định (FR-098):** **không thêm thư viện nào** (runtime C++ hay trang/Studio TS).
  - C++: SQLite (đã có, WAL, `sqlite3_progress_handler`), nlohmann/json, valijson, GoogleTest, CivetWeb (đã có).
  - TS: Lit 3.3.3, Vitest, puppeteer-core, axe-core, `@fluentui/svg-icons` (icon mới nếu cần: dùng bản đã có), uPlot (từ 007; không dùng ở alarm). Web Audio, `AudioContext` là API trình duyệt.
  - Không FTS5 (R17), không thư viện CSV (tự viết ≤ 80 dòng với test), không thư viện âm thanh.
  - Không thêm vào `third_party/LICENSES.md`.
  - Nếu spike buộc thêm thư viện: bản phát hành ≥ 2 tuần, rà license, ADR; kế hoạch này không dự kiến.
- **Lý do:** mọi nhu cầu đều thỏa bằng thứ đã có; mỗi thư viện thêm là rủi ro chuỗi cung ứng và license.
- **Phương án khác đã xét:** thư viện CSV (papaparse), thư viện âm thanh (Howler, Tone.js), thư viện bảng ảo (AG Grid): thêm phụ thuộc, kích thước, license, không cần thiết.

## R24. Chiến lược kiểm thử

- **Quyết định (Constitution VI, FR-094 đến FR-096, SC-022):** test viết trước, đỏ rồi mới cài (ghi trong tasks).

  | Lớp | Nội dung | Công cụ |
  |---|---|---|
  | Vector động cơ chung | ≥ 60 ca (dự kiến 80) chạy ở C++ và TS, so chuyển trạng thái, thời điểm ảo, nội dung (R6) | GoogleTest, Vitest |
  | Bảng ISA | duyệt hết tích trạng thái × sự kiện (mỗi cặp một test, kể cả cặp "không thể") (SC-005) | GoogleTest, Vitest |
  | Vector validator | `tests/project-vectors/v05-*` ≥ 60; `tests/widget-catalog-vectors/` thêm hai widget; `tests/migration-vectors/` cặp 0.4 → 0.5 | hai bản validator |
  | `alarm_store` | WAL, dựng lại, thời hạn, trần, đĩa đầy (`minFreeBytes`), hỏng (`.corrupt-<epoch>`), bộ đệm tràn (`droppedChanges`), cửa sổ commit thích ứng, chỉ mục, `foldVi` | GoogleTest (sqlite thật) |
  | Cắt điện mô phỏng (x64) | (a) `kill -9` 100 lần đang ghi và đang xác nhận (`tools/alarm-it.ps1 -Scenario killloop`); (b) cắt cụt đuôi `alarm.db-wal` tại ≥ 200 vị trí byte ngẫu nhiên (hạt giống cố định) và xáo trộn trang cuối, mở lại, `integrity_check` = `ok`, bất biến B1 đến B3 (R8) | Node + C++ test; kiểm cặp (`alarm.db`, `audit.db`) |
  | Cắt điện thật (BL335) | ≥ 10 lần, người ở cạnh ⚠️🔌 (SC-008); mỗi lần ghi 1 dòng báo cáo | quickstart, `docs/reports/009-power.md` |
  | Live | snapshot chia lô, delta, đứt `sequence`, dồn, tương thích 1.2.0 và 1.3.0 hai chiều, `ack` trên WebSocket bị từ chối | GoogleTest, Vitest |
  | API | quyền, audit trước (đảo thứ tự bằng cách giả lỗi audit), `STALE`, idempotent, `upToRevision`, hai client đua | GoogleTest + `alarm-it -Scenario state,auth` |
  | Tấn công | CSRF, `Origin` lạ, cookie qua HTTP, cookie vào `disable`/`enable`, `GET` đổi trạng thái, role thấp, phiên hết hạn (US6) | `alarm-it -Scenario attack` |
  | Độ trễ end-to-end | 100 lần: đổi Tag → DOM đổi, p95 ≤ 1.000 ms (SC-003) | `alarm-it -Scenario latency` (Chrome headless) |
  | Bão | 200 alarm bật trong một tick; 10 client; 0 phiên 4409; hàng đợi ≤ 50 % (SC-018); chập chờn 20 lần/phút (SC-019) | `alarm-it -Scenario storm` |
  | Lịch sử | 100.000 lần xảy ra (`tools/alarm-history-seed/`), truy vấn ≤ 1 s x64, `q` không dấu, CSV | `alarm-it -Scenario history` |
  | Ngân sách | RSS, CPU, ghi eMMC (R9, R22) | `alarm-it -Scenario budget` |
  | e2e web | banner, trang, menu, lịch sử, CSV, widget; axe-core hai theme; giảm chuyển động | puppeteer-core, `apps/runtime-web/tests/e2e/alarm-*.e2e.mjs` |
  | e2e Studio | dựng 200 alarm (dán, wizard, kéo điền), Thử alarm = vector, nâng cấp, So sánh, Online | `apps/studio/tests/e2e/alarm-*.e2e.mjs` |
  | Tay | Telex/Unikey, CSV mở bằng Excel, Chrome thật, trình đọc màn hình, tiếng | quickstart, ghi rõ nếu chưa làm |

  - Mọi FR có test hoặc bước tay: `docs/reports/009-fr-matrix.md` (kiểm bằng `/speckit-analyze`).
  - Lint cho `packages/alarm-engine`, `apps/runtime-web/src/alarm/` (cấm `innerHTML`, chuỗi cứng); glob lint cho thư mục `tests/*` mới (như 007).
  - Thêm `core/alarm` vào `MAT_ARMHF_TEST_TARGETS` để chạy qemu-user armhf (đặc biệt `alarm_store_test` với SQLite 32-bit).
- **Lý do:** ba loại rủi ro (đúng, bền, hiển thị) cần ba cách kiểm khác nhau; vector chung cho đúng; cắt cụt WAL và cắt điện thật cho bền; e2e cho hiển thị.
- **Phương án khác đã xét:** chỉ `kill -9` cho "mất điện": không thử được mất dữ liệu chưa fsync (R8); thiết bị cắt điện tự động: cần phần cứng, ngoài phạm vi.

## R25. Mô hình mối đe dọa

- **Quyết định (Constitution V, FR-097):**

  | Mối đe dọa | Kịch bản | Biện pháp |
  |---|---|---|
  | Xác nhận trái phép | viewer, khách, CSRF, XSS đã thực thi gọi `ack` | kiểm role backend (operator), cookie kèm CSRF + `Origin` + `Sec-Fetch-Site` như `tags/write`, audit trước khi áp; ghi giới hạn: XSS đã thực thi có quyền operator đang đăng nhập (như 007) |
  | Vô hiệu hóa alarm trái phép | cookie đánh cắp gọi `disable` | `disable`/`enable` chỉ Bearer (`cookieAllowed=false`), role engineer, `reason` bắt buộc, audit |
  | Che alarm bằng shelve hàng loạt | operator lạm dụng shelve | ≤ 8 giờ, lý do bắt buộc, ≤ 50 cùng lúc, audit, tab "Tạm ẩn" luôn thấy, hết hạn tự bật lại (D11) |
  | Xác nhận giả (mất điện) | trạng thái ACK mà không có người xác nhận | audit FULL trước; bất biến B1 đến B3 (R8) |
  | XSS qua nội dung alarm | project độc hại có `<script>` trong `text`, `name`, khu vực | `textContent`; không `innerHTML`; CSP hiện có; bộ ≥ 20 chuỗi XSS (SC-020) |
  | Công thức CSV | nội dung bắt đầu `=` | thêm `'` đầu ô, bộ ≥ 30 chuỗi (R17) |
  | SQL injection | `q`, `alarmId`, `area` ở truy vấn lịch sử | tham số ràng buộc; thoát `LIKE`; kiểm kiểu và độ dài; không ghép chuỗi SQL |
  | Từ chối dịch vụ truy vấn lịch sử | khoảng 366 ngày, `LIMIT` vô tận, `q` dài | `limit` ≤ 500, `beforeId`, `q` ≤ 80, hạn thời gian truy vấn 5 s (R17), một kết nối chỉ đọc, giới hạn tần suất của API đọc |
  | Tràn hàng đợi live | nhiều alarm, client chậm | dồn theo instance, chia lô snapshot, 4409 sẵn có (R13) |
  | Bão audit | tấn công `ack` bị từ chối liên tục | gộp 60 s, ≤ 10 dòng/phút (R15) |
  | Lộ thông tin ở `system/info` | khối `alarms` có tên alarm? | chỉ số liệu đếm (không tên, không nội dung); `system/info` đã sau `viewerAccess` |
  | Project độc hại làm nghẽn | 500 alarm chập chờn, Tag giả | giới hạn 500, tự cách ly, cửa sổ commit thích ứng, bộ đệm 5.000 |
  | Đồng hồ giả | đổi giờ để xóa lịch sử sớm | thời hạn đo bằng giờ treo tường chỉ khi `clockOk`; không xóa khi đồng hồ không hợp lệ; thứ tự theo `occurrence` |
  | Lộ `alarm.db` | đọc file | quyền `0600`, thư mục dữ liệu như `audit.db`; không bí mật trong nội dung (không lưu mật khẩu, token) |

  - Giới hạn còn lại (ghi rõ trong báo cáo): web SCADA không phải lớp an toàn; interlock ở PLC; alarm là thông tin cho người, không điều khiển máy.
  - Rà soát bảo mật là task bắt buộc trước khi đóng feature (FR-097).
- **Lý do:** liệt kê trước để mỗi biện pháp có test (R24); nhấn mạnh hướng mất mát an toàn và ngăn che alarm.
- **Phương án khác đã xét:** hai người xác nhận cho alarm `critical`, chữ ký điện tử: ngoài phạm vi (spec "Ngoài phạm vi").

## Điểm cần sửa spec

1. **SC-009 và FR-042 (ngân sách ghi, R9):** Đã xử lý trong spec (SC-009 nới: tải chuẩn ≤ 25 MB/ngày, bão ≤ 0,1 GB/ngày nhờ tự cách ly 30 phút, D43, FR-035, và cửa sổ commit thích ứng, FR-039). Số liệu vẫn là ước tính; spike T006 đo thật.
2. **FR-039:** Đã xử lý trong spec (FR-039: `alarmCommitMs` 2.000 → `alarmCommitMaxMs` 30.000 khi > 5 thay đổi/s kéo dài 10 s).
3. **FR-036 / FR-038:** Đã xử lý trong spec (FR-036, FR-038: `closedBy` thêm `chatter`).
4. **FR-038:** Đã xử lý trong spec (FR-038: cột `text_fold`, `fingerprint`, `closed`, `repeat_count`).
5. **FR-053 / device-api:** Đã xử lý trong spec (FR-053: 503 `ALARM_HISTORY_BUSY`; D45 cho `unsynced=1`).
6. **FR-031, FR-032 (override khi mất điện):** Đã xử lý trong spec (FR-033: đối chiếu `alarm_override` với `audit.db` lúc khởi động).
7. **FR-044:** Đã xử lý trong spec (FR-044: hai chỉ mục phụ có thể bỏ).
8. **FR-046:** Đã xử lý trong spec (FR-046: snapshot chia lô `part`/`parts` ≤ 100 hàng).
