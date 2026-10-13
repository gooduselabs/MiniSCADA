# Fixture nghiệm thu của SVG importer (feature 008)

Dữ liệu cho T033–T036; đặc tả ở `specs/008-svg-import-binding/contracts/svg-import.md` §8–§10 và `research.md` R18, R19. Mọi file do dự án tạo, giấy phép **CC0**; không có logo, ký hiệu hay font có bản quyền (chữ dùng họ font chung).

## 1. Bốn file Inkscape: THẬT

| File | Cách tạo |
|---|---|
| `inkscape-01-tank-process.svg` | `tools/svg-fixtures/make-inkscape.ps1` chạy **Inkscape 1.4.3 (0d15f75, 2025-12-25)** CLI trên bản vẽ nguồn `tools/svg-fixtures/src/inkscape-01-tank-process.src.svg` |
| `inkscape-02-motor-pump.svg` | như trên, nguồn `…-02-motor-pump.src.svg` |
| `inkscape-03-panel-text.svg` | như trên, nguồn `…-03-panel-text.src.svg` |
| `inkscape-04-pipes-flow.svg` | như trên, nguồn `…-04-pipes-flow.src.svg` |
| `inkscape-NN-*.ref.png` | PNG tham chiếu 1200 × 800, nền trắng, do chính Inkscape xuất từ cùng nguồn (`--export-type=png -w 1200 -h 800`) |
| `inkscape-version.txt` | chuỗi phiên bản thật của lần chạy |

Bản vẽ nguồn do dự án viết tay (SVG tối giản); Inkscape đọc rồi ghi lại thành "Inkscape SVG" nên các file này mang đúng cách ghi của Inkscape (namespace, `sodipodi:namedview`, id tự thêm, chữ nhiều dòng viết lại, `flowRoot` giữ nguyên). Chạy lại script cho ra đúng byte (đã kiểm). Quan sát thực tế (đầy đủ trong `manifest.json`, mục `inkscape.observed`):

- namespace sinh ra: `inkscape`, `sodipodi`, `svg`; có `sodipodi:namedview` (kèm `inkscape:document-units`);
- **không có** thuộc tính `inkscape:version` và không có metadata RDF khi xuất lại bằng CLI: `svg-inspect` chỉ nhận "Inkscape (có dấu hiệu)", không "chắc chắn";
- `flowRoot` được giữ; `sodipodi:docname` ghi tên tệp nguồn (`…src.svg`).

Chạy lại: `powershell -File tools/svg-fixtures/make-inkscape.ps1` (dùng `inkscape.com`; `inkscape.exe` là bản GUI, trả về trước khi ghi xong file).

## 2. Sáu file Illustrator và CorelDRAW: MÔ PHỎNG

`illustrator-01-saveas-legacy.svg`, `illustrator-02-export-cls.svg`, `illustrator-03-export-screens.svg`, `corel-01-mm-css.svg`, `corel-02-curves-clip.svg`, `corel-03-blend-pattern.svg`.

**Giới hạn của mô phỏng (đọc kỹ):**

- Đây là SVG **viết tay** theo *đặc trưng cấu trúc* đã biết của hai phần mềm (ghi trong `docs/architecture/svg-dialects.md` và bảng contract §9). **Không phải file do Adobe Illustrator hay CorelDRAW sinh ra**; mỗi file mang chú thích `MÔ PHỎNG` ở dòng đầu.
- Không chứng minh cách phần mềm thật sinh `id`, làm tròn số, thứ tự thuộc tính, phiên bản mới, hay các kiểu xuất khác (ví dụ chữ chuyển đường cong thật, ICC, `enable-background`…).
- Kết quả SC-001 cho Illustrator và CorelDRAW vì thế chỉ là **"đạt trên mô phỏng"** cho đến khi có file thật (task T120 chờ người dùng). Khi có, đặt vào `real/`, đổi `real` trong `manifest.json` và cập nhật README này.
- Sinh tất định (diff được) bằng `node tools/svg-fixtures/make-simulated.mjs` từ khuôn `tools/svg-fixtures/src/*.tmpl.svg`; `--check` so với file đã commit.

## 3. `manifest.json`

Mỗi mục trong `fixtures`: `file`, `generator`, `real` (true: do phần mềm thật xuất), `source`, `license`, `features`, `expectCodes` (mã báo cáo mong đợi theo contract §6: `R_*`, `C_*`, `W_IMPORT_*`; **dự kiến**, harness hiệu chỉnh khi importer chạy), `allowedDiff` (mảng `{note, rect}`; `rect = [x, y, rộng, cao]` trong khung 1200 × 800, vùng không tính vào ngưỡng so ảnh), `refPng` (chỉ file thật), `simulationLimit` (chỉ file mô phỏng). Đầu file có phiên bản Inkscape và quan sát thực tế.

## 4. Bộ độc hại `malicious/` (T035)

39 ca (36 có tệp `.svg`, 3 sinh lúc chạy) theo bảng contract §8, mỗi ca có `<id>.svg` và `<id>.expect.json`; sinh tất định bằng `node tools/svg-fixtures/make-malicious.mjs` (`--check` để kiểm). Lược đồ `expect.json` (harness `tools/svg-import/malicious-harness.mjs`, T051, đọc):

```json
{
  "id": "m01-script",
  "title": "mô tả",
  "outcome": "sanitized",
  "codes": ["R_SCRIPT"],
  "forbid": ["<script", "__pwned"],
  "keep": ["<rect"],
  "rawCanary": true,
  "generated": { "module": "../limits.mjs", "case": "bytes-6mib" }
}
```

| Trường | Ý nghĩa |
|---|---|
| `outcome` | `sanitized`: `importSvg` trả `ok: true`, đầu ra đã làm sạch. `rejected`: `ok: false` |
| `codes` | mọi mã phải **có mặt**: với `sanitized` trong `removed[].code`, `converted[].code` hoặc `warnings[].code`; với `rejected` trong `errors[].code` (`E_IMPORT_*`). Mảng rỗng: không đòi mã nào |
| `forbid` | chuỗi con, **không phân biệt hoa thường**, KHÔNG được có trong `result.svg` (chỉ với `sanitized`) |
| `keep` | (tùy chọn) chuỗi con phải còn trong `result.svg` |
| `rawCanary` | (tùy chọn) bản gốc dựng không lọc được kỳ vọng làm `window.__pwned` khác `null`; harness cần ≥ 1 ca thật sự kích hoạt (canary, R19). Kỳ vọng này chưa kiểm trên Chrome: harness quyết định ca nào hiệu lực |
| `generated` | (tùy chọn) ca quá lớn nên **không có `.svg`**; nội dung lấy từ `buildLimitCase(case)` của module nêu ở đây |

`m31` (UTF-16 LE có BOM) và `m32` (UTF-8 hỏng) là tệp nhị phân; đọc bằng `Buffer`, không đọc bằng chuỗi.

## 5. Ca giới hạn `limits.mjs` (T036)

Không commit file sinh ra. `node tests/fixtures/svg-import/limits.mjs` ghi 25 ca vào `out/` (đã ignore) cùng `out/limits-index.json`; mã gọi trực tiếp `buildLimitCase(name)` / `LIMIT_CASE_NAMES`. Mỗi ca có `expect: { outcome: "ok" | "sanitized" | "rejected", codes }` và `limit` (giới hạn đang thử). Cặp biên: 5 MiB và +1; 20.000 và 20.001 phần tử sau chuẩn hóa; độ sâu 32 và 33; 100.000 và 100.001 phần tử thô; 100.000 và 100.001 phần tử hiệu dụng sau mở `use`; 8 và 9 `filter`; 64 và 65 `fe*`; 16 và 17 ảnh; 2 MiB và +1 byte ảnh; 4.096 và 4.097 ký tự một nút chữ; `d` 1 MiB và +1; thêm `bytes-6mib`, `depth-100`, `raw-200000` cho m29 và m30. Quy ước đếm ở đầu `limits.mjs` (độ sâu, phần tử hiệu dụng, byte ảnh sau giải mã); importer khớp quy ước hoặc chỉnh quy ước ở đó cùng ghi chú task.

Kiểm bộ sinh: `node --test tests/fixtures/svg-import/limits.test.mjs`.
