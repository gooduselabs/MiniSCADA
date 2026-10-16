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

## Nghiệm thu tổng hợp (T136), 2026-10-16 — TRẠNG THÁI: SẴN SÀNG MERGE, CHƯA NGHIỆM THU THIẾT BỊ

Chi tiết từng FR/SC: `docs/reports/009-fr-matrix.md`. Bảo mật: `docs/reports/009-security-review.md` (0 Critical, 0 High; M1, R1-R6 đã sửa; L1-L4 hoãn có lý do). Trợ năng: `009-a11y.md`, `009-sc016.md`.

| Hạng mục | Kết quả (x64) | Nguồn |
|---|---|---|
| Độ trễ Tag → DOM banner | p95 12/114 ms, p99 38/331 ms (trễ bật 0/3 s) | `009-latency-x64.json` |
| Độ trễ từ thanh ghi giả lập | p95 1,29 s: vượt 1 s do chu kỳ quét Modbus 1 s của driver | `009-latency-x64.json` |
| Tick `step` | tb 6 µs (500 instance), lớn nhất ~3 ms (> 2 ms ước tính BL335) | `009-tick-x64.json` |
| Ghi SQLite mô phỏng | chuẩn 21,2 MB/ngày; bão 77 MB/ngày (cửa sổ 60 s) | ADR-028 "Số đo" |
| killloop | 100/100 `integrity_check` ok, 0 ack thiếu audit | `009-killloop-x64.json` |
| Lịch sử 100.000 dòng | lọc p95 ≤ 24 ms; xuất CSV ~50.000 dòng 1,5-3,2 s | `009-history-x64.json` |
| Tấn công | 48/48 bị từ chối, 0 đổi trạng thái | `009-attack-x64.json` |
| Bão / tương thích | 0 phiên 4409; 36 kiểm compat | `009-storm-x64.json`, `009-compat-x64.json` |
| Ngân sách (tham khảo) | CPU 0,5 % (bật) vs 0,2 % (tắt), RSS 20,6 vs 17,2 MB | `009-budget-x64.json` |
| Vitest | runtime-web 351, studio 1990, alarm-engine 198, project-schema 1938 (đỏ chập chờn về timeout đã nâng 30 s), live-client 94, ui-components 587-718 | lượt chạy 2026-10-16 |
| e2e Studio | 674 đạt; 1 đỏ về thời gian (`screen-perf`, nhiễu tải), chạy riêng 6/6 | `apps/studio` e2e |
| e2e runtime-web | 231 kiểm đạt (alarm-live, history, widgets, compat, control, screens) | agent U |
| ci-local đầy đủ | CHƯA hoàn tất trên nhánh này (theo chỉ đạo: phiên chính chạy một lượt sau khi gộp). Lần chạy gần nhất đạt clang-format, armhf build/smoke/tests, deploy/rollback; x64 ctest bị dừng. | — |

**Chưa đo / chưa làm (trung thực):**
- BL335 (SSH tắt): T008, T127-T133 (độ trễ, tải 30 phút, ghi eMMC thật, truy vấn lịch sử, kill -9, cắt điện thật). ADR 027-030 ghi "Accepted trên x64", số đo thiết bị chờ.
- Người: T134 (Telex/Unikey, NVDA, âm thanh, Excel), T135 (SC-023: tự đo, chưa có người dùng thử: không có số).
- e2e Studio `alarm-editor` mới phủ mở/đếm/lớp/hộp tạo/panel thử/axe; chưa có kịch bản 200 alarm và đẩy Tag qua ngưỡng (phủ ở test đơn vị). T082 chưa có e2e với thiết bị giả. Chưa chạy lại `tools/alarm-it.ps1` sau khi nâng phiên bản (runtime x64 thử trên bản sao đổi `kRuntimeVersion`) và sau sửa M1 (kịch bản đọc `ackUser` bằng khách phải đổi sang Bearer: `tools/alarm-it/scenarios.mjs` dòng ~147, 279, 428).
- Dấu thập phân của nội dung alarm: dấu chấm (D41); `alarmCommitMaxMs` mặc định 60 s (spec 30 s) theo số đo bão.

**Rủi ro còn lại:** tick lớn nhất 3 ms trên x64 (trên BL335 chưa đo, có thể cao hơn; dự phòng: đánh giá theo thay đổi); ghi eMMC chế độ bão cần cửa sổ commit 60 s; `migrate03to04` và `schemas/0.4/` tối thiểu phải gộp với 008.
