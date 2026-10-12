# Specification Quality Checklist: Tag v1, Modbus TCP/RTU, Tag tính toán và ghi Tag có kiểm soát

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-11
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

- Spec giữ một số chi tiết kỹ thuật vì giao thức, Constitution hoặc quyết định đã chốt đòi hỏi:
  - của giao thức Modbus: mã hàm, mã exception, CRC, giới hạn 125 thanh ghi và 2.000 bit, 4 thứ tự byte/word;
  - chuỗi trên Modbus mã hóa UTF-8; số trong biểu thức là số thực 64 bit, để hai bản cho cùng kết quả (Constitution II);
  - HTTPS, đăng nhập, role, audit theo 005 (Constitution V);
  - D2 và D4 nhắc token Bearer, `auth_gate`, C++ và TS vì phiên chính chốt như vậy; đây là bản ghi quyết định, không phải yêu cầu chức năng.

  Định dạng file, API thiết bị, cú pháp địa chỉ chi tiết, thư viện lưới, cách lưu Tag giữ qua mất điện để cho plan và ADR (driver SDK, ngôn ngữ biểu thức, mở lại ADR-009).
- Không có [NEEDS CLARIFICATION]. Quyết định đã chốt trước (D1–D9) và quyết định khi viết spec (D10–D32) nằm ở mục Assumptions, mỗi điểm có lý do.
- Phạm vi: 6 user story (P1: US1, US2; P2: US3, US4; P3: US5, US6), 60 FR, 21 SC. Nền chung (định dạng 0.2.0, Tag Engine v1, driver SDK) được nghiệm thu qua US1 kịch bản 1–2, FR-001…FR-008, SC-009.
- **Lần kiểm 1 (2026-10-11):** chưa đạt hai mục "Requirements are testable and unambiguous" và "All functional requirements have clear acceptance criteria":
  - từ mơ hồ: FR-031 "lý do dễ hiểu", FR-035 "báo lỗi rõ", FR-045 "mượt", FR-037 "kết nối tốt";
  - SC-004 đo "≥ 99 %" trong khi FR-019 là MUST;
  - Thử kết nối dùng "thời gian chờ" mà không nói là chờ kết nối hay chờ trả lời;
  - FR-025 và FR-026 chồng nhau ở exception 02/03; FR-027 chưa nói trả lời exception có tính là hỏng hay không;
  - thiếu edge case "đổi project khi đang ghi" và "hết thời gian chờ";
  - FR-045 (thêm hàng loạt, dán, gõ qua bộ gõ) và FR-047 (đổi tên Tag) chưa có kịch bản nghiệm thu;
  - một gạch đầu dòng ở Assumptions bắt đầu bằng mã SC-019, trông như SC trùng.
- **Lần kiểm 2 (2026-10-11):** đã sửa mọi điểm trên; đạt mọi mục.
- **Cần phiên chính xem lại trước plan:**
  - D15, D16 mở rộng ý nghĩa kết quả ghi đã chốt ở D8: `CONFIRMED` theo phản hồi của thiết bị trường với Tag lệnh xung; `FAILED` gồm cả "không gửi được" và "đọc lại khác"; `TIMEOUT` gồm cả "đọc lại không có trả lời";
  - FR-041: mức giới hạn tần suất ghi có thể phải hạ sau khi đo ghi eMMC trên BL335 (SC-011);
  - D21, D22, D25 đưa thêm vào định dạng 0.2.0: cấu hình mô phỏng trong Tag, bảng theo dõi trong project, binding tham chiếu bảng giá trị;
  - D23: project 0.1 không nâng cấp thì chỉ mở chỉ đọc trong Studio mới;
  - D7: các bước trên BL335 (kiểm RS485, đo SC-002, SC-003, SC-004, SC-010, SC-011) chờ người dùng cho phép SSH.
