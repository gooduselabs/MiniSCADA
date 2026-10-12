# Contract: cấu hình, file, lệnh trên thiết bị

**Feature**: [spec.md](../spec.md) · **Research**: R4, R5, R8, R11, R13

Bổ sung cho [runtime-config.md](../../002-vertical-slice/contracts/runtime-config.md) (Sprint 1) và [device.md](../../003-data-logging/contracts/device.md) (feature 003). Các khóa, lệnh cũ giữ nguyên. Khóa lạ trong `runtime.json` vẫn làm runtime thoát mã 2, nên mọi khóa dưới đây đều có mặc định: file đang có trên thiết bị không phải sửa.

## 1. Khóa mới trong `runtime.json`

| Khóa | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `httpsPort` | int | 8443 | `0` (tắt HTTPS và mọi API kỹ thuật) hoặc 1024–65535, khác `port` |
| `httpsThreads` | int | 8 | 4–32 (worker của context HTTPS) |
| `discoveryEnabled` | bool | true | `false`: không mở socket tìm thiết bị (FR-004) |
| `discoveryPort` | int | 8446 | 1024–65535 (UDP) |
| `deviceName` | string | hostname | 1–32 byte UTF-8 in được |
| `deviceModel` | string | `"BL335"` | 1–32 byte |
| `projectStoreDir` | string | `<dataDir>/projects` | thư mục ghi được |
| `projectBackups` | int | 3 | 1–10 (FR-024) |
| `usersFile` | string | `/etc/mat-runtime/users.json` | |
| `auditRetentionDays` | int | 365 | 30–3650 |
| `auditMaxMB` | int | 64 | 8–1024 |

**Ý nghĩa mới của `projectDir`:** nguồn của project cài theo cách cũ. Chỉ dùng khi kho trống (lần đầu chạy 0.4.0), hoặc khi chạy thử với `--project-dir` mà không có kho.

Hằng số, không cấu hình (spec cố định): phiên hết hạn sau 30 phút rảnh, tối đa 12 giờ; khóa tạm sau 5 lần sai, trong 5 phút.

Hằng số của context HTTPS (`server/http/web_contexts.hpp`, ADR-010):
- mỗi request, kể cả bắt tay TLS, có 10 s (`request_timeout_ms`);
- kết nối rảnh giữa hai request được giữ **15 s** (`keep_alive_timeout_ms`; chốt 2026-10-12, trước đó 60 s). Mỗi kết nối đang mở, kể cả lúc rảnh, giữ một trong `httpsThreads` worker;
- Studio đóng kết nối rảnh sau 10 s, trước thiết bị. Context HTTP không giữ kết nối (như 0.3.0).

**Tham số dòng lệnh mới** (để test và chạy x64): `--https-port <n>`, `--project-store-dir <dir>`, `--users-file <file>`, `--no-discovery`.

**Cờ test của bước chuyển project** (T108): `--test-kill-at <bước>` (SIGKILL ngay trước bước `verify-package`, `validate`, `backup` hoặc `activate`) và `--test-health die|hang` (bản đang thử chết hoặc treo; không áp cho rollback). Chỉ có khi build với `-DMAT_TEST_HOOKS=ON` (runtime x64 của `tools/device-it.ps1`); bản armhf không có, và từ chối như mọi tham số lạ. Cờ đi theo `argv` qua `execv`.

## 2. File và thư mục

| Đường dẫn | Chủ, quyền | Ai tạo | Qua `deploy.sh` / `rollback.sh` |
|---|---|---|---|
| `/var/lib/mat-runtime/tls/server.pem` | `matscada`, `0600`; thư mục `0700` | runtime (lần chạy đầu), `--regen-cert` | giữ |
| `/var/lib/mat-runtime/device-id` | `matscada`, `0600` | runtime (lần chạy đầu) | giữ |
| `/var/lib/mat-runtime/audit.db` (+ `-wal`, `-shm`) | `matscada`, `0600` | runtime; lệnh qua tiến trình con đã hạ quyền | giữ |
| `/var/lib/mat-runtime/projects/` | `matscada`, `0700` | runtime | giữ |
| `/etc/mat-runtime/users.json` | `root:matscada`, `0640` | lệnh `--user-*` | giữ |
| `/run/mat-runtime/auth-state.json` | `matscada`, `0600` | runtime, ngay trước `execv` | mất khi dịch vụ dừng hoặc thiết bị khởi động lại |

`history.db` của 003 không đổi.

## 3. Unit systemd

Thêm vào `[Service]`; phần sandbox giữ nguyên:

```ini
# Phiên đăng nhập đi qua lần execv khi kích hoạt project (tmpfs, mất khi dừng dịch vụ)
RuntimeDirectory=mat-runtime
RuntimeDirectoryMode=0700
```

- `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX` giữ nguyên: runtime lấy địa chỉ card bằng `ioctl`, không dùng netlink (research R2).
- `ReadOnlyPaths=/opt/mat-runtime /etc/mat-runtime` giữ nguyên: runtime chỉ đọc `users.json`.
- `execv` chính binary được phép với `SystemCallFilter=@system-service` và `NoNewPrivileges=true`.

## 4. Lệnh trên thiết bị

BL335 không có `sudo`: chạy bằng root. Lệnh chỉ đọc dữ liệu thì chạy bằng `runuser -u matscada --`, như 003.

| Lệnh | Chạy bằng | Làm gì | Audit |
|---|---|---|---|
| `mat-runtime --user-add <tên> --role <role> [--password-stdin]` | root | thêm tài khoản; hỏi mật khẩu hai lần (TTY tắt echo) hoặc đọc một dòng stdin | `account.create` |
| `mat-runtime --user-passwd <tên> [--password-stdin]` | root | đặt mật khẩu mới; `rev` tăng: hủy phiên của tài khoản | `account.password` |
| `mat-runtime --user-role <tên> <role>` | root | đổi role; `rev` tăng | `account.role` |
| `mat-runtime --user-disable <tên>`, `--user-enable <tên>` | root | tắt, bật; `rev` tăng | `account.disable`, `account.enable` |
| `mat-runtime --user-unlock <tên>` | root | xóa khóa tạm (`unlockSeq` tăng) | `account.unlock` |
| `mat-runtime --user-list` | root | tên, role, bật/tắt, lần đổi cuối. Không in hash | không |
| `mat-runtime --cert-fingerprint` | root hoặc `matscada` | in `SHA256 Fingerprint=AB:CD:…`, giống `openssl x509 -fingerprint -sha256` | không |
| `mat-runtime --regen-cert` | root | sinh khóa và chứng chỉ mới (ghi bằng tiến trình con `matscada`), in fingerprint mới, rồi `systemctl try-restart mat-runtime`. Cảnh báo: Studio sẽ chặn tới khi kỹ sư gỡ ghim và ghim lại | `cert.regenerate` |
| `runuser -u matscada -- mat-runtime --export-audit [--from …] [--to …] [--format csv\|jsonl]` | `matscada` | xuất audit ra stdout, mới nhất sau cùng; CSV theo quy tắc chống CSV injection của `--export-history` | `audit.export` |

**`--export-audit` (chốt khi cài T146):** thêm `--tz ±HH:MM` (mặc định `+07:00` như `--export-history`), `--data-dir`, `--config`; `--from`/`--to` là giờ địa phương theo `--tz`, khoảng `[from, to)`. CSV có cột `id,time,ts_ms,clock_ok,user,role,source,channel,action,target,result,code,detail,count`; JSONL cùng dạng `AuditRecord` của `GET /audit`. Lệnh ghi `audit.export` (`channel` `cli`, `source` `cli`, `target` = định dạng) **trước** khi in dòng đầu, nên bản xuất kết thúc bằng chính dòng này. Mã thoát: `0`; `2` tham số sai; `4` không có `audit.db` (không tạo) hoặc không mở được; `5` không ghi được `audit.export` (không in gì) hoặc đầu ra hỏng.
| `runuser -u matscada -- mat-runtime --project-status` | `matscada` | bản đang chạy, các bản dự phòng, thao tác dở dang (đọc `state.json`) | không |
| `mat-runtime --check-project --project-store <dir> [--schemas-dir <dir>]` | `matscada` | kiểm project **đang chạy trong kho** bằng binary này (`deploy.sh` dùng) | không |
| `mat-runtime --check-package <file>` | bất kỳ | kiểm một gói `.matscada` theo contract; in digest hoặc mã lỗi | không |
| `mat-runtime --auth-bench [--m <KiB>] [--t <n>]` | bất kỳ | đo thời gian băm Argon2id, không ghi gì (task ⚠️🔌) | không |

**Quy tắc chung của lệnh tài khoản:**

- Mật khẩu không bao giờ là tham số dòng lệnh. Dài 15–128 ký tự (UTF-8), khác tên tài khoản. Lệnh không in mật khẩu.
- Ghi `users.json`: file tạm cùng thư mục, `fsync`, `chown root:matscada`, `chmod 0640`, `rename`.
- Ghi audit trước khi đổi; không ghi được thì không đổi gì (mã 5).
- Không cho xóa hoặc hạ role administrator cuối cùng còn bật.

**Mã thoát:** `0` thành công; `1` kiểm thất bại (`--check-*`); `2` tham số sai; `4` không phải root, tên không hợp lệ, không ghi được file; `5` không ghi được audit; `6` file hỏng hoặc không đọc được.

Của `--project-status` và `--check-project --project-store` (T107, T108): chỉ đọc, không tạo thư mục. `--project-status` nhận `--config`, `--data-dir`, `--project-store-dir`; kho chưa có `state.json` thì in dòng báo và thoát `0`. `--check-project --project-store`: kho không có `state.json`, `state.json` hỏng hoặc thiếu schema thì thoát `6` (`deploy.sh` coi mọi mã khác `0` là dừng); kho không có project đang chạy thì hợp lệ (`0`, `"project": null`). Binary thoát `4` khi `execv` chuyển project lỗi: CivetWeb đã dừng nên để systemd chạy lại (`Restart=always`).

## 5. `deploy.sh` (cập nhật runtime bằng gói runtime)

Chuỗi cũ giữ nguyên (checksum → stage → validate → backup → activate → health check → rollback). Thay đổi:

1. **Validate:**
   - kho đã có (`/var/lib/mat-runtime/projects/state.json`): kiểm **project đang chạy trong kho** bằng binary mới:

     ```sh
     runuser -u matscada -- "$NEW/bin/mat-runtime" --check-project \
         --project-store /var/lib/mat-runtime/projects --schemas-dir "$NEW/schemas"
     ```

     Lỗi thì dừng, giữ runtime cũ, in "runtime mới không chạy được project đang chạy: nạp project tương thích trước";
   - chưa có kho: kiểm project đi kèm gói như hiện nay.
2. **Health check:** như cũ. Thêm kiểm cổng HTTPS mở được, nếu `httpsPort ≠ 0`.
3. **Sau khi đạt:**
   - in fingerprint (`--cert-fingerprint`), kèm lời nhắc ghi lại để so khi ghim trong Studio;
   - nếu chưa có tài khoản administrator nào: có TTY thì chạy `--user-add admin --role administrator`; không có TTY thì in "BƯỚC BẮT BUỘC: tạo tài khoản quản trị bằng …" (FR-011).
4. Không đụng `/var/lib/mat-runtime` (giữ như 003).

## 6. `rollback.sh`

Không đổi. Ghi chú trong tài liệu triển khai:

- Rollback giữa các bản ≥ 0.4.0 giữ nguyên project đang chạy (kho nằm ngoài `/opt/mat-runtime`).
- Rollback về bản < 0.4.0: runtime cũ không biết kho, nên chạy project đi kèm gói runtime cũ. Nạp lại project bằng Studio sau khi cập nhật runtime lên lại ≥ 0.4.0.

## 7. Thứ tự khởi động

1. Đọc cấu hình; `psa_crypto_init()`.
2. Mở `audit.db`; dọn theo thời hạn nếu đồng hồ đã đồng bộ. Không mở được: runtime vẫn chạy trang xem, nhưng từ chối đăng nhập và mọi thao tác thay đổi (`AUDIT_UNAVAILABLE`).
3. Đọc `state.json`, quyết định bản chạy ([data-model.md](../data-model.md) §9). Lần đầu: nhận project cũ vào kho (audit `project.adopt`).
4. Kiểm project (như hiện nay); không hợp lệ thì không kích hoạt.
5. Nạp `auth-state.json` nếu có (sau `execv`), rồi xóa file.
6. Chứng chỉ: đọc `server.pem`; chưa có thì sinh (audit `cert.generate`); hỏng thì tắt HTTPS.
7. Historian (003).
8. Context HTTP, rồi context HTTPS; luồng tìm thiết bị.
9. Có `pending` thì kiểm sức khỏe, rồi commit hoặc rollback (research R13).
