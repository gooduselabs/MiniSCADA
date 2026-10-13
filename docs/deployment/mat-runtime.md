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

Từ 0.5.0, phần không cần đăng nhập (trang xem, `/assets`, `/project`, `system/info`, `projects/active`, live không kèm phiên) chỉ phục vụ **nguồn thuộc mạng riêng** (10/8, 172.16/12, 192.168/16, 100.64/10, 169.254/16, 127/8; fc00::/7, fe80::/10, ::1). Nguồn khác nhận 403. Request HTTPS có phiên hợp lệ (Studio) không bị lọc.

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

### 4. Từ xa

Khuyến nghị VPN. Port-forward HTTPS (8443) chỉ khi chọn: `viewerAccess: private` vẫn chặn trang với nguồn không có phiên nhưng `/login` luôn mở; dùng mật khẩu dài; 5 lần sai khóa 5 phút theo tên và theo IP.

### 5. Phiên và cấu hình (`/etc/mat-runtime/runtime.json`)

| Khóa | Mặc định | Ý nghĩa |
|---|---|---|
| `viewerLogin` | `off` | `required`: không có trang hay dữ liệu nếu chưa đăng nhập (đổi cần khởi động lại; giá trị lạ: runtime không chạy) |
| `webSessionIdleMin` | 30 (5–480) | hạn rảnh; trạm vận hành 24/7 đặt 480 |
| `webSessionMaxHours` | 12 (1–24) | hạn tối đa của phiên |
| `webMaxSessions` | 8 (1–16) | số phiên web đồng thời; tổng với phiên Studio ≤ 32 |

Kiosk (màn hình luôn mở, không có người gõ mật khẩu) nên dùng `viewerLogin: off`.

### 6. Cookie bị chặn, NAT, nhiều người chung IP

Phiên gắn IP lúc đăng nhập: đổi mạng giữa chừng thì đăng nhập lại. Cookie `__Host-mat_sid` cần HTTPS (không có qua HTTP: trang HTTP chỉ xem). Khóa tạm theo IP có thể khóa cả nhóm cùng sau một NAT.

### 7. Khắc phục sự cố

| Chrome báo | Nguyên nhân |
|---|---|
| `NET::ERR_CERT_AUTHORITY_INVALID` | chưa tin chứng chỉ (mục 2) |
| `NET::ERR_CERT_COMMON_NAME_INVALID` | SAN thiếu IP đang mở (`TLS_NO_IP_SAN`, `TLS_SAN_MISMATCH`): `--regen-cert` |
| `ERR_CERT_DATE_INVALID` | không xảy ra với chứng chỉ tự ký (hạn đến 9999); có thể với chứng chỉ CA riêng |
| điều khiển bị khóa | trang mở bằng HTTP, chưa đăng nhập, hoặc hết phiên |

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
