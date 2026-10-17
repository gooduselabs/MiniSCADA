# Mã lỗi và cảnh báo

<!-- Tệp sinh bằng `node tools/gen-error-codes.mjs` từ `schemas/error-codes.json`. Không sửa tay. -->

Danh mục mọi mã lỗi và cảnh báo mà thiết bị (runtime), Studio và trang vận hành có thể báo. Mã viết hoa
(ví dụ `AUTH_FAILED`) không đổi giữa các phiên bản; câu tiếng Việt có thể được viết lại cho rõ hơn.

- Mã bắt đầu bằng `E_` là lỗi của project hoặc gói: Studio chặn lưu hay nạp xuống cho tới khi sửa.
- Mã bắt đầu bằng `W_` là cảnh báo: không chặn, nhưng nên xem lại.
- Mã khác là kết quả do thiết bị trả về (API, ghi Tag, quality, kênh dữ liệu sống, cảnh báo hệ thống).
- Cột **HTTP** là mã trạng thái HTTP khi thiết bị trả mã này cho một yêu cầu; "—" khi mã nằm trong nội dung
  khác (danh sách lỗi, kết quả ghi, quality, cảnh báo).
- Cột **Nơi dùng** là phần mã nguồn phát hoặc kiểm tra mã này.

Tổng cộng 444 mã.

## Mục lục

- [Định dạng và phiên bản project](#format) (13)
- [Tag, địa chỉ Modbus, cổng serial và bảng giá trị](#tags) (33)
- [Biểu thức của Tag tính toán](#expression) (10)
- [Màn hình, widget, binding và điều hướng](#screens) (38)
- [SVG, hoạt ảnh, sự kiện và nhập SVG](#svg) (32)
- [Alarm](#alarm) (46)
- [Lưu trữ, lịch sử và báo cáo](#history) (41)
- [Gói project (.matscada)](#package) (16)
- [Nạp xuống, đọc lên, kho project và kiểm tra sức khỏe](#deploy) (20)
- [Đăng nhập, phiên và truy cập HTTP](#auth) (25)
- [Ghi Tag](#write) (39)
- [Lý do quality của Tag](#quality) (20)
- [Kết nối PLC, cổng serial và Thử kết nối](#driver) (11)
- [Kênh dữ liệu sống (WebSocket)](#live) (10)
- [Logic: luật, timer, counter, cộng dồn, giờ chạy, lịch và ghi PLC](#logic) (31)
- [Cảnh báo hệ thống, chứng chỉ và công cụ dòng lệnh](#system) (20)
- [Cập nhật runtime qua mạng (OTA) và chữ ký phát hành](#update) (39)

<a id="format"></a>

## Định dạng và phiên bản project

| Mã | HTTP | Thông điệp | Nơi dùng |
| --- | --- | --- | --- |
| `E_DUP_ID` | — | Trùng mã định danh (kênh, thiết bị trường, bảng giá trị hoặc bảng theo dõi) | `core/project-manager`, `packages/project-schema` |
| `E_FILE_MISSING` | — | File được tham chiếu không tồn tại | `core/project-manager`, `packages/project-schema`, `server` |
| `E_JSON` | — | File không phải JSON hợp lệ, hoặc lớn hơn 1 MB | `core/project-manager`, `packages/project-schema` |
| `E_LIMIT` | — | Vượt giới hạn của định dạng (số Tag, kênh, thiết bị trường, bảng…) | `core/project-manager`, `packages/project-schema` |
| `E_MAX_CLIENTS` | — | `maxClients` ngoài 1–10 | `core/project-manager`, `packages/project-schema` |
| `E_MIN_RUNTIME` | — | Project 0.2 cần runtime từ 0.5.0 trở lên | `core/project-manager`, `packages/project-schema` |
| `E_MODEL` | — | Project qua được bộ kiểm tra nhưng runtime không dựng được mô hình nên không kích hoạt | `server` |
| `E_NO_VALID_PROJECT` | — | Thiết bị không có project hợp lệ để chạy | `server` |
| `E_PATH` | — | Đường dẫn không an toàn | `core/project-manager`, `packages/project-schema` |
| `E_RUNTIME_TOO_OLD` | — | Project cần runtime mới hơn runtime của thiết bị (minRuntimeVersion) | `core/project-manager`, `packages/project-schema` |
| `E_SCHEMA` | — | File không đúng schema của định dạng project | `core/expression`, `core/project-manager`, `packages/expression`, `packages/project-schema` |
| `E_SCHEMA_VERSION` | — | Phiên bản schema không hỗ trợ hoặc lệch giữa các file | `core/project-manager`, `packages/project-schema` |
| `E_VALIDATION` | — | Thiết bị từ chối project | `core/project-store` |

<a id="tags"></a>

## Tag, địa chỉ Modbus, cổng serial và bảng giá trị

| Mã | HTTP | Thông điệp | Nơi dùng |
| --- | --- | --- | --- |
| `E_ADDR_AREA` | — | Vùng địa chỉ không hợp với kiểu hoặc quyền của Tag | `drivers/modbus`, `packages/project-schema`, `packages/tag-codec`, `server/http` |
| `E_ADDR_RANGE` | — | Địa chỉ ngoài khoảng 0–65535 | `drivers/modbus`, `packages/project-schema`, `packages/tag-codec`, `server/http` |
| `E_ADDR_READ_LIMIT` | — | Tag dài hơn giới hạn một lần đọc của thiết bị trường | `core/project-manager`, `drivers/sdk`, `packages/project-schema` |
| `E_ADDR_SYNTAX` | — | Địa chỉ Modbus không đúng cú pháp (ví dụ HR100, 40101, HR100.3) | `drivers/modbus`, `packages/project-schema`, `packages/tag-codec`, `server/http` |
| `E_ADDR_WRITE_LIMIT` | — | Tag ghi được dài hơn một lần ghi (tối đa 123 thanh ghi) | `core/project-manager`, `packages/project-schema` |
| `E_BIT_WRITE` | — | Ghi bit trong thanh ghi cần chọn cách ghi bit (mặt nạ hoặc đọc-sửa-ghi) ở thiết bị trường | `core/project-manager`, `packages/project-schema` |
| `E_DEADBAND` | — | Vùng chết chỉ cho Tag số và không âm | `core/project-manager`, `packages/project-schema` |
| `E_DUP_TAG` | — | Tag bị trùng id | `core/project-manager`, `packages/project-schema` |
| `E_INITIAL` | — | Giá trị đầu sai kiểu, ngoài khoảng hoặc chuỗi quá dài | `core/project-manager`, `packages/project-schema` |
| `E_LIMITS` | — | Giới hạn ghi sai (cần Tag số, nhỏ nhất ≤ lớn nhất, trong khoảng của kiểu) | `core/project-manager`, `packages/project-schema` |
| `E_REF_DEVICE` | — | Thiết bị trường không có trong Kết nối | `core/project-manager`, `packages/project-schema` |
| `E_REF_TABLE` | — | Bảng giá trị không có trong project | `core/project-manager`, `packages/project-schema` |
| `E_RENAME_EXISTS` | — | Tên mới đã có ở một Tag khác | `packages/project-schema` |
| `E_RENAME_MISSING` | — | Project không còn Tag cần đổi tên | `packages/project-schema` |
| `E_RENAME_SAME` | — | Tên mới trùng tên cũ | `packages/project-schema` |
| `E_RENAME_SYNTAX` | — | Tên không hợp lệ: bắt đầu bằng chữ cái, gồm chữ, số, gạch dưới, các đoạn cách nhau bằng dấu chấm, tối đa 64 ký tự, không phải true hay false. | `packages/project-schema` |
| `E_RETAIN` | — | Giữ qua mất điện chỉ dùng cho Tag nội bộ | `core/project-manager`, `packages/project-schema` |
| `E_SCALING` | — | Thang đo sai (cần Tag số thực, hai đầu thô và hai đầu kỹ thuật khác nhau) | `core/project-manager`, `packages/project-schema` |
| `E_SERIAL_NOT_ALLOWED` | — | Cổng serial chưa được phép dùng trên thiết bị | `core/common`, `core/project-manager`, `packages/project-schema`, `server`, `server/cli` |
| `E_SERIAL_PORT` | — | Tên cổng serial không đúng dạng | `core/common`, `core/project-manager`, `packages/project-schema`, `server/http` |
| `E_SERIAL_SHARED` | — | Hai kênh dùng chung một cổng serial | `core/project-manager`, `packages/project-schema` |
| `E_SIM` | — | Cấu hình mô phỏng không hợp với kiểu Tag hoặc có tham số sai | `core/project-manager`, `packages/project-schema` |
| `E_TAG_ACCESS` | — | Quyền ghi không hợp: Tag tính toán chỉ đọc, Tag mô phỏng chỉ ghi khi nhập tay | `core/project-manager`, `packages/project-schema` |
| `E_TAG_RANGE` | — | `min ≥ max` hoặc `min/max` cho Tag không phải số | `core/project-manager`, `packages/project-schema` |
| `E_VT_OVERLAP` | — | Hai mục của bảng giá trị chồng nhau | `core/expression`, `packages/expression`, `packages/project-schema` |
| `E_VT_RANGE` | — | Khoảng rỗng: giá trị đầu phải nhỏ hơn giá trị cuối | `core/expression`, `packages/expression`, `packages/project-schema` |
| `E_VT_TEXT` | — | Chữ của mục dài quá 64 ký tự | `core/expression`, `packages/expression`, `packages/project-schema` |
| `W_ADDR_MODICON_BASE0` | — | Địa chỉ dạng Modicon trên thiết bị trường có địa chỉ gốc 0: số 40001 là offset 1 | `drivers/modbus`, `packages/project-schema`, `packages/tag-codec` |
| `W_BIT_RMW` | — | Ghi bit kiểu đọc-sửa-ghi có thể đè lên thay đổi của chương trình PLC | `core/project-manager`, `packages/project-schema` |
| `W_DETECT_SLOW` | — | Thời gian phát hiện mất kết nối dài hơn chu kỳ quét của nhóm | `core/project-manager`, `packages/project-schema` |
| `W_RTU_SCAN_TIME` | — | Vòng quét RTU ước tính dài hơn chu kỳ của nhóm | `core/project-manager`, `packages/project-schema` |
| `W_WATCH_REF` | — | Bảng theo dõi có Tag không tồn tại | `core/project-manager`, `packages/project-schema` |
| `W_WRITE_NO_LIMITS` | — | Tag số ghi được nhưng chưa đặt giới hạn ghi | `core/project-manager`, `packages/project-schema` |

<a id="expression"></a>

## Biểu thức của Tag tính toán

| Mã | HTTP | Thông điệp | Nơi dùng |
| --- | --- | --- | --- |
| `E_EXPR_ARITY` | — | Hàm có sai số tham số | `core/expression`, `packages/expression`, `packages/project-schema` |
| `E_EXPR_CYCLE` | — | Tag tính toán tham chiếu vòng | `core/expression`, `core/tag-engine`, `packages/expression`, `packages/project-schema` |
| `E_EXPR_DEPTH` | — | Chuỗi phụ thuộc giữa các Tag tính toán sâu quá 16 tầng | `core/expression`, `core/tag-engine`, `packages/expression`, `packages/project-schema` |
| `E_EXPR_LIMIT` | — | Biểu thức vượt giới hạn (1.000 ký tự, lồng 32 mức, 32 Tag đầu vào) | `core/expression`, `core/project-manager`, `packages/expression`, `packages/project-schema` |
| `E_EXPR_SYNTAX` | — | Biểu thức sai cú pháp | `core/expression`, `packages/expression`, `packages/project-schema` |
| `E_EXPR_TYPE` | — | Biểu thức sai kiểu, hoặc kết quả không gán được vào kiểu của Tag | `core/expression`, `core/project-manager`, `packages/expression`, `packages/project-schema` |
| `E_EXPR_UNKNOWN_FUNC` | — | Biểu thức dùng hàm không có | `core/expression`, `packages/expression`, `packages/project-schema` |
| `E_EXPR_UNKNOWN_TABLE` | — | Biểu thức dùng bảng giá trị không có | `core/expression`, `packages/expression`, `packages/project-schema` |
| `E_EXPR_UNKNOWN_TAG` | — | Biểu thức dùng Tag không có | `core/expression`, `core/project-manager`, `packages/expression`, `packages/project-schema` |
| `W_EXPR_INT64` | — | Biểu thức dùng Tag 64 bit: mất chính xác ngoài ±2^53 | `core/expression`, `packages/expression`, `packages/project-schema` |

<a id="screens"></a>

## Màn hình, widget, binding và điều hướng

| Mã | HTTP | Thông điệp | Nơi dùng |
| --- | --- | --- | --- |
| `E_ACTION` | — | Hành động lạ, thiếu tham số, sai kiểu `value`, ngoài giới hạn Tag, hoặc `durationMs` ngoài 100–10.000 | `core/project-manager`, `packages/project-schema` |
| `E_ACTION_TARGET` | — | `navigate`/`popup` trỏ tới màn hình không có hoặc sai loại | `core/project-manager`, `packages/project-schema` |
| `E_DUP_BINDING` | — | `binding.id` trùng trong màn hình | `core/project-manager`, `packages/project-schema` |
| `E_DUP_UID` | — | `elementUid` trùng trong màn hình hoặc trong bindings | `core/project-manager`, `packages/project-schema` |
| `E_ITEM_ID` | — | Id item sai dạng hoặc trùng | `core/project-manager`, `packages/project-schema` |
| `E_ITEM_SIZE` | — | Cỡ nhỏ hơn `minSize` của loại, hoặc ≤ 0 | `core/project-manager`, `packages/project-schema` |
| `E_NAV` | — | Mục menu trỏ tới màn hình không có hoặc popup; nhóm lồng nhóm; nhóm rỗng | `core/project-manager`, `packages/project-schema` |
| `E_POPUP_ARGS` | — | Tham số `args` của hành động mở popup thiếu, thừa, sai kiểu, hoặc popup được mở với quá 1.000 bộ tham số khác nhau | `core/project-manager`, `packages/project-schema` |
| `E_REF_TAG` | — | Binding trỏ Tag không tồn tại | `core/project-manager`, `packages/project-schema` |
| `E_REF_UID` | — | Binding trỏ `elementUid` không có trong `screen.elements` | `core/project-manager`, `packages/project-schema` |
| `E_SCALE_RANGE` | — | Thang đo của binding có `inMin` bằng `inMax` | `core/project-manager`, `packages/project-schema` |
| `E_SCREEN_ID` | — | Id screen không khớp tên file / `project.screens` / `bindings.screenId`; `entryScreen` không có trong `screens` | `core/project-manager`, `packages/project-schema` |
| `E_SCREEN_KIND` | — | `kind` của màn hình sai, hoặc `entryScreen` là popup | `core/project-manager`, `packages/project-schema` |
| `E_SCREEN_SIZE` | — | `size` của màn hình ngoài khoảng | `core/project-manager`, `packages/project-schema` |
| `E_SCREEN_TAGS` | — | Một màn hình dùng hơn 1000 Tag khác nhau (giới hạn của một lần đăng ký dữ liệu sống) | `core/common`, `core/project-manager`, `packages/project-schema` |
| `E_TARGET_UNSUPPORTED` | — | Đích của binding có trong danh sách nhưng phiên bản này chưa hỗ trợ | `core/project-manager`, `packages/project-schema` |
| `E_TEMPLATE_ID` | — | Template có id khác tên tệp, hoặc id item trong template sai dạng hay bị trùng | `core/project-manager`, `packages/project-schema` |
| `E_TEMPLATE_PARAM` | — | Tham số template hoặc popup sai: tham số chưa khai, đặt ngoài chỗ cho phép, dấu ngoặc nhọn lạ, khai báo hay giá trị tham số không hợp lệ | `core/project-manager`, `packages/project-schema` |
| `E_TEMPLATE_REF` | — | Item sinh từ template trỏ template hoặc item không có, hoặc id không đúng dạng <bản sao>.<item> | `core/project-manager`, `packages/project-schema` |
| `E_TEMPLATE_TAG_REF` | — | Tag sau khi thay tham số (bản sao template hoặc popup có tham số) không có hoặc sai kiểu khe | `core/project-manager`, `packages/project-schema` |
| `E_TRANSFORM_UNSUPPORTED` | — | Phép biến đổi chưa hỗ trợ (`rangeMap`, `format`, `expression`) | `core/project-manager`, `packages/project-schema` |
| `E_TYPE_MISMATCH` | — | Kiểu Tag không hợp với transform/đích, hoặc `equals` sai kiểu | `core/project-manager`, `packages/project-schema` |
| `E_WIDGET_CONFIRM` | — | `confirm: "none"` với Tag không phải BOOL | `core/project-manager`, `packages/project-schema` |
| `E_WIDGET_LIMITS` | — | `min`/`max` của widget rộng hơn `Tag.limits` hoặc `min ≥ max` | `core/project-manager`, `packages/project-schema` |
| `E_WIDGET_MINROLE` | — | `security.minRole` = `viewer` hoặc giá trị lạ | `core/project-manager`, `packages/project-schema` |
| `E_WIDGET_PROP` | — | Thuộc tính lạ, sai kiểu, ngoài khoảng, thiếu nhau (`yMin` không `yMax`) | `core/project-manager`, `packages/project-schema` |
| `E_WIDGET_SLOT` | — | Khe lạ, khe bắt buộc thiếu, khe không dùng với hành động này | `core/project-manager`, `packages/project-schema` |
| `E_WIDGET_TAG_TYPE` | — | Kiểu Tag không thuộc khe | `core/project-manager`, `packages/project-schema` |
| `E_WIDGET_UNKNOWN` | — | Loại widget lạ | `core/project-manager`, `packages/project-schema` |
| `W_ACTION_NOOP` | — | Hành động `closePopup` trên màn hình thường (không phải popup) không làm gì | `core/project-manager`, `packages/project-schema` |
| `W_CONFIRM_NONE` | — | Widget điều khiển đặt `confirm: "none"`: ghi không cần xác nhận | `core/project-manager`, `packages/project-schema` |
| `W_ITEM_COVERED` | — | Widget bị item phía trên che hoàn toàn | `core/project-manager`, `packages/project-schema` |
| `W_ITEM_OUTSIDE` | — | Item nằm hoàn toàn ngoài màn hình | `core/project-manager`, `packages/project-schema` |
| `W_PULSE_READBACK` | — | Hành động `pulse` trên Tag bật đọc lại | `core/project-manager`, `packages/project-schema` |
| `W_SCREEN_EMPTY` | — | Màn hình không có item | `core/project-manager`, `packages/project-schema` |
| `W_SCREEN_TAGS_MANY` | — | Màn hình > 500 Tag riêng biệt | `core/project-manager`, `packages/project-schema` |
| `W_STRETCH_WIDGETS` | — | `fitMode: "stretch"` mà có widget | `core/project-manager`, `packages/project-schema` |
| `W_TEMPLATE_DRIFT` | — | Item của bản sao không còn khớp template (sửa tay hoặc template đã đổi): dùng "Cập nhật mọi bản sao" | `core/project-manager`, `packages/project-schema` |

<a id="svg"></a>

## SVG, hoạt ảnh, sự kiện và nhập SVG

| Mã | HTTP | Thông điệp | Nơi dùng |
| --- | --- | --- | --- |
| `E_BIND_PARAM` | — | Tham số của binding sai kiểu, ngoài miền, hoặc không thuộc đích | `core/project-manager`, `packages/project-schema` |
| `E_BIND_TRANSFORM` | — | Phép biến đổi không thuộc danh sách của đích (ví dụ `linearScale` cho `style.fill`) | `core/project-manager`, `packages/project-schema` |
| `E_EVENT_ACTION` | — | Khóa sự kiện khác `click`, hoặc hành động ngoài 6 hành động, hoặc thiếu/thừa trường theo hành động | `core/project-manager`, `packages/project-schema` |
| `E_EVENT_CONFIRM` | — | `confirm` = `none` với Tag không phải BOOL | `core/project-manager`, `packages/project-schema` |
| `E_EVENT_MINROLE` | — | `minRole` = `viewer` hoặc giá trị lạ | `core/project-manager`, `packages/project-schema` |
| `E_EVENT_TAG` | — | Hành động ghi của sự kiện trỏ Tag không có, không ghi được, hoặc giá trị sai kiểu hay ngoài giới hạn | `core/project-manager`, `packages/project-schema` |
| `E_EVENT_TARGET` | — | `navigate` tới màn hình không có hoặc `popup`; `popup` tới màn hình không có hoặc `screen` | `core/project-manager`, `packages/project-schema` |
| `E_IMPORT_DTD` | — | File có khai báo DTD hoặc ENTITY | `packages/svg-import` |
| `E_IMPORT_ENCODING` | — | Mã hóa của file không hợp lệ | `packages/svg-import` |
| `E_IMPORT_EXT` | — | File không có đuôi .svg | `packages/svg-import` |
| `E_IMPORT_LIMIT` | — | File vượt giới hạn | `packages/svg-edit`, `packages/svg-import` |
| `E_IMPORT_PARSE` | — | File không phải XML hợp lệ | `packages/svg-import` |
| `E_IMPORT_ROOT` | — | File không phải SVG | `packages/svg-import` |
| `E_IMPORT_SIZE` | — | Không xác định được kích thước | `packages/svg-import` |
| `E_IMPORT_USE_BOMB` | — | Phần tử use mở rộng quá lớn | `packages/svg-edit`, `packages/svg-import` |
| `E_RANGE` | — | Khoảng chồng, `from` ≥ `to`, thiếu cả `from` và `to`, > 64 khoảng | `core/project-manager`, `packages/project-schema` |
| `E_SVG_LIMIT` | — | File SVG của item > 5 MiB, > 20.000 phần tử hoặc sâu hơn 32 | `packages/project-schema`, `packages/svg-edit` |
| `E_SVG_UNSAFE` | — | File SVG của item không qua allowlist (còn phần tử, thuộc tính hoặc giá trị ngoài danh sách) | `packages/project-schema`, `packages/svg-edit` |
| `W_ANIM_MANY` | — | > 64 hoạt ảnh vô hạn trong một màn hình | `core/project-manager`, `packages/project-schema` |
| `W_BIND_CLIP_EXISTS` | — | `geometry.clipLevel` trên phần tử đã có `clip-path` gốc | `core/project-manager`, `packages/project-schema` |
| `W_BIND_ELEMENT_KIND` | — | Đích của binding không hợp loại phần tử SVG | `core/project-manager`, `packages/project-schema` |
| `W_BLINK_ONLY` | — | Phần tử có `effect.blink` theo một Tag mà không có binding `text.content`, `style.fill` hoặc `style.stroke` cùng Tag (nhấp nháy là tín hiệu duy nhất) | `core/project-manager`, `packages/project-schema` |
| `W_EVENT_CONFIRM_NONE` | — | Sự kiện ghi Tag BOOL đặt `confirm` = `none`: ghi không cần xác nhận | `core/project-manager`, `packages/project-schema` |
| `W_EVENT_PULSE_READBACK` | — | Hành động `pulse` của sự kiện trên Tag bật đọc lại | `core/project-manager`, `packages/project-schema` |
| `W_IMPORT_CSS_PARTIAL` | — | Một số luật CSS không được hỗ trợ nên có thể làm sai màu hoặc kiểu: hãy kiểm tra hình | `packages/svg-import` |
| `W_IMPORT_FLOWTEXT_NOWRAP` | — | Chữ khung flowRoot mất xuống dòng khi chuyển thành chữ một dòng | `packages/svg-import` |
| `W_IMPORT_FONT_FALLBACK` | — | Font không có trong bảng nên dùng sans-serif làm dự phòng | `packages/svg-import` |
| `W_IMPORT_HEAVY` | — | File sau chuẩn hóa từ 1 MiB trở lên: nặng cho thiết bị và mạng yếu | `packages/svg-import` |
| `W_IMPORT_NO_DRAWABLE` | — | File không còn phần tử vẽ được nào sau khi làm sạch | `packages/svg-import` |
| `W_SVG_FONT` | — | Phông chữ không thuộc danh sách an toàn (sans-serif, serif, monospace, Arial, Segoe UI, Roboto): máy vận hành có thể hiển thị bằng phông khác | `packages/svg-edit` |
| `W_SVG_HEAVY` | — | File SVG của item ≥ 1 MiB, hoặc ≥ 10.000 phần tử | `core/project-manager`, `packages/project-schema` |
| `W_UID_NOT_IN_SVG` | — | Binding hoặc sự kiện trỏ elementUid không có trong file SVG | `core/project-manager`, `packages/project-schema` |

<a id="alarm"></a>

## Alarm

| Mã | HTTP | Thông điệp | Nơi dùng |
| --- | --- | --- | --- |
| `ALARM_DISABLED` | 409 | Alarm đang bị vô hiệu, không tạm ẩn được | `server` |
| `ALARM_DROPPED` | — | Động cơ alarm đã bỏ một số thay đổi trạng thái do hàng đợi ghi lịch sử đầy | `server` |
| `ALARM_HISTORY_BUSY` | 503 | Thiết bị đang bận truy vấn lịch sử, thử lại sau ít giây | `server` |
| `ALARM_LOG_ERROR` | — | Kho lịch sử alarm đang lỗi, không ghi được | `server` |
| `ALARM_LOG_PAUSED` | — | Kho lịch sử alarm tạm dừng ghi (đĩa đầy) | `server` |
| `ALARM_LOG_UNAVAILABLE` | 503 | Không đọc được lịch sử alarm của thiết bị | `server` |
| `ALARM_NOT_FOUND` | 404 | Không có alarm này trong project đang chạy | `server` |
| `ALARM_TIMEOUT` | — | Động cơ alarm chưa áp dụng kịp. Hãy tải lại danh sách rồi kiểm tra. | `server` |
| `ALREADY_ACKED` | — | Alarm đã được xác nhận từ trước | `core/alarm`, `server` |
| `ALREADY_DISABLED` | — | Alarm đã bị vô hiệu từ trước | `core/alarm` |
| `BAD_QUERY` | 400 | Bộ lọc không hợp lệ, kiểm tra lại khoảng thời gian và chữ tìm | `server`, `server/http` |
| `DB_CORRUPT` | — | Kho lịch sử alarm bị hỏng: đã đổi tên file hỏng và tạo kho mới | `core/alarm` |
| `E_ALARM_AREA_COUNT` | — | Quá 64 khu vực | `core/project-manager`, `packages/project-schema` |
| `E_ALARM_AREA_DUP` | — | Id khu vực bị trùng | `core/alarm`, `core/project-manager`, `packages/project-schema` |
| `E_ALARM_AREA_REF` | — | Khu vực không có | `core/project-manager`, `packages/project-schema` |
| `E_ALARM_CLASS_COUNT` | — | Cần 1 đến 16 lớp | `core/project-manager`, `packages/project-schema` |
| `E_ALARM_CLASS_DUP` | — | Id lớp bị trùng | `core/alarm`, `core/project-manager`, `packages/project-schema` |
| `E_ALARM_CLASS_FIELD` | — | Trường của lớp sai hoặc lạ | `core/project-manager`, `packages/project-schema` |
| `E_ALARM_CLASS_REF` | — | Lớp alarm không có | `core/alarm`, `core/project-manager`, `packages/project-schema` |
| `E_ALARM_COUNT` | — | Vượt 500 instance hoặc file alarm lớn hơn 512 KiB | `core/alarm`, `core/project-manager`, `packages/project-schema` |
| `E_ALARM_DEADBAND` | — | Deadband phải là số ≥ 0 và nhỏ hơn khoảng cách tới ngưỡng kế | `core/project-manager`, `packages/project-schema` |
| `E_ALARM_DELAY_RANGE` | — | Trễ phải từ 0 đến 86.400 s | `core/project-manager`, `packages/project-schema` |
| `E_ALARM_DEVICE_REF` | — | Thiết bị trường không có, hoặc alarm quality cần đúng một trong Tag, thiết bị | `core/project-manager`, `packages/project-schema` |
| `E_ALARM_FIELD` | — | Trường sai hoặc lạ | `core/project-manager`, `packages/project-schema` |
| `E_ALARM_ID_DUP` | — | Id alarm bị trùng | `core/alarm`, `core/project-manager`, `packages/project-schema` |
| `E_ALARM_ID_FORMAT` | — | Id alarm phải bắt đầu bằng chữ cái, 2 đến 48 ký tự chữ, số, gạch dưới | `core/project-manager`, `packages/project-schema` |
| `E_ALARM_LIMIT_NONE` | — | Alarm ngưỡng cần ít nhất một trong LL, L, H, HH | `core/alarm`, `core/project-manager`, `packages/project-schema` |
| `E_ALARM_LIMIT_ORDER` | — | Ngưỡng phải là số và theo thứ tự LL < L < H < HH | `core/project-manager`, `packages/project-schema` |
| `E_ALARM_ON` | — | Điều kiện quality của alarm phải là `bad` hoặc `notGood` | `core/project-manager`, `packages/project-schema` |
| `E_ALARM_TAG_REF` | — | Tag không có trong project | `core/project-manager`, `packages/project-schema` |
| `E_ALARM_TAG_TYPE` | — | Kiểu Tag không hợp loại alarm | `core/project-manager`, `packages/project-schema` |
| `E_ALARM_TEXT_LEN` | — | Nội dung dài hơn 200 ký tự | `core/project-manager`, `packages/project-schema` |
| `E_ALARM_TEXT_TOKEN` | — | Nội dung có thẻ lạ hoặc thiếu dấu ngoặc | `core/project-manager`, `packages/project-schema` |
| `E_ALARM_TRIGGER` | — | Điều kiện của alarm số phải là Khi bật hoặc Khi tắt | `core/project-manager`, `packages/project-schema` |
| `E_ALARM_TYPE` | — | Loại alarm phải là Số, Ngưỡng hoặc Quality | `core/alarm`, `core/project-manager`, `packages/project-schema` |
| `LIVE_ACK_NOT_ALLOWED` | — | Không xác nhận alarm qua kênh dữ liệu sống; dùng API alarm qua HTTPS | `server` |
| `NOT_ACTIVE` | — | Alarm đã hết, không còn ở trạng thái đang có | `core/alarm` |
| `NOT_DISABLED` | — | Alarm không bị vô hiệu nên không cần bật lại | `core/alarm` |
| `NOT_SHELVED` | — | Alarm không đang tạm ẩn | `core/alarm` |
| `NO_DATA` | — | Tag chưa có dữ liệu cho động cơ alarm | `server` |
| `SHELVE_RANGE` | 422 | Lý do 1 đến 120 ký tự; thời gian từ 1 phút đến 8 giờ; tối đa 50 alarm tạm ẩn | `core/alarm`, `server` |
| `W_ALARM_CHATTER_RISK` | — | Không có deadband và trễ: alarm có thể chập chờn | `core/project-manager`, `packages/project-schema` |
| `W_ALARM_COUNT_HIGH` | — | Hơn 200 instance: cân nhắc gọn lại | `core/project-manager`, `packages/project-schema` |
| `W_ALARM_DEVICE_EMPTY` | — | Thiết bị không có Tag đọc từ nó | `core/project-manager`, `packages/project-schema` |
| `W_ALARM_NO_ACK_CRITICAL` | — | Lớp khẩn cấp không cần xác nhận | `core/project-manager`, `packages/project-schema` |
| `W_WIDGET_ALARM_REF` | — | Widget alarm tham chiếu khu vực hoặc lớp không có trong project | `core/project-manager`, `packages/project-schema` |

<a id="history"></a>

## Lưu trữ, lịch sử và báo cáo

| Mã | HTTP | Thông điệp | Nơi dùng |
| --- | --- | --- | --- |
| `BUSY` | 429 | Máy chủ đang bận truy vấn khác; thử lại sau ít giây. | `server/http` |
| `EXPORT_TOO_LARGE` | 422 | Quá nhiều dòng để xuất; chọn khoảng ngắn hơn hoặc độ phân giải thấp hơn. | `server/http` |
| `E_LOG_AGG` | — | `aggregates` mà nhóm không có Tag số/BOOL nào có tổng hợp; `aggregate: true` cho Tag `STRING`; `hourRetentionDays < minuteRetentionDays` | `core/project-manager`, `packages/project-schema` |
| `E_LOG_COLUMN` | — | Tên cột không hợp lệ, là tên dành riêng, hoặc trùng tên khác trong nhóm (không phân biệt hoa thường) | `core/project-manager`, `packages/project-schema` |
| `E_LOG_CONN` | — | Thiếu trường bắt buộc theo `type` (SQL: `host`, `database`, `user`; `influxdb`: `url`, `org`, `bucket`) hoặc có trường của loại khác | `core/project-manager`, `packages/project-schema` |
| `E_LOG_DEADBAND` | — | `deadband` cho Tag không phải số | `core/project-manager`, `packages/project-schema` |
| `E_LOG_DUP_ID` | — | Trùng `id` nhóm, hoặc trùng `id` kết nối | `core/project-manager`, `packages/project-schema` |
| `E_LOG_DUP_TAG` | — | Một Tag xuất hiện hai lần trong cùng nhóm | `core/project-manager`, `packages/project-schema` |
| `E_LOG_LIMIT` | — | Nhóm có > 64 Tag `STRING` | `core/project-manager`, `packages/project-schema` |
| `E_LOG_MAXLEN` | — | `maxLength` cho Tag không phải `STRING` | `core/project-manager`, `packages/project-schema` |
| `E_LOG_MODE` | — | `cyclic` thiếu `periodMs`, hoặc có `minIntervalMs`/`maxIntervalMs`; `onChange` có `periodMs`; `maxIntervalMs < minIntervalMs` | `core/project-manager`, `packages/project-schema` |
| `E_LOG_REF_DEST` | — | `destinations` trỏ tới kết nối không có | `core/project-manager`, `packages/project-schema` |
| `E_LOG_REF_TAG` | — | `tagId` không có trong `tags.json` | `core/project-manager`, `packages/project-schema` |
| `E_LOG_SECRET` | — | Có khóa giống bí mật, hoặc `url` có tài khoản/mật khẩu | `core/package`, `core/project-manager`, `packages/project-schema` |
| `E_LOG_TABLE` | — | Tên bảng không hợp lệ, bắt đầu bằng mat_, hoặc trùng bảng của nhóm khác | `core/project-manager`, `packages/project-schema` |
| `E_LOG_TLS` | — | `tls` không hợp với URL: `influxdb` với `http://` mà `tls` khác `disable`; `influxdb` với `https://` mà `tls` là `disable`/`prefer` | `core/project-manager`, `packages/project-schema` |
| `E_LOG_TRIGGER` | — | Cấu hình ghi theo sự kiện (trigger) sai: thiếu trigger, Tag kiểu chuỗi, hoặc tham số không hợp với mode | `core/project-manager`, `packages/project-schema` |
| `E_NAV_REPORT` | — | `navigation[].report` không có trong `reports.json` (hoặc không có `reportsFile`) | `core/project-manager`, `packages/project-schema` |
| `E_RPT_DUP_ID` | — | Trùng `id` mẫu báo cáo | `core/project-manager`, `packages/project-schema` |
| `E_RPT_FN` | — | Hàm tổng hợp lặp trong một cột của báo cáo | `core/project-manager`, `packages/project-schema` |
| `E_RPT_LIMIT` | — | Quá 24 cột (Tag × hàm) hoặc quá 24 Tag | `core/project-manager`, `packages/project-schema` |
| `E_RPT_NO_AGG` | — | Nhóm không có `aggregates`, hoặc Tag có `aggregate:false`, hoặc Tag kiểu chuỗi | `core/project-manager`, `packages/project-schema` |
| `E_RPT_PERIOD` | — | `shifts` với `day` hoặc `month`; thiếu `shifts` khi `shift`; `rowMinutes` với kỳ khác `day` | `core/project-manager`, `packages/project-schema` |
| `E_RPT_REF_GROUP` | — | `group` không có trong `logging.json` (hoặc project không có `loggingFile`) | `core/project-manager`, `packages/project-schema` |
| `E_RPT_REF_TAG` | — | `tagId` của báo cáo không thuộc nhóm lưu trữ | `core/project-manager`, `packages/project-schema` |
| `E_RPT_SHIFT` | — | Ca sai: count phải thuộc 2, 3, 4, 6, 8, 12 và start đúng định dạng | `core/project-manager`, `packages/project-schema` |
| `E_WIDGET_HISTORY_AGG` | — | Khe có `needsAggregate` mà nhóm không bật `aggregates` hoặc Tag `aggregate:false` hay kiểu chuỗi | `core/project-manager`, `packages/project-schema` |
| `E_WIDGET_HISTORY_GROUP` | — | `group` không có trong `logging.json` (hoặc project không có `loggingFile`) | `core/project-manager`, `packages/project-schema` |
| `E_WIDGET_HISTORY_TAG` | — | Tag ở khe có `inGroup` không thuộc nhóm | `core/project-manager`, `packages/project-schema` |
| `HISTORY_UNAVAILABLE` | 503 | Dữ liệu lưu trữ chưa sẵn sàng. | `server/http` |
| `NO_AGGREGATES` | 422 | Nhóm này không bật bảng tổng hợp. | `core/historian`, `server/http` |
| `NO_HISTORY` | 404 | Dự án không có lưu trữ lịch sử. | `server/http` |
| `QUERY_TIMEOUT` | 503 | Truy vấn quá hạn. | `core/historian`, `server/http` |
| `RANGE_TOO_LARGE` | 422 | Khoảng yêu cầu có quá nhiều cửa sổ hoặc hàng tổng hợp. | `server/http` |
| `SCAN_LIMIT` | 422 | Khoảng thời gian quá dài để đọc dòng thô; chọn tổng hợp hoặc khoảng ngắn hơn. | `core/historian`, `server/http` |
| `UNKNOWN_GROUP` | 404 | Không có nhóm lưu trữ này. | `server/http` |
| `UNKNOWN_TAG` | 404 | Tag không thuộc nhóm lưu trữ. | `server/http` |
| `W_LOG_SIZE_CAP` | — | Ước tính dung lượng cần để giữ đủ thời hạn lưu > 2 GiB (trần mặc định) | `core/project-manager`, `packages/project-schema` |
| `W_LOG_TLS_UNVERIFIED` | — | Nhóm lưu trữ gửi tới kết nối không xác thực máy chủ: kẻ đứng giữa có thể lấy mật khẩu hoặc token | `core/historian`, `core/project-manager`, `packages/project-schema` |
| `W_LOG_WRITE_BUDGET` | — | Ước tính ghi eMMC > 2 GiB/ngày | `core/project-manager`, `packages/project-schema` |
| `W_LOG_WRITE_EXTREME` | — | Ước tính ghi > 8 GiB/ngày (4 lần ngân sách): Studio cần xác nhận mạnh hơn khi nạp xuống | `core/project-manager`, `packages/project-schema` |

<a id="package"></a>

## Gói project (.matscada)

| Mã | HTTP | Thông điệp | Nơi dùng |
| --- | --- | --- | --- |
| `E_PACKAGE_EXTRA_FILE` | — | Gói hoặc project có tệp không thuộc project (tệp không được tham chiếu, thư mục ẩn như .mat-editor/, .mat-backup/, node_modules/, Thumbs.db, desktop.ini, ~*, *.tmp) | `core/package`, `core/project-store`, `packages/project-schema`, `server` |
| `E_PKG_CHECKSUM` | — | CRC32, SHA-256 hoặc kích thước khác manifest | `core/package` |
| `E_PKG_DIGEST` | — | `digest` khác giá trị tính lại; khác header `X-Mat-Digest` (nạp xuống) hoặc khác digest mong đợi (đọc lên) | `core/package` |
| `E_PKG_ENTRIES` | — | Gói phải có 1–1024 entry (gồm manifest) | `core/package` |
| `E_PKG_FORMAT` | — | File gói không đúng tập con ZIP được hỗ trợ, hoặc dữ liệu nén hỏng | `core/package` |
| `E_PKG_FORMAT_VERSION` | — | Phiên bản định dạng gói không hỗ trợ (MAJOR khác 1) | `core/package` |
| `E_PKG_IDENTITY` | — | Trường project của manifest khác `project.json` | `core/package` |
| `E_PKG_MANIFEST` | — | Không có manifest ở entry đầu; manifest sai JSON hoặc schema; `files` trùng hoặc chưa sắp xếp | `core/package` |
| `E_PKG_MISSING` | — | Manifest liệt kê file mà gói không có | `core/package` |
| `E_PKG_PATH` | — | Tên file trong gói không an toàn (symlink, đường dẫn tuyệt đối, "..", trùng tên khi không phân biệt hoa thường…) | `core/audit`, `core/package` |
| `E_PKG_RATIO` | — | File trong gói nén quá 100 lần (nghi bom nén) | `core/package` |
| `E_PKG_SECRET` | — | Gói chứa dữ liệu giống bí mật (khóa JSON như password, token; URL có tài khoản; khóa riêng) | `core/package` |
| `E_PKG_SIZE` | — | File trong gói vượt cỡ cho phép (JSON 1 MiB, SVG 5 MiB, tổng 200 MiB sau giải nén) | `core/package` |
| `E_PKG_TOO_LARGE` | — | Gói lớn hơn 50 MiB (52.428.800 byte) | `core/package` |
| `E_PKG_TYPE` | — | Gói chỉ chứa file .json hoặc .svg (chữ thường) | `core/package` |
| `E_PKG_UNLISTED` | — | Gói có file không có trong manifest | `core/package` |

<a id="deploy"></a>

## Nạp xuống, đọc lên, kho project và kiểm tra sức khỏe

| Mã | HTTP | Thông điệp | Nơi dùng |
| --- | --- | --- | --- |
| `ALREADY_ACTIVE` | 409 | Bản này đang chạy. | `core/project-store`, `server/http` |
| `BASE_CHANGED` | 409 | Project trên thiết bị đã đổi sau lúc xem trước. Hãy đọc lại rồi thử lại. | `core/project-store`, `server/http` |
| `DEVICE_BUSY` | 409 | Thiết bị đang bận với một thao tác khác. | `core/project-store`, `server`, `server/http` |
| `EXEC_FAILED` | — | Không khởi động lại được runtime | `core/project-store` |
| `HEALTH_CRASH` | — | Runtime dừng 2 lần khi chạy bản này | `core/project-store` |
| `HEALTH_HTTPS` | — | Không mở được HTTPS | `core/project-store` |
| `HEALTH_PROJECT` | — | Project không kích hoạt được | `core/project-store` |
| `HEALTH_TIMEOUT` | — | Runtime không đạt kiểm tra sức khỏe trong 15 s | `core/project-store` |
| `NO_BASE_PROJECT` | 409 | Project cài theo cách cũ chưa vào kho nên chưa nạp xuống được (sẽ mất project đó). | `core/project-store`, `server/http` |
| `NO_PROJECT_PACKAGE` | 404 | Thiết bị chưa có gói project để đọc lên. | `server/http` |
| `NO_SPACE` | 507 | Thiết bị không đủ chỗ trống. | `core/package`, `core/project-store`, `server/http` |
| `NO_SUCH_OPERATION` | 404 | Không có thao tác này (chỉ giữ 20 thao tác gần nhất). | `server/http` |
| `NO_SUCH_VERSION` | 404 | Không có bản project này trên thiết bị. | `core/project-store`, `server/http` |
| `NO_VALID_PROJECT` | 503 | Thiết bị không có project hợp lệ đang chạy | `server/http` |
| `PACKAGE_TOO_LARGE` | 413 | Gói project lớn hơn 50 MiB. | `server/http` |
| `PERSIST_FAILED` | 500 | Thiết bị không ghi được bản ghi thao tác (đầy hoặc chỉ đọc): thao tác dừng trước khi kích hoạt, project cũ vẫn chạy. | `core/project-store`, `server` |
| `RECEIVE_ABORTED` | — | Mất kết nối khi nhận gói. | `core/project-store`, `server/http` |
| `RECEIVE_TIMEOUT` | — | Không nhận xong gói trong 10 phút. | `core/project-store`, `server/http` |
| `STORE_IO` | 500 | Lỗi đọc hoặc ghi kho project của thiết bị. | `core/package`, `core/project-store`, `server`, `server/cli`, `server/http` |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Gói project phải gửi với Content-Type: application/zip. | `server/http` |

<a id="auth"></a>

## Đăng nhập, phiên và truy cập HTTP

| Mã | HTTP | Thông điệp | Nơi dùng |
| --- | --- | --- | --- |
| `AUDIT_UNAVAILABLE` | 503 | Thiết bị không ghi được nhật ký kiểm toán nên chưa thực hiện | `core/auth`, `core/project-store`, `core/tag-engine`, `server`, `server/http` |
| `AUTH_FAILED` | 401 | Sai tên đăng nhập hoặc mật khẩu. | `core/auth`, `server/http` |
| `AUTH_LOCKED` | 429 | Đăng nhập đang bị khóa tạm do sai nhiều lần. Hãy thử lại sau. | `core/auth`, `server/http` |
| `AUTH_REQUIRED` | 401 | Cần đăng nhập. | `server/http` |
| `BAD_REQUEST` | 400 | Yêu cầu không hợp lệ. | `drivers/modbus`, `server`, `server/http` |
| `BODY_TOO_LARGE` | 413 | Nội dung yêu cầu quá lớn. | `server/http` |
| `CSRF_FAILED` | 403 | Yêu cầu không có mã chống giả mạo hợp lệ. Hãy tải lại trang. | `server/http` |
| `FETCH_SITE` | 403 | Yêu cầu từ trang khác nguồn bị từ chối. | `server/http` |
| `FORBIDDEN` | 403 | Tài khoản không đủ quyền cho thao tác này. | `server/http` |
| `HOST_NOT_ALLOWED` | 421 | Tên này chưa được phép. Quản trị viên: thêm vào allowedHosts của runtime.json. | `server` |
| `HTTPS_REQUIRED` | 403 | Chức năng này chỉ dùng được qua HTTPS (cổng kỹ thuật). | `server/http` |
| `INTERNAL_ERROR` | 500 | Lỗi nội bộ của thiết bị. | `core/auth`, `server/http` |
| `LENGTH_REQUIRED` | 411 | Yêu cầu cần có Content-Length. | `server/http` |
| `LOGIN_BUSY` | 429 | Thiết bị đang bận kiểm tra các đăng nhập khác. Hãy thử lại sau giây lát. | `core/auth`, `server/http` |
| `METHOD_NOT_ALLOWED` | 405 | Phương thức không được hỗ trợ cho đường dẫn này. | `server/http` |
| `NOT_FOUND` | 404 | Không có chức năng này. | `core/alarm`, `server`, `server/http` |
| `NOT_IMPLEMENTED` | 501 | Phiên bản runtime này chưa có chức năng này. | `server/http` |
| `ORIGIN_MISMATCH` | 403 | Yêu cầu không xuất phát từ trang của thiết bị này. | `server/http` |
| `SESSION_EXPIRED` | 401 | Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại. | `core/auth`, `server/http` |
| `SESSION_INVALID` | 401 | Phiên đăng nhập không còn dùng được (đổi địa chỉ, tài khoản bị tắt hoặc đã đổi). | `core/auth`, `server/http` |
| `SESSION_SCOPE` | 403 | Phiên đăng nhập của trang này không dùng được cho thao tác này. | `server/http` |
| `SOURCE_NOT_ALLOWED` | 403 | Địa chỉ nguồn không được phép mở trang xem (viewerAccess = private) | `server/http` |
| `UNLOCK_REQUEST_FAILED` | — | Không ghi được tệp yêu cầu mở mọi khóa đăng nhập | `server/cli` |
| `UNLOCK_REQUEST_REFUSED` | — | Tệp yêu cầu mở mọi khóa đăng nhập không phải tệp thường của root quyền 0600: đã xóa, không dùng | `core/auth` |
| `VIEWER_OFF` | 403 | Trang xem đã bị tắt trên thiết bị này (viewerAccess = off). | `server/http` |

<a id="write"></a>

## Ghi Tag

| Mã | HTTP | Thông điệp | Nơi dùng |
| --- | --- | --- | --- |
| `BAD_TYPE` | — | Giá trị không đúng kiểu của Tag. | `core/tag-engine` |
| `CONNECTION_BAD` | — | Kết nối tới PLC đang mất. | `core/tag-engine` |
| `DEVICE_EXCEPTION` | — | Thiết bị trường từ chối lệnh ghi | `drivers/modbus` |
| `DEVICE_NOT_ACTIVE` | — | Thiết bị trường chưa hoạt động. | `core/tag-engine` |
| `EXPECT_NOT_BOOL` | — | Chỉ Tag BOOL mới có giá trị mong đợi (expect). | `core/tag-engine` |
| `LIVE_WRITE_NOT_ALLOWED` | — | Không ghi qua kênh dữ liệu sống | `server` |
| `NOT_FINITE` | — | Giá trị phải là số hữu hạn. | `core/tag-engine` |
| `NOT_SENT_DEADLINE` | — | Chưa gửi: lệnh ghi quá hạn writeDeadlineMs trong hàng đợi | `drivers/modbus` |
| `NOT_SENT_DEVICE_SUSPENDED` | — | Chưa gửi: thiết bị trường đang tạm ngưng | `drivers/modbus` |
| `NOT_SENT_DISCONNECTED` | — | Chưa gửi: mất kết nối tới thiết bị trường | `drivers/modbus` |
| `NOT_SENT_PROJECT_CHANGE` | — | Chưa gửi: thiết bị đổi project | `core/tag-engine` |
| `NOT_SENT_QUEUE_FULL` | — | Chưa gửi: hàng đợi ghi của kênh đã đầy | `core/tag-engine` |
| `NOT_SENT_READ_FAILED` | — | Chưa gửi: đọc trước khi ghi lỗi | `drivers/modbus` |
| `NOT_SENT_UNSUPPORTED` | — | Chưa gửi: thiết bị trường không hỗ trợ kiểu ghi này | `drivers/modbus` |
| `NO_READBACK` | — | Thiết bị xác nhận, không đọc lại | `drivers/modbus` |
| `NO_SUCH_REQUEST` | 404 | Không có lệnh ghi với mã yêu cầu này (quá 15 phút hoặc của tài khoản khác) | `server/http` |
| `NO_SUCH_TAG` | — | Không có Tag này trên thiết bị. | `core/tag-engine` |
| `OUT_OF_LIMITS` | — | Giá trị ngoài giới hạn nhập của Tag. | `core/logic`, `core/tag-engine` |
| `OUT_OF_RAW_RANGE` | — | Giá trị ngoài khoảng thô của thiết bị trường sau khi đổi thang. | `core/tag-engine` |
| `OUT_OF_TYPE_RANGE` | — | Giá trị ngoài khoảng của kiểu dữ liệu. | `core/tag-engine` |
| `OWNED_BY_LOGIC` | — | Tag này do logic của project đặt: không ghi tay được. | `core/tag-engine` |
| `PROJECT_CHANGING` | — | Thiết bị đang đổi project. | `core/tag-engine` |
| `PULSE_ACK_REQUEST_FAILED` | — | Không ghi được tệp yêu cầu đóng mục PULSE_STUCK của nhật ký xung (mat-runtime --pulse-ack) | `server/cli` |
| `PULSE_IN_PROGRESS` | — | Tag này đang có một xung chưa kết thúc. | `core/tag-engine` |
| `PULSE_JOURNAL_FAILED` | — | Không ghi được nhật ký xung: lệnh xung bị hủy, chưa ghi gì xuống thiết bị. | `core/tag-engine`, `server` |
| `PULSE_NOT_BOOL` | — | Chỉ Tag BOOL mới ghi dạng xung (pulseMs). | `core/tag-engine` |
| `PULSE_RANGE` | — | Độ dài xung phải từ 100 đến 10.000 ms. | `core/tag-engine` |
| `PULSE_RELEASE_FAILED` | — | Đã ghi bật nhưng không ghi được giá trị trả về: bit lệnh có thể đang bật. | `core/tag-engine` |
| `QUEUE_FULL` | — | Hàng đợi ghi đã đầy. | `core/tag-engine` |
| `RATE_LIMITED` | 429 | Thao tác quá nhanh: hãy thử lại sau giây lát | `core/logic`, `core/tag-engine`, `server`, `server/http` |
| `READBACK_ERROR` | — | Lỗi khi đọc lại sau khi ghi | `drivers/modbus` |
| `READBACK_MISMATCH` | — | Đọc lại khác giá trị đã ghi | `drivers/modbus` |
| `READBACK_TIMEOUT` | — | Đã ghi nhưng không đọc lại được: không chắc kết quả. | `core/tag-engine`, `drivers/modbus` |
| `READ_ONLY` | — | Tag này không ghi được (chỉ đọc hoặc Tag tính toán). | `core/tag-engine` |
| `REQUEST_ID_CONFLICT` | — | Mã yêu cầu này đã dùng cho một lệnh khác. | `core/tag-engine` |
| `STALE_EXPECTATION` | — | Giá trị của Tag đã đổi so với lúc bạn xem: không ghi gì. | `core/tag-engine` |
| `STRING_TOO_LONG` | — | Chuỗi dài hơn mức cho phép. | `core/tag-engine`, `drivers/modbus` |
| `UNKNOWN_OUTCOME` | — | Runtime dừng giữa chừng: không rõ lệnh đã ghi chưa. | `core/audit`, `core/tag-engine` |
| `WRITE_TIMEOUT` | — | Thiết bị trường không trả lời: không chắc đã ghi. | `core/tag-engine`, `drivers/modbus` |

<a id="quality"></a>

## Lý do quality của Tag

| Mã | HTTP | Thông điệp | Nơi dùng |
| --- | --- | --- | --- |
| `BAD_FRAME` | — | Khung trả lời hỏng (CRC, độ dài hoặc định dạng Modbus) | `drivers/modbus`, `server/http` |
| `BAD_OPCODE` | — | Lỗi nội bộ của bộ chạy biểu thức (mã lệnh lạ) | `core/expression` |
| `CLAMP_RANGE` | — | Hàm clamp có cận dưới lớn hơn cận trên | `core/expression` |
| `DEVICE_SUSPENDED` | — | Thiết bị trường tạm ngưng sau nhiều lần không trả lời | `drivers/modbus` |
| `DIV_ZERO` | — | Phép chia cho 0 | `core/expression` |
| `EXCEPTION_01` | — | Exception 01: mã hàm không hỗ trợ | `drivers/modbus` |
| `EXCEPTION_08` | — | Exception 08: lỗi chẵn lẻ bộ nhớ | `drivers/modbus` |
| `EXCEPTION_0A` | — | Exception 0A: cổng nối không có đường tới thiết bị | `drivers/modbus` |
| `EXCEPTION_0B` | — | Exception 0B: thiết bị sau cổng nối không trả lời | `drivers/modbus` |
| `EXCEPTION_OTHER` | — | Exception lạ của thiết bị trường | `drivers/modbus` |
| `INPUT_BAD` | — | Đầu vào của biểu thức không tốt | `core/expression`, `core/logic`, `server/http` |
| `INVALID_VALUE` | — | Giá trị không hợp lệ (NaN hoặc vô cực) | `core/tag-engine`, `drivers/modbus` |
| `MOD_ZERO` | — | Chia lấy dư cho 0 | `core/expression` |
| `NOT_A_NUMBER` | — | Kết quả không phải số | `core/expression`, `core/tag-engine` |
| `NO_SIGNAL` | — | Tín hiệu mô phỏng không có | `drivers/simulation` |
| `NO_VALUE` | — | Chưa có giá trị | `core/expression`, `core/logic`, `core/tag-engine`, `server` |
| `OUT_OF_RANGE` | — | Kết quả ngoài khoảng của kiểu | `core/expression`, `core/tag-engine` |
| `RETAIN_LOST` | — | Bản lưu giữ qua mất điện không đọc được, dùng giá trị đầu | `core/tag-engine` |
| `SHORT_READ` | — | Thiết bị trường trả về ít dữ liệu hơn số thanh ghi cần đọc | `drivers/modbus` |
| `TOO_BIG` | — | Dữ liệu giữ qua mất điện quá lớn để ghi vào file lưu | `core/tag-engine` |

<a id="driver"></a>

## Kết nối PLC, cổng serial và Thử kết nối

| Mã | HTTP | Thông điệp | Nơi dùng |
| --- | --- | --- | --- |
| `E_FIELD_MISSING` | — | Thiếu trường bắt buộc trong yêu cầu Thử kết nối | `server/http` |
| `E_FIELD_VALUE` | — | Giá trị của trường trong yêu cầu Thử kết nối không hợp lệ | `server/http` |
| `E_PROBE_COUNT` | — | Số lượng cần đọc khi Thử kết nối ngoài khoảng cho phép | `server/http` |
| `PORT_BUSY` | — | Cổng đang được chương trình khác dùng, hoặc kênh khác đang giữ cổng với tham số khác | `drivers/modbus`, `drivers/sdk`, `server`, `server/http` |
| `PORT_CONSOLE` | — | Cổng này là console của hệ điều hành, không dùng được | `server`, `server/http` |
| `PORT_ERROR` | — | Không mở được cổng serial | `drivers/modbus`, `drivers/sdk`, `server/http` |
| `PORT_NOT_ALLOWED` | — | Cổng không nằm trong danh sách serialPorts của thiết bị | `server`, `server/http` |
| `RS485_PROBE` | — | Dò RS485 trên cổng serial (bản ghi audit driver.test) | `server/http` |
| `RS485_UNSUPPORTED` | — | Driver của cổng serial không hỗ trợ chế độ RS485 | `drivers/sdk`, `server` |
| `TEST_BUSY` | 409 | Đang có một lần Thử kết nối khác trên thiết bị này | `server/http` |
| `TEST_RATE_LIMITED` | 429 | Thử kết nối quá 10 lần mỗi phút; thử lại sau thời gian trong header `Retry-After` | `server/http` |

<a id="live"></a>

## Kênh dữ liệu sống (WebSocket)

| Mã | HTTP | Thông điệp | Nơi dùng |
| --- | --- | --- | --- |
| `BAD_MESSAGE` | — | Bản tin gửi lên kênh dữ liệu sống không hợp lệ | `server/websocket` |
| `HEARTBEAT_TIMEOUT` | — | Kênh dữ liệu sống bị đóng vì client không trả lời nhịp tim | `server/websocket` |
| `MAX_CLIENTS_REACHED` | — | Thiết bị đã đạt số kết nối dữ liệu sống tối đa, hoặc máy này đã mở tối đa số kết nối của một nguồn (scope "source"); thử lại sau | `server/websocket` |
| `MESSAGE_TOO_BIG` | — | Bản tin gửi lên kênh dữ liệu sống quá lớn | `server/websocket` |
| `NO_VALID_TAGS` | — | Không có Tag hợp lệ trong yêu cầu | `server/websocket` |
| `PROTOCOL_ERROR` | — | Client gửi sai giao thức nhiều lần liên tiếp nên kênh bị đóng | `server/websocket` |
| `RESYNC_REQUIRED` | — | Hàng đợi gửi của client đầy: client cần đồng bộ lại | `core/session-manager` |
| `SERVICE_RESTART` | — | Runtime đang khởi động lại; client tự kết nối lại | `server/websocket` |
| `SESSION_ENDED` | — | Phiên đăng nhập dùng để mở kết nối đã kết thúc | `server/websocket` |
| `TRY_AGAIN_LATER` | — | Thiết bị đang quá tải kết nối; thử lại sau | `server/websocket` |

<a id="logic"></a>

## Logic: luật, timer, counter, cộng dồn, giờ chạy, lịch và ghi PLC

| Mã | HTTP | Thông điệp | Nơi dùng |
| --- | --- | --- | --- |
| `EXPR_ERROR` | — | Biểu thức của logic không tính được lúc chạy (chia 0, tràn, kiểu sai): luật treo hoặc hành động không chạy. | `core/logic` |
| `E_LOGIC_ACTION` | — | Hành động logic không hợp lệ: loại lạ, thiếu hoặc thừa trường, hoặc setTag/toggle vào Tag không phải nội bộ | `core/project-manager`, `packages/project-schema` |
| `E_LOGIC_COUNTER` | — | Counter không hợp lệ: preset phải là số nguyên ≥ 1 (reached cần preset) | `core/project-manager`, `packages/project-schema` |
| `E_LOGIC_CYCLE` | — | Các khối logic phụ thuộc vòng vào nhau | `core/logic`, `core/project-manager`, `packages/project-schema` |
| `E_LOGIC_EXPR` | — | Biểu thức của logic không hợp lệ (cú pháp, hàm, kiểu bên trong) | `core/project-manager`, `packages/project-schema` |
| `E_LOGIC_ID` | — | Id khối logic sai dạng hoặc trùng, hoặc Tag đầu ra sai dạng | `core/project-manager`, `packages/project-schema` |
| `E_LOGIC_LIMIT` | — | logic.json vượt giới hạn: số khối, số hành động mỗi luật, cỡ tệp, khung lịch, biểu thức, hoặc tham số ngoài khoảng (hold, repeatMs, minIntervalMs, maxPerHour, serviceEveryHours) | `core/project-manager`, `packages/project-schema` |
| `E_LOGIC_SCHEDULE` | — | Lịch không hợp lệ: từ = đến, ngày hay giờ sai, ngoại lệ sai hoặc trùng, múi giờ ngoài khoảng | `core/project-manager`, `packages/project-schema` |
| `E_LOGIC_SELF_TRIGGER` | — | Luật đọc Tag do chính hành động của nó đặt (trực tiếp hoặc qua khối khác) | `core/logic`, `core/project-manager`, `packages/project-schema` |
| `E_LOGIC_TAG_COLLISION` | — | Tag đầu ra của khối logic trùng Tag có sẵn hoặc đầu ra khác | `core/project-manager`, `packages/project-schema` |
| `E_LOGIC_TAG_REF` | — | Logic tham chiếu Tag không có | `core/project-manager`, `packages/project-schema` |
| `E_LOGIC_TIMER` | — | Timer không hợp lệ: kiểu lạ hoặc pt ngoài 1 đến 86.400.000 ms | `core/project-manager`, `packages/project-schema` |
| `E_LOGIC_TOTALIZER` | — | Cộng dồn không hợp lệ: đơn vị lạ, hệ số ≤ 0, cutoff < 0, maxGapMs hoặc rolloverAt sai | `core/project-manager`, `packages/project-schema` |
| `E_LOGIC_TYPE` | — | Kiểu biểu thức hoặc Tag của logic không đúng (ví dụ điều kiện không phải BOOL) | `core/project-manager`, `packages/project-schema` |
| `E_LOGIC_VERSION` | — | logic.json có phiên bản mới hơn mức runtime hoặc Studio hiểu | `core/project-manager`, `packages/project-schema` |
| `E_LOGIC_WRITE_TARGET` | — | Tag của mục writes không phải Tag thiết bị ghi được (RW) | `core/project-manager`, `packages/project-schema` |
| `E_LOGIC_WRITE_UNDECLARED` | — | Hành động ghi PLC tham chiếu mục writes không có | `core/project-manager`, `packages/project-schema` |
| `E_LOGIC_WRITE_VALUE` | — | Giá trị ghi PLC sai kiểu hoặc ngoài danh sách cho phép (allowed) | `core/project-manager`, `packages/project-schema` |
| `LOGIC_ENABLE_ROOT_ONLY` | 403 | Chỉ root bật lại ghi PLC từ logic: mat-runtime --logic-writes-reset trên thiết bị (logic.writes của runtime.json phải là "on"). | `server/http` |
| `LOGIC_NOT_PRESENT` | 404 | Project đang chạy không có logic. | `server/http` |
| `LOGIC_RESET_REQUEST_FAILED` | — | Không ghi được tệp yêu cầu bỏ lệnh dừng ghi PLC của logic (mat-runtime --logic-writes-reset) | `server/cli` |
| `LOGIC_WRITER_MISSING` | — | Lệnh ghi của logic không gửi được: runtime không có bộ điều phối ghi (không có project chạy). | `server` |
| `LOGIC_WRITES_STOPPED` | — | Ghi PLC từ logic đã bị quản trị viên dừng: lệnh ghi bị bỏ qua. | `server` |
| `NOT_RESETTABLE` | 409 | Chỉ đặt lại được counter, totalizer, giờ chạy. | `server` |
| `NO_SUCH_BLOCK` | 404 | Không có khối logic này. | `server`, `server/http` |
| `W_LOGIC_DISABLED` | — | Luật đang tắt (enabled: false): không chạy trên thiết bị | `core/project-manager`, `packages/project-schema` |
| `W_LOGIC_NO_HOLD` | — | Luật ghi PLC không có thời gian giữ (hold = 0) trên Tag số có thể nhiễu | `core/project-manager`, `packages/project-schema` |
| `W_LOGIC_PT_ROUNDED` | — | pt của timer nhỏ hơn chu kỳ quét logic: được làm tròn lên | `core/project-manager`, `packages/project-schema` |
| `W_LOGIC_RETAIN_IO` | — | Ước tính ghi đĩa của trạng thái logic vượt 100 MiB/ngày: tăng logic.flushS hoặc giảm khối retain | `core/project-manager`, `packages/project-schema` |
| `W_LOGIC_WRITES_OFF` | — | Project có ghi PLC từ logic nhưng thiết bị đích đang tắt ghi từ logic | `core/project-manager`, `packages/project-schema` |
| `W_LOGIC_WRITE_CONFLICT` | — | Hai hành động cùng điều kiện ghi cùng Tag với giá trị khác nhau | `core/project-manager`, `packages/project-schema` |

<a id="system"></a>

## Cảnh báo hệ thống, chứng chỉ và công cụ dòng lệnh

| Mã | HTTP | Thông điệp | Nơi dùng |
| --- | --- | --- | --- |
| `CERT_ERROR` | 503 | Chứng chỉ HTTPS của thiết bị không đọc được | `server/http` |
| `CERT_FILE_INVALID` | — | File chứng chỉ hoặc khóa nhập vào không hợp lệ | `server/cli` |
| `CERT_KEY_MISMATCH` | — | Chứng chỉ không khớp với khóa riêng | `server/cli` |
| `CERT_WRITE_FAILED` | — | Không ghi được chứng chỉ hoặc khóa lên thiết bị | `server/cli` |
| `CSR_WRITE_FAILED` | — | Không tạo hoặc ghi được yêu cầu cấp chứng chỉ (CSR) | `server/cli` |
| `HOST_CHECK_OFF` | — | Kiểm tra tên máy (Host) đang tắt: chỉ dùng để gỡ rối. | `server` |
| `HTTPS_DOWN` | 503 | HTTPS không chạy: trang mở qua HTTP không điều khiển được. | `server`, `server/http` |
| `INFO_UNAVAILABLE` | 503 | Thiết bị chưa trả được thông tin hệ thống | `server/http` |
| `LOGIC_RETAIN_LOST` | — | Trạng thái lưu của logic bị mất: bộ đếm và cộng dồn bắt đầu lại. | `server` |
| `LOGIC_THROTTLED` | — | Lệnh ghi của logic bị chặn do vượt giới hạn tần suất. | `server` |
| `LOGIC_WRITES_OFF` | — | Logic có lệnh ghi PLC nhưng ghi từ logic đang tắt. | `server` |
| `PULSE_STUCK` | — | Một lệnh xung chưa nhả được sau khi khởi động: kiểm tra PLC. | `core/tag-engine`, `server` |
| `SSH_ROOT_PASSWORD` | — | SSH cho phép root đăng nhập bằng mật khẩu: nên đổi sang khóa SSH. | `server` |
| `TIME_NOT_SYNCED` | — | Đồng hồ thiết bị chưa đồng bộ: lịch và thời gian có thể sai. | `core/logic`, `server` |
| `TLS_NO_IP_SAN` | — | Chứng chỉ không có địa chỉ IP của thiết bị. | `server`, `server/tls` |
| `TLS_SAN_MISMATCH` | — | Chứng chỉ không khớp địa chỉ hiện tại của thiết bị. | `server`, `server/tls` |
| `UPDATE_KEYS_MISSING` | — | Cập nhật qua mạng đang bật nhưng chưa có khóa tin cậy. | `core/update`, `server`, `server/updater` |
| `UPDATE_ROLLED_BACK` | — | Bản cập nhật vừa cài không chạy được: đã trở về bản trước. | `server` |
| `USERS_WRITE_FAILED` | — | Không ghi được file tài khoản | `server/cli` |
| `VIEWER_PUBLIC` | — | Trang vận hành mở cho mọi địa chỉ (viewerAccess = any). | `server`, `server/http` |

<a id="update"></a>

## Cập nhật runtime qua mạng (OTA) và chữ ký phát hành

| Mã | HTTP | Thông điệp | Nơi dùng |
| --- | --- | --- | --- |
| `ENVELOPE_EXTRA_MEMBER` | — | Phong bì có thêm thành viên hoặc dữ liệu sau phần kết thúc | `core/update` |
| `ENVELOPE_HEADER` | — | Tiêu đề tar của phong bì sai (tổng kiểm, magic, loại mở rộng) | `core/update` |
| `ENVELOPE_ORDER` | — | Thành viên của phong bì sai tên hoặc sai thứ tự | `core/update` |
| `ENVELOPE_SIZE` | — | Thành viên của phong bì vượt kích thước tối đa | `core/update` |
| `ENVELOPE_TRUNCATED` | — | Gói cập nhật bị cắt ngang | `core/update` |
| `FILE_DIGEST` | — | Băm hoặc kích thước của một tệp trong payload khác files[] | `core/update` |
| `FILE_EXTRA` | — | Payload có tệp không có trong files[] | `core/update` |
| `FILE_MISSING` | — | Thiếu một tệp có trong files[] (hoặc trong SHA256SUMS) | `core/update` |
| `FORMAT_UNSUPPORTED` | — | Định dạng gói cập nhật (format) không được runtime này hỗ trợ | `core/update` |
| `FROM_VERSION` | — | Bản đang chạy thấp hơn minFromVersion: cần qua bản trung gian | `core/update` |
| `INSUFFICIENT_SPACE` | 507 | Không đủ chỗ trống để nhận gói cập nhật (cần 3 lần kích thước gói) | `server` |
| `KEYSET_KEY` | — | Khóa của gói keyset không hợp lệ (không phải ECDSA P-256, quá 4 khóa) | `core/update` |
| `KEYSET_SELF_REVOKE` | — | Gói keyset gỡ chính khóa đã ký nó | `core/update` |
| `KEYSET_WRITE_FAILED` | — | mat-update-verify không ghi được khóa của gói keyset | `server/updater` |
| `LINK_FORBIDDEN` | — | Liên kết (tượng trưng hoặc cứng) trong payload | `core/update` |
| `MODE_FORBIDDEN` | — | Quyền tệp khác 0644 và 0755 (ví dụ setuid) | `core/update` |
| `PATH_ABSOLUTE` | — | Đường dẫn tuyệt đối trong gói cập nhật | `core/update` |
| `PATH_DUPLICATE` | — | Hai tệp trùng tên (không phân biệt hoa thường) trong gói cập nhật | `core/update` |
| `PATH_INVALID` | — | Đường dẫn trong gói cập nhật không hợp lệ hoặc ngoài tiền tố cho phép | `core/update` |
| `PATH_TRAVERSAL` | — | Đường dẫn trong gói cập nhật có đoạn . hoặc .. | `core/update` |
| `PAYLOAD_DIGEST` | — | Băm của payload.tar.gz không khớp payloadSha256 | `core/update` |
| `PAYLOAD_FORMAT` | — | payload.tar.gz không phải gzip hoặc tar hợp lệ | `core/update` |
| `RATIO_TOO_HIGH` | — | Tỉ lệ nén của payload lớn hơn 20 | `core/update` |
| `REAUTH_FAILED` | 403 | Mật khẩu xác nhận cập nhật không đúng hoặc thiếu | `server/http` |
| `SPECIAL_FORBIDDEN` | — | Tệp thiết bị hoặc FIFO trong payload | `core/update` |
| `SUMS_FORMAT` | — | Dòng của SHA256SUMS sai định dạng | `core/update` |
| `UNPACKED_TOO_LARGE` | — | Payload giải nén lớn hơn 128 MiB | `core/update` |
| `UPDATER_MANUAL_ONLY` | 422 | Gói cần mat-updater mới: chỉ cài thủ công bằng deploy.sh | `core/update`, `server` |
| `UPDATE_ARCH_MISMATCH` | 422 | Gói cập nhật dành cho kiến trúc khác | `core/update`, `server` |
| `UPDATE_DISABLED` | 404 | Cập nhật qua mạng đang tắt (update.enabled trong runtime.json) | `server`, `server/http` |
| `UPDATE_DOWNGRADE` | 409 | Gói cập nhật không mới hơn bản đang chạy (releaseSeq) | `core/update`, `server` |
| `UPDATE_KEY_UNKNOWN` | 403 | Gói cập nhật được ký bằng khóa thiết bị không tin cậy | `server` |
| `UPDATE_NOT_FOUND` | 404 | Không có gói đã kiểm với mã này (gói hết hạn sau 30 phút) | `server` |
| `UPDATE_NO_PREVIOUS` | 409 | Không có bản trước (/opt/mat-runtime.prev) để quay về | `server` |
| `UPDATE_PACKAGE_INVALID` | 400 | Gói cập nhật không hợp lệ (xem detail.code) | `core/update`, `server` |
| `UPDATE_PROJECT_INCOMPATIBLE` | 409 | Bản mới không chạy được định dạng của project đang chạy | `core/update`, `server` |
| `UPDATE_RECEIVE_ABORTED` | 408 | Nhận gói cập nhật bị dừng giữa chừng (chậm, đứt hoặc thiếu byte): gửi lại | `server` |
| `UPDATE_SIGNATURE_INVALID` | 403 | Chữ ký của gói cập nhật không đúng với khóa tin cậy nào của thiết bị | `core/update`, `server`, `server/updater` |
| `UPDATE_TOO_LARGE` | 413 | Gói cập nhật lớn hơn update.maxPackageMiB | `core/update`, `server` |
