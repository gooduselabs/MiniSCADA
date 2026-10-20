# Vector project của feature 013 (vai trò tối thiểu: `security.view`, `security.operate`)

Sinh bởi `tests/project-vectors/generate.mjs` (mã ca ở `v11.mjs`, hàm `securityCases`); tên `v11-security-*`, cùng cấu trúc và bộ chạy với `v11-*` ([README-012.md](README-012.md)): `packages/project-schema/src/vectors-11.test.ts` (TS), `core/project-manager/tests/vectors_11_test.cpp` (C++). Hợp đồng: [spec 013](../../specs/013-access-control/spec.md) FR-050, [access-model.md](../../specs/013-access-control/contracts/access-model.md) §2, §3.

## Schema (dòng 1.x, `schemas/screen.schema.json` ở thư mục gốc)

- Item widget: `security` có `minRole` (chuỗi, như 0.3), `view`, `operate` (`viewer`, `operator`, `engineer`, `administrator`).
- Item svg: `security` có `view`, `operate` (không có `minRole`; sự kiện của phần tử có `minRole` riêng).
- Màn hình và popup: `security` chỉ có `view`.
- Vai trò lạ, khóa lạ: `E_SCHEMA`.

## Luật bộ C++ phải cài giống hệt (rules-11.ts, sau mọi luật bố cục)

Mỗi màn hình theo thứ tự, rồi mỗi item `i` có `security` là đối tượng:

1. Project **1.0**: màn hình có `security`: `E_SECURITY_LEVEL` `/security`. Item có `security.view`: `E_SECURITY_LEVEL` `/items/<i>/security/view`; không có `view` mà có `operate`: `.../security/operate` (một lỗi mỗi item). `minRole` một mình giữ hành vi cũ (không lỗi mới).
2. Project **1.1**, item có `operate` (chuỗi); widget không có trong danh mục thì bỏ qua (`E_WIDGET_UNKNOWN` đã báo). Theo thứ tự, báo lỗi đầu tiên khớp:
   1. item không thao tác được: `E_SECURITY_ITEM` `/items/<i>/security/operate`. Thao tác được = widget thuộc nhóm `control` của danh mục widget, hoặc item svg có một phần tử trong tệp binding của nó với `events.click.action` là `write`, `toggle` hoặc `pulse` (`isOperableItem`);
   2. `operate` là `viewer`: `E_SECURITY_LEVEL` `.../security/operate` (viewer không bao giờ thao tác);
   3. `operate` thấp hơn `view` (thiếu `view` = `viewer`): `E_SECURITY_LEVEL` `.../security/operate`;
   4. có `minRole` khác `operate` (`minRole` là bí danh cũ của `operate`): `E_SECURITY_LEVEL` `.../security/minRole`.

`view` cao hơn mức thao tác mặc định khi không khai `operate` (ví dụ `{ "view": "administrator" }` ở nút) là hợp lệ: không xem được thì không thao tác được.

Luật cũ (`rules-03`): `security` rỗng hoặc có `minRole` ở widget không có thuộc tính bảo mật vẫn là `E_WIDGET_PROP` `/items/<i>/security`; `security` chỉ gồm `view`/`operate` thì không.
