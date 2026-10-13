# Specification Quality Checklist: Hoàn thiện và pilot, trình vẽ SVG đầy đủ, logic v2

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-13
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Spec giữ một số chi tiết kỹ thuật vì Constitution, lộ trình hoặc quyết định đã chốt đòi hỏi:
  - bảo mật và cập nhật: tên thuật toán chữ ký (ECDSA P-256, SHA-256), Authenticode, mã lỗi (421 `HOST_NOT_ALLOWED`, `UPDATE_*`), tên khóa `runtime.json`: là hợp đồng kiểm bằng test và tài liệu, không phải cách cài;
  - tên khối logic, hành động, mã `E_LOGIC_*`, `logic.json`: hợp đồng định dạng mà vector và tài liệu phải nêu;
  - ngưỡng số của pilot (99,9 %, 2 GB/ngày, 5 năm, 500 ms): từ Master Plan §6, §14.5, Constitution III và D29, D30;
  - D5 đến D7 nhắc OTA, `signtool`, ECDSA vì phiên chính chốt phương án (bản ghi quyết định, không phải yêu cầu chức năng).

  Chi tiết định dạng gói, phong bì, ngữ nghĩa engine, thuật toán bắt dính, quy trình đo để cho plan, contracts và ADR (035 đến 038).
- Không có [NEEDS CLARIFICATION]. Quyết định đã chốt trước (D1 đến D4) và quyết định khi viết spec (D5 đến D38) nằm ở mục Assumptions, mỗi điểm có lý do.
- Phạm vi: 9 user story (P1: US1, US2, US3, US8, US9; P2: US4, US5, US6; P3: US7), 143 FR, 43 SC. Nền chung (định dạng 1.0.0, quy tắc tập tệp, `runtime.json`, chẩn đoán) được nghiệm thu qua FR-001 đến FR-010, FR-024.
- Mục cần người, khách hàng hoặc mạng (⚠️🔌, 🌐) ghi rõ ở Assumptions ("Cần người, khách hàng, mạng") và gom ở `docs/pilot/customer-checklist.md` (T184): SSH BL335, 7 ngày thiết bị, bộ điều khiển nguồn, datasheet eMMC, chứng chỉ ký mã thật, máy Windows sạch, site pilot và PLC thật, người thử, Internet cho `cargo audit`/`npm audit`.
- **Lần kiểm 1 (2026-10-13):** chưa đạt mục "Requirements are testable and unambiguous":
  - FR-015 thiếu cửa sổ thời gian cho khóa IP (20 lần sai trong bao lâu);
  - FR-139 chỉ nêu 8 tiêu chí ra trong khi contract test-protocols §5 có 11 (X1 đến X11): lệch nhau ở chức năng và ngân sách;
  - Edge case về `kind: keyset` của gói cập nhật chưa có bước xử lý trong quy trình 8 bước.
- **Lần kiểm 2 (2026-10-13):** đã sửa: FR-015 nêu cửa sổ 10 phút (khớp contract device-api §2); FR-139 thêm (9) chức năng và (10) ngân sách và ghi ánh xạ tới X1 đến X11; contract update-package §4 thêm nhánh `kind: keyset`. Đạt mọi mục.
- **Phát hiện chồng chéo với feature 008 (2026-10-13):** mockup `studio-svg.html`, package `svg-doc`, kiểu `SvgDoc`, lệnh "Vào đồ họa" đã dùng ở 008; 011 đổi sang `studio-svg-draw.html`, `@mat/svg-edit`, `DrawDoc` và lệnh "Sửa trong trình vẽ" (contracts/svg-editor.md §0).
- **Cần phiên chính xem lại trước khi làm:**
  - D5 và D22: OTA và ghi PLC từ logic cần Constitution PATCH 2.0.2 (T004); không viết mã runtime của hai việc này trước đó;
  - D2: 1.0.0 chỉ gắn sau Go/No-Go; bản dựng là `1.0.0-rc.N`;
  - D8 và D9: đổi hành vi xác thực và kiểm `Host` (khách dùng tên miền nội bộ phải khai `allowedHosts`);
  - D14, D13: cắt điện 100 lần cần bộ điều khiển nguồn do người cung cấp;
  - D4: mọi bước trên BL335 chờ SSH và người.
