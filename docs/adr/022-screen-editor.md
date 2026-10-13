# ADR-022: Trình bố trí màn hình của Studio: lớp phủ trên DOM, Pointer Events tự viết, hình học thuần

- **Trạng thái:** Accepted (feature 007, GĐ 3a; quyết định "người dùng giao toàn quyền 2026-10-11"). Đã cài và đo ngày 2026-10-13 trên Chrome headless (máy phát triển): số đo ở mục "Số đo / bằng chứng"; không cần bản "xem nhanh" khi kéo.
- **Ngày:** 2026-10-13
- **Liên quan:** [specs/007-screens-widgets](../../specs/007-screens-widgets/plan.md), research R19–R22; [studio-ux.md](../architecture/studio-ux.md) §5; mockup [studio-screens.html](../architecture/mockups/studio-screens.html); [ADR-009](009-studio-ui-stack.md), [ADR-013](013-screen-model-v1.md), [ADR-016](016-studio-grid-ime.md), [ADR-019](019-widget-library.md); Constitution II, VI.

## Bối cảnh

Editor Màn hình là phần Studio lớn nhất của GĐ 3a: canvas zoom/pan/lưới/snap, kéo thả từ Toolbox, di chuyển, đổi cỡ, căn chỉnh, xếp lớp, chọn nhiều, inspector, kéo Tag. Màn hình gồm item `svg` và item `widget` (HTML, Shadow DOM). Studio phải giống Chrome (Constitution II) nên widget trong editor là chính widget thật. Master Plan §4 từng chọn SVG.js và interact.js cho canvas khi widget còn định nằm trong SVG; ADR-013 đã đưa widget ra HTML.

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Dựng canvas | Canvas 2D hoặc WebGL (Konva, Fabric, Pixi); SVG (SVG.js) với widget vẽ lại; **DOM thật của `<mat-screen>` + lớp phủ chọn/tay nắm** | DOM + lớp phủ |
| Bắt sự kiện | **Pointer Events tự viết, `setPointerCapture`**; interact.js (MIT); HTML5 drag-and-drop cho cả kéo item | Pointer Events (HTML5 DnD chỉ cho Toolbox và Tag) |
| Hình học | trong thành phần giao diện; **hàm thuần có test** (bắt dính, gióng, căn chỉnh, đổi cỡ, phân bố, xếp lớp) | hàm thuần |
| Trạng thái sửa | trạng thái riêng trong canvas; **tài liệu màn hình bất biến + lịch sử snapshot có sẵn** (`app/history.ts`) | tài liệu + lịch sử có sẵn |
| Inspector | viết tay từng widget; **sinh từ danh mục widget** ([ADR-019](019-widget-library.md)) | sinh từ danh mục |
| Docking | thêm dockview-core ngay; **chưa** (ADR-009) | chưa |

## Quyết định

1. **Canvas** `mat-screen-canvas` (Lit, light DOM như khung Studio): chứa một `<mat-screen>` ở chế độ sửa (widget `pointer-events: none`, không gửi hành động, không mở hộp xác nhận), kèm **lớp phủ** (cùng hệ tọa độ thiết kế, cùng phép co/dịch) vẽ khung chọn, tay nắm, đường gióng, khung chọn nhiều, viền lỗi. Thước và lưới là lớp vẽ riêng. Zoom và pan là một ma trận `translate + scale` áp cho khung; Ctrl+lăn chuột phóng quanh con trỏ; Space+kéo hoặc chuột giữa để pan.
2. **Tương tác bằng Pointer Events:** một máy trạng thái (`idle`, `panning`, `marquee`, `moving`, `resizing`, `tool-drop`) trong `apps/studio/src/model/screen-edit/gesture.ts` (TS thuần, nhận sự kiện đã chuyển sang tọa độ thiết kế). Đổi tọa độ màn hình ↔ thiết kế bằng một hàm thuần. Khi kéo chỉ đổi `left/top/width/height` của các phần tử DOM đang kéo và lớp phủ (một lần ghi mỗi khung hình); **tài liệu chỉ đổi khi thả chuột** (một bước hoàn tác); `Esc` hủy.
3. **Hình học thuần** trong `apps/studio/src/model/screen-edit/`: `snap.ts` (lưới, cạnh/tâm item khác, ngưỡng 6 điểm ảnh màn hình đổi ra đơn vị thiết kế theo zoom), `align.ts` (6 kiểu căn, phân bố đều, cùng rộng/cao), `resize.ts` (8 tay nắm, giữ tỉ lệ, cỡ tối thiểu theo danh mục, nhiều item), `layers.ts` (đưa lên/xuống, lên/xuống một lớp, đổi thứ tự), `hit.ts` (chọn theo điểm, khung chọn; item ẩn/khóa), `clipboard.ts` (sao chép, dán, nhân bản; id mới). Test viết trước (SC-014).
4. **Tài liệu màn hình** `model/screen-doc.ts`: thao tác trên snapshot JSON bất biến; mỗi thao tác trả snapshot mới; đưa vào lịch sử có sẵn (100 bước, gộp theo `mergeKey` cho cử chỉ liên tục). Lưu bằng định dạng ổn định (FR-070).
5. **Kéo thả HTML5** chỉ cho: Toolbox → canvas (`application/x-mat-widget`), cây hoặc Details → ô gắn Tag của inspector hoặc widget trên canvas (`application/x-mat-tag`). Dữ liệu kéo chỉ là chuỗi định danh (loại widget, id Tag); nơi nhận kiểm lại với tài liệu.
6. **Inspector** sinh từ danh mục: nhóm Chung, Hiển thị, Gắn Tag, Sự kiện, Bảo mật; lỗi theo ô; chọn nhiều thì hiện thuộc tính chung. Ô số, ô chữ dùng lưới/ô nhập của Studio (ADR-016 cho bộ gõ).
7. **Kiểm tra liên tục** trong `validate.worker.ts` (có sẵn), gom 150 ms sau lần sửa cuối; lỗi gắn với `itemId` để tô viền và nhảy tới.
8. **Bàn phím:** Tab chọn item theo thứ tự lớp, mũi tên dịch (Shift 10), Enter mở inspector, Delete xóa, Ctrl+C/V/D, Ctrl+A, Esc bỏ chọn; mọi lệnh có trong bảng lệnh (Ctrl+Shift+P).
9. **Xem trước:** cùng `<mat-screen>` ở chế độ chạy, `TagSource` là `SimEngine` hoặc phiên thiết bị, `ActionHost` của Studio; canvas khóa sửa.

## Hệ quả

- **Tốt:**
  - Canvas dùng widget và renderer thật: không có "bản vẽ" khác với kết quả.
  - Hình học và cử chỉ là hàm/máy trạng thái thuần: kiểm tự động, không cần trình duyệt.
  - Không thêm thư viện.
- **Xấu:**
  - Tự viết nhiều hành vi chọn/kéo mà thư viện có sẵn; cần test kỹ và e2e.
  - 250 item DOM thật khi kéo nhiều item: phải đo (SC-013); nếu chậm thì dùng bản "xem nhanh" trong lúc kéo.
- **Rủi ro:** `pointer-events: none` trên widget làm mất tooltip/focus của widget trong editor (chấp nhận: editor cho tooltip riêng); Shadow DOM làm chọn theo điểm phải dựa vào hình chữ nhật của item, không dựa vào `elementFromPoint` (đã chọn như vậy).

## Số đo / bằng chứng

- **Đã đo (2026-10-13, `apps/studio/tests/e2e/screen-perf.e2e.mjs`, Chrome headless, lớp Tauri giả, màn hình 250 item card/đèn/nhãn 3840 × 2160, ghi ở `apps/studio/tests/e2e/out/screen-perf.json`):**

  | Việc | Ngưỡng (SC-013) | Số đo |
  |---|---|---|
  | Mở màn hình 250 item (tới khi đủ 250 phần tử lớp phủ và 250 item dựng) | ≤ 1.000 ms | 45 ms |
  | Kéo 100 item cùng lúc: khoảng giữa hai khung rAF, 312 khung | trung bình ≤ 16,7 ms | trung bình 15,5 ms, p95 39,9 ms, lớn nhất 60 ms |
  | Hoàn tác một bước (Ctrl+Z tới khi khung chọn đổi) | ≤ 100 ms | 15,3 ms |
  | Kiểm tra sau sửa (gom 150 ms cộng chạy kiểm tra) | ≤ 500 ms | 198 ms |

  Số đo máy phát triển, không phải BL335 (Studio chạy trên máy Windows). Độ chính xác hình học (SC-014) kiểm bằng bảng ca của test thuần: `snap.test.ts` (21 ca), `align.test.ts` (13), `resize.test.ts` (15), `gesture.test.ts` (36), `viewport.test.ts` (10), `screen-doc.test.ts` (42, gồm 300 bước ngẫu nhiên kiểm bất biến id duy nhất, số nguyên, ≥ `minSize`, ≤ 250 item).

## Ghi chú khi cài (2026-10-13)

- Canvas dựng `<mat-screen mode="edit" viewport=<size>>` ở tỉ lệ 1:1 trong một "thế giới" CSS (`translate` + `scale` theo zoom 10 đến 400 % và pan); lớp phủ nằm cùng thế giới nên khung chọn và tay nắm theo đơn vị thiết kế, độ dày nét và cỡ tay nắm theo `--k` = 1 / zoom. Bản vẽ bên dưới `inert` và `aria-hidden`; mỗi item có một phần tử lớp phủ trong suốt.
- **ARIA:** vùng nhìn là `listbox` đa chọn, mỗi item một `option` (`aria-selected`, `aria-activedescendant` trỏ item chính); contract nêu `role="button"` kèm `aria-selected` nhưng `aria-selected` không hợp lệ trên `button` (axe `aria-allowed-attr`). Panel Lớp và editor Điều hướng dùng `grid` và `tree` cùng kiểu (focus ở vùng, trỏ bằng `aria-activedescendant`, nút khóa và ẩn nằm trong ô riêng).
- Kéo thả Toolbox: trình duyệt chỉ cho đọc `dataTransfer.types` lúc `dragover`, nên Toolbox đặt thêm một loại `application/x-mat-widget-<id>` (id chữ thường) để canvas biết đang kéo gì và hiện bản xem trước khi rê.
- Item `svg`: chọn, di chuyển, đổi cỡ, xếp lớp như widget; không nhân bản (hai item không dùng chung file binding); binding hiện chỉ đọc ở nhóm Đồ họa. Ctrl+nhấp chọn phần tử SVG bên trong item của editor 0.1 và 0.2 (`screen-preview.ts`, vẫn dùng cho project mở chỉ đọc) không có ở editor mới vì Ctrl+nhấp là phím chọn thêm item; chọn phần tử SVG là việc của GĐ 3b.

## Điều kiện xem xét lại

- Cần docking tự do (tách đôi editor màn hình): mở lại ADR-009 để chọn dockview-core.
- Hiệu năng kéo nhiều item không đạt: dựng bản xem nhanh bằng hình chữ nhật trong lúc kéo.
- GĐ 3b: thêm chọn phần tử bên trong item `svg`.
