# Thay đổi trên BL335 (Sprint 0)

| Ngày | Thay đổi | Hoàn tác |
|---|---|---|
| 2026-10-10 | `/etc/systemd/journald.conf`: `SystemMaxUse=50M`, `RuntimeMaxUse=30M`; vacuum journal 712 MB → 56 MB; `apt-get clean` | Xóa nội dung `[Journal]` trong file; log cũ không khôi phục được |
| 2026-10-10 | Gỡ `atscada-gateway.service` + `/opt/atscada-gateway` (theo yêu cầu người dùng) | Không hoàn tác được (còn `/etc/atscada`, `/var/lib/atscada`) |
| 2026-10-10 | Chạy thử `hello-armhf` từ `/root`, đã xóa sau khi chạy | Không còn gì |
| 2026-10-10 | Tạo `/root/matpoc/` (mat-poc, web/, poc.log); chạy PoC trên cổng 8080 khi thử rồi dừng | `rm -rf /root/matpoc` |
| 2026-10-10 | US3/T039: chép `apps/runtime-web/dist` (34 file, 5,1 MB) vào `/root/matpoc/web` (thư mục trống), chạy `mat-poc --port 8080 --docroot /root/matpoc/web` để đo SVG rồi dừng; thêm `/root/matpoc/svg.log`. Không đụng file nào khác; tiến trình đã dừng, cổng 8080 trống | `rm -rf /root/matpoc/web/* /root/matpoc/svg.log` (hoặc `rm -rf /root/matpoc`) |
| 2026-10-10 | T047 (chạy lại quickstart): chép `hello-armhf` vào `/tmp`, chạy rồi xóa (đã xác nhận không còn); thay `/root/matpoc/mat-poc` bằng bản build lại (cùng kích thước 161.348 B); thêm `/root/matpoc/poc-rerun.log`; chạy `mat-poc` 11:49:37–11:55:40 rồi dừng (đã thoát hẳn trước 11:56:08). Script đo chạy qua `ssh … sh -s`, không ghi file | `rm -f /root/matpoc/poc-rerun.log` (hoặc `rm -rf /root/matpoc`) |
| 2026-10-10 | Đo lại SVG (13:09): thay nội dung `/root/matpoc/web` bằng bản web mới (46 file, 19 SVG), thay `/root/matpoc/mat-poc` bằng bản build từ mã đã clang-format, thêm `/root/matpoc/svg2.log`; chạy `mat-poc` cổng 8080 khi đo rồi dừng (đã kiểm: không còn tiến trình, cổng trống) | `rm -rf /root/matpoc` |
| 2026-10-10 | T027 (Drogon): thêm `/root/matpoc/mat-poc-drogon` (1,97 MB) và log `drogon.log`, `race.log`; chạy thử/đo Drogon và CivetWeb sau khi sửa race (13:17–13:45), thay `/root/matpoc/mat-poc` bằng bản có sửa race; đã dừng cả hai, cổng 8080 trống | `rm -f /root/matpoc/mat-poc-drogon /root/matpoc/*.log` (hoặc `rm -rf /root/matpoc`) |

## Ghi nhận bổ sung (kiểm tra chỉ đọc ngày 2026-10-10 11:40)

Kiểm tra bằng SSH, không thay đổi gì trên thiết bị.

- **Khởi động lại:** `uptime -s` báo thiết bị khởi động lúc **10:20:35**. Nhật ký này không có ghi chép ai/vì sao khởi động lại. Thời điểm này nằm **trước** mọi phép đo (hồ sơ thiết bị 10:34, baseline 10:35), nên không có số đo nào bị gián đoạn.
- **File đổi trong ngày ngoài `/root/matpoc`:** chỉ `/etc/systemd/journald.conf` (10:11, theo bảng trên) và các file của sản phẩm atscada cũ: `/var/lib/atscada/{atscada.db 10:13, admin-status.json 08:40, https.json 08:35}`, `/root/atscada-deploy-20261009/*.new` (08:15–09:22, trước phiên làm việc này). Không có file nào khác do Sprint 0 tạo.
- **Còn lại của sản phẩm atscada cũ (không phải thay đổi của Sprint 0, chưa đụng tới):** `/etc/atscada`, `/var/lib/atscada`, `/root/atscada-deploy-*`, `/root/brand-20260918`, `/root/tun.ko`; các unit `atscada-admin.path`, `atscada-reboot.path`, `atscada-restart.path`, `atscada-time-sync.path`, `atscada-vpn.path`, `atscada-admin-recover.timer` và các service tương ứng vẫn `enabled`; `atscada-gateway.service` đã `not-found`.
- **Timer đang chạy nền:** `atscada-admin-recover.timer` (`OnUnitActiveSec=5`) kích hoạt `atscada-admin-recover.service` (oneshot, `/usr/local/libexec/atscada-admin recover`) **mỗi 5 giây**; mỗi lần mất khoảng 1 s và ghi 3 dòng vào journald (`Starting…`, `Succeeded.`, `Finished…`). Hệ quả cho Sprint 0: nhiều khả năng đây là một phần của CPU baseline 7,25% và của lượng ghi log xuống eMMC; **chưa tách được** vì chưa đo khi tắt timer (cần người dùng đồng ý: tắt timer là thay đổi sản phẩm cũ trên thiết bị). `top` tức thời lúc kiểm tra: CPU rảnh 95,7%, loadavg 0,50.


# Thay đổi trên BL335 (Sprint 1 — 002-vertical-slice)

Truy cập từ 2026-10-10 chiều: SSH qua IP công cộng `198.51.100.200:2222` (máy dev không còn ở LAN của thiết bị). Mật khẩu không ghi vào repo.

| Ngày (UTC) | Thay đổi | Hoàn tác |
|---|---|---|
| 2026-10-10 08:45 | Chép gói triển khai vào `/tmp/mat-deploy/` (`mat-runtime-armhf.tar.gz` 414 KB, `deploy.sh`, `rollback.sh`) | `rm -rf /tmp/mat-deploy` |
| 2026-10-10 08:45 | `deploy.sh` lần đầu: tạo user hệ thống `matscada` (`useradd --system`, shell `/usr/sbin/nologin`, không home) | `userdel matscada` (sau khi gỡ dịch vụ) |
| 2026-10-10 08:45 | Cài `/opt/mat-runtime/` (bin, web, project tank-demo, schemas, deployment), `/etc/mat-runtime/runtime.json`, `/etc/systemd/system/mat-runtime.service`; `systemctl enable` + `restart mat-runtime` (cổng 8080, `User=matscada`, `MemoryMax=300M`). Trước đó đã kiểm: cổng 8080 trống, `mat-poc` không cài thành dịch vụ (không cần dừng gì) | `systemctl disable --now mat-runtime; rm -f /etc/systemd/system/mat-runtime.service; systemctl daemon-reload; rm -rf /opt/mat-runtime /opt/mat-runtime.prev /opt/mat-runtime.failed /etc/mat-runtime; userdel matscada` |
| 2026-10-10 08:47–09:05 | Đo đạc Sprint 1 (không đổi file): load-tester từ máy dev qua Internet (cổng công cộng 9080 → 8080); `tools/measure/sample.sh` chạy qua `ssh … sh -s` (không ghi file trên thiết bị) | Không cần |
| 2026-10-10 09:07 | `deploy.sh` lần 2 (thêm log + bộ đếm `writeFailedTotal`): backup bản 1 thành `/opt/mat-runtime.prev`, kích hoạt bản mới, health check OK | `sh /opt/mat-runtime/deployment/rollback.sh` |
| 2026-10-10 09:12 | `deploy.sh` lần 3 (ghi quá hạn trả slot ngay): `.prev` = bản lần 2 | `sh /opt/mat-runtime/deployment/rollback.sh` |
| 2026-10-10 09:15 | Kiểm khả năng phục hồi: `kill -9` tiến trình `mat-runtime` (dịch vụ của dự án); systemd khởi động lại sau 2,4 s (`NRestarts=1`). **Chưa** thử khởi động lại thiết bị (chờ người dùng đồng ý) | Không cần |
| 2026-10-10 09:40 | `deploy.sh` lần 4 (bản vá sau review: CivetWeb `NO_FILES` + giới hạn frame, đóng cưỡng bức, unit systemd siết thêm `CapabilityBoundingSet=`, `SystemCallFilter=@system-service`, `MemoryDenyWriteExecute`…; kiểm SHA-256; validate bằng user `matscada`). Unit cũ được giữ ở `/etc/systemd/system/mat-runtime.service.prev` | `sh /opt/mat-runtime/deployment/rollback.sh` (khôi phục cả unit) |
| 2026-10-10 09:42–09:45 | Đo hồi quy sau review (10 + 1 client × 120 s, 10 client × 60 s) qua Internet; `sample.sh` qua `ssh … sh -s` (không ghi file) | Không cần |
| 2026-10-10 09:45 | `deploy.sh` lần 5 (schema thêm `maxLength` cho SemVer). Trạng thái cuối: `/opt/mat-runtime` = bản lần 5, `/opt/mat-runtime.prev` = bản lần 4, dịch vụ `active` | `sh /opt/mat-runtime/deployment/rollback.sh` |
