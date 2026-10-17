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

## 2026-10-13 (chiều): đo nghiệm thu trên BL335 bằng agent, bị dừng giữa chừng khi phiên kết thúc

Agent đo (005 T159–T160, T164; 006 T169) đã chạy trước khi bị dừng và **chưa kịp ghi nhật ký**; ghi lại ở đây theo bằng chứng còn lại (`docs/reports/005-bl335-*.json`). Chưa thể kiểm lại trên thiết bị (SSH đang tắt).

Thay đổi trên thiết bị (từ kết quả đo):
- Đã **nạp xuống nhiều project thử** bằng API (mỗi project 10 lần nạp xuống rồi đọc lên): `tank-demo`, `bench-500`, `tank-viet`. Kho project nay ở `seq = 31`, bản **đang chạy là `tank-viet` 1.0.10** (digest `sha256:ae500357…`), không còn là `tank-demo`. Kho giữ 3 bản dự phòng.
- Đã thử 53 gói độc (vector gói) trên thiết bị: cả 53 bị từ chối đúng mã, bản đang chạy không đổi.
- Chưa biết: `mat-runtime.service` đã được đổi trên thiết bị hay chưa (bản trong repo đã đổi sang `DevicePolicy=closed` + `DeviceAllow=char-ttyAS rw` + `SupplementaryGroups=dialout`, T169).
- Có thể còn thư mục tạm trong `/tmp` và đường hầm SSH chạy nền.

Việc cần làm khi SSH bật lại:
1. Khôi phục project `tank-demo` làm bản đang chạy (nạp xuống lại bằng `device-api.mjs deploy`, hoặc khôi phục bản dự phòng nếu còn).
2. Kiểm unit (`systemctl show mat-runtime -p PrivateDevices -p DevicePolicy -p DeviceAllow`), khớp với repo hoặc trả về như cũ.
3. Dọn `/tmp`, kiểm `system/info`, `systemctl is-active mat-runtime`.

Số đo thật (chi tiết trong các file JSON): nạp xuống 30/30 giống hệt, trung vị 3,9–4,7 s (tối đa 7,0 s); runtime rảnh RSS 7,3 MB; 8 kết nối im lặng bị đóng sau 10,0 s với CPU +0,5 điểm; 8 kết nối rảnh (keep-alive) đóng sau 13,9–15,0 s; đăng nhập trung vị 1,15 s qua đường hầm WAN (bắt tay TLS 133 ms) nên vượt 1 s: hạ Argon2id t = 1 (ADR-011).


## 2026-10-16 — Khảo sát, khôi phục tank-demo, baseline runtime 0.5.0 (người dùng cho phép SSH 192.168.1.110)

## 2026-10-16: agent THIẾT BỊ (người dùng cho phép: "SSH vào 192.168.1.110")

Truy cập qua LAN 192.168.1.110:22. Không đụng `atscada-*`, `piano-edtech-*`, không reboot, không đổi mật khẩu root/SSH.

### Khảo sát chỉ đọc (11:49 +07)
- Thiết bị khởi động lại lúc ~08:13 ngày 2026-10-16 (`uptime -s`). Nguyên nhân KHÔNG xác định được: journal của lần khởi động trước không còn (`journalctl -b -1` báo không có), `last -x` không có dòng `shutdown` nào ở bất kỳ lần boot nào (gợi ý các lần khởi động lại đều không qua tắt máy sạch: mất điện, watchdog phần cứng `sunxi-wdt` 16 s do `atscada-watchdog.conf`, hoặc reset). Đồng hồ lúc boot lệch (wtmp ghi boot "Oct 15 09:35", NTP chỉnh sau). Không có dấu hiệu do mat.
- runtime 0.5.0 (`/opt/mat-runtime`, 4.114.628 B; `.prev` = 0.3.0), systemd 245, kernel 5.4.61. Unit `mat-runtime.service` ĐÃ có cấu hình T169 (PrivateDevices=false, DevicePolicy=closed, DeviceAllow=char-ttyAS rw, SupplementaryGroups=dialout): khác bản repo `deployment/systemd/mat-runtime.service` chỉ ở 3 dòng chú thích. cgroup devices.list cho phép các thiết bị giả chuẩn và `136:*` (pts), cần kiểm thêm major 511 khi thử cổng thật. `/dev/ttyAS2-5` root:dialout 660, `ttyAS0` root:tty 620; dialout = `atscada`. Tức: unit đã được đổi trước đó (bản sao lưu `/etc/systemd/system/mat-runtime.service.bak-d9-20261013`), không đổi gì lần này.
- Project đang chạy lúc khảo sát: `driver-it-bench` 0.1.0 (seq 44, digest `sha256:b289f09f…`), không phải `tank-viet`. Kho: 43 `driver-it-read`, 42 `tank-demo` 0.1.0 (`sha256:9ba112c6…`), 41 `tank-demo` 7.3.3.
- Tài khoản mat: admin, kysu1, vh1, vh2, xem1 (mật khẩu không biết với agent này).
- `/tmp` không còn gì do mat (xóa sau reboot); chỉ có thư mục `systemd-private-*`. `/root/matpoc` (8,2 MB, PoC Sprint 0) còn nguyên, CHƯA xóa (chờ quyết định).
- Cổng nghe: 8080, 8443 (mat-runtime), 22 (sshd), 53 (resolved, nội bộ). `/` còn 5,9 GB, RAM 993 MB (79 MB dùng), 2 CPU, nhiệt độ 37,3 °C.

### Thay đổi
| Giờ (+07) | Thay đổi | Hoàn tác |
|---|---|---|
| 11:50 | Tạo tài khoản tạm `mat-tmp-eng` (engineer) bằng `mat-runtime --user-add ... --password-stdin` (mật khẩu ngẫu nhiên, không lưu, file tạm ở scratchpad đã xóa) để dùng API khôi phục | `mat-runtime --user-disable mat-tmp-eng` (ĐÃ chạy 11:51; tài khoản còn trong users.json ở trạng thái tắt; không có lệnh xóa) |
| 11:51 | `device-api.mjs ... login restore --seq 42 --base-digest sha256:b289f09f… logout` qua HTTPS 8443 có ghim fingerprint: kích hoạt lại `tank-demo` 0.1.0 (seq 42), op `committed`, PID runtime giữ nguyên 2240 (execv). Kho giờ: đang chạy 42 (nguồn `restore`) | Khôi phục bản trước qua Studio/`restore --seq 44` (đã mất vì bản 44 giờ là dự phòng; vẫn còn trong kho) |
| 11:51 | Vô hiệu `mat-tmp-eng` | `mat-runtime --user-enable mat-tmp-eng` |

Không có thay đổi unit (đã khớp T169), không xóa file nào.

### Trạng thái cuối (11:52)
- runtime 0.5.0 active, NRestarts=0, project `tank-demo` 0.1.0 `sha256:9ba112c6ddbd961f0336f8b246ff172826d544130a7fe1168cb10b2b2861edb7`, historian `running`, journal không cảnh báo, không unit lỗi.
- Đĩa `/` 13% (5,9 GB trống), RAM dùng 79 MB / 993 MB.

### Baseline (runtime 0.5.0, tank-demo, rảnh)
- RSS 7,0 MB (VmHWM 7,0 MB; với driver-it-bench 1001 tag: 7,8 MB), 41 luồng, VmSize 332 MB, nhị phân 4,1 MB, `/opt/mat-runtime` 4,2 MB.
- CPU rảnh: 16 tick / 20 s = 0,8% của một lõi (tank-demo); toàn máy `top` idle ~64-85%.
- `GET /api/v1/system/info` (loopback, wget): 21-34 ms (10 mẫu); `GET /` 23 ms.
- Thời gian khởi động: không đo lại (không restart); thời gian chuyển project (restore) ~ vài giây, op committed.

### Chờ gói mới (runtime 0.9.0)
Deploy 0.9.0 bằng `deploy.sh` (giữ `.prev` = 0.5.0 và unit); kiểm `schemas/` mới, `web/login.html`; project nhận cần `minRuntimeVersion`; `runtime.json` giữ `viewerAccess:any` (cân nhắc đặt lại `private`); nạp lại project bằng Studio; thử cổng ttyAS bằng `serial-ports`; hạ Argon2id t=1 (ADR-011) có hiệu lực khi hash mới được tạo.


### Phát hiện cần người dùng xử lý (2026-10-16)

- Có kết nối lạ từ IP ngoài tới cổng 22 (dò mật khẩu root) từ lúc thiết bị boot; mật khẩu root yếu. Cần đổi mật khẩu root hoặc đóng chuyển tiếp cổng 22/9022 trên router. Agent không đổi (ràng buộc).
- Thiết bị khởi động lại lúc ~08:13 ngày 2026-10-16 không rõ nguyên nhân (journal lần boot trước không còn, `last -x` không có `shutdown`): nghi mất điện hoặc watchdog phần cứng 16 s. Không có dấu hiệu do mat.
- Tài khoản tạm `mat-tmp-eng` còn trong users.json ở trạng thái tắt (hoàn tác: `--user-enable`).


## 2026-10-16 (chiều) — Triển khai runtime 0.9.0 lên BL335 và nghiệm thu một phần

Gói `build/mat-runtime-armhf.tar.gz` SHA-256 `654b6de3527f8b8eba8fd34597c70c7191f8391516054e829ad0022215922cd0` (xem docs/reports/release-0.9.0.md). Trạng thái cuối: runtime 0.9.0 (API 1.4.0, protocol 1.3.0), project `tank-demo` 0.1.0, `/opt/mat-runtime.prev` = 0.5.0 (rollback.sh sẵn sàng, chưa thử). Các tài khoản tạm `mat-tmp-eng`, `mat-tmp-op` đã tắt (`--user-enable` để bật lại).

## 2026-10-16 (chiều): agent THIẾT BỊ giai đoạn 2 — deploy runtime 0.9.0 và đo nghiệm thu 008/009/010

Truy cập LAN 192.168.1.110:22 (người dùng cho phép: "SSH vào 192.168.1.110"). Không đụng `atscada-*`, `piano-edtech-*`; không reboot, không cắt điện; không đổi mật khẩu root/SSH. Mật khẩu tài khoản tạm sinh ngẫu nhiên, nằm ở scratchpad của agent (đã xóa khi xong), không ghi vào repo.

### Thay đổi trên thiết bị và cách hoàn tác
| Giờ (+07) | Thay đổi | Hoàn tác |
|---|---|---|
| 13:41 | Sao lưu `runtime.json`, unit, `history.db` vào `/root/mat-stage2` (đã xóa cuối phiên) | — |
| 13:41 | `deploy.sh` gói 0.9.0 (SHA-256 `654b6de3…` khớp): 9,2 s, health OK sau 1 s; `/opt/mat-runtime.prev` = 0.5.0; unit chỉ đổi 3 dòng chú thích; `runtime.json` giữ nguyên (`viewerAccess:any`, `simLoad:true`) | `sh /opt/mat-runtime/deployment/rollback.sh` (chưa dùng; lưu ý runtime 0.5 chưa thử mở `history.db` schema 2) |
| 13:42 | Bật lại `mat-tmp-eng` (đặt mật khẩu ngẫu nhiên không lưu repo) và tạo `mat-tmp-op` (operator) | `--user-disable` cả hai (ĐÃ tắt 15:48) |
| 13:48–14:22 | Dừng/chạy lại `mat-runtime` 6 lần để đo A/B ghi eMMC (3 x 3 phút tắt, 3 x 3 phút chạy) và 1 lần đo khởi động | không cần |
| 13:5x | `systemctl set-property --runtime BlockIOAccounting=yes` rồi gỡ (không có file thống kê trong kernel) | đã `rm -rf /run/systemd/system.control/mat-runtime.service.d; daemon-reload` |
| 14:21–15:48 | Nạp xuống bằng API (engineer): svg-demo 4,2 s; dashboard-demo 3,3 s; std-3b 3,2 s; svg-40 6,2 s; big1m (SVG 1 MiB) 5,3 s; load-3b 5,8 s; lat-bench (project thử, 2 lần) 3,6 s; alarm-demo 3,6 s; history-demo 3,6 s; tank-demo (cuối) 3,4 s | kho project giữ 3 bản dự phòng; đang chạy `tank-demo` 0.1.0 `sha256:9ba112c6…` |
| 15:48 | Tắt `mat-tmp-eng`, `mat-tmp-op`; xóa `/root/mat-stage2` | `--user-enable` |
Không đụng `atscada-*`, `piano-edtech-*`; không reboot.

### Số đo (runtime 0.9.0, BL335, tank-demo trừ khi ghi khác)
- Khởi động: deploy.sh xong 9,2 s; health OK sau 1 s; nạp project API 3,2-6,2 s (6 bước).
- Rảnh (10 phút): RSS 8,1 MB (0.5.0: 7,0), VmHWM đỉnh khi khởi động 27 MB, 73 luồng (0.5.0: 41), CPU 0,94 % một lõi (0.5.0: 0,8 %), MemAvailable thấp nhất 875 MB.
- Tải 30 phút, 10 Chrome xem màn hình 3b (509 Tag mô phỏng/1 s): RSS 11,6 MB (max 12,1), CPU 12,8 % một lõi (ngưỡng 30 %), 0 mất sequence trên 72.207 delta, 10/10 trực tuyến, 0 đóng kết nối.
- Mở màn hình (Chrome từ máy dev qua LAN HTTPS, cache trống): 3b chuẩn trung vị 615 ms (tối đa 846); 40 item svg 1.216 ms; SVG 1 MiB trung vị 1.362 ms (tối đa 1.675); 10 F5 cùng lúc 3b: tệ nhất 1,13 s, với SVG 1 MiB 2,0 s (ngưỡng 5 s).
- Alarm: 15 phút history-demo + 10 client live (load-tester): RSS 9,1 MB (max 9,5), CPU 6,3 %, 0 mất sequence, p95 trễ 297 ms; alarm-demo: 17 instance, `evalMaxMs` 0,61.
- Độ trễ alarm (lat-bench, Chrome, p50/p95): từ lúc gửi ghi Tag tới banner DOM 297/358 ms (74 lần hợp lệ trong lượt 1); tính từ khi lệnh ghi trả về khoảng 186/260 ms. Các lần "trượt" là do giới hạn tốc độ ghi Tag (20/phút) và tự tạm ẩn chập chờn, không phải lỗi alarm.
- Ghi eMMC: không đo được riêng của mat (kernel không có `/proc/pid/io`, không có blkio throttle). Số toàn hệ (`/sys/block/mmcblk0/stat`): nền khi tắt mat 3,8 GB/ngày quy đổi (dao động 2,6-4,7 GB/ngày giữa các cửa sổ 3 phút, do dịch vụ khác); mat chạy 3,5-3,8 GB/ngày; chênh không tách được khỏi nhiễu (mat < ~1 GB/ngày ở tải tank-demo/history-demo).
- Serial: `serial-ports --probe`: ttyAS2-5 `allowed:true`, mở được từ sandbox (rs485 `unsupported`), ttyAS0 (console) và ttyS*, ttyUSB* (modem EC25) `allowed:false`. Không gửi dữ liệu.

### Số đo 0.9.0 so với 0.5.0 (BL335, 2026-10-16)

| Chỉ số | 0.9.0 | 0.5.0 |
|---|---|---|
| RSS rảnh | 8,1 MB (VmHWM khởi động 27 MB), 73 luồng | 7,0 MB, 41 luồng |
| CPU rảnh | 0,94 % một lõi | 0,8 % |
| Tải 30 phút, 10 Chrome xem màn 3b, 509 Tag | RSS 11,6 MB, CPU 12,8 % một lõi, 0 mất sequence trên 72.207 delta | — |
| 10 client + alarm-demo + history-demo, 15 phút | RSS 9,1 MB, CPU 6,3 %, p95 trễ 297 ms | — |
| Mở màn 3b (Chrome qua LAN) | trung vị 615 ms, tối đa 846 ms | — |
| 10 F5 cùng lúc | tệ nhất 1,13 s | — |
| Nạp project (6 bước) | 3,2–6,2 s | — |
| Trễ alarm (Tag đổi → banner) | p50 297 ms, p95 358 ms | — |
| deploy.sh | 9,2 s, health OK sau 1 s | — |

Ghi eMMC: **không đo được** — kernel 5.4.61 của BL335 không có `/proc/<pid>/io` và không có thống kê blkio, nên `historian.io` luôn `source:"unavailable"`. Số toàn hệ quy đổi ~3,5–3,8 GB/ngày dù mat chạy hay tắt (phần lớn của dịch vụ khác).

## 2026-10-17 — Triển khai runtime 1.0.0 lên BL335 (LAN)

Thiết bị đã được người dùng bật lại lúc 13:09 (máy tắt nguồn, không do mat). Mọi thao tác qua LAN.

### Thay đổi trên thiết bị và cách hoàn tác

| Giờ | Thay đổi | Hoàn tác |
|---|---|---|
| 15:00 | Sao lưu `/etc/mat-runtime` và unit `mat-runtime.service` vào `/root/mat-stage-011` | `rm -rf /root/mat-stage-011` |
| 15:00 | `deploy.sh` gói runtime 1.0.0 (releaseSeq 1, 13 s); 0.9.0 chuyển sang `/opt/mat-runtime.prev` | `sh /opt/mat-runtime/deployment/rollback.sh` (rồi chép lại `/root/mat-stage-011/etc` nếu cần) |
| 15:01 | Cài `mat-updater` vào `/usr/lib/mat-updater` (`mat-updater.path`, `mat-updater-recover.service` enabled); OTA vẫn **tắt** trong `runtime.json`, chưa có khóa tin cậy | `systemctl disable --now mat-updater.path mat-updater-recover.service; rm -rf /usr/lib/mat-updater` và các unit `mat-updater*` trong `/etc/systemd/system` |

`runtime.json` giữ nguyên (viewerAccess any, simLoad, threads 24). Project đang chạy vẫn là `tank-demo` 0.1.0. Không đụng `atscada-*`, `piano-edtech-*`; không reboot; không đổi mật khẩu root hay sshd.

### Số đo (runtime 1.0.0, tank-demo, rảnh)
- Health OK sau 1 s; `system/info`: apiVersion 1.5.0, schemaVersions 0.1–1.0, `logic.present:false`, `update.enabled:false`, `historian.io.source` `sqlite-vfs`.
- Cảnh báo: `VIEWER_PUBLIC`, `TLS_NO_IP_SAN`, `SSH_ROOT_PASSWORD` (đúng cấu hình hiện tại của thiết bị).
- Rảnh: RSS 9,5 MB (0.9.0: 8,1), 99 luồng (0.9.0: 73; tăng do `httpsThreads` 64), CPU 0,7 % một lõi trong 60 s, NRestarts 0.
- Host check (T063): Host lạ `evil.test` → 421 trên cả HTTP và HTTPS; theo IP, hostname `.local`, `localhost` → 200.
- `mat-update-verify --bench 50` trên Cortex-A7 với gói vector 5 KiB: 0,81 s cho 50 lần ≈ 16 ms/lần kiểm (phần lớn là ECDSA P-256).

### 15:52 — Thử unit mat-updater đã làm cứng (rà soát 011, T062)

| Giờ | Thay đổi | Hoàn tác |
|---|---|---|
| 15:52 | Thay `mat-updater.service`, `mat-updater.path`, `mat-updater-recover.service` và `/usr/lib/mat-updater/mat-updater` bằng bản của nhánh gd6-sec-ota (CapabilityBoundingSet, PrivateDevices, đọc có giới hạn, `mv -T`); bản cũ ở `/root/mat-stage-011/updater-prev` | chép lại từ `/root/mat-stage-011/updater-prev` vào `/etc/systemd/system` và `/usr/lib/mat-updater/mat-updater`, rồi `systemctl daemon-reload` |

Kết quả: `systemd-analyze verify` sạch; `systemctl start mat-updater-recover` thành công; yêu cầu thử `op:"noop"` (updateId hợp lệ, ghi bằng user matscada) được đọc qua `runuser` dưới unit mới rồi xóa, log "request ignored: op", unit `Succeeded`. `runuser` ghi hai cảnh báo `pam_limits` (không đặt được nofile/memlock vì unit không có `CAP_SYS_RESOURCE`): vô hại, chấp nhận. mat-runtime vẫn active, OTA vẫn tắt.

### 18:39 — Thử bản sửa T202 của mat-updater (PathExists, chờ khóa, recover)

| Giờ | Thay đổi | Hoàn tác |
|---|---|---|
| 18:39 | Thay 3 unit `mat-updater*` và `/usr/lib/mat-updater/mat-updater` bằng bản của nhánh gd6-sec2-ota (`mat-updater.path` dùng `PathExists=`) | như mục 15:52: chép lại từ `/root/mat-stage-011/updater-prev`, `systemctl daemon-reload`, `systemctl restart mat-updater.path` |

Kết quả: `systemd-analyze verify` sạch; `mat-updater-recover` thành công; hai yêu cầu thử `op:"noop"` liên tiếp đều được xử lý đúng một lần và xóa (log "request ignored: op", unit `Succeeded`), không lặp với `PathExists=`. Thiết bị có `openssl` 1.1.1f (dùng cho kiểm lần cài đầu của `deploy.sh --expect-key-id`). mat-runtime vẫn active, OTA vẫn tắt.

## 2026-10-17 (tối): đo T079, T148

Agent đo (nhánh `gd6-bl335`), mọi thao tác qua LAN; mật khẩu tài khoản tạm sinh ngẫu nhiên, chỉ nằm ở scratchpad của agent (đã xóa), không vào repo. Không reboot, không cắt điện, không đụng `atscada-*`, `piano-edtech-*`, không đổi mật khẩu root hay sshd, không bật OTA, không cài khóa tin cậy. Kết quả ở `011-load.md` §3, `011-load-bl335.json`, `011-logic-bl335.json`.

| Giờ (+07) | Thay đổi | Hoàn tác |
|---|---|---|
| 20:09 | Sao lưu `runtime.json` vào `/root/mat-stage-011/runtime.json.t079` (SHA-256 `0e979c42…`) | — (đã xóa 01:42 sau khi khôi phục) |
| 20:09 | Tạo tài khoản tạm `mat-t079-eng` (engineer), `mat-t079-xem` (viewer) | `--user-disable` (ĐÃ tắt 01:41) |
| 20:09 | Thêm `"maxLiveClientsPerSource": 10` vào `runtime.json`, `systemctl restart mat-runtime` | chép lại bản sao lưu, restart (ĐÃ làm 01:41; SHA-256 khớp bản gốc) |
| 20:09 | Nạp `soak-standard` (định dạng 0.6) bị từ chối `E_SCHEMA` ở validate: gói 1.0.0 thiếu `schemas/0.6` (không đổi gì trên thiết bị) | — |
| 20:11 | `/root/mat-stage-011/t079/` (script lấy mẫu chỉ đọc `/proc`, tệp CSV) | `rm -rf` (ĐÃ xóa 01:42) |
| 20:10–21:39 | Nạp bằng API (engineer): `soak-std10` 20:10 (6,2 s), `svg-l5` 20:20 (5,6 s), rồi luân phiên `soak-std10` 20:34, `soak-logic` 20:50, `soak-std10` 21:06, `soak-logic` 21:22, `soak-std10` 21:38 (5,8–8,8 s mỗi lần, đều `committed`) | kho project giữ bản đang chạy và 3 bản dự phòng |
| 01:40 | Nạp lại `tank-demo` 0.1.0 (`sha256:9ba112c6…`, đúng digest cũ) | — |

Trạng thái cuối (01:42): mat-runtime 1.0.0 active, NRestarts 0, project `tank-demo` 0.1.0 `sha256:9ba112c6…` (seq 63); `runtime.json` giống hệt lúc đầu (SHA-256 `0e979c42…`); `mat-t079-eng`, `mat-t079-xem` tắt; `/root/mat-stage-011` chỉ còn `etc`, `mat-runtime.service`, `updater-prev` như trước. Lưu ý: ba bản dự phòng của kho giờ là `soak-standard` (định dạng 1.0, seq 62, 60) và `soak-logic` (seq 61), thay `history-demo`, `alarm-demo`, `lat-bench`.

## 2026-10-18 (rạng sáng): bench logic T148 (tạm, chỉ /tmp)

Agent tối ưu logic (nhánh `gd6-logic-perf`), qua LAN; mật khẩu chỉ nằm trong một script SSH_ASKPASS ở scratchpad của agent (đã xóa). Không reboot, không đụng `atscada-*`, `piano-edtech-*`, mật khẩu root, sshd; không thay runtime đã cài, không đổi `runtime.json`, không nạp project. Trước mỗi lần chạy kiểm `mat-updater.service` không chạy (một lần lúc 02:32 nó đang `activating` do phép thử OTA T122 của agent khác chạy song song; `mat-runtime` được agent đó khởi động lại lúc 02:01, 02:17, 02:22, 02:27, 02:32, 02:38, 02:43, có lúc trùng lúc bench chạy).

| Giờ (+07) | Thay đổi | Hoàn tác |
|---|---|---|
| 02:00 | Tạo `/tmp/t148-before/` (`logic_bench` armhf bản trước tối ưu, project `logic-l1`, bản sao `schemas/`, 3,1 MB) | `rm -rf /tmp/t148-before` (ĐÃ xóa 02:44) |
| 02:16–02:43 | Tạo `/tmp/t148-after/logic_bench` (bản sau tối ưu, thay nhiều lần) và `out.json`; mỗi lần chạy bench tạo rồi tự xóa `/tmp/logic-bench-XXXXXX` (kho retain tạm) | `rm -rf /tmp/t148-after` (ĐÃ xóa 02:44) |

Trạng thái cuối (02:44): không còn `/tmp/t148-*` hay `/tmp/logic-bench-*`; `mat-runtime` active (do OTA của agent khác quản lý). Kết quả ở `011-load.md` §3.2, `011-logic-bl335.json` mục `benchT148`.

## 2026-10-18: T122 OTA thật

Agent OTA (nhánh `gd6-t122`), người dùng cho phép 2026-10-17 ("bạn tự quyết định nhé"). Mọi thao tác qua LAN. Mật khẩu tài khoản tạm sinh ngẫu nhiên, chỉ nằm trong scratchpad của agent và bộ nhớ của script (đã xóa), không vào repo. Không reboot, không cắt điện, không đụng `atscada-*`, `piano-edtech-*`, không đổi mật khẩu root hay sshd. `mat-updater`, unit và `mat-update-verify` trên thiết bị đã trùng byte với `gd6` (so SHA-256), nên **không** chạy lại `deploy.sh`. Kết quả ở `011-ota-bl335.json`.

| Giờ (+07) | Thay đổi | Hoàn tác |
|---|---|---|
| 01:53 | Sao lưu `runtime.json` (SHA-256 `0e979c42…`), `trusted-keys/` (rỗng), `users.json` vào `/root/mat-stage-011/t122/` | — (đã xóa 02:50 sau khi khôi phục) |
| 01:53 | `mat-runtime --trust-key add` khóa công khai **thử** `tests/update-vectors/keys/test-ec-p256.pub.pem` (nhãn `t122-test`) | `mat-runtime --trust-key remove sha256:<keyId>` (ĐÃ làm 02:49; `trusted-keys/` rỗng như cũ) |
| 01:54 | `runtime.json` thêm `"update": {"enabled": true}`; tạo tài khoản tạm `mat-t122-adm` (administrator); `systemctl restart mat-runtime` | chép lại bản sao lưu, `--user-disable mat-t122-adm`, restart (ĐÃ làm 02:49; SHA-256 khớp bản gốc) |
| 01:56–02:48 | 10 cập nhật OTA qua API (releaseSeq 2 đến 6, quay về bằng tay 6 → 5, rồi 7 đến 11), mỗi lần cách nhau ≥ 300 s; tất cả `committed` | xem "Trạng thái cuối" |
| 02:49 | Đặt lại mật khẩu ngẫu nhiên của `mat-t122-adm` để đọc audit (mật khẩu đầu đã bị script xóa), rồi tắt tài khoản | — |

Trạng thái cuối (02:50): mat-runtime active, NRestarts 0, `system/info` `update.enabled:false`, project `tank-demo` 0.1.0 active, digest `sha256:9ba112c6…` như trước; `runtime.json` giống hệt lúc đầu; không còn khóa tin cậy; `mat-t122-adm` tắt; `update/incoming`, `update/ready` rỗng; `/root/mat-stage-011` chỉ còn `etc`, `mat-runtime.service`, `updater-prev`.

**Runtime đang chạy đã đổi:** `/opt/mat-runtime` là bản build thử của T122 (runtime 1.0.0, **releaseSeq 11**, `gd6` 95effeb5, không strip); `/opt/mat-runtime.prev` là bản thử releaseSeq 10. Bản cài gốc 1.0.0 releaseSeq 1 (commit `f1167449`) **không còn trên thiết bị** (mỗi OTA ghi đè `.prev`). Cùng mã runtime 1.0.0 với chênh lệch nhỏ của `gd6` sau đó (sửa rà soát T202, gói có đủ `schemas/0.6`). Muốn về đúng bản gốc: chạy `deploy.sh` với gói `mat-runtime-armhf.tar.gz` của commit đó (hoặc gói mới hơn; `deploy.sh` không chặn `releaseSeq` thấp hơn); `rollback.sh` hay "Quay về bản trước" chỉ về releaseSeq 10. Lưu ý: OTA sau này chỉ nhận gói có `releaseSeq` > 11, trừ khi cài lại bằng `deploy.sh`.
