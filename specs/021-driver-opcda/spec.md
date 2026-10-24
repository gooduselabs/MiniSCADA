# Spec 021: OPC DA qua cầu nối (mAT OPC DA Bridge)

Trạng thái: Draft (2026-10-24). ADR: [049](../../docs/adr/049-opcda-bridge.md).

## Bối cảnh

Người dùng cần đọc/ghi dữ liệu từ OPC DA server (Kepware, Matrikon, RSLinx…). OPC DA (Classic) dựa trên COM/DCOM, chỉ có trên
Windows; runtime mAT chạy Linux trên BL335 nên không thể là OPC DA client trực tiếp. DCOM qua mạng lại khó cấu hình và rủi ro.

## Phương án đã chốt

Một chương trình Windows riêng, **mAT OPC DA Bridge**, đặt trên cùng máy với OPC DA server: là OPC DA client qua **COM cục bộ**
(không DCOM), và là **Modbus TCP server** cho runtime trên BL335 (runtime dùng driver Modbus TCP sẵn có, không đổi mã runtime).
Bản đồ item → thanh ghi sinh tự động, xuất CSV để Studio nhập thành Tag. Thiết kế để thêm mặt OPC UA server sau (ADR-049).

## Câu chuyện người dùng

- **US1 (P1)** Kỹ sư cấu hình cầu nối bằng file JSON: ProgID server, update rate, danh sách item (tên mAT, ItemID OPC, kiểu,
  quyền). Cầu nối kết nối OPC DA 2.05a/3.0 cục bộ, tạo group, nhận dữ liệu (subscription `IOPCDataCallback`, dự phòng đọc cache theo
  chu kỳ), cập nhật bảng thanh ghi.
- **US2 (P1)** Runtime đọc giá trị qua Modbus TCP: Float (FLOAT32, 2 thanh ghi ABCD), Int (INT16/INT32), Bool (coil). Quality OPC
  ánh xạ sang mã quality của mAT trong vùng Input Register riêng; khi mất OPC server mọi yêu cầu đọc trả ngoại lệ Modbus 0x0B
  (gateway target failed) để runtime đánh dấu Tag bad.
- **US3 (P1)** Ghi từ runtime (FC05/06/15/16) vào item có quyền RW được chuyển thành `IOPCSyncIO::Write`; lỗi ghi → ngoại lệ 0x04.
  Item chỉ đọc → ngoại lệ 0x02 (không ghi được).
- **US4 (P2)** Tự kết nối lại khi OPC server khởi động lại (backoff 1 s → `reconnectMaxS`).
- **US5 (P2)** Duyệt không gian tên: `mat-opcda-bridge browse --prog-id X [--path A.B]` liệt kê branch/leaf để chọn ItemID.
- **US6 (P2)** Chạy như Windows Service (`service install|uninstall`), log ra file xoay vòng, chỉ nhận kết nối Modbus từ IP/CIDR
  trong `allow`.
- **US7 (P2)** `export-csv` xuất bảng ánh xạ; Studio có lệnh "Nhập ánh xạ OPC DA…" trong editor Kết nối tạo/cập nhật Tag external
  trỏ tới thiết bị Modbus đã chọn; editor Kết nối có mục hướng dẫn "OPC DA qua cầu nối".

## Yêu cầu chức năng

- FR-001 Không dùng SDK OPC thương mại; giao diện COM OPC DA khai báo trong mã (IID công khai của OPC Foundation).
- FR-002 Cấu hình JSON kiểm chặt: id Tag hợp lệ theo luật mAT, không trùng; kiểu ∈ BOOL, INT16, UINT16, INT32, UINT32, FLOAT32;
  tối đa 5000 item; cổng 1–65535; `allow` không rỗng (mặc định chỉ 127.0.0.1).
- FR-003 Bản đồ: coil cho BOOL bắt đầu ở C1; thanh ghi cho số bắt đầu ở HR1 (liên tiếp theo thứ tự cấu hình); quality item thứ i ở
  IR(i+1); IR quality: 0 good, 1 uncertain, 2 bad, 3 chưa có dữ liệu; thanh ghi trạng thái cầu nối ở `IR(statusBase)` (1 = đã kết nối
  OPC). Địa chỉ dùng cơ sở 1 (`addressBase: 1` mặc định của thiết bị mAT).
- FR-004 Quality OPC (bit 7–6): 0xC0 good, 0x40 uncertain, 0x00 bad; ký hiệu con giữ trong log.
- FR-005 Modbus: FC01, 02, 03, 04, 05, 06, 15, 16; unit id cấu hình (mặc định 1, nhận cả 0/255 không); khung > 260 byte hoặc độ dài
  sai → đóng kết nối; tối đa 8 kết nối đồng thời; timeout rỗi 60 s.
- FR-006 Timestamp OPC giữ trong bộ nhớ và log khi debug; Modbus không mang timestamp (giới hạn đã biết, ADR-049).
- FR-007 Mọi lỗi được log có mã; không log giá trị ghi ở mức info.

## Ngoài phạm vi

DCOM tới máy khác; OPC A&E/HDA; mặt OPC UA server (sau, khi driver OPC UA của runtime nhánh 019 được gộp); chữ ký số thật.

## Tiêu chí thành công

- SC-001 `cargo test` xanh: cấu hình, bản đồ, quality, codec Modbus, engine với OPC giả (group/item/quality/ghi/kết nối lại).
- SC-002 Test tích hợp: client Modbus đọc/ghi cầu nối chạy backend giả qua TCP thật.
- SC-003 Studio: vitest cho bộ nhập CSV ánh xạ; lint, typecheck xanh.
