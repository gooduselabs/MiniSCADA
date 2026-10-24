# ADR-045: Driver Mitsubishi MC protocol (SLMP) tự viết

- **Trạng thái:** Proposed (2026-10-23). Có mã, gtest, fuzz, giả lập Node, driver-it và số đo x64; **chưa thử PLC thật, chưa đo trên BL335** (điều kiện phát hành driver, Constitution VII).
- **Ngày:** 2026-10-23
- **Liên quan:** [spec 017](../../specs/017-driver-mc/spec.md), [hợp đồng khung](../../specs/017-driver-mc/contracts/mc-protocol.md), [ADR-014](014-driver-sdk-modbus.md) (SDK driver), lộ trình v2 §4.8 đợt 2.

## Bối cảnh

Khách hàng dùng nhiều PLC Mitsubishi (iQ-R, FX5/iQ-F, Q, L); trước đây phải qua gateway Modbus. MC protocol (SLMP) có sẵn trong CPU có cổng Ethernet và module Ethernet. Lộ trình chọn tự viết theo tài liệu công khai (không phụ thuộc thư viện, license sạch, tự kiểm soát gom yêu cầu và thời gian).

## Quyết định

1. **Driver C++17 tự viết theo khuôn Modbus TCP** (`drivers/mc/`): một luồng 256 KiB mỗi kênh, `Scheduler`, `planBlocks`/`splitBlock`, `DiagCounters`, `Backoff`, `Transport`; chỉ phát `TagUpdate`/`WriteResult`; ghi qua write coordinator như Modbus (quyền, giới hạn, audit). Codec thuần (`mc_address`, `mc_frame`) dùng chung cho validator C++.
2. **Khung**: 3E binary qua TCP là mặc định; 4E, ASCII và UDP là tùy chọn của kênh. **Lệnh con Q/L** (0000/0001), mã thiết bị 1 byte, số 3 byte: iQ-R, FX5, Q, L đều nhận. Không dùng thiết bị mở rộng của iQ-R.
3. **Đọc theo word** cả thiết bị bit (16 điểm/word, đầu khối bội 16); **Random Read 0403** gom các khối ≤ 2 word rời rạc (≤ 192 điểm), tắt được. Ghi bit bằng 1401/0001 một điểm; bit trong word chỉ đọc-sửa-ghi.
4. **3E không có số thứ tự**: mọi trả lời kiểm định tuyến, độ dài; 3E qua TCP hết thời gian chờ thì đóng, mở lại kết nối. 4E/UDP: thiết bị vào backoff riêng (khuôn feature 011), trả lời muộn bị bỏ theo số thứ tự.
5. **End code → 4 lý do quality** (`MC_END_RANGE`, `MC_END_DEVICE`, `MC_END_COMMAND`, `MC_END_OTHER`); giá trị cụ thể ở chẩn đoán và `exception` của kết quả ghi. `MC_END_RANGE` chia khối (Random Read thành Batch Read).
6. **Định dạng**: kênh `kind: "mc"` (`tcp`, `mc`) và thiết bị MC chỉ thêm ở dòng 1.x; project 1.0 có kênh `mc` là `E_CHANNEL_VERSION`. Địa chỉ Tag viết như GX Works; thứ tự byte mặc định CDAB/BA dùng lại codec Modbus trên giá trị word. Luật TS và C++ cùng vector (`tests/mc-vectors`, `v11-mc-*`).
7. **Tích hợp runtime gọn**: `RuntimeEngine` thêm danh sách driver MC và `allChannelDrivers()` theo thứ tự kênh; định tuyến ghi và chẩn đoán qua `drv::Driver*`. Hành vi Modbus không đổi.

## Hệ quả

- Không thêm thư viện; RAM thêm một luồng và vài KB mỗi kênh MC. Số đo x64 500 Tag/1 s: [017-mc-x64.md](../reports/017-mc-x64.md).
- Rủi ro chưa kiểm: khác biệt giữa các dòng PLC (giới hạn điểm, hỗ trợ 0403, ký hiệu ZR/X/Y trong ASCII), hành vi khi PLC STOP hay cấm ghi khi RUN. Cần thử iQ-R, FX5U, Q03UDE (tasks T090).
- Chưa có Thử kết nối (`POST /api/v1/drivers/test`) cho kênh MC (tasks T091).

## Phương án đã loại

- Thư viện ngoài (ví dụ mã nguồn mở MC protocol bằng C#/Python, không có bản C++ nhỏ gọn phù hợp license): thêm phụ thuộc, khó kiểm soát gom và thời gian.
- Lệnh con iQ-R (0002/0003): không chạy trên Q/L/FX5; không cần cho thiết bị của FR-003.
- Một mã quality cho mỗi end code: danh mục mã lỗi phình, người vận hành không phân biệt được nhiều hơn.
