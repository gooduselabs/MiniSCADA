# Triển khai `mat-runtime` lên BL335 (thủ công, Sprint 1; mục 5b: runtime 0.4.0; mục 5c: runtime 0.5.0)

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
mat-runtime --user-passwd kysu1 | --user-role <tên> <role> | --user-disable | --user-enable | --user-unlock | --user-unlock-all | --user-list
printf '%s\n' "$MAT_PW" | mat-runtime --user-add kysu2 --role engineer --password-stdin   # dùng cho script; BOM đầu dòng được bỏ
```

Vai trò: `viewer` đọc chẩn đoán; `engineer` thêm nạp xuống, đọc lên, khôi phục; `administrator` thêm đọc audit. Đặt mật khẩu `admin` lúc cài: `deploy.sh` hỏi ngay khi có terminal và chưa có administrator; không có terminal thì in "BƯỚC BẮT BUỘC" (lệnh `--user-add` ở trên). Khóa đăng nhập (feature 011, ADR-036): sai 5 lần liên tiếp thì khóa **cặp (tên, IP)** đó 5 phút (kể cả khi gõ đúng); khóa lại trong 24 giờ thì gấp đôi, tối đa 60 phút, không bao giờ vĩnh viễn. Cùng tên từ máy khác vẫn đăng nhập được, nên không ai khóa được tài khoản của người khác từ xa. Một IP sai 20 lần (mọi tên) trong 10 phút thì mọi đăng nhập từ IP đó bị khóa 5 phút. Đăng nhập đúng chỉ xóa bộ đếm của cặp đó. Quá `maxConcurrentLogins` (mặc định 2) lần kiểm mật khẩu cùng lúc: 429 `LOGIN_BUSY` (thử lại sau 1 s, không khóa ai); runtime ghi audit `auth.busy` (kênh `system`) ở lần đầu rồi tối đa một bản ghi mỗi phút kèm số lần từ chối, và một dòng cảnh báo trong journal: thấy nhiều `auth.busy` là có ai đang thử mật khẩu hàng loạt. ≥ 50 lần sai trong 10 phút vào một tên từ ≥ 5 IP: audit `auth.distributed_attack` (không khóa). Mở sớm: `--user-unlock <tên>` (mọi cặp của tên đó, runtime đọc lại `users.json` trong 2 s); `--user-unlock-all` (mọi cặp và mọi IP: ghi `<dataDir>/auth-unlock.req`, runtime áp dụng trong 5 s hoặc khi khởi động lại; khởi động lại dịch vụ cũng xóa mọi khóa). Runtime chỉ dùng tệp này khi là tệp thường của root, quyền `0600`; tệp khác (do `matscada` hay người khác tạo, quyền rộng hơn, thư mục, liên kết) bị xóa không dùng, có dòng log và audit `account.unlock` `denied` mã `UNLOCK_REQUEST_REFUSED`. `dataDir` là liên kết thì lệnh báo lỗi (mã 4): sửa `dataDir` về thư mục thật. Mật khẩu mới cần 15 đến 128 ký tự; tài khoản có sẵn không bị buộc đổi. Runtime từ chối `users.json` cho nhóm ghi hoặc không thuộc root (phải `0640 root:matscada`). Phiên hết hạn sau 30 phút rảnh, tối đa 12 giờ.

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

## 5c. Tag, Modbus, ghi Tag, cổng serial (feature 006, runtime 0.5.0)

Mã đã xong và đã thử trên x64; **chưa thử trên BL335** (xem trạng thái ở [roadmap-v2.md](../plans/roadmap-v2.md) §4.2). Hợp đồng: `specs/006-tags-modbus/contracts/device-config.md`, `device-api-1.1.md`; quyết định: [ADR-014](../adr/014-driver-sdk-modbus.md), [017](../adr/017-tag-engine-v1.md), [018](../adr/018-viewer-source-filter.md). Mọi khóa mới của `runtime.json` đều có mặc định: file đang có trên thiết bị không phải sửa. Khóa lạ vẫn làm runtime thoát mã 2.

| Khóa | Mặc định | Ghi chú |
|---|---|---|
| `viewerAccess` | `"private"` | `private`, `any`, `off` |
| `serialPorts` | `["ttyAS*"]` | tên `tty…` (có thể kết thúc bằng `*`) hoặc đường dẫn `/dev/serial/by-id/…`, `/dev/serial/by-path/…` |
| `retainWindowS` | 5 | 1–60: cửa sổ gom ghi của Tag giữ qua mất điện |
| `retainDir` | `<dataDir>/retain` | thư mục ghi được |
| `tagWriteSessionBurst`, `tagWriteSessionPerMin`, `tagWriteGlobalBurst`, `tagWriteGlobalPerMin`, `tagWriteQueuePerChannel`, `tagWriteQueueTotal` | 10, 20, 20, 20, 16, 64 | giới hạn tốc độ và hàng đợi ghi Tag; có trần (FR-041), không đặt cao hơn được |

### Trang xem: `viewerAccess` và SNAT của router

Từ 0.5.0, phần không cần đăng nhập (trang xem, `/assets`, `/project`, `system/info`, `projects/active`, live không kèm phiên) chỉ phục vụ **nguồn thuộc mạng riêng** (10/8, 172.16/12, 192.168/16, 100.64/10, 169.254/16, 127/8; fc00::/7, fe80::/10, ::1). Nguồn khác nhận 403. Request HTTPS có phiên hợp lệ (Studio) không bị lọc. Từ 1.0 (rà soát bảo mật 011), `system/info` không kèm phiên chỉ cho mã và câu chung của cảnh báo (`warningDetails[].detail` là `null`: không lộ đường dẫn thư mục khóa, Tag, nguồn đồng hồ); Studio đọc bằng token nên thấy đủ.

| Giá trị | Hành vi |
|---|---|
| `private` (mặc định) | như trên |
| `any` | mọi nguồn xem được trang không đăng nhập; `system/info` cảnh báo, `deploy.sh` in cảnh báo. Chỉ nên dùng khi demo |
| `off` | tắt trang xem; `system/info` vẫn phục vụ mạng riêng và loopback (script triển khai và kiểm tra sức khỏe gọi qua `127.0.0.1`) |

Chỉnh: sửa `"viewerAccess"` trong `/etc/mat-runtime/runtime.json`, rồi `systemctl restart mat-runtime`. Cờ `--viewer-access <giá trị>` chỉ dùng khi chạy tay hoặc test x64: unit chỉ truyền `--config`. Đang xem qua port-forward 9080 thì sau khi lên 0.5.0 sẽ bị chặn tới khi đặt `any` hoặc dùng VPN (`deploy.sh` in lời nhắc này lần đầu lên 0.5).

Hai giới hạn của bộ lọc (ADR-018):

- **SNAT của router:** nếu router port-forward đổi địa chỉ nguồn thành địa chỉ trong LAN (SNAT/masquerade), runtime chỉ thấy địa chỉ riêng và cho qua mọi request từ Internet. Bộ lọc không phát hiện được: kiểm bằng thử từ mạng 4G, và giữ giới hạn nguồn ở router.
- **Proxy ngược chạy cùng máy:** nginx, stunnel... trên chính BL335 kết nối tới runtime qua `127.0.0.1`. Loopback luôn thuộc mạng riêng nên mọi request qua proxy được cho qua. Không đặt proxy cùng máy cho cổng 8080 khi `viewerAccess` là `private`.

### Cổng serial (Modbus RTU)

- `serialPorts` là danh sách cho phép. Studio và `--check-project` báo `E_SERIAL_NOT_ALLOWED` cho cổng ngoài danh sách. Cổng console bị loại kể cả khi khớp mẫu.
- **Bộ chuyển USB-RS485:** tên `ttyUSB0`, `ttyUSB1` đổi theo thứ tự cắm. Dùng đường dẫn cố định trong `/dev/serial/by-id/` (theo mã sản phẩm và số seri của bộ chuyển) hoặc `by-path/` (theo cổng USB), ví dụ `"serialPorts": ["ttyAS*", "/dev/serial/by-id/usb-FTDI_FT232R_USB_UART_A50285BI-if00-port0"]`. Mẫu `by-id` không dùng `*`.
- **Liệt kê cổng** (không mở cổng, không audit):

```sh
runuser -u matscada -- /opt/mat-runtime/bin/mat-runtime --list-serial [--config /etc/mat-runtime/runtime.json]
```

  Cùng nội dung với `GET /api/v1/serial/ports` (Studio: Kết nối, "Cổng serial của BL335").
- **Sandbox của unit** (contract device-config §3). Phương án chính: trong `mat-runtime.service` thay `PrivateDevices=true` bằng `PrivateDevices=false`, `DevicePolicy=closed`, `DeviceAllow=char-ttyAS rw`, `char-ttyUSB rw`, `char-ttyACM rw` và `SupplementaryGroups=dialout`. Điều kiện (dò chỉ đọc, [quickstart.md](../../specs/006-tags-modbus/quickstart.md) §8): `/proc/devices` có nhóm `ttyAS`; `/proc/cgroups` có controller `devices` bật; `/dev/ttyAS*` thuộc nhóm `dialout`, mode `0660`. Thiếu điều kiện đầu hoặc thứ hai: giữ `PrivateDevices=true` và dùng **drop-in** `/etc/systemd/system/mat-runtime.service.d/serial.conf` (mỗi cổng trong `serialPorts` không có `*`: `BindPaths=-/dev/<cổng>`, `DeviceAllow=/dev/<cổng> rw`; cắm bộ chuyển USB sau thì phải `systemctl restart mat-runtime`). Thiếu điều kiện thứ ba: luật udev `/etc/udev/rules.d/60-mat-serial.rules` với `KERNEL=="ttyAS[1-9]", GROUP="dialout", MODE="0660"`, chỉ cài khi người dùng cho phép.
- **Trạng thái trong repo:** `deployment/systemd/mat-runtime.service` hiện **vẫn là `PrivateDevices=true`**; `deploy.sh` chưa dò điều kiện, chưa sinh drop-in; chưa có luật udev. Các mục này (T169) chờ số đo trên BL335: chọn phương án sau khi chạy lệnh dò. Chưa thể dùng RTU trên thiết bị tới khi xong. Mọi thay đổi trên BL335 ghi vào [device-changes.md](../reports/device-changes.md) kèm cách hoàn tác. Kiểm sau khi cài: `systemd-analyze security mat-runtime` (không tệ hơn 0.4 quá 0,3 điểm), `systemctl show mat-runtime -p DevicePolicy -p DeviceAllow`.

### Tag giữ qua mất điện: `retain/`

Giá trị Tag nội bộ giữ qua mất điện nằm trong `/var/lib/mat-runtime/retain/` (`retain-a.bin`, `retain-b.bin` luân phiên; thư mục `0700`, file `0600`, thuộc `matscada`), do runtime tạo khi có Tag đầu tiên loại này; ghi gom theo `retainWindowS`. Bản lưu hỏng đổi tên `*.corrupt-*` (giữ tối đa 3 bộ). `deploy.sh` và `rollback.sh` không đụng thư mục này; runtime 0.4 bỏ qua nó. Xem nội dung:

```sh
runuser -u matscada -- /opt/mat-runtime/bin/mat-runtime --retain-dump [--config ...] [--data-dir ...] [--retain-dir ...]
```

In giá trị đang lưu, thế hệ, file đang dùng và trạng thái `ok`, `fallback` hoặc `lost`. Chỉ đọc, không audit.

### Dung lượng `audit.db` khi ghi Tag

Mỗi lần ghi Tag tốn khoảng 0,9 KB trong `audit.db` (hai dòng và chỉ mục). Trần mặc định `auditMaxMB` là 64 MiB, giữ khoảng **70.000 lần ghi**; ghi liên tục ở mức giới hạn tốc độ thì audit chỉ giữ được vài ngày. Cần giữ lâu hơn: nâng `auditMaxMB` (8–1024) trong `runtime.json`, tính khoảng 1 MiB cho 1.100 lần ghi, và kiểm chỗ trống ở `/var/lib/mat-runtime`. Xem [ADR-017](../adr/017-tag-engine-v1.md).

### Tạo kết nối Modbus trong Studio

Cần project 0.2 (project 0.1 nâng cấp bằng lệnh trong Studio, xem [apps/studio/README.md](../../apps/studio/README.md)). Thử kết nối cần tài khoản engineer trở lên và đăng nhập Online (HTTPS).

1. Mở project, mở editor **Kết nối** từ cây project.
2. **Modbus TCP:** bấm "Thêm kênh Modbus TCP"; điền tên, "Địa chỉ máy" (IP của PLC), "Cổng TCP" (thường 502).
3. **Modbus RTU:** bấm "Thêm kênh Modbus RTU"; chọn "Cổng serial" (phần "Cổng serial của BL335", nút "Đọc danh sách cổng", cho danh sách như `--list-serial`; cổng ngoài `serialPorts` bị báo), tốc độ baud, bit dữ liệu, chẵn lẻ, bit dừng, chế độ RS485 nếu cần.
4. Chọn kênh, bấm "Thêm thiết bị trường": đặt Unit ID (TCP) hoặc địa chỉ slave (RTU), thứ tự byte, timeout, số lần thử lại.
5. "Thử kết nối": nhập địa chỉ đọc thử và số thanh ghi; kết quả `OK`, `REFUSED`, `TIMEOUT`, `EXCEPTION` hoặc lỗi DNS kèm mã và dữ liệu thô. Việc thử chạy trên thiết bị (nên thấy được mạng của PLC), giới hạn 10 lần mỗi phút.
6. Trong **Bảng Tag**, đặt Tag vào thiết bị vừa tạo (loại, địa chỉ, kiểu dữ liệu); lưu; Online, "Nạp project xuống thiết bị".

## 5d. HTTPS cho Chrome và đăng nhập trên trang vận hành (feature 007, runtime 0.6.0)

Từ 0.6 trang runtime (`https://<IP>:8443/`) có widget điều khiển. Ghi Tag từ trình duyệt cần: HTTPS, tài khoản role `operator` trở lên, phiên đăng nhập bằng cookie. Mọi thay đổi trên thiết bị ghi vào `docs/reports/device-changes.md`. Hợp đồng: `specs/007-screens-widgets/contracts/{device-api-1.2,web-session,device-config-007}.md`; quyết định: ADR-021.

### 1. Tài khoản

Tạo bằng lệnh trên thiết bị (root), không có đăng ký, quên mật khẩu hay đổi mật khẩu trên web:

```sh
mat-runtime --user-add vanhanh1 --role operator      # điều khiển được
mat-runtime --user-add xem1 --role viewer            # đăng nhập được, chỉ xem
```

### 2. Chrome và chứng chỉ tự ký

Từ 0.6 chứng chỉ tự sinh có SAN IP của mọi card nên Chrome chấp nhận `https://<IP>:8443` khi đã tin chứng chỉ. Chứng chỉ **đã có từ 0.5 không tự đổi** (`system/info.warnings` có `TLS_NO_IP_SAN`): chạy `mat-runtime --regen-cert` (đổi fingerprint: Studio phải ghim lại) hoặc dùng CA của khách hàng (mục 3).

1. Mở `https://<IP>:8443/device.crt` (Chrome báo chưa tin: chọn tiếp tục, hoặc dùng `scp`) để tải `mat-device.crt`.
2. So fingerprint với `mat-runtime --cert-info` (dòng `SHA256 Fingerprint=`) hoặc mục Thiết bị của Studio. Chỉ khớp từng cặp ký tự mới cài.
3. Windows: `certmgr.msc` → Trusted Root Certification Authorities → Import; hoặc `certutil -addstore -f Root mat-device.crt` (quyền quản trị). Nhiều máy: Group Policy (Computer Configuration → Windows Settings → Security Settings → Public Key Policies → Trusted Root Certification Authorities).
4. Chrome dùng kho chứng chỉ của Windows: khởi động lại Chrome.
5. Đặt IP tĩnh cho BL335 (SAN theo IP) hoặc chạy lại `--regen-cert` sau khi đổi IP; nếu card đổi IP, `system/info.warnings` có `TLS_SAN_MISMATCH`.

Kết quả thử (T006, 2026-10-13): Chromium 152 (Linux, kho NSS) tin chứng chỉ tự ký `CA:FALSE` có SAN IP, `keyUsage digitalSignature`, `extendedKeyUsage serverAuth` khi chứng chỉ được cài làm chứng chỉ tin cậy; SAN sai IP cho `ERR_CERT_COMMON_NAME_INVALID`; chưa tin cho `ERR_CERT_AUTHORITY_INVALID`. Chrome trên Windows chưa thử (cần người cài vào kho: T149).

### 3. CA của khách hàng

```sh
mat-runtime --make-csr --san 192.168.1.110,scada.example.vn > bl335.csr   # khóa mới ở tls/pending-key.pem, không rời thiết bị
# gửi bl335.csr cho CA, nhận chain.pem (chứng chỉ máy chủ rồi chuỗi CA; KHÔNG có khóa riêng)
mat-runtime --import-cert chain.pem      # kiểm khóa, ghi server.pem, giữ bản trước ở tls/server.pem.prev
systemctl restart mat-runtime            # rồi ghim lại fingerprint ở Studio
```

Máy trong công ty đã tin CA nên không phải cài gì. `--cert-info` in chủ thể, người ký, SAN, hạn, fingerprint.

**Giới hạn đã đo (web-it `cert`, 2026-10-13):** mbedTLS của thiết bị cấu hình thu gọn, **không có RSA** (research R4). `--import-cert` chỉ nhận chứng chỉ máy chủ do CA ký bằng **ECDSA** (SHA-256); chứng chỉ ký bằng RSA (mẫu mặc định của nhiều CA doanh nghiệp, ví dụ AD CS) bị từ chối với "Signature algorithm (oid) is unsupported", chứng chỉ cũ giữ nguyên. Hai cách: nhờ quản trị CA cấp mẫu chứng chỉ ký bằng ECDSA, hoặc dùng chứng chỉ tự ký của thiết bị (`/device.crt`, mục 2). Chưa thử với CA thật của khách hàng (T149).

### 4. Từ xa

Khuyến nghị VPN. Port-forward HTTPS (8443) chỉ khi chọn: `viewerAccess: private` vẫn chặn trang với nguồn không có phiên nhưng `/login` luôn mở; dùng mật khẩu dài; 5 lần sai khóa cặp (tên, IP) 5 phút (gấp đôi khi lặp, tối đa 60 phút), 20 lần sai trong 10 phút khóa IP; tấn công từ nhiều IP vào một tên chỉ ghi audit `auth.distributed_attack` (rủi ro còn lại, research R5 của 011).

### 5. Phiên và cấu hình (`/etc/mat-runtime/runtime.json`)

| Khóa | Mặc định | Ý nghĩa |
|---|---|---|
| `viewerLogin` | `off` | `required`: không có trang hay dữ liệu nếu chưa đăng nhập (đổi cần khởi động lại; giá trị lạ: runtime không chạy) |
| `webSessionIdleMin` | 30 (5–480) | hạn rảnh; trạm vận hành 24/7 đặt 480 |
| `webSessionMaxHours` | 12 (1–24) | hạn tối đa của phiên |
| `webMaxSessions` | 12 (1–16; 8 trước feature 010) | số phiên web đồng thời; tổng với phiên Studio ≤ 32 |

Kiosk (màn hình luôn mở, không có người gõ mật khẩu) nên dùng `viewerLogin: off`.

### 5a. Worker HTTPS (`httpsThreads`)

Từ 0.6.0 mặc định 40 (trước là 8; giới hạn 4-64). Mỗi kết nối WebSocket live và mỗi kết nối keep-alive đang rảnh giữ một worker. Kết nối rảnh được giữ 3 s (từ 2026-10-16; trước là 15 s), Studio tự bỏ kết nối rảnh sau 2 s (ADR-010). Với 8 worker, 4 trang cùng mở từng cần tới 15 s mới có dữ liệu sống (web-it `f5x10`: 15,6 s với 8 worker, dưới 1 s với 40); với keep-alive 15 s, 10 trang cùng F5 từng chờ worker khoảng 8 s, sau khi giảm còn 3 s thì xấu nhất 3,2 s. Số đo RAM thật trên BL335 chờ T150/T151.

### 6. Cookie bị chặn, NAT, nhiều người chung IP

Phiên gắn IP lúc đăng nhập: đổi mạng giữa chừng thì đăng nhập lại. Cookie `__Host-mat_sid` cần HTTPS (không có qua HTTP: trang HTTP chỉ xem). Khóa tạm theo IP có thể khóa cả nhóm cùng sau một NAT.

### 7. Khắc phục sự cố

| Chrome báo | Nguyên nhân |
|---|---|
| `NET::ERR_CERT_AUTHORITY_INVALID` | chưa tin chứng chỉ (mục 2) |
| `NET::ERR_CERT_COMMON_NAME_INVALID` | SAN thiếu IP đang mở (`TLS_NO_IP_SAN`, `TLS_SAN_MISMATCH`): `--regen-cert` |
| `ERR_CERT_DATE_INVALID` | không xảy ra với chứng chỉ tự ký (hạn đến 9999); có thể với chứng chỉ CA riêng |
| điều khiển bị khóa | trang mở bằng HTTP, chưa đăng nhập, hoặc hết phiên |

Mã lỗi của API: cookie không có trong kho phiên (hết hạn hoặc do client tự đặt) trả 401 `SESSION_EXPIRED`; `SESSION_INVALID` chỉ khi phiên còn nhưng đổi IP hoặc đã bị hủy. Cả hai đều là "không có phiên".

## 5e. Đồ họa SVG và binding 0.4 (feature 008, runtime 0.7.0)

Project định dạng **0.4** (`minRuntimeVersion` `0.7.0`) có item `svg` nhập từ file vẽ ngoài, binding theo phần tử (hoạt ảnh, sự kiện nhấp). Runtime < 0.7.0 từ chối project 0.4 (`E_SCHEMA_VERSION`); Studio khóa Nạp xuống ở dòng "Tương thích runtime". Hợp đồng: `specs/008-svg-import-binding/contracts/project-format-0.4.md`; quyết định: ADR-023 đến ADR-026, nguồn số liệu: [research R20](../../specs/008-svg-import-binding/research.md).

- **Phía BL335 gần như không đổi:** thêm luật kiểm 0.4 (C++) lúc nạp project, tăng `RUNTIME_VERSION`, và `/project/*` phục vụ thêm các file SVG và binding của item (đã nằm trong danh sách `projectFiles` của project). Ước tính RSS tăng dưới 0,5 MB, CPU không đổi. Không có cổng, tài khoản hay cấu hình `runtime.json` mới; ghi Tag từ phần tử SVG đi qua đúng đường và bảng khóa của widget (mục 5d), audit có `context.widget` = UID phần tử.
- **File SVG phục vụ không nén:** `Cache-Control: no-cache`, không `.gz` (không có zlib trong bản build, gói `.matscada` 1.0.0 chỉ chứa `.json` và `.svg`). Vì vậy kích thước SVG ảnh hưởng thẳng đến thời gian mở màn hình khi nhiều client cùng F5: ước tính 10 client x (SVG 300 KB + binding 30 KB) ≈ 3,3 MB ≈ 0,4 s ở 65 Mbps; **chưa đo trên BL335** (cần thiết bị, xem báo cáo nghiệm thu).
- **`W_SVG_HEAVY`:** Studio cảnh báo khi một file SVG của item từ 1 MiB trở lên, kèm ước tính thời gian tải khi 10 client cùng F5 qua LAN 100 Mbps; từ 5 MiB là lỗi `E_SVG_LIMIT`. Cách giảm: nhập SVG qua Studio (làm tròn số, bỏ metadata và `defs` không dùng), bật **Tối ưu**, nhúng ảnh nhỏ hoặc bỏ ảnh; dùng chung một file SVG cho nhiều thể hiện của ký hiệu.
- **Kiểm sau triển khai:** mở `https://<IP>:8443/`, vào màn hình có SVG: hiển thị đúng, giá trị đổi, phần tử có sự kiện hiện con trỏ bàn tay. Hoạt ảnh chạy trên máy khách (Chrome 120 trở lên), không tính vào ngân sách của BL335; tab ẩn thì hoạt ảnh tạm dừng.
- **Gỡ:** như mục 6 (rollback về bản trước); project 0.4 đang nạp bị runtime cũ từ chối nên cần nạp lại project 0.3 sao lưu trước đó.
## 5f. Alarm (feature 009, runtime 0.8.0)

Chỉ chạy khi project (định dạng 0.5) có alarm. Dữ liệu: `/var/lib/mat-runtime/alarm.db` (+ `-wal`, `-shm`), cùng thư mục và quyền với `history.db`; deploy và rollback không đụng tới. File hỏng được đổi tên thành `alarm.db.corrupt-<epoch>` (giữ tối đa 3).

Khóa mới của `runtime.json`: `alarmRetentionDays` (1–3650, mặc định 180), `alarmMaxBytes` (4 MiB–1 GiB, mặc định 64 MiB), `alarmCommitMs` (200–60000, mặc định 2000), `alarmCommitMaxMs` (mặc định 60000, ADR-028), `alarmChatterWindowS` (10–600, mặc định 60); các khóa còn lại và ý nghĩa: [alarm-operations.md](alarm-operations.md) mục 1. Giá trị ngoài khoảng bị kẹp và ghi cảnh báo lúc khởi động.

Xác nhận, tạm ẩn, vô hiệu, mất điện, đọc `system/info.alarms` (`logState`, `droppedChanges`, `dbBytes`) và xử lý `alarm.db` hỏng: [alarm-operations.md](alarm-operations.md). Số đo ghi và thử mất điện trên BL335 chờ SSH và người (`docs/reports/009-acceptance.md`).
## 5g. Lịch sử, tổng hợp và báo cáo (feature 010, runtime 0.9.0)

Chế độ ghi mới: `trigger` (ghi một dòng khi Tag kích hoạt có cạnh) và **Kết hợp** (`onChange` + `maxIntervalMs`). Nhóm có khối `aggregates` giữ thêm hai bảng tổng hợp 1 phút và 1 giờ trong `history.db` (schema 2); nâng schema xảy ra lúc runtime mở file, một giao dịch, không viết lại dữ liệu. Runtime 0.8 mở được file schema 2 (bỏ qua bảng lạ) nhưng từ chối `logging.json` 0.6: rollback runtime thì rollback cả project (`state.json` của 005).

**Truy vấn:** `GET /api/v1/history/{catalog,series,aggregate,rows,export.csv}` (HTTPS, mọi tài khoản đăng nhập, cookie của trang hoặc token Bearer). Hợp đồng: `specs/010-history-reports/contracts/history-api.md`. Giới hạn (`runtime.json`, đổi cần khởi động lại):

| Khóa | Mặc định | Khoảng |
|---|---|---|
| `historyApi` | `true` | `false` tắt toàn bộ (404 `NO_HISTORY`); ghi dữ liệu không đổi |
| `historyMaxConcurrent` | 2 | 1–4 truy vấn đồng thời; vượt thì 429 `BUSY` |
| `historyQueryTimeoutMs` | 10000 | 1000–30000 |
| `historyMaxScanMiB` | 64 | 8–256: quét dòng thô ước tính tối đa (`SCAN_LIMIT`) |
| `historyReaderCacheKiB` | 4096 | 1024–8192; tổng cache SQLite ≤ 32 MiB, vượt thì hạ và ghi journal |

Mỗi yêu cầu: một phiên một yêu cầu tại một lúc, xuất CSV một lần tại một lúc (phát dần, ≤ 500.000 dòng, audit `history.export`). Truy vấn chạy trên luồng nice +10 với kết nối chỉ đọc riêng; không chặn ghi.

**Lệnh chỉ đọc** (chạy được khi runtime chạy):

```sh
mat-runtime --export-history <nhóm> --from "2026-10-12 06:00" --to "2026-10-12 14:00" --res 1h --fields avg,min,max --no-bom
mat-runtime --verify-aggregates <nhóm> [--from … --to …] [--json]   # 0 = khớp, 1 = có sai khác, 2 = lỗi
mat-runtime --history-stats [--json]                                  # hàng, dung lượng, schema, số lần chạy
```

`--res`, `--fields`, `--no-bom` cho CSV cùng định dạng với `export.csv` (CRLF, số `%.15g`, BOM, ô chuỗi bắt đầu `=+-@` thêm `'`). `--verify-aggregates` dựng lại bucket từ dòng thô bằng cùng bộ cộng dồn, ngắt tín hiệu tại mỗi lần chạy mới (`mat_runs`); các cửa sổ từ dòng cuối của lần chạy đã kết thúc tới lần chạy kế được bỏ qua (không biết chính xác lúc dừng sau `kill -9`) và đếm riêng.

**Ghi tổng hợp và eMMC:** bucket phút đóng, mốc `agg_built_to` và `mat_runs.alive_ms` được ghi cùng một giao dịch mỗi 15 phút (`aggFlushMs`), không mỗi commit. Mất điện làm mất tối đa 15 phút bucket đã đóng; khởi động lại dựng chúng từ dòng thô (`--verify-aggregates` dung sai 17 phút sau lần sống cuối). Số đo x64 cho 200 Tag đổi giá trị mỗi giây: tổng hợp thêm 64 MB/ngày ghi (trần SC-004 là 80 MB/ngày ở ca xấu nhất; ADR-031); số trên BL335 chưa đo. Bucket tín hiệu hằng lưu `max`/`first`/`last` là NULL; tệp `history.db` schema 2 dựng bằng bản dev trước 2026-10-15 có cột NOT NULL cũ và phải bỏ đi (chưa có bản phát hành nào dùng).

**Đo ghi eMMC trên thiết bị (ADR-039):** kernel BL335 (5.4.61) không có `/proc/<pid>/io` (`CONFIG_TASK_IO_ACCOUNTING` tắt) và không có blkio, nên `historian.io` dùng bộ đếm byte `write()` ở lớp VFS của SQLite (`history.db`, `alarm.db`, `audit.db`, kể cả `-wal`/`-journal`). Đọc: `curl -s http://<thiết bị>:<cổng>/api/v1/system/info`, mục `historian.io`: `source` là `sqlite-vfs`; `bytesPerDay` (ngoại suy 24 giờ, `null` dưới 600 s sau khi khởi động), `sqliteVfs.sinceStart` (byte từng DB từ lúc khởi động) và `sqliteVfs.sinceStartTotal`. Đây là **cận trên** của ghi flash: không gồm project store, `RetainStore`, nhật ký systemd và khuếch đại ghi trong eMMC; ngược lại, kernel có thể gộp các lần ghi cùng trang. `/sys/block/mmcblk0/stat` đo cả hệ thống (gồm `atscada`…, đã thấy 2,6 đến 4,7 GB/ngày), chỉ để tham khảo, không dùng nghiệm thu SC-022. Vòng đo là bộ nhớ: khởi động lại thì `coverageS` về 0.

**Luồng của runtime:** mỗi luồng tự đặt tên (`top -H`, `/proc/<pid>/task/*/comm`): `mat-historian`, `mat-forward`, `mat-alarm-wr`, `mat-wr-audit`, `mat-wr-pulse`, `mat-retain`, `mat-argon2`, `mat-watchdog`, `mat-modbus` (mỗi kênh Modbus TCP), `mat-discovery`. Phần lớn số luồng là worker của CivetWeb: `httpThreads` 24 + `httpsThreads` 64 (mặc định từ 1.0, trước là 40; ADR-010; mỗi socket sống và mỗi kết nối keep-alive giữ một worker), cộng khoảng 9 luồng chức năng ở trên và mỗi kênh Modbus một luồng (stack 256 KiB, ADR-014). Đếm: `ls /proc/$(pidof mat-runtime)/task | wc -l`; theo tên: `cat /proc/<pid>/task/*/comm | sort | uniq -c`.

**Số đo ghi:** `system/info.historian.io` (`write_bytes` của tiến trình, mẫu mỗi 60 s, 24 giờ) so với `estimateBytesPerDay`. `write_bytes` gồm mọi ghi của tiến trình (journal, audit, state), không chỉ `history.db`. `historian.aggregates.backfill` cho tiến độ dựng bù khi bật tổng hợp cho nhóm đã có dữ liệu (nền, ≤ 20 ms mỗi lượt).

**Giới hạn đã biết:** `delta` không chính xác tuyệt đối qua khởi động lại (tín hiệu ngắt); số nguyên 64 bit trên 2^53 mất chính xác trong số tổng hợp; tên Tag đã bỏ khỏi project không hiện trong `catalog` (dữ liệu vẫn nằm trong file tới hết thời hạn).

## 5h. Khóa cấu hình của bản 1.0 (feature 011)

`/etc/mat-runtime/runtime.json` có thêm các khóa dưới đây (đầy đủ: `specs/011-pilot-hardening/contracts/device-api-011.md` §6). Mặc định là giá trị an toàn; `deployment/config/runtime.json` ghi tường minh mọi khóa.

| Khóa | Mặc định | Khoảng | Ý nghĩa |
|---|---|---|---|
| `allowedHosts` | `[]` | ≤ 32 tên, mỗi tên ≤ 253 byte | tên miền được nhận ở tiêu đề `Host` (IP literal luôn nhận) |
| `hostCheck` | `"strict"` | `"strict"`, `"off"` | `off` chỉ để gỡ rối, có cảnh báo `HOST_CHECK_OFF` |
| `maxConnPerSource` | 48 | 4–64 | kết nối đồng thời tối đa mỗi IP nguồn (áp tối đa 75 % `httpsThreads`, mặc định 64: chừa 16 worker cho nguồn khác); mỗi cổng còn giới hạn riêng 75 % worker của cổng đó: 18 trong 24 worker HTTP (`threads`) |
| `maxLiveClientsPerSource` | không đặt (nửa `maxClients`, làm tròn lên: 5) | 1–10 | phiên dữ liệu sống đồng thời tối đa của một IP nguồn; vượt: banner "Máy này đã mở tối đa N kết nối dữ liệu sống", đóng 4429. Nhiều máy sau một NAT (hoặc một màn hình mở nhiều tab): đặt 10 |
| `maxConcurrentLogins` | 2 | 1–4 | số lần kiểm mật khẩu chạy cùng lúc |
| `pulseRecovery` | `"on"` | `"on"`, `"off"` | nhả xung dở khi khởi động |
| `update.enabled` | `false` | | bật cập nhật runtime qua mạng (OTA) |
| `update.maxPackageMiB` | 64 | 8–256 | trần kích thước gói cập nhật |
| `update.trustedKeysDir` | `/etc/mat-runtime/trusted-keys` | | thư mục khóa công khai tin cậy |
| `logic.writes` | `"off"` | `"off"`, `"on"` | cho phép logic ghi xuống PLC |
| `logic.maxWritesPerMin` | 20 | 1–60 | tổng lệnh ghi từ logic mỗi phút |
| `logic.flushS` | 60 | 10–600 | chu kỳ ghi trạng thái logic xuống eMMC |
| `logic.scanMs` | 100 | 50–1000 | chu kỳ quét logic |
| `tzOffsetMin` | 420 | -720–840 | múi giờ của lịch (phút so với UTC; 420 là UTC+7) |

- **Kiểm `Host` (chống DNS rebinding, contract 011 §1):** mọi yêu cầu HTTP, HTTPS và nâng cấp WebSocket được kiểm tiêu đề `Host` **trước** mọi xử lý khác. Luôn nhận: địa chỉ IPv4/IPv6 (mọi IP, nên NAT và chuyển cổng vẫn chạy), `localhost`, tên máy của thiết bị (`hostname`, đọc lúc khởi động) và `<tên máy>.local`. Tên khác (DNS nội bộ, DDNS, tên do khách hàng đặt) bị trả **421 `HOST_NOT_ALLOWED`** và ghi audit `access.denied` (`detail.host` cắt 64 byte): lần đầu của mỗi (IP nguồn, mã) ghi ngay, các lần sau trong cùng phút chỉ đếm, rồi một bản ghi tổng `target "*"` có `detail.repeated`. Cách thêm: ghi tên vào `allowedHosts`, ví dụ `"allowedHosts": ["scada.nhamay.vn"]`, rồi `systemctl restart mat-runtime`; so khớp chính xác, không phân biệt hoa thường, không có ký tự đại diện (`*.nhamay.vn` không nhận tên con). Thiếu `Host` (HTTP/1.1), hai tiêu đề `Host`, ký tự điều khiển hoặc dài hơn 255 byte: 400 `BAD_REQUEST`. Danh sách đang nhận: `GET /api/v1/device/identity`, mục `acceptedHosts` (`names`, `ips: ["*"]`), chỉ trả khi request có phiên (Studio đã đăng nhập: trang Thiết bị hiện danh sách này). `"hostCheck": "off"` tắt kiểm (chỉ để gỡ rối) và `system/info` có cảnh báo `HOST_CHECK_OFF`.
- **Cảnh báo `SSH_ROOT_PASSWORD`:** runtime đọc (chỉ đọc) `/etc/ssh/sshd_config` và các tệp mà dòng `Include` của nó chỉ tới (Debian: `sshd_config.d/*.conf`) lúc khởi động và 10 phút một lần, theo luật của sshd (giá trị đầu tiên thắng; dòng trong khối `Match` không tính). Cảnh báo khi `PermitRootLogin yes` và `PasswordAuthentication` không phải `no`. Xử lý: dùng khóa SSH cho root (`PermitRootLogin prohibit-password`) hoặc `PasswordAuthentication no`, rồi `systemctl reload ssh`. Không đọc được tệp thì không cảnh báo.
- **Khóa đăng nhập (contract 011 §2):** sai 5 lần liên tiếp cho một cặp (tên, IP) khóa cặp đó 5 phút (nhân đôi khi lặp lại trong 24 giờ, tối đa 60 phút); 20 lần sai từ một IP (mọi tên) trong 10 phút khóa IP đó 5 phút. Người dùng thật đăng nhập từ máy khác (IP khác) vẫn vào được: kẻ đoán mật khẩu không khóa được tài khoản của người khác. Mở sớm: `mat-runtime --user-unlock <tên>` (mọi cặp của tên) hoặc `--user-unlock-all` (mọi cặp và mọi IP, có hiệu lực trong 5 s); khởi động lại dịch vụ cũng xóa mọi khóa. `deploy.sh` in lại các lệnh này.
- **Mật khẩu:** mật khẩu mới 15–128 ký tự (`--user-add`, `--user-passwd`; ADR-011); tài khoản cũ không bị ép đổi nhưng nên đổi. `deploy.sh` nhắc ở cuối mỗi lần cài.
- **Cảnh báo SSH lúc cài:** `deploy.sh` đọc (chỉ đọc) cấu hình sshd (`sshd -T` nếu có, không thì `/etc/ssh/sshd_config`) và in `CẢNH BÁO SSH_ROOT_PASSWORD` khi root đăng nhập được bằng mật khẩu; không bao giờ tự sửa sshd. Runtime báo cùng cảnh báo trong `system/info` (mục trên).
- **Gateway Modbus TCP nhiều unit:** một thiết bị trường (unit) không trả lời chỉ làm Tag của nó BAD sau timeout; kết nối TCP không bị đóng, các unit khác vẫn được đọc mỗi chu kỳ; unit câm được thử lại theo backoff 1–30 s; câu trả lời muộn (sai mã giao dịch) bị bỏ. Đặt `timeoutMs` của từng thiết bị nhỏ hơn chu kỳ quét của nhóm (cảnh báo `W_DETECT_SLOW` trong Studio).
- **Giới hạn kết nối theo nguồn:** `maxConnPerSource` (bảng trên) đếm HTTP, HTTPS và WebSocket của một IP cộng chung; vượt thì kết nối mới bị đóng ngay. Thêm từ rà soát bảo mật 011: trên mỗi cổng một nguồn giữ tối đa 75 % worker của cổng đó (HTTP 18/24, HTTPS 48/64), và tối đa `maxLiveClientsPerSource` phiên dữ liệu sống (mặc định 5 của 10), nên một máy không chiếm hết worker HTTP hay hết 10 phiên dữ liệu sống. Nhiều người sau một NAT dùng chung con số này: tăng tới 64 nếu cần, và đặt `nft ct count` ở tầng mạng cho phần còn lại (`docs/deployment/hardening.md`).
- **Tệp thừa trong gói (E_PACKAGE_EXTRA_FILE):** gói project chỉ được chứa đúng các tệp mà project tham chiếu (`project.json`, Tag, màn hình, SVG, binding, bảng, logic, template đã khai). Tệp không được tham chiếu bị từ chối ở bước `validate`; thư mục ẩn hay tệp tạm (`.mat-editor/`, `.mat-backup/`, `.git/`, `node_modules/`, `Thumbs.db`, `desktop.ini`, `~*`, `*.tmp`) bị từ chối ngay ở `verify-package`. Trước 011 tệp thừa làm digest của project đang chạy khác digest của gói, kiểm sức khỏe hết giờ (`HEALTH_TIMEOUT`) rồi quay về bản cũ. Studio chỉ đóng gói tập tệp của project nên không gặp lỗi này; công cụ khác tự đóng gói thì phải bỏ tệp thừa.
- **Quyền ghi theo Tag (`writeMinRole`, định dạng 1.0):** Tag khai `"writeMinRole": "engineer"` (hoặc `"administrator"`) chỉ ghi được từ role đó trở lên; máy chủ trả 403 `FORBIDDEN` cho cả lô lệnh có Tag đó và ghi audit `tag.write` `denied`. `minRole` của nút hay sự kiện SVG chỉ khóa giao diện, không phải phân quyền.
- **Ghi PLC từ logic bị administrator dừng:** bật lại bằng `mat-runtime --logic-writes-reset` (root, có audit `logic.writes.enabled`, hiệu lực trong 5 s); không cần xóa `logic-state.json`. Tệp yêu cầu phải là tệp thường của root, quyền 0600 (lệnh tự làm); tệp khác bị xóa và bỏ qua.
- **`logic-state.json` hỏng:** runtime khởi động với ghi PLC từ logic **dừng** (cảnh báo `LOGIC_WRITES_OFF`, `detail.reason` = `STATE_UNREADABLE`); kiểm PLC rồi chạy `mat-runtime --logic-writes-reset` để bật lại. Không xóa tệp bằng tay.
- **Sai kiểu hoặc ngoài khoảng:** runtime không khởi động và in lỗi nêu tên khóa (ví dụ `'logic.scanMs' phải là số nguyên 50–1000`).
- **Khóa lạ** (kể cả trong `update`, `logic`): từ bản 1.0 bị bỏ qua kèm dòng `warning: bỏ qua khóa không hỗ trợ: '…'` trên stderr (xem bằng `journalctl -u mat-runtime`), để file viết cho bản mới hơn vẫn chạy được. Gõ sai tên khóa thì runtime giữ giá trị mặc định an toàn; kiểm cảnh báo sau mỗi lần sửa file. Bản 0.9 trở về trước vẫn từ chối khởi động khi gặp khóa lạ: trước khi rollback xuống 0.9, bỏ các khóa của bảng trên khỏi file.

### Lệnh xung, nhật ký xung và giới hạn (FR-018 đến FR-020, D10)

Nút xung (`pulseMs`) do runtime giữ nhịp: ghi giá trị bật, chờ, ghi giá trị nhả. Từ bản 1.0 runtime ghi **nhật ký xung** `<dataDir>/pulse.journal` (mặc định `/var/lib/mat-runtime/pulse.journal`, mode 0600, chủ `matscada`): trước khi ghi giá trị bật, một dòng `arm` (mã yêu cầu, Tag, giá trị nhả, hạn nhả) được ghi và `fdatasync`; sau khi thiết bị xác nhận lệnh nhả, một dòng `done`. Mỗi xung tốn 2 lần `fdatasync` (nhỏ so với ngân sách eMMC). Tệp được gọn lại khi khởi động và khi quá 256 dòng.

- **Không ghi được nhật ký** (đĩa đầy, lỗi I/O): lệnh xung kết thúc `FAILED` `PULSE_JOURNAL_FAILED` và **không có lệnh nào** xuống PLC (không bao giờ bật mà không có bản ghi để nhả).
- **Hai xung cùng một Tag chồng nhau:** lệnh sau bị `REJECTED` `PULSE_IN_PROGRESS`.
- **`kill -9`, treo, mất điện giữa xung:** khi khởi động lại, mỗi mục còn `arm` được nhả ngay khi kênh và thiết bị trường của Tag nối được (thử lại mỗi 5 s, tối đa 10 phút). Lệnh nhả qua đủ chuỗi kiểm và ghi audit bền **trước** khi gửi: `tag.write` kênh `system`, tài khoản của người đã bấm xung, `detail.source` = `pulse-recovery`, `detail.pulseOf` = mã yêu cầu của xung (Constitution V, bản 2.0.2). Nhả được thì mục bị xóa khỏi nhật ký.
- **Hết 10 phút chưa nhả được** (PLC không nối, audit không ghi được, Tag không còn trong project): audit `tag.write` `failed` mã `PULSE_STUCK`, **giữ** mục trong nhật ký, `system/info.warnings` có `PULSE_STUCK` với `detail.tags`. Cảnh báo hết khi một xung sau của cùng Tag nhả được, lần khởi động sau nhả được, hoặc root xác nhận bằng `--pulse-ack` (dưới đây).
- **Lệnh nhả thất bại trong lúc chạy** (`PULSE_RELEASE_FAILED`): mục giữ lại và runtime thử nhả tiếp như trên (nguồn `pulse-recovery`). Lệnh bật bị timeout (không rõ bit đã bật chưa): mục giữ lại, nhả ở lần khởi động sau. Lệnh bật mà thiết bị đã nhận nhưng đọc lại lỗi (`READBACK_ERROR`, `READBACK_MISMATCH`): mục giữ lại, runtime nhả khi tới hạn xung và thử lại mỗi 5 s; chỉ `DEVICE_EXCEPTION` hay `NOT_SENT_*` (bit chưa bật) mới đóng mục ngay.
- **Tag đã đổi địa chỉ** (project mới trỏ Tag sang kênh, thiết bị hay địa chỉ khác dòng `arm`, hoặc giữ nguyên id mà đổi `host`/`port` của kênh, `unitId`/`addressBase` của thiết bị trường, vùng/offset mà địa chỉ phân giải ra): runtime không ghi gì (không nhả nhầm bit khác, nhầm PLC), giữ mục, `PULSE_STUCK`; kiểm bit cũ trên PLC bằng tay rồi đóng mục bằng `--pulse-ack`. Dòng `arm` lưu `ch`/`dev`/`addr` (từ rà soát T062) và `tgt` = băm của đích đã phân giải (từ rà soát lần 2, T202); dòng ghi trước T062 không có địa chỉ: không đối chiếu; dòng có `ch`/`dev`/`addr` mà không có `tgt`: chỉ đối chiếu ba trường đó.
- **Đóng mục `PULSE_STUCK` bằng tay (T202):** sau khi kiểm bit trên PLC, root chạy `mat-runtime --pulse-ack <requestId>` (mã trong log `journalctl -u mat-runtime | grep -i pulse` hay trong `pulse.journal`) hoặc `mat-runtime --pulse-ack all`. Lệnh ghi audit `pulse.ack` rồi để `<dataDir>/pulse-ack.req` (tệp thường của root, 0600; tệp khác bị xóa, bỏ qua); runtime lấy trong 5 s hoặc ở lần khởi động sau (cả khi không có project chạy), ghi audit `pulse.ack` (`started`, rồi `ok` kèm các mục đã đóng), ghi dòng `done` cho mỗi mục **đang báo** `PULSE_STUCK` khớp, bỏ Tag khỏi cảnh báo. Không ghi gì xuống PLC; mục đang được thử nhả (trong 10 phút đầu) không bị đụng. Không sửa `pulse.journal` bằng tay.
- **Dòng hỏng trong nhật ký** (sai kiểu, bị cắt, `seq` từ 2^63 trở lên): bỏ qua, đếm trong `--check-data`; runtime vẫn khởi động.
- **`pulseRecovery: "off"`:** runtime không ghi gì khi khởi động, giữ mục, hiện `PULSE_STUCK` để người vận hành kiểm PLC bằng tay.
- **Không có project chạy** mà nhật ký còn mục: chỉ hiện `PULSE_STUCK`.

**Giới hạn nói thẳng (D10): PLC phải tự nhả xung.** Nhật ký chỉ rút ngắn thời gian bit lệnh bị kẹt, không thay được bảo vệ trong PLC: mất điện BL335 lâu (hoặc mất kết nối PLC lâu) thì bit vẫn bật suốt thời gian đó. Chương trình PLC phải có bộ hẹn giờ tự xóa mọi bit lệnh kiểu xung sau tối đa N giây (N lớn hơn `pulseMs` dài nhất đã khai, ví dụ 2 lần), và logic an toàn (khóa liên động, dừng khẩn) không được dựa vào việc runtime nhả xung. Giá trị nhả là trạng thái nghỉ do chính người thiết kế xung khai báo, nên ghi nó sau khi khởi động an toàn hơn để bit bật dài.

Kiểm tra trên thiết bị: `sudo cat /var/lib/mat-runtime/pulse.journal` (rỗng hoặc chỉ các dòng `arm` đang chờ); `journalctl -u mat-runtime | grep -i pulse`.

## 5i. Cập nhật runtime qua mạng (OTA, feature 011, bản 1.0)

Mục này là "mục 5f" của tasks.md T121 (5f đã dùng cho alarm). Thiết kế: [ADR-035](../adr/035-release-trust-ota.md), [contracts/update-package.md](../../specs/011-pilot-hardening/contracts/update-package.md), API ở [device-api-011.md](../../specs/011-pilot-hardening/contracts/device-api-011.md) §3.

**Quy trình thủ công (mục 3, `deploy.sh`) giữ nguyên và là đường khôi phục**: cài lần đầu, cài hoặc nâng `mat-updater`, sửa khi OTA hỏng. OTA chỉ là đường thứ hai, **mặc định tắt**.

### Thành phần

| Thành phần | Chạy bằng | Vai trò |
|---|---|---|
| `mat-runtime` (API `/api/v1/system/update`) | `matscada` | nhận gói qua HTTPS (administrator, Bearer, không cookie), kiểm sơ bộ, giữ gói đã kiểm 30 phút, ghi `/var/lib/mat-runtime/update/request.json` khi người dùng xác nhận bằng mật khẩu |
| `mat-updater.path` | systemd | thấy `request.json` thì chạy `mat-updater.service` |
| `/usr/lib/mat-updater/mat-updater` | root (oneshot) | chép gói về `/var/lib/mat-updater/<id>/`, **kiểm lại toàn bộ** bằng `mat-update-verify`, giải nén vào `/opt/mat-runtime.new`, `--self-check` bằng `matscada`, đổi tên `/opt/mat-runtime` ↔ `.prev`, kiểm sức khỏe 60 s, tự quay về |
| `mat-updater-recover.service` | root, trước `mat-runtime.service` | xử lý cập nhật bị cắt ngang (mất điện, kill) ở lần khởi động sau |
| `/usr/lib/mat-updater/mat-update-verify` | ai cũng chạy được | đọc phong bì, kiểm chữ ký ECDSA P-256 và mọi tệp; mã thoát 0 hợp lệ, 3 chữ ký sai, 4 không có khóa, 5 gói sai, 6 không hợp thiết bị |
| `/etc/mat-runtime/trusted-keys/*.pem` | root, 0644 | khóa công khai tin cậy (tối đa 4), **ngoài** cây được cập nhật |

`deploy.sh` (từ gói có thư mục `updater/`) cài các tệp trên, ba unit, `/var/lib/mat-updater` (0700) và khóa công khai trong `deployment/keys/` của gói khi `trusted-keys/` chưa có khóa nào; không bao giờ ghi đè khóa đã có. Gói OTA không bao giờ chứa `updater/` (bị từ chối `UPDATER_MANUAL_ONLY`): đổi `mat-updater` chỉ bằng `deploy.sh`.

**Chữ ký của gói thủ công (rà soát T062 F1):** có `SHA256SUMS` và `SHA256SUMS.sig` cạnh gói thì `deploy.sh` kiểm chữ ký bằng `/usr/lib/mat-updater/mat-update-verify` **đã cài**, không bằng bộ kiểm nằm trong gói đang được kiểm. Lần cài đầu (chưa có bộ kiểm đã cài) thì đành dùng bộ kiểm của gói và in `CẢNH BÁO TIN-LẦN-ĐẦU (TOFU)`: gói giả mạo qua được bước này. Ghim khóa phát hành bằng `sh deploy.sh <gói> --expect-key-id sha256:<hex>` (keyId công bố, tính bằng `node tools/release/sums.mjs keyid <khóa công khai>`): khóa ký `SHA256SUMS` phải đúng keyId đó, và thiếu chữ ký thì dừng thay vì chỉ cảnh báo. Lần đầu nên luôn ghim.

### Bật OTA (root, trên thiết bị)

```sh
ls -l /etc/mat-runtime/trusted-keys/                      # phải có ít nhất một khóa .pem (root, 0644)
/opt/mat-runtime/bin/mat-runtime --trust-key list         # keyId và nhãn của từng khóa
# sửa /etc/mat-runtime/runtime.json: "update": { "enabled": true, "maxPackageMiB": 64, "trustedKeysDir": "/etc/mat-runtime/trusted-keys" }
systemctl restart mat-runtime
systemctl status mat-updater.path                         # active (waiting)
```

Bật mà chưa có khóa: `system/info` có cảnh báo `UPDATE_KEYS_MISSING` và mọi gói bị từ chối 503 `UPDATE_KEYS_MISSING`. Tắt lại: `"enabled": false` rồi `systemctl restart mat-runtime` (mọi endpoint trả 404 `UPDATE_DISABLED`).

### Khóa tin cậy

```sh
mat-runtime --trust-key add /tmp/release-backup.pub.pem --label release-backup   # chỉ khóa công khai ECDSA P-256, tối đa 4
mat-runtime --trust-key remove sha256:<keyId>
mat-runtime --trust-key list
```

Runtime ghi audit `system.keys.updated` (khóa thêm, khóa gỡ) ở lần khởi động sau. Xoay khóa định kỳ hoặc khi lộ khóa chính: phát gói `kind: keyset` ký bằng khóa đang tin cậy (thường là khóa dự phòng), cài như một cập nhật bình thường từ Studio; gói không được gỡ chính khóa đã ký nó (`KEYSET_SELF_REVOKE`). Cả hai khóa bị lộ: tắt OTA, cài khóa mới bằng `deploy.sh` hoặc `--trust-key` tại chỗ ([release-signing.md](../../specs/011-pilot-hardening/contracts/release-signing.md) §6).

### Cập nhật từ Studio

Trang Thiết bị → thẻ "Cập nhật runtime" (chỉ administrator, chỉ khi thiết bị báo `update.supported`): chọn tệp `.matupdate` → tải lên (thiết bị kiểm: phong bì, chữ ký, băm, danh sách tệp, kiến trúc, `releaseSeq` mới hơn, `minFromVersion`, định dạng project) → xem kế hoạch (từ phiên bản, đến phiên bản, người ký, thời gian ngừng ước tính) → nhập lại mật khẩu → theo dõi. Dịch vụ ngừng khoảng 10–30 s; phiên đăng nhập mất khi runtime khởi động lại nên Studio đăng nhập lại (không bao giờ có phiên bị nâng quyền). Kết quả:

- **committed:** bản mới chạy, `/opt/mat-runtime.prev` giữ bản cũ; nút "Quay về bản trước" chạy lại `.prev` (cần mật khẩu, audit `system.update.manual-rollback`);
- **rolled-back:** bản mới không qua kiểm sức khỏe trong 60 s (tiến trình sống ≥ 5 s, `system/info` qua HTTP và HTTPS đúng `runtimeVersion`, `releaseSeq` và digest project): bản cũ chạy lại, bản hỏng ở `/opt/mat-runtime.failed` (giữ một bản), cảnh báo `UPDATE_ROLLED_BACK` 30 ngày;
- **mất kết nối quá 120 s:** xem `mat-runtime --update-status` hoặc `journalctl -u mat-updater -u mat-runtime` trên thiết bị.

Giới hạn: một cập nhật mỗi 5 phút (mat-updater bỏ yêu cầu dày hơn, `RATE_LIMITED`); gói ≤ `update.maxPackageMiB`; chỗ trống ≥ 3 lần kích thước gói; nạp xuống project và cập nhật không chạy cùng lúc (`DEVICE_BUSY`).

### Kiểm tay, khôi phục thủ công

```sh
mat-runtime --update-status                                 # last.json: kết quả, lý do, đã audit chưa
cat /var/lib/mat-updater/ops/upd_*.json                     # các bước S4–S8 mà root đã ghi
/usr/lib/mat-updater/mat-update-verify /tmp/x.matupdate --keys /etc/mat-runtime/trusted-keys --installed /opt/mat-runtime
```

OTA hỏng hẳn (không đăng nhập được, `mat-updater` lỗi): cài lại bằng `deploy.sh` như mục 3 (gói thủ công kèm `SHA256SUMS` và `SHA256SUMS.sig`: `deploy.sh` kiểm chữ ký khi có, chỉ cảnh báo khi thiếu), hoặc `rollback.sh` (mục 6) để chạy lại `/opt/mat-runtime.prev`. Gỡ phần OTA: `systemctl disable --now mat-updater.path mat-updater-recover.service`, xóa ba unit trong `/etc/systemd/system/`, `/usr/lib/mat-updater`, `/var/lib/mat-updater`, `/etc/mat-runtime/trusted-keys`, `systemctl daemon-reload`; ghi vào `docs/reports/device-changes.md`.

## 6. Rollback

```sh
sh /opt/mat-runtime/deployment/rollback.sh   # /opt/mat-runtime.prev → hiện hành; bản hỏng giữ ở /opt/mat-runtime.failed
```

Lần cài đầu không có bản trước: rollback chỉ dừng dịch vụ.

**Rollback 0.5.0 về 0.4.x khi project đang chạy là 0.2:** runtime 0.4 không hiểu định dạng 0.2 nên chạy ở chế độ "không có project hợp lệ". Trước khi rollback, dùng "Khôi phục bản trước" (Studio, Online) về một bản project 0.1; hoặc nạp lại project 0.1 sau khi rollback. `audit.db` (`user_version` 2, thêm bảng `tag_write_request`) vẫn mở được bằng 0.4 (bảng thêm bị bỏ qua); thư mục `retain/` bị bỏ qua. Nếu đã đổi unit hay thêm drop-in cho serial, hoàn tác theo [device-changes.md](../reports/device-changes.md).

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
