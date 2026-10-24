# mAT OPC DA Bridge

Cầu nối chạy trên máy Windows có OPC DA server (Kepware, Matrikon, RSLinx…): đọc/ghi OPC DA bằng **COM cục bộ** và phục vụ
runtime mAT (BL335) qua **Modbus TCP**. Thiết kế: [ADR-049](../../docs/adr/049-opcda-bridge.md), spec
[021](../../specs/021-driver-opcda/spec.md). Hướng dẫn đầy đủ: `docs/user/engineer-guide.md` (mục OPC DA) và
`docs/user/admin-guide.md` (cài dịch vụ, tường lửa).

## Cài nhanh

1. Giải nén ZIP vào `C:\Program Files\mAT\opcda-bridge\`; sao `config.example.json` thành
   `C:\ProgramData\mAT\opcda-bridge\config.json` và sửa `progId`, `allow` (IP của BL335), danh sách `items`.
2. Tìm ItemID: `mat-opcda-bridge browse --prog-id Kepware.KEPServerEX.V6 [--path Channel1.Device1]`.
3. Kiểm: `mat-opcda-bridge check --config C:\ProgramData\mAT\opcda-bridge\config.json`.
4. Chạy thử ở console: `mat-opcda-bridge run --config ...` (Ctrl+C để dừng).
5. Cài dịch vụ (PowerShell quyền Administrator): `mat-opcda-bridge service install --config ...` rồi
   `sc.exe start matOpcDaBridge`. Gỡ: `mat-opcda-bridge service uninstall`.
6. Tường lửa: `New-NetFirewallRule -DisplayName "mAT OPC DA Bridge" -Direction Inbound -Protocol TCP -LocalPort 502
-RemoteAddress 192.0.2.10 -Action Allow`.
7. Xuất bảng ánh xạ: `mat-opcda-bridge export-csv --config ... --out opcda-map.csv`, rồi trong Studio: editor Kết nối →
   "Nhập ánh xạ OPC DA…".

DCOM không cần cấu hình: cầu nối và OPC server cùng máy. Dịch vụ chạy dưới `NT AUTHORITY\LocalService`; nếu OPC server từ chối
khởi động/truy cập (lỗi `0x80070005`), cấp quyền Launch/Access cho LocalService trong `dcomcnfg` cho riêng ứng dụng OPC
server, hoặc đổi tài khoản dịch vụ sang tài khoản đang chạy OPC server (services.msc → Log On).

## Bản đồ Modbus

| Vùng            | Nội dung                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------- |
| Coil `C1…`      | item BOOL theo thứ tự cấu hình (đọc FC01/02, ghi FC05/15 nếu `access: RW`)                |
| Holding `HR1…`  | item số liên tiếp: INT16/UINT16 1 thanh ghi, INT32/UINT32/FLOAT32 2 thanh ghi thứ tự ABCD |
| Input `IR1…IRn` | quality item thứ i: 0 good, 1 uncertain, 2 bad, 3 chưa có dữ liệu                         |
| Input `IR(n+1)` | `BRIDGE_OK`: 1 khi đang nối OPC server                                                    |

Mất OPC server: đọc coil/holding trả ngoại lệ 0x0B (Tag mAT thành bad); IR vẫn đọc được. Ghi item chỉ đọc, hoặc chỉ nửa giá
trị 32 bit: 0x02. OPC từ chối ghi hoặc quá `writeTimeoutMs`: 0x04.

## Phát triển

`cargo test` (test đơn vị, OPC giả, test tích hợp TCP). Đóng gói: `pwsh tools/opcda-bridge/package.ps1 [-Sign]`.
