# ADR-048: Driver BACnet/IP client tự viết (Who-Is, ReadPropertyMultiple, WriteProperty có priority)

- **Trạng thái:** Proposed (2026-10-24). Có mã, gtest x64 (vector byte Annex F, driver trên thiết bị giả, fuzz bộ giải mã), vector project chung TS/C++, giả lập Node trong CI, driver-it x64 qua giả lập, e2e Studio. **Chưa thử thiết bị BACnet thật; chưa đo trên BL335** (Constitution VII: chưa phát hành tới khi có số đo BL335).
- **Ngày:** 2026-10-24
- **Liên quan:** [ADR-014](014-driver-sdk-modbus.md) (SDK driver), [ADR-017](017-tag-engine-v1.md) (Tag Engine), [lộ trình v2 §4.8](../plans/roadmap-v2.md) đợt 4, [spec 020](../../specs/020-driver-bacnet/spec.md), báo cáo [020-bacnet-x64](../reports/020-bacnet-x64.md). Song song: ADR-044 (S7), ADR-046 (FINS).

## Bối cảnh

Lộ trình v2 §4.8 đợt 4: "BACnet/IP client — bacnet-stack (license phải rà soát) hoặc tự viết tập con; Who-Is, ReadPropertyMultiple, COV, WriteProperty có priority". Khách hàng tòa nhà (BMS: AHU, chiller, VAV, đồng hồ điện) cần đọc/ghi điểm Analog/Binary/Multi-state. Runtime đã có khuôn driver: một luồng 256 KiB mỗi kênh, `Scheduler`, `Backoff`, `DiagCounters`, giao diện `drv::Driver`.

## Quyết định

1. **Tự viết C++17** (`drivers/bacnet`), không thư viện ngoài. bacnet-stack (Steve Karg) là GPL-2.0 kèm ngoại lệ liên kết (eCos-style): dùng được về pháp lý nhưng là khối mã lớn (hàng trăm nghìn dòng, cấu hình bằng macro), khó cắt gọn theo ngân sách BL335 và phải qua cổng giấy phép mỗi lần nâng cấp. Tập con cần dùng nhỏ: BVLC (Annex J), NPDU (clause 6), APDU confirmed/unconfirmed/ACK/Error/Reject/Abort (clause 20), mã hóa tag (20.2), 5 dịch vụ. Kiểm bằng vector byte của Annex F (F.3.5, F.3.7, F.3.9) và giả lập Node tự viết đối chiếu cùng vector.
2. **Một kênh = một cổng UDP** (47808 mặc định, `SO_REUSEADDR`, `SO_BROADCAST`); thiết bị = (IP, cổng, device instance) hoặc thiết bị sau router BACnet (`network` + `mac` → DNET/DADR). Một yêu cầu confirmed đang chờ mỗi kênh, như Modbus/FINS. IP thiết bị bắt buộc trong cấu hình; Who-Is chỉ dùng ở Studio (Tìm thiết bị) qua API thử kết nối.
3. **Không segmentation:** yêu cầu khai báo không nhận trả lời phân đoạn; ReadPropertyMultiple được gom sao cho cả yêu cầu lẫn ước tính trả lời ≤ `maxApdu` của thiết bị và ≤ `maxRpmProps` thuộc tính (32). Thiết bị trả Abort (segmentation-not-supported, buffer-overflow, apdu-too-long) hay trả lời phân đoạn thì request được chia đôi; một thuộc tính vẫn quá lớn thì Tag BAD `BACNET_SEGMENTATION`.
4. **RPM, rơi về RP:** thiết bị Reject unrecognized-service hoặc Error lớp services với RPM thì driver chuyển hẳn sang ReadProperty cho thiết bị đó (tới lần mở cổng sau). `useRpm: false` để ép từ cấu hình.
5. **Quality theo status-flags:** Tag present-value kéo theo status-flags của đối tượng trong cùng yêu cầu: fault → BAD `BACNET_FAULT`; out-of-service → UNCERTAIN `BACNET_OUT_OF_SERVICE`; overridden → UNCERTAIN `BACNET_OVERRIDDEN` (giữ giá trị). Lỗi theo thuộc tính của RPM chỉ làm BAD Tag đó (`BACNET_UNKNOWN_OBJECT`, `…_PROPERTY`, …).
6. **Ghi:** WriteProperty present-value ở priority của Tag (`AV:5@8`) hoặc `writePriority` của thiết bị (16); priority 6 bị cấm ở địa chỉ và schema. **Relinquish** là Tag BOOL với thuộc tính giả `relinquish@p`: ghi gửi NULL ở priority p, đọc = priority-array[p] là NULL. Lệnh ghi gửi một lần, đọc lại rồi xác nhận như Modbus; Error/Reject/Abort → `DEVICE_EXCEPTION` với `exception` = mã lỗi (Reject 1000 + lý do, Abort 2000 + lý do).
7. **Timeout:** gửi lại **cùng invoke ID** (clause 5.4.4), `retries` mặc định 1, `timeoutMs` mặc định 500 ms (ngắn hơn khuyến nghị 3000 ms × 3 của chuẩn để Tag báo TIMEOUT trong chu kỳ normal, không có W_DETECT_SLOW với cấu hình mặc định; thiết bị sau MS/TP đặt 1000–3000). Hết lượt: thiết bị vào backoff 1–30 s, hỏi thử lại. Trả lời sai nguồn, invoke ID, dịch vụ hay SNET/SADR: đếm `badFrames.format`, bỏ.
8. **Foreign device:** có `bbmd` thì Register-Foreign-Device lúc mở và mỗi TTL/2; NAK thành cảnh báo kênh `BBMD_NAK`. Who-Is của Studio đi Distribute-Broadcast-To-Network.
9. **Runtime giữ mọi driver theo `drv::Driver*`** (`RuntimeEngine::allDrivers`, `driverOf`), như FINS/S7 làm trên nhánh của chúng; chẩn đoán nhận `const drv::Driver*`, khóa exception BACnet là `error:31`, `reject:9`, `abort:4`. Modbus không đổi.
10. **Định dạng 1.1, chỉ thêm:** kênh `kind: "bacnet"`, thiết bị BACnet; địa chỉ Tag `loại:instance[:thuộc tính][@priority]` (độ dài địa chỉ tối đa 32 ký tự cho mọi driver). Dưới 1.1: `E_CHANNEL_VERSION` (mã chung với 018). Hai bộ kiểm TS/C++ và địa chỉ TS/C++ trên vector chung.
11. **Thử kết nối mở rộng** (`POST /api/v1/drivers/test`, `kind: bacnet`): `read` (object-name của Device hoặc một địa chỉ), `whois` (nghe trên cổng của kênh để nhận I-Am broadcast), `objects` (object-list nguyên khối hoặc từng phần tử, tên của 500 đối tượng đầu bằng RPM). Cùng giới hạn tần suất và audit.

## Hệ quả

- x64 qua giả lập, 500 điểm 1 s, 10 client: số đo ở [020-bacnet-x64](../reports/020-bacnet-x64.md).
- Who-Is khi kênh đang chạy: socket thử dùng chung cổng 47808 (`SO_REUSEADDR`); trong vài giây chờ, trả lời unicast cho kênh có thể rơi vào socket thử: kênh coi là timeout rồi gửi lại. Chấp nhận cho công cụ kỹ sư; ghi trong hướng dẫn.
- Chưa có: SubscribeCOV (để bản sau: quét định kỳ đủ cho 500 điểm và đơn giản hơn khi mất gói), segmentation, MS/TP trực tiếp, BACnet/SC, alarm/event, trend log, schedule, tìm IP theo instance khi chạy.
- Phát hành chờ số đo BL335 và thử với thiết bị thật (bộ điều khiển AHU, router BACnet MS/TP).

## Phương án đã loại

- **bacnet-stack:** xem quyết định 1 (kích thước, cấu hình, cổng giấy phép), dù giấy phép có ngoại lệ liên kết.
- **COV thay quét:** giảm lưu lượng khi điểm ít đổi nhưng cần quản lý thuê bao (lifetime, gia hạn), nhận notification ngoài luồng request/response và xử lý mất gói; để bản sau khi có số đo thực tế.
- **Tự tìm IP theo instance (Who-Is lúc chạy):** tiện khi DHCP nhưng khó chẩn đoán, phụ thuộc broadcast; IP tĩnh là thông lệ của BMS.
