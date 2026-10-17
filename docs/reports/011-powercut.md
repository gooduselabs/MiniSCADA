# Mất điện và toàn vẹn dữ liệu, feature 011 (T087: khung)

**Trạng thái: khung, chưa đo.** Lập 2026-10-17 trên nhánh `gd6` (commit `c86ebe85`). Tiền kiểm x64 100 vòng (T077) chưa chạy; cắt điện thật trên BL335 (T083–T085, T123) cần bộ điều khiển nguồn và người ở cạnh.

Quy trình và ngưỡng: [contracts/test-protocols.md](../../specs/011-pilot-hardening/contracts/test-protocols.md) §4; FR-040 đến FR-043; SC-014, SC-021, SC-023, SC-026.

## 1. Công cụ (đã có)

| Công cụ | Tình trạng |
|---|---|
| `tools/powercut/powercut.mjs` (Tasmota HTTP, rơ-le USB LCUS-1, chế độ tay; chu trình 6 bước; đối chiếu `requestId` với `--export-audit`) | test với thiết bị giả (`powercut.test.mjs`); mẫu nhận sự kiện D1–D5 là phỏng đoán, thay được bằng `--event-pattern`; chưa chạy |
| `tools/powercut/x64-kill.ps1` (`docker kill -s KILL`, 100 vòng ngẫu nhiên và theo điểm) | parse sạch bằng pwsh; chưa chạy |
| `mat-runtime --check-data` (chỉ đọc, mã 0/1/2) | ctest 13/13, armhf qemu 13/13; 500 MiB 0,79 s x64; BL335 chưa đo |

## 2. Tiêu chí

| Tiêu chí | Ngưỡng | x64 (`kill -9`) | BL335 (cắt điện) | Trạng thái |
|---|---|---|---|---|
| Vòng ngẫu nhiên phục vụ lại | 100/100 ≤ 90 s | Chưa đo | Chưa đo | Chưa đo — T077 · Chờ người T084 (B4) |
| `--check-data` | mã 0 ở 100 % (mã 1 chỉ khi có mục `pulse.journal` hoặc `-wal` cần phục hồi) | Chưa đo | Chưa đo | Chưa đo |
| Lệnh `ACCEPTED` thiếu audit | 0 | Chưa đo | Chưa đo | Chưa đo |
| D1 nạp xuống (≥ 10) | bản cũ hoặc mới hoàn chỉnh, `staging/` rỗng | Chưa đo | Chưa đo | Chưa đo — T077 · Chờ người T085 |
| D2 OTA S4–S7 (≥ 5 mỗi bước) | không `/opt` nửa vời | **Đạt (lab, kill tiến trình)**: `update-it kill` 40/40 (S1–S8 × 5; 30 về bản cũ, 10 lên bản mới; `011-update-x64.json`) | Chưa đo | Chờ người — cắt điện thật T123 (B4, B9) |
| D3 ghi lịch sử dày (≥ 10) | `integrity_check` ok, mất tối đa một chu kỳ gom | Chưa đo | Chưa đo | Chưa đo — T077 · Chờ người T085 |
| D4 xung (≥ 10) | bit nhả khi kênh nối lại, audit `pulse-recovery` | **Đạt (x64, kill tiến trình)**: 20/20 vòng `kill -9` giữa xung, nhả ~7,2 s sau kill (`011-pulse-x64.json`) | Chưa đo | Chờ người — T085 |
| D5 logic (≥ 10) | counter/totalizer/giờ chạy mất ≤ một `flushS`, không giảm | Chưa đo (`logic-it retain-kill` 100 vòng, T146) | Chưa đo | Chưa đo — T146 · Chờ người T149 |

## 3. Hạn chế của tiền kiểm x64

`docker kill -s KILL` chỉ giết tiến trình: page cache của kernel vẫn còn, nên không mô phỏng mất dữ liệu đã `write` nhưng chưa `fsync` ở tầng đĩa, cũng không mô phỏng eMMC ngắt giữa lần ghi trang. Số x64 chỉ chứng minh thứ tự ghi và phục hồi ở tầng ứng dụng; kết luận SC-014 cần lượt BL335. `fiu`/`dm-flakey` chưa dùng (không bắt buộc).

## 4. Số đo khác đã có

- `persist()` ngoài mutex (FR-023): fsync giả 500 ms vẫn `committed`, `GET projects/active` p99 6 ms; ENOSPC → `PERSIST_FAILED` trước kích hoạt (`011-persist-x64.json`).
- Rà soát T062 đã sửa các ca toàn vẹn khi khởi động: nhật ký xung sai kiểu không còn làm `std::terminate` (LG1), `logic-state.json` hỏng giữ lệnh dừng ghi (LG4), `check-data` không báo hỏng giả khi runtime đang ghi (LG12) (`011-security-review.md` §3).
- BL335: thiết bị có lần khởi động lại không qua tắt máy sạch (2026-10-16, nghi mất điện hoặc watchdog phần cứng) khi chạy runtime 0.5.0; sau đó runtime lên lại và project đúng. Không phải phép đo có kiểm soát, không tính vào SC-014.

## 5. Kết luận

Chưa kết luận. Cập nhật sau T077 (x64), T083–T085, T123 (BL335, cần bộ điều khiển nguồn và người ở cạnh) và T146, T149 (logic).
