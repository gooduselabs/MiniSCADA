# Báo cáo 020: driver BACnet/IP trên x64 (giả lập) và armhf (qemu)

Ngày đo: 2026-10-24. Máy dev Windows 11, Docker Desktop, runtime x64 Release trong image `mat-armhf` (`tools/driver-it-bacnet.ps1 -NoBuild -BuildDir C:\build\bacnet-x64`), giả lập `tools/bacnet-sim` (Node 22) trên mạng riêng `mat-bacnet-it` (172.30.20.0/24). Lúc đo, rig và build của các driver khác (MC, OPC UA, OPC DA) cũng chạy trên cùng máy: số CPU là cận trên.

**Chưa thử thiết bị BACnet thật và chưa đo trên BL335.** Mọi kết quả dưới đây là trên giả lập viết theo ASHRAE 135 (đáp án của giả lập khớp byte với các ví dụ Annex F trong `tests/bacnet-vectors/frames.json`).

## Tích hợp (tests/driver-it-bacnet, kết quả JSON `docs/reports/020-bacnet-<kịch bản>-x64.json`)

| Kịch bản | Kết quả | Số liệu chính |
|---|---|---|
| read | 9/9 đạt | 19/19 Tag như giả lập: AI/AO/AV (FLOAT32, FLOAT64), BI/BO/BV, MSI/MSO/MSV, `units`, `status-flags`, `object-name`; fault → BAD `BACNET_FAULT`, out-of-service → UNCERTAIN; AI:99 → BAD `BACNET_UNKNOWN_OBJECT`; AHU đọc bằng ReadPropertyMultiple (tới 27 thuộc tính mỗi yêu cầu, mọi trả lời ≤ 1476 byte); VAV sau router (mạng 5, MAC 07) không có RPM: một `reject:9` rồi ReadProperty; Who-Is qua runtime thấy 7 và 1001; object-list 13 đối tượng kèm tên; đọc AI:1 qua router |
| write | 12/12 đạt | AV:5@8 = 21,5 vào priority 8; BO, MSV, AO priority 16; relinquish@8 → slot NULL, present-value về 23; ghi qua router; write-access-denied → `FAILED DEVICE_EXCEPTION`; Tag chỉ đọc bị từ chối trước driver; có dòng audit |
| errors | 6/6 đạt | im lặng: BAD `TIMEOUT` sau 3,0 s; trả lời lại: GOOD sau 1,0 s; APDU 120 byte: Abort, yêu cầu tự chia, mọi Tag đúng; tắt RPM: chuyển ReadProperty, quality theo status-flags vẫn đúng; overridden → UNCERTAIN `BACNET_OVERRIDDEN`; runtime không khởi động lại |
| load | 4/4 đạt | xem dưới |

## Tải: 500 điểm chu kỳ 1 s, 10 client xem đủ 500 Tag, 60 s

Project `bench-500-bacnet`: 300 AV (giả lập đổi giá trị mỗi lần đọc), 100 BV, 100 MSV trên một thiết bị; RPM 32 thuộc tính mỗi yêu cầu (present-value và status-flags của 500 đối tượng).

| Số đo | BACnet (020) | Modbus TCP (006, cùng kịch bản, báo cáo 016) |
|---|---|---|
| CPU trung bình (% một nhân) | 0,4 | 0,9 |
| CPU lớn nhất mỗi 5 s | 0,4 | 1,4 |
| RSS lớn nhất | 15,9 MB | 12,3 MB |
| Chu kỳ thật của Tag | 1.001,4 ms | 1.000 ms |
| Yêu cầu mỗi giây | 31,9 (RPM) | — |
| Mất sequence ở client / gói bỏ ở giả lập | 0 / 0 | 0 |

RSS và CPU x64 nằm xa ngân sách BL335 (150 MB, 30 %) nhưng không thay số đo trên BL335 (Constitution VII: driver chỉ phát hành khi có số đo BL335). Mỗi điểm present-value kéo theo status-flags nên số thuộc tính gấp đôi số điểm; thiết bị cho phép thì tăng `maxRpmProps` để giảm số yêu cầu.

## Test đơn vị

- x64: `bacnet_codec_test` (vector địa chỉ và byte), `bacnet_driver_test` 22 (thiết bị giả: RPM, status-flags, fallback RP, chia đôi, timeout cùng invoke ID, ghi priority, relinquish, router, BBMD, cổng bận, Who-Is, object-list), `bacnet_fuzz_test`, `bacnet_factory_test`, `drivers_bacnet_api_test`, `vectors_11_test` (29 ca `v11-bacnet-*` trên bộ kiểm C++), cùng RuntimeEngine, DriversDiag: đều đạt. Toàn bộ ctest x64 (6.383 test, chạy hai đoạn vì máy khởi động lại giữa chừng: 1–4.615 không lỗi, 4.600–6.383): đều đạt trừ `AlarmStorm.TwoHundredAlarmsInOneTickTenClientsThreeSlow` (ngân sách thời gian, chập chờn đã biết; không đổi mã alarm).
- armhf dưới qemu-user (`deployment/toolchain/test-armhf.sh`): xem mục dưới.
- TS: `bacnet-address.test.ts` 50, `vectors-11.test.ts` 117 (TS cùng vector), `connections-bacnet.test.ts` 9; giả lập `node --test tools/bacnet-sim/sim.test.mjs` 9; e2e Studio `connections-bacnet` 16/16 (axe sáng, tối).

## armhf (qemu)

`deployment/toolchain/test-armhf.sh` (danh sách mặc định có thêm 4 test BACnet), chạy riêng các đích BACnet và bộ vector dưới qemu-user: `bacnet_codec_test` 7, `bacnet_driver_test` 21, `bacnet_fuzz_test` 2, `bacnet_factory_test` 2, `vectors_11_test` 119: đều đạt. Bản armhf đầy đủ của runtime chưa build riêng trong feature này (các đích test liên kết `mat_tag_engine`, `mat_bacnet`).

## Ghi chú

- `npm test`: hai test thời gian của `apps/runtime-web` (`report-page*.test.ts`) lỗi khi chạy cùng lúc với build khác, đạt khi chạy lại riêng (27/27); không liên quan feature này.
