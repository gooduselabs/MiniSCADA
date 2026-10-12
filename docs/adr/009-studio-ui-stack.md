# ADR-009: Ngăn xếp giao diện của mAT Studio

- **Trạng thái:** Accepted (2026-10-11, khi xong phần phát triển của feature 004; số đo ở mục "Số đo / bằng chứng"). Người dùng chưa duyệt mockup: điều người dùng muốn đổi về màu hay bố cục chỉ đụng token và `mat-shell`, không đổi quyết định này.
- **Ngày:** 2026-10-11
- **Liên quan:** [studio-ux.md](../architecture/studio-ux.md) §8; [specs/004-studio-shell](../../specs/004-studio-shell/plan.md), research R1–R4, R12, R14; Constitution II, V, VII.

## Bối cảnh

Studio Sprint 1 viết bằng TypeScript thuần trên một trang form. Lộ trình v2 cần khung kiểu IDE:

- cây project, editor dạng tab, inspector, task card;
- về sau có editor màn hình (GĐ 3a) và widget dùng chung với trang runtime trên Chrome.

Ràng buộc:

- CSP `script-src 'self'`, không `eval`;
- không chèn dữ liệu project dạng HTML;
- Studio và runtime dùng chung package (Constitution II);
- tránh phụ thuộc chưa cần (Constitution VII).

## Các phương án

| Phần | Phương án | Ghi chú |
|---|---|---|
| Thành phần | **Lit 3.3.3** (chọn) | Web component; dùng được cả trong trang runtime; khoảng 5 KB nén; dữ liệu được thoát ký tự |
| | React hoặc Preact | Nặng hơn; trang runtime cũng phải mang theo nếu muốn dùng chung widget |
| | TS thuần (như Sprint 1) | Nhiều mã lặp khi giao diện lớn lên |
| Bố cục, docking | **CSS grid + thanh kéo tự viết** (chọn cho GĐ 1) | Đủ cho bảy vùng cố định: đổi cỡ, thu gọn, nhớ bố cục |
| | dockview-core 8.3.1 (MIT) | Có tách đôi editor, kéo panel tự do; chưa cần, đánh giá lại ở GĐ 3a |
| Lưới | **Tự viết trên Lit, chưa ảo hóa** (chọn cho GĐ 1) | ≤ 500 dòng; logic lưới tách riêng để thay phần hiển thị ở GĐ 2 |
| | AG Grid Community, Tabulator, RevoGrid | So sánh ở GĐ 2, khi có yêu cầu ≥ 2.000 dòng, dán Excel, chọn vùng |
| Icon | **Fluent UI System Icons** `@fluentui/svg-icons` 1.1.343 (MIT) | Hợp Windows; chỉ đóng gói icon dùng tới |
| Thanh tiêu đề | **Gốc của Windows** (chọn) | Giữ snap layout, viền đổi cỡ, DPI; menu ở hàng đầu trong cửa sổ |
| | Tự vẽ (`decorations: false`) | Gọn như mockup nhưng mất snap layout nếu không thêm plugin |

## Quyết định

- **Thành phần:** Lit cho giao diện. Logic (store, hoàn tác, mô hình project, cây, ánh xạ lỗi, lưới, phiên thiết bị) là TS thuần, không phụ thuộc Lit, có test Vitest.
- **Light DOM:** thành phần của khung Studio render vào light DOM, không Shadow DOM. Lý do:
  - sprite icon `<use href="#i-…">` không thấy được id của document từ trong shadow root;
  - token và kiểu chung áp thẳng như mockup.

  Widget dùng chung với runtime (GĐ 3a) được quyết riêng và có thể dùng Shadow DOM để cách ly.
- **Bố cục:** GĐ 1 tự dựng bằng CSS grid và thanh kéo. Chưa dùng thư viện docking.
- **Lưới Tag:** tự viết, chưa ảo hóa. Logic lưới để riêng (`model/grid-model.ts`).
- **Icon:** Fluent UI System Icons, nạp lúc build, không tải từ mạng.
- **Thanh tiêu đề:** giữ thanh tiêu đề gốc của Windows.
- **Phiên bản thư viện:** mọi thư viện mới chọn bản phát hành ít nhất 2 tuần trước ngày chọn. Ghi phiên bản cố định trong `package.json`.
- **Kiểm thử giao diện:** Vitest + jsdom; e2e trên Chrome headless với lớp Tauri giả và axe-core 4.13.0 (MPL-2.0, chỉ khi phát triển); kiểm tay trên WebView2 thật trước nghiệm thu.

## Hệ quả

- `packages/ui-components` (GĐ 3a) dùng Lit; widget viết một lần cho Studio và runtime web.
- Lit dùng `innerHTML` cho phần tĩnh của template do lập trình viên viết. Quy tắc "không innerHTML với dữ liệu project" vẫn giữ vì dữ liệu chỉ đi qua binding của template, và luật lint chặn `unsafeHTML`.
- Khi cần tách đôi editor, panel nổi (GĐ 3a) hoặc lưới lớn (GĐ 2), mở lại ADR này để chọn dockview-core hoặc thư viện lưới, với số đo.
- Bộ cài tăng khoảng vài chục KB (Lit, icon).

## Số đo / bằng chứng

- Phiên bản và ngày phát hành tra bằng `npm view <gói> time` ngày 2026-10-11:
  - lit 3.3.3: 2026-05-14;
  - dockview-core 8.3.1: 2026-09-10 (8.4.x và 8.5.x mới hơn 2 tuần);
  - @fluentui/svg-icons 1.1.343: 2026-09-25;
  - axe-core 4.13.0: 2026-08-05 (4.14.0 mới 6 ngày).
- Bố cục bảy vùng, thanh kéo, theme và ba luồng online đã chạy được bằng HTML/CSS/JS thuần trong [mockup](../architecture/mockups/studio-shell.html). Chạy trên Chrome headless ở 1440 × 900 và 400 × 820: không lỗi console, không cuộn ngang.
- **Sau khi làm feature 004 (2026-10-11):**
  - Bản build giao diện: JS 341 KB (101 KB gzip), CSS 34,5 KB (7,4 KB gzip), gồm Lit, icon, chuỗi giao diện và các package dùng chung với runtime (bộ kiểm tra, svg-renderer, binding-engine, live-client).
  - Bảng Tag 500 dòng tự viết, chưa ảo hóa, trên Chrome headless: mở 99 ms; phím mũi tên trung bình 14 ms, tối đa 22 ms; gõ trong ô khoảng 11 ms mỗi phím; từ lúc sửa tới khi lỗi hiện 280 ms (SC-003: ≤ 100 ms mỗi phím, ≤ 1 s). Lưới tự viết đủ cho GĐ 1, chưa cần thư viện lưới.
  - axe-core 4.13.0 ở mọi editor, theme sáng và tối: 0 vi phạm critical/serious, sau khi sửa ba lỗi do axe bắt được (cây rỗng mang role=tree, nút đóng lồng trong tab, tương phản chữ phụ trên dòng chọn ở theme tối).
  - Thành phần render ở light DOM (research R1) có một hệ quả: CSS là toàn cục. Đã gặp hai editor cùng đặt lớp `.lv`. Quy ước từ đó: bộ chọn CSS của editor phải có phạm vi theo thẻ thành phần (`mat-tag-grid …`) hoặc tiền tố riêng.
  - Thuộc tính `style` trong template dùng `styleMap` (gán qua CSSOM), để vẫn đúng nếu Tauri chèn hash vào `style-src` của CSP.
  - Test: Vitest 534 test (logic, component trong jsdom), e2e 5 file 110 kiểm (Chrome headless, lớp Tauri giả), `cargo test` 23/23.

## Điều kiện xem xét lại

- Cần tách đôi editor hoặc panel kéo thả tự do.
- Lưới cần ≥ 2.000 dòng hoặc chọn vùng nhiều ô.
- Lit không đáp ứng widget runtime (hiệu năng trên Chrome của client, kích thước).
- Người dùng muốn thanh tiêu đề gộp như mockup.
