# Contract: định dạng project 1.0.0 (phần thêm so với 0.3.0) và quy tắc gói

**Feature**: [spec.md](../spec.md) FR-001, FR-002, FR-024, FR-073, FR-119 đến FR-125 · **ADR**: [036](../../../docs/adr/036-security-hardening.md), [037](../../../docs/adr/037-logic-v2.md), [038](../../../docs/adr/038-svg-editor-templates.md) · Nền: [007 project-format-0.3](../../007-screens-widgets/contracts/project-format-0.3.md)

## 1. Phiên bản và migration

- `schemaVersion` của project: **1.0.0** ở bản phát hành. Các số trung gian của feature 008 (0.4.0), 009 (0.5.0, đổi nếu số bị chiếm), 010 (chưa có số lúc viết) nằm giữa 0.3.0 và 1.0.0 trong chuỗi migration; T003 ghi số cuối cùng khi bắt đầu làm.
- Migration `migrate_to_1_0_0` (TS, `packages/project-schema/src/migrate.ts`): thuần thêm: đổi `schemaVersion`, không bắt buộc trường mới. Cặp file `tests/migration-vectors/` (đầu vào → đầu ra giống từng byte) cho `tank-demo` (0.1), `modbus-demo` (0.2), `dashboard-demo` (0.3) và dự án mẫu của các GĐ trung gian.
- Runtime 1.0 nhận 0.1, 0.2, 0.3, các định dạng trung gian và 1.0.0; Studio nâng cấp có sao lưu `.mat-backup/` như 007. Project `schemaVersion` ≥ 1.1 (chưa có): runtime từ chối cả gói, Studio từ chối mở (như 006 FR-005).
- Lời hứa SemVer của dòng 1.x: **thêm** trường tùy chọn, mã lỗi, cảnh báo, widget, endpoint là MINOR; đổi nghĩa hay bỏ là MAJOR (2.0). Validator của 1.x MUST chấp nhận mọi project 1.0.0 hợp lệ.

## 2. Thêm vào `project.json`

```json
{
  "schemaVersion": "1.0.0",
  "logic": "logic.json",
  "templates": ["templates/bom.template.json"]
}
```

- `logic`: đường dẫn tương đối của tệp logic (tùy chọn): [logic-engine.md](logic-engine.md).
- `templates`: danh sách tệp template (tùy chọn); mỗi tệp là một `template` §3. Thứ tự không có nghĩa.
- Cả hai chịu quy tắc đường dẫn an toàn (`isSafeRelPath`) và tập tệp của §5.

## 3. Template (`schemas/template.schema.json`)

```json
{
  "id": "bom",
  "name": "Bơm có đèn và lưu lượng",
  "size": { "w": 220, "h": 140 },
  "params": [
    { "name": "prefix", "kind": "tagPrefix", "default": "PUMP01" },
    { "name": "title",  "kind": "string",    "default": "Bơm" }
  ],
  "items": [
    { "id": "lamp", "type": "widget", "widget": "lamp", "x": 10, "y": 10, "w": 40, "h": 40,
      "tags": { "value": "{prefix}.RUN" } },
    { "id": "flow", "type": "widget", "widget": "card", "x": 60, "y": 10, "w": 150, "h": 60,
      "props": { "label": "{title} (lưu lượng)" }, "tags": { "value": "{prefix}.FLOW" } }
  ]
}
```

- `id` như id màn hình (`^[a-z][a-z0-9-]{0,47}$`); `size` ≥ 1 và ≤ cỡ màn hình tối đa của 007; `items` theo lược đồ item của 007 (`svg` và `widget`), tối đa 120 item; `id` item tương đối (trong template), duy nhất.
- `params`: tối đa 16; `name` `^[a-z][A-Za-z0-9]{0,31}$` duy nhất; `kind`:

| `kind` | Giá trị hợp lệ | Chỗ dùng được `{name}` |
|---|---|---|
| `tagPrefix` | khớp `^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$`, ≤ 64 byte | đầu chuỗi Tag trong `tags`, `action.tag`: dạng `{prefix}.SUFFIX` hoặc `{prefix}` đơn |
| `string` | UTF-8 không ký tự điều khiển, ≤ 128 byte | giá trị chuỗi của `props` (nhãn, tiêu đề) |
| `number` | số hữu hạn | giá trị số của `props` (min, max…) |
| `color` | `#RRGGBB` hoặc tên token màu của theme | giá trị màu của `props` |

- `{name}` xuất hiện **trọn vẹn** hoặc làm tiền tố (Tag) hoặc nhúng trong chuỗi (`string`); thay thế là phép thay chuỗi thuần, không biểu thức, không lồng. Ký tự `{` `}` lạ hoặc tham số không khai báo là `E_TEMPLATE_PARAM`.
- Không có điều kiện, vòng lặp, hàm trong template.

## 4. Bản sao (bung khi lưu)

Màn hình (`screens/<id>.screen.json`) lưu **item thường**; mỗi item sinh từ template mang chú thích tùy chọn:

```json
{ "id": "pump7.lamp", "type": "widget", "widget": "lamp", "x": 400, "y": 300, "w": 40, "h": 40,
  "tags": { "value": "PUMP07.RUN" },
  "tpl": { "inst": "pump7", "tid": "bom", "rid": "lamp", "params": { "prefix": "PUMP07", "title": "Bơm 7" } } }
```

- `tpl`: `inst` (id bản sao `^[a-z][a-z0-9-]{0,31}$`, duy nhất trong màn hình), `tid` (id template), `rid` (id item trong template), `params` (chỉ trên một item của bản sao; hoặc trên mọi item để tự đủ, quy ước: mọi item của một bản sao có cùng `params`). Schema 1.0.0 cho phép `tpl` ở item; **runtime, widget, validator widget đều bỏ qua** `tpl`.
- id item = `<inst>.<rid>`; vị trí là vị trí tuyệt đối trên màn hình (bản sao có điểm đặt `x`,`y` lưu ở item đầu của bản sao như phần dịch: Studio tính từ `template.items[].x` cộng phần dịch).
- Studio "Cập nhật mọi bản sao": với mỗi `inst`, bung lại từ template hiện tại: giữ phần dịch (vị trí), `params`; item thêm tay vào `inst` (không có trong template) bị xóa; xóa template còn bản sao phải được chọn "bung thành item thường" (xóa `tpl`).
- Validator (cả hai): với mỗi item có `tpl`: `tid` tồn tại; `params` đủ và đúng `kind`; item còn khớp template (khác thì cảnh báo `W_TEMPLATE_DRIFT`, không lỗi); Tag đã thay tồn tại và đúng kiểu khe (`E_TEMPLATE_TAG_REF`). Runtime không dựa vào `tpl` để quyết định gì ngoài việc bỏ qua.

## 5. Faceplate: popup có tham số

Màn hình `kind: "popup"` có thêm:

```json
{ "id": "bom-chi-tiet", "kind": "popup", "size": { "w": 640, "h": 420 },
  "params": [ { "name": "prefix", "kind": "tagPrefix" }, { "name": "title", "kind": "string", "default": "Bơm" } ],
  "items": [ { "id": "run", "type": "widget", "widget": "switch", "x": 20, "y": 20, "w": 120, "h": 48,
               "tags": { "value": "{prefix}.RUN_CMD" }, "props": { "label": "{title}" } } ] }
```

Hành động `popup` thêm `args`:

```json
{ "do": "popup", "screen": "bom-chi-tiet", "args": { "prefix": "PUMP07", "title": "Bơm 7" } }
```

- `params` chỉ ở màn hình popup; `args` bắt buộc khi popup có `params` không `default`, mỗi `args` khóa phải là tham số có thật (`E_POPUP_ARGS` nếu thiếu, thừa, sai `kind`); `args` giá trị là chuỗi (số và màu cũng là chuỗi, kiểm theo `kind`).
- Mọi chỗ dùng `{name}` giống §3 (cùng bảng "Chỗ dùng được"); `{name}` ngoài chỗ dùng hoặc không khai: `E_TEMPLATE_PARAM`.
- **Bung tĩnh khi kiểm tra** (cả TS và C++): với mỗi chỗ gọi popup có tham số trong mọi màn hình (và trong item sinh từ template), tạo bộ `args`, thay vào popup, kiểm toàn bộ Tag của bản đã thay như màn hình thường (tồn tại, kiểu khe, RW cho khe ghi, giới hạn). Tối đa 1.000 bộ `args` khác nhau cho mỗi popup (`E_POPUP_ARGS` `TOO_MANY`).
- **Mọi nơi dùng hành động `popup`** có `args`: widget `button` (007) và sự kiện `events.click` của phần tử SVG trong tệp `*.bindings.json` (008, `schemas/binding.schema.json`); validator bung tổ hợp ở cả hai nơi.
- **Thay lúc chạy** (`@mat/ui-components`): khi mở popup, thay `{name}` bằng `args` trong chuỗi của `tags`, `props` (đúng chỗ cho phép), dùng cùng hàm thuần `substituteParams` với validator TS. Tag sau khi thay phải nằm trong tập Tag đã được project công bố (`projects/active` tóm tắt); không thuộc tập thì widget hiện lỗi "Tag không có" và **không** đăng ký.
- Popup mở popup khác: thay popup hiện tại (007 D12), `args` mới.
- `closePopup` không đổi.

## 6. Quy tắc tập tệp của gói và project (FR-024)

Tập tệp **hợp lệ** của project 1.0.0 là hợp của: `project.json`, `tags.json` và các tệp cấu hình đặt tên trong `project.json` (kết nối, bảng giá trị, bảng theo dõi, lưu trữ, `logic`), `screens/*.screen.json`, `*.bindings.json` và tệp SVG tham chiếu bởi item `svg`, `templates/*.template.json` được liệt kê trong `templates`, `assets/` được tham chiếu (nếu có từ GĐ 3b), cộng `manifest.json` của gói.

- Tệp **không** thuộc tập trên là `E_PACKAGE_EXTRA_FILE` (kiểm gói, kiểm project TS và C++, kiểm của Studio khi mở và đóng gói).
- Thư mục bị Studio loại khi đóng gói và bị runtime từ chối nếu có: `.mat-backup/`, `.mat-editor/`, `.git/`, `.vs/`, `node_modules/`, `Thumbs.db`, `desktop.ini`, tệp bắt đầu bằng `~` hoặc kết thúc `.tmp`.
- Digest gói và digest project tính trên **cùng tập tệp** (tập hợp ở trên); thứ tự và băm như 005 (ADR-012). Không còn tình huống digest runtime khác digest gói do tệp thừa.
- Vector chung `tests/package-vectors/`: ≥ 10 ca mới (tệp thừa ở gốc, trong `screens/`, SVG không tham chiếu, `.mat-editor/`, tệp ẩn, bản sao trùng tên khác hoa thường, tệp binding mồ côi, template không liệt kê, thư mục rỗng lạ, tệp quá lớn).

## 7. Schema và danh mục

- `schemas/logic.schema.json`, `schemas/template.schema.json` mới; `schemas/screen.schema.json` thêm `tpl` (item), `params` (màn hình popup), `args` (hành động popup); `schemas/project.schema.json` thêm `logic`, `templates`. Thư mục `schemas/1.0/` chứa bản đóng băng của bộ schema 1.0.0 (như `schemas/0.2/` của 007) để runtime nhận cả định dạng cũ.
- `schemas/widgets.catalog.json`: thêm `args` vào hành động `popup` và `{param}` vào danh sách "chỗ dùng được"; hai validator đọc cùng danh mục.
- Mã lỗi/cảnh báo mới: `E_PACKAGE_EXTRA_FILE`, `E_LOGIC_*`, `E_TEMPLATE_PARAM`, `E_TEMPLATE_TAG_REF`, `E_POPUP_ARGS`, `W_TEMPLATE_DRIFT`, `W_LOGIC_*`; mỗi mã có ít nhất một vector đúng và một vector sai trong `tests/project-vectors/` (ca `v10-*`).

## 8. Phần SVG

Tệp SVG của item `svg` giữ định dạng của GĐ 3b (`data-mat-uid`, allowlist). Editor SVG ([svg-editor.md](svg-editor.md)) bổ sung duy nhất: thuộc tính `data-mat-layer` (tên lớp) trên `<g>` cấp một và `data-mat-name` (tên hiển thị) tùy chọn; hai thuộc tính này nằm trong allowlist của sanitizer (thêm ở GĐ 6 nếu GĐ 3b chưa có) và bị runtime bỏ qua.
