# Contract — định dạng project v0 và bộ kiểm tra

Schema chuẩn: `schemas/project.schema.json`, `schemas/tag.schema.json`, `schemas/screen.schema.json`, `schemas/binding.schema.json` (JSON Schema draft-07, `$id` dạng `https://schemas.atpro.com.vn/mat/<name>/0.1.json`). Ý nghĩa từng trường: [data-model.md](../data-model.md).

## Chấp nhận phiên bản (ADR-004, chốt cho v0)

- Runtime 0.2.x hỗ trợ schema `0.1.x`. Với MAJOR = 0 thì so cả MINOR: `schemaVersion` phải khớp `^0\.1\.\d+$`, ngược lại `E_SCHEMA_VERSION`. Hậu tố pre-release (`0.1.0-dev`) không được nhận ở cả hai bản (vector `invalid-schema-version-prerelease`).
- `minRuntimeVersion` > phiên bản runtime → `E_RUNTIME_TOO_OLD`.
- Mọi file trong project phải cùng `schemaVersion` MAJOR.MINOR (`E_SCHEMA_VERSION`).

## Kết quả kiểm tra

```json
{ "valid": false, "errors": [ { "code": "E_REF_TAG", "file": "screens/tank-motor.bindings.json", "path": "/elements/0/bindings/1/source/tagId", "message": "Tag 'TANK01.LEVL' không tồn tại" } ], "warnings": [] }
```

`path` là JSON Pointer. `message` bằng tiếng Việt và **không** thuộc contract (hai bản TS và C++ có thể khác câu chữ). Contract là **tập `code`**.

## Kiểm tra trước schema (giống nhau ở hai bản)

Thứ tự cho mỗi file JSON:

1. Không đọc được file → `E_FILE_MISSING`: không có, không phải file thường, tên khác chữ hoa/thường, đường dẫn ra ngoài thư mục project (kể cả qua symlink).
2. Lớn hơn 1 MB (tính cả BOM) → `E_JSON`.
3. Độ sâu lồng `[`/`{` (đếm trên văn bản, bỏ qua ký tự trong chuỗi) > 64 → `E_JSON`.
4. JSON không parse được → `E_JSON`. Gồm cả: byte không phải UTF-8 hợp lệ (ví dụ chữ Việt lưu bằng Windows-1258), escape surrogate UTF-16 đứng lẻ (`"\ud800"`), số vượt phạm vi double (`1e400`). **Một** BOM UTF-8 ở đầu file được bỏ qua; hai BOM là lỗi.
5. Có khóa hoặc giá trị chuỗi dài hơn 1024 byte UTF-8 → `E_SCHEMA` (trỏ tới chuỗi đó).
6. JSON Schema → `E_SCHEMA`. `integer` theo nghĩa JSON Schema là số không có phần lẻ: `10`, `10.0`, `1e1` như nhau (bản C++ đổi số thực có giá trị nguyên sang số nguyên trước valijson). `10.5` → `E_SCHEMA`.

Bước 3 và 5 ngăn parser đệ quy và `std::regex` của bản C++ tràn stack (security review Sprint 1, M1/M3). Độ dài đường dẫn (`E_PATH`) tính theo **byte UTF-8** ở cả TS, C++ và Rust (Studio).

**Tên file đúng chữ hoa/thường** như ext4 trên thiết bị, ở cả ba bản (TS, C++, Rust của Studio): từng đoạn của đường dẫn phải là mục có đúng tên đó trong thư mục cha, nên trên Windows/NTFS `screens/Main.svg` không mở được `main.svg` (vector `invalid-file-missing-case`).

**File SVG** chỉ được kiểm là có tồn tại (bước 1); bản C++ không đọc nội dung SVG (Constitution II). Vì vậy SVG lớn tới đâu hay không phải UTF-8 cũng không phải lỗi của bộ kiểm tra. Studio và CLI đọc SVG tới **5 MB** (ADR-003) để xem trước và kiểm `data-mat-uid`; SVG lớn hơn thì bỏ qua bước kiểm `data-mat-uid` của màn hình đó, không báo lỗi.

Nguồn đọc của bản TS (`ProjectSource.read`) trả nội dung hoặc lý do lỗi đã phân loại (`missing`, `bad-path`, `too-large`, `bad-utf8`), cùng cách phân loại với lệnh Rust `project_read` của Studio. Bộ kiểm tra đổi sang mã lỗi như trên: `missing`, `bad-path` → `E_FILE_MISSING`; `too-large`, `bad-utf8` → `E_JSON` với file JSON, không phải lỗi với SVG.

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
| `E_SCREEN_TAGS` | bindings của một màn hình dùng hơn **1000** Tag khác nhau: trang runtime đăng ký mọi Tag của màn hình trong một `subscribe`, và máy chủ nhận tối đa 1000 Tag ([live-ws.md](live-ws.md)) |

Cảnh báo (không chặn runtime, chỉ ở bản TS): `W_UID_NOT_IN_SVG` (`elementUid` không có `data-mat-uid` trong SVG). Studio coi đây là lỗi chặn lưu. Schema chỉ kiểm `maxClients` là số nguyên; khoảng 1–10 do luật `E_MAX_CLIENTS` kiểm. Không thêm `minimum`/`maximum` vào schema: khi đó file bị dừng ở bước schema và chỉ còn báo `E_SCHEMA`.

## Test vector dùng chung

`tests/project-vectors/<case>/` là một project (có thể thiếu file có chủ đích) kèm `expected.json`:

```json
{ "valid": false, "errors": ["E_REF_TAG"] }
```

So sánh: tập `code` của lỗi (bỏ trùng) **bằng** `errors`. Bản TS (Vitest, `@mat/project-schema`) và bản C++ (GoogleTest, `core/project-manager`) chạy toàn bộ thư mục. Mỗi mã lỗi ở bảng trên có ít nhất 1 case, và có ít nhất 3 case hợp lệ (gồm project mẫu).

## CLI

`node tools/project-validator/validate.mjs <thư mục project>` in kết quả JSON. Mã thoát: 0 hợp lệ, 1 không hợp lệ, 2 lỗi dùng sai.
