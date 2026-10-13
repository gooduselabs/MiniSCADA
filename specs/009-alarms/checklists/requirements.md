# Specification Quality Checklist: Alarm (cảnh báo) theo ISA-18.2

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

- Spec giữ một số chi tiết kỹ thuật vì Constitution, lộ trình hoặc quyết định đã chốt đòi hỏi, như 006 và 007:
  - tên hành động audit (`alarm.ack`, …), tên endpoint, mã kết quả (`ACKED`, `STALE`, …), tên bản tin live (`subscribeAlarms`, `alarmSnapshot`, `alarmDelta`), tên file project (`alarms.json`, `alarm-classes.json`), tên file DB (`alarm.db`): là hợp đồng mà test và tài liệu phải nêu (FR-045 đến FR-054, FR-089);
  - `synchronous=NORMAL`, `FULL`, `WAL`: Constitution quy định ràng buộc công nghệ SQLite; spec nêu để chứng minh không xin ngoại lệ thứ ba (D13);
  - Web Audio, `prefers-reduced-motion`, `localStorage`: chọn vì Chrome ≥ 120 chặn tiếng tự phát và để tôn trọng khả dụng (D23, D25), không phải cách cài.
  Chi tiết lược đồ, thuật toán, hình dạng bản tin để cho plan, research và ADR 027 đến 030.
- Không có [NEEDS CLARIFICATION]. Quyết định đã chốt trước (D1 đến D5) và quyết định khi viết spec (D6 đến D47) nằm ở mục Assumptions, mỗi điểm có lý do.
- Phạm vi: 6 user story (P1: US1, US2, US3; P2: US4, US5; P3: US6), 100 FR, 24 SC. Ngoài phạm vi nêu rõ: thông báo ngoài, recipe, quản lý thay đổi alarm đầy đủ, xác nhận từ Studio, lưu alarm sang DB ngoài.
- **Lần kiểm 1 (2026-10-13), mọi mục đạt sau khi rà từng mục:**
  - *Testable and unambiguous:* mỗi FR dùng MUST kèm điều kiện kiểm được; các con số (≤ 1 s, ≤ 500 ms, 200 và 500 alarm, 5 lần/60 s, 8 giờ, 100.000 dòng) đều có chỗ đo trong SC. Điểm duy nhất cần lưu ý: FR-021 (≤ 2 ms mỗi tick) là ước tính, spec ghi rõ "đo ở SC-011".
  - *Technology-agnostic SC:* SC-003 đến SC-011 đo kết quả người dùng thấy hoặc tài nguyên thiết bị (độ trễ trên Chrome, CPU, RSS, byte ghi, số lần mất điện); SC-004, SC-017 nhắc "hai bản động cơ" vì Constitution II đòi bộ vector chung, là yêu cầu của nguyên tắc, không phải cách cài.
  - *Edge cases:* phủ định nghĩa (ngưỡng, kiểu Tag, giới hạn), đánh giá (NaN, nhảy qua hai ngưỡng, xác nhận đua), lưu trữ (đĩa đầy, hỏng, đồng hồ), giao thức (đứt `sequence`, hàng đợi đầy), Studio (dán 500 dòng, Online).
  - *Scope bounded:* mục "Ngoài phạm vi" khớp §4.5 và §4.7 của lộ trình; D31, D32 ghi các thứ cố ý không làm.
  - *Dependencies:* mục "Giả định và phụ thuộc" liệt kê 003, 005, 006, 007 và các điều kiện thiết bị (RTC, SSH).
- Rủi ro đã nhận biết, xử lý ở plan: số phiên bản và định dạng đã giải (D28, D29: 0.5.0 vì 3b dùng 0.4.0; phụ thuộc specs/008), còn rủi ro hai feature cùng sửa file chung; tương đương hai bản động cơ; đo trên BL335 và cắt điện thật cần người.
