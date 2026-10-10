# Contract — định dạng project v0 và bộ kiểm tra

Schema chuẩn: `schemas/project.schema.json`, `schemas/tag.schema.json`, `schemas/screen.schema.json`, `schemas/binding.schema.json` (JSON Schema draft-07, `$id` dạng `https://schemas.atpro.com.vn/mat/<name>/0.1.json`). Ý nghĩa từng trường: [data-model.md](../data-model.md).

## Chấp nhận phiên bản (ADR-004, chốt cho v0)

- Runtime 0.2.x hỗ trợ schema `0.1.x`. Với MAJOR = 0 thì so cả MINOR: `schemaVersion` phải khớp `^0\.1\.\d+$`, ngược lại `E_SCHEMA_VERSION`.
- `minRuntimeVersion` > phiên bản runtime → `E_RUNTIME_TOO_OLD`.
- Mọi file trong project phải cùng `schemaVersion` MAJOR.MINOR (`E_SCHEMA_VERSION`).

## Kết quả kiểm tra

```json
{ "valid": false, "errors": [ { "code": "E_REF_TAG", "file": "screens/tank-motor.bindings.json", "path": "/elements/0/bindings/1/source/tagId", "message": "Tag 'TANK01.LEVL' không tồn tại" } ], "warnings": [] }
```

`path` là JSON Pointer. `message` bằng tiếng Việt và **không** thuộc contract (hai bản TS và C++ có thể khác câu chữ). Contract là **tập `code`**.

## Kiểm tra trước schema (giống nhau ở hai bản)

Thứ tự cho mỗi file JSON:

1. Lớn hơn 1 MB → `E_JSON`.
2. Độ sâu lồng `[`/`{` (đếm trên văn bản, bỏ qua ký tự trong chuỗi) > 64 → `E_JSON`.
3. JSON không parse được → `E_JSON`.
4. Có khóa hoặc giá trị chuỗi dài hơn 1024 byte UTF-8 → `E_SCHEMA` (trỏ tới chuỗi đó).
5. JSON Schema → `E_SCHEMA`.

Bước 2 và 4 ngăn parser đệ quy và `std::regex` của bản C++ tràn stack (security review Sprint 1, M1/M3). Độ dài đường dẫn (`E_PATH`) tính theo **byte UTF-8** ở cả TS, C++ và Rust (Studio).

## Mã lỗi (dùng chung TS ↔ C++)

| Mã | Khi nào |
|---|---|
| `E_JSON` | file không phải JSON hợp lệ, hoặc lớn hơn 1 MB |
| `E_SCHEMA` | vi phạm JSON Schema (kiểu, trường thiếu/thừa, pattern, enum, giới hạn) |
| `E_SCHEMA_VERSION` | phiên bản schema không hỗ trợ hoặc lệch giữa các file |
| `E_RUNTIME_TOO_OLD` | `minRuntimeVersion` > runtime |
| `E_FILE_MISSING` | file được tham chiếu không tồn tại |
| `E_PATH` | đường dẫn không an toàn |
| `E_SCREEN_ID` | id screen không khớp tên file / `project.screens` / `bindings.screenId`; `entryScreen` không có trong `screens` |
| `E_DUP_TAG` | Tag trùng id |
| `E_TAG_RANGE` | `min ≥ max` hoặc `min/max` cho Tag không phải số |
| `E_DUP_UID` | `elementUid` trùng trong screen hoặc trong bindings |
| `E_DUP_BINDING` | `binding.id` trùng trong screen |
| `E_REF_UID` | binding trỏ `elementUid` không có trong `screen.elements` |
| `E_REF_TAG` | binding trỏ Tag không tồn tại |
| `E_TARGET_UNSUPPORTED` | đích thuộc allowlist §8.2 nhưng v0 chưa hỗ trợ |
| `E_TRANSFORM_UNSUPPORTED` | `rangeMap`, `format`, `expression` |
| `E_TYPE_MISMATCH` | kiểu Tag không hợp với transform/đích, hoặc `equals` sai kiểu |
| `E_SCALE_RANGE` | `inMin == inMax` |
| `E_MAX_CLIENTS` | `maxClients` ngoài 1–10 (bắt riêng ngoài schema để thông báo rõ) |

Cảnh báo (không chặn runtime, chỉ ở bản TS): `W_UID_NOT_IN_SVG` (`elementUid` không có `data-mat-uid` trong SVG). Studio coi đây là lỗi chặn lưu. Riêng `E_MAX_CLIENTS` trùng với ràng buộc schema: khi cả hai cùng bắt, chỉ báo `E_MAX_CLIENTS`.

## Test vector dùng chung

`tests/project-vectors/<case>/` là một project (có thể thiếu file có chủ đích) kèm `expected.json`:

```json
{ "valid": false, "errors": ["E_REF_TAG"] }
```

So sánh: tập `code` của lỗi (bỏ trùng) **bằng** `errors`. Bản TS (Vitest, `@mat/project-schema`) và bản C++ (GoogleTest, `core/project-manager`) chạy toàn bộ thư mục. Mỗi mã lỗi ở bảng trên có ít nhất 1 case, và có ít nhất 3 case hợp lệ (gồm project mẫu).

## CLI

`node tools/project-validator/validate.mjs <thư mục project>` in kết quả JSON. Mã thoát: 0 hợp lệ, 1 không hợp lệ, 2 lỗi dùng sai.
