# Chạy lại quickstart từ đầu (T047)

Ngày 2026-10-10, 11:44–11:56, trên cùng BL335. Mục đích: xác nhận các số đo Sprint 0 **lặp lại được** và quickstart **làm theo được**. Chạy mục 1–5 của [quickstart](../../specs/001-platform-validation/quickstart.md); mục 6 (SVG) đã đo cùng ngày ([svg-load.md](svg-load.md)); mục 7 (Studio) chưa làm được (thiếu Visual Studio C++). Dữ liệu thô của lần 2 nằm ngoài repo; bảng dưới là số tổng hợp, so với lần 1 trong [baseline.csv](baseline.csv), [poc-civetweb.csv](poc-civetweb.csv), [poc-civetweb.json](poc-civetweb.json), [slot-release.txt](slot-release.txt).

## Kết luận

**Lặp lại được.** Mọi tiêu chí cho cùng kết luận như lần 1, chênh lệch nhỏ (CPU PoC trung bình 9,05% so với 7,98%; RSS 2,3 MB so với 2,1 MB). Lần chạy này cũng ghi được bằng chứng trực tiếp cho `hello-armhf` (T013), trước đây còn thiếu. Quickstart có **3 chỗ sai/thiếu** so với lệnh thật, đã sửa (xem cuối báo cáo).

## So sánh

**1. Hồ sơ thiết bị** — không đổi: Linux 5.4.61 armv7l, Ubuntu 20.04.5, glibc 2.31, RAM 993 MB (used 66 MB cả hai lần). Khác biệt duy nhất: rootfs dùng 749 MB so với 719 MB; nhiệt độ 31,8 °C so với 31,7 °C.

**2. Binary C++17 trên thiết bị (SC-001)**

```
mAT hello-armhf: C++ standard 201703, machine=armv7l, kernel=5.4.61
exit=0
```

Build armhf từ đầu trong container cũng thành công (binary `mat-poc` 161.348 B, `ELF 32-bit LSB … ARM, EABI5`), cùng kích thước với bản đang chạy trên thiết bị.

**3. Baseline OS rảnh, 300 mẫu (SC-002)**

| Chỉ số | Lần 1 | Lần 2 |
|---|---|---|
| MemAvailable trung bình (MB) | 902,18 | 901,43 |
| MemAvailable min–max (MB) | 900,9–902,6 | 900,0–901,7 |
| RAM đang dùng ≈ 993 − MemAvailable TB (MB) | ≈ 91 | ≈ 92 |
| CPU hệ thống trung bình (%) | 7,25 | 7,11 |
| CPU hệ thống min–max (%) | 0,5–17,7 | 1,5–20,4 |

**4. PoC, 10 client + 1 dư, 500 Tag/s (SC-003, SC-004)**

| Chỉ số | Lần 1 | Lần 2 |
|---|---|---|
| RSS `mat-poc` (MB) | 2,1 | 2,3 (đỉnh `VmHWM` 2,37) |
| CPU hệ thống trung bình (%) | 7,98 | 9,05 |
| CPU hệ thống min–max (%) | 2,0–20,6 | 3,8–21,6 |
| MemAvailable trung bình (MB) | 900,6 | 899,66 |
| Chấp nhận / từ chối | 10 / 1 | 10 / 1 |
| Mã đóng của client dư | 4429 | 4429 |
| Tổng mất sequence | 0 | 0 |
| Delta mỗi client | 1159–1160 (giữ 290 s) | 1200 (giữ 300 s) |
| p95 khoảng cách giữa hai delta (ms) | 259–265 | 267–273 |

Cả hai lần: RSS ≤ 60 MB và CPU trung bình ≤ 30% với biên rất lớn. Chênh lệch CPU +1,07 điểm % nhỏ hơn biên độ dao động từng giây của baseline (đỉnh 17,7–20,4%); không đủ để coi là thay đổi thật.

**5. Giải phóng slot (FR-006)** — giống lần 1:

```
probe @5s : accepted=false closeCode=4429 (expect rejected, 4429)
probe @30s: accepted=true (expect accepted)
silent client closeCode=4408 (expect 4408)
SLOT TEST: pass=true
```

## Quan sát mới

- **Dừng `mat-poc` mất hơn 1 s:** 1 s sau `kill` (SIGTERM) tiến trình vẫn còn dù cổng 8080 đã đóng; kiểm tra lại lúc 11:56:08 thì đã thoát hẳn, không có segfault trong journal/dmesg. Nhiều khả năng do `mg_stop` của CivetWeb chờ các thread kết thúc (suy luận, chưa đo). Cần lưu ý khi đặt `TimeoutStopSec` cho systemd ở Sprint 1.
- Timer `atscada-admin-recover` của sản phẩm cũ vẫn chạy mỗi 5 s trong cả hai lần đo (xem [device-changes.md](device-changes.md)), nên hai baseline so sánh được với nhau nhưng chưa phải image sạch.

## Thay đổi trên thiết bị trong lần chạy này

Đã ghi vào [device-changes.md](device-changes.md): `/tmp/hello-armhf` (chép, chạy, xóa; đã xác nhận không còn), thay `/root/matpoc/mat-poc` bằng bản vừa build, thêm `/root/matpoc/poc-rerun.log`, chạy `mat-poc` 11:49:37–11:55:40. Script đo chạy qua `ssh … 'sh -s'`, không ghi file lên thiết bị.

## Sửa quickstart

1. **Mục 2:** `cmake --preset armhf` không chạy được: repo không có `CMakePresets.json` (T004 ghi đã tạo nhưng thực tế không có) và CMake 3.16 trong container không hỗ trợ preset. Đã thay bằng `./deployment/toolchain/build.ps1`.
2. **Mục 4:** `sample.sh poc 300` thiếu pid nên cột RSS trống; đã thêm pid và đường dẫn binary/cờ thật.
3. **Mục 5:** thêm cách chạy tự động `load-tester --slot-test`.

Ngoài ra mục 1, 3 ghi rõ cách chạy script qua SSH bằng `sh -s` và mục 7 ghi yêu cầu Visual Studio C++.
