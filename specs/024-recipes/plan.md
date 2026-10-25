# Implementation Plan: Recipe và logo báo cáo (024)

**Branch**: `024-recipes` | **Spec**: [spec.md](spec.md) | **ADR**: [052](../../docs/adr/052-recipes.md)

## Technical Context

TypeScript + Lit 3 (runtime-web, Studio, `packages/project-schema`, `packages/report-export`), C++17 (`core/project-manager`, `core/recipe`, `server/http`), JSON Schema draft-07. Không thêm thư viện. Test: Vitest, gtest, vector chung `tests/project-vectors/v11-recipe-*`, e2e Chrome + axe, tích hợp với giả lập Modbus (`tests/web-it`).

## Constitution Check

| Nguyên tắc | Đánh giá |
|---|---|
| II Ranh giới | Luật recipe hai bản cùng vector; logic tải xuống thuần trong `core/recipe` (giao diện ghi trừu tượng), HTTP chỉ đọc/ghi JSON |
| III Ngân sách | Ghi tuần tự, một lượt một lúc trên thiết bị; trang chỉ hỏi giá trị hiện tại 2 s/lần khi đang mở; tệp thiết bị ≤ 1 MiB |
| V An toàn | Mọi ghi qua write coordinator (audit trước khi gửi, `writeMinRole`, giới hạn Tag); máy chủ kiểm giới hạn recipe; CSRF, vai trò; audit trước thay đổi tệp; logo SVG qua allowlist 008/014 |
| VI Test trước | Test viết trước mỗi phần |
| VII Tương thích | Khóa mới tùy chọn, chỉ ở dòng 1.1; project cũ không đổi |

## Quyết định (tự chốt)

1. **Tệp riêng** `recipes.json` khai bởi `recipesFile` (như `reportsFile`), chỉ ở định dạng 1.1.
2. **Bản project chỉ đọc trên thiết bị**; bản do người vận hành tạo ở `<dataDir>/recipes/<projectId>.json` (`rev` cả tệp, ghi nguyên tử tmp + fsync + rename). Id bản thiết bị `d-<8 hex>`. Sửa bản project = Sao chép thành bản thiết bị.
3. **Quyền theo vai trò** (`security.view/operate/edit` của loại, như `security` item của 013); quy tắc tài nguyên `recipe:<id>` của `access.json` hoãn.
4. **Tải xuống là job nền**: `RecipeService` có một luồng; POST trả 202 `{jobId}`, trang hỏi `GET jobs/{id}` 300 ms/lần. Mỗi ghi: `submit` rồi hỏi `status` tới khi kết thúc (tối đa 15 s); trạng thái khác `CONFIRMED` dừng cả lượt.
5. **Audit**: `recipe.download` `started` (trước ghi đầu tiên; không ghi được → 503, không ghi Tag nào) rồi `ok`/`failed` (tóm tắt: số đã ghi, tham số lỗi, mã); `tag.write` từng ghi do coordinator (`context.screen` = `recipe-<type>`, `context.widget` = id bản); `recipe.save`, `recipe.delete`, `recipe.capture` trước khi ghi tệp.
6. **So sánh** dùng `GET /recipes/current` (đọc TagStore) thay vì kênh live (tập Tag live của 013 có thể không gồm Tag recipe).
7. **Logo** ở `reports.json` `logo` (không đổi kiểu `org`); SVG/PNG ≤ 256 KiB; PDF nhúng SVG hoặc PNG; XLSX nhúng PNG (SVG được trình duyệt chuyển sang PNG bằng canvas).
8. **Mục menu** `Recipe` tự có khi project có `recipesFile` (như mục Alarm), không đổi `navigation`.

## Hợp đồng

### `recipes.json` (schema `schemas/recipes.schema.json`)

```json
{
  "schemaVersion": "1.1.0",
  "types": [
    {
      "id": "banh-mi",
      "name": "Bánh mì",
      "description": "Thông số lò",
      "security": { "view": "viewer", "operate": "operator", "edit": "operator" },
      "params": [
        { "tagId": "OVEN.TEMP_SP", "label": "Nhiệt độ", "unit": "°C", "min": 150, "max": 250, "decimals": 0 }
      ],
      "recipes": [{ "id": "bo", "name": "Bơ", "values": { "OVEN.TEMP_SP": 180 } }]
    }
  ]
}
```

Giới hạn schema: 32 loại, 1–64 tham số, 200 bản mỗi loại; id `^[a-z0-9][a-z0-9-]{0,47}$`; `security.*` thuộc bốn vai trò (`operate`, `edit` không là `viewer`).

Thứ tự luật (TS = C++, vị trí trong `recipes.json` trừ dòng đầu):

1. `E_RECIPE_VERSION` ở `project.json` `/recipesFile` khi project không phải 1.1 (không chạy luật dưới).
2. Mỗi loại `/types/i`: id trùng `E_RECIPE_DUP_ID` (`/types/i/id`).
3. Mỗi tham số `/types/i/params/j`: Tag trùng `E_RECIPE_DUP_ID` (`…/tagId`); Tag không có `E_RECIPE_TAG` (`…/tagId`); Tag không ghi được (không `RW`, Tag tính toán, mô phỏng không `manual`) `E_RECIPE_TAG_RW` (`…/tagId`); `min`/`max` trên Tag BOOL/STRING hoặc `min > max` `E_RECIPE_LIMIT` (`…/min` hoặc `…/max`).
4. Mỗi bản `/types/i/recipes/k`: id trùng `E_RECIPE_DUP_ID` (`…/id`); khóa của `values` không là tham số `E_RECIPE_VALUE` (`…/values/<tag>`); mỗi tham số theo thứ tự: thiếu `E_RECIPE_VALUE` (`…/values`), sai kiểu JSON với kiểu Tag (BOOL: boolean; số nguyên: số nguyên trong miền kiểu; FLOAT: số; STRING: chuỗi) `E_RECIPE_VALUE` (`…/values/<tag>`), ngoài `[min, max]` của tham số hoặc `limits` của Tag `E_RECIPE_LIMIT` (`…/values/<tag>`). Tham số có Tag lỗi (bước 3: không có) bỏ qua bước này.

Trong đường dẫn, `<tag>` theo JSON Pointer (`~` → `~0`, `/` → `~1`; id Tag không có hai ký tự này).

### API (device-api, `features` thêm `recipes`)

| Phương thức | Đường dẫn | Cổng (roles.cpp) | Ghi chú |
|---|---|---|---|
| GET | `/api/v1/recipes` | viewer, cookie | `{rev, types:[{id,name,description,params,can:{operate,edit},recipes:[{id,name,values,origin:"project"\|"device",updatedAt?,updatedBy?}]}]}` chỉ loại xem được |
| GET | `/api/v1/recipes/current?type=` | viewer, cookie | `{values:{<tag>:{value,quality}}}` |
| POST | `/api/v1/recipes/save` | operator, cookie, CSRF, đổi thiết bị | `{type, id?, name, values, rev}` → `{rev, recipe}` |
| POST | `/api/v1/recipes/delete` | operator, như trên | `{type, id, rev}` → `{rev}` |
| POST | `/api/v1/recipes/capture` | operator, như trên | `{type, name, rev}` → `{rev, recipe}` |
| POST | `/api/v1/recipes/download` | operator, như trên | `{type, recipe}` → 202 `{jobId}` |
| GET | `/api/v1/recipes/jobs/{id}` | viewer, cookie | `{jobId,type,recipe,state:"running"\|"done"\|"failed",results:[{tag,value,status:"pending"\|"ok"\|"failed"\|"skipped",code?,message?}]}` |

Mã lỗi: `RECIPE_NOT_FOUND` 404, `RECIPE_INVALID` 400 (`issues:[{tag,code}]`, code `E_RECIPE_LIMIT`/`E_RECIPE_VALUE`), `CONFLICT` 409 (`rev`), `RECIPE_BUSY` 409, `RECIPE_BAD_QUALITY` 409 (`tags`), `RECIPE_READONLY` 409 (bản project), `RECIPE_FULL` 409 (200 bản/loại), `FORBIDDEN` 403, `AUDIT_UNAVAILABLE` 503, `NO_PROJECT` 404 (không có recipe).

### `reports.json` 1.1: `logo`

Chuỗi `^graphics/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(svg|png)$`. `E_RPT_LOGO` ở `/logo`: project không phải 1.1; tệp không có; tệp > 262.144 byte. SVG thêm `svgContentRules` (chỉ TS, như widget `image`). Tệp logo vào danh sách tệp của project (gói, allowlist của runtime).

## Cấu trúc

```text
schemas/recipes.schema.json; project.schema.json (+recipesFile); reports.schema.json (+logo)
packages/project-schema/src/{recipes,rules-recipes}.ts (+validate, project-files, rules-02 phiên bản)
core/project-manager/rules_recipes.{hpp,cpp} (+project_validator)
core/recipe/{recipe_model,recipe_store,recipe_runner}.{hpp,cpp}, core/recipe/tests/
server/http/recipes_api.cpp, server/recipe_service.{hpp,cpp}, core/auth/roles.cpp, core/audit/audit_actions.hpp
apps/runtime-web/src/recipe/ (trang #/recipes)
apps/studio/src/model/recipes-doc.ts, apps/studio/src/ui/editors/recipes-editor.ts
packages/report-export (logo), apps/runtime-web/src/report-page.ts
```
