# Kết quả PoC (US2) — CivetWeb và Drogon trên BL335

Kịch bản chung: 10 client + 1 client dư, 500 Tag/giây (delta gom 250 ms), giữ 300 s (CivetWeb lần 1: 290 s), lấy mẫu RAM/CPU mỗi 1 s trên thiết bị. Hai server dùng **chung** `core/session-manager` và `server/sim_tags.hpp`, cùng contract [live-ws.md](../../specs/001-platform-validation/contracts/live-ws.md); chỉ khác tầng web server.

Dữ liệu thô: [poc-civetweb.csv](poc-civetweb.csv), [poc-civetweb.json](poc-civetweb.json), [slot-release.txt](slot-release.txt) (CivetWeb lần 1); [poc-drogon.csv](poc-drogon.csv), [poc-drogon.json](poc-drogon.json), [slot-release-drogon.txt](slot-release-drogon.txt), [svg-load-drogon.json](svg-load-drogon.json) (Drogon). CivetWeb lần 2: [quickstart-rerun.md](quickstart-rerun.md).

## So sánh (FR-007)

| Chỉ số | Ngưỡng | CivetWeb lần 1 | CivetWeb lần 2 | Drogon v1.9.13 |
|---|---|---|---|---|
| RSS server (MB) | ≤ 60 | 2,1 | 2,3 | **3,6** |
| RSS đỉnh sau khi phục vụ trang SVG (MB) | — | 2,17 | 2,14 | 3,66 |
| CPU hệ thống trung bình (%) | ≤ 30 | 7,98 | 9,05 | 8,41 |
| CPU hệ thống p95 / đỉnh (%) | đỉnh ≤ 60 | 16,9 / 20,6 | 17,3 / 21,6 | 16 / 21 |
| Baseline rảnh cùng ngày, CPU TB (%) | — | 7,25 | 7,11 | (dùng baseline lần 2) |
| Chấp nhận / từ chối, mã đóng client dư | 10 / 1, 4429 | 10 / 1, 4429 | 10 / 1, 4429 | 10 / 1, 4429 |
| Delta/client | đều | 1159–1160 (290 s) | 1200 | 1199–1200 |
| Mất sequence | 0 | 0 | 0 | **1** (xem "Race lúc đăng ký") |
| p95 khoảng cách delta (ms) | — | 259–265 | 267–273 | 252–261 |
| Giải phóng slot (probe @5 s bị 4429, @30 s được nhận, client im lặng nhận 4408) | đạt | đạt | đạt | đạt |
| Trang SVG từ BL335, file lớn nhất (4,34 MB) | ≤ 2 s | 936 ms | 554 ms | 521 ms |
| Kích thước binary armhf | — | 161 KB | 161 KB | 1,97 MB (Drogon + Trantor + jsoncpp tĩnh) |
| Phụ thuộc lúc chạy ngoài libc/libstdc++ | — | không | không | libuuid, libz (có sẵn trên BL335) |

**Kết luận:** cả hai đạt mọi ngưỡng với biên rất lớn. CPU **ngang nhau** (chênh lệch nằm trong dao động của baseline rảnh 7,1–7,3%). Drogon dùng RAM nhiều hơn khoảng 1,5 MB và binary lớn gấp khoảng 12 lần. Không có chỉ số nào cho thấy Drogon tốt hơn trong kịch bản này. Quyết định ở [ADR-001](../adr/001-web-server.md).

## Race lúc đăng ký (đã sửa ở cả hai server)

- **Triệu chứng:** ở lượt Drogon 300 s, 1/10 client mất 1 sequence. Client này nhận đủ 1200 delta, nhưng có một delta tới **trước** snapshot.
- **Nguyên nhân:** server bật cờ `subscribed` và gửi snapshot ở thread nhận tin, trong khi bộ phát delta ở thread khác. Delta có thể chen giữa lúc tạo snapshot và lúc snapshot được gửi, nên client thấy sequence nhảy.
  - Lỗi có trong **cả hai** PoC (reviewer đã nghi ở CivetWeb).
  - Drogon gửi bất đồng bộ qua nhiều event loop nên lộ ra trước.
- **Sửa:**
  - CivetWeb: mutex `g_bcMu` bao cả "snapshot + bật `subscribed`" và "tạo + gửi delta"; `subscribed` thành atomic.
  - Drogon: xử lý subscribe trên cùng event loop với bộ phát (`queueInLoop`).
- **Kiểm chứng trên BL335:** mỗi server 10 lượt × 10 client = **100 lần đăng ký, 0 mất sequence**.
  - Chưa đo được tần suất trước khi sửa: chỉ có 1 lần trong 10 lần đăng ký của lượt 300 s.
  - Số RSS/CPU ở bảng trên đo **trước** khi sửa. Thay đổi chỉ thêm khóa ở bước đăng ký và phát delta, nên không đo lại 300 s.
- Client trang thử (`apps/runtime-web`) vẫn tự xin lại snapshot nếu gặp bước nhảy (contract).

## Ghi chú cấu hình Drogon (để so sánh công bằng)

- Build tĩnh, **không TLS/ORM/brotli** (giống CivetWeb `NO_SSL`): [Dockerfile.drogon](../../deployment/toolchain/Dockerfile.drogon), [build-drogon.ps1](../../deployment/toolchain/build-drogon.ps1).
- `setThreadNum(2)` (2 nhân Cortex-A7), không cache file tĩnh trong RAM (`setStaticFilesCacheTime(-1)`), phục vụ `.gz` nén sẵn.
- Hai lỗi chỉ có ở Drogon, phát hiện khi chạy thử trên thiết bị và đã sửa:
  1. `setBody(const char(&)[N])` gửi cả mảng N byte, nên JSON bị lẫn rác.
  2. Drogon mặc định không phục vụ `.json` (404).

## Giới hạn đã biết của PoC

- Ghi WebSocket vẫn chưa có hàng đợi gửi 256 KB/`resync_required` (Sprint 1).
- Client tải là 10 goroutine của một tiến trình Go trên một máy, chỉ đọc; chưa thử client chậm.
- "p95LatencyMs" của load-tester là p95 **khoảng cách giữa hai delta**, không phải độ trễ Tag → hiển thị.
- CPU là CPU toàn hệ thống. Thiết bị còn timer `atscada-admin-recover` (5 s) của sản phẩm cũ chạy nền ([device-changes.md](device-changes.md)).
