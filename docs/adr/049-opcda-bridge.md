# ADR-049: OPC DA qua cầu nối Windows (mAT OPC DA Bridge), mặt Modbus TCP trước

- **Trạng thái:** Proposed (2026-10-24). Có mã và test (`cargo test`: đơn vị, OPC giả, tích hợp TCP; vitest Studio); chưa thử với OPC DA server thật, chưa chạy rig runtime x64 ↔ cầu nối.
- **Ngày:** 2026-10-24
- **Liên quan:** spec [021](../../specs/021-driver-opcda/spec.md), [threat-model I-16, RR-16](../architecture/threat-model.md), driver Modbus TCP (feature 006), driver OPC UA (nhánh 019).

## Bối cảnh

Người dùng cần đọc/ghi OPC DA (Kepware, Matrikon, RSLinx…). OPC DA (Classic) dựa trên COM/DCOM, chỉ có trên Windows; runtime chạy Linux trên BL335. Client OPC DA trực tiếp từ BL335 cần DCOM qua mạng: không có thư viện COM/DCOM chín cho Linux armhf, và DCOM qua mạng khó cấu hình, phải mở RPC động, rủi ro bảo mật cao.

## Quyết định

1. **Cầu nối chạy cạnh OPC server.** Chương trình Windows riêng `mat-opcda-bridge` đặt cùng máy với OPC DA server, nối bằng **COM cục bộ** (`CLSCTX_LOCAL_SERVER | CLSCTX_INPROC_SERVER`, không DCOM), group với update rate, subscription `IOPCDataCallback` (dự phòng: `IOPCSyncIO::Read` từ cache theo chu kỳ khi callback bị chặn), ghi `IOPCSyncIO::Write`, browse `IOPCBrowseServerAddressSpace`, tự kết nối lại (backoff 1 s → `reconnectMaxS`, `GetStatus` mỗi 5 s). Chạy console hoặc Windows Service (`LocalService`).
2. **Mặt phục vụ BL335: Modbus TCP server (phương án a).** So sánh:

   | Phương án                              | Mã runtime                | Kiểu, quality                                                                                  | Bảo mật                           | Phụ thuộc                                                          |
   | -------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------ |
   | (a) Modbus TCP server                  | 0 (driver sẵn có)         | kiểu cố định theo bản đồ; quality qua IR riêng + ngoại lệ 0x0B khi mất server; không timestamp | như Modbus hiện có (allowlist IP) | không                                                              |
   | (b) OPC UA server tối thiểu            | 0 (driver 019)            | giữ kiểu, quality, timestamp                                                                   | TLS, xác thực                     | driver OPC UA nhánh 019 chưa gộp; server UA trong cầu nối nhiều mã |
   | (c) JSON/WebSocket riêng + TLS + token | driver mới C++ trên BL335 | giữ đủ                                                                                         | tốt                               | giao thức và driver mới, hai phía phải bảo trì                     |

   Chọn (a) làm trước: ít mã nhất, không phụ thuộc nhánh khác, runtime không đổi. Mất kiểu được bù bằng bản đồ sinh tự động + CSV nhập vào Studio; quality giữ ở mức good/uncertain/bad/chưa có qua thanh ghi IR và Tag `BRIDGE_OK`.

3. **Bản đồ:** BOOL → coil `C1…`; số → `HR1…` liên tiếp (INT16/UINT16 1 thanh ghi, INT32/UINT32/FLOAT32 2 thanh ghi ABCD); quality item i → `IR i`; trạng thái → `IR n+1`. Mất OPC server: đọc C/HR trả 0x0B (runtime đánh dấu Tag bad), IR vẫn đọc được. Ghi: item `RW` mới ghi được (0x02), lỗi OPC 0x04, ghi nửa giá trị 32 bit 0x02.
4. **Ngôn ngữ Rust** với crate `windows` 0.62 (MIT/Apache-2.0) và `serde`/`serde_json` (MIT/Apache-2.0) — đã có trong Cargo.lock của Studio nên dựng offline được; không dùng SDK OPC thương mại: giao diện OPC DA khai báo bằng `#[interface]` theo IID/IDL công khai. Lý do: bộ phân tích khung Modbus nhận dữ liệu mạng không tin cậy — Rust an toàn bộ nhớ; `cargo test` chạy được không cần COM; toolchain và cách ký đã có cho Studio. C++/COM thuần (ATL) được cân nhắc nhưng thêm bề mặt lỗi bộ nhớ và cần dựng test riêng.
5. **Lớp trừu tượng `OpcClient`** với hai cài đặt (COM thật, OPC giả trong bộ nhớ). Không dựng OPC DA server COM giả: đăng ký server COM cần quyền ghi registry máy (HKCR/HKLM) không phù hợp CI; logic group/item/quality/ghi/kết nối lại được kiểm bằng OPC giả, đường COM thật kiểm bằng biên dịch và việc mở T090.

## Hệ quả

- Runtime không đổi; Studio thêm mục "OPC DA qua cầu nối" và lệnh "Nhập ánh xạ OPC DA…" trong editor Kết nối.
- Không có timestamp OPC ở runtime (thời điểm là lúc runtime đọc); không có kiểu STRING; chu kỳ dữ liệu = update rate OPC + chu kỳ quét Modbus.
- Thêm máy Windows vào kiến trúc vận hành: cài dịch vụ, tường lửa, ACL thư mục cấu hình (admin-guide §11.1).
- RR-16 (Modbus không mã hóa/xác thực) được chấp nhận ở mức như driver Modbus hiện có.

## Sau này

Mặt **OPC UA server** (phương án b) trong cùng cầu nối khi driver OPC UA (019) đã gộp: giữ kiểu, quality, timestamp, TLS. Lớp `Shared`/`Image` tách khỏi mặt Modbus để thêm mặt phục vụ thứ hai mà không đổi engine OPC.
