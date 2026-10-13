# ADR-026: Thư viện ký hiệu, thể hiện là item `svg`, và chọn, gắn Tag cho phần tử SVG trong Studio

- **Trạng thái:** **Proposed** (feature 008, 2026-10-13; quyết định "người dùng giao toàn quyền 2026-10-11"). Số đo chờ: SC-018 (chọn phần tử, cây phần tử), SC-005 (40 item `svg`), SC-017 (ký hiệu).
- **Ngày:** 2026-10-13
- **Liên quan:** [specs/008-svg-import-binding](../../specs/008-svg-import-binding/plan.md), research R15–R17, R24; contracts [symbol-library.md](../../specs/008-svg-import-binding/contracts/symbol-library.md), [studio-svg-editor.md](../../specs/008-svg-import-binding/contracts/studio-svg-editor.md); [ADR-013](013-screen-model-v1.md) (D26 của 007: ≤ 8 item `svg`), [ADR-022](022-screen-editor.md) (canvas), [ADR-009](009-studio-ui-stack.md); [studio-ux.md](../architecture/studio-ux.md) §5, §9; lộ trình v2 §4.4, §4.7 (trình vẽ đầy đủ ở GĐ 6); Constitution II, VII.

## Bối cảnh

3b cần ba thứ trong Studio: (1) **chọn phần tử** bên trong đồ họa SVG để gắn Tag, không viết JSON; (2) **thư viện ký hiệu** (bơm, van, bồn, motor, ống) "SVG sạch, có điểm gắn"; (3) giữ ranh giới: **trình vẽ SVG đầy đủ là GĐ 6** (sửa phần tử, nhóm, undo/redo nhiều bước, nối ống).

007 đã có editor Màn hình (DOM thật của `<mat-screen>` + lớp phủ chọn, Pointer Events tự viết) và giới hạn 8 item `svg` mỗi màn hình (D26). Sơ đồ công nghệ thật có vài chục bơm, van, ống.

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Ký hiệu trong màn hình | gộp vào một SVG lớn (cần sửa SVG); widget; **mỗi thể hiện là một item `svg`** | item `svg` |
| Trần item `svg` | giữ 8; **64** | 64 |
| Điểm gắn | đối tượng "kết nối" trong project; **siêu dữ liệu của thư viện để dính khi kéo** | siêu dữ liệu |
| Chọn phần tử | một nhấp chọn phần tử (khó kéo item); công cụ riêng; **nhấp đúp "vào" item rồi chọn** | vào item |
| Hit-test | tự tính hình học; **`elementsFromPoint` của Shadow DOM** | `elementsFromPoint` |
| Cây phần tử | dựng hết; **dựng lười** | lười |
| Sửa SVG trong Studio | thêm xóa, đổi hình; **chỉ nhập, nhập lại, đổi tên (`data-mat-name`)** | tối thiểu |
| Gắn Tag | ô JSON; trình hướng dẫn; **inspector sinh từ danh sách 13 mục động hóa, kéo Tag, Gợi ý, Thử giá trị** | inspector sinh từ dữ liệu |
| Đọc file ngoài | `<input type=file>`; kéo thả; **lệnh Rust `svg_open` (khuôn `csv_open`)** | `svg_open` |

## Quyết định

1. **Thư viện** `@mat/symbols` (private): 12 ký hiệu (15 tệp SVG; cút 4 biến thể) trong 5 nhóm; do dự án vẽ (CC0), không logo hay hình của hãng; mỗi ký hiệu qua allowlist không bị loại gì; `manifest.json` khai **bộ phận** (`role`, UID cố định `el_<ký hiệu>_<bộ phận>`, nhãn, gợi ý binding) và **điểm gắn** (`id`, `x`, `y` tương đối, `dir`, `kind`).
2. **Thể hiện = item `svg`:** thả ký hiệu tạo item `svg` mới, tệp SVG sao vào `graphics/symbols/…` (chung giữa thể hiện), file binding riêng; nâng trần lên **64 item `svg` mỗi màn hình** (định dạng 0.4.0); 250 item mỗi màn hình giữ nguyên. Chi phí: mỗi item một Shadow DOM và một file binding (đo SC-005 với 40 item).
3. **Điểm gắn là siêu dữ liệu:** `portSnap` (hàm thuần) cho dính trong ≤ 10 điểm ảnh màn hình khi cùng `kind` và hướng đối nhau; không lưu quan hệ nối vào project; trình nối ống tự động thuộc GĐ 6.
4. **Chọn phần tử:** nhấp = chọn item; nhấp đúp hoặc Enter = "vào" item; trong item: `shadowRoot.elementsFromPoint` → phần tử có `data-mat-uid` đầu danh sách; Alt+nhấp chọn cha; khung chọn ở lớp phủ (không sửa DOM của SVG); cây phần tử ở Details, dựng lười, ≤ 300 ms cho 20.000 phần tử; Esc thoát.
5. **Studio không sửa nội dung SVG** ngoài nhập, nhập lại, đổi tên phần tử (ghi `data-mat-name` bằng bộ ghi tất định). Muốn đổi hình: sửa ngoài rồi Nhập lại (ADR-023). Xóa, vẽ, nhóm phần tử thuộc GĐ 6.
6. **Inspector Gắn Tag** sinh từ `animation-catalog.ts` (13 mục: chữ, màu nền, màu viền, mức, quay, quay liên tục, di chuyển X, di chuyển Y, co giãn, nhấp nháy, dòng chảy, ẩn/hiện, độ mờ): mỗi mục có đích, loại phần tử hợp, kiểu Tag hợp, phép biến đổi hợp, đặc tả tham số; thêm hiệu ứng bằng dữ liệu. Kéo Tag vào dòng hoặc lên phần tử trên canvas; **Gợi ý** theo bảng loại phần tử × kiểu Tag (không tự áp); **Thử giá trị** đặt giá trị trong `SimEngine` cho item đang vào, không ghi project, không tới thiết bị; thao tác thuần ở `svg-binding-doc.ts`, mỗi thao tác một bước hoàn tác (tới 100).
7. **Nhóm Sự kiện** và Bảo mật cùng giá trị `minRole` (ADR-025).
8. **Lệnh Rust `svg_open`:** hộp thoại hệ thống lọc `.svg`, từ chối > 5 MiB + 64 B, trả byte thô; không thêm đường đọc tùy ý (giữ nguyên tắc "giao diện không tự đọc/ghi ngoài thư mục project"). Ngoại lệ có chủ ý của quy ước "không lệnh Tauri mới" của 007.
9. **Phân tách:** nhập chạy trong Web Worker (file lớn không chặn giao diện); xem trước "Trước" dựng bản đã lọc allowlist (Studio không bao giờ dựng SVG chưa lọc).

## Hệ quả

- **Tốt:**
  - Có đường đi trọn vẹn (nhập → chọn → gắn → thử → xem trước → nạp xuống) mà không cần trình vẽ.
  - Thể hiện ký hiệu tận dụng sẵn di chuyển, đổi cỡ, khóa, xếp lớp của editor 007.
  - Thêm ký hiệu hay hiệu ứng bằng dữ liệu.
  - Ranh giới với GĐ 6 rõ: Studio không sửa SVG.
- **Xấu:**
  - Nhiều item `svg` hơn: nhiều Shadow DOM và file binding (đo SC-005); ADR-007 điều kiện xem xét lại ("hiệu năng dựng hàng trăm Shadow DOM") có thể bị chạm ở 64 item.
  - Muốn sửa nhỏ hình (đổi đường nét) phải ra ngoài Studio rồi Nhập lại.
  - Thể hiện không biết "nối với ai": đổi vị trí ống không kéo theo bơm.
  - Chọn phần tử bằng "vào item" cần học một cử chỉ.
- **Rủi ro:** (1) 64 item `svg` mỗi màn hình làm mở màn hình chậm trên BL335/Chrome yếu (đo SC-005; dự phòng: hạ trần); (2) hit-test qua Shadow DOM không đúng với phần tử bị `clip-path`, `mask` (chấp nhận, ghi tài liệu); (3) `elementsFromPoint` với SVG 20.000 phần tử chậm (đo ≤ 50 ms; dự phòng: chỉ xét phần tử có UID).

## Số đo / bằng chứng

**Chưa đo.** Cơ sở: ADR-022 (kéo 100 item); `svg-load` (27.025 phần tử dựng ≤ 554 ms). Sẽ ghi: SC-017, SC-018, SC-005 (40 item), kịch bản dựng lại `tank-demo` (số thao tác).

## Điều kiện xem xét lại

- 64 item `svg` không đạt SC-005: hạ trần hoặc gộp thể hiện cùng loại vào một Shadow DOM.
- Cần nối ống tự động, nhóm, sửa hình: GĐ 6 (trình vẽ SVG đầy đủ); khi đó điểm gắn thành đối tượng của project.
- Cần thư viện ký hiệu của khách hoặc "lưu thành ký hiệu": GĐ 6 (faceplate/template).
