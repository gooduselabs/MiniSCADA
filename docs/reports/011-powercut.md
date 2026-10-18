# Mất điện và toàn vẹn dữ liệu, feature 011 (T087: khung)

**Trạng thái: tiền kiểm x64 xong (T077, 2026-10-17, nhánh `gd6-docker-runs`; D3, D4 chạy lại 2026-10-18, nhánh `gd6-x64-final`), BL335 chưa đo.** Khung lập 2026-10-17 trên `gd6` (commit `c86ebe85`). Tiền kiểm x64: 130/130 vòng đạt (100 ngẫu nhiên + D1, D3, D5 × 10), rồi D3 và D4 × 10 với rig đã sửa 20/20 đạt, trên Docker `mat-armhf` Linux arm64 của máy Mac Apple Silicon (không phải x64 thật). Cắt điện thật trên BL335 (T083–T085, T123) cần bộ điều khiển nguồn và người ở cạnh.

Quy trình và ngưỡng: [contracts/test-protocols.md](../../specs/011-pilot-hardening/contracts/test-protocols.md) §4; FR-040 đến FR-043; SC-014, SC-021, SC-023, SC-026.

## 1. Công cụ (đã có)

| Công cụ | Tình trạng |
|---|---|
| `tools/powercut/powercut.mjs` (Tasmota HTTP, rơ-le USB LCUS-1, chế độ tay; chu trình 6 bước; đối chiếu `requestId` với `--export-audit`) | test với thiết bị giả (`powercut.test.mjs`); mẫu nhận sự kiện D1–D5 là phỏng đoán, thay được bằng `--event-pattern`; chưa chạy |
| `tools/powercut/x64-kill.ps1` (`docker kill -s KILL`, 100 vòng ngẫu nhiên và theo điểm) | đã sửa 3 lỗi khiến nó không chạy đúng được (`--export-audit --json` không phải tùy chọn: mọi requestId sẽ báo thiếu; D1 tìm `ops/` sai chỗ và khớp cả thao tác đã xong; bước `restart` không tồn tại); chưa chạy lại bằng pwsh (phiên này không có pwsh) |
| `tools/powercut/x64-kill.mjs` + `x64-run.mjs` (bản Node cùng ngữ nghĩa; rig container riêng `mat-powercut-x64`, bộ sinh lệnh ghi và vòng nạp xuống) | **đã chạy** T077: 130/130 (`011-powercut-x64.json`, từng vòng ở `011-powercut-x64.rounds.jsonl`); 2026-10-18 thêm giả lập Modbus + Tag xung cho D4, D3 đếm khung WAL của thế hệ hiện tại: D3, D4 20/20 (khóa `rerunD3D4`) |
| `mat-runtime --check-data` (chỉ đọc, mã 0/1/2) | ctest 13/13, armhf qemu 13/13; 500 MiB 0,79 s x64; BL335 chưa đo |

## 2. Tiêu chí

| Tiêu chí | Ngưỡng | x64 (`kill -9`) | BL335 (cắt điện) | Trạng thái |
|---|---|---|---|---|
| Vòng ngẫu nhiên phục vụ lại | 100/100 ≤ 90 s | **Đạt**: 100/100; READY sau trung vị 514 ms, tối đa 12,1 s (kể cả vòng D) | Chưa đo | Đạt x64 · Chờ người T084 (B4) |
| `--check-data` | mã 0 ở 100 % (mã 1 chỉ khi có mục `pulse.journal` hoặc `-wal` cần phục hồi) | **Đạt**: 130/130 mã 1 chỉ vì `history.db`, `audit.db` có WAL chưa checkpoint (được chấp nhận); 0 `damaged`; kiểm sau khi không còn thao tác nạp xuống dở (chờ tối đa 4,7 s) | Chưa đo | Đạt x64 |
| Lệnh `ACCEPTED` thiếu audit | 0 | **Đạt**: 0 thiếu ở 130/130 vòng; 1.781 lệnh ACCEPTED (ghi CMD.SP mỗi 3 s), mọi requestId có trong `--export-audit --format jsonl` | Chưa đo | Đạt x64 |
| D1 nạp xuống (≥ 10) | bản cũ hoặc mới hoàn chỉnh, `staging/` rỗng | **Đạt**: 10/10 (thấy thao tác ở bước `activate`, giết sau 0,13–2,5 s; project `ok`, digest khớp; 66 lần nạp xuống trong lượt). `staging/` không kiểm riêng (`--check-data` không báo) | Chưa đo | Đạt x64 · Chờ người T085 |
| D2 OTA S4–S7 (≥ 5 mỗi bước) | không `/opt` nửa vời | **Đạt (lab, kill tiến trình)**: `update-it kill` 40/40 (S1–S8 × 5; 30 về bản cũ, 10 lên bản mới; `011-update-x64.json`) | Chưa đo | Chờ người — cắt điện thật T123 (B4, B9) |
| D3 ghi lịch sử dày (≥ 10) | `integrity_check` ok, mất tối đa một chu kỳ gom | **Đạt** (2026-10-18, `rerunD3D4`): 10/10 cắt khi WAL hiện tại có 973–1.006 khung (> 4.000.000 byte, checkpoint tự động ở 1.000 trang); sau khi lên lại `PRAGMA integrity_check` ok 10/10; dòng lịch sử mới nhất trước lúc cắt cách lúc cắt trung vị 1,3 s, tối đa 3,7 s (chu kỳ commit 5 s, ngưỡng rig 8 s = commit + `minIntervalMs` 1 s + 2 s). Lượt 2026-10-17 chỉ đạt một phần (cắt theo kích thước tệp, xem §3) | Chưa đo | Đạt x64 · Chờ người T085 |
| D4 xung (≥ 10) | bit nhả khi kênh nối lại, audit `pulse-recovery` | **Đạt (x64)**: trong rig powercut (2026-10-18, `rerunD3D4`) 10/10 vòng `docker kill` khi `pulse.journal` có mục `arm` chưa `done` và coil đang 1: sau khi lên lại coil về 0 sau READY trung vị 5,1 s (tối đa 5,1 s), 10/10 xung có audit `tag.write` `source` `pulse-recovery` `pulseOf`, 0 mục còn arm, 0 bit ON không có nhật ký. Trước đó `driver-it pulse-recovery` 20/20 (`kill -9`, `011-pulse-x64.json`) | Chưa đo | Đạt x64 · Chờ người T085 |
| D5 logic (≥ 10) | counter/totalizer/giờ chạy mất ≤ một `flushS`, không giảm | **Đạt (x64)**: `logic-it retain-kill` 100 vòng `kill -9`, mất tối đa count 6 / total 0,95 / giờ 0,0027 (≤ một `flushS` 10 s), 0 lần thấp hơn giá trị đã lưu, 0 ghi PLC trùng cạnh (`011-logic-x64.json`). Lượt powercut: 10/10 vòng D5 (kill ngay sau khi `retain/` được ghi, Tag CMD.SP) `--check-data` retain ok | Chưa đo | Đạt x64 · Chờ người T149 |

## 3. Hạn chế của tiền kiểm x64

`docker kill -s KILL` chỉ giết tiến trình: page cache của kernel vẫn còn, nên không mô phỏng mất dữ liệu đã `write` nhưng chưa `fsync` ở tầng đĩa, cũng không mô phỏng eMMC ngắt giữa lần ghi trang. Số x64 chỉ chứng minh thứ tự ghi và phục hồi ở tầng ứng dụng; kết luận SC-014 cần lượt BL335. `fiu`/`dm-flakey` chưa dùng (không bắt buộc).

### Lượt x64 (T077, 2026-10-17)

- Lệnh: `node tools/powercut/x64-run.mjs --rounds 100 --point-rounds 10 --points D1,D3,D5 --stable-s 10 --max-delay-s 60 --event-timeout-s 900` (build Release của mã runtime `gd6` 405e900e, nhánh này không đổi mã runtime). Container `mat-powercut-x64` chạy runtime dưới `supervise.sh`, project soak-standard (500 Tag, lưu 200 Tag theo thay đổi) + Tag nội bộ giữ qua mất điện CMD.SP; operator ghi CMD.SP mỗi 3 s; engineer nạp xuống bản mới mỗi 45 s (D1). 15:42–17:30 UTC, 130/130 vòng đạt.
- Rút gọn so với giao thức để vừa thời gian: ổn định 10 s trước mỗi lần cắt (giao thức 60 s), thời điểm cắt ngẫu nhiên trong 0–60 s (giao thức 0–300 s).
- D4 (xung) không chạy trong lượt này (rig chưa có PLC Modbus); xem lượt 2026-10-18 dưới.

### Lượt x64 D3, D4 (T077, 2026-10-18, nhánh `gd6-x64-final`)

- Lệnh: `node tools/powercut/x64-run.mjs --rounds 0 --point-rounds 10 --points D3,D4 --stable-s 10 --event-timeout-s 900 --wal-bytes 4000000` (build Release của `gd6` 9895c7c3, không đổi mã runtime). 10:20–11:18 UTC, **20/20 đạt**, READY sau tối đa 523 ms; `--check-data` mã 1 chỉ vì WAL chưa checkpoint và `pulse.journal` (được chấp nhận); 0 lệnh ACCEPTED thiếu audit (1.060 lệnh CMD.SP + 616 xung). Kết quả: `011-powercut-x64.json` khóa `rerunD3D4`.
- Sửa rig D3: lượt trước cắt khi tệp `history.db-wal` > 3 MiB, nhưng tệp giữ 4.190.072 byte sau checkpoint đầu (`journal_size_limit` 64 MiB của `local_store.cpp`; SQLite ghi lại từ đầu tệp) nên điều kiện luôn đúng và mỗi vòng cắt ở mức đầy ngẫu nhiên. Nay `x64-kill.mjs` đếm khung của thế hệ WAL hiện tại (salt ở header lặp lại trong header mỗi khung; tìm nhị phân bằng `od` trong container) và cắt khi > 4.000.000 byte như giao thức; sau khi lên lại chạy `integrity_check` và đo khoảng cách từ dòng lịch sử mới nhất trước lúc cắt (python3 trong container). Không phải lỗi runtime: WAL giữ kích thước dưới `journal_size_limit` là hành vi của SQLite.
- Thêm D4: container giả lập Modbus `mat-powercut-x64-sim` (tools/modbus-sim) trên mạng riêng, project thêm kênh tới nó và Tag ngoài `PULSE.CMD` (coil 20 unit 1); operator gửi xung 3 s mỗi 5 s. Điểm cắt là "`pulse.journal` có `arm` chưa `done`" (tệp không rỗng không đủ: dòng `done` còn tới lúc compact). Kiểm sau khi lên lại: coil về 0 trong 20 s, audit `pulse-recovery` cho mọi `rid` đang arm lúc cắt, không còn mục arm.
- Hạn chế riêng: 100 vòng ngẫu nhiên và D1, D5 là lượt 2026-10-17 (rig chưa có xung); D2 lấy từ `update-it kill` 40/40 (S1–S8 × 5, đủ "≥ 5 mỗi bước" của giao thức), không qua `x64-kill`.
- Lượt đầu dừng ở vòng 84/130 (83 đạt): `--check-data` báo `project` "có thao tác dở (activating)". Nguyên nhân là rig: vòng nạp xuống của bộ sinh lệnh bắt đầu một lần nạp mới ngay sau khi runtime lên lại, trùng lúc kiểm. Đã sửa rig (bộ sinh lệnh dừng nạp xuống trong lúc kiểm một vòng, `--check-data` chạy khi `state.json` không còn `pending` và không còn thao tác "running"), rồi chạy lại toàn bộ 130 vòng. Không phải lỗi runtime.

## 4. Số đo khác đã có

- `persist()` ngoài mutex (FR-023): fsync giả 500 ms vẫn `committed`, `GET projects/active` p99 6 ms; ENOSPC → `PERSIST_FAILED` trước kích hoạt (`011-persist-x64.json`).
- Rà soát T062 đã sửa các ca toàn vẹn khi khởi động: nhật ký xung sai kiểu không còn làm `std::terminate` (LG1), `logic-state.json` hỏng giữ lệnh dừng ghi (LG4), `check-data` không báo hỏng giả khi runtime đang ghi (LG12) (`011-security-review.md` §3).
- BL335: thiết bị có lần khởi động lại không qua tắt máy sạch (2026-10-16, nghi mất điện hoặc watchdog phần cứng) khi chạy runtime 0.5.0; sau đó runtime lên lại và project đúng. Không phải phép đo có kiểm soát, không tính vào SC-014.

## 5. Kết luận

Tiền kiểm x64 đạt (T077: 130/130 ngày 2026-10-17, D3 và D4 × 10 với rig đã sửa 20/20 ngày 2026-10-18, D2 qua `update-it kill` 40/40; logic D5 qua T146 100/100), với hạn chế của §3 (không mô phỏng mất page cache; Docker Linux arm64 trên Apple Silicon, không phải x64 thật). Kết luận SC-014 vẫn chờ T083–T085, T123 (BL335, cần bộ điều khiển nguồn và người ở cạnh) và T149 (logic trên thiết bị).
