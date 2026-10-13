# Specification Quality Checklist: Màn hình v1, widget và điều khiển từ Chrome

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
  - bảo mật web: tên và thuộc tính cookie, header CSRF, `Origin`, mã lỗi 403 (FR-039…FR-043); đây là yêu cầu bảo mật có thể kiểm bằng test, không phải cách cài;
  - tên 15 widget, 6 hành động, tên khóa `items`, `navigation`, `pulseMs`, `expect`, `context`: là hợp đồng định dạng và API mà test và tài liệu phải nêu;
  - D21 (uPlot), D22 (Lit, Shadow DOM), D23 (Pointer Events) nhắc thư viện vì phiên chính chốt như vậy; đây là bản ghi quyết định, không phải yêu cầu chức năng.

  Chi tiết định dạng file, schema, API, giao diện `TagSource`/`ActionHost`, thuật toán bắt dính để cho plan và ADR (013, 019–022).
- Không có [NEEDS CLARIFICATION]. Quyết định đã chốt trước (D1–D6) và quyết định khi viết spec (D7–D40) nằm ở mục Assumptions, mỗi điểm có lý do.
- Phạm vi: 6 user story (P1: US1, US2, US3; P2: US4, US5; P3: US6), 79 FR, 24 SC. Nền chung (định dạng 0.3.0, `ui-components`, đường dữ liệu trang runtime) được nghiệm thu qua US1 kịch bản 1–4, FR-001…FR-012, SC-011, SC-012.
- **Lần kiểm 1 (2026-10-13):** chưa đạt mục "Requirements are testable and unambiguous":
  - từ mơ hồ: "mượt" ở D26 và ở một ngoại lệ Studio (không có số); "phù hợp thiết bị nhúng" ở D32 (không có tiêu chí);
  - US1 kịch bản 14 nói "file bị sửa trên thiết bị sau khi kiểm" mà chưa nêu cách tạo điều kiện.
- **Lần kiểm 2 (2026-10-13):** đã sửa: "mượt" thay bằng tham chiếu SC-013; D32 nêu lý do cụ thể; kịch bản 14 nêu rõ file bị sửa hỏng trực tiếp trên thiết bị sau khi kích hoạt. Đạt mọi mục.
- **Cần phiên chính xem lại trước plan:**
  - D13 và FR-046, FR-047 thêm `pulseMs`, `expect`, `context` vào `POST /api/v1/tags/write` của 006 (API 1.2.0), nên đụng `core/tag-engine/write_coordinator` và audit của 006;
  - D16, D17 và FR-042, FR-043: phiên web dùng chung `SessionStore` của 005 và cookie không vào API kỹ thuật; FR-043 đổi ADR-006 điểm 7 (cookie thì bắt buộc `Origin`);
  - D18, D19: mặc định `viewerLogin: off`, không tự chuyển HTTP sang HTTPS; ADR-018 điều kiện xem xét lại được xử lý ở ADR-021;
  - D21: uPlot là thư viện ngoài duy nhất được thêm (FR-078);
  - D40: các bước trên BL335 chờ SSH.
