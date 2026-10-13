# Research: Màn hình v1, widget và điều khiển từ Chrome

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Ngày**: 2026-10-13

Phase 0 của plan. Mỗi mục gồm **Quyết định**, **Lý do**, **Phương án khác đã xét**.

- **Quyền quyết định.** Người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11. Chỗ spec để ngỏ, plan chọn phương án tốt nhất và ghi **Quyết định (người dùng giao toàn quyền 2026-10-11)**.
- **Phiên bản thư viện:** theo [ADR-009](../../docs/adr/009-studio-ui-stack.md), chỉ chọn bản phát hành ít nhất 2 tuần trước ngày chọn, tức trước 2026-09-29. Tra ngày 2026-10-13 bằng `npm view` (bảng ở R23).
- **Số đo thiết bị** lấy từ `docs/reports/`. SSH tới BL335 không có trong phiên này: mọi bước cần BL335 thành task ⚠️🔌 hoặc lệnh trong [quickstart.md](quickstart.md) §9.
- **Thí nghiệm trong scratchpad** (không vào repo), ngày 2026-10-13: ước kích thước JSON của một màn hình (R5). Không có thí nghiệm nào khác; các số còn lại là ước tính ghi rõ "chưa đo".

**Mốc so sánh** (runtime 0.5.0 trên x64; BL335 chờ SSH): trang runtime hiện dựng một màn hình SVG bằng `mountScreen` + `DomApplier`, `projects/active` trả mọi màn hình; số đo BL335 gần nhất (runtime 0.3.0, [003-acceptance.md](../../docs/reports/003-acceptance.md)): tải chuẩn 500 Tag/1 s/10 client có lưu trữ, RSS tối đa 13,7 MB, CPU hệ thống trung bình 11,7 %. Trang 0.2 đo ở Sprint 1: mở màn hình SVG đầu 216–296 ms đến dữ liệu sống ([ADR-007](../../docs/adr/007-screen-isolation.md)).

**Điều tra hiện trạng mã** (đọc ngày 2026-10-13, dùng làm cơ sở):

| Phần | Hiện trạng | Ảnh hưởng |
|---|---|---|
| `apps/runtime-web/src/main.ts` | một màn hình (`entryScreen`), không route, không widget | viết lại thành shell nhiều màn hình; giữ `reload.ts`, `status.ts`, `value-tables.ts` |
| `packages/svg-renderer` `mountScreen` | một SVG trong Shadow DOM; `viewBox`, `fitMode`, `background` từ screen 0.2 | dùng cho item `svg`; `fit` theo item |
| `packages/binding-engine` `DomApplier` | binding theo `elementUid`, gom `requestAnimationFrame` | dùng nguyên cho item `svg` |
| `packages/live-client` `LiveConnection` | có `setTags`, `onSessionEnded` (4401), `reason` | dùng nguyên; đổi đăng ký khi đổi màn hình |
| `schemas/screen.schema.json` 0.2 | `svgFile`, `bindingFile`, `viewBox`, `fitMode`, `elements` | 0.3.0 mới; 0.2 đóng băng |
| `apps/studio/src/ui/editors/screen-preview.ts` | xem trước có zoom, lưới, chọn phần tử SVG (chỉ đọc) | thay bằng editor Màn hình; giữ ba chế độ Tắt/Mô phỏng/Thiết bị |
| `apps/studio/src/ui/mat-taskcards.ts` | Toolbox giới thiệu widget "GĐ 3a" (`phase: 'p3a'`) | thành Toolbox thật |
| `server/http/*` | `auth_gate`, `viewer_gate`, `source_filter`, `tags_api`, `web_contexts`; CSP `kCspRuntime` (`script-src 'self'; style-src 'self' 'unsafe-inline'`) | thêm cookie, `web_api`, `device_crt` |
| `server/tls/server_cert.*` | tự ký ECDSA P-256, SAN chỉ `dNSName` khi hostname hợp lệ | thêm SAN IP, EKU |
| `core/auth` | `AuthService`, `SessionStore`, `LoginGuard`, token `mats_` | thêm loại phiên `web`, CSRF |
| `packages/ui-components` | **chưa có** | tạo mới |

## R1. Định dạng 0.3.0 và cấu trúc file màn hình

- **Quyết định (người dùng giao toàn quyền 2026-10-11):**
  - **Định dạng 0.3.0**, không mở rộng 0.2. `screens/<id>.screen.json` có `items`; `project.json` thêm `navigation`. Mọi file cùng `schemaVersion` `0.3.x`; `minRuntimeVersion` ≥ `0.6.0` (`E_MIN_RUNTIME`).
  - File giữ nguyên tên và vị trí: `screens/<id>.screen.json`, `screens/<id>.svg`, `screens/<id>.bindings.json` (binding của item `svg`; thêm trường tùy chọn `itemId`). Không thêm loại file mới (widget nằm trong file màn hình). Gói `.matscada` giữ 1.0.0.
  - Schema 0.2 đóng băng ở `schemas/0.2/`; `schemas/*.schema.json` thành 0.3.0; thêm `schemas/widgets.catalog.json` (R8). Bộ kiểm tra chọn schema theo `schemaVersion` của `project.json` (đã làm cho 0.1/0.2).
  - `protocol-version.json`: `project` thêm `"0.3"`; `live` giữ `1.2.0`.
- **Lý do:**
  - Cấu trúc file màn hình đổi (bắt buộc `items`, bỏ `svgFile`/`bindingFile`/`elements` ở cấp màn hình): đây không phải thêm trường tùy chọn, và ADR-004 cho phép đổi cấu trúc ở MINOR khi MAJOR = 0 kèm migration.
  - Giữ tên file để So sánh, git diff và gói không đổi; migration chỉ viết lại `*.screen.json` và `project.json`.
  - Một phiên bản cho cả bộ (ADR-004 điểm 2).
- **Phương án khác đã xét:**
  - **Mở rộng 0.2 (thêm `items` tùy chọn cạnh `svgFile`):** hai cách mô tả cùng một màn hình, validator và editor phải xử lý cả hai, dễ mâu thuẫn (`svgFile` khác item đầu). Loại.
  - **Một file riêng cho widget** (`screens/<id>.widgets.json`): xếp lớp giữa SVG và widget phải ghép hai file; diff và So sánh khó. Loại.
  - **Đổi tên file thành `*.screen.v3.json`:** phá gói và So sánh. Loại.

## R2. Hệ tọa độ thiết kế và cách co (ADR-013)

- **Quyết định:**
  - **Khung** `div` đúng cỡ `size` (đơn vị thiết kế, px CSS), `position: relative`, `overflow: hidden`; mỗi item `position: absolute` (`left`, `top`, `width`, `height`); cả khung `transform: scale(k)`, `transform-origin: 0 0`, đặt trong vùng chứa có kích thước đã co (`width = size.width·k`, `height = size.height·k`) để cuộn đúng với `fit-width` và `none`.
  - `k` theo `fitMode`: `contain = min(W/w, H/h)`; `cover = max(W/w, H/h)` (cắt phần thừa); `fit-width = W/w`; `none = 1`; `stretch` dùng `scale(W/w, H/h)`. `W`, `H` là vùng khả dụng (cửa sổ trừ thanh trên và menu). Căn giữa với `contain` và `cover`.
  - Tính lại bằng `ResizeObserver` của vùng chứa, gom theo `requestAnimationFrame` (≤ 100 ms, FR-014).
  - Vùng chứa tô `background` của màn hình (cả phần thừa khi `contain`), như `mountScreen` của 0.2; nhờ vậy màn hình 0.2 nâng cấp cho cùng hình.
  - Không dùng `zoom` (không chuẩn) và không tính lại vị trí bằng JS.
  - **Popup:** lớp phủ riêng ngoài khung mẹ (cùng cấp với khung, không nằm trong phần tử có `transform`), `<mat-screen>` với cỡ của popup, co `contain` trong 90 % cửa sổ; nền mờ `rgba`; `role="dialog"`, `aria-modal`, bẫy focus, Esc đóng.
- **Lý do:**
  - Một phép co duy nhất nghĩa là mọi thứ co đồng đều: widget, chữ, SVG, biểu đồ; con trỏ chuột vẫn trúng đúng vì trình duyệt tính theo `transform`.
  - Phép co `contain` cho 0.2 giống hệt hành vi cũ, nên nâng cấp không đổi hình (SC-011).
  - `position: fixed` bên trong phần tử có `transform` bị đổi hệ quy chiếu, nên popup phải nằm ngoài khung.
- **Phương án khác đã xét:**
  - **Lưới CSS đáp ứng:** hợp trang web, không hợp SCADA (vị trí tự do, phủ lên đồ họa). Loại.
  - **Đơn vị `vw`/`vh` cho từng item:** làm tròn pixel khác nhau giữa item, SVG và widget lệch nhau vài điểm ảnh. Loại.
  - **Tính vị trí bằng JS khi đổi cỡ:** nhiều ghi DOM mỗi lần kéo cửa sổ; một transform rẻ hơn.

## R3. Xếp lớp, id item, khóa và ẩn

- **Quyết định:**
  - Thứ tự xếp lớp là thứ tự mảng `items`, đầu ở dưới (D9). Khung dựng theo thứ tự này (DOM order, không `z-index`).
  - `id` item `^[a-z][a-z0-9_]{1,31}$`, duy nhất trong màn hình; Studio sinh `<loại>_<số>` (ví dụ `card_3`), số nhỏ nhất chưa dùng.
  - `locked` (chỉ có ý nghĩa ở Studio: không chọn, không kéo), `hidden` (**ẩn cả ở trang runtime**; một item ẩn không dựng và không đăng ký Tag của nó). Ở Studio, item `hidden` hiện mờ và vẫn chọn được từ panel Lớp.
  - Mỗi item `svg` hay `widget` có `name` hiển thị ở panel Lớp (≤ 80 ký tự).
- **Lý do:** không có hai lớp cùng cấp; "đưa lên trên" là một thao tác mảng. `hidden` ở runtime cho phép người thiết kế để sẵn item nháp mà không hiện.
- **Phương án khác đã xét:** `z` số nguyên: hai item cùng `z` có thứ tự mơ hồ, diff ồn khi chèn giữa. Loại.

## R4. Điều hướng và URL (D11, D12)

- **Quyết định:**
  - `navigation` trong `project.json`: `{ "position": "left" | "top" | "hidden", "items": [ { "label", "screen", "icon"? } | { "label", "icon"?, "items": [ { "label", "screen", "icon"? } ] } ] }`. Nhóm một cấp; ≤ 32 mục lá; `screen` phải là màn hình `kind: "screen"`; `icon` trong bộ 16 tên (home, tank, pump, chart, table, gear, bell, bolt, thermo, drop, valve, motor, list, map, doc, user).
  - Không có `navigation`: runtime sinh menu từ `screens` (không popup), vị trí `left`, nhãn là `name`; project một màn hình: không hiện menu.
  - URL: `#/<screenId>`; `hashchange` đổi màn hình; id lạ → màn hình đầu và thông báo; đổi màn hình bằng `location.hash` (nút Back hoạt động).
  - Popup không nằm trong URL; chuyển màn hình đóng popup.
  - Kiosk: `?kiosk=1` trước dấu `#` (nằm trong `location.search`, giữ qua điều hướng).
  - Menu thu gọn thành biểu tượng khi cửa sổ < 900 px.
- **Lý do:** hash hoạt động với máy chủ tĩnh CivetWeb (không cần quy tắc ghi lại URL), F5 giữ nguyên, ít bề mặt tấn công; một cấp nhóm đủ cho 32 màn hình.
- **Phương án khác đã xét:**
  - **Đường dẫn `/screen/<id>`:** cần máy chủ trả `index.html` cho mọi đường dẫn con (sửa C++ và CSP, lọc nguồn). Loại.
  - **Menu nhiều cấp:** YAGNI.
  - **Quyền xem theo màn hình** (`minRole` ở màn hình): dữ liệu live không lọc theo màn hình nên chỉ là lớp giả; không làm (D12).

## R5. Tải lười và hình dạng `projects/active` cho 0.3 (ADR-013)

- **Quyết định:**
  - Thân `GET /api/v1/projects/active` của project 0.3: `{ project, tags, valueTables, connections, navigation, screens: [ { id, name, kind, file } ] }`, không có `items`. `valueTables`: mọi bảng mà Tag (`valueTable`) hoặc widget (`props.table`) hoặc binding tham chiếu (006 chỉ gửi bảng binding dùng tới).
  - Trang tải từng màn hình bằng `GET /project/screens/<id>.screen.json`, rồi từng SVG và binding bằng đường dẫn trong item. Màn hình đầu tải song song với `projects/active` khi URL cho biết (hash hoặc `entryScreen` từ lần tải trước, không có thì tải sau).
  - Giữ tối đa 8 màn hình đã dựng dữ liệu (JSON đã parse) trong trang; không giữ DOM của màn hình đã rời.
  - Project 0.1, 0.2: thân trả về như runtime 0.5 (kèm `screens` đầy đủ); trang dùng `toScreenModel` (R6).
  - `/project/*` giữ CSP `default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox` ([ADR-007](../../docs/adr/007-screen-isolation.md); `kCspProject`) cho SVG; file `.screen.json` phục vụ `application/json`.
- **Lý do (số đo, thí nghiệm scratchpad 2026-10-13):** một item widget điển hình (card, nút, biểu đồ) dài khoảng 206–317 byte, trung bình 262; màn hình đầy 250 item ≈ **67 KB**; 32 màn hình ≈ **2,1 MB**. Mười client F5 cùng lúc (SC-003) mà mỗi client tải 2,1 MB là hơn 20 MB qua BL335 trong vài giây; chỉ tải màn hình cần là ≈ 70 KB mỗi client.
- **Phương án khác đã xét:**
  - **`projects/active` trả mọi màn hình (như hiện nay):** lãng phí như trên; thân vượt 1 MiB khi nhiều màn hình.
  - **Một endpoint `GET /api/v1/screens/<id>`:** thêm route C++ không cần thiết vì `/project/*` đã phục vụ file tĩnh đã qua kiểm tra.
  - **Tải tất cả nền sau khi mở màn hình đầu:** tốn băng thông BL335 khi 10 client; làm sau nếu đo thấy chuyển màn hình chậm (SC-002 yêu cầu ≤ 500 ms cho màn hình đã mở).

## R6. Nâng cấp 0.2 → 0.3 và bộ chuyển màn hình cũ

- **Quyết định:**
  - **Migration** `migrate02to03` trong `packages/project-schema/src/migrate.ts`, nối sau `migrate01to02`: trong bộ nhớ; viết lại `project.json` (`schemaVersion` 0.3.0, `minRuntimeVersion` ≥ 0.6.0, thêm `navigation` khi ≥ 2 màn hình), mỗi `screens/<id>.screen.json` và `*.bindings.json` (`schemaVersion`, binding thêm `itemId`), các file khác chỉ đổi `schemaVersion`. Màn hình cũ → `{ id, name, kind: "screen", size: { width: vbW, height: vbH }, fitMode, background?, items: [ { id: "svg1", name: "Đồ họa", type: "svg", x: 0, y: 0, width: vbW, height: vbH, svgFile, bindingFile, viewBox, fit: "contain", elements } ] }`. Sao lưu `.mat-backup/` như 006; hộp thoại Nâng cấp / Mở chỉ đọc / Hủy dùng lại của 006 (`upgrade-dialog.ts`).
  - Project 0.1 nâng qua 0.2 rồi 0.3 trong một lần, một thư mục sao lưu.
  - **Bộ chuyển** `toScreenModel(screen, bindings)` (cùng package): với màn hình 0.1/0.2 trả mô hình v1 (đúng như migration, không ghi file). Trang runtime và xem trước Studio gọi nó, nên chỉ có một đường dựng.
  - `viewBox` có gốc khác 0 (ví dụ `10 20 800 600`): `size` = rộng × cao; item `svg` giữ `viewBox` cũ nên SVG vẫn hiện đúng vùng.
- **Lý do:** giữ SC-011 (cùng DOM và giá trị); một đường dựng giảm nhánh mã; migration thuần, kiểm bằng cặp file mẫu.
- **Phương án khác đã xét:** runtime C++ tự viết lại màn hình cũ thành 0.3 khi đọc: logic ở hai ngôn ngữ, và runtime không được sửa file project (nguyên tắc 005: kho project bất biến sau kích hoạt).

## R7. Thư viện widget: Lit, Shadow DOM, `TagSource`, `ActionHost` (ADR-019)

- **Quyết định:**
  - `packages/ui-components` (workspace mới `@mat/ui-components`): Lit 3.3.3 (đã dùng ở Studio). Phần tử `mat-w-<loại>`, Shadow DOM `open`, `adoptedStyleSheets`.
  - **`TagSource`** và **`ActionHost`** như ADR-019 (kiểu đầy đủ ở [contracts/ui-components-api.md](contracts/ui-components-api.md)). Trang runtime cấp `LiveTagSource` (bọc `LiveConnection`, giữ bản đồ giá trị mới nhất, hạn `STALE` khi mất kết nối) và `WebActionHost` (fetch có cookie, CSRF); Studio cấp `SimTagSource`/`DeviceTagSource` và `StudioActionHost`.
  - **`<mat-screen>`** (thành phần dựng màn hình, ADR-013 điểm 5): nhận mô hình màn hình, `TagSource`, `ActionHost`, hàm `loadSvg(path)`, chế độ (`run` | `edit`); dựng item, gắn `DomApplier` cho item `svg`, đăng ký Tag qua `TagSource.subscribe` (tập Tag của màn hình), co theo `fitMode`.
  - Mỗi widget nhận **thuộc tính JS** (`.props`, `.tags`, `.tagInfo`, `.host`), không nhận chuỗi HTML hay thuộc tính HTML chứa dữ liệu project. Cập nhật giá trị qua `TagSource.subscribe`, widget tự gom cập nhật vào `requestAnimationFrame` (Lit `requestUpdate`).
  - Token CSS `--mat-*` (màu nền, chữ, nhấn, tốt/cảnh báo/lỗi/thông tin/online/offline, bo góc, cỡ chữ) do nơi chứa định nghĩa trên `:root`; trang runtime dùng cùng bảng token với Studio ([studio-ux.md](../../docs/architecture/studio-ux.md) §7), sáng/tối.
- **Lý do:** một widget chạy ở hai nơi; xem trước bằng mô phỏng không sửa widget; `<mat-screen>` bảo đảm Studio và Chrome dựng giống nhau (Constitution II).
- **Phương án khác đã xét:** widget tự mở `LiveConnection` (mỗi widget một đăng ký: vượt 10 phiên, nhiều đăng ký trùng); kho Tag toàn cục (khó thay bằng mô phỏng, khó kiểm thử); thư viện widget ngoài (Shoelace, Material Web: nặng, không có widget SCADA, tự định kiểu khó hợp token).

## R8. Danh mục widget và validator hai bản (ADR-019)

- **Quyết định:**
  - `schemas/widgets.catalog.json` (phiên bản `0.3.0`): mảng 15 mục; cấu trúc ở [contracts/widget-catalog.md](contracts/widget-catalog.md).
  - **Bản TS** (`packages/project-schema/src/rules-03.ts`) import danh mục như dữ liệu (đóng gói bằng bundler); **bản C++** (`core/project-manager/rules_03.cpp`) đọc file từ `schemasDir` lúc khởi động (cùng nơi schema JSON), parse một lần, giữ trong bộ nhớ (≈ 20 KB). Hai bản dùng **một bộ vector** `tests/project-vectors/v03-*` và `tests/widget-catalog-vectors/` (mỗi ca: màn hình + kết luận mong đợi + mã).
  - **Schema JSON** của màn hình chỉ kiểm khung (`items`, các khóa chung, `type`); mọi luật theo loại widget (khe, `props`, hành động, kiểu Tag, quyền RW, giới hạn) nằm ở luật mã đọc danh mục, vì schema JSON không biểu diễn "kiểu Tag của khe X phải là số".
  - Danh mục đi cùng gói runtime (`deployment/package-runtime.ps1` chép `schemas/`).
- **Lý do:** thêm widget ở mức dữ liệu; hai bản validator không thể lệch về danh sách khe/thuộc tính; C++ không cần biên dịch lại khi thêm thuộc tính tùy chọn (nhưng vẫn cần cho luật mới, ghi trong ADR).
- **Phương án khác đã xét:** sinh mã C++ từ danh mục lúc build (thêm bước build, khó đọc); viết luật riêng từng bản (đã gây lệch ở 0.1 cho BOM, FR-008 của Sprint 1); schema JSON `if/then` cho từng widget (dài, khó đọc, lỗi khó hiểu).

## R9. Bộ điều khiển `ControlController` và hộp xác nhận (FR-033…FR-037)

- **Quyết định:**
  - TS thuần, một lớp cho mọi widget điều khiển. Trạng thái: `locked(reason)` → `ready` → `confirming(draft)` → `sending(requestId)` → `result(outcome)` → `ready`.
  - **Lý do khóa** (mã → chữ tiếng Việt), thứ tự kiểm cố định: `NO_SESSION`, `ROLE` (< `minRole`), `INSECURE` (HTTP), `HTTPS_DOWN`, `LIVE_LOST` (STALE), `TAG_UNKNOWN`, `TAG_READONLY`, `QUALITY_BAD`, `NO_VALUE`, `BUSY` (đang gửi), `OTHER_DIALOG`. UNCERTAIN không khóa.
  - **Hộp xác nhận** `<mat-confirm-dialog>`: `role="alertdialog"`, focus đầu vào Hủy, Enter chỉ kích hoạt nút có focus, Esc hủy. Nội dung dựng từ `tagInfo` và `TagSource` (Tag, mô tả, thiết bị trường nếu `connections` biết, hiện tại → mới, đơn vị, giới hạn, tài khoản). Khi đang mở mà điều kiện khóa xuất hiện (BAD, hết phiên, project đổi): nút Xác nhận tắt và hiện lý do.
  - **Gửi:** `ActionHost.write` → `POST /api/v1/tags/write` (`requestId` UUID v4 từ `crypto.randomUUID()`, `expect` cho BOOL, `pulseMs` cho xung, `context`); phản hồi `ACCEPTED` thì hỏi `GET /api/v1/tags/write/{id}` mỗi 200 ms tới kết quả cuối hoặc 30 s; hết 30 s không có kết quả: `UNKNOWN` (khóa 10 s, "Không rõ kết quả, kiểm tra giá trị thực"). Không gửi lại.
  - Kết quả hiển thị theo bảng mã (`REJECTED` lý do, `FAILED` mã, `TIMEOUT`, `CONFIRMED`) lấy từ 006 data-model §8, §9, dịch ở `apps/runtime-web/src/i18n/vi.ts` và dùng chung với Studio qua `ui-components/src/i18n`.
- **Lý do:** an toàn điều khiển ở một chỗ, test thuần (SC-009, FR-073); widget chỉ vẽ.
- **Phương án khác đã xét:** từng widget tự cài (lệch nhau về khóa và xác nhận); xác nhận bằng `window.confirm` (không kiểm soát nội dung, chặn luồng, không trợ năng).

## R10. Dữ liệu live theo màn hình (FR-017, FR-018)

- **Quyết định:**
  - Mỗi lần mở màn hình, `<mat-screen>` tính tập Tag = hợp Tag của mọi item không `hidden` (khe `tags`, binding của item `svg`) và của popup đang mở; gọi `TagSource.subscribe(ids)`; `LiveTagSource` đổi đăng ký bằng `LiveConnection.setTags` (hợp mọi người đăng ký). Rời màn hình thì bỏ.
  - `LiveTagSource` giữ `Map<id, {value, quality, reason, updatedAt}>` cho tập hiện tại; khi `connection` mất (`offline`, `full`), trả `STALE` cho mọi Tag (như `staleChanges` của `live-client`).
  - Tag mà thiết bị báo `unknown`: `TagSource.get` trả `quality: 'UNKNOWN'` (không phải của giao thức; trạng thái của trang) và widget khóa.
  - Cập nhật giao diện: `DomApplier` (item `svg`) và widget gom theo khung hình; tab ẩn thì `requestAnimationFrame` dừng; về lại thì áp giá trị cuối một lần (≤ 1 s).
- **Lý do:** đăng ký ≤ 1.000 Tag (ADR-006); đổi đăng ký trên cùng socket đã có (`setTags`); không đổi giao thức.
- **Phương án khác đã xét:** đăng ký tất cả Tag của project (vượt 1.000 và tăng tải); mỗi màn hình một kết nối (vượt 10 phiên).

## R11. Biểu đồ đường, cột, tròn (ADR-020)

- **Quyết định:** uPlot 1.6.32 cho `line`; cột và tròn tự viết SVG; mô hình cửa sổ dữ liệu TS thuần. Chi tiết: ADR-020.
  - **Lấy mẫu:** `ChartWindow` giữ cho mỗi đường `Float64Array(3600)` vòng, `Float64Array(3600)` thời điểm; mỗi `sampleMs`, ghi giá trị mới nhất của Tag (hoặc `NaN` khi quality BAD/STALE/UNKNOWN); thời điểm theo `TagSource.now()` (giờ BL335 từ `serverTimestamp`; nếu chưa có thì giờ trang, ghi trong contract).
  - **Cửa sổ:** vẽ các điểm trong `windowSec` cuối; trục X cố định theo cửa sổ; trục Y tự co (min/max của dữ liệu, thêm 5 %) hoặc cố định theo `yMin`, `yMax`.
  - **Tab ẩn:** `setInterval` của lấy mẫu bị Chrome giới hạn khoảng 1 s: mẫu không đều nhưng thời điểm ghi theo giờ thật, nên đồ thị vẫn đúng thời gian (khoảng thiếu thành đoạn thẳng, không dồn). Nếu khoảng thiếu > 3 × `sampleMs` thì chèn `NaN` (đứt) để không nội suy giả.
  - **Pie:** tổng của các phần tử số ≥ 0 và GOOD; phần tử âm hoặc BAD/STALE loại khỏi tổng và có dấu trong chú giải; tổng 0 hiện "Không có dữ liệu".
- **Lý do:** đúng-sai nằm ở dữ liệu (lấy mẫu, đứt đoạn), nên kiểm bằng test thuần; uPlot chỉ vẽ.
- **Phương án khác đã xét:** nội suy khoảng thiếu (giá trị giả, vi phạm SC-018); đặt lịch lấy mẫu trên Web Worker (thêm phức tạp, không cần ở 250 ms trở lên).

## R12. Định dạng giá trị và bảng giá trị trong widget (FR-032)

- **Quyết định:**
  - `formatValue(value, quality, tagInfo, props)` trong `ui-components/src/format/` (thuần):
    - số theo `decimals` (0–6), dấu chấm thập phân, không nhóm hàng nghìn ("1234.5");
    - BOOL có bảng giá trị thì theo bảng; không có thì "Bật" hoặc "Tắt" (chuỗi giao diện);
    - INT64 và UINT64 đến dạng chuỗi thập phân thì hiện nguyên chuỗi (không mất chính xác);
    - STRING hiện nguyên chuỗi (cắt theo cỡ widget bằng CSS, tooltip đủ).
  - **Bảng giá trị** tra bằng `@mat/expression` (`lookupValueTable`), cùng hàm với binding `valueTable` của 006; màu từ bảng.
  - Màu chữ trên nền tối/sáng: màu bảng giá trị được kiểm tương phản ở Studio (cảnh báo khi < 3:1 so với nền widget).
- **Lý do:** card, bảng, nhãn, hộp xác nhận, xem trước phải ra cùng chữ; bảng giá trị đã có hai bản đồng nhất (006 SC-008).
- **Phương án khác đã xét:** mỗi widget tự định dạng (lệch nhau); `Intl.NumberFormat` theo locale (dấu phẩy thập phân tiếng Việt làm "12,5" khác khi nhập; ADR/D26 của 006 chọn dấu chấm).

## R13. Phiên web và cookie (ADR-021 điểm 1, 2, 5)

- **Quyết định:**
  - `SessionStore` (005) thêm `kind` (`bearer` | `web`) và `csrf` (hash). Token web `matw_` + 32 byte; token Bearer `mats_` giữ. Chỉ băm được giữ (SHA-256, như 005).
  - Quota 8 phiên web, tổng 32; đăng nhập khi đầy: phiên web cũ nhất rảnh nhất bị loại (không từ chối), ghi audit.
  - `AuthService::authorizeWeb(cookieToken, from, minRole, refresh)` dùng chung kiểm IP, hạn, `rev` với `authorize` của Bearer; `AuthGate` có thêm nhánh cookie.
  - Hạn rảnh/tối đa như 005; `webSessionIdleMin` (5–480) trong `runtime.json`; `POST /api/v1/web/touch` làm mới.
  - **Đi qua `execv`:** `auth-state.json` thêm `kind`, `csrf` (băm), như các trường cũ.
  - Cookie `__Host-mat_sid`, thuộc tính ở ADR-021 điểm 2; `Set-Cookie` sinh bởi một hàm duy nhất có test thuộc tính; đăng xuất đặt `Max-Age=0`.
  - Trang đăng nhập `GET /login` và tài nguyên (`login.js`, CSS) phục vụ tĩnh từ docroot (`login.html` trong bản build trang).
- **Lý do:** một bộ xác thực, một chỗ audit; tiền tố khác nhau để token không dùng nhầm kênh; quota hạn chế thiệt hại khi bị spam đăng nhập thành công (cần mật khẩu đúng nên chủ yếu là người dùng thật).
- **Phương án khác đã xét:** `SessionStore` riêng cho web (hai nơi hủy phiên khi đổi mật khẩu); JWT (không thu hồi được); cookie chứa thông tin người dùng (lộ).

## R14. CSRF, Origin, Fetch Metadata (ADR-021 điểm 3)

- **Quyết định:**
  - Kiểm theo thứ tự trong `AuthGate` (nhánh cookie): HTTPS → có cookie `__Host-mat_sid` → phiên hợp lệ (kiểu `web`) → phạm vi (R15) → với `POST`/`PUT`/`DELETE`: `Origin` bằng `https://<Host>` → `X-MAT-CSRF` khớp (so hằng thời gian) → role.
  - `Host` lấy từ header `Host` của request; so không phân biệt hoa thường; có cổng nếu không phải 443.
  - `GET /api/v1/web/session` và `GET tags/write/{id}`: chỉ nhận khi `Sec-Fetch-Site` vắng hoặc `same-origin` (Chrome luôn gửi từ ≥ 76).
  - `login`/`logout`/`touch`: bắt buộc `Content-Type: application/json`, kiểm `Origin` (login không có CSRF token vì chưa có phiên; chống login CSRF bằng `Origin` và `SameSite`).
  - Không có `Access-Control-Allow-*` (CORS đóng): trang khác site không đọc được phản hồi.
  - Lỗi: 403 `CSRF_FAILED` (token), 403 `ORIGIN_MISMATCH` (Origin), 403 `FETCH_SITE` (Sec-Fetch-Site); audit `access.denied` (gộp 60 s).
- **Lý do:** ba lớp độc lập: `SameSite=Strict` (trình duyệt), `Origin` (trình duyệt gửi, kẻ tấn công khác site không giả được), token (kẻ tấn công không đọc được). Mất một lớp (trình duyệt cũ, lỗi cấu hình) còn hai.
- **Phương án khác đã xét:** chỉ `SameSite=Strict` (Chrome ≥ 120 đủ, nhưng không bảo vệ khi cùng site khác cổng hoặc subdomain bị kiểm soát); double-submit cookie (cookie đọc được bởi JS thì mất `HttpOnly` cho token đó, và không chống tấn công khi có XSS cùng site).

## R15. Phạm vi cookie, WebSocket có cookie, `viewerLogin` (ADR-021 điểm 4, 6, 7)

- **Quyết định:**
  - **Bảng phạm vi** (`core/auth/roles.*` thêm cột `cookieAllowed`): `web/login`, `web/logout`, `web/session`, `web/touch`, `tags/write` (POST), `tags/write/{id}` (GET), `projects/active`, `system/info`, `device/identity`, `/project/*`, `/live` (nâng cấp). Còn lại `cookieAllowed = false`: 403 `SESSION_SCOPE` (và audit `access.denied`).
  - Request có cả `Authorization` và cookie: Bearer thắng.
  - **WebSocket:** `civet_transport` kiểm cookie ở bước nâng cấp: cần `Origin` đúng; phiên `web` hợp lệ; tính vào 10 phiên live; kiểm lại 60 s (cơ chế 4401 của ADR-018 mở rộng cho cookie).
  - **Lọc nguồn** (`source_filter`): phiên `web` hợp lệ được coi như phiên Bearer hợp lệ (không bị lọc).
  - **`viewerLogin`:** `runtime.json`; `off` giữ hành vi 0.5; `required`: `viewer_gate` thêm điều kiện "có phiên (cookie hoặc Bearer)" cho trang, `/project/*`, `projects/active`, `system/info` (phần đầy đủ; bản tối thiểu `{runtimeVersion, web: {...}}` cho trang đăng nhập hiển thị), live; HTTP: `GET /` trả trang hướng dẫn ("Mở bằng HTTPS: https://host:8443").
  - **`system/info.web`** (công khai, nhỏ): `{ "https": true, "httpsPort": 8443, "login": true, "viewerLogin": "off" }` để trang HTTP biết liên kết HTTPS.
- **Lý do:** cookie hẹp giảm thiệt hại; `viewerLogin` cho nơi cần; `system/info.web` để trang xem HTTP dựng liên kết mà không đoán cổng.
- **Phương án khác đã xét:** cho cookie vào mọi endpoint như Bearer (tăng bề mặt: XSS ở trang vận hành thành nạp xuống); bắt buộc đăng nhập để xem (phá kiosk).

## R16. Chứng chỉ HTTPS cho Chrome (ADR-021 điểm 10–13)

- **Quyết định:**
  - **SAN IP:** `server_cert.cpp` thêm `MBEDTLS_X509_SAN_IP_ADDRESS` cho mọi IPv4 của card (từ `iface_table`, đã có cho tìm thiết bị); lưu danh sách vào `server.pem` meta (comment) để `system/info` so sánh (`TLS_SAN_MISMATCH` khi IP card hiện tại không có). Thêm `extKeyUsage serverAuth`, `keyUsage digitalSignature`, `basicConstraints CA:FALSE` rõ ràng (kiểm file hiện có trong task đầu).
  - **`/device.crt`:** route HTTPS tĩnh đọc PEM chứng chỉ (không có khóa), `Content-Type: application/x-x509-ca-cert`, `Content-Disposition: attachment; filename="mat-device.crt"`.
  - **`--make-csr [--san a,b,c] [--out file]`:** sinh khóa ECDSA P-256 mới trong `tls/pending-key.pem` (`0600`), CSR PKCS#10 (CN "mAT <deviceName>", SAN theo `--san`, mặc định IP card + hostname) in ra stdout hoặc file; khóa riêng không bao giờ in.
  - **`--import-cert <file>`:** parse chuỗi (≥ 1 chứng chỉ; chứng chỉ đầu là chứng chỉ máy chủ); so khóa công khai với `pending-key.pem` (hoặc `server.pem` hiện hành khi không có CSR chờ); từ chối file có `PRIVATE KEY`; kiểm SAN và cảnh báo; ghi `server.pem.new` (chứng chỉ + chuỗi + khóa) `0600`, `fsync`, `rename` thay `server.pem`, `systemctl restart` làm bởi người chạy lệnh (hoặc lệnh tự gọi `kill -HUP`? dùng restart như `--regen-cert` hiện có); audit `tls.import` (đường audit của `--regen-cert`).
  - **Chrome và chứng chỉ tự ký không phải CA:** Chrome (Windows dùng kho của hệ điều hành) chấp nhận chứng chỉ thực thể cuối đặt trong "Trusted Root Certification Authorities" nếu SAN khớp, thực tế đã dùng cho `localhost` nhiều năm. **Chưa kiểm với chứng chỉ của BL335**: task ⚠️🔌 kiểm trên Chrome thật. Dự phòng ghi ở ADR-021 (CA cục bộ hai tầng).
  - **Hạn chứng chỉ:** giữ hạn rất xa (BL335 không có RTC tin cậy); giới hạn 398 ngày của Chrome chỉ áp cho CA công cộng, không áp cho gốc do người dùng cài (kiểm trên Chrome thật cùng task).
- **Lý do:** Chrome bắt buộc SAN; IP là cách truy cập thường gặp ở LAN nhà máy; CSR giữ khóa riêng trên thiết bị (không có đường nào để khóa ra mạng).
- **Phương án khác đã xét:** ACME (cần tên miền công cộng và Internet); CA cục bộ do runtime tự sinh ngay (thêm khóa CA cần bảo vệ, phức tạp; làm dự phòng); nạp chứng chỉ qua web (bề mặt tấn công, cần quyền ghi `tls/`).

## R17. Mở rộng API ghi: `context`, `expect`, `pulseMs` (ADR-021 điểm 9)

- **Quyết định:**
  - `write_coordinator` (006) thêm vào `WriteRequest`: `context` (`screen`, `widget`), `expect` (`optional<bool>`), `pulseMs` (`optional<uint32>`). Thứ tự kiểm của 006 FR-037 thêm sau "Tag tồn tại, RW": `PULSE_NOT_BOOL`, `PULSE_RANGE`, `EXPECT_NOT_BOOL`; sau "kết nối" và trước "tần suất": `STALE_EXPECTATION` (so với giá trị hiện tại trong `TagStore` tại lúc kiểm; BAD thì đã bị từ chối ở bước kết nối).
  - **Xung:** sau khi lần ghi thứ nhất được thiết bị trường xác nhận (hoặc áp dụng nội bộ), bộ điều phối đặt hẹn `pulseMs` trên **đồng hồ đơn điệu** của luồng ghi (không phụ thuộc kết nối trình duyệt), rồi xếp lệnh ghi giá trị ngược vào hàng đợi ưu tiên của driver (cùng đường ghi, cùng giới hạn thời gian); `CONFIRMED` chỉ khi cả hai xong; lần hai thất bại: `FAILED` `PULSE_RELEASE_FAILED` (audit `tag.write` `failed`, chi tiết `phase: release`); lần đầu thất bại: kết quả của lần đầu. Hai lần ghi dùng chung `requestId`; audit có hai dòng (`started`, và kết quả cuối) cộng dòng `release` trong `detail`.
  - **Runtime dừng giữa chờ:** `quiesce` khi nạp xuống chờ tối đa `pulseMs` còn lại (≤ 10 s) rồi chạy lệnh trả về trước khi `execv`; `kill -9` hoặc mất điện: dòng `interrupted` lúc khởi động (cơ chế 006), bit có thể kẹt: tài liệu và cảnh báo Studio.
  - **`context`:** chuỗi id ≤ 64 byte (`^[a-z][a-z0-9_-]{0,63}$`), vào `detail` của audit; sai dạng: bỏ (không từ chối lệnh).
  - **Giới hạn tần suất:** mỗi xung tính một lệnh (một dòng audit `started` + một kết quả); lần trả về không tính thêm.
- **Lý do:** xem D13, D31. Phát hiện giá trị đổi giữa hai máy là chỗ lỗi người thật hay gặp; giữ nhịp xung ở BL335 là cách duy nhất an toàn khi trình duyệt chết.
- **Phương án khác đã xét:** xung hai lệnh từ trình duyệt (kẹt bit); `expect` cho số (trôi giá trị gây báo nhầm); bản tin `pulse` riêng (trùng API).

## R18. Ngân sách BL335 (Constitution III)

- **Quyết định (ước tính, chưa đo):**
  - **RAM:** mỗi phiên web thêm ≈ 200 byte (băm token, CSRF, IP) × 8: không đáng kể; danh mục widget ≈ 20 KB; RSS ước tăng ≤ 1 MB. Trần 150 MB giữ nhiều dư.
  - **CPU:** phục vụ file tĩnh `/assets` và `/project/screens/*.json` (≈ 70 KB, có thể có `.gz`) cho 10 client F5 cùng lúc: CivetWeb sendfile, vài chục ms CPU tổng; Argon2id mỗi lần đăng nhập 0,3–0,8 s CPU của một nhân (ADR-011), một lúc một lần; bắt tay TLS 10 client (đã đo ở 005 chờ BL335). Ghi `tags/write` và hỏi kết quả 5 lần/s/client: tải thấp (JSON nhỏ qua HTTPS có giữ kết nối).
  - **eMMC:** ghi audit `tag.write` (006: 24 KB mỗi lần, giới hạn 20 lệnh/phút) không đổi; thêm audit `auth.login`/`access.denied` do web: giới hạn 10 dòng/phút đã có (005); xung thêm một dòng/lệnh.
  - **Mạng:** trang F5 = JS+CSS ≤ 250 KB gzip + màn hình ≈ 70 KB + SVG; 10 client ≈ 3,5 MB trong vài giây (LAN 100 Mb/s ≈ 0,3 s lý thuyết).
  - **Đo:** `tools/web-it.ps1 -Scenario load` trên x64; BL335 ở task ⚠️🔌 (SC-002, SC-003, SC-004).
  - **Static file phục vụ gzip:** `package-web.mjs` đã nén sẵn gzip; xác nhận CivetWeb trả `.gz` khi `Accept-Encoding: gzip` cho cả `/project/*.json` (project do người dùng nạp không có `.gz`): đo, không có thì bật nén tại runtime (ngoài phạm vi, ghi rủi ro).
- **Lý do:** thay đổi phía thiết bị nhỏ; điểm có thể lệch là phục vụ tĩnh nhiều client và đăng nhập.
- **Phương án khác đã xét:** đặt CDN/proxy (không có mạng ngoài); tiền xử lý màn hình thành một gói nén (thêm bước nạp xuống).

## R19. Kiến trúc canvas của editor Màn hình (ADR-022)

- **Quyết định:** như ADR-022 điểm 1, 2: `mat-screen-canvas` = `<mat-screen mode="edit">` + lớp phủ; máy trạng thái cử chỉ TS thuần; ghi tài liệu khi thả.
  - **Vị trí tệp:** `apps/studio/src/ui/editors/screen-editor.ts` (+ `.css`), `apps/studio/src/ui/screen/` (`mat-screen-canvas.ts`, `mat-ruler.ts`, `mat-layers.ts`, `mat-toolbox-drag.ts`), `apps/studio/src/model/screen-edit/`.
  - **Hiệu năng khi kéo:** chỉ đổi `style.left/top/width/height` của phần tử DOM của item đang kéo và hình chữ nhật lớp phủ trong `requestAnimationFrame`; không dựng lại widget; chọn nhiều thì đổi `transform: translate` của một vùng chứa tạm? Quyết định: đổi từng phần tử (≤ 250); đo SC-013; dự phòng "bản xem nhanh".
  - **Chọn bằng điểm:** duyệt hình chữ nhật của item theo thứ tự từ trên xuống (mảng đảo), bỏ item `locked`/`hidden`; không dùng `elementFromPoint` (Shadow DOM, `pointer-events: none`).
- **Lý do và phương án khác:** ADR-022.

## R20. Hình học: bắt dính, đường gióng, căn chỉnh (ADR-022 điểm 3)

- **Quyết định:**
  - **Bắt dính lưới:** làm tròn `x`, `y` (cạnh trái, cạnh trên của hộp bao các item kéo) về bội của `grid` (mặc định 10).
  - **Đường gióng:** ứng viên là cạnh trái/phải/giữa và cạnh trên/dưới/giữa của mọi item không chọn, hộp màn hình, và (nếu bật) lưới; ngưỡng `6 / zoom` đơn vị thiết kế; chọn ứng viên gần nhất theo mỗi trục; hiện đường gióng cho mọi ứng viên trùng khớp sau khi dính; ưu tiên gióng item hơn lưới.
  - **Alt** tắt bắt dính (cả hai).
  - **Đổi cỡ:** tay nắm chỉ dính cạnh đang kéo; Shift giữ tỉ lệ (kéo góc theo tỉ lệ ban đầu của hộp bao nhóm); cỡ tối thiểu theo danh mục (nhiều item: tối thiểu theo từng item, co tỉ lệ nhóm tới khi chạm giới hạn của item nhỏ nhất).
  - **Căn chỉnh:** theo hộp bao của vùng chọn; "phân bố đều" giữ hai item ngoài cùng, chia đều khoảng trống giữa cạnh (thứ tự theo vị trí hiện tại); "cùng rộng/cao" theo item chọn đầu (item chính, viền đậm).
  - **Làm tròn:** mọi tọa độ và cỡ lưu là số nguyên (đơn vị thiết kế); phân bố chia dư dồn vào khoảng cuối.
  - **Zoom:** 10–400 %, bước nhân 1,25; "Vừa khung" theo vùng nhìn.
- **Lý do:** hàm thuần, dễ kiểm bằng bảng ca (SC-014); số nguyên giữ file gọn và diff sạch.
- **Phương án khác đã xét:** tọa độ thực (file dài, diff ồn); bắt dính bằng thư viện (thêm phụ thuộc).

## R21. Inspector sinh từ danh mục và kéo Tag (FR-063, FR-064)

- **Quyết định:**
  - Mỗi mục `props` của danh mục có `group` (`general` | `display` | `security`), `kind` (`string`, `int`, `number`, `bool`, `enum`, `color`, `array<…>`, `tagRef`), `min`/`max`/`options`, `default`, `label` (khóa i18n), `help`. Inspector dựng ô tương ứng; nhóm Gắn Tag là các khe; Sự kiện là hành động của widget.
  - Chọn nhiều: hiện giao các thuộc tính chung (X, Y, Rộng, Cao, khóa, ẩn, tên bỏ trống); loại giống nhau thì hiện cả `props` chung.
  - Kéo Tag: `application/x-mat-tag` = id Tag. Ô khe nhận drop kiểm `slot.types`/`needsWrite` với `tagInfo`; thả lên widget trên canvas gắn vào **khe chính** (`slots[0]`), hoặc hiện danh sách khe để chọn nếu có ≥ 2 khe bắt buộc (ví dụ `button` chỉ có `target`).
  - Gắn xong: đề xuất `unit`, `valueTable`, `min`/`max` của Tag nếu widget chưa đặt và loại có thuộc tính đó (nút "Dùng của Tag").
  - Mỗi ô lỗi dùng cùng cơ chế "lỗi theo ô" của lưới 006 (viền đỏ, chi tiết ở tab Thông tin, ánh xạ `issue-map.ts`).
- **Lý do:** thêm widget không cần viết form; nhất quán.
- **Phương án khác đã xét:** form tay từng widget (15 form, dễ lệch).

## R22. Xem trước, Mô phỏng, hoàn tác (FR-065, FR-067)

- **Quyết định:**
  - **Xem trước:** `<mat-screen mode="run">` với `SimTagSource` (bọc `SimEngine` 006) hoặc `DeviceTagSource` (bọc phiên thiết bị của Studio, ≤ 1.000 Tag qua `live-subscriptions.ts`); `StudioActionHost`: ở Mô phỏng `write` gọi `SimEngine.write` (kết quả giả lập `CONFIRMED`/`REJECTED` theo quyền RW và giới hạn); ở Thiết bị gọi `WriteFlow` của 006 (token Bearer qua Rust, audit kênh `studio`). Phiên "đăng nhập" của xem trước là phiên Studio (role của tài khoản Online); ở Mô phỏng coi như `operator`.
  - **Mô phỏng ≠ Thiết bị loại trừ nhau** (D30 của 006): giữ.
  - **Hoàn tác:** `screen-doc.ts` là một "tài liệu sửa được" của `project-doc.ts` (snapshot chuỗi JSON của file màn hình); cử chỉ liên tục gộp bằng `mergeKey` (`move:<ids>`, `resize:<id>`); thao tác nhiều item một bước (một snapshot).
  - **Lưu:** như mọi tài liệu (Ctrl+S); lưu được khi còn lỗi; tab có dấu chưa lưu.
- **Lý do:** dùng lại hạ tầng 004/006; không có đường xem trước riêng.
- **Phương án khác đã xét:** xem trước bằng iframe tới trang runtime (cần phiên, không chạy offline); bản copy widget riêng (lệch).

## R23. Thư viện, license, phiên bản

Tra bằng `npm view` ngày 2026-10-13; chỉ chọn bản phát hành trước 2026-09-29.

| Thư viện | Dùng cho | Phiên bản | Phát hành | License | Ghi chú |
|---|---|---|---|---|---|
| **uPlot** | biểu đồ đường (`mat-w-line`) | 1.6.32 | 2025-03-14 | MIT | **thêm mới** (ADR-020); không phụ thuộc con; `unpackedSize` 545 KB (gồm nguồn), bản min nén gzip chưa đo |
| Lit | widget, Studio | 3.3.3 (đã có) | | BSD-3-Clause | không đổi |
| `@fluentui/svg-icons` | icon Studio (thêm icon căn chỉnh, lớp, khóa, mắt) | 1.1.343 (đã có) | | MIT | chỉ thêm icon dùng tới |
| puppeteer-core, axe-core, vitest, jsdom | test | đã có | | | không đổi |
| Image CA thử (`node:24-slim` + `openssl`, dùng trong `web-it`) | tạo CA thử cho chứng chỉ | ghim digest như 006 | | MIT, Apache-2.0 | chỉ trong test |

Không thêm thư viện cho runtime C++ (cookie, CSRF, SAN, CSR dùng Mbed TLS 3.6.7 và mã sẵn có; `mbedtls_x509write_csr` có trong cấu hình? **kiểm cấu hình `mbedtls-config`**: nếu `MBEDTLS_X509_CSR_WRITE_C` chưa bật thì bật, ghi `third_party/LICENSES.md`).

## R24. Chiến lược kiểm thử

- **Quyết định:**
  - **Test viết trước, đỏ rồi xanh** (Constitution VI), ghi vào task như 006.
  - **Vector chung TS ↔ C++:** `tests/project-vectors/v03-*` (≥ 120 ca; mỗi mã lỗi/cảnh báo ít nhất một ca đúng và một ca sai ở sát biên), `tests/widget-catalog-vectors/` (danh mục: khe, props, hành động), `tests/migration-vectors/` (cặp 0.2 → 0.3, có `tank-demo`, `modbus-demo`, ca `viewBox` gốc khác 0).
  - **Test thuần TS:** hình học (`screen-edit`), `ControlController`, `ChartWindow`, `formatValue`, `toScreenModel`, mô hình URL/route, `LiveTagSource`.
  - **Test C++:** phiên web, CSRF/Origin/Fetch Metadata, phạm vi cookie, WebSocket có cookie, `expect`/`pulseMs`/`context`, SAN, CSR, `--import-cert`, `viewerLogin` (GoogleTest, một số với CivetWeb trong tiến trình như `civet_transport_test`).
  - **Tích hợp x64 `tools/web-it.ps1`:** mạng Docker: runtime (MAT_TEST_HOOKS), giả lập Modbus (006), Chrome headless (puppeteer-core, container hay máy chủ), client tấn công (Node, `fetch`/`ws`), CA thử; kịch bản `screens`, `control`, `attack`, `session`, `cert`, `load`, `f5x10`.
  - **e2e Studio:** `apps/studio/tests/e2e/screen-*.e2e.mjs` (dựng dashboard 20 widget, hình học, hoàn tác, xem trước, axe).
  - **e2e trang runtime:** `apps/runtime-web/tests/e2e/*.e2e.mjs` (Chrome headless với runtime giả `fake-runtime.mjs` của Studio mở rộng): điều hướng, popup, khóa, hộp xác nhận, XSS, axe.
  - **Kiểm tay (người):** bộ gõ trong inspector (Windows 11), cài chứng chỉ vào Windows, Chrome thật, BL335.
- **Lý do:** phần lớn rủi ro (bảo mật, hình học, điều khiển) nằm ở logic thuần hoặc HTTP, kiểm được không cần thiết bị.

## R25. Mô hình mối đe dọa của điều khiển từ Chrome (rà soát bảo mật, FR-077)

| Đe dọa | Biện pháp | Test |
|---|---|---|
| Trang web khác khiến trình duyệt gửi lệnh ghi (CSRF) | `SameSite=Strict`, `Origin`, token CSRF, CORS đóng, `Content-Type: application/json` | SC-007: tấn công từng lớp một (vô hiệu hóa lớp đó, hai lớp còn lại vẫn chặn) |
| XSS ở trang vận hành lấy phiên | cookie `HttpOnly`; không `innerHTML`/`eval`; chữ project là text; CSP `script-src 'self'` | SC-020 |
| XSS đã chạy được và dùng cookie để ghi | không chặn hoàn toàn được (script cùng origin); giảm: ghi cần xác nhận (hộp ở trang, không chống script), audit, tần suất giới hạn, role operator, cookie không vào API kỹ thuật | ghi giới hạn còn lại trong ADR-021 |
| Đánh cắp phiên qua mạng | HTTPS, `Secure`, `__Host-`; gắn IP | SC-008 |
| Cố định phiên | token mới mỗi lần đăng nhập, bỏ qua cookie sẵn có | test C++ |
| Dò mật khẩu | khóa tạm 5 lần/5 phút theo tên và IP (005), Argon2id | test của 005 chạy lại cho `web/login` |
| CSWSH (WebSocket chéo site) | cookie upgrade bắt buộc `Origin` đúng | SC-007 |
| Clickjacking | `frame-ancestors 'none'` (có sẵn) | `http-check.mjs` |
| Lộ thông tin chưa đăng nhập | `system/info.web` chỉ cờ; `device.crt` chỉ chứng chỉ công khai; `/login` tĩnh | test |
| Spam đăng nhập đầy bộ nhớ | quota 8 phiên web, loại phiên cũ nhất | test |
| Phiên sống sau đổi mật khẩu/tắt tài khoản | `rev` | test |
| Người vận hành bấm nhầm | xác nhận, Hủy mặc định, `expect` cho BOOL, khóa khi BAD, giới hạn nhập | SC-009 |
| Trình duyệt chết giữa xung | xung ở BL335 | SC-010 |
| Tin vào quyền ở trang (sửa JS để mở khóa) | BL335 kiểm lại mọi thứ (006) | SC-005 |
| Dùng `context` để giả mạo nguồn lệnh | chỉ là gợi ý, không dùng phân quyền; ghi vào audit kèm tài khoản thật | ghi trong contract |

Rủi ro còn lại ghi trong báo cáo: XSS đã thực thi có thể ghi dưới quyền operator đang đăng nhập (giới hạn của mọi web SCADA; interlock ở PLC); máy khách dùng chung tài khoản; router SNAT.
