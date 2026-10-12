# ADR-016: Lưới ảo hóa tự viết trên Lit và nhận chữ từ bộ gõ

- **Trạng thái:** Proposed (feature 006, plan ngày 2026-10-11; người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11). Thay phần "Lưới Tag: tự viết, chưa ảo hóa" của [ADR-009](009-studio-ui-stack.md); các phần khác của ADR-009 giữ nguyên. Chưa thử bộ gõ trên Windows.
- **Ngày:** 2026-10-11
- **Liên quan:** [specs/006-tags-modbus](../../specs/006-tags-modbus/plan.md), research R21, R22; [studio-ux.md](../architecture/studio-ux.md) §5; [004-acceptance](../reports/004-acceptance.md) §3; Constitution VII.

## Bối cảnh

Điều kiện xem xét lại của ADR-009 đã tới: GĐ 2 cần lưới ≥ 2.000 dòng, chọn vùng nhiều ô, dán từ Excel, nhập/xuất CSV (FR-045, FR-046, SC-012).

004 còn một hạn chế: với Telex có sẵn của Windows (TSF), phím đầu không vào chế độ sửa ô, phải nhấn F2 trước. Nguyên nhân: focus nằm ở bảng (`aria-activedescendant`), không ở một phần tử nhập liệu. Phím đầu của bộ gõ tới dưới dạng `key = "Process"` (keyCode 229), và không có chỗ để bộ gõ ghép chữ. Unikey không bị, vì Unikey gửi phím thật. Spec 006 yêu cầu gõ thẳng qua bộ gõ, 20/20 lần (SC-013). Người dùng từ chối giao diện dạng form cơ bản; chuẩn là TIA Portal.

## Các phương án

| Thư viện (bản ≥ 2 tuần tuổi, tra ngày 2026-10-11) | License | Nhận xét |
|---|---|---|
| Handsontable 18.1.1 | riêng: chỉ miễn phí phi thương mại | **loại: license**. Có tùy chọn `imeFastEdit` chính vì vấn đề bộ gõ |
| AG Grid Community 36.2.0 | MIT | chọn vùng và dán clipboard thuộc bản Enterprise (thương mại); gói khoảng 21 MB |
| RevoGrid 4.28.1 | MIT | runtime Stencil; chưa rõ phím đầu với bộ gõ; khó dùng chung `grid-model` và theme của 004 |
| Tabulator 6.5.3 | MIT | mô hình DOM riêng; trợ năng, bộ gõ chưa rõ |
| @tanstack/virtual-core 3.17.11 | MIT | chỉ ảo hóa; dòng cao cố định không cần |
| @lit-labs/virtualizer 2.1.1 | BSD-3-Clause | cho danh sách; lưới 2 chiều phải làm thêm |
| **Tự viết trên Lit** | | dòng cao cố định; logic đã có ở `grid-model.ts` |

## Quyết định

1. **Lưới `mat-grid` tự viết trên Lit:**
   - dòng cao cố định, chỉ vẽ các dòng trong khung nhìn cộng 10 dòng đệm; không ảo hóa cột;
   - ARIA `grid` với `aria-rowcount`/`aria-rowindex`;
   - logic TS thuần mở rộng từ `grid-model.ts`: chọn vùng, sửa, điền, kéo điền, dán TSV, CSV, thêm hàng loạt, hoàn tác theo lô; có test Vitest;
   - dùng chung cho Bảng Tag, Bảng giá trị, Bảng theo dõi.
2. **Một `textarea` luôn giữ focus khi lưới được focus**, nằm đúng trên ô đang chọn:
   - ở chế độ di chuyển: rỗng, trong suốt;
   - `compositionstart`, hoặc `beforeinput`/`input` có chữ: vào chế độ sửa **ngay trên chính phần tử đó**, không dời focus, không gán lại nội dung;
   - phím `Process` không bao giờ bị chặn; Enter, Tab, mũi tên khi đang ghép chữ thuộc về bộ gõ;
   - Esc khi đang ghép: hủy sửa sau `compositionend`;
   - sao chép, dán qua sự kiện clipboard của chính phần tử đó;
   - ô danh sách chọn dùng cùng phần tử làm ô lọc (combobox).
3. **Kiểm project trong Web Worker** để gõ không bị trễ với 2.000 Tag và 500 biểu thức.
4. **Ô biểu thức:** `textarea` phủ lên lớp tô màu; không dùng `contenteditable` hay editor code đầy đủ.
5. **Kiểm chứng:**
   - e2e Chrome headless đo SC-012;
   - thử tay trên WebView2 với Telex có sẵn và Unikey (SC-013) trước khi làm lưới thật, bằng bản thử trong mockup;
   - axe-core 0 lỗi critical/serious.

## Hệ quả

- **Tốt:**
  - Sửa đúng gốc của hạn chế bộ gõ ở mọi lưới và ô biểu thức.
  - Không thêm phụ thuộc, không có vấn đề license.
  - Giữ theme, ARIA, phím tắt và test của 004.
- **Xấu:**
  - Tự giữ mã lưới (chọn vùng, clipboard, CSV, ảo hóa).
  - Hành vi bộ gõ chỉ kiểm được bằng tay trên Windows thật, không tự động hóa hoàn toàn được.
  - Không có cột ảo hóa: > khoảng 40 cột thì cần xem lại.

## Số đo / bằng chứng

- Phiên bản, license, kích thước gói tra bằng `npm view` ngày 2026-10-11 (bảng trên).
- 004: lưới 500 dòng tự viết, di chuyển 14 ms, gõ khoảng 11 ms mỗi phím ([ADR-009](009-studio-ui-stack.md)).
- **Chưa đo:** SC-012 với 2.000 dòng; SC-013 (cần người gõ trên Windows).

## Điều kiện xem xét lại

- Bản thử bộ gõ không đạt 20/20 với Telex TSF trên WebView2: xét lại cách giữ focus, hoặc thư viện có hỗ trợ bộ gõ đã kiểm chứng (license phải phù hợp).
- Cần > 2.000 dòng, dòng cao thay đổi, hay > 40 cột.
- GĐ 3a cần lưới trong widget của trang runtime: tách `mat-grid` ra `packages/ui-components`.
