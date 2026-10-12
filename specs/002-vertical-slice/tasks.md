---

description: "Task list — Vertical slice trên thiết bị (Sprint 1)"
---

# Tasks: Vertical slice trên thiết bị (Sprint 1)

**Input**: `specs/002-vertical-slice/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Tests**: **Bắt buộc, viết trước** (Constitution VI; spec FR-030). Mỗi task "Test" phải chạy **đỏ** trước khi làm task cài đặt tương ứng. C++ dùng GoogleTest (build x64 trong Docker qua `deployment/toolchain/test-x64.ps1`). TS dùng Vitest. Rust dùng `cargo test`. Go dùng `go test`.

**Quy ước an toàn**:
- Task 🔌 cần SSH vào BL335 (thông tin trong memory, **không** ghi mật khẩu vào repo).
- Task ⚠️ thay đổi thiết bị: chỉ thực hiện trong phạm vi deploy đã được yêu cầu, ghi `docs/reports/device-changes.md` kèm cách hoàn tác, **không** đụng dịch vụ sản phẩm cũ (`atscada-*`).
- Ổ D: máy dev gần đầy: xóa `build/x64`, `build/armhf` cũ trước khi build nếu < 500 MB trống; Rust target đặt ở `C:\build\mat-studio`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác file, không phụ thuộc task chưa xong)
- **[Story]**: US1…US7 theo spec.md

---

## Phase 1: Setup (khung và thư viện)

- [X] T001 Vendor thư viện C++ vào `third_party/`: `nlohmann/json` v3.11.3 (chỉ `single_include/nlohmann/json.hpp` + LICENSE), `valijson` v1.0.x (thư mục `include/` + LICENSE), `googletest` v1.15.2 (bỏ docs/ci). Ghi nguồn, phiên bản, license vào `third_party/LICENSES.md` (CivetWeb MIT, nlohmann MIT, valijson BSD-2-Clause, googletest BSD-3-Clause)
- [X] T002 Chuyển PoC `server/main.cpp` → `server/poc/main.cpp` (giữ nguyên nội dung, sửa include `sim_tags.hpp` → `server/poc/sim_tags.hpp`). Cập nhật target `mat-poc` trong `CMakeLists.txt`. Thêm `add_subdirectory(third_party/googletest)` chỉ khi không cross-compile (`if(NOT CMAKE_CROSSCOMPILING)`), cùng `include(GoogleTest)`
- [X] T003 [P] Tạo khung 4 package npm workspace, mỗi package có `package.json` (`"type":"module"`, `exports` trỏ `src/index.ts`, script `test`/`typecheck`), `tsconfig.json`, `src/index.ts`, `vitest.config.ts` (jsdom khi cần): `packages/project-schema` (`@mat/project-schema`, dependency `@cfworker/json-schema@4.1.1`), `packages/svg-renderer`, `packages/binding-engine`, `packages/live-client`
- [X] T004 [P] Mở rộng lint/format: `package.json` gốc script `lint`/`format` bao gồm `packages/**/*.{ts,json}` và `schemas/**/*.json`, `projects/**/*.json`; `eslint.config.mjs` bao gồm `packages`; `tools/ci-local.ps1` bước clang-format quét thêm `drivers` — **ghi chú khi làm:** `projects/**/*.json` **không** nằm trong `lint`/`format`, và `.prettierignore` loại `projects/` (cùng `tests/project-vectors/`): Prettier gộp mảng ngắn lên một dòng, lệch định dạng `JSON.stringify` 2 dấu cách mà `serialize()` của Studio ghi. `projects/` được kiểm bằng `npm run validate:project`. **Ngày 2026-10-11 (GĐ 0, C-09):** `.prettierignore` đổi thành `tests/project-vectors/*/`, nên `generate.mjs` nay được Prettier kiểm (trước đó bị bỏ qua mà không báo)
- [X] T005 [P] Tạo thư mục rỗng có `README.md` ngắn mô tả mục đích: `schemas/`, `projects/tank-demo/`, `tests/project-vectors/`, `core/tag-engine/`, `core/project-manager/`, `drivers/simulation/`, `server/http/`, `server/websocket/`, `tools/project-validator/`, `docs/deployment/` — **ghi chú khi làm:** chỉ tạo `schemas/README.md`; các thư mục khác đã có mã ngay trong Phase 2 nên mô tả nằm ở comment đầu file thay cho README riêng

**Checkpoint**: `npm ci`, `npm test`, `./deployment/toolchain/test-x64.ps1` vẫn xanh (chưa có logic mới).

---

## Phase 2: Foundational (chặn mọi user story)

**Mục đích**: schema v0, project mẫu, lõi máy chủ (TagStore, SendQueue, LiveHub, khung `mat-runtime`), và việc chuyển mã TS sang package. Mọi story đều cần các phần này.

### Schema v0 và project mẫu

- [X] T006 Viết 4 JSON Schema draft-07 theo [data-model.md](data-model.md) và [contracts/project-format.md](contracts/project-format.md): — **ghi chú khi làm:** `maxClients` trong `project.schema.json` chỉ ràng buộc kiểu `integer`; khoảng 1–10 do luật `E_MAX_CLIENTS` kiểm ở cả hai validator (T061), nên công cụ chỉ dùng schema sẽ nhận giá trị 11. Câu "trùng với ràng buộc schema" ở contracts/project-format.md vì thế chưa đúng
  - `schemas/project.schema.json`: `format` const `"matscada-project"`; `projectId` `^[a-z0-9][a-z0-9-]{1,47}$`; `projectName` 1–80 ký tự; `screens` 1–32 duy nhất `^[a-z0-9][a-z0-9-]{0,47}$`; `maxClients` 1–10; `additionalProperties:false`.
  - `schemas/tag.schema.json`: ≤ 2000 Tag; `id` `^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$` ≤ 64; `type` enum 10 kiểu; `description` ≤ 200; `unit` ≤ 16; `source` `{kind:"mock", signal}`.
  - `schemas/screen.schema.json`: `fitMode` `contain|cover|stretch`; `elements` ≤ 2000; `elementUid` `^el_[a-z0-9_]{3,40}$`.
  - `schemas/binding.schema.json`: `target` enum = allowlist §8.2 đầy đủ (11 đích); `transform.kind` enum 6 kiểu; `discreteMap.cases` 1–64; `onBadQuality.mode` `hold|override`; `animation` `spin`; `direction` `up|down|left|right`; `format.decimals` 0–6.
  - Mọi file `schemaVersion` khớp SemVer; `$id` `https://schemas.atpro.com.vn/mat/<name>/0.1.json`.
- [X] T007 [P] Viết `schemas/protocol-version.json` `{"live":"1.0.0","project":"0.1"}`
- [X] T008 Vẽ tay `projects/tank-demo/screens/tank-motor.svg` (viewBox 0 0 1280 720, ≤ 80 phần tử, không script/ảnh ngoài). Nội dung:
  - bồn có `clipPath` và `rect` mức nước `data-mat-uid="el_tank_level"`;
  - vỏ bồn `el_tank_body`;
  - motor thân `el_motor_body`, cánh quạt `el_motor_fan`;
  - đèn trạng thái `el_motor_lamp`;
  - chữ `el_txt_level`, `el_txt_speed`, `el_txt_temp`;
  - ống nối, nhãn tiếng Việt.
- [X] T009 Viết `projects/tank-demo/project.json` (`projectId` `tank-demo`, `schemaVersion` `0.1.0`, `entryScreen` `tank-motor`, `maxClients` 10, `minRuntimeVersion` `0.2.0`). Viết `projects/tank-demo/tags.json` với 5 Tag:
  - `TANK01.LEVEL` FLOAT32 % 0–100, `signal` `tank.level`;
  - `MOTOR01.RUN` BOOL, `motor.run`;
  - `MOTOR01.SPEED` FLOAT32 rpm 0–1500, `motor.speed`;
  - `TANK01.INFLOW` FLOAT32 m3/h, `tank.inflow`;
  - `TANK01.TEMP` FLOAT32 °C, `tank.temp`.
- [X] T010 Viết `projects/tank-demo/screens/tank-motor.screen.json` (khai báo 8 `elements` ở T008) và `tank-motor.bindings.json` với các binding:
  - `el_tank_level` `geometry.levelPercent` ← `TANK01.LEVEL` (`direct`);
  - `el_tank_level` `style.opacity` ← `TANK01.INFLOW` (`linearScale` 0–20 → 0,6–1, có kẹp);
  - `el_motor_body` `style.fill` ← `MOTOR01.RUN` (`discreteMap` `true` → `#22c55e`, `false` → `#64748b`);
  - `el_motor_fan` `transform.rotate` `animation:"spin"` ← `MOTOR01.SPEED`;
  - `el_motor_lamp` `style.fill` `discreteMap` ← `MOTOR01.RUN`;
  - `el_txt_level` / `el_txt_speed` / `el_txt_temp` `text.content` có `format.decimals`;
  - `el_tank_body` `style.stroke` `discreteMap` ← `MOTOR01.RUN`;
  - `el_txt_temp` `onBadQuality` `override` `"--"`.

### Validator TS — phần lõi (chưa đủ luật; đủ luật ở US5)

- [X] T011 [P] Test `packages/project-schema/src/schema.test.ts`: 4 schema tự hợp lệ (meta-schema draft-07); project mẫu `projects/tank-demo` qua schema; ví dụ sai kiểu/thiếu trường trả `E_SCHEMA` kèm JSON Pointer — **ghi chú khi làm:** đến hết Sprint 1 (commit `60578be`) **chưa có** ca "4 schema tự hợp lệ theo meta-schema draft-07": `schema.test.ts` có 6 ca (project mẫu, `E_SCHEMA` kèm JSON Pointer, thiếu/thừa trường, `E_JSON`, đích ngoài allowlist, đọc ngoài root). Chưa test nào kiểm `schemas/*.json` theo meta-schema, nên từ khóa gõ sai trong schema không bị phát hiện. **Đã thêm ngày 2026-10-11 (GĐ 0):** `packages/project-schema/src/meta-schema.test.ts` kiểm đủ 5 schema (kể cả `logging.schema.json`) theo meta-schema draft-07 (`third_party/json-schema/draft-07.schema.json`) và theo bản chặt `additionalProperties:false`, bắt được từ khóa gõ sai
- [X] T012 Cài `packages/project-schema/src/`: — **ghi chú khi làm:** không có hàm `loadProject(source)`: `validateProject(source)` trả luôn model đã ghép ở `ValidationResult.project` (khi không còn lỗi). `NodeDirSource` nằm ở `node-source.ts`, xuất riêng qua `@mat/project-schema/node`, không nằm trong `source.ts`
  - `types.ts`: kiểu TS cho Project, TagList, Screen, BindingSet, Binding, Transform; tự viết, khớp schema.
  - `source.ts`: interface `ProjectSource { readText(rel): Promise<string|null> }` + `NodeDirSource` (Node `fs`, chặn đường dẫn ra ngoài root).
  - `validate.ts`: `validateProject(source): Promise<ValidationResult>` gồm parse JSON (`E_JSON`, file > 1 MB) và kiểm schema bằng `@cfworker/json-schema` (`E_SCHEMA`).
  - `codes.ts`: hằng số mã lỗi theo contract.
  - `loadProject(source)`: trả model đã ghép.

### Lõi máy chủ C++

- [X] T013 Chuyển `core/session-manager/tests/session_manager_test.cpp` sang GoogleTest (giữ mọi ca cũ). Đăng ký `gtest_discover_tests` trong `CMakeLists.txt`
- [X] T014 [P] Test `core/session-manager/tests/send_queue_test.cpp`: FIFO; đếm byte; `push` vượt `maxBytes` (262144) → trả `Overflow`, xóa nội dung chờ, chỉ còn bản tin điều khiển `resync_required`, cờ `overflowed`, mọi `push` sau bị bỏ; `pop` chặn có timeout; `close()` đánh thức thread chờ; bản tin đơn lẻ > `maxBytes` → `Overflow`
- [X] T015 Cài `core/session-manager/send_queue.hpp` (header-only, thread-safe, mutex + condition_variable, không phụ thuộc CivetWeb) đạt T014
- [X] T016 [P] Test `core/tag-engine/tests/tag_store_test.cpp`: nạp định nghĩa Tag (id → index ổn định); `set(index, value, quality, sourceTs)` tăng `revision` chỉ khi giá trị hoặc chất lượng đổi; `takeDirty()` trả các index đổi kể từ lần trước rồi xóa; giá trị BOOL/số/chuỗi/INT64 dạng chuỗi; JSON hóa giá trị đúng contract (`true`, `12.5`, `"9007199254740993"`, `null`)
- [X] T017 Cài `core/tag-engine/tag_store.hpp/.cpp` (`TagValue` variant; mutex nội bộ) và `core/tag-engine/tag_provider.hpp` (`class TagProvider { virtual void step(int64_t nowMs) = 0; }`) đạt T016
- [X] T018 [P] Test `server/websocket/tests/live_hub_test.cpp` với `FakeTransport`: — **ghi chú khi làm:** giới hạn bản tin đổi từ 16 KB lên **96 KiB** (98 304 byte) sau review T093 (research R6); test `OversizedMessageCloses1009` dùng bản tin 98 305 byte
  - `onOpen` gửi `hello` có `protocolVersion` 1.0.0, `heartbeatMs` 5000, `timeoutMs` 15000;
  - `subscribe` trả snapshot đúng **thứ tự yêu cầu**, Tag lạ vào `unknown`, toàn Tag lạ → `error NO_VALID_TAGS`;
  - `tick()` sau `set` sinh delta `[index,value,quality]` chỉ cho Tag đã đăng ký và có đổi; không đổi thì không có delta;
  - sequence tăng 1 mỗi delta theo phiên;
  - `subscribe` lần 2 thay thế đăng ký và gửi snapshot mới;
  - `unsubscribe` dừng delta;
  - JSON hỏng / `type` lạ → `error BAD_MESSAGE`; 20 lỗi liên tiếp → yêu cầu đóng 1008;
  - bản tin > 16 KB → đóng 1009;
  - `subscribe` > 1000 Tag → `error`;
  - heartbeat mỗi 5 s;
  - **race**: 100 lần subscribe xen kẽ `tick()` từ thread khác, delta đầu sau snapshot luôn = `snapshot.sequence + 1`.
- [X] T019 Cài `server/websocket/live_hub.hpp/.cpp`: interface `LiveTransport { push(sid, text) -> PushResult; close(sid, code, reason) }`; `hubMu` bao subscribe + tick (research R5); parse bằng nlohmann; dựng delta bằng `snprintf`; đạt T018
- [X] T020 [P] Test `server/tests/config_test.cpp`: mặc định theo [contracts/runtime-config.md](contracts/runtime-config.md); file ghi đè mặc định; CLI ghi đè file; `maxClients` 11 → 10 kèm cảnh báo; `deltaPeriodMs` ngoài 100–250 → lỗi; JSON sai → lỗi (mã thoát 2)
- [X] T021 Cài `server/config.hpp/.cpp` đạt T020 (gồm cờ `--check-project`, `--project-dir`, `--schemas-dir`, `--config` theo contracts/runtime-config.md)
- [X] T022 Viết `server/main.cpp` (`mat-runtime`):
  - đọc config; khởi động CivetWeb (`num_threads` = `threads`, `request_timeout_ms` 10000, `listening_ports`);
  - thread ticker (`provider.step` → `hub.tick` mỗi `deltaPeriodMs`);
  - SIGTERM/SIGINT dừng sạch;
  - mã thoát 0/2/3.
  - Thêm target `mat-runtime` trong `CMakeLists.txt` (link civetweb, include `third_party/nlohmann`, `third_party/valijson`, `-O2 -Wall -Wextra -Wno-psabi`); thêm thư viện tĩnh `mat_core` (tag-engine, live_hub, config; project-manager được thêm vào ở T062) dùng chung cho test.
- [X] T023 Cài `server/websocket/civet_transport.hpp/.cpp`:
  - connect handler (chỗ móc kiểm Origin, hiện tại chấp nhận tất cả);
  - ready: `SessionManager::tryAcquire`, tạo `Session` + `SendQueue` + **writer thread** (pop → `mg_websocket_write`, gặp lệnh đóng thì gửi khung close);
  - data: làm mới heartbeat → `hub.onMessage`;
  - close: release slot, `queue.close()`, join writer.
  - Không bao giờ gọi `mg_websocket_write` từ thread ticker.
- [X] T024 Cài `server/http/static_handler.cpp`: phục vụ docroot, ưu tiên `.gz` khi `Accept-Encoding: gzip`, ETag + `If-None-Match` → 304; `/assets/*` immutable, `index.html` `no-cache`; thêm `X-Content-Type-Options: nosniff`; chặn `..`; phương thức khác GET/HEAD → 405 — **ghi chú khi làm:** không có `static_handler.cpp`: gộp cùng T025 vào `server/http/http_api.cpp`/`.hpp`. Sau review T093 (CVE-2025-55763), CivetWeb build với `NO_FILES` và `mat-runtime` không phục vụ docroot chung, chỉ `/`, `/index.html` và `/assets/<tên trong allowlist>`
- [X] T025 Cài `server/http/api_handlers.cpp`: — **ghi chú khi làm:** không có `api_handlers.cpp`: các handler nằm trong `server/http/http_api.cpp` (`onInfo`, `onActive`, `onProjectFile`)
  - `GET /api/v1/system/info` theo [contracts/http-api.md](contracts/http-api.md), đủ trường gồm các bộ đếm;
  - `GET /api/v1/projects/active` (200 ghép project/tags/screens/bindings; 503 `NO_VALID_PROJECT`);
  - `GET /project/<path>` chỉ phục vụ file thuộc allowlist (`svgFile` của các screen), ngoài allowlist → 404.

### Chuyển mã TS sang package

- [X] T026 [P] Chuyển `apps/runtime-web/src/sanitize.ts`, `inspect.ts` cùng test sang `packages/svg-renderer/src/`. Cho phép thuộc tính `data-mat-uid` (và chỉ thuộc tính `data-*` này) theo ADR-003 điểm 4. Thêm test: `data-mat-uid` được giữ, `data-tag`/`data-foo` bị bỏ. Cập nhật import ở `apps/runtime-web` và `tools/svg-inspect/svg-inspect.mjs`
- [X] T027 [P] Chuyển `apps/runtime-web/src/live.ts` + `live.test.ts` sang `packages/live-client/src/state.ts` (giữ nguyên test cũ chạy xanh trước khi sửa giao thức)
- [X] T028 Tách trang thử Sprint 0 thành trang dev: `apps/runtime-web/lab.html` + `apps/runtime-web/src/lab.ts` (từ `main.ts` cũ, dùng package mới). `vite.config.ts` thêm input `lab`. `scripts/package-web.mjs` **không** copy `lab*`, `screens/`, fixture vào `dist-device/`. `tools/measure/svg-load.mjs` trỏ sang `lab.html` — **ghi chú khi làm:** binding thử của Sprint 0 (`apps/runtime-web/src/lab-binding.ts`, theo `data-tag`) và test của nó **không** chuyển vào package (ngoại lệ FR-013): đây là mã dev của trang lab, không đóng gói (`package-web.mjs`, `package-runtime.ps1` chặn `lab*`), được giữ lại có chủ đích và đã được `@mat/binding-engine` thay thế (research R8). `svg-load.mjs` không tự trỏ sang `lab.html`: script nhận URL đầy đủ rồi thêm `?auto=1`, nên phải truyền `…/lab.html` (README gốc đúng; `tests/fixtures/svg/README.md` và `docs/reports/svg-load.md` còn ghi URL gốc `/`, nay là trang runtime)

**Checkpoint**:
- `npm test` xanh (test cũ ở vị trí mới).
- `test-x64.ps1` xanh (send_queue, tag_store, live_hub, config, session_manager).
- `mat-runtime` x64 khởi động, phục vụ `/api/v1/system/info`.

---

## Phase 3: User Story 1 — Xem màn hình bồn nước + motor sống (P1) 🎯 MVP

**Goal**: 1 tab Chrome xem màn hình tank-motor chạy theo Mock Tag từ `mat-runtime`.

**Independent Test**: `./deployment/toolchain/run-x64.ps1` rồi mở `http://localhost:8080/` ≥ 1 phút; mức bồn, màu và quay motor, chữ khớp `system/info` và log Tag; chữ nhiệt độ hiển thị `--` khoảng 5 s mỗi 20 s (`TANK01.TEMP` BAD).

### Tests (viết trước)

- [X] T029 [P] [US1] Test `drivers/simulation/tests/mock_tag_provider_test.cpp` với đồng hồ giả:
  - motor chạy → `TANK01.LEVEL` tăng; ≥ 90 % → `MOTOR01.RUN=false` và bồn xả; ≤ 10 % → chạy lại; chu kỳ đầy đủ 50–70 s;
  - `MOTOR01.SPEED` 1450 ± 20 rpm khi chạy, 0 khi dừng;
  - `TANK01.TEMP` BAD đúng 5 s trong mỗi 20 s;
  - Tag `source.signal` không biết → chất lượng BAD;
  - `simLoad` bật: 500 Tag `SIM.T0001…T0500` mỗi Tag đổi đúng 1 lần mỗi 1000 ms (mỗi bước 250 ms đổi 125 Tag).
- [X] T030 [P] [US1] Test `packages/binding-engine/src/transforms.test.ts`:
  - `direct`;
  - `discreteMap` (BOOL/number/string, `default`, không khớp + không default → bad);
  - `linearScale` (kẹp, `inMin>inMax` đảo chiều, NaN → bad);
  - `onBadQuality` `hold`/`override`/mặc định theo đích (fill/stroke `#8d99a3`, opacity 0.5, text `"--"`, rotate dừng, level giữ);
  - `format.decimals`/`suffix`;
  - màu chứa `url(` bị từ chối.
- [X] T031 [P] [US1] Test `packages/binding-engine/src/applier.test.ts` (jsdom, `requestAnimationFrame` giả):
  - gom nhiều thay đổi thành 1 lần ghi mỗi frame; không ghi khi giá trị tính ra không đổi;
  - `geometry.levelPercent` đổi `y/height` theo hộp bao đo **một lần** lúc khởi tạo, cả 4 hướng;
  - `transform.rotate` tĩnh;
  - `spin` khởi tạo animation khi > 0 và dừng khi 0/false/BAD; `document.hidden` → tạm dừng, hiện lại → chạy tiếp;
  - `text.content`, `style.visibility`;
  - `dispose()` hủy animation và listener.
- [X] T032 [P] [US1] Test `packages/svg-renderer/src/mount.test.ts`: `mountScreen(host, svgText, screen)` tạo Shadow DOM (`mode:'closed'` không bắt buộc, dùng `open` để test), sanitize trước khi chèn, lập `Map<elementUid, Element>` theo `data-mat-uid`, báo danh sách UID thiếu, đặt `viewBox`/`fitMode`/`background`; hai màn hình cùng class/id không ảnh hưởng nhau; `unmount()` xóa sạch
- [X] T033 [P] [US1] Test `packages/live-client/src/state.test.ts` theo protocol 1.0.0:
  - `hello.protocolVersion`;
  - snapshot theo thứ tự + `unknown`;
  - delta theo index của snapshot;
  - bỏ delta có `subscriptionId` khác hoặc tới trước snapshot;
  - sequence nhảy → `needResync`;
  - giá trị BOOL/chuỗi/null giữ đúng kiểu (bỏ ép `number` của Sprint 0).

### Implementation

- [X] T034 [US1] Cài `drivers/simulation/mock_tag_provider.hpp/.cpp` (ánh xạ `signal` → mô phỏng; `SIM.*` khi `simLoad`) đạt T029. Nối vào `server/main.cpp` — **ghi chú ngày 2026-10-11 (GĐ 0, audit FR-018):** số Tag `SIM.*` đổi mỗi lần nay tính theo thời gian trôi (`size × dtMs`), không theo số lần `step()`; test `Sim.SimLoadRateFollowsElapsedTimeWith100msSteps`
- [X] T035 [US1] Cài `packages/binding-engine/src/transforms.ts`, `quality.ts` đạt T030 — **ghi chú khi làm:** không tách `quality.ts`: quy tắc chất lượng xấu (`Quality`, `NEUTRAL_COLOR`, giá trị trung tính theo đích, `onBadQuality`) nằm trong `transforms.ts`
- [X] T036 [US1] Cài `packages/binding-engine/src/applier.ts` (`DomApplier`: rAF batching, cache giá trị, Web Animations cho `spin` với `transform-box: fill-box; transform-origin: center`, `visibilitychange`) đạt T031
- [X] T037 [US1] Cài `packages/svg-renderer/src/mount.ts` đạt T032; export từ `packages/svg-renderer/src/index.ts`
- [X] T038 [US1] Sửa `packages/live-client/src/state.ts` theo protocol 1.0.0 đạt T033 — **ghi chú ngày 2026-10-11 (GĐ 0, audit FR-012):** delta nhảy sequence không còn được áp (trả rỗng, giữ nguyên giá trị và sequence, đặt `needResync`), nên màn hình không hiện trạng thái ghép; test trong `state.test.ts` và `connection.test.ts`
- [X] T039 [US1] Cài `packages/live-client/src/connection.ts` bản cơ bản: `LiveConnection` (WebSocket factory inject được; `connect()`, `subscribe(tags)`, echo heartbeat, sự kiện `change`/`state`) — reconnect/full đầy đủ ở US2/US3
- [X] T040 [US1] Viết lại `apps/runtime-web/src/main.ts`: `GET /api/v1/projects/active` → fetch `/project/<svgFile>` → `mountScreen` → thu Tag từ bindings → `LiveConnection.subscribe` → `DomApplier`. 503 → hiển thị "Không có project hợp lệ" kèm danh sách lỗi. UID thiếu → bỏ binding và `console.warn`. Cập nhật `apps/runtime-web/index.html` (tiêu đề, vùng trạng thái, không còn danh sách fixture), `style.css`
- [X] T041 [US1] Viết `deployment/toolchain/run-x64.ps1`: build x64 trong Docker, chạy `mat-runtime` x64 trong container (cổng 8080, docroot `apps/runtime-web/dist-device`, project `projects/tank-demo`)
- [X] T042 [US1] Kiểm chứng thủ công trên Chrome cục bộ (Independent Test ở trên) và ghi kết quả ngắn vào `docs/reports/sprint1-acceptance.md` (mục "US1 — x64")

**Checkpoint**: MVP chạy end-to-end trên x64.

---

## Phase 4: User Story 2 — Giới hạn 10 phiên và thông báo đầy (P1)

**Goal**: tab 11 thấy thông báo đầy + đếm ngược 30 s + "Thử lại ngay"; 10 tab không gián đoạn; slot giải phóng khi đóng tab hoặc im lặng 15 s.

**Independent Test**: `go run . -clients 10 -extra 1` và `-slot-test` với `mat-runtime` x64; 11 tab Chrome cục bộ.

- [X] T043 [P] [US2] Test `packages/live-client/src/connection.test.ts` (WebSocket giả, timer giả):
  - close 4429 **hoặc** `error MAX_CLIENTS_REACHED` → state `full`, `retryAt = now + 30000`, không dùng backoff;
  - hết 30 s → kết nối lại; `retryNow()` → kết nối ngay;
  - vẫn đầy → `full` lại với đếm ngược mới.
- [X] T044 [P] [US2] Bổ sung test tích hợp trong `server/websocket/tests/live_hub_test.cpp`: `maxClients` lấy `min(config, project)`; ca thứ 11 nhận `error MAX_CLIENTS_REACHED` + close 4429 và `rejectedTotal` tăng; im > 15 s → close 4408, `timeoutClosedTotal` tăng, slot trống — **ghi chú khi làm:** đến hết Sprint 1 (commit `60578be`) **chưa có** các ca này trong `live_hub_test.cpp` hay test nào khác (hub không xử lý 4429/4408). Phần mã nằm ở `CivetLiveTransport` và `server/main.cpp` (T046), mới được kiểm ở mức `SessionManager` (`session_manager_test`: từ chối phiên thứ 11, hết hạn heartbeat) và bằng load-tester trên BL335 (`sprint1-load.json`, `sprint1-slot.txt`). Test tích hợp cho transport là việc mở (handoff mục 3, việc 8). **Đã thêm ngày 2026-10-11 (GĐ 0):** test chạy CivetWeb thật trong tiến trình trên x64, ở `server/websocket/tests/civet_transport_test.cpp` (không ở `live_hub_test.cpp`): `CivetTransport.EleventhClientGetsMaxClientsReachedAnd4429`, `FullMessageNamesTheEffectiveLimit`, `SilentSessionIsClosed4408AndItsSlotFreed`, `CloseDeadlineCutsAClientThatNeverAnswers`, `FrameOver96KiBIsRefusedWith1009`, `ShortWriteDropsTheSession`. Phần `min(config, project)` ở `Startup.EffectiveMaxClientsIsTheSmallerLimit`
- [X] T045 [US2] Cài trạng thái `full` trong `packages/live-client/src/connection.ts` đạt T043. Sửa `shouldRetry` cũ (bỏ quy tắc "không thử lại khi 4429")
- [X] T046 [US2] Cài 4429/4408 + bộ đếm trong `server/websocket/civet_transport.cpp` và `server/main.cpp` (ticker gọi `expireIds` → `transport.close(sid, 4408)`) đạt T044
- [X] T047 [US2] Giao diện trạng thái `apps/runtime-web/src/status.ts`: badge "Đang kết nối / Trực tuyến / Mất kết nối / Đầy". Khi đầy: hộp thông báo "Hệ thống đã đạt tối đa 10 kết nối. Vui lòng thử lại sau." + đếm ngược giây + nút "Thử lại ngay". `?debug=1` hiện `seqGaps`, `deltas`, `sequence`
- [X] T048 [US2] Cập nhật `tools/load-tester/main.go`, `slottest.go` sang protocol 1.0.0: subscribe danh sách Tag (`-tags sim` = 500 `SIM.*`, `-tags demo` = 5 Tag mẫu), đọc `hello.protocolVersion`, delta theo index. Đo độ trễ = thời điểm nhận − `delta.ts`, hiệu chỉnh lệch đồng hồ bằng offset ước lượng từ `hello`/heartbeat (RTT/2), báo p50/p95 (SC-004). Giữ `-proto 0` cho PoC. Cập nhật `stats_test.go` nếu cấu trúc đổi; `go test` xanh — **ghi chú khi làm:** load-tester **không** đọc `hello.protocolVersion` (không kiểm MAJOR khi chạy `-proto 1`). Độ trễ không hiệu chỉnh bằng RTT/2 mà đo so với bản tin nhanh nhất (báo cáo nghiệm thu, hạn chế 2). **Ngày 2026-10-11 (GĐ 0):** load-tester đã đọc `hello.protocolVersion`; MAJOR khác 1 thì báo `protocolMismatch` và thoát 1 (test `TestProtocolMajor`). Bản ghi kết quả có thêm `startedAt` đúng thời điểm bắt đầu, `finishedAt`, `host`, `tags`, `build` (`TestBuildInfo`)
- [X] T049 [US2] Chạy `go run . -clients 10 -extra 1 -duration 60` và `-slot-test` với x64; ghi kết quả vào `docs/reports/sprint1-acceptance.md` (mục "US2 — x64") — **ghi chú khi làm:** đã chạy trên x64 (2026-10-10 07:58–08:00 UTC) với `-duration 30`: 10 client 0 mất sequence, client 11 nhận 4429; `-slot-test` đạt (4408 sau 15,2 s). Đầu ra không lưu file, báo cáo không có mục "US2 — x64": số đo nghiệm thu lấy trên BL335 (T075, T077)

---

## Phase 5: User Story 3 — Tự kết nối lại và đồng bộ lại (P1)

**Goal**: mất mạng → STALE trong ≤ 15 s; có mạng → tự kết nối, snapshot mới, không tải lại trang; sequence nhảy → subscribe lại.

**Independent Test**: test Vitest với timer giả. Trên x64: `docker pause`/`docker unpause` container trong 30 s, quan sát tab.

- [X] T050 [P] [US3] Test bổ sung `packages/live-client/src/connection.test.ts`:
  - backoff 1, 2, 4, 8, 16, 30, 30 s × jitter [0,5; 1,0] (random inject được); đặt lại sau snapshot;
  - watchdog: không nhận gì > 15 s → đóng 4001 + `offline`;
  - khi `offline` phát `change` STALE cho mọi Tag (giữ giá trị);
  - `needResync` → gửi lại `subscribe` với `requestId` mới (không đóng kết nối);
  - `resync_required` / 4409 / 4408 / 1006 → backoff;
  - `protocolVersion` MAJOR khác → `incompatible`, không thử lại;
  - subscribe lại tự động sau mỗi lần kết nối.
- [X] T051 [US3] Cài backoff, watchdog, STALE, resubscribe, `incompatible` trong `packages/live-client/src/connection.ts` đạt T050 — **ghi chú ngày 2026-10-11 (GĐ 0, D-12):** đóng 1008/1009 ghi `console.error` như contract
- [X] T052 [US3] `apps/runtime-web/src/status.ts`: badge "Mất kết nối" + thời điểm cập nhật cuối. Phần tử ở trạng thái STALE hiển thị theo `onBadQuality` (DomApplier nhận quality `STALE`). Thêm test DOM trong `apps/runtime-web/src/status.test.ts`
- [X] T053 [US3] Kiểm chứng trên x64 (pause/unpause container ≥ 30 s) và ghi vào `docs/reports/sprint1-acceptance.md` (mục "US3 — x64")

---

## Phase 6: User Story 4 — Client chậm không làm hại client khác (P2)

**Goal**: hàng đợi > 256 KB → `resync_required` + close 4409; 9 client khác không mất sequence; RSS phẳng.

**Independent Test**: `go run . -clients 9 -slow 1 -duration 600` với x64 (và BL335 ở US6).

- [X] T054 [P] [US4] Test bổ sung `server/websocket/tests/live_hub_test.cpp`: `FakeTransport` trả `Overflow` cho một phiên → hub gỡ phiên khỏi danh sách nhận delta ngay, yêu cầu close 4409, `overflowClosedTotal` tăng; phiên khác vẫn nhận đủ sequence
- [X] T055 [US4] Cài xử lý `Overflow` trong `server/websocket/live_hub.cpp` và `civet_transport.cpp` (queue chỉ còn `{"type":"resync_required","reason":"SEND_QUEUE_OVERFLOW"}` → writer gửi rồi close 4409; writer bị chặn quá `request_timeout_ms` → kết nối bị cắt). Đạt T054
- [X] T056 [US4] Thêm `-slow N` vào `tools/load-tester` (client ngừng đọc socket sau snapshot, giảm `SO_RCVBUF` nếu được) và ghi các trường: client chậm nhận `resync_required`/4409 sau bao lâu; nhịp delta p95 của client thường; 0 mất sequence. Có test `go test` cho phần thống kê mới — **ghi chú khi làm:** load-tester **không** ghi thời điểm client chậm bị cắt: ở chế độ `-slow` client chờ hết `-duration` rồi mới đọc lại (`drain`), và `drain` không ghi `closedAfterMs`. Client ngừng đọc hẳn bị máy chủ bỏ do ghi quá hạn (không nhận được `resync_required`/4409); bằng chứng lấy từ `system/info.writeFailedTotal` và log máy chủ (T076). **Ngày 2026-10-11 (GĐ 0):** thêm `terminatedAfterMs` cho client chậm (lần ghi hoặc đọc lỗi đầu tiên; là cận trên, sai khoảng 1–2 chu kỳ heartbeat 2 s), và `slowTerminated`, `maxSlowTerminatedAfterMs` trong phần tổng (test `TestFirstFailureKeepsTheFirstTime`). Chưa đo lại trên BL335
- [X] T057 [US4] Chạy `-clients 9 -slow 1 -duration 600` trên x64, theo dõi RSS (`docker stats`). Ghi `docs/reports/sprint1-acceptance.md` (mục "US4 — x64"). Nếu cơ chế cắt kết nối của CivetWeb không hoạt động thì áp dụng dự phòng ở research R4 và ghi lại — **ghi chú khi làm:** trên x64 không kết luận được: proxy cổng của Docker Desktop chặn cả hai chiều khi client ngừng đọc (heartbeat của client không tới máy chủ → 4408). Đã chuyển sang đo trên BL335 (T076)

---

## Phase 7: User Story 5 — Project viết tay theo schema v0 được kiểm tra trước khi chạy (P2)

**Goal**: validator đầy đủ luật ở cả TS và C++, cùng kết luận trên bộ vector; runtime không kích hoạt project lỗi.

**Independent Test**: `npm test -w @mat/project-schema`, ctest `project_validator`, CLI trên vector; khởi động `mat-runtime` với project lỗi → 503 + `system/info.project.status = "invalid"`.

- [X] T058 [P] [US5] Tạo bộ vector `tests/project-vectors/`. Mỗi case là thư mục project + `expected.json`:
  - ≥ 3 case hợp lệ: `valid-tank-demo` (bản sao project mẫu), `valid-minimal`, `valid-all-targets`;
  - ≥ 1 case cho **mỗi** mã: `E_JSON`, `E_SCHEMA`, `E_SCHEMA_VERSION`, `E_RUNTIME_TOO_OLD`, `E_FILE_MISSING`, `E_PATH` (`../x.svg`, `/etc/passwd`, `C:\x.svg`), `E_SCREEN_ID`, `E_DUP_TAG`, `E_TAG_RANGE`, `E_DUP_UID`, `E_DUP_BINDING`, `E_REF_UID`, `E_REF_TAG`, `E_TARGET_UNSUPPORTED`, `E_TRANSFORM_UNSUPPORTED`, `E_TYPE_MISMATCH`, `E_SCALE_RANGE`, `E_MAX_CLIENTS`.
- [X] T059 [P] [US5] Test `packages/project-schema/src/vectors.test.ts`: duyệt `tests/project-vectors/*`, so **tập mã lỗi** với `expected.json`. Thêm test `W_UID_NOT_IN_SVG` (chỉ TS, ngoài vector)
- [X] T060 [P] [US5] Test `core/project-manager/tests/project_validator_test.cpp`: duyệt cùng thư mục vector (đường dẫn truyền qua định nghĩa CMake `MAT_VECTORS_DIR`), so tập mã lỗi; kiểm `allowlist()` trả đúng các `svgFile` — **ghi chú khi làm:** không có `MAT_VECTORS_DIR`; test dùng `MAT_SOURCE_DIR` (định nghĩa cho mọi `mat_test` trong `CMakeLists.txt`) + `/tests/project-vectors`
- [X] T061 [US5] Cài các luật liên file trong `packages/project-schema/src/rules.ts`: path an toàn ("tương đối dùng `/`, không `..`, không bắt đầu `/` hay ký tự ổ đĩa, không `\`, `:`, ký tự điều khiển; ≤ 128 ký tự"), phiên bản `^0\.1\.\d+$` và đồng nhất giữa các file, so `minRuntimeVersion`, ID/UID/binding trùng, tham chiếu, kiểu và transform/đích, `E_MAX_CLIENTS` thay `E_SCHEMA` cho `maxClients`, `W_UID_NOT_IN_SVG` (DOMParser khi có, bỏ qua ở Node không có DOM). Đạt T059 — **ghi chú ngày 2026-10-11 (GĐ 0):**
  - phiên bản schema chặt `^0\.1\.\d+$` ở cả hai bản (audit FR-007);
  - thêm mã `E_SCREEN_TAGS` cho màn hình dùng quá 1.000 Tag (giới hạn `subscribe`);
  - hai bản xử lý BOM, UTF-8 hỏng, surrogate lẻ, số nguyên viết dạng `10.0` như nhau (audit FR-008).

  Bộ vector nay có 82 ca (13 hợp lệ, 69 không hợp lệ), TS và C++ đều 82/82
- [X] T062 [US5] Cài `core/project-manager/project_loader.hpp/.cpp` + `project_validator.hpp/.cpp` (nlohmann + valijson nạp `schemas/*.json`, thư mục schema là tham số; cùng luật và mã lỗi như T061; giới hạn file 1 MB; `allowlist()`). Đạt T060 — **ghi chú khi làm:** không tách `project_loader.*`: phần nạp project (`LoadedProject`, `activeJson`, allowlist) nằm trong `project_validator.hpp/.cpp`
- [X] T063 [US5] Nối validator vào `server/main.cpp`: validate khi khởi động. Lỗi → không nạp Tag project (provider vẫn chạy `SIM.*` nếu `simLoad`), `system/info.project.status` = `invalid` kèm `errors`, `/api/v1/projects/active` 503, `hello.project = null`. Ghi log lỗi. Cài chế độ `--check-project` (in JSON kết quả, thoát 0/1, không mở cổng). Không thoát tiến trình. Thêm test tích hợp nhỏ trong `server/tests/startup_test.cpp` (project vector lỗi → trạng thái invalid) — **ghi chú khi làm:** phần nối validator vào `main.cpp`, trạng thái `invalid`, 503 và chế độ `--check-project` đã làm và đã kiểm bằng tay trên x64 (vector `invalid-ref-tag`). **Chưa có** `server/tests/startup_test.cpp` (test tự động) → còn mở. **Xong ngày 2026-10-11 (GĐ 0):** tách `activateProject()` và `effectiveMaxClients()` sang `server/startup.{hpp,cpp}`, `main.cpp` dùng lại. `server/tests/startup_test.cpp` có 6 test: `EffectiveMaxClientsIsTheSmallerLimit`, `InvalidProjectIsNotActivatedButReported`, `MissingProjectIsReportedAsMissing`, `ValidProjectIsActivatedWithTheSmallerLimit`, `IntegralFloatMaxClientsCounts`, `InvalidProjectKeepsServingInfoAndActiveIs503` (CivetWeb trong tiến trình)
- [X] T064 [US5] CLI `tools/project-validator/validate.mjs <dir>`: in JSON kết quả, mã thoát 0/1/2. Thêm script `npm run validate:project` ở `package.json` gốc
- [X] T065 [US5] Thêm bước "validate project mẫu" vào `tools/ci-local.ps1` và `.github/workflows/ci.yml` (sau typecheck)

---

## Phase 8: User Story 6 — Triển khai và vận hành trên BL335 (P2)

**Goal**: `mat-runtime` chạy bằng systemd trên BL335, truy cập được tại `http://192.168.1.110:8080/`, có Origin + CSP. Mọi số đo nghiệm thu lấy trên thiết bị.

**Independent Test**: quickstart §4, §6–§8 trên BL335.

### Bảo mật (T058 của Sprint 0)

- [X] T066 [P] [US6] Test `server/tests/origin_test.cpp` cho hàm thuần `isOriginAllowed(origin, hostHeader, allowed)`:
  - không có Origin → cho;
  - `http://<host>` trùng Host (kể cả cổng) → cho;
  - `http://tauri.localhost` khi có trong danh sách → cho;
  - `http://evil.example`, `null`, `http://192.168.1.110.evil.example` → chặn;
  - so sánh không phân biệt hoa thường phần host.
- [X] T067 [US6] Cài `server/websocket/origin.hpp/.cpp` đạt T066. Nối vào connect handler của `civet_transport.cpp` (trả 403 trước khi lấy slot, tăng `originRejectedTotal`). Load-tester thêm `-origin <url>`
- [X] T068 [US6] Header CSP: trang runtime (`index.html`, `/`) và file project (`/project/**`) đúng nguyên văn trong [contracts/http-api.md](contracts/http-api.md). Bỏ CSP `<meta>` trùng trong `apps/runtime-web/index.html` nếu xung đột. Thêm test HTTP trong `server/tests/http_headers_test.cpp` (khởi động server x64 trên cổng ngẫu nhiên, kiểm header, 404 ngoài allowlist, 405 với POST) — **ghi chú khi làm:** CSP/nosniff/404/405 kiểm bằng công cụ `tools/measure/http-check.mjs` (chạy với máy chủ thật trên x64 và BL335, PASS) thay cho `server/tests/http_headers_test.cpp`; meta CSP cũ đã bỏ khỏi index.html
- [X] T069 [US6] Fixture an ninh `tests/project-vectors/valid-script-svg/` (SVG có `<script>`, `onload`): hợp lệ về schema nhưng runtime web sanitize bỏ script. Kiểm thủ công trên x64: mở thẳng `/project/screens/...svg`, script không chạy do CSP `sandbox`. Ghi kết quả vào `docs/reports/sprint1-acceptance.md` — **ghi chú khi làm:** `http-check.mjs --script-svg` trên x64 với project `valid-script-svg`: script không chạy khi mở thẳng SVG (CSP sandbox) và bị lọc trong trang runtime — [sprint1-http-x64-script-svg.json](../../docs/reports/sprint1-http-x64-script-svg.json)

### Đóng gói và deploy

- [X] T070 [P] [US6] `deployment/config/runtime.json` (mặc định theo contract) và `deployment/systemd/mat-runtime.service`: `User=matscada`, `MemoryMax=300M`, `Restart=always`, `RestartSec=2`, `NoNewPrivileges=true`, `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `ReadOnlyPaths=/opt/mat-runtime /etc/mat-runtime`, `ExecStart=/opt/mat-runtime/bin/mat-runtime --config /etc/mat-runtime/runtime.json`, `After=network-online.target`
- [X] T071 [US6] `deployment/package-runtime.ps1`: gom `build/armhf/bin/mat-runtime`, `apps/runtime-web/dist-device/`, `projects/tank-demo/`, `schemas/`, config, service vào `build/mat-runtime-armhf.tar.gz`. **Thất bại** nếu gói chứa `unsafe-elements.svg`, `lab`, `tests/` hay fixture. Kèm `deployment/device/deploy.sh` và `rollback.sh` (stage → validate `--check-project` → backup `.prev` → activate → health check 15 s → tự rollback khi lỗi; Constitution VII). In danh sách file và kích thước
- [X] T072 [P] [US6] Viết `docs/deployment/mat-runtime.md` (tiếng Việt): yêu cầu, kiểm cổng, dừng `mat-poc`, cài, cấu hình, kiểm tra, xem log (`journalctl -u mat-runtime`), **hoàn tác** từng bước, cập nhật phiên bản qua `deploy.sh`, rollback qua `rollback.sh`, cách thêm origin Studio dev (`http://localhost:1420`) khi thử nghiệm — **ghi chú khi làm:** bản đầu thiếu yêu cầu phía thiết bị, bước kiểm cổng/dừng `mat-poc`, file `.sha256` trong lệnh chép gói và bảng hoàn tác từng bước; đã bổ sung ngày 2026-10-11 sau audit Sprint 1
- [X] T073 [US6] 🔌⚠️ Deploy lên BL335 theo `docs/deployment/mat-runtime.md`: — **ghi chú khi làm:** 5 lần `deploy.sh` (2026-10-10 08:45–09:45 UTC, [device-changes.md](../../docs/reports/device-changes.md)); trước lần đầu đã kiểm cổng 8080 trống và `mat-poc` không cài thành dịch vụ, nên không phải dừng gì. **Chưa chạy thử `rollback.sh`**: cần người dùng cho phép rõ trên thiết bị (hoặc chạy trong container x64 có systemd); là việc của người dùng ở GĐ 0. Nhánh tự rollback của `deploy.sh` (gọi `rollback.sh`, khôi phục cả unit) đã chạy một lần trên BL335 trong feature 003 (17:50 UTC: bản 0.3.0 lỗi khi khởi động, dịch vụ về lại 0.2.0), rồi deploy lại lúc 18:19 UTC. **Ngày 2026-10-11 (GĐ 0):** có test `deployment/device/tests/deploy_rollback_test.sh`, chạy trong container dùng một lần với lệnh hệ thống giả, nằm trong `ci-local.ps1` và CI. Test kiểm rollback trả đúng cặp binary + unit, kể cả khi deploy dừng giữa chừng. Kèm theo là hai lần sửa `deploy.sh`: (1) unit không đổi thì xóa `.service.prev` cũ (review R-16); (2) chỉ đổi `.service.prev` sau khi đã backup. `rollback.sh` vẫn chưa chạy tay trên BL335
  - `ss -ltnp`; `systemctl disable --now mat-poc` (dịch vụ của dự án, Sprint 0);
  - cài `/etc/mat-runtime/runtime.json` + service; triển khai bằng `deploy.sh` (lần đầu: không có `.prev`); thử `rollback.sh` một lần rồi deploy lại.
  - Ghi từng thay đổi vào `docs/reports/device-changes.md` kèm cách hoàn tác.
  - **Không** đụng `atscada-*`.
- [ ] T074 [US6] 🔌 Kiểm tra sau deploy: — **ghi chú khi làm:** đã làm: system/info active, CSP, 404 unsafe-elements, Origin 403 (http-check PASS), `kill -9` → lên lại sau 2,4 s. **Chưa làm: reboot BL335** (chờ người dùng đồng ý)
  - `curl` `system/info` (`project.status=active`), header CSP, `/screens/unsafe-elements.svg` → 404, Origin lạ → 403;
  - `kill -9` → tự lên ≤ 10 s; `reboot` → trang truy cập được (SC-010, SC-013).
  - Ghi vào `docs/reports/sprint1-acceptance.md`.

### Đo trên thiết bị

- [X] T075 [US6] 🔌 Đo ngân sách: load-tester `-host 192.168.1.110 -clients 10 -extra 1 -tags sim -duration 300` song song `sample.sh sprint1-10c-500tag 300 <pid>` trên BL335. Lưu `docs/reports/sprint1-load.json`, `docs/reports/sprint1-budget.csv`. Ghi độ trễ p50/p95 (SC-004). So với SC-005 (RSS ≤ 150 MB, CPU TB ≤ 30 %, đỉnh ≤ 60 %); vượt thì ghi ADR
- [X] T076 [US6] 🔌 Client chậm trên BL335: `-clients 9 -slow 1 -duration 600` + `sample.sh` (RSS phẳng). Lưu `docs/reports/sprint1-slow.json` (SC-006) — **ghi chú khi làm:** 600 s qua Internet (deploy 1, `sprint1-slow.json`): 9 client 0 mất sequence, RSS 3,8–4,4 MB (lên 4,4 MB ở giây ~575, xem báo cáo nghiệm thu SC-006). Client chậm bị bỏ do ghi quá hạn 10 s: lần 200 s sau deploy 2 ([sprint1-slow-deploy2.json](../../docs/reports/sprint1-slow-deploy2.json), `writeFailedTotal` = 1, log: hàng đợi 190 KB). Phát hiện slot chưa được trả ngay khi ghi lỗi → đã sửa (deploy lần 3) và kiểm lại 90 s ([sprint1-slow-deploy3.json](../../docs/reports/sprint1-slow-deploy3.json)): `clients` = 9 ở lần đọc `system/info` đầu tiên có `writeFailedTotal` = 1. Chưa chạy lại sau deploy 4
- [X] T077 [US6] 🔌 Race đăng ký `-resub 100` (0 mất sequence, FR-020) và `-slot-test` (4408 khoảng 15 s). Lưu `docs/reports/sprint1-resub.json`, `docs/reports/sprint1-slot.txt`. Thêm cờ `-resub N` vào load-tester trước đó
- [ ] T078 [US6] Nghiệm thu Chrome thật theo quickstart §5 (10 tab trên ≥ 2 máy, tab 11, rút cáp ≥ 30 s, F5 đồng thời, tab ẩn). **Cần người dùng thao tác các máy client**; ghi cấu hình thực tế và kết quả vào `docs/reports/sprint1-acceptance.md`. Mục nào chưa làm ghi "chưa đo" — **ghi chú khi làm:** **chưa làm** — cần người dùng thao tác 10 tab Chrome trên ≥ 2 máy, tab 11, rút cáp, F5 đồng thời

---

## Phase 9: User Story 7 — Studio cấu hình và xem trước (P3)

**Goal**: Studio mở/kiểm/sửa/lưu project, kết nối thiết bị, xem trước sống, mở web thiết bị.

**Independent Test**: quickstart §9.

- [X] T079 [P] [US7] Test Rust trong `apps/studio/src-tauri/src/project_fs.rs` (`#[cfg(test)]`, thư mục tạm): — **ghi chú khi làm:** đến hết Sprint 1 (commit `60578be`), ca symlink chỉ có bản `#[cfg(unix)]` nên không chạy trên Windows (`cargo test --lib` 4/4 là 4 trong 5 test), và chưa có ca ghi lỗi giữ nguyên file cũ. Ngày 2026-10-11 (sau audit) đã thêm vào `project_fs.rs` test Windows cho thoát root qua junction và test ghi lỗi giữ nội dung cũ; báo cáo Sprint 1 chưa có số chạy của các test này. Số chạy ngày 2026-10-11: `cargo test --lib` 10/10 trên Windows:

  - `rejects_unsafe_paths`, `reads_inside_root_only`;
  - `classifies_read_errors`, `refuses_big_files`, `reads_svg_up_to_5_mb`, `file_names_are_case_sensitive`;
  - `junction_escape_is_blocked`;
  - `writes_atomically_and_only_json`, `failed_rename_keeps_the_old_entry`, `failed_write_keeps_old_content`.

  `symlink_escape_is_blocked` chỉ biên dịch trên unix
  - `resolve_in_root(root, rel)` chặn `..`, đường dẫn tuyệt đối, `C:`, `\`, symlink ra ngoài root, đuôi khác `.json`/`.svg`;
  - đọc file > 1 MB → lỗi;
  - ghi atomic (file tạm + rename) giữ nguyên file cũ khi ghi lỗi.
- [X] T080 [US7] Cài `apps/studio/src-tauri/src/project_fs.rs` + lệnh `project_read`, `project_write` trong `lib.rs` đạt T079. Thêm `tauri-plugin-dialog`, `tauri-plugin-opener` (Cargo + npm `@tauri-apps/plugin-dialog@^2.8`, `@tauri-apps/plugin-opener@^2.7`). `capabilities/default.json` chỉ cấp `dialog:allow-open` và `opener:allow-open-url` (scope `http://*`, `https://*`) — **ghi chú khi làm:** chặt hơn mô tả: dialog và opener chỉ được gọi từ lệnh Rust (`project_pick`, `open_device_web`; crate `tauri-plugin-dialog`, `tauri-plugin-opener`), không cài package npm `@tauri-apps/plugin-*`; `capabilities/default.json` chỉ có `core:default`, giao diện không có quyền gọi plugin trực tiếp
- [X] T081 [P] [US7] Test `apps/studio/src/project-form.test.ts` (Vitest) cho `applyProjectEdits(model, edits)`:
  - sửa `projectName` / `projectVersion` (SemVer) / `entryScreen` (phải thuộc `screens`) / `maxClients` (1–10, 11 → lỗi `E_MAX_CLIENTS`) / Tag (thêm, sửa, xóa; id trùng → `E_DUP_TAG`; xóa Tag đang được binding dùng → `E_REF_TAG`);
  - giữ nguyên thứ tự khóa và trường không sửa; `serialize()` 2 dấu cách + xuống dòng cuối file.
- [X] T082 [US7] Cài `apps/studio/src/project-form.ts` đạt T081 (dùng `@mat/project-schema` để validate toàn bộ trước khi cho lưu) — **ghi chú ngày 2026-10-11 (GĐ 0, audit FR-033):** form chỉ ghi dòng thực sự sửa: gộp ô đã sửa vào bản sao Tag gốc, giữ thứ tự khóa, không trim các trường không chạm. `filesToWrite` không ghi lại file không đổi
- [X] T083 [P] [US7] Test `apps/studio/src/device.test.ts`: chuẩn hóa địa chỉ (`192.168.1.110` → `http://192.168.1.110:8080`, có cổng, có `http://`; từ chối scheme khác); `checkDevice()` với fetch giả (200 → thông tin; timeout 3 s / lỗi mạng → "Không kết nối được"); lưu và đọc `localStorage` có try/catch
- [X] T084 [US7] Cài `apps/studio/src/device.ts` đạt T083
- [X] T085 [US7] Cài `apps/studio/src/tauri-source.ts` (`ProjectSource` qua `invoke('project_read')`) và `apps/studio/src/preview.ts`: dùng `mountScreen` + `DomApplier` + `LiveConnection` tới `ws://<device>/api/v1/live` với SVG/bindings **cục bộ**; nút dừng xem trước (giải phóng slot); hiển thị trạng thái `full`/`offline` — **ghi chú ngày 2026-10-11 (GĐ 0, audit FR-032):**
  - `project_read` trả lỗi đã phân loại (`missing`, `bad-path`, `too-large`, `bad-utf8`) để bộ kiểm tra báo cùng mã với runtime;
  - SVG đọc tới 5 MB; tên file phân biệt hoa thường như trên thiết bị;
  - `ProjectSource.readText()` đổi thành `read()`, trả `ReadResult`.
- [X] T086 [US7] Viết lại `apps/studio/src/main.ts` + `index.html` + `styles.css`: thanh trên ("Mở project", tên project, trạng thái Hợp lệ/Lỗi); tab "Cấu hình" (form project + bảng Tag, nút Lưu khóa khi lỗi); tab "Kiểm tra" (danh sách lỗi: file, vị trí, lý do); tab "Thiết bị" (địa chỉ, "Kiểm tra kết nối", thông tin thiết bị, "Mở web thiết bị", "Xem trước"); tab "Xem trước". Giữ panel thông tin môi trường Sprint 0 ở mục "Giới thiệu"
- [X] T087 [US7] Sửa CSP trong `apps/studio/src-tauri/tauri.conf.json`: `connect-src 'self' ipc: http://ipc.localhost http: ws:` (giữ `script-src 'self'`, `object-src/base-uri/form-action 'none'`, `freezePrototype`). Ghi lý do trong comment README Studio
- [ ] T088 [US7] Build Studio (`CARGO_TARGET_DIR=C:\build\mat-studio`, `npm run studio:build`), cài, chạy quickstart §9 với BL335; ghi `docs/reports/sprint1-acceptance.md` (mục "US7 — Studio", SC-012) — **ghi chú khi làm:** đã build bộ cài (208 MiB) và chạy `tools/measure/studio-smoke.mjs` với bản release + BL335: IPC, chặn đọc/ghi khi chưa mở project, chặn URL lạ, kiểm kết nối thiết bị, WebSocket từ origin Studio, không lỗi CSP — PASS. **Chưa thao tác GUI end-to-end** (mở thư mục bằng hộp thoại, sửa/lưu, xem trước, đo SC-012)

---

## Phase 10: Polish & cross-cutting

- [X] T089 [P] Viết ADR `docs/adr/006-live-protocol-v1.md` (protocol 1.0.0, quy tắc MAJOR, 4409, chính sách Origin kể cả trường hợp không có Origin, tự thử lại 30 s khi 4429; đóng điểm 7 của ADR-004) và `docs/adr/007-screen-isolation.md` (Shadow DOM mỗi màn hình, theo thí nghiệm `svg-dialects.md`). Cập nhật `docs/adr/README.md`
- [X] T090 [P] Cập nhật tài liệu liên quan: `specs/001-platform-validation/contracts/live-ws.md` (ghi "đã thay bằng 002 contracts/live-ws.md"); `docs/adr/001-web-server.md` và `docs/adr/005-resource-budget.md` (số đo hàng đợi/RSS/CPU của `mat-runtime` từ T075–T076); đánh dấu T058 trong `specs/001-platform-validation/tasks.md` là đã làm ở Sprint 1 kèm liên kết; `README.md` gốc (cách chạy runtime, Studio) — **ghi chú khi làm:** đã cập nhật contract Sprint 0 (ghi đã thay thế), T058 của Sprint 0, ADR-001, ADR-005, README gốc, README Studio
- [X] T091 Cập nhật `.github/workflows/ci.yml` tương đương `tools/ci-local.ps1` (packages, validator, ctest mới, cargo test Studio nếu khả thi trên runner — nếu không thì ghi rõ chỉ chạy cục bộ) — **ghi chú khi làm:** `ci.yml` và `ci-local.ps1` **không** chạy `cargo test` của Studio: Studio chỉ build cho Windows (bộ cài NSIS), các job CI chạy `ubuntu-latest`. Test Rust chỉ chạy cục bộ trên Windows (`cd apps/studio/src-tauri; cargo test --lib`, ghi ở README gốc)
- [X] T092 Chạy `./tools/ci-local.ps1` toàn bộ → xanh (SC-011); chạy `cargo test` cho Studio. Ghi kết quả vào `docs/reports/sprint1-acceptance.md` — **ghi chú khi làm:** `ci-local.ps1`: ALL STEPS PASSED (C++ 89, Vitest 160, Go, lint, typecheck, validate, build web); `cargo test --lib` 4/4. Đó là lần chạy trước các bản vá review (T093). Lần chạy cuối trên mã Sprint 1 (2026-10-10 09:46–09:47 UTC): ALL STEPS PASSED, C++ 97, Vitest 165 ([sprint1-ci-local.txt](../../docs/reports/sprint1-ci-local.txt)); `cargo test --lib` 4/4 trên Windows (ca symlink chỉ biên dịch trên Unix)
- [X] T093 Review mã (agent code-reviewer + security-auditor cho Origin/CSP/sanitizer/project_fs); sửa phát hiện Critical/Important; ghi tóm tắt vào `docs/reports/sprint1-acceptance.md` — **ghi chú khi làm:** 2 review độc lập (code review + security audit): 1 Critical, 2 High, 3 Important, 4 Medium, 8 Minor, 3 Low. Đã sửa toàn bộ trừ hai mục chấp nhận theo thiết kế Sprint 1 (chiếm slot khi chưa có xác thực; sanitizer allowlist để Sprint 2) và CSP rộng của Studio — chi tiết và trạng thái trong [sprint1-acceptance.md](../../docs/reports/sprint1-acceptance.md). Deploy lần 4–5 mang các bản vá lên BL335; đo hồi quy không thấy suy giảm
- [X] T094 Hoàn thiện `docs/reports/sprint1-acceptance.md`: bảng SC-001…SC-013 (giá trị đo, đạt/không đạt/"chưa đo", nguồn), hạn chế, việc còn treo (T034, T036, giới hạn node 20.000, RAM OS 200/250, `atscada-admin-recover`) — **ghi chú khi làm:** báo cáo [sprint1-acceptance.md](../../docs/reports/sprint1-acceptance.md): đạt SC-004, 005, 006, 008, 009, 011; đạt một phần SC-002, 003, 010, 012, 013; chưa đo SC-001, SC-007 (cần người dùng thao tác Chrome trên nhiều máy). Đối chiếu lại với số đo gốc ngày 2026-10-11 (audit): SC-006 chuyển thành **đạt một phần** (RSS tăng 0,4 MB cuối lần chạy 600 s; chưa chạy lại sau deploy 4); sửa số của SC-004, SC-008, SC-011, số lần deploy và nguồn trích dẫn

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2 → các story.**
  - T001 chặn T013–T025 (GoogleTest, nlohmann).
  - T003 chặn T011–T012, T026–T027.
  - T006 chặn T008–T012.
- **US1** cần toàn bộ Phase 2. Đây là MVP.
- **US2, US3** cần US1 (`connection.ts` cơ bản T039, `civet_transport` T023). US2 và US3 sửa cùng `connection.ts` nên làm **tuần tự** (US2 rồi US3), nhưng test của hai story viết song song được.
- **US4** cần T019/T023 (hub + writer); độc lập với US2/US3 ở phía máy chủ.
- **US5** cần T006, T012; độc lập với US1–US4 (chỉ T063 nối vào `main.cpp`).
- **US6** cần US1–US5 xong (đóng gói bản đầy đủ). T066–T069 (bảo mật) làm được sớm sau T023/T025.
- **US7** cần T012 + T061 (validator), T036–T039 (packages hiển thị/live). Phần Rust (T079–T080) làm song song từ đầu.
- **Polish** sau cùng. T090 cần số đo từ T075–T076.

### Cơ hội chạy song song

- Phase 1: T003 ‖ T004 ‖ T005 (sau T001–T002).
- Phase 2: T011 ‖ T014 ‖ T016 ‖ T018 ‖ T020; T026 ‖ T027.
- US1: T029 ‖ T030 ‖ T031 ‖ T032 ‖ T033 (test), sau đó T034 ‖ T035 ‖ T037 ‖ T038.
- US5: T058 ‖ T059 ‖ T060.
- US6: T066 ‖ T070 ‖ T072.
- US7: T079 ‖ T081 ‖ T083.
- Polish: T089 ‖ T090.

## Implementation Strategy

1. **MVP = Phase 1–3 (US1)** trên x64: chứng minh chuỗi Tag → máy chủ → SVG động. Dừng lại kiểm chứng.
2. US2 → US3 (P1, nghiệm thu chính), US4 (rủi ro ADR-001), US5 (validator hai phía).
3. US6: đóng gói, deploy BL335, đo; nghiệm thu Chrome thật (cần người dùng thao tác máy client).
4. US7 Studio, rồi Polish.
5. Sau mỗi phase: `test-x64.ps1` + `npm test` xanh. Trước khi đóng: `ci-local.ps1` xanh.

**Tổng:** 94 task — Setup 5, Foundational 23, US1 14, US2 7, US3 4, US4 4, US5 8, US6 13, US7 10, Polish 6.
