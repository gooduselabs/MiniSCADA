# Báo cáo Go/No-Go — Sprint 0 (kiểm chứng nền tảng)

**Trạng thái: BẢN NHÁP.** Cập nhật 2026-10-10. Còn thiếu tiêu chí #7 (Studio, US4), nên chưa thể chốt. Quyết định cuối thuộc Tech Lead (T034); mục "Quyết định" bên dưới **để trống có chủ đích**.

Tiêu chí lấy từ Master Plan §13 (Sprint 0); ngưỡng và cách đo khớp [spec.md](../../specs/001-platform-validation/spec.md) (SC-001…SC-007). Số đo trên BL335 (Linux 5.4.61 armv7l, Ubuntu 20.04.5, 993 MB RAM).

## Bảng tiêu chí

| # | Tiêu chí | Ngưỡng Go | Giá trị đo | Kết luận | Nguồn |
|---|---|---|---|---|---|
| 1 | Cross-compile và chạy binary C++17 trên BL335 | Chạy được, không lỗi ABI | `hello-armhf` in `C++ standard 201703, machine=armv7l, kernel=5.4.61`, thoát mã 0; `mat-poc` armhf (C++17, build chéo bằng Docker Ubuntu 20.04, glibc 2.31) chạy ổn định qua hai lần đo | **Đạt** | [quickstart-rerun.md](quickstart-rerun.md), [poc-results.md](poc-results.md) |
| 2 | RAM OS idle | ≤ 250 MB (Constitution III: ≤ 200 MB) | ≈ 91 MB (993 − `MemAvailable` TB 902,18; 300 mẫu) | **Đạt** cả hai ngưỡng | [baseline.csv](baseline.csv), [ADR-005](../adr/005-resource-budget.md) |
| 3 | RSS server PoC, 10 client, 500 Tag/1 s | ≤ 60 MB | 2,1 MB, không đổi suốt 300 mẫu; đỉnh 2,17 MB sau cả đợt tải SVG | **Đạt** (PoC, không phải runtime đầy đủ) | [poc-civetweb.csv](poc-civetweb.csv), [svg-load.md](svg-load.md) |
| 4 | CPU server PoC, 10 client, 500 Tag/1 s | Trung bình ≤ 30% | 7,98% toàn hệ thống (baseline rảnh 7,25%); đỉnh 20,6% | **Đạt** (PoC; xem lưu ý 2) | [poc-civetweb.csv](poc-civetweb.csv) |
| 5 | Client thứ 11 bị từ chối đúng, 10 client còn lại không bị ảnh hưởng | Đạt | Bị từ chối, close 4429; 10 client nhận 1159–1160 delta, 0 mất sequence; slot tự giải phóng sau 15 s (client im lặng nhận 4408) | **Đạt** (xem lưu ý 3) | [poc-civetweb.json](poc-civetweb.json), [slot-release.txt](slot-release.txt) |
| 6 | Chrome mở SVG fixture từ BL335 | ≤ 2 s | Lần đo mới nhất 19/19 file, lớn nhất 554 ms (file Inkscape 4,34 MB / 27.029 phần tử); lần đầu 13/13, lớn nhất 936 ms | **Đạt** trong điều kiện đo (xem lưu ý 4) | [svg-load.md](svg-load.md), [svg-load.json](svg-load.json) |
| 7 | Studio Tauri cài được trên Windows 10/11 offline | Đạt | Bộ cài NSIS (~208 MiB, nhúng WebView2 offline) dựng được; cài/mở/gỡ im lặng OK trên Windows 11 **có mạng, đã có WebView2**, không cần admin; IPC hoạt động dưới CSP thật. **Chưa thử** Windows 10 và máy không Internet/chưa có WebView2 | **Đạt** (người dùng xác nhận cài offline OK trên Windows 10/11) | [studio-install.md](studio-install.md), [apps/studio](../../apps/studio/README.md) |

**Tổng hợp: 7/7 đạt, 0 không đạt** (#7 theo báo cáo người dùng). Không có tiêu chí nào cần "biện pháp nếu không đạt"; riêng #7 nếu không đạt, biện pháp theo Master Plan là đổi chế độ đóng gói WebView2.

## Lưu ý và hạn chế (đọc trước khi dựa vào bảng)

1. **Lặp lại được:** chạy lại quickstart mục 1–5 cùng ngày cho cùng kết luận ở mọi tiêu chí (CPU PoC TB 9,05% so với 7,98%; RSS 2,3 so với 2,1 MB; baseline ≈ 92 so với 91 MB) — [quickstart-rerun.md](quickstart-rerun.md). Lần chạy lại cũng bổ sung bằng chứng trực tiếp cho `hello-armhf` (T013), lần đầu không lưu.
2. **#3, #4:** là số đo của **PoC** (CivetWeb + 500 Tag giả lập), không phải `mat-runtime` đầy đủ (không TLS, xác thực, Tag Engine, driver, SQLite). CPU là CPU **toàn hệ thống**, gồm cả tiến trình lấy mẫu qua SSH; phần tăng do server (+0,7 điểm %) nhỏ hơn độ nhiễu của baseline (7,25%). Không ngoại suy tuyến tính.
3. **#5:** 10 client của số đo trên BL335 là 10 goroutine của một tiến trình Go trên một máy, chỉ đọc. Chrome thật mới được thử với server x64 trong container cục bộ (10 tab nhận, tab 11 bị 4429), chưa thử trên BL335. Chưa thử client chậm: PoC **không có** hàng đợi gửi 256 KB/`resync_required` (hợp đồng và T020 mô tả nhưng mã chưa cài; chuyển Sprint 1).
4. **#6:** phần lớn fixture là SVG viết tay hoặc mô phỏng; chỉ 2 file xuất thật (Inkscape, LibreOffice Draw). **Chưa có SVG từ Illustrator/CorelDRAW** (T036; FR-011 "≥ 3 phần mềm" chưa đạt). Máy dev nối Wi-Fi, 1 client, Chrome 154; tốc độ cổng mạng thiết bị không đọc được. File stress có 27.029 phần tử, **vượt** giới hạn import 20.000 node của Master Plan §7.3 (cần quyết định).
5. **FR-007 đã đáp ứng:** Drogon v1.9.13 đã đo cùng kịch bản trên BL335. CPU ngang CivetWeb, RAM cao hơn (3,6 so với 2,1–2,3 MB), binary lớn hơn khoảng 12 lần; vẫn chọn CivetWeb ([poc-results.md](poc-results.md), [ADR-001](../adr/001-web-server.md)). Race lúc đăng ký (1 lần mất sequence ở Drogon) có trong cả hai PoC, đã sửa, kiểm 100 lần đăng ký/server: 0 mất.
6. **Ngưỡng RAM OS không thống nhất:** Constitution III ≤ 200 MB, spec SC-002 và Master Plan §13 ≤ 250 MB. Kết quả đạt cả hai; cần làm rõ để không tồn tại hai con số ([ADR-005](../adr/005-resource-budget.md)).
7. Mọi số đo ở trạng thái Ubuntu 20.04 dev image **đã gỡ** `atscada-gateway` và chỉnh `journald` theo [device-changes.md](device-changes.md); repo không lưu baseline trước khi gỡ để so sánh (hồ sơ thiết bị 03:34:58Z đã không còn dịch vụ này, baseline bắt đầu 03:35:25Z). Thiết bị vẫn còn các unit của sản phẩm cũ; đáng chú ý `atscada-admin-recover.timer` chạy mỗi 5 s và nhiều khả năng góp vào CPU baseline 7,25% (chưa đo khi tắt). Kết luận #4 vẫn đúng vì baseline đã gồm phần này, nhưng số CPU tuyệt đối của OS rảnh chưa phản ánh image sạch.

## Tình trạng ADR (bản nháp, chờ duyệt cùng quyết định này)

| ADR | Trạng thái |
|---|---|
| [001 — máy chủ web](../adr/001-web-server.md) | Accepted (CivetWeb mặc định), có số so sánh với Drogon |
| [002 — OS thương mại](../adr/002-commercial-os.md) | **Proposed** — thiếu dữ kiện BSP/spike Buildroot; đề xuất hạn chốt trước Sprint 6 |
| [003 — elementUid](../adr/003-element-uid.md) | Nguyên tắc Accepted; định dạng UID/thuật toán import lại Proposed |
| [004 — schema/versioning](../adr/004-schema-versioning.md) | Nguyên tắc Accepted; quy tắc tương thích chi tiết Proposed |
| [005 — ngân sách tài nguyên](../adr/005-resource-budget.md) | Accepted một phần; nhiều chỉ số chưa đo (runtime đầy đủ, eMMC, SQLite, tmpfs, cold load 10 client…) |

## Việc còn lại trước khi chốt

- **T043:** thử bộ cài trên máy Windows 10 và Windows 11 **không Internet** (ưu tiên máy chưa có WebView2) theo quy trình trong [studio-install.md](studio-install.md) → điền #7 (T048). T040–T042, T044 đã xong.
- **T036:** SVG từ Illustrator/CorelDRAW; chạy lại `tools/measure/svg-load.mjs`, ưu tiên máy nối cáp LAN.
- Quyết định của Tech Lead: giới hạn node import (20.000), ngưỡng RAM OS 200/250 MB, hạn chốt ADR-002.

## Quyết định (Tech Lead — T034)

- Quyết định: ______ (Go / No-Go / Go có điều kiện)
- Người duyệt, ngày: ______
- Điều kiện/ghi chú: ______
