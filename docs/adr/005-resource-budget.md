# ADR-005: Xác nhận ngân sách tài nguyên trên BL335 bằng số đo Sprint 0

- **Trạng thái:** Accepted **một phần**. Các chỉ số đã đo ở Sprint 0 được xác nhận; mọi chỉ số còn lại ghi "chưa đo" kèm sprint chịu trách nhiệm. Ngân sách **giữ nguyên**, không đề xuất đổi. Phê duyệt chính thức ghi cùng quyết định Go/No-Go (T034).
- **Ngày:** 2026-10-10
- **Liên quan:** Master Plan §6 (ngân sách), §13 (Go/No-Go); Constitution III ("thay đổi làm vượt ngân sách phải có số đo và ADR"); spec SC-002, SC-003; [ADR-001](001-web-server.md), [ADR-002](002-commercial-os.md).
- **Cập nhật 011 (2026-10-19, T087, T201):** ngân sách giữ nguyên; số đo trên BL335 với runtime 1.0.0 / `1.0.0-rc.1` (CPU tính theo một lõi): rảnh RSS 9,5 MB; L1 (500 Tag × 10 client × 4 giờ) CPU 28,9 % một lõi (14,5 % cả máy), RSS tối đa 19,5 MB; L2 (1.000 Tag) CPU 43,8 %, RSS 12,8 MB; logic tối đa 550 khối trên L1 thêm +2,5 điểm CPU, +3,8 MB RSS, vòng quét trung vị 1,05 ms: mọi dòng RAM/CPU **Đạt**, không cần ADR mới. eMMC: **không tách được trên thiết bị này** — ghi khối toàn máy 2,6–4,7 GB/ngày khi mat tắt (dịch vụ khác), phần của mat ước < ~1 GB/ngày; **quyết định:** ngưỡng 2 GB/ngày kết luận theo phần ghi của chính mat (bộ đếm `sqlite-vfs`, [ADR-039](039-sqlite-write-meter.md)), ghi toàn máy là điều kiện môi trường; số đo chờ soak bàn thử (T196). Soak S1 7 ngày trên BL335 **hủy theo quyết định người dùng** (2026-10-18), thay bằng soak x64 24 giờ và soak 30 ngày ở bàn thử khi pilot. Bố cục phân vùng A/B vẫn chưa khớp thiết kế (phụ thuộc ADR-002). Chi tiết: [011-load.md](../reports/011-load.md) §1, [011-soak.md](../reports/011-soak.md) §4.

## Bối cảnh

Master Plan §6 gọi ngân sách là "mục tiêu thiết kế, xác nhận bằng đo đạc ở Sprint 0 và Sprint 7"; Constitution III biến nó thành ràng buộc cứng. Sprint 0 đã có baseline OS rảnh và một PoC CivetWeb chạy trên thiết bị thật. ADR này đối chiếu từng chỉ số với số đo, nói rõ chỗ nào đã đo và chỗ nào chưa.

**Cách đo (để các số so sánh được):** `tools/measure/sample.sh`, lấy mẫu mỗi 1 s trong 300 s; RAM theo `MemAvailable`, RSS theo `/proc/<pid>/status`, CPU toàn hệ thống từ `/proc/stat` (gồm cả tiến trình lấy mẫu chạy qua SSH). Baseline đo khi máy rảnh sau khi đã gỡ `atscada-gateway` và chỉnh journald ([device-changes.md](../reports/device-changes.md)).

## Hai ngưỡng RAM OS rảnh không giống nhau

| Nơi ghi | Ngưỡng | Vai trò |
|---|---|---|
| Constitution III; Master Plan §6.1 | **<= 200 MB** | Ngân sách thiết kế cho sản phẩm, ràng buộc cứng |
| Master Plan §13 (Go/No-Go #2); spec SC-002 | **<= 250 MB** | Cổng Go/No-Go của Sprint 0 |

Baseline thật: tổng 993 MB (`free -m`) trừ `MemAvailable` trung bình 902,18 MB (min 900,9; max 902,6; 300 mẫu) ra khoảng **91 MB** đang dùng (dải 90,4 đến 92,1 MB). `free -m` cùng thời điểm ghi `used` 66 MB, `buff/cache` 88 MB. Số 91 MB là suy ra (`total - MemAvailable`), không phải một cột trong CSV.

- So với 200 MB: **đạt**, còn dư khoảng 109 MB.
- So với 250 MB: **đạt**, còn dư khoảng 159 MB.

Chênh lệch 50 MB giữa hai ngưỡng không làm đổi kết luận lần này, nhưng là mâu thuẫn tài liệu: Constitution quy định "khi xung đột, Constitution thắng", nên ngưỡng ràng buộc của sản phẩm là 200 MB; 250 MB chỉ nên được hiểu là cổng nới của Sprint 0. **Quyết định của ADR này:** dùng 200 MB làm ngân sách sản phẩm; coi 250 MB là cổng Sprint 0; đề nghị Tech Lead làm rõ trong spec SC-002/Master Plan §13 để tránh hai con số cùng tồn tại không giải thích (ADR không sửa các file đó).

## Bảng xác nhận ngân sách

| Chỉ số | Ngân sách (nguồn) | Đo được | Nguồn file | Kết luận |
|---|---|---|---|---|
| RAM OS rảnh | <= 200 MB (Const. III, §6.1); <= 250 MB (§13, SC-002) | ~91 MB (993 - 902,18) | [baseline.csv](../reports/baseline.csv), [device-profile.md](../reports/device-profile.md) | **Đạt** cả hai ngưỡng (Ubuntu 20.04 dev image) |
| RSS server PoC, 10 client x 500 Tag/1 s | <= 60 MB (§13 #3, SC-003) | 2,1 MB, không đổi 300 mẫu | [poc-civetweb.csv](../reports/poc-civetweb.csv) | **Đạt** (PoC, không phải runtime đầy đủ) |
| CPU TB, 500 Tag/1 s/10 client | <= 30% (Const. III, §6.2, §13 #4) | PoC 7,98% (baseline rảnh 7,25%); **`mat-runtime` Sprint 1: 11,86%** (toàn hệ thống, 10 client × 500 Tag mỗi client, [sprint1-budget.csv](../reports/sprint1-budget.csv)) | [poc-civetweb.csv](../reports/poc-civetweb.csv), [baseline.csv](../reports/baseline.csv) | **Đạt** (PoC) |
| CPU đỉnh, cùng kịch bản | <= 60% (§6.2) | PoC 20,6% (baseline rảnh 17,7%); **`mat-runtime` Sprint 1: 29%** | cùng trên | **Đạt** (PoC) |
| Giới hạn client | 10 cứng, client 11 bị từ chối, close 4429 (Const. IV, §10.2) | 10 nhận 1159-1160 delta, 0 mất sequence; client 11 bị từ chối 4429 | [poc-civetweb.json](../reports/poc-civetweb.json) | **Đạt** |
| Giải phóng slot | heartbeat timeout 15 s (§10.2) | probe @5 s bị từ chối, @30 s được nhận; client im lặng nhận 4408 | [slot-release.txt](../reports/slot-release.txt) | **Đạt** |
| RAM khả dụng khi tải | cảnh báo nếu < 250 MB (§6.1) | min 899,7 MB trong PoC | [poc-civetweb.csv](../reports/poc-civetweb.csv) | **Đạt** (chỉ cho PoC) |
| RSS `mat-runtime` đầy đủ | <= 150 MB (Const. III, §6.1) | **Sprint 1:** TB 3,13 MB, tối đa 3,5 MB (10 client × 500 Tag, 300 s); 3,8–4,4 MB khi có client chậm (600 s). Runtime Sprint 1 chưa có SQLite, auth, driver thật | [sprint1-budget.csv](../reports/sprint1-budget.csv), [sprint1-slow-budget.csv](../reports/sprint1-slow-budget.csv) | **Đạt** ở Sprint 1; xác nhận lại cuối Sprint 7 |
| `MemoryMax=300M` | systemd (§6.1) | **chưa đo**: `mat-poc.service` có cấu hình nhưng chưa cài lên thiết bị | `deployment/systemd/mat-poc.service` | Chưa kiểm chứng |
| SQLite page cache | <= 32 MB (§6.1) | **chưa đo**: Sprint 0 không dùng SQLite | | Chưa đo, chờ khi có Tag Engine/DB |
| tmpfs (log, staging) | <= 64 MB, giới hạn bằng mount (§6.1) | **chưa đo**: chưa có mount tmpfs riêng; `/run` 100 MB, `/dev/shm` 497 MB là mặc định của OS | [device-profile.md](../reports/device-profile.md) | Chưa cấu hình/đo |
| Hàng đợi gửi mỗi client | <= 256 KB, vượt thì `resync_required` (§6.1) | **Sprint 1:** có hàng đợi 256 KB + thread ghi mỗi phiên; 4409 quan sát được trên BL335; client ngừng đọc hẳn bị bỏ do ghi quá hạn 10 s (hàng đợi lúc đó 190 KB) | [ADR-006](006-live-protocol-v1.md), [sprint1-acceptance.md](../reports/sprint1-acceptance.md) | **Đạt** |
| CPU TB, 1.000 Tag/1 s/10 client | <= 50% (mục tiêu thử nghiệm, §6.2) | **chưa đo** | | Chưa đo, chờ Sprint 7 |
| Cold load 10 client cùng lúc | <= 5 s, không timeout WS (§6.2) | **chưa đo**: T039 chỉ đo 1 client | | Chưa đo |
| Độ trễ Tag -> hiển thị | <= chu kỳ polling + 500 ms (§6.4) | **chưa đo**: cần đồng hồ chung. Chỉ có p95 khoảng cách giữa hai delta 259-265 ms (chu kỳ 250 ms) | [poc-civetweb.json](../reports/poc-civetweb.json) | Chưa đo, chờ Sprint 1+ |
| Mở screen SVG trên Chrome | <= 2 s, LAN 100 Mbps (§6.4, §13 #6, SC-005) | Lần đo mới nhất: 19/19 file, lớn nhất 554 ms (file Inkscape 4,34 MB; trung vị 482 ms); lần đầu 13 file, lớn nhất 936 ms. Điều kiện đo chưa đúng chuẩn: Wi-Fi, 1 client, chỉ 2 file xuất thật (Inkscape, LibreOffice) | [svg-load.md](../reports/svg-load.md), [svg-load.json](../reports/svg-load.json) | **Đạt** trong điều kiện đo; chờ SVG Illustrator/CorelDRAW (T036) và cáp LAN |
| FPS animation | >= 30 FPS với 50 animation (§6.4) | **chưa đo**: chưa có animation engine (Sprint 5); US3 chỉ đo tải SVG | | Chưa đo |
| Studio cài offline Windows 10/11 | §13 #7, SC-006 | **chưa đo - chờ US4** (T043) | | Chưa đo |
| Ghi eMMC | <= 2 GB/ngày (Const. III, §6.3) | **chưa đo**. Tuổi thọ eMMC chưa đọc được (không có `mmc`; chưa đọc `life_time`) | [device-profile.md](../reports/device-profile.md) | Chưa đo, chờ Sprint 7 |
| Bố cục phân vùng | rootfs A/B read-only + data riêng (§6.3) | Hiện: một rootfs ext4 `rw`, 6,8 GB, dùng 719 MB (11%) | [device-profile.md](../reports/device-profile.md) | **Chưa khớp thiết kế**; phụ thuộc [ADR-002](002-commercial-os.md) |
| Soak test | 7 ngày MVP, 30 ngày thương mại (§6.4) | **chưa đo** | | Chưa đo, chờ Sprint 7 |

## Quyết định

1. **Giữ nguyên** ngân sách Master Plan §6 và Constitution III; số đo Sprint 0 không cho thấy cần nới hay siết.
2. **Xác nhận** các chỉ số đã đạt ở bảng trên, **kèm giới hạn**: PoC không có TLS, xác thực, Tag Engine, driver, SQLite, và client tải là một tiến trình Go trên một máy, không phải Chrome thật.
3. Áp dụng ngưỡng **200 MB** cho RAM OS rảnh của sản phẩm (250 MB là cổng Sprint 0).
4. Mọi dòng "chưa đo" phải được đo ở sprint nêu trong bảng bằng cùng phương pháp lấy mẫu; không chuyển thành "đạt" khi chưa có file số đo trong `docs/reports/`.
5. Đo lại RAM OS rảnh trên OS thương mại sau khi [ADR-002](002-commercial-os.md) được chốt.

## Hệ quả

- **Tốt:** có biên rất lớn ở các chỉ số đã đo (RAM OS ~91/200 MB; RSS PoC 2,1/60 MB; CPU TB 8,0/30%), nên 1 GB RAM không phải điểm nghẽn ở giai đoạn hiện tại.
- **Xấu:** phần lớn ngân sách (runtime đầy đủ, eMMC, SQLite, tmpfs, 1.000 Tag, hiển thị trên Chrome) vẫn **chưa được kiểm chứng**; biên lớn ở PoC có thể bị bào mòn khi thêm TLS, xác thực, Tag Engine, driver.
- **Rủi ro:** (1) kết luận "đạt" của PoC bị hiểu thành "đạt" của runtime; (2) CPU baseline rảnh 7,25% khá cao và chưa tách được nguồn (một phần có thể là chính phép lấy mẫu; kiểm tra sau đó cho thấy timer `atscada-admin-recover` của sản phẩm cũ còn chạy mỗi 5 s, xem [device-changes.md](../reports/device-changes.md); chưa đo lại khi tắt nó), nên phần tăng do server (+0,7 điểm % TB) nhỏ hơn độ nhiễu của baseline: không dùng để ngoại suy tuyến tính; (3) thiếu số đo ghi eMMC trong khi journal mặc định từng phình tới 712 MB.

## Điều kiện xem xét lại

- Bất kỳ số đo nào vượt ngân sách: Constitution III đòi số đo kèm ADR mới/cập nhật.
- Chuyển OS thương mại ([ADR-002](002-commercial-os.md)): đo lại RAM OS và đánh giá lại bố cục phân vùng eMMC.
- Spec/Master Plan thống nhất lại ngưỡng RAM OS (200 so với 250 MB).
- Yêu cầu khách hàng đổi quy mô (số Tag > 1.000, polling dưới 1 s, thêm historian/alarm): ngân sách §6 là cho MVP.
