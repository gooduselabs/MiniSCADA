# ADR-046: Driver Omron FINS tự viết (UDP và TCP) cho CP1, CJ1, CJ2, CS1

- **Trạng thái:** Proposed (2026-10-23). Có mã, gtest x64 (khung theo vector byte, bộ chuẩn driver UDP và TCP, fuzz), vector project chung TS/C++, giả lập trong CI, driver-it x64 qua giả lập, e2e Studio. **Chưa thử PLC thật; chưa đo trên BL335** (Constitution VII: chưa phát hành tới khi có số đo BL335).
- **Ngày:** 2026-10-23
- **Liên quan:** [ADR-014](014-driver-sdk-modbus.md) (SDK driver), [ADR-017](017-tag-engine-v1.md) (Tag Engine), [lộ trình v2 §4.8](../plans/roadmap-v2.md), [spec 018](../../specs/018-driver-fins/spec.md), báo cáo [018-fins-x64](../reports/018-fins-x64.md).

## Bối cảnh

Lộ trình v2 §4.8 đợt 2 đặt Omron FINS (UDP/TCP) cho CP, CJ, CS, tự viết theo tài liệu công khai; NJ/NX đi EtherNet/IP hoặc OPC UA. Runtime đã có khuôn driver của Modbus: một luồng 256 KiB mỗi kênh, `Scheduler`, `planBlocks`/`splitBlock`, `Backoff`, `DiagCounters`, `Transport` thay được trong test. Hai đợt song song (S7, MC) cũng đụng danh mục kênh, schema `connections` và runtime.

## Quyết định

1. **Tự viết C++17** (`drivers/fins`), không thư viện ngoài, không điều khoản giấy phép mới. Khung theo FINS Commands Reference (W342) và tài liệu FINS/TCP của bộ Ethernet (W421): đầu 10 byte, lệnh 0101, 0102, 0104, 0501; đầu FINS/TCP 16 byte và bắt tay nút (lệnh 0/1/2).
2. **Một kênh = một điểm cuối IP**; thiết bị = địa chỉ FINS đích (mạng, nút, unit) sau điểm cuối đó, như cổng nối Modbus nhiều unit id. Nút 0 là tự động: UDP lấy byte cuối IPv4 (theo chế độ "automatic generation" của bộ Ethernet), TCP lấy nút khi bắt tay.
3. **Driver riêng `FinsDriver : Driver`**, không mở rộng `TagBinding` của Modbus. Runtime giữ mọi driver kênh theo `drv::Driver*` (`RuntimeEngine::allDrivers`, `driverOf`), Modbus giữ `channelDrivers()` cho cổng RS485. Chẩn đoán nhận `const drv::Driver*`. Hành vi Modbus không đổi (test Modbus và driver-it Modbus qua).
4. **Codec dùng lại** `modbus::decodeNumber`/`encodeNumber`/`decodeString` với thứ tự `CDAB` mặc định (word thấp ở địa chỉ thấp như Omron lưu DINT, REAL, LREAL) và chuỗi `AB`. BCD 4/8 chữ số là cờ `source.bcd`.
5. **Gom đọc:** khối theo (thiết bị, mã vùng đọc, nhóm quét) bằng `planBlocks` (≤ 999 word: khung 2012 byte); khối ≤ 8 word còn lại (≥ 2 khối) gộp vào 0104 (mặc định ≤ 64 phần tử, tối đa 128; CS/CJ nhận 167). Mã kết thúc 1103/1104/110B tách khối (0104 về các 0101), như exception 02/03 của Modbus.
6. **Mất gói (UDP):** gửi lại với SID mới (`retries`, mặc định 1 với UDP, 0 với TCP), trả lời muộn mang SID cũ bị bỏ và đếm. Không trả lời: thiết bị vào backoff riêng 1–30 s; 3 timeout liên tiếp đóng/mở lại liên kết, backoff kênh. Lệnh ghi gửi một lần, không gửi lại.
7. **Mã kết thúc → lý do quality** `FINS_*` (đăng ký `schemas/error-codes.json`), che bit lỗi chuyển tiếp (MRES bit 7) và cờ lỗi PLC (SRES bit 6, 7): trả lời 0000 kèm cờ lỗi PLC vẫn là dữ liệu tốt. Chẩn đoán đếm theo mã bốn chữ số hex.
8. **Định dạng 1.1, chỉ thêm (MINOR):** kênh `kind: "fins"`, `source.bcd`; dưới 1.1 là `E_CHANNEL_VERSION`. Địa chỉ dùng lại `E_ADDR_*`. Hai bản kiểm (TS `rules-fins.ts`, C++ `rules_fins.cpp`) và địa chỉ (TS `@mat/tag-codec`, C++ `drivers/fins/address`) trên vector chung.
9. **Giả lập Node** (`tools/fins-sim`): UDP và TCP cùng cổng 9600, bản đồ JSON, API điều khiển để tiêm lỗi; rig driver-it riêng (`compose-fins.yaml`) để chạy cạnh rig Modbus.

## Hệ quả

- x64 qua giả lập, 500 Tag 1 s, 10 client: CPU 0,4 % một lõi, RSS 16,2 MB (Modbus cùng bản dựng, cùng tải: 0,4 %, 15,5 MB); 5 lệnh/giây (một 0101, bốn 0104).
- Phát hành driver chờ số đo BL335 và thử với PLC thật (CJ2M, CP1L-E). Rủi ro còn lại: hành vi trả lời UDP của bộ Ethernet đời cũ (về cổng 9600: có `localPort`), mạng khác 0 qua bảng định tuyến (mạng của trả lời chỉ so khi lệnh nêu mạng), giới hạn số kết nối FINS/TCP.
- Ngoài phạm vi: mã vùng chế độ CV, ghi cờ hoàn thành T/C, đọc/ghi "forced status", FINS qua Host Link (serial), NJ/NX.

## Phương án đã loại

- **Thư viện ngoài** (libnodave không có FINS; các thư viện FINS mã nguồn mở nhỏ, ít bảo trì, giấy phép GPL): giao thức đơn giản, tự viết dễ kiểm soát gom khối và thời gian (lộ trình §5).
- **Mở rộng `TagBinding` của Modbus** cho mọi driver: đụng chỗ dùng chung với S7, MC và làm rối driver Modbus.
- **Chỉ FINS/TCP:** nhiều bộ Ethernet đời cũ và cấu hình có sẵn ở nhà máy dùng UDP.
