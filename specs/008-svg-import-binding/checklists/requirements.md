# Specification Quality Checklist: Nhập SVG, gắn Tag cho phần tử SVG, animation và sự kiện

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
  - an toàn SVG: "allowlist trên DOM đã parse, không regex", giới hạn 5 MB / 20.000 node / độ sâu 32, tên thuộc tính `data-mat-uid` (Constitution V, roadmap §4.4, ADR-003); đây là yêu cầu kiểm được bằng test, không phải cách cài;
  - tên đích binding (`geometry.clipLevel`, `effect.blink`, `effect.flow`…), `rangeMap`, `events`, mã lỗi (`E_EVENT_*`, `E_BIND_*`): là hợp đồng định dạng mà validator hai bản, test và tài liệu phải nêu (FR-002, FR-003, FR-053);
  - D6, D11, D12, D14, D18 nhắc cơ chế (CSS tự viết, Web Animations, `clipPath`): bản ghi quyết định của phiên chính, không phải yêu cầu chức năng; yêu cầu chức năng nằm ở FR-032…FR-041.

  Chi tiết định dạng file, thuật toán đối chiếu, giao diện `ControlController`, bố cục hộp thoại để cho plan và ADR (023–026).
- Không có [NEEDS CLARIFICATION]. Quyết định đã chốt trước (D1–D6) và quyết định khi viết spec (D7–D40) nằm ở mục Assumptions, mỗi điểm có lý do.
- Phạm vi: 6 user story (P1: US1, US2, US3; P2: US4, US5; P3: US6), 67 FR, 22 SC. Nền chung (định dạng 0.4.0, allowlist dùng chung, `@mat/svg-import`) được nghiệm thu qua US1 kịch bản 1–6, FR-001…FR-010, FR-023 và SC-011, SC-012.
- **Giới hạn trung thực của nghiệm thu** (không phải thiếu sót của spec, nhưng phải đọc cùng SC-001): fixture Illustrator và CorelDRAW là **mô phỏng** đặc trưng cấu trúc (D23); kết quả cho hai phần mềm này là "đạt trên mô phỏng" cho tới khi có file thật.
- **Lần kiểm 1 (2026-10-13):** chưa đạt hai mục:
  - "Requirements are testable and unambiguous": FR-004 và mục Edge Cases viết "≤ 64 … cảnh báo, ≤ 256 … lỗi" (hiểu được là ≤ 64 vẫn là cảnh báo); US2 kịch bản 2 và FR-031 ghi "12 dòng" trong khi liệt kê 13 mục động hóa;
  - "No implementation details": phần US1 mô tả "ảnh xem trước trước và sau khi làm sạch" lẫn với việc dựng SVG chưa lọc (mâu thuẫn Constitution V).
- **Lần kiểm 2 (2026-10-13):** đã sửa: FR-004 và Edge Cases nói "hơn 64 là cảnh báo, hơn 256 là lỗi"; US2 kịch bản 2 và FR-031 ghi 13 dòng và liệt kê đủ; US1 nêu rõ "trước" là bản gốc đã lọc bằng allowlist. Đạt mọi mục.
- **Cần phiên chính xem lại trước khi làm** (đã trả lời ở plan, mục "Câu hỏi cho phiên chính"):
  - D7, D8, FR-001, FR-004: định dạng 0.4.0 và trần 64 item `svg` đổi D26 của 007;
  - D15, FR-050, FR-051: sự kiện SVG dùng widget ảo của `ControlController`, `context.widget` = `elementUid` (API 1.2.0 không đổi);
  - D20 và ADR-003: thêm `data-mat-name`;
  - D27: lệnh Rust mới `svg_open`;
  - D23: fixture mô phỏng;
  - D30, D31: runtime không parse SVG; không nén file project;
  - D37: các bước trên BL335 chờ SSH.
- Phối hợp: spec 009 (alarm) cũng đặt định dạng 0.4.0 và `@mat/ui-components` 0.2.0; theo thứ tự giai đoạn 008 chiếm trước, 009 đổi sang 0.5.0 và 0.3.0 (task T002 của 009 đã dự phòng).
