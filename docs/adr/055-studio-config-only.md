# ADR-055: Studio chỉ cấu hình, không vẽ (bỏ thư viện ký hiệu và trình vẽ SVG)

- **Trạng thái:** Accepted (2026-10-27, quyết định của người dùng).
- **Ngày:** 2026-10-27
- **Liên quan:** thay phần "thư viện ký hiệu" của [ADR-026](026-symbol-library-svg-editing.md) và phần "trình vẽ SVG" của [ADR-038](038-svg-editor-templates.md) (template, faceplate của ADR-038 giữ nguyên); giữ [ADR-023](023-svg-import-allowlist-uid.md) (nhập SVG), [ADR-024](024-binding-animation-0.4.md) (binding, hoạt ảnh), [ADR-025](025-svg-element-events.md) (sự kiện); [studio-ux.md](../architecture/studio-ux.md); Constitution VII.

## Bối cảnh

Studio có hai tính năng vẽ: Toolbox **Ký hiệu SVG** (15 ký hiệu của `packages/symbol-library`, kéo thả, dính điểm gắn; feature 008) và **Trình vẽ SVG** (tab `svgdraw:`, "Mới: SVG trống", tám công cụ, lớp, tự lưu `.mat-editor/`; package `@mat/svg-edit`; feature 011). Người dùng quyết định mAT Studio chỉ là công cụ **cấu hình**: đồ họa vẽ bằng phần mềm chuyên dụng (Inkscape, Illustrator, CorelDRAW), Studio nhập, gắn Tag, cấu hình hoạt ảnh và sự kiện.

## Quyết định

1. **Bỏ khỏi Studio:** Toolbox Ký hiệu SVG, kéo thả và dính điểm gắn (`symbol-flow`, `snapBoxWithPorts`, lớp phủ điểm gắn), trình vẽ SVG cùng lệnh, phím tắt, task card "Công cụ vẽ", hộp thoại tự lưu, mục cây "Đồ họa SVG", "Sửa trong trình vẽ" (Ctrl+Alt+Enter), chuỗi `svgd.*`, `tc.sym.*`, `sym.*`. Xóa hai package `@mat/symbols` (`packages/symbol-library`) và `@mat/svg-edit` (không còn ai dùng cho nhập hay gắn Tag), fuzz `svg-sanitize` và `svg-edit-commands`, kho mầm `tests/svg-editor-fixtures`, mã lỗi `W_SVG_FONT` (chỉ trình vẽ phát).
2. **Rust:** bỏ `project_fingerprint`, `editor_list`, `editor_remove` (module `editor_fs`). Giữ `project_list_svg` (chuyển sang `svg_list.rs`) vì hộp chọn logo báo cáo dùng.
3. **Giữ nguyên:** Nhập SVG, Nhập lại SVG, vào item và cây phần tử, Gắn Tag, 13 hoạt ảnh, Sự kiện, Thử giá trị, Gợi ý, template, faceplate, màn hình lưới, widget.
4. **Project cũ:** hình ký hiệu đã chèn nằm trong `graphics/symbols/*.svg` của project là SVG thường: Studio mở, gắn Tag, runtime hiển thị như mọi item `svg`. Định dạng project không đổi. **Gắn nhanh** theo bộ phận giữ cho các tệp này nhờ bảng dữ liệu nhỏ `apps/studio/src/i18n/symbol-parts.ts` (UID cố định, nhãn, gợi ý). Thư mục `.mat-editor/` còn sót vẫn bị loại khỏi gói như trước.
5. **Bộ sinh project mẫu** (`tools/svg-demo`, `tools/svg-showcase`) đọc 15 hình và `manifest.json` ở `tools/symbol-data/` (ngoài Studio, không vào bản cài); project tái sinh từng byte như cũ.

## Phương án đã cân nhắc

- **Ẩn tính năng sau cờ:** giữ mã chết và test phải bảo trì; trái yêu cầu "không để mã chết".
- **Giữ `@mat/symbols` chỉ cho Gắn nhanh:** kéo theo 15 SVG nhúng (khoảng 700 dòng dữ liệu) vào gói Studio chỉ để đọc nhãn bộ phận; bảng 50 dòng là đủ.
- **Bỏ luôn Gắn nhanh:** người dùng yêu cầu giữ.

## Hệ quả

- Studio nhỏ hơn (bớt khoảng 7.500 dòng mã Studio, hai package, bốn lệnh Rust thành một), ít bề mặt tấn công hơn (không còn đường dán SVG, tự lưu, theo dõi tệp).
- Người dùng cần phần mềm vẽ ngoài để tạo hình; hướng dẫn xuất ở [svg-export.md](../guides/svg-export.md).
- Câu "Trình vẽ SVG tự do dời về GĐ 6" của Constitution VII không còn đúng: cần sửa ở lần sửa Hiến chương tới (PATCH, người dùng duyệt).

## Bằng chứng

`npm run lint`, `npm run typecheck`, `npm test`, e2e Studio các spec bị ảnh hưởng (`rebuild-tank` dùng hình ký hiệu có sẵn trong project thay cho kéo thả, `import`, `reimport`, `svg-bind`, `shell`), `cargo test` của Studio, `gen-error-codes --check`, tái sinh `projects/svg-demo` và `projects/svg-showcase` không đổi.

## Điều kiện xem xét lại

Khi người dùng muốn Studio vẽ trở lại: dựng lại từ lịch sử git (commit trước ADR này) thay vì viết mới.
