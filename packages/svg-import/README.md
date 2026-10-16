# @mat/svg-import

Nhập SVG của feature 008 (chỉ Studio, CLI và test; không vào gói của trang runtime). Contract: `specs/008-svg-import-binding/contracts/svg-import.md`.

## Dùng

```ts
import { importSvg, assertAllowlisted, reportToMarkdown } from '@mat/svg-import';

const r = importSvg(bytes, { fileName: 'tank.svg', optimize: false });
if (r.ok) {
  assertAllowlisted(r.svg); // bản đã nhập không còn gì ngoài allowlist
  console.log(r.report.counts, r.elements.length);
} else {
  console.error(r.error.code, r.error.message); // E_IMPORT_*
}
```

`importSvg` thuần (không ném lỗi cho đầu vào xấu), chạy trong jsdom hoặc trình duyệt. Đường ống: byte, tiền xử lý (DTD, PI, entity Adobe), parse, đếm, nhận diện phần mềm, CSS, chuẩn hóa, allowlist, `use`, Tối ưu (tùy chọn), UID và tên, ghi, báo cáo.

## Không vào gói của trang

`@mat/svg-import` chỉ có ở Studio, CLI và test; trang runtime chỉ nạp allowlist của `@mat/svg-renderer` (ADR-023, SC-022). `apps/runtime-web/scripts/package-web.mjs` làm hỏng bản build nếu thấy dấu vết importer (`E_IMPORT_*`, `W_IMPORT_*`, `importSvg`...) trong JS của trang hoặc khai báo phụ thuộc vào gói này; `tools/web-it.ps1 -Scenario bundle` ghi `docs/reports/008-bundle-x64.json`.

Cách xuất SVG để nhập sạch từ Inkscape, Illustrator, CorelDRAW: [docs/guides/svg-export.md](../../docs/guides/svg-export.md). Khác biệt định dạng giữa các phần mềm: [docs/architecture/svg-dialects.md](../../docs/architecture/svg-dialects.md). Nhập lại và giữ UID: `matchSvg` (ADR-003, contract mục 7).

## Dòng lệnh

```
npm run svg:inspect -- --import <file.svg|thư mục>... [--optimize] [--report-dir <thư mục>] [--out <thư mục>] [--json kq.json]
```

- Thư mục: đệ quy, bỏ qua `malicious/` và `out/`. Mã thoát 1 nếu có file bị từ chối.
- `--report-dir`: `<tên>.report.json` và `<tên>.report.md`. `--out`: SVG đã nhập.
- CI chạy `npm run svg:inspect -- --import tests/fixtures/svg-import` (10 fixture nghiệm thu phải nhập được).

## Công cụ nghiệm thu (`tools/svg-import/`)

| Lệnh | Việc |
|---|---|
| `node tools/svg-import/compare-images.mjs` | So ảnh 10 fixture (Chrome headless), ghi `docs/reports/008-fixtures.json` |
| `node tools/svg-import/malicious-harness.mjs` | Bộ độc hại + canary, ghi `docs/reports/008-malicious-x64.json` |
| `node tools/svg-import/fuzz.mjs [--cases N] [--seed S]` | Fuzz tất định, ghi `docs/reports/008-fuzz-x64.json` |

Chrome lấy từ `CHROME_PATH` hoặc đường dẫn cài mặc định.

## Test

`npm test -w @mat/svg-import`; test CLI: `node --test tools/svg-import/*.test.mjs`.
