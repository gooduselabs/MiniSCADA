# ADR-001: Dùng CivetWeb làm máy chủ web mặc định (đã so sánh với Drogon trên BL335)

- **Trạng thái:** Accepted (CivetWeb mặc định). Đã đo Drogon v1.9.13 cùng kịch bản trên BL335 (T026/T027, 2026-10-10): FR-007 **đã đáp ứng**. Phê duyệt chính thức ghi cùng quyết định Go/No-Go (T034).
- **Ngày:** 2026-10-10
- **Liên quan:** Master Plan §1.2, §4, §6, §10.2, §13 (Sprint 0); Constitution III, IV; spec FR-007; tasks T024–T027.

## Bối cảnh

Runtime trên BL335 (Cortex-A7 x2, 1 GB RAM) cần một máy chủ C++ vừa phục vụ file tĩnh vừa giữ tối đa 10 phiên WebSocket `/api/v1/live` (Master Plan §10.2). Master Plan §4 và Constitution "Ràng buộc công nghệ" cho phép CivetWeb (mặc định) hoặc Drogon, chốt theo benchmark RSS/CPU của Sprint 0. Tiêu chí Go/No-Go liên quan (§13): RSS PoC ≤ 60 MB, CPU trung bình ≤ 30% với 10 client x 500 Tag/1 s.

**Cập nhật 2026-10-10:** Drogon đã được đo cùng kịch bản (xem "Số đo/bằng chứng"). Cả hai đạt mọi ngưỡng. CPU ngang nhau, CivetWeb dùng ít RAM hơn (2,1–2,3 so với 3,6 MB) và binary nhỏ hơn khoảng 12 lần (161 KB so với 1,97 MB). Kết luận "chọn CivetWeb" giờ dựa trên số đo so sánh, không còn cần ngoại lệ FR-007.

## Các phương án

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. CivetWeb** (đã chọn) | Thư viện C, MIT (Master Plan §4), đã vendor tại `third_party/civetweb/`; HTTP + WebSocket trong một thư viện; đã build chéo armhf và chạy trên BL335 với số đo thật (bên dưới) | WebSocket ghi **đồng bộ**; không có hàng đợi gửi mỗi client sẵn có, phải tự xây (xem "Giới hạn đã biết"); TLS/HTTP/2 chưa được thử (PoC build với `NO_SSL`) |
| **B. Drogon** (đã đo) | C++17, mô hình bất đồng bộ nhiều event loop (có lợi khi cần ghi không chặn); license MIT (Trantor BSD); CPU ngang CivetWeb trong kịch bản đo | RSS 3,6 MB (cao hơn khoảng 1,5 MB), binary 1,97 MB; cần jsoncpp (link tĩnh), libuuid, zlib; build chéo phải dựng image riêng (multiarch armhf); mặc định không phục vụ `.json`; API `setBody(char[N])` dễ dùng sai |
| **C. Tự xây hàng đợi gửi bất đồng bộ trên CivetWeb** (biện pháp giảm thiểu cho A, không phải phương án thay thế) | Giữ nguyên nền đã đo; đáp ứng yêu cầu 256 KB/`resync_required` (§6.1) | Thêm mã tự viết và thread/bộ nhớ theo client; cần đo lại sau khi làm |

## Quyết định

Dùng **CivetWeb** làm máy chủ web mặc định cho runtime từ Sprint 1. Không đưa Drogon vào build mặc định. Hàng đợi gửi 256 KB mỗi client với `resync_required` (phương án C) là việc bắt buộc của Sprint 1, kèm test client chậm. Phần logic giới hạn client đã nằm riêng ở `core/session-manager/` (không include CivetWeb), nên đổi web server không kéo theo đổi logic phiên.

## Số đo/bằng chứng

Kịch bản: 10 client + 1 client dư, 500 Tag/giây (mỗi 250 ms đổi 1/4 số Tag rồi gửi delta), 290 s, trên BL335. Tổng hợp tại [poc-results.md](../reports/poc-results.md).

| Chỉ số | Đo được | Ngưỡng | Nguồn |
|---|---|---|---|
| RSS `mat-poc` | 2,1 MB, không đổi suốt 300 mẫu | ≤ 60 MB | [poc-civetweb.csv](../reports/poc-civetweb.csv) |
| CPU hệ thống trung bình / đỉnh | 7,98% / 20,6% (baseline rảnh 7,25% / 17,7%) | TB ≤ 30% | [poc-civetweb.csv](../reports/poc-civetweb.csv), [baseline.csv](../reports/baseline.csv) |
| 10 client | 1159-1160 delta/client, 0 mất sequence | đều đặn | [poc-civetweb.json](../reports/poc-civetweb.json) |
| Client thứ 11 | bị từ chối, close code 4429; 10 client kia không bị ảnh hưởng | 100% | [poc-civetweb.json](../reports/poc-civetweb.json) |
| Giải phóng slot | probe @5 s bị từ chối; probe @30 s được nhận; client im lặng nhận close 4408 | tự giải phóng sau 15 s | [slot-release.txt](../reports/slot-release.txt) |
| Khoảng cách giữa hai delta, p95 | 259-265 ms (chu kỳ 250 ms) | không có ngưỡng | [poc-civetweb.json](../reports/poc-civetweb.json) |

Cách đọc đúng:

- CPU là CPU **toàn hệ thống** (đọc `/proc/stat`), gồm cả tiến trình lấy mẫu. Phần tăng so với baseline khoảng +0,7 điểm % trung bình, +2,9 điểm % ở đỉnh.
- Trường `p95LatencyMs` trong JSON thực chất là p95 **khoảng cách giữa hai delta liên tiếp** (`tools/load-tester/main.go`), không phải độ trễ Tag → hiển thị. Độ trễ thật cần đồng hồ chung, chưa đo.
- Trường `startedAt` trong JSON là thời điểm xuất báo cáo (`main.go` dòng 139), không phải lúc bắt đầu chạy; cửa sổ chạy khớp với cửa sổ lấy mẫu CSV.
- Drogon (cùng kịch bản, 300 s): RSS 3,6 MB; CPU TB 8,41% (đỉnh 21%); 10/1, 4429; giải phóng slot đạt; trang SVG lớn nhất 521 ms. Bảng so sánh đầy đủ: [poc-results.md](../reports/poc-results.md).
- Race lúc đăng ký (delta chen trước snapshot), lộ ra khi đo Drogon, có ở **cả hai** PoC: đã sửa và kiểm trên BL335 với 100 lần đăng ký mỗi server, 0 mất sequence.

## Giới hạn đã biết của PoC

1. **Ghi đồng bộ, chưa có hàng đợi gửi.** `server/main.cpp` gọi `mg_websocket_write` tuần tự cho từng client trong một thread phát. Hợp đồng `contracts/live-ws.md` và task T020 mô tả hàng đợi 256 KB → `resync_required`, nhưng mã chưa cài (ghi chú đầu file: "no write-queue backpressure"). Suy ra từ mã (chưa thử): một client ngừng đọc có thể làm nghẽn thread phát và các client khác. Edge case "client chậm" trong spec chưa được kiểm thử.
2. 10 client của số đo trên BL335 là 10 goroutine của một tiến trình Go trên một máy, chỉ đọc; chưa thử client chậm hoặc rớt mạng giữa chừng. Chrome thật mới chỉ thử với server x64 chạy trong container cục bộ (không phải BL335): 10 tab nhận dữ liệu, tab thứ 11 bị 4429, đóng một tab thì tab mới vào được.
3. Không TLS, không xác thực, không Tag Engine/driver/SQLite; RSS 2,1 MB chưa phản ánh `mat-runtime` đầy đủ (ngân sách ≤ 150 MB).
4. Tải file tĩnh lớn đã đo ở US3: RSS đỉnh `mat-poc` 2,17 MB sau khi phục vụ file 4,55 MB (gzip 554 KB) cho Chrome ([svg-load.md](../reports/svg-load.md)). Chưa đo cold load 10 client (≤ 5 s, §6.2).
5. Không có phép đo 1.000 Tag.

## Hệ quả

- **Tốt:** có nền đã chạy trên thiết bị thật với biên lớn (RSS 2,1/60 MB; CPU TB 8,0/30%); ít phụ thuộc; license MIT.
- **Xấu:** phải tự xây backpressure; chưa biết chi phí TLS trên Cortex-A7; số đo so sánh với Drogon đã có, làm mốc nếu sau này cần đổi.
- **Rủi ro bảo mật của thư viện (review Sprint 1):** CivetWeb 1.16 có CVE-2025-55763 (tràn bộ đệm ở bước redirect thư mục khi phục vụ file). Giảm thiểu: `mat-runtime` build CivetWeb với `NO_FILES` và tự phục vụ file theo allowlist, nên đoạn mã đó không còn trong binary. Ngoài ra đã vá cục bộ: giới hạn kích thước frame WebSocket trước khi cấp phát, và hàm đóng kết nối cưỡng bức ([third_party/LICENSES.md](../../third_party/LICENSES.md)). Cần theo dõi bản phát hành sửa lỗi của upstream.
- **Rủi ro:** nghẽn do client chậm (xem giới hạn 1). Giảm thiểu: phương án C, **đã làm ở Sprint 1** (hàng đợi 256 KB + thread ghi mỗi phiên, [ADR-006](006-live-protocol-v1.md)); test client chậm trên BL335: 9 client còn lại 0 mất sequence, RSS 3,8–4,4 MB; giữ `server/http`, `server/websocket` (Master Plan §5) mỏng để đổi web server nếu cần.

## Điều kiện xem xét lại

Mở lại ADR (PoC Drogon đã có sẵn ở `server/poc-drogon`, đo lại được ngay) nếu xảy ra **một** trong các điều kiện:

1. Sau khi có hàng đợi gửi, test client chậm ở Sprint 1+ vẫn cho thấy client chậm làm ảnh hưởng client khác hoặc làm RSS tăng không kiểm soát.
2. Số đo `mat-runtime` đầy đủ vượt ngân sách (RSS > 150 MB, CPU TB > 30% với 500 Tag/10 client, hoặc > 50% với 1.000 Tag) và profile cho thấy tầng web là nguyên nhân.
3. TLS (Master Plan §11.3) làm cold load 10 client vượt 5 s hoặc đẩy CPU vượt ngưỡng. PoC build với `NO_SSL`; bản vendor có `mod_mbedtls.inl` và `http2.inl` nhưng chưa được thử.
4. Có yêu cầu mới (ví dụ HTTP/2) mà CivetWeb thực tế không đáp ứng.
5. Rà soát license hoặc bảo trì cho thấy CivetWeb không phù hợp bản thương mại.
