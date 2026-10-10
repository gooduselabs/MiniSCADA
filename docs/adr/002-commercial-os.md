# ADR-002: Hệ điều hành cho bản thương mại: Buildroot hay Ubuntu 20.04 có vá

- **Trạng thái:** **Proposed**. Nghiêng về Buildroot nhưng **chưa đủ dữ kiện để chốt**; danh sách dữ kiện còn thiếu ở mục "Cần gì để chốt".
- **Ngày:** 2026-10-10
- **Liên quan:** Master Plan §1.2, §6.3, §11.1, §11.2, §11.5, §15, §16; Constitution VII (deploy atomic); spec FR-001, FR-003; tasks T012, T014.

## Bối cảnh

Master Plan §1.2 đã chốt: Ubuntu 20.04 tối giản theo BSP nhà sản xuất (kernel 5.4.x) là OS **phát triển, PoC, pilot**. OS **thương mại** do ADR này quyết định ở cuối Sprint 0: Buildroot (khuyến nghị) hoặc Ubuntu có chính sách vá riêng (§11.1). Lý do của Master Plan: Ubuntu 20.04 hết hỗ trợ chuẩn từ 04/2025; Buildroot cho image nhỏ, rootfs read-only, kiểm soát được bản vá. Thiết kế lưu trữ (§6.3) và OTA (§11.5) giả định rootfs A/B read-only; Master Plan §11.1 ghi quyết định cuối "dựa trên mức hỗ trợ BSP của nhà sản xuất".

Số đo Sprint 0 trả lời được câu hỏi "Ubuntu hiện tại có chạy nổi sản phẩm không" (có), nhưng **không** trả lời được câu hỏi then chốt của quyết định này: nhà sản xuất có hỗ trợ Buildroot cho BL335 hay không (xem "Cần gì để chốt").

## Các phương án

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Buildroot** (nghiêng về) | Image nhỏ, ít dịch vụ, bề mặt tấn công nhỏ; rootfs read-only + A/B khớp §6.3/§11.5; kiểm soát từng gói và bản vá; RAM nền có khả năng thấp hơn Ubuntu (chưa đo) | Cần BSP/bootloader/kernel phù hợp từ nhà sản xuất (**chưa xác minh**); đổi toolchain và sysroot so với Sprint 0 (xem ràng buộc glibc); tự chịu trách nhiệm rebuild/vá toàn image; chi phí 4-6 tuần chạy song song (Master Plan §15); mất `apt` và công cụ gỡ lỗi sẵn có |
| **B. Ubuntu 20.04 + chính sách vá riêng** | Đã chạy PoC và có số đo trên chính image này; toolchain build chéo hiện tại (Docker `ubuntu:20.04`, glibc 2.31) khớp thiết bị; có `apt`, ít việc phải làm thêm ngay | Hết hỗ trợ chuẩn từ 04/2025 (Master Plan §11.1) nên bản vá do ta tự lo hoặc phải trả phí (khả năng/chi phí cho armhf **chưa xác minh**); rootfs hiện đang `rw` trên một phân vùng, muốn read-only/A/B phải tự thiết kế; bề mặt dịch vụ lớn hơn; kernel 5.4.61 vẫn là kernel BSP của nhà sản xuất dù chọn OS nào |

Ràng buộc kỹ thuật chung: binary build trên sysroot glibc 2.31 cần glibc target >= 2.31 để chạy. Khi chuyển sang Buildroot, nên build lại bằng toolchain của chính Buildroot thay vì dùng lại binary Sprint 0 (cần xác nhận khi làm spike).

## Quyết định

Chưa chốt. **Đề xuất làm việc (Proposed):**

1. Giữ Ubuntu 20.04 làm OS phát triển/PoC/pilot đúng như Master Plan §1.2; không có thay đổi.
2. Hướng thương mại: Buildroot, **có điều kiện**: spike chứng minh được BSP (xem dưới) chạy được các ngoại vi cần dùng trên BL335. Nếu spike thất bại, rơi về phương án B kèm kế hoạch vá và rootfs read-only tự thiết kế.
3. Trong lúc chưa chốt, code Sprint 1-7 chỉ dựa vào glibc/libstdc++/POSIX chuẩn và thư viện vendor (`third_party/`), không dựa vào `apt` hay gói riêng của Ubuntu, để không khóa đường chuyển OS.
4. Đề xuất hạn chốt: trước Sprint 6 (Build/Deploy), vì cơ chế cập nhật A/B (§11.5) phụ thuộc OS. Hạn này là đề xuất của ADR, chưa được Tech Lead xác nhận.

## Số đo/bằng chứng (từ thiết bị thật)

Nguồn chính: [device-profile.md](../reports/device-profile.md), [baseline.csv](../reports/baseline.csv), [device-changes.md](../reports/device-changes.md).

| Dữ kiện | Giá trị | Ý nghĩa cho quyết định |
|---|---|---|
| Kernel | Linux 5.4.61 `#70 SMP PREEMPT Thu Apr 30 17:03:10 CST 2026`, armv7l, user-space 32-bit | Kernel do nhà sản xuất build (số build #70, tháng 4/2026): kernel 5.4 phụ thuộc BSP nhà sản xuất ở cả hai phương án |
| OS / thư viện | Ubuntu 20.04.5 LTS; glibc 2.31 (2.31-0ubuntu9.9); `libstdc++.so.6.0.28`, `libssl.so.1.1`, `libz.so.1.2.11`, `libsqlite3.so.0.8.6` | Đủ thư viện nền cho runtime C++17; OpenSSL 1.1.x |
| RAM | Tổng 993 MB; `free -m`: used 66, buff/cache 88, available 902 | OS rảnh dùng khoảng 91 MB (= 993 - MemAvailable TB 902,2); xem [ADR-005](005-resource-budget.md) |
| Dung lượng | `/dev/root` 6,8 GB, dùng 719 MB (11%) | Dư dung lượng; nhưng chỉ một rootfs |
| Mount | `/dev/mmcblk0p5` ext4 `rw,relatime`, gốc `/` | **Chưa** read-only, **chưa** có phân vùng data/backup/A-B như §6.3. Các phân vùng p1-p4 chưa được liệt kê trong hồ sơ |
| Journal | journald đã chỉnh `SystemMaxUse=50M`, `RuntimeMaxUse=30M`; vacuum 712 MB xuống 56 MB | Nhật ký mặc định đã phình tới 712 MB trên eMMC: minh họa rủi ro ghi/đầy ổ khi rootfs ghi được |
| Dịch vụ | 15 unit chạy khi thu hồ sơ (ssh, networkd, resolved, timesyncd, wpa_supplicant, getty, networkd-dispatcher, rc-local...) | Còn nhiều dịch vụ không cần cho sản phẩm; Buildroot hoặc Ubuntu tối giản đều phải cắt bớt |
| Dịch vụ cũ | `atscada-gateway.service` và `/opt/atscada-gateway` đã gỡ theo yêu cầu người dùng (không hoàn tác được) | Hồ sơ dịch vụ ở trên không còn dịch vụ này; baseline đo ở trạng thái đã gỡ |
| Công cụ trên máy | không có `gcc`, `g++`, `cmake`, `mmc`; có `python3` | Phải build chéo; không đọc được tuổi thọ eMMC bằng `mmc` (chưa đọc `life_time`) |
| Ngoại vi | `/dev/ttyAS0,2-5`, `/dev/ttyS0-3`, `/dev/ttyUSB0-3`; `can0`; `eth1`, `eth2`, `usb0`; `/dev/rtc0` (NTP active) | Danh sách driver mà BSP của Buildroot **phải** hỗ trợ; `hwclock` báo `select() ... timed out` khi chờ tick RTC |
| Chạy binary tự build | `hello-armhf` chạy trên thiết bị; `mat-poc` armhf chạy và cho số đo | Phương án B đã được chứng minh chạy được; phương án A **chưa thử** |

Không có số đo nào cho Buildroot (RAM nền, kích thước image, thời gian boot): **chưa đo**.

## Hệ quả

- **Tốt (khi theo đề xuất):** không chặn tiến độ Sprint 1-7 vì vẫn dùng Ubuntu; hướng thương mại rõ ràng và có điểm rơi.
- **Xấu:** quyết định bị hoãn; thiết kế deploy/OTA (Sprint 6) và rootfs read-only (§11.2) vẫn chưa biết sẽ dựa trên cơ chế nào.
- **Rủi ro:** (1) Master Plan §16 xếp "OS Ubuntu 20.04 hết hỗ trợ" là rủi ro **Cao**, nên không thể hoãn vô thời hạn; (2) nếu BSP không hỗ trợ Buildroot, chi phí phương án B (tự vá, tự làm read-only) phải được tính lại; (3) chuyển OS muộn buộc chạy lại các phép đo của [ADR-005](005-resource-budget.md) trên OS mới.

## Cần gì để chốt

1. **Hỗ trợ của nhà sản xuất:** có SDK/BSP Buildroot (hoặc Yocto) cho BL335L-SOM335-X1 hay không; bootloader, nguồn kernel 5.4.61, device tree, driver cho eMMC, `ttyAS*`, CAN, RTC, hai cổng Ethernet, USB; điều khoản license/GPL; thời hạn hỗ trợ. Không có thông tin này trong repo.
2. **Spike Buildroot trên BL335:** image khởi động được với các ngoại vi trên; đo RAM nền, kích thước image, thời gian boot; chạy lại `mat-poc` và kịch bản 10+1 client.
3. **Chính sách vá của phương án B:** khả năng và chi phí vá bảo mật cho Ubuntu 20.04 armhf (ESM hay tự duy trì), danh sách gói trong image và phiên bản (OpenSSL 1.1.1, systemd, glibc, ssh).
4. **Bố cục phân vùng/bootloader:** xác nhận có thể dựng A/B + data riêng + rootfs read-only trên module (liệt kê phân vùng hiện có, bootloader).
5. **Yêu cầu vòng đời của khách hàng:** số năm hỗ trợ cam kết, để so với thời hạn vá của mỗi phương án.

## Điều kiện xem xét lại (sau khi chốt)

Mở lại nếu nhà sản xuất ngừng hỗ trợ BSP/kernel, nếu phát sinh lỗ hổng nghiêm trọng mà phương án đã chọn không vá kịp, hoặc nếu spike/pilot cho thấy chi phí bảo trì vượt dự toán Master Plan §15.
