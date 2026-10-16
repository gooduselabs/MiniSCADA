# Vector danh mục widget (feature 007)

Bộ vector dùng chung cho validator TS (`packages/project-schema/src/vectors-03.test.ts`) và validator C++ (`core/project-manager`, test `rules_03`). Hai bên phải cho **cùng kết luận ở 100 % ca** (SC-012). Sinh lại bằng `node tests/widget-catalog-vectors/generate.mjs` (kết quả được commit).

## Định dạng một ca (`<tên>/`)

| File | Ý nghĩa |
|---|---|
| `screen.json` | màn hình `main` (0.3.0) đang kiểm, kích thước 1280 x 720 |
| `tags.json` | danh sách Tag 0.3.0 chuẩn (giống nhau ở mọi ca: Tag nội bộ, tính toán, mô phỏng, ngoài `plc1`) |
| `connections.json` | kết nối chuẩn (kênh `plc1`), có ở mọi ca |
| `value-tables/TrangThaiBom.json` | bảng giá trị chuẩn, có ở mọi ca |
| `screens/<id>.screen.json` | (tùy ca) màn hình khác làm đích cho `navigate` hoặc `popup` |
| `expect.json` | danh sách `[{ "code": "...", "path": "/items/0/..." }]`: mọi lỗi **và** cảnh báo mong đợi |

## Cách chạy

1. Dựng project trong bộ nhớ: `project.json` là
   `{ format: "matscada-project", schemaVersion: "0.3.0", projectId: "catalog-vector", projectName: "Catalog vector", projectVersion: "0.1.0", minRuntimeVersion: "0.6.0", entryScreen: "main", screens: ["main", ...id của screens/*.screen.json theo thứ tự tên], tagFile: "tags.json", connectionFile: "connections.json", valueTables: ["TrangThaiBom"], maxClients: 10 }`;
   `screen.json` thành `screens/main.screen.json`; các file còn lại (trừ `expect.json`) giữ nguyên đường dẫn.
2. Kiểm project (không kiểm SVG, runtime 0.6.0).
3. Lấy mọi lỗi và cảnh báo có `file` = `screens/main.screen.json` (lỗi ở file khác không xảy ra: các file chuẩn đều hợp lệ; cảnh báo của `tags.json` như `W_WRITE_NO_LIMITS` của Tag `L.FREE` bị bỏ qua vì khác file).
4. So **đa tập** `{ code, path }` với `expect.json` (không phân biệt thứ tự; `[]` nghĩa là không có lỗi và cảnh báo nào ở file này).

`path` là JSON Pointer tới khóa sai trong `screens/main.screen.json`. Các ca ở đây không dùng `E_SCHEMA` (đường dẫn lỗi cấu trúc khác nhau giữa các thư viện schema); lỗi cấu trúc nằm ở `tests/project-vectors/v03-*`.

## Quy ước `path` (cả hai bộ vector, cả hai validator)

`<i>` là chỉ số của item trong `items`; `<slot>` là tên khe; `<k>` là chỉ số phần tử của khe nhiều Tag.

| Mã | `path` |
|---|---|
| `E_SCREEN_ID`, `E_SCREEN_KIND` | `/id`, `/kind` của file màn hình (binding: `/screenId`; project: `/entryScreen`) |
| `E_SCREEN_SIZE` | `/size/width` hoặc `/size/height` |
| `E_LIMIT` | `/items` (quá 250 item, quá 8 item `svg`, quá 16 biểu đồ), `/screens` ở `project.json`, `/navigation/items` ở `project.json` (quá 32 mục lá), `/items/<i>/tags/<slot>` (khe nhiều Tag vượt `max`) |
| `E_SCREEN_TAGS`, `W_SCREEN_TAGS_MANY` | `/items` của màn hình bị vượt (ở cặp màn hình-popup: màn hình mở popup) |
| `E_ITEM_ID` | `/items/<i>/id` (trùng: ở item sau) |
| `E_ITEM_SIZE` | `/items/<i>/width`, `/items/<i>/height` |
| `E_WIDGET_UNKNOWN` | `/items/<i>/widget` |
| `E_WIDGET_SLOT` | khe lạ hoặc khe không dùng với hành động: `/items/<i>/tags/<slot>`; khe bắt buộc thiếu: `/items/<i>/tags`; khe nhiều Tag rỗng hoặc trùng: `/items/<i>/tags/<slot>` hoặc `/items/<i>/tags/<slot>/<k>` |
| `E_WIDGET_PROP` | `/items/<i>/props/<tên>`; `yMin` hoặc `yMax` thiếu cặp: khóa đang có; `labels` nhiều hơn Tag: `/props/labels`; `select` không có bảng: `/items/<i>/props`; `security` hoặc `events` ở loại không có: `/items/<i>/security`, `/items/<i>/events` |
| `E_WIDGET_TAG_TYPE`, `E_REF_TAG`, `E_TAG_ACCESS` | `/items/<i>/tags/<slot>` (khe nhiều Tag: thêm `/<k>`) |
| `E_REF_TABLE` | `/items/<i>/props/table` (binding: `/elements/<e>/bindings/<b>/transform/table`) |
| `E_WIDGET_LIMITS` | `/items/<i>/props/min`, `/items/<i>/props/max` (`min` không nhỏ hơn `max`: `/props/max`) |
| `E_WIDGET_MINROLE` | `/items/<i>/security/minRole` |
| `E_WIDGET_CONFIRM`, `W_CONFIRM_NONE` | `/items/<i>/props/confirm` |
| `E_ACTION` | hành động thiếu: `/items/<i>/events/click`; `action` sai: `/items/<i>/events/click/action`; tham số sai hoặc thừa: `/items/<i>/events/click/<tham số>`; tham số thiếu: `/items/<i>/events/click` |
| `E_ACTION_TARGET` | `/items/<i>/events/click/screen` |
| `W_PULSE_READBACK`, `W_ACTION_NOOP` | `/items/<i>/events/click` |
| `W_WRITE_NO_LIMITS` (ở màn hình) | `/items/<i>/tags/<slot ghi>` |
| `W_ITEM_OUTSIDE`, `W_ITEM_COVERED` | `/items/<i>` (W_ITEM_COVERED: item bị che) |
| `W_STRETCH_WIDGETS` | `/fitMode` |
| `W_SCREEN_EMPTY` | `` (rỗng: cả file) |
| `E_NAV` | `/navigation/items/<i>` (nhóm lồng nhóm, nhóm rỗng, mục không đích, nhóm có `screen`), `/navigation/items/<i>/screen`, hoặc `/navigation/items/<i>/items/<j>[/screen]` |
| `E_DUP_UID` | `/items/<i>/elements/<j>/elementUid` |
| `E_SCHEMA` (luật, không phải schema) | `/itemId` ở file binding khi khác `id` của item `svg`; `/items/<i>/bindingFile` ở item sau khi hai item chung file binding |
| `E_FILE_MISSING`, `E_PATH` (item `svg`) | `/items/<i>/svgFile`, `/items/<i>/bindingFile` |

Quy tắc đếm: độ dài chuỗi (`maxLength`) đếm theo ký tự Unicode (code point), không theo byte; `E_WIDGET_LIMITS`, `W_WRITE_NO_LIMITS` chỉ xét khi Tag ở khe ghi ghi được thật (RW, không tính toán, mô phỏng chỉ khi `manual`).

## Nội dung

- `valid-<loại>-lower` và `valid-<loại>-upper`: mỗi loại trong 15 loại widget hai ca, dựng từ chính `schemas/widgets.catalog.json`: mọi thuộc tính ở cận dưới hoặc cận trên (chuỗi dài đúng `maxLength` đếm theo ký tự Unicode, `int` ở `min`/`max`, mảng rỗng hoặc đầy `maxItems`, khe nhiều Tag một hoặc đủ `max`).
- `valid-*` khác: các kiểu Tag, hành động, bảng giá trị hợp lệ.
- `slot-*`, `type-*`, `access-*`, `ref-*`: khe, kiểu Tag, quyền ghi, tham chiếu.
- `prop-*`, `limits-*`, `minrole-*`, `confirm-*`, `widget-*`: thuộc tính, giới hạn, vai trò, xác nhận.
- `action-*`: hành động của `button` (`write`, `toggle`, `pulse`, `navigate`, `popup`, `closePopup`) và đích.

## Ca widget lịch sử (feature 010, danh mục 0.5.0)

Ca `history-*` và `valid-history-*` (sinh bởi `history010.mjs`, 129 ca) dùng project **0.6.0 có `loggingFile`**, nên thư mục ca có thêm hai file, và **`project.json` có sẵn trong thư mục: dùng nguyên, không dựng theo bước 1** (các ca 0.3 không có file này). Cùng cách chạy, trừ: runtime `0.9.0`; nạp `logging.json` (luật `E_LOG_*` đều không có lỗi); chỉ so lỗi và cảnh báo của `screens/main.screen.json`.

| File | Ý nghĩa |
|---|---|
| `project.json` | định dạng 0.6.0, `minRuntimeVersion` 0.9.0, `loggingFile` (trừ ca `history-invalid-group-no-logging-file`) |
| `logging.json` | nhóm `ap-suat` (onChange, tổng hợp; Tag `L.LEVEL`, `L.FLAG`, `L.NAME` chuỗi, `L.SP` với `aggregate:false`, `L.INT`), `lon` (cyclic, tổng hợp; `M.T001…M.T040`, `L.NAME`), `raw` (cyclic, không tổng hợp; `L.LEVEL`, `L.FLAG`, `L.NAME`) |

Mã và vị trí (`path` theo quy ước của bảng trên; khác contract: Tag dùng `/items/<i>/tags/<khe>/<k>`, không phải `/slots/…`; kiểu Tag sai là `E_WIDGET_TAG_TYPE`, không có `E_WIDGET_SLOT_TYPE`):

| Mã | `path` | Ghi chú |
|---|---|---|
| `E_WIDGET_HISTORY_GROUP` | `/items/<i>/props/group`; thiếu `group`: `/items/<i>/props` | nhóm không có trong `logging.json` hoặc project không có `loggingFile`; nhóm không tra được thì **không** kiểm Tag của widget |
| `E_WIDGET_HISTORY_TAG` | `/items/<i>/tags/<khe>/<k>` | Tag (có trong `tags.json`) không thuộc nhóm; mỗi Tag một lỗi; Tag không có trong `tags.json` chỉ là `E_REF_TAG` |
| `E_WIDGET_HISTORY_AGG` | `/items/<i>/tags/<khe>/<k>` | chỉ `history-bar`, `history-pie`: nhóm không bật `aggregates` (mỗi Tag một lỗi) hoặc Tag `aggregate:false`; Tag sai kiểu chỉ báo kiểu; Tag ngoài nhóm chỉ báo thành viên |
| `E_WIDGET_PROP` | `/items/<i>/props/<tên>` | `group` không phải chuỗi; `yMin`/`yMax` lẻ (khóa đang có) hoặc `yMin >= yMax` (`/props/yMax`); `shiftCount` ngoài {2, 3, 4, 6, 8, 12}; `shiftStart` sai `HH:MM`; **tổ hợp `bucket`/`period` ngoài bảng §2.1 hoặc quá 48 hạng mục: `/props/period`** (`bucket` mặc định `shift`) |

Ca `valid-history-*-lower`/`-upper` thay cho cặp sinh tự động từ danh mục của các widget cũ (bộ test TS đòi cặp này cho mọi widget trong danh mục). Ca kích thước (`E_ITEM_SIZE`): `history-trend` và `history-table` tối thiểu 280×160, `history-bar` 200×140, `history-pie` 140×140.
