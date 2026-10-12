# Triển khai `mat-runtime` lên BL335 (thủ công, Sprint 1; mục 5b: runtime 0.4.0)

Dành cho kỹ sư triển khai. Quy trình theo đúng chuỗi của Constitution VII (stage → validate → backup → activate → health check → rollback), làm bằng script `deploy.sh`. Triển khai atomic qua API `/api/v1/deploy/*` là việc của Sprint 6.

Mọi thay đổi trên thiết bị phải ghi vào [docs/reports/device-changes.md](../reports/device-changes.md) kèm cách hoàn tác. Không đụng dịch vụ của sản phẩm cũ (`atscada-*`) trừ khi được yêu cầu rõ. Mật khẩu không ghi vào repo.

## 1. Chuẩn bị trên máy dev (Windows)

```powershell
./deployment/toolchain/build.ps1        # build chéo armhf trong Docker → build/armhf/bin/mat-runtime
npm run build:web                       # apps/runtime-web/dist-device (chỉ trang runtime)
./deployment/package-runtime.ps1        # → build/mat-runtime-armhf.tar.gz (khoảng 0,4 MB)
```

Script đóng gói **thất bại** nếu gói có file tên chứa `unsafe-elements`, trang lab (`lab.*`, `lab-*`), source map (`*.map`), file test (`*.test.*`) hoặc thư mục `web/screens/` (fixture của lab). Script không kiểm nội dung project truyền qua `-Project` (mặc định `projects/tank-demo`): không đóng gói thư mục vector trong `tests/`. Kèm theo gói là `build/mat-runtime-armhf.tar.gz.sha256` cho bước kiểm SHA-256 của `deploy.sh`.

## 2. Địa chỉ thiết bị

| Mục đích | Trong LAN | Từ xa (hiện tại) |
|---|---|---|
| SSH | `192.168.1.110:22` | `198.51.100.200:2222` |
| Trang runtime | `http://192.168.1.110:8080/` | `http://198.51.100.200:9080/` (router chuyển 9080 → 8080 của thiết bị) |

Cổng 8080 trên IP công cộng là một máy chủ khác của công ty, **không** phải BL335.

## 3. Chép gói và triển khai

Từ Git Bash trên máy dev (thay `-p 2222 root@198.51.100.200` bằng `root@192.168.1.XXX` khi ở LAN).

**Yêu cầu trên thiết bị:** systemd, `wget` (BL335 không có `curl`), `sha256sum`, `tar`, `runuser`; phiên SSH `root` (BL335 không có `sudo`); chỗ trống cho 3 bản trong `/opt` (`.new`, hiện hành, `.prev`).

**Kiểm cổng trước khi deploy** (FR-028):

```sh
ssh -p 2222 root@198.51.100.200 "ss -ltnp | grep ':8080 '"   # không in gì: cổng trống
```

Dòng in ra là `mat-runtime`: bản đang chạy của dự án, `deploy.sh` tự khởi động lại. Là `mat-poc` (PoC Sprint 0): nếu là dịch vụ thì `systemctl disable --now mat-poc` (hoàn tác: `systemctl enable --now mat-poc`), nếu chạy tay thì dừng tiến trình đó; ghi vào [device-changes.md](../reports/device-changes.md). Tiến trình khác: không deploy, báo người dùng.

**Chép gói và chạy `deploy.sh`:**

```sh
mkdir -p /tmp/up && cp build/mat-runtime-armhf.tar.gz build/mat-runtime-armhf.tar.gz.sha256 /tmp/up/
tr -d '\r' < deployment/device/deploy.sh   > /tmp/up/deploy.sh
tr -d '\r' < deployment/device/rollback.sh > /tmp/up/rollback.sh
# một phiên SSH, thư mục tạm tên ngẫu nhiên (mktemp -d): không ai đặt sẵn được thư mục root sẽ giải nén vào
tar -C /tmp/up -cf - . | ssh -p 2222 root@198.51.100.200 'D=$(mktemp -d) && tar -C "$D" -xf - && sh "$D/deploy.sh" "$D/mat-runtime-armhf.tar.gz"; rc=$?; rm -rf "$D"; exit $rc'
```

`deploy.sh` làm lần lượt:

0. **checksum:** so SHA-256 của gói với file `.sha256` cạnh gói. Thiếu file hoặc lệch thì dừng (`MAT_SKIP_CHECKSUM=1` để bỏ qua khi biết rõ lý do). Lần đầu tạo user hệ thống `matscada` (không đăng nhập) ngay sau bước này.
1. **stage:** giải nén vào `/opt/mat-runtime.new`.
2. **validate:** chạy `mat-runtime --check-project` bằng user `matscada` (bộ kiểm tra C++, cùng luật với Studio); kết quả vào file tạm `mktemp`, xóa ngay sau khi dùng. Project lỗi thì dừng, bản đang chạy giữ nguyên.
3. **config:** lần đầu cài `/etc/mat-runtime/runtime.json` (không ghi đè nếu đã có).
4. **backup, unit:** `/opt/mat-runtime` → `/opt/mat-runtime.prev`. Sau đó mới xử lý unit, để `mat-runtime.service.prev` luôn đi cặp với `/opt/mat-runtime.prev`:
   - unit trong gói khác `/etc/systemd/system/mat-runtime.service` (`MemoryMax=300M`, `NoNewPrivileges`, `ProtectSystem=strict`…): cài bản mới, giữ unit đang dùng ở `.service.prev`, `systemctl enable`;
   - unit không đổi: xóa `.service.prev` cũ, nếu có.
5. **activate:** `.new` → `/opt/mat-runtime`, `systemctl restart mat-runtime`.
6. **health check:** trong 15 s, `/api/v1/system/info` phải trả `project.status = "active"`. Không đạt thì **tự rollback** (`rollback.sh`).

## 4. Kiểm tra sau triển khai

```sh
systemctl status mat-runtime --no-pager
wget -qO- http://127.0.0.1:8080/api/v1/system/info      # trên thiết bị (không có curl)
journalctl -u mat-runtime -n 50 --no-pager               # log
```

Từ máy dev: mở trang runtime trên Chrome, hoặc `node tools/measure/runtime-smoke.mjs http://198.51.100.200:9080/`.

## 5. Cấu hình

File `/etc/mat-runtime/runtime.json` ([contract](../../specs/002-vertical-slice/contracts/runtime-config.md)). Sửa xong thì `systemctl restart mat-runtime`.

- `maxClients` 1–10; giá trị > 10 bị kẹp về 10.
- `allowedOrigins`: origin được mở WebSocket ngoài cùng origin. Mặc định là origin của Studio (`http://tauri.localhost`, `tauri://localhost`). Khi thử Studio bản dev (`npm run studio:dev`), thêm tạm `http://localhost:1420` trên **thiết bị thử**, không thêm trên thiết bị vận hành.
- `simLoad`: `true` thì có thêm 500 Tag `SIM.*` để đo tải.

## 5a. Lưu trữ dữ liệu Tag (feature 003)

Chỉ chạy khi project có `loggingFile` (`logging.json`, [contract](../../specs/003-data-logging/contracts/logging-config.md)). Khóa mới của `runtime.json`: `dataDir`, `secretsFile`, `clientLibDir`, `historianMaxDbMB` (64–65536, mặc định 2048), `historianMinFreeMB` (50–65536, mặc định 500), `historianCommitMs` (1000–60000, mặc định 5000) — [device.md](../../specs/003-data-logging/contracts/device.md).

**Dữ liệu trên thiết bị:** `/var/lib/mat-runtime/history.db` (+ `-wal`, `-shm`), thuộc `matscada`, quyền `0700` cho thư mục. systemd tạo thư mục (`StateDirectory=mat-runtime`); deploy và rollback không đụng tới thư mục này. File hỏng được đổi tên thành `history.db.corrupt-<epoch>` (giữ để điều tra, xóa tay).

**Sao lưu `history.db`** (đang chạy vẫn được, WAL không chặn người đọc):

```sh
systemctl stop mat-runtime && cp -a /var/lib/mat-runtime/history.db* /backup/ && systemctl start mat-runtime
```

Dừng dịch vụ trong lúc chép để có bản nhất quán (vài giây; dòng trong khoảng này không được lấy mẫu).

BL335 không cài `sudo`: các lệnh dưới đây chạy trong phiên SSH `root`. Lệnh chỉ đọc dữ liệu thì chạy bằng user của dịch vụ qua `runuser`.

**Xuất CSV** (giờ địa phương, mặc định 24 giờ gần nhất):

```sh
runuser -u matscada -- /opt/mat-runtime/bin/mat-runtime --export-history bao-cao-ca \
     --from "2026-10-10 06:00" --to "2026-10-10 14:00" --tz +07:00 > ca-sang.csv
```

**Kiểm file lưu trữ** (sau một lần mất điện, hoặc khi nghi hỏng; không cần dừng dịch vụ):

```sh
runuser -u matscada -- /opt/mat-runtime/bin/mat-runtime --check-history   # "integrity: ok" + số dòng từng bảng
```

**Mật khẩu/token của DB ngoài** (không bao giờ nằm trong project; file `/etc/mat-runtime/secrets.json`, `root:matscada`, `0640`):

```sh
/opt/mat-runtime/bin/mat-runtime --set-secret mysql-office      # gõ mật khẩu, không hiện ra màn hình
# token dài: dán vào biến không hiện ra màn hình, không lưu vào history của shell
read -rs TOKEN && printf '%s\n' "$TOKEN" | /opt/mat-runtime/bin/mat-runtime --set-secret influx; unset TOKEN
```

Thư viện client của DB ngoài (cài một lần, chỉ loại DB thật sự dùng): `apt-get install libmariadb3` (MySQL/MariaDB), `libsybdb5` (SQL Server), `libpq5` (PostgreSQL), `libcurl4` (InfluxDB). Thiếu thư viện thì đích báo `no_client`; runtime vẫn chạy.

Runtime đọc lại file ở mỗi lần kết nối: đổi mật khẩu không cần khởi động lại. Chạy lệnh trước lần cài đầu tiên (chưa có nhóm `matscada`) thì lệnh báo dịch vụ chưa đọc được file: chạy lại sau khi cài. Mật khẩu/token phải là UTF-8.

**TLS:** kết nối SQL (cả SQL Server) mặc định `verify-full`: kiểm chứng chỉ và tên máy theo kho CA của thiết bị. InfluxDB dùng `https://`. Chứng chỉ không được tin cậy hiện `tls` trong `system/info` và tab Thiết bị. Máy chủ dùng chứng chỉ tự ký hoặc do CA của nhà máy cấp có hai cách:

- Cách nên dùng: chép CA (hoặc chính chứng chỉ của máy chủ) vào `/usr/local/share/ca-certificates/<tên>.crt`, chạy `update-ca-certificates`, rồi `systemctl restart mat-runtime`. Cần người dùng cho phép, ghi vào [device-changes.md](../reports/device-changes.md). `host` của kết nối phải khớp tên hoặc IP trong chứng chỉ.
- Ghi rõ `"tls": "require"` cho kết nối đó: vẫn mã hóa nhưng không kiểm máy chủ, nên kẻ đứng giữa lấy được mật khẩu. Validator cảnh báo `W_LOG_TLS_UNVERIFIED`.

**Thư viện client đi kèm** (`clientLibDir`, mặc định `/opt/mat-runtime/lib`): chỉ được nạp khi thư mục và file thuộc root và không ghi được bởi nhóm/người khác; nếu không, runtime bỏ qua bản đi kèm (ghi vào journal) và dùng thư viện của hệ thống. Ubuntu 20.04 đã hết hỗ trợ chuẩn (2025-05): các gói `libpq5`, `libmariadb3`, `libsybdb5`, `libcurl4` chỉ còn bản vá qua Ubuntu Pro/ESM.

**Thư viện client** — chỉ cài loại DB thật sự dùng (cài/gỡ gói trên thiết bị cần người dùng cho phép, ghi vào [device-changes.md](../reports/device-changes.md)). Thiếu gói thì đích tương ứng báo `no_client`, runtime vẫn chạy:

| DB | Gói Ubuntu 20.04 | Gỡ |
|---|---|---|
| MySQL / MariaDB | `libmariadb3` | `apt remove libmariadb3` |
| SQL Server | `libsybdb5` | `apt remove libsybdb5` |
| PostgreSQL | `libpq5` | `apt remove libpq5` |
| InfluxDB | `libcurl4` | `apt remove libcurl4` |

SQL Server: runtime tự sinh một `freetds.conf` cho các kết nối của nó (trong `/tmp` riêng của dịch vụ, biến `FREETDSCONF`), không dùng `/etc/freetds/freetds.conf`.

**Theo dõi:** khối `historian` của `/api/v1/system/info` (trạng thái, số dòng, dung lượng, từng đích: `state`, `pendingRows`, `lagS`, lỗi gần nhất). Thông báo lỗi gốc của client (có tên user, địa chỉ máy chủ) chỉ có trong `journalctl -u mat-runtime`.

**Tài khoản DB ngoài:** quyền tối thiểu và bảng `mat_forward_state` mà runtime dùng: [external-schema.md](../../specs/003-data-logging/contracts/external-schema.md).

## 5b. HTTPS, tài khoản, kho project (feature 005, runtime 0.4.0)

Từ 0.4.0, ngoài trang xem HTTP 8080 (không đổi), runtime mở **HTTPS 8443** cho Studio: đăng nhập, nạp xuống, đọc lên, chẩn đoán, audit. Mọi API kỹ thuật chỉ có ở HTTPS; qua HTTP trả 403 `HTTPS_REQUIRED`. Khóa trong `runtime.json`: xem `specs/005-device-online/contracts/device-config.md` §1 (`httpsPort`, `httpsThreads`, `discoveryEnabled`, `discoveryPort`, `deviceName`, `projectStoreDir`, `projectBackups`, `usersFile`, `auditRetentionDays`, `auditMaxMB`).

### Chứng chỉ và fingerprint

Lần chạy đầu runtime tự sinh khóa và chứng chỉ riêng (`/var/lib/mat-runtime/tls/server.pem`, `0600`). Chứng chỉ tự ký nên Studio **ghim** theo fingerprint SHA-256, so một lần khi kết nối lần đầu (TOFU):

```sh
runuser -u matscada -- /opt/mat-runtime/bin/mat-runtime --cert-fingerprint   # SHA256 Fingerprint=AB:CD:...
```

`deploy.sh` in fingerprint sau khi cài. Ghi lại, rồi trong Studio (Online, thêm thiết bị) so **đủ từng cặp ký tự** với giá trị Studio hiện trước khi xác nhận ghim. Fingerprint đổi (thiết bị khác, hoặc `--regen-cert`) thì Studio chặn và báo; kỹ sư gỡ ghim rồi ghim lại sau khi so fingerprint mới. Sinh lại chứng chỉ (nghi lộ khóa; chứng chỉ không hết hạn vì BL335 không có RTC): `mat-runtime --regen-cert` (root; tự chạy lại dịch vụ).

### Tài khoản

Tài khoản cục bộ trong `/etc/mat-runtime/users.json` (`root:matscada`, `0640`), tạo **trên thiết bị** bằng root; mật khẩu không bao giờ là tham số dòng lệnh. Dài 15 đến 128 ký tự, khác tên tài khoản, dạng Unicode dựng sẵn (bộ gõ Unikey/EVKey đặt "Unicode dựng sẵn"; ký tự tổ hợp bị từ chối kèm gợi ý).

```sh
mat-runtime --user-add admin --role administrator     # hỏi mật khẩu hai lần, không hiện ký tự
mat-runtime --user-add kysu1 --role engineer
mat-runtime --user-add xem1 --role viewer
mat-runtime --user-passwd kysu1 | --user-role <tên> <role> | --user-disable | --user-enable | --user-unlock | --user-list
printf '%s\n' "$MAT_PW" | mat-runtime --user-add kysu2 --role engineer --password-stdin   # dùng cho script; BOM đầu dòng được bỏ
```

Vai trò: `viewer` đọc chẩn đoán; `engineer` thêm nạp xuống, đọc lên, khôi phục; `administrator` thêm đọc audit. Đặt mật khẩu `admin` lúc cài: `deploy.sh` hỏi ngay khi có terminal và chưa có administrator; không có terminal thì in "BƯỚC BẮT BUỘC" (lệnh `--user-add` ở trên). Sai 5 lần thì khóa tài khoản và địa chỉ 5 phút (kể cả khi gõ đúng); mở sớm bằng `--user-unlock <tên>`. Phiên hết hạn sau 30 phút rảnh, tối đa 12 giờ.

### Kho project, bản dự phòng, khôi phục

Project chạy nằm trong kho `/var/lib/mat-runtime/projects/` (`state.json`, `v/<seq>/`, giữ bản đang chạy và 3 bản dự phòng; `ops/` giữ 20 thao tác gần nhất). Lần đầu chạy 0.4.0 trên thiết bị cài theo cách cũ, project trong `/opt/mat-runtime/project` được nhận vào kho (`v/1`, nguồn `runtime-package`). Studio nạp xuống theo 6 bước (nhận, kiểm gói, kiểm project, sao lưu, kích hoạt, kiểm tra sức khỏe 15 s); lỗi trước bước kích hoạt thì không đổi gì; kích hoạt xong mà sức khỏe lỗi (chết 2 lần, quá 15 s, project không chạy, HTTPS không mở) thì **tự quay về** bản cũ. Mất điện hay bị giết giữa chừng thì lần khởi động sau chạy bản cũ hoặc bản mới hoàn chỉnh, thao tác dở dang ghi `interrupted`.

```sh
runuser -u matscada -- mat-runtime --project-status    # bản đang chạy, dự phòng, thao tác dở dang
```

Khôi phục bản trước: Studio, Online, "Khôi phục bản trước" (cùng 6 bước, bỏ nhận và kiểm gói). Rollback runtime về bản < 0.4.0 (xem mục 6) thì runtime cũ không biết kho: nó chạy project đi kèm gói cũ; sau khi cập nhật lại lên 0.4.0, nạp lại project bằng Studio.

### Audit

`/var/lib/mat-runtime/audit.db` ghi bền (đăng nhập thành công, thất bại, khóa tạm, truy cập bị từ chối, nạp xuống, đọc lên, khôi phục, tài khoản, chứng chỉ; không có mật khẩu). Administrator xem trong Studio (Online, Audit). Xuất file: `runuser -u matscada -- mat-runtime --export-audit [--from ...] [--to ...] [--format csv|jsonl]`.

### Tìm thiết bị

Studio tìm runtime trong LAN bằng gói UDP broadcast tới cổng **8446** (trả lời ngắn, không bí mật, chỉ cho nguồn cùng mạng con). Tắt: `"discoveryEnabled": false` hoặc `--no-discovery`; cổng 8446/UDP chỉ cần mở với LAN. Windows có thể hỏi cho phép ứng dụng qua tường lửa lần đầu: chọn mạng riêng.

### Làm việc từ xa

Mặc định khuyến nghị **VPN** vào LAN của thiết bị rồi thêm thiết bị theo địa chỉ; runtime không tự mở cổng nào. Port-forward HTTPS (ví dụ 9443 sang 8443) chỉ khi người dùng tự chọn và tự cấu hình router; khi đó nên giữ thêm giới hạn nguồn ở router. Quyết định về cổng 9080 (trang xem HTTP không đăng nhập) chờ người dùng: trang xem HTTP vẫn không đăng nhập tới GĐ 2.

### Gỡ hẳn các thay đổi của 0.4.0

Dừng dịch vụ rồi xóa `/var/lib/mat-runtime/tls`, `/var/lib/mat-runtime/audit.db*`, `/var/lib/mat-runtime/projects`, `/etc/mat-runtime/users.json` (và `/var/lib/mat-runtime/device-id`); `history.db` giữ nguyên. Về runtime cũ: mục 6.

## 6. Rollback

```sh
sh /opt/mat-runtime/deployment/rollback.sh   # /opt/mat-runtime.prev → hiện hành; bản hỏng giữ ở /opt/mat-runtime.failed
```

Lần cài đầu không có bản trước: rollback chỉ dừng dịch vụ.

`rollback.sh` cũng khôi phục `mat-runtime.service.prev` nếu có. Từ ngày 2026-10-11, `deploy.sh` giữ `.service.prev` đi cặp với `/opt/mat-runtime.prev`; test `deployment/device/tests/deploy_rollback_test.sh` kiểm điều này.

Thiết bị deploy bằng `deploy.sh` cũ hơn có thể còn `.service.prev` là unit của một lần deploy cũ hơn `/opt/mat-runtime.prev` (BL335 đang ở trạng thái này). Khi đó:

- so hai unit bằng `diff` trước khi rollback tay;
- lần deploy kế tiếp bằng bản mới sẽ tự dọn.

## 7. Gỡ hoàn toàn (hoàn tác mọi thay đổi của Sprint 1)

```sh
systemctl disable --now mat-runtime
rm -f /etc/systemd/system/mat-runtime.service /etc/systemd/system/mat-runtime.service.prev && systemctl daemon-reload
rm -rf /opt/mat-runtime /opt/mat-runtime.prev /opt/mat-runtime.failed /opt/mat-runtime.new /etc/mat-runtime /tmp/mat-deploy
rm -f /tmp/mat-check-project.json  # do deploy.sh lần 4–5 của Sprint 1 để lại (bản hiện tại không còn tạo)
rm -rf /var/lib/mat-runtime        # dữ liệu lưu trữ (feature 003): chỉ khi chắc chắn không cần nữa
userdel matscada
```

Hoàn tác từng bước của `deploy.sh`:

| Bước | Thay đổi trên thiết bị | Hoàn tác |
|---|---|---|
| user | user hệ thống `matscada` | `userdel matscada` (sau khi gỡ dịch vụ) |
| stage | `/opt/mat-runtime.new` (chỉ còn lại khi `deploy.sh` dừng giữa chừng) | `rm -rf /opt/mat-runtime.new` |
| config | `/etc/mat-runtime/runtime.json` (chỉ lần đầu) | `rm -rf /etc/mat-runtime` |
| unit | `/etc/systemd/system/mat-runtime.service`, bản cũ ở `.service.prev`; `systemctl enable` | có `.prev`: đổi `.service.prev` thành `.service`, `systemctl daemon-reload`; lần đầu: `systemctl disable --now mat-runtime`, xóa unit |
| backup + activate | `/opt/mat-runtime`, bản trước ở `/opt/mat-runtime.prev` | `sh /opt/mat-runtime/deployment/rollback.sh` (bản bị thay giữ ở `/opt/mat-runtime.failed`) |
