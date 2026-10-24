# Plan 021: OPC DA Bridge

## Kỹ thuật

- **Ngôn ngữ: Rust** (`tools/opcda-bridge`), crate `windows` 0.62 (MIT/Apache-2.0, đã có trong Cargo.lock của Studio nên có sẵn
  offline) cho COM, dịch vụ Windows; `serde`/`serde_json` (MIT/Apache-2.0). Lý do: mặt Modbus TCP là bộ phân tích dữ liệu mạng
  không tin cậy, Rust an toàn bộ nhớ; toolchain Rust và cách đóng gói đã có cho Studio; `cargo test` chạy được không cần COM. Không
  dùng tokio: luồng chuẩn đủ cho ≤ 8 kết nối.
- Giao diện OPC DA (IOPCServer, IOPCItemMgt, IOPCSyncIO, IOPCBrowseServerAddressSpace, IOPCDataCallback) khai báo bằng
  `#[interface]` của windows-core theo IDL công khai `opcda.idl` 2.05a; `IConnectionPointContainer` cho subscription.
- Lớp trừu tượng `OpcClient` (trait): `connect`, `add_items`, `poll/subscribe`, `write`, `browse`. Hai cài đặt: `com::ComClient`
  (chỉ `cfg(windows)`), `mock::MockClient` (test, và backend `"mock"` để chạy tích hợp không cần OPC server).
- `engine`: vòng kết nối → tạo group → thêm item → nhận cập nhật → ghi vào `Image` (bảng thanh ghi dùng chung, Mutex); lỗi → đánh
  dấu mất kết nối, backoff, làm lại.
- `modbus`: server TCP, codec PDU thuần (test vector), allowlist IP/CIDR trước khi đọc byte nào.
- `service`: `StartServiceCtrlDispatcherW` + `RegisterServiceCtrlHandlerExW`; `service install` dùng `CreateServiceW`
  (LocalService mặc định).
- Studio: `opcda-map.ts` (thuần) đọc CSV ánh xạ → sửa đổi `batch` thêm/cập nhật Tag external; lệnh trong editor Kết nối.
- Đóng gói: `tools/opcda-bridge/package.ps1` → ZIP (exe, config mẫu, README, SHA256SUMS), ký thử bằng `tools/release/sign.ps1`
  chế độ test nếu có chứng chỉ thử.

## Rủi ro

- Không có OPC DA server trong CI: COM thật chỉ kiểm bằng biên dịch và smoke `browse` khi máy có server (việc mở).
- Callback COM tới dịch vụ khác tài khoản có thể bị chặn quyền: dự phòng đọc cache theo chu kỳ (`IOPCSyncIO::Read(OPC_DS_CACHE)`).
