# Vector project của feature 011 (định dạng 1.0.0: template, faceplate, logic.json)

Sinh bởi `tests/project-vectors/generate.mjs` (mã ca ở `v10.mjs`). Cấu trúc thư mục và `expected.json` như mọi vector khác (`valid`, `errors`, `warnings`, `issues`, với ca hợp lệ `files`, `digest`) cộng **`runtimeVersion: "1.0.0"`**: bộ chạy truyền giá trị này cho validator (như `v05-*`), vì `RUNTIME_VERSION`/`kRuntimeVersion` của bản dựng còn 0.9.0. Hợp đồng: [contracts/project-format-1.0.md](../../specs/011-pilot-hardening/contracts/project-format-1.0.md) §2-§5, §7. Chạy: `packages/project-schema/src/vectors-10.test.ts` (TS), `core/project-manager/tests/vectors_10_test.cpp` (C++, T020).

## Project nền `base10()`

`base06()` với mọi `schemaVersion` 1.0.0, `minRuntimeVersion` 1.0.0, cộng:

- `logic.json` tối thiểu (`{"schemaVersion": "1.0.0"}`), khai ở `project.json` `logic`;
- template `templates/bom.template.json` (`prefix` tagPrefix default `PUMP01`, `title` string default `Bơm`): đèn `lamp` (`{prefix}.RUN`), thẻ `flow` (`{prefix}.FLOW`, nhãn `{title} (lưu lượng)`), nút `detail` mở faceplate với `args: {prefix: "{prefix}", title: "{title}"}` (`{param}` trong `args` chỉ được ở template);
- hai bản sao trên `main`: `pump7` (PUMP07) và `pump8` (PUMP08), item `<inst>.<rid>` đã thay, `tpl` trên mọi item, `params` ở item đầu;
- faceplate `screens/bom-chi-tiet.screen.json` (popup, `params` `prefix` bắt buộc, `title` default) với `{prefix}.FLOW` (card), `{prefix}.RUN_CMD` (switch, khe ghi), nhãn `{title}`;
- phần tử SVG `el_ccc` của `main.bindings.json` có sự kiện click mở faceplate với `args: {prefix: "PUMP01"}`;
- Tag nội bộ `PUMP07.*`, `PUMP08.*` (`RUN` BOOL, `FLOW` FLOAT32, `RUN_CMD` BOOL RW), `PUMP01.RUN`, `PUMP01.FLOW`.

Base hợp lệ và không cảnh báo: ba bộ `args` của faceplate (PUMP07, PUMP08, PUMP01) đều được bung và kiểm.

## Luật bộ C++ phải cài giống hệt (rules-10.ts)

1. Template (theo tên tệp `templates/<id>.template.json`): `schemaVersion` khớp project (`E_SCHEMA_VERSION` `/schemaVersion`); `id` bằng tên tệp (`E_TEMPLATE_ID` `/id`); id item `^[a-z][a-z0-9_]{1,31}$`, không trùng (`E_TEMPLATE_ID` `/items/<i>/id`); tham số trùng tên, `default` sai `kind` (`E_TEMPLATE_PARAM` `/params/<i>/name|default`); chỗ đặt `{name}` (`E_TEMPLATE_PARAM` `/items/<i><đường dẫn trong item>`, `args` cho phép).
2. `params` ở màn hình không phải popup: `E_TEMPLATE_PARAM` `/params`. Popup có `params`: khai báo và chỗ đặt như 1 (không cho `args`).
3. Chỗ gọi popup (widget `events.click`, và phần tử SVG `events.click` trong tệp binding; theo thứ tự màn hình của `project.json`, item, phần tử): đích là popup, `args` khớp `params` (thiếu tham số không default, khóa thừa, giá trị sai `kind`): `E_POPUP_ARGS` tại `…/events/click/args/<tên>`; popup không có `params` nhận `args` rỗng. Bỏ qua chỗ gọi trong popup có tham số mà `args` có `{`/`}`.
4. Bộ `args` khác nhau (sau default) mỗi popup > 1.000: `E_POPUP_ARGS` `/params` của popup, chỉ bung 1.000 bộ đầu. Không ai gọi: bung một bộ default nếu mọi tham số có default.
5. Bung tĩnh: item widget có `{`/`}` (không lỗi chỗ đặt) được thay và kiểm như item thường; `E_REF_TAG`, `E_WIDGET_TAG_TYPE` của bản thay đổi thành `E_TEMPLATE_TAG_REF`; mã khác giữ (`E_TAG_ACCESS`, `E_WIDGET_PROP`…); bỏ trùng theo (mã, tệp, đường dẫn). Ở bản gốc, chuỗi có `{`/`}` của popup có tham số không kiểm như Tag hay giá trị thuộc tính.
6. Bản sao (`tpl`, nhóm theo `inst` trong một màn hình; `tid` của item đầu): item khác `tid` → `E_TEMPLATE_REF` `/items/<i>/tpl/tid`; `tid` không khai → `E_TEMPLATE_REF` `/tpl/tid` mỗi item (template khai mà không nạp được: bỏ qua); `rid` không có → `/tpl/rid`; id khác `<inst>.<rid>` → `/id`; `params` khác nhau giữa các item → `E_TEMPLATE_PARAM` `/tpl/params`; `params` sai so với template → `E_TEMPLATE_PARAM` `/items/<i>/tpl/params/<tên>`; Tag sai của item có `tpl`: `E_REF_TAG`, `E_WIDGET_TAG_TYPE` → `E_TEMPLATE_TAG_REF`; item khác bản bung (bỏ qua `id`, `x`, `y`, `width`, `height`, `tpl`, `locked`, `hidden`) hoặc thiếu item của template → `W_TEMPLATE_DRIFT` `/items/<i>`.
7. Định dạng 1.0: id item được thêm dạng `^[a-z][a-z0-9-]{0,31}\.[a-z][a-z0-9_]{1,31}$` (có hay không `tpl`); hành động popup (widget và sự kiện SVG) có thêm khóa `args`; `logic.json` qua schema và cùng phiên bản (`E_SCHEMA_VERSION`); luật `E_LOGIC_*` thuộc T135.

## Tên ca

| Tiền tố                                                                            | Nội dung                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `v10-valid-*`, `v10-*-valid`                                                       | hợp lệ (base, không logic, mặc định, mọi item mang params, dịch/cỡ riêng, bung thành item thường, faceplate số/màu, khe nhiều Tag, 20 chỗ gọi, 1.000 tổ hợp) |
| `v10-template-*`                                                                   | tệp template: tham số, chỗ đặt, id, tệp thiếu, phiên bản                                                                                                     |
| `v10-tpl-*`                                                                        | bản sao: tid, rid, id, params, Tag sau khi thay, lệch (W_TEMPLATE_DRIFT), `tpl` trong 0.6                                                                    |
| `v10-popup-args-*`                                                                 | `args` của chỗ gọi (widget, SVG, 1.001 tổ hợp, `args` trong 0.6)                                                                                             |
| `v10-popup-expanded-*`, `v10-popup-*-caller*`                                      | bung tĩnh: Tag không có, sai kiểu, không ghi được, thuộc tính ngoài khoảng                                                                                   |
| `v10-popup-param*`                                                                 | khai báo và chỗ đặt trong faceplate                                                                                                                          |
| `v10-logic-*`, `v10-version-*`, `v10-min-runtime-*`, `v10-runtime-*`, `v10-item-*` | khung 1.0                                                                                                                                                    |

`v02-invalid-schema-version-1.1` (đổi tên từ `…-1.0`, cùng kết luận `E_SCHEMA_VERSION`): 1.0 nay được hỗ trợ.
