# Báo cáo nghiệm thu feature 009 (alarm ISA-18.2)

Mỗi phần do task tương ứng ghi vào. Phần dưới là "Nền" (T022, Checkpoint Foundational), chạy 2026-10-15.

## Nền (Phase 2, T002, T010 đến T022)

| Kiểm tra | Kết quả |
|---|---|
| `npm test -w @mat/project-schema` | 25 tệp, 1931 test xanh (gồm 165 ca `v05-*`, 15 cặp migration 0.4 đến 0.5, meta-schema với `schemas/0.3` đóng băng) |
| ctest/gtest `project_validator_test` (x64, Docker `w4-x64-f`) | 994 test xanh: cả 165 ca `v05-*` cùng mã và vị trí với TS, `files()` của ca hợp lệ |
| `alarm_rules_test` | 9 xanh |
| `audit_log_test`, `tag_write_audit_test`, `audit_alarm_actions_test` | 37, 17, 7 xanh (33 hành động, lược đồ `audit.db` không đổi) |
| `startup_test` (StartupDigest.\*) | 4 xanh (digest C++ khớp vector v05 hợp lệ) |
| `node --test tools/alarm-demo/*.test.mjs`, `tools/renumber-alarm-format.test.mjs` | 4 và 4 xanh |
| `node --test tools/*/*.test.mjs` | 51/52: một ca đỏ của agent khác, `tools/dashboard-demo` "thiếu loại alarm-list" (danh mục widget đã thêm `alarm-list` mà `dashboard-demo` chưa dùng; không thuộc nền) |
| `ci-local.ps1` | chưa chạy (gom lô; phiên chính làm một lượt đầy đủ ở cuối) |

Lệch so với contract: xem "Ghi chú khi làm" của T011, T012, T014 trong `specs/009-alarms/tasks.md` (0.4 tối thiểu, chưa có ca widget `alarm-list`, `schemas/0.4/` do 008 tạo khi gộp).
