# @mat/symbols

Thư viện ký hiệu SVG của feature 008 (FR-055 đến FR-058): 15 ký hiệu thuộc 5 nhóm (bồn, bơm, van, motor, ống) để kéo từ Toolbox "Ký hiệu SVG" của Studio vào màn hình. **Chỉ Studio nạp gói này**, không vào gói của trang runtime. Contract: `specs/008-svg-import-binding/contracts/symbol-library.md`; quyết định: [ADR-026](../../docs/adr/026-symbol-library-svg-editing.md).

Giấy phép **CC0-1.0**: toàn bộ SVG do dự án tự vẽ, không có logo hay hình của hãng nào (xem [LICENSES.md](LICENSES.md)).

## Cấu trúc

| Đường dẫn | Việc |
|---|---|
| `manifest.json` | nguồn duy nhất: nhóm, ký hiệu, `viewBox`, cỡ mặc định, từ khóa, **bộ phận** (`parts`), **điểm gắn** (`ports`) |
| `svg/*.svg` | hình của từng ký hiệu (đã qua allowlist, không script, không ảnh ngoài) |
| `src/index.ts` | API: `SYMBOLS`, `SYMBOL_CATEGORIES`, `getSymbol`, `symbolsByCategory`, `getSymbolSvg`, `searchSymbols` |
| `src/ports.ts` | hình học điểm gắn: vị trí tuyệt đối, tìm điểm gần nhất tương thích (dính trong 10 điểm ảnh màn hình) |
| `src/symbols-data.ts` | **tệp sinh**, không sửa tay: `npm run gen -w @mat/symbols` |

## Bộ phận và UID cố định

Mỗi phần tử gắn được trong ký hiệu có UID cố định dạng `el_<ký hiệu>_<bộ phận>` (ví dụ `el_tank_vertical_liquid`). UID không đổi giữa các bản của thư viện để project đã gắn Tag không mất binding. Mỗi bộ phận có `role` (`body`, `liquid`, `text`, `hit`, `blade`, `lamp`...), nhãn tiếng Việt và danh sách `suggest` (loại động hóa nên gắn: `fill`, `level`, `text`, `spin`, `flow`, `click`...). Studio dùng danh sách này cho nút **Gắn nhanh** trong inspector: bấm vào bộ phận thì mở đúng dòng binding gợi ý và chờ kéo Tag vào.

## Điểm gắn (ports)

Mỗi điểm gắn có `id`, tọa độ chuẩn hóa `x`, `y` trong hộp bao (0 đến 1), hướng `dir` (`n`, `s`, `e`, `w`) và `kind` (`pipe`). Khi kéo một ký hiệu lại gần điểm gắn tương thích của ký hiệu khác (trong 10 điểm ảnh màn hình), Studio hiện chấm xanh và dính hai điểm vào nhau; giữ **Alt** để tắt dính. Đoạn ống có hai điểm gắn nên nối tiếp được thành đường ống.

## Thả vào màn hình

Thả một ký hiệu tạo một item `svg` mới: file SVG của ký hiệu được sao vào `graphics/symbols/<id>.svg` (nhiều thể hiện của cùng ký hiệu dùng chung một file), mỗi item có file binding riêng. Ctrl+Z bỏ trong một bước. Mỗi màn hình tối đa 64 item `svg`.

## Thêm ký hiệu

1. Vẽ SVG theo allowlist (xem [docs/guides/svg-export.md](../../docs/guides/svg-export.md)), đặt `data-mat-uid` cho từng bộ phận theo quy ước trên, thêm vào `svg/`.
2. Khai báo trong `manifest.json` (bộ phận, điểm gắn trong hộp bao).
3. `npm run gen -w @mat/symbols`, rồi `npm test -w @mat/symbols`.

Bộ kiểm tra (`tests/`) bảo đảm: mọi ký hiệu qua allowlist không bị loại phần tử hay thuộc tính nào, UID đúng mẫu và không trùng, điểm gắn nằm trong hộp bao, `symbols-data.ts` khớp tệp nguồn.

## Test

`npm test -w @mat/symbols`.
