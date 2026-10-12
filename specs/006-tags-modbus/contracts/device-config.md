# Contract: cấu hình, file, unit, lệnh trên BL335 (feature 006)

**Feature**: [spec.md](../spec.md) FR-018, FR-035, FR-041, FR-055a, FR-057 · **Research**: R13, R15, R16, R19

Bổ sung cho [device-config.md của 005](../../005-device-online/contracts/device-config.md). Khóa lạ trong `runtime.json` vẫn làm runtime thoát mã 2, nên mọi khóa mới đều có mặc định: file đang có trên BL335 không phải sửa.

## 1. Khóa mới trong `runtime.json`

| Khóa | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `serialPorts` | mảng chuỗi | `["ttyAS*"]` | mỗi mục là tên `tty…` (cho phép `*` ở cuối) hoặc đường dẫn `/dev/serial/by-id/…`, `/dev/serial/by-path/…` đúng tên. Cổng console luôn bị loại, kể cả khi khớp |
| `viewerAccess` | chuỗi | `"private"` | `private` \| `any` \| `off` (FR-055a) |
| `retainWindowS` | int | 5 | 1–60 (FR-018) |
| `retainDir` | chuỗi | `<dataDir>/retain` | thư mục ghi được |
| `tagWriteSessionBurst` | int | 10 | 1–10 |
| `tagWriteSessionPerMin` | int | 20 | 1–20 |
| `tagWriteGlobalBurst` | int | 20 | 1–20 |
| `tagWriteGlobalPerMin` | int | **20** (tạm; chốt theo số đo SC-011, research R15) | 1–30 |
| `tagWriteQueuePerChannel` | int | 16 | 1–64 |
| `tagWriteQueueTotal` | int | 64 | 1–256 |

- Trần của các khóa `tagWrite…Burst`, `…PerMin` là mức của FR-041; không đặt cao hơn được.
- Hằng số, không cấu hình: nhớ mã yêu cầu ≥ 15 phút; giữ kết quả để hỏi 15 phút; Thử kết nối ≤ 10 lần/phút, một lần một lúc; kiểm lại phiên của kết nối live mỗi 60 s.

**Tham số dòng lệnh mới** (test, chạy x64): `--serial-ports <mẫu,…>`, `--viewer-access <giá trị>`, `--retain-dir <thư mục>`.

## 2. File và thư mục

| Đường dẫn | Chủ, quyền | Ai tạo | Qua `deploy.sh` / `rollback.sh` |
|---|---|---|---|
| `/var/lib/mat-runtime/retain/retain-a.bin`, `retain-b.bin` | `matscada`, `0600`; thư mục `0700` | runtime (lần đầu có Tag giữ qua mất điện) | giữ |
| `/var/lib/mat-runtime/retain/*.corrupt-*` | như trên | runtime, khi bản lưu hỏng | giữ (tối đa 3 bộ) |
| `/var/lib/mat-runtime/audit.db` | như 005; `user_version` 2, thêm bảng `tag_write_request` | runtime | giữ |

`history.db`, `projects/`, `tls/`, `users.json` của 003, 005 không đổi.

## 3. Unit systemd

`deployment/systemd/mat-runtime.service`. Thay `PrivateDevices=true` bằng:

```ini
# Cổng serial (feature 006, research R13): cgroup chỉ cho thiết bị giả chuẩn và tty, như PrivateDevices
PrivateDevices=false
DevicePolicy=closed
DeviceAllow=char-ttyAS rw
DeviceAllow=char-ttyUSB rw
DeviceAllow=char-ttyACM rw
SupplementaryGroups=dialout
```

- Phần sandbox khác giữ nguyên: `CapabilityBoundingSet=`, `NoNewPrivileges=true`, `ProtectSystem=strict`, `ProtectKernel*`, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`, `SystemCallFilter=@system-service`, `MemoryDenyWriteExecute`, `ReadOnlyPaths`…
- **Điều kiện** (kiểm bằng lệnh chỉ đọc ở [quickstart.md](../quickstart.md) §8):
  - `/proc/devices` có nhóm `ttyAS` (tên chính xác của major);
  - `/proc/cgroups` có controller `devices` đang bật;
  - `/dev/ttyAS*` thuộc nhóm `dialout`, mode `0660`.
- **Thiếu điều kiện thứ nhất hay thứ hai:** dùng phương án dự phòng. Giữ `PrivateDevices=true`; `deploy.sh` sinh drop-in `/etc/systemd/system/mat-runtime.service.d/serial.conf` với mỗi cổng trong `serialPorts` (không có `*`): `BindPaths=-/dev/<cổng>` và `DeviceAllow=/dev/<cổng> rw`. Bộ chuyển USB cắm sau thì phải khởi động lại dịch vụ.
- **Thiếu điều kiện thứ ba:** luật udev `/etc/udev/rules.d/60-mat-serial.rules` (`KERNEL=="ttyAS[1-9]", GROUP="dialout", MODE="0660"`). Chỉ cài khi người dùng cho phép.
- Mọi thay đổi trên BL335 ghi vào `docs/reports/device-changes.md` kèm cách hoàn tác (FR-057).
- **Kiểm sau khi cài:** `systemd-analyze security mat-runtime` không tệ hơn bản 0.4 quá 0,3 điểm; `systemctl show mat-runtime -p DevicePolicy -p DeviceAllow`.

## 4. Lệnh trên BL335

| Lệnh | Chạy bằng | Làm gì | Audit |
|---|---|---|---|
| `runuser -u matscada -- mat-runtime --list-serial` | `matscada` | in danh sách cổng như `GET /api/v1/serial/ports` (không mở cổng) | không |
| `runuser -u matscada -- mat-runtime --retain-dump` | `matscada` | in giá trị đang lưu của Tag giữ qua mất điện, thế hệ, file đang dùng, trạng thái (`ok` \| `fallback` \| `lost`) | không |
| `mat-runtime --check-project …` (005) | `matscada` | thêm luật 0.2 và luật chỉ có ở runtime (`E_SERIAL_NOT_ALLOWED` theo `serialPorts` của file cấu hình) | không |

Mã thoát như 005.

## 5. `deploy.sh`

Chuỗi của 005 giữ nguyên. Thêm:

1. **Trước khi cài**, dò điều kiện của §3 bằng lệnh chỉ đọc (`/proc/devices`, `/proc/cgroups`, `stat -c '%G %a' /dev/ttyAS*`), rồi chọn unit chính hoặc drop-in dự phòng. In ra lựa chọn.
2. **Sau khi đạt kiểm tra sức khỏe:**
   - `viewerAccess` là `any`: in cảnh báo "Trang xem đang mở cho mọi nguồn (chỉ nên dùng khi demo)";
   - lần đầu lên 0.5 từ bản < 0.5: in "Từ runtime 0.5, trang xem chỉ phục vụ mạng riêng. Đang xem qua port-forward 9080 thì đặt `viewerAccess: any` trong `/etc/mat-runtime/runtime.json` (chỉ khi demo), hoặc dùng VPN";
   - in `--list-serial` để người cài thấy cổng nào được phép.
3. **Không đụng** `/var/lib/mat-runtime/retain`.

## 6. `rollback.sh`

Không đổi. Tài liệu triển khai ghi thêm:

- rollback runtime về 0.4.x khi project đang chạy là 0.2: runtime 0.4 không hiểu 0.2, nên chạy ở chế độ "không có project hợp lệ". Trước khi rollback, dùng Khôi phục bản trước (005) về một bản project 0.1, hoặc nạp lại project 0.1 sau khi rollback;
- `audit.db` phiên bản 2 vẫn mở được bằng runtime 0.4 (bảng thêm bị bỏ qua);
- thư mục `retain/` bị bỏ qua.

## 7. Thứ tự khởi động (thêm vào §7 của 005)

1. Như 005, bước 1–2 (cấu hình, `audit.db`).
2. **Mới:** phục hồi lệnh ghi dở: dòng `tag_write_request` chưa có kết quả nhận bản ghi `interrupted`. Không ghi được audit: runtime vẫn chạy, nhưng từ chối mọi lệnh ghi (`AUDIT_UNAVAILABLE`).
3. Như 005, bước 3–4 (kho project, kiểm project; nạp 0.1 hoặc 0.2).
4. **Mới:** dựng Tag Engine (Tag v1, kế hoạch đọc, thứ tự tô-pô); mở kho Tag giữ qua mất điện, áp giá trị đã lưu; lượt engine đầu tiên.
5. Như 005, bước 5–8 (phiên, chứng chỉ, historian, hai context, tìm thiết bị).
6. **Mới:** chạy luồng của các kênh (driver), luồng audit kết quả ghi, luồng lưu Tag giữ qua mất điện.
7. Như 005, bước 9 (kiểm tra sức khỏe sau `execv`).

**Trước `execv`** (kích hoạt hay rollback của 005), theo thứ tự:

1. bộ điều phối ghi `quiesce` (FR-042);
2. kho Tag giữ qua mất điện ghi phần còn chờ;
3. dừng driver (đóng kết nối, nhả cổng serial);
4. các bước của 005 (đóng live 1012, commit historian, dừng CivetWeb, `auth-state.json`).
