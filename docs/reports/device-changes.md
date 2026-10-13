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
| 2026-10-10 09:15 | Kiểm khả năng phục hồi: `kill -9` tiến trình `mat-runtime` (dịch vụ của dự án); systemd khởi động lại (`NRestarts=1`), `system/info` trả `active` sau 2,4 s. **Chưa** thử khởi động lại thiết bị (chờ người dùng đồng ý) | Không cần |
| 2026-10-10 09:40 | `deploy.sh` lần 4 (bản vá sau review: CivetWeb `NO_FILES` + giới hạn frame, đóng cưỡng bức, unit systemd siết thêm `CapabilityBoundingSet=`, `SystemCallFilter=@system-service`, `MemoryDenyWriteExecute`…; kiểm SHA-256, gói chép kèm `mat-runtime-armhf.tar.gz.sha256` vào `/tmp/mat-deploy/`; validate bằng user `matscada`). Unit cũ được giữ ở `/etc/systemd/system/mat-runtime.service.prev` | `sh /opt/mat-runtime/deployment/rollback.sh` (khôi phục cả unit) |
| 2026-10-10 09:42–09:45 | Đo hồi quy sau review (10 + 1 client × 120 s, 10 client × 60 s) qua Internet; `sample.sh` qua `ssh … sh -s` (không ghi file) | Không cần |
| 2026-10-10 09:45 | `deploy.sh` lần 5 (schema thêm `maxLength` cho SemVer). Trạng thái cuối: `/opt/mat-runtime` = bản lần 5, `/opt/mat-runtime.prev` = bản lần 4, dịch vụ `active`. Lần 5 không đổi unit nên `mat-runtime.service.prev` vẫn là unit của lần 1–3: `rollback.sh` lúc này chạy bản lần 4 với unit cũ, chưa siết | `sh /opt/mat-runtime/deployment/rollback.sh` |
| 2026-10-10 09:40–09:45 | Ghi bổ sung ngày 2026-10-11 (audit): `deploy.sh` lần 4 và 5 ghi kết quả `--check-project` vào `/tmp/mat-check-project.json` (root tạo, không xóa; lần 1–3 ghi `check-project.json` trong thư mục cài, đã mất theo các lần backup sau). `deploy.sh` hiện tại dùng file tạm `mktemp` và xóa ngay sau khi dùng. Chưa kiểm trên thiết bị xem file còn không | `rm -f /tmp/mat-check-project.json` |

Từ 2026-10-10 17:50 UTC thiết bị được deploy lại trong feature 003 (bảng dưới), nên lệnh hoàn tác `rollback.sh` của các lần 2–5 không còn đúng. Gỡ hoàn toàn: lệnh ở dòng 08:45 (cài `/opt/mat-runtime/`) cộng `rm -f /etc/systemd/system/mat-runtime.service.prev /tmp/mat-check-project.json` và `rm -rf /opt/mat-runtime.new /tmp/mat-deploy` (xem [mat-runtime.md §7](../deployment/mat-runtime.md)). `rollback.sh` chưa được chạy tay lần nào trong Sprint 1.

# Thay đổi trên BL335 (feature 003 — lưu trữ dữ liệu Tag)

Người dùng cho phép làm T075–T078 ngày 2026-10-10 ("xử lí cả đi nhé"). Truy cập qua `198.51.100.200:2222`. Không đụng các unit `atscada-*`.

| Ngày (UTC) | Thay đổi | Hoàn tác |
|---|---|---|
| 2026-10-10 17:41 | Kiểm tra chỉ đọc: `mat-runtime` 0.2.0 `active`, `/` còn 5,9 GB, RAM trống 878 MB, chưa có `/var/lib/mat-runtime`, chưa cài thư viện client DB | Không cần |
| 2026-10-10 17:50 | T075: `deploy.sh` gói 0.3.0 (`tank-demo` có lưu trữ; SHA-256 `2ca7acea…`), qua một phiên SSH với `mktemp -d`. Unit mới (có `StateDirectory`, `LimitCORE=0`) được cài, bản cũ giữ ở `.prev`. Bản mới **dừng ngay khi khởi động** (`free(): invalid pointer`); health check thất bại nên **`deploy.sh` tự rollback**: dịch vụ chạy lại bản 0.2.0, unit cũ được khôi phục. Còn lại: `/opt/mat-runtime.failed` (bản 0.3.0 lỗi), `/var/lib/mat-runtime/history.db*` (tạo bởi `StateDirectory` trong lúc chạy thử) | `rm -rf /opt/mat-runtime.failed /var/lib/mat-runtime` |
| 2026-10-10 17:58–18:16 | Chẩn đoán (không đổi dịch vụ): chạy tay bản 0.3.0 lỗi, rồi hai bản armhf có AddressSanitizer (97 MB, trước và sau khi vá) bằng user `matscada`, cổng 18080, dữ liệu trong thư mục tạm `/tmp/mat-diag-*`, `/var/tmp/mat-asan-*`. Mọi thư mục tạm đã xóa ngay sau mỗi lần chạy. Kết quả: lỗi tràn heap trong SQLite 3.54.0 trên máy 32-bit (`third_party/sqlite/PATCHES.md`); bản ASan đã vá chạy 30 s không báo lỗi | Không cần (đã xóa) |
| 2026-10-10 18:19 | Xóa `/var/lib/mat-runtime/history.db*` do các lần khởi động lỗi để lại (không có dữ liệu thật). T075: `deploy.sh` gói 0.3.0 đã vá SQLite (`tank-demo`, SHA-256 `22675b9f…`): health check OK sau 1 s, `historian.state=running`. `/var/lib/mat-runtime` thuộc `matscada:matscada`, quyền 700 (`StateDirectory`). `.prev` = bản 0.2.0 | `sh /opt/mat-runtime/deployment/rollback.sh` |
| 2026-10-10 18:20–18:23 | T077: `kill -9` tiến trình `mat-runtime` 10 lần ở thời điểm ngẫu nhiên; systemd khởi động lại mỗi lần (`NRestarts` = 10) | Không cần |
| 2026-10-10 18:23 | T076: `deploy.sh` gói 0.3.0 với project `bench-500` (SHA-256 `fa7d40f7…`) để đo; `.prev` = bản `tank-demo` | `sh /opt/mat-runtime/deployment/rollback.sh` |
| 2026-10-10 18:24–18:54 | T076: đo 30 phút (10 client qua cổng công cộng 9080; `sample.sh` qua `ssh … sh -s`, không ghi file) | Không cần |
| 2026-10-10 18:56 | T078: `apt-get update` rồi `apt-get install --no-install-recommends libmariadb3 libsybdb5 libpq5 libcurl4`: 24 gói mới kể cả phụ thuộc (khoảng 25 MB). **Giữ lại** để dùng với DB thật | `apt-get remove libmariadb3 libsybdb5 libpq5 libcurl4 && apt-get autoremove` |
| 2026-10-10 18:57 | T078: `mat-runtime --set-secret` cho 4 kết nối thử: tạo `/etc/mat-runtime/secrets.json` (`root:matscada`, 0640) | xóa sau đợt thử (dòng dưới) |
| 2026-10-10 18:58–19:09 | T078: đường hầm SSH ngược từ máy dev (`sshd` mở 127.0.0.1:23306/11433/15432/18086 trên thiết bị, chỉ trong lúc phiên SSH còn) và `deploy.sh` project `tank-demo` + 4 kết nối tới các cổng đó (SHA-256 `216be755…`) | đóng phiên SSH; deploy lại `tank-demo` (dòng dưới) |
| 2026-10-10 19:09 | Dọn sau T078: xóa `/etc/mat-runtime/secrets.json` (chỉ có bí mật thử) và `/opt/mat-runtime.failed` (bản lỗi của lần deploy đầu); `deploy.sh` gói 0.3.0 `tank-demo` (SHA-256 `b8d4764a…`, health check OK, không có kết nối DB ngoài); đóng đường hầm (không còn cổng nào mở). **Trạng thái cuối:** `/opt/mat-runtime` = 0.3.0 `tank-demo`, `.prev` = project T078, dữ liệu ở `/var/lib/mat-runtime` (gồm các bảng của đợt đo `bench-500`; chúng thành bảng mồ côi và tự xóa sau 7 ngày theo thời hạn cuối cùng đã biết), thư viện client DB đã cài | `sh /opt/mat-runtime/deployment/rollback.sh` (về project T078: không nên), hoặc gỡ hẳn theo hướng dẫn hoàn tác của Sprint 1 cộng `rm -rf /var/lib/mat-runtime` |

**Lưu ý về unit dự phòng (ghi ngày 2026-10-11, suy ra từ các dòng trên, chưa SSH kiểm):**

- Hiện trạng: lần 18:19 đổi unit, nên `.service.prev` là unit Sprint 1 (lần 4). Hai lần 18:23 và 19:09 không đổi unit, và `deploy.sh` lúc đó chưa dọn `.prev` lỗi thời. Vì vậy `mat-runtime.service.prev` không đi cặp với `/opt/mat-runtime.prev` (0.3.0, project T078).
- Hệ quả: `rollback.sh` chạy tay lúc này sẽ chạy 0.3.0 với unit cũ, thiếu `StateDirectory`, nên lưu trữ dữ liệu có thể không ghi được. **Không rollback tay.**
- Cách khắc phục: lần deploy kế tiếp bằng `deploy.sh` bản 2026-10-11 tự dọn `.prev` lỗi thời ([mat-runtime.md §6](../deployment/mat-runtime.md)).

# Thay đổi trên BL335 (007-screens-widgets, runtime 0.6.0): mẫu ghi

Điền khi cài (task T148, T149, T150); chưa có thay đổi nào trong feature này vì chưa có SSH.

| Ngày (UTC) | Thay đổi | Hoàn tác |
|---|---|---|
| (chưa cài) | Gói runtime 0.6.0: `deploy.sh`; thêm `schemas/0.2/`, `schemas/widgets.catalog.json`, `web/login.html` | `sh /opt/mat-runtime/deployment/rollback.sh` (runtime 0.5 không nhận project 0.3: khôi phục project 0.2 bằng Studio) |
| (chưa cài) | Tài khoản `operator`, `viewer`: `mat-runtime --user-add` | `mat-runtime --user-disable <tên>` |
| (chưa cài) | Chứng chỉ: `--regen-cert` hoặc `--make-csr` + `--import-cert` (đổi fingerprint, Studio ghim lại) | `tls/server.pem.prev` → `server.pem`, khởi động lại |

## 2026-10-13: khảo sát chỉ đọc cổng serial và RS485 (006 T006)

Người dùng cho phép SSH ("SSH vào BL335 được không"). **Không thay đổi gì trên thiết bị**: chỉ chạy `uname`, `ls /dev/tty*`, đọc `/sys/class/tty`, `/proc/consoles`, `dmesg`, `systemctl show`, `wget` tới `127.0.0.1:8080/api/v1/system/info`, đọc `/etc/mat-runtime/runtime.json`. Không mở cổng serial nào. Không đụng `atscada-*` hay `piano-edtech-*`.

Kết quả:
- Kernel 5.4.61 armv7l, systemd 245, cgroup v1 (`/sys/fs/cgroup` là tmpfs): `DeviceAllow` dùng được.
- `ttyAS0`: console của hệ điều hành (`console=ttyAS0,115200`, `serial-getty@ttyAS0` đang chạy): KHÔNG dùng.
- `ttyAS2`–`ttyAS5`: UART của chip (driver SUNXI, major 511), nhóm `dialout`, không tiến trình nào giữ. `ttyAS1` tắt trong device tree. Cổng nào ra đầu RS485 chưa xác nhận (cần bộ chuyển thật).
- `ttyS0`–`ttyS3`: `serial8250` (không có UART thật tương ứng trong device tree đã bật): để ngoài danh sách cho phép.
- `ttyUSB0`–`ttyUSB3`: modem 4G Quectel EC25-EUX (`2c7c:0125`): KHÔNG dùng.
- Nhóm `dialout` chỉ có `atscada`; `matscada` không thuộc nhóm nào.
- Unit `mat-runtime` hiện: `PrivateDevices=yes`, `DevicePolicy=closed`, `SupplementaryGroups=` rỗng: runtime chưa mở được cổng serial.
- Kernel: không thấy cấu hình RS485 riêng cho driver SUNXI; chế độ RS485 của kernel (`TIOCSRS485`) khả năng không có, cần bộ chuyển tự đổi chiều hoặc điều khiển chiều bằng GPIO (chưa kiểm).
- Runtime đang chạy; cấu hình `/etc/mat-runtime/runtime.json` đủ khóa của 0.3.x (chưa có khóa mới). Còn 5,9 GB trống trên `/`, RAM 993 MB (84 MB đã dùng).

Hoàn tác: không có thay đổi để hoàn tác.

## 2026-10-13: cài runtime 0.5.0 lên BL335 (người dùng yêu cầu: "cài luôn đi cho tôi xem thử")

Gói `build/mat-runtime-armhf.tar.gz` (SHA-256 `706c2ccce64348c2b07447a9263e041fd1bb93da63fffead04f9df965314ae08`, runtime 0.5.0, đã qua kiểm đầy đủ GĐ 2). Dùng `deploy.sh` cùng phiên bản với gói (commit `bb765d1`); `deploy.sh` mới hơn yêu cầu `schemas/widgets.catalog.json` của 0.6.0 nên dừng đúng cách, bản cũ không bị đụng.

Thay đổi trên thiết bị:
1. `/opt/mat-runtime` ← runtime 0.5.0; bản 0.3.0 cũ ở `/opt/mat-runtime.prev`. Unit `/etc/systemd/system/mat-runtime.service` cập nhật (bản cũ ở `.prev`). Health check đạt sau 1 s, project `tank-demo` giữ nguyên (digest `sha256:9ba112c6…61edb7`).
2. Chứng chỉ HTTPS tự sinh: fingerprint `00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00`.
3. Tạo tài khoản `admin` (administrator) và `kysu1` (engineer) bằng `--user-add --password-stdin`; mật khẩu ngẫu nhiên, không lưu trong repo.
4. `/etc/mat-runtime/runtime.json`: thêm `"viewerAccess": "any"` (bản sao lưu `runtime.json.bak-20261013`) để trang xem qua port-forward 9080 còn xem được từ Internet. Mặc định `private`; đặt lại khi không demo.
5. Thư mục tạm `/tmp/tmp.IBeGI9FyNz` (gói và script); có thể xóa.

Không đụng `atscada-*`, `piano-edtech-*`, không mở thêm cổng nào ra Internet.

Hoàn tác: `sh rollback.sh` trong thư mục tạm (đưa `/opt/mat-runtime.prev` và unit `.prev` về), hoặc trả `runtime.json.bak-20261013`. Cẩn thận: `rollback.sh` chỉ dùng khi cần, bản cũ 0.3.0 không biết các khóa mới của `runtime.json` (xóa dòng `viewerAccess` trước).

Số đo trên BL335 (armv7l, 2 CPU, Cortex-A7):
- `--auth-bench` Argon2id m=19456 KiB, t=2, p=1: **trung vị 882,7 ms** (min 880,9; max 909,5), RSS đỉnh +20,5 MiB. Vượt mục tiêu R7 0,8 s, nên hạ t=1 (ADR-011).
- Đăng nhập HTTPS trọn (qua đường hầm SSH, ghim fingerprint): 983–1039 ms.
- `mat-runtime` RSS 6,7 MB khi rảnh.
