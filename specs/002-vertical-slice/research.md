# Research — 002 Vertical slice (Sprint 1)

Ngày 2026-10-10. Mỗi mục theo dạng Quyết định / Lý do / Phương án đã xét. Mục nào cần kiểm chứng trong lúc cài đặt thì ghi "Kiểm chứng" kèm test hoặc số đo cụ thể. Không mục nào còn NEEDS CLARIFICATION.

## R1. Phiên bản JSON Schema và validator TypeScript

- **Quyết định:** schema viết theo **JSON Schema draft-07**. Validator TS dùng `@cfworker/json-schema` 4.1.1 (MIT), loại thông dịch, **không sinh code**.
- **Lý do:** Ajv biên dịch schema bằng `new Function`. Cách đó vi phạm Constitution V và bị CSP `script-src 'self'` của runtime web và Studio chặn. Muốn dùng Ajv thì phải thêm bước "standalone code" lúc build. `@cfworker/json-schema` chạy được dưới CSP chặt, đủ draft-07, không có dependency. Chọn draft-07 vì cả validator C++ (R2) lẫn TS đều hỗ trợ đầy đủ bản này.
- **Phương án đã xét:** Ajv + standalone codegen (thêm bước build, mã sinh khó review); draft 2020-12 (valijson chưa hỗ trợ đầy đủ); tự viết validator (tốn công, dễ lệch giữa hai bản).

## R2. Validator C++ và thư viện JSON

- **Quyết định:** vendor vào `third_party/` 3 thư viện:
  - `nlohmann/json` v3.11.3 (MIT, single header);
  - `valijson` v1.0.x (BSD-2-Clause, header-only, có adapter cho nlohmann);
  - `googletest` v1.15.2 (BSD-3-Clause), chỉ build cho test x64.
  Chỉ dùng nlohmann ở đường lạnh: đọc config, project, bản tin từ client. Đường nóng (delta) tự ghi chuỗi bằng `snprintf` như PoC.
- **Lý do:** đáp ứng clarification "kiểm đầy đủ JSON Schema ở máy chủ" (FR-008). Đều là header-only, license cho phép (không LGPL), không phụ thuộc thêm. GoogleTest theo Constitution (test C++ dùng GoogleTest); test `session_manager_test.cpp` hiện có được chuyển sang GoogleTest.
- **Kiểm chứng:** kích thước `mat-runtime` armhf và RSS sau khi nạp project (SC-005). Thời gian validate project mẫu trên BL335 ≤ 1 s (ghi số đo).
- **Phương án đã xét:** RapidJSON + validator đi kèm (MIT nhưng có thành phần JSON License "no evil" của một số bản cũ; API khó dùng hơn); `pboettch/json-schema-validator` (MIT, cần nlohmann, build như thư viện, ít người dùng hơn valijson); doctest thay GoogleTest (nhẹ hơn nhưng lệch Constitution).
- **License:** ghi vào `third_party/LICENSES.md` (task).

## R3. Luật kiểm tra liên file (ngoài JSON Schema) và test vector dùng chung

- **Quyết định:** các luật tham chiếu và ngữ nghĩa (ID trùng, binding → `elementUid`, binding → Tag, kiểu Tag phù hợp transform, `maxClients ≤ 10`, MAJOR tương thích, đường dẫn an toàn) được cài **ở cả hai bản** với cùng **mã lỗi** (ví dụ `E_REF_TAG`, `E_DUP_UID`). Test vector đặt tại `tests/project-vectors/<case>/` (mỗi case là một thư mục project nhỏ) kèm `expected.json` (`{"valid": false, "errors": ["E_REF_TAG"]}`). Vitest và GoogleTest cùng duyệt thư mục này và so **tập mã lỗi**, không so câu chữ.
- **Riêng luật "phần tử `data-mat-uid` có thật trong SVG":** chỉ bản TS kiểm, vì Constitution II cấm `core/` parse SVG. **Khi cài đặt:** chỉ Studio chạy luật này (cần DOMParser); CLI tắt nó (`validateProject(…, { checkSvg: false })`), runtime web không chạy validator mà dùng `mountScreen().missingUids`. Runtime web gặp UID thiếu thì bỏ binding đó và ghi cảnh báo console (edge case trong spec). Luật này nằm ngoài bộ vector dùng chung và được ghi rõ trong contract.
- **Lý do:** so mã lỗi giúp hai bản không lệch nhau mà vẫn cho phép thông báo khác câu chữ.

## R4. Hàng đợi gửi 256 KB và client chậm trên CivetWeb

- **Quyết định:**
  - Mỗi phiên được nhận có một **`SendQueue`** (logic thuần ở `core/session-manager/send_queue.hpp`, đếm theo byte, ngưỡng 256 KB) và một **thread ghi** riêng (tối đa 10 thread).
  - Bộ phát chỉ `push` vào hàng đợi, không bao giờ gọi `mg_websocket_write`.
  - Thread ghi lấy bản tin ra, rồi ghi (có thể bị chặn ở socket chậm).
  - Khi `push` làm vượt 256 KB: hàng đợi xóa nội dung, đặt cờ `overflowed`, nạp **duy nhất** bản tin `resync_required` (bỏ qua giới hạn), rồi yêu cầu đóng (mã 4409 `RESYNC_REQUIRED`). Phiên bị loại khỏi danh sách nhận delta ngay lập tức.
  - Ghi bị chặn quá lâu thì đóng nhờ timeout ghi của CivetWeb (`request_timeout_ms` = 10000). Slot được giải phóng ở `close_handler`. **Khi cài đặt:** slot được trả ngay khi hàng đợi tràn hoặc khi ghi lỗi/thiếu byte/quá hạn (`civet_transport.cpp`, bộ đếm `writeFailedTotal`), rồi máy chủ cắt TCP bằng `mg_mat_force_close`, không chờ `close_handler`.
- **Lý do:** đúng ADR-001 phương án C. Bộ phát không bao giờ chờ client. Bộ nhớ mỗi client bị chặn ở 256 KB cộng một bản tin đang ghi.
- **Kiểm chứng:**
  - Unit test `SendQueue`: ngưỡng, thứ tự, overflow, ưu tiên bản tin điều khiển.
  - Test tích hợp `slow-client` trong load-tester (cờ `--slow 1`: một client ngừng đọc socket): 9 client còn lại 0 mất sequence, client chậm nhận đóng trong ≤ 30 s, RSS ổn định 10 phút.
  - Nếu timeout ghi của CivetWeb không cắt được kết nối, phương án dự phòng là `shutdown()` socket qua `mg_get_connection_info`/fd nội bộ. Ghi kết quả vào báo cáo.
- **Phương án đã xét:**
  - Ghi không chặn bằng `poll` trên socket: CivetWeb không cung cấp API ghi không chặn.
  - Một thread ghi chung: client chậm chặn client khác.
  - Đổi sang Drogon (bất đồng bộ sẵn): ADR-001 đã chọn CivetWeb.

## R5. Tuần tự hóa snapshot + đăng ký (race Sprint 0)

- **Quyết định:** `LiveHub` (logic giao thức, độc lập CivetWeb, ở `server/websocket/live_hub.*`) giữ một mutex `hubMu`. Hai thao tác sau làm **trong cùng `hubMu`**:
  - (a) xử lý `subscribe`: lập snapshot từ `TagStore`, gán sequence, đưa snapshot vào `SendQueue` của phiên, ghi nhận đăng ký;
  - (b) mỗi chu kỳ delta: lấy thay đổi, gán sequence, `push` vào hàng đợi mọi phiên đã đăng ký.
  Vì việc đưa vào hàng đợi là nguyên tử với đăng ký, và thread ghi giữ đúng thứ tự FIFO, nên không còn khe cho delta chen giữa snapshot và lúc đăng ký. `hubMu` không bao giờ được giữ khi ghi socket.
- **Kiểm chứng:** test tích hợp 100 lần subscribe/resubscribe liên tiếp trong khi bộ phát chạy, 0 mất sequence (FR-020). Unit test `LiveHub` với transport giả.

## R6. Định dạng bản tin dữ liệu sống v1

- **Quyết định:** giữ khung contract Sprint 0 và mở rộng thành **protocol 1.0.0** ([contracts/live-ws.md](contracts/live-ws.md)):
  - `subscribe.tags` là danh sách id. Snapshot trả Tag **theo đúng thứ tự yêu cầu** (Tag lạ liệt kê ở `unknown`).
  - Delta dùng `[index, value, quality]` với index trong danh sách đó. Cách này gọn, phù hợp 500 Tag × 10 client.
  - `sequence` tính theo phiên: snapshot mang `sequence = n`, delta kế tiếp là `n+1`.
  - Gửi `subscribe` lần 2 thì **thay thế** đăng ký cũ và gửi snapshot mới.
  - `hello` có `protocolVersion`. Client từ chối MAJOR khác (hiển thị lỗi, không thử lại liên tục).
  - Giá trị theo kiểu: BOOL → `true/false`, số → number, INT64/UINT64 → chuỗi.
  - Giới hạn bản tin client: 96 KiB (ban đầu chọn 16 KB; review phát hiện không đủ cho 1000 Tag × id 64 ký tự), tối đa 1000 Tag mỗi subscribe; JSON lồng ≤ 32 mức.
  - Mỗi chu kỳ chỉ gửi delta khi có Tag đã đăng ký thay đổi; heartbeat vẫn gửi mỗi 5 s.
- **Lý do:** tương thích tư duy với PoC, kế thừa test `live.ts`, không phải sửa nhiều load-tester. Quyết định "phiên bản giao thức" còn mở từ ADR-004 điểm 7 được chốt ở **ADR-006**.
- **Phương án đã xét:** delta theo id chuỗi (tốn băng thông khoảng 3 lần với 500 Tag); MessagePack (khó debug, thêm thư viện).

## R7. Kiểm Origin và CSP (T058)

- **Quyết định:**
  - Kiểm Origin trong `websocket connect_handler` của CivetWeb (**trước** khi lấy slot). Chấp nhận khi `Origin` trùng `http://<Host header>`, hoặc nằm trong `allowedOrigins` của config (mặc định `["http://tauri.localhost", "tauri://localhost"]`, là origin của Studio Tauri 2 trên Windows). Không có header `Origin` (client không phải trình duyệt như load-tester, Go) thì chấp nhận: các client này không mang cookie phiên nên không có rủi ro CSWSH, và Sprint 1 chưa có xác thực. Từ chối thì trả HTTP 403 và tăng bộ đếm `originRejectedTotal`.
  - Header CSP:
    - trang runtime: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'` (khi cài đặt thêm `form-action 'none'`, nguyên văn ở [contracts/http-api.md](contracts/http-api.md));
    - file project (`/project/**`, gồm SVG): `default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox`.
    - Mọi phản hồi có thêm `X-Content-Type-Options: nosniff`.
  - Project được phục vụ bằng handler riêng, chỉ trả file **có trong danh sách của manifest/screen đã validate** (allowlist), không cho duyệt thư mục.
- **Lý do:** đóng review S-3 / T058. `sandbox` khiến SVG mở trực tiếp không chạy script kể cả khi lọt qua bộ lọc.
- **Kiểm chứng:** test tích hợp với Origin lạ (403, không tốn slot), Origin của Studio (chấp nhận), không có Origin (chấp nhận). Mở thẳng `/project/screens/<fixture có script>.svg` trên Chrome, script không chạy. Fixture này chỉ dùng trong test x64, không đóng gói (SC-009).

## R8. Tách package TS và số phận trang thử Sprint 0

- **Quyết định:** workspace npm `packages/*`:
  - `@mat/project-schema`: schema, kiểu TS, validator, mã lỗi. Đọc file qua interface `ProjectSource` để dùng chung cho Node CLI, Studio (Tauri) và trình duyệt.
  - `@mat/svg-renderer`: `sanitize.ts`, `inspect.ts` chuyển từ runtime-web; `mountScreen()` dựng Shadow DOM và `Map<elementUid, Element>` theo `data-mat-uid`; hàm hủy (unmount).
  - `@mat/binding-engine`: transform thuần (`direct`, `discreteMap`, `linearScale`), quy tắc chất lượng, bộ áp DOM gom theo `requestAnimationFrame`, animation quay bằng Web Animations API, tạm dừng khi tab ẩn.
  - `@mat/live-client`: `live.ts` (hàm thuần) cộng `LiveConnection` (WebSocket inject được để test, backoff 1→30 s có jitter, 4429 → chờ 30 s có đếm ngược, watchdog 15 s, STALE).

  `apps/runtime-web` chỉ còn phần ghép. Trang thử nhiều fixture của Sprint 0 chuyển thành trang dev `apps/runtime-web/lab.html`: **không** nằm trong gói thiết bị (`package-web.mjs` chỉ đóng gói `index.html` và assets). Thư mục `dist/screens` cùng fixture **không còn được copy vào gói deploy**. `tools/measure/svg-load.mjs` vẫn chạy với lab trên máy dev/x64 (truyền URL đầy đủ của `lab.html`: script chỉ thêm `?auto=1`).

  **Ngoại lệ FR-013 (ghi khi cài đặt):** binding thử của Sprint 0 (theo `data-tag`) **không** chuyển vào package. `apps/runtime-web/src/lab-binding.ts` và test của nó được giữ lại có chủ đích làm mã dev của trang lab: không đóng gói (`package-web.mjs` và `package-runtime.ps1` chặn `lab*`), đã được `@mat/binding-engine` thay thế ở trang runtime và Studio.
- **Lý do:** Constitution II. FR-013 (giữ test cũ). T058 (không deploy `unsafe-elements.svg`).
- **Kiểm chứng:** `npm test` chạy toàn bộ test cũ ở vị trí mới. Script kiểm gói (`deployment/package-runtime.ps1`) báo lỗi nếu thấy `unsafe-elements.svg` hoặc thư mục `lab`.

## R9. Hiển thị mức bồn, quay motor, đổi màu

- **Quyết định:**
  - `geometry.levelPercent`: phần tử đích là một `rect` mức nước nằm trong `clipPath` hình bồn. Binding đổi `y` và `height` theo % so với hộp bao gốc, đo **một lần** bằng `getBBox()` lúc mount (**khi cài đặt:** đọc thuộc tính `x`/`y`/`width`/`height` của `rect` một lần lúc dựng `DomApplier`, không gọi `getBBox()`). Hướng đổ đầy mặc định từ dưới lên, khai báo `direction` trong binding.
  - `transform.rotate`: hai chế độ. Giá trị số là góc tĩnh. Khi binding khai báo `animation: "spin"`, giá trị là tốc độ vòng/phút hoặc BOOL chạy/dừng; dùng Web Animations API trên phần tử với `transform-box: fill-box; transform-origin: center`, tạm dừng khi `document.hidden`.
  - `style.*`: gán thuộc tính trình bày qua `element.style`.
  - Mọi cập nhật DOM gom trong một `requestAnimationFrame`. Chỉ ghi khi giá trị tính ra khác lần trước.
- **Lý do:** Master Plan §8.3 (nguyên tắc hiệu năng Chrome). Nếu tính lại `getBBox` mỗi lần cập nhật thì gây layout thrash.
- **Phương án đã xét:** CSS animation bằng class (khó điều chỉnh tốc độ theo giá trị); SMIL (bị bộ lọc chặn đổi thuộc tính, không khuyến khích).

## R10. Mock Tag provider và ranh giới Tag Engine

- **Quyết định:**
  - `core/tag-engine/`: `TagStore` lưu giá trị, chất lượng, timestamp, revision, cờ dirty theo chỉ số; định nghĩa Tag nạp từ project (`tags.json`) cộng Tag hệ thống.
  - Interface `TagProvider { start(store); stop(); }` (**khi cài đặt:** `TagProvider { virtual void step(int64_t nowMs) = 0; }`, thread ticker của `server/main.cpp` gọi `step` mỗi `deltaPeriodMs`).
  - `drivers/simulation/MockTagProvider` gồm:
    - (a) mô phỏng bồn + motor tất định theo bước thời gian: `TANK01.LEVEL` (FLOAT32 %), `MOTOR01.RUN` (BOOL), `MOTOR01.SPEED` (FLOAT32 rpm), `TANK01.INFLOW` (FLOAT32), `TANK01.TEMP` (FLOAT32, cứ 20 s thì có 5 s BAD);
    - (b) `SIM.T0001…T0500` (FLOAT32), mỗi chu kỳ 250 ms đổi 1/4 số Tag, nên mỗi Tag đổi 1 lần/s (giữ đúng tải đo PoC). **Sửa ngày 2026-10-11 (GĐ 0, audit FR-018):** số Tag đổi mỗi lần tính theo thời gian trôi (`size × dtMs`), không theo số lần `step()`, nên mỗi Tag vẫn đổi 1 lần/s với mọi `deltaPeriodMs` 100–250.
  - Tag `SIM.*` **không** khai báo trong project mẫu. Chúng là Tag của provider và được đăng ký thêm khi bật cờ `--sim-load` (mặc định bật trên thiết bị để đo).
- **Lý do:** Constitution II (driver chỉ phát `TagUpdate`). Driver Modbus ở Sprint 2 thay provider mà không đổi hub.
- **Kiểm chứng:** unit test mô phỏng tất định (đặt thời gian giả, kiểm ngưỡng 90 %/10 %, chu kỳ khoảng 60 s, chu kỳ BAD).

## R11. Cấu hình runtime và bố trí trên thiết bị

- **Quyết định:**
  - Binary và web: `/opt/mat-runtime/{bin/mat-runtime, web/}`.
  - Project: `/opt/mat-runtime/project/` (copy thủ công; Sprint 6 chuyển sang `/var/lib` với atomic activation).
  - Config: `/etc/mat-runtime/runtime.json` gồm `port` (8080), `maxClients` (10), `allowedOrigins`, `docroot`, `projectDir`, `simLoad` (true), `deltaPeriodMs` (250).
  - Tham số dòng lệnh ghi đè config. `maxClients > 10` thì kẹp về 10 và ghi cảnh báo.
  - Service `mat-runtime.service`: `User=matscada` (khi cài đặt: do `deploy.sh` tạo ở lần cài đầu, Sprint 1), `MemoryMax=300M`, `Restart=always`, `RestartSec=2`, `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `ReadOnlyPaths=/opt/mat-runtime /etc/mat-runtime`.
  - Log ra journald (đã giới hạn ở Sprint 0).
  - **Deploy theo Constitution VII bằng script trên thiết bị** (`deployment/device/deploy.sh <tarball>`):
    1. stage: giải nén vào `/opt/mat-runtime.new`;
    2. validate: chạy `/opt/mat-runtime.new/bin/mat-runtime --check-project --project-dir /opt/mat-runtime.new/project`; lỗi thì dừng, bản đang chạy không bị đụng;
    3. backup: `/opt/mat-runtime` → `/opt/mat-runtime.prev` (xóa `.prev` cũ hơn);
    4. activate: `.new` → `/opt/mat-runtime`, rồi `systemctl restart mat-runtime`;
    5. health check: thử `curl /api/v1/system/info` trong 15 s, yêu cầu `project.status=active`;
    6. thất bại thì tự chạy `rollback.sh` (`.prev` → hiện hành, khởi động lại).
    Đây chưa phải atomic theo phân vùng/API (Sprint 6) nhưng đúng chuỗi bước và có rollback.
    **Khi cài đặt (sau review):** thêm bước 0 kiểm SHA-256 của gói; bước 2 chạy bằng `runuser -u matscada` và truyền thêm `--schemas-dir`; unit khác bản đang cài thì giữ bản cũ ở `mat-runtime.service.prev`, `rollback.sh` khôi phục cả file này; health check dùng `wget` (BL335 không có `curl`). Chi tiết: [docs/deployment/mat-runtime.md](../../docs/deployment/mat-runtime.md).
  - `mat-poc.service` của Sprint 0 đang giữ cổng 8080 nên phải **stop + disable** (không xóa file) trước khi bật `mat-runtime`. Đây là dịch vụ của chính dự án, hoàn tác được, và được ghi vào `device-changes.md`. **Khi deploy (2026-10-10):** cổng 8080 trống, `mat-poc` không được cài thành dịch vụ trên BL335 nên không phải dừng gì.
- **Lý do:** FR-028/029, Constitution III, V. Cổng 8080 vì user không đặc quyền (clarification).
- **Kiểm chứng:** `ss -ltnp` trước khi deploy; khởi động lại BL335 rồi đo thời gian dịch vụ lên (SC-010).

## R12. Studio: đọc/ghi project, kết nối thiết bị, mở web

- **Quyết định:**
  - Chọn thư mục bằng `@tauri-apps/plugin-dialog`.
  - Đọc/ghi file qua **lệnh Rust tự viết** `project_read(root, rel)`, `project_write(root, rel, content)`. Rust kiểm `rel` không có `..`, không tuyệt đối, chỉ đuôi `.json`/`.svg`, và đường dẫn sau canonicalize nằm trong `root` (`root` lấy từ dialog). Ghi atomic: file tạm rồi `rename`.
  - Mở web bằng `@tauri-apps/plugin-opener`, chỉ cho `http(s)://`.
  - **Khi cài đặt (chặt hơn):** dialog và opener chỉ được gọi từ lệnh Rust (`project_pick`, `open_device_web`; crate `tauri-plugin-dialog`, `tauri-plugin-opener`), không dùng package npm, capability chỉ `core:default`. `root` giữ trong state phía Rust sau `project_pick`; giao diện chỉ truyền `rel`: `project_read(rel)`, `project_write(rel, content)`. Studio đọc `.json`/`.svg` nhưng chỉ **ghi** `.json`.
  - **Sửa ngày 2026-10-11 (GĐ 0, audit FR-032):** `project_read` trả lỗi đã phân loại (`missing`, `bad-path`, `too-large`, `bad-utf8`), để bộ kiểm tra TS báo cùng mã với runtime C++. JSON tối đa 1 MB, SVG tối đa 5 MB (ADR-003). Tên file so phân biệt hoa thường theo từng đoạn đường dẫn, như ext4 trên thiết bị.
  - Địa chỉ thiết bị lưu ở `localStorage` của WebView (tiện ích cục bộ, không nằm trong project).
  - Kết nối thiết bị từ WebView: `fetch` `/api/v1/system/info` và WebSocket `/api/v1/live`. CSP Studio nới `connect-src` thêm `http: ws:`, vì IP thiết bị do người dùng nhập nên không biết trước. Lý do ghi trong Complexity Tracking.
  - Xem trước dùng nguyên `@mat/svg-renderer` + `@mat/binding-engine` + `@mat/live-client`.
  - Form cấu hình là hàm thuần (`applyProjectEdits(project, edits) → {project, errors}`) có test Vitest, giữ thứ tự khóa JSON và định dạng 2 dấu cách.
- **Lý do:** FR-032…037. Lệnh Rust tự viết cho phép kiểm path traversal rõ ràng và test được bằng `cargo test`, thay vì cấu hình scope plugin-fs động.
- **Phương án đã xét:** `plugin-fs` + scope từ dialog (khó giới hạn đuôi file, khó test); `plugin-http` qua Rust (vẫn cần WebSocket trực tiếp nên không bớt được CSP).
- **Build:** `CARGO_TARGET_DIR=C:\build\mat-studio` (ổ D: gần đầy).

## R13. Đo đạc và nghiệm thu trên thiết bị

- **Quyết định:**
  - Đo ngân sách bằng `tools/load-tester`, sửa để subscribe danh sách 500 Tag `SIM.*` theo protocol 1.0.0, chạy 10 client trong 300 s. Song song chạy `tools/measure/sample.sh` (1 mẫu/s) trên BL335.
  - Thêm `--slow` (client chậm), `--origin` (thử Origin), `--resub 100` (race đăng ký).
  - Nghiệm thu chức năng: 10 tab Chrome trên ≥ 2 máy (ghi cấu hình thật), tab 11, rút cáp ≥ 30 s.
  - Kết quả ghi vào `docs/reports/sprint1-acceptance.md` và `docs/reports/sprint1-budget.csv`. Mục nào chưa đo ghi rõ "chưa đo".
- **Lý do:** Constitution I, VI. Tái dùng công cụ Sprint 0.

## R14. Dung lượng đĩa máy dev

- **Quyết định:** ổ D: còn khoảng 1,1 GB. Build C++ trong Docker vẫn ghi `build/` trên D: (vài chục MB, chấp nhận), nhưng **xóa `build/x64`, `build/armhf` cũ** trước khi build lại nếu thiếu chỗ. Rust target đặt ở C:. Thư viện vendor (nlohmann khoảng 1 MB, valijson khoảng 3 MB, googletest khoảng 3 MB sau khi bỏ docs/CI) là chấp nhận được. Không cài phần mềm hệ thống.
