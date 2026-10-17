# ADR-038: Trình vẽ SVG: mô hình tài liệu thuần và lệnh đảo ngược, bake transform có điều kiện; template bung khi lưu, faceplate là popup có tham số

- **Trạng thái:** Proposed (feature 011, GĐ 6; quyết định "người dùng giao toàn quyền 2026-10-11"). Chuyển Accepted ở Go/No-Go (T198) kèm số đo (T164).
- **Cập nhật 2026-10-17 (T199):** `@mat/svg-edit`, trình vẽ SVG, template và faceplate đã có mã và đã gộp vào `gd6`; số đo trên máy dev dưới. Thử tay bộ gõ, trình đọc màn hình, WebView2 (T167) và fuzz bộ lọc (T165) còn mở. Vẫn Proposed.
- **Ngày:** 2026-10-13
- **Liên quan:** [specs/011-pilot-hardening](../../specs/011-pilot-hardening/plan.md), research R24–R27; contracts [svg-editor.md](../../specs/011-pilot-hardening/contracts/svg-editor.md), [project-format-1.0.md](../../specs/011-pilot-hardening/contracts/project-format-1.0.md); [ADR-003](003-element-uid.md), [ADR-023](023-svg-import-allowlist-uid.md) (allowlist, uid), [ADR-026](026-symbol-library-svg-editing.md) (chọn và gắn Tag phần tử SVG, ký hiệu: 011 không thay), [ADR-007](007-screen-isolation.md), [ADR-013](013-screen-model-v1.md), [ADR-016](016-studio-grid-ime.md), [ADR-019](019-widget-library.md), [ADR-022](022-screen-editor.md); Master Plan §7.3–§7.5; Constitution II, V.

## Bối cảnh

Feature 008 (GĐ 3b) có importer, allowlist, `data-mat-uid`, thư viện ký hiệu và gắn Tag cho phần tử SVG (ADR-023 đến 026); người dùng vẫn phải mở Inkscape cho mọi chỉnh sửa. Master Plan Sprint 3 yêu cầu trình sửa đầy đủ: chọn, di chuyển, đổi cỡ, xoay, group, align, snap, layers, undo/redo ≥ 100 bước, không mất UID. Cũng cần faceplate và template để dựng dự án nhiều thiết bị cùng loại (một popup cho 20 bơm). Editor Màn hình (ADR-022) đã chọn DOM thật, Pointer Events tự viết và hình học thuần.

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Nền | SVG.js + interact.js (Master Plan §4); canvas (Fabric, Konva); nhúng SVG-edit hay Inkscape; **mô hình tài liệu thuần TS + DOM thật** | mô hình thuần (đồng nhất ADR-022; parity với runtime; kiểm Vitest) |
| Hoàn tác | chụp DOM; **lệnh nguyên tử đảo ngược, gộp theo thao tác** | lệnh (Master Plan §7.4) |
| Ghi hình học | luôn `transform`; luôn bake; **bake khi chính xác (đồng dạng không nghiêng; xoay bội 90° cho rect/ellipse), còn lại `transform`** | bake có điều kiện |
| Lớp | thuộc tính ẩn/khóa trong SVG; **`<g data-mat-layer>` + ẩn/khóa là trạng thái soạn thảo ngoài gói (`.mat-editor/`)** | ngoài gói |
| Tuần tự hóa | tuần tự hóa lại toàn bộ; **chuẩn tắc, giữ byte phần không sửa** | chuẩn tắc |
| Công cụ | đầy đủ kiểu Inkscape (Bézier, boolean, filter); **chọn, rect, ellipse, line, polyline/polygon, text một dòng, sửa nút path M L H V Z** | tập nhỏ (Master Plan §7.5) |
| Template | runtime hiểu `instance`; **bung khi lưu thành item thường (chú thích `tpl`)** | bung khi lưu |
| Faceplate | nhân popup N lần; **popup có `params`, hành động `popup` có `args`, thay chuỗi lúc chạy, validator bung mọi tổ hợp** | popup có tham số |

## Quyết định

1. **`@mat/svg-edit`** (TS, không DOM): `DrawDoc` (cây nút theo allowlist), `Command` (`SetAttr`, `SetText`, `InsertNode`, `RemoveNode`, `MoveNode`) đảo ngược được, `Batch`, `UndoStack` 100 bước, ma trận affine, hộp bao, bake, nhóm/bỏ nhóm, bắt dính (lưới, cạnh/tâm, điểm, 15°), căn chỉnh, phân bố, xếp lớp, sửa nút đa giác; mỗi lệnh kiểm allowlist và giới hạn (5 MB, 20.000 nút, độ sâu 32) trước khi áp dụng.
2. **Editor** ở `apps/studio/src/ui/svg/` trên DOM thật trong Shadow DOM của tab, lớp phủ chọn và tay nắm riêng, Pointer Events; văn bản qua `textarea` giữ focus (ADR-016); phím tắt và Palette lệnh.
3. **`data-mat-uid` bất biến** qua sửa; nhân bản/dán cấp uid mới, không sao chép binding (tùy chọn kèm); xóa phần tử có binding cảnh báo, hoàn tác khôi phục.
4. **Chuẩn tắc:** mở rồi lưu không sửa cho cùng byte; phần tử không sửa giữ byte; số làm tròn 3 chữ số; `data-mat-layer`, `data-mat-name` thêm vào allowlist.
5. **Trạng thái soạn thảo** (`.mat-editor/svg-state.json`, bản tự lưu 30 s) ngoài gói và ngoài digest; Studio loại khi đóng gói (cùng quy tắc file thừa của ADR-036).
6. **Template:** `templates/<id>.template.json` (tham số `tagPrefix`, `string`, `number`, `color`); bung khi lưu thành item thường id `<inst>.<rid>` kèm `tpl`; "Cập nhật mọi bản sao" giữ vị trí và tham số; **runtime không đổi**.
7. **Faceplate:** màn hình popup có `params`; hành động `popup` có `args`; `substituteParams` (một hàm thuần dùng chung) thay `{param}` ở validator TS, validator C++ (cùng vector) và runtime; validator bung ≤ 1.000 tổ hợp mỗi popup và kiểm từng Tag; runtime từ chối đăng ký Tag không thuộc tập đã công bố.
8. **Giới hạn có chủ ý:** không bút Bézier, boolean, filter, mask, trình sửa gradient, văn bản nhiều dòng hay trên đường, sửa `symbol`; `path` có đường cong chỉ biến đổi.

## Hệ quả

- **Tốt:** kiểm bằng Vitest (hình học ≥ 150 ca, 1.000 chuỗi lệnh, round-trip ≥ 20 fixture); cùng bộ dựng với runtime; không thêm thư viện; template không đụng runtime.
- **Xấu:** tự viết nhiều hành vi mà thư viện có sẵn; 2.000 phần tử DOM thật khi kéo phải đo (SC-033); template nhân bản item trong tệp màn hình.
- **Rủi ro:** bake sai làm méo hình: bảo vệ bằng điều kiện chính xác và so sánh hộp bao trước/sau (sai số 1e-6); `text` không đo được hộp bao ngoài trình duyệt: test thuần dùng ước tính có ghi chú sai số; GĐ 3b chưa có importer thì US6, US7 chờ.

## Điều kiện xem xét lại

- Phản hồi pilot cần Bézier hoặc boolean: ADR mới (hoặc hướng dẫn Inkscape).
- 2.000 phần tử vượt ngưỡng khung hình: dùng bản xem nhanh khi kéo hoặc chia lớp dựng.
- Cần template lồng nhau hay tham số danh sách: mở rộng contract (MINOR).

## Số đo / bằng chứng

Điền ở T164 (`docs/reports/011-svg-perf.json`), T154 (round-trip), T152 (hình học), T175 (faceplate x64).

**Hiệu năng (T164, 2026-10-17, [011-svg-perf.json](../reports/011-svg-perf.json)).** Máy dev macOS Apple M2, Chrome headless-shell, lớp Tauri giả; **không phải Studio trên Windows/WebView2**.

| Đo | Giá trị | Ngân sách |
|---|---|---|
| mở tệp 20.000 phần tử | 485,6 ms (2.000 phần tử: 73,8 ms) | ≤ 3.000 ms |
| kéo một phần tử trong 2.000 / 20.000 | khoảng cách khung p95 16,7 / 16,8 ms; xử lý p95 0,6 / 1,7 ms | khung ≤ 16,7 ms |
| chọn bằng khung, 2.000 phần tử | 5 ms lần đầu, 1,7 ms lần sau (20.000: 28,9 ms lần đầu) | ≤ 50 ms |
| hoàn tác, 2.000 / 20.000 phần tử | 13,1 / 17,2 ms | ≤ 100 ms |
| kéo 500 phần tử (bản xem nhanh) | khung p95 16,7 ms | |

**Đúng đắn.** Hình học (T152): khoảng 270 ca (ma trận và transform 71, hộp bao 40, bake 35, nhóm khoảng 19, thứ tự 24, đa giác 32, bắt dính 28, căn chỉnh 22). Round-trip (T154): serialize 29 và round-trip 106 ca xanh; so ảnh bằng Chrome 26 fixture, 76 phép so khác 0 % (ngưỡng 1 %), đối chứng âm 25/25. Faceplate (T175): `projects/dashboard-demo` lên 1.0 qua migration (cùng byte với bản dựng thẳng 1.0), `web-it -Scenario faceplate` 103/103 trên runtime giả; chưa chạy trên runtime x64 thật.
